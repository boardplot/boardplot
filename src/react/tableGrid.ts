import {
  useCallback,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { useIsomorphicLayoutEffect as useLayoutEffect } from './useIsomorphicLayoutEffect';
import type { Id } from '../core/types/cell';
import type { ResolvedColumn, ResolvedRow } from '../core/types/table';

export interface TableGridFocus {
  rowId: Id;
  colId: Id;
}

function columnsForRow(
  row: ResolvedRow,
  columns: readonly ResolvedColumn[],
): readonly ResolvedColumn[] {
  if (row.role !== 'section') return columns;
  const label = columns.find((column) => column.kind === 'rowLabel');
  return label === undefined ? columns.slice(0, 1) : [label];
}

function initialTableGridFocus(
  rows: readonly ResolvedRow[],
  columns: readonly ResolvedColumn[],
): TableGridFocus | undefined {
  for (const row of rows) {
    const first = columnsForRow(row, columns)[0];
    if (first !== undefined) return { rowId: row.id, colId: first.id };
  }
  return undefined;
}

function retainTableGridFocus(
  focus: TableGridFocus | undefined,
  rows: readonly ResolvedRow[],
  columns: readonly ResolvedColumn[],
  allRows: readonly ResolvedRow[] = rows,
): TableGridFocus | undefined {
  if (focus === undefined) return initialTableGridFocus(rows, columns);
  const row = rows.find((candidate) => candidate.id === focus.rowId);
  if (row === undefined) {
    // A row folded away under a parent: the focus goes to the nearest
    // ancestor still drawn, the row the reader just closed.
    let parentId = allRows.find((candidate) => candidate.id === focus.rowId)?.parentId;
    while (parentId !== undefined) {
      const id: Id = parentId;
      if (rows.some((candidate) => candidate.id === id)) return retainTableGridFocus({ rowId: id, colId: focus.colId }, rows, columns);
      parentId = allRows.find((candidate) => candidate.id === id)?.parentId;
    }
    return initialTableGridFocus(rows, columns);
  }
  const cols = columnsForRow(row, columns);
  if (cols.some((column) => column.id === focus.colId)) return focus;
  // The cell is gone, its column hidden: the nearest column that
  // is still drawn, by the row's own column order, not the first one.
  const order = Object.keys(row.cells);
  const from = order.indexOf(focus.colId);
  const visible = new Set(cols.map((column) => column.id));
  let fallback: ResolvedColumn | undefined;
  for (let distance = 1; from >= 0 && fallback === undefined && distance < order.length; distance++) {
    for (const id of [order[from - distance], order[from + distance]]) {
      if (id !== undefined && visible.has(id)) {
        fallback = cols.find((column) => column.id === id);
        break;
      }
    }
  }
  fallback ??= cols[0];
  return fallback === undefined
    ? initialTableGridFocus(rows, columns)
    : { rowId: row.id, colId: fallback.id };
}

function stepTableGridFocus(
  focus: TableGridFocus,
  rows: readonly ResolvedRow[],
  columns: readonly ResolvedColumn[],
  key: string,
  pageRows = 1,
  control = false,
): TableGridFocus {
  const rowIndex = rows.findIndex((row) => row.id === focus.rowId);
  if (rowIndex < 0) return focus;
  const row = rows[rowIndex]!;
  const cols = columnsForRow(row, columns);
  const colIndex = cols.findIndex((column) => column.id === focus.colId);
  if (colIndex < 0) return focus;
  if (control && (key === 'Home' || key === 'End')) {
    const edge = rows[key === 'Home' ? 0 : rows.length - 1]!;
    const edgeCols = columnsForRow(edge, columns);
    return { rowId: edge.id, colId: edgeCols[key === 'Home' ? 0 : edgeCols.length - 1]!.id };
  }
  if (key === 'ArrowLeft' || key === 'Home') {
    const next = key === 'Home' ? cols[0] : cols[colIndex - 1];
    return next === undefined ? focus : { rowId: row.id, colId: next.id };
  }
  if (key === 'ArrowRight' || key === 'End') {
    const next = key === 'End' ? cols[cols.length - 1] : cols[colIndex + 1];
    return next === undefined ? focus : { rowId: row.id, colId: next.id };
  }
  if (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(key)) return focus;
  const distance = key.startsWith('Page') ? pageRows : 1;
  const nextRow = rows[Math.max(0, Math.min(rows.length - 1, rowIndex + (key.endsWith('Up') ? -distance : distance)))];
  if (nextRow === undefined) return focus;
  const nextCols = columnsForRow(nextRow, columns);
  const same = nextCols.find((column) => column.id === focus.colId);
  const fallback = nextCols[0];
  if (same === undefined && fallback === undefined) return focus;
  return { rowId: nextRow.id, colId: (same ?? fallback)!.id };
}

function isTableGridKey(key: string): boolean {
  return ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(key);
}

function cellSelector(focus: TableGridFocus): string {
  const key = `${encodeURIComponent(focus.rowId)}:${encodeURIComponent(focus.colId)}`;
  return `[data-bp-label="${key}"],[data-bp-mark="${key}"]`;
}

export function useTableGridNavigation(
  rows: readonly ResolvedRow[],
  columns: readonly ResolvedColumn[],
  allRows: readonly ResolvedRow[] = rows,
): {
  focus: TableGridFocus | undefined;
  tableRef: RefObject<HTMLDivElement | null>;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onFocusCapture: (event: FocusEvent<HTMLElement>) => void;
  onBlurCapture: (event: FocusEvent<HTMLElement>) => void;
} {
  const tableRef = useRef<HTMLDivElement>(null);
  const activeCell = useRef<HTMLElement | undefined>(undefined);
  const activeToggle = useRef(false);
  const pending = useRef<TableGridFocus | undefined>(undefined);
  const [focus, setFocus] = useState<TableGridFocus | undefined>(() =>
    initialTableGridFocus(rows, columns),
  );
  const current = retainTableGridFocus(focus, rows, columns, allRows);
  if (
    current?.rowId !== focus?.rowId ||
    current?.colId !== focus?.colId
  ) {
    setFocus(current);
  }

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const control = event.ctrlKey || event.metaKey;
      if (event.defaultPrevented || event.altKey || event.shiftKey || (control && event.key !== 'Home' && event.key !== 'End')) return;
      if (!isTableGridKey(event.key) || current === undefined) return;
      // The roving grid is the BODY. A header's sort button is inside the
      // same element, and without this guard an arrow key pressed on it
      // moved the focus into a body cell the reader had not asked for.
      const from = event.target;
      if (from instanceof Element && from.closest('[data-bp-row][data-bp-column]') === null) return;
      let pageRows = 1;
      if (event.key.startsWith('Page') && from instanceof Element) {
        const scroller = from.closest<HTMLElement>('.bp-scroll');
        const view = from.ownerDocument.defaultView!;
        let top = 0, bottom = view.innerHeight;
        // An unconstrained table can be taller than the window or an outer scroll box.
        for (let ancestor = scroller; ancestor; ancestor = ancestor.parentElement) {
          const overflow = view.getComputedStyle(ancestor).overflowY;
          if (ancestor.clientHeight <= 0 || (ancestor !== scroller && (!overflow || overflow === 'visible'))) continue;
          const box = ancestor.getBoundingClientRect();
          const scale = ancestor.offsetHeight > 0 ? box.height / ancestor.offsetHeight : 1;
          const edge = box.top + ancestor.clientTop * scale;
          top = Math.max(top, edge);
          bottom = Math.min(bottom, edge + ancestor.clientHeight * scale);
        }
        const rowHeight = from.closest('[role="row"]')?.getBoundingClientRect().height ?? 0;
        const head = tableRef.current?.querySelector('[data-bp-rowgroup="head"]')?.getBoundingClientRect();
        const headHeight = head === undefined ? 0 : Math.max(0, Math.min(bottom, head.bottom) - Math.max(top, head.top));
        pageRows = Math.max(1, Math.floor((bottom - top - headHeight) / (rowHeight || 1)));
      }
      let next = stepTableGridFocus(current, rows, columns, event.key, pageRows, control);
      const fromHeader = from instanceof Element && from.closest('[role="rowheader"]') !== null;
      if (event.key === 'ArrowRight' && fromHeader) {
        const child = rows.find(row => row.parentId === current.rowId);
        if (child !== undefined) next = { rowId: child.id, colId: columnsForRow(child, columns)[0]!.id };
      }
      // A row header goes to its parent's row header, wherever the label column sits in the display order.
      if (event.key === 'ArrowLeft' && (next === current || fromHeader)) {
        const parentId = rows.find(row => row.id === current.rowId)?.parentId;
        const parent = rows.find(row => row.id === parentId);
        if (parent !== undefined) next = { rowId: parent.id, colId: fromHeader ? current.colId : columnsForRow(parent, columns)[0]!.id };
      }
      event.preventDefault();
      setFocus(next);
      const node = tableRef.current?.querySelector(cellSelector(next));
      if (node instanceof HTMLElement) node.focus();
      // A windowed table builds the cell on the next render: focus it then.
      else pending.current = next;
    },
    [columns, current, rows],
  );
  useLayoutEffect(() => {
    // Moving a row to another page remounts its cell without a blur event.
    const queued = pending.current;
    const active = activeCell.current;
    // A focused row whose parent closed: its cell is still in the document
    // while the fold runs, so the focus would stay on a row no one sees.
    const folded = queued === undefined && active !== undefined && current !== undefined
      && active.getAttribute('data-bp-row') !== current.rowId
      && (active.isConnected ? active.contains(document.activeElement) : document.activeElement === document.body)
      && !rows.some((row) => row.id === active.getAttribute('data-bp-row'));
    const next = queued ?? (folded || (active !== undefined && !active.isConnected
      && document.activeElement === document.body) ? current : undefined);
    if (next === undefined) return;
    pending.current = undefined;
    const node = tableRef.current?.querySelector(cellSelector(next));
    // From a fold mark, the focus lands on the parent's fold mark.
    const toggle = folded && activeToggle.current ? node?.querySelector('[data-bp-toggle-row]') : null;
    const target = toggle ?? node;
    if (target instanceof HTMLElement) target.focus({ preventScroll: queued === undefined && !folded });
  });

  const onFocusCapture = useCallback((event: FocusEvent<HTMLElement>) => {
    activeCell.current = undefined;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const cell = target.closest<HTMLElement>('[data-bp-row][data-bp-column]');
    const rowId = cell?.getAttribute('data-bp-row');
    const colId = cell?.getAttribute('data-bp-column');
    if (rowId === null || rowId === undefined || colId === null || colId === undefined) return;
    activeCell.current = cell ?? undefined;
    activeToggle.current = target.closest('[data-bp-toggle-row]') !== null;
    setFocus((prev) =>
      prev?.rowId === rowId && prev.colId === colId ? prev : { rowId, colId },
    );
  }, []);

  const onBlurCapture = useCallback((event: FocusEvent<HTMLElement>) => {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) activeCell.current = undefined;
  }, []);

  return { focus: current, tableRef, onKeyDown, onFocusCapture, onBlurCapture };
}
