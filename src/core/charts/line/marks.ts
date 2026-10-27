import { NOT_AVAILABLE, NOT_MEANINGFUL } from '../../format';
import { gapMarkerNode } from '../../dataGaps';
import { cubicPoint, curvePathFromSegments, drawnStroke, fmtPathNumber as fmtN, monotonePath, monotoneSegments, monotoneYAt, splitCurve, splitCurveSegmentsAtX, type CurveSegment } from '../../curve';
import type { Point, Rect } from '../../geometry';
import type { OccupiedIndex } from '../../label/occupied';
import { AREA_FILL_PART, PRIORITY, type LabelRequest } from '../../label/solver';
import { polylineYAt } from '../../label/areaGround';
import { isOthersFill, othersSeparation } from '../../markVisibility';
import { linePath } from '../../svgPath';
import { strokeToken, dashToken, markRolePaint, mixedPaint, seriesPaint as themeSeriesPaint } from '../../theme';
import type { FontSpec, TextMeasurer } from '../../text';
import type { Id, OwnerRef } from '../../types/cell';
import type { Category, MarkerShape } from '../../types/data';
import type { Theme } from '../../types/theme';
import type { Paint, PlacedLabel, SceneNode } from '../../types/scene';
import { defaultAnnotationId, type Annotation } from '../../types/annotations';
import { renderBumpTies } from './bump';
import type { NormSer } from './context';
import type { ForecastBoundary } from './forecast';
import type { BumpDerived, LineMarks, PhaseDerived } from './layout';
import type { LineInterpolation, LinePhase } from './types';
import { maxOf, minOf, pushAll } from '../../arrays';
import { cutEdge, edgePath, mapEdge, rangeRuns, type LineRange, type RangeEdge } from './range';

type LineVariant = 'line' | 'area' | 'stacked-area' | 'stacked100-area';

interface Pt extends Point {
  ci: number;
}

export interface LinePhaseResolved {
  phases: LinePhase[];
  /** The authored phases on source category ids, before a viewport keeps those with a reading in view. */
  authored?: LinePhase[];
  series: NormSer;
  interpolation: 'linear' | 'monotone';
}

export interface RenderedLineMarks {
  marks: LineMarks;
  baselineId: Id;
  analyticalSceneStart: number;
  paintedAreaCats: Map<Id, Set<number>>;
  rangeEdges?: Map<Id, { runs: Point[][]; bottom?: Point[] }>;
  /** The area fills as drawn, their edges flattened, for the shadings drawn over them. */
  areaOutlines: AreaOutline[];
}

export interface AreaOutline {
  id: Id;
  seriesId: Id;
  top: Point[];
  bottom: Point[];
  paint: Paint;
  forecast: boolean;
  /** A stacked band: its forecast keeps the solid fill under a light hatch overlay, and its values sit in their own band. */
  stacked?: true;
}

export function pathFor(points: readonly Point[], mode: LineInterpolation): string {
  if (mode === 'linear') return linePath(points.map((point) => ({ x: point.x, y: point.y })));
  if (mode === 'monotone') return monotonePath(points);
  if (points.length === 0) return '';
  let path = `M${fmtN(points[0]!.x)} ${fmtN(points[0]!.y)}`;
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]!;
    const point = points[index]!;
    const elbow = mode === 'step-after' ? { x: point.x, y: previous.y } : { x: previous.x, y: point.y };
    path += `L${fmtN(elbow.x)} ${fmtN(elbow.y)}L${fmtN(point.x)} ${fmtN(point.y)}`;
  }
  return path;
}

export function reversePathTail(points: readonly Point[], mode: LineInterpolation): string {
  if (points.length < 2) return '';
  if (mode === 'monotone') {
    return [...monotoneSegments(points)].reverse().map((segment) => `C${fmtN(segment.c2.x)} ${fmtN(segment.c2.y)} ${fmtN(segment.c1.x)} ${fmtN(segment.c1.y)} ${fmtN(segment.from.x)} ${fmtN(segment.from.y)}`).join('');
  }
  const expanded: Point[] = [points[0]!];
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]!;
    const point = points[index]!;
    if (mode === 'step-after') expanded.push({ x: point.x, y: previous.y });
    if (mode === 'step-before') expanded.push({ x: previous.x, y: point.y });
    expanded.push(point);
  }
  return [...expanded].reverse().slice(1).map((point) => `L${fmtN(point.x)} ${fmtN(point.y)}`).join('');
}

interface ClaimContext {
  lineOwner(seriesId: Id, categoryId: Id): OwnerRef;
  segment(a: Point, b: Point, categoryA: Id, categoryB: Id, seriesId: Id, thick?: number): void;
  areaPair(xA: number, xB: number, topA: number, topB: number, botA: number, botB: number, categoryA: Id, categoryB: Id, seriesId: Id, mode: LineInterpolation): void;
  linePair(a: Pt, b: Pt, categoryA: Id, categoryB: Id, seriesId: Id, mode: LineInterpolation): void;
  monotoneRun(points: Pt[], segments: readonly CurveSegment[], seriesId: Id): void;
}

function createClaims(occupied: OccupiedIndex, cats: Category[], inlineNamesEnabled: boolean): ClaimContext {
  const lineOwner = (seriesId: Id, categoryId: Id): OwnerRef => inlineNamesEnabled ? { seriesId } : { seriesId, categoryId };
  const segment = (a: Point, b: Point, categoryA: Id, categoryB: Id, seriesId: Id, thick = 3): void => {
    const chunks = Math.max(1, Math.min(8, Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / 14)));
    for (let index = 0; index < chunks; index++) {
      const t0 = index / chunks;
      const t1 = (index + 1) / chunks;
      const x0 = a.x + (b.x - a.x) * t0;
      const x1 = a.x + (b.x - a.x) * t1;
      const y0 = a.y + (b.y - a.y) * t0;
      const y1 = a.y + (b.y - a.y) * t1;
      const category = (t0 + t1) / 2 < 0.5 ? categoryA : categoryB;
      occupied.claim({ x: Math.min(x0, x1) - thick / 2, y: Math.min(y0, y1) - thick / 2, w: Math.abs(x1 - x0) + thick, h: Math.abs(y1 - y0) + thick }, 'mark', lineOwner(seriesId, category));
    }
  };
  // The band's own outline between x0 and x1, as its box plus the convex
  // polygon: boxes around a sloped band claimed the air over its low edge
  // and refused a value that cleared the fill by 6 px. Edges that cross
  // between x0 and x1 make two triangles.
  const outline = (x0: number, x1: number, top0: number, top1: number, bot0: number, bot1: number, owner: OwnerRef): void => {
    const t = (top0 - bot0) / ((top0 - bot0) - (top1 - bot1));
    const cross = { x: x0 + (x1 - x0) * t, y: top0 + (top1 - top0) * t };
    const polygons: Point[][] = t > 0 && t < 1
      ? [[{ x: x0, y: top0 }, cross, { x: x0, y: bot0 }], [cross, { x: x1, y: top1 }, { x: x1, y: bot1 }]]
      : [[{ x: x0, y: top0 }, { x: x1, y: top1 }, { x: x1, y: bot1 }, { x: x0, y: bot0 }]];
    for (const polygon of polygons) {
      const xs = polygon.map((point) => point.x);
      const ys = polygon.map((point) => point.y);
      const x = minOf(xs);
      const y = minOf(ys);
      occupied.claim({ x, y, w: maxOf(xs) - x, h: maxOf(ys) - y }, 'mark', owner, AREA_FILL_PART, polygon);
    }
  };
  // One trapezoid per category pair, cut at the midpoint so each half keeps
  // the owner of the value at its end, as the line's claims do. A step holds
  // A's value over the pair (after) or B's (before), so its halves are boxes.
  const areaPair = (xA: number, xB: number, topA: number, topB: number, botA: number, botB: number, categoryA: Id, categoryB: Id, seriesId: Id, mode: LineInterpolation): void => {
    const [t0, t1, b0, b1] = mode === 'linear' ? [topA, topB, botA, botB]
      : mode === 'step-after' ? [topA, topA, botA, botA] : [topB, topB, botB, botB];
    const xM = (xA + xB) / 2;
    const tM = (t0 + t1) / 2;
    const bM = (b0 + b1) / 2;
    outline(xA, xM, t0, tM, b0, bM, lineOwner(seriesId, categoryA));
    outline(xM, xB, tM, t1, bM, b1, lineOwner(seriesId, categoryB));
  };
  const linePair = (a: Pt, b: Pt, categoryA: Id, categoryB: Id, seriesId: Id, mode: LineInterpolation): void => {
    if (mode === 'linear') return segment(a, b, categoryA, categoryB, seriesId);
    const elbow: Pt = mode === 'step-after' ? { ci: b.ci, x: b.x, y: a.y } : { ci: a.ci, x: a.x, y: b.y };
    segment(a, elbow, categoryA, categoryA, seriesId);
    segment(elbow, b, categoryB, categoryB, seriesId);
  };
  const monotoneRun = (points: Pt[], segments: readonly CurveSegment[], seriesId: Id): void => {
    segments.forEach((curve) => {
      let index = 0;
      while (index < points.length - 2 && points[index + 1]!.x <= curve.from.x) index++;
      let previous = curve.from;
      for (let sample = 1; sample <= 8; sample++) {
        const point = cubicPoint(curve, sample / 8);
        segment(previous, point, cats[points[index]!.ci]!.id, cats[points[index + 1]!.ci]!.id, seriesId);
        previous = point;
      }
    });
  };
  return { lineOwner, segment, areaPair, linePair, monotoneRun };
}

interface SeriesGeometry {
  row: (number | null)[];
  runs: Pt[][];
  allPoints: Pt[];
  monotoneByRun?: Map<Pt[], CurveSegment[]>;
  fcStart: number;
  interpolation: LineInterpolation;
  bottomByRun?: Map<Pt[], AreaEdge>;
  forecastX?: number;
}

export function forecastStart(series: NormSer, cats: Category[]): number {
  return series.scenario === 'FC' ? 0 : cats.findIndex((_, ci) => series.vals[ci]!.scenario === 'FC');
}

/**
 * The last category before the forecast `start` that holds an actual value,
 * where the series' dashes start: a line bridges a gap from its last value.
 * A stacked band draws every category, so it is the one before `start`.
 */
