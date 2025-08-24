export interface InvortoClientInterface {
  // Agent Management
  createAgent(config: AgentConfig): Promise<AgentResponse>;
  getAgent(agentId: string): Promise<Agent>;
  listAgents(options?: ListOptions): Promise<PaginatedResponse<Agent>>;
  updateAgent(agentId: string, updates: Partial<AgentConfig>): Promise<Agent>;
  deleteAgent(agentId: string): Promise<DeleteResponse>;
  
  // Call Management
  createCall(options: CallOptions): Promise<CallResponse>;
  getCall(callId: string): Promise<Call>;
  listCalls(options?: CallListOptions): Promise<PaginatedResponse<Call>>;
  updateCallStatus(callId: string, status: string, metadata?: Record<string, any>): Promise<Call>;
  getCallTimeline(callId: string): Promise<TimelineEvent[]>;
  getCallArtifacts(callId: string): Promise<CallArtifacts>;
  
  // Real-time Communication
  connectToCall(callId: string, options?: RealtimeOptions): Promise<RealtimeConnection>;
  
  // Webhooks
  createWebhook(config: WebhookConfig): Promise<WebhookResponse>;
  listWebhooks(): Promise<Webhook[]>;
  deleteWebhook(webhookId: string): Promise<DeleteResponse>;
  
  // Analytics & Usage
  getTenantUsage(tenantId: string, period?: string): Promise<TenantUsage>;
  getCallAnalytics(callId: string): Promise<CallAnalytics>;
  
  // Utilities
  validatePhoneNumber(phoneNumber: string): boolean;
  formatPhoneNumber(phoneNumber: string, countryCode?: string): string;
}

export interface AgentConfig {
  name: string;
  prompt: string;
  voice?: string;
  locale?: string;
  temperature?: number;
  model?: string;
  maxTokens?: number;
  systemPrompt?: string;
  tools?: Tool[];
  metadata?: Record<string, any>;
}

export interface Agent {
  id: string;
  name: string;
  config: AgentConfig;
  status: 'active' | 'inactive' | 'draft';
  tenantId: string;
  createdAt: string;
  updatedAt: string;
  stats?: AgentStats;
}

export interface AgentStats {
  totalCalls: number;
  averageCost: number;
  totalDuration: number;
  successRate: number;
}

export interface CallOptions {
  agentId: string;
  to: string;
  from?: string;
  direction: "inbound" | "outbound";
  metadata?: Record<string, any>;
  recording?: boolean;
  transcription?: boolean;
}

export interface Call {
  id: string;
  agentId: string;
  direction: string;
  fromNum: string;
  toNum: string;
  status: string;
  startedAt: string;
  endedAt?: string;
  duration?: number;
  costInr?: number;
  metadata?: Record<string, any>;
  costs?: CallCost[];
}

export interface CallCost {
  component: string;
  amount: number;
  currency: string;
  description: string;
}

export interface CallResponse {
  id: string;
  status: string;
  message?: string;
}

export interface TimelineEvent {
  id: string;
  kind: string;
  payload: any;
  timestamp: string;
}

export interface CallArtifacts {
  recording?: string;
  transcription?: string;
  summary?: string;
  metadata?: Record<string, any>;
}

export interface RealtimeOptions {
  audioFormat?: 'linear16' | 'mulaw' | 'alaw';
  sampleRate?: number;
  channels?: number;
  enableRecording?: boolean;
  enableTranscription?: boolean;
}

export interface RealtimeConnection {
  callId: string;
  connectionId: string;
  sendAudio: (audioData: Buffer) => Promise<void>;
  onAudio: (callback: (audioData: Buffer) => void) => void;
  onEvent: (callback: (event: any) => void) => void;
  disconnect: () => Promise<void>;
}

export interface WebhookConfig {
  url: string;
  events: string[];
  secret?: string;
  headers?: Record<string, string>;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  status: 'active' | 'inactive';
  createdAt: string;
}

export interface WebhookResponse {
  id: string;
  status: string;
}

export interface TenantUsage {
  tenantId: string;
  period: string;
  calls: {
    total: number;
    completed: number;
    failed: number;
    averageCost: number;
    totalCost: number;
    averageDuration: number;
  };
  agents: {
    total: number;
    active: number;
  };
}

export interface CallAnalytics {
  callId: string;
  totalEvents: number;
  eventTypes: Record<string, number>;
  duration: number;
  sentiment: string;
  topics: string[];
}

export interface ListOptions {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface CallListOptions extends ListOptions {
  agentId?: string;
  from?: string;
  to?: string;
  status?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export interface DeleteResponse {
  success: boolean;
  deleted: any;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, any>;
  required?: string[];
}

export interface ErrorResponse {
  code: string;
  message: string;
  details?: any;
}

// Event types for real-time communication
export type RealtimeEvent = 
  | { type: 'connected'; callId: string; timestamp: string }
  | { type: 'audio'; data: Buffer; timestamp: string }
  | { type: 'transcription'; text: string; isFinal: boolean; timestamp: string }
  | { type: 'tts'; audio: Buffer; timestamp: string }
  | { type: 'error'; message: string; timestamp: string }
  | { type: 'call.ended'; reason: string; timestamp: string };
