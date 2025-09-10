/// <reference path="../jest-globals.d.ts" />
/**
 * Realtime WebSocket Smoke Test
 * - boots the realtime Fastify app on an ephemeral port
 * - connects to /realtime/voice with a minimal API-key subprotocol
 * - asserts initial "connected" event or clean close in failure path
 */
import { app as realtimeApp } from "../../services/realtime/src/index";
import WebSocket from "ws";

describe("Realtime WS smoke", () => {
  const prevEnv = { ...process.env } as NodeJS.ProcessEnv;
  let port = 0;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.JEST_WORKER_ID = process.env.JEST_WORKER_ID || "1";
    process.env.REALTIME_API_KEY = process.env.REALTIME_API_KEY || "testkey";
    // Keep origin enforcement off by not sending Origin header (server allows if header absent)
    // Start on ephemeral port
    const address = await realtimeApp.listen({ port: 0, host: "127.0.0.1" });
    // address may be string or object; derive port from server
    const addr = realtimeApp.server.address();
    if (typeof addr === "object" && addr && "port" in addr) {
      port = (addr as any).port;
    } else {
      // Fallback parse from string
      const m = String(address).match(/:(\d+)$/);
      port = m ? parseInt(m[1], 10) : 0;
    }
  });

  afterAll(async () => {
    process.env = prevEnv;
    try { await realtimeApp.close(); } catch {}
  });

  test("connects with subprotocol API key and receives connected message", async () => {
    expect(port).toBeGreaterThan(0);

    const callId = "ws_test_" + Date.now();
    const url = `ws://127.0.0.1:${port}/realtime/voice?callId=${encodeURIComponent(callId)}`;
    const protocols = [process.env.REALTIME_API_KEY as string];

    const ws = new WebSocket(url, protocols);
    const events: any[] = [];

    const result = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 4000);
      ws.on("open", () => {
        // send a start message (optional)
        ws.send(JSON.stringify({ t: "start", callId, agentId: "agent-smoke" }));
      });
      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          events.push(msg);
          if (msg && msg.t === "connected" && msg.callId === callId) {
            clearTimeout(timer);
            ws.close(1000);
            resolve(true);
          }
        } catch {}
      });
      ws.on("close", () => {
        // Resolve true if we already saw connected; otherwise false
        const ok = events.some((e) => e && e.t === "connected");
        clearTimeout(timer);
        resolve(ok);
      });
      ws.on("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
    });

    expect(result).toBe(true);
  });
});