/** Whole-cell arithmetic of a waffle panel. Pure; no layout. */

/**
 * Cells of each segment, in whole cells, by largest-remainder rounding.
 * `values` are percents of the whole; the whole has `cells` cells. The filled
 * total is the rounded sum of the exact counts (never above `cells`), so a
 * panel of three 33.3% segments draws 99 cells and not 3 × 33. The cells left
 * after rounding down go to the segments with the largest remainders; a tie
 * goes to the earlier segment. Deterministic.
 */
export function allocateCells(values: readonly number[], cells: number): { exact: number[]; whole: number[] } {
  const EPS = 1e-9;
  const exact = values.map((value) => (value * cells) / 100);
  const whole = exact.map((cell) => Math.floor(cell + EPS));
  const target = Math.min(cells, Math.floor(exact.reduce((sum, cell) => sum + cell, 0) + 0.5 + EPS));
  let left = target - whole.reduce((sum, cell) => sum + cell, 0);
  const order = exact
    .map((cell, index) => ({ index, remainder: cell - Math.floor(cell + EPS) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let at = 0; left > 0 && order.length > 0; at = (at + 1) % order.length, left--) whole[order[at]!.index]!++;
  return { exact, whole };
}

/**
 * Position of cell number `k` (0-based, in fill order) as a column and a row
 * counted from the top of the grid. 'bottom' starts at the bottom left and
 * fills each row left to right, moving up; 'top' starts at the top left and
 * moves down. A partly filled row fills from the left in both.
 */
export function cellAt(k: number, columns: number, rows: number, fillFrom: 'bottom' | 'top'): { col: number; row: number } {
  const step = Math.floor(k / columns);
  return { col: k % columns, row: fillFrom === 'bottom' ? rows - 1 - step : step };
}
