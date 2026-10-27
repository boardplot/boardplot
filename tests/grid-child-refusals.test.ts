/**
 * Grid composition forwards EVERY child-schema refusal. If it forwarded only
 * the issues whose message contained 'duplicate', magnitude bounds and shape
 * errors would be dropped, layout would receive the raw data, and
 * `boardplot validate` would say ok:true for documents every child refuses
 * standalone. Example: a grid-embedded bullet row with bands
 * [Number.MAX_VALUE] would render 0.5px geometry through a green validate.
 *
 * Two layers split the enforcement. Cell-value leaves (series values) belong
 * to the layout-time normalize layer: most child layouts re-run normalizeCell,
 * and validate reaches it through its lint stage, so those refused in grid
 * panels all along. Schema-only checks — bullet band bounds, strict-object
 * shape, union cell shape — have no layout twin, which is why stripping their
 * forwarding silently unenforced them. This suite pins the forwarding for the
 * schema class and proves the normalize layer holds for the value class.
 */

import { getFixtures } from '../src/fixtures';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import '../src/core/charts';
import { main } from '../src/cli/main';
import { gridDataSchema, normalizeGridData } from '../src/core/charts/grid';
import { getChart, getChartDefinition } from '../src/core/registry';
import { requireGeometry } from '../src/core/sizing';
import type { GridMarks } from '../src/core/charts/grid/layout';

const grid = () => getChartDefinition('grid')!;

const bulletBandRepro = {
  panels: [
    {
      id: 'kpi',
      type: 'bullet',
      data: { rows: [{ id: 'r', value: 1, target: 2, bands: [Number.MAX_VALUE] }] },
    },
  ],
};

