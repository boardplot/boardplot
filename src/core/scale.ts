/**
 * Scales: continuous linear and categorical band. Deliberately minimal —
 * charts need predictable, testable mappings, not a d3 replacement.
 */

import type { LintWarning } from './types/scene';

/** Authored bounds can widen a value domain, but cannot clip its data or required baseline. */
export function applyAxisBounds(
  domain: [number, number], extent: [number, number],
  axis: { min?: number; max?: number } | undefined, warnings: LintWarning[],
): [number, number] {
  if (axis?.min === undefined && axis?.max === undefined) return domain;
  return domain.map((value, i) => {
    const bound = i === 0 ? 'min' : 'max';
    const authored = axis?.[bound];
    if (authored === undefined) return value;
    const drawn = i === 0 ? Math.min(authored, extent[i]!) : Math.max(authored, extent[i]!);
    if (drawn !== authored) warnings.push({
      code: `value-axis-${bound}-ignored`, severity: 'warn',
      message: `valueAxis.${bound} ${authored} cannot contain the plotted values and their required space; the axis extends to ${drawn}`,
      suggest: `Set valueAxis.${bound} to ${drawn}, or remove valueAxis.${bound}.`,
      field: ['options', 'valueAxis', bound],
      fix: [{ op: 'replace', path: `/options/valueAxis/${bound}`, value: drawn }],
    });
    return drawn;
  }) as [number, number];
}

export interface LinearScale {
  (value: number): number;
  domain: [number, number];
  range: [number, number];
  break?: LinearScaleBreak;
  /** Set on a log10 scale (logScale): positions follow log10 of the value. */
  log?: true;
  invert(px: number): number;
  ticks(targetCount?: number): number[];
}

export interface LinearBreak {
  from: number;
  to: number;
}

interface LinearScaleBreak extends LinearBreak {
  /** Mapped edges of the fixed collapsed pixel gap. */
  rangeFrom: number;
  rangeTo: number;
  /** Midpoint used by the axis and crossing-mark break glyphs. */
  position: number;
  gap: number;
}

const AXIS_BREAK_GAP = 12;
const MAX_TICK_COUNT = 1000;

function normalizeTickCount(targetCount: number): number {
  if (!Number.isFinite(targetCount)) return 5;
  return Math.min(MAX_TICK_COUNT, Math.max(1, Math.floor(targetCount)));
}

/** Step size chosen from the 1/2/5 ladder so ticks land on round numbers. */
export function niceStep(rawStep: number): number {
  if (!(rawStep > 0) || !Number.isFinite(rawStep)) return 1;
  const exp = Math.floor(Math.log10(rawStep));
  const base = Math.pow(10, exp);
  const m = rawStep / base;
  // Float residue must not climb a rung: (1.1 - 0.6) / 5 is 0.10000000000000002,
  // which is a step of 0.1, not 0.2.
  const nm = m <= 1 + 1e-9 ? 1 : m <= 2 + 1e-9 ? 2 : m <= 5 + 1e-9 ? 5 : 10;
  const step = nm * base;
  // Both ends of the double range break the ladder: 10 ** -324 underflows to 0
  // (so niceStep(Number.MIN_VALUE) answered 0, and every caller then divided by
  // it), and a mantissa of 10 near 1e308 overflows. The raw step is finite and
  // positive by the guard above, so it is the honest fallback.
  return Number.isFinite(step) && step > 0 ? step : rawStep;
}

interface NiceDomainOptions {
  /** Unpadded values that the domain must contain. */
  dataExtent?: readonly [number, number];
  /** Prevent outward snapping from crossing zero for one-sided data. */
  preserveDataSideOfZero?: boolean;
  /** Maximum share of the final span allowed beyond either data edge. */
  maxWasteFraction?: number;
  /**
   * Maximum COMBINED share of the final span beyond both data edges. The
   * ink-envelope floor (0.80 of the plot) is a bound
   * on the SUM of the two wastes, not on each side: two 0.15 sides pass the
   * per-side bound and still leave a 0.70 envelope. Callers with a two-sided
   * domain pass `1 − floor` here; single-anchored domains need nothing (their
   * fixed edge contributes zero waste).
   */
  maxTotalWasteFraction?: number;
}

