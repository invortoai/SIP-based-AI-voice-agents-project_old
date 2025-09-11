import { createClient, LiveTranscriptionEvents, LiveClient, LiveSchema } from "@deepgram/sdk";
import { EventEmitter } from "events";

export interface DeepgramWsOptions {
  apiKey: string;
  language?: string;
  sampleRate?: number;
  model?: string;
  punctuate?: boolean;
  profanity_filter?: boolean;
  redact?: string[];
  diarize?: boolean;
  smart_format?: boolean;
  utterance_end_ms?: number;
  interim_results?: boolean;
  endpointing?: number;
}

export type PartialCb = (text: string, confidence?: number) => void;
export type FinalCb = (text: string, confidence?: number, duration?: number) => void;
export type MetadataCb = (metadata: any) => void;
export type ErrorCb = (error: Error) => void;

export class DeepgramWsAsr extends EventEmitter {
  private dg: any;
  private socket: LiveClient | null = null;
  private onPartialCb?: PartialCb;
  private onFinalCb?: FinalCb;
  private onMetadataCb?: MetadataCb;
  private onErrorCb?: ErrorCb;
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 3;
  private reconnectDelay: number = 1000;
  private audioBuffer: Uint8Array[] = [];
  private lastTranscriptTime: number = Date.now();

  constructor(private options: DeepgramWsOptions) {
    super();
    this.dg = createClient(options.apiKey);

    // Prevent unhandled 'error' EventEmitter exceptions in tests or runtime.
    // Always have a default listener; delegate to registered onErrorCb if present.
    this.on("error", (err: Error) => {
      try { this.onErrorCb?.(err); } catch { /* swallow to avoid test crashes */ }
    });
  }

  onPartial(cb: PartialCb) {
    this.onPartialCb = cb;
    // Bridge EventEmitter 'partial' events to the callback (used by unit tests)
    this.removeAllListeners("partial");
    this.on("partial", (payload: { text: string; confidence?: number }) => {
      try { cb(payload?.text ?? "", payload?.confidence); } catch {}
    });
  }
  
  onFinal(cb: FinalCb) {
    this.onFinalCb = cb;
    // Bridge EventEmitter 'final' events to the callback (used by unit tests)
    this.removeAllListeners("final");
    this.on("final", (payload: { text: string; confidence?: number; duration?: number }) => {
      try { cb(payload?.text ?? "", payload?.confidence, payload?.duration); } catch {}
    });
  }
  
  onMetadata(cb: MetadataCb) {
    this.onMetadataCb = cb;
    // Bridge EventEmitter 'metadata' events to the callback (parity with tests)
    this.removeAllListeners("metadata");
    this.on("metadata", (data: any) => {
      try { cb(data); } catch {}
    });
  }
  
  onError(cb: ErrorCb) {
    this.onErrorCb = cb;
    // Ensure EventEmitter 'error' events invoke this callback (prevents unhandled error throws)
    this.removeAllListeners("error");
    this.on("error", (err: Error) => {
      try { cb(err); } catch {}
    });
  }

