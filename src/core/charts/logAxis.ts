/**
 * Log axes for line, scatter, dot and box: the log10 scale, which axes `valueAxis.log`
 * puts on it, the domain such an axis gets, the values it refuses, the tick
 * set that fits and the tick text. This module stays outside the shared scale module, so other entries do not load it.
 */

import { sweepHide } from '../collide';
import { authoredDecimals } from '../formatPrecision';
import { MAGNITUDE_DIVISOR, RULE_SET, formatWithSpec, neededDecimals, type NumberFormatSpec } from '../formatSpec';
import { NormalizeError } from '../normalize/shared';
import { fixedRuleSet, tickScale } from '../numberRule';
import { applyAxisBounds, type LinearScale } from '../scale';
import type { FontSpec, TextMeasurer } from '../text';
import { annotationRef, type Annotation } from '../types/annotations';
import { cellValue, type RangeCell } from '../types/cell';
import type { ValueAxisOptions } from '../types/options';
import type { LintWarning } from '../types/scene';

export const dropLog = [{ op: 'remove' as const, path: '/options/valueAxis/log' }];

export function nonpositive(path: (string | number)[], value: number | string, pointer = path): never {
  const name = path.map((part, index) => typeof part === 'number' ? `[${part}]` : `${index ? '.' : ''}${part}`).join('');
  throw new NormalizeError('log-nonpositive', name,
    `${name} is ${value}; a log scale has no place for zero or a negative value`,
    'use a value above zero or remove valueAxis.log', dropLog, pointer);
}

export function validateLogBounds(axis: ValueAxisOptions): void {
  for (const key of ['min', 'max'] as const) {
    const value = axis[key];
    if (value !== undefined && value <= 0) nonpositive(['options', 'valueAxis', key], value);
  }
  if (axis.includeZero) nonpositive(['options', 'valueAxis', 'includeZero'], 'true');
}

/** Dot and box each have one numeric axis. Check direct React requests as well as parsed specs. */
export function horizontalLogAxis(type: 'dot' | 'box', axis: ValueAxisOptions): boolean {
  if (!axis.log) return false;
  if (axis.log !== true && axis.log !== 'x') {
    throw new NormalizeError('invalid-options', 'options.valueAxis.log', `${type} has a horizontal value axis`,
      "set valueAxis.log to true or 'x'", [{ op: 'replace', path: '/options/valueAxis/log', value: true }], ['options', 'valueAxis', 'log']);
  }
  validateLogBounds(axis);
  return true;
}

/** Check the source indices before keyed cells or categories are reordered. */
export function validateLogSeriesValues(series: readonly { values: (RangeCell | { categoryId: string; value: RangeCell })[] }[], withRanges = false): void {
  series.forEach((s, si) => {
    if (!Array.isArray(s.values)) return;
    s.values.forEach((raw, ci) => {
      const keyed = raw !== null && typeof raw === 'object' && 'categoryId' in raw && 'value' in raw;
      const cell = keyed ? raw.value : raw;
      const value = cellValue(cell);
      if (typeof value === 'number' && value <= 0) {
        nonpositive(['data', 'series', si, 'values', ci, ...(keyed ? ['value'] : [])], value);
      }
      if (withRanges && cell && typeof cell === 'object' && 'range' in cell && cell.range) {
        for (const key of ['low', 'high', 'mid'] as const) {
          const bound = cell.range[key];
          if (bound !== undefined && bound <= 0) nonpositive(['data', 'series', si, 'values', ci, ...(keyed ? ['value'] : []), 'range', key], bound);
        }
      }
    });
  });
}

/** Point at the annotation the author wrote, even after the request has filtered the list. */
export function nonpositiveAnnotation(ann: unknown, index: number, field: string[], value: number): never {
  const { segments } = annotationRef(ann, index);
  return segments.length ? nonpositive([...segments, ...field], value) : nonpositive(['options', 'annotations', index, ...field], value, []);
}

export function validateLogValueLine(ann: Extract<Annotation, { kind: 'valueLine' }>, index: number): void {
  if (typeof ann.value === 'number' && ann.value <= 0) nonpositiveAnnotation(ann, index, ['value'], ann.value);
  if (typeof ann.tolerance === 'object') {
    for (const key of ['low', 'high'] as const) {
      if (ann.tolerance[key] <= 0) nonpositiveAnnotation(ann, index, ['tolerance', key], ann.tolerance[key]);
    }
  }
}

/**
 * Log10 scale over a positive domain. It answers the LinearScale calls, so a
 * chart maps points, rules and zones through it unchanged; the caller refuses
 * every value at or below zero before it gets here. `ticks()` is the densest
 * tier of `logTickTiers`.
 */
export function logScale(domain: [number, number], range: [number, number]): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const l0 = Math.log10(d0);
  const dl = Math.log10(d1) - l0 || 1;
  const scale = ((value: number) => r0 + ((Math.log10(value) - l0) / dl) * (r1 - r0)) as LinearScale;
  scale.domain = [d0, d1];
  scale.range = [r0, r1];
  scale.log = true;
  scale.invert = (px: number) => 10 ** (l0 + ((px - r0) / ((r1 - r0) || 1)) * dl);
  scale.ticks = () => logTickTiers(Math.min(d0, d1), Math.max(d0, d1))[0]!;
  return scale;
}

