/**
 * Formats that fit their tracks (`options.fitFormats`).
 *
 * A table with authored tracks draws a steering table's months at 88 px,
 * 66 px or 56.6 px by grain. A format written for the widest grain ("$2.47M")
 * is cut at the narrower ones, and a grid track is a hard width. This pass
 * shortens the format until the widest figure of the row, or of the column,
 * fits: one decimal less at a time, then the next unit up at one decimal.
 * A change line printed inside a cell ("+12.34%") shares the cell's track
 * and is fitted through its own row's format the same way, and a cell that
 * names its own format ("+2.7pp" in a percent column) through that format.
 * It rewrites the authored formats and resolves again, so the claims, the
 * rounding records and the hoisted units follow the strings the table
 * prints. Only a track the width pass cannot widen can cut a figure, so only
 * an authored width asks for a shorter format.
 */

import { AUTOMATIC_FORMAT, effectiveScale, formatWithSpec, MAGNITUDE_GROUP, type MagnitudeGroupSource, MAGNITUDE_DIVISOR, MAGNITUDE_LABEL, parseFormatExample, specUnitKind, unitOfSpec, type AutomaticFormatSource, type NumberFormatSpec } from '../../formatSpec';
import type { FontSpec, TextMeasurer } from '../../text';
import type { Id } from '../../types/cell';
import type { LintWarning } from '../../types/scene';
import type { ResolvedCell, ResolvedColumn, ResolvedRow, ResolvedTable, TableCellObject, TableColumn, TableData, TableOptions, TableRow } from '../../types/table';
import { nonzeroDecimals, roundHalfUp, roundsToZero, zeroLifts } from '../../formatPrecision';
import { tableCellNodeId } from './cellKey';
import { figureFont } from './tracks';
import { columnOwnsFormat } from '../../tableCalc';
import { resolveTable, ZERO_LIFT, type ZeroLiftOptions } from './resolve';
import { maxOf, minOf } from '../../arrays';

interface FitFormatsContext {
  measure: TextMeasurer;
  /** The face a cell is drawn in, at its row's rung. */
  cellFont: (cell: ResolvedCell) => FontSpec;
  /** Horizontal air on each side of a cell. */
  padX: number;
  /** Extra a browser needs over the measured width. */
  slack?: (font: FontSpec, width: number) => number;
  /** Whether the surface draws this cell's string with tabular figures. */
  figures?: (column: ResolvedColumn, text: string) => boolean;
  /**
   * The face of a line a row prints inside its cells, a MoM or YoY change.
   * It shares the cell's track, so its figure has to fit as well; without
   * this the pass measures the rows' own figures only.
   */
  lineFont?: (parent: ResolvedRow, line: ResolvedRow, text: string, tabular?: boolean) => FontSpec;
  /** The decimal mark of a derived percent example, `options.locale.decimal`. */
  decimal?: '.' | ',';
}

type ResolveResult = ReturnType<typeof resolveTable>;

/**
 * One format `fitFormats` changed: a row's, a column's, or one cell's own, with the example before and after. The
 * layout reports the list as the `table-formats-fitted` info warning and React hands it to `onFormatsFit`.
 */
export interface FormatFitChange {
  row?: Id;
  column?: Id;
  /** The example the figure printed through before; absent where it was derived and had no authored one. */
  from?: string;
  to: string;
}

const NEXT_MAGNITUDE: Record<NumberFormatSpec['magnitude'], NumberFormatSpec['magnitude'] | undefined> = {
  none: 'k',
  k: 'm',
  m: 'bn',
  bn: 't',
  t: undefined,
};

/** Every figure keeps two significant digits through a fit (or all of its own, where it prints fewer). */
const FIT_DIGITS = 2;

/** The significant digits a figure prints at a magnitude and decimals: "0.1" one, "0.080" two, "13" two. */
function keptDigits(value: number, magnitude: NumberFormatSpec['magnitude'], decimals: number): number {
  return roundHalfUp(Math.abs(value) / MAGNITUDE_DIVISOR[magnitude], decimals).replace('.', '').replace(/^0+/, '').length;
}

