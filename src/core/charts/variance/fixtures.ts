/**
 * Variance fixtures — examples cover the three variance forms:
 * ΔPY absolute columns with forced signs, ΔPL% relative
 * pins, and integrated AC columns with solid good/bad caps.
 * Torture set: REF ≤ 0 suppression, all-positive, all-negative,
 * lowerIsBetter cost series inverting tones, and 12 dense categories.
 * Every fixture auto-enters the invariant suite.
 */

import { registerFixtures } from '../../../fixtures/registry';
import type { Fixture } from '../../registry';
import type { ChartData } from '../../types/data';
import type { VarianceOptions } from '../../types/options';

export const fixtures: Fixture<ChartData, VarianceOptions>[] = [
  {
    id: 'dpy-absolute-regions',
    title: 'ΔPY absolute variance columns with forced signs',
    kind: 'example',
    tags: ['interaction'],
    hover: { owner: { categoryId: 'dach' } },
    data: {
      categories: [
        { id: 'dach', label: 'DACH' },
        { id: 'france', label: 'France' },
        { id: 'uki', label: 'UK & Ireland' },
        { id: 'nordics', label: 'Nordics' },
        { id: 'iberia', label: 'Iberia' },
      ],
      series: [
        { id: 'rev', label: 'Revenue', values: [128, 96, 84, 52, 41] },
        {
          id: 'py',
          label: 'Prior year',
          role: 'reference',
          scenario: 'PY',
          values: [117, 104, 78, 49, 44],
        },
      ],
    },
    options: {
      variant: 'absolute', variance: { of: 'rev', vs: 'py' },
      title: 'DACH and UK gains outweigh the French decline',
      subtitle: {
        company: 'Brevinth Retail',
        measure: 'Revenue growth vs PY',
        period: 'FY25',
        scenarios: ['AC', 'PY'],
      },
      unit: '$m',
      source: 'Brevinth management accounts, FY25 close',
    },
  },
  {
    id: 'dpl-relative-pins',
    title: 'ΔPL% relative variance pins, ≤1 decimal, forced signs',
    kind: 'example',
    data: {
      categories: [
        { id: 'jan', label: 'Jan' },
        { id: 'feb', label: 'Feb' },
        { id: 'mar', label: 'Mar' },
        { id: 'apr', label: 'Apr' },
        { id: 'may', label: 'May' },
        { id: 'jun', label: 'Jun' },
      ],
      series: [
        { id: 'orders', label: 'Order intake', values: [412, 388, 431, 405, 392, 441] },
        {
          id: 'pl',
          label: 'Plan',
          role: 'reference',
          scenario: 'PL',
          values: [400, 400, 420, 420, 410, 430],
        },
      ],
    },
    options: {
      variant: 'relative', variance: { of: 'orders', vs: 'pl' },
      title: 'Order intake beats plan in three of six months',
      subtitle: {
        company: 'Vantage Systems',
        measure: 'Order intake vs plan',
        period: 'H1 2026',
        scenarios: ['AC', 'PL'],
      },
      // The pins are percent differences, so the unit is '%', as the subtitle says.
      unit: '%',
      source: 'Group controlling, plan v2',
    },
  },
  {
    id: 'integrated-fc-caps',
    title: 'Integrated variance: AC columns with ΔFC caps',
    kind: 'example',
    data: {
      categories: [
        { id: 'consumer', label: 'Consumer' },
        { id: 'enterprise', label: 'Enterprise' },
        { id: 'public', label: 'Public sector' },
        { id: 'oem', label: 'OEM' },
      ],
      series: [
        { id: 'gm', label: 'Gross margin', values: [64, 89, 33, 21] },
        {
          id: 'fc',
          label: 'June forecast',
          role: 'reference',
          scenario: 'FC',
          values: [48, 97, 30, 24],
        },
      ],
    },
    options: {
      variant: 'integrated', variance: { of: 'gm', vs: 'fc' },
      title: 'Consumer drives the beat against the June forecast',
      subtitle: {
        company: 'Alpenrand Devices',
        measure: 'Gross margin vs forecast',
        period: 'Q3 2026',
        scenarios: ['AC', 'FC'],
      },
      unit: '$m',
      source: 'Alpenrand BU reporting; forecast of 30 Jun 2026',
    },
  },
  {
    id: 'ref-nonpositive-suppression',
    title: 'Torture: REF zero and negative suppress Δ% with warnings',
    kind: 'torture',
    data: {
      categories: [
        { id: 'q1', label: 'Q1' },
        { id: 'q2', label: 'Q2' },
        { id: 'q3', label: 'Q3' },
        { id: 'q4', label: 'Q4' },
      ],
      series: [
        { id: 'ebit', label: 'EBIT', values: [14, 9, -3, 12] },
        {
          id: 'py',
          label: 'Prior year',
          role: 'reference',
          scenario: 'PY',
          values: [11, 0, -8, 10],
        },
      ],
    },
    options: {
      variant: 'relative', variance: { of: 'ebit', vs: 'py' },
      title: 'Turnaround quarters have no meaningful percent base',
      subtitle: { measure: 'EBIT vs PY', period: 'FY26 by quarter', scenarios: ['AC', 'PY'] },
      unit: '$m',
    },
  },
  {
    id: 'all-positive-deltas',
    title: 'Total SaaS and services revenue growth by region versus prior year',
    kind: 'torture',
    tags: ['demo', 'regression'],
    data: {
      categories: [
        { id: 'na', label: 'North America' },
        { id: 'emea', label: 'EMEA' },
        { id: 'apac', label: 'APAC' },
      ],
      series: [
        { id: 'saas', label: 'SaaS', values: [61, 44, 28] },
        { id: 'services', label: 'Services', values: [22, 18, 11] },
        {
          id: 'py',
          label: 'Prior year',
          role: 'reference',
          scenario: 'PY',
          values: [74, 55, 31],
        },
      ],
    },
    options: {
      variant: 'absolute', variance: { of: 'total', vs: 'py' },
      title: 'Every region grows total revenue vs PY',
      subtitle: { measure: 'Revenue vs PY', period: 'FY25', scenarios: ['AC', 'PY'] },
      unit: '$m',
    },
  },
  {
    id: 'all-negative-deltas',
    title: 'Torture: all-negative ΔPL, labels mirrored below, category labels in one row under the bars',
    kind: 'torture',
    data: {
      categories: [
        { id: 'retail', label: 'Retail' },
        { id: 'wholesale', label: 'Wholesale' },
        { id: 'online', label: 'Online' },
        { id: 'franchise', label: 'Franchise' },
      ],
      series: [
        { id: 'rev', label: 'Revenue', values: [188, 142, 96, 54] },
        {
          id: 'pl',
          label: 'Plan',
          role: 'reference',
          scenario: 'PL',
          values: [201, 149, 118, 57],
        },
      ],
    },
    options: {
      variant: 'absolute', variance: { of: 'rev', vs: 'pl' },
      title: 'Every channel misses plan, online worst',
      subtitle: { measure: 'Revenue vs plan', period: 'FY26 YTD', scenarios: ['AC', 'PL'] },
      unit: '$m',
      valueAxis: { show: true },
      axisTitles: { primary: 'ΔPL, $m' },
    },
  },
  {
    id: 'lower-is-better-costs',
    title: 'Torture: lowerIsBetter cost series inverts good/bad tones',
    kind: 'torture',
    data: {
      categories: [
        { id: 'materials', label: 'Materials' },
        { id: 'logistics', label: 'Logistics' },
        { id: 'energy', label: 'Energy' },
        { id: 'labor', label: 'Labor' },
      ],
      series: [
        {
          id: 'cost',
          label: 'Operating cost',
          direction: 'lowerIsBetter',
          values: [82, 44, 31, 66],
        },
        {
          id: 'py',
          label: 'Prior year',
          role: 'reference',
          scenario: 'PY',
          values: [88, 41, 36, 63],
        },
      ],
    },
    options: {
      variant: 'absolute', variance: { of: 'cost', vs: 'py' },
      title: 'Materials and energy savings outrun wage inflation',
      subtitle: { measure: 'Operating cost vs PY', period: 'FY25', scenarios: ['AC', 'PY'] },
      unit: '$m',
      source: 'Cost controlling, December close',
    },
  },
  {
    id: 'twelve-months-dense',
    title: 'Torture: 12 monthly categories, mixed signs, smart density',
    kind: 'torture',
    data: {
      categories: [
        { id: 'm01', label: 'Jan' },
        { id: 'm02', label: 'Feb' },
        { id: 'm03', label: 'Mar' },
        { id: 'm04', label: 'Apr' },
        { id: 'm05', label: 'May' },
        { id: 'm06', label: 'Jun' },
        { id: 'm07', label: 'Jul' },
        { id: 'm08', label: 'Aug' },
        { id: 'm09', label: 'Sep' },
        { id: 'm10', label: 'Oct' },
        { id: 'm11', label: 'Nov' },
        { id: 'm12', label: 'Dec' },
      ],
      series: [
        {
          id: 'sales',
          label: 'Sales',
          values: [104, 98, 112, 107, 96, 118, 121, 89, 114, 109, 125, 131],
        },
        {
          id: 'py',
          label: 'Prior year',
          role: 'reference',
          scenario: 'PY',
          values: [101, 103, 105, 102, 99, 111, 116, 95, 108, 112, 119, 124],
        },
      ],
    },
    options: {
      variant: 'absolute', variance: { of: 'sales', vs: 'py' },
      labelDensity: 'smart',
      title: 'Sales beat the prior year in eight months; Feb, May, Aug and Oct fell short',
      subtitle: { measure: 'Sales vs PY', period: 'FY25 by month', scenarios: ['AC', 'PY'] },
      unit: '$m',
    },
  },
];

