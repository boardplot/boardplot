/**
 * Bar fixtures: consulting-grade examples + torture set (row density, verbose labels, negatives,
 * stacked100 slivers, topN aggregation, single category). Every fixture
 * auto-enters the invariant suite.
 */

import { registerFixtures } from '../../../fixtures/registry';
import type { Fixture } from '../../registry';
import type { RangeChartData } from '../../types/data';
import type { BarOptions } from '../../types/options';

export const fixtures: Fixture<RangeChartData, BarOptions>[] = [
  {
    id: 'valuation-football-field',
    title: 'Valuation football field: five methods with the current share price',
    kind: 'example',
    tags: ['interaction'],
    hover: { owner: { categoryId: 'dcf', seriesId: 'equity-value' } },
    data: {
      categories: [
        { id: 'dcf', label: 'Discounted cash flow' },
        { id: 'trading', label: 'Trading comparables' },
        { id: 'transactions', label: 'Precedent transactions' },
        { id: 'lbo', label: 'Leveraged buyout' },
        { id: 'analysts', label: 'Analyst targets' },
      ],
      series: [
        {
          id: 'equity-value',
          label: 'Implied value per share',
          values: [
            { number: 48, range: { low: 41, high: 56, mid: 48 } },
            { number: 45, range: { low: 38, high: 52, mid: 45 } },
            { number: 51, range: { low: 44, high: 61, mid: 51 } },
            { number: 39, range: { low: 34, high: 45 } },
            { number: 50, range: { low: 43, high: 58, mid: 50 } },
          ],
        },
      ],
    },
    options: {
      variant: 'football-field',
      currentValue: { value: 42, label: 'Current price 42' },
      title: 'Most valuation methods imply upside to the current share price',
      subtitle: {
        company: 'Brevinth Systems',
        measure: 'Implied equity value per share',
        period: 'July 2026',
      },
      unit: '$ per share',
      source: 'Illustrative valuation analysis',
      valueAxis: { show: true },
    },
  },
  {
    id: 'stacked-net-line-horizontal',
    title: 'Benchmark ticks mark an informative inner stack boundary',
    kind: 'example',
    data: {
      categories: [
        { id: 'north', label: 'North' },
        { id: 'south', label: 'South' },
        { id: 'east', label: 'East' },
        { id: 'west', label: 'West' },
      ],
      series: [
        { id: 'core', label: 'Core', values: [42, 38, 46, 40] },
        { id: 'growth', label: 'Growth', values: [18, 24, 16, 28] },
        { id: 'other', label: 'Other', values: [10, 8, 14, 9] },
      ],
    },
    options: {
      variant: 'stacked',
      netLine: { seriesId: 'growth' },
      grandTotalLabels: true,
      labels: { segment: true },
      title: 'Core + Growth is highest in the west',
      subtitle: { measure: 'Revenue by segment' },
      unit: '$m',
      size: { width: 720 },
      legend: 'bottom',
      source: 'Illustrative regional revenue model; the tick marks where Core + Growth ends, the figure after each bar is its total',
    },
  },
  {
    id: 'axis-break',
    title: 'Horizontal straight value-axis break compresses one 10x outlier',
    kind: 'example',
    data: {
      categories: [
        { id: 'north', label: 'North' },
        { id: 'south', label: 'South' },
        { id: 'east', label: 'East' },
        { id: 'west', label: 'West' },
        { id: 'global', label: 'Global outlier' },
      ],
      series: [{ id: 'revenue', label: 'Revenue', values: [80, 90, 75, 95, 900] }],
    },
    options: {
      title: 'The global outlier is shown without flattening regional differences',
      subtitle: { measure: 'Revenue', period: 'FY26' },
      unit: '$m',
      labelDensity: 'smart',
      rowLabels: { align: 'left' },
      sort: { categories: 'sheet' },
      valueAxis: { show: true, gridlines: true, break: { from: 150, to: 750, style: 'straight' } },
      source: 'Illustrative regional revenue set; the break spans $150m–$750m',
    },
  },
  {
    id: 'gap-after-with-connectors',
    title: 'Horizontal category group gap with stacked-series connectors',
    kind: 'example',
    data: {
      categories: [
        { id: 'actual', label: 'Actual', gapAfter: true },
        { id: 'plan', label: 'Plan' },
        { id: 'forecast', label: 'Forecast' },
      ],
      series: [
        { id: 'core', label: 'Core', values: [55, 60, 64] },
        { id: 'growth', label: 'Growth', values: [25, 28, 31] },
      ],
    },
    options: {
      variant: 'stacked',
      connectors: true,
      title: 'The plan group stays connected across a deliberate row gap',
      legend: 'bottom',
      source: 'Illustrative planning ladder; the gap separates actual from plan and forecast',
    },
  },
  {
    id: 'stacked-with-connectors-horizontal',
    title: 'Stacked bars with scoped horizontal series connectors',
    kind: 'example',
    data: {
      categories: [
        { id: 'north', label: 'North' },
        { id: 'south', label: 'South' },
        { id: 'east', label: 'East' },
        { id: 'west', label: 'West' },
      ],
      series: [
        { id: 'seriesA', label: 'Core', values: [48, 42, 55, 37] },
        { id: 'seriesB', label: 'Growth', values: [32, 38, 25, 43] },
        { id: 'seriesC', label: 'Other', values: [20, 20, 20, 20] },
      ],
    },
    options: {
      variant: 'stacked',
      connectors: { style: 'line', scope: ['seriesA'] },
      title: 'Core mix varies most across regions',
      subtitle: { measure: 'Revenue by product', period: 'FY26' },
      unit: '$m',
      legend: 'bottom',
      source: 'Illustrative regional revenue mix; connectors trace the Core series only',
    },
  },
  {
    id: 'stacked-scenario-comparison-horizontal',
    title: 'Torture: horizontal AC/PY/PL/FC stacks preserve series identity',
    kind: 'torture',
    data: {
      categories: [
        { id: 'ac', label: 'AC' },
        { id: 'py', label: 'PY' },
        { id: 'pl', label: 'PL' },
        { id: 'fc', label: 'FC' },
      ],
      series: [
        {
          id: 'core',
          label: 'Core',
          values: [
            { number: 52, scenario: 'AC' },
            { number: 49, scenario: 'PY' },
            { number: 55, scenario: 'PL' },
            { number: 54, scenario: 'FC' },
          ],
        },
        {
          id: 'growth',
          label: 'Growth',
          values: [
            { number: 31, scenario: 'AC' },
            { number: 28, scenario: 'PY' },
            { number: 35, scenario: 'PL' },
            { number: 38, scenario: 'FC' },
          ],
        },
        {
          id: 'other',
          label: 'Other',
          values: [
            { number: 17, scenario: 'AC' },
            { number: 23, scenario: 'PY' },
            { number: 10, scenario: 'PL' },
            { number: 8, scenario: 'FC' },
          ],
        },
      ],
    },
    options: {
      variant: 'stacked',
      connectors: true,
      legend: 'bottom',
      title: 'Scenario notation stays subordinate to dimension identity',
      subtitle: { measure: 'Revenue mix', period: 'FY26', scenarios: ['AC', 'PY', 'PL', 'FC'] },
      unit: '$m',
    },
  },
  {
    id: 'margin-by-brand',
    title: 'Item comparison: unit margin by brand, desc sorted, value lines',
    kind: 'example',
    data: {
      categories: [
        { id: 'brand-a', label: 'Brand A' },
        { id: 'brand-b', label: 'Brand B' },
        { id: 'our-brand', label: 'Our brand' },
        { id: 'brand-c', label: 'Brand C' },
        { id: 'brand-d', label: 'Brand D' },
        { id: 'brand-e', label: 'Brand E' },
        { id: 'brand-f', label: 'Brand F' },
      ],
      series: [
        {
          id: 'margin',
          label: 'Margin per unit',
          values: [42, 34, 28, 19, 8, -12, -15],
        },
      ],
    },
    options: {
      averageMarker: true,
      title: 'Only two brands clear the $30 margin target we set',
      subtitle: {
        company: 'Alpenrand Consumer Goods',
        measure: 'Margin per unit',
        period: 'FY25',
        scenarios: ['AC'],
      },
      unit: '$',
      source: 'Brand P&L, management accounts May 2026',
      sort: { categories: 'desc' },
      highlight: 'our-brand',
    },
    annotations: [
      { kind: 'valueLine', value: 30, label: 'Target 30' },
    ],
  },
  {
    id: 'ai-products-by-region',
    title: 'Stacked 100% bar: AI product mix by region with insight title',
    kind: 'example',
    data: {
      categories: [
        { id: 'emea', label: 'EMEA' },
        { id: 'americas', label: 'Americas' },
        { id: 'apac', label: 'APAC' },
      ],
      series: [
        { id: 'assistants', label: 'Assistants', values: [44, 38, 26] },
        { id: 'platform', label: 'Platform APIs', values: [33, 30, 24] },
        { id: 'assistant-suite', label: 'Assistant Suite', values: [23, 32, 50], colorRole: 'highlight' },
      ],
    },
    options: {
      variant: 'stacked100',
      title: 'Assistant Suite already drives half of APAC revenue',
      subtitle: {
        company: 'Software Company A',
        measure: 'Revenue share by product line',
        period: 'FY25',
        scenarios: ['AC'],
      },
      source: 'Illustrative billing data, FY25 close',
      // Every part prints its share; the 100% tick adds nothing on a chart
      // where every bar ends at 100%.
      labels: { segment: true, percentIndicator: false },
    },
  },
  {
    id: 'fourteen-rows',
    title: 'Torture: 14 rows at smart density',
    kind: 'torture',
    data: {
      categories: [
        { id: 'de', label: 'Germany' },
        { id: 'fr', label: 'France' },
        { id: 'uk', label: 'United Kingdom' },
        { id: 'it', label: 'Italy' },
        { id: 'es', label: 'Spain' },
        { id: 'pl', label: 'Poland' },
        { id: 'nl', label: 'Netherlands' },
        { id: 'be', label: 'Belgium' },
        { id: 'se', label: 'Sweden' },
        { id: 'at', label: 'Austria' },
        { id: 'ch', label: 'Switzerland' },
        { id: 'pt', label: 'Portugal' },
        { id: 'dk', label: 'Denmark' },
        { id: 'fi', label: 'Finland' },
      ],
      series: [
        {
          id: 'rev',
          label: 'Revenue',
          values: [412, 366, 341, 268, 224, 187, 165, 122, 98, 84, 71, 56, 44, 31],
        },
      ],
    },
    options: {
      title: 'Fourteen markets stay legible at smart density',
      subtitle: { measure: 'Revenue', period: 'FY25' },
      unit: '$m',
      labelDensity: 'smart',
      sort: { categories: 'desc' },
    },
  },
  {
    id: 'long-category-names',
    title: 'Torture: verbose category labels pass the 28% band cap and widen the band',
    kind: 'torture',
    data: {
      categories: [
        { id: 'c1', label: 'Global transaction banking and cross-border payment services' },
        { id: 'c2', label: 'Wealth management, private banking and family-office advisory' },
        { id: 'c3', label: 'Supercalifragilisticexpialidocious-unbreakable-product-token' },
        { id: 'c4', label: 'Retail deposits' },
        { id: 'c5', label: 'Corporate lending incl. syndicated and leveraged finance' },
      ],
      series: [{ id: 'income', label: 'Operating income', values: [842, 611, 447, 390, 236] }],
    },
    options: {
      title: 'Long divisional names wrap, and the band widens before a name is cut',
      subtitle: { measure: 'Operating income', period: 'FY25' },
      unit: '$m',
    },
  },
  {
    id: 'net-change',
    title: 'Torture: net-change bar with negatives and a bottom value axis',
    kind: 'torture',
    data: {
      categories: [
        { id: 'cloud', label: 'Cloud' },
        { id: 'security', label: 'Security' },
        { id: 'devices', label: 'Devices' },
        { id: 'services', label: 'Services' },
        { id: 'licenses', label: 'Licenses' },
        { id: 'legacy', label: 'Legacy hosting' },
      ],
      series: [
        { id: 'delta', label: 'Net change vs PY', values: [96, 31, 4, -0.6, -28, -74] },
      ],
    },
    options: {
      title: 'Cloud gains outweigh the legacy hosting decline',
      subtitle: { measure: 'Revenue change vs PY', period: 'FY25', scenarios: ['AC', 'PY'] },
      unit: '$m',
      sort: { categories: 'desc' },
      valueAxis: { show: true, gridlines: true },
    },
    annotations: [
      {
        kind: 'callout',
        at: 'services',
        // The bar prints -0.6 already; the callout says what it means.
        text: 'Services held flat',
        preferSide: 'right',
      },
    ],
  },
  {
    id: 'stacked100-slivers',
    title: 'Torture: stacked 100% with sliver segments',
    kind: 'torture',
    data: {
      categories: [
        { id: 'na', label: 'North America' },
        { id: 'eu', label: 'Europe' },
        { id: 'asia', label: 'Asia' },
        { id: 'row', label: 'Rest of world' },
      ],
      series: [
        { id: 'a', label: 'Product A', values: [55.2, 61.8, 47.5, 71.4] },
        { id: 'b', label: 'Product B', values: [41.9, 34.1, 49.6, 24.8] },
        { id: 'c', label: 'Product C', values: [1.7, 2.4, 1.2, 2.1] },
        { id: 'd', label: 'Product D', values: [1.2, 1.7, 1.7, 1.7] },
      ],
    },
    options: {
      variant: 'stacked100',
      title: 'Sliver segments hide before they overlap',
      subtitle: { measure: 'Volume share', period: 'FY25' },
      unit: 'kt',
      legend: 'bottom',
    },
  },
  {
    id: 'topn-others',
    title: 'Torture: topN with Others row and PY reference ticks',
    kind: 'torture',
    data: {
      categories: [
        { id: 'bu1', label: 'Industrial' },
        { id: 'bu2', label: 'Automotive' },
        { id: 'bu3', label: 'Aerospace' },
        { id: 'bu4', label: 'Marine' },
        { id: 'bu5', label: 'Rail' },
        { id: 'bu6', label: 'Energy' },
        { id: 'bu7', label: 'Mining' },
        { id: 'bu8', label: 'Agriculture' },
        { id: 'bu9', label: 'Construction' },
      ],
      series: [
        {
          id: 'ac',
          // The key names the actual as the scenario it is, beside the PY tick.
          label: 'AC',
          values: [188, 154, 121, 96, 44, 38, 27, 19, 12],
        },
        {
          id: 'py',
          label: 'PY',
          scenario: 'PY',
          role: 'reference',
          values: [171, 162, 104, 88, 51, 35, 31, 22, 15],
        },
      ],
    },
    options: {
      title: 'Four business units carry 80% of order intake',
      subtitle: { measure: 'Order intake', period: 'FY25', scenarios: ['AC', 'PY'] },
      unit: '$m',
      sort: { categories: 'desc' },
      topN: { n: 4, rest: true, showRestCount: true },
    },
  },
  {
    id: 'single-category',
    title: 'Torture: single category, two grouped series',
    kind: 'torture',
    data: {
      categories: [{ id: 'group', label: 'Group total' }],
      series: [
        { id: 'ac', label: 'AC', scenario: 'AC', values: [884] },
        { id: 'py', label: 'PY', scenario: 'PY', values: [791] },
      ],
    },
    options: {
      title: 'One category still lays out sanely',
      subtitle: { measure: 'Revenue', period: 'FY25', scenarios: ['AC', 'PY'] },
      unit: '$m',
      legend: 'bottom',
    },
  },
  // APPENDED, never prepended: STATIC_PINS.bar pins fixtures[0].
  {
    id: 'dcf-npv-sensitivity',
    title: 'Sensitivity tornado: seven DCF drivers around a base-case NPV',
    kind: 'example',
    data: {
      categories: [
        // The input range echo is AUTHORED on the label; the engine never
        // invents a sub-line it cannot verify against the model. A range
        // reads "7.5% to 10.5%", as the engine writes intervals.
        { id: 'wacc', label: 'WACC\n7.5% to 10.5%' },
        { id: 'revenue-growth', label: 'Revenue growth\n2% to 6% p.a.' },
        { id: 'ebitda-margin', label: 'EBITDA margin\n16% to 22%' },
        { id: 'terminal-growth', label: 'Terminal growth\n0.5% to 2.0%' },
        { id: 'capex', label: 'Capex intensity\n4% to 7% of sales' },
        { id: 'fx', label: 'EUR/USD\n1.02 to 1.18' },
        { id: 'working-capital', label: 'Working capital\n38 to 52 days' },
      ],
      series: [
        { id: 'low', label: 'Driver at low input', values: [640, 250, 300, 350, 470, 385, 430] },
        { id: 'high', label: 'Driver at high input', values: [-30, 560, 520, 465, 355, 450, 395] },
      ],
    },
    options: {
      variant: 'tornado',
      // No `label`. The flagship is the template an agent copies, and an
      // authored spine label is an assertion the engine cannot check — it
      // records as `authored-override` in the manifest even when it happens to
      // be right. Omitting it lets the engine print the number it draws, so the
      // one figure every bar is measured from is engine-derived and stays that
      // way when the model is refreshed.
      baseValue: 412,
      tornado: { low: 'low', high: 'high' },
      title: 'Equity NPV sensitivity to the main DCF drivers',
      subtitle: {
        company: 'Brevinth Systems',
        measure: 'Equity NPV',
        period: 'Base case July 2026',
      },
      unit: '$m',
      source: 'Illustrative DCF sensitivity, one driver varied at a time',
      legend: 'bottom',
      // The engine prints the OAT contract on every tornado, so the fixture
      // does not type it by hand.
    },
  },
  {
    id: 'tornado-degenerate',
    title: 'Torture: 14 drivers, a base the model does not reproduce, a dead driver and a gap',
    kind: 'torture',
    data: {
      categories: [
        { id: 'd01', label: 'Weighted average cost of capital across the consolidated group' },
        { id: 'd02', label: 'Revenue growth' },
        { id: 'd03', label: 'Gross margin' },
        { id: 'd04', label: 'Selling, general and administrative cost inflation over the plan horizon' },
        { id: 'd05', label: 'Capex' },
        { id: 'd06', label: 'Tax rate' },
        { id: 'd07', label: 'Working capital' },
        { id: 'd08', label: 'FX translation' },
        { id: 'd09', label: 'Terminal growth' },
        { id: 'd10', label: 'Churn' },
        { id: 'd11', label: 'Price realisation' },
        { id: 'd12', label: 'Headcount' },
        { id: 'd13', label: 'Energy cost' },
        { id: 'd14', label: 'Integration synergies' },
      ],
      series: [
        {
          id: 'lo',
          label: 'Low input',
          values: [95, 110, 120, 128, 132, 140, 145, 150, 155, 160, 168, 175, 120, 182],
        },
        {
          id: 'hi',
          label: 'High input',
          // d13 has no high-case output at all: the row is dropped, loudly.
          // d03 is flat: no sensitivity, which is a finding, not an error.
          values: [200, 188, 120, 172, 168, 164, 160, 158, 152, 148, 144, 140, null, 138],
        },
      ],
    },
    options: {
      variant: 'tornado',
      // Deliberately BELOW every case output: the base case is not reproduced
      // by base inputs, so every bar floats off the spine and says so.
      baseValue: 60,
      tornado: { low: 'lo', high: 'hi' },
      title: 'Every swing sits above the stated base case - the model does not reproduce it',
      unit: 'index',
      // a4, not a dashboard canvas: at 480x270 most of the 13 drivers lose
      // their name, and the subject of the exhibit is which driver matters
      // most. The torture is in the data (a base the model does not
      // reproduce, a dead driver, a flat driver), not in the canvas.
      size: 'a4',
      valueAxis: { show: true },
      legend: 'bottom',
    },
    // On a4 all 13 plotted drivers keep their name and every endpoint number
    // is drawn. The data raises 13 base-outside-swing warnings, one zero-swing
    // finding and one dropped driver.
  },
  {
    id: 'tornado-two-drivers',
    title: 'Sensitivity tornado: the two-driver case, direct labels only',
    kind: 'example',
    data: {
      categories: [
        { id: 'price', label: 'Price per unit' },
        { id: 'volume', label: 'Volume' },
      ],
      series: [
        { id: 'low', label: 'Driver at low input', values: [38.2, 42.0] },
        { id: 'high', label: 'Driver at high input', values: [52.6, 49.4] },
      ],
    },
    options: {
      variant: 'tornado',
      baseValue: 45.2,
      tornado: { low: 'low', high: 'high' },
      // The one fixture that shows the tornado's method note.
      methodNote: true,
      title: 'Price and volume ranked by their effect on EBIT',
      subtitle: { measure: 'EBIT', period: 'FY26 plan' },
      unit: '$m',
      valueAxis: { show: false },
      legend: 'bottom',
      source: 'Illustrative EBIT sensitivity; price and volume varied one at a time',
    },
  },
  {
    id: 'tornado-theme-cases',
    title: 'Sensitivity cases using an authored theme pair',
    kind: 'example',
    data: {
      categories: [{ id: 'adoption', label: 'Adoption' }, { id: 'price', label: 'Price' }, { id: 'cost', label: 'Service cost' }],
      series: [
        { id: 'low', label: 'Low input', values: [60, 90, 115] },
        { id: 'high', label: 'High input', values: [130, 140, 90] },
      ],
    },
    options: {
      variant: 'tornado',
      baseValue: 100,
      tornado: { low: 'low', high: 'high' },
      theme: { preset: 'standard', overrides: { color: { casePair: ['#8C9CAB', '#10529E'] } } },
      title: 'Adoption creates the largest sensitivity range',
      source: 'Illustrative one-at-a-time model',
      size: { width: 640, height: 430 },
    },
  },
];

