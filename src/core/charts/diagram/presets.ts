import type { Theme } from '../../types/theme';
import { boundsOf, clamp, inflate, rectsOverlap, type Point, type Rect, type Size } from '../../geometry';
import { monotonePath, monotoneSegments } from '../../curve';
import { resolveSize } from '../../normalize/shared';
import { wrapNameText, wrapText, type FontSpec, type TextMeasurer } from '../../text';
import { strokeToken, dashToken, panelTypeClass, resolveTheme, themeForWidth } from '../../theme';
import type {
  DiagramEdge,
  DiagramNode,
  DiagramOptions,
} from '../../types/diagram';
import type { SceneNode } from '../../types/scene';
import type { NormalizedDiagram } from './model';
import {
  chevronPath,
  laneOwner,
  nodeOwner,
  q,
  qPoint,
  qRect,
  segmentBounds,
  type DiagramPalette,
} from './primitives';
import { automaticEdgeId, compareDiagramIds, diagramSceneId } from './ids';
import { maxOf, minOf } from '../../arrays';

export interface PresetLayout {
  nodeRects: Map<string, Rect>;
  readingOrder: string[];
  edges: DiagramEdge[];
  syntheticEdgeIds: string[];
  groups: Array<{ id: string; bounds: Rect; titleBox: Rect; memberNodeIds: string[] }>;
  lanes: Array<{ id: string; bounds: Rect; headerBox?: Rect; memberNodeIds: string[] }>;
  decorationScene: SceneNode[];
  decorationClaims: Array<{ rect: Rect; owner: ReturnType<typeof laneOwner>; part: string }>;
  contentTopReserves: Map<string, number>;
  trajectory?: Point[];
  minimumRequiredSize?: Size;
  compressed?: boolean;
}

interface PresetContext {
  data: NormalizedDiagram;
  options: DiagramOptions;
  plot: Rect;
  sizes: Map<string, Size>;
  lineHeight: number;
  u: number;
  palette: DiagramPalette;
  /** The layout's measurer, injected or default; see layoutDiagram. */
  measure: TextMeasurer;
  /** The node label font, which a secondary line inside a node is set in. */
  font: FontSpec;
  /** The font of a group title. */
  titleFont: FontSpec;
  /** The font of a structural heading (strategy house roof, pillar heads, foundation). */
  headFont?: FontSpec;
  /** Body sizes when `sizes` holds body-and-caption envelopes (reserved presets). */
  bodySizes?: Map<string, Size>;
}

export function layoutPreset(theme: Theme, context: PresetContext): PresetLayout {
  const captions = new Map(context.data.nodes.filter(node => node.caption).map(node => [node.id,
    wrapText(node.caption!, context.font, Math.max(context.sizes.get(node.id)!.width, 16 * context.u), 2, context.measure).lines.length
      * context.lineHeight + 2 * context.u]));
  // Presets allocate an envelope for a body and its caption. Keep the caption
  // outside the body when converting those envelopes back into node rects.
  const external = context.options.variant === 'circular-process' || context.options.variant === 'roadmap';
  const reserved = context.options.variant !== 'linear-process' && !external;
  const result = dispatchPreset(theme, reserved ? { ...context, bodySizes: context.sizes, sizes: new Map([...context.sizes].map(([id, size]) =>
    [id, { ...size, height: size.height + (captions.get(id) ?? 0) }])) } : context);
  if (reserved) for (const [id, height] of captions) {
    const rect = result.nodeRects.get(id);
    if (rect) result.nodeRects.set(id, { ...rect, h: Math.max(context.sizes.get(id)!.height, rect.h - height) });
  }
  if (reserved) for (const edge of result.edges) {
    if (!edge.waypoints || edge.source.portId !== 'auto:tree-out' || edge.target.portId !== 'auto:tree-in') continue;
    const source = result.nodeRects.get(edge.source.nodeId)!;
    const target = result.nodeRects.get(edge.target.nodeId)!;
    edge.waypoints = edge.waypoints.map((point, index) => ({ ...point,
      y: clamp(((index === 0 ? source.y + source.h / 2 : target.y + target.h / 2) - context.plot.y) / context.plot.h, 0, 1),
    }));
  }
  return result;
}

function dispatchPreset(theme: Theme, context: PresetContext): PresetLayout {
  switch (context.options.variant) {
    case 'hierarchy':
      return layoutHierarchy(context);
    case 'issue-tree':
      return layoutIssueTree(context);
    case 'linear-process':
      return layoutLinear(context);
    case 'customer-journey':
      return layoutJourney(theme, context);
    case 'circular-process':
      return layoutCircular(context);
    case 'strategy-house':
      return layoutStrategyHouse(context);
    case 'roadmap':
      return layoutRoadmap(theme, context);
  }
}

const emptyResult = (data: NormalizedDiagram): PresetLayout => ({
  nodeRects: new Map(),
  readingOrder: data.nodes.map((node) => node.id),
  edges: [...data.edges],
  syntheticEdgeIds: [],
  groups: [],
  lanes: [],
  decorationScene: [],
  decorationClaims: [],
  contentTopReserves: new Map(),
});

const placeAuthored = (result: PresetLayout, context: PresetContext): void => {
  for (const node of context.data.nodes) {
    if (!node.position) continue;
    const size = context.sizes.get(node.id)!;
    // An authored position is the body's centre; a caption envelope hangs below it.
    const bodyHeight = context.bodySizes?.get(node.id)!.height ?? size.height;
    result.nodeRects.set(
      node.id,
      qRect({
        x: context.plot.x + node.position.x * context.plot.w - size.width / 2,
        y: context.plot.y + node.position.y * context.plot.h - bodyHeight / 2,
        w: size.width,
        h: size.height,
      }),
    );
  }
  if (context.bodySizes) for (const node of context.data.nodes) if (node.position && node.caption) keepClearOf(result, context, node.id);
};

/**
 * The caption of an authored node hangs below its body, so the preset's own
 * nodes in the way step aside along y, each pushing the next. When one would
 * leave the plot or land on another authored node, none moves, and the
 * caption and fit checks report the collision.
 */
function keepClearOf(result: PresetLayout, context: PresetContext, id: string): void {
  const gap = 2 * context.u;
  const fixed = result.nodeRects.get(id)!;
  const centre = (rect: Rect) => rect.y + rect.h / 2;
  const placed = context.data.nodes.filter((node) => result.nodeRects.has(node.id));
  const free = placed.filter((node) => !node.position).map((node) => node.id);
  const authored = placed.filter((node) => node.position && node.id !== id).map((node) => result.nodeRects.get(node.id)!);
  const down = (other: string) => centre(result.nodeRects.get(other)!) >= centre(fixed);
  // A node pushes only nodes further from the fixed one on its own side, so
  // every push runs one way and the walk ends; the bound is a backstop.
  const rank = new Map(free.map((other, index) => [other, Math.abs(centre(result.nodeRects.get(other)!) - centre(fixed)) + index * 1e-6]));
  const moved = new Map<string, Rect>();
  const current = (other: string) => moved.get(other) ?? result.nodeRects.get(other)!;
  const queue = [id];
  for (let steps = 0; queue.length > 0; steps++) {
    if (steps > 4 * free.length + 4) return;
    const from = queue.shift()!;
    const blocker = from === id ? fixed : current(from);
    for (const other of free) {
      if (other === from || (from !== id && (down(other) !== down(from) || rank.get(other)! <= rank.get(from)!))) continue;
      const rect = current(other);
      if (!rectsOverlap(inflate(blocker, gap / 2), inflate(rect, gap / 2))) continue;
      moved.set(other, qRect({ ...rect, y: down(other) ? blocker.y + blocker.h + gap : blocker.y - gap - rect.h }));
      queue.push(other);
    }
  }
  // Another authored node or the plot edge stops the step-aside: then none moves.
  if ([...moved.values()].every((rect) => rect.y >= context.plot.y && rect.y + rect.h <= context.plot.y + context.plot.h
    && !authored.some((other) => rectsOverlap(other, rect)))) {
    for (const [other, rect] of moved) result.nodeRects.set(other, rect);
  }
}

