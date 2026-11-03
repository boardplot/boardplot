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
export function nameReadsAsOwn(rect: Rect, leader: string | undefined, own: NameMark, marks: readonly NameMark[], texts: readonly Rect[] = [], fontSize?: number, centred = false): boolean {
  // A mark whose centre lies inside the own mark, and the own centre inside it,
  // draws as one clump with it: no seat is nearer one of them and no leader
  // leaves the clump without crossing the other, so the rule reads the clump
  // as one mark (four coincident points keep their four names).
  const apart = marks.filter((m) => m.id === own.id || Math.hypot(m.cx - own.cx, m.cy - own.cy) >= Math.min(own.r, m.r));
  if (leader !== undefined) return !leaderCrosses(leader, own, apart, texts);
  // Nearer by a hair is a tie to the eye: a name half way between two marks
  // reads as either one's. Its own mark is nearer by a quarter of the type size.
  const margin = fontSize === undefined ? 0 : NEARER_SHARE * fontSize;
  const ink = inkBox(rect, fontSize);
  if (!nearestIsOwn(ink, own, margin === 0 ? apart : apart.map((m) => (m.id === own.id ? m : { ...m, r: m.r + margin })))) return false;
  // A name over, under or slanted off a bubble reaches sideways, along the
  // bubble's row: its middle is nearer its own bubble too, or it stands over a
  // neighbour (a name slid between two bubbles). A name beside its mark starts at the mark.
  if (!centred) return true;
  return nearestIsOwn({ x: ink.x + ink.w / 2, y: ink.y + ink.h / 2, w: 0, h: 0 }, own, apart);
}

/** How much nearer its own mark a name with no leader stands than any other mark, as a share of the type size. */
const NEARER_SHARE = 0.25;
