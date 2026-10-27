import { emphasisWeight, strokeToken, dashToken } from './theme';
/**
 * CAGR liftArm (columns/lines) and shiftCapsule (horizontal bars), plus
 * level-difference arrows in both orientations. Arithmetic stays in the
 * annotate pass; this module only places engine-computed text.
 */

import type { Point, Rect } from './geometry';
import { PRIORITY, type LabelRequest } from './label/solver';
import { arrowHeadPath, arrowShaftEnd } from './svgPath';
import { computedTextRole } from './textRole';
import type { OccupiedIndex } from './label/occupied';
import type { Id, OwnerRef } from './types/cell';
import type { AnnotationDerivation, PlacedAnnotation, SceneNode } from './types/scene';
import type { Theme } from './types/theme';
import type { TextMeasurer, FontSpec } from './text';
import type { AnchorResolution, AnnotatePassInput } from './annotate';
import { maxOf, minOf, pushAll } from './arrays';

const ARM_CLEARANCE = 10;
const ARM_STEP = 8;
const MAX_LIFTS = 40;
const ARM_ARROW = 5;
const ARM_START_GAP = 12;
const ARM_END_GAP = 12;
/** A growth bracket with its label on the run: the arrow stops this far over the end label. */
const ARM_END_GAP_ON_ARM = 4;
/** The air the run leaves beside a label seated on it (REFERENCE_LABEL_CLEARANCE). */
const ON_ARM_CLEARANCE = 3;
/**
 * The highest a run with its label on it sits: this far under the top of the
 * frame's plot area (the end of the header), so the label keeps clear air
 * under the subtitle (the run sits 38.5 px under the subtitle baseline at
 * 400 to 960 px; the plot area starts about 5.5 px under it).
 */
const ON_ARM_TOP = 41;
const MIN_LEG = 16;
/** Bar inset (AnnotatePassInput.barInset): the arm stands this far right of the bars it spans. */
const INSET_ARM = 22;
/** Bar inset: air between a bar end and the arm's leg or arrow tip, and between the arm and its label. */
const INSET_GAP = 6;
/** Bar inset: the shortest leg shaft beside the arrowhead. */
const INSET_MIN_LEG = 4;
/** Bar inset: the arrow of a gap stops this far from the shorter bar's end. */
const INSET_TIP_GAP = 4;

/** Parts of a computed comparison text, so a bar can style its lead apart from its number. */
interface ComparisonParts {
  lead: string;
  value: string;
}

export interface ArmDrawPass {
  input: AnnotatePassInput;
  nodes: SceneNode[];
  labelRequests: LabelRequest[];
  placed: PlacedAnnotation[];
  nid: (part: string) => Id;
  priority?: number;
  addLegDeficit: (pixels: number) => void;
  /**
   * Arrow heights for a level difference, in the chart's order of preference.
   * The funnel names its own, because the gaps between its rows hold the step
   * captions. Absent, the generic heights apply.
   */
  diffHeights?: readonly number[];
  /**
   * Append a warning to the run's log, owned by the annotation being drawn.
   * A comparison hook that drops furniture rather than drawing it says so
   * here; the pass owns the log, so the hook never touches it directly.
   */
  warn?: (code: string, message: string, suggest?: string) => void;
}

function ownAnchorMark(occupiedOwner: OwnerRef, occupiedKind: string, occupiedPart: string | undefined, anchorOwner: OwnerRef): boolean {
  const sameCategory =
    anchorOwner.categoryId !== undefined && occupiedOwner.categoryId === anchorOwner.categoryId;
  return (
    occupiedKind === 'mark' &&
    sameCategory &&
    ((anchorOwner.seriesId === undefined && occupiedOwner.seriesId === undefined) ||
      ((occupiedPart === 'segment' || occupiedPart === 'bar') &&
        (anchorOwner.seriesId === undefined || occupiedOwner.seriesId === anchorOwner.seriesId)))
  );
}

function claimSegment(
  occupied: OccupiedIndex,
  annId: Id,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  part: 'arm' | 'leg',
): void {
  occupied.claim(
    {
      x: Math.min(x0, x1) - 3,
      y: Math.min(y0, y1) - 3,
      w: Math.abs(x1 - x0) + 6,
      h: Math.abs(y1 - y0) + 6,
    },
    'annotation',
    { annotationId: annId },
    part,
  );
}

function claimArrowHead(occupied: OccupiedIndex, annId: Id, x: number, y: number): void {
  occupied.claim({ x: x - 5, y: y - 5, w: 10, h: 10 }, 'annotation', { annotationId: annId }, 'arrowHead');
}

function measureArmLabel(input: { theme: Theme; measure: TextMeasurer }, text: string) {
  const font = { family: input.theme.type.family, ...input.theme.type.label, weight: emphasisWeight(input.theme) };
  return { font, tsize: input.measure(text, font) };
}

function laneTop(occupied: OccupiedIndex, plotY: number, x: number, anchorY: number, anchorOwner: OwnerRef, ceiling = -Infinity): number {
  let top = anchorY;
  for (const o of occupied.snapshot()) {
    const r = o.rect;
    if (ownAnchorMark(o.owner, o.kind, o.part, anchorOwner) || (o.kind !== 'label' && r.y + r.h <= plotY) || r.y + r.h <= ceiling) continue;
    if (x >= r.x - 3 && x <= r.x + r.w + 3 && r.y < anchorY) top = Math.min(top, r.y);
  }
  return top;
}