fixtures.push(
  {
    id: 'annual-surplus', title: 'Over-plan volume grows 20% a year', kind: 'example',
    tags: ['demo', 'annotation', 'cagr'],
    data: {
      categories: [
        { id: 'fy21', label: 'FY21', date: '2021-12-31' },
        { id: 'fy22', label: 'FY22', date: '2022-12-31' },
        { id: 'fy23', label: 'FY23', date: '2023-12-31' },
      ],
      series: [
        { id: 'orders', label: 'Orders', values: [110, 112, 114.4] },
        { id: 'plan', label: 'Plan', role: 'reference', scenario: 'PL', values: [100, 100, 100] },
      ],
    },
    options: {
      variant: 'absolute', variance: { of: 'orders', vs: 'plan' },
      title: 'Over-plan volume grows 20% a year', size: { width: 900, height: 400 },
      subtitle: { measure: 'Extra orders above plan, 10 to 14.4', period: 'FY21 to FY23', scenarios: ['AC', 'PL'] },
      source: 'Illustrative orders and plans',
      annotations: [{ id: 'growth', kind: 'cagr', from: 'fy21', to: 'fy23' }],
    },
  },
  {
    id: 'annual-relative-surplus', title: 'The percentage gap above plan grows 20% a year', kind: 'example',
    tags: ['demo', 'annotation', 'cagr'],
    data: {
      categories: [
        { id: 'fy21', label: 'FY21', date: '2021-12-31' },
        { id: 'fy22', label: 'FY22', date: '2022-12-31' },
        { id: 'fy23', label: 'FY23', date: '2023-12-31' },
      ],
      series: [
        { id: 'orders', label: 'Orders', values: [110, 224, 457.6] },
        { id: 'plan', label: 'Plan', role: 'reference', scenario: 'PL', values: [100, 200, 400] },
      ],
    },
    options: {
      variant: 'relative', variance: { of: 'orders', vs: 'plan' },
      title: 'The percentage gap above plan grows 20% a year', size: { width: 900, height: 400 },
      subtitle: { measure: 'Relative gap above plan, 10% to 14.4%', period: 'FY21 to FY23', scenarios: ['AC', 'PL'] },
      source: 'Illustrative orders and plans',
      annotations: [{ id: 'growth', kind: 'cagr', from: 'fy21', to: 'fy23' }],
    },
  },
);

