import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { RealtimeConnection, RealtimeOptions, RealtimeEvent } from './types';
import type { WsInbound, WsOutbound } from '@invorto/shared';
import { z } from 'zod';

/**
 * Runtime validator for WsOutbound messages to protect SDK consumers.
 * Accepts only the shapes used by the SDK and ignores unknown types.
 */
const SttPartialSchema = z.object({
  t: z.literal('stt.partial'),
  text: z.string(),
  ts: z.number().optional()
});
const SttFinalSchema = z.object({
  t: z.literal('stt.final'),
  text: z.string(),
  ts: z.number().optional()
});
const TtsChunkSchema = z.object({
  t: z.literal('tts.chunk'),
  // Server may send base64 string or numeric array; handle both
  pcm16: z.union([z.string(), z.array(z.number()), z.any()]).optional(),
});
const ConnectedSchema = z.object({
  t: z.literal('connected'),
  callId: z.string().optional(),
  timestamp: z.number().optional()
});
const ErrorSchema = z.object({
  t: z.literal('error'),
  message: z.string()
});
const PongSchema = z.object({
  t: z.literal('pong'),
  timestamp: z.number().optional()
});

function validateOutbound(msg: any): { ok: boolean; error?: string } {
  try {
    const t = msg?.t;
    switch (t) {
      case 'stt.partial':
        SttPartialSchema.parse(msg);
        break;
      case 'stt.final':
        SttFinalSchema.parse(msg);
        break;
      case 'tts.chunk':
        TtsChunkSchema.parse(msg);
        break;
      case 'connected':
        ConnectedSchema.parse(msg);
        break;
      case 'error':
        ErrorSchema.parse(msg);
        break;
      case 'pong':
        PongSchema.parse(msg);
        break;
      default:
        // Unknown message types are forwarded to consumer as-is
        return { ok: true };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as any)?.message || 'invalid_message' };
  }
}

export class RealtimeWebSocketClient extends EventEmitter implements RealtimeConnection {
  private ws: WebSocket | null = null;
  private _callId: string;
  private _connectionId: string;
  private baseUrl: string;
  private apiKey: string;
  private options: RealtimeOptions;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private reconnectDelay = 1000;
  private isReconnecting = false;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private audioCallback: ((audioData: Buffer) => void) | null = null;
  private eventCallback: ((event: RealtimeEvent) => void) | null = null;

