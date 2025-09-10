import Fastify, { FastifyInstance } from "fastify";
import client from "prom-client";
import websocket from "@fastify/websocket";
import fastifyJwt from "@fastify/jwt";
import { WebSocket, RawData } from "ws";
import { AgentRuntime } from "./runtime/agent";
import { TimelinePublisher } from "./timeline/redis";
import Redis from "ioredis";
import { JitterBuffer } from "./runtime/jitterBuffer";
import { EnergyMeter } from "./runtime/energyMeter";
import { WsInbound, WsOutbound } from "@invorto/shared";
// simplified runtime: remove external observability/security dependencies

// observability removed for lean build

const PORT = Number(process.env.PORT || 8081);

const app: FastifyInstance = Fastify({ logger: true });
await app.register(websocket);
await app.register(fastifyJwt, {
  secret: {
    public: (process.env.JWT_PUBLIC_KEY || "").replace(/\\n/g, "\n"),
  },
  decode: { complete: true },
});

app.get("/health", async () => ({ ok: true }));

// Prometheus metrics
const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });
const wsCounters = new client.Counter({
  name: "realtime_ws_events_total",
  help: "Realtime WS events",
  labelNames: ["event"],
});
registry.registerMetric(wsCounters);

app.get("/metrics", async (req, reply) => {
  reply.header("content-type", registry.contentType);
  return await registry.metrics();
});

// Helper functions for connection management
function checkConnectionLimit(callId: string): boolean {
  const connectionsForCall = Array.from(activeConnections.values())
    .filter(conn => conn.socket.readyState === WebSocket.OPEN)
    .length;

  return connectionsForCall < MAX_CONNECTIONS_PER_CALL;
}

function checkRateLimit(callId: string): boolean {
  const now = Date.now();
  const clientKey = callId;
  const clientData = messageCounts.get(clientKey);

  if (!clientData) {
    messageCounts.set(clientKey, { count: 1, resetTime: now + 60000 }); // 1 minute
    return true;
  }

  if (now > clientData.resetTime) {
    messageCounts.set(clientKey, { count: 1, resetTime: now + 60000 });
    return true;
  }

  if (clientData.count >= MESSAGE_RATE_LIMIT) {
    return false;
  }

  clientData.count++;
  return true;
}

function validateMessage(msg: any): { valid: boolean; error?: string } {
  if (!msg || typeof msg !== 'object') {
    return { valid: false, error: 'Invalid message format' };
  }

  if (!msg.t || typeof msg.t !== 'string') {
    return { valid: false, error: 'Missing or invalid message type' };
  }

  // Validate specific message types
  switch (msg.t) {
    case 'start':
      if (!msg.agentId || typeof msg.agentId !== 'string') {
        return { valid: false, error: 'Invalid agentId for start message' };
      }
      break;
    case 'dtmf.send':
      if (!msg.digits || typeof msg.digits !== 'string') {
        return { valid: false, error: 'Invalid digits for DTMF message' };
      }
      break;
    case 'transfer':
      if (!msg.to || typeof msg.to !== 'string') {
        return { valid: false, error: 'Invalid destination for transfer message' };
      }
      break;
    case 'config':
      if (!msg.config || typeof msg.config !== 'object') {
        return { valid: false, error: 'Invalid config for config message' };
      }
      break;
  }

  return { valid: true };
}

function cleanupInactiveConnections(): void {
  const now = Date.now();
  for (const [callId, connection] of activeConnections.entries()) {
    if (now - connection.lastActivity > CONNECTION_TIMEOUT) {
      try {
        connection.socket.close(4000, 'Connection timeout');
      } catch (error) {
        app.log.warn({ callId, error }, 'Error closing timed out connection');
      }
      activeConnections.delete(callId);
    }
  }
}

// Periodic cleanup of inactive connections
setInterval(cleanupInactiveConnections, 30000); // Every 30 seconds

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const timeline = new TimelinePublisher(redisUrl);
const webhookQ = new Redis(redisUrl);

// Connection tracking for monitoring and limits
const activeConnections = new Map<string, { socket: WebSocket; connectedAt: number; lastActivity: number }>();
const MAX_CONNECTIONS_PER_CALL = parseInt(process.env.MAX_CONNECTIONS_PER_CALL || "5");
const CONNECTION_TIMEOUT = parseInt(process.env.CONNECTION_TIMEOUT || "300000"); // 5 minutes
const MESSAGE_RATE_LIMIT = parseInt(process.env.MESSAGE_RATE_LIMIT || "100"); // messages per minute
const messageCounts = new Map<string, { count: number; resetTime: number }>();

