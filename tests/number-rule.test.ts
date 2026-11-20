import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { defaultNumberTexts, numberRuleSet, type NumberSet, type PrintFace } from '../src/core/numberRule';
import { interactionRecords } from '../src/core/a11y/records';
import { labelCardContent } from '../src/react/hover/labelCard';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { requireGeometry } from '../src/core/sizing';
import type { Geometry } from '../src/core/types/scene';
import type { GridDerived } from '../src/core/charts/grid/layout';
import { getFixtures } from '../src/fixtures';

const SET: NumberSet = { kind: 'number', unitText: false, cell: false, language: 'en' };
const FACE: PrintFace = { prefix: '', suffix: '', signed: false, decimal: '.', group: ',', minus: '−' };
const texts = (values: number[], set: Partial<NumberSet> = {}, face: Partial<PrintFace> = {}) =>
  defaultNumberTexts(values, { ...SET, ...set }, { ...FACE, ...face }).texts.join(' · ');

describe('the default number rule', () => {
  // A drift from the rule's reference cases would print other texts than the rule the engine documents.
  it('prints the reference cases of the rule', () => {
    expect(texts([21.2, 24.8, 27.5, 33.1, 41.7, 48.3])).toBe('21.2 · 24.8 · 27.5 · 33.1 · 41.7 · 48.3');
    expect(texts([48, 45, 50, 50.3, 62, 63.5])).toBe('48.0 · 45.0 · 50.0 · 50.3 · 62.0 · 63.5');
    expect(texts([413, 268, 146, 64.2, 8.9])).toBe('413 · 268 · 146 · 64 · 8.9');
    expect(texts([12840], { cell: true })).toBe('12,840');
    expect(texts([12840])).toBe('12.8k');
    expect(texts([100, 65, 57.5])).toBe('100 · 65 · 58');
    expect(texts([100, 99.6, 99.2, 97.2])).toBe('100.0 · 99.6 · 99.2 · 97.2');
    expect(texts([0, 1.2, 0.5])).toBe('0 · 1.2 · 0.5');
    expect(texts([0.042, 0.018, 0.0062, 0.0000012])).toBe('0.042 · 0.018 · 0.0062 · 0.0000012');
    expect(texts([15060000, 14800000, 17670000, 16330000])).toBe('15.1M · 14.8M · 17.7M · 16.3M');
    expect(texts([15060000, 14800000], { unitText: true })).toBe('15,060,000 · 14,800,000');
    expect(texts([8400000, 3100000, 950000, 410000, 88000, 12000, 900], {}, { prefix: '$' })).toBe('$8.4M · $3.1M · $950k · $410k · $88k · $12k · $900');
    expect(texts([12, -8, 4, -15])).toBe('12 · −8 · 4 · −15');
    expect(texts([7800000, 410000], { language: 'de' }, { decimal: ',', group: '.' })).toBe('7,8 Mio. · 410.000');
    expect(texts([142, 197, 167, 38, 11, 6, -24, -6])).toBe('142 · 197 · 167 · 38 · 11 · 6 · −24 · −6');
    expect(texts([8, 9, 16, 21, 14, 23, 1], { kind: 'percent' }, { suffix: '%' })).toBe('8% · 9% · 16% · 21% · 14% · 23% · 1%');
    expect(texts([9500])).toBe('9,500');
    expect(texts([9500], { words: true })).toBe('9.5k');
    expect(texts([24.333333333333332])).toBe('24.3');
    expect(texts([15060000, 14800000], { scale: 6 }, { prefix: '$' })).toBe('$15.06M · $14.80M');
    expect(texts([8400000, 950000, 900], { scale: 6 }, { prefix: '$' })).toBe('$8.4M · $0.95M · $0.0009M');
  });

  // A late value (an annotation, a reference line) that joined a group of another scale would print "2,500k".
  it('places a late value in a group of its own scale or as a set of one', () => {
    const rule = numberRuleSet([413000, 268000], SET);
    expect([150000, 2500000, 410].map((v) => rule.text(v, FACE))).toEqual(['150k', '2.5M', '410']);
  });

  // A German chart keeps its own marks while the words follow the language: no "k" beside "Mio.".
  it('takes words from the language and marks from the chart', () => {
    expect(texts([7800000, 410000, 1250.5], { language: 'de' })).toBe('7.8 Mio. · 410,000 · 1,251');
  });

  // The smallValues option must keep its meaning for a value that needs more than four decimals.
  it('prints a tiny value as the smallValues mode says', () => {
    const values = [0.042, 0.018, 0.0062, 0.0000012];
    expect(texts(values, { small: 'bound' })).toBe('0.042 · 0.018 · 0.0062 · <0.001');
    expect(texts(values, { small: 'zero' })).toBe('0.042 · 0.018 · 0.0062 · 0.000');
    expect(texts(values, { small: 'scientific' })).toBe('0.042 · 0.018 · 0.0062 · 1.2 × 10⁻⁶');
    expect(texts(values, { small: 'p-value' })).toBe('.042 · .018 · .006 · <.001');
  });

  // A change in percent printed three digits like a level ("+9.09%"); a change set prints two in every group.
  it('prints two digits in every group of a change set', () => {
    const change = (values: number[]) => texts(values, { kind: 'percent', change: true }, { signed: true, suffix: '%' });
    expect(change([9.09, -4])).toBe('+9.1% · −4.0%');
    expect(change([28, 32.6, 37.2, 44.4])).toBe('+28% · +33% · +37% · +44%');
  });

  // Math.min and Math.max over a spread band threw "Maximum call stack size exceeded" from about 120,000 values.
  it('prints a set of 150,000 values', () => {
    expect(numberRuleSet(Array.from({ length: 150_000 }, (_, i) => 500 + (i % 400)), SET).text(899, FACE)).toBe('899');
  });

  // A value below about 1e-100 asked toFixed for more than 100 decimals and threw.
  it('prints a value too small for the number printer in scientific form', () => {
    expect(texts([0.042, 1e-120, 0.018])).toBe('0.042 · 1.0\u00a0×\u00a010⁻¹²⁰ · 0.018');
  });

  // A signed chart lost the plus sign of a bound and of a scientific text ("<0.001" for a gain).
  it('keeps the sign of a signed face in a smallValues text', () => {
    const values = [0.2, 0.0000012, -0.0000012];
    expect(texts(values, { small: 'bound' }, { signed: true })).toBe('+0.2 · <+0.1 · >−0.1');
    expect(texts(values, { small: 'scientific' }, { signed: true })).toBe('+0.2 · +1.2\u00a0×\u00a010⁻⁶ · −1.2\u00a0×\u00a010⁻⁶');
  });

  // A bound or a zero at the decimals of a tiny first group was false ("<0.00001" for 0.00034), and so was a bound for a value above its step.
  it('prints a true bound and a true zero under smallValues, at four decimals at most', () => {
    const tiny = [0.00034, 0.00021, 0.00045, 0.0000012];
    expect(texts(tiny, { small: 'bound' })).toBe('0.0003 · 0.0002 · 0.0005 · <0.0001');
    expect(texts(tiny, { small: 'zero' })).toBe('0.0003 · 0.0002 · 0.0005 · 0.0000');
    expect(texts([0.0042, 0.0031, 0.00034], { small: 'bound' })).toBe('0.0042 · 0.0031 · 0.0003');
    expect(texts([0.00034], { small: 'bound', cell: true })).toBe('0.0003');
    expect(texts([0.000000005], { small: 'bound', cell: true })).toBe('<0.0001');
    // A p-value set prints a value outside 0 to 1 as a bound set does.
    expect(texts([-0.0042, -0.0031, -0.00034], { small: 'p-value' })).toBe('−0.0042 · −0.0031 · −0.0003');
    expect(texts([-0.00034, -0.00021, -0.0000012], { small: 'p-value' })).toBe('−0.0003 · −0.0002 · >−0.0001');
  });
});