/** One placement parent per node; other primary edges remain drawn links. */
function graphTree(data: NormalizedDiagram): {
  ranks: Map<string, number>;
  nodes: Map<string, DiagramNode>;
  children: Map<string, DiagramNode[]>;
  treeEdges: Set<string>;
} {
  const nodes = new Map(data.nodes.map(node => [node.id, node]));
  const incoming = new Map(data.nodes.map(node => [node.id, 0]));
  const outgoing = new Map<string, DiagramEdge[]>();
  for (const edge of data.edges) {
    if (edge.dash === 'dotted') continue;
    incoming.set(edge.target.nodeId, incoming.get(edge.target.nodeId)! + 1);
    const edges = outgoing.get(edge.source.nodeId) ?? [];
    edges.push(edge);
    outgoing.set(edge.source.nodeId, edges);
  }
  for (const edges of outgoing.values()) edges.sort((a, b) =>
    nodeOrder(nodes.get(a.target.nodeId)!, nodes.get(b.target.nodeId)!));
  const root = [...incoming].find(([, count]) => count === 0)![0];
  // Longest-path ranks in topological order keep every primary edge pointing
  // forward; a shared child sits one level below its deepest parent.
  const ranks = new Map<string, number>([[root, 0]]);
  const waiting = new Map(incoming);
  const order = [root];
  for (let index = 0; index < order.length; index++) {
    const source = order[index]!;
    for (const edge of outgoing.get(source) ?? []) {
      const target = edge.target.nodeId;
      ranks.set(target, Math.max(ranks.get(target) ?? 0, ranks.get(source)! + 1));
      waiting.set(target, waiting.get(target)! - 1);
      if (waiting.get(target) === 0) order.push(target);
    }
  }
  // The placement parent is the first parent one level up.
  const children = new Map<string, DiagramNode[]>();
  const treeEdges = new Set<string>();
  const placed = new Set([root]);
  for (const source of order) {
    for (const edge of outgoing.get(source) ?? []) {
      const target = edge.target.nodeId;
      if (placed.has(target) || ranks.get(target) !== ranks.get(source)! + 1) continue;
      placed.add(target);
      const siblings = children.get(source) ?? [];
      siblings.push(nodes.get(target)!);
      children.set(source, siblings);
      treeEdges.add(edge.id);
    }
  }
  return { ranks, nodes, children, treeEdges };
}

