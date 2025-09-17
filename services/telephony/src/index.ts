import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import { z } from "zod";
import Redis from "ioredis";
import crypto from "node:crypto";
import client from "prom-client";

export const app = Fastify({ logger: true });
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

// Prometheus metrics
const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

// Custom metrics for telephony service
const stuckCallsGauge = new client.Gauge({
  name: "telephony_stuck_calls_total",
  help: "Number of stuck calls detected",
  registers: [registry]
});

const semaphoreLeaksCounter = new client.Counter({
  name: "telephony_semaphore_leaks_total",
  help: "Total number of semaphore leaks detected",
  registers: [registry]
});

const activeSemaphoresGauge = new client.Gauge({
  name: "telephony_active_semaphores",
  help: "Number of active semaphores",
  registers: [registry]
});

const maxSemaphoresGauge = new client.Gauge({
  name: "telephony_max_semaphores",
  help: "Maximum allowed semaphores",
  registers: [registry]
});

const callTimeoutsCounter = new client.Counter({
  name: "telephony_call_timeouts_total",
  help: "Total number of call timeouts",
  registers: [registry]
});

const blockedIPsGauge = new client.Gauge({
  name: "telephony_blocked_ips_total",
  help: "Number of currently blocked IPs",
  registers: [registry]
});

// CORS: explicitly allow PUBLIC_BASE_URL origin if provided (single-domain)
const allowedOrigin = (() => {
  const b = process.env.PUBLIC_BASE_URL || "";
  try {
    return b ? new URL(b).origin : true;
  } catch {
    return true;
  }
})();

app.register(fastifyCors, {
  origin: allowedOrigin as any,
  methods: ["GET", "POST", "OPTIONS"],
  credentials: false,
});

// Health
app.get("/health", async () => ({ ok: true }));

// Prometheus metrics endpoint
app.get("/metrics", async (req, reply) => {
  reply.header("content-type", registry.contentType);
  return await registry.metrics();
});

// ---- Concurrency limits (Redis-backed semaphores) ----
const PER_CAMPAIGN_MAX = parseInt(process.env.TELEPHONY_PER_CAMPAIGN_MAX_CONCURRENCY || "0"); // 0 = unlimited
const GLOBAL_MAX = parseInt(process.env.TELEPHONY_GLOBAL_MAX_CONCURRENCY || "0"); // 0 = unlimited
const SEM_TTL = parseInt(process.env.TELEPHONY_SEMAPHORE_TTL_SEC || "3600");

const GLOBAL_SET_KEY = "limits:global";
const CAMPAIGNS_INDEX_KEY = "limits:campaigns";
const campaignSetKey = (campaignId: string) => `limits:campaign:${campaignId}`;
const tokenFor = (callId: string) => `sem:${callId}`;
const callCampaignKey = (callId: string) => `limits:call:${callId}:campaign`;

function getCampaignId(req: any, body: any): string {
  return (req.headers["x-campaign-id"] as string) || body?.campaign_id || "default";
}
function isTerminalStatus(status: string): boolean {
  const s = (status || "").toLowerCase();
  return ["completed", "failed", "no-answer", "busy", "canceled", "hangup", "ended", "call.ended", "finished"].includes(s);
}

async function acquireSemaphores(campaignId: string, callId: string): Promise<{ ok: true } | { ok: false; scope: "global" | "campaign"; limit: number; count: number }> {
  const token = tokenFor(callId);

  // Global limit
  if (GLOBAL_MAX > 0) {
    await redis.sadd(GLOBAL_SET_KEY, token);
    const cnt = await redis.scard(GLOBAL_SET_KEY);
    if (cnt > GLOBAL_MAX) {
      await redis.srem(GLOBAL_SET_KEY, token);
      return { ok: false, scope: "global", limit: GLOBAL_MAX, count: cnt - 1 };
    }
  }

  // Campaign limit
  if (PER_CAMPAIGN_MAX > 0) {
    const ck = campaignSetKey(campaignId);
    await redis.sadd(ck, token);
    const cntC = await redis.scard(ck);
    if (cntC > PER_CAMPAIGN_MAX) {
      await redis.srem(ck, token);
      if (GLOBAL_MAX > 0) await redis.srem(GLOBAL_SET_KEY, token);
      return { ok: false, scope: "campaign", limit: PER_CAMPAIGN_MAX, count: cntC - 1 };
    }
    await redis.sadd(CAMPAIGNS_INDEX_KEY, campaignId);
  }

  // Track mapping and TTL guard
  try { await redis.set(callCampaignKey(callId), campaignId, "EX", SEM_TTL); } catch {}
  try { await redis.set(`limits:token:${callId}`, "1", "EX", SEM_TTL); } catch {}

  return { ok: true };
}

async function releaseSemaphoresByCall(callId: string): Promise<void> {
  const token = tokenFor(callId);
  try {
    const campaignId = (await redis.get(callCampaignKey(callId))) || undefined;
    if (campaignId) {
      const ck = campaignSetKey(campaignId);
      await redis.srem(ck, token);
    }
    await redis.srem(GLOBAL_SET_KEY, token);
    await redis.del(callCampaignKey(callId));
    await redis.del(`limits:token:${callId}`);
  } catch {}
}

// Call timeout mechanism
const CALL_TIMEOUT_MINUTES = parseInt(process.env.CALL_TIMEOUT_MINUTES || "30"); // 30 minutes default
const CLEANUP_INTERVAL_MINUTES = parseInt(process.env.CLEANUP_INTERVAL_MINUTES || "5"); // Check every 5 minutes