/** m x 10^e as the double nearest the decimal, so 3 x 10^-1 is 0.3 and not 0.30000000000000004. */
function decimal(m: number, e: number): number {
  return Number(`${m}e${e}`);
}

/**
 * The round number next to a positive `v` on the 1..9 x 10^e ladder: at or
 * below it ('down'), at or above it ('up'), or one rung past it when `strict`.
 * A log domain ends on these, so an end tick reads 0.4 or 200, never 0.37.
 */
function logRung(v: number, dir: 'down' | 'up', strict = false): number {
  let e = Math.floor(Math.log10(v));
  let m = v / 10 ** e;
  if (m >= 10 - 1e-9) {
    e += 1;
    m /= 10;
  }
  let k = dir === 'down' ? Math.floor(m + 1e-9) : Math.ceil(m - 1e-9);
  if (strict && Math.abs(k - m) < 1e-9) k += dir === 'down' ? -1 : 1;
  if (k < 1) return decimal(9, e - 1);
  if (k > 9) return decimal(1, e + 1);
  return decimal(k, e);
}

/**
 * The tick sets a log axis over [lo, hi] can print, densest first: 1, 2, 3,
 * 4, 5, 6 and 8 of each decade when the domain spans less than one, then 1,
 * 2 and 5, then the decades, then every second, third ... decade. Each set
 * holds both domain ends, so the axis states where it starts and stops; the
 * caller takes the densest set whose labels fit.
 */
export function logTickTiers(lo: number, hi: number): number[][] {
  if (!(lo > 0) || !(hi > lo) || !Number.isFinite(hi)) return [[lo, hi].filter((v) => Number.isFinite(v))];
  const e0 = Math.floor(Math.log10(lo));
  const e1 = Math.ceil(Math.log10(hi));
  const ladder = (mantissas: readonly number[], every = 1): number[] => {
    const inside: number[] = [];
    for (let e = e0; e <= e1; e++) {
      if ((e - e0) % every !== 0) continue;
      for (const m of mantissas) {
        const v = decimal(m, e);
        if (v > lo * (1 + 1e-9) && v < hi * (1 - 1e-9)) inside.push(v);
      }
    }
    return [lo, ...inside, hi];
  };
  const tiers = Math.log10(hi / lo) < 1 ? [ladder([1, 2, 3, 4, 5, 6, 8])] : [];
  tiers.push(ladder([1, 2, 5]), ladder([1]));
  for (let every = 2; every < e1 - e0; every++) tiers.push(ladder([1], every));
  return tiers;
}

export interface LogAxes {
  x: boolean;
  y: boolean;
}

/** `true` is the vertical axis, the one valueAxis.min and max address on scatter. */
export function logAxesOf(log: ValueAxisOptions['log']): LogAxes {
  return { x: log === 'x' || log === 'both', y: log === true || log === 'y' || log === 'both' };
}

/** A point this close to a domain end, as a share of the data's log span, moves the end one rung out. */
const LOG_EDGE = 0.005;

/**
 * The domain of a log axis over positive data: each end on the nearest round
 * number past the data (0.45 to 95 gives 0.4 to 100). It never widens to a
 * decade the data does not reach, so a range of less than one decade stays one.
 */
export function logDomain(min: number, max: number): [number, number] {
  let lo = logRung(min, 'down');
  let hi = logRung(max, 'up');
  const span = Math.log10(max / min);
  if (Math.log10(min / lo) < LOG_EDGE * span) lo = logRung(lo, 'down', true);
  if (Math.log10(hi / max) < LOG_EDGE * span) hi = logRung(hi, 'up', true);
  if (!(hi > lo)) return [logRung(lo, 'down', true), logRung(hi, 'up', true)];
  return [lo, hi];
}

/** Apply authored bounds without clipping data. An explicit step can only place positive ticks. */
export function logValueDomain(lo: number, hi: number, axis: ValueAxisOptions, warnings: LintWarning[], step?: number): { domain: [number, number]; ticks?: number[] } {
  let base = logDomain(lo, hi);
  if (!(base[0] > 0) || !Number.isFinite(base[1]) || !(base[1] > base[0])) {
    base = lo < hi ? [lo, hi] : lo <= Number.MAX_VALUE / 10 ? [lo, lo * 10] : [lo / 10, lo];
  }
  let [dLo, dHi] = applyAxisBounds(base, [lo, hi], axis, warnings);
  if (!(dHi > dLo)) {
    warnings.push({
      code: 'value-axis-bounds-expanded', severity: 'warn',
      message: 'the requested value-axis bounds leave no range, so the log axis uses a positive range around the data',
      suggest: 'set valueAxis.min below valueAxis.max',
    });
    [dLo, dHi] = base;
  }
  if (step === undefined) return { domain: [dLo, dHi] };
  const from = Math.floor((axis.min !== undefined ? dLo : lo) / step);
  const to = Math.ceil((axis.max !== undefined ? dHi : hi) / step);
  const first = Math.max(1, from);
  if (!Number.isSafeInteger(to) || to - first > 20 || !(to > first)) {
    warnings.push({
      code: 'tick-step-ignored', severity: 'warn',
      message: `valueAxis.tickStep ${step} does not produce 2 to 21 positive ticks over the log domain; log ticks are drawn instead`,
      suggest: 'pick a step that gives 2 to 21 positive ticks',
    });
    return { domain: [dLo, dHi] };
  }
  const multiple = (index: number) => {
    const value = index * step;
    return step >= 1e-20 && value < 1e21 ? Number(value.toFixed(authoredDecimals(step))) : value;
  };
  if (from > 0) dLo = Math.min(multiple(from), lo);
  else warnings.push({
    code: 'log-tick-step-zero', severity: 'warn',
    message: `valueAxis.tickStep ${step} would snap the lower bound to zero, so the log axis keeps its positive lower bound`,
    suggest: 'use a smaller tick step or remove valueAxis.tickStep',
  });
  dHi = Math.max(multiple(to), hi);
  return { domain: [dLo, dHi], ticks: Array.from({ length: to - first + 1 }, (_, i) => multiple(first + i)) };
}

