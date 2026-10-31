/** Pixel-free table view-state helpers shared by every renderer. */

import { isNumberAlone, numericVariant } from '../../textRole';
import type { Theme } from '../../types/theme';
import type { Id } from '../../types/cell';
import type { ColumnKind, ResolvedCell, ResolvedColumn, ResolvedRow, ResolvedTable, TableOptions } from '../../types/table';
import { PARTIAL_FOOTNOTE, SUPPRESSED_FOOTNOTE } from './resolve';
import { ranksAsData } from './rank';
import { disclosureNote } from '../../notes';
import { heatRanges, statusDirectionNote } from './encodings/heat';

/** Column kinds whose cells hold numbers. */
const NUMERIC_COLUMNS: ReadonlySet<ColumnKind> = new Set<ColumnKind>(['value', 'computed', 'date', 'encoding']);

/**
 * Whether a cell's figures are numbers a reader compares down the column,
 * which is what `theme.type.numeric` governs. It takes both the
 * column kind and the drawn string: a row label, a readout or a status badge
 * is prose, and so is a date column's "12 May 2026", which names a period
 * rather than measuring one. Both renderers ask this, so the same
 * cell reads the same whether it is drawn as SVG text or as a table cell.
 */
export function cellHoldsNumber(kind: ColumnKind, displayed: string): boolean {
  if (!NUMERIC_COLUMNS.has(kind)) return false;
  // A table asks this of each cell string several times (format fit, tracks, cells); kept, bounded.
  let alone = numberAlone.get(displayed);
  if (alone === undefined) {
    if (numberAlone.size >= 1 << 15) numberAlone.clear();
    numberAlone.set(displayed, alone = isNumberAlone(displayed));
  }
  return alone;
}
const numberAlone = new Map<string, boolean>();

/** The same question for a resolved cell. */
export function numericCell(cell: Pick<ResolvedCell, 'kind' | 'displayed'>): boolean {
  return cellHoldsNumber(cell.kind, cell.displayed);
}

/**
 * Whether a surface draws this string with tabular figures: a
 * number in a column that holds numbers, on a theme whose figures are
 * tabular. `theme.type.numeric: 'proportional'` draws every digit at its own
 * advance, and a name or a readout never takes figures.
 */
export function cellDrawsTabular(theme: Theme, kind: ColumnKind, displayed: string): boolean {
  return numericVariant('value', theme) === 'tabular-nums' && cellHoldsNumber(kind, displayed);
}

/**
 * The footnotes a surface prints: the table's own, plus the explanation of the
 * suppressed marker — and that one ONLY when a cell the surface actually emits
 * carries the marker.
 *
 * Visibility is not knowable in `resolveTable`: it resolves every row and
 * column, including rows a surface collapses and columns a toggle group hides.
 * A footnote raised there points at an asterisk the reader cannot find, which
 * is the same defect class as the marker-less glyph it was added to fix, only
 * inverted. Each surface passes the rows and columns it emits: SVG the visible
 * ones (static output, collapsed rows are simply absent), HTML/React the ones
 * in the document (the reader can toggle them back into view).
 */
export function tableFootnotes(
  table: ResolvedTable,
  rows: readonly ResolvedRow[],
  columns: readonly ResolvedColumn[],
): string[] {
  const emitted = new Set(columns.map((column) => column.id));
  const marked = rows.some((row) =>
    Object.values(row.cells).some(
      (cell) => cell.state === 'suppressed' && emitted.has(cell.colId),
    ),
  );
  // The partial-aggregate note names a column that skipped a null; hidden with
  // its column group it would point at nothing on screen.
  const partialShown = table.partialColumnIds === undefined || table.partialColumnIds.some((id) => emitted.has(id));
  // The mixed-direction status note names lanes; restated for the drawn
  // columns, it names no lane a toggle hides and drops where one direction
  // is left.
  const statusNote = statusDirectionNote(table.columns, heatRanges(table.columns, table.rows), table.colorblindSafe);
  const shownStatusNote = statusNote === undefined ? undefined : statusDirectionNote(columns, heatRanges(columns, rows), table.colorblindSafe);
  const footnotes = table.footnotes.flatMap((note) =>
    note === PARTIAL_FOOTNOTE && !partialShown ? []
      : note === statusNote ? (shownStatusNote === undefined ? [] : [shownStatusNote])
        : [note]);
  // Each auto note keys a glyph, a colour or a grouping on the table (disclosure).
  return (marked ? [...footnotes, SUPPRESSED_FOOTNOTE] : footnotes).map(disclosureNote);
}

