import type { RenderTarget } from '../../types/options';
import { DEFAULT_TARGET } from '../../target';
import { readerFloorPx } from '../../typeFloors';
/**
 * Shared value-label policy for vertical columns and horizontal bars.
 *
 * The former layouts disagreed in four places. One rule now owns each case:
 * grouped marks thinner than a compact label keep labels on the first series;
 * both charts use the footnote size with the label weight for compact values;
 * an inside segment needs 4 px of room on both axes and is at least 28 px
 * wide and 14 px tall; and outside segment labels start 6 px from the mark.
 * A label that does not fit inside goes outside (beside a column on a
 * leader, past the end of a 100 % bar) or is dropped. It is never
 * kept inside on a halo: a page-colour halo on a dark fill reads as hollow
 * digits.
 */

import type { Rect } from '../../geometry';
import type { FontSpec, TextMeasurer } from '../../text';
import { PRIORITY, type LabelRequest, type SlotCandidate, type SolveCtx } from '../../label/solver';
import type { LabelContent, LabelDensity } from '../../types/options';
import type { LintWarning, PlacedLabel } from '../../types/scene';
import type { OccupiedIndex } from '../../label/occupied';
import { solidMutedPlan, strokeToken } from '../../theme';
import type { Theme } from '../../types/theme';

export type BandOrientation = 'vertical' | 'horizontal';

export interface TextSize {
  width: number;
  height: number;
}

interface SegmentLabelOptions {
  insidePaint?: SlotCandidate['insidePaint'];
  insidePattern?: SlotCandidate['insidePattern'];
  baseline?: number;
  leaderPosition?: number;
  /** Plan-tick coordinates on the leader axis that need 2 px clearance. */
  leaderObstacles?: readonly number[];
  /** The waterfall order: the outside slots before a tight inside one. */
  tightLast?: boolean;
  /** Padding rule of a chart that owns one; the size floor applies either way. */
  fits?: boolean;
  /** No seat beside the column: the value prints inside its segment or not at all. */
  insideOnly?: boolean;
}

interface GroupedLabelPolicy {
  compact: boolean;
  firstSeriesOnly: boolean;
}

/**
 * A label's parts as lines: a label that carries both the value and its
 * share prints them one over the other, the second of the two opening a line
 * of its own; any other part stays on the line it follows.
 */
export function valueShareLines(parts: readonly (readonly [LabelContent[number], string])[]): string[] {
  const value = parts.findIndex(([kind]) => kind === 'absolute');
  const share = parts.findIndex(([kind]) => kind === 'percent');
  const text = (from: number, to?: number) => parts.slice(from, to).map(([, part]) => part).join(' ');
  if (value < 0 || share < 0) return [text(0)];
  const cut = Math.max(value, share);
  return [text(0, cut), text(cut)];
}

/** The box of a label's lines: the widest line by the lines' stacked height. */
export function linesSize(lines: readonly string[], font: FontSpec, measure: TextMeasurer): TextSize {
  const sizes = lines.map((line) => measure(line || '0', font));
  return { width: Math.max(...sizes.map((size) => size.width)), height: sizes.reduce((sum, size) => sum + size.height, 0) };
}

const INSIDE_ROOM = 8;
const OUTSIDE_GAP = 6;
/** The closer seat beside a column, where the full gap leaves no room: past the leader's stub. */
const TIGHT_OUTSIDE_GAP = 3;
/** Air between an outside column label's box and a reference tick beside it. */
const TICK_CLEAR = 2;
/** Air between a tick through a segment (its stroke included) and the value's line box. */
const TICK_AIR = 1.5;
/** The smallest segment that holds a label inside. */
export const INSIDE_MIN_W = 28;
export const INSIDE_MIN_H = 14;

/**
 * Whether a label of `text` size fits inside `rect` with its padding and the
 * size floor. Across the segment the floor is the measured text plus
 * 2 × 4 px when that is less than 28 px, so a one-digit value keeps a 16 px
 * segment that holds it with its padding. A zero size asks for the floor
 * itself, the base's 28 px.
 */
export function fitsInside(rect: Rect, text: TextSize, room = INSIDE_ROOM): boolean {
  const floor = text.width > 0 ? Math.min(INSIDE_MIN_W, text.width + INSIDE_ROOM) : INSIDE_MIN_W;
  return rect.w >= Math.max(floor, text.width + room) && rect.h >= Math.max(INSIDE_MIN_H, text.height + room);
}

