import { metricStackFixtures } from './metricStackFixtures';
/** Grid fixtures: the flagship CFO exhibit + facets + tortures. */

import { registerFixtures } from '../../../fixtures/registry';
import type { Fixture } from '../../registry';
import type { GridInput, GridLayoutOptions } from './schema';

const REV = {
  categories: [
    { id: 'q1', label: 'Q1' },
    { id: 'q2', label: 'Q2' },
    { id: 'q3', label: 'Q3' },
    { id: 'q4', label: 'Q4' },
  ],
  series: [
    { id: 'amer', label: 'AMER', values: [45, 48, 51, 55] },
    { id: 'emea', label: 'EMEA', values: [30, 29, 27, 26] },
    { id: 'apac', label: 'APAC', values: [12, 14, 15, 17] },
    { id: 'py', label: 'PY', scenario: 'PY' as const, role: 'reference' as const, values: [82, 86, 88, 90] },
  ],
};

const FORECAST_REV = {
  ...REV,
  series: REV.series.map((series) => series.role === 'reference' ? series : {
    ...series,
    values: series.values.map((value, index) => index < 2 ? value : { number: value, scenario: 'FC' as const }),
  }),
};

/** Eight weeks of orders against plan: the actual vs plan recipe of the manual. */
const WEEKS = ['w01', 'w02', 'w03', 'w04', 'w05', 'w06'].map((id) => ({ id, label: id.toUpperCase() }));

const WEEKLY_ORDERS = {
  categories: Array.from({ length: 8 }, (_, index) => ({ id: `w${index + 1}`, label: `W0${index + 1}` })),
  series: [
    { id: 'ac', label: 'Actual', scenario: 'AC' as const, values: [118, 124, 109, 131, 127, 112, 135, 140] },
    { id: 'pl', label: 'Plan', scenario: 'PL' as const, role: 'reference' as const, values: [115, 120, 118, 122, 125, 126, 128, 130] },
  ],
};

