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
export function nameReadsAsOwn(rect: Rect, leader: string | undefined, own: NameMark, marks: readonly NameMark[], texts: readonly Rect[] = [], fontSize?: number): boolean {
  return leader !== undefined ? !leaderCrosses(leader, own, marks, texts) : nearestIsOwn(inkBox(rect, fontSize), own, marks);
}
