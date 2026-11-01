import { expect, it } from 'vitest';
import '../src/core/charts';
import { layoutButterfly } from '../src/core/charts/butterfly/layout';
import { layoutResolvedRequest, measure, resolveChartRequest } from '../src/core/request';
import { getChart } from '../src/core/registry';
import { measureText } from '../src/core/text';
import { beginSpecParse } from '../src/react/specValidation';
// @ts-expect-error The scorecard script has no declaration file.
import { applyRepair } from '../scripts/layout-scorecard.mjs';

// Turning off butterfly values must not add a key that repeats the pane headers or increase the chart height.
it('keeps pane names without a duplicate key when value labels are off', () => {
  const data = {
    categories: [{ id: 'north', label: 'North' }, { id: 'south', label: 'South' }, { id: 'west', label: 'West' }],
    series: [
      { id: 'basic', label: 'Basic', values: [90, 65, 40] },
      { id: 'plus', label: 'Plus', values: [85, 70, 45] },
    ],
  };
  const options = { a: 'basic', b: 'plus' };
  const baseline = layoutButterfly(data, options);
  for (const labels of [false, { point: false }] as const) {
    const hidden = layoutButterfly(data, { ...options, labels });
    expect(hidden.legend).toBeUndefined();
    expect(hidden.size).toEqual(baseline.size);
    expect(hidden.plot).toEqual(baseline.plot);
    expect(hidden.labels.filter(label => label.kind === 'series' && !label.hidden).map(label => label.text))
      .toEqual(['Basic', 'Plus']);
  }
  const explicit = layoutButterfly(data, { ...options, labels: false, legend: 'top' });
  expect(explicit.legend?.items.map(item => item.id)).toEqual(['basic', 'plus']);
  const noHeaders = layoutButterfly(data, { ...options, labels: { point: false, series: false } });
  expect(noHeaders.legend?.items.map(item => item.id)).toEqual(['basic', 'plus']);
  const panelOptions = { ...options, labels: false as const, typeClass: 'M' };
  const panel = layoutButterfly(data, panelOptions);
  expect(panel.legend?.items.map(item => item.id)).toEqual(['basic', 'plus']);
});

// An all-zero pane must not flatten the nonzero pane or make a both-zero chart non-finite.
it('fits a shared butterfly scale from the panes with a nonzero extent', () => {
  const draw = (a: number[], b: number[], sharedScale = true) => layoutButterfly({
    categories: [{ id: 'x' }, { id: 'y' }], series: [{ id: 'a', values: a }, { id: 'b', values: b }],
  }, { a: 'a', b: 'b', sharedScale, size: { width: 960, height: 540 } });
  for (const [a, b, side] of [[[0, 0], [10, 20], 'right'], [[10, 20], [0, 0], 'left']] as const) {
    const g = draw([...a], [...b]);
    const widths = g.marks[side].map((m) => m.rect.w);
    expect(widths[0]).toBeGreaterThan(20);
    expect(widths[1]! / widths[0]!).toBeCloseTo(2);
    expect(widths).toEqual(draw([...a], [...b], false).marks[side].map((m) => m.rect.w));
  }
  const empty = draw([0, 0], [0, 0]);
  expect([...empty.marks.left, ...empty.marks.right].every((m) => Object.values(m.rect).every(Number.isFinite))).toBe(true);
});

// Prevents either unit-conflict fix from leaving the other unit conflict in place.
it('repairs the shared scale and the difference sort together', () => {
  const request = { type: 'butterfly', data: {
    categories: ['North', 'South'], series: [
      { id: 'a', label: 'People', unit: 'FTE', values: [12, 18] },
      { id: 'b', label: 'Revenue', unit: 'EUR', values: [120, 90] },
    ],
  }, options: { a: 'a', b: 'b', sortBy: 'diff', size: { width: 720 } } };
  for (const result of [measure(request).refused!, getChart('butterfly')!.layout(request.data, request.options)]) {
    const warnings = result.warnings.filter(w => w.code === 'unit-conflict');
    expect(warnings).toHaveLength(2);
    for (const warning of warnings) {
      const repaired = measure(applyRepair(request, warning.fix));
      expect(repaired.geometry).toBeDefined();
      expect(repaired.warnings.filter(w => w.severity !== 'info')).toEqual([]);
    }
  }
});