async function cleanupStuckCalls(): Promise<void> {
  try {
    const now = Date.now();
    const timeoutMs = CALL_TIMEOUT_MINUTES * 60 * 1000;

    // Get all active call tokens
    const allTokens = await redis.smembers(GLOBAL_SET_KEY);
    let cleanedCount = 0;
    let stuckCount = 0;

    for (const token of allTokens) {
      const callId = token.replace('sem:', '');

      // Check if call has timed out
      const tokenExists = await redis.exists(`limits:token:${callId}`);
      if (!tokenExists) {
        // Token doesn't exist, clean up
        await releaseSemaphoresByCall(callId);
        cleanedCount++;
        semaphoreLeaksCounter.inc();
        continue;
      }

      // Check last activity by looking at events
      const events = await redis.xrange(`events:${callId}`, "-", "+", "COUNT", 1);
      if (events.length > 0) {
        const [, fields] = events[0];
        const event: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          event[String(fields[i])] = String(fields[i + 1]);
        }

        const lastActivity = parseInt(event.timestamp || '0');
        if (now - lastActivity > timeoutMs) {
          app.log.warn({ callId, lastActivity: new Date(lastActivity).toISOString() }, "call timed out, cleaning up");

          // Publish timeout event
          await redis.xadd(
            `events:${callId}`,
            "*",
            "kind", "call.timeout",
            "payload", JSON.stringify({ reason: "no_activity", timeoutMinutes: CALL_TIMEOUT_MINUTES, at: now })
          );

          // Clean up resources
          await releaseSemaphoresByCall(callId);
          cleanedCount++;
          callTimeoutsCounter.inc();
        } else {
          stuckCount++;
        }
      } else {
        // No events found, clean up
        await releaseSemaphoresByCall(callId);
        cleanedCount++;
        semaphoreLeaksCounter.inc();
      }
    }

    // Update metrics
    stuckCallsGauge.set(stuckCount);
    activeSemaphoresGauge.set(allTokens.length);
    maxSemaphoresGauge.set(GLOBAL_MAX > 0 ? GLOBAL_MAX : 1000); // Default high number if unlimited
    blockedIPsGauge.set(blockedIPs.size);

    if (cleanedCount > 0) {
      app.log.info({ cleanedCount }, "cleaned up stuck calls");
    }
  } catch (error) {
    app.log.error({ error }, "failed to cleanup stuck calls");
  }
}

// Start cleanup interval (disabled in tests)
if (!process.env.JEST_WORKER_ID && (process.env.NODE_ENV || "") !== "test") {
  setInterval(cleanupStuckCalls, CLEANUP_INTERVAL_MINUTES * 60 * 1000);
}

// Limits metrics endpoint
app.get("/telephony/limits", async () => {
  const globalCount = await redis.scard(GLOBAL_SET_KEY);
  const campaigns = await redis.smembers(CAMPAIGNS_INDEX_KEY);
  const details: Array<{ campaignId: string; count: number; limit: number }> = [];
  for (const c of campaigns) {
    const cnt = await redis.scard(campaignSetKey(c));
    details.push({ campaignId: c, count: cnt, limit: PER_CAMPAIGN_MAX });
  }
  return {
    global: { count: globalCount, limit: GLOBAL_MAX },
    campaigns: details,
  };
});

// Enhanced security: IP allowlist with CIDR support, rate limiting, and improved auth
const suspiciousIPs = new Map<string, { count: number; firstSeen: number; lastSeen: number }>();
const SUSPICIOUS_IP_THRESHOLD = 10; // requests per minute
const SUSPICIOUS_IP_WINDOW = 60000; // 1 minute in ms
const BLOCK_DURATION = 300000; // 5 minutes in ms
// Circuit breaker for telephony service
interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  lastFailureTime: number;
  nextAttemptTime: number;
}

const circuitBreaker: CircuitBreakerState = {
  state: 'closed',
  failures: 0,
  lastFailureTime: 0,
  nextAttemptTime: 0
};

const CIRCUIT_BREAKER_FAILURE_THRESHOLD = parseInt(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD || "5");
const CIRCUIT_BREAKER_TIMEOUT_MS = parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT_MS || "60000"); // 1 minute
const CIRCUIT_BREAKER_SUCCESS_THRESHOLD = parseInt(process.env.CIRCUIT_BREAKER_SUCCESS_THRESHOLD || "3");

function recordCircuitBreakerSuccess(): void {
  if (circuitBreaker.state === 'half-open') {
    circuitBreaker.failures = 0;
    circuitBreaker.state = 'closed';
    app.log.info("circuit breaker closed - service recovered");
  }
}

function recordCircuitBreakerFailure(): void {
  circuitBreaker.failures++;
  circuitBreaker.lastFailureTime = Date.now();

  if (circuitBreaker.state === 'closed' && circuitBreaker.failures >= CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
    circuitBreaker.state = 'open';
    circuitBreaker.nextAttemptTime = Date.now() + CIRCUIT_BREAKER_TIMEOUT_MS;
    app.log.warn({ failures: circuitBreaker.failures }, "circuit breaker opened");
  } else if (circuitBreaker.state === 'half-open') {
    circuitBreaker.state = 'open';
    circuitBreaker.nextAttemptTime = Date.now() + CIRCUIT_BREAKER_TIMEOUT_MS;
    app.log.warn("circuit breaker re-opened after half-open failure");
  }
}