function layoutHierarchy(context: PresetContext): PresetLayout {
  const result = emptyResult(context.data);
  const { ranks, nodes, children: primaryChildren, treeEdges: placementEdges } = graphTree(context.data);
  const levels = new Map<number, DiagramNode[]>();
  for (const node of context.data.nodes) {
    const rank = ranks.get(node.id) ?? 0;
    levels.set(rank, [...(levels.get(rank) ?? []), node]);
  }
  const root = [...(levels.get(0) ?? [])].sort(nodeOrder)[0]!;
  const branches = [...(levels.get(1) ?? [])].sort(nodeOrder);
  const descendants = new Map<string, DiagramNode[]>();
  for (const branch of branches) {
    const ordered: DiagramNode[] = [];
    const visit = (id: string): void => {
      for (const node of primaryChildren.get(id) ?? []) {
        ordered.push(node);
        visit(node.id);
      }
    };
    visit(branch.id);
    descendants.set(branch.id, ordered);
  }
  const layerGap = 8 * context.u;
  const nodeGap = 3 * context.u;
  const rootSize = context.sizes.get(root.id)!;
  const branchHeight =
    branches.length > 0
      ? maxOf(branches.map((node) => context.sizes.get(node.id)!.height))
      : 0;
  // A branch whose descendants fit its lane side by side is
  // drawn as a tree, each child centred under its parent and attached bottom
  // centre to top centre; a wider branch keeps the indented list.
  const laneWidth = branches.length > 0 ? context.plot.w / branches.length : context.plot.w;
  const treeWidths = new Map<string, number>();
  const treeWidth = (id: string): number => {
    const cached = treeWidths.get(id);
    if (cached !== undefined) return cached;
    const kids = primaryChildren.get(id) ?? [];
    const row = kids.reduce((sum, kid) => sum + treeWidth(kid.id), 0) + Math.max(0, kids.length - 1) * nodeGap;
    const width = Math.max(context.sizes.get(id)!.width, row);
    treeWidths.set(id, width);
    return width;
  };
  const treeDepth = (id: string): number => {
    const kids = primaryChildren.get(id) ?? [];
    return kids.length === 0 ? 0 : maxOf(kids.map((kid) => layerGap + context.sizes.get(kid.id)!.height + treeDepth(kid.id)));
  };
  const treeBranches = new Set(branches.filter((branch) => treeWidth(branch.id) <= laneWidth - 2 * context.u).map((branch) => branch.id));
  const treeNodes = new Set([...treeBranches].flatMap((id) => (descendants.get(id) ?? []).map((node) => node.id)));
  const descendantHeight = Math.max(
    0,
    maxOf([...descendants.entries()].map(([branchId, nodes]) =>
      treeBranches.has(branchId)
        ? Math.max(0, treeDepth(branchId) - layerGap)
        : nodes.reduce(
          (sum, node, index) =>
            sum + context.sizes.get(node.id)!.height + (index === 0 ? 0 : nodeGap),
          0,
        ),
    )),
  );
  const contentHeight =
    rootSize.height +
    (branches.length > 0 ? layerGap + branchHeight : 0) +
    (descendantHeight > 0 ? layerGap + descendantHeight : 0);
  const contentTop =
    context.plot.y + Math.max(0, (context.plot.h - contentHeight) / 2);
  if (contentHeight > context.plot.h) result.compressed = true;
  const rootWidth = Math.min(rootSize.width, context.plot.w);
  if (rootWidth < rootSize.width) result.compressed = true;
  result.nodeRects.set(
    root.id,
    qRect({
      x: context.plot.x + (context.plot.w - rootWidth) / 2,
      y: contentTop,
      w: rootWidth,
      h: rootSize.height,
    }),
  );

  if (branches.length > 0) {
    const branchY = contentTop + rootSize.height + layerGap;
    branches.forEach((branch, branchIndex) => {
      const size = context.sizes.get(branch.id)!;
      const width = Math.min(size.width, Math.max(48, laneWidth - 2 * context.u));
      if (width < size.width) result.compressed = true;
      const laneX = context.plot.x + branchIndex * laneWidth;
      result.nodeRects.set(
        branch.id,
        qRect({
          x: laneX + (laneWidth - width) / 2,
          y: branchY + (branchHeight - size.height) / 2,
          w: width,
          h: size.height,
        }),
      );

      if (treeBranches.has(branch.id)) {
        const placeChildren = (parentId: string): void => {
          const parent = result.nodeRects.get(parentId)!;
          const kids = primaryChildren.get(parentId) ?? [];
          if (kids.length === 0) return;
          const row = kids.reduce((sum, kid) => sum + treeWidth(kid.id), 0) + (kids.length - 1) * nodeGap;
          let left = clamp(parent.x + parent.w / 2 - row / 2, laneX + context.u, laneX + laneWidth - context.u - row);
          for (const kid of kids) {
            const kidSize = context.sizes.get(kid.id)!;
            const span = treeWidth(kid.id);
            result.nodeRects.set(kid.id, qRect({ x: left + (span - kidSize.width) / 2, y: parent.y + parent.h + layerGap, w: kidSize.width, h: kidSize.height }));
            placeChildren(kid.id);
            left += span + nodeGap;
          }
        };
        placeChildren(branch.id);
        return;
      }
      let descendantY = branchY + branchHeight + layerGap;
      for (const node of descendants.get(branch.id) ?? []) {
        const nodeSize = context.sizes.get(node.id)!;
        const rank = ranks.get(node.id) ?? 2;
        const spineX = laneX + 2 * context.u;
        const x = spineX + 2 * context.u + Math.max(0, rank - 2) * context.u;
        const width = Math.min(
          nodeSize.width,
          Math.max(48, laneX + laneWidth - context.u - x),
        );
        if (width < nodeSize.width) result.compressed = true;
        result.nodeRects.set(
          node.id,
          qRect({ x, y: descendantY, w: width, h: nodeSize.height }),
        );
        descendantY += nodeSize.height + nodeGap;
      }
    });
  }
  result.readingOrder = [...levels.keys()]
    .sort((a, b) => a - b)
    .flatMap((rank) => [...levels.get(rank)!].sort(nodeOrder).map((node) => node.id));
  placeAuthored(result, context);
  const ensureHierarchyPort = (
    nodeId: string,
    port: NonNullable<DiagramNode['ports']>[number],
  ): void => {
    const node = nodes.get(nodeId)!;
    if (node.ports?.some((candidate) => candidate.id === port.id)) return;
    node.ports = [...(node.ports ?? []), port];
  };
  // Tree edges take their channel once the group frames stand, below.
  const treeEdges: DiagramEdge[] = [];
  result.edges = result.edges.map((edge) => {
    if (!placementEdges.has(edge.id) || edge.waypoints?.length || edge.source.portId || edge.target.portId) return edge;
    const targetRank = ranks.get(edge.target.nodeId) ?? 0;
    // Root to branch, and inside a tree branch: bottom centre to top centre.
    if (targetRank === 1 || treeNodes.has(edge.target.nodeId)) {
      const source = result.nodeRects.get(edge.source.nodeId)!;
      const target = result.nodeRects.get(edge.target.nodeId)!;
      if (target.y < source.y + source.h) return edge;
      ensureHierarchyPort(edge.source.nodeId, { id: 'auto:tree-down', at: { side: 'bottom' }, intent: 'out' });
      ensureHierarchyPort(edge.target.nodeId, { id: 'auto:tree-top', at: { side: 'top' }, intent: 'in', capacity: 1 });
      const tree: DiagramEdge = {
        ...edge,
        source: { ...edge.source, portId: 'auto:tree-down' },
        target: { ...edge.target, portId: 'auto:tree-top' },
        routing: 'orthogonal',
      };
      treeEdges.push(tree);
      return tree;
    }
    if (targetRank < 2) return edge;
    const source = result.nodeRects.get(edge.source.nodeId)!;
    const target = result.nodeRects.get(edge.target.nodeId)!;
    const siblingEdges = result.edges.filter(
      (candidate) =>
        candidate.dash !== 'dotted' &&
        candidate.source.nodeId === edge.source.nodeId &&
        (ranks.get(candidate.target.nodeId) ?? 0) >= 2,
    );
    const spineX =
      target.x -
      (siblingEdges.some((candidate) => candidate.arrowEnd) ? 3 : 2) *
        context.u;
    const sourceChannelY = source.y + source.h + context.u;
    const targetChannelY = target.y + target.h / 2;
    const sourcePortId = 'auto:hierarchy-out';
    const targetPortId = 'auto:hierarchy-in';
    const siblingCount = siblingEdges.length;
    ensureHierarchyPort(edge.source.nodeId, {
      id: sourcePortId,
      at: { side: 'bottom', offset: 0.2 },
      intent: 'out',
      capacity: Math.max(1, siblingCount),
    });
    ensureHierarchyPort(edge.target.nodeId, {
      id: targetPortId,
      at: { side: 'left' },
      intent: 'in',
      capacity: 1,
    });
    return {
      ...edge,
      source: { ...edge.source, portId: sourcePortId },
      target: { ...edge.target, portId: targetPortId },
      routing: 'orthogonal',
      waypoints: [
        {
          x: clamp((spineX - context.plot.x) / context.plot.w, 0, 1),
          y: clamp((sourceChannelY - context.plot.y) / context.plot.h, 0, 1),
        },
        {
          x: clamp((spineX - context.plot.x) / context.plot.w, 0, 1),
          y: clamp((targetChannelY - context.plot.y) / context.plot.h, 0, 1),
        },
      ],
    };
  });
  result.groups = groupsFromMembers(context, result);
  // A tree edge's horizontal run sits midway between the parent's bottom and
  // the child's top. A group frame whose title row rose to meet that run (a
  // wrapped title) would take the edge in through its side, so the
  // run of every tree edge from that parent moves to a unit above the frame
  // and the parent keeps one bus. The router leaves a port by a stub of one
  // unit, three ahead of an arrowhead, before it turns (routePair); the shared
  // run stays inside the longest stub among the siblings, or a route would
  // double back. Where the frame rises too close to the parent for that, the
  // parent keeps its midway runs and the edge enters the frame through its
  // side as before (known limit, a tall title row). Nodes never move here.
  const u = context.u;
  const stub = (arrow: boolean | undefined) => u * (arrow ? 3 : 1);
  const rectOf = (end: DiagramEdge['source']) => result.nodeRects.get(end.nodeId)!;
  // The top of the frame an edge enters: the child's group, unless the parent sits in it too.
  const frameTop = (edge: DiagramEdge) => {
    const group = result.groups.find((group) => group.memberNodeIds.includes(edge.target.nodeId));
    return group && !group.memberNodeIds.includes(edge.source.nodeId) ? group.bounds.y : Infinity;
  };
  const midway = (edge: DiagramEdge) => {
    const bottom = rectOf(edge.source).y + rectOf(edge.source).h;
    return bottom + (rectOf(edge.target).y - bottom) / 2;
  };
  const nx = (x: number) => clamp((x - context.plot.x) / context.plot.w, 0, 1);
  const byParent = new Map<string, DiagramEdge[]>();
  for (const edge of treeEdges) byParent.set(edge.source.nodeId, [...(byParent.get(edge.source.nodeId) ?? []), edge]);
  for (const siblings of byParent.values()) {
    const source = rectOf(siblings[0]!.source);
    const ceiling = minOf(siblings.map((edge) => frameTop(edge) - u));
    const lowest = source.y + source.h + maxOf(siblings.map((edge) => stub(edge.arrowStart)));
    const run = Math.min(ceiling, minOf(siblings.map((edge) => rectOf(edge.target).y - stub(edge.arrowEnd))));
    const lift = run >= lowest && siblings.some((edge) => frameTop(edge) - u < midway(edge));
    for (const edge of siblings) {
      const target = rectOf(edge.target);
      const ny = clamp(((lift ? run : midway(edge)) - context.plot.y) / context.plot.h, 0, 1);
      edge.waypoints = [{ x: nx(source.x + source.w / 2), y: ny }, { x: nx(target.x + target.w / 2), y: ny }];
    }
  }
  return result;
}

