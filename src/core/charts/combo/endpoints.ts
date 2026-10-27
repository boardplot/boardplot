import { rectContains, rectsOverlap, type Rect } from '../../geometry';
import type { PolylineQueries } from '../../polyline';
import type { LabelRequest, SlotCandidate, SolveResult } from '../../label/solver';
import { LAST_RESORT_PENALTY, PRIORITY } from '../../label/solver';
import type { FontSpec, TextMeasurer } from '../../text';
import type { Id } from '../../types/cell';
import type { Category } from '../../types/data';
import type { ComboOptions, ValueLabelMode } from '../../types/options';
import { maxOf, minOf } from '../../arrays';

/**
 * Which line values the combo prints: the last value by default, as on the
 * line chart; the dual-axis anatomy states both ends, and every point when the
 * chart has at most ANATOMY_ALL_MAX_CATEGORIES categories. An authored
 * valueLabels always wins.
 */
export function comboValueLabels(options: Pick<ComboOptions, 'valueLabels'>, anatomy = false, categoryCount = Infinity): ValueLabelMode {
  return options.valueLabels
    ?? (anatomy ? (categoryCount <= ANATOMY_ALL_MAX_CATEGORIES ? 'all' : 'ends') : 'last');
}

/** The anatomy labels every line point by default up to this many categories. */
const ANATOMY_ALL_MAX_CATEGORIES = 8;

interface EndpointSeries {
  id: Id;
  kind?: 'column' | 'line' | 'area';
  vals: { v: number | null; labelOverride?: string | false; priority?: number }[];
}

/** One line end label: its text, the category it sits on, and whether the author suppressed it. */
export interface EndpointText {
  text: string;
  ci: number;
  suppressed: boolean;
}

export function prepareComboEndpointTexts<S extends EndpointSeries>(
  series: S[],
  textOf: (series: S, categoryIndex: number) => string,
  /** Which ends the engine labels; at the others only an authored cell label prints. */
  engine: { first: boolean | ((series: S) => boolean); last: boolean },
): { first: Map<Id, EndpointText>; last: Map<Id, EndpointText> } {
  const first = new Map<Id, EndpointText>();
  const last = new Map<Id, EndpointText>();
  const add = (target: Map<Id, EndpointText>, item: S, ci: number): void => {
    const authoredOnly = !(target === first ? typeof engine.first === 'function' ? engine.first(item) : engine.first : engine.last);
    const value = item.vals[ci]!;
    if (authoredOnly && typeof value.labelOverride !== 'string') return;
    const composed = textOf(item, ci);
    const text = typeof value.labelOverride === 'string' ? value.labelOverride.replace(/\$\{value\}/g, composed) : composed;
    if (text || value.labelOverride === false) target.set(item.id, { text, ci, suppressed: value.labelOverride === false });
  };
  for (const item of series) {
    const firstCi = item.vals.findIndex((value) => value.v !== null);
    if (firstCi < 0) continue;
    let lastCi = firstCi;
    for (let ci = firstCi + 1; ci < item.vals.length; ci++) if (item.vals[ci]!.v !== null) lastCi = ci;
    add(last, item, lastCi);
    if (firstCi !== lastCi) add(first, item, firstCi);
  }
  return { first, last };
}

/**
 * A line end label stays at its point. A candidate farther than this from the
 * marker is not offered, so a label that fits nowhere closer is dropped with a
 * warning instead of travelling to the frame edge.
 */
const ENDPOINT_MAX_GAP = 20;
/** Failed end labels may reserve a seat inside the plot on one retry. */
export const INSIDE_ENDPOINT_IDS = Symbol('insideEndpointIds');
/** Air between the marker and a label beside it. */
const SIDE_GAP = 5;

/** Plot width a line end label needs beside the plot, per side. */
export interface EndpointGutters {
  first: number;
  last: number;
}

/** The inside retry changes the band only when a failed end needs nonzero room. */
export function insideEndpointGutters(input: {
  ids: ReadonlySet<Id> | undefined;
  first: Map<Id, EndpointText>;
  last: Map<Id, EndpointText>;
  cats: Category[];
  width: number;
  font: FontSpec;
  measure: TextMeasurer;
  markerR: number;
}): EndpointGutters {
  if (!input.ids) return { first: 0, last: 0 };
  const selected = (ends: Map<Id, EndpointText>) => new Map([...ends].filter(([id, end]) => input.ids!.has(`point:${id}:${input.cats[end.ci]!.id}`)));
  const room = endpointGutters({
    first: selected(input.first), last: selected(input.last), count: input.cats.length,
    width: input.width, adjacent: { first: false, last: false },
    font: input.font, measure: input.measure, markerR: input.markerR,
  });
  return room.first + room.last > input.width / 2 ? { first: 0, last: 0 } : room;
}

