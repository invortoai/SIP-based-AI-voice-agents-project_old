import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { randomString, randomItem } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

// Custom metrics
const callsCreated = new Counter('calls_created');
const callsFailed = new Counter('calls_failed');
const wsConnectionsSuccess = new Rate('ws_connections_success');
const wsMessagesSent = new Counter('ws_messages_sent');
const wsMessagesReceived = new Counter('ws_messages_received');
const apiResponseTime = new Trend('api_response_time');
const wsResponseTime = new Trend('ws_response_time');
const webhookDeliveryTime = new Trend('webhook_delivery_time');

// Configuration
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const WS_URL = __ENV.WS_URL || 'ws://localhost:8081';
const API_KEY = __ENV.API_KEY || 'test-api-key';
const TENANT_ID = __ENV.TENANT_ID || 't_demo';

// Test scenarios
export const options = {
  scenarios: {
    // Scenario 1: API Load Test
    api_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 10 },  // Ramp up to 10 users
        { duration: '5m', target: 10 },  // Stay at 10 users
        { duration: '2m', target: 20 },  // Ramp up to 20 users
        { duration: '5m', target: 20 },  // Stay at 20 users
        { duration: '2m', target: 0 },   // Ramp down to 0 users
      ],
      gracefulRampDown: '30s',
      exec: 'apiLoadTest',
    },
    
    // Scenario 2: WebSocket Stress Test
    ws_stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 5 },   // Ramp up to 5 concurrent WS connections
        { duration: '3m', target: 5 },   // Maintain 5 connections
        { duration: '1m', target: 10 },  // Spike to 10 connections
        { duration: '2m', target: 10 },  // Maintain 10 connections
        { duration: '1m', target: 0 },   // Ramp down
      ],
      gracefulRampDown: '30s',
      exec: 'wsStressTest',
      startTime: '2m', // Start after API test begins
    },
    
    // Scenario 3: Webhook Load Test
    webhook_load: {
      executor: 'constant-arrival-rate',
      rate: 10,
      timeUnit: '1s',
      duration: '5m',
      preAllocatedVUs: 5,
      maxVUs: 20,
      exec: 'webhookLoadTest',
      startTime: '5m', // Start after initial ramp-up
    },
    
    // Scenario 4: Spike Test
    spike_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 2 },   // Baseline load
        { duration: '5s', target: 50 },   // Sudden spike
        { duration: '30s', target: 50 },  // Maintain spike
        { duration: '5s', target: 2 },    // Back to baseline
        { duration: '30s', target: 2 },   // Recovery period
      ],
      exec: 'spikeTest',
      startTime: '10m', // Start after other tests
    },
  },
  
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'], // 95% of requests under 500ms
    http_req_failed: ['rate<0.1'],                   // Error rate under 10%
    ws_connections_success: ['rate>0.95'],           // 95% WS connection success
    calls_failed: ['count<10'],                      // Less than 10 failed calls
    api_response_time: ['p(95)<300'],                // API 95th percentile under 300ms
    ws_response_time: ['p(95)<100'],                 // WS 95th percentile under 100ms
  },
};

// Helper functions
function generatePhoneNumber() {
  return `+1${Math.floor(Math.random() * 9000000000) + 1000000000}`;
}

function createAgent() {
  const payload = JSON.stringify({
    name: `LoadTest Agent ${randomString(8)}`,
    config: {
      voice: 'en-US-Standard-A',
      language: 'en-US',
      temperature: 0.7,
      maxTokens: 150,
      systemPrompt: 'You are a helpful assistant.',
      tools: [],
    },
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
      'X-Tenant-Id': TENANT_ID,
    },
  };

  const res = http.post(`${BASE_URL}/v1/agents`, payload, params);
  check(res, {
    'agent created': (r) => r.status === 200,
    'has agent id': (r) => r.json('id') !== undefined,
  });

  return res.json('id');
}

// Test scenarios implementation
export function apiLoadTest() {
  const startTime = Date.now();
  
  // Create an agent
  const agentId = createAgent();
  if (!agentId) {
    callsFailed.add(1);
    return;
  }

  // Create a call
  const callPayload = JSON.stringify({
    agentId: agentId,
    to: generatePhoneNumber(),
    from: generatePhoneNumber(),
    metadata: {
      test: 'load',
      timestamp: Date.now(),
      vu: __VU,
      iter: __ITER,
    },
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
      'X-Tenant-Id': TENANT_ID,
    },
  };

  const callRes = http.post(`${BASE_URL}/v1/calls`, callPayload, params);
  const responseTime = Date.now() - startTime;
  apiResponseTime.add(responseTime);

  const success = check(callRes, {
    'call created': (r) => r.status === 200,
    'has call id': (r) => r.json('id') !== undefined,
    'response time OK': (r) => responseTime < 500,
  });

  if (success) {
    callsCreated.add(1);
    
    // Get call timeline
    const callId = callRes.json('id');
    const timelineRes = http.get(`${BASE_URL}/v1/calls/${callId}/timeline`, params);
    check(timelineRes, {
      'timeline retrieved': (r) => r.status === 200,
      'has timeline data': (r) => r.json('timeline') !== undefined,
    });
    
    // Get call details
    const detailsRes = http.get(`${BASE_URL}/v1/calls/${callId}`, params);
    check(detailsRes, {
      'details retrieved': (r) => r.status === 200,
      'has call data': (r) => r.json('id') === callId,
    });
  } else {
    callsFailed.add(1);
  }

  sleep(randomItem([1, 2, 3])); // Random delay between requests
}