export const fixtures: Fixture<GridInput, GridLayoutOptions>[] = [
  {
    id: 'stacked-plus-dpy',
    title: 'The CFO exhibit: stacked revenue with integrated PY variance',
    kind: 'example',
    tags: ['interaction'],
    hover: { owner: { categoryId: 'q1', seriesId: 'amer' }, panel: 'rev' },
    data: {
      panels: [
        {
          id: 'rev',
          type: 'column',
          data: REV,
          options: { variant: 'stacked', unit: '$m', format: '88' },
        },
      ],
    },
    options: {
      size: 'slide-4x3',
      sharedAxis: 'category',
      legend: 'top',
      title: 'Revenue up 7% vs PY despite continued EMEA decline',
      subtitle: { company: 'Acme Corp', measure: 'Revenue', period: 'FY25 by quarter', scenarios: ['AC', 'PY'] },
      unit: '$m',
      source: 'Acme management accounts',
    },
  },
  {
    id: 'stacked-plus-dpy-tiered',
    title: 'Opt-in scaled ΔPY% tier above stacked revenue',
    kind: 'example',
    data: {
      panels: [
        {
          id: 'rev',
          type: 'column',
          data: REV,
          options: {
            variant: 'stacked',
            unit: '$m',
            format: '88',
            labels: { annotation: false, tick: false },
          },
        },
        {
          id: 'dpy',
          type: 'variance',
          data: REV,
          options: {
            variant: 'relative', variance: { vs: 'py' },
            valueAxis: { show: true, gridlines: false },
          },
        },
      ],
    },
    options: {
      size: 'slide-4x3',
      sharedAxis: 'category',
      legend: 'top',
      title: 'Revenue up 7% vs PY despite continued EMEA decline',
      subtitle: { company: 'Acme Corp', measure: 'Revenue', period: 'FY25 by quarter', scenarios: ['AC', 'PY'] },
      unit: '$m',
      source: 'Acme management accounts',
    },
  },
  {
    id: 'three-tier',
    title: 'Three tiers: actuals, ΔPY absolute, ΔPY%',
    kind: 'example',
    data: {
      panels: [
        {
          id: 'rev',
          type: 'column',
          data: REV,
          options: {
            variant: 'stacked',
            unit: '$m',
            labels: { annotation: false, tick: false },
          },
        },
        { id: 'dabs', type: 'variance', data: REV, options: { variant: 'absolute', variance: { vs: 'py' } } },
        { id: 'dpct', type: 'variance', data: REV, options: { variant: 'relative', variance: { vs: 'py' } } },
      ],
    },
    options: {
      size: 'a4',
      sharedAxis: 'category',
      legend: 'top',
      title: 'One shared category axis, three aligned tiers',
      // Same REV constant as the two exhibits above, so the same source line.
      source: 'Acme management accounts',
    },
  },
  {
    id: 'weekly-actual-vs-plan',
    title: 'Actual vs plan by week: AC columns with PL ticks over a ΔPL tier',
    kind: 'example',
    data: {
      panels: [
        { id: 'orders', type: 'column', data: WEEKLY_ORDERS, options: { labels: { tick: false } } },
        { id: 'dpl', type: 'variance', data: WEEKLY_ORDERS, options: { variant: 'absolute', variance: { vs: 'pl' } } },
      ],
    },
    options: {
      sharedAxis: 'category',
      legend: 'top',
      unit: 'k orders',
      title: 'Orders beat plan in six of eight weeks; W06 fell 14k short',
      subtitle: { measure: 'Weekly orders', period: 'W01 to W08 2026', scenarios: ['AC', 'PL'] },
      source: 'Illustrative order book',
    },
  },
  {
    id: 'compact-tier-slack',
    title: 'Torture: compact tiers distribute vertical slack',
    kind: 'torture',
    data: {
      panels: [
        {
          id: 'rev',
          type: 'column',
          data: REV,
          options: {
            variant: 'stacked',
            unit: '$m',
            labels: { annotation: false, tick: false },
          },
        },
        { id: 'dabs', type: 'variance', data: REV, options: { variant: 'absolute', variance: { vs: 'py' } } },
        { id: 'dpct', type: 'variance', data: REV, options: { variant: 'relative', variance: { vs: 'py' } } },
      ],
    },
    options: {
      // Three tiers plus legend and title at 270px sit under the 0.60 plot-height
      // floor. This height keeps the compact-tier torture intact with a legal
      // plot band, the note line that names APAC's unprinted values (one footer
      // line) and every tier caption.
      size: { width: 480, height: 471 },
      sharedAxis: 'category',
      legend: 'top',
      title: 'Compact tiers use the full exhibit height deliberately',
    },
  },
  {
    id: 'facet-regions',
    title: 'Facets: four regions, 2×2',
    kind: 'example',
    // The gallery shows the five panelOrder variants as one block with an order switch.
    tags: ['variant-of:facet-regions'],
    data: {
      panels: (['AMER', 'EMEA', 'APAC', 'LATAM'] as const).map((region, r) => ({
        id: region.toLowerCase(),
        type: 'column',
        data: {
          categories: [
            { id: 'fy23', label: 'FY23' },
            { id: 'fy24', label: 'FY24' },
            { id: 'fy25', label: 'FY25' },
          ],
          series: [
            {
              id: 'rev',
              label: region,
              values: [30 + r * 8, 34 + r * 7, 39 + r * 9],
            },
          ],
        },
        options: { title: region },
      })),
    },
    options: {
      // Width only: the facets take the height that keeps each plot half as tall as wide.
      size: { width: 720 },
      panelOrder: 'sheet',
      sharedAxis: 'none',
      columns: 2,
      title: 'Every region grows — AMER fastest at 30% from FY23 to FY25',
      // The order prints in the subtitle: an authored footnote would print a "1)" no mark points at.
      subtitle: { measure: 'Revenue', period: 'FY23–FY25, panels in data order' },
      unit: '$m',
      source: 'Illustrative regional revenue model; all four panels read against one scale',
    },
  },
  {
    id: 'facet-regions-ranked',
    title: 'Facets ordered by last value, largest first',
    kind: 'torture',
    tags: ['variant-of:facet-regions'],
    data: {
      panels: (['AMER', 'EMEA', 'APAC', 'LATAM'] as const).map((region, r) => ({
        id: region.toLowerCase(),
        type: 'column',
        data: {
          categories: [
            { id: 'fy23', label: 'FY23' },
            { id: 'fy24', label: 'FY24' },
            { id: 'fy25', label: 'FY25' },
          ],
          series: [{ id: 'rev', label: region, values: [30 + r * 8, 34 + r * 7, 39 + r * 9] }],
        },
        options: { title: region },
      })),
    },
    options: {
      size: 'slide-4x3',
      sharedAxis: 'none',
      columns: 2,
      panelOrder: 'lastDesc',
      title: 'LATAM ends largest of the four regions',
      subtitle: { measure: 'Revenue', period: 'FY23–FY25, panels ranked by FY25 revenue, largest first' },
      unit: '$m',
      source: 'Illustrative regional revenue model',
    },
  },
  {
    id: 'facet-own-scales-tiny-panel',
    title: 'Torture: sharedScale off, one panel two orders of magnitude smaller',
    kind: 'torture',
    data: {
      panels: [
        { id: 'core', type: 'column', data: { categories: [{ id: 'fy24', label: 'FY24' }, { id: 'fy25', label: 'FY25' }], series: [{ id: 'rev', label: 'Core', values: [610, 665] }] }, options: { title: 'Core' } },
        { id: 'pilot', type: 'column', data: { categories: [{ id: 'fy24', label: 'FY24' }, { id: 'fy25', label: 'FY25' }], series: [{ id: 'rev', label: 'Pilot', values: [1.2, 1.4] }] }, options: { title: 'Pilot' } },
      ],
    },
    options: {
      size: 'slide-4x3',
      sharedAxis: 'none',
      columns: 2,
      // The opt-out earns its keep here: under one scale the pilot panel draws a
      // 2px stub and says nothing. Comparability and legibility genuinely
      // conflict at this ratio, and the author picks.
      sharedScale: false,
      title: 'Pilot is not comparable to Core — each panel keeps its own scale',
      subtitle: { measure: 'Revenue', period: 'FY24–FY25' },
      unit: '$m',
      source: 'Illustrative; sharedScale:false because a 500× ratio crushes the smaller panel',
    },
  },
  {
    id: 'mixed-measures-own-scales',
    title: 'Default scale: a count and a rate without units keep their own scales',
    kind: 'example',
    data: {
      panels: [
        { id: 'tickets', type: 'column', data: { categories: WEEKS, series: [{ id: 'n', label: 'Tickets', values: [128, 151, 175, 162, 140, 133] }] }, options: { title: 'Tickets closed' } },
        { id: 'solved', type: 'line', data: { categories: WEEKS, series: [{ id: 'r', label: 'First-contact fix', values: [44, 52, 61, 69, 58, 47] }] }, options: { title: 'First-contact fix rate' } },
      ],
    },
    options: {
      size: 'slide-4x3',
      sharedAxis: 'none',
      columns: 2,
      // Neither panel names a unit and the chart types differ, so the default
      // does not share one 0-200 scale that would flatten the rate line.
      title: 'Ticket volume and fix rate move apart',
      subtitle: { measure: 'Support desk', period: 'W01 to W06' },
      source: 'Illustrative support desk',
    },
  },
  {
    id: 'repeat-regions',
    title: 'Repeat shorthand: three regions with locked colors and shared scales',
    kind: 'example',
    data: {
      repeat: { dimension: 'region', values: ['EU', 'UK', 'APAC'] },
      template: {
        id: '$region',
        type: 'column',
        title: '$region',
        // The heading names the region; the caption does not repeat it.
        caption: 'Platform and adjusted cost',
        data: {
          bySlice: {
            EU: {
              categories: [{ id: 'q1', label: 'Q1' }, { id: 'q2', label: 'Q2' }, { id: 'q3', label: 'Q3' }],
              series: [
                { id: 'platform', label: 'Platform cost', values: [48, 52, 55] },
                { id: 'adjusted', label: 'Adjusted cost', values: [42, 45, 49] },
              ],
            },
            UK: {
              categories: [{ id: 'q1', label: 'Q1' }, { id: 'q2', label: 'Q2' }, { id: 'q3', label: 'Q3' }],
              series: [
                { id: 'adjusted', label: 'Adjusted cost', values: [36, 39, 43] },
                { id: 'platform', label: 'Platform cost', values: [40, 44, 47] },
              ],
            },
            APAC: {
              categories: [{ id: 'q1', label: 'Q1' }, { id: 'q2', label: 'Q2' }, { id: 'q3', label: 'Q3' }],
              series: [
                { id: 'platform', label: 'Platform cost', values: [72, 80, 88] },
                { id: 'adjusted', label: 'Adjusted cost', values: [65, 70, 78] },
              ],
            },
          },
        },
        // The axis reads the values, so only the value labels are off; the quarters stay named.
        options: { variant: 'grouped', valueAxis: { show: true }, labels: { segment: false, point: false } },
      },
    },
    options: {
      // Width only: the row takes the height its plots need.
      size: { width: 720 },
      sharedAxis: 'none',
      columns: 3,
      legend: 'top',
      title: 'Regional cost trends use one visual vocabulary',
      subtitle: 'Platform cost vs adjusted cost, quarterly',
      source: 'Illustrative media cost model; platform and adjusted cost per region',
      // The UK slice still lists its series in flipped order (the color-lock
      // demo). The grid draws every panel's pair in one order; the note says so.
      // No mark points at it, so it prints unnumbered.
      footnotes: ['Colors are locked per series across all panels — Platform cost is always the darker column.'],
    },
  },
  {
    id: 'mixed-column-line-shared-y',
    title: 'Mixed column over line panels share one y scale',
    kind: 'example',
    data: {
      panels: [
        {
          id: 'spend',
          type: 'column',
          title: 'Media spend',
          caption: 'Quarterly investment',
          data: {
            categories: [{ id: 'q1', label: 'Q1' }, { id: 'q2', label: 'Q2' }, { id: 'q3', label: 'Q3' }, { id: 'q4', label: 'Q4' }],
            series: [{ id: 'spend', label: 'Spend', values: [80, 95, 110, 125] }],
          },
          // Value labels off (the shared axis reads them); the quarter
          // names print once, on the shared axis under the line tier.
          options: { scaleGroup: { y: 'cost' }, valueAxis: { show: true }, labels: { segment: false, point: false, category: false } },
        },
        {
          id: 'cost',
          type: 'line',
          title: 'Platform vs effective cost',
          caption: 'Reported and normalized cost',
          data: {
            categories: [{ id: 'q1', label: 'Q1' }, { id: 'q2', label: 'Q2' }, { id: 'q3', label: 'Q3' }, { id: 'q4', label: 'Q4' }],
            series: [
              { id: 'platform', label: 'Platform', values: [92, 105, 118, 132] },
              { id: 'effective', label: 'Effective', values: [74, 83, 91, 104] },
            ],
          },
          options: {
            scaleGroup: { y: 'cost' },
            valueAxis: { show: true },
            // The line prints its last values; the endpoint names stay.
          },
        },
      ],
    },
    options: {
      size: 'slide-4x3',
      sharedAxis: 'category',
      // The unit both panels share prints once, above the shared scale.
      unit: '$k',
      title: 'Spend and cost now read against the same scale',
      source: 'Illustrative media plan; spend and cost share one scale group',
    },
  },
  {
    id: 'single-panel',
    title: 'Torture: grid of one behaves like the chart alone',
    kind: 'torture',
    data: {
      panels: [{ id: 'only', type: 'column', data: REV, options: { variant: 'stacked' } }],
    },
    options: { sharedAxis: 'category', title: 'Single panel grid', legend: 'top' },
  },
  {
    id: 'category-mismatch',
    title: "Refusal example: panels with different categories cannot share one category axis",
    kind: 'torture',
    // Shared alignment across unlike category ids is refused.
    refuses: { code: 'grid-category-mismatch', path: 'data.panels.1.data.categories' },
    data: {
      panels: [
        { id: 'a', type: 'column', data: REV, options: { variant: 'stacked' } },
        {
          id: 'b',
          type: 'column',
          data: {
            categories: [
              { id: 'jan', label: 'Jan' },
              { id: 'feb', label: 'Feb' },
            ],
            series: [{ id: 's', label: 'S', values: [1, 2] }],
          },
        },
      ],
    },
    options: { sharedAxis: 'category' },
  },
  {
    id: 'metric-ladder',
    title: 'Authored metric ladder: one category-aligned chart over three readout panels',
    kind: 'example',
    data: {
      panels: [
        {
          id: 'ladder-chart',
          type: 'column',
          row: 0,
          column: 0,
          span: { columns: 3 },
          data: {
            categories: [
              { id: 'growth', label: 'Growth' },
              { id: 'margin', label: 'Margin' },
              { id: 'cash', label: 'Cash conversion' },
            ],
            series: [
              { id: 'actual', label: 'Actual', values: [12, 18, 74] },
              { id: 'plan', label: 'Plan', scenario: 'PL', values: [10, 20, 70] },
            ],
          },
          options: {
            // 'grouped' is what the enum offers.
            variant: 'grouped',
            valueAxis: { show: false, gridlines: false },
            // With no axis, the values print, in %, under their metric names.
            format: '12%',
            legend: 'none',
            margin: { top: 0, right: 0, bottom: 0, left: 0 },
          },
        },
        {
          id: 'growth-readout',
          type: 'text',
          row: 1,
          column: 0,
          data: {
            title: '+2 pts vs plan',
            body: 'Growth is ahead of plan as the new channel scales.',
          },
        },
        {
          id: 'margin-readout',
          type: 'text',
          row: 1,
          column: 1,
          data: {
            title: '−2 pts vs plan',
            body: 'Margin remains the single recovery priority.',
          },
        },
        {
          id: 'cash-readout',
          type: 'text',
          row: 1,
          column: 2,
          data: {
            title: '+4 pts vs plan',
            body: 'Cash conversion offsets the margin shortfall.',
          },
        },
      ],
    },
    options: {
      // Width and rows automatic: the readouts take their text height, the chart a
      // plot 0.4 of its width tall; a fixed 3:1 row split would make the card
      // 600+ px tall on a 400 px card, where the readouts wrap to four lines.
      size: { width: 720 },
      columns: [1, 1, 1],
      gutters: { rows: 12, columns: [14, 14] },
      anchors: { categories: 'column' },
      legend: 'top',
      title: 'Value-creation metric ladder',
      subtitle: { measure: 'Growth, margin and cash conversion', period: 'FY26 YTD' },
      source: 'Illustrative operating review',
    },
  },
  {
    id: 'assessment-map',
    title: 'Assessment table and point map share the same A–G decision identities',
    kind: 'example',
    data: {
      panels: [
        {
          id: 'assessment-table',
          type: 'table',
          row: 0,
          column: 0,
          data: {
            columns: [
              { id: 'label', kind: 'rowLabel', label: 'Initiative' },
              { id: 'status', kind: 'status', label: 'Delivery status' },
            ],
            rows: [
              { id: 'A', label: 'A · Core expansion', cells: { status: 'on-track' } },
              { id: 'B', label: 'B · Service attach', cells: { status: 'on-track' } },
              { id: 'C', label: 'C · Partner channel', cells: { status: 'at-risk' } },
              { id: 'D', label: 'D · New geography', cells: { status: 'on-track' } },
              { id: 'E', label: 'E · Product sunset', cells: { status: 'off-track' } },
              { id: 'F', label: 'F · Automation', cells: { status: 'on-track' } },
              { id: 'G', label: 'G · Acquisition', cells: { status: 'at-risk' } },
            ],
          },
          options: { variant: 'status', density: 'compact', legend: 'none' },
        },
        {
          id: 'assessment-scatter',
          type: 'scatter',
          row: 0,
          column: 1,
          data: {
            groups: [
              { id: 'priority', label: 'Priority' },
              { id: 'selective', label: 'Selective' },
              { id: 'defer', label: 'Defer' },
            ],
            points: [
              { id: 'A', group: 'priority', label: 'A', x: 8.4, y: 8.8 },
              { id: 'B', group: 'priority', label: 'B', x: 7.1, y: 8.0 },
              { id: 'C', group: 'selective', label: 'C', x: 6.8, y: 5.7 },
              { id: 'D', group: 'priority', label: 'D', x: 8.7, y: 6.5 },
              { id: 'E', group: 'defer', label: 'E', x: 3.1, y: 4.0 },
              { id: 'F', group: 'selective', label: 'F', x: 5.7, y: 7.2 },
              { id: 'G', group: 'defer', label: 'G', x: 4.0, y: 3.0 },
            ],
          },
          options: {
            valueAxis: { show: true, gridlines: true },
            legend: 'none',
            axisTitles: { x: 'Execution feasibility', y: 'Strategic attractiveness' },
            unit: 'Attractiveness × feasibility',
          },
        },
        {
          id: 'assessment-legend',
          type: 'legend',
          row: 1,
          column: 0,
          span: { columns: 2 },
          align: {
            horizontal: 'center',
            vertical: 'center',
            width: 600,
            height: 44,
          },
          data: { from: ['assessment-scatter'] },
        },
      ],
    },
    options: {
      size: { width: 796, height: 485 },
      columns: [1.15, 1.05],
      // the table rows of the level ladder are taller than the one
      // uniform row they replaced, so the decision list needs its panel back
      // from the legend strip. Its slot also fits the measured key height.
      rows: [1, 0.16],
      gutters: { rows: 10, columns: 18 },
      legend: 'none',
      title: 'A–G assessment links the decision list to the portfolio map',
      subtitle: { measure: 'Strategic attractiveness and execution feasibility' },
      source: 'Illustrative portfolio assessment',
    },
  },
  {
    id: 'authored-anchor-torture',
    title: 'Torture: 2×2 authored charts exercise row baselines and column plot edges',
    kind: 'torture',
    tags: ['demo', 'regression', 'authored-anchors'],
    data: {
      panels: [
        ...[0, 1, 2, 3].map((index) => ({
          id: `anchor-${index + 1}`,
          type: 'column',
          row: Math.floor(index / 2),
          column: index % 2,
          data: {
            categories: [
              { id: 'a', label: 'A' },
              { id: 'b', label: 'B' },
              { id: 'c', label: 'C' },
            ],
            series: [
              {
                id: 'value',
                label: 'Value',
                values: [12 + index * 4, 20 + index * 5, 16 + index * 3],
              },
            ],
          },
          // Each panel has a title, and its category names stay; the axis reads the values.
          title: `Unit ${index + 1}`,
          options: {
            valueAxis: { show: true },
            labels: { segment: false, point: false },
            legend: 'none',
          },
        })),
      ],
    },
    options: {
      size: { width: 811, height: 456 },
      columns: [1, 1],
      rows: [1, 1],
      gutters: { rows: 14, columns: 18 },
      anchors: { plotEdges: 'column', baselines: 'row', categories: 'column' },
      alignmentRules: [
        {
          id: 'shared-baseline-guide',
          orientation: 'horizontal',
          at: { panelId: 'anchor-1', anchor: 'baseline' },
          fromPanelId: 'anchor-1',
          toPanelId: 'anchor-2',
        },
      ],
      legend: 'none',
      title: 'Every authored anchor stays exact across its derived track population',
      source: 'Deterministic alignment torture',
    },
  },
  {
    id: 'automatic-inline-legend',
    title: 'Grid automatically places its series key on its own row under the subtitle',
    kind: 'example',
    data: {
      panels: [
        {
          id: 'revenue', type: 'column', row: 0, column: 0,
          data: { categories: REV.categories, series: REV.series.slice(0, 3) },
          options: { variant: 'stacked', title: false, legend: 'none' },
        },
      ],
    },
    options: {
      size: 'slide-16x9', legend: 'auto',
      title: 'AMER growth offsets the EMEA decline',
      subtitle: { measure: 'Revenue' }, unit: '$m',
      source: 'Illustrative quarterly revenue',
    },
  },
  {
    id: 'stacked-plus-dpy-forecast',
    title: 'Actual and forecast revenue with a hatched key and a separate growth tier',
    kind: 'example',
    data: {
      panels: [
        {
          id: 'rev', type: 'column', data: FORECAST_REV,
          options: { variant: 'stacked', unit: '$m', format: '88', labels: { annotation: false, tick: false } },
        },
        {
          id: 'dpy', type: 'variance', data: FORECAST_REV,
          options: { variant: 'relative', variance: { vs: 'py' }, valueAxis: { show: true, gridlines: false } },
        },
      ],
    },
    options: {
      size: 'slide-4x3', sharedAxis: 'category', legend: 'top',
      title: 'Forecast sustains revenue growth in the second half',
      subtitle: { measure: 'Revenue', period: 'FY26' }, unit: '$m',
      source: 'Illustrative actuals and forecast; Q3 and Q4 are forecast',
    },
  },
];

