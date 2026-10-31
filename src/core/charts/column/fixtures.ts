/**
 * Column fixtures — examples (stacked
 * time series with CAGR + grand totals, stacked 100% with indicator100,
 * clustered columns with value axis + gridlines); torture set covers
 * negatives in stacks, 10×4 density with long labels, sliver segments,
 * single series × single category, and reference-series plan ticks.
 * Every fixture auto-enters the invariant suite.
 */

import { registerFixtures } from '../../../fixtures/registry';
import { cohortColumnFixtures } from './cohortFixtures';
import { staircaseColumnFixtures } from './staircaseFixtures';
import { EVENT_GROUPS, EVENT_GROUPS_ALL, WEEKLY_EVENTS, WEEKLY_EVENTS_MORE, WEEKLY_REVENUE, weeklyEventCategories } from '../eventSample';
import type { Fixture } from '../../registry';
import type { Annotation } from '../../types/annotations';
import type { RangeChartData } from '../../types/data';
import type { AnomalyColumnOptions } from './types';

const ANOMALY_MONTHS = [
  'Jan 25', 'Feb 25', 'Mar 25', 'Apr 25', 'May 25', 'Jun 25',
  'Jul 25', 'Aug 25', 'Sep 25', 'Oct 25', 'Nov 25', 'Dec 25',
  'Jan 26', 'Feb 26', 'Mar 26', 'Apr 26', 'May 26', 'Jun 26',
  'Jul 26', 'Aug 26', 'Sep 26', 'Oct 26', 'Nov 26', 'Dec 26',
];

/** 34 identical values out of 60 — a MAD of exactly 0 by construction. */
const ANOMALY_TORTURE_VALUES = [
  ...Array.from({ length: 34 }, () => -6),
  -240,
  -3, -9, -11, -4, -8, -2, -7, -5, -12, -1, -10, -13, -14, -15, -16,
  -17, -18, -19, -20, -21, -22, -23, -24, -25, -26,
];

/** The last six periods are a forecast tail: hatch45 over the sign fill. */
const ANOMALY_TORTURE_CELLS = ANOMALY_TORTURE_VALUES.map((number, index) =>
  index >= ANOMALY_TORTURE_VALUES.length - 6
    ? { number, scenario: 'FC' as const }
    : number,
);

/** Three deliberately long labels wrap; the rest stay short. */
const ANOMALY_TORTURE_LABELS = ANOMALY_TORTURE_VALUES.map((_, index) =>
  index === 0
    ? 'Opening working-capital position'
    : index === 34
      ? 'Consolidation adjustment (one-off)'
      : index === 59
        ? 'Closing working-capital position'
        : `P${index + 1}`,
);

const surveyStart: RangeChartData = {
  categories: [
    { id: 'a18', label: '18–29', total100: 410 },
    { id: 'a30', label: '30–44', total100: 520 },
    { id: 'a45', label: '45–59', total100: 480 },
    { id: 'a60', label: '60+', total100: 390, gapAfter: true },
    { id: 'total', label: 'Total', role: 'total' as const },
  ],
  // Shares of each age band's respondents (total100 is the band's n). Bottom to top: the answer scale reads down from the earliest start.
  series: [
    { id: 'none', label: 'Not travelling', colorRole: 'neutralLight', values: [{ pct: 8 }, { pct: 10 }, { pct: 14 }, { pct: 23 }, null] },
    { id: 'jun', label: 'June or later', values: [{ pct: 9 }, { pct: 8 }, { pct: 10 }, { pct: 13 }, null] },
    { id: 'may', label: 'May', values: [{ pct: 16 }, { pct: 9 }, { pct: 12 }, { pct: 10 }, null] },
    { id: 'apr', label: 'April', values: [{ pct: 21 }, { pct: 19 }, { pct: 22 }, { pct: 20 }, null] },
    { id: 'mar', label: 'March', values: [{ pct: 14 }, { pct: 18 }, { pct: 16 }, { pct: 15 }, null] },
    { id: 'feb', label: 'February', values: [{ pct: 11 }, { pct: 12 }, { pct: 10 }, { pct: 8 }, null] },
    { id: 'jan', label: 'January', values: [{ pct: 9 }, { pct: 10 }, { pct: 6 }, { pct: 1 }, null] },
    { id: 'dec', label: 'Before January', values: [{ pct: 12 }, { pct: 14 }, { pct: 10 }, { pct: 10 }, null] },
  ],
};

const surveyOptions: AnomalyColumnOptions = {
  variant: 'stacked100' as const,
  seriesRamp: true,
  seriesLabels: { at: 'left-edge' as const },
  labelDensity: 'full' as const,
  size: { width: 720, height: 560 },
  title: 'Older travellers plan later, and more of them stay home',
  subtitle: { measure: 'When travellers plan to book summer trips', period: '% of respondents by age' },
  sharesOfOneWhole: true,
  source: 'Illustrative survey, n = 1,800; Total weighted by each age group\'s respondents',
};

