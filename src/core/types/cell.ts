/** Primitives, identity, cells, scenario, direction and colour roles. */

export type Id = string;
export type SlotId = string; // e.g. 'insideCenter', 'outsideEnd', 'lane:above:2'

export interface OwnerRef {
  seriesId?: Id;
  categoryId?: Id;
  segmentId?: Id;
  pointId?: Id;
  valueLineId?: Id;
  annotationId?: Id;
  // table cell identity — additive, charts never set them
  rowId?: Id;
  colId?: Id;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export type Scenario = 'AC' | 'PY' | 'PL' | 'FC';
// normalize() maps aliases ACT→AC, BUD→PL, FCST→FC.
// Fill semantics fixed: AC dark solid, PY light solid, PL outlined, FC 45° hatched.

export type Direction = 'higherIsBetter' | 'lowerIsBetter';
/** Comparison direction can withhold a favorable/unfavorable judgment. */
export type ComparisonDirection = Direction | 'neutral';

export type ColorRole =
  | 'good'
  | 'bad'
  | 'warn' // judgment between good and bad (at-risk)
  | 'neutral'
  | 'neutralLight'
  | 'highlight'
  | 'total'
  | 'others'
  | `series-${number}`
  | `status-${string}`;

/** The one typed value, shared verbatim between TS and CLI JSON. */
export type Cell = number | null | NumberCell | PctCell | DateCell;

/**
 * Per-item low/high band in the cell's own units (range family,
 * `src/core/range.ts`). Declared here rather than spliced in from there with
 * `declare module './types/cell'`, which is a trap: tsup emits the
 * declarations as flattened chunks, the relative specifier './types/cell'
 * points at a path that does not exist inside dist/, and whether the emitted
 * chunk is legal at all depends on whether rollup's dts splitter happens to
 * give it an `export {}` clause. Without one, the augmentation lands in a
 * chunk with no exports — a script, not a module — and every consumer with
 * `skipLibCheck: false` gets
 *   TS2436: Ambient module declaration cannot specify relative module name.
 * The package smoke compiles and exercises the installed archive.
 */
export interface DataRange {
  low: number;
  high: number;
  mid?: number;
}

export interface CellMeta {
  fill?: string;
  format?: string;
  label?: string | false;
  priority?: number;
  scenario?: Scenario;
  footnote?: number;
}
/**
 * Extra facts of one cell for its hover card and keyboard reading only;
 * `options.detailFields` labels and formats them. Read on bar, butterfly,
 * column, combo, dot, funnel, heatmap, line, mekko, pie and slope; the other
 * types refuse them.
 */
export type CellDetails = Record<string, number | string | null>;
export interface NumberCell extends CellMeta {
  number: number;
  details?: CellDetails;
}
export interface PctCell extends CellMeta {
  pct: number; // 50.5 means 50.5%
  details?: CellDetails;
}
export interface DateCell {
  date: string; // ISO 8601
}

// `range` is NOT on the shared CellMeta. `cellSchema` (schema/shared.ts) is a
// strictObject without it, so line/pie/funnel/… reject a range cell at runtime;
// only the range family's `rangeCellSchema` (src/core/range.ts) accepts one.
// Declaring it on the shared cell promised every chart type a shape most of them
// hard-reject. It is declared here, on the cell the range family actually uses.
export interface RangeNumberCell extends NumberCell {
  range?: DataRange;
}
export interface RangePctCell extends PctCell {
  range?: DataRange;
}
/** The cell type of the range family (bar, column, dot): a `Cell` that may carry a band. */
export type RangeCell = number | null | RangeNumberCell | RangePctCell | DateCell;

export function isNumberCell(c: Cell): c is NumberCell {
  return typeof c === 'object' && c !== null && 'number' in c;
}
export function isPctCell(c: Cell): c is PctCell {
  return typeof c === 'object' && c !== null && 'pct' in c;
}
export function isDateCell(c: Cell): c is DateCell {
  return typeof c === 'object' && c !== null && 'date' in c;
}

/** Numeric value of a cell (percent cells return their pct number). Null for missing/date. */
export function cellValue(c: Cell): number | null {
  if (c === null || c === undefined) return null;
  if (typeof c === 'number') return c;
  if (isNumberCell(c)) return c.number;
  if (isPctCell(c)) return c.pct;
  return null;
}

/** Cell metadata if present. */
export function cellMeta(c: Cell): CellMeta | null {
  if (typeof c === 'object' && c !== null && !isDateCell(c)) return c;
  return null;
}