export function lastActualIndex(series: NormSer, start: number, stacked: boolean): number {
  let ci = start - 1;
  while (!stacked && ci > 0 && series.vals[ci]!.v === null) ci--;
  return ci;
}

/**
 * Where the actual-to-forecast boundary before `categoryIndex` is drawn. A
 * line or an area ends its actual paint at the last actual point ('point').
 * A plain line's divider and a category band's divider keep the gap before
 * the first forecast category ('band'), even with missing actual values. Filled charts
 * keep the divider at the fill change ('point').
 */
export function forecastBoundaryX(boundary: { categoryIndex: number; lastActualIndex: number }, xOf: (categoryIndex: number) => number, at: 'point' | 'band'): number {
  return at === 'point' ? xOf(boundary.lastActualIndex) : (xOf(boundary.categoryIndex - 1) + xOf(boundary.categoryIndex)) / 2;
}

function buildSeriesGeometry(input: RenderLineMarksInput, series: NormSer, dataIdx: number): SeriesGeometry {
  const row = input.pv[input.rowOf.get(series)!]!;
  const runs: Pt[][] = [];
  let current: Pt[] = [];
  input.cats.forEach((_, ci) => {
    if (input.compositionInvalidAt(ci)) {
      if (current.length > 0) runs.push(current);
      current = [];
      return;
    }
    const isNull = row[ci] === null;
    if (isNull && !input.isStacked) {
      if (!series.interpolateGaps) {
        if (current.length > 0) runs.push(current);
        current = [];
      }
      return;
    }
    const value = input.isStacked ? input.y(input.cumTop[dataIdx]![ci]!) : row[ci] === null ? null : input.y(row[ci]!);
    if (value !== null) current.push({ ci, x: input.xOf(ci), y: value });
  });
  if (current.length > 0) runs.push(current);
  const interpolation = input.interpolationFor(series);
  const allPoints = runs.flat();
  if (input.range && input.xOfValue) {
    const range = input.range;
    const sourceRow = range.plotted[input.rowOf.get(series)!]!;
    const top = input.isStacked ? range.cumTop[dataIdx]!.map((v, i) => sourceRow[i] === null && (i <= range.indexes[0]! || i >= range.indexes[range.indexes.length - 1]!) ? null : v) : sourceRow;
    const rows = input.isStacked ? [top, range.cumBot[dataIdx]!] : [top];
    const clipped = rangeRuns(range, rows, interpolation, series.interpolateGaps);
    const mapped = clipped.map(edges => edges.map(edge => mapEdge(edge, input.xOfValue!, input.y)));
    const rangedRuns = mapped.map(edges => edges[0]!.points);
    const values = range.values.get(series.id)!;
    const fc = series.scenario === 'FC' ? 0 : values.findIndex(v => v.scenario === 'FC');
    let actual = fc - 1;
    while (!input.isStacked && actual > 0 && values[actual]!.v === null) actual--;
    return {
      row, runs: rangedRuns, allPoints, interpolation, fcStart: forecastStart(series, input.cats),
      ...(fc < 0 ? {} : { forecastX: input.xOfValue(fc === 0 ? range.lo : range.xs[actual]!) }),
      ...(interpolation === 'monotone' ? { monotoneByRun: new Map(rangedRuns.map((run, i) => [run, mapped[i]![0]!.curve!])) } : {}),
      ...(input.isStacked ? { bottomByRun: new Map(rangedRuns.map((run, i) => [run, { ...mapped[i]![1]!, mode: interpolation }])) } : {}),
    };
  }
  return {
    row,
    runs,
    allPoints,
    ...(interpolation === 'monotone' ? { monotoneByRun: new Map(runs.map((run) => [run, monotoneSegments(run)])) } : {}),
    fcStart: forecastStart(series, input.cats),
    interpolation,
  };
}

interface AreaEdge {
  points: readonly Point[];
  mode: LineInterpolation;
  curve?: readonly CurveSegment[];
}

function splitAreaEdge(edge: AreaEdge, x: number): [AreaEdge, AreaEdge] {
  if (edge.curve) {
    const [before, after] = splitCurveSegmentsAtX(edge.curve, x);
    return [{ ...edge, curve: before }, { ...edge, curve: after }];
  }
  const index = edge.points.findIndex((point) => point.x >= x);
  const to = edge.points[index]!;
  if (to.x === x) {
    return [{ ...edge, points: edge.points.slice(0, index + 1) }, { ...edge, points: edge.points.slice(index) }];
  }
  const from = edge.points[index - 1]!;
  const y = edge.mode === 'step-after' ? from.y : edge.mode === 'step-before' ? to.y
    : from.y + (to.y - from.y) * ((x - from.x) / (to.x - from.x));
  const boundary = { x, y };
  return [
    { ...edge, points: [...edge.points.slice(0, index), boundary] },
    { ...edge, points: [boundary, ...edge.points.slice(index)] },
  ];
}

function closedAreaPath(upper: AreaEdge, lower: AreaEdge): string {
  const top = upper.curve ? curvePathFromSegments(upper.curve) : pathFor(upper.points, upper.mode);
  const end = lower.curve ? lower.curve[lower.curve.length - 1]!.to : lower.points[lower.points.length - 1]!;
  const reverse = lower.curve
    ? [...lower.curve].reverse().map((segment) => `C${fmtN(segment.c2.x)} ${fmtN(segment.c2.y)} ${fmtN(segment.c1.x)} ${fmtN(segment.c1.y)} ${fmtN(segment.from.x)} ${fmtN(segment.from.y)}`).join('')
    : reversePathTail(lower.points, lower.mode);
  return `${top}L${fmtN(end.x)} ${fmtN(end.y)}${reverse}Z`;
}

function areaSections(upper: AreaEdge, lower: AreaEdge, forecastX: number | undefined): { d: string; forecast: boolean; upper: AreaEdge; lower: AreaEdge }[] {
  const first = upper.points[0]!;
  const last = upper.points[upper.points.length - 1]!;
  if (forecastX === undefined || forecastX >= last.x) return [{ d: closedAreaPath(upper, lower), forecast: false, upper, lower }];
  if (forecastX <= first.x) return [{ d: closedAreaPath(upper, lower), forecast: true, upper, lower }];
  const [actualTop, forecastTop] = splitAreaEdge(upper, forecastX);
  const [actualBottom, forecastBottom] = splitAreaEdge(lower, forecastX);
  return [
    { d: closedAreaPath(actualTop, actualBottom), forecast: false, upper: actualTop, lower: actualBottom },
    { d: closedAreaPath(forecastTop, forecastBottom), forecast: true, upper: forecastTop, lower: forecastBottom },
  ];
}

/** An area edge as the polyline it draws: the curve flattened, a step through its elbows. */
function edgePolyline(edge: AreaEdge): Point[] {
  if (edge.curve && edge.curve.length > 0) {
    return [edge.curve[0]!.from, ...edge.curve.flatMap((segment) => Array.from({ length: 16 }, (_, k) => cubicPoint(segment, (k + 1) / 16)))];
  }
  return drawnStroke(edge.points, edge.mode);
}

/**
 * A polyline's y at ascending x, approached from the left or the right, so a
 * step's vertical edge keeps both ends. It walks forward: each call's x is
 * at least the previous one's.
 */
function sideWalker(line: readonly Point[]): (x: number, side: 'left' | 'right') => number {
  let i = 1;
  return (x, side) => {
    if (x < line[0]!.x || (x === line[0]!.x && side === 'left')) return line[0]!.y;
    while (i < line.length && line[i]!.x < x) i++;
    let j = i;
    if (side === 'right') while (j < line.length && line[j]!.x <= x) j++;
    if (j >= line.length) return line[line.length - 1]!.y;
    const a = line[j - 1]!;
    const b = line[j]!;
    return b.x === a.x ? b.y : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
  };
}

/**
 * The part of an area fill inside a rect, as path data and its upper and
 * lower edge: between the two edges, whichever is on top, clamped to the
 * rect's rows. Every kink of that clamp sits at a break, so the outline is
 * exact for the flattened edges. Undefined when they do not meet.
 */
function areaInRect(top: readonly Point[], bottom: readonly Point[], rect: Rect): { d: string; upper: Point[]; lower: Point[] } | undefined {
  const x0 = Math.max(top[0]!.x, bottom[0]!.x, rect.x);
  const x1 = Math.min(top[top.length - 1]!.x, bottom[bottom.length - 1]!.x, rect.x + rect.w);
  if (!(x1 > x0)) return undefined;
  const rows = [rect.y, rect.y + rect.h] as const;
  const crossings = (line: readonly Point[]) => line.flatMap((b, i) => {
    const a = line[i - 1];
    return a ? rows.flatMap((row) => ((a.y - row) * (b.y - row) < 0 ? [a.x + ((row - a.y) * (b.x - a.x)) / (b.y - a.y)] : [])) : [];
  });
  const sorted = (xs: number[]) => [...new Set(xs.filter((x) => x >= x0 && x <= x1))].sort((a, b) => a - b);
  const breaks = sorted([x0, x1, ...top.map((p) => p.x), ...bottom.map((p) => p.x), ...crossings(top), ...crossings(bottom)]);
  // Where the edges cross (a fill over and under the baseline), the upper one changes.
  const [topA, bottomA] = [sideWalker(top), sideWalker(bottom)];
  const gaps = breaks.map((x) => [topA(x, 'left') - bottomA(x, 'left'), topA(x, 'right') - bottomA(x, 'right')] as const);
  const swaps = breaks.flatMap((p, i) => {
    const q = breaks[i + 1];
    const gp = gaps[i]![1];
    const gq = gaps[i + 1]?.[0];
    return q !== undefined && gq !== undefined && gp * gq < 0 ? [p + ((q - p) * gp) / (gp - gq)] : [];
  });
  const clamp = (y: number) => Math.min(Math.max(y, rows[0]), rows[1]);
  const [topB, bottomB] = [sideWalker(top), sideWalker(bottom)];
  const upper: Point[] = [];
  const lower: Point[] = [];
  let open = false;
  for (const x of sorted([...breaks, ...swaps])) {
    for (const side of ['left', 'right'] as const) {
      const t = topB(x, side);
      const b = bottomB(x, side);
      const u = { x, y: clamp(Math.min(t, b)) };
      const l = { x, y: clamp(Math.max(t, b)) };
      open ||= l.y - u.y > 0.01;
      const prevU = upper[upper.length - 1];
      if (!prevU || prevU.x !== u.x || prevU.y !== u.y) upper.push(u);
      const prevL = lower[lower.length - 1];
      if (!prevL || prevL.x !== l.x || prevL.y !== l.y) lower.push(l);
    }
  }
  if (!open) return undefined;
  return { d: `${linePath(upper)}${[...lower].reverse().map((p) => `L${fmtN(p.x)} ${fmtN(p.y)}`).join('')}Z`, upper, lower };
}

