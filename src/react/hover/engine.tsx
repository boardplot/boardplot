/**
 * The hover engine: records, hit test, label card and highlight for one
 * drawn chart. Chart components load this module on demand (`import()` in
 * `useHover`), independently of the accessible data table, and a host
 * bundler that splits dynamic imports ships it as its own chunk.
 */

import { type CSSProperties, useMemo, useRef, useState, type FocusEvent, type MouseEvent, type PointerEvent, type ReactElement, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { interactionRecords } from '../../core/a11y/records';
import type { SmallValues } from '../../core/formatPrecision';
import { withChartFormats } from '../../core/formatSpec';
import { ownerContains } from '../../core/a11y/recordsShared';
export { tableRecords } from './dataTable';
export { labelCardGeometry } from './labelCard';
export { keyboardOrder, keyboardReading, keyboardSelection, keyboardStep } from './keyboard';
export { Cards, hostContent, hoverDriver, reportHover } from './pointer';
import type { InteractionRecord } from '../../core/a11y/types';
import type { ResolvedChartRequest } from '../../core/request';
import type { Id, OwnerRef } from '../../core/types/cell';
import type { OccupiedRect } from '../../core/types/scene';
import type { ResolvedColumn, ResolvedTable } from '../../core/types/table';
import type { Theme } from '../../core/types/theme';
import type { TextMeasurer } from '../../core/text';
import { a11ySurfaceStyle } from '../a11ySurface';
import { useIsomorphicLayoutEffect } from '../useIsomorphicLayoutEffect';
import { isFullGeometry, type PreparedChart, type RenderGeometry } from '../prepared';
import { SceneRenderer } from '../SceneRenderer';
import { KEY_PARTS, highlightScene, outlineScene, recordBounds } from './highlight';
import { hitTestRecords } from './hitTest';
import { cardSurface, describedWithCard, followSeat, hundredPercentComposition, labelCardGeometry, layoutLabelCard,
  labelCardContent, layoutLabelCardContent, nearPath, placeLabelCard, pointsHull, sharedLabelCardContent, shouldShowTableLabelCard, withPeriodEvents, stackKey, type CardSide, type CompositionOptions, type LabelCardContent, type LabelCardInput, type LabelCardLayout, type LabelCardOptions } from './labelCard';
import { cardTitle, keyOrder, metricName, panelNames, stackSeries } from './cardRows';
import { chartString as funnelString } from '../../core/strings/funnel';
import { activeLabelBounds, overlayInputs, panelAtPoint, panelOverlayTheme, type HoverViewport, type OverlayInputs } from './placement';
import { tableSparklineCard } from './sparklineCard';
import { interactionTokens } from '../../core/a11y/theme';
import { chartString } from '../../core/strings/hover';
import { boundsOf, rectContains, type Point, type Rect, type Size } from '../../core/geometry';


export interface HoverModel {
  records: InteractionRecord[];
  placement?: OverlayInputs;
  occupied?: (OccupiedRect & { filled: boolean })[];
  /** One drawn model owns the records, locale, composition and scene used to format these cards, keyed by their record ids. */
  cardRows?: Map<string, LabelCardContent>;
  /** The drawn legend's series ids, in its order. */
  legend?: string[];
  /** The series that are parts of a stack in some category (`stackKey`). */
  stackSeries?: Set<string>;
  /** Each record's place in the key, which a card with several series follows (`keyOrder`). */
  order?: Map<InteractionRecord, number>;
  /** A grid's records by category, for the card that lists a category across its panels (`cardRecords`). */
  panelPeers?: Map<string, InteractionRecord[]>;
  /** A grid's panel paths in drawn order (`panelPaths`). */
  panelPaths?: string[];
  /** Whether each grid panel draws a 100 % composition, by panel path. */
  panelHundred?: Map<string, boolean>;
  /** A grid's panel titles by panel path (`panelNames`). */
  panelNames?: Map<string, string>;
  panelLocales?: ReadonlyMap<string, string>;
  markBounds?: Map<InteractionRecord, Rect | undefined>;
}

/** `keyboard`: the active records hold the keyboard focus; they keep an outline even where the highlight is off. */
export interface HoverFlags { card: boolean; highlight: boolean; keyboard?: boolean }

export interface HoverView extends RenderGeometry {
  /** Separate CSS-pixel layout for the body portal; never appended to scene. */
  card?: LabelCardLayout;
  cardTheme?: Theme;
  /** The seat inputs of the open card, for a host's own card content that is measured after it renders. */
  cardInput?: LabelCardInput;
  /** The records the open card covers, the pointed record first. */
  active?: InteractionRecord[];
  panel?: string;
}

export interface HoverPosition {
  viewport?: HoverViewport;
  panel?: string;
  previousSide?: CardSide;
  /** A mouse or pen opened the default card: it follows the pointer instead of taking a seat beside the mark. */
  follow?: boolean;
  /** The hover of another chart of the group put these records here: not this chart's own hover. */
  linked?: boolean;
}

interface HoverMeasurement {
  host: HTMLElement;
  size: Size;
  viewport?: HoverViewport;
  pointer?: { clientX: number; clientY: number };
}
export interface HoverSelection { ids: readonly string[]; position?: HoverPosition; measurement?: HoverMeasurement }

/** The hosts of charts inside a `HoverGroup`: their cards stay inside their own chart, so the cards of two charts never meet. */
export const framedHosts = new WeakSet<HTMLElement>();

/** Measure on open or a scroll/resize update, never on an already open pointer move. */
export function hoverViewport(host: HTMLElement, size: Size, pointer?: { clientX: number; clientY: number }): HoverViewport | undefined {
  const svg = host.querySelector('svg');
  const win = host.ownerDocument.defaultView;
  if (!svg || !win) return undefined;
  const box = svg.getBoundingClientRect();
  const scale = Math.min(box.width / size.width, box.height / size.height);
  if (!(scale > 0)) return undefined;
  const x = box.left + (box.width - size.width * scale) / 2;
  const y = box.top + (box.height - size.height * scale) / 2;
  // 8 px inside the window, and inside the chart's own frame for a chart of a group.
  const inset = framedHosts.has(host) ? 8 / scale : -Infinity;
  const left = Math.max((8 - x) / scale, inset), top = Math.max((8 - y) / scale, inset);
  return { scale, origin: { x, y },
    boundary: { x: left, y: top,
      w: Math.max(0, Math.min((win.innerWidth - 8 - x) / scale, size.width - inset) - left),
      h: Math.max(0, Math.min((win.innerHeight - 8 - y) / scale, size.height - inset) - top) },
    pointer: pointer ? { x: (pointer.clientX - x) / scale, y: (pointer.clientY - y) / scale } : undefined };
}

/** Keep DOM measurement and card checks in the engine chunk, off each chart's initial load. */
export function hoverSelection(model: HoverModel, request: ResolvedChartRequest, event: PointerEvent<HTMLElement> | FocusEvent<HTMLElement>,
  view: HoverView, selection: HoverSelection, custom = false, along = false): HoverSelection {
  const source = 'clientX' in event ? event : undefined;
  const measurement = selection.measurement?.host === event.currentTarget ? selection.measurement
    : { host: event.currentTarget, size: view.size, viewport: hoverViewport(event.currentTarget, view.size) };
  measurement.pointer = source && { clientX: source.clientX, clientY: source.clientY };
  const viewport = pointedViewport(measurement);
  // A touch reports every move at the element it began on: a sliding finger is read by its position alone.
  const element = !along && event.target instanceof Element ? event.target.closest('[data-id]') : null;
  // A host that draws its own card content opens it on a record with no default card too.
  const next = hoverTargets(model, request, { nodeId: element?.getAttribute('data-id') ?? undefined,
    point: viewport?.pointer }, custom).map(record => record.id);
  if (!source && !next.length) return selection;
  // A mouse or pen moves the default card with the pointer; a tap, the keyboard and a host's own card keep the seat beside the mark.
  const follow = !custom && source !== undefined && 'pointerType' in source && source.pointerType !== 'touch';
  // Reuse the selection while the records stay. A seat beside the mark is reused only while it stays clear of the pointer;
  // a following card never covers the pointer, and the move itself goes to `cardFollower`, outside React.
  if (measurement === selection.measurement && !selection.position?.linked && next.length === selection.ids.length
    && next.every((id, index) => id === selection.ids[index]) && (selection.position?.follow ?? false) === follow
    && (follow || !(view.card && viewport?.pointer && rectContains(view.card.rect, {
      x: viewport.pointer.x * viewport.scale, y: viewport.pointer.y * viewport.scale, w: 0, h: 0,
    })))) return selection;
  return { ids: next, measurement: next.length ? measurement : undefined,
    position: { viewport, panel: view.panel, previousSide: view.card?.side, follow } };
}

/** The pause between two pointer-driven moves of the card, in milliseconds; the card's travel transition fills the frames between. */
const FOLLOW_INTERVAL = 50;

export interface CardFollower {
  /** Move the open card to follow the pointer at client (x, y): at once, then at most once per `FOLLOW_INTERVAL`, always ending at the last point. */
  move(node: HTMLElement | null, selection: HoverSelection, size: Size, x: number, y: number): void;
  /** Drop a pending move: the records changed, the keyboard took over or the card closed. */
  cancel(): void;
}

/**
 * The pointer card's mover. A move within one record writes the card's
 * `translate` directly, so the chart SVG and the card's content do not render
 * again. The card's CSS transition animates each move.
 */
export function cardFollower(): CardFollower {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: (() => void) | undefined;
  const run = () => { timer = undefined; last = Date.now(); const apply = pending; pending = undefined; apply?.(); };
  return {
    move(node, selection, size, x, y) {
      const viewport = selection.measurement?.viewport;
      if (!node || !viewport || !selection.position?.follow) return;
      pending = () => {
        if (!node.isConnected) return;
        const { scale, origin } = viewport;
        const seat = followSeat({ x: x - origin.x, y: y - origin.y }, parseFloat(node.style.width) || 0, parseFloat(node.style.height) || 0,
          { x: 0, y: 0, w: size.width * scale, h: size.height * scale },
          { x: viewport.boundary.x * scale, y: viewport.boundary.y * scale, w: viewport.boundary.w * scale, h: viewport.boundary.h * scale });
        node.style.translate = `${seat.x + origin.x}px ${seat.y + origin.y}px`;
      };
      const win = node.ownerDocument.defaultView;
      // Without motion, each move shows at once: a pause would read as a stutter.
      if (win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { run(); return; }
      const wait = last + FOLLOW_INTERVAL - Date.now();
      if (wait <= 0 && timer === undefined) run();
      else timer ??= setTimeout(run, Math.max(0, wait));
    },
    cancel() { if (timer !== undefined) clearTimeout(timer); timer = undefined; pending = undefined; },
  };
}

/**
 * The record a click names: the hover card's pointed record under the same
 * pointer. A click on a series key (its name label, its legend entry) names
 * the series, not a record, and answers undefined.
 */
export function clickedRecord(model: HoverModel, request: ResolvedChartRequest, event: MouseEvent<HTMLElement>, view: HoverView): InteractionRecord | undefined {
  const element = event.target instanceof Element ? event.target.closest('[data-id]') : null;
  if (element && KEY_PARTS.has(element.getAttribute('data-part') ?? '')) return undefined;
  const viewport = hoverViewport(event.currentTarget, view.size, event);
  return hoverTargets(model, request, { nodeId: element?.getAttribute('data-id') ?? undefined, point: viewport?.pointer }, true)
    .find(activates);
}

/** Only data records call `onRecordClick`, from the pointer and the keyboard: an annotation is read, not drilled into. */
export function activates(record: InteractionRecord): boolean {
  return record.target.owner.annotationId === undefined;
}

function pointedViewport({ viewport, pointer }: HoverMeasurement): HoverViewport | undefined {
  return viewport && { ...viewport, pointer: pointer ? {
    x: (pointer.clientX - viewport.origin.x) / viewport.scale,
    y: (pointer.clientY - viewport.origin.y) / viewport.scale,
  } : undefined };
}

/** Keep listeners and measurement work in the lazy engine, outside the pointer path. */
export function watchHover(selection: HoverSelection, setSelection: Dispatch<SetStateAction<HoverSelection>>, size: Size): (() => void) | undefined {
  const measurement = selection.measurement;
  const win = measurement?.host.ownerDocument.defaultView;
  if (!measurement || !win || !selection.ids.length) return;
  const { host } = measurement;
  let pending: number | undefined;
  let scrolled = false;
  // The card of a linked chart closes with the chart that owns the hover, never by a key or a tap of its own.
  const linked = selection.position?.linked === true;
  const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !linked) setSelection({ ids: [] }); };
  // A tap leaves no pointer to move away, so a pointer down outside the chart closes its card, as on a table.
  const outside = (event: globalThis.PointerEvent) => { if (!linked && !host.contains(event.target as Node)) setSelection({ ids: [] }); };
  const update = (event?: Event) => {
    if (event?.type === 'scroll') scrolled = true;
    if (pending !== undefined) return;
    pending = win.requestAnimationFrame(() => {
      pending = undefined;
      const moved = scrolled;
      scrolled = false;
      const viewport = hoverViewport(host, size);
      if (JSON.stringify(viewport) === JSON.stringify(measurement.viewport)) return;
      measurement.viewport = viewport;
      measurement.size = size;
      // A scroll moves another mark under a pointer that stays still, so a card at the pointer would name the wrong record.
      // It closes, and the next pointer move opens the card of the mark under the pointer.
      setSelection(current => current.measurement !== measurement ? current
        : moved && current.position?.follow ? { ids: [] }
        : { ...current, position: { ...current.position, viewport: pointedViewport(measurement) } });
    });
  };
  host.ownerDocument.addEventListener('keydown', escape);
  host.ownerDocument.addEventListener('pointerdown', outside, true);
  win.addEventListener('scroll', update, { capture: true, passive: true });
  win.addEventListener('resize', update);
  const observer = typeof win.ResizeObserver === 'undefined' ? undefined : new win.ResizeObserver(() => update());
  observer?.observe(host);
  const svg = host.querySelector('svg');
  if (svg) observer?.observe(svg);
  if (measurement.size.width !== size.width || measurement.size.height !== size.height) update();
  return () => {
    host.ownerDocument.removeEventListener('keydown', escape);
    host.ownerDocument.removeEventListener('pointerdown', outside, true);
    win.removeEventListener('scroll', update, true);
    win.removeEventListener('resize', update);
    observer?.disconnect();
    if (pending !== undefined) win.cancelAnimationFrame(pending);
  };
}

