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
import { roundHalfUp, valueSetDecimals } from '../formatPrecision';
import { cleanDiff, type Rect } from '../geometry';
import { PRIORITY, type LabelRequest } from '../label/solver';
import type { FontSpec, TextMeasurer } from '../text';
import type { OwnerRef } from '../types/cell';

/** Narrower canvases keep the column off: a column over a narrow plot costs the marks more than it tells. */
export const COLUMN_MIN_WIDTH = 576;
/** Clear space between the column and the content to its left. */
export const COLUMN_GAP = 16;

/**
 * The signed text of a difference `minuend - subtrahend`, with no unit: the head carries the unit.
 * Each operand is rounded to the decimals the chart prints it with before the subtraction, so the
 * column foots with the two labels on the page (7.89 and 9.24 give -1.35, never -1.34 from 7.894 and 9.236).
 * A scaled format (k, m, bn) prints the operands at another scale, so it subtracts the raw values.
 */
export function differenceFormatter(input: { format?: string; locale?: string; values: number[]; decimals?: number }): (minuend: number, subtrahend: number) => string {
  const printed = (decimals: number | undefined, scaled: boolean) => (value: number): number =>
    decimals === undefined || scaled ? value : Math.sign(value) * Number(roundHalfUp(Math.abs(value), decimals));
  if (input.format) {
    const spec = { ...exampleSpec(differenceExample(input.format), input.locale, undefined, input.values), signed: true, prefix: '', suffix: '' };
    const round = printed(spec.decimals, spec.magnitude !== 'none' || spec.significantDigits !== undefined || spec.autoMagnitude === true);
    return (minuend, subtrahend) => formatWithSpec(cleanDiff(round(minuend), round(subtrahend)), spec);
  }
  const decimals = input.decimals ?? valueSetDecimals(input.values);
  const round = printed(decimals, false);
  return (minuend, subtrahend) => formatAutomaticNumber(cleanDiff(round(minuend), round(subtrahend)), { locale: input.locale, signed: true, decimals });
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
