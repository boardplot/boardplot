import type { Point, Rect } from '../../geometry';
import { dashToken, seriesPaint, strokeToken } from '../../theme';
import type { Theme } from '../../types/theme';
import { wrapText, type FontSpec, type TextMeasurer } from '../../text';
import type { DiagramNode, DiagramOptions } from '../../types/diagram';
import type { Paint, SceneNode } from '../../types/scene';
import type { NormalizedDiagram } from './model';
import { byOrder, type OrgChartLayout } from './orgChart';
import { laneOwner, q, qRect, segmentBounds, type DiagramPalette } from './primitives';
import { diagramSceneId } from './ids';

/**
 * The compact roadmap: phase chevrons in one band across the top, dashed
 * dividers down the phases, and the milestones on a staircase. Every
 * milestone takes a row of its own, the rows rise in reading order, the
 * line climbs diagonally inside a phase and runs up and across to the next
 * one, and each name sits right of its dot inside its phase. Phases that
 * share their colour with their milestones ramp from light to dark in
 * order. A roadmap this does not cover (authored positions, captions,
 * edges, other node kinds or shapes) keeps the general layout.
 */
export function roadmapEligible(data: NormalizedDiagram, options: DiagramOptions): boolean {
  if (options.variant !== 'roadmap') return false;
  if (data.edges.length > 0 || data.groups.length > 0 || data.lanes.length === 0 || data.lanes.length > 8) return false;
  return data.nodes.every((node) => node.kind === 'milestone' && node.laneId && node.shape.kind === 'circle' && !node.position
    && !node.ports?.length && !node.size && !node.minSize && !node.caption && !node.badge && !node.secondaryLabel && !node.icon
    && !node.label.includes('\n'));
}

