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

// A tile name with two words too long for the tile lost its label, because only one word could be hyphenated.
it('draws a treemap name with two over-long words on its tile', () => {
  const request = resolveChartRequest({
    type: 'treemap',
    data: {
      groups: [{ id: 'p', label: 'Alpha' }, { id: 'f', label: 'Beta' }],
      items: [
        { id: 'a', label: 'Wolkenschieber Mondscheinwanderer und Sternenzaehler', group: 'p', value: 200 },
        { id: 'b', label: 'Regenbogenmaler und Sonnenscheinverteiler', group: 'p', value: 150 },
        { id: 'c', label: 'Wolkenkratzerfensterputzer Regenbogenfarbenmischer und Sonnenschirme', group: 'f', value: 100 },
        { id: 'd', label: 'Kleine Wolke', group: 'f', value: 10 },
      ],
    },
    options: { title: 'Tile label test', unit: 'units', target: 'slide', size: { width: 439, height: 389, unit: 'pt' }, cellValue: 'value-share' },
  });
  const svg = renderSvg(requireGeometry(layoutResolvedRequest(request)), request.theme);
  expect(svg).toContain('data-id="label:item:c"');
});
