/**
 * The hover engine: records, hit test, label card and highlight for one
 * drawn chart. Chart components load this module on demand (`import()` in
 * `useHover`), independently of the accessible data table, and a host
 * bundler that splits dynamic imports ships it as its own chunk.
 */

import { type CSSProperties, useMemo, useRef, useState, type FocusEvent, type MouseEvent, type PointerEvent, type ReactElement, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { interactionRecords } from '../../core/a11y/records';
import { withSmallValues, type SmallValues } from '../../core/formatPrecision';
import { ownerContains } from '../../core/a11y/recordsShared';
export { tableRecords } from './dataTable';
export { labelCardGeometry } from './labelCard';
export { keyboardOrder, keyboardReading, keyboardSelection, keyboardStep } from './keyboard';
import type { InteractionRecord } from '../../core/a11y/types';
import type { ResolvedChartRequest } from '../../core/request';
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
import { cardSurface, describedWithCard, hundredPercentComposition, labelCardGeometry, layoutLabelCard,
  layoutLabelCardContent, placeLabelCard, sharedLabelCardContent, shouldShowTableLabelCard, type CardSide, type CompositionOptions, type LabelCardInput, type LabelCardLayout, type LabelCardRow } from './labelCard';
import { activeLabelBounds, overlayInputs, panelAtPoint, panelOverlayTheme, type HoverViewport, type OverlayInputs } from './placement';
import { tableSparklineCard } from './sparklineCard';
import { interactionTokens } from '../../core/a11y/theme';
import { chartString } from '../../core/strings/hover';
import { boundsOf, rectContains, type Point, type Rect, type Size } from '../../core/geometry';


export interface HoverModel {
  records: InteractionRecord[];
  placement?: OverlayInputs;
  occupied?: (OccupiedRect & { filled: boolean })[];
  /** One drawn model owns the records, locale, composition and scene used to format these rows. */
  cardRows?: Map<InteractionRecord, LabelCardRow[]>;
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
}

interface HoverMeasurement {
  host: HTMLElement;
  size: Size;
  viewport?: HoverViewport;
  pointer?: { clientX: number; clientY: number };
}
export interface HoverSelection { ids: readonly string[]; position?: HoverPosition; measurement?: HoverMeasurement }

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
  return { scale, origin: { x, y },
    boundary: { x: (8 - x) / scale, y: (8 - y) / scale,
      w: Math.max(0, win.innerWidth - 16) / scale, h: Math.max(0, win.innerHeight - 16) / scale },
    pointer: pointer ? { x: (pointer.clientX - x) / scale, y: (pointer.clientY - y) / scale } : undefined };
}

/** Keep DOM measurement and card checks in the engine chunk, off each chart's initial load. */
export function hoverSelection(model: HoverModel, request: ResolvedChartRequest, event: PointerEvent<HTMLElement> | FocusEvent<HTMLElement>,
  view: HoverView, selection: HoverSelection, custom = false): HoverSelection {
  const source = 'clientX' in event ? event : undefined;
  const measurement = selection.measurement?.host === event.currentTarget ? selection.measurement
    : { host: event.currentTarget, size: view.size, viewport: hoverViewport(event.currentTarget, view.size) };
  measurement.pointer = source && { clientX: source.clientX, clientY: source.clientY };
  const viewport = pointedViewport(measurement);
  const element = event.target instanceof Element ? event.target.closest('[data-id]') : null;
  // A host that draws its own card content opens it on a record with no default card too.
  const next = hoverTargets(model, request, { nodeId: element?.getAttribute('data-id') ?? undefined,
    point: viewport?.pointer }, custom).map(record => record.id);
  if (!source && !next.length) return selection;
  // Reuse the seat only while it stays clear of the pointer.
  if (measurement === selection.measurement && next.length === selection.ids.length
    && next.every((id, index) => id === selection.ids[index])
    && !(view.card && viewport?.pointer && rectContains(view.card.rect, {
      x: viewport.pointer.x * viewport.scale, y: viewport.pointer.y * viewport.scale, w: 0, h: 0,
    }))) return selection;
  return { ids: next, measurement: next.length ? measurement : undefined,
    position: { viewport, panel: view.panel, previousSide: view.card?.side } };
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
    x: (pointer.clientX - 8) / viewport.scale + viewport.boundary.x,
    y: (pointer.clientY - 8) / viewport.scale + viewport.boundary.y,
  } : undefined };
}

/** Keep listeners and measurement work in the lazy engine, outside the pointer path. */
export function watchHover(selection: HoverSelection, setSelection: Dispatch<SetStateAction<HoverSelection>>, size: Size): (() => void) | undefined {
  const measurement = selection.measurement;
  const win = measurement?.host.ownerDocument.defaultView;
  if (!measurement || !win || !selection.ids.length) return;
  const { host } = measurement;
  let pending: number | undefined;
  const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelection({ ids: [] }); };
  // A tap leaves no pointer to move away, so a pointer down outside the chart closes its card, as on a table.
  const outside = (event: globalThis.PointerEvent) => { if (!host.contains(event.target as Node)) setSelection({ ids: [] }); };
  const update = () => {
    if (pending !== undefined) return;
    pending = win.requestAnimationFrame(() => {
      pending = undefined;
      const viewport = hoverViewport(host, size);
      if (JSON.stringify(viewport) === JSON.stringify(measurement.viewport)) return;
      measurement.viewport = viewport;
      measurement.size = size;
      setSelection(current => current.measurement !== measurement ? current
        : { ...current, position: { ...current.position, viewport: pointedViewport(measurement) } });
    });
  };
  host.ownerDocument.addEventListener('keydown', escape);
  host.ownerDocument.addEventListener('pointerdown', outside, true);
  win.addEventListener('scroll', update, { capture: true, passive: true });
  win.addEventListener('resize', update);
  const observer = typeof win.ResizeObserver === 'undefined' ? undefined : new win.ResizeObserver(update);
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
  return { ...model, occupied: hoverOccupied(model, geometry), cardRows: new Map(), markBounds: new Map() };
}

