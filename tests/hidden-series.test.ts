import { expect, it } from 'vitest';
import '../src/core/charts';
import { interactionRecords } from '../src/core/a11y/records';
import { HIDDEN_SERIES } from '../src/core/hiddenSeriesKey';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { requireGeometry } from '../src/core/sizing';
import { getFixtures } from '../src/fixtures';
import type { Geometry } from '../src/core/types/scene';

// A React chart hides a series with a registered symbol on its options; the layout reads it as a mounted chart passes it.
function laidOut(type: string, data: unknown, options: object, hidden: string[] = []) {
  const request = resolveChartRequest({ type, data, options: hidden.length ? { ...options, [HIDDEN_SERIES]: hidden } : options } as never);
  return { request, geometry: requireGeometry(layoutResolvedRequest(request)) as Geometry };
}

const markFills = (geometry: Geometry) => Object.fromEntries(geometry.scene.flatMap((node) =>
  node.id.startsWith('mark:') && 'fill' in node ? [[node.id, JSON.stringify(node.fill)]] : []));
const valueTicks = (geometry: Geometry) => geometry.axes.find((axis) => axis.axis === 'y')!.ticks.map((tick) => Number(tick.at));
const labelTexts = (geometry: Geometry) => geometry.scene.flatMap((node) => node.t === 'text' ? [node.lines.join(' ')] : []);

// Hiding the series at the subtotal line would recolour the series beyond it, as the paints lost the boundary.
it('keeps the colour of every visible series of a stack with a subtotal line', () => {
  const fixture = getFixtures('bar').find((entry) => entry.id === 'stacked-net-line-horizontal')!;
  const all = markFills(laidOut('bar', fixture.data, fixture.options as object).geometry);
  const hidden = markFills(laidOut('bar', fixture.data, fixture.options as object, ['growth']).geometry);
  expect(Object.keys(hidden).some((id) => id.includes('growth'))).toBe(false);
  expect(Object.keys(hidden).length).toBeGreaterThan(0);
  for (const [id, fill] of Object.entries(hidden)) expect(fill, id).toBe(all[id]);
});

// A descending chart would show its smallest visible bar first, and the card would name a wrong rank.
it('sorts the categories by what is visible', () => {
  const data = { categories: ['A', 'B'], series: [{ id: 'north', values: [100, 5] }, { id: 'south', values: [1, 30] }] };
  const options = { sort: { categories: 'desc' }, size: { width: 600, height: 400 } };
  const bar = laidOut('bar', data, options, ['north']);
  const record = interactionRecords({ request: bar.request, geometry: bar.geometry, scope: bar.request.scope, claims: [] })
    .find((entry) => entry.target.owner.categoryId === 'B' && entry.target.owner.seriesId === 'south')!;
  expect(record.rank).toMatchObject({ value: 1, of: 2 });
  expect((bar.geometry.derived as { order: string[] }).order).toEqual(['B', 'A']);
  const column = laidOut('column', data, options, ['north']).geometry;
  expect(column.axes.find((axis) => axis.axis === 'x')!.ticks.map((tick) => String(tick.at))).toEqual(['B', 'A']);
});

