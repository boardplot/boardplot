/**
 * A derived number printed once per row in a right-hand column under a head:
 * slope's change, a dumbbell's gap, a butterfly's difference, likert's base.
 * The engine already computes each of these; the column draws it on the page
 * so a reader never subtracts two labels by hand. The numbers print signed and
 * without a unit; the head names the unit ("pp" for a difference of percent
 * levels). Cells are labels like any other, placed by the solver in one seat.
 */

import { differenceExample, exampleSpec, formatWithSpec } from '../formatSpec';
import { formatAutomaticNumber, PERCENTAGE_POINTS } from '../format';
import { valueSetDecimals } from '../formatPrecision';
import type { Rect } from '../geometry';
import { PRIORITY, type LabelRequest } from '../label/solver';
import type { FontSpec, TextMeasurer } from '../text';
import type { OwnerRef } from '../types/cell';

/** Narrower canvases keep the column off: a column over a narrow plot costs the marks more than it tells. */
export const COLUMN_MIN_WIDTH = 576;
/** Clear space between the column and the content to its left. */
export const COLUMN_GAP = 16;

/** The signed text of a difference, at the precision of the plotted values it subtracts (the values the chart prints) and with no unit: the head carries the unit. */
export function differenceFormatter(input: { format?: string; locale?: string; values: number[]; decimals?: number }): (value: number) => string {
  if (input.format) {
    const spec = { ...exampleSpec(differenceExample(input.format), input.locale, undefined, input.values), signed: true, prefix: '', suffix: '' };
    return (value) => formatWithSpec(value, spec);
  }
  const decimals = input.decimals ?? valueSetDecimals(input.values);
  return (value) => formatAutomaticNumber(value, { locale: input.locale, signed: true, decimals });
}

/** "Change, pp" for a difference of percent levels, the word alone otherwise. */
export function columnHeadText(word: string, percentLevels: boolean, unit: string = PERCENTAGE_POINTS): string {
  return percentLevels ? `${word}, ${unit}` : word;
}

/** The width a column needs: its widest cell or its head. */
export function columnWidth(measure: TextMeasurer, cells: { text: string; font: FontSpec }[], head: { text: string; font: FontSpec }): number {
  return Math.ceil(Math.max(measure(head.text, head.font).width, ...cells.map((cell) => measure(cell.text, cell.font).width)));
}

/** One cell, right-aligned at `right` and centred on `cy`. It prints a derived number and names its row only. */
export function columnCellRequest(input: {
  id: string; owner: OwnerRef; text: string; font: FontSpec; measure: TextMeasurer; right: number; cy: number;
}): LabelRequest {
  const size = input.measure(input.text, input.font);
  const rect: Rect = { x: input.right - size.width, y: input.cy - size.height / 2, w: size.width, h: size.height };
  return {
    id: input.id, kind: 'point', owner: input.owner, text: input.text, lines: [input.text], font: input.font,
    // A cell the reader needs to compare down the column: it drops last, and it never moves to another seat.
    priority: PRIORITY.grandTotal, protect: true, pad: 0, printsFor: [], align: 'end',
    candidates: [{ slot: 'valueColumn', rect, penalty: 0 }],
  };
}