function isCircuitBreakerOpen(): boolean {
  if (circuitBreaker.state === 'closed') {
    return false;
  }

  if (circuitBreaker.state === 'open') {
    const now = Date.now();
    if (now >= circuitBreaker.nextAttemptTime) {
      circuitBreaker.state = 'half-open';
      app.log.info("circuit breaker half-open - testing service");
      return false;
    }
    return true;
  }

  return false; // half-open allows requests
}

const blockedIPs = new Map<string, number>();

function isIPInCIDR(ip: string, cidr: string): boolean {
  try {
    const [network, prefix] = cidr.split('/');
    const prefixLen = parseInt(prefix);

    // Simple IPv4 CIDR check (can be enhanced for IPv6)
    if (ip.includes(':') || network.includes(':')) return false; // IPv6 not supported yet

    const ipParts = ip.split('.').map(Number);
    const networkParts = network.split('.').map(Number);

    const mask = ~(0xffffffff >>> prefixLen);
    const ipNum = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
    const networkNum = (networkParts[0] << 24) | (networkParts[1] << 16) | (networkParts[2] << 8) | networkParts[3];

    return (ipNum & mask) === (networkNum & mask);
  } catch {
    return false;
  }
}

function isAllowedIP(ip: string, allowedList: string[]): boolean {
  if (!ip) return false;

  for (const allowed of allowedList) {
    if (allowed.includes('/')) {
      // CIDR notation
      if (isIPInCIDR(ip, allowed)) return true;
    } else {
      // Exact match
      if (ip === allowed) return true;
    }
  }
  return false;
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const data = suspiciousIPs.get(ip);

  if (!data) {
    suspiciousIPs.set(ip, { count: 1, firstSeen: now, lastSeen: now });
    return true;
  }

  // Reset counter if window has passed
  if (now - data.firstSeen > SUSPICIOUS_IP_WINDOW) {
    suspiciousIPs.set(ip, { count: 1, firstSeen: now, lastSeen: now });
    return true;
  }

  data.count++;
  data.lastSeen = now;

  return data.count <= SUSPICIOUS_IP_THRESHOLD;
}

function isBlocked(ip: string): boolean {
  const blockTime = blockedIPs.get(ip);
  if (!blockTime) return false;

  const now = Date.now();
  if (now - blockTime > BLOCK_DURATION) {
    blockedIPs.delete(ip);
    return false;
  }
  return true;
}

app.addHook("onRequest", async (req, reply) => {
  const clientIP = req.ip || (req as any).raw?.connection?.remoteAddress || "unknown";

  // Check circuit breaker first
  if (isCircuitBreakerOpen()) {
    req.log.warn({ ip: clientIP, circuitBreakerState: circuitBreaker.state }, "circuit breaker open - rejecting request");
    return reply.code(503).send({
      code: "service_unavailable",
      message: "Service temporarily unavailable",
      retryAfter: Math.ceil((circuitBreaker.nextAttemptTime - Date.now()) / 1000)
    });
  }

  // Check if IP is blocked
  if (isBlocked(clientIP)) {
    recordCircuitBreakerFailure();
    req.log.warn({ ip: clientIP }, "blocked ip - rate limit exceeded");
    return reply.code(429).send({ code: "rate_limit_exceeded", message: "Too many requests" });
  }

  // Rate limiting check
  if (!checkRateLimit(clientIP)) {
    blockedIPs.set(clientIP, Date.now());
    recordCircuitBreakerFailure();
    req.log.warn({ ip: clientIP }, "ip blocked due to rate limiting");
    return reply.code(429).send({ code: "rate_limit_exceeded", message: "Too many requests" });
  }

  // IP allowlist check
  const allowedIPs = (process.env.ALLOWED_JAMBONZ_IPS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (allowedIPs.length > 0 && !isAllowedIP(clientIP, allowedIPs)) {
    recordCircuitBreakerFailure();
    req.log.warn({ ip: clientIP, allowedIPs }, "ip not in allowlist");
    return reply.code(403).send({ code: "forbidden", message: "IP not allowed" });
  }

  // Enhanced token validation
  const sharedSecret = process.env.TELEPHONY_SHARED_SECRET;
  if (sharedSecret) {
    const token = (req.headers["x-telephony-token"] || "").toString();
    if (!token || token !== sharedSecret) {
      recordCircuitBreakerFailure();
      req.log.warn({ ip: clientIP, hasToken: !!token }, "invalid or missing auth token");
      return reply.code(401).send({ code: "unauthorized", message: "Invalid authentication" });
    }
  }

  // Log successful auth for monitoring
  req.log.info({ ip: clientIP, path: req.url }, "request authorized");
});

// Jambonz webhook schemas
const callHookSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  call_sid: z.string().optional(),
  account_sid: z.string().optional(),
  application_sid: z.string().optional(),
  call_status: z.string().optional(),
  direction: z.string().optional(),
  caller_name: z.string().optional(),
  sip: z.any().optional(),
  // pass-through custom headers
});

