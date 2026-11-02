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
const drawLongNames = (width = 888) => {
  const items = longNames.map(([label, value], i) => ({ id: `n${i}`, label, group: `g${i % 5}`, value }));
  const request = resolveChartRequest({ type: 'treemap', data: { groups: [0, 1, 2, 3, 4].map((i) => ({ id: `g${i}`, label: `Group ${i}` })), items },
    options: { target: 'slide', size: { width, height: 396, unit: 'pt' }, cellValue: 'value-share' } });
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

// Problem: the syllable step cut words at an open vowel ("Westmo-" "reland", "Custo-" "mer") where a reader expects "West-" "moreland" and "Cus-" "tomer".
it('breaks a treemap word between consonants or before a word ending, not inside a syllable', () => {
  const lines = drawLongNames(432).scene.flatMap((n) => (n.t === 'text' && n.id.startsWith('label:item:') ? n.lines : []));
  expect(lines).not.toContain('Westmo-');
  expect(lines).not.toContain('Custo-');
  expect(lines).toContain('Westmore-');
});

// Problem: the size search ranked a blank cell above a cut word, so on an 853 x 315 px slide it chose 13.33 px, which names more
// cells but cuts "Health" ("Hea-" "lth") where 14.67 px prints "Health" whole.
it('does not cut a treemap name that a larger label size prints whole', () => {
  const items = [['Warehouse-Fulfilment Operations', 114], ['Energy', 6], ['Reinsurance Premiums', 58], ['Warehousing', 9], ['Mecklenburg-Vorpommern', 115], ['Self-Service Onboarding', 21],
    ['Pharmaceuticals', 24], ['Rail', 49], ['Self-Service Onboarding I', 197], ['Rail J', 47], ['Health', 11], ['Administration', 63]]
    .map(([label, value], i) => ({ id: `n${i}`, label: label as string, value: value as number }));
  const request = resolveChartRequest({ type: 'treemap', data: { items }, options: { target: 'slide', size: { width: 853, height: 315, unit: 'px' } } });
  const lines = requireGeometry(layoutResolvedRequest(request)).scene.flatMap((n) => (n.t === 'text' && n.id === 'label:item:n10' ? n.lines : []));
  expect(lines.join(' ')).toContain('Health');
});

// Problem: the label-size search ranked a 10 percent tile left blank like one cut word, so it kept the larger size and left the tile blank while an 8.5 percent tile kept its name.
it('names a large treemap tile when a smaller label size can fit it', () => {
  const items = [
    ['k1', 'Wages and salaries for operations staff', 'g0', 280],
    ['k2', 'Wages and salaries for workshops and maintenance staff', 'g0', 110],
    ['k3', 'Social contributions and pensions', 'g0', 96],
    ['k4', 'Training and workplace safety', 'g0', 2.1],
    ['k5', 'Temporary staff and part-time help', 'g0', 6.4],
    ['k6', 'Traction power for trams and metro', 'g1', 70],
    ['k7', 'Diesel fuel for the bus fleet', 'g1', 26],
    ['k8', 'Natural gas for depots', 'g1', 3.2],
    ['k9', 'Heating for office buildings', 'g1', 1.1],
    ['k10', 'Charging power for electric buses', 'g1', 9.5],
    ['k11', 'Infrastructure Electromechanical and Weatherproofing', 'g2', 82],
    ['k12', 'Maintenance of buses', 'g2', 17],
    ['k13', 'Spare parts and wear material', 'g2', 10],
    ['k14', 'Tires and operating supplies', 'g2', 4.6],
    ['k15', 'Cleaning and painting of vehicles', 'g2', 2.8],
    ['k16', 'External workshops and warranty work', 'g2', 0.9],
    ['k17', 'Trackbed construction and rail replacement', 'g3', 38],
    ['k18', 'Tunnel maintenance', 'g3', 9],
    ['k19', 'Signal systems and control center', 'g3', 6],
    ['k20', 'Stops and passenger information', 'g3', 3.3],
    ['k21', 'Bridge inspection', 'g3', 1.4],
    ['k22', 'Winter service', 'g3', 0.4],
    ['k23', 'Administration and overhead', 'g4', 26],
    ['k24', 'IT and ticketing systems', 'g4', 7],
    ['k25', 'Insurance', 'g4', 4.7],
    ['k26', 'Consulting and audit', 'g4', 2.3],
    ['k27', 'Marketing and customer service', 'g4', 1.6],
  ] as const;
  const request = resolveChartRequest({
    type: 'treemap',
    data: {
      groups: [
        { id: 'g0', label: 'Payroll' }, { id: 'g1', label: 'Energy and fuel' },
        { id: 'g2', label: 'Fleet upkeep' }, { id: 'g3', label: 'Infrastructure' },
        { id: 'g4', label: 'Administration' },
      ],
      items: items.map(([id, label, group, value]) => ({ id, label, group, value })),
    },
    options: {
      title: 'Five cost types cause 78 percent of total cost',
      subtitle: { company: 'Example Transit', measure: 'Total cost by cost type' },
      unit: 'EUR m', cellValue: 'value-share', total: true,
      source: 'Source: example data',
      target: 'slide', size: { width: 440, height: 380, unit: 'pt' }, locale: { language: 'en' },
      footnotes: ['Excludes the training refund (-3.1 EUR m): a negative value has no area. Shares refer to the sum of the positive cost types.'],
    },
  });
  const geometry = requireGeometry(layoutResolvedRequest(request));
  const label = geometry.labels.find((candidate) => candidate.id === 'item:k11');
  expect(label).toBeDefined();
  expect(label!.hidden).toBeUndefined();
});
