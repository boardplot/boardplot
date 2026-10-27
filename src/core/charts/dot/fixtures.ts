/**
 * Dot-family fixtures: consulting-grade examples (dumbbell peer range,
 * Cleveland dot ranking, lollipop counts) + torture set
 * (16 rows × 2 series, zero-gap dumbbell, verbose labels, negatives with a
 * gridlined axis). Every fixture auto-enters the invariant suite.
 */

import { registerFixtures } from '../../../fixtures/registry';
import type { Fixture } from '../../registry';
import type { RangeChartData } from '../../types/data';
import type { DotOptions } from '../../types/options';

export const fixtures: Fixture<RangeChartData, DotOptions>[] = [
  {
    id: 'dot-range-benchmark',
    title: 'Benchmark dots with peer-range bands',
    kind: 'example',
    tags: ['interaction'],
    hover: { owner: { categoryId: 'north', seriesId: 'margin' } },
    data: {
      categories: [
        { id: 'north', label: 'North' },
        { id: 'west', label: 'West' },
        { id: 'central', label: 'Central' },
        { id: 'south', label: 'South' },
        { id: 'east', label: 'East' },
      ],
      series: [
        {
          id: 'margin',
          label: 'Our margin',
          values: [
            { number: 28, range: { low: 24, high: 32, mid: 27 } },
            { number: 25, range: { low: 21, high: 30 } },
            { number: 23, range: { low: 20, high: 27, mid: 24 } },
            { number: 20, range: { low: 17, high: 24 } },
            { number: 18, range: { low: 15, high: 22, mid: 19 } },
          ],
        },
      ],
    },
    options: {
      title: 'North leads while every region remains within its peer range',
      subtitle: {
        company: 'Brevinth Consumer',
        measure: 'EBIT margin with peer benchmark range',
        period: 'FY26',
      },
      unit: '%',
      valueAxis: { show: true },
      axisTitles: { primary: 'Margin, %' },
      source: 'Illustrative peer benchmark set',
      sort: { categories: 'desc' },
      // The key names the interval and the caps print their bounds.
      // shortcut: drop the cast once DotOptions.range declares midLabel (types/options.ts).
      range: { label: 'Peer range, min to max', values: true, midLabel: 'Peer midpoint' } as DotOptions['range'],
    },
  },
  {
    id: 'share-shift-dumbbell',
    title: 'Dumbbell peer range: market share 2019 vs 2024 by country, sorted by gap',
    kind: 'example',
    data: {
      categories: [
        { id: 'de', label: 'Germany' },
        { id: 'fr', label: 'France' },
        { id: 'uk', label: 'United Kingdom' },
        { id: 'it', label: 'Italy' },
        { id: 'es', label: 'Spain' },
        { id: 'pl', label: 'Poland' },
      ],
      series: [
        { id: 'y2019', label: '2019', scenario: 'PY', values: [23.0, 18.9, 24.1, 15.2, 13.8, 9.6] },
        { id: 'y2024', label: '2024', scenario: 'AC', values: [27.9, 22.4, 19.8, 21.7, 12.1, 18.3] },
      ],
    },
    options: {
      variant: 'dumbbell',
      title: 'Poland nearly doubled its share while the UK and Spain lost ground',
      subtitle: {
        company: 'Brevinth Devices',
        measure: 'Market share',
        period: '2019 vs 2024',
        scenarios: ['PY', 'AC'],
      },
      unit: '% of units',
      source: 'Illustrative sell-through panel, FY2019 and FY2024',
      sort: { categories: 'desc' },
    },
    annotations: [
      // median of the 2024 values (12.1, 18.3, 19.8, 21.7, 22.4, 27.9)
      { kind: 'valueLine', value: 20.75, label: 'Median 2024' },
    ],
  },
  {
    id: 'share-shift-arrow',
    title: 'Dumbbell arrows: the change from 2019 to 2024, painted by its sign against the declared direction',
    kind: 'example',
    data: {
      categories: [
        { id: 'de', label: 'Germany' },
        { id: 'fr', label: 'France' },
        { id: 'uk', label: 'United Kingdom' },
        { id: 'it', label: 'Italy' },
        { id: 'es', label: 'Spain' },
        { id: 'pl', label: 'Poland' },
      ],
      series: [
        { id: 'y2019', label: '2019', scenario: 'PY', values: [23.0, 18.9, 24.1, 15.2, 13.8, 9.6] },
        { id: 'y2024', label: '2024', scenario: 'AC', direction: 'higherIsBetter', values: [27.9, 22.4, 19.8, 21.7, 12.1, 18.3] },
      ],
    },
    options: {
      variant: 'dumbbell',
      arrow: true,
      title: 'Poland nearly doubled its share while the UK and Spain lost ground',
      subtitle: {
        company: 'Brevinth Devices',
        measure: 'Market share',
        period: '2019 vs 2024',
        scenarios: ['PY', 'AC'],
      },
      unit: '% of units',
      source: 'Illustrative sell-through panel, FY2019 and FY2024',
      sort: { categories: 'desc' },
      legend: 'bottom',
    },
  },
  {
    id: 'nps-dot-ranking',
    title: 'Cleveland dot ranking: NPS by business unit (non-zero baseline info)',
    kind: 'example',
    data: {
      categories: [
        { id: 'payments', label: 'Payments' },
        { id: 'retail', label: 'Retail Banking' },
        { id: 'wealth', label: 'Wealth' },
        { id: 'insurance', label: 'Insurance' },
        { id: 'sme', label: 'SME Lending' },
        { id: 'corporate', label: 'Corporate' },
      ],
      series: [{ id: 'nps', label: 'NPS', values: [61, 48, 44, 37, 29, 22] }],
    },
    options: {
      title: 'Payments sets the NPS benchmark; Corporate trails by 39 points',
      subtitle: {
        company: 'Company A',
        measure: 'Net Promoter Score',
        period: 'H1 2026 relationship survey',
        scenarios: ['AC'],
      },
      unit: 'NPS',
      source: 'Illustrative customer survey, May 2026',
      sort: { categories: 'desc' },
      highlight: 'payments',
    },
    // Measured against Payments' dot, which the label then names.
    annotations: [{ kind: 'delta', at: { categoryId: 'corporate' }, vs: { categoryId: 'payments' } }],
  },
  {
    id: 'audit-findings-lollipop',
    title: 'Lollipop counts: audit findings by plant',
    kind: 'example',
    data: {
      categories: [
        { id: 'gdansk', label: 'Gdańsk' },
        { id: 'lyon', label: 'Lyon' },
        { id: 'porto', label: 'Porto' },
        { id: 'brno', label: 'Brno' },
        { id: 'leeds', label: 'Leeds' },
        { id: 'turin', label: 'Turin' },
      ],
      series: [{ id: 'findings', label: 'Audit findings', values: [23, 17, 12, 9, 6, 4] }],
    },
    options: {
      variant: 'lollipop',
      title: 'Two plants account for over half of all audit findings',
      subtitle: {
        company: 'Company A',
        measure: 'Open audit findings',
        period: 'FY26 internal audit cycle',
        scenarios: ['AC'],
      },
      unit: 'findings',
      source: 'Group internal audit tracker, June 2026',
      sort: { categories: 'desc' },
    },
  },
  {
    id: 'sixteen-rows-two-series',
    title: 'Torture: 16 rows × 2 grouped dot series at smart density',
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
        { id: 'no', label: 'Norway' },
        { id: 'ie', label: 'Ireland' },
      ],
      series: [
        {
          id: 'ac',
          label: 'AC',
          scenario: 'AC',
          values: [74, 71, 69, 66, 64, 61, 58, 55, 53, 51, 48, 45, 41, 38, 34, 29],
        },
        {
          id: 'py',
          label: 'PY',
          scenario: 'PY',
          values: [70, 73, 64, 61, 66, 52, 55, 51, 55, 46, 49, 41, 43, 33, 35, 31],
        },
      ],
    },
    options: {
      title: 'Sixteen markets with AC and PY dots stay legible',
      subtitle: { measure: 'On-time delivery', period: 'FY26 YTD', scenarios: ['AC', 'PY'] },
      unit: '%',
      labelDensity: 'smart',
      legend: 'bottom',
    },
  },
  {
    id: 'zero-gap-dumbbell',
    title:
      'Torture: dumbbell with identical and near-identical values — touching dots merge into one «a → b» label',
    kind: 'torture',
    data: {
      categories: [
        { id: 'alpha', label: 'Alpha' },
        { id: 'beta', label: 'Beta' },
        { id: 'gamma', label: 'Gamma' },
        { id: 'delta', label: 'Delta' },
        { id: 'epsilon', label: 'Epsilon' },
        { id: 'zeta', label: 'Zeta' },
      ],
      series: [
        // alpha/beta/gamma tie exactly (zero gap), zeta nearly touches
        // (sub-diameter gap) — all four take the merged «a → b» label;
        // delta and epsilon stay wide enough for two separate labels.
        { id: 'before', label: 'Before', values: [40, 55, 31, 62, 48, 50] },
        { id: 'after', label: 'After', values: [40, 55, 31, 63.5, 45, 50.3] },
      ],
    },
    options: {
      variant: 'dumbbell',
      title: 'Four of six programs show virtually no movement',
      subtitle: { measure: 'Utilization', period: 'Pre vs post pilot' },
      unit: '%',
      sort: { categories: 'asc' },
      legend: 'bottom',
    },
  },
  {
    id: 'long-labels-lollipop',
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
      series: [{ id: 'complaints', label: 'Complaints', values: [412, 265, 190, 122, 87] }],
    },
    options: {
      variant: 'lollipop',
      title: 'Long divisional names wrap, and the band widens before a name is cut',
      subtitle: { measure: 'Customer complaints', period: 'FY26 YTD' },
      unit: 'cases',
      sort: { categories: 'desc' },
    },
  },
  {
    id: 'negatives-with-axis',
    title: 'Torture: negative values with a gridlined value axis and zero baseline',
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
        { id: 'delta-py', label: 'Δ vs PY', values: [9.6, 3.1, 0.4, -0.6, -2.8, -7.4] },
      ],
    },
    options: {
      title: 'Cloud growth outweighs the legacy hosting decline',
      subtitle: { measure: 'Revenue growth vs PY', period: 'FY26', scenarios: ['AC', 'PY'] },
      unit: 'pp',
      sort: { categories: 'desc' },
      valueAxis: { show: true, gridlines: true },
    },
    annotations: [
      { kind: 'callout', at: 'services', text: 'Held flat: ${value}', preferSide: 'right' },
    ],
  },
  {
    id: 'range-extremes',
    title: 'Torture: zero-width and far-outside dot ranges',
    kind: 'torture',
    data: {
      categories: [
        { id: 'zero', label: 'Zero-width interval' },
        { id: 'far', label: 'Far-outside interval' },
      ],
      series: [
        {
          id: 'value',
          label: 'Value',
          values: [
            { number: 25, range: { low: 25, high: 25, mid: 25 } },
            { number: 30, range: { low: -180, high: 260, mid: 30 } },
          ],
        },
      ],
    },
    options: {
      // The one fixture that shows the range mid-point note.
      methodNote: true,
      title: 'Degenerate and extreme ranges remain explicit',
      subtitle: { measure: 'Stress range', period: 'Synthetic torture input' },
      valueAxis: { show: true, gridlines: true },
    },
  },
];

