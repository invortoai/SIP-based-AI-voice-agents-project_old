import { EventEmitter } from "events";

export interface ElevenLabsTtsOptions {
  apiKey: string;
  voiceId?: string;           // e.g., "Rachel"
  modelId?: string;           // e.g., "eleven_multilingual_v2"
  sampleRate?: number;        // default 16000
  format?: "pcm_16000" | "mp3_44100_128";
}

export type TtsChunkCallback = (chunk: Uint8Array) => void;
export type TtsCompleteCallback = (duration: number) => void;
export type TtsErrorCallback = (error: Error) => void;

/**
 * ElevenLabs streaming TTS client using the REST streaming endpoint.
 * When format = "pcm_16000" it streams 16kHz 16-bit mono PCM suitable for your pipeline.
 */
export class ElevenLabsTtsClient extends EventEmitter {
  private options: ElevenLabsTtsOptions;
  private onChunkCb?: TtsChunkCallback;
  private onCompleteCb?: TtsCompleteCallback;
  private onErrorCb?: TtsErrorCallback;

  private currentStream: ReadableStream<Uint8Array> | null = null;
  private abortController: AbortController | null = null;
  private totalBytesGenerated = 0;
  private startTime = 0;
  private interrupted = false;

  constructor(options: ElevenLabsTtsOptions) {
    super();
    this.options = options;
  }

  onChunk(cb: TtsChunkCallback): void {
    this.onChunkCb = cb;
  }

  onComplete(cb: TtsCompleteCallback): void {
    this.onCompleteCb = cb;
  }

  onError(cb: TtsErrorCallback): void {
    this.onErrorCb = cb;
  }

  async synthesize(text: string): Promise<void> {
    if (!text || !text.trim()) return;

    const voiceId = this.options.voiceId || "Rachel";
    const modelId = this.options.modelId || "eleven_multilingual_v2";
    const outputFormat = this.options.format || "pcm_16000";
    const sampleRate = this.options.sampleRate || 16000;

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
      voiceId
    )}/stream`;

    const body = {
      text,
      model_id: modelId,
      // Voice settings are optional; defaults are fine for now
      // voice_settings: { stability: 0.3, similarity_boost: 0.7, style: 0.0, use_speaker_boost: true },
      output_format: outputFormat, // "pcm_16000" or "mp3_44100_128"
    };

    this.abortController = new AbortController();
    this.totalBytesGenerated = 0;
    this.startTime = Date.now();
    this.interrupted = false;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "xi-api-key": this.options.apiKey,
          "content-type": "application/json",
          accept:
            outputFormat === "pcm_16000"
              ? "application/octet-stream"
              : "audio/mpeg",
        },
        body: JSON.stringify(body),
        signal: this.abortController.signal,
      });

      if (!res.ok) {
        const msg = `ElevenLabs TTS request failed: ${res.status} ${res.statusText}`;
        const err = new Error(msg);
        this.onErrorCb?.(err);
        this.emit("error", err);
        return;
      }

      const stream = res.body;
      if (!stream) {
        // Fallback: buffer whole response and emit one chunk
        const buf = new Uint8Array(await res.arrayBuffer());
        this.totalBytesGenerated += buf.byteLength;
        this.onChunkCb?.(buf);
        this.emit("chunk", buf);
      } else {
        this.currentStream = stream;

        // Web ReadableStream in Node 18+/20+: for-await-of works
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for await (const chunk of stream as any) {
          if (this.interrupted) break;

          // Normalize to Uint8Array
          let audio: Uint8Array;
          if (chunk instanceof Uint8Array) audio = chunk;
          else if (chunk instanceof Buffer) audio = new Uint8Array(chunk);
          else audio = new Uint8Array(Buffer.from(chunk));

          this.totalBytesGenerated += audio.byteLength;

          // Forward to callback
          this.onChunkCb?.(audio);
          this.emit("chunk", audio);
        }
      }

      if (!this.interrupted) {
        const duration = this.calculateDuration(
          this.totalBytesGenerated,
          outputFormat,
          sampleRate
        );
        this.onCompleteCb?.(duration);
        this.emit("complete", duration);
      }
    } catch (err: any) {
      if (err?.name === "AbortError" || this.interrupted) {
        this.emit("interrupted");
      } else {
        const e = err instanceof Error ? err : new Error(String(err));
        this.onErrorCb?.(e);
        this.emit("error", e);
        throw e;
      }
    } finally {
      this.currentStream = null;
      this.abortController = null;
    }
  }

  interrupt(): void {
    this.interrupted = true;
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch {}
      this.abortController = null;
    }
    this.currentStream = null;
  }

  isActive(): boolean {
    return this.currentStream !== null;
  }

  getTotalBytesGenerated(): number {
    return this.totalBytesGenerated;
  }

  private calculateDuration(
    bytes: number,
    format: ElevenLabsTtsOptions["format"],
    sampleRate: number
  ): number {
    if (format === "pcm_16000") {
      // 16-bit PCM mono: 2 bytes per sample
      const bytesPerSample = 2;
      const samples = bytes / bytesPerSample;
      return samples / sampleRate;
    }
    // For mp3, we can't infer exact duration from bytes reliably; approximate 128 kbps at 44.1kHz if needed.
    // Here return 0; downstream can compute if required.
    return 0;
  }
}