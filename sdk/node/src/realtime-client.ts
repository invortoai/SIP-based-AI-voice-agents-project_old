import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { RealtimeConnection, RealtimeOptions, RealtimeEvent } from './types';

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
    baseUrl: string,
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
        const wsBase = this.baseUrl.replace(/^http/, 'ws').replace(/\/+$/, '');
        const wsUrl = `${wsBase}/realtime/voice?callId=${encodeURIComponent(this.callId)}`;
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

          // Send initial connection message (server expects 't' field)
          this.send({
            t: 'start',
            callId: this.callId,
            options: this.options
          });

          // Emit connected event
          const connectedEvent: RealtimeEvent = {
            type: 'connected',
            callId: this.callId,
            timestamp: new Date().toISOString()
          };
          this.emitEvent(connectedEvent);
          resolve();
        });

        this.ws.on('message', (data: Buffer) => {
          this.handleMessage(data);
        });

        this.ws.on('error', (error) => {
          console.error('WebSocket error:', error);
          const errorEvent: RealtimeEvent = {
            type: 'error',
            message: error.message,
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

  private handleMessage(data: Buffer): void {
    try {
      const message = JSON.parse(data.toString());
      const t = message.t || message.type;

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