export const fixtures: Fixture<RangeChartData, AnomalyColumnOptions>[] = [
  {
    id: 'forecast-ci-column',
    title: 'Forecast columns with confidence-interval whiskers',
    kind: 'example',
    tags: ['interaction'],
    hover: { owner: { categoryId: 'q3', seriesId: 'revenue' } },
    data: {
      categories: [
        { id: 'q1', label: 'Q1 AC' },
        { id: 'q2', label: 'Q2 AC' },
        { id: 'q3', label: 'Q3F' },
        { id: 'q4', label: 'Q4F' },
        { id: 'fy27', label: 'FY27F' },
      ],
      series: [
        {
          id: 'revenue',
          label: 'Revenue',
          values: [
            { number: 84, scenario: 'AC' },
            { number: 91, scenario: 'AC' },
            { number: 96, scenario: 'FC', range: { low: 89, high: 104, mid: 96 }, details: { pipeline: 212, coverage: 2.2, owner: 'Sales planning' } },
            { number: 103, scenario: 'FC', range: { low: 93, high: 115, mid: 103 } },
            { number: 118, scenario: 'FC', range: { low: 101, high: 137, mid: 118 } },
          ],
        },
      ],
    },
    options: {
      variant: 'grouped',
      title: 'Revenue growth remains robust despite widening forecast uncertainty',
      subtitle: {
        company: 'Brevinth Systems',
        measure: 'Revenue and forecast confidence interval',
        period: 'FY26–FY27',
        scenarios: ['AC', 'FC'],
      },
      unit: '$m',
      valueAxis: { show: true, gridlines: true },
      detailFields: [
        { key: 'pipeline', label: 'Pipeline', format: '1,234', unit: '$m' },
        { key: 'coverage', label: 'Pipeline coverage', format: '0.0x' },
        { key: 'owner', label: 'Forecast owner' },
      ],
      source: 'Illustrative management forecast; intervals show modeled confidence range',
    },
  },
  {
    id: 'actuals-forecast-operating-rate',
    title: 'Column twin with a selected operating-rate tier',
    kind: 'example',
    tags: ['forecast'],
    data: {
      categories: [
        { id: 'fy20', label: 'FY20' },
        { id: 'fy21', label: 'FY21' },
        { id: 'fy22', label: 'FY22' },
        { id: 'fy23', label: 'FY23' },
        { id: 'fy24', label: 'FY24F' },
        { id: 'fy25', label: 'FY25F' },
        { id: 'fy26', label: 'FY26F' },
        { id: 'fy27', label: 'FY27F' },
      ],
      series: [
        {
          id: 'output',
          label: 'Output',
          colorRole: 'highlight',
          values: [
            74,
            82,
            93,
            102,
            { number: 110, scenario: 'FC' },
            { number: 121, scenario: 'FC' },
            { number: 130, scenario: 'FC' },
            { number: 143, scenario: 'FC' },
          ],
        },
        {
          id: 'market',
          label: 'Addressable market',
          values: [
            100,
            104,
            108,
            112,
            { number: 116, scenario: 'FC' },
            { number: 120, scenario: 'FC' },
            { number: 124, scenario: 'FC' },
            { number: 128, scenario: 'FC' },
          ],
        },
      ],
    },
    options: {
      variant: 'grouped',
      title: 'Output reaches 112% of the modeled market by FY27',
      subtitle: {
        measure: 'Output and addressable market',
        period: 'FY20–FY27',
        scenarios: ['AC', 'FC'],
      },
      unit: 'index',
      valueAxis: { show: true, gridlines: true },
      legend: 'top',
      source: 'Illustrative operating model',
      ratioTier: {
        id: 'operating-rate',
        label: 'Operating rate (output ÷ market)',
        numeratorSeriesId: 'output',
        denominatorSeriesId: 'market',
        at: ['fy20', 'fy22', 'fy24', 'fy27'],
        format: '88%',
        direction: 'higherIsBetter',
      },
    },
  },
  {
    id: 'stacked-net-line-negatives',
    title: 'Net line follows positive stack tops across mixed-sign columns',
    kind: 'example',
    data: {
      categories: [
        { id: 'q1', label: 'Q1' },
        { id: 'q2', label: 'Q2' },
        { id: 'q3', label: 'Q3' },
        { id: 'q4', label: 'Q4' },
        { id: 'q5', label: 'Q5' },
      ],
      series: [
        { id: 'core', label: 'Core', values: [40, 35, 44, 46, 50] },
        { id: 'growth', label: 'Growth', values: [15, 21, 8, 17, 20] },
        { id: 'headwinds', label: 'Headwinds', values: [-8, -5, -12, -7, -10] },
      ],
    },
    options: {
      // 20px taller than the slide-4x3 preset it grew out of: the source line
      // takes ~19.5px off the plot, and at 540 the smallest headwind (−5 at Q2)
      // loses its last label candidate to collision. The footer is paid for out
      // of the canvas, not out of a data label.
      size: { width: 720, height: 560 },
      variant: 'stacked',
      netLine: true,
      grandTotalLabels: false,
      title: 'Positive contribution reaches 70 despite persistent headwinds',
      subtitle: { measure: 'Contribution', period: 'Q1–Q5' },
      unit: '$m',
      legend: 'bottom',
      source: 'Illustrative contribution model; the line marks the positive total above the headwinds',
    },
  },
  {
    id: 'integrated-stacked-variance',
    title: 'Integrated stacked revenue with external PY comparators',
    kind: 'example',
    data: {
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
        {
          id: 'py',
          label: 'PY',
          scenario: 'PY',
          role: 'reference',
          values: [82, 86, 88, 90],
        },
      ],
    },
    options: {
      size: 'slide-4x3',
      variant: 'stacked',
      title: 'Revenue is 6–9% above PY despite continued EMEA decline',
      subtitle: {
        measure: 'Revenue by region',
        period: 'FY25 by quarter',
        scenarios: ['AC', 'PY'],
      },
      unit: '$m',
      format: '88',
      legend: 'top',
      source: 'Illustrative management accounts',
    },
  },
  {
    id: 'integrated-stacked-variance-collisions',
    title: 'Torture: integrated variance with close references and mixed signs',
    kind: 'torture',
    data: {
      categories: [
        { id: 'jan', label: 'January actual' },
        { id: 'feb', label: 'February actual' },
        { id: 'mar', label: 'March actual' },
        { id: 'apr', label: 'April actual' },
        { id: 'may', label: 'May actual' },
        { id: 'jun', label: 'June actual' },
      ],
      series: [
        { id: 'core', label: 'Core revenue', values: [45.2, 45, 42, 60, 45, 50] },
        { id: 'services', label: 'Services', values: [30, 31, 29, 35, 30, 32] },
        { id: 'apac', label: 'APAC', values: [4.5, 7, 4, 4, 4.8, 7] },
        { id: 'adjustments', label: 'Adjustments', values: [-0.3, 1, -1, 1.2, -0.2, 1] },
        {
          id: 'py',
          label: 'PY',
          scenario: 'PY',
          role: 'reference',
          values: [79.4, 80, 80, 99.8, 80.1, 88],
        },
      ],
    },
    options: {
      size: 'slide-4x3',
      variant: 'stacked',
      title: 'Growth direction remains explicit when PY nearly touches the total',
      subtitle: {
        measure: 'Revenue by component',
        period: 'January–June FY25',
        scenarios: ['AC', 'PY'],
      },
      unit: '$m',
      format: '88.0',
      legend: 'top',
      source: 'Illustrative close-reference stress case',
    },
  },
  {
    id: 'grouped-average-marker',
    title: 'Grouped columns with a computed average marker',
    kind: 'example',
    data: {
      categories: [
        { id: 'north', label: 'North' },
        { id: 'south', label: 'South' },
        { id: 'east', label: 'East' },
        { id: 'west', label: 'West' },
      ],
      series: [
        { id: 'online', label: 'Online', values: [10, 20, 30, 40] },
        { id: 'retail', label: 'Retail', values: [15, 25, 35, 45] },
      ],
    },
    options: {
      variant: 'grouped',
      averageMarker: { scope: 'all' },
      title: 'West leads both channels above the 27.5 average',
      subtitle: { measure: 'Orders', period: 'FY26' },
      source: 'Illustrative channel order data; the average marker is computed over all eight bars',
    },
  },
  {
    id: 'axis-break-tall-outlier',
    title: 'Straight value-axis break compresses one 10x outlier',
    kind: 'example',
    data: {
      categories: [
        { id: 'north', label: 'North' },
        { id: 'south', label: 'South' },
        { id: 'east', label: 'East' },
        { id: 'west', label: 'West' },
        { id: 'global', label: 'Global outlier' },
      ],
      series: [{ id: 'revenue', label: 'Revenue', values: [80, 90, 75, 95, 900] }],
    },
    options: {
      title: 'The global outlier is shown without flattening regional differences',
      subtitle: { measure: 'Revenue', period: 'FY26' },
      unit: '$m',
      valueAxis: { show: true, gridlines: true, break: { from: 150, to: 750 } },
      source: 'Illustrative regional revenue set; the break spans $150m–$750m',
    },
  },
  {
    id: 'gap-after-with-connectors',
    title: 'Category group gap with stacked-series connectors',
    kind: 'example',
    data: {
      categories: [
        { id: 'actual', label: 'Actual', gapAfter: true },
        { id: 'plan', label: 'Plan' },
        { id: 'forecast', label: 'Forecast' },
      ],
      series: [
        { id: 'core', label: 'Core', values: [55, 60, 64] },
        { id: 'growth', label: 'Growth', values: [25, 28, 31] },
      ],
    },
    options: {
      variant: 'stacked',
      connectors: true,
      title: 'The plan group stays connected across a deliberate category gap',
      legend: 'bottom',
      source: 'Illustrative planning ladder; the gap separates actual from plan and forecast',
    },
  },
  {
    id: 'stacked-with-connectors',
    title: 'Stacked columns with series connectors across a reported gap',
    kind: 'example',
    data: {
      categories: [
        { id: 'q1', label: 'Q1' },
        { id: 'q2', label: 'Q2' },
        { id: 'q3', label: 'Q3' },
        { id: 'q4', label: 'Q4' },
      ],
      series: [
        { id: 'seriesA', label: 'Subscriptions', values: [30, 0, 26, 34] },
        { id: 'seriesB', label: 'Advertising', values: [24, 28, null, 16] },
        { id: 'seriesC', label: 'Transactions', values: [46, 72, 74, 50] },
      ],
    },
    options: {
      variant: 'stacked',
      connectors: { style: 'line', scope: 'all' },
      title: 'Mix shifts stay legible across quarters',
      subtitle: { measure: 'Revenue mix', period: 'FY26' },
      unit: '$m',
      legend: 'bottom',
      source: 'Illustrative quarterly revenue mix; Q3 advertising is not reported',
    },
  },
  {
    id: 'stacked-value-and-share',
    title: 'Stacked columns print each segment value over its share of the stack',
    kind: 'example',
    data: {
      categories: [
        { id: 'fy23', label: 'FY23' },
        { id: 'fy24', label: 'FY24' },
        { id: 'fy25', label: 'FY25' },
        { id: 'fy26', label: 'FY26' },
      ],
      series: [
        { id: 'hardware', label: 'Hardware', values: [46, 45, 42, 40] },
        { id: 'software', label: 'Software', values: [20, 26, 33, 41] },
        { id: 'services', label: 'Services', values: [18, 20, 22, 24] },
      ],
    },
    options: {
      variant: 'stacked',
      labels: { segment: ['absolute', 'percent'] },
      seriesLabels: { at: 'right-edge' },
      title: 'Software grows from a quarter to two fifths of revenue',
      subtitle: { company: 'Brevinth Devices', measure: 'Revenue by segment', period: 'FY23–FY26' },
      unit: '$m',
      source: 'Illustrative segment reporting; shares are of each year\'s total',
    },
  },
  {
    id: 'stacked-ribbons-rank-flow',
    title: 'Ribbon chart: each column ranks its own segments and ribbons cross where an entrant overtakes',
    kind: 'example',
    data: {
      categories: [
        { id: 'p2022', label: '2022' },
        { id: 'p2025', label: '2025\n(annualized)' },
      ],
      series: [
        { id: 'nurthwold', label: 'Nurthwold Aero', values: [12.0, 13.5] },
        { id: 'dravenholt', label: 'Dravenholt Systems', values: [10.0, 11.0] },
        { id: 'kaldervane', label: 'Kaldervane Defense', values: [5.5, 4.5] },
        { id: 'kestavo', label: 'Kestavo Freight', colorRole: 'series-6', values: [4.5, 16.0] },
        { id: 'brevinth', label: 'Brevinth Avionics', values: [3.0, 4.0] },
      ],
    },
    options: {
      variant: 'stacked',
      ribbons: true,
      size: { width: 720, height: 560 },
      title: 'A new entrant overtook three larger suppliers to lead by 2025',
      subtitle: { measure: 'Top 5 suppliers' },
      unit: '$bn',
      source: 'Illustrative data; 2025 annualized from three quarters',
    },
  },
  {
    id: 'stacked100-survey-total-column',
    title: 'Survey answer scale by age band with a weighted Total column set apart by a divider',
    kind: 'example',
    data: surveyStart,
    options: surveyOptions,
  },
  {
    id: 'stacked100-survey-total-ribbons',
    title: 'The same survey with fixed-order ribbons between the ordered age bands, stopping before the Total',
    kind: 'example',
    data: surveyStart,
    options: { ...surveyOptions, ribbons: { order: 'sheet' as const } },
  },
  {
    id: 'category-break-years',
    title: 'Category axis break between decade steps and the recent years; connectors stop at the break',
    kind: 'example',
    data: {
      categories: [
        { id: 'y2000', label: '2000' },
        { id: 'y2010', label: '2010' },
        { id: 'y2020', label: '2020', breakAfter: true },
        { id: 'y2024', label: '2024' },
        { id: 'y2025', label: '2025' },
        { id: 'y2026', label: '2026' },
      ],
      series: [
        { id: 'products', label: 'Products', values: [34, 48, 66, 74, 77, 81] },
        { id: 'services', label: 'Services', values: [12, 16, 29, 44, 49, 58] },
      ],
    },
    options: {
      variant: 'stacked',
      connectors: true,
      seriesLabels: { at: 'right-edge' },
      title: 'Services grew from a quarter to 42% of revenue, most of it since 2020',
      subtitle: { company: 'Brevinth Devices', measure: 'Revenue by business', period: '2000–2026' },
      unit: '$m',
      source: 'Illustrative annual reports; decade steps to 2020, then annual',
    },
  },
  {
    // Each series' CAGR beside
    // its name, a sub-range CAGR at two decimals and the whole-range CAGR,
    // told apart by their periods, and value and share in the plan year only.
    id: 'stacked-series-cagr',
    title: 'Series CAGR beside each series name, two period CAGRs over the stack, shares in the last column only',
    kind: 'example',
    data: {
      categories: [
        { id: 'y2014', label: '2014', date: '2014-12-31' },
        { id: 'y2015', label: '2015', date: '2015-12-31' },
        { id: 'y2016', label: '2016', date: '2016-12-31' },
        { id: 'y2017', label: '2017', date: '2017-12-31' },
        { id: 'y2018', label: '2018', date: '2018-12-31' },
        { id: 'y2019', label: '2019', date: '2019-12-31', breakAfter: true },
        { id: 'y2022', label: '2022', date: '2022-12-31' },
      ],
      series: [
        { id: 'd', label: 'Product D', values: [21, 22, 22, 23, 24, 25, 29] },
        { id: 'c', label: 'Product C', values: [10, 10, 11, 11, 12, 13, 15] },
        { id: 'b', label: 'Product B', values: [19, 21, 22, 24, 26, 28, 41] },
        { id: 'a', label: 'Product A', values: [18, 19, 21, 22, 23, 24, 31] },
      ],
    },
    options: {
      variant: 'stacked',
      connectors: true,
      seriesLabels: { at: 'right-edge', cagr: true },
      shareLabels: { only: ['y2022'], format: '26.3%' },
      valueAxis: { show: true },
      size: { width: 960, height: 540 },
      title: 'Product B grows fastest and carries most of the plan to 2022',
      subtitle: { measure: 'Product sales', period: '2014–2019 actual, 2022 plan' },
      unit: '$m',
      source: 'Synthetic demo data',
    },
    annotations: [
      { kind: 'cagr', from: 'y2014', to: 'y2019', format: '+0.00%' },
      { kind: 'cagr' },
    ],
  },
  {
    id: 'reporting-date-scenario-comparison',
    title: 'Reporting-date AC/PY/PL comparison preserves dimension colors',
    kind: 'example',
    data: {
      categories: [
        { id: 'ac', label: '2026 Actuals' },
        { id: 'py', label: 'PY' },
        { id: 'plan', label: 'Plan' },
      ],
      series: [
        {
          id: 'print',
          label: 'Print',
          values: [
            { number: 3800, scenario: 'AC' },
            { number: 4400, scenario: 'PY' },
            { number: 3700, scenario: 'PL' },
          ],
        },
        {
          id: 'digital',
          label: 'Digital',
          values: [
            { number: 5000, scenario: 'AC' },
            { number: 4600, scenario: 'PY' },
            { number: 5400, scenario: 'PL' },
          ],
        },
        {
          id: 'event',
          label: 'Event',
          values: [
            { number: 1200, scenario: 'AC' },
            { number: 1600, scenario: 'PY' },
            { number: 1700, scenario: 'PL' },
          ],
        },
        {
          id: 'ecommerce',
          label: 'eCommerce',
          values: [
            { number: 700, scenario: 'AC' },
            { number: 650, scenario: 'PY' },
            { number: 750, scenario: 'PL' },
          ],
        },
      ],
    },
    options: {
      size: 'slide-4x3',
      variant: 'stacked',
      connectors: true,
      legend: 'top',
      title: 'Digital growth does not fully offset the Print decline versus PY',
      subtitle: {
        measure: 'Revenue',
        period: 'YTD Jan–Jun 2026',
        scenarios: ['AC', 'PY', 'PL'],
      },
      unit: '$k',
      source: 'Illustrative media-group revenue reporting; one reporting date, three scenarios',
    },
  },
  {
    id: 'stacked-dashed-connectors',
    title: 'Stacked columns with dashed series connectors',
    kind: 'example',
    data: {
      categories: [
        { id: 'fy24', label: 'FY24' },
        { id: 'fy25', label: 'FY25' },
        { id: 'fy26', label: 'FY26P' },
      ],
      series: [
        { id: 'own', label: 'Own retail', values: [42, 46, 51] },
        { id: 'partner', label: 'Partner', values: [28, 25, 22] },
        { id: 'online', label: 'Online', values: [18, 24, 31] },
      ],
    },
    options: {
      variant: 'stacked',
      connectors: { style: 'dashed' },
      title: 'Online overtakes partner as the second channel',
      subtitle: { measure: 'Channel revenue', period: 'FY24–FY26' },
      unit: '$m',
      legend: 'bottom',
      source: 'Illustrative channel plan; FY26 is a plan figure',
    },
  },
  {
    id: 'stacked100-share-shift-connectors',
    title: 'Stacked 100% columns with share-boundary connectors',
    kind: 'example',
    data: {
      categories: [
        { id: '2023', label: '2023' },
        { id: '2024', label: '2024' },
        { id: '2025', label: '2025' },
        { id: '2026', label: '2026F' },
      ],
      series: [
        { id: 'seriesA', label: 'Print', values: [60, 50, 38, 28] },
        { id: 'seriesB', label: 'Digital', values: [30, 36, 44, 50] },
        { id: 'seriesC', label: 'Subscriptions', values: [10, 14, 18, 22] },
      ],
    },
    options: {
      variant: 'stacked100',
      connectors: true,
      title: 'Digital and subscriptions reshape the revenue mix',
      subtitle: { measure: 'Revenue share', period: '2023–2026' },
      legend: 'bottom',
      source: 'Illustrative revenue-mix model; 2026 is a forecast',
    },
  },
  {
    id: 'stacked-revenue-cagr',
    title: 'Stacked column time series with CAGR arrow and grand totals',
    kind: 'example',
    data: {
      categories: [
        { id: 'fy19', label: 'FY19', date: '2019-12-31' },
        { id: 'fy20', label: 'FY20', date: '2020-12-31' },
        { id: 'fy21', label: 'FY21', date: '2021-12-31' },
        { id: 'fy22', label: 'FY22', date: '2022-12-31' },
        { id: 'fy23', label: 'FY23', date: '2023-12-31' },
        { id: 'fy24', label: 'FY24F', date: '2024-12-31' },
      ],
      series: [
        {
          id: 'software',
          label: 'Software',
          values: [58, 72, 89, 104, 126, { number: 148, scenario: 'FC' }],
        },
        {
          id: 'services',
          label: 'Services',
          values: [34, 38, 41, 47, 52, { number: 58, scenario: 'FC' }],
        },
        {
          id: 'hardware',
          label: 'Hardware',
          values: [51, 48, 44, 41, 38, { number: 34, scenario: 'FC' }],
        },
      ],
    },
    options: {
      variant: 'stacked',
      title: 'Revenue compounds at 11% p.a. as software extends its lead over hardware',
      subtitle: {
        company: 'Nurthwold Group',
        measure: 'Revenue',
        period: 'FY19–FY24',
        scenarios: ['AC', 'FC'],
      },
      unit: '$m',
      source: 'Nurthwold annual reports; FY24 company forecast',
      // The names at FY24F replace the series in the key; the key keeps the forecast hatch.
      seriesLabels: { at: 'right-edge' },
      legend: 'bottom',
    },
    annotations: [{ kind: 'cagr' }],
  },
  {
    id: 'stacked-revenue-cagr-arrow',
    title: 'Stacked column time series with a straight CAGR arrow',
    kind: 'example',
    data: {
      categories: [
        { id: 'fy19', label: 'FY19', date: '2019-12-31' },
        { id: 'fy20', label: 'FY20', date: '2020-12-31' },
        { id: 'fy21', label: 'FY21', date: '2021-12-31' },
        { id: 'fy22', label: 'FY22', date: '2022-12-31' },
        { id: 'fy23', label: 'FY23', date: '2023-12-31' },
        { id: 'fy24', label: 'FY24', date: '2024-12-31' },
      ],
      series: [
        { id: 'software', label: 'Software', values: [58, 72, 89, 104, 126, 148] },
        { id: 'services', label: 'Services', values: [34, 38, 41, 47, 52, 58] },
        { id: 'hardware', label: 'Hardware', values: [51, 48, 44, 41, 38, 34] },
      ],
    },
    options: {
      variant: 'stacked',
      title: 'Revenue compounds at 11% p.a. as software extends its lead over hardware',
      subtitle: { company: 'Nurthwold Group', measure: 'Revenue', period: 'FY19–FY24' },
      unit: '$m',
      source: 'Nurthwold annual reports',
      seriesLabels: { at: 'right-edge' },
    },
    annotations: [{ kind: 'cagr', shape: 'arrow' }],
  },
  {
    id: 'stacked100-shares-sum',
    title: 'Torture: 100% stacked shares that add up to 100% in every column',
    kind: 'torture',
    data: {
      categories: [
        { id: 'q1', label: 'Q1' },
        { id: 'q2', label: 'Q2' },
      ],
      series: [
        // Rounded one by one, Q1 would print 33% + 33% + 33% = 99%.
        { id: 'online', label: 'Online', values: [10, 18] },
        { id: 'retail', label: 'Retail', values: [10, 21] },
        { id: 'partner', label: 'Partner', values: [10, 15] },
      ],
    },
    options: {
      variant: 'stacked100',
      title: 'Partner share falls from Q1 to Q2',
      subtitle: { measure: 'Revenue by channel', period: 'FY26' },
      source: 'Illustrative data',
    },
  },
  {
    id: 'stacked100-energy-mix',
    title: 'Stacked 100% column with absolute totals and 100% indicator',
    kind: 'example',
    data: {
      categories: [
        { id: '2010', label: '2010' },
        { id: '2015', label: '2015' },
        { id: '2020', label: '2020' },
        { id: '2025f', label: '2025F' },
      ],
      series: [
        { id: 'coal', label: 'Coal', values: [413, 318, 196, { number: 98, scenario: 'FC' }] },
        { id: 'gas', label: 'Gas', values: [154, 186, 204, { number: 182, scenario: 'FC' }] },
        {
          id: 'renewables',
          label: 'Renewables',
          colorRole: 'highlight',
          values: [46, 118, 224, { number: 350, scenario: 'FC' }],
        },
        { id: 'nuclear', label: 'Nuclear', values: [87, 84, 76, { number: 70, scenario: 'FC' }] },
      ],
    },
    options: {
      variant: 'stacked100',
      valueAxis: { show: true },
      title: 'Renewables reach half the generation mix by 2025',
      subtitle: {
        company: 'Company A',
        measure: 'Share of power generation',
        period: '2010–2025',
        scenarios: ['AC', 'FC'],
      },
      source: 'Illustrative capacity statements; 2025 plan values',
      // As in column.stacked, the series names stand at
      // the right edge of the last column and the key keeps only the FC hatch.
      seriesLabels: { at: 'right-edge' },
      legend: 'bottom',
    },
  },
  {
    id: 'clustered-brand-gap',
    title: 'Clustered columns with value axis, gridlines, and diff arrow',
    kind: 'example',
    data: {
      categories: [
        { id: 'brand1', label: 'Brand 1' },
        { id: 'brand2', label: 'Brand 2' },
        { id: 'brand3', label: 'Brand 3' },
        { id: 'brand4', label: 'Brand 4' },
        { id: 'ourbrand', label: 'Our Brand' },
      ],
      series: [
        { id: 'online', label: 'Online', values: [12, 17, 14, 19, 11] },
        { id: 'offline', label: 'Offline', values: [18, 22, 19, 26, 14] },
      ],
    },
    options: {
      // The host can pair this fixture with a second member through ScaleGroup.
      scaleGroup: { y: 'brand-users', id: 'clustered-brand-gap' },
      variant: 'grouped',
      valueAxis: { show: true, gridlines: true },
      highlight: 'ourbrand',
      title: 'Our Brand trails Brand 4 by almost half in offline users',
      subtitle: { measure: 'Active users', period: 'Q2 2026' },
      unit: 'K users',
      source: 'App analytics, June 2026',
      legend: 'bottom',
    },
    annotations: [
      {
        kind: 'diff',
        from: { categoryId: 'brand4', seriesId: 'offline', edge: 'end' },
        to: { categoryId: 'ourbrand', seriesId: 'offline', edge: 'end' },
        mode: 'relative',
      },
    ],
  },
  {
    // Ranked dense columns: values wider than their columns lift clear of the
    // taller neighbour or stagger one row up on a short leader, none floats.
    id: 'ranked-dense-staggered',
    title: 'Ranked dense columns: staggered values, tick step, dotted grid, muted labels, highlight emphasis',
    kind: 'example',
    data: {
      categories: Array.from({ length: 32 }, (_, i) => ({ id: `s${i + 1}`, label: `Site ${String(i + 1).padStart(2, '0')}` })),
      series: [{ id: 'score', label: 'Score', values: Array.from({ length: 32 }, (_, i) => 1580 - i * 44 - (i % 3) * 3) }],
    },
    options: {
      title: 'Site 01 leads the ranking',
      subtitle: { measure: 'Score', period: '2026' },
      unit: 'points',
      size: { width: 960 },
      valueAxis: { show: true, gridlines: true, min: 0, tickStep: 400 },
      valueLabels: 'all',
      legend: 'none',
      highlight: ['s1', 's32'],
      theme: { preset: 'standard', overrides: { valueAxis: { gridDash: 'dotted' }, labels: { ink: 'muted' }, type: { title: { family: "'Inter', 'Helvetica Neue', Arial, sans-serif" } } } },
    },
  },
  {
    id: 'ratio-tier-zero-denominator',
    title: 'Torture: zero denominator stays visible as n/a in the ratio tier',
    kind: 'torture',
    data: {
      categories: [
        { id: 'fy20', label: 'FY20' },
        { id: 'fy21', label: 'FY21' },
        { id: 'fy22', label: 'FY22' },
        { id: 'fy23', label: 'FY23' },
        { id: 'fy24', label: 'FY24F' },
        { id: 'fy25', label: 'FY25F' },
        { id: 'fy26', label: 'FY26F' },
        { id: 'fy27', label: 'FY27F' },
      ],
      series: [
        {
          id: 'output',
          label: 'Output',
          colorRole: 'highlight',
          values: [
            74,
            82,
            93,
            102,
            { number: 110, scenario: 'FC' },
            { number: 121, scenario: 'FC' },
            { number: 130, scenario: 'FC' },
            { number: 143, scenario: 'FC' },
          ],
        },
        {
          id: 'market',
          label: 'Addressable market',
          values: [
            100,
            104,
            108,
            112,
            { number: 0, scenario: 'FC' },
            { number: 120, scenario: 'FC' },
            { number: 124, scenario: 'FC' },
            { number: 128, scenario: 'FC' },
          ],
        },
      ],
    },
    options: {
      variant: 'grouped',
      title: 'FY24 market is zero, so the operating rate fails closed as n/a',
      subtitle: {
        measure: 'Output and addressable market',
        period: 'FY20–FY27',
        scenarios: ['AC', 'FC'],
      },
      unit: 'index',
      valueAxis: { show: true, gridlines: true },
      legend: 'top',
      source: 'Deliberate zero-denominator contract fixture',
      ratioTier: {
        id: 'operating-rate',
        label: 'Operating rate (output ÷ market)',
        numeratorSeriesId: 'output',
        denominatorSeriesId: 'market',
        at: ['fy20', 'fy22', 'fy24', 'fy27'],
        format: '88%',
        direction: 'higherIsBetter',
      },
    },
  },
  {
    id: 'negative-stacks',
    title: 'Torture: negatives mixed into stacks, one all-negative column',
    kind: 'torture',
    data: {
      categories: [
        { id: 'q1', label: 'Q1' },
        { id: 'q2', label: 'Q2' },
        { id: 'q3', label: 'Q3' },
        { id: 'q4', label: 'Q4' },
      ],
      series: [
        { id: 'product', label: 'Product margin', values: [42, 48, -2, 46] },
        { id: 'services', label: 'Services margin', values: [18, 21, -5, 22] },
        { id: 'restructuring', label: 'Restructuring', values: [-12, -4, -38, -6] },
        { id: 'fx', label: 'FX effects', values: [-6, 9, -11, -3] },
      ],
    },
    options: {
      variant: 'stacked',
      title: 'Restructuring wipes out the entire Q3 contribution',
      subtitle: { measure: 'Contribution', period: 'FY26 by quarter' },
      unit: '$m',
      legend: 'bottom',
    },
  },
  {
    // a theme's own on-fill pair. The labels on the mid-tone stacks,
    // where neither theme ink reaches 4.5:1, take color.onFillInk and
    // color.onFillLightInk instead of #050505 and #FFFFFF; the pair stands
    // 20.5:1 apart, so one of them reaches 4.5:1 on every fill.
    id: 'on-fill-ink-tokens',
    title: 'Theme on-fill inks on mid-tone stacks',
    kind: 'example',
    tags: ['theme'],
    data: {
      categories: [
        { id: 'q1', label: 'Q1' },
        { id: 'q2', label: 'Q2' },
        { id: 'q3', label: 'Q3' },
        { id: 'q4', label: 'Q4' },
      ],
      series: [
        { id: 'product', label: 'Product margin', values: [42, 48, -2, 46] },
        { id: 'services', label: 'Services margin', values: [18, 21, -5, 22] },
        // Restructuring is the fourth rank, set to a mid-tone grey below, so
        // its large labels sit on a fill where neither ink nor inkInverse
        // reaches 4.5:1 (the boardroom grey #72767C now passes with white).
        { id: 'fx', label: 'FX effects', values: [-6, 9, -11, -3] },
        { id: 'restructuring', label: 'Restructuring', values: [-12, -4, -38, -6] },
      ],
    },
    options: {
      size: { width: 720, height: 540 },
      variant: 'stacked',
      title: 'Restructuring wipes out the entire Q3 contribution',
      subtitle: { measure: 'Contribution', period: 'FY26 by quarter' },
      unit: '$m',
      legend: 'bottom',
      theme: { preset: 'boardroom', overrides: { color: { onFillInk: '#000000', onFillLightInk: '#FDFCFA', series: ['#12395E', '#335B83', '#5E99C5', '#7A7A7A'] } } },
    },
  },
  {
    id: 'dense-grouped-10x4',
    // Accepted density trade-off: point:q3:dach (endpoint band) hides by
    // collision. The group is over-subscribed — four ~14px labels over a
    // ~40px group of 9px bars — so every remaining slot steals a neighbor's
    // seat (a further-shifted candidate just reassigns the hide to q4).
    // 39 of 40 point labels place; hiding the 40th IS the overlap-freedom
    // invariant working as designed.
    title: 'Torture: 10 categories × 4 series, long labels, smart density (one label hide accepted)',
    kind: 'torture',
    data: {
      categories: [
        { id: 'dach', label: 'Germany, Austria & Switzerland' },
        { id: 'fr', label: 'France (incl. Monaco)' },
        { id: 'uki', label: 'United Kingdom & Ireland' },
        { id: 'iberia', label: 'Iberia — Spain and Portugal' },
        { id: 'it', label: 'Italy incl. San Marino' },
        { id: 'nordics', label: 'Nordics (SE, NO, DK, FI)' },
        { id: 'pl', label: 'Poland & Baltic states' },
        { id: 'benelux', label: 'Benelux region' },
        { id: 'ch', label: 'Rest of Alpine region' },
        { id: 'cee', label: 'Central & Eastern Europe other' },
      ],
      series: [
        { id: 'q1', label: 'Q1', values: [21, 8, 18, 9, 8, 8, 7, 8, 4, 6] },
        { id: 'q2', label: 'Q2', values: [23, 15, 8, 10, 13, 12, 8, 8, 5, 7] },
        { id: 'q3', label: 'Q3', values: [24, 9, 9, 9, 9, 9, 9, 9, 5, 7] },
        { id: 'q4', label: 'Q4', values: [27, 17, 21, 12, 14, 15, 10, 10, 6, 9] },
      ],
    },
    options: {
      variant: 'grouped',
      labelDensity: 'smart',
      title: 'Dense clustered layout stays overlap-free',
      subtitle: { measure: 'Order intake', period: 'FY25 by quarter' },
      unit: '$m',
      legend: 'bottom',
    },
  },
  {
    id: 'sliver-segments',
    title: 'Torture: sliver segments auto-hide, grand totals always render',
    kind: 'torture',
    data: {
      categories: [
        { id: 'na', label: 'North America' },
        { id: 'emea', label: 'EMEA' },
        { id: 'apac', label: 'APAC' },
      ],
      series: [
        { id: 'core', label: 'Core platform', values: [412, 386, 298] },
        { id: 'adjacent', label: 'Adjacent products', values: [64, 3, 51] },
        { id: 'ventures', label: 'Ventures', values: [1.2, 0.8, 2.1] },
        { id: 'other', label: 'Other', values: [0.4, 6, 0.6] },
      ],
    },
    options: {
      variant: 'stacked',
      title: 'Ventures remain immaterial in every region',
      subtitle: { measure: 'Revenue', period: 'FY25' },
      unit: '$m',
      legend: 'top',
    },
    // The segment the title is about prints its number; the note line names the rest.
    annotations: [{ kind: 'callout', at: { categoryId: 'apac', seriesId: 'ventures' }, text: 'Ventures ${value}', preferSide: 'right' }],
  },
  {
    // Unit rule: in a $k unit, values from 100 up print whole and the
    // smaller ones keep the decimal the data needs.
    id: 'usd-k-precision',
    title: 'Unit-aware precision: $k values from 100 up print whole, smaller values keep one decimal',
    kind: 'example',
    data: {
      categories: [
        { id: 'search', label: 'Search' },
        { id: 'social', label: 'Social' },
        { id: 'video', label: 'Video' },
        { id: 'affiliate', label: 'Affiliate' },
        { id: 'podcast', label: 'Podcast' },
      ],
      series: [{ id: 'spend', label: 'Spend', values: [1248.6, 734.2, 212.9, 86.4, 12.7] }],
    },
    options: {
      title: 'Search takes more than half of the paid media spend',
      subtitle: { measure: 'Paid media spend', period: 'Q3 2026' },
      unit: '$k',
      source: 'Illustrative data',
    },
  },
  {
    id: 'single-series-single-category',
    title: 'Torture: one series, one category',
    kind: 'torture',
    data: {
      categories: [{ id: 'total', label: 'Group total' }],
      series: [{ id: 'rev', label: 'Revenue', values: [87.5] }],
    },
    options: {
      title: 'Minimal single-column sanity check',
      unit: '$m',
    },
  },
  {
    id: 'plan-ticks',
    title: 'Torture: reference-series plan ticks with value line',
    kind: 'torture',
    data: {
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
        { id: 'plan', label: 'Plan', role: 'reference', scenario: 'PL', values: [90, 92, 96, 99] },
      ],
    },
    options: {
      variant: 'stacked',
      referenceStyle: 'tick',
      // The totals print, so each reads against its plan value.
      margin: { right: 64 },
      title: 'The plan gap closes to one point by Q4',
      subtitle: { measure: 'Revenue', period: 'FY25 by quarter', scenarios: ['AC', 'PL'] },
      unit: '$m',
      legend: 'bottom',
      source: 'Group controlling, plan v3',
    },
    annotations: [{ kind: 'valueLine', value: 'mean' }],
  },
  // ---- Anomaly preset. APPENDED, never prepended: STATIC_PINS.column
  // pins fixtures[0]'s SVG and must not move.
  {
    id: 'cash-movement-anomalies',
    title: 'Two months break out of the normal cash swing',
    kind: 'example',
    // The category row sits under the lowest value label (−41 and its flag),
    // so the Jul 26 tick keeps its seat; nothing hides.
    data: {
      categories: ANOMALY_MONTHS.map((label, index) => ({ id: `m${index + 1}`, label })),
      series: [
        {
          id: 'net',
          label: 'Net cash movement',
          // Median 4, MAD 4.5 → scale 6.6717, corridor ±23.35 at k = 3.5.
          // Exactly two periods fall outside, one of each sign.
          values: [12, -8, 5, 9, -3, 7, 4, -6, 58, 3, -5, 8, 6, -9, 2, 5, -4, 7, 3, -41, 6, 4, -2, 9],
        },
      ],
    },
    options: {
      variant: 'grouped',
      signColor: true,
      anomaly: { method: 'mad', baseline: 'zero' },
      valueAxis: { show: true },
      title: 'Two months break out of the normal cash swing',
      subtitle: { measure: 'Net cash movement', period: 'FY25–FY26 by month', scenarios: ['AC'] },
      unit: '$m',
      source: 'Group treasury, monthly cash report',
      size: 'slide-16x9',
    },
  },
  {
    id: 'consensus-surprise-threshold',
    title: 'Authored surprise corridor: no statistics at all',
    kind: 'example',
    data: {
      categories: [
        'Q1 24',
        'Q2 24',
        'Q3 24',
        'Q4 24',
        'Q1 25',
        'Q2 25',
        'Q3 25',
        'Q4 25',
        'Q1 26',
        'Q2 26',
        'Q3 26',
        'Q4 26',
      ].map((label, index) => ({ id: `q${index + 1}`, label })),
      series: [
        {
          id: 'surprise',
          label: 'EPS surprise vs consensus',
          values: [1.2, -2.4, 0.8, 6.9, -1.1, 2.0, -7.3, 3.1, 0.4, -0.9, 8.6, 1.7],
        },
      ],
    },
    options: {
      variant: 'grouped',
      signColor: true,
      anomaly: { method: 'threshold', low: -5, high: 5, label: 'House rule' },
      valueAxis: { show: true },
      title: 'Three quarters missed the ±5% surprise corridor',
      subtitle: { measure: 'EPS surprise vs consensus', period: 'FY24–FY26 by quarter' },
      unit: '%',
      source: 'Illustrative consensus estimates',
      size: 'slide-16x9',
    },
  },
  {
    id: 'anomaly-small-sample',
    title: 'Torture: five periods refuse to produce an outlier verdict',
    kind: 'torture',
    data: {
      categories: ['Wk 1', 'Wk 2', 'Wk 3', 'Wk 4', 'Wk 5'].map((label, index) => ({
        id: `w${index + 1}`,
        label,
      })),
      series: [{ id: 'delta', label: 'Delta vs plan', values: [4, -3, 19, 2, -5] }],
    },
    options: {
      variant: 'grouped',
      signColor: true,
      anomaly: { method: 'mad' },
      valueAxis: { show: true },
      title: 'Five weeks are too few to call any of them exceptional',
      unit: '$k',
      source: 'Weekly flash',
    },
  },
  {
    id: 'anomaly-torture',
    title: 'Torture: 60 periods, MAD = 0, an all-negative series and a 40× tail',
    kind: 'torture',
    data: {
      categories: ANOMALY_TORTURE_LABELS.map((label, index) => ({
        id: `p${index + 1}`,
        label,
      })),
      series: [
        {
          id: 'drawdown',
          label: 'Working-capital drawdown',
          // 34 of 60 values are identical, so the MAD is 0 and the modified
          // z-score is undefined: the chart flags NOTHING and says why. The
          // −240 outlier is 40× the median and still not flagged — proving the
          // degenerate branch refuses rather than falling back to mean ± σ.
          values: ANOMALY_TORTURE_CELLS,
        },
      ],
    },
    options: {
      variant: 'grouped',
      signColor: true,
      anomaly: { method: 'mad' },
      valueAxis: { show: true },
      // 60 per-column values on one dashboard canvas is a label-density case,
      // and this fixture is about the MAD = 0 refusal; the density torture is
      // 'dense-grid-long-labels' above.
      labels: { point: false },
      title: 'Half the periods are identical, so no period can be called exceptional',
      // The FC tail is a scenario the reader has to be told about (the
      // scenario-unexplained lint is right to ask).
      subtitle: {
        measure: 'Working-capital drawdown',
        period: '60 periods',
        scenarios: ['AC', 'FC'],
      },
      unit: '$k',
      source: 'Ledger export',
      // At 'dashboard' (480x270) the anomaly-rule stack leaves too little
      // data plot, the starved shape the plot floors block. The torture (rule
      // + corridor + 60 periods under collision pressure) survives at slide size.
      size: 'slide-16x9',
    },
  },
  {
    id: 'accessible-title-opt-in',
    title: 'Optional SVG hover title',
    kind: 'example',
    data: {
      categories: [{ id: 'q1', label: 'Q1' }, { id: 'q2', label: 'Q2' }],
      series: [{ id: 'revenue', label: 'Revenue', values: [100, 120] }],
    },
    options: { title: 'Quarterly revenue', a11y: { title: true } },
  },
  {
    id: 'minimum-frame',
    title: 'Column at the standalone size floor',
    kind: 'example',
    data: {
      categories: [{ id: 'q1', label: 'Q1' }, { id: 'q2', label: 'Q2' }],
      series: [{ id: 'revenue', label: 'Revenue', values: [100, 120] }],
    },
    options: { title: 'Quarterly revenue', size: { width: 480, height: 270 } },
  },
  {
    id: 'compact-frame',
    title: 'Compact column with source and note marker',
    kind: 'example',
    data: {
      categories: [{ id: 'q1', label: 'Q1' }, { id: 'q2', label: 'Q2' }],
      series: [{ id: 'revenue', label: 'Revenue', values: [100, 120] }],
    },
    options: {
      title: 'Quarterly revenue',
      subtitle: { measure: 'Revenue', period: 'FY26' },
      unit: '$m',
      source: 'Illustrative quarterly report',
      footnotes: ['Values are rounded to the nearest million.'],
      mode: 'compact',
      size: { width: 480, height: 270 },
    },
  },
  {
    id: 'hatched-stack-labels',
    title: 'Forecast stack with protected inside values',
    kind: 'example',
    data: {
      categories: [{ id: 'q1', label: 'Q1F' }, { id: 'q2', label: 'Q2F' }],
      series: [
        { id: 'hardware', label: 'Hardware', scenario: 'FC', values: [100, 110] },
        { id: 'software', label: 'Software', scenario: 'FC', values: [70, 90] },
      ],
    },
    options: {
      title: 'Forecast revenue by product',
      subtitle: { measure: 'Revenue', period: 'FY26', scenarios: ['FC'] },
      unit: '$m',
      source: 'Illustrative forecast',
      variant: 'stacked',
      mode: 'full',
      // Both series are FC: the hatch cannot tell them apart, so the key names them.
      legend: 'top',
      theme: { preset: 'boardroom', overrides: { pattern: { hatchColor: 'ink' } } },
    },
  },
  {
    id: 'host-flush-title',
    title: 'Column title aligned to an unpadded host card',
    kind: 'torture',
    data: {
      categories: [{ id: 'fy24', label: 'FY24' }, { id: 'fy25', label: 'FY25' }, { id: 'fy26', label: 'FY26' }],
      series: [{ id: 'revenue', label: 'Revenue', values: [80, 90, 110] }],
    },
    options: {
      mode: 'full', title: 'Revenue reaches 110',
      subtitle: { measure: 'Revenue' }, unit: '$m',
      canvas: { margin: { top: 0, right: 0, bottom: 0, left: 0 } },
      valueAxis: { show: true }, source: 'Illustrative annual revenue',
    },
  },
  {
    id: 'host-headless',
    title: 'Headless column for a host that prints its own title',
    kind: 'example',
    tags: ['host'],
    hostTitle: 'Revenue grew from $80m in FY24 to $110m in FY26',
    data: {
      categories: [{ id: 'fy24', label: 'FY24', footnote: 1 }, { id: 'fy25', label: 'FY25' }, { id: 'fy26', label: 'FY26' }],
      series: [{ id: 'revenue', label: 'Revenue', values: [80, 90, 110] }],
    },
    options: {
      mode: 'full', title: false,
      subtitle: { measure: 'Revenue' }, unit: '$m',
      canvas: { margin: { top: 0, right: 0, bottom: 0, left: 0 } },
      footnotes: ['Fiscal years end in December.'], source: 'Illustrative annual revenue',
    },
  },
  {
    id: 'automatic-series-key',
    // the default key names multiple series without a theme opt-in.
    title: 'An automatic key above the plot identifies the series with numeric labels',
    kind: 'example',
    data: {
      categories: [{ id: 'q1', label: 'Q1' }, { id: 'q2', label: 'Q2' }, { id: 'q3', label: 'Q3' }],
      series: [
        { id: 'subscriptions', label: 'Subscriptions', values: [80, 90, 110] },
        { id: 'services', label: 'Services', values: [24, 28, 32] },
      ],
    },
    options: {
      title: 'Subscriptions grow faster than services',
      subtitle: { measure: 'Revenue', period: 'FY26 by quarter' }, unit: '$m',
      theme: 'boardroom',
      source: 'Illustrative quarterly revenue',
    },
  },

  {
    id: 'brand-font-numeric-metrics', title: 'Brand-font numeric labels and title punctuation', kind: 'example',
    data: {
      categories: [{ id: 'fy24', label: 'FY24' }, { id: 'fy25', label: 'FY25' }, { id: 'fy26', label: 'FY26' }],
      series: [{ id: 'revenue', kind: 'column', label: 'Net revenue', values: [103.5, 111.11, 128.4] }],
    },
    options: {
      title: 'Net revenue: FY24–FY26', subtitle: { measure: 'Net revenue in $M' },
      source: 'Illustrative financial data', format: '0.00', size: { width: 640, height: 360 },
      theme: { preset: 'boardroom', overrides: { type: { family: "'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif" } } },
    },
  },
  {
    id: 'dense-ninety-value-subset',
    title: 'Ninety daily columns keep endpoints and earliest extrema',
    kind: 'torture',
    data: {
      categories: Array.from({ length: 90 }, (_, i) => ({ id: new Date(Date.UTC(2026, 6, i + 1)).toISOString().slice(0, 10) })),
      series: [{ id: 'count', label: 'Count', values: Array.from({ length: 90 }, (_, i) => i === 35 ? 550 : i >= 34 && i <= 38 ? 560 : i === 52 ? 1850 : 800 + (i * 173) % 701) }],
    },
    options: { target: 'dashboard', size: { width: 1168, height: 340 }, title: 'Ninety daily counts', axisTitles: { primary: 'Daily count, sessions' }, labelDensity: 'smart', valueAxis: { show: true, max: 2200 }, footnotes: false },
  },
  // Appended, not prepended: STATIC_PINS.column pins fixtures[0].
  {
    id: 'option-average-string',
    title: 'Computed mean with caller wording',
    kind: 'example',
    data: {
      categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }],
      series: [{ id: 'orders', label: 'Orders', values: [15, 25, 45] }],
    },
    options: { averageMarker: true, strings: { average: 'Mean' }, title: 'C has the most orders' },
  },
];