function layoutIssueTree(context: PresetContext): PresetLayout {
  const result = emptyResult(context.data);
  const { ranks, nodes, children, treeEdges: placementEdges } = graphTree(context.data);
  const columns = new Map<number, DiagramNode[]>();
  for (const node of context.data.nodes) {
    const rank = ranks.get(node.id) ?? 0;
    columns.set(rank, [...(columns.get(rank) ?? []), node]);
  }
  const count = maxOf(columns.keys()) + 1;
  const cellW = context.plot.w / count;
  const widths = new Map(
    [...columns].map(([rank, nodes]) => {
      const preferred = maxOf(nodes.map((node) => context.sizes.get(node.id)!.width));
      const width = Math.min(cellW - 3 * context.u, preferred);
      if (width < preferred) result.compressed = true;
      return [rank, width];
    }),
  );
  // Reserve the actual wrapped primary and secondary lines at the column width.
  for (const node of context.data.nodes) {
    if (!node.secondaryLabel) continue;
    const width = Math.max(1, widths.get(ranks.get(node.id) ?? 0)! - 4 * context.u);
    const primary = wrapNameText(node.label, context.font, width, 3, context.measure).lines.length;
    const secondary = wrapText(node.secondaryLabel, context.font, width, 2, context.measure).lines.length;
    const size = context.sizes.get(node.id)!;
    const icon = node.icon || node.shape.kind === 'icon' ? 4.5 * context.u : 0;
    context.sizes.set(node.id, { ...size, height: Math.max(size.height, (primary + secondary) * context.lineHeight + icon + 3.5 * context.u) });
  }
  const nodeGap = 2 * context.u;
  const subtreeHeights = new Map<string, number>();
  const subtreeHeight = (id: string): number => {
    const cached = subtreeHeights.get(id);
    if (cached !== undefined) return cached;
    const nodeHeight = context.sizes.get(id)!.height;
    const descendants = children.get(id) ?? [];
    const childHeight =
      descendants.reduce((sum, child) => sum + subtreeHeight(child.id), 0) +
      Math.max(0, descendants.length - 1) * nodeGap;
    const height = Math.max(nodeHeight, childHeight);
    subtreeHeights.set(id, height);
    return height;
  };
  const root = [...(columns.get(0) ?? [])].sort(nodeOrder)[0]!;
  let totalHeight = subtreeHeight(root.id);
  if (totalHeight > context.plot.h) {
    // Secondary text may use spare height, but cannot displace a primary label.
    const heights = context.data.nodes.map(node => {
      const size = context.sizes.get(node.id)!;
      const width = Math.max(1, widths.get(ranks.get(node.id) ?? 0)! - 4 * context.u);
      const primary = wrapNameText(node.label, context.font, width, 3, context.measure).lines.length;
      const icon = node.icon || node.shape.kind === 'icon' ? 4.5 * context.u : 0;
      const minimum = Math.max(7 * context.u, primary * context.lineHeight + icon + 3 * context.u,
        node.minSize?.height ?? 0, node.size?.height ?? 0);
      return { id: node.id, size, minimum: node.secondaryLabel ? minimum : size.height };
    });
    const resize = (fraction: number) => {
      for (const { id, size, minimum } of heights) context.sizes.set(id, {
        ...size, height: minimum + Math.max(0, size.height - minimum) * fraction,
      });
      subtreeHeights.clear();
      return subtreeHeight(root.id);
    };
    let lo = 0, hi = 1;
    for (let pass = 0; pass < 12; pass++) {
      const mid = (lo + hi) / 2;
      if (resize(mid) <= context.plot.h - 1) lo = mid;
      else hi = mid;
    }
    totalHeight = resize(lo);
  }
  const contentTop =
    context.plot.y + Math.max(0, (context.plot.h - totalHeight) / 2);
  if (totalHeight > context.plot.h) result.compressed = true;
  const placeSubtree = (node: DiagramNode, top: number, height: number): number => {
    const descendants = children.get(node.id) ?? [];
    let centre = top + height / 2;
    if (descendants.length > 0) {
      const childTotal =
        descendants.reduce((sum, child) => sum + subtreeHeight(child.id), 0) +
        (descendants.length - 1) * nodeGap;
      let childTop = top + (height - childTotal) / 2;
      const childCentres = descendants.map((child) => {
        const childHeight = subtreeHeight(child.id);
        const childCentre = placeSubtree(child, childTop, childHeight);
        childTop += childHeight + nodeGap;
        return childCentre;
      });
      centre =
        (childCentres[0]! + childCentres[childCentres.length - 1]!) / 2;
    }
    const rank = ranks.get(node.id) ?? 0;
    const size = context.sizes.get(node.id)!;
    result.nodeRects.set(
      node.id,
      qRect({
        x: context.plot.x + rank * cellW + context.u,
        y: centre - size.height / 2,
        w: widths.get(rank)!,
        h: size.height,
      }),
    );
    return centre;
  };
  placeSubtree(root, contentTop, totalHeight);
  // A lone card is centred, as the hierarchy centres its root.
  if (context.data.nodes.length === 1) {
    const rect = result.nodeRects.get(root.id)!;
    result.nodeRects.set(root.id, qRect({ ...rect, x: context.plot.x + (context.plot.w - rect.w) / 2 }));
  }
  result.readingOrder = [...columns.keys()]
    .sort((a, b) => a - b)
    .flatMap((rank) =>
      [...columns.get(rank)!]
        .sort(
          (a, b) =>
            result.nodeRects.get(a.id)!.y - result.nodeRects.get(b.id)!.y ||
            nodeOrder(a, b),
        )
        .map((node) => node.id),
    );
  placeAuthored(result, context);
  // Every child of a node leaves it through one trunk, halfway to the
  // child column, so no link enters a child from below its neighbour.
  result.edges = result.edges.map((edge) => {
    if (!placementEdges.has(edge.id) || edge.waypoints?.length || edge.source.portId || edge.target.portId) return edge;
    const source = result.nodeRects.get(edge.source.nodeId);
    const target = result.nodeRects.get(edge.target.nodeId);
    if (!source || !target || target.x <= source.x + source.w) return edge;
    const trunkX = source.x + source.w + (target.x - source.x - source.w) / 2;
    ensurePort(nodes, edge.source.nodeId, { id: 'auto:tree-out', at: { side: 'right' }, intent: 'out' });
    ensurePort(nodes, edge.target.nodeId, { id: 'auto:tree-in', at: { side: 'left' }, intent: 'in', capacity: 1 });
    return {
      ...edge,
      source: { ...edge.source, portId: 'auto:tree-out' },
      target: { ...edge.target, portId: 'auto:tree-in' },
      routing: 'orthogonal' as const,
      waypoints: [
        { x: clamp((trunkX - context.plot.x) / context.plot.w, 0, 1), y: clamp((source.y + source.h / 2 - context.plot.y) / context.plot.h, 0, 1) },
        { x: clamp((trunkX - context.plot.x) / context.plot.w, 0, 1), y: clamp((target.y + target.h / 2 - context.plot.y) / context.plot.h, 0, 1) },
      ],
    };
  });
  return result;
}

/** Adds an automatic port to a node once. */
function ensurePort(nodes: Map<string, DiagramNode>, nodeId: string, port: NonNullable<DiagramNode['ports']>[number]): void {
  const node = nodes.get(nodeId)!;
  if (node.ports?.some((candidate) => candidate.id === port.id)) return;
  node.ports = [...(node.ports ?? []), port];
}

function layoutLinear(context: PresetContext): PresetLayout {
  const result = emptyResult(context.data);
  const steps = [...context.data.nodes].sort(nodeOrder);
  const gap = context.u;
  const cellW = (context.plot.w - gap * (steps.length - 1)) / steps.length;
  const uniformW = Math.floor(cellW * 2) / 2;
  const contentW = steps.length * uniformW + (steps.length - 1) * gap;
  if (steps.some((step) => context.sizes.get(step.id)!.width > uniformW)) {
    result.compressed = true;
  }
  const startX = q(context.plot.x + (context.plot.w - contentW) / 2);
  const badgeReserve = 2 * context.u;
  const captions = steps.flatMap((step) => (step.caption ? [step.caption] : []));
  let captionReserve = 0;
  if (captions.length > 0) {
    // The same activation the diagram layout itself performs: a caption
    // measured at the base scale while the layout emits the class step would
    // measure a different size than the renderer draws.
    const theme = themeForWidth(
      resolveTheme(context.options.theme),
      panelTypeClass(context.options) ?? resolveSize(context.options.size).width,
    );
    const captionFont: FontSpec = {
      family: theme.type.family,
      ...theme.type.label,
    };
    const captionWidth = Math.max(uniformW, 16 * context.u);
    captionReserve =
      context.u +
      maxOf(captions.map(
          (caption) =>
            wrapText(caption, captionFont, captionWidth, 2, context.measure).lines.length *
            context.lineHeight,
        ));
  }
  const bodyH = Math.min(
    Math.max(
      12 * context.u,
      maxOf(steps.map((step) => context.sizes.get(step.id)!.height)),
    ),
    context.plot.h - badgeReserve - captionReserve,
  );
  const blockH = badgeReserve + bodyH + captionReserve;
  const bodyY =
    context.plot.y + Math.max(0, (context.plot.h - blockH) / 2) + badgeReserve;
  steps.forEach((node, index) => {
    const x = q(startX + index * (uniformW + gap));
    result.nodeRects.set(
      node.id,
      qRect({
        x,
        y: bodyY,
        w: uniformW,
        h: bodyH,
      }),
    );
  });
  result.readingOrder = steps.map((node) => node.id);
  placeAuthored(result, context);
  return result;
}

