import type { Theme } from './types/theme';
/**
 * The headline and the arrow of a callout (kind 'callout', fields `headline`
 * and `arrow`): a bold first line over plain text, "153" over "Peak in …",
 * and a thin arrow from the text to its point. `${value}` in the headline
 * prints the anchored value, so the number comes from the data.
 */

import { segmentHitsRect, unionRect, type Point, type Rect } from './geometry';
import type { OccupiedClaim, OccupiedIndex } from './label/occupied';
import { leaderPieces, seatLeader, type SlotCandidate } from './label/solver';
import { arrowLook, type ArrowLook } from './annotationArrow';
import type { FontSpec } from './text';
import type { Id, OwnerRef } from './types/cell';
import type { LintWarning, PlacedLabel, SceneNode } from './types/scene';

/** Under `marks.arrow.style: 'compact'`: from the text to its point, the head, and the air at the tip and at the text. */
const COMPACT_REACH = 22;
const COMPACT = { size: 4, tipGap: 4, tailGap: 3 };

/** The arrow look of a callout. */
export function calloutArrowLook(theme: Theme): ArrowLook {
  return arrowLook(theme, COMPACT);
}

/** From the point to the text of a seat beside it: the air at both ends, the head and the shortest shaft. */
export function calloutArrowReach(look: ArrowLook, edge: number): number {
  return look.standard ? edge + look.tipGap + look.depth + look.minShaft + look.tailGap : COMPACT_REACH;
}

export interface CalloutHeadPlan {
  /** The plain face the text prints in; the headline uses the emphasis weight. */
  font: FontSpec;
  headline: boolean;
  headlineLines?: number;
  headlineWeight?: number;
  /** `edge`: the radius of the marker at the anchor (0 on a bar end); the tip keeps its gap off that edge. */
  arrow?: { anchor: Point; edge: number; nodeIds: Id[]; owner: OwnerRef };
}

/**
 * The seats an arrow callout tries first: right and left of its point with
 * the first line level with it, so the arrow runs flat. A preferred side of
 * above or below keeps its seat ahead of these.
 */
export function arrowSeats(anchor: Point, w: number, h: number, lineH: number, prefer: string | undefined, reach: number, standard: boolean): SlotCandidate[] {
  const y = anchor.y - lineH / 2;
  const vertical = prefer === 'above' || prefer === 'below';
  const side: SlotCandidate[] = [
    { slot: 'arrowRight', rect: { x: anchor.x + reach, y, w, h }, penalty: vertical ? 0.5 : prefer === 'left' ? -2.5 : -3 },
    { slot: 'arrowLeft', rect: { x: anchor.x - reach - w, y, w, h }, penalty: vertical ? 0.6 : prefer === 'left' ? -3 : -2.5 },
  ];
  if (!standard) return side;
  // Under the standard the text also stands the full reach over or under its point, so a preferred side above or below keeps its arrow.
  return [
    ...side,
    { slot: 'arrowAbove', rect: { x: anchor.x - w / 2, y: anchor.y - reach - h, w, h }, penalty: prefer === 'above' ? -3 : prefer === 'below' ? 0.8 : 0.7 },
    { slot: 'arrowBelow', rect: { x: anchor.x - w / 2, y: anchor.y + reach, w, h }, penalty: prefer === 'below' ? -3 : prefer === 'above' ? 0.8 : 0.75 },
  ];
}

/** Where the shaft leaves the text: the side facing the point, level with the point where the text spans it. */
function tail(rect: Rect, anchor: Point, gap: number): Point {
  const y = Math.min(Math.max(anchor.y, rect.y), rect.y + rect.h);
  if (anchor.x < rect.x) return { x: rect.x - gap, y };
  if (anchor.x > rect.x + rect.w) return { x: rect.x + rect.w + gap, y };
  return { x: anchor.x, y: anchor.y < rect.y ? rect.y - gap : rect.y + rect.h + gap };
}

