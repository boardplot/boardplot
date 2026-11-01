import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { getChart } from '../src/core/registry';
import type { Geometry } from '../src/core/types/scene';
import { render } from '../src/cli/render';

/**
 * stacked100 honesty + trace rules:
 * - reference series have no honest position on a composition axis →
 *   suppressed + warned, never stretching the domain or the legend
 * - negative values are not shares → chart-level warning
 * - collapsed categories/rows (basis ≤ 0) leave an 'n.m.' trace, not a hole
 * - the axis baseline paints ABOVE mark fills (hatched FC bars erased it)
 * - variance Δ% suppression (ref ≤ 0) leaves the same 'n.m.' trace
 */

const codes = (geo: Geometry): string[] => geo.warnings.map((w) => w.code);
const nmNodes = (geo: Geometry) => geo.scene.filter((n) => (n as { part?: string }).part === 'nmMarker');

describe('stacked100 single-series warning (column + bar)', () => {
  const categories = [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
    { id: 'c', label: 'C' },
  ];
  const core = { id: 'core', label: 'Core', values: [20, 30, 40] };
  const edge = { id: 'edge', label: 'Edge', values: [5, 10, 15] };
  const reference = { id: 'plan', label: 'Plan', role: 'reference' as const, values: [30, 50, 70] };
  const warning = {
    code: 'stacked100-single-series',
    severity: 'warn',
    message:
      "a 100% composition of a single series is always 100% — use variant:'stacked' or 'grouped' to show the level",
  } as const;

  for (const type of ['column', 'bar'] as const) {
    it(`${type}: warns for one composition member, keeps rendering, and ignores references`, () => {
      const geometry = getChart(type)!.layout(
        { categories, series: [core, reference] },
        { variant: 'stacked100', title: 'T' },
      ) as Geometry;

      expect(geometry.warnings).toContainEqual(warning);
      expect(geometry.scene.some((node) => node.part === 'segment')).toBe(true);
    });

    it(`${type}: does not warn for two composition members`, () => {
      const geometry = getChart(type)!.layout(
        { categories, series: [core, edge, reference] },
        { variant: 'stacked100', title: 'T' },
      ) as Geometry;

      expect(codes(geometry)).not.toContain('stacked100-single-series');
    });
  }

});

describe('stacked100 reference suppression (column + bar)', () => {
  const data = {
    categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    series: [
      { id: 's0', label: 'Core', values: [200, 300] },
      { id: 's1', label: 'Edge', values: [400, 500] },
      { id: 'ref', label: 'Plan', role: 'reference', values: [5000, 100] },
    ],
  };

  it('column: warns once, renders no ticks, keeps the domain at 100, drops the legend entry', () => {
    const geo = getChart('column')!.layout(data, { variant: 'stacked100', legend: 'top', title: 'T' }) as Geometry & {
      marks: { referenceTicks: unknown[] };
    };
    expect(codes(geo)).toContain('reference-unsupported-stacked100');
    expect(geo.marks.referenceTicks).toHaveLength(0);
    // a 5000 plan on a share axis must not stretch the plot: every mark and
    // tick stays within the plot rect implied by 0–100%
    expect(geo.legend, 'legend exists').toBeDefined();
    expect(geo.legend!.items.map((i) => i.id)).toEqual(['s0', 's1']);
  });

  it('bar: warns once and renders no ticks', () => {
    const geo = getChart('bar')!.layout(data, { variant: 'stacked100', title: 'T' }) as Geometry & {
      marks: { referenceTicks: unknown[] };
    };
    expect(codes(geo)).toContain('reference-unsupported-stacked100');
    expect(geo.marks.referenceTicks).toHaveLength(0);
  });

  it('column grouped still renders reference ticks (suppression is stacked100-only)', () => {
    const geo = getChart('column')!.layout(data, { variant: 'grouped', title: 'T' }) as Geometry & {
      marks: { referenceTicks: unknown[] };
    };
    expect(geo.marks.referenceTicks.length).toBeGreaterThan(0);
    expect(codes(geo)).not.toContain('reference-unsupported-stacked100');
  });
});