/**
 * How many children a parent folds away, counted over the TREE children,
 * which is the same set that decides `hasChildren`. An inline line is drawn
 * inside its parent's cells and never under it, so a KPI with two sub-KPIs
 * and a MoM and a YoY line hides two rows, not four, and its collapsed hint
 * says so.
 */
export function treeChildCounts(table: ResolvedTable): Map<Id, number> {
  const counts = new Map<Id, number>();
  for (const row of table.rows) {
    if (row.parentId === undefined || row.inline === true) continue;
    counts.set(row.parentId, (counts.get(row.parentId) ?? 0) + 1);
  }
  return counts;
}

export function collapsedByDefault(table: ResolvedTable): Set<Id> {
  return new Set(
    table.rows
      .filter((row) => row.hasChildren && row.defaultExpanded === false)
      .map((row) => row.id),
  );
}

/**
 * The rows a depth control collapses: every parent whose children sit at or
 * below `depth`. Depth 1 shows the level-0 rows alone, depth 2 opens their
 * children, and a depth past the deepest level collapses nothing. Pixel-free,
 * so the SVG expansion option and the React depth buttons agree.
 */
export function collapsedForDepth(table: ResolvedTable, depth: number): Id[] {
  return table.rows
    .filter((row) => row.inline !== true && row.hasChildren && row.foldable !== false && row.step >= depth - 1)
    .map((row) => row.id);
}

/**
 * Both halves of a depth control's view state. A control that only
 * names collapsed parents cannot say "totals only": collapsing every level-0
 * parent still draws that parent's own row. Depth 0 therefore also hides the
 * level-0 DATA rows, and the totals and the section headings stay — the
 * management report's first step, the Total alone. Depth 1 and above keep
 * every root drawn, exactly as `collapsedForDepth` already said.
 */
export function depthToExpansion(
  table: ResolvedTable,
  depth: number,
): { collapsed: Id[]; rootsHidden: boolean } {
  return {
    collapsed: collapsedForDepth(table, Math.max(1, depth)),
    rootsHidden: depth <= 0,
  };
}

/**
 * The reader's folds as an `options.expansion`: the authored expansion with
 * its `collapsed` and `expanded` lists rewritten so that, resolved again, it
 * draws `folds`. A row the reader left as authored keeps its authored entry,
 * so folding a row and opening it again gives the authored lists back and a
 * host can tell its own depth step from a view the reader changed.
 */
export function expansionForFolds(
  table: ResolvedTable,
  authored: TableOptions['expansion'],
  folds: ReadonlySet<Id>,
): NonNullable<TableOptions['expansion']> {
  const base = collapsedByDefault(table);
  const collapsed = new Set(authored?.collapsed ?? []);
  const expanded = new Set(authored?.expanded ?? []);
  for (const row of table.rows) {
    if (!row.hasChildren || row.foldable === false || folds.has(row.id) === base.has(row.id)) continue;
    // `expanded` wins over `collapsed` in resolve, so each change leaves the other list.
    if (folds.has(row.id)) {
      expanded.delete(row.id);
      collapsed.add(row.id);
    } else {
      collapsed.delete(row.id);
      expanded.add(row.id);
    }
  }
  const { collapsed: _collapsed, expanded: _expanded, ...rest } = authored ?? {};
  return {
    ...rest,
    ...(collapsed.size > 0 ? { collapsed: [...collapsed] } : {}),
    ...(expanded.size > 0 ? { expanded: [...expanded] } : {}),
  };
}

/**
 * Whether a surface hides the level-0 data rows: `expansion.rootsHidden` when
 * the spec names it, else the totals step (`depth: 'totals'`) on a table that
 * has a total row. Without a total row the step would leave only section
 * headings or nothing at all, so it keeps the folded level-0 rows.
 */
export function expansionRootsHidden(
  table: ResolvedTable,
  expansion: TableOptions['expansion'],
): boolean {
  return expansion?.rootsHidden ?? (expansion?.depth === 'totals' && table.rows.some((row) => row.role === 'total'));
}

