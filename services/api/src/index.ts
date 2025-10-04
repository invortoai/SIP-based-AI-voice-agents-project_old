import dotenv from 'dotenv';

// Load environment variables from .env file at the very beginning
dotenv.config();

/*  */import Fastify, { FastifyInstance } from "fastify";
import { createClient } from '@supabase/supabase-js';
import { z } from "zod";
import Redis from "ioredis";
import type { Redis as RedisType } from "ioredis";
import { s3Artifacts } from "./s3-helpers.js";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import client from "prom-client";
import fastifyCors from "@fastify/cors";
import fastifyMultipart from "@fastify/multipart";

// Import our new tool systems
import { setupDocumentTools } from "./document-tools.js";
import { setupCalendarTools } from "./calendar-tools.js";
import { setupToolManager } from "./tool-manager.js";

export const app: FastifyInstance = Fastify({ logger: true });


app.register(fastifyCors, {
  // Compute from env at request time to respect test-set PUBLIC_BASE_URL
  origin: (origin, cb) => {
    try {
      const b = process.env.PUBLIC_BASE_URL || "";
      const allow = b ? new URL(b).origin : true;
      cb(null, allow as any);
    } catch {
      cb(null, true as any);
    }
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  credentials: false,
});

// Register multipart for file uploads
app.register(fastifyMultipart, {
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  }
});

// Setup our tool systems
setupDocumentTools(app);
setupCalendarTools(app);
setupToolManager(app);

// Force Access-Control-Allow-Origin deterministically to PUBLIC_BASE_URL for health/simple requests (test-friendly)
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
// Resolve secrets from AWS Secrets Manager if configured
async function resolveSecret(name?: string) {
  if (!name) return undefined;
  try {
    const client = new SecretsManagerClient({});
    const res = await client.send(new GetSecretValueCommand({ SecretId: name }));
    return res.SecretString || undefined;
  } catch {
    return undefined;
  }
}

let supabase: any;
let dbReady = false;
let redis!: RedisType;

// Initialize external deps before server starts listening
app.addHook("onReady", async () => {
  const supabaseUrl = process.env.SUPABASE_URL;
   const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  const redisUrlEnv = (await resolveSecret(process.env.AWS_SECRETS_REDIS_URL)) || process.env.REDIS_URL || "redis://localhost:6379";

  // In test runs, avoid opening real DB connections
  if (process.env.JEST_WORKER_ID || (process.env.NODE_ENV || "") === "test") {
    try {
      redis = new (Redis as any)(redisUrlEnv);
    } catch (err) {
      app.log.error({ err }, "redis init failed");
    }
    // Provide a lightweight Supabase stub
    supabase = {
      from: () => ({
        select: () => ({ eq: () => ({ single: () => ({ data: null, error: null }) }) }),
        insert: () => ({ select: () => ({ single: () => ({ data: null, error: null }) }) }),
        update: () => ({ eq: () => ({ returning: () => ({ data: null, error: null }) }) }),
        delete: () => ({ eq: () => ({ data: null, error: null }) })
      })
    };
    dbReady = false;
    return;
  }

  if (supabaseUrl && supabaseServiceKey) {
    try {
      supabase = createClient(supabaseUrl, supabaseServiceKey);
      // Test connection with timeout
      await Promise.race([
        supabase.from('calls').select('count').limit(1),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Supabase connection timeout")), 5000)
        )
      ]);
      dbReady = true;
    } catch (err) {
      app.log.error({ err }, "supabase connect failed");
      // Fallback to stub to keep server responsive
      supabase = {
        from: () => ({
          select: () => ({ eq: () => ({ single: () => ({ data: null, error: null }) }) }),
          insert: () => ({ select: () => ({ single: () => ({ data: null, error: null }) }) }),
          update: () => ({ eq: () => ({ returning: () => ({ data: null, error: null }) }) }),
          delete: () => ({ eq: () => ({ data: null, error: null }) })
        })
      };
      dbReady = false;
    }
  } else {
    app.log.warn("Supabase credentials not found, running in stub mode");
    supabase = {
      from: () => ({
        select: () => ({ eq: () => ({ single: () => ({ data: null, error: null }) }) }),
        insert: () => ({ select: () => ({ single: () => ({ data: null, error: null }) }) }),
        update: () => ({ eq: () => ({ returning: () => ({ data: null, error: null }) }) }),
        delete: () => ({ eq: () => ({ data: null, error: null }) })
      })
    };
    dbReady = false;
  }

  try {
    redis = new (Redis as any)(redisUrlEnv);
  } catch (err) {
    app.log.error({ err }, "redis init failed");
  }
});