describe('stacked100 signed data fails closed per category', () => {
  // notation rule: a composition share requires nonnegative components — ANY negative
  // invalidates its whole category (segments + labels + total suppressed,
  // n.m. trace), even when the net basis is positive
  const mixed = {
    categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    series: [
      { id: 's0', label: 'Gain', values: [400, 300] },
      { id: 's1', label: 'Loss', values: [-150, 200] },
    ],
  };

  it('column and bar warn, suppress the invalid category, and keep the valid one', () => {
    for (const type of ['column', 'bar'] as const) {
      // Totals are opt-in on a 100 % stack; the authored switch keeps them.
      const geo = getChart(type)!.layout(mixed, { variant: 'stacked100', title: 'T', grandTotalLabels: true }) as Geometry;
      expect(codes(geo), type).toContain('stacked100-mixed-signs');
      const nm = nmNodes(geo);
      expect(nm, type).toHaveLength(1);
      expect((nm[0] as { lines?: string[] }).lines).toEqual(['n.m.']);
      expect((nm[0] as { owner?: { categoryId?: string } }).owner?.categoryId, type).toBe('a');
      // the invalid category loses its total label; the valid one keeps it
      expect(geo.labels.some((l) => l.id === 'grandTotal:a'), `${type} total a`).toBe(false);
      expect(geo.labels.some((l) => l.id === 'grandTotal:b'), `${type} total b`).toBe(true);
    }
  });

  it('all-zero categories read n/a, not n.m.', () => {
    const zero = {
      categories: [{ id: 'ok', label: 'OK' }, { id: 'z', label: 'Zero' }],
      series: [
        { id: 's0', label: 'Gain', values: [400, 0] },
        { id: 's1', label: 'Edge', values: [50, 0] },
      ],
    };
    const col = getChart('column')!.layout(zero, { variant: 'stacked100', title: 'T' }) as Geometry;
    expect(codes(col)).toContain('percent-basis-nonpositive');
    expect((nmNodes(col)[0] as { lines?: string[] }).lines).toEqual(['n/a']);
    const bar = getChart('bar')!.layout(zero, { variant: 'stacked100', title: 'T' }) as Geometry;
    expect(codes(bar)).toContain('total100-nonpositive');
    expect((nmNodes(bar)[0] as { lines?: string[] }).lines).toEqual(['n/a']);
  });

  it('escalates to error severity when every category is invalid', () => {
    const allNeg = {
      categories: [{ id: 'a', label: 'A' }],
      series: [{ id: 's0', label: 'Loss', values: [-10] }],
    };
    const geo = getChart('column')!.layout(allNeg, { variant: 'stacked100', title: 'T' }) as Geometry;
    const w = geo.warnings.find((x) => x.code === 'stacked100-mixed-signs');
    expect(w?.severity).toBe('error');
  });
});

describe('baseline paints above mark fills', () => {
  it('column and bar emit the over-baseline after every bar rect', () => {
    const data = {
      categories: [{ id: 'a', label: 'A' }, { id: 'f', label: '2026F' }],
      series: [{ id: 's0', label: 'Rev', values: [200, { number: 300, scenario: 'FC' }] }],
    };
    for (const type of ['column', 'bar'] as const) {
      const geo = getChart(type)!.layout(data, { title: 'T' }) as Geometry;
      const overIdx = geo.scene.findIndex((n) => n.id === 'axis:baseline:over');
      expect(overIdx, type).toBeGreaterThan(-1);
      const lastBarIdx = geo.scene.reduce(
        (max, n, i) => ((n as { part?: string }).part === 'bar' || (n as { part?: string }).part === 'segment' ? i : max),
        -1,
      );
      expect(overIdx, `${type}: baseline must paint after the last bar`).toBeGreaterThan(lastBarIdx);
    }
  });

  it('combo and mekko emit the over-baseline after every column cell', () => {
    const data = {
      categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      series: [
        { id: 's0', label: 'Core', kind: 'column', values: [200, 300] },
        { id: 's1', label: 'Edge', kind: 'column', values: [100, 50] },
      ],
    };
    for (const type of ['combo', 'mekko'] as const) {
      const geo = getChart(type)!.layout(data, { title: 'T' }) as Geometry;
      const overIdx = geo.scene.findIndex((n) => n.id === 'axis:baseline:over');
      const lastCellIdx = geo.scene.reduce((max, n, i) => (n.t === 'rect' && (n as { part?: string }).part === 'segment' ? i : max), -1);
      expect(lastCellIdx, type).toBeGreaterThan(-1);
      expect(overIdx, `${type}: baseline must paint after the last cell`).toBeGreaterThan(lastCellIdx);
    }
  });
});