// A bracket's room was taken from both panes and kept even when its label went to the note list,
// so bars stood as 20 px stubs in a 576 px chart that was mostly blank.
it('gives bar length back to the panes when a comparison bracket takes room on one side only', () => {
  const data = {
    categories: [{ id: 'fy21', label: 'FY21' }, { id: 'fy22', label: 'FY22' }, { id: 'fy23', label: 'FY23' }],
    series: [{ id: 'online', label: 'Online', values: [100, 120, 144] }, { id: 'store', label: 'Store', values: [130, 150, 180] }],
  };
  const longest = (g: ReturnType<typeof layoutButterfly>) => Math.max(...[...g.marks.left, ...g.marks.right].map((m) => m.rect.w));
  const gap = { id: 'gap', kind: 'diff' as const, mode: 'absolute' as const,
    from: { categoryId: 'fy21', seriesId: 'online' }, to: { categoryId: 'fy21', seriesId: 'store' } };
  const base = { a: 'online', b: 'store', size: { width: 576, height: 528 } };
  const bracket = layoutButterfly(data, { ...base, annotations: [gap] });
  // The bracket is drawn, the panes differ in width, and the shared scale keeps both sides in proportion.
  expect(bracket.annotations).toHaveLength(1);
  expect(bracket.marks.center.x - bracket.plot.x).toBeLessThan(bracket.plot.x + bracket.plot.w - bracket.marks.center.x - bracket.marks.center.w);
  expect(longest(bracket)).toBeGreaterThan(100);
  expect(bracket.marks.left[2]!.rect.w / bracket.marks.right[2]!.rect.w).toBeCloseTo(144 / 180, 5);
  // A pyramid whose comparison label cannot stand beside the bars sends it to the note list and keeps no room for it.
  const bands = [{ id: 'young', from: 0, to: 20, label: '0 to 19' }, { id: 'adult', from: 20, to: 40, label: '20 to 39' }, { id: 'older', from: 40, to: 60, label: '40 to 59' }];
  const groups = [{ id: 'before', label: 'FY21', date: '2021-12-31', values: [100, 120, 80] }, { id: 'after', label: 'FY23', date: '2023-12-31', values: [144, 150, 100] }];
  const pyramid = layoutResolvedRequest(resolveChartRequest({ type: 'pyramid', data: { bands, groups },
    options: { size: { width: 576, height: 528 }, target: 'slide', basis: 'shareOfTotal',
      annotations: [{ id: 'gap', kind: 'diff', mode: 'absolute', from: { categoryId: 'adult', seriesId: 'before' }, to: { categoryId: 'adult', seriesId: 'after' },
        text: 'FY21 to FY23, both snapshots combined: ${value}' }] } } as never)) as unknown as ReturnType<typeof layoutButterfly>;
  expect(pyramid.labels.filter((l) => l.kind === 'annotation' && !l.hidden)).toHaveLength(0);
  expect(longest(pyramid)).toBeGreaterThan(100);
});

// A negative bar pointed the same way as a positive one and a blank value drew nothing, so a reader
// took -2,398 for the biggest gain and a missing value for zero.
it('draws negatives toward the names, a not-applicable mark for blanks and an axis per own scale', () => {
  const data = {
    categories: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }, { id: 'z', label: 'Z' }],
    series: [{ id: 'a', values: [-30, 20, null] }, { id: 'b', values: [10, -5, 8] }],
  };
  const options = { a: 'a', b: 'b', size: { width: 960, height: 540 } };
  const g = layoutButterfly(data, options);
  const [left, right] = [g.marks.left, g.marks.right];
  // Pane A: the negative bar starts at its zero line and runs toward the names, the positive one ends there.
  expect(left[1]!.rect.x + left[1]!.rect.w).toBeCloseTo(left[0]!.rect.x, 3);
  expect(left[0]!.rect.x + left[0]!.rect.w).toBeLessThan(g.marks.center.x);
  // Pane B mirrors it, on the one shared scale.
  expect(right[1]!.rect.x + right[1]!.rect.w).toBeCloseTo(right[0]!.rect.x, 3);
  expect(right[0]!.rect.w / left[0]!.rect.w).toBeCloseTo(10 / 30);
  expect(g.labels.filter((l) => !l.hidden && l.text === 'n/a').map((l) => l.id)).toEqual(['na:a:z']);
  expect(g.warnings.map((w) => w.code)).not.toContain('butterfly-negative');
  // The old look stays behind `negatives: 'magnitude'`.
  const old = layoutButterfly(data, { ...options, negatives: 'magnitude' });
  expect(old.marks.left.every((m) => Math.abs(m.rect.x + m.rect.w - old.marks.center.x) < 1e-6)).toBe(true);
  expect(old.warnings.map((w) => w.code)).toContain('butterfly-negative');
  // Own scales draw a value axis under each pane; a shared scale draws none.
  expect(layoutButterfly(data, { ...options, sharedScale: false }).axes.filter((axis) => axis.axis === 'x')).toHaveLength(2);
  expect(g.axes.filter((axis) => axis.axis === 'x')).toHaveLength(0);
});

