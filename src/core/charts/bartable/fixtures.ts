/** Bar table fixtures: examples (several panels, one panel, share cascades) and one torture case. Synthetic data. */

import { registerFixtures } from '../../../fixtures/registry';
import type { Fixture } from '../../registry';
import type { BarTableData, BarTableOptions } from './types';

export const fixtures: Fixture<BarTableData, BarTableOptions>[] = [
  {
    id: 'impact-two-panels',
    title: 'Two panels, one split: the impact in $bn and as a share of EBITDA, with a count column and a Total row',
    kind: 'torture',
    tags: ['interaction'],
    hover: { owner: { categoryId: 'sw', seriesId: 'grow', colId: 'abs' } },
    data: {
      categories: [
        { id: 'sw', label: 'Software' },
        { id: 'ut', label: 'Utilities' },
        { id: 'rt', label: 'Retail' },
        { id: 'lg', label: 'Logistics' },
        { id: 'in', label: 'Insurance' },
        { id: 'md', label: 'Media' },
        { id: 'ch', label: 'Chemicals' },
        { id: 'co', label: 'Construction' },
      ],
      series: [{ id: 'run', label: 'Run' }, { id: 'grow', label: 'Grow' }],
      columns: [{ id: 'n', label: '# of companies', values: [30, 45, 64, 20, 45, 14, 15, 23], format: '1,234' }],
      panels: [
        {
          id: 'abs', label: 'EBITDA impact', unit: '$bn', weight: 2,
          values: { run: [40, 30, 35, 25, 28, 12, 6, 4], grow: [100, 75, 80, 60, 52, 28, 14, 8] },
          ends: [
            { low: 110, high: 160 }, { low: 80, high: 160 }, { low: 90, high: 140 }, { low: 70, high: 110 },
            { low: 60, high: 100 }, { low: 30, high: 50 }, { low: 10, high: 30 }, { low: 8, high: 16 },
          ],
        },
        {
          // A share of each sector's own EBITDA: the shares do not add up.
          id: 'pct', label: 'Share of 2030 EBITDA', unit: '%', weight: 1, aggregate: 'none',
          values: { run: [8, 9, 7, 10, 12, 6, 4, 3], grow: [26, 30, 22, 28, 25, 12, 9, 7] },
          ends: [
            { low: 28, high: 40 }, { low: 29, high: 60 }, { low: 24, high: 35 }, { low: 31, high: 45 },
            { low: 30, high: 44 }, { low: 12, high: 24 }, { low: 10, high: 18 }, { low: 7, high: 14 },
          ],
        },
      ],
    },
    options: {
      total: true,
      // The two rows the headline is about print their combined share, end by end.
      combinedShare: { rows: ['sw', 'ut'] },
      title: 'Software and utilities carry about 42% of the upside',
      subtitle: { measure: 'Estimated 2030 EBITDA run-rate impact' },
      source: 'Illustrative model',
    },
  },
  {
    id: 'single-panel',
    title: 'One measure: one panel, no number columns, the stack sum at the end of each bar',
    kind: 'example',
    data: {
      categories: [
        { id: 'north', label: 'North' },
        { id: 'south', label: 'South' },
        { id: 'east', label: 'East' },
        { id: 'west', label: 'West' },
        { id: 'central', label: 'Central' },
      ],
      series: [{ id: 'new', label: 'New contracts' }, { id: 'renewal', label: 'Renewals' }],
      panels: [
        { id: 'bookings', label: 'Bookings', unit: '$m', values: { new: [42, 35, 28, 21, 12], renewal: [58, 44, 40, 30, 26] } },
      ],
    },
    options: {
      total: false,
      // The default without cascade, written out.
      sharedScale: false,
      title: 'Renewals carry more than half of the bookings in every region',
      subtitle: { measure: 'Bookings', period: 'FY 2026' },
      source: 'Illustrative data',
    },
  },
  {
    id: 'null-and-long-labels',
    title: 'A missing segment, a row name cut after two lines, a wide range label and a column that does not sum',
    kind: 'torture',
    data: {
      categories: [
        { id: 'a', label: 'Plant A' },
        { id: 'b', label: 'Regional distribution centres and cross-border fulfilment hubs under long-term service agreements with third parties' },
        { id: 'c', label: 'Plant C' },
        { id: 'd', label: 'Plant D' },
      ],
      series: [{ id: 'energy', label: 'Energy' }, { id: 'labour', label: 'Labour' }, { id: 'freight', label: 'Freight' }],
      columns: [
        { id: 'sites', label: 'Sites', values: [3, 12, 2, 4] },
        { id: 'margin', label: 'Avg. margin', values: [12.5, 8.25, null, 10], format: '1.2%', aggregate: 'none' },
      ],
      panels: [
        {
          id: 'cost', label: 'Savings potential', unit: '$k',
          values: { energy: [1200, 4800, 900, null], labour: [800, 9600, 700, 1100], freight: [400, 12400, 300, 600] },
          ends: [null, { low: 12500, high: 48000 }, null, null],
        },
        { id: 'fte', label: 'Roles affected', values: { energy: [4, 10, 2, 3], labour: [12, 60, 9, 14], freight: [2, 25, 1, 3] } },
      ],
    },
    options: {
      title: 'Most of the savings sit in the distribution network',
      source: 'Illustrative data',
    },
  },
];

