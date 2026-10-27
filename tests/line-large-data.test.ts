/**
 * A line samples itself only where drawing every point the same way is safe:
 * evenly spaced, strictly increasing periods above the point budget.
 */
import { describe, expect, it } from 'vitest';
import { layoutResolvedRequest, resolveChartRequest } from '../src/index';
import { renderSvg } from '../src/core/svg/renderSvg';
import { requireGeometry } from '../src/core/sizing';
import { maxOf, minOf, pushAll } from '../src/core/arrays';

const days = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `d${i}`, date: new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString().slice(0, 10) }));

function draw(request: unknown): { svg: string; codes: string[] } {
  const resolved = resolveChartRequest(request as Parameters<typeof resolveChartRequest>[0]);
  const layout = layoutResolvedRequest(resolved);
  if (layout.refused) throw new Error(JSON.stringify(layout.refused));
  const geometry = requireGeometry(layout);
  return { svg: renderSvg(geometry, resolved.theme), codes: geometry.warnings.map((w) => w.code) };
}

describe('line sampling above the point budget', () => {
  // Sampling refuses dates out of order, so a descending day row above the budget must draw unsampled instead of throwing.
  it('draws a long row of descending dates unsampled', () => {
    const categories = days(2101).reverse();
    const { codes } = draw({ type: 'line', data: { categories, series: [{ id: 's', label: 'Visits', values: categories.map((_, i) => 100 + (i % 11)) }] }, options: { size: { width: 480 } } });
    expect(codes).not.toContain('line-decimated');
  });

  // Crowded-tick thinning belongs to sampled lines; a year of authored day ticks keeps all 365 on a line that does not sample.
  it('keeps every authored day tick on a line that does not sample', () => {
    const categories = days(365);
    const { svg } = draw({ type: 'line', data: { categories, series: [{ id: 's', label: 'Visits', values: categories.map((_, i) => 100 + (i % 11)) }] }, options: { size: { width: 480 }, categoryAxis: { dateTicks: 'days' } } });
    expect(svg.match(/data-id="axis:x:tick:/g)).toHaveLength(365);
  });

  // A 150,000-point line threw RangeError from Math.max(...values) before sampling could reduce it.
  it('draws a 150,000-point daily line', () => {
    const categories = days(150_000);
    const { codes } = draw({ type: 'line', data: { categories, series: [{ id: 's', label: 'Visits', values: categories.map((_, i) => 10 + i / 1000) }] }, options: { size: { width: 800 } } });
    expect(codes).toContain('line-decimated');
  });

  // The loop helpers replace argument spreads, which throw past about 100,000 values; they must match the spread on NaN and signed zero.
  it('takes extrema and appends past the argument limit', () => {
    const values = Array.from({ length: 500_000 }, (_, i) => (i * 7919) % 500_000 - 250_000);
    expect([maxOf(values), minOf(values)]).toEqual([249_999, -250_000]);
    expect(pushAll([1], values)).toBe(500_001);
    expect([maxOf([]), minOf([]), maxOf([1, NaN]), Object.is(maxOf([-0, 0]), 0), Object.is(minOf([0, -0]), -0)]).toEqual([-Infinity, Infinity, NaN, true, true]);
  });

  // Areas never sampled: 150,000 stacked days drew a 13 MB SVG in 24 s, and 300,000 aborted the process out of memory.
  // Sampling kept each series' extremes but not the stack's: the peak of the sum vanished and the axis shrank.
  it('samples a long stacked area like a line and keeps the stack peak', () => {
    const categories = days(20_000);
    const values = (spike: number) => categories.map((_, i) => (i === spike ? 100 : i === 10_003 ? 90 : 50));
    const request = (window?: object) => ({ type: 'line', data: { categories, series: [{ id: 'a', label: 'North', values: values(10_001) }, { id: 'b', label: 'South', values: values(10_002) }] }, options: { variant: 'stacked-area', size: { width: 800 }, ...(window ? { window } : {}) } });
    const top = (req: unknown) => {
      const geometry = requireGeometry(layoutResolvedRequest(resolveChartRequest(req as Parameters<typeof resolveChartRequest>[0])));
      return { codes: geometry.warnings.map((w) => w.code), top: maxOf(geometry.axes.find((axis) => axis.axis === 'y')!.ticks.map((tick) => Number(tick.at))) };
    };
    const sampled = top(request());
    expect(sampled.codes).toContain('line-decimated');
    expect(sampled.top).toBe(top(request({ decimate: 'none' })).top);
  });
});