const naturalHeightExample = fixtures.find((fixture) => fixture.id === 'margin-by-brand')!;
for (const [width, height] of [[1051, 352], [493, 391]] as const) {
  fixtures.splice(fixtures.findIndex((fixture) => fixture.id === 'dcf-npv-sensitivity'), 0, {
    ...naturalHeightExample,
    id: `natural-height-${width === 1051 ? 'wide' : 'narrow'}`,
    kind: width === 1051 ? 'torture' : naturalHeightExample.kind,
    title: `Automatic framing at ${width}px width and natural row height`,
    options: { ...naturalHeightExample.options, size: { width, height } },
  });
}
// textScale: every text 25 % larger; the canvas keeps its size and the rows re-flow.
fixtures.splice(fixtures.findIndex((fixture) => fixture.id === 'dcf-npv-sensitivity'), 0, {
  ...naturalHeightExample,
  id: 'text-scale-large',
  title: 'textScale 1.25 sets every text a quarter larger on the same canvas',
  kind: 'torture',
  options: { ...naturalHeightExample.options, textScale: 1.25 },
});

const solidInsideExample = fixtures.find((fixture) => fixture.id === 'ai-products-by-region')!;
for (const [mode, width, height] of [['full', 1051, 227], ['compact', 493, 216]] as const) {
  fixtures.splice(fixtures.findIndex((fixture) => fixture.id === 'dcf-npv-sensitivity'), 0, {
    ...solidInsideExample,
    id: `solid-inside-${mode}`,
    kind: 'torture',
    title: `Solid segment labels at natural height in ${mode} mode`,
    tags: ['host', mode],
    options: { ...solidInsideExample.options, mode, size: { width, height },
      canvas: { margin: { top: 0, right: 0, bottom: 0, left: 0 } } },
  });
}

