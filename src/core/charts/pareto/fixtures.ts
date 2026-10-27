/** Pareto fixtures. Two examples, two torture cases. */

import { registerFixtures } from '../../../fixtures/registry';
import type { Fixture } from '../../registry';

import type { ParetoOptions } from '../../types/options';
import type { ParetoData } from './layout';

/** 24 accounts, decaying — the topN fixture aggregates the tail of 14. */
const ACCOUNTS: [string, number][] = [
  ['Nurthwold Retail Group', 7200],
  ['Energy Company A', 3800],
  ['Ardent Manufacturing', 2400],
  ['Baltic Freight', 1600],
  ['Cassini Health', 1200],
  ['Dorset Foods', 700],
  ['Velkaro Media', 600],
  ['Fjord Logistics', 520],
  ['Insurance Company A', 450],
  ['Velquor Chemicals', 380],
  ['Zelvarin Devices', 180],
  ['Juniper Apparel', 150],
  ['Kestrel Rail', 130],
  ['Lumen Optics', 110],
  ['Brevinth Travel', 95],
  ['Narvetta Software', 85],
  ['Orchid Cosmetics', 75],
  ['Pallas Mining', 65],
  ['Quarry Cement', 55],
  ['Rialto Hospitality', 50],
  ['Sable Automotive', 45],
  ['Tessera Ceramics', 40],
  ['Umbra Security', 35],
  ['Soravel Agritech', 35],
];

