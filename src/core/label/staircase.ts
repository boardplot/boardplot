import type { Theme } from '../types/theme';
import { strokeToken } from '../theme';
/**
 * Staircase category labels (options.categoryLabels: 'staircase').
 *
 * Columns sorted by height leave a free triangle over the lower columns. Each
 * category name sits in that space, starting at its own column and running
 * away from the taller ones, one step lower than the name before it. A thin
 * vertical leader runs from a small diamond at the name's start down to just
 * above the column's total, and the category row under the axis is dropped.
 *
 * This module owns the geometry (names, diamonds, leaders) and nothing else:
 * the chart passes the column obstacles, claims the leaders, and sends the
 * names to the label solver as one fixed seat each. When a name has no seat
 * (it needs more than two lines, the names need more height than the chart
 * can give, or the solver finds a collision) the chart falls back to the
 * category row and warns `staircase-labels-fallback`.
 */

import type { Rect } from '../geometry';
import { twoLineWidth, wrapText, type FontSpec, type TextMeasurer } from '../text';
import type { Id } from '../types/cell';
import type { LintWarning, PlacedLabel, SceneNode } from '../types/scene';
import type { OccupiedIndex, OccupiedView } from './occupied';
import { PRIORITY, type LabelRequest } from './solver';
import { maxOf, minOf, pushAll } from '../arrays';

type CategoryLabelPlacement = 'axis' | 'staircase';

/**
 * Internal option set by the chart's own re-layout: `pad` is the extra
 * height over the plot the names asked for, `off` the reason the chart fell
 * back to the category row. Authored JSON cannot set it.
 */
export const STAIRCASE = Symbol('staircase');
interface StaircaseState { pad: number; off?: string; rounds?: number }

/** Diamond half-diagonal, text gap after it, vertical gap between names, gap over the total. */
const MARK = 3.5;
const TEXT_X = MARK + 5;
const STEP_GAP = 4;
const LEADER_GAP = 3;
const MAX_LINES = 2;
/** The names may take at most this share of the frame's plot height over the plot. */
export const STAIRCASE_MAX_PAD = 0.4;
const HEIGHT_FAILED = 'the names need more height over the columns than the chart can give';

export function staircaseState(options: object): StaircaseState {
  return (options as { [STAIRCASE]?: StaircaseState })[STAIRCASE] ?? { pad: 0 };
}

/** Whether the chart draws staircase names on this pass. */
export function staircaseOn(placement: CategoryLabelPlacement | undefined, options: object): boolean {
  return placement === 'staircase' && staircaseState(options).off === undefined;
}

/**
 * Names run right when the columns fall to the right, left when they rise:
 * the taller end decides.
 */
export function staircaseDirection(tops: readonly number[]): 'right' | 'left' {
  return tops.length > 1 && tops[tops.length - 1]! > tops[0]! ? 'left' : 'right';
}

/**
 * Room the band gives up on the side the names run to, so the last names
 * hold in two lines. `centers(room)` answers the column centres with that
 * room taken; three rounds settle it. Capped at 40% of the width.
 */
export function staircaseRoom(input: {
  names: readonly string[];
  font: FontSpec;
  measure: TextMeasurer;
  direction: 'right' | 'left';
  /** The text bound on that side (the frame's plot edge). */
  edge: number;
  width: number;
  centers: (room: number) => number[];
}): number {
  // The next whole pixel above the narrowest two-line width: the room stops within
  // 0.5 px of the need, so the slack keeps the last name from a cut.
  const need = input.names.map((name) => Math.floor(twoLineWidth(name, input.font, input.measure)) + 1 + TEXT_X);
  let room = 0;
  for (let round = 0; round < 3; round++) {
    const centers = input.centers(room);
    const over = Math.max(0, maxOf(centers.map((cx, i) =>
      input.direction === 'right' ? cx + need[i]! - input.edge : input.edge - (cx - need[i]!))));
    if (over < 0.5) break;
    room = Math.min(input.width * 0.4, room + Math.ceil(over));
  }
  return room;
}

interface StaircaseObstacle { x0: number; x1: number; top: number }

interface StaircaseName {
  categoryId: Id;
  text: string;
  lines: string[];
  rect: Rect;
  /** The diamond's centre: the leader's top end. */
  mark: { x: number; y: number };
  /** Where the leader stops, just above the column's total. */
  leaderEnd: number;
}

/**
 * What stands over each column, read off the claims made so far (its bars,
 * whiskers, ticks, a line crossing it), raised by `above` for the value or
 * total printed over it. `floor` is the baseline: a column with nothing
 * above it is an obstacle there.
 */
function bandObstacles(claims: OccupiedView, centers: readonly number[], half: number, floor: number, above: number): StaircaseObstacle[] {
  return centers.map((cx) => {
    const span = { x: cx - half, y: -1e5, w: 2 * half, h: floor + 1e5 };
    const tops = claims.hitsWhich(span, 0, (claim) => claim.kind === 'frame' || claim.kind === 'legend' || claim.kind === 'reserved')
      .map((claim) => claim.rect.y);
    return { x0: cx - half, x1: cx + half, top: Math.min(floor, minOf(tops)) - above };
  });
}

