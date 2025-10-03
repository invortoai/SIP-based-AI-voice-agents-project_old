import Fastify, { FastifyInstance } from "fastify";
import client from "prom-client";
import fastifyCors from "@fastify/cors";
import crypto from "node:crypto";
import Redis from "ioredis";
import type { Redis as RedisType } from "ioredis";
import { z } from "zod";
import {
  initializeObservability,
  logger,
  StructuredLogger,
  customMetrics,
  healthChecker,
  createSpan,
  recordException
} from "@invorto/shared";
import {
  requestSanitizer,
  apiKeyManager,
  PIIRedactor,
  getSecret
} from "@invorto/shared";

// Initialize observability (skip top-level await; run async init outside of tests)
async function initObservability() {
  try {
    await initializeObservability({
      serviceName: "webhooks-service",
      environment: process.env.NODE_ENV || "development",
      langfuseEnabled: process.env.LANGFUSE_ENABLED === "true",
      langfusePublicKey: process.env.LANGFUSE_PUBLIC_KEY,
      langfuseSecretKey: process.env.LANGFUSE_SECRET_KEY,
      langfuseBaseUrl: process.env.LANGFUSE_BASE_URL,
    });
  } catch (err) {
    console.error("Failed to initialize observability:", err);
  }
}
if (!process.env.JEST_WORKER_ID && (process.env.NODE_ENV || "") !== "test") {
  void initObservability();
}

const structuredLogger = new StructuredLogger("webhooks-service");
const piiRedactor = new PIIRedactor();

const isTest = !!process.env.JEST_WORKER_ID || (process.env.NODE_ENV || "") === "test";
export const app: FastifyInstance = Fastify({
  logger: isTest ? {
    level: process.env.LOG_LEVEL || "info",
    transport: {
      target: "pino-pretty",
      options: {
        translateTime: "HH:MM:ss Z",
        ignore: "pid,hostname",
      },
    },
  } : true, // Use JSON logging in production (no pino-pretty dependency needed)
});

// CORS: allow requests from the single-domain public origin
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
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  credentials: false,
});

// Force ACAO to the configured PUBLIC_BASE_URL origin at response time (test-friendly and deterministic)
app.addHook("onSend", async (req, reply, payload) => {
  try {
    const b = process.env.PUBLIC_BASE_URL || "";
    if (b) {
      const fixedOrigin = new URL(b).origin;
      reply.header("access-control-allow-origin", fixedOrigin);
      reply.header("vary", "Origin");
    }
  } catch {
    // ignore
  }
  return payload;
});

// Add security middleware
app.addHook("onRequest", async (req, reply) => {
  // IP allowlist check
  // optional IP allowlist can be added here
  
  // API key validation for dispatch endpoints
  if (req.url.startsWith("/dispatch")) {
    const apiKey = req.headers["x-api-key"] as string;
    if (!apiKey || apiKey.length === 0) {
      customMetrics.incrementCounter("webhook_auth_failures");
      return reply.code(401).send({ code: "unauthorized", message: "Invalid API key" });
    }
  }
});

let redisUrl: string = process.env.REDIS_URL || "redis://localhost:6379";
let redis!: RedisType;

// Initialize external deps when server is ready
app.addHook("onReady", async () => {
  // Get Redis URL from secret or environment
  let redisUrlSource = "default";
  try {
    const fromSecret = await getSecret("REDIS_URL");
    if (fromSecret) {
      redisUrl = fromSecret;
      redisUrlSource = "secret";
    } else if (process.env.REDIS_URL) {
      redisUrl = process.env.REDIS_URL;
      redisUrlSource = "environment";
    } else {
      redisUrl = "redis://localhost:6379";
      redisUrlSource = "default";
    }
  } catch (err) {
    app.log.warn({ err }, "Failed to get Redis URL from secret, trying environment");
    redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
    redisUrlSource = process.env.REDIS_URL ? "environment" : "default";
  }

  app.log.info({ redisUrl, source: redisUrlSource }, "Initializing Redis connection");

  // Initialize Redis connection
  try {
    redis = new (Redis as any)(redisUrl);

    // Test the connection with timeout
    await Promise.race([
      redis.ping(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Redis ping timeout")), 5000)
      )
    ]);

    app.log.info("Redis connection established successfully");
  } catch (err) {
    app.log.error({ err, redisUrl }, "Redis connection failed - service will start with degraded functionality");
    // Don't throw - allow service to start with degraded Redis functionality
    redis = undefined as any;
  }
});

