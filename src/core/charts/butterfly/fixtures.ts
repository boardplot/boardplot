/**
 * Butterfly fixtures: examples (real-looking consulting data) + torture set (single row, 15 dense rows, one-sided
 * slivers, very long center labels, negatives). Every fixture auto-enters
 * the invariant suite.
 */

import { registerFixtures } from '../../../fixtures/registry';
import type { Fixture } from '../../registry';
import type { ChartData } from '../../types/data';
import type { ButterflyOptions } from '../../types/options';

export const fixtures: Fixture<ChartData, ButterflyOptions>[] = [
  {
    id: 'customer-spend',
    title: 'Product A vs Product B customer spend',
    kind: 'example',
    tags: ['interaction'],
    hover: { owner: { categoryId: 'c2', seriesId: 'prodB' } },
    data: {
      categories: Array.from({ length: 8 }, (_, i) => ({
        id: `c${i + 1}`,
        label: `Customer ${i + 1}`,
      })),
      series: [
        { id: 'prodA', label: 'Product A', values: [94, 81, 69, 55, 42, 33, 21, 10] },
        { id: 'prodB', label: 'Product B', values: [95, 60, 71, 48, 45, 28, 19, 12] },
      ],
    },
    options: {
      a: 'prodA',
      b: 'prodB',
      sortBy: 'a',
      title: 'Product B matches A at the top accounts but trails 21 at Customer 2',
      subtitle: { company: 'RetailCo', measure: 'Customer spend', period: 'FY25' },
      unit: '$k',
      source: 'RetailCo sales ledger, FY25 actuals',
    },
    annotations: [
      {
        kind: 'delta',
        at: { categoryId: 'c2', seriesId: 'prodB' },
        vs: { categoryId: 'c2', seriesId: 'prodA' },
      },
    ],
  },
  {
    id: 'license-vs-services',
    title: 'License vs Services revenue by industry',
    kind: 'example',
    data: {
      categories: [
        { id: 'pharma', label: 'Pharma' },
        { id: 'banking', label: 'Banking' },
        { id: 'auto', label: 'Automotive' },
        { id: 'retail', label: 'Retail' },
        { id: 'energy', label: 'Energy' },
        { id: 'public', label: 'Public sector' },
      ],
      series: [
        { id: 'license', label: 'License', values: [128, 96, 84, 61, 44, 25] },
        { id: 'services', label: 'Services', values: [74, 112, 90, 38, 52, 71] },
      ],
    },
    options: {
      a: 'license',
      b: 'services',
      sortBy: 'sum',
      highlight: ['public'],
      title: 'Services carry four of six industries, Public sector most of all',
      subtitle: { company: 'Software Company A', measure: 'Revenue', period: 'FY24', scenarios: ['AC'] },
      unit: 'USD m',
      source: 'Illustrative management accounts FY24',
    },
  },
  {
    id: 'single-row',
    title: 'Torture: one category only',
    kind: 'torture',
    data: {
      categories: [{ id: 'total', label: 'Total' }],
      series: [
        { id: 'a', label: 'Plan', values: [5] },
        { id: 'b', label: 'Actual', values: [3] },
      ],
    },
    // The one row names its unit.
    options: { a: 'a', b: 'b', title: 'Single-row butterfly stays labeled', subtitle: { measure: 'Headcount', period: 'FY25' }, unit: 'FTE' },
  },
  {
    id: 'dense-15',
    // Headcount in FTE beside revenue in $k. The render is refused
    // twice, the shared scale and the difference sort, each with its path
    // and fix.
    title: 'Refusal example: 15 dense rows in two units on one shared scale, sorted by their difference',
    kind: 'torture',
    // Two declared units cannot share a scale or a difference sort.
    refuses: { code: 'unit-conflict', path: 'data.series.1.unit' },
    data: {
      categories: Array.from({ length: 15 }, (_, i) => ({
        id: `br${String(i + 1).padStart(2, '0')}`,
        label: `Branch ${String(i + 1).padStart(2, '0')}`,
      })),
      series: [
        {
          id: 'fte',
          label: 'Headcount',
          unit: 'FTE',
          values: [412, 388, 355, 340, 312, 298, 265, 244, 231, 210, 188, 162, 141, 120, 98],
        },
        {
          id: 'rev',
          label: 'Revenue',
          unit: '$k',
          values: [380, 405, 290, 371, 250, 310, 280, 199, 260, 175, 205, 130, 158, 90, 110],
        },
      ],
    },
    options: {
      a: 'fte',
      b: 'rev',
      sortBy: 'diff',
      title: '15 dense rows stay overlap-free',
      labelDensity: 'smart',
    },
  },
  {
    id: 'tiny-side',
    title: 'Torture: one side all slivers under shared scale',
    kind: 'torture',
    data: {
      categories: [
        { id: 'north', label: 'North' },
        { id: 'south', label: 'South' },
        { id: 'east', label: 'East' },
        { id: 'west', label: 'West' },
        { id: 'central', label: 'Central' },
      ],
      series: [
        { id: 'incumbent', label: 'Incumbent', values: [880, 640, 590, 410, 305] },
        { id: 'entrant', label: 'Entrant', values: [4, 2.5, 0.8, 1.6, 0.2] },
      ],
    },
    options: {
      a: 'incumbent',
      b: 'entrant',
      sortBy: 'a',
      title: 'Entrant volumes are slivers against the incumbent',
    },
  },
  {
    id: 'long-labels',
    title: 'Torture: very long category labels ellipsize in the center column',
    kind: 'torture',
    data: {
      categories: [
        { id: 'c1', label: 'Integrated global supply chain transformation program' },
        { id: 'c2', label: 'Customer experience and digital channel modernization' },
        { id: 'c3', label: 'Enterprise resource planning consolidation wave two' },
        { id: 'c4', label: 'Regulatory compliance and reporting automation initiative' },
        { id: 'c5', label: 'Post-merger integration synergy capture office' },
      ],
      series: [
        { id: 'budget', label: 'Budget', values: [14.5, 11.2, 9.8, 6.4, 5.1] },
        { id: 'spent', label: 'Spent to date', values: [9.1, 12.6, 4.2, 6.0, 7.9] },
      ],
    },
    options: {
      a: 'budget',
      b: 'spent',
      title: 'Long program names must not push the panes apart',
    },
  },
  {
    id: 'negatives-own-scale',
    title: 'Torture: negatives run toward the names, independent pane scales with a value axis each',
    kind: 'torture',
    data: {
      categories: [
        { id: 'alpha', label: 'Alpha' },
        { id: 'beta', label: 'Beta' },
        { id: 'gamma', label: 'Gamma' },
        { id: 'delta', label: 'Delta' },
      ],
      series: [
        { id: 'py', label: 'ΔPY', values: [12, -8, 4, -15] },
        { id: 'pl', label: 'ΔPL', values: [-2.4, 1.1, -0.6, 3.2] },
      ],
    },
    options: {
      a: 'py',
      b: 'pl',
      sharedScale: false,
      title: 'Each pane keeps its own zero line and value axis',
    },
  },
];