const SMALL_MULTIPLES = {
  categories: [
    { id: 'fy23', label: 'FY23' },
    { id: 'fy24', label: 'FY24' },
    { id: 'fy25', label: 'FY25' },
  ],
  series: [
    { id: 'amer', label: 'AMER', values: [45, 48, 55] },
    { id: 'emea', label: 'EMEA', values: [30, 29, 26] },
    { id: 'apac', label: 'APAC', values: [12, 14, 17] },
  ],
};

fixtures.push(
  {
    id: 'facet-by-series',
    title: 'Small multiples: one panel per series, shared scale, shared legend, message panel',
    kind: 'example',
    tags: ['demo'],
    data: {
      repeat: { facet: 'series', dimension: 'region', values: ['amer', 'emea', 'apac'] },
      template: {
        id: '$region',
        type: 'column',
        title: '$region',
        data: SMALL_MULTIPLES,
        // Value labels off (the axis reads them), category names on.
        options: { unit: '$m', format: '12', labels: { segment: false, point: false }, legend: 'none', valueAxis: { show: true } },
      },
      message: {
        title: 'AMER still leads',
        body: 'AMER and APAC grow through FY25; EMEA declines.',
      },
    },
    options: {
      size: 'slide-4x3',
      sharedAxis: 'none',
      columns: 2,
      legend: 'top',
      highlight: 'amer',
      title: 'AMER still leads while EMEA declines',
      subtitle: { measure: 'Revenue', period: 'FY23–FY25' },
      unit: '$m',
      source: 'Illustrative regional revenue; one panel per series on one scale',
    },
  },
  {
    id: 'facet-by-category',
    title: 'Small multiples: one panel per category with a shared series legend',
    kind: 'example',
    tags: ['demo'],
    data: {
      repeat: { facet: 'category', dimension: 'year', values: ['fy23', 'fy24', 'fy25'] },
      template: {
        id: '$year',
        type: 'column',
        title: '$year',
        data: SMALL_MULTIPLES,
        // Value labels off (the axis reads them), category names on.
        options: { unit: '$m', format: '12', labels: { segment: false, point: false }, legend: 'none', valueAxis: { show: true } },
      },
    },
    options: {
      size: 'slide-4x3',
      sharedAxis: 'none',
      columns: 3,
      legend: 'top',
      highlight: 'fy25',
      title: 'FY25 is the first year AMER pulls away',
      subtitle: { measure: 'Revenue', period: 'FY23–FY25' },
      unit: '$m',
      source: 'Illustrative regional revenue; one panel per year on one scale',
    },
  },
);