/**
 * Whether every figure keeps two significant digits under `next` (all of its own where `spec`
 * prints fewer). A figure that would print as zero passes only under an automatic format, which
 * prints the bound ("<0.1"); an authored one lifts it to one digit ("0.00001"), so it fails.
 */
function keepsDigits(figures: readonly number[], spec: NumberFormatSpec, next: Pick<NumberFormatSpec, 'magnitude' | 'decimals'>): boolean {
  return figures.every((value) => {
    const kept = keptDigits(value, next.magnitude, next.decimals);
    return (kept === 0 && spec.automatic) || kept >= Math.min(FIT_DIGITS, keptDigits(value, spec.magnitude, spec.decimals));
  });
}

/** The fewest decimals from `from` up at which every figure keeps its digits in `magnitude`. */
function floorDecimals(figures: readonly number[], spec: NumberFormatSpec, magnitude: NumberFormatSpec['magnitude'], from = 0): number {
  let decimals = from;
  while (decimals < 6 && !keepsDigits(figures, spec, { magnitude, decimals })) decimals++;
  return decimals;
}

/**
 * The next shorter spec, or undefined where nothing shorter says the same.
 * A unit step needs the largest figure to stay at least 1 in the new unit:
 * "$342k" as "$0.3M" drops two of its three digits, and a smaller figure
 * would print "$0M". The largest figure also sets the unit: one that rounds
 * to 1000 in the new spec rolls on to the next unit by itself
 * (`effectiveScale`), and the row read "957.3k · 1.2M · 973.6k". The spec
 * takes the unit that figure prints in, so one row or one column reads in
 * one format.
 */
function shorterSpec(spec: NumberFormatSpec, figures?: readonly number[]): NumberFormatSpec | undefined {
  // No step drops a figure below two significant digits: "0.1" for 80,000 under (M) reads as
  // 100,000. Where nothing shorter keeps them, the format stays and the clip warning says so.
  const maxAbs = figures === undefined ? Infinity : Math.max(0, maxOf(figures));
  figures ??= [];
  if (spec.decimals > 0) {
    // A bare '1.234' reads as grouping, so four decimals go straight to two.
    const decimals = spec.decimals === 4 && spec.thousandsSep === '' ? 2 : spec.decimals - 1;
    // The largest figure rolls by the same rule as before ("999.6k" at no decimals is "1.0M"), so the
    // row or column takes the unit it prints in and reads in one magnitude.
    const plain = { ...spec, decimals };
    const next = plain.magnitude === 'none' || maxAbs === Infinity ? plain : { ...plain, ...effectiveScale(maxAbs, plain) };
    return keepsDigits(figures, spec, next) ? next : undefined;
  }
  if (specUnitKind(spec) !== 'number') return undefined;
  // A magnitude joins a currency or a bare figure; on a unit word it makes another unit:
  // '1,234 m²' in k reads "1.2 km²", '1,234 EURk' reads "1.2 kEURk".
  if (!/^(?:|\p{Sc}|[A-Z]{3})$/u.test(spec.suffix.trim())) return undefined;
  const magnitude = NEXT_MAGNITUDE[spec.magnitude];
  if (magnitude === undefined || maxAbs / MAGNITUDE_DIVISOR[magnitude] < 1) return undefined;
  const next: NumberFormatSpec = { ...spec, magnitude, decimals: 1, rollMagnitude: undefined };
  if (maxAbs === Infinity) return next;
  // The unit and decimals the largest figure prints in, by the very rule that rolls it,
  // with the decimals that keep the smallest figure's digits.
  const rolled = { ...next, ...effectiveScale(maxAbs, next) };
  rolled.decimals = floorDecimals(figures, spec, rolled.magnitude, rolled.decimals);
  const widest = (candidate: NumberFormatSpec) => maxOf(figures.map((value) => formatWithSpec(value, candidate).length));
  // Where the largest figure rolls on ("1.235M"), the unit it stepped to may print it in four
  // grouped digits ("1,235k") no wider and keep the small figures whole: the smaller unit wins a tie.
  const held: NumberFormatSpec = { ...next, decimals: floorDecimals(figures, spec, magnitude), thousandsSep: spec.thousandsSep || ',', rollMagnitude: false };
  const step = rolled.magnitude === magnitude || widest(held) > widest(rolled) ? rolled : held;
  // A unit step that keeps the digits but is no narrower ("1,235k" to "1.235M") is no fit.
  return widest(step) >= widest(spec) ? undefined : step;
}