/**
 * An anchor under another series' mark: a middle layer of a stack, or a line
 * point below another line. The lane's top is then that other mark, so a leg
 * from there would read as the growth of the total or of the other series.
 */
function buried(occupied: OccupiedIndex, anchor: AnchorResolution): boolean {
  const own = anchor.series?.id;
  return own !== undefined && occupied.snapshot().some(({ kind, owner, rect }) =>
    kind === 'mark' && owner.seriesId !== undefined && owner.seriesId !== own &&
    anchor.x >= rect.x && anchor.x <= rect.x + rect.w && rect.y < anchor.y - 1);
}

/**
 * Where a leg into a stack runs: beside the value labels of the column above
 * the anchor, on the given side, while that stays inside the column. A line
 * point keeps its x, and a leg that finds no room crosses at the centre.
 */
function besideLabels(input: AnnotatePassInput, anchor: AnchorResolution, side: number): number {
  if (anchor.lineAnchored) return anchor.x;
  const lane = input.occupied.snapshot().filter(({ rect }) =>
    anchor.x >= rect.x - 1 && anchor.x <= rect.x + rect.w + 1 && rect.y < anchor.y - 1 && rect.y >= input.plot.y);
  const labels = lane.filter(({ kind }) => kind === 'label').map(({ rect }) => rect);
  const column = lane.filter(({ kind, owner }) => kind === 'mark' && owner.seriesId !== anchor.series?.id).map(({ rect }) => rect);
  if (labels.length === 0 || column.length === 0) return anchor.x;
  const x = side < 0 ? minOf(labels.map((r) => r.x)) - 4 : maxOf(labels.map((r) => r.x + r.w)) + 4;
  return column.every((r) => x >= r.x + 3 && x <= r.x + r.w - 3) ? x : anchor.x;
}

/**
 * The stretches of a vertical leg at x, top to bottom, that cross no text
 * and, on a line, no other series' point or stroke. A leg down to a buried
 * anchor passes the marks above it; it breaks where it would strike a label.
 */
function legRuns(occupied: OccupiedIndex, x: number, top: number, bottom: number, anchor: AnchorResolution): [number, number][] {
  const cuts = occupied.snapshot()
    .filter(({ kind, owner, rect }) =>
      (kind === 'label' || (anchor.lineAnchored === true && kind === 'mark' && owner.seriesId !== anchor.series?.id)) &&
      x >= rect.x - 1 && x <= rect.x + rect.w + 1 && rect.y - 2 > top && rect.y < bottom)
    .map(({ rect }) => [rect.y - 2, rect.y + rect.h + 2] as const)
    .sort((p, q) => p[0] - q[0]);
  const runs: [number, number][] = [];
  let y = top;
  for (const [from, to] of cuts) {
    if (from > y) runs.push([y, Math.min(from, bottom)]);
    y = Math.max(y, to);
  }
  if (y < bottom) runs.push([y, bottom]);
  return runs;
}

function pushCagrPlacement(
  pass: ArmDrawPass,
  annId: Id,
  text: string,
  computed: string,
  font: FontSpec,
  candidates: LabelRequest['candidates'],
  nodeIds: Id[],
  derivation?: AnnotationDerivation,
): void {
  pass.labelRequests.push({
    id: `annotation:${annId}`,
    kind: 'annotation',
    role: computedTextRole(text, computed),
    owner: { annotationId: annId },
    text,
    lines: [text],
    typeRole: 'label', font,
    priority: pass.priority ?? PRIORITY.valueLine,
    candidates,
  });
  pass.placed.push({
    id: annId,
    kind: 'cagr',
    computedText: computed,
    nodeIds,
    labelId: `annotation:${annId}`,
    ...(derivation ? { derivation } : {}),
  });
}

