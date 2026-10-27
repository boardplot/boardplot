/**
 * The label solver. Charts declare a LabelPlan (which
 * strategies + slot generators per label kind), build LabelRequests, and the
 * solver places them against the shared OccupiedIndex.
 *
 * Normative behavior implemented here — charts never reimplement:
 * - candidate cascade: first non-colliding candidate wins (candidatesOccupied)
 * - backing rects (cascade step 2) via SlotCandidate.needsBacking
 * - leader lines (cascade step 4) via SlotCandidate.leaderFrom
 * - density gates: 'minimal' keeps totals/endpoints/highlights only
 * - pins are solved FIRST (they win contested space against free labels) but
 *   are collision-checked like everything else: a pin that cannot be honoured
 *   is refused out loud ('pin-blocked') and falls back to the cascade. The
 *   rule that a visible label never overlaps anything outranks a placement request,
 *   because a reader cannot see that a pin was involved.
 * - priority bands: grandTotal 900 · total 800 · valueLine 700 · endpoint 600
 *   · extreme 500 · interior 100 · +250 highlight (PRIORITY constants below)
 * - auto-ink via luminance against the slot's fill (inside slots)
 *
 * The 1-D strategies (sweepHide / spread1D from
 * ../collide) are candidate-generation helpers: charts use them to compute
 * slot positions for dense label rows, then feed the results here so every
 * label still registers into the one OccupiedIndex.
 */

import type { Rect } from '../geometry';
import { boxGap, inflate, rectContains, rectsOverlap, segmentHitsRect, type Point } from '../geometry';
import { labelTypeRole } from '../textRole';
import { pickInk } from '../color';
import { leaderPath } from '../svgPath';
import type { FontSpec, TextMeasurer } from '../text';
import type { Id, OwnerRef, SlotId } from '../types/cell';
import type { FocusInput, LabelDensity, LabelKind } from '../types/options';
import type { OccupiedRect, Paint, PlaceDecision, PlacedLabel, LintWarning, TextRole } from '../types/scene';
import { createOccupiedIndex, type OccupiedClaim, type OccupiedIndex } from './occupied';
import { besideOtherPoint, leaderReadsAsOwn, pointOwnership, readsAsOwnPoint, type PointOwnership, type PointOwnershipInput } from './ownership';

/** Normative priority bands. */
/** The air between two side-by-side values of one series. */
export const SERIES_VALUE_GAP = 6;
/** Column and stack totals: one row of values that keeps SERIES_VALUE_GAP between neighbours (type steps). */
const TOTAL_KINDS: ReadonlySet<string> = new Set(['total', 'grandTotal']);
const TOTAL_PART = 'totalValue';
/** The part of an area fill's claims: a value of another series may sit wholly on that fill (SlotCandidate.onFill). */
export const AREA_FILL_PART = 'areaFill';

export const PRIORITY = {
  reference: 1500,
  grandTotal: 900,
  total: 800,
  valueLine: 700,
  endpoint: 600,
  extreme: 500,
  interior: 100,
  highlightBonus: 250,
} as const;

/**
 * the priority a focused owner's labels gain while the focus is active.
 * Deliberately the same weight as an authored `highlight` bonus, so a transient
 * focus and a permanent emphasis rank alike and neither invents a new band. The
 * bonus is applied to the SORT KEY only; `PlacedLabel.priority` keeps the
 * authored value so decisions, warnings and claims stay reproducible.
 */
const focusBonus = PRIORITY.highlightBonus;

/**
 * Whether `focus` selects the label `owner`. The DIRECTION is deliberate: the
 * label's owner must carry EVERY key the focus names, with the same defined
 * value, so the focus owner is a subset of the label owner.
 *
 * - series-only   { seriesId }             matches that series' points, totals,
 *                                          segments and endpoints
 * - category-only { categoryId }           matches every series in that category
 * - exact point   { seriesId, categoryId }  matches only labels carrying BOTH
 * - { seriesId } against a category-only total (no seriesId) does NOT match
 *
 * The reverse test would overmatch: an exact-point focus would also select that
 * series' totals and endpoints, which the reader did not point at. The
 * `!== undefined` guard keeps a focus key with an undefined value from matching
 * an owner that simply lacks that key.
 */
function focusMatches(owner: OwnerRef, focus: FocusInput): boolean {
  const keys = Object.keys(focus.owner) as (keyof OwnerRef)[];
  return keys.length > 0 && keys.every((key) => focus.owner[key] !== undefined && focus.owner[key] === owner[key]);
}

/**
 * Deterministic order: pinned first, then priority desc, then `order`, then id. A focused
 * owner's labels sort as if they carried `focusBonus`, and the bonus is confined
 * to this sort key. It never touches the density gate (which still reads the
 * authored priority) or collision testing, so a focused label that does not fit
 * is still hidden exactly as before.
 */
