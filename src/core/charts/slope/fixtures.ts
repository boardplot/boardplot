/**
 * Slope fixtures — examples cover the two canonical consulting uses (market
 * share shift with one highlighted winner; cost-per-unit where lower is
 * better; a twelve-vendor market whose tail folds into one 'Other' line);
 * torture set covers a 20-series dense end-label spread, two
 * identical flat series, the >2-categories lint-error path (first/last still
 * render), and a single series with a default-span CAGR arrow.
 * Every fixture auto-enters the invariant suite.
 */

import { registerFixtures } from '../../../fixtures/registry';
import type { Fixture } from '../../registry';
import type { SlopeChartData } from '../../types/data';
import type { SlopeOptions } from '../../types/options';

export const fixtures: Fixture<SlopeChartData, SlopeOptions>[] = [
  {
    id: 'market-share-shift',
    title: 'Market share slope 2020 → 2025, nine players, one highlighted',
    kind: 'example',
    tags: ['interaction'],
    hover: { owner: { categoryId: '2020', seriesId: 'nexumcloud' } },
    data: {
      categories: [
        { id: '2020', label: '2020', date: '2020-12-31' },
        { id: '2025', label: '2025', date: '2025-12-31' },
      ],
      series: [
        { id: 'nexumcloud', label: 'NexumCloud', values: [11.2, 24.6] },
        { id: 'software-a', label: 'Software Company A', values: [22.4, 19.8] },
        { id: 'software-b', label: 'Software Company B', values: [18.9, 15.2] },
        { id: 'software-c', label: 'Software Company C', values: [12.6, 11.4] },
        { id: 'brindlevo', label: 'Brindlevo Apps', values: [9.8, 8.9] },
        { id: 'praxida', label: 'Praxida', values: [8.4, 7.6] },
        { id: 'quentaro', label: 'Quentaro', values: [6.1, 5.3] },
        { id: 'brevinth', label: 'Brevinth Software', values: [5.9, 4.1] },
        { id: 'others', label: 'All others', values: [4.7, 3.1] },
      ],
    },
    options: {
      title: 'NexumCloud more than doubles its share while every incumbent loses ground',
      subtitle: {
        company: 'Illustrative market tracker',
        measure: 'Market share',
        period: '2020 vs 2025',
      },
      unit: '% of global ERP seats',
      source: 'Illustrative ERP seat tracker, May 2026',
      // At 720 wide the two name/value rails leave the plot at 0.58 of the
      // canvas width, under the 0.62 side-column floor; the rails are absolute
      // text, so the wider canvas restores the ratio without touching a label.
      // The height is left to the content.
      size: { width: 900 },
      highlight: 'nexumcloud',
      change: 'absolute',
    },
  },
  {
    id: 'cost-per-unit-plants',
    title: 'Cost per unit by plant FY22 → FY25 — lower is better',
    kind: 'example',
    data: {
      categories: [
        { id: 'fy22', label: 'FY22', date: '2022-12-31' },
        { id: 'fy25', label: 'FY25', date: '2025-12-31' },
      ],
      series: [
        { id: 'gdansk', label: 'Gdańsk', values: [23.4, 19.2] },
        { id: 'leipzig', label: 'Leipzig', values: [24.1, 25.8] },
        { id: 'lyon', label: 'Lyon', values: [26.8, 27.9] },
        { id: 'coventry', label: 'Coventry', values: [28.2, 30.6] },
        { id: 'valencia', label: 'Valencia', values: [25.3, 24.7] },
        { id: 'ostrava', label: 'Ostrava', values: [21.9, 21.1] },
      ],
    },
    options: {
      title: 'Gdańsk cuts unit cost 18% while Leipzig, Lyon and Coventry drift upward',
      subtitle: {
        company: 'Brevinth Manufacturing',
        measure: 'Fully loaded cost per unit',
        period: 'FY22 vs FY25',
      },
      unit: '$/unit',
      source: 'Plant controlling, FY25 close — lower is better',
      highlight: 'gdansk',
    },
  },
  {
    id: 'fold-other',
    title: "Twelve vendors, the seven under 5% folded into one 'Other' line",
    kind: 'example',
    data: {
      categories: [
        { id: '2022', label: '2022', date: '2022-12-31' },
        { id: '2026', label: '2026', date: '2026-12-31' },
      ],
      series: [
        { id: 'avronde', label: 'Avronde', values: [21.5, 25.4] },
        { id: 'brightpath', label: 'Brightpath', values: [18.2, 17.1] },
        { id: 'corvid', label: 'Corvid Systems', values: [15.6, 14.2] },
        { id: 'deltaworks', label: 'Delta Works', values: [12.4, 11.8] },
        { id: 'evermore', label: 'Evermore', values: [9.8, 8.6] },
        { id: 'fernhill', label: 'Fernhill', values: [4.6, 3.9] },
        { id: 'granite', label: 'Granite', values: [4.2, 3.4] },
        { id: 'velquor', label: 'Velquor', values: [3.9, 3.0] },
        { id: 'ironwood', label: 'Ironwood', values: [3.4, 2.8] },
        { id: 'vendor-j', label: 'Vendor J', values: [2.9, 4.2] },
        { id: 'kestrel', label: 'Kestrel', values: [2.2, 2.2] },
        { id: 'larkspur', label: 'Larkspur', values: [1.3, 3.4] },
      ],
    },
    options: {
      title: 'Avronde adds 3.9 points; the seven smallest vendors together hold 22.9%',
      subtitle: {
        company: 'Illustrative market tracker',
        measure: 'Market share',
        period: '2022 vs 2026',
      },
      unit: '% of installed seats',
      source: 'Illustrative vendor tracker, September 2026',
      // Twelve rails of name and value do not fit the default canvas without
      // eating the plot; the market-share example carries the same
      // width for the same reason.
      size: { width: 900, height: 506 },
      // A share, not a percent: five percent of the endpoint total.
      foldBelowShare: 0.05,
      highlight: 'avronde',
    },
  },
  {
    id: 'dense-20-series',
    title: 'Torture: 20 series force the end-label spread to drop by priority',
    kind: 'torture',
    data: {
      categories: [
        { id: '2023', label: '2023' },
        { id: '2026', label: '2026' },
      ],
      series: [
        { id: 'hamburg', label: 'Hamburg', values: [41.2, 44.8] },
        { id: 'munich', label: 'Munich', values: [39.6, 38.1] },
        { id: 'berlin', label: 'Berlin', values: [38.4, 42.3] },
        { id: 'cologne', label: 'Cologne', values: [36.8, 35.9] },
        { id: 'frankfurt', label: 'Frankfurt', values: [35.2, 36.4] },
        { id: 'stuttgart', label: 'Stuttgart', values: [33.9, 32.2] },
        { id: 'duesseldorf', label: 'Düsseldorf', values: [32.5, 33.1] },
        { id: 'leipzig', label: 'Leipzig', values: [31.1, 34.6] },
        { id: 'dortmund', label: 'Dortmund', values: [29.8, 28.7] },
        { id: 'essen', label: 'Essen', values: [28.6, 27.9] },
        { id: 'bremen', label: 'Bremen', values: [27.4, 26.2] },
        { id: 'dresden', label: 'Dresden', values: [26.1, 29.3] },
        { id: 'hanover', label: 'Hanover', values: [24.9, 24.1] },
        { id: 'nuremberg', label: 'Nuremberg', values: [23.6, 22.8] },
        { id: 'duisburg', label: 'Duisburg', values: [22.3, 21.4] },
        { id: 'bochum', label: 'Bochum', values: [21.2, 20.6] },
        { id: 'wuppertal', label: 'Wuppertal', values: [20.1, 19.2] },
        { id: 'bielefeld', label: 'Bielefeld', values: [18.9, 19.6] },
        { id: 'bonn', label: 'Bonn', values: [17.8, 18.4] },
        { id: 'muenster', label: 'Münster', values: [16.5, 17.1] },
      ],
    },
    options: {
      // The title says what the engine does, not more. "Overlap-free at 20
      // branches" would be a legibility claim the render does not meet: seven
      // of the twenty branches have BOTH endpoint labels suppressed and no
      // legend. "Leipzig gains most" would be a false DATA claim: Leipzig is
      // third by absolute gain (Berlin +3.90, Hamburg +3.60, Leipzig +3.50) and
      // second by percentage (Dresden +12.26%, Leipzig +11.25%), so it gains
      // most on no measure. Both numerals are computed from the render, and the
      // layout emits `series-unnamed` naming all seven branches on the CLI.
      title: 'Twenty branches named at both ends; Leipzig climbs from 31.1 to 34.6',
      subtitle: { measure: 'Branch revenue', period: '2023 vs 2026 plan' },
      unit: '$m',
      highlight: 'leipzig',
    },
  },
  {
    id: 'flat-identical-pair',
    title: 'Torture: two series with identical flat values',
    kind: 'torture',
    data: {
      categories: [
        { id: 'h1', label: 'H1' },
        { id: 'h2', label: 'H2' },
      ],
      series: [
        { id: 'alpha', label: 'Alpha region', values: [47.5, 47.5] },
        { id: 'beta', label: 'Beta region', values: [47.5, 47.5] },
      ],
    },
    options: {
      title: 'Perfectly flat, perfectly overlapping — labels must still separate',
      subtitle: { measure: 'Utilization', period: 'FY26 half-years' },
      unit: '%',
    },
  },
  {
    id: 'too-many-categories',
    title: 'Refusal example: a slope chart given four periods instead of two',
    kind: 'torture',
    refuses: { code: 'slope-too-many-points' },
    data: {
      categories: [
        { id: 'q1', label: 'Q1' },
        { id: 'q2', label: 'Q2' },
        { id: 'q3', label: 'Q3' },
        { id: 'q4', label: 'Q4' },
      ],
      series: [
        { id: 'north', label: 'North', values: [12, 14, 15, 18] },
        { id: 'south', label: 'South', values: [16, 15, 13, 11] },
        { id: 'west', label: 'West', values: [9, 10, 12, 12] },
      ],
    },
    options: {
      title: 'Quarterly data pushed into a slope — lint routes to line',
      subtitle: { measure: 'Order intake', period: 'FY26 by quarter' },
      unit: '$m',
    },
  },
  {
    id: 'single-series-cagr',
    title: 'Torture: single series with default-span CAGR arrow',
    kind: 'torture',
    data: {
      categories: [
        { id: 'fy20', label: 'FY20', date: '2020-12-31' },
        { id: 'fy25', label: 'FY25', date: '2025-12-31' },
      ],
      series: [{ id: 'arr', label: 'ARR', values: [48, 121] }],
    },
    options: {
      title: 'ARR compounds at ~20% p.a. over five years',
      subtitle: { company: 'Corlenta SaaS', measure: 'ARR', period: 'FY20 vs FY25' },
      unit: '$m',
      source: 'Corlenta audited accounts',
    },
    annotations: [{ kind: 'cagr' }],
  },
];