/** A format-by-example that parses back to `spec`. */
function exampleOf(spec: NumberFormatSpec): string {
  const whole = spec.thousandsSep === '' ? '1' : `1${spec.thousandsSep}234`;
  const fraction = spec.decimals > 0 ? `${spec.decimalSep}${'2345678'.slice(0, spec.decimals)}` : '';
  const body = `${spec.signed ? '+' : ''}${spec.prefix}${whole}${fraction}${MAGNITUDE_LABEL[spec.magnitude]}${spec.suffix}`;
  return spec.negative === 'parens' ? `(${body})` : body;
}

function withRowFormats(rows: readonly TableRow[], formats: ReadonlyMap<Id, { format: string; unitAffix?: string }>): TableRow[] {
  return rows.map((row) => {
    const next = formats.get(row.id);
    const children = row.children === undefined ? undefined : withRowFormats(row.children, formats);
    if (next === undefined && children === row.children) return row;
    return {
      ...row,
      ...(next === undefined ? {} : { format: next.format }),
      ...(next?.unitAffix === undefined ? {} : { unitAffix: next.unitAffix }),
      ...(children === undefined ? {} : { children }),
    };
  });
}

/** The rows with the cells that name their own format rewritten, keyed row id, then column id. */
function withCellFormats(rows: readonly TableRow[], formats: ReadonlyMap<Id, ReadonlyMap<Id, string>>): TableRow[] {
  return rows.map((row) => {
    const next = formats.get(row.id);
    const children = row.children === undefined ? undefined : withCellFormats(row.children, formats);
    if (next === undefined && children === undefined) return row;
    const cells = next === undefined ? row.cells : { ...row.cells };
    for (const [columnId, format] of next ?? []) {
      const cell = row.cells![columnId];
      cells![columnId] = typeof cell === 'number' ? { v: cell, format } : { ...(cell as TableCellObject), format };
    }
    return { ...row, ...(cells === undefined ? {} : { cells }), ...(children === undefined ? {} : { children }) };
  });
}

/**
 * The example a row prints its cells through: its own format, or, on a calc
 * that yields points (a share, a percent change), the percent resolve derives.
 */
function rowExample(row: TableRow | undefined, decimal: '.' | ','): string | undefined {
  if (row === undefined) return undefined;
  if (row.format !== undefined) return row.format;
  const calc = row.calc;
  return calc !== undefined && 'op' in calc && (calc.op === 'share' || calc.op === 'percentDelta') ? `1${decimal}2%` : undefined;
}

function authoredRows(rows: readonly TableRow[], into = new Map<Id, TableRow>()): Map<Id, TableRow> {
  for (const row of rows) {
    into.set(row.id, row);
    if (row.children) authoredRows(row.children, into);
  }
  return into;
}

/**
 * The data with every overflowing format shortened, and its resolve; both
 * undefined where nothing overflows. `columns` are the columns the surface
 * draws; a hidden column cuts nothing.
 */
