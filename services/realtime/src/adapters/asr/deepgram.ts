export interface DeepgramAsrOptions {
  apiKey: string;
  language?: string;
  sampleRate?: number;
}

export type PartialCallback = (text: string) => void;
export type FinalCallback = (text: string) => void;

export class DeepgramAsrClient {
  private options: DeepgramAsrOptions;
  private onPartialCb?: PartialCallback;
  private onFinalCb?: FinalCallback;

  constructor(options: DeepgramAsrOptions) {
    this.options = options;
  }

  onPartial(cb: PartialCallback) {
    this.onPartialCb = cb;
  }

  onFinal(cb: FinalCallback) {
    this.onFinalCb = cb;
  }

  async start(): Promise<void> {
    // Stub: In real impl, open Deepgram WS and stream PCM frames
  }

  async pushPcm16(chunk: Uint8Array): Promise<void> {
    // Stub: In real impl, send audio chunk to Deepgram
    // For demo purposes, fake a partial when any audio arrives
    if (this.onPartialCb) this.onPartialCb(`len=${chunk.byteLength}`);
  }

  async end(): Promise<void> {
    // Stub: close upstream
    if (this.onFinalCb) this.onFinalCb("(demo) end of utterance");
  }
}

