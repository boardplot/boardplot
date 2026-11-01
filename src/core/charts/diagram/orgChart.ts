import type { Point, Rect } from '../../geometry';
import type { FontSpec, TextMeasurer } from '../../text';
import type { DiagramNode, DiagramOptions } from '../../types/diagram';
import type { OwnerRef } from '../../types/cell';
import type { LintWarning, Paint } from '../../types/scene';
import type { NormalizedDiagram } from './model';
import type { PresetLayout } from './presets';
import { compareDiagramIds } from './ids';
import { gapSpread, qRect } from './primitives';
import { maxOf, minOf } from '../../arrays';

/**
 * The compact org chart: a root, its divisions and their
 * teams, three levels at most. Every level has one width and one height, an
 * icon sits inline at the left of its label, and the connectors snap to half
 * pixels. Three forms by width: leaves side by side under their division
 * ('tree'), leaves stacked under a spine inside the division ('stacked'), and
 * an indented one-column outline ('outline'). A hierarchy this does not cover
 * (deeper trees, groups, authored geometry, captions, badges, edge labels or
 * arrows) keeps the general hierarchy layout.
 */
type OrgChartMode = 'tree' | 'stacked' | 'outline' | 'columns' | 'rows';

export interface OrgChartLayout {
  mode: OrgChartMode;
  preset: PresetLayout;
  /** Each edge's polyline, every axis-parallel segment on a .5 coordinate. */
  routes: Map<string, FixedRoute>;
  fonts: Map<string, FontSpec>;
  /** Where the label starts and the band it is centred in vertically. */
  labelBoxes: Map<string, Rect>;
  icons: Map<string, Rect>;
  /** Labels centred in their box (issue tree) instead of starting at its left edge. */
  centred?: boolean;
  /** A ring for these nodes only; every other node draws without one. */
  rings?: Map<string, { stroke: Paint; width: number }>;
  /** Fills that replace the role fill (journey cards). */
  fills?: Map<string, Paint>;
  /** Draw a pain point as a plain card: no dashed outline, no accent stripe. */
  plainShape?: boolean;
  /** The number disc of each step (linear process), drawn in `badgePaint`. */
  badges?: Map<string, Rect>;
  badgePaint?: Paint;
  /** A shape outline that replaces the one the node's shape draws from its box. */
  paths?: Map<string, string>;
  /** Where each caption sits, already wrapped. */
  captionBoxes?: Map<string, { rect: Rect; lines: string[] }>;
  /** The ink of these labels, by label id, after the solver chose one. */
  labelInks?: Map<string, Paint>;
  /** A name's seat outside its node, already wrapped (roadmap: right of the dot). */
  seats?: Map<string, { rect: Rect; lines: string[] }>;
  /** Phase header fills that replace the palette's lane fill. */
  laneFills?: Map<string, Paint>;
  /** Drawn shapes that reach past their node box (a chevron's point): they count toward the content height. */
  extent?: Rect[];
  /** The plain edge paint, where the layout names one. */
  edgePaint?: Paint;
  /** The type of a node's secondary text, where it differs from the name. */
  secondaryFont?: FontSpec;
  /** Group frames in the layout's own paint. A dashed group has its title on the frame. */
  groupPaint?: { fill: Paint; stroke: Paint; dashed: ReadonlySet<string> };
  /** Lints of the layout itself. */
  warnings?: LintWarning[];
  /** Labels with a seat of their own that no single edge owns. */
  channelLabels?: Array<{ id: string; text: string; rect: Rect; owner: OwnerRef }>;
}

export interface FixedRoute {
  points: Point[];
  sourceSide?: 'top' | 'bottom' | 'left' | 'right';
  targetSide: 'top' | 'bottom' | 'left' | 'right';
  /** The seat of the edge label, chosen with the route. */
  labelBox?: Rect;
}

/** A 1 px stroke on a half-pixel coordinate draws crisp. */
export const snap = (value: number): number => Math.round(value - 0.5) + 0.5;
const snapUp = (value: number): number => Math.ceil(value) + 0.5;

export function orgChartEligible(data: NormalizedDiagram, options: DiagramOptions): boolean {
  return options.variant === 'hierarchy' && plainTree(data, true, 2);
}