/** Filled-mark ownership depends on the drawn scene, not the active card. */
function hoverOccupied(model: HoverModel, geometry: RenderGeometry) {
  const occupied = model.placement?.occupied ?? (isFullGeometry(geometry) ? geometry.debug.occupied : []);
  const markIds = new Set(model.records.flatMap(record => record.nodeIds));
  const filled = geometry.scene.filter(node => markIds.has(node.id) && (node.t === 'image'
    || ((node.t === 'rect' || node.t === 'path') && (node.fill || node.pattern)))
    && !/marker/i.test(node.part ?? ''));
  return occupied.map(item => ({ ...item, filled: filled.some(node => ownerContains(item.owner, node.owner)) }));
}

/** Forced-colors and contrast rules for the hover outline and card. */
export const surfaceStyle = a11ySurfaceStyle;

/** Chart types whose pointer position selects a category band before the nearest mark. */
export const bandTypes: Record<string, 'x' | 'y'> = { line: 'x', combo: 'x', column: 'x', bar: 'y' };

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
  const owners = pick.nodeId === undefined ? [] : records.filter(record => record.nodeIds.includes(pick.nodeId!));
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
  // A panel projects the option keys this question needs, so a panel's card
  // words its share exactly as the same chart would on its own.
  const cardOptions = { hundredPercent: hundredPercentComposition(panel?.type ?? request.type,
    panel ? panel.composition : request.options as CompositionOptions) };
  const input = { record: first, canvas,
    boundary: position.viewport && cssRect(position.viewport.boundary), chart: cssRect(canvas),
    pointer: position.viewport?.pointer && cssPoint(position.viewport.pointer),
    occupied: occupied.map(item => ({ ...item, rect: cssRect(item.rect) })),
    target: marks[0] && cssRect(first.anchor && !('w' in first.anchor) ? boundsOf(marks.filter(Boolean) as Rect[]) : marks[0]),
    forbidden: bounds.map(cssRect),
    previousSide: position.panel === first.target.panel ? position.previousSide : undefined,
    band: first.target.owner.annotationId !== undefined ? undefined : bandTypes[panel?.type ?? request.type],
    theme, measure: request.fontMetrics, locale,
    idPrefix: 'hover-card', card: cardOptions };
  // The card formats values after layout: it follows the chart's smallValues mode.
  const card = !flags.card ? undefined : withSmallValues(request.options.smallValues, () => active.length > 1
    ? layoutLabelCardContent(input, sharedLabelCardContent(active, locale, cardOptions, geometry.scene, model.cardRows)) : layoutLabelCard(input));
  const scene = flags.highlight ? highlightScene(geometry.scene, model.records, active, theme)
    : flags.keyboard ? outlineScene(geometry.scene, model.records, active, theme) : geometry.scene;
  // Keep the chart's description fallback alongside the tooltip's reading.
  // The description goes back to its original text when the card closes.
  const a11y = card ? { ...geometry.a11y, desc: describedWithCard(geometry.a11y.desc, card.accessibleText) } : geometry.a11y;
  return { ...geometry, a11y, scene, card, cardTheme: theme, ...(card ? { cardInput: input, active } : {}), panel: first.target.panel };
}

/** A card renders at 1 CSS pixel per layout unit, even on a scaled chart. */
export function ChartCard({ layout, theme, origin, cardRef }: { layout: LabelCardLayout; theme: Theme; origin: Point;
  cardRef?: (node: HTMLDivElement | null) => void }): ReactElement | null {
  if (!layout.scene.length) return null;
  const size: CSSProperties = { width: layout.rect.w, height: layout.rect.h, maxWidth: 'none',
    overflow: 'visible', boxSizing: 'content-box' };
  // The pointer may move onto the card (WCAG 1.4.13): the hover handlers keep the open record while it is on it.
  const card = <div popover={topLayer() ? 'manual' : undefined} ref={node => { cardRef?.(node); showCard(node); }} data-bp-chart-card="" data-bp-card-overlay="" className="bp-interaction-card"
    role="tooltip" dir="ltr" aria-label={layout.accessibleText}
    style={{ ...cardStyle(layout.rect, theme, origin, 'bp-chart-card-in', true), pointerEvents: 'auto', ...size }}>
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
  const seat = useMemo(() => measured && placeLabelCard(input, measured.size.width, measured.size.height).rect, [input, measured]);
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
 */
export function inCardCorridor(from: Point, card: Rect, point: Point): boolean {
  if (rectContains(card, { ...point, w: 0, h: 0 }, 0)) return true;
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
export function TableCard({ record, width, theme, palette, locale, measure, direction, anchor, pointer, frame, occupied = [], forbidden, tableBounds, variant = 'label', table, columns, inlineVisibility, container, offset, styleNonce, smallValues }: {
  record: InteractionRecord; width: number; theme: Theme; locale?: string; measure?: TextMeasurer; direction: 'ltr' | 'rtl';
  /** The table's options.palette, for the tone text the card prints. */
  palette?: string;
  /** The table's options.smallValues: the card formats after layout. */
  smallValues?: SmallValues;
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
  const laid = useMemo(() => withSmallValues(smallValues, () => {
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
  }), [record, width, theme, locale, measure, placed, anchor, pointer, frame, occupied, forbidden, tableBounds, variant, table, columns, inlineVisibility, direction, smallValues]);
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
