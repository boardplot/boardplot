/**
 * Waterfall fixtures: examples (real-looking business data) + torture set
 * (slivers, sign changes, long labels, density stress). Every fixture
 * auto-enters the invariant suite.
 */

import { registerFixtures } from '../../../fixtures/registry';
import type { Fixture } from '../../registry';
import type { WaterfallData } from '../../types/data';
import type { WaterfallOptions } from '../../types/options';

export const fixtures: Fixture<WaterfallData, WaterfallOptions>[] = [
  {
    id: 'ebit-bridge',
    title: 'EBIT bridge FY21→FY24',
    kind: 'example',
    tags: ['interaction'],
    hover: { owner: { categoryId: 'fy21' } },
    data: {
      items: [
        { id: 'fy21', label: 'FY21', type: 'total', value: 142, date: '2021-12-31' },
        { id: 'price', label: 'Price', value: 38 },
        {
          id: 'volume',
          label: 'Volume',
          segments: [
            { id: 'b2b', label: 'B2B', value: 11 },
            { id: 'b2c', label: 'B2C', value: 6 },
          ],
        },
        { id: 'gross', label: 'Gross', type: 'subtotal' },
        { id: 'cost', label: 'Cost', value: -24 },
        { id: 'fx', label: 'FX', value: { number: -6, scenario: 'FC' } },
        // FY24 closes on the FX forecast, so its total is a forecast too: its
        // label names the forecast and the title does not call it grown.
        { id: 'fy24', label: 'FY24F', type: 'total', date: '2024-12-31', scenario: 'FC' },
      ],
    },
    options: {
      title: 'EBIT forecast to grow 5.6% p.a., almost entirely on pricing',
      subtitle: { company: 'Acme Corp', measure: 'EBIT', period: 'FY21–FY24', scenarios: ['AC', 'FC'] },
      unit: '$m',
      source: 'Acme finance actuals; FY24 forecast at forecast FX rates',
      highlight: ['price'],
      labelDensity: 'full',
    },
    annotations: [{ kind: 'cagr' }],
  },
  {
    id: 'interview-status-buildup',
    title: 'Interview pipeline build-up by status',
    kind: 'example',
    data: {
      items: [
        {
          id: 'internal',
          label: 'Internal',
          value: 6,
          segments: [
            { id: 'done', label: 'Done', value: 2, colorRole: 'good' },
            { id: 'scheduled', label: 'Scheduled', value: 2, colorRole: 'warn' },
            { id: 'open', label: 'Open', value: 2, colorRole: 'bad' },
          ],
        },
        {
          id: 'partners',
          label: 'Partner network',
          value: 7,
          segments: [
            { id: 'done', label: 'Done', value: 2, colorRole: 'good' },
            { id: 'scheduled', label: 'Scheduled', value: 2, colorRole: 'warn' },
            { id: 'open', label: 'Open', value: 3, colorRole: 'bad' },
          ],
        },
        {
          id: 'search',
          label: 'Search',
          value: 7,
          segments: [
            { id: 'done', label: 'Done', value: 2, colorRole: 'good' },
            { id: 'scheduled', label: 'Scheduled', value: 2, colorRole: 'warn' },
            { id: 'open', label: 'Open', value: 3, colorRole: 'bad' },
          ],
        },
        {
          id: 'referrals',
          label: 'Referrals',
          value: 8,
          segments: [
            { id: 'done', label: 'Done', value: 2, colorRole: 'good' },
            { id: 'scheduled', label: 'Scheduled', value: 3, colorRole: 'warn' },
            { id: 'open', label: 'Open', value: 3, colorRole: 'bad' },
          ],
        },
        {
          id: 'competition',
          label: 'Competition',
          value: 8,
          segments: [
            { id: 'done', label: 'Done', value: 2, colorRole: 'good' },
            { id: 'scheduled', label: 'Scheduled', value: 3, colorRole: 'warn' },
            { id: 'open', label: 'Open', value: 3, colorRole: 'bad' },
          ],
        },
        { id: 'total', label: 'Total', type: 'total' },
      ],
    },
    options: {
      title: '36 interviews are in flight; 39% remain open',
      subtitle: { measure: 'Candidate interviews by sourcing route and status', period: 'Current pipeline' },
      unit: 'interviews',
      source: 'Illustrative recruiting pipeline',
      legend: 'top',
      size: 'a4',
    },
  },
  {
    id: 'revenue-build-up',
    title: 'Revenue → EBIT build-up with diff arrow',
    kind: 'example',
    data: {
      items: [
        {
          id: 'b2b',
          label: 'B2B',
          segments: [
            { id: 'devices', label: 'Devices', value: 16 },
            { id: 'services', label: 'Services', value: 5 },
          ],
        },
        {
          id: 'b2c',
          label: 'B2C',
          segments: [
            { id: 'devices', label: 'Devices', value: 26 },
            { id: 'services', label: 'Services', value: 3 },
          ],
        },
        { id: 'revenue', label: 'Revenue', type: 'subtotal' },
        {
          id: 'cogs',
          label: 'COGS',
          segments: [
            { id: 'devices', label: 'Devices', value: -12 },
            { id: 'services', label: 'Services', value: -3 },
          ],
        },
        { id: 'gross', label: 'Gross margin', type: 'subtotal' },
        { id: 'sga', label: 'SG&A', value: -12 },
        { id: 'ebit', label: 'EBIT', type: 'total' },
      ],
    },
    options: {
      title: 'Two thirds of gross margin survives to EBIT',
      subtitle: { measure: 'Revenues, costs, totals', period: 'FY24' },
      unit: 'USD bn',
      source: 'Illustrative segment P&L; devices and services split each revenue and cost block',
    },
    annotations: [
      { kind: 'diff', from: 'revenue', to: 'gross', mode: 'relative' },
    ],
  },
  {
    id: 'step-brackets',
    title: 'Brackets over bridge steps print their sums',
    kind: 'example',
    data: {
      items: [
        { id: 'ebit24', label: 'EBIT 2024', type: 'total', value: 412 },
        { id: 'volume', label: 'Volume', value: 64 },
        { id: 'price', label: 'Price', value: 38 },
        { id: 'mix', label: 'Mix', value: -21 },
        { id: 'materials', label: 'Materials', value: -47 },
        { id: 'labour', label: 'Labour', value: -33 },
        { id: 'fx', label: 'FX', value: 12 },
        { id: 'ebit25', label: 'EBIT 2025', type: 'total' },
      ],
    },
    options: {
      title: 'Commercial gains outweigh the cost increases',
      unit: 'USD m',
      source: 'Illustrative bridge; each bracket adds up its steps',
    },
    annotations: [
      { kind: 'bracket', from: 'volume', to: 'mix', label: 'Commercial' },
      { kind: 'bracket', from: 'materials', to: 'labour', label: 'Costs' },
    ],
  },
  {
    id: 'build-down',
    title: 'Build-down: revenue to net income',
    kind: 'example',
    data: {
      items: [
        { id: 'rev', label: 'Revenue', type: 'total', value: 100 },
        { id: 'cogs', label: 'COGS', value: -43 },
        { id: 'wages', label: 'Wages', value: -21 },
        { id: 'opex', label: 'Operating costs', value: -13.5 },
        { id: 'da', label: 'D&A', value: -6.5 },
        { id: 'ebit', label: 'EBIT', type: 'subtotal' },
        { id: 'tax', label: 'Tax', value: -4.2 },
        { id: 'net', label: 'Net income', type: 'total' },
      ],
    },
    options: {
      build: 'down',
      title: 'Less than a sixth of revenue survives to net income',
      subtitle: { measure: 'Revenues, costs, totals', period: 'FY25' },
      unit: 'USD m',
      format: '1,234.0',
      source: 'Illustrative P&L build-down; every step is a share of 100 revenue',
    },
  },
  {
    // no automatic break. false explicitly keeps the default.
    id: 'whole-axis-opt-out',
    title: 'Whole value axis kept with an explicit false',
    kind: 'example',
    data: {
      items: [
        { id: 'fy24', label: 'FY24', type: 'total', value: 1284.6 },
        { id: 'price', label: 'Price', value: 96.4 },
        { id: 'volume', label: 'Volume', value: -142.8 },
        { id: 'cost', label: 'Cost', value: -131.5 },
        { id: 'fy25', label: 'FY25', type: 'total' },
      ],
    },
    options: {
      title: 'EBITDA falls 14% as volume and cost outweigh price',
      unit: '$m',
      valueAxis: { break: false },
      source: 'Illustrative figures',
    },
  },
  {
    id: 'automatic-axis-break',
    title: 'Explicit automatic break makes small steps on a large base easier to compare',
    kind: 'example',
    data: {
      items: [
        { id: 'prior', label: 'FY24', type: 'total', value: 1000 },
        { id: 'price', label: 'Price', value: 50 },
        { id: 'volume', label: 'Volume', value: -20 },
        { id: 'current', label: 'FY25', type: 'total' },
      ],
    },
    options: {
      title: 'Price more than offsets lower volume',
      subtitle: { measure: 'Revenue', period: 'FY24–FY25' },
      unit: '$m',
      valueAxis: { break: 'auto' },
      source: 'Illustrative figures',
    },
  },
  {
    id: 'sliver-segments',
    title: 'Torture: sliver values between giants',
    kind: 'torture',
    data: {
      items: [
        { id: 'start', label: 'Start', type: 'total', value: 500 },
        { id: 'tiny1', label: 'Adj. one', value: 0.4 },
        { id: 'tiny2', label: 'Adj. two', value: -0.7 },
        { id: 'big', label: 'Acquisition', value: 260 },
        { id: 'tiny3', label: 'Rounding', value: 0.2 },
        { id: 'end', label: 'End', type: 'total' },
      ],
    },
    options: { title: 'Sliver deltas must keep readable labels' },
  },
  {
    id: 'zero-crossing',
    title: 'Torture: running level crosses zero',
    kind: 'torture',
    data: {
      items: [
        { id: 'open', label: 'Opening', type: 'total', value: 30 },
        { id: 'loss1', label: 'Write-down', value: -55 },
        { id: 'mid', label: 'Position', type: 'subtotal' },
        { id: 'gain', label: 'Disposal gain', value: 70 },
        { id: 'loss2', label: 'Provision', value: -18 },
        { id: 'close', label: 'Closing', type: 'total' },
      ],
    },
    options: { title: 'Negative subtotal anchors below the baseline' },
  },
  {
    id: 'long-labels-many-items',
    title: 'Torture: 12 items, verbose category labels',
    kind: 'torture',
    data: {
      items: [
        { id: 'fy23', label: 'Full year 2023 reported baseline', type: 'total', value: 812 },
        { id: 'd1', label: 'Volume and mix effects in core markets', value: 46 },
        { id: 'd2', label: 'Pricing carryover from prior-year increases', value: 31 },
        { id: 'd3', label: 'Raw material cost inflation', value: -58 },
        { id: 'd4', label: 'Energy surcharges (contracted)', value: -12 },
        { id: 'd5', label: 'Logistics normalization', value: 9 },
        { id: 'sub', label: 'Operational subtotal', type: 'subtotal' },
        { id: 'd6', label: 'Restructuring program savings', value: 27 },
        { id: 'd7', label: 'One-off legal settlement', value: -19 },
        { id: 'd8', label: 'Currency translation effects', value: -7 },
        { id: 'd9', label: 'Portfolio changes net', value: 4 },
        { id: 'fy24', label: 'Full year 2024 reported', type: 'total' },
      ],
    },
    // Twelve long names read in full as wrapped row names of a
    // horizontal bridge, and the break the engine suggests lifts the steps
    // off the 812 base.
    options: { title: 'Dense bridge stays overlap-free', labelDensity: 'smart', variant: 'horizontal', valueAxis: { break: { from: 41, to: 800 } } },
  },
  {
    id: 'single-delta',
    title: 'Torture: minimal two-item bridge',
    kind: 'torture',
    data: {
      items: [
        { id: 'a', label: 'Before', type: 'total', value: 10 },
        { id: 'b', label: 'Change', value: 2.5 },
      ],
    },
    options: { title: 'One change of +2.5 on a base of 10' },
  },
  {
    id: 'mixed-sign-segments',
    title: 'Torture: one item with positive and negative segments',
    kind: 'torture',
    data: {
      items: [
        { id: 'open', label: 'Open', type: 'total', value: 60 },
        {
          id: 'net',
          label: 'Net effect',
          segments: [
            { id: 'up', label: 'Up', value: 25 },
            { id: 'down', label: 'Down', value: -33 },
          ],
        },
        { id: 'close', label: 'Close', type: 'total' },
      ],
    },
    options: { title: 'Connector follows the mathematical sum' },
  },
  {
    id: 'segment-cascade-horizontal',
    title: 'Seven-row horizontal cascade ends at the computed total',
    kind: 'example',
    data: {
      items: [
        { id: 'base', label: 'Starting run-rate', type: 'total', value: 74 },
        { id: 'core', label: 'Core growth', value: 18 },
        { id: 'upsell', label: 'Upsell', value: 9 },
        { id: 'churn', label: 'Churn', value: -11 },
        { id: 'price', label: 'Pricing', value: 7 },
        { id: 'fx', label: 'FX', value: -4 },
        { id: 'exit', label: 'Exit run-rate', type: 'total' },
      ],
    },
    options: {
      variant: 'horizontal',
      title: 'Core growth and pricing lift the exit run-rate to 93',
      subtitle: { measure: 'Annualized revenue bridge', period: 'FY26 plan' },
      unit: '$m',
      source: 'Illustrative segment plan',
      labelDensity: 'full',
    },
  },
  {
    id: 'horizontal-net-negative',
    title: 'Torture: a horizontal mixed-sign cascade closes below zero',
    kind: 'torture',
    data: {
      items: [
        { id: 'opening', label: 'Opening', type: 'total', value: 20 },
        { id: 'gain', label: 'Gain', value: 5 },
        { id: 'loss', label: 'Loss', value: -32 },
        { id: 'recovery', label: 'Recovery', value: 3 },
        { id: 'closing', label: 'Closing', type: 'total' },
      ],
    },
    options: {
      variant: 'horizontal',
      title: 'The bridge closes below zero after the loss outweighs recovery',
      labelDensity: 'full',
    },
  },
  {
    id: 'horizontal-pure-negative-tiny',
    title: 'Torture: pure-negative tiny magnitudes remain visible horizontally',
    kind: 'torture',
    data: {
      items: [
        { id: 'zero', label: 'Zero', type: 'total', value: 0 },
        { id: 'tiny-a', label: 'Tiny A', value: -1e-13 },
        { id: 'tiny-b', label: 'Tiny B', value: -2e-13 },
        { id: 'net', label: 'Net', type: 'total' },
      ],
    },
    options: {
      variant: 'horizontal',
      title: 'Tiny negative contributions retain their relative width',
      format: '0.0000000000000',
      labelDensity: 'full',
    },
  },
];

