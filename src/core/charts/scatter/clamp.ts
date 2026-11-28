import { NormalizeError } from '../../normalize/shared';
import { disclosureNote } from '../../notes';
import { chartString } from '../../strings/scatter';
import type { Id } from '../../types/cell';
import type { BaseOptions, ValueClampOptions } from '../../types/options';
import {
  boundBeyond, clippedValueState, planAxisClamp, pointCountText, validateClampBounds,
  type ClampAxis, type ClampBound, type ClipRecord,
} from '../clamp';
import type { DrawnValueLine } from './valueLines';

type ScatterAxis = ClampAxis;
type ScatterBoundName = ClampBound;
type AxisBounds = ValueClampOptions;
export type ScatterClipRecord = ClipRecord;

/** The minimum-count filter, with the points it removed. */
export interface ScatterDropRecord {
  minCount: number;
  count: number;
  points: { id: Id; label: string; count: number }[];
  note: string;
}

/** A point as the planners read it; the layout's normalized point satisfies it. */
interface ClampablePoint {
  id: Id;
  label: string;
  x: number;
  y: number;
  count: number | null;
}

export interface ScatterClampPlan {
  /** Drawn coordinate for a value on this axis; the value itself never changes. */
  project: Record<ScatterAxis, (value: number) => number>;
  /** Points drawn at an edge rather than at their value. */
  clipped: Set<Id>;
  /** One record per bound that clipped at least one point. */
  records: ScatterClipRecord[];
  /** Domain edges the clamp pins, set only where a point is beyond the bound. */
  edges: Record<ScatterAxis, AxisBounds>;
  /** Bounds as applied, whether or not they clipped anything. */
  applied: Record<ScatterAxis, AxisBounds>;
  /** The axis names the footnotes use. */
  axisNames: Record<ScatterAxis, string>;
  notes: string[];
}

/** Text for the limit, exact by construction: see the shared `discloseNumber`. */
export type Disclose = (raw: number, axis: ScatterAxis) => { value: number; text: string };

interface ScatterClampInput {
  options?: Pick<BaseOptions, 'locale' | 'strings'>;
  clamp: unknown;
  /** Axis titles, so a footnote names the measure a reader sees on the axis. */
  axisTitles: { x?: string; y?: string };
  /** `valueAxis.min` / `valueAxis.max`, which address the y axis on this type. */
  valueAxisBounds: AxisBounds;
  /** True when `options.viewDomain` is present on either axis. */
  hasViewDomain: boolean;
}

const plural = (count: number, word: string): string =>
  `${count} ${word}${count === 1 ? '' : 's'}`;

/** Axis name for a footnote: the title the reader sees, else the axis letter. */
function axisName(axis: ScatterAxis, titles: { x?: string; y?: string }): string {
  return titles[axis] ?? axis;
}

/**
 * Read the authored clamp into per-axis bounds, refusing every shape whose
 * meaning would have to be guessed. `min` and `max` at the top level are the y
 * axis, the one `valueAxis.min` and `valueAxis.max` already address here.
 * Writing them next to an explicit `y` is refused rather than merged, because a
 * merge would silently pick one of two stated bounds.
 */
function readClampBounds(clamp: Record<string, unknown>): Record<ScatterAxis, AxisBounds> {
  const bare: AxisBounds = {
    ...(typeof clamp.min === 'number' ? { min: clamp.min } : {}),
    ...(typeof clamp.max === 'number' ? { max: clamp.max } : {}),
  };
  const named = (axis: ScatterAxis): AxisBounds => (clamp[axis] as AxisBounds | undefined) ?? {};
  if (Object.keys(bare).length > 0 && Object.keys(named('y')).length > 0) {
    throw new NormalizeError(
      'clamp-ambiguous',
      'options.valueAxis.clamp',
      'valueAxis.clamp states the vertical bound twice, once as clamp.min/clamp.max and once as clamp.y',
      'keep one of the two: clamp.min and clamp.max are the y axis on a scatter, and clamp.y says the same thing explicitly',
      undefined,
      ['options', 'valueAxis', 'clamp'],
    );
  }
  return { x: named('x'), y: Object.keys(bare).length > 0 ? bare : named('y') };
}

/** Refuse a clamp that fights an option already deciding the same domain. */
function refuseClampConflicts(bounds: Record<ScatterAxis, AxisBounds>, input: ScatterClampInput): void {
  if (input.hasViewDomain) {
    throw new NormalizeError(
      'clamp-view-domain-conflict',
      'options.valueAxis.clamp',
      'valueAxis.clamp and viewDomain both narrow the scatter domain, and they treat the points outside it differently: viewDomain leaves them out, clamp draws them at the edge and counts them',
      'use viewDomain to zoom, or valueAxis.clamp to cap the axis and mark the outliers, not both',
      undefined,
      ['options', 'valueAxis', 'clamp'],
    );
  }
  validateClampBounds(bounds, input.valueAxisBounds);
}

