/**
 * Global Jest setup for integration tests
 * - Ensures predictable test environment
 * - Increases default timeouts for networked tests
 * - Sets sane defaults for env vars expected by services
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// Provide defaults to avoid plugin init failures
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.JWT_PUBLIC_KEY = process.env.JWT_PUBLIC_KEY || '-----BEGIN PUBLIC KEY-----\nMFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBALXG1Q==\n-----END PUBLIC KEY-----';
process.env.WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'test_webhook_secret';

// Keep tests serial when needed via CI (set in workflow). Locally this file is OK as-is.

// Helper to wait
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));