// Long names at a generous size read whole. The rendered SVG has no
// ellipsis.
fixtures.push({
  id: 'torture-long-labels',
  title: 'Torture: long names at a generous size read whole, never cut',
  kind: 'torture',
  data: {
    categories: [
      {
        id: 'dach',
        label: 'Enterprise cloud infrastructure, managed hosting and sovereign data-centre services for regulated clients',
      },
      {
        id: 'france',
        label: 'Consumer electronics, wearables and connected home devices sold through retail partners',
      },
      {
        id: 'uki',
        label: 'Industrial automation, robotics and predictive maintenance contracts in continental Europe',
      },
      {
        id: 'nordics',
        label: 'Healthcare diagnostics, laboratory information systems and point-of-care testing',
      },
      {
        id: 'iberia',
        label: 'Wealth management, private banking and family-office advisory for entrepreneurs',
      },
    ],
    series: [
      { id: 'rev', label: 'Revenue', values: [128, 96, 84, 52, 41] },
      {
        id: 'py',
        label: 'Prior year',
        role: 'reference',
        scenario: 'PY',
        values: [117, 104, 78, 49, 44],
      },
    ],
  },
  options: {
    variant: 'absolute', variance: { of: 'rev', vs: 'py' },
    title: 'Long names read whole at a generous size',
    subtitle: {
      company: 'Brevinth Retail',
      measure: 'Revenue growth vs PY',
      period: 'FY25',
      scenarios: ['AC', 'PY'],
    },
    unit: '$m',
    source: 'Brevinth management accounts, FY25 close',
    size: { width: 1440, height: 900 },
  },
});

