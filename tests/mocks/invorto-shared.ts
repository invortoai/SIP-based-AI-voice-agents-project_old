// Minimal test-time shim for @invorto/shared to avoid heavy deps (langfuse, winston, otel, etc.)
export async function initializeObservability(_: any): Promise<void> {
  // no-op
}

export const logger = {
  info: (...args: any[]) => console.log(...args),
  warn: (...args: any[]) => console.warn(...args),
  error: (...args: any[]) => console.error(...args),
  debug: (...args: any[]) => console.debug?.(...args),
};

export class StructuredLogger {
  private scope: string;
  constructor(scope: string) {
    this.scope = scope;
  }
  info(msg: string, meta?: any) {
    console.log(`[${this.scope}]`, msg, meta ?? "");
  }
  warn(msg: string, meta?: any) {
    console.warn(`[${this.scope}]`, msg, meta ?? "");
  }
  error(msg: string, meta?: any) {
    console.error(`[${this.scope}]`, msg, meta ?? "");
  }
}

export const customMetrics = {
  incrementCounter: (_name: string, _labels?: Record<string, string | number>) => {},
  recordHistogram: (_name: string, _value: number, _labels?: Record<string, string | number>) => {},
};

export const healthChecker = {
  registerCheck: async (_name: string, _fn: () => Promise<boolean>) => true,
  getStatus: async () => ({ ok: true }),
};

export function createSpan(_name: string) {
  return {
    end: () => {},
  };
}

export function recordException(_err: Error, _span?: any): void {
  // no-op
}

// Security/helpers shims
export const requestSanitizer = {
  sanitize: <T>(v: T) => v,
};

export const apiKeyManager = {
  validate: async (_key: string) => true,
};

export class PIIRedactor {
  redact<T>(obj: T): T {
    return obj;
  }
}

export async function getSecret(_name: string): Promise<string | undefined> {
  return undefined;
}

// Define minimal message types to satisfy type imports
export interface StartMessage {
  t: "start";
  callId: string;
  agentId: string;
  locale?: string;
}

export interface AudioMessage {
  t: "audio";
  seq: number;
  pcm16: Uint8Array;
}

export interface SttPartialMessage {
  t: "stt.partial";
  text: string;
  ts?: number;
}

export interface SttFinalMessage {
  t: "stt.final";
  text: string;
  ts?: number;
}

export interface TtsChunkMessage {
  t: "tts.chunk";
  seq: number;
  pcm16: Uint8Array | string | number[];
}

export interface ConnectedMessage {
  t: "connected";
  callId?: string;
  timestamp?: number;
}

export interface ErrorMessage {
  t: "error";
  message: string;
}

export interface PongMessage {
  t: "pong";
  timestamp?: number;
}

export type ClientToServerMessage = StartMessage | AudioMessage;
export type ServerToClientMessage = SttPartialMessage | SttFinalMessage | TtsChunkMessage | ConnectedMessage | ErrorMessage | PongMessage;
export type WsInbound = ClientToServerMessage;
export type WsOutbound = ServerToClientMessage;