// a Rest series (colorRole 'others') in a stack. Its values print on
// every target but the dashboard, where the hover card and the note carry them.
fixtures.push({
  id: 'stacked-rest-series',
  title: 'A stacked column with a Rest series whose values the dashboard leaves unprinted',
  kind: 'torture',
  tags: ['feature:options'],
  data: {
    categories: ['Jan', 'Feb', 'Mar', 'Apr'].map((label) => ({ id: label.toLowerCase(), label })),
    series: [
      { id: 'search', label: 'Search', values: [42, 45, 48, 51] },
      { id: 'social', label: 'Social', values: [28, 30, 27, 33] },
      { id: 'rest', label: 'Rest', colorRole: 'others', values: [14, 12, 15, 13] },
    ],
  },
  options: {
    variant: 'stacked',
    size: { width: 720, height: 480 },
    title: 'Search and Social carry the spend',
    subtitle: { measure: 'Spend', period: 'Jan to Apr' },
    unit: '$k',
    legend: 'bottom',
    source: 'Illustrative media plan',
  },
});

// marks.contrastEdge: true restores the light-page contrast edges: the
// unprinted Rest series takes its separation outline again, on its marks and its key.
// The preset's Others mark clears the page floor on its own now, so the example sets the
// pale Others fill that needs the outline.
fixtures.push({
  id: 'contrast-edge-on',
  title: 'A stacked column whose theme turns the light-page contrast edges back on',
  kind: 'example',
  tags: ['feature:options'],
  data: {
    categories: ['Jan', 'Feb', 'Mar', 'Apr'].map((label) => ({ id: label.toLowerCase(), label })),
    series: [
      { id: 'search', label: 'Search', values: [42, 45, 48, 51] },
      { id: 'social', label: 'Social', values: [28, 30, 27, 33] },
      { id: 'rest', label: 'Rest', colorRole: 'others', values: [14, 12, 15, 13] },
    ],
  },
  options: {
    variant: 'stacked',
    size: { width: 720, height: 480 },
    theme: { preset: 'boardroom', overrides: { color: { othersMark: '#E3EDF5' }, marks: { contrastEdge: true } } },
    title: 'Search and Social carry the spend',
    subtitle: { measure: 'Spend', period: 'Jan to Apr' },
    unit: '$k',
    legend: 'bottom',
    source: 'Illustrative media plan',
  },
});

