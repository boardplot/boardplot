/**
 * Shared geometry primitives. Everything in the layout core
 * speaks in these types; renderers only ever draw what a layout computed.
 */

import { maxOf, minOf } from './arrays';

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Margin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function rectsOverlap(a: Rect, b: Rect, pad = 0): boolean {
  return !(
    a.x + a.w + pad <= b.x ||
    b.x + b.w + pad <= a.x ||
    a.y + a.h + pad <= b.y ||
    b.y + b.h + pad <= a.y
  );
}

export function rectContains(outer: Rect, inner: Rect, pad = 0): boolean {
  return (
    inner.x >= outer.x + pad &&
    inner.y >= outer.y + pad &&
    inner.x + inner.w <= outer.x + outer.w - pad &&
    inner.y + inner.h <= outer.y + outer.h - pad
  );
}

/** The y of a polyline at x, by the chord it lies on; the polyline runs left to right and holds its end values beyond them. */
export function polylineYAt(line: readonly Point[], x: number): number {
  if (x <= line[0]!.x) return line[0]!.y;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    if (x <= b.x) return b.x === a.x ? b.y : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
  }
  return line[line.length - 1]!.y;
}

/** Distance from a point to a box; 0 inside it. */
function pointRectDistance(p: Point, rect: Rect): number {
  return Math.hypot(Math.max(rect.x - p.x, 0, p.x - rect.x - rect.w), Math.max(rect.y - p.y, 0, p.y - rect.y - rect.h));
}

/** Distance from a point to the segment a-b. */
function pointSegmentDistance(x: number, y: number, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
}

/** Distance from a box to a drawn line: 0 where they touch, Infinity for no line. */
export function rectLineDistance(rect: Rect, line: readonly Point[]): number {
  if (line.length === 1) return pointRectDistance(line[0]!, rect);
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  let best = Infinity;
  let previousDistance = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    if (segmentHitsRect(a, b, rect)) return 0;
    if (i === 1) previousDistance = pointRectDistance(a, rect);
    const nextDistance = pointRectDistance(b, rect);
    best = Math.min(best, previousDistance, nextDistance,
      pointSegmentDistance(rect.x, rect.y, a, b), pointSegmentDistance(right, rect.y, a, b),
      pointSegmentDistance(rect.x, bottom, a, b), pointSegmentDistance(right, bottom, a, b));
    previousDistance = nextDistance;
  }
  return best;
}

/**
 * The side of a point the other lines leave more air on, where a
 * value there sits first; undefined when no other line reaches the point's x.
 */
export function sideAwayFrom(point: Point, others: readonly (readonly Point[])[]): 'above' | 'below' | undefined {
  let above = Infinity;
  let below = Infinity;
  let any = false;
  for (const line of others) {
    if (line.length === 0 || point.x < line[0]!.x || point.x > line[line.length - 1]!.x) continue;
    any = true;
    const y = polylineYAt(line, point.x);
    if (y < point.y) above = Math.min(above, point.y - y);
    else if (y > point.y) below = Math.min(below, y - point.y);
  }
  return !any ? undefined : below > above ? 'below' : 'above';
}

/**
 * Whether the segment a-b passes through `rect` grown by `pad` on every side
 * (Liang-Barsky clipping). A label box tested with the stroke's half width
 * plus its air as `pad` touches the drawn line exactly when this is true.
 */
export function segmentHitsRect(a: Point, b: Point, rect: Rect, pad = 0): boolean {
  const x0 = rect.x - pad;
  const y0 = rect.y - pad;
  const x1 = rect.x + rect.w + pad;
  const y1 = rect.y + rect.h + pad;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  for (let side = 0; side < 4; side++) {
    const p = side === 0 ? -dx : side === 1 ? dx : side === 2 ? -dy : dy;
    const q = side === 0 ? a.x - x0 : side === 1 ? x1 - a.x : side === 2 ? a.y - y0 : y1 - a.y;
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * Whether `rect` grown by `pad` on every side overlaps the convex `polygon`,
 * by separating axes: the rect's two axes and the normal of every polygon
 * edge. Touching is not overlap, as in `rectsOverlap`. The winding does not
 * matter; a zero-length edge adds no axis.
 */
export function rectHitsConvexPolygon(rect: Rect, polygon: readonly Point[], pad = 0): boolean {
  const x0 = rect.x - pad;
  const y0 = rect.y - pad;
  const x1 = rect.x + rect.w + pad;
  const y1 = rect.y + rect.h + pad;
  const corners: Point[] = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  const axes: Point[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }];
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length]!;
    if (p.x !== q.x || p.y !== q.y) axes.push({ x: q.y - p.y, y: p.x - q.x });
  });
  return axes.every((axis) => {
    const a = corners.map((p) => p.x * axis.x + p.y * axis.y);
    const b = polygon.map((p) => p.x * axis.x + p.y * axis.y);
    return Math.max(...a) > minOf(b) && maxOf(b) > Math.min(...a);
  });
}