export const invertedRangeTorture: RangeChartData = {
  categories: [{ id: 'inverted', label: 'Inverted interval' }],
  series: [
    {
      id: 'value',
      values: [{ number: 10, range: { low: 14, high: 6 } }],
    },
  ],
};

// Long names at a generous size read whole. The rendered SVG has no ellipsis.
fixtures.push({
  id: 'torture-long-labels',
  title: 'Torture: long names at a generous size read whole, never cut',
  kind: 'torture',
  data: {
    categories: [
      {
        id: 'payments',
        label: 'Enterprise cloud infrastructure, managed hosting and sovereign data-centre services for regulated clients',
      },
      {
        id: 'retail',
        label: 'Consumer electronics, wearables and connected home devices sold through retail partners',
      },
      {
        id: 'wealth',
        label: 'Industrial automation, robotics and predictive maintenance contracts in continental Europe',
      },
      {
        id: 'insurance',
        label: 'Healthcare diagnostics, laboratory information systems and point-of-care testing',
      },
      {
        id: 'sme',
        label: 'Wealth management, private banking and family-office advisory for entrepreneurs',
      },
      {
        id: 'corporate',
        label: 'Retail deposits and everyday current accounts for households and sole traders',
      },
    ],
    series: [{ id: 'nps', label: 'NPS', values: [61, 48, 44, 37, 29, 22] }],
  },
  options: {
    title: 'Long names read whole at a generous size',
    subtitle: {
      company: 'Company A',
      measure: 'Net Promoter Score',
      period: 'H1 2026 relationship survey',
      scenarios: ['AC'],
    },
    unit: 'NPS',
    source: 'Illustrative customer survey, May 2026',
    sort: { categories: 'desc' },
    highlight: 'payments',
    size: { width: 1440, height: 900 },
  },
  // Measured against Payments' dot, which the label then names.
  annotations: [{ kind: 'delta', at: { categoryId: 'corporate' }, vs: { categoryId: 'payments' } }],
});

