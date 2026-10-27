// boardplot/rows — SQL-shaped rows to a chart's data, without the chart engine.

/**
 * The same transform the CLI and MCP run for `rows` (src/core/rows.ts), for a
 * browser or Node caller. It reads no file and loads no chart, so a page can
 * group its rows in a server component or before the first chart chunk.
 */
import { adaptRows } from './core/rows';
import type { NamedColumnStateEntry } from './core/schema/namedColumns';

export { InputError } from './core/inputError';

/**
 * Which source column holds each role. Category charts name category, series
 * and value; choropleth and tilemap name category and value; waterfall names
 * label and value; scatter names x and y; sankey names source, target and value. A table may name label and id; its
 * spec's data.columns declares the columns, each input column reading the
 * source field named like its id. Histogram names value; box names category
 * (the group id) and value.
 */
export interface RowsColumns {
  category?: string;
  series?: string;
  value?: string;
  categoryLabel?: string;
  seriesLabel?: string;
  unit?: string;
  date?: string;
  /** A column of na, nm or suppressed; such a row leaves its value empty. */
  state?: string;
  label?: string;
  /** Waterfall item type, such as total. */
  type?: string;
  x?: string;
  y?: string;
  size?: string;
  group?: string;
  /** Sankey: the node a flow leaves and the node it enters. */
  source?: string;
  target?: string;
  /** Sankey: the stages of the two nodes, for flows between segments month to month. */
  sourceStage?: string;
  targetStage?: string;
  /** Table row id. Without it the rows are row-1, row-2, ... */
  id?: string;
  /** fraction when a share of one half arrives as 0.5, percent when it arrives as 50, number otherwise. */
  valueKind?: 'number' | 'percent' | 'fraction';
}

export interface SpecFromRowsInput {
  rows: readonly Record<string, unknown>[];
  columns: RowsColumns;
}

/** What the rows gave beside the data: the chart draws a suppressed cell as empty. */
export interface RowsReading {
  rows: number;
  /** Source columns that no role names. */
  ignoredColumns: string[];
  states: NamedColumnStateEntry[];
}

/**
 * The spec with its data built from the rows. A category or series the spec
 * already names keeps its other fields (label, colorRole, unit, format), so
 * the spec works as a template the rows refill. The spec is not changed.
 *
 * Throws {@link InputError} when the rows do not map, with the CLI's code,
 * message and `details.path` (for example `/rows/3/revenue`).
 */
export function specFromRows<S extends object>(spec: S, input: SpecFromRowsInput): { spec: S & { data: Record<string, unknown> }; reading: RowsReading } {
  const adapted = adaptRows(spec, input.columns, { argument: '/rows', load: () => ({ rows: input.rows }) });
  return {
    spec: adapted.spec as S & { data: Record<string, unknown> },
    reading: { rows: adapted.rows, ignoredColumns: adapted.ignoredColumns, states: adapted.states },
  };
}
