/**
 * Line/area fixtures — examples (multi-
 * series line with actual/forecast period brackets + inline labels, endpoint
 * labels + highlight + CAGR, stacked area
 * "Growth [USD m]", area 100% revenue-share mix); torture set covers null
 * handling (interpolated vs broken line), 20-category density with
 * valueLabels 'all', a single category, crossing lines whose endpoint labels
 * must spread, and rebase100 indexing. Every fixture auto-enters the
 * invariant suite.
 */

import { registerFixtures } from '../../../fixtures/registry';
import { formatDate } from '../../dateFormat';
import { EVENT_GROUPS, EVENT_GROUPS_ALL, WEEKLY_CONVERSION, WEEKLY_CONVERSION_PY, WEEKLY_EVENTS, WEEKLY_EVENTS_MORE, weeklyEventCategories } from '../eventSample';
import { cohortLineFixtures } from './cohortFixtures';
import { continuousLineFixtures } from './continuousFixtures';
import { cycleBandsFixture } from './cycleBandsFixture';
import { gapBracketFixture } from './gapBracketFixture';
import type { Fixture } from '../../registry';
import type { Annotation } from '../../types/annotations';
import type { LineChartData } from '../../types/data';
import type { LineOptions } from './types';

type LineFixture = Fixture<LineChartData, LineOptions>;

/**
 * Bump (rank over time) scaffolding. The three bump fixtures are the proof
 * that ranks are DERIVED: not one of them carries a rank field. The engine
 * computes standard competition ranking from the values, which is why
 * `brand-share-bump` ships market shares and nothing else.
 */
const BUMP_TORTURE_PERIODS = Array.from({ length: 24 }, (_, index) => ({
  id: `m${index + 1}`,
  label: `M${index + 1}`,
}));

const BUMP_TORTURE_ENTITIES = [
  'Continental logistics and fulfilment partners',
  'Regional last-mile delivery cooperative',
  'Northern industrial components division',
  'Aurora',
  'Basalt',
  'Cinder',
  'Delta Works',
  'Ember',
  'Fenwick',
  'Granite',
  'Halcyon',
  'Ironside',
  'Juniper',
  'Keystone',
  'Larkspur',
  'Marlow',
  'Nimbus',
  'Orpheus',
];

/**
 * Complaints per 1,000 orders as WHOLE numbers in a NINE-wide band across 18
 * entities: by pigeonhole every period has ties, several of them, which is the
 * point of this torture case. (A 25-wide band was tried first and produced
 * exactly zero ties in 24 periods — the residues were distinct for all 18
 * entities. A torture fixture that silently tortures nothing is worse than no
 * fixture, so the band is narrower than the field.) The period term is a
 * MULTIPLE of 7, not of 3: `period * period * 3 % 9` collapses to two distinct
 * offsets and froze most of the movement, which a rank chart cannot afford.
 * Two entities carry disjoint interior null runs, which exercise run splitting
 * on a rank scale. Deterministic by construction — the value is a closed-form
 * function of (entity, period) and nothing else.
 */
const bumpTortureValues = (entity: number): (number | null)[] =>
  BUMP_TORTURE_PERIODS.map((_, period) => {
    if (entity === 4 && period >= 8 && period <= 11) return null;
    if (entity === 11 && period >= 14 && period <= 16) return null;
    return 40 + ((entity * 5 + period * 7 + (entity % 5) * 11) % 9);
  });

/**
 * Fan (declared uncertainty intervals) scaffolding.
 *
 * Every band below is built from the centre by CUMULATIVE HALF-WIDTHS, so
 * nesting holds by construction and `fan-bands-crossed` stays a refusal these
 * fixtures cannot trip. Not one fixture carries a quantile, a sigma or a
 * confidence level as data: the bounds ARE the data, and the label is what
 * says which interval they are.
 */
const fanBounds = (
  centre: (number | null)[],
  halfWidths: (number | null)[],
): { low: (number | null)[]; high: (number | null)[] } => ({
  low: centre.map((v, i) => (v === null || halfWidths[i] === null ? null : v - halfWidths[i]!)),
  high: centre.map((v, i) => (v === null || halfWidths[i] === null ? null : v + halfWidths[i]!)),
});

const FORECAST_QUARTERS = [
  '2024-Q1', '2024-Q2', '2024-Q3', '2024-Q4',
  '2025-Q1', '2025-Q2', '2025-Q3', '2025-Q4',
  '2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4',
  '2027-Q1', '2027-Q2', '2027-Q3', '2027-Q4',
];
/** Nine actual quarters, then seven forecast quarters. */
const FORECAST_ACTUALS = 9;
const FORECAST_CENTRE = [
  120, 124, 127, 131, 136, 139, 144, 149, 153, 158, 164, 170, 177, 183, 190, 197,
];
// Zero across every ACTUAL quarter — the fork is a fact of the data, which is
// what makes `derived.fan.origin` a derivation rather than a restatement of an
// authored field.
const FORECAST_HALF_50 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 6, 10, 14, 19, 24, 30];
const FORECAST_HALF_80 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 6, 12, 20, 29, 39, 50, 62];

const TORTURE_PERIODS = Array.from({ length: 24 }, (_, i) => ({
  id: `t${i + 1}`,
  label: `T${i + 1}`,
}));
/** Crosses zero twice; the fan therefore straddles the baseline. */
const TORTURE_CENTRE = TORTURE_PERIODS.map((_, i) => 40 - i * 4 + (i % 3) * 2);
/**
 * A torture fixture stresses the ENGINE; it is still the worked example an
 * agent copies, so its data has to be defensible.
 *
 * Half-width grows monotonically with the horizon (`i`), scaled by a
 * strictly decreasing per-band factor, so the bands are nested by construction
 * and the fan widens the way a forecast fan does. It is zero at T1 for every
 * band, which keeps `derived.fan.origin` a real derivation (T2, not "the first
 * category"). The closure is applied to the INNERMOST band alone.
 */
const TORTURE_HORIZON = (i: number): number => i;
/** Outermost first, strictly decreasing ⇒ nested at every category. */
const TORTURE_FACTOR = [1.5, 1, 0.75, 0.5] as const;
const TORTURE_HALF: number[][] = TORTURE_FACTOR.map((factor) =>
  TORTURE_PERIODS.map((_, i) => factor * TORTURE_HORIZON(i)),
);
/**
 * The innermost band ALONE is closed T9..T13 and open again after — a period
 * with a locked contract inside an otherwise uncertain horizon is legitimate
 * and must not be smoothed over — and its two bounds are null across T17..T19
 * (⇒ `fan-band-gap`). Zero is still nested inside the three open bands above it.
 */
const TORTURE_HALF_INNERMOST: (number | null)[] = TORTURE_HALF[3]!.map((v, i) =>
  i >= 16 && i <= 18 ? null : i >= 8 && i <= 12 ? 0 : v,
);

const RETRO_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const RETRO_CENTRE = [2.1, 2.4, 2.2, 2.6, 3.1, 2.9, 3.4, 3.6, 3.3, 3.8, 4.1, 4.4];
const RETRO_HALF_90 = [0.9, 1.0, 0.8, 1.1, 1.2, 1.0, 1.3, 1.4, 1.2, 1.5, 1.6, 1.7];

const fanFixtures: LineFixture[] = [
  {
    id: 'revenue-forecast-fan',
    title: 'Revenue outlook with a 50% and an 80% interval, forking at the forecast',
    kind: 'example',
    data: {
      categories: FORECAST_QUARTERS.map((id) => ({ id, label: id })),
      series: [
        {
          id: 'central',
          label: 'Central case',
          values: FORECAST_CENTRE.map((v, i) =>
            i < FORECAST_ACTUALS ? v : { number: v, scenario: 'FC' },
          ),
        },
        {
          id: 'p10',
          label: '80% lower bound',
          values: fanBounds(FORECAST_CENTRE, FORECAST_HALF_80).low,
        },
        {
          id: 'p90',
          label: '80% upper bound',
          values: fanBounds(FORECAST_CENTRE, FORECAST_HALF_80).high,
        },
        {
          id: 'p25',
          label: '50% lower bound',
          values: fanBounds(FORECAST_CENTRE, FORECAST_HALF_50).low,
        },
        {
          id: 'p75',
          label: '50% upper bound',
          values: fanBounds(FORECAST_CENTRE, FORECAST_HALF_50).high,
        },
      ],
    },
    options: {
      title: 'By 2027-Q4 the 80% interval spans ±62 around the central case',
      subtitle: { measure: 'Group revenue', period: '2024-Q1 – 2027-Q4', scenarios: ['AC', 'FC'] },
      fan: {
        of: 'central',
        bands: [
          { low: 'p10', high: 'p90', label: '80% predictive interval' },
          { low: 'p25', high: 'p75', label: '50% predictive interval' },
        ],
      },
      interpolate: 'linear',
      legend: 'bottom',
      valueAxis: { show: true },
      unit: '$m',
      source: 'Illustrative planning series; intervals declared by the planning team',
    },
  },
  {
    id: 'fan-torture',
    title: 'Four nested intervals widening with the horizon, the innermost closed for five periods and reopened, an undeclared gap, and a zero crossing',
    kind: 'torture',
    data: {
      categories: TORTURE_PERIODS,
      series: [
        {
          id: 'centre',
          // The full label exceeds the 18% endpoint gutter. The author-supplied
          // shortLabel is the deterministic fallback and the legend keeps the
          // full identity.
          label: 'Net working-capital swing, consolidated EU perimeter',
          shortLabel: 'Working-capital swing',
          values: TORTURE_CENTRE,
        },
        ...([0, 1, 2, 3] as const).flatMap((k) => {
          const half = k === 3 ? TORTURE_HALF_INNERMOST : TORTURE_HALF[k]!;
          const bounds = fanBounds(TORTURE_CENTRE, half);
          return [
            { id: `lo${k}`, label: `Band ${k + 1} lower`, values: bounds.low },
            { id: `hi${k}`, label: `Band ${k + 1} upper`, values: bounds.high },
          ];
        }),
      ],
    },
    options: {
      // TITLE_CLAIMS binds every clause here to `derived.fan.bands[].widths`.
      title:
        'Four intervals; the innermost is closed from T9 to T13 and open again after, and undeclared from T17 to T19',
      fan: {
        of: 'centre',
        bands: ([0, 1, 2, 3] as const).map((k) => ({
          low: `lo${k}`,
          high: `hi${k}`,
          label: `Scenario envelope ${k + 1}`,
        })),
        showBounds: true,
      },
      // Bands and the line must step TOGETHER; a band that interpolates
      // linearly under a stepped line is a drawing that contradicts itself.
      interpolate: 'step-after',
      // 'dashboard' (480x270) cannot carry this and does not fit:
      // 24 categories, four nested washes, a bottom legend of five keys and an
      // endpoint name left a 424x70 plot with eight hidden category labels —
      // a degradation report, not an exhibit.
      size: 'slide-16x9',
      legend: 'bottom',
      source: 'Synthetic torture series',
    },
  },
  {
    id: 'fan-retrospective',
    title: 'A backtest fan: the interval is open from the very first period',
    kind: 'example',
    data: {
      categories: RETRO_MONTHS.map((id) => ({ id, label: id })),
      series: [
        { id: 'fitted', label: 'Fitted value', values: RETRO_CENTRE },
        {
          id: 'lo90',
          label: '90% lower bound',
          values: fanBounds(RETRO_CENTRE, RETRO_HALF_90).low,
        },
        {
          id: 'hi90',
          label: '90% upper bound',
          values: fanBounds(RETRO_CENTRE, RETRO_HALF_90).high,
        },
      ],
    },
    options: {
      // The guard against someone "fixing" open-at-origin bands with a
      // warning: a backtest is uncertain in its FIRST period too, and a fan
      // that only forks at the end of history would be the wrong picture.
      title: 'The residual band is open in January — a backtest is uncertain everywhere',
      subtitle: { measure: 'Model error band around the fitted series' },
      fan: {
        of: 'fitted',
        bands: [{ low: 'lo90', high: 'hi90', label: '90% residual interval of the fitted model' }],
      },
      legend: 'bottom',
      valueAxis: { show: true },
      unit: 'pp',
      source: 'Illustrative backtest',
    },
  },
];

const trendFixture: LineFixture = {
    id: 'uneven-date-trends',
    title: 'Least-squares trends use elapsed days, with a separate fit for each series',
    kind: 'example',
    data: {
      categories: ['2026-01-01', '2026-01-04', '2026-01-10', '2026-01-17', '2026-01-24', '2026-02-01'].map(date => ({ id: date, date })),
      series: [
        { id: 'a', label: 'Series A', values: [20, 28, 25, 45, 39, 58] },
        { id: 'b', label: 'Series B', values: [62, 55, null, 48, 46, 34] },
      ],
    },
    options: { title: 'The two series move in opposite directions', source: 'Illustrative data', trend: { label: 'Linear trend' } },
  };