// Long names at a generous size read whole. The rendered SVG has no ellipsis.
fixtures.push({
  id: 'torture-long-labels',
  title: 'Torture: long names at a generous size read whole, never cut',
  kind: 'torture',
  data: {
    categories: [
      { id: 'fy22', label: 'FY22', date: '2022-12-31' },
      { id: 'fy25', label: 'FY25', date: '2025-12-31' },
    ],
    series: [
      {
        id: 'gdansk',
        label: 'Enterprise cloud infrastructure, managed hosting and sovereign data-centre services for regulated clients',
        values: [23.4, 19.2],
      },
      {
        id: 'leipzig',
        label: 'Consumer electronics, wearables and connected home devices sold through retail partners',
        values: [24.1, 25.8],
      },
      {
        id: 'lyon',
        label: 'Industrial automation, robotics and predictive maintenance contracts in continental Europe',
        values: [26.8, 27.9],
      },
      {
        id: 'coventry',
        label: 'Healthcare diagnostics, laboratory information systems and point-of-care testing',
        values: [28.2, 30.6],
      },
      {
        id: 'valencia',
        label: 'Wealth management, private banking and family-office advisory for entrepreneurs',
        values: [25.3, 24.7],
      },
      {
        id: 'ostrava',
        label: 'Retail deposits and everyday current accounts for households and sole traders',
        values: [21.9, 21.1],
      },
    ],
  },
  options: {
    title: 'Long names read whole at a generous size',
    subtitle: {
      company: 'Brevinth Manufacturing',
      measure: 'Fully loaded cost per unit',
      period: 'FY22 vs FY25',
    },
    unit: '$/unit',
    source: 'Plant controlling, FY25 close — lower is better',
    highlight: 'gdansk',
    size: { width: 1440, height: 900 },
  },
});