// on a dark ground the good accent glows as a full column. The fill
// roles give the large signed fills a quieter colour of their own.
fixtures.push({
  id: 'sign-fill-roles',
  title: 'Signed columns in the fill roles of a dark theme',
  kind: 'example',
  tags: ['feature:options'],
  data: {
    categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'].map((label) => ({ id: label.toLowerCase(), label })),
    series: [{ id: 'delta', label: 'Delta vs plan', values: [4.2, -1.8, 3.1, 5.6, -2.4, 2.9] }],
  },
  options: {
    theme: { preset: 'standard-dark', overrides: { color: { goodFill: '#0C7A4A', badFill: '#B4453C' } } },
    variant: 'grouped',
    signColor: true,
    title: 'Four of six months beat plan',
    subtitle: { measure: 'Delta vs plan', period: 'H1 FY26' },
    unit: '$k',
    source: 'Illustrative management accounts',
  },
});

fixtures.push(
  {
    id: 'option-reference-line',
    title: 'Actual orders against plan with line references',
    kind: 'example',
    tags: ['feature:options'],
    data: {
      categories: [
        { id: 'q1', label: 'Q1' },
        { id: 'q2', label: 'Q2' },
        { id: 'q3', label: 'Q3' },
        { id: 'q4', label: 'Q4' },
      ],
      series: [
        { id: 'actual', label: 'Actual', values: [24, 32, 28, 38] },
        { id: 'plan', label: 'Plan', values: [30, 30, 35, 35], role: 'reference', scenario: 'PL' },
      ],
    },
    options: {
      size: { width: 960, height: 520 },
      title: 'Actual orders against plan with line references',
      source: 'Illustrative data',
      referenceStyle: 'line',
      legend: 'bottom',
    },
  },
  {
    id: 'option-reference-marker',
    title: 'Actual orders against plan with marker references',
    kind: 'example',
    tags: ['feature:options'],
    data: {
      categories: [
        { id: 'q1', label: 'Q1' },
        { id: 'q2', label: 'Q2' },
        { id: 'q3', label: 'Q3' },
        { id: 'q4', label: 'Q4' },
      ],
      series: [
        { id: 'actual', label: 'Actual', values: [24, 32, 28, 38] },
        { id: 'plan', label: 'Plan', values: [30, 30, 35, 35], role: 'reference', scenario: 'PL' },
      ],
    },
    options: {
      size: { width: 960, height: 520 },
      title: 'Actual orders against plan with marker references',
      source: 'Illustrative data',
      referenceStyle: 'marker',
      legend: 'bottom',
    },
  },
  {
    id: 'option-median-anomaly',
    title: 'One quarter differs from the typical shipment count',
    kind: 'example',
    tags: ['feature:options'],
    data: {
      categories: [
        { id: 'q1', label: 'Q1' },
        { id: 'q2', label: 'Q2' },
        { id: 'q3', label: 'Q3' },
        { id: 'q4', label: 'Q4' },
        { id: 'q5', label: 'Q5' },
        { id: 'q6', label: 'Q6' },
        { id: 'q7', label: 'Q7' },
        { id: 'q8', label: 'Q8' },
      ],
      series: [{ id: 'shipments', label: 'Shipments', values: [20, 21, 19, 38, 22, 20, 21, 19] }],
    },
    options: {
      size: { width: 960, height: 520 },
      title: 'One quarter differs from the typical shipment count',
      source: 'Illustrative data',
      anomaly: { method: 'mad', baseline: 'median' },
    },
  },
);