/** What the pointer rests on, read from the DOM by the caller. */
export interface HoverPick {
  nodeId?: string;
  /** The `data-part` of the element under the pointer. */
  part?: string;
  /** Pointer position in SVG layout units. */
  point?: { x: number; y: number };
}

/** Records and placement inputs of the drawn view: computed from full geometry, else read from the prepared snapshot. */
export function hoverModel(request: ResolvedChartRequest, geometry: RenderGeometry, prepared?: PreparedChart): HoverModel {
  const model = isFullGeometry(geometry)
    ? { records: interactionRecords({ request, geometry, scope: request.scope, claims: [] }), placement: overlayInputs(request, geometry) }
    : { records: prepared?.records ?? [], placement: prepared?.overlay };
  const legend = (geometry as { legend?: { items: { id: unknown }[] } }).legend?.items.map(item => String(item.id));
  const panelLocales = model.placement?.panelLocales;
  return { ...model, occupied: hoverOccupied(model, geometry), cardRows: new Map(), markBounds: new Map(),
    ...(panelLocales ? { panelLocales: new Map(panelLocales) } : {}), ...legend?.length ? { legend } : {} };
}

/**
 * How the card of `first` words its rows: the composition its chart draws,
 * the period its category names, the metric a sparkline names, and the key's
 * order. The pointer's card and the keyboard's reading share it.
 */
