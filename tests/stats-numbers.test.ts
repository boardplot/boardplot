/**
 * Arithmetic edge cases for the statistics chart families (likert, pareto,
 * strategy matrix, pyramid, anomaly, tornado, bump).
 */

import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { layoutLikert, type LikertData } from '../src/core/charts/likert/layout';
import { layoutPareto, type ParetoData } from '../src/core/charts/pareto/layout';
import { layoutScatter, type ScatterDerived } from '../src/core/charts/scatter/layout';
import { layoutPyramid } from '../src/core/charts/pyramid/layout';
import { chartNotes } from '../src/core/notes';
import type { PyramidData, PyramidDerived, PyramidOptions } from '../src/core/charts/pyramid/types';
import { layoutColumn } from '../src/core/charts/column/layout';
import type { AnomalyColumnOptions } from '../src/core/charts/column/types';
import { layoutBar } from '../src/core/charts/bar/layout';
import { layoutLine } from '../src/core/charts/line/layout';
import type { ParetoOptions, LineOptions, ScatterOptions } from '../src/core/types/options';
import type { ChartData, ScatterData } from '../src/core/types/data';
import { lineOptionsSchema } from '../src/core/charts/line/schema';
import { claimsForChart } from '../src/core/claims';

/** Run `fn`, return the refusal it throws (code, path, message). */
function throwsWith(fn: () => unknown): { code: string; path: string; message: string } {
  try {
    fn();
  } catch (e) {
    const { code = '', path = '', message } = e as { code?: string; path?: string; message: string };
    return { code, path, message };
  }
  throw new Error('expected a throw, got none');
}

const codes = (g: { warnings: { code: string }[] }) => g.warnings.map((w) => w.code);

const sceneText = (g: { scene: unknown[] }): string =>
  (g.scene as { t: string; lines?: string[] }[])
    .filter((n) => n.t === 'text')
    .flatMap((n) => n.lines ?? [])
    .join(' ');

// Prevents a time-series fit from treating uneven dates or missing periods as equal adjacent observations.
it('fits each line in its axis units, skips nulls and keeps the fitted range', () => {
  const data: ChartData = {
    categories: ['2026-01-01', '2026-01-02', '2026-01-09', '2026-01-12'].map(date => ({ id: date, date })),
    series: [
      { id: 'up', label: 'Up', values: [10, 12, null, 32] },
      { id: 'down', label: 'Down', values: [30, 29, 22, 19] },
      { id: 'short', values: [null, 1, null, 3] },
      { id: 'ref', role: 'reference', values: [5, 5, 5, 5] },
    ],
  };
  const options = lineOptionsSchema.parse({ trend: { label: 'Fit' }, size: { width: 960, height: 540 } });
  const dated = layoutLine(data, options);
  expect(dated.derived.trends).toEqual([
    expect.objectContaining({ id: 'up', slope: 2, intercept: 10, r2: 1, n: 3, x0: 0, x1: 11, unit: 'day' }),
    expect.objectContaining({ id: 'down', slope: -1, intercept: 30, r2: 1, n: 4, x0: 0, x1: 11, unit: 'day' }),
  ]);
  expect(dated.warnings).toContainEqual(expect.objectContaining({ code: 'trend-undefined', owner: { seriesId: 'short' } }));
  const points = dated.marks.series.find(s => s.seriesId === 'up')!.points;
  expect((points[1]!.x - points[0]!.x) / (points[2]!.x - points[0]!.x)).toBeCloseTo(1 / 11, 4);
  const line = dated.scene.find(n => n.id === 'trend:up');
  expect(line).toMatchObject({ t: 'line', x1: points[0]!.x, y1: points[0]!.y, x2: points[2]!.x, y2: points[2]!.y });
  expect(sceneText(dated)).toContain('+2.0 per day');
  expect(claimsForChart('line', dated).filter(c => c.op === 'ols-slope@2').map(c => c.output.raw)).toEqual([2, -1]);
  const categorical = { categories: ['p1', 'p2', 'p3', 'p4'].map(id => ({ id })), series: [{ id: 'up', values: [10, 12, null, 16] }] };
  expect(layoutLine(categorical, options).derived.trends?.[0]).toMatchObject({ slope: 2, n: 3, unit: 'period' });
  expect(layoutLine(categorical, { ...options, trend: false }).derived.trends).toBeUndefined();
  expect(layoutLine({ ...categorical, series: [{ id: 'flat', values: [7, 7, 7, 7] }] }, options).derived.trends?.[0]).toMatchObject({ slope: 0, r2: null });
  expect(layoutLine(data, { ...options, variant: 'area' }).derived.trends?.[0]?.slope).toBe(2);
  expect(() => layoutLine(data, { ...options, variant: 'stacked-area' })).toThrow(/trend needs/);
});

