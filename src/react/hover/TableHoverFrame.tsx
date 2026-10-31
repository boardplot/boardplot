import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactElement } from 'react';
import { useIsomorphicLayoutEffect as useLayoutEffect } from '../useIsomorphicLayoutEffect';
import { useScopedId } from '../idPrefix';
import type { InteractionRecord } from '../../core/a11y/types';
import type { Rect } from '../../core/geometry';
import type { OccupiedRect } from '../../core/types/scene';
import type { ResolvedTable } from '../../core/types/table';
import type { TableInteractionFrameProps } from '../tableInteractionContext';
import { useBoardplotTheme } from '../themeContext';
import { useHoverEngine, type HoverFlagSet } from '../useHover';

function cellKey(rowId: string, columnId: string): string {
  return JSON.stringify([rowId, columnId]);
}

/** Records of the cells on screen: collapsed rows and hidden column groups draw none. */
function drawnRecords(source: readonly InteractionRecord[], rows: TableInteractionFrameProps['rows'], columns: TableInteractionFrameProps['columns']): InteractionRecord[] {
  const rowIds = new Set(rows.map(row => row.id));
  const colIds = new Set(columns.map(column => column.id));
  return source.filter(record => {
    const { rowId, colId } = record.target.owner;
    return rowId !== undefined && colId !== undefined && rowIds.has(rowId) && colIds.has(colId);
  });
}

/**
 * The element the card renders into: the host's container, the
 * document body when the host names none, nothing where there is no document
 * (a server pass never opens a card) or where the host keeps it in the frame.
 */
function portalTarget(portal: HTMLElement | null | false | undefined): HTMLElement | undefined {
  return portal === false ? undefined : portal || (typeof document === 'undefined' ? undefined : document.body || undefined);
}

/** The client box in viewport units, including ancestor scaling. */
function clientBox(element: HTMLElement) {
  const box = element.getBoundingClientRect();
  const { offsetWidth, offsetHeight } = element;
  const sx = offsetWidth ? box.width / offsetWidth : 1;
  const sy = offsetHeight ? box.height / offsetHeight : 1;
  const x = box.left + element.clientLeft * sx;
  const y = box.top + element.clientTop * sy;
  return {
    x, y, right: x + element.clientWidth * sx, bottom: y + element.clientHeight * sy, sx, sy,
  };
}

