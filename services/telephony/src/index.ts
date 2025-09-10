import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import { z } from "zod";
import Redis from "ioredis";
import crypto from "node:crypto";

export const app = Fastify({ logger: true });
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

// CORS: explicitly allow PUBLIC_BASE_URL origin if provided (single-domain)
const allowedOrigin = (() => {
  const b = process.env.PUBLIC_BASE_URL || "";
  try {
    return b ? new URL(b).origin : true;
  } catch {
    return true;
  }
})();

await app.register(fastifyCors, {
  origin: allowedOrigin as any,
  methods: ["GET", "POST", "OPTIONS"],
  credentials: false,
});

// Health
app.get("/health", async () => ({ ok: true }));

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

// Basic security: optional IP allowlist and shared token
app.addHook("onRequest", async (req, reply) => {
  const allowed = (process.env.ALLOWED_JAMBONZ_IPS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (allowed.length > 0) {
    const ip = req.ip;
    if (!allowed.includes(ip)) {
      req.log.warn({ ip }, "blocked ip for telephony webhook");
      return reply.code(403).send({ code: "forbidden" });
    }
  }
  const shared = process.env.TELEPHONY_SHARED_SECRET;
  if (shared) {
    const token = (req.headers["x-telephony-token"] || "").toString();
    if (token !== shared) {
      return reply.code(401).send({ code: "unauthorized" });
    }
  }
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

// Incoming call webhook (generic)
app.post("/call", async (req, reply) => {
  const body = callHookSchema.safeParse((req as any).body);
  if (!body.success) {
    return reply.code(400).send({ error: "bad_request" });
  }
  const raw = body.data;
  const callId = raw.call_sid || `c_${Math.random().toString(36).slice(2)}`;
  const campaignId = getCampaignId(req, raw);

  // Acquire concurrency slots
  const acq = await acquireSemaphores(campaignId, callId);
  if (!acq.ok) {
    req.log.warn({ callId, campaignId, scope: acq.scope }, "concurrency limit exceeded");
    return reply
      .code(429)
      .send({ code: "concurrency_limit", scope: acq.scope, limit: acq.limit, message: "Concurrency limit exceeded" });
  }

  const agentId = (req.headers["x-agent-id"] as string) || undefined;
  const appJson = connectToRealtime(callId, agentId);
  return reply.send(appJson);
});

// Call status webhook (generic)
app.post("/status/:id", async (req) => {
  const { id } = req.params as any;
  const body: any = (req as any).body || {};
  const status = body.call_status || body.status || "unknown";

  // Map common statuses to timeline kinds
  const kind =
    status === "ringing" ? "call.ringing" :
    status === "in-progress" || status === "answered" ? "call.answered" :
    status === "completed" || status === "failed" || status === "no-answer" ? "call.ended" :
    "call.status";

  try {
    await redis.xadd(
      `events:${id}`,
      "*",
      "kind",
      kind,
      "payload",
      JSON.stringify({ raw: body })
    );
  } catch {}

  // DTMF pass-through if present
  if (body.dtmf || body.digit || body.digits) {
    const digits = body.dtmf?.digits || body.digit || body.digits;
    try {
      await redis.xadd(
        `events:${id}`,
        "*",
        "kind",
        "dtmf.receive",
        "payload",
        JSON.stringify({ digits })
      );
    } catch {}
  }

  // Release concurrency when terminal
  if (isTerminalStatus(status) || kind === "call.ended") {
    await releaseSemaphoresByCall(id);
  }

  req.log.info({ callId: id, status }, "status");
  return { ok: true };
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

// Health check with Redis connectivity
app.get("/health/detailed", async (req) => {
  try {
    // Check Redis connectivity
    await redis.ping();

    return {
      ok: true,
      service: "telephony",
      redis: "connected",
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    req.log.error({ err }, "Health check failed");
    return {
      ok: false,
      service: "telephony",
      error: (err as Error).message,
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
