/**
 * Cycle bands: one long monthly growth
 * line against four named cycle regimes. The four bands sit close together,
 * so their names spread apart in the column right of the plot and elbow
 * leaders tie each name to its band; the peak and the latest value are
 * called out with the number in bold over the words, the peak with an
 * arrow. Invented industry, invented events: the series is synthetic.
 */

import type { Fixture } from '../../registry';
import type { LineChartData } from '../../types/data';
import type { LineOptions } from './types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Invented cycle turning points, [year, month, value]: troughs and peaks of
 * the year-over-year growth of monthly microrelay sales, %. The 1984 peak is
 * the series high; the July 2026 value tops everything since.
 */
const TURNS: [number, number, number][] = [
  [1978, 1, -6], [1979, 10, 38], [1981, 12, -12], [1984, 4, 150], [1985, 11, -42], [1988, 6, 48],
  [1990, 5, -11], [1992, 9, 37], [1994, 10, -8], [1997, 1, 36], [1999, 4, -13], [2000, 10, 58],
  [2002, 3, -24], [2005, 3, 38], [2007, 11, -12], [2010, 6, 62], [2012, 2, -11], [2014, 2, 37],
  [2016, 5, -12], [2018, 4, 40], [2019, 10, -17], [2022, 2, 39], [2023, 8, -13], [2026, 7, 128],
];

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

/**
 * Monthly values January 1978 to July 2026: a cosine ease between turning
 * points (the last upswing accelerates instead), plus small noise that fades
 * to zero at each turning point so the named peaks stay the extremes.
 */
const GROWTH: number[] = (() => {
  const at = TURNS.map(([year, month, value]) => [(year - 1978) * 12 + month - 1, value] as const);
  const next = noise(1978);
  const values: number[] = [];
  for (let k = 0; k < at.length - 1; k++) {
    const [from, a] = at[k]!;
    const [to, b] = at[k + 1]!;
    const last = k === at.length - 2;
    for (let i = from; i < to; i++) {
      const u = (i - from) / (to - from);
      const eased = last ? u * u : (1 - Math.cos(Math.PI * u)) / 2;
      const fade = Math.min(1, (i - from) / 4, (to - i) / 4);
      // `|| 0` turns a rounded -0 into 0, which JSON keeps.
      // Whole percent, as the format prints them, so no value prints as a rounded 0.
      values.push(Math.round(a + (b - a) * eased + 1.2 * fade * next()) || 0);
    }
  }
  values.push(at[at.length - 1]![1]);
  return values;
})();

export const cycleBandsFixture: Fixture<LineChartData, LineOptions> = {
  id: 'cycle-bands',
  title: 'One monthly growth line against four named cycle bands, the peak and the latest value called out',
  kind: 'example',
  tags: ['annotation'],
  data: {
    categories: GROWTH.map((_, i) => {
      const year = 1978 + Math.floor(i / 12);
      const month = String((i % 12) + 1).padStart(2, '0');
      return { id: `${year}-${month}`, label: `${MONTHS[i % 12]} ${year}`, date: `${year}-${month}-01` };
    }),
    series: [{ id: 'growth', label: 'Microrelay sales growth', values: GROWTH }],
  },
  options: {
    title: 'Year-over-year microrelay growth hit a 40-year high in 2026.',
    subtitle: { measure: 'Year-over-year microrelay sales growth, 3-month moving average,¹' },
    unit: '%',
    format: '1',
    valueLabels: 'none',
    valueAxis: { gridlines: true },
    categoryAxis: { dateTicks: 'years' },
    footnotes: ['¹ Monthly sales against the same month a year earlier, averaged over three months.'],
    source: 'Synthetic data for an invented component industry',
    referenceBands: [
      { id: 'strong', value: 60, label: '60+', description: 'very strong cycle' },
      { id: 'typical', low: 35, high: 40, label: '35 to 40+', description: 'typical cycle' },
      { id: 'modest', low: -15, high: -10, label: '−10 to −15', description: 'modest down cycle' },
      { id: 'deep', value: -27, label: '>25', description: 'reduction strong down cycle' },
    ],
  },
  annotations: [
    { kind: 'callout', id: 'peak', at: { categoryId: '1984-04' }, headline: '${value}', text: 'Peak in handheld-loom demand\nand a shortage of 8-pin relay sockets', arrow: true },
    { kind: 'callout', id: 'latest', at: { categoryId: '2026-07' }, headline: '${value}', text: 'July 2026', preferSide: 'right' },
  ],
};
