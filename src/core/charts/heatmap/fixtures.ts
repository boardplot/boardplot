/**
 * Heatmap fixtures: the two canonical consulting exhibits (capability
 * assessment matrix with Harvey balls; monthly regional
 * performance heatmap with red-side negatives) + torture set (single row,
 * single column, all-equal values, a dense 20×12 grid, missing
 * cells). Every fixture auto-enters the invariant suite.
 */

import { registerFixtures } from '../../../fixtures/registry';
import type { Fixture } from '../../registry';
import type { HeatmapData } from '../../types/data';
import type { HeatmapOptions } from '../../types/options';

export const fixtures: Fixture<HeatmapData, HeatmapOptions>[] = [
  {
    id: 'harvey-quarter-steps',
    title: 'Harvey balls from empty to full in theme highlight',
    kind: 'example',
    tags: ['interaction'],
    hover: { owner: { categoryId: 'zero', seriesId: 'level' } },
    data: {
      categories: [{ id: 'zero', label: 'Absent' }, { id: 'one', label: 'Basic' }, { id: 'two', label: 'Developing' }, { id: 'three', label: 'Advanced' }, { id: 'four', label: 'Leading' }],
      series: [{ id: 'level', label: 'Maturity', values: [0, 1, 2, 3, 4] }],
    },
    options: {
      variant: 'harvey',
      scale: 'discrete',
      title: 'Five maturity levels',
      source: 'Illustrative maturity scale from 0 to 4',
    },
  },
  {
    id: 'capability-matrix',
    title: 'Capability assessment matrix, 6 capabilities × 5 business units, Harvey balls',
    kind: 'example',
    data: {
      categories: [
        { id: 'industrial', label: 'Industrial' },
        { id: 'automotive', label: 'Automotive' },
        { id: 'energy', label: 'Energy' },
        { id: 'aftermarket', label: 'Aftermarket' },
        { id: 'digital-bu', label: 'Digital Ventures' },
      ],
      series: [
        { id: 'pricing', label: 'Pricing excellence', values: [3, 4, 3, 2, 3] },
        { id: 'crm', label: 'CRM effectiveness', values: [3, 4, 2, 2, 4] },
        { id: 'digital-channels', label: 'Digital channels', values: [1, 2, 2, 0, 4] },
        { id: 'data-analytics', label: 'Data & analytics', values: [1, 2, 1, 1, 3] },
        { id: 'talent', label: 'Talent & skills', values: [2, 3, 2, 1, 3] },
        { id: 'partnerships', label: 'Ecosystem partnerships', values: [2, 1, 3, 1, 2] },
      ],
    },
    options: {
      variant: 'harvey',
      scale: 'discrete',
      title: 'Digital and analytics capabilities lag everywhere outside Digital Ventures',
      subtitle: {
        company: 'Brevinth Industrial Group',
        measure: 'Capability maturity, 0 = absent to 4 = leading',
        period: 'June 2026',
      },
      source: 'Illustrative capability assessment, June 2026',
      // The two rows the title names, so the tint points at what it says; the
      // note names the tint on the canvas.
      highlight: ['digital-channels', 'data-analytics'],
      footnotes: ['Highlighted rows: the digital and analytics capabilities the title names.'],
    },
  },
  {
    id: 'regional-monthly-performance',
    title: 'Performance heatmap: 12 months × 8 regions, continuous scale, negatives red-side',
    kind: 'example',
    data: {
      categories: [
        { id: 'jan', label: 'Jan' },
        { id: 'feb', label: 'Feb' },
        { id: 'mar', label: 'Mar' },
        { id: 'apr', label: 'Apr' },
        { id: 'may', label: 'May' },
        { id: 'jun', label: 'Jun' },
        { id: 'jul', label: 'Jul' },
        { id: 'aug', label: 'Aug' },
        { id: 'sep', label: 'Sep' },
        { id: 'oct', label: 'Oct' },
        { id: 'nov', label: 'Nov' },
        { id: 'dec', label: 'Dec' },
      ],
      series: [
        { id: 'dach', label: 'DACH', values: [6.2, 5.8, 7.1, 6.4, 6.9, 7.3, 5.1, 4.8, 6.6, 7.0, 7.4, 8.1] },
        { id: 'nordics', label: 'Nordics', values: [3.1, 2.8, 3.4, 3.0, 3.6, 3.9, 2.2, 2.0, 3.3, 3.5, 3.8, 4.2] },
        { id: 'benelux', label: 'Benelux', values: [2.4, 2.1, 2.6, 2.3, 2.7, 2.5, 1.8, 1.6, 2.2, 2.4, 2.6, 2.9] },
        { id: 'france', label: 'France', values: [1.9, 1.4, 2.2, 1.7, 2.0, 1.5, 0.4, 0.2, 1.1, 1.3, 1.6, 1.8] },
        { id: 'uki', label: 'UK & Ireland', values: [2.8, 2.5, 3.1, 2.9, 3.2, 3.0, 2.4, 2.1, 2.7, 2.9, 3.1, 3.4] },
        { id: 'italy', label: 'Italy', values: [0.8, 0.5, 0.9, 0.3, -0.2, -0.8, -1.4, -1.9, -1.1, -0.6, -0.3, 0.1] },
        { id: 'iberia', label: 'Iberia', values: [0.4, 0.1, 0.6, -0.3, -0.9, -1.6, -2.4, -3.1, -2.2, -1.5, -0.8, -2.8] },
        { id: 'cee', label: 'CEE', values: [1.2, 1.0, 1.4, 1.1, 1.3, 1.5, 0.9, 0.7, 1.2, 1.4, 1.5, 1.7] },
      ],
    },
    options: {
      scale: 'continuous',
      title: 'Southern Europe drives the H2 margin slippage — Iberia deepest in August',
      subtitle: {
        company: 'Vantia Retail Group',
        measure: 'EBIT variance vs plan',
        period: 'FY25',
        scenarios: ['AC', 'PL'],
      },
      unit: '$m',
      source: 'Vantia group controlling, FY25 close package',
      highlight: 'iberia',
      // The ramp saturates at +5, so the story row's −3.1 reads as the
      // deepest red instead of DACH's +8.1 taking the strongest ink.
      cap: { abs: 5 },
    },
    annotations: [
      {
        kind: 'callout',
        at: { categoryId: 'dec', seriesId: 'iberia' },
        text: 'Strike in Dec:\n${value}',
        preferSide: 'right',
      },
    ],
  },
  {
    id: 'single-row',
    title: 'Torture: single row, discrete ladder',
    kind: 'torture',
    data: {
      categories: [
        { id: 'strategy', label: 'Strategy' },
        { id: 'process', label: 'Process' },
        { id: 'technology', label: 'Technology' },
        { id: 'people', label: 'People' },
        { id: 'governance', label: 'Governance' },
        { id: 'culture', label: 'Culture' },
      ],
      series: [{ id: 'readiness', label: 'Transformation readiness', values: [4, 2, 1, 2, 3, 0] }],
    },
    options: {
      scale: 'discrete',
      title: 'One row still lays out sanely',
      subtitle: { measure: 'Readiness score, 0–4', period: 'Q2 2026' },
      source: 'PMO baseline assessment',
    },
  },
  {
    id: 'single-column',
    title: 'Refusal example: Harvey balls given values that are not ratings 0 to 4',
    kind: 'torture',
    // A Harvey ball is a rating 0 to 4; 112 is refused at its data path.
    refuses: { code: 'harvey-ratings', path: 'series[orders].values[0]' },
    data: {
      categories: [{ id: 'group', label: 'Group' }],
      series: [
        { id: 'orders', label: 'Order intake', values: [112] },
        { id: 'revenue', label: 'Revenue', values: [96] },
        { id: 'ebit', label: 'EBIT', values: [54] },
        { id: 'cash', label: 'Free cash flow', values: [38] },
        { id: 'nps', label: 'Customer NPS', values: [71] },
        { id: 'attrition', label: 'Attrition', values: [22] },
      ],
    },
    options: {
      variant: 'harvey',
      title: 'One column of Harvey balls given KPI values instead of ratings',
      subtitle: { measure: 'KPI attainment', period: 'FY25' },
    },
  },
  {
    id: 'all-equal',
    title: 'Torture: all-equal values (degenerate continuous domain)',
    kind: 'torture',
    data: {
      categories: [
        { id: 'q1', label: 'Q1' },
        { id: 'q2', label: 'Q2' },
        { id: 'q3', label: 'Q3' },
        { id: 'q4', label: 'Q4' },
      ],
      series: [
        { id: 'north', label: 'North', values: [64, 64, 64, 64] },
        { id: 'south', label: 'South', values: [64, 64, 64, 64] },
        { id: 'east', label: 'East', values: [64, 64, 64, 64] },
        { id: 'west', label: 'West', values: [64, 64, 64, 64] },
      ],
    },
    options: {
      title: 'A flat matrix must not divide by zero',
      subtitle: { measure: 'Utilization', period: 'FY25' },
      unit: '%',
    },
  },
  {
    id: 'dense-20x12',
    title: 'Torture: 20×12 dense grid with narrow cells and readable rows',
    kind: 'torture',
    data: {
      categories: Array.from({ length: 20 }, (_, i) => ({
        id: `w${String(i + 1).padStart(2, '0')}`,
        label: `W${String(i + 1).padStart(2, '0')}`,
      })),
      series: Array.from({ length: 12 }, (_, r) => ({
        id: `line-${String(r + 1).padStart(2, '0')}`,
        label: `Line ${String(r + 1).padStart(2, '0')}`,
        // deterministic pseudo-variation, no randomness
        values: Array.from({ length: 20 }, (_, c) => 40 + ((r * 7 + c * 13) % 55) + (c % 4) * 1.5),
      })),
    },
    options: {
      size: { width: 720, height: 540 },
      title: 'Dense grid degrades gracefully',
      subtitle: { measure: 'OEE by production line and week', period: 'H1 2026' },
    },
  },
  {
    id: 'missing-cells',
    title: 'Torture: missing cells render background + dash, means skip nulls',
    kind: 'torture',
    data: {
      categories: [
        { id: 'wave1', label: 'Wave 1' },
        { id: 'wave2', label: 'Wave 2' },
        { id: 'wave3', label: 'Wave 3' },
        { id: 'wave4', label: 'Wave 4' },
        { id: 'wave5', label: 'Wave 5' },
      ],
      series: [
        { id: 'procurement', label: 'Procurement', values: [12.4, 15.1, null, 18.2, 20.5] },
        { id: 'logistics', label: 'Logistics', values: [8.2, null, 9.6, 11.0, null] },
        { id: 'manufacturing', label: 'Manufacturing', values: [null, 22.4, 24.8, null, 28.1] },
        { id: 'overhead', label: 'Overhead', values: [4.1, 4.4, null, null, 6.2] },
      ],
    },
    options: {
      title: 'Savings ramp up despite unreported waves',
      subtitle: { measure: 'Run-rate savings', period: 'Program to date' },
      unit: '$m',
      source: 'Transformation office tracker, June 2026',
    },
  },
  {
    id: 'missing-cells-blank',
    title: 'A cell with no value stays blank, and the key still names it',
    kind: 'example',
    data: {
      categories: [
        { id: 'wave1', label: 'Wave 1' },
        { id: 'wave2', label: 'Wave 2' },
        { id: 'wave3', label: 'Wave 3' },
        { id: 'wave4', label: 'Wave 4' },
        { id: 'wave5', label: 'Wave 5' },
      ],
      series: [
        { id: 'procurement', label: 'Procurement', values: [12.4, 15.1, null, 18.2, 20.5] },
        { id: 'logistics', label: 'Logistics', values: [8.2, null, 9.6, 11.0, null] },
        { id: 'manufacturing', label: 'Manufacturing', values: [null, 22.4, 24.8, null, 28.1] },
        { id: 'overhead', label: 'Overhead', values: [4.1, 4.4, null, null, 6.2] },
      ],
    },
    options: {
      missing: 'blank',
      title: 'Unreported waves stay blank',
      subtitle: { measure: 'Run-rate savings', period: 'Program to date' },
      unit: '$m',
      source: 'Transformation office tracker, June 2026',
    },
  },
];

