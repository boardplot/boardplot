/**
 * Cell addressing for table calculations.
 * A string still means "this column on the current row".
 * `{ row }` means the column being evaluated on another row.
 * `{ row, previous: true }` means the preceding member of that row in the
 * same columnGroup as the column being evaluated.
 */

import type { Id } from '../../types/cell';
import type { CalcCellRef, CellState } from '../../types/table';

type RawCell = { raw: number | string | null; state: CellState };
type NonValue = Exclude<CellState, 'value'>;

export function previousColumnInGroup(
  groups: readonly { columns: readonly Id[] }[],
  colId: Id,
): Id | null {
  for (const group of groups) {
    const index = group.columns.indexOf(colId);
    if (index > 0) return group.columns[index - 1]!;
    if (index === 0) return null;
  }
  return null;
}

/** The cell a reference reads, or the state it prints where it reads none. */
export function resolveCalcRef(
  ref: CalcCellRef,
  currentRow: Id,
  currentCol: Id | undefined,
  previousCol: ((colId: Id) => Id | null) | undefined,
  noPrevious: 'na' | 'missing' = 'na',
): { rowId: Id; colId: Id } | NonValue {
  if (typeof ref === 'string') return { rowId: currentRow, colId: ref };
  if (ref.previous) {
    if (!currentCol || !previousCol) return 'na';
    const colId = previousCol(currentCol);
    // The first member of a group has no previous period: n/a by default,
    // the missing glyph where the theme says so (`table.noPrevious`).
    if (colId === null) return noPrevious;
    return { rowId: ref.row, colId };
  }
  const colId = ref.col ?? currentCol;
  if (!colId) return 'missing';
  return { rowId: ref.row, colId };
}

/** Read one operand and record it. Unresolved cells emit `<state>` / `?`. */
export function readCalcInput(
  ref: CalcCellRef,
  args: {
    currentRow: Id;
    currentCol?: Id;
    states: Map<Id, RawCell>;
    rawState?: Map<Id, Map<Id, RawCell>>;
    previousCol?: (colId: Id) => Id | null;
    noPrevious?: 'na' | 'missing';
    inputs: { rowId: Id; colId: Id; value: number }[];
    emit: (text: string) => void;
  },
): number | NonValue {
  const resolved = resolveCalcRef(ref, args.currentRow, args.currentCol, args.previousCol, args.noPrevious);
  if (typeof resolved === 'string') {
    args.emit(`<${resolved}>`);
    return resolved;
  }
  const { rowId, colId } = resolved;
  const s =
    rowId === args.currentRow ? args.states.get(colId) : args.rawState?.get(rowId)?.get(colId);
  if (!s) {
    args.emit('?');
    return 'missing';
  }
  if (s.state !== 'value' || typeof s.raw !== 'number') {
    args.emit(`<${s.state}>`);
    return s.state as NonValue;
  }
  args.inputs.push({ rowId, colId, value: s.raw });
  args.emit(`$${args.inputs.length - 1}`);
  return s.raw;
}