export const fixtures: Fixture<ParetoData, ParetoOptions>[] = [
  {
    id: 'period-growth-anchors',
    title: 'FY24 contributes twice FY21, equivalent to 26.0% annual growth',
    kind: 'example',
    tags: ['demo', 'annotation', 'cagr'],
    data: {
      items: [
        { id: 'fy21', label: 'FY21', date: '2021-12-31', value: 100 },
        { id: 'fy22', label: 'FY22', date: '2022-12-31', value: 130 },
        { id: 'fy23', label: 'FY23', date: '2023-12-31', value: 160 },
        { id: 'fy24', label: 'FY24', date: '2024-12-31', value: 200 },
      ],
    },
    options: {
      title: 'FY24 contributes twice FY21',
      subtitle: 'Annual contributions ranked by value; growth runs from FY21 to FY24',
      size: { width: 900, height: 550 },
      unit: 'units',
      annotations: [{ id: 'growth', kind: 'cagr', from: 'fy21', to: 'fy24' }],
      source: 'Illustrative annual contributions',
    },
  },
  {
    id: 'cause-differences',
    title: 'Billing exceeds delivery by 65 cases',
    kind: 'example',
    tags: ['demo', 'annotation', 'diff', 'delta'],
    data: { items: [
      { id: 'billing', label: 'Billing', value: 80 },
      { id: 'delivery', label: 'Delivery', value: 15 },
      { id: 'other', label: 'Other', value: 5 },
    ] },
    options: {
      title: 'Billing exceeds delivery by 65 cases',
      size: { width: 900, height: 550 },
      unit: 'cases',
      annotations: [
        { id: 'gap', kind: 'diff', mode: 'absolute', from: 'delivery', to: 'billing' },
        { id: 'small-gap', kind: 'delta', at: 'delivery', vs: 'other' },
      ],
      source: 'Illustrative support cases',
    },
  },
  {
    id: 'defect-causes',
    title: 'Three of eight causes account for the first 80% of defects',
    kind: 'example',
    tags: ['interaction'],
    hover: { owner: { categoryId: 'alignment', seriesId: 'pareto:value' } },
    data: {
      items: [
        { id: 'misprint', label: 'Misprint', value: 45 },
        { id: 'alignment', label: 'Alignment drift', value: 120 },
        { id: 'adhesive', label: 'Adhesive failure', value: 80 },
        { id: 'scratch', label: 'Surface scratch', value: 25 },
        { id: 'warp', label: 'Panel warp', value: 15 },
        { id: 'labelling', label: 'Labelling error', value: 10 },
        { id: 'packaging', label: 'Packaging damage', value: 3 },
        { id: 'other', label: 'Unclassified', value: 2 },
      ],
    },
    options: {
      size: { width: 720, height: 404 },
      title: 'Where the defects come from',
      subtitle: { measure: 'Defects recorded', period: 'FY25' },
      // The left axis runs to the total, so the curve starts on top of the first column.
      totalScale: true,
      unit: 'defects',
      source: 'Quality log, plant 2',
      // the rest group's name is this example's own wording.
      strings: { others: 'Other causes' },
    },
  },
  {
    // The reference is a convention the author may leave
    // out. The curve stays; no rule, no vital-few highlight, no key.
    id: 'curve-without-threshold',
    title: 'The cumulative curve with no threshold reference and no vital-few split',
    kind: 'example',
    data: {
      items: [
        { id: 'misprint', label: 'Misprint', value: 45 },
        { id: 'alignment', label: 'Alignment drift', value: 120 },
        { id: 'adhesive', label: 'Adhesive failure', value: 80 },
        { id: 'scratch', label: 'Surface scratch', value: 25 },
        { id: 'warp', label: 'Panel warp', value: 15 },
        { id: 'labelling', label: 'Labelling error', value: 10 },
      ],
    },
    options: {
      size: { width: 720, height: 404 },
      title: 'Alignment drift and adhesive failure make up two thirds of defects',
      subtitle: { measure: 'Defects recorded', period: 'FY25' },
      unit: 'defects',
      threshold: false,
      source: 'Quality log, plant 2',
    },
  },
  {
    id: 'revenue-concentration',
    title: 'Five of 24 accounts carry 81% of revenue; the tail of 14 rides in one rest column',
    kind: 'example',
    // On this pinned canvas the names stand vertical in their columns, and the
    // second bar's total finds a seat (a 45° row hides it).
    data: {
      items: ACCOUNTS.map(([label, value], i) => ({ id: `acct-${i + 1}`, label, value })),
    },
    options: {
      size: { width: 720, height: 511 },
      title: 'Revenue concentration by account',
      subtitle: { measure: 'Revenue', period: 'FY25' },
      unit: '$k',
      axisTitles: { primary: 'Revenue, $k' },
      topN: { n: 10, rest: true, restLabel: 'Other accounts', showRestCount: true },
      source: 'Billing extract',
    },
  },
  {
    id: 'torture-pareto-flat',
    title: 'Twelve equal items: no vital few, no highlight, and the exhibit says so',
    kind: 'torture',
    data: {
      items: Array.from({ length: 12 }, (_, i) => ({
        id: `t${i + 1}`,
        label: `Ticket queue ${i + 1}`,
        value: 25,
      })),
    },
    options: {
      title: 'Twelve queues, one flat distribution',
      subtitle: { measure: 'Tickets' },
      unit: 'tickets',
    },
  },
  {
    id: 'torture-pareto-spike',
    title: 'One cause at 99.2%, a zero-count cause, and a 95% threshold',
    kind: 'torture',
    data: {
      items: [
        {
          id: 'auth',
          label: 'Authentication service timeout during peak hours (all regions)',
          value: 992,
        },
        { id: 'cdn', label: 'CDN edge cache miss storm, eu-west only', value: 2 },
        { id: 'db', label: 'Primary database failover', value: 1 },
        { id: 'queue', label: 'Message queue backpressure', value: 1 },
        { id: 'tls', label: 'Expired intermediate TLS certificate', value: 1 },
        { id: 'dns', label: 'DNS resolver flap', value: 1 },
        { id: 'disk', label: 'Disk pressure on the ingest tier', value: 0.5 },
        { id: 'memory', label: 'Memory leak in the report renderer', value: 0.5 },
        { id: 'config', label: 'Bad configuration rollout, staged', value: 0.4 },
        { id: 'thirdparty', label: 'Third-party payment provider degradation', value: 0.3 },
        { id: 'network', label: 'Inter-zone network partition', value: 0.3 },
        { id: 'planned', label: 'Planned maintenance overrun (none recorded)', value: 0 },
      ],
    },
    options: {
      title: 'Minutes of downtime by root cause',
      subtitle: { measure: 'Downtime', period: 'FY25' },
      unit: 'minutes',
      threshold: 95,
    },
  },
];