fixtures.push(
  {
    id: 'option-lower-ratio',
    title: 'Defects fall relative to inspected units',
    kind: 'example',
    tags: ['feature:options'],
    data: {
      categories: [
        { id: 'q1', label: 'Q1' },
        { id: 'q2', label: 'Q2' },
        { id: 'q3', label: 'Q3' },
        { id: 'q4', label: 'Q4' },
      ],
      series: [
        { id: 'defects', label: 'Defects', values: [8, 6, 7, 4] },
        { id: 'inspected', label: 'Inspected', values: [100, 110, 120, 120] },
      ],
    },
    options: {
      size: { width: 960, height: 520 },
      title: 'Defects fall relative to inspected units',
      source: 'Illustrative data',
      ratioTier: {
        id: 'defect-rate',
        label: 'Defect rate',
        numeratorSeriesId: 'defects',
        denominatorSeriesId: 'inspected',
        at: ['q1', 'q2', 'q3', 'q4'],
        format: '88%',
        direction: 'lowerIsBetter',
      },
      legend: 'bottom',
    },
  },
);

fixtures.push(
  {
    id: "shared-dashboard-overview",
    title: "Dashboard revenue overview with axis-led reading",
    kind: "example",
    data: fixtures.find((fixture) => fixture.id === 'accessible-title-opt-in')!.data,
    options: {
      title: "Revenue rises from Q1 to Q2",
      a11y: {
        title: true
      },
      size: "dashboard",
      labels: false,
      valueAxis: {
        show: true,
        gridlines: true
      }
    },
    tags: [
      "shared-options",
      "host"
    ]
  },
  {
    id: "shared-absolute-outlier",
    title: "Absolute value remains visible above an axis break",
    kind: "torture",
    data: fixtures.find((fixture) => fixture.id === 'axis-break-tall-outlier')!.data,
    options: {
      title: "The global outlier is shown without flattening regional differences",
      subtitle: {
        measure: "Revenue",
        period: "FY26"
      },
      unit: "$m",
      valueAxis: {
        show: true,
        gridlines: true,
        // The authored step holds on both sides of the break.
        tickStep: 100,
        break: {
          from: 150,
          to: 750
        }
      },
      source: "Illustrative regional revenue set; the break spans $150m–$750m",
      labelDensity: "minimal"
    },
    tags: [
      "shared-options",
      "annotation"
    ],
    annotations: [
      {
        kind: "abs",
        id: "global-absolute",
        at: {
          categoryId: "global",
          seriesId: "revenue"
        }
      }
    ]
  },
  {
    id: "shared-energy-indicator",
    title: "Generation shares with an explicit 100 percent indicator",
    kind: "example",
    data: fixtures.find((fixture) => fixture.id === 'stacked100-energy-mix')!.data,
    options: {
      variant: "stacked100",
      valueAxis: {
        show: false
      },
      title: "Renewables reach half the generation mix by 2025",
      subtitle: {
        company: "Company A",
        measure: "Share of power generation",
        period: "2010–2025",
        scenarios: [
          "AC",
          "FC"
        ]
      },
      source: "Illustrative generation mix; 2025 forecast values",
      legend: "bottom",
      margin: {
        left: 90
      }
    },
    tags: [
      "shared-options",
      "annotation"
    ],
    annotations: [
      {
        kind: "indicator100",
        id: "energy-total",
        side: "left"
      }
    ]
  },
);