export function cardOptions(model: HoverModel, request: ResolvedChartRequest, first: InteractionRecord): LabelCardOptions {
  const panel = first.target.panel === undefined ? undefined : model.placement?.panels?.find(entry => entry.panel === first.target.panel);
  // A panel projects the option keys this question needs, so a panel's card
  // words its share exactly as the same chart would on its own.
  const panels = panelPaths(model);
  return { hundredPercent: hundredPercentComposition(panel?.type ?? request.type, panel ? panel.composition : request.options as CompositionOptions),
    title: cardTitle(request, first, model.records), name: metricName(request, first.target.panel, first.target.owner.seriesId),
    order: model.order ??= keyOrder(request, model.records, model.legend, panels),
    stackSeries: model.stackSeries ??= new Set([...model.records.filter(record => record.share).map(stackKey),
      ...stackSeries(request, [undefined, ...model.placement?.panels?.map(entry => entry.panel) ?? []])]),
    panelNames: model.panelNames ??= panelNames(request, panels),
    panelLocales: model.panelLocales,
    // Each panel words its own shares: parts that sum to 100 print no Total on a 100 % panel, a stacked panel prints it.
    ...model.placement?.panels ? { panelHundred: model.panelHundred ??= new Map(model.placement.panels.map(entry =>
      [entry.panel, hundredPercentComposition(entry.type, entry.composition)])) } : {},
    ...(panel?.type ?? request.type) === 'funnel' ? { conversionName: conversionName(request, first.target.panel) } : {} };
}

/**
 * A funnel's word for its stage conversion, as the chart prints it: a
 * centered funnel's column head ("Step conversion"), else the word of its
 * labels ("12% advance" names "Advance").
 */
function conversionName(request: ResolvedChartRequest, panel: string | undefined): string | undefined {
  let options: object = request.options;
  for (const id of panel?.split('/') ?? []) {
    const child = ((options === request.options ? request.data : undefined) as { panels?: { id?: unknown; options?: object }[] } | undefined)?.panels?.find(entry => entry.id === id);
    if (child?.options) options = { ...child.options, locale: request.options.locale };
  }
  const wording = options as Parameters<typeof funnelString>[0];
  if ((options as { variant?: unknown }).variant === 'centered') return funnelString(wording, 'stepCvr');
  const word = funnelString(wording, 'stageAdvance', { v1: '\u0000' }).replace('\u0000', '').trim();
  return word ? word.replace(/^\p{L}/u, letter => letter.toLocaleUpperCase()) : undefined;
}

/**
 * A grid's panel paths in the order a reader takes them: row by row from the
 * top, left to right in a row (a tier drawn above its first panel comes
 * first). A metric stack, whose panels the placement does not list, in record order.
 */
