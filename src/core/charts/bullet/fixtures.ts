/**
 * Bullet fixtures: consulting-grade KPI panels (coverage
 * follows the bullet-graph form + target notation)
 * plus a torture set: no bands, sparse targets with overshoot on an explicit
 * shared scale, a ragged-zero row-scale mix, tiny decimal values, and a
 * 12-row compact dashboard. Every fixture auto-enters the invariant suite.
 */

import { registerFixtures } from '../../../fixtures/registry';
import type { Fixture } from '../../registry';
import type { BulletBand, BulletData } from '../../types/data';
import type { BulletOptions } from '../../types/options';

const higherIsBetterBands = (poorTo: number, satisfactoryTo: number, goodTo: number): BulletBand[] => [
  { to: poorTo, label: 'Poor' },
  { to: satisfactoryTo, label: 'Satisfactory' },
  { to: goodTo, label: 'Good' },
];

const lowerIsBetterBands = (goodTo: number, satisfactoryTo: number, poorTo: number): BulletBand[] => [
  { to: goodTo, label: 'Good' },
  { to: satisfactoryTo, label: 'Satisfactory' },
  { to: poorTo, label: 'Poor' },
];

export const fixtures: Fixture<BulletData, BulletOptions>[] = [
  {
    id: 'four-band-neutral-ladder',
    title: 'Four qualitative bands with reversed cost direction',
    kind: 'example',
    tags: ['interaction'],
    hover: { owner: { categoryId: 'coverage' } },
    data: {
      rows: [
        { id: 'coverage', label: 'Coverage', value: { pct: 78 }, target: { pct: 85 }, bands: [
          { to: 40, label: 'Poor' }, { to: 60, label: 'Fair' },
          { to: 80, label: 'Good' }, { to: 100, label: 'Leading' },
        ] },
        { id: 'cost', label: 'Cost per order', value: { number: 32, format: '$32' }, target: { number: 30, format: '$30' }, direction: 'lowerIsBetter', bands: [
          { to: 20, label: 'Leading' }, { to: 30, label: 'Good' },
          { to: 40, label: 'Fair' }, { to: 50, label: 'Poor' },
        ] },
      ],
    },
    options: {
      title: 'Coverage and cost across four performance bands',
      // Coverage in % and cost per order in $ share no unit: each row keeps its own scale and format.
      sharedScale: false,
      source: 'Illustrative operating targets',
    },
  },
  {
    id: 'exec-kpi-panel',
    title: 'Executive KPI panel: revenue, margin, NPS, churn (lowerIsBetter) in percent of target',
    kind: 'example',
    data: {
      rows: [
        {
          id: 'revenue',
          label: 'Revenue',
          value: { number: 128, format: '$128' },
          target: { number: 150, format: '$150' },
        },
        {
          id: 'margin',
          label: 'Gross margin',
          value: { pct: 38.5 },
          target: { pct: 42 },
        },
        {
          id: 'nps',
          label: 'NPS',
          value: 44,
          target: 40,
        },
        {
          id: 'churn',
          label: 'Churn',
          value: { pct: 6.8 },
          target: { pct: 6 },
          direction: 'lowerIsBetter',
        },
      ],
    },
    options: {
      // Four KPIs in four units read against one another only in percent of
      // their own targets; churn is lower-is-better, says so and mirrors its zones.
      sharedScale: 'percentOfTarget',
      title: 'Only NPS is on target',
      subtitle: {
        company: 'Brevinth Software',
        measure: 'Company KPIs in % of target',
        period: 'FY26 Q2',
        scenarios: ['AC', 'PL'],
      },
      source: 'Brevinth BI board pack, June 2026',
    },
  },
  {
    id: 'ops-dashboard',
    title: 'Plant operations dashboard: 8 KPI rows with mixed directions',
    kind: 'example',
    data: {
      rows: [
        {
          id: 'otd',
          label: 'On-time delivery',
          value: { pct: 94.2 },
          target: { pct: 95 },
          bands: higherIsBetterBands(90, 95, 99),
        },
        {
          id: 'util',
          label: 'Line utilization',
          value: { pct: 81.4 },
          target: { pct: 85 },
          bands: higherIsBetterBands(70, 85, 95),
        },
        {
          id: 'fpy',
          label: 'First-pass yield',
          value: { pct: 97.1 },
          target: { pct: 96.5 },
          bands: higherIsBetterBands(92, 96, 99),
        },
        {
          id: 'backlog',
          label: 'Order backlog (days)',
          value: 12,
          target: 10,
          bands: lowerIsBetterBands(8, 14, 20),
          direction: 'lowerIsBetter',
        },
        {
          id: 'scrap',
          label: 'Scrap rate',
          value: { pct: 2.4 },
          target: { pct: 2 },
          bands: lowerIsBetterBands(1.5, 2.5, 4),
          direction: 'lowerIsBetter',
        },
        {
          id: 'overtime',
          label: 'Overtime share',
          value: { pct: 6.1 },
          target: { pct: 5 },
          bands: lowerIsBetterBands(4, 7, 10),
          direction: 'lowerIsBetter',
        },
        {
          id: 'incidents',
          label: 'Safety incidents',
          value: 3,
          target: 2,
          bands: lowerIsBetterBands(2, 4, 8),
          direction: 'lowerIsBetter',
        },
        {
          id: 'training',
          label: 'Training hours / FTE',
          value: 11,
          target: 12,
          bands: higherIsBetterBands(6, 12, 18),
        },
      ],
    },
    options: {
      title: 'Quality holds while cost and safety KPIs drift off plan',
      subtitle: {
        company: 'Company A',
        measure: 'Plant operations KPIs',
        period: 'May 2026',
        scenarios: ['AC', 'PL'],
      },
      source: 'Illustrative plant KPIs, May 2026',
      // Eight 28px rows plus the title, legend and source require 369px; the
      // extra height gives each row room for its target value beside the tick.
      size: { width: 480, height: 500 },
    },
  },
  {
    id: 'no-bands-target-only',
    title: 'Torture: bars and target ticks only — no qualitative bands',
    kind: 'torture',
    data: {
      rows: [
        { id: 'amer', label: 'AMER', value: 412, target: 450 },
        { id: 'emea', label: 'EMEA', value: 366, target: 340 },
        { id: 'apac', label: 'APAC', value: 268, target: 300 },
        { id: 'latam', label: 'LATAM', value: 122, target: 110 },
        { id: 'mea', label: 'MEA', value: 64, target: 80 },
      ],
    },
    options: {
      title: 'Bookings without bands still read as target-vs-actual',
      subtitle: { measure: 'Bookings', period: 'FY26 H1', scenarios: ['AC', 'PL'] },
      unit: '$m',
      source: 'CRM pipeline snapshot, week 26',
    },
  },
  {
    id: 'sparse-targets-overshoot',
    title: 'Torture: missing targets, null value, zero, and value beyond the last band',
    kind: 'torture',
    data: {
      rows: [
        {
          id: 'overshoot',
          label: 'Digital revenue',
          value: 190,
          target: 95,
          // value far beyond the last band — bar may exceed; the tiers are named
          bands: [{ to: 60, label: 'Below plan' }, { to: 80, label: 'On plan' }, { to: 100, label: 'Stretch' }],
        },
        { id: 'no-target', label: 'Print revenue', value: 72, bands: [{ to: 50, label: 'Below plan' }, { to: 75, label: 'On plan' }, { to: 100, label: 'Stretch' }] },
        { id: 'no-value', label: 'Events (pending)', value: null, target: 40, bands: [{ to: 25, label: 'Below plan' }, { to: 50, label: 'On plan' }, { to: 75, label: 'Stretch' }] },
        { id: 'zero', label: 'Licensing', value: 0, target: 15, bands: [{ to: 10, label: 'Below plan' }, { to: 20, label: 'On plan' }, { to: 30, label: 'Stretch' }] },
      ],
    },
    options: {
      title: 'Digital blows through the scale while events data is pending',
      subtitle: { measure: 'Revenue by stream', period: 'FY26 Q2', scenarios: ['AC', 'PL'] },
      unit: '$m',
      source: 'Divisional finance, flash close',
      valueAxis: { show: true },
      axisTitles: { primary: 'Revenue, $m' },
      // Same-unit rows read against ONE absolute axis — this fixture's whole
      // point ("blows through the scale") needs the shared domain, so it opts
      // out of the all-rows-banded row-normalization default.
      sharedScale: true,
    },
  },
  {
    id: 'tiny-values',
    title: 'Torture: sub-1.0 values with a two-decimal format-by-example',
    kind: 'torture',
    data: {
      rows: [
        { id: 'co2', label: 'CO2 per unit', value: 0.42, target: 0.4, bands: lowerIsBetterBands(0.3, 0.45, 0.6), direction: 'lowerIsBetter' },
        { id: 'water', label: 'Water per unit', value: 0.08, target: 0.1, bands: lowerIsBetterBands(0.05, 0.12, 0.2), direction: 'lowerIsBetter' },
        { id: 'waste', label: 'Waste per unit', value: 0.61, target: 0.5, bands: lowerIsBetterBands(0.4, 0.55, 0.7), direction: 'lowerIsBetter' },
        { id: 'recycled', label: 'Recycled input', value: 0.34, target: 0.35, bands: higherIsBetterBands(0.2, 0.35, 0.5) },
      ],
    },
    options: {
      title: 'Waste is the only KPI in the poor band',
      subtitle: { measure: 'Sustainability intensity KPIs', period: 'FY25', scenarios: ['AC', 'PL'] },
      unit: 'kg per unit',
      format: '1.23',
      source: 'Group ESG data platform, audited FY25',
      // At the dashboard default (480x270) the card plot band falls under the
      // 0.50 card floor once title, scenario legend and source are stacked; one
      // a4 rung up carries the same rows legally.
      size: { width: 480, height: 340 },
    },
  },
  {
    id: 'row-scale-ragged-zero',
    title: 'Torture: explicit row scale with a bandless row and a negative value',
    kind: 'torture',
    data: {
      rows: [
        {
          id: 'ebit',
          label: 'EBIT margin',
          value: { pct: -2.4 },
          target: { pct: 1.5 },
          bands: higherIsBetterBands(2, 5, 8),
        },
        // bandless: normalizes to its own value/target extent
        { id: 'bookings', label: 'Bookings ($m)', value: 412, target: 450 },
        {
          id: 'csat',
          label: 'CSAT',
          value: { pct: 78 },
          target: { pct: 85 },
          bands: higherIsBetterBands(60, 80, 95),
        },
      ],
    },
    options: {
      sharedScale: false,
      title: 'Negative EBIT margin and a bandless row on independent row scales',
      subtitle: { measure: 'Recovery KPIs', period: 'FY26 Q3', scenarios: ['AC', 'PL'] },
      source: 'Group controlling, flash close',
      // The dashboard default (480x270) puts the card plot band under the
      // 0.50 floor once title, band legend and source are stacked; one size
      // step up carries the same rows (same step as exec-kpi-panel).
      size: { width: 480, height: 340 },
    },
  },
  {
    id: 'twelve-rows-compact',
    title: 'Torture: 12 KPI rows in a narrow dashboard panel',
    kind: 'torture',
    data: {
      rows: [
        { id: 'k01', label: 'New ARR', value: 8.4, target: 9, bands: higherIsBetterBands(6, 9, 12) },
        { id: 'k02', label: 'Expansion ARR', value: 3.1, target: 2.5, bands: higherIsBetterBands(1.5, 3, 4.5) },
        { id: 'k03', label: 'Churned ARR', value: 1.9, target: 1.5, bands: lowerIsBetterBands(1, 2, 3), direction: 'lowerIsBetter' },
        { id: 'k04', label: 'Pipeline coverage', value: 3.4, target: 4, bands: higherIsBetterBands(2, 4, 6) },
        { id: 'k05', label: 'Win rate', value: { pct: 24 }, target: { pct: 28 }, bands: higherIsBetterBands(15, 25, 35) },
        { id: 'k06', label: 'Sales cycle (weeks)', value: 11, target: 9, bands: lowerIsBetterBands(6, 10, 14), direction: 'lowerIsBetter' },
        { id: 'k07', label: 'CAC payback (months)', value: 19, target: 18, bands: lowerIsBetterBands(12, 18, 24), direction: 'lowerIsBetter' },
        { id: 'k08', label: 'Net revenue retention', value: { pct: 108 }, target: { pct: 112 }, bands: higherIsBetterBands(95, 110, 125) },
        { id: 'k09', label: 'Support CSAT', value: { pct: 91 }, target: { pct: 90 }, bands: higherIsBetterBands(80, 90, 97) },
        { id: 'k10', label: 'Uptime', value: { pct: 99.4 }, target: { pct: 99.5 }, bands: higherIsBetterBands(98, 99.5, 100) },
        { id: 'k11', label: 'Hiring vs plan', value: { pct: 84 }, target: { pct: 100 }, bands: higherIsBetterBands(70, 90, 110) },
        { id: 'k12', label: 'Cash burn', value: 2.6, target: 2.2, bands: lowerIsBetterBands(1.5, 2.5, 3.5), direction: 'lowerIsBetter' },
      ],
    },
    options: {
      size: { width: 480, height: 622 },
      title: 'Twelve KPIs stay legible in a narrow panel',
      subtitle: { measure: 'SaaS operating KPIs', period: 'FY26 Q2', scenarios: ['AC', 'PL'] },
      source: 'RevOps warehouse, quarter close',
    },
  },
  {
    id: 'two-kpis-tall-frame',
    title: 'Two KPI rows retain their natural height in a tall frame',
    kind: 'torture',
    data: {
      rows: [
        { id: 'orders', label: 'Orders', value: 120, target: 110, bands: higherIsBetterBands(80, 110, 140) },
        { id: 'cost', label: 'Unit cost', value: 32, target: 30, direction: 'lowerIsBetter', bands: lowerIsBetterBands(20, 30, 40) },
      ],
    },
    options: {
      title: 'Orders exceed plan while unit cost remains high',
      source: 'Illustrative operating targets',
      size: { width: 640, height: 480 },
      mode: 'full',
    },
  },
  {
    id: 'attainment-shading',
    title: 'Attainment fill versus a shared 80 plan',
    kind: 'example',
    tags: ['annotation'],
    data: {
      rows: [
        { id: 'revenue', label: 'Revenue', value: 92, target: 80 },
        { id: 'margin', label: 'Margin', value: 71, target: 80 },
        { id: 'nps', label: 'NPS', value: 80, target: 80 },
      ],
    },
    options: {
      title: 'Revenue beats plan while margin misses',
      source: 'Illustrative shared-scale attainment',
      sharedScale: true,
      size: { width: 640, height: 320 },
    },
    annotations: [
      { kind: 'band', id: 'vs-plan', style: 'attainment', value: 80, direction: 'higherIsBetter', label: '' },
    ],
  },
];