const rankedRegions = fixtures.find((fixture) => fixture.id === 'facet-regions-ranked')!;
for (const panelOrder of ['lastAsc', 'totalDesc', 'totalAsc'] as const) {
  fixtures.push({
    ...rankedRegions,
    id: `facet-regions-${panelOrder}`,
    title: panelOrder === 'lastAsc' ? 'Regions ranked by latest revenue, lowest first'
      : panelOrder === 'totalDesc' ? 'Regions ranked by cumulative revenue, highest first'
      : 'Regions ranked by cumulative revenue, lowest first',
    options: { ...rankedRegions.options, panelOrder,
      subtitle: { measure: 'Revenue', period: panelOrder === 'lastAsc'
        ? 'FY23–FY25, panels ranked by FY25 revenue, smallest first'
        : `FY23–FY25, panels ranked by total revenue, ${panelOrder === 'totalDesc' ? 'largest' : 'smallest'} first` } },
  });
}
const anchorComparison = fixtures.find((fixture) => fixture.id === 'authored-anchor-torture')!;
if (!('panels' in anchorComparison.data) || 'measures' in anchorComparison.data) throw new Error('Anchor comparison requires explicit panels');
const anchorPanels = anchorComparison.data.panels.slice(0, 2).map((panel, index) => ({
  ...panel, title: index === 0 ? 'North' : 'South',
  options: { ...panel.options, labels: {} },
}));
fixtures.push({
  ...anchorComparison,
  id: 'shared-baseline-comparison',
  title: 'Two business units share a baseline across the full grid',
  kind: 'example',
  tags: ['demo', 'authored-anchors'],
  data: { panels: anchorPanels.slice(0, 2) },
  options: { ...anchorComparison.options, size: 'slide-16x9', rows: [1], gutters: { columns: 18 },
    anchors: { baselines: 'all' }, title: 'Regional revenue on a shared baseline',
    subtitle: { measure: 'Revenue by segment' }, unit: '$m',
    source: 'Illustrative comparison' },
});
fixtures.push({
  ...anchorComparison,
  id: 'stacked-plot-guides',
  title: 'Stacked comparisons share plot edges and category guides',
  kind: 'example',
  tags: ['demo', 'authored-anchors'],
  data: { panels: anchorPanels.slice(0, 2).map((panel, row) => ({ ...panel, row, column: 0 })) },
  options: { ...anchorComparison.options, columns: [1], rows: [1, 1],
    gutters: { rows: 14 }, anchors: { plotEdges: 'all', categories: 'all' },
    alignmentRules: [
      { id: 'plot-left', orientation: 'vertical', at: { panelId: 'anchor-1', anchor: 'plotLeft' } },
      { id: 'plot-right', orientation: 'vertical', at: { panelId: 'anchor-1', anchor: 'plotRight' } },
      { id: 'category-b', orientation: 'vertical', at: { panelId: 'anchor-1', anchor: 'category', categoryId: 'b' } },
    ], title: 'Regional revenue on the same category positions',
    subtitle: { measure: 'Revenue by segment' }, unit: '$m',
    source: 'Illustrative comparison' },
});