for (const sortBy of ['sheet', 'b', 'diff'] as const) {
  fixtures.push({
    ...fixtures[0]!,
    id: `customer-spend-sort-${sortBy}`,
    kind: sortBy === 'diff' ? fixtures[0]!.kind : 'torture',
    title: `Customer spend ordered by ${sortBy === 'sheet' ? 'authored account order' : sortBy === 'b' ? 'Product B' : 'the B-minus-A difference'}`,
    options: { ...fixtures[0]!.options!, sortBy },
  });
}

fixtures.push({
  id: 'period-comparisons',
  title: 'Period growth and a difference across the mirrored panes',
  kind: 'example',
  data: {
    categories: [
      { id: 'fy21', label: 'FY21', date: '2021-12-31' },
      { id: 'fy22', label: 'FY22', date: '2022-12-31' },
      { id: 'fy23', label: 'FY23', date: '2023-12-31' },
    ],
    series: [
      { id: 'online', label: 'Online', values: [100, 120, 144] },
      { id: 'store', label: 'Store', values: [130, 150, 180] },
    ],
  },
  options: {
    a: 'online', b: 'store', size: { width: 1000, height: 500 },
    title: 'Online grows 20% a year; Store is 30 ahead in FY21',
    subtitle: { measure: 'Orders', period: 'FY21 to FY23' },
    source: 'Illustrative channel orders',
    annotations: [
      { id: 'growth', kind: 'cagr', from: { categoryId: 'fy21', seriesId: 'online' }, to: { categoryId: 'fy23', seriesId: 'online' } },
      { id: 'gap', kind: 'diff', mode: 'absolute', from: { categoryId: 'fy21', seriesId: 'online' }, to: { categoryId: 'fy21', seriesId: 'store' } },
    ],
  },
});

