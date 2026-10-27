/**
 * Pie / doughnut fixtures — examples
 * (7-slice market-share pie whose name labels stand in two columns, no legend;
 * doughnut with center total and one exploded slice); torture set covers
 * ten tiny slices (outside cascade + per-side spread), a 92% dominant slice
 * with a callout, an exact 50/50 split on a rotated doughnut, and topN
 * Others aggregation with an exploded Others slice plus an ignored second
 * series, and a full-range explode with shifted-circle outside labels. Every
 * fixture auto-enters the invariant suite.
 */

import { registerFixtures } from '../../../fixtures/registry';
import type { Fixture } from '../../registry';
import type { ChartData } from '../../types/data';
import type { PieOptions } from '../../types/options';

export const fixtures: Fixture<ChartData, PieOptions>[] = [
  {
    id: 'streaming-genre-share',
    title: 'Market-share pie with named value · share labels in two columns',
    kind: 'example',
    tags: ['interaction'],
    hover: { owner: { categoryId: 'pop' } },
    data: {
      categories: [
        { id: 'pop', label: 'Pop' },
        { id: 'hiphop', label: 'Hip-hop' },
        { id: 'rock', label: 'Rock' },
        { id: 'latin', label: 'Latin' },
        { id: 'country', label: 'Country' },
        { id: 'jazz', label: 'Jazz' },
        { id: 'other', label: 'Other' },
      ],
      series: [
        {
          id: 'revenue',
          label: 'Streaming revenue',
          values: [35_600_000, 23_100_000, 18_300_000, 7_700_000, 4_800_000, 3_800_000, 2_900_000],
        },
      ],
    },
    options: {
      format: '1.2m',
      // The two story slices keep the series blues; the rest steps back to grey.
      highlight: ['pop', 'hiphop'],
      title: 'Pop and hip-hop earn six of every ten streaming dollars',
      subtitle: { company: 'Brevinth Music', measure: 'Streaming revenue', period: 'FY25' },
      unit: 'US$',
      source: 'Brevinth label analytics, FY25',
    },
  },
  {
    id: 'doughnut-device-revenue',
    title: 'Doughnut with center total and one exploded slice',
    kind: 'example',
    // The gallery shows the rotations below as one block with a rotation switch.
    tags: ['variant-of:doughnut-device-revenue'],
    data: {
      categories: [
        { id: 'mobile', label: 'Mobile' },
        { id: 'pc', label: 'PC' },
        { id: 'tablet', label: 'Tablet' },
      ],
      series: [
        { id: 'rev', label: 'Device revenue', values: [112.3, 80.5, 57.4] },
      ],
    },
    options: {
      doughnut: 0.55,
      explode: { mobile: 0.06 },
      colors: 'categorical',
      format: '1,234.5',
      title: 'Mobile approaches half of global device revenue',
      subtitle: { company: 'Camden Devices', measure: 'Revenue by device class', period: 'FY25' },
      unit: '$bn',
      source: 'Camden market model v4, FY25 actuals',
    },
  },
  {
    id: 'ten-tiny-slices',
    title: 'Torture: one leader + ten tiny slices force the outside cascade and spread',
    kind: 'torture',
    // Ten three-line labels exceed the left side; the five without a
    // seat are named with value and share in the note line, no leader drawn.
    data: {
      categories: [
        { id: 'leader', label: 'Market leader' },
        { id: 'c1', label: 'Challenger 1' },
        { id: 'c2', label: 'Challenger 2' },
        { id: 'c3', label: 'Challenger 3' },
        { id: 'c4', label: 'Challenger 4' },
        { id: 'c5', label: 'Challenger 5' },
        { id: 'c6', label: 'Challenger 6' },
        { id: 'c7', label: 'Challenger 7' },
        { id: 'c8', label: 'Challenger 8' },
        { id: 'c9', label: 'Challenger 9' },
        { id: 'c10', label: 'Challenger 10' },
      ],
      series: [
        {
          id: 'share',
          label: 'Revenue',
          values: [44.0, 3.6, 3.1, 2.9, 2.7, 2.5, 2.3, 2.1, 1.9, 1.7, 1.5],
        },
      ],
    },
    options: {
      topN: { n: 11, rest: false },
      // Printed to their own nearest, the eleven shares add to 99%;
      // sum-consistent prints Challenger 9 (2.49%) at 3%, not 2%.
      rounding: 'sum-consistent',
      title: 'Ten challengers split a third of the market',
      subtitle: { measure: 'Revenue by vendor', period: 'FY25' },
      unit: '$m',
    },
  },
  {
    id: 'dominant-slice',
    title: 'Torture: 92% dominant slice (large-arc path) with a callout on the rest',
    kind: 'torture',
    data: {
      categories: [
        { id: 'cloud', label: 'Cloud' },
        { id: 'legacy', label: 'On-premise' },
      ],
      series: [{ id: 'workloads', label: 'Workloads', values: [92, 8] }],
    },
    options: {
      title: 'Only 8% of workloads remain on-premise',
      subtitle: { measure: 'Workload share', period: 'June 2026' },
      unit: '% of workloads',
      source: 'Infrastructure inventory scan',
    },
    annotations: [
      {
        kind: 'callout',
        at: { categoryId: 'cloud' },
        text: 'Cloud share doubled in two years',
        preferSide: 'below',
      },
    ],
  },
  {
    id: 'fifty-fifty',
    title: 'Torture: exact 50/50 split, rotated 90°, doughnut center total',
    kind: 'torture',
    data: {
      categories: [
        { id: 'emea', label: 'EMEA' },
        { id: 'amer', label: 'Americas' },
      ],
      series: [{ id: 'rev', label: 'Revenue', values: [412, 412] }],
    },
    options: {
      doughnut: 0.4,
      rotate: 90,
      title: 'A perfect even split between the two regions',
      subtitle: { measure: 'Revenue', period: 'FY25' },
      unit: '$m',
    },
  },
  {
    id: 'topn-others-explode',
    title: 'Torture: topN Others (exploded, always last) + ignored second series',
    kind: 'torture',
    data: {
      categories: [
        { id: 'p1', label: 'Platform' },
        { id: 'p2', label: 'Analytics' },
        { id: 'p3', label: 'Integrations' },
        { id: 'p4', label: 'Support' },
        { id: 'p5', label: 'Training' },
        { id: 'p6', label: 'Hardware' },
        { id: 'p7', label: 'Licensing' },
        { id: 'p8', label: 'Consulting' },
        { id: 'p9', label: 'Marketplace' },
      ],
      series: [
        { id: 'rev', label: 'Revenue', values: [34, 28, 21, 17, 12, 9, 7, 5, 3] },
        { id: 'plan', label: 'Plan', values: [36, 27, 22, 18, 11, 10, 8, 6, 4] },
      ],
    },
    options: {
      topN: { n: 4, rest: true, showRestCount: true },
      explode: { others: 0.1 },
      title: 'Four product lines carry three quarters of revenue',
      subtitle: { measure: 'Revenue by product line', period: 'FY25' },
      unit: '$m',
    },
  },
  {
    id: 'full-explode-envelope',
    title: 'Torture: full-range explode with shifted-circle outside labels',
    kind: 'torture',
    data: {
      categories: [
        { id: 'north', label: 'North' },
        { id: 'south', label: 'South' },
        { id: 'east', label: 'East' },
        { id: 'west', label: 'West' },
      ],
      series: [{ id: 'share', label: 'Revenue share', values: [37, 29, 21, 13] }],
    },
    options: {
      // At the dashboard-tile height the 28 px side margins shrink the radius
      // until the doughnut total '100' hides; 340 px keeps it while the
      // max-offset explode stress stays.
      size: { width: 480, height: 340 },
      doughnut: 0.65,
      rotate: 90,
      explode: { south: 1 },
      labels: { insidePie: false, outsidePie: ['category', 'percent'] },
      title: 'Exploded South remains inside the canvas at maximum offset',
      subtitle: { measure: 'Revenue share', period: 'FY25' },
      // The centre total names what it counts.
      unit: '%',
    },
  },
  {
    id: 'doughnut-four-channel-revenue',
    title: 'Four named outside labels and a centre total with its unit',
    kind: 'example',
    data: {
      categories: [
        { id: 'direct', label: 'Direct' },
        { id: 'partner', label: 'Partner' },
        { id: 'retail', label: 'Retail' },
        { id: 'other', label: 'Other' },
      ],
      series: [{ id: 'revenue', label: 'Revenue', values: [42, 28, 19, 11] }],
    },
    options: {
      doughnut: 0.8,
      title: 'Direct and partner sales contribute 70% of revenue',
      subtitle: { measure: 'Revenue by channel', period: 'FY26' },
      unit: '$m',
      source: 'Illustrative channel revenue',
    },
  },
  {
    id: 'highlight-channel',
    title: 'Highlight keeps the named slice in colour and greys the rest',
    kind: 'example',
    data: {
      categories: [
        { id: 'search', label: 'Search' },
        { id: 'social', label: 'Social' },
        { id: 'display', label: 'Display' },
      ],
      series: [{ id: 'spend', label: 'Spend', values: [200, 120, 80] }],
    },
    options: {
      doughnut: 0.6,
      highlight: ['social'],
      strings: { notApplicable: 'Not applicable' },
      title: 'Social is the channel to cut',
      subtitle: { measure: 'Media spend', period: 'FY26' },
      unit: '$k',
      source: 'Illustrative media plan',
    },
  },
];