/**
 * bandHatchPath over a piece whose edges may step (two points on one x): one
 * straight stretch at a time, each edge taken from the stretch's own side of a
 * step, so no stripe crosses a step's vertical edge. The stripes keep one phase.
 */
function pieceHatchPath(upper: readonly Point[], lower: readonly Point[], gap: number): string {
  const xs = [...new Set([...upper, ...lower].map((point) => point.x))].sort((a, b) => a - b);
  const [up, low] = [sideWalker(upper), sideWalker(lower)];
  return xs.slice(0, -1).map((p, i) => {
    const q = xs[i + 1]!;
    const stretch = (walk: typeof up) => ({ points: [{ x: p, y: walk(p, 'right') }, { x: q, y: walk(q, 'left') }], mode: 'linear' as const });
    return bandHatchPath(stretch(up), stretch(low), gap);
  }).join('');
}

/** How much of a shading's own colour shows where it lies over an area fill. */
const SHADING_OVER_FILL = 0.35;

/**
 * A value-axis shading (corridor, tolerance, attainment) where an area fill
 * covers it: the fill's colour mixed with the shading's, as one solid
 * colour, so the shading's whole value range reads through the fill like glass
 * and the fill keeps its shape. The shade above the fill stays as drawn.
 * A hatched fill keeps its hatch. A hatched (forecast) shading over a solid
 * fill draws the fill's forecast overlay on the mix (`hatch`), as a stacked
 * band's forecast does: a page hatch there would cut a hole in the fill.
 * A stacked band's forecast keeps that overlay on the mix too.
 */
export function shadingOverFills(shading: Extract<SceneNode, { t: 'rect' }>, outlines: readonly AreaOutline[], hatch: { gap: number; width: number; share: number }): SceneNode[] {
  return outlines.flatMap((outline, k): SceneNode[] => {
    const piece = areaInRect(outline.top, outline.bottom, shading.rect);
    if (!piece) return [];
    const fill = mixedPaint(shading.fill, outline.paint, SHADING_OVER_FILL, 'token' in outline.paint ? outline.paint.token : 'background');
    const patterned = outline.forecast && !outline.stacked;
    const node: SceneNode = { t: 'path', id: `${shading.id}:over:${k}`, d: piece.d, fill, ...(patterned ? { pattern: 'hatch45' as const } : {}), owner: shading.owner, part: 'shadingOverFill' };
    if (patterned || (shading.pattern !== 'hatch45' && !outline.forecast)) return [node];
    const stripes = pieceHatchPath(piece.upper, piece.lower, hatch.gap);
    return stripes ? [node, {
      t: 'path', id: `${shading.id}:over:${k}:hatch`, d: stripes,
      stroke: mixedPaint({ token: 'background' }, fill, hatch.share, 'token' in outline.paint ? outline.paint.token : 'background'), width: hatch.width,
      owner: shading.owner, part: 'shadingOverFill',
    }] : [node];
  });
}

/** The annotations the annotation pass runs over: events belong to the event lane. */
export function withoutEvents(annotations: readonly Annotation[]): Annotation[] {
  return annotations.filter((annotation) => annotation.kind !== 'event');
}

/**
 * How each annotation shades the plot behind an area fill, by its kind and
 * style: an era shade spans categories, a value-axis shading (corridor,
 * tolerance, attainment) spans values. Its paint does not tell them apart: an
 * actual or forecast corridor takes the untinted Others fill of an era shade.
 * `annotations` is the list the annotation pass ran over, so ids match.
 */
export function fillShadingKinds(annotations: readonly Annotation[]): Map<Id, 'era' | 'value'> {
  const kinds = new Map<Id, 'era' | 'value'>();
  annotations.forEach((annotation, index) => {
    const id = defaultAnnotationId(annotation, index);
    if (annotation.kind === 'valueLine') kinds.set(id, 'value');
    else if (annotation.kind !== 'band') return;
    else if (annotation.style === 'corridor' || annotation.style === 'tolerance' || annotation.style === 'attainment') kinds.set(id, 'value');
    else if ((annotation.style ?? 'shade') === 'shade') kinds.set(id, 'era');
  });
  return kinds;
}

/**
 * Annotations whose shading draws a mix over an area fill (fillShadings),
 * which the label plan cannot see: another series' value keeps off the fills
 * there. An enabled attainment counts, on a band or on a valueLine. An era
 * shade only cuts page-colour edges through the fill, under every label.
 */
export function shadesFills(annotations: readonly Annotation[]): boolean {
  return annotations.some((annotation) => (annotation.kind === 'band' && (annotation.style === 'corridor' || annotation.style === 'tolerance' || annotation.style === 'attainment'))
    || (annotation.kind === 'valueLine' && (annotation.tolerance !== undefined || (annotation.attainment !== undefined && annotation.attainment !== false))));
}

/** A value-axis shading's mix over one area fill: the ground of that series' own values inside it. */
export interface ShadingGround {
  seriesId: Id;
  rect: Rect;
  paint: Paint;
  pattern?: 'hatch45';
}

/**
 * The shadings behind area fills, drawn through them: each value-axis
 * shading reads through each fill as a mix (shadingOverFills), and each era
 * shade edge inside the plot cuts through the fill in the page colour, like
 * the seams between stacked bands, so the period reads over the full plot
 * height and the data keeps its own colour. The edges draw over the mixes.
 */
export function fillShadings(
  nodes: readonly SceneNode[], outlines: readonly AreaOutline[], kinds: ReadonlyMap<Id, 'era' | 'value'>, plot: Rect, ruleWidth: number,
  hatch: { gap: number; width: number; share: number },
): { nodes: SceneNode[]; grounds: ShadingGround[] } {
  const kindOf = (node: SceneNode): 'era' | 'value' | undefined =>
    node.t === 'rect' && (node.part === 'band' || node.part === 'attainment') && !('token' in node.fill && node.fill.token === 'background')
      ? kinds.get(node.owner.annotationId ?? '') : undefined;
  const shadings = nodes.filter((node): node is Extract<SceneNode, { t: 'rect' }> => kindOf(node) === 'value');
  const over = shadings.flatMap((node) => shadingOverFills(node, outlines, hatch));
  const grounds = shadings.flatMap((node) => outlines.flatMap((outline, k): ShadingGround[] => {
    const mix = over.find((piece) => piece.id === `${node.id}:over:${k}`);
    return mix && mix.t === 'path' && mix.fill ? [{ seriesId: outline.seriesId, rect: node.rect, paint: mix.fill, ...(mix.pattern === 'hatch45' ? { pattern: 'hatch45' as const } : {}) }] : [];
  }));
  const edges = nodes.filter((node): node is Extract<SceneNode, { t: 'rect' }> => kindOf(node) === 'era').flatMap((node) => {
    const { x, y: top, w, h } = node.rect;
    return [x, x + w].filter((at) => at > plot.x + 0.5 && at < plot.x + plot.w - 0.5).map((at, k): SceneNode => ({
      t: 'line', id: `${node.id}:edge:${k}`, x1: at, y1: top, x2: at, y2: top + h,
      stroke: { token: 'background' }, width: ruleWidth, owner: node.owner, part: 'bandEdge',
    }));
  });
  return { nodes: [...over, ...edges], grounds };
}

/**
 * A value on its own series' fill took its ink against that fill. Where it
 * lies wholly on a shading's mix over that fill, it takes its ink against the
 * mix instead; where it lies partly on a mix, against the fill and every mix
 * it touches, so the ink reads on each part of its ground.
 */
export function regroundOnShadings(labels: readonly PlacedLabel[], grounds: readonly ShadingGround[]): void {
  if (grounds.length === 0) return;
  for (const label of labels) {
    const ink = label.ink;
    if (!('token' in ink) || ink.theme?.kind !== 'contrast-ink' || label.owner.seriesId === undefined) continue;
    const { rect } = label;
    const share = (ground: ShadingGround) => {
      const w = Math.min(rect.x + rect.w, ground.rect.x + ground.rect.w) - Math.max(rect.x, ground.rect.x);
      const h = Math.min(rect.y + rect.h, ground.rect.y + ground.rect.h) - Math.max(rect.y, ground.rect.y);
      return w > 0 && h > 0 ? (w * h) / Math.max(rect.w * rect.h, 1e-9) : 0;
    };
    const touched = grounds.filter((candidate) => candidate.seriesId === label.owner.seriesId && share(candidate) > 0);
    const whole = touched.find((candidate) => share(candidate) > 0.999);
    if (whole) label.ink = { ...ink, theme: { kind: 'contrast-ink', fill: whole.paint, ...(whole.pattern ? { pattern: whole.pattern } : {}) } };
    else if (touched.length > 0) label.ink = { ...ink, theme: { ...ink.theme, also: touched.map((ground) => ground.paint) } };
  }
}

/**
 * The forecast hatch of a stacked band as a light overlay.
 * The band keeps its own fill, so the ramp stays readable, and 45° lines in
 * the page colour mark it as forecast, at the pitch and weight of the
 * theme's hatch. Each line is clipped to the band between its edges, and
 * the lines share one phase across the plot, so they meet at band edges as
 * one pattern would. Returns the path data, empty when no line crosses.
 */
