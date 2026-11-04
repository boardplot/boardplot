import { chartString } from '../../core/strings/hover';
import { joinSentences } from '../../core/strings';
import { parseFormatExample, roundedNumber } from '../../core/formatSpec';
import { boxGap, rectCenter, rectContains, type Point, type Rect } from '../../core/geometry';
import { ownerContains } from '../../core/a11y/recordsShared';
import type { SlotCandidate } from '../../core/label/solver';
import { fitText, lineBox } from '../../core/label/fitText';
import { defaultMeasurer, graphemes, type FontSpec, type TextMeasurer } from '../../core/text';
import { resolveSurface, strokeToken } from '../../core/theme';
import { mixColors, parseColor, relativeLuminance } from '../../core/color';
import { composedTextRole } from '../../core/textRole';
import { eventHeading, eventReading } from '../../core/eventReading';
import type { Geometry, OccupiedRect, Paint, PlaceDecision, SceneNode, TextRole } from '../../core/types/scene';
import type { Theme } from '../../core/types/theme';
import type { InteractionComparison, InteractionRecord, InteractionValue } from '../../core/a11y/types';
import { decimalPrecision, deltaValueText, derivedValueText as derivedText, displayedValueText, signedPercentText } from '../../core/a11y/valueText';
import { maxOf, pushAll } from '../../core/arrays';

/**
 * The hover label card: the record's own facts, next to the hovered mark.
 * The card is transient and paints its own opaque background, so it may
 * cover neighbouring marks and labels when there is no free side. The
 * viewport bounds the card. The chart frame does not constrain its size.
 * All inputs use one coordinate space, at one CSS pixel per layout unit.
 */

export interface LabelCardRow {
  /** 'more' is the card's own row counting what the frame's height left out. */
  kind: 'title' | 'value' | 'field' | 'comparison' | 'share' | 'rank' | 'annotation' | 'more';
  text: string;
  /** Separate drawn cells. `text` keeps the complete accessible reading. */
  label?: string;
  value?: string;
  series?: boolean;
  pointed?: boolean;
  swatch?: Paint;
  /** Original source facts, never rounded display numbers. Withheld values are removed. */
  values?: InteractionValue[];
  /** Prose may wrap; names use one line. */
  lines?: number;
}

/** One CSS-pixel rhythm for both hover cards, independent of chart density. */
export const CARD_SPACE = { x: 10, y: 8, group: 6, column: 12 };

export function cardFont(theme: Theme, size = 12, weight = 400): FontSpec {
  return { family: theme.type.family, size, weight, lineHeight: 1.35, tabular: true };
}

/** Derive the raised surface from the existing palette. Flat themes keep their radius. */
export function cardSurface(theme: Theme): { fill: string; radius: number; flat: boolean } {
  const radius = resolveSurface(theme).chipRadius;
  const flat = radius === 0 || theme.name.startsWith('notation');
  const background = parseColor(theme.color.background);
  const ink = parseColor(theme.color.ink);
  const dark = background && ink && relativeLuminance(background) < relativeLuminance(ink);
  return { fill: dark ? mixColors(theme.color.background, theme.color.ink, 0.94) : theme.color.background,
    radius: flat ? radius : 6, flat };
}
interface LabelCardContent {
  rows: LabelCardRow[];
  accessibleText: string;
  /** The widest the card may be, in px, when its words need a measure of their own (an event's detail). */
  maxWidth?: number;
}

/** How the card words the record's facts. The facts themselves are the record's. */
interface LabelCardOptions {
  /**
   * The chart draws every category as 100 %. The share is then the segment's
   * own percentage and the base is the axis, so the card prints no base. The
   * record keeps the category total in the data's unit either way.
   */
  hundredPercent?: boolean;
}

/** The options that say a chart draws its categories as 100 %. */
export interface CompositionOptions {
  variant?: string;
  valueAxis?: { percent?: boolean };
}

/**
 * The keys of a chart's options the test below reads, for a panel that has
 * to carry them into a prepared snapshot. Only what can change the answer:
 * a variant that IS a 100 % composition, a mekko's variant (a mekko with none
 * is a stacked100 mekko), and `valueAxis.percent` where it is on.
 */
export function compositionOptions(type: string, options?: unknown): CompositionOptions | undefined {
  const source = options as CompositionOptions | undefined;
  const projected: CompositionOptions = {};
  if (source?.variant === 'stacked100' || source?.variant === 'stacked100-area') projected.variant = source.variant;
  if (type === 'mekko' && typeof source?.variant === 'string') projected.variant = source.variant;
  if (source?.valueAxis?.percent === true) projected.valueAxis = { percent: true };
  return Object.keys(projected).length ? projected : undefined;
}

/** Charts whose categories are drawn as 100 %, read from the request the chart was laid out from. */
export function hundredPercentComposition(type: string, options?: CompositionOptions): boolean {
  // A column and a line PROMOTE `valueAxis.percent` to their
  // 100 % variant while they lay out, so the authored options still say
  // 'grouped' or 'line' (`charts/column/domain.ts`, `charts/line/domain.ts`).
  // A stacked100 mekko, which is its default, normalises every column;
  // `valueAxis.percent` promotes an authored stacked variant to stacked100 as well
  // (`charts/mekko/domain.ts`, the same promotion).
  return options?.variant === 'stacked100' || options?.variant === 'stacked100-area'
    || ((type === 'column' || type === 'line' || type === 'mekko') && options?.valueAxis?.percent === true)
    || (type === 'mekko' && (options?.variant ?? 'stacked100') === 'stacked100');
}
export interface LabelCardInput {
  record: InteractionRecord;
  plot?: Rect;
  canvas: Rect;
  /** The engine identifies filled marks from their scene nodes. Thin marks cost zero. */
  occupied: readonly (OccupiedRect & { filled?: boolean })[];
  target?: Rect;
  /** Active labels, sibling marks or row cells with a high overlap cost. */
  forbidden?: readonly Rect[];
  tableBounds?: Rect;
  /** Explicit boundary, including a zero-sized viewport. Canvas is the legacy fallback. */
  boundary?: Rect;
  /** The chart in the boundary's units: the frame of a record scrolled out of the viewport. Canvas is the fallback. */
  chart?: Rect;
  pointer?: Point;
  previousSide?: CardSide;
  band?: 'x' | 'y';
  /** Prefer clear table space; reading order breaks equal costs. */
  slots?: 'table';
  direction?: 'ltr' | 'rtl';
  theme: Theme;
  measure?: TextMeasurer;
  locale?: string;
  idPrefix?: string;
  /** Wording options; `layoutLabelCard` hands them to the content builder. */
  card?: LabelCardOptions;
}
export type CardSide = 'right' | 'left' | 'above' | 'below';
export interface LabelCardLayout extends LabelCardContent {
  /** Beside the mark on a free side, beside it over the content, or (with no mark) in free space in the frame. */
  placement: 'beside' | 'frame' | 'overlay';
  rect: Rect;
  scene: SceneNode[];
  decisions: PlaceDecision[];
  side?: CardSide;
}