fixtures.push({
  id: 'cost-attainment-shading',
  title: 'Lower costs receive the favorable attainment treatment',
  kind: 'example',
  tags: ['annotation'],
  data: { rows: [
    { id: 'north', label: 'North', value: 92, target: 80, direction: 'lowerIsBetter' },
    { id: 'south', label: 'South', value: 71, target: 80, direction: 'lowerIsBetter' },
  ] },
  options: { title: 'South spends below the 80 cost target', unit: '$m', source: 'Illustrative regional costs', sharedScale: true, size: { width: 640, height: 320 } },
  annotations: [{ kind: 'band', id: 'cost-plan', style: 'attainment', value: 80, direction: 'lowerIsBetter', label: '' }],
});

fixtures.push(
  {
    id: 'regional-difference', title: 'South delivers 100 fewer orders', kind: 'example',
    tags: ['demo', 'annotation', 'diff'],
    data: { rows: [{ id: 'north', label: 'North', value: 200 }, { id: 'south', label: 'South', value: 100 }] },
    options: {
      title: 'South delivers 100 fewer orders', unit: 'orders', sharedScale: true,
      source: 'Illustrative regional results',
      annotations: [{ id: 'gap', kind: 'diff', mode: 'absolute', from: 'north', to: 'south' }],
    },
  },
  {
    id: 'annual-orders', title: 'Orders grow 20% per year', kind: 'example',
    tags: ['demo', 'annotation', 'cagr'],
    data: { rows: [
      { id: 'fy21', label: 'FY21', date: '2021-12-31', value: 100, target: 110 },
      { id: 'fy22', label: 'FY22', date: '2022-12-31', value: 120, target: 132 },
      { id: 'fy23', label: 'FY23', date: '2023-12-31', value: 144, target: 158.4 },
    ] },
    options: {
      title: 'Orders grow 20% per year', unit: 'thousand orders', sharedScale: true,
      source: 'Illustrative annual orders and plans',
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
    rows: [
      {
        id: 'otd',
        label: 'Enterprise cloud infrastructure, managed hosting and sovereign data-centre services for regulated clients',
        value: { pct: 94.2 },
        target: { pct: 95 },
        bands: [{ to: 90, label: 'Poor' }, { to: 95, label: 'Satisfactory' }, { to: 99, label: 'Good' }],
      },
      {
        id: 'util',
        label: 'Consumer electronics, wearables and connected home devices sold through retail partners',
        value: { pct: 81.4 },
        target: { pct: 85 },
        bands: [{ to: 70, label: 'Poor' }, { to: 85, label: 'Satisfactory' }, { to: 95, label: 'Good' }],
      },
      {
        id: 'fpy',
        label: 'Industrial automation, robotics and predictive maintenance contracts in continental Europe',
        value: { pct: 97.1 },
        target: { pct: 96.5 },
        bands: [{ to: 92, label: 'Poor' }, { to: 96, label: 'Satisfactory' }, { to: 99, label: 'Good' }],
      },
      {
        id: 'backlog',
        label: 'Healthcare diagnostics, laboratory information systems and point-of-care testing',
        value: 12,
        target: 10,
        bands: [{ to: 8, label: 'Good' }, { to: 14, label: 'Satisfactory' }, { to: 20, label: 'Poor' }],
        direction: 'lowerIsBetter',
      },
      {
        id: 'scrap',
        label: 'Wealth management, private banking and family-office advisory for entrepreneurs',
        value: { pct: 2.4 },
        target: { pct: 2 },
        bands: [{ to: 1.5, label: 'Good' }, { to: 2.5, label: 'Satisfactory' }, { to: 4, label: 'Poor' }],
        direction: 'lowerIsBetter',
      },
      {
        id: 'overtime',
        label: 'Retail deposits and everyday current accounts for households and sole traders',
        value: { pct: 6.1 },
        target: { pct: 5 },
        bands: [{ to: 4, label: 'Good' }, { to: 7, label: 'Satisfactory' }, { to: 10, label: 'Poor' }],
        direction: 'lowerIsBetter',
      },
      {
        id: 'incidents',
        label: 'Corporate lending incl. syndicated, leveraged and sustainability-linked finance',
        value: 3,
        target: 2,
        bands: [{ to: 2, label: 'Good' }, { to: 4, label: 'Satisfactory' }, { to: 8, label: 'Poor' }],
        direction: 'lowerIsBetter',
      },
      {
        id: 'training',
        label: 'Logistics, warehousing and last-mile delivery partnerships in metropolitan areas',
        value: 11,
        target: 12,
        bands: [{ to: 6, label: 'Poor' }, { to: 12, label: 'Satisfactory' }, { to: 18, label: 'Good' }],
      },
    ],
  },
  options: {
    title: 'Long names read whole at a generous size',
    subtitle: {
      company: 'Company A',
      measure: 'Plant operations KPIs',
      period: 'May 2026',
      scenarios: ['AC', 'PL'],
    },
    source: 'Illustrative plant KPIs, May 2026',
    size: { width: 1440, height: 900 },
  },
});