function bandHatchPath(upper: AreaEdge, lower: AreaEdge, gap: number): string {
  let top = edgePolyline(upper);
  let bottom = edgePolyline(lower);
  // A reversed value axis exchanges the screen edges of the band.
  if (top.some(point => point.y > polylineYAt(bottom, point.x))) [top, bottom] = [bottom, top];
  const x0 = Math.max(top[0]!.x, bottom[0]!.x);
  const x1 = Math.min(top[top.length - 1]!.x, bottom[bottom.length - 1]!.x);
  if (!(x1 > x0)) return '';
  const breaks = [...new Set([x0, x1, ...[...top, ...bottom].map((p) => p.x).filter((x) => x > x0 && x < x1)])].sort((a, b) => a - b);
  // A '/' line is x + y = c; lines `gap` apart sit `gap·√2` apart in c.
  const step = gap * Math.SQRT2;
  const sums = breaks.flatMap((x) => [x + polylineYAt(top, x), x + polylineYAt(bottom, x)]);
  let d = '';
  for (let c = Math.ceil(minOf(sums) / step) * step; c <= maxOf(sums); c += step) {
    let open: number | undefined;
    let close: number | undefined;
    const flush = () => {
      if (open !== undefined && close !== undefined && close - open > 0.01) d += `M${fmtN(open)} ${fmtN(c - open)}L${fmtN(close)} ${fmtN(c - close)}`;
      open = undefined;
      close = undefined;
    };
    for (let i = 0; i + 1 < breaks.length; i++) {
      const p = breaks[i]!;
      const q = breaks[i + 1]!;
      // Inside the band where the line runs under the top edge and over the bottom one.
      const over = (x: number) => c - x - polylineYAt(top, x);
      const under = (x: number) => polylineYAt(bottom, x) - (c - x);
      let lo = p;
      let hi = q;
      for (const f of [over, under]) {
        const fp = f(p);
        const fq = f(q);
        if (fp < 0 && fq < 0) { lo = Infinity; break; }
        if (fp < 0 || fq < 0) {
          const root = p + ((q - p) * fp) / (fp - fq);
          if (fp < 0) lo = Math.max(lo, root);
          else hi = Math.min(hi, root);
        }
      }
      if (lo >= hi) { flush(); continue; }
      if (open !== undefined && close !== undefined && Math.abs(close - lo) < 1e-6) close = hi;
      else { flush(); open = lo; close = hi; }
    }
    flush();
  }
  return d;
}

function renderArea(input: RenderLineMarksInput, series: NormSer, dataIdx: number, entry: LineMarks['series'][number], geometry: SeriesGeometry, claims: ClaimContext, paintedAreaCats: Map<Id, Set<number>>, outlines: AreaOutline[]): void {
  if (input.isArea && input.isStacked) renderIsolatedStacks(input, series, dataIdx, entry, geometry, paintedAreaCats);
  if (!input.areaFilled(series) || !geometry.runs.some(run => run.length >= 2)) return;
  const bottomAt = (ci: number): number => input.isStacked ? input.y(input.cumBot[dataIdx]![ci]!) : input.baseY;
  // A fill breaks where its line breaks, so no fill spans a null the line leaves open.
  const fillRuns = !input.range && series.interpolateGaps && geometry.interpolation === 'linear' && !input.hasSuppressed100 ? [geometry.allPoints] : geometry.runs.filter((run) => run.length >= 2);
  const painted = paintedAreaCats.get(series.id) ?? new Set<number>();
  paintedAreaCats.set(series.id, painted);
  const forecastX = geometry.forecastX ?? (geometry.fcStart < 0 ? undefined : geometry.fcStart === 0 ? input.xOf(0)
    : forecastBoundaryX({ categoryIndex: geometry.fcStart, lastActualIndex: lastActualIndex(series, geometry.fcStart, input.isStacked) }, input.xOf, 'point'));
  fillRuns.forEach((run, runIndex) => {
    for (const point of run) painted.add(point.ci);
    const upper: AreaEdge = { points: run, mode: geometry.interpolation, curve: geometry.monotoneByRun?.get(run) };
    const lower = geometry.bottomByRun?.get(run)?.points ?? run.map((point) => ({ x: point.x, y: bottomAt(point.ci) }));
    const lowerMode = input.isStacked ? geometry.interpolation : 'linear';
    const lowerEdge: AreaEdge = geometry.bottomByRun?.get(run) ?? { points: lower, mode: lowerMode, ...(lowerMode === 'monotone' ? { curve: monotoneSegments(lower) } : {}) };
    const id = `mark:area:${series.id}${runIndex === 0 ? '' : `:${runIndex}`}`;
    areaSections(upper, lowerEdge, forecastX).forEach((section, index) => {
      // A stacked band keeps its fill under a light hatch overlay.
      const overlay = section.forecast && input.isStacked && input.hatch !== undefined;
      const areaPaint = input.areaFillPaint(series, dataIdx, section.forecast);
      // The Others family rule: a pale Rest band takes the separation outline (a hatched forecast stays as drawn).
      const sep = section.forecast ? undefined : othersSeparation(areaPaint, input.theme);
      outlines.push({ id: index === 0 ? id : `${id}:fc`, seriesId: series.id, top: edgePolyline(section.upper), bottom: edgePolyline(section.lower), paint: areaPaint, forecast: section.forecast, ...(input.isStacked ? { stacked: true as const } : {}) });
      input.nodes.push({ t: 'path', id: index === 0 ? id : `${id}:fc`, d: section.d, fill: areaPaint, ...(section.forecast && !overlay ? { pattern: 'hatch45' as const } : {}), ...(sep ? { stroke: sep.stroke, width: sep.strokeWidth } : {}), ...(!section.forecast && isOthersFill(areaPaint) ? { separation: { fill: areaPaint, backing: { token: 'background' } as const } } : {}), owner: { seriesId: series.id }, part: 'area' });
      const hatch = overlay ? bandHatchPath(section.upper, section.lower, input.hatch!.gap) : '';
      // Stripes at half the theme's width leave each band's own
      // colour the larger share, so its key swatch still reads under the hatch.
      // The stripe is the page colour at `share` over the band's own fill, as ONE solid
      // colour (no stroke-opacity, which an importer may drop), so the forecast reads as a faint texture.
      if (hatch) input.nodes.push({ t: 'path', id: `${id}:fc:hatch`, d: hatch, stroke: mixedPaint({ token: 'background' }, areaPaint, input.hatch!.share, 'token' in areaPaint ? areaPaint.token : 'background'), width: input.hatch!.width, owner: { seriesId: series.id }, part: 'forecastHatch' });
    });
    if (!entry.areaNodeId) entry.areaNodeId = id;
    for (let index = 0; index + 1 < run.length; index++) {
      const from = run[index]!;
      const to = run[index + 1]!;
      if (geometry.interpolation === 'monotone') {
        const top = Math.min(from.y, to.y, lower[index]!.y, lower[index + 1]!.y);
        const bottom = Math.max(from.y, to.y, lower[index]!.y, lower[index + 1]!.y);
        input.occupied.claim({ x: from.x, y: top, w: to.x - from.x, h: Math.max(bottom - top, 1) }, 'mark', claims.lineOwner(series.id, input.cats[from.ci]!.id), AREA_FILL_PART);
      } else claims.areaPair(from.x, to.x, from.y, to.y, lower[index]!.y, lower[index + 1]!.y, input.cats[from.ci]!.id, input.cats[to.ci]!.id, series.id, geometry.interpolation);
    }
  });
}

function emitLinePath(input: RenderLineMarksInput, series: NormSer, dataIdx: number, entry: LineMarks['series'][number], geometry: SeriesGeometry, claims: ClaimContext, run: Pt[], runIndex: number, points: Pt[], curve: readonly CurveSegment[], dashed: boolean, solidHasPath: boolean): void {
  if (geometry.monotoneByRun ? curve.length === 0 : points.length < 2) return;
  const id = `mark:line:${series.id}:${runIndex}${dashed ? ':fc' : ''}`;
  // A stacked band's edge, actual and forecast alike, is a thin separator in the page
  // colour; the hatch overlay, the AC | FC divider and the F-suffixed ticks say "forecast".
  const separator = input.isArea && input.isStacked && input.hatch !== undefined;
  const dash = separator ? undefined : dashed ? dashToken(input.theme, 'reference') : input.dashOf(series, dataIdx);
  const path = geometry.monotoneByRun ? curvePathFromSegments(curve) : pathFor(points, geometry.interpolation);
  // A series an unstacked area draws as a line is a line: casing, claims and bridged gaps.
  const filled = input.areaFilled(series);
  if (!filled) input.nodes.push({ t: 'path', id: `casing:${id}`, d: path, stroke: { token: 'background' }, width: strokeToken(input.theme, 'casing'), owner: { seriesId: series.id }, part: 'lineCasing' });
  input.nodes.push({ t: 'path', id, d: path, stroke: separator ? { token: 'background' } : dashed ? input.forecastLinePaint(series, dataIdx) : input.seriesPaint(series, dataIdx), width: separator ? strokeToken(input.theme, 'rule') : input.lineWidthOf(series), ...(dash ? { dash, lineCap: dash.join(',') === dashToken(input.theme, 'dotted').join(',') ? 'round' as const : 'butt' as const } : {}), owner: { seriesId: series.id }, part: 'line' });
  if (input.lineHollowOf(series)) input.nodes.push({
    t: 'path', id: `${id}:inner`, d: path, stroke: { token: 'background' },
    width: strokeToken(input.theme, 'hair'), ...(dash ? { dash, lineCap: dash.join(',') === dashToken(input.theme, 'dotted').join(',') ? 'round' as const : 'butt' as const } : {}),
    owner: { seriesId: series.id }, part: 'lineInterior',
  });
  if (dashed && !entry.fcPathNodeId) entry.fcPathNodeId = id;
  if (!dashed && !entry.pathNodeId) entry.pathNodeId = id;
  if (dashed && !entry.pathNodeId && !solidHasPath) entry.pathNodeId = id;
  if (filled) return;
  if (geometry.monotoneByRun) claims.monotoneRun(run, curve, series.id);
  else for (let index = 0; index + 1 < points.length; index++) claims.linePair(points[index]!, points[index + 1]!, input.cats[points[index]!.ci]!.id, input.cats[points[index + 1]!.ci]!.id, series.id, geometry.interpolation);
}

/**
 * A stacked category with no drawable neighbour (the one valid share
 * beside an n.m. one) has no band to draw, so its parts stand as a short
 * stacked column in the series fills: the key names them, and the values
 * print on them instead of floating over an empty plot.
 */
