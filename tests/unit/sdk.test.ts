/// <reference path="../jest-globals.d.ts" />
import { InvortoClient } from '../../sdk/node/src/client';
import { AgentConfig, CallOptions } from '../../sdk/node/src/types';

// Mock fetch globally
global.fetch = jest.fn() as any;

describe('InvortoClient', () => {
  let client: InvortoClient;
  const mockApiKey = 'test-api-key';
  const mockBaseUrl = 'https://api.test.com';

  beforeEach(() => {
    client = new InvortoClient(mockApiKey, mockBaseUrl);
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      const defaultClient = new InvortoClient(mockApiKey);
      expect(defaultClient).toBeInstanceOf(InvortoClient);
    });

    it('should initialize with custom base URL', () => {
      expect(client).toBeInstanceOf(InvortoClient);
    });

    it('should initialize with tenant ID', () => {
      const tenantClient = new InvortoClient(mockApiKey, mockBaseUrl, 'tenant-123');
      expect(tenantClient).toBeInstanceOf(InvortoClient);
    });
  });

  describe('agent management', () => {
    const mockAgentConfig: AgentConfig = {
      name: 'Test Agent',
      prompt: 'You are a helpful assistant',
      voice: 'aura-2',
      locale: 'en-IN',
      temperature: 0.7
    };

    it('should create an agent successfully', async () => {
      const mockResponse = { id: 'agent-123', name: 'Test Agent' };
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await client.createAgent(mockAgentConfig);
      expect(result).toEqual(mockResponse);
      expect(fetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/v1/agents`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': `Bearer ${mockApiKey}`,
            'Content-Type': 'application/json'
          }),
          body: JSON.stringify(mockAgentConfig)
        })
      );
    });

    it('should get an agent successfully', async () => {
      const mockResponse = { id: 'agent-123', name: 'Test Agent' };
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await client.getAgent('agent-123');
      expect(result).toEqual(mockResponse);
      expect(fetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/v1/agents/agent-123`,
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': `Bearer ${mockApiKey}`
          })
        })
      );
    });

    it('should list agents with pagination', async () => {
      const mockResponse = {
        data: [{ id: 'agent-123', name: 'Test Agent' }],
        pagination: { page: 1, limit: 10, total: 1, pages: 1 }
      };
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await client.listAgents({ page: 1, limit: 10 });
      expect(result).toEqual(mockResponse);
      expect(fetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/v1/agents?page=1&limit=10`,
        expect.any(Object)
      );
    });

    it('should update an agent successfully', async () => {
      const mockResponse = { id: 'agent-123', name: 'Updated Agent' };
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const updates = { name: 'Updated Agent' };
      const result = await client.updateAgent('agent-123', updates);
      expect(result).toEqual(mockResponse);
      expect(fetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/v1/agents/agent-123`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify(updates)
        })
      );
    });

    it('should delete an agent successfully', async () => {
      const mockResponse = { success: true, deleted: { id: 'agent-123' } };
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await client.deleteAgent('agent-123');
      expect(result).toEqual(mockResponse);
      expect(fetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/v1/agents/agent-123`,
        expect.objectContaining({
          method: 'DELETE'
        })
      );
    });
  });

  describe('call management', () => {
    const mockCallOptions: CallOptions = {
      agentId: 'agent-123',
      to: '+1234567890',
      direction: 'outbound',
      recording: true,
      transcription: true
    };

    it('should create a call successfully', async () => {
      const mockResponse = { id: 'call-123', status: 'created' };
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await client.createCall(mockCallOptions);
      expect(result).toEqual(mockResponse);
      expect(fetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/v1/calls`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(mockCallOptions)
        })
      );
    });

    it('should get a call successfully', async () => {
      const mockResponse = { id: 'call-123', status: 'active' };
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await client.getCall('call-123');
      expect(result).toEqual(mockResponse);
      expect(fetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/v1/calls/call-123`,
        expect.any(Object)
      );
    });

    it('should list calls with filtering', async () => {
      const mockResponse = {
        data: [{ id: 'call-123', status: 'active' }],
        pagination: { page: 1, limit: 10, total: 1, pages: 1 }
      };
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await client.listCalls({ 
        agentId: 'agent-123', 
        status: 'active',
        page: 1,
        limit: 10
      });
      expect(result).toEqual(mockResponse);
      expect(fetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/v1/calls?agentId=agent-123&status=active&page=1&limit=10`,
        expect.any(Object)
      );
    });

    it('should update call status successfully', async () => {
      const mockResponse = { id: 'call-123', status: 'completed' };
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await client.updateCallStatus('call-123', 'completed');
      expect(result).toEqual(mockResponse);
      expect(fetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/v1/calls/call-123/status`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ status: 'completed' })
        })
      );
    });

    it('should get call timeline successfully', async () => {
      const mockResponse = {
        callId: 'call-123',
        timeline: [
          { id: '1', kind: 'call.started', payload: {}, timestamp: '2023-01-01T00:00:00Z' }
        ]
      };
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await client.getCallTimeline('call-123');
      expect(result).toEqual(mockResponse.timeline);
    });

    it('should get call artifacts successfully', async () => {
      const mockResponse = {
        recording: 'https://example.com/recording.wav',
        transcription: 'Hello, how can I help you?'
      };
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await client.getCallArtifacts('call-123');
      expect(result).toEqual(mockResponse);
    });
  });

  describe('analytics and usage', () => {
    it('should get tenant usage successfully', async () => {
      const mockResponse = {
        tenantId: 'tenant-123',
        period: '24h',
        calls: { total: 100, completed: 95, failed: 5 },
        agents: { total: 5, active: 3 }
      };
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await client.getTenantUsage('tenant-123', '24h');
      expect(result).toEqual(mockResponse);
      expect(fetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/v1/tenants/tenant-123/usage?period=24h`,
        expect.any(Object)
      );
    });

    it('should get call analytics successfully', async () => {
      const mockResponse = {
        callId: 'call-123',
        totalEvents: 10,
        eventTypes: { 'call.started': 1, 'call.ended': 1 },
        duration: 120,
        sentiment: 'positive',
        topics: ['customer service', 'billing']
      };
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await client.getCallAnalytics('call-123');
      expect(result).toEqual(mockResponse);
      expect(fetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/v1/realtime/call-123/stats`,
        expect.any(Object)
      );
    });
  });

  describe('utilities', () => {
    describe('validatePhoneNumber', () => {
      it('should validate valid phone numbers', () => {
        expect(client.validatePhoneNumber('+1234567890')).toBe(true);
        expect(client.validatePhoneNumber('1234567890')).toBe(true);
        expect(client.validatePhoneNumber('+91 98765 43210')).toBe(true);
      });

      it('should reject invalid phone numbers', () => {
        expect(client.validatePhoneNumber('123')).toBe(false);
        expect(client.validatePhoneNumber('abc')).toBe(false);
        expect(client.validatePhoneNumber('')).toBe(false);
      });
    });

    describe('formatPhoneNumber', () => {
      it('should format Indian phone numbers correctly', () => {
        expect(client.formatPhoneNumber('9876543210')).toBe('+919876543210');
        expect(client.formatPhoneNumber('09876543210')).toBe('+919876543210');
        expect(client.formatPhoneNumber('919876543210')).toBe('+919876543210');
      });

      it('should preserve already formatted numbers', () => {
        expect(client.formatPhoneNumber('+1234567890')).toBe('+1234567890');
        expect(client.formatPhoneNumber('+91 98765 43210')).toBe('+91 98765 43210');
      });
    });
  });

  describe('error handling', () => {
    it('should handle API errors gracefully', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({ message: 'Invalid request' })
      });

      await expect(client.createAgent({} as any)).rejects.toThrow('API request failed: 400 Bad Request - Invalid request');
    });

    it('should handle network errors', async () => {
      (fetch as any).mockRejectedValueOnce(new Error('Network error'));

      await expect(client.createAgent({} as any)).rejects.toThrow('Network error');
    });
  });

  describe('health and monitoring', () => {
    it('should perform health check successfully', async () => {
      const mockResponse = { ok: true, service: 'api' };
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await client.healthCheck();
      expect(result).toEqual(mockResponse);
      expect(fetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/health`,
        expect.any(Object)
      );
    });

    it('should get metrics successfully', async () => {
      const mockResponse = '# HELP http_requests_total Total HTTP requests';
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockResponse)
      });

      const result = await client.getMetrics();
      expect(result).toEqual(mockResponse);
      expect(fetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/metrics`,
        expect.any(Object)
      );
    });
  });

  describe('batch operations', () => {
    it('should create multiple agents successfully', async () => {
      const mockConfigs = [
        { name: 'Agent 1', prompt: 'Helpful agent 1' },
        { name: 'Agent 2', prompt: 'Helpful agent 2' }
      ];

      (fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: 'agent-1', name: 'Agent 1' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: 'agent-2', name: 'Agent 2' })
        });

      const result = await client.createMultipleAgents(mockConfigs);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Agent 1');
      expect(result[1].name).toBe('Agent 2');
    });

    it('should create multiple calls successfully', async () => {
      const mockCallOptions = [
        { agentId: 'agent-1', to: '+1234567890', direction: 'outbound' as const },
        { agentId: 'agent-2', to: '+0987654321', direction: 'outbound' as const }
      ];

      (fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: 'call-1', status: 'created' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: 'call-2', status: 'created' })
        });

      const result = await client.createMultipleCalls(mockCallOptions);
      expect(result).toHaveLength(2);
      expect(result[0].status).toBe('created');
      expect(result[1].status).toBe('created');
    });
  });
});