export function fitTableFormats(
  data: TableData,
  options: TableOptions,
  resolved: { table: ResolvedTable },
  columns: (table: ResolvedTable) => readonly ResolvedColumn[],
  ctx: FitFormatsContext,
): { data: TableData; resolved: ResolveResult; changes: FormatFitChange[] } | undefined {
  let current = data;
  // The pass measures the rounded text; the nonzero lift prints after it, so a
  // lifted "0.0005" never shortens the figures beside it.
  const unlifted: TableOptions = { ...options, [ZERO_LIFT]: 'none' } as TableOptions & ZeroLiftOptions;
  let result: { table: ResolvedTable } = (resolved as ResolveResult).lifted ? resolveTable(data, unlifted) : resolved;
  let fitted: ResolveResult | undefined;
  const exhausted = new Set<string>();
  const decimal = ctx.decimal ?? '.';
  /** The rows and columns whose format this pass wrote: the engine's precision now, not the author's. */
  const fittedRows = new Set<Id>();
  const fittedColumns = new Set<Id>();
  /** Cells whose own format this pass shortened, keyed `row\0column`. */
  const fittedCells = new Set<string>();
  // Each round shortens every overflowing format one step, so the rounds are
  // bounded by the steps a format has: three decimals and three units.
  for (let round = 0; round < 8; round++) {
    const table = result.table;
    const resolvedById = new Map(table.rows.map((row) => [row.id, row]));
    const rowsById = authoredRows(current.rows);
    const authoredColumns = new Map(current.columns.map((column) => [column.id, column]));
    const rowOverflow = new Set<Id>();
    /** Rows that print a fitted track through their own format, overflowing or not. */
    const rowPrinting = new Set<Id>();
    const columnOverflow = new Set<Id>();
    /** Cells that print through their own format and overflow, with the figure that caps the unit step. */
    const cellOverflow: { rowId: Id; columnId: Id; format: string; max: number }[] = [];
    /** The nonzero figures a row or a column draws: the largest caps its unit step, and each keeps its digits. */
    const rowFigures = new Map<Id, number[]>();
    const columnFigures = new Map<Id, number[]>();
    const figure = (map: Map<Id, number[]>, id: Id, value: number) => {
      if (value !== 0) map.set(id, [...(map.get(id) ?? []), Math.abs(value)]);
    };
    for (const column of columns(table)) {
      if (column.width === undefined || (column.kind !== 'value' && column.kind !== 'computed')) continue;
      const room = column.width - 2 * ctx.padX;
      const authoredColumn = authoredColumns.get(column.id);
      for (const row of table.rows) {
        if (row.role === 'section') continue;
        // A line printed inside its parent's cell shares the parent's track
        // and is measured in the line face; a surface that names no line
        // face leaves the lines out.
        const parent = row.inline === true && row.parentId !== undefined ? resolvedById.get(row.parentId) : undefined;
        if (row.inline === true && (parent === undefined || ctx.lineFont === undefined)) continue;
        const cell = row.cells[column.id];
        if (cell === undefined || cell.state !== 'value' || typeof cell.raw !== 'number') continue;
        const tabular = ctx.figures?.(column, cell.displayed);
        const font = parent !== undefined ? ctx.lineFont!(parent, row, cell.displayed, tabular) : ctx.cellFont(cell);
        const measured = ctx.measure(cell.displayed, figureFont(font, tabular)).width;
        const overflows = measured + (ctx.slack?.(font, measured) ?? 0) > room;
        // A cell with its own format prints through it alone: only that
        // format can shorten, and its figure caps no row or column.
        if (cell.format !== undefined) {
          if (overflows) cellOverflow.push({ rowId: row.id, columnId: column.id, format: cell.format, max: Math.abs(cell.raw) });
          continue;
        }
        figure(rowFigures, row.id, cell.raw);
        figure(columnFigures, column.id, cell.raw);
        // The spec the cell printed through: the row's own where it authored
        // one and the column did not (a calc row always), else the column's.
        const authoredRow = rowsById.get(row.id);
        const rowFormatted = rowExample(authoredRow, decimal) !== undefined
          && (authoredRow!.calc !== undefined
            || authoredRow!.inline === true
            || authoredColumn === undefined || !columnOwnsFormat(authoredColumn));
        // A money row of a measure group takes its magnitude and precision from resolve, so a fitted
        // format would change nothing in it and only cap the other rows of its unit.
        const fits = authoredRow?.fitFormat !== false
          && !(authoredRow?.scale === 'money' && (authoredRow as MagnitudeGroupSource)[MAGNITUDE_GROUP] !== undefined);
        if (rowFormatted && fits) rowPrinting.add(row.id);
        if (!overflows) continue;
        // `fitFormat: false` on a row or a column keeps its authored format, cut or not.
        if (rowFormatted ? fits : (authoredColumn as { fitFormat?: false } | undefined)?.fitFormat !== false) (rowFormatted ? rowOverflow.add(row.id) : columnOverflow.add(column.id));
      }
    }
    /** Whether a data row with its own format prints a number in this unformatted column. */
    const rowFormattedColumn = (columnId: Id): boolean => {
      const authoredColumn = authoredColumns.get(columnId);
      if (authoredColumn !== undefined && columnOwnsFormat(authoredColumn)) return false;
      return table.rows.some((row) => {
        const authored = rowsById.get(row.id);
        return authored?.format !== undefined && authored.calc === undefined && row.inline !== true
          && typeof row.cells[columnId]?.raw === 'number';
      });
    };
    const rowFormats = new Map<Id, { format: string; unitAffix?: string }>();
    for (const rowId of rowOverflow) {
      if (exhausted.has(`row:${rowId}`)) continue;
      const row = rowsById.get(rowId)!;
      const spec = parseFormatExample(rowExample(row, decimal)!);
      // A row with no format of its own prints a fitted zero as the bound.
      const automatic = row.format === undefined || (row as TableRow & AutomaticFormatSource)[AUTOMATIC_FORMAT] === true;
      const next = shorterSpec({ ...spec, automatic }, rowFigures.get(rowId) ?? []);
      if (next === undefined) { exhausted.add(`row:${rowId}`); continue; }
      const before = unitOfSpec(spec);
      const after = unitOfSpec(next);
      rowFormats.set(rowId, {
        format: exampleOf(next),
        // The label names the unit the cells now read in.
        ...(row.unitAffix !== undefined && before !== null && after !== null && row.unitAffix === before && before !== after
          ? { unitAffix: after } : {}),
      });
    }
    // One format per unit: automatic units pick one format per column
    // set. A revenue row that drops a decimal to fit its
    // week track takes its sub-rows in the same money unit with it, so
    // "$2.51M" does not stand under a "$2.5M" headline; a count or a percent
    // is another unit and keeps its own. The unit is the label affix, the
    // prefix, the suffix and the kind of number; a line keeps to the lines.
    // A row's label affix names its unit too: two rate rows in a bare
    // '1.23', one "$ per order" and one "%", are two units.
    const unitOf = (row: ResolvedRow, spec: NumberFormatSpec): string =>
      `${row.inline === true ? 'line' : 'row'}|${row.unitAffix ?? ''}|${spec.prefix.trim()}|${spec.suffix.trim()}|${specUnitKind(spec)}|${spec.magnitude}`;
    const caps = new Map<string, number>();
    for (const [rowId, next] of rowFormats) {
      const row = resolvedById.get(rowId);
      if (row === undefined) continue;
      const spec = parseFormatExample(next.format);
      const key = unitOf(row, spec);
      caps.set(key, Math.min(caps.get(key) ?? Infinity, spec.decimals));
    }
    // The cap reaches the rows shortened this round too: two rows of a unit
    // that both overflow from different precisions ('$1.23M' and '$1.2M')
    // end on the same decimals, not one step apart.
    for (const rowId of rowPrinting) {
      if (exhausted.has(`row:${rowId}`)) continue;
      const row = resolvedById.get(rowId);
      const shortened = rowFormats.get(rowId);
      const example = shortened?.format ?? rowExample(rowsById.get(rowId), decimal);
      if (row === undefined || example === undefined) continue;
      const spec = parseFormatExample(example);
      const cap = caps.get(unitOf(row, spec));
      // Three bare decimals read as a thousands group ('1.234'), so a cap of
      // three is left alone, as `shorterSpec` never writes one.
      if (cap === undefined || spec.decimals <= cap || (cap === 3 && spec.thousandsSep === '')) continue;
      // The shared precision stops where this row's smallest figure would lose its two digits.
      const decimals = floorDecimals(rowFigures.get(rowId) ?? [], spec, spec.magnitude, cap);
      if (decimals >= spec.decimals) continue;
      rowFormats.set(rowId, { ...shortened, format: exampleOf({ ...spec, decimals }) });
    }
    const columnFormats = new Map<Id, string>();
    for (const columnId of columnOverflow) {
      if (exhausted.has(`col:${columnId}`)) continue;
      // A column format outranks every data row's own format (resolve's
      // `specFor`). Written into a column whose rows read in their own
      // units, $M beside a count beside a percent, it would print them all
      // in one, so such a column keeps its derived format.
      if (rowFormattedColumn(columnId)) { exhausted.add(`col:${columnId}`); continue; }
      const authoredExample = (authoredColumns.get(columnId) as (TableColumn & AutomaticFormatSource & { format?: string }) | undefined);
      const example = authoredExample?.format ?? table.columns.find((column) => column.id === columnId)?.format;
      // A chart-level `options.format` is authored too: it prints a fitted zero by lifting it, not as the bound.
      const automatic = options.format === undefined && (authoredExample?.format === undefined || authoredExample[AUTOMATIC_FORMAT] === true);
      const next = example === undefined ? undefined : shorterSpec({ ...parseFormatExample(example), automatic }, columnFigures.get(columnId) ?? []);
      if (next === undefined) { exhausted.add(`col:${columnId}`); continue; }
      columnFormats.set(columnId, exampleOf(next));
    }
    const cellFormats = new Map<Id, Map<Id, string>>();
    for (const { rowId, columnId, format, max } of cellOverflow) {
      const key = tableCellNodeId('cell', rowId, columnId);
      if (exhausted.has(key)) continue;
      const next = shorterSpec(parseFormatExample(format), [max]);
      if (next === undefined) { exhausted.add(key); continue; }
      cellFormats.set(rowId, (cellFormats.get(rowId) ?? new Map<Id, string>()).set(columnId, exampleOf(next)));
    }
    if (rowFormats.size === 0 && columnFormats.size === 0 && cellFormats.size === 0) break;
    for (const rowId of rowFormats.keys()) fittedRows.add(rowId);
    for (const columnId of columnFormats.keys()) fittedColumns.add(columnId);
    for (const [rowId, formats] of cellFormats) for (const columnId of formats.keys()) fittedCells.add(`${rowId}\0${columnId}`);
    const rows = rowFormats.size === 0 ? current.rows : withRowFormats(current.rows, rowFormats);
    current = {
      ...current,
      columns: current.columns.map((column) => (columnFormats.has(column.id)
        ? { ...column, format: columnFormats.get(column.id)! } as TableColumn
        : column)),
      rows: cellFormats.size === 0 ? rows : withCellFormats(rows, cellFormats),
    };
    fitted = resolveTable(current, unlifted, data);
    result = fitted;
  }
  if (fitted === undefined) return undefined;
  // One precision per family in a column: a bold statement row that needed a decimal less drags the plain rows of its
  // format family down with it, so a column never prints "−16k" over "12.4k". The family is the unit key of the loop above.
  {
    const table = result.table;
    const resolvedById = new Map(table.rows.map((row) => [row.id, row]));
    const rowsById = authoredRows(current.rows);
    const familyKey = (row: ResolvedRow, spec: NumberFormatSpec): string =>
      `${row.inline === true ? 'line' : 'row'}|${row.unitAffix ?? ''}|${spec.prefix.trim()}|${spec.suffix.trim()}|${specUnitKind(spec)}|${spec.magnitude}`;
    const families = new Map<string, { id: Id; spec: NumberFormatSpec }[]>();
    for (const [id, authored] of rowsById) {
      const row = resolvedById.get(id);
      const example = rowExample(authored, decimal);
      if (row === undefined || example === undefined || authored.calc !== undefined || authored.fitFormat === false) continue;
      const spec = parseFormatExample(example);
      const key = familyKey(row, spec);
      families.set(key, [...(families.get(key) ?? []), { id, spec }]);
    }
    const unified = new Map<Id, { format: string }>();
    for (const members of families.values()) {
      if (!members.some((member) => fittedRows.has(member.id))) continue;
      const least = minOf(members.map((member) => member.spec.decimals));
      // Three bare decimals read as a thousands group, so a cap of three is left alone.
      for (const member of members) {
        if (member.spec.decimals <= least || (least === 3 && member.spec.thousandsSep === '')) continue;
        // A member whose smallest figure would lose its two digits keeps the decimals that hold them.
        const figures = Object.values(resolvedById.get(member.id)!.cells).flatMap((cell) => cell?.state === 'value' && typeof cell.raw === 'number' && cell.raw !== 0 && cell.format === undefined ? [Math.abs(cell.raw)] : []);
        const decimals = floorDecimals(figures, member.spec, member.spec.magnitude, least);
        if (decimals < member.spec.decimals) unified.set(member.id, { format: exampleOf({ ...member.spec, decimals }) });
      }
    }
    if (unified.size > 0) {
      for (const id of unified.keys()) fittedRows.add(id);
      current = { ...current, rows: withRowFormats(current.rows, unified) };
      fitted = resolveTable(current, unlifted, data);
    }
  }
  // Resolve protects number row formats at their actual scale. Fitted column
  // formats and fitted percent or pp row formats need per-cell lifts here.
  const lifts = zeroFigureFormats(current, fitted.table, fittedRows, fittedColumns, fittedCells, decimal, options, data);
  if (lifts.size > 0) current = { ...current, rows: withCellFormats(current.rows, lifts) };
  if (lifts.size > 0 || (options as ZeroLiftOptions)[ZERO_LIFT] !== 'none') fitted = resolveTable(current, options, data);
  return { data: current, resolved: fitted, changes: formatChanges(data, current, decimal) };
}