function renderIsolatedStacks(input: RenderLineMarksInput, series: NormSer, dataIdx: number, entry: LineMarks['series'][number], geometry: SeriesGeometry, paintedAreaCats: Map<Id, Set<number>>): void {
  const lone = geometry.runs.filter((run) => run.length === 1).map((run) => run[0]!);
  if (lone.length === 0 || (geometry.interpolation === 'linear' && !input.hasSuppressed100 && geometry.allPoints.length >= 2)) return;
  const painted = paintedAreaCats.get(series.id) ?? new Set<number>();
  paintedAreaCats.set(series.id, painted);
  const w = 32;
  for (const point of lone) {
    const top = input.y(input.cumTop[dataIdx]![point.ci]!);
    const bottom = input.y(input.cumBot[dataIdx]![point.ci]!);
    if (!(bottom - top > 0)) continue;
    painted.add(point.ci);
    const x = Math.max(input.plot.x, Math.min(point.x - w / 2, input.plot.x + input.plot.w - w));
    const rect = { x, y: top, w, h: bottom - top };
    const owner = { seriesId: series.id, categoryId: input.cats[point.ci]!.id };
    const id = `mark:stack:${series.id}:${owner.categoryId}`;
    const fill = input.areaFillPaint(series, dataIdx, false);
    const sep = othersSeparation(fill, input.theme);
    input.nodes.push({ t: 'rect', id, rect, fill, ...(sep ? { stroke: sep.stroke, strokeWidth: sep.strokeWidth } : {}), ...(isOthersFill(fill) ? { separation: { fill, backing: { token: 'background' } as const } } : {}), owner, part: 'segment' });
    if (!entry.areaNodeId) entry.areaNodeId = id;
    input.occupied.claim(rect, 'mark', owner);
  }
}

function renderLinePaths(input: RenderLineMarksInput, series: NormSer, dataIdx: number, entry: LineMarks['series'][number], geometry: SeriesGeometry, claims: ClaimContext): void {
  // The stacked100-area band boundaries have one separator, with no series stroke
  // underneath it and no extra line along the constant 100% edge.
  if (input.variant === 'stacked100-area') return;
  geometry.runs.forEach((run, runIndex) => {
    if (run.length < 2) return;
    let solidPoints = run;
    let fcPoints: Pt[] = [];
    let solidCurve = geometry.monotoneByRun?.get(run) ?? [];
    let fcCurve: CurveSegment[] = [];
    if (input.range && geometry.forecastX !== undefined) {
      const edge: RangeEdge = { points: run, ...(geometry.monotoneByRun ? { curve: solidCurve } : {}) };
      const before = cutEdge(edge, geometry.interpolation, -Infinity, geometry.forecastX);
      const after = cutEdge(edge, geometry.interpolation, geometry.forecastX, Infinity);
      solidPoints = before.points; fcPoints = after.points;
      solidCurve = before.curve ?? []; fcCurve = after.curve ?? [];
    } else if (geometry.fcStart !== -1) {
      const splitAt = run.findIndex((point) => point.ci >= geometry.fcStart);
      if (splitAt === 0) {
        solidPoints = [];
        fcPoints = run;
        fcCurve = solidCurve;
        solidCurve = [];
      } else if (splitAt > 0) {
        solidPoints = run.slice(0, splitAt);
        fcPoints = run.slice(splitAt - 1);
        if (geometry.monotoneByRun) [solidCurve, fcCurve] = splitCurveSegmentsAtX(solidCurve, run[splitAt - 1]!.x);
      }
    }
    const solidHasPath = geometry.monotoneByRun ? solidCurve.length > 0 : solidPoints.length >= 2;
    emitLinePath(input, series, dataIdx, entry, geometry, claims, run, runIndex, solidPoints, solidCurve, false, solidHasPath);
    emitLinePath(input, series, dataIdx, entry, geometry, claims, run, runIndex, fcPoints, fcCurve, true, solidHasPath);
    if (!input.areaFilled(series) && series.interpolateGaps) markBridgedGaps(input, series, dataIdx, geometry, run, runIndex);
  });
}

/**
 * Where a line bridges a null, the bridge is dashed (the drawn
 * stretch is painted over in the page colour and redrawn in dashes) and each
 * missing category gets a hollow ring on the bridge, so an interpolated
 * stretch never reads as measured.
 */
function markBridgedGaps(input: RenderLineMarksInput, series: NormSer, dataIdx: number, geometry: SeriesGeometry, run: Pt[], runIndex: number): void {
  const curve = geometry.monotoneByRun?.get(run);
  const paint = series.role === 'reference' ? input.refPaintOf(series) : input.seriesPaint(series, dataIdx);
  const width = series.role === 'reference' ? strokeToken(input.theme, 'rule') : input.lineWidthOf(series);
  for (let k = 0; k + 1 < run.length; k++) {
    const [a, b] = [run[k]!, run[k + 1]!];
    if (b.ci - a.ci < 2) continue;
    const segment = curve?.[k];
    const d = segment ? curvePathFromSegments([segment]) : pathFor([a, b], geometry.interpolation);
    const id = `bridge:${series.id}:${runIndex}:${a.ci}`;
    input.nodes.push({ t: 'path', id: `${id}:erase`, d, stroke: { token: 'background' }, width: strokeToken(input.theme, 'casing'), owner: { seriesId: series.id }, part: 'lineCasing' });
    input.nodes.push({ t: 'path', id, d, stroke: paint, width, dash: dashToken(input.theme, 'reference'), owner: { seriesId: series.id }, part: 'gapBridge' });
    for (let ci = a.ci + 1; ci < b.ci; ci++) {
      const x = input.xOf(ci);
      const t = (x - a.x) / (b.x - a.x);
      const y = segment ? cubicPoint(segment, t).y : geometry.interpolation === 'step-after' ? a.y : geometry.interpolation === 'step-before' ? b.y : a.y + (b.y - a.y) * t;
      input.nodes.push(gapMarkerNode(input.theme, { id: `gap:${series.id}:${input.cats[ci]!.id}`, x, y, ink: paint, owner: { seriesId: series.id, categoryId: input.cats[ci]!.id } }));
    }
  }
}

function markerDisplay(input: RenderLineMarksInput, series: NormSer, row: (number | null)[], ci: number): { value: string; state?: string } {
  const cell = series.vals[ci]!;
  return {
    value: input.rebased ? input.fmt(row[ci]!) : cell.isPct ? cell.format ? input.seriesFmt({ ...series, format: cell.format })(cell.v!) : input.authoredPctFmt(cell.v!) : input.variant === 'stacked100-area' ? input.shareTexts.get(`${input.cats[ci]!.id}\0${series.id}`) ?? input.pctFmt(row[ci]!) : input.seriesFmt(cell.format ? { ...series, format: cell.format } : series)(input.absOf(series, ci)!),
    ...input.bumpPointState(row, ci),
  };
}

function pushMarkerNode(input: RenderLineMarksInput, series: NormSer, dataIdx: number, row: (number | null)[], point: Pt, shape: MarkerShape, id: Id): void {
  const stroke = series.role === 'reference' ? input.refPaintOf(series) : input.seriesPaint(series, dataIdx);
  const hollow = input.hollowAt(series, point.ci);
  const fill: Paint = hollow ? { token: 'background' } : stroke;
  const owner = { seriesId: series.id, categoryId: input.cats[point.ci]!.id };
  const display = markerDisplay(input, series, row, point.ci);
  if (shape === 'circle') input.nodes.push({ t: 'circle', id, cx: point.x, cy: point.y, r: 3, fill, ...(hollow ? { stroke } : {}), owner, part: 'marker', display });
  else if (shape === 'square') input.nodes.push({ t: 'rect', id, rect: { x: point.x - 3, y: point.y - 3, w: 6, h: 6 }, fill, ...(hollow ? { stroke, strokeWidth: strokeToken(input.theme, 'mark') } : {}), owner, part: 'marker', display });
  else if (shape !== 'none') input.nodes.push({ t: 'path', id, d: markerPath(shape, point), fill, ...(hollow ? { stroke, width: strokeToken(input.theme, 'mark') } : {}), owner, part: 'marker', display });
}

/** A triangle or diamond marker round `point`; combo draws its markers with it too. */
export function markerPath(shape: 'triangle' | 'diamond', point: Point): string {
  return shape === 'triangle'
    ? `M${fmtN(point.x)} ${fmtN(point.y - 3.5)}L${fmtN(point.x + 3.5)} ${fmtN(point.y + 3)}L${fmtN(point.x - 3.5)} ${fmtN(point.y + 3)}Z`
    : `M${fmtN(point.x)} ${fmtN(point.y - 4)}L${fmtN(point.x + 4)} ${fmtN(point.y)}L${fmtN(point.x)} ${fmtN(point.y + 4)}L${fmtN(point.x - 4)} ${fmtN(point.y)}Z`;
}

function renderMarkers(input: RenderLineMarksInput, series: NormSer, dataIdx: number, entry: LineMarks['series'][number], geometry: SeriesGeometry, claims: ClaimContext): void {
  geometry.allPoints.forEach((point) => {
    const shape = input.markerOf(series, dataIdx, point.ci);
    if (input.isStacked && geometry.row[point.ci] === null) {
      entry.points.push({ categoryId: input.cats[point.ci]!.id, x: point.x, y: point.y });
      return;
    }
    let nodeId: Id | undefined;
    if (shape !== 'none') {
      nodeId = `marker:${series.id}:${input.cats[point.ci]!.id}`;
      pushMarkerNode(input, series, dataIdx, geometry.row, point, shape, nodeId);
      input.occupied.claim({ x: point.x - 4, y: point.y - 4, w: 8, h: 8 }, 'mark', claims.lineOwner(series.id, input.cats[point.ci]!.id));
    }
    entry.points.push({ categoryId: input.cats[point.ci]!.id, x: point.x, y: point.y, ...(nodeId ? { nodeId } : {}) });
  });
}

function renderSeries(input: RenderLineMarksInput, series: NormSer, dataIdx: number, marks: LineMarks, paintedAreaCats: Map<Id, Set<number>>, claims: ClaimContext, outlines: AreaOutline[]): SeriesGeometry {
  const entry: LineMarks['series'][number] = { seriesId: series.id, points: [] };
  const geometry = buildSeriesGeometry(input, series, dataIdx);
  renderArea(input, series, dataIdx, entry, geometry, claims, paintedAreaCats, outlines);
  renderLinePaths(input, series, dataIdx, entry, geometry, claims);
  renderMarkers(input, series, dataIdx, entry, geometry, claims);
  renderLatestPointRing(input, series, geometry, claims);
  marks.series.push(entry);
  return geometry;
}

