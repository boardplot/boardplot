import { emphasisWeight, strokeToken, dashToken } from './theme';
/**
 * The gap bracket: the end gap between two lines, stated in the right margin.
 * Each end point gets an open ring, a thin dashed guide runs from each ring to
 * the margin, and a bracket with an arrowhead spans the two guides. The gap
 * prints as one large number beside the bracket, with an optional short
 * caption under it. Layout owns the geometry here; the label solver places
 * the number and the caption.
 */
import type { AnchorResolution } from './annotate';
import type { ArmDrawPass } from './annotateArms';
import { PRIORITY } from './label/solver';
import { arrowHeadPath, arrowShaftEnd } from './svgPath';
import { wrapText } from './text';
import { computedTextRole } from './textRole';
import type { Annotation } from './types/annotations';
import type { Id } from './types/cell';
import type { AnnotationDerivation, PlacedAnnotation, PlacedLabel, SceneNode } from './types/scene';

/** What a chart hands the pass so a delta or diff can stand as a gap bracket. */
export interface GapBracketFrame {
  /** The category a bracket stands at: the last one. */
  categoryId: Id;
  /** x of the bracket spine: the right edge of the canvas content. */
  spine: number;
  /** Canvas width; the caption wraps to a share of it. */
  width: number;
  /** The two series a gap wash spans (line gapFill): there 'auto' draws the bracket. */
  washed?: readonly [Id, Id];
  /** Annotations whose number found no seat in an earlier pass: they keep the label (gap-bracket-unavailable). */
  refused?: readonly Id[];
  /** Why the chart cannot draw a bracket at all (stacked values): every gap annotation keeps its label. */
  unavailable?: string;
  /**
   * This module, handed in by the chart: the annotation pass imports its
   * types only, so a chart without the bracket (pareto) does not bundle it.
   */
  engine: typeof gapBracketEngine;
}

/** One bracket, planned before the solve and drawn after it. */
export interface GapBracketPlan {
  annotation: PlacedAnnotation;
  captionId?: Id;
  /** Pixels the right margin lacks for this bracket beside the labels at the line ends. */
  need: number;
}

const RING = 4;


const ARROW = 5;
/** Air between the spine and the number, and around labels a guide passes. */
const GAP = 6;
/** The caption wraps to this share of the canvas width, as wide as the number needs at least. */
const CAPTION_SHARE = 0.16;

type GapAnnotation = Extract<Annotation, { kind: 'delta' | 'diff' }>;

/**
 * True where the annotation stands as a bracket: two different series at the
 * frame's category, on a chart that offers the frame. 'bracket' asks for it;
 * 'auto' (the default) draws it where a gap wash spans the same two series,
 * as the gap is then the subject; 'label' keeps the label at the anchor.
 */
function gapBracketApplies(frame: GapBracketFrame | undefined, ann: GapAnnotation, a: AnchorResolution, b: AnchorResolution | null): boolean {
  if (!frame || frame.unavailable || ann.placement === 'label' || !b) return false;
  const [sa, sb] = [a.owner.seriesId, b.owner.seriesId];
  const fits = a.owner.categoryId === frame.categoryId && b.owner.categoryId === frame.categoryId &&
    sa !== undefined && sb !== undefined && sa !== sb && Math.abs(a.y - b.y) >= 1;
  return fits && (ann.placement === 'bracket' || (frame.washed?.includes(sa) === true && frame.washed.includes(sb)));
}

/**
 * Draw a bracket from `tail` (the reference) to `head` (the measured value):
 * the rings, guides and spine go in, and the number and the caption go to the
 * solver beside the spine. `need` says how far the column reaches left over
 * the labels already beside the line ends, so the chart can widen its margin
 * by that much.
 */
