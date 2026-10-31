/**
 * Scatter log axes: the log10 scale, which axes `valueAxis.log`
 * puts on it, the domain such an axis gets, the values it refuses, the tick
 * set that fits and the tick text. Scatter is the one type with a log scale,
 * so it lives here and not in the shared scale module every entry loads.
 */

import { sweepHide } from '../../collide';
import { MAGNITUDE_DIVISOR, formatWithSpec, neededDecimals, type NumberFormatSpec } from '../../formatSpec';
import { NormalizeError } from '../../normalize/shared';
import type { LinearScale } from '../../scale';
import type { FontSpec, TextMeasurer } from '../../text';
import type { JsonPatchOperation } from '../../diagnostics/jsonPatch';
import type { ValueAxisOptions } from '../../types/options';
import type { NormPt } from './model';
import type { ScatterStrategyOptions } from './types';
import { drawnValueLines } from './valueLines';

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

/**
 * A log tick in the axis's format spec: log ticks span decades, so each
 * prints the decimals it needs, $0.4 beside $1 and $100, where one decimal
 * count for the set would print $1.0 and $100.0.
 */
/**
 * An engine-scaled linear axis takes the scale of its largest tick: data up
 * to 970M on an axis to 1,000,000,000 prints "1.0B", never "1,000M".
 */
export function linearAxisSpec(spec: NumberFormatSpec, domain: readonly number[]): NumberFormatSpec {
  if (!spec.autoMagnitude) return spec;
  const top = Math.max(0, ...domain.filter(Number.isFinite).map(Math.abs));
  let magnitude = spec.magnitude;
  while ((magnitude === 'm' || magnitude === 'bn') && top >= 1000 * MAGNITUDE_DIVISOR[magnitude] * (1 - 1e-9)) magnitude = magnitude === 'm' ? 'bn' : 't';
  return magnitude === spec.magnitude ? spec : { ...spec, magnitude };
}

export function logSpecFormat(spec: NumberFormatSpec, domain?: readonly number[]): (value: number) => string {
  // An engine scale prints each tick at its own scale (60M, 500M, 1.0B): a
  // log axis spans decades, so one scale would print "0.06B". A whole tick
  // under 10 keeps one decimal where a smaller scale prints on the same axis.
  if (spec.autoMagnitude) {
    const own = (value: number): NumberFormatSpec['magnitude'] => {
      let magnitude: NumberFormatSpec['magnitude'] = 'none';
      for (const step of ['k', 'm', 'bn', 't'] as const) if (Math.abs(value) >= MAGNITUDE_DIVISOR[step] * (1 - 1e-9)) magnitude = step;
      return magnitude;
    };
    const lowest = domain && domain.length > 0 ? own(Math.min(...domain.map(Math.abs))) : undefined;
    return (value) => {
      const magnitude = own(value);
      const scaled = value / MAGNITUDE_DIVISOR[magnitude];
      const decimals = Math.max(neededDecimals(scaled, 12), lowest !== undefined && magnitude !== lowest && Math.abs(scaled) < 10 ? 1 : 0);
      return formatWithSpec(value, { ...spec, automatic: false, autoMagnitude: undefined, stepDecimals: undefined, rollMagnitude: false, wholeFrom: undefined, magnitude, decimals });
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

/** The patch that takes `axis` off the log scale and keeps the other one on it. */
function dropLogFix(log: ValueAxisOptions['log'], axis: 'x' | 'y'): JsonPatchOperation[] {
  return log === 'both'
    ? [{ op: 'replace', path: '/options/valueAxis/log', value: axis === 'x' ? 'y' : 'x' }]
    : [{ op: 'remove', path: '/options/valueAxis/log' }];
}

/**
 * Every value a log axis would have to place at or below zero is refused,
 * with its path and the patch that drops the log scale on that axis: the
 * points, the view window, the vertical bounds and includeZero, the clamp,
 * the zone regions, the declared quadrant cut points and the value lines.
 * Zone grid thresholds need no check here: the domain check refuses any
 * threshold outside the positive domain.
 */
export function refuseNonPositiveOnLog(options: ScatterStrategyOptions, axes: LogAxes, pts: readonly NormPt[]): void {
  if (!axes.x && !axes.y) return;
  const log = options.valueAxis?.log;
  const side = (axis: 'x' | 'y') => (axis === 'x' ? 'horizontal' : 'vertical');
  const refuse = (axis: 'x' | 'y', what: string, value: number | string, segments: (string | number)[], remove: string): never => {
    const keep = log === 'both' ? ` (log: '${axis === 'x' ? 'y' : 'x'}' keeps the ${side(axis === 'x' ? 'y' : 'x')} axis on a log scale)` : '';
    throw new NormalizeError(
      'log-nonpositive',
      what,
      `${what} is ${value}, and the ${side(axis)} axis is on a log scale, which has no place for zero or a negative value`,
      `${remove}, or drop valueAxis.log${keep}`,
      dropLogFix(log, axis),
      segments,
    );
  };
  for (const axis of ['x', 'y'] as const) {
    if (!axes[axis]) continue;
    for (const p of pts) {
      if (p[axis] <= 0) refuse(axis, `points[${p.id}].${axis}`, p[axis], ['data', 'points', p.idx, axis], 'remove the point');
    }
    const view = options.viewDomain?.[axis];
    if (view && Math.min(...view) <= 0) refuse(axis, `options.viewDomain.${axis}`, `[${view.join(', ')}]`, ['options', 'viewDomain', axis], `start viewDomain.${axis} above zero`);
    const clamp = options.valueAxis?.clamp;
    const bounds = axis === 'y' ? { min: clamp?.min, max: clamp?.max, ...clamp?.y } : { ...clamp?.x };
    for (const bound of ['min', 'max'] as const) {
      const value = bounds[bound];
      if (value !== undefined && value <= 0) refuse(axis, `options.valueAxis.clamp.${axis}.${bound}`, value, ['options', 'valueAxis', 'clamp'], 'clamp at a value above zero');
    }
    for (const [index, region] of (options.zones?.regions ?? []).entries()) {
      const at = region.points.findIndex((point) => point[axis] <= 0);
      if (at >= 0) refuse(axis, `options.zones.regions[${index}].points[${at}].${axis}`, region.points[at]![axis], ['options', 'zones', 'regions', index, 'points', at, axis], 'move the region above zero');
    }
    const cut = options.quadrants?.[axis];
    if (typeof cut === 'number' && cut <= 0) refuse(axis, `options.quadrants.${axis}`, cut, ['options', 'quadrants', axis], 'cut above zero');
  }
  if (!axes.y) return;
  const va = options.valueAxis ?? {};
  for (const bound of ['min', 'max'] as const) {
    const value = va[bound];
    if (value !== undefined && value <= 0) refuse('y', `options.valueAxis.${bound}`, value, ['options', 'valueAxis', bound], `drop valueAxis.${bound}`);
  }
  if (va.includeZero) refuse('y', 'options.valueAxis.includeZero', 'true', ['options', 'valueAxis', 'includeZero'], 'drop valueAxis.includeZero');
  // A value line, or the low edge of its tolerance band, at or below zero.
  const meanY = pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
  for (const line of drawnValueLines(options.annotations, meanY)) {
    const ann = options.annotations![line.index] as { tolerance?: number | { low: number } };
    const low = typeof ann.tolerance === 'number' ? line.value - ann.tolerance : (ann.tolerance?.low ?? line.value);
    if (Math.min(line.value, low) <= 0) refuse('y', `annotations[${line.index}]`, Math.min(line.value, low), ['annotations', line.index], 'move the value line and its band above zero');
  }
}
