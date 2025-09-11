/**
 * SDK runtime validation tests (zod guards)
 * - Node SDK: handleMessage validates and emits error events on invalid payloads
 * - Browser SDK: onmessage validates and surfaces an error message via on('message') callback
 */

import { RealtimeWebSocketClient } from "../../sdk/node/src/realtime-client";
import { RealtimeClient as BrowserRealtimeClient } from "../../sdk/browser/src/realtime-client";

// Mock ws for Node SDK to avoid real network and to allow handleMessage invocation without connecting
jest.mock("ws", () => {
  class MockWS {
    public static OPEN = 1;
    public readyState = 1;
    private handlers: Record<string, Function> = {};
    constructor(_url: string, _protocols?: string[] | undefined, _options?: any) {
      setImmediate(() => {
        if (this.handlers["open"]) this.handlers["open"]();
      });
    }
    on(event: "open" | "message" | "error" | "close", handler: Function) {
      this.handlers[event] = handler;
    }
    send(_payload: any) {}
    close(_code?: number, _reason?: string) {
      if (this.handlers["close"]) this.handlers["close"](_code ?? 1000, _reason ?? "");
    }
  }
  return MockWS;
});

describe("SDK zod validation guards", () => {
  const prevEnv = { ...process.env } as NodeJS.ProcessEnv;

  afterEach(() => {
    process.env = { ...prevEnv };
    jest.clearAllMocks();
  });

  describe("Node SDK - RealtimeWebSocketClient", () => {
    test("emits error event for invalid stt.partial payload (text not string)", async () => {
      const client = new RealtimeWebSocketClient("c1", "http://localhost", "k", {});
      const events: any[] = [];
      client.on("event", (ev: any) => events.push(ev));

      // Directly invoke handleMessage with invalid JSON payload
      const invalid = { t: "stt.partial", text: 123 }; // invalid type
      // @ts-ignore access private method for test
      (client as any)["handleMessage"](Buffer.from(JSON.stringify(invalid)));

      // Allow microtask queue to flush
      await new Promise((r) => setImmediate(r));

      const hasError = events.some((e) => e?.type === "error" && typeof e?.message === "string");
      expect(hasError).toBe(true);
      await client.disconnect();
    });

    test("accepts tts.chunk with base64 string, number[] and Uint8Array", async () => {
      const client = new RealtimeWebSocketClient("c2", "http://localhost", "k", {});
      const events: any[] = [];
      client.on("event", (ev: any) => events.push(ev));

      const base64Msg = { t: "tts.chunk", pcm16: Buffer.from([1,2,3]).toString("base64") };
      // @ts-ignore
      (client as any)["handleMessage"](Buffer.from(JSON.stringify(base64Msg)));

      const arrMsg = { t: "tts.chunk", pcm16: [1,2,3,4] };
      // @ts-ignore
      (client as any)["handleMessage"](Buffer.from(JSON.stringify(arrMsg)));

      const u8 = new Uint8Array([5,6,7,8]);
      const u8Msg = { t: "tts.chunk", pcm16: Array.from(u8) }; // encoded as number[] in JSON
      // @ts-ignore
      (client as any)["handleMessage"](Buffer.from(JSON.stringify(u8Msg)));

      await new Promise((r) => setImmediate(r));
      // Should have emitted audio events for valid payloads (non-error)
      const audioEvents = events.filter((e) => e?.type === "audio");
      expect(audioEvents.length).toBeGreaterThanOrEqual(2); // base64 and number[] expected
      await client.disconnect();
    });
  });

  describe("Browser SDK - RealtimeClient", () => {
    class MockBrowserWS {
      static lastInstance: MockBrowserWS | null = null;

      public onopen: null | (() => void) = null;
      public onmessage: null | ((ev: any) => void) = null;
      public onerror: null | ((err: any) => void) = null;
      public onclose: null | ((ev: any) => void) = null;
      public readyState = 1;

      constructor(_url: string, _protocols?: string[] | undefined) {
        MockBrowserWS.lastInstance = this;
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
      MockBrowserWS.lastInstance = null;
    });

    test("surfaces error message for invalid stt.partial payload via on('message')", async () => {
      const client = new BrowserRealtimeClient("wss://x/realtime/voice");
      const messages: any[] = [];
      client.on("message", (m: any) => messages.push(m));
      await client.connect("call-b1", "agent-b", "key-b");

      // Simulate an incoming invalid message (text must be string)
      const invalid = { t: "stt.partial", text: 123 };
      const inst = MockBrowserWS.lastInstance!;
      inst.onmessage && inst.onmessage({ data: JSON.stringify(invalid) });

      await new Promise((r) => setImmediate(r));
      const hasError = messages.some((m) => m?.t === "error" && typeof m?.message === "string");
      expect(hasError).toBe(true);

      client.disconnect();
    });

    test("accepts tts.chunk with different encodings", async () => {
      const client = new BrowserRealtimeClient("wss://x/realtime/voice");
      const messages: any[] = [];
      client.on("message", (m: any) => messages.push(m));
      await client.connect("call-b2", "agent-b", "key-b");

      const base64Msg = { t: "tts.chunk", pcm16: Buffer.from([1,2,3]).toString("base64") };
      const arrMsg = { t: "tts.chunk", pcm16: [1,2,3,4] };
      const inst = MockBrowserWS.lastInstance!;
      inst.onmessage && inst.onmessage({ data: JSON.stringify(base64Msg) });
      inst.onmessage && inst.onmessage({ data: JSON.stringify(arrMsg) });

      await new Promise((r) => setImmediate(r));
      // No error messages should be produced solely due to these payloads
      const errors = messages.filter((m) => m?.t === "error");
      expect(errors.length).toBe(0);

      client.disconnect();
    });
  });
});