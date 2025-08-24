import { 
  InvortoClientInterface, 
  AgentConfig, 
  Agent, 
  CallOptions, 
  Call, 
  CallResponse,
  ListOptions,
  CallListOptions,
  PaginatedResponse,
  DeleteResponse,
  TimelineEvent,
  CallArtifacts,
  RealtimeOptions,
  RealtimeConnection,
  WebhookConfig,
  Webhook,
  WebhookResponse,
  TenantUsage,
  CallAnalytics,
  RealtimeEvent
} from "./types";

export class InvortoClient implements InvortoClientInterface {
  private apiKey: string;
  private baseUrl: string;
  private tenantId?: string;
  
  constructor(apiKey: string, baseUrl: string = "https://api.invorto.ai", tenantId?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.tenantId = tenantId;
  }
  
  private async makeRequest<T>(
    endpoint: string, 
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      ...options.headers as Record<string, string>
    };
    
    if (this.tenantId) {
      headers["x-tenant-id"] = this.tenantId;
    }
    
    const response = await fetch(url, {
      ...options,
      headers
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorData.message || ''}`);
    }
    
    return response.json();
  }
  
  // Agent Management
  async createAgent(config: AgentConfig): Promise<Agent> {
    return this.makeRequest<Agent>("/v1/agents", {
      method: "POST",
      body: JSON.stringify(config)
    });
  }
  
  async getAgent(agentId: string): Promise<Agent> {
    return this.makeRequest<Agent>(`/v1/agents/${agentId}`);
  }
  
  async listAgents(options: ListOptions = {}): Promise<PaginatedResponse<Agent>> {
    const params = new URLSearchParams();
    if (options.page) params.append("page", options.page.toString());
    if (options.limit) params.append("limit", options.limit.toString());
    if (options.search) params.append("search", options.search);
    if (options.status) params.append("status", options.status);
    if (options.sortBy) params.append("sortBy", options.sortBy);
    if (options.sortOrder) params.append("sortOrder", options.sortOrder);
    
    const query = params.toString();
    const endpoint = query ? `/v1/agents?${query}` : "/v1/agents";
    
    return this.makeRequest<PaginatedResponse<Agent>>(endpoint);
  }
  
  async updateAgent(agentId: string, updates: Partial<AgentConfig>): Promise<Agent> {
    return this.makeRequest<Agent>(`/v1/agents/${agentId}`, {
      method: "PATCH",
      body: JSON.stringify(updates)
    });
  }
  
  async deleteAgent(agentId: string): Promise<DeleteResponse> {
    return this.makeRequest<DeleteResponse>(`/v1/agents/${agentId}`, {
      method: "DELETE"
    });
  }
  
  // Call Management
  async createCall(options: CallOptions): Promise<CallResponse> {
    return this.makeRequest<CallResponse>("/v1/calls", {
      method: "POST",
      body: JSON.stringify(options)
    });
  }
  
  async getCall(callId: string): Promise<Call> {
    return this.makeRequest<Call>(`/v1/calls/${callId}`);
  }
  
  async listCalls(options: CallListOptions = {}): Promise<PaginatedResponse<Call>> {
    const params = new URLSearchParams();
    if (options.page) params.append("page", options.page.toString());
    if (options.limit) params.append("limit", options.limit.toString());
    if (options.agentId) params.append("agentId", options.agentId);
    if (options.from) params.append("from", options.from);
    if (options.to) params.append("to", options.to);
    if (options.status) params.append("status", options.status);
    if (options.search) params.append("search", options.search);
    if (options.sortBy) params.append("sortBy", options.sortBy);
    if (options.sortOrder) params.append("sortOrder", options.sortOrder);
    
    const query = params.toString();
    const endpoint = query ? `/v1/calls?${query}` : "/v1/calls";
    
    return this.makeRequest<PaginatedResponse<Call>>(endpoint);
  }
  
  async updateCallStatus(callId: string, status: string, metadata?: Record<string, any>): Promise<Call> {
    return this.makeRequest<Call>(`/v1/calls/${callId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, metadata })
    });
  }
  
  async getCallTimeline(callId: string): Promise<TimelineEvent[]> {
    const response = await this.makeRequest<{ callId: string; timeline: TimelineEvent[] }>(`/v1/calls/${callId}/timeline`);
    return response.timeline;
  }
  
  async getCallArtifacts(callId: string): Promise<CallArtifacts> {
    return this.makeRequest<CallArtifacts>(`/v1/calls/${callId}/artifacts`);
  }
  
  // Real-time Communication
  async connectToCall(callId: string, options: RealtimeOptions = {}): Promise<RealtimeConnection> {
    const wsUrl = this.baseUrl.replace('https://', 'wss://').replace('http://', 'ws://');
    const connectionUrl = `${wsUrl}/v1/realtime/${callId}`;
    
    // For now, return a mock connection - in a real implementation, this would establish WebSocket connection
    const connection: RealtimeConnection = {
      callId,
      connectionId: `conn_${Date.now()}`,
      sendAudio: async (audioData: Buffer) => {
        // Implementation would send audio over WebSocket
        console.log(`Sending ${audioData.length} bytes of audio data`);
      },
      onAudio: (callback: (audioData: Buffer) => void) => {
        // Implementation would set up audio event listener
        console.log('Audio callback registered');
      },
      onEvent: (callback: (event: RealtimeEvent) => void) => {
        // Implementation would set up event listener
        console.log('Event callback registered');
      },
      disconnect: async () => {
        // Implementation would close WebSocket connection
        console.log('Disconnecting from realtime session');
      }
    };
    
    return connection;
  }
  
  // Webhooks (placeholder - would need webhook management API)
  async createWebhook(config: WebhookConfig): Promise<WebhookResponse> {
    throw new Error("Webhook management not yet implemented in API");
  }
  
  async listWebhooks(): Promise<Webhook[]> {
    throw new Error("Webhook management not yet implemented in API");
  }
  
  async deleteWebhook(webhookId: string): Promise<DeleteResponse> {
    throw new Error("Webhook management not yet implemented in API");
  }
  
  // Analytics & Usage
  async getTenantUsage(tenantId: string, period: string = "24h"): Promise<TenantUsage> {
    return this.makeRequest<TenantUsage>(`/v1/tenants/${tenantId}/usage?period=${period}`);
  }
  
  async getCallAnalytics(callId: string): Promise<CallAnalytics> {
    return this.makeRequest<CallAnalytics>(`/v1/realtime/${callId}/stats`);
  }
  
  // Utilities
  validatePhoneNumber(phoneNumber: string): boolean {
    // Basic phone number validation
    const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
    return phoneRegex.test(phoneNumber.replace(/[\s\-\(\)]/g, ''));
  }
  
  formatPhoneNumber(phoneNumber: string, countryCode: string = "+91"): string {
    // Basic phone number formatting for India
    const cleaned = phoneNumber.replace(/[\s\-\(\)]/g, '');
    
    if (cleaned.startsWith('+')) {
      return cleaned;
    }
    
    if (cleaned.startsWith('0')) {
      return countryCode + cleaned.substring(1);
    }
    
    if (cleaned.startsWith('91') && cleaned.length === 12) {
      return '+' + cleaned;
    }
    
    if (cleaned.length === 10) {
      return countryCode + cleaned;
    }
    
    return phoneNumber; // Return original if can't format
  }
  
  // Additional utility methods
  async healthCheck(): Promise<{ ok: boolean; service: string }> {
    return this.makeRequest<{ ok: boolean; service: string }>("/health");
  }
  
  async getMetrics(): Promise<string> {
    return this.makeRequest<string>("/metrics");
  }
  
  // Batch operations
  async createMultipleAgents(configs: AgentConfig[]): Promise<Agent[]> {
    const promises = configs.map(config => this.createAgent(config));
    return Promise.all(promises);
  }
  
  async createMultipleCalls(callOptions: CallOptions[]): Promise<CallResponse[]> {
    const promises = callOptions.map(options => this.createCall(options));
    return Promise.all(promises);
  }
}
