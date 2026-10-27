/** Table calculations must agree with the source values, and table body cells must not overlap. */

import { getFixtures } from '../src/fixtures';
import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { resolveTable, tableDataSchema } from '../src/core/charts/table';
import { layoutTable } from '../src/core/charts/table/layout';
import { columnHeaderAffix } from '../src/core/charts/table/resolve';
import { frameFillExtras } from '../src/core/charts/table/tracks';
import type { TableData } from '../src/core/types/table';
import { getChart } from '../src/core/registry';
import { requireGeometry } from '../src/core/sizing';
import { measureText } from '../src/core/text';

const steering = () =>
  (getFixtures('table').find((f) => f.id === 'steering-monthly')!).data as TableData;
const benchmark = () =>
  (getFixtures('table').find((f) => f.id === 'benchmark-competitors')!).data as TableData;

it('draws the full four-column hierarchy at all five card widths before refusing', () => {
  const fixture = getFixtures('table').find(f => f.id === 'table-level-ladder')!;
  for (const width of [960, 720, 480, 400, 320]) {
    const geometry = requireGeometry(getChart('table')!.layout(fixture.data as never, {
      ...fixture.options, size: { width, height: 476 },
    } as never));
    const cells = geometry.scene.filter(node => node.t === 'text' && node.part === 'tableCell');
    expect(cells.filter(node => node.owner.colId === 'label')).toHaveLength(10);
    expect(cells.filter(node => node.owner.colId !== 'label')).toHaveLength(27);
    // Type steps: below 720 px the cells are 12 px and the deeper level 11 px (the floor).
    expect(cells.every(node => node.t === 'text' && node.title === undefined && node.font.size >= (width >= 720 ? 12 : 11))).toBe(true);
    expect(geometry.scene.some(node => node.part === 'tableOutlineMark')).toBe(false);
  }
  expect(getChart('table')!.layout(fixture.data as never, {
    ...fixture.options, size: { width: 180, height: 476 },
  } as never).refused).toBe(true);
});

// A sub-label wider than an authored track ran into the head beside it
// ("4 weeks 4 weeks before" read as one phrase); the track takes free frame
// width first, so the sub-label prints on one line with the gap kept.
it('a sub-label keeps the column gap to the head beside it (subhead-gap)', () => {
  const fixture = getFixtures('dimswitch').find((f) => f.id === 'statement')!;
  const def = getChart('dimswitch')!;
  const geometry = requireGeometry(def.layout(def.normalize!(structuredClone(fixture.data)) as never, {
    ...def.defaults, ...(fixture.options as object), size: { width: 720 },
  } as never));
  const sub = (id: string) => geometry.scene.find((node) => node.id === `header-sub:${id}`) as Extract<typeof geometry.scene[number], { t: 'text' }>;
  const width = (node: ReturnType<typeof sub>) => Math.max(...node.lines.map((line) => measureText(line, node.font).width));
  const prior = sub('pp');
  expect(prior.lines).toEqual(['4 weeks before']);
  // Both heads are right-aligned: the gap is the distance between the two ends minus the wider text.
  expect(prior.x - width(prior) - sub('range').x).toBeGreaterThanOrEqual(16);
  // A blank sub-label fits to no lines; it divided by zero and broke every y.
  const blank = structuredClone(fixture.data) as { periods: { subLabel?: string }[] };
  blank.periods.find((p) => p.subLabel === '4 weeks before')!.subLabel = ' ';
  const blankScene = requireGeometry(def.layout(def.normalize!(blank) as never, {
    ...def.defaults, ...(fixture.options as object), size: { width: 720 },
  } as never)).scene;
  expect(blankScene.filter((node) => 'y' in node && !Number.isFinite(node.y))).toEqual([]);
});