// the compact mark a KPI column hosts, and what it has no room for.
fixtures.push(
  {
    id: 'compact-120',
    title: 'The compact 120 by 28 mark: bands, bar and target tick, no text',
    kind: 'torture',
    tags: ['coverage'],
    hover: { owner: { categoryId: 'fill-rate' } },
    data: {
      rows: [{ id: 'fill-rate', label: 'Fill rate', value: 72, target: 80, bands: higherIsBetterBands(50, 75, 100) }],
    },
    options: { density: 'compact', size: { width: 120, height: 28 } },
  },
  {
    id: 'compact-value-axis',
    title: 'Refusal example: a value axis on the compact mark',
    kind: 'example',
    refuses: { code: 'invalid-options', path: 'options.valueAxis.show' },
    data: { rows: [{ id: 'fill-rate', value: 72, target: 80 }] },
    options: { density: 'compact', valueAxis: { show: true } },
  },
  {
    id: 'compact-labels',
    title: 'Refusal example: label switches on the compact mark, which prints no labels',
    kind: 'example',
    refuses: { code: 'invalid-options', path: 'options.labels' },
    data: { rows: [{ id: 'fill-rate', value: 72, target: 80 }] },
    options: { density: 'compact', labels: { point: true } },
  },
);

fixtures.push({
  "id": "repeated-band-labels",
  "title": "Each band shade keeps its key",
  "kind": "torture",
  "data": {
    "rows": [
      {
        "id": "r",
        "label": "Row",
        "value": 42,
        "target": 70,
        "bands": [
          {
            "label": "Low",
            "to": 20
          },
          {
            "label": "Mid",
            "to": 40
          },
          {
            "label": "High",
            "to": 60
          },
          {
            "label": "High",
            "to": 80
          },
          {
            "label": "High",
            "to": 100
          }
        ]
      }
    ]
  },
  "options": {
    "title": "Each band shade keeps its key",
    "source": "Invented example"
  }
});