describe('grid child-schema refusal forwarding', () => {
  // Keyed series must rank by category order, with the same ties and missing panels as positional series.
  it('sorts keyed and positional panel values in the same numeric order', () => {
    const rows = [[100, 10], [20, 30], [20, 30], [null, null]];
    const draw = (keyed: boolean, panelOrder: string) => requireGeometry(grid().layout({ panels: rows.map((values, i) => ({
      id: `p${i}`, type: 'column', data: { categories: ['a', 'b'], series: [{ id: 's', values: keyed ? [{ categoryId: 'b', value: values[1] }, { categoryId: 'a', value: values[0] }] : values }] },
    })) }, { sharedAxis: 'none', sharedScale: false, columns: 2, panelOrder, size: { width: 960 } }));
    for (const order of ['lastDesc', 'lastAsc', 'totalAsc', 'totalDesc']) {
      const positional = draw(false, order);
      const keyed = draw(true, order);
      const ids = (g: typeof positional) => (g.marks as GridMarks).panels.map((p) => p.id);
      expect(ids(keyed)).toEqual(ids(positional));
      expect(ids(keyed).at(-1)).toBe('p3');
      expect(ids(keyed).indexOf('p1')).toBeLessThan(ids(keyed).indexOf('p2'));
      expect(keyed.warnings.filter((w) => w.code === 'panel-order-unmeasured')).toEqual(positional.warnings.filter((w) => w.code === 'panel-order-unmeasured'));
    }
  });

  it('refuses the bullet band-magnitude document at the schema boundary', () => {
    expect(() => grid().normalize(bulletBandRepro)).toThrow(
      /exceeds the supported magnitude of 1e15/,
    );

    const result = grid().dataSchema.safeParse(bulletBandRepro);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]).toMatchObject({
      message: expect.stringContaining('exceeds the supported magnitude of 1e15'),
      path: ['panels', 0, 'data', 'rows', 0, 'bands', 0],
    });
  });

  it('refuses the same repro through `boardplot validate` with the panel path', () => {
    // Without the forwarding, validate answered ok:true on this document.
    const { code, envelope } = validate({
      version: 1,
      charts: [{ name: 'g', type: 'grid', data: bulletBandRepro }],
    });
    expect(code).toBe(1);
    expect(envelope.ok).toBe(false);
    expect(envelope.errors).toContainEqual(
      expect.objectContaining({
        code: 'invalid-data',
        path: '/charts/0/data/panels/0/data/rows/0/bands/0',
        displayPath: 'charts[g].data.panels.0.data.rows.0.bands.0',
        message: expect.stringContaining('exceeds the supported magnitude of 1e15'),
      }),
    );
  });

  it('prefixes repeat-slice refusals with the bySlice path', () => {
    const result = grid().dataSchema.safeParse({
      repeat: { dimension: 'region', values: ['EU', 'UK'] },
      template: {
        type: 'bullet',
        data: {
          bySlice: {
            EU: { rows: [{ id: 'r', value: 1, target: 2, bands: [3] }] },
            UK: { rows: [{ id: 'r', value: 1, target: 2, bands: [1e16] }] },
          },
        },
      },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]).toMatchObject({
      message: expect.stringContaining('exceeds the supported magnitude of 1e15'),
      path: ['template', 'data', 'bySlice', 'UK', 'rows', 0, 'bands', 0],
    });
  });

  it('documents the boundary: cell-value leaves are the normalize layer’s job, and it does refuse them', () => {
    // Column's dataSchema accepts a >1e15 series value on purpose — cell
    // magnitude for values lives in layout-time normalizeCell, which validate reaches through its lint stage. The
    // schema forwarding this suite pins covers everything the child schema
    // refuses; this case proves the OTHER layer holds for grid panels too, so
    // between the two no leaf class is silently accepted.
    const doc = {
      panels: [
        {
          id: 'rev',
          type: 'column',
          data: {
            categories: [{ id: 'a' }, { id: 'b' }],
            series: [{ id: 's', values: [1e308, 2] }],
          },
        },
      ],
    };
    expect(grid().dataSchema.safeParse(doc).success).toBe(true);

    const { code, envelope } = validate({ version: 1, charts: [{ name: 'g', type: 'grid', data: doc }] });
    expect(code).toBe(1);
    expect(envelope.errors).toContainEqual(
      expect.objectContaining({
        code: 'invalid-number',
        message: expect.stringContaining('exceeds the supported magnitude of 1e15'),
      }),
    );
  });

  it('keeps forwarding child duplicate-id refusals', () => {
    const result = grid().dataSchema.safeParse({
      panels: [
        {
          id: 'rev',
          type: 'column',
          data: {
            categories: [{ id: 'a' }, { id: 'a' }],
            series: [{ id: 's', values: [1, 2] }],
          },
        },
      ],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((issue) => issue.message.includes('duplicate'))).toBe(true);
  });

  it('closes the class transitively for nested grids', () => {
    const result = grid().dataSchema.safeParse({
      panels: [{ id: 'outer', type: 'grid', data: bulletBandRepro }],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]).toMatchObject({
      message: expect.stringContaining('exceeds the supported magnitude of 1e15'),
      path: ['panels', 0, 'data', 'panels', 0, 'data', 'rows', 0, 'bands', 0],
    });
  });

  it('forwards refusals byte-identical to standalone, panel prefix aside', () => {
    // The core claim, pinned exactly: same chart name, same child
    // data, once standalone and once grid-wrapped — the envelope error must
    // carry the identical message and the identical path with only the
    // panel prefix inserted.
    const cases = [
      { type: 'bullet', data: bulletBandRepro.panels[0]!.data },
      {
        type: 'column',
        data: { categories: [{}], series: [{ id: 's', values: [1] }] },
      },
    ] as const;
    for (const child of cases) {
      const standalone = validate({
        version: 1,
        charts: [{ name: 'x', type: child.type, data: child.data }],
      });
      const wrapped = validate({
        version: 1,
        charts: [
          {
            name: 'x',
            type: 'grid',
            data: { panels: [{ id: 'p', type: child.type, data: child.data }] },
          },
        ],
      });
      expect(standalone.code, child.type).toBe(1);
      expect(wrapped.code, child.type).toBe(1);
      const standaloneError = standalone.envelope.errors.find((error) => error.code === 'invalid-data');
      const wrappedError = wrapped.envelope.errors.find((error) => error.code === 'invalid-data');
      expect(standaloneError, child.type).toBeDefined();
      // The message names its field, so it carries the same panel prefix.
      expect(wrappedError?.message, child.type).toBe(
        standaloneError?.message.replace('charts[x].data.', 'charts[x].data.panels.0.data.'),
      );
      expect(wrappedError?.path, child.type).toBe(
        standaloneError?.path?.replace('/charts/0/data', '/charts/0/data/panels/0/data'),
      );
    }
  });

  it('still accepts every registered grid fixture', () => {
    for (const fixture of getFixtures(grid().type)) {
      const result = grid().dataSchema.safeParse(fixture.data);
      expect(result.success, fixture.id).toBe(true);
    }
  });
});