export type LabelCardGeometry = Pick<Geometry, 'type' | 'size' | 'scene' | 'legend' | 'a11y' | 'sizing' | 'mode'>;

/** Crop an already measured card scene to its own rectangle for standalone rendering. */
export function labelCardGeometry(layout: LabelCardLayout): LabelCardGeometry {
  const { x, y, w, h } = layout.rect;
  return {
    type: 'interaction-card',
    size: { width: w, height: h },
    scene: layout.scene.map(node => ({
      ...node,
      tx: (node.tx ?? 0) - x,
      ty: (node.ty ?? 0) - y,
    })),
    a11y: { title: layout.rows[0]?.text ?? 'Details', desc: layout.accessibleText },
  };
}

function safeValue(value: InteractionValue, locale?: string): InteractionValue {
  if (value.state === 'suppressed') return { kind: value.kind, raw: null, state: 'suppressed', reason: chartString({ locale: { language: locale } }, 'valueWithheld') };
  return { ...value };
}

/**
 * Render one comparison as the card's comparison row: the change through the
 * value's format, the percent at the exhibit's precision. A comparison that
 * cannot be made (another axis, no reference value) has no row; the
 * record keeps it with its reason.
 */
function comparisonRow(comparison: InteractionComparison, locale?: string): LabelCardRow | undefined {
  const values = [comparison.current, comparison.reference, comparison.delta, comparison.percent];
  const withheld = values.some(value => value.state === 'suppressed');
  if (!withheld && comparison.delta.state === 'unavailable') return undefined;
  const precision = Math.max(decimalPrecision(comparison.current.raw), decimalPrecision(comparison.reference.raw));
  const label = chartString({ locale }, 'comparisonLabel', { label: comparison.scenario ?? comparison.label });
  const value = withheld ? chartString({ locale: { language: locale } }, 'valueWithheld')
    : `${deltaValueText(comparison.delta, precision, locale)} (${signedPercentText(comparison.percent, locale)})`;
  return { kind: 'comparison', label, value, text: `${label} ${value}`,
  values: withheld ? [] : values.map(value => safeValue(value, locale)) };
}

/** A share as the chart prints its percentages: the record's format when it names one, else two decimals. */
function shareText(percent: InteractionValue, locale?: string): string {
  return percent.displayed || percent.derived === 'percent' || percent.format
    ? displayedValueText(percent, locale) : derivedText(percent, 2, false, locale, true);
}

/** A heading that names the category says its date already, unless the heading is a bare id that is not the date. */
function headingNamesDate(record: InteractionRecord, date: InteractionValue): boolean {
  const { categoryLabel } = record;
  return categoryLabel !== undefined && (categoryLabel !== record.target.owner.categoryId || categoryLabel === date.raw);
}

function fieldRow(field: InteractionRecord['fields'][number], locale?: string): LabelCardRow {
  const label = `${field.label}:`;
  const value = displayedValueText(field.value, locale);
  return { kind: 'field', label, value, text: `${label} ${value}`, values: [safeValue(field.value, locale)] };
}

function cardContent(rows: LabelCardRow[]): LabelCardContent {
  return { rows, accessibleText: joinSentences(rows.map(row => row.text)) };
}

/**
 * Format only the existing record facts; never infer comparisons from rounded
 * strings. The value row reads as the chart prints the value (the series
 * format and unit, `displayedValueText`), so a card beside a bar labelled
 * "213" says "$213k" and not "212.8"; `values` keeps the source number.
 */
export function labelCardContent(record: InteractionRecord, locale?: string, options?: LabelCardOptions): LabelCardContent {
  if (record.event) return eventCardContent(record.event);
  // Only the facts the mark does not print: no title or value that repeats it.
  if (record.cardFields) {
    return cardContent(record.fields.filter(field => record.cardFields!.includes(field.key)).map(field => fieldRow(field, locale)));
  }
  const rows: LabelCardRow[] = [
    { kind: 'title', text: record.label },
    { kind: 'value', text: `${record.valueLabel ? `${record.valueLabel}: ` : ''}${displayedValueText(record.value, locale)}`,
      label: record.valueLabel ? `${record.valueLabel}:` : '', value: displayedValueText(record.value, locale), pointed: true,
      values: [safeValue(record.value, locale)] },
  ];
  if (record.value.state !== 'suppressed') {
    const members = new Set(record.members?.map(member => member.pointId).filter(id => id !== undefined));
    // A heading that names the category says its date already. Only
    // a bare id the author gave no label (and that is not the date) keeps it.
    for (const field of record.fields) {
      if (field.key === 'date' && headingNamesDate(record, field.value)) continue;
      // Aggregate cards show the mark's statistics. Individual observations stay
      // in the typed record for data tables and custom host content.
      // A field prints as the chart would print it: through its format when it
      // declares one, else at its own precision with the unit joined as the
      // marks join it ("10.9%", "186.825 EUR k").
      if (!members.has(field.key)) rows.push(fieldRow(field, locale));
    }
    pushAll(rows, record.comparisons.flatMap(comparison => comparisonRow(comparison, locale) ?? []));
    if (record.share) {
      const base = record.share.denominator;
      const values = [record.share.numerator, base, record.share.percent];
      const withheld = values.some(value => value.state === 'suppressed');
      // A composition the chart draws as 100 % names no other base: the sum
      // of the parts is the axis, and "of 100 %" repeats it. The record
      // still carries the total, in the data's unit.
      const whole = options?.hundredPercent === true || (base.state === 'value' && base.raw === 100 && base.unit === '%');
      const wording = { locale: { language: locale } };
      const label = chartString(wording, 'shareLabel');
      const value = withheld ? chartString(wording, 'valueWithheld')
        : `${shareText(record.share.percent, locale)}${whole ? '' : chartString(wording, 'ofValueClause', { v1: displayedValueText(base, locale) })}`;
      rows.push({ kind: 'share', label, value, text: `${label} ${value}`,
      values: withheld ? [] : values.map(value => safeValue(value, locale)) });
    }
    if (record.rank) {
      const wording = { locale: { language: locale } };
      const label = chartString(wording, 'rankLabel');
      const value = chartString(wording, 'rankValue', { v1: record.rank.value, v2: record.rank.of, v3: chartString(wording, record.rank.direction === 'desc' ? 'highestFirst' : 'lowestFirst') });
      rows.push({ kind: 'rank', label, value, text: `${label} ${value}` });
    }
    for (const annotation of record.annotations) rows.push({ kind: 'annotation', text: annotation.text });
  }
  return cardContent(rows);
}