const drawOwnScales = (values: number[], options: object = {}) => layoutButterfly(
  { categories: values.map((_, i) => ({ id: `c${i}`, label: `Item ${i + 1}` })), series: [{ id: 'a', values }, { id: 'b', values }] },
  { a: 'a', b: 'b', sharedScale: false, size: { width: 720, height: 400 }, ...options });
const axisTicks = (g: ReturnType<typeof layoutButterfly>) => g.scene.flatMap((n) =>
  n.t === 'text' && n.id.startsWith('axis:x:tick:') ? [{ id: n.id, text: n.lines[0]!, x: n.x, w: measureText(n.lines[0]!, n.font).width }] : []);

// A pane on its own scale printed its 0.5 ticks over whole values as 0, 1, 1, 2, 2.
it('prints value-axis ticks at the precision of their spacing', () => {
  const whole = axisTicks(drawOwnScales([1, 2])).filter((t) => t.id.endsWith(':a')).map((t) => t.text);
  expect(new Set(whole).size).toBe(whole.length);
  expect(whole).toContain('0.5');
});

// The end label of the left pane, which runs right to left, was anchored on the wrong side and cut at the canvas edge.
it('keeps every value-axis tick label of both panes on the canvas', () => {
  const big = axisTicks(drawOwnScales([1e7, 2e7], { format: '1,234', labels: { point: false } }));
  expect(big.some((t) => t.text === '20,000,000')).toBe(true);
  for (const t of big) {
    expect(t.x).toBeGreaterThanOrEqual(0);
    expect(t.x + t.w).toBeLessThanOrEqual(720 + 1e-6);
  }
});

// The documented labels.tick switch for the value axes of own scales was refused as an unknown option.
it('accepts labels: { tick: false } on a butterfly and then draws no value axes', () => {
  const request = { type: 'butterfly', data: { categories: [{ id: 'x' }, { id: 'y' }], series: [{ id: 'a', values: [1, 2] }, { id: 'b', values: [1, 2] }] },
    options: { a: 'a', b: 'b', sharedScale: false, labels: { tick: false } } } as never;
  expect(() => beginSpecParse(request).finish()).not.toThrow();
  expect(measure(request).geometry!.axes.filter((axis) => axis.axis === 'x')).toHaveLength(0);
});

// Sorting dated rows by value scrambled the periods, so a growth bracket from the first to the last period ran backwards.
it('keeps dated rows in sheet order under a growth annotation and warns when sortBy is set', () => {
  const data = {
    categories: [
      { id: 'y1', label: 'Y1', date: '2021-12-31' },
      { id: 'y2', label: 'Y2', date: '2022-12-31' },
      { id: 'y3', label: 'Y3', date: '2023-12-31' },
    ],
    series: [{ id: 'a', values: [100, 120, 144] }, { id: 'b', values: [130, 150, 180] }],
  };
  const growth = { kind: 'cagr' as const, from: { categoryId: 'y1', seriesId: 'a' }, to: { categoryId: 'y3', seriesId: 'a' } };
  const rowIds = (g: ReturnType<typeof layoutButterfly>) => g.labels.filter((l) => l.kind === 'category' && !l.hidden).sort((x, y) => x.rect.y - y.rect.y).map((l) => l.text);
  const sorted = layoutButterfly(data, { a: 'a', b: 'b', sortBy: 'diff', annotations: [growth] });
  expect(rowIds(sorted)).toEqual(['Y1', 'Y2', 'Y3']);
  expect(sorted.warnings.map((w) => w.code)).toContain('butterfly-sort-ignored');
  // Without an annotation that spans periods the sort is what the author asked for.
  const plain = layoutButterfly(data, { a: 'a', b: 'b', sortBy: 'diff' });
  expect(rowIds(plain)).toEqual(['Y3', 'Y1', 'Y2']);
  expect(plain.warnings.map((w) => w.code)).not.toContain('butterfly-sort-ignored');
});