// normalizeGridData must not throw NormalizeError straight out of
// gridDataSchema.safeParse, which the CLI would degrade to a pathless cli-error.
describe('grid safeParse refusal hardening', () => {
  const badTextPanel = { panels: [{ id: 't', type: 'text', data: { bogus: 1 } }] };

  it('refuses an unknown text-panel data key through safeParse instead of throwing', () => {
    const result = gridDataSchema.safeParse(badTextPanel);
    if (result.success) throw new Error('grid must refuse an unknown text-panel data key');
    const issue = result.error.issues.find((candidate) => candidate.message.includes('bogus'));
    expect(issue?.path).toEqual(['panels', 0, 'data']);
  });

  it('carries the refusal into the CLI envelope as invalid-data with the panel path', () => {
    const { code, envelope } = validate({
      version: 1,
      charts: [{ name: 'g', type: 'grid', data: badTextPanel }],
    });
    expect(code).toBe(1);
    expect(envelope.ok).toBe(false);
    expect(envelope.errors.some((error) => error.code === 'cli-error')).toBe(false);
    const refusal = envelope.errors.find((error) => error.code === 'invalid-data');
    expect(refusal?.path).toBe('/charts/0/data/panels/0/data');
    expect(refusal?.message).toContain('bogus');
  });

  it('still refuses duplicate explicit panel ids with the pathed issue', () => {
    const result = gridDataSchema.safeParse({
      panels: [
        { id: 'a', type: 'text', data: { title: 'x' } },
        { id: 'a', type: 'text', data: { title: 'y' } },
      ],
    });
    if (result.success) throw new Error('grid must refuse duplicate panel ids');
    const issue = result.error.issues.find((candidate) => candidate.message.includes('duplicate panel id'));
    expect(issue?.path).toEqual(['panels', 1, 'id']);
  });

  it('refuses a repeat value whose slice exists only on the prototype chain', () => {
    for (const value of ['toString', 'constructor']) {
      const result = gridDataSchema.safeParse({
        repeat: { dimension: 'd', values: [value] },
        template: { type: 'column', data: { bySlice: { EU: someColumnData() } } },
      });
      if (result.success) throw new Error(`grid must refuse the phantom slice '${value}'`);
      const issue = result.error.issues.find((candidate) =>
        candidate.message.includes(`missing data slice for repeat value '${value}'`),
      );
      expect(issue?.path, value).toEqual(['template', 'data', 'bySlice', value]);
    }
  });

  it("refuses the reserved '__proto__' repeat value by name, even when owned", () => {
    // z.record's parsed copy drops an own '__proto__' key, so a 'missing
    // data slice' message would misstate data the author really wrote.
    const bySlice = JSON.parse(`{"__proto__": ${JSON.stringify(someColumnData())}}`) as Record<string, unknown>;
    expect(Object.hasOwn(bySlice, '__proto__')).toBe(true);
    const result = gridDataSchema.safeParse({
      repeat: { dimension: 'd', values: ['__proto__'] },
      template: { type: 'column', data: { bySlice } },
    });
    if (result.success) throw new Error('grid must refuse the reserved slice name');
    const issue = result.error.issues.find((candidate) => candidate.message.includes('reserved'));
    expect(issue?.path).toEqual(['repeat', 'values', 0]);
  });

  it('accepts a genuinely owned slice named like a prototype member', () => {
    const result = gridDataSchema.safeParse({
      repeat: { dimension: 'd', values: ['toString'] },
      template: { type: 'column', data: { bySlice: { toString: someColumnData() } } },
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid text and legend slices in repeat templates', () => {
    for (const [type, slice] of [
      ['text', { title: 'Quarter summary' }],
      ['legend', { from: ['rev'] }],
    ] as const) {
      const result = gridDataSchema.safeParse({
        repeat: { dimension: 'd', values: ['a'] },
        template: { type, data: { bySlice: { a: slice } } },
      });
      expect(result.success, type).toBe(true);
    }
  });

  it('keeps refusing through safeParse under Object.prototype pollution of panels', () => {
    // The union discriminator reads the parsed object; an `in` check answered
    // a polluted prototype and either skipped child forwarding (array shape)
    // or threw off normalized.panels (object shape).
    const repro = {
      repeat: { dimension: 'd', values: ['a'] },
      template: {
        type: 'bullet',
        data: { bySlice: { a: { rows: [{ id: 'r', value: 1, target: 2, bands: [1e16] }] } } },
      },
    };
    for (const pollution of [[], {}] as const) {
      // Non-enumerable, like real gadget pollution: enumerable pollution
      // already trips the strict-object unrecognized-keys check at the base
      // union, which never reaches the discriminator under test.
      Object.defineProperty(Object.prototype, 'panels', {
        value: pollution,
        configurable: true,
        enumerable: false,
      });
      try {
        const result = gridDataSchema.safeParse(repro);
        if (result.success) throw new Error('grid must keep refusing under prototype pollution');
        expect(
          result.error.issues.some((issue) =>
            issue.message.includes('exceeds the supported magnitude of 1e15'),
          ),
          JSON.stringify(pollution),
        ).toBe(true);
      } finally {
        delete (Object.prototype as Record<string, unknown>)['panels'];
      }
    }
  });

  it('refuses a document owning neither panels nor repeat under a VALID prototype gadget', () => {
    // zod's required-key presence check reads `key in input`, so a valid
    // gadget satisfies the explicit branch on `{}` — non-writable would
    // throw out of safeParse via the repeat cast, writable would
    // materialize the inherited array as accepted document data. The pipe
    // stage refuses on the RAW input before zod reads anything, which
    // also forestalls jitless mode's strict-assignment TypeError.
    for (const writable of [false, true]) {
      Object.defineProperty(Object.prototype, 'panels', {
        value: [{ id: 't', type: 'text', data: { title: 'gadget' } }],
        configurable: true,
        enumerable: false,
        writable,
      });
      try {
        const result = gridDataSchema.safeParse({});
        if (result.success) throw new Error('grid must refuse a document owning neither key');
        expect(
          result.error.issues.some((issue) =>
            issue.message.includes("must own 'panels' or 'repeat'"),
          ),
          `writable=${writable}`,
        ).toBe(true);
      } finally {
        delete (Object.prototype as Record<string, unknown>)['panels'];
      }
    }
  });

  it('refuses inherited-only branch keys through normalize and the CLI alike', () => {
    // The registered normalize parses through the piped schema, and
    // normalizeGridData carries its own raw-input twin for direct callers —
    // a writable valid gadget must fail every consumer, not just safeParse.
    // The 'repeat' gadget additionally exercises the doc expander, which
    // must not drag every chart into the repeat parse off the bare read.
    const gadgets = [
      ['panels', [{ id: 't', type: 'text', data: { title: 'gadget' } }]],
      ['repeat', { dimension: 'd', values: ['a'] }],
    ] as const;
    for (const [key, value] of gadgets) {
      for (const writable of [false, true]) {
        Object.defineProperty(Object.prototype, key, {
          value,
          configurable: true,
          enumerable: false,
          writable,
        });
        const label = `${key} writable=${writable}`;
        try {
          expect(() => normalizeGridData({}), `direct ${label}`).toThrow(
            /must own 'panels' or 'repeat'/,
          );
          // The registered normalize now parses through parseData, whose
          // copy-in boundary makes the inherited key invisible before any
          // grid check runs — the empty document refuses exactly as it
          // would in a clean environment (the plain base union), which is
          // the point: pollution must not change the refusal. The guard's
          // own text stays pinned by the two raw legs above.
          expect(() => grid().normalize({}), `registered ${label}`).toThrow(/Invalid input/);
          const { code, envelope } = validate({
            version: 1,
            charts: [{ name: 'g', type: 'grid', data: {} }],
          });
          // The CLI neutralizes the gadget before any parse (loadDoc's
          // ownedDocumentCopy cuts the prototype chain), so the empty grid
          // data refuses through the plain base union rather than the
          // must-own guard — the guard's own text is pinned by the
          // safeParse/normalize legs above, which bypass the CLI boundary.
          expect(code, `cli ${label}`).toBe(1);
          expect(
            envelope.errors.some((error) => error.code === 'cli-error'),
            `cli ${label}`,
          ).toBe(false);
          expect(
            envelope.errors.some((error) => error.code === 'invalid-data'),
            `cli ${label}`,
          ).toBe(true);
        } finally {
          delete (Object.prototype as Record<string, unknown>)[key];
        }
      }
    }
  });

  it('doc expansion leaves charts without an OWN repeat untouched under pollution', () => {
    for (const writable of [false, true]) {
      Object.defineProperty(Object.prototype, 'repeat', {
        value: { dimension: 'd', values: ['a'] },
        configurable: true,
        enumerable: false,
        writable,
      });
      try {
        const { code, envelope } = validate({
          version: 1,
          charts: [
            {
              name: 'c',
              type: 'column',
              data: { categories: [{ id: 'a' }], series: [{ id: 's', values: [1] }] },
            },
          ],
        });
        expect(
          envelope.errors.some((error) => error.code === 'cli-error'),
          `writable=${writable}`,
        ).toBe(false);
        expect(code, `writable=${writable}`).toBe(0);
      } finally {
        delete (Object.prototype as Record<string, unknown>)['repeat'];
      }
    }
  });

  it('survives prototype pollution installed BEFORE module import (subprocess)', () => {
    // The published-schema metadata is serialized at import time; that
    // serialization assigns 'panels' keys onto fresh objects and must not
    // crash the whole CLI with a TypeError under a pre-existing non-writable
    // gadget. In-process tests import too early to see this, hence the spawn.
    const script = [
      "Object.defineProperty(Object.prototype, 'panels', { value: [{ id: 't', type: 'text', data: { title: 'g' } }], configurable: true, enumerable: false, writable: false });",
      "import('./src/core/charts/index.ts')",
      "  .then(async () => {",
      "    const { gridDataSchema } = await import('./src/core/charts/grid/index.ts');",
      '    const result = gridDataSchema.safeParse({});',
      "    if (result.success) { console.log('BAD-accepted'); process.exit(2); }",
      '    const refused = result.error.issues.some((issue) =>',
      `      issue.message.includes("must own 'panels' or 'repeat'"));`,
      "    console.log(refused ? 'OK' : 'BAD-message');",
      '    process.exit(refused ? 0 : 3);',
      '  })',
      "  .catch((error) => { console.log('BAD-import: ' + error.message); process.exit(4); });",
    ].join('\n');
    const spawned = spawnSync(process.execPath, ['--import', 'tsx', '-e', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 120_000,
    });
    expect(spawned.stdout.trim(), spawned.stderr).toBe('OK');
  });

  it('publishes the full grid input schema despite the raw-guard pipe stage', () => {
    // A bare pipe serializes io:'input' as the empty {} schema; the .meta()
    // on the export must keep `boardplot describe` publishing the real union.
    const published = JSON.stringify(z.toJSONSchema(gridDataSchema as z.ZodType, { io: 'input' }));
    expect(published).toContain('anyOf');
    expect(published).toContain('"panels"');
    expect(published).toContain('"repeat"');
    expect(published.length).toBeGreaterThan(3000);
  });

  it('refuses invalid text and legend slices in repeat templates at the schema layer', () => {
    for (const [type, slice] of [
      ['text', { bogus: 1 }],
      ['legend', { from: [] }],
    ] as const) {
      const result = gridDataSchema.safeParse({
        repeat: { dimension: 'd', values: ['a'] },
        template: { type, data: { bySlice: { a: slice } } },
      });
      if (result.success) throw new Error(`grid must refuse the invalid ${type} slice`);
      const issue = result.error.issues.find(
        (candidate) => candidate.path[0] === 'template' && candidate.path[3] === 'a',
      );
      expect(issue?.path.slice(0, 4), type).toEqual(['template', 'data', 'bySlice', 'a']);
    }
  });

  it('keeps a nested-grid child refusal inside the envelope instead of a cli-error', () => {
    const { code, envelope } = validate({
      version: 1,
      charts: [
        {
          name: 'outer',
          type: 'grid',
          data: { panels: [{ id: 'inner', type: 'grid', data: badTextPanel }] },
        },
      ],
    });
    expect(code).toBe(1);
    expect(envelope.ok).toBe(false);
    expect(envelope.errors.some((error) => error.code === 'cli-error')).toBe(false);
    const refusal = envelope.errors.find((error) => error.code === 'invalid-data');
    expect(refusal?.path).toBe('/charts/0/data/panels/0/data/panels/0/data');
  });
});

function someColumnData(): unknown {
  return { categories: [{ id: 'q1' }], series: [{ id: 's', values: [1] }] };
}

interface CliEnvelope {
  ok: boolean;
  errors: { code: string; message: string; path?: string; suggest?: string }[];
  warnings: { code: string; message: string }[];
}

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function validate(document: object): { code: number; envelope: CliEnvelope } {
  const directory = mkdtempSync(join(tmpdir(), 'boardplot-grid-refusal-test-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'doc.json');
  writeFileSync(path, JSON.stringify(document));
  const logs: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...values) => logs.push(values.join(' ')));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const code = main(['render', path]);
  vi.restoreAllMocks();
  return { code, envelope: JSON.parse(logs.join('\n')) as CliEnvelope };
}

// Different category arrays must never share positions just because their display text matches.
it('refuses joined-text category collisions and preserves matching category order', () => {
  const check = (ids: string[][]) => validate({ type: 'grid', data: {
    panels: ids.map((categories, index) => ({ id: `p${index}`, type: 'column',
      data: { categories, series: [{ id: 's', values: categories.map((_, i) => 10 + i) }] } })),
  }, options: { sharedAxis: 'category', sharedScale: false, size: { width: 960, height: 900 } } });
  for (const other of [['A', 'B, C'], ['C', 'A, B'], ['A, B']]) {
    expect(check([['A, B', 'C'], other]).envelope.errors).toContainEqual(expect.objectContaining({ code: 'grid-category-mismatch' }));
  }
  expect(check([['A, B', 'C'], ['A, B', 'C']]).envelope.errors).toEqual([]);
});

// Prevents a refused variance panel from throwing on frame access and losing its repair advice.
it('keeps the tiered grid child refusal structured when sharedAxis is none', () => {
  const fixture = getFixtures('grid').find(fixture => fixture.id === 'stacked-plus-dpy-tiered')!;
  const draw = (authored: boolean) => getChart('grid')!.layout(structuredClone(fixture.data), {
    ...fixture.options, sharedAxis: 'none', size: { width: 720 },
    ...(authored ? { columns: [1, 1] } : {}),
  });
  for (let run = 0; run < 3; run++) {
    const repro = draw(false);
    if (repro.refused) expect(repro.warnings[0]?.suggest).toBeTruthy();
    else expect((repro.marks as GridMarks).panels).toHaveLength(2);
  }

  // The current label solver can fit this sample. Keep the child refusal path covered too.
  const variance = getChart('variance')!;
  const original = variance.layout;
  vi.spyOn(variance, 'layout').mockImplementation((data, options) => {
    const result = original(data, options);
    return { refused: true, type: 'variance', title: 'Variance', size: result.size, sizing: result.sizing!, warnings: [{
      code: 'label-collision', severity: 'error', message: 'Category labels do not fit.', suggest: 'Shorten or move the category labels.',
    }] };
  });
  for (const authored of [false, true]) {
    const result = draw(authored);
    expect(result.refused).toBe(true);
    if (!result.refused) throw new Error('Expected the hidden-label refusal');
    expect(result.type).toBe('grid');
    expect(result.sizing.minHeight).toBeGreaterThan(0);
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'label-collision', suggest: 'Shorten or move the category labels.', field: ['data', 'panels', 1],
    }));
  }
});
