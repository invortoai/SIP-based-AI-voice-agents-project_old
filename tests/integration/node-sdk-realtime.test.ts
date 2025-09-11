/**
 * Node SDK realtime integration test:
 * - Boots the realtime Fastify app on an ephemeral port
 * - Connects using RealtimeWebSocketClient (subprotocol API key)
 * - Sends start automatically and expects a "connected" event
 */

import { app as realtimeApp } from "../../services/realtime/src/index";
import { RealtimeWebSocketClient } from "../../sdk/node/src/realtime-client";

describe("Node SDK realtime integration", () => {
  const prevEnv = { ...process.env } as NodeJS.ProcessEnv;
  let port = 0;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.JEST_WORKER_ID = process.env.JEST_WORKER_ID || "1";
    process.env.REALTIME_API_KEY = process.env.REALTIME_API_KEY || "testkey";

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
    try { await realtimeApp.close(); } catch {}
  });

  test("connect → start → receive connected event", async () => {
    expect(port).toBeGreaterThan(0);

    const callId = "sdk_node_" + Date.now();
    const baseHttp = `http://127.0.0.1:${port}`;
    const apiKey = process.env.REALTIME_API_KEY as string;

    const client = new RealtimeWebSocketClient(callId, baseHttp, apiKey, { agentId: "agent-node" });
    const seen: any[] = [];

    client.on("event", (ev: any) => {
      seen.push(ev);
    });

    await client.connect();

    // Wait briefly to collect events
    await new Promise((r) => setTimeout(r, 300));

    const gotConnected = seen.some((e) => e?.type === "connected");
    expect(gotConnected).toBe(true);

    await client.disconnect();
  }, 10000);
});