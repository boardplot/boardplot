/**
 * The column heads of a bullet card (target and gap beside KPI rows; actual, share and
 * difference on the percent-of-target rows). A head is a label like any other: it is
 * fitted by the shared truncation policy and placed by the label solver, so a head
 * that cannot be placed hides by the solver's rules. The scene keeps its table-head
 * part, which holds it to the table-head type floor.
 */

import { fitText, type FittedText } from '../../label/fitText';
import { PRIORITY, type LabelRequest } from '../../label/solver';
import type { Rect } from '../../geometry';
import type { FontSpec, TextMeasurer } from '../../text';
import type { RenderTarget } from '../../types/options';
import type { SceneNode } from '../../types/scene';

/** A head may run this many font sizes wide before it is cut, unless its column is wider anyway. */
const HEAD_EM = 12;

export const HEAD_PREFIX = 'header:';

/** The head as drawn: whole while it fits its column or 12 em, else cut with an ellipsis and the full words as the title. */
export function fitHead(
  text: string,
  font: FontSpec,
  bodyW: number,
  measure: TextMeasurer,
  env: { target: RenderTarget; textScale: number },
): FittedText {
  return fitText(text, font, Math.max(bodyW, HEAD_EM * font.size), 1, measure, { target: env.target, textScale: env.textScale, typeRole: 'footnote' });
}

/** A head ending at `right` (`order`: its column's index; labels keep id order, so the heads read left to right), on the line starting at `y`; `onKey` when that is the key line, which the layout has checked for room. */
export function headRequest(key: string, order: number, head: FittedText, right: number, y: number, h: number, onKey: boolean): LabelRequest {
  // A head on the top edge (margin 0) stays on the canvas, or the solver would hide it.
  const rect: Rect = { x: right - head.w, y: Math.max(0, y), w: head.w, h };
  return {
    id: `${HEAD_PREFIX}${order}:${key}`, kind: 'annotation', role: 'category', align: 'end', owner: {}, text: head.lines[0]!, lines: head.lines, font: head.font,
    ...(head.title !== undefined ? { title: head.title } : {}),
    typeRole: 'footnote', priority: PRIORITY.total, pad: 0,
    candidates: [{ slot: 'columnHead', rect, penalty: 0, ...(onKey ? { overLegend: true } : {}) }],
  };
}

/** The solver emits an annotation; a head keeps the part of a table head. */
export function asColumnHeads(nodes: SceneNode[]): void {
  nodes.forEach((node, index) => {
    if (node.t === 'text' && node.id.startsWith(`label:${HEAD_PREFIX}`)) nodes[index] = { ...node, part: 'tableHeader' };
  });
}