/**
 * A domain bound must be finite. An infinite edge is not merely ugly: it makes
 * every pixel mapping meaningless and it makes the tick walk non-terminating —
 * `linearScale(niceDomain(0, Number.MAX_VALUE)).ticks()` allocated until the
 * process died, which inside the long-lived MCP server is a denial of service
 * on the session rather than a bad chart.
 *
 * Outward snapping to a nice multiple is what overflows: MAX_VALUE snaps up to
 * 2e308. A bound that left the finite reals therefore falls back to the
 * unsnapped value it was widening — the domain still contains the data, it just
 * is not nice. For an ordinary domain both bounds are already finite and this
 * returns them untouched.
 *
 * It replaces bounds and NOTHING else. A descending domain is a legitimate
 * caller intent (an inverted axis), so the pair is returned in the order it
 * arrived even when lo > hi; sorting here would silently re-orient every
 * inverted axis in the repo, which no caller asked for.
 */
function finiteBounds(
  lo: number,
  hi: number,
  fallbackLo: number,
  fallbackHi: number,
): [number, number] {
  const safeLo = Number.isFinite(lo) ? lo : Number.isFinite(fallbackLo) ? fallbackLo : 0;
  const safeHi = Number.isFinite(hi) ? hi : Number.isFinite(fallbackHi) ? fallbackHi : 1;
  return [safeLo, safeHi];
}

/** Expand [min,max] outward to multiples of a nice step. */
export function niceDomain(
  min: number,
  max: number,
  targetTicks = 5,
  options: NiceDomainOptions = {},
): [number, number] {
  const dataExtent = options.dataExtent;
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    // Nothing can be snapped around a non-finite edge. Re-enter with the
    // caller's unpadded data extent where it is usable, the unit domain
    // otherwise; both replacements are finite, so this recurs exactly once.
    // Order is normalized ONLY on this branch: a bound that is not a number
    // carries no orientation to preserve (the previous answer here was
    // [Infinity, 0], which is neither ascending nor descending). The finite
    // path below leaves the caller's order alone.
    const lo = Number.isFinite(min) ? min : Number.isFinite(dataExtent?.[0]) ? dataExtent![0]! : 0;
    const hi = Number.isFinite(max) ? max : Number.isFinite(dataExtent?.[1]) ? dataExtent![1]! : 1;
    return niceDomain(Math.min(lo, hi), Math.max(lo, hi), targetTicks, options);
  }
  if (min === max) {
    if (min === 0) return [0, 1];
    // niceStep answers 1 for a non-finite argument, so a lone MAX_VALUE datum
    // would otherwise be handed the domain [0, 1] — finite, and not containing
    // its own data. Both Math calls are no-ops whenever min * 1.2 is
    // representable, which is every ordinary input.
    return min > 0
      ? [0, Math.max(niceStep(min * 1.2), min)]
      : [Math.min(-niceStep(-min * 1.2), min), 0];
  }
  if (!dataExtent) {
    const step = niceStep((max - min) / Math.max(1, targetTicks));
    return finiteBounds(snapDown(min, step), snapUp(max, step), min, max);
  }
  let intentMin = Number.isFinite(min) ? min : dataExtent[0];
  let intentMax = Number.isFinite(max) ? max : dataExtent[1];
  let clampMin: number | undefined;
  let clampMax: number | undefined;
  if (dataExtent && options.preserveDataSideOfZero) {
    const [dataMin, dataMax] = dataExtent;
    if (dataMin >= 0 && dataMax > 0) {
      intentMin = Math.max(0, intentMin);
      clampMin = 0;
    } else if (dataMin < 0 && dataMax <= 0) {
      intentMax = Math.min(0, intentMax);
      clampMax = 0;
    }
  }

  let step = niceStep((intentMax - intentMin) / Math.max(1, targetTicks));
  const snap = (): [number, number] => {
    const lo = Math.max(clampMin ?? -Infinity, snapDown(intentMin, step));
    const hi = Math.min(clampMax ?? Infinity, snapUp(intentMax, step));
    // The waste loop below divides by (hi - lo); an overflowed bound would make
    // every waste fraction NaN and silently pass the acceptance test.
    return finiteBounds(lo, hi, intentMin, intentMax);
  };
  let domain = snap();
  const wasteLimit = options.maxWasteFraction;
  const totalLimit = options.maxTotalWasteFraction;
  if (
    (wasteLimit === undefined && totalLimit === undefined) ||
    dataExtent[0] === dataExtent[1]
  ) {
    return domain;
  }

  for (let attempt = 0; attempt < 32; attempt++) {
    const span = domain[1] - domain[0];
    const belowWaste = (dataExtent[0] - domain[0]) / span;
    const aboveWaste = (domain[1] - dataExtent[1]) / span;
    if (
      (wasteLimit === undefined ||
        (belowWaste <= wasteLimit + 1e-12 && aboveWaste <= wasteLimit + 1e-12)) &&
      (totalLimit === undefined || belowWaste + aboveWaste <= totalLimit + 1e-12)
    ) {
      return domain;
    }
    step = previousNiceStep(step);
    domain = snap();
  }
  return finiteBounds(intentMin, intentMax, min, max);
}

