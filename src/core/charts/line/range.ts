import { curvePathFromSegments, monotoneSegments, splitCurveSegmentsAtX, type CurveSegment } from '../../curve';
import type { Point } from '../../geometry';
import type { LineInterpolation } from './types';
import type { Category } from '../../types/data';

export interface RangePoint extends Point { ci: number }
export interface RangeEdge { points: RangePoint[]; curve?: CurveSegment[] }

/** Source readings stay separate from the visible readings used by labels and records. */
export interface LineRange {
  lo: number;
  hi: number;
  /** The sides whose bound falls between two readings; a bound on a reading draws as main does. */
  cut: { lo: boolean; hi: boolean };
  xs: number[];
  categories: Category[];
  indexes: number[];
  plotted: (number | null)[][];
  values: Map<string, { v: number | null; scenario?: string }[]>;
  cumTop: number[][];
  cumBot: number[][];
  invalid: Set<number>;
}

/** Cut the original segment, including its cubic controls or step elbows. */
export function cutEdge(edge: RangeEdge, mode: LineInterpolation, lo: number, hi: number): RangeEdge {
  let points = edge.points;
  if (!points.length || points[0]!.x > hi || points[points.length - 1]!.x < lo) return { points: [] };
  let curve = edge.curve;
  for (const [x, start] of [[lo, true], [hi, false]] as const) {
    if (x < points[0]!.x || x > points[points.length - 1]!.x) continue;
    if (x === points[0]!.x) { if (!start) return { points: [points[0]!] }; continue; }
    if (x === points[points.length - 1]!.x) { if (start) return { points: [points[points.length - 1]!] }; continue; }
    const i = points.findIndex(p => p.x >= x);
    const a = points[i - 1]!, b = points[i]!;
    let y = mode === 'step-after' ? a.y : mode === 'step-before' ? b.y : a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
    if (curve) {
      const pieces = splitCurveSegmentsAtX(curve, x);
      curve = pieces[start ? 1 : 0];
      y = start ? curve[0]!.from.y : curve[curve.length - 1]!.to.y;
    }
    if (b.x === x) points = start ? points.slice(i) : points.slice(0, i + 1);
    else {
      const boundary = { x, y, ci: start ? b.ci : a.ci };
      points = start ? [boundary, ...points.slice(i)] : [...points.slice(0, i), boundary];
    }
  }
  return { points, ...(curve ? { curve } : {}) };
}

/** The sides whose bound lies strictly between the first or last kept reading and its outside neighbour. */
export function rangeCut(xs: readonly number[], indexes: readonly number[], lo: number, hi: number): LineRange['cut'] {
  const first = indexes[0]!, last = indexes[indexes.length - 1]!;
  // A window-dropped reading inside the axis range is no outside neighbour.
  return { lo: xs[first - 1]! < lo && xs[first]! > lo, hi: xs[last + 1]! > hi && xs[last]! < hi };
}

/** Retained readings and the neighbours that supply an axis-edge segment. */
export function rangeIndexes(range: LineRange): number[] {
  const first = range.indexes[0]!, last = range.indexes[range.indexes.length - 1]!;
  const before = range.cut.lo ? [first - 2, first - 1] : [];
  const after = range.cut.hi ? [last + 1, last + 2] : [];
  return [...before, ...range.indexes, ...after].filter(i => i >= 0 && i < range.xs.length);
}

/** Runs in data coordinates, with outside context only for the edge segments. */
export function rangeRuns(range: LineRange, rows: (number | null)[][], mode: LineInterpolation, interpolateGaps = false): RangeEdge[][] {
  const first = range.indexes[0]!, last = range.indexes[range.indexes.length - 1]!;
  const indexes = rangeIndexes(range);
  const visible = new Map(range.indexes.map((source, ci) => [source, ci]));
  const runs: RangeEdge[][] = [];
  let current: RangePoint[][] = rows.map(() => []);
  const flush = () => {
    if (current[0]!.length) {
      const edges = current.map(points => cutEdge({ points, ...(mode === 'monotone' ? { curve: monotoneSegments(points) } : {}) }, mode, range.lo, range.hi));
      if (edges[0]!.points.length) runs.push(edges);
    }
    current = rows.map(() => []);
  };
  for (const source of indexes) {
    if (range.invalid.has(source) || rows.some(row => row[source] === null)) {
      // An outside null never supplies an edge segment, even when inside gaps are bridged.
      if (!interpolateGaps || source < first || source > last || range.invalid.has(source)) flush();
      continue;
    }
    const ci = visible.get(source) ?? (source < first ? 0 : range.indexes.length - 1);
    rows.forEach((row, k) => current[k]!.push({ x: range.xs[source]!, y: row[source]!, ci }));
  }
  flush();
  return runs;
}

export function mapEdge(edge: RangeEdge, x: (v: number) => number, y: (v: number) => number): RangeEdge {
  const point = (p: Point): Point => ({ x: x(p.x), y: y(p.y) });
  return {
    points: edge.points.map(p => ({ ...point(p), ci: p.ci })),
    ...(edge.curve ? { curve: edge.curve.map(c => ({ from: point(c.from), c1: point(c.c1), c2: point(c.c2), to: point(c.to) })) } : {}),
  };
}

export function edgePath(edge: RangeEdge, path: (points: readonly Point[]) => string): string {
  return edge.curve ? curvePathFromSegments(edge.curve) : path(edge.points);
}