function layoutJourney(theme: Theme, context: PresetContext): PresetLayout {
  const result = emptyResult(context.data);
  const lanes = context.data.lanes;
  const serpentine = context.options.variant === 'customer-journey' && context.options.flow === 'serpentine';
  const rowCount = serpentine && lanes.length > 1 ? 2 : 1;
  const perRow = Math.ceil(lanes.length / rowCount);
  const laneW = context.plot.w / perRow;
  const headerH = 7 * context.u;
  const nodeGap = 3 * context.u;
  const anchorReserve = 3 * context.u;
  const visualRows = Array.from({ length: rowCount }, (_, row) =>
    lanes.slice(row * perRow, Math.min(lanes.length, (row + 1) * perRow)),
  );
  const membersByLane = new Map(
    lanes.map((lane) => [
      lane.id,
      context.data.nodes.filter((node) => node.laneId === lane.id).sort(nodeOrder),
    ]),
  );
  const cardRows = visualRows.map((rowLanes) => {
    const memberRows = Math.max(
      0,
      maxOf(rowLanes.map((lane) => membersByLane.get(lane.id)!.length)),
    );
    return Array.from({ length: memberRows }, (_, memberIndex) => {
      const peers = rowLanes.flatMap((lane) => {
        const node = membersByLane.get(lane.id)![memberIndex];
        return node ? [node] : [];
      });
      const height = maxOf(peers.map((node) => context.sizes.get(node.id)!.height));
      const hasIcon = peers.some(
        (node) => node.icon || node.shape.kind === 'icon',
      );
      return {
        height,
        contentTopReserve: hasIcon ? Math.min(height * 0.42, 28) : 0,
      };
    });
  });
  const rowHeights = cardRows.map((rows) => {
    const stackHeight =
      rows.reduce((sum, row) => sum + row.height, 0) +
      Math.max(0, rows.length - 1) * nodeGap;
    return headerH + anchorReserve + stackHeight;
  });
  const betweenRows = rowCount > 1 ? 3 * context.u : 0;
  const totalHeight =
    rowHeights.reduce((sum, height) => sum + height, 0) +
    Math.max(0, rowCount - 1) * betweenRows;
  if (totalHeight > context.plot.h) result.compressed = true;
  const contentTop =
    context.plot.y + Math.max(0, (context.plot.h - totalHeight) / 2);
  const rowTops = rowHeights.map(
    (_, row) =>
      contentTop +
      rowHeights.slice(0, row).reduce((sum, height) => sum + height, 0) +
      row * betweenRows,
  );
  lanes.forEach((lane, laneIndex) => {
    const row = Math.floor(laneIndex / perRow);
    const local = laneIndex % perRow;
    const visualColumn = serpentine && row % 2 === 1 ? perRow - local - 1 : local;
    const x = context.plot.x + visualColumn * laneW;
    const y = rowTops[row]!;
    const laneH = rowHeights[row]!;
    const bounds = qRect({ x, y, w: laneW, h: laneH });
    const headerBox = qRect({ x, y, w: laneW, h: headerH });
    const members = membersByLane.get(lane.id)!;
    if (members.some((node) => context.sizes.get(node.id)!.width > laneW - 2 * context.u)) {
      result.compressed = true;
    }
    let cardY = y + headerH + anchorReserve;
    members.forEach((node, index) => {
      const cardRow = cardRows[row]![index]!;
      const height = cardRow.height;
      result.contentTopReserves.set(node.id, cardRow.contentTopReserve);
      result.nodeRects.set(
        node.id,
        qRect({
          x: x + context.u,
          y: cardY,
          w: laneW - 2 * context.u,
          h: height,
        }),
      );
      cardY += height + nodeGap;
    });
    result.lanes.push({ id: lane.id, bounds, headerBox, memberNodeIds: members.map((node) => node.id) });
    const fill = context.palette.lane(lane.role, lane.paletteKey);
    result.decorationScene.push({
      t: 'path',
      id: diagramSceneId('lane', lane.id, 'header'),
      // The return row of a serpentine reads right to left, and says so.
      d: chevronPath(headerBox, Math.min(2 * context.u, headerBox.w / 6), serpentine && row % 2 === 1),
      fill,
      owner: laneOwner(lane.id),
      part: 'diagramLaneHeader',
    });
    result.decorationClaims.push({ rect: headerBox, owner: laneOwner(lane.id), part: 'diagramLaneHeader' });
    if (local > 0) {
      const ruleX = q(x);
      const from = { x: ruleX, y: q(y + headerH) };
      const to = { x: ruleX, y: q(y + laneH) };
      result.decorationScene.push({
        t: 'line',
        id: diagramSceneId('lane', lane.id, 'partition'),
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
        stroke: { token: 'grid' },
        width: strokeToken(theme, 'rule'),
        dash: dashToken(theme, 'reference'),
        owner: laneOwner(lane.id),
        part: 'diagramLanePartition',
      });
      result.decorationClaims.push({
        rect: segmentBounds(from, to, 1),
        owner: laneOwner(lane.id),
        part: 'diagramLanePartition',
      });
    }
    const anchorY = q(y + headerH + context.u);
    const anchorX = q(x + laneW / 2);
    result.decorationScene.push({
      t: 'circle',
      id: diagramSceneId('lane', lane.id, 'anchor'),
      cx: anchorX,
      cy: anchorY,
      r: q(context.u / 2),
      fill,
      owner: laneOwner(lane.id),
      part: 'diagramJourneyAnchor',
    });
    result.decorationClaims.push({
      rect: qRect({
        x: anchorX - context.u / 2,
        y: anchorY - context.u / 2,
        w: context.u,
        h: context.u,
      }),
      owner: laneOwner(lane.id),
      part: 'diagramJourneyAnchor',
    });
    members.forEach((node, memberIndex) => {
      const rect = result.nodeRects.get(node.id)!;
      const channelX = q(memberIndex % 2 === 0 ? rect.x + context.u : rect.x + rect.w - context.u);
      const d =
        `M${anchorX} ${anchorY}` +
        `L${channelX} ${anchorY}` +
        `L${channelX} ${q(rect.y)}`;
      result.decorationScene.push({
        t: 'path',
        id: diagramSceneId('leader', lane.id, node.id),
        d,
        stroke: { token: 'leader' },
        width: strokeToken(theme, 'rule'),
        dash: dashToken(theme, 'dotted'), lineCap: 'round',
        owner: { pointId: node.id },
        part: 'diagramJourneyLeader',
      });
      const owner = { pointId: node.id };
      result.decorationClaims.push({
        rect: segmentBounds(
          { x: anchorX, y: anchorY },
          { x: channelX, y: anchorY },
          1,
        ),
        owner,
        part: 'diagramJourneyLeader',
      });
      result.decorationClaims.push({
        rect: segmentBounds(
          { x: channelX, y: anchorY },
          { x: channelX, y: q(rect.y) },
          1,
        ),
        owner,
        part: 'diagramJourneyLeader',
      });
    });
  });
  result.readingOrder = lanes.flatMap((lane) => membersByLane.get(lane.id)!.map((node) => node.id));
  return result;
}

