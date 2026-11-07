import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { relative, sep } from 'node:path';
import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

// `--shard k/n` splits by file count after a hash, so one CI shard got 764 s of tests
// and another 186 s. This sequencer splits by the seconds in tests/shard-times.json
// (per-file times from a CI log, longest first onto the lightest shard). A file
// missing from the table counts as the median, so a stale table only skews the split.
const times: Record<string, number> = JSON.parse(readFileSync(new URL('./tests/shard-times.json', import.meta.url), 'utf8'));
const median = Object.values(times).sort((a, b) => a - b)[Object.keys(times).length >> 1];

class TimedSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { index, count } = this.ctx.config.shard!;
    const key = (file: TestSpecification) => relative(this.ctx.config.root, file.moduleId).split(sep).join('/');
    const seconds = (file: TestSpecification) => times[key(file)] ?? median;
    const loads = new Array<number>(count).fill(0);
    const mine: TestSpecification[] = [];
    for (const file of [...files].sort((a, b) => seconds(b) - seconds(a) || (key(a) < key(b) ? -1 : 1))) {
      const shard = loads.indexOf(Math.min(...loads));
      loads[shard] += seconds(file);
      if (shard === index - 1) mine.push(file);
    }
    return mine;
  }
}

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
    sequence: { sequencer: TimedSequencer },
  },
});