// Close external resources on app shutdown (tests and runtime)
app.addHook("onClose", async () => {
  // Supabase doesn't need explicit closing
  // Prefer graceful quit; fall back to disconnect for ioredis
  try { await (redis as any)?.quit?.(); } catch {}
  try { (redis as any)?.disconnect?.(); } catch {}
});

// Set tenant context for RLS (Supabase handles this automatically with auth)
app.addHook("onRequest", async (req) => {
  // Supabase RLS policies handle tenant isolation
  // No manual session tagging needed
});

app.get("/health", async () => ({ ok: true }));
// --- Simple security middleware: IP allowlist + shared secret + PII redaction ---
function redactPIIString(s: string): string {
  return s
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/(\+?\d[\d\s\-()]{7,})/g, "[redacted-phone]")
    .replace(/\b\d{4}\s?\d{4}\s?\d{4}\b/g, "[redacted-aadhaar]")
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, "[redacted-pan]");
}
function redactObject<T>(obj: T): T {
  try {
    if (obj == null) return obj;
    if (typeof obj === "string") return redactPIIString(obj) as unknown as T;
    if (Array.isArray(obj)) return obj.map((v) => redactObject(v)) as unknown as T;
    if (typeof obj === "object") {
      const out: any = Array.isArray(obj) ? [] : {};
      for (const [k, v] of Object.entries(obj as any)) {
        const key = k.toLowerCase();
        if (["email", "phone", "mobile", "aadhaar", "pan", "ssn", "card", "credit", "token"].some((x) => key.includes(x))) {
          out[k] = "[redacted]";
        } else if (typeof v === "string") {
          out[k] = redactPIIString(v);
        } else {
          out[k] = redactObject(v);
        }
      }
      return out as T;
    }
    return obj;
  } catch {
    return obj;
  }
}

app.addHook("onRequest", async (req, reply) => {
  const allowed = (process.env.API_ALLOWED_IPS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.length > 0 && !allowed.includes(req.ip)) {
    req.log.warn({ ip: req.ip }, "blocked ip");
    return reply.code(403).send({ code: "forbidden" });
  }
  const shared = process.env.API_SHARED_SECRET;
  if (shared) {
    const token = (req.headers["x-internal-token"] || "").toString();
    if (token !== shared) {
      return reply.code(401).send({ code: "unauthorized" });
    }
  }
  // Sanitize incoming payloads
  (req as any).body = redactObject((req as any).body);
  (req as any).query = redactObject((req as any).query);
  (req as any).params = redactObject((req as any).params);
});

// Prometheus metrics endpoint
const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });
const httpRequests = new client.Counter({
  name: "http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "path", "status"],
});
registry.registerMetric(httpRequests);

app.addHook("onResponse", async (req, reply) => {
  try {
    httpRequests.inc({ method: req.method, path: req.routerPath || req.url, status: String(reply.statusCode) });
  } catch {}
});

app.get("/metrics", async (req, reply) => {
  reply.header("content-type", registry.contentType);
  return await registry.metrics();
});

const createAgentSchema = z.object({
  name: z.string(),
  config: z.record(z.any()),
});

app.post("/v1/agents", async (req, reply) => {
  const parsed = createAgentSchema.safeParse((req as any).body);
  if (!parsed.success) {
    return reply.code(400).send({ code: "bad_request", error: parsed.error.flatten() });
  }
  const id = `a_${Math.random().toString(36).slice(2)}`;
  try {
    const { error } = await supabase
      .from('agents')
      .insert({
        id,
        tenant_id: "t_demo",
        name: parsed.data.name,
        config: parsed.data.config
      });

    if (error) throw error;
  } catch (err) {
    app.log.error({ err }, "insert agent failed");
    return reply.code(500).send({ code: "internal_error" });
  }
  return { id, version: 1 };
});

