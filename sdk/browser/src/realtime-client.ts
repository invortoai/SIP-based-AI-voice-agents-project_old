import type { WsInbound, WsOutbound } from "@invorto/shared";

export interface RealtimeOptions {
  audioFormat?: 'linear16' | 'mulaw' | 'alaw';
  sampleRate?: number;
  channels?: number;
  enableRecording?: boolean;
  enableTranscription?: boolean;
  reconnectAttempts?: number;
  reconnectDelay?: number;
}

export interface AudioConfig {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  format: 'linear16' | 'mulaw' | 'alaw';
}

export interface CallStats {
  duration: number;
  audioPacketsSent: number;
  audioPacketsReceived: number;
  transcriptionEvents: number;
  ttsEvents: number;
  errors: number;
}

export interface RealtimeEvent {
  type: string;
  data: any;
  timestamp: number;
}

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private callId: string | null = null;
  private agentId: string | null = null;
  private apiKey: string | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 3;
  private reconnectDelay: number = 1000;
  private isReconnecting: boolean = false;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private audioProcessor: ScriptProcessorNode | null = null;
  
  // Event handlers
  private onMessage: ((message: WsOutbound) => void) | null = null;
  private onError: ((error: Event) => void) | null = null;
  private onClose: (() => void) | null = null;
  private onConnect: (() => void) | null = null;
  private onDisconnect: (() => void) | null = null;
  private onAudio: ((audioData: Float32Array) => void) | null = null;
  private onTranscription: ((text: string, isFinal: boolean) => void) | null = null;
  private onTTS: ((audioData: ArrayBuffer) => void) | null = null;
  
  // Statistics
  private stats: CallStats = {
    duration: 0,
    audioPacketsSent: 0,
    audioPacketsReceived: 0,
    transcriptionEvents: 0,
    ttsEvents: 0,
    errors: 0
  };
  
  // Event history
  private events: RealtimeEvent[] = [];
  
  constructor(
    private baseUrl: string = "wss://api.invortoai.com/realtime/voice",
    private options: RealtimeOptions = {}
  ) {
    this.maxReconnectAttempts = options.reconnectAttempts || 3;
    this.reconnectDelay = options.reconnectDelay || 1000;
  }
  
  async connect(callId: string, agentId: string, apiKey: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.callId = callId;
      this.agentId = agentId;
      this.apiKey = apiKey;
      
      const base = this.baseUrl.replace(/\/+$/, "");
      const qp = new URLSearchParams();
  
      // Prefer subprotocol for API key if available; also support query fallback
      if (apiKey) qp.set("api_key", apiKey);
  
      // Optional params
      if (agentId) qp.set("agentId", agentId);
      if (this.options.sampleRate) qp.set("rate", String(this.options.sampleRate));
      if (this.options.channels) qp.set("channels", String(this.options.channels));
      if (this.options.audioFormat) qp.set("codec", this.options.audioFormat);
  
      // Optional HMAC signature parameters (sig + ts) for serverside verification
      const sig = (this.options as any)?.signature as string | undefined;
      const ts = (this.options as any)?.ts as string | number | undefined;
      if (sig && ts) {
        qp.set("sig", String(sig));
        qp.set("ts", String(ts));
      }
  
      const qs = qp.toString();
      const pathBase = base.includes("/realtime/voice") ? base : `${base}/realtime/voice`;
      const url = `${pathBase}?callId=${encodeURIComponent(callId)}${qs ? `&${qs}` : ""}`;
  
      // Use subprotocol to carry API key when possible
      this.ws = apiKey ? new WebSocket(url, [apiKey]) : new WebSocket(url);
      
      this.ws.onopen = () => {
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        
        // Send start message
        const startMessage: WsInbound = {
          t: "start",
          callId,
          agentId
        };
        this.ws!.send(JSON.stringify(startMessage));
        
        this.emitEvent('connect', { callId, agentId });
        if (this.onConnect) this.onConnect();
        resolve();
      };
      
      this.ws.onmessage = (event) => {
        try {
          const message: WsOutbound = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error("Failed to parse WebSocket message:", error);
          this.stats.errors++;
        }
      };
      
      this.ws.onerror = (error) => {
        this.stats.errors++;
        if (this.onError) {
          this.onError(error);
        }
        reject(error);
      };
      
      this.ws.onclose = (event) => {
        this.emitEvent('close', { code: event.code, reason: event.reason });
        if (this.onClose) this.onClose();
        
        // Attempt reconnection if not intentional
        if (event.code !== 1000 && !this.isReconnecting && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.attemptReconnect();
        }
      };
    });
  }
  
  private handleMessage(message: WsOutbound): void {
    this.emitEvent('message', message);
    
    if (this.onMessage) {
      this.onMessage(message);
    }
    
    // Handle specific message types
    switch (message.t) {
      case 'stt.partial':
      case 'stt.final':
        this.stats.transcriptionEvents++;
        if (this.onTranscription) {
          this.onTranscription((message as any).text || '', message.t === 'stt.final');
        }
        break;
      case 'llm.delta':
      case 'tool.call':
        // Handled via onMessage hook if consumers need it
        break;
      case 'tts.chunk':
        this.stats.ttsEvents++;
        if (this.onTTS) {
          // Handle multiple possible encodings defensively
          const pcm = (message as any).pcm16 as Uint8Array | string | number[] | undefined;
          let buffer: ArrayBuffer | null = null;
          if (pcm instanceof Uint8Array) {
            // Ensure we always produce an ArrayBuffer (not SharedArrayBuffer) by copying
            const copy = new Uint8Array(pcm.byteLength);
            copy.set(pcm);
            buffer = copy.buffer;
          } else if (Array.isArray(pcm)) {
            const arr = new Uint8Array(pcm);
            buffer = arr.buffer;
          } else if (typeof pcm === 'string') {
            buffer = this.base64ToArrayBuffer(pcm);
          }
          if (buffer) this.onTTS(buffer);
        }
        break;
      case 'control.bargein':
      case 'emotion.window':
      case 'emotion.state':
      case 'end':
        // No-op here; exposed via onMessage and specific handlers if set
        break;
      default:
        // Ignore unknown message types
        break;
    }
  }
  
  private emitEvent(type: string, data: any): void {
    const event: RealtimeEvent = {
      type,
      data,
      timestamp: Date.now()
    };
    this.events.push(event);
  }
  
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
  
  private async attemptReconnect(): Promise<void> {
    if (this.isReconnecting || !this.callId || !this.agentId || !this.apiKey) {
      return;
    }
    
    this.isReconnecting = true;
    this.reconnectAttempts++;
    
    console.log(`Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
    
    setTimeout(async () => {
      try {
        await this.connect(this.callId!, this.agentId!, this.apiKey!);
      } catch (error) {
        console.error('Reconnection failed:', error);
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.attemptReconnect();
        }
      }
    }, this.reconnectDelay * this.reconnectAttempts);
  }
  
  // Audio handling
  async startAudioCapture(): Promise<void> {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: this.options.sampleRate || 16000,
          channelCount: this.options.channels || 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      
      this.audioContext = new AudioContext({
        sampleRate: this.options.sampleRate || 16000
      });
      
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.audioProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
      
      this.audioProcessor.onaudioprocess = (event) => {
        const inputBuffer = event.inputBuffer;
        const inputData = inputBuffer.getChannelData(0);
        
        // Convert to 16-bit PCM
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcm16[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
        }
        
        // Send audio data
        this.sendAudio(pcm16);
        
        if (this.onAudio) {
          this.onAudio(inputData);
        }
      };
      
      source.connect(this.audioProcessor);
      this.audioProcessor.connect(this.audioContext.destination);
      
    } catch (error) {
      console.error('Failed to start audio capture:', error);
      throw error;
    }
  }
  
  stopAudioCapture(): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    
    if (this.audioProcessor) {
      this.audioProcessor.disconnect();
      this.audioProcessor = null;
    }
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
  
  // Message sending
  sendAudio(audioData: Int16Array | Uint8Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }
    
    this.ws.send(audioData);
    this.stats.audioPacketsSent++;
  }
  
  sendMessage(message: WsInbound): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }
    
    this.ws.send(JSON.stringify(message));
  }
  
  sendToolResult(id: string, result: Record<string, unknown>): void {
    const toolResultMessage: WsInbound = {
      t: "tool.result",
      id,
      result
    };
    this.sendMessage(toolResultMessage);
  }
  
  sendDTMF(digits: string, method: "rfc2833" | "info" = "rfc2833"): void {
    const dtmfMessage: WsInbound = {
      t: "dtmf.send",
      digits,
      method
    };
    this.sendMessage(dtmfMessage);
  }
  
  sendTransfer(to: string, mode: "blind" | "attended" = "blind"): void {
    const transferMessage: WsInbound = {
      t: "transfer",
      to,
      mode
    };
    this.sendMessage(transferMessage);
  }
  
  
  
  
  
  // Call control
  async endCall(): Promise<void> {
    if (!this.callId) return;
    
    try {
      // Derive API base from WS base (supports defaults and custom paths)
      const wsUrl = new URL(this.baseUrl);
      const apiOrigin = `${wsUrl.protocol.startsWith('wss') ? 'https:' : 'http:'}//${wsUrl.host}`;
      const apiUrl = `${apiOrigin}/v1/realtime/${this.callId}/end`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to end call: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Failed to end call via API:', error);
    }
    
    this.disconnect();
  }
  
  // Statistics and monitoring
  getStats(): CallStats {
    return { ...this.stats };
  }
  
  getEvents(): RealtimeEvent[] {
    return [...this.events];
  }
  
  getConnectionState(): string {
    if (!this.ws) return 'disconnected';
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING: return 'connecting';
      case WebSocket.OPEN: return 'connected';
      case WebSocket.CLOSING: return 'closing';
      case WebSocket.CLOSED: return 'closed';
      default: return 'unknown';
    }
  }
  
  // Disconnection
  disconnect(): void {
    this.stopAudioCapture();
    
    if (this.ws) {
      this.ws.close(1000, 'User initiated disconnect');
      this.ws = null;
    }
    
    this.emitEvent('disconnect', { callId: this.callId });
    if (this.onDisconnect) this.onDisconnect();
    
    this.callId = null;
    this.agentId = null;
    this.apiKey = null;
  }
  
  // Event handlers
  on(event: "message", handler: (message: WsOutbound) => void): void;
  on(event: "error", handler: (error: Event) => void): void;
  on(event: "close", handler: () => void): void;
  on(event: "connect", handler: () => void): void;
  on(event: "disconnect", handler: () => void): void;
  on(event: "audio", handler: (audioData: Float32Array) => void): void;
  on(event: "transcription", handler: (text: string, isFinal: boolean) => void): void;
  on(event: "tts", handler: (audioData: ArrayBuffer) => void): void;
  on(event: string, handler: any): void {
    switch (event) {
      case "message":
        this.onMessage = handler;
        break;
      case "error":
        this.onError = handler;
        break;
      case "close":
        this.onClose = handler;
        break;
      case "connect":
        this.onConnect = handler;
        break;
      case "disconnect":
        this.onDisconnect = handler;
        break;
      case "audio":
        this.onAudio = handler;
        break;
      case "transcription":
        this.onTranscription = handler;
        break;
      case "tts":
        this.onTTS = handler;
        break;
    }
  }
}
