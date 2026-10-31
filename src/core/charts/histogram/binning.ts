/**
 * Histogram binning — the pure contract. No geometry, no theme, no options
 * object beyond the bin spec: everything here is arithmetic a reader can
 * reproduce in a spreadsheet, which is the only reason a histogram may be
 * trusted at all. The bins ARE the message; a different bin width tells a
 * different story from the same observations, so every number below is
 * written down verbatim and echoed onto the exhibit as a method note.
 *
 * 1. `sorted` = observations ascending. Quantiles are type-7 (linear
 *    interpolation, the default of R, NumPy, pandas, d3 and Excel's
 *    QUARTILE.INC): with `h = (n - 1)*p`,
 *    `Q(p) = x[floor(h)] + (h - floor(h))*(x[floor(h)+1] - x[floor(h)])`.
 *    Cross-check: for 1..10, `Q(0.25) = 3.25`.
 * 2. `IQR = Q(0.75) - Q(0.25)`; `range = max - min`.
 * 3. `h_fd = 2*IQR*n^(-1/3)` (NumPy `_hist_bin_fd`).
 *    `h_sturges = range / (log2(n) + 1)` (NumPy `_hist_bin_sturges`).
 *    `h_auto = h_fd > 0 ? min(h_fd, h_sturges) : h_sturges` (NumPy 'auto').
 *    NumPy parity is claimed for `h_auto` ONLY; the snap in step 4 is
 *    Boardplot's own and is named as such wherever it fires.
 * 4. Snap (default on): `h` <- the smallest value of `{1, 2, 2.5, 5} x 10^k`
 *    that is >= `h_auto`. If snapping yields fewer than 3 bins, keep `h_auto`
 *    and set `snapped: false`. Record which happened.
 * 5. Anchor: `first = floor(min / h) * h` (or the explicit `anchor`);
 *    `k = max(1, ceil((max - first) / h))`; `edges[i] = first + i*h`.
 *    Membership keeps full precision; labels are formatted by the layout.
 * 5a. Whole numbers: when every observation is an integer and the width is 1
 *    (an 'auto' width, or an authored width without an anchor), the anchor
 *    is `min - 0.5`, so each bin holds exactly one value and centres on it.
 *    Edges on the integers would close the last bin over two values and draw
 *    a false spike. An 'auto' width that snaps below 1 rises to 1: a
 *    narrower bin on whole numbers leaves every other bin empty.
 * 6. Membership is left-closed, right-open `[lo, hi)`; the LAST bin is closed
 *    at its upper edge. Assignment compares against `edges`, never
 *    `floor((v - first)/h)` alone -- that expression lands one ULP low on
 *    exact boundaries and silently moves an observation one bin down.
 *    `sum(counts) === n` is asserted.
 *
 * 7. Open last bin (`bins.openAbove`): every observation at or above the
 *    value goes into one open last bin, whose upper edge is the maximum. The
 *    equal-width bins below cover the smallest observation up to the value,
 *    and their grid runs through it: the derived anchor is counted down from
 *    `openAbove`, and an authored anchor must land on it. The rule widths
 *    still come from the whole sample. Whole numbers at width 1 end the
 *    closed bins half a step below the first whole number at or above it.
 *
 * Equal-width bins only. Unequal bins must encode frequency as AREA, which
 * needs a continuous value axis; a band-scaled unequal-bin histogram is a lie
 * about density, so variable-width binning is refused rather than approximated.
 */

import { NormalizeError } from '../../normalize/shared';
import type { BinSpec, BinRule, Binning } from './types';

/**
 * Hard ceiling on the number of bins. Past this the exhibit is a smear of
 * hairlines with no readable label under any of them, and the honest answer is
 * an authored bin count, not a chart nobody can read.
 */
export const MAX_BINS = 250;

/** The snap ladder, in ascending order within one decade. */
const SNAP_MANTISSAS = [1, 2, 2.5, 5];

