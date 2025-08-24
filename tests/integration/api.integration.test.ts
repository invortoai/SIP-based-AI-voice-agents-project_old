import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from 'http';
import { AddressInfo } from 'net';
import { InvortoClient } from '../../sdk/node/src/client';
import { AgentConfig, CallOptions } from '../../sdk/node/src/types';

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY = 'test-key';
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.DEEPGRAM_API_KEY = 'test-deepgram-key';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.SHARED_SECRET = 'test-shared-secret';

describe('API Integration Tests', () => {
  let server: any;
  let client: InvortoClient;
  let baseUrl: string;
  let serverAddress: string;

  beforeAll(async () => {
    // Start the API server
    server = createServer((req, res) => {
      // Mock API responses
      const url = new URL(req.url!, `http://${req.headers.host}`);
      const path = url.pathname;
      const method = req.method;

      // Set CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-tenant-id');

      if (method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      // Mock authentication
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      // Mock API endpoints
      if (path === '/health' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, service: 'api', timestamp: new Date().toISOString() }));
        return;
      }

      if (path === '/health/detailed' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          service: 'api',
          database: { status: 'connected', latency: 5 },
          redis: { status: 'connected', latency: 2 },
          timestamp: new Date().toISOString()
        }));
        return;
      }

      if (path === '/metrics' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('# HELP http_requests_total Total HTTP requests\n# TYPE http_requests_total counter\nhttp_requests_total 100\n');
        return;
      }

      if (path === '/v1/agents' && method === 'GET') {
        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = parseInt(url.searchParams.get('limit') || '10');
        
        const mockAgents = Array.from({ length: limit }, (_, i) => ({
          id: `agent-${page}-${i + 1}`,
          name: `Test Agent ${page}-${i + 1}`,
          config: {
            name: `Test Agent ${page}-${i + 1}`,
            prompt: 'You are a helpful assistant',
            voice: 'aura-2',
            locale: 'en-IN',
            temperature: 0.7
          },
          status: 'active',
          tenantId: 'tenant-123',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          data: mockAgents,
          pagination: {
            page,
            limit,
            total: 25,
            pages: Math.ceil(25 / limit)
          }
        }));
        return;
      }

      if (path === '/v1/agents' && method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const agentConfig = JSON.parse(body);
            const newAgent = {
              id: `agent-${Date.now()}`,
              ...agentConfig,
              status: 'active',
              tenantId: 'tenant-123',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };

            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(newAgent));
          } catch (error) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        });
        return;
      }

      if (path.match(/^\/v1\/agents\/[^\/]+$/) && method === 'GET') {
        const agentId = path.split('/').pop();
        const mockAgent = {
          id: agentId,
          name: `Test Agent ${agentId}`,
          config: {
            name: `Test Agent ${agentId}`,
            prompt: 'You are a helpful assistant',
            voice: 'aura-2',
            locale: 'en-IN',
            temperature: 0.7
          },
          status: 'active',
          tenantId: 'tenant-123',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          stats: {
            totalCalls: 150,
            averageCost: 2.50,
            totalDuration: 7500,
            successRate: 95.5
          }
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mockAgent));
        return;
      }

      if (path.match(/^\/v1\/agents\/[^\/]+$/) && method === 'PATCH') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const updates = JSON.parse(body);
            const agentId = path.split('/').pop();
            const updatedAgent = {
              id: agentId,
              name: updates.name || `Test Agent ${agentId}`,
              config: {
                name: updates.name || `Test Agent ${agentId}`,
                prompt: updates.prompt || 'You are a helpful assistant',
                voice: updates.voice || 'aura-2',
                locale: updates.locale || 'en-IN',
                temperature: updates.temperature || 0.7
              },
              status: 'active',
              tenantId: 'tenant-123',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(updatedAgent));
          } catch (error) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        });
        return;
      }

      if (path.match(/^\/v1\/agents\/[^\/]+$/) && method === 'DELETE') {
        const agentId = path.split('/').pop();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          deleted: { id: agentId, name: `Test Agent ${agentId}` }
        }));
        return;
      }

      if (path === '/v1/calls' && method === 'GET') {
        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = parseInt(url.searchParams.get('limit') || '10');
        const status = url.searchParams.get('status');
        const agentId = url.searchParams.get('agentId');
        
        let mockCalls = Array.from({ length: limit }, (_, i) => ({
          id: `call-${page}-${i + 1}`,
          agentId: agentId || `agent-${i + 1}`,
          direction: 'outbound',
          fromNum: '+1234567890',
          toNum: `+098765432${i}`,
          status: status || (i % 3 === 0 ? 'completed' : i % 3 === 1 ? 'active' : 'failed'),
          startedAt: new Date(Date.now() - i * 60000).toISOString(),
          endedAt: i % 3 === 0 ? new Date(Date.now() - i * 60000 + 120000).toISOString() : undefined,
          duration: i % 3 === 0 ? 120 : undefined,
          costInr: i % 3 === 0 ? 2.50 : undefined,
          metadata: { test: true }
        }));

        // Filter by status if provided
        if (status) {
          mockCalls = mockCalls.filter(call => call.status === status);
        }

        // Filter by agent if provided
        if (agentId) {
          mockCalls = mockCalls.filter(call => call.agentId === agentId);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          data: mockCalls,
          pagination: {
            page,
            limit,
            total: mockCalls.length,
            pages: Math.ceil(mockCalls.length / limit)
          }
        }));
        return;
      }

      if (path === '/v1/calls' && method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const callOptions = JSON.parse(body);
            const newCall = {
              id: `call-${Date.now()}`,
              ...callOptions,
              status: 'created',
              startedAt: new Date().toISOString(),
              metadata: callOptions.metadata || {}
            };

            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(newCall));
          } catch (error) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        });
        return;
      }

      if (path.match(/^\/v1\/calls\/[^\/]+\/timeline$/) && method === 'GET') {
        const callId = path.split('/')[3];
        const mockTimeline = [
          {
            id: '1',
            kind: 'call.started',
            payload: { callId, timestamp: new Date().toISOString() },
            timestamp: new Date().toISOString()
          },
          {
            id: '2',
            kind: 'stt.final',
            payload: { text: 'Hello, how can I help you?', confidence: 0.95 },
            timestamp: new Date().toISOString()
          },
          {
            id: '3',
            kind: 'llm.response',
            payload: { text: 'I can help you with various tasks. What do you need?' },
            timestamp: new Date().toISOString()
          }
        ];

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ callId, timeline: mockTimeline }));
        return;
      }

      if (path.match(/^\/v1\/calls\/[^\/]+\/artifacts$/) && method === 'GET') {
        const callId = path.split('/')[3];
        const mockArtifacts = {
          recording: `https://example.com/recordings/${callId}.wav`,
          transcription: 'Hello, how can I help you? I can assist with various tasks.',
          summary: 'Customer inquired about available services and was provided with information.',
          metadata: { callId, processed: true }
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mockArtifacts));
        return;
      }

      if (path.match(/^\/v1\/tenants\/[^\/]+\/usage$/) && method === 'GET') {
        const tenantId = path.split('/')[3];
        const period = url.searchParams.get('period') || '24h';
        
        const mockUsage = {
          tenantId,
          period,
          calls: {
            total: 1250,
            completed: 1187,
            failed: 63,
            averageCost: 2.45,
            totalCost: 3062.50,
            averageDuration: 95
          },
          agents: {
            total: 8,
            active: 6
          }
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mockUsage));
        return;
      }

      // Default response for unmatched routes
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    });

    // Start server on random port
    server.listen(0, () => {
      const address = server.address() as AddressInfo;
      serverAddress = `http://localhost:${address.port}`;
      baseUrl = serverAddress;
      
      // Initialize client
      client = new InvortoClient('test-api-key', baseUrl);
    });
  });

  afterAll(async () => {
    if (server) {
      server.close();
    }
  });

  beforeEach(() => {
    // Reset any state between tests
  });

  describe('Health and Monitoring', () => {
    it('should return basic health status', async () => {
      const response = await client.healthCheck();
      expect(response.ok).toBe(true);
      expect(response.service).toBe('api');
      expect(response.timestamp).toBeDefined();
    });

    it('should return detailed health status', async () => {
      const response = await client.healthCheck();
      expect(response.ok).toBe(true);
      expect(response.service).toBe('api');
    });

    it('should return Prometheus metrics', async () => {
      const metrics = await client.getMetrics();
      expect(metrics).toContain('http_requests_total');
      expect(metrics).toContain('counter');
    });
  });

  describe('Agent Management', () => {
    it('should create an agent successfully', async () => {
      const agentConfig: AgentConfig = {
        name: 'Integration Test Agent',
        prompt: 'You are a helpful integration test assistant',
        voice: 'aura-2',
        locale: 'en-IN',
        temperature: 0.7
      };

      const agent = await client.createAgent(agentConfig);
      expect(agent.id).toBeDefined();
      expect(agent.name).toBe(agentConfig.name);
      expect(agent.prompt).toBe(agentConfig.prompt);
      expect(agent.status).toBe('active');
    });

    it('should retrieve an agent by ID', async () => {
      const agent = await client.getAgent('agent-1-1');
      expect(agent.id).toBe('agent-1-1');
      expect(agent.name).toBe('Test Agent 1-1');
      expect(agent.stats).toBeDefined();
      expect(agent.stats?.totalCalls).toBe(150);
    });

    it('should list agents with pagination', async () => {
      const response = await client.listAgents({ page: 1, limit: 5 });
      expect(response.data).toHaveLength(5);
      expect(response.pagination.page).toBe(1);
      expect(response.pagination.limit).toBe(5);
      expect(response.pagination.total).toBe(25);
      expect(response.pagination.pages).toBe(5);
    });

    it('should update an agent configuration', async () => {
      const updates = {
        name: 'Updated Integration Agent',
        temperature: 0.9
      };

      const agent = await client.updateAgent('agent-1-1', updates);
      expect(agent.name).toBe(updates.name);
      expect(agent.config.temperature).toBe(updates.temperature);
    });

    it('should delete an agent', async () => {
      const response = await client.deleteAgent('agent-1-1');
      expect(response.success).toBe(true);
      expect(response.deleted.id).toBe('agent-1-1');
    });
  });

  describe('Call Management', () => {
    it('should create a call successfully', async () => {
      const callOptions: CallOptions = {
        agentId: 'agent-123',
        to: '+1234567890',
        direction: 'outbound',
        recording: true,
        transcription: true
      };

      const call = await client.createCall(callOptions);
      expect(call.id).toBeDefined();
      expect(call.agentId).toBe(callOptions.agentId);
      expect(call.status).toBe('created');
      expect(call.startedAt).toBeDefined();
    });

    it('should retrieve a call by ID', async () => {
      const call = await client.getCall('call-1-1');
      expect(call.id).toBe('call-1-1');
      expect(call.agentId).toBe('agent-1');
      expect(call.status).toBe('completed');
      expect(call.duration).toBe(120);
      expect(call.costInr).toBe(2.50);
    });

    it('should list calls with filtering', async () => {
      const response = await client.listCalls({
        status: 'completed',
        agentId: 'agent-1',
        page: 1,
        limit: 10
      });

      expect(response.data).toBeDefined();
      expect(response.data.length).toBeGreaterThan(0);
      expect(response.data.every(call => call.status === 'completed')).toBe(true);
      expect(response.data.every(call => call.agentId === 'agent-1')).toBe(true);
    });

    it('should get call timeline events', async () => {
      const timeline = await client.getCallTimeline('call-1-1');
      expect(timeline).toHaveLength(3);
      expect(timeline[0].kind).toBe('call.started');
      expect(timeline[1].kind).toBe('stt.final');
      expect(timeline[2].kind).toBe('llm.response');
    });

    it('should get call artifacts', async () => {
      const artifacts = await client.getCallArtifacts('call-1-1');
      expect(artifacts.recording).toBeDefined();
      expect(artifacts.transcription).toBeDefined();
      expect(artifacts.summary).toBeDefined();
      expect(artifacts.metadata).toBeDefined();
    });
  });

  describe('Analytics and Usage', () => {
    it('should get tenant usage statistics', async () => {
      const usage = await client.getTenantUsage('tenant-123', '24h');
      expect(usage.tenantId).toBe('tenant-123');
      expect(usage.period).toBe('24h');
      expect(usage.calls.total).toBe(1250);
      expect(usage.calls.completed).toBe(1187);
      expect(usage.calls.failed).toBe(63);
      expect(usage.agents.total).toBe(8);
      expect(usage.agents.active).toBe(6);
    });

    it('should get call analytics', async () => {
      const analytics = await client.getCallAnalytics('call-1-1');
      expect(analytics.callId).toBe('call-1-1');
      expect(analytics.totalEvents).toBe(10);
      expect(analytics.duration).toBe(120);
      expect(analytics.sentiment).toBe('positive');
      expect(analytics.topics).toContain('customer service');
    });
  });

  describe('Error Handling', () => {
    it('should handle authentication errors', async () => {
      const unauthorizedClient = new InvortoClient('invalid-key', baseUrl);
      await expect(unauthorizedClient.healthCheck()).rejects.toThrow();
    });

    it('should handle invalid endpoints', async () => {
      await expect(client.getAgent('nonexistent')).rejects.toThrow();
    });
  });

  describe('Batch Operations', () => {
    it('should create multiple agents in batch', async () => {
      const agentConfigs: AgentConfig[] = [
        {
          name: 'Batch Agent 1',
          prompt: 'First batch agent',
          voice: 'aura-2',
          locale: 'en-IN',
          temperature: 0.7
        },
        {
          name: 'Batch Agent 2',
          prompt: 'Second batch agent',
          voice: 'aura-2',
          locale: 'en-IN',
          temperature: 0.8
        }
      ];

      const agents = await client.createMultipleAgents(agentConfigs);
      expect(agents).toHaveLength(2);
      expect(agents[0].name).toBe('Batch Agent 1');
      expect(agents[1].name).toBe('Batch Agent 2');
    });

    it('should create multiple calls in batch', async () => {
      const callOptions: CallOptions[] = [
        {
          agentId: 'agent-1',
          to: '+1234567890',
          direction: 'outbound',
          recording: true,
          transcription: true
        },
        {
          agentId: 'agent-2',
          to: '+0987654321',
          direction: 'outbound',
          recording: false,
          transcription: true
        }
      ];

      const calls = await client.createMultipleCalls(callOptions);
      expect(calls).toHaveLength(2);
      expect(calls[0].agentId).toBe('agent-1');
      expect(calls[1].agentId).toBe('agent-2');
    });
  });
});