// One segment: a missing value and the two cell states print as what they are, with no sum to blame.
fixtures.push({
  id: 'one-series-missing-and-states',
  title: 'One segment with a missing value, a not-applicable cell and a not-meaningful cell, in a bar panel and a number column: each prints its own glyph',
  kind: 'torture',
  tags: ['demo'],
  data: {
    categories: [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' },
      { id: 'c', label: 'Gamma' },
      { id: 'd', label: 'Delta' },
      { id: 'e', label: 'Epsilon' },
    ],
    series: [{ id: 'cpo', label: 'Cost per order' }],
    columns: [{ id: 'orders', label: 'Orders', values: [120, { state: 'na' }, 80, 95, { state: 'nm' }], format: '1,234', aggregate: 'none' }],
    panels: [{ id: 'cpo', label: 'Cost per order', unit: '$', values: { cpo: [12.5, 18.2, null, { state: 'na' }, { state: 'nm' }] } }],
  },
  options: {
    total: false,
    title: 'Cost per order by segment',
    source: 'Illustrative data',
  },
});

// Coverage: the combined-share note names the rows in the author's words.
const impactPanels = fixtures.find((fixture) => fixture.id === 'impact-two-panels')!;
fixtures.push({
  ...impactPanels,
  id: 'impact-two-panels-named-share',
  kind: 'example',
  title: 'Two panels, one split: the impact in $bn and as a share of EBITDA, with the combined-share note naming the two rows the two largest sectors',
  tags: ['coverage'],
  options: { ...impactPanels.options!, combinedShare: { rows: ['sw', 'ut'], label: 'The two largest sectors' } },
});

