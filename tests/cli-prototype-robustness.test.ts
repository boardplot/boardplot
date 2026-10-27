/**
 * The CLI's verdicts and output bytes must not change when the JavaScript
 * host defines extra properties on Object.prototype (a broken or hostile
 * embedding environment). zod reads required-key presence through the
 * prototype chain and assembles output on ordinary objects, so without the
 * ownedDocumentCopy boundary in loadDoc/docExpand — and null-prototype flag
 * and option objects — inherited values validated as authored content,
 * restyled renders, and turned a rejected document into an accepted one.
 *
 * Out of scope, documented at the code sites: an inherited NON-WRITABLE
 * property that exists before module import breaks zod's own class
 * construction (ZodUnion assigns inst.options at schema build), and one whose
 * name a document legitimately authors can break zod's output assembly —
 * both fail loudly and are zod's boundary, not the document layer's.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import '../src/core/charts';
import { main } from '../src/cli/main';
import { diagnosedSafeParse, parseOwned } from '../src/core/schema/shared';

const COLUMN_DOC = {
  version: 1,
  charts: [
    {
      name: 'rev',
      type: 'column',
      data: {
        categories: [{ id: 'q1' }, { id: 'q2' }],
        series: [{ id: 's', values: [1, 2] }],
      },
    },
  ],
};

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'boardplot-proto-robustness-'));
  temporaryDirectories.push(directory);
  return directory;
}

function runQuiet(argv: string[]): { code: number; logs: string[] } {
  const logs: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...values) => logs.push(values.join(' ')));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const code = main(argv);
  vi.restoreAllMocks();
  return { code, logs };
}

function renderedSvg(argv: string[], doc: object): string {
  const directory = tempDir();
  const docPath = join(directory, 'doc.json');
  writeFileSync(docPath, JSON.stringify(doc));
  const outDir = join(directory, 'out');
  const { code } = runQuiet(['render', docPath, '-o', outDir, ...argv]);
  expect(code).toBe(0);
  const svgName = readdirSync(outDir).find((entry) => entry.endsWith('.svg'));
  expect(svgName).toBeDefined();
  return readFileSync(join(outDir, svgName!), 'utf8');
}

function withInherited(
  key: string,
  value: unknown,
  writable: boolean,
  body: () => void,
): void {
  Object.defineProperty(Object.prototype, key, {
    value,
    configurable: true,
    enumerable: false,
    writable,
  });
  try {
    body();
  } finally {
    delete (Object.prototype as Record<string, unknown>)[key];
  }
}

describe('a bare chart name names its file under -o', () => {
  const NAMED = { ...COLUMN_DOC.charts[0]!, name: 'revenue-q' };

  function renderTo(out: string, spec: object): { code: number; body: { ok: boolean; outputs?: string[]; errors: { code: string; message: string; path?: string }[] } } {
    const specPath = join(tempDir(), 'spec.json');
    writeFileSync(specPath, JSON.stringify(spec));
    const { code, logs } = runQuiet(['render', specPath, '-o', out]);
    return { code, body: JSON.parse(logs[0]!) };
  }

  it('writes <dir>/revenue-q.svg for a spec named revenue-q, and chart.svg without a name', () => {
    const out = join(tempDir(), 'out');
    const { code, body } = renderTo(out, NAMED);
    expect(code).toBe(0);
    expect(body.outputs).toEqual([join(out, 'revenue-q.svg')]);
    const { name: _name, ...unnamed } = NAMED;
    expect(renderTo(out, unnamed).body.outputs).toEqual([join(out, 'chart.svg')]);
    expect(readdirSync(out).sort()).toEqual(['chart.svg', 'revenue-q.svg']);
  });

  it('gives a taken name -2 and leaves the first file as it was', () => {
    const out = join(tempDir(), 'out');
    renderTo(out, NAMED);
    const first = readFileSync(join(out, 'revenue-q.svg'), 'utf8');
    expect(renderTo(out, NAMED).body.outputs).toEqual([join(out, 'revenue-q-2.svg')]);
    expect(readFileSync(join(out, 'revenue-q.svg'), 'utf8')).toBe(first);
  });

  it('refuses a name that is not a file stem, and points a named chart\'s findings at the bare spec', () => {
    const out = join(tempDir(), 'out');
    const unsafe = renderTo(out, { ...NAMED, name: '../escape' });
    expect(unsafe.code).toBe(1);
    expect(unsafe.body.errors).toMatchObject([{ code: 'invalid-name', path: '/name' }]);
    expect(readdirSync(join(out, '..'))).not.toContain('escape.svg');
    const mistyped = renderTo(out, { ...NAMED, type: 'colum' });
    expect(mistyped.code).toBe(1);
    expect(mistyped.body.errors[0]!.message).toBe("unknown type 'colum'");
    expect(mistyped.body.errors[0]!.path).toBe('/type');
  });

  it('says an envelope chart without a name is missing its name, repeated or not', () => {
    const { name: _name, data, ...unnamed } = COLUMN_DOC.charts[0]!;
    const repeated = { ...unnamed, repeat: { dimension: 'region', values: ['north'] }, data: { bySlice: { north: data } } };
    for (const chart of [{ ...unnamed, data }, repeated]) {
      const { code, body } = renderTo(join(tempDir(), 'out'), { version: 1, charts: [chart] });
      expect(code).toBe(1);
      expect(body.errors[0]).toMatchObject({ path: '/charts/0/name' });
      expect(body.errors[0]!.message).toMatch(/^charts\.0\.name: chart name is missing/);
    }
  });
});

describe('CLI robustness against inherited Object.prototype properties', () => {
  it('renders byte-identically under inherited option and flag values', () => {
    const clean = renderedSvg([], COLUMN_DOC);
    withInherited('options', { labels: false }, true, () => {
      withInherited('interactive', true, true, () => {
        expect(renderedSvg([], COLUMN_DOC)).toBe(clean);
      });
    });
  });

  it('renders a grid byte-identically under an inherited panel option value', () => {
    const gridDoc = {
      version: 1,
      charts: [
        {
          name: 'g',
          type: 'grid',
          data: { panels: [{ id: 'p', type: 'column', data: COLUMN_DOC.charts[0]!.data }] },
        },
      ],
    };
    const clean = renderedSvg([], gridDoc);
    for (const writable of [false, true]) {
      withInherited('options', { labels: false }, writable, () => {
        expect(renderedSvg([], gridDoc), `writable=${writable}`).toBe(clean);
      });
    }
  });

  it('removes removable foreign prototype members and validates cleanly', () => {
    // A configurable inherited property, writable or not, is deleted at
    // main() entry — the authored document then validates as if the
    // environment were clean.
    const directory = tempDir();
    const docPath = join(directory, 'doc.json');
    writeFileSync(
      docPath,
      JSON.stringify({
        version: 1,
        charts: [{ ...COLUMN_DOC.charts[0], options: { variant: 'stacked' } }],
      }),
    );
    withInherited('variant', 'grouped', false, () => {
      expect(runQuiet(['render', docPath]).code).toBe(0);
    });
  });

  it('names the environment for a NON-removable conflicting property (subprocess)', () => {
    // Non-configurable pollution cannot be removed or cleaned up, so it runs
    // in its own process: the CLI must warn at entry and, where zod's output
    // assembly breaks on the authored key, fail with the Object.prototype
    // diagnosis instead of a bare assignment error.
    const directory = tempDir();
    const docPath = join(directory, 'doc.json');
    writeFileSync(
      docPath,
      JSON.stringify({
        version: 1,
        charts: [{ ...COLUMN_DOC.charts[0], options: { variant: 'stacked' } }],
      }),
    );
    const script = [
      "Object.defineProperty(Object.prototype, 'variant', { value: 'grouped', configurable: false, enumerable: false, writable: false });",
      "import('./src/cli/main.ts').then(({ main }) => {",
      `  const code = main(['render', ${JSON.stringify(docPath)}]);`,
      '  process.exit(code === 0 ? 10 : 0);',
      '});',
    ].join('\n');
    const spawned = spawnSync(process.execPath, ['--import', 'tsx', '-e', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 120_000,
    });
    expect(spawned.status, spawned.stderr).toBe(0);
    expect(spawned.stdout + spawned.stderr).toContain('Object.prototype');
  });

  // outcome pins for the shared parse boundary that the CLI and parseData
  // route through. The end-to-end
  // convergence (an inherited-only grid key refusing exactly like a clean
  // environment) is pinned in tests/grid-child-refusals.test.ts; these two
  // pin the boundary's own contract.
  it('diagnosedSafeParse names the environment for a TypeError from inside the parse', () => {
    const throwing = {
      safeParse: () => {
        throw new TypeError("Cannot assign to read only property 'variant' of object");
      },
    } as unknown as z.ZodType<unknown>;
    expect(() => diagnosedSafeParse(throwing, {})).toThrow(/Object\.prototype/);
    const failing = {
      safeParse: () => {
        throw new RangeError('unrelated');
      },
    } as unknown as z.ZodType<unknown>;
    // Only TypeError is the environment signature — everything else stays.
    expect(() => diagnosedSafeParse(failing, {})).toThrow(RangeError);
  });

  it('parseOwned keeps inherited keys out of the parsed result', () => {
    const schema = z.object({ marker: z.string().optional() });
    withInherited('marker', 'phantom', true, () => {
      const result = parseOwned(schema, {});
      expect(result.success).toBe(true);
      // The contract is that no phantom key is MATERIALIZED into the parsed
      // data. Reads through a still-installed gadget on the output's normal
      // prototype are the process-entry sanitizer's territory, not this
      // boundary's.
      if (result.success) expect(Object.hasOwn(result.data, 'marker')).toBe(false);
    });
  });
});