// Configuration
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "dev_webhook_secret";
const MAX_RETRIES = parseInt(process.env.MAX_WEBHOOK_RETRIES || "3");
const RETRY_DELAYS = [1000, 5000, 15000]; // Exponential backoff
const WEBHOOK_TIMEOUT = parseInt(process.env.WEBHOOK_TIMEOUT || "10000");
const DLQ_TTL = parseInt(process.env.DLQ_TTL_DAYS || "7") * 24 * 60 * 60;

// Advanced retry configuration
const ENABLE_JITTER = process.env.ENABLE_JITTER === "true";
const CIRCUIT_BREAKER_THRESHOLD = parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD || "5");
const CIRCUIT_BREAKER_TIMEOUT = parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT || "60000"); // 1 minute
const RATE_LIMIT_PER_MINUTE = parseInt(process.env.RATE_LIMIT_PER_MINUTE || "100");

// Circuit breaker state
const circuitBreakerState = new Map<string, {
  failures: number;
  lastFailure: number;
  state: 'closed' | 'open' | 'half-open';
}>();

// Webhook job schema
const webhookJobSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  body: z.string(),
  attempts: z.number().default(0),
  lastError: z.string().optional(),
  createdAt: z.string().optional(),
  scheduledFor: z.number().optional(),
  hmacSecret: z.string().optional(),
});

type WebhookJob = z.infer<typeof webhookJobSchema>;