/**
 * The ring of a circular process. A step's text sits outside its node, so
 * the node is as large as what it holds, its icon or a secondary line, never
 * its label: sized by the label, large empty circles would fill the plot and
 * push the labels into the ring, away from their nodes. A cycle's steps are
 * peers, so the ring has ONE diameter. Node and ring grow with the plot width
 * (node 40 px and ring radius 56 px at 320, 88 and 136 at 960), but never less than an icon needs or neighbours need to stay 2u
 * apart. The radius leaves a side label room beside the side nodes and, in
 * a host-set height, a name-and-detail band above and below the ring.
 */
export function circularRing(
  steps: readonly DiagramNode[], plot: { w: number; h: number }, u: number,
  text: { font: FontSpec; measure: TextMeasurer },
): { diameter: number; radius: number } {
  const cap = Math.min(plot.w, plot.h) / 3.5;
  const lineHeight = text.font.size * (text.font.lineHeight ?? 1.2);
  const own = (step: DiagramNode): number => {
    const icon = step.icon || step.shape.kind === 'icon' ? 2.5 * lineHeight : 0;
    // A secondary line is drawn inside the node: the node holds its measure.
    const secondary = step.secondaryLabel ? Math.min(cap, text.measure(step.secondaryLabel, text.font).width + 4 * u) : 0;
    return Math.max(icon, secondary, step.size?.width ?? 0, step.size?.height ?? 0, step.minSize?.width ?? 0, step.minSize?.height ?? 0);
  };
  const diameter = Math.max(8 * u, Math.min(16 + 0.08 * plot.w, 0.6 * plot.h), maxOf(steps.map(own)));
  const captionHeight = Math.max(0, maxOf(steps.map(step => step.caption
    ? wrapText(step.caption, text.font, Math.max(diameter, 16 * u), 2, text.measure).lines.length * lineHeight + 2 * u : 0)));
  const minRadius = steps.length > 2 ? (diameter + captionHeight + 2 * u) / (2 * Math.sin(Math.PI / steps.length)) : diameter + captionHeight;
  const labelWidth = Math.min(18 * u, plot.w / 5);
  const maxRadius = Math.min((plot.h - 2 * circularLabelBand(text.font, u) - diameter) / 2, (plot.w - diameter) / 2 - labelWidth - 2 * u);
  return { diameter, radius: Math.max(minRadius, Math.min(20 + 0.128 * plot.w, maxRadius)) };
}

/** The band above and below a ring: a step's name and one detail line, and the 2u gap to its node. */
export function circularLabelBand(font: FontSpec, u: number): number {
  return 2 * font.size * (font.lineHeight ?? 1.2) + 2 * u;
}

function layoutCircular(context: PresetContext): PresetLayout {
  const result = emptyResult(context.data);
  const steps = [...context.data.nodes].sort(nodeOrder);
  const { diameter: ringDiameter, radius } = circularRing(steps, context.plot, context.u, context);
  const centre = { x: context.plot.x + context.plot.w / 2, y: context.plot.y + context.plot.h / 2 };
  steps.forEach((node, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / steps.length;
    const diameter = ringDiameter;
    result.nodeRects.set(
      node.id,
      qRect({
        x: centre.x + Math.cos(angle) * radius - diameter / 2,
        y: centre.y + Math.sin(angle) * radius - diameter / 2,
        w: diameter,
        h: diameter,
      }),
    );
  });
  result.readingOrder = steps.map((node) => node.id);
  // Two steps form a cycle too: each points at the other.
  if (steps.length > 1 && result.edges.length === 0) {
    result.edges = steps.map((step, index) => {
      const target = steps[(index + 1) % steps.length]!;
      return {
        id: automaticEdgeId('circular-process', index, step.id, target.id),
        source: { nodeId: step.id },
        target: { nodeId: target.id },
        routing: 'curved',
        arrowEnd: true,
        role: 'secondary',
      };
    });
    result.syntheticEdgeIds = result.edges.map((edge) => edge.id);
  }
  placeAuthored(result, context);
  return result;
}

/**
 * The strategy house's bands at the heights their text needs: a roof of 3.6 lines or 9 % of the width, a pillar header of
 * one line, initiative cells of at least two lines, enabler bands and a
 * foundation of one line each, all with small fixed gaps. A host-set height
 * scales every band by the same factor, so the house still fills the plot.
 */
export function strategyHouseBands(
  data: Pick<NormalizedDiagram, 'nodes' | 'groups'>, width: number, u: number, font: FontSpec, measure: TextMeasurer,
  headFont: FontSpec = font,
) {
  const lineH = font.size * (font.lineHeight ?? 1.2);
  const groups = data.groups;
  const columnW = width / Math.max(1, groups.length);
  const lines = (node: DiagramNode | undefined, w: number) => node
    ? wrapNameText(node.label, node.kind === 'initiative' || node.kind === 'enabler' ? font : headFont, Math.max(1, w - 4 * u), 3, measure).lines.length : 1;
  const objectives = data.nodes.filter((node) => node.kind === 'objective').sort(nodeOrder);
  const enablers = data.nodes.filter((node) => node.kind === 'enabler').sort(nodeOrder);
  const foundation = data.nodes.find((node) => node.kind === 'foundation');
  const columns = groups.map((group) => data.nodes
    .filter((node) => node.kind === 'initiative' && node.groupId === group.id).sort(nodeOrder));
  const rows = Math.max(1, maxOf(columns.map((cells) => cells.length)));
  // A node's label box is its rect less 1.25u above and below: every band
  // keeps its lines plus that inset and a hair of air (2.6u in all).
  const pad = 2.6 * u;
  // Wide houses open up at 960 and 720: 52 px cells, 32 px pillar
  // heads, 6 px between cells and 8 px gutters between pillars (6 px narrow).
  const wide = width >= 120 * u;
  const header = Math.max(1, maxOf(objectives.map((node) => lines(node, columnW - u)))) * lineH + (wide ? 3.3 * u : pad);
  const cells = Array.from({ length: rows }, (_, row) =>
    Math.max(2, maxOf(columns.map((cells) => (cells[row] ? lines(cells[row], columnW - u) : 1)))) * lineH + (wide ? 4.2 * u : pad));
  const bands = enablers.map((node) => lines(node, width - u) * lineH + pad);
  const base = lines(foundation, width) * lineH + pad;
  const roof = Math.max(3.6 * lineH, 0.09 * width);
  const gap = { roof: 1.2 * u, header: wide ? 1.2 * u : 0.8 * u, cell: wide ? 1.2 * u : 0.8 * u, body: wide ? 2.8 * u : 2 * u, band: 0.6 * u, base: u };
  const height = roof + gap.roof + header + gap.header + cells.reduce((sum, value) => sum + value, 0)
    + Math.max(0, rows - 1) * gap.cell + (bands.length > 0 ? gap.body + bands.reduce((sum, value) => sum + value, 0)
      + (bands.length - 1) * gap.band + gap.base : gap.body) + base;
  return { roof, header, cells, bands, base, gap, height, inset: wide ? 0.8 * u : 0.6 * u };
}