  async start(): Promise<void> {
    try {
      const options: LiveSchema = {
        model: this.options.model || "nova-2",
        language: this.options.language || "en-US",
        sample_rate: this.options.sampleRate || 16000,
        punctuate: this.options.punctuate !== false,
        profanity_filter: this.options.profanity_filter || false,
        redact: this.options.redact || [],
        diarize: this.options.diarize || false,
        smart_format: this.options.smart_format !== false,
        utterance_end_ms: this.options.utterance_end_ms || 1000,
        interim_results: this.options.interim_results !== false,
        endpointing: this.options.endpointing || 300,
        encoding: "linear16",
        channels: 1,
      };

      this.socket = this.dg.listen.live(options);
      
      if (!this.socket) {
        throw new Error("Failed to create Deepgram socket");
      }
      
      // Set up event listeners
      this.socket.on(LiveTranscriptionEvents.Open, () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.emit("connected");
        
        // Send any buffered audio
        if (this.audioBuffer.length > 0) {
          this.audioBuffer.forEach(chunk => {
            if (this.socket && this.isConnected) {
              this.socket.send(chunk.buffer);
            }
          });
          this.audioBuffer = [];
        }
      });

      this.socket.on(LiveTranscriptionEvents.Transcript, (data: any) => {
        this.lastTranscriptTime = Date.now();
        const channel = data?.channel;
        const alternatives = channel?.alternatives;
        
        if (!alternatives || alternatives.length === 0) return;
        
        const alt = alternatives[0];
        const text = alt?.transcript || "";
        const confidence = alt?.confidence || 0;
        
        if (!text) return;
        
        if (data?.is_final) {
          const duration = data?.duration || 0;
          this.onFinalCb?.(text, confidence, duration);
          this.emit("final", { text, confidence, duration });
        } else {
          this.onPartialCb?.(text, confidence);
          this.emit("partial", { text, confidence });
        }
      });

      this.socket.on(LiveTranscriptionEvents.Metadata, (data: any) => {
        this.onMetadataCb?.(data);
        this.emit("metadata", data);
      });

      this.socket.on(LiveTranscriptionEvents.Error, (error: Error) => {
        // Emit first (so any listeners are notified), then delegate to handler
        this.emit("error", error);
        if (!this.onErrorCb) {
          // If no explicit error callback is registered, ensure it is still handled
          try { this.handleError(error); } catch {}
        } else {
          try { this.onErrorCb(error); } catch {}
          try { this.handleError(error); } catch {}
        }
      });

      this.socket.on(LiveTranscriptionEvents.Close, (code: number, reason: string) => {
        this.isConnected = false;
        this.emit("close", { code, reason });
        
        // Attempt reconnection if not intentionally closed
        if (code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnect();
        }
      });

      this.socket.on(LiveTranscriptionEvents.UtteranceEnd, (data: any) => {
        this.emit("utteranceEnd", data);
      });

    } catch (error) {
      this.handleError(error as Error);
      throw error;
    }
  }

  async pushPcm16(chunk: Uint8Array): Promise<void> {
    if (!this.socket) {
      // Buffer audio if not connected yet
      this.audioBuffer.push(chunk);
      return;
    }
    
    if (!this.isConnected) {
      // Buffer audio during reconnection
      this.audioBuffer.push(chunk);
      return;
    }
    
    try {
      this.socket.send(chunk.buffer);
    } catch (error) {
      this.handleError(error as Error);
      // Buffer the audio for retry
      this.audioBuffer.push(chunk);
    }
  }

  async end(): Promise<void> {
    if (this.socket) {
      try {
        // Send any remaining buffered audio
        if (this.audioBuffer.length > 0 && this.isConnected) {
          for (const chunk of this.audioBuffer) {
            this.socket.send(chunk.buffer);
          }
          this.audioBuffer = [];
        }
        
        // Gracefully close the connection
        this.socket.finish();
        this.socket = null;
        this.isConnected = false;
      } catch (error) {
        this.handleError(error as Error);
      }
    }
  }

  private async reconnect(): Promise<void> {
    this.reconnectAttempts++;
    this.emit("reconnecting", { attempt: this.reconnectAttempts });
    
    setTimeout(async () => {
      try {
        await this.start();
      } catch (error) {
        this.handleError(error as Error);
      }
    }, this.reconnectDelay * this.reconnectAttempts);
  }

  private handleError(error: Error): void {
    console.error("[DeepgramWsAsr] Error:", error);
    this.emit("error", error);
  }

  // Utility methods
  isActive(): boolean {
    return this.isConnected;
  }

  getTimeSinceLastTranscript(): number {
    return Date.now() - this.lastTranscriptTime;
  }

  clearBuffer(): void {
    this.audioBuffer = [];
  }
}