const createCallSchema = z.object({
  agentId: z.string(),
  to: z.string(),
  from: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

app.post("/v1/calls", async (req, reply) => {
  const parsed = createCallSchema.safeParse((req as any).body);
  if (!parsed.success) {
    return reply.code(400).send({ code: "bad_request", error: parsed.error.flatten() });
  }

  // Check tenant caps
  const tenantId = (req.headers["x-tenant-id"] || "t_demo").toString();

  // Check concurrent calls limit
  const { data: concurrentCalls, error: concurrentError } = await supabase
    .from('calls')
    .select('id', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .in('status', ['created', 'active'])
    .gte('started_at', new Date(Date.now() - 60 * 60 * 1000).toISOString()); // Last hour

  if (concurrentError) {
    app.log.error({ concurrentError }, "concurrent calls check failed");
    return reply.code(500).send({ code: "internal_error" });
  }

  const callCount = concurrentCalls?.length || 0;
  const maxConcurrent = parseInt(process.env.MAX_CONCURRENT_CALLS || "10");

  if (callCount >= maxConcurrent) {
    return reply.code(429).send({
      code: "rate_limit_exceeded",
      message: "Maximum concurrent calls reached"
    });
  }

  // Check daily usage cap
  const { data: dailyUsage, error: dailyError } = await supabase
    .from('call_costs')
    .select('cost_inr')
    .eq('tenant_id', tenantId)
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()); // Last 24 hours

  if (dailyError) {
    app.log.error({ dailyError }, "daily usage check failed");
    return reply.code(500).send({ code: "internal_error" });
  }

  const dailyTotal = dailyUsage?.reduce((sum: number, cost: any) => sum + (cost.cost_inr || 0), 0) || 0;
  const dailyCap = parseFloat(process.env.DAILY_COST_CAP_INR || "10000");

  if (dailyTotal >= dailyCap) {
    return reply.code(429).send({
      code: "usage_cap_exceeded",
      message: "Daily usage cap exceeded"
    });
  }

  const id = `c_${Math.random().toString(36).slice(2)}`;
  try {
    const { error: insertError } = await supabase
      .from('calls')
      .insert({
        id,
        tenant_id: tenantId,
        agent_id: parsed.data.agentId,
        direction: "outbound",
        from_num: parsed.data.from || "system",
        to_num: parsed.data.to,
        status: "created",
        started_at: new Date().toISOString()
      });

    if (insertError) throw insertError;

    // Store metadata if provided
    if (parsed.data.metadata) {
      await redis.hset(`call:${id}:metadata`, parsed.data.metadata);
    }
  } catch (err) {
    app.log.error({ err }, "insert call failed");
    return reply.code(500).send({ code: "internal_error" });
  }
  
    // If outbound dialing is enabled, request Jambonz to originate a call
    const jambonzUrl = process.env.JAMBONZ_OUTCALL_URL; // e.g., https://<jambonz>/v1/Accounts/<sid>/Calls
    const jambonzToken = process.env.JAMBONZ_TOKEN;     // Basic or Bearer depending on setup
    const telephonyHook = process.env.TELEPHONY_CALL_HOOK || "http://telephony:8085/call";
    if (jambonzUrl && jambonzToken) {
      try {
        const jb = await fetch(jambonzUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "authorization": jambonzToken,
          },
          body: JSON.stringify({
            from: parsed.data.from || "sbc",
            to: parsed.data.to,
            application_sid: process.env.JAMBONZ_APP_SID,
            call_hook: { url: telephonyHook, method: "POST" },
            call_status_hook: { url: `${telephonyHook.replace(/\/call$/, "")}/status/${id}`, method: "POST" },
            timeout: 30,
          }),
        });
        if (!jb.ok) {
          app.log.warn({ status: jb.status }, "jambonz originate failed");
        }
      } catch (err) {
        app.log.warn({ err }, "jambonz originate error");
      }
    }

  return { id, status: jambonzUrl ? "dialing" : "created" };
});

app.get("/v1/calls/:id/timeline", async (req, reply) => {
  const { id } = (req.params as any) as { id: string };
  try {
    const entries = await redis.xrange(`events:${id}`, "-", "+", "COUNT", 500);
    const timeline = (entries as Array<[string, string[]]>).map(([, fields]) => {
      const rec: Record<string, string> = {} as any;
      for (let i = 0; i < fields.length; i += 2) rec[String(fields[i])] = String(fields[i + 1]);
      return { kind: rec.kind, payload: safeJson(rec.payload) };
    });
    return { callId: id, timeline };
  } catch (err) {
    app.log.error({ err }, "timeline error");
    return reply.code(500).send({ code: "error" });
  }
});