function labelOrder(pinOf: (request: LabelRequest) => SlotId | undefined, focus: FocusInput | null | undefined, useOrder = true) {
  const boost = (request: LabelRequest): number => (focus && focusMatches(request.owner, focus) ? focusBonus : 0);
  return (a: LabelRequest, b: LabelRequest): number => {
    const pa = pinOf(a) ? 1 : 0;
    const pb = pinOf(b) ? 1 : 0;
    if (pa !== pb) return pb - pa;
    const sa = a.priority + boost(a);
    const sb = b.priority + boost(b);
    if (sa !== sb) return sb - sa;
    if (useOrder && a.order !== undefined && b.order !== undefined && a.order !== b.order) return a.order - b.order;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

export interface SlotCandidate {
  slot: SlotId;
  rect: Rect;
  penalty: number;
  /** Optional multi-line text override for wrapped candidate slots. */
  lines?: string[];
  /** A deliberate gutter seat, such as a line endpoint. Canvas bounds still apply. */
  outsidePlot?: boolean;
  /** A seat nearer another mark than its own: kept for a value that must not be lost, not for an optional one. */
  lastResort?: true;
  needsBacking?: boolean;
  /** How a needsBacking slot gets its contrast: a halo (default) or an opaque box (map chips). */
  contrast?: 'halo' | 'box';
  /**
   * The slot may sit on column marks (parts 'segment' and 'bar') of any
   * series. Used with needsBacking: a line value whose point lies inside a
   * column is drawn at its point with a halo. Text and every other mark
   * still block.
   */
  overColumns?: boolean;
  /**
   * Air this seat keeps from a tick label column (a bare
   * value there reads as a tick). A line end past the plot's edge keeps a few
   * pixels; other seats only keep out of the column.
   */
  tickAir?: number;
  /**
   * A reference line (part 'referenceLine', such as an average marker) does
   * not block this slot; a label placed across one gets a halo. For the one
   * seat that keeps a row of values on one reading line: a value floated
   * above the line, or into its bar, breaks that line for the one bar that
   * reaches it.
   */
  overRules?: boolean;
  /** The seat lies on the key line, right of its entries: the legend's whole-row claim does not block it (the chart checked the entries). */
  overLegend?: boolean;
  leaderFrom?: { x: number; y: number };
  /**
   * When `leaderFrom` lies under the label's own span, draw the leader
   * from above or below (a callout over its slice). Without it such a seat
   * draws no leader, as a label touching its mark needs none.
   */
  leaderVertical?: boolean;
  /** Upper bound for a custom leader, such as an annotation glyph connector. */
  leaderLengthBound?: number;
  /** How far, in px, a mark value's seat may stand from its natural seat, in place of the label-line steps. */
  reach?: number;
  /**
   * Collision pad for this slot alone, over the request's and the context's.
   * For an inside seat whose own geometry already keeps the air it needs.
   */
  pad?: number;
  /** Fill behind this slot (inside placements) — drives auto-ink. */
  insideFill?: string;
  /** Original fill recipe, retained for paint-only theme changes. */
  insidePaint?: Paint;
  insidePattern?: import('../types/scene').HatchPattern | 'outline';
  /** Identity key box drawn with the label in this slot only (the request's swatch holds for every slot). */
  swatch?: Paint;
  /**
   * The seat lies wholly on another series' area fill, the pad under its top
   * edge and over its bottom edge (label/areaGround.ts): that fill's claims (part AREA_FILL_PART) do not
   * block it, and the text takes its ink against the fill, as an inside value
   * does. Ownership, other labels and every other mark still count.
   */
  onFill?: { seriesId: Id; fill: string; paint: Paint; pattern?: import('../types/scene').HatchPattern };
}

export interface LabelRequest {
  id: Id;
  kind: LabelKind;
  owner: OwnerRef;
  text: string;
  lines: string[];
  font: FontSpec;
  priority: number;
  pinnedSlot?: SlotId;
  /** Seat order among equal priorities (a column's index), before the id. */
  order?: number;
  /** Degrees, clockwise, about the anchor: the candidate rects are then axis-aligned boxes. */
  rotate?: number;
  /** Collision pad for this request alone; the context pad otherwise. */
  pad?: number;
  /** Automatic placement limit in pixels. Collision-free authored pins retain precedence. */
  maxLeaderLength?: number;
  /** A computed value must keep its mark without a leader or an ambiguous fallback. */
  noLeader?: true;
  /** Candidates were checked against the exact own stroke; its coarse boxes need no extra air. */
  ownStrokeClear?: true;
  /** This numeric label names a mark rather than a separate readout rail. false: a name or other text, never bound to the plot. */
  markAnchored?: boolean;
  /** Authored value text stays eligible when the planner ranks engine values. */
  keepWhenDense?: true;
  /** An engine value outside the guaranteed set, or one its chart already reports lost: with no free seat it drops as `density` and the frame notes it. */
  quietWhenCrowded?: true;
  /**
   * Air to keep from another owner's label, beyond `pad`. Two names a line
   * apart read as one two-line name, so a seat closer than this to another
   * owner's label comes after the seats of its penalty that keep it. Seats
   * are then taken by penalty first; the crowded ones stay offered, so the
   * gap alone never hides a label.
   */
  labelGap?: number;
  /**
   * The values of one row without a series (variance deltas, one per category). They keep
   * SERIES_VALUE_GAP from each other like the values of one series: closer, two read as one
   * number. At the S widths, 12 px values fit 2 px apart.
   */
  valueRow?: true;
  candidates: SlotCandidate[]; // ordered = the placement cascade for this kind
  /** Suppress instead of place (redundancy gates decided by the chart). */
  /**
   * The chart decided this label should not be drawn. `suppressedAs` says
   * WHY, because the reason is published in `hidden` and a reader (or an
   * agent) uses it to decide whether the omission is benign.
   *
   * 'redundant' means the information is on the canvas elsewhere — dropping
   * it costs nothing. 'density' means it did NOT fit — the reader has lost
   * something. Slope re-entered density drops through this flag and they
   * were published as redundant, which is how seven series ended up named
   * nowhere with the scene claiming their labels were surplus.
   */
  redundant?: boolean;
  suppressedAs?: 'redundant' | 'density';
  /**
   * Drop only when this replacement label was actually placed. The chart sets it where the
   * replacement prints the same value (a one-part stack and its total), whatever the format.
   */
  printedIn?: Id;
  /** The marks whose value this label prints (PlacedLabel.printsFor). */
  printsFor?: OwnerRef[];
  claimId?: Id;
  claimText?: string;
  noteText?: string;
  /** A reader loses this value when it is hidden: the note line names it (class 2), with `noteText`. */
  owed?: true;
  /** Identity key box carried onto the placed label (candidate rects must
   * already reserve its width). */
  swatch?: Paint;
  /**
   * The untruncated text, set by the chart when the drawn lines were cut.
   * It reaches the reader as the text node's `<title>`, so an ellipsis never
   * costs the name outright.
   */
  title?: string;
  /**
   * The one-step-smaller font the truncation policy chose for this label
   * (src/core/label/fitText.ts). The placed label carries it, and emission
   * draws it instead of the chart's label font.
   */
  fontStep?: FontSpec;
  /** Text role when the kind implies the wrong one (a scatter name, authored prose). */
  role?: TextRole;
  /** Each line centred in the label box (a multi-line value label) or set flush right in it ('end': a mirrored staircase name, a gap bracket caption); start-aligned otherwise. */
  align?: 'start' | 'middle' | 'end';
  /** Styled runs of a one-line label, carried onto its text node (a bar gap's regular word and bold number). */
  runs?: { text: string; weight?: number }[];
  /** The first this many lines print in `headWeight` and `headInk`, the rest in the label's font (a bar CAGR's series name over its rate). */
  headLines?: number;
  headWeight?: number;
  headInk?: Paint;
  /** Ink of the lines after the head lines (a tornado driver's muted input range). */
  bodyInk?: Paint;
  /** Font of the lines after the head lines, when it is smaller than the label's (a partial total's to-date words). */
  bodyFont?: FontSpec;
  /**
   * A label the exhibit cannot lose, such as a highlighted mark's value or a
   * flagged period's value. It is the last label to drop: the density gates
   * pass it, and when every candidate is blocked only by a reference line it
   * stands across that line on a halo.
   */
  protect?: boolean;
  /** A highlighted mark's label: drawn in the emphasis weight and the full ink (PlacedLabel.emphasis). */
  emphasis?: boolean;
  /**
   * The nearest-mark rule. The point or box this label names or
   * values: a line's endpoint, a dot, a bar. With it, a seat counts as
   * ambiguous when another owner's mark is nearer to the label box than the
   * anchor (a value 40 px over a step reads as the step's value). The cascade then takes the first free seat that is not ambiguous;
   * when every free seat is, it takes the first one and draws a leader from
   * the anchor. A seat whose own leader is drawn is never ambiguous.
   */
  anchor?: { x: number; y: number; w?: number; h?: number };
  /**
   * The label's drawn leader crosses no other label: a seat whose leader
   * would is passed over, and a placed leader claims its run, so no later
   * label sits on it (scatter names and values).
   */
  /** 'includingPins' also claims and checks pinned leaders. Legacy pins keep their old behavior. */
  leaderClear?: boolean | 'includingPins';
  /**
   * Like `leaderClear`, but leaders of such labels may share a run with each
   * other (a gantt lane fans out from one row): a seat whose leader would
   * cross a placed label is passed over, and no later label sits on a placed
   * leader.
   */
  leaderAvoidsLabels?: boolean;
  /** With `leaderClear`: a seat whose leader crosses an axis tick label is passed over too, such as a rank number. */
  leaderClearsAxis?: boolean;
}

export interface SolveCtx {
  density: LabelDensity;
  pins: Record<Id, SlotId>;
  measure: TextMeasurer;
  plot: Rect;
  /** Full canvas — candidates outside it are rejected. */
  canvas?: Rect;
  /** Ink tokens resolved by the caller's theme. */
  darkInk?: string;
  lightInk?: string;
  labelPad?: number;
  /**
   * Active-source focus. Labels whose owner is selected by the focus sort
   * as if they carried `focusBonus` more priority, and nothing else changes:
   * they are still collision-checked, still subject to the density gate and
   * still hidden when they do not fit. A focused label wins the contested
   * slot, never a free pass into an occupied one.
   */
  focus?: FocusInput | null;
  /**
   * Uniform outcome per series for these label kinds: when more
   * than `maxHiddenShare` (default 0.25) of a series' labels lose to
   * collisions, the whole series drops its labels with one warning instead
   * of leaving a scatter of survivors the reader cannot interpret.
   */
  seriesUniform?: { kinds: LabelKind[]; maxHiddenShare?: number };
  /** Ordered computed rows: keep all, every second from the end when allowed, or none. */
  valueRows?: { ids: readonly Id[]; alternate?: boolean }[];
  /**
   * The drawn line points of the plot. With it, a value
   * label on a line point takes a seat only where it reads as that point's
   * value (./ownership.ts); a seat that does not waits behind every seat that
   * does, with a leader to its point, or is dropped.
   */
  pointOwnership?: PointOwnershipInput;
}

/** What a chart's options say about its labels. */
interface LabelCtxOptions {
  focus?: FocusInput | null;
  labelDensity?: LabelDensity;
  labelPlacements?: Record<Id, SlotId>;
}

/**
 * A chart's solver context: the authored focus, density and pins, the canvas
 * of `size` and the theme's two inks. `rest` sets the measurer, the plot and
 * the label pad, and overrides any of the others.
 */
export function labelCtx(
  theme: { color: { ink: string; inkInverse: string } },
  size: { width: number; height: number },
  options: LabelCtxOptions,
  rest: Pick<SolveCtx, 'measure' | 'plot' | 'labelPad'> & Partial<SolveCtx>,
): SolveCtx {
  return {
    focus: options.focus,
    density: options.labelDensity ?? 'smart',
    pins: options.labelPlacements ?? {},
    canvas: { x: 0, y: 0, w: size.width, h: size.height },
    darkInk: theme.color.ink,
    lightInk: theme.color.inkInverse,
    ...rest,
  };
}

export interface SolveResult {
  placed: PlacedLabel[];
  decisions: PlaceDecision[];
  warnings: LintWarning[];
  /** Line values whose seats ownership limited (some seat did not read as their own point's value). */
  ownershipLimited?: ReadonlySet<Id>;
}

const DENSITY_MIN_PRIORITY = PRIORITY.endpoint; // 'minimal' keeps >= endpoint band
const REQUIRED_VALUE_PRIORITY = PRIORITY.valueLine;

export function solveLabels(requests: LabelRequest[], occupied: OccupiedIndex, ctx: SolveCtx): SolveResult {
  if (!ctx.valueRows?.length) return solveLabelPass(requests, occupied, ctx);
  const initial = occupied.snapshot();
  const pinned = new Set(requests.filter(req => req.pinnedSlot ?? ctx.pins[req.id]).map(req => req.id));
  const rows = ctx.valueRows.map(row => ({ ...row, eligible: [] as Id[], mode: 'all' as 'all' | 'alternate' | 'none', reason: '' }));
  const dropped = new Set<Id>();
  // With several rows, a failed pass can advance other rows too. Keep that order.
  // Without pins or replacement links, only the declared redundancy gate can
  // produce hidden='redundant'; density drops still count, exactly as in the pass.
  if (rows.length === 1 && pinned.size === 0 && ctx.density !== 'minimal' && !ctx.seriesUniform && !requests.some(req => req.printedIn)) {
    const row = rows[0]!;
    const byId = new Map(requests.map(req => [req.id, req]));
    if (byId.size === requests.length && new Set(row.ids).size === row.ids.length) {
      row.eligible = row.ids.filter(id => {
        const req = byId.get(id);
        return req && !(req.redundant && req.suppressedAs !== 'density');
      });
      while (row.mode !== 'none' && row.eligible.length >= 2) {
        // Every kept label needs a candidate. Ownership can only remove seats
        // or add leaders to them; it cannot give an empty request a seat.
        const unseated = row.eligible.find(id => !dropped.has(id) && byId.get(id)!.candidates.length === 0);
        if (unseated === undefined) break;
        const skipped = row.mode;
        row.mode = row.mode === 'all' && row.alternate ? 'alternate' : 'none';
        row.reason = `computed row ${row.mode === 'alternate' ? 'uses alternate values from the end' : 'omitted'}; skipped ${skipped}: no candidate for '${unseated}'`;
        row.eligible.forEach((id, index) => {
          if (row.mode === 'none' || (row.eligible.length - 1 - index) % 2 !== 0) dropped.add(id);
        });
      }
    }
  }
  // Each row can move only from all to alternate to none. Every retry starts
  // before any label claim, so dropped neighbours cannot block or move a kept label.
  for (;;) {
    const attempt = createOccupiedIndex(ctx.plot);
    attempt.tickColumns = occupied.tickColumns;
    for (const claim of initial) attempt.claim(claim.rect, claim.kind, claim.owner, claim.part, claim.polygon);
    const result = solveLabelPass(requests.map(req => dropped.has(req.id)
      ? { ...req, redundant: true, suppressedAs: 'density' as const } : req), attempt, ctx);
    const byId = new Map(result.placed.map(label => [label.id, label]));
    let retry = false;
    for (const row of rows) {
      if (row.mode === 'none') continue;
      if (row.mode === 'all') row.eligible = row.ids.filter(id => {
        const label = byId.get(id);
        return label && label.hidden !== 'redundant' && !label.printedIn;
      });
      const failed = row.eligible.filter(id => !dropped.has(id) && byId.get(id)?.hidden);
      if (row.eligible.length < 2 || failed.length === 0) continue;
      row.mode = row.mode === 'all' && row.alternate ? 'alternate' : 'none';
      row.reason = `computed row ${row.mode === 'alternate' ? 'uses alternate values from the end' : 'omitted'}; unplaced: ${failed.join(', ')}`;
      row.eligible.forEach((id, index) => {
        if (!pinned.has(id) && (row.mode === 'none' || (row.eligible.length - 1 - index) % 2 !== 0)) dropped.add(id);
      });
      retry = true;
    }
    if (retry) continue;
    const decisionById = new Map<Id, PlaceDecision>();
    if (dropped.size > 0) for (const decision of result.decisions) {
      if (!decisionById.has(decision.labelId)) decisionById.set(decision.labelId, decision);
    }
    for (const row of rows) for (const id of row.eligible) if (dropped.has(id)) {
      const decision = decisionById.get(id);
      if (decision) decision.reason = row.reason;
    }
    for (const claim of attempt.snapshot().slice(initial.length)) occupied.claim(claim.rect, claim.kind, claim.owner, claim.part, claim.polygon);
    return result;
  }
}

/** `occupied.hitsWhich(rect, pad).some(test)`, without building the list where the index can. `test` must not query the index. */
function anyHit(occupied: OccupiedIndex, rect: Rect, pad: number, test: (claim: OccupiedClaim) => boolean): boolean {
  return occupied.some ? occupied.some(rect, pad, test) : occupied.hitsWhich(rect, pad).some(test);
}

function solveLabelPass(requests: LabelRequest[], occupied: OccupiedIndex, ctx: SolveCtx): SolveResult {
  const placed: PlacedLabel[] = [];
  const decisions: PlaceDecision[] = [];
  const warnings: LintWarning[] = [];
  const hiddenWarningByLabel = new Map<Id, LintWarning>();
  const printedIn = new Map(requests.flatMap(req => req.printedIn ? [[req.id, req.printedIn] as const] : []));
  const pad = ctx.labelPad ?? 2;
  const darkInk = ctx.darkInk ?? '#111827';
  const lightInk = ctx.lightInk ?? '#ffffff';

  // Effective pins: explicit request pins + ctx.pins by label id.
  const pinOf = (r: LabelRequest): SlotId | undefined => r.pinnedSlot ?? ctx.pins[r.id];

  // A value on a line point keeps to seats that read as its point's value.
  const ownership = ctx.pointOwnership ? pointOwnership(ctx.pointOwnership) : undefined;
  const owned = ownership ? withOwnedSeats(requests, ownership, pinOf) : requests;
  const ownedPoint = (req: LabelRequest): boolean => req.kind === 'point' && ownership?.pointOf(req.owner.seriesId, req.owner.categoryId) !== undefined;
  const ownershipLimited = new Set(owned.flatMap((req, i) => req !== requests[i] ? [req.id] : []));
  // Deterministic order: pinned first, then priority desc, then id.
  const order = [...owned].sort(labelOrder(pinOf, ctx.focus));

  // Placed leaders of leaderAvoidsLabels requests: no later label sits on one.
  const leaderRuns: [Point, Point][] = [];
  const keepOffLeader = (label: PlacedLabel, req: LabelRequest): void => {
    if (req.leaderAvoidsLabels && label.leader) leaderRuns.push(...leaderPieces(label.leader.d, 64));
  };
  const onLeader = (rect: Rect, padding: number): boolean => leaderRuns.some(([a, b]) => segmentHitsRect(a, b, rect, padding));
  for (const queued of order) {
    // A leader runs only through empty page: one that would touch another owner's mark (a line point, a plan tick) is not added.
    const runClear = (from: Point, to: number): boolean => occupied.hitsWhich({ x: from.x - 0.5, y: Math.min(from.y, to) + 0.5, w: 1, h: Math.max(0, Math.abs(to - from.y) - 1) }, 0)
      .every((o) => o.kind !== 'mark' || isOwnMark(o.owner, queued.owner, queued.kind, o.part));
    const req = withLiftLeaders(queued, ownedPoint(queued), runClear);
    const slots = req.candidates.map((c) => c.slot);
    const first = req.candidates[0];
    const markValue = isMarkValue(req);
    const naturals = naturalSeats(req);
    const withinMarkBand = (cand: SlotCandidate): boolean => {
      if (!markValue || cand.outsidePlot || (req.kind === 'point' && req.anchor && /^(right|left)(Step[+-]?\d+)?$/.test(cand.slot))) return true;
      const side = sideOf(cand.slot);
      const natural = side ? naturals.get(side) : undefined;
      // Only a shifted seat has to stay near the plot. A natural seat touches
      // its mark: a mark that reaches the plot edge, or a bar with a value
      // reserve beside the plot, keeps it just past that edge. A shifted seat
      // may reach as far past the edge as the shifted seat of a mark on the
      // edge: two label lines and their gaps. A side seat is checked across
      // the plot only, as its reserve lies beside it.
      if (/Shifted|Step/.test(cand.slot)) {
        const slack = 2 * (cand.rect.h + 4);
        const inside = side === 'side'
          ? cand.rect.y >= ctx.plot.y - slack && cand.rect.y + cand.rect.h <= ctx.plot.y + ctx.plot.h + slack
          : rectContains({ x: ctx.plot.x, y: ctx.plot.y - slack, w: ctx.plot.w, h: ctx.plot.h + 2 * slack }, cand.rect, 0);
        if (!inside) return false;
      }
      // One line step from the natural seat; two for a seat on a leader to its mark. Inside seats keep their own fit rules.
      return !natural || Math.abs(cand.rect.y - natural.rect.y) <= (cand.reach ?? (cand.leaderFrom && cand.leaderVertical ? 2 : 1) * (natural.rect.h + 4)) + 1e-6;
    };

    // Why a candidate rect is unusable. Occupancy does not change while ONE
    // request is being solved (nothing claims until it places), so classifying
    // a candidate up front is equivalent to testing it inside the cascade.
    //   'label' — only other labels contest it. A pin can still win it: pins
    //             are solved before free labels, so re-ordering may free it.
    //   'hard'  — a mark, annotation, frame block, reservation or the canvas
    //             edge blocks it. Nothing an author can pin will move those,
    //             so such a slot must never be offered as advice.
    // TWO YARDSTICKS, and the difference is the whole point.
    //   pad>0 ('breathing') — what AUTOMATIC placement uses, unchanged: the
    //     cascade prefers slots with air around them, so it walks past a slot
    //     that merely crowds its neighbour.
    //   pad=0 ('touching')  — what a PIN and the pin ADVICE are judged by. A
    //     pin is an explicit instruction, not a preference; refusing one that
    //     provably does not overlap anything would delete a label the author
    //     asked for and then blame a "blocker" that never touches it. The
    //     no-overlap rule is stated as overlap, so refusal must mean overlap.
    const selfAnn = req.owner.annotationId;
    const blocks = new Map<string, Block>();
    // Two values of one series side by side keep SERIES_VALUE_GAP between them, or read as one number.
    // Inside segment seats too where the two marks touch: adjacent mekko columns share an
    // edge, so their values stand 5.94 px apart. A page gap between two columns already parts their values.
    // A point inside its cell keeps the exemption: a cell grid fits each row itself (heatmap: a whole row or none).
    const crowdsSeriesValue = (cand: SlotCandidate): boolean => cand.insideFill === undefined ? crowdsSeries(cand.rect)
      : req.kind === 'segment' && crowdsSeries(cand.rect, true);
    /** Whether a mark fills the middle of the space between two labels side by side (touching columns). */
    const marksTouch = (a: Rect, b: Rect): boolean => {
      const [left, right] = a.x <= b.x ? [a, b] : [b, a];
      const x = (left.x + left.w + right.x) / 2;
      const y = (Math.max(a.y, b.y) + Math.min(a.y + a.h, b.y + b.h)) / 2;
      return anyHit(occupied, { x: x - 0.5, y: y - 0.5, w: 1, h: 1 }, 0, (o) => o.kind === 'mark');
    };
    // A segment value outside its column stands in the gap to the next column; level with that
    // column's value it reads as a second number of it (ebit-bridge 400x300: '+38 +6'), whatever its series.
    const outsideSegment = (touching: boolean): boolean => req.kind === 'segment' && !touching;
    // Type steps: with 12 px values at the S widths a row of totals fits one by one; two totals
    // side by side keep the same gap as two values of a series, or read as one number.
    const crowdsTotal = (rect: Rect): boolean => TOTAL_KINDS.has(req.kind)
      && anyHit(occupied, rect, SERIES_VALUE_GAP, (o) => o.kind === 'label' && o.part === TOTAL_PART && o.owner.seriesId === req.owner.seriesId
        && o.owner.categoryId !== undefined && o.owner.categoryId !== req.owner.categoryId
        // Two totals on one row: their boxes share at least half of one line (0.1 px absorbs scale noise).
        // A total one stair step lower reads as its own number; the 6 px would hide it for nothing.
        // One line, not the box: a two-line total's second line beside the other's first reads as one number.
        && Math.min(o.rect.y + o.rect.h, rect.y + rect.h) - Math.max(o.rect.y, rect.y) >= rect.h / Math.max(1, req.lines.length) / 2 - 0.1);
    const crowdsSeries = (rect: Rect, touching = false): boolean => crowdsTotal(rect) || (req.kind === 'point' || req.kind === 'segment') && (req.owner.seriesId !== undefined || req.valueRow === true || outsideSegment(touching))
      && occupied.hitsWhich(rect, SERIES_VALUE_GAP).some((o) => o.kind === 'label' && (outsideSegment(touching) || o.owner.seriesId === req.owner.seriesId)
        && o.owner.categoryId !== undefined && o.owner.categoryId !== req.owner.categoryId
        && Math.min(o.rect.y + o.rect.h, rect.y + rect.h) > Math.max(o.rect.y, rect.y) && (!touching || marksTouch(rect, o.rect)));
    // A bare value in the tick label column reads as a tick; a name or a named reference ('50.0 Plan') does not.
    const inTickColumn = (rect: Rect, air = 0): boolean => ['point', 'segment', 'total', 'grandTotal'].includes(req.kind)
      && (occupied.tickColumns?.some((column) => rectsOverlap(column, rect, air)) ?? false);
    const blockAt = (index: number, padding: number): Block => {
      const key = `${index}:${padding}`;
      const cached = blocks.get(key);
      if (cached) return cached;
      const { rect, overColumns, overRules, overLegend } = req.candidates[index]!;
      let value: Block = 'free';
      if (!withinMarkBand(req.candidates[index]!) || (ctx.canvas && !rectContains(ctx.canvas, rect, 0))) {
        value = 'hard';
      } else {
        // Hard when any counted hit is not a label, else label when any is: the order of hits does not matter.
        let sawLabel = false;
        const hard = anyHit(occupied, rect, padding, (o) => {
          if (o.kind === 'annotation' && selfAnn && o.owner.annotationId === selfAnn) return false;
          if (overRules && o.part === 'referenceLine') return false;
          if (overLegend && o.kind === 'legend') return false;
          // A slot over columns lies wholly on one column or clear of them:
          // a label across a fill edge is half on the page and half on the
          // fill, and no one paint reads on both.
          if (o.kind === 'mark' && (isOwnMark(o.owner, req.owner, req.kind, o.part) || (overColumns && isColumnPart(o.part) && rectContains(o.rect, rect, 0)))) return false;
          // A seat on another series' area fill, clear of its edges, reads on that fill.
          if (o.kind === 'mark' && o.part === AREA_FILL_PART && req.candidates[index]!.onFill?.seriesId === o.owner.seriesId) return false;
          if (req.ownStrokeClear && o.kind === 'mark' && (o.part === undefined || o.part === AREA_FILL_PART) && !o.polygon && o.owner.seriesId === req.owner.seriesId && !rectsOverlap(o.rect, rect)) return false;
          // An inside seat needs no air from its own series' next piece (a stacked
          // band's slice of the next category): only an actual overlap blocks it there.
          // A seat inside a stacked area's band was cut clear of the band's drawn edges
          // (insideBandEdges); the edge claims are boxes around a slope and say no more.
          if (o.kind === 'mark' && req.owner.seriesId !== undefined && o.owner.seriesId === req.owner.seriesId
            && req.candidates[index]!.slot.startsWith('inside') && (req.candidates[index]!.slot.startsWith('insideBand') || !rectsOverlap(o.rect, rect, 0))) return false;
          // The same cut keeps it clear of the next band's edge, so a neighbour band's fill does not block it either.
          // Any inside seat reads on its own mark, which draws over an area fill (combo draws its columns in front).
          if (o.kind === 'mark' && o.part === AREA_FILL_PART && (req.candidates[index]!.slot.startsWith('insideBand') || req.candidates[index]!.insideFill !== undefined)) return false;
          if (o.kind === 'label') {
            sawLabel = true;
            return false;
          }
          return true;
        });
        if (hard) value = 'hard';
        else if (sawLabel) value = 'label';
        if (value !== 'hard' && inTickColumn(rect, req.candidates[index]!.tickAir)) value = 'hard';
        // The tick labels themselves (axis claims with a text box, not a rule): the same air.
        const tickAir = req.candidates[index]!.tickAir;
        if (value !== 'hard' && tickAir && anyHit(occupied, rect, tickAir, (o) => o.kind === 'axis' && o.rect.w > 2 && o.rect.h > 2)) value = 'hard';
        if (value === 'free' && onLeader(rect, padding)) value = 'label';
        // A pin is judged at pad 0 and keeps its seat by the author's word: the 6 px rule is for the cascade.
        if (value === 'free' && pinOf(req) !== req.candidates[index]!.slot && crowdsSeriesValue(req.candidates[index]!)) value = 'label';
      }
      blocks.set(key, value);
      return value;
    };
    /**
     * Slots an author could still plausibly pin — never the immovable ones.
     * Judged at pad=0, the same yardstick the pin itself will face, so every
     * slot named here is a slot a pin can actually take.
     */
    const pinnableSlots = (): SlotId[] =>
      req.candidates.flatMap((c, i) => (blockAt(i, 0) === 'hard' ? [] : [c.slot]));

    const base: Omit<PlacedLabel, 'rect' | 'slot' | 'ink'> = {
      id: req.id,
      kind: req.kind,
      typeRole: labelTypeRole(req),
      owner: req.owner,
      text: req.text,
      lines: req.lines,
      slots,
      pinned: false,
      priority: req.priority,
      ...(req.claimId ? { claimId: req.claimId, claimText: req.claimText } : {}),
      ...(req.noteText ? { noteText: req.noteText } : {}),
      ...(req.printsFor ? { printsFor: req.printsFor } : {}),
      ...(req.owed ? { owed: true as const } : {}),
      ...(req.swatch ? { swatch: req.swatch } : {}),
      ...(req.title ? { title: req.title } : {}),
      ...(req.fontStep ? { font: req.fontStep } : {}),
      ...capHeightOf(req, ctx.measure),
      ...(req.role ? { role: req.role } : {}),
      ...(req.align ? { align: req.align } : {}),
      ...(req.runs ? { runs: req.runs } : {}),
      ...(req.emphasis ? { emphasis: true as const } : {}),
      ...(req.headLines ? { headLines: req.headLines, headWeight: req.headWeight, ...(req.headInk ? { headInk: req.headInk } : {}), ...(req.bodyInk ? { bodyInk: req.bodyInk } : {}), ...(req.bodyFont ? { bodyFont: req.bodyFont } : {}) } : {}),
    };

    const hide = (hidden: NonNullable<PlacedLabel['hidden']>, why: string) => {
      const quiet = hidden === 'collision' && req.quietWhenCrowded === true;
      const reason = quiet ? 'density' : hidden;
      const decisionReason = quiet ? 'density=smart: no free seat' : why;
      placed.push({
        ...base,
        rect: first ? first.rect : { x: 0, y: 0, w: 0, h: 0 },
        slot: first ? first.slot : 'none',
        ink: { token: 'ink' },
        hidden: reason,
        ...(markValue && reason === 'collision' ? { owed: true as const } : {}),
      });
      decisions.push({
        labelId: req.id,
        strategy: 'candidatesOccupied',
        tried: [],
        chose: 'hidden',
        reason: decisionReason,
      });
      if (reason === 'collision') {
        // Never advertise a slot a pin could not take. The old advice was
        // built from the very candidates that had just collided, so following
        // it produced a silent overlap. Offer only slots that pass the same
        // pad=0 test the pin will face; when there are none, say plainly that
        // pinning cannot help.
        const pinnable = slots.length > 0 ? pinnableSlots() : [];
        warnings.push({
          code: 'label-hidden',
          severity: req.priority >= REQUIRED_VALUE_PRIORITY ? 'warn' : 'info',
          message: `label '${req.id}' with text '${req.text}' (priority ${req.priority}, owner ${formatOwner(req.owner)}) was hidden: ${decisionReason}`,
          owner: req.owner,
          suggest:
            slots.length === 0
              ? 'increase chart size or provide a placement candidate'
              : pinnable.length > 0
                ? `increase chart size, or pin '${req.id}' to a slot a pin can actually take (${pinnable.join(', ')})` +
                  (pinnable.length < slots.length
                    ? ' — the other candidates are blocked by marks, annotations or the canvas edge, which pinning cannot move'
                    : '')
                : `increase chart size or lower label density — every candidate slot (${slots.join(', ')}) is blocked by marks, annotations or the canvas edge, which pinning cannot move`,
        });
        hiddenWarningByLabel.set(req.id, warnings[warnings.length - 1]!);
      }
    };

    // Pins or cell priorities can put the segment first. Keep whichever
    // equivalent label actually placed first, and name it on the other. The value matches by
    // construction ("42.0" in a per-series format against the total "42"). A total that prints
    // the value alone links back to its segment; a named total ("Net −27") has no link and keeps its word.
    const replacement = printedIn.size > 0 && req.printedIn !== undefined && placed.find(label => !label.hidden && label.id === req.printedIn);
    if (replacement) {
      base.printedIn = replacement.id;
      hide('redundant', `printed in label '${replacement.id}'`);
      continue;
    }

    const pin = pinOf(req);
    // A value the chart dropped for room still takes a pin that is free:
    // the author named the seat. A true redundancy or an authored 'no' stays.
    // An owed value was hidden by a setting or a sliver and is named in the note (labels.restSeries: false): a pin does not override it.
    const pinOverDensity = req.redundant === true && req.suppressedAs === 'density' && !req.owed && pin !== undefined;

    // Redundancy gate (chart decided).
    if (req.redundant && !pinOverDensity) {
      const why = req.suppressedAs ?? 'redundant';
      hide(why, why === 'density' ? 'density gate' : 'redundancy gate');
      continue;
    }

    // Density gate — pins, the highlighted value and authored text (an
    // authored annotation, an authored cell label) are immune: optional
    // engine labels drop first.
    if (!pin && !req.protect && !req.keepWhenDense && ctx.density === 'minimal' && req.priority < DENSITY_MIN_PRIORITY) {
      hide('density', `density=minimal drops priority ${req.priority}`);
      continue;
    }

    // Pinned placement: a first-class placement REQUEST, not a licence to
    // overlap. It is solved first (so it wins contested space against free
    // labels) and collision-checked like everything else.
    let refusedPin: SlotId | undefined;
    if (pin) {
      const index = req.candidates.findIndex((c) => c.slot === pin);
      // both refusals name every slot this label has and, apart,
      // the ones nothing occupies now, so one CLI line is enough to re-pin.
      const free = req.candidates.flatMap((c, i) => (c.slot !== pin && blockAt(i, 0) === 'free' ? [c.slot] : []));
      const choice = `valid slots: ${slots.join(', ') || 'none'}; free now: ${free.join(', ') || 'none'}`;
      if (index < 0) {
        warnings.push({
          code: 'unknown-slot',
          severity: 'warn',
          message: `label '${req.id}': unknown slot '${pin}' — using automatic placement; ${choice}`,
          owner: req.owner,
          suggest: slots.join(', '),
        });
      } else if (blockAt(index, 0) === 'free' && (req.leaderClear !== 'includingPins' || !leaderFor(req.candidates[index]!) ||
        !leaderPieces(leaderFor(req.candidates[index]!)!.d).some(([a, b]) => occupied.hitsWhich(pieceBox(a, b), 0).some(o => o.kind === 'label' && segmentHitsRect(a, b, o.rect))))) {
        const cand = req.candidates[index]!;
        const label = finalize(base, req, cand, true, darkInk, lightInk);
        placed.push(label);
        occupied.claim(cand.rect, 'label', req.owner, TOTAL_KINDS.has(req.kind) ? TOTAL_PART : undefined);
        if (req.leaderClear === 'includingPins' && label.leader) for (const [a, b] of leaderPieces(label.leader.d)) occupied.claim(pieceBox(a, b), 'label', req.owner);
        keepOffLeader(label, req);
        decisions.push({
          labelId: req.id,
          strategy: 'candidatesOccupied',
          tried: [pin],
          chose: pin,
          reason: 'pinned',
        });
        continue;
      } else {
        // Honouring it here would put ink on top of ink with an empty
        // warnings array — the one outcome the engine promises cannot happen.
        // Refuse the slot, say why, and let the cascade try the rest.
        refusedPin = pin;
        // pad=0: name only what the slot ACTUALLY intersects. A message that
        // names a mark the pinned rect merely sits beside is a false statement
        // about the drawing, and the author cannot act on it.
        const blockers = describeBlockers(occupied.hitsWhich(req.candidates[index]!.rect, 0), req, selfAnn);
        const alternatives = pinnableSlots().filter((slot) => slot !== pin);
        warnings.push({
          code: 'pin-blocked',
          severity: 'warn',
          message: `label '${req.id}': pinned slot '${pin}' is occupied (${blockers}) — the no-overlap guarantee outranks the pin, so it was not honoured; using automatic placement; ${choice}`,
          owner: req.owner,
          suggest:
            alternatives.length > 0
              ? `pin '${req.id}' to ${alternatives.join(', ')} instead, or increase chart size`
              : 'increase chart size or lower label density — no candidate slot for this label is free',
        });
      }
    }
    // The pin did not hold: the chart's density drop stands.
    if (pinOverDensity) {
      hide('density', `density gate; pin '${pin}' not placed`);
      continue;
    }

    // candidatesOccupied: first non-colliding candidate wins. A label never
    // collides with its OWN mark (inside placements) or its own annotation's
    // arm/arrow claims — but always with everyone else's.
    const note = (reason: string): string =>
      refusedPin === undefined ? reason : `pin '${refusedPin}' blocked; ${reason}`;
    const tried: SlotId[] = [];
    let done = false;
    const crossesLabel = (leader: PlacedLabel['leader']): boolean => Boolean(req.leaderClear || req.leaderAvoidsLabels) && leader !== undefined &&
      leaderPieces(leader.d, req.leaderAvoidsLabels ? 64 : 8).some(([a, b]) => occupied.hitsWhich(pieceBox(a, b), 0).some((o) => (o.kind === 'label' || req.leaderClearsAxis && o.kind === 'axis') && segmentHitsRect(a, b, o.rect)));
    const claimLeader = (label: PlacedLabel): void => {
      if (req.leaderClear && label.leader) for (const [a, b] of leaderPieces(label.leader.d)) occupied.claim(pieceBox(a, b), 'label', req.owner);
      keepOffLeader(label, req);
    };
    const crowds = (cand: SlotCandidate) => req.labelGap !== undefined &&
      anyHit(occupied, cand.rect, req.labelGap, (o) => o.kind === 'label' && !sameOwner(o.owner, req.owner));
    const indices = req.candidates.map((_, i) => i);
    // Crowding reorders seats within a penalty, never across one.
    const crowded = indices.map((i) => crowds(req.candidates[i]!));
    const order = req.labelGap === undefined
      ? indices
      : [...indices].sort((a, b) => req.candidates[a]!.penalty - req.candidates[b]!.penalty || Number(crowded[a]) - Number(crowded[b]) || a - b);
    // With an anchor, a free seat nearer another owner's mark waits; the
    // first such seat takes a leader from the anchor if no clear seat is free.
    // A seat too near its anchor to draw a leader is kept as the last resort,
    // so the rule never hides a label the cascade can place.
    const ambiguous: SlotCandidate[] = [];
    const place = (cand: SlotCandidate, reason: string, leader?: PlacedLabel['leader']): void => {
      const label = finalize(base, req, cand, false, darkInk, lightInk);
      if (leader) label.leader = leader;
      if (cand.overRules && anyHit(occupied, cand.rect, req.pad ?? pad, (o) => o.part === 'referenceLine')) label.halo = true;
      placed.push(label);
      occupied.claim(cand.rect, 'label', req.owner, TOTAL_KINDS.has(req.kind) ? TOTAL_PART : undefined);
      claimLeader(label);
      decisions.push({ labelId: req.id, strategy: 'candidatesOccupied', tried, chose: cand.slot, reason: note(reason) });
    };
    // A leaderAvoidsLabels label still takes a free seat whose leader crosses
    // a label when no other seat is free: a crossing reads, a dropped name does not.
    let crossing: SlotCandidate | undefined;
    for (const i of order) {
      const cand = req.candidates[i]!;
      tried.push(cand.slot);
      if (req.noLeader && cand.leaderFrom) continue;
      // A last-resort seat (a line end past the plot's edge) waits behind the fallback seat.
      if (cand.penalty >= LAST_RESORT_PENALTY && ambiguous.length > 0) continue;
      if (!leaderExceedsLimit(req, cand) && blockAt(i, cand.pad ?? req.pad ?? pad) === 'free') {
        if (crossesLabel(leaderFor(cand))) {
          crossing ??= cand;
          continue;
        }
        if (req.anchor && nearerOtherMark(req, cand, occupied, ctx.pointOwnership !== undefined)) {
          // On another series' fill and nearer another mark, a value would read as that series'.
          if (!cand.onFill) ambiguous.push(cand);
          continue;
        }
        place(cand, tried.length === 1 ? 'first candidate free' : `candidate ${tried.length} free`);
        done = true;
        break;
      }
    }
    if (done) continue;
    if (crossing && req.leaderAvoidsLabels) {
      place(crossing, 'every free seat draws its leader across a label');
      warnings.push({
        code: 'label-leader-crossing',
        severity: 'warn',
        message: `label '${req.id}': every free seat draws its leader across a label`,
        owner: req.owner,
        suggest: 'widen the chart or shorten the labels',
      });
      continue;
    }
    if (req.anchor && !req.noLeader && ambiguous.length > 0) {
      const box = anchorBox(req.anchor);
      const anchorFor = (rect: Rect) => ({ x: Math.max(box.x, Math.min(rect.x + rect.w / 2, box.x + box.w)), y: Math.max(box.y, Math.min(rect.y + rect.h / 2, box.y + box.h)) });
      const led = ambiguous.find((cand) => anchorLeader(cand.rect, anchorFor(cand.rect)) && !leaderExceedsLimit(req, { ...cand, leaderFrom: anchorFor(cand.rect) }) &&
        !crossesLabel(anchorLeader(cand.rect, anchorFor(cand.rect))));
      if (led) {
        const leader = anchorLeader(led.rect, anchorFor(led.rect))!;
        place(led, 'nearer another mark: leader from its anchor', leader);
        // The leader's end keeps its gutter clear: a later label touching it would read the leader as its minus sign.
        const [x, y] = leader.d.trim().split(/[\s,A-Za-z]+/).filter(Boolean).slice(-2).map(Number) as [number, number];
        const reach = LEADER_GUTTER_RATIO * led.rect.h;
        occupied.claim({ x: x - reach, y: y - reach, w: 2 * reach, h: 2 * reach }, 'label', req.owner);
      }
      else place(ambiguous[0]!, 'nearer another mark; too close to its anchor for a leader');
      continue;
    }

    // The highlighted value crosses a reference line rather than vanish, and
    // any label crosses a scatter trend line or zero line: the halo is
    // what a label on the page gets where it crosses a line.
    {
      const across = req.candidates.findIndex((cand) =>
        (!req.noLeader || (!cand.leaderFrom && (!req.anchor || !nearerOtherMark(req, cand, occupied, ctx.pointOwnership !== undefined)))) && withinMarkBand(cand) && !cand.insideFill && !leaderExceedsLimit(req, cand) && !crossesLabel(leaderFor(cand)) && (!ctx.canvas || rectContains(ctx.canvas, cand.rect, 0)) && !onLeader(cand.rect, req.pad ?? pad) && !crowdsSeriesValue(cand) && !inTickColumn(cand.rect) &&
        !anyHit(occupied, cand.rect, req.pad ?? pad, (o) => !(o.part === 'trendLine' || o.part === 'zeroLine' || (req.protect === true && o.part === 'referenceLine') || (o.kind === 'mark' && isOwnMark(o.owner, req.owner, req.kind, o.part)))));
      if (across >= 0) {
        const cand = req.candidates[across]!;
        const label = finalize(base, req, cand, false, darkInk, lightInk);
        label.halo = true;
        placed.push(label);
        occupied.claim(cand.rect, 'label', req.owner, TOTAL_KINDS.has(req.kind) ? TOTAL_PART : undefined);
        claimLeader(label);
        decisions.push({ labelId: req.id, strategy: 'candidatesOccupied', tried, chose: cand.slot, reason: note(req.protect ? 'highlighted value crosses a reference line' : 'label crosses a trend or zero line') });
        continue;
      }
    }

    // Nothing fits. The invariant always wins — hide, even at density=full
    // and even when the author pinned this label.
    hide('collision', note(ownershipLimited.has(req.id) && req.candidates.length === 0 ? "no seat reads as its own point's value" : `all ${req.candidates.length} candidates collide${req.maxLeaderLength === undefined ? '' : ' or exceed the leader limit'}`));
  }

  if (ctx.seriesUniform) {
    const kinds = new Set(ctx.seriesUniform.kinds);
    const maxShare = ctx.seriesUniform.maxHiddenShare ?? 0.25;
    const groups = new Map<string, PlacedLabel[]>();
    for (const label of placed) {
      const seriesId = label.owner.seriesId;
      // An annotation's own label (a ratio-tier badge) is no value label of the series, so the series rule leaves it alone.
      if (!kinds.has(label.kind) || seriesId === undefined || label.owner.annotationId !== undefined) continue;
      const list = groups.get(seriesId) ?? [];
      list.push(label);
      groups.set(seriesId, list);
    }
    const emphasized = new Set(requests.filter((request) => request.protect).map((request) => request.id));
    for (const [seriesId, labels] of groups) {
      const collided = labels.filter((label) => label.hidden === 'collision');
      if (labels.length < 3 || collided.length === 0 || collided.length / labels.length <= maxShare) continue;
      const dropped = new Set<LintWarning>();
      for (const label of labels) {
        if (!label.hidden && !emphasized.has(label.id)) label.hidden = 'density';
        const trace = hiddenWarningByLabel.get(label.id);
        if (trace) dropped.add(trace);
      }
      for (let i = warnings.length - 1; i >= 0; i--) if (dropped.has(warnings[i]!)) warnings.splice(i, 1);
      const kept = labels.filter((label) => !label.hidden).map((label) => `'${label.id}'`);
      warnings.push({
        code: 'value-labels-dropped-series',
        severity: 'warn',
        message: `value labels of series '${seriesId}' hidden: ${collided.length} of ${labels.length} could not be placed without overlap, so the series shows ${
          kept.length === 0 ? 'none' : `only its highlighted value${kept.length > 1 ? 's' : ''} (${kept.join(', ')})`} instead of a scatter`,
        owner: { seriesId },
        suggest: 'widen the chart, set labelDensity to "minimal", or read the series from its axis',
      });
    }
  }
  // `order` steers only which label claims a seat first; output keeps the id order, so paint order stays put.
  if (owned.some(req => req.order !== undefined)) {
    const rank = new Map([...owned].sort(labelOrder(pinOf, ctx.focus, false)).map((req, i) => [req.id, i]));
    const byRank = (a: Id, b: Id): number => (rank.get(a) ?? 0) - (rank.get(b) ?? 0);
    placed.sort((a, b) => byRank(a.id, b.id));
    decisions.sort((a, b) => byRank(a.labelId, b.labelId));
  }
  return { placed, decisions, warnings, ...(ownershipLimited.size > 0 ? { ownershipLimited } : {}) };
}


/**
 * A mark belongs to another owner when it names a different series,
 * category, segment or point than the label (a series name: a different
 * series); a mark sharing no key (an axis,
 * an unowned band) belongs to nobody. A total owns only its own stack, so a
 * line point in the same category is another owner's.
 */
function isOtherOwners(mark: OwnerRef, label: OwnerRef, kind: LabelKind, part: string | undefined): boolean {
  // A series name names the whole series, wherever along it the mark is.
  for (const key of kind === 'series' ? (['seriesId'] as const) : (['seriesId', 'categoryId', 'segmentId', 'pointId'] as const)) {
    if (mark[key] !== undefined && label[key] !== undefined && mark[key] !== label[key]) return true;
  }
  return (kind === 'total' || kind === 'grandTotal') && label.seriesId === undefined && label.categoryId !== undefined &&
    mark.seriesId !== undefined && mark.categoryId === label.categoryId && !isColumnPart(part);
}

/** A drawn leader as straight pieces: a line as itself, a cubic in `steps` steps (64 where a leader keeps off labels). */
export function leaderPieces(d: string, steps = 8): [Point, Point][] {
  const n = d.trim().split(/[\s,A-Za-z]+/).filter(Boolean).map(Number);
  if (n.length < 8) return [[{ x: n[0]!, y: n[1]! }, { x: n[2]!, y: n[3]! }]];
  const at = (t: number): Point => {
    const u = 1 - t;
    const [a, b, c, e] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    return { x: a * n[0]! + b * n[2]! + c * n[4]! + e * n[6]!, y: a * n[1]! + b * n[3]! + c * n[5]! + e * n[7]! };
  };
  return Array.from({ length: steps }, (_, i) => [at(i / steps), at((i + 1) / steps)] as [Point, Point]);
}

/** The box a leader piece runs through, at least a pixel thick. */
function pieceBox(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x) - 0.5;
  const y = Math.min(a.y, b.y) - 0.5;
  return { x, y, w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 };
}

/** The anchor as a box: a point has no size. */
function anchorBox(anchor: NonNullable<LabelRequest['anchor']>): Rect {
  return { x: anchor.x, y: anchor.y, w: anchor.w ?? 0, h: anchor.h ?? 0 };
}

/**
 * Whether another owner's mark sits nearer to this seat than the label's
 * anchor, by more than a pixel. A mark that touches the anchor stands where
 * the label's own mark does (two lines through one point hold one value
 * there), so it rivals no seat. A seat that draws its own leader is never
 * ambiguous: the leader says whose it is.
 */
function nearerOtherMark(req: LabelRequest, cand: SlotCandidate, occupied: OccupiedIndex, ownsPoint = false): boolean {
  if (cand.leaderFrom && leaderFor(cand)) return false;
  const anchor = anchorBox(req.anchor!);
  // A label stacked on its own point's label (a name over its value, which is
  // already tied to the point) is as near its own as that label is.
  const ownLabels = req.owner.seriesId === undefined ? [] : occupied.hitsWhich(cand.rect, 6).filter((o) => o.kind === 'label' &&
    o.owner.seriesId === req.owner.seriesId && o.owner.categoryId === req.owner.categoryId);
  const own = Math.min(boxGap(cand.rect, anchor), ...ownLabels.map((o) => boxGap(cand.rect, o.rect)));
  // '__' owners are furniture claimed under an escape owner (an anomaly flag,
  // range whiskers, stack connectors) that belongs to a mark, not a rival.
  return anyHit(occupied, cand.rect, Math.max(0, own - 1), (o) => o.kind === 'mark' && !o.owner.seriesId?.startsWith('__') &&
    // Point ownership already compares the actual points and category lanes.
    // A box around the same line's connecting stroke is not another value.
    !(ownsPoint && req.noLeader && req.kind === 'point' && (o.part === undefined || o.part === AREA_FILL_PART) && o.owner.seriesId === req.owner.seriesId) &&
    // The fill a value sits on is its ground, not a rival value.
    !(o.part === AREA_FILL_PART && o.owner.seriesId === cand.onFill?.seriesId) &&
    isOtherOwners(o.owner, req.owner, req.kind, o.part) && boxGap(o.rect, anchor) > 1.5 && boxGap(cand.rect, o.rect) + 1 < own);
}

/**
 * Numeric labels tied to a mark stay in its plot band. Furniture has
 * other kinds; endpoint planners can explicitly offer gutter seats.
 */
function isMarkValue(req: LabelRequest): boolean {
  return ['point', 'segment', 'total', 'grandTotal'].includes(req.kind)
    && req.role !== 'category' && req.owner.annotationId === undefined && req.markAnchored !== false
    && (req.markAnchored === true || req.anchor !== undefined || req.candidates.some(c => /^(above|below|inside|outsideTop|outsideBottom)/.test(c.slot)));
}

function sideOf(slot: string): 'up' | 'down' | 'side' | undefined {
  return /^(above|outsideTop)/.test(slot) ? 'up' : /^(below|outsideBottom)/.test(slot) ? 'down'
    : /^(outside(Right|Left|End|High|Low)|right(?!Of)|left(?!Of))/.test(slot) ? 'side' : undefined;
}

/** The natural seat of each direction: the first one that is not shifted. */
function naturalSeats(req: LabelRequest): Map<string, SlotCandidate> {
  const naturals = new Map<string, SlotCandidate>();
  for (const c of req.candidates) {
    const side = sideOf(c.slot);
    if (side && !/Shifted|Step/.test(c.slot) && !naturals.has(side)) naturals.set(side, c);
  }
  return naturals;
}

/** The gap every natural seat over or under a mark keeps from it. */
const NATURAL_SEAT_GAP = 4;

/**
 * A mark's value lifted off its mark, over or under it, past its natural seat
 * (a shifted or lifted seat) gets a vertical leader from the mark, so it never
 * floats free of the column it values. The leader is drawn only where the run
 * is longer than a stub, and it may cross no label. Where another owner's mark
 * stands in the run (a line point, a reference tick), the seat keeps no leader
 * and its one-step limit, as the mark between reads as the step. A line point
 * keeps the ownership rule (withOwnedSeats) instead.
 */
function withLiftLeaders(req: LabelRequest, ownedPoint: boolean, runClear: (from: Point, to: number) => boolean): LabelRequest {
  if (ownedPoint || req.noLeader || !isMarkValue(req)) return req;
  const naturals = naturalSeats(req);
  let changed = false;
  const candidates = req.candidates.map((cand) => {
    const side = sideOf(cand.slot);
    const natural = side === 'up' || side === 'down' ? naturals.get(side) : undefined;
    if (!natural || natural === cand || cand.leaderFrom || cand.insideFill !== undefined) return cand;
    const up = side === 'up';
    const from = { x: natural.rect.x + natural.rect.w / 2, y: up ? natural.rect.y + natural.rect.h + NATURAL_SEAT_GAP : natural.rect.y - NATURAL_SEAT_GAP };
    if ((up ? cand.rect.y >= natural.rect.y : cand.rect.y <= natural.rect.y) || !runClear(from, up ? cand.rect.y + cand.rect.h : cand.rect.y)) return cand;
    changed = true;
    const { onFill: _onFill, ...base } = cand;
    return { ...base, leaderFrom: from, leaderVertical: true };
  });
  return changed ? { ...req, candidates, ...(req.leaderClear ? {} : { leaderClear: true }) } : req;
}

/** Penalty a seat with an added leader takes over the seats that read as their point's without one. */
const LED_PENALTY = 100;
/**
 * Penalty of a seat a chart offers only after every other (a line end past the plot's edge):
 * ownership keeps it behind the led seats too.
 */
export const LAST_RESORT_PENALTY = 200;

/**
 * Value ownership (./ownership.ts). Seats that read as the point's own keep
 * their order, and so does an authored pin. A seat that does not comes after
 * all of them as the same seat on a short leader from its point, when that
 * leader can be drawn and passes no other point; otherwise it is dropped. A
 * seat whose own leader passes another point is dropped. A request whose
 * seats all read as its own is returned unchanged, so its placement stays
 * byte-identical.
 */
function withOwnedSeats(requests: LabelRequest[], model: PointOwnership, pinOf: (request: LabelRequest) => SlotId | undefined): LabelRequest[] {
  return requests.map((req) => {
    if (req.kind !== 'point' || req.owner.annotationId !== undefined || req.rotate !== undefined) return req;
    const pin = pinOf(req);
    // The redundancy gate drops it before any seat is tried (a pin over a density drop still seats).
    if (req.redundant && !(req.suppressedAs === 'density' && !req.owed && pin !== undefined)) return req;
    const own = model.pointOf(req.owner.seriesId, req.owner.categoryId);
    if (!own) return req;
    const kept: SlotCandidate[] = [];
    const led: SlotCandidate[] = [];
    let changed = false;
    for (const cand of req.candidates) {
      // A seat inside a fill reads by that fill, not by distance. An authored pin keeps its seat.
      if (cand.insideFill !== undefined || cand.slot === pin) {
        kept.push(cand);
        continue;
      }
      const leader = cand.leaderFrom ? leaderFor(cand) : undefined;
      if (leader ? leaderReadsAsOwn(leader.d, own, model) && !besideOtherPoint(cand.rect, own, model, req.font.size) : readsAsOwnPoint(cand.rect, own, model, req.font.size)) {
        kept.push(cand);
        continue;
      }
      changed = true;
      if (leader || req.noLeader) continue;
      const spans = cand.rect.x <= own.x && own.x <= cand.rect.x + cand.rect.w;
      const from = spans ? { x: own.x, y: own.y } : { x: own.x + (cand.rect.x + cand.rect.w / 2 < own.x ? -LED_FROM_R : LED_FROM_R), y: own.y };
      // A led value stays off other fills: it reads by its leader, not beside its point.
      const { onFill: _onFill, ...base } = cand;
      const withLeader: SlotCandidate = { ...base, slot: `${cand.slot}Led`, leaderFrom: from, leaderVertical: true, penalty: cand.penalty + LED_PENALTY };
      const drawn = leaderFor(withLeader);
      if (drawn && leaderReadsAsOwn(drawn.d, own, model) && !besideOtherPoint(cand.rect, own, model, req.font.size)) led.push(withLeader);
    }
    // A leader this rule adds crosses no label, and no later label sits on it.
    const last = (cand: SlotCandidate) => cand.penalty >= LAST_RESORT_PENALTY;
    return changed ? { ...req, candidates: [...kept.filter((cand) => !last(cand)), ...led, ...kept.filter(last)], ...(led.length > 0 && !req.leaderClear ? { leaderClear: true } : {}) } : req;
  });
}

/** A side leader starts at the marker's edge, as a line end's does. */
const LED_FROM_R = 3;

/** Why a candidate rect is unusable — see blockAt(). */
type Block = 'free' | 'label' | 'hard';

/** Human-readable list of what actually sits in a refused pin's slot. */
function describeBlockers(hits: OccupiedRect[], req: LabelRequest, selfAnn: string | undefined): string {
  const parts: string[] = [];
  for (const o of hits) {
    if (o.kind === 'annotation' && selfAnn && o.owner.annotationId === selfAnn) continue;
    if (o.kind === 'mark' && isOwnMark(o.owner, req.owner, req.kind, o.part)) continue;
    const label = `${o.kind}${o.part ? ` '${o.part}'` : ''} of ${formatOwner(o.owner)}`;
    if (!parts.includes(label)) parts.push(label);
  }
  return parts.length > 0 ? parts.join('; ') : 'the canvas edge';
}

export function sameOwner(a: OwnerRef, b: OwnerRef): boolean {
  return (['seriesId', 'categoryId', 'segmentId', 'pointId', 'annotationId'] as const).every((key) => a[key] === b[key]);
}

function formatOwner(owner: OwnerRef): string {
  const parts = (['seriesId', 'categoryId', 'segmentId', 'pointId', 'valueLineId', 'annotationId'] as const)
    .flatMap((key) => (owner[key] === undefined ? [] : [`${key}='${owner[key]}'`]));
  return parts.length > 0 ? parts.join(', ') : 'unowned';
}

/**
 * A mark is "own" when every identity key it declares matches the label's
 * owner, and they share at least one defined key. A bar mark {categoryId}
 * owns segment labels {categoryId, segmentId}; a neighbor's mark does not.
 *
 * Totals own their whole stack: a total/grandTotal label owned only by a
 * category may sit inside that category's STACK marks (part 'segment'/'bar'
 * — the segments carry seriesIds the total deliberately doesn't have).
 * Marks of other parts (a line crossing the category) still block.
 *
 * Exported because this is the ONE authority on "may this label legally sit on
 * that mark?". The invariant suite asks the same question of this function,
 * so the guard fails wherever the solver would.
 */
/** Column marks a haloed `overColumns` slot may sit on. */
export function isColumnPart(part: string | undefined): boolean {
  return part === 'segment' || part === 'bar';
}

export function isOwnMark(mark: OwnerRef, label: OwnerRef, kind?: LabelKind, part?: string): boolean {
  if (
    (kind === 'total' || kind === 'grandTotal') &&
    label.categoryId !== undefined &&
    label.seriesId === undefined &&
    mark.categoryId === label.categoryId &&
    (part === 'segment' || part === 'bar')
  ) {
    return true;
  }
  const keys: (keyof OwnerRef)[] = ['seriesId', 'categoryId', 'segmentId', 'pointId'];
  let shared = 0;
  for (const k of keys) {
    if (mark[k] !== undefined) {
      if (label[k] === undefined || label[k] !== mark[k]) return false;
      shared++;
    }
  }
  return shared > 0;
}

/**
 * A LEADER THAT TOUCHES A NUMERAL IS A MINUS SIGN.
 *
 * A leader that ends at `cand.rect.x`, on the label's own edge, at
 * `rect.y + rect.h / 2` — the label's vertical centre — has the position AND
 * the height of a minus glyph: a horizontal 6-unit rule ending at gap 0.00
 * from a "7%", inside a 0-100% composition where a negative share is
 * impossible. A reader does not see a leader there. A reader sees minus
 * seven percent.
 *
 * Two rules, and the second is the one that matters:
 *
 * GUTTER. The terminus pulls back by a fraction of the label's own box height,
 * so it scales with type size instead of being a constant that is right at one
 * size and wrong at every other. The fraction is set above a hyphen's advance
 * width (~0.33 em in the humanist sans faces this ships with, ~0.24 of the
 * 1.35x line box) with margin, so the gap can never be read as a glyph.
 *
 * OMIT THE STUB. Applying the gutter to a short leader leaves a 0.6-unit
 * fragment, which is worse than either extreme. So below a minimum drawn
 * length the leader is not drawn at all — and that is the correct answer
 * independently of this defect: a six-unit rule between a mark and the label
 * touching it carries no information. Adjacency already says what the leader
 * was there to say. This is not a suppression that owes a trace: the
 * label is still placed, still visible, still bound to its mark by the
 * occupied index. Only a decoration is gone.
 */
const LEADER_GUTTER_RATIO = 0.4;
const LEADER_MIN_DRAWN_RATIO = 0.6;

/**
 * The gutter-adjusted point a leader stops at. EXPORTED because funnel's
 * re-routing pass re-derived the same terminus by hand
 * (`{ x: rect.x, y: rect.y + rect.h / 2 }`) and therefore kept the defect after
 * the solver was fixed — stale candidate positions still caused this failure:
 * one formula, two implementations, one of them undeclared. Import this; do not
 * write the arithmetic again.
 */
export function leaderTerminus(
  rect: { x: number; y: number; w: number; h: number },
  from: { x: number; y: number },
): { x: number; y: number } {
  const gutter = LEADER_GUTTER_RATIO * rect.h;
  const approachesFromLeft = from.x <= rect.x;
  const edgeX = approachesFromLeft ? rect.x : rect.x + rect.w;
  return {
    x: approachesFromLeft ? edgeX - gutter : edgeX + gutter,
    y: rect.y + rect.h / 2,
  };
}

/** The S-curve stays inside its control polygon, whose length is |dx| + |dy|. */
function leaderExceedsLimit(req: LabelRequest, cand: SlotCandidate): boolean {
  if (req.maxLeaderLength === undefined) return false;
  if (cand.leaderLengthBound !== undefined) return cand.leaderLengthBound > req.maxLeaderLength;
  if (!cand.leaderFrom || !leaderFor(cand)) return false;
  const { rect, leaderFrom: from } = cand;
  // A vertical leader (the anchor under the label's span) runs to the near edge.
  if (from.x > rect.x && from.x < rect.x + rect.w) return Math.max(rect.y - from.y, from.y - rect.y - rect.h) > req.maxLeaderLength;
  const end = leaderTerminus(cand.rect, cand.leaderFrom);
  const dx = Math.abs(end.x - cand.leaderFrom.x);
  const dy = Math.abs(end.y - cand.leaderFrom.y);
  const length = dx <= 8 || dy <= 8 ? Math.hypot(dx, dy) : dx + dy;
  return length > req.maxLeaderLength;
}

function leaderFor(cand: SlotCandidate): { d: string; curved: boolean } | undefined {
  const from = cand.leaderFrom;
  if (!from) return undefined;
  const minimum = LEADER_MIN_DRAWN_RATIO * cand.rect.h;
  const approachesFromLeft = from.x <= cand.rect.x;
  const toEdge = leaderTerminus(cand.rect, from);

  const dx = toEdge.x - from.x;
  const dy = toEdge.y - from.y;
  // The gutter can overshoot the anchor entirely on a short run; Math.hypot
  // catches that as well as the plain stub, because an inverted leader points
  // away from its own label.
  if (approachesFromLeft ? dx <= 0 : dx >= 0) return cand.leaderVertical ? verticalLeader(cand.rect, from) : undefined;
  if (Math.hypot(dx, dy) < minimum) return undefined;

  const d = leaderPath(from, toEdge);
  return { d, curved: d.includes('C') };
}

/** The leader a seat drawn from `from` takes, as the solver draws it (a seat handed to another label keeps one rule). */
export function seatLeader(rect: Rect, from: Point): PlacedLabel['leader'] {
  return leaderFor({ slot: 'seat', rect, penalty: 0, leaderFrom: from });
}

/**
 * An anchor under the label's own span (a value lifted straight over its
 * point, a callout above its slice) takes a leader from above or below, where
 * a side leader would double back. None when the run is a stub.
 */
function verticalLeader(rect: Rect, from: { x: number; y: number }): PlacedLabel['leader'] {
  if (from.x < rect.x || from.x > rect.x + rect.w) return undefined;
  const gutter = LEADER_GUTTER_RATIO * rect.h;
  const y = from.y > rect.y + rect.h ? rect.y + rect.h + gutter : from.y < rect.y ? rect.y - gutter : from.y;
  return Math.abs(y - from.y) < LEADER_MIN_DRAWN_RATIO * rect.h ? undefined : { d: leaderPath(from, { x: from.x, y }), curved: false };
}

/** The leader from an anchor: from the side, or from above or below when the anchor lies under the label. */
function anchorLeader(rect: Rect, anchor: { x: number; y: number }): PlacedLabel['leader'] {
  return leaderFor({ slot: 'anchor', rect, penalty: 0, leaderFrom: anchor, leaderVertical: true });
}

/** The drawn face's cap height, when the measurer knows the face (fontMetrics tables). */
function capHeightOf(req: LabelRequest, measure: TextMeasurer): { capHeight?: number } {
  const capHeight = measure.capHeight?.(req.fontStep ?? req.font);
  return capHeight === undefined ? {} : { capHeight };
}

function finalize(
  base: Omit<PlacedLabel, 'rect' | 'slot' | 'ink'>,
  _req: LabelRequest,
  cand: SlotCandidate,
  pinned: boolean,
  darkInk: string,
  lightInk: string,
): PlacedLabel {
  const fill = cand.insideFill ?? cand.onFill?.fill;
  const paint = cand.insidePaint ?? cand.onFill?.paint;
  const pattern = cand.insidePattern ?? cand.onFill?.pattern;
  const label: PlacedLabel = {
    ...base,
    ...(cand.lines ? { lines: cand.lines } : {}),
    ...(cand.swatch ? { swatch: cand.swatch } : {}),
    pinned,
    rect: cand.rect,
    slot: cand.slot,
    ...(_req.rotate ? { rotate: _req.rotate } : {}),
    // Halos and backing boxes use the page colour, so both need page ink.
    // Ordinary inside text chooses its ink against the mark itself.
    ink: { token: fill && !cand.needsBacking && pickInk(fill, darkInk, lightInk) === lightInk
      ? 'inkInverse' : 'ink' },
  };
  if (fill && paint && !cand.needsBacking && 'token' in label.ink) {
    label.ink = {
      ...label.ink,
      theme: {
        kind: 'contrast-ink',
        fill: paint,
        ...(pattern ? { pattern } : {}),
      },
    };
  }
  // A label that needs contrast help gets a halo (paint-order stroke in the
  // page colour), not an opaque box: the mark stays visible through it and
  // the label reads as text, not as a sticker.
  if (cand.needsBacking) {
    if (cand.contrast === 'box') label.backing = inflate(cand.rect, 2);
    else label.halo = true;
  }
  if (cand.leaderFrom) {
    const leader = leaderFor(cand);
    if (leader) label.leader = leader;
  }
  return label;
}