// Connect verb response to bridge media to our realtime WS
function connectToRealtime(callId: string, agentId?: string) {
  // Build signed URL for realtime WS: wss://.../v1/realtime/:callId?sig=..&ts=..&agentId=...
  const base = (process.env.REALTIME_WS_BASE_URL || process.env.REALTIME_WS_URL || "wss://api.invortoai.com").replace(/\/+$/, "");
  const wsSecret = process.env.REALTIME_WS_SECRET || "";
  const ts = Math.floor(Date.now() / 1000).toString();
  let sig = "";
  try {
    if (wsSecret) {
      sig = crypto.createHmac("sha256", wsSecret).update(`${callId}:${ts}`).digest("hex");
    }
  } catch {}

  const qp = new URLSearchParams();
  if (sig) qp.set("sig", sig);
  qp.set("ts", ts);
  if (agentId) qp.set("agentId", agentId);
  // Audio preferences (optional)
  qp.set("codec", "linear16");
  qp.set("rate", "16000");

  // Use v1 route as canonical
  const url = `${base}/v1/realtime/${encodeURIComponent(callId)}?${qp.toString()}`;

  const headers: Record<string, string> = {};
  const apiKey = process.env.REALTIME_API_KEY;
  if (apiKey) headers["Sec-WebSocket-Protocol"] = apiKey;

  // Jambonz application JSON (connect verb)
  return [
    {
      verb: "redirect",
      actionHook: `${process.env.PUBLIC_BASE_URL || "http://telephony:8085"}/status/${callId}`
    },
    {
      verb: "connect",
      url,
      wsUrl: url,
      headers,
      earlyMedia: true,
      passDtmf: true
    }
  ];
}

// Retry mechanism with exponential backoff
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000,
  maxDelay: number = 10000
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxRetries) {
        break;
      }

      // Exponential backoff with jitter
      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      const jitter = Math.random() * 0.1 * delay;
      const finalDelay = delay + jitter;

      await new Promise(resolve => setTimeout(resolve, finalDelay));
    }
  }

  throw lastError!;
}

// Graceful degradation handler
function handleGracefulDegradation(req: any, reply: any, error: Error, operation: string) {
  req.log.error({ error, operation }, "operation failed, attempting graceful degradation");

  // For call operations, we can return a basic response
  if (operation === "call") {
    return reply.code(503).send({
      code: "service_degraded",
      message: "Service temporarily degraded, call may not be fully functional",
      degraded: true
    });
  }

  // For status operations, we can still process but with reduced functionality
  if (operation === "status") {
    return reply.code(202).send({
      code: "accepted_degraded",
      message: "Status accepted but processing may be delayed",
      degraded: true
    });
  }

  // Default degraded response
  return reply.code(503).send({
    code: "service_unavailable",
    message: "Service temporarily unavailable",
    degraded: true
  });
}

// Incoming call webhook (generic) with retry and circuit breaker
app.post("/call", async (req, reply) => {
  try {
    const body = callHookSchema.safeParse((req as any).body);
    if (!body.success) {
      recordCircuitBreakerFailure();
      return reply.code(400).send({ error: "bad_request" });
    }
    const raw = body.data;
    const callId = raw.call_sid || `c_${Math.random().toString(36).slice(2)}`;
    const campaignId = getCampaignId(req, raw);

    // Acquire concurrency slots with retry
    const acq = await retryWithBackoff(async () => {
      const result = await acquireSemaphores(campaignId, callId);
      if (!result.ok) {
        throw new Error(`Concurrency limit exceeded: ${result.scope}`);
      }
      return result;
    });

    const agentId = (req.headers["x-agent-id"] as string) || undefined;
    const appJson = connectToRealtime(callId, agentId);

    recordCircuitBreakerSuccess();
    return reply.send(appJson);

  } catch (error) {
    recordCircuitBreakerFailure();
    return handleGracefulDegradation(req, reply, error as Error, "call");
  }
});

// Enhanced call status webhook with better error handling
app.post("/status/:id", async (req, reply) => {
  const { id } = req.params as any;
  const body: any = (req as any).body || {};
  const status = body.call_status || body.status || "unknown";
  const callId = id;

  try {
    // Validate call ID
    if (!callId || typeof callId !== 'string') {
      req.log.warn({ callId }, "invalid call ID in status webhook");
      return { ok: false, error: "invalid_call_id" };
    }

    // Enhanced status mapping with better edge case handling
    let kind: string;
    let shouldReleaseSemaphore = false;

    switch (status.toLowerCase()) {
      case "ringing":
        kind = "call.ringing";
        break;
      case "in-progress":
      case "answered":
        kind = "call.answered";
        break;
      case "completed":
      case "failed":
      case "no-answer":
      case "busy":
        kind = "call.ended";
        shouldReleaseSemaphore = true;
        break;
      case "canceled":
        kind = "call.canceled";
        shouldReleaseSemaphore = true;
        // Publish cancellation event for tracking
        try {
          await redis.xadd(
            `events:${callId}`,
            "*",
            "kind", "call.canceled",
            "payload", JSON.stringify({
              reason: body.canceled_reason || "unknown",
              at: Date.now(),
              raw: body
            })
          );
        } catch (error) {
          req.log.error({ error, callId }, "failed to publish cancellation event");
        }
        break;
      case "hangup":
        kind = "call.hangup";
        shouldReleaseSemaphore = true;
        break;
      default:
        kind = "call.status";
        // Check for late status updates that should trigger cleanup
        if (body.duration && parseInt(body.duration) > CALL_TIMEOUT_MINUTES * 60) {
          req.log.warn({ callId, status, duration: body.duration }, "late status update detected");
          shouldReleaseSemaphore = true;
        }
    }

    // Publish main status event
    await redis.xadd(
      `events:${callId}`,
      "*",
      "kind", kind,
      "payload", JSON.stringify({
        status,
        timestamp: Date.now(),
        raw: body
      })
    );

    // Handle DTMF pass-through with validation
    if (body.dtmf || body.digit || body.digits) {
      const digits = body.dtmf?.digits || body.digit || body.digits;
      if (digits && typeof digits === 'string') {
        try {
          await redis.xadd(
            `events:${callId}`,
            "*",
            "kind", "dtmf.receive",
            "payload", JSON.stringify({ digits, timestamp: Date.now() })
          );
        } catch (error) {
          req.log.error({ error, callId }, "failed to publish DTMF event");
        }
      }
    }

    // Release concurrency when terminal or on late updates
    if (shouldReleaseSemaphore || isTerminalStatus(status) || kind === "call.ended") {
      try {
        await releaseSemaphoresByCall(callId);
        req.log.info({ callId, status }, "semaphore released");
      } catch (error) {
        req.log.error({ error, callId }, "failed to release semaphore");
      }
    }

    recordCircuitBreakerSuccess();
    req.log.info({ callId, status, kind }, "status processed successfully");
    return { ok: true, status, kind };

  } catch (error) {
    recordCircuitBreakerFailure();
    req.log.error({ error, callId, status }, "status webhook processing failed");

    // Attempt cleanup on error
    try {
      await releaseSemaphoresByCall(callId);
    } catch (cleanupError) {
      req.log.error({ cleanupError, callId }, "cleanup failed after status error");
    }

    return handleGracefulDegradation(req, reply, error as Error, "status");
  }
});