// Get signed URLs for artifacts
app.get("/v1/calls/:id/artifacts", async (req, reply) => {
  const { id } = (req.params as any) as { id: string };
  
  try {
    const artifacts = await s3Artifacts.getCallArtifacts(id);
    return artifacts;
  } catch (err) {
    app.log.error({ err }, "Failed to get artifacts");
    return reply.code(500).send({ code: "internal_error" });
  }
});

// Upload call recording
app.post("/v1/calls/:id/recording", async (req, reply) => {
  const { id } = (req.params as any) as { id: string };
  const body = (req as any).body;
  
  if (!body || !Buffer.isBuffer(body)) {
    return reply.code(400).send({ code: "bad_request", message: "Body must be audio data" });
  }
  
  try {
    const s3Path = await s3Artifacts.uploadRecording(id, body);
    
    // Update call record using Supabase
    const { error } = await supabase
      .from('calls')
      .update({
        status: 'completed',
        ended_at: new Date().toISOString()
      })
      .eq('id', id);

    if (error) throw error;
    
    return { success: true, path: s3Path };
  } catch (err) {
    app.log.error({ err }, "Failed to upload recording");
    return reply.code(500).send({ code: "internal_error" });
  }
});

// Get call details with costs
app.get("/v1/calls/:id", async (req, reply) => {
  const { id } = (req.params as any) as { id: string };

  try {
    const { data: call, error: callError } = await supabase
      .from('calls')
      .select('*')
      .eq('id', id)
      .single();

    if (callError || !call) {
      return reply.code(404).send({ code: "not_found" });
    }

    // Get costs breakdown
    const { data: costs, error: costsError } = await supabase
      .from('call_costs')
      .select('*')
      .eq('call_id', id);

    if (costsError) {
      app.log.error({ costsError }, "Failed to get call costs");
    }

    // Get metadata from Redis
    const metadata = await redis.hgetall(`call:${id}:metadata`);

    return {
      ...call,
      costs: costs || [],
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    };
  } catch (err) {
    app.log.error({ err }, "Failed to get call details");
    return reply.code(500).send({ code: "internal_error" });
  }
});

// Submit call summary
app.post("/v1/calls/:id/summary", async (req, reply) => {
  const { id } = (req.params as any) as { id: string };
  const summary = (req as any).body;

  try {
    // Upload summary to S3
    const s3Path = await s3Artifacts.uploadSummary(id, summary);

    // Store summary in Supabase (optional - for tracking)
    const { error: summaryError } = await supabase
      .from('call_summaries')
      .insert({
        call_id: id,
        summary: summary,
        s3_path: s3Path,
        created_at: new Date().toISOString()
      });

    if (summaryError) {
      app.log.warn({ summaryError }, "Failed to store summary in database");
      // Don't fail the request if database storage fails
    }

    // Trigger summary webhook
    const tenantWebhook = process.env.TENANT_WEBHOOK_URL;
    if (tenantWebhook) {
      await redis.lpush(
        "webhooks:queue",
        JSON.stringify({
          id: `wh_${Date.now()}`,
          url: tenantWebhook,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "call.summary",
            callId: id,
            summary,
            artifactUrl: s3Path,
          }),
          attempts: 0,
        })
      );
    }

    return { success: true, path: s3Path };
  } catch (err) {
    app.log.error({ err }, "Failed to submit summary");
    return reply.code(500).send({ code: "internal_error" });
  }
});

// List all calls with pagination and filtering
app.get("/v1/calls", async (req, reply) => {
  const query = (req.query as any) as {
    page?: string;
    limit?: string;
    status?: string;
    agentId?: string;
    from?: string;
    to?: string;
    tenantId?: string;
  };

  const page = parseInt(query.page || "1");
  const limit = Math.min(parseInt(query.limit || "50"), 100);
  const offset = (page - 1) * limit;

  try {
    const tenantId = query.tenantId || (req.headers["x-tenant-id"] || "t_demo").toString();

    // Build query
    let supabaseQuery = supabase
      .from('calls')
      .select('*', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('started_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (query.status) {
      supabaseQuery = supabaseQuery.eq('status', query.status);
    }

    if (query.agentId) {
      supabaseQuery = supabaseQuery.eq('agent_id', query.agentId);
    }

    if (query.from) {
      supabaseQuery = supabaseQuery.gte('started_at', query.from);
    }

    if (query.to) {
      supabaseQuery = supabaseQuery.lte('started_at', query.to);
    }

    const { data: calls, error, count } = await supabaseQuery;

    if (error) throw error;

    return {
      calls: calls || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit),
      },
    };
  } catch (err) {
    app.log.error({ err }, "Failed to list calls");
    return reply.code(500).send({ code: "internal_error" });
  }
});

