/**
 * KPI card fixtures: dashboard examples (invented data, with sources) +
 * torture set (value-only, vs=0 guard, wide value, spark nulls, mode both).
 * Every fixture auto-enters the invariant suite.
 */

import { registerFixtures } from '../../../fixtures/registry';
import type { Fixture } from '../../registry';
import type { KpiData } from '../../types/data';
import type { KpiOptions } from '../../types/options';

export const fixtures: Fixture<KpiData, KpiOptions>[] = [
  {
    id: 'arr-card',
    title: 'ARR card with PY delta and area spark',
    kind: 'example',
    tags: ['interaction'],
    hover: { owner: { categoryId: 'kpi' } },
    data: {
      label: 'ARR',
      value: 182_400_000,
      format: '$1.2M',
      delta: { vs: 165_200_000, scenario: 'PY' },
      spark: {
        kind: 'area',
        values: [121_400_000, 130_200_000, 138_900_000, 150_700_000, 165_200_000, 182_400_000],
        labels: ['Jan FY26', 'Feb FY26', 'Mar FY26', 'Apr FY26', 'May FY26', 'Jun FY26'],
      },
    },
    options: {
      source: 'Acme SaaS finance actuals, Jun FY26',
    },
  },
  {
    id: 'churn-card',
    title: 'Net churn card: lowerIsBetter, negative delta reads good',
    kind: 'example',
    data: {
      label: 'Net revenue churn',
      value: 3.2,
      format: '1.2%',
      delta: { vs: 4.1, scenario: 'PY', direction: 'lowerIsBetter', mode: 'absolute' },
      spark: { kind: 'line', values: [5.8, 5.1, 4.9, 4.4, 4.1, 3.8, 3.5, 3.2] },
    },
    options: {
      title: 'Churn fell to 3.2% in FY25, down 0.9 points vs PY',
      source: 'Acme SaaS retention cohort model',
    },
  },
  {
    id: 'dual-compare',
    title: 'Landing forecast with YoY, plan, and attainment steering chips',
    kind: 'example',
    data: {
      label: 'FY26 landing forecast',
      value: 10_600_000,
      format: '$1.1M',
      compare: [
        { vs: 11_650_000, label: 'YoY', mode: 'both' },
        { vs: 11_910_000, label: 'vs Plan', mode: 'both' },
      ],
      attainment: { vs: 11_910_000, label: 'of Plan' },
    },
    options: {
      // No height: the card takes its content height at every width.
      size: { width: 380 },
      title: 'Landing remains below prior year and plan',
      source: 'Illustrative commercial forecast, Jul close',
    },
  },
  {
    id: 'chip-comparisons',
    title: "comparisons: 'chip' keeps the tinted chips on a standalone card",
    kind: 'example',
    data: {
      label: 'FY26 landing forecast',
      value: 10_600_000,
      format: '$1.1M',
      compare: [
        { vs: 11_650_000, label: 'YoY', mode: 'both' },
        { vs: 11_910_000, label: 'vs Plan', mode: 'both' },
      ],
      attainment: { vs: 11_910_000, label: 'of Plan' },
    },
    options: {
      comparisons: 'chip',
      title: 'Landing remains below prior year and plan',
      source: 'Illustrative commercial forecast, Jul close',
    },
  },
  {
    id: 'dual-compare-ref-nonpositive',
    title: 'Torture: two nonpositive references show the absolute change in points',
    kind: 'torture',
    data: {
      label: 'New-market contribution',
      value: 12.4,
      format: '1.1%',
      compare: [
        { vs: 0, label: 'YoY' },
        { vs: -3.2, label: 'vs Plan' },
      ],
    },
    options: { title: 'New markets add 12.4 points, 15.6 above plan' },
  },
  {
    id: 'value-only',
    title: 'Torture: no delta, no spark — value-only card with action title',
    kind: 'torture',
    data: {
      label: 'Headcount',
      value: 1284,
    },
    options: { title: 'Hiring back on plan' },
  },
  {
    id: 'unit-beside-value',
    title: 'options.unit with no subtitle prints beside the value',
    kind: 'torture',
    data: {
      label: 'Monthly support cost',
      value: 12_840,
      delta: { vs: 14_100, scenario: 'PY', direction: 'lowerIsBetter' },
    },
    options: { unit: '$' },
  },
  {
    id: 'vs-zero-guard',
    title: 'Torture: vs=0 suppresses relative delta with ref-nonpositive',
    kind: 'torture',
    data: {
      label: 'Net new logos',
      value: 24,
      delta: { vs: 0, scenario: 'PY' },
    },
  },
  {
    id: 'wide-value-long-label',
    title: 'Torture: long label + $12,345,678,901 value forces font shrink',
    kind: 'torture',
    data: {
      label: 'Cumulative gross merchandise volume since program inception (all regions, constant FX)',
      value: 12_345_678_901,
      format: '$1,234,567,890',
      delta: { vs: 9_876_543_210, mode: 'both' },
    },
    options: { source: 'Data warehouse, GMV mart' },
  },
  {
    id: 'spark-nulls',
    title: 'Torture: sparkline with null gaps breaks the line',
    kind: 'torture',
    data: {
      label: 'Weekly active users',
      value: 48_200,
      delta: { vs: 44_100 },
      spark: { kind: 'line', values: [41_000, null, 43_500, 44_800, null, 46_900, 48_200], labels: ['W27', 'W28', 'W29', 'W30', 'W31', 'W32', 'W33'] },
    },
  },
  {
    id: 'spark-column',
    title: 'Torture: column sparkline with a gap and last-value label',
    kind: 'torture',
    data: {
      label: 'Weekly orders',
      value: 25,
      format: '1',
      spark: { kind: 'column', values: [12, 18, null, 22, 19, 25] },
    },
  },
  {
    id: 'mode-both',
    title: "Torture: delta mode 'both' — percent and absolute in one pill",
    kind: 'torture',
    data: {
      // currency, scale and period on the card.
      label: 'EBITDA, FY26 year to date',
      value: 46_800_000,
      format: '$1.1M',
      delta: { vs: 39_900_000, scenario: 'PL', mode: 'both' },
    },
  },
  {
    id: 'content-width-comparisons',
    title: 'KPI card stays within 420px in a wide host with comparisons and a spark',
    kind: 'example',
    data: {
      label: 'FY26 landing forecast',
      value: 10_600_000,
      format: '$1.1M',
      compare: [
        { vs: 11_650_000, label: 'YoY', mode: 'relative' },
        { vs: 11_910_000, label: 'vs Plan', mode: 'relative' },
      ],
      attainment: { vs: 11_910_000, label: 'of Plan' },
      spark: { kind: 'line', values: [9_200_000, 9_600_000, 10_100_000, 10_400_000, 10_200_000, 10_600_000] },
    },
    options: {
      size: { width: 800, height: 230 },
      source: 'Illustrative commercial forecast',
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
    label: 'FY26 landing forecast for the enterprise cloud business',
    value: 10600000,
    format: '$1.1M',
    compare: [
      { vs: 11650000, label: 'vs prior-year actuals', mode: 'both' },
      { vs: 11910000, label: 'vs approved operating plan', mode: 'both' },
    ],
    attainment: { vs: 11910000, label: 'of approved operating plan' },
  },
  options: {
    size: { width: 420, height: 273 },
    title: 'Landing remains below prior year and plan',
    source: 'Illustrative commercial forecast, Jul close',
  },
});