// Long names at a generous size read whole. The rendered SVG has no
// ellipsis.
fixtures.push({
  id: 'torture-long-labels',
  title: 'Torture: long names at a generous size read whole, never cut',
  kind: 'torture',
  data: {
    categories: [
      {
        id: 'c1',
        label: 'Enterprise cloud infrastructure, managed hosting and sovereign data-centre services for regulated clients',
      },
      {
        id: 'c2',
        label: 'Consumer electronics, wearables and connected home devices sold through retail partners',
      },
      {
        id: 'c3',
        label: 'Industrial automation, robotics and predictive maintenance contracts in continental Europe',
      },
      {
        id: 'c4',
        label: 'Healthcare diagnostics, laboratory information systems and point-of-care testing',
      },
      {
        id: 'c5',
        label: 'Wealth management, private banking and family-office advisory for entrepreneurs',
      },
      {
        id: 'c6',
        label: 'Retail deposits and everyday current accounts for households and sole traders',
      },
      {
        id: 'c7',
        label: 'Corporate lending incl. syndicated, leveraged and sustainability-linked finance',
      },
      {
        id: 'c8',
        label: 'Logistics, warehousing and last-mile delivery partnerships in metropolitan areas',
      },
    ],
    series: [
      { id: 'prodA', label: 'Product A', values: [94, 81, 69, 55, 42, 33, 21, 10] },
      { id: 'prodB', label: 'Product B', values: [95, 60, 71, 48, 45, 28, 19, 12] },
    ],
  },
  options: {
    a: 'prodA',
    b: 'prodB',
    sortBy: 'a',
    title: 'Long names read whole at a generous size',
    subtitle: { company: 'RetailCo', measure: 'Customer spend', period: 'FY25' },
    unit: '$k',
    source: 'RetailCo sales ledger, FY25 actuals',
    size: { width: 1440, height: 900 },
  },
  annotations: [
    {
      kind: 'delta',
      at: { categoryId: 'c2', seriesId: 'prodB' },
      vs: { categoryId: 'c2', seriesId: 'prodA' },
    },
  ],
});

// A dark theme whose neutral is its band tint, about 1.1:1 on the card, gives
// the first side a mark-strength grey through color.neutralMark.
const licence = fixtures.find((fixture) => fixture.id === 'license-vs-services')!;
fixtures.push({
  ...licence,
  kind: 'torture', id: 'license-vs-services-neutral-mark',
  title: 'License vs Services on a dark theme whose neutral is a band tint',
  tags: ['theme'],
  options: {
    ...licence.options!,
    theme: {
      preset: 'standard-dark',
      overrides: { color: { background: '#141419', neutral: '#1D1D25', neutralMark: '#8E8E93' } },
    },
  },
});