const splitBridge = fixtures.find((fixture) => fixture.id === 'ebit-bridge')!;
for (const [mode, width] of [['full', 1051], ['compact', 493]] as const) {
  const sized = {
    ...splitBridge,
    id: `ebit-bridge-${mode}`,
    title: `Split waterfall labels in ${mode} mode`,
    // The compact card takes its own height: a fixed 16:9 slot (277 px) left a 30 px plot once
    // the title wraps, the key stays and the unlabelled CAGR is named in the frame.
    options: { ...splitBridge.options, mode, size: mode === 'full' ? { width, height: width * 9 / 16 } : { width },
      theme: { preset: 'standard' as const, overrides: {
        type: { family: "'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif" }, legend: { auto: true },
      } },
      canvas: { margin: { top: 0, right: 0, bottom: 0, left: 0 } } },
  };
  fixtures.push(sized);
}

// Long names at a generous size read whole. The rendered SVG has no ellipsis.
fixtures.push({
  id: 'torture-long-labels',
  title: 'Torture: long names at a generous size read whole, never cut',
  kind: 'torture',
  data: {
    items: [
      {
        id: 'fy21',
        label: 'Opening EBIT for the financial year 2021 as reported',
        type: 'total',
        value: 142,
        date: '2021-12-31',
      },
      { id: 'price', label: 'Price increases on the core product range in all regions', value: 38 },
      {
        id: 'volume',
        label: 'Volume growth in the business and consumer channels',
        segments: [{ id: 'b2b', label: 'B2B', value: 11 }, { id: 'b2c', label: 'B2C', value: 6 }],
      },
      { id: 'gross', label: 'Gross profit after price and volume effects', type: 'subtotal' },
      { id: 'cost', label: 'Higher input costs for energy, freight and packaging', value: -24 },
      {
        id: 'fx',
        label: 'Currency translation at forecast exchange rates',
        value: { number: -6, scenario: 'FC' },
      },
      {
        id: 'fy24',
        label: 'Closing EBIT for the financial year 2024 as forecast',
        type: 'total',
        date: '2024-12-31',
        scenario: 'FC',
      },
    ],
  },
  options: {
    title: 'Long names read whole at a generous size',
    subtitle: { company: 'Acme Corp', measure: 'EBIT', period: 'FY21–FY24', scenarios: ['AC', 'FC'] },
    unit: '$m',
    source: 'Acme finance actuals; FY24 forecast at forecast FX rates',
    highlight: ['price'],
    labelDensity: 'full',
    size: { width: 1440, height: 900 },
  },
});

