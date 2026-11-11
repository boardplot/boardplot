import { expect, it } from 'vitest';
import '../src/core/charts';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';

// A value label whose own seat on the stem side was free printed over its stem, so the line ran through the number.
it('keeps a lollipop value label off its own stem when a reference line blocks the seat beside the dot', () => {
  const values = [47, 41, 35, 30, 27, 25, 22, 19, 14, 9, 15.4];
  const geometry = layoutResolvedRequest(resolveChartRequest({
    type: 'dot',
    data: {
      categories: values.map((_, i) => ({ id: `c${i}`, label: `Deal ${i + 1}` })),
      series: [{ id: 's', label: 'Premium', values }],
    },
    annotations: [{ kind: 'valueLine', value: 26, label: 'Median' }],
    options: { variant: 'lollipop', format: '1.0%', size: { width: 300, height: 426, unit: 'pt' } },
  }));
  if (geometry.refused) throw new Error('refused');
  const stems = geometry.scene.filter((node) => node.t === 'line' && node.part === 'stem');
  expect(stems).toHaveLength(values.length);
  for (const stem of stems) {
    if (stem.t !== 'line') continue;
    const label = geometry.labels.find((l) => l.id === `point:s:${stem.id.slice('stem:'.length)}`)!;
    const onStem = label.rect.x < Math.max(stem.x1, stem.x2) && label.rect.x + label.rect.w > Math.min(stem.x1, stem.x2)
      && label.rect.y < stem.y1 + 1 && label.rect.y + label.rect.h > stem.y1 - 1;
    expect(onStem, label.id).toBe(false);
  }
});

// Values just left of the average line stepped past it, up to 30 px from their dots, and read as the next rows' values.
it('keeps a lollipop value beside its dot when the step past a reference line would carry it away', () => {
  const values = [62, 58, 57, 55, 53, 52, 46, 43, 41, 40, 38, 37, 36, 34, 33, 32, 18, 15, 14, 10];
  const geometry = layoutResolvedRequest(resolveChartRequest({
    type: 'dot',
    data: { categories: values.map((_, i) => ({ id: `r${i}`, label: `Row ${i + 1}` })), series: [{ id: 'n', label: 'Count', values }] },
    options: { variant: 'lollipop', averageMarker: true, size: { width: 375, height: 700 } },
  } as never));
  if (geometry.refused) throw new Error('refused');
  const dots = new Map(geometry.scene.filter((n) => n.t === 'circle' && n.part === 'dot').map((d) => [d.owner?.categoryId, d as { cx: number; r: number }]));
  const far = geometry.labels.filter((l) => l.kind === 'point' && !l.hidden).flatMap((l) => {
    const dot = dots.get(l.owner.categoryId)!;
    return l.rect.x - (dot.cx + dot.r) > 12 ? [l.id] : [];
  });
  expect(far).toEqual([]);
});