/** The widest an event's card is: its detail is prose and wraps at a reading measure. */
const EVENT_CARD_WIDTH = 320;
/** Lines an event's title and each of its detail lines may take on the card; the full text is in the card's `<title>` too. */
const EVENT_TITLE_LINES = 3;
const EVENT_DETAIL_LINES = 6;

/**
 * The card of an event of the event lane: when and what kind as the heading,
 * then each item as a bold title with its detail lines under it, in full.
 */
function eventCardContent(event: NonNullable<InteractionRecord['event']>): LabelCardContent {
  const heading = eventHeading(event);
  const rows: LabelCardRow[] = [
    ...(heading ? [{ kind: 'title' as const, text: heading }] : []),
    ...event.items.flatMap(item => [
      { kind: 'value' as const, text: item.title, lines: EVENT_TITLE_LINES },
      ...item.detail.map(line => ({ kind: 'annotation' as const, text: line, lines: EVENT_DETAIL_LINES })),
    ]),
  ];
  return { rows, accessibleText: eventReading(event), maxWidth: EVENT_CARD_WIDTH };
}

/** Hollow markers carry the series ink in their stroke; unmarked points use their series path. */
function seriesSwatch(record: InteractionRecord, scene: readonly SceneNode[]): Paint | undefined {
  for (const node of scene) {
    if (!record.nodeIds.includes(node.id)) continue;
    if (node.t === 'line') return node.stroke;
    if (node.t === 'rect' || node.t === 'circle' || node.t === 'path') {
      const paint = node.part === 'marker' ? node.stroke ?? node.fill : node.fill ?? node.stroke;
      if (paint) return paint;
    }
  }
  const seriesId = record.target.owner.seriesId;
  if (seriesId === undefined) return undefined;
  const path = scene.find(node => node.t === 'path' && node.part === 'line' && node.owner.seriesId === seriesId
    && node.origin?.panels.join('/') === record.target.panel);
  return path?.t === 'path' ? path.stroke : undefined;
}

/**
 * One card for several records at one mark, such as the shared end label of
 * series that all end on the same printed value: the category heading, then
 * each series with its own value and context. Every member is listed.
 */
export function sharedLabelCardContent(records: readonly InteractionRecord[], locale?: string, options?: LabelCardOptions,
  scene: readonly SceneNode[] = [], cache?: Map<InteractionRecord, LabelCardRow[]>): LabelCardContent {
  const rows: LabelCardRow[] = [];
  if (records.length) {
    const first = records[0]!;
    // The records share one category, so they share its date: it joins the
    // heading once instead of repeating under every series.
    const date = first.fields.find(field => field.key === 'date' && !headingNamesDate(first, field.value));
    const heading = first.categoryLabel ?? first.target.owner.categoryId ?? first.label;
    rows.push({ kind: 'title', text: date ? `${heading}, ${displayedValueText(date.value, locale)}` : heading });
  }
  records.forEach((record, index) => {
    let member = cache?.get(record);
    if (!member) {
      const name = record.seriesLabel ?? record.target.owner.seriesId ?? record.label;
      const content = labelCardContent({ ...record, fields: record.fields.filter(field => field.key !== 'date' || headingNamesDate(record, field.value)) },
        locale, options).rows.slice(1);
      const value = content[0];
      member = value ? [{ ...value, label: name, value: value.text, text: `${name}. ${value.text}`,
        series: true, swatch: seriesSwatch(record, scene) }, ...content.slice(1)] : [];
      cache?.set(record, member);
    }
    if (member.length) {
      rows.push({ ...member[0]!, pointed: index === 0 });
      pushAll(rows, member.slice(1));
    }
  });
  return cardContent(rows);
}

/**
 * The chart's description with the card's whole reading after it. A renderer
 * presents the SVG as one image described by `a11y.desc`, so anything nested
 * inside it — the card's own `<title>` included — never reaches a screen
 * reader. While a card is open its reading belongs in that description.
 */
export function describedWithCard(description: string, reading: string): string {
  const chart = description.replace(/\s*\.\s*$/, '');
  return chart ? `${chart}. ${reading}` : reading;
}

/** Show a table card only when it contains facts beyond the cell's printed value. */
export function shouldShowTableLabelCard(record: InteractionRecord, displayed: string | undefined, locale?: string): boolean {
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
  const rows = labelCardContent(record, locale).rows;
  const { value } = record;
  if (rows.length > 2 || displayed === undefined) return true;
  if (value.state === 'value' && typeof value.raw === 'number' && Number.isFinite(value.raw) &&
      value.format && roundedNumber(value.raw, parseFormatExample(value.format)) === value.raw) return false;
  return normalize(rows[1]?.text ?? '') !== normalize(displayed);
}

function rowFont(row: LabelCardRow, theme: Theme): FontSpec {
  return cardFont(theme, row.kind === 'more' ? 11 : 12,
    row.kind === 'title' || row.pointed || (row.kind === 'value' && row.value === undefined) ? 600 : 400);
}

/** Claims a layout makes only for its own label solver, such as a funnel's row lanes: they draw nothing a card could hide. */
const SOLVER_CLAIMS = new Set(['funnel-row-lane']);

/** Cost per CSS pixel of card area outside the chart frame. A filled mark costs 10. */
const OUTSIDE_CHART_WEIGHT = 1;

/** Space a clear seat keeps from each text box. */
const TEXT_GAP = 4;
/** Space a card keeps from the edge of the chart frame, as the viewport boundary keeps from the window edge. */
const FRAME_INSET = 8;
/** The farthest a clear seat sits from the hovered mark, unless no seat nearer is safe. */
const CLEAR_REACH = 48;

