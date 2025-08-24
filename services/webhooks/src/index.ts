import Fastify, { FastifyInstance } from "fastify";
import client from "prom-client";
import crypto from "node:crypto";
import Redis from "ioredis";
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

// Initialize observability
await initializeObservability({
  serviceName: "webhooks-service",
  environment: process.env.NODE_ENV || "development",
  langfuseEnabled: process.env.LANGFUSE_ENABLED === "true",
  langfusePublicKey: process.env.LANGFUSE_PUBLIC_KEY,
  langfuseSecretKey: process.env.LANGFUSE_SECRET_KEY,
  langfuseBaseUrl: process.env.LANGFUSE_BASE_URL,
});

const structuredLogger = new StructuredLogger("webhooks-service");
const piiRedactor = new PIIRedactor();

const app: FastifyInstance = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info",
    transport: {
      target: "pino-pretty",
      options: {
        translateTime: "HH:MM:ss Z",
        ignore: "pid,hostname",
      },
    },
  },
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

const redisUrl = await getSecret("REDIS_URL") || process.env.REDIS_URL || "redis://localhost:6379";
const redis = new Redis(redisUrl);

// Configuration
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "dev_webhook_secret";
const MAX_RETRIES = parseInt(process.env.MAX_WEBHOOK_RETRIES || "3");
const RETRY_DELAYS = [1000, 5000, 15000]; // Exponential backoff
const WEBHOOK_TIMEOUT = parseInt(process.env.WEBHOOK_TIMEOUT || "10000");
const DLQ_TTL = parseInt(process.env.DLQ_TTL_DAYS || "7") * 24 * 60 * 60;

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

// Health & Prometheus metrics
app.get("/health", async () => ({ ok: true, service: "webhooks" }));

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
    const { url, payload, headers = {}, hmacSecret } = (req.body as any) || {};
    
    if (!url) {
      return reply.code(400).send({ code: "bad_request", message: "url required" });
    }
    
    // Redact PII from payload
    const sanitizedPayload = piiRedactor.redact(payload);
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
        ...headers,
      },
      attempts: 0,
      createdAt: new Date().toISOString(),
      hmacSecret: hmacSecret || WEBHOOK_SECRET,
    };
    
    await redis.lpush("webhooks:queue", JSON.stringify(job));
    
    try { webhookCounters.inc({ event: "queued" }); } catch {}
    structuredLogger.info("Webhook queued", { jobId: job.id, url });
    
    return { ok: true, queued: true, jobId: job.id };
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
  
  if (jobs.length > 0) {
    const pipeline = redis.pipeline();
    for (const job of jobs) {
      pipeline.lpush("webhooks:queue", JSON.stringify(job));
    }
    await pipeline.exec();
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
app.get("/dlq/stats", async () => {
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
app.get("/dlq/items", async (req) => {
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
app.delete("/dlq/clear", async () => {
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
      // Check retry queue first
      const now = Date.now();
      const retryItems = await redis.zrangebyscore("webhooks:retry", "-inf", now, "LIMIT", 0, 10);
      
      for (const item of retryItems) {
        await redis.zrem("webhooks:retry", item);
        await redis.lpush("webhooks:queue", item);
      }
      
      // Process main queue
      const result = await redis.brpop("webhooks:queue", 5);
      if (!result) continue;
      
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
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        structuredLogger.info("Webhook delivered successfully", {
          jobId: job.id,
          url: job.url,
          status: response.status,
          attempts: job.attempts + 1,
        });
        try { webhookCounters.inc({ event: "delivered" }); } catch {}
        customMetrics.recordHistogram("webhook_delivery_time_ms", Date.now() - parseInt(job.createdAt || "0"));
        
        // Store success metrics
        await redis.hincrby("webhooks:metrics:success", new Date().toISOString().split("T")[0], 1);
        
      } catch (err: any) {
        job.attempts = (job.attempts || 0) + 1;
        job.lastError = err.message || "Unknown error";
        
        structuredLogger.warn("Webhook delivery failed", {
          jobId: job.id,
          url: job.url,
          attempts: job.attempts,
          error: job.lastError,
        });
        try { webhookCounters.inc({ event: "failed" }); } catch {}
        
        if (job.attempts < MAX_RETRIES) {
          // Schedule retry with exponential backoff
          const delay = RETRY_DELAYS[job.attempts - 1] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
          const retryAt = Date.now() + delay;
          job.scheduledFor = retryAt;
          
          await redis.zadd("webhooks:retry", retryAt, JSON.stringify(job));
          
          app.log.info({ 
            jobId: job.id, 
            retryAt: new Date(retryAt).toISOString(),
            attempts: job.attempts,
          }, "Webhook scheduled for retry");
          
        } else {
          // Move to DLQ
          await redis.lpush("webhooks:dlq", JSON.stringify(job));
          await redis.expire(`webhooks:dlq`, DLQ_TTL);
          
          app.log.error({ 
            jobId: job.id, 
            url: job.url,
            attempts: job.attempts,
          }, "Webhook moved to DLQ after max retries");
          
          // Store failure metrics
          await redis.hincrby("webhooks:metrics:dlq", new Date().toISOString().split("T")[0], 1);
        }
        
        // Store retry metrics
        await redis.hincrby("webhooks:metrics:retries", new Date().toISOString().split("T")[0], 1);
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

// Start webhook worker
webhookWorker().catch(err => {
  app.log.fatal({ err }, "Webhook worker crashed");
  process.exit(1);
});

// Metrics endpoint
app.get("/metrics", async () => {
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

// Graceful shutdown
process.on("SIGTERM", async () => {
  structuredLogger.info("SIGTERM received, shutting down gracefully");
  await app.close();
  redis.disconnect();
  process.exit(0);
});

app.listen({ port: PORT, host: "0.0.0.0" }).then(() => {
  structuredLogger.info("Webhooks service started", { port: PORT });
  customMetrics.incrementCounter("service_starts", { service: "webhooks" });
}).catch((err) => {
  const e = err as any;
  structuredLogger.error("Failed to start webhooks service", e instanceof Error ? e : new Error(String(e?.message || e)));
  process.exit(1);
});
