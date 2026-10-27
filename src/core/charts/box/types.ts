/**
 * Box-and-whisker types. Local to the chart (precedent: bar/types.ts) because
 * the data shape is an observation vector per group, not a ChartData cell
 * grid — carrying observations through the shared cell would be a shared-core
 * change to serve one type.
 */

import type { Id } from '../../types/cell';
import type { BaseOptionsFor } from '../../types/options';

interface BoxGroupInput {
  id: Id;
  label?: string;
  /** Observation date for comparisons between dated group snapshots. */
  date?: string;
  /** Raw observations. Pre-computed summaries are rejected in v1 — see summary.ts. */
  observations: number[];
}

export interface BoxData {
  groups: BoxGroupInput[];
}

export type WhiskerRule = 'tukey' | 'minmax' | 'p10p90';

/**
 * What a row actually drew. `derived.state` is what an agent reports back
 * when a group did not get a box, so it is part of the contract, not a
 * rendering detail.
 */
export type BoxState = 'box' | 'points' | 'median-only' | 'empty';

// The legend is refused on box (LEGEND_REFUSED): every row is labelled
// directly, so the type refuses it as the schema does.
export type BoxOptions = Omit<BaseOptionsFor<'box'>, 'legend'> & {
  legend?: never;
  /** Title of the drawn value axis, drawn only when authored. */
  axisTitles?: { primary?: string };
  whiskers?: WhiskerRule;
  showOutliers?: boolean;
  showObservations?: 'none' | 'small-n';
  /** Default false. true adds the quartile and Tukey whisker note; other whisker rules print theirs regardless. */
  methodNote?: boolean;
  /** 'median' (default) prints the median; 'all' also prints Q1, Q3 and the whisker ends under the box. */
  boxValues?: 'median' | 'all';
};

export interface BoxGroupDerived {
  id: Id;
  label: string;
  n: number;
  state: BoxState;
  /** Full precision throughout — the displayed rounding is never the receipt. */
  min: number | null;
  q1: number | null;
  median: number | null;
  q3: number | null;
  max: number | null;
  iqr: number | null;
  /** Whisker ends in DATA units; for 'tukey' these are observations, never the fences. */
  whiskerLow: number | null;
  whiskerHigh: number | null;
  /** The cut points themselves, so the receipt shows why a value is outside. */
  fenceLow: number | null;
  fenceHigh: number | null;
  /**
   * Every observation outside the whisker rule, ascending, duplicates kept.
   *
   * NOT named `outliers`: under `whiskers: 'p10p90'` these are the outer
   * deciles, and a tenth of ANY sample falls there by construction. Calling
   * them outliers in a machine-readable channel tells an analyst the data has
   * outliers when it has none. `BoxDerived.beyondMeaning` says what "beyond"
   * means for the rule that was actually used.
   */
  beyondWhiskers: number[];
}

export interface BoxDerived {
  /** Versioned method receipt, e.g. 'type7+tukey1.5'. */
  method: string;
  whiskerRule: WhiskerRule;
  /**
   * What `groups[].beyondWhiskers` MEANS under the active rule, in words —
   * the machine-readable answer to "are these outliers?".
   */
  beyondMeaning: string;
  /** True only when the active rule actually defines an outlier. */
  beyondAreOutliers: boolean;
  /**
   * Observations computed but NOT drawn because `showOutliers: false`, per
   * group id. Present so a reader of the JSON sees the censorship the exhibit
   * discloses in its footnote.
   */
  withheldBeyond: Record<string, number>;
  groupOrder: Id[];
  groups: BoxGroupDerived[];
}

export interface BoxRowMark {
  id: Id;
  state: BoxState;
  /** Row band rect — the full lane, whether or not a box was drawn. */
  rect: { x: number; y: number; w: number; h: number };
  boxNodeId?: Id;
  medianNodeId?: Id;
  whiskerNodeIds: Id[];
  /** Marks for values outside the whisker rule — see `beyondWhiskers`. */
  beyondNodeIds: Id[];
  observationNodeIds: Id[];
}

export interface BoxMarks {
  rows: BoxRowMark[];
}