/**
 * Two card features in one: an authored note
 * under the value, which names the basis the number is true of, and the
 * compact card, 280 wide instead of 320, here pinned at 280 x 160. Everything
 * the regular card holds is still here — the value, the note, one row of
 * compare chips and the spark under them.
 */
fixtures.push({
  id: 'note-and-compact',
  title: 'Compact card pinned at 280 x 124, with the basis written under the value',
  kind: 'example',
  data: {
    label: 'Blended CAC',
    value: 86.4,
    format: '$1.1',
    note: 'Paid channels only · all regions',
    compare: [{ vs: 79.2, label: 'YoY', mode: 'relative', direction: 'lowerIsBetter' }],
    spark: { kind: 'line', values: [74.1, 76.8, 79.2, 82.6, 84.9, 86.4] },
  },
  options: {
    density: 'compact',
    // 160 holds the note, the chip and the spark under a 14 px figure.
    size: { width: 280, height: 160 },
  },
});

/**
 * The editorial card: comparisons as toned text instead of tinted
 * chips, and the figure in a face of its own. The card option names the
 * comparison style; the theme names the figure through `type.figure`.
 */
fixtures.push(
  {
    id: 'text-comparisons',
    title: 'Two comparisons as toned text with carets, one worse and one better, no chips',
    kind: 'torture',
    data: {
      label: 'Blended CAC',
      value: 86.4,
      format: '$1.1',
      compare: [
        { vs: 79.2, label: 'YoY', mode: 'relative', direction: 'lowerIsBetter' },
        { vs: 90, label: 'vs Plan', mode: 'relative', direction: 'lowerIsBetter' },
      ],
      spark: { kind: 'line', values: [74.1, 76.8, 79.2, 82.6, 84.9, 86.4] },
    },
    options: {
      size: { width: 360, height: 256 },
      title: 'CAC is 9% above last year and 4% under plan',
      comparisons: 'text',
      source: 'Illustrative data',
    },
  },
  {
    id: 'editorial-figure',
    title: 'Editorial card: a light serif figure from type.figure over text comparisons and a text attainment',
    kind: 'example',
    data: {
      label: 'Net revenue',
      value: 4_820_000,
      format: '$1.1M',
      compare: [
        { vs: 4_310_000, label: 'YoY' },
        { vs: 5_000_000, label: 'vs Plan' },
      ],
      attainment: { vs: 5_000_000, label: 'of Plan', tone: 'warn' },
    },
    options: {
      size: { width: 360, height: 237 },
      title: 'Net revenue is 12% up on the year and 4% short of plan',
      comparisons: 'text',
      theme: { preset: 'boardroom', overrides: { type: { figure: { family: "Georgia, 'Times New Roman', serif", weight: 300 } } } },
      source: 'Illustrative data',
    },
  },
);

