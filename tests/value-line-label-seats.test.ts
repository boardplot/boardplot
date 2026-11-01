import { expect, it } from 'vitest';
import '../src/core/charts';
import { getFixtures } from '../src/fixtures';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';

function layout(type: string, id: string, options: Record<string, unknown>) {
  const fixture = getFixtures(type).find((f) => f.id === id)!;
  const geometry = layoutResolvedRequest(resolveChartRequest({
    type, data: fixture.data, ...(fixture.annotations ? { annotations: fixture.annotations } : {}),
    options: { ...(fixture.options ?? {}), averageMarker: true, ...options },
  } as never));
  if (geometry.refused) throw new Error('refused');
  return geometry;
}

// An average rule across a seat took the value's place: a stacked part went to the notes, a bar total moved into its last part, and a lollipop value ran to the plot edge on a leader.
it('keeps a value or total at its seat when the average rule runs across it', () => {
  const column = layout('column', 'stacked-value-and-share', {});
  expect(column.labels.filter((l) => l.id.startsWith('segment:') && l.hidden).map((l) => l.id)).toEqual([]);

  const combo = layout('combo', 'revenue-units-dual-axis-anatomy', {});
  expect(combo.labels.filter((l) => l.id.startsWith('grandTotal:') && l.hidden).map((l) => l.id)).toEqual([]);

  const bar = layout('bar', 'grouped-cloud-cagr', { variant: 'stacked' });
  expect(bar.labels.find((l) => l.id === 'grandTotal:fy22')!.slot).toBe('outsideEnd');

  const phone = layout('bar', 'margin-by-brand', { format: '1.0', size: { width: 343, unit: 'px' } });
  expect(phone.labels.filter((l) => l.kind === 'point' && l.hidden).map((l) => l.id)).toEqual([]);

  const dot = layout('dot', 'dot-range-benchmark', { variant: 'lollipop' });
  expect(dot.labels.find((l) => l.id.startsWith('point:') && l.id.endsWith(':central'))!.leader).toBeUndefined();
});