/**
 * The market-share example pinned to a 900 x 506 canvas: a tall plot keeps
 * the 6.1 and 5.9 end dots apart, so the receded-line sweep measures each dot
 * on the page and not on its neighbour. The catalog example takes its
 * content height.
 */
fixtures.push({
  ...fixtures.find((entry) => entry.id === 'market-share-shift')!,
  kind: 'torture', id: 'market-share-shift-pinned',
  tags: ['coverage'],
  hover: undefined,
  title: 'Market share slope on a pinned 900 x 506 canvas',
  options: { ...fixtures.find((entry) => entry.id === 'market-share-shift')!.options, size: { width: 900, height: 506 } },
});

/** Slope rails in their own role, held to 3:1 on the background. */
fixtures.push({
  ...fixtures.find((entry) => entry.id === 'market-share-shift')!,
  kind: 'torture', id: 'reference-rails',
  tags: [],
  hover: undefined,
  title: 'Slope rails in color.reference, the ink at 50 % over the page, the lightest mix that holds 3:1',
  options: {
    ...fixtures.find((entry) => entry.id === 'market-share-shift')!.options,
    theme: { preset: 'standard', overrides: { color: { reference: '#878D93' } } },
  },
});

// A key above the plot, one of the two legend values slope accepts.
const plantCost = fixtures.find((fixture) => fixture.id === 'cost-per-unit-plants')!;
fixtures.push({
  ...plantCost,
  id: 'cost-per-unit-plants-key-top', kind: 'torture',
  title: 'The plant slopes with a key above the plot',
  tags: ['coverage'],
  options: { ...plantCost.options, legend: 'top' },
});