function layoutStrategyHouse(context: PresetContext): PresetLayout {
  const result = emptyResult(context.data);
  const vision = context.data.nodes.find((node) => node.kind === 'vision')!;
  const foundation = context.data.nodes.find((node) => node.kind === 'foundation')!;
  const enablers = context.data.nodes.filter((node) => node.kind === 'enabler').sort(nodeOrder);
  const objectives = context.data.nodes.filter((node) => node.kind === 'objective').sort(nodeOrder);
  const groups = context.data.groups;
  // The house pins full-bleed bands to all four plot edges, and every band
  // rect is quantized to the 0.5 grid — but the frame's plot is NOT on that
  // grid (e.g. y 74.1, h 630.2 under the header metrics), so rounding a
  // band against the raw plot can poke 0.1–0.2px past an edge and trip the
  // exact `rectContains` in sizeWarning (one geometry, two roundings).
  // Snap an INNER on-grid frame first; all bands derive from it.
  const px = Math.ceil(context.plot.x * 2) / 2;
  const py = Math.ceil(context.plot.y * 2) / 2;
  const pw = Math.floor((context.plot.x + context.plot.w) * 2) / 2 - px;
  const ph = Math.floor((context.plot.y + context.plot.h) * 2) / 2 - py;
  const bands = strategyHouseBands(context.data, pw, context.u, context.font, context.measure, context.headFont);
  const k = ph / bands.height;
  const columnW = pw / groups.length;
  const inset = bands.inset;
  const bodyTop = py + (bands.roof + bands.gap.roof) * k;
  const cellTop = bodyTop + (bands.header + bands.gap.header) * k;
  const foundationTop = q(py + ph - bands.base * k);

  result.nodeRects.set(vision.id, qRect({ x: px, y: py, w: pw, h: bands.roof * k }));
  // The vision sits in the roof's wide lower part, clear of its slopes.
  const visionWrap = wrapText(vision.label, context.headFont ?? context.font, Math.max(1, pw - 4 * context.u), 3, context.measure).lines;
  const visionLines = visionWrap.length;
  // Its lines centre on the roof's centroid, two thirds of the way down, and lower where the slopes would close in on the widest line.
  const roofH = bands.roof * k;
  const widest = Math.max(...visionWrap.map((line) => context.measure(line, context.headFont ?? context.font).width));
  const clearOfSlopes = 2 * (roofH * (widest / 2 + context.u)) / (pw / 2) - roofH + visionLines * context.lineHeight;
  const roofReserve = Math.min(Math.max(roofH / 3, clearOfSlopes), roofH - 2.5 * context.u - visionLines * context.lineHeight);
  if (roofReserve > 0) result.contentTopReserves.set(vision.id, roofReserve);
  let bottom = cellTop;
  groups.forEach((group, groupIndex) => {
    const x = px + groupIndex * columnW;
    const objective =
      objectives.find((node) => node.groupId === group.id) ?? objectives[groupIndex];
    const titleBox = qRect({ x: x + inset, y: bodyTop, w: columnW - 2 * inset, h: bands.header * k });
    if (objective) result.nodeRects.set(objective.id, titleBox);
    const initiatives = context.data.nodes
      .filter((node) => node.kind === 'initiative' && node.groupId === group.id)
      .sort(nodeOrder);
    let y = cellTop;
    initiatives.forEach((node, index) => {
      const h = (bands.cells[index] ?? bands.cells[bands.cells.length - 1]!) * k;
      result.nodeRects.set(node.id, qRect({ x: x + inset, y, w: columnW - 2 * inset, h }));
      y += h + bands.gap.cell * k;
    });
    bottom = Math.max(bottom, cellTop + bands.cells.reduce((sum, value) => sum + value, 0) * k
      + Math.max(0, bands.cells.length - 1) * bands.gap.cell * k);
    result.groups.push({
      id: group.id,
      bounds: qRect({ x, y: bodyTop, w: columnW, h: bottom - bodyTop }),
      titleBox,
      memberNodeIds: [
        ...(objective ? [objective.id] : []),
        ...initiatives.map((node) => node.id),
      ],
    });
  });
  let y = bottom + bands.gap.body * k;
  enablers.forEach((node, index) => {
    const h = bands.bands[index]! * k;
    // An enabler band lines up with the pillars above it.
    result.nodeRects.set(node.id, qRect({ x: px + inset, y, w: pw - 2 * inset, h }));
    y += h + bands.gap.band * k;
  });
  result.nodeRects.set(
    foundation.id,
    qRect({
      x: px,
      y: foundationTop,
      w: pw,
      h: py + ph - foundationTop,
    }),
  );
  result.readingOrder = [
    vision.id,
    ...objectives.map((node) => node.id),
    ...groups.flatMap((group) =>
      context.data.nodes
        .filter((node) => node.kind === 'initiative' && node.groupId === group.id)
        .sort(nodeOrder)
        .map((node) => node.id),
    ),
    ...enablers.map((node) => node.id),
    foundation.id,
  ];
  return result;
}

function layoutRoadmap(theme: Theme, context: PresetContext): PresetLayout {
  const result = emptyResult(context.data);
  const lanes = context.data.lanes;
  const laneW = context.plot.w / lanes.length;
  const headerH = 7 * context.u;
  const trajectoryTop = context.plot.y + headerH + 6 * context.u;
  const trajectoryBottom = context.plot.y + context.plot.h - 7 * context.u;
  const milestones = lanes.flatMap((lane) =>
    context.data.nodes.filter((node) => node.laneId === lane.id && node.kind === 'milestone').sort(nodeOrder),
  );
  let ordinal = 0;
  const points: Point[] = [];
  lanes.forEach((lane, laneIndex) => {
    const x = context.plot.x + laneIndex * laneW;
    const bounds = qRect({ x, y: context.plot.y, w: laneW, h: context.plot.h });
    const headerBox = qRect({ x, y: context.plot.y, w: laneW, h: headerH });
    const members = context.data.nodes.filter((node) => node.laneId === lane.id).sort(nodeOrder);
    const laneMilestones = members.filter((node) => node.kind === 'milestone');
    laneMilestones.forEach((node, localIndex) => {
      const authored = node.position;
      const px = authored
        ? context.plot.x + authored.x * context.plot.w
        : x + ((localIndex + 1) / (laneMilestones.length + 1)) * laneW;
      const progress = milestones.length === 1 ? 0.5 : ordinal / (milestones.length - 1);
      const py = authored
        ? context.plot.y + authored.y * context.plot.h
        : trajectoryBottom - progress * (trajectoryBottom - trajectoryTop);
      const diameter = Math.min(4 * context.u, context.sizes.get(node.id)!.height);
      result.nodeRects.set(
        node.id,
        qRect({ x: px - diameter / 2, y: py - diameter / 2, w: diameter, h: diameter }),
      );
      points.push(qPoint({ x: px, y: py }));
      ordinal++;
    });
    result.lanes.push({ id: lane.id, bounds, headerBox, memberNodeIds: members.map((node) => node.id) });
    const fill = context.palette.lane(lane.role, lane.paletteKey);
    result.decorationScene.push({
      t: 'path',
      id: diagramSceneId('lane', lane.id, 'header'),
      d: chevronPath(headerBox, Math.min(2 * context.u, headerBox.w / 6)),
      fill,
      owner: laneOwner(lane.id),
      part: 'diagramLaneHeader',
    });
    result.decorationClaims.push({ rect: headerBox, owner: laneOwner(lane.id), part: 'diagramLaneHeader' });
    if (laneIndex > 0) {
      const from = { x: q(x), y: q(context.plot.y + headerH) };
      const to = { x: q(x), y: q(context.plot.y + context.plot.h) };
      result.decorationScene.push({
        t: 'line',
        id: diagramSceneId('lane', lane.id, 'partition'),
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
        stroke: { token: 'grid' },
        width: strokeToken(theme, 'rule'),
        dash: dashToken(theme, 'reference'),
        owner: laneOwner(lane.id),
        part: 'diagramLanePartition',
      });
      result.decorationClaims.push({
        rect: segmentBounds(from, to, 1),
        owner: laneOwner(lane.id),
        part: 'diagramLanePartition',
      });
    }
  });
  result.trajectory = points;
  if (points.length > 0) {
    const d =
      points.length === 1
        ? `M${q(points[0]!.x - 2 * context.u)} ${q(points[0]!.y)}L${q(points[0]!.x + 2 * context.u)} ${q(points[0]!.y)}`
        : monotonePath(points);
    result.decorationScene.push({
      t: 'path',
      id: diagramSceneId('roadmap', 'trajectory'),
      d,
      stroke: { token: 'axis' },
      width: strokeToken(theme, 'rule'),
      lineCap: 'round',
      owner: {},
      part: 'diagramTrajectory',
    });
    const claimPoints =
      points.length === 1
        ? [
            { x: q(points[0]!.x - 2 * context.u), y: q(points[0]!.y) },
            { x: q(points[0]!.x + 2 * context.u), y: q(points[0]!.y) },
          ]
        : monotoneSegments(points).flatMap((segment, segmentIndex) =>
            sampleCubic(segment.from, segment.c1, segment.c2, segment.to).slice(
              segmentIndex === 0 ? 0 : 1,
            ),
          );
    claimPoints.slice(0, -1).forEach((from, index) => {
      const to = claimPoints[index + 1]!;
      const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
      const localMilestone = points
        .map((point, pointIndex) => ({
          pointIndex,
          distance: Math.hypot(point.x - midpoint.x, point.y - midpoint.y),
        }))
        .sort((a, b) => a.distance - b.distance || a.pointIndex - b.pointIndex)[0];
      result.decorationClaims.push({
        rect: segmentBounds(from, to, 2),
        owner:
          localMilestone && localMilestone.distance <= 5 * context.u
            ? nodeOwner(milestones[localMilestone.pointIndex]!.id)
            : {},
        part: 'diagramTrajectory',
      });
    });
  }
  result.readingOrder = lanes.flatMap((lane) =>
    context.data.nodes
      .filter((node) => node.laneId === lane.id)
      .sort(nodeOrder)
      .map((node) => node.id),
  );
  return result;
}