/**
 * labelDensity 'smart' (the default) and 'minimal' drop a segment value
 * when the segment is shorter than the label plus the inside room, measured
 * along the stack: label height on a column, label width on a bar. 'full'
 * keeps it and lets the solver move it outside on a leader. An authored
 * labelPlacements pin always wins over this gate.
 */
/**
 * The seat of a one-line number in a stacked segment shorter than its line box: the digits'
 * cap height, centred, clear of the edge, with 2 px each side, as a waterfall segment keeps
 * them. Column and waterfall segments share this rule. labelsToNodes centres the same ink bounds; the line box's leading, which carries no
 * ink, reaches past the segment's edges. A comma's tail (a fifth of the size) counts as ink
 * and the seat centres it too; an outlined segment's edge is cleared like the seam. Parentheses
 * and a dollar sign reach past the cap height, so a value that carries them keeps the full gate.
 * Undefined when the text is not a number or the digits do not fit.
 */
export function digitSeat(rect: Rect, text: string, tsize: { width: number; height: number }, capHeight: number | undefined, size: number, edge: number): Rect | undefined {
  if (capHeight === undefined || !/^[-+−\d.,\s%€£]+$/u.test(text)) return undefined;
  const tail = text.includes(',') ? size * 0.2 : 0;
  if (capHeight + tail + edge + 0.1 > rect.h || tsize.width + 4 > rect.w) return undefined;
  return { x: rect.x + rect.w / 2 - tsize.width / 2, y: rect.y + rect.h / 2 - (capHeight + tail) / 2, w: tsize.width, h: capHeight };
}

/** The width a seated value keeps clear of the segment's top and bottom: the seam, or an outlined plan segment's edge when that is wider. */
export function digitSeatEdge(theme: Theme, pattern: string | undefined): number {
  return Math.max(strokeToken(theme, 'seam'), pattern === 'outline' && !solidMutedPlan(theme) ? theme.pattern.outlineStrokeWidth : 0);
}

/**
 * Along a column stack the label's line box already carries the digits' air (its leading),
 * so a segment holds its value with 2 px over and under the line box. A 14 px stacked100
 * share then fits a 22 px segment, where an 8 px room would ask 25 px.
 */
export const STACK_ROOM = 4;

export function segmentTooShort(
  density: LabelDensity,
  segmentLength: number,
  labelLength: number,
  pin: string | undefined,
  room = INSIDE_ROOM,
): boolean {
  return !pin && density !== 'full' && segmentLength < labelLength + room;
}

/**
 * The values the sliver gate dropped, reported once per chart: a value
 * that is not on the page is something the reader lost, so it is said, not
 * hidden in silence. `names` reads "B in Q1".
 */
export function warnSliverLabels(
  warnings: LintWarning[],
  names: readonly string[],
  suggest = "set labelDensity 'full' to move them outside on leaders, or pin one with labelPlacements",
): void {
  if (names.length === 0) return;
  const shown = names.slice(0, 5).join(', ') + (names.length > 5 ? ', ...' : '');
  warnings.push({
    code: 'sliver-labels-hidden',
    severity: 'info',
    message: `${names.length} segment value${names.length === 1 ? ' is' : 's are'} not printed because the segment is shorter than its label (${shown})`,
    suggest,
  });
}

/**
 * A stacked segment label asked for its share where the stack has no honest
 * whole: one warning for the stacks with a negative part, one for the
 * rest (a missing part, an empty total). Those segments print the value only.
 */
export function warnShareParts(warnings: LintWarning[], mixedSigns: readonly string[], unavailable: readonly string[]): void {
  const list = (names: readonly string[]) => names.slice(0, 5).join(', ') + (names.length > 5 ? ', ...' : '');
  if (mixedSigns.length > 0) {
    warnings.push({
      code: 'segment-share-mixed-signs',
      severity: 'warn',
      message: `a share of a stack with a negative part has no meaning, so the segment labels of ${list(mixedSigns)} print the value without its share`,
      suggest: 'show signed contributions as a waterfall or variance chart, or drop \'percent\' from labels.segment',
    });
  }
  if (unavailable.length > 0) {
    warnings.push({
      code: 'label-part-unavailable',
      severity: 'warn',
      message: `the segment labels of ${list(unavailable)} print no share: the stack has a missing part or no positive total to take a share of`,
      suggest: 'complete the stack, or drop \'percent\' from labels.segment',
    });
  }
}

