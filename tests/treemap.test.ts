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

// Problem: on a slide the size ladder stopped after three steps, so cells of a long-name treemap stayed blank
// while a smaller label size would have named them, and a hyphenated name was left blank instead of breaking at its hyphen.
const longNames: [string, number][] = [['Other operating expenses', 234.1], ['North-Westmoor (Riverland)', 286.4], ['Upper Midlands and South-East', 269],
  ['Northumberland-Westmoreland', 372.6], ['Pension provisions, domestic', 411.6], ['Depreciation of fixed assets', 205], ['Research and development expenses', 260.6],
  ['Lower-Rhine and Southland', 412.8], ['Customer acquisition cost', 321.7], ['Selling and distribution overheads', 449.2], ['Costs of purchased goods', 401.5],
  ['Greater-Midlands and Bristol', 572.8], ['Average order value, marketplace', 335.2], ['Interest and similar expenses', 236.3], ['Reinvoiced transportation costs', 298.1],
  ['Maintenance and repairs', 609.8], ['General and administrative costs', 308.3], ['Net revenue retention, enterprise', 457.4], ['Other operating income', 441.4],
  ['Income from equity-accounted firms', 504.6], ['Subcontracted logistics overseas', 497.5], ['Change in net working capital', 270], ['Depreciation and amortisation', 606],
  ['Other comprehensive income items', 200]];
const drawLongNames = () => {
  const items = longNames.map(([label, value], i) => ({ id: `n${i}`, label, group: `g${i % 5}`, value }));
  const request = resolveChartRequest({ type: 'treemap', data: { groups: [0, 1, 2, 3, 4].map((i) => ({ id: `g${i}`, label: `Group ${i}` })), items },
    options: { target: 'slide', size: { width: 888, height: 396, unit: 'pt' }, cellValue: 'value-share' } });
  return requireGeometry(layoutResolvedRequest(request));
};

it('steps treemap names down to the slide floor and names every cell', () => {
  const g = drawLongNames();
  expect(g.labels.filter((l) => l.hidden)).toEqual([]);
  const sizes = g.scene.flatMap((n) => (n.t === 'text' && n.id.startsWith('label:item:') ? [n.font.size] : []));
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(40 / 3 - 1e-6);
});

it('breaks a treemap name at its own hyphen before it blanks the cell', () => {
  const items = [['Northumberland-Westmoreland', 300], ['Other operating income', 400], ['Pension provisions', 300]].map(([label, value], i) => ({ id: `n${i}`, label: label as string, value: value as number }));
  const request = resolveChartRequest({ type: 'treemap', data: { items }, options: { target: 'slide', size: { width: 280, height: 400, unit: 'pt' }, cellValue: 'value-share' } });
  const lines = requireGeometry(layoutResolvedRequest(request)).scene.flatMap((n) => (n.t === 'text' && n.id === 'label:item:n0' ? n.lines : []));
  expect(lines).toEqual(['Northumberland-', 'Westmoreland']);
});
