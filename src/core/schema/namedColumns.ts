/**
 * Named-column adapter — optional, chart-family targets only.
 *
 * A caller who receives a flat table names three columns and gets canonical
 * `categories` and `series` for the category chart family. The adapter never
 * guesses a column's meaning: every column it reads is named in the contract,
 * every mapping it cannot make exactly is refused with a code and a path, and
 * values it does not use are reported back.
 *
 * Canonical form comes from the existing shorthand ledger
 * (src/core/normalize/shared.ts): `normalizeCategory` and
 * `normalizeSeriesValues` build the cells, so the adapter adds no second
 * vocabulary for the same job.
 *
 * Suppression states reuse the frozen table contract's authored states
 * (src/core/types/table.ts): a chart cell cannot carry
 * a state, so a state stays in `states` beside the data instead of being folded
 * into a number or a null. A row that has both a value and a state is refused,
 * because the two would disagree once the chart drops the state.
 */
import { NormalizeError, normalizeCategory, normalizeCell, normalizeSeriesValues } from '../normalize/shared';
import type { Category, ChartData, Series } from '../types/data';

/** Authored states from the table contract; a chart cell carries none of them. */
export const NAMED_COLUMN_STATES = ['na', 'nm', 'suppressed'] as const;
export type NamedColumnState = (typeof NAMED_COLUMN_STATES)[number];

export interface NamedColumnContract {
  /** Column holding the category id. Required. */
  category: string;
  /** Column holding the series id. Required. */
  series: string;
  /** Column holding the cell value. Required. */
  value: string;
  /** Column holding a category label, which defaults to the id. */
  categoryLabel?: string;
  /** Column holding a series label, which defaults to the id. */
  seriesLabel?: string;
  /** Column holding the series unit; one unit per series. */
  unit?: string;
  /** Column holding the category date as authored text. */
  date?: string;
  /** Column holding an authored state, one of na, nm or suppressed. */
  state?: string;
}

interface NamedColumnsInput {
  contract: NamedColumnContract;
  rows: Record<string, unknown>[];
}

export interface NamedColumnStateEntry {
  categoryId: string;
  seriesId: string;
  state: NamedColumnState;
  /** Source row index, so a reader can find the authored cell. */
  row: number;
}

interface NamedColumnsResult {
  data: ChartData;
  /** Authored states in row order; empty when the contract has no state column. */
  states: NamedColumnStateEntry[];
  /** Row keys the contract does not name. Reported, never read. */
  ignoredColumns: string[];
}

/** Category and series fields the contract can fill; one field per key. */
interface AmbientFields {
  label?: string;
  unit?: string;
  date?: string;
}

interface Draft {
  categoryIds: string[];
  categories: Map<string, AmbientFields>;
  seriesIds: string[];
  seriesMeta: Map<string, AmbientFields>;
  cells: Map<string, unknown[]>;
  states: NamedColumnStateEntry[];
}

const REQUIRED_COLUMNS = ['category', 'series', 'value'] as const;
const OPTIONAL_COLUMNS = ['categoryLabel', 'seriesLabel', 'unit', 'date', 'state'] as const;

function refuse(code: string, path: string, message: string, suggest?: string): never {
  throw new NormalizeError(code, path, message, suggest);
}

function contractColumns(contract: NamedColumnContract): { required: string[]; optional: string[] } {
  const read = (key: keyof NamedColumnContract): string | undefined => {
    const value = contract[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !value.trim()) {
      refuse('invalid-contract', `contract.${key}`, 'column name must be a non-empty string');
    }
    return value;
  };
  const required = REQUIRED_COLUMNS.map((key) => read(key) as string);
  const optional = OPTIONAL_COLUMNS.map(read).filter((name): name is string => name !== undefined);
  // The category column may also be the date column: its ids are then the category dates.
  const roles = OPTIONAL_COLUMNS.filter((key) => key !== 'date' || contract.date !== contract.category);
  const names = [...required, ...roles.map((key) => contract[key]).filter((name): name is string => name !== undefined)];
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate !== undefined) {
    refuse('invalid-contract', 'contract', `column '${duplicate}' is named for more than one role; one column cannot fill two roles`);
  }
  return { required, optional };
}

