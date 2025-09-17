import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import express from 'express';
import http from 'http';
import cors from 'cors';
import bodyParser from 'body-parser';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/lib/use/ws';
import { PubSub } from 'graphql-subscriptions';

// GraphQL Schema
const typeDefs = `
  type Query {
    health: HealthStatus!
    agents(limit: Int, offset: Int, status: AgentStatus): [Agent!]!
    agent(id: ID!): Agent
    calls(limit: Int, offset: Int, status: CallStatus, agentId: ID): [Call!]!
    call(id: ID!): Call
    tenantUsage(tenantId: ID!, period: String!): TenantUsage!
    callAnalytics(callId: ID!): CallAnalytics!
    callTimeline(callId: ID!): [TimelineEvent!]!
    callArtifacts(callId: ID!): CallArtifacts!
  }

  type Mutation {
    createAgent(input: CreateAgentInput!): Agent!
    updateAgent(id: ID!, input: UpdateAgentInput!): Agent!
    deleteAgent(id: ID!): DeleteResponse!

    createCall(input: CreateCallInput!): CallResponse!
    updateCallStatus(id: ID!, status: String!, metadata: JSON): Call!

    connectRealtime(callId: ID!, agentId: ID!): RealtimeConnection!
    sendDTMF(callId: ID!, digits: String!, method: String): Boolean!
    transferCall(callId: ID!, to: String!, mode: String): Boolean!
    endCall(callId: ID!): Boolean!
  }

  type Subscription {
    callStatusChanged(callId: ID!): Call!
    agentStatusChanged(agentId: ID!): Agent!
    newCall(tenantId: ID!): Call!
    realtimeEvent(callId: ID!): RealtimeEvent!
  }

  type HealthStatus {
    ok: Boolean!
    service: String!
    timestamp: String!
    database: HealthCheck
    redis: HealthCheck
  }

  type HealthCheck {
    status: String!
    latency: Int
    error: String
  }

  enum AgentStatus {
    ACTIVE
    INACTIVE
    DRAFT
  }

  enum CallStatus {
    CREATED
    RINGING
    ANSWERED
    ACTIVE
    COMPLETED
    FAILED
  }

  type Agent {
    id: ID!
    name: String!
    config: AgentConfig!
    status: AgentStatus!
    tenantId: String!
    createdAt: String!
    updatedAt: String!
    stats: AgentStats
  }

  type AgentConfig {
    name: String!
    prompt: String!
    voice: String
    locale: String
    temperature: Float
    maxTokens: Int
    model: String
    tools: [Tool!]
  }

  type Tool {
    name: String!
    description: String!
    parameters: JSON!
  }

  type AgentStats {
    totalCalls: Int!
    averageCost: Float!
    totalDuration: Int!
    successRate: Float!
  }

  type Call {
    id: ID!
    agentId: String!
    direction: String!
    fromNum: String!
    toNum: String!
    status: CallStatus!
    startedAt: String
    endedAt: String
    duration: Int
    costInr: Float
    metadata: JSON
    costs: [CallCost!]
  }

  type CallResponse {
    id: ID!
    status: String!
    message: String
  }

  type CallCost {
    type: String!
    amount: Float!
    currency: String!
  }

  type TimelineEvent {
    id: ID!
    kind: String!
    payload: JSON!
    timestamp: String!
  }

  type CallArtifacts {
    recording: String
    transcription: String
    summary: String
    metadata: JSON
  }

  type TenantUsage {
    tenantId: String!
    period: String!
    calls: UsageStats!
    agents: UsageStats!
  }

  type UsageStats {
    total: Int!
    completed: Int!
    failed: Int!
    averageCost: Float!
    totalCost: Float!
    averageDuration: Float!
  }

  type CallAnalytics {
    callId: String!
    totalEvents: Int!
    eventTypes: JSON!
    duration: Int!
    sentiment: String!
    topics: [String!]!
  }

  type RealtimeConnection {
    callId: String!
    connectionId: String!
    status: String!
  }

  type DeleteResponse {
    success: Boolean!
    deleted: JSON
  }

  # Input Types
  input CreateAgentInput {
    name: String!
    prompt: String!
    voice: String
    locale: String
    temperature: Float
    maxTokens: Int
    model: String
    tools: [ToolInput!]
  }

  input UpdateAgentInput {
    name: String
    prompt: String
    voice: String
    locale: String
    temperature: Float
    maxTokens: Int
    model: String
    tools: [ToolInput!]
  }

  input ToolInput {
    name: String!
    description: String!
    parameters: JSON!
  }

  input CreateCallInput {
    agentId: String!
    to: String!
    from: String
    direction: String
    metadata: JSON
    recording: Boolean
    transcription: Boolean
  }

  scalar JSON
`;