/** The `table-formats-fitted` info warning for the changes of one fit, or undefined where nothing changed. */
export function formatsFittedWarning(changes: readonly FormatFitChange[]): LintWarning | undefined {
  if (changes.length === 0) return undefined;
  const name = (change: FormatFitChange) => change.row !== undefined && change.column !== undefined ? `cell '${change.row}/${change.column}'`
    : change.row !== undefined ? `row '${change.row}'` : `column '${change.column}'`;
  const listed = changes.slice(0, 6).map((change) => `${name(change)} ${change.from ?? 'derived'} to ${change.to}`).join('; ');
  return {
    code: 'table-formats-fitted',
    severity: 'info',
    message: `fitFormats shortened ${changes.length} format${changes.length === 1 ? '' : 's'} to fit authored widths: ${listed}${changes.length > 6 ? `; and ${changes.length - 6} more` : ''}`,
    detail: { changes },
    suggest: "Widen the column, or set fitFormat: false on the row or column to keep its format as authored.",
  };
}

/** What the pass changed, in authored order: rows, then columns, then cells. */
function formatChanges(before: TableData, after: TableData, decimal: '.' | ','): FormatFitChange[] {
  const changes: FormatFitChange[] = [];
  const rowsBefore = authoredRows(before.rows);
  const rowsAfter = authoredRows(after.rows);
  for (const [id, row] of rowsAfter) {
    const from = rowExample(rowsBefore.get(id), decimal);
    const to = rowExample(row, decimal);
    if (from !== to && to !== undefined) changes.push({ row: id, ...(from === undefined ? {} : { from }), to });
  }
  const columnsBefore = new Map(before.columns.map((column) => [column.id, column]));
  for (const column of after.columns) {
    const from = (columnsBefore.get(column.id) as { format?: string } | undefined)?.format;
    const to = (column as { format?: string }).format;
    if (from !== to && to !== undefined) changes.push({ column: column.id, ...(from === undefined ? {} : { from }), to });
  }
  for (const [id, row] of rowsAfter) {
    for (const [columnId, cell] of Object.entries(row.cells ?? {})) {
      const to = typeof cell === 'object' && cell !== null ? cell.format : undefined;
      const earlier = rowsBefore.get(id)?.cells?.[columnId];
      const from = typeof earlier === 'object' && earlier !== null ? earlier.format : undefined;
      if (to !== undefined && from !== to) changes.push({ row: id, column: columnId, ...(from === undefined ? {} : { from }), to });
    }
  }
  return changes;
}