// A wrapped sub-label made the head row taller, so a height pinned at the old
// minimum refused a table that draws with the sub-label on one line.
it('a pinned height takes the sub-labels to one line before it refuses (subhead-gap)', () => {
  const fixture = getFixtures('dimswitch').find((f) => f.id === 'statement')!;
  const def = getChart('dimswitch')!;
  const result = def.layout(def.normalize!(structuredClone(fixture.data)) as never, {
    ...def.defaults, ...(fixture.options as object), notes: { show: ['note', 'disclosure'] }, size: { width: 720, height: 870 },
  } as never);
  expect(result.refused).toBeFalsy();
  const scene = requireGeometry(result).scene;
  const sub = (id: string) => scene.find((node) => node.id === `header-sub:${id}`) as Extract<typeof scene[number], { t: 'text' }>;
  const prior = sub('pp');
  expect(prior.lines).toEqual(['4 weeks before']);
  // The pinned height takes the tighter cell padding; the gap stays two paddings.
  expect(prior.x - measureText(prior.lines[0]!, prior.font).width - sub('range').x).toBeGreaterThanOrEqual(12);
});

describe('calc states (zero-baseline must scream, not vanish)', () => {
  const data: TableData = {
    columns: [
      { id: 'label', kind: 'rowLabel' },
      { id: 'actual', kind: 'value', format: '€1.1m' },
      { id: 'plan', kind: 'value', format: '€1.1m' },
      { id: 'd', kind: 'computed', calc: { op: 'percentDelta', a: 'actual', b: 'plan' }, format: '+1.1%' },
    ],
    rows: [
      { id: 'restructuring', cells: { actual: 650_000, plan: 0 } },
      { id: 'dormant', cells: { actual: 0, plan: 0 } },
      // In millions: 110 vs 100 prints €0.0m vs €0.0m, a base that prints as 0 and so n.m..
      { id: 'normal', cells: { actual: 1_100_000, plan: 1_000_000 } },
      { id: 'tiny', cells: { actual: 110, plan: 100 } },
    ],
  };
  const r = resolveTable(data);
  const cell = (row: string, col: string) => r.table.rows.find((x) => x.id === row)!.cells[col]!;

  it("renders 'n.m.' for a real overrun vs zero plan — never 0", () => {
    expect(cell('restructuring', 'd').state).toBe('nm');
    expect(cell('restructuring', 'd').displayed).toBe('n.m.');
  });
  it("renders 'n/a' for 0/0", () => {
    expect(cell('dormant', 'd').state).toBe('na');
    expect(cell('dormant', 'd').displayed).toBe('n/a');
  });
  it('computes percentDelta in points', () => {
    expect(cell('normal', 'd').raw).toBeCloseTo(10);
    expect(cell('normal', 'd').displayed).toBe('+10.0%');
  });
  it("renders 'n.m.' with the near-zero note where the base prints as 0 ", () => {
    expect([cell('tiny', 'plan').displayed, cell('tiny', 'd').displayed]).toEqual(['0.0', 'n.m.']);
    expect(r.table.footnotes).toContain('n.m.: not meaningful, the base is near zero.');
  });
});

it('a calc that reads a change turned n.m. by its rounded-zero base is n.m. too', () => {
  const r = resolveTable({
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'm', kind: 'value', format: '1.0' }],
    rows: [
      { id: 'cur', cells: { m: 0.08 } },
      { id: 'pri', cells: { m: 0.04 } },
      { id: 'chg', relation: 'displayOnly', calc: { op: 'percentDelta', a: { row: 'cur' }, b: { row: 'pri' } } },
      { id: 'dbl', relation: 'displayOnly', calc: { op: 'mul', a: { ref: { row: 'chg' } }, b: { lit: 2 } }, format: '+1.0%' },
    ],
  } as TableData);
  const shown = (id: string) => r.table.rows.find((x) => x.id === id)!.cells.m!.displayed;
  expect([shown('chg'), shown('dbl')]).toEqual(['n.m.', 'n.m.']);
  expect(r.computedCells.find((c) => c.rowId === 'dbl')!.state).toBe('nm');
});