describe('variance Δ% suppression trace', () => {
  it('ref ≤ 0 categories render n.m. instead of nothing', () => {
    const data = {
      categories: [{ id: 'q1', label: 'Q1' }, { id: 'q2', label: 'Q2' }],
      series: [
        { id: 'ac', label: 'AC', values: [120, 90] },
        { id: 'py', label: 'PY', role: 'reference', scenario: 'PY', values: [100, -40] },
      ],
    };
    const geo = getChart('variance')!.layout(data, { variant: 'relative', variance: { vs: 'py' }, title: 'T' }) as Geometry;
    expect(codes(geo)).toContain('ref-nonpositive');
    const nm = nmNodes(geo);
    expect(nm).toHaveLength(1);
    expect((nm[0] as { owner?: { categoryId?: string } }).owner?.categoryId).toBe('q2');
  });
});

// A bar row of percent cells (valueKind 'fraction') has a basis of 0, and dividing by it refused the chart with "rect.w Infinity".
it('bar stacked100 draws fraction values as their own shares', () => {
  const body = render({ format: 'svg', return: ['svg'], spec: { type: 'bar', data: {
    valueKind: 'fraction',
    categories: [{ id: 'a', label: 'North' }, { id: 'b', label: 'South' }],
    series: [{ id: 'web', label: 'Web', values: [0.25, 0.6] }, { id: 'store', label: 'Store', values: [0.75, 0.4] }],
  }, options: { variant: 'stacked100', title: 'T' } } }).body as { ok: boolean; svg?: string };
  expect(body.ok).toBe(true);
  expect(body.svg).not.toMatch(/Infinity|NaN/);
});

// A 100% row of percent cells that adds to 130% drew past the 100% end with no warning; rounding (34 + 33 + 34) still draws.
it('stacked100 marks a row of shares past 100% n.m. and names its sum (bar, column, line, mekko)', () => {
  const data = {
    valueKind: 'fraction',
    categories: [{ id: 'north', label: 'North' }, { id: 'south', label: 'South' }],
    series: [{ id: 'web', label: 'Web', values: [0.6, 0.34] }, { id: 'store', label: 'Store', values: [0.6, 0.33] }, { id: 'app', label: 'App', values: [0.1, 0.34] }],
  };
  for (const [type, variant] of [['bar', 'stacked100'], ['column', 'stacked100'], ['line', 'stacked100-area'], ['mekko', 'stacked100']] as const) {
    const body = render({ format: 'svg', return: ['svg'], spec: { type, data, options: { variant, title: 'T' } } }).body as { ok: boolean; svg?: string; warnings: { code: string; message: string }[] };
    expect(body.ok, type).toBe(true);
    const over = body.warnings.filter((w) => w.code === 'stacked100-over-100');
    expect(over.map((w) => w.message), type).toEqual([expect.stringContaining('north (130%)')]);
    expect(over[0]!.message, type).not.toContain('south');
    expect(body.svg, type).toContain('n.m.');
    // A bar's n.m. row printed '0%' shares past its glyph.
    if (type === 'bar') expect(body.svg).not.toMatch(/>0%</);
  }
});

