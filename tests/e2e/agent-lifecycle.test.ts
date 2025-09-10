/**
 * End-to-End Test for Agent Lifecycle
 * This test validates the complete agent creation, call management, and cleanup workflow
 */

import { InvortoClient } from '../../sdk/node/src/client';
import { AgentConfig, CallOptions } from '../../sdk/node/src/types';

// Mock environment variables
process.env.NODE_ENV = 'test';

// Test variables
let client: InvortoClient;
let testAgentId: string;
let testCallId: string;

const testAgentConfig: AgentConfig = {
  name: 'E2E Test Agent',
  prompt: 'You are a helpful test assistant for end-to-end testing.',
  voice: 'aura-asteria-en',
  locale: 'en-IN',
  temperature: 0.7,
  maxTokens: 1000
};

// Simple test runner
async function runTest(name: string, testFn: () => Promise<void>) {
  try {
    console.log(`⏳ ${name}`);
    await testFn();
    console.log(`✅ ${name}`);
    return true;
  } catch (error) {
    console.log(`❌ ${name}: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🚀 Running E2E Tests for Agent Lifecycle\n');

  let passed = 0;
  let failed = 0;

  // Initialize client
  const initResult = await runTest('Initialize Client', async () => {
    client = new InvortoClient('test-api-key', 'http://localhost:8080');
    if (!client) {
      throw new Error('Failed to create client');
    }
  });

  if (!initResult) {
    console.log('\n❌ Cannot continue without client initialization');
    return;
  }

  // Test agent creation
  const createResult = await runTest('Create Agent', async () => {
    const agent = await client.createAgent(testAgentConfig);
    if (!agent || !agent.id) {
      throw new Error('Agent creation failed');
    }
    testAgentId = agent.id;
    console.log(`   Created agent: ${agent.id}`);
  });
  createResult ? passed++ : failed++;

  if (createResult && testAgentId) {
    // Test agent retrieval
    const retrieveResult = await runTest('Retrieve Agent', async () => {
      const agent = await client.getAgent(testAgentId);
      if (!agent || agent.id !== testAgentId) {
        throw new Error('Agent retrieval failed');
      }
    });
    retrieveResult ? passed++ : failed++;

    // Test agent update
    const updateResult = await runTest('Update Agent', async () => {
      const updates = { name: 'Updated E2E Test Agent', temperature: 0.8 };
      const agent = await client.updateAgent(testAgentId, updates);
      if (!agent || agent.name !== updates.name) {
        throw new Error('Agent update failed');
      }
    });
    updateResult ? passed++ : failed++;

    // Test call creation
    const callResult = await runTest('Create Call', async () => {
      const callOptions: CallOptions = {
        agentId: testAgentId,
        to: '+1234567890',
        from: '+0987654321',
        direction: 'outbound' as const,
        recording: true,
        transcription: true
      };

      const callResponse = await client.createCall(callOptions);
      if (!callResponse || !callResponse.id) {
        throw new Error('Call creation failed');
      }
      testCallId = callResponse.id;
      console.log(`   Created call: ${callResponse.id}`);
    });
    callResult ? passed++ : failed++;

    if (callResult && testCallId) {
      // Test call retrieval
      const callRetrieveResult = await runTest('Retrieve Call', async () => {
        const call = await client.getCall(testCallId);
        if (!call || call.id !== testCallId) {
          throw new Error('Call retrieval failed');
        }
      });
      callRetrieveResult ? passed++ : failed++;

      // Test call status update
      const statusResult = await runTest('Update Call Status', async () => {
        const call = await client.updateCallStatus(testCallId, 'completed');
        if (!call || call.status !== 'completed') {
          throw new Error('Call status update failed');
        }
      });
      statusResult ? passed++ : failed++;

      // Test call timeline
      const timelineResult = await runTest('Get Call Timeline', async () => {
        const timeline = await client.getCallTimeline(testCallId);
        if (!Array.isArray(timeline)) {
          throw new Error('Timeline retrieval failed');
        }
      });
      timelineResult ? passed++ : failed++;
    }

    // Test agent deletion
    const deleteResult = await runTest('Delete Agent', async () => {
      const result = await client.deleteAgent(testAgentId);
      if (!result || !result.success) {
        throw new Error('Agent deletion failed');
      }
    });
    deleteResult ? passed++ : failed++;
  }

  // Test utility functions
  const phoneResult = await runTest('Phone Number Validation', async () => {
    const valid = client.validatePhoneNumber('+1234567890');
    const invalid = client.validatePhoneNumber('123');

    if (!valid || invalid) {
      throw new Error('Phone validation failed');
    }
  });
  phoneResult ? passed++ : failed++;

  const formatResult = await runTest('Phone Number Formatting', async () => {
    const formatted = client.formatPhoneNumber('9876543210');
    if (formatted !== '+919876543210') {
      throw new Error('Phone formatting failed');
    }
  });
  formatResult ? passed++ : failed++;

  // Test health check
  const healthResult = await runTest('Health Check', async () => {
    const health = await client.healthCheck();
    if (!health || !health.ok) {
      throw new Error('Health check failed');
    }
  });
  healthResult ? passed++ : failed++;

  console.log(`\n📊 E2E Test Results: ${passed} passed, ${failed} failed`);

  if (failed === 0) {
    console.log('🎉 All E2E tests passed!');
  } else {
    console.log('⚠️  Some tests failed. Check the output above for details.');
  }
}

// Run the tests
main().catch(console.error);