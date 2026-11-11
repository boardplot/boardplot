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

// A value the step past a target line moved onto the next dot of its row: the step has to land clear, or the value stays on a halo.
it('does not step a dot value past a target line onto another dot', () => {
  const names = ['North', 'South', 'East'];
  const values = [[30, 25, 36, 59], [53, 49, 80, 25], [45, 39, 20, 20]];
  const geometry = layoutResolvedRequest(resolveChartRequest({
    type: 'dot',
    data: {
      categories: ['Alder', 'Birch', 'Cedar', 'Dune'].map((label, i) => ({ id: `c${i}`, label })),
      series: values.map((v, i) => ({ id: `s${i}`, label: names[i]!, values: v })),
    },
    annotations: [{ kind: 'valueLine', value: 47, label: 'Target' }],
    options: { size: { width: 343, unit: 'px' } },
  } as never));
  if (geometry.refused) throw new Error('refused');
  const dots = geometry.scene.filter((n) => n.t === 'circle' && n.part === 'dot') as Array<{ id: string; cx: number; cy: number; r: number }>;
  const covered = geometry.labels.filter((l) => l.kind === 'point' && !l.hidden).flatMap((l) => dots
    .filter((d) => l.rect.x < d.cx + d.r && d.cx - d.r < l.rect.x + l.rect.w && l.rect.y < d.cy + d.r && d.cy - d.r < l.rect.y + l.rect.h)
    .map((d) => `${l.id} covers ${d.id}`));
  expect(covered).toEqual([]);
});

// Bar position preferences must keep legacy pins, scales and explicit auto output intact.
it('keeps grouped bar and column auto output, pins and plot geometry', () => {
  const data = { categories: [{ id: 'a' }, { id: 'b' }], series: [{ id: 'value', values: [80, -60] }] };
  for (const type of ['column', 'bar']) {
    const draw = (options: object) => {
      const result = layoutResolvedRequest(resolveChartRequest({ type, data, options: { size: { width: 720, height: 400 }, ...options } } as never));
      if (result.refused) throw new Error('refused');
      return result;
    };
    const plain = draw({});
    expect(draw({ labelPosition: 'auto' }).scene).toEqual(plain.scene);
    const pin = { labelPlacements: { 'point:value:a': 'insideEnd' } };
    expect(draw({ ...pin, labelPosition: 'center' }).labels.find(label => label.id === 'point:value:a')?.rect)
      .toEqual(draw(pin).labels.find(label => label.id === 'point:value:a')?.rect);
    expect(draw({ labelPosition: 'center' }).plot).toEqual(plain.plot);
  }
});

// An annotation through an authored inside seat must move the value clear of the line.
it('falls back outside when a value line blocks a requested column center', () => {
  const result = layoutResolvedRequest(resolveChartRequest({ type: 'column',
    data: { categories: [{ id: 'a' }], series: [{ id: 'value', values: [100] }] },
    options: { labelPosition: 'center', annotations: [{ kind: 'valueLine', value: 50 }], size: { width: 720, height: 400 } },
  } as never));
  if (result.refused) throw new Error('refused');
  const label = result.labels.find(label => label.id === 'point:value:a')!;
  expect(label.hidden).toBeUndefined();
  expect(label.slot).toBe('outsideBarTop');
});

// labels.valueLine: false was accepted on bar and column but the target line still printed its label.
it('takes the value-line label off with labels.valueLine false and keeps the line', () => {
  const data = { categories: ['Jan', 'Feb', 'Mar'].map((label, i) => ({ id: `m${i}`, label })), series: [{ id: 'sales', values: [40, 52, 61] }] };
  for (const type of ['column', 'bar']) {
    for (const annotation of [{ kind: 'valueLine', value: 50, label: 'Goal' }, { kind: 'valueLine', value: 50, label: 'Goal', tolerance: 5 }]) {
      const geometry = layoutResolvedRequest(resolveChartRequest({ type, data, annotations: [annotation], options: { labels: { valueLine: false } } } as never));
      if (geometry.refused) throw new Error('refused');
      expect(geometry.labels.filter((l) => l.kind === 'valueLine')).toEqual([]);
      expect(geometry.scene.some((n) => n.part === 'valueLine')).toBe(true);
    }
  }
});