/**
 * A log tick in the axis's format spec: log ticks span decades, so each
 * prints the decimals it needs, $0.4 beside $1 and $100, where one decimal
 * count for the set would print $1.0 and $100.0.
 */
export function logSpecFormat(spec: NumberFormatSpec, domain?: readonly number[]): (value: number) => string {
  // Under the default rule each tick takes the axis set's
  // scale-word decision at its own scale, and the decimals it needs.
  const rule = spec[RULE_SET];
  if (rule) {
    const lowest = domain && domain.length > 0 ? tickScale(rule, Math.min(...domain.map(Math.abs))) : undefined;
    return (value) => {
      const scale = tickScale(rule, value);
      const scaled = value / 10 ** scale;
      const decimals = Math.max(neededDecimals(scaled, 12), lowest !== undefined && scale !== lowest && Math.abs(scaled) < 10 ? 1 : 0);
      return formatWithSpec(value, { ...spec, [RULE_SET]: fixedRuleSet(rule, { scale, decimals }) });
    };
  }
  const divisor = MAGNITUDE_DIVISOR[spec.magnitude];
  return (value) => formatWithSpec(value, { ...spec, wholeFrom: undefined, decimals: neededDecimals(value / divisor, 12) });
}

/**
 * The densest tick set of `logTickTiers` whose labels clear each other by
 * `gap`. An end label always prints; an inner tick that runs into it is
 * dropped by the axis (layoutValueAxis thins it), so only inner ticks have to
 * clear each other. An end label on x is taken as anchored inward, which is
 * the widest it reaches into the plot.
 */
export function fitLogTicks(
  scale: LinearScale,
  orient: 'x' | 'y',
  format: (value: number) => string,
  font: FontSpec,
  measure: TextMeasurer,
  gap = 4,
): number[] {
  const [lo, hi] = [Math.min(...scale.domain), Math.max(...scale.domain)];
  const tiers = logTickTiers(lo, hi);
  for (const ticks of tiers) {
    const items = ticks.map((tick, index) => {
      const size = measure(format(tick), font);
      const pos = scale(tick);
      const extent = orient === 'x' ? size.width : size.height;
      const start = orient === 'y' ? pos - extent / 2 : index === 0 ? pos : index === ticks.length - 1 ? pos - extent : pos - extent / 2;
      return { start, size: extent, priority: 0 };
    });
    const ends = [items[0]!, items[items.length - 1]!];
    const clears = (a: { start: number; size: number }, b: { start: number; size: number }) =>
      a.start >= b.start + b.size + gap || b.start >= a.start + a.size + gap;
    const inner = items.slice(1, -1).filter((item) => ends.every((end) => clears(item, end)));
    if (sweepHide(inner, gap).every(Boolean)) return ticks;
  }
  return tiers[tiers.length - 1]!;
}

/** Format the horizontal tick labels at their own precision and choose the set that fits the plot. */
export function horizontalLogTicks(scale: LinearScale, spec: NumberFormatSpec, font: FontSpec, measure: TextMeasurer, axis: ValueAxisOptions, ticks?: number[]) {
  const format = logSpecFormat(spec, scale.domain);
  if (ticks) return { format, ticks };
  const fitted = fitLogTicks(scale, 'x', format, font, measure);
  // An automatic end such as 0.9 must not displace 1 when only one label fits.
  const crowdsDecade = (end: number, next: number) => {
    const power = Math.log10(next);
    if (Math.abs(power - Math.round(power)) > 1e-9) return false;
    const widths = measure(format(end), font).width + measure(format(next), font).width;
    return Math.abs(scale(end) - scale(next)) < widths / 2 + 4;
  };
  if (axis.min === undefined && fitted.length > 2 && crowdsDecade(fitted[0]!, fitted[1]!)) fitted.shift();
  if (axis.max === undefined && fitted.length > 2 && crowdsDecade(fitted.at(-1)!, fitted.at(-2)!)) fitted.pop();
  return { format, ticks: fitted };
}