/**
 * The gutter the default slot needs: right of the last point, left of the
 * first. It is reserved only where no tick column is adjacent, because there
 * the label goes above or below its point inside the plot.
 *
 * Combo's band scale (inner padding 1 - f, outer padding (1 - f) / 2 + 0.05)
 * puts category i at step * (0.55 + i) from the range start for any band
 * fraction f, with step = width / (count + 0.1). A label beside the point
 * overflows the plot by its reach minus that distance, and the gutter g it
 * takes shrinks the step, so g solves g = reach - k * (width - g).
 */
export function endpointGutters(input: {
  first: Map<Id, EndpointText>;
  last: Map<Id, EndpointText>;
  count: number;
  width: number;
  adjacent: { first: boolean; last: boolean };
  font: FontSpec;
  measure: TextMeasurer;
  markerR: number;
}): EndpointGutters {
  const side = (texts: Map<Id, EndpointText>, fromEnd: boolean, width: number): number => {
    let gutter = 0;
    for (const end of texts.values()) {
      if (end.suppressed) continue;
      const reach = input.markerR + SIDE_GAP + input.measure(end.text || '0', input.font).width;
      const k = (0.55 + (fromEnd ? input.count - 1 - end.ci : end.ci)) / (input.count + 0.1);
      const needed = (reach - k * width) / (1 - k);
      if (needed > 0) gutter = Math.max(gutter, Math.ceil(needed) + 1);
    }
    return Math.min(gutter, Math.floor(input.width / 4));
  };
  // Each gutter narrows the step the other one is measured against, so the
  // two settle together. Both only grow from zero, are whole pixels and are
  // capped at a quarter of the plot, so the loop reaches its fixed point; the
  // round bound is a backstop.
  let gutters: EndpointGutters = { first: 0, last: 0 };
  for (let round = 0; round < 64; round++) {
    const first = input.adjacent.first ? 0 : side(input.first, false, input.width - gutters.last);
    const last = input.adjacent.last ? 0 : side(input.last, true, input.width - first);
    if (first === gutters.first && last === gutters.last) break;
    gutters = { first, last };
  }
  return gutters;
}

/**
 * The reserve follows the placement. A gutter whose label the solver seated
 * inside the plot (its slot beside the point was taken) is blank space, so the
 * layout runs again without it. Returns the gutters for that second run, or
 * undefined when every reserved gutter holds a label.
 */
export function unusedEndpointGutters(gutters: EndpointGutters, solved: SolveResult, plot: Rect): EndpointGutters | undefined {
  const shown = solved.placed.filter((label) => label.kind === 'point' && !label.hidden);
  const first = shown.some((label) => label.rect.x < plot.x - 0.5) ? gutters.first : 0;
  const last = shown.some((label) => label.rect.x + label.rect.w > plot.x + plot.w + 0.5) ? gutters.last : 0;
  return first === gutters.first && last === gutters.last ? undefined : { first, last };
}

/**
 * The solver reports a hidden end label as information, since its priority
 * sits under the required band. A value missing at its mark is a loss the
 * author should see, so the combo raises it to a warning and says why.
 */
export function flagDroppedEndpointLabels(solved: SolveResult): void {
  // Only line end labels are 'point' labels in a combo, and the solver
  // writes label-hidden only for a collision.
  for (const warning of solved.warnings) {
    if (warning.code !== 'label-hidden' || !warning.message.startsWith("label 'point:")) continue;
    warning.severity = 'warn';
    warning.message += `; nothing within ${ENDPOINT_MAX_GAP}px of its point is free`;
  }
}

/** Half the 2px stroke plus 1px of air: what a value keeps from any drawn line. */
const STROKE_CLEAR = 2;

/**
 * A value never sits on a line, its own included. The line's
 * claims carry the value's own owner, so the solver lets the value onto
 * them; the exact segments decide here instead.
 */