const monthlyExample = fixtures.find((fixture) => fixture.id === 'regional-monthly-performance')!;
// The colour-scale key sits beside the subtitle in full mode and in a row of
// its own on the narrow compact card, which the rows make room for.
// Both heights fit the report type floor.
// Both sides add the 12 px inset, so the matrix keeps its room edge to
// edge: a narrower compact grid blanks the minus values of Italy and Iberia.
// The compact card is 471 px tall so its two disclosures (the unlabelled
// callout, the colour-only cells) and the source line fit in the frame.
for (const [mode, width, height] of [['full', 1075, 376], ['compact', 517, 471]] as const) {
  fixtures.push({
    ...monthlyExample,
    id: `regional-monthly-${mode}`,
    kind: 'torture',
    title: `Signed monthly values in ${mode} mode`,
    options: { ...monthlyExample.options, mode, size: { width, height },
      theme: { preset: 'standard', overrides: { type: { family: "'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif" } } },
      // A standalone card keeps an inset, so no text sits on the canvas edge;
      // a host that draws its own frame may still pass 0.
      canvas: { margin: { top: 12, right: 12, bottom: 12, left: 12 } } },
  });
}

// colorblindSafe paints the signed cells from theme.color.colorblind.
fixtures.push({
  ...monthlyExample,
  kind: 'torture', id: 'regional-monthly-colorblind',
  title: 'Signed monthly values in the colorblind-safe good/bad pair',
  options: { ...monthlyExample.options, colorblindSafe: true },
});