/**
 * The spark line in the ink. A theme whose neutral is a pale sand,
 * as a board's bands and prior-year marks want it, draws a neutral spark
 * line a reader can barely see; `color.spark` points the line at the ink,
 * and the last point keeps the accent.
 */
fixtures.push({
  id: 'spark-ink-pale-neutral',
  title: 'A line spark in the ink on a theme whose neutral is a pale sand',
  kind: 'example',
  tags: ['feature:options'],
  data: {
    label: 'Active subscribers',
    value: 48_200,
    format: '1.2k',
    compare: [{ vs: 44_900, label: 'YoY', mode: 'relative' }],
    spark: { kind: 'line', values: [41_000, 42_300, 43_500, 44_800, 45_900, 46_900, 48_200] },
  },
  options: {
    theme: { preset: 'boardroom', overrides: { color: { neutral: '#E6DFD3', spark: '#0D2A43' } } },
    title: 'Active subscribers are 7% up on the year',
    source: 'Illustrative data',
  },
});

/**
 * A theme that never fills a spark: the data asks for an area spark,
 * and `surface.sparkWash: false` draws it as its line and last point alone.
 */
fixtures.push({
  id: 'spark-area-as-line',
  title: 'An area spark drawn as a shape-only line ending in a ring, no wash and no end label',
  kind: 'example',
  tags: ['feature:theme'],
  data: {
    label: 'ARR',
    value: 182_400_000,
    format: '$1.2M',
    delta: { vs: 165_200_000, scenario: 'PY' },
    spark: { kind: 'area', values: [121_400_000, 130_200_000, 138_900_000, 150_700_000, 165_200_000, 182_400_000] },
  },
  options: {
    // The card's figure already says the last value: a ring, no label.
    theme: { preset: 'standard', overrides: { surface: { sparkWash: false }, marks: { sparkEnd: 'ring', sparkEndLabel: false } } },
    title: 'ARR is 10% up on the year',
    source: 'Illustrative data',
  },
});

/**
 * The house eyebrow: 11 / 14 at 500, tracked 0.14 em, as authored
 * and the tertiary ink; the comparisons as toned text with no leading caret.
 */
fixtures.push({
  id: 'house-eyebrow',
  title: 'Tracked eyebrow from type.eyebrow, comparisons without carets',
  kind: 'example',
  data: {
    label: 'Blended CAC',
    value: 86.4,
    format: '$1.1',
    compare: [
      { vs: 79.2, label: 'YoY', mode: 'relative', direction: 'lowerIsBetter' },
      { vs: 90, label: 'vs Plan', mode: 'relative', direction: 'lowerIsBetter' },
    ],
    spark: { kind: 'line', values: [74.1, 76.8, 79.2, 82.6, 84.9, 86.4] },
  },
  options: {
    size: { width: 413, height: 184 },
    comparisons: 'text',
    theme: {
      preset: 'standard',
      overrides: {
        color: { inkMeta: '#6F7A85' },
        type: { eyebrow: { size: 11, lineHeight: 14 / 11, weight: 500, tracking: 0.14, ink: 'inkMeta' } },
        marks: { kpiCaret: false },
      },
    },
    source: 'Illustrative data',
  },
});