fixtures.push({
  id: 'mixed-direction-positional-labels',
  title: 'Rows with opposite directions and Low/Mid/High labels get one worse-to-better key',
  kind: 'torture',
  data: { rows: [
    { id: 'conv', label: 'Conversion rate', value: 62, target: 70, direction: 'higherIsBetter', bands: [{ to: 40, label: 'Low' }, { to: 70, label: 'Mid' }, { to: 100, label: 'High' }] },
    { id: 'cost', label: 'Cost per order', value: 38, target: 30, direction: 'lowerIsBetter', bands: [{ to: 25, label: 'Low' }, { to: 45, label: 'Mid' }, { to: 60, label: 'High' }] },
  ] },
  options: { title: 'One key reads worse to better for both rows', source: 'Invented example', bandKey: 'auto' },
});

for (const bandKey of ['labels', 'ramp'] as const) {
  const base = fixtures.find((fixture) => fixture.id === 'mixed-direction-positional-labels')!;
  fixtures.push({
    ...base,
    id: `band-key-${bandKey}`,
    kind: bandKey === 'labels' ? 'torture' : 'example',
    title: bandKey === 'labels' ? 'bandKey labels keeps every label and shade' : 'bandKey ramp forces the worse-to-better key',
    tags: ['coverage'],
    options: { ...base.options, bandKey, title: bandKey === 'labels' ? 'The key names each label on each shade' : 'The key is one ramp', ...(bandKey === 'ramp' ? { strings: { bandKey: ['Weak', 'Fair', 'Strong'] } } : {}) },
  });
}