// the cap saturates the good/bad scale at ±4 both ways, as table heat's cap does.
fixtures.push({
  ...monthlyExample,
  id: 'regional-monthly-capped',
  title: 'Signed monthly values on a scale capped at ±4',
  options: { ...monthlyExample.options, cap: { abs: 4 } },
});

fixtures.push({
  id: 'period-comparisons',
  title: 'Annual growth and differences between named matrix cells',
  kind: 'example',
  data: {
    categories: [
      { id: 'fy21', label: 'FY21', date: '2021-12-31' },
      { id: 'fy22', label: 'FY22', date: '2022-12-31' },
      { id: 'fy23', label: 'FY23', date: '2023-12-31' },
    ],
    series: [
      { id: 'online', label: 'Online', values: [100, 120, 144] },
      { id: 'store', label: 'Store', values: [110, 130, 150] },
      { id: 'partner', label: 'Partner', values: [80, 90, 100] },
    ],
  },
  options: {
    size: { width: 900, height: 330 },
    title: 'Online grows 20% a year; Store adds 40 orders',
    subtitle: { measure: 'Orders', period: 'FY21 to FY23' },
    source: 'Illustrative channel orders',
    annotations: [
      { id: 'growth', kind: 'cagr', from: { categoryId: 'fy21', seriesId: 'online' }, to: { categoryId: 'fy23', seriesId: 'online' } },
      { id: 'gap', kind: 'diff', mode: 'absolute', from: { categoryId: 'fy21', seriesId: 'store' }, to: { categoryId: 'fy23', seriesId: 'store' } },
    ],
  },
});