/**
 * The rows a surface draws. An inline row is never one of them: it prints as
 * a line inside its parent's cells, and the parent hands it out through
 * `visibleInlineRows`. `rootsHidden` drops every level-0 data row
 * and everything under it, leaving the totals and the section headings.
 */
export { hasNoDataRows } from '../../emptyData';

/**
 * The one row an empty table draws under its head: the message in the label column, in the quiet ink of a detail row,
 * and blank cells. Both surfaces append it to the rows they draw; it is never in `table.rows`, so no claim, record or
 * accessible count mentions it.
 */
export function emptyMessageRow(table: ResolvedTable, message: string): ResolvedRow {
  const id = 'boardplot:empty';
  const labelId = table.columns.find((column) => column.kind === 'rowLabel')?.id;
  return {
    id, label: message, hasChildren: false, level: 0, step: 0, role: 'data', relation: 'displayOnly', kind: 'detail',
    order: table.rows.length,
    cells: Object.fromEntries(table.columns.map((column) => [column.id, {
      rowId: id, colId: column.id, kind: column.kind, raw: column.id === labelId ? message : null,
      state: column.id === labelId ? 'value' as const : 'missing' as const, displayed: column.id === labelId ? message : '',
      tone: 'neutral' as const, role: 'data' as const, relation: 'displayOnly' as const, level: 0,
    }])),
  };
}

export function visibleRows(
  table: ResolvedTable,
  collapsed?: ReadonlySet<Id>,
  rootsHidden = false,
): ResolvedRow[] {
  const collapsedIds = collapsed ?? collapsedByDefault(table);
  const rowById = new Map(table.rows.map((row) => [row.id, row]));
  return table.rows.filter((row) => {
    if (row.inline === true) return false;
    if (rootsHidden && underARoot(row, rowById)) return false;
    let parentId = row.parentId;
    while (parentId !== undefined) {
      const parent = rowById.get(parentId);
      // A foldable: false parent keeps its children whatever the set says.
      if (collapsedIds.has(parentId) && parent?.foldable !== false) return false;
      parentId = parent?.parentId;
    }
    return true;
  });
}

/**
 * Whether a row is a top-level data row or sits under one. A section
 * heading is not a tree parent, so it is transparent here too: on a
 * board whose sections OWN their KPIs through `children`, the section
 * would otherwise be the topmost ancestor of every row, and the totals-only
 * step of a depth control would hide nothing.
 */
function underARoot(row: ResolvedRow, rowById: ReadonlyMap<Id, ResolvedRow>): boolean {
  let current: ResolvedRow | undefined = row;
  while (current !== undefined) {
    if (current.role !== 'data') return false;
    // A root authored foldable: false never folds, so it stays with its subtree.
    if (current.parentId === undefined) return current.foldable !== false;
    const parent: ResolvedRow | undefined = rowById.get(current.parentId);
    // A section authored foldable: false keeps the roots it owns, as a root keeps its own.
    if (parent === undefined || parent.role === 'section') return current.foldable !== false && parent?.foldable !== false;
    current = parent;
  }
  return false;
}

/** The ground a row sits on, in its two weights. */
type RowGround = 'emphasis' | 'band';

/**
 * The row that draws each closing rule: a final result, or the last drawn row
 * of its open block, so the rule closes the statement and never cuts a
 * result off from its own rows. `rows` are the drawn rows in order.
 */
export function finalClosers(rows: readonly ResolvedRow[]): Set<Id> {
  const parent = new Map(rows.map((row) => [row.id, row.parentId]));
  const inside = (id: Id | undefined, root: Id): boolean => {
    for (let p = id; p !== undefined; p = parent.get(p)) if (p === root) return true;
    return false;
  };
  const closers = new Set<Id>();
  rows.forEach((row, i) => {
    if (!row.final) return;
    let j = i;
    while (j + 1 < rows.length && inside(rows[j + 1]!.parentId, row.id)) j++;
    closers.add(rows[j]!.id);
  });
  return closers;
}

/**
 * The ground under each row, read top down: the total on
 * the emphasis ground between its two rules, the top-level groups on the
 * same emphasis, their own parents one level down on the lighter band, and
 * everything under them, deeper parents and every leaf, on the panel. A
 * section heading carries no ground at all.
 */