/** The ring r 4.5 on the last observed point, in the highlight. */
const LATEST_RING_R = 4.5;
const LATEST_DOT_R = 2;
/** How far the ring's paint reaches from its centre: the claim, and what the plot ends reserve for it. */
export const latestRingReach = (theme: Theme): number => LATEST_RING_R + strokeToken(theme, 'mark') / 2;

function renderLatestPointRing(
  input: RenderLineMarksInput,
  series: NormSer,
  geometry: SeriesGeometry,
  claims: ClaimContext,
): void {
  if (input.latestPointSeries === undefined || input.latestPointSeries !== series.id) return;
  const observed = geometry.allPoints.filter((point) => geometry.row[point.ci] !== null);
  const point = observed[observed.length - 1];
  if (point === undefined) return;
  const categoryId = input.cats[point.ci]!.id;
  const owner = { seriesId: series.id, categoryId };
  const display = markerDisplay(input, series, geometry.row, point.ci);
  input.nodes.push({
    t: 'circle', id: `latest-ring:${series.id}`, cx: point.x, cy: point.y, r: LATEST_RING_R,
    fill: { token: 'background' }, stroke: { token: 'highlight' }, strokeWidth: strokeToken(input.theme, 'mark'),
    owner, part: 'marker', display,
  });
  input.nodes.push({
    t: 'circle', id: `latest-dot:${series.id}`, cx: point.x, cy: point.y, r: LATEST_DOT_R,
    fill: { token: 'markInk' }, owner, part: 'marker', display,
  });
  input.occupied.claim(
    { x: point.x - latestRingReach(input.theme), y: point.y - latestRingReach(input.theme), w: latestRingReach(input.theme) * 2, h: latestRingReach(input.theme) * 2 },
    'mark',
    claims.lineOwner(series.id, categoryId),
  );
}

function renderAreaSeparators(input: RenderLineMarksInput, geometries: SeriesGeometry[], paintedAreaCats: Map<Id, Set<number>>): void {
  if (input.variant !== 'stacked100-area') return;
  input.drawnSeries.slice(0, -1).forEach((series, index) => {
    const geometry = geometries[index]!;
    const next = input.drawnSeries[index + 1]!;
    // Different authored interpolations do not define one shared curve.
    if (geometry.interpolation !== geometries[index + 1]!.interpolation) return;
    const painted = (band: number, ci: number, cj: number): boolean =>
      input.cumTop[band]![ci] !== input.cumBot[band]![ci] ||
      input.cumTop[band]![cj] !== input.cumBot[band]![cj];
    geometry.runs.forEach((run, runIndex) => {
      let start = 0;
      const emit = (end: number): void => {
        if (end <= start) return;
        const curve = geometry.monotoneByRun?.get(run)?.slice(start, end);
        const d = curve ? curvePathFromSegments(curve) : pathFor(run.slice(start, end + 1), geometry.interpolation);
        input.nodes.push({
          t: 'path', id: `area-separator:${series.id}:${runIndex}:${start}`, d,
          stroke: { token: 'background' }, width: strokeToken(input.theme, 'rule'), owner: { seriesId: series.id }, part: 'areaSeparator',
        });
      };
      for (let pointIndex = 0; pointIndex + 1 < run.length; pointIndex++) {
        const from = run[pointIndex]!.ci;
        const to = run[pointIndex + 1]!.ci;
        const shared = [series.id, next.id].every((id) =>
          paintedAreaCats.get(id)?.has(from) && paintedAreaCats.get(id)?.has(to));
        if (shared && painted(index, from, to) && painted(index + 1, from, to)) continue;
        emit(pointIndex);
        start = pointIndex + 1;
      }
      emit(run.length - 1);
    });
  });
}

function renderInvalidComposition(input: RenderLineMarksInput): void {
  if (input.variant !== 'stacked100-area') return;
  input.cats.forEach((category, ci) => {
    const glyph = input.nmCats100.has(category.id) ? NOT_MEANINGFUL : input.naCats100.has(category.id) ? input.naGlyph : null;
    if (!glyph) return;
    const size = input.measure(glyph, input.labelFont);
    const x = input.xOf(ci);
    const rect: Rect = { x: x - size.width / 2, y: input.baseY - size.height - 6, w: size.width, h: size.height };
    input.nodes.push({ t: 'text', id: `nm:${category.id}`, x, y: rect.y, lines: [glyph], align: 'middle', typeRole: 'label', font: input.labelFont, ink: { token: 'inkMuted' }, owner: { categoryId: category.id }, part: 'nmMarker', display: { state: input.nmCats100.has(category.id) ? NOT_MEANINGFUL : NOT_AVAILABLE } });
    input.occupied.claim(rect, 'label', { categoryId: category.id });
  });
}

function renderReferences(input: RenderLineMarksInput, claims: ClaimContext): void {
  input.refSeries.forEach((series) => {
    const geometry = buildSeriesGeometry({ ...input, isStacked: false }, series, 0);
    const { interpolation, runs } = geometry;
    runs.forEach((points, runIndex) => {
      if (points.length === 1) {
        const point = points[0]!;
        const categoryId = input.cats[point.ci]!.id;
        const shape = input.markerOf(series, 0, point.ci);
        // A lone reference has no path, so keep its marker even when regular markers are off.
        pushMarkerNode(input, series, 0, geometry.row, point, shape === 'none' ? 'circle' : shape, `marker:${series.id}:${categoryId}`);
        input.occupied.claim({ x: point.x - 4, y: point.y - 4, w: 8, h: 8 }, 'mark', claims.lineOwner(series.id, categoryId));
        return;
      }
      if (points.length < 2) return;
      const curve = geometry.monotoneByRun?.get(points) ?? [];
      input.nodes.push({ t: 'path', id: `ref:${series.id}${runIndex === 0 ? '' : `:${runIndex}`}`, d: interpolation === 'monotone' ? curvePathFromSegments(curve) : pathFor(points, interpolation), stroke: input.refPaintOf(series), width: strokeToken(input.theme, 'rule'), dash: dashToken(input.theme, 'reference'), owner: { seriesId: series.id }, part: 'referenceLine' });
      if (interpolation === 'monotone') claims.monotoneRun(points, curve, series.id);
      else for (let index = 0; index + 1 < points.length; index++) claims.linePair(points[index]!, points[index + 1]!, input.cats[points[index]!.ci]!.id, input.cats[points[index + 1]!.ci]!.id, series.id, interpolation);
      if (series.interpolateGaps) markBridgedGaps(input, series, 0, geometry, points, runIndex);
    });
  });
}

interface RenderLineMarksInput {
  range?: LineRange;
  xOfValue?: (value: number) => number;
  theme: Theme;
  drawnSeries: NormSer[];
  highlights: ReadonlySet<Id>;
  refSeries: NormSer[];
  pv: (number | null)[][];
  rowOf: Map<NormSer, number>;
  cats: Category[];
  isStacked: boolean;
  isArea: boolean;
  compositionInvalidAt: (categoryIndex: number) => boolean;
  y: (value: number) => number;
  cumTop: number[][];
  cumBot: number[][];
  xOf: (categoryIndex: number) => number;
  hasSuppressed100: boolean;
  baseY: number;
  plot: Rect;
  /** The theme's hatch pitch and line weight, for the stacked bands' forecast overlay. */
  hatch?: { gap: number; width: number; share: number };
  seriesPaint: (series: NormSer, dataIdx: number) => Paint;
  forecastLinePaint: (series: NormSer, dataIdx: number) => Paint;
  areaFillPaint: (series: NormSer, dataIdx: number, forecast?: boolean) => Paint;
  areaFilled: (series: NormSer) => boolean;
  lineWidthOf: (series: NormSer) => number;
  lineHollowOf: (series: NormSer) => boolean;
  interpolationFor: (series: NormSer) => LineInterpolation;
  dashOf: (series: NormSer, dataIdx: number) => number[] | undefined;
  markerOf: (series: NormSer, dataIdx: number, categoryIndex: number) => MarkerShape;
  hollowAt: (series: NormSer, categoryIndex: number) => boolean;
  rebased: boolean;
  variant: LineVariant;
  pctFmt: (value: number) => string;
  shareTexts: ReadonlyMap<string, string>;
  authoredPctFmt: (value: number) => string;
  /** A series' own format example or unit rule. */
  seriesFmt: (series: NormSer) => (value: number) => string;
  fmt: (value: number) => string;
  absOf: (series: NormSer, categoryIndex: number) => number | null;
  bumpPointState: (row: (number | null)[], categoryIndex: number) => { state: string } | Record<string, never>;
  inlineNamesEnabled: boolean;
  /** The one series whose last observed point takes the highlight ring. */
  latestPointSeries?: Id;
  bump?: BumpDerived;
  /** Ranked entities bump.focus leaves undrawn: records only. */
  bumpOmitted?: readonly NormSer[];
  nmCats100: Set<Id>;
  naCats100: Set<Id>;
  /** The drawn not-applicable glyph (notApplicableGlyph). */
  naGlyph: string;
  labelFont: FontSpec;
  measure: TextMeasurer;
  refPaintOf: (series: NormSer) => Paint;
  nodes: SceneNode[];
  occupied: OccupiedIndex;
}

