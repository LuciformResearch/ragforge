import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/*.spec.ts'
      ]
    },
    testMatch: ['**/__tests__/**/*.test.ts', '**/*.spec.ts'],
    setupFiles: [],
    // Allow tests to run for up to 30 seconds (for real LLM calls)
    testTimeout: 30000
  }
});