interface CardSlot extends SlotCandidate { side?: CardSide; fits?: boolean; phase?: number }
interface CardSlots extends Array<CardSlot> {
  expand?: () => CardSlot[];
  /** Seats clear of every text, nearest first: tried only when no seat beside the mark is `clean`. */
  clear?: () => CardSlot[];
  /** A clear seat too far from the mark to read as its card: tried only when no nearer seat is safe. */
  far?: (slot: CardSlot) => boolean;
  /** A seat that covers no mark and no text: with one, the clear seats are not searched. */
  clean?: (slot: CardSlot) => boolean;
  /** A cheap lower bound of a seat's cost, to skip a clear seat before it is scored. */
  floor?: (slot: CardSlot) => number;
}

/**
 * Place, flip, then shift along an edge: to the mark's and the frame's ends,
 * and just past each forbidden box and each text in the seat's way.
 * Distances are viewport CSS pixels.
 */
function besideSlots(target: Rect, width: number, height: number, boundary: Rect,
  input: Pick<LabelCardInput, 'band' | 'pointer' | 'slots' | 'direction' | 'forbidden'>, texts: readonly Rect[] = []): CardSlot[] {
  const center = rectCenter(target);
  const centerX = input.band === 'y' && input.pointer ? input.pointer.x : center.x;
  const centerY = input.band && input.pointer ? input.pointer.y : center.y;
  const start = input.slots === 'table' ? input.direction === 'rtl' ? target.x + target.w - width : target.x : centerX - width / 2;
  const sides: CardSide[] = input.slots === 'table' || input.band === 'y'
    ? ['below', 'above', 'right', 'left'] : ['right', 'left', 'above', 'below'];
  const seat = (side: CardSide, index: number, gap: number, shift = 0, value?: number): CardSlot => {
    const horizontal = side === 'above' || side === 'below';
    const raw = { x: horizontal ? start : side === 'right' ? target.x + target.w + gap : target.x - width - gap,
      y: horizontal ? side === 'below' ? target.y + target.h + gap : target.y - height - gap : centerY - height / 2,
      w: width, h: height };
    const candidate = value === undefined ? raw : { ...raw, [horizontal ? 'x' : 'y']: value };
    const rect = clampInto(boundary, candidate);
    const distance = boxGap(rect, target);
    const fits = (horizontal ? rect.y === raw.y : rect.x === raw.x) && distance >= 8 - 1e-6 && distance <= 16 + 1e-6;
    return { slot: `card:beside:${side}:${gap}:${shift}`, side, rect, fits, penalty: index + shift * 4,
      phase: index < 2 && shift === 0 && gap === 8 && rectContains(boundary, raw, 0) ? index : 2 };
  };
  const direct = sides.slice(0, 2).map((side, index) => seat(side, index, 8));
  const candidates: CardSlots = direct.filter(slot => slot.phase! < 2);
  // Defer edge seats until both direct seats fail. Keep the original order
  // and penalties so equal costs still choose the same seat.
  candidates.expand = () => sides.flatMap((side, index) => [8, 16].flatMap(gap => {
    const raw = index < 2 && gap === 8 ? direct[index]! : seat(side, index, gap);
    const horizontal = side === 'above' || side === 'below';
    const axis = horizontal ? 'x' : 'y';
    const size = horizontal ? 'w' : 'h';
    const length = horizontal ? width : height;
    const across = horizontal ? 'y' : 'x';
    const depth = horizontal ? 'h' : 'w';
    const inWay = (rect: Rect) => rect[across] < raw.rect[across] + raw.rect[depth] && raw.rect[across] < rect[across] + rect[depth];
    const shifts = [target[axis], target[axis] + target[size] - length,
      boundary[axis], boundary[axis] + boundary[size] - length,
      ...(input.forbidden ?? []).flatMap(rect => [rect[axis] - length, rect[axis] + rect[size]]),
      ...texts.filter(inWay).flatMap(rect => [rect[axis] - length - TEXT_GAP, rect[axis] + rect[size] + TEXT_GAP])];
    return [...(raw.phase === 2 ? [raw] : []), ...shifts.map((value, shift) => seat(side, index, gap, shift + 1, value)).filter(slot => slot.fits)];
  }));
  return candidates;
}

/** Table seats stay 8–16 px from the cell; the viewport owns the boundary. */
export function tableCardSlots(target: Rect, boundary: Rect, width: number, height: number,
  input: Pick<LabelCardInput, 'direction' | 'pointer' | 'forbidden'>): CardSlot[] {
  return besideSlots(target, width, height, boundary, { ...input, slots: 'table' });
}

/**
 * Cost orders a phase. Only when every seat fails may hard overlap win. A
 * seat is safe only when it is clear of `forbidden` and of the pointer. A
 * direct seat, which wins before cost is compared, must also pass `clear`.
 * A safe seat that covers fewer texts (`hidden`) wins over one that covers
 * more, whatever its phase: a covered number is lost to the reader. Only a
 * clear seat beyond its reach loses to any safe seat, whatever that seat hides.
 */
