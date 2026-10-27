/**
 * The five-number summary contract. Pure: observations in, receipt out — no
 * geometry, no theme, no warnings.
 *
 * WHY RAW OBSERVATIONS ONLY (v1 refusal). The chart takes observations and
 * derives the quartiles itself. If a caller hands in q1/median/q3 the engine
 * cannot check them, and a box plot whose quartiles cannot be recomputed is
 * exactly the silent lie this product exists to prevent. A `summary` input
 * mode is a named future proposal and must, when it arrives, carry a
 * mandatory authored-method declaration.
 *
 * THE STATISTICAL CONTRACT — an undeclared quartile method is a lie, so it is
 * written here verbatim and echoed into `derived.method`:
 *
 * 1. Quantiles are TYPE 7 (linear interpolation): with `sorted` ascending and
 *    h = (n - 1) * p,
 *      Q(p) = x[floor(h)] + (h - floor(h)) * (x[floor(h)+1] - x[floor(h)]).
 *    Chosen because it is the default of R (`quantile`), NumPy, pandas, d3 and
 *    Excel's QUARTILE.INC — the human on the other end of the agent will
 *    recompute this number in Excel, and it must match. Pinned cross-check:
 *    for 1..10, Q(0.25) = 3.25, Q(0.5) = 5.5, Q(0.75) = 7.75.
 * 2. Q1 = Q(0.25), median = Q(0.5), Q3 = Q(0.75), IQR = Q3 - Q1.
 * 3. whiskers 'tukey' — fences at Q1 - 1.5*IQR and Q3 + 1.5*IQR; the whiskers
 *    reach the MOST EXTREME OBSERVATIONS STILL INSIDE the fences, never the
 *    fences themselves; everything outside is a genuine OUTLIER by the Tukey
 *    definition, drawn individually.
 *    DISCLOSED HYBRID: Tukey's original construction used hinges, not type-7
 *    quartiles. The combination is what modern tools ship and the difference
 *    is small, but it is named here and in the receipt (`type7+tukey1.5`)
 *    because the box IS the receipt.
 * 4. whiskers 'minmax' — whiskers to min/max; nothing is outside.
 * 5. whiskers 'p10p90' — whiskers at Q(0.10)/Q(0.90) from the same quantile
 *    function; observations beyond them are the OUTER DECILES, and they are
 *    NOT outliers: a tenth of any sample lands there by construction, however
 *    tame the distribution. The field is therefore `beyondWhiskers`, never
 *    `outliers`, and `BoxDerived.beyondMeaning` states which of the two the
 *    active rule produced.
 * 6. Derived values are stored at full precision; the displayed rounding is
 *    never the receipt.
 *
 * DEGENERATE STATES (a degenerate group draws nothing rather than a fake
 * something, and says so):
 *   n === 0            -> 'empty'        no statistic exists
 *   n < 5              -> 'points'       quartiles from four points are fake;
 *                                        min/median/max survive, Q1/Q3 do not
 *   IQR === 0, n >= 5  -> 'median-only'  a 0.5px sliver reads as "narrow",
 *                                        not as "zero"
 *   otherwise          -> 'box'
 */

import { iqr as iqrOf, quantileType7, sortAscending } from '../../stats';
import type { BoxGroupDerived, BoxState, WhiskerRule } from './types';

/** Sample sizes below this cannot support an honest interquartile box. */
const MIN_N_FOR_BOX = 5;
const TUKEY_K = 1.5;

export const METHOD_BY_RULE: Record<WhiskerRule, string> = {
  tukey: 'type7+tukey1.5',
  minmax: 'type7+minmax',
  p10p90: 'type7+p10p90',
};

/** Only the Tukey rule defines an outlier; the others merely cut a tail. */
export const BEYOND_ARE_OUTLIERS: Record<WhiskerRule, boolean> = {
  tukey: true,
  minmax: false,
  p10p90: false,
};

interface SummaryInput {
  id: string;
  label: string;
  observations: readonly number[];
  whiskers: WhiskerRule;
}

function emptyGroup(id: string, label: string): BoxGroupDerived {
  return {
    id,
    label,
    n: 0,
    state: 'empty',
    min: null,
    q1: null,
    median: null,
    q3: null,
    max: null,
    iqr: null,
    whiskerLow: null,
    whiskerHigh: null,
    fenceLow: null,
    fenceHigh: null,
    beyondWhiskers: [],
  };
}

/**
 * The five-number summary plus the inside/beyond split for one group.
 * Every value is COMPUTED here; nothing is read back from the caller.
 */
export function summarizeGroup(input: SummaryInput): BoxGroupDerived {
  const { id, label, observations, whiskers } = input;
  const n = observations.length;
  if (n === 0) return emptyGroup(id, label);

  const sorted = sortAscending(observations);
  const min = sorted[0]!;
  const max = sorted[n - 1]!;
  const median = quantileType7(sorted, 0.5);

  if (n < MIN_N_FOR_BOX) {
    // Q1/Q3 over four points interpolate across nearly the whole sample; a box
    // drawn from them claims a shape the data does not support.
    return {
      id,
      label,
      n,
      state: 'points',
      min,
      q1: null,
      median,
      q3: null,
      max,
      iqr: null,
      whiskerLow: null,
      whiskerHigh: null,
      fenceLow: null,
      fenceHigh: null,
      beyondWhiskers: [],
    };
  }

  const q1 = quantileType7(sorted, 0.25);
  const q3 = quantileType7(sorted, 0.75);
  const spread = iqrOf(sorted);

  let fenceLow: number | null = null;
  let fenceHigh: number | null = null;
  let whiskerLow: number;
  let whiskerHigh: number;
  let beyond: number[] = [];

  if (whiskers === 'minmax') {
    whiskerLow = min;
    whiskerHigh = max;
  } else {
    if (whiskers === 'tukey') {
      fenceLow = q1 - TUKEY_K * spread;
      fenceHigh = q3 + TUKEY_K * spread;
      // The whisker stops at the most extreme observation inside the fence.
      // sorted is ascending, so the first/last in-fence entries are those.
      whiskerLow = sorted.find((value) => value >= fenceLow!) ?? q1;
      let high = q3;
      for (const value of sorted) {
        if (value <= fenceHigh!) high = value;
      }
      whiskerHigh = high;
    } else {
      // p10p90: the whisker IS the quantile, not an observation.
      fenceLow = quantileType7(sorted, 0.1);
      fenceHigh = quantileType7(sorted, 0.9);
      whiskerLow = fenceLow;
      whiskerHigh = fenceHigh;
    }
    beyond = sorted.filter((value) => value < fenceLow! || value > fenceHigh!);
  }

  const state: BoxState = spread === 0 ? 'median-only' : 'box';
  return {
    id,
    label,
    n,
    state,
    min,
    q1,
    median,
    q3,
    max,
    iqr: spread,
    whiskerLow,
    whiskerHigh,
    fenceLow,
    fenceHigh,
    beyondWhiskers: beyond,
  };
}

/**
 * Distinct values with their multiplicity, ascending. Marks are one per
 * distinct value: fifty coincident circles are one dot of ink, fifty scene
 * node ids, and a lie about density. For determinism: exact value positions,
 * never jitter.
 */
export function distinctWithCounts(values: readonly number[]): { value: number; count: number }[] {
  const out: { value: number; count: number }[] = [];
  for (const value of sortAscending(values)) {
    const last = out[out.length - 1];
    if (last && last.value === value) last.count += 1;
    else out.push({ value, count: 1 });
  }
  return out;
}
