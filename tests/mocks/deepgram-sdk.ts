// Jest manual mock for @deepgram/sdk to prevent real WS connections and open handles during tests

type HandlerMap = Record<string, Function[]>;

function makeLive() {
  const handlers: HandlerMap = {};
  return {
    on(event: string, cb: Function) {
      (handlers[event] ||= []).push(cb);
      return this;
    },
    send(_data?: any) {
      // no-op
    },
    close() {
      (handlers['close'] || []).forEach((fn) => {
        try { fn(); } catch {}
      });
    }
  };
}

// Named export to match consumption: import { createClient } from '@deepgram/sdk'
export function createClient() {
  return {
    listen: {
      live: (_opts?: any) => makeLive(),
    },
    speak: {
      live: (_opts?: any) => makeLive(),
    },
    manage: {},
    read: {},
    onprem: {},
  };
}