/**
 * After the solve: the text prints plain under a bold headline, and the arrow
 * runs from the text to its point and claims its run. A hidden callout draws
 * no arrow. A seat too near its point for the shortest shaft keeps its leader,
 * draws no arrow and warns: an arrow never shrinks below the standard.
 */
export function finishCalloutHeads(theme: Theme, labels: PlacedLabel[], plans: ReadonlyMap<Id, CalloutHeadPlan>, nodes: SceneNode[], occupied: OccupiedIndex, warnings: LintWarning[]): void {
  const look = calloutArrowLook(theme);
  for (const label of labels) {
    const plan = plans.get(label.id);
    if (!plan) continue;
    if (label.hidden) {
      plan.arrow?.nodeIds.splice(0);
      continue;
    }
    label.font = plan.font;
    if (plan.headline) {
      label.headLines = plan.headlineLines ?? 1;
      label.headWeight = plan.headlineWeight;
    }
    if (!plan.arrow) continue;
    const { anchor, owner, edge } = plan.arrow;
    const from = tail(label.rect, anchor, look.tailGap);
    const length = Math.hypot(anchor.x - from.x, anchor.y - from.y);
    const tipGap = look.standard ? edge + look.tipGap : look.tipGap;
    // Half a pixel of slack: a seat beside the point sits at the shortest shaft exactly.
    const tooShort = look.standard ? length - tipGap - look.depth < look.minShaft - 0.5 : length <= look.tipGap + COMPACT.size;
    if (tooShort) {
      plan.arrow.nodeIds.splice(0);
      if (look.standard) {
        warnings.push({
          code: 'callout-arrow-no-room', severity: 'warn', owner,
          message: `callout '${owner.annotationId}': its text found no seat far enough from its point for an arrow of ${look.minShaft} px, so it is drawn without the arrow`,
          suggest: 'Give the callout a preferSide with free room, or leave arrow out.',
        });
      }
      continue;
    }
    const ux = (anchor.x - from.x) / length;
    const uy = (anchor.y - from.y) / length;
    const tip = { x: anchor.x - ux * tipGap, y: anchor.y - uy * tipGap };
    const shaft = look.shaftEnd;
    const end = { x: tip.x - ux * shaft, y: tip.y - uy * shaft };
    const [shaftId, headId] = plan.arrow.nodeIds as [Id, Id];
    // The arrow replaces any leader the seat carried.
    delete label.leader;
    nodes.push(
      { t: 'path', id: shaftId, d: `M${from.x} ${from.y}L${end.x} ${end.y}`, stroke: { token: 'ink' }, width: look.stroke, owner, part: 'calloutArrow' },
      { t: 'path', id: headId, d: look.head(tip, Math.atan2(uy, ux)), fill: { token: 'ink' }, owner, part: 'calloutArrow' },
    );
    occupied.claim(
      { x: Math.min(from.x, tip.x) - 0.5, y: Math.min(from.y, tip.y) - 0.5, w: Math.abs(tip.x - from.x) + 1, h: Math.abs(tip.y - from.y) + 1 },
      'annotation', owner, 'calloutArrow',
    );
  }
}

/** The air between a value label and a leader that starts at its edge. */
const LEADER_LABEL_CLEARANCE = 3;

/**
 * Whether a claim is the label that prints the anchored mark's own value. Every
 * owner key must match, absent ones included: a column total's anchor (a
 * category alone) never takes a segment's value as its own.
 */
function printsAnchor(claim: OccupiedClaim, anchor: OwnerRef): boolean {
  if (claim.kind !== 'label' || claim.owner.annotationId !== undefined) return false;
  const keys = ['seriesId', 'categoryId', 'segmentId', 'pointId', 'valueLineId', 'rowId', 'colId'] as const;
  return keys.some((key) => anchor[key] !== undefined) && keys.every((key) => claim.owner[key] === anchor[key]);
}