/**
 * On bar and column: with no value axis drawn, a value label is the only
 * way to read its bar, so 'minimal' density (the tight compact band's) never
 * drops one. Its priority is lifted just into the band 'minimal' keeps, in
 * its own order; collisions still hide it, and annotations keep their own.
 */
export function keepValuesWithoutAxis(requests: LabelRequest[], density: LabelDensity, axisShown: boolean): LabelRequest[] {
  if (density !== 'minimal' || axisShown) return requests;
  return requests.map((request) => (request.kind === 'point' || request.kind === 'segment') && request.priority < PRIORITY.endpoint
    ? { ...request, priority: PRIORITY.endpoint + request.priority / 1000 }
    : request);
}

/**
 * A stacked part keeps its label when a value line crosses it. The seats the
 * line leaves clear come first (the part's stretches past the line); the
 * inside seat across the line comes after them, on a halo, before any seat
 * outside the part.
 */
export function acrossValueLines(seats: SlotCandidate[]): SlotCandidate[] {
  const inside = seats.findIndex((seat) => seat.insideFill === undefined);
  const held = inside < 0 ? seats : seats.slice(0, inside);
  if (held.length === 0) return seats;
  const across = { ...held[0]!, slot: `${held[0]!.slot}Across`, penalty: held[held.length - 1]!.penalty + 0.05, overValueLines: true };
  return [...held, across, ...seats.slice(held.length)];
}

/**
 * Seats that keep their place when a value line (an average, a target, a
 * benchmark) runs across them. The rule breaks around the glyphs when the
 * scene is built, and a label across one sits on a halo, so the rule never
 * costs a part, a total or a name its label.
 */
export function overValueLines(seats: SlotCandidate[]): SlotCandidate[] {
  return seats.map((seat) => ({ ...seat, overValueLines: true }));
}

/**
 * A value label a reference rule runs through (an
 * average, a median, a mean line) sits on a halo, so the rule never cuts its
 * digits. The claims tagged 'referenceLine' are the rules the chart drew.
 */
export function haloOverRules(placed: PlacedLabel[], occupied: Pick<OccupiedIndex, 'hitsWhich'>, rules: ReadonlySet<string> = new Set(['referenceLine'])): Set<string> {
  const crossed = new Set<string>();
  for (const label of placed) {
    if (label.hidden) continue;
    if (!occupied.hitsWhich(label.rect, 0).some((claim) => claim.part !== undefined && rules.has(claim.part))) continue;
    label.halo = true;
    crossed.add(`label:${label.id}`);
  }
  return crossed;
}

/**
 * The rules draw after the labels, so a halo alone would lie under them: the
 * text nodes of the crossed labels move to the top of the scene, their halo
 * over the rule.
 */
export function raiseOverRules<N extends { id: string }>(scene: N[], crossed: ReadonlySet<string>): N[] {
  if (crossed.size === 0) return scene;
  return [...scene.filter((node) => !crossed.has(node.id)), ...scene.filter((node) => crossed.has(node.id))];
}

export function compactValueLabelFont(label: FontSpec, footnote: FontSpec, target: RenderTarget = DEFAULT_TARGET, textScale = 1): FontSpec {
  return { ...footnote, family: label.family, weight: label.weight,
    size: Math.min(label.size, Math.max(footnote.size, readerFloorPx(target, 'label', textScale))) };
}

export function groupedValueLabelPolicy(
  orientation: BandOrientation,
  segmentBreadth: number,
  seriesCount: number,
  normalSizes: readonly TextSize[],
  normalFontSize: number,
  compactFontSize: number,
): GroupedLabelPolicy {
  const firstSeriesOnly =
    seriesCount > 1 && segmentBreadth + 1 < compactFontSize * 0.9;
  const compact = orientation === 'vertical'
    ? normalSizes.some((size) => size.width > segmentBreadth + 2)
    : segmentBreadth < normalFontSize * 1.2 + 2;
  return { compact, firstSeriesOnly };
}

export function compactValueTextSize(
  orientation: BandOrientation,
  measured: TextSize,
  fontSize: number,
): TextSize {
  if (orientation === 'vertical') return measured;
  return { ...measured, height: Math.ceil(fontSize * 0.9 * 2) / 2 };
}

/** The air neighbouring value labels keep where their rows overlap. */
const VALUE_LABEL_NEIGHBOUR_GAP = 6;

