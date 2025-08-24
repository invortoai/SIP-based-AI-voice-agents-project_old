# Invorto Voice AI Platform - Test Suite

This directory contains comprehensive test suites for the Invorto Voice AI Platform, including unit tests, integration tests, and load tests.

## Test Structure

```
tests/
├── unit/                 # Unit tests for individual components
│   ├── asr.test.ts      # ASR adapter tests
│   └── ...
├── integration/          # Integration tests for API endpoints
│   ├── api.integration.test.ts
│   └── ...
├── load/                 # Load and performance tests
│   └── k6-load-test.js  # k6 load testing scenarios
└── README.md
```

## Running Tests

### Prerequisites

```bash
# Install dependencies
npm install

# Install k6 for load testing (optional)
# macOS
brew install k6

# Windows (using Chocolatey)
choco install k6

# Linux
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

### Unit Tests

Run all unit tests:
```bash
npm test
```

Run unit tests with coverage:
```bash
npm run test:coverage
```

Run tests in watch mode:
```bash
npm run test:watch
```

Run specific test file:
```bash
npm test -- tests/unit/asr.test.ts
```

### Integration Tests

Run integration tests:
```bash
npm run test:integration
```

**Note:** Integration tests require services to be running. Start them with:
```bash
docker-compose up -d
```

### Load Tests

Run load tests with k6:
```bash
# Basic load test
k6 run tests/load/k6-load-test.js

# With custom configuration
k6 run -e BASE_URL=http://localhost:8080 -e API_KEY=your-api-key tests/load/k6-load-test.js

# With HTML report
k6 run --out html=report.html tests/load/k6-load-test.js

# With specific scenario
k6 run --scenario api_load tests/load/k6-load-test.js
```

## Test Scenarios

### Unit Tests

- **ASR Adapter Tests** (`asr.test.ts`)
  - Connection establishment
  - Audio streaming
  - Transcription handling
  - Error recovery
  - Reconnection logic

### Integration Tests

- **API Integration Tests** (`api.integration.test.ts`)
  - Agent CRUD operations
  - Call management
  - Timeline retrieval
  - Artifact handling
  - Webhook dispatching
  - Rate limiting
  - Authentication

### Load Test Scenarios

The k6 load test includes multiple scenarios:

1. **API Load Test** (`api_load`)
   - Ramps up to 20 concurrent users
   - Tests agent creation and call management
   - Validates response times and error rates

2. **WebSocket Stress Test** (`ws_stress`)
   - Tests concurrent WebSocket connections
   - Simulates audio streaming
   - Validates message handling

3. **Webhook Load Test** (`webhook_load`)
   - Constant arrival rate of 10 requests/second
   - Tests webhook queuing and delivery
   - Monitors queue metrics

4. **Spike Test** (`spike_test`)
   - Sudden traffic spike to 50 VUs
   - Tests system recovery
   - Validates graceful degradation

## Performance Thresholds

The load tests enforce the following thresholds:

- **HTTP Requests**
  - 95th percentile < 500ms
  - 99th percentile < 1000ms
  - Error rate < 10%

- **WebSocket Connections**
  - Success rate > 95%
  - Response time 95th percentile < 100ms

- **API Response Time**
  - 95th percentile < 300ms

- **Failed Calls**
  - Total count < 10

## Test Coverage

Current test coverage targets:

- Unit tests: > 80% code coverage
- Integration tests: All API endpoints
- Load tests: Realistic production scenarios

## CI/CD Integration

Tests are automatically run in CI/CD pipeline:

1. Unit tests run on every commit
2. Integration tests run on pull requests
3. Load tests run nightly or before releases

## Debugging Tests

### Enable verbose logging:
```bash
DEBUG=* npm test
```

### Run specific test suite:
```bash
npm test -- --testNamePattern="ASR"
```

### Generate coverage report:
```bash
npm run test:coverage
open coverage/lcov-report/index.html
```

## Writing New Tests

### Unit Test Template
```typescript
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

describe('ComponentName', () => {
  let component: ComponentType;
  
  beforeEach(() => {
    // Setup
  });
  
  afterEach(() => {
    // Cleanup
  });
  
  it('should do something', () => {
    // Arrange
    const input = 'test';
    
    // Act
    const result = component.method(input);
    
    // Assert
    expect(result).toBe('expected');
  });
});
```

### Integration Test Template
```typescript
describe('API Endpoint', () => {
  it('should handle request', async () => {
    const response = await request(app)
      .post('/v1/endpoint')
      .set('X-API-Key', 'test-key')
      .send({ data: 'test' });
    
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('id');
  });
});
```

### Load Test Template
```javascript
export default function() {
  const res = http.get('http://test.k6.io');
  check(res, {
    'status is 200': (r) => r.status === 200,
  });
  sleep(1);
}
```

## Troubleshooting

### Common Issues

1. **Tests failing with timeout errors**
   - Increase Jest timeout: `jest.setTimeout(30000)`
   - Check if services are running

2. **WebSocket tests failing**
   - Ensure realtime service is running
   - Check WebSocket port is not blocked

3. **Load tests showing high error rate**
   - Check service capacity
   - Verify rate limits are appropriate
   - Monitor service logs for errors

4. **Coverage not generating**
   - Ensure `collectCoverage` is true in jest.config.js
   - Check `collectCoverageFrom` patterns

## Contributing

When adding new features:
1. Write unit tests first (TDD approach)
2. Add integration tests for new endpoints
3. Update load tests for new scenarios
4. Ensure all tests pass before submitting PR
5. Maintain > 80% code coverage

## Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [k6 Documentation](https://k6.io/docs/)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)