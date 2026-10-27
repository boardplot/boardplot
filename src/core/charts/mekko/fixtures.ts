/**
 * Mekko fixtures — examples: a %-axis marimekko market map with
 * monochrome-per-player stacks and totals above columns, a unit-axis mekko
 * cost staircase with ridge and Ø weighted-mean value line, and a bar-mekko
 * profit pool.
 * Torture set: 2%-width sliver column, 10 dense columns, single cell,
 * topN + Others, zero-total column guard with negative segments.
 * Every fixture auto-enters the invariant suite.
 */

import { registerFixtures } from '../../../fixtures/registry';
import type { Fixture } from '../../registry';
import type { ChartData } from '../../types/data';
import type { MekkoOptions } from '../../types/options';

export const fixtures: Fixture<ChartData, MekkoOptions>[] = [
  {
    id: 'stacked100-market-map',
    title: '%-axis marimekko market map with ridge on own company',
    kind: 'example',
    tags: ['interaction'],
    hover: { owner: { categoryId: 'americas', seriesId: 'acme' } },
    data: {
      categories: [
        { id: 'americas', label: 'Americas' },
        { id: 'emea', label: 'EMEA' },
        { id: 'apac', label: 'APAC' },
        { id: 'latam', label: 'LatAm' },
      ],
      series: [
        {
          id: 'acme',
          label: 'Acme',
          colorRole: 'highlight',
          unit: 'USD bn',
          values: [6.1, 4.2, 1.8, 0.4],
        },
        { id: 'alpha', label: 'AlphaCo', unit: 'USD bn', values: [4.0, 3.1, 2.9, 0.7] },
        { id: 'beta', label: 'BetaCorp', unit: 'USD bn', values: [2.6, 1.5, 1.2, 0.5] },
        { id: 'gamma', label: 'Gamma', unit: 'USD bn', values: [1.2, 0.9, 0.6, 0.3] },
      ],
    },
    options: {
      variant: 'stacked100',
      ridge: 'acme',
      highlight: 'acme',
      title: 'Acme leads in the two largest markets but trails everywhere in Asia',
      subtitle: {
        company: 'Acme Corp',
        measure: 'Market share by region',
        period: 'FY25',
        scenarios: ['AC'],
      },
      unit: '% of market',
      axisTitles: { primary: 'Market share, %' },
      // At 430 px high the 320 px card's plot falls under half the canvas
      // (refused), and under 480 the 8%
      // Gamma band of the narrow cards is too short for its named share.
      size: { width: 720, height: 511 },
      source: 'Illustrative market sizing FY25; team analysis',
      // No legend: the widest column names each series in place.
      // Each column prints at one precision, whole percents here, so
      // closing the rounding drift costs no decimal (Americas 101%, EMEA 99%).
      rounding: 'sum-consistent',
    },
  },
  {
    id: 'unit-cost-staircase',
    title: 'Unit-axis mekko: cost per unit vs units produced, Ø value line',
    kind: 'example',
    data: {
      categories: [
        { id: 'bu2', label: 'Chassis' },
        { id: 'bu1', label: 'Powertrain' },
        { id: 'bu4', label: 'Interior' },
        { id: 'bu3', label: 'Electronics' },
      ],
      series: [
        // The width measure declares its own unit.
        { id: 'units', label: 'Units produced', role: 'reference', unit: 'thousand units', values: [240, 120, 150, 90] },
        { id: 'labor', label: 'Labor', values: [34, 40, 12, 22] },
        { id: 'material', label: 'Material', values: [30, 34, 11, 22] },
      ],
    },
    options: {
      variant: 'stacked',
      widthSeriesId: 'units',
      sort: { segments: 'sheet' },
      title: 'Scale does not set unit cost: Interior runs at 31% of Powertrain',
      // The subtitle names both measures, height in USD and width in thousand units.
      subtitle: {
        company: 'AutoParts AG',
        measure: 'Cost per unit',
        period: 'width: units produced in thousands · FY25',
        scenarios: ['AC'],
      },
      unit: 'USD',
      source: 'Group controlling FY25; plant MES output',
      legend: 'bottom',
      // At this size the width line, the legend and two-line category labels keep the plot over 60% of the height.
      size: { width: 720, height: 511 },
    },
    annotations: [{ kind: 'valueLine' }],
  },
  {
    id: 'bar-mekko-profit-pool',
    title: 'Bar-mekko profit pool: width = revenue, height = EBIT margin',
    kind: 'example',
    data: {
      categories: [
        { id: 'components', label: 'Components' },
        { id: 'assembly', label: 'Assembly' },
        { id: 'distribution', label: 'Distribution' },
        { id: 'retail', label: 'Retail' },
        { id: 'aftermarket', label: 'Aftermarket' },
      ],
      series: [
        // The width measure declares its own unit; the height is margin in %.
        { id: 'revenue', label: 'Revenue', role: 'reference', unit: '$bn', values: [38, 95, 42, 60, 25] },
        {
          id: 'margin',
          label: 'EBIT margin',
          values: [{ pct: 12.5 }, { pct: 3.2 }, { pct: 6.8 }, { pct: -2.4 }, { pct: 18.9 }],
        },
      ],
    },
    options: {
      variant: 'bar',
      widthSeriesId: 'revenue',
      title: 'Aftermarket earns outsized margin on a tenth of industry revenue',
      // The subtitle names both measures, height in % and width in $bn.
      subtitle: { measure: 'EBIT margin by value-chain step', period: 'width: revenue in $bn · FY25' },
      unit: '%',
      source: 'Annual reports FY25; team analysis',
    },
  },
  {
    id: 'sliver-column',
    title: 'Torture: 2%-width sliver column hides segment labels, totals stay',
    kind: 'torture',
    data: {
      categories: [
        { id: 'de', label: 'Germany' },
        { id: 'fr', label: 'France' },
        { id: 'is', label: 'Iceland' },
        { id: 'uk', label: 'United Kingdom' },
        { id: 'it', label: 'Italy' },
      ],
      series: [
        { id: 'incumbent', label: 'Incumbent', values: [18, 14, 0.6, 15, 11] },
        { id: 'challenger', label: 'Challenger', values: [9, 8, 0.3, 10, 7] },
        { id: 'longtail', label: 'Long tail', values: [4, 3, 0.1, 5, 3] },
      ],
    },
    options: {
      variant: 'stacked100',
      title: 'Sliver column stays overlap-free',
      subtitle: { measure: 'Market share', period: 'FY25' },
      unit: '$bn market',
    },
  },
  {
    id: 'dense-10-columns',
    title: 'Torture: 10 columns with long names, smart density',
    kind: 'torture',
    data: {
      categories: [
        { id: 'c01', label: 'Automotive OEM' },
        { id: 'c02', label: 'Industrial machinery' },
        { id: 'c03', label: 'Consumer electronics' },
        { id: 'c04', label: 'Medical devices' },
        { id: 'c05', label: 'Aerospace & defense' },
        { id: 'c06', label: 'Energy equipment' },
        { id: 'c07', label: 'Rail & transit' },
        { id: 'c08', label: 'Agriculture' },
        { id: 'c09', label: 'Construction' },
        { id: 'c10', label: 'Marine' },
      ],
      series: [
        { id: 'oem', label: 'OEM', values: [42, 31, 28, 18, 15, 12, 9, 8, 6, 3] },
        { id: 'aftermkt', label: 'Aftermarket', values: [21, 18, 9, 12, 11, 7, 6, 4, 3, 2] },
        { id: 'services', label: 'Services', values: [8, 9, 6, 7, 5, 4, 3, 2, 2, 1] },
      ],
    },
    options: {
      variant: 'stacked100',
      labelDensity: 'smart',
      title: 'Dense mekko stays overlap-free',
      subtitle: { measure: 'Revenue mix', period: 'FY25' },
      unit: '$m',
      legend: 'bottom',
    },
  },
  {
    id: 'single-cell',
    title: 'Torture: one category, one series',
    kind: 'torture',
    data: {
      categories: [{ id: 'total', label: 'Group total' }],
      series: [{ id: 'rev', label: 'Revenue', values: [87.5] }],
    },
    options: {
      variant: 'stacked100',
      title: 'Minimal single-column mekko sanity check',
      unit: '$m',
    },
  },
  {
    id: 'topn-others',
    title: 'Torture: topN keeps 4 largest columns, rest into Others (last)',
    kind: 'torture',
    // The readable demo of rounding 'sum-consistent'.
    tags: ['demo'],
    data: {
      categories: [
        { id: 'us', label: 'United States' },
        { id: 'cn', label: 'China' },
        { id: 'jp', label: 'Japan' },
        { id: 'de', label: 'Germany' },
        { id: 'br', label: 'Brazil' },
        { id: 'in', label: 'India' },
        { id: 'kr', label: 'South Korea' },
        { id: 'mx', label: 'Mexico' },
      ],
      series: [
        { id: 'premium', label: 'Premium', values: [44, 38, 16, 14, 6, 5, 7, 4] },
        { id: 'standard', label: 'Standard', values: [31, 42, 12, 11, 8, 9, 5, 5] },
        { id: 'value', label: 'Value', values: [12, 25, 5, 4, 7, 11, 3, 4] },
      ],
    },
    options: {
      variant: 'stacked100',
      topN: { n: 4, rest: true, showRestCount: true },
      title: 'Top-4 markets with Others pinned last',
      subtitle: { measure: 'Segment mix', period: 'FY25' },
      unit: '$bn',
      legend: 'bottom',
      // Every share here prints as a whole percent anyway, so the rounding costs
      // no precision. Rounded on their own, United States printed 51 + 36 + 14
      // = 101% and Japan 48 + 36 + 15 = 99%.
      rounding: 'sum-consistent',
    },
  },
  {
    id: 'stacked100-mixed-sign-fail-closed',
    title: 'Refusal example: percent columns whose values change sign',
    kind: 'torture',
    refuses: { code: 'stacked100-mixed-signs' },
    data: {
      categories: [
        { id: 'north', label: 'North' },
        { id: 'south', label: 'South' },
      ],
      series: [
        { id: 'ops', label: 'Operations', values: [30, 22] },
        { id: 'writeoffs', label: 'Write-offs', values: [-6, -2] },
      ],
    },
    options: {
      variant: 'stacked100',
      title: 'Write-offs make both percent columns non-meaningful',
      subtitle: { measure: 'Contribution mix', period: 'FY25' },
      unit: '$m',
      legend: 'bottom',
    },
  },
  {
    id: 'zero-total-column',
    title: 'Torture: zero-total column guard plus a negative segment',
    kind: 'torture',
    data: {
      categories: [
        { id: 'north', label: 'North' },
        { id: 'dormant', label: 'Dormant' },
        { id: 'south', label: 'South' },
      ],
      series: [
        { id: 'ops', label: 'Operations', values: [30, 0, 22] },
        { id: 'writeoffs', label: 'Write-offs', values: [-6, 0, null] },
      ],
    },
    options: {
      variant: 'stacked',
      title: 'Zero-total column is suppressed without crashing',
      subtitle: { measure: 'Contribution', period: 'FY25' },
      unit: '$m',
    },
  },
];

