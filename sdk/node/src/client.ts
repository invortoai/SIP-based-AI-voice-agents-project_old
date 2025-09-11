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
import { RealtimeWebSocketClient } from "./realtime-client";

export class InvortoClient implements InvortoClientInterface {
  private apiKey: string;
  private baseUrl: string;
  private tenantId?: string;
  
  constructor(apiKey: string, baseUrl: string = "https://api.invortoai.com", tenantId?: string) {
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
    // Preserve expected ordering in tests: agentId, status, then page, limit, then others
    const params = new URLSearchParams();
    if (options.agentId) params.append("agentId", options.agentId);
    if (options.status) params.append("status", options.status);
    if (options.page) params.append("page", options.page.toString());
    if (options.limit) params.append("limit", options.limit.toString());
    if (options.from) params.append("from", options.from);
    if (options.to) params.append("to", options.to);
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
    const client = new RealtimeWebSocketClient(callId, this.baseUrl, this.apiKey, options);
    await client.connect();
    return client;
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
    // E.164-like validation with length guard (7-15 digits), optional leading +
    const cleaned = phoneNumber.replace(/[\s\-\(\)]/g, '');
    const digits = cleaned.replace(/^\+/, '');
    return /^[1-9]\d{6,14}$/.test(digits);
  }
  
  formatPhoneNumber(phoneNumber: string, countryCode: string = "+91"): string {
    // If already formatted with + prefix, preserve as-is (including spaces)
    if (phoneNumber.trim().startsWith('+')) {
      return phoneNumber;
    }
    // Basic phone number formatting for India
    const cleaned = phoneNumber.replace(/[\s\-\(\)]/g, '');
    
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
    const url = `${this.baseUrl}/metrics`;
    const response = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
      }
    } as RequestInit);
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    return response.text();
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