type StaircasePlan = { names: StaircaseName[]; deficit: number } | { failed: string };

/**
 * Seats every name, from the far end of the run back to the tallest column:
 * a name sits above every obstacle under its span and one step above the
 * name after it, so the leaders are vertical and cross no name.
 * `deficit` is how far the first name rises above `top`.
 */
function planStaircase(input: {
  ids: readonly Id[];
  names: readonly string[];
  centers: readonly number[];
  obstacles: readonly StaircaseObstacle[];
  left: number;
  right: number;
  top: number;
  font: FontSpec;
  measure: TextMeasurer;
  direction: 'right' | 'left';
}): StaircasePlan {
  const { left, right, font, measure } = input;
  const n = input.names.length;
  // Mirrored for names that run left: the plan is always drawn rightward.
  const flip = input.direction === 'left';
  const m = (x: number): number => (flip ? left + right - x : x);
  const order = Array.from({ length: n }, (_, k) => (flip ? n - 1 - k : k));
  const lineH = font.size * (font.lineHeight ?? 1.2);
  const names: StaircaseName[] = [];
  let next = Infinity;
  let highest = Infinity;
  for (let k = n - 1; k >= 0; k--) {
    const i = order[k]!;
    const cx = m(input.centers[i]!);
    const textX = cx + TEXT_X;
    const wrapped = wrapText(input.names[i]!, font, right - textX, MAX_LINES, measure);
    if (wrapped.truncated || right - textX < 1) {
      return { failed: `the name '${input.names[i]}' needs more than ${MAX_LINES} lines in the room beside its column` };
    }
    const w = Math.max(...wrapped.lines.map((line) => measure(line, font).width));
    const h = wrapped.lines.length * lineH;
    const x0 = cx - MARK - 1;
    const x1 = textX + w;
    let bottom = next - STEP_GAP;
    for (const o of input.obstacles) {
      const ox0 = Math.min(m(o.x0), m(o.x1));
      const ox1 = Math.max(m(o.x0), m(o.x1));
      if (ox1 > x0 && ox0 < x1) bottom = Math.min(bottom, o.top - LEADER_GAP - 1);
    }
    const y = bottom - h;
    next = y;
    highest = Math.min(highest, y);
    names.push({
      categoryId: input.ids[i]!,
      text: input.names[i]!,
      lines: wrapped.lines,
      rect: { x: flip ? m(textX + w) : textX, y, w, h },
      mark: { x: input.centers[i]!, y: y + lineH / 2 },
      leaderEnd: input.obstacles[i]!.top - LEADER_GAP,
    });
  }
  names.reverse();
  if (flip) names.reverse();
  return { names, deficit: Math.max(0, input.top - highest) };
}

const leaderOwner = (categoryId: Id) => ({ annotationId: `staircase:${categoryId}` });

/** Claims each diamond and leader, so no later label sits on them. */
function claimStaircase(names: readonly StaircaseName[], occupied: OccupiedIndex): void {
  for (const name of names) {
    occupied.claim({ x: name.mark.x - MARK, y: name.mark.y - MARK, w: 2 * MARK, h: Math.max(2 * MARK, name.leaderEnd - name.mark.y + MARK) },
      'annotation', leaderOwner(name.categoryId), 'staircaseLeader');
  }
}

/** One fixed seat per name; the solver checks it against everything claimed. */
function staircaseRequests(names: readonly StaircaseName[], font: FontSpec): LabelRequest[] {
  return names.map((name) => ({
    id: `category:${name.categoryId}`,
    kind: 'category',
    owner: { categoryId: name.categoryId },
    text: name.text,
    lines: name.lines,
    typeRole: 'axis',
    font,
    markAnchored: false,
    // A mirrored name stands left of its diamond: its lines hug the leader side.
    ...(name.rect.x < name.mark.x ? { align: 'end' as const } : {}),
    priority: PRIORITY.endpoint,
    candidates: [{ slot: 'staircase', rect: name.rect, penalty: 0, outsidePlot: true }],
  }));
}

/** The diamonds and leaders, in the leader token and the ink. */
function staircaseNodes(theme: Theme, names: readonly StaircaseName[]): SceneNode[] {
  return names.flatMap((name): SceneNode[] => {
    const { x, y } = name.mark;
    const owner = leaderOwner(name.categoryId);
    return [
      { t: 'line', id: `staircase:${name.categoryId}:leader`, x1: x, y1: y, x2: x, y2: name.leaderEnd, stroke: { token: 'leader' }, width: strokeToken(theme, 'rule'), owner, part: 'leader' },
      { t: 'path', id: `staircase:${name.categoryId}:mark`, d: `M${x} ${y - MARK}L${x + MARK} ${y}L${x} ${y + MARK}L${x - MARK} ${y}Z`, fill: { token: 'ink' }, owner, part: 'staircaseMark' },
    ];
  });
}