export function renderLineMarks(input: RenderLineMarksInput): RenderedLineMarks {
  const analyticalSceneStart = input.nodes.length;
  const baselineId = 'axis:baseline';
  input.nodes.push({ t: 'line', id: baselineId, x1: input.plot.x, y1: input.baseY, x2: input.plot.x + input.plot.w, y2: input.baseY, stroke: { token: 'axis' }, width: strokeToken(input.theme, 'rule'), owner: {}, part: 'baseline' });
  input.occupied.claim({ x: input.plot.x, y: input.baseY - 1, w: input.plot.w, h: 2 }, 'axis', {});
  const marks: LineMarks = { series: [] };
  const paintedAreaCats = new Map<Id, Set<number>>();
  const claims = createClaims(input.occupied, input.cats, input.inlineNamesEnabled);
  const seriesStart = input.nodes.length;
  const areaOutlines: AreaOutline[] = [];
  const geometries = input.drawnSeries.map((series, dataIdx) => renderSeries(input, series, dataIdx, marks, paintedAreaCats, claims, areaOutlines));
  if (!input.isStacked) {
    const highlight = new Set(input.drawnSeries.filter(series => series.colorRole === 'highlight' || input.highlights.has(series.id)).map(series => series.id));
    const ink = input.nodes.splice(seriesStart);
    // Every area fill sits under every series stroke and marker, so the lead fill
    // hides no earlier line. Keep markers above their own stroke and casing.
    const fill = (node: SceneNode) => node.part === 'area' || node.part === 'forecastHatch';
    const raised = (node: SceneNode) => highlight.has(node.owner.seriesId!) &&
      (node.id.startsWith('mark:line:') || node.id.startsWith('casing:mark:line:') || node.part === 'marker');
    pushAll(input.nodes, ink.filter(fill));
    pushAll(input.nodes, ink.filter(node => !fill(node) && !raised(node)));
    pushAll(input.nodes, ink.filter(raised));
  }
  renderAreaSeparators(input, geometries, paintedAreaCats);
  renderBumpTies(input.theme, { bump: input.bump, marks, nodes: input.nodes, occupied: input.occupied });
  // A focused bump keeps every ranked entity in its records (the data
  // table) at its rank, with no node drawn.
  for (const series of input.bumpOmitted ?? []) {
    const row = input.pv[input.rowOf.get(series)!]!;
    marks.series.push({ seriesId: series.id, points: row.flatMap((rank, ci) => (rank === null ? [] : [{ categoryId: input.cats[ci]!.id, x: input.xOf(ci), y: input.y(rank) }])) });
  }
  renderInvalidComposition(input);
  renderReferences(input, claims);
  const rangeEdges = input.range ? new Map(input.drawnSeries.map((series, i) => {
    const geometry = geometries[i]!;
    return [series.id, {
      runs: geometry.runs.map(run => edgePolyline({ points: run, mode: geometry.interpolation, curve: geometry.monotoneByRun?.get(run) })),
      ...(geometry.bottomByRun ? { bottom: geometry.runs.flatMap(run => edgePolyline(geometry.bottomByRun!.get(run)!)) } : {}),
    }];
  })) : undefined;
  return { marks, baselineId, analyticalSceneStart, paintedAreaCats, areaOutlines, ...(rangeEdges ? { rangeEdges } : {}) };
}

function linearYAt(points: readonly Point[], x: number): number {
  if (points.length === 0) throw new Error('linearYAt on an empty run');
  if (points.length === 1 || x <= points[0]!.x) return points[0]!.y;
  if (x >= points[points.length - 1]!.x) return points[points.length - 1]!.y;
  let index = 0;
  while (index < points.length - 2 && points[index + 1]!.x < x) index++;
  const from = points[index]!;
  const to = points[index + 1]!;
  return from.y + (to.y - from.y) * ((x - from.x) / (to.x - from.x));
}

function sliceCurve(segment: CurveSegment, fromT: number, toT: number): CurveSegment {
  if (fromT <= 0 && toT >= 1) return segment;
  const right = fromT <= 0 ? segment : splitCurve(segment, fromT)[1];
  const normalizedTo = fromT >= 1 ? 1 : (toT - fromT) / (1 - fromT);
  return normalizedTo >= 1 ? right : splitCurve(right, normalizedTo)[0];
}

function monotonePathBetween(points: readonly Point[], start: Point, end: Point): string {
  const pieces = monotoneSegments(points).flatMap((segment) => {
    if (segment.to.x <= start.x || segment.from.x >= end.x) return [];
    const span = segment.to.x - segment.from.x;
    const fromT = Math.max(0, (start.x - segment.from.x) / span);
    const toT = Math.min(1, (end.x - segment.from.x) / span);
    return toT > fromT ? [sliceCurve(segment, fromT, toT)] : [];
  });
  if (pieces.length === 0) return `M${fmtN(start.x)} ${fmtN(start.y)}`;
  pieces[0] = { ...pieces[0]!, from: { x: start.x, y: start.y } };
  pieces[pieces.length - 1] = { ...pieces[pieces.length - 1]!, to: { x: end.x, y: end.y } };
  return `M${fmtN(start.x)} ${fmtN(start.y)}${pieces.map((segment) => `C${fmtN(segment.c1.x)} ${fmtN(segment.c1.y)} ${fmtN(segment.c2.x)} ${fmtN(segment.c2.y)} ${fmtN(segment.to.x)} ${fmtN(segment.to.y)}`).join('')}`;
}

interface PhaseBoundary extends Point {
  value: number;
  leftCategoryId: Id;
  rightCategoryId: Id;
}

function phaseBoundaries(phases: LinePhaseResolved, row: (number | null)[], cats: Category[], xOf: (categoryIndex: number) => number, y: (value: number) => number, forecast: readonly ForecastBoundary[]): { curvePoints: Point[]; boundaries: PhaseBoundary[]; derived: PhaseDerived } {
  const values = cats.map((_, ci) => ({ x: xOf(ci), y: row[ci]! }));
  const curvePoints = values.map((point) => ({ x: point.x, y: y(point.y) }));
  const internal = phases.phases.slice(1).map((phase, index) => {
    const leftIndex = cats.findIndex((category) => category.id === phases.phases[index]!.to);
    const rightIndex = cats.findIndex((category) => category.id === phase.from);
    // Forecast phases share the point used by the forecast divider.
    const split = forecast.find((boundary) => boundary.categoryIndex === rightIndex);
    const x = split ? forecastBoundaryX(split, xOf, 'point') : (xOf(leftIndex) + xOf(rightIndex)) / 2;
    const value = phases.interpolation === 'monotone' ? monotoneYAt(values, x) : linearYAt(values, x);
    return { x, y: y(value), value, leftCategoryId: cats[leftIndex]!.id, rightCategoryId: cats[rightIndex]!.id };
  });
  const boundaries = [
    { x: values[0]!.x, y: curvePoints[0]!.y, value: values[0]!.y, leftCategoryId: cats[0]!.id, rightCategoryId: cats[0]!.id },
    ...internal,
    { x: values[values.length - 1]!.x, y: curvePoints[curvePoints.length - 1]!.y, value: values[values.length - 1]!.y, leftCategoryId: cats[cats.length - 1]!.id, rightCategoryId: cats[cats.length - 1]!.id },
  ];
  const derived = { seriesId: phases.series.id, interpolation: phases.interpolation, pointwiseExact: true as const, boundaries: internal.map(({ x, y: boundaryY, leftCategoryId, rightCategoryId }) => ({ x, y: boundaryY, leftCategoryId, rightCategoryId })) };
  return { curvePoints, boundaries, derived };
}

/**
 * Phase spans in a cut range, on the clipped edge the line draws: the first
 * and last phase reach the plot edges with the line's own end segments, and
 * each boundary value is read off that edge. Boundaries come from the
 * authored phases over the source readings, so a crop never changes which
 * phase owns a stretch of line: a phase with no reading in view keeps its
 * sliver at the edge. Positions are in data units, as the line's edge is
 * built, then mapped once.
 */
function rangePhaseSpans(phases: LinePhaseResolved, range: LineRange, row: (number | null)[], cats: Category[], xOfValue: (value: number) => number, y: (value: number) => number): { phases: LinePhase[]; outside: Set<Id>; boundaries: PhaseBoundary[]; spans: RangeEdge[]; derived: PhaseDerived } {
  const edge = rangeRuns(range, [row], phases.interpolation)[0]![0]!;
  const authored = phases.authored ?? phases.phases;
  const source = new Map(range.categories.map((category, index) => [category.id, index]));
  const values = range.values.get(phases.series.id)!;
  const fc = phases.series.scenario === 'FC' ? 0 : values.findIndex((value) => value.scenario === 'FC');
  // Forecast phases share the point used by the forecast divider: the last actual reading.
  const splits = authored.slice(1).map((phase, index) => {
    const left = source.get(authored[index]!.to)!;
    const right = source.get(phase.from)!;
    return right === fc && fc > 0 ? range.xs[right - 1]! : (range.xs[left]! + range.xs[right]!) / 2;
  });
  const first = edge.points[0]!.x;
  const last = edge.points[edge.points.length - 1]!.x;
  const inView = new Map(phases.phases.map((phase) => [phase.id, phase]));
  const drawn = authored.flatMap((phase, index) => {
    const from = Math.max(first, index === 0 ? -Infinity : splits[index - 1]!);
    const to = Math.min(last, index === splits.length ? Infinity : splits[index]!);
    const visible = inView.get(phase.id);
    if (visible) return [{ phase: visible, from, to }];
    return to > from ? [{ phase: { ...phase, rank: phase.rank ?? index + 1 }, from, to }] : [];
  });
  const spans = drawn.map(({ from, to }) => cutEdge(edge, phases.interpolation, from, to));
  const stop = (x: number, value: number, leftCategoryId: Id, rightCategoryId: Id): PhaseBoundary => ({ x: xOfValue(x), y: y(value), value, leftCategoryId, rightCategoryId });
  const boundaries = [
    stop(drawn[0]!.from, spans[0]!.points[0]!.y, cats[0]!.id, cats[0]!.id),
    ...drawn.map(({ phase, to }, index) => {
      const span = spans[index]!;
      const next = drawn[index + 1]?.phase;
      return next ? stop(to, span.points[span.points.length - 1]!.y, phase.to, next.from)
        : stop(to, span.points[span.points.length - 1]!.y, cats[cats.length - 1]!.id, cats[cats.length - 1]!.id);
    }),
  ];
  const derived = { seriesId: phases.series.id, interpolation: phases.interpolation, pointwiseExact: true as const, boundaries: boundaries.slice(1, -1).map(({ x, y: boundaryY, leftCategoryId, rightCategoryId }) => ({ x, y: boundaryY, leftCategoryId, rightCategoryId })) };
  return {
    phases: drawn.map(({ phase }) => phase),
    outside: new Set(drawn.flatMap(({ phase }) => (inView.has(phase.id) ? [] : [phase.id]))),
    boundaries, spans: spans.map((span) => mapEdge(span, xOfValue, y)), derived,
  };
}