// Long names at a generous size read whole. The rendered SVG has no ellipsis.
fixtures.push({
  id: 'torture-long-labels',
  title: 'Torture: long names at a generous size read whole, never cut',
  kind: 'torture',
  data: {
    categories: [
      { id: 'industrial', label: 'Industrial equipment and services' },
      { id: 'automotive', label: 'Automotive and mobility suppliers' },
      { id: 'energy', label: 'Energy and utilities' },
      { id: 'aftermarket', label: 'Aftermarket parts and repair' },
      { id: 'digital-bu', label: 'Digital ventures and platforms' },
    ],
    series: [
      {
        id: 'pricing',
        label: 'Healthcare diagnostics, laboratory information systems and point-of-care testing',
        values: [3, 4, 3, 2, 3],
      },
      {
        id: 'service',
        label: 'Wealth management, private banking and family-office advisory for entrepreneurs',
        values: [3, 4, 2, 2, 4],
      },
      {
        id: 'digital-channels',
        label: 'Retail deposits and everyday current accounts for households and sole traders',
        values: [1, 2, 2, 0, 4],
      },
      {
        id: 'data-analytics',
        label: 'Corporate lending incl. syndicated, leveraged and sustainability-linked finance',
        values: [1, 2, 1, 1, 3],
      },
      {
        id: 'talent',
        label: 'Logistics, warehousing and last-mile delivery partnerships in metropolitan areas',
        values: [2, 3, 2, 1, 3],
      },
      {
        id: 'partnerships',
        label: 'Renewable energy generation and grid-scale battery storage projects under construction',
        values: [2, 1, 3, 1, 2],
      },
    ],
  },
  options: {
    variant: 'harvey',
    scale: 'discrete',
    title: 'Long names read whole at a generous size',
    subtitle: {
      company: 'Brevinth Industrial Group',
      measure: 'Capability maturity, 0 = absent to 4 = leading',
      period: 'June 2026',
    },
    source: 'Illustrative capability assessment, June 2026',
    highlight: 'digital-channels',
    size: { width: 1440, height: 900 },
  },
});