function panelPaths(model: HoverModel): string[] {
  if (model.panelPaths) return model.panelPaths;
  const placed = model.placement?.panels;
  if (!placed) return model.panelPaths = [...new Set(model.records.flatMap(record => record.target.panel ?? []))];
  const byTop = [...placed].sort((a, b) => a.plot.y - b.plot.y || a.plot.x - b.plot.x);
  const rows: (typeof placed)[number][][] = [];
  for (const entry of byTop) {
    const row = rows.at(-1);
    // Panels whose plots overlap by half the shorter height stand in one row.
    if (row && entry.plot.y < Math.min(...row.map(other => other.plot.y + other.plot.h / 2))) row.push(entry); else rows.push([entry]);
  }
  return model.panelPaths = rows.flatMap(row => row.sort((a, b) => a.plot.x - b.plot.x).map(entry => entry.panel));
}

/** A record that stands for other categories or series (a generated Others bucket): two panels give it one id for different members. */
export function pooled({ members, target: { owner } }: InteractionRecord): boolean {
  // A category record lists its series as members; only a series record whose members are other series is pooled.
  return members?.some(member => member.categoryId !== owner.categoryId
    || (owner.seriesId !== undefined && member.seriesId !== undefined && member.seriesId !== owner.seriesId)) === true;
}

/**
 * The records the card lists: the hovered ones, and on a grid of several
 * panels that band their categories (columns, bars, lines, combos) the
 * hovered category in every other such panel, all its series as the
 * panel's own card lists them, so one card reads the week across the
 * panels. Only the card lists them: the highlight, `onHoverChange` and a
 * host's `context.records` keep the hovered records. Only numbers are
 * listed across panels, and never a generated Others bucket.
 */
export function cardRecords(model: HoverModel, active: InteractionRecord[]): InteractionRecord[] {
  const first = active[0];
  const categoryId = first?.target.owner.categoryId;
  const panels = panelPaths(model);
  if (!first || categoryId === undefined || first.target.panel === undefined || first.target.owner.annotationId !== undefined
    || first.target.owner.seriesId === undefined || first.value.kind !== 'number' || panels.length < 2 || pooled(first)) return active;
  const typeOf = (panel: string) => model.placement?.panels?.find(entry => entry.panel === panel)?.type;
  // A metric stack's panels hold one measure each; the placement lists none of them.
  const banded = (panel: string) => !model.placement?.panels || bandTypes[typeOf(panel) ?? ''] !== undefined;
  if (!banded(first.target.panel)) return active;
  let byCategory = model.panelPeers;
  if (!byCategory) {
    byCategory = model.panelPeers = new Map();
    for (const record of model.records) {
      const { owner } = record.target;
      if (owner.categoryId === undefined || owner.seriesId === undefined || owner.pointId !== undefined || owner.rowId !== undefined
        || owner.annotationId !== undefined || record.target.panel === undefined || record.cardFields?.length === 0
        // A panel of states (a status grid) has no value to read across the panels.
        || record.value.kind !== 'number' || pooled(record)) continue;
      const list = byCategory.get(owner.categoryId);
      if (list) list.push(record); else byCategory.set(owner.categoryId, [record]);
    }
  }
  const shown = new Set(active);
  const peers: InteractionRecord[] = [];
  for (const panel of panels) {
    if (panel === first.target.panel || !banded(panel)) continue;
    const candidates = (byCategory.get(categoryId) ?? []).filter(record => record.target.chart === first.target.chart && record.target.panel === panel);
    const hit = candidates.find(record => record.value.state === 'value') ?? candidates[0];
    if (!hit) continue;
    // The panel's series as its own card lists them: a line that has ended stays out.
    for (const record of [hit, ...categorySiblings(model.records, hit, true, typeOf(panel) === 'line')]) {
      if (!shown.has(record) && candidates.includes(record)) { shown.add(record); peers.push(record); }
    }
  }
  return peers.length ? [...active, ...peers] : active;
}

/** Filled-mark ownership depends on the drawn scene, not the active card. */
function hoverOccupied(model: HoverModel, geometry: RenderGeometry) {
  const occupied = model.placement?.occupied ?? (isFullGeometry(geometry) ? geometry.debug.occupied : []);
  const markIds = new Set(model.records.flatMap(record => record.nodeIds));
  const owners = new Map<keyof OwnerRef, Map<Id | undefined, OwnerRef[]>>();
  for (const node of geometry.scene) {
    if (!markIds.has(node.id) || !(node.t === 'image' || ((node.t === 'rect' || node.t === 'path') && (node.fill || node.pattern)))
      || /marker/i.test(node.part ?? '')) continue;
    // A match must agree on this field before any other owner fields matter.
    const key = (Object.keys(node.owner) as (keyof OwnerRef)[]).at(-1);
    if (key === undefined) continue;
    let byId = owners.get(key);
    if (byId === undefined) owners.set(key, byId = new Map());
    const id = node.owner[key];
    const group = byId.get(id);
    if (group === undefined) byId.set(id, [node.owner]);
    else group.push(node.owner);
  }
  const filled = (owner: OwnerRef) => {
    for (const [key, byId] of owners) {
      if (byId.get(owner[key])?.some(required => ownerContains(owner, required))) return true;
    }
    return false;
  };
  return occupied.map(item => ({ ...item, filled: filled(item.owner) }));
}

/** Forced-colors and contrast rules for the hover outline and card. */
export const surfaceStyle = a11ySurfaceStyle;

/** Chart types whose pointer position selects a category band before the nearest mark. */
export const bandTypes: Record<string, 'x' | 'y'> = { line: 'x', combo: 'x', column: 'x', bar: 'y' };

const paths = new WeakMap<HoverModel, Map<string | undefined, Point[]>>();

/**
 * The convex hull of the points a reader moves the pointer between, in
 * layout units: the points of a line, an area or a combo's lines, and of a
 * sparkline. These charts pick a point by the pointer's position along the
 * axis, so a card in this area would stand in the pointer's way.
 */
function pointsPath(model: HoverModel, type: string, record: InteractionRecord): Point[] | undefined {
  const sparkline = type === 'sparkline';
  if (!sparkline && bandTypes[type] === undefined) return undefined;
  let byPanel = paths.get(model);
  if (!byPanel) paths.set(model, byPanel = new Map());
  const key = record.target.panel;
  let hull = byPanel.get(key);
  if (!hull) {
    hull = pointsHull(model.records.flatMap(other => other.target.chart === record.target.chart && other.target.panel === key
      && other.target.owner.annotationId === undefined && other.anchor && (sparkline || !('w' in other.anchor))
      ? [{ x: other.anchor.x + ('w' in other.anchor ? other.anchor.w / 2 : 0), y: other.anchor.y + ('h' in other.anchor ? other.anchor.h / 2 : 0) }] : []));
    byPanel.set(key, hull);
  }
  return hull.length ? hull : undefined;
}