/** Prepare overlap tests for a polygon whose points stay fixed. */
export function prepareConvexPolygon(polygon: readonly Point[]): (rect: Rect, pad: number) => boolean {
  const axes: [number, number][] = [[1, 0], [0, 1], ...polygon.map((p, i): [number, number] => {
    const q = polygon[(i + 1) % polygon.length]!;
    return [q.y - p.y, p.x - q.x];
  })];
  const projected = axes.filter(([x, y]) => x || y).map(([x, y]) => {
    const values = polygon.map(point => point.x * x + point.y * y);
    return [x, y, minOf(values), maxOf(values)] as const;
  });
  return (rect, pad) => {
    const x0 = rect.x - pad, y0 = rect.y - pad;
    const x1 = rect.x + rect.w + pad, y1 = rect.y + rect.h + pad;
    return projected.every(([x, y, min, max]) => {
      const a = x0 * x + y0 * y, b = x1 * x + y0 * y;
      const c = x1 * x + y1 * y, d = x0 * x + y1 * y;
      return Math.max(a, b, c, d) > min && max > Math.min(a, b, c, d);
    });
  };
}

/**
 * The gap between a value label and a delta printed after it on its row:
 * one label height, with no dash (a dash before a negative
 * delta reads as a minus sign). Every chart that seats a delta beside its
 * value uses it.
 */
export const deltaGap = (labelHeight: number): number => Math.round(labelHeight);

/** Gap between two boxes; 0 when they touch or overlap. */
export function boxGap(a: Rect, b: Rect): number {
  return Math.hypot(Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w)), Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h)));
}

export function rectCenter(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function inflate(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by };
}

/** Union bounding box of one or more rects. */
export function boundsOf(rects: readonly Rect[]): Rect {
  if (rects.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Smallest rect containing both. */
export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * A value or difference kept for printing, a verdict or a reading: fifteen
 * significant digits of `scale` clear float noise (0.1 + 0.2) and keep every
 * digit a format may print. `scale` is the size of the operands: a difference
 * of 5.5e-17 between 0.3 and 0.30000000000000004 is noise, so it becomes 0.
 * Never `round2` such a number: the format then rounds an already rounded
 * value, and a gap of 0.004 reads as 0.
 */
export function cleanFloat(v: number, scale: number = v): number {
  const decimals = 14 - Math.floor(Math.log10(Math.abs(scale)));
  return decimals >= 0 && decimals <= 100 ? Number(v.toFixed(decimals)) + 0 : v; // + 0 turns -0 into 0
}

/** `a − b`, cleaned at the size of its operands. */
export function cleanDiff(a: number, b: number): number {
  return cleanFloat(a - b, Math.max(Math.abs(a), Math.abs(b)));
}

/**
 * Axis-aligned padding a stroke of `width` adds around a segment running
 * (dx, dy) — how far its ink reaches beyond the segment's own bounding box.
 *
 * A stroke is centred on its path and extends `width / 2` PERPENDICULAR to it,
 * so the padding each axis needs is that radius projected onto the axis:
 * `r·|dy|/L` in x and `r·|dx|/L` in y. A flat `width / 2` over-pads a shallow
 * line in x and under-pads it in y.
 *
 * Do NOT confuse this with `(w/2)·√(1+slope²)`, the ink's extent at a FIXED x.
 * That is the right number for an infinite line and the wrong one for a
 * segment: it diverges as the line approaches vertical, and using it to place a
 * connector displaced a shipped bar fixture by 1.76 units — five times the
 * stroke's own half-width.
 */
export function strokeBoxPad(
  width: number,
  dx: number,
  dy: number,
): { x: number; y: number } {
  const r = width / 2;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: r, y: r };
  return { x: (r * Math.abs(dy)) / length, y: (r * Math.abs(dx)) / length };
}

/**
 * Where a ROW label starts, given the lane it sits in and how it is aligned.
 *
 * `labelsToNodes` anchors every label text node at `align: 'start'`, so row-label
 * alignment is expressed entirely through this x. Left puts every label on ONE
 * left edge; right puts each label BLOCK against the plot, which keeps a
 * short label next to its bar.
 *
 * Left is the default because right reads as broken:
 * a multi-line label is positioned by its longest line while every line is still
 * start-anchored, so the block's left edge is ragged AND its short lines leave a
 * ragged right edge (tornado, likert). Left gives
 * one clean edge instead of two ragged ones. Making 'right' clean per LINE needs
 * end-anchoring in the shared label emitter, which is a separate change.
 */
export function rowLabelX(
  laneX: number,
  laneW: number,
  labelW: number,
  align: 'left' | 'right',
): number {
  return align === 'right' ? laneX + laneW - labelW : laneX;
}
