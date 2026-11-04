/**
 * Authored column widths of a matrix (heatmap, status, and the warnings a bar
 * table shares). One cell width becomes one width per column only when an
 * author sets one, so a spec without `columnOverrides` keeps its arithmetic.
 */
import type { LintWarning } from '../../types/scene';

export interface MatrixTracks {
  /** Width of each column, in column order. */
  widths: number[];
  /** Left edge of each column, measured from the left edge of the grid. */
  lefts: number[];
  /** The columns with an authored width. */
  authored: boolean[];
  /** The grid's width: it ends with its last column when every column is authored. */
  gridW: number;
  /** The ids whose authored width did not fit the room. */
  capped: string[];
}

/**
 * Columns without a width share what the authored ones leave. A narrow width
 * stops at `hardFloor`. When the widths pass the room, each column keeps its
 * `keep` width (or less, if authored narrower) and the rest shrinks together,
 * so an authored width never makes the matrix wider than its plot.
 */
export function matrixTracks(ids: readonly string[], room: number, gap: number, widthOf: (id: string) => number | undefined, hardFloor: number, keepOf: (id: string) => number): MatrixTracks | undefined {
  const asked = ids.map(widthOf);
  if (asked.every((width) => width === undefined)) return undefined;
  const cells = Math.max(1, room - (ids.length - 1) * gap);
  const wanted = asked.map((width) => (width === undefined ? undefined : Math.max(hardFloor, width)));
  const keeps = ids.map((id, i) => (wanted[i] === undefined ? keepOf(id) : Math.min(wanted[i]!, keepOf(id))));
  const keepSum = keeps.reduce((sum, value) => sum + value, 0);
  // A chart too narrow for the columns' keep widths gives each column its share of those.
  const keepScale = keepSum > cells ? cells / keepSum : 1;
  const floors = keeps.map((keep) => keep * keepScale);
  const surplus = wanted.map((width, i) => (width === undefined ? 0 : Math.max(0, width - floors[i]!)));
  const surplusSum = surplus.reduce((sum, value) => sum + value, 0);
  const spare = Math.max(0, cells - floors.reduce((sum, value) => sum + value, 0));
  const scale = surplusSum > spare ? spare / surplusSum : 1;
  const set = wanted.map((width, i) => (width === undefined ? undefined : floors[i]! + surplus[i]! * scale));
  const setSum = set.reduce<number>((sum, width) => sum + (width ?? 0), 0);
  const free = set.filter((width) => width === undefined).length;
  const share = free > 0 ? (cells - setSum) / free : 0;
  const widths = set.map((width) => width ?? share);
  let at = 0;
  const lefts = widths.map((width) => { const left = at; at += width + gap; return left; });
  return {
    widths, lefts,
    authored: asked.map((width) => width !== undefined),
    gridW: free > 0 ? Math.max(room, at - gap) : at - gap,
    capped: scale < 1 ? ids.filter((_, i) => surplus[i]! > 0) : [],
  };
}

/** A wide authored width stops where the rest of the chart keeps its floor. */
export function widthCapped(type: string, id: string): LintWarning {
  return {
    code: 'column-width-capped', severity: 'warn', field: ['options', 'columnOverrides', id, 'width'],
    message: `columnOverrides.${id}.width is wider than this ${type} has room for, so the column stops where the other columns keep their minimum`,
    suggest: 'Set a smaller width, or draw the chart wider.',
  };
}

/** A setting this column or this form has no part for. */
export function overrideIgnored(id: string, key: string, reason: string): LintWarning {
  return {
    code: 'option-ignored', severity: 'warn', field: ['options', 'columnOverrides', id, key],
    message: `columnOverrides.${id}.${key} has no effect: ${reason}`,
    suggest: `Remove columnOverrides.${id}.${key}.`,
    fix: [{ op: 'remove', path: `/options/columnOverrides/${id}/${key}` }],
  };
}