/**
 * The own formats of the authored figures a fitted column format
 * prints as zero, keyed row id, then column id: the fitted format with the
 * decimals that show the figure.
 *
 * shortcut: authored value cells only; a calc row or a computed column has no
 * authored cell to carry a format and keeps the fitted precision.
 */
function zeroFigureFormats(
  data: TableData,
  table: ResolvedTable,
  fittedRows: ReadonlySet<Id>,
  fittedColumns: ReadonlySet<Id>,
  fittedCells: ReadonlySet<string>,
  decimal: '.' | ',',
  options: TableOptions,
  source: TableData,
): Map<Id, Map<Id, string>> {
  const lifts = new Map<Id, Map<Id, string>>();
  if (fittedRows.size === 0 && fittedColumns.size === 0 && fittedCells.size === 0) return lifts;
  const rowsById = authoredRows(data.rows);
  const sourceRows = authoredRows(source.rows);
  // An automatic format prints a figure below its last digit as its bound ("<0.1"), not through a lifted cell format.
  const automatic = options.format === undefined && options.unit === undefined && options.magnitude !== 'million' && options.magnitude !== 'thousand';
  for (const column of data.columns) {
    if (column.kind !== 'value') continue;
    const columnFormat = (column as { format?: string }).format;
    const automaticColumn = automatic && (source.columns.find((entry) => entry.id === column.id) as { format?: string } | undefined)?.format === undefined;
    for (const row of table.rows) {
      const authoredRow = rowsById.get(row.id);
      const authored = authoredRow?.cells?.[column.id];
      // A cell whose own format the pass shortened is lifted through that format.
      const ownFitted = typeof authored === 'object' && authored !== null && authored.format !== undefined && fittedCells.has(`${row.id}\0${column.id}`) ? authored.format : undefined;
      const raw = typeof authored === 'number' ? authored
        : typeof authored === 'object' && authored !== null && typeof authored.v === 'number' && (authored.format === undefined || ownFitted !== undefined) ? authored.v : undefined;
      if (raw === undefined || raw === 0 || authoredRow!.calc !== undefined) continue;
      // The spec the figure prints through, as the fitting pass reads it.
      const rowFormat = rowExample(authoredRow, decimal);
      // A change line prints through its own row format, as the fitting pass reads it.
      const line = row.inline === true;
      const rowFormatted = rowFormat !== undefined && (columnFormat === undefined || line);
      // A number row is protected by resolve; a fitted change line, percent or pp row is lifted here.
      const example = ownFitted ?? (rowFormatted ? (fittedRows.has(row.id) && (line || specUnitKind(parseFormatExample(rowFormat!)) !== 'number') ? rowFormat : undefined)
        : fittedColumns.has(column.id) ? columnFormat ?? table.columns.find((entry) => entry.id === column.id)?.format : undefined);
      if (example === undefined) continue;
      const sourceRow = sourceRows.get(row.id) as (TableRow & AutomaticFormatSource) | undefined;
      if (ownFitted === undefined && (rowFormatted ? automatic && (sourceRow?.format === undefined || sourceRow[AUTOMATIC_FORMAT] === true) : automaticColumn)) continue;
      const spec = parseFormatExample(example);
      const scaled = raw / MAGNITUDE_DIVISOR[spec.magnitude];
      if (!roundsToZero(scaled, spec.decimals)) continue;
      // A change line or a fitted cell format is lifted only where the layout found the width for it (layoutTable).
      if (ownFitted !== undefined || row.inline === true) {
        if ((options as ZeroLiftOptions)[ZERO_LIFT] !== undefined) continue;
        zeroLifts.count++;
      }
      lifts.set(row.id, (lifts.get(row.id) ?? new Map<Id, string>()).set(column.id, exampleOf({ ...spec, decimals: nonzeroDecimals(scaled, spec.decimals) })));
    }
  }
  return lifts;
}