it('an authored row format keeps its digits on a count row', () => {
  const data = (format?: string) => ({
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'a', kind: 'value' }],
    rows: [{ id: 'orders', scale: 'count', ...(format ? { format } : {}), cells: { a: 1_500_000 } }],
  }) as TableData;
  expect(resolveTable(data('1,234')).table.rows[0]!.cells.a!.displayed).toBe('1,500,000');
  expect(resolveTable(data()).table.rows[0]!.cells.a!.displayed).toBe('1.5M');
});

it('frame fill grows the tracks in proportion, and the label takes the rest', () => {
  const tracks = [{ id: 'a', width: 80 }, { id: 'b', width: 40 }];
  expect(Object.fromEntries(frameFillExtras(tracks, 500, undefined, 'label'))).toEqual({ a: 120, b: 60, label: 320 });
});

describe('parents re-derive ratio-of-sums (gross-margin-proof)', () => {
  it('market margin is ΣGP/Σrev, never mean of margins', () => {
    const r = resolveTable(benchmark());
    const margin = r.table.rows.find((x) => x.id === 'market')!.cells.margin!;
    // Σgp/Σrev = 4.2/11.98 = 35.06% → ratio-of-sums; mean of margins ≈ 34.1%
    expect(margin.raw).toBeCloseTo((4.2 / 11.98) * 100, 1);
  });
  it('leaf shares reconcile to exactly 100.0 as displayed', () => {
    const r = resolveTable(benchmark());
    const shown = r.table.rows
      .filter((x) => x.level > 0)
      .map((x) => Number(x.cells.share!.displayed.replace('%', '')));
    expect(shown.reduce((a, b) => a + b, 0)).toBeCloseTo(100.0, 9);
  });
});

describe('hierarchy honesty', () => {
  it('ofWhich rows are excluded from the parent sum and stay neutral', () => {
    const r = resolveTable(steering());
    const group = r.table.rows.find((x) => x.id === 'group')!;
    // authored 128.4 displays (validate); derived sum excludes digital 41.3
    expect(group.cells.actual!.displayed).toBe('128.4');
    const rec = r.computedCells.find(
      (c) => c.rowId === 'group' && c.colId === 'actual' && c.kind === 'reconciliation',
    )!;
    expect(rec.raw).toBeCloseTo(128.4e6); // 61.2+24.1+30.6+12.5
    expect(rec.inputs.map((i) => i.rowId)).not.toContain('digital');
    const digitalDelta = r.table.rows.find((x) => x.id === 'digital')!.cells.dPlan!;
    expect(digitalDelta.tone).toBe('neutral'); // context, not steering line
  });

  it('validate keeps the authored total and reports a real difference', () => {
    const data = steering();
    const group = data.rows[0]!;
    group.cells = { actual: 130.0e6, plan: 121.0e6 }; // authored ≠ sum (128.4)
    const r = resolveTable(data);
    expect(r.table.rows.find((x) => x.id === 'group')!.cells.actual!.displayed).toBe('130.0');
    expect(r.warnings.some((w) => w.code === 'total-reconciliation')).toBe(true);
  });

  it('derive ignores an authored total with a lint', () => {
    const data = steering();
    data.rows[0]!.totalPolicy = 'derive';
    const r = resolveTable(data);
    expect(r.table.rows.find((x) => x.id === 'group')!.cells.actual!.displayed).toBe('128.4');
    expect(r.warnings.some((w) => w.code === 'computed-overridden')).toBe(true);
  });

  it('nulls propagate → parent n/a with lint; skip → partial sum + footnote', () => {
    const fx = getFixtures('table').find((f) => f.id === 'nulls-policy')!;
    // The partial note and its column mark print only when the author lists disclosures (notes.show).
    const r = resolveTable(fx.data as TableData, { notes: { show: ['note', 'disclosure'] } });
    const emea = r.table.rows.find((x) => x.id === 'emea')!;
    expect(emea.cells.q2!.displayed).toBe('\u2013');
    expect(r.warnings.some((w) => w.code === 'aggregate-null-child')).toBe(true);
    expect(emea.cells.q3!.displayed).toBe('19.5');
    // The note carries the mark its column's head carries.
    expect(r.table.footnotes).toContain('† Partial aggregate: missing values skipped.');
    expect(columnHeaderAffix(r.table.columns.find((column) => column.partial)!)).toMatch(/ †$/);
  });
});

