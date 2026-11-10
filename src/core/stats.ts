/**
 * Descriptive statistics shared across the distribution chart family.
 *
 * This module is the tree's ONLY type-7 quantile implementation. Two exhibits
 * built from the same observations (a box plot and a histogram, say) must
 * agree to the last digit about where the median sits; a second copy of this
 * arithmetic is a silent disagreement waiting to ship. Nothing but
 * `sortAscending`, `quantileType7` and `iqr` belongs here.
 *
 * Type 7 of the standard quantile definitions is the default of R's `quantile`, NumPy,
 * pandas, d3 and Excel's QUARTILE.INC. The reader on the other end will
 * recompute the number in a spreadsheet, so the engine matches the
 * spreadsheet.
 */

/**
 * Ascending numeric sort on a copy. The default `Array#sort` is
 * lexicographic — 10 before 9 — which silently corrupts every quantile
 * downstream. Callers must hand in finite numbers; the chart schemas reject
 * null/NaN/Infinity before layout ever runs.
 */
export function sortAscending(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

/**
 * Type-7 quantile of an ALREADY ASCENDING sample.
 *
 *   h = (n - 1) * p          Q(p) = x[floor(h)] + (h - floor(h)) * (x[floor(h)+1] - x[floor(h)])
 *
 * Pinned cross-check (1..10): Q(0.25) = 3.25, Q(0.5) = 5.5, Q(0.75) = 7.75.
 *
 * The `sorted` precondition is part of the contract rather than a convenience
 * re-sort: quantiles are usually taken three at a time from one sample, and a
 * hidden per-call sort turns an O(n log n) summary into O(3n log n) while
 * hiding an unsorted-input bug instead of exposing it.
 */
export function quantileType7(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    throw new RangeError('quantileType7 requires at least one observation');
  }
  if (!(p >= 0 && p <= 1)) {
    throw new RangeError(`quantileType7 probability must lie in [0, 1], got ${p}`);
  }
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const base = sorted[lo]!;
  if (lo + 1 >= sorted.length) return base;
  return base + (h - lo) * (sorted[lo + 1]! - base);
}

/** Interquartile range Q(0.75) - Q(0.25) of an ALREADY ASCENDING sample. */
export function iqr(sorted: readonly number[]): number {
  return quantileType7(sorted, 0.75) - quantileType7(sorted, 0.25);
}
