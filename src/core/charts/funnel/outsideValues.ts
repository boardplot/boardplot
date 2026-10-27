/**
 * Segment values that do not fit inside their segment. They move outside
 * the bar end, in ink colour, one after the other on the row's own line, in
 * segment order (never under the bar, where a value reads as the next
 * stage's). Past a drawn stage total each one carries its segment's swatch,
 * so "410 ■90" never reads as one number. The bars are sized so that the widest such line still ends
 * inside the plot.
 */
import { SWATCH_RESERVE } from '../../label/emit';


/** Space between two outside values on one row. */
export const OUTSIDE_GAP = 8;
/** Space from the bar end to the first outside value when the total is not drawn. */
const BAR_GAP = 8;
/** Space from the stage total to the first outside value. */
const TOTAL_GAP = 10;

interface OutsideRow {
  total: number;
  /** Width of the drawn stage total; 0 when totals are off. */
  totalW: number;
  segments: { value: number; textW: number }[];
}

/** Left edge of a row's outside values. */
export function outsideStart(rowEndX: number, totalW: number): number {
  return rowEndX + BAR_GAP + (totalW > 0 ? totalW + TOTAL_GAP : 0);
}

/** The width a displaced value takes on the outside line: its text, and its swatch past a total. */
export function outsideWidth(textW: number, totalW: number): number {
  return textW + (totalW > 0 ? SWATCH_RESERVE : 0);
}

/** The values of one row that go outside at this bar width, in segment order. */
function outsideSegments(
  row: OutsideRow,
  pxPerUnit: number,
  fits: (textW: number, segmentW: number, first: boolean) => boolean,
): number[] {
  const drawn = row.segments.filter((segment) => segment.value * pxPerUnit > 0.01);
  // One placement per row: one value outside sends the whole row outside.
  const allInside = drawn.every((segment, index) => fits(segment.textW, segment.value * pxPerUnit, index === 0));
  return allInside ? [] : drawn.map((segment) => outsideWidth(segment.textW, row.totalW));
}

/**
 * The bar width at which every row's outside values end left of `limit`.
 * Narrowing the bars can push more values outside, so the width is searched
 * until it stops changing. It never drops under half the width it started
 * from; past that point a value is placed by the solver's fallbacks or hidden.
 */
export function barWidthForOutsideValues(input: {
  barW: number;
  x0: number;
  limit: number;
  maxTotal: number;
  rows: OutsideRow[];
  fits: (textW: number, segmentW: number, first: boolean) => boolean;
}): number {
  const { x0, limit, maxTotal, rows, fits } = input;
  if (maxTotal <= 0) return input.barW;
  const floor = Math.max(10, input.barW / 2);
  let barW = input.barW;
  for (let pass = 0; pass < 8; pass++) {
    let next = barW;
    for (const row of rows) {
      const widths = outsideSegments(row, barW / maxTotal, fits);
      if (widths.length === 0 || row.total <= 0) continue;
      const cluster = widths.reduce((sum, w) => sum + w, 0) + OUTSIDE_GAP * (widths.length - 1);
      const room = limit - (outsideStart(x0, row.totalW) - x0) - cluster - x0;
      next = Math.min(next, (room * maxTotal) / row.total);
    }
    next = Math.max(floor, next);
    if (next >= barW - 0.01) break;
    barW = next;
  }
  return barW;
}
