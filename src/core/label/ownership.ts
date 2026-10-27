/**
 * Value ownership on line points. A value printed at a line
 * point must read as that point's value. Two values on one vertical line, or a
 * value nearer another point than its own, make the reader guess which number
 * belongs to which point; a misleading label is never allowed.
 *
 * The rule, measured on the drawn text (the ink box, not the line box):
 * - its own point is the nearest drawn point to the text, and
 * - the text does not cover another category's band more than its own,
 *   unless it stands over its own point (the text spans the point's x).
 * A seat whose drawn leader joins it to its own point reads as its own when the
 * leader passes no other point. A seat that fails takes its turn after every
 * seat that passes, with a short leader to its own point; a seat that cannot
 * take a leader is dropped. A value with no seat left goes to the note line,
 * named with its series and category (the solver's `collision` path).
 *
 * The scatter name rule (charts/scatter/nameReading.ts) is the same idea for
 * names: a name takes a seat only when its nearest mark is its own or its
 * leader crosses no other mark. Its helpers live here so both share them.
 */

import type { Point, Rect } from '../geometry';
import type { Id } from '../types/cell';

export interface NameMark {
  id: unknown;
  cx: number;
  cy: number;
  r: number;
}

/** The gap from a box to a circle's edge: 0 when they touch or overlap. */
function circleGap(rect: Rect, m: NameMark): number {
  const dx = Math.max(rect.x - m.cx, 0, m.cx - rect.x - rect.w);
  const dy = Math.max(rect.y - m.cy, 0, m.cy - rect.y - rect.h);
  return Math.max(0, Math.hypot(dx, dy) - m.r);
}

/** The least distance from a segment to a point. */
function segmentDistance(a: { x: number; y: number }, b: { x: number; y: number }, x: number, y: number): number {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / len2));
  return Math.hypot(a.x + t * vx - x, a.y + t * vy - y);
}

/** Whether a segment enters a box. */
function segmentEntersRect(a: { x: number; y: number }, b: { x: number; y: number }, r: Rect): boolean {
  // Sampled: leader pieces are short (a curve cut into 16 pieces).
  for (let i = 0; i <= 8; i++) {
    const x = a.x + ((b.x - a.x) * i) / 8, y = a.y + ((b.y - a.y) * i) / 8;
    if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true;
  }
  return false;
}

/** Whether any straight piece of a line or sampled cubic passes the predicate. */
function somePathPiece(d: string, steps: number, hit: (a: Point, b: Point) => boolean): boolean {
  const n = d.trim().split(/[\s,A-Za-z]+/).filter(Boolean).map(Number);
  if (n.length < 8) return hit({ x: n[0]!, y: n[1]! }, { x: n[2]!, y: n[3]! });
  const at = (t: number) => {
    const u = 1 - t;
    const [a, b, c, e] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    return { x: a * n[0]! + b * n[2]! + c * n[4]! + e * n[6]!, y: a * n[1]! + b * n[3]! + c * n[5]! + e * n[7]! };
  };
  for (let i = 0; i < steps; i++) if (hit(at(i / steps), at((i + 1) / steps))) return true;
  return false;
}

/** Whether a name box with no leader is nearer its own mark than any other mark. */
export function nearestIsOwn(rect: Rect, own: NameMark, marks: readonly NameMark[]): boolean {
  const mine = circleGap(rect, own);
  return marks.every((m) => m.id === own.id || circleGap(rect, m) > mine);
}

/** Whether a leader path crosses another point's mark or one of the given text boxes. */
export function leaderCrosses(d: string, own: NameMark, marks: readonly NameMark[], texts: readonly Rect[] = []): boolean {
  // The leader stays inside the box of its path's points (an S-curve inside its
  // control polygon): only marks and texts that meet that box need the pieces.
  const nums = d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    x0 = Math.min(x0, nums[i]!); x1 = Math.max(x1, nums[i]!);
    y0 = Math.min(y0, nums[i + 1]!); y1 = Math.max(y1, nums[i + 1]!);
  }
  const near = marks.filter((m) => m.id !== own.id && m.r > 0 && m.cx + m.r > x0 && m.cx - m.r < x1 && m.cy + m.r > y0 && m.cy - m.r < y1);
  const nearTexts = texts.filter((t) => t.x < x1 && t.x + t.w > x0 && t.y < y1 && t.y + t.h > y0);
  if (near.length === 0 && nearTexts.length === 0) return false;
  return somePathPiece(d, 16, (a, b) =>
    near.some((m) => segmentDistance(a, b, m.cx, m.cy) < m.r)
    || nearTexts.some((t) => segmentEntersRect(a, b, t)));
}