// ---- Jambonz integration (single-domain HTTPS webhooks) ----

// Best-effort HMAC verification using shared secret
function verifyJambonzHmac(secret: string | undefined, payload: unknown, signature?: string): boolean {
  if (!secret) return true;
  if (!signature) return false;
  try {
    const body = typeof payload === "string" ? payload : JSON.stringify(payload ?? {});
    const mac = crypto.createHmac("sha256", secret).update(body).digest("hex");
    const a = Buffer.from(mac, "utf8");
    const b = Buffer.from(signature, "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Jambonz initial call webhook
 * POST https://api.invortoai.com/telephony/jambonz/call
 * Respond with a call-control JSON that starts bidirectional WS stream to realtime
 */
app.post("/telephony/jambonz/call", async (req, reply) => {
  const body = (req as any).body || {};
  const callId: string = body.call_sid || `c_${Math.random().toString(36).slice(2)}`;

  // HMAC verification if configured
  const secret = process.env.JAMBONZ_WEBHOOK_SECRET;
  const sig = (req.headers["x-jambonz-signature"] ||
               req.headers["x-hub-signature-256"] ||
               req.headers["x-signature"] || "") as string;
  if (!verifyJambonzHmac(secret, body, sig)) {
    req.log.warn({ callId }, "invalid jambonz HMAC");
    return reply.code(401).send({ code: "unauthorized" });
  }

  // Acquire concurrency slots
  const campaignId = getCampaignId(req, body);
  const acq = await acquireSemaphores(campaignId, callId);
  if (!acq.ok) {
    req.log.warn({ callId, campaignId, scope: acq.scope }, "concurrency limit exceeded");
    return reply
      .code(429)
      .send({ code: "concurrency_limit", scope: acq.scope, limit: acq.limit, message: "Concurrency limit exceeded" });
  }

  const ws = (process.env.REALTIME_WS_URL || "wss://api.invortoai.com/realtime/voice").replace(/\/+$/, "");
  const wsUrl = ws.includes("/realtime/voice") ? `${ws}?callId=${encodeURIComponent(callId)}` : `${ws}/${callId}`;

  // Persist 'call.started'
  try {
    await redis.xadd(
      `events:${callId}`,
      "*",
      "kind",
      "call.started",
      "payload",
      JSON.stringify({ source: "pstn", provider: "jambonz", at: Date.now() })
    );
  } catch {}

  // Return jambonz call-control response (stream verb as requested)
  const response = {
    application_sid: process.env.JAMBONZ_APPLICATION_SID || "",
    call_hook: [
      {
        verb: "stream",
        url: wsUrl,
        metadata: { source: "pstn", provider: "jambonz" }
      }
    ]
  };

  return reply.send(response);
});

/**
 * Jambonz call status webhook
 * POST https://api.invortoai.com/telephony/jambonz/status
 */
app.post("/telephony/jambonz/status", async (req, reply) => {
  const body: any = (req as any).body || {};
  const callId: string = body.call_sid || body.id || `c_${Math.random().toString(36).slice(2)}`;

  // HMAC verification if configured
  const secret = process.env.JAMBONZ_WEBHOOK_SECRET;
  const sig = (req.headers["x-jambonz-signature"] ||
               req.headers["x-hub-signature-256"] ||
               req.headers["x-signature"] || "") as string;
  if (!verifyJambonzHmac(secret, body, sig)) {
    req.log.warn({ callId }, "invalid jambonz HMAC");
    return reply.code(401).send({ code: "unauthorized" });
  }

  const status = body.call_status || body.status || "unknown";
  const kind =
    status === "ringing" ? "call.ringing" :
    (status === "in-progress" || status === "answered") ? "call.answered" :
    (status === "completed" || status === "failed" || status === "no-answer") ? "call.ended" :
    "call.status";

  try {
    await redis.xadd(
      `events:${callId}`,
      "*",
      "kind",
      kind,
      "payload",
      JSON.stringify({ raw: body })
    );
  } catch {}

  // Release concurrency when terminal
  if (isTerminalStatus(status) || kind === "call.ended") {
    await releaseSemaphoresByCall(callId);
  }

  req.log.info({ callId, status }, "jambonz status");
  return reply.send({ ok: true });
});

// Call transfer endpoint
app.post("/transfer/:id", async (req, reply) => {
  const { id } = req.params as any;
  const { to, mode = "blind" } = (req.body as any) || {};
  
  if (!to) {
    return reply.code(400).send({ code: "bad_request", message: "transfer destination required" });
  }
  
  try {
    // Publish transfer event to timeline
    await redis.xadd(
      `events:${id}`,
      "*",
      "kind",
      "call.transfer",
      "payload",
      JSON.stringify({ to, mode, at: Date.now() })
    );
    
    // Generate Jambonz transfer application JSON
    const transferApp = {
      verb: "transfer",
      to: to,
      mode: mode,
      actionHook: `${process.env.PUBLIC_BASE_URL || "http://telephony:8085"}/status/${id}`,
      statusHook: `${process.env.PUBLIC_BASE_URL || "http://telephony:8085"}/status/${id}`,
    };
    
    req.log.info({ callId: id, to, mode }, "call transfer initiated");
    return transferApp;
  } catch (err) {
    req.log.error({ err, callId: id }, "transfer failed");
    return reply.code(500).send({ code: "internal_error" });
  }
});

// Call recording control
app.post("/recording/:id", async (req, reply) => {
  const { id } = req.params as any;
  const { action } = (req.body as any) || {};
  
  if (!["start", "stop", "pause", "resume"].includes(action)) {
    return reply.code(400).send({ code: "bad_request", message: "Invalid action" });
  }
  
  try {
    // Publish recording event to timeline
    await redis.xadd(
      `events:${id}`,
      "*",
      "kind",
      "recording." + action,
      "payload",
      JSON.stringify({ at: Date.now() })
    );
    
    // Generate Jambonz recording application JSON
    const recordingApp = {
      verb: "record",
      action: action,
      actionHook: `${process.env.PUBLIC_BASE_URL || "http://telephony:8085"}/status/${id}`,
      statusHook: `${process.env.PUBLIC_BASE_URL || "http://telephony:8085"}/status/${id}`,
    };
    
    req.log.info({ callId: id, action }, "recording control");
    return recordingApp;
  } catch (err) {
    req.log.error({ err, callId: id }, "recording control failed");
    return reply.code(500).send({ code: "internal_error" });
  }
});

// Conference management
app.post("/conference/:id", async (req, reply) => {
  const { id } = req.params as any;
  const { action, participants } = (req.body as any) || {};
  
  if (!["create", "join", "leave", "mute", "unmute"].includes(action)) {
    return reply.code(400).send({ code: "bad_request", message: "Invalid action" });
  }
  
  try {
    // Publish conference event to timeline
    await redis.xadd(
      `events:${id}`,
      "*",
      "kind",
      "conference." + action,
      "payload",
      JSON.stringify({ action, participants, at: Date.now() })
    );
    
    // Generate Jambonz conference application JSON
    let conferenceApp: any;
    if (action === "create") {
      conferenceApp = {
        verb: "conference",
        name: `conf_${id}`,
        actionHook: `${process.env.PUBLIC_BASE_URL || "http://telephony:8085"}/status/${id}`,
        statusHook: `${process.env.PUBLIC_BASE_URL || "http://telephony:8085"}/status/${id}`,
        startConferenceOnEnter: true,
        endConferenceOnExit: false,
      };
    } else if (action === "join") {
      conferenceApp = {
        verb: "conference",
        name: `conf_${id}`,
        actionHook: `${process.env.PUBLIC_BASE_URL || "http://telephony:8085"}/status/${id}`,
      };
    }
    
    req.log.info({ callId: id, action }, "conference control");
    return conferenceApp || { ok: true, action };
  } catch (err) {
    req.log.error({ err, callId: id }, "conference control failed");
    return reply.code(500).send({ code: "internal_error" });
  }
});

// DTMF handling
app.post("/dtmf/:id", async (req, reply) => {
  const { id } = req.params as any;
  const { digits, method = "rfc2833" } = (req.body as any) || {};
  
  if (!digits) {
    return reply.code(400).send({ code: "bad_request", message: "digits required" });
  }
  
  try {
    // Publish DTMF event to timeline
    await redis.xadd(
      `events:${id}`,
      "*",
      "kind",
      "dtmf.send",
      "payload",
      JSON.stringify({ digits, method, at: Date.now() })
    );
    
    // Generate Jambonz DTMF application JSON
    const dtmfApp = {
      verb: "sendDigits",
      digits: digits,
      method: method,
    };
    
    req.log.info({ callId: id, digits, method }, "DTMF sent");
    return dtmfApp;
  } catch (err) {
    req.log.error({ err, callId: id }, "DTMF failed");
    return reply.code(500).send({ code: "internal_error" });
  }
});

// Call hold/resume
app.post("/hold/:id", async (req, reply) => {
  const { id } = req.params as any;
  const { action } = (req.body as any) || {};
  
  if (!["hold", "resume"].includes(action)) {
    return reply.code(400).send({ code: "bad_request", message: "Invalid action" });
  }
  
  try {
    // Publish hold event to timeline
    await redis.xadd(
      `events:${id}`,
      "*",
      "kind",
      "call." + action,
      "payload",
      JSON.stringify({ at: Date.now() })
    );
    
    // Generate Jambonz hold application JSON
    const holdApp = {
      verb: action === "hold" ? "pause" : "resume",
      actionHook: `${process.env.PUBLIC_BASE_URL || "http://telephony:8085"}/status/${id}`,
    };
    
    req.log.info({ callId: id, action }, "call hold control");
    return holdApp;
  } catch (err) {
    req.log.error({ err, callId: id }, "hold control failed");
    return reply.code(500).send({ code: "internal_error" });
  }
});

// Get call information
app.get("/call/:id", async (req, reply) => {
  const { id } = req.params as any;
  
  try {
    // Get call events from timeline
    const events = await redis.xrange(`events:${id}`, "-", "+", "COUNT", 100);
    
    const callInfo = {
      callId: id,
      events: events.map(([, fields]) => {
        const event: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          event[String(fields[i])] = String(fields[i + 1]);
        }
        return {
          kind: event.kind,
          payload: event.payload ? JSON.parse(event.payload) : null,
          timestamp: event.timestamp,
        };
      }),
      totalEvents: events.length,
    };
    
    return callInfo;
  } catch (err) {
    req.log.error({ err, callId: id }, "failed to get call info");
    return reply.code(500).send({ code: "internal_error" });
  }
});

// Multi-party call management
app.post("/multiparty/:id", async (req, reply) => {
  const { id } = req.params as any;
  const { action, participants, conferenceId } = (req.body as any) || {};

  if (!["add", "remove", "mute", "unmute", "list"].includes(action)) {
    return reply.code(400).send({ code: "bad_request", message: "Invalid action" });
  }

  try {
    // Publish multi-party event to timeline
    await redis.xadd(
      `events:${id}`,
      "*",
      "kind",
      "multiparty." + action,
      "payload",
      JSON.stringify({ action, participants, conferenceId, at: Date.now() })
    );

    // Generate Jambonz multi-party application JSON
    let multipartyApp: any;
    if (action === "add") {
      multipartyApp = {
        verb: "conference",
        name: conferenceId || `multi_${id}`,
        actionHook: `${process.env.PUBLIC_BASE_URL || "http://telephony:8085"}/status/${id}`,
        startConferenceOnEnter: true,
        endConferenceOnExit: false,
        participantLabel: participants?.[0]?.label || "participant",
      };
    } else if (action === "remove") {
      multipartyApp = {
        verb: "leave",
        conferenceName: conferenceId || `multi_${id}`,
      };
    }

    req.log.info({ callId: id, action, participants }, "multi-party control");
    return multipartyApp || { ok: true, action };
  } catch (err) {
    req.log.error({ err, callId: id }, "multi-party control failed");
    return reply.code(500).send({ code: "internal_error" });
  }
});

// IVR (Interactive Voice Response) capabilities
app.post("/ivr/:id", async (req, reply) => {
  const { id } = req.params as any;
  const { prompt, options, timeout = 5000, maxDigits = 1 } = (req.body as any) || {};

  if (!prompt) {
    return reply.code(400).send({ code: "bad_request", message: "prompt required" });
  }

  try {
    // Publish IVR event to timeline
    await redis.xadd(
      `events:${id}`,
      "*",
      "kind",
      "ivr.started",
      "payload",
      JSON.stringify({ prompt, options, timeout, maxDigits, at: Date.now() })
    );

    // Generate Jambonz IVR application JSON
    const ivrApp = [
      {
        verb: "play",
        url: prompt, // Could be TTS URL or audio file
      },
      {
        verb: "gather",
        input: ["dtmf"],
        timeout: timeout / 1000, // Convert to seconds
        maxDigits: maxDigits,
        actionHook: `${process.env.PUBLIC_BASE_URL || "http://telephony:8085"}/ivr/response/${id}`,
        statusHook: `${process.env.PUBLIC_BASE_URL || "http://telephony:8085"}/status/${id}`,
      }
    ];

    req.log.info({ callId: id, prompt, options }, "IVR initiated");
    return ivrApp;
  } catch (err) {
    req.log.error({ err, callId: id }, "IVR failed");
    return reply.code(500).send({ code: "internal_error" });
  }
});

// IVR response handler
app.post("/ivr/response/:id", async (req) => {
  const { id } = req.params as any;
  const { digits, speech, confidence } = (req.body as any) || {};

  try {
    // Publish IVR response event to timeline
    await redis.xadd(
      `events:${id}`,
      "*",
      "kind",
      "ivr.response",
      "payload",
      JSON.stringify({ digits, speech, confidence, at: Date.now() })
    );

    req.log.info({ callId: id, digits, speech }, "IVR response received");
    return { ok: true, response: { digits, speech, confidence } };
  } catch (err) {
    req.log.error({ err, callId: id }, "IVR response failed");
    return { ok: false, error: (err as Error).message };
  }
});

// Real-time call analytics
app.get("/analytics/:id", async (req, reply) => {
  const { id } = req.params as any;

  try {
    // Get call events for analytics
    const events = await redis.xrange(`events:${id}`, "-", "+", "COUNT", 1000);

    const analytics = {
      callId: id,
      totalEvents: events.length,
      eventBreakdown: {} as Record<string, number>,
      duration: 0,
      qualityMetrics: {
        dtmfEvents: 0,
        transferEvents: 0,
        holdEvents: 0,
        conferenceEvents: 0,
        errorEvents: 0,
      },
      timeline: [] as Array<{ timestamp: number; event: string; details: any }>,
    };

    if (events.length > 0) {
      const firstEvent = events[0];
      const lastEvent = events[events.length - 1];

      // Calculate duration
      const [, firstFields] = firstEvent;
      const [, lastFields] = lastEvent;

      const firstTimestamp = parseInt(String(firstFields[firstFields.indexOf('timestamp') + 1] || '0'));
      const lastTimestamp = parseInt(String(lastFields[lastFields.indexOf('timestamp') + 1] || Date.now()));

      analytics.duration = lastTimestamp - firstTimestamp;

      // Process events for analytics
      events.forEach(([, fields]) => {
        const event: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          event[String(fields[i])] = String(fields[i + 1]);
        }

        const kind = event.kind;
        analytics.eventBreakdown[kind] = (analytics.eventBreakdown[kind] || 0) + 1;

        // Categorize events
        if (kind.includes('dtmf')) analytics.qualityMetrics.dtmfEvents++;
        if (kind.includes('transfer')) analytics.qualityMetrics.transferEvents++;
        if (kind.includes('hold')) analytics.qualityMetrics.holdEvents++;
        if (kind.includes('conference')) analytics.qualityMetrics.conferenceEvents++;
        if (kind.includes('error') || kind.includes('failed')) analytics.qualityMetrics.errorEvents++;

        // Add to timeline
        analytics.timeline.push({
          timestamp: parseInt(event.timestamp || '0'),
          event: kind,
          details: event.payload ? JSON.parse(event.payload) : null,
        });
      });
    }

    return analytics;
  } catch (err) {
    req.log.error({ err, callId: id }, "analytics failed");
    return reply.code(500).send({ code: "internal_error" });
  }
});

// Get active calls
app.get("/calls/active", async (req, reply) => {
  try {
    // Get all call event streams
    const keys = await redis.keys("events:*");
    const activeCalls: Array<{ callId: string; lastEvent: string; lastEventTime: string | number | undefined }> = [];

    for (const key of keys) {
      const callId = key.replace("events:", "");

      // Get latest event to determine status
      const latestEvents = await redis.xrevrange(key, "+", "-", "COUNT", 1);
      if (latestEvents.length > 0) {
        const [, fields] = latestEvents[0];
        const event: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          event[String(fields[i])] = String(fields[i + 1]);
        }

        const kind = event.kind;
        if (kind !== "call.ended" && kind !== "call.failed") {
          activeCalls.push({
            callId,
            lastEvent: kind,
            lastEventTime: event.timestamp,
          });
        }
      }
    }

    return {
      activeCalls,
      count: activeCalls.length,
    };
  } catch (err) {
    req.log.error({ err }, "failed to get active calls");
    return reply.code(500).send({ code: "internal_error" });
  }
});

