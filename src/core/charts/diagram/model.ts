import { NormalizeError } from '../../normalize/shared';
import { diagramKindError } from '../../schema/diagramKind';
import type {
  DiagramData,
  DiagramEdge,
  DiagramNode,
  DiagramOptions,
} from '../../types/diagram';
import { compareDiagramIds } from './ids';

export interface NormalizedDiagram {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  groups: NonNullable<DiagramData['groups']>;
  lanes: NonNullable<DiagramData['lanes']>;
  key: NonNullable<DiagramData['key']>;
}

const stableOrder = <T extends { id: string; order?: number }>(items: readonly T[]): T[] =>
  items
    .map((item, sourceIndex) => ({ item, sourceIndex }))
    .sort(
      (a, b) =>
        (a.item.order ?? a.sourceIndex) - (b.item.order ?? b.sourceIndex) ||
        compareDiagramIds(a.item.id, b.item.id),
    )
    .map(({ item }) => item);

export function normalizeDiagramModel(
  rawData: DiagramData,
  rawOptions: DiagramOptions,
): { data: NormalizedDiagram; options: DiagramOptions } {
  if (!Array.isArray(rawData.nodes) || rawData.nodes.length === 0) throw new NormalizeError('empty-data', 'nodes', 'diagram requires at least one node');
  const data: NormalizedDiagram = {
    // Presets can add generated ports; keep those on layout-owned nodes.
    nodes: stableOrder(rawData.nodes).map(node => ({ ...node })),
    edges: [...(rawData.edges ?? [])].sort((a, b) => compareDiagramIds(a.id, b.id)),
    groups: stableOrder(rawData.groups ?? []),
    lanes: stableOrder(rawData.lanes ?? []),
    key: rawData.key ?? [],
  };
  validatePreset(data, rawOptions, rawData.nodes);
  return { data, options: rawOptions };
}

function validatePreset(data: NormalizedDiagram, options: DiagramOptions, authoredNodes: DiagramNode[]): void {
  const membership = data.nodes.filter((node) => node.groupId || node.laneId);
  const requireKinds = () => {
    const error = diagramKindError(authoredNodes, options);
    if (error) throw error;
  };

  if (options.variant === 'customer-journey' || options.variant === 'roadmap') {
    if (data.groups.length > 0 || data.nodes.some((node) => node.groupId)) {
      throw new NormalizeError(
        'invalid-membership',
        'groups',
        `variant '${options.variant}' reads lane membership, not groups`,
      );
    }
    if (data.lanes.length === 0 || data.lanes.some((lane) => lane.orientation !== 'vertical')) {
      throw new NormalizeError(
        'invalid-membership',
        'lanes',
        `variant '${options.variant}' requires vertical lanes`,
      );
    }
    const member = data.nodes.find((node) => !node.laneId);
    if (member) {
      throw new NormalizeError(
        'invalid-membership',
        `nodes[${member.id}].laneId`,
        `variant '${options.variant}' requires every node to name its phase lane`,
      );
    }
    requireKinds();
    if (options.variant === 'roadmap' && !data.nodes.some((node) => node.kind === 'milestone')) {
      throw new NormalizeError('invalid-roadmap', 'nodes', 'roadmap requires at least one milestone');
    }
    validateMonotonePins(data, options);
    return;
  }

  if (options.variant === 'strategy-house') {
    if (data.lanes.length > 0 || data.nodes.some((node) => node.laneId)) {
      throw new NormalizeError('invalid-membership', 'lanes', "variant 'strategy-house' reads groups, not lanes");
    }
    const vision = data.nodes.filter((node) => node.kind === 'vision');
    const foundation = data.nodes.filter((node) => node.kind === 'foundation');
    if (vision.length !== 1 || vision[0]!.shape.kind !== 'roof') {
      throw new NormalizeError('invalid-strategy-house', 'nodes', 'strategy-house requires exactly one roof-shaped vision');
    }
    if (foundation.length !== 1) {
      throw new NormalizeError('invalid-strategy-house', 'nodes', 'strategy-house requires exactly one foundation');
    }
    if (!data.nodes.some((node) => node.kind === 'initiative') || !data.nodes.some((node) => node.kind === 'enabler')) {
      throw new NormalizeError('invalid-strategy-house', 'nodes', 'strategy-house requires initiatives and enablers');
    }
    if (data.groups.length === 0) {
      throw new NormalizeError('invalid-strategy-house', 'groups', 'strategy-house requires objective groups');
    }
    const invalid = data.nodes.find(
      (node) =>
        node.kind === 'initiative' &&
        (!node.groupId || !data.groups.some((group) => group.id === node.groupId)),
    );
    if (invalid) {
      throw new NormalizeError(
        'invalid-membership',
        `nodes[${invalid.id}].groupId`,
        'strategy-house initiatives require an objective group',
      );
    }
    return;
  }

  if (options.variant !== 'hierarchy' && membership.length > 0) {
    throw new NormalizeError(
      'invalid-membership',
      `nodes[${membership[0]!.id}]`,
      `variant '${options.variant}' does not read group or lane membership`,
    );
  }
  if (data.lanes.length > 0 || (options.variant !== 'hierarchy' && data.groups.length > 0)) {
    throw new NormalizeError(
      'invalid-membership',
      options.variant === 'hierarchy' ? 'lanes' : 'groups',
      `variant '${options.variant}' does not read this membership surface`,
    );
  }

  requireKinds();

  if (options.variant === 'hierarchy' || options.variant === 'issue-tree') {
    validateRootedDag(data, options.variant);
  }
}

