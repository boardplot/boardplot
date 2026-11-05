/**
 * A point name must read as its own point's name. A name with no leader is nearer its own mark than any other mark,
 * measured on the circles; a name on a leader has a leader that crosses no
 * other mark and no other text. A name that can only sit where it reads as
 * another point's label goes to the page note, named with its value.
 *
 * The measuring helpers are shared with the line value rule in
 * ../../label/ownership.ts.
 */

import type { Rect } from '../../geometry';
import { inkBox, leaderCrosses, nearestIsOwn, type NameMark } from '../../label/ownership';

/**
 * The measurable rule: a name reads as its own point's name when its nearest
 * mark is its own, or when a leader joins them that crosses no other mark
 * and no text.
 */
export function nameReadsAsOwn(rect: Rect, leader: string | undefined, own: NameMark, marks: readonly NameMark[], texts: readonly Rect[] = [], fontSize?: number, nearer = true): boolean {
  // A mark whose centre lies inside the own mark, and the own centre inside it,
  // draws as one clump with it: no seat is nearer one of them and no leader
  // leaves the clump without crossing the other, so the rule reads the clump
  // as one mark (four coincident points keep their four names).
  const clump = clumpFor(own, marks);
  if (leader !== undefined) return !leaderCrosses(leader, own, clump.apart, texts);
  // Nearer by a hair is a tie to the eye: a name half way between two bubbles
  // reads as either one's. With `nearer`, its own mark is nearer by a quarter
  // of the type size. Dot charts leave it out: their small dots keep their
  // seats, and a lattice of 40 dots would otherwise lose a name and send the
  // height search through extra layouts (dense-40-thinning).
  const margin = fontSize === undefined || !nearer ? 0 : NEARER_SHARE * fontSize;
  const ink = inkBox(rect, fontSize);
  return nearestIsOwn(ink, own, widened(clump, own, margin));
}

/**
 * Whether a name with no leader has its middle nearer another mark than its
 * own. A name over, under or slanted off a bubble reaches sideways, along the
 * bubble's row: with its middle nearer a neighbour it stands between the two
 * (a name slid between two bubbles). A name beside its mark starts at the mark.
 */
export function middleNearerOther(rect: Rect, own: NameMark, marks: readonly NameMark[], fontSize?: number): boolean {
  const ink = inkBox(rect, fontSize);
  return !nearestIsOwn({ x: ink.x + ink.w / 2, y: ink.y + ink.h / 2, w: 0, h: 0 }, own, clumpFor(own, marks).apart);
}

interface Clump { apart: NameMark[]; widened: Map<number, NameMark[]> }

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
    clump = { apart: marks.filter((m) => m.id === own.id || Math.hypot(m.cx - own.cx, m.cy - own.cy) >= Math.min(own.r, m.r)), widened: new Map() };
    byOwn.set(own, clump);
  }
  return clump;
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
