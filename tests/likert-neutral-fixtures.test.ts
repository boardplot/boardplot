import { expect, it } from 'vitest';
import { layoutResolvedRequest, renderSvg, resolveChartRequest } from '../src/index';
import { getFixtures } from '../src/fixtures';

// The example subtitles stated one neutral treatment, so the other Neutral setting drew a sentence that contradicted the bars.
it('likert examples state the neutral treatment of the option, not the one they were authored with', () => {
  for (const [id, other, stale] of [
    ['employee-engagement-5pt', 'exclude', 'split across the centre line'],
    ['customer-effort-7pt', 'split', 'bars do not sum to the base'],
  ] as const) {
    const fixture = getFixtures('likert').find((item) => item.id === id)!;
    const request = resolveChartRequest({ type: 'likert', data: fixture.data, options: { ...(fixture.options as object), neutral: other } });
    const result = layoutResolvedRequest(request);
    if (result.refused) throw new Error(`${id} refused`);
    expect(renderSvg(result, request.theme), id).not.toContain(stale);
  }
});

// A narrower plot (the base column) hid 14% shares that still fit their segments at the 11 px floor; a readable value must draw.
it('likert steps a share too wide for its segment down to the reader floor instead of hiding it', () => {
  const fixture = getFixtures('likert').find((item) => item.id === 'torture-likert-degenerate')!;
  const result = layoutResolvedRequest(resolveChartRequest({ type: 'likert', data: fixture.data, options: fixture.options as object }));
  if (result.refused) throw new Error('torture-likert-degenerate refused');
  const shares = result.labels.filter((label) => label.kind === 'segment' && label.owner.categoryId === 'tiny');
  expect(shares.filter((label) => label.hidden).map((label) => label.owner.seriesId)).toEqual([]);
  expect(shares.find((label) => label.owner.seriesId === 'likert:d')?.font?.size).toBe(11);
});