fixtures.push(
  {
    // Unit rule, bar twin of column 'usd-k-precision'.
    id: 'usd-k-precision',
    title: 'Unit-aware precision: $k values from 100 up print whole, smaller values keep one decimal',
    kind: 'example',
    data: {
      categories: [
        { id: 'enterprise', label: 'Enterprise' },
        { id: 'large', label: 'Large accounts' },
        { id: 'mid', label: 'Mid-market' },
        { id: 'small', label: 'Small business' },
        { id: 'self-serve', label: 'Self-serve' },
      ],
      series: [{ id: 'revenue', label: 'Revenue per account', values: [412.5, 268.3, 145.8, 64.2, 8.9] }],
    },
    options: {
      title: 'An enterprise account brings in 1.5 times a large account',
      subtitle: { measure: 'Revenue per account', period: 'FY26' },
      unit: '$k',
      source: 'Illustrative data',
    },
  },
  {
    id: 'option-reference-line',
    title: 'Actual orders against plan with line references',
    kind: 'example',
    tags: ['feature:options'],
    data: {
      categories: [
        { id: 'q1', label: 'Q1' },
        { id: 'q2', label: 'Q2' },
        { id: 'q3', label: 'Q3' },
        { id: 'q4', label: 'Q4' },
      ],
      series: [
        { id: 'actual', label: 'Actual', values: [24, 32, 28, 38] },
        { id: 'plan', label: 'Plan', values: [30, 30, 35, 35], role: 'reference', scenario: 'PL' },
      ],
    },
    options: {
      size: { width: 960, height: 520 },
      title: 'Actual orders against plan with line references',
      source: 'Illustrative data',
      referenceStyle: 'line',
      legend: 'bottom',
      averageMarker: { scope: 'all' },
    },
  },
  {
    id: 'option-reference-marker',
    title: 'Actual orders against plan with marker references',
    kind: 'example',
    tags: ['feature:options'],
    data: {
      categories: [
        { id: 'q1', label: 'Q1' },
        { id: 'q2', label: 'Q2' },
        { id: 'q3', label: 'Q3' },
        { id: 'q4', label: 'Q4' },
      ],
      series: [
        { id: 'actual', label: 'Actual', values: [24, 32, 28, 38] },
        { id: 'plan', label: 'Plan', values: [30, 30, 35, 35], role: 'reference', scenario: 'PL' },
      ],
    },
    options: {
      size: { width: 960, height: 520 },
      title: 'Actual orders against plan with marker references',
      source: 'Illustrative data',
      referenceStyle: 'marker',
      rowLabels: { align: 'right' },
      legend: 'bottom',
    },
  },
  {
    id: 'option-dashed-connectors',
    title: 'Product mix across quarters',
    kind: 'example',
    tags: ['feature:options'],
    data: {
      categories: [
        { id: 'q1', label: 'Q1' },
        { id: 'q2', label: 'Q2' },
        { id: 'q3', label: 'Q3' },
        { id: 'q4', label: 'Q4' },
      ],
      series: [
        { id: 'core', label: 'Core', values: [40, 45, 35, 50] },
        { id: 'new', label: 'New', values: [20, 25, 30, 25] },
      ],
    },
    options: {
      size: { width: 960, height: 520 },
      title: 'Product mix across quarters',
      source: 'Illustrative data',
      variant: 'stacked',
      connectors: { style: 'dashed', scope: 'all' },
      legend: 'bottom',
    },
  },
  {
    id: 'plan-corridor',
    title: 'Horizontal plan corridor on regional revenue',
    kind: 'example',
    tags: ['annotation'],
    data: {
      categories: [
        { id: 'amer', label: 'AMER' },
        { id: 'emea', label: 'EMEA' },
        { id: 'apac', label: 'APAC' },
      ],
      series: [{ id: 'rev', label: 'Revenue', values: [48, 41, 36] }],
    },
    options: {
      title: 'AMER is the only region above the plan corridor',
      subtitle: { measure: 'Revenue', period: 'FY25', scenarios: ['AC', 'PL'] },
      unit: '$m',
      source: 'Illustrative regional plan corridor',
    },
    annotations: [
      { kind: 'band', id: 'plan', style: 'corridor', low: 38, high: 46, scenario: 'PL', label: 'Plan' },
    ],
  },
  {
    id: 'grouped-cloud-cagr',
    title: 'Grouped bars with a series CAGR arrow and last-year difference',
    kind: 'example',
    data: {
      categories: [
        { id: 'fy21', label: 'FY21', date: '2021-12-31' },
        { id: 'fy22', label: 'FY22', date: '2022-12-31' },
        { id: 'fy23', label: 'FY23', date: '2023-12-31' },
        { id: 'fy24', label: 'FY24', date: '2024-12-31' },
      ],
      series: [
        { id: 'cloud', label: 'Cloud', colorRole: 'highlight', values: [100, 130, 160, 200] },
        { id: 'license', label: 'License', values: [124, 118, 109, 97] },
      ],
    },
    options: {
      variant: 'grouped',
      title: 'Cloud doubles in three years while license declines',
      subtitle: { measure: 'Revenue', period: 'FY21–FY24' },
      unit: '$m',
      source: 'Illustrative accounts',
    },
    annotations: [
      {
        kind: 'cagr',
        from: { categoryId: 'fy21', seriesId: 'cloud' },
        to: { categoryId: 'fy24', seriesId: 'cloud' },
      },
      {
        kind: 'diff',
        mode: 'absolute',
        from: { categoryId: 'fy24', seriesId: 'license' },
        to: { categoryId: 'fy24', seriesId: 'cloud' },
      },
    ],
  },
);