/**
 * The records the pointer addresses. A node owned by records of several series
 * (the shared end label of series ending on one printed value) addresses all
 * of them, so the card lists every member. Otherwise the nearest record wins,
 * and on a chart with a category band (column, bar, line, area, combo) it
 * brings the other series of its category along: the card of one week reads
 * spend and CPA together, the pointed series first, instead of one number
 * the reader then has to pair with the neighbouring mark by eye.
 */
export function hoverTargets(model: HoverModel, request: ResolvedChartRequest, pick: HoverPick, activation = false): InteractionRecord[] {
  const { placement } = model;
  // A record with no card fields (a diagram node that prints all it carries) is never hovered, but a click still names it.
  const records = activation ? model.records : model.records.filter(record => record.cardFields?.length !== 0);
  // A metric stack's focus look: the pointer's column of the plots names its category, wherever the pointer is in it.
  if (placement?.focusBand) return pick.point ? focusBandTargets(records, placement.focusBand, pick.point) : [];
  // Over the dotted line of an event that sits on a category, the pointer reads the period under it: its card lists the event.
  const rule = !activation && pick.nodeId?.endsWith(':rule') && records.some(record => record.event?.categoryId !== undefined && record.nodeIds.includes(pick.nodeId!));
  const owners = pick.nodeId === undefined || rule ? [] : records.filter(record => record.nodeIds.includes(pick.nodeId!));
  if (new Set(owners.map(record => record.target.owner.seriesId)).size > 1) return owners;
  const nodeRecord = owners[0];
  const panel = nodeRecord?.target.panel
    ? placement?.panels?.find(entry => entry.panel === nodeRecord.target.panel)
    : pick.point ? panelAtPoint(placement?.panels ?? [], pick.point) : undefined;
  const type = panel?.type ?? request.type;
  const scope = nodeRecord?.target ?? (panel ? { ...request.scope, panel: panel.panel } : request.scope);
  const hit = hitTestRecords(records, {
    scope: { chart: scope.chart, panel: scope.panel },
    nodeId: nodeRecord ? pick.nodeId : undefined, point: pick.point, bounds: panel?.plot ?? placement?.plot,
    band: bandTypes[type], radius: (panel ? panelOverlayTheme(panel, request.theme) : request.theme).space.labelPad * 2,
  });
  if (!hit) return [];
  return [hit, ...categorySiblings(records, hit, bandTypes[type] !== undefined, type === 'line')];
}

/**
 * The records of the category whose column of the focus band holds the
 * point, one per panel: the panel nearest the point first, then the others
 * in record order. Outside the band, none: the stack returns to rest.
 */
function focusBandTargets(records: readonly InteractionRecord[], band: NonNullable<OverlayInputs['focusBand']>, point: Point): InteractionRecord[] {
  if (!rectContains(band.rect, { ...point, w: 0, h: 0 })) return [];
  const categories = [...new Set(records.flatMap(record => record.target.owner.categoryId !== undefined && record.target.owner.annotationId === undefined
    ? [record.target.owner.categoryId] : []))];
  if (!categories.length) return [];
  const index = Math.min(categories.length - 1, Math.max(0, Math.floor((point.x - band.rect.x) / (band.rect.w / categories.length))));
  const hits = records.filter(record => record.target.owner.categoryId === categories[index] && record.target.owner.annotationId === undefined);
  const gap = (record: InteractionRecord) => {
    const plot = band.panels.find(entry => entry.panel === record.target.panel)?.plot;
    return plot ? Math.max(plot.y - point.y, 0, point.y - plot.y - plot.h) : Infinity;
  };
  const nearest = hits.reduce<InteractionRecord | undefined>((best, record) => !best || gap(record) < gap(best) ? record : best, undefined);
  return nearest ? [nearest, ...hits.filter(record => record !== nearest)] : [];
}

/**
 * The other series records of the hit's category, in record order: same
 * chart, same panel, same category, a series of their own. Only a chart
 * with a category band has them; a record without a category (a scatter
 * point, a KPI) or a chart without a band answers for itself.
 */
export function categorySiblings(records: readonly InteractionRecord[], hit: InteractionRecord, banded: boolean, omitEnded = false): InteractionRecord[] {
  const categoryId = hit.target.owner.categoryId;
  if (!banded || categoryId === undefined) return [];
  return records.filter(record => record !== hit
    && record.target.chart === hit.target.chart && record.target.panel === hit.target.panel
    && record.target.owner.categoryId === categoryId && record.target.owner.seriesId !== undefined
    && record.target.owner.pointId === undefined && record.target.owner.rowId === undefined
    && !(omitEnded && record.value.state === 'missing'
      && hit.anchor !== undefined
      && records.some(other => sameSeries(other, record) && other.value.state === 'value' && other.anchor !== undefined && other.anchor.x < hit.anchor!.x)
      && !records.some(other => sameSeries(other, record) && other.value.state !== 'missing' && other.anchor !== undefined && other.anchor.x > hit.anchor!.x)));
}

function sameSeries(a: InteractionRecord, b: InteractionRecord): boolean {
  return a.target.chart === b.target.chart && a.target.panel === b.target.panel && a.target.owner.seriesId === b.target.owner.seriesId;
}

/**
 * The drawn view with the hover applied: the highlight dims the other series
 * and outlines the hovered marks, the card lists the hovered records' facts.
 * The card has a separate layout for its HTML portal. The chart size stays
 * unchanged. DOM measurements enter as explicit inputs to this pure function.
 */