function previousNiceStep(step: number): number {
  const exp = Math.floor(Math.log10(step));
  const base = Math.pow(10, exp);
  const mantissa = step / base;
  if (mantissa > 2 + 1e-9) return 2 * base;
  if (mantissa > 1 + 1e-9) return base;
  return 5 * base / 10;
}

/**
 * The domain and ticks of a drawn value axis: the 1-2-5 step whose grid
 * covers [min, max] in at most eight intervals with the least room outside
 * the data, the coarser step on a tie. The domain ends on its outer ticks,
 * so the top gridline is the plot's top edge. `niceDomain` may settle on a
 * finer step than `ticks(5)` draws, which left the plot running on past its
 * top gridline (a max of 189 drew a 200 tick on a 0..220 plot).
 */
export function axisGrid(min: number, max: number): { domain: [number, number]; ticks: number[] } | undefined {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) return undefined;
  const coarse = niceStep((max - min) / 5);
  let best: { lo: number; hi: number; step: number } | undefined;
  for (const step of [coarse, previousNiceStep(coarse)]) {
    const lo = snapDown(min, step);
    const hi = snapUp(max, step);
    if (best && ((hi - lo) / step > 8 + 1e-9 || hi - lo >= best.hi - best.lo - step * 1e-9)) continue;
    best = { lo, hi, step };
  }
  const { lo, hi, step } = best!;
  const count = Math.round((hi - lo) / step);
  // A span past the float range snaps to Infinity; the caller keeps niceDomain.
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !Number.isFinite(count) || count > 8) return undefined;
  return { domain: [lo, hi], ticks: Array.from({ length: count + 1 }, (_, i) => (i === count ? hi : onGrid(Math.round(lo / step) + i, step))) };
}

/**
 * The room over the plot top that a label seat `seat` px above `value` needs
 * beyond what the domain leaves between the value and the top; 0 when that
 * holds it. `plotH` is the plot's height without the room: the room comes out
 * of the plot, so the value rises with it, hence the division.
 */
export function seatRoom(value: number, domain: readonly [number, number], seat: number, plotH: number): number {
  const free = (domain[1] - value) / (domain[1] - domain[0]);
  return free >= 0 && free < 1 ? Math.max(0, (seat - free * Math.max(0, plotH)) / (1 - free)) : 0;
}