// Update call status
app.patch("/v1/calls/:id/status", async (req, reply) => {
  const { id } = (req.params as any) as { id: string };
  const { status, metadata } = (req.body as any) || {};

  if (!status) {
    return reply.code(400).send({ code: "bad_request", message: "status required" });
  }

  try {
    const { data: call, error } = await supabase
      .from('calls')
      .update({
        status,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error || !call) {
      return reply.code(404).send({ code: "not_found" });
    }

    // Update metadata if provided
    if (metadata) {
      await redis.hset(`call:${id}:metadata`, metadata);
    }

    // Publish status change to timeline
    await redis.xadd(
      `events:${id}`,
      "*",
      "kind",
      "call.status_changed",
      "payload",
      JSON.stringify({ status, metadata })
    );

    return { success: true, call };
  } catch (err) {
    app.log.error({ err }, "Failed to update call status");
    return reply.code(500).send({ code: "internal_error" });
  }
});

// Get agent details
app.get("/v1/agents/:id", async (req, reply) => {
  const { id } = (req.params as any) as { id: string };

  try {
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('*')
      .eq('id', id)
      .single();

    if (agentError || !agent) {
      return reply.code(404).send({ code: "not_found" });
    }

    // Get agent statistics
    const { data: calls, error: statsError } = await supabase
      .from('calls')
      .select('cost_inr')
      .eq('agent_id', id);

    if (statsError) {
      app.log.error({ statsError }, "Failed to get agent statistics");
    }

    const totalCalls = calls?.length || 0;
    const averageCost = totalCalls > 0
      ? (calls?.reduce((sum: number, call: any) => sum + (call.cost_inr || 0), 0) || 0) / totalCalls
      : 0;

    return {
      ...agent,
      stats: {
        totalCalls,
        averageCost,
      },
    };
  } catch (err) {
    app.log.error({ err }, "Failed to get agent details");
    return reply.code(500).send({ code: "internal_error" });
  }
});

// List all agents
app.get("/v1/agents", async (req, reply) => {
  const query = (req.query as any) as {
    page?: string;
    limit?: string;
    tenantId?: string;
  };
  
  const page = parseInt(query.page || "1");
  const limit = Math.min(parseInt(query.limit || "50"), 100);
  const offset = (page - 1) * limit;
  
  try {
    const tenantId = query.tenantId || (req.headers["x-tenant-id"] || "t_demo").toString();

    // Get agents with pagination and count
    const { data: agents, error, count } = await supabase
      .from('agents')
      .select('*', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return {
      agents: agents || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit),
      },
    };
  } catch (err) {
    app.log.error({ err }, "Failed to list agents");
    return reply.code(500).send({ code: "internal_error" });
  }
});

// Update agent configuration
app.patch("/v1/agents/:id", async (req, reply) => {
  const { id } = (req.params as any) as { id: string };
  const { name, config, status } = (req.body as any) || {};
  
  try {
    if (name === undefined && config === undefined && status === undefined) {
      return reply.code(400).send({ code: "bad_request", message: "No fields to update" });
    }

    const updateData: any = { updated_at: new Date().toISOString() };

    if (name !== undefined) updateData.name = name;
    if (config !== undefined) updateData.config = config;
    if (status !== undefined) updateData.status = status;

    const { data: agent, error } = await supabase
      .from('agents')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error || !agent) {
      return reply.code(404).send({ code: "not_found" });
    }

    return { success: true, agent };
  } catch (err) {
    app.log.error({ err }, "Failed to update agent");
    return reply.code(500).send({ code: "internal_error" });
  }
});