/** A tree of plain nodes and plain edges, one parent each, at most `maxDepth` levels below the root. */
export function plainTree(data: NormalizedDiagram, icons: boolean, maxDepth: number): boolean {
  if (data.groups.length > 0 || data.lanes.length > 0) return false;
  if (data.nodes.length < 2 || data.edges.length !== data.nodes.length - 1) return false;
  const plainNode = (node: DiagramNode) => !node.position && !node.ports?.length && !node.size && !node.minSize
    && !node.caption && !node.badge && !node.secondaryLabel && !node.groupId && !node.laneId
    && (icons || !node.icon) && !node.label.includes('\n') && (node.shape.kind === 'roundedRect' || node.shape.kind === 'rectangle');
  if (!data.nodes.every(plainNode)) return false;
  if (!data.edges.every((edge) => !edge.dash && !edge.label && !edge.waypoints?.length && !edge.arrowStart && !edge.arrowEnd
    && !edge.source.portId && !edge.target.portId && (edge.routing === undefined || edge.routing === 'orthogonal'))) return false;
  const incoming = new Map<string, number>(data.nodes.map((node) => [node.id, 0]));
  for (const edge of data.edges) {
    if (!incoming.has(edge.source.nodeId) || !incoming.has(edge.target.nodeId)) return false;
    incoming.set(edge.target.nodeId, incoming.get(edge.target.nodeId)! + 1);
  }
  const roots = [...incoming].filter(([, count]) => count === 0);
  if (roots.length !== 1 || [...incoming.values()].some((count) => count > 1)) return false;
  const depth = levelsOf(data);
  return depth !== undefined && depth.size === data.nodes.length && maxOf(depth.values()) <= maxDepth;
}

export function levelsOf(data: NormalizedDiagram): Map<string, number> | undefined {
  const targets = new Set(data.edges.map((edge) => edge.target.nodeId));
  const root = data.nodes.find((node) => !targets.has(node.id));
  if (!root) return undefined;
  const levels = new Map([[root.id, 0]]);
  const queue = [root.id];
  while (queue.length) {
    const id = queue.shift()!;
    for (const edge of data.edges) {
      if (edge.source.nodeId !== id || levels.has(edge.target.nodeId)) continue;
      levels.set(edge.target.nodeId, levels.get(id)! + 1);
      queue.push(edge.target.nodeId);
    }
  }
  return levels;
}

export const byOrder = (a: DiagramNode, b: DiagramNode): number =>
  a.order === undefined || b.order === undefined ? 0 : a.order - b.order || compareDiagramIds(a.id, b.id);

