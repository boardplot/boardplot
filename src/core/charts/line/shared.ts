/**
 * The parts of the line marks that combo and pareto draw too. This module imports no other part of the
 * line chart, so a combo does not load the line labels, bump, fan, trend and the rest.
 */

import { cubicPoint, drawnStroke, fmtPathNumber as fmtN, monotonePath, type CurveSegment } from '../../curve';
import { DENSE_CATEGORY_COUNT } from '../../denseCharts';
import type { Point, Rect } from '../../geometry';
import { polylineYAt } from '../../label/areaGround';
import { linePath } from '../../svgPath';
import { HATCH_STRENGTH_DEFAULT, hatchGapFactor, mixedPaint, strokeToken } from '../../theme';
import type { Id } from '../../types/cell';
import type { Category } from '../../types/data';
import type { Theme } from '../../types/theme';
import type { Paint, PlacedLabel, SceneNode } from '../../types/scene';
import { defaultAnnotationId, type Annotation } from '../../types/annotations';
import type { NormSer } from './context';
import type { LineInterpolation } from './types';
import { maxOf, minOf } from '../../arrays';

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

export interface AreaEdge {
  points: readonly Point[];
  mode: LineInterpolation;
  curve?: readonly CurveSegment[];
}

/** An area edge as the polyline it draws: the curve flattened, a step through its elbows. */
export function edgePolyline(edge: AreaEdge): Point[] {
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
export function bandHatchPath(upper: AreaEdge, lower: AreaEdge, gap: number): string {
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

/** A triangle or diamond marker round `point`; combo draws its markers with it too. */
export function markerPath(shape: 'triangle' | 'diamond', point: Point, scale = 1): string {
  return shape === 'triangle'
    ? `M${fmtN(point.x)} ${fmtN(point.y - 3.5 * scale)}L${fmtN(point.x + 3.5 * scale)} ${fmtN(point.y + 3 * scale)}L${fmtN(point.x - 3.5 * scale)} ${fmtN(point.y + 3 * scale)}Z`
    : `M${fmtN(point.x)} ${fmtN(point.y - 4 * scale)}L${fmtN(point.x + 4 * scale)} ${fmtN(point.y)}L${fmtN(point.x)} ${fmtN(point.y + 4 * scale)}L${fmtN(point.x - 4 * scale)} ${fmtN(point.y)}Z`;
}

/** The forecast overlay of a fill: page-colour stripes over the fill's own colour (renderLineMarks' `hatch`). */
export function bandHatch(theme: Theme, hatchStrength: number | undefined): { gap: number; width: number; share: number } {
  return {
    gap: theme.pattern.hatchGap * hatchGapFactor({ strength: hatchStrength ?? HATCH_STRENGTH_DEFAULT.second, cue: 'second' }) * BAND_HATCH_PITCH,
    width: strokeToken(theme, 'hair'),
    share: BAND_HATCH_SHARE * (0.5 + 0.5 * (hatchStrength ?? HATCH_STRENGTH_DEFAULT.second) / 100) / (0.5 + 0.5 * HATCH_STRENGTH_DEFAULT.second / 100),
  };
}

/** A stacked band's forecast stripes sit 1/√2 of the theme's second-cue pitch apart (9.6 px along x at the default). */
const BAND_HATCH_PITCH = Math.SQRT1_2;

/** The page colour's share in a stacked band's stripe at the default strength. */
const BAND_HATCH_SHARE = 0.45;

/** Default marker cutoff: more categories than this ⇒ markers off. */
export const MARKER_MAX_CATS = DENSE_CATEGORY_COUNT;