// one aligned panel hides its benchmark label for want of right
// margin on its first pass; the grid gives every aligned plot that margin,
// so the label stands at the line end and both plots still end together.
const BENCHMARK_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun'].map((id) => ({ id, label: id[0]!.toUpperCase() + id.slice(1) }));
fixtures.push({
  id: 'aligned-benchmark-label',
  title: 'Two aligned column tiers, one with a labelled benchmark inside its stack',
  kind: 'example',
  data: {
    panels: [
      {
        id: 'orders',
        type: 'column',
        data: {
          categories: BENCHMARK_MONTHS,
          series: [
            { id: 'new', label: 'New customers', values: [42, 45, 48, 51, 50, 55] },
            { id: 'returning', label: 'Returning', values: [60, 62, 61, 66, 70, 72] },
          ],
        },
        options: { variant: 'stacked', title: 'Orders' },
        annotations: [{ kind: 'valueLine', value: 100, label: 'Benchmark' }],
      },
      {
        id: 'returns',
        type: 'column',
        data: { categories: BENCHMARK_MONTHS, series: [{ id: 'returns', label: 'Returns', colorRole: 'neutralLight', values: [6, 7, 6, 8, 7, 9] }] },
        options: { title: 'Returns' },
      },
    ],
  },
  options: {
    size: 'slide-4x3',
    sharedAxis: 'category',
    // Both tiers count orders; the title compares their heights, so the grid declares the shared scale.
    sharedScale: true,
    legend: 'bottom',
    title: 'Orders run above the benchmark while returns stay under 10 a month',
    subtitle: { measure: 'Orders and returns', period: 'H1' },
    source: 'Synthetic monthly orders',
  },
});