  constructor(
    callId: string,
    baseUrl: string = process.env.API_BASE_URL || 'https://api.invortoai.com',
    apiKey: string,
    options: RealtimeOptions = {}
  ) {
    super();
    this._callId = callId;
    this._connectionId = `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.options = {
      audioFormat: 'linear16',
      sampleRate: 16000,
      channels: 1,
      enableRecording: true,
      enableTranscription: true,
      ...options
    };
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const explicitWs = process.env.REALTIME_WS_URL?.replace(/\/+$/, '');
        let wsUrl: string;
        if (explicitWs) {
          wsUrl = explicitWs.includes('/realtime/voice')
            ? `${explicitWs}?callId=${encodeURIComponent(this.callId)}`
            : `${explicitWs}/${encodeURIComponent(this.callId)}`;
        } else {
          const wsBase = this.baseUrl.replace(/^http/, 'ws').replace(/\/+$/, '');
          wsUrl = `${wsBase}/realtime/voice?callId=${encodeURIComponent(this.callId)}`;
        }
        // Append agentId if provided
        if (this.options?.agentId) {
          wsUrl += (wsUrl.includes('?') ? '&' : '?') + `agentId=${encodeURIComponent(this.options.agentId)}`;
        }

        const protocols = this.apiKey ? [this.apiKey] : undefined;
        this.ws = new WebSocket(wsUrl, protocols, {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`
          }
        });

        this.ws.on('open', () => {
          console.log(`WebSocket connected for call ${this.callId}`);
          this.reconnectAttempts = 0;
          this.isReconnecting = false;
          this.startHeartbeat();

          // Send initial connection message (align with shared schema + server validation)
          const startMsg: WsInbound = {
            t: 'start',
            callId: this.callId,
            agentId: this.options?.agentId ?? 'node-sdk'
          } as any;
          this.send(startMsg);

          // Emit connected event
          const connectedEvent: RealtimeEvent = {
            type: 'connected',
            callId: this.callId,
            timestamp: new Date().toISOString()
          };
          this.emitEvent(connectedEvent);
          resolve();
        });

        this.ws.on('message', (data) => {
          this.handleMessage(data as any);
        });

        this.ws.on('error', (error) => {
          console.error('WebSocket error:', error);
          const errorEvent: RealtimeEvent = {
            type: 'error',
            message: (error as any)?.message ?? 'ws_error',
            timestamp: new Date().toISOString()
          };
          this.emitEvent(errorEvent);
          reject(error);
        });

        this.ws.on('close', (code, reason) => {
          console.log(`WebSocket closed: ${code} - ${reason}`);
          this.stopHeartbeat();

          if (code !== 1000 && !this.isReconnecting && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.attemptReconnect();
          }
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send({ t: 'ping', timestamp: Date.now() });
      }
    }, 30000); // Send heartbeat every 30 seconds
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private async attemptReconnect(): Promise<void> {
    if (this.isReconnecting) return;

    this.isReconnecting = true;
    this.reconnectAttempts++;

    console.log(`Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);

    setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        console.error('Reconnection failed:', error);
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.attemptReconnect();
        } else {
          const errorEvent: RealtimeEvent = {
            type: 'error',
            message: 'Failed to reconnect after maximum attempts',
            timestamp: new Date().toISOString()
          };
          this.emitEvent(errorEvent);
        }
      }
    }, this.reconnectDelay * this.reconnectAttempts);
  }

  private handleMessage(data: WebSocket.RawData): void {
    try {
      const raw = typeof data === 'string'
        ? data
        : Buffer.isBuffer(data)
          ? data.toString()
          : data instanceof ArrayBuffer
            ? Buffer.from(new Uint8Array(data)).toString()
            : (data as any)?.toString?.() ?? '';
      const message = JSON.parse(raw);
      const t = message.t || message.type;

      // Runtime validation; emit error event for invalid payloads and stop processing
      const validation = validateOutbound(message);
      if (!validation.ok) {
        const errorEvent: RealtimeEvent = {
          type: 'error',
          message: validation.error || 'invalid_message',
          timestamp: new Date().toISOString()
        };
        this.emitEvent(errorEvent);
        return;
      }

      switch (t) {
        case 'pong':
          // Heartbeat response - ignore
          break;

        case 'stt.partial':
        case 'stt.final': {
          const transcriptionEvent: RealtimeEvent = {
            type: 'transcription',
            text: message.text,
            isFinal: t === 'stt.final',
            timestamp: new Date().toISOString()
          };
          this.emitEvent(transcriptionEvent);
          break;
        }

        case 'tts.chunk': {
          if (message.pcm16) {
            let audioBuffer: Buffer | null = null;
            if (typeof message.pcm16 === 'string') {
              // base64
              audioBuffer = Buffer.from(message.pcm16, 'base64');
            } else if (Array.isArray(message.pcm16)) {
              audioBuffer = Buffer.from(Uint8Array.from(message.pcm16));
            }
            if (audioBuffer) {
              this.audioCallback?.(audioBuffer);
              const audioEvent: RealtimeEvent = {
                type: 'audio',
                data: audioBuffer,
                timestamp: new Date().toISOString()
              };
              this.emitEvent(audioEvent);
            }
          }
          break;
        }

        case 'connected': {
          const connectedEvent: RealtimeEvent = {
            type: 'connected',
            callId: this.callId,
            timestamp: new Date().toISOString()
          };
          this.emitEvent(connectedEvent);
          break;
        }

        case 'call.ended': {
          const endEvent: RealtimeEvent = {
            type: 'call.ended',
            reason: message.reason || 'Unknown',
            timestamp: new Date().toISOString()
          };
          this.emitEvent(endEvent);
          break;
        }

        case 'error': {
          const errorEvent: RealtimeEvent = {
            type: 'error',
            message: message.message,
            timestamp: new Date().toISOString()
          };
          this.emitEvent(errorEvent);
          break;
        }

        default:
          // Forward any other message
          this.emit('message', message);
          break;
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
      const errorEvent: RealtimeEvent = {
        type: 'error',
        message: 'Failed to parse message',
        timestamp: new Date().toISOString()
      };
      this.emitEvent(errorEvent);
    }
  }

  private send(message: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket not connected, cannot send message');
    }
  }

  private emitEvent(event: RealtimeEvent): void {
    if (this.eventCallback) {
      this.eventCallback(event);
    }
    this.emit('event', event);
  }

  // Public API methods
  async sendAudio(audioData: Buffer): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    // Server expects raw PCM16 little-endian frames over WS (binary)
    this.ws.send(audioData);
  }

  onAudio(callback: (audioData: Buffer) => void): void {
    this.audioCallback = callback;
  }

  onEvent(callback: (event: RealtimeEvent) => void): void {
    this.eventCallback = callback;
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close(1000, 'Client disconnecting');
      this.ws = null;
    }

    this.removeAllListeners();
  }

  // Getters
  get callId(): string {
    return this._callId;
  }

  get connectionId(): string {
    return this._connectionId;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // Control methods
  sendDTMF(digits: string): void {
    this.send({
      t: 'dtmf.send',
      digits,
      method: 'rfc2833',
      timestamp: Date.now()
    });
  }

  mute(): void {
    // Map to pause
    this.send({ t: 'pause', timestamp: Date.now() });
  }

  unmute(): void {
    // Map to resume
    this.send({ t: 'resume', timestamp: Date.now() });
  }

  hold(): void {
    this.send({ t: 'pause', timestamp: Date.now() });
  }

  unhold(): void {
    this.send({ t: 'resume', timestamp: Date.now() });
  }

  transfer(to: string, mode: 'blind' | 'attended' = 'blind'): void {
    this.send({
      t: 'transfer',
      to,
      mode,
      timestamp: Date.now()
    });
  }

  endCall(): void {
    // Prefer closing socket; server will emit call.ended on close
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000, 'Client disconnecting');
    }
  }
}