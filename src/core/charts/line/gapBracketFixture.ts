/**
 * Gap bracket: two daily growth lines over five months, a neutral wash
 * between them, and the end gap stated in the right margin as one large
 * number with a short caption. The lines carry their names in the plot, so
 * the wash needs no key row; the month ticks name the year once. Invented
 * data: both series are synthetic.
 */

import type { Fixture } from '../../registry';
import type { LineChartData } from '../../types/data';
import type { LineOptions } from './types';

/** Weekdays from 1 April to 29 August 2025, the trading days of the invented stores. */
const DAYS: string[] = [];
for (let day = Date.UTC(2025, 3, 1); day <= Date.UTC(2025, 7, 29); day += 86400000) {
  const weekday = new Date(day).getUTCDay();
  if (weekday !== 0 && weekday !== 6) DAYS.push(new Date(day).toISOString().slice(0, 10));
}

/** Deterministic noise in [-1, 1) from a fixed seed (mulberry32). */
function noise(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 2 ** 31) - 1;
  };
}

/** Piecewise cosine ease through invented [day index, value] points. */
function eased(points: [number, number][], i: number): number {
  const k = points.findIndex(([day]) => day >= i);
  if (k <= 0) return points[Math.max(k, 0)]![1];
  const [from, a] = points[k - 1]!;
  const [to, b] = points[k]!;
  return a + ((b - a) * (1 - Math.cos((Math.PI * (i - from)) / (to - from)))) / 2;
}

/** The regional trend and the loyalty stores' lead over it, index points. */
const REGION_PATH: [number, number][] = [[0, 0], [6, -7.5], [20, 1], [40, 6.5], [60, 9.5], [72, 8], [90, 15], [104, 20.5], [108, 19]];
const LEAD_PATH: [number, number][] = [[0, 0], [6, 0.4], [20, 1.3], [40, 2], [60, 3], [72, 4], [90, 5.5], [108, 6.5]];

/** Cumulative sales growth of the regional average and of the loyalty stores, index (1 April 2025 = 0). */
const next = noise(2025);
// `|| 0` turns a rounded -0 into 0, which JSON keeps.
const round = (value: number) => Math.round(value * 10) / 10 || 0;
const SHARED = DAYS.map((_, i) => (i === 0 ? 0 : 0.5 * next()));
const REGION = DAYS.map((_, i) => (i === 0 ? 0 : round(eased(REGION_PATH, i) + SHARED[i]!)));
const LOYALTY = DAYS.map((_, i) => (i === 0 ? 0 : round(eased(REGION_PATH, i) + eased(LEAD_PATH, i) + SHARED[i]! + 0.2 * next())));

const LAST = DAYS[DAYS.length - 1]!;

export const gapBracketFixture: Fixture<LineChartData, LineOptions> = {
  id: 'gap-bracket',
  title: 'Two daily lines with a neutral gap wash and the end gap as a margin bracket with a caption',
  kind: 'example',
  tags: ['annotation'],
  data: {
    categories: DAYS.map((date) => ({ id: date, date })),
    series: [
      { id: 'loyalty', label: 'Loyalty stores', values: LOYALTY },
      { id: 'region', label: 'Regional average', values: REGION },
    ],
  },
  options: {
    size: { width: 720, height: 511 },
    title: 'Stores with a loyalty programme grew faster than the region',
    subtitle: { measure: 'Sales growth' },
    unit: 'index (Apr 1, 2025 = 0)',
    seriesLabels: 'inline',
    valueAxis: { gridlines: true },
    categoryAxis: { dateTicks: 'months' },
    gapFill: { between: ['loyalty', 'region'], positiveTone: 'neutral', negativeTone: 'neutral' },
    source: 'Invented data',
  },
  annotations: [
    {
      kind: 'delta',
      at: { categoryId: LAST, seriesId: 'loyalty' },
      vs: { categoryId: LAST, seriesId: 'region' },
      caption: 'percentage-point difference in cumulative growth',
    },
  ],
};
