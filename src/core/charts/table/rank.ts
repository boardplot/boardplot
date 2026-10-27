/**
 * Table sort and top-N. Ranking uses resolved additive value cells, then
 * resolveTable runs again on the rewritten authored rows so totals, formats
 * and claims stay on the existing path.
 */
import { NormalizeError } from '../../normalize/shared';
import type { Id } from '../../types/cell';
import type {
  ResolvedColumn,
  ResolvedRow,
  ResolvedTable,
  TableData,
  TableOptions,
  TableRow,
} from '../../types/table';

export function assertTableRankOptions(options: TableOptions): void {
  const segments = options.sort?.segments;
  if (segments !== undefined && segments !== 'sheet') {
    throw new NormalizeError(
      'table-sort-segments-unsupported',
      'options.sort.segments',
      `table has no segments; sort.segments '${segments}' cannot reorder columns without breaking groups and accounting`,
      "drop sort.segments, or sort rows with sort.categories ('sheet', 'reverse', 'asc', 'desc')",
    );
  }
}

/**
 * Rows that take a top-N seat or fold into Others. Result and driver rows are
 * display-only statement lines and keep their authored place.
 */
export function ranksAsData(row: Pick<TableRow, 'role' | 'kind'> | undefined): boolean {
  return (row?.role ?? 'data') === 'data' && row?.kind !== 'result' && row?.kind !== 'driver';
}

export function additiveRankKey(row: ResolvedRow, columns: readonly ResolvedColumn[]): number | null {
  let sum = 0;
  let counted = false;
  for (const column of columns) {
    if (column.kind !== 'value' || column.aggregate === 'none' || column.aggregate === 'source') continue;
    const cell = row.cells[column.id];
    if (cell?.state === 'value' && typeof cell.raw === 'number') {
      sum += cell.raw;
      counted = true;
    }
  }
  return counted ? sum : null;
}

export function requireAdditiveRanking(
  columns: readonly ResolvedColumn[],
  rows: readonly ResolvedRow[],
  path: string,
  action: string,
): void {
  const ranked = rows.some((row) => ranksAsData(row) && additiveRankKey(row, columns) !== null);
  if (!ranked) {
    throw new NormalizeError(
      'table-rank-unranked',
      path,
      `${action} needs at least one additive value column with a numeric cell; text, status and non-aggregating columns are not ranking keys`,
      "add a value column with aggregate 'sum', or drop the ranking option",
    );
  }
}

function authoredById(rows: TableRow[]): Map<Id, TableRow> {
  const out = new Map<Id, TableRow>();
  const walk = (list: TableRow[]): void => {
    for (const row of list) {
      out.set(row.id, row);
      if (row.children) walk(row.children);
    }
  };
  walk(rows);
  return out;
}

function usedIds(rows: TableRow[]): Set<Id> {
  return new Set(authoredById(rows).keys());
}

function othersIdFor(parentId: Id | undefined, used: Set<Id>): Id {
  let id: Id = parentId ? `others:${parentId}` : 'others';
  while (used.has(id)) id = `_${id}`;
  used.add(id);
  return id;
}

function siblingGroups(table: ResolvedTable): Map<Id | undefined, ResolvedRow[]> {
  const groups = new Map<Id | undefined, ResolvedRow[]>();
  for (const row of table.rows) {
    const parentId = row.parentId;
    const list = groups.get(parentId) ?? [];
    list.push(row);
    groups.set(parentId, list);
  }
  return groups;
}

function toAuthored(row: ResolvedRow, original: TableRow | undefined, children: TableRow[]): TableRow {
  return {
    ...original,
    id: row.id,
    label: original?.label ?? row.label,
    role: original?.role ?? row.role,
    relation: original?.relation ?? row.relation,
    // The fold rebuilds a nested tree, including rows authored with parentId.
    parentId: undefined,
    children: children.length > 0 ? children : undefined,
  };
}