fixtures.push(
  {
    id: "shared-regional-mix-asc-asc",
    title: "Regional revenue mix with asc category order and asc segment order",
    kind: "example",
    data: {
      categories: [
        {
          id: "north",
          label: "North"
        },
        {
          id: "south",
          label: "South"
        },
        {
          id: "east",
          label: "East"
        },
        {
          id: "west",
          label: "West"
        }
      ],
      series: [
        {
          id: "seriesA",
          label: "Core",
          values: [
            48,
            42,
            55,
            37
          ]
        },
        {
          id: "seriesB",
          label: "Growth",
          values: [
            32,
            38,
            25,
            43
          ]
        },
        {
          id: "seriesC",
          label: "Other",
          values: [
            25,
            30,
            35,
            40
          ]
        }
      ]
    },
    options: {
      variant: "stacked",
      connectors: {
        scope: [
          "seriesA"
        ]
      },
      title: "Regional revenue composition",
      subtitle: {
        measure: "Revenue by product",
        period: "FY26"
      },
      unit: "$m",
      legend: {
        position: "top"
      },
      source: "Illustrative regional revenue mix; category order uses totals and segment order uses series totals",
      sort: {
        categories: "asc",
        segments: "asc"
      }
    },
    tags: [
      "sorting",
      "legend",
      "shared-options"
    ]
  },
  {
    id: "shared-regional-mix-reverse-desc",
    title: "Regional revenue mix with reverse category order and desc segment order",
    kind: "example",
    data: {
      categories: [
        {
          id: "north",
          label: "North"
        },
        {
          id: "south",
          label: "South"
        },
        {
          id: "east",
          label: "East"
        },
        {
          id: "west",
          label: "West"
        }
      ],
      series: [
        {
          id: "seriesA",
          label: "Core",
          values: [
            48,
            42,
            55,
            37
          ]
        },
        {
          id: "seriesB",
          label: "Growth",
          values: [
            32,
            38,
            25,
            43
          ]
        },
        {
          id: "seriesC",
          label: "Other",
          values: [
            25,
            30,
            35,
            40
          ]
        }
      ]
    },
    options: {
      variant: "stacked",
      connectors: {
        scope: [
          "seriesA"
        ]
      },
      title: "Regional revenue composition",
      subtitle: {
        measure: "Revenue by product",
        period: "FY26"
      },
      unit: "$m",
      legend: {
        position: "top"
      },
      source: "Illustrative regional revenue mix; category order uses totals and segment order uses series totals",
      sort: {
        categories: "reverse",
        segments: "desc"
      }
    },
    tags: [
      "sorting",
      "legend",
      "shared-options"
    ]
  },
  {
    id: "shared-regional-mix-sheet-reverse",
    title: "Regional revenue mix with sheet category order and reverse segment order",
    kind: "example",
    data: {
      categories: [
        {
          id: "north",
          label: "North"
        },
        {
          id: "south",
          label: "South"
        },
        {
          id: "east",
          label: "East"
        },
        {
          id: "west",
          label: "West"
        }
      ],
      series: [
        {
          id: "seriesA",
          label: "Core",
          values: [
            48,
            42,
            55,
            37
          ]
        },
        {
          id: "seriesB",
          label: "Growth",
          values: [
            32,
            38,
            25,
            43
          ]
        },
        {
          id: "seriesC",
          label: "Other",
          values: [
            25,
            30,
            35,
            40
          ]
        }
      ]
    },
    options: {
      variant: "stacked",
      connectors: {
        scope: [
          "seriesA"
        ]
      },
      title: "Regional revenue composition",
      subtitle: {
        measure: "Revenue by product",
        period: "FY26"
      },
      unit: "$m",
      legend: {
        position: "bottom"
      },
      source: "Illustrative regional revenue mix; category order uses totals and segment order uses series totals",
      sort: {
        categories: "sheet",
        segments: "reverse"
      }
    },
    tags: [
      "sorting",
      "legend",
      "shared-options"
    ]
  },
  {
    id: 'plan-corridor',
    title: 'Plan corridor around quarterly revenue',
    kind: 'example',
    tags: ['annotation'],
    data: {
      categories: [
        { id: 'q1', label: 'Q1' },
        { id: 'q2', label: 'Q2' },
        { id: 'q3', label: 'Q3' },
        { id: 'q4', label: 'Q4' },
      ],
      series: [{ id: 'rev', label: 'Revenue', values: [82, 91, 88, 97] }],
    },
    options: {
      title: 'All quarters remain inside the plan corridor',
      subtitle: { measure: 'Revenue', period: 'FY25', scenarios: ['AC', 'PL'] },
      unit: '$m',
      source: 'Illustrative plan corridor',
    },
    annotations: [
      { kind: 'band', id: 'plan', style: 'corridor', low: 80, high: 100, scenario: 'PL', label: 'Plan' },
    ],
  },
);

fixtures.push(
  {
    id: 'a11y-table-hidden',
    title: 'Accessible data table hidden behind the chart (default presentation)',
    kind: 'torture',
    tags: ['a11y'],
    data: {
      categories: [
        { id: 'q1', label: 'Q1' },
        { id: 'q2', label: 'Q2' },
        { id: 'q3', label: 'Q3' },
      ],
      series: [
        { id: 'orders', label: 'Orders', values: [24, 32, 28] },
        { id: 'returns', label: 'Returns', values: [4, 6, 5] },
      ],
    },
    options: {
      size: { width: 960, height: 520 },
      title: 'Orders and returns by quarter',
      unit: 'k',
      legend: 'bottom',
      source: 'Illustrative data',
      a11y: { table: 'hidden' },
    },
  },
  {
    id: 'a11y-table-toggle',
    title: 'Accessible data table behind a disclosure control',
    kind: 'torture',
    tags: ['a11y'],
    data: {
      categories: [
        { id: 'q1', label: 'Q1' },
        { id: 'q2', label: 'Q2' },
        { id: 'q3', label: 'Q3' },
      ],
      series: [
        { id: 'orders', label: 'Orders', values: [24, 32, 28] },
        { id: 'returns', label: 'Returns', values: [4, 6, 5] },
      ],
    },
    options: {
      size: { width: 960, height: 520 },
      title: 'Orders and returns by quarter',
      unit: 'k',
      legend: 'bottom',
      source: 'Illustrative data',
      a11y: { table: 'toggle' },
    },
  },
  {
    id: 'a11y-table-below',
    title: 'Accessible data table rendered below the chart',
    kind: 'example',
    tags: ['a11y'],
    data: {
      categories: [
        { id: 'q1', label: 'Q1' },
        { id: 'q2', label: 'Q2' },
        { id: 'q3', label: 'Q3' },
      ],
      series: [
        { id: 'orders', label: 'Orders', values: [24, 32, 28] },
        { id: 'returns', label: 'Returns', values: [4, 6, 5] },
      ],
    },
    options: {
      size: { width: 960, height: 520 },
      title: 'Orders and returns by quarter',
      unit: 'k',
      legend: 'bottom',
      source: 'Illustrative data',
      a11y: { table: 'below' },
    },
  },
);

// The same authored bounds with each supported scenario treatment.
for (const scenario of ['AC', 'PY', 'FC'] as const) {
  const base = fixtures.find(fixture => fixture.id === 'plan-corridor')!;
  fixtures.push({
    ...base,
    id: `scenario-corridor-${scenario.toLowerCase()}`,
    title: `${scenario} notation on an authored revenue corridor`,
    options: { ...base.options, title: `${scenario} corridor spans 80 to 100`, subtitle: { measure: 'Revenue', period: 'FY25', scenarios: [scenario] } },
    annotations: [{ kind: 'band', id: 'corridor', style: 'corridor', low: 80, high: 100, scenario, label: scenario }],
  });
}

// A dashboard slot 380px wide: the chart draws compact instead of refusing.
fixtures.push({
  id: 'column-compact-380',
  title: 'Column in a 380px dashboard column',
  kind: 'example',
  data: {
    categories: [{ id: 'q1', label: 'Q1' }, { id: 'q2', label: 'Q2' }, { id: 'q3', label: 'Q3' }, { id: 'q4', label: 'Q4' }],
    series: [{ id: 'revenue', label: 'Revenue', values: [118, 126, 131, 144] }],
  },
  options: {
    title: 'Revenue grew every quarter',
    unit: '$m',
    size: { width: 380, height: 214 },
  },
});

// A 320 px card with an automatic
// height keeps its whole title, its subtitle and its key, and the plot keeps
// at least half of the canvas.
fixtures.push({
  id: 'column-card-320-frame-rules',
  title: 'Grouped column in a 320px card with an automatic height',
  kind: 'example',
  data: {
    categories: [{ id: 'north', label: 'North' }, { id: 'south', label: 'South' }, { id: 'east', label: 'East' }, { id: 'west', label: 'West' }],
    series: [{ id: 'online', label: 'Online', values: [10, 20, 30, 40] }, { id: 'retail', label: 'Retail', values: [15, 25, 35, 45] }],
  },
  options: {
    variant: 'grouped',
    target: 'dashboard',
    title: 'West leads both channels above the 27.5 average',
    subtitle: { measure: 'Orders', period: 'FY26' },
    legend: 'bottom',
    source: 'Invented channel order data',
    size: { width: 320 },
  },
});

// The running week is hatched and the frame footnote names it.
fixtures.push({
  id: 'column-partial-week',
  title: 'Stacked weekly orders with the running week marked partial',
  kind: 'example',
  data: {
    categories: [
      { id: 'w31', label: 'W31' }, { id: 'w32', label: 'W32' },
      { id: 'w33', label: 'W33' }, { id: 'w34', label: 'W34' },
      { id: 'w35', label: 'W35' }, { id: 'w36', label: 'W36' },
      { id: 'w37', label: 'W37' }, { id: 'w38', label: 'W38', partial: true },
    ],
    series: [
      { id: 'online', label: 'Online', values: [412, 398, 431, 445, 452, 468, 481, 214] },
      { id: 'retail', label: 'Retail', values: [236, 241, 229, 233, 238, 226, 231, 102] },
    ],
  },
  options: {
    variant: 'stacked',
    title: 'Online orders grew every week from W32 to W37',
    unit: 'orders',
    legend: 'bottom',
    source: 'Illustrative data',
  },
});

// Long names at a generous size read whole. The rendered SVG has no ellipsis.
fixtures.push({
  id: 'torture-long-labels',
  title: 'Torture: long names at a generous size read whole, never cut',
  kind: 'torture',
  data: {
    categories: [
      {
        id: 'north',
        label: 'Enterprise cloud infrastructure, managed hosting and sovereign data-centre services for regulated clients',
      },
      {
        id: 'south',
        label: 'Consumer electronics, wearables and connected home devices sold through retail partners',
      },
      {
        id: 'east',
        label: 'Industrial automation, robotics and predictive maintenance contracts in continental Europe',
      },
      {
        id: 'west',
        label: 'Healthcare diagnostics, laboratory information systems and point-of-care testing',
      },
    ],
    series: [
      { id: 'online', label: 'Online', values: [10, 20, 30, 40] },
      { id: 'retail', label: 'Retail', values: [15, 25, 35, 45] },
    ],
  },
  options: {
    variant: 'grouped',
    averageMarker: { scope: 'all' },
    title: 'Long names read whole at a generous size',
    subtitle: { measure: 'Orders', period: 'FY26' },
    legend: 'bottom',
    source: 'Illustrative channel order data; the average marker is computed over all eight bars',
    size: { width: 1440, height: 900 },
  },
});

// The value axis titled "Measure, unit" above its top tick.
fixtures.push({
  id: 'revenue-axis-title',
  title: 'Grouped columns with a titled value axis',
  kind: 'example',
  data: {
    categories: [{ id: 'q1', label: 'Q1' }, { id: 'q2', label: 'Q2' }, { id: 'q3', label: 'Q3' }, { id: 'q4', label: 'Q4' }],
    series: [
      { id: 'product', label: 'Product', values: [38, 41, 40, 44] },
      { id: 'services', label: 'Services', values: [17, 18, 20, 22] },
    ],
  },
  options: {
    variant: 'grouped',
    axisTitles: { primary: 'Revenue, $m' },
    valueAxis: { show: true, gridlines: true },
    title: 'Services grow in every quarter',
    subtitle: { measure: 'Revenue', period: 'FY25 by quarter' },
    legend: 'bottom',
    source: 'Illustrative segment revenue',
  },
});