export function clearOfStrokes(candidates: SlotCandidate[], strokes: readonly PolylineQueries[]): SlotCandidate[] {
  return candidates.filter(({ rect }) => !strokes.some(stroke => stroke.hits(rect, STROKE_CLEAR)));
}

/**
 * The smallest whole-pixel lift, at most `max`, that takes a seat clear of
 * every stroke; undefined when the seat is clear already or no lift up to
 * `max` clears it.
 */
export function clearLift(rect: Rect, strokes: readonly PolylineQueries[], max: number): number | undefined {
  const at = (dy: number) => clearOfStrokes([{ slot: 'probe', rect: { ...rect, y: rect.y - dy }, penalty: 0 }], strokes).length > 0;
  if (at(0)) return undefined;
  for (let dy = 1; dy <= max; dy++) if (at(dy)) return dy;
  return undefined;
}

/** A seat above or below a point is never nearer another line than its own. */
export function nearerOwnLine(candidates: SlotCandidate[], own: readonly PolylineQueries[], others: readonly PolylineQueries[]): SlotCandidate[] {
  if (others.length === 0) return candidates.slice();
  return candidates.filter(({ rect }) => {
    let gap = Infinity;
    for (const line of own) gap = Math.min(gap, line.distance(rect));
    return !others.some(line => line.closerThan(rect, gap));
  });
}

/**
 * A value seated on a column reads best inside one fill. An
 * on-column seat that crosses a column or segment edge moves behind every
 * other seat, so it is taken only where nothing else is free and the value
 * would otherwise be lost.
 */
export function withinOneFill(candidates: SlotCandidate[], fills: readonly Rect[]): SlotCandidate[] {
  const crosses = (candidate: SlotCandidate) => crossesFill(candidate, fills);
  return [...candidates.filter((candidate) => !crosses(candidate)), ...candidates.filter(crosses)];
}

function crossesFill(candidate: SlotCandidate, fills: readonly Rect[]): boolean {
  return candidate.overColumns === true
    && fills.some((fill) => rectsOverlap(fill, candidate.rect) && !rectContains(fill, candidate.rect, 1));
}

const firstSlots: Record<string, string> = {
  aboveCenter: 'aboveCenter', aboveLifted: 'aboveLifted', belowCenter: 'belowCenter',
  right: 'left', rightShiftedUp: 'leftShiftedUp', rightShiftedDown: 'leftShiftedDown',
  rightNudgedUp: 'leftNudgedUp', rightNudgedDown: 'leftNudgedDown', rightClear: 'leftClear', rightPastColumn: 'leftPastColumn', rightPastColumnUp: 'leftPastColumnUp',
  rightPastColumnDown: 'leftPastColumnDown', rightPastColumnClear: 'leftPastColumnClear',
  rightPastColumnShiftedUp: 'leftPastColumnShiftedUp', rightPastColumnShiftedDown: 'leftPastColumnShiftedDown', belowEndDeep: 'belowStartDeep',
  aboveEnd: 'aboveStart', belowEnd: 'belowStart', aboveEndLeft: 'aboveStartRight',
  belowEndLeft: 'belowStartRight', outsideRight: 'outsideLeft',
};

/** Slot order on the column: above and below the point before beside it. */
const ON_COLUMN_ORDER = ['aboveEnd', 'belowEnd', 'right', 'aboveEndLeft', 'belowEndLeft', 'rightShiftedUp', 'rightShiftedDown'];

/**
 * A Pareto curve's first point sits on the first bar and repeats that bar's
 * share, so its value ranks below the bar totals. Combo keeps both ends high.
 */
export const FIRST_END_BELOW_TOTALS = Symbol('firstEndBelowTotals');

