import { useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactElement, type ReactNode } from 'react';
import type { InteractionRecord } from '../core/a11y/types';
import type { ResolvedChartRequest } from '../core/request';
import type { PreparedChart, RenderGeometry } from './prepared';
import type { HoverModel, HoverSelection, HoverView } from './hover/engine';

/**
 * Which card a hovered mark opens. `'label'` is the record's own facts, the
 * card every chart draws; `'sparkline'` is the table's, which draws the row
 * across its column group and rings the point under the pointer; `false`
 * draws no card.
 */
export type HoverCard = false | 'label' | 'sparkline';

/** `true` shows the label card and the highlight; an object turns either one off. */
export type HoverOption = boolean | { card?: HoverCard; highlight?: boolean };

/** What `renderHoverContent` receives beside the record. */
export interface HoverContentContext {
  /** Every record the card covers, the pointed record first: a category band lists its other series. */
  records: InteractionRecord[];
  /** The default card's content for these records, to keep, extend or leave out; null where it would be empty. */
  defaultContent: ReactElement | null;
  /** The input that opened the card. */
  source: 'pointer' | 'keyboard';
}

/**
 * The host's own hover card content. It receives the record `onRecordClick`
 * receives for the same mark. Return `context.defaultContent` for the
 * default card, wrap it to add to it, return your own content to replace it,
 * or null for no card on that record.
 */
export type RenderHoverContent = (record: InteractionRecord, context: HoverContentContext) => ReactNode;

export type HoverEngine = typeof import('./hover/engine');

export interface HoverFlagSet {
  card: false | 'label' | 'sparkline';
  highlight: boolean;
}

/** The effective flags of a hover prop, or undefined when hover is off. */
export function hoverFlags(hover: HoverOption | undefined): HoverFlagSet | undefined {
  if (!hover) return undefined;
  const option = hover === true ? {} : hover;
  const card = option.card === false ? false : option.card === 'sparkline' ? 'sparkline' : 'label';
  const highlight = option.highlight ?? true;
  return card !== false || highlight ? { card, highlight } : undefined;
}

let enginePromise: Promise<HoverEngine> | undefined;

/**
 * The engine loads once per page, on the first chart that asks for it. A
 * failed load is forgotten, so the next chart that mounts asks again instead
 * of reading the same rejection for good.
 */
export function loadHoverEngine(): Promise<HoverEngine> {
  enginePromise ??= import('./hover/engine').catch((error: unknown) => {
    enginePromise = undefined;
    throw error;
  });
  return enginePromise;
}

/** Shared loading state for the independent hover and accessible-table modules. */
export function useOptionalModule<T>(provided: T | undefined, enabled: boolean, load: () => Promise<T>): T | undefined {
  const [loaded, setLoaded] = useState<T>();
  useEffect(() => {
    if (!enabled || provided) return;
    let live = true;
    load().then(module => { if (live) setLoaded(() => module); }, console.warn);
    return () => { live = false; };
  }, [enabled, provided, load]);
  return provided ?? (enabled ? loaded : undefined);
}

/** The enabled chart loads the shared engine after mount; hydration starts without it. */
export function useHoverEngine(enabled = true): HoverEngine | undefined {
  return useOptionalModule(undefined, enabled, loadHoverEngine);
}

/** The record the keyboard rests on: its place in the reading order, and whether the last input was a key. */
export interface KeyCursor { id: string; index: number; size: number; reading: string; active: boolean }

/** A record click or its keyboard twin, Enter or Space on the focused record. */
export type RecordClickEvent = MouseEvent<Element> | KeyboardEvent<Element>;

const RECORD_KEYS: ReadonlySet<string> = new Set(['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End']);

function isKeyStop(target: EventTarget): boolean {
  return target instanceof Element && target.hasAttribute('data-bp-keys');
}

/**
 * Hover state of one drawn chart. Pointer input before the engine has loaded
 * is ignored. The hovered records are kept by id and resolved against the
 * current records, so a new layout drops a hovered mark that no longer exists.
 * Only this hook and the pointer handlers ship with every chart; records, hit
 * test, card and highlight live in the engine chunk.
 *
 * The keyboard reaches the same records through one tab stop per chart (the
 * `keys` element HoverSurface renders once the engine has loaded). Arrow keys
 * choose spatial neighbours where records form a grid or scatter, else
 * step through the engine's reading order, built on the first focus. The
 * focused record opens the pointer's card and highlight. The last input wins:
 * a pointer move takes the card over, the next key takes it back.
 */