/**
 * The drawn text, not its line box: the line box holds air over the capitals
 * (about a quarter of the font size). Measured on the line box, "Ferrox 6.5"
 * under its bubble was 4 px from Ferrox and 6 px from SwiftHaul's dot on the
 * same line; on the ink it is 7 px from Ferrox and reads as SwiftHaul's
 * (scatter.bubbles 320).
 */
export function inkBox(rect: Rect, fontSize?: number): Rect {
  const inset = fontSize === undefined ? 0 : Math.min(rect.h / 2, CAP_AIR * fontSize);
  return { x: rect.x, y: rect.y + inset, w: rect.w, h: rect.h - inset };
}

/** Air over the capitals in a label's line box, as a share of the font size. */
const CAP_AIR = 0.25;

/** One drawn line point: the mark a value names. */
interface OwnedPoint {
  seriesId: Id;
  categoryId: Id;
  x: number;
  y: number;
}

/**
 * The drawn line points of one plot, for the solver (SolveCtx.pointOwnership).
 * `categoryX` holds the x of every category on the axis, drawn or not, so a
 * band is one step wide even where a line has a gap.
 */
export interface PointOwnershipInput {
  points: readonly OwnedPoint[];
  categoryX: ReadonlyMap<Id, number>;
}

/** The lookups the solver keeps for one solve. */
export interface PointOwnership {
  pointOf(seriesId: Id | undefined, categoryId: Id | undefined): OwnedPoint | undefined;
  points: readonly OwnedPoint[];
  bands: ReadonlyMap<Id, readonly [number, number]>;
  /** The points whose x lies in [x0, x1], from an index sorted by x. */
  pointsIn(x0: number, x1: number): readonly OwnedPoint[];
}