function drawLiftedCagrArm(
  pass: ArmDrawPass,
  a: AnchorResolution,
  b: AnchorResolution,
  text: string,
  annId: Id,
  computed: string,
  derivation?: AnnotationDerivation,
): void {
  const { input, nodes, nid } = pass;
  const { font, tsize } = measureArmLabel(input, text);
  // An anchor inside a stack or under another line gets a leg down to itself;
  // in a stack the leg steps beside the labels above it, the start leftward, the arrow rightward.
  const buriedA = buried(input.occupied, a);
  const buriedB = buried(input.occupied, b);
  const outward = a.x <= b.x ? 1 : -1;
  if (buriedA) a = { ...a, x: besideLabels(input, a, -outward) };
  if (buriedB) b = { ...b, x: besideLabels(input, b, outward) };
  const leftAnchor = a.x <= b.x ? a : b;
  const rightAnchor = a.x <= b.x ? b : a;
  const spanX0 = leftAnchor.x;
  const spanX1 = rightAnchor.x;
  const startY = laneTop(input.occupied, input.plot.y, spanX0, leftAnchor.y, leftAnchor.owner, input.laneCeiling);
  const endY = laneTop(input.occupied, input.plot.y, spanX1, rightAnchor.y, rightAnchor.owner, input.laneCeiling);
  const direction = a.x <= b.x ? 1 : -1;
  const fromY = direction === 1 ? startY : endY;
  const toY = direction === 1 ? endY : startY;
  const onArm = input.cagrLabelOnArm === true;
  const endGap = onArm ? ARM_END_GAP_ON_ARM : ARM_END_GAP;
  const endpointCeiling = Math.min(startY, endY) - ARM_CLEARANCE - 8;
  const labelX = (spanX0 + spanX1) / 2 - tsize.width / 2;
  const labelAt = (y: number): Rect => onArm
    ? { x: labelX, y: y - tsize.height / 2, w: tsize.width, h: tsize.height }
    : { x: labelX, y: y - 4 - tsize.height, w: tsize.width, h: tsize.height };
  const armFloor = onArm
    ? Math.max(input.plot.y + tsize.height / 2 + 2, (input.bandCeiling ?? input.plot.y) + ON_ARM_TOP)
    : input.plot.y + tsize.height + 6;
  let armY = Math.max(endpointCeiling, armFloor);
  let bandOvershoot = 0;
  for (let i = 0; i < MAX_LIFTS; i++) {
    const armRect: Rect = { x: spanX0, y: armY - 3, w: spanX1 - spanX0, h: 6 };
    const labelRect: Rect = labelAt(armY);
    const blocked = input.occupied.hits(armRect, 2) || input.occupied.hits(labelRect, 2);
    if (armY <= endpointCeiling && !blocked) break;
    // A blocked label that has left the band over the plot runs
    // into the header. Report the overshoot, so a chart that can grow its band
    // (column CAGR_PAD) makes the room instead of lifting the label off the canvas.
    if (blocked && bandOvershoot === 0 && labelRect.y < input.plot.y) bandOvershoot = input.plot.y - labelRect.y;
    armY -= ARM_STEP;
  }
  if (bandOvershoot > 0 && labelAt(armY).y < input.plot.y) pass.addLegDeficit(bandOvershoot);
  // Floating stubs keep a line's arm off the plot frame; an arm that names
  // one series of several runs its legs to that series' points instead,
  // unless a leg would pass another series' point on the way.
  const stubs = a.lineAnchored && b.lineAnchored && (!a.series && !b.series || buriedA || buriedB);
  if (!stubs) {
    const legFloor = Math.min(fromY - ARM_START_GAP, toY - endGap - arrowShaftEnd(ARM_ARROW, strokeToken(input.theme, 'rule'))) - MIN_LEG;
    if (armY > legFloor) {
      const candidate = Math.max(legFloor, armFloor);
      const candidateArm: Rect = { x: spanX0, y: candidate - 3, w: spanX1 - spanX0, h: 6 };
      const candidateLabel: Rect = labelAt(candidate);
      if (
        candidate < armY &&
        candidate <= endpointCeiling &&
        !input.occupied.hits(candidateArm, 2) &&
        !input.occupied.hits(candidateLabel, 2)
      ) {
        armY = candidate;
      }
      if (armY > legFloor) pass.addLegDeficit(armY - legFloor);
    }
  }

  const pathId = nid('arm');
  const headId = nid('arrowHead');
  if (stubs) {
    const STUB = 10;
    const armEnd = b.x - direction * arrowShaftEnd(ARM_ARROW, strokeToken(input.theme, 'rule'));
    nodes.push({
      t: 'path', id: pathId, d: `M${a.x} ${armY + STUB}L${a.x} ${armY}L${armEnd} ${armY}`,
      stroke: { token: 'ink' }, width: strokeToken(input.theme, 'rule'), owner: { annotationId: annId }, part: 'arm',
    });
    nodes.push({
      t: 'path', id: headId, d: arrowHeadPath({ x: b.x, y: armY }, direction === 1 ? 0 : Math.PI, ARM_ARROW),
      fill: { token: 'ink' }, owner: { annotationId: annId }, part: 'arrowHead',
    });
    claimSegment(input.occupied, annId, a.x, armY + STUB, a.x, armY, 'leg');
    claimSegment(input.occupied, annId, a.x, armY, armEnd, armY, 'arm');
    claimArrowHead(input.occupied, annId, b.x, armY);
  } else {
    // A buried anchor's leg runs down to the segment edge, or to the point.
    const reach = (anchor: AnchorResolution) => anchor.y - (anchor.lineAnchored ? 6 : 4);
    const legStartY = buriedA ? reach(a) : fromY - ARM_START_GAP;
    const tipY = buriedB ? reach(b) : toY - endGap;
    const legEndY = tipY - arrowShaftEnd(ARM_ARROW, strokeToken(input.theme, 'rule'));
    const up = legRuns(input.occupied, a.x, armY, legStartY, a).reverse()
      .map(([top, bottom]) => `M${a.x} ${bottom}L${a.x} ${top}`).join('');
    const down = legRuns(input.occupied, b.x, armY, legEndY, b)
      .map(([top, bottom], index) => `${index === 0 ? '' : `M${b.x} ${top}`}L${b.x} ${bottom}`).join('');
    nodes.push({
      t: 'path', id: pathId,
      d: `${up}L${b.x} ${armY}${down}`,
      stroke: { token: 'ink' }, width: strokeToken(input.theme, 'rule'), owner: { annotationId: annId }, part: 'arm',
    });
    nodes.push({
      t: 'path', id: headId,
      d: arrowHeadPath({ x: b.x, y: tipY }, Math.PI / 2, ARM_ARROW),
      fill: { token: 'ink' }, owner: { annotationId: annId }, part: 'arrowHead',
    });
    claimSegment(input.occupied, annId, a.x, legStartY, a.x, armY, 'leg');
    if (onArm) {
      // The run is claimed either side of the label's seat; the label takes the seat, the run breaks there.
      const seat0 = labelX - ON_ARM_CLEARANCE;
      const seat1 = labelX + tsize.width + ON_ARM_CLEARANCE;
      if (seat0 > Math.min(a.x, b.x)) claimSegment(input.occupied, annId, Math.min(a.x, b.x), armY, seat0, armY, 'arm');
      if (seat1 < Math.max(a.x, b.x)) claimSegment(input.occupied, annId, seat1, armY, Math.max(a.x, b.x), armY, 'arm');
    } else claimSegment(input.occupied, annId, a.x, armY, b.x, armY, 'arm');
    claimSegment(input.occupied, annId, b.x, armY, b.x, legEndY, 'leg');
    // A head 4 px over the end label claims its own box (it points down, 4.5 px tall), not a square past its tip.
    if (onArm) input.occupied.claim({ x: b.x - 3, y: tipY - 5, w: 6, h: 5 }, 'annotation', { annotationId: annId }, 'arrowHead');
    else claimArrowHead(input.occupied, annId, b.x, tipY);
  }

  pushCagrPlacement(pass, annId, text, computed, font, [
    ...(onArm && !stubs ? [{ slot: 'onArm', rect: labelAt(armY), penalty: 0 }] : []),
    { slot: 'aboveArm', rect: { x: labelX, y: armY - 4 - tsize.height, w: tsize.width, h: tsize.height }, penalty: onArm ? 1 : 0 },
    { slot: 'belowArm', rect: { x: labelX, y: armY + 4, w: tsize.width, h: tsize.height }, penalty: onArm ? 2 : 1 },
  ], [pathId, headId], derivation);
}