// Stuck calls detection endpoint
app.get("/calls/stuck", async (req, reply) => {
  try {
    const now = Date.now();
    const timeoutMs = CALL_TIMEOUT_MINUTES * 60 * 1000;
    const stuckCalls: Array<{ callId: string; lastActivity: number; ageMinutes: number; reason: string }> = [];

    // Check semaphore tokens
    const allTokens = await redis.smembers(GLOBAL_SET_KEY);
    for (const token of allTokens) {
      const callId = token.replace('sem:', '');

      // Check if token exists
      const tokenExists = await redis.exists(`limits:token:${callId}`);
      if (!tokenExists) {
        stuckCalls.push({
          callId,
          lastActivity: 0,
          ageMinutes: 0,
          reason: "missing_token"
        });
        continue;
      }

      // Check last activity
      const events = await redis.xrange(`events:${callId}`, "-", "+", "COUNT", 1);
      if (events.length > 0) {
        const [, fields] = events[0];
        const event: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          event[String(fields[i])] = String(fields[i + 1]);
        }

        const lastActivity = parseInt(event.timestamp || '0');
        const ageMinutes = (now - lastActivity) / (60 * 1000);

        if (now - lastActivity > timeoutMs) {
          stuckCalls.push({
            callId,
            lastActivity,
            ageMinutes: Math.round(ageMinutes),
            reason: "timeout"
          });
        }
      } else {
        stuckCalls.push({
          callId,
          lastActivity: 0,
          ageMinutes: 0,
          reason: "no_events"
        });
      }
    }

    return {
      stuckCalls,
      count: stuckCalls.length,
      timeoutMinutes: CALL_TIMEOUT_MINUTES,
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    req.log.error({ err }, "failed to detect stuck calls");
    return reply.code(500).send({ code: "internal_error" });
  }
});