export function hoverView(
  model: HoverModel, request: ResolvedChartRequest, geometry: RenderGeometry, ids: readonly string[], flags: HoverFlags,
  position: HoverPosition = {},
): HoverView {
  const active = ids.flatMap(id => model.records.find(record => record.id === id) ?? []);
  if (active.length === 0) return geometry;
  // A linked chart draws a card only where its place was measured.
  if (position.linked) flags = { card: flags.card && position.viewport !== undefined, highlight: flags.highlight };
  const first = active[0]!;
  const placement = model.placement;
  const panel = placement?.panels?.find(entry => entry.panel === first.target.panel);
  // Card fonts do not follow the chart's width class.
  const theme = panel ? panelOverlayTheme(panel, request.theme) : request.theme;
  const locale = request.locale?.language;
  const occupied = model.occupied ?? hoverOccupied(model, geometry);
  const canvas = { x: 0, y: 0, w: geometry.size.width, h: geometry.size.height };
  const scale = position.viewport?.scale ?? 1;
  const cssPoint = (point: Point) => ({ x: point.x * scale, y: point.y * scale });
  const cssRect = (rect: Rect): Rect => ({ ...cssPoint(rect), w: rect.w * scale, h: rect.h * scale });
  const card = cardOptions(model, request, first);
  const pointer = position.viewport?.pointer && cssPoint(position.viewport.pointer);
  const base = { record: first, canvas,
    boundary: position.viewport && cssRect(position.viewport.boundary), chart: cssRect(canvas), pointer,
    theme, measure: request.fontMetrics, locale, idPrefix: 'hover-card', card };
  // A card that follows the pointer needs no seat beside the mark: skip the marks, labels and path the seat solver reads.
  const input: LabelCardInput = position.follow && pointer ? { ...base, occupied: [], follow: true } : (() => {
    const marks = active.map(record => {
      if (model.markBounds?.has(record)) return model.markBounds.get(record);
      // A rectangular anchor can be only the bar. Include its range rails,
      // caps and other mark nodes before taking this record's bounds.
      const anchor = record.anchor && 'w' in record.anchor ? record.anchor : undefined;
      const bounds = [anchor, recordBounds(anchor ? { ...record, anchor: undefined } : record, geometry.scene, occupied)]
        .filter(Boolean) as Rect[];
      const box = bounds.length ? boundsOf(bounds) : undefined;
      const mark = box && { x: box.x - (box.w ? 0 : 3), y: box.y - (box.h ? 0 : 3), w: box.w || 6, h: box.h || 6 };
      model.markBounds?.set(record, mark);
      return mark;
    });
    const bounds = [...marks.filter(Boolean) as Rect[], ...activeLabelBounds(active, geometry.scene, occupied)];
    return { ...base,
      occupied: occupied.map(item => ({ ...item, rect: cssRect(item.rect) })),
      target: marks[0] && cssRect(first.anchor && !('w' in first.anchor) ? boundsOf(marks.filter(Boolean) as Rect[]) : marks[0]),
      forbidden: bounds.map(cssRect),
      previousSide: position.panel === first.target.panel ? position.previousSide : undefined,
      band: first.target.owner.annotationId !== undefined ? undefined : bandTypes[panel?.type ?? request.type],
      path: first.target.owner.annotationId !== undefined ? undefined : pointsPath(model, panel?.type ?? request.type, first)?.map(cssPoint),
      mark: marks[0] && cssRect(marks[0]) };
  })();
  // The card formats values after layout: it follows the chart's smallValues mode and unit-only formats.
  const listed = flags.card ? cardRecords(model, active) : active;
  const layout = !flags.card ? undefined : withChartFormats(request.options, () => listed.length > 1
    ? layoutLabelCardContent(input, withPeriodEvents(sharedLabelCardContent(listed, locale, card, geometry.scene, model.cardRows), model.records, first))
    : layoutLabelCardContent(input, withPeriodEvents(labelCardContent(first, locale, card), model.records, first)));
  const scene = flags.highlight ? highlightScene(geometry.scene, model.records, active, theme)
    : flags.keyboard ? outlineScene(geometry.scene, model.records, active, theme) : geometry.scene;
  // Keep the chart's description fallback alongside the tooltip's reading.
  // The description goes back to its original text when the card closes.
  const a11y = layout ? { ...geometry.a11y, desc: describedWithCard(geometry.a11y.desc, layout.accessibleText) } : geometry.a11y;
  return { ...geometry, a11y, scene, card: layout, cardTheme: theme, ...(layout ? { cardInput: input, active } : {}), panel: first.target.panel };
}

/** The curve of the following card's glide: fast at first, then a soft landing, as the ECharts tooltip moves. */
const GLIDE_EASING = 'cubic-bezier(0.23, 1, 0.32, 1)';

/**
 * A card renders at 1 CSS pixel per layout unit, even on a scaled chart.
 *
 * `follow`: the card a mouse or pen opened. It stays one element while the
 * pointer moves, glides to each new seat over `motion.travel` and fades in and
 * out over `motion.fade`; `hidden` keeps it mounted and faded out for a short
 * while after it closes, so a card that opens again glides from where it was.
 */
export function ChartCard({ layout, theme, origin, cardRef, follow = false, hidden = false }: { layout: LabelCardLayout; theme: Theme; origin: Point;
  cardRef?: (node: HTMLDivElement | null) => void; follow?: boolean; hidden?: boolean }): ReactElement | null {
  // A scroll or resize moves the chart under a fixed card: the card moves with it at once, without trailing the page.
  const seen = useRef(origin);
  const scrolled = seen.current.x !== origin.x || seen.current.y !== origin.y;
  useIsomorphicLayoutEffect(() => { seen.current = origin; });
  if (!layout.scene.length) return null;
  const size: CSSProperties = { width: layout.rect.w, height: layout.rect.h, maxWidth: 'none',
    overflow: 'visible', boxSizing: 'content-box' };
  const motion = interactionTokens(theme);
  const fade = `${motion.fade}ms ${motion.easing}`;
  // A following card never stands under the pointer, so it lets the pointer through to every mark.
  // A card beside its mark clear of the points' path takes the pointer (WCAG 1.4.13): the hover handlers keep the open record while it is on it.
  // A card beside its mark over the path of a line, area, combo or sparkline lets the pointer through, so the reader reaches every point.
  const moving: CSSProperties = follow ? { pointerEvents: 'none', opacity: hidden ? 0 : 1, visibility: hidden ? 'hidden' : 'visible', willChange: 'translate',
    transition: `${scrolled ? '' : `translate ${motion.travel}ms ${GLIDE_EASING},`}opacity ${fade},visibility ${fade}` }
    : { pointerEvents: layout.overPath ? 'none' : 'auto' };
  const card = <div popover={topLayer() ? 'manual' : undefined} ref={node => { cardRef?.(node); showCard(node); }} data-bp-chart-card="" data-bp-card-overlay="" className="bp-interaction-card"
    role="tooltip" dir="ltr" aria-label={layout.accessibleText} aria-hidden={hidden || undefined}
    style={{ ...cardStyle(layout.rect, theme, origin, 'bp-chart-card-in', true), ...moving, ...size }}>
    <SceneRenderer geometry={labelCardGeometry(layout)} theme={theme} responsive={false} style={size} />
  </div>;
  // Keep the portal fallback where showPopover is missing.
  return topLayer() ? card : createPortal(card, document.body);
}