function cellPosition(cell: HTMLElement, container: HTMLElement, portal?: HTMLElement,
  visibleIds?: { rows: ReadonlySet<string>; columns: ReadonlySet<string> }) {
  const document = cell.ownerDocument;
  const view = document.defaultView!;
  const viewport = { left: 8, top: 8, right: (document.documentElement.clientWidth || view.innerWidth) - 8,
    bottom: (document.documentElement.clientHeight || view.innerHeight) - 8 };
  let { left, top, right, bottom } = viewport;
  const isVisible = (element: HTMLElement) => (!visibleIds
    || ((element.dataset.bpRow === undefined || visibleIds.rows.has(element.dataset.bpRow))
      && (element.dataset.bpColumn === undefined || visibleIds.columns.has(element.dataset.bpColumn))))
    && !element.closest('[hidden],[aria-hidden="true"]');
  if (!isVisible(cell)) return undefined;
  // Start at the table's scroll box, outside row folds that clip only table content.
  for (let ancestor = cell.closest<HTMLElement>('.bp-scroll') ?? cell.closest<HTMLElement>('.bp-table-grid') ?? cell.parentElement;
    ancestor; ancestor = ancestor.parentElement) {
    const style = view.getComputedStyle(ancestor);
    if ([style.overflow, style.overflowX, style.overflowY].some(value => value && value !== 'visible')) {
      const box = clientBox(ancestor);
      left = Math.max(left, box.x); top = Math.max(top, box.y);
      right = Math.min(right, box.right); bottom = Math.min(bottom, box.bottom);
    }
    if (ancestor === portal) break;
  }
  const box = cell.getBoundingClientRect();
  if (!cell.isConnected || Math.min(right - left, bottom - top, box.width, box.height) <= 0
    || box.right <= left || box.left >= right || box.bottom <= top || box.top >= bottom) return undefined;
  // Absolute cards count from their containing block's scrolled padding box.
  // A static body counts from the document instead.
  const positioned = (element: Element) => {
    const { position, transform } = view.getComputedStyle(element);
    return (position && position !== 'static') || (transform && transform !== 'none');
  };
  const block = (positioned(container) ? container : container.offsetParent) as HTMLElement | null;
  let origin = { x: -view.scrollX, y: -view.scrollY, sx: 1, sy: 1 };
  if (block && block !== document.documentElement && (block !== document.body || positioned(block))) {
    origin = clientBox(block);
    origin.x -= block.scrollLeft * origin.sx;
    origin.y -= block.scrollTop * origin.sy;
  }
  // A card in the top layer or in the document body is fixed to the viewport.
  if ('showPopover' in cell || container === document.body) origin = { x: 0, y: 0, sx: 1, sy: 1 };
  const { sx, sy } = origin;
  const cells = new Map<HTMLElement, Rect>();
  const rowBounds = new Map<string, Rect[]>();
  const occupied: OccupiedRect[] = [];
  const range = document.createRange();
  let x1 = right; let y1 = bottom; let x2 = left; let y2 = top;
  const local = (box: { left: number; top: number; right: number; bottom: number }): Rect => ({
    x: (box.left - viewport.left) / sx, y: (box.top - viewport.top) / sy,
    w: (box.right - box.left) / sx, h: (box.bottom - box.top) / sy,
  });
  for (const element of Array.from(cell.closest('.bp-table-grid')?.querySelectorAll<HTMLElement>('[data-bp-row][data-bp-column],[role="columnheader"]') ?? [])) {
    if (!isVisible(element)) continue;
    const box = element.getBoundingClientRect();
    const visible = { left: Math.max(left, box.left), top: Math.max(top, box.top),
      right: Math.min(right, box.right), bottom: Math.min(bottom, box.bottom) };
    if (visible.right <= visible.left || visible.bottom <= visible.top) continue;
    const rect = local(visible);
    cells.set(element, rect);
    x1 = Math.min(x1, visible.left); y1 = Math.min(y1, visible.top);
    x2 = Math.max(x2, visible.right); y2 = Math.max(y2, visible.bottom);
    const rowId = element.dataset.bpRow;
    if (rowId !== undefined) {
      const row = rowBounds.get(rowId) ?? [];
      row.push(rect); rowBounds.set(rowId, row);
    }
    const walker = document.createTreeWalker(element, 4 /* SHOW_TEXT */);
    let textBounds: typeof visible | undefined;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      range.selectNodeContents(node);
      for (const text of Array.from(range.getClientRects?.() ?? [])) {
        const clipped = { left: Math.max(visible.left, text.left), top: Math.max(visible.top, text.top),
          right: Math.min(visible.right, text.right), bottom: Math.min(visible.bottom, text.bottom) };
        if (clipped.right > clipped.left && clipped.bottom > clipped.top) textBounds = textBounds ? {
          left: Math.min(textBounds.left, clipped.left), top: Math.min(textBounds.top, clipped.top),
          right: Math.max(textBounds.right, clipped.right), bottom: Math.max(textBounds.bottom, clipped.bottom),
        } : clipped;
      }
    }
    if (textBounds) occupied.push({ rect: local(textBounds), kind: 'label', owner: { rowId, colId: element.dataset.bpColumn } });
  }
  return {
    cells, rowBounds, occupied,
    tableBounds: cells.size ? local({ left: x1, top: y1, right: x2, bottom: y2 }) : undefined,
    anchor: local(box),
    frame: { w: (viewport.right - viewport.left) / sx, h: (viewport.bottom - viewport.top) / sy },
    offset: { x: (viewport.left - origin.x) / sx, y: (viewport.top - origin.y) / sy },
    scale: { x: sx, y: sy },
  };
}

function tableWidth(table: ResolvedTable, request: TableInteractionFrameProps['request']): number {
  if (request.options.size !== undefined) return request.size.width;
  const resolved = table.columns.reduce((sum, column) => sum + (column.width ?? 0), 0);
  return resolved > 0 ? resolved : request.size.width;
}

/**
 * Hover for TableChart: the label card of the cell under the pointer and the
 * table's hover wash on that cell's row. A table is read along its rows, so
 * the highlight names the row and leaves every other cell as it is; the
 * pointer wash of the stylesheet (`tr:hover`) draws the same wash, this rule
 * follows a touch selection as well. The table keeps its own keyboard grid:
 * a focused body cell opens the same card at the cell, Escape closes it and
 * leaves the focus on the cell.
 */