// The event lane: dated events above the plot, the ones that do not fit
// numbered into the key below it; stock-out periods as thin bars.
const weeklyRevenueOptions = {
  title: 'Revenue dips while two top products are out of stock, then recovers to a W37 high',
  subtitle: { measure: 'Online revenue', period: 'W27–W39 2026' },
  unit: '$k',
  format: '1.0',
  source: 'Shop orders; inventory log',
};
fixtures.push({
  id: 'weekly-events-lane',
  title: 'Event lane: stock-outs and launches over weekly revenue, the rest numbered in the key',
  kind: 'example',
  data: { categories: weeklyEventCategories(true), series: [{ id: 'rev', label: 'Revenue', values: WEEKLY_REVENUE }] },
  annotations: WEEKLY_EVENTS,
  options: {
    ...weeklyRevenueOptions,
    size: { width: 960, height: 540 },
    events: { placement: 'auto', rows: 1, groups: EVENT_GROUPS },
  },
});
fixtures.push({
  id: 'events-key-only',
  title: 'Event key only: nine numbered markers in time order, every event in the key',
  kind: 'example',
  data: { categories: weeklyEventCategories(true), series: [{ id: 'rev', label: 'Revenue', values: WEEKLY_REVENUE }] },
  annotations: [...WEEKLY_EVENTS, ...WEEKLY_EVENTS_MORE],
  options: {
    ...weeklyRevenueOptions,
    // The A4 landscape ratio (960 x 679): with the key of all nine events the 16:9 slide leaves the
    // plot under its 160 px floor and warns.
    size: { width: 960, height: 679 },
    events: { placement: 'key', groups: EVENT_GROUPS_ALL, keyTitle: 'Events in time order' },
  },
});
fixtures.push({
  id: 'events-dashboard',
  title: 'Event markers on a dashboard tile: numbers on the chart, titles in the key',
  kind: 'example',
  data: { categories: weeklyEventCategories(false), series: [{ id: 'rev', label: 'Revenue', values: WEEKLY_REVENUE }] },
  annotations: WEEKLY_EVENTS.filter((event) => event.id !== 'oos-bottle' && event.id !== 'launch-fleece'),
  options: {
    ...weeklyRevenueOptions,
    title: 'Revenue recovers to a W37 high after two stock-outs',
    // A dashboard tile at the A4 landscape ratio, taller than 'dashboard': the key row that says
    // what the event colours mean and 9 px event text take the rows.
    size: { width: 571, height: 405 },
    events: { rows: 0, groups: EVENT_GROUPS },
  },
});

fixtures.push(...cohortColumnFixtures);
fixtures.push(...staircaseColumnFixtures);

// the growth arrows of an integrated PY comparison are optional; with
// labels.growth false the PY ticks and their labels stay.
const integratedVariance = fixtures.find((fixture) => fixture.id === 'integrated-stacked-variance')!;
fixtures.push({
  ...integratedVariance,
  kind: 'torture', id: 'integrated-variance-no-growth',
  title: 'Integrated PY ticks without growth arrows (labels.growth false)',
  options: { ...integratedVariance.options, title: 'Revenue beats PY in every quarter', labels: { growth: false } },
});

// The series names left of the first column, as slide charts
// draw them before an axis is added.
fixtures.push({
  id: 'series-names-left-edge',
  title: 'Stacked series named left of the first column instead of in a legend',
  kind: 'example',
  data: {
    categories: ['2021', '2022', '2023', '2024', '2025'].map((year) => ({ id: year, label: year })),
    series: [
      { id: 'core', label: 'Core licences', values: [42, 45, 47, 50, 52] },
      { id: 'cloud', label: 'Cloud', values: [28, 33, 39, 46, 55] },
      { id: 'services', label: 'Services', values: [15, 16, 18, 19, 21] },
    ],
  },
  options: {
    variant: 'stacked',
    legend: 'none',
    seriesLabels: { at: 'left-edge' },
    title: 'Cloud nearly doubles in four years and passes Core licences',
    subtitle: { measure: 'Revenue', period: '2021 to 2025' },
    unit: '$m',
    source: 'Illustrative product revenue',
  },
});

// The line's window and zoom on column. The periods outside do not
// draw; the subtitle says how many show under a window.
const MONTHS_24 = [25, 26].flatMap((year) => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  .map((month) => ({ id: `${month.toLowerCase()}-${year}`, label: `${month} ${year}` })));
fixtures.push({
  id: 'window-last-12-months',
  title: 'Twenty-four months of orders, the last twelve drawn (window.last)',
  kind: 'example',
  tags: ['feature:options'],
  data: {
    categories: MONTHS_24,
    series: [{ id: 'orders', label: 'Orders', values: [31, 30, 33, 34, 32, 35, 36, 34, 37, 38, 40, 41, 39, 41, 43, 42, 44, 46, 45, 47, 49, 48, 51, 53] }],
  },
  options: {
    window: { last: 12 },
    // The average keeps all 24 months, and its label says so.
    averageMarker: true,
    title: 'Orders rise in eight of the last twelve months',
    subtitle: { measure: 'Orders', period: 'by month' },
    unit: 'k',
    source: 'Illustrative order book',
  },
});
const QUARTERS_16 = [23, 24, 25, 26].flatMap((year) => [1, 2, 3, 4].map((q) => ({ id: `q${q}-${year}`, label: `Q${q} ${year}` })));
fixtures.push({
  id: 'view-domain-two-years',
  title: 'Sixteen quarters of revenue, zoomed to the last eight (viewDomain)',
  kind: 'example',
  tags: ['feature:options'],
  data: {
    categories: QUARTERS_16,
    series: [
      { id: 'hardware', label: 'Hardware', values: [22, 23, 21, 24, 23, 25, 24, 26, 25, 26, 27, 28, 27, 29, 30, 31] },
      { id: 'software', label: 'Software', values: [8, 9, 9, 10, 11, 11, 12, 13, 14, 15, 15, 17, 18, 19, 21, 22] },
    ],
  },
  options: {
    variant: 'stacked',
    viewDomain: { x: ['q1-25', 'q4-26'] },
    legend: 'top',
    title: 'Software adds more than hardware in 2025 and 2026',
    subtitle: { measure: 'Revenue', period: 'Q1 2025 to Q4 2026' },
    unit: '$m',
    source: 'Illustrative segment revenue',
  },
});

// Coverage: net ticks on one named layer without connectors, a stricter
// anomaly k, and series CAGRs over an authored span and format.
const netLineNegatives = fixtures.find((fixture) => fixture.id === 'stacked-net-line-negatives')!;
const cashAnomalies = fixtures.find((fixture) => fixture.id === 'cash-movement-anomalies')!;
const seriesCagr = fixtures.find((fixture) => fixture.id === 'stacked-series-cagr')!;
fixtures.push(
  {
    ...netLineNegatives,
    id: 'net-ticks-on-core',
    title: 'Ticks on the Core layer boundary, not connected',
    tags: ['coverage'],
    options: {
      ...netLineNegatives.options,
      netLine: { seriesId: 'core', connectors: false },
      title: 'Core contribution ends at 50 after a dip to 35 in Q2',
      source: 'Illustrative contribution model; the ticks mark the top of the Core layer',
    },
  },
  {
    ...cashAnomalies,
    kind: 'torture', id: 'cash-anomalies-strict-k',
    title: 'The MAD rule with a stricter k of 5',
    tags: ['coverage'],
    options: { ...cashAnomalies.options, anomaly: { method: 'mad', baseline: 'zero', k: 5 } },
  },
  {
    ...seriesCagr,
    id: 'series-cagr-product-b-named',
    title: 'Only Product B named at the right edge with its CAGR; the key above names every layer',
    tags: ['coverage'],
    options: { ...seriesCagr.options, seriesLabels: { at: 'right-edge', cagr: true, only: ['b'] }, legend: 'top' },
  },
  {
    ...seriesCagr,
    id: 'series-cagr-actual-span',
    title: 'Series CAGRs over the actual years only, at two decimals',
    tags: ['coverage'],
    options: {
      ...seriesCagr.options,
      seriesLabels: { at: 'right-edge', cagr: { from: 'y2014', to: 'y2019', format: '+0.00%' } },
      title: 'Product B grew fastest from 2014 to 2019',
    },
    // The 2014 to 2019 bracket alone, at the precision of the series rates.
    annotations: [seriesCagr.annotations![0]!],
  },
);

// Coverage: the shared options for column: topN with a rest bar, bandFraction, and
// colorblindSafe on a sign-coloured column; embed and interactive.
fixtures.push(
  {
    id: 'channels-top-four',
    title: 'Four channels by name, the other three folded into one rest column, on narrower bands',
    kind: 'example',
    tags: ['coverage'],
    data: {
      categories: [
        { id: 'search', label: 'Search' }, { id: 'social', label: 'Social' }, { id: 'email', label: 'Email' },
        { id: 'affiliate', label: 'Affiliate' }, { id: 'display', label: 'Display' }, { id: 'video', label: 'Video' },
        { id: 'audio', label: 'Audio' },
      ],
      series: [{ id: 'revenue', label: 'Revenue', values: [420, 310, 180, 95, 60, 40, 25] }],
    },
    options: {
      topN: { n: 4, rest: true, showRestCount: true },
      bandFraction: 0.5,
      title: 'Search and social bring 65% of channel revenue',
      subtitle: { measure: 'Revenue by channel', period: 'FY26' },
      unit: '$k',
      source: 'Illustrative channel revenue',
    },
  },
  {
    id: 'channels-embedded-interactive',
    title: 'The channel columns declared for a 720 px host and carrying data-bp semantics for web interaction',
    kind: 'example',
    tags: ['coverage'],
    data: {
      categories: [{ id: 'search', label: 'Search' }, { id: 'social', label: 'Social' }, { id: 'email', label: 'Email' }],
      series: [{ id: 'revenue', label: 'Revenue', values: [420, 310, 180] }],
    },
    options: {
      embed: { width: 720 },
      interactive: true,
      title: 'Search brings the most channel revenue',
      subtitle: { measure: 'Revenue by channel', period: 'FY26' },
      unit: '$k',
      source: 'Illustrative channel revenue',
    },
  },
  {
    ...cashAnomalies,
    id: 'cash-anomalies-colorblind',
    title: 'Sign colours from the colour-vision-safe pair',
    tags: ['coverage'],
    options: { ...cashAnomalies.options, colorblindSafe: true },
  },
);

// two weeks without any data and one week missing a part. The empty
// weeks read n/a on the baseline; only the partial week goes in the note.
fixtures.push({
  id: 'stacked-empty-weeks',
  title: 'Two weeks without data and one partial week in a stack',
  kind: 'torture',
  data: {
    categories: ['w30', 'w31', 'w32', 'w33', 'w34', 'w35'].map((id) => ({ id, label: id.replace('w', 'W') })),
    series: [
      { id: 'new', label: 'New customers', values: [42, null, null, 47, 51, 49] },
      { id: 'returning', label: 'Returning', values: [88, null, null, 91, null, 95] },
    ],
  },
  options: {
    variant: 'stacked',
    size: { width: 640, height: 454 },
    title: 'Orders hold steady around the reporting outage',
    subtitle: { measure: 'Orders', period: 'by week' },
    source: 'Synthetic weekly orders',
    legend: 'bottom',
  },
});

// A daily stack where some parts are missing on some days: no "n/a" on a
// drawn column, segment values inside or nowhere, one plain total over every column.
fixtures.push({
  id: 'stacked-missing-parts-daily',
  title: 'Daily stack with missing parts on some days',
  kind: 'torture',
  data: {
    categories: Array.from({ length: 16 }, (_, i) => { const date = `2025-03-${String(i + 3).padStart(2, '0')}`; return { id: date, date }; }),
    series: [
      { id: 'core', label: 'Core plan', values: [5120, 4380, 7720, 3910, 6650, 5840, 3630, 6990, 3570, 6210, 3880, 4020, 6340, 8960, 4210, 4950] },
      { id: 'plus', label: 'Plus plan', values: [7010, null, 4460, null, 3120, 7380, 540, 6460, 2310, 1240, 1050, 2470, 6190, 1520, 4480, 4890] },
      { id: 'trial', label: 'Trial', values: [410, 48, null, 46, null, 160, 520, 330, 240, null, 450, 350, 230, null, 600, 530] },
      { id: 'other', label: 'Other', values: [730, 670, 1110, 920, 370, null, null, null, 1240, 150, null, null, 530, 960, 190, 620] },
    ],
  },
  options: {
    variant: 'stacked',
    size: { width: 640, height: 454 },
    title: 'Revenue by plan, per day',
    unit: '$',
    source: 'Synthetic daily revenue',
    // The notes-list lead for totals that miss a part; the "(partial)" marker prints only under notes.show 'disclosure'.
    strings: { knownPartsTotals: 'Daily totals add the reported plans only' },
  },
});