/**
 * Sign-coloured bridge: totals in color.total, rises in
 * goodFill, falls in badFill, dotted meta connectors, signed labels in the
 * sign's ink. One bar per step.
 */
fixtures.push({
  id: 'sign-bridge',
  title: 'EBIT bridge with sign-coloured steps from marks.bridge',
  kind: 'example',
  data: {
    items: [
      { id: 'fy24', label: 'EBIT FY24', type: 'total', value: 142 },
      { id: 'pricing', label: 'Pricing', value: 38 },
      { id: 'volume', label: 'Volume', value: 12 },
      { id: 'cost', label: 'Cost', value: -24 },
      { id: 'other', label: 'Other', value: -3 },
      { id: 'fy25', label: 'EBIT FY25', type: 'total' },
    ],
  },
  options: {
    title: 'EBIT grew almost entirely by pricing',
    subtitle: { measure: 'EBIT', period: 'FY24 → FY25' },
    unit: '$M',
    theme: { preset: 'standard', overrides: { marks: { bridge: 'sign' } } },
    source: 'Illustrative data',
    size: { width: 720, height: 405 },
  },
});

// a cost bridge judges its steps lower-is-better, so a rise paints
// bad and a saving good; signColor false keeps every step in the neutral.
fixtures.push({
  id: 'cost-bridge-lower-is-better',
  title: 'Cost bridge: a rise paints bad and a saving good under lowerIsBetter',
  kind: 'example',
  data: {
    items: [
      { id: 'fy24', label: 'Cost FY24', type: 'total', value: 32 },
      { id: 'wages', label: 'Wages', value: 7, direction: 'lowerIsBetter' },
      { id: 'energy', label: 'Energy', value: 3, direction: 'lowerIsBetter' },
      { id: 'sourcing', label: 'Sourcing', value: -9, direction: 'lowerIsBetter' },
      { id: 'fy25', label: 'Cost FY25', type: 'total' },
    ],
  },
  options: {
    title: 'Sourcing savings absorb most of the wage rise',
    subtitle: { measure: 'Operating cost', period: 'FY24 → FY25' },
    unit: '$M',
    source: 'Illustrative data',
  },
});
fixtures.push({
  id: 'neutral-steps',
  title: 'signColor false keeps every step in the neutral',
  kind: 'example',
  data: fixtures.find((fixture) => fixture.id === 'sign-bridge')!.data,
  options: { title: 'EBIT grew almost entirely by pricing', unit: '$M', source: 'Illustrative data', signColor: false, axisTitles: { primary: 'EBIT, $M' } },
});