export function selectCardSlot(candidates: CardSlots, forbidden: readonly Rect[], cost: (slot: CardSlot) => number,
  pointer?: Point, clear?: (slot: CardSlot) => boolean, hidden?: (slot: CardSlot) => number): CardSlot {
  type Score = { slot: CardSlot; overlap: number; cost: number; safe: boolean; hidden: number };
  const scores = new Map<string, Score>();
  const score = (slot: CardSlot): Score => {
    const { x, y, w, h } = slot.rect;
    const key = `${slot.side}:${x}:${y}:${w}:${h}`;
    const cached = scores.get(key);
    if (cached) return { ...cached, slot };
    const overlap = activeCoverCost(slot.rect, forbidden);
    const result = { slot, overlap, cost: cost(slot), safe: slot.fits !== false && overlap === 0
      && !(pointer && rectContains(slot.rect, { ...pointer, w: 0, h: 0 }, 0)) && !(slot.phase! < 2 && clear?.(slot) === false),
      hidden: hidden?.(slot) ?? 0 };
    scores.set(key, result);
    return result;
  };
  // A clear seat (phase 3) competes on cost with the shifted seats (phase 2).
  const phase = (score: Score) => Math.min(score.slot.phase ?? 0, 2);
  const better = (a: Score, b: Score) => a.safe !== b.safe ? a.safe
    : a.safe && a.hidden !== b.hidden ? a.hidden < b.hidden
    : (a.safe ? phase(a) - phase(b) : a.overlap - b.overlap) < 0
      || (a.safe ? phase(a) === phase(b) : a.overlap === b.overlap)
        && (a.cost < b.cost || a.cost === b.cost && a.slot.penalty < b.slot.penalty);
  let best: Score | undefined;
  const evaluate = (slots: CardSlot[]) => {
    for (const slot of slots) {
      const entry = score(slot);
      if (!best || better(entry, best)) best = entry;
      // Each direct phase has exactly one seat; no later phase can win.
      if (candidates.expand && entry.safe && entry.slot.phase! < 2) break;
    }
  };
  evaluate(candidates);
  if ((!best?.safe || best.slot.phase! >= 2) && candidates.expand) {
    const shifted = candidates.expand();
    evaluate(shifted);
    candidates.push(...shifted);
  }
  if (!(best?.safe && best.hidden === 0 && candidates.clean?.(best.slot)) && candidates.clear) {
    const clear = candidates.clear();
    const search = (slots: CardSlot[]) => {
      // Nearest first: a seat farther from the pointer than the best cost cannot win, since distance is part of the cost.
      for (const slot of slots) {
        if (best?.safe && best.hidden === 0 && slot.penalty > best.cost) break;
        if (best?.safe && best.hidden === 0 && (candidates.floor?.(slot) ?? 0) > best.cost) continue;
        const entry = score(slot);
        if (!best || better(entry, best)) best = entry;
      }
    };
    search(clear.filter(slot => !candidates.far?.(slot)));
    if (!best?.safe) search(clear.filter(slot => candidates.far?.(slot)));
  }
  // Record only unique tested seats, not duplicate edge clamps.
  candidates.splice(0, candidates.length, ...Array.from(scores.values(), entry => entry.slot));
  return best!.slot;
}

export function activeCoverCost(rect: Rect, active: readonly Rect[] = []): number {
  return active.reduce((sum, item) => sum + overlapArea(rect, item) * 1000, 0);
}

/**
 * Seats in `frame` that keep `TEXT_GAP` from every text box, nearest to
 * `pointer` first. Each row starts at a frame edge, at a text edge or a
 * beside gap above or below the mark; in a row, each run of free width offers
 * its two ends and the spot nearest the pointer. The penalty is the distance,
 * which the cost also counts.
 */
function clearSlots(frame: Rect, width: number, height: number, texts: readonly Rect[], pointer: Point, target?: Rect): CardSlot[] {
  if (frame.w < width || frame.h < height) return [];
  const bottom = frame.y + frame.h - height;
  const rows = new Set([frame.y, bottom, Math.max(frame.y, Math.min(bottom, pointer.y - height / 2)),
    ...[...(target ? [target.y + target.h + 8, target.y - 8 - height] : []), ...texts.flatMap(text => [text.y + text.h + TEXT_GAP, text.y - TEXT_GAP - height])]
      .filter(y => y >= frame.y && y <= bottom)]);
  const slots = new Map<string, CardSlot>();
  for (const y of rows) {
    const blocked = texts.filter(text => text.y - TEXT_GAP < y + height && y < text.y + text.h + TEXT_GAP)
      .map(text => [text.x - TEXT_GAP, text.x + text.w + TEXT_GAP] as const).sort((a, b) => a[0] - b[0]);
    let start = frame.x;
    const runs: (readonly [number, number])[] = [];
    for (const [from, to] of [...blocked, [frame.x + frame.w, Infinity] as const]) {
      if (Math.min(from, frame.x + frame.w) - start >= width) runs.push([start, Math.min(from, frame.x + frame.w) - width]);
      start = Math.max(start, to);
    }
    for (const [from, to] of runs) {
      for (const x of [from, to, Math.max(from, Math.min(to, pointer.x - width / 2))]) {
        const rect = { x, y, w: width, h: height };
        slots.set(`${x}:${y}`, { slot: `card:clear:${Math.round(x)}:${Math.round(y)}`, rect, phase: 3, penalty: boxGap(rect, { ...pointer, w: 0, h: 0 }) });
      }
    }
  }
  return [...slots.values()].sort((a, b) => a.penalty - b.penalty || a.rect.y - b.rect.y || a.rect.x - b.rect.x);
}