export function rowGrounds(table: ResolvedTable): Map<Id, RowGround> {
  const grounds = new Map<Id, RowGround>();
  // a leaf among parents on its rung, under the same parent, takes
  // their ground, so the rung reads as one. A flat table stays groundless.
  const rung = (row: ResolvedRow) => JSON.stringify([row.parentId ?? null, row.step]);
  const rungsWithParents = new Set(table.rows.filter((row) => row.role === 'data' && row.inline !== true && row.hasChildren).map(rung));
  for (const row of table.rows) {
    if (row.role !== 'data' || row.inline === true || !rungsWithParents.has(rung(row))) continue;
    // `step` is the row's rung: its depth with the section headings taken
    // out of the count and `options.levelOffset` applied, so the ground and
    // the type read the same tree.
    if (row.step === 0) grounds.set(row.id, 'emphasis');
    else if (row.step === 1) grounds.set(row.id, 'band');
  }
  return grounds;
}

/** One column and one direction: what a sortable header holds. */
export interface TableSort {
  column: Id;
  direction: 'asc' | 'desc';
}

/** Column kinds a reader may sort by; `sortable: true` names exactly these. */
const SORTABLE_COLUMNS: ReadonlySet<ColumnKind> = new Set<ColumnKind>(['value', 'computed', 'date', 'text']);

/** The drawn columns a sort control offers, from `true` or an authored list. */
export function sortableColumnIds(
  table: ResolvedTable,
  sortable: boolean | readonly Id[] | undefined,
): Set<Id> {
  if (sortable === undefined || sortable === false) return new Set();
  const authored = sortable === true ? undefined : new Set(sortable);
  return new Set(
    table.columns
      .filter((column) =>
        authored === undefined ? SORTABLE_COLUMNS.has(column.kind) : authored.has(column.id),
      )
      .map((column) => column.id),
  );
}

/** A cell's place in the sort: numbers by value, everything else by its string. */
function sortKey(row: ResolvedRow, colId: Id): { missing: boolean; number?: number; text?: string } {
  const cell = row.cells[colId];
  if (cell === undefined || cell.state !== 'value') return { missing: true };
  if (typeof cell.raw === 'number') return { missing: false, number: cell.raw };
  const text = typeof cell.raw === 'string' && cell.raw !== '' ? cell.raw : cell.displayed;
  return text === '' ? { missing: true } : { missing: false, text };
}

/** The table language's collation with numeric runs compared as numbers; the default locale where it names none Intl knows. */
function textCollator(locale?: string): Intl.Collator {
  try {
    return new Intl.Collator(locale, { numeric: true });
  } catch {
    return new Intl.Collator(undefined, { numeric: true });
  }
}

/**
 * The rows in sorted display order, pixel-free.
 *
 * Only DATA rows move, and only inside a run of data siblings: a section
 * heading and a total keep their index, so a sort reorders within each block
 * instead of lifting a row out from under its heading. Children stay under
 * their parent because the walk rebuilds the flat list parent-first, and an
 * inline line is not a row — it travels inside its parent's cells. A missing,
 * suppressed or empty cell sorts last in both directions; ties keep the
 * authored order. Text sorts as a reader reads it in the table's language,
 * with the digits in it as numbers: 0.9.1 before 0.20.3, item 9 before
 * item 10. The SVG path can take the same order the day a spec asks
 * for one, which is why this lives beside `visibleRows` and not in React.
 */
