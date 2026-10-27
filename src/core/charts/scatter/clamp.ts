import { chartString } from '../../strings/scatter';
/**
 * Scatter outliers: the value clamp and the minimum-count filter.
 *
 * Both options change WHAT IS DRAWN and nothing else. A clipped point keeps its
 * real coordinate in `derived`, in its own mark record, in the accessible
 * description and in the claim receipt; only its pixel position moves to the
 * axis edge, where an open marker says so. A dropped point leaves the picture
 * entirely, and the footnote states how many went and at which threshold, so a
 * reader can subtract the difference from the point count they see.
 *
 * Every number a footnote prints is computed here from the plotted values. The
 * limit is printed through the same disclosure the quadrant cut points use: the
 * printed bound denotes the applied bound exactly, so "clipped at 25,000" names
 * the line the engine actually drew.
 */

import { NormalizeError } from '../../normalize/shared';
import type { Id } from '../../types/cell';
import type { DrawnValueLine } from './valueLines';
import { disclosureNote } from '../../notes';

type ScatterAxis = 'x' | 'y';
type ScatterBoundName = 'min' | 'max';

/** One applied bound, with the points it moved and the sentence it earns. */
export interface ScatterClipRecord {
  axis: ScatterAxis;
  bound: ScatterBoundName;
  /** The bound as applied, taken back from its own disclosure. */
  limit: number;
  /** The one spelling of the bound the exhibit prints. */
  limitText: string;
  /** How many points are drawn at the edge instead of at their value. */
  count: number;
  /** Every clipped point, in input order, with the value it really has. */
  points: { id: Id; label: string; value: number }[];
  /** The derived footnote. */
  note: string;
}

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

interface AxisBounds {
  min?: number;
  max?: number;
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

/** Text for the limit, exact by construction: see `discloseNumber` in layout.ts. */
export type Disclose = (raw: number, axis: ScatterAxis) => { value: number; text: string };

interface ScatterClampInput {
  options?: Pick<import('../../types/options').BaseOptions, 'locale' | 'strings'>;
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
  for (const bound of ['min', 'max'] as const) {
    if (bounds.y[bound] !== undefined && input.valueAxisBounds[bound] !== undefined) {
      throw new NormalizeError(
        'clamp-bound-conflict',
        `options.valueAxis.clamp.${bound}`,
        `valueAxis.${bound} widens the vertical domain so nothing is cut off, and valueAxis.clamp.${bound} caps it so outliers are cut off at ${input.valueAxisBounds[bound]}; one of the two has to go`,
        `drop valueAxis.${bound} to cap the axis, or drop valueAxis.clamp.${bound} to keep every point at its own position`,
        undefined,
        ['options', 'valueAxis', 'clamp', bound],
      );
    }
  }
  for (const axis of ['x', 'y'] as const) {
    const { min, max } = bounds[axis];
    if (min !== undefined && max !== undefined && min >= max) {
      throw new NormalizeError(
        'clamp-empty-range',
        `options.valueAxis.clamp${axis === 'y' ? '' : '.x'}`,
        `the ${axis} clamp keeps values from ${min} up to ${max}, which is an empty range`,
        `set the lower bound below the upper one`,
        undefined,
        ['options', 'valueAxis', 'clamp'],
      );
    }
  }
}

/** The points beyond one bound, in input order, with the values they keep. */
function clippedAt(
  points: readonly ClampablePoint[],
  axis: ScatterAxis,
  bound: ScatterBoundName,
  limit: number,
): ScatterClipRecord['points'] {
  return points
    .filter((point) => (bound === 'max' ? point[axis] > limit : point[axis] < limit))
    .map((point) => ({ id: point.id, label: point.label, value: point[axis] }));
}

/**
 * Plan the clamp: which points are beyond a bound, where the axis then ends,
 * and what the footnotes say. A bound that cuts nothing changes no pixel and
 * earns no footnote, so a clamp set as a guard rail stays invisible until it
 * catches something.
 */
export function planScatterClamp(
  points: readonly ClampablePoint[],
  input: ScatterClampInput,
  disclose: Disclose,
): ScatterClampPlan | undefined {
  if (!input.clamp || typeof input.clamp !== 'object') return undefined;
  const bounds = readClampBounds(input.clamp as Record<string, unknown>);
  refuseClampConflicts(bounds, input);
  const applied: Record<ScatterAxis, AxisBounds> = { x: {}, y: {} };
  const edges: Record<ScatterAxis, AxisBounds> = { x: {}, y: {} };
  const clipped = new Set<Id>();
  const records: ScatterClipRecord[] = [];
  for (const axis of ['x', 'y'] as const) {
    for (const bound of ['min', 'max'] as const) {
      const raw = bounds[axis][bound];
      if (raw === undefined) continue;
      const { value: limit, text: limitText } = disclose(raw, axis);
      applied[axis][bound] = limit;
      const beyond = clippedAt(points, axis, bound, limit);
      if (beyond.length === 0) continue;
      edges[axis][bound] = limit;
      for (const point of beyond) clipped.add(point.id);
      records.push({
        axis,
        bound,
        limit,
        limitText,
        count: beyond.length,
        points: beyond,
        note: disclosureNote(chartString(input.options, 'clippedPointsNote', { v1: chartString(input.options, 'pointsCount', { v1: beyond.length, v2: beyond.length === 1 ? '' : 's' }), v2: limitText, v3: axisName(axis, input.axisTitles) })),
      });
    }
  }
  const project = (axis: ScatterAxis) => (value: number) => {
    const { min, max } = applied[axis];
    if (max !== undefined && value > max) return max;
    if (min !== undefined && value < min) return min;
    return value;
  };
  return {
    project: { x: project('x'), y: project('y') },
    clipped,
    records,
    edges,
    applied,
    axisNames: { x: axisName('x', input.axisTitles), y: axisName('y', input.axisTitles) },
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
  options?: Pick<import('../../types/options').BaseOptions, 'locale' | 'strings'>,
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
      note: disclosureNote(chartString(options, 'droppedPointsNote', { v1: chartString(options, 'pointsCount', { v1: dropped.length, v2: dropped.length === 1 ? '' : 's' }), v2: thresholdText, v3: dropped.map((point) => point.label).join(', ') })),
    },
  };
}