/**
 * Remove binary arithmetic noise from display values and the snap ladder.
 * Membership edges and authored widths must never pass through this rounding.
 */
export function round12(value: number): number {
  if (!Number.isFinite(value) || value === 0) return value;
  return Number(value.toPrecision(12));
}

function decimals(value: number): number {
  const [digits, exponent = '0'] = value.toString().split('e');
  return Math.max(0, (digits!.split('.')[1]?.length ?? 0) - Number(exponent));
}

/**
 * Integer arithmetic preserves decimal boundaries such as 3 * 0.1 = 0.3
 * when both operands and the span fit exactly on a safe integer scale.
 * Otherwise keep their full floating-point precision. The derived anchor
 * uses the same arithmetic, so its multiplication cannot shift later edges.
 */
function edgeSequence(first: number, width: number, last: number): (index: number) => number {
  const scale = 10 ** Math.max(decimals(first), decimals(width));
  const scaledFirst = Math.round(first * scale), scaledWidth = Math.round(width * scale);
  const integerEdges = Number.isSafeInteger(scaledFirst) && Number.isSafeInteger(scaledWidth)
    && Number.isSafeInteger(last * scaledWidth) && Number.isSafeInteger(scaledFirst + last * scaledWidth)
    && scaledFirst / scale === first && scaledWidth / scale === width;
  return integerEdges ? (index) => (scaledFirst + index * scaledWidth) / scale : (index) => first + index * width;
}

/** Divide the decimal endpoint span once, without first rounding its width. */
function countEdges(min: number, max: number, k: number): ((index: number) => number) | undefined {
  const scale = 10 ** Math.max(decimals(min), decimals(max));
  const a = Math.round(min * scale), b = Math.round(max * scale);
  if (a / scale !== min || b / scale !== max
    || !Number.isSafeInteger(a) || !Number.isSafeInteger(b)
    || !Number.isSafeInteger(k * a) || !Number.isSafeInteger(k * b)
    || !Number.isSafeInteger(k * (b - a)) || !Number.isSafeInteger(k * scale)) return undefined;
  return (index) => (k * a + index * (b - a)) / (k * scale);
}

/** `h_sturges = range / (log2(n) + 1)` (NumPy `_hist_bin_sturges`). */
export function sturgesWidth(range: number, n: number): number {
  return range / (Math.log2(n) + 1);
}

/** `h_fd = 2*IQR*n^(-1/3)` (NumPy `_hist_bin_fd`); 0 when the IQR collapses. */
export function freedmanDiaconisWidth(interquartileRange: number, n: number): number {
  return 2 * interquartileRange * Math.pow(n, -1 / 3);
}

/** Smallest `{1, 2, 2.5, 5} x 10^k` that is >= `width`. */
function snapWidth(width: number): number {
  if (!(width > 0) || !Number.isFinite(width)) return width;
  const exponent = Math.floor(Math.log10(width));
  // One decade below and above covers every case; the loop below returns on
  // the first candidate that reaches `width`, and log10 can land a decade off
  // for values sitting on a power of ten.
  for (let e = exponent - 1; e <= exponent + 1; e++) {
    const decade = Math.pow(10, e);
    for (const mantissa of SNAP_MANTISSAS) {
      const candidate = round12(mantissa * decade);
      if (candidate >= width) return candidate;
    }
  }
  return width;
}

/**
 * Bin count implied by a width and an anchor. The epsilon absorbs the case
 * where `(max - first)/h` is an exact integer that float division renders as
 * `3.0000000000000004`; without it every second histogram gains a trailing
 * empty bin that no observation can ever reach.
 */
/**
 * First edge for a width the ENGINE chose: `floor(min/h)*h`, clamped so it can
 * never sit above the smallest observation. Float division makes the clamp
 * load-bearing rather than defensive — `Math.floor(7.3/0.1)*0.1` answers
 * 7.300000000000001, an anchor a hair ABOVE the minimum it was derived from,
 * which would push the smallest observation outside its own first bin.
 */
