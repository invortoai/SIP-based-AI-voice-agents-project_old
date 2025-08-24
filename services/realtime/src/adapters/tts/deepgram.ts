import { createClient, SpeakSchema, DeepgramClient } from "@deepgram/sdk";
import { EventEmitter } from "events";

export interface DeepgramTtsOptions {
  apiKey: string;
  voiceId?: string;
  model?: string;
  rate?: number;
  sampleRate?: number;
  encoding?: string;
  container?: string;
  bitrate?: number;
}

export type TtsChunkCallback = (chunk: Uint8Array) => void;
export type TtsCompleteCallback = (duration: number) => void;
export type TtsErrorCallback = (error: Error) => void;

export class DeepgramTtsClient extends EventEmitter {
  private client: DeepgramClient;
  private options: DeepgramTtsOptions;
  private onChunkCb?: TtsChunkCallback;
  private onCompleteCb?: TtsCompleteCallback;
  private onErrorCb?: TtsErrorCallback;
  private warmed: boolean = false;
  private currentStream: ReadableStream<Uint8Array> | null = null;
  private abortController: AbortController | null = null;
  private audioBuffer: Uint8Array[] = [];
  private isInterrupted: boolean = false;
  private totalBytesGenerated: number = 0;
  private startTime: number = 0;

  constructor(options: DeepgramTtsOptions) {
    super();
    this.options = options;
    this.client = createClient(options.apiKey);
  }

  prewarm(): void {
    // Pre-warm the connection by making a small synthesis request
    this.warmed = true;
    this.synthesize(" ", true).catch(() => {
      // Ignore prewarm errors
    });
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

  async synthesize(text: string, silent: boolean = false): Promise<void> {
    if (!text || text.trim().length === 0) {
      return;
    }

    this.isInterrupted = false;
    this.totalBytesGenerated = 0;
    this.startTime = Date.now();
    this.audioBuffer = [];

    try {
      this.abortController = new AbortController();

      const options: SpeakSchema = {
        model: this.options.model || this.options.voiceId || "aura-asteria-en",
        encoding: (this.options.encoding as any) || "linear16",
        sample_rate: this.options.sampleRate || 16000,
        container: (this.options.container as any) || "none",
      };

      // Get the audio stream
      const response = await this.client.speak.request(
        { text },
        options
      );

      // Get the stream from the response
      const stream = await response.getStream();
      
      if (!stream) {
        throw new Error("Failed to get audio stream from Deepgram");
      }

      this.currentStream = stream as any;

      // Process the stream
      for await (const chunk of stream) {
        if (this.isInterrupted) {
          break;
        }

        // Convert chunk to Uint8Array
        let audioData: Uint8Array;
        if (chunk instanceof Buffer) {
          audioData = new Uint8Array(chunk);
        } else if (chunk instanceof Uint8Array) {
          audioData = chunk;
        } else {
          audioData = new Uint8Array(Buffer.from(chunk));
        }

        this.totalBytesGenerated += audioData.byteLength;
        
        if (!silent) {
          // Send chunk to callback
          this.onChunkCb?.(audioData);
          this.emit("chunk", audioData);
        }
        
        // Buffer for potential replay
        this.audioBuffer.push(audioData);
      }

      // Calculate duration based on sample rate and bytes
      const duration = this.calculateDuration(this.totalBytesGenerated);
      
      if (!silent && !this.isInterrupted) {
        this.onCompleteCb?.(duration);
        this.emit("complete", duration);
      }

    } catch (error: any) {
      if (error.name === "AbortError" || this.isInterrupted) {
        this.emit("interrupted");
      } else {
        console.error("Deepgram TTS error:", error);
        this.onErrorCb?.(error);
        this.emit("error", error);
        throw error;
      }
    } finally {
      this.currentStream = null;
      this.abortController = null;
    }
  }

  async synthesizeToBuffer(text: string): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    
    // Temporarily store the original callback
    const originalCallback = this.onChunkCb;
    
    // Set a temporary callback to collect chunks
    this.onChunkCb = (chunk) => {
      chunks.push(chunk);
    };
    
    try {
      await this.synthesize(text);
      
      // Combine all chunks into a single buffer
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
      }
      
      return result;
    } finally {
      // Restore the original callback
      this.onChunkCb = originalCallback;
    }
  }

  interrupt(): void {
    this.isInterrupted = true;
    
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    
    if (this.currentStream) {
      // For ReadableStream, we can try to cancel it
      if ('cancel' in this.currentStream && typeof this.currentStream.cancel === 'function') {
        (this.currentStream as any).cancel();
      }
      this.currentStream = null;
    }
    
    this.audioBuffer = [];
    this.emit("interrupted");
  }

  getAudioBuffer(): Uint8Array {
    // Combine all buffered chunks
    const totalLength = this.audioBuffer.reduce((acc, chunk) => acc + chunk.byteLength, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    
    for (const chunk of this.audioBuffer) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    
    return result;
  }

  clearBuffer(): void {
    this.audioBuffer = [];
    this.totalBytesGenerated = 0;
  }

  private calculateDuration(bytes: number): number {
    // For linear16 at 16kHz, each sample is 2 bytes
    const sampleRate = this.options.sampleRate || 16000;
    const bytesPerSample = 2; // 16-bit = 2 bytes
    const samples = bytes / bytesPerSample;
    const seconds = samples / sampleRate;
    return seconds;
  }

  isActive(): boolean {
    return this.currentStream !== null;
  }

  getTotalBytesGenerated(): number {
    return this.totalBytesGenerated;
  }

  // Helper method to convert text to SSML
  static toSSML(text: string, options?: {
    rate?: string;
    pitch?: string;
    volume?: string;
    emphasis?: string;
  }): string {
    let ssml = `<speak>`;
    
    if (options) {
      const prosody = [];
      if (options.rate) prosody.push(`rate="${options.rate}"`);
      if (options.pitch) prosody.push(`pitch="${options.pitch}"`);
      if (options.volume) prosody.push(`volume="${options.volume}"`);
      
      if (prosody.length > 0) {
        ssml += `<prosody ${prosody.join(" ")}>`;
      }
      
      if (options.emphasis) {
        ssml += `<emphasis level="${options.emphasis}">`;
      }
    }
    
    ssml += text;
    
    if (options?.emphasis) {
      ssml += `</emphasis>`;
    }
    
    if (options && (options.rate || options.pitch || options.volume)) {
      ssml += `</prosody>`;
    }
    
    ssml += `</speak>`;
    
    return ssml;
  }
}