function foldSiblings(
  parentId: Id | undefined,
  groups: Map<Id | undefined, ResolvedRow[]>,
  original: Map<Id, TableRow>,
  table: ResolvedTable,
  topN: NonNullable<TableOptions['topN']>,
  used: Set<Id>,
  generatedOthers: Set<Id>,
): TableRow[] {
  const sibs = groups.get(parentId) ?? [];
  const rebuilt = sibs.map((row) =>
    toAuthored(row, original.get(row.id), foldSiblings(row.id, groups, original, table, topN, used, generatedOthers)),
  );
  const dataIdx = rebuilt
    .map((_, index) => index)
    .filter((index) => ranksAsData(original.get(rebuilt[index]!.id)));
  if (dataIdx.length <= topN.n) return rebuilt;

  const dataRows = dataIdx.map((index) => rebuilt[index]!);
  if (dataRows.some((row) => (original.get(row.id)?.relation ?? 'additive') !== 'additive')) {
    throw new NormalizeError(
      'table-topn-relation-unsupported',
      'options.topN',
      'topN cannot regroup ofWhich or displayOnly rows; nesting them under Others would change whose total they annotate',
      'keep those rows as authored siblings, or drop options.topN',
    );
  }

  const keys = dataRows.map((row) => {
    const resolved = table.rows.find((candidate) => candidate.id === row.id)!;
    return Math.abs(additiveRankKey(resolved, table.columns) ?? 0);
  });
  const ranked = dataRows.map((_, index) => index).sort((a, b) => keys[b]! - keys[a]! || a - b);
  const keep = new Set(ranked.slice(0, Math.max(1, topN.n)));
  if (topN.threshold !== undefined) {
    for (const index of [...keep]) {
      if (keys[index]! < topN.threshold) keep.delete(index);
    }
    if (keep.size === 0 && ranked.length > 0) keep.add(ranked[0]!);
  }
  const dropped = dataRows.filter((_, index) => !keep.has(index));
  if (dropped.length === 0) return rebuilt;

  if (topN.rest === false) {
    if (parentId !== undefined) {
      throw new NormalizeError(
        'table-topn-rest-required',
        'options.topN.rest',
        'topN.rest false would drop sibling summands and change the parent total; tables keep accounting by nesting the rest under Others',
        'omit topN.rest (defaults to true), or flatten the hierarchy before omitting rows',
      );
    }
    const keptIds = new Set(dataRows.filter((_, index) => keep.has(index)).map((row) => row.id));
    return rebuilt.filter((row, index) => {
      if (!dataIdx.includes(index)) return true;
      return keptIds.has(row.id);
    });
  }

  const keptIds = new Set(dataRows.filter((_, index) => keep.has(index)).map((row) => row.id));
  const lastData = dataIdx[dataIdx.length - 1]!;
  const before = rebuilt.slice(0, lastData + 1).filter((row, index) => !dataIdx.includes(index) || keptIds.has(row.id));
  const after = rebuilt.slice(lastData + 1);
  const label =
    (topN.restLabel ?? 'Others') + (topN.showRestCount ? ` (${dropped.length})` : '');
  const id = othersIdFor(parentId, used);
  generatedOthers.add(id);
  // Others closes the data block, so a result or driver authored after the
  // data rows stays below it.
  return [...before, {
    id,
    label,
    role: 'data',
    relation: 'additive',
    totalPolicy: 'derive',
    children: dropped,
  }, ...after];
}

export function foldTableTopN(
  data: TableData,
  ranked: ResolvedTable,
  options: TableOptions,
): { data: TableData; generatedOthers: Set<Id> } {
  const topN = options.topN;
  const generatedOthers = new Set<Id>();
  if (!topN || topN.n <= 0) return { data, generatedOthers };
  requireAdditiveRanking(ranked.columns, ranked.rows, 'options.topN', 'topN');
  const original = authoredById(data.rows);
  const folded = foldSiblings(
    undefined,
    siblingGroups(ranked),
    original,
    ranked,
    topN,
    usedIds(data.rows),
    generatedOthers,
  );
  return { data: { ...data, rows: folded }, generatedOthers };
}