const toleranceFixture = fixtures.find(fixture => fixture.id === 'plan-corridor')!;
fixtures.push({
  ...toleranceFixture,
  id: 'tolerance-band',
  title: 'Regional values against an authored tolerance band',
  options: { ...toleranceFixture.options, title: 'EMEA falls within the 38 to 46 tolerance band' },
  annotations: [{ kind: 'band', id: 'tolerance', style: 'tolerance', low: 38, high: 46, label: 'Tolerance' }],
});

// A dashboard slot 380px wide; a bar's height still comes from its rows.
fixtures.push({
  id: 'bar-compact-380',
  title: 'Bar in a 380px dashboard column',
  kind: 'example',
  data: {
    categories: [
      { id: 'search', label: 'Search' }, { id: 'social', label: 'Social' },
      { id: 'email', label: 'Email' }, { id: 'direct', label: 'Direct' },
    ],
    series: [{ id: 'spend', label: 'Spend', values: [420, 310, 180, 95] }],
  },
  options: {
    title: 'Search takes two fifths of spend',
    unit: '$k',
    size: { width: 380, height: 300 },
  },
});

// Long names at a generous size read whole: the rendered SVG has no ellipsis.
fixtures.push({
  id: 'torture-long-labels',
  title: 'Torture: long names at a generous size read whole, never cut',
  kind: 'torture',
  data: {
    categories: [
      {
        id: 'brand-a',
        label: 'Enterprise cloud infrastructure, managed hosting and sovereign data-centre services for regulated clients',
      },
      {
        id: 'brand-b',
        label: 'Consumer electronics, wearables and connected home devices sold through retail partners',
      },
      {
        id: 'our-brand',
        label: 'Industrial automation, robotics and predictive maintenance contracts in continental Europe',
      },
      {
        id: 'brand-c',
        label: 'Healthcare diagnostics, laboratory information systems and point-of-care testing',
      },
      {
        id: 'brand-d',
        label: 'Wealth management, private banking and family-office advisory for entrepreneurs',
      },
      {
        id: 'brand-e',
        label: 'Retail deposits and everyday current accounts for households and sole traders',
      },
      {
        id: 'brand-f',
        label: 'Corporate lending incl. syndicated, leveraged and sustainability-linked finance',
      },
    ],
    series: [{ id: 'margin', label: 'Margin per unit', values: [42, 34, 28, 19, 8, -12, -15] }],
  },
  options: {
    averageMarker: true,
    title: 'Long names read whole at a generous size',
    subtitle: {
      company: 'Alpenrand Consumer Goods',
      measure: 'Margin per unit',
      period: 'FY25',
      scenarios: ['AC'],
    },
    unit: '$',
    source: 'Brand P&L, management accounts May 2026',
    sort: { categories: 'desc' },
    highlight: 'our-brand',
    size: { width: 1440, height: 900 },
  },
  annotations: [{ kind: 'valueLine', value: 30, label: 'Target 30' }],
});