/** The elements Tab can reach inside a host's card content. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

const VISUALLY_HIDDEN: CSSProperties = { position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden',
  clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 };

/**
 * A host's own card content (`renderHoverContent`). It renders hidden first,
 * is measured, and then takes the seat the label card's solver gives a box of
 * that size. Unlike the label card it takes the pointer, so a link in it can
 * be clicked, and it is never portalled: in the top layer it stays a DOM child
 * of the chart, and without popover support it sits in the chart's own box,
 * so Tab reaches it right after the chart's keyboard stop.
 *
 * It is a non-modal dialog named by the record. `contentId` names the node
 * the keyboard stop's option is described by; where the content holds a
 * focusable element, that node ends with a Tab hint for a screen reader.
 */
export function CustomCard({ input, theme, origin, label, contentId, locale, cardRef, children }: {
  input: LabelCardInput; theme: Theme; origin?: Point; label: string; contentId: string; locale?: string;
  cardRef?: (node: HTMLDivElement | null) => void; children: ReactNode;
}): ReactElement {
  const box = useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState<{ size: Size; focusable: boolean; inline?: Point }>();
  const boundary = input.boundary;
  useIsomorphicLayoutEffect(() => {
    const node = box.current;
    const win = node?.ownerDocument.defaultView;
    if (!node || !win) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      const inline = topLayer() ? undefined : inlineOrigin(node, input.canvas);
      const next = { size: { width: Math.ceil(rect.width), height: Math.ceil(rect.height) }, focusable: node.querySelector(FOCUSABLE) !== null, inline };
      setMeasured(current => current && current.size.width === next.size.width && current.size.height === next.size.height
        && current.focusable === next.focusable && current.inline?.x === inline?.x && current.inline?.y === inline?.y ? current : next);
    };
    measure();
    const observer = typeof win.ResizeObserver === 'undefined' ? undefined : new win.ResizeObserver(measure);
    observer?.observe(node);
    return () => observer?.disconnect();
  }, [children, input.canvas]);
  const seat = useMemo(() => measured && placeLabelCard(input, measured.size.width, measured.size.height, true).rect, [input, measured]);
  const offset = topLayer() ? origin : measured?.inline;
  const surface = cardSurface(theme);
  const style: CSSProperties = { ...(seat && offset ? cardStyle(seat, theme, offset, 'bp-chart-card-in')
    : { position: topLayer() ? 'fixed' : 'absolute', left: 0, top: 0, margin: 0, border: 0, padding: 0, visibility: 'hidden', background: surface.fill }),
    width: 'max-content', boxSizing: 'border-box', pointerEvents: 'auto', overflow: 'auto',
    ...(boundary ? { maxWidth: Math.max(0, boundary.w), maxHeight: Math.max(0, boundary.h) } : {}),
    color: theme.color.ink, fontFamily: theme.type.family, fontSize: 12, lineHeight: 1.35,
    ['--bp-card-pad-x' as string]: `${CARD_PAD.x}px`, ['--bp-card-pad-y' as string]: `${CARD_PAD.y}px`,
    ['--bp-card-ink' as string]: theme.color.ink, ['--bp-card-muted' as string]: theme.color.inkMuted,
    ['--bp-card-rule' as string]: theme.color.rule ?? theme.color.grid };
  const ref = (node: HTMLDivElement | null) => { box.current = node; cardRef?.(node); showCard(node); };
  return <div popover={topLayer() ? 'manual' : undefined} ref={ref} data-bp-custom-card="" data-bp-card-overlay=""
    className="bp-interaction-card" role="dialog" aria-label={label} dir="ltr" style={style}>
    <div id={contentId}>{children}{measured?.focusable && <span style={VISUALLY_HIDDEN}>{chartString({ locale: { language: locale } }, 'cardTabHint')}</span>}</div>
  </div>;
}

/** The label card's padding, which a host's own content reads as `--bp-card-pad-x` and `--bp-card-pad-y`. */
const CARD_PAD = { x: 10, y: 8 };

/** Where the drawn chart's origin sits inside the chart's own box, for a card placed there without the top layer. */
function inlineOrigin(node: HTMLElement, canvas: Rect): Point | undefined {
  const host = node.offsetParent;
  const svg = host?.querySelector('svg');
  if (!host || !svg || !(canvas.w > 0) || !(canvas.h > 0)) return undefined;
  const box = svg.getBoundingClientRect();
  const frame = host.getBoundingClientRect();
  const scale = Math.min(box.width / canvas.w, box.height / canvas.h);
  return { x: box.left + (box.width - canvas.w * scale) / 2 - frame.left, y: box.top + (box.height - canvas.h * scale) / 2 - frame.top };
}

/**
 * Whether `point` lies in the corridor from `from`, where the pointer was
 * when the open record was picked, to the card `card`: the convex hull of the
 * point and the box. A pointer on its way to the card crosses other marks;
 * inside the corridor the open card stays. Client pixels.
 *
 * A pointer on the points' path (`path`, CSS pixels from the chart's
 * `origin`) is on its way to another point, not to the card: there the
 * pointer picks again, so the card never holds a point the pointer has left.
 */
export function inCardCorridor(from: Point, card: Rect, point: Point, path?: readonly Point[], origin: Point = { x: 0, y: 0 }): boolean {
  if (rectContains(card, { ...point, w: 0, h: 0 }, 0)) return true;
  if (path && nearPath(path, { x: point.x - origin.x, y: point.y - origin.y })) return false;
  const corners: Point[] = [{ x: card.x, y: card.y }, { x: card.x + card.w, y: card.y },
    { x: card.x + card.w, y: card.y + card.h }, { x: card.x, y: card.y + card.h }];
  const side = (a: Point, b: Point, p: Point) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  return corners.some((corner, index) => {
    const next = corners[(index + 1) % 4]!;
    const d1 = side(from, corner, point); const d2 = side(corner, next, point); const d3 = side(next, from, point);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  });
}

