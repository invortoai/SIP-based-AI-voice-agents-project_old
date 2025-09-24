const { pathsToModuleNameMapper } = require('ts-jest');

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
    // Always use mock for @invorto/shared during tests - put this first to avoid conflicts
    '^@invorto/shared$': '<rootDir>/tests/mocks/invorto-shared.ts',
    // Specific sub-path mappings for shared package
    '^@invorto/shared/src/observability$': '<rootDir>/packages/shared/src/observability.ts',
    '^@invorto/shared/src/security$': '<rootDir>/packages/shared/src/security.ts',
    '^@invorto/shared/(.*)$': '<rootDir>/packages/shared/src/$1',
    '^@invorto/shared-core$': '<rootDir>/packages/shared-core/src/index.ts',
    '^@invorto/shared-core/(.*)$': '<rootDir>/packages/shared-core/src/$1',
    '^@deepgram/sdk$': '<rootDir>/tests/mocks/deepgram-sdk.ts',
    '^ioredis$': '<rootDir>/tests/mocks/ioredis.ts',
    '^sdk/(.*)$': '<rootDir>/sdk/$1/dist',
    '^services/(.*)$': '<rootDir>/services/$1/dist',
    '^packages/(.*)$': '<rootDir>/packages/$1/dist',
    // Map .js imports to .ts files for local project modules only
    '^(sdk|services|packages)/(.*)\\.js$': '<rootDir>/$1/$2.ts'
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  testTimeout: 60000,
  verbose: true,
  // runInBand: true, // This option is deprecated, use maxWorkers: 1 instead
  maxWorkers: 1,
  detectOpenHandles: true,
  forceExit: true, // Force Jest to exit even if there are pending handlers
  // Add this to help with async cleanup
  testEnvironmentOptions: {
    // Ensure proper cleanup of async operations
  },
  // Use ts-jest without ESM to avoid module resolution issues
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: '<rootDir>/tests/tsconfig.json',
      useESM: false
    }]
  },
  // Remove ESM-specific configurations that were causing issues
  extensionsToTreatAsEsm: [],
  // CI-specific optimizations
  ...(process.env.CI && {
    // Reduce memory usage in CI
    maxWorkers: 2,
    // More verbose output in CI for debugging
    verbose: true,
    // Ensure proper cleanup
    detectOpenHandles: false,
    forceExit: true
  })
};