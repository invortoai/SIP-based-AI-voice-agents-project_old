export interface StartMessage {
  t: "start";
  callId: string;
  agentId: string;
  locale?: string;
}

export interface AudioMessage {
  t: "audio";
  seq: number;
  // 16-bit PCM mono; for typing, use Uint8Array to represent raw bytes
  pcm16: Uint8Array;
}

export interface ToolResultMessage {
  t: "tool.result";
  id: string;
  result: Record<string, unknown>;
}

export interface DtmfSendMessage {
  t: "dtmf.send";
  digits: string;
  method?: "rfc2833" | "info";
}

export interface TransferRequestMessage {
  t: "transfer";
  to: string;
  mode: "blind" | "attended";
}

export type ClientToServerMessage = StartMessage | AudioMessage | ToolResultMessage | DtmfSendMessage | TransferRequestMessage;

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

export interface LlmDeltaMessage {
  t: "llm.delta";
  text: string;
}

export interface ToolCallMessage {
  t: "tool.call";
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface TtsChunkMessage {
  t: "tts.chunk";
  seq: number;
  pcm16: Uint8Array;
}

export interface ControlBargeInMessage {
  t: "control.bargein";
  action: "stop-tts";
}

export interface DtmfMessage {
  t: "dtmf";
  digit: string;
  method?: "rfc2833" | "info";
}

export interface TransferMessage {
  t: "transfer";
  to: string;
  mode: "blind" | "attended";
}

export interface EmotionWindowMessage {
  t: "emotion.window";
  energy_db: number;
  speaking: boolean;
}

export interface EmotionStateMessage {
  t: "emotion.state";
  class: string;
  arousal: number;
  valence: number;
  confidence?: number;
}

export interface EndMessage {
  t: "end";
  reason: string;
}

export type ServerToClientMessage =
  | SttPartialMessage
  | SttFinalMessage
  | LlmDeltaMessage
  | ToolCallMessage
  | TtsChunkMessage
  | ControlBargeInMessage
  | EmotionWindowMessage
  | EmotionStateMessage
  | EndMessage;

export type WsInbound = ClientToServerMessage;
export type WsOutbound = ServerToClientMessage;