export function planScatterClamp(
  points: readonly ClampablePoint[],
  input: ScatterClampInput,
  disclose: Disclose,
): ScatterClampPlan | undefined {
  if (!input.clamp || typeof input.clamp !== 'object') return undefined;
  const bounds = readClampBounds(input.clamp as Record<string, unknown>);
  refuseClampConflicts(bounds, input);
  const axisNames = { x: axisName('x', input.axisTitles), y: axisName('y', input.axisTitles) };
  const plan = (axis: ScatterAxis) => planAxisClamp(
    axis, bounds[axis], points, (point) => point[axis], (raw) => disclose(raw, axis), input.options, axisNames[axis],
  );
  const x = plan('x');
  const y = plan('y');
  const records = [...x.records, ...y.records];
  return {
    project: { x: x.project, y: y.project },
    clipped: new Set(records.flatMap((record) => record.points.map((point) => point.id))),
    records,
    edges: { x: x.edges, y: y.edges },
    applied: { x: x.applied, y: y.applied },
    axisNames,
    notes: records.map((record) => record.note),
  };
}

/**
 * Apply `options.minCount`. The option reads a field of the data, so it refuses
 * rather than doing nothing when that field is absent: an author who filters on
 * a count that no point carries has either lost the field or is filtering the
 * wrong chart, and a silent pass would publish the unfiltered cloud under a
 * filtered heading. A point that carries no count while its neighbours do is
 * the same problem one row down, and is named the same way.
 */
export function applyMinCount<T extends ClampablePoint>(
  points: T[],
  minCount: number | undefined,
  /** A count disclosure: never the axis format, whose unit a count does not have. */
  discloseCount: (raw: number) => { value: number; text: string },
  options?: Pick<BaseOptions, 'locale' | 'strings'>,
): { kept: T[]; record?: ScatterDropRecord } {
  if (minCount === undefined) return { kept: points };
  const counted = points.filter((point) => point.count !== null);
  if (counted.length === 0) {
    throw new NormalizeError(
      'min-count-unsupported',
      'options.minCount',
      'options.minCount filters on points[].count, and no point carries one',
      'add count to the points this threshold should filter, or drop options.minCount',
      undefined,
      ['options', 'minCount'],
    );
  }
  if (counted.length < points.length) {
    const missing = points.filter((point) => point.count === null);
    const named = missing.slice(0, 3).map((point) => `'${point.id}'`).join(', ');
    throw new NormalizeError(
      'min-count-partial',
      'points',
      `options.minCount filters on points[].count, and ${plural(missing.length, 'point')} carry none (${named}${missing.length > 3 ? ', …' : ''}); the engine cannot tell whether they are above or below the threshold`,
      'give every point a count, or drop options.minCount',
      undefined,
      ['data', 'points'],
    );
  }
  // Filter on the threshold the footnote prints, taken back from its own
  // disclosure, the way the clamp applies its bounds.
  const { value: threshold, text: thresholdText } = discloseCount(minCount);
  const kept = points.filter((point) => (point.count as number) >= threshold);
  const dropped = points.filter((point) => (point.count as number) < threshold);
  if (kept.length === 0) {
    throw new NormalizeError(
      'min-count-empty',
      'options.minCount',
      `options.minCount is ${minCount} and every one of the ${points.length} points is below it, so there is nothing left to plot`,
      'lower options.minCount below the largest count in the data',
      undefined,
      ['options', 'minCount'],
    );
  }
  if (dropped.length === 0) return { kept };
  return {
    kept,
    record: {
      minCount: threshold,
      count: dropped.length,
      points: dropped.map((point) => ({ id: point.id, label: point.label, count: point.count as number })),
      // The note names the points it dropped.
      note: disclosureNote(chartString(options, 'droppedPointsNote', { v1: pointCountText(options, dropped.length), v2: thresholdText, v3: dropped.map((point) => point.label).join(', ') })),
    },
  };
}


/**
 * What a clipped point's own record says about where it was drawn. A point
 * beyond a bound on both axes sits in a corner and names both bounds, each with
 * its axis, because the two numbers alone do not say which is which.
 */