// HMAC signature generation
function generateSignature(body: string, secret: string): string {
  const hash = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${hash}`;
}

// Verify HMAC signature
function verifySignature(body: string, signature: string, secret: string): boolean {
  const expected = generateSignature(body, secret);
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// Circuit breaker functions
function getCircuitBreakerState(url: string): 'closed' | 'open' | 'half-open' {
  const state = circuitBreakerState.get(url);
  if (!state) return 'closed';

  if (state.state === 'open') {
    if (Date.now() - state.lastFailure > CIRCUIT_BREAKER_TIMEOUT) {
      state.state = 'half-open';
      return 'half-open';
    }
    return 'open';
  }

  return state.state;
}

function recordCircuitBreakerFailure(url: string): void {
  const state = circuitBreakerState.get(url) || { failures: 0, lastFailure: 0, state: 'closed' as const };

  state.failures++;
  state.lastFailure = Date.now();

  if (state.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    state.state = 'open';
    structuredLogger.warn("Circuit breaker opened", { url, failures: state.failures });
  }

  circuitBreakerState.set(url, state);
}

function recordCircuitBreakerSuccess(url: string): void {
  const state = circuitBreakerState.get(url);
  if (state) {
    state.failures = 0;
    state.state = 'closed';
    circuitBreakerState.set(url, state);
  }
}

// Advanced retry with jitter
function calculateRetryDelay(attempt: number, baseDelay: number): number {
  let delay = baseDelay;

  if (ENABLE_JITTER) {
    // Add random jitter (±25%)
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    delay += jitter;
  }

  return Math.min(delay, 300000); // Max 5 minutes
}

// Rate limiting with size limits to prevent memory leaks
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const MAX_RATE_LIMIT_ENTRIES = 10000; // Limit map size

function checkRateLimit(url: string): boolean {
  const now = Date.now();
  const windowStart = now - 60000; // 1 minute window
  const key = `${url}:${Math.floor(now / 60000)}`; // Per-minute key

  // Clean up old entries periodically to prevent memory leaks
  if (rateLimitMap.size > MAX_RATE_LIMIT_ENTRIES) {
    for (const [k, v] of rateLimitMap.entries()) {
      if (now > v.resetTime) {
        rateLimitMap.delete(k);
      }
    }
  }

  const limit = rateLimitMap.get(key) || { count: 0, resetTime: windowStart + 60000 };

  if (now > limit.resetTime) {
    limit.count = 0;
    limit.resetTime = windowStart + 60000;
  }

  if (limit.count >= RATE_LIMIT_PER_MINUTE) {
    return false; // Rate limited
  }

  limit.count++;
  rateLimitMap.set(key, limit);
  return true;
}

// Webhook transformation
function transformWebhookPayload(payload: any, transformation?: any): any {
  if (!transformation) return payload;

  let transformed = { ...payload };

  // Apply field mappings
  if (transformation.mappings) {
    for (const [from, to] of Object.entries(transformation.mappings)) {
      if (transformed[from] !== undefined) {
        transformed[to as string] = transformed[from];
        delete transformed[from];
      }
    }
  }

  // Apply field filters
  if (transformation.filters) {
    for (const field of transformation.filters) {
      delete transformed[field];
    }
  }

  // Apply field additions
  if (transformation.additions) {
    transformed = { ...transformed, ...transformation.additions };
  }

  return transformed;
}

// Health check endpoint for ALB
app.get("/health", async (req, reply) => {
  return reply.code(200).send({ ok: true, service: "webhooks" });
});

const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });
const webhookCounters = new client.Counter({
  name: "webhooks_events_total",
  help: "Webhook service events",
  labelNames: ["event"],
});
registry.registerMetric(webhookCounters);

app.get("/metrics", async (req, reply) => {
  reply.header("content-type", registry.contentType);
  return await registry.metrics();
});

// Dispatch webhook endpoint
app.post("/dispatch", async (req, reply) => {
  const span = createSpan("webhook_dispatch");
  try {
    const { url, payload, headers = {}, hmacSecret, transformation, priority = 1 } = (req.body as any) || {};

    if (!url) {
      return reply.code(400).send({ code: "bad_request", message: "url required" });
    }

    // Check rate limit
    if (!checkRateLimit(url)) {
      customMetrics.incrementCounter("webhook_rate_limited");
      return reply.code(429).send({ code: "rate_limited", message: "Rate limit exceeded" });
    }

    // Check circuit breaker
    const circuitState = getCircuitBreakerState(url);
    if (circuitState === 'open') {
      customMetrics.incrementCounter("webhook_circuit_open");
      return reply.code(503).send({ code: "circuit_open", message: "Circuit breaker is open" });
    }

    // Transform payload if transformation is provided
    let processedPayload = payload;
    if (transformation) {
      processedPayload = transformWebhookPayload(payload, transformation);
    }

    // Redact PII from payload
    const sanitizedPayload = piiRedactor.redact(processedPayload);
    const body = JSON.stringify(sanitizedPayload ?? {});
    const signature = generateSignature(body, hmacSecret || WEBHOOK_SECRET);

    const job: WebhookJob = {
      id: crypto.randomUUID(),
      url,
      body,
      headers: {
        "content-type": "application/json",
        "x-webhook-signature": signature,
        "x-webhook-timestamp": Date.now().toString(),
        "x-webhook-id": crypto.randomUUID(),
        "x-webhook-priority": priority.toString(),
        ...headers,
      },
      attempts: 0,
      createdAt: new Date().toISOString(),
      hmacSecret: hmacSecret || WEBHOOK_SECRET,
    };

    // Use priority queue if priority > 1
    const queueName = priority > 1 ? `webhooks:priority:${priority}` : "webhooks:queue";
    if (redis) {
      await redis.lpush(queueName, JSON.stringify(job));
    } else {
      structuredLogger.warn("Redis not available, webhook not queued", { jobId: job.id });
      return reply.code(503).send({ code: "service_unavailable", message: "Redis not available" });
    }

    try { webhookCounters.inc({ event: "queued" }); } catch {}
    structuredLogger.info("Webhook queued", { jobId: job.id, url, priority });

    return { ok: true, queued: true, jobId: job.id, priority };
  } catch (err) {
    recordException(err as Error, span);
    const e = err as any;
    structuredLogger.error("Failed to dispatch webhook", e instanceof Error ? e : new Error(String(e?.message || e)));
    return reply.code(500).send({ code: "internal_error" });
  } finally {
    span.end();
  }
});

// Batch dispatch endpoint
app.post("/dispatch/batch", async (req, reply) => {
  const { webhooks } = (req.body as any) || {};
  
  if (!Array.isArray(webhooks)) {
    return reply.code(400).send({ code: "bad_request", message: "webhooks array required" });
  }
  
  const jobs: WebhookJob[] = [];
  
  for (const webhook of webhooks) {
    const { url, payload, headers = {}, hmacSecret } = webhook;
    
    if (!url) continue;
    
    const body = JSON.stringify(payload ?? {});
    const signature = generateSignature(body, hmacSecret || WEBHOOK_SECRET);
    
    const job: WebhookJob = {
      id: crypto.randomUUID(),
      url,
      body,
      headers: {
        "content-type": "application/json",
        "x-webhook-signature": signature,
        "x-webhook-timestamp": Date.now().toString(),
        "x-webhook-id": crypto.randomUUID(),
        ...headers,
      },
      attempts: 0,
      createdAt: new Date().toISOString(),
      hmacSecret: hmacSecret || WEBHOOK_SECRET,
    };
    
    jobs.push(job);
  }
  
  if (jobs.length > 0 && redis) {
    const pipeline = redis.pipeline();
    for (const job of jobs) {
      pipeline.lpush("webhooks:queue", JSON.stringify(job));
    }
    await pipeline.exec();
  } else if (jobs.length > 0 && !redis) {
    structuredLogger.warn("Redis not available, batch webhooks not queued");
    return reply.code(503).send({ code: "service_unavailable", message: "Redis not available" });
  }
  
  app.log.info({ count: jobs.length }, "Batch webhooks queued");
  
  return { ok: true, queued: jobs.length, jobIds: jobs.map(j => j.id) };
});

// Verify webhook signature endpoint (for testing)
app.post("/verify", async (req, reply) => {
  const { payload, signature, secret } = (req.body as any) || {};
  
  if (!payload || !signature) {
    return reply.code(400).send({ code: "bad_request", message: "payload and signature required" });
  }
  
  const body = JSON.stringify(payload);
  const isValid = verifySignature(body, signature, secret || WEBHOOK_SECRET);
  const expectedSignature = generateSignature(body, secret || WEBHOOK_SECRET);
  
  return { 
    valid: isValid, 
    expectedSignature,
    providedSignature: signature,
  };
});

// Get DLQ stats
app.get("/dlq/stats", async (req, reply) => {
  if (!redis) {
    return reply.code(503).send({ code: "service_unavailable", message: "Redis not available" });
  }

  const dlqLength = await redis.llen("webhooks:dlq");
  const retryQueueLength = await redis.llen("webhooks:retry");
  const mainQueueLength = await redis.llen("webhooks:queue");

  return {
    dlq: dlqLength,
    retry: retryQueueLength,
    main: mainQueueLength,
    total: dlqLength + retryQueueLength + mainQueueLength,
  };
});

// Get DLQ items
app.get("/dlq/items", async (req, reply) => {
  if (!redis) {
    return reply.code(503).send({ code: "service_unavailable", message: "Redis not available" });
  }

  const limit = parseInt((req.query as any).limit || "10");
  const items = await redis.lrange("webhooks:dlq", 0, limit - 1);

  return {
    items: items.map(item => {
      try {
        return JSON.parse(item);
      } catch {
        return item;
      }
    }),
    total: await redis.llen("webhooks:dlq"),
  };
});

// Retry DLQ item
app.post("/dlq/retry/:id", async (req, reply) => {
  if (!redis) {
    return reply.code(503).send({ code: "service_unavailable", message: "Redis not available" });
  }

  const { id } = req.params as any;

  // Find and remove from DLQ
  const items = await redis.lrange("webhooks:dlq", 0, -1);
  let found: WebhookJob | null = null;

  for (const item of items) {
    try {
      const job = JSON.parse(item);
      if (job.id === id) {
        found = job;
        await redis.lrem("webhooks:dlq", 1, item);
        break;
      }
    } catch {}
  }

  if (!found) {
    return reply.code(404).send({ code: "not_found" });
  }

  // Reset attempts and requeue
  found.attempts = 0;
  delete found.lastError;
  await redis.lpush("webhooks:queue", JSON.stringify(found));

  return { ok: true, requeued: true, jobId: found.id };
});

// Clear DLQ
app.delete("/dlq/clear", async (req, reply) => {
  if (!redis) {
    return reply.code(503).send({ code: "service_unavailable", message: "Redis not available" });
  }

  const count = await redis.llen("webhooks:dlq");
  await redis.del("webhooks:dlq");

  return { ok: true, cleared: count };
});

// Webhook worker process
async function webhookWorker() {
  structuredLogger.info("Webhook worker started");

  while (true) {
    const workerSpan = createSpan("webhook_worker_cycle");
    try {
      // Check if Redis is available
      if (!redis) {
        structuredLogger.warn("Redis not available, skipping webhook processing");
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
        continue;
      }

      // Check retry queue first
      const now = Date.now();
      const retryItems = await redis.zrangebyscore("webhooks:retry", "-inf", now, "LIMIT", 0, 10);
      
      for (const item of retryItems) {
        await redis.zrem("webhooks:retry", item);
        await redis.lpush("webhooks:queue", item);
      }
      
      // Process priority queues first (highest priority first)
      let result = null;
      const priorityQueues = ["webhooks:priority:5", "webhooks:priority:4", "webhooks:priority:3", "webhooks:priority:2"];

      for (const queue of priorityQueues) {
        result = await redis.brpop(queue, 1);
        if (result) break;
      }

      // If no priority jobs, process main queue
      if (!result) {
        result = await redis.brpop("webhooks:queue", 5);
        if (!result) {
          workerSpan.end();
          continue;
        }
      }

      const [, rawJob] = result;
      let job: WebhookJob;
      
      try {
        job = webhookJobSchema.parse(JSON.parse(rawJob));
      } catch (err) {
        const e = err as any;
        structuredLogger.error("Invalid webhook job", e instanceof Error ? e : new Error(String(e?.message || e)));
        await redis.lpush("webhooks:dlq", rawJob);
        customMetrics.incrementCounter("webhook_parse_errors");
        continue;
      }
      
      // Check circuit breaker before attempting delivery
      const circuitState = getCircuitBreakerState(job.url);
      if (circuitState === 'open') {
        structuredLogger.warn("Skipping webhook due to open circuit breaker", {
          jobId: job.id,
          url: job.url
        });
        await redis.lpush("webhooks:dlq", JSON.stringify(job));
        continue;
      }

      // Execute webhook
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT);

        const response = await fetch(job.url, {
          method: "POST",
          headers: job.headers,
          body: job.body,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          const responseText = await response.text().catch(() => "");
          throw new Error(`HTTP ${response.status}: ${response.statusText || "Unknown error"}${responseText ? ` - ${responseText.slice(0, 200)}` : ""}`);
        }

        // Record success for circuit breaker
        recordCircuitBreakerSuccess(job.url);

        structuredLogger.info("Webhook delivered successfully", {
          jobId: job.id,
          url: job.url,
          status: response.status,
          attempts: job.attempts + 1,
        });
        try { webhookCounters.inc({ event: "delivered" }); } catch {}
        customMetrics.recordHistogram("webhook_delivery_time_ms", Date.now() - parseInt(job.createdAt || "0"));

        // Store success metrics
        if (redis) await redis.hincrby("webhooks:metrics:success", new Date().toISOString().split("T")[0], 1);

      } catch (err: any) {
        // Record failure for circuit breaker
        recordCircuitBreakerFailure(job.url);

        job.attempts = (job.attempts || 0) + 1;
        job.lastError = err.message || "Unknown error";

        structuredLogger.warn("Webhook delivery failed", {
          jobId: job.id,
          url: job.url,
          attempts: job.attempts,
          error: job.lastError,
          circuitState: getCircuitBreakerState(job.url),
        });
        try { webhookCounters.inc({ event: "failed" }); } catch {}

        if (job.attempts < MAX_RETRIES && redis) {
          // Schedule retry with advanced backoff (including jitter)
          const baseDelay = RETRY_DELAYS[job.attempts - 1] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
          const delay = calculateRetryDelay(job.attempts, baseDelay);
          const retryAt = Date.now() + delay;
          job.scheduledFor = retryAt;

          await redis.zadd("webhooks:retry", retryAt, JSON.stringify(job));

          app.log.info({
            jobId: job.id,
            retryAt: new Date(retryAt).toISOString(),
            attempts: job.attempts,
            delayMs: delay,
          }, "Webhook scheduled for retry");

        } else {
          // Move to DLQ (only if Redis is available)
          if (redis) {
            await (redis as any).lpush("webhooks:dlq", JSON.stringify(job));
            await redis.expire(`webhooks:dlq`, DLQ_TTL);
          }

          app.log.error({
            jobId: job.id,
            url: job.url,
            attempts: job.attempts,
          }, "Webhook moved to DLQ after max retries");

          // Store failure metrics
          if (redis) await redis.hincrby("webhooks:metrics:dlq", new Date().toISOString().split("T")[0], 1);
        }

        // Store retry metrics
        if (redis) await redis.hincrby("webhooks:metrics:retries", new Date().toISOString().split("T")[0], 1);
      }
      
    } catch (err) {
      recordException(err as Error, workerSpan);
      const e = err as any;
      structuredLogger.error("Webhook worker error", e instanceof Error ? e : new Error(String(e?.message || e)));
      await new Promise(resolve => setTimeout(resolve, 1000));
    } finally {
      workerSpan.end();
    }
  }
}

// Start webhook worker (skip during tests)
if (!process.env.JEST_WORKER_ID && (process.env.NODE_ENV || "") !== "test") {
  webhookWorker().catch(err => {
    app.log.fatal({ err }, "Webhook worker crashed");
    process.exit(1);
  });
}

// Metrics endpoint
app.get("/metrics/summary", async (req, reply) => {
  if (!redis) {
    return reply.code(503).send({ code: "service_unavailable", message: "Redis not available" });
  }

  const [success, retries, dlqMetrics] = await Promise.all([
    redis.hgetall("webhooks:metrics:success"),
    redis.hgetall("webhooks:metrics:retries"),
    redis.hgetall("webhooks:metrics:dlq"),
  ]);

  const queueStats = await redis.eval(`
    local main = redis.call('llen', 'webhooks:queue')
    local retry = redis.call('llen', 'webhooks:retry')
    local dlq = redis.call('llen', 'webhooks:dlq')
    return {main, retry, dlq}
  `, 0) as number[];

  return {
    success,
    retries,
    dlq: dlqMetrics,
    queues: {
      main: queueStats[0] || 0,
      retry: queueStats[1] || 0,
      dlq: queueStats[2] || 0,
      total: (queueStats[0] || 0) + (queueStats[1] || 0) + (queueStats[2] || 0),
    },
  };
});

const PORT = Number(process.env.PORT || 8082);

// Close external resources on Fastify shutdown (parity with API/Realtime)
app.addHook("onClose", async () => {
  try { await (redis as any)?.quit?.(); } catch {}
  try { (redis as any)?.disconnect?.(); } catch {}
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  structuredLogger.info("SIGTERM received, shutting down gracefully");
  await app.close();
  try { await (redis as any)?.quit?.(); } catch {}
  try { (redis as any)?.disconnect?.(); } catch {}
  process.exit(0);
});

if (!process.env.JEST_WORKER_ID && (process.env.NODE_ENV || "") !== "test") {
  app.listen({ port: PORT, host: "0.0.0.0" }).then(() => {
    structuredLogger.info("Webhooks service started", { port: PORT });
    customMetrics.incrementCounter("service_starts", { service: "webhooks" });
  }).catch((err) => {
    const e = err as any;
    structuredLogger.error("Failed to start webhooks service", e instanceof Error ? e : new Error(String(e?.message || e)));
    process.exit(1);
  });
}