function derivedAnchor(min: number, width: number): number {
  if (!(width > 0) || !Number.isFinite(width)) return Number.NaN;
  const index = Math.floor(min / width);
  return Math.min(edgeSequence(0, width, index)(index), min);
}

/**
 * First edge for an open last bin: counted down from `openAbove` in whole
 * widths, so the value itself is a bin edge, to at or below the minimum.
 */
function anchorBelow(openAbove: number, min: number, width: number): number {
  if (!(width > 0) || !Number.isFinite(width)) return Number.NaN;
  let steps = Math.max(1, Math.ceil((openAbove - min) / width - 1e-9));
  let anchor = edgeSequence(openAbove, width, steps)(-steps);
  if (anchor > min) anchor = edgeSequence(openAbove, width, ++steps)(-steps);
  return anchor;
}

/** Whether `value` is a bin edge of the grid `anchor + i * width`. */
export function onEdgeGrid(value: number, anchor: number, width: number): boolean {
  const steps = (value - anchor) / width;
  return Number.isFinite(steps) && Math.abs(steps - Math.round(steps)) <= 1e-9 * Math.max(1, Math.abs(steps));
}

/** The ladder widths below `width`, down to a tenth of it, widest first. */
function ladderBelow(width: number): number[] {
  const exponent = Math.floor(Math.log10(width));
  const out: number[] = [];
  for (let e = exponent; e >= exponent - 1; e--) {
    for (const mantissa of [...SNAP_MANTISSAS].reverse()) {
      const candidate = round12(mantissa * Math.pow(10, e));
      if (candidate < width && candidate >= width / 10) out.push(candidate);
    }
  }
  return out;
}

function binCountFor(max: number, first: number, width: number): number {
  const spans = (max - first) / width;
  return Math.max(1, Math.ceil(spans - 1e-9));
}

interface BinningInput {
  /** Ascending observations. */
  sorted: readonly number[];
  min: number;
  max: number;
  /** Type-7 interquartile range of the same sample. */
  interquartileRange: number;
  bins: BinSpec;
  /** Snap an 'auto' width onto the {1, 2, 2.5, 5} ladder. Default true. */
  snap: boolean;
}

/** Bins of width 1 centred on whole numbers: `min - 0.5` up to `max + 0.5`, within MAX_BINS. */
function perValueFits(min: number, max: number): boolean {
  return Number.isSafeInteger(min) && Number.isSafeInteger(max) && max - min + 1 <= MAX_BINS;
}

/**
 * Choose the bins. Throws `histogram-bin-explosion` rather than emitting a
 * chart with 4,000 hairlines: an exhibit whose bars are thinner than their own
 * stroke has stopped being a measurement.
 */