// Rotation 0 is doughnut-device-revenue itself; slice-outline-off draws the sequential colours.
for (const [rotate, clock] of [[90, 3], [180, 6], [270, 9]] as const) {
  fixtures.push({
    ...fixtures[1]!,
    id: `device-revenue-rotation-${rotate}`,
    kind: 'torture',
    title: `Device revenue doughnut rotated ${rotate} degrees`,
    options: {
      ...fixtures[1]!.options!,
      rotate,
      subtitle: { company: 'Camden Devices', measure: 'Revenue by device class', period: `FY25, slices clockwise from ${clock} o'clock` },
    },
  });
}

// strings.others renames the aggregated slice in the author's words.
fixtures.push({
  id: 'others-renamed',
  title: 'The aggregated slice named through strings.others',
  kind: 'example',
  data: {
    categories: [
      { id: 'platform', label: 'Platform' },
      { id: 'analytics', label: 'Analytics' },
      { id: 'integrations', label: 'Integrations' },
      { id: 'support', label: 'Support' },
      { id: 'training', label: 'Training' },
      { id: 'hardware', label: 'Hardware' },
      { id: 'marketplace', label: 'Marketplace' },
    ],
    series: [{ id: 'rev', label: 'Revenue', values: [38, 24, 16, 9, 6, 4, 3] }],
  },
  options: {
    topN: { n: 4, rest: true },
    strings: { others: 'Other product lines' },
    title: 'Four product lines earn 87% of revenue',
    subtitle: { measure: 'Revenue by product line', period: 'FY26' },
    unit: '$m',
    source: 'Illustrative product revenue',
  },
});