/**
 * Bar inset: the series name in the label's regular weight and muted ink over
 * the bold rate, both flush right against the arm, between the bars it spans.
 * A label with no free seat there stands right of the arm.
 */
function pushInsetCagrPlacement(
  pass: ArmDrawPass,
  annId: Id,
  text: string,
  computed: string,
  font: FontSpec,
  armX: number,
  midY: number,
  parts: ComparisonParts | undefined,
  nodeIds: Id[],
  derivation?: AnnotationDerivation,
  span?: readonly [number, number],
): void {
  const { input } = pass;
  const regular: FontSpec = { family: input.theme.type.family, ...input.theme.type.label };
  const lines = parts ? [parts.lead, parts.value] : [text];
  const lineH = font.size * (font.lineHeight ?? 1.2);
  const w = Math.max(...lines.map((line, i) => input.measure(line, parts && i === 0 ? regular : font).width));
  const h = lines.length === 1 ? input.measure(text, font).height : lines.length * lineH;
  pass.labelRequests.push({
    id: `annotation:${annId}`,
    kind: 'annotation',
    role: computedTextRole(text, computed),
    owner: { annotationId: annId },
    text,
    lines,
    typeRole: 'label', font,
    priority: pass.priority ?? PRIORITY.valueLine,
    align: 'end',
    ...(parts ? { headLines: 1, headWeight: regular.weight, headInk: { token: 'inkMuted' as const } } : {}),
    candidates: [
      { slot: 'leftArm', rect: { x: armX - INSET_GAP - w, y: midY - h / 2, w, h }, penalty: 0 },
      // Type steps: inside the arm the label may slide up or down to the gap between two rows.
      ...(span ? [0.25, -0.25, 0.5, -0.5, 0.75, -0.75, 1, -1].flatMap((k, i) => {
        const y = midY - h / 2 + k * h;
        return y >= span[0] && y + h <= span[1] ? [{ slot: `leftArm:${i}`, rect: { x: armX - INSET_GAP - w, y, w, h }, penalty: 0.1 + i * 0.1 }] : [];
      }) : []),
      { slot: 'rightArm', rect: { x: armX + 4, y: midY - h / 2, w, h }, penalty: 1 },
    ],
  });
  pass.placed.push({
    id: annId,
    kind: 'cagr',
    computedText: computed,
    nodeIds,
    labelId: `annotation:${annId}`,
    ...(derivation ? { derivation } : {}),
  });
}