fixtures.push({
  "id": "cell-value-label",
  "title": "A value override keeps the series name",
  "kind": "torture",
  "data": {
    "categories": [
      { id: "Before", label: "Before" },
      { id: "After", label: "After" }
    ],
    "series": [
      {
        "id": "s",
        "label": "Widgets",
        "values": [
          {
            "number": 18,
            "label": "Low ${value}"
          },
          {
            "number": 27,
            "label": "High"
          }
        ]
      }
    ]
  },
  "options": {
    "title": "Widget output rises across the two periods"
  }
});

// Variant 'diverging'. Invented data.
fixtures.push({
  id: 'diverging-regions',
  title: "Diverging slope: outlook by region, two waves",
  kind: 'example',
  data: {
    categories: [{ id: 'mar', label: 'Mar 2026' }, { id: 'jun', label: 'Jun 2026' }],
    series: [
      { id: 'nordics', label: 'Nordics', values: [44, 51], negative: [21, 17] },
      { id: 'iberia', label: 'Iberia', values: [52, 63], negative: [14, 8] },
      { id: 'baltics', label: 'Baltic states', values: [31, 42], negative: [33, 24], footnote: 1 },
      { id: 'alpine', label: 'Alpine region', values: [24, 29], negative: [47, 39] },
      { id: 'benelux', label: 'Benelux', values: [35, 33], negative: [29, 34] },
      { id: 'balkans', label: 'Western Balkans', values: [18, 22], negative: [51, 43], footnote: 2 },
    ],
  },
  options: {
    variant: 'diverging',
    diverging: { labels: { positive: 'Better', negative: 'Worse' }, sort: 'positive' },
    title: 'The outlook brightened since March in every region except Benelux',
    subtitle: { measure: 'Expected change in business conditions, next 6 months' },
    unit: '% of respondents',
    footnotes: ['Estonia, Latvia and Lithuania.', 'Six countries; small samples pooled.'],
    source: 'Illustrative survey data',
    // the height is left to the panels (the 539 px pin refused 480 px).
    size: { width: 960 },
  },
});

fixtures.push({
  id: 'diverging-team-engagement',
  title: 'Diverging slope: engagement by team, one low base',
  kind: 'example',
  data: {
    categories: [{ id: 'w1', label: 'Wave 1' }, { id: 'w2', label: 'Wave 2' }],
    series: [
      { id: 'sales', label: 'Sales', values: [58, 64], negative: [18, 14], n: [142, 137] },
      { id: 'ops', label: 'Operations', values: [49, 47], negative: [24, 28], n: [210, 204] },
      { id: 'product', label: 'Product and engineering', values: [66, 71], negative: [12, 9], n: [96, 101] },
      { id: 'finance', label: 'Finance', values: [61, 55], negative: [15, 22], n: [21, 18] },
      { id: 'service', label: 'Customer service', values: [41, 52], negative: [35, 23], n: [175, 181] },
    ],
  },
  options: {
    variant: 'diverging',
    diverging: { labels: { positive: 'Favourable', negative: 'Unfavourable' } },
    title: 'Engagement rose in three of five teams; Customer service gained most',
    subtitle: { measure: 'I would recommend this company as a place to work' },
    unit: '% of respondents',
    source: 'Illustrative employee survey',
  },
});

// Coverage: the other panel orders, and the plain variant named outright.
const regions = fixtures.find((fixture) => fixture.id === 'diverging-regions')!;
fixtures.push({
  ...regions,
  id: 'diverging-sort-net',
  title: 'Diverging panels sorted by net score',
  tags: ['coverage'],
  options: { ...regions.options, diverging: { labels: { positive: 'Better', negative: 'Worse' }, sort: 'net' } },
});
fixtures.push({
  ...regions,
  id: 'diverging-sort-data',
  title: 'Diverging panels in data order, no net',
  tags: ['coverage'],
  options: { ...regions.options, diverging: { labels: { positive: 'Better', negative: 'Worse' }, sort: 'data', net: false } },
});
fixtures.push({
  ...plantCost,
  kind: 'torture', id: 'cost-per-unit-plants-variant-lines',
  title: "Plant slopes with variant 'lines'",
  tags: ['coverage'],
  options: { ...plantCost.options, variant: 'lines' },
});

registerFixtures('slope', fixtures);