export function clampStateOf(plan: ScatterClampPlan | undefined, id: Id, options?: Pick<BaseOptions, 'locale' | 'strings'>): string | undefined {
  if (!plan?.clipped.has(id)) return undefined;
  const records = plan.records.filter((entry) => entry.points.some((point) => point.id === id));
  if (records.length === 1) return clippedValueState(records[0]!.limitText, options);
  return clippedValueState(records.map((record) => chartString(options, 'clippedAtAxis', { v1: record.limitText, v2: plan.axisNames[record.axis] })).join(chartString(options, 'clippedAtJoin')), options);
}

const clampPath = (axis: ScatterAxis, bound: ScatterBoundName): string =>
  `valueAxis.clamp.${axis === 'y' ? '' : 'x.'}${bound}`;

/**
 * Refuse a strategy region that reaches past the clamp. The region is drawn at
 * its authored coordinates and the axis ends at the clamp, so the polygon would
 * paint past the plot over the title and the axes. Cutting it at the edge
 * instead would change the shape the author declared without saying so.
 */
export function refuseClampedRegions(
  plan: ScatterClampPlan | undefined,
  regions: readonly { id: Id; points: readonly { x: number; y: number }[] }[] | undefined,
): void {
  if (!plan || !regions) return;
  for (const region of regions) {
    for (const vertex of region.points) {
      for (const axis of ['x', 'y'] as const) {
        const beyond = boundBeyond(plan.applied[axis], vertex[axis]);
        if (!beyond) continue;
        throw new NormalizeError(
          'clamp-zone-conflict',
          'options.zones.regions',
          `strategy region '${region.id}' reaches ${axis} ${vertex[axis]}, beyond ${clampPath(axis, beyond.bound)} ${beyond.limit}, so it would be drawn past the end of the axis`,
          `keep the region inside the clamped range, or move ${clampPath(axis, beyond.bound)} past the region`,
          undefined,
          ['options', 'zones', 'regions'],
        );
      }
    }
  }
}

/**
 * Refuse a value line the clamp has cut off the axis. The mean is taken over
 * the real values, so an outlier far enough out to be clamped can pull it past
 * the clamp, and the line would then be drawn outside the plot. `lines` is
 * every line the annotation pass draws, whatever its target span.
 */
export function refuseClampedValueLines(
  plan: ScatterClampPlan | undefined,
  lines: readonly DrawnValueLine[],
  format: (value: number) => string,
): void {
  if (!plan) return;
  for (const line of lines) {
    const beyond = boundBeyond(plan.applied.y, line.value);
    if (!beyond) continue;
    const path = clampPath('y', beyond.bound);
    const what = line.isMean ? `the mean of the plotted points (${format(line.value)})` : `its value ${format(line.value)}`;
    throw new NormalizeError(
      'clamp-value-line-conflict',
      line.ref.name,
      `valueLine '${line.id}' sits at ${what}, beyond ${path} ${beyond.limit}, so the line would be drawn outside the plot`,
      `move ${path} past the line, or drop the value line`,
      undefined,
      line.ref.segments,
    );
  }
}

/**
 * Refuse quadrants whose cut point lies on or beyond a clamped edge while a
 * clipped point is counted on the far side of it. That point is drawn at the
 * edge, on the near side of the cut, yet the counts, the captions and the
 * description file it in a box the plot does not show.
 */
export function refuseClampedQuadrants(
  plan: ScatterClampPlan | undefined,
  points: readonly ClampablePoint[],
  cuts: { x: number; y: number; xText: string; yText: string } | undefined,
): void {
  if (!plan || !cuts) return;
  for (const axis of ['x', 'y'] as const) {
    const cut = cuts[axis];
    const { min, max } = plan.edges[axis];
    // Half-open rule: a value on the cut counts to the right and above.
    const hidden =
      max !== undefined && cut >= max
        ? points.filter((point) => point[axis] >= cut)
        : min !== undefined && cut <= min
          ? points.filter((point) => point[axis] < cut)
          : [];
    if (hidden.length === 0) continue;
    const bound = max !== undefined && cut >= max ? 'max' : 'min';
    throw new NormalizeError(
      'clamp-quadrant-conflict',
      'options.quadrants',
      `the ${axis} cut point ${axis === 'x' ? cuts.xText : cuts.yText} lies on or beyond ${clampPath(axis, bound)} ${plan.edges[axis][bound]}, and ${plural(hidden.length, 'point')} counted on its far side ${hidden.length === 1 ? 'is' : 'are'} drawn at the edge on its near side`,
      `declare the cut point inside the clamped range, or move ${clampPath(axis, bound)} past it`,
      undefined,
      ['options', 'quadrants', axis],
    );
  }
}
