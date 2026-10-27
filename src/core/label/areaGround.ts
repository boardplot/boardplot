/**
 * Area fills as ground for other series' values. A value that lies wholly
 * on another series' fill, clear of that fill's edges, reads on the fill as
 * an inside value reads on its own band: the chart marks such a seat
 * (SlotCandidate.onFill), the fill's claims then let it through, and the
 * text takes its ink against the fill.
 */

import type { Point, Rect } from '../geometry';
import type { Id } from '../types/cell';
import type { HatchPattern, Paint } from '../types/scene';
import { LAST_RESORT_PENALTY, type LabelRequest, type SlotCandidate } from './solver';

/** One stretch of an area fill as drawn, one paint over it. */
export interface AreaGround {
  seriesId: Id;
  /** The top and bottom edges as drawn, left to right over the same span. */
  top: readonly Point[];
  bottom: readonly Point[];
  paint: Paint;
  /** A hatched forecast stretch. */
  pattern?: HatchPattern;
}

/** The y of a left-to-right polyline at x, clamped to its ends. */
export function polylineYAt(line: readonly Point[], x: number): number {
  if (x <= line[0]!.x) return line[0]!.y;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    if (x <= b.x) return b.x === a.x ? b.y : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
  }
  return line[line.length - 1]!.y;
}

/**
 * A fill's two drawn edges as its upper and lower edge on screen. A negative
 * area draws its line under its baseline, and a stretch that crosses zero
 * swaps them where the two edges meet.
 */
export function screenEdges(a: readonly Point[], b: readonly Point[]): { top: Point[]; bottom: Point[] } {
  const lo = Math.max(a[0]!.x, b[0]!.x), hi = Math.min(a[a.length - 1]!.x, b[b.length - 1]!.x);
  const points = [...a.map((p) => ({ x: p.x, ya: p.y, yb: polylineYAt(b, p.x) })), ...b.map((p) => ({ x: p.x, ya: polylineYAt(a, p.x), yb: p.y }))]
    .filter((p) => p.x >= lo && p.x <= hi).sort((p, q) => p.x - q.x);
  const top: Point[] = [], bottom: Point[] = [];
  points.forEach((q, i) => {
    const p = points[i - 1];
    const dp = p ? p.ya - p.yb : 0, dq = q.ya - q.yb;
    if (p && dp * dq < 0) {
      const t = dp / (dp - dq);
      const cross = { x: p.x + t * (q.x - p.x), y: p.ya + t * (q.ya - p.ya) };
      top.push(cross);
      bottom.push(cross);
    }
    top.push({ x: q.x, y: Math.min(q.ya, q.yb) });
    bottom.push({ x: q.x, y: Math.max(q.ya, q.yb) });
  });
  return { top, bottom };
}

/** An edge's y at both ends of [x0, x1] and at every vertex between: a polyline's extremes over that span. */
const edgeYs = (edge: readonly Point[], x0: number, x1: number): number[] =>
  [polylineYAt(edge, x0), polylineYAt(edge, x1), ...edge.filter((point) => point.x > x0 && point.x < x1).map((point) => point.y)];

/** A ground's span, clamped to [x0, x1], or undefined where they do not meet. */
const spanOf = (ground: AreaGround, x0: number, x1: number): [number, number] | undefined => {
  const a = Math.max(x0, ground.top[0]!.x, ground.bottom[0]!.x);
  const b = Math.min(x1, ground.top[ground.top.length - 1]!.x, ground.bottom[ground.bottom.length - 1]!.x);
  return a < b ? [a, b] : undefined;
};

/**
 * The ground the rect lies wholly on: inside its span, and `pad` under its
 * top edge and over its bottom edge. The span's ends take no pad: a fill
 * ends at the plot's edge or at a forecast divider, which claims its own air.
 * Grounds come in drawing order; a later fill that reaches into the rect
 * covers the ground there, so the rect has none.
 */