function topLayer(): boolean { return typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype; }
function showCard(node: HTMLDivElement | null): void { node?.showPopover?.(); }

/**
 * `fixed` seats the card at viewport coordinates, as the top layer does. Without it, a card outside the top layer
 * is absolute in its containing block and `offset` is the chart's origin there.
 */
function cardStyle(rect: Rect, theme: Theme, offset: Point = { x: 0, y: 0 }, animation = 'bp-card-in', fixed = topLayer()): CSSProperties {
  const motion = interactionTokens(theme);
  const surface = cardSurface(theme);
  return { position: fixed ? 'fixed' : 'absolute', margin: 0, inset: 'auto', border: 0, padding: 0,
    ...(fixed ? { left: 0, top: 0, translate: `${rect.x + offset.x}px ${rect.y + offset.y}px` }
      : { left: rect.x + offset.x, top: rect.y + offset.y }), width: rect.w,
    borderRadius: surface.radius, background: surface.fill,
    boxShadow: surface.flat ? 'none' : `0 4px 16px color-mix(in srgb, ${theme.color.ink} 14%, transparent)`,
    pointerEvents: 'none', zIndex: 8, animation: `${animation} ${motion.fade}ms ${motion.easing}` };
}

export interface TableCardAnchor { x: number; y: number; w: number; h: number }

/**
 * Place the card inside the visible frame, clear of its row and with the
 * least text covered. Without a measured anchor, keep the block after the
 * table. A cell whose card only repeats its printed value gets none.
 * The slot follows the reading direction; the card stays ltr.
 */
export function TableCard({ record, width, theme, palette, locale, measure, direction, anchor, pointer, frame, occupied = [], forbidden, tableBounds, variant = 'label', table, columns, inlineVisibility, container, offset, styleNonce, formats }: {
  record: InteractionRecord; width: number; theme: Theme; locale?: string; measure?: TextMeasurer; direction: 'ltr' | 'rtl';
  /** The table's options.palette, for the tone text the card prints. */
  palette?: string;
  /** The table's options: the card formats after layout, in their smallValues mode and unit-only formats. */
  formats?: { smallValues?: SmallValues };
  anchor?: TableCardAnchor; frame?: { w: number; h: number };
  pointer?: Point;
  occupied?: readonly OccupiedRect[];
  forbidden?: readonly Rect[];
  tableBounds?: Rect;
  /** 'sparkline' draws the row's trend across its column group instead of the record's facts. */
  variant?: 'label' | 'sparkline';
  table?: ResolvedTable;
  columns?: readonly ResolvedColumn[];
  inlineVisibility?: Record<string, boolean>;
  /**
   * Where a placed card renders: a portal into this element, at
   * `offset` (the frame's position in it) plus the solver's rect, so a
   * glass or `overflow: hidden` ancestor of the table neither traps nor
   * cuts it. Without one the card stays in the frame.
   */
  container?: HTMLElement;
  offset?: { x: number; y: number };
  styleNonce?: string;
}): ReactElement | null {
  const css = useMemo(() => ({ __html: surfaceStyle(theme).replace(/</g, '\\3c ') }), [theme]);
  const placed = anchor !== undefined && frame !== undefined && frame.w > 0 && frame.h > 0;
  const laid = useMemo(() => withChartFormats(formats, () => {
    const canvas = placed ? { x: 0, y: 0, w: frame.w, h: frame.h } : { x: 0, y: 0, w: width, h: 0 };
    // The sparkline card answers for the row, not for the cell, so it draws
    // where the label card would have nothing to add — and nothing at all
    // where the row has no series worth a line.
    if (variant === 'sparkline') {
      if (table === undefined || columns === undefined) return undefined;
      return tableSparklineCard({
        record, table, columns, theme, canvas, occupied, forbidden, tableBounds, direction, pointer,
        ...(palette === undefined ? {} : { palette }),
        ...(placed ? { target: anchor } : {}), measure,
        ...(inlineVisibility === undefined ? {} : { inlineVisibility }),
      });
    }
    if (!shouldShowTableLabelCard(record, record.value.displayed, locale)) return undefined;
    const layout = layoutLabelCard({ record, canvas, occupied, forbidden, tableBounds, pointer, target: placed ? anchor : undefined,
      slots: 'table', direction, theme, locale, measure });
    if (!layout.scene.length) return undefined;
    return { geometry: labelCardGeometry(layout), rect: layout.rect };
  }), [record, width, theme, locale, measure, placed, anchor, pointer, frame, occupied, forbidden, tableBounds, variant, table, columns, inlineVisibility, direction, formats]);
  if (!laid) return null;
  const portalled = !topLayer() && placed && container !== undefined && offset !== undefined;
  // Outside the top layer, a card in the document body is fixed to the viewport. A card in a container the host named stays in that container.
  const fixed = topLayer() || (portalled && container === container.ownerDocument.body);
  const slotStyle: CSSProperties | undefined = placed
    // 8, not 6: a host app can put a popover at 8-9 and
    // a sticky toolbar at 5, and a card under the toolbar would be
    // unreadable exactly where the reader is pointing.
    ? { ...cardStyle(laid.rect, theme, topLayer() ? { x: 8, y: 8 } : portalled ? offset : undefined, undefined, fixed),
      ...(laid.geometry.size.height > laid.rect.h ? { maxHeight: laid.rect.h, overflow: 'hidden' } as CSSProperties : {}) }
    : undefined;
  const slot = <div popover={placed && topLayer() ? 'manual' : undefined} ref={placed ? showCard : undefined} className="bp-interaction-card-slot" dir={direction} data-bp-interaction-card-slot="" data-bp-card={variant} style={slotStyle}>
    <style nonce={styleNonce} dangerouslySetInnerHTML={css} />
    <div role="tooltip" dir="ltr" className="bp-interaction-card" style={{ borderRadius: cardSurface(theme).radius }} aria-label={laid.geometry.a11y.desc} data-bp-card-for={record.id}>
      <SceneRenderer geometry={laid.geometry} theme={theme} responsive={false} />
    </div>
  </div>;
  // Keep the portal fallback where showPopover is missing.
  return portalled ? createPortal(slot, container) : slot;
}
