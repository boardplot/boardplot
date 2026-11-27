/**
 * A point name must read as its own point's name. A name with no leader is nearer its own mark than any other mark,
 * measured on the circles; a name on a leader has a leader that crosses no
 * other mark and no other text. A name that can only sit where it reads as
 * another point's label goes to the page note, named with its value.
 *
 * The measuring helpers are shared with the line value rule in
 * ../../label/ownership.ts.
 */

import type { Point, Rect } from '../../geometry';
import { sideLeaderEnd } from '../../label/solver';
import { leaderPath, straightLeader } from '../../svgPath';
import { inkBox, leaderCrosses, nearestIsOwn, ownershipLeaderSamples, type NameMark } from '../../label/ownership';

/** A two-decimal SVG control moves by at most .005 on either axis. The sampled
 * cubic is a convex combination of its controls. A segment between two such
 * samples moves by less than .01. Borderline circles use the rounded SVG test. */
function clearLeader(from: Point, to: Point, own: NameMark, marks: readonly NameMark[]): boolean {
  const dx = to.x - from.x, dy = to.y - from.y;
  const left = Math.min(from.x, to.x) - 0.02, right = Math.max(from.x, to.x) + 0.02;
  const top = Math.min(from.y, to.y) - 0.02, bottom = Math.max(from.y, to.y) + 0.02;
  const curved = !straightLeader(dx, dy);
  const count = curved ? ownershipLeaderSamples.length - 1 : 1;
  let borderline = false;
  for (const mark of marks) {
    const { cx, cy, r } = mark;
    if (mark.id === own.id || !(r > 0 && cx + r > left && cx - r < right && cy + r > top && cy - r < bottom)) continue;
    if (Math.max(Math.abs(cx), Math.abs(cy), r) > 1e6) return !leaderCrosses(leaderPath(from, to), own, marks);
    let x = from.x, y = from.y;
    const outer = r + 0.02, inner = Math.max(0, r - 0.02);
    for (let i = 1; i <= count; i++) {
      const nextX = curved ? from.x + dx * ownershipLeaderSamples[i]!.x : to.x;
      const nextY = curved ? from.y + dy * ownershipLeaderSamples[i]!.y : to.y;
      if (cx + outer >= Math.min(x, nextX) && cx - outer <= Math.max(x, nextX)
        && cy + outer >= Math.min(y, nextY) && cy - outer <= Math.max(y, nextY)) {
        const vx = nextX - x, vy = nextY - y;
        const length2 = vx * vx + vy * vy;
        const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((cx - x) * vx + (cy - y) * vy) / length2));
        const ex = x + t * vx - cx, ey = y + t * vy - cy;
        const distance2 = ex * ex + ey * ey;
        if (distance2 < inner * inner) return false;
        if (distance2 <= outer * outer) borderline = true;
      }
      x = nextX; y = nextY;
    }
  }
  return !borderline || !leaderCrosses(leaderPath(from, to), own, marks);
}

/**
 * The measurable rule: a name reads as its own point's name when its nearest
 * mark is its own, or when a leader joins them that crosses no other mark
 * and no text.
 */