// status panels with hatched states. The grid key draws each hatch on
// the ground its cells lie on, in the authored layout and in the composed one.
const H2 = ['jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const RAG_STATES = [
  { id: 'g', label: 'On track', tone: 'good' as const },
  { id: 'a', label: 'At risk', tone: 'warn' as const },
  { id: 'r', label: 'Off track', tone: 'bad' as const },
  { id: 'g-fc', label: 'On track, forecast', tone: 'good' as const, pattern: 'hatch45' as const },
  { id: 'a-fc', label: 'At risk, forecast', tone: 'warn' as const, pattern: 'hatch45' as const },
  { id: 'r-fc', label: 'Off track, forecast', tone: 'bad' as const, pattern: 'hatch45' as const },
];
// July to September are reported, October to December forecast; '' has no status.
const ragBoard = (rows: [string, string, string[]][]) => ({
  rows: rows.map(([id, label]) => ({ id, label })),
  columns: H2.map((id) => ({ id, label: id[0]!.toUpperCase() + id.slice(1) })),
  cells: rows.flatMap(([row, , states]) => states.flatMap((state, index) => state === ''
    ? []
    : [{ row, col: H2[index]!, state: `${state}${index >= 3 ? '-fc' : ''}` }])),
});
const ALPHA = ragBoard([
  ['finance', 'Finance transformation', ['g', 'g', 'a', 'g', 'g', 'g']],
  ['sales', 'Sales operations', ['a', 'r', 'a', 'a', 'g', '']],
  ['supply', 'Supply chain', ['r', 'r', 'a', 'r', 'a', 'a']],
]);
const BETA = ragBoard([
  ['platform', 'IT platform', ['a', '', 'a', 'a', 'r', 'a']],
  ['people', 'People and culture', ['g', 'a', 'g', 'g', '', '']],
  ['data', 'Data and analytics', ['g', 'g', 'g', 'a', 'a', 'g']],
]);
const RAG_TEXT = {
  subtitle: { measure: 'Workstream status by month, forecast hatched', period: 'H2 2026' },
  source: 'Illustrative programme status; a blank cell has no status yet',
};
fixtures.push(
  {
    id: 'status-programmes-hatched',
    title: 'Two status panels share one key that draws each hatch on its cells\' ground',
    kind: 'torture',
    tags: ['theme'],
    data: {
      panels: [
        { id: 'alpha', type: 'status', row: 0, column: 0, data: ALPHA, options: { states: RAG_STATES, legend: 'none', title: 'Programme Alpha' } },
        { id: 'beta', type: 'status', row: 0, column: 1, data: BETA, options: { states: RAG_STATES, legend: 'none', title: 'Programme Beta' } },
      ],
    },
    options: {
      size: { width: 720, height: 405 }, columns: 2, legend: 'top',
      title: 'Both programmes carry supply and platform risk into December',
      ...RAG_TEXT,
    },
  },
  {
    id: 'status-panel-hatched-key',
    title: 'A status panel in a composed grid keys its hatched states on their ground',
    kind: 'torture',
    tags: ['theme'],
    data: { panels: [{ id: 'alpha', type: 'status', data: ALPHA, options: { states: RAG_STATES, legend: 'none' } }] },
    options: {
      size: 'slide-16x9', legend: 'top',
      title: 'The supply chain stays at risk through December',
      ...RAG_TEXT,
    },
  },
);