// Long names at a generous size read whole. The rendered SVG has no
// ellipsis.
fixtures.push({
  id: 'torture-long-labels',
  title: 'Torture: long names at a generous size read whole, never cut',
  kind: 'torture',
  data: {
    categories: [
      {
        id: 'americas',
        label: 'Enterprise cloud infrastructure, managed hosting and sovereign data-centre services for regulated clients',
      },
      {
        id: 'emea',
        label: 'Consumer electronics, wearables and connected home devices sold through retail partners',
      },
      {
        id: 'apac',
        label: 'Industrial automation, robotics and predictive maintenance contracts in continental Europe',
      },
      {
        id: 'latam',
        label: 'Healthcare diagnostics, laboratory information systems and point-of-care testing',
      },
    ],
    series: [
      { id: 'acme', label: 'Acme', colorRole: 'highlight', values: [6.1, 4.2, 1.8, 3.4] },
      { id: 'alpha', label: 'AlphaCo', values: [4, 3.1, 2.9, 2.6] },
      { id: 'beta', label: 'BetaCorp', values: [2.6, 1.5, 1.2, 1.8] },
      { id: 'gamma', label: 'Gamma', values: [1.2, 0.9, 0.6, 1.2] },
    ],
  },
  options: {
    variant: 'stacked100',
    ridge: 'acme',
    highlight: 'acme',
    title: 'Long names read whole at a generous size',
    subtitle: { company: 'Acme Corp', measure: 'Market share by region', period: 'FY25', scenarios: ['AC'] },
    unit: '% of market',
    source: 'Illustrative market sizing FY25',
    legend: 'bottom',
    size: { width: 1440, height: 900 },
  },
});