// a market that has no prior year says so. Without the dash the
// slot is empty, and an empty slot on a variance chart reads as a zero.
fixtures.push({
  id: 'missing-prior-dash',
  title: 'A market with no prior year prints an en dash, not an empty slot',
  kind: 'example',
  data: {
    categories: [
      { id: 'dach', label: 'DACH' },
      { id: 'france', label: 'France' },
      { id: 'poland', label: 'Poland' },
      { id: 'nordics', label: 'Nordics' },
    ],
    series: [
      { id: 'rev', label: 'Revenue', values: [128, 96, 31, 52] },
      { id: 'py', label: 'Prior year', role: 'reference', scenario: 'PY', values: [117, 104, null, 49] },
    ],
  },
  options: {
    variant: 'absolute', variance: { of: 'rev', vs: 'py' },
    missingMark: 'dash',
    title: 'Poland opened this year, so it has no prior to compare with',
    subtitle: { measure: 'Revenue growth vs PY', period: 'FY26', scenarios: ['AC', 'PY'] },
    unit: '\u20acm',
    source: 'Illustrative management accounts',
  },
});

fixtures.push({
  "id": "authored-relative-decimals",
  "title": "Relative changes retain the authored precision",
  "kind": "torture",
  "data": {
    "categories": [
      { id: "Batch", label: "Batch" }
    ],
    "series": [
      {
        "id": "actual",
        "label": "Actual",
        "values": [
          170
        ]
      },
      {
        "id": "plan",
        "label": "Plan",
        "role": "reference",
        "values": [
          250
        ]
      }
    ]
  },
  "options": {
    "title": "Batch output falls by 32.0 percent",
    "format": "+1.0%",
    "variant": "relative",
    "variance": {
      "vs": "plan"
    }
  }
});

fixtures.push({
  id: 'partial-period',
  title: 'A running month hatches both the actual and its variance cap',
  kind: 'example',
  data: {
    categories: [
      { id: 'jan', label: 'Jan' },
      { id: 'feb', label: 'Feb' },
      { id: 'mar', label: 'Mar', partial: true },
    ],
    series: [
      { id: 'actual', label: 'Actual', values: [120, 90, 60] },
      { id: 'plan', label: 'Plan', role: 'reference', scenario: 'PL', values: [100, 100, 40] },
    ],
  },
  options: {
    variant: 'integrated', variance: { of: 'actual', vs: 'plan' },
    title: 'March is still running',
    source: 'Illustrative data; March plan covers the same days as actual',
  },
});

registerFixtures('variance', fixtures);
