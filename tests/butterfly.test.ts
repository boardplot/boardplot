import { expect, it } from 'vitest';
import '../src/core/charts';
import { layoutButterfly } from '../src/core/charts/butterfly/layout';
import { layoutResolvedRequest, measure, resolveChartRequest } from '../src/core/request';
import { getChart } from '../src/core/registry';
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