fixtures.push({ id: 'two-sided-spend', title: 'Both low and high spend are off plan', kind: 'example', data: { rows: [{ id: 'spend', label: 'Spend', value: 98, target: 100, bands: [{ to: 90, label: 'Below plan', tone: 'bad' }, { to: 110, label: 'On plan', tone: 'good' }, { to: 130, label: 'Above plan', tone: 'bad' }] }] }, options: { title: 'Spend is inside the plan corridor', size: { width: 700, height: 300 } } });

fixtures.push({
  id: 'tone-spectrum', title: 'Band tones carry the range judgment', kind: 'torture',
  data: { rows: [
    { id: 'review', label: 'Review', value: 40, target: 50, bands: [
      { to: 25, label: 'Off plan', tone: 'bad' }, { to: 45, label: 'Review', tone: 'warn' },
      { to: 55, label: 'On plan', tone: 'good' }, { to: 70, label: 'Unrated', tone: 'neutral' },
    ] },
    { id: 'unrated', label: 'Unrated', value: 60, target: 50, bands: [
      { to: 25, label: 'Off plan', tone: 'bad' }, { to: 45, label: 'Review', tone: 'warn' },
      { to: 55, label: 'On plan', tone: 'good' }, { to: 70, label: 'Unrated', tone: 'neutral' },
    ] },
  ] },
  options: { title: 'Review and unrated ranges keep their tones', size: { width: 800, height: 340 } },
});