export function linearScale(domain: [number, number], range: [number, number]): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const dd = d1 - d0 || 1;
  // The domain end maps exactly onto the range end: r0 + (r1 - r0) can miss r1
  // by one ulp, which put a value line 1e-14 px outside its plot.
  const scale = ((value: number) => (value === d1 && d1 !== d0 ? r1 : r0 + ((value - d0) / dd) * (r1 - r0))) as LinearScale;
  scale.domain = [d0, d1];
  scale.range = [r0, r1];
  scale.invert = (px: number) => d0 + ((px - r0) / ((r1 - r0) || 1)) * dd;
  scale.ticks = (targetCount = 5) => {
    const out: number[] = [];
    const ascending = d1 >= d0;
    const lo = Math.min(d0, d1);
    const hi = Math.max(d0, d1);
    const span = hi - lo;
    const target = normalizeTickCount(targetCount);
    const step = niceStep(span / target);
    const start = Math.ceil(lo / step) * step;
    // Termination of the walk below rests on exactly three facts, so all three
    // are checked rather than assumed:
    //   1. d0, d1, span and start are finite. A span that overflows to Infinity
    //      (d0 = -MAX_VALUE, d1 = MAX_VALUE) leaves niceStep at its non-finite
    //      fallback of 1 and asks for ~1e308 ticks.
    //   2. step > 0, so v moves.
    //   3. v actually advances in floating point. Near 1e308 the increment can
    //      round away entirely (1e300 + 1 === 1e300) and v stalls forever.
    // (1) and (2) are preconditions; (3) is re-checked each iteration.
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return out;
    if (!Number.isFinite(span)) {
      // The endpoints are real but their distance is not representable. There
      // is no nice ladder across that, and an axis with no ticks at all is a
      // silent hole — so say the two true things that remain.
      return d0 === d1 ? [d0] : [d0, d1];
    }
    if (!Number.isFinite(start) || !(step > 0)) return out;
    // guard float drift with an epsilon proportional to step — but the epsilon
    // itself can push the limit over the edge (MAX_VALUE + 5e298 IS Infinity),
    // and then `v <= limit` admitted v = Infinity and emitted it as a tick.
    const drifted = hi + step * 1e-9;
    const limit = Number.isFinite(drifted) ? drifted : hi;
    for (let v = start; Number.isFinite(v) && v <= limit; ) {
      out.push(Math.abs(v) < step * 1e-9 ? 0 : roundToStep(v, step));
      const next = v + step;
      if (!(next > v)) break;
      v = next;
    }
    return ascending ? out : out.reverse();
  };
  return scale;
}

/**
 * Piecewise-linear scale with one omitted domain span. The retained domain
 * segments share all pixels outside the fixed gap in proportion to length.
 */