// Delete agent
app.delete("/v1/agents/:id", async (req, reply) => {
  const { id } = (req.params as any) as { id: string };
  
  try {
    // Check if agent has active calls
    const { data: activeCalls, error: activeError } = await supabase
      .from('calls')
      .select('id', { count: 'exact' })
      .eq('agent_id', id)
      .in('status', ['created', 'active']);

    if (activeError) throw activeError;

    const activeCount = activeCalls?.length || 0;
    if (activeCount > 0) {
      return reply.code(400).send({
        code: "agent_in_use",
        message: "Cannot delete agent with active calls",
        activeCalls: activeCount,
      });
    }

    const { data: deletedAgent, error: deleteError } = await supabase
      .from('agents')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (deleteError || !deletedAgent) {
      return reply.code(404).send({ code: "not_found" });
    }

    return { success: true, deleted: deletedAgent };
  } catch (err) {
    app.log.error({ err }, "Failed to delete agent");
    return reply.code(500).send({ code: "internal_error" });
  }
});

// Get tenant usage statistics
app.get("/v1/tenants/:id/usage", async (req, reply) => {
  const { id } = (req.params as any) as { id: string };
  const { period } = (req.query as any) as { period?: string };

  const periodMap: Record<string, number> = {
    "1h": 1 * 60 * 60 * 1000,      // 1 hour
    "24h": 24 * 60 * 60 * 1000,    // 24 hours
    "7d": 7 * 24 * 60 * 60 * 1000,  // 7 days
    "30d": 30 * 24 * 60 * 60 * 1000, // 30 days
    "1m": 30 * 24 * 60 * 60 * 1000,  // 1 month (approx)
  };

  const timeRangeMs = periodMap[period || "24h"] || 24 * 60 * 60 * 1000;
  const startDate = new Date(Date.now() - timeRangeMs).toISOString();

  try {
    // Get call statistics
    const { data: calls, error: callsError } = await supabase
      .from('calls')
      .select('status, cost_inr, started_at, ended_at')
      .eq('tenant_id', id)
      .gte('started_at', startDate);

    if (callsError) throw callsError;

    // Calculate call statistics
    const totalCalls = calls?.length || 0;
    const completedCalls = calls?.filter((c: any) => c.status === 'completed').length || 0;
    const failedCalls = calls?.filter((c: any) => c.status === 'failed').length || 0;
    const totalCost = calls?.reduce((sum: number, c: any) => sum + (c.cost_inr || 0), 0) || 0;
    const averageCost = totalCalls > 0 ? totalCost / totalCalls : 0;

    // Calculate average duration for completed calls
    const completedCallsWithDuration = calls?.filter((c: any) =>
      c.status === 'completed' && c.started_at && c.ended_at
    ) || [];

    const averageDuration = completedCallsWithDuration.length > 0
      ? completedCallsWithDuration.reduce((sum: number, c: any) => {
          const duration = new Date(c.ended_at!).getTime() - new Date(c.started_at!).getTime();
          return sum + (duration / 1000); // Convert to seconds
        }, 0) / completedCallsWithDuration.length
      : 0;

    // Get agent statistics
    const { data: agents, error: agentsError } = await supabase
      .from('agents')
      .select('status')
      .eq('tenant_id', id);

    if (agentsError) throw agentsError;

    const totalAgents = agents?.length || 0;
    const activeAgents = agents?.filter((a: any) => a.status === 'active').length || 0;

    return {
      tenantId: id,
      period,
      timeRange: `${timeRangeMs / (1000 * 60 * 60)} hours`,
      calls: {
        total: totalCalls,
        completed: completedCalls,
        failed: failedCalls,
        averageCost,
        totalCost,
        averageDuration,
      },
      agents: {
        total: totalAgents,
        active: activeAgents,
      },
    };
  } catch (err) {
    app.log.error({ err }, "Failed to get tenant usage");
    return reply.code(500).send({ code: "internal_error" });
  }
});

// Health check with database connectivity
app.get("/health/detailed", async () => {
  try {
    // Check Supabase connectivity
    if (dbReady && supabase) {
      const { error } = await supabase.from('calls').select('count').limit(1).single();
      if (error) throw error;
    }

    // Check Redis connectivity
    await redis.ping();

    return {
      ok: true,
      database: dbReady ? "connected" : "stub_mode",
      redis: "connected",
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    app.log.error({ err }, "Health check failed");
    return {
      ok: false,
      error: (err as Error).message,
      timestamp: new Date().toISOString(),
    };
  }
});

function safeJson(v?: string) {
  try { return v ? JSON.parse(v) : null; } catch { return v ?? null; }
}

const PORT = Number(process.env.API_PORT || 8080);

if (!process.env.JEST_WORKER_ID && (process.env.NODE_ENV || "") !== "test") {
  app.listen({ port: PORT, host: "0.0.0.0" }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}

