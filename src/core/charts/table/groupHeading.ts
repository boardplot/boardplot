/**
 * The room a column-group heading needs. A heading is drawn over
 * its member tracks, and no track paid for it: "FY26 YTD" over a one-column
 * block ran past its span in the SVG and was cut by the cell edge in the
 * grid. Both surfaces measure the heading here, the way they draw it, and
 * give any shortfall to the last member, so the heading keeps the cell air
 * on both sides.
 */

import { WEIGHT_REGULAR } from '../../theme';
import type { FontSpec, TextMeasurer } from '../../text';
import type { Id } from '../../types/cell';
import type { ResolvedTable } from '../../types/table';

/** The faces a heading is drawn in: the label tracked, the note untracked. */
export interface GroupHeadingFaces {
  label: FontSpec;
  note: FontSpec;
}

/**
 * The faces of a heading drawn in `label`: the note is the label's
 * size, untracked and at 400, as in "MONTH-TO-DATE · Jul 1-15".
 * Both surfaces take it here; the SVG drew the note at the label's 500.
 */
export function groupHeadingFaces(label: FontSpec): GroupHeadingFaces {
  return { label, note: { ...label, weight: WEIGHT_REGULAR, letterSpacing: 0 } };
}

/** The label as drawn: in capitals. The tracking is the face's own. */
export function groupHeadingLabel(label: string): string {
  return label.toUpperCase();
}

/** The note as drawn after the label, or undefined where there is none. */
export function groupHeadingNote(note: string | undefined): string | undefined {
  return note === undefined ? undefined : ` · ${note}`;
}

/**
 * The drawn width of a heading's label and of its note. The measurer counts
 * the tracking between the glyphs already (core/text), so nothing is added
 * for it here.
 */
export function groupHeadingWidth(
  group: { label: string; note?: string },
  faces: GroupHeadingFaces,
  measure: TextMeasurer,
): { label: number; note: number } {
  const note = groupHeadingNote(group.note);
  return {
    label: measure(groupHeadingLabel(group.label), faces.label).width,
    note: note === undefined ? 0 : measure(note, faces.note).width,
  };
}

/**
 * What a drawn heading cell takes beside the heading's own text.
 * The SVG centres the heading over its members with the cell air on either
 * side, and its renderer pulls the tracking after the last glyph back in. The
 * grid draws the heading in a cell: the cell air, a 1 px border at the start
 * of every group after the first, and CSS letter-spacing, which follows the
 * last letter as well as the gaps the measurer counts.
 */
export interface GroupHeadingCell {
  /** Air on each side of the heading. */
  padX: number;
  /** The px of a rule the cell draws at its start edge, per group. */
  startRule?: (groupId: Id) => number;
  /** The tracking follows the last letter of the label too. */
  trailingTracking?: boolean;
}

/**
 * The width a heading's cell needs: the label and its note as drawn, plus
 * what the cell itself takes. Rounded up to a whole pixel.
 */
export function groupHeadingNeed(
  group: { id: Id; label: string; note?: string },
  faces: GroupHeadingFaces,
  measure: TextMeasurer,
  cell: GroupHeadingCell,
): number {
  const width = groupHeadingWidth(group, faces, measure);
  const trailing = cell.trailingTracking === true && group.label.length > 0 ? faces.label.letterSpacing ?? 0 : 0;
  return Math.ceil(width.label + trailing + width.note + 2 * cell.padX + (cell.startRule?.(group.id) ?? 0));
}

/**
 * The px each drawn column takes on top of its own width so that every
 * heading fits over its drawn members in the cell the surface draws. The
 * shortfall goes to the last drawn member that authored no width: an
 * authored width is a fixed track, and where every member has one the
 * heading is the author's to fit. A group that draws no heading, or has no
 * member drawn, asks for nothing.
 */
export function groupHeadingFloors(
  groups: ResolvedTable['columnGroups'],
  drawn: readonly Id[],
  widthOf: (id: Id) => number,
  isFixed: (id: Id) => boolean,
  faces: GroupHeadingFaces,
  measure: TextMeasurer,
  cell: GroupHeadingCell,
): Map<Id, number> {
  const extra = new Map<Id, number>();
  for (const group of groups) {
    if (group.heading === false) continue;
    const members = drawn.filter((id) => group.columnIds.includes(id));
    if (members.length === 0) continue;
    const need = groupHeadingNeed(group, faces, measure, cell);
    const have = members.reduce((sum, id) => sum + widthOf(id), 0);
    const target = [...members].reverse().find((id) => !isFixed(id));
    if (need <= have || target === undefined) continue;
    extra.set(target, need - have);
  }
  return extra;
}
