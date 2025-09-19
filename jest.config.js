module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  // Only run unit and integration test suites by default; exclude e2e/performance/load by pattern
  testMatch: [
    '<rootDir>/tests/unit/**/*.test.ts',
    '<rootDir>/tests/integration/**/*.test.ts',
    '<rootDir>/tests/realtime/**/*.test.ts'
  ],
  collectCoverageFrom: [
    'services/**/*.ts',
    'packages/**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/dist/**',
  ],
  testPathIgnorePatterns: [
    '<rootDir>/tests/e2e/',
    '<rootDir>/tests/performance/',
    '<rootDir>/tests/load/'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  moduleNameMapper: {
    '^@invorto/shared$': '<rootDir>/tests/mocks/invorto-shared.ts',
    '^@invorto/shared/(.*)$': '<rootDir>/packages/shared/src/$1',
    '^@deepgram/sdk$': '<rootDir>/tests/mocks/deepgram-sdk.ts',
    '^ioredis$': '<rootDir>/tests/mocks/ioredis.ts',
    '^sdk/(.*)$': '<rootDir>/sdk/$1',
    '^services/(.*)$': '<rootDir>/services/$1',
    '^packages/(.*)$': '<rootDir>/packages/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  testTimeout: 20000,
  verbose: true,
  runInBand: true,
  detectOpenHandles: true,
  // Enable ts-jest transform explicitly for TS (ESM-friendly)
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: '<rootDir>/tests/tsconfig.json',
      useESM: true
    }]
  },
  extensionsToTreatAsEsm: ['.ts']
};