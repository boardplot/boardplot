/**
 * Cohort retention triangle — local data/options/derived types (precedent:
 * charts/bar/types.ts). They stay local because `cohort` is a semantic adapter
 * over the matrix engine and owns a data shape nothing else consumes.
 */

import type { Id } from '../../types/cell';
import type { BaseOptionsFor } from '../../types/options';
import type { Rect } from '../../geometry';

/**
 * `active[0]` IS the cohort base. `size` is an optional authored base that is
 * VERIFIED against `active[0]` and then discarded — a base the engine cannot
 * reconcile is the first place a retention deck goes wrong.
 */
interface CohortInput {
  id: Id;
  label?: string;
  /** Null is a missing count; period zero must be a known positive base. */
  active: (number | null)[];
  size?: number;
}

export interface CohortData {
  /** Names the period unit ('Month', 'Quarter'); default 'Period'. */
  periodLabel?: string;
  /** Chronological, oldest first, at least two. */
  cohorts: CohortInput[];
}

/**
 * `basis` names WHICH retention: two different numbers are both called that.
 *  - 'cohort'   r(c,t) = active(c,t) / active(c,0)   — base-relative
 *  - 'previous' r(c,t) = active(c,t) / active(c,t-1) — period-over-period
 */
export type CohortBasis = 'cohort' | 'previous';
type CohortVariant = 'heatmap' | 'pure' | 'stepped';
type CohortFormatScope = 'classic' | 'column';

/**
 * The exhibit variants (pure, stepped) draw a fixed label set and never
 * consult the `labels` toggle map, so the combination is unrepresentable
 * here (precedent: AnnotationGlyphSlot), refused by the options schema,
 * and warned about by the layout backstop. The heatmap variant (the
 * default) honours `labels` through its heatmap host.
 */
type CohortExhibitLabelsSlot =
  | { variant?: 'heatmap' }
  | { variant: Exclude<CohortVariant, 'heatmap'>; labels?: never };

export interface CohortOptionsBase extends BaseOptionsFor<'cohort'> {
  basis?: CohortBasis;
  /**
   * false (default), or 'weighted' = sum(active) / sum(denominator) over the
   * cohorts observed in that period. NEVER the mean of the percentages.
   */
  averages?: false | 'weighted';
  /**
   * Default false. true adds the method notes (the 'cohort' formula, the anchor
   * column, blank cells). Weighting, support, hatching and the 'previous'
   * formula print regardless.
   */
  methodNote?: boolean;
  /** Stepped fills compare absolute rates or normalize independently within each period. */
  formatScope?: CohortFormatScope;
  /**
   * Four ascending thresholds in percentage points that split the absolute
   * ('classic') stepped fills into five classes, which the key names.
   * Default 30, 40, 50 and 60.
   */
  steps?: [number, number, number, number];
  /** Period indices to show, in chronological order. */
  visiblePeriods?: number[];
  /** Header for the dedicated cohort-size column. */
  cohortSizeLabel?: string;
  /** Include a percent sign in every exhibit cell; default false because the unit is stated once. */
  showPercentSign?: boolean;
  /** Pure Exhibit emphasis threshold in percentage points: rates above it print bold. Default 60; false disables emphasis and its note. */
  threshold?: number | false;
  /** Pure Exhibit column tint, addressed by original period index; default 3. */
  designatedPeriod?: number;
  /** Summary-row policy. Weighted is the only retention-safe aggregate. */
  total?: false | 'weighted';
  /** Drop the newest cohort and longest period before every derivation. */
  excludeCurrentPeriod?: boolean;
  /** Optional exhibit eyebrow above the assertion title. */
  exhibitLabel?: string;
  /**
   * Exhibit variants. 'rows' (default): rows take the spare height of a pinned
   * canvas, up to 1.8 times their natural height, and stepped period columns
   * share the free width as pure columns do. 'none': rows keep their natural
   * height and stepped columns keep their measured width.
   */
  heightFill?: 'rows' | 'none';
}

/** Consulting exhibit table. Stepped columns share the free width, as pure columns do, and keep their measured content width as the floor. Omitted preserves the legacy heatmap. */
export type CohortOptions = CohortOptionsBase & CohortExhibitLabelsSlot;

export interface CohortRowDerived {
  id: Id;
  base: number;
  active: (number | null)[];
  /** Fractions at full precision; null = not meaningful. Length = observedPeriods. */
  retention: (number | null)[];
  observedPeriods: number;
}

export interface CohortAverageDerived {
  /**
   * Fraction at full precision, or null when NO cohort contributes a DRAWN
   * cell in that period. Null, never 0: a period with an empty support set has
   * no average at all, and a 0 there would publish a rate the data cannot
   * support.
   */
  value: number | null;
  /**
   * How many cohorts contributed — it always falls to the right in a triangle.
   * A cohort counts here only if its own cell in that period is DRAWN: a cell
   * the reader cannot see must never vote in the number underneath it.
   */
  support: number;
  /** The contributing cohort ids, in row order — the support set, by name. */
  contributors: Id[];
}

/**
 * Everything here is COMPUTED by this package. The host engine's own
 * `max/min/rowMeans/colMeans` are deliberately absent: `colMeans` is the
 * unweighted mean of the observed cells in a column, which on a triangle is the
 * value of ever fewer cohorts presented as an average — Simpson's paradox on a
 * board slide.
 */
export interface CohortDerived {
  basis: CohortBasis;
  periodCount: number;
  cohorts: CohortRowDerived[];
  averages?: CohortAverageDerived[];
  maxRetention: number;
  /** Original period indices that reach the rendered exhibit. */
  visiblePeriods?: number[];
  /** Periods with results that the compact form left out for space (not the 100% anchor). */
  periodsLeftOut?: number[];
  /** Present for exhibit styles when the summary row is enabled. */
  total?: { base: number; retention: (number | null)[] };
  /** True only when derivation ran after dropping the incomplete newest month. */
  excludedCurrentPeriod?: boolean;
}

export interface CohortCellMark {
  /** Cohort id, or the synthetic average row id. */
  rowId: Id;
  periodId: Id;
  periodIndex: number;
  /** The row and period names the chart prints, for the hover card title. */
  rowLabel: string;
  periodLabel: string;
  kind: 'cohort' | 'average' | 'total';
  rect: Rect;
  nodeId: Id;
  /** Fraction at full precision; null where nothing is shown. */
  retention: number | null;
}

export interface CohortSizeMark {
  rowId: Id;
  /** The row name the chart prints. */
  rowLabel: string;
  value: number;
  rect: Rect;
  nodeId: Id;
  kind: 'cohort' | 'total';
}

export interface CohortMarks {
  cells: CohortCellMark[];
  sizeCells?: CohortSizeMark[];
}
