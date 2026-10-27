import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Each file starts the built server with two render children.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