// The bare sparkline of sparkline/bare-card-spark inside the card that
// supplies its measure, its period and its number.
fixtures.push({
  id: 'weekly-orders-card-spark',
  title: 'The bare weekly sparkline inside a card that names the measure, the period and the number',
  kind: 'example',
  data: {
    label: 'Weekly orders, W8 2026',
    value: 110_000,
    format: '1k',
    compare: [{ vs: 96_000, label: 'vs W1', mode: 'relative' }],
    spark: { kind: 'line', values: [96_000, 98_000, 101_000, null, 104_000, 103_000, 107_000, 110_000], labels: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8'] },
  },
  options: {
    title: 'Weekly orders reach 110k, up 14.6% on the first week',
    source: 'Illustrative order data; W4 was not reported',
  },
});

// a spark that ends on another number than the card prints its last
// value, in the card's format; the label, its hover and the description agree.
fixtures.push({
  id: 'spark-ends-below-card',
  title: 'Cash card: today on the card, month-end balances in the spark, the last one labelled',
  kind: 'example',
  data: {
    label: 'Cash on hand',
    value: 4_820_000,
    format: '$1.2M',
    note: 'Today; the trend shows month-end balances',
    spark: { kind: 'line', values: [4_100_000, 4_350_000, 4_610_000], labels: ['Apr', 'May', 'Jun'] },
  },
  options: { source: 'Illustrative treasury data' },
});

// the spark in millions beside a card in euros printed its end as
// "$0.00B". A last value 1000 times off the card's is refused, at the values.
fixtures.push({
  id: 'spark-scale-mismatch',
  title: 'Refusal example: a spark given in millions beside a card in euros',
  kind: 'torture',
  refuses: { code: 'spark-scale-mismatch', path: 'data.spark.values' },
  data: {
    label: 'Revenue',
    value: 1_200_000_000,
    format: '$1.20B',
    spark: { kind: 'line', values: [1_050, 1_120, 1_180] },
  },
});

// an attainment in the bad tone over a column spark.
fixtures.push({
  id: 'attainment-bad-column-spark',
  title: 'Attainment chip in the bad tone over a monthly column spark',
  kind: 'torture',
  tags: ['demo', 'coverage'],
  data: {
    label: 'Bookings, FY26 year to date',
    value: 10_600_000,
    format: '$1.1M',
    compare: [{ vs: 11_910_000, label: 'vs Plan' }],
    attainment: { vs: 11_910_000, label: 'of Plan', tone: 'bad' },
    spark: { kind: 'column', values: [1_420_000, 1_510_000, 1_380_000, 1_460_000, 1_350_000, 1_290_000, 1_250_000], labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'] },
  },
  options: {
    size: { width: 451, height: 320 },
    title: 'Bookings trail plan as monthly intake slows',
    source: 'Synthetic bookings',
  },
});

fixtures.push({
  id: 'compact-spark-floor', title: 'Compact card keeps its sparkline readable', kind: 'torture',
  data: { label: 'Invented units', value: 8, spark: { kind: 'line', values: [2, 12, 4, 8] } },
  options: { density: 'compact' },
});

fixtures.push({ id: 'neutral-change', title: 'A change without a favorable direction', kind: 'example', data: { label: 'Requests', value: 120, delta: { vs: 100, direction: 'neutral' } }, options: { title: 'Request volume increased', size: { width: 420, height: 280 } } });

fixtures.push({
  id: 'value-bands',
  title: 'The band that holds the value colours the main value; the comparison keeps its own tone',
  kind: 'example',
  data: {
    label: 'Churn rate',
    value: 3.8,
    format: '0.0%',
    delta: { vs: 3.1, scenario: 'PY', direction: 'lowerIsBetter' },
    bands: [{ to: 2.5, tone: 'good', label: 'On plan' }, { to: 4, tone: 'warn', label: 'Watch' }, { to: 7, tone: 'neutral', label: 'Unrated' }, { to: 10, tone: 'bad', label: 'Off plan' }],
  },
});

registerFixtures('kpi', fixtures);
