/**
 * Byte-level regression net over every registered fixture.
 *
 *   npx vitest run tests/golden-svg.test.ts                     compare
 *   GOLDEN_UPDATE=1 npx vitest run tests/golden-svg.test.ts     re-baseline
 *   GOLDEN_WRITE_DIR=/tmp/after npx vitest run tests/golden-svg.test.ts
 *                                                               dump the SVGs
 *
 * A failure lists the changed keys. Before re-baselining, dump the SVGs of
 * the base (GOLDEN_WRITE_DIR=<dir>/before) and of the change
 * (GOLDEN_WRITE_DIR=<dir>/after), list the changed files with
 * `diff -rq <dir>/before <dir>/after`, and look at each changed pair; an
 * unreviewed update turns the net into a rubber stamp.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { goldenEntries } from './golden/render';

const MANIFEST = join(__dirname, 'golden', 'manifest.json');

function readManifest(): Record<string, string> {
  if (!existsSync(MANIFEST)) return {};
  return JSON.parse(readFileSync(MANIFEST, 'utf8')) as Record<string, string>;
}

// 600 fixtures, unsized ones laid out twice (rowDrivenHeight): the default
// 5 s budget is not enough under full-suite load.
// 1,514 keys with the report re-layout passes take about 45-60 s on a busy machine.
describe('golden SVG set', { timeout: 120_000 }, () => {
  it('every fixture renders to the recorded bytes', () => {
    const entries = goldenEntries();
    expect(entries.length).toBeGreaterThan(500);

    const writeDir = process.env.GOLDEN_WRITE_DIR;
    if (writeDir) {
      for (const entry of entries) {
        const ext = entry.output.startsWith('ERROR:') ? 'txt' : 'svg';
        const file = join(writeDir, entry.type, `${entry.fixtureId}.${entry.variant}.${ext}`);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, entry.output);
      }
    }

    const current: Record<string, string> = {};
    for (const entry of entries.sort((a, b) => (a.key < b.key ? -1 : 1))) current[entry.key] = entry.sha256;

    if (process.env.GOLDEN_UPDATE) {
      writeFileSync(MANIFEST, `${JSON.stringify(current, null, 2)}\n`);
      return;
    }

    const recorded = readManifest();
    const changed = Object.keys(current).filter((k) => recorded[k] !== undefined && recorded[k] !== current[k]);
    const added = Object.keys(current).filter((k) => recorded[k] === undefined);
    const removed = Object.keys(recorded).filter((k) => current[k] === undefined);
    const errors = entries.filter((e) => e.output.startsWith('ERROR:')).map((e) => `${e.key}: ${e.output}`);

    const report = [
      changed.length ? `changed (${changed.length}):\n  ${changed.slice(0, 60).join('\n  ')}` : '',
      added.length ? `added (${added.length}):\n  ${added.slice(0, 60).join('\n  ')}` : '',
      removed.length ? `removed (${removed.length}):\n  ${removed.slice(0, 60).join('\n  ')}` : '',
      errors.length ? `entries that threw (${errors.length}):\n  ${errors.slice(0, 20).join('\n  ')}` : '',
      'Review before re-baselining: dump the base and this change with GOLDEN_WRITE_DIR=<dir>/before and GOLDEN_WRITE_DIR=<dir>/after, run diff -rq <dir>/before <dir>/after, look at each changed pair, then: GOLDEN_UPDATE=1 npx vitest run tests/golden-svg.test.ts',
    ]
      .filter(Boolean)
      .join('\n');

    expect({ changed: changed.length, added: added.length, removed: removed.length }, report).toEqual({
      changed: 0,
      added: 0,
      removed: 0,
    });
  });
});