export function nameReadsAsOwn(rect: Rect, from: Point | undefined, own: NameMark, marks: readonly NameMark[], fontSize: number, nearer: boolean): boolean {
  // A mark whose centre lies inside the own mark, and the own centre inside it,
  // draws as one clump with it: no seat is nearer one of them and no leader
  // leaves the clump without crossing the other, so the rule reads the clump
  // as one mark (four coincident points keep their four names).
  const clump = clumpFor(own, marks);
  if (from) {
    const end = sideLeaderEnd(rect, from);
    if (end) {
      if (Math.max(Math.abs(from.x), Math.abs(from.y), Math.abs(end.x), Math.abs(end.y)) < 1e6) {
        const nearby = !nearer && Math.min(from.y, end.y) > clump.top && Math.max(from.y, end.y) < clump.bottom;
        return clearLeader(from, end, own, nearby ? nearbyRows(clump) : clump.apart);
      }
      // The line and its cubic controls lie between its endpoints. Allow for SVG's two-decimal rounding.
      const left = Math.min(from.x, end.x) - 0.01, right = Math.max(from.x, end.x) + 0.01;
      const top = Math.min(from.y, end.y) - 0.01, bottom = Math.max(from.y, end.y) + 0.01;
      if (Math.max(-left, right, -top, bottom) < 2 ** 40 && !clump.apart.some(mark => mark.id !== own.id && mark.r > 0
        && mark.cx + mark.r > left && mark.cx - mark.r < right && mark.cy + mark.r > top && mark.cy - mark.r < bottom)) return true;
      return !leaderCrosses(leaderPath(from, end), own, clump.apart);
    }
  }
  // Nearer by a hair is a tie to the eye: a name half way between two bubbles
  // reads as either one's. With `nearer`, its own mark is nearer by a quarter
  // of the type size. Dot charts leave it out: their small dots keep their
  // seats, and a lattice of 40 dots would otherwise lose a name and send the
  // height search through extra layouts (dense-40-thinning).
  const margin = nearer ? NEARER_SHARE * fontSize : 0;
  const ink = inkBox(rect, fontSize);
  if (!nearer && own.r < 1e6 && Math.abs(own.cy) < 1e6) {
    const dx = Math.max(ink.x - own.cx, 0, own.cx - ink.x - ink.w);
    const dy = Math.max(ink.y - own.cy, 0, own.cy - ink.y - ink.h);
    // This upper bound includes every circle that could tie the exact gap.
    const reach = Math.max(0, dx + dy - own.r);
    if (ink.y - reach > clump.top && ink.y + ink.h + reach < clump.bottom) {
      return nearestIsOwn(ink, own, nearbyRows(clump));
    }
  }
  return nearestIsOwn(ink, own, widened(clump, own, margin));
}

/**
 * Whether a name with no leader has its middle nearer another mark than its
 * own. A name over, under or slanted off a bubble reaches sideways, along the
 * bubble's row: with its middle nearer a neighbour it stands between the two
 * (a name slid between two bubbles). A name beside its mark starts at the mark.
 */
export function middleNearerOther(rect: Rect, own: NameMark, marks: readonly NameMark[], fontSize: number): boolean {
  const ink = inkBox(rect, fontSize);
  return !nearestIsOwn({ x: ink.x + ink.w / 2, y: ink.y + ink.h / 2, w: 0, h: 0 }, own, clumpFor(own, marks).apart);
}

interface Clump { apart: NameMark[]; nearby?: NameMark[]; top: number; bottom: number; widened: Map<number, NameMark[]> }

/**
 * The marks that stand apart from a point, worked out once per point and mark
 * list: a seat list asks for every seat, and the solver builds seat lists many
 * times per chart (dense-40-thinning).
 */
const clumpMemo = new WeakMap<readonly NameMark[], WeakMap<NameMark, Clump>>();

function clumpFor(own: NameMark, marks: readonly NameMark[]): Clump {
  let byOwn = clumpMemo.get(marks);
  if (!byOwn) clumpMemo.set(marks, byOwn = new WeakMap());
  let clump = byOwn.get(own);
  if (!clump) {
    // A name checks many seats near its point. Keep a vertical band for those
    // seats and its full mark list for seats outside the band.
    const top = own.cy - 64, bottom = own.cy + 64;
    const apart: NameMark[] = [];
    for (const mark of marks) {
      const reach = Math.min(own.r, mark.r);
      const dx = mark.cx - own.cx, dy = mark.cy - own.cy;
      if (!(mark.id === own.id || Math.abs(dy) >= reach && Number.isFinite(dx)
        || Math.abs(dx) >= reach && Number.isFinite(dy) || Math.hypot(dx, dy) >= reach)) continue;
      apart.push(mark);
    }
    clump = { apart, top, bottom, widened: new Map() };
    byOwn.set(own, clump);
  }
  return clump;
}

function nearbyRows(clump: Clump): NameMark[] {
  // One pixel covers rounded leader coordinates and distance arithmetic. Larger
  // coordinates keep the original test in case arithmetic rounds across the band.
  return clump.nearby ??= clump.apart.filter(mark => Math.abs(mark.cy) >= 1e6 || mark.r >= 1e6
    || mark.cy + mark.r >= clump.top - 1 && mark.cy - mark.r <= clump.bottom + 1);
}

/** The marks apart from the own mark, each other mark wider by the margin. */
function widened(clump: Clump, own: NameMark, margin: number): readonly NameMark[] {
  if (margin === 0) return clump.apart;
  let list = clump.widened.get(margin);
  if (!list) clump.widened.set(margin, list = clump.apart.map((m) => (m.id === own.id ? m : { ...m, r: m.r + margin })));
  return list;
}

/** How much nearer its own mark a name with no leader stands than any other mark, as a share of the type size. */
const NEARER_SHARE = 0.25;
