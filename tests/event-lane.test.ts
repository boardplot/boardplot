/**
 * The event lane above a time axis: which events get a text block and which
 * fall back to a numbered marker with a key entry under the plot.
 */
import { expect, it } from 'vitest';
import '../src/core/charts';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { requireGeometry } from '../src/core/sizing';
import { render } from '../src/cli/render';
import type { Geometry } from '../src/core/types/scene';

// A block whose pole grazed the end of the earlier block went to the key, though the earlier block could turn left of its pole.
it('turns a placed block to the other side of its pole to fit the next event in the lane', () => {
  const categories = Array.from({ length: 30 }, (_, i) => ({ id: `2026-09-${String(i + 1).padStart(2, '0')}` }));
  const series = ['a', 'b', 'c'].map((id, s) => ({ id, values: categories.map((_, i) => 60 + 20 * s + i) }));
  for (const type of ['line', 'column'] as const) {
    const request = resolveChartRequest({
      type,
      data: { categories, series },
      annotations: [
        { kind: 'event', at: '2026-09-12', label: 'Campaign launch' },
        { kind: 'event', at: '2026-09-16', label: 'Price change on core plan' },
      ],
      options: { title: 'Daily sessions', size: { width: 960, height: 540 }, events: { rows: 2 } },
    } as never);
    const geometry = requireGeometry(layoutResolvedRequest(request)) as Geometry;
    expect(geometry.frame.eventKeyRect, type).toBeUndefined();
  }
});

// An author could not write the accessible description, and a chart with events appended its own event sentence to it.
it('options.a11y.description replaces the generated description, event sentence included', () => {
  const categories = Array.from({ length: 12 }, (_, i) => ({ id: `2026-09-${String(i + 1).padStart(2, '0')}` }));
  const data = { categories, series: [{ id: 'a', label: 'Sessions', values: categories.map((_, i) => 60 + i) }] };
  const annotations = [{ kind: 'event', at: '2026-09-05', label: 'Campaign launch' }];
  for (const type of ['line', 'column'] as const) {
    const spec = (a11y?: object) => ({ type, data, annotations, options: { title: 'Daily sessions', ...(a11y ? { a11y } : {}) } });
    const generated = requireGeometry(layoutResolvedRequest(resolveChartRequest(spec() as never))).a11y.desc;
    expect(generated, type).toContain('Campaign launch');
    const description = 'Sessions rose all month. The launch did not change the trend.';
    const authored = spec({ description });
    expect(requireGeometry(layoutResolvedRequest(resolveChartRequest(authored as never))).a11y.desc, type).toBe(description);
    const svg = String((render({ spec: authored as never, return: ['svg'] }).body as { svg: string }).svg);
    expect(svg, type).toContain(`>${description}</desc>`);
  }
});

// With axis titles the series key row stood under the lane, and an event pole ended at it instead of reaching its column.
it('runs an event pole past the series key row down to its column', () => {
  const categories = Array.from({ length: 24 }, (_, i) => ({ id: `w${i}`, label: `Week ${i + 1}` }));
  const geometry = requireGeometry(layoutResolvedRequest(resolveChartRequest({
    type: 'combo',
    data: { categories, series: [
      { id: 'orders', label: 'Orders', kind: 'column', values: categories.map((_, i) => 30 + 2 * i) },
      { id: 'share', label: 'Return share', kind: 'line', axis: 'secondary', values: categories.map((_, i) => 1.5 + i / 10) },
    ] },
    annotations: [{ kind: 'event', at: 'w1', label: 'Promotion' }],
    options: { axisTitles: { primary: 'Weekly orders, k', secondary: 'Return share, %' }, secondaryAxis: { acknowledge: true }, size: { width: 1200, height: 340 } },
  } as never))) as Geometry;
  const poles = geometry.scene.filter((n) => n.t === 'line' && n.part === 'eventPole') as Array<{ y2: number }>;
  expect(Math.max(...poles.map((p) => p.y2))).toBeGreaterThan(geometry.plot.y + geometry.plot.h / 3);
});