// Long names at a generous size read whole. The rendered SVG has no ellipsis.
fixtures.push({
  id: 'torture-long-labels',
  title: 'Torture: long names at a generous size read whole, never cut',
  kind: 'torture',
  data: {
    items: [
      {
        id: 'misprint',
        label: 'Enterprise cloud infrastructure, managed hosting and sovereign data-centre services for regulated clients',
        value: 45,
      },
      {
        id: 'alignment',
        label: 'Consumer electronics, wearables and connected home devices sold through retail partners',
        value: 120,
      },
      {
        id: 'adhesive',
        label: 'Industrial automation, robotics and predictive maintenance contracts in continental Europe',
        value: 80,
      },
      {
        id: 'scratch',
        label: 'Healthcare diagnostics, laboratory information systems and point-of-care testing',
        value: 25,
      },
      {
        id: 'warp',
        label: 'Wealth management, private banking and family-office advisory for entrepreneurs',
        value: 15,
      },
      {
        id: 'labelling',
        label: 'Retail deposits and everyday current accounts for households and sole traders',
        value: 10,
      },
      {
        id: 'packaging',
        label: 'Corporate lending incl. syndicated, leveraged and sustainability-linked finance',
        value: 3,
      },
      {
        id: 'other',
        label: 'Logistics, warehousing and last-mile delivery partnerships in metropolitan areas',
        value: 2,
      },
    ],
  },
  options: {
    size: { width: 1440, height: 900 },
    title: 'Long names read whole at a generous size',
    subtitle: { measure: 'Defects recorded', period: 'FY25' },
    unit: 'defects',
    source: 'Quality log, plant 2',
  },
});

// The derivation stated, and the bars without the cumulative curve.
const defectCauses = fixtures.find((fixture) => fixture.id === 'defect-causes')!;
fixtures.push(
  {
    ...defectCauses,
    id: 'defect-causes-method-note',
    title: 'Defect causes with the derivation and the vital few stated',
    tags: ['coverage'],
    // The a4 step (720 x 511) keeps the plot over its 160 px floor under the method note.
    options: { ...defectCauses.options, methodNote: true, size: { width: 720, height: 511 } },
  },
  {
    ...defectCauses,
    id: 'defect-causes-bars-only',
    title: 'Defect causes ranked without the cumulative curve and its threshold',
    tags: ['coverage'],
    options: { ...defectCauses.options, cumulative: false },
  },
);

fixtures.push({
  "id": "authored-fill-key",
  "title": "Cause keys use the authored bar colours",
  "kind": "torture",
  "data": {
    "items": [
      {
        "id": "a",
        "label": "Cause A",
        "value": 70,
        "fill": "#145A72"
      },
      {
        "id": "b",
        "label": "Cause B",
        "value": 20,
        "fill": "#806020"
      },
      {
        "id": "c",
        "label": "Cause C",
        "value": 10,
        "fill": "#806020"
      }
    ]
  },
  "options": {
    "title": "Cause keys use the authored bar colours",
    "source": "Invented example",
    "threshold": 60
  }
});

fixtures.push({
  id: 'rest-curve-only', title: 'A large tail stays in the curve without shrinking the named columns', kind: 'torture',
  data: { items: Array.from({ length: 40 }, (_, i) => ({ id: `cause-${i}`, label: `Cause ${i + 1}`, value: 50 - i })) },
  options: { topN: { n: 5, rest: false }, size: { width: 960, height: 540 }, title: 'Five causes and the remaining tail' },
});

fixtures.push({ id: 'authored-rest', title: 'An authored aggregate remains last', kind: 'torture', data: { items: [{ id: 'a', label: 'Cause A', value: 20 }, { id: 'rest', label: 'Other causes', value: 60, rest: true }, { id: 'b', label: 'Cause B', value: 10 }] }, options: { title: 'Named causes cover one third of the total', size: { width: 900, height: 550 } } });

// Staircase category labels: each cause named over the lower columns to its right (no curve, which climbs through that space).
fixtures.push({
  id: 'staircase-labels',
  title: 'Staircase cause names over sorted columns, without the cumulative curve',
  kind: 'example',
  tags: ['feature:options'],
  data: {
    items: [
      { id: 'late', label: 'Late supplier deliveries', value: 412 },
      { id: 'bom', label: 'Incorrect bill of materials', value: 268 },
      { id: 'setup', label: 'Machine setup errors on the press line', value: 190 },
      { id: 'training', label: 'Operator training gaps', value: 121 },
      { id: 'packaging', label: 'Damaged packaging at inbound', value: 88 },
      { id: 'bins', label: 'Mislabelled bins', value: 61 },
      { id: 'calibration', label: 'Calibration drift', value: 44 },
      { id: 'scanner', label: 'Scanner software faults', value: 30 },
      { id: 'weather', label: 'Weather delays', value: 21 },
      { id: 'other', label: 'Other causes', value: 14 },
    ],
  },
  options: {
    size: { width: 800, height: 560 },
    cumulative: false,
    categoryLabels: 'staircase',
    title: 'Late deliveries and bill-of-materials errors cause most line stops',
    subtitle: { measure: 'Line stops by cause', period: 'FY26' },
    source: 'Illustrative plant log',
  },
});

registerFixtures('pareto', fixtures);