function drawShiftedCagrArm(
  pass: ArmDrawPass,
  a: AnchorResolution,
  b: AnchorResolution,
  text: string,
  annId: Id,
  computed: string,
  derivation?: AnnotationDerivation,
  parts?: ComparisonParts,
): void {
  const { input, nodes, nid } = pass;
  const inset = input.barInset !== undefined;
  const { font, tsize } = measureArmLabel(input, text);
  const startGap = inset ? INSET_GAP : ARM_START_GAP;
  const endGap = inset ? INSET_GAP : ARM_END_GAP;
  // An anchor that names its row gets its leg at the row's middle, so the
  // arrow ends on the row and not on its edge with the next one.
  if (a.row) a = { ...a, y: a.row.y + a.row.h / 2 };
  if (b.row) b = { ...b, y: b.row.y + b.row.h / 2 };
  const topAnchor = a.y <= b.y ? a : b;
  const botAnchor = a.y <= b.y ? b : a;
  const spanY0 = topAnchor.y;
  const spanY1 = botAnchor.y;
  const plotRight = input.plot.x + input.plot.w;
  const clearOfLane = (y: number, anchorX: number, anchorOwner: OwnerRef): number => {
    let right = anchorX;
    for (const o of input.occupied.snapshot()) {
      const r = o.rect;
      if (ownAnchorMark(o.owner, o.kind, o.part, anchorOwner) || (o.kind !== 'label' && r.x >= plotRight)) continue;
      if (y >= r.y - 3 && y <= r.y + r.h + 3 && r.x + r.w > anchorX) right = Math.max(right, r.x + r.w);
    }
    return right;
  };
  const startX = clearOfLane(spanY0, topAnchor.x, topAnchor.owner);
  const endX = clearOfLane(spanY1, botAnchor.x, botAnchor.owner);
  const fromX = a.y <= b.y ? startX : endX;
  const toX = a.y <= b.y ? endX : startX;
  // Inset: the arm stands just right of the bars, and its label inside it.
  const endpointFloor = Math.max(startX, endX) + (inset ? INSET_ARM : ARM_CLEARANCE + 8);
  let armX = inset ? endpointFloor : Math.min(endpointFloor, plotRight - tsize.width - 6);
  for (let i = 0; i < MAX_LIFTS; i++) {
    const armRect: Rect = { x: armX - 3, y: spanY0, w: 6, h: Math.max(spanY1 - spanY0, 1) };
    const labelRect: Rect = {
      x: armX + 4,
      y: (spanY0 + spanY1) / 2 - tsize.height / 2,
      w: tsize.width,
      h: tsize.height,
    };
    const legsReachClearEndpoints = armX >= endpointFloor;
    if (legsReachClearEndpoints && !input.occupied.hits(armRect, 2) && (inset || !input.occupied.hits(labelRect, 2))) break;
    armX += ARM_STEP;
  }
  const legFloor = Math.max(fromX + startGap, toX + endGap + arrowShaftEnd(ARM_ARROW, strokeToken(input.theme, 'rule'))) + (inset ? INSET_MIN_LEG : MIN_LEG);
  if (armX < legFloor) {
    // The arm moves out to the minimum shaft; its label takes whichever side
    // of it is free (pushCagrPlacement offers both).
    const candidate = Math.min(legFloor, plotRight - 3);
    const candidateArm: Rect = { x: candidate - 3, y: spanY0, w: 6, h: Math.max(spanY1 - spanY0, 1) };
    const labelAt = (x: number): Rect => ({ x, y: (spanY0 + spanY1) / 2 - tsize.height / 2, w: tsize.width, h: tsize.height });
    const labelFree = (rect: Rect) => rect.x >= input.plot.x && rect.x + rect.w <= plotRight && !input.occupied.hits(rect, 2);
    if (
      candidate > armX &&
      candidate >= endpointFloor &&
      !input.occupied.hits(candidateArm, 2) &&
      (labelFree(labelAt(candidate + 4)) || labelFree(labelAt(candidate - 4 - tsize.width)))
    ) {
      armX = candidate;
    }
    if (armX < legFloor) pass.addLegDeficit(legFloor - armX);
  }

  const pathId = nid('arm');
  const headId = nid('arrowHead');
  const legEndX = toX + endGap + arrowShaftEnd(ARM_ARROW, strokeToken(input.theme, 'rule'));
  const d = `M${fromX + startGap} ${a.y}L${armX} ${a.y}L${armX} ${b.y}L${legEndX} ${b.y}`;
  nodes.push({
    t: 'path', id: pathId, d, stroke: { token: 'ink' }, width: strokeToken(input.theme, 'rule'),
    owner: { annotationId: annId }, part: 'arm',
  });
  nodes.push({
    t: 'path',
    id: headId,
    d: arrowHeadPath({ x: toX + endGap, y: b.y }, Math.PI, ARM_ARROW),
    fill: { token: 'ink' },
    owner: { annotationId: annId },
    part: 'arrowHead',
  });
  claimSegment(input.occupied, annId, fromX + startGap, a.y, armX, a.y, 'leg');
  claimSegment(input.occupied, annId, armX, a.y, armX, b.y, 'arm');
  claimSegment(input.occupied, annId, armX, b.y, legEndX, b.y, 'leg');
  claimArrowHead(input.occupied, annId, toX + endGap, b.y);

  const midY = (spanY0 + spanY1) / 2;
  if (inset) {
    pushInsetCagrPlacement(pass, annId, text, computed, font, armX, midY, parts, [pathId, headId], derivation, [spanY0, spanY1]);
    return;
  }
  pushCagrPlacement(pass, annId, text, computed, font, [
    { slot: 'rightArm', rect: { x: armX + 4, y: midY - tsize.height / 2, w: tsize.width, h: tsize.height }, penalty: 0 },
    { slot: 'leftArm', rect: { x: armX - 4 - tsize.width, y: midY - tsize.height / 2, w: tsize.width, h: tsize.height }, penalty: 1 },
  ], [pathId, headId], derivation);
}