export function brokenLinearScale(
  domain: [number, number],
  range: [number, number],
  axisBreak: LinearBreak,
  gap = AXIS_BREAK_GAP,
): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const lowerDomain = axisBreak.from - d0;
  const upperDomain = d1 - axisBreak.to;
  const retainedDomain = lowerDomain + upperDomain;
  const direction = r1 >= r0 ? 1 : -1;
  const rangeSpan = Math.abs(r1 - r0);
  const gapPx = Math.min(Math.max(0, gap), rangeSpan);
  const retainedPixels = rangeSpan - gapPx;
  const lowerPixels = retainedDomain > 0 ? retainedPixels * (lowerDomain / retainedDomain) : 0;
  const rangeFrom = r0 + direction * lowerPixels;
  const rangeTo = rangeFrom + direction * gapPx;

  const interpolate = (value: number, a: number, b: number, x: number, y: number): number => {
    const span = b - a;
    return span === 0 ? x : x + ((value - a) / span) * (y - x);
  };
  const scale = ((value: number) => {
    if (value <= axisBreak.from) return interpolate(value, d0, axisBreak.from, r0, rangeFrom);
    if (value >= axisBreak.to) return interpolate(value, axisBreak.to, d1, rangeTo, r1);
    return interpolate(value, axisBreak.from, axisBreak.to, rangeFrom, rangeTo);
  }) as LinearScale;

  scale.domain = [d0, d1];
  scale.range = [r0, r1];
  scale.break = {
    ...axisBreak,
    rangeFrom,
    rangeTo,
    position: (rangeFrom + rangeTo) / 2,
    gap: gapPx,
  };
  scale.invert = (px: number) => {
    const offset = (px - r0) * direction;
    const gapStart = (rangeFrom - r0) * direction;
    const gapEnd = (rangeTo - r0) * direction;
    if (offset <= gapStart) return interpolate(offset, 0, gapStart, d0, axisBreak.from);
    if (offset >= gapEnd) return interpolate(offset, gapEnd, rangeSpan, axisBreak.to, d1);
    return interpolate(offset, gapStart, gapEnd, axisBreak.from, axisBreak.to);
  };
  scale.ticks = (targetCount = 5) => {
    const total = normalizeTickCount(targetCount);
    const lowerTarget = Math.max(1, Math.round(total * (lowerDomain / retainedDomain)));
    const upperTarget = Math.max(1, Math.round(total * (upperDomain / retainedDomain)));
    const epsilon = Math.max(1, Math.abs(d1 - d0)) * 1e-12;
    const lower = linearScale([d0, axisBreak.from], [0, 1])
      .ticks(lowerTarget)
      .filter((value) => value < axisBreak.from - epsilon);
    const upper = linearScale([axisBreak.to, d1], [0, 1])
      .ticks(upperTarget)
      .filter((value) => value > axisBreak.to + epsilon);
    return [...new Set([...lower, ...upper])].sort((a, b) => a - b);
  };
  return scale;
}

/** Return the reason a requested straight break cannot be applied. */
export function invalidLinearBreakReason(
  domain: [number, number],
  axisBreak: LinearBreak,
  renderedValues: readonly number[],
  /** Names what drew a value, when it is not the data: 'the valueLine mean'. */
  drawnBy?: (value: number) => string | undefined,
): string | undefined {
  const [d0, d1] = domain;
  const { from, to } = axisBreak;
  if (!Number.isFinite(from) || !Number.isFinite(to) || !(from < to)) {
    return 'from and to must be finite with from < to';
  }
  if (!(d0 < from && to < d1)) return 'from and to must both lie strictly inside the domain';
  if (from <= 0 && to >= 0) return 'the omitted span must not contain zero';
  const inside = renderedValues.find((value) => value > from && value < to);
  if (inside === undefined) return undefined;
  const cause = drawnBy?.(inside);
  return `the omitted span contains rendered value ${inside}${cause ? `, drawn by ${cause}` : ''}`;
}

/** Whether a logical bar interval spans both retained sides of the break. */
export function crossesLinearBreak(start: number, end: number, axisBreak: LinearBreak): boolean {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return lo <= axisBreak.from && hi >= axisBreak.to;
}

/**
 * Outward snaps to a multiple of `step` that forgive float residue: 0.6 / 0.1
 * is 5.999…, and a plain floor would widen the domain a whole step to 0.5.
 * The snapped edge still contains `v`, and it is rounded onto the step grid.
 */
function snapDown(v: number, step: number): number {
  const k = Math.floor(v / step + 1e-9);
  const lo = onGrid(k, step);
  return lo <= v ? lo : onGrid(k - 1, step);
}

function snapUp(v: number, step: number): number {
  const k = Math.ceil(v / step - 1e-9);
  const hi = onGrid(k, step);
  return hi >= v ? hi : onGrid(k + 1, step);
}

/** k x step without float residue; a step finer than roundToStep's 12 decimals keeps the raw product. */
function onGrid(k: number, step: number): number {
  const raw = k * step;
  const rounded = roundToStep(raw, step);
  return Math.abs(rounded - raw) <= step * 1e-6 ? rounded : raw;
}