fixtures.push({ id: 'series-formats', title: 'Rows have distinct formats', kind: 'torture', data: { categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], series: [{ id: 'amount', label: 'Amount', format: '$1.0', values: [2, 3] }, { id: 'rate', label: 'Rate', format: '1.0%', values: [4, 5] }] }, options: { title: 'Each row keeps its unit', size: { width: 650, height: 350 } } });

fixtures.push({
  id: 'cell-states',
  title: 'A cell with a state is named in the key as suppressed, not meaningful or not applicable',
  kind: 'example',
  data: {
    categories: [{ id: 'q1', label: 'Q1' }, { id: 'q2', label: 'Q2' }, { id: 'q3', label: 'Q3' }, { id: 'q4', label: 'Q4' }],
    series: [
      { id: 'north', label: 'North', values: [4.2, 4.8, 5.1, 5.6] },
      { id: 'south', label: 'South', values: [3.1, null, 3.6, null], states: [null, 'suppressed', null, 'suppressed'] },
      { id: 'east', label: 'East', values: [null, 2.9, 3.3, 3.4], states: ['na', null, null, null] },
      { id: 'west', label: 'West', values: [2.2, 2.5, null, 2.9] },
    ],
  },
  options: { title: 'Withheld cells are named, not blank', unit: '%' },
});

fixtures.push({
  id: 'measure-already-names-unit', title: 'The measure names the unit once', kind: 'torture',
  data: { categories: [{ id: 'd1', label: 'Day 1' }, { id: 'd2', label: 'Day 2' }, { id: 'd3', label: 'Day 3' }],
    series: [{ id: 'a', label: 'Group A', values: [12, 15, 17] }, { id: 'b', label: 'Group B', values: [8, 10, 14] }] },
  options: { title: 'Sample conversions increase across days', subtitle: { measure: 'Sample conversions per day' }, unit: 'conversions' },
});

