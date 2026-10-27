import type { Rect } from '../../geometry';
import type { FontSpec, TextMeasurer } from '../../text';
import type { DiagramNode, DiagramOptions } from '../../types/diagram';
import type { NormalizedDiagram } from './model';
import { byOrder, levelsOf, plainTree, snap, type FixedRoute, type OrgChartLayout } from './orgChart';
import { qRect } from './primitives';
import { maxOf } from '../../arrays';

/**
 * The compact issue tree: a question, its branches and their drivers down to
 * one leaf level, every leaf at the same depth. Wide canvases set the levels
 * as columns that span the plot with equal gutters; leaves of one parent sit
 * close, groups and branches stand apart. Narrow canvases indent the levels
 * under a trunk and bracket the leaves in a right-hand column. Other issue
 * trees keep the general layout.
 */
export function issueTreeEligible(data: NormalizedDiagram, options: DiagramOptions): boolean {
  if (options.variant !== 'issue-tree' || !plainTree(data, false, 4)) return false;
  const levels = levelsOf(data)!;
  const depth = maxOf(levels.values());
  const parents = new Set(data.edges.map((edge) => edge.source.nodeId));
  return depth >= 2 && data.nodes.every((node) => parents.has(node.id) || levels.get(node.id) === depth);
}

export function layoutIssueTreeCompact(
  data: NormalizedDiagram,
  plot: Rect,
  labelFont: FontSpec,
  measure: TextMeasurer,
  u: number,
  headWeight: number,
): OrgChartLayout | undefined {
  const levels = levelsOf(data)!;
  const depth = maxOf(levels.values());
  const root = data.nodes.find((node) => levels.get(node.id) === 0)!;
  const kidsOf = (id: string) => data.edges.filter((edge) => edge.source.nodeId === id)
    .map((edge) => data.nodes.find((node) => node.id === edge.target.nodeId)!).sort(byOrder);
  const parentOf = new Map(data.edges.map((edge) => [edge.target.nodeId, edge.source.nodeId]));
  // The question and its branches are set in the heading weight on their dark fills.
  const bold: FontSpec = { ...labelFont, weight: headWeight };
  const fonts = new Map(data.nodes.map((node) => [node.id, (levels.get(node.id) ?? 0) <= 1 ? bold : labelFont]));
  const text = (node: DiagramNode) => measure(node.label, fonts.get(node.id)!).width;
  const byLevel = (level: number) => data.nodes.filter((node) => levels.get(node.id) === level);
  const widest = (level: number) => maxOf(byLevel(level).map(text));
  const leavesInOrder: DiagramNode[] = [];
  const walk = (node: DiagramNode) => {
    const kids = kidsOf(node.id);
    if (kids.length === 0) leavesInOrder.push(node);
    kids.forEach(walk);
  };
  walk(root);
  const ancestors = (id: string) => {
    const out: string[] = [];
    for (let at = parentOf.get(id); at !== undefined; at = parentOf.get(at)) out.push(at);
    return out;
  };
  // The gap above a leaf grows with the distance to the leaf before it: 6 px
  // inside one parent, 16 px between groups, 30 px between branches.
  const leafGap = (previous: DiagramNode, next: DiagramNode) => {
    const before = ancestors(previous.id);
    const shared = ancestors(next.id).findIndex((id) => before.includes(id));
    return [1.2, 3.2, 6, 6][Math.max(0, shared)]! * u;
  };
  const wide = plot.w >= 160 * u;
  const rects = new Map<string, Rect>();
  const put = (id: string, rect: Rect) => { rects.set(id, qRect(rect)); };
  const routes = new Map<string, FixedRoute>();
  const lineFloor = labelFont.size * (labelFont.lineHeight ?? 1.2) + 2 * u;
  let mode: OrgChartLayout['mode'] | undefined;

  // Columns, left to right.
  {
    const pad = 2 * u;
    const need = Array.from({ length: depth + 1 }, (_, level) => widest(level) + 2 * pad);
    const sum = need.reduce((total, value) => total + value, 0);
    const gutter = Math.min(8.8 * u, (plot.w - sum) / depth);
    if (gutter >= 4.8 * u) {
      mode = 'columns';
      const scale = (plot.w - depth * gutter) / sum;
      const widths = need.map((value) => value * scale);
      const heights = Array.from({ length: depth + 1 }, (_, level) =>
        Math.max(lineFloor, (level === 0 ? (wide ? 7.6 : 6.8) : level === 1 ? (wide ? 6.8 : 6) : wide ? 6 : 5.6) * u));
      const xs = widths.map((_, level) => plot.x + widths.slice(0, level).reduce((total, value) => total + value, 0) + level * gutter);
      let y = 0;
      const centres = new Map<string, number>();
      leavesInOrder.forEach((leaf, index) => {
        if (index > 0) y += leafGap(leavesInOrder[index - 1]!, leaf);
        const h = heights[depth]!;
        centres.set(leaf.id, y + h / 2);
        y += h;
      });
      const height = y;
      const centreOf = (node: DiagramNode): number => {
        const known = centres.get(node.id);
        if (known !== undefined) return known;
        const kids = kidsOf(node.id).map(centreOf);
        const centre = (kids[0]! + kids.at(-1)!) / 2;
        centres.set(node.id, centre);
        return centre;
      };
      const top = plot.y + Math.max(0, (plot.h - height) / 2);
      for (const node of data.nodes) {
        const level = levels.get(node.id)!;
        const h = heights[level]!;
        put(node.id, { x: xs[level]!, y: top + centreOf(node) - h / 2, w: widths[level]!, h });
      }
      for (const edge of data.edges) {
        const parent = rects.get(edge.source.nodeId)!;
        const child = rects.get(edge.target.nodeId)!;
        const from = snap(parent.y + parent.h / 2);
        const to = snap(child.y + child.h / 2);
        const x = snap(parent.x + parent.w + gutter / 2);
        routes.set(edge.id, {
          points: from === to
            ? [{ x: parent.x + parent.w, y: from }, { x: child.x, y: to }]
            : [{ x: parent.x + parent.w, y: from }, { x, y: from }, { x, y: to }, { x: child.x, y: to }],
          sourceSide: 'right', targetSide: 'left',
        });
      }
    }
  }

  // An indented outline with the leaves bracketed on the right.
  if (!mode) {
    for (const [indent, bracket, pad] of [[4.8, 6, 2], [2.8, 2.8, 1.2], [2, 2, 1.2]] as const) {
      const indented = Math.max(...Array.from({ length: depth - 1 }, (_, index) => widest(index + 1))) + 2 * pad * u;
      const leafNeed = widest(depth) + 2 * pad * u;
      const spare = plot.w - (depth - 1) * indent * u - bracket * u - indented - leafNeed;
      if (widest(0) + 2 * pad * u > plot.w || spare < 0) continue;
      mode = 'outline';
      const nodeW = indented + spare / 2;
      const leafW = leafNeed + spare / 2;
      const leafX = plot.x + plot.w - leafW;
      const rootH = Math.max(lineFloor, 6.8 * u);
      const branchH = Math.max(lineFloor, 6 * u);
      const rowH = Math.max(lineFloor, 5.6 * u);
      const placed: Array<[string, Rect]> = [[root.id, { x: plot.x, y: 0, w: plot.w, h: rootH }]];
      let y = rootH + 3.2 * u;
      // Each node above the last two levels is a header row; a parent of
      // leaves is centred on its bracketed leaves.
      const place = (node: DiagramNode, isFirst: boolean) => {
        const level = levels.get(node.id)!;
        const x = plot.x + level * indent * u;
        const kids = kidsOf(node.id);
        if (level < depth - 1) {
          placed.push([node.id, { x, y, w: nodeW, h: branchH }]);
          y += branchH + 2 * u;
          kids.forEach((kid, index) => place(kid, index === 0));
          return;
        }
        if (!isFirst) y += 1.6 * u;
        const stack = kids.length * rowH + Math.max(0, kids.length - 1) * 1.2 * u;
        const groupH = Math.max(rowH, stack);
        placed.push([node.id, { x, y: y + (groupH - rowH) / 2, w: nodeW, h: rowH }]);
        kids.forEach((kid, index) => placed.push([kid.id, { x: leafX, y: y + (groupH - stack) / 2 + index * (rowH + 1.2 * u), w: leafW, h: rowH }]));
        y += groupH;
      };
      kidsOf(root.id).forEach((branch, index) => {
        if (index > 0) y += 3.2 * u;
        place(branch, true);
      });
      const top = plot.y + Math.max(0, (plot.h - y) / 2);
      for (const [id, rect] of placed) put(id, { ...rect, y: rect.y + top });
      for (const edge of data.edges) {
        const parent = rects.get(edge.source.nodeId)!;
        const child = rects.get(edge.target.nodeId)!;
        const childLevel = levels.get(edge.target.nodeId)!;
        const to = snap(child.y + child.h / 2);
        if (childLevel === depth) {
          // The bracket: out of the parent's right side, down the bracket, into the leaf.
          const from = snap(parent.y + parent.h / 2);
          const x = snap(parent.x + parent.w + (child.x - parent.x - parent.w) / 2);
          routes.set(edge.id, { points: from === to
            ? [{ x: parent.x + parent.w, y: from }, { x: child.x, y: to }]
            : [{ x: parent.x + parent.w, y: from }, { x, y: from }, { x, y: to }, { x: child.x, y: to }],
            sourceSide: 'right', targetSide: 'left' });
          continue;
        }
        const x = snap(parent.x + Math.min(indent * u, child.x - parent.x) / 2);
        routes.set(edge.id, { points: [{ x, y: parent.y + parent.h }, { x, y: to }, { x: child.x, y: to }], targetSide: 'left' });
      }
      break;
    }
  }
  if (!mode) return undefined;

  const labelBoxes = new Map<string, Rect>();
  for (const node of data.nodes) {
    const rect = rects.get(node.id)!;
    labelBoxes.set(node.id, { x: rect.x + u, y: rect.y, w: Math.max(1, rect.w - 2 * u), h: rect.h });
  }
  // Pale leaves take a hairline one step darker than their fill.
  const rings = new Map(data.nodes.filter((node) => levels.get(node.id) === depth && (node.role === 'muted' || node.role === undefined))
    .map((node) => [node.id, { stroke: { token: 'neutral' as const, tint: 0.7 }, width: 0.75 }]));
  return {
    mode,
    routes,
    fonts,
    labelBoxes,
    icons: new Map(),
    centred: true,
    rings,
    preset: {
      nodeRects: rects,
      readingOrder: Array.from({ length: depth + 1 }, (_, level) => byLevel(level).sort(byOrder).map((node) => node.id)).flat(),
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