interface EndpointRequestInput {
  s: EndpointSeries;
  last: { ci: number; x: number; y: number };
  lastCat: Category;
  text: string;
  labelFont: FontSpec;
  measure: TextMeasurer;
  MARKER_R: number;
  hasColumns: boolean;
  band: { position(index: number): number; bandwidth: number };
  adjacentAxisActive: boolean;
  highlights: Set<Id>;
  first: boolean;
  /** The first end ranks below the column totals (Pareto). */
  firstBelowTotals?: boolean;
  /** Pareto: its share curve reads on its columns, so its ends keep the on-column seats. */
  sharesOnColumns?: boolean;
  /** Pinned or signed scales keep a nearby on-column seat when the line cannot clear the columns. */
  allowOnColumn?: boolean;
  /** Horizontal extent of the frame: no candidate leaves it. */
  bounds: { x0: number; x1: number; y0?: number; y1?: number };
  /** Every drawn line; no candidate touches one. */
  strokes: readonly PolylineQueries[];
  /** Every drawn column segment; an on-column seat stays inside one. */
  fills: readonly Rect[];
  /** The inside seats of the segment values that fit their segment; an on-column seat keeps off them. */
  segmentSeats?: readonly Rect[];
  /** Column-total seats a line end lifted over the columns must leave free (the note pass names them). */
  totalSeats?: readonly Rect[];
  /** The dual-axis anatomy: above the point first, on a halo, at the label role weight, never on a column. */
  anatomy?: boolean;
}

/** The air between an anatomy line point and its value box above, as linePointLabels' ABOVE_POINT_GAP. */
const ANATOMY_ABOVE_GAP = 5;