/**
 * The domain seed on one axis: the data extent, capped into the clamp. Without
 * this the padded, "niced" domain would be chosen for values the plot does not
 * show, and the visible ladder would be wrong for every point that is drawn.
 */
export function clampSeed(
  plan: ScatterClampPlan | undefined,
  axis: ScatterAxis,
  lo: number,
  hi: number,
): [number, number] {
  if (!plan) return [lo, hi];
  const { min, max } = plan.applied[axis];
  const into = (value: number): number => {
    if (max !== undefined && value > max) return max;
    if (min !== undefined && value < min) return min;
    return value;
  };
  return [into(lo), into(hi)];
}

/**
 * What a clipped point's own record says about where it was drawn. A point
 * beyond a bound on both axes sits in a corner and names both bounds, each with
 * its axis, because the two numbers alone do not say which is which.
 */
export function clampStateOf(plan: ScatterClampPlan | undefined, id: Id): string | undefined {
  if (!plan?.clipped.has(id)) return undefined;
  const records = plan.records.filter((entry) => entry.points.some((point) => point.id === id));
  if (records.length === 1) return `clipped at ${records[0]!.limitText}`;
  return `clipped at ${records.map((record) => `${record.limitText} (${plan.axisNames[record.axis]})`).join(' and at ')}`;
}

/** The first applied bound a value lies beyond, if any. */
function boundBeyond(
  plan: ScatterClampPlan,
  axis: ScatterAxis,
  value: number,
): { bound: ScatterBoundName; limit: number } | undefined {
  const { min, max } = plan.applied[axis];
  if (max !== undefined && value > max) return { bound: 'max', limit: max };
  if (min !== undefined && value < min) return { bound: 'min', limit: min };
  return undefined;
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
        const beyond = boundBeyond(plan, axis, vertex[axis]);
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
    const beyond = boundBeyond(plan, 'y', line.value);
    if (!beyond) continue;
    const what = line.isMean ? `the mean of the plotted points (${format(line.value)})` : `its value ${format(line.value)}`;
    throw new NormalizeError(
      'clamp-value-line-conflict',
      `annotations[${line.index}]`,
      `valueLine '${line.id}' sits at ${what}, beyond ${clampPath('y', beyond.bound)} ${beyond.limit}, so the line would be drawn outside the plot`,
      `move ${clampPath('y', beyond.bound)} past the line, or drop the value line`,
      undefined,
      ['annotations', line.index],
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

/**
 * The clipped sentence of the accessible description. Every clipped point is
 * named with the value it really has, because the position it is drawn at is
 * the one thing a reader of this description cannot check. Long lists stop at
 * five names and point at the data table, which carries every point in full.
 */
export function clampDescription(
  records: readonly ScatterClipRecord[],
  format: Record<ScatterAxis, (value: number) => string>,
  reversedY: boolean,
  options?: Pick<import('../../types/options').BaseOptions, 'locale' | 'strings'>,
): string {
  const NAMED = 5;
  return records
    .map((record) => {
      // A reversed vertical scale puts the larger values at the bottom, so the
      // edge a point is drawn at is the other one. The bound it is beyond does
      // not change with the scale direction; the side of the page does.
      const flip = reversedY && record.axis === 'y';
      const side = chartString(options, ({ 'x.min': 'clipLeftOf', 'x.max': 'clipRightOf', 'y.min': 'clipBelow', 'y.max': 'clipAbove' } as const)[`${record.axis}.${record.bound}`]);
      const drawnBound = flip ? (record.bound === 'min' ? 'max' : 'min') : record.bound;
      const edge = chartString(options, ({ 'x.min': 'clipLeft', 'x.max': 'clipRight', 'y.min': 'clipBottom', 'y.max': 'clipTop' } as const)[`${record.axis}.${drawnBound}`]);
      const named = record.points
        .slice(0, NAMED)
        .map((point) => `${point.label} (${format[record.axis](point.value)})`)
        .join(', ');
      const rest = record.points.length - NAMED;
      return (
        chartString(options, 'clippedPointsDesc', { v1: chartString(options, 'pointsCount', { v1: record.count, v2: record.count === 1 ? '' : 's' }), v2: side, v3: record.limitText }) +
        chartString(options, 'clippedPointsEdge', { v1: edge, v2: named, v3: rest > 0 ? chartString(options, 'moreInTable', { v1: rest }) : '' })
      );
    })
    .join('');
}
