import Fastify from "fastify";
import { z } from "zod";
import Redis from "ioredis";

const app = Fastify({ logger: true });
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

// Health
app.get("/health", async () => ({ ok: true }));

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
  const wsUrl = process.env.REALTIME_WS_URL || "ws://realtime:8081/v1/realtime";
  const url = `${wsUrl}/${callId}?agentId=${encodeURIComponent(agentId || "")}&codec=linear16&rate=16000`;
  const headers: Record<string, string> = {};
  if (process.env.REALTIME_API_KEY) headers["Sec-WebSocket-Protocol"] = process.env.REALTIME_API_KEY;

  // Jambonz application JSON
  return [
    {
      verb: "redirect",
      actionHook: `${process.env.PUBLIC_BASE_URL || "http://telephony:8085"}/status/${callId}`
    },
    {
      verb: "connect",
      // Support both possible schema keys for compatibility
      url,
      wsUrl: url,
      headers,
      earlyMedia: true,
      passDtmf: true
    }
  ];
}

// Incoming call webhook
app.post("/call", async (req, reply) => {
  const body = callHookSchema.safeParse((req as any).body);
  if (!body.success) {
    return reply.code(400).send({ error: "bad_request" });
  }
  const callId = body.data.call_sid || `c_${Math.random().toString(36).slice(2)}`;
  const agentId = (req.headers["x-agent-id"] as string) || undefined;
  const appJson = connectToRealtime(callId, agentId);
  return reply.send(appJson);
});

// Call status webhook
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

  req.log.info({ callId: id, status }, "jambonz status");
  return { ok: true };
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
    let conferenceApp;
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

// Get active calls
app.get("/calls/active", async (req, reply) => {
  try {
    // Get all call event streams
    const keys = await redis.keys("events:*");
    const activeCalls = [];
    
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
app.get("/health/detailed", async () => {
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
app.listen({ port: PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});