export function computeBinning(input: BinningInput): Binning {
  const { sorted, min, max, interquartileRange, bins, snap } = input;
  const n = sorted.length;
  const openAbove = typeof bins === 'object' ? bins.openAbove : undefined;
  if (openAbove !== undefined && !(openAbove > min && openAbove <= max)) {
    throw new NormalizeError(
      'histogram-open-above-invalid',
      'options.bins.openAbove',
      `bins.openAbove ${openAbove} must lie above the smallest observation ${min} and at or below the largest ${max}; the open bin would hold every observation or none`,
      'pass a value inside the data range, such as the 98th percentile rounded to a bin edge',
    );
  }
  // The closed bins end where the open bin starts; without one, at the maximum.
  // The rule widths keep the whole sample, so an open bin leaves the NumPy width as it was.
  const top = openAbove ?? max;
  const range = max - min;

  const hSturges = sturgesWidth(range, n);
  const hFd = freedmanDiaconisWidth(interquartileRange, n);
  const hAuto = hFd > 0 ? Math.min(hFd, hSturges) : hSturges;

  let rule: BinRule;
  let width: number;
  let anchor: number;
  let snapped = false;
  let explicitAnchor = false;
  let perValue = false;
  const wholeNumbers = sorted.every((value) => Number.isInteger(value));
  let requestedCount: number | undefined;

  if (typeof bins === 'number') {
    // An authored count is exact: that many equal bins from the
    // smallest to the largest observation, the last closed at the maximum.
    rule = 'count';
    requestedCount = bins;
    width = range / bins;
    anchor = min;
  } else if (typeof bins === 'object' && (bins.width !== undefined || bins.openAbove === undefined)) {
    // An object without width or openAbove has no width to draw; the check below refuses it.
    rule = 'width';
    width = bins.width ?? Number.NaN;
    explicitAnchor = bins.anchor !== undefined;
    perValue = !explicitAnchor && width === 1 && wholeNumbers && perValueFits(min, top);
    anchor = bins.anchor ?? (perValue ? min - 0.5 : openAbove !== undefined ? anchorBelow(openAbove, min, width) : derivedAnchor(min, width));
  } else {
    rule = 'auto';
    width = hAuto;
    if (snap) {
      const snappedWidth = snapWidth(hAuto);
      const candidate = wholeNumbers && snappedWidth < 1 && perValueFits(min, top) ? 1 : snappedWidth;
      // Snapping trades an exact rule for a readable edge, and it is only a
      // good trade while the shape survives. Three bins is the floor at which
      // "distribution" still means anything; below it the snap has erased the
      // very thing the chart was asked to show, so the rule wins.
      const centred = candidate === 1 && wholeNumbers && perValueFits(min, top);
      if (candidate > 0 && binCountFor(top, centred ? min - 0.5 : derivedAnchor(min, candidate), candidate) >= 3) {
        // `snapped` records a MOVE, not an attempt: a rule width that already
        // sits on the ladder would otherwise print "snapped to a round width"
        // in the method note about a number nothing touched.
        snapped = candidate !== width;
        width = candidate;
        perValue = centred;
      }
    }
    // An open bin keeps round edges: a snapped width whose grid from the minimum misses
    // openAbove gives way to the next narrower ladder width whose grid meets it.
    if (openAbove !== undefined && !perValue && snap && !onEdgeGrid(openAbove, derivedAnchor(min, width), width)) {
      const meets = ladderBelow(width).find((candidate) => onEdgeGrid(openAbove, derivedAnchor(min, candidate), candidate)
        && binCountFor(openAbove, derivedAnchor(min, candidate), candidate) < MAX_BINS);
      if (meets !== undefined) { snapped = meets !== hAuto; width = meets; }
    }
    anchor = perValue ? min - 0.5 : openAbove !== undefined ? anchorBelow(openAbove, min, width) : derivedAnchor(min, width);
  }

  if (!(width > 0) || !Number.isFinite(width)) {
    throw new NormalizeError(
      'histogram-bin-width-invalid',
      'options.bins',
      `bin width resolved to ${width}; a histogram needs a positive, finite bin width`,
      "use bins: 'auto', a positive integer bin count, or { width: <positive number> }",
    );
  }
  if (!Number.isFinite(anchor)) {
    throw new NormalizeError(
      'histogram-bin-anchor-invalid',
      'options.bins.anchor',
      `bin anchor resolved to ${anchor}; the first edge must be a finite number`,
      'pass a finite bins.anchor at or below the smallest observation',
    );
  }
  if (explicitAnchor && anchor > min) {
    throw new NormalizeError(
      'histogram-anchor-above-data',
      'options.bins.anchor',
      `bins.anchor ${anchor} lies above the smallest observation ${min}; observations below the first edge would be silently dropped`,
      `use an anchor of ${min} or lower`,
    );
  }

  // Whole numbers end the closed bins half a step below the first value that goes into the open bin.
  const closedTop = openAbove === undefined ? max : perValue ? Math.ceil(openAbove) - 0.5 : openAbove;
  if (openAbove !== undefined && !perValue && Number.isFinite(width) && width > 0 && Number.isFinite(anchor)) {
    if (!onEdgeGrid(openAbove, anchor, width)) {
      const below = anchor + Math.floor((openAbove - anchor) / width) * width;
      throw new NormalizeError(
        'histogram-open-above-off-grid',
        'options.bins.openAbove',
        `bins.openAbove ${openAbove} does not fall on a bin edge of width ${width} from ${anchor}; the last closed bin would be narrower than the others`,
        `use openAbove ${round12(below)} or ${round12(below + width)}, or leave out bins.anchor so the edges run through openAbove`,
      );
    }
  }
  const first = anchor;
  const closedBins = rule === 'count' ? requestedCount! : binCountFor(closedTop, first, width);
  const k = closedBins + (openAbove === undefined ? 0 : 1);
  if (k > MAX_BINS) {
    throw new NormalizeError(
      'histogram-bin-explosion',
      'options.bins',
      `a bin width of ${width} across observations from ${min} to ${max} needs ${k} bins (limit ${MAX_BINS}) — that is a smear of hairlines, not a distribution`,
      `pass an explicit bins count (<= ${MAX_BINS}), a wider bins.width, or trim the tail that drives the range`,
    );
  }

  const atEdge = (rule === 'count' ? countEdges(min, max, k) : undefined) ?? edgeSequence(first, width, closedBins);
  const edges = Array.from({ length: closedBins + 1 }, (_, i) => atEdge(i));
  // An exact count ends on the maximum itself, not on a float sum a hair off it.
  if (rule === 'count') edges[k] = max;
  // The open bin starts exactly on its authored value and ends on the maximum.
  if (openAbove !== undefined) {
    edges[closedBins] = closedTop;
    edges.push(max);
  }
  // An open bin from the maximum itself holds that one value: its upper edge may equal its lower.
  if (edges.some((edge, i) => !Number.isFinite(edge) || (i > 0 && (edge < edges[i - 1]! || (edge === edges[i - 1]! && !(openAbove !== undefined && i === k)))))) {
    throw new NormalizeError(
      'histogram-bin-range-invalid',
      'options.bins',
      'the bin edges cannot be represented as finite, strictly increasing numbers at this data range',
      'use fewer bins, a wider bins.width, or subtract a common offset from the observations',
    );
  }

  return {
    rule,
    width,
    anchor: first,
    edges,
    snapped,
    perValue,
    hFd,
    hSturges,
    hAuto,
    ...(requestedCount === undefined ? {} : { requestedCount }),
    ...(openAbove === undefined ? {} : { openAbove }),
  };
}