export function groundUnder(rect: Rect, pad: number, grounds: readonly AreaGround[]): AreaGround | undefined {
  const x0 = rect.x, x1 = rect.x + rect.w;
  const y0 = rect.y - pad, y1 = rect.y + rect.h + pad;
  for (let i = grounds.length - 1; i >= 0; i--) {
    const ground = grounds[i]!;
    if (ground.top.length < 2 || ground.bottom.length < 2) continue;
    const span = spanOf(ground, x0, x1);
    if (!span) continue;
    if (span[0] <= x0 && x1 <= span[1] && edgeYs(ground.top, x0, x1).every((y) => y <= y0) && edgeYs(ground.bottom, x0, x1).every((y) => y >= y1)) return ground;
    // Any part of this fill inside the rect covers whatever lies under it.
    if (reachesInto(ground, span, y0, y1)) return undefined;
  }
  return undefined;
}

/** Whether a ground reaches into the rows [y0, y1] over its span. */
const reachesInto = (ground: AreaGround, span: [number, number], y0: number, y1: number): boolean =>
  Math.min(...edgeYs(ground.top, ...span)) < y1 && Math.max(...edgeYs(ground.bottom, ...span)) > y0;

/** A seat on its own fill's edge: part of it on that fill, part off. */
function straddlesOwn(rect: Rect, grounds: readonly AreaGround[], own: Id): boolean {
  return grounds.some((ground) => {
    if (ground.seriesId !== own || ground.top.length < 2 || ground.bottom.length < 2) return false;
    const span = spanOf(ground, rect.x, rect.x + rect.w);
    return span !== undefined && reachesInto(ground, span, rect.y, rect.y + rect.h);
  });
}

/**
 * Every point value's seat that lies wholly on a fill, with no fill drawn
 * over it, takes that fill as its ground: another series' fill (when
 * `others` allows it) or its own, where it reads in contrast ink as an
 * inside value does. A led seat, an inside seat and a haloed seat (page ink
 * over columns) keep theirs. `kinds` names the requests that may: point
 * values, and in combo the column totals, which an area behind the columns
 * reaches. A seat on its own fill ranks behind the page seats of its kind,
 * so a value keeps its place over its line where one is free. A seat half on
 * its own fill and half off has no ink that reads on both: it ranks behind
 * both, and stays offered, so no value is lost.
 */
export function seatValuesOnGround(
  requests: readonly LabelRequest[], grounds: readonly AreaGround[], pad: number, cssOf: (ground: AreaGround) => string, others = true,
  kinds: readonly string[] = ['point'],
): void {
  if (grounds.length === 0) return;
  for (const request of requests) {
    // A column total has no series: every fill is another's.
    const own = request.owner.seriesId ?? '';
    if (!kinds.includes(request.kind) || (own === '' && request.kind === 'point')) continue;
    const rank = new Map<SlotCandidate, number>();
    request.candidates = request.candidates.map((candidate) => {
      if (candidate.leaderFrom || candidate.insideFill !== undefined || candidate.needsBacking) return candidate;
      // Its own fill needs no pad: the value's own edge is not another series' mark.
      const under = groundUnder(candidate.rect, pad, grounds);
      const ownUnder = groundUnder(candidate.rect, 0, grounds);
      const ground = under && (others || under.seriesId === own) ? under : ownUnder?.seriesId === own ? ownUnder : undefined;
      if (ground) {
        const seated = { ...candidate, onFill: { seriesId: ground.seriesId, fill: cssOf(ground), paint: ground.paint, ...(ground.pattern ? { pattern: ground.pattern } : {}) } };
        if (ground.seriesId === own) rank.set(seated, 1);
        return seated;
      }
      if (straddlesOwn(candidate.rect, grounds, own)) rank.set(candidate, 2);
      return candidate;
    });
    if (rank.size === 0) continue;
    const tier = (candidate: SlotCandidate) => (candidate.leaderFrom || candidate.penalty >= LAST_RESORT_PENALTY ? 3 : 0) + (rank.get(candidate) ?? 0);
    request.candidates = request.candidates.map((candidate, index) => ({ candidate, index }))
      .sort((a, b) => tier(a.candidate) - tier(b.candidate) || a.index - b.index).map(({ candidate }) => candidate);
  }
}