// the bars a highlight leaves behind in a quiet rest colour of their
// own, with no outline, and every value past its bar end.
fixtures.push({
  id: 'option-rest-muted',
  title: 'The rest of the bars in a muted rest colour, values past the bar ends',
  kind: 'example',
  tags: ['feature:options'],
  data: {
    categories: [
      { id: 'brand-a', label: 'Brand A' },
      { id: 'brand-b', label: 'Brand B' },
      { id: 'our-brand', label: 'Our brand' },
      { id: 'brand-c', label: 'Brand C' },
      { id: 'brand-d', label: 'Brand D' },
    ],
    series: [{ id: 'margin', label: 'Margin per unit', values: [42, 34, 28, 19, 8] }],
  },
  options: {
    theme: {
      preset: 'boardroom',
      overrides: { color: { focus: '#0D2A43', rest: '#C9CDD2' }, marks: { restOutline: false, barLabels: 'outside' } },
    },
    highlight: 'our-brand',
    title: 'Our brand sits mid-field on unit margin',
    subtitle: { measure: 'Margin per unit', period: 'FY25' },
    unit: '$',
    source: 'Illustrative brand P&L',
  },
});

// the Others bar in a fill of its own (color.othersMark, apart from the
// grounds color.others paints) and with no outline round the pale fill.
fixtures.push({
  id: 'option-others-mark',
  title: 'The Others bar in its own fill, with no outline',
  kind: 'example',
  tags: ['feature:options'],
  data: {
    categories: [
      { id: 'bu1', label: 'Industrial' },
      { id: 'bu2', label: 'Automotive' },
      { id: 'bu3', label: 'Aerospace' },
      { id: 'bu4', label: 'Marine' },
      { id: 'bu5', label: 'Rail' },
      { id: 'bu6', label: 'Energy' },
    ],
    series: [{ id: 'ac', label: 'AC', values: [188, 154, 121, 96, 44, 38] }],
  },
  options: {
    theme: {
      preset: 'standard',
      overrides: { color: { othersMark: '#E3E1DB' }, marks: { othersOutline: false } },
    },
    topN: { n: 3, rest: true },
    sort: { categories: 'desc' },
    title: 'Three business units carry most of the order intake',
    subtitle: { measure: 'Order intake', period: 'FY25' },
    unit: '$m',
    source: 'Illustrative management accounts',
  },
});

