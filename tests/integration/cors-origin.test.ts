/// <reference path="../jest-globals.d.ts" />
/**
 * CORS / Origin header validation for API and Webhooks services
 */

describe("CORS/Origin headers", () => {
  const prevEnv = { ...process.env } as NodeJS.ProcessEnv;
  let apiPort = 0;
  let whPort = 0;
  let apiApp: any;
  let webhooksApp: any;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.JEST_WORKER_ID = process.env.JEST_WORKER_ID || "1";

    // Set explicit PUBLIC_BASE_URL to enforce a fixed Access-Control-Allow-Origin value
    process.env.PUBLIC_BASE_URL = "https://api.invortoai.com";

    // Dynamic imports to avoid ES module issues
    const apiModule = await import("../../services/api/dist/index.js");
    const webhooksModule = await import("../../services/webhooks/dist/index.js");

    apiApp = apiModule.app;
    webhooksApp = webhooksModule.app;

    const apiAddr = await apiApp.listen({ port: 0, host: "127.0.0.1" });
    const a = apiApp.server.address();
    apiPort = typeof a === "object" && a ? (a as any).port : parseInt(String(apiAddr).split(":").pop() || "0", 10);

    const whAddr = await webhooksApp.listen({ port: 0, host: "127.0.0.1" });
    const w = webhooksApp.server.address();
    whPort = typeof w === "object" && w ? (w as any).port : parseInt(String(whAddr).split(":").pop() || "0", 10);
  });

  afterAll(async () => {
    process.env = prevEnv;
    try { await apiApp.close(); } catch {}
    try { await webhooksApp.close(); } catch {}
  });

  test("API returns Access-Control-Allow-Origin as configured PUBLIC_BASE_URL", async () => {
    const res = await fetch(`http://127.0.0.1:${apiPort}/health`, {
      method: "GET",
      headers: { Origin: "https://example.com" }
    });
    expect(res.status).toBe(200);
    const allow = res.headers.get("access-control-allow-origin");
    expect(allow).toBe("https://api.invortoai.com");
  });

  test("Webhooks returns Access-Control-Allow-Origin as configured PUBLIC_BASE_URL", async () => {
    const res = await fetch(`http://127.0.0.1:${whPort}/health`, {
      method: "GET",
      headers: { Origin: "https://malicious.example" }
    });
    expect(res.status).toBe(200);
    const allow = res.headers.get("access-control-allow-origin");
    expect(allow).toBe("https://api.invortoai.com");
  });
});