export function TableHoverFrame({ table, rows, columns, request, theme, initialPrepared, refused, portal, flags, styleNonce, inlineVisibility, children }:
  TableInteractionFrameProps & { flags: HoverFlagSet; styleNonce?: string; inlineVisibility?: Record<string, boolean> }): ReactElement {
  const { direction } = useBoardplotTheme();
  const engine = useHoverEngine();
  const target = portalTarget(portal);
  const frameRef = useRef<HTMLDivElement>(null);
  const touch = useRef<{ id: number; x: number; y: number } | undefined>(undefined);
  const visibleIds = useMemo(() => ({ rows: new Set(rows.map(row => row.id)), columns: new Set(columns.map(column => column.id)) }), [rows, columns]);
  // A new table render can move or resize cells without resizing the table itself.
  const revision = useMemo(() => ({}), [table, rows, columns, theme, request, inlineVisibility, children]);
  // The frame is the viewport; offset maps it into the portal's containing block.
  const [activeCell, setActiveCell] = useState<({ id: string; cell: HTMLElement; revision: object; pointer: { x: number; y: number } }
    & NonNullable<ReturnType<typeof cellPosition>>) | undefined>(undefined);
  const activeRef = useRef(activeCell);
  activeRef.current = activeCell;
  const open = activeCell !== undefined;
  useEffect(() => {
    const selectedCell = activeRef.current?.cell;
    if (!selectedCell) return undefined;
    const document = selectedCell.ownerDocument;
    const view = document.defaultView!;
    let pending: number | undefined;
    const close = () => { touch.current = undefined; setActiveCell(undefined); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    const outside = (event: globalThis.PointerEvent) => {
      if (!frameRef.current?.contains(event.target as Node)) close();
    };
    const update = () => {
      if (pending !== undefined) return;
      pending = view.requestAnimationFrame(() => {
        pending = undefined;
        const cell = activeRef.current?.cell;
        const position = cell && cellPosition(cell, target ?? frameRef.current!, target, visibleIds);
        setActiveCell(current => current && position ? { ...current, ...position, revision } : undefined);
      });
    };
    document.addEventListener('keydown', escape);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('pointercancel', close);
    view.addEventListener('scroll', update, { capture: true, passive: true });
    view.addEventListener('resize', update);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    if (frameRef.current) observer?.observe(frameRef.current);
    if (activeRef.current?.revision !== revision) update();
    document.fonts?.addEventListener('loadingdone', update);
    return () => {
      document.removeEventListener('keydown', escape);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('pointercancel', close);
      view.removeEventListener('scroll', update, true);
      view.removeEventListener('resize', update);
      observer?.disconnect();
      document.fonts?.removeEventListener('loadingdone', update);
      if (pending !== undefined) view.cancelAnimationFrame(pending);
    };
  }, [open, target, visibleIds, revision]);
  const records = useMemo(() => {
    let cached: InteractionRecord[] | undefined;
    return () => cached ??= engine ? drawnRecords(initialPrepared?.records ?? engine.tableRecords(table, request.data, request.scope, request.options), rows, columns) : [];
  }, [engine, initialPrepared, table, request.data, request.scope, request.options, rows, columns]);
  const byCell = useMemo(() => {
    let cached: Map<string, InteractionRecord> | undefined;
    return () => cached ??= new Map(records().flatMap(record => {
      const { rowId, colId } = record.target.owner;
      return rowId !== undefined && colId !== undefined ? [[cellKey(rowId, colId), record] as const] : [];
    }));
  }, [records]);
  const instance = useScopedId();
  const active = refused || activeCell === undefined ? undefined : records().find(record => record.id === activeCell.id);
  const locale = request.locale?.language;
  const activate = (event: PointerEvent<HTMLElement>) => openCell(event.target, event.currentTarget, { x: event.clientX, y: event.clientY });
  const openCell = (from: EventTarget, frame: HTMLElement, at?: { x: number; y: number }) => {
    const cell = from instanceof Element ? from.closest<HTMLElement>('[data-bp-row][data-bp-column]') : null;
    const rowId = cell?.dataset.bpRow; const columnId = cell?.dataset.bpColumn;
    const record = rowId === undefined || columnId === undefined ? undefined : byCell().get(cellKey(rowId, columnId));
    if (!record || !cell) { setActiveCell(undefined); return; }
    if (cell === activeCell?.cell) return;
    const cached = activeCell?.revision === revision && activeCell.cells.get(cell);
    const position = cached ? { ...activeCell!, anchor: cached } : cellPosition(cell, target ?? frame, target, visibleIds);
    // A focused cell has no pointer: the card takes the cell's centre.
    const box = at ? undefined : cell.getBoundingClientRect();
    const pointer = at ?? { x: box!.left + box!.width / 2, y: box!.top + box!.height / 2 };
    setActiveCell(position ? { ...position, id: record.id, cell, revision, pointer } : undefined);
  };
  const moveTouch = (event: PointerEvent<HTMLElement>) => {
    const start = touch.current;
    if (start && start.id === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) {
      touch.current = undefined;
      setActiveCell(undefined);
    }
  };
  const owner = active?.target.owner;
  const mark = owner?.rowId !== undefined && owner.colId !== undefined
    ? `${encodeURIComponent(owner.rowId)}:${encodeURIComponent(owner.colId)}` : undefined;
  const cell = activeCell?.cell;
  const row = cell?.closest<HTMLElement>('[role="row"]');
  useLayoutEffect(() => {
    if (!row || owner?.rowId === undefined) return;
    row.setAttribute('data-bp-active-row', owner.rowId);
    return () => row.removeAttribute('data-bp-active-row');
  }, [row, owner?.rowId]);
  useLayoutEffect(() => {
    if (!cell || mark === undefined) return;
    cell.setAttribute('data-bp-active', mark);
    return () => cell.removeAttribute('data-bp-active');
  }, [cell, mark]);
  const scope = `.bp-hover-table[data-bp-instance="${instance}"]`;
  // Above the sticky first cell's own background and the tone washes of a row.
  const rowRule = `${scope} .bp-table-grid [role="row"][data-bp-active-row]>*{background:var(--bp-hover-wash)}`;
  // The cell the card belongs to takes the band ground while the card shows,
  // so the reader can see which number the trend is drawn for.
  const cellRule = `${scope} .bp-table-grid [data-bp-active]{background:var(--bp-band)}`;
  const css = useMemo(() => ({ __html: ((flags.highlight ? rowRule : '')
    + (flags.card === 'sparkline' ? cellRule : '')).replace(/</g, '\\3c ') }), [flags.highlight, flags.card, rowRule, cellRule]);
  return <div ref={frameRef} className="bp-hover-table" data-bp-hover="" data-bp-instance={instance}
    style={{ position: 'relative' }}
    onPointerOver={event => { if (event.pointerType !== 'touch') activate(event); }}
    onPointerDown={event => {
      if (event.pointerType === 'touch') touch.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    }}
    onPointerMove={moveTouch}
    onPointerUp={event => {
      moveTouch(event);
      if (event.pointerType === 'touch' && touch.current?.id === event.pointerId) activate(event);
      touch.current = undefined;
    }}
    onPointerCancel={() => { touch.current = undefined; setActiveCell(undefined); }}
    onPointerLeave={event => { if (event.pointerType !== 'touch') setActiveCell(undefined); }}
    onFocus={event => openCell(event.target, event.currentTarget)}
    onBlur={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setActiveCell(undefined); }}>
    <style nonce={styleNonce} dangerouslySetInnerHTML={css} />
    {children}
    {engine && active && activeCell && flags.card !== false ? <engine.TableCard record={active} width={tableWidth(table, request)} theme={theme} palette={request.options.palette}
      locale={locale} measure={request.fontMetrics} direction={direction} anchor={activeCell.anchor} frame={activeCell.frame}
      pointer={{ x: (activeCell.pointer.x - 8) / activeCell.scale.x, y: (activeCell.pointer.y - 8) / activeCell.scale.y }}
      occupied={activeCell.occupied} forbidden={activeCell.rowBounds.get(owner!.rowId!)} tableBounds={activeCell.tableBounds}
      styleNonce={styleNonce} variant={flags.card} table={table} columns={columns} inlineVisibility={inlineVisibility} smallValues={request.options.smallValues}
      container={target ?? frameRef.current ?? undefined} offset={activeCell.offset} /> : null}
  </div>;
}
