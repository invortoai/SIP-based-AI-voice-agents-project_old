/**
 * Browser SDK realtime integration test:
 * - Boots the realtime Fastify app on an ephemeral port
 * - Uses ws as a polyfill for global.WebSocket
 * - Connects using Browser RealtimeClient (subprotocol API key via constructor connect)
 * - Expects a "connected" message containing the callId
 */

import { app as realtimeApp } from "../../services/realtime/src/index";
import { RealtimeClient } from "../../sdk/browser/src/realtime-client";
import WS from "ws";

describe("Browser SDK realtime integration", () => {
  const prevEnv = { ...process.env } as NodeJS.ProcessEnv;
  let port = 0;
  let savedWS: any;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.JEST_WORKER_ID = process.env.JEST_WORKER_ID || "1";
    process.env.REALTIME_API_KEY = process.env.REALTIME_API_KEY || "testkey";

    // ws polyfill for browser WebSocket
    savedWS = (global as any).WebSocket;
    (global as any).WebSocket = WS as any;

    const address = await realtimeApp.listen({ port: 0, host: "127.0.0.1" });
    const addr = realtimeApp.server.address();
    if (typeof addr === "object" && addr && "port" in addr) {
      port = (addr as any).port;
    } else {
      const m = String(address).match(/:(\d+)$/);
      port = m ? parseInt(m[1], 10) : 0;
    }
  });

  afterAll(async () => {
    process.env = prevEnv;
    (global as any).WebSocket = savedWS;
    try { await realtimeApp.close(); } catch {}
  });

  test("connect → start → receive connected message", async () => {
    expect(port).toBeGreaterThan(0);

    const callId = "sdk_browser_" + Date.now();
    const agentId = "agent-browser";
    const apiKey = process.env.REALTIME_API_KEY as string;

    // Base WS URL; client will append /realtime/voice if missing and add query params
    const base = `ws://127.0.0.1:${port}`;
    const client = new RealtimeClient(base);

    const messages: any[] = [];
    client.on("message", (m: any) => messages.push(m));

    await client.connect(callId, agentId, apiKey);

    // Wait briefly to receive messages
    await new Promise((r) => setTimeout(r, 300));

    const gotConnected = messages.some((m) => m?.t === "connected" && m?.callId === callId);
    expect(gotConnected).toBe(true);

    client.disconnect();
  }, 10000);
});