fixtures.push({
  id: 'neutral-change', title: 'A neutral comparison with a target', kind: 'example',
  data: { rows: [{ id: 'volume', label: 'Volume', value: 80, target: 100, direction: 'neutral' }] },
  options: { title: 'Volume is below the comparison value', source: 'Illustrative data' },
});

// strings.target names the comparison value in every composed phrase.
fixtures.push({
  id: 'plan-wording', title: 'strings.target words the comparison as plan', kind: 'example',
  data: { rows: [
    { id: 'north', label: 'North', value: 412, target: 450 },
    { id: 'south', label: 'South', value: 366, target: 340 },
    { id: 'west', label: 'West', value: 268, target: 300 },
  ] },
  options: { title: 'South is the only region above plan', unit: '$k', source: 'Illustrative data', strings: { target: 'plan' } },
});

fixtures.push({
  id: 'mixed-unit-plan-wording', title: 'Percent cells keep their units under a chart currency format', kind: 'example',
  data: { rows: [
    { id: 'amount', label: 'Amount', value: 1250, target: 1500 },
    { id: 'rate', label: 'Rate', value: { pct: 38.5 }, target: { pct: 42 } },
  ] },
  options: {
    title: 'Amount and rate are below plan', source: 'Illustrative data',
    format: '$1,234', sharedScale: 'percentOfTarget',
    strings: { target: 'plan' },
  },
});

