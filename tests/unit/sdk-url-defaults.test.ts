/**
 * SDK URL selection and defaults tests
 * - Verifies Node SDK ws URL building (http(s) -> ws(s) with /realtime/voice) and REALTIME_WS_URL override precedence
 * - Verifies Browser SDK default and custom baseUrl behavior, capturing the URL passed to WebSocket
 */

import { RealtimeWebSocketClient } from "../../sdk/node/src/realtime-client";
import { RealtimeClient as BrowserRealtimeClient } from "../../sdk/browser/src/realtime-client";

// Dynamically mock 'ws' for Node SDK tests to capture constructed URL and simulate open
// We use require after jest.mock to access static fields (lastUrl, OPEN, etc.)
jest.mock("ws", () => {
  class MockWS {
    public static OPEN = 1;
    public static lastUrl: string = "";
    public static lastProtocols: any;
    public static lastHeaders: any;

    public readyState = 1;
    private handlers: Record<string, Function> = {};

    constructor(url: string, protocols?: string[] | undefined, options?: any) {
      (MockWS as any).lastUrl = url;
      (MockWS as any).lastProtocols = protocols;
      (MockWS as any).lastHeaders = options?.headers;

      // Simulate async open
      setImmediate(() => {
        if (this.handlers["open"]) this.handlers["open"]();
      });
    }

    on(event: "open" | "message" | "error" | "close", handler: Function) {
      this.handlers[event] = handler;
    }

    send(_payload: any) {
      // No-op for URL capture tests
    }

    close(_code?: number, _reason?: string) {
      if (this.handlers["close"]) {
        this.handlers["close"](_code ?? 1000, _reason ?? "");
      }
    }
  }

  return MockWS;
});

describe("SDK URL selection and defaults", () => {
  const prevEnv = { ...process.env } as NodeJS.ProcessEnv;

  afterEach(() => {
    // Restore env to avoid cross-test pollution
    process.env = { ...prevEnv };
    jest.clearAllMocks();
  });

  describe("Node SDK - RealtimeWebSocketClient URL building", () => {
    test("uses http -> ws base with /realtime/voice when REALTIME_WS_URL is not set", async () => {
      // Arrange
      delete process.env.REALTIME_WS_URL;
      const callId = "urltest1";
      const apiBase = "http://example.com"; // should become ws://example.com
      const apiKey = "k";

      // Act
      const client = new RealtimeWebSocketClient(callId, apiBase, apiKey, {});
      await client.connect();

      // Assert
      const WS = require("ws");
      const lastUrl: string = WS.lastUrl;
      expect(lastUrl).toBe(`ws://example.com/realtime/voice?callId=${encodeURIComponent(callId)}`);

      // Cleanup
      await client.disconnect();
    });

    test("REALTIME_WS_URL override takes precedence and appends callId when it already includes /realtime/voice", async () => {
      // Arrange
      process.env.REALTIME_WS_URL = "wss://rt.override.example.com/realtime/voice";
      const callId = "urltest2";
      const apiBase = "https://api.invortoai.com"; // should be ignored due to override
      const apiKey = "k2";

      // Act
      const client = new RealtimeWebSocketClient(callId, apiBase, apiKey, {});
      await client.connect();

      // Assert
      const WS = require("ws");
      const lastUrl: string = WS.lastUrl;
      expect(lastUrl).toBe(`wss://rt.override.example.com/realtime/voice?callId=${encodeURIComponent(callId)}`);

      // Cleanup
      await client.disconnect();
    });

    test("REALTIME_WS_URL without /realtime/voice falls back to suffixing /:callId (back-compat path)", async () => {
      // Arrange
      process.env.REALTIME_WS_URL = "wss://rt.override.example.com/some/legacy";
      const callId = "urltest3";
      const apiBase = "https://api.invortoai.com";
      const apiKey = "k3";

      // Act
      const client = new RealtimeWebSocketClient(callId, apiBase, apiKey, {});
      await client.connect();

      // Assert
      const WS = require("ws");
      const lastUrl: string = WS.lastUrl;
      expect(lastUrl).toBe(`wss://rt.override.example.com/some/legacy/${encodeURIComponent(callId)}`);

      // Cleanup
      await client.disconnect();
    });
  });

  describe("Browser SDK - RealtimeClient URL building", () => {
    // Provide a mock WebSocket to capture URL without network
    class MockBrowserWS {
      static lastUrl: string = "";
      static lastProtocols: any;

      public onopen: null | (() => void) = null;
      public onmessage: null | ((ev: any) => void) = null;
      public onerror: null | ((err: any) => void) = null;
      public onclose: null | ((ev: any) => void) = null;
      public readyState = 1;

      constructor(url: string, protocols?: string[] | undefined) {
        MockBrowserWS.lastUrl = url;
        MockBrowserWS.lastProtocols = protocols;
        setImmediate(() => {
          if (this.onopen) this.onopen();
        });
      }

      send(_payload: any) {}
      close(_code?: number, _reason?: string) {
        if (this.onclose) this.onclose({ code: _code ?? 1000, reason: _reason ?? "" });
      }
    }

    let savedWS: any;

    beforeEach(() => {
      savedWS = (global as any).WebSocket;
      (global as any).WebSocket = MockBrowserWS as any;
    });

    afterEach(() => {
      (global as any).WebSocket = savedWS;
      MockBrowserWS.lastUrl = "";
      MockBrowserWS.lastProtocols = undefined;
    });

    test("default constructor uses wss://api.invortoai.com/realtime/voice and appends ?callId", async () => {
      const callId = "browsertest1";
      const agentId = "agentX";
      const apiKey = "keyX";

      const client = new BrowserRealtimeClient(); // default base should be production realtime path
      await client.connect(callId, agentId, apiKey);

      expect(MockBrowserWS.lastUrl).toBe(
        `wss://api.invortoai.com/realtime/voice?callId=${encodeURIComponent(callId)}&api_key=${encodeURIComponent(apiKey)}&agentId=${encodeURIComponent(agentId)}`
      );

      client.disconnect();
    });

    test("custom baseUrl honored, appends /realtime/voice if missing, and adds query params", async () => {
      const callId = "browsertest2";
      const agentId = "agentY";
      const apiKey = "keyY";
      const customBase = "ws://127.0.0.1:7001"; // lacks /realtime/voice - client should append

      const client = new BrowserRealtimeClient(customBase);
      await client.connect(callId, agentId, apiKey);

      expect(MockBrowserWS.lastUrl).toBe(
        `ws://127.0.0.1:7001/realtime/voice?callId=${encodeURIComponent(callId)}&api_key=${encodeURIComponent(apiKey)}&agentId=${encodeURIComponent(agentId)}`
      );

      client.disconnect();
    });

    test("custom baseUrl that already includes /realtime/voice is used as-is with query params", async () => {
      const callId = "browsertest3";
      const agentId = "agentZ";
      const apiKey = "keyZ";
      const customBase = "ws://127.0.0.1:7002/realtime/voice";

      const client = new BrowserRealtimeClient(customBase);
      await client.connect(callId, agentId, apiKey);

      expect(MockBrowserWS.lastUrl).toBe(
        `ws://127.0.0.1:7002/realtime/voice?callId=${encodeURIComponent(callId)}&api_key=${encodeURIComponent(apiKey)}&agentId=${encodeURIComponent(agentId)}`
      );

      client.disconnect();
    });
  });
});