function phasePaint(phase: LinePhase, index: number, paletteRamp: string[] | undefined, palette: string | undefined): Paint {
  // A phase wash is larger than a point: its tone takes the focus or a fill role.
  if (phase.tone) return { ...markRolePaint(phase.tone === 'muted' ? 'neutral' : phase.tone, true), tint: 0.62 };
  const rank = phase.rank ?? index + 1;
  return paletteRamp ? { ...themeSeriesPaint(rank - 1, palette), tint: 0.62 } : { token: `series-${rank}` as never, tint: 0.62 };
}

/** A phase band spans the whole plot height, so it takes a paler wash than an area under the line (0.62). */
const PHASE_BAND_TINT = 0.84;

export function renderPhaseFills(theme: Theme, input: {
  range?: LineRange;
  xOfValue?: (value: number) => number;
  phases: LinePhaseResolved | null;
  pv: (number | null)[][];
  rowOf: Map<NormSer, number>;
  cats: Category[];
  xOf: (categoryIndex: number) => number;
  y: (value: number) => number;
  baseY: number;
  plot: Rect;
  phaseHeaderHeight: number;
  paletteRamp: string[] | undefined;
  palette: string | undefined;
  fmt: (value: number) => string;
  measure: TextMeasurer;
  tickFont: FontSpec;
  labelRequests: LabelRequest[];
  occupied: OccupiedIndex;
  nodes: SceneNode[];
  marks: LineMarks;
  analyticalSceneStart: number;
  forecast: readonly ForecastBoundary[];
}): PhaseDerived | undefined {
  if (!input.phases) return undefined;
  const phases = input.phases;
  const row = input.pv[input.rowOf.get(phases.series)!]!;
  // A cut range draws the wash on the line's clipped edge, out to the plot edges.
  const ranged = input.range && input.xOfValue
    ? rangePhaseSpans(phases, input.range, input.range.plotted[input.rowOf.get(phases.series)!]!, input.cats, input.xOfValue, input.y) : undefined;
  const resolved = ranged ?? phaseBoundaries(phases, row, input.cats, input.xOf, input.y, input.forecast);
  const curvePoints = 'curvePoints' in resolved ? resolved.curvePoints : [];
  const drawn = ranged?.phases ?? phases.phases;
  // Where a phase name finds no seat over its wash, it may sit over the
  // phase's own readings in view: where it sits without the cut, then ending
  // at its last reading, then starting at its first.
  const plain = ranged ? phaseBoundaries(phases, row, input.cats, input.xOf, input.y, input.forecast).boundaries : undefined;
  const fills: SceneNode[] = [];
  const boundaries: SceneNode[] = [];
  const phaseMarks: NonNullable<LineMarks['phases']> = [];
  // An area down to a broken axis floor reads as the value's size and
  // exaggerates it: where zero is off the plot, each phase is a pale band
  // across the plot height behind the line, and the line alone carries the values.
  const zeroY = input.y(0);
  const banded = zeroY < input.plot.y - 0.5 || zeroY > input.plot.y + input.plot.h + 0.5;
  drawn.forEach((phase, index) => {
    const start = resolved.boundaries[index]!;
    const end = resolved.boundaries[index + 1]!;
    if (banded) {
      const bandPaint = phasePaint(phase, index, input.paletteRamp, input.palette);
      fills.push({ t: 'path', id: `mark:phase:${phase.id}`, d: `M${fmtN(start.x)} ${fmtN(input.plot.y)}L${fmtN(end.x)} ${fmtN(input.plot.y)}L${fmtN(end.x)} ${fmtN(input.plot.y + input.plot.h)}L${fmtN(start.x)} ${fmtN(input.plot.y + input.plot.h)}Z`,
        fill: 'tint' in bandPaint ? { ...bandPaint, tint: PHASE_BAND_TINT } : bandPaint, owner: { seriesId: phases.series.id, annotationId: phase.id }, part: 'phaseFill', display: { value: `${phase.label}: ${input.fmt(start.value)} to ${input.fmt(end.value)}` } });
    }
    const span = ranged?.spans[index];
    const top = span ? edgePath(span, linePath)
      : phases.interpolation === 'monotone' ? monotonePathBetween(curvePoints, start, end) : linePath([{ x: start.x, y: start.y }, ...curvePoints.filter((point) => point.x > start.x && point.x < end.x), { x: end.x, y: end.y }]);
    const nodeId = `mark:phase:${phase.id}`;
    if (!banded) fills.push({ t: 'path', id: nodeId, d: `${top}L${fmtN(end.x)} ${fmtN(input.baseY)}L${fmtN(start.x)} ${fmtN(input.baseY)}Z`, fill: phasePaint(phase, index, input.paletteRamp, input.palette), stroke: { token: 'axis' }, width: strokeToken(theme, 'hair'), dash: dashToken(theme, 'reference'), owner: { seriesId: phases.series.id, annotationId: phase.id }, part: 'phaseFill', display: { value: `${phase.label}: ${input.fmt(start.value)} to ${input.fmt(end.value)}` } });
    // A linear fill claims its outline, one convex quad per stretch, so the
    // series' last value can sit over its own point; a monotone
    // curve bulges past its chords and keeps the box.
    // a phase fill is not a value's own point; keep larger endpoint text off its edge.
    const owner = { annotationId: phase.id };
    // A cut range claims the curve's own outline: its wash reaches past the
    // inside readings, and a box over that span would push their values off.
    const tops = span ? edgePolyline({ ...span, mode: phases.interpolation }) : [start, ...curvePoints.filter((point) => point.x > start.x && point.x < end.x), end];
    if (banded) {
      // A band behind the line is ground, not a mark: labels may sit on it.
    } else if ((!span && phases.interpolation === 'monotone') || tops.some((point) => point.y > input.baseY)) {
      input.occupied.claim({ x: start.x, y: Math.min(start.y, end.y, input.baseY), w: Math.max(end.x - start.x, 1), h: Math.max(Math.max(start.y, end.y, input.baseY) - Math.min(start.y, end.y, input.baseY), 1) }, 'mark', owner);
    } else {
      for (let i = 1; i < tops.length; i++) {
        const [a, b] = [tops[i - 1]!, tops[i]!];
        const y = Math.min(a.y, b.y);
        input.occupied.claim({ x: a.x, y, w: Math.max(b.x - a.x, 1), h: Math.max(input.baseY - y, 1) }, 'mark', owner, undefined,
          [{ x: a.x, y: a.y }, { x: b.x, y: b.y }, { x: b.x, y: input.baseY }, { x: a.x, y: input.baseY }]);
      }
    }
    const labelId = `annotation:phase:${phase.id}`;
    const text = phase.label;
    const measured = input.measure(text, input.tickFont);
    const seatX = (from: number, to: number): number => Math.max(input.plot.x, Math.min((from + to) / 2 - measured.width / 2, input.plot.x + input.plot.w - measured.width));
    const x = seatX(start.x, end.x);
    const own = plain ? phases.phases.findIndex((item) => item.id === phase.id) : -1;
    const fallbackXs = own < 0 ? [] : [...new Set([
      seatX(plain![own]!.x, plain![own + 1]!.x),
      seatX(input.xOf(input.cats.findIndex((category) => category.id === phase.to)) - measured.width, input.xOf(input.cats.findIndex((category) => category.id === phase.to))),
      seatX(input.xOf(input.cats.findIndex((category) => category.id === phase.from)), input.xOf(input.cats.findIndex((category) => category.id === phase.from)) + measured.width),
    ])].filter((at) => at !== x);
    const headerTop = input.plot.y - input.phaseHeaderHeight;
    // The authored phase name is a caption, not an annotation value.
    input.labelRequests.push({ id: labelId, kind: 'annotation', role: 'caption', owner: { annotationId: phase.id }, text, lines: [text], typeRole: 'axis', font: input.tickFont,
      // A phase with no reading in view yields its name to the phases that have one.
      fontStep: input.tickFont, priority: ranged?.outside.has(phase.id) ? PRIORITY.extreme - 1 : PRIORITY.extreme, candidates: [
      { slot: 'phaseTop', rect: { x, y: headerTop + 2, w: measured.width, h: measured.height }, penalty: 0 },
      { slot: 'phaseTopLower', rect: { x, y: headerTop + 2 + measured.height, w: measured.width, h: measured.height }, penalty: 1 },
      ...fallbackXs.map((at, k) => ({ slot: 'phaseTop', rect: { x: at, y: headerTop + 2, w: measured.width, h: measured.height }, penalty: 2 + k })),
    ] });
    let boundaryNodeId: Id | undefined;
    if (index < drawn.length - 1) {
      boundaryNodeId = `phase-boundary:${phase.id}:${drawn[index + 1]!.id}`;
      boundaries.push({ t: 'line', id: boundaryNodeId, x1: end.x, y1: input.plot.y, x2: end.x, y2: input.plot.y + input.plot.h, stroke: { token: 'leader' }, width: strokeToken(theme, 'rule'), dash: dashToken(theme, 'reference'), owner: { annotationId: drawn[index + 1]!.id }, part: 'phaseBoundary', display: { value: input.fmt(end.value) } });
      input.occupied.claim({ x: end.x - 0.5, y: input.plot.y, w: 1, h: input.plot.h }, 'annotation', { annotationId: drawn[index + 1]!.id });
    }
    phaseMarks.push({ id: phase.id, nodeId, fromCategoryId: phase.from, toCategoryId: phase.to, x0: start.x, x1: end.x, y0: start.y, y1: end.y, labelId, ...(boundaryNodeId ? { boundaryNodeId } : {}) });
  });
  input.marks.phases = phaseMarks;
  const analytical = input.nodes.splice(input.analyticalSceneStart);
  const areas = analytical.filter((node) => node.part === 'area');
  const baseline = analytical.filter((node) => node.part === 'baseline');
  const foreground = analytical.filter((node) => node.part !== 'area' && node.part !== 'baseline');
  pushAll(input.nodes, fills);
  pushAll(input.nodes, areas);
  pushAll(input.nodes, baseline);
  pushAll(input.nodes, boundaries);
  pushAll(input.nodes, foreground);
  return resolved.derived;
}