/**
 * Whether two neighbouring value labels, at their natural seats,
 * stand closer than VALUE_LABEL_NEIGHBOUR_GAP while their heights overlap.
 * A crowded row steps its font down one step as a whole before placing.
 */
export function valueRowCrowded(seats: readonly (Rect | null | undefined)[]): boolean {
  const row = seats.filter((seat): seat is Rect => !!seat).sort((a, b) => a.x - b.x);
  return row.some((a, i) => {
    const b = row[i + 1];
    return b !== undefined && b.x - (a.x + a.w) < VALUE_LABEL_NEIGHBOUR_GAP && a.y < b.y + b.h && b.y < a.y + a.h;
  });
}

export function bandValueLabelUniformity(): NonNullable<SolveCtx['seriesUniform']> {
  return { kinds: ['point'] };
}

export function segmentLabelCandidates(
  orientation: BandOrientation,
  rect: Rect,
  textSize: TextSize,
  fillCss: string,
  options: SegmentLabelOptions = {},
): SlotCandidate[] {
  const fits = options.fits === undefined
    ? fitsInside(rect, textSize)
    : options.fits && fitsInside(rect, { width: 0, height: 0 });
  const inside = insideCandidate(orientation, rect, textSize, fillCss, options.baseline);
  inside.insidePaint = options.insidePaint;
  inside.insidePattern = options.insidePattern;
  // Tight: the line box fits without the room, over the size floor. The
  // glyphs still read inside; a label wider or taller than its segment never
  // stays there (it would straddle the fill edge on a halo).
  const tight = !fits && fitsInside(rect, textSize, 0) ? { ...inside, slot: 'insideTight', penalty: 1 } : undefined;
  const leaderPosition = options.leaderPosition ?? clearLeaderPosition(
    orientation,
    rect,
    options.leaderObstacles,
  );
  const outside = options.insideOnly ? [] : outsideCandidates(orientation, rect, textSize, leaderPosition, options.leaderObstacles);
  if (fits) return [inside, ...clearOfTicks(rect, textSize, inside, options.leaderObstacles), ...outside];
  if (!tight) return outside;
  return options.tightLast ? [...outside, tight] : [tight, ...outside];
}

/**
 * A reference tick (a PY or plan line) through a column segment takes the
 * centred seat. The value stays inside its own segment, centred in the
 * largest stretch the ticks leave, before it goes outside: beside the column
 * it stood level with the tick's end and read as the tick's value. The stretch holds the label's line box, whose leading
 * is the digits' air, so the seat takes no further pad.
 */
function clearOfTicks(rect: Rect, textSize: TextSize, inside: SlotCandidate, ticks: readonly number[] = []): SlotCandidate[] {
  const cuts = ticks.filter((tick) => tick > rect.y && tick < rect.y + rect.h).sort((a, b) => a - b);
  if (cuts.length === 0) return [];
  const edges = [rect.y, ...cuts.flatMap((tick) => [tick - TICK_AIR, tick + TICK_AIR]), rect.y + rect.h];
  const windows: { top: number; h: number }[] = [];
  for (let i = 0; i < edges.length; i += 2) windows.push({ top: edges[i]!, h: edges[i + 1]! - edges[i]! });
  return windows
    .filter((window) => window.h >= textSize.height)
    .sort((a, b) => b.h - a.h)
    .map((window, index) => ({
      ...inside,
      slot: `insideClear${index}`,
      rect: { ...inside.rect, y: window.top + window.h / 2 - textSize.height / 2 },
      penalty: 0.5 + index / 10,
      pad: 0,
    }));
}

function clearLeaderPosition(
  orientation: BandOrientation,
  rect: Rect,
  obstacles?: readonly number[],
): number | undefined {
  if (!obstacles) return undefined;
  const position = orientation === 'vertical'
    ? rect.y + rect.h / 2
    : rect.x + rect.w / 2;
  let nearest: number | null = null;
  for (const obstacle of obstacles) {
    if (
      Math.abs(obstacle - position) <= 3 &&
      (nearest === null || Math.abs(obstacle - position) < Math.abs(nearest - position))
    ) {
      nearest = obstacle;
    }
  }
  return nearest === null ? position : position + (nearest > position ? -2 : 2);
}