// a Rest series (colorRole 'others') in a stack. Its values print on
// every target but the dashboard, where the hover card and the note carry them.
fixtures.push({
  id: 'stacked-rest-series',
  title: 'A stacked bar with a Rest series whose values the dashboard leaves unprinted',
  kind: 'example',
  tags: ['feature:options'],
  data: {
    categories: [
      { id: 'de', label: 'Germany' },
      { id: 'fr', label: 'France' },
      { id: 'it', label: 'Italy' },
    ],
    series: [
      { id: 'search', label: 'Search', values: [42, 35, 28] },
      { id: 'social', label: 'Social', values: [28, 22, 19] },
      { id: 'rest', label: 'Rest', colorRole: 'others', values: [14, 11, 9] },
    ],
  },
  options: {
    variant: 'stacked',
    title: 'Search and Social carry the spend in every market',
    subtitle: { measure: 'Spend', period: 'FY25' },
    unit: '$k',
    legend: 'bottom',
    source: 'Illustrative media plan',
  },
});

// the prior-year mark a reader must find. The generic
// reference tick is 1.6 px in the ink; this one is the same mark at the
// authored 2 px in the highlight.
fixtures.push({
  id: 'option-reference-tick-highlight',
  title: 'Prior-year ticks at 2 px in the highlight',
  kind: 'example',
  tags: ['feature:options'],
  data: {
    categories: [
      { id: 'de', label: 'Germany' },
      { id: 'uk', label: 'United Kingdom' },
      { id: 'fr', label: 'France' },
      { id: 'nl', label: 'Netherlands' },
      { id: 'se', label: 'Sweden' },
    ],
    series: [
      { id: 'ac', label: 'This year', values: [128, 96, 84, 52, 41] },
      { id: 'py', label: 'Prior year', values: [117, 104, 78, 49, 44], role: 'reference', scenario: 'PY' },
    ],
  },
  options: {
    referenceStyle: 'tick',
    referenceTick: { width: 2, color: 'highlight' },
    title: 'Germany leads the growth; the UK and Sweden end short of their prior year',
    subtitle: { measure: 'Revenue by market', period: 'FY26', scenarios: ['AC', 'PY'] },
    unit: '\u20acm',
    source: 'Illustrative management accounts',
  },
});

// two colour jobs, two roles. The highlighted bar takes color.focus,
// here the ink, and the prior-year ticks keep color.highlight, the accent the
// chart reserves for the one mark a reader must find.
fixtures.push({
  id: 'option-focus-ink',
  title: 'The highlighted bar in the ink, the prior-year ticks in the accent',
  kind: 'example',
  tags: ['feature:options'],
  data: {
    categories: [
      { id: 'de', label: 'Germany' },
      { id: 'uk', label: 'United Kingdom' },
      { id: 'fr', label: 'France' },
      { id: 'nl', label: 'Netherlands' },
      { id: 'se', label: 'Sweden' },
    ],
    series: [
      { id: 'ac', label: 'This year', values: [128, 96, 84, 52, 41] },
      { id: 'py', label: 'Prior year', values: [117, 104, 78, 49, 44], role: 'reference', scenario: 'PY' },
    ],
  },
  options: {
    theme: { preset: 'boardroom', overrides: { color: { focus: '#0D2A43' } } },
    highlight: 'de',
    referenceStyle: 'tick',
    referenceTick: { width: 2, color: 'highlight' },
    title: 'Germany carries the year against its prior',
    subtitle: { measure: 'Revenue by market', period: 'FY26', scenarios: ['AC', 'PY'] },
    unit: '\u20acm',
    source: 'Illustrative management accounts',
  },
});