function planGapBracket(
  pass: ArmDrawPass, frame: GapBracketFrame, tail: AnchorResolution, head: AnchorResolution,
  text: string, computed: string, caption: string | undefined, id: Id, kind: 'delta' | 'diff', derivation: AnnotationDerivation,
): GapBracketPlan {
  const { input } = pass;
  const { type } = input.theme;
  const numberFont = { family: type.figure?.family ?? type.family, ...type.title, weight: type.figure?.weight ?? emphasisWeight(input.theme) };
  const captionFont = { family: type.family, ...type.axis };
  const number = input.measure(text, numberFont);
  const spine = frame.spine - ARROW;
  const numberX = spine - GAP - number.width;
  const top = Math.min(tail.y, head.y);
  const bottom = Math.max(tail.y, head.y);
  const mid = (top + bottom) / 2;
  const owner = { annotationId: id };
  const labelId = `annotation:${id}`;
  const priority = pass.priority ?? PRIORITY.valueLine;
  // Between the guides where the number fits, else under the lower one.
  const fits = number.height <= bottom - top - 2;
  const numberSeat = (y: number) => ({ x: numberX, y, w: number.width, h: number.height });
  const seats = fits ? [numberSeat(mid - number.height / 2), numberSeat(bottom + 3)] : [numberSeat(bottom + 3)];
  pass.labelRequests.push({
    id: labelId, kind: 'annotation', role: computedTextRole(text, computed), owner, text, lines: [text], font: numberFont,
    priority, candidates: seats.map((rect, i) => ({ slot: i === 0 && fits ? 'bracketMid' : 'bracketBelow', rect, penalty: i })),
  });
  let columnLeft = numberX;
  let columnBottom = bottom + number.height + 3;
  let captionId: Id | undefined;
  if (caption) {
    const longest = Math.max(...caption.split(/\s+/).map((word) => input.measure(word, captionFont).width));
    const width = Math.max(number.width + GAP, longest, Math.round(frame.width * CAPTION_SHARE));
    const lines = wrapText(caption, captionFont, width, 8, input.measure).lines;
    const lineH = input.measure('X', captionFont).height;
    const w = Math.max(...lines.map((line) => input.measure(line, captionFont).width));
    const x = spine - w;
    columnLeft = Math.min(columnLeft, x);
    columnBottom = bottom + number.height + 6 + lineH * lines.length;
    captionId = `${labelId}:caption`;
    const under = (y: number) => ({ x, y, w, h: lineH * lines.length });
    pass.labelRequests.push({
      id: captionId, kind: 'annotation', role: 'note', owner, text: lines.join(' '), lines, font: captionFont, align: 'end',
      priority: priority - 1,
      candidates: [
        ...(fits ? [{ slot: 'bracketCaption', rect: under(Math.max(bottom, mid + number.height / 2) + 4), penalty: 0 }] : []),
        { slot: 'bracketCaptionLow', rect: under(bottom + number.height + 6), penalty: 1 },
      ],
    });
  }
  // The column must clear what already stands right of the line ends: the
  // end values and names. Rings and guides go in after that check.
  const reach = input.occupied.hitsWhich({ x: head.x, y: top - number.height, w: spine - head.x, h: columnBottom - top + number.height }, 0,
    (claim) => claim.kind !== 'label' || claim.owner.seriesId === undefined || claim.rect.x + claim.rect.w <= head.x + 1)
    .reduce((right, claim) => Math.max(right, claim.rect.x + claim.rect.w), head.x + RING);
  const need = Math.max(0, reach + 2 * GAP - columnLeft);
  for (const end of [tail, head]) input.occupied.claim({ x: end.x - RING, y: end.y - RING, w: 2 * RING, h: 2 * RING }, 'annotation', owner, 'gapRing');
  input.occupied.claim({ x: spine - 1, y: top - 1, w: ARROW + 2, h: bottom - top + 2 }, 'annotation', owner, 'bracket');
  // The furniture goes in now: the pass cuts each dashed guide around the
  // labels it would cross once they are solved (trimAnnotationGuides), and
  // drops it all when the number finds no seat (pruneOrphanAnnotationArms);
  // the chart then lays out again with the label (GapBracketFrame.refused).
  const base = `ann:${id}`;
  const nodeIds: Id[] = [];
  const add = (node: SceneNode) => {
    pass.nodes.push(node);
    nodeIds.push(node.id);
  };
  for (const [i, end] of [tail, head].entries()) {
    add({ t: 'line', id: `${base}:guide${i}`, x1: end.x + RING, y1: end.y, x2: spine, y2: end.y, stroke: { token: 'leader' }, width: strokeToken(input.theme, 'rule'), dash: dashToken(input.theme, 'reference'), owner, part: 'leader' });
  }
  const up = head.y < tail.y ? -1 : 1;
  add({ t: 'path', id: `${base}:bracket`, d: `M${spine} ${tail.y}L${spine} ${head.y - up * arrowShaftEnd(ARROW, strokeToken(input.theme, 'rule'))}`, stroke: { token: 'ink' }, width: strokeToken(input.theme, 'rule'), owner, part: 'bracket' });
  add({ t: 'path', id: `${base}:bracketHead`, d: arrowHeadPath({ x: spine, y: head.y }, up * Math.PI / 2, ARROW), fill: { token: 'ink' }, owner, part: 'arrowHead' });
  // Rings last, over the line ends and the guides' starts.
  for (const [i, end] of [tail, head].entries()) {
    add({ t: 'circle', id: `${base}:ring${i}`, cx: end.x, cy: end.y, r: RING, fill: { token: 'background' }, stroke: { token: 'ink' }, strokeWidth: strokeToken(input.theme, 'mark'), owner, part: 'gapRing' });
  }
  const annotation: PlacedAnnotation = { id, kind, computedText: computed, nodeIds, labelId, derivation };
  pass.placed.push(annotation);
  return { annotation, need, ...(captionId ? { captionId } : {}) };
}

/** After the solve: the caption reads in muted ink, and goes with a number that found no seat. */
function finishGapBrackets(plans: readonly GapBracketPlan[], labels: readonly PlacedLabel[]): void {
  for (const { annotation, captionId } of plans) {
    const caption = captionId ? labels.find((label) => label.id === captionId) : undefined;
    if (!caption) continue;
    if (labels.find((label) => label.id === annotation.labelId)?.hidden) caption.hidden = 'collision';
    else if (!caption.hidden) caption.ink = { token: 'inkMuted' };
  }
}

export const gapBracketEngine = { applies: gapBracketApplies, plan: planGapBracket, finish: finishGapBrackets };
