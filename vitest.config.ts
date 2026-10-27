import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';

// Cap workers to avoid starving tests that bundle entries, spawn processes
// or rasterize through Chrome. A worker starved past 60 s trips birpc's fixed
// RPC timeout, which Vitest reports as the unhandled error
// `Timeout calling "onTaskUpdate"`. With the default worker count, the suite
// failed in two of three runs on a 16-core machine. Eight workers passed
// and finished quicker. Keep one core free on smaller machines.
const maxWorkers = Math.min(8, Math.max(availableParallelism() - 1, 1));

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    maxWorkers,
    // Vitest's 5s default leaves no margin for this suite: the
    // world-inflation choropleth case takes about
    // 1s alone and 4 to 6s beside the other files, so it fails whenever the
    // machine is also doing something else. A file that declares its own
    // timeout keeps it; this is the floor under everything that never
    // declared one.
    testTimeout: 15_000,
  },
});