/**
 * A theme's fixed bar row: 12 px bars on a 24 px pitch. The canvas
 * is far taller than nine rows need; the rows keep their pitch, the chart
 * draws at the top and the rest of the canvas stays empty.
 */
fixtures.push({
  id: 'fixed-row-pitch',
  title: 'A theme fixes the bar row at 12 on 24 px, and a tall canvas does not stretch it',
  kind: 'example',
  tags: ['feature:theme'],
  data: {
    categories: [
      { id: 'nl', label: 'Netherlands' },
      { id: 'de', label: 'Germany' },
      { id: 'fr', label: 'France' },
      { id: 'uk', label: 'United Kingdom' },
      { id: 'es', label: 'Spain' },
      { id: 'it', label: 'Italy' },
      { id: 'se', label: 'Sweden' },
      { id: 'at', label: 'Austria' },
      { id: 'ch', label: 'Switzerland' },
    ],
    series: [{ id: 'growth', label: 'Growth vs prior year', values: [18.4, 12.1, 9.6, 7.2, 4.8, 2.5, -1.3, -3.9, -6.2] }],
  },
  options: {
    theme: { preset: 'standard', overrides: { space: { barRow: { thickness: 12, pitch: 24 } } } },
    title: 'The Netherlands grew fastest; three markets shrank',
    subtitle: { measure: 'Net revenue growth vs prior year', period: 'FY26 YTD' },
    format: '+1.1%',
    source: 'Illustrative management accounts',
    size: { width: 560, height: 520 },
  },
});

/**
 * A theme's solid, muted plan look: the plan bars draw in the muted
 * ink at 35 % with no outline, where the notation look draws an outline.
 */
fixtures.push({
  id: 'plan-solid-muted',
  title: 'A theme draws the plan bars solid and muted instead of outlined',
  kind: 'example',
  tags: ['feature:theme'],
  data: {
    categories: [
      { id: 'de', label: 'Germany' },
      { id: 'uk', label: 'United Kingdom' },
      { id: 'fr', label: 'France' },
      { id: 'nl', label: 'Netherlands' },
    ],
    series: [
      { id: 'ac', label: 'Actual', values: [128, 96, 84, 52] },
      { id: 'pl', label: 'Plan', values: [120, 104, 80, 60], scenario: 'PL' },
    ],
  },
  options: {
    theme: { preset: 'standard', overrides: { scenario: { PL: 'solidMuted' } } },
    variant: 'grouped',
    legend: 'top',
    title: 'Germany and France beat plan, the UK and the Netherlands fall short',
    subtitle: { measure: 'Revenue by market', period: 'FY26', scenarios: ['AC', 'PL'] },
    unit: '\u20acm',
    source: 'Illustrative management accounts',
  },
});

// A drawn value axis carries its title under the tick row.
fixtures.push({
  id: 'margin-axis-title',
  title: 'Bars on a titled value axis',
  kind: 'example',
  data: {
    categories: [
      { id: 'brand-a', label: 'Brand A' },
      { id: 'brand-b', label: 'Brand B' },
      { id: 'brand-c', label: 'Brand C' },
      { id: 'brand-d', label: 'Brand D' },
    ],
    series: [{ id: 'margin', label: 'Margin', values: [42, 34, 19, 8] }],
  },
  options: {
    axisTitles: { primary: 'Margin, %' },
    valueAxis: { show: true },
    title: 'Brand A earns the widest margin',
    subtitle: { measure: 'Margin', period: 'FY25' },
    source: 'Illustrative brand P&L',
  },
});

// signColor and colorblindSafe, as on column: gains and losses painted by sign,
// then the same bars in the colour-vision-safe pair.
const signedMarkets: RangeChartData = {
  categories: [
    { id: 'de', label: 'Germany' },
    { id: 'uk', label: 'United Kingdom' },
    { id: 'fr', label: 'France' },
    { id: 'nl', label: 'Netherlands' },
    { id: 'se', label: 'Sweden' },
    { id: 'it', label: 'Italy' },
  ],
  series: [{ id: 'delta', label: 'Revenue vs prior year', values: [14, 9, -6, 4, -11, 2] }],
};
const signedMarketOptions: BarOptions = {
  signColor: true,
  sort: { categories: 'desc' },
  title: 'Four markets grow on the prior year while France and Sweden shrink',
  subtitle: { measure: 'Revenue change vs PY', period: 'FY26' },
  unit: '$m',
  source: 'Illustrative management accounts',
};
fixtures.push(
  {
    id: 'option-sign-color',
    title: 'Revenue change by market, each bar painted by its sign',
    kind: 'example',
    tags: ['feature:options'],
    data: signedMarkets,
    options: signedMarketOptions,
  },
  {
    id: 'option-sign-color-colorblind',
    title: 'Revenue change by market in the colour-vision-safe sign pair',
    kind: 'example',
    tags: ['feature:options'],
    data: signedMarkets,
    options: { ...signedMarketOptions, colorblindSafe: true },
  },
);

// The tornado base case in its object form, named on the spine.
const npvSensitivity = fixtures.find((fixture) => fixture.id === 'dcf-npv-sensitivity')!;
fixtures.push({
  ...npvSensitivity,
  id: 'tornado-named-base-case',
  title: 'A tornado whose spine names its base case',
  tags: ['coverage'],
  options: { ...npvSensitivity.options, baseValue: { value: 412, label: 'Base case' } },
});