function drawVerticalLevelDiff(
  pass: ArmDrawPass,
  a: AnchorResolution,
  b: AnchorResolution,
  text: string,
  annId: Id,
  computed: string,
  derivation?: AnnotationDerivation,
): void {
  const { input, nodes, labelRequests, placed, nid } = pass;
  const y0 = a.y;
  const y1 = b.y;
  const gap = Math.max(14, input.plot.w * 0.05);
  const candidatesX = [
    (a.x + b.x) / 2,
    Math.max(a.x, b.x) + gap,
    Math.min(a.x, b.x) - gap,
    input.plot.x + input.plot.w - 8,
  ];
  const stripFree = (sx: number) =>
    input.occupied.hitsWhich(
      { x: sx - 3, y: Math.min(y0, y1), w: 6, h: Math.max(Math.abs(y1 - y0), 1) }, 2,
    ).every((claim) => [a, b].some((anchor) =>
      anchor.lineAnchored && Math.abs(sx - anchor.x) < 0.5 &&
      claim.kind === 'mark' && !claim.polygon && claim.owner.seriesId === anchor.owner.seriesId &&
      anchor.x >= claim.rect.x - 2 && anchor.x <= claim.rect.x + claim.rect.w + 2 &&
      anchor.y >= claim.rect.y - 2 && anchor.y <= claim.rect.y + claim.rect.h + 2,
    ));
  const x = candidatesX.find(stripFree) ?? (a.x + b.x) / 2;
  const lineId = nid('diffLine');
  pushGuide(pass, 'leader0', annId, { x: a.x, y: y0 }, { x, y: y0 });
  pushGuide(pass, 'leader1', annId, { x: b.x, y: y1 }, { x, y: y1 });
  const headTipY = y1 + (y1 > y0 ? -1 : 1);
  const shaftEndY = headTipY + (y1 > y0 ? -1 : 1) * -arrowShaftEnd(ARM_ARROW, strokeToken(input.theme, 'rule'));
  nodes.push({
    t: 'line', id: lineId, x1: x, y1: y0, x2: x, y2: shaftEndY,
    stroke: { token: 'ink' }, width: strokeToken(input.theme, 'rule'), owner: { annotationId: annId }, part: 'diffArrow',
  });
  const headId = nid('arrowHead');
  const angle = y1 > y0 ? Math.PI / 2 : -Math.PI / 2;
  nodes.push({
    t: 'path',
    id: headId,
    d: arrowHeadPath({ x, y: headTipY }, angle, ARM_ARROW),
    fill: { token: 'ink' },
    owner: { annotationId: annId },
    part: 'arrowHead',
  });
  input.occupied.claim(
    { x: x - 2, y: Math.min(y0, y1), w: 4, h: Math.abs(y1 - y0) },
    'annotation',
    { annotationId: annId },
  );

  const { font, tsize } = measureArmLabel(input, text);
  const midY = (y0 + y1) / 2;
  labelRequests.push({
    id: `annotation:${annId}`,
    kind: 'annotation',
    role: computedTextRole(text, computed),
    owner: { annotationId: annId },
    text,
    lines: [text],
    typeRole: 'label', font,
    priority: pass.priority ?? PRIORITY.valueLine,
    candidates: [
      { slot: 'right', rect: { x: x + 6, y: midY - tsize.height / 2, w: tsize.width, h: tsize.height }, penalty: 0, needsBacking: true },
      { slot: 'left', rect: { x: x - 6 - tsize.width, y: midY - tsize.height / 2, w: tsize.width, h: tsize.height }, penalty: 1, needsBacking: true },
      { slot: 'above', rect: { x: x - tsize.width / 2, y: Math.min(y0, y1) - tsize.height - 4, w: tsize.width, h: tsize.height }, penalty: 2 },
      { slot: 'aboveLeft', rect: { x: x - 6 - tsize.width, y: Math.min(y0, y1) - tsize.height - 4, w: tsize.width, h: tsize.height }, penalty: 3 },
      { slot: 'belowRight', rect: { x: x + 6, y: Math.max(y0, y1) + 4, w: tsize.width, h: tsize.height }, penalty: 4 },
    ],
  });
  placed.push({
    id: annId, kind: 'diff', computedText: computed,
    tone: computed.startsWith('−') || computed.startsWith('-') ? 'bad' : 'neutral',
    nodeIds: [lineId, headId], labelId: `annotation:${annId}`,
    ...(derivation ? { derivation } : {}),
  });
}

/**
 * The stretches of an axis-aligned level guide from p to q that
 * cross no placed label (a series name at a line's end). Stubs under 4 px go.
 */
function guideRuns(occupied: OccupiedIndex, p: Point, q: Point): [Point, Point][] {
  const horizontal = Math.abs(q.y - p.y) < Math.abs(q.x - p.x);
  const at = horizontal ? p.y : p.x;
  const [lo, hi] = horizontal ? [Math.min(p.x, q.x), Math.max(p.x, q.x)] : [Math.min(p.y, q.y), Math.max(p.y, q.y)];
  const cuts = occupied.snapshot()
    .filter(({ kind, rect }) => kind === 'label' && (horizontal
      ? at >= rect.y - 1 && at <= rect.y + rect.h + 1
      : at >= rect.x - 1 && at <= rect.x + rect.w + 1))
    .map(({ rect }) => (horizontal ? [rect.x - 2, rect.x + rect.w + 2] : [rect.y - 2, rect.y + rect.h + 2]) as [number, number])
    .filter(([c0, c1]) => c1 > lo && c0 < hi)
    .sort((u, v) => u[0] - v[0]);
  const runs: [number, number][] = [];
  let from = lo;
  for (const [c0, c1] of cuts) {
    if (c0 > from) runs.push([from, c0]);
    from = Math.max(from, c1);
  }
  if (from < hi) runs.push([from, hi]);
  // Each stretch runs from p toward q, in the direction of the guide line.
  const forward = (horizontal ? p.x : p.y) <= (horizontal ? q.x : q.y);
  const kept = runs.filter(([u, v]) => v - u >= 4).map(([u, v]) => (forward ? [u, v] : [v, u]));
  return (forward ? kept : kept.reverse())
    .map(([u, v]) => (horizontal ? [{ x: u!, y: at }, { x: v!, y: at }] : [{ x: at, y: u! }, { x: at, y: v! }]));
}

/** A dashed level guide, drawn only where it crosses no label. */
function pushGuide(pass: ArmDrawPass, key: string, annId: Id, p: Point, q: Point): void {
  for (const [from, to] of guideRuns(pass.input.occupied, p, q)) {
    pass.nodes.push({
      t: 'line', id: pass.nid(key), x1: from.x, y1: from.y, x2: to.x, y2: to.y,
      stroke: { token: 'leader' }, width: strokeToken(pass.input.theme, 'rule'), dash: dashToken(pass.input.theme, 'dotted'), lineCap: 'round' as const, owner: { annotationId: annId }, part: 'leader',
    });
  }
}