/** The drawn texts of a request, by node id. */
function drawn(spec: object): Map<string, string> {
  const geometry = requireGeometry(layoutResolvedRequest(resolveChartRequest(spec as never))) as Geometry;
  return new Map(geometry.scene.flatMap((node) => (node.t === 'text' ? [[node.id, node.lines.join(' ')] as [string, string]] : [])));
}
const textsOf = (map: Map<string, string>, ids: string[]) => ids.map((id) => map.get(id));
const fixture = (type: string, id: string) => getFixtures(type).find((candidate) => candidate.id === id)!;
const MONTHS = ['01', '02', '03', '04', '05', '06'].map((m, i) => ({ id: `2026-${m}`, label: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'][i]! }));
const gridStack = (intake: number[], panel: object) => ({ type: 'grid', options: { stack: {}, size: { width: 960 } }, data: {
  categories: MONTHS,
  measures: [{ id: 'intake', label: 'Intake', values: intake }, { id: 'retained', label: 'Retained', values: [700, 700, 949, 1100, 1100, 1451] }],
  panels: [{ id: 'intake', type: 'column', title: 'New enquiries', measure: { sum: ['intake'] }, readout: 'change', ...panel },
    { id: 'conversion', type: 'line', title: 'Conversion', unit: '% of enquiries', measure: { numerator: ['retained'], denominator: 'intake' }, readout: 'change' }],
  windows: { grain: 'month', base: { from: '2026-01', to: '2026-03', label: 'Q1' }, compare: { from: '2026-04', to: '2026-06', label: 'Q2' } } } });

describe('the default number rule on charts', () => {
  // A cell's own format inside a default column printed through the column's rule set and lost its decimals ("12", "3.14").
  it('prints a table cell through its own format inside a default column', () => {
    const texts = drawn({ type: 'table', options: { variant: 'steering', size: { width: 640 } }, data: {
      columns: [{ id: 'kpi', kind: 'rowLabel', label: 'KPI' }, { id: 'a', kind: 'value', label: 'North' }, { id: 'b', kind: 'value', label: 'South' }],
      rows: [{ id: 'r1', label: 'Visits', cells: { a: 1234.5, b: 2210.75 } },
        { id: 'r3', label: 'Items per order', cells: { a: { v: 12.125, format: '1,234.56' }, b: { v: 3.14159, format: '1,234.567' } } }] } });
    expect(textsOf(texts, ['cell:r3:a', 'cell:r3:b'])).toEqual(['12.13', '3.142']);
  });

  // A bar table built its sets without the cell threshold and printed scale words from 10,000 ("12.8k").
  it('prints bar table cells written out below 100,000', () => {
    const texts = drawn({ type: 'bartable', data: {
      categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], series: [{ id: 'energy', label: 'Energy' }],
      columns: [{ id: 'sites', label: 'Visits', values: [12840, 48250, 9500] }],
      panels: [{ id: 'cost', label: 'Orders', values: { energy: [12840, 48250, 9500] } }] } });
    expect(textsOf(texts, ['label:cell:sites:a', 'label:cell:sites:b', 'label:cell:sites:c', 'label:total:sites'])).toEqual(['12,840', '48,250', '9,500', '70,590']);
  });

  // Each trend slope and each r² was a set of one: "+9,640" beside "+11.7k", and "r² 1" beside "r² 0.973".
  it('prints the trend slopes and the r² values of a chart as one set each', () => {
    const texts = drawn({ type: 'line', options: { trend: true, size: { width: 760, height: 420 } }, data: {
      categories: ['2021', '2022', '2023', '2024', '2025'].map((id) => ({ id, label: id })),
      series: [{ id: 'a', label: 'North', values: [10000, 20000, 30000, 40000, 50000] }, { id: 'b', label: 'South', values: [20500, 27100, 41000, 44900, 59800] }] } });
    const legend = [...texts.values()].filter((text) => text.includes('per period'));
    expect(legend).toEqual(['Linear trend, North: +10.00k per period; r² 1.00', 'Linear trend, South: +9.64k per period; r² 0.97']);
    // Slopes below 10,000 took no scale word beside labels that have one ("+2,700 per period" beside "59.1k").
    const small = drawn({ type: 'line', options: { trend: true, size: { width: 760, height: 420 } }, data: {
      categories: ['2021', '2022', '2023', '2024', '2025'].map((id) => ({ id, label: id })),
      series: [{ id: 'a', label: 'North', values: [48200, 51100, 52900, 56300, 59100] }, { id: 'b', label: 'South', values: [50500, 52100, 54000, 55900, 57800] }] } });
    expect([...small.values()].filter((text) => text.includes('per period'))).toEqual(['Linear trend, North: +2.70k per period; r² 0.993', 'Linear trend, South: +1.84k per period; r² 0.999']);
  });

  // German totals on a narrow stacked column printed " Tsd." (German has no short word for thousand), or the value
  // rounded to a scale (8,700): a total prints its value as its level set does (8,745).
  it('writes out German totals on a narrow stacked column', () => {
    const series = (base: number, step: number) => Array.from({ length: 14 }, (_, i) => base + i * step);
    const texts = drawn({ type: 'column', options: { variant: 'stacked', mode: 'compact', size: { width: 300, height: 220 }, locale: { language: 'de' } }, data: {
      categories: Array.from({ length: 14 }, (_, i) => ({ id: `c${i}`, label: `W${i + 1}` })),
      series: [{ id: 'a', label: 'Online', values: series(2345, 137) }, { id: 'b', label: 'Retail', values: series(1876, 211) }] } });
    const totals = [...texts].filter(([id]) => id.startsWith('label:grandTotal:')).map(([, text]) => text);
    expect(totals).toEqual(['8,745', '4,569', '5,265', '5,961', '6,657', '7,353']);
  });

  // "M$" read as a currency sign, so the unit text kept scale words: "12.8k" under "Revenue in M$".
  it('reads a magnitude letter before a currency sign as a unit text', () => {
    const texts = drawn({ type: 'bar', options: { unit: 'M$' }, data: { categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }],
      series: [{ id: 's', label: 'Revenue', values: [12840, 48250, 9500] }] } });
    expect(textsOf(texts, ['label:point:s:a', 'label:point:s:b', 'label:point:s:c'])).toEqual(['12,840', '48,250', '9,500']);
  });

  // The growth rate per series printed one fixed decimal ("+0.5% p.a."), outside a change set.
  it('prints the growth rates per series as one change set', () => {
    const texts = drawn({ type: 'column', options: { variant: 'stacked', seriesLabels: { at: 'right-edge', cagr: true }, size: { width: 720, height: 400 } }, data: {
      categories: ['2021', '2022', '2023', '2024'].map((id) => ({ id, label: id })),
      series: [{ id: 'a', label: 'Hardware', values: [400, 402, 404, 406.5] }, { id: 'b', label: 'Services', values: [100, 101, 102, 102.6] }] } });
    expect(textsOf(texts, ['label:seriesEdge:a', 'label:seriesEdge:b'])).toEqual(['Hardware +0.54% p.a.', 'Services +0.86% p.a.']);
  });

  // The change headline of a rate panel came from the rates rounded to one decimal ("+1.4pp" beside "2.35% → 3.65%").
  it('computes the change headline of a rate panel from the received rates', () => {
    const texts = drawn(gridStack([30000, 30000, 40000, 30000, 30000, 40000], {}));
    expect(textsOf(texts, ['label:conversion:before', 'label:conversion:after', 'label:conversion:headline'])).toEqual(['2.35%', '3.65%', '+1.3pp']);
  });

  // A panel with a divisor and no decimals became a rule set and printed "31.3" and a headline "−2.7%"; it prints as it did before the rule.
  it('prints a grid panel with a divisor as before the default rule', () => {
    const texts = drawn(gridStack([31250, 30400, 41875, 30120, 29980, 40660], { unit: 'thousand per month', divisor: 1000 }));
    expect(textsOf(texts, MONTHS.map((month) => `label:intake:value:${month.id}`))).toEqual(['31', '30', '42', '30', '30', '41']);
    expect(textsOf(texts, ['label:intake:before', 'label:intake:after', 'label:intake:headline'])).toEqual(['35', '34', '−3%']);
  });

  // A cost per order stored per month and drawn as a sum panel averaged the monthly ratios over a window: 12.5 for spend
  // 100 and 300 on 10 and 20 orders. A per-unit panel divides the window sums, and a month without orders has no value.
  it('computes the window value of a per-unit grid panel from the window sums', () => {
    const geometry = requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'grid', options: { stack: {}, size: { width: 960 } }, data: {
      categories: MONTHS.slice(0, 3),
      measures: [{ id: 'spend', label: 'Spend', values: [100, 300, 50] }, { id: 'orders', label: 'Orders', values: [10, 20, 0] }],
      panels: [{ id: 'cpo', type: 'line', title: 'Cost per order', unit: '$ per order', measure: { ratio: ['spend'], per: 'orders' }, readout: 'change' },
        { id: 'orders', type: 'column', title: 'Orders', unit: 'per month', measure: { sum: ['orders'] }, readout: 'change' }],
      windows: { grain: 'month', base: { from: '2026-01', to: '2026-02', label: 'Jan–Feb' }, compare: { from: '2026-03', to: '2026-03', label: 'Mar' } } } } as never))) as Geometry;
    const stack = (geometry.derived as GridDerived).metricStack!;
    expect(stack.panels[0]!.values).toEqual([10, 15, null]);
    expect(stack.readouts[0]!.claims.find((claim) => claim.id === 'stack:cpo:base')!.output.raw).toBeCloseTo(400 / 30, 10);
    expect(stack.readouts[0]).toMatchObject({ method: 'ratio-change', after: null, headline: null });
  });

  // The weighted-rate readout rounded each rate to one decimal before it printed ("4.7%", "4.7 → 0.2"), and a panel with
  // decimals lost its kept text ("50%"). A panel with decimals prints as before; a panel without prints the received rates.
  // One value printed in two ways side by side ("4.75%" over "100 → 4.7"): the weighted rates of a stack are one set.
  it('prints the weighted-rate readout of a grid panel from the received rates unless the panel sets decimals', () => {
    const quarters = MONTHS.slice(0, 4);
    const panel = (id: string, numerator: string, denominator: string, extra: object = {}) =>
      ({ id, type: 'line', title: id, unit: `% of ${denominator}`, measure: { numerator: [numerator], denominator }, readout: { base: 'intake' }, ...extra });
    const stack = (qualified: number[], booked: number[], qualificationExtra: object, bookingExtra: object) => drawn({ type: 'grid', options: { stack: {}, size: { width: 960 } }, data: { categories: quarters,
      measures: [{ id: 'intake', label: 'Intake', values: [4000, 4000, 4000, 4000] }, { id: 'qualified', label: 'Qualified', values: qualified },
        { id: 'booked', label: 'Booked', values: booked }],
      panels: [panel('qualification', 'qualified', 'intake', qualificationExtra), panel('booking', 'booked', 'qualified', bookingExtra)] } });
    const readout = (texts: Map<string, string>) => textsOf(texts, ['label:qualification:headline', 'label:booking:headline',
      'label:qualification:before', 'label:qualification:after', 'label:booking:before', 'label:booking:after']);
    const booked = [9, 8.8, 9.3, 9.1];
    expect(readout(stack([190, 187, 193, 189.4], booked, {}, {}))).toEqual(['4.75%', '4.77%', '100', '4.75', '4.75', '0.23']);
    expect(readout(stack([200, 200, 200, 200], booked, { decimals: 1 }, { decimals: 1 }))).toEqual(['5.0%', '4.5%', '100', '5.0', '5.0', '0.2']);
    expect(readout(stack([2000, 1900, 2100, 2000], [500, 480, 520, 500], { decimals: 1 }, {}))).toEqual(['50.0%', '25.0%', '100', '50.0', '50.0', '12.5']);
  });

  // The card printed a percent change the chart does not draw at the decimals of the drawn percent labels ("+14.4%"),
  // a default read from printed texts. It is a change set of one value, two digits: "+14%".
  it('prints a percent change the chart does not draw as a change set of one value in the hover card', () => {
    const request = resolveChartRequest({ type: 'variance', options: { variant: 'absolute', variance: { of: 'orders', vs: 'plan' }, size: { width: 900, height: 400 } },
      data: { categories: [{ id: 'y1', label: 'Y1' }, { id: 'y2', label: 'Y2' }, { id: 'y3', label: 'Y3' }],
        series: [{ id: 'orders', label: 'Orders', values: [110, 112, 114.4] }, { id: 'plan', label: 'Plan', role: 'reference', scenario: 'PL', values: [100, 100, 100] }] } } as never);
    const geometry = requireGeometry(layoutResolvedRequest(request)) as Geometry;
    const rows = interactionRecords({ request, geometry, scope: request.scope, claims: [] })
      .filter((record) => record.comparisons.length > 0)
      .map((record) => labelCardContent(record).rows.find((row) => row.kind === 'comparison')?.value);
    expect(rows).toEqual(['+10 (+10%)', '+12 (+12%)', '+14 (+14%)']);
  });

  // A computed percent change without a format printed as a level set without a sign ("28.0% · 32.6%"). It is a signed
  // change set, one per column and one per row.
  it('prints a computed percent change column and row as signed change sets', () => {
    const column = drawn({ type: 'table', options: { size: { width: 560 } }, data: {
      columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'ac', kind: 'value' }, { id: 'py', kind: 'value' }, { id: 'yoy', kind: 'computed', calc: { op: 'percentDelta', a: 'ac', b: 'py' } }],
      rows: [128, 132.6, 137.2, 144.4].map((ac, i) => ({ id: `r${i}`, label: `Region ${i}`, cells: { ac, py: 100 } })) } });
    expect(textsOf(column, ['r0', 'r1', 'r2', 'r3'].map((id) => `cell:${id}:yoy`))).toEqual(['+28%', '+33%', '+37%', '+44%']);
    const row = drawn({ type: 'table', options: { size: { width: 560 } }, data: {
      columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'jan', kind: 'value' }, { id: 'feb', kind: 'value' }, { id: 'mar', kind: 'value' }],
      columnGroups: [{ id: 'q1', label: 'Q1', columns: ['jan', 'feb', 'mar'] }],
      rows: [{ id: 'rev', label: 'Revenue', cells: { jan: 100, feb: 110, mar: 132.6 } },
        { id: 'mom', label: 'MoM', relation: 'displayOnly', calc: { op: 'percentDelta', a: { row: 'rev' }, b: { row: 'rev', previous: true } } }] } });
    expect(textsOf(row, ['feb', 'mar'].map((id) => `cell:mom:${id}`))).toEqual(['+10%', '+21%']);
  });

  // The quadrant counts printed one by one, whole ("n = 10,400" beside "n = 600"). They are one set of the chart's
  // point counts.
  it('prints the quadrant counts of a scatter chart as one set', () => {
    const box = (count: number, x0: number, y0: number, prefix: string) => Array.from({ length: count }, (_, i) =>
      ({ id: `${prefix}${i}`, x: x0 + (i % 97) * 0.15 + 0.05, y: y0 + Math.floor(i / 97) % 97 * 0.15 + 0.05 }));
    const points = [...box(10400, 60, 60, 'tr'), ...box(4800, 2, 60, 'tl'), ...box(1200, 2, 2, 'bl'), ...box(600, 60, 2, 'br')];
    const texts = drawn({ type: 'scatter', data: { points }, options: { size: { width: 960, height: 640 },
      quadrants: { x: 40, y: 40, labels: { tl: 'Top left', tr: 'Top right', bl: 'Bottom left', br: 'Bottom right' } } } });
    const counts = ['tr', 'tl', 'bl', 'br'].map((id) => texts.get(`label:quadrant:caption:${id}`)?.match(/n = (.*)$/)?.[1]);
    expect(counts).toEqual(['10.4k', '4.8k', '1.2k', '0.6k']);
  });

  // The share change of a cascade came from rounded shares ("+3" where the received shares moved by 2.4 points), and a
  // change of −0.43 points printed as "0". It is a change set of the received changes: two digits in every group.
  it('prints the share change of a cascade as a change set of the received shares', () => {
    const { data, options } = fixture('bartable', 'cascade-four-years');
    const texts = drawn({ type: 'bartable', data, options });
    expect(textsOf(texts, ['app', 'foo', 'acc', 'hom', 'bea', 'oth'].map((id) => `label:cell:growth:${id}`))).toEqual(['−7.8', '+2.2', '+1.2', '−0.43', '+5.3', '−0.45']);
  });

  // An absolute change of a dimension-switch measure without a format printed as a set of its own, apart from its levels.
  it('prints the absolute change of a dimension-switch measure in the set of its levels', () => {
    const fact = (memberId: string, before: number, actual: number) => [
      { memberId, periodId: 'actual', sums: { rev: actual } }, { memberId, periodId: 'before', sums: { rev: before } }, { memberId, periodId: 'p1', sums: { rev: before }, ref: { rev: actual } }];
    const texts = drawn({ type: 'dimswitch', options: { variant: 'by-measure', depth: 2, size: { width: 720 } }, data: {
      dimension: { label: 'Group', total: { id: 'total', label: 'Total' }, members: [{ id: 'alpha', label: 'Alpha' }, { id: 'beta', label: 'Beta' }], headline: ['rev'] },
      measures: [{ id: 'rev', label: 'Revenue', value: { field: 'rev' }, change: 'absolute' }],
      periods: [{ id: 'actual', label: 'Range', kind: 'range' }, { id: 'before', label: 'vs prior', kind: 'prior' }, { id: 'p1', label: 'Period 1' }],
      facts: [...fact('total', 140120, 152340), ...fact('alpha', 90230, 98410), ...fact('beta', 49890, 53930)] } });
    const changes = [...texts].filter(([id]) => id.startsWith('cellline:') && id.includes(':p1:')).map(([, text]) => text);
    expect(changes).toEqual(['−12k', '−8.2k', '−4.0k']);
  });

  // A DimSwitch relative change printed one fixed decimal ("+28.0%"); the relative changes of a measure are one change set across its columns.
  it('prints the relative changes of a dimension-switch measure as one change set', () => {
    const { data, options } = fixture('dimswitch', 'by-member');
    const texts = drawn({ type: 'dimswitch', data, options });
    const changes = (measure: string) => [...texts].filter(([id, text]) => id.includes(`"total","${measure}"]`) && /:(pp|w1|w2)/.test(id) && text.endsWith('%')).map(([, text]) => text);
    expect(changes('new')).toEqual(['−3.2%', '+28%', '+32%']);
    // −6.3% in the prior-period column sets the decimals of the whole measure.
    expect(changes('orders')).toEqual(['−6.3%', '+23.6%', '+30.9%']);
  });

  // The creative card cached its printers by language alone, so a second request with another text for a missing value printed the first one's.
  it('prints a creative card by its own options when the data object is reused', () => {
    const { data, options } = fixture('creative', 'creative-placeholder');
    const missing = (text: string) => [...drawn({ type: 'creative', data, options: { ...options, strings: { notApplicable: text } } }).values()].filter((value) => value === text);
    expect(missing('n/a').length).toBeGreaterThan(0);
    expect(missing('none').length).toBeGreaterThan(0);
  });

  // The bin edges took the observations' scale words ("13.00k"); they print written out, as positions on the axis.
  it('writes out histogram bin edges without a scale word', () => {
    const texts = drawn({ type: 'histogram', options: { methodNote: true, size: { width: 720, height: 360 } }, data: { observations: Array.from({ length: 300 }, (_, i) => 13000 + ((i * 739) % 2400)) } });
    const edges = [...texts].filter(([id]) => id.startsWith('label:edge:')).map(([, text]) => text);
    expect(edges.length).toBeGreaterThan(2);
    expect(edges.every((text) => /^1\d,\d00$/.test(text))).toBe(true);
    expect([...texts.values()].some((text) => /from 13,000/.test(text))).toBe(true);
  });

  // A zero edge printed a decimal point in a chart with ',' marks ("0.0" beside "0,5").
  it('prints a zero bin edge with the chart decimal mark', () => {
    const texts = drawn({ type: 'histogram', options: { bins: { width: 0.5, anchor: 0 }, locale: { language: 'de', decimal: ',', thousands: '.' }, size: { width: 720, height: 360 } }, data: { observations: [0.1, 0.4, 0.6, 0.9, 1.2, 1.4] } });
    const edges = [...texts].filter(([id]) => id.startsWith('label:edge:')).map(([, text]) => text);
    expect(edges.slice(0, 2)).toEqual(['0,0', '0,5']);
  });
});