// Prevents a min-max sample of a long line from biasing the printed slope towards its spikes, and from changing it with the chart width.
it('fits a sampled line on every shown source value', () => {
  const dates = Array.from({ length: 20_000 }, (_, i) => new Date(Date.UTC(1970, 0, 1 + i)).toISOString().slice(0, 10));
  const values = dates.map((_, i) => 100 + 0.01 * i + (i % 97 === 0 ? 200 : 0) + (i > 15_000 && i % 23 === 0 ? -150 : 0));
  const slopeOf = (from: number) => {
    const ys = values.slice(from), n = ys.length, mx = (n - 1) / 2, my = ys.reduce((a, b) => a + b, 0) / n;
    return ys.reduce((a, y, i) => a + (i - mx) * (y - my), 0) / ys.reduce((a, _, i) => a + (i - mx) ** 2, 0);
  };
  const data: ChartData = { categories: dates.map(id => ({ id, date: id })), series: [{ id: 'a', values }] };
  const fit = (options: object) => layoutLine(data, lineOptionsSchema.parse({ trend: true, ...options })).derived.trends![0]!;
  for (const width of [320, 960]) expect(fit({ size: { width, height: 400 } })).toMatchObject({ n: 20_000, slope: expect.closeTo(slopeOf(0), 12) });
  expect(fit({ window: { decimate: 'minmax', maxPoints: 400 } })).toMatchObject({ n: 20_000, slope: expect.closeTo(slopeOf(0), 12) });
  expect(fit({ window: { last: 5000, decimate: 'minmax', maxPoints: 400 } })).toMatchObject({ n: 5000, slope: expect.closeTo(slopeOf(15_000), 12) });
});

// Prevents a sampled window from spacing its points in another calendar unit than the fit, which draws the trend off its points.
it('draws a sampled trend through points that lie on it', () => {
  const dates = ['2026-01-01', '2026-01-02', '2026-02-01', '2026-03-01', '2026-03-02', '2026-04-01'];
  const out = layoutLine({ categories: dates.map(id => ({ id, date: id })), series: [{ id: 'a', values: [0, 1, 31, 59, 60, 90] }] },
    lineOptionsSchema.parse({ trend: true, window: { decimate: 'minmax', maxPoints: 4 }, size: { width: 960, height: 540 } }));
  const line = out.scene.find(n => n.id === 'trend:a') as { x1: number; y1: number; x2: number; y2: number };
  const points = out.marks.series[0]!.points;
  expect(out.derived.trends![0]).toMatchObject({ unit: 'day', r2: 1 });
  for (const p of points) expect(line.y1 + (p.x - line.x1) / (line.x2 - line.x1) * (line.y2 - line.y1)).toBeCloseTo(p.y, 1);
});