// The average marker, as on bar and column.
fixtures.push({
  id: 'average-marker-lead-times',
  title: 'Cleveland dots with the average of every dot as a dashed Average rule',
  kind: 'example',
  tags: ['feature:options'],
  data: {
    categories: [
      { id: 'north', label: 'Plant North' },
      { id: 'east', label: 'Plant East' },
      { id: 'harbour', label: 'Plant Harbour' },
      { id: 'valley', label: 'Plant Valley' },
      { id: 'south', label: 'Plant South' },
      { id: 'west', label: 'Plant West' },
      { id: 'ridge', label: 'Plant Ridge' },
    ],
    series: [{ id: 'lead', label: 'Lead time', values: [12.4, 10.1, 9.2, 7.1, 6.4, 5.9, 5.3] }],
  },
  options: {
    title: 'Three plants take longer than the network average',
    subtitle: { measure: 'Order-to-delivery lead time', period: 'Q2 2026' },
    unit: 'days',
    source: 'Illustrative plant data',
    averageMarker: true,
  },
});

// Row labels aligned left instead of the dot default right.
const npsRanking = fixtures.find((fixture) => fixture.id === 'nps-dot-ranking')!;
fixtures.push({
  ...npsRanking,
  id: 'nps-rows-left',
  title: 'The NPS ranking with its row labels aligned left',
  tags: ['coverage'],
  options: { ...npsRanking.options, rowLabels: { align: 'left' } },
});