// the message panel in its muted tone, every line in the muted ink.
const facetBySeries = fixtures.find((fixture) => fixture.id === 'facet-by-series')!;
fixtures.push({
  ...facetBySeries,
  id: 'facet-by-series-muted-message',
  title: 'Small multiples whose commentary panel reads as a quiet note in the muted tone',
  kind: 'torture',
  tags: ['demo', 'coverage'],
  data: {
    ...facetBySeries.data,
    message: {
      title: 'Read with care',
      body: 'EMEA restated FY24 after the divestment; the three panels share one scale.',
      tone: 'muted',
    },
  },
});

fixtures.push({
  "id": "dumbbell-panel-key",
  "title": "Panel captions and a shared plan key",
  "kind": "torture",
  "data": {
    "panels": [
      {
        "id": "p",
        "type": "dot",
        "title": "Panel A",
        "caption": "Units",
        "row": 0,
        "column": 0,
        "data": {
          "categories": [
            {
              "id": "a",
              "label": "A"
            },
            {
              "id": "b",
              "label": "B"
            }
          ],
          "series": [
            {
              "id": "actual",
              "label": "Actual",
              "colorRole": "highlight",
              "values": [
                17,
                23
              ]
            },
            {
              "id": "plan",
              "label": "Plan",
              "values": [
                21,
                27
              ],
              "scenario": "PL"
            }
          ]
        },
        "options": {
          "variant": "dumbbell"
        }
      }
    ]
  },
  "options": {
    "title": "Panel captions and a shared plan key",
    "source": "Invented example",
    "columns": 1,
    "sharedAxis": "none",
    "legend": "top",
    "size": {
      "width": 960,
      "height": 620
    }
  }
});