fixtures.push({
  // A neutral row has no better side: its zones mirror around 100 %, up to
  // 20 % off either way and more than 20 % off beyond, so 17 % over target
  // reads as off target, not as on target or better.
  id: 'neutral-target-zones', title: 'A neutral row beside higher- and lower-is-better rows in percent of target', kind: 'example',
  data: { rows: [
    { id: 'orders', label: 'Orders', value: 5, target: 6 },
    { id: 'headcount', label: 'Headcount', value: 7, target: 6, direction: 'neutral' },
    { id: 'returns', label: 'Returns', value: 7, target: 6, direction: 'lowerIsBetter' },
  ] },
  options: { title: 'Headcount runs 17% over plan', source: 'Illustrative data', sharedScale: 'percentOfTarget' },
});

fixtures.push({
  // A card of neutral rows only draws no better side: two zones around 100 % and its own band text.
  id: 'neutral-only-target-zones', title: 'Neutral rows only in percent of target', kind: 'example',
  data: { rows: [
    { id: 'headcount', label: 'Headcount', value: 7, target: 6, direction: 'neutral' },
    { id: 'inventory', label: 'Inventory days', value: 41, target: 45, direction: 'neutral' },
  ] },
  options: { title: 'Headcount runs 17% over plan', source: 'Illustrative data', sharedScale: 'percentOfTarget' },
});

// targetColumns: false keeps the target by its tick and the delta at the row end, where columns would fit.
fixtures.push({
  id: 'target-columns-off', title: 'targetColumns false keeps the plot its full width', kind: 'example',
  data: { rows: [
    { id: 'north', label: 'North', value: 412, target: 450, bands: [{ to: 300, label: 'Weak' }, { to: 400, label: 'Fair' }, { to: 500, label: 'Strong' }] },
    { id: 'south', label: 'South', value: 366, target: 340, bands: [{ to: 300, label: 'Weak' }, { to: 400, label: 'Fair' }, { to: 500, label: 'Strong' }] },
  ] },
  options: { title: 'South is the only region above target', unit: '$k', source: 'Illustrative data', targetColumns: false, size: { width: 720 } },
});

// bandKey 'row' on one shared scale: names above each band, the value axis under the rows, the key at the bottom.
fixtures.push({
  id: 'band-names-on-rows', title: "bandKey 'row' names each band on its row, on a shared scale with a value axis", kind: 'example',
  data: { rows: [
    { id: 'east', label: 'East', value: 72, target: 80, bands: [{ to: 50, label: 'Behind' }, { to: 75, label: 'On track' }, { to: 100, label: 'Ahead' }] },
    { id: 'west', label: 'West', value: 88, target: 80, bands: [{ to: 50, label: 'Behind' }, { to: 75, label: 'On track' }, { to: 100, label: 'Ahead' }] },
    { id: 'central', label: 'Central', value: 61, target: 80, bands: [{ to: 50, label: 'Behind' }, { to: 75, label: 'On track' }, { to: 100, label: 'Ahead' }] },
  ] },
  options: {
    title: 'West is the only region ahead of its delivery target', unit: 'orders per day', source: 'Illustrative data',
    sharedScale: true, valueAxis: { show: true }, bandKey: 'row', size: { width: 720 },
  },
});

// Authored column words: the heads and the gap lines in the author's own words, with the comparison word set too.
fixtures.push({
  id: 'column-words-authored', title: 'strings set the target and gap column words', kind: 'example',
  data: { rows: [
    { id: 'north', label: 'North', value: 412, target: 450, bands: [{ to: 300, label: 'Weak' }, { to: 400, label: 'Fair' }, { to: 500, label: 'Strong' }] },
    { id: 'south', label: 'South', value: 366, target: 340, bands: [{ to: 300, label: 'Weak' }, { to: 400, label: 'Fair' }, { to: 500, label: 'Strong' }] },
  ] },
  options: {
    title: 'South is the only region above plan', unit: '$k', source: 'Illustrative data', size: { width: 720 },
    strings: { target: 'plan', targetColumn: 'Plan', gapColumn: 'Distance', gapBelow: 'short of {v1}', gapAbove: 'beyond {v1}', gapOn: 'at {v1}' },
  },
});

registerFixtures('bullet', fixtures);
