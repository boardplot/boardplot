import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type Dispatch, type KeyboardEvent, type MouseEvent, type ReactElement, type ReactNode, type SetStateAction } from 'react';
import type { InteractionRecord } from '../core/a11y/types';
import type { ResolvedChartRequest } from '../core/request';
import type { PreparedChart, RenderGeometry } from './prepared';
import type { CardFollower, HoverModel, HoverSelection, HoverView } from './hover/engine';
import { HoverGroupContext } from './hoverGroupContext';

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
/** The engine once it is on the page: a chart that is used after that takes it without a wait. */
let loadedEngine: HoverEngine | undefined;

/**
 * The engine loads once per page, on the first chart that asks for it. A
 * failed load is forgotten, so the next chart that asks tries again instead
 * of reading the same rejection for good.
 */
export function loadHoverEngine(): Promise<HoverEngine> {
  enginePromise ??= import('./hover/engine').then(module => loadedEngine = module, (error: unknown) => {
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

/** A table with hover on loads the shared engine after mount; hydration starts without it. */
export function useHoverEngine(enabled = true): HoverEngine | undefined {
  return useOptionalModule(undefined, enabled, loadHoverEngine);
}

/** The record the keyboard rests on: its place in the reading order, and whether the last input was a key. */
export interface KeyCursor { id: string; index: number; size: number; reading: string; active: boolean }

/** A record click or its keyboard twin, Enter or Space on the focused record. */
export type RecordClickEvent = MouseEvent<Element> | KeyboardEvent<Element>;

/** The event of an input from before the engine was here, and the handler it belongs to. It keeps `currentTarget`, which React clears after the dispatch. */
export interface HeldInput { kind: 'onPointerMove' | 'onPointerDown' | 'onPointerUp' | 'onFocus' | 'onKeyDown'; currentTarget: EventTarget }

/** What one chart's hover keeps between renders. The handlers in the engine chunk read and write it. */
export interface HoverRefs {
  /** The element that carries `data-bp-hover`. */
  host: HTMLElement | null;
  last: { id?: string; index: number };
  order: { model?: HoverModel; activation?: boolean; records: InteractionRecord[] };
  /** The host's card element, the focus to return to on Escape, and the pointer's way to the card. */
  card: HTMLElement | null;
  opener: HTMLElement | null;
  quiet: boolean;
  corridor: { from?: { x: number; y: number }; distance: number };
  close?: ReturnType<typeof setTimeout>;
  rest?: ReturnType<typeof setTimeout>;
  /** Moves the default card with a mouse or pen, outside React. */
  follower?: CardFollower;
  /** The pointer id of the one finger that moves the card along a line. */
  touch?: number;
  /** Input from before the engine was here, oldest first. */
  held: HeldInput[];
  /** The engine was asked for. */
  asked?: boolean;
  /** The records last passed to `onHoverChange`. */
  reported: readonly InteractionRecord[];
}

/** One render's state of a chart's hover, as the engine's handlers take it. */
export interface HoverContext {
  model: HoverModel; request: ResolvedChartRequest; geometry: RenderGeometry; view: HoverView;
  selection: HoverSelection; setSelection: Dispatch<SetStateAction<HoverSelection>>;
  cursor: KeyCursor | undefined; setCursor: Dispatch<SetStateAction<KeyCursor | undefined>>;
  hover: HoverFlagSet | undefined; keys: boolean; custom: boolean; scrub: boolean;
  /** Inside a `HoverGroup`: every card of the chart stays inside its own frame. */
  grouped: boolean;
  onRecordClick?: (record: InteractionRecord, event: RecordClickEvent) => void;
  refs: HoverRefs;
}

const NONE: readonly never[] = [];
const never = () => () => {};
const onClient = () => true;
const onServer = () => false;
const nothing = () => undefined;
/** The keys the chart's keyboard stop answers: held, and kept from the page, until the engine is here. */
const STOP_KEYS = /^(Arrow|Home$|End$|Enter$| $)/;

/**
 * Hover state of one drawn chart. Only this hook ships with every chart.
 * Records, hit test, pointer and key handlers, card and highlight live in the
 * engine chunk, which loads at the first use of the chart: the pointer enters
 * its box, a touch starts on it, or it takes the keyboard focus. Input from
 * before the engine arrived is held and replayed, so the first pointer
 * position and the first key press count.
 *
 * The keyboard reaches the records through one tab stop per chart (the
 * `keys` element HoverSurface renders after mount). The focused record opens
 * the pointer's card and highlight. The last input wins: a pointer move takes
 * the card over, the next key takes it back.
 */
export function useHover(input: { request: ResolvedChartRequest; geometry: RenderGeometry; prepared?: PreparedChart; hover?: HoverOption;
  onRecordClick?: (record: InteractionRecord, event: RecordClickEvent) => void;
  onHoverChange?: (records: InteractionRecord[]) => void;
  /** The host draws its own card content (`renderHoverContent`): the card takes the pointer and the focus. */
  custom?: boolean; }) {
  const { request, geometry, prepared, onRecordClick, onHoverChange, custom = false } = input;
  // Asking for card content asks for the card: an absent `hover` turns on, an explicit one wins.
  const shown = hoverFlags(input.hover ?? (custom ? true : undefined));
  // A page that only listens tracks the pointer and draws nothing.
  const asked = shown ?? (input.hover && onHoverChange ? { card: false as const, highlight: false } : undefined);
  // A drill-down needs the keyboard too: a chart with `onRecordClick` gets the tab stop without hover.
  const wanted = asked !== undefined || onRecordClick !== undefined;
  // Not in the server pass and not in the pass that hydrates it: the stop, the event stops and the touch rule arrive after mount.
  const keys = useSyncExternalStore(never, onClient, onServer) && wanted;
  const [engine, setEngine] = useState<HoverEngine>();
  const [selection, setSelection] = useState<HoverSelection>({ ids: [] });
  const [cursor, setCursor] = useState<KeyCursor>();
  const [, again] = useState(0);
  const refs = useRef<HoverRefs>({ host: null, last: { index: 0 }, order: { records: [] }, card: null, opener: null, quiet: false,
    corridor: { distance: Infinity }, held: [], reported: NONE }).current;
  const group = useContext(HoverGroupContext);
  // The hover of another chart of the group. This chart's own hover reads as none.
  const link = useSyncExternalStore(group?.subscribe ?? never, () => { const value = group?.get(); return value?.source === refs ? undefined : value; }, nothing);
  const wake = () => {
    if (refs.asked) return;
    refs.asked = true;
    if (loadedEngine) setEngine(loadedEngine);
    else loadHoverEngine().then(setEngine, (error: unknown) => { refs.asked = false; console.warn(error); });
  };
  // A click that names a record cannot wait for a download, and a linked chart follows without being touched.
  const eager = wanted && (onRecordClick !== undefined || link !== undefined);
  useEffect(() => { if (eager) wake(); }, [eager]);
  useEffect(() => () => { clearTimeout(refs.close); clearTimeout(refs.rest); refs.follower?.cancel(); }, []);
  const model = useMemo(() => engine?.hoverModel(request, geometry, prepared), [engine, request, geometry, prepared]);
  // A metric stack's focus look: the hovered category becomes the focus. No series dims, and a card shows only
  // where the host asks for one (`hover.card` or its own card content).
  const look = model?.placement?.focusBand !== undefined;
  const hover = asked && look
    ? { card: custom || (typeof input.hover === 'object' && input.hover.card !== undefined) ? asked.card : false as const, highlight: false } : asked;
  const flags = hover ?? (cursor?.active ? { card: false, highlight: false } : undefined);
  const cardOn = flags !== undefined && flags.card !== false; const highlight = flags?.highlight ?? false;
  const keyed = cursor?.active === true;
  const { ids, position } = selection;
  useEffect(() => engine?.watchHover(selection, setSelection, geometry.size), [engine, selection.measurement, selection.position?.linked, geometry.size]);
  // A card closed by Escape or a tap outside cancels the pointer's pending re-pick, which would open it again.
  useEffect(() => { if (!ids.length) { clearTimeout(refs.rest); refs.rest = undefined; } }, [ids.length]);
  // Keyed by value: a literal `hover={{ card: 'label' }}` is a new object every render.
  const view: HoverView = useMemo(() => engine && model && flags
    ? engine.hoverView(model, request, geometry, ids, { card: cardOn, highlight, keyboard: keyed }, position) : geometry,
  [engine, model, request, geometry, ids, cardOn, highlight, keyed, position]);
  const activation = onRecordClick !== undefined || custom;
  const scrub = asked !== undefined && request.type === 'line';
  const driver = engine && model && engine.hoverDriver({ model, request, geometry, view, selection, setSelection, cursor, setCursor, hover, keys: wanted, custom, scrub, grouped: group !== undefined, onRecordClick, refs });
  useEffect(() => { driver?.sync(); }, [model, activation]);
  // The category another chart of the group has hovered, while this chart has no hover of its own.
  useEffect(() => { driver?.follow(asked && link); }, [engine, model, link, asked !== undefined, ids.length > 0]);
  // One held input per render: each handler reads the state the one before it set. A passive effect, so a long run
  // of held keys renders one commit after another and never nests one render in the next.
  useEffect(() => {
    const next = driver && refs.held.shift();
    if (!next) return;
    (driver.handlers as Record<string, ((event: never) => void) | undefined>)[next.kind]?.(next as never);
    if (refs.held.length) again(count => count + 1);
  });
  // The page hears each change of the hovered records, also a new layout under a resting pointer, and one empty list at the end.
  const listener = useRef(onHoverChange);
  listener.current = onHoverChange;
  useEffect(() => { if (engine && model) engine.reportHover(refs, model, asked ? selection : undefined, listener.current, group); },
    [engine, model, selection, asked !== undefined, group]);
  useEffect(() => () => {
    if (refs.reported.length) { refs.reported = NONE; listener.current?.([]); }
    group?.set(refs);
  }, [group]);
  const hold = (drop: string, kind?: HeldInput['kind'], event?: object) => {
    refs.held = refs.held.filter(item => !item.kind.startsWith(drop));
    if (!kind) return;
    // The event itself, so a record click gets the real event: a focus has no pointer position, and the engine tells the two apart by that.
    refs.held.push(Object.create(event!, { kind: { value: kind }, currentTarget: { value: (event as HeldInput).currentTarget } }));
    wake();
  };
  const mouse = (event: { pointerType: string }) => { if (event.pointerType !== 'touch') hold('onP', 'onPointerMove', event); };
  // A tap lifts before the engine is here: the lift is held after its touch, so the engine does not take the next tap for a second finger.
  const lifted = (event: { pointerType: string }) => { if (event.pointerType === 'touch') hold('-', 'onPointerUp', event); };
  const handlers = driver ? driver.handlers : keys ? {
    ...asked && {
      onPointerEnter: mouse, onPointerMove: mouse,
      onPointerDown: (event: { pointerType: string }) => { if (event.pointerType === 'touch') hold('onP', 'onPointerDown', event); },
      // A lifted finger leaves the chart too: that leave drops nothing.
      onPointerLeave: (event: { pointerType: string }) => { if (event.pointerType !== 'touch') hold('onP'); },
      ...scrub && { onPointerUp: lifted, onPointerCancel: lifted },
    },
    onFocus: (event: object) => hold('on', 'onFocus', event),
    onBlur: () => { hold('onF'); hold('onK'); },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (!(event.target as Element).hasAttribute('data-bp-keys') || event.altKey || event.ctrlKey || event.metaKey || !STOP_KEYS.test(event.key)) return;
      event.preventDefault();
      hold('-', 'onKeyDown', event);
    },
  } : undefined;
  const cardRef = (node: HTMLElement | null) => { refs.card = node; };
  const hostRef = (node: HTMLElement | null) => { refs.host = node; };
  // The focus look's focus: the category of the hovered, focused or linked record.
  const focusCategory = look ? model!.records.find(record => record.id === ids[0])?.target.owner.categoryId : undefined;
  return { engine, view, origin: position?.viewport?.origin, follow: position?.follow === true, handlers, focusStops: keys && hover !== undefined, keys, scrub: keys && scrub, cursor, cardRef, hostRef, focusCategory };
}
