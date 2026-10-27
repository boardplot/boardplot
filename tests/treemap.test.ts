import { expect, it } from 'vitest';
import '../src/core/charts';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { renderSvg } from '../src/core/svg/renderSvg';
import { requireGeometry } from '../src/core/sizing';

// Reusing data after a different-size request must not change which treemap labels are drawn.
it('keeps public treemap output independent of earlier sizes and data identity', () => {
  const make = () => ({ items: Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, label: `Product offering ${i + 1}`, value: 100 - i * 5 })) });
  const draw = (data: ReturnType<typeof make>, height: number) => {
    const request = resolveChartRequest({ type: 'treemap', data, options: { title: 'Revenue review', size: { width: 400, height } } });
    return renderSvg(requireGeometry(layoutResolvedRequest(request)), request.theme);
  };
  for (const heights of [[1000, 300], [300, 1000]]) {
    const data = make();
    draw(data, heights[0]!);
    expect(draw(data, heights[1]!)).toBe(draw(make(), heights[1]!));
  }
});
