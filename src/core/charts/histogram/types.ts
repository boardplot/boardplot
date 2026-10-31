/**
 * Histogram types. Local to the chart (precedent: `bar/types.ts`) rather than
 * in `core/types/options.ts` — a new distribution type has no business
 * widening the shared options module every other chart imports.
 */

import type { Id } from '../../types/cell';
import type { Rect } from '../../geometry';
import type { BaseOptionsFor } from '../../types/options';
import type { ColumnMarks } from '../column/layout';

/**
 * One sample, nothing else. No categories, no series, no pre-binned counts,
 * no weights: bins the engine did not compute are bins the engine cannot
 * audit, and "trust the caller's bins" is the exact class of silent lie this
 * product exists to prevent. Multi-sample overlays and weighted observations
 * are out-of-scope proposals, not silent approximations.
 */
export interface HistogramData {
  observations: number[];
}

/**
 * `'auto'` derives the width from the data (Freedman-Diaconis vs Sturges);
 * a number sets the bin COUNT; `{ width }` sets the width outright and skips
 * the readability snap.
 */
export type BinSpec = 'auto' | number | { width: number; anchor?: number };

export type BinRule = 'auto' | 'count' | 'width';

export interface HistogramOptions extends BaseOptionsFor<'histogram'> {
  /** Title over the frequency axis, drawn only when authored. */
  axisTitles?: { y?: string };
  bins?: BinSpec;
  /** Snap an 'auto' width onto the {1, 2, 2.5, 5} ladder. Default true. */
  binSnap?: boolean;
  /** Default false: the footnote states n only. true adds the binning rule, width and interval convention. */
  methodNote?: boolean;
}

export interface Binning {
  rule: BinRule;
  /** Equal width of every bin, at full precision. */
  width: number;
  /** Lower edge of the first bin. */
  anchor: number;
  /** `k + 1` edges; `edges[i]` is the lower edge of bin `i`. */
  edges: number[];
  /** True when an 'auto' width was moved onto the readability ladder. */
  snapped: boolean;
  /** True when every observation is a whole number and each width-1 bin centres on one value. */
  perValue: boolean;
  /** `2*IQR*n^(-1/3)`; 0 when the interquartile range collapses. */
  hFd: number;
  /** `range / (log2(n) + 1)`. */
  hSturges: number;
  /** NumPy 'auto': `hFd > 0 ? min(hFd, hSturges) : hSturges`. */
  hAuto: number;
  /** Set only for `bins: <number>`; the realized count may differ (anchor rule). */
  requestedCount?: number;
}

/**
 * The receipt. Every figure is carried at FULL precision, never the rounded
 * display value, because this is what an agent reads back to a human who never
 * sees the terminal — and a receipt that quotes the label instead of the
 * number cannot be recomputed.
 */
export interface HistogramDerived {
  n: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  q1: number;
  q3: number;
  iqr: number;
  binning: Binning;
  counts: number[];
  binLabels: string[];
  /** Whether any bin count label printed. */
  pointLabelsShown: boolean;
  /** Bin labels the solver actually placed, out of `counts.length`. */
  binLabelsShown: number;
  /** Whether the frequency axis rendered (suppressed when its ticks would be fractional). */
  frequencyAxisShown: boolean;
}

export interface HistogramBinMark {
  index: number;
  id: Id;
  lo: number;
  hi: number;
  count: number;
  rect: Rect;
  nodeId?: Id;
}

export interface HistogramMarks {
  /** Contiguous bars, in bin order — the column engine's own geometry. */
  bars: ColumnMarks['bars'];
  bins: HistogramBinMark[];
}
