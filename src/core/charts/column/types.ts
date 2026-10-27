/**
 * Chart-local column types.
 *
 * `signColor` and `anomaly` now live on the PUBLISHED `ColumnOptions` in
 * src/core/types/options.ts, because the column zod schema accepts them at
 * runtime and a consumer type that omits them is type-runtime drift. The
 * earlier arrangement kept them here to stop `BarOptions extends
 * Omit<ColumnOptions, 'ratioTier'>` from inheriting a surface bar's schema
 * refuses; that is now handled by naming them in bar's Omit list, which is the
 * declaration the public-API lock can actually see.
 */

import type { ColumnOptions } from '../../types/options';

export type {
  AnomalySpec,
} from '../../types/options';

/** Kept as the in-core name for the option shape the column chart publishes. */
export type AnomalyColumnOptions = ColumnOptions;

/** One flagged period. `score` is null for method 'threshold' (no statistic). */
export interface AnomalyFlag {
  categoryId: string;
  value: number;
  score: number | null;
}

export interface AnomalyDerived {
  method: 'mad' | 'threshold';
  /** 'zero' | 'median' for mad; 'authored' for threshold. */
  baseline: 'zero' | 'median' | 'authored';
  k: number | null;
  /**
   * The series' ACTUAL median. Never substituted by the baseline: it is the
   * location the MAD is measured around, so a reader given only the spread
   * cannot reconstruct the rule, and a levels series and the same series
   * rebased to deviations would otherwise emit the same sentence while
   * flagging everything and nothing respectively.
   */
  median: number | null;
  /**
   * The centre of the JUDGEMENT — 0 under baseline 'zero', the median under
   * baseline 'median'. This is what the corridor is built around. It is a
   * separate field from `median` on purpose: one ambiguous label for two
   * different numbers is the failure this pair exists to prevent.
   */
  centre: number | null;
  mad: number | null;
  /** 1.4826 × MAD — the consistent σ estimate. null for 'threshold'. */
  scale: number | null;
  corridor: { low: number | null; high: number | null } | null;
  /** Non-null values the rule was computed from. */
  n: number;
  /** False when the rule could not be evaluated; nothing is flagged. */
  usable: boolean;
  /** The sentence printed on the exhibit, in the receipt and in a11y.desc. */
  rule: string;
  flags: AnomalyFlag[];
}