// Shares would lose their decimal, and an axis that the author pinned at 0 would jump from 1,000 to 30.
it('keeps the share precision and an authored axis bound while a series is hidden', () => {
  const shares = { categories: ['A', 'B'], series: [{ id: 'big', values: [60, 50] }, { id: 'mid', values: [39.6, 49.6] }, { id: 'tiny', values: [0.4, 0.4] }] };
  const size = { width: 600, height: 400 };
  for (const type of ['column', 'bar']) {
    const texts = labelTexts(laidOut(type, shares, { variant: 'stacked100', size }, ['tiny']).geometry).filter((text) => text.endsWith('%'));
    expect(texts, type).toContain('60.2%');
  }
  // Rounding 'sum-consistent' on bars printed 60% and 40% after the tiny series was hidden.
  expect(labelTexts(laidOut('bar', shares, { variant: 'stacked100', rounding: 'sum-consistent', size }, ['tiny']).geometry)).toContain('60.2%');
  const levels = { categories: ['A', 'B'], series: [{ id: 'large', values: [900, 1000] }, { id: 'small', values: [20, 30] }] };
  expect(Math.max(...valueTicks(laidOut('column', levels, { valueAxis: { min: 0, show: true }, size }, ['large']).geometry))).toBeGreaterThanOrEqual(1000);
  expect(Math.max(...valueTicks(laidOut('column', levels, { valueAxis: { show: true }, size }, ['large']).geometry))).toBeLessThan(100);
  const bar = laidOut('bar', levels, { valueAxis: { min: 0, show: true }, size }, ['large']).geometry;
  expect(Math.max(...bar.axes.find((axis) => axis.axis === 'x')!.ticks.map((tick) => Number(tick.at)))).toBeGreaterThanOrEqual(1000);
});

// A hidden subtotal series dropped the column's net line with a warning, one hidden of two series lost the category
// highlight, and a narrow chart drew series names it had no room for beside its legend.
it('keeps the net line, the highlight and the fitted names of a column while a series is hidden', () => {
  const categories = Array.from({ length: 12 }, (_, i) => `M${i}`);
  const series = ['a', 'b', 'c'].map((id, k) => ({ id, label: `${id} segment name`, values: categories.map((_, i) => 3 + i + k) }));
  const net = laidOut('column', { categories, series }, { variant: 'stacked', legend: 'top', netLine: { seriesId: 'b' } }, ['b']).geometry;
  expect(net.warnings.map((warning) => warning.code)).toEqual([]);
  expect(net.scene.some((node) => node.id.startsWith('netLine:'))).toBe(true);
  const highlighted = laidOut('column', { categories, series: series.slice(0, 2) }, { legend: 'top', highlight: ['M2'] }, ['b']).geometry;
  expect(highlighted.scene.some((node) => node.id === 'highlightBand:M2')).toBe(true);
  const narrow = laidOut('column', { categories, series }, { variant: 'stacked', legend: 'top', seriesLabels: { at: 'right-edge' }, size: { width: 300, height: 300 } }, ['c']).geometry;
  expect(labelTexts(narrow).filter((text) => text === 'a segment name')).toHaveLength(1);
});

// Hiding the outlier that an axis break was made for refused the chart, so the reader could never hide it; and a bar
// with an authored bound kept a break across a visible bar end.
it('draws without the axis break that the visible series cannot hold', () => {
  const outlier = { categories: ['A', 'B', 'C'], series: [{ id: 'base', values: [80, 90, 75] }, { id: 'peak', values: [85, 900, 95] }] };
  const stack = { categories: ['A', 'B'], series: [{ id: 's1', values: [100, 100] }, { id: 's2', values: [500, 800] }, { id: 's3', values: [400, 400] }] };
  for (const type of ['column', 'bar']) {
    for (const [data, options, hidden] of [[outlier, { valueAxis: { break: { from: 150, to: 750 } } }, 'peak'], [stack, { variant: 'stacked', valueAxis: { min: 0, break: { from: 450, to: 550 } } }, 's1']] as const) {
      const findings = laidOut(type, data, options, [hidden]).geometry.warnings.filter((warning) => warning.code === 'axis-break-invalid');
      expect(findings.map((warning) => warning.severity), type).toEqual(['warn']);
    }
    // A break that is wrong in itself still refuses while a series is hidden.
    const zero = laidOut(type, outlier, { valueAxis: { break: { from: -10, to: 10 } } }, ['peak']).geometry.warnings;
    expect(zero.filter((warning) => warning.code === 'axis-break-invalid').map((warning) => warning.severity), type).toEqual(['error']);
  }
});