// Two cases in one bridge, as a consulting bridge chart draws
// them — each step shows both, each case keeps its own levels and colour.
fixtures.push({
  id: 'two-case-budget-bridge',
  title: 'Two cases side by side in each step: a conservative and an aggressive budget',
  kind: 'example',
  data: {
    cases: [{ id: 'conservative', label: 'Conservative' }, { id: 'aggressive', label: 'Aggressive' }],
    items: [
      { id: 'fy25', label: 'FY25 budget', type: 'total', values: [120, 120] },
      { id: 'hiring', label: 'Hiring', values: [8, 18] },
      { id: 'media', label: 'Media', values: [5, 14] },
      { id: 'tools', label: 'Tools', values: [3, 4] },
      { id: 'savings', label: 'Savings', values: [-9, -6] },
      { id: 'fy26', label: 'FY26 budget', type: 'total' },
    ],
  },
  options: {
    title: 'The aggressive plan ends 23 m above the conservative one',
    subtitle: { measure: 'Marketing budget', period: 'FY25 to FY26' },
    unit: '$m',
    source: 'Illustrative planning cases',
  },
});
fixtures.push({
  id: 'two-case-budget-bars',
  title: 'The two-case bridge as bars: each value stands past the end of its own bar',
  kind: 'example',
  data: fixtures.find((fixture) => fixture.id === 'two-case-budget-bridge')!.data,
  options: {
    title: 'The aggressive plan ends 23 m above the conservative one',
    subtitle: { measure: 'Marketing budget', period: 'FY25 to FY26' },
    unit: '$m',
    source: 'Illustrative planning cases',
    variant: 'horizontal',
  },
});