function sampleCubic(from: Point, c1: Point, c2: Point, to: Point): Point[] {
  return Array.from({ length: 33 }, (_, index) => {
    const t = index / 32;
    const inverse = 1 - t;
    return qPoint({
      x:
        inverse * inverse * inverse * from.x +
        3 * inverse * inverse * t * c1.x +
        3 * inverse * t * t * c2.x +
        t * t * t * to.x,
      y:
        inverse * inverse * inverse * from.y +
        3 * inverse * inverse * t * c1.y +
        3 * inverse * t * t * c2.y +
        t * t * t * to.y,
    });
  });
}

function groupsFromMembers(context: PresetContext, result: PresetLayout): PresetLayout['groups'] {
  const centre = (rect: Rect) => rect.x + rect.w / 2;
  // Each member a tree edge enters from the top, with its parent's centre.
  const parents = new Map(result.edges.flatMap((edge) => (edge.target.portId === 'auto:tree-top'
    ? [[edge.target.nodeId, centre(result.nodeRects.get(edge.source.nodeId)!)] as const] : [])));
  const font = context.titleFont;
  const line = font.size * (font.lineHeight ?? 1.2);
  const width = (text: string) => context.measure(text, font).width;
  const groups = context.data.groups.map((group) => {
    const members = context.data.nodes.filter((node) => node.groupId === group.id);
    const rects = members.map((node) => result.nodeRects.get(node.id)!);
    const pad = group.padding ?? 3 * context.u;
    return { group, members, rects, memberBounds: boundsOf(rects), pad };
  });
  // The frames as they stand, so a widened frame stops short of its neighbours.
  const frames = groups.map(({ memberBounds: b, pad }) => ({ x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad }));
  return groups.map(({ group, members, rects, memberBounds, pad }, index) => {
    // The title row holds a line of the title font with a quarter unit above
    // and below, so a theme with large titles for its unit keeps them.
    // authored group padding cannot make the title row shorter than its report font.
    let header = Math.max(group.padding ?? pad, line + context.u / 2);
    let left = memberBounds.x - pad;
    let right = memberBounds.x + memberBounds.w + pad;
    let title = { x: memberBounds.x, w: memberBounds.w };
    // A tree edge into a member on the top row crosses the title row at the
    // member's centre. The title takes the widest stretch of the row
    // clear of those crossings. Where it fits none, an outer stretch widens
    // the frame, but only up to a neighbouring frame or node and the plot;
    // then the title breaks into two lines in a stretch clear of the edges'
    // horizontal runs. A title that fits nowhere stays in the widest stretch,
    // where the label solver or the router reports it.
    const entered = rects.filter((rect, at) => parents.has(members[at]!.id) && rect.y === memberBounds.y);
    if (entered.length > 0) {
      const crossings = entered.map(centre).sort((a, b) => a - b);
      const edges = [left, ...crossings.flatMap((x) => [x - context.u, x + context.u]), right];
      const stretches = edges.flatMap((x, at) => (at % 2 === 0 ? [{ x, w: edges[at + 1]! - x }] : []));
      const top = memberBounds.y - pad;
      const bottom = memberBounds.y + memberBounds.h + pad;
      const beside = [...frames.filter((_, at) => at !== index), ...[...result.nodeRects].flatMap(([id, rect]) => (members.some((node) => node.id === id) ? [] : [rect]))]
        .filter((rect) => rect.y < bottom && rect.y + rect.h > top);
      const roomLeft = Math.max(0, left - Math.max(context.plot.x, maxOf(beside.filter((rect) => rect.x + rect.w <= left).map((rect) => rect.x + rect.w + context.u))));
      const roomRight = Math.max(0, Math.min(context.plot.x + context.plot.w, minOf(beside.filter((rect) => rect.x >= right).map((rect) => rect.x - context.u))) - right);
      const runs = entered.map((rect) => {
        const [a, b] = [centre(rect), parents.get(members[rects.indexOf(rect)]!.id)!].sort((p, q) => p - q);
        return { a: a!, b: b! };
      });
      const place = (need: number, clearOfRuns: boolean): boolean => {
        const fits = stretches
          .map((stretch, at) => ({ stretch, at, room: at === 0 ? roomLeft : at === stretches.length - 1 ? roomRight : 0 }))
          .filter(({ stretch, room }) => stretch.w + room >= need
            && (!clearOfRuns || runs.every(({ a, b }) => stretch.x >= b || stretch.x + stretch.w <= a)));
        if (fits.length === 0) return false;
        const { stretch, at } = fits.reduce((best, fit) => (fit.stretch.w > best.stretch.w ? fit : best));
        const grow = Math.max(0, need - stretch.w);
        if (at === 0) left -= grow;
        else right += grow;
        title = { x: at === 0 ? stretch.x - grow : stretch.x, w: stretch.w + grow };
        return true;
      };
      // A stretch clear of the horizontal runs comes first: a title on a run
      // makes the router detour that edge off the parent's shared bus.
      if (!place(width(group.title) + 2 * context.u, true) && !place(width(group.title) + 2 * context.u, false)) {
        const words = group.title.split(' ');
        const split = words.slice(1).map((_, at) => Math.max(width(words.slice(0, at + 1).join(' ')), width(words.slice(at + 1).join(' '))));
        if (split.length > 0 && place(Math.min(...split) + 2 * context.u, true)) header = Math.max(header, 2 * line + context.u / 2);
        else title = stretches.reduce((best, stretch) => (stretch.w > best.w ? stretch : best));
      }
    }
    frames[index] = { x: left, y: memberBounds.y - header, w: right - left, h: memberBounds.h + header + pad };
    return {
      id: group.id,
      bounds: qRect(frames[index]!),
      titleBox: qRect({
        x: title.x,
        y: memberBounds.y - header,
        w: title.w,
        h: header,
      }),
      memberNodeIds: members.map((node) => node.id),
    };
  });
}

function nodeOrder(a: DiagramNode, b: DiagramNode): number {
  if (a.order === undefined || b.order === undefined) return 0;
  return a.order - b.order || compareDiagramIds(a.id, b.id);
}
