import { describe, expect, it } from 'vitest';
import { layoutResolvedRequest, resolveChartRequest } from '../src/index';
import { labelOmissions } from '../src/core/label/omissions';

/** The label of a thin segment in a 360 px waterfall: a 80,000 start, then one segment of `value`. */
function thinSegment(value: number, format: string) {
  const data = { items: [
    { id: 'a', label: 'Start', type: 'total', value: 80000 },
    { id: 'b', label: 'Step', segments: [{ id: 'x', label: 'X', value, colorRole: 'good' }, { id: 'y', label: 'Y', value: -38000, colorRole: 'bad' }] },
    { id: 'c', label: 'End', type: 'total' },
  ] };
  const request = resolveChartRequest({ type: 'waterfall', data, options: { size: { width: 720, height: 360 }, format } } as never);
  const geometry = layoutResolvedRequest(request);
  if (geometry.refused) throw new Error('refused');
  return { request, geometry, label: geometry.labels.find((label) => label.id === 'segment:b:x')! };
}

describe('the waterfall digit seat keeps every glyph inside its segment', () => {
  // The seat holds the digits' cap height. A comma's tail hangs below it and crossed the seam;
  // parentheses reach past it and crossed the segment's edge.
  it('a value with a comma tail or parentheses does not take the digit seat', () => {
    const { request, geometry, label: comma } = thinSegment(3200, '1,234');
    expect(comma.hidden).toBe('redundant');
    expect(labelOmissions(geometry, request.options, request.data)).toContainEqual(expect.objectContaining({
      labelId: comma.id, text: 'X +3,200 (Step)', destination: 'reading.omissions',
    }));
    expect(thinSegment(-5600, '(1,234)').label.slot).not.toBe('insideDigits');
  });
});
