/**
 * Combo fixtures — examples: a time-series combination (grey revenue
 * columns + blue units-sold line on an acknowledged, tick-synced secondary
 * axis) and the stacked-columns-plus-margin%-line CFO exhibit. Torture set covers the unacknowledged
 * secondary-axis gate (downgrade + error warning), a line/area-only combo,
 * 12 dense monthly categories, and negative columns with a line crossing
 * the baseline. Every fixture auto-enters the invariant suite.
 */

import { registerFixtures } from '../../../fixtures/registry';
import { EVENT_GROUPS, EVENT_GROUPS_ALL, WEEKLY_EVENTS, WEEKLY_EVENTS_MORE, WEEKLY_REVENUE, WEEKLY_REVENUE_PY, weeklyEventCategories } from '../eventSample';
import type { Fixture } from '../../registry';
import type { ChartData } from '../../types/data';
import type { ComboOptions } from '../../types/options';

/** Shared by the acknowledged example and the unacknowledged torture twin. */
const revenueUnitsData: ChartData = {
  categories: [
    { id: '2019', label: '2019', date: '2019-12-31' },
    { id: '2020', label: '2020', date: '2020-12-31' },
    { id: '2021', label: '2021', date: '2021-12-31' },
    { id: '2022', label: '2022', date: '2022-12-31' },
    { id: '2023', label: '2023', date: '2023-12-31' },
    { id: '2024', label: '2024', date: '2024-12-31' },
  ],
  series: [
    {
      id: 'revenue',
      label: 'Revenue',
      values: [323, 342, 358, 381, 402, 429],
    },
    {
      id: 'units',
      label: 'Units sold',
      kind: 'line',
      axis: 'secondary',
      unit: 'k',
      values: [21.2, 24.8, 27.5, 33.1, 41.7, 48.3],
    },
  ],
};

/** The tick-synced dual axis with both tick columns, which the coverage twins of the example keep. */
const revenueUnitsTickOptions: ComboOptions = {
  interpolate: 'linear',
  secondaryAxis: { acknowledge: true },
  axisTitles: { primary: 'Revenue, $m', secondary: 'Units sold, k' },
  valueAxis: { show: true },
  title: 'Units grow four times as fast as revenue as mix shifts to entry models',
  subtitle: {
    company: 'Vertex Mobility',
    measure: 'Revenue and units sold',
    period: '2019–2024',
  },
  unit: '$m',
  source: 'Illustrative annual figures 2019–2024',
  legend: 'bottom',
};