describe('rounding honesty (no fabrication)', () => {
  it('no phantom rounding footnote when displayed children add up', () => {
    // Half-up decimal rounding makes the benchmark fixture's
    // gross-profit children print 1.7 + 1.1 + 0.9 + 0.3 + 0.3 = 4.3 against a
    // parent of 4.2, which IS a display gap; this case uses figures that add.
    const data: TableData = {
      columns: [
        { id: 'label', kind: 'rowLabel' },
        { id: 'v', kind: 'value', format: '0.0' },
      ],
      rows: [
        {
          id: 'p',
          children: [
            { id: 'a', cells: { v: 1.2 } },
            { id: 'b', cells: { v: 1.3 } },
          ],
        },
      ],
    };
    const r = resolveTable(data);
    expect(r.table.rows.find((x) => x.id === 'p')!.cells.v!.displayed).toBe('2.5');
    expect(r.table.footnotes).toHaveLength(0);
  });
  it('detects a real display gap and footnotes it — values unchanged', () => {
    const data: TableData = {
      columns: [
        { id: 'label', kind: 'rowLabel' },
        { id: 'v', kind: 'value', format: '1' },
      ],
      rows: [
        {
          id: 'p',
          children: [
            { id: 'a', cells: { v: 1.4 } },
            { id: 'b', cells: { v: 1.4 } },
          ],
        },
      ],
    };
    const r = resolveTable(data);
    // children display 1 + 1; parent 2.8 displays 3 — the honest footnote
    expect(r.table.rows.find((x) => x.id === 'p')!.cells.v!.displayed).toBe('3');
    expect(r.table.rows.find((x) => x.id === 'a')!.cells.v!.displayed).toBe('1');
    expect(r.table.footnotes).toContain('Figures may not add due to rounding.');
  });
});

describe('validation errors teach the vocabulary', () => {
  it('rejects duplicate row ids globally', () => {
    expect(() =>
      resolveTable({
        columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value' }],
        rows: [
          { id: 'p1', children: [{ id: 'x', cells: { v: 1 } }] },
          { id: 'p2', children: [{ id: 'x', cells: { v: 2 } }] },
        ],
      }),
    ).toThrow(/duplicate-row-id|globally unique/);
  });
  it('rejects non-contiguous column groups', () => {
    expect(() =>
      resolveTable({
        columnGroups: [{ id: 'g', label: 'G', columns: ['a', 'c'] }],
        columns: [
          { id: 'label', kind: 'rowLabel' },
          { id: 'a', kind: 'value' },
          { id: 'b', kind: 'value' },
          { id: 'c', kind: 'value' },
        ],
        rows: [{ id: 'r', cells: { a: 1, b: 2, c: 3 } }],
      }),
    ).toThrow(/contiguous/);
  });
  it('rejects calcs referencing computed columns (v1)', () => {
    expect(() =>
      resolveTable({
        columns: [
          { id: 'label', kind: 'rowLabel' },
          { id: 'a', kind: 'value' },
          { id: 'c1', kind: 'computed', calc: { op: 'delta', a: 'a', b: 'a' } },
          { id: 'c2', kind: 'computed', calc: { op: 'delta', a: 'c1', b: 'a' } },
        ],
        rows: [{ id: 'r', cells: { a: 1 } }],
      }),
    ).toThrow(/value columns only/);
  });
  it('rejects unknown status values naming the closed set', () => {
    expect(() =>
      resolveTable({
        columns: [
          { id: 'label', kind: 'rowLabel' },
          { id: 's', kind: 'status' },
        ],
        rows: [{ id: 'r', cells: { s: 'red' } }],
      }),
    ).toThrow(/on-track/);
  });
  it('lints percent columns that look like fractions', () => {
    const r = resolveTable({
      columns: [
        { id: 'label', kind: 'rowLabel' },
        { id: 'pct', kind: 'value', format: '1.1%' },
      ],
      rows: [
        { id: 'a', cells: { pct: 0.062 } },
        { id: 'b', cells: { pct: 0.041 } },
      ],
    });
    expect(r.warnings.some((w) => w.code === 'percent-scale-suspect')).toBe(true);
  });
});