fixtures.push({
  "id": "highlighted-dumbbell-key",
  "title": "Actual and plan remain distinct",
  "kind": "torture",
  "data": {
    "categories": [
      {
        "id": "a",
        "label": "A"
      },
      {
        "id": "b",
        "label": "B"
      }
    ],
    "series": [
      {
        "id": "actual",
        "label": "Actual",
        "colorRole": "highlight",
        "values": [
          17,
          23
        ]
      },
      {
        "id": "plan",
        "label": "Plan",
        "values": [
          21,
          27
        ]
      }
    ]
  },
  "options": {
    "title": "Actual and plan remain distinct",
    "source": "Invented example",
    "variant": "dumbbell"
  }
});

fixtures.push({
  id: 'fraction-reference-line', title: 'A fraction target shares the percentage scale', kind: 'torture',
  data: {
    valueKind: 'fraction', categories: [{ id: 'a', label: 'Group A' }, { id: 'b', label: 'Group B' }],
    series: [{ id: 'rate', label: 'Rate', values: [0.27, 0.43] }],
  },
  options: { title: 'Group B exceeds the 35% target', format: '0%', valueAxis: { show: true }, size: { width: 640, height: 360 } },
  annotations: [{ kind: 'valueLine', value: 0.35, valueKind: 'fraction', label: 'Target' }],
});

registerFixtures('dot', fixtures);