export const fixtures: Fixture<ChartData, ComboOptions>[] = [
  {
    // The dual-axis anatomy labels every value, so neither tick column is
    // drawn; the axis titles key both series in one row; the growth rates
    // stand beside the line end, or in a note line on a card.
    id: 'revenue-units-secondary',
    title: 'Revenue columns + units-sold line on acknowledged secondary axis, every value labelled',
    kind: 'example',
    tags: ['interaction'],
    hover: { owner: { categoryId: '2019', seriesId: 'revenue' } },
    data: revenueUnitsData,
    options: (({ valueAxis: _ticks, ...rest }) => ({
      ...rest,
      dualAxis: { anatomy: true, growth: true },
    }))(revenueUnitsTickOptions),
  },
  {
    // A refusal example. The margin is declared in %, the columns
    // in $m, and one scale cannot carry both: unit-conflict names the series
    // and the fix (margin-line-own-scale shows it).
    id: 'stacked-margin-line',
    title: 'Refusal example: a margin in % on the axis of revenue in $m',
    kind: 'example',
    // The declared units differ on one axis, so the spec is refused.
    refuses: { code: 'unit-conflict' },
    data: {
      categories: [
        { id: 'q1', label: 'Q1' },
        { id: 'q2', label: 'Q2' },
        { id: 'q3', label: 'Q3' },
        { id: 'q4', label: 'Q4' },
      ],
      series: [
        { id: 'product', label: 'Product', unit: '$m', values: [38, 41, 40, 44] },
        { id: 'services', label: 'Services', unit: '$m', values: [17, 18, 20, 22] },
        {
          id: 'margin',
          label: 'EBITDA margin',
          kind: 'line',
          unit: '%',
          values: [{ pct: 31.5 }, { pct: 33.0 }, { pct: 34.1 }, { pct: 36.2 }],
        },
      ],
    },
    options: {
      title: 'Margin expands five points on the services mix shift',
      subtitle: {
        company: 'Atlas Components',
        measure: 'Revenue and EBITDA margin',
        period: 'FY25 by quarter',
      },
      unit: '$m',
      source: 'Atlas group controlling, FY25 actuals',
      legend: 'bottom',
    },
  },
  {
    // The margin is a share, the column is money, so the
    // line runs on its own scale with no tick column. Its labelled ends and
    // the secondary title name it; under the dual-axis anatomy the scale is
    // chosen so the line runs above the columns.
    id: 'margin-line-own-scale',
    title: 'Revenue columns with the EBITDA margin % line on its own scale, no right ticks',
    kind: 'example',
    data: {
      categories: [
        { id: 'q1', label: 'Q1' },
        { id: 'q2', label: 'Q2' },
        { id: 'q3', label: 'Q3' },
        { id: 'q4', label: 'Q4' },
      ],
      series: [
        { id: 'revenue', label: 'Revenue', values: [55, 59, 60, 66] },
        {
          id: 'margin',
          label: 'EBITDA margin',
          kind: 'line',
          axis: 'secondary',
          values: [{ pct: 31.5 }, { pct: 33.0 }, { pct: 34.1 }, { pct: 36.2 }],
        },
      ],
    },
    options: {
      secondaryAxis: { acknowledge: true, show: false },
      axisTitles: { primary: 'Revenue, $m', secondary: 'EBITDA margin, %' },
      valueAxis: { show: true },
      // Every quarter's margin prints, not only the two ends.
      valueLabels: 'all',
      title: 'Margin expands five points on the services mix shift',
      subtitle: { company: 'Atlas Components', measure: 'Revenue and EBITDA margin', period: 'FY25 by quarter' },
      source: 'Atlas group controlling, FY25 actuals',
      legend: 'bottom',
    },
  },
  {
    // valueLabels 'extremes': the ends plus the line's low and high month.
    id: 'line-labels-extremes',
    title: 'Order columns with a conversion line labelled at its ends, its low and its high',
    kind: 'example',
    data: {
      categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((label) => ({ id: label.toLowerCase(), label })),
      series: [
        { id: 'orders', label: 'Orders', values: [42, 40, 44, 43, 45, 47, 41, 38, 46, 50, 58, 64] },
        {
          id: 'conversion',
          label: 'Conversion',
          kind: 'line',
          axis: 'secondary',
          values: [{ pct: 2.8 }, { pct: 2.7 }, { pct: 2.9 }, { pct: 2.8 }, { pct: 2.6 }, { pct: 2.4 }, { pct: 2.2 }, { pct: 2.1 }, { pct: 2.5 }, { pct: 2.9 }, { pct: 3.4 }, { pct: 3.1 }],
        },
      ],
    },
    options: {
      secondaryAxis: { acknowledge: true, show: false },
      axisTitles: { primary: 'Orders, k', secondary: 'Conversion, %' },
      valueAxis: { show: true },
      valueLabels: 'extremes',
      title: 'Conversion bottoms out in August and peaks in November',
      subtitle: { company: 'Nurthwold Online', measure: 'Orders and conversion rate', period: 'FY25 by month' },
      source: 'Web analytics, FY25',
      legend: 'bottom',
    },
  },
  {
    // valueLabels 'none': the right ticks carry the line, so no point is labelled.
    id: 'line-labels-none',
    title: 'Revenue columns with a units line read off its own tick axis, no point labels',
    kind: 'example',
    data: revenueUnitsData,
    options: {
      secondaryAxis: { acknowledge: true },
      axisTitles: { primary: 'Revenue, $m', secondary: 'Units sold, k' },
      valueAxis: { show: true },
      valueLabels: 'none',
      title: 'Units more than double while revenue grows a third',
      subtitle: { company: 'Vertex Mobility', measure: 'Revenue and units sold', period: '2019–2024' },
      unit: '$m',
      source: 'Illustrative annual figures 2019–2024',
      legend: 'bottom',
    },
  },
  {
    id: 'secondary-unacknowledged',
    title: 'Refusal example: a line on its own scale without an acknowledged secondary axis',
    kind: 'torture',
    refuses: { code: 'dual-axis' },
    data: revenueUnitsData,
    options: {
      // NO secondaryAxis gate: the CLI, MCP, React and the library layout
      // refuse the chart with the error-severity 'dual-axis' lint.
      valueAxis: { show: true },
      title: 'Unacknowledged dual axis is refused',
      subtitle: { measure: 'Revenue and units sold', period: '2019–2024' },
      unit: '$m',
      legend: 'bottom',
    },
  },
  {
    id: 'stacked-shares-sum',
    title: 'Torture: stacked segment shares that add up to 100% in every column',
    kind: 'torture',
    data: {
      categories: [
        { id: 'q1', label: 'Q1' },
        { id: 'q2', label: 'Q2' },
        { id: 'q3', label: 'Q3' },
      ],
      series: [
        // Rounded one by one, Q1 would print 33% + 33% + 33% = 99% and Q3 14% + 29% + 57% = 100%.
        { id: 'online', label: 'Online', kind: 'column', values: [10, 18, 6] },
        { id: 'retail', label: 'Retail', kind: 'column', values: [10, 21, 12] },
        { id: 'partner', label: 'Partner', kind: 'column', values: [10, 15, 24] },
        { id: 'margin', label: 'Margin', kind: 'line', axis: 'secondary', values: [12, 14, 15], format: '1%' },
      ],
    },
    options: {
      secondaryAxis: { acknowledge: true },
      labels: { segment: ['percent'] },
      title: 'Partner grows to over half of Q3 revenue',
      subtitle: { measure: 'Revenue by channel and margin', period: 'FY26' },
      unit: '$m',
      legend: 'bottom',
    },
  },
  {
    id: 'line-only',
    title: 'Torture: combo with no column series (area band + two lines)',
    kind: 'torture',
    data: {
      categories: [
        { id: 'fy20', label: 'FY20' },
        { id: 'fy21', label: 'FY21' },
        { id: 'fy22', label: 'FY22' },
        { id: 'fy23', label: 'FY23' },
        { id: 'fy24', label: 'FY24' },
        { id: 'fy25', label: 'FY25' },
      ],
      series: [
        {
          id: 'backlog',
          label: 'Order backlog',
          kind: 'area',
          colorRole: 'neutralLight',
          // The area names both its ends; the lines print their last value.
          values: [{ number: 12.4, label: '${value}' }, 13.8, 15.1, 16.9, 18.2, 20.4],
        },
        { id: 'orders', label: 'Order intake', kind: 'line', values: [14.2, 16.1, 15.3, 18.8, 20.6, 22.4] },
        {
          // No lineStyle here: 'Shipments' is actual data, and dashed ink on
          // an actual series reads as a forecast claim. The two
          // lines are told apart by color, which is the identity channel.
          id: 'shipments',
          label: 'Shipments',
          kind: 'line',
          values: [13.1, 14.4, 15.8, 17.2, 19.3, 21.0],
        },
      ],
    },
    options: {
      title: 'Book-to-bill is above one in five of six years',
      subtitle: { measure: 'Order intake vs shipments', period: 'FY20–FY25' },
      unit: '$bn',
      legend: 'bottom',
    },
  },
  {
    id: 'dense-12-months',
    title: 'Torture: 12 monthly categories, stacked columns + line, smart density',
    kind: 'torture',
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
        { id: 'retail', label: 'Retail', unit: '$m', values: [42, 39, 45, 44, 47, 51, 49, 46, 52, 55, 61, 74] },
        { id: 'online', label: 'Online', unit: '$m', values: [18, 17, 19, 21, 22, 24, 26, 25, 27, 30, 38, 52] },
        {
          // Visits are not dollars, so the line takes its own titled scale.
          id: 'traffic',
          label: 'Store traffic',
          kind: 'line',
          axis: 'secondary',
          unit: 'k visits',
          marker: 'none',
          values: [88, 84, 90, 89, 93, 97, 95, 91, 99, 104, 118, 141],
        },
      ],
    },
    options: {
      labelDensity: 'smart',
      title: 'December peaks in every channel',
      // The axis titles carry the two units; a chart unit would put "$m"
      // on the traffic as well.
      subtitle: { measure: 'Sales and store traffic', period: 'FY25 by month' },
      secondaryAxis: { acknowledge: true },
      // The sales scale runs to 200 so the traffic line runs over the columns and its values sit on the page.
      valueAxis: { max: 200 },
      axisTitles: { primary: 'Sales, $m', secondary: 'Store traffic, k visits' },
      legend: 'bottom',
    },
  },
  {
    id: 'negative-columns-line',
    title: 'Torture: negative columns with a line dipping below the baseline',
    kind: 'torture',
    data: {
      categories: [
        { id: 'q1', label: 'Q1' },
        { id: 'q2', label: 'Q2' },
        { id: 'q3', label: 'Q3' },
        { id: 'q4', label: 'Q4' },
        { id: 'q5', label: 'Q1 FY27' },
      ],
      series: [
        { id: 'netincome', label: 'Net income', values: [12, -8, 5, -15, 9] },
        {
          id: 'fcf',
          label: 'Free cash flow',
          kind: 'line',
          values: [10, 4, 7, -2, 12],
        },
      ],
    },
    options: {
      title: 'Cash generation holds through two loss-making quarters',
      subtitle: { measure: 'Net income vs free cash flow', period: 'FY26–FY27' },
      unit: '$m',
      legend: 'bottom',
      // Five points, so every line value prints.
      valueLabels: 'all',
    },
  },
  {
    id: 'smooth-forecast-overlay',
    title: 'Monotone combo overlay stays continuous as actuals turn to forecast dashes',
    kind: 'example',
    data: {
      categories: ['fy22', 'fy23', 'fy24', 'fy25', 'fy26', 'fy27'].map((id) => ({
        id,
        label: id.toUpperCase(),
      })),
      series: [
        {
          id: 'installed',
          label: 'Installed base',
          unit: 'k units',
          // The forecast years are hatched on the columns as on the line.
          values: [42, 48, 57, { number: 68, scenario: 'FC' }, { number: 80, scenario: 'FC' }, { number: 91, scenario: 'FC' }],
        },
        {
          id: 'utilization',
          label: 'Utilization',
          kind: 'line',
          // A share of capacity is not units, so it takes its own titled scale.
          axis: 'secondary',
          unit: '%',
          smooth: true,
          format: '45%',
          values: [
            31,
            36,
            44,
            { number: 55, scenario: 'FC' },
            { number: 63, scenario: 'FC' },
            { number: 69, scenario: 'FC' },
          ],
        },
      ],
    },
    options: {
      interpolate: 'monotone',
      title: 'Utilization accelerates as the installed base scales',
      subtitle: { measure: 'Installed base and utilization', period: 'FY22–FY27' },
      secondaryAxis: { acknowledge: true },
      axisTitles: { primary: 'Installed base, k units', secondary: 'Utilization, %' },
      source: 'Illustrative operating plan',
      legend: 'bottom',
    },
  },
  {
    id: 'secondary-axis-direct-labels',
    title: 'Secondary axes identified by full series names and endpoint values',
    kind: 'example',
    data: {
      ...revenueUnitsData,
      series: revenueUnitsData.series.map((series) => ({
        ...series, colorRole: series.id === 'revenue' ? 'highlight' as const : 'neutral' as const,
      })),
    },
    options: {
      secondaryAxis: { acknowledge: true },
      axisTitles: { primary: 'Revenue, $m', secondary: 'Units sold, k' },
      valueAxis: { show: true },
      title: 'Units sold rise faster than revenue',
      subtitle: { measure: 'Revenue and units sold', period: '2019–2024' },
      unit: '$m',
      source: 'Illustrative mobility company data',
      legend: 'auto',
    },
  },
  {
    id: 'zoom-preserves-source-mean', title: 'Zoom retains the full-series mean', kind: 'torture', tags: ['interaction'],
    data: { categories: ['a','b','c','d','e'].map(id => ({ id })), series: [{ id: 's', label: 'Revenue', kind: 'column', values: [20,30,40,50,95] }] },
    options: { title: 'Zoom retains the full-series mean', viewDomain: { x: ['b','d'] }, averageMarker: true },
  },
  {
    // the dual-axis anatomy switched on by the theme, not the chart.
    id: 'theme-dual-axis-anatomy',
    title: 'A theme draws every acknowledged dual axis with its anatomy',
    kind: 'example',
    tags: ['feature:theme'],
    data: revenueUnitsData,
    options: {
      theme: { preset: 'standard', overrides: { valueAxis: { dualAxis: true } } },
      secondaryAxis: { acknowledge: true },
      axisTitles: { primary: 'Revenue, $m', secondary: 'Units sold, k' },
      valueAxis: { show: true, gridlines: true },
      title: 'Units grew four times as fast as revenue',
      subtitle: { company: 'Vertex Mobility', measure: 'Revenue and units sold', period: '2019–2024' },
      source: 'Illustrative annual figures 2019–2024',
      legend: 'none',
    },
  },
  {
    // Both scales from zero on one interval count, the line
    // above the columns, titled axes with swatches, column values inside the
    // column tops, the line's ends on a halo and both growth rates at the
    // right end.
    id: 'revenue-units-dual-axis-anatomy',
    title: 'Dual-axis anatomy: shared gridlines, the line above the columns, both growth rates stated',
    kind: 'example',
    data: revenueUnitsData,
    options: {
      secondaryAxis: { acknowledge: true },
      dualAxis: { anatomy: true, growth: true },
      axisTitles: { primary: 'Revenue, $m', secondary: 'Units sold, k' },
      valueAxis: { show: true, gridlines: true },
      title: 'Units grew four times as fast as revenue',
      subtitle: { company: 'Vertex Mobility', measure: 'Revenue and units sold', period: '2019–2024' },
      source: 'Illustrative annual figures 2019–2024',
      legend: 'none',
    },
  },
  {
    id: 'daily-columns-rate-reference',
    title: 'Daily columns, rate endpoints and a named reference on a flat dashboard',
    kind: 'torture',
    data: {
      categories: Array.from({ length: 26 }, (_, i) => ({ id: `2026-09-${String(i + 1).padStart(2, '0')}`, date: `2026-09-${String(i + 1).padStart(2, '0')}` })),
      series: [
        { id: 'count', label: 'Daily count', values: Array.from({ length: 26 }, (_, i) => 550 + (i * 173) % 1301) },
        { id: 'rate', label: 'Rate', kind: 'line', axis: 'secondary', format: '0.0%', values: Array.from({ length: 26 }, (_, i) => 5.2 + ((i * 7) % 23) / 10) },
      ],
    },
    options: {
      target: 'dashboard', size: { width: 1168, height: 340 },
      title: 'Daily count and rate', valueAxis: { show: true },
      secondaryAxis: { acknowledge: true, domain: [0, 10] },
      valueLabels: 'ends', footnotes: false,
      annotations: [{ id: 'before', kind: 'valueLine', value: 5.5, axis: 'secondary', format: '0.0%', label: 'Before 5.5%' }],
    },
  },
  // A margin whose low is a third of its high cannot run above the columns on
  // a scale from zero: it floats over them on its own scale, its ends, low and
  // high printed in place of the right ticks.
  {
    id: 'dual-axis-line-floated',
    title: 'A margin line floats over the revenue columns on its own scale',
    kind: 'example',
    data: {
      categories: Array.from({ length: 24 }, (_, i) => ({ id: `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
        label: `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i % 12]} ${24 + Math.floor(i / 12)}` })),
      series: [
        { id: 'revenue', label: 'Revenue', values: [11.9, 12.6, 13.0, 14.4, 14.2, 15.3, 15.3, 14.0, 14.8, 15.9, 16.4, 15.6, 15.5, 15.0, 13.9, 12.9, 11.8, 12.5, 12.4, 11.7, 12.9, 14.3, 14.8, 16.1] },
        { id: 'margin', label: 'Margin', kind: 'line', axis: 'secondary', unit: '%', values: [16.9, 11.8, 32.0, 29.9, 25.5, 23.4, 23.4, 10.8, 11.8, 33.6, 33.8, 22.0, 16.8, 30.1, 11.7, 26.2, 30.9, 26.7, 20.1, 30.9, 31.6, 33.0, 15.5, 12.0] },
      ],
    },
    options: {
      title: 'Margin swings while revenue holds',
      subtitle: { company: 'Northwind Outdoor', measure: 'Revenue and margin', period: 'Monthly' },
      unit: 'EUR m',
      secondaryAxis: { acknowledge: true },
      axisTitles: { primary: 'Revenue, EUR m', secondary: 'Margin, %' },
      source: 'Invented example',
    },
  },
];

fixtures.push(
  {
    id: 'option-step-after',
    title: 'Output and available capacity',
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
        { id: 'output', label: 'Output', values: [45, 60, 55, 70] },
        { id: 'capacity', label: 'Capacity', values: [70, 70, 80, 80], kind: 'line' },
      ],
    },
    options: {
      size: { width: 960, height: 520 },
      title: 'Output and available capacity',
      source: 'Illustrative data',
      interpolate: 'step-after',
      legend: 'bottom',
      valueAxis: { show: true },
      secondaryAxis: { ruler: { of: 'primary', total: 100 } },
      axisTitles: { primary: 'Units', secondary: 'Share of 100-unit capacity' },
    },
  },
  {
    id: 'option-step-before',
    title: 'Output and available capacity',
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
        { id: 'output', label: 'Output', values: [45, 60, 55, 70] },
        { id: 'capacity', label: 'Capacity', values: [70, 70, 80, 80], kind: 'line' },
      ],
    },
    options: {
      size: { width: 960, height: 520 },
      title: 'Output and available capacity',
      source: 'Illustrative data',
      interpolate: 'step-before',
      legend: 'bottom',
      valueAxis: { show: true },
    },
  },
  {
    // The cost-per-order line ends just inside the last column's top.
    // Solved one at a time, the total would take the only slot above the
    // column that leaves the line clear and hide the end value. Placed as a
    // pair, the total moves up one row and "2,150" sits beside its point.
    id: 'combo-end-label-collision',
    title: 'Line end value and last column total placed as a pair',
    kind: 'torture',
    data: {
      categories: ['w32', 'w33', 'w34', 'w35', 'w36', 'w37'].map((id) => ({ id, label: id.toUpperCase() })),
      series: [
        { id: 'spend', label: 'Spend', unit: '$k', values: [30, 32, 35, 33, 38, 44] },
        { id: 'cpo', label: 'Cost per order', kind: 'line', axis: 'secondary', unit: '$', values: [1200, 1350, 1500, 1700, 1900, 2150] },
      ],
    },
    options: {
      size: { width: 720, height: 405 },
      title: 'Spend up 47% in six weeks; cost per order up 79%',
      // Each axis names its measure and unit, led by its series' swatch, so the subtitle does not put $k on both.
      subtitle: { measure: 'Spend and cost per order', period: 'W32–W37' },
      axisTitles: { primary: 'Spend, $k', secondary: 'Cost per order, $' },
      secondaryAxis: { acknowledge: true },
      source: 'Illustrative data',
    },
  },
  // The running week's columns are hatched and its line marker is hollow.
  {
    id: 'combo-partial-week',
    title: 'Weekly orders against plan with the running week marked partial',
    kind: 'example',
    data: {
      categories: [
        { id: 'w31', label: 'W31' }, { id: 'w32', label: 'W32' },
        { id: 'w33', label: 'W33' }, { id: 'w34', label: 'W34' },
        { id: 'w35', label: 'W35' }, { id: 'w36', label: 'W36' },
        { id: 'w37', label: 'W37' }, { id: 'w38', label: 'W38', partial: true },
      ],
      series: [
        { id: 'orders', label: 'Orders', values: [648, 639, 660, 678, 690, 694, 712, 316] },
        { id: 'plan', label: 'Plan', kind: 'line', values: [560, 570, 580, 590, 600, 610, 620, 630] },
      ],
    },
    options: {
      title: 'Orders beat plan in every full week',
      unit: 'orders',
      legend: 'bottom',
      source: 'Illustrative data',
    },
  },
);

// Long names at a generous size read whole: the rendered SVG has no ellipsis.
fixtures.push({
  id: 'torture-long-labels',
  title: 'Torture: long names at a generous size read whole, never cut',
  kind: 'torture',
  data: {
    categories: [
      {
        id: '2019',
        label: 'Enterprise cloud infrastructure, managed hosting and sovereign data-centre services for regulated clients',
      },
      {
        id: '2020',
        label: 'Consumer electronics, wearables and connected home devices sold through retail partners',
      },
      {
        id: '2021',
        label: 'Industrial automation, robotics and predictive maintenance contracts in continental Europe',
      },
      {
        id: '2022',
        label: 'Healthcare diagnostics, laboratory information systems and point-of-care testing',
      },
      {
        id: '2023',
        label: 'Wealth management, private banking and family-office advisory for entrepreneurs',
      },
      {
        id: '2024',
        label: 'Retail deposits and everyday current accounts for households and sole traders',
      },
    ],
    series: [
      { id: 'revenue', label: 'Revenue', values: [323, 342, 358, 381, 402, 429] },
      {
        id: 'units',
        label: 'Units sold',
        kind: 'line',
        axis: 'secondary',
        unit: 'k units',
        values: [21.2, 24.8, 27.5, 33.1, 41.7, 48.3],
      },
    ],
  },
  options: {
    interpolate: 'linear',
    secondaryAxis: { acknowledge: true },
    axisTitles: { primary: 'Revenue, $m', secondary: 'Units sold, k units' },
    valueAxis: { show: true },
    title: 'Long names read whole at a generous size',
    subtitle: { company: 'Vertex Mobility', measure: 'Revenue and units sold', period: '2019–2024' },
    unit: '$m',
    source: 'Illustrative annual figures 2019–2024',
    legend: 'bottom',
    size: { width: 1440, height: 900 },
  },
});

// a theme's combo look. The single column series in a tint of the
// focus, the lead line in the ink at 1.5 px with the latest-point ring.
fixtures.push({
  id: 'option-ink-lead-line',
  title: 'Columns in a tint of the focus, the lead line in the ink with a ring on its last point',
  kind: 'example',
  tags: ['feature:options'],
  data: revenueUnitsData,
  options: {
    interpolate: 'linear',
    secondaryAxis: { acknowledge: true },
    axisTitles: { primary: 'Revenue, $m', secondary: 'Units sold, k units' },
    valueAxis: { show: true },
    theme: {
      preset: 'boardroom',
      overrides: { color: { focus: '#0D2A43' }, marks: { comboColumnTint: 0.74, comboLine: 'ink', lineMarkers: 'none' } },
    },
    title: 'Units grow four times as fast as revenue',
    subtitle: { company: 'Vertex Mobility', measure: 'Revenue and units sold', period: '2019–2024' },
    unit: '$m',
    source: 'Illustrative annual figures 2019–2024',
    legend: 'bottom',
  },
});

// the same look on stacked columns. The stack takes a ramp of the
// focus, lightest on top, so the ink margin line reads over it.
const stackedMargin = fixtures.find((fixture) => fixture.id === 'stacked-margin-line')!;
fixtures.push({
  ...stackedMargin,
  id: 'option-stacked-tint-ramp',
  title: 'Refusal example: the tinted stack and ink margin line with unlike units on one axis',
  tags: ['feature:options'],
  options: {
    ...stackedMargin.options,
    theme: {
      preset: 'boardroom',
      overrides: { color: { focus: '#0D2A43' }, marks: { comboColumnTint: 0.74, comboLine: 'ink', lineMarkers: 'none' } },
    },
  },
});

// The event lane over revenue columns and the prior-year line.
const weeklyCombo: ChartData = {
  categories: weeklyEventCategories(true),
  series: [
    { id: 'rev', label: 'Revenue', values: WEEKLY_REVENUE },
    { id: 'py', label: 'Prior year', kind: 'line', scenario: 'PY', values: WEEKLY_REVENUE_PY },
  ],
};
const weeklyComboOptions: ComboOptions = {
  title: 'Revenue falls below prior year during the stock-outs and passes it after the launches',
  subtitle: { measure: 'Online revenue', period: 'W27–W39 2026, AC PY' },
  unit: '$k',
  format: '1.0',
  legend: 'bottom',
  source: 'Shop orders; inventory log',
  size: { width: 960, height: 540 },
};
fixtures.push({
  id: 'weekly-events-lane',
  title: 'Event lane over columns and a prior-year line: stock-outs and launches, the rest numbered in the key',
  kind: 'example',
  data: weeklyCombo,
  annotations: WEEKLY_EVENTS,
  options: { ...weeklyComboOptions, events: { placement: 'auto', groups: EVENT_GROUPS } },
});
fixtures.push({
  id: 'events-key-only',
  title: 'Event key only over columns and a prior-year line: numbered markers in time order',
  kind: 'example',
  data: weeklyCombo,
  annotations: [...WEEKLY_EVENTS, ...WEEKLY_EVENTS_MORE],
  // The a4 step (960 x 679): with the key of all nine events a 16:9 slide leaves the plot
  // under its 160 px floor, a fourth warning on a demo fixture.
  options: { ...weeklyComboOptions, size: { width: 960, height: 679 }, events: { placement: 'key', groups: EVENT_GROUPS_ALL } },
});

// latestPoint 'ring': the newest quarter of the lead line, as on the line
// chart; valueLabels 'last' prints its value beside the ring and no other.
fixtures.push({
  id: 'option-latest-point-ring',
  title: 'Revenue columns with the rolling average, its latest quarter ringed',
  kind: 'example',
  tags: ['feature:options'],
  data: {
    categories: [
      { id: 'q1-25', label: 'Q1 25' },
      { id: 'q2-25', label: 'Q2 25' },
      { id: 'q3-25', label: 'Q3 25' },
      { id: 'q4-25', label: 'Q4 25' },
      { id: 'q1-26', label: 'Q1 26' },
      { id: 'q2-26', label: 'Q2 26' },
    ],
    series: [
      { id: 'revenue', label: 'Revenue', values: [52, 58, 55, 63, 61, 67] },
      { id: 'rolling', label: 'Rolling 4-quarter average', kind: 'line', values: [54.1, 55.0, 55.8, 57.0, 59.3, 61.5] },
    ],
  },
  options: {
    latestPoint: 'ring',
    valueLabels: 'last',
    title: 'Revenue lifts the rolling average for a sixth quarter',
    subtitle: { measure: 'Revenue and rolling four-quarter average', period: 'Q1 2025 to Q2 2026' },
    unit: '$m',
    source: 'Illustrative data',
    legend: 'bottom',
  },
});

// referenceStyle and referenceTick, as on bar and column: the same plan drawn
// as a dashed line, as markers, and as 2 px ticks in the highlight.
const planComboData: ChartData = {
  categories: [
    { id: 'q1', label: 'Q1' },
    { id: 'q2', label: 'Q2' },
    { id: 'q3', label: 'Q3' },
    { id: 'q4', label: 'Q4' },
  ],
  series: [
    { id: 'revenue', label: 'Revenue', values: [48, 55, 51, 62] },
    { id: 'plan', label: 'Plan', role: 'reference', scenario: 'PL', values: [50, 52, 54, 58] },
    { id: 'rolling', label: 'Rolling 4-quarter average', kind: 'line', values: [47.2, 49.0, 50.3, 54.0] },
  ],
};
const planComboOptions: ComboOptions = {
  title: 'Revenue beats plan in Q2 and Q4 and misses it in Q1 and Q3',
  subtitle: { measure: 'Revenue against plan', period: 'FY26 by quarter', scenarios: ['AC', 'PL'] },
  unit: '$m',
  source: 'Illustrative data',
  legend: 'bottom',
};
fixtures.push(
  {
    id: 'option-reference-line',
    title: 'Revenue columns with the plan as dashed lines and a rolling average',
    kind: 'example',
    tags: ['feature:options'],
    data: planComboData,
    options: { ...planComboOptions, referenceStyle: 'line' },
  },
  {
    id: 'option-reference-marker',
    title: 'Revenue columns with the plan as markers and a rolling average',
    kind: 'example',
    tags: ['feature:options'],
    data: planComboData,
    options: { ...planComboOptions, referenceStyle: 'marker' },
  },
  {
    id: 'option-reference-tick-highlight',
    title: 'Revenue columns with 2 px plan ticks in the highlight and a rolling average',
    kind: 'example',
    tags: ['feature:options'],
    data: planComboData,
    options: { ...planComboOptions, referenceStyle: 'tick', referenceTick: { width: 2, color: 'highlight' } },
  },
);

// The average marker and the band annotation, as on column.
const monthlyComboData: ChartData = {
  categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((label) => ({ id: label.toLowerCase(), label })),
  series: [
    { id: 'revenue', label: 'Revenue', values: [41, 43, 46, 44, 48, 55, 58, 57, 49, 47, 50, 53] },
    { id: 'rolling', label: 'Rolling 3-month average', kind: 'line', values: [null, null, 43, 44, 46, 49, 54, 57, 55, 51, 49, 50] },
  ],
};
const monthlyComboOptions: ComboOptions = {
  subtitle: { measure: 'Revenue', period: 'FY26 by month' },
  unit: '$m',
  source: 'Illustrative data',
  legend: 'bottom',
  valueLabels: 'none',
};
fixtures.push(
  {
    id: 'option-average-marker',
    title: 'Monthly revenue columns with the average of the columns as a dashed Ø rule',
    kind: 'example',
    tags: ['feature:options'],
    data: monthlyComboData,
    options: { ...monthlyComboOptions, title: 'Five months run above the FY average, three of them in summer', averageMarker: true },
  },
  {
    id: 'option-band-shade',
    title: 'Monthly revenue columns with the months of a price test shaded',
    kind: 'example',
    tags: ['feature:options'],
    data: monthlyComboData,
    options: { ...monthlyComboOptions, title: 'Revenue peaks during the summer price test' },
    annotations: [{ kind: 'band', id: 'price-test', from: 'jun', to: 'aug', label: 'Price test' }],
  },
);

// The line's window on combo; the rolling mean keeps every source week.
fixtures.push({
  id: 'option-window-last-8',
  title: 'Sixteen weeks of revenue and conversion, the last eight drawn (window.last)',
  kind: 'example',
  tags: ['feature:options'],
  data: {
    categories: Array.from({ length: 16 }, (_, week) => ({ id: `w${week + 27}`, label: `W${week + 27}` })),
    series: [
      { id: 'revenue', label: 'Revenue', values: [118, 121, 119, 124, 127, 125, 129, 131, 128, 133, 136, 134, 139, 142, 140, 146] },
      { id: 'conversion', label: 'Conversion', kind: 'line', axis: 'secondary', values: [{ pct: 2.4 }, { pct: 2.5 }, { pct: 2.4 }, { pct: 2.6 }, { pct: 2.7 }, { pct: 2.6 }, { pct: 2.8 }, { pct: 2.8 }, { pct: 2.7 }, { pct: 2.9 }, { pct: 3.0 }, { pct: 2.9 }, { pct: 3.1 }, { pct: 3.2 }, { pct: 3.1 }, { pct: 3.3 }] },
    ],
  },
  options: {
    window: { last: 8 },
    // The average keeps all 16 weeks, and its label says so.
    averageMarker: true,
    // The right axis has a title, so it shows its ticks; eight points print every value.
    secondaryAxis: { acknowledge: true },
    valueLabels: 'all',
    axisTitles: { primary: 'Revenue, $k', secondary: 'Conversion, %' },
    valueAxis: { show: true },
    title: 'Revenue and conversion climb together over the last eight weeks',
    subtitle: { measure: 'Revenue and conversion', period: 'by week' },
    source: 'Illustrative web shop data',
    legend: 'bottom',
  },
});

// Column's anomaly rule on the combo's line, on the line's own axis.
fixtures.push({
  id: 'option-anomaly-line',
  title: 'Revenue columns with the average order value judged by column\'s anomaly rule',
  kind: 'example',
  tags: ['feature:options'],
  data: {
    categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((label) => ({ id: label.toLowerCase(), label })),
    series: [
      { id: 'revenue', label: 'Revenue', values: [410, 420, 415, 430, 440, 520, 445, 450, 390, 455, 470, 480] },
      // Median 58.95, MAD 0.5, so the corridor at k = 3.5 runs 56.36 to 61.54.
      { id: 'aov', label: 'Average order value', kind: 'line', axis: 'secondary', values: [58.2, 58.9, 58.4, 59.1, 58.7, 66.8, 59.0, 58.8, 51.3, 59.4, 59.8, 59.5] },
    ],
  },
  options: {
    anomaly: { method: 'mad', baseline: 'median' },
    secondaryAxis: { acknowledge: true },
    dualAxis: { anatomy: true },
    axisTitles: { primary: 'Revenue, $k', secondary: 'Average order value, $' },
    valueAxis: { show: true },
    valueLabels: 'none',
    title: 'The average order leaves its normal range in June and September',
    subtitle: { measure: 'Revenue and average order value', period: 'FY26 by month' },
    source: 'Illustrative web shop data',
    size: { width: 960, height: 540 },
  },
});

// A pinned and formatted secondary axis, a four-step ruler, authored anomaly bounds, a stricter k, and events
// as numbered markers under a key title.
const revenueUnits = fixtures.find((fixture) => fixture.id === 'revenue-units-secondary')!;
const stepAfter = fixtures.find((fixture) => fixture.id === 'option-step-after')!;
const anomalyLine = fixtures.find((fixture) => fixture.id === 'option-anomaly-line')!;
const comboEvents = fixtures.find((fixture) => fixture.id === 'weekly-events-lane')!;
fixtures.push(
  {
    ...revenueUnits,
    id: 'secondary-domain-format',
    title: 'A secondary axis pinned to 0 to 60 with one-decimal ticks',
    tags: ['coverage'],
    options: { ...revenueUnitsTickOptions, secondaryAxis: { acknowledge: true, domain: [0, 60], format: '1.0' } },
  },
  {
    ...stepAfter,
    id: 'capacity-ruler-quarters',
    title: 'A percentage ruler in four steps of 25',
    tags: ['coverage'],
    options: { ...stepAfter.options, secondaryAxis: { ruler: { of: 'primary', total: 100, ticks: 4 } } },
  },
  {
    ...anomalyLine,
    id: 'order-value-threshold-corridor',
    title: 'Authored anomaly bounds with a named rule instead of the MAD corridor',
    tags: ['coverage'],
    options: { ...anomalyLine.options, anomaly: { method: 'threshold', low: 52, high: 64, label: 'Pricing guardrail' } },
  },
  {
    ...anomalyLine,
    id: 'order-value-strict-k',
    title: 'The MAD rule with a stricter k of 5',
    tags: ['coverage'],
    options: { ...anomalyLine.options, anomaly: { method: 'mad', baseline: 'median', k: 5 } },
  },
  {
    ...comboEvents,
    id: 'revenue-events-key-title',
    title: 'Events as numbered markers only, keyed under an authored heading',
    tags: ['coverage'],
    options: {
      ...comboEvents.options,
      events: { ...comboEvents.options!.events!, rows: 0, keyTitle: 'Stock and launch events' },
      size: { width: 960, height: 681 },
    },
  },
);

// Labels in their object form, the last line value alone.
fixtures.push({
  ...revenueUnits,
  id: 'line-ends-named',
  title: 'The line end label set through the labels object',
  tags: ['coverage'],
  options: { ...revenueUnitsTickOptions, valueLabels: 'last', labels: { point: ['absolute'] } },
});

// an area and every line stroke and point symbol. No columns: an area
// over a column would hide it.
fixtures.push({
  id: 'stroke-marker-sampler',
  title: 'A capacity area under a solid actual, a dashed forecast, a dotted plan and a plain shipments line, each with its own marker',
  kind: 'torture',
  tags: ['demo', 'coverage'],
  data: {
    categories: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'].map((id, index) => ({ id, label: `Q${(index % 4) + 1} ${index < 4 ? 'FY25' : 'FY26'}` })),
    series: [
      { id: 'capacity', label: 'Capacity', kind: 'area', colorRole: 'neutralLight', marker: 'diamond', values: [30, 30, 30, 36, 36, 36] },
      { id: 'orders', label: 'Orders', kind: 'line', lineStyle: 'solid', marker: 'circle', values: [24, 26, 29, 31, null, null] },
      { id: 'orders-fc', label: 'Orders forecast', kind: 'line', scenario: 'FC', lineStyle: 'dashed', marker: 'square', values: [null, null, null, 31, 33, 34] },
      { id: 'plan', label: 'Order plan', kind: 'line', scenario: 'PL', lineStyle: 'dotted', marker: 'triangle', values: [25, 27, 29, 32, 34, 36] },
      { id: 'shipped', label: 'Shipped', kind: 'line', marker: 'none', values: [18, 20, 21, 23, 24, 26] },
    ],
  },
  options: {
    title: 'Orders stay inside capacity once the Q4 expansion lands',
    subtitle: { measure: 'Orders, shipments and capacity', period: 'Q1 FY25–Q2 FY26', scenarios: ['AC', 'FC', 'PL'] },
    unit: 'k',
    format: '1',
    legend: 'top',
    // The actual line ends where the forecast starts, so the values print on the axis.
    valueLabels: 'none',
    valueAxis: { show: true, gridlines: true },
    source: 'Synthetic order book',
  },
});

fixtures.push({
  "id": "single-populated-stack",
  "title": "One populated stack part prints once",
  "kind": "torture",
  "data": {
    "categories": [
      { id: "Batch", label: "Batch" }
    ],
    "series": [
      {
        "id": "s",
        "label": "Widgets",
        "kind": "column",
        "values": [
          17
        ]
      },
      {
        "id": "empty",
        "label": "Spares",
        "kind": "column",
        "values": [
          null
        ]
      }
    ]
  },
  "options": {
    "title": "Only widgets contribute to the batch",
    "legend": "top"
  }
});

fixtures.push({
  "id": "default-series-key",
  "title": "Three series and a line retain their names",
  "kind": "torture",
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
        ]
      },
      {
        "id": "third",
        "label": "Third",
        "values": [
          9,
          12
        ]
      },
      {
        "id": "trend",
        "label": "Trend",
        "kind": "line",
        "values": [
          12,
          18
        ]
      }
    ]
  },
  "options": {
    "title": "Three series and a line retain their names",
    "source": "Invented example"
  }
});

fixtures.push({
  id: 'counts-fraction-rate',
  title: 'Count columns and a fraction rate on its own axis',
  kind: 'example',
  data: {
    categories: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
    series: [
      { id: 'orders', label: 'Orders', values: [120, 150, 180], unit: 'orders' },
      { id: 'rate', label: 'Conversion rate', kind: 'line', axis: 'secondary', unit: '%', format: '0.0%', valueKind: 'fraction', values: [0.153, 0.17, 0.187] },
    ],
  },
  options: { title: 'Orders and conversion rate rise', secondaryAxis: { acknowledge: true }, valueAxis: { show: true } },
});

// A band label over a rising tail: the plot gives up headroom above it.
fixtures.push({
  id: 'band-label-headroom-rising-tail',
  title: 'A band label over a rising tail takes headroom above the plot',
  kind: 'torture',
  tags: ['coverage'],
  data: {
    categories: Array.from({ length: 34 }, (_, i) => ({ id: `d${i}`, label: `D${i}` })),
    series: [
      { id: 's1', label: 'Sessions', kind: 'column', values: Array.from({ length: 34 }, (_, i) => (i < 28 ? 90 + ((i * 11) % 35) : 165 + (i - 28) * 12)) },
      { id: 's2', label: 'Conversion index', kind: 'line', axis: 'secondary', values: Array.from({ length: 34 }, (_, i) => (i < 28 ? 40 + ((i * 7) % 20) : 85 + (i - 28) * 6)) },
    ],
  },
  options: { target: 'report', title: 'Daily sessions and conversion index', secondaryAxis: { acknowledge: true }, size: { width: 760, height: 340 } },
  annotations: [{ kind: 'band', from: 'd28', to: 'd33', label: 'After a press article', tone: 'muted' }],
});

// notes.show with 'disclosure' prints the engine's notes: names that fit neither
// flat nor at 45° read as ranks, and the rank key prints under the chart.
fixtures.push({
  id: 'ranked-campaigns-key-shown',
  title: 'Campaign names too long for their columns read as ranks with the key printed (notes.show)',
  kind: 'torture',
  data: {
    categories: Array.from({ length: 16 }, (_, i) => ({ id: `c${i}`, label: `${['Paid social', 'Paid search', 'Display', 'Affiliate'][i % 4]} campaign ${['North', 'South', 'East', 'West'][Math.floor(i / 4)]}` })),
    series: [
      { id: 'spend', label: 'Spend', kind: 'column', values: Array.from({ length: 16 }, (_, i) => 40 + ((i * 17) % 60)) },
      { id: 'roas', label: 'ROAS', kind: 'line', axis: 'secondary', values: Array.from({ length: 16 }, (_, i) => 1.5 + ((i * 7) % 20) / 10) },
    ],
  },
  options: { title: 'Spend and ROAS by campaign', secondaryAxis: { acknowledge: true }, size: { width: 480 }, notes: { show: ['note', 'disclosure'] }, source: 'Invented example' },
});

// notes.show 'ranks' prints the rank key alone: the same campaigns read as
// ranks with their key, and "Not labelled on the chart" stays in the notes list.
fixtures.push({
  id: 'ranked-campaigns-rank-key-only',
  title: 'Campaign names too long for their columns read as ranks; only the rank key prints (notes.show ranks)',
  kind: 'torture',
  data: {
    categories: Array.from({ length: 16 }, (_, i) => ({ id: `c${i}`, label: `${['Paid social', 'Paid search', 'Display', 'Affiliate'][i % 4]} campaign ${['North', 'South', 'East', 'West'][Math.floor(i / 4)]}` })),
    series: [
      { id: 'spend', label: 'Spend', kind: 'column', values: Array.from({ length: 16 }, (_, i) => 40 + ((i * 17) % 60)) },
      { id: 'roas', label: 'ROAS', kind: 'line', axis: 'secondary', values: Array.from({ length: 16 }, (_, i) => 1.5 + ((i * 7) % 20) / 10) },
    ],
  },
  options: { title: 'Spend and ROAS by campaign', secondaryAxis: { acknowledge: true }, size: { width: 480 }, notes: { show: ['note', 'ranks'] }, source: 'Invented example' },
});

// An area behind columns: the columns, the corridor and the launch period all
// read through the capacity fill, and the area's values on its fill take its ink.
fixtures.push({
  id: 'area-capacity-behind-columns',
  title: 'Order columns in front of a capacity area, with a plan corridor and a launch period',
  kind: 'example',
  tags: ['annotation'],
  data: {
    categories: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'].map((id, index) => ({ id, label: `Q${(index % 4) + 1} ${index < 4 ? 'FY25' : 'FY26'}` })),
    series: [
      { id: 'orders', label: 'Orders', values: [22, 25, 24, 28, 30, 33] },
      { id: 'capacity', label: 'Capacity', kind: 'area', values: [30, 30, 32, 36, 36, 38] },
    ],
  },
  options: {
    title: 'Orders stay inside capacity after the Q4 line launch',
    subtitle: { measure: 'Orders and capacity', period: 'Q1 FY25–Q2 FY26' },
    unit: 'k',
    legend: 'bottom',
    source: 'Illustrative order book of a fictional furniture maker',
  },
  annotations: [
    { kind: 'band', id: 'plan', style: 'corridor', low: 20, high: 27, label: 'Plan corridor' },
    { kind: 'band', id: 'launch', from: 'q4', to: 'q5', label: 'Launch' },
  ],
});

registerFixtures('combo', fixtures);
