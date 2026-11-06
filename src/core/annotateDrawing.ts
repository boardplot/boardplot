/**
 * The four drawing annotations: text, line, arrow and box. A point comes from
 * the data, never from pixels, so a drawing stays on its data at every size.
 * A stroke claims only its own ink, so a label inside a box stays free, and a
 * stretch that would cross a label placed earlier is cut around it: no line crosses text.
 */

import type { AnnotatePassInput } from './annotate';
import { isCategoryAlongY } from './annotateFields';
import { valueMapper } from './annotateTargets';
import { segmentSpanInRect, type Point, type Rect } from './geometry';
import type { OccupiedIndex } from './label/occupied';
import type { SlotCandidate } from './label/solver';
import { arrowHeadPath, arrowShaftEnd } from './svgPath';
import { dashToken, strokeToken } from './theme';
import type { Annotation, DrawingPoint } from './types/annotations';
import type { Id } from './types/cell';
import type { LintWarning, PlacedAnnotation, SceneNode } from './types/scene';
import type { Theme } from './types/theme';

/** Size of a drawn arrow's head. */
const DRAWING_ARROW_HEAD = 6;
/** Air between a drawn stroke and a label it is cut around. */
const CUT_CLEARANCE = 2;
/** Half the width of a stroke's claim. */
const CLAIM_HALF = 1;
/** A stretch shorter than this, left between two cuts, goes. */
const MIN_STRETCH = 4;
/** Distance of a text annotation's seats from its point. */
const TEXT_GAP = 8;

/** Arrow shafts by node id: the head, and the tip its shaft points to. */
export type DrawingCuts = Map<Id, { headId: Id; tip: Point }>;

type Resolved = Point | { error: string };

/** The point in the plot, or why there is none. A value never extends the axis. */
export function resolveDrawingPoint(input: AnnotatePassInput, point: DrawingPoint): Resolved {
  if (typeof point !== 'object' || point === null || !('value' in point)) {
    const found = input.resolve(point as never);
    return found ? { x: found.x, y: found.y } : { error: 'unresolvable anchor' };
  }
  const mapper = valueMapper(input);
  if (!mapper) return { error: `this chart has no value scale, so it has no place for value ${point.value}` };
  const mapped = mapper.scale(point.value);
  const plot = input.bandPlot ?? input.plot;
  const [low, high] = mapper.axis === 'y' ? [plot.y, plot.y + plot.h] : [plot.x, plot.x + plot.w];
  if (!Number.isFinite(mapped) || mapped < low - 0.5 || mapped > high + 0.5) return { error: `value ${point.value} lies outside the plot; a drawing does not extend the axis` };
  const category = categoryPosition(input, point.categoryId);
  if (category === undefined) return { error: 'unresolvable category' };
  return mapper.axis === 'y' ? { x: category, y: mapped } : { x: mapped, y: category };
}

/** A category's position along its axis: the middle of its band where the chart gives bands, else its anchor. */
function categoryPosition(input: AnnotatePassInput, categoryId: Id): number | undefined {
  const axis = valueMapper(input)!.axis;
  if (input.resolveCategoryBand) {
    const band = input.resolveCategoryBand(categoryId);
    if (!band) return undefined;
    return isCategoryAlongY(band) ? band.y + band.h / 2 : band.x + band.w / 2;
  }
  const found = input.resolve(categoryId);
  return found ? (axis === 'y' ? found.x : found.y) : undefined;
}

/** Why a line, arrow or box has nothing to draw, or undefined when it has. */
export function drawingFailure(kind: 'line' | 'arrow' | 'box', from: Resolved, to: Resolved): string | undefined {
  if ('error' in from) return `from: ${from.error}`;
  if ('error' in to) return `to: ${to.error}`;
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  if (kind === 'box' ? dx < 1 || dy < 1 : Math.hypot(dx, dy) < 1) return kind === 'box' ? 'from and to must differ in both directions to make a box' : 'from and to are one point';
  return undefined;
}

/** The seats of a text annotation, in order: on the point, above, below, right, left. */
export function textSeats(at: Point, size: { w: number; h: number }): SlotCandidate[] {
  const seat = (slot: string, x: number, y: number, penalty: number): SlotCandidate => ({ slot, rect: { x, y, w: size.w, h: size.h }, penalty });
  const { w, h } = size;
  return [
    seat('at', at.x - w / 2, at.y - h / 2, 0),
    seat('above', at.x - w / 2, at.y - h - TEXT_GAP, 1),
    seat('below', at.x - w / 2, at.y + TEXT_GAP, 2),
    seat('right', at.x + TEXT_GAP, at.y - h / 2, 3),
    seat('left', at.x - w - TEXT_GAP, at.y - h / 2, 4),
  ];
}

/** Claims one straight stroke: its thin box, or on a diagonal its bounding rect with the polygon of the stroke. */
function claimStroke(occupied: OccupiedIndex, a: Point, b: Point, id: Id): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const box: Rect = { x: Math.min(a.x, b.x) - CLAIM_HALF, y: Math.min(a.y, b.y) - CLAIM_HALF, w: Math.abs(dx) + 2 * CLAIM_HALF, h: Math.abs(dy) + 2 * CLAIM_HALF };
  if (Math.abs(dx) < 0.5 || Math.abs(dy) < 0.5) {
    occupied.claim(box, 'annotation', { annotationId: id }, 'drawing');
    return;
  }
  const length = Math.hypot(dx, dy);
  const nx = (-dy / length) * CLAIM_HALF;
  const ny = (dx / length) * CLAIM_HALF;
  occupied.claim(box, 'annotation', { annotationId: id }, 'drawing', [
    { x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny },
  ]);
}