/** Joint solves place chart labels after arm planning. Trim their guides after placement too. */
export function trimAnnotationGuides(nodes: SceneNode[], occupied: OccupiedIndex): void {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]!;
    if (node.t !== 'line' || node.part !== 'leader' || !node.dash || !node.owner.annotationId) continue;
    const runs = guideRuns(occupied, { x: node.x1, y: node.y1 }, { x: node.x2, y: node.y2 });
    const pieces = runs.map(([a, b], n) => ({ ...node, id: n === 0 ? node.id : `${node.id}:${n}`, x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
    const after = nodes.splice(i + 1);
    nodes.length = i;
    pushAll(nodes, pieces);
    pushAll(nodes, after);
  }
}

export function drawHorizontalLevelDiff(
  pass: ArmDrawPass,
  a: AnchorResolution,
  b: AnchorResolution,
  text: string,
  annId: Id,
  computed: string,
  derivation?: AnnotationDerivation,
): void {
  const { input, nodes, labelRequests, placed, nid } = pass;
  const x0 = a.x;
  const x1 = b.x;
  const gap = Math.max(14, input.plot.h * 0.05);
  const candidatesY = pass.diffHeights ?? [
    (a.y + b.y) / 2,
    Math.max(a.y, b.y) + gap,
    Math.min(a.y, b.y) - gap,
    input.plot.y + 8,
  ];
  // A value line spans every row. Crossing it is unavoidable, but the
  // anchored dots and their connector still block the comparison arm.
  const stripFree = (sy: number) =>
    input.occupied.hitsWhich(
      { x: Math.min(x0, x1), y: sy - 3, w: Math.max(Math.abs(x1 - x0), 1), h: 6 }, 2,
    ).every((claim) => claim.part === 'referenceLine');
  const y = candidatesY.find(stripFree) ?? (a.y + b.y) / 2;
  const lineId = nid('diffLine');
  pushGuide(pass, 'leader0', annId, { x: x0, y: a.y }, { x: x0, y });
  pushGuide(pass, 'leader1', annId, { x: x1, y: b.y }, { x: x1, y });
  const headTipX = x1 + (x1 > x0 ? -1 : 1);
  const shaftEndX = headTipX + (x1 > x0 ? -1 : 1) * -arrowShaftEnd(ARM_ARROW, strokeToken(input.theme, 'rule'));
  nodes.push({
    t: 'line', id: lineId, x1: x0, y1: y, x2: shaftEndX, y2: y,
    stroke: { token: 'ink' }, width: strokeToken(input.theme, 'rule'), owner: { annotationId: annId }, part: 'diffArrow',
  });
  const headId = nid('arrowHead');
  const angle = x1 > x0 ? 0 : Math.PI;
  nodes.push({
    t: 'path',
    id: headId,
    d: arrowHeadPath({ x: headTipX, y }, angle, ARM_ARROW),
    fill: { token: 'ink' },
    owner: { annotationId: annId },
    part: 'arrowHead',
  });
  input.occupied.claim(
    { x: Math.min(x0, x1), y: y - 2, w: Math.abs(x1 - x0), h: 4 },
    'annotation',
    { annotationId: annId },
  );

  const { font, tsize } = measureArmLabel(input, text);
  const midX = (x0 + x1) / 2;
  labelRequests.push({
    id: `annotation:${annId}`,
    kind: 'annotation',
    role: computedTextRole(text, computed),
    owner: { annotationId: annId },
    text,
    lines: [text],
    typeRole: 'label', font,
    priority: pass.priority ?? PRIORITY.valueLine,
    candidates: [
      { slot: 'above', rect: { x: midX - tsize.width / 2, y: y - tsize.height - 6, w: tsize.width, h: tsize.height }, penalty: 0, needsBacking: true },
      { slot: 'below', rect: { x: midX - tsize.width / 2, y: y + 6, w: tsize.width, h: tsize.height }, penalty: 1, needsBacking: true },
      { slot: 'right', rect: { x: Math.max(x0, x1) + 6, y: y - tsize.height / 2, w: tsize.width, h: tsize.height }, penalty: 2 },
    ],
  });
  placed.push({
    id: annId, kind: 'diff', computedText: computed,
    tone: computed.startsWith('−') || computed.startsWith('-') ? 'bad' : 'neutral',
    nodeIds: [lineId, headId], labelId: `annotation:${annId}`,
    ...(derivation ? { derivation } : {}),
  });
}

/** The bar a bar anchor stands on: its own series' mark in its category. */
function anchorBar(occupied: OccupiedIndex, anchor: AnchorResolution): Rect | undefined {
  return occupied.snapshot().find(({ kind, owner, part, rect }) => kind === 'mark' && part === 'bar' &&
    owner.categoryId === anchor.owner.categoryId && owner.seriesId === anchor.owner.seriesId &&
    anchor.y >= rect.y - 0.5 && anchor.y <= rect.y + rect.h + 0.5)?.rect;
}

/**
 * Bar inset: the gap between two positive bars of one category. A dotted drop
 * runs from the longer bar's end into the shorter bar's row, and an arrow
 * runs left from there to the shorter bar's end, its "gap +103" label on a
 * white plate on the arrow. Returns false when the bars do not allow it (a
 * negative value, a bar between the two), and the generic arrow draws.
 */
function drawInsetBarGap(
  pass: ArmDrawPass,
  a: AnchorResolution,
  b: AnchorResolution,
  text: string,
  annId: Id,
  computed: string,
  parts: ComparisonParts,
  derivation?: AnnotationDerivation,
): boolean {
  const { input, nodes, labelRequests, placed, nid } = pass;
  if (a.value < 0 || b.value < 0 || Math.abs(a.x - b.x) < 1) return false;
  const [short, long] = a.x < b.x ? [a, b] : [b, a];
  const longBar = anchorBar(input.occupied, long);
  const shortBar = anchorBar(input.occupied, short);
  if (!longBar || !shortBar) return false;
  const y = short.y;
  const dropFrom = long.y < y ? longBar.y + longBar.h : longBar.y;
  // A mark of a third series between the two rows would be crossed by the drop.
  const dropStrip: Rect = { x: long.x - 1, y: Math.min(dropFrom, y) + 1, w: 2, h: Math.max(Math.abs(y - dropFrom) - 2, 0) };
  if (dropStrip.h > 0 && input.occupied.hitsWhich(dropStrip, 0).some((claim) => claim.kind === 'mark' && claim.owner.seriesId !== short.owner.seriesId)) return false;
  const rule = strokeToken(input.theme, 'rule');
  const tipX = short.x + INSET_TIP_GAP;
  const regular: FontSpec = { family: input.theme.type.family, ...input.theme.type.label };
  const font: FontSpec = { ...regular, weight: emphasisWeight(input.theme) };
  const runs = [{ text: `${parts.lead}\u00A0` }, { text: parts.value, weight: font.weight }];
  const w = input.measure(`${parts.lead}\u00A0`, regular).width + input.measure(parts.value, font).width;
  const h = input.measure(text, font).height;
  // The label needs the arrow's middle and some shaft on both sides.
  if (long.x - tipX < w + 4 * ARM_ARROW) return false;
  pushGuide(pass, 'leader0', annId, { x: long.x, y: dropFrom }, { x: long.x, y });
  const lineId = nid('diffLine');
  nodes.push({
    t: 'line', id: lineId, x1: long.x, y1: y, x2: tipX + arrowShaftEnd(ARM_ARROW, rule), y2: y,
    stroke: { token: 'ink' }, width: rule, owner: { annotationId: annId }, part: 'diffArrow',
  });
  const headId = nid('arrowHead');
  nodes.push({
    t: 'path', id: headId, d: arrowHeadPath({ x: tipX, y }, Math.PI, ARM_ARROW),
    fill: { token: 'ink' }, owner: { annotationId: annId }, part: 'arrowHead',
  });
  const midX = (tipX + long.x) / 2;
  const seat: Rect = { x: midX - w / 2, y: y - h / 2, w, h };
  // The arrow claims its run either side of the label's seat, so the label can sit on it.
  input.occupied.claim({ x: tipX, y: y - 2, w: Math.max(seat.x - 2 - tipX, 0), h: 4 }, 'annotation', { annotationId: annId });
  input.occupied.claim({ x: seat.x + seat.w + 2, y: y - 2, w: Math.max(long.x - seat.x - seat.w - 2, 0), h: 4 }, 'annotation', { annotationId: annId });
  claimArrowHead(input.occupied, annId, tipX, y);
  labelRequests.push({
    id: `annotation:${annId}`,
    kind: 'annotation',
    role: computedTextRole(text, computed),
    owner: { annotationId: annId },
    text,
    lines: [text],
    runs,
    typeRole: 'label', font: regular,
    priority: pass.priority ?? PRIORITY.valueLine,
    candidates: [
      { slot: 'onArrow', rect: seat, penalty: 0, needsBacking: true, contrast: 'box' },
      { slot: 'above', rect: { ...seat, y: y - h - 6 }, penalty: 1, needsBacking: true },
      { slot: 'below', rect: { ...seat, y: y + 6 }, penalty: 2, needsBacking: true },
    ],
  });
  placed.push({
    id: annId, kind: 'diff', computedText: computed,
    tone: parts.value.startsWith('−') || parts.value.startsWith('-') ? 'bad' : 'neutral',
    nodeIds: [lineId, headId], labelId: `annotation:${annId}`,
    ...(derivation ? { derivation } : {}),
  });
  return true;
}

export function drawCagrArm(
  pass: ArmDrawPass,
  a: AnchorResolution,
  b: AnchorResolution,
  text: string,
  annId: Id,
  computed: string,
  derivation?: AnnotationDerivation,
  parts?: ComparisonParts,
): void {
  if (pass.input.comparisonLayout) {
    pass.input.comparisonLayout.draw(pass, a, b, text, annId, 'cagr', computed, derivation);
    return;
  }
  if (pass.input.valueAxis === 'horizontal') {
    drawShiftedCagrArm(pass, a, b, text, annId, computed, derivation, parts);
    return;
  }
  drawLiftedCagrArm(pass, a, b, text, annId, computed, derivation);
}

export function drawDiffArm(
  pass: ArmDrawPass,
  a: AnchorResolution,
  b: AnchorResolution,
  text: string,
  annId: Id,
  computed: string,
  derivation?: AnnotationDerivation,
  parts?: ComparisonParts,
): void {
  if (pass.input.comparisonLayout) {
    pass.input.comparisonLayout.draw(pass, a, b, text, annId, 'diff', computed, derivation);
    return;
  }
  if (pass.input.valueAxis === 'horizontal') {
    if (parts && drawInsetBarGap(pass, a, b, text, annId, computed, parts, derivation)) return;
    drawHorizontalLevelDiff(pass, a, b, text, annId, computed, derivation);
    return;
  }
  drawVerticalLevelDiff(pass, a, b, text, annId, computed, derivation);
}