export function layoutRoadmapCompact(
  data: NormalizedDiagram,
  options: DiagramOptions,
  plot: Rect,
  labelFont: FontSpec,
  laneFont: FontSpec,
  measure: TextMeasurer,
  u: number,
  palette: DiagramPalette,
  theme: Theme,
): OrgChartLayout | undefined {
  const strokeWidth = strokeToken(theme, 'rule');
  const lanes = data.lanes;
  const members = new Map(lanes.map((lane) => [lane.id, data.nodes.filter((node) => node.laneId === lane.id).sort(byOrder)]));
  const milestones = lanes.flatMap((lane) => members.get(lane.id)!);
  const m = milestones.length;
  if (m === 0) return undefined;
  const lineH = labelFont.size * (labelFont.lineHeight ?? 1.2);
  const wide = plot.w >= 110 * u;
  // 6 px dots (5 px narrow), a 26 px band and an 8 px point, in step with the type.
  const r = q((wide ? 0.46 : 0.385) * labelFont.size);
  const bandH = q(2 * laneFont.size);
  const tip = q(0.6 * laneFont.size);
  const laneGap = 1;
  const laneW = (plot.w - (lanes.length - 1) * laneGap) / lanes.length;
  const textW = (lines: string[]) => Math.max(...lines.map((line) => measure(line, labelFont).width));

  // Phase colours ramp light to dark in order when the milestones share them.
  const ramp = options.palette === undefined && data.key.length === 0 && lanes.every((lane) =>
    lane.role === 'category' && data.nodes.some((node) => node.paletteKey !== undefined && node.paletteKey === lane.paletteKey));
  // The last phase takes the primary series colour and each earlier one the next series in
  // order (in the default theme: light, mid, then navy for the last). The choice is
  // by rank, not by the resolved colour, so a repaint in another theme keeps it.
  const rampPaint = (index: number): Paint => seriesPaint((index + 1) % lanes.length);
  const laneFill = new Map(lanes.map((lane, index) => [lane.id, ramp ? rampPaint(index) : palette.lane(lane.role, lane.paletteKey)]));

  // Dots inside a phase step right by dx; the step shrinks until every name fits its phase.
  const x0 = wide ? 4 * u : r + 3;
  // A name starts where the climb to the next dot has risen clear of it.
  const lead = (dx: number, pitch: number, height: number) => Math.max(r + u, (dx * (height / 2 + 3)) / pitch + 2.5);
  const pitchMin = lineH + 1.5 * u;
  const pitchMax = 7 * u;
  // Seats are chosen at the tightest pitch, where a name needs the most lead; any taller pitch keeps them clear.
  const pitch = pitchMin;
  type Placed = { node: DiagramNode; laneIndex: number; x: number; dx: number; lines: string[]; offset: number };
  const placed: Placed[] = [];
  for (const [laneIndex, lane] of lanes.entries()) {
    const nodes = members.get(lane.id)!;
    const left = plot.x + laneIndex * (laneW + laneGap);
    const right = left + laneW - (laneIndex === lanes.length - 1 ? 0 : 2);
    const seat = (k: number, dx: number, wrap: boolean) => {
      const x = left + x0 + k * dx;
      const room = right - x;
      const single = measure(nodes[k]!.label, labelFont).width;
      const offset = lead(dx, pitch, lineH);
      if (offset + single <= room) return { x, dx, lines: [nodes[k]!.label], offset };
      if (!wrap) return undefined;
      const wrapped = wrapText(nodes[k]!.label, labelFont, Math.max(1, room - lead(dx, pitch, 2 * lineH)), 2, measure);
      return wrapped.truncated ? undefined : { x, dx, lines: wrapped.lines, offset: lead(dx, pitch, wrapped.lines.length * lineH) };
    };
    let chosen: Array<{ x: number; dx: number; lines: string[]; offset: number }> | undefined;
    // One line for every name first; a name wraps only when no step lets them all fit.
    for (const wrap of [false, true]) for (let dx = Math.round(0.16 * laneW); dx >= 0 && !chosen; dx -= 2) {
      const seats = nodes.map((_, k) => seat(k, dx, wrap));
      if (seats.every((value) => value !== undefined)) chosen = seats as Array<{ x: number; dx: number; lines: string[]; offset: number }>;
    }
    if (!chosen) return undefined;
    chosen.forEach((value, k) => placed.push({ node: nodes[k]!, laneIndex, ...value }));
  }

  // Rows from the bottom up: the first milestone lowest, a two-line name taking the room it needs.
  // The pitch is 7u where the frame has room, down to one line and 1.5u.
  const heights = placed.map((item) => item.lines.length * lineH);
  const gapsAt = (p: number) => placed.slice(1).map((_, i) => Math.max(p, (heights[i]! + heights[i + 1]!) / 2 + 2));
  const above = (p: number) => Math.max(p, heights[m - 1]! / 2 + u);
  const below = Math.max(r, heights[0]! / 2) + 2 * u;
  const total = (p: number) => bandH + above(p) + gapsAt(p).reduce((sum, value) => sum + value, 0) + below;
  let rowPitch = pitchMax;
  while (rowPitch > pitchMin && total(rowPitch) > plot.h) rowPitch = Math.max(pitchMin, rowPitch - 0.5);
  const gaps = gapsAt(rowPitch);
  const bandTop = q(plot.y);
  const topRow = bandTop + bandH + above(rowPitch);
  const bottomRow = topRow + gaps.reduce((sum, value) => sum + value, 0);
  const ys: number[] = [bottomRow];
  gaps.forEach((gap) => ys.push(ys[ys.length - 1]! - gap));
  const partitionBottom = q(bottomRow + below);
  // Each name's lead against the climb to the next dot of its phase.
  placed.forEach((item, index) => {
    const next = placed[index + 1];
    item.offset = lead(item.dx, next && next.laneIndex === item.laneIndex ? gaps[index]! : Infinity, heights[index]!);
  });

  const rects = new Map<string, Rect>();
  const seats = new Map<string, { rect: Rect; lines: string[] }>();
  const fills = new Map<string, Paint>();
  const rings = new Map<string, { stroke: Paint; width: number }>();
  const points: Point[] = [];
  placed.forEach((item, index) => {
    const y = q(ys[index]!);
    const x = q(item.x);
    rects.set(item.node.id, { x: x - r, y: y - r, w: 2 * r, h: 2 * r });
    const h = heights[index]!;
    seats.set(item.node.id, { rect: qRect({ x: x + item.offset, y: y - h / 2, w: textW(item.lines), h }), lines: item.lines });
    const lane = lanes[item.laneIndex]!;
    if (ramp && item.node.role === 'category' && item.node.paletteKey === lane.paletteKey) fills.set(item.node.id, laneFill.get(lane.id)!);
    rings.set(item.node.id, { stroke: { token: 'axis' }, width: 0.75 });
    // A phase change climbs one row at the old phase's x, then runs across.
    if (index > 0 && placed[index - 1]!.laneIndex !== item.laneIndex) points.push({ x: points[points.length - 1]!.x, y });
    points.push({ x, y });
  });

  const result: OrgChartLayout['preset'] = {
    nodeRects: rects, readingOrder: milestones.map((node) => node.id),
    edges: [], syntheticEdgeIds: [], groups: [], lanes: [], decorationScene: [], decorationClaims: [], contentTopReserves: new Map(),
  };
  lanes.forEach((lane, index) => {
    const x = plot.x + index * (laneW + laneGap);
    const box = qRect({ x, y: bandTop, w: laneW, h: bandH });
    const d = `M${box.x} ${box.y}L${q(box.x + box.w - tip)} ${box.y}L${q(box.x + box.w)} ${q(box.y + box.h / 2)}L${q(box.x + box.w - tip)} ${q(box.y + box.h)}`
      + `L${box.x} ${q(box.y + box.h)}` + (index > 0 ? `L${q(box.x + tip)} ${q(box.y + box.h / 2)}` : '') + 'Z';
    result.decorationScene.push({ t: 'path', id: diagramSceneId('lane', lane.id, 'header'), d, fill: laneFill.get(lane.id)!, owner: laneOwner(lane.id), part: 'diagramLaneHeader' } as SceneNode);
    result.decorationClaims.push({ rect: box, owner: laneOwner(lane.id), part: 'diagramLaneHeader' });
    const label = qRect({ x: box.x + (index > 0 ? tip : 0), y: box.y, w: box.w - tip - (index > 0 ? tip : 0), h: box.h });
    result.lanes.push({ id: lane.id, bounds: qRect({ x, y: bandTop, w: laneW, h: partitionBottom - bandTop }), headerBox: label,
      memberNodeIds: members.get(lane.id)!.map((node) => node.id) });
    if (index > 0) {
      const from = { x: q(x - laneGap / 2) + 0.5, y: q(bandTop + bandH + u) };
      const to = { x: from.x, y: partitionBottom };
      result.decorationScene.push({ t: 'line', id: diagramSceneId('lane', lane.id, 'partition'), x1: from.x, y1: from.y, x2: to.x, y2: to.y,
        stroke: { token: 'grid' }, width: strokeWidth, dash: dashToken(theme, 'reference'), owner: laneOwner(lane.id), part: 'diagramLanePartition' } as SceneNode);
      result.decorationClaims.push({ rect: segmentBounds(from, to, 1), owner: laneOwner(lane.id), part: 'diagramLanePartition' });
    }
  });
  // The derived trajectory lists the milestones; the drawn line adds the corners between phases.
  result.trajectory = placed.map((item, index) => ({ x: q(item.x), y: q(ys[index]!) }));
  const d = points.length === 1
    ? `M${q(points[0]!.x - 2 * u)} ${points[0]!.y}L${q(points[0]!.x + 2 * u)} ${points[0]!.y}`
    : points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join('');
  result.decorationScene.push({ t: 'path', id: diagramSceneId('roadmap', 'trajectory'), d, stroke: { token: 'axis' }, width: strokeWidth,
    owner: {}, part: 'diagramTrajectory' } as SceneNode);
  // Claims in short pieces, so a name beside a diagonal is not read as crossing it.
  points.slice(1).forEach((to, index) => {
    const from = points[index]!;
    const pieces = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 3));
    for (let piece = 0; piece < pieces; piece++) {
      const a = { x: from.x + ((to.x - from.x) * piece) / pieces, y: from.y + ((to.y - from.y) * piece) / pieces };
      const b = { x: from.x + ((to.x - from.x) * (piece + 1)) / pieces, y: from.y + ((to.y - from.y) * (piece + 1)) / pieces };
      result.decorationClaims.push({ rect: segmentBounds(a, b, strokeWidth), owner: {}, part: 'diagramTrajectory' });
    }
  });
  const fonts = new Map(data.nodes.map((node) => [node.id, labelFont]));
  return { mode: 'columns', preset: result, routes: new Map(), fonts, labelBoxes: new Map([...rects].map(([id, rect]) => [id, { ...rect }])),
    icons: new Map(), rings, fills, plainShape: true, seats, laneFills: laneFill, extent: [{ x: plot.x, y: bandTop, w: plot.w, h: partitionBottom - bandTop }] };
}