// shares of one whole stack and carry a total, without the non-additive warning.
fixtures.push({
  id: 'stacked-shares-of-one-whole',
  title: 'Channel shares of all orders, declared shares of one whole',
  kind: 'example',
  tags: ['feature:options'],
  data: {
    categories: ['2023', '2024', '2025'].map((id) => ({ id, label: id })),
    series: [
      { id: 'web', label: 'Web shop', values: [38, 41, 44] },
      { id: 'app', label: 'App', values: [12, 17, 22] },
    ],
  },
  options: {
    variant: 'stacked',
    sharesOfOneWhole: true,
    unit: '%',
    title: 'Online channels take two thirds of orders',
    subtitle: { measure: 'Share of all orders', period: '2023–2025' },
    source: 'Synthetic order mix',
    legend: 'bottom',
  },
});

// the column twin of line/stacked-area-benchmark.
fixtures.push({
  id: 'stacked-benchmark-line',
  title: 'A labelled benchmark across stacked columns',
  kind: 'example',
  data: {
    categories: ['jan', 'feb', 'mar', 'apr', 'may', 'jun'].map((id) => ({ id, label: id[0]!.toUpperCase() + id.slice(1) })),
    series: [
      { id: 'new', label: 'New customers', values: [42, 45, 48, 51, 50, 55] },
      { id: 'returning', label: 'Returning', values: [60, 62, 61, 66, 70, 72] },
    ],
  },
  options: {
    variant: 'stacked',
    title: 'Orders run above the benchmark in every month',
    subtitle: { measure: 'Orders', period: 'H1' },
    source: 'Synthetic monthly orders',
    legend: 'bottom',
  },
  annotations: [{ kind: 'valueLine', value: 100, label: 'Benchmark' }],
});

// a valueLine prints its label, so text on it is refused with the
// patch that renames it (column/stacked-benchmark-line shows the fix).
fixtures.push({
  id: 'value-line-text-refused',
  title: 'Refusal example: a valueLine named with text instead of label',
  kind: 'torture',
  refuses: { code: 'invalid-annotation', path: 'annotations.0.text' },
  data: {
    categories: ['jan', 'feb', 'mar'].map((id) => ({ id, label: id[0]!.toUpperCase() + id.slice(1) })),
    series: [{ id: 'orders', label: 'Orders', values: [96, 104, 111] }],
  },
  options: {
    title: 'Orders pass the benchmark in February',
    subtitle: { measure: 'Orders', period: 'Q1' },
  },
  // The type refuses text on a valueLine too; the cast keeps the authored mistake.
  annotations: [{ kind: 'valueLine', value: 100, text: 'Benchmark' } as unknown as Annotation],
});

// one demo per render target, physical unit and print preset.
const targetData = {
  categories: ['q1', 'q2', 'q3', 'q4'].map((id) => ({ id, label: id.toUpperCase() })),
  series: [{ id: 'revenue', label: 'Revenue', values: [42, 47, 51, 58] }],
};
const targetOptions = {
  title: 'Revenue grows every quarter', subtitle: { measure: 'Revenue', period: 'FY26' }, unit: '$m',
  source: 'Illustrative quarterly revenue',
};
fixtures.push(
  { id: 'target-dashboard', title: 'The dashboard target: dashboard type on its 480 px default card', kind: 'example',
    data: targetData, options: { ...targetOptions, target: 'dashboard', strings: { close: 'Close' } } },
  { id: 'target-slide-pt', title: 'The slide target on a 660 × 360 pt slot', kind: 'example',
    data: targetData, options: { ...targetOptions, target: 'slide', size: { width: 660, height: 360, unit: 'pt' } } },
  { id: 'target-print-a4-landscape', title: 'The print target on the A4 landscape content preset', kind: 'example',
    data: targetData, options: { ...targetOptions, target: 'print', size: 'a4-landscape-content' } },
  { id: 'target-print-mm', title: 'The print target on a 180 × 100 mm slot', kind: 'example',
    data: targetData, options: { ...targetOptions, target: 'print', size: { width: 180, height: 100, unit: 'mm' } } },
);

// unlabelled ISO day ids across a year change read '22. Dez. 2025' … '1. Jan. 2026' in German.
fixtures.push({
  id: 'iso-days-year-change-de', title: 'German ISO day ids across a year change', kind: 'example',
  data: {
    categories: Array.from({ length: 21 }, (_, i) => ({ id: new Date(Date.UTC(2025, 11, 22 + i)).toISOString().slice(0, 10) })),
    series: [{ id: 'visits', label: 'Visits', values: [12, 14, 13, 9, 5, 6, 11, 13, 12, 8, 4, 7, 12, 14, 15, 13, 12, 9, 8, 14, 16] }],
  },
  options: { title: 'Visits dip over the holidays', unit: 'k', locale: { language: 'de' } },
});

fixtures.push({
  id: 'small-drawer', title: 'A plain column chart in a 480 by 200 drawer', kind: 'example',
  data: {
    categories: [{ id: 'q1', label: 'Q1' }, { id: 'q2', label: 'Q2' }, { id: 'q3', label: 'Q3' }, { id: 'q4', label: 'Q4' }],
    series: [{ id: 'orders', label: 'Orders', values: [42, 47, 51, 58] }],
  },
  options: { title: 'Orders grow every quarter', size: { width: 480, height: 200 } },
});

// othersShade: 'apart' keeps the ramp where a named step may be quieter than the Rest series.
fixtures.push({
  id: 'ordered-ramp-rest-apart', title: "Rest only has to differ from the ordered ramp (othersShade 'apart')", kind: 'example',
  data: {
    categories: ['a', 'b', 'c', 'd'].map((id) => ({ id, label: id.toUpperCase() })),
    series: [
      ...Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, label: `Segment ${i + 1}`, values: [42 - i * 3, 45 - i * 3, 48 - i * 3, 51 - i * 3] })),
      { id: 'rest', label: 'Rest', colorRole: 'others' as const, values: [14, 12, 15, 13] },
    ],
  },
  options: {
    title: 'Five segments on the ordered ramp, Rest apart', variant: 'stacked', seriesRamp: true, othersShade: 'apart',
    theme: { preset: 'standard', overrides: { color: { othersMark: '#65676A' } } },
  },
});

// a note line names its first items and counts the rest; notes.maxListed sets how many.
const sliverSegments = fixtures.find((fixture) => fixture.id === 'sliver-segments')!;
fixtures.push({
  ...sliverSegments,
  id: 'option-notes-max-listed',
  title: 'The note line names its first 3 values and counts the rest (notes.maxListed)',
  kind: 'example',
  tags: ['feature:options'],
  options: { ...sliverSegments.options, notes: { maxListed: 3 } },
});
fixtures.push({
  ...sliverSegments,
  id: 'option-notes-max-listed-all',
  title: 'The note line names every value (notes.maxListed all)',
  kind: 'torture',
  tags: ['feature:options'],
  options: { ...sliverSegments.options, notes: { maxListed: 'all' } },
});

// A band label over a rising tail: the plot gives up headroom above it.
fixtures.push({
  id: 'band-label-headroom-rising-tail',
  title: 'A band label over a rising tail takes headroom above the plot',
  kind: 'torture',
  tags: ['coverage'],
  data: {
    categories: Array.from({ length: 34 }, (_, i) => ({ id: `d${i}`, label: `D${i}` })),
    series: [{ id: 's1', label: 'Sessions', values: Array.from({ length: 34 }, (_, i) => (i < 28 ? 90 + ((i * 11) % 35) : 165 + (i - 28) * 12)) }],
  },
  options: { target: 'report', title: 'Daily sessions after coverage', size: { width: 760, height: 340 } },
  annotations: [{ kind: 'band', from: 'd28', to: 'd33', label: 'After a press article', tone: 'muted' }],
});

// A callout on a short bar leads from the edge of the bar's value, not through it;
// a shaded band names itself centred; a bar too small to see keeps the baseline in ink.
fixtures.push({
  id: 'callout-band-sliver-baseline',
  title: 'A callout leader clears its bar value, a shaded band label centres, a sliver bar keeps the baseline',
  kind: 'torture',
  tags: ['coverage'],
  data: {
    categories: ['Q1 23', 'Q2 23', 'Q3 23', 'Q4 23', 'Q1 24', 'Q2 24', 'Q3 24', 'Q4 24', 'Q1 25', 'Q2 25', 'Q3 25', 'Q4 25'].map((label, i) => ({ id: `q${i + 1}`, label })),
    series: [{ id: 'orders', label: 'Orders', values: [9200, 21500, 33800, 22400, 18100, 30900, 15200, 70, 0, 1100, 0, 0] }],
  },
  options: { title: 'Orders per quarter', unit: 'orders', valueLabels: 'all', source: 'Illustrative data', size: { width: 600 } },
  annotations: [
    { kind: 'band', from: 'q8', to: 'q12', label: 'Pilot stopped', tone: 'muted' },
    { kind: 'callout', at: { categoryId: 'q10', seriesId: 'orders' }, text: 'Small test' },
  ],
});

// valueLabels picks the values a long monthly series prints.
fixtures.push({
  id: 'option-value-labels-extremes',
  title: 'Twenty-four months print first, peak, low and last value (valueLabels extremes)',
  kind: 'example',
  tags: ['feature:options'],
  data: {
    categories: Array.from({ length: 24 }, (_, i) => ({ id: `m${i + 1}`, label: `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i % 12]} ${24 + Math.floor(i / 12)}`, date: `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01` })),
    series: [{ id: 'orders', label: 'Orders', values: [512, 488, 530, 561, 547, 590, 604, 571, 556, 498, 476, 520, 548, 579, 612, 640, 655, 631, 618, 590, 566, 601, 634, 662] }],
  },
  options: { title: 'Orders reached their high in the last month', unit: 'orders', valueLabels: 'extremes', source: 'Illustrative data' },
});

// One small demo per remaining valueLabels choice (fixture-enum-coverage).
const valueLabelsQuarters = {
  categories: ['Q1 24', 'Q2 24', 'Q3 24', 'Q4 24', 'Q1 25', 'Q2 25', 'Q3 25', 'Q4 25'].map((label, i) => ({ id: `q${i + 1}`, label })),
  series: [{ id: 'margin', label: 'Margin', values: [41, 38, 44, 47, 43, 49, 46, 52] }],
};
for (const [mode, title] of [['last', 'Only the latest quarter prints its value'], ['ends', 'The first and latest quarter print their values'], ['none', 'No value prints; the axis reads every column'], ['all', 'Every quarter prints its value']] as const) {
  fixtures.push({
    id: `option-value-labels-${mode}`, title: `${title} (valueLabels ${mode})`, kind: 'example', tags: ['feature:options'],
    data: valueLabelsQuarters,
    options: { title: 'Margin rose to its high in the latest quarter', unit: '%', valueLabels: mode, source: 'Illustrative data' },
  });
}

// Two series over twelve categories on a full slide: the values are wider than
// the default columns, so the groups widen and both series print their values.
fixtures.push({
  id: 'grouped-twelve-slide',
  title: 'Two series over twelve units on a full slide print all 24 values',
  kind: 'torture',
  tags: ['coverage'],
  data: {
    categories: ['North', 'South', 'East', 'West', 'Central', 'Coast', 'Lakes', 'Hills', 'Valley', 'Harbour', 'Plains', 'Forest']
      .map((label) => ({ id: label.toLowerCase(), label })),
    series: [
      { id: 'partners', label: 'Partner channel', values: [750, 750, 750, 750, 750, 1000, 1000, 1000, 750, 750, 750, 750].map((v) => v * 1e6) },
      { id: 'direct', label: 'Direct sales', values: [1250, 1250, 1250, 1500, 1500, 1500, 1500, 1500, 1500, 1250, 1500, 1500].map((v) => v * 1e6) },
    ],
  },
  options: {
    title: 'Direct sales lead in every unit',
    subtitle: { measure: 'Revenue', period: 'FY26' },
    unit: 'EUR',
    variant: 'grouped',
    format: '1.2bn',
    source: 'Illustrative data',
    target: 'slide',
    size: { width: 1184, height: 528 },
  },
});

registerFixtures('column', fixtures);