/**
 * Count observations per bin against the EDGES.
 *
 * `[lo, hi)` everywhere except the last bin, which is closed so the maximum
 * has somewhere to live. The first and last bins cover the sample endpoints,
 * including a last edge a floating-point step below the maximum.
 */
export function countPerBin(sorted: readonly number[], edges: readonly number[]): number[] {
  const k = edges.length - 1;
  const counts = new Array<number>(k).fill(0);
  for (const value of sorted) {
    let index = k - 1;
    // Ascending scan: the first edge the value does NOT reach ends its bin.
    for (let i = 1; i < k; i++) {
      if (value < edges[i]!) {
        index = i - 1;
        break;
      }
    }
    if (value < edges[0]!) index = 0;
    counts[index]! += 1;
  }
  return counts;
}

/**
 * Internal audit. Every observation is in exactly one bin or the exhibit is
 * lying about its own sample, so this compares the drawn total against the
 * count that was handed in. It must never fire in production; it exists so
 * that when it does, the chart refuses instead of publishing a short census.
 */
export function assertCountsCoverSample(counts: readonly number[], n: number): void {
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (total !== n) {
    throw new NormalizeError(
      'histogram-count-mismatch',
      'data.observations',
      `binning covered ${total} of ${n} observations — the bars would understate the sample; refusing to draw`,
      'internal audit failure: report this input, it is a bug in the binning contract',
    );
  }
}