// Share cascade: one total split over the rows, period by period, on one scale.
const cascadeRow = (id: string, label: string, group?: string) => ({ id, label, ...(group ? { group } : { residual: true }) });
fixtures.push({
  id: 'cascade-two-periods',
  title: 'Share cascade over two periods: rows coloured by a row group, two residual rows pinned last, share columns, a bracket and a CAGR column',
  kind: 'example',
  data: {
    categories: [
      cascadeRow('nor', 'Northland', 'low'),
      cascadeRow('eas', 'Eastvale', 'high'),
      cascadeRow('sou', 'Southmere', 'high'),
      cascadeRow('wes', 'Westbrook', 'low'),
      cascadeRow('lak', 'Lakeshore', 'mid'),
      cascadeRow('hig', 'Highmoor', 'low'),
      cascadeRow('riv', 'Riverton', 'high'),
      // Authored among the markets: residual rows are pinned last.
      cascadeRow('rest', 'Rest of world'),
      cascadeRow('pin', 'Pinecrest', 'mid'),
      cascadeRow('sto', 'Stonebay', 'low'),
      cascadeRow('fai', 'Fairhaven', 'low'),
      cascadeRow('cluster', 'Other coastal markets'),
    ],
    series: [{ id: 'rev', label: 'Revenue' }],
    rowGroups: {
      title: 'Gross margin of market, %',
      groups: [
        // Light to dark: series 2 is light blue, series 8 slate, series 1 navy (Boardroom order).
        { id: 'low', label: 'Low (0–10)', colorRole: 'series-2' },
        { id: 'mid', label: 'Middle (11–20)', colorRole: 'series-8' },
        { id: 'high', label: 'High (>20)', colorRole: 'series-1' },
      ],
    },
    panels: [
      { id: 'y21', label: '2021', unit: '$ billion', format: '1.0', values: { rev: [24.1, 13.2, 6.8, 5.9, 4.4, 4.9, 2.2, 7.9, 1.4, 1.6, 0.8, 5.6] } },
      { id: 'y25', label: '2025', unit: '$ billion', format: '1.0', values: { rev: [25.0, 16.4, 8.1, 6.6, 5.7, 4.2, 2.9, 11.3, 2.1, 2.0, 1.4, 7.2] } },
    ],
  },
  options: {
    variant: 'cascade',
    cascade: { growth: { measure: 'cagr' } },
    combinedShare: { rows: ['nor', 'eas', 'sou', 'wes', 'lak'] },
    rounding: 'sum-consistent',
    title: 'The top five markets hold about 70% of revenue, a little less than four years ago',
    subtitle: { measure: 'Revenue by market' },
    source: 'Illustrative data',
    size: { width: 900 },
  },
});
// Coverage: totalApart false keeps the theme's own Total colour, as before the Total was kept off the group colours.
const cascadeTwo = fixtures.find((fixture) => fixture.id === 'cascade-two-periods')!;
fixtures.push({
  ...cascadeTwo,
  id: 'cascade-two-periods-theme-total',
  kind: 'example',
  title: 'Share cascade over two periods with the Total bar in the theme total colour, even where it equals a group colour',
  tags: ['coverage'],
  options: { ...cascadeTwo.options!, cascade: { ...cascadeTwo.options!.cascade, totalApart: false } },
});
fixtures.push({
  id: 'cascade-four-years',
  title: 'Share cascade over four years: product-category revenue share with the share change in pp',
  kind: 'example',
  data: {
    categories: [
      { id: 'app', label: 'Apparel' },
      { id: 'foo', label: 'Footwear' },
      { id: 'acc', label: 'Accessories' },
      { id: 'hom', label: 'Home' },
      { id: 'bea', label: 'Beauty' },
      { id: 'oth', label: 'Other categories', residual: true },
    ],
    series: [{ id: 'rev', label: 'Revenue' }],
    panels: [
      { id: 'y22', label: '2022', values: { rev: [182, 96, 41, 30, 18, 23] } },
      { id: 'y23', label: '2023', values: { rev: [188, 108, 47, 33, 26, 24] } },
      { id: 'y24', label: '2024', values: { rev: [190, 121, 52, 35, 37, 26] } },
      { id: 'y25', label: '2025', values: { rev: [193, 133, 58, 36, 49, 27] } },
    ],
  },
  options: {
    variant: 'cascade',
    cascade: { growth: { measure: 'share-change' } },
    // The cascade default, written out.
    sharedScale: true,
    // rounding defaults to 'sum-consistent' under cascade.
    combinedShare: { rows: ['app', 'foo'] },
    title: 'Beauty gains share every year while apparel gives it up',
    // Four panels name the unit once, in the subtitle, so each head stays one short line.
    subtitle: { measure: 'Revenue by product category, $m' },
    source: 'Illustrative data',
    // At 1060 px every value fits in its track; nearer the floor (about 970 px) a value may fall back into the panel gap.
    size: { width: 1060, height: 380 },
  },
});

registerFixtures('bartable', fixtures);