fixtures.push({
  "id": "percent-format-on-shares",
  "title": "Shares use the percent format and totals stay absolute",
  "kind": "torture",
  "data": {
    "categories": [
      { id: "Batch", label: "Batch" }
    ],
    "series": [
      {
        "id": "s",
        "label": "Widgets",
        "values": [
          75
        ]
      },
      {
        "id": "t",
        "label": "Spares",
        "values": [
          25
        ]
      }
    ]
  },
  "options": {
    "title": "Widgets account for three quarters of the batch",
    "variant": "stacked100",
    "format": "12.3%"
  }
});

fixtures.push({ id: 'rounding-smallest-tie', title: 'Equal-remainder ties favor the smaller share', kind: 'torture', data: { categories: [{ id: 'a', label: 'A' }], series: [{ id: 'large', label: 'Large', unit: '$', values: [4025] }, { id: 'small', label: 'Small', unit: '$', values: [3025] }, { id: 'other', label: 'Other', unit: '$', values: [2025] }, { id: 'tiny', label: 'Smallest', unit: '$', values: [925] }] }, options: { title: 'The smaller share gets the tie adjustment', variant: 'stacked100', rounding: 'sum-consistent', format: '1%', size: { width: 700, height: 400 } } });

registerFixtures('mekko', fixtures);