export function useHover(input: { request: ResolvedChartRequest; geometry: RenderGeometry; prepared?: PreparedChart; hover?: HoverOption;
  onRecordClick?: (record: InteractionRecord, event: RecordClickEvent) => void;
  /** The host draws its own card content (`renderHoverContent`): the card takes the pointer and the focus. */
  custom?: boolean; }) {
  const { request, geometry, prepared, onRecordClick, custom = false } = input;
  // Asking for card content asks for the card: an absent `hover` turns on, an explicit one wins.
  const hover = hoverFlags(input.hover ?? (custom ? true : undefined));
  // A drill-down needs the keyboard too: a chart with `onRecordClick` gets the tab stop without hover.
  const keys = hover !== undefined || onRecordClick !== undefined;
  const engine = useHoverEngine(keys);
  const [selection, setSelection] = useState<HoverSelection>({ ids: [] });
  const [cursor, setCursor] = useState<KeyCursor>();
  const host = useRef<HTMLElement | null>(null);
  const last = useRef<{ id?: string; index: number }>({ index: 0 });
  const order = useRef<{ model?: HoverModel; activation?: boolean; records: InteractionRecord[] }>({ records: [] });
  // A record with no card is a keyboard stop only while a click callback can activate it, or the host draws its card.
  const activation = onRecordClick !== undefined || custom;
  /** The host's card element, the focus to return to on Escape, and the pointer's way to the card. */
  const card = useRef<HTMLElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const quiet = useRef(false);
  const corridor = useRef<{ from?: { x: number; y: number }; distance: number }>({ distance: Infinity });
  const timers = useRef<{ close?: ReturnType<typeof setTimeout>; rest?: ReturnType<typeof setTimeout> }>({});
  const inCard = (target: EventTarget | null) => target instanceof Node && card.current?.contains(target) === true;
  const clearTimer = (key: 'close' | 'rest') => { if (timers.current[key] !== undefined) clearTimeout(timers.current[key]); timers.current[key] = undefined; };
  useEffect(() => () => { clearTimer('close'); clearTimer('rest'); }, []);
  const flags = hover ?? (cursor?.active ? { card: false, highlight: false } : undefined);
  const cardOn = flags !== undefined && flags.card !== false; const highlight = flags?.highlight ?? false;
  const keyed = cursor?.active === true;
  const { ids, position } = selection;
  const close = () => { clearTimer('close'); clearTimer('rest'); setSelection({ ids: [] }); };
  useEffect(() => engine?.watchHover(selection, setSelection, geometry.size), [engine, selection.measurement, geometry.size]);
  // A card closed by Escape or a tap outside cancels the pointer's pending re-pick, which would open it again.
  useEffect(() => { if (!ids.length) clearTimer('rest'); }, [ids.length]);
  const model = useMemo(() => engine?.hoverModel(request, geometry, prepared), [engine, request, geometry, prepared]);
  // Keyed by value: a literal `hover={{ card: 'label' }}` is a new object every render.
  const view: HoverView = useMemo(() => engine && model && flags
    ? engine.hoverView(model, request, geometry, ids, { card: cardOn, highlight, keyboard: keyed }, position) : geometry,
  [engine, model, request, geometry, ids, cardOn, highlight, keyed, position]);
  /** The reading order of the drawn model, built on the first keyboard use and again after a new layout or callback. */
  const records = (): InteractionRecord[] => {
    if (!engine || !model) return [];
    if (order.current.model !== model || order.current.activation !== activation) order.current = { model, activation, records: engine.keyboardOrder(model, request, geometry, activation) };
    return order.current.records;
  };
  /** Rest the keyboard on the record at `index` of the order; `open` also opens its card, as the last input. */
  const show = (index: number, open = true) => {
    // The keyboard takes over: no pending pointer close or re-pick may replace its record.
    clearTimer('close'); clearTimer('rest');
    const list = records();
    if (!engine || !model || !host.current || !list.length) return;
    const at = Math.min(Math.max(index, 0), list.length - 1);
    const record = list[at]!;
    last.current = { id: record.id, index: at };
    const reading = engine.keyboardReading(model, request, record);
    setCursor(current => ({ id: record.id, index: at, size: list.length, reading, active: open || current?.active === true }));
    const surface = host.current;
    if (open) setSelection(current => engine.keyboardSelection(model, request, surface, view, current, record));
  };
  useEffect(() => {
    if (!model) return;
    setSelection(current => current.ids.length && !model.records.some(record => current.ids.includes(record.id))
      ? { ids: [] } : current);
    // A new layout or callback keeps the focused record where it still exists, else the record at its place in the order.
    if (!cursor) return;
    const list = records();
    const found = list.findIndex(record => record.id === cursor.id);
    if (list.length) show(found >= 0 ? found : cursor.index, cursor.active && selection.ids.length > 0);
    else setCursor(undefined);
  }, [model, activation]);
  const pick = (event: PointerEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
    if (engine && model) setSelection(engine.hoverSelection(model, request, event, view, selection, custom));
  };
  /**
   * A card stays while the pointer travels to it: inside the corridor
   * from the point the record was picked to the card, and getting closer.
   * A pointer that rests there for 250 ms is hit-tested again.
   */
  const towardCard = (event: PointerEvent<HTMLElement>): boolean => {
    const shown = engine && selection.ids.length ? card.current?.getBoundingClientRect() : undefined;
    const box = shown && shown.width > 0 && shown.height > 0 ? shown : undefined;
    const at = { x: event.clientX, y: event.clientY };
    const distance = box ? Math.hypot(Math.max(box.left - at.x, 0, at.x - box.right), Math.max(box.top - at.y, 0, at.y - box.bottom)) : Infinity;
    const { from } = corridor.current;
    if (box && from && distance < corridor.current.distance
      && engine!.inCardCorridor(from, { x: box.left, y: box.top, w: box.width, h: box.height }, at)) {
      corridor.current.distance = distance;
      clearTimer('rest');
      const rest = { currentTarget: event.currentTarget, target: event.target, clientX: event.clientX, clientY: event.clientY } as unknown as PointerEvent<HTMLElement>;
      timers.current.rest = setTimeout(() => { corridor.current = { from: at, distance: Infinity }; pick(rest); }, 250);
      return true;
    }
    corridor.current = { from: at, distance: Infinity };
    return false;
  };
  const point = (event: PointerEvent<HTMLElement>) => {
    clearTimer('close');
    // The card's own content belongs to the host: a pointer in it keeps the card where it is.
    if (inCard(event.target)) { clearTimer('rest'); return; }
    // A card that holds keyboard focus stays until focus leaves it; a tap still picks a new record.
    if (event.pointerType !== 'touch' && card.current?.contains(card.current.ownerDocument.activeElement)) return;
    if (towardCard(event)) return;
    clearTimer('rest');
    setCursor(current => current?.active ? { ...current, active: false } : current);
    pick(event);
  };
  // A click on a mark names the record the hover card names. It runs before the
  // mark's own series click, which then does not fire: the legend keeps it.
  const onClickCapture = onRecordClick && ((event: MouseEvent<HTMLElement>) => {
    // A click in the host's card (a link) is the host's, never a mark's under the card.
    if (inCard(event.target)) return;
    const record = engine && model ? engine.clickedRecord(model, request, event, view) : undefined;
    if (!record) return;
    event.stopPropagation();
    onRecordClick(record, event);
  });
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (inCard(event.target)) {
      // Keys in the card are the host's. Escape closes it and returns the focus to what opened it.
      if (event.key === 'Escape') {
        event.preventDefault();
        quiet.current = true;
        (opener.current?.isConnected ? opener.current : event.currentTarget.querySelector<HTMLElement>('[data-bp-keys]'))?.focus();
        quiet.current = false;
        close();
      }
      return;
    }
    if (!isKeyStop(event.target) || event.altKey || event.ctrlKey || event.metaKey || !cursor) return;
    if (RECORD_KEYS.has(event.key) && engine && model) {
      event.preventDefault();
      show(engine.keyboardStep(records(), cursor.index, event.key, model, request));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const record = records()[cursor.index];
      // The key is the last input: the card and highlight return to the record it fires for.
      show(cursor.index);
      if (record && onRecordClick && engine?.activates(record)) onRecordClick(record, event);
    } else if (event.key === 'Escape' && selection.ids.length) {
      // The card closes; the focus stays on the record, and the next arrow opens it again.
      close();
    }
  };
  const onFocus = (event: FocusEvent<HTMLElement>) => {
    if (inCard(event.target)) {
      // The focus holds the card: no pending close or re-pick takes it away.
      clearTimer('close'); clearTimer('rest');
      // Remember what opened the card: the record stop or an event marker.
      if (event.relatedTarget instanceof HTMLElement && !inCard(event.relatedTarget) && event.currentTarget.contains(event.relatedTarget)) opener.current = event.relatedTarget;
      return;
    }
    // Escape from the card returns the focus here; the card it closed stays closed.
    if (!isKeyStop(event.target)) { if (hover && !quiet.current) pick(event); return; }
    host.current = event.currentTarget;
    const list = records();
    const found = list.findIndex(record => record.id === last.current.id);
    show(found >= 0 ? found : last.current.index, !quiet.current);
  };
  const onBlur = (event: FocusEvent<HTMLElement>) => {
    if (!(event.target instanceof Element)) return;
    // The focus moves into the card: the record and its card stay open.
    if (inCard(event.relatedTarget)) return;
    if (inCard(event.target)) {
      if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) { close(); setCursor(undefined); }
      return;
    }
    if (isKeyStop(event.target)) {
      if (cursor?.active) close();
      setCursor(undefined);
    } else if (hover && event.target.hasAttribute('data-bp-stop')) close();
  };
  const handlers = { ...onClickCapture && { onClickCapture }, ...keys && { onFocus, onBlur, onKeyDown }, ...hover && {
    onPointerMove: (event: PointerEvent<HTMLElement>) => { if (event.pointerType !== 'touch') point(event); },
    onPointerDown: (event: PointerEvent<HTMLElement>) => { if (event.pointerType === 'touch') point(event); },
    onPointerLeave: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === 'touch') return;
      clearTimer('rest');
      // A card that holds the focus stays; else the pointer has 150 ms to cross a gap into the card.
      if (card.current?.contains(card.current.ownerDocument.activeElement)) return;
      clearTimer('close');
      timers.current.close = setTimeout(close, 150);
    },
  } };
  const cardRef = (node: HTMLElement | null) => { card.current = node; };
  return { engine, view, origin: position?.viewport?.origin, handlers, focusStops: hover !== undefined, keys: keys && engine !== undefined, cursor, cardRef };
}