// Prevents switching the trend on from moving regular monthly points, which reads as a change in the data.
it('keeps monthly spacing when the trend turns on and draws the fit through it', () => {
  const months = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}-01`);
  const data: ChartData = { categories: months.map(id => ({ id, date: id })), series: [{ id: 'a', values: [10, 12, 11, 15, 14, 18, 17, 20, 22, 21, 25, 24] }] };
  const draw = (trend: boolean) => layoutLine(data, lineOptionsSchema.parse({ trend, size: { width: 960, height: 540 } }));
  const xs = (out: ReturnType<typeof draw>) => out.marks.series[0]!.points.map(p => p.x);
  const on = draw(true);
  expect(xs(on)).toEqual(xs(draw(false)));
  const fit = on.derived.trends![0]!;
  const line = on.scene.find(n => n.id === 'trend:a') as { x1: number; x2: number };
  expect([line.x1, line.x2]).toEqual([xs(on)[0], xs(on)[11]]);
  expect(fit).toMatchObject({ x0: 0, x1: 11, unit: 'month' });
});

// Prevents a monthly or quarterly chart from printing a daily rate that readers must convert with an assumed month length.
it('prints the trend rate in the reporting period', () => {
  const unitOf = (dates: string[]) => {
    const out = layoutLine({ categories: dates.map(id => ({ id, date: id })), series: [{ id: 'a', values: dates.map((_, i) => 10 + 2 * i) }] },
      lineOptionsSchema.parse({ trend: true, size: { width: 960, height: 540 } }));
    return [out.derived.trends![0]!.slope, sceneText(out).match(/per \w+/)![0]];
  };
  expect(unitOf(['2025-01-01', '2025-02-01', '2025-03-01', '2025-05-01'])).toEqual([expect.closeTo(13 / 8.75, 12), 'per month']);
  expect(unitOf(['2024-03-31', '2024-06-30', '2024-09-30', '2024-12-31'])).toEqual([2, 'per quarter']);
  expect(unitOf(['2021-01-01', '2022-01-01', '2023-01-01'])).toEqual([2, 'per year']);
  expect(unitOf(['2026-01-05', '2026-01-12', '2026-01-19'])).toEqual([2, 'per week']);
  expect(unitOf(['2026-01-01', '2026-01-02', '2026-01-04'])[1]).toBe('per day');
});

// Prevents trend keys from losing the value unit or calling year-labelled observations generic periods.
it('prints trend rates with their value units and calendar periods', () => {
  const categories = ['2021', '2022', '2023F'].map((label, i) => ({ id: `p${i}`, label }));
  const cases = [
    { options: { unit: '$m' }, series: {}, expected: '+$2.0m per year' },
    { options: {}, series: { unit: 'kg' }, expected: '+2.0 kg per year' },
    { options: { unit: '$m', format: '1.0' }, series: {}, expected: '+$2.0m per year' },
    { options: { unit: '$', format: '$1.0' }, series: {}, expected: '+$2.0 per year' },
    { options: { unit: '%', format: '1.0%' }, series: {}, expected: '+2.0pp per year' },
    { options: { unit: '€m', locale: { language: 'de' } }, series: {}, expected: '+2,0m\u00a0€ pro Jahr' },
  ];
  for (const variant of ['line', 'area'] as const) for (const c of cases) {
    const out = layoutLine({ categories, series: [{ id: 'a', label: 'Output', values: [10, 12, 14], ...c.series }] },
      lineOptionsSchema.parse({ trend: true, variant, size: { width: 960, height: 540 }, ...c.options }));
    expect(sceneText(out)).toContain(c.expected);
    expect(out.a11y.desc).toContain(c.expected);
  }
  const skipped = layoutLine({ categories: ['FY2020', 'FY2022', 'FY2025F'].map(id => ({ id })), series: [{ id: 'a', values: [10, 14, 20] }] },
    lineOptionsSchema.parse({ trend: true, unit: '$m', size: { width: 960, height: 540 } }));
  expect(skipped.derived.trends![0]).toMatchObject({ slope: expect.closeTo(2, 12), unit: 'year' });
  expect(sceneText(skipped)).toContain('+$2.0m per year');
  const scatter = layoutScatter({ points: [{ id: 'a', x: 1, y: 10 }, { id: 'b', x: 2, y: 12 }, { id: 'c', x: 3, y: 14 }] },
    { trend: true, unit: 'kg', size: { width: 960, height: 540 } });
  expect(sceneText(scatter)).toContain('2.0 kg');
});

describe('likert', () => {
  const FIVE = [
    { id: 'sd', label: 'Strongly disagree' }, { id: 'd', label: 'Disagree' },
    { id: 'n', label: 'Neutral', role: 'neutral' as const },
    { id: 'a', label: 'Agree' }, { id: 'sa', label: 'Strongly agree' },
  ];
  const one = (values: number[], id = 'q1'): LikertData => ({ scale: FIVE, items: [{ id, label: `Statement ${id}`, values }] });

  // Prevents wrong shares: a count divided by a base that is not the sum of the declared options.
  it('divides each count by the sum of the DECLARED options', () => {
    const derived = layoutLikert(one([10, 20, 30, 25, 15]), { values: 'counts' }).derived;
    const counts = [10, 20, 30, 25, 15];
    const base = counts.reduce((a, b) => a + b, 0);
    expect(derived.base.q1).toBe(base);
    for (const [index, option] of FIVE.entries()) {
      expect(derived.shares.q1![option.id]).toBeCloseTo((counts[index]! / base) * 100, 10);
    }
    expect(derived.pctNegative.q1).toBeCloseTo(((10 + 20) / base) * 100, 10);
    expect(derived.pctNeutral.q1).toBeCloseTo((30 / base) * 100, 10);
    expect(derived.pctPositive.q1).toBeCloseTo(((25 + 15) / base) * 100, 10);
    expect(derived.net.q1).toBeCloseTo(((25 + 15 - 10 - 20) / base) * 100, 10);
    expect(derived.bottomBox.q1).toBeCloseTo((10 / base) * 100, 10);
    expect(derived.topBox.q1).toBeCloseTo((15 / base) * 100, 10);
  });

  // Prevents a printed net that disagrees with the shares it is built from.
  it('prints a net that recomputes from the derived shares', () => {
    const multi: LikertData = {
      scale: FIVE,
      items: [
        { id: 'first', values: [10, 10, 20, 30, 30] }, // net +40
        { id: 'tied-a', values: [20, 20, 20, 20, 20] }, // net 0
        { id: 'tied-b', values: [25, 15, 20, 25, 15] }, // net 0
        { id: 'last', values: [30, 30, 20, 10, 10] }, // net −40
      ],
    };
    const geometry = layoutLikert(multi, { values: 'counts', sortBy: 'net', summary: 'net' });
    const derived = geometry.derived;
    const head = geometry.labels.find((l) => l.id === 'likert:netHead')!;
    expect(head.text).toBe('Net, pp');
    for (const itemId of derived.order) {
      const label = geometry.labels.find((l) => l.id === `grandTotal:${itemId}`);
      expect(label!.rect.x + label!.rect.w).toBeCloseTo(head.rect.x + head.rect.w, 6);
      expect(label, itemId).toBeDefined();
      expect(label!.text, itemId).not.toMatch(/ pp$/);
      const printed = Number(label!.text.replace('−', '-').replace('+', ''));
      expect(printed, itemId).toBe(Math.round(derived.net[itemId]!));
    }
  });
});

describe('pareto', () => {
  const lay = (data: ParetoData, options: ParetoOptions = {}) =>
    layoutPareto(data, { size: { width: 960, height: 540 }, ...options });
  const items = (values: number[], ids?: string[]): ParetoData => ({
    items: values.map((value, i) => ({ id: ids?.[i] ?? `i${i}`, label: `Item ${i}`, value })),
  });

  // Prevents a wrong bar order: ties reshuffled instead of keeping input order.
  it('sorts descending and breaks ties by input order', () => {
    const g = lay(items([10, 50, 30, 50, 30], ['a', 'b', 'c', 'd', 'e']));
    expect(g.derived.order).toEqual(['b', 'd', 'c', 'e', 'a']);
    expect(g.derived.reordered).toBe(true);
  });

  // Prevents a single item drawn with a cumulative share other than 100%.
  it('names a single item as 100% of itself', () => {
    const g = lay(items([7]));
    expect(g.warnings.map((w) => `${w.severity}:${w.code}`)).toContain('info:pareto-single-item');
    expect(g.derived.cumulativeShare.i0).toBe(100);
  });

  // Prevents a curve drawn from negative values, a zero total (0/0 shares) or no items.
  it('refuses a negative value, a total of zero and an empty item list', () => {
    const negative = throwsWith(() => lay(items([10, -1])));
    expect(negative.code).toBe('pareto-negative-value');
    expect(negative.path).toBe('items[1].value');
    expect(throwsWith(() => lay(items([0, 0, 0]))).code).toBe('pareto-zero-total');
    expect(throwsWith(() => lay({ items: [] })).code).toBe('empty-data');
  });

  // Prevents two remainder columns (folded tail beside the authored rest), and a hidden rest that still sets the axis.
  it('folds the tail into the authored rest, and topN.rest: false hides that one column', () => {
    const data: ParetoData = { items: [...items([40, 25, 12, 6, 4, 3]).items, { id: 'o', label: 'Other', value: 30, rest: true }] };
    const shown = lay(data, { topN: { n: 3, rest: true } });
    expect(shown.derived.order).toEqual(['i0', 'i1', 'i2', 'o']);
    expect(shown.derived.values.o).toBe(43);
    const hidden = lay(data, { topN: { n: 3, rest: false } });
    expect(hidden.derived.cumulativeShare.o).toBe(100);
    expect(hidden.marks.columns.filter((column) => column.segments.length > 0).map((column) => column.categoryId)).toEqual(['i0', 'i1', 'i2']);
  });
});

describe('strategy matrix', () => {
  const lay = (data: ScatterData, options: ScatterOptions) => layoutScatter(data, options);
  const derivedOf = (data: ScatterData, options: ScatterOptions) =>
    (lay(data, options).derived as ScatterDerived).quadrants;
  /** n points at (v, v) so one list drives both axes. */
  const diag = (values: number[]): ScatterData => ({
    points: values.map((v, i) => ({ id: `p${i}`, x: v, y: v })),
  });

  // Prevents a wrong cut point for odd n: any value other than the middle order statistic.
  it('median, odd n: the middle order statistic of the sorted values', () => {
    const derived = derivedOf(diag([8, 1, 9, 2, 4]), { quadrants: { x: { stat: 'median' }, y: { stat: 'median' } } });
    expect(derived?.x).toBe(4);
    expect(derived?.y).toBe(4);
    expect(derived?.xSource).toBe('median');
  });

  // Prevents a wrong cut point for even n: an interpolated quartile instead of the mean of the two middle values.
  it('median, even n: the arithmetic mean of the two central order statistics', () => {
    const derived = derivedOf(diag([8, 1, 30, 9, 2, 4]), { quadrants: { x: { stat: 'median' }, y: { stat: 'median' } } });
    expect(derived?.x).toBe(6);
  });

  // Prevents a chart where every point sits in one box being passed off as a 2x2.
  it('reports a degenerate all-in-one-box result instead of passing it off as a 2x2', () => {
    const warning = lay(diag([1, 2, 3, 4]), { quadrants: { x: 0, y: 0 } }).warnings.find(
      (w) => w.code === 'quadrant-degenerate',
    );
    expect(warning?.severity).toBe('info');
    expect(warning?.message).toContain('top-right');
  });
});

describe('pyramid', () => {
  type Marks = { left: { id: string; rect: { x: number; y: number; w: number; h: number } }[] };
  /** n contiguous equal-width bands starting at 0, ascending. */
  const bands = (n: number, width = 5): PyramidData['bands'] =>
    Array.from({ length: n }, (_, i) => ({ id: `b${i}`, from: i * width, to: (i + 1) * width }));
  const doc = (bandList: PyramidData['bands'], a: (number | null)[], b: (number | null)[]): PyramidData => ({
    bands: bandList,
    groups: [{ id: 'm', label: 'Men', values: a }, { id: 'f', label: 'Women', values: b }],
  });
  const run = (data: PyramidData, options: PyramidOptions = {}) => {
    const geo = layoutPyramid(data, options);
    return { geo, derived: geo.derived as PyramidDerived, marks: geo.marks as unknown as Marks };
  };
  const FIVE = bands(4);
  const A = [10, 20, 30, 40];
  const B = [12, 22, 28, 38];

  // Prevents a pyramid with methodNote: true from dropping the method note the author asked for.
  it('prints the band method note in the frame under methodNote: true', () => {
    const printed = (options: PyramidOptions) => chartNotes(layoutPyramid(doc(FIVE, A, B), { size: { width: 800, height: 520 }, ...options }))
      .filter((note) => note.inFrame && note.text.includes('Bands read')).length;
    expect(printed({ methodNote: true })).toBe(1);
    expect(printed({})).toBe(0);
  });

  // Prevents a band with no people vanishing from the axis instead of showing as a labelled zero.
  it('keeps an all-zero band visible as a labelled zero and says so at info', () => {
    const { geo, marks } = run(doc(FIVE, [10, 0, 30, 40], [12, 0, 28, 38]));
    const lint = geo.warnings.find((w) => w.code === 'pyramid-empty-band')!;
    expect(lint.severity).toBe('info');
    expect(lint.message).toContain("'b1'");
    const row = marks.left.find((r) => r.id === 'b1')!;
    expect(row.rect.h).toBeGreaterThan(0);
    expect(row.rect.w).toBeGreaterThan(0);
    expect(sceneText(geo)).toContain('5–10');
    expect(sceneText(geo)).toContain('0');
  });

  // Prevents shares computed as 0/0 (NaN) when the grand total is zero.
  it("refuses shareOfTotal when the grand total is 0", () => {
    const e = throwsWith(() => layoutPyramid(doc(FIVE, [0, 0, 0, 0], [0, 0, 0, 0]), { basis: 'shareOfTotal' }));
    expect(e.code).toBe('pyramid-zero-total');
    expect(e.message).toContain('0/0');
    const counted = run(doc(FIVE, [0, 0, 0, 0], [0, 0, 0, 0]));
    expect(counted.derived.grandTotal).toBe(0);
    expect(counted.derived.shares).toBeUndefined();
  });

  // Prevents each side being scaled to its own 100% instead of sharing one grand total.
  it('derives shareOfTotal over BOTH groups — neither side sums to 100', () => {
    const { derived } = run(doc(FIVE, A, B), { basis: 'shareOfTotal' });
    const grandTotal = [...A, ...B].reduce((s, v) => s + (v as number), 0);
    expect(derived.grandTotal).toBe(grandTotal);
    expect(derived.basis).toBe('shareOfTotal');

    const sumOf = (group: string) =>
      derived.order.reduce((s, bandId) => s + derived.shares![bandId]![group]!, 0);
    const expectedM = (A.reduce((s, v) => s + (v as number), 0) / grandTotal) * 100;
    const expectedF = (B.reduce((s, v) => s + (v as number), 0) / grandTotal) * 100;
    expect(sumOf('m')).toBeCloseTo(expectedM, 9);
    expect(sumOf('f')).toBeCloseTo(expectedF, 9);
    expect(sumOf('m')).not.toBeCloseTo(100, 6);
    expect(sumOf('f')).not.toBeCloseTo(100, 6);
    expect(sumOf('m') + sumOf('f')).toBeCloseTo(100, 9);
  });
});

describe('anomaly', () => {
  // Prevents a silent fallback to mean ± sigma (and flags from it) when the MAD is 0.
  it('warns and renders on MAD = 0 without substituting mean ± sigma', () => {
    const values = [...Array.from({ length: 7 }, () => 5), 6, 7, 9, 11, 40];
    const data = {
      categories: values.map((_, index) => ({ id: `p${index + 1}`, label: `P${index + 1}` })),
      series: [{ id: 'delta', label: 'Delta vs plan', values }],
    } as unknown as ChartData;
    const geometry = layoutColumn(data, { anomaly: { method: 'mad' } } as AnomalyColumnOptions) as any;
    const anomaly = geometry.derived.anomaly!;
    expect(codes(geometry)).toContain('anomaly-mad-zero');
    expect(anomaly.usable).toBe(false);
    expect(anomaly.scale).toBeNull();
    expect(anomaly.corridor).toBeNull();
    expect(anomaly.flags).toEqual([]);
    expect(geometry.scene.some((node: any) => node.part === 'anomalyCorridor')).toBe(false);
    expect(geometry.scene.some((node: any) => node.part === 'anomalyFlag')).toBe(false);
    expect(sceneText(geometry)).toContain('MAD is 0');
  });
});

describe('tornado', () => {
  const rows = (spec: { id: string; low: number | null; high: number | null }[]): ChartData =>
    ({
      categories: spec.map((row) => ({ id: row.id, label: row.id })),
      series: [
        { id: 'lo', label: 'Low input', values: spec.map((row) => row.low) },
        { id: 'hi', label: 'High input', values: spec.map((row) => row.high) },
      ],
    }) as unknown as ChartData;
  const OK = { variant: 'tornado', baseValue: 100, tornado: { low: 'lo', high: 'hi' } };
  const lay = (data: ChartData, options: Record<string, unknown>) => layoutBar(data, options as never) as any;

  // Prevents a driver with no swing disappearing, or its case output printed twice.
  it('paints a zero-swing driver as a hairline and calls it a finding, not an error', () => {
    const geometry = lay(
      rows([
        { id: 'flat', low: 88, high: 88 },
        { id: 'live', low: 60, high: 140 },
      ]),
      OK,
    );
    const warning = geometry.warnings.find((w: any) => w.code === 'tornado-zero-swing')!;
    expect(warning.severity).toBe('info');
    expect(warning.owner?.categoryId).toBe('flat');
    const pieces = geometry.scene.filter(
      (node: any) => node.part === 'tornadoPiece' && node.owner.categoryId === 'flat',
    );
    expect(pieces).toHaveLength(1);
    expect(pieces[0].rect.w).toBe(0.5);
    const labels = geometry.labels.filter((label: any) => label.id.includes('flat'));
    expect(labels.filter((label: any) => label.id.startsWith('tornadoCase:'))).toHaveLength(1);
    expect(geometry.derived.tornado!.rows.find((row: any) => row.id === 'flat')!.swing).toBe(0);
  });
});

describe('bump', () => {
  const bump = (data: ChartData, options: Partial<LineOptions> = {}) =>
    layoutLine(data as never, { variant: 'bump', ...options } as LineOptions);
  /** Four entities, one three-way spread and one dead heat. */
  const TIE_DATA: ChartData = {
    categories: ['t1', 't2'],
    series: [
      { id: 'a', label: 'A', values: [40, 40] },
      { id: 'b', label: 'B', values: [30, 30] },
      { id: 'c', label: 'C', values: [30, 20] },
      { id: 'd', label: 'D', values: [10, 10] },
    ],
  } as unknown as ChartData;

  // Prevents dense ranks (1,2,2,3) where a tie must skip the next rank (1,2,2,4).
  it('ranks by standard competition ("1224") and skips the rank a tie consumes', () => {
    const derived = bump(TIE_DATA).derived.bump!;
    expect(derived.method).toBe('competition');
    expect(derived.direction).toBe('higherIsBetter');
    expect(derived.ranks).toEqual({ a: [1, 1], b: [2, 2], c: [2, 3], d: [4, 4] });
    expect(derived.maxRank).toBe(4);
    expect(derived.ties).toEqual([{ categoryId: 't1', rank: 2, seriesIds: ['b', 'c'] }]);
    expect(derived.participants).toEqual({ t1: 4, t2: 4 });
  });
});

// Prevents keyed interval inputs from rounding endpoints and reporting false swing ties.
it('prints the same range and tornado values for keyed and positional cells', () => {
  for (const variant of ['football-field', 'tornado'] as const) for (const format of [undefined, '88.0']) {
    const categories = ['a', 'b'];
    const values = variant === 'football-field'
      ? [[{ number: 2.45, range: { low: 1.25, high: 3.75, mid: 2.45 } }, { number: 4.65, range: { low: 3.45, high: 5.85, mid: 4.65 } }]]
      : [[1.25, 2.45], [3.75, 5.85]];
    const data = (keyed: boolean) => ({ categories, series: values.map((cells, i) => ({ id: `s${i}`,
      values: keyed ? cells.map((value, j) => ({ categoryId: categories[j], value })).reverse() : cells,
    })) }) as unknown as ChartData;
    const options = { variant, size: { width: 960 }, ...(format ? { format } : {}),
      ...(variant === 'tornado' ? { baseValue: 3.125, tornado: { low: 's0', high: 's1' } } : { currentValue: 3.125, methodNote: true }),
    };
    const positional = layoutBar(data(false), options as never);
    const keyed = layoutBar(data(true), options as never);
    expect(keyed.labels).toEqual(positional.labels);
    expect(keyed.axes).toEqual(positional.axes);
    expect(keyed.scene.filter(node => node.display)).toEqual(positional.scene.filter(node => node.display));
    expect(keyed.derived).toEqual(positional.derived);
    expect(keyed.warnings).toEqual(positional.warnings);
    if (format) expect(keyed.labels.some(label => label.text === '1.3')).toBe(true);
    else expect(keyed.labels.some(label => label.text === '1.25')).toBe(true);
  }
});