export function wsStressTest() {
  const callId = `c_load_${randomString(12)}`;
  const url = `${WS_URL}/v1/realtime/${callId}`;
  const params = {
    headers: {
      'Sec-WebSocket-Protocol': API_KEY,
    },
  };

  const startTime = Date.now();
  
  const res = ws.connect(url, params, function (socket) {
    socket.on('open', () => {
      wsConnectionsSuccess.add(true);
      
      // Send start message
      socket.send(JSON.stringify({
        t: 'start',
        agentId: 'a_test',
      }));
      wsMessagesSent.add(1);
      
      // Simulate audio streaming
      const audioInterval = setInterval(() => {
        if (socket.readyState === 1) {
          // Send mock audio data (160 bytes = 20ms at 8kHz)
          const audioData = new Uint8Array(160);
          for (let i = 0; i < 160; i++) {
            audioData[i] = Math.floor(Math.random() * 256);
          }
          socket.send(audioData.buffer);
          wsMessagesSent.add(1);
        }
      }, 20); // Send every 20ms
      
      // Send DTMF after 2 seconds
      setTimeout(() => {
        socket.send(JSON.stringify({
          t: 'dtmf.send',
          digits: '1234',
          method: 'rfc2833',
        }));
        wsMessagesSent.add(1);
      }, 2000);
      
      // Close connection after 10 seconds
      setTimeout(() => {
        clearInterval(audioInterval);
        socket.close();
      }, 10000);
    });

    socket.on('message', (data) => {
      wsMessagesReceived.add(1);
      const responseTime = Date.now() - startTime;
      wsResponseTime.add(responseTime);
      
      try {
        const msg = JSON.parse(data);
        check(msg, {
          'valid message type': (m) => ['stt.partial', 'stt.final', 'tts.audio', 'tool.call'].includes(m.t),
        });
      } catch (e) {
        // Binary audio data, expected
      }
    });

    socket.on('error', (e) => {
      wsConnectionsSuccess.add(false);
      console.error('WebSocket error:', e);
    });

    socket.on('close', () => {
      // Connection closed
    });
  });

  check(res, {
    'WebSocket connected': (r) => r && r.status === 101,
  });
}

export function webhookLoadTest() {
  const webhookPayload = JSON.stringify({
    url: 'https://webhook.site/test', // Replace with actual webhook endpoint
    payload: {
      type: 'test.event',
      callId: `c_test_${randomString(12)}`,
      timestamp: new Date().toISOString(),
      data: {
        test: true,
        vu: __VU,
        iter: __ITER,
      },
    },
    headers: {
      'X-Custom-Header': 'LoadTest',
    },
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
    },
  };

  const startTime = Date.now();
  const res = http.post(`${BASE_URL.replace('8080', '8082')}/dispatch`, webhookPayload, params);
  const deliveryTime = Date.now() - startTime;
  webhookDeliveryTime.add(deliveryTime);

  check(res, {
    'webhook queued': (r) => r.status === 200,
    'has job id': (r) => r.json('jobId') !== undefined,
    'delivery time OK': (r) => deliveryTime < 200,
  });

  // Check webhook metrics
  if (__ITER % 10 === 0) {
    const metricsRes = http.get(`${BASE_URL.replace('8080', '8082')}/metrics`, params);
    check(metricsRes, {
      'metrics available': (r) => r.status === 200,
      'has queue stats': (r) => r.json('queues') !== undefined,
    });
  }

  sleep(0.5);
}

export function spikeTest() {
  // Combine all operations for spike testing
  const operations = [
    () => apiLoadTest(),
    () => wsStressTest(),
    () => webhookLoadTest(),
  ];
  
  // Randomly select an operation
  const operation = randomItem(operations);
  operation();
}

// Lifecycle hooks
export function setup() {
  // Verify services are running
  const healthChecks = [
    { url: `${BASE_URL}/health`, name: 'API' },
    { url: `${BASE_URL.replace('8080', '8081')}/health`, name: 'Realtime' },
    { url: `${BASE_URL.replace('8080', '8082')}/health`, name: 'Webhooks' },
  ];

  for (const check of healthChecks) {
    const res = http.get(check.url);
    if (res.status !== 200) {
      throw new Error(`${check.name} service health check failed`);
    }
  }

  console.log('All services healthy, starting load test...');
  
  return {
    startTime: Date.now(),
  };
}

export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log(`Load test completed in ${duration} seconds`);
  
  // Final metrics summary
  console.log('Test Summary:');
  console.log(`- Calls created: ${callsCreated.value}`);
  console.log(`- Calls failed: ${callsFailed.value}`);
  console.log(`- WS messages sent: ${wsMessagesSent.value}`);
  console.log(`- WS messages received: ${wsMessagesReceived.value}`);
}

// Default function for simple execution
export default function () {
  apiLoadTest();
}