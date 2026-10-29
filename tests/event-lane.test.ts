/**
 * The event lane above a time axis: which events get a text block and which
 * fall back to a numbered marker with a key entry under the plot.
 */
import { expect, it } from 'vitest';
import '../src/core/charts';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { requireGeometry } from '../src/core/sizing';
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
