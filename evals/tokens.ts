/**
 * Token ceiling. Measures the bytes of `boardplot list` and of
 * `boardplot describe <type>` for every chart type, as the CLI prints them, and
 * fails when a type's pair exceeds PAIR_MAX or its describe alone exceeds
 * DESCRIBE_MAX. An AI that reads the catalogue and one type's contract must
 * fit both in its context with room to spare.
 */
import { list } from '../src/cli/list';
import { describe } from '../src/cli/describe';
import { listCharts } from '../src/core/registry';

export const PAIR_MAX = 32_000;
export const DESCRIBE_MAX = 16_000;

/** Bytes of one CLI answer: the JSON line plus its newline. */
function printed(body: Record<string, unknown>): number {
  return Buffer.byteLength(`${JSON.stringify(body)}\n`, 'utf8');
}

export function tokenCeiling() {
  // `list` reports the package version as `engine`, the same in source and in
  // a built package, so this is what an installed CLI prints.
  const listBytes = printed(list().body);
  const types = listCharts().map((chart) => chart.type).sort().map((type) => {
    const describeBytes = printed(describe({ type }).body);
    const pair = listBytes + describeBytes;
    return { type, describe: describeBytes, pair, ok: pair <= PAIR_MAX && describeBytes <= DESCRIBE_MAX };
  });
  const largest = types.reduce((top, entry) => (entry.pair > top.pair ? entry : top));
  return { limits: { pair: PAIR_MAX, describe: DESCRIBE_MAX }, list: listBytes, largest, failed: types.filter((entry) => !entry.ok), types };
}

const report = tokenCeiling();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
for (const entry of report.failed) {
  console.error(`${entry.type}: list + describe is ${entry.pair} bytes (limit ${PAIR_MAX}); describe alone ${entry.describe} (limit ${DESCRIBE_MAX})`);
}
process.exitCode = report.failed.length === 0 ? 0 : 1;