fixtures.push({
  id: 'kpi-row-status',
  title: 'Three content-fit KPI cards above a full-width status panel',
  kind: 'example',
  tags: ['sizing'],
  data: { panels: [
    ...['Orders', 'Returns', 'Shipments'].map((label, column) => ({
      id: `card-${column}`, type: 'kpi', row: 0, column,
      data: { label, value: [120, 8, 112][column] },
    })),
    { id: 'status', type: 'status', row: 1, column: 0, span: { columns: 3 },
      data: ALPHA, options: { states: RAG_STATES, legend: 'none' } },
  ] },
  options: { title: 'Orders hold while returns stay low', columns: 3, sharedScale: false, legend: 'none' },
});

fixtures.push({
  id: 'kpi-and-waffle',
  title: 'Two KPI cards beside a two-panel waffle: big numbers on the left, shares on a 10 by 10 grid',
  kind: 'example',
  data: { panels: [
    { id: 'spend', type: 'kpi', row: 0, column: 0, data: { label: 'Average spend per high-spending customer', value: 225, format: '$1' } },
    { id: 'retention', type: 'kpi', row: 1, column: 0, data: { label: 'Customers who rate the service as good', value: 83, format: '1%' } },
    { id: 'shares', type: 'waffle', row: 0, column: 1, span: { rows: 2, columns: 2 },
      data: {
        categories: [
          { id: 'high-spend', label: 'Share of high-spending customers out of all customers' },
          { id: 'repeat', label: 'Share of repeat buyers' },
        ],
        series: [{ id: 'share', label: 'Share', values: [30, 64] }],
      } },
  ] },
  options: { title: 'High spenders are three in ten customers', columns: 3, sharedScale: false, legend: 'none', source: 'Illustrative data' },
});

// every panel names its own series (titles, end labels, a panel key
// row), so legend 'none' draws no grid key row.
const kpiMonths = Array.from({ length: 24 }, (_, i) => ({ id: `m${i + 1}`, label: `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i % 12]} ${24 + Math.floor(i / 12)}`, date: `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01` }));
const kpiWave = (base: number, slope: number, amp: number, phase: number) => kpiMonths.map((_, i) => Math.round(base + i * slope + Math.sin(i / 2 + phase) * amp));
fixtures.push({
  id: 'panels-name-own-series',
  title: 'Five panels each name their own series, so legend none draws no key row',
  kind: 'example',
  tags: ['feature:options'],
  data: { panels: [
    { id: 'orders', type: 'column', title: 'Orders', data: { categories: kpiMonths, series: [{ id: 'orders', label: 'Orders', values: kpiWave(420, 9, 60, 0) }] }, options: { valueLabels: 'extremes' } },
    { id: 'revenue', type: 'column', title: 'Revenue', data: { categories: kpiMonths, series: [{ id: 'revenue', label: 'Revenue', values: kpiWave(80, 1.5, 9, 1), colorRole: 'highlight' }] }, options: { valueLabels: 'ends' } },
    { id: 'conversion', type: 'line', title: 'Conversion rate', data: { categories: kpiMonths, series: [{ id: 'web', label: 'Web', values: kpiWave(30, 0.2, 3, 0) }, { id: 'app', label: 'App', values: kpiWave(42, 0.3, 3, 2) }] }, options: { unit: '%' } },
    { id: 'value', type: 'line', title: 'Order value', data: { categories: kpiMonths, series: [{ id: 'new', label: 'New buyers', values: kpiWave(60, 0.4, 4, 1) }, { id: 'repeat', label: 'Repeat buyers', values: kpiWave(75, 0.5, 4, 3) }] } },
    { id: 'cost', type: 'line', title: 'Cost per order', data: { categories: kpiMonths, series: [{ id: 'paid', label: 'Paid', values: kpiWave(18, 0.1, 2, 0) }, { id: 'organic', label: 'Organic', values: kpiMonths.map((_, i) => (i < 6 ? null : Math.round(9 + i * 0.1 + Math.sin(i) * 1.5))) }] } },
  ] },
  options: { title: 'Five measures over 24 months', columns: 2, legend: 'none', source: 'Illustrative data' },
});

// Nine facets authored in three columns on a phone card: reflow draws them in two,
// where every year prints and no panel title runs into a value.
const nineRegions = ['North America', 'Western Europe', 'Asia Pacific', 'Latin America', 'Middle East & Africa', 'Eastern Europe', 'Nordics', 'India', 'Australia & New Zealand'];
fixtures.push({
  id: 'nine-regions-reflow',
  title: 'Nine facets in at most three columns draw in two on a 320 px card',
  kind: 'example',
  tags: ['feature:options'],
  data: {
    panels: nineRegions.map((region, r) => ({
      id: region.toLowerCase().replace(/ & /g, '-and-').replace(/ /g, '-'),
      type: 'column',
      data: {
        categories: [{ id: 'fy23', label: 'FY23' }, { id: 'fy24', label: 'FY24' }, { id: 'fy25', label: 'FY25' }],
        series: [{ id: 'rev', label: region, values: [20 + (r * 7) % 19, 30 + (r * 5) % 17, 44 + (r * 11) % 26] }],
      },
      options: { title: region },
    })),
  },
  options: { size: { width: 320 }, sharedAxis: 'none', columns: 3, title: 'Every region grows in FY25', unit: '$m', source: 'Illustrative regional revenue' },
});

fixtures.push(...metricStackFixtures);

registerFixtures('grid', fixtures);