/** An anchorless card searches the same 5 by 5 boundary grid; cost orders the seats. */
function frameSlots(frame: Rect, width: number, height: number): SlotCandidate[] {
  return Array.from({ length: 25 }, (_, index) => ({ slot: `card:frame:${index}`, penalty: index,
    rect: { x: frame.x + (frame.w - width) * (index % 5) / 4,
      y: frame.y + (frame.h - height) * Math.floor(index / 5) / 4, w: width, h: height } }));
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function cardCoverCost(rect: Rect, occupied: LabelCardInput['occupied'], table = false): number {
  return occupied.reduce((sum, item) => {
    const area = overlapArea(rect, item.rect);
    if (item.kind === 'mark') return sum + area * (item.filled === false ? 0 : 10);
    // A cut digit is harder to read than a fully covered cell.
    return sum + (table && area > 0 ? item.rect.w * item.rect.h * (rectContains(rect, item.rect, 0) ? 1 : 2) : area) * 50;
  }, 0);
}

/** The frame less `inset` on each side, on each axis only where the card still fits. */
function insetFrame(frame: Rect, inset: number, width: number, height: number): Rect {
  const x = frame.w - 2 * inset >= width ? inset : 0;
  const y = frame.h - 2 * inset >= height ? inset : 0;
  return { x: frame.x + x, y: frame.y + y, w: frame.w - 2 * x, h: frame.h - 2 * y };
}

function intersect(a: Rect, b: Rect): Rect | undefined {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : undefined;
}

/** Keep a box inside the frame; a box wider or taller than the frame starts at its edge. */
function clampInto(frame: Rect, rect: Rect): Rect {
  return {
    ...rect,
    x: Math.max(frame.x, Math.min(rect.x, frame.x + frame.w - rect.w)),
    y: Math.max(frame.y, Math.min(rect.y, frame.y + frame.h - rect.h)),
  };
}

interface MeasuredRow {
  lines: string[]; width: number; height: number; title?: string;
  valueLines?: string[]; gap: number;
}

/**
 * Values wrap only when required by the boundary; no digit is removed. A name
 * (`breakAfter`) wraps the same way and may also break after `_ - / .`, so the
 * card always prints it in full.
 */
export function cardValueLines(text: string, font: FontSpec, width: number, measure: TextMeasurer, breakAfter = false): string[] {
  const fitted = fitText(text, font, width, Infinity, measure, { breakAfter });
  if (!fitted.title) return fitted.lines.length ? fitted.lines : [''];
  const lines: string[] = [];
  let line = '';
  for (const cluster of graphemes(text)) {
    if (line && measure(line + cluster, font).width > width) { lines.push(line); line = ''; }
    line += cluster;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * A shared value column takes the width its values need, less the room the
 * names need to print in full: names keep up to half the card, and a value
 * wider than the rest wraps there ("Account median:" beside a long
 * population, not "Accou…"). No digit is removed either way.
 */
function measureRows(rows: readonly LabelCardRow[], theme: Theme, maxWidth: number, measure: TextMeasurer): MeasuredRow[] {
  const labelReserve = Math.max(0, maxOf(rows.map(row => !row.label ? 0
    : measure(row.label, rowFont(row, theme)).width + CARD_SPACE.column + (row.series ? 14 : 0))));
  const valueWidth = Math.min(Math.max(1, maxWidth - Math.min(labelReserve, maxWidth / 2)), Math.max(0, maxOf(rows.map(row => row.value === undefined ? 0
    : measure(row.value, { ...rowFont(row, theme), tabular: true }).width))));
  return rows.map((row, index) => {
    const font = rowFont(row, theme);
    const paired = row.value !== undefined;
    const swatch = row.series ? 14 : 0;
    const label = paired ? row.label ?? '' : row.text;
    const room = paired ? Math.max(0, maxWidth - valueWidth - (label ? CARD_SPACE.column : 0) - swatch) : maxWidth;
    // The title is the record's name: in full, on as many lines as it needs.
    const fitted = row.kind === 'title' && !paired ? { lines: cardValueLines(label, font, Math.max(1, room), measure, true), title: undefined }
      : fitText(label, font, room, row.lines ?? (row.kind === 'annotation' ? 2 : 1), measure);
    const lines = fitted.lines.length ? fitted.lines : [''];
    const valueLines = paired ? cardValueLines(row.value!, font, Math.max(1, valueWidth), measure) : undefined;
    const gap = index > 0 && (rows[index - 1]?.kind === 'title' || row.kind === 'more'
      || (row.series && !rows[index - 1]?.series) || (row.kind === 'annotation' && rows[index - 1]?.kind !== 'annotation')) ? CARD_SPACE.group : 0;
    return { lines, title: fitted.title, valueLines, gap,
      width: Math.max(...lines.map(line => measure(line, font).width)) + swatch + (paired ? valueWidth + (label ? CARD_SPACE.column : 0) : 0),
      height: Math.max(lines.length, valueLines?.length ?? 0) * lineBox(font) };
  });
}

/** The widest a card is by default. */
const CARD_WIDTH = 280;
/** The widest a card grows when a name and its value do not fit one line at `CARD_WIDTH`, so a long text value wraps less. */
const WIDE_CARD_WIDTH = 320;

/** The card's widest measure: `CARD_WIDTH`, wider up to `WIDE_CARD_WIDTH` for a name and value that need it on one line. */
function cardWidth(rows: readonly LabelCardRow[], theme: Theme, measure: TextMeasurer): number {
  const paired = Math.max(0, maxOf(rows.map(row => {
    if (row.value === undefined) return 0;
    const font = rowFont(row, theme);
    return (row.label ? measure(row.label, font).width + CARD_SPACE.column : 0) + (row.series ? 14 : 0)
      + measure(row.value, { ...font, tabular: true }).width;
  })));
  return Math.min(WIDE_CARD_WIDTH, Math.max(CARD_WIDTH, paired + 2 * CARD_SPACE.x));
}

function cardHeight(measured: readonly MeasuredRow[]): number {
  return measured.reduce((sum, row) => sum + row.height + row.gap, 0) + 2 * CARD_SPACE.y;
}

/**
 * What one side of the frame allows. A zero or missing dimension is an
 * unconstrained axis, not a frame of no size: the standalone table card is
 * laid out in an HTML slot that gives a width and lets the card be as tall
 * as its rows (`canvas.h` is 0 there). Nothing is cut or dropped on an axis
 * the caller did not constrain.
 */
function limit(side = 0): number {
  return side > 0 ? side : Infinity;
}

/** The card's own row, counting the rows the frame's height left out. */
function moreRow(hidden: number, locale?: string): LabelCardRow {
  return { kind: 'more', text: chartString({ locale }, 'moreRows', { count: String(hidden) }) };
}

/**
 * The rows that fit the frame's height — what comes back always fits, so
 * the drawn rows and the card's rectangle agree.
 *
 * The card drops from the bottom, which is the order the content is built
 * in: annotations, then rank, then the share, with a row saying how many
 * went. A frame too short for even the headings and the first value drops
 * the counting row, then the headings from the top. A value is shown only
 * in full. Whatever goes stays in `accessibleText`.
 */
function rowsWithinHeight(
  rows: readonly LabelCardRow[], theme: Theme, maxHeight: number, maxWidth: number, measure: TextMeasurer,
  locale?: string,
): { rows: LabelCardRow[]; measured: MeasuredRow[] } {
  // Apply both limits to the source rows, so a summary never counts as data.
  let series = 0;
  const cut = rows.findIndex(row => row.series && ++series > 8);
  const maximum = cut < 0 ? rows.length : cut;
  const limited = cut < 0 ? [...rows] : [...rows.slice(0, maximum), moreRow(rows.length - maximum, locale)];
  const measured = measureRows(limited, theme, maxWidth, measure);
  const fits = (sizes: MeasuredRow[]) => cardHeight(sizes) <= maxHeight;
  if (fits(measured)) return { rows: limited, measured };
  const firstValue = rows.findIndex(row => row.kind === 'value');
  const floor = firstValue < 0 ? Math.min(rows.length, 2) : firstValue + 1;
  for (let kept = maximum - 1; kept >= floor; kept--) {
    const visible = [...rows.slice(0, kept), moreRow(rows.length - kept, locale)];
    const sizes = measureRows(visible, theme, maxWidth, measure);
    if (fits(sizes)) return { rows: visible, measured: sizes };
  }
  const title = rows[0]?.kind === 'title' ? rows[0].text : undefined;
  for (let from = 0; from < floor; from++) {
    const visible = rows.slice(from, floor).map(row => from > 0 && title && row.kind === 'value'
      ? { ...row, label: row.label || title, text: `${title}: ${row.text}` } : row);
    const sizes = measureRows(visible, theme, maxWidth, measure);
    if (fits(sizes)) return { rows: visible, measured: sizes };
  }
  // An entire value must fit. The accessible reading still contains all rows.
  return { rows: [], measured: [] };
}

function rowRole(row: LabelCardRow): TextRole {
  if (row.kind === 'title') return 'category';
  if (row.kind === 'annotation') return composedTextRole(row.text, 'note');
  return 'caption';
}

function cardScene(input: LabelCardInput, rows: LabelCardRow[], rect: Rect, measured: MeasuredRow[], reading: string): SceneNode[] {
  const { record, theme } = input;
  const prefix = input.idPrefix ?? `card:${record.id}`;
  const surface = cardSurface(theme);
  const scene: SceneNode[] = [{ t: 'rect', id: prefix, rect: { x: 0, y: 0, w: rect.w, h: rect.h }, tx: rect.x, ty: rect.y, owner: record.target.owner,
    part: 'interaction-card', title: reading, fill: { css: surface.fill }, stroke: { css: theme.color.grid },
    strokeWidth: strokeToken(theme, 'hair'), radius: surface.radius }];
  let y = CARD_SPACE.y;
  rows.forEach((row, index) => {
    const size = measured[index]!;
    const font = rowFont(row, theme);
    y += size.gap;
    if (row.swatch) scene.push({ t: 'rect', id: `${prefix}:${index}:swatch`, owner: record.target.owner, part: 'interaction-swatch',
      rect: { x: CARD_SPACE.x, y: y + (lineBox(font) - 8) / 2, w: 8, h: 8 }, tx: rect.x, ty: rect.y, radius: 2, fill: row.swatch });
    if (size.lines.some(Boolean)) scene.push({ t: 'text', id: `${prefix}:${index}`, owner: record.target.owner, part: 'interaction-label',
      role: rowRole(row), x: CARD_SPACE.x + (row.series ? 14 : 0), y, tx: rect.x, ty: rect.y,
      lines: size.lines, align: 'start', font, title: size.title,
      ink: { css: row.kind === 'title' || row.series || (row.kind === 'value' && row.value === undefined) ? theme.color.ink : theme.color.inkMuted } });
    if (size.valueLines) scene.push({ t: 'text', id: `${prefix}:${index}:value`, owner: record.target.owner, part: 'interaction-label',
      role: composedTextRole(row.value!), x: rect.w - CARD_SPACE.x, y, tx: rect.x, ty: rect.y, lines: size.valueLines,
      align: 'end', font, ink: { css: row.kind === 'value' ? theme.color.ink : theme.color.inkMuted } });
    y += size.height;
  });
  return scene;
}

/** A card reserves its whole box, and that box stays inside the frame. */
export function layoutLabelCard(input: LabelCardInput): LabelCardLayout {
  return layoutLabelCardContent(input, labelCardContent(input.record, input.locale, input.card));
}

/**
 * Place preformatted rows. A shared card built from several records reuses
 * one record's identity and anchor while presenting the combined rows.
 */
export function layoutLabelCardContent(input: LabelCardInput, content: LabelCardContent): LabelCardLayout {
  const { theme, canvas } = input;
  const measure = input.measure ?? defaultMeasurer;
  const pad = CARD_SPACE.x;
  const boundary = input.boundary ?? canvas;
  // Only the viewport (or the table's supplied boundary) can drop rows.
  const frameWidth = Math.min(input.boundary ? Math.max(0, boundary.w) : limit(boundary.w),
    content.maxWidth ?? cardWidth(content.rows, theme, measure));
  const frameHeight = input.boundary ? Math.max(0, boundary.h) : limit(boundary.h);
  const { rows, measured } = rowsWithinHeight(content.rows, theme, frameHeight, frameWidth - 2 * pad, measure, input.locale);
  const width = Math.min(frameWidth, Math.max(0, maxOf(measured.map(size => size.width))) + 2 * pad);
  const height = Math.min(frameHeight, cardHeight(measured));
  const seat = placeLabelCard(input, width, height);
  return { ...content, rows, ...seat,
    scene: rows.length ? cardScene(input, rows, seat.rect, measured, content.accessibleText) : [] };
}

/** One seat search and what it tried. */
interface CardSeat { slot: CardSlot; placement: LabelCardLayout['placement']; tried: string[] }

/**
 * The improved search's extra inputs: the texts the base seat leaves readable,
 * which it may not cover.
 */
interface SeatSearch { readable: readonly Rect[] }

/**
 * The seat of a card box of `width` by `height`: beside the mark on a free
 * side, clear of the pointer, else over the content where it covers least.
 * The label card and a host's own card content share this one rule.
 *
 * Two searches run. The base search seats the card beside the mark. The
 * improved search also keeps the chart's own words clear, ignores claims that
 * draw nothing, tries more seats near the mark and prefers the seat that hides
 * fewest texts. Its seat wins only when it hides no text the base seat leaves
 * readable, so a better seat never trades one hidden label for another. The one
 * exception frees the chart's words: where the base seat hides them, a seat clear
 * of them may hide other records' labels instead.
 *
 * Both searches stay near the mark. A card far from its mark reads as no card of
 * that mark, which is worse than a hidden label, so a clear seat beyond
 * `CLEAR_REACH` is taken only when no nearer seat is safe.
 */
export function placeLabelCard(input: LabelCardInput, width: number, height: number): Pick<LabelCardLayout, 'placement' | 'rect' | 'side' | 'decisions'> {
  // Text the card would hide: labels, notes, axis and frame text. A rule of an axis is no text.
  const texts = input.slots === 'table' ? [] : input.occupied.filter(item => item.kind !== 'mark' && item.kind !== 'reserved' && Math.min(item.rect.w, item.rect.h) > 2);
  const hidden = (rect: Rect) => texts.filter(item => overlapArea(rect, item.rect) > 0);
  let seat = seatCard(input, width, height, texts);
  if (texts.length) {
    const before = new Set(hidden(seat.slot.rect));
    // A seat that frees the chart's words may hide labels of other records instead.
    const freed = [...before].some(chartWord) ? seatCard(input, width, height, texts, { readable: [] }) : undefined;
    if (freed && !hidden(freed.slot.rect).some(item => chartWord(item) || ownerContains(item.owner, input.record.target.owner))
      && !(input.pointer && rectContains(freed.slot.rect, { ...input.pointer, w: 0, h: 0 }, 0))) seat = freed;
    else {
      const improved = seatCard(input, width, height, texts, { readable: texts.filter(item => !before.has(item)).map(item => item.rect) });
      if (hidden(improved.slot.rect).every(item => before.has(item))) seat = improved;
    }
  }
  // Cost and side memory own the card seat. A second box solver would undo
  // that choice. Rows use the shared text fitting policy above.
  const decisions: PlaceDecision[] = [{ labelId: input.idPrefix ?? `card:${input.record.id}`, strategy: 'candidatesOccupied',
    tried: seat.tried, chose: seat.slot.slot, reason: seat.placement }];
  return { placement: seat.placement, rect: seat.slot.rect, side: seat.slot.side, decisions };
}

/** The chart's own words, which no record owns: its title, notes, headers and legend. */
function chartWord(item: OccupiedRect): boolean {
  return item.kind === 'frame' || item.kind === 'legend' || Object.keys(item.owner).length === 0;
}

function seatCard(input: LabelCardInput, width: number, height: number, texts: readonly (OccupiedRect & { filled?: boolean })[], search?: SeatSearch): CardSeat {
  const occupied = search ? input.occupied.filter(item => !SOLVER_CLAIMS.has(item.part ?? '')) : input.occupied;
  const anchor = input.target ?? input.record.anchor;
  const target = anchor ? { w: 0, h: 0, ...anchor } : undefined;
  // A record scrolled out of the viewport keeps its card in the chart frame, at the record, not at the screen edge.
  const viewport = input.boundary && (!target || !(input.boundary.w > 0 && input.boundary.h > 0) || boxGap(target, input.boundary) === 0);
  const table = input.slots === 'table';
  // The chart's own frame keeps an inset, as the viewport boundary does, so a card never touches the chart's edge.
  const boundary = viewport ? input.boundary! : insetFrame(input.chart ?? input.canvas, table ? 0 : FRAME_INSET, width, height);
  const frame = { ...boundary, w: Math.max(0, boundary.w) || width, h: Math.max(0, boundary.h) || height };
  const coversPointer = (rect: Rect) => input.pointer !== undefined && rectContains(rect, { ...input.pointer, w: 0, h: 0 }, 0);
  const candidates: CardSlot[] = target ? table
    ? tableCardSlots(target, frame, width, height, input)
    : besideSlots(target, width, height, frame, input, search ? texts.map(item => item.rect) : []) : frameSlots(frame, width, height);
  const covered = (rect: Rect) => cardCoverCost(rect, occupied, table);
  // The card explains the marks, so a direct seat over a filled mark does not win before cost is compared.
  const coversFilledMark = (rect: Rect) => occupied.some(item => item.kind === 'mark' && item.filled !== false && overlapArea(rect, item.rect) > 0);
  // The viewport bounds the card and the chart frame is only a preference: area outside the frame costs less than covering a mark.
  const chart = input.chart ?? input.canvas;
  const outsideChart = (rect: Rect) => table ? 0 : (rect.w * rect.h - overlapArea(rect, chart)) * OUTSIDE_CHART_WEIGHT;
  const coversText = (rect: Rect) => texts.some(item => overlapArea(rect, item.rect) > 0);
  // The base search ranks a seat that covers no text first; the improved one ranks by how many texts it hides.
  const hiddenTexts = (rect: Rect) => search ? texts.reduce((count, item) => count + (overlapArea(rect, item.rect) > 0 ? 1 : 0), 0) : coversText(rect) ? 1 : 0;
  // The hovered record's own labels stay readable beside its card, as the engine's active labels do. In the
  // improved search so do the chart's own words, which no record owns (its title, notes, headers and legend),
  // and every text the base seat leaves readable.
  const own = texts.filter(item => ownerContains(item.owner, input.record.target.owner) || (search !== undefined && chartWord(item))).map(item => item.rect);
  const active = [...(input.forbidden ?? []), ...own, ...(search?.readable ?? [])];
  const exclusion = target ? { ...target, w: target.w || 0.001, h: target.h || 0.001 } : undefined;
  const forbidden = [...(exclusion ? [exclusion] : []), ...(table ? [] : active)];
  const pointer = table && !input.pointer && target ? target
    : { ...(input.pointer ?? rectCenter(target ?? frame)), w: 0, h: 0 };
  const cost = (slot: CardSlot) => Math.round((covered(slot.rect) + outsideChart(slot.rect) + activeCoverCost(slot.rect, table ? input.forbidden : active)
    + (coversPointer(slot.rect) ? slot.rect.w * slot.rect.h * 1000 : 0) + boxGap(slot.rect, pointer)
    + (slot.side === input.previousSide ? 0 : 8)) * 1000) / 1000;
  if (target && !table) {
    // Inside the boundary and at most one card size beyond the chart: the seats clear of text that the seats beside the mark could not find.
    const area = intersect({ x: chart.x - width, y: chart.y - height, w: chart.w + 2 * width, h: chart.h + 2 * height }, frame);
    (candidates as CardSlots).clear = () => area ? clearSlots(area, width, height, texts.map(item => item.rect), pointer, search ? target : undefined) : [];
    (candidates as CardSlots).far = slot => boxGap(slot.rect, target) > CLEAR_REACH;
    (candidates as CardSlots).clean = slot => covered(slot.rect) === 0 && !coversText(slot.rect);
    (candidates as CardSlots).floor = slot => slot.penalty + outsideChart(slot.rect);
  }
  const selected = selectCardSlot(candidates, forbidden, cost, input.pointer, table ? undefined : slot => !coversFilledMark(slot.rect) && !coversText(slot.rect),
    table ? undefined : slot => hiddenTexts(slot.rect));
  const rect = selected.rect;
  const placement = covered(rect) > 0 || activeCoverCost(rect, forbidden) > 0 || activeCoverCost(rect, input.forbidden) > 0 ? 'overlay' : target ? 'beside' : 'frame';
  return { slot: selected, placement, tried: candidates.map(slot => slot.slot) };
}