// Circuit breaker status endpoint
app.get("/circuit-breaker/status", async (req) => {
  return {
    state: circuitBreaker.state,
    failures: circuitBreaker.failures,
    lastFailureTime: circuitBreaker.lastFailureTime ? new Date(circuitBreaker.lastFailureTime).toISOString() : null,
    nextAttemptTime: circuitBreaker.nextAttemptTime ? new Date(circuitBreaker.nextAttemptTime).toISOString() : null,
    timestamp: new Date().toISOString()
  };
});

// Health check with Redis connectivity and circuit breaker status
app.get("/health/detailed", async (req) => {
  try {
    // Check Redis connectivity
    await redis.ping();

    return {
      ok: true,
      service: "telephony",
      redis: "connected",
      circuitBreaker: {
        state: circuitBreaker.state,
        failures: circuitBreaker.failures
      },
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    req.log.error({ err }, "Health check failed");
    return {
      ok: false,
      service: "telephony",
      error: (err as Error).message,
      circuitBreaker: {
        state: circuitBreaker.state,
        failures: circuitBreaker.failures
      },
      timestamp: new Date().toISOString(),
    };
  }
});

const PORT = Number(process.env.PORT || 8085);
if (!process.env.JEST_WORKER_ID && (process.env.NODE_ENV || "") !== "test") {
  app.listen({ port: PORT, host: "0.0.0.0" }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