// Invented survey: six customer segments rate twelve touchpoints of a buying
// journey. Circle size is how important the touchpoint is (three levels),
// colour is the share of respondents whose expectations were exceeded, in
// three authored bins. Two cells rest on fewer than 50 respondents.
const journeyStops = ['Search', 'Compare', 'Store visit', 'Website', 'App', 'Payment', 'Delivery', 'Setup', 'Support', 'Returns', 'Loyalty', 'Renewal'];
const journeySegments: [string, string, number[], number[]][] = [
  ['new', 'New customers', [3, 1, 3, 1, 1, 1, 1, 1, 1, 1, 3, 1], [22, 18, 41, 44, 26, 38, 62, 47, 24, 21, 35, 58]],
  ['families', 'Young families', [2, 2, 2, 1, 2, 1, 1, 1, 2, 1, 2, 1], [42, 46, 39, 63, 44, 27, 61, 45, 47, 33, 41, 36]],
  ['frequent', 'Frequent buyers', [2, 2, 1, 1, 3, 2, 2, 1, 2, 1, 1, 1], [37, 45, 33, 66, 48, 40, 71, 58, 46, 31, 34, 19]],
  ['price', 'Price seekers', [1, 1, 1, 1, 2, 1, 1, 2, 3, 1, 1, 2], [31, 17, 43, 55, 41, 35, 37, 44, 12, 39, 33, 16]],
  ['premium', 'Premium members', [1, 2, 1, 2, 3, 2, 1, 1, 3, 1, 2, 3], [36, 48, 21, 39, 44, 46, 32, 15, 43, 19, 64, 11]],
  ['lapsed', 'Lapsed customers', [1, 2, 1, 1, 2, 1, 1, 1, 3, 1, 1, 3], [38, 42, 34, 59, 46, 33, 52, 38, 14, 24, 41, 9]],
];
fixtures.push({
  id: 'survey-journey-bubbles',
  title: 'Survey bubble matrix: 6 segments × 12 touchpoints, importance as size, binned satisfaction as colour, two low-base cells',
  kind: 'example',
  data: {
    categories: journeyStops.map((label, i) => ({ id: `t${i + 1}`, label })),
    series: journeySegments.map(([id, label, sizes, values]) => ({
      id, label, direction: 'higherIsBetter' as const, values: values.map((pct) => ({ pct })), sizes,
      // Lapsed customers rarely set up or return a product: two thin bases.
      bases: id === 'lapsed' ? [180, 175, 160, 170, 150, 140, 120, 38, 110, 26, 90, 160] : Array.from({ length: 12 }, () => 200),
    })),
  },
  options: {
    variant: 'bubble',
    scale: 'discrete',
    breaks: [0, 30, 50, 100],
    bubble: { levels: ['Low', 'Medium', 'High'], sizeLabel: 'Importance', colorLabel: 'Expectations exceeded, % of respondents' },
    minBase: 50,
    title: 'Support and renewal disappoint where they matter most',
    subtitle: { measure: 'Importance and satisfaction by customer segment and touchpoint' },
    source: 'Invented customer survey, 1,100 respondents',
    // The height follows the content: a turned card stands taller.
    size: { width: 960 },
  },
});
// Long touchpoint names at 12 columns: three lines do not hold them, so the
// matrix turns (touchpoints as rows) and every name is drawn whole, flat
// (never thinned, never rotated).
const longStops = ['Searching for options online', 'Comparing offers and prices', 'Visiting a store', 'Using the website', 'Using the mobile app', 'Paying at checkout', 'Delivery and tracking', 'Setting up the product', 'Getting customer support', 'Returning items', 'Loyalty rewards programme', 'Renewing the subscription'];
fixtures.push({
  id: 'survey-journey-long-names',
  title: 'Survey bubble matrix with long touchpoint names: the matrix turns instead of rotating or thinning the names',
  kind: 'example',
  data: {
    categories: longStops.map((label, i) => ({ id: `t${i + 1}`, label })),
    series: journeySegments.map(([id, label, sizes, values]) => ({ id, label, values: values.map((pct) => ({ pct })), sizes })),
  },
  options: {
    variant: 'bubble',
    scale: 'discrete',
    breaks: [0, 30, 50, 100],
    bubble: { levels: ['Low', 'Medium', 'High'], sizeLabel: 'Importance', colorLabel: 'Expectations exceeded, %' },
    title: 'Every touchpoint name is drawn whole',
    source: 'Invented customer survey',
    size: { width: 960, height: 640 },
  },
});
fixtures.push({
  id: 'survey-journey-track',
  title: 'Survey bubble matrix with a row track: the touchpoints are ordered journey steps',
  kind: 'example',
  data: {
    categories: journeyStops.slice(0, 8).map((label, i) => ({ id: `t${i + 1}`, label })),
    series: journeySegments.slice(0, 4).map(([id, label, sizes, values]) => ({ id, label, values: values.slice(0, 8).map((pct) => ({ pct })), sizes: sizes.slice(0, 8).map((level) => level * 120) })),
  },
  options: {
    variant: 'bubble',
    bubble: { track: true, sizeLabel: 'Respondents', colorLabel: 'Satisfied, %' },
    title: 'Satisfaction along the buying journey for four segments',
    source: 'Invented customer survey',
    size: { width: 820, height: 420 },
  },
});
registerFixtures('heatmap', fixtures);
