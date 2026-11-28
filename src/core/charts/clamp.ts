import { fmtPathNumber as fmtN } from '../curve';
import { MAGNITUDE_DIVISOR, RULE_SET, formatWithSpec, roundedNumber, type NumberFormatSpec } from '../formatSpec';
import { NormalizeError } from '../normalize/shared';
import { caveatNote } from '../notes';
import { ruleSetOf } from '../numberSets';
import { chartString } from '../strings/clamp';
import { dashToken, strokeToken } from '../theme';
import type { Id, OwnerRef } from '../types/cell';
import type { MarkerShape } from '../types/data';
import type { BaseOptions, ValueClampOptions } from '../types/options';
import type { Paint, SceneDisplay, SceneNode } from '../types/scene';
import type { Theme } from '../types/theme';

export type ClampAxis = 'x' | 'y';
export type ClampBound = keyof ValueClampOptions;

type Wording = Pick<BaseOptions, 'locale' | 'strings'>;

export interface ClipRecord {
  axis: ClampAxis;
  bound: ClampBound;
  limit: number;
  limitText: string;
  count: number;
  /** Clipped points in input order, with the values they keep. */
  points: { id: Id; label: string; value: number }[];
  note: string;
}

export interface AxisClamp {
  applied: ValueClampOptions;
  /** Only a bound that clips a point pins the domain. */
  edges: ValueClampOptions;
  records: ClipRecord[];
  project: (value: number) => number;
}

export function validateClampBounds(bounds: Partial<Record<ClampAxis, ValueClampOptions>>, valueAxisBounds: ValueClampOptions, allowOverlap = false): void {
  for (const bound of ['min', 'max'] as const) {
    const limit = bounds.y?.[bound];
    if (limit === undefined) continue;
    if (!allowOverlap && valueAxisBounds[bound] !== undefined) {
      throw new NormalizeError(
        'clamp-bound-conflict',
        `options.valueAxis.clamp.${bound}`,
        `valueAxis.${bound} widens the vertical domain so nothing is cut off, and valueAxis.clamp.${bound} caps it so outliers are cut off at ${valueAxisBounds[bound]}; one of the two has to go`,
        `drop valueAxis.${bound} to cap the axis, or drop valueAxis.clamp.${bound} to keep every point at its own position`,
        undefined,
        ['options', 'valueAxis', 'clamp', bound],
      );
    }
    const opposite = bound === 'min' ? 'max' : 'min';
    const end = valueAxisBounds[opposite];
    if (end !== undefined && (bound === 'min' ? limit >= end : limit <= end)) {
      throw new NormalizeError(
        'clamp-bound-conflict',
        `options.valueAxis.clamp.${bound}`,
        `valueAxis.clamp.${bound} ${limit} and valueAxis.${opposite} ${end} leave an empty range`,
        'set the lower bound below the upper one',
        undefined,
        ['options', 'valueAxis', 'clamp', bound],
      );
    }
  }
  for (const axis of ['x', 'y'] as const) {
    const { min, max } = bounds[axis] ?? {};
    const path = `options.valueAxis.clamp${axis === 'y' ? '' : '.x'}`;
    if ((min !== undefined && !Number.isFinite(min)) || (max !== undefined && !Number.isFinite(max))) {
      throw new NormalizeError('invalid-options', path, 'valueAxis.clamp bounds must be finite numbers');
    }
    if (min !== undefined && max !== undefined && min >= max) {
      throw new NormalizeError(
        'clamp-empty-range',
        path,
        `the ${axis} clamp keeps values from ${min} up to ${max}, which is an empty range`,
        `set the lower bound below the upper one`,
        undefined,
        ['options', 'valueAxis', 'clamp'],
      );
    }
  }
}

export function isClipped(value: number, bound: ClampBound, limit: number): boolean {
  return bound === 'max' ? value > limit : value < limit;
}

/** The first applied bound a value lies beyond, if any. */
export function boundBeyond(bounds: ValueClampOptions, value: number): { bound: ClampBound; limit: number } | undefined {
  const { min, max } = bounds;
  if (max !== undefined && isClipped(value, 'max', max)) return { bound: 'max', limit: max };
  if (min !== undefined && isClipped(value, 'min', min)) return { bound: 'min', limit: min };
  return undefined;
}

export function clipRecordFor(clamp: AxisClamp, value: number): ClipRecord | undefined {
  return clamp.records.find(({ bound, limit }) => isClipped(value, bound, limit));
}

export function pointCountText(options: Wording | undefined, count: number): string {
  return chartString(options, 'pointsCount', { v1: count, v2: count === 1 ? '' : 's' });
}