export function layoutOrgChart(
  data: NormalizedDiagram,
  plot: Rect,
  labelFont: FontSpec,
  measure: TextMeasurer,
  u: number,
  fixedHeight = false,
): OrgChartLayout | undefined {
  const levels = levelsOf(data)!;
  const root = data.nodes.find((node) => levels.get(node.id) === 0)!;
  const kidsOf = (id: string) => data.edges.filter((edge) => edge.source.nodeId === id)
    .map((edge) => data.nodes.find((node) => node.id === edge.target.nodeId)!).sort(byOrder);
  const branches = kidsOf(root.id);
  const leaves = new Map(branches.map((branch) => [branch.id, kidsOf(branch.id)]));
  // Leaves step one size down where the report target's 13 px floor leaves room.
  const leafFont: FontSpec = { ...labelFont, size: labelFont.size > 13 ? labelFont.size - 1 : labelFont.size };
  const fonts = new Map(data.nodes.map((node) => [node.id, levels.get(node.id) === 2 ? leafFont : labelFont]));
  const text = (node: DiagramNode) => measure(node.label, fonts.get(node.id)!).width;
  const icon = 4 * u;
  const iconLead = 6.8 * u;
  const padRight = u;
  const leafPad = (mode: OrgChartMode) => (mode === 'tree' ? 2 * u : 1.8 * u);
  const need = (node: DiagramNode, mode: OrgChartMode) => node.icon
    ? iconLead + text(node) + padRight
    : (levels.get(node.id) === 2 ? leafPad(mode) : 2 * u) + text(node) + padRight;
  const rootNeed = text(root) + 4 * u + (root.icon ? icon + u : 0);
  const maxNeed = (nodes: DiagramNode[], mode: OrgChartMode) => Math.max(0, maxOf(nodes.map((node) => need(node, mode))));
  const allLeaves = [...leaves.values()].flat();
  const wide = plot.w >= 160 * u;
  const lineFloor = (font: FontSpec) => font.size * (font.lineHeight ?? 1.2) + 2 * u;
  const heightsFor = (mode: OrgChartMode) => {
    const base = mode === 'tree' ? (wide ? [8.8, 8, 6.8] : [8, 7.6, 6.4]) : mode === 'stacked' ? [7.2, 6.8, 5.8] : [6.8, 6.8, 5.6];
    return [Math.max(base[0]! * u, lineFloor(labelFont)), Math.max(base[1]! * u, lineFloor(labelFont)), Math.max(base[2]! * u, lineFloor(leafFont))];
  };
  if (rootNeed > plot.w) return undefined;

  const rects = new Map<string, Rect>();
  const put = (id: string, rect: Rect) => { rects.set(id, qRect(rect)); };
  const routes: OrgChartLayout['routes'] = new Map();
  let mode: OrgChartMode | undefined;
  let height = 0;

  // Leaves side by side: the leaf row fills the plot, each division centred over its own leaves.
  {
    const gap = (wide ? 2.4 : 1.6) * u;
    const columnGap = (wide ? 10.8 : 6) * u;
    const slots = branches.map((branch) => Math.max(1, leaves.get(branch.id)!.length));
    const total = slots.reduce((sum, value) => sum + value, 0);
    const leafW = Math.min(28 * u, (plot.w - (branches.length - 1) * columnGap - slots.reduce((sum, value) => sum + (value - 1) * gap, 0)) / total);
    const columns = slots.map((count) => count * leafW + (count - 1) * gap);
    const narrowest = minOf(columns);
    const branchW = Math.min(narrowest, Math.max(maxNeed(branches, 'tree'), 0.65 * narrowest));
    if (leafW >= maxNeed(allLeaves, 'tree') && branchW >= maxNeed(branches, 'tree')) {
      mode = 'tree';
      const [h0, h1, h2] = heightsFor(mode);
      const natural = (wide ? [7.2, 5.2] : [7.2, 4.8]).map((value) => value * u);
      const bodies = h0! + h1! + (allLeaves.length > 0 ? h2! : 0);
      const spread = gapSpread(fixedHeight, plot.h, bodies + natural[0]! + (allLeaves.length > 0 ? natural[1]! : 0), natural[0]! + (allLeaves.length > 0 ? natural[1]! : 0));
      const [gap0, gap1] = natural.map((value) => value * spread);
      height = bodies + gap0! + (allLeaves.length > 0 ? gap1! : 0);
      const top = plot.y + Math.max(0, (plot.h - height) / 2);
      const rootW = Math.min(plot.w, Math.max(rootNeed, Math.min(1.29 * branchW, 0.36 * plot.w)));
      const span = columns.reduce((sum, value) => sum + value, 0) + (branches.length - 1) * columnGap;
      put(root.id, { x: plot.x + (plot.w - rootW) / 2, y: top, w: rootW, h: h0! });
      let left = plot.x + (plot.w - span) / 2;
      branches.forEach((branch, index) => {
        const column = columns[index]!;
        const branchY = top + h0! + gap0!;
        put(branch.id, { x: left + (column - branchW) / 2, y: branchY, w: branchW, h: h1! });
        const kids = leaves.get(branch.id)!;
        const rowW = kids.length * leafW + Math.max(0, kids.length - 1) * gap;
        kids.forEach((kid, kidIndex) => put(kid.id, {
          x: left + (column - rowW) / 2 + kidIndex * (leafW + gap), y: branchY + h1! + gap1!, w: leafW, h: h2!,
        }));
        left += column + columnGap;
      });
      const bus = (parent: Rect, child: Rect, id: string) => {
        const from = snap(parent.x + parent.w / 2);
        const to = snap(child.x + child.w / 2);
        const y = snap(parent.y + parent.h + (child.y - parent.y - parent.h) / 2);
        routes.set(id, { points: from === to
          ? [{ x: from, y: parent.y + parent.h }, { x: to, y: child.y }]
          : [{ x: from, y: parent.y + parent.h }, { x: from, y }, { x: to, y }, { x: to, y: child.y }], targetSide: 'top' });
      };
      for (const edge of data.edges) bus(rects.get(edge.source.nodeId)!, rects.get(edge.target.nodeId)!, edge.id);
    }
  }

  // Leaves stacked under a spine that starts inside the division.
  const spine = (parent: Rect, child: Rect, id: string) => {
    const x = snapUp(parent.x + 2 * u);
    const y = snap(child.y + child.h / 2);
    routes.set(id, { points: [{ x, y: parent.y + parent.h }, { x, y }, { x: child.x, y }], targetSide: 'left' });
  };
  if (!mode) {
    for (const columnGap of [Math.max(2 * u, 0.035 * plot.w), 2 * u]) {
      const column = (plot.w - (branches.length - 1) * columnGap) / branches.length;
      if (column < maxNeed(branches, 'stacked') || column - 3.6 * u < maxNeed(allLeaves, 'stacked')) continue;
      mode = 'stacked';
      const [h0, h1, h2] = heightsFor(mode);
      const first = 2.4 * u;
      const pitch = h2! + 1.4 * u;
      const deepest = Math.max(0, maxOf(branches.map((branch) => {
        const count = leaves.get(branch.id)!.length;
        return count === 0 ? 0 : first + count * pitch - 1.4 * u;
      })));
      const gap0 = 4.8 * u * gapSpread(fixedHeight, plot.h, h0! + 4.8 * u + h1! + deepest, 4.8 * u);
      height = h0! + gap0 + h1! + deepest;
      const top = plot.y + Math.max(0, (plot.h - height) / 2);
      const rootW = Math.min(plot.w, Math.max(rootNeed, Math.min(1.29 * column, 0.36 * plot.w)));
      put(root.id, { x: plot.x + (plot.w - rootW) / 2, y: top, w: rootW, h: h0! });
      branches.forEach((branch, index) => {
        const x = plot.x + index * (column + columnGap);
        put(branch.id, { x, y: top + h0! + gap0, w: column, h: h1! });
        const branchRect = rects.get(branch.id)!;
        leaves.get(branch.id)!.forEach((kid, kidIndex) => {
          const leaf = { x: x + 3.6 * u, y: branchRect.y + h1! + first + kidIndex * pitch, w: column - 3.6 * u, h: h2! };
          put(kid.id, leaf);
        });
      });
      for (const edge of data.edges) {
        const parent = rects.get(edge.source.nodeId)!;
        const child = rects.get(edge.target.nodeId)!;
        if (edge.source.nodeId !== root.id) { spine(parent, child, edge.id); continue; }
        const from = snap(parent.x + parent.w / 2);
        const to = snap(child.x + child.w / 2);
        const y = snap(parent.y + parent.h + gap0 / 2);
        routes.set(edge.id, { points: [{ x: from, y: parent.y + parent.h }, { x: from, y }, { x: to, y }, { x: to, y: child.y }], targetSide: 'top' });
      }
      break;
    }
  }

  // An indented one-column outline for the narrowest cards.
  if (!mode && plot.w - 4 * u >= maxNeed(branches, 'outline') && plot.w - 8 * u >= maxNeed(allLeaves, 'outline')) {
    mode = 'outline';
    const [h0, h1, h2] = heightsFor(mode);
    let y = 0;
    const placed: Array<[string, Rect]> = [[root.id, { x: plot.x, y, w: plot.w, h: h0! }]];
    y += h0! + 2 * u;
    branches.forEach((branch, index) => {
      placed.push([branch.id, { x: plot.x + 4 * u, y, w: plot.w - 4 * u, h: h1! }]);
      y += h1!;
      const kids = leaves.get(branch.id)!;
      kids.forEach((kid, kidIndex) => {
        y += kidIndex === 0 ? 1.6 * u : 1.2 * u;
        placed.push([kid.id, { x: plot.x + 8 * u, y, w: plot.w - 8 * u, h: h2! }]);
        y += h2!;
      });
      if (index < branches.length - 1) y += kids.length > 0 ? 2.8 * u : 2 * u;
    });
    height = y;
    const top = plot.y + Math.max(0, (plot.h - height) / 2);
    for (const [id, rect] of placed) put(id, { ...rect, y: rect.y + top });
    for (const edge of data.edges) spine(rects.get(edge.source.nodeId)!, rects.get(edge.target.nodeId)!, edge.id);
  }
  if (!mode) return undefined;

  const labelBoxes = new Map<string, Rect>();
  const icons = new Map<string, Rect>();
  for (const node of data.nodes) {
    const rect = rects.get(node.id)!;
    const width = text(node);
    let x: number;
    if (node.id === root.id) {
      const group = width + (node.icon ? icon + u : 0);
      x = rect.x + (rect.w - group) / 2 + (node.icon ? icon + u : 0);
    } else {
      x = rect.x + (node.icon ? iconLead : levels.get(node.id) === 2 ? leafPad(mode) : 2 * u);
    }
    if (node.icon) icons.set(node.id, { x: x - u - icon, y: rect.y + (rect.h - icon) / 2, w: icon, h: icon });
    labelBoxes.set(node.id, { x, y: rect.y, w: Math.max(width, rect.x + rect.w - padRight - x), h: rect.h });
  }
  const readingOrder = [0, 1, 2].flatMap((level) => data.nodes.filter((node) => levels.get(node.id) === level).sort(byOrder).map((node) => node.id));
  return {
    mode,
    routes,
    fonts,
    labelBoxes,
    icons,
    preset: {
      nodeRects: rects,
      readingOrder,
      edges: [...data.edges],
      syntheticEdgeIds: [],
      groups: [],
      lanes: [],
      decorationScene: [],
      decorationClaims: [],
      contentTopReserves: new Map(),
    },
  };
}