// Mock data access functions (replace with actual database calls)
const db = {
  async getAgents(limit = 50, offset = 0, status?: string) {
    // Mock implementation - replace with actual DB query
    return [];
  },

  async getAgent(id: string) {
    // Mock implementation
    return null;
  },

  async createAgent(input: any) {
    // Mock implementation
    return { id: 'agent-123', ...input, status: 'ACTIVE', tenantId: 'tenant-123', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  },

  async updateAgent(id: string, input: any) {
    // Mock implementation
    return { id, ...input, updatedAt: new Date().toISOString() };
  },

  async deleteAgent(id: string) {
    // Mock implementation
    return { success: true, deleted: { id, name: 'Deleted Agent' } };
  },

  async getCalls(limit = 50, offset = 0, status?: string, agentId?: string) {
    // Mock implementation
    return [];
  },

  async getCall(id: string) {
    // Mock implementation
    return null;
  },

  async createCall(input: any) {
    // Mock implementation
    return { id: 'call-123', status: 'CREATED', message: 'Call created successfully' };
  },

  async updateCallStatus(id: string, status: string, metadata?: any) {
    // Mock implementation
    return { id, status, metadata };
  },

  async getCallTimeline(callId: string) {
    // Mock implementation
    return [];
  },

  async getCallArtifacts(callId: string) {
    // Mock implementation
    return {};
  },

  async getTenantUsage(tenantId: string, period: string) {
    // Mock implementation
    return {
      tenantId,
      period,
      calls: { total: 100, completed: 95, failed: 5, averageCost: 2.50, totalCost: 250, averageDuration: 120 },
      agents: { total: 5, completed: 5, failed: 0, averageCost: 0, totalCost: 0, averageDuration: 0 }
    };
  },

  async getCallAnalytics(callId: string) {
    // Mock implementation
    return {
      callId,
      totalEvents: 10,
      eventTypes: { 'call.started': 1, 'stt.final': 5, 'llm.response': 3, 'call.ended': 1 },
      duration: 120,
      sentiment: 'positive',
      topics: ['customer service', 'billing']
    };
  }
};

// PubSub for subscriptions
const pubsub = new PubSub();

// Resolvers
const resolvers = {
  Query: {
    health: async () => ({
      ok: true,
      service: 'api-graphql',
      timestamp: new Date().toISOString(),
      database: { status: 'connected', latency: 5 },
      redis: { status: 'connected', latency: 2 }
    }),

    agents: async (_: any, { limit, offset, status }: any) => {
      return await db.getAgents(limit, offset, status);
    },

    agent: async (_: any, { id }: any) => {
      return await db.getAgent(id);
    },

    calls: async (_: any, { limit, offset, status, agentId }: any) => {
      return await db.getCalls(limit, offset, status, agentId);
    },

    call: async (_: any, { id }: any) => {
      return await db.getCall(id);
    },

    tenantUsage: async (_: any, { tenantId, period }: any) => {
      return await db.getTenantUsage(tenantId, period);
    },

    callAnalytics: async (_: any, { callId }: any) => {
      return await db.getCallAnalytics(callId);
    },

    callTimeline: async (_: any, { callId }: any) => {
      return await db.getCallTimeline(callId);
    },

    callArtifacts: async (_: any, { callId }: any) => {
      return await db.getCallArtifacts(callId);
    }
  },

  Mutation: {
    createAgent: async (_: any, { input }: any) => {
      return await db.createAgent(input);
    },

    updateAgent: async (_: any, { id, input }: any) => {
      return await db.updateAgent(id, input);
    },

    deleteAgent: async (_: any, { id }: any) => {
      return await db.deleteAgent(id);
    },

    createCall: async (_: any, { input }: any) => {
      return await db.createCall(input);
    },

    updateCallStatus: async (_: any, { id, status, metadata }: any) => {
      return await db.updateCallStatus(id, status, metadata);
    },

    connectRealtime: async (_: any, { callId, agentId }: any) => {
      // Mock realtime connection
      return {
        callId,
        connectionId: `conn_${Date.now()}`,
        status: 'connected'
      };
    },

    sendDTMF: async (_: any, { callId, digits, method }: any) => {
      // Mock DTMF sending
      pubsub.publish(`CALL_${callId}`, {
        callStatusChanged: { id: callId, status: 'ACTIVE' }
      });
      return true;
    },

    transferCall: async (_: any, { callId, to, mode }: any) => {
      // Mock call transfer
      pubsub.publish(`CALL_${callId}`, {
        callStatusChanged: { id: callId, status: 'TRANSFERRED' }
      });
      return true;
    },

    endCall: async (_: any, { callId }: any) => {
      // Mock call ending
      pubsub.publish(`CALL_${callId}`, {
        callStatusChanged: { id: callId, status: 'COMPLETED' }
      });
      return true;
    }
  },

  Subscription: {
    callStatusChanged: {
      subscribe: (_: any, { callId }: any) => pubsub.asyncIterator([`CALL_${callId}`])
    },

    agentStatusChanged: {
      subscribe: (_: any, { agentId }: any) => pubsub.asyncIterator([`AGENT_${agentId}`])
    },

    newCall: {
      subscribe: (_: any, { tenantId }: any) => pubsub.asyncIterator([`TENANT_${tenantId}_CALLS`])
    },

    realtimeEvent: {
      subscribe: (_: any, { callId }: any) => pubsub.asyncIterator([`REALTIME_${callId}`])
    }
  }
};

// Create executable schema
const schema = makeExecutableSchema({ typeDefs, resolvers });

// Create Express app for GraphQL
const app = express();
const httpServer = http.createServer(app);

// WebSocket server for subscriptions
const wsServer = new WebSocketServer({
  server: httpServer,
  path: '/graphql'
});

// Use WebSocket server for GraphQL subscriptions
const serverCleanup = useServer({ schema }, wsServer as any);

// Create Apollo Server
const server = new ApolloServer({
  schema,
  plugins: [
    ApolloServerPluginDrainHttpServer({ httpServer }),
    {
      async serverWillStart() {
        return {
          async drainServer() {
            await serverCleanup.dispose();
          }
        };
      }
    }
  ]
});

// Start the server
export async function startGraphQLServer(port = 4000) {
  await server.start();

  app.use(
    '/graphql',
    cors<cors.CorsRequest>(),
    bodyParser.json(),
    expressMiddleware(server, {
      context: async ({ req }: any) => ({
        token: req.headers.authorization || ''
      })
    })
  );

  // GraphQL Playground
  app.get('/', (req: express.Request, res: express.Response) => {
    res.send(`
      <html>
        <head>
          <title>Invorto GraphQL API</title>
        </head>
        <body>
          <h1>Invorto Voice AI GraphQL API</h1>
          <p>GraphQL endpoint: <a href="/graphql">/graphql</a></p>
          <p>WebSocket subscriptions: ws://localhost:${port}/graphql</p>
        </body>
      </html>
    `);
  });

  return new Promise<void>((resolve) => {
    httpServer.listen(port, () => {
      console.log(`🚀 GraphQL server ready at http://localhost:${port}/graphql`);
      console.log(`🚀 Subscriptions ready at ws://localhost:${port}/graphql`);
      resolve();
    });
  });
}

// Export pubsub for use in other parts of the application
export { pubsub };