export interface RealtimeClientOptions {
  baseUrl?: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export interface AudioConfig {
  sampleRate: number;
  channels: number;
  bitDepth: number;
}