// An authored label column between the panes.
const customerSpend = fixtures.find((fixture) => fixture.id === 'customer-spend')!;
fixtures.push({
  ...customerSpend,
  id: 'fixed-label-column', kind: 'torture',
  title: 'A 160 px label column between the panes instead of the measured width',
  tags: ['coverage'],
  options: { ...customerSpend.options!, centerColumnWidth: 160 },
});

// The shared options butterfly supports: top N, a key above the panes, explicit label kinds.
fixtures.push({
  ...customerSpend,
  kind: 'torture', id: 'customer-spend-top-five',
  title: 'The five largest customers, a key above the panes and explicit label kinds',
  tags: ['coverage'],
  options: { ...customerSpend.options!, topN: { n: 5 }, legend: 'top', labels: { category: true, point: true } },
});

// Negative values on one shared scale: each pane has a zero line, positive bars run outward and
// negative bars toward the names. `negatives: 'magnitude'` keeps the old lighter bar of |value|.
const signedData: ChartData = {
  categories: [
    { id: 'licence', label: 'Licence income' },
    { id: 'marketing', label: 'Marketing spend' },
    { id: 'churn', label: 'Churn rate' },
    { id: 'materials', label: 'Material costs' },
    { id: 'orders', label: 'Order intake' },
    { id: 'staff', label: 'Staff costs' },
  ],
  series: [
    { id: 'partner', label: 'Partner channel', values: [-2252, -2196, -2398, 2282, 2262, 1932] },
    { id: 'email', label: 'Email campaigns', values: [1725, 1576, -1471, -1357, -1379, 1206] },
  ],
};
fixtures.push({
  id: 'negatives-shared-scale',
  title: 'Negative values run from each pane\'s zero line toward the names on one shared scale',
  kind: 'torture',
  tags: ['coverage'],
  data: signedData,
  options: { a: 'partner', b: 'email', title: 'Negative bars point toward the names', unit: 'EUR m' },
}, {
  id: 'negatives-magnitude',
  title: 'The lighter bar of |value| for negative values, from negatives: magnitude',
  kind: 'torture',
  tags: ['coverage'],
  data: signedData,
  options: { a: 'partner', b: 'email', title: 'Negative bars keep their length and a lighter tint', unit: 'EUR m', negatives: 'magnitude' },
}, {
  id: 'blank-values',
  title: 'A value the data lacks prints the not-applicable mark at the pane start',
  kind: 'torture',
  tags: ['coverage'],
  data: {
    categories: [
      { id: 'logistics', label: 'Logistics' },
      { id: 'coastal', label: 'Coastal region' },
      { id: 'goods', label: 'Purchased goods' },
      { id: 'equity', label: 'Equity income' },
      { id: 'freight', label: 'Freight costs' },
    ],
    series: [
      { id: 'domestic', label: 'Domestic services', values: [1.73, 1.58, null, 1.58, 1.34] },
      { id: 'fixed', label: 'Fixed-price services', values: [2.62, null, null, 2.93, null] },
    ],
  },
  options: { a: 'domestic', b: 'fixed', title: 'A blank value reads as not applicable, never as zero' },
}, {
  id: 'own-scales-mixed',
  title: 'Panes of very different size on their own scales each draw a value axis',
  kind: 'torture',
  tags: ['coverage'],
  data: {
    categories: [
      { id: 'north', label: 'North' },
      { id: 'south', label: 'South' },
      { id: 'east', label: 'East' },
      { id: 'west', label: 'West' },
    ],
    series: [
      { id: 'emails', label: 'Email campaigns', unit: 'sends', values: [163, 157, 181, 186] },
      { id: 'public', label: 'Public sector', unit: 'EUR', values: [15060000, 14800000, 17670000, 16330000] },
    ],
  },
  options: { a: 'emails', b: 'public', sharedScale: false, title: 'Each pane reads against its own axis' },
});

registerFixtures('butterfly', fixtures);