function insideCandidate(
  orientation: BandOrientation,
  rect: Rect,
  textSize: TextSize,
  fillCss: string,
  baseline?: number,
): SlotCandidate {
  return {
    slot: 'insideCenter',
    rect: {
      x: rect.x + rect.w / 2 - textSize.width / 2,
      y: orientation === 'vertical'
        ? insideCenterY(rect, textSize.height, baseline)
        : rect.y + rect.h / 2 - textSize.height / 2,
      w: textSize.width,
      h: textSize.height,
    },
    penalty: 0,
    insideFill: fillCss,
  };
}

/**
 * The top of an outside label beside a column, centred on the segment unless a
 * reference tick (a PY or plan line across the column) runs through its box.
 * A value level with the end of that line reads as the line's own value,
 * so the box moves just clear of it, to the side where more of the segment is.
 */
function besideTop(rect: Rect, height: number, ticks: readonly number[] = []): number {
  const cy = rect.y + rect.h / 2;
  let top = cy - height / 2;
  for (const tick of ticks) {
    if (tick < top - TICK_CLEAR || tick > top + height + TICK_CLEAR) continue;
    top = tick < cy ? tick + TICK_CLEAR : tick - TICK_CLEAR - height;
  }
  return top;
}

function outsideCandidates(
  orientation: BandOrientation,
  rect: Rect,
  textSize: TextSize,
  leaderPosition?: number,
  ticks?: readonly number[],
): SlotCandidate[] {
  const cy = rect.y + rect.h / 2;
  if (orientation === 'vertical') {
    const leaderY = leaderPosition ?? cy;
    const y = besideTop(rect, textSize.height, ticks);
    const seat = (slot: string, side: 'right' | 'left', gap: number, top: number, penalty: number): SlotCandidate => ({
      slot,
      rect: { x: side === 'right' ? rect.x + rect.w + gap : rect.x - gap - textSize.width, y: top, w: textSize.width, h: textSize.height },
      penalty,
      leaderFrom: { x: side === 'right' ? rect.x + rect.w : rect.x, y: leaderY },
    });
    // A thin segment's value stands taller than the segment, so level with it
    // the value reaches the connectors that leave the column's top and meet
    // its foot. After the level seats: no higher than the segment's top, then
    // no lower than its foot, then the same a step closer to the column
    // (TIGHT_OUTSIDE_GAP). Between two narrow bars ebit-bridge-compact's
    // +6 and +11 volume went unlabelled while their segments were drawn.
    const under = Math.max(y, rect.y);
    const over = Math.min(y, rect.y + rect.h - textSize.height);
    const shifted = [...new Set([under, over])].filter((top) => top !== y);
    return [
      seat('outsideRight', 'right', OUTSIDE_GAP, y, 2),
      seat('outsideLeft', 'left', OUTSIDE_GAP, y, 3),
      ...shifted.flatMap((top, k) => [seat(`outsideRight${k ? 'Over' : 'Under'}`, 'right', OUTSIDE_GAP, top, 4), seat(`outsideLeft${k ? 'Over' : 'Under'}`, 'left', OUTSIDE_GAP, top, 4)]),
      ...[y, ...shifted].flatMap((top, k) => [seat(`outsideRightTight${k || ''}`, 'right', TIGHT_OUTSIDE_GAP, top, 5), seat(`outsideLeftTight${k || ''}`, 'left', TIGHT_OUTSIDE_GAP, top, 5)]),
    ];
  }
  // A horizontal bar has no outside seat for an inner segment: above or
  // below it the value stands between two rows and reads as either.
  // The row's end is the chart's to offer (bar/labels.ts).
  return [];
}

/**
 * Center a label inside a vertical segment without letting baseline ink push
 * an otherwise valid label out by a fraction of a pixel.
 */
export function insideCenterY(
  host: Rect,
  labelH: number,
  baselineY?: number,
  pad = 2,
  ink = 1,
): number {
  const centered = host.y + host.h / 2 - labelH / 2;
  if (baselineY === undefined) return centered;
  const hostBottom = host.y + host.h;
  const eps = 0.05;
  if (Math.abs(hostBottom - baselineY) < 0.01) {
    const overlap = centered + labelH + pad - (baselineY - ink / 2);
    if (overlap <= 0) return centered;
    const spare = centered - host.y - pad;
    return centered - Math.min(overlap + eps, Math.max(0, spare));
  }
  if (Math.abs(host.y - baselineY) < 0.01) {
    const overlap = baselineY + ink / 2 - (centered - pad);
    if (overlap <= 0) return centered;
    const spare = hostBottom - (centered + labelH) - pad;
    return centered + Math.min(overlap + eps, Math.max(0, spare));
  }
  return centered;
}