/** The box around a leader's pieces. */
function leaderBox(pieces: readonly [Point, Point][]): Rect {
  const xs = pieces.flatMap(([a, b]) => [a.x, b.x]);
  const ys = pieces.flatMap(([a, b]) => [a.y, b.y]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** The box of the value printed at an anchored mark (the number over its column), within `reach` of the anchor's box. */
export function anchorValueBox(occupied: OccupiedIndex, near: Rect, anchor: OwnerRef, reach: number): Rect | undefined {
  const own = occupied.hitsWhich({ x: near.x - reach, y: near.y - reach, w: near.w + reach * 2, h: near.h + reach * 2 }, 0)
    .filter((claim) => printsAnchor(claim, anchor));
  return own.length === 0 ? undefined : own.slice(1).reduce((u, { rect }) => unionRect(u, rect), own[0]!.rect);
}

/** The point a leader starts at beside a printed value: its edge nearest the text, a few pixels off. */
export function valueEdgeToward(value: Rect, text: Rect): Point {
  const c = LEADER_LABEL_CLEARANCE;
  return {
    x: Math.min(Math.max(text.x + text.w / 2, value.x - c), value.x + value.w + c),
    y: Math.min(Math.max(text.y + text.h / 2, value.y - c), value.y + value.h + c),
  };
}

/** Whether a drawn leader crosses a label already on the page. */
export function leaderCrossesLabel(d: string, occupied: OccupiedIndex): boolean {
  return leaderPieces(d, 32).some(([a, b]) => occupied.hitsWhich(leaderBox([[a, b]]), 0)
    .some((claim) => claim.kind === 'label' && segmentHitsRect(a, b, claim.rect)));
}

/**
 * A callout's, note's, abs's or delta's leader that would run through the value
 * printed at its own mark (the number over the bar it points at) starts at the edge of
 * that value instead, a few pixels off: it points at the number and its mark
 * together, and no line crosses the text. `anchors` maps a label id to the
 * mark its leader runs from. A leader that would then cross another label
 * keeps its run, and `haloLabelsUnderLeaders` keeps the text in front of it.
 */
export function leadersOffAnchorValues(labels: readonly PlacedLabel[], anchors: ReadonlyMap<Id, OwnerRef>, occupied: OccupiedIndex): void {
  for (const label of labels) {
    const anchor = anchors.get(label.id);
    if (label.hidden || !label.leader || !anchor) continue;
    const pieces = leaderPieces(label.leader.d, 32);
    const own = occupied.hitsWhich(leaderBox(pieces), 0)
      .filter((claim) => printsAnchor(claim, anchor) && pieces.some(([a, b]) => segmentHitsRect(a, b, claim.rect)));
    if (own.length === 0) continue;
    const box = own.slice(1).reduce((u, { rect }) => unionRect(u, rect), own[0]!.rect);
    const from = valueEdgeToward(box, label.rect);
    const leader = seatLeader(label.rect, from);
    if (!leader) continue;
    const next = leaderPieces(leader.d, 32);
    const blocked = occupied.hitsWhich(leaderBox(next), 0).some((claim) => claim.kind === 'label' &&
      claim.owner.annotationId !== label.owner.annotationId && next.some(([a, b]) => segmentHitsRect(a, b, claim.rect)));
    if (!blocked) label.leader = leader;
  }
}

/**
 * Text is always in front of a leader: each label that an annotation label's
 * leader (a callout's, for one) still crosses takes the halo, a gap in the
 * line around its glyphs. Runs over a chart's full label list, where its
 * value labels and its annotation labels meet. Returns the ids of the labels
 * whose leaders cross another label: the emitter paints those leaders before
 * every label, so no text lies under them.
 */
export function haloLabelsUnderLeaders(labels: readonly PlacedLabel[]): Set<Id> {
  const crossing = new Set<Id>();
  for (const label of labels) {
    if (label.kind !== 'annotation' || !label.leader || label.hidden) continue;
    const pieces = leaderPieces(label.leader.d, 32);
    for (const other of labels) {
      if (other === label || other.hidden || !pieces.some(([a, b]) => segmentHitsRect(a, b, other.rect))) continue;
      other.halo = true;
      crossing.add(label.id);
    }
  }
  return crossing;
}