/** The fallback warning, with the fix. */
function staircaseFallbackWarning(reason: string): LintWarning {
  return {
    code: 'staircase-labels-fallback',
    severity: 'warn',
    message: `categoryLabels 'staircase' could not seat every name (${reason}); the category names print under the axis instead`,
    suggest: "sort the columns by height (sort: { categories: 'desc' }), give the chart more height or width, shorten the names, drop a line that crosses the free space (pareto: cumulative: false), or drop categoryLabels",
  };
}

/** What a pass reports: the height the names still need, or why they cannot be seated. */
export interface StaircaseOutcome { deficit: number; failed?: string }

/**
 * Plans the names over a band chart's columns, and when they fit the height
 * this pass gives, claims the leaders and adds the names to the solver's
 * requests. `cap` bounds the whole height the names may add over the plot.
 */
export function seatStaircase(input: {
  categories: readonly { id: Id; label?: string }[];
  band: { center(index: number): number; step: number };
  top: number;
  left: number;
  right: number;
  floor: number;
  above: number;
  font: FontSpec;
  measure: TextMeasurer;
  /** Column tops in category order: the taller end sets the direction. */
  tops: readonly number[];
  options: object;
  cap: number;
  occupied: OccupiedIndex;
  requests: LabelRequest[];
}): StaircasePlan {
  const { categories, band, font } = input;
  const centers = categories.map((_, i) => band.center(i));
  const plan = planStaircase({
    ids: categories.map((c) => c.id), names: categories.map((c) => c.label ?? c.id), centers,
    obstacles: bandObstacles(input.occupied, centers, band.step / 2, input.floor, input.above),
    left: input.left, right: input.right, top: input.top, font, measure: input.measure, direction: staircaseDirection(input.tops),
  });
  if ('failed' in plan) return plan;
  if (staircaseState(input.options).pad + plan.deficit > input.cap) return { failed: HEIGHT_FAILED };
  if (plan.deficit <= 0.5) {
    claimStaircase(plan.names, input.occupied);
    pushAll(input.requests, staircaseRequests(plan.names, font));
  }
  return plan;
}

/**
 * After the solve: draws the leaders when every name took its seat, and
 * reports the outcome to `settleStaircase`. A pass already fallen back warns.
 */
export function runStaircase(
  theme: Theme,
  placement: CategoryLabelPlacement | undefined,
  options: object,
  plan: StaircasePlan | undefined,
  placed: readonly PlacedLabel[],
  occupied: OccupiedView,
  nodes: SceneNode[],
  warnings: LintWarning[],
): StaircaseOutcome | undefined {
  if (placement !== 'staircase') return undefined;
  const off = staircaseState(options).off;
  if (off !== undefined) {
    warnings.push(staircaseFallbackWarning(off));
    return undefined;
  }
  if (!plan) return undefined;
  if ('failed' in plan) return { deficit: 0, failed: plan.failed };
  if (plan.deficit > 0.5) return { deficit: plan.deficit };
  const lost = plan.names.find((name) => placed.find((label) => label.id === `category:${name.categoryId}`)?.hidden !== undefined);
  if (lost) return { deficit: 0, failed: `the name '${lost.text}' meets another label or mark` };
  // The leader ends just above what the solver put under it: the total where
  // it landed, or the column itself when the total took another seat.
  for (const name of plan.names) {
    const under = occupied.hitsWhich({ x: name.mark.x - 0.5, y: name.leaderEnd, w: 1, h: 1e5 }, 0,
      (claim) => claim.owner.annotationId?.startsWith('staircase:') === true || claim.kind === 'frame' || claim.kind === 'legend' || claim.kind === 'reserved');
    if (under.length > 0) name.leaderEnd = Math.max(name.leaderEnd, minOf(under.map((claim) => claim.rect.y)) - LEADER_GAP);
  }
  pushAll(nodes, staircaseNodes(theme, plan.names));
  return { deficit: 0 };
}

/**
 * The next pass's state after an outcome that is not final: more height (as
 * the CAGR arm takes, four rounds at most), or the category row. Undefined
 * when this pass is final.
 */
export function nextStaircase(options: object, outcome: StaircaseOutcome | undefined): StaircaseState | undefined {
  if (!outcome || (outcome.failed === undefined && outcome.deficit <= 0.5)) return undefined;
  const state = staircaseState(options);
  const rounds = state.rounds ?? 0;
  if (outcome.failed === undefined && rounds < 4) return { pad: state.pad + Math.ceil(outcome.deficit) + 1, rounds: rounds + 1 };
  return { pad: 0, off: outcome.failed ?? HEIGHT_FAILED };
}

/** The column re-layout: runs passes until one is final; returns the options the later passes keep. */
export function settleStaircase<O extends object>(options: O, rerun: (next: O) => StaircaseOutcome | undefined, first: StaircaseOutcome | undefined): O {
  let outcome = first;
  for (let next = nextStaircase(options, outcome); next; next = nextStaircase(options, outcome)) {
    options = { ...options, [STAIRCASE]: next };
    outcome = rerun(options);
  }
  return options;
}