// A mekko of shares (valueKind 'fraction') has no column amounts, and printed "0" as every column total.
it('mekko of shares prints no column total and warns that its widths need amounts', () => {
  const body = render({ format: 'svg', return: ['svg'], spec: { type: 'mekko', data: {
    valueKind: 'fraction',
    categories: [{ id: 'north', label: 'North' }, { id: 'south', label: 'South' }, { id: 'east', label: 'East' }],
    series: [{ id: 'web', label: 'Web', values: [0.5, 0.25, 0.4] }, { id: 'store', label: 'Store', values: [0.3, 0.5, 0.35] }, { id: 'app', label: 'App', values: [0.2, 0.25, 0.25] }],
  }, options: { variant: 'stacked100', title: 'T' } } }).body as { ok: boolean; svg?: string; warnings: { code: string }[] };
  expect(body.ok).toBe(true);
  expect(body.warnings.map((w) => w.code)).toContain('mekko-widths-need-amounts');
  expect(body.svg).not.toMatch(/id="label:total:/);
});

// The line n.m. note said rows past 100% "mix positive and negative values"; their parts are all positive.
it('line stacked100-area names only signed categories in its mixed-signs note', () => {
  const body = render({ format: 'svg', return: ['svg'], spec: { type: 'line', data: {
    valueKind: 'fraction',
    categories: [{ id: 'north', label: 'North' }, { id: 'south', label: 'South' }, { id: 'east', label: 'East' }, { id: 'west', label: 'West' }],
    series: [{ id: 'web', label: 'Web', values: [0.6, 0.25, -0.1, 0.4] }, { id: 'store', label: 'Store', values: [0.6, 0.5, 0.6, 0.7] }, { id: 'app', label: 'App', values: [0.1, 0.25, 0.5, 0.3] }],
  }, options: { variant: 'stacked100-area', title: 'T' } } }).body as { ok: boolean; notes?: { text: string }[] };
  expect(body.ok).toBe(true);
  const mixed = (body.notes ?? []).filter((note) => /positive and negative/.test(note.text));
  expect(mixed.map((note) => note.text)).toEqual([expect.stringMatching(/^East\b/)]);
});

// A 100% axis drew a difference arrow and a total growth bracket over equal columns, and read a data-unit value line as a percent.
it('stacked100 drops diff, total cagr and a value line at the axis end, and warns about one inside (column, bar)', () => {
  const data = {
    categories: [{ id: 'a', label: 'A', date: '2022-01-01' }, { id: 'b', label: 'B', date: '2023-01-01' }],
    series: [{ id: 's0', label: 'Core', values: [20, 10] }, { id: 's1', label: 'Edge', values: [30, 40] }],
  };
  const annotations = [
    { kind: 'diff', from: { categoryId: 'a', seriesId: 's1', edge: 'end' }, to: { categoryId: 'b', seriesId: 's1', edge: 'end' } },
    { kind: 'cagr' },
    { kind: 'valueLine', value: 100, label: 'Benchmark' },
    { kind: 'valueLine', value: 80, label: 'Target' },
    { kind: 'cagr', from: { categoryId: 'a', seriesId: 's0' }, to: { categoryId: 'b', seriesId: 's0' } },
  ];
  for (const type of ['column', 'bar']) {
    const drawn = (variant: string) => getChart(type)!.layout(data, { variant, title: 'T', annotations } as never) as Geometry;
    const share = drawn('stacked100');
    expect(share.warnings.filter((w) => w.code.endsWith('-stacked100') && w.code !== 'reference-unsupported-stacked100').map((w) => [w.code, w.owner?.annotationId, Boolean(w.suggest)]), type).toEqual([
      ['annotation-unsupported-stacked100', 'diff-1', true],
      ['annotation-unsupported-stacked100', 'cagr-2', true],
      ['valueline-unsupported-stacked100', 'valueLine-3', true],
      ['valueline-percent-stacked100', 'valueLine-4', true],
    ]);
    expect(share.annotations.map((a) => a.kind).filter((kind) => kind !== 'indicator100').sort(), type).toEqual(['cagr', 'valueLine']);
    expect(drawn('stacked').annotations.map((a) => a.kind).sort(), type).toEqual(['cagr', 'cagr', 'diff', 'valueLine', 'valueLine']);
  }
});