function validateRootedDag(data: NormalizedDiagram, variant: 'hierarchy' | 'issue-tree'): void {
  if (data.nodes.length === 1 && data.edges.length === 0) return;
  const nodeIds = new Set(data.nodes.map((node) => node.id));
  const primary = data.edges.filter((edge) => edge.dash !== 'dotted');
  const incoming = new Map(data.nodes.map((node) => [node.id, 0]));
  primary.forEach((edge) => incoming.set(edge.target.nodeId, incoming.get(edge.target.nodeId)! + 1));
  const roots = [...incoming].filter(([, count]) => count === 0).map(([id]) => id);
  const outgoing = new Map<string, string[]>();
  primary.forEach((edge) => {
    const targets = outgoing.get(edge.source.nodeId) ?? [];
    targets.push(edge.target.nodeId);
    outgoing.set(edge.source.nodeId, targets);
  });
  // A cycle leaves no root at all; the error names the loop, not a root count.
  const path: string[] = [];
  const visited = new Set<string>();
  const visit = (id: string): void => {
    const at = path.indexOf(id);
    if (at >= 0) {
      throw new NormalizeError('diagram-cycle', 'edges', `${variant} primary graph contains a cycle: ${[...path.slice(at), id].join(' → ')}`,
        'remove or dot (dash: dotted) one edge of the loop');
    }
    if (visited.has(id)) return;
    path.push(id);
    for (const target of (outgoing.get(id) ?? []).sort(compareDiagramIds)) visit(target);
    path.pop();
    visited.add(id);
  };
  if (roots.length === 0) [...nodeIds].sort(compareDiagramIds).forEach(visit);
  if (roots.length !== 1) {
    throw new NormalizeError('invalid-root', 'edges', `${variant} requires one primary root, found ${roots.length}`);
  }
  visit(roots[0]!);
  if (visited.size !== nodeIds.size) {
    throw new NormalizeError('invalid-root', 'edges', `${variant} primary graph is disconnected`);
  }
}

function validateMonotonePins(data: NormalizedDiagram, options: DiagramOptions): void {
  if (options.variant !== 'roadmap') return;
  const laneOrder = new Map(data.lanes.map((lane, index) => [lane.id, index]));
  const pinned = data.nodes
    .filter((node) => node.kind === 'milestone' && node.position)
    .sort(
      (a, b) =>
        (laneOrder.get(a.laneId!) ?? 0) - (laneOrder.get(b.laneId!) ?? 0) ||
        (a.order ?? 0) - (b.order ?? 0) ||
        compareDiagramIds(a.id, b.id),
    );
  for (let index = 1; index < pinned.length; index++) {
    const previous = pinned[index - 1]!.position!;
    const current = pinned[index]!.position!;
    if (current.x <= previous.x || current.y > previous.y) {
      throw new NormalizeError(
        'non-monotone-roadmap',
        `nodes[${pinned[index]!.id}].position`,
        'authored roadmap milestone positions must increase in x and rise monotonically',
      );
    }
  }
}
