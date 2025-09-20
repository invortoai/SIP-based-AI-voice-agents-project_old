/**
 * Global Jest setup for integration tests
 * - Ensures predictable test environment
 * - Increases default timeouts for networked tests
 * - Sets sane defaults for env vars expected by services
 * - Builds workspace packages before running tests
 */
import path from 'node:path';
import dotenv from 'dotenv';
import { execSync } from 'child_process';

// Load test environment from tests/.env.test if present
try {
  dotenv.config({ path: path.resolve(__dirname, '.env.test') });
} catch {}

/* Base test env */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

/* Provide defaults to avoid plugin init failures */
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.JWT_PUBLIC_KEY = process.env.JWT_PUBLIC_KEY || '-----BEGIN PUBLIC KEY-----\nMFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBALXG1Q==\n-----END PUBLIC KEY-----';
process.env.WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'test_webhook_secret';

/* Telephony concurrency safe test defaults (global caps enforced in services/telephony) */
process.env.TELEPHONY_GLOBAL_MAX_CONCURRENCY = process.env.TELEPHONY_GLOBAL_MAX_CONCURRENCY || '10';
process.env.TELEPHONY_PER_CAMPAIGN_MAX_CONCURRENCY = process.env.TELEPHONY_PER_CAMPAIGN_MAX_CONCURRENCY || '5';
process.env.TELEPHONY_SEMAPHORE_TTL_SEC = process.env.TELEPHONY_SEMAPHORE_TTL_SEC || '60';

/* Ensure services don't bind network ports during tests */
process.env.JEST_WORKER_ID = process.env.JEST_WORKER_ID || '1';

/* Build workspace packages before running tests to ensure .js files exist */
try {
  console.log('Building workspace packages...');
  execSync('npm run build', {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..')
  });
  console.log('Workspace packages built successfully');
} catch (error) {
  console.error('Failed to build workspace packages:', error);
  throw error;
}

/* Redis is mapped to ioredis-mock via jest.config.js moduleNameMapper to avoid real Redis in tests */

/* Mock Deepgram SDK globally to prevent real WS connections and open handles in tests */
jest.mock('@deepgram/sdk', () => {
  type HandlerMap = Record<string, Array<(...args: any[]) => void>>;
  const makeLive = () => {
    const handlers: HandlerMap = {};
    return {
      on(event: string, cb: (...args: any[]) => void) {
        (handlers[event] ||= []).push(cb);
        return this;
      },
      send(_data?: any) {
        // no-op
      },
      close() {
        const list = handlers['close'] || [];
        for (const fn of list) {
          try { fn(); } catch {}
        }
      }
    };
  };
  return {
    createClient: () => ({
      listen: { live: makeLive },
      speak: { live: makeLive },
      onprem: {},
      manage: {},
      read: {},
    })
  };
});

/* Helper to wait */
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* Global cleanup for async operations */
afterAll(async () => {
  // Add a small delay to allow any pending async operations to complete
  await sleep(100);
});

// Handle unhandled promise rejections during tests
process.on('unhandledRejection', (reason, promise) => {
  // Only log if it's not the expected "Cannot log after tests are done" warning
  const reasonStr = reason?.toString() || '';
  if (!reasonStr.includes('Cannot log after tests are done')) {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  }
});

// Handle uncaught exceptions during tests
process.on('uncaughtException', (error) => {
  // Only log if it's not related to test cleanup
  const errorStr = error?.toString() || '';
  if (!errorStr.includes('Cannot log after tests are done')) {
    console.error('Uncaught Exception:', error);
  }
});