/** Gap between a label box and the marker circle around `point`. */
function markerGap(rect: Rect, point: { x: number; y: number }, r: number): number {
  const nx = Math.max(rect.x, Math.min(point.x, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(point.y, rect.y + rect.h));
  return Math.max(0, Math.hypot(nx - point.x, ny - point.y) - r);
}

/**
 * Every candidate sits at the point. A candidate that leaves the frame
 * or lies more than ENDPOINT_MAX_GAP from the marker is dropped; one displaced
 * by more than a label height carries a leader back to the marker.
 */
function atThePoint(candidates: SlotCandidate[], point: { x: number; y: number }, r: number, h: number, bounds: { x0: number; x1: number; y0?: number; y1?: number }): SlotCandidate[] {
  return candidates.flatMap((candidate) => {
    const { rect } = candidate;
    if (rect.x < bounds.x0 - 0.5 || rect.x + rect.w > bounds.x1 + 0.5) return [];
    const gap = markerGap(rect, point, r);
    // A seat above the crossed columns carries its own vertical leader; it may sit one line
    // further up than the plain limit, so a plot 1 px taller does not cost a line end its
    // only seat.
    if (gap > ENDPOINT_MAX_GAP + (candidate.leaderVertical ? h + 4 : 0)) return [];
    if (gap <= h || candidate.leaderFrom) return [candidate];
    return [{ ...candidate, leaderFrom: { x: point.x + (rect.x + rect.w / 2 < point.x ? -r : r), y: point.y } }];
  });
}

/**
 * atThePoint, with one exception: a seat just past the end's own column may
 * reach up to one label width past the plot edge, into the gutter before the
 * axis labels (the solver keeps it off those labels). Without it a value one
 * column wide at the plot's end has no seat beside its point at all.
 */
function seatsAtThePoint(candidates: SlotCandidate[], point: { x: number; y: number }, r: number, h: number, bounds: { x0: number; x1: number; y0?: number; y1?: number }, w: number): SlotCandidate[] {
  const wide = { ...bounds, x0: bounds.x0 - w, x1: bounds.x1 + w };
  return candidates.flatMap((c) => atThePoint([c], point, r, h, c.slot.includes('PastColumn') ? wide : bounds));
}

/** Air a value past the plot's edge keeps from the tick labels beside it. */
const TICK_AIR = 4;

/** A seat past its column that reaches over the plot's side edge (seatsAtThePoint). */
function leavesPlot(candidate: SlotCandidate, bounds: { x0: number; x1: number }): boolean {
  return candidate.slot.includes('PastColumn') && (candidate.rect.x < bounds.x0 - 0.5 || candidate.rect.x + candidate.rect.w > bounds.x1 + 0.5);
}

/** The seats that keep off the lines, one-fill seats first. */
function rankedSeats(seats: SlotCandidate[], strokes: readonly PolylineQueries[], fills: readonly Rect[]): SlotCandidate[] {
  const kept = withinOneFill(clearOfStrokes(seats, strokes), fills);
  return kept;
}

export function comboEndpointRequest(input: EndpointRequestInput): LabelRequest {
  const { s, last, lastCat, text, measure, MARKER_R, hasColumns, band, adjacentAxisActive, highlights, anatomy } = input;
  const labelFont = anatomy ? { ...input.labelFont } : input.labelFont;
  const tsize = measure(text || '0', labelFont);
  const w = tsize.width;
  const h = tsize.height;
  const beside = last.x + MARKER_R + SIDE_GAP;
  const right: SlotCandidate = { slot: 'right', rect: { x: beside, y: last.y - h / 2, w, h }, penalty: 0 };
  const rightUp: SlotCandidate = { slot: 'rightShiftedUp', rect: { x: beside, y: last.y - h / 2 - h - 3, w, h }, penalty: 1 };
  const rightDown: SlotCandidate = { slot: 'rightShiftedDown', rect: { x: beside, y: last.y + h / 2 + 3, w, h }, penalty: 1 };
  // Two ends a label height apart each keep a seat beside their own
  // point; a few pixels off centre reads as that point's, a whole row does not.
  const rightNudgedDown: SlotCandidate = { slot: 'rightNudgedDown', rect: { x: beside, y: last.y - h / 2 + 3, w, h }, penalty: 0.5 };
  const rightNudgedUp: SlotCandidate = { slot: 'rightNudgedUp', rect: { x: beside, y: last.y - h / 2 - 3, w, h }, penalty: 0.5 };
  // A point a few pixels off the plot edge (a rate near zero over the baseline): the seat beside it
  // moves just clear of the edge line, so the value stays at its own point and touches no line
  // (an unambiguous label on the chart beats a named note). Only when the
  // shift is larger than a nudge; a smaller one is rightNudgedUp/Down.
  const edgeAir = 3;
  const clearY = Math.min(Math.max(last.y - h / 2, (input.bounds.y0 ?? -Infinity) + edgeAir), (input.bounds.y1 ?? Infinity) - h - edgeAir);
  const rightClear: SlotCandidate[] = Math.abs(clearY - (last.y - h / 2)) > 3 && Math.abs(clearY - (last.y - h / 2)) < h
    ? [{ slot: 'rightClear', rect: { x: beside, y: clearY, w, h }, penalty: 0.75 }] : [];
  // A line end inside its own column (a partial last week): the seat beside the point lies on
  // the column's edge, so the value moves just past the column, level with its point, still
  // nearer its own point than any other (on the chart before the note).
  const ownColumnEdge = Math.max(-Infinity, maxOf(input.fills.filter((fill) => fill.x <= last.x && last.x <= fill.x + fill.w).map((fill) => fill.x + fill.w)));
  const past = ownColumnEdge + edgeAir;
  const rightPast: SlotCandidate[] = s.kind === 'line' && input.sharesOnColumns !== true && hasColumns && Number.isFinite(ownColumnEdge) && past > beside && past - beside < w
    ? [
      { slot: 'rightPastColumn', rect: { x: past, y: last.y - h / 2, w, h }, penalty: 0.6 },
      { slot: 'rightPastColumnUp', rect: { x: past, y: last.y - h / 2 - 3, w, h }, penalty: 0.7 },
      { slot: 'rightPastColumnDown', rect: { x: past, y: last.y - h / 2 + 3, w, h }, penalty: 0.7 },
      ...rightClear.map((seat) => ({ ...seat, slot: 'rightPastColumnClear', rect: { ...seat.rect, x: past }, penalty: 0.8 })),
      { slot: 'rightPastColumnShiftedUp', rect: { x: past, y: last.y - h / 2 - h - 3, w, h }, penalty: 1.1 },
      { slot: 'rightPastColumnShiftedDown', rect: { x: past, y: last.y + h / 2 + 3, w, h }, penalty: 1.1 },
    ] : [];
  // The two-row shifts (rightShiftedUp2/Down2) are gone: their nearest edge
  // lies 1.5 label heights plus 6px from the point, past ENDPOINT_MAX_GAP at
  // every type size the themes ship.
  // Above and below the point, right-aligned to it at the end (the mirror
  // makes them left-aligned at the start).
  const aboveEnd: SlotCandidate = { slot: 'aboveEnd', rect: { x: last.x - w + 2, y: last.y - h - MARKER_R - 4, w, h }, penalty: 2 };
  const belowEnd: SlotCandidate = { slot: 'belowEnd', rect: { x: last.x - w + 2, y: last.y + MARKER_R + 4, w, h }, penalty: 2 };
  // An area's value half a row deeper in its fill, clear of an edge that rises into the end.
  const belowEndDeep: SlotCandidate = { slot: 'belowEndDeep', rect: { x: last.x - w + 2, y: last.y + MARKER_R + 4 + h / 2, w, h }, penalty: 2 };
  // fully left of the marker: survives when grand totals own the band
  // straight above the endpoint (the total rhythm) and the tick column owns the
  // right side
  const aboveEndLeft: SlotCandidate = { slot: 'aboveEndLeft', rect: { x: last.x - MARKER_R - 12 - w, y: last.y - h - MARKER_R - 4, w, h }, penalty: 3 };
  const belowEndLeft: SlotCandidate = { slot: 'belowEndLeft', rect: { x: last.x - MARKER_R - 12 - w, y: last.y + MARKER_R + 4, w, h }, penalty: 3 };
  // line ends inside the final stacked column: leader-routed slot past the
  // column edge, kept only while that edge is near the point
  const colEdge = hasColumns ? band.position(last.ci) + band.bandwidth : last.x;
  const outsideRight: SlotCandidate = {
    slot: 'outsideRight', rect: { x: colEdge + 8, y: last.y - h / 2, w, h }, penalty: 4,
    leaderFrom: { x: last.x + MARKER_R, y: last.y },
  };
  // The anatomy centres the value over its point, on a halo.
  // A combo line end never overlaps a column and stays inside the plot.
  const clearsColumns = s.kind === 'line' && input.sharesOnColumns !== true;
  const centredX = clearsColumns ? Math.max(input.bounds.x0, Math.min(last.x - w / 2, input.bounds.x1 - w)) : last.x - w / 2;
  // The anatomy's end values keep the interior values' offset over their points.
  const aboveCenter: SlotCandidate = { slot: 'aboveCenter', rect: { x: centredX, y: last.y - h - (anatomy ? ANATOMY_ABOVE_GAP : MARKER_R + 4), w, h }, penalty: 0 };
  const aboveRaised: SlotCandidate = { ...aboveCenter, slot: 'aboveRaised', rect: { ...aboveCenter.rect, y: aboveCenter.rect.y - 4 }, penalty: 0.5, ...(anatomy ? { needsBacking: true } : {}) };
  // Where the line clips the anatomy's seat over the point by a few pixels, the
  // value lifts by just that much and still goes before every side seat, so
  // every point keeps one small offset.
  const lift = anatomy ? clearLift(aboveCenter.rect, input.strokes, h) : undefined;
  const aboveLifted: SlotCandidate[] = lift === undefined ? [] : [{ ...aboveCenter, slot: 'aboveLifted', rect: { ...aboveCenter.rect, y: aboveCenter.rect.y - lift } }];
  const belowCenter: SlotCandidate = { slot: 'belowCenter', rect: { x: centredX, y: last.y + MARKER_R + 4, w, h }, penalty: 1 };
  const belowLowered: SlotCandidate = { ...belowCenter, slot: 'belowLowered', rect: { ...belowCenter.rect, y: belowCenter.rect.y + 4 }, penalty: 1.5 };
  // At the plot's end the centred seats are pushed inward onto the neighbour's column; centred on
  // the point they reach into the gutter instead (a last resort, as the seats past the column).
  // A few pixels back toward the plot when the axis labels stand right by it.
  const pastXs = [0, 2, 4, 6].map((k) => last.x - w / 2 + (last.x - w / 2 > centredX ? -k : k)).filter((x) => Math.abs(x - centredX) > 0.5 && (x - centredX) * (last.x - w / 2 - centredX) > 0);
  const centredPast: SlotCandidate[] = clearsColumns && hasColumns
    ? pastXs.flatMap((x, k) => [{ ...belowCenter, slot: `belowPastColumn${k || ''}`, rect: { ...belowCenter.rect, x } },
      { ...aboveCenter, slot: `abovePastColumn${k || ''}`, rect: { ...aboveCenter.rect, x } }])
    : [];
  // With a tick column on this side the label goes above or below its point.
  // An area's value sits on its fill, under the edge it names,
  // so it never reads as a line's that passes beside the end.
  const ordered = anatomy
    ? [aboveCenter, ...aboveLifted, aboveEnd, belowCenter, belowEnd, aboveEndLeft, belowEndLeft, right, rightUp, rightDown].map((c) => ({ ...c, needsBacking: true }))
    : s.kind === 'area'
      ? [belowEnd, belowEndDeep, belowEndLeft, belowCenter, right, rightDown, aboveEnd, aboveEndLeft, rightUp, outsideRight]
      : adjacentAxisActive
        ? [aboveEnd, belowEnd, aboveEndLeft, belowEndLeft, right, rightNudgedUp, rightNudgedDown, ...rightClear, ...rightPast, rightUp, rightDown, outsideRight]
        : [right, rightNudgedUp, rightNudgedDown, ...rightClear, ...rightPast, rightUp, rightDown, aboveEnd, belowEnd, aboveEndLeft, belowEndLeft, outsideRight];
  const mirrored = input.first
    ? ordered.map((candidate) => ({
      ...candidate,
      slot: firstSlots[candidate.slot]!,
      rect: { ...candidate.rect, x: 2 * last.x - candidate.rect.x - candidate.rect.w },
      ...(candidate.leaderFrom ? { leaderFrom: { ...candidate.leaderFrom, x: 2 * last.x - candidate.leaderFrom.x } } : {}),
    }))
    : ordered;
  // A value whose point lies inside a column is drawn
  // at its point, on the column, with the theme's halo, the treatment a
  // segment value inside its column gets. These slots follow every free one;
  // text still blocks them, so a label is dropped only when it would touch
  // other text wherever it goes.
  const onColumn = hasColumns && (!anatomy || input.allowOnColumn) && (!clearsColumns || input.allowOnColumn)
    ? [...ON_COLUMN_ORDER.flatMap((slot) => mirrored.filter((c) => c.slot === (input.first ? firstSlots[slot] : slot))),
      // Centred on the point, the seat most likely to lie wholly on its column.
      aboveCenter, aboveRaised, belowCenter, belowLowered]
      .map((c) => ({ ...c, slot: `${c.slot}OnColumn`, penalty: c.penalty + 10, needsBacking: true, overColumns: true }))
      // A segment that carries its own value inside keeps that seat.
      .filter((c) => !(input.segmentSeats ?? []).some((seat) => rectsOverlap(seat, c.rect, 2)))
    : [];
  // A line ending over a running (partial) column: the value sits centred under its point, in
  // the room the short column leaves, at every width (beside it, it jumps sides as the card narrows).
  // A running category without a column keeps the main placement.
  const bandX = band.position(last.ci);
  // Half a pixel in: a neighbour's fill that only touches this band (bandFraction 1) is not its column.
  const ownColumn = input.fills.some(fill => fill.x < bandX + band.bandwidth - 0.5 && fill.x + fill.w > bandX + 0.5);
  const partialFirst: SlotCandidate[] = !input.first && !anatomy && clearsColumns && ownColumn && lastCat.partial === true
    ? [{ ...belowCenter, penalty: 0 }, { ...belowLowered, penalty: 0.5 }] : [];
  // A line end can lie inside a column. Keep its text above the crossed
  // columns, with a leader to the point, when the nearby free seats fail.
  const aboveColumns: SlotCandidate[] = [];
  let totalOnLeader = false;
  if (clearsColumns && hasColumns) {
    const x = Math.max(input.bounds.x0, Math.min(last.x - w / 2, input.bounds.x1 - w));
    const across = (rect: Rect) => rect.x < x + w + 2 && rect.x + rect.w > x - 2;
    const crossed = input.fills.filter(across);
    // The leader runs straight up from the point: through the first column's total it pushes that
    // total off its column (leaderClear) to the seat left of the line's start, and the two numbers
    // stack on one vertical. Such a lifted seat is a last resort, behind the seats on the column, so the
    // value still prints where no other seat is free. Elsewhere a crossed total has no seat beside its column
    // and drops, so the lifted value keeps its rank (combo.dense-12-months at 400 x 300 keeps '99').
    totalOnLeader = last.ci === 0 && (input.totalSeats ?? []).some(seat => seat.x < last.x && seat.x + seat.w > last.x && seat.y < last.y);
    if (crossed.length > 0) {
      // A kept column total keeps its seat over the stack: the lifted end starts above it.
      const top = Math.min(minOf(crossed.map(fill => fill.y)), minOf((input.totalSeats ?? []).filter(across).map(seat => seat.y)));
      for (let step = 0; step < 3; step++) for (const raise of [0, 4]) aboveColumns.push({
        slot: `aboveColumn${step}${raise ? 'Raised' : ''}`, rect: { x, y: top - h - 4 - step * (h + 4) - raise, w, h }, penalty: (totalOnLeader ? LAST_RESORT_PENALTY : 0) + 5 + step + raise / 8,
        // A point under the label's own span still gets its leader, straight down to it.
        leaderFrom: { x: last.x, y: last.y }, leaderVertical: true,
      });
    }
  }
  return {
    id: `point:${s.id}:${lastCat.id}`,
    kind: 'point',
    owner: { seriesId: s.id, categoryId: lastCat.id },
    text,
    lines: [text],
    typeRole: 'label', font: labelFont,
    ...(anatomy ? { fontStep: labelFont } : {}),
    // A line's end value seats before an area's, which has its fill to sit on.
    priority:
      s.vals[last.ci]!.priority ??
      (input.first && input.firstBelowTotals ? PRIORITY.endpoint : PRIORITY.reference) + (s.kind === 'area' ? 0 : 0.5) + (highlights.has(s.id) ? PRIORITY.highlightBonus : 0),
    redundant: s.vals[last.ci]!.labelOverride === false,
    // A Pareto's first share repeats its first bar: without a seat beside the total it drops as density.
    ...(input.first && input.firstBelowTotals && s.vals[last.ci]!.labelOverride === undefined ? { quietWhenCrowded: true as const } : {}),
    // A line end's leader keeps its end clear of later labels.
    // Over a running column the hollow marker is the mark the value names, so the nearest-mark
    // rule measures from its edge: the line's own last segment beside the seat is no rival.
    ...(s.kind === 'area' ? {} : { anchor: partialFirst.length > 0 ? { x: last.x - MARKER_R, y: last.y - MARKER_R, w: 2 * MARKER_R, h: 2 * MARKER_R } : { x: last.x, y: last.y } }),
    // A value lifted over the columns hangs on a long leader: no column total sits on it, and it
    // crosses none (a total on the leader stacks two numbers on one vertical).
    ...(aboveColumns.length > 0 ? { leaderClear: true } : {}),
    candidates: rankedSeats(seatsAtThePoint([...partialFirst, ...mirrored, ...(clearsColumns ? [aboveCenter, aboveRaised, ...(partialFirst.length > 0 ? [] : [belowCenter, belowLowered])] : []), ...(totalOnLeader ? [] : aboveColumns), ...onColumn, ...centredPast, ...(totalOnLeader ? aboveColumns : [])], last, MARKER_R, h, input.bounds, w), input.strokes, input.fills)
      .filter(candidate => !(input.totalSeats ?? []).some(seat => rectsOverlap(seat, candidate.rect, 2)))
      .filter(candidate => !clearsColumns || candidate.overColumns ||
        (!input.fills.some(fill => rectsOverlap(fill, candidate.rect, 2)) &&
          (input.bounds.y0 === undefined || candidate.rect.y >= input.bounds.y0) &&
          (input.bounds.y1 === undefined || candidate.rect.y + candidate.rect.h <= input.bounds.y1)))
      // A seat on the column stays on it: under the baseline it stands in the category label row
      // and reads as a category's label ('0.12%' where '7 Sep' would stand).
      .filter(candidate => !clearsColumns || !candidate.overColumns || input.bounds.y1 === undefined || candidate.rect.y + candidate.rect.h <= input.bounds.y1)
      .map(candidate => ({ ...candidate, outsidePlot: !clearsColumns && /^(right|left|outsideRight|outsideLeft)/.test(candidate.slot) }))
      // Past the plot's edge a value stands by the axis labels: only level with its point does it
      // read as the point's, a row off it reads as the column's or the axis's.
      .filter(candidate => !(leavesPlot(candidate, input.bounds) && candidate.slot.includes('Shifted')))
      // A line end stays inside the plot: a seat past its column that leaves the plot is
      // the last seat before the note, after every seat on the column and every led seat.
      .map((candidate, i, all) => [candidate, leavesPlot(candidate, input.bounds) ? all.length + i : i] as const)
      .sort((a, b) => a[1] - b[1]).map(([candidate]) => leavesPlot(candidate, input.bounds) ? { ...candidate, penalty: candidate.penalty + LAST_RESORT_PENALTY, tickAir: TICK_AIR } : candidate),
  };
}