app.get("/v1/realtime/:callId", { websocket: true }, (socket: WebSocket, req) => {
  const { callId } = (req.params as any) as { callId: string };

  // Check connection limits
  if (!checkConnectionLimit(callId)) {
    socket.close(4001, "connection_limit_exceeded");
    return;
  }

  // optional IP allowlist could be added here if needed

  // Simple auth: expect API key or JWT in Sec-WebSocket-Protocol header (subprotocols)
  const authHeader = (req.headers["sec-websocket-protocol"] || "").toString();
  const bearer = (req.headers["authorization"] || "").toString();
  if (!authHeader && !bearer) {
    socket.close(4001, "invalid_api_key");
    return;
  }
  
  // If a Bearer token is present, verify it
  if (bearer?.toLowerCase().startsWith("bearer ")) {
    const token = bearer.slice(7).trim();
    try {
      app.jwt.verify(token);
    } catch {
      socket.close(4001, "invalid_token");
      return;
    }
  }
  
  // Track connection
  activeConnections.set(callId, {
    socket,
    connectedAt: Date.now(),
    lastActivity: Date.now()
  });

  app.log.info({ callId }, "ws connected");
  try { wsCounters.inc({ event: "connect" }); } catch {}

  const originalSend = (msg: WsOutbound) => socket.send(JSON.stringify(msg));
  const sendAndMirror = (msg: WsOutbound) => {
    originalSend(msg);
    const tenantWebhook = process.env.TENANT_WEBHOOK_URL;
    if (!tenantWebhook) return;
    const type = msg.t;
    if (type === "stt.final" || type === "tool.call") {
      (async () => {
        try {
          await webhookQ.lpush(
            "webhooks:queue",
            JSON.stringify({
              id: `wh_${Date.now()}`,
              url: tenantWebhook,
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ type, callId, payload: msg }),
              attempts: 0,
            })
          );
        } catch {}
      })();
    }
  };

  const runtime = new AgentRuntime(
    {
      asrApiKey: process.env.DEEPGRAM_API_KEY || "",
      openaiApiKey: process.env.OPENAI_API_KEY || "",
      ttsApiKey: process.env.DEEPGRAM_API_KEY || "",
      endpointing: { provider: "invorto", silenceMs: 220, minWords: 2 },
    },
    (msg) => sendAndMirror(msg),
    callId,
    timeline
  );
  runtime.start().catch((err) => app.log.error({ err }, "runtime start error"));
  timeline.publish(callId, "call.started", { at: Date.now() }).catch(() => {});
  const tenantWebhook = process.env.TENANT_WEBHOOK_URL;
  if (tenantWebhook) {
    (async () => {
      try {
        await webhookQ.lpush(
          "webhooks:queue",
          JSON.stringify({
            id: `wh_${Date.now()}`,
            url: tenantWebhook,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ type: "call.started", callId, startedAt: new Date().toISOString() }),
            attempts: 0,
          })
        );
      } catch {}
    })();
  }

  const jb = new JitterBuffer({ targetMs: 40, sampleRate: 16000, channels: 1, frameMs: 20 });
  const thresholdDb = parseFloat(process.env.EMOTION_THRESHOLD_DB || "-50");
  const intervalMs = parseInt(process.env.EMOTION_WINDOW_MS || "250");
  const minHold = parseInt(process.env.EMOTION_MIN_HOLD || "2");
  const energy = new EnergyMeter({ sampleRate: 16000, intervalMs, speakingThresholdDb: thresholdDb, minHoldWindows: minHold });
  energy.onWindow((w) => {
    const payload = { energy_db: Number(w.energyDb.toFixed(1)), speaking: w.speaking };
    timeline.publish(callId, "emotion.window", payload).catch(() => {});
    // Also emit over WS to client
    try {
      const msg: WsOutbound = { ...(payload as any), t: "emotion.window" } as any;
      // originalSend is wrapped by sendAndMirror; reuse it for consistency
      (sendAndMirror as any)(msg);
    } catch {}
    // Optional derived emotion.state (very simple energy-based)
    if ((process.env.EMOTION_STATE_ENABLED || "false").toLowerCase() === "true") {
      const cls = w.speaking && w.energyDb > thresholdDb + 10 ? "active" : "idle";
      const state = { t: "emotion.state", class: cls, arousal: Math.max(0, Math.min(1, (w.energyDb + 100) / 60)), valence: 0.5, confidence: 0.6 } as any;
      timeline.publish(callId, "emotion.state", state).catch(() => {});
      try { (sendAndMirror as any)(state); } catch {}
    }
  });
  energy.start();
  let silenceTimer: NodeJS.Timeout | null = null;
  const resetSilenceTimer = () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      runtime.endTurn().catch(() => {});
      timeline.publish(callId, "endpointing.silence", { at: Date.now() }).catch(() => {});
    }, 3000);
  };

  // sendAndMirror defined above

  socket.on("message", (raw: RawData) => {
    // Update last activity
    const connection = activeConnections.get(callId);
    if (connection) {
      connection.lastActivity = Date.now();
    }

    try {
      if (typeof raw === "string") {
        // Check rate limit
        if (!checkRateLimit(callId)) {
          socket.send(JSON.stringify({ t: "error", message: "Rate limit exceeded" }));
          return;
        }

        const msg = JSON.parse(raw) as WsInbound;

        // Validate message
        const validation = validateMessage(msg);
        if (!validation.valid) {
          socket.send(JSON.stringify({ t: "error", message: validation.error }));
          return;
        }
        if (msg.t === "start") {
          const ack: WsOutbound = { t: "stt.partial", text: "connected", ts: 0 };
          sendAndMirror(ack);
          timeline.publish(callId, "start", { agentId: (msg as any).agentId }).catch(() => {});
        } else if ((msg as any).t === "dtmf.send") {
          const m = msg as any;
          timeline.publish(callId, "dtmf.send", { digits: m.digits, method: m.method || "rfc2833" }).catch(() => {});
        } else if ((msg as any).t === "transfer") {
          const m = msg as any;
          timeline.publish(callId, "transfer", { to: m.to, mode: m.mode }).catch(() => {});
        } else if ((msg as any).t === "pause") {
          // Pause audio processing (stop energy meter)
          energy.stop();
          if (silenceTimer) clearTimeout(silenceTimer);
          timeline.publish(callId, "call.paused", { at: Date.now() }).catch(() => {});
        } else if ((msg as any).t === "resume") {
          // Resume audio processing (restart energy meter)
          energy.start();
          resetSilenceTimer();
          timeline.publish(callId, "call.resumed", { at: Date.now() }).catch(() => {});
        } else if ((msg as any).t === "config") {
          // Update runtime configuration
          const config = (msg as any).config;
          if (config) {
            runtime.updateConfig(config).catch((err) => {
              app.log.error({ err, callId }, "Failed to update runtime config");
            });
            timeline.publish(callId, "config.updated", { config, at: Date.now() }).catch(() => {});
          }
        } else if ((msg as any).t === "ping") {
          // Respond to ping with pong
          const pong: WsOutbound = { t: "pong", timestamp: Date.now() } as any;
          originalSend(pong);
        }
      } else if (raw instanceof Buffer) {
        // Generate sequence number and timestamp for jitter buffer
        const seqNum = Math.floor(Date.now() / 20) % 65536; // 16-bit sequence number
        const ts = Date.now();
        jb.push(seqNum, ts, new Uint8Array(raw));

        const next = jb.pop();
        if (next) {
          energy.pushPcm16(next);
          runtime.pushAudio(next, seqNum, ts).catch(() => {});
        }
        resetSilenceTimer();
      }
    } catch (err) {
      app.log.error({ err }, "ws message error");
      // Send error response to client
      try {
        const errorMsg: WsOutbound = { t: "error", message: "Invalid message format" } as any;
        originalSend(errorMsg);
      } catch {}
    }
  });

  socket.on("close", () => {
    energy.stop();

    // Clean up connection tracking
    activeConnections.delete(callId);

    app.log.info({ callId }, "ws closed");
    timeline.publish(callId, "call.ended", { at: Date.now(), reason: "ws_close" }).catch(() => {});
    try { wsCounters.inc({ event: "close" }); } catch {}
    const tenantWebhook = process.env.TENANT_WEBHOOK_URL;
    if (tenantWebhook) {
      (async () => {
        try {
          await webhookQ.lpush(
            "webhooks:queue",
            JSON.stringify({
              id: `wh_${Date.now()}`,
              url: tenantWebhook,
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ type: "billing.usage.updated", callId, usage: runtime.getUsage(), endedAt: new Date().toISOString() }),
              attempts: 0,
            })
          );
        } catch {}
      })();
    }
  });

  socket.on("error", (error) => {
    app.log.error({ error, callId }, "WebSocket error");
    timeline.publish(callId, "call.error", { error: error.message, at: Date.now() }).catch(() => {});
  });

  // Send connection confirmation
  const connectionMsg: WsOutbound = { t: "connected", callId, timestamp: Date.now() } as any;
  originalSend(connectionMsg);
});