/** Builds the lookups once per solve. */
export function pointOwnership(input: PointOwnershipInput): PointOwnership {
  const byKey = new Map(input.points.map((p) => [`${p.seriesId}\u0000${p.categoryId}`, p]));
  const xs = [...input.categoryX].sort((a, b) => a[1] - b[1]);
  const bands = new Map<Id, readonly [number, number]>();
  for (let i = 0; i < xs.length; i++) {
    const [id, x] = xs[i]!;
    const left = i > 0 ? (x - xs[i - 1]![1]) / 2 : undefined;
    const right = i + 1 < xs.length ? (xs[i + 1]![1] - x) / 2 : undefined;
    const half = (side: number | undefined, other: number | undefined) => side ?? other ?? 0;
    bands.set(id, [x - half(left, right), x + half(right, left)]);
  }
  const byX = [...input.points].sort((a, b) => a.x - b.x);
  const firstAtOrRight = (x: number): number => {
    let lo = 0, hi = byX.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (byX[mid]!.x < x) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const pointsIn = (x0: number, x1: number): readonly OwnedPoint[] => {
    const out: OwnedPoint[] = [];
    for (let i = firstAtOrRight(x0); i < byX.length && byX[i]!.x <= x1; i++) out.push(byX[i]!);
    return out;
  };
  return {
    pointsIn,
    pointOf: (seriesId, categoryId) => seriesId === undefined || categoryId === undefined ? undefined : byKey.get(`${seriesId}\u0000${categoryId}`),
    points: input.points,
    bands,
  };
}

/** A point at the same place as the label's own (two lines through one value) is no rival. */
const SAME_POINT = 0.5;
/**
 * Another point rivals the seat when it is nearer the drawn text by more than
 * this: a marker's radius. Closer than that the eye cannot tell which point is
 * nearer (a value left of a daily line's first point, 0.9 px farther from it
 * than from the second point 5 px away); the band rule still holds there.
 */
const NEARER_BY = 3;
/** Another category's band rivals the seat when the text covers it by more than this beyond its own. */
const BAND_BY = 1;
/** A leader passing this near another point reads as that point's (a marker's reach). */
const LEADER_POINT_R = 3;

/**
 * Whether a seat with no leader reads as its own point's value: its own point
 * is the nearest drawn point to the ink, and the ink covers no other category's
 * band more than its own unless it stands over its own point.
 */
export function readsAsOwnPoint(rect: Rect, own: OwnedPoint, model: PointOwnership, fontSize?: number): boolean {
  const ink = inkBox(rect, fontSize);
  const gap = (p: { x: number; y: number }) => Math.hypot(Math.max(ink.x - p.x, 0, p.x - ink.x - ink.w), Math.max(ink.y - p.y, 0, p.y - ink.y - ink.h));
  const mine = gap(own);
  // Only a point nearer than its own can rival: none lies farther than that from the ink on x.
  for (const p of model.pointsIn(ink.x - mine, ink.x + ink.w + mine)) {
    if (p === own || (Math.abs(p.x - own.x) < SAME_POINT && Math.abs(p.y - own.y) < SAME_POINT)) continue;
    if (gap(p) + NEARER_BY < mine) return false;
  }
  if (ink.x <= own.x && own.x <= ink.x + ink.w) return true;
  const cover = (band: readonly [number, number]) => Math.max(0, Math.min(ink.x + ink.w, band[1]) - Math.max(ink.x, band[0]));
  const ownBand = model.bands.get(own.categoryId);
  const mineCover = ownBand ? cover(ownBand) : 0;
  for (const [id, band] of model.bands) if (id !== own.categoryId && cover(band) > mineCover + BAND_BY) return false;
  return true;
}

/**
 * Whether the text of a seat on a leader stands beside another point: level
 * with it (the point within the ink's height) or straight over or under it
 * (within the ink's width), less than one line away, and nearer than its own
 * point. A leader does not undo that; the eye pairs the value with the point
 * beside it first (a lower line's end value lifted level with the upper line's end).
 */
export function besideOtherPoint(rect: Rect, own: OwnedPoint, model: PointOwnership, fontSize?: number): boolean {
  const ink = inkBox(rect, fontSize);
  const dx = (p: { x: number }) => Math.max(ink.x - p.x, 0, p.x - ink.x - ink.w);
  const dy = (p: { y: number }) => Math.max(ink.y - p.y, 0, p.y - ink.y - ink.h);
  const mine = Math.hypot(dx(own), dy(own));
  return model.pointsIn(ink.x - mine, ink.x + ink.w + mine).some((p) => p !== own && !(Math.abs(p.x - own.x) < SAME_POINT && Math.abs(p.y - own.y) < SAME_POINT)
    && ((dy(p) <= ALIGNED && dx(p) < rect.h) || (dx(p) <= ALIGNED && dy(p) < rect.h)) && Math.hypot(dx(p), dy(p)) + NEARER_BY < mine);
}

/** A point this near the ink's span on one axis is aligned with the text on it. */
const ALIGNED = 2;

/** Whether a drawn leader from the seat to its own point passes no other point. */
export function leaderReadsAsOwn(d: string, own: OwnedPoint, model: PointOwnership): boolean {
  const ownMark: NameMark = { id: own, cx: own.x, cy: own.y, r: LEADER_POINT_R };
  // The leader stays inside the box of its path's points; only points in its x span (plus a mark's reach) can meet it.
  const xs = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number).filter((_, i) => i % 2 === 0);
  const marks = model.pointsIn(Math.min(...xs) - LEADER_POINT_R, Math.max(...xs) + LEADER_POINT_R)
    .filter((p) => p !== own && !(Math.abs(p.x - own.x) < SAME_POINT && Math.abs(p.y - own.y) < SAME_POINT))
    .map((p): NameMark => ({ id: p, cx: p.x, cy: p.y, r: LEADER_POINT_R }));
  return !leaderCrosses(d, ownMark, marks);
}