/** Draws the nodes of a line, an arrow or a box and claims its strokes. Returns the node ids. */
export function drawDrawing(
  ann: Extract<Annotation, { kind: 'line' | 'arrow' | 'box' }>,
  id: Id,
  from: Point,
  to: Point,
  theme: Theme,
  occupied: OccupiedIndex,
  nodes: SceneNode[],
  nid: (part: string) => Id,
  cuts: DrawingCuts,
): Id[] {
  const width = strokeToken(theme, 'rule');
  const owner = { annotationId: id };
  const paint = { stroke: { token: 'ink' } as const, width, owner, part: 'drawing', ...(ann.dashed ? { dash: dashToken(theme, 'reference') } : {}) };
  const run = (a: Point, b: Point): Id => {
    const nodeId = nid('drawing');
    nodes.push({ t: 'line', id: nodeId, x1: a.x, y1: a.y, x2: b.x, y2: b.y, ...paint });
    return nodeId;
  };
  if (ann.kind === 'box') {
    const [left, right] = [Math.min(from.x, to.x), Math.max(from.x, to.x)];
    const [top, bottom] = [Math.min(from.y, to.y), Math.max(from.y, to.y)];
    // The two level edges reach over the corners, so the corners close.
    const cap = width / 2;
    const edges: [Point, Point][] = [
      [{ x: left - cap, y: top }, { x: right + cap, y: top }],
      [{ x: right, y: top }, { x: right, y: bottom }],
      [{ x: right + cap, y: bottom }, { x: left - cap, y: bottom }],
      [{ x: left, y: bottom }, { x: left, y: top }],
    ];
    return edges.map(([a, b]) => {
      claimStroke(occupied, a, b, id);
      return run(a, b);
    });
  }
  claimStroke(occupied, from, to, id);
  if (ann.kind === 'line') return [run(from, to)];
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  const shaft = Math.min(arrowShaftEnd(DRAWING_ARROW_HEAD, width), length);
  const shaftId = run(from, { x: to.x - ux * shaft, y: to.y - uy * shaft });
  const headId = nid('drawingHead');
  nodes.push({ t: 'path', id: headId, d: arrowHeadPath(to, Math.atan2(uy, ux), DRAWING_ARROW_HEAD), fill: { token: 'ink' }, owner, part: 'drawing' });
  cuts.set(shaftId, { headId, tip: to });
  return [shaftId, headId];
}

/** The stretches of the run from `a` to `b` that clear every label, in order. Undefined when no label is in the way. */
function stretchesClearOfText(occupied: OccupiedIndex, a: Point, b: Point): [Point, Point][] | undefined {
  const box = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
  const spans = occupied.hitsWhich(box, CUT_CLEARANCE)
    .filter((claim) => claim.kind === 'label')
    .flatMap((claim) => {
      const span = segmentSpanInRect(a, b, claim.rect, CUT_CLEARANCE);
      return span ? [span] : [];
    })
    .sort((u, v) => u[0] - v[0]);
  if (spans.length === 0) return undefined;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const at = (t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const stretches: [Point, Point][] = [];
  let from = 0;
  for (const [t0, t1] of spans) {
    if (t0 > from && (t0 - from) * length >= MIN_STRETCH) stretches.push([at(from), at(t0)]);
    from = Math.max(from, t1);
  }
  if (from < 1 && (1 - from) * length >= MIN_STRETCH) stretches.push([at(from), b]);
  return stretches;
}

/**
 * After the solve: each drawn run breaks around every label it crosses, with a
 * warning that names the annotation. The rest of the drawing stays. An arrow
 * whose tip lost its shaft, or lies on a label, loses its head too.
 */
export function cutDrawingsAroundText(nodes: SceneNode[], placed: PlacedAnnotation[], occupied: OccupiedIndex, warnings: LintWarning[], cuts: DrawingCuts): void {
  const warned = new Set<Id>();
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]!;
    if (node.t !== 'line' || node.part !== 'drawing') continue;
    const a = { x: node.x1, y: node.y1 };
    const b = { x: node.x2, y: node.y2 };
    const stretches = stretchesClearOfText(occupied, a, b);
    const arrow = cuts.get(node.id);
    const headOnText = arrow !== undefined && (stretchesClearOfText(occupied, b, arrow.tip) !== undefined);
    if (!stretches && !headOnText) continue;
    const id = node.owner.annotationId!;
    const record = placed.find((entry) => entry.id === id);
    const pieces = (stretches ?? [[a, b] as [Point, Point]]).map(([p, q], n) => ({ ...node, id: n === 0 ? node.id : `${node.id}:${n}`, x1: p.x, y1: p.y, x2: q.x, y2: q.y }));
    const after = nodes.splice(i + 1);
    nodes.length = i;
    nodes.push(...pieces, ...after);
    if (record) record.nodeIds = record.nodeIds.filter((nodeId) => nodeId !== node.id).concat(pieces.map((piece) => piece.id));
    const lastReachesEnd = stretches === undefined || stretches.at(-1)?.[1] === b;
    if (arrow && (headOnText || !lastReachesEnd)) {
      const headAt = nodes.findIndex((entry) => entry.id === arrow.headId);
      if (headAt >= 0) nodes.splice(headAt, 1);
      if (record) record.nodeIds = record.nodeIds.filter((nodeId) => nodeId !== arrow.headId);
    }
    if (!warned.has(id)) {
      warned.add(id);
      warnings.push({
        code: 'draw-crosses-text',
        severity: 'warn',
        message: `${record?.kind ?? 'drawing'} '${id}' would cross text, so it breaks around the label there`,
        owner: { annotationId: id },
        suggest: 'Move the drawing to other points, or move the label with labelOffsets.',
      });
    }
  }
}