/** Plan one axis, keeping the values separate from their drawing positions. */
export function planAxisClamp<P extends { id: Id; label: string }>(
  axis: ClampAxis,
  bounds: ValueClampOptions,
  points: readonly P[],
  valueOf: (point: P) => number,
  disclose: (raw: number) => { value: number; text: string },
  options?: Wording,
  axisName: string = axis,
): AxisClamp {
  const applied: ValueClampOptions = {};
  const edges: ValueClampOptions = {};
  const records: ClipRecord[] = [];
  for (const bound of ['min', 'max'] as const) {
    const raw = bounds[bound];
    if (raw === undefined) continue;
    const { value: limit, text: limitText } = disclose(raw);
    applied[bound] = limit;
    const beyond: ClipRecord['points'] = [];
    for (const point of points) {
      const value = valueOf(point);
      if (isClipped(value, bound, limit)) beyond.push({ id: point.id, label: point.label, value });
    }
    if (beyond.length === 0) continue;
    edges[bound] = limit;
    records.push({ axis, bound, limit, limitText, count: beyond.length, points: beyond,
      note: caveatNote(chartString(options, 'clippedPointsNote', { v1: pointCountText(options, beyond.length), v2: limitText, v3: axisName })),
    });
  }
  const { min, max } = applied;
  const project = (value: number): number => {
    if (max !== undefined && isClipped(value, 'max', max)) return max;
    if (min !== undefined && isClipped(value, 'min', min)) return min;
    return value;
  };
  return { applied, edges, records, project };
}

/** Start domain padding from the values the scale will show. */
export function clampSeed(project: AxisClamp['project'] | undefined, lo: number, hi: number): [number, number] {
  return project ? [project(lo), project(hi)] : [lo, hi];
}

/** Pin the clipped edges after the domain has been padded and rounded. */
export function pinClampDomain(edges: ValueClampOptions | undefined, lo: number, hi: number): [number, number] {
  return [edges?.min ?? lo, edges?.max ?? hi];
}

/** Use the same number for the position and the printed boundary. */
export function discloseNumber(raw: number, spec: NumberFormatSpec, authoredFormat: boolean): { value: number; text: string; exact: boolean } {
  const scaled = Math.abs(raw / MAGNITUDE_DIVISOR[spec.magnitude]);
  const base = authoredFormat ? spec.decimals : ruleSetOf([scaled], undefined, { words: false }).groupOf(scaled).decimals;
  let decimals = base;
  // Twenty fractional digits are the practical limit of the fixed-decimal printer.
  while (decimals < 20 && Number(scaled.toFixed(decimals)) !== scaled) decimals += 1;
  const exact = Number(scaled.toFixed(decimals)) === scaled;
  // A rule set would print its own rounded digits and not these decimals.
  const { [RULE_SET]: _rules, ...plain } = spec;
  const applied = { ...plain, decimals: exact ? decimals : base };
  const value = exact ? raw : roundedNumber(raw, applied);
  return { value, text: formatWithSpec(value, applied), exact };
}

export function clippedValueState(limitText: string, options?: Wording): string {
  return chartString(options, 'clippedAt', { v1: limitText });
}

export function pointMarkerOutline(marker: Exclude<MarkerShape, 'none'>, cx: number, cy: number, r: number): string {
  const half = r * 1.8 / 2;
  if (marker === 'circle') return `M${fmtN(cx - r)} ${fmtN(cy)}A${fmtN(r)} ${fmtN(r)} 0 1 0 ${fmtN(cx + r)} ${fmtN(cy)}A${fmtN(r)} ${fmtN(r)} 0 1 0 ${fmtN(cx - r)} ${fmtN(cy)}Z`;
  if (marker === 'square') return `M${fmtN(cx - half)} ${fmtN(cy - half)}H${fmtN(cx + half)}V${fmtN(cy + half)}H${fmtN(cx - half)}Z`;
  if (marker === 'triangle') return `M${fmtN(cx)} ${fmtN(cy - r * 1.2)}L${fmtN(cx + r * 1.15)} ${fmtN(cy + r)}L${fmtN(cx - r * 1.15)} ${fmtN(cy + r)}Z`;
  return `M${fmtN(cx)} ${fmtN(cy - r * 1.3)}L${fmtN(cx + r * 1.3)} ${fmtN(cy)}L${fmtN(cx)} ${fmtN(cy + r * 1.3)}L${fmtN(cx - r * 1.3)} ${fmtN(cy)}Z`;
}

/** An empty dashed outline distinguishes clipping from a solid hollow forecast marker. */
export function clippedMarker(theme: Theme, input: {
  id: Id;
  owner: OwnerRef;
  part: 'point' | 'marker';
  display: SceneDisplay;
  marker: Exclude<MarkerShape, 'none'>;
  cx: number;
  cy: number;
  r: number;
  paint: Paint;
  /** A point on a line covers the line under it, so the ring ends the line. */
  fill?: Paint;
}): SceneNode {
  const { id, owner, part, display, marker, cx, cy, r, paint, fill } = input;
  return { t: 'path', id, owner, part, display, d: pointMarkerOutline(marker, cx, cy, r),
    ...(fill ? { fill } : {}), stroke: paint, width: strokeToken(theme, 'mark'), dash: dashToken(theme, 'dotted'), lineCap: 'round' };
}