function requireColumns(rows: Record<string, unknown>[], columns: string[]): void {
  const present = new Set(rows.flatMap((row) => Object.keys(row)));
  const missing = columns.filter((column) => !present.has(column));
  if (missing.length) {
    refuse(
      'missing-column', `contract.${missing[0] ?? ''}`,
      `${missing.map((column) => `'${column}'`).join(', ')} ${missing.length === 1 ? 'is' : 'are'} named in the contract but no row provides the column`,
      `columns present: ${[...present].sort().join(', ') || 'none'}`,
    );
  }
}

function readIdentity(row: Record<string, unknown>, column: string, rowIndex: number, role: string): string {
  const value = row[column];
  if (typeof value !== 'string' || !value) {
    refuse('invalid-identity', `rows[${rowIndex}].${column}`,
      `${role} id must be a non-empty string, received ${JSON.stringify(value ?? null)}`);
  }
  return value;
}

function readState(row: Record<string, unknown>, column: string, rowIndex: number): NamedColumnState | undefined {
  const value = row[column];
  if (value === undefined || value === null || value === '') return undefined;
  if (!(NAMED_COLUMN_STATES as readonly unknown[]).includes(value)) {
    refuse('invalid-state', `rows[${rowIndex}].${column}`,
      `unknown state ${JSON.stringify(value ?? null)}`,
      `one of ${NAMED_COLUMN_STATES.join(', ')}, the table cell states`);
  }
  return value as NamedColumnState;
}