fixtures.push({
  "id": "single-segment-authored-format",
  "title": "One segment prints one value at the authored precision",
  "kind": "example",
  "data": {
    "items": [
      {
        "id": "open",
        "label": "Opening",
        "type": "total",
        "value": 42
      },
      {
        "id": "step",
        "label": "Added",
        "segments": [
          {
            "id": "s",
            "label": "Widgets",
            "value": {
              "number": 14,
              "format": "1.0"
            }
          }
        ]
      },
      {
        "id": "close",
        "label": "Closing",
        "type": "total"
      }
    ]
  },
  "options": {
    "title": "Added widgets raise the closing level",
    "format": "0"
  }
});

fixtures.push({
  "id": "repeated-segment-key",
  "title": "Equal segment names and colours share one key",
  "kind": "torture",
  "data": {
    "items": [
      {
        "id": "open",
        "label": "Opening",
        "type": "total",
        "value": 40
      },
      {
        "id": "x",
        "label": "Step A",
        "type": "delta",
        "segments": [
          {
            "id": "a",
            "label": "Gain",
            "value": 7,
            "colorRole": "good"
          }
        ]
      },
      {
        "id": "y",
        "label": "Step B",
        "type": "delta",
        "segments": [
          {
            "id": "b",
            "label": "Gain",
            "value": 9,
            "colorRole": "good"
          }
        ]
      }
    ]
  },
  "options": {
    "title": "Equal segment names and colours share one key",
    "source": "Invented example"
  }
});

registerFixtures('waterfall', fixtures);