export const fixtures: LineFixture[] = [

  {
    id: 'actuals-forecast-operating-rate',
    title: 'Actuals and forecast output with a selected operating-rate tier',
    kind: 'example',
    tags: ['interaction'],
    hover: { owner: { categoryId: 'fy20', seriesId: 'output' } },
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
      title: 'Output reaches 112% of the modeled market by FY27',
      subtitle: {
        measure: 'Output and addressable market',
        period: 'FY20–FY27',
        scenarios: ['AC', 'FC'],
      },
      unit: 'index',
      valueAxis: { show: true, gridlines: true },
      seriesLabels: 'end',
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
    id: 'actuals-forecast-market',
    title: 'Actuals and forecast market profile with names at the line ends',
    kind: 'example',
    tags: ['forecast', 'annotation'],
    data: {
      categories: Array.from({ length: 14 }, (_, index) => ({
        id: `y${2000 + index}`,
        label: String(2000 + index),
      })),
      series: [
        {
          id: 'capacity',
          label: 'Capacity',
          colorRole: 'series-1',
          values: [92, 94, 96, 98, 100, 102, 105, 107, 108, 109, 110, 111, 112, 113].map(
            (number, index) => (index >= 8 ? { number, scenario: 'FC' as const } : number),
          ),
        },
        {
          id: 'production',
          label: 'Production',
          colorRole: 'series-2',
          values: [64, 68, 72, 77, 82, 86, 90, 96, 102, 106, 109, 111, 112, 113].map(
            (number, index) => (index >= 8 ? { number, scenario: 'FC' as const } : number),
          ),
        },
        {
          id: 'demand',
          label: 'Demand',
          colorRole: 'series-3',
          values: [48, 52, 57, 62, 66, 70, 74, 82, 94, 102, 108, 111, 113, 114].map(
            (number, index) => (index >= 8 ? { number, scenario: 'FC' as const } : number),
          ),
        },
      ],
    },
    options: {
      variant: 'line',
      // Names at the line ends, forecast lines included; inline names would sit on the strokes.
      seriesLabels: 'end',
      valueLabels: 'none',
      title: 'Demand catches production as the market tightens through 2013',
      subtitle: {
        measure: 'Capacity, Production and Demand',
        period: '2000–2013',
        scenarios: ['AC', 'FC'],
      },
      unit: 'million tonnes',
      valueAxis: { show: true, min: 40 },
      source: 'Illustrative market model',
    },
    annotations: [
      {
        kind: 'band',
        id: 'actuals-period',
        from: 'y2000',
        to: 'y2007',
        label: 'Actuals',
        style: 'bracket',
        divider: 'end',
      },
      {
        kind: 'band',
        id: 'forecast-period',
        from: 'y2008',
        to: 'y2013',
        label: 'Forecast',
        style: 'bracket',
      },
      {
        kind: 'note',
        id: 'demand-note',
        at: { categoryId: 'y2010', seriesId: 'demand' },
        text: 'Demand accelerates\ninto the forecast',
      },
    ],
  },
  {
    id: 'recession-era-band',
    title: 'Recession era band sits behind line marks and labels',
    kind: 'example',
    data: {
      categories: [
        { id: 'q1-24', label: 'Q1 24' },
        { id: 'q2-24', label: 'Q2 24' },
        { id: 'q3-24', label: 'Q3 24' },
        { id: 'q4-24', label: 'Q4 24' },
        { id: 'q1-25', label: 'Q1 25' },
        { id: 'q2-25', label: 'Q2 25' },
      ],
      series: [
        { id: 'orders', label: 'Orders', values: [104, 92, 86, 94, 101, 108] },
        { id: 'capacity', label: 'Capacity', values: [96, 95, 93, 96, 99, 103] },
      ],
    },
    options: {
      title: 'Orders recover above capacity after the recession trough',
      subtitle: { measure: 'Indexed volume', period: 'Q1 2024–Q2 2025' },
      valueAxis: { show: true, gridlines: true },
      // One line read against a reference: Orders leads in ink, Capacity is context.
      emphasis: 'first',
      // Report-context shape: names identify the direct-labeled series; page text owns latest values.
      valueLabels: 'none',
      source: 'Illustrative indexed order series; the band marks the recession quarters',
    },
    annotations: [
      { kind: 'band', from: 'q2-24', to: 'q3-24', label: 'Recession', tone: 'muted' },
    ],
  },
  {
    // Three regions of equal standing are told
    // apart by the theme ramp. 'none' is the default outside a fan; this
    // fixture names it so the peer reading is explicit.
    id: 'peer-regions-ramp',
    title: 'Three peer regions take the theme ramp, one colour each',
    kind: 'example',
    tags: ['feature:options'],
    data: {
      categories: [
        { id: 'd0', label: 'day 0' },
        { id: 'd2', label: '+2' },
        { id: 'd4', label: '+4' },
        { id: 'd6', label: '+6' },
        { id: 'd8', label: '+8' },
        { id: 'd10', label: '+10' },
      ],
      series: [
        { id: 'north', label: 'North', values: [74, 88, 93, 96, 98, 99] },
        { id: 'south', label: 'South', values: [41, 62, 80, 89, 95, 98] },
        { id: 'west', label: 'West', values: [40, 48, 66, 78, 84, 87] },
      ],
    },
    options: {
      title: 'At day ten, North reaches 99%, South 98% and West 87%',
      subtitle: { measure: 'Survey responses by days since the mail-out', period: '45 mail-outs' },
      unit: '% of final',
      seriesLabels: 'end',
      valueAxis: { show: true },
      emphasis: 'none',
      source: 'Synthetic demo data',
    },
  },
  {
    id: 'multiline-arr-endpoint-cagr',
    title: 'Multi-series line with endpoint labels, highlight, and CAGR arrow',
    kind: 'example',
    data: {
      categories: [
        { id: 'fy20', label: 'FY20', date: '2020-12-31' },
        { id: 'fy21', label: 'FY21', date: '2021-12-31' },
        { id: 'fy22', label: 'FY22', date: '2022-12-31' },
        { id: 'fy23', label: 'FY23', date: '2023-12-31' },
        { id: 'fy24', label: 'FY24', date: '2024-12-31' },
        { id: 'fy25', label: 'FY25F', date: '2025-12-31' },
      ],
      series: [
        {
          id: 'cloud',
          label: 'Cloud ARR',
          colorRole: 'highlight',
          values: [48, 66, 86, 118, 152, { number: 189, scenario: 'FC' }],
        },
        {
          id: 'license',
          label: 'License',
          values: [124, 118, 109, 97, 88, { number: 71, scenario: 'FC' }],
        },
        {
          id: 'maintenance',
          label: 'Maintenance',
          values: [96, 94, 92, 88, 80, { number: 78, scenario: 'FC' }],
        },
      ],
    },
    options: {
      variant: 'line',
      highlight: 'cloud',
      highlightMode: 'grey',
      valueAxis: { show: true },
      title: 'Cloud ARR compounds at 31.5% p.a. and overtakes license by FY23',
      subtitle: {
        company: 'Brevinth Software',
        measure: 'Revenue run-rate',
        period: 'FY20–FY25',
        scenarios: ['AC', 'FC'],
      },
      unit: '$m',
      source: 'Brevinth audited accounts; FY25 company forecast',
    },
    annotations: [
      { kind: 'cagr', from: { categoryId: 'fy20', seriesId: 'cloud' }, to: { categoryId: 'fy25', seriesId: 'cloud' } },
      // The bracket starts at 48; the start prints so the rate can be checked.
      { kind: 'abs', at: { categoryId: 'fy20', seriesId: 'cloud' } },
    ],
  },
  {
    id: 'multiline-highlight-fade',
    title: 'Five channels with one highlighted: the others keep their colour and fade',
    kind: 'example',
    data: {
      categories: ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30', '2026-04-06'].map((date, i) => ({ id: `w${i + 1}`, label: `W${i + 1}`, date })),
      series: [
        { id: 'search', label: 'Search', values: [120, 126, 131, 129, 138, 144] },
        { id: 'social', label: 'Social', values: [96, 99, 94, 101, 104, 103] },
        { id: 'video', label: 'Video', values: [60, 66, 71, 79, 88, 97] },
        { id: 'email', label: 'Email', values: [44, 43, 46, 45, 47, 46] },
        { id: 'display', label: 'Display', values: [30, 28, 29, 25, 24, 22] },
      ],
    },
    options: {
      variant: 'line',
      highlight: 'video',
      highlightMode: 'fade',
      title: 'Video grows every week while the other channels hold',
      unit: 'k visits',
    },
  },
  {
    id: 'stacked-area-services-growth',
    title: 'Stacked area: services portfolio growth in USD m',
    kind: 'example',
    data: {
      categories: [
        { id: 'y2018', label: '2018' },
        { id: 'y2022', label: '2022' },
        { id: 'y2030', label: '2030F' },
        { id: 'y2034', label: '2034F' },
        { id: 'y2038', label: '2038F' },
      ],
      series: [
        {
          id: 'managed',
          label: 'Managed services',
          values: [8, 14, { number: 24, scenario: 'FC' }, { number: 31, scenario: 'FC' }, { number: 38, scenario: 'FC' }],
        },
        {
          id: 'implementation',
          label: 'Implementation',
          values: [12, 15, { number: 18, scenario: 'FC' }, { number: 19, scenario: 'FC' }, { number: 20, scenario: 'FC' }],
        },
        {
          id: 'consulting',
          label: 'Consulting',
          values: [9, 10, { number: 12, scenario: 'FC' }, { number: 12, scenario: 'FC' }, { number: 13, scenario: 'FC' }],
        },
        {
          id: 'bpo',
          label: 'BPO',
          values: [3, 4, { number: 6, scenario: 'FC' }, { number: 7, scenario: 'FC' }, { number: 9, scenario: 'FC' }],
        },
      ],
    },
    options: {
      variant: 'stacked-area',
      // The emphasis is a selection, so it takes color.focus; a whole area
      // in the one accent was the loudest mark on the page.
      highlight: 'managed',
      size: { width: 800, height: 450 },
      valueAxis: { show: true },
      title: 'Managed services drive three-fifths of the growth to 2038',
      subtitle: {
        company: 'Atlas Consulting',
        measure: 'Growth',
        period: '2018–2038',
        scenarios: ['AC', 'FC'],
      },
      unit: 'USD m',
      source: 'Atlas strategy plan 2026; outer years modeled',
    },
  },
  {
    id: 'stacked100-area-revenue-mix',
    title: 'Area 100%: revenue share mix shifts to subscriptions',
    kind: 'example',
    data: {
      categories: [
        { id: 'y2019', label: '2019' },
        { id: 'y2021', label: '2021' },
        { id: 'y2023', label: '2023' },
        { id: 'y2025', label: '2025' },
      ],
      series: [
        {
          id: 'subs',
          label: 'Subscriptions',
          colorRole: 'highlight',
          values: [31, 58, 96, 148],
        },
        { id: 'transact', label: 'Transactional', values: [64, 71, 74, 70] },
        { id: 'hardware', label: 'Hardware', values: [58, 49, 38, 27] },
      ],
    },
    options: {
      variant: 'stacked100-area',
      rounding: 'sum-consistent',
      valueAxis: { show: true },
      categoryAxis: { crossesBetween: false },
      seriesLabels: 'key',
      valueLabels: 'all',
      title: 'Subscriptions reach 60% of the mix by 2025',
      subtitle: { company: 'Novum Retail Tech', measure: 'Revenue share', period: '2019–2025' },
      unit: '% of revenue',
      source: 'Novum segment reporting',
      legend: 'bottom',
    },
  },
  {
    id: 'stacked100-area-mixed-sign-fail-closed',
    title: 'Torture: mixed-sign stacked100-area category fails closed with n.m.',
    kind: 'torture',
    data: {
      categories: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      series: [
        { id: 's1', label: 'S1', values: [60, 40] },
        { id: 's2', label: 'S2', values: [-20, 60] },
      ],
    },
    options: {
      variant: 'stacked100-area',
      seriesLabels: 'key',
      valueLabels: 'all',
      title: 'Signed contributions are not composition shares',
      subtitle: { measure: 'Mix', period: 'A–B' },
      unit: '%',
      legend: 'bottom',
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
      title: 'FY24 market is zero, so the operating rate fails closed as n/a',
      subtitle: {
        measure: 'Output and addressable market',
        period: 'FY20–FY27',
        scenarios: ['AC', 'FC'],
      },
      unit: 'index',
      valueAxis: { show: true, gridlines: true },
      seriesLabels: 'end',
      valueLabels: 'last',
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
    id: 'nulls-interpolated-and-broken',
    title: 'Torture: nulls — one series interpolates, one breaks the line',
    kind: 'torture',
    data: {
      categories: [
        { id: 'm1', label: 'Jan' },
        { id: 'm2', label: 'Feb' },
        { id: 'm3', label: 'Mar' },
        { id: 'm4', label: 'Apr' },
        { id: 'm5', label: 'May' },
        { id: 'm6', label: 'Jun' },
        { id: 'm7', label: 'Jul' },
        { id: 'm8', label: 'Aug' },
      ],
      series: [
        {
          id: 'plant-a',
          label: 'Plant A',
          interpolateGaps: true,
          values: [102, null, 111, 116, null, null, 128, 134],
        },
        {
          id: 'plant-b',
          label: 'Plant B',
          interpolateGaps: false,
          values: [88, 91, null, null, 97, 99, null, 104],
        },
      ],
    },
    options: {
      title: 'Sensor outages: interpolated vs broken series',
      subtitle: { measure: 'Throughput', period: 'Jan–Aug 2026' },
      unit: 'units/h',
    },
  },
  {
    id: 'dense-20-categories-all-labels',
    title: "Torture: 20 categories, valueLabels 'all', sweepHide density",
    kind: 'torture',
    data: {
      categories: Array.from({ length: 20 }, (_, i) => ({
        id: `w${i + 1}`,
        label: `W${i + 1}`,
      })),
      series: [
        {
          id: 'orders',
          label: 'Orders',
          values: [
            412, 428, 405, 441, 456, 449, 472, 468, 485, 502, 494, 511, 528, 519, 536, 549, 542,
            561, 574, 588,
          ],
        },
        {
          id: 'returns',
          label: 'Returns',
          values: [
            61, 58, 66, 63, 70, 74, 69, 77, 72, 80, 84, 79, 88, 91, 86, 94, 99, 96, 103, 108,
          ],
        },
      ],
    },
    options: {
      seriesLabels: 'key',
      valueLabels: 'all',
      labelDensity: 'smart',
      title: 'Dense weekly profile keeps only the labels that fit',
      subtitle: { measure: 'Order volume', period: '20 weeks' },
      unit: 'K units',
      // 'all' mode labels VALUES, not names — without a legend the two
      // lines would be anonymous (series-unexplained)
      legend: 'top',
    },
  },
  {
    id: 'dense-inline-labels',
    title: 'Torture: six crossing lines keep collision-free inline names',
    kind: 'torture',
    // The seriesLabels 'inline' demo since actuals-forecast-market names its lines at their ends.
    tags: ['demo'],
    data: {
      categories: Array.from({ length: 14 }, (_, index) => ({
        id: `p${index + 1}`,
        label: `P${index + 1}`,
      })),
      series: [
        { id: 'north', label: 'North', colorRole: 'series-1', values: [55, 60, 65, 70, 78, 84, 88, 90, 89, 84, 78, 72, 66, 60] },
        { id: 'south', label: 'South', colorRole: 'series-2', values: [88, 84, 80, 77, 76, 75, 74, 75, 76, 78, 80, 82, 84, 86] },
        { id: 'east', label: 'East', colorRole: 'series-3', values: [30, 35, 42, 50, 56, 58, 59, 60, 62, 66, 72, 78, 84, 90] },
        { id: 'west', label: 'West', colorRole: 'series-4', values: [70, 66, 62, 58, 54, 50, 46, 45, 44, 43, 42, 41, 40, 39] },
        { id: 'central', label: 'Central', colorRole: 'series-5', values: [18, 24, 32, 40, 48, 42, 36, 30, 34, 40, 48, 56, 64, 72] },
        { id: 'coastal', label: 'Coastal', colorRole: 'series-6', values: [48, 44, 38, 32, 26, 20, 16, 15, 18, 24, 32, 40, 50, 62] },
      ],
    },
    options: {
      // Names on the lines (seriesLabels) and the last values.
      seriesLabels: 'inline',
      title: 'Six regional profiles remain identifiable through repeated crossings',
      subtitle: { measure: 'Regional index', period: '14 periods' },
      unit: 'index points',
      footnotes: ['Series names are integrated into the line courses.'],
    },
  },
  {
    id: 'single-category',
    title: 'Torture: one category — markers and endpoint labels only',
    kind: 'torture',
    data: {
      categories: [{ id: 'q1', label: 'Q1 2026' }],
      series: [
        { id: 'north', label: 'North', values: [42.5] },
        { id: 'south', label: 'South', values: [38.1] },
      ],
    },
    options: {
      title: 'Single-period sanity check',
      unit: '$m',
    },
  },
  {
    id: 'crossing-lines-endpoint-spread',
    title: 'Torture: converging lines force endpoint-label spreading',
    kind: 'torture',
    data: {
      categories: [
        { id: 'y21', label: '2021' },
        { id: 'y22', label: '2022' },
        { id: 'y23', label: '2023' },
        { id: 'y24', label: '2024' },
        { id: 'y25', label: '2025' },
      ],
      series: [
        { id: 'alpha', label: 'Supplier A', values: [12, 28, 44, 58, 71.2] },
        { id: 'beta', label: 'Supplier B', values: [95, 88, 81, 76, 71.8] },
        { id: 'gamma', label: 'Supplier C', values: [55, 61, 66, 69, 70.4] },
        { id: 'delta', label: 'Supplier D', values: [70, 70.5, 70.8, 71, 70.9] },
      ],
    },
    options: {
      title: 'Four players converge on the same market share',
      subtitle: { measure: 'Installed base', period: '2021–2025' },
      unit: 'K seats',
    },
    // Four lines end within 1.4 of each other, so each name in the
    // end column takes its value as a second line.
  },
  {
    id: 'rebase100-indexed-peers',
    title: 'Torture: rebase100 — peer share prices indexed to 100',
    kind: 'torture',
    data: {
      categories: [
        { id: 'q1', label: 'Q1 24' },
        { id: 'q2', label: 'Q2 24' },
        { id: 'q3', label: 'Q3 24' },
        { id: 'q4', label: 'Q4 24' },
        { id: 'q5', label: 'Q1 25' },
        { id: 'q6', label: 'Q2 25' },
      ],
      series: [
        { id: 'us', label: 'Our company', colorRole: 'highlight', values: [84.2, 91.5, 99.8, 112.4, 121.7, 133.9] },
        { id: 'peer1', label: 'Peer 1', values: [212, 208, 221, 236, 229, 241] },
        { id: 'peer2', label: 'Peer 2', values: [45.8, 44.1, 47.3, 46.2, 49.9, 48.4] },
      ],
    },
    options: {
      rebase100: true,
      highlight: 'us',
      valueAxis: { show: true, gridlines: true },
      title: 'We outperform both peers by 40+ points since Q1 24',
      subtitle: { measure: 'Total shareholder return', period: 'Q1 24–Q2 25' },
      unit: 'indexed',
      source: 'Illustrative quarterly prices',
    },
  },
  {
    id: 'era-event-markers',
    title: 'Event markers: measurement honesty on a monthly trend',
    kind: 'example',
    data: {
      categories: [
        { id: 'm1', label: 'Jan' },
        { id: 'm2', label: 'Feb' },
        { id: 'm3', label: 'Mar' },
        { id: 'm4', label: 'Apr' },
        { id: 'm5', label: 'May' },
        { id: 'm6', label: 'Jun' },
        { id: 'm7', label: 'Jul' },
        { id: 'm8', label: 'Aug' },
      ],
      series: [
        { id: 'nc', label: 'New customers', colorRole: 'highlight', values: [1240, 1195, 980, 1010, 992, 1060, 1005, 1120] },
        { id: 'ret', label: 'Returning', values: [640, 655, 630, 598, 612, 640, 662, 671] },
      ],
    },
    annotations: [
      { kind: 'event', at: 'm3', group: 'measurement', label: 'Reporting change' },
      { kind: 'event', at: 'm6', group: 'pricing', label: 'Price increase' },
    ],
    options: {
      title: 'New customers step down at the reporting change; returning hold',
      subtitle: { measure: 'Customer volumes', period: 'Jan–Aug' },
      source: 'Illustrative customer data',
      events: {
        placement: 'auto',
        groups: [
          { id: 'measurement', label: 'Measurement', tone: 'neutral', glyph: 'square' },
          { id: 'pricing', label: 'Pricing', tone: 'bad', glyph: 'triangle' },
        ],
      },
    },
  },
  {
    id: 'dense-event-badges',
    title: 'Torture: five events on twelve months, four in the lane, the one that does not fit in the key',
    kind: 'torture',
    data: {
      categories: Array.from({ length: 12 }, (_, i) => ({
        id: `m${i + 1}`,
        label: `M${i + 1}`,
      })),
      series: [
        {
          id: 's',
          label: 'Spend',
          colorRole: 'highlight',
          values: [42, 45, 39, 51, 48, 55, 43, 41, 58, 61, 57, 63],
        },
      ],
    },
    annotations: [
      { kind: 'event', at: 'm2', label: 'Campaign A live' },
      { kind: 'event', at: 'm4', label: 'Seasonal campaign stopped', tone: 'bad' },
      { kind: 'event', at: 'm6', label: 'Price update' },
      { kind: 'event', at: 'm9', label: 'Budget review' },
      { kind: 'event', at: 'm11', label: 'Landing-page rollout' },
    ],
    options: {
      title: 'Dense change history stays legible in the event lane',
      subtitle: { measure: 'Media spend', period: '12 months' },
      source: 'Illustrative change log',
      // The a4 rung keeps the lane row: on slide-16x9 the
      // row gives way and every event becomes a numbered marker.
      size: { width: 720, height: 511 },
    },
  },
  {
    id: 'policy-rate-step',
    title: 'Policy rate step path holds each decision until the next meeting',
    kind: 'torture',
    tags: ['demo', 'regression', 'feature:step-interpolation'],
    data: {
      categories: [
        { id: 'm01', label: 'Jan 22' },
        { id: 'm02', label: 'Mar 22' },
        { id: 'm03', label: 'Jun 22' },
        { id: 'm04', label: 'Jul 22' },
        { id: 'm05', label: 'Sep 22' },
        { id: 'm06', label: 'Nov 22' },
        { id: 'm07', label: 'Dec 22' },
        { id: 'm08', label: 'Feb 23' },
        { id: 'm09', label: 'Mar 23' },
        { id: 'm10', label: 'May 23' },
        { id: 'm11', label: 'Jun 23' },
        { id: 'm12', label: 'Jul 23' },
        { id: 'm13', label: 'Sep 23' },
        { id: 'm14', label: 'Dec 23' },
        { id: 'm15', label: 'Mar 24' },
        { id: 'm16', label: 'Jun 24' },
      ],
      series: [
        {
          id: 'policy-rate',
          label: 'Policy rate',
          colorRole: 'highlight',
          marker: 'none',
          // The title names the 5.5% peak, so the peak prints.
          values: [0, 0.25, 0.75, 1.25, 2, 3, 3.5, 4, 4.5, 5, 5.25, { number: 5.5, label: '${value}' }, 5.5, 5.25, 5, 4.75],
        },
      ],
    },
    options: {
      interpolate: 'step-after',
      seriesLabels: 'end',
      valueLabels: 'last',
      title: 'The policy rate peaked at 5.5% before the easing cycle began',
      subtitle: { measure: 'Policy rate', period: 'Jan 2022–Jun 2024' },
      unit: '%',
      format: '1.0%',
      valueAxis: { show: true, includeZero: true },
      source: 'Illustrative central-bank meeting path',
    },
  },
  {
    id: 'real-rate-gap',
    title: 'Real-rate spread changes tone where the two lines cross',
    kind: 'example',
    data: {
      categories: [
        { id: 'y21', label: '2021' },
        { id: 'y22', label: '2022' },
        { id: 'y23', label: '2023' },
        { id: 'y24', label: '2024' },
        { id: 'y25', label: '2025F' },
        { id: 'y26', label: '2026F' },
      ],
      series: [
        {
          id: 'policy',
          label: 'Policy rate',
          colorRole: 'series-1',
          values: [1.5, 2, 3, 4, 4.5, 5],
        },
        {
          id: 'inflation',
          label: 'Inflation',
          colorRole: 'series-2',
          values: [4.5, 4, 3.2, 3.5, 3, 2.5],
        },
      ],
    },
    options: {
      gapFill: {
        between: ['policy', 'inflation'],
        positiveTone: 'good',
        negativeTone: 'bad',
      },
      title: 'Real rates turn positive in 2024 as policy overtakes inflation',
      subtitle: { measure: 'Policy rate and inflation', period: '2021–2026' },
      format: '1.0%',
      valueAxis: { show: true },
      source: 'Illustrative macro scenario',
    },
  },
  {
    id: 'emissions-target-path',
    title: 'Future emissions goals remain visible beyond the actual line',
    kind: 'example',
    data: {
      categories: [
        { id: 'y22', label: '2022' },
        { id: 'y23', label: '2023' },
        { id: 'y24', label: '2024' },
        { id: 'y25', label: '2025' },
        { id: 'y26', label: '2026F' },
        { id: 'y28', label: '2028 target' },
        { id: 'y30', label: '2030 target' },
      ],
      series: [
        {
          id: 'scope12',
          label: 'Scope 1+2 emissions',
          colorRole: 'neutral',
          interpolateGaps: false,
          values: [128, 119, 109, 101, 94, null, null],
          targets: [
            { at: 'y28', value: 72, label: '2028 goal' },
            { at: 'y30', value: 48, label: '2030 goal' },
          ],
        },
      ],
    },
    options: {
      title: 'The 2030 goal requires emissions to halve from the 2026 forecast',
      subtitle: { measure: 'Scope 1+2 emissions', period: '2022–2030' },
      unit: 'ktCO₂e',
      valueAxis: { show: true },
      source: 'Illustrative transition plan',
    },
  },
  {
    id: 'oil-event-context',
    title: 'Inline multi-line event context sits beside the monthly rule',
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
      ],
      series: [
        {
          id: 'oil',
          label: 'Brent crude',
          colorRole: 'highlight',
          values: [76, 78, 84, 96, 91, 88, 86, 89],
        },
      ],
    },
    annotations: [
      {
        kind: 'event',
        id: 'embargo',
        at: 'apr',
        label: 'Embargo announced\nFreight costs reset',
        labelPlacement: 'inline',
        tone: 'bad',
      } as Annotation & { labelPlacement: 'inline' },
    ],
    options: {
      title: 'Brent peaks at 96 in April, then retreats',
      subtitle: { measure: 'Brent crude spot price', period: 'Jan–Aug' },
      unit: 'USD/bbl',
      valueAxis: { show: true },
      source: 'Illustrative market series',
    },
  },
  {
    // APPENDED, never prepended: STATIC_PINS.line pins fixtures[0]'s SVG.
    // Nothing here carries a rank — the shares are the whole input, and the
    // ladder in the exhibit is the engine's derivation of them.
    id: 'brand-share-bump',
    // The ranking note is opt-in, so the plot keeps its height and
    // Tarn's start label fits.
    title: 'Halden overtakes Nurthwold while Tarn enters and Vesper leaves the field',
    kind: 'example',
    data: {
      categories: [
        { id: 'q1', label: "Q1'23" },
        { id: 'q2', label: "Q2'23" },
        { id: 'q3', label: "Q3'23" },
        { id: 'q4', label: "Q4'23" },
        { id: 'q5', label: "Q1'24" },
        { id: 'q6', label: "Q2'24" },
        { id: 'q7', label: "Q3'24" },
        { id: 'q8', label: "Q4'24" },
        { id: 'q9', label: "Q1'25" },
        { id: 'q10', label: "Q2'25" },
      ],
      series: [
        {
          id: 'nurthwold',
          label: 'Nurthwold',
          values: [24.1, 23.8, 23.4, 22.9, 22.5, 22.0, 21.6, 21.2, 20.8, 20.4],
        },
        {
          id: 'halden',
          label: 'Halden',
          values: [18.6, 19.0, 19.4, 19.8, 20.2, 20.6, 21.1, 21.6, 22.1, 22.6],
        },
        {
          id: 'corvus',
          label: 'Corvus',
          values: [15.2, 15.0, 14.8, 14.6, 14.4, 14.2, 14.0, 13.8, 13.6, 13.4],
        },
        {
          id: 'brevinth',
          label: 'Brevinth',
          values: [11.4, 11.9, 12.4, 12.9, 13.4, 13.9, 14.4, 14.9, 15.4, 15.9],
        },
        {
          id: 'ashgrove',
          label: 'Ashgrove',
          values: [9.2, 9.0, 8.8, 8.6, 8.4, 8.2, 8.0, 7.8, 7.6, 7.4],
        },
        {
          // 8.4 in Q1'24 is a deliberate dead heat with Ashgrove: both are
          // drawn at the same height, the next rank is skipped, and the
          // exhibit says so rather than nudging one of them aside.
          id: 'beacon',
          label: 'Beacon',
          values: [6.5, 6.4, 6.3, 6.2, 8.4, 6.0, 5.9, 5.8, 5.7, 5.6],
        },
        {
          // Entrant: no share before Q4'23, therefore no rank before Q4'23.
          id: 'tarn',
          label: 'Tarn',
          values: [null, null, null, 3.1, 3.8, 4.5, 5.2, 5.9, 6.6, 7.3],
        },
        {
          // Exit: leaves the market after Q3'24 and stops holding a rank.
          id: 'vesper',
          label: 'Vesper',
          values: [4.9, 4.7, 4.5, 4.3, 4.1, 3.9, 3.7, null, null, null],
        },
      ],
    },
    options: {
      variant: 'bump',
      bump: { direction: 'higherIsBetter' },
      // The two story lines, blue and navy;
      // the six others are the field in one flat grey.
      highlight: ['halden', 'nurthwold'],
      // The shares behind the ranks, as a printed value would show them.
      format: '1.0%',
      title: "Halden overtakes Nurthwold for share leadership in Q4'24",
      subtitle: { measure: 'Rank by market share', period: "Q1'23–Q2'25" },
      legend: 'none',
      source: 'Illustrative market shares',
    },
  },
  {
    id: 'bump-torture',
    title: 'Refusal example: eighteen suppliers ranked in one bump chart, above its twelve-line limit',
    kind: 'torture',
    // Above the entity limit the spec is refused; bump-torture-focus is the drawn view.
    refuses: { code: 'bump-series-limit', path: 'options.bump.focus' },
    // 18 entities, 24 periods, a tie in every period, 120 tied groups.
    data: {
      categories: BUMP_TORTURE_PERIODS,
      series: BUMP_TORTURE_ENTITIES.map((label, entity) => ({
        id: `e${entity + 1}`,
        label,
        values: bumpTortureValues(entity),
      })),
    },
    options: {
      variant: 'bump',
      // Fewer complaints is better. The spec is refused before anything draws;
      // bump-torture-focus draws the inverted ladder with the same direction.
      bump: { direction: 'lowerIsBetter' },
      title: 'Complaint rank, 18 suppliers over 24 months',
      subtitle: { measure: 'Rank by complaints per 1,000 orders (lower is better)' },
      size: { width: 1080, height: 608 },
      legend: 'none',
      source: 'Illustrative service quality series',
    },
  },
  {
    // The view bump-torture's refusal points to. Four suppliers are
    // drawn, all eighteen are ranked, the other fourteen are named in a note
    // with their last rank and keep their values in the data table.
    id: 'bump-torture-focus',
    title: 'Four of eighteen suppliers drawn, the field still ranked',
    // Torture: the data keeps bump-torture's tie in every period.
    kind: 'torture',
    data: {
      categories: BUMP_TORTURE_PERIODS,
      series: BUMP_TORTURE_ENTITIES.map((label, entity) => ({
        id: `e${entity + 1}`,
        label,
        values: bumpTortureValues(entity),
      })),
    },
    options: {
      variant: 'bump',
      bump: { direction: 'lowerIsBetter', focus: ['e1', 'e4', 'e10', 'e18'] },
      // The values of the fourteen undrawn suppliers stay readable in
      // the data table, one click away under the chart.
      a11y: { table: 'toggle' },
      title: 'Complaint rank of four suppliers among 18, over 24 months',
      subtitle: { measure: 'Rank by complaints per 1,000 orders (lower is better)' },
      size: { width: 1080, height: 608 },
      legend: 'none',
      source: 'Illustrative service quality series',
    },
  },
  {
    id: 'bump-two-entities',
    title: 'The minimum honest bump: two entities and one crossing',
    kind: 'example',
    data: {
      categories: [
        { id: 'y19', label: '2019' },
        { id: 'y20', label: '2020' },
        { id: 'y21', label: '2021' },
        { id: 'y22', label: '2022' },
        { id: 'y23', label: '2023' },
        { id: 'y24', label: '2024' },
      ],
      series: [
        { id: 'rail', label: 'Rail freight', values: [412, 398, 381, 369, 354, 341] },
        { id: 'road', label: 'Road freight', values: [318, 333, 349, 366, 384, 402] },
      ],
    },
    options: {
      variant: 'bump',
      // The one fixture that shows the bump ranking note.
      methodNote: true,
      title: 'Road freight passed rail on volume in 2023',
      subtitle: { measure: 'Rank by tonne-kilometres', period: '2019–2024' },
      legend: 'none',
      source: 'Illustrative freight series',
    },
  },
  {
    // two periods need little plot, so the name columns take the
    // width the band steps leave and every name stays on one line at 400px.
    id: 'bump-two-point-long-names',
    title: 'Two periods with long carrier names, each on one line',
    kind: 'example',
    data: {
      categories: [
        { id: 'y23', label: '2023' },
        { id: 'y24', label: '2024' },
      ],
      series: [
        { id: 'nurthwold', label: 'Nurthwold Freight', values: [96.1, 94.8] },
        { id: 'brevinth', label: 'Brevinth Transport', values: [95.4, 96.3] },
        { id: 'saltmere', label: 'Saltmere Carriers', values: [93.2, 93.9] },
        { id: 'tidewarden', label: 'Tidewarden Logistics', values: [91.7, 90.5] },
      ],
    },
    options: {
      variant: 'bump',
      title: 'Brevinth now leads on punctuality',
      subtitle: { measure: 'Rank by on-time deliveries', period: '2023–2024' },
      size: { width: 400, height: 300 },
      legend: 'none',
      source: 'Illustrative carrier data',
    },
  },
  {
    // eight brands reverse their order between two halves, so every
    // line crosses at the middle and the seats over and under the end points
    // run out. A value with no seat reads in its name ("Fir · 18.8%").
    id: 'bump-two-point-close-ranks',
    title: 'Eight close ranks reverse between two periods, every value printed',
    kind: 'example',
    data: {
      categories: [
        { id: 'h1', label: 'H1' },
        { id: 'h2', label: 'H2' },
      ],
      series: [
        { id: 'alder', label: 'Alder', values: [19.5, 16.8] },
        { id: 'birch', label: 'Birch', values: [19.1, 17.2] },
        { id: 'cedar', label: 'Cedar', values: [18.7, 17.6] },
        { id: 'dogwood', label: 'Dogwood', values: [18.3, 18.0] },
        { id: 'elm', label: 'Elm', values: [17.9, 18.4] },
        { id: 'fir', label: 'Fir', values: [17.5, 18.8] },
        { id: 'ginkgo', label: 'Ginkgo', values: [17.1, 19.2] },
        { id: 'hazel', label: 'Hazel', values: [16.7, 19.6] },
      ],
    },
    options: {
      variant: 'bump',
      valueLabels: 'all',
      format: '0.0%',
      title: 'The order of the eight brands reversed in the second half',
      subtitle: { measure: 'Rank by brand consideration', period: 'H1–H2' },
      size: { width: 960, height: 540 },
      legend: 'none',
      source: 'Illustrative survey; respondents may consider several brands',
    },
  },
  ...fanFixtures,
  {
    id: 'trajectory-highlights',
    title: 'Three trajectory inflections are called out with shared icon chips',
    kind: 'example',
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
        { id: 'q9', label: 'Q9' },
      ],
      series: [
        {
          id: 'core',
          label: 'Core',
          colorRole: 'highlight',
          values: [42, 47, 51, 58, 64, 72, 79, 87, 96],
        },
        {
          id: 'north',
          label: 'North',
          values: [60, 61, 63, 65, 66, 68, 72, 75, 78],
        },
        {
          id: 'east',
          label: 'East',
          colorRole: 'series-3',
          values: [35, 39, 44, 50, 57, 63, 69, 74, 80],
        },
      ],
    },
    annotations: [
      {
        kind: 'callout',
        id: 'north-launch',
        at: { categoryId: 'q2', seriesId: 'north' },
        text: 'Regional launch',
        icon: 'flag',
        preferSide: 'above',
      } as Annotation & { icon: 'flag' },
      {
        kind: 'callout',
        id: 'east-playbook',
        at: { categoryId: 'q5', seriesId: 'east' },
        text: 'New playbook scales',
        icon: 'lightbulb',
        preferSide: 'right',
      } as Annotation & { icon: 'lightbulb' },
      {
        kind: 'callout',
        id: 'core-target',
        at: { categoryId: 'q8', seriesId: 'core' },
        text: 'Target run-rate reached',
        icon: 'target',
        preferSide: 'left',
      } as Annotation & { icon: 'target' },
    ],
    options: {
      title: 'Core reaches the target run-rate as the regional playbook scales',
      subtitle: { measure: 'Indexed trajectory', period: 'Q1–Q9' },
      seriesLabels: 'end',
      valueLabels: 'last',
      valueAxis: { show: true, gridlines: true },
      size: 'slide-16x9',
      source: 'Illustrative operating trajectory',
    },
  },
  {
    id: 'three-horizons',
    title: 'Three smooth planning horizons occupy separate windows',
    kind: 'example',
    data: {
      categories: Array.from({ length: 12 }, (_, index) => ({
        id: `m${index + 1}`,
        label: `M${index + 1}`,
      })),
      series: [
        {
          id: 'near',
          label: 'Near term',
          colorRole: 'series-1',
          smooth: true,
          interpolateGaps: false,
          values: [42, 70, 84, 90, null, null, null, null, null, null, null, null],
        },
        {
          id: 'mid',
          label: 'Mid term',
          colorRole: 'series-2',
          smooth: true,
          interpolateGaps: false,
          values: [null, null, null, null, 72, 98, 111, 117, null, null, null, null],
        },
        {
          id: 'long',
          label: 'Long term',
          colorRole: 'series-3',
          smooth: true,
          interpolateGaps: false,
          values: [null, null, null, null, null, null, null, null, 98, 126, 140, 146],
        },
      ],
    },
    options: {
      interpolate: 'monotone',
      title: 'Each planning horizon rises quickly before reaching a higher plateau',
      subtitle: { measure: 'Illustrative trajectory', period: 'Months 1–12' },
      source: 'Illustrative planning horizons',
    },
  },
  {
    id: 'product-lifecycle',
    title: 'One continuous product curve is partitioned into four lifecycle phases',
    kind: 'example',
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
        { id: 'q9', label: 'Q9' },
      ],
      series: [
        {
          id: 'adoption',
          label: 'Product adoption',
          smooth: true,
          marker: 'none',
          values: [8, 15, 32, 58, 82, 94, 91, 72, 48],
        },
      ],
    },
    options: {
      interpolate: 'monotone',
      phases: [
        { id: 'intro', label: 'Introduction', from: 'q1', to: 'q2', rank: 1 },
        { id: 'growth', label: 'Growth', from: 'q3', to: 'q5', rank: 2 },
        { id: 'maturity', label: 'Maturity', from: 'q6', to: 'q7', rank: 3 },
        { id: 'decline', label: 'Decline', from: 'q8', to: 'q9', tone: 'muted' },
      ],
      title: 'Adoption peaks in maturity before a managed decline',
      subtitle: { measure: 'Indexed product adoption', period: 'Lifecycle quarters' },
      source: 'Illustrative product lifecycle',
      seriesLabels: 'none',
      valueLabels: 'none',
    },
  },
  {
    id: 'smooth-gaps',
    title: 'Torture: monotone smoothing either bridges or breaks declared null gaps',
    kind: 'torture',
    data: {
      categories: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((id) => ({ id, label: id.toUpperCase() })),
      series: [
        {
          id: 'bridge',
          label: 'Bridge null',
          smooth: true,
          interpolateGaps: true,
          values: [10, 18, null, 31, 36, 44],
        },
        {
          id: 'break',
          label: 'Break at null',
          smooth: true,
          interpolateGaps: false,
          values: [8, 14, null, 25, 28, 35],
        },
      ],
    },
    options: {
      title: 'Declared null handling remains visible under smoothing',
    },
  },
  {
    id: 'sparse-phases',
    title: 'Torture: four one-category phases share three exact boundaries',
    kind: 'torture',
    data: {
      categories: ['a', 'b', 'c', 'd'].map((id) => ({ id, label: id.toUpperCase() })),
      series: [{ id: 'curve', label: 'Curve', smooth: true, values: [1e-13, 4e-13, 2e-13, 5e-13] }],
    },
    options: {
      interpolate: 'monotone',
      phases: [
        { id: 'pa', label: 'A', from: 'a', to: 'a' },
        { id: 'pb', label: 'B', from: 'b', to: 'b' },
        { id: 'pc', label: 'C', from: 'c', to: 'c' },
        { id: 'pd', label: 'D', from: 'd', to: 'd' },
      ],
      title: 'Tiny magnitudes keep a continuous four-phase partition',
    },
  },
  {
    // 36 monthly YYYY-MM ticks, the line crossing AT the axis, a shown value
    // axis whose bottom tick sits exactly at the plot floor (authored min =
    // data min). The origin tick '2021-01' must stay clear of the y-axis label
    // column, on one baseline row with the origin start-anchored.
    id: 'monthly-origin-tick',
    title: 'Torture: 36 monthly ticks with the origin at the axis crossing',
    kind: 'torture',
    data: {
      categories: Array.from({ length: 36 }, (_, i) => {
        const id = `${2021 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
        return { id, label: id };
      }),
      series: [
        {
          id: 'rev',
          label: 'Net revenue (idx)',
          values: Array.from(
            { length: 36 },
            (_, i) => 100 + Math.round(Math.abs(20 * Math.sin(i / 5)) + i * 1.1),
          ),
        },
      ],
    },
    options: {
      // No numeral in the title on purpose: a numeric torture title would
      // be a new unfenced claim, and this fixture's subject is tick geometry, not a data claim.
      title: 'Indexed net revenue ends higher, after two dips',
      size: { width: 980, height: 551 },
      valueAxis: { show: true, min: 100 },
      categoryAxis: { crossesBetween: false },
      seriesLabels: 'none',
      valueLabels: 'none',
    },
  },
  {
    id: 'area-services-forecast',
    title: 'Area chart with an actual-to-forecast fill change',
    kind: 'example',
    data: {
      categories: ['FY23', 'FY24', 'FY25', 'FY26', 'FY27', 'FY28'].map((id) => ({ id })),
      series: [{
        id: 'managed',
        label: 'Managed services',
        values: [24, 28, 33, 39, { number: 46, scenario: 'FC' }, { number: 54, scenario: 'FC' }],
      }],
    },
    options: {
      variant: 'area',
      title: 'Managed service revenue is forecast to keep growing',
      subtitle: { measure: 'Revenue', period: 'FY23–FY28', scenarios: ['AC', 'FC'] },
      unit: 'USD m',
      valueAxis: { show: true },
      source: 'Illustrative service portfolio model; FY27 and FY28 are forecasts',
    },
  },
  {
    // An area over the shadings behind it: the corridor reads through the fill as a
    // mix, the era shade's edges cut through it, and the values on the fill take its ink.
    id: 'area-corridor-promotion',
    title: 'Area chart with a plan corridor and a promotion period behind the fill',
    kind: 'example',
    tags: ['annotation'],
    data: {
      categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((label) => ({ id: label.toLowerCase(), label })),
      series: [{ id: 'reservations', label: 'Reservations', values: [48, 51, 47, 53, 56, 63, 68, 66, 57, 54, 52, 58] }],
    },
    options: {
      variant: 'area',
      title: 'Reservations left the plan corridor only during the summer promotion',
      subtitle: { measure: 'Reservations', period: 'FY26 by month' },
      unit: 'k',
      valueLabels: 'extremes',
      valueAxis: { show: true },
      source: 'Illustrative reservations of a fictional travel company',
    },
    annotations: [
      { kind: 'band', id: 'plan', style: 'corridor', low: 45, high: 60, label: 'Plan corridor' },
      { kind: 'band', id: 'promotion', from: 'jun', to: 'aug', label: 'Promotion' },
    ],
  },
  {
    id: 'stacked100-area-revenue-forecast',
    title: 'Area 100% with hatched forecast shares',
    kind: 'example',
    data: {
      categories: ['FY23', 'FY24', 'FY25', 'FY26', 'FY27', 'FY28'].map((id) => ({ id })),
      series: [
        {
          id: 'subscriptions',
          label: 'Subscriptions',
          values: [60, 74, 89, 105, { number: 122, scenario: 'FC' }, { number: 140, scenario: 'FC' }],
        },
        {
          id: 'services',
          label: 'Services',
          values: [60, 61, 61, 60, { number: 60, scenario: 'FC' }, { number: 60, scenario: 'FC' }],
        },
      ],
    },
    options: {
      variant: 'stacked100-area',
      valueLabels: 'ends',
      title: 'Subscriptions are forecast to gain further revenue share',
      subtitle: { measure: 'Revenue share', period: 'FY23–FY28', scenarios: ['AC', 'FC'] },
      unit: '% of revenue',
      source: 'Illustrative portfolio model; FY27 and FY28 are forecasts',
    },
  },
  {
    id: 'stacked100-area-thin-interior-bands',
    title: 'Area 100% with thin middle periods and named outside endpoints',
    kind: 'example',
    data: {
      categories: ['FY23', 'FY24', 'FY25', 'FY26'].map((id) => ({ id })),
      series: [
        { id: 'established', label: 'Established', values: [72, 93, 88, 65] },
        { id: 'expansion', label: 'Expansion', values: [22, 4, 8, 26] },
        { id: 'pilot', label: 'Pilot', values: [6, 3, 4, 9] },
      ],
    },
    options: {
      variant: 'stacked100-area',
      seriesLabels: 'end',
      // The shares print at every year, so Pilot's thin band is read, not guessed.
      valueLabels: 'all',
      legend: 'auto',
      categoryAxis: { crossesBetween: false },
      title: 'Expansion gains share after two thin middle periods',
      subtitle: { measure: 'Revenue share', period: 'FY23–FY26' },
      unit: '% of revenue',
      source: 'Illustrative portfolio composition',
    },
  },
  {
    id: 'zoom-preserves-source-mean',
    title: 'Visible months retain the full-series mean',
    kind: 'torture', tags: ['interaction'],
    data: {
      categories: ['a', 'b', 'c', 'd', 'e'].map((id, index) => ({ id, label: `Month ${index + 1}` })),
      series: [{ id: 'revenue', label: 'Revenue', values: [20, 0, 40, 80, 95] }],
    },
    options: { title: 'Visible months retain the full-series mean', viewDomain: { x: ['b', 'd'] } },
    annotations: [{ kind: 'valueLine' }],
  },
  {
    id: 'live-window-preserves-source',
    title: 'Sampled live periods retain the source mean',
    kind: 'torture', tags: ['interaction'],
    data: {
      categories: Array.from({ length: 20 }, (_, index) => ({ id: `p${index}`, label: `Day ${index + 1}` })),
      series: [{ id: 'revenue', label: 'Revenue', values: [20, 10, 40, 60, 50, 45, 65, 12, 75, 56, 80, 60, 35, 70, 44, 90, 52, 61, 85, 75] }],
    },
    options: { title: 'The live window retains the full-series mean', valueAxis: { min: 0 }, window: { last: 12, decimate: 'minmax', maxPoints: 4 },
      annotations: [{ id: 'source-mean', kind: 'valueLine', value: 'mean', side: 'left' }] },
  },
  {
    // Above the point budget a plain line samples each series' min and max per bucket, and the subtitle says so.
    id: 'auto-decimated-days',
    title: 'Eight years of daily values sample to the width of the plot',
    kind: 'torture', tags: ['interaction'],
    data: longDailySeries(),
    options: { title: 'Daily visits, eight years', size: { width: 480 } },
  },
  {
    id: 'decimate-none-days',
    title: "decimate: 'none' draws every one of the daily values",
    kind: 'torture', tags: ['interaction', 'feature:options'],
    data: longDailySeries(),
    options: { title: 'Daily visits, eight years', size: { width: 480 }, window: { decimate: 'none' } },
  },
];

/** 2,920 invented daily values from 2018 on, a seeded random walk. */
function longDailySeries() {
  let seed = 11;
  let value = 400;
  const start = Date.UTC(2018, 0, 1);
  const categories = Array.from({ length: 2920 }, (_, i) => ({ id: `d${i}`, date: new Date(start + i * 86_400_000).toISOString().slice(0, 10) }));
  const values = categories.map(() => {
    seed = (seed * 16807) % 2147483647;
    value = Math.max(50, value + (seed / 2147483647 - 0.5) * 30);
    return Math.round(value);
  });
  return { categories, series: [{ id: 'visits', label: 'Visits', values }] };
}

// a theme's single area. marks.areaTint fills it in a pale tint of
// color.focus under a 1.5 px ink line, the forecast keeps its hatch, and
// marks.lineMarkers 'none' drops the point markers.
fixtures.push({
  id: 'area-focus-tint',
  title: 'A single area in a pale tint of the focus under an ink line, the forecast hatched',
  kind: 'example',
  tags: ['feature:options'],
  data: {
    categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((label) => ({ id: label.toLowerCase(), label })),
    series: [
      {
        id: 'revenue',
        label: 'Net revenue',
        values: [11.2, 11.6, 11.1, 12.0, 12.4, 12.1, 12.9, 13.4, 13.1, { number: 13.6, scenario: 'FC' }, { number: 14.0, scenario: 'FC' }, { number: 14.3, scenario: 'FC' }],
      },
    ],
  },
  options: {
    variant: 'area',
    theme: { preset: 'boardroom', overrides: { color: { focus: '#0D2A43' }, marks: { areaTint: 0.86, lineMarkers: 'none' } } },
    title: 'Revenue climbs through the year and the forecast holds the pace',
    subtitle: { measure: 'Net revenue per month', period: 'FY26', scenarios: ['AC', 'FC'] },
    unit: '$m',
    source: 'Illustrative demand data',
  },
});

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
        { id: 'defects', label: 'Defects', unit: 'units', values: [8, 6, 7, 4] },
        { id: 'inspected', label: 'Inspected', unit: 'units', values: [100, 110, 120, 120] },
      ],
    },
    options: {
      size: { width: 960, height: 520 },
      title: 'Defects fall relative to inspected units',
      source: 'Illustrative data',
      // Defects is the subject; the inspected base is context.
      emphasis: 'first',
      ratioTier: {
        id: 'defect-rate',
        label: 'Defect rate',
        numeratorSeriesId: 'defects',
        denominatorSeriesId: 'inspected',
        at: ['q1', 'q2', 'q3', 'q4'],
        format: '88%',
        direction: 'lowerIsBetter',
      },
      legend: 'none',
    },
  },
);

fixtures.push(
  {
    id: 'option-lower-bump',
    title: 'Delivery-time ranks reward shorter waits',
    kind: 'torture',
    tags: ['feature:options'],
    data: {
      categories: [
        { id: 'q1', label: 'Q1' },
        { id: 'q2', label: 'Q2' },
        { id: 'q3', label: 'Q3' },
        { id: 'q4', label: 'Q4' },
      ],
      series: [
        { id: 'east', label: 'East', values: [4, 3, 5, 2], interpolateGaps: false },
        { id: 'west', label: 'West', values: [6, 5, 3, 4], interpolateGaps: false },
      ],
    },
    options: {
      size: { width: 960, height: 520 },
      title: 'Delivery-time ranks reward shorter waits',
      source: 'Illustrative data',
      variant: 'bump',
      bump: { direction: 'lowerIsBetter' },
      subtitle: { measure: 'Delivery time, days' },
    },
  },
  {
    id: 'option-step-before-extremes',
    title: 'Capacity changes at quarter boundaries',
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
      ],
      series: [{ id: 'capacity', label: 'Capacity', values: [20, 30, 25, 40, 35, 45] }],
    },
    options: {
      size: { width: 960, height: 520 },
      title: 'Capacity changes at quarter boundaries',
      source: 'Illustrative data',
      interpolate: 'step-before',
      seriesLabels: 'end',
      valueLabels: 'extremes',
      labels: { point: ['category', 'absolute'] },
    },
  },
  {
    id: 'option-phase-tones',
    title: 'Cycle time across five operating phases',
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
        { id: 'q9', label: 'Q9' },
        { id: 'q10', label: 'Q10' },
      ],
      series: [{ id: 'time', label: 'Cycle time', values: [12, 11, 10, 9, 7, 6, 9, 10, 8, 7] }],
    },
    options: {
      size: { width: 960, height: 520 },
      title: 'Cycle time across five operating phases',
      source: 'Illustrative data',
      phases: [
        { id: 'p0', label: 'Baseline', from: 'q1', to: 'q2', tone: 'neutral' },
        { id: 'p1', label: 'Trial', from: 'q3', to: 'q4', tone: 'highlight' },
        { id: 'p2', label: 'Improved', from: 'q5', to: 'q6', tone: 'good' },
        { id: 'p3', label: 'Disruption', from: 'q7', to: 'q8', tone: 'bad' },
        { id: 'p4', label: 'Watch', from: 'q9', to: 'q10', tone: 'warn' },
      ],
      unit: 'days',
    },
  },
  {
    id: 'option-cost-gap',
    title: 'Operating cost compared with budget',
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
        { id: 'cost', label: 'Cost', values: [22, 28, 24, 32] },
        { id: 'budget', label: 'Budget', values: [25, 25, 27, 27], scenario: 'PL' },
      ],
    },
    options: {
      size: { width: 960, height: 520 },
      title: 'Operating cost compared with budget',
      source: 'Illustrative data',
      subtitle: { measure: 'Operating cost', scenarios: ['AC', 'PL'] },
      gapFill: { between: ['cost', 'budget'], positiveTone: 'bad', negativeTone: 'good' },
      unit: '$k',
    },
  },
  {
    id: 'option-neutral-gap',
    title: 'Operating cost compared with budget',
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
        { id: 'cost', label: 'Cost', values: [22, 28, 24, 32] },
        { id: 'budget', label: 'Budget', values: [25, 25, 27, 27], scenario: 'PL' },
      ],
    },
    options: {
      size: { width: 960, height: 520 },
      title: 'Operating cost compared with budget',
      source: 'Illustrative data',
      subtitle: { measure: 'Operating cost', scenarios: ['AC', 'PL'] },
      gapFill: { between: ['cost', 'budget'], positiveTone: 'neutral', negativeTone: 'neutral' },
      unit: '$k',
    },
  },
  // on a dark page the wash steps surface.gapTint's dark default (0.65) toward the page.
  {
    id: 'option-cost-gap-dark',
    title: 'Operating cost compared with budget on a dark page',
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
        { id: 'cost', label: 'Cost', values: [22, 28, 24, 32] },
        { id: 'budget', label: 'Budget', values: [25, 25, 27, 27], scenario: 'PL' },
      ],
    },
    options: {
      size: { width: 960, height: 520 },
      title: 'Operating cost compared with budget',
      source: 'Illustrative data',
      subtitle: { measure: 'Operating cost', scenarios: ['AC', 'PL'] },
      gapFill: { between: ['cost', 'budget'], positiveTone: 'bad', negativeTone: 'good' },
      unit: '$k',
      theme: 'standard-dark',
    },
  },
);

fixtures.push(
  {
    id: "shared-trajectory-milestones-1",
    title: "Operating milestones beside the measured trajectory",
    kind: "example",
    data: fixtures.find((fixture) => fixture.id === 'trajectory-highlights')!.data,
    annotations: [
      {
        kind: "callout",
        id: "milestone-people",
        at: {
          categoryId: "q2",
          seriesId: "north"
        },
        text: "Regional team hired",
        icon: "people",
        preferSide: "above"
      },
      {
        kind: "callout",
        id: "milestone-conversation",
        at: {
          categoryId: "q5",
          seriesId: "east"
        },
        text: "Partner talks begin",
        icon: "conversation",
        preferSide: "right"
      },
      {
        kind: "callout",
        id: "milestone-workflow",
        at: {
          categoryId: "q8",
          seriesId: "core"
        },
        text: "Service workflow expands",
        icon: "workflow",
        preferSide: "left"
      }
    ],
    options: {
      title: "Operating milestones accompany regional growth",
      subtitle: {
        measure: "Indexed trajectory",
        period: "Q1–Q9"
      },
      seriesLabels: 'end',
      valueLabels: 'last',
      valueAxis: {
        show: true,
        gridlines: true
      },
      size: "slide-16x9",
      source: "Illustrative operating trajectory"
    },
    tags: [
      "shared-options",
      "annotation"
    ]
  },
  {
    id: "shared-trajectory-milestones-2",
    title: "Operating milestones beside the measured trajectory",
    kind: "torture",
    data: fixtures.find((fixture) => fixture.id === 'trajectory-highlights')!.data,
    annotations: [
      {
        kind: "callout",
        id: "milestone-document",
        at: {
          categoryId: "q2",
          seriesId: "north"
        },
        text: "Operating plan approved",
        icon: "document",
        preferSide: "above"
      },
      {
        kind: "callout",
        id: "milestone-gear",
        at: {
          categoryId: "q5",
          seriesId: "east"
        },
        text: "Automation goes live",
        icon: "gear",
        preferSide: "right"
      },
      {
        kind: "callout",
        id: "milestone-calendar",
        at: {
          categoryId: "q8",
          seriesId: "core"
        },
        text: "Quarterly review completed",
        icon: "calendar",
        preferSide: "left"
      }
    ],
    options: {
      title: "Operating milestones accompany regional growth",
      subtitle: {
        measure: "Indexed trajectory",
        period: "Q1–Q9"
      },
      seriesLabels: 'end',
      valueLabels: 'last',
      valueAxis: {
        show: true,
        gridlines: true
      },
      size: "slide-16x9",
      source: "Illustrative operating trajectory"
    },
    tags: [
      "shared-options",
      "annotation"
    ]
  },
  {
    id: "shared-trajectory-milestones-3",
    title: "Operating milestones beside the measured trajectory",
    kind: "torture",
    data: fixtures.find((fixture) => fixture.id === 'trajectory-highlights')!.data,
    annotations: [
      {
        kind: "callout",
        id: "milestone-check",
        at: {
          categoryId: "q2",
          seriesId: "north"
        },
        text: "Launch checks passed",
        icon: "check",
        preferSide: "above"
      },
      {
        kind: "callout",
        id: "milestone-alert",
        at: {
          categoryId: "q5",
          seriesId: "east"
        },
        text: "Capacity risk reviewed",
        icon: "alert",
        preferSide: "right"
      },
      {
        kind: "callout",
        id: "milestone-star",
        at: {
          categoryId: "q8",
          seriesId: "core"
        },
        text: "Service milestone reached",
        icon: "star",
        preferSide: "left"
      }
    ],
    options: {
      title: "Operating milestones accompany regional growth",
      subtitle: {
        measure: "Indexed trajectory",
        period: "Q1–Q9"
      },
      seriesLabels: 'end',
      valueLabels: 'last',
      valueAxis: {
        show: true,
        gridlines: true
      },
      size: "slide-16x9",
      source: "Illustrative operating trajectory"
    },
    tags: [
      "shared-options",
      "annotation"
    ]
  },
  {
    id: "shared-trajectory-review-1",
    title: "Authored review status beside measured trajectories",
    kind: "example",
    data: fixtures.find((fixture) => fixture.id === 'trajectory-highlights')!.data,
    annotations: [
      {
        kind: "callout",
        id: "review-good",
        at: {
          categoryId: "q2",
          seriesId: "north"
        },
        text: "Target reached",
        status: "good",
        preferSide: "above"
      },
      {
        kind: "callout",
        id: "review-bad",
        at: {
          categoryId: "q8",
          seriesId: "core"
        },
        text: "Review missed",
        status: "bad",
        preferSide: "left"
      }
    ],
    options: {
      title: "Review decisions accompany regional growth",
      subtitle: {
        measure: "Indexed trajectory",
        period: "Q1–Q9"
      },
      seriesLabels: 'end',
      valueLabels: 'last',
      valueAxis: {
        show: true,
        gridlines: true
      },
      size: "slide-16x9",
      source: "Illustrative trajectories; status labels are authored review judgments"
    },
    tags: [
      "shared-options",
      "annotation"
    ]
  },
  {
    id: "shared-trajectory-review-2",
    title: "Authored review status beside measured trajectories",
    kind: "torture",
    data: fixtures.find((fixture) => fixture.id === 'trajectory-highlights')!.data,
    annotations: [
      {
        kind: "callout",
        id: "review-warn",
        at: {
          categoryId: "q2",
          seriesId: "north"
        },
        text: "Capacity risk",
        status: "warn",
        preferSide: "above"
      },
      {
        kind: "callout",
        id: "review-info",
        at: {
          categoryId: "q8",
          seriesId: "core"
        },
        text: "Review scheduled",
        status: "info",
        preferSide: "left"
      }
    ],
    options: {
      title: "Review decisions accompany regional growth",
      subtitle: {
        measure: "Indexed trajectory",
        period: "Q1–Q9"
      },
      seriesLabels: 'end',
      valueLabels: 'last',
      valueAxis: {
        show: true,
        gridlines: true
      },
      size: "slide-16x9",
      source: "Illustrative trajectories; status labels are authored review judgments"
    },
    tags: [
      "shared-options",
      "annotation"
    ]
  },
  {
    id: "shared-recession-period-bands",
    title: "Period annotations separate the starting quarter, recession and recovery",
    kind: "example",
    data: fixtures.find((fixture) => fixture.id === 'recession-era-band')!.data,
    options: {
      title: "Orders recover above capacity after the recession trough",
      subtitle: {
        measure: "Indexed volume",
        period: "Q1 2024–Q2 2025"
      },
      valueAxis: {
        show: true,
        gridlines: true
      },
      emphasis: "first",
      valueLabels: "none",
      source: "Illustrative indexed orders; bands identify the starting quarter, recession and recovery"
    },
    annotations: [
      {
        kind: "band",
        id: "starting-quarter",
        from: "q1-24",
        to: "q1-24",
        label: "Start",
        tone: "neutral",
        style: "shade",
        divider: false
      },
      {
        kind: "band",
        id: "recession",
        from: "q2-24",
        to: "q3-24",
        label: "Recession",
        tone: "neutral",
        style: "bracket",
        divider: "start"
      },
      {
        kind: "band",
        id: "recovery",
        from: "q4-24",
        to: "q2-25",
        label: "Recovery",
        tone: "neutral",
        style: "bracket",
        divider: "both"
      }
    ],
    tags: [
      "shared-options",
      "annotation"
    ]
  },
  {
    id: 'tolerance-band',
    title: 'Tolerance band around a 90 indexed target',
    kind: 'example',
    tags: ['annotation'],
    data: {
      categories: [
        { id: 'q1', label: 'Q1' },
        { id: 'q2', label: 'Q2' },
        { id: 'q3', label: 'Q3' },
        { id: 'q4', label: 'Q4' },
      ],
      series: [{ id: 'volume', label: 'Volume', values: [86, 91, 88, 97] }],
    },
    options: {
      title: 'Volume exceeds the tolerance band in Q4',
      subtitle: { measure: 'Indexed volume', period: 'FY25' },
      source: 'Illustrative tolerance band',
      strings: { valueLineRange: '{v1}–{v2}' },
    },
    annotations: [
      { kind: 'valueLine', id: 'target', value: 90, label: 'Target', side: 'left', tolerance: 5 },
    ],
  },
  {
    id: 'two-series-level-diff',
    title: 'Multi-series line with last-period difference and series CAGR',
    kind: 'example',
    data: {
      categories: [
        { id: 'fy21', label: 'FY21', date: '2021-12-31' },
        { id: 'fy22', label: 'FY22', date: '2022-12-31' },
        { id: 'fy23', label: 'FY23', date: '2023-12-31' },
        { id: 'fy24', label: 'FY24', date: '2024-12-31' },
      ],
      series: [
        { id: 'cloud', label: 'Cloud', colorRole: 'highlight', values: [100, 130, 160, 200] },
        { id: 'license', label: 'License', values: [124, 118, 109, 97] },
      ],
    },
    options: {
      variant: 'line',
      title: 'Cloud overtakes license by FY24',
      subtitle: { measure: 'Revenue', period: 'FY21–FY24' },
      unit: '$m',
      source: 'Illustrative accounts',
      valueAxis: { show: true },
    },
    annotations: [
      {
        kind: 'cagr',
        from: { categoryId: 'fy21', seriesId: 'cloud' },
        to: { categoryId: 'fy24', seriesId: 'cloud' },
      },
      {
        kind: 'diff',
        mode: 'absolute',
        from: { categoryId: 'fy24', seriesId: 'license' },
        to: { categoryId: 'fy24', seriesId: 'cloud' },
      },
    ],
  },
);

/**
 * Representative fixture for the public `options.focus`: a two-series line
 * with the focus on one series. Focus only reorders label priority within a
 * band, so this renders clean and proves schema, type and fixture agree.
 */
const focusFixture: LineFixture = {
  id: 'focus-active-series',
  title: 'Focused series: Beta labels gain solver priority',
  kind: 'example',
  tags: ['shared-options'],
  data: {
    categories: [
      { id: 'q1', label: 'Q1' }, { id: 'q2', label: 'Q2' },
      { id: 'q3', label: 'Q3' }, { id: 'q4', label: 'Q4' },
    ],
    series: [
      { id: 'alpha', label: 'Alpha', values: [12, 15, 14, 18] },
      { id: 'beta', label: 'Beta', values: [9, 13, 17, 21] },
    ],
  },
  options: { title: 'Beta labels gain priority while values remain unchanged', focus: { owner: { seriesId: 'beta' } } },
};

// A dashboard slot 380px wide: 240px of height keeps a readable plot band.
fixtures.push({
  id: 'line-compact-380',
  title: 'Line in a 380px dashboard column',
  kind: 'example',
  data: {
    categories: [
      { id: 'jan', label: 'Jan' }, { id: 'feb', label: 'Feb' }, { id: 'mar', label: 'Mar' },
      { id: 'apr', label: 'Apr' }, { id: 'may', label: 'May' }, { id: 'jun', label: 'Jun' },
    ],
    series: [{ id: 'orders', label: 'Orders', values: [1180, 1240, 1195, 1310, 1402, 1488] }],
  },
  options: {
    title: 'Orders climbed 26 percent since January',
    unit: 'orders',
    // The title compares January with June, so both print.
    valueLabels: 'ends',
    size: { width: 380, height: 240 },
  },
});

/**
 * Three channels decay and are switched off in W6. Each ends at
 * 0.00, so they share one end label instead of stacking three statements of
 * the same number in the gutter. The two live channels keep their own labels.
 * Only last values that print the same text share a label: tails of
 * 0.004 and 0.002 print their own digits and keep their own labels.
 */
const nearZeroTailsFixture: LineFixture = {
  id: 'line-near-zero-tails',
  title: 'Near-zero tails share one end label',
  kind: 'example',
  data: {
    categories: [
      { id: 'w1', label: 'W1' }, { id: 'w2', label: 'W2' },
      { id: 'w3', label: 'W3' }, { id: 'w4', label: 'W4' },
      { id: 'w5', label: 'W5' }, { id: 'w6', label: 'W6' },
    ],
    series: [
      { id: 'search', label: 'Search', values: [18.2, 19.4, 21.1, 22.6, 24.3, 25.8] },
      { id: 'paid', label: 'Paid social', values: [11.6, 10.9, 9.8, 9.1, 8.4, 7.9] },
      { id: 'inbox', label: 'Inbox', values: [3.4, 2.1, 1.2, 0.5, 0.2, 0] },
      { id: 'newsfeed', label: 'Newsfeed', values: [2.8, 1.6, 0.9, 0.4, 0.1, 0] },
      { id: 'owned', label: 'Owned', values: [1.9, 1.1, 0.6, 0.3, 0.1, 0] },
    ],
  },
  options: {
    variant: 'line',
    title: 'Search carries the mix while three channels fade out',
    subtitle: { measure: 'Sessions', period: 'W1-W6' },
    unit: 'm',
    source: 'Illustrative traffic report',
    highlight: 'search',
    valueAxis: { show: true },
  },
};

/** The running week's markers are hollow and the frame footnote names it. */
const partialWeekFixture: LineFixture = {
  id: 'line-partial-week',
  title: 'Weekly conversion with the running week marked partial',
  kind: 'example',
  data: {
    categories: [
      { id: 'w31', label: 'W31' }, { id: 'w32', label: 'W32' },
      { id: 'w33', label: 'W33' }, { id: 'w34', label: 'W34' },
      { id: 'w35', label: 'W35' }, { id: 'w36', label: 'W36' },
      { id: 'w37', label: 'W37' }, { id: 'w38', label: 'W38', partial: true },
    ],
    series: [
      { id: 'app', label: 'App', values: [3.1, 3.2, 3.4, 3.3, 3.6, 3.7, 3.9, 3.5] },
      { id: 'web', label: 'Web', values: [2.4, 2.3, 2.4, 2.5, 2.4, 2.6, 2.5, 2.2] },
    ],
  },
  options: {
    variant: 'line',
    title: 'App conversion pulls away from web',
    subtitle: { measure: 'Conversion rate', period: 'W31-W38' },
    unit: '%',
    source: 'Illustrative data',
  },
};

/**
 * a line inside a host's card, which draws the title, the unit and
 * the notes itself. The chart prints none of them: `footnotes: false` also
 * leaves off the "Jun partial" note the engine derives (the info lint
 * `footnotes-off` names it for the card), and without a subtitle the unit
 * rides the end label, after a space: "44 USD m".
 */
const hostCardFixture: LineFixture = {
  id: 'line-host-card',
  title: 'A line inside a host card that draws its own title and notes',
  kind: 'torture',
  data: {
    categories: [
      { id: 'jan', label: 'Jan' }, { id: 'feb', label: 'Feb' }, { id: 'mar', label: 'Mar' },
      { id: 'apr', label: 'Apr' }, { id: 'may', label: 'May' }, { id: 'jun', label: 'Jun', partial: true },
    ],
    series: [{ id: 'managed', label: 'Managed services', values: [31, 34, 36, 39, 42, 44] }],
  },
  options: {
    title: false,
    unit: 'USD m',
    footnotes: false,
    valueAxis: { show: true },
    size: { width: 480, height: 270 },
  },
};

// Long names at a generous size read whole: the rendered SVG has no ellipsis.
fixtures.push({
  id: 'torture-long-labels',
  title: 'Torture: long names at a generous size read whole, never cut',
  kind: 'torture',
  data: {
    categories: [
      {
        id: 'y2000',
        label: 'Enterprise cloud infrastructure, managed hosting and sovereign data-centre services for regulated clients',
      },
      {
        id: 'y2001',
        label: 'Consumer electronics, wearables and connected home devices sold through retail partners',
      },
      {
        id: 'y2002',
        label: 'Industrial automation, robotics and predictive maintenance contracts in continental Europe',
      },
      {
        id: 'y2003',
        label: 'Healthcare diagnostics, laboratory information systems and point-of-care testing',
      },
      {
        id: 'y2004',
        label: 'Wealth management, private banking and family-office advisory for entrepreneurs',
      },
      {
        id: 'y2005',
        label: 'Retail deposits and everyday current accounts for households and sole traders',
      },
    ],
    series: [
      {
        id: 'capacity',
        label: 'Capacity',
        colorRole: 'series-1',
        values: [92, 94, 96, 98, 100, 102],
      },
      {
        id: 'production',
        label: 'Production',
        colorRole: 'series-2',
        values: [64, 68, 72, 77, 82, 86],
      },
      { id: 'demand', label: 'Demand', colorRole: 'series-3', values: [48, 52, 57, 62, 66, 70] },
    ],
  },
  options: {
    variant: 'line',
    // Names at the line ends; inline they would sit on the strokes.
    seriesLabels: 'end',
    title: 'Long names read whole at a generous size',
    subtitle: { measure: 'Capacity, Production and Demand', period: '2000–2013', scenarios: ['AC', 'FC'] },
    unit: 'million tonnes',
    valueAxis: { show: true, min: 40 },
    source: 'Illustrative market model',
    size: { width: 1440, height: 900 },
  },
});

/**
 * A cell that carries its own label. The running week is marked
 * `label: false`, so the series end label comes off the point that is still
 * filling, and the last complete week carries the value the reader should
 * read instead.
 */
const cellLabelFixture: LineFixture = {
  id: 'line-cell-label-on-last-complete-week',
  title: 'The end label moves off the running week onto the last complete one',
  kind: 'example',
  data: {
    categories: [
      { id: 'w0', label: '2 Aug' }, { id: 'w1', label: '9 Aug' },
      { id: 'w2', label: '16 Aug' }, { id: 'w3', label: '23 Aug' },
      { id: 'w4', label: '30 Aug' }, { id: 'w5', label: '6 Sep' },
      { id: 'w6', label: '13 Sep', partial: true },
    ],
    series: [
      {
        id: 'coverage',
        label: 'Coverage',
        colorRole: 'highlight',
        values: [98.6, 98.4, 96.7, 98.4, 99.4, { number: 99.8, label: 'Coverage ${value}' }, { number: 100, label: false }],
      },
    ],
  },
  options: {
    variant: 'line',
    title: 'Postcode coverage holds through the last complete week',
    subtitle: { measure: 'Share of orders with a postcode', period: '7 weeks' },
    unit: '%',
    valueLabels: 'last',
    valueAxis: { show: true },
    source: 'Illustrative data',
  },
};

/**
 * A year-over-year line as a dashboard draws it. The current series is 1.5 px
 * in the ink and the prior year 1 px in the muted ink, the last observed
 * point of the current series takes the highlight ring, and the months that
 * are still open sit behind a shaded band (the band is the shared
 * annotation, not an option of its own).
 */
const briefLineFixture: LineFixture = {
  id: 'brief-current-vs-prior',
  title: 'Current year at 1.5 px in the ink, prior year at 1 px muted, ring on the latest point',
  kind: 'example',
  data: {
    categories: [
      { id: 'jan', label: 'Jan' }, { id: 'feb', label: 'Feb' }, { id: 'mar', label: 'Mar' },
      { id: 'apr', label: 'Apr' }, { id: 'may', label: 'May' }, { id: 'jun', label: 'Jun' },
      { id: 'jul', label: 'Jul' }, { id: 'aug', label: 'Aug' }, { id: 'sep', label: 'Sep' },
      { id: 'oct', label: 'Oct' }, { id: 'nov', label: 'Nov' }, { id: 'dec', label: 'Dec' },
    ],
    series: [
      {
        id: 'ac', label: 'FY26', scenario: 'AC',
        values: [11.2, 11.6, 11.1, 12.0, 12.4, 12.1, 12.9, 13.4, 13.1, null, null, null],
      },
      {
        id: 'py', label: 'FY25', scenario: 'PY',
        values: [10.1, 10.4, 10.6, 10.9, 11.2, 11.0, 11.6, 12.1, 11.9, 12.3, 12.8, 13.4],
      },
    ],
  },
  options: {
    // A 1 px prior-year line is the usual choice; the engine's own legibility
    // norm floors a series stroke at 1.25 effective px and warns under it
    // (`mark-below-effective-min`). The shipped fixture draws the floor, the
    // option still accepts 1 and the lint then says so.
    scenarioStyle: { AC: { width: 1.5, ink: 'ink' }, PY: { width: 1.25, ink: 'inkMuted' } },
    latestPoint: 'ring',
    annotations: [{ kind: 'band', from: 'oct', to: 'dec', label: 'Open', tone: 'muted' }],
    size: { width: 720, height: 405 },
    title: 'Revenue holds its lead over the prior year into the open quarter',
    subtitle: { measure: 'Revenue per month', period: 'FY26', scenarios: ['AC', 'PY'] },
    unit: '$m',
    source: 'Illustrative demand data',
  },
};

/**
 * the axis and label conventions set once in a theme, not per
 * chart. The theme derives the value-axis title from the subtitle measure
 * and the unit, starts the axis at zero, and names the trial cohort, which
 * ends in April, beside its last point.
 */
const themeConventionsFixture: Fixture<LineChartData, LineOptions> = {
  id: 'theme-axis-conventions',
  title: 'A theme titles the value axis, starts it at zero and names an early line end at its point',
  kind: 'example',
  tags: ['feature:theme'],
  data: {
    categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'].map((label) => ({ id: label.toLowerCase(), label })),
    series: [
      { id: 'core', label: 'Core plan', unit: 'k', values: [42, 44, 47, 49, 52, 55, 57, 60] },
      { id: 'trial', label: 'Trial', unit: 'k', values: [30, 34, 37, 39, null, null, null, null] },
    ],
  },
  options: {
    theme: { preset: 'standard', overrides: { valueAxis: { titles: true, includeZero: true }, labels: { endLabelPlacement: 'lineEnd' } } },
    valueAxis: { show: true, gridlines: true },
    title: 'Core plan subscribers keep growing after the trial closed',
    subtitle: { measure: 'Active subscribers', period: 'Jan–Aug' },
    legend: 'none',
    source: 'Illustrative subscription data',
  },
};

/**
 * A theme starts the bands at the value axis
 * (`marks.areaFromOrigin`); the forecast bands keep their fill under the
 * page-colour hatch.
 */
const areaFromOriginFixture: Fixture<LineChartData, LineOptions> = {
  id: 'stacked-area-from-origin',
  title: 'A theme starts the stacked bands at the value axis; forecast bands keep their fill under the hatch',
  kind: 'example',
  tags: ['feature:theme'],
  data: {
    categories: [
      { id: 'y2018', label: '2018' },
      { id: 'y2022', label: '2022' },
      { id: 'y2030', label: '2030F' },
      { id: 'y2034', label: '2034F' },
      { id: 'y2038', label: '2038F' },
    ],
    series: [
      { id: 'managed', label: 'Managed services', values: [8, 14, { number: 24, scenario: 'FC' }, { number: 31, scenario: 'FC' }, { number: 38, scenario: 'FC' }] },
      { id: 'implementation', label: 'Implementation', values: [12, 15, { number: 18, scenario: 'FC' }, { number: 19, scenario: 'FC' }, { number: 20, scenario: 'FC' }] },
      { id: 'consulting', label: 'Consulting', values: [9, 10, { number: 12, scenario: 'FC' }, { number: 12, scenario: 'FC' }, { number: 13, scenario: 'FC' }] },
      { id: 'bpo', label: 'BPO', values: [3, 4, { number: 6, scenario: 'FC' }, { number: 7, scenario: 'FC' }, { number: 9, scenario: 'FC' }] },
    ],
  },
  options: {
    theme: { preset: 'standard', overrides: { marks: { areaFromOrigin: true } } },
    variant: 'stacked-area',
    valueAxis: { show: true },
    title: 'Managed services drive three-fifths of the growth to 2038',
    subtitle: { measure: 'Services revenue', period: '2018–2038, AC FC' },
    unit: 'USD m',
    size: { width: 800, height: 450 },
    source: 'Illustrative strategy plan',
  },
};

// The host prints the unit beside the card (options.unitShown), so the end
// label is the value alone: "44".
const hostCardUnitShownFixture: LineFixture = {
  ...hostCardFixture,
  kind: 'torture', id: 'line-host-card-unit-shown',
  title: 'A line inside a host card that also prints the unit',
  options: { ...hostCardFixture.options!, unitShown: true },
};

// A hero line on a dark theme whose data marks take their own ink
// (color.markInk); axes and labels keep the text ink.
const recessionBand = fixtures.find((fixture) => fixture.id === 'recession-era-band')!;
const markInkFixture: LineFixture = {
  ...recessionBand,
  id: 'recession-era-band-mark-ink',
  title: 'A hero line in the mark ink, apart from the text ink',
  tags: ['theme'],
  options: {
    ...recessionBand.options!,
    theme: { preset: 'standard-dark', overrides: { color: { markInk: '#B8CCFF' } } },
  },
};

// The event lane over a line: poles run on as dotted hairlines behind the
// data; the second chart numbers every event into the key.
const weeklyConversion: LineChartData = {
  categories: weeklyEventCategories(false),
  series: [
    { id: 'cr', label: 'Conversion rate', colorRole: 'highlight' as const, values: WEEKLY_CONVERSION },
    { id: 'py', label: 'Prior year', scenario: 'PY' as const, values: WEEKLY_CONVERSION_PY },
  ],
};
const weeklyConversionOptions = {
  title: 'Conversion falls below prior year during the stock-outs and recovers after the launches',
  subtitle: { measure: 'Conversion rate', period: 'W27–W39 2026' },
  unit: '%',
  format: '1.00',
  valueAxis: { show: true },
  source: 'Shop analytics',
  size: { width: 960, height: 540 },
};
const weeklyEventsLineFixture: LineFixture = {
  id: 'weekly-events-lane',
  title: 'Event lane over a weekly line: dotted rules behind the data, the rest numbered in the key',
  kind: 'example',
  data: weeklyConversion,
  annotations: WEEKLY_EVENTS,
  options: { ...weeklyConversionOptions, events: { groups: EVENT_GROUPS } },
};
const eventsKeyLineFixture: LineFixture = {
  id: 'events-key-only',
  title: 'Event key only on a line: numbered markers in time order',
  kind: 'example',
  data: weeklyConversion,
  annotations: [...WEEKLY_EVENTS, ...WEEKLY_EVENTS_MORE],
  // At 960 x 679: with the key of all nine events the 16:9 slide leaves the
  // plot under its 160 px floor and warns.
  options: { ...weeklyConversionOptions, size: { width: 960, height: 679 }, events: { placement: 'key', groups: EVENT_GROUPS_ALL } },
};
// Column's anomaly rule on a line. Median 1,212.5, MAD 14, so the
// corridor at k = 3.5 runs 1,139.9 to 1,285.1 and two weeks fall outside.
const anomalyLineFixture: LineFixture = {
  id: 'weekly-orders-anomalies',
  title: 'Two weeks break out of the normal order range (anomaly on a line)',
  kind: 'example',
  data: {
    categories: Array.from({ length: 20 }, (_, week) => ({ id: `w${week + 1}`, label: `W${week + 1}` })),
    series: [{
      id: 'orders',
      label: 'Orders',
      values: [1180, 1215, 1203, 1190, 1228, 1197, 1210, 1502, 1221, 1205, 1188, 1232, 1216, 1199, 942, 1224, 1208, 1236, 1219, 1241],
    }],
  },
  options: {
    anomaly: { method: 'mad', baseline: 'median' },
    title: 'Two weeks break out of the normal order range',
    subtitle: { measure: 'Orders', period: 'W1 to W20 2026' },
    format: '1,234',
    source: 'Illustrative order data',
    size: { width: 960, height: 540 },
  },
};
// Coverage: the anomaly bounds and threshold, the event lane rows and key title,
// a rebase category and chart-level targets.
const indexedPeers = fixtures.find((fixture) => fixture.id === 'rebase100-indexed-peers')!;
const regionsRamp = fixtures.find((fixture) => fixture.id === 'peer-regions-ramp')!;
const cohortLineEnd = cohortLineFixtures.find((fixture) => fixture.id === 'cohort-curves-line-end')!;
const coverageLineFixtures: LineFixture[] = [
  {
    ...cohortLineEnd,
    id: 'cohort-curves-gutter',
    title: 'Every end label in the column right of the plot, with a leader',
    tags: ['coverage'],
    options: { ...cohortLineEnd.options, endLabelPlacement: 'gutter' },
  },
  {
    ...anomalyLineFixture,
    id: 'orders-threshold-corridor',
    title: 'Authored anomaly bounds with a named rule instead of the MAD corridor',
    tags: ['coverage'],
    options: { ...anomalyLineFixture.options, anomaly: { method: 'threshold', low: 1100, high: 1400, label: 'Capacity plan' } },
  },
  {
    ...anomalyLineFixture,
    id: 'orders-strict-k',
    title: 'The MAD rule with a stricter k of 5',
    tags: ['coverage'],
    options: { ...anomalyLineFixture.options, anomaly: { method: 'mad', baseline: 'median', k: 5 } },
  },
  {
    ...weeklyEventsLineFixture,
    id: 'conversion-events-key-title',
    title: 'Events as numbered markers only, keyed under an authored heading',
    tags: ['coverage'],
    options: {
      ...weeklyEventsLineFixture.options,
      events: { ...weeklyEventsLineFixture.options!.events!, rows: 0, keyTitle: 'Stock and launch events' },
      size: { width: 960, height: 681 },
    },
  },
  {
    ...indexedPeers,
    id: 'indexed-peers-from-q3',
    title: 'Each series indexed to 100 at the third quarter instead of the first',
    kind: 'example',
    tags: ['coverage'],
    options: {
      ...indexedPeers.options,
      rebase100: { at: 'q3' },
      title: 'Since Q3 24 we outperform both peers by 25+ points',
      subtitle: { measure: 'Total shareholder return', period: 'Q1 24–Q2 25, indexed to Q3 24 = 100' },
    },
  },
  {
    ...regionsRamp,
    id: 'regions-ramp-target',
    title: 'A chart-level target marker on one series',
    tags: ['coverage'],
    options: {
      ...regionsRamp.options,
      targets: [{ seriesId: 'south', at: 'd2', value: 70, label: 'South target 70%' }],
      title: 'South responses reach 62% by day two, short of the 70% target',
    },
    annotations: [{ kind: 'abs', at: { categoryId: 'd2', seriesId: 'south' } }],
  },
];
// a labelled benchmark inside the stack. The canvas margin is too
// narrow for the label and the bands cover the inside seats, so the chart
// keeps the right margin the label needs.
const stackedAreaBenchmarkFixture: LineFixture = {
  id: 'stacked-area-benchmark',
  title: 'A labelled benchmark across stacked areas',
  kind: 'example',
  data: {
    categories: ['jan', 'feb', 'mar', 'apr', 'may', 'jun'].map((id) => ({ id, label: id[0]!.toUpperCase() + id.slice(1) })),
    series: [
      { id: 'new', label: 'New customers', values: [42, 45, 48, 51, 50, 55] },
      { id: 'returning', label: 'Returning', values: [60, 62, 61, 66, 70, 72] },
    ],
  },
  options: {
    variant: 'stacked-area',
    title: 'Orders run above the benchmark in every month',
    subtitle: { measure: 'Orders', period: 'H1' },
    source: 'Synthetic monthly orders',
  },
  annotations: [{ kind: 'valueLine', value: 100, label: 'Benchmark' }],
};
// a Rest series (colorRole 'others') in a stack. Its values print on
// every target but the dashboard, where the hover card and the note carry them.
const stackedAreaRestFixture: LineFixture = {
  id: 'stacked-area-rest-series',
  title: 'A stacked area with a Rest series whose values the dashboard leaves unprinted',
  kind: 'example',
  data: {
    categories: ['jan', 'feb', 'mar', 'apr', 'may', 'jun'].map((id) => ({ id, label: id[0]!.toUpperCase() + id.slice(1) })),
    series: [
      { id: 'search', label: 'Search', values: [42, 45, 48, 51, 50, 55] },
      { id: 'social', label: 'Social', values: [30, 31, 29, 33, 35, 36] },
      { id: 'rest', label: 'Rest', colorRole: 'others', values: [14, 12, 15, 13, 16, 14] },
    ],
  },
  options: {
    variant: 'stacked-area',
    title: 'Search and Social carry the spend',
    subtitle: { measure: 'Spend', period: 'H1' },
    source: 'Illustrative media plan',
  },
};
// every authored stroke and point symbol on one chart, and a
// reference series beside them.
const strokeSamplerFixture: LineFixture = {
  id: 'stroke-marker-sampler',
  title: 'Solid actuals, a dashed forecast and a dotted plan beside a rival and a prior-year reference, four marker shapes',
  kind: 'torture',
  tags: ['demo', 'coverage'],
  data: {
    categories: ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug'].map((id) => ({ id, label: id[0]!.toUpperCase() + id.slice(1) })),
    series: [
      { id: 'actual', label: 'Actual', lineStyle: 'solid', marker: 'circle', values: [42, 45, 47, 50, 52, null, null, null] },
      { id: 'forecast', label: 'Forecast', scenario: 'FC', lineStyle: 'dashed', marker: 'square', values: [null, null, null, null, 52, 55, 57, 60] },
      { id: 'plan', label: 'Plan', scenario: 'PL', lineStyle: 'dotted', marker: 'diamond', values: [44, 46, 49, 52, 55, 57, 59, 62] },
      { id: 'rival', label: 'Main rival', marker: 'triangle', values: [36, 37, 39, 40, 41, 41, 42, 43] },
      { id: 'prior', label: 'Prior year', role: 'reference', values: [38, 40, 41, 43, 45, 46, 48, 50] },
    ],
  },
  options: {
    title: 'The forecast ends August two points short of plan',
    subtitle: { measure: 'Monthly orders', period: 'Jan–Aug', scenarios: ['AC', 'FC', 'PL'] },
    unit: 'k',
    format: '1',
    valueAxis: { show: true, gridlines: true },
    legend: 'top',
    highlight: 'forecast',
    source: 'Synthetic monthly orders',
  },
};
fixtures.push({
  "id": "highlight-overlap",
  "title": "Actual remains visible when plan overlaps",
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
          17,
          23
        ]
      }
    ]
  },
  "options": {
    "title": "Actual remains visible when plan overlaps",
    "source": "Invented example"
  }
});

fixtures.push({
  "id": "event-key-glyph",
  "title": "A change is named beside its diamond",
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
        "id": "volume",
        "label": "Volume",
        "values": [
          11,
          15
        ]
      }
    ]
  },
  "options": {
    "title": "A change is named beside its diamond",
    "source": "Invented example",
    "size": {
      "width": 960,
      "height": 620
    },
    "events": {
      "rows": 0,
      "groups": [
        {
          "id": "change",
          "label": "Change",
          "glyph": "diamond",
          "tone": "neutral"
        }
      ]
    },
    "annotations": [
      {
        "id": "event",
        "kind": "event",
        "at": "a",
        "group": "change",
        "label": "Release",
        "labelPlacement": "top"
      }
    ]
  }
});

fixtures.push({
  id: 'adjacent-eras-scoped-means', title: 'Adjacent periods have a boundary and their own means', kind: 'torture',
  data: { categories: ['A', 'B', 'C', 'D'].map(id => ({ id, label: id })), series: [{ id: 'units', label: 'Units', values: [8, 12, 16, 20] }] },
  options: { size: { width: 960, height: 540 }, title: 'Each period has its own mean', valueAxis: { min: 0 } },
  annotations: [
    { id: 'early', kind: 'band', from: 'A', to: 'B', label: 'Early' },
    { id: 'late', kind: 'band', from: 'C', to: 'D', label: 'Late' },
    { id: 'early-mean', kind: 'valueLine', value: 'mean', seriesId: 'units', from: 'A', to: 'B' },
    { id: 'late-mean', kind: 'valueLine', value: 'mean', seriesId: 'units', from: 'C', to: 'D' },
  ],
});


const ratioPlainFormatRefusal: LineFixture = {
  id: 'ratio-plain-format-refused', title: 'Refusal example: ratios require a percent format', kind: 'torture',
  refuses: { code: 'ratio-tier-format-unit', path: 'options.ratioTier.format' },
  data: { categories: [{ id: 'a' }, { id: 'b' }], series: [{ id: 'n', values: [12, 15] }, { id: 'd', values: [24, 30] }] },
  options: { title: 'The ratio is one half', ratioTier: { id: 'rate', label: 'Rate', numeratorSeriesId: 'n', denominatorSeriesId: 'd', at: ['a', 'b'], format: '1.0' } },
};

fixtures.push({
  id: 'weekly-month-day-axis', title: 'Twenty-five weekly labels use one date row', kind: 'torture',
  data: {
    categories: Array.from({ length: 25 }, (_, i) => ({ id: `w${i}`, label: formatDate(new Date(Date.UTC(2026, 0, 1 + i * 7)), 'd MMM') })),
    series: [{ id: 'amount', label: 'Sample count', values: Array.from({ length: 25 }, (_, i) => 10 + i % 7) }],
  },
  options: { title: 'Weekly counts vary within a narrow range', size: { width: 900, height: 500 } },
}, {
  id: 'one-point-hollow-triangle', title: 'A one-point triangle key keeps its outline', kind: 'torture',
  data: { categories: [{ id: 'a', label: 'Period A' }], series: [{ id: 'plan', label: 'Plan', scenario: 'PL', marker: 'triangle', values: [12] }] },
  options: { title: 'The planned point uses a hollow triangle', legend: 'auto', seriesLabels: 'none' },
}, {
  // unlabelled ISO month ids read 'Jul' … 'Jun', with the year in a row under them.
  id: 'iso-months-year-row', title: 'ISO month ids across two years print months and a year row', kind: 'example',
  data: {
    categories: Array.from({ length: 12 }, (_, i) => ({ id: `${2025 + Math.floor((i + 6) / 12)}-${String((i + 6) % 12 + 1).padStart(2, '0')}` })),
    series: [{ id: 'orders', kind: 'line', label: 'Orders', values: [41, 44, 43, 47, 52, 58, 49, 46, 50, 53, 55, 57] }],
  },
  options: { title: 'Orders peak in December', unit: 'k' },
});
fixtures.push({
  id: 'rates-as-fractions',
  title: 'SQL fractions use percentage cells at input',
  kind: 'torture',
  data: {
    valueKind: 'fraction',
    categories: [{ id: '2024', date: '2024-12-31' }, { id: '2025', date: '2025-12-31' }],
    series: [{ id: 'rate', label: 'Conversion rate', values: [0.153, 0.187] }],
  },
  options: { title: 'Conversion rate rises to 18.7%', format: '0.0%', valueLabels: 'all', unit: '%' },
});

// othersShade: 'apart' only keeps the named steps apart from the Rest series, so a named step may be quieter.
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
    title: 'Five segments on the ordered ramp, Rest apart', emphasis: 'ordered', othersShade: 'apart',
    theme: { preset: 'standard', overrides: { color: { othersMark: '#65676A' } } },
  },
});

const smallDrawerFixture: LineFixture = {
  id: 'small-drawer', title: 'A plain line chart in a 480 by 200 drawer', kind: 'example',
  data: {
    categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((id) => ({ id, label: id })),
    series: [{ id: 'visits', label: 'Visits', values: [120, 132, 128, 141, 150, 138, 126] }],
  },
  options: { title: 'Visits peak on Friday', size: { width: 480, height: 200 } },
};

const rebaseMissingNoteFixture: LineFixture = {
  id: 'stacked-area-rebase-missing-note',
  title: 'Custom notes disclose source nulls and rebase suppression',
  kind: 'torture',
  tags: ['coverage'],
  data: {
    categories: Array.from({ length: 5 }, (_, i) => ({ id: `q${i + 1}`, label: `Q${i + 1}` })),
    series: [
      { id: 'alpha', label: 'Alpha', values: [null, 12, 13, 14, 15] },
      { id: 'beta', label: 'Beta', values: [20, 21, 22, 23, 24] },
    ],
  },
  options: {
    target: 'dashboard', variant: 'stacked-area', rebase100: true,
    size: { width: 960, height: 540 },
    title: 'Alpha has no Q1 index base',
    strings: {
      missingStack: '{categories}: source value missing; stack incomplete.',
      rebaseMissing: '{series} omitted: no index base at {period}.',
    },
  },
};

const rebaseZeroNoteFixture: LineFixture = {
  id: 'stacked-area-rebase-zero-note',
  title: 'Custom note for a series with a zero index base',
  kind: 'torture',
  tags: ['coverage'],
  data: {
    categories: Array.from({ length: 5 }, (_, i) => ({ id: `q${i + 1}`, label: `Q${i + 1}` })),
    series: [
      { id: 'alpha', label: 'Alpha', values: [0, 4, 7, 9, 12] },
      { id: 'beta', label: 'Beta', values: [20, 21, 22, 23, 24] },
    ],
  },
  options: {
    target: 'dashboard', variant: 'stacked-area', rebase100: true,
    size: { width: 960, height: 540 },
    title: 'Alpha starts from zero in Q1',
    strings: { rebaseZero: '{series} omitted: the index base at {period} is zero.' },
  },
};

const bandHeadroomFixture: LineFixture = {
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
};

// a series that starts late seats its first value as one at index 0 would.
const lateStartFixture: LineFixture = {
  id: 'late-start-first-value',
  title: 'A series that starts in month 7 prints its first value (valueLabels ends)',
  kind: 'torture',
  tags: ['coverage'],
  data: {
    categories: Array.from({ length: 24 }, (_, i) => ({ id: `m${i + 1}`, label: `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i % 12]} ${24 + Math.floor(i / 12)}`, date: `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01` })),
    series: [
      { id: 'store', label: 'Store', values: [92, 96, 90, 101, 98, 104, 99, 107, 103, 110, 106, 113, 109, 116, 112, 118, 115, 121, 117, 124, 120, 126, 123, 129] },
      { id: 'online', label: 'Online', values: Array.from({ length: 24 }, (_, i) => (i < 6 ? null : 84 + (i - 6))) },
    ],
  },
  options: { title: 'Online grew one order a month from its start in July', unit: 'orders', valueLabels: 'ends', source: 'Illustrative data' },
};

registerFixtures('line', [...fixtures, smallDrawerFixture, anomalyLineFixture, weeklyEventsLineFixture, eventsKeyLineFixture, focusFixture, nearZeroTailsFixture, partialWeekFixture, hostCardFixture, hostCardUnitShownFixture, markInkFixture, cellLabelFixture, ...cohortLineFixtures, briefLineFixture, themeConventionsFixture, areaFromOriginFixture, ...coverageLineFixtures, cycleBandsFixture, gapBracketFixture, stackedAreaBenchmarkFixture, stackedAreaRestFixture, strokeSamplerFixture, ratioPlainFormatRefusal, rebaseMissingNoteFixture, rebaseZeroNoteFixture, bandHeadroomFixture, lateStartFixture, trendFixture, ...continuousLineFixtures]);