export function sortRows(table: ResolvedTable, sort?: TableSort | null, locale?: string): ResolvedRow[] {
  if (!sort || !table.columns.some((column) => column.id === sort.column)) return table.rows;
  const sign = sort.direction === 'asc' ? 1 : -1;
  const collator = textCollator(locale);
  const childrenOf = new Map<Id | undefined, ResolvedRow[]>();
  for (const row of table.rows) {
    const list = childrenOf.get(row.parentId) ?? [];
    list.push(row);
    childrenOf.set(row.parentId, list);
  }
  const movable = (row: ResolvedRow): boolean => ranksAsData(row) && row.inline !== true;
  const compare = (a: ResolvedRow, b: ResolvedRow): number => {
    const ka = sortKey(a, sort.column);
    const kb = sortKey(b, sort.column);
    if (ka.missing || kb.missing) {
      return ka.missing === kb.missing ? a.order - b.order : ka.missing ? 1 : -1;
    }
    const step =
      ka.number !== undefined && kb.number !== undefined
        ? ka.number - kb.number
        : collator.compare(String(ka.text ?? ka.number), String(kb.text ?? kb.number));
    return sign * step || a.order - b.order;
  };
  const ordered = (parentId: Id | undefined): ResolvedRow[] => {
    const sibs = [...(childrenOf.get(parentId) ?? [])];
    // Runs of consecutive data rows sort among themselves; a section heading,
    // a total or an inline line between two runs is a wall neither crosses.
    let start = 0;
    for (let index = 0; index <= sibs.length; index++) {
      if (index < sibs.length && movable(sibs[index]!)) continue;
      if (index - start > 1) {
        const run = sibs.slice(start, index).sort(compare);
        for (let offset = 0; offset < run.length; offset++) sibs[start + offset] = run[offset]!;
      }
      start = index + 1;
    }
    return sibs;
  };
  const out: ResolvedRow[] = [];
  const walk = (parentId: Id | undefined): void => {
    for (const row of ordered(parentId)) {
      out.push(row);
      walk(row.id);
    }
  };
  walk(undefined);
  return out.length === table.rows.length ? out : table.rows;
}

/**
 * The lines one row prints inside its own cells, in authored order: the ones
 * whose `inlineGroup` the host has not switched off. An absent group is
 * visible, so a table with no Changes control draws every authored line.
 * Section rows and totals carry none (the ladder gives them no room).
 */
export function visibleInlineRows(
  row: ResolvedRow,
  visibility?: Readonly<Record<Id, boolean>>,
): ResolvedRow[] {
  if (row.role !== 'data' || row.inlineRows === undefined) return [];
  return row.inlineRows.filter((line) => visibility?.[line.inlineGroup ?? line.id] !== false);
}

/** A column that carries a heat lane, the one kind whose figures `figures: false` takes off. */
export const heatColumn = (column: ResolvedColumn): boolean => column.cellEncoding?.type === 'heat';

/**
 * Whether a surface prints the cell figures. `figures: false` needs
 * a drawn heat column whose grounds carry the reading. Without one the rows
 * took the 14 px heat pitch while every number still printed, which cut
 * each row's text and the labels of its groups and totals, so the figures
 * stay on.
 */
export function printsFigures(figures: boolean | undefined, columns: readonly ResolvedColumn[]): boolean {
  return figures !== false || !columns.some(heatColumn);
}

export function visibleColumns(
  table: ResolvedTable,
  visibility?: Readonly<Record<Id, boolean>>,
): ResolvedColumn[] {
  const groupVisible = new Map(
    table.columnToggles.map((toggle) => [
      toggle.id,
      visibility?.[toggle.id] ?? toggle.visible,
    ]),
  );
  return table.columns.filter(
    (column) => column.toggleGroup === undefined || groupVisible.get(column.toggleGroup) !== false,
  );
}

export function groupSpans(
  table: ResolvedTable,
  visibleCols: readonly ResolvedColumn[],
): { id: Id; label: string; span: number; fullSpan: number }[] {
  const visibleIds = new Set(visibleCols.map((column) => column.id));
  return table.columnGroups.map((group) => ({
    id: group.id,
    label: group.label,
    span: group.columnIds.filter((columnId) => visibleIds.has(columnId)).length,
    fullSpan: group.columnIds.length,
  }));
}

export function inCellBarMaxima(
  rows: readonly ResolvedRow[],
  columns: readonly ResolvedColumn[],
): Map<Id, number> {
  const maxima = new Map<Id, number>();
  for (const column of columns) {
    // A bar scales to it; an arrow picks its angle from its share of it.
    if (column.cellEncoding?.type !== 'inCellBar' && column.cellEncoding?.type !== 'arrow') continue;
    let maximum = 0;
    for (const row of rows) {
      const cell = row.cells[column.id];
      if (cell?.state === 'value' && typeof cell.raw === 'number') {
        maximum = Math.max(maximum, Math.abs(cell.raw));
      }
    }
    maxima.set(column.id, maximum);
  }
  return maxima;
}
