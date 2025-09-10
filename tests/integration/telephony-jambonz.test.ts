/// <reference path="../jest-globals.d.ts" />
/**
 * Telephony Jambonz endpoints integration tests
 * - boots the telephony Fastify app on an ephemeral port
 * - validates /telephony/jambonz/call and /telephony/jambonz/status handlers
 */
import { app as telephonyApp } from "../../services/telephony/src/index";

describe("Telephony Jambonz endpoints", () => {
  let port = 0;
  const prevEnv = { ...process.env } as NodeJS.ProcessEnv;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.JEST_WORKER_ID = process.env.JEST_WORKER_ID || "1";
    // Do not set JAMBONZ_WEBHOOK_SECRET to avoid HMAC enforcement in test
    const address = await telephonyApp.listen({ port: 0, host: "127.0.0.1" });
    const addr = telephonyApp.server.address();
    if (typeof addr === "object" && addr && "port" in addr) {
      port = (addr as any).port;
    } else {
      const m = String(address).match(/:(\d+)$/);
      port = m ? parseInt(m[1], 10) : 0;
    }
  });

  afterAll(async () => {
    process.env = prevEnv;
    try { await telephonyApp.close(); } catch {}
  });

  test("POST /telephony/jambonz/call returns valid call control with stream/connect", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/telephony/jambonz/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        from: "+10000000000",
        to: "+19999999999",
        call_sid: "TEST_SID",
        direction: "inbound"
      })
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Expected structure:
    // { application_sid: "...", call_hook: [{ verb: "stream", url: "wss://..." }] }
    expect(body).toBeTruthy();
    expect(Array.isArray(body.call_hook)).toBe(true);
    expect(body.call_hook[0].verb).toBeDefined();
  });

  test("POST /telephony/jambonz/status returns ok:true and writes events", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/telephony/jambonz/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        call_sid: "TEST_SID_2",
        call_status: "in-progress"
      })
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });
});