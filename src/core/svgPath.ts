import { GRAMMAR_STROKE } from './theme';
/**
 * SVG path generation for chart primitives that renderers share:
 * leader lines, connectors, difference-arrow shapes. Pure string math so
 * the CLI can emit identical SVG.
 */

import type { Point } from './geometry';
import type { HatchPattern } from './types/scene';
import { fmtPathNumber as fmt } from './curve';

export function isHatchPattern(pattern: string | undefined): pattern is HatchPattern {
  return pattern === 'hatch45' || pattern === 'crosshatch' || pattern === 'horizontal' || pattern === 'vertical';
}


export function linePath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(p.x)} ${fmt(p.y)}`)
    .join('');
}

/**
 * Leader line from a displaced label to its owning element. Straight when
 * nearly aligned; a gentle S-bezier when displaced further (consulting-chart look).
 */
export function leaderPath(from: Point, to: Point, straightThreshold = 8): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) <= straightThreshold || Math.abs(dy) <= straightThreshold) {
    return `M${fmt(from.x)} ${fmt(from.y)}L${fmt(to.x)} ${fmt(to.y)}`;
  }
  const mx = from.x + dx / 2;
  return `M${fmt(from.x)} ${fmt(from.y)}C${fmt(mx)} ${fmt(from.y)} ${fmt(mx)} ${fmt(to.y)} ${fmt(to.x)} ${fmt(to.y)}`;
}

/**
 * A ribbon between two vertical spans (column ribbons): both edges are cubic
 * S-curves with horizontal tangents at each end, control points at mid-x,
 * or straight lines when `curved` is false (fixed-order ribbons).
 * `edges` draws the two edges alone, open, for the separator stroke.
 */
export function ribbonPath(
  x1: number, top1: number, bottom1: number,
  x2: number, top2: number, bottom2: number,
  edges = false,
  curved = true,
): string {
  const mx = fmt((x1 + x2) / 2);
  const to = (ya: number, xb: number, yb: number) => (curved ? `C${mx} ${fmt(ya)} ${mx} ${fmt(yb)} ${fmt(xb)} ${fmt(yb)}` : `L${fmt(xb)} ${fmt(yb)}`);
  const top = `M${fmt(x1)} ${fmt(top1)}${to(top1, x2, top2)}`;
  if (edges) return `${top}M${fmt(x1)} ${fmt(bottom1)}${to(bottom1, x2, bottom2)}`;
  return `${top}L${fmt(x2)} ${fmt(bottom2)}${to(bottom2, x1, bottom1)}Z`;
}

/**
 * Elbow connector: horizontal, then vertical, then horizontal — used by
 * pie outside labels and waterfall callouts.
 */
export function elbowPath(from: Point, to: Point, elbowX?: number): string {
  const ex = elbowX ?? from.x + (to.x - from.x) / 2;
  return `M${fmt(from.x)} ${fmt(from.y)}L${fmt(ex)} ${fmt(from.y)}L${fmt(ex)} ${fmt(to.y)}L${fmt(to.x)} ${fmt(to.y)}`;
}

/**
 * How far BEHIND the tip an `arrowHeadPath` of this size reaches —
 * the depth of the filled triangle measured along the shaft.
 *
 * A shaft that stops at `tip - size` leaves a white slit, because the head is
 * only `size · |cos 0.85π|` ≈ 0.891 · size deep, not `size`. Callers must derive
 * the shaft's end from THIS number instead of guessing an inset (an inset of
 * 6 against a 4.455-deep head leaves a 1.5px slit).
 */
function arrowHeadDepth(size = 6): number {
  return size * Math.abs(Math.cos(Math.PI * 0.85));
}

/**
 * Where a shaft of `strokeWidth` should stop so it dies INSIDE the head with no
 * seam and no ink outside the head's silhouette. The head narrows toward the
 * tip, so the shaft has to stop where the head is still wider than the shaft.
 */
export function arrowShaftEnd(size = 6, strokeWidth = GRAMMAR_STROKE.rule): number {
  const depth = arrowHeadDepth(size);
  const halfBase = size * Math.abs(Math.sin(Math.PI * 0.85));
  // Depth at which the head's half-width equals the shaft's, plus a margin.
  const flush = (strokeWidth / 2) * (depth / halfBase);
  return Math.min(depth, flush + 0.5);
}

/** Same arrowhead as a closed SVG path (M/L/Z). Angle points along the shaft. */
export function arrowHeadPath(tip: Point, angleRad: number, size = 6): string {
  const a1 = angleRad + Math.PI * 0.85;
  const a2 = angleRad - Math.PI * 0.85;
  const p1 = { x: tip.x + Math.cos(a1) * size, y: tip.y + Math.sin(a1) * size };
  const p2 = { x: tip.x + Math.cos(a2) * size, y: tip.y + Math.sin(a2) * size };
  return `M${fmt(tip.x)} ${fmt(tip.y)}L${fmt(p1.x)} ${fmt(p1.y)}L${fmt(p2.x)} ${fmt(p2.y)}Z`;
}

/**
 * Deterministic pattern id so identical patterns dedupe within a document.
 * Every value that changes the tile is part of the id: two themes with
 * different gaps or stroke widths must not resolve to one pattern.
 */
export function hatchPatternId(stroke: string, background: string, angle = 45, gap = 5, strokeWidth = 1.4): string {
  const clean = (s: string) => s.replace(/[^a-z0-9]/gi, '');
  const num = (n: number) => clean(String(n).replace('.', 'p'));
  return `bp-hatch-${clean(stroke)}-${clean(background)}-${angle}-${num(gap)}-${num(strokeWidth)}`;
}

/**
 * The 45° hatch as a tile that is already rotated, so the pattern needs no
 * patternTransform: LibreOffice ignores that rotation and drew vertical
 * stripes. The stripes are x + y = k·t with t = gap·√2, the lines the rotated
 * tile drew, at the same perpendicular spacing `gap`. The two corner strokes
 * finish the stripes that cross the tile's corners. t is kept on a 0.02 grid
 * so half and one and a half of it print exactly.
 *
 * The stripe is drawn at the full `hatchStrokeWidth`, the width effectiveFill
 * and the colour check measure (half of it, 0.7 px, would be clipped on the
 * rotated tile's edge). The two corner strokes are
 * clipped to half by the tile and meet the next tile's halves as one stripe.
 */
export function hatchTile(gap: number, strokeWidth: number, pattern: 'hatch45' | 'crosshatch' | 'horizontal' | 'vertical' = 'hatch45'): { size: number; d: string; strokeWidth: number } {
  const t = Math.round(gap * Math.SQRT2 * 50) / 50;
  const c = (v: number) => String(Math.round(v * 1000) / 1000);
  const h = t / 2;
  const e = t * 1.5;
  const diagonal = `M0 ${c(t)}L${c(t)} 0M${c(-h)} ${c(h)}L${c(h)} ${c(-h)}M${c(h)} ${c(e)}L${c(e)} ${c(h)}`;
  const d = pattern === 'horizontal' ? `M0 ${c(h)}H${c(t)}`
    : pattern === 'vertical' ? `M${c(h)} 0V${c(t)}`
    : pattern === 'crosshatch' ? `${diagonal}M0 0L${c(t)} ${c(t)}` : diagonal;
  return {
    size: t,
    d,
    strokeWidth,
  };
}

/** Pie-fill wedge for a Harvey ball: clockwise from 12 o'clock, q quarters (1–3). */
export function harveyWedgePath(cx: number, cy: number, r: number, q: number): string {
  const f = q / 4;
  const a = 2 * Math.PI * f;
  const ex = cx + r * Math.sin(a);
  const ey = cy - r * Math.cos(a);
  const large = f > 0.5 ? 1 : 0;
  return `M${fmt(cx)} ${fmt(cy)}L${fmt(cx)} ${fmt(cy - r)}A${fmt(r)} ${fmt(r)} 0 ${large} 1 ${fmt(ex)} ${fmt(ey)}Z`;
}

/**
 * Decorative marks drawn over an area fill (a shading read through it, a band
 * edge cut through it): the pointer passes to the fill under them, so a click
 * or hover there still names the series, in the static SVG and in React alike.
 */
export const POINTER_TRANSPARENT_PARTS: ReadonlySet<string> = new Set(['shadingOverFill', 'bandEdge']);