function roundToStep(v: number, step: number): number {
  // Snap to the tick grid to avoid 0.30000000000000004-style labels.
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  // Past 12 places toFixed would round a tiny step's ticks (1e-13) to 0; those snap by significant digits.
  return decimals + 1 <= 12 ? Number(v.toFixed(decimals + 1)) : Number(v.toPrecision(12));
}

export interface BandScale {
  /** Left/top edge of the band for a category index. */
  position(index: number): number;
  /** Center of the band. */
  center(index: number): number;
  bandwidth: number;
  step: number;
  count: number;
  range: [number, number];
}

interface BandScaleOptions {
  /** Gap between bands as a fraction of the step (0..1). */
  paddingInner?: number;
  /** Padding at both ends as a fraction of the step (0..1). */
  paddingOuter?: number;
  /** Extra step fractions inserted after categories; the last entry is ignored. */
  gapAfter?: readonly number[];
}

export function bandScale(count: number, range: [number, number], opts: BandScaleOptions = {}): BandScale {
  const paddingInner = opts.paddingInner ?? 0.35;
  const paddingOuter = opts.paddingOuter ?? paddingInner / 2;
  const [r0, r1] = range;
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError('bandScale count must be a nonnegative integer');
  }
  if (!Number.isFinite(r0) || !Number.isFinite(r1) || r1 < r0) {
    throw new RangeError('bandScale range must contain finite ascending values');
  }
  if (!Number.isFinite(paddingInner) || paddingInner < 0 || paddingInner > 1) {
    throw new RangeError('bandScale paddingInner must be between 0 and 1');
  }
  if (!Number.isFinite(paddingOuter) || paddingOuter < 0 || paddingOuter > 1) {
    throw new RangeError('bandScale paddingOuter must be between 0 and 1');
  }
  if (opts.gapAfter?.some((gap) => !Number.isFinite(gap) || gap < 0)) {
    throw new RangeError('bandScale gapAfter values must be finite and nonnegative');
  }
  const extent = r1 - r0;
  const n = Math.max(1, count);
  const extraGaps = Array.from({ length: n }, (_, i) =>
    i < n - 1 ? Math.max(0, opts.gapAfter?.[i] ?? 0) : 0,
  );
  const extraGapTotal = extraGaps.reduce((sum, value) => sum + value, 0);
  // extent = 2*po*step + n*step - pi*step  (n bands of width step*(1-pi),
  // n-1 inner gaps of pi*step, outer padding po*step each side, plus explicit gaps)
  const stepSize = extent / (n - paddingInner + 2 * paddingOuter + extraGapTotal);
  // A theme's whole-pixel bar (fixedBarRow: 17 of a 29 px step) comes back
  // through 1 - (1 - 17/29) one ulp short; snap that noise to the whole pixel.
  const rawBandwidth = stepSize * (1 - paddingInner);
  const wholeBandwidth = Math.round(rawBandwidth);
  const bandwidth = Math.abs(rawBandwidth - wholeBandwidth) < 1e-9 ? wholeBandwidth : rawBandwidth;
  const start = r0 + stepSize * paddingOuter;
  const offsets: number[] = [];
  let extraBefore = 0;
  for (let i = 0; i < n; i++) {
    offsets[i] = extraBefore;
    extraBefore += extraGaps[i]!;
  }
  return {
    position: (i: number) => start + stepSize * (i + (offsets[i] ?? extraBefore)),
    center: (i: number) => start + stepSize * (i + (offsets[i] ?? extraBefore)) + bandwidth / 2,
    bandwidth,
    step: stepSize,
    count: n,
    range: [r0, r1],
  };
}

/** The nice sizes (1, 2, 2.5 or 5 times a power of ten) at most `v`, largest first. */
export function niceBelow(v: number): number[] {
  const out: number[] = [];
  for (let power = 10 ** Math.floor(Math.log10(v)), k = 0; k < 8; k++, power /= 10) {
    for (const step of [5, 2.5, 2, 1]) if (step * power <= v * (1 + 1e-9)) out.push(step * power);
  }
  return out;
}