/** A number as a person reads it: grouping marks, a percent or currency sign, a sign or parentheses. */
export const WRITTEN_NUMBER = /^[\s(+\-\u2212]*[$€£¥]?\s*\d[\d\s.,'\u2019]*[%$€£¥]?\s*\)?$/;

function readCell(row: Record<string, unknown>, column: string, rowIndex: number): unknown {
  const value = row[column];
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && WRITTEN_NUMBER.test(value)) {
    refuse('invalid-value', `rows[${rowIndex}].${column}`,
      `${JSON.stringify(value)} is a number written as text; a value cell takes a plain number`,
      'Write the number alone: no grouping marks, percent sign or currency sign, and a dot as the decimal mark.');
  }
  if (typeof value === 'string') {
    refuse('invalid-value', `rows[${rowIndex}].${column}`,
      `${JSON.stringify(value)} is text, which has no chart meaning here; missing is spelled null, and a suppression marker belongs in the state column`);
  }
  return normalizeCell(value, `rows[${rowIndex}].${column}`);
}

function noteField(
  target: Map<string, AmbientFields>, id: string, field: keyof AmbientFields,
  value: unknown, path: string,
): void {
  if (value === undefined || value === null || value === '') return;
  if (typeof value !== 'string') {
    refuse('ambiguous-mapping', path, `'${field}' must be a string, received ${JSON.stringify(value)}`);
  }
  const entry = target.get(id) ?? {};
  const previous = entry[field];
  if (previous !== undefined && previous !== value) {
    refuse('ambiguous-mapping', path,
      `'${field}' is '${previous}' for one row and '${value}' for another; one canonical ${field} per ${field === 'unit' ? 'series' : 'category'} is required`);
  }
  entry[field] = value;
  target.set(id, entry);
}

/** Register the category in first-appearance order and fill every open series slot. */
function addCategory(draft: Draft, id: string): number {
  const index = draft.categoryIds.indexOf(id);
  if (index >= 0) return index;
  draft.categoryIds.push(id);
  for (const values of draft.cells.values()) values.push(undefined);
  return draft.categoryIds.length - 1;
}

function addSeries(draft: Draft, id: string): void {
  if (draft.seriesIds.includes(id)) return;
  draft.seriesIds.push(id);
  draft.cells.set(id, draft.categoryIds.map(() => undefined));
}

function toCanonical(draft: Draft): ChartData {
  const categories: Category[] = draft.categoryIds.map((id, index) => {
    const meta = draft.categories.get(id) ?? {};
    return normalizeCategory({
      id,
      ...(meta.label !== undefined ? { label: meta.label } : {}),
      ...(meta.date !== undefined ? { date: meta.date } : {}),
    }, index);
  });
  const series: Series[] = draft.seriesIds.map((id, index) => {
    const meta = draft.seriesMeta.get(id) ?? {};
    const authored = {
      id,
      ...(meta.label !== undefined ? { label: meta.label } : {}),
      ...(meta.unit !== undefined ? { unit: meta.unit } : {}),
      values: draft.cells.get(id) ?? [],
    };
    const values = normalizeSeriesValues(
      authored as unknown as Series & { values: unknown }, categories, index,
    );
    return { ...authored, values };
  });
  return { categories, series };
}

/** Map named source columns into canonical categories and series. */
export function adaptNamedColumns(input: NamedColumnsInput): NamedColumnsResult {
  const { contract, rows } = input;
  if (!Array.isArray(rows) || rows.some((row) => typeof row !== 'object' || row === null || Array.isArray(row))) {
    refuse('invalid-rows', 'rows', 'rows must be an array of objects');
  }
  const { required, optional } = contractColumns(contract);
  if (!rows.length) {
    refuse('rows-empty', 'rows', 'there are no data rows, only a header or an empty list',
      'An empty query result has nothing to draw; check the row count before the call.');
  }
  requireColumns(rows, [...required, ...optional]);
  const categoryColumn = required[0] as string;
  const seriesColumn = required[1] as string;
  const valueColumn = required[2] as string;

  const draft: Draft = {
    categoryIds: [], categories: new Map(), seriesIds: [], seriesMeta: new Map(), cells: new Map(), states: [],
  };
  const seenPairs = new Map<string, number>();
  rows.forEach((row, rowIndex) => {
    const categoryId = readIdentity(row, categoryColumn, rowIndex, 'category');
    const seriesId = readIdentity(row, seriesColumn, rowIndex, 'series');
    const pair = `${categoryId}\u0000${seriesId}`;
    const first = seenPairs.get(pair);
    if (first !== undefined) {
      refuse('ambiguous-mapping', `rows[${rowIndex}].${seriesColumn}`,
        `category '${categoryId}' and series '${seriesId}' appear twice (rows ${first} and ${rowIndex}); one value per pair is required, and identical repeats are refused as well`);
    }
    seenPairs.set(pair, rowIndex);
    if (contract.state !== undefined) {
      const state = readState(row, contract.state, rowIndex);
      if (state !== undefined && row[valueColumn] !== null && row[valueColumn] !== undefined) {
        refuse('state-with-value', `rows[${rowIndex}].${contract.state}`,
          `state '${state}' together with a value; a chart cell carries no state, so the value would render as data while the state says otherwise`,
          'leave the value null for a suppressed cell, or drop the state column');
      }
      if (state !== undefined) draft.states.push({ categoryId, seriesId, state, row: rowIndex });
    }
    const index = addCategory(draft, categoryId);
    addSeries(draft, seriesId);
    noteField(draft.categories, categoryId, 'label', contract.categoryLabel ? row[contract.categoryLabel] : undefined,
      `rows[${rowIndex}].${contract.categoryLabel ?? 'categoryLabel'}`);
    noteField(draft.categories, categoryId, 'date', contract.date ? row[contract.date] : undefined,
      `rows[${rowIndex}].${contract.date ?? 'date'}`);
    noteField(draft.seriesMeta, seriesId, 'label', contract.seriesLabel ? row[contract.seriesLabel] : undefined,
      `rows[${rowIndex}].${contract.seriesLabel ?? 'seriesLabel'}`);
    noteField(draft.seriesMeta, seriesId, 'unit', contract.unit ? row[contract.unit] : undefined,
      `rows[${rowIndex}].${contract.unit ?? 'unit'}`);
    const values = draft.cells.get(seriesId) ?? [];
    values[index] = readCell(row, valueColumn, rowIndex);
    draft.cells.set(seriesId, values);
  });

  const named = new Set([...required, ...optional]);
  const ignoredColumns = [...new Set(rows.flatMap((row) => Object.keys(row)))]
    .filter((column) => !named.has(column)).sort();
  return { data: toCanonical(draft), states: draft.states, ignoredColumns };
}