// Connection management endpoint
app.get("/v1/realtime/connections", async () => {
  // This would typically track active connections
  // For now, return basic info
  return {
    service: "realtime",
    status: "running",
    timestamp: new Date().toISOString(),
  };
});

// Call management endpoint
app.post("/v1/realtime/:callId/end", async (req, reply) => {
  const { callId } = (req.params as any) as { callId: string };
  
  try {
    // Publish call end event
    await timeline.publish(callId, "call.ended", { 
      at: Date.now(), 
      reason: "api_request",
      requestedBy: req.headers["x-user-id"] || "system"
    });
    
    return { success: true, callId, endedAt: new Date().toISOString() };
  } catch (err) {
    app.log.error({ err, callId }, "Failed to end call");
    return reply.code(500).send({ code: "internal_error" });
  }
});

// Call transfer endpoint
app.post("/v1/realtime/:callId/transfer", async (req, reply) => {
  const { callId } = (req.params as any) as { callId: string };
  const { to, mode = "blind" } = (req.body as any) || {};
  
  if (!to) {
    return reply.code(400).send({ code: "bad_request", message: "transfer destination required" });
  }
  
  try {
    // Publish transfer event
    await timeline.publish(callId, "call.transfer", { 
      to, 
      mode, 
      at: Date.now(),
      requestedBy: req.headers["x-user-id"] || "system"
    });
    
    // Trigger telephony service for transfer
    const telephonyUrl = process.env.TELEPHONY_SERVICE_URL || "http://telephony:8085";
    try {
      await fetch(`${telephonyUrl}/transfer/${callId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to, mode }),
      });
    } catch (err) {
      app.log.warn({ err, callId }, "Failed to trigger telephony transfer");
    }
    
    return { success: true, callId, transfer: { to, mode } };
  } catch (err) {
    app.log.error({ err, callId }, "Failed to initiate transfer");
    return reply.code(500).send({ code: "internal_error" });
  }
});

// Call recording control
app.post("/v1/realtime/:callId/recording", async (req, reply) => {
  const { callId } = (req.params as any) as { callId: string };
  const { action } = (req.body as any) || {};
  
  if (!["start", "stop", "pause", "resume"].includes(action)) {
    return reply.code(400).send({ code: "bad_request", message: "Invalid action" });
  }
  
  try {
    // Publish recording event
    await timeline.publish(callId, "recording." + action, { 
      at: Date.now(),
      requestedBy: req.headers["x-user-id"] || "system"
    });
    
    return { success: true, callId, recording: { action, timestamp: new Date().toISOString() } };
  } catch (err) {
    app.log.error({ err, callId }, "Failed to control recording");
    return reply.code(500).send({ code: "internal_error" });
  }
});

// Get call statistics
app.get("/v1/realtime/:callId/stats", async (req, reply) => {
  const { callId } = (req.params as any) as { callId: string };
  
  try {
    // Get timeline events for statistics
    const events = await timeline.getEvents(callId, 1000);
    
    const stats = {
      callId,
      totalEvents: events.length,
      eventTypes: {} as Record<string, number>,
      duration: 0,
      lastEvent: null as any,
    };
    
    if (events.length > 0) {
      const firstEvent = events[0];
      const lastEvent = events[events.length - 1];
      
      stats.duration = lastEvent.timestamp - firstEvent.timestamp;
      stats.lastEvent = lastEvent;
      
      // Count event types
      events.forEach(event => {
        const type = event.kind;
        stats.eventTypes[type] = (stats.eventTypes[type] || 0) + 1;
      });
    }
    
    return stats;
  } catch (err) {
    app.log.error({ err, callId }, "Failed to get call stats");
    return reply.code(500).send({ code: "internal_error" });
  }
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  try { await app.close(); } catch {}
  try { webhookQ.disconnect(); } catch {}
  process.exit(0);
});

app.listen({ port: PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

