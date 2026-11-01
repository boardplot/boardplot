/**
 * Population-pyramid data and option types (registry type
 * 'pyramid'). They live in the chart directory rather than in the shared
 * `types/options` module because nothing outside this type accepts them: an
 * option declared on the shared surface is published on every chart's props
 * whether or not its runtime takes it. Precedent: box, cohort, choropleth.
 */

import type { BaseOptionsFor } from '../../types/options';
import type { ColorRole, Id } from '../../types/cell';

/**
 * One ordered band. `from` is inclusive, `to` is EXCLUSIVE: contiguity is
 * `bands[i].to === bands[i+1].from`, so a value equal to `to` belongs to the
 * next band. Exactly one band may omit `to`, and it must be the last one —
 * that band is open-ended and its row is not width-comparable.
 */
export interface PyramidBand {
  id: Id;
  from: number;
  to?: number;
  label?: string;
}

/** Explicit band binding; the alternative form is a positional array. */
export interface PyramidGroupValue {
  bandId: Id;
  value: number | null;
}

export interface PyramidGroup {
  id: Id;
  label?: string;
  /** ISO observation date when the two groups compare dated population snapshots. */
  date?: string;
  /**
   * Counts or amounts, one per band. Shares are DERIVED: a percent cell, a
   * null, a negative or a non-finite value is refused with its own code.
   */
  values: (number | null)[] | PyramidGroupValue[];
  colorRole?: ColorRole;
}

export interface PyramidData {
  /** Ascending and contiguous; the engine renders them bottom-up. */
  bands: PyramidBand[];
  /** EXACTLY two. One side is a bar chart; three have no mirrored geometry. */
  groups: PyramidGroup[];
}

/**
 * `sort`, `topN`, `sortBy` and `sharedScale` are deliberately absent.
 *
 * The ordered band axis IS the analysis: sorting bands by magnitude, or
 * folding a tail of bands into an "Others" row, destroys the shape a pyramid
 * is read for. Two independent scales make the two sides look comparable
 * while being numerically incomparable. All four are refused at runtime with
 * a code rather than silently dropped.
 */
export interface PyramidOptions extends Omit<BaseOptionsFor<'pyramid'>, 'sort' | 'topN'> {
  /** `never`, not absent: an omitted key is STRIPPED by the schema, not refused. */
  sort?: never;
  topN?: never;
  /**
   * 'count' (default) plots the authored numbers. 'shareOfTotal' plots
   * `value / grandTotal`, where the grand total spans BOTH groups and every
   * band — never per group, because two sides each summing to 100% hide the
   * group-size imbalance a pyramid is read for. 'shareOfGroup' plots
   * `value / groupTotal`, so each side sums to 100%; it suits two dated
   * snapshots of one population, which have no common whole. 'shareOfTotal'
   * on two groups that both carry a `date` plots 'shareOfGroup'.
   */
  basis?: 'count' | 'shareOfTotal' | 'shareOfGroup';
  /**
   * Default false. true adds the band convention ([from, to), youngest at the
   * bottom, equal widths). An open-ended band and the share base print regardless.
   */
  methodNote?: boolean;
}

export interface PyramidDerived {
  /** Render order: the authored bands REVERSED, so the youngest is the bottom row. */
  order: Id[];
  /** Common width of the closed bands; null when there is only an open band. */
  bandWidth: number | null;
  /** The open-ended top band, or null when every band is closed. */
  openTopBand: Id | null;
  /** The two group ids, in authored order: [0] is the left pane, [1] the right. */
  groupIds: [Id, Id];
  /** Authored counts, by band then group — the operands every claim recomputes from. */
  values: Record<Id, Record<Id, number>>;
  totals: Record<Id, number>;
  grandTotal: number;
  basis: 'count' | 'shareOfTotal' | 'shareOfGroup';
  /**
   * Present under both share bases. PERCENT of the grand total ('shareOfTotal') or of the group total ('shareOfGroup')
   * (the plotted number), not a fraction — the value the reader sees.
   */
  shares?: Record<Id, Record<Id, number>>;
  /** groups[0] / groups[1] per band; null when the denominator is 0. */
  ratio: Record<Id, number | null>;
}