describe('materiality is display-only', () => {
  it('de-emphasizes below threshold; value and record stay', () => {
    const data = steering();
    const group = data.rows[0]!;
    group.children!.find((c) => c.id === 'de')!.cells!.plan = 61.0e6; // Δ = +0.33%
    const r = resolveTable(data);
    const de = r.table.rows.find((x) => x.id === 'de')!.cells.dPlan!;
    expect(de.deEmphasized).toBe(true);
    expect(de.displayed).not.toBe('—'); // NEVER suppressed
    expect(r.computedCells.some((c) => c.rowId === 'de' && c.colId === 'dPlan')).toBe(true);
  });
});

describe('layout: and determinism', () => {
  it('every cell text node sits inside its column band and row band', () => {
    for (const fx of getFixtures('table')) {
      const geo = layoutTable(fx.data as TableData, fx.options as never);
      const colBand = new Map(geo.marks.columns.map((c) => [c.id, c]));
      const rowBand = new Map(geo.marks.rows.map((r) => [r.id, r]));
      for (const node of geo.scene) {
        if (node.t !== 'text' || node.part !== 'tableCell') continue;
        const col = colBand.get(node.owner.colId!)!;
        const row = rowBand.get(node.owner.rowId!)!;
        expect(node.x, `${fx.id}/${node.id} x in column band`).toBeGreaterThanOrEqual(col.x - 0.5);
        expect(node.x, `${fx.id}/${node.id} x in column band`).toBeLessThanOrEqual(col.x + col.w + 0.5);
        expect(node.y, `${fx.id}/${node.id} y in row band`).toBeGreaterThanOrEqual(row.y);
        expect(node.y + node.font.size * 1.2, `${fx.id}/${node.id} bottom in row band`).toBeLessThanOrEqual(
          row.y + row.h + 0.5,
        );
      }
    }
  });
  it('resolve + layout are byte-deterministic', () => {
    const fx = getFixtures('table').find((f) => f.id === 'steering-monthly')!;
    const a = layoutTable(fx.data as TableData, fx.options as never);
    const b = layoutTable(fx.data as TableData, fx.options as never);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it('missing text cells render blank; missing numerics render the missing glyph', () => {
    const r = resolveTable(steering());
    const group = r.table.rows.find((x) => x.id === 'group')!;
    expect(group.cells.readout!.displayed).toBe('');
    expect(group.cells.status!.displayed).toBe('\u2013');
  });
});

describe('schema accepts both row forms', () => {
  it('flat parentId form parses and matches nested semantics', () => {
    const flat: unknown = {
      columns: [
        { id: 'label', kind: 'rowLabel' },
        { id: 'v', kind: 'value' },
      ],
      rows: [
        { id: 'p', role: 'total' },
        { id: 'a', parentId: 'p', cells: { v: 2 } },
        { id: 'b', parentId: 'p', cells: { v: 3 } },
      ],
    };
    const parsed = tableDataSchema.parse(flat);
    const r = resolveTable(parsed);
    expect(r.table.rows.find((x) => x.id === 'p')!.cells.v!.raw).toBe(5);
  });
});

describe('design system invariants', () => {
  const geos = getFixtures('table').map((fx) => ({
    id: fx.id,
    options: (fx.options ?? {}) as { figures?: boolean },
    geo: layoutTable(fx.data as TableData, fx.options as never),
  }));
  it('the table grid lives on integer pixels; hairlines sit on crisp half-pixel y, the 2 px section rule on whole pixels', () => {
    for (const { id, geo } of geos) {
      for (const c of geo.marks.columns) {
        expect(c.x % 1, `${id}: column ${c.id} x integer`).toBe(0);
        expect(c.w % 1, `${id}: column ${c.id} w integer`).toBe(0);
      }
      for (const r of geo.marks.rows) expect(r.y % 1, `${id}: row ${r.id} y integer`).toBe(0);
      for (const node of geo.scene) {
        // A group divider is a VERTICAL rule — it is crisp on x, and its y runs the table height.
        // So is the right end, which takes the head rule's part where no group divides.
        if (node.t !== 'line' || !node.part.startsWith('table') || node.part === 'tableGroupRule' || node.part === 'tableGroupDivider' || node.x1 === node.x2) continue;
        // A 2 px rule fills whole pixels from an integer centre; a hairline from a half-pixel one.
        expect(Math.abs((node.y1 % 1) - (node.width === 2 ? 0 : 0.5)), `${id}: ${node.id} crisp`).toBeLessThan(1e-9);
      }
    }
  });
  // Body rules are 1 px (the rule token, `table.ruleWidths.row` in every preset); a result and a final rule keep
  // the hairline, and so do the row rules of a heat-only matrix; a section heading closes on the heavy rule
  // (`table.section.rule`). The head width is a theme key, tested in table-statement.
  it('every rule in the body is 1 px, a result, final or heat-only row rule a hairline, the section rule 2 px or 1 px', () => {
    for (const { id, geo, options } of geos) {
      for (const node of geo.scene) {
        if (node.t !== 'line' || !node.part.startsWith('table') || node.id === 'rule:header') continue;
        const hair = node.part === 'tableResultRule' || node.part === 'tableFinalRule' || (node.part === 'tableRowRule' && options.figures === false);
        const widths = node.part === 'tableSectionRule' ? [2, 1] : hair ? [0.75] : [1];
        expect(widths, `${id}: ${node.id} weight`).toContain(node.width);
      }
    }
  });
  it('at-risk chips carry the warn tone, pending stays neutral', () => {
    const fx = getFixtures('table').find((f) => f.id === 'receipts-changelog')!;
    const r = resolveTable(fx.data as TableData, fx.options as never);
    expect(r.table.rows.find((x) => x.id === 'c4')!.cells.status!.tone).toBe('warn');
    expect(r.table.rows.find((x) => x.id === 'c3')!.cells.status!.tone).toBe('neutral');
  });
  it('status chips share their column center axis with the header', () => {
    const { geo } = geos.find((g) => g.id === 'receipts-changelog')!;
    const col = geo.marks.columns.find((c) => c.id === 'status')!;
    const center = col.x + col.w / 2;
    for (const node of geo.scene) {
      if (node.t === 'rect' && node.part === 'tableChip') {
        const chipCenter = node.rect.x + node.rect.w / 2;
        expect(Math.abs(chipCenter - center), `chip ${node.id} on column axis`).toBeLessThanOrEqual(1);
      }
    }
  });
  it('empty-state glyphs never render bold', () => {
    const { geo } = geos.find((g) => g.id === 'steering-monthly')!;
    const dash = geo.scene.find(
      (n) => n.t === 'text' && n.id === 'cell:group:status',
    ) as Extract<import('../src/core/types/scene').SceneNode, { t: 'text' }>;
    expect(dash.font.weight).toBe(400);
    // The tertiary ink, which resolves to inkMuted on a theme without it.
    expect(dash.ink).toEqual({ token: 'inkMuted', theme: { kind: 'table-ink', role: 'secondary' } });
  });
});

describe('scorecard rows: entity, value, state chip and a wrapping note', () => {
  const longNote =
    'Two of three retailers are live and the third signs in week 40, which releases the remaining budget for the fourth quarter push';
  const scorecard = (wrap: boolean): TableData => ({
    columns: [
      { id: 'label', kind: 'rowLabel', label: 'Initiative' },
      { id: 'impact', kind: 'value', label: 'Impact', format: '€1.1m' },
      { id: 'state', kind: 'status', label: 'State' },
      { id: 'note', kind: 'text', label: 'Where it stands', ...(wrap ? { wrap: true } : {}) },
    ],
    rows: [
      { id: 'a', label: 'Retail media pilot', cells: { impact: 4.2e6, state: 'on-track', note: longNote } },
      { id: 'b', label: 'Supply reliability', cells: { impact: 2.4e6, state: 'done', note: 'Second source qualified' } },
    ],
  });

  it('a long note without wrap sets the table width floor; with wrap it does not', () => {
    const without = layoutTable(scorecard(false), { title: 'T' }).sizing!.minWidth!;
    const withWrap = layoutTable(scorecard(true), { title: 'T' }).sizing!.minWidth!;
    expect(without).toBeGreaterThan(800);
    expect(without).toBeGreaterThan(withWrap);
    expect(withWrap).toBeLessThan(800);
  });

  it('the note falls to two whole lines at the narrower width, with nothing cut', () => {
    const geo = layoutTable(scorecard(true), { title: 'T', size: { width: 720, height: 300 } });
    const note = geo.scene.find((n) => n.t === 'text' && n.id === 'cell:a:note') as Extract<
      import('../src/core/types/scene').SceneNode,
      { t: 'text' }
    >;
    expect(note.lines).toHaveLength(2);
    expect(note.lines.join(' ')).toBe(longNote);
  });

  it('the registered fixture renders the four states without an ellipsis', () => {
    const fx = getFixtures('table').find((f) => f.id === 'table-scorecard')!;
    const geo = layoutTable(fx.data as TableData, fx.options as never);
    const states = geo.scene
      .filter((n) => n.t === 'text' && n.id.startsWith('cell:') && n.id.endsWith(':state'))
      .map((n) => (n as Extract<import('../src/core/types/scene').SceneNode, { t: 'text' }>).lines.join(''));
    expect(states).toEqual(['on-track', 'at-risk', 'off-track', 'done']);
    expect(geo.scene.some((n) => n.t === 'text' && n.lines.some((l) => l.includes('…')))).toBe(false);
  });
});

it('prints the author\'s table notes as notes, without a number', () => {
  const fixture = getFixtures('table').find(f => f.id === 'steering-executive-report')!;
  const authored = fixture.options!.footnotes as string[];
  const geometry = requireGeometry(getChart('table')!.layout(fixture.data as never, { ...fixture.options, size: { width: 720 } } as never));
  for (const text of authored) {
    expect(geometry.frame.noteList?.find(note => note.text === text)).toMatchObject({ kind: 'note', inFrame: true });
    expect(geometry.frame.noteList?.find(note => note.text === text)?.ref).toBeUndefined();
  }
});

// A cell printed as the bound "<0.001" resolved as zero and took the zero styling, though it shows a nonzero amount.
it('does not resolve a cell printed as a bound as zero', () => {
  const r = resolveTable({ columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value' }], rows: [{ id: 'a', cells: { v: 0.042 } }, { id: 'b', cells: { v: 0.00031 } }, { id: 'c', cells: { v: 0 } }] });
  const cell = (row: string) => r.table.rows.find((x) => x.id === row)!.cells.v!;
  expect([cell('b').displayed, cell('b').zero, cell('c').zero]).toEqual(['<0.001', undefined, true]);
});