fixtures.push({
  id: 'channel-spend-difference',
  title: 'Search spend exceeds Social by 80',
  kind: 'example',
  data: {
    categories: [{ id: 'search', label: 'Search' }, { id: 'social', label: 'Social' }, { id: 'display', label: 'Display' }],
    series: [{ id: 'spend', label: 'Spend', values: [200, 120, 80] }],
  },
  options: {
    size: { width: 1000, height: 560 }, doughnut: 0.65,
    title: 'Search spend exceeds Social by 80',
    subtitle: { measure: 'Spend by channel', period: 'FY26' },
    unit: '$k', source: 'Illustrative channel spend',
    annotations: [{ id: 'gap', kind: 'diff', mode: 'absolute', from: 'social', to: 'search' }],
  },
});

/**
 * A theme whose ramp runs to a pale step keeps the page separator between
 * slices and draws no outline round the palest one (`marks.sliceOutline`).
 */
const genres = fixtures.find((fixture) => fixture.id === 'streaming-genre-share')!;
fixtures.push({
  ...genres,
  id: 'slice-outline-off',
  title: 'A sequential ramp to a pale step, the Others slice in the theme colour, no slice outlines',
  kind: 'example',
  tags: ['feature:theme'],
  options: {
    ...genres.options,
    // The genre example draws all seven slices without a key; this one keeps
    // the five largest plus Others, and its key.
    topN: { n: 5, rest: true },
    legend: 'bottom',
    colors: 'sequential',
    // The sequential ramp is the subject here, not the genre example's highlight.
    highlight: undefined,
    theme: { preset: 'standard', overrides: { color: { others: '#E3E1DB' }, marks: { sliceOutline: false } } },
  },
});

// othersShade: 'apart' only keeps Others apart from the named slices, so named slices may be quieter than Others.
const othersRenamed = fixtures.find((fixture) => fixture.id === 'others-renamed')!;
fixtures.push({
  ...othersRenamed,
  id: 'others-shade-apart',
  title: "Others only has to differ from the named slices (othersShade 'apart')",
  tags: ['coverage'],
  options: { ...othersRenamed.options, strings: undefined, othersShade: 'apart' },
});

// The full label density on pie. No named palette: a repainted pie keeps the light theme's palette steps.
const fourChannels = fixtures.find((fixture) => fixture.id === 'doughnut-four-channel-revenue')!;
fixtures.push({
  ...fourChannels,
  kind: 'torture', id: 'four-channels-full-labels',
  title: 'The four channels with the full label density',
  tags: ['coverage'],
  options: { ...fourChannels.options, labelDensity: 'full' },
});

registerFixtures('pie', fixtures);