fixtures.push({
  // a zero segment prints no label and takes no share-row seat.
  id: 'stacked100-zero-segment',
  title: 'Torture: stacked 100% with a zero segment',
  kind: 'torture',
  data: {
    categories: [
      { id: 'north', label: 'North' },
      { id: 'south', label: 'South' },
      { id: 'east', label: 'East' },
    ],
    series: [
      { id: 'online', label: 'Online', values: [52, 61, 44] },
      { id: 'store', label: 'Store', values: [48, 0, 36] },
      { id: 'partner', label: 'Partner', values: [0, 39, 20] },
    ],
  },
  options: {
    variant: 'stacked100',
    title: 'Partner sells nothing in the North',
    subtitle: { measure: 'Order share', period: 'Q3' },
    legend: 'bottom',
  },
});

// a width alone; the bar takes the height its rows need at that width.
fixtures.push({
  id: 'width-only-natural-height',
  title: 'A width-only size: the bar takes its own height',
  kind: 'example',
  tags: ['feature:options'],
  data: {
    categories: [
      { id: 'north', label: 'North' },
      { id: 'south', label: 'South' },
      { id: 'east', label: 'East' },
      { id: 'west', label: 'West' },
    ],
    series: [{ id: 'orders', label: 'Orders', values: [412, 388, 305, 251] }],
  },
  options: {
    size: { width: 760 },
    title: 'North leads orders by a narrow margin',
    subtitle: { measure: 'Orders', period: 'Q3' },
    unit: 'k',
    source: 'Synthetic regional orders',
  },
});

// a ranked list fills a portrait print page (column/target-* show the other targets).
fixtures.push({
  id: 'target-print-a4-portrait', title: 'The print target on the A4 portrait content preset', kind: 'example',
  data: {
    categories: ['Germany', 'France', 'Italy', 'Spain', 'Netherlands', 'Poland', 'Sweden', 'Belgium', 'Austria', 'Denmark']
      .map((label) => ({ id: label.toLowerCase(), label })),
    series: [{ id: 'orders', label: 'Orders', values: [412, 356, 298, 251, 187, 164, 131, 118, 97, 84] }],
  },
  options: {
    title: 'Germany and France lead orders by a wide margin', subtitle: { measure: 'Orders', period: 'FY26' }, unit: 'k',
    source: 'Synthetic regional orders', target: 'print', size: 'a4-portrait-content',
  },
});

// Authored note strings for incomplete stacks (one fixture per string option).
fixtures.push({
  id: 'stacked-incomplete-custom-note', title: 'Custom note for an incomplete stack', kind: 'example', tags: ['coverage'],
  data: {
    categories: [{ id: 'q1', label: 'Q1' }, { id: 'q2', label: 'Q2' }, { id: 'q3', label: 'Q3' }],
    series: [
      { id: 'hardware', label: 'Hardware', values: [42, null, 47] },
      { id: 'services', label: 'Services', values: [28, 31, 33] },
    ],
  },
  options: {
    variant: 'stacked', title: 'Q2 hardware revenue is not reported yet', unit: 'k',
    strings: { incompleteStacks: '{categories}: stack incomplete; a missing part is not drawn.' },
    // The custom wording prints only where the disclosures print.
    notes: { show: ['note', 'disclosure'] },
  },
}, {
  id: 'stacked100-known-parts-custom-note', title: 'Custom note for shares of known parts', kind: 'example', tags: ['coverage'],
  data: {
    categories: [{ id: 'north', label: 'North' }, { id: 'south', label: 'South' }, { id: 'west', label: 'West' }],
    series: [
      { id: 'online', label: 'Online', values: [55, 48, null] },
      { id: 'retail', label: 'Retail', values: [45, 52, 61] },
    ],
  },
  options: {
    variant: 'stacked100', title: 'West reports retail only',
    strings: { knownPartsShares: '{categories}: shares of the reported channels only.' },
    // The custom wording prints only where the disclosures print.
    notes: { show: ['note', 'disclosure'] },
  },
});

// a ranking prints its top and bottom value; the axis reads the rest.
fixtures.push({
  id: 'option-value-labels-ends', title: 'A ranking prints its first and last value (valueLabels ends)', kind: 'example', tags: ['feature:options'],
  data: {
    categories: ['North', 'Coast', 'Lakes', 'Hills', 'Plains', 'Delta', 'Valley', 'Forest', 'Harbour', 'Ridge'].map((label) => ({ id: label.toLowerCase(), label })),
    series: [{ id: 'stores', label: 'Stores', values: [148, 131, 119, 104, 97, 88, 76, 64, 51, 37] }],
  },
  options: { title: 'North has four times the stores of Ridge', valueLabels: 'ends', source: 'Illustrative data' },
});

// One small demo per remaining valueLabels choice (fixture-enum-coverage).
const valueLabelsTeams = {
  categories: ['Sales', 'Service', 'Product', 'Finance', 'People', 'Legal'].map((label) => ({ id: label.toLowerCase(), label })),
  series: [{ id: 'score', label: 'Score', values: [78, 71, 66, 59, 64, 52] }],
};
for (const [mode, title] of [['last', 'Only the last team prints its value'], ['extremes', 'The first, last, highest and lowest team print their values'], ['none', 'No value prints; the axis reads every bar'], ['all', 'Every team prints its value']] as const) {
  fixtures.push({
    id: `option-value-labels-${mode}`, title: `${title} (valueLabels ${mode})`, kind: 'torture', tags: ['feature:options'],
    data: valueLabelsTeams,
    options: { title: 'Sales leads the engagement scores', valueLabels: mode, source: 'Illustrative data' },
  });
}

// One demo per smallValues mode: a rate far below the series' last shown digit (fixture-enum-coverage).
const smallRates = {
  categories: ['Berlin', 'Lyon', 'Porto', 'Turku'].map((label) => ({ id: label.toLowerCase(), label })),
  series: [{ id: 'errors', label: 'Error rate', values: [0.042, 0.018, 0.0062, 0.0000012] }],
};
for (const [mode, title] of [['bound', 'Turku prints its bound (smallValues bound)'], ['zero', 'Turku prints the series format (smallValues zero)'], ['scientific', 'Turku prints a power of ten (smallValues scientific)'], ['p-value', 'Every rate prints as an APA p-value (smallValues p-value)']] as const) {
  fixtures.push({
    id: `option-small-values-${mode}`, title, kind: mode === 'bound' ? 'example' : 'torture', tags: ['feature:options'],
    data: smallRates,
    options: { title: 'Berlin has the highest error rate', smallValues: mode, source: 'Illustrative data' },
  });
}

registerFixtures('bar', fixtures);
