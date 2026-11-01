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
  channels: NonNullable<DiagramData['channels']>;
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
    channels: rawData.channels ?? [],
  };
  validatePreset(data, rawOptions, rawData.nodes);
  return { data, options: rawOptions };
}

/** Each field the architecture layout owns, with what to write instead. */
const ARCHITECTURE_NODE_REFUSALS = [
  ['position', 'the engine owns geometry: use track and order'],
  ['size', 'the engine sizes nodes from their text: shorten the text'],
  ['minSize', 'the engine sizes nodes from their text: shorten the text'],
  ['caption', 'use secondaryLabel'],
  ['ports', 'the engine picks the ports: remove them'],
] as const;

function validateArchitecture(data: NormalizedDiagram, options: DiagramOptions & { variant: 'architecture' }): void {
  if (options.flow === 'lanes') {
    if (data.lanes.length === 0) throw new NormalizeError('invalid-membership', 'lanes', "flow 'lanes' requires data.lanes", 'add data.lanes, or remove options.flow');
    const vertical = data.lanes.find((lane) => lane.orientation !== 'horizontal');
    if (vertical) throw new NormalizeError('invalid-membership', `lanes[${vertical.id}].orientation`, "flow 'lanes' stacks horizontal lanes", `set lane '${vertical.id}' to orientation 'horizontal'`);
    const outside = data.nodes.find((node) => !node.laneId);
    if (outside) throw new NormalizeError('invalid-membership', `nodes[${outside.id}].laneId`, `flow 'lanes' requires every node to name its lane, and '${outside.id}' names none`, `set nodes[${outside.id}].laneId`);
  } else if (data.lanes.length > 0 || data.nodes.some((node) => node.laneId)) {
    throw new NormalizeError('invalid-membership', 'lanes', "flow 'columns' reads groups, not lanes", "set options.flow to 'lanes', or remove the lanes");
  }
  for (const node of data.nodes) {
    for (const [field, fix] of ARCHITECTURE_NODE_REFUSALS) {
      if (node[field] !== undefined) throw new NormalizeError('invalid-membership', `nodes[${node.id}].${field}`, `variant 'architecture' does not read ${field}`, fix);
    }
    if (!['rectangle', 'roundedRect'].includes(node.shape.kind)) {
      throw new NormalizeError('invalid-membership', `nodes[${node.id}].shape`, `variant 'architecture' does not draw shape '${node.shape.kind}'`, "use shape 'rectangle' or 'roundedRect'");
    }
  }
  for (const edge of data.edges) {
    if (edge.waypoints) throw new NormalizeError('invalid-membership', `edges[${edge.id}].waypoints`, "variant 'architecture' does not read waypoints", 'the engine routes every edge: use track to line up its nodes');
    if (edge.routing) throw new NormalizeError('invalid-membership', `edges[${edge.id}].routing`, "variant 'architecture' does not read routing", 'the engine routes every edge: remove routing');
    if (edge.source.portId || edge.target.portId) throw new NormalizeError('invalid-membership', `edges[${edge.id}]`, "variant 'architecture' does not read portId", 'the engine picks the ports: remove portId');
  }
  const forward = data.edges.filter((edge) => edge.flow !== 'return');
  const waiting = new Map(data.nodes.map((node) => [node.id, 0]));
  for (const edge of forward) waiting.set(edge.target.nodeId, waiting.get(edge.target.nodeId)! + 1);
  const ready = data.nodes.filter((node) => waiting.get(node.id) === 0).map((node) => node.id);
  for (const id of ready) {
    for (const edge of forward) {
      if (edge.source.nodeId !== id) continue;
      waiting.set(edge.target.nodeId, waiting.get(edge.target.nodeId)! - 1);
      if (waiting.get(edge.target.nodeId) === 0) ready.push(edge.target.nodeId);
    }
  }
  const looped = forward.filter((edge) => waiting.get(edge.source.nodeId)! > 0 && waiting.get(edge.target.nodeId)! > 0);
  if (looped.length > 0) {
    throw new NormalizeError('diagram-cycle', 'edges', `the forward edges ${looped.map((edge) => `'${edge.id}'`).join(', ')} form a cycle`,
      `set flow: 'return' on the edge that closes the loop, for example '${looped[looped.length - 1]!.id}'`);
  }
  const edgeIds = new Set(data.edges.map((edge) => edge.id));
  const channelled = new Set<string>();
  for (const channel of data.channels) {
    for (const id of channel.edgeIds) {
      if (!edgeIds.has(id)) throw new NormalizeError('diagram-channel-mismatch', `channels[${channel.id}].edgeIds`, `channel '${channel.id}' names the unknown edge '${id}'`, 'name an edge of data.edges');
      if (channelled.has(id)) throw new NormalizeError('diagram-channel-mismatch', `channels[${channel.id}].edgeIds`, `edge '${id}' is in two channels`, 'keep each edge in one channel');
      channelled.add(id);
    }
  }
}

function validatePreset(data: NormalizedDiagram, options: DiagramOptions, authoredNodes: DiagramNode[]): void {
  if (options.variant === 'architecture') {
    validateArchitecture(data, options);
    return;
  }
  const architectureOnly = data.nodes.find((node) => node.track !== undefined || node.span !== undefined)?.id ?? data.edges.find((edge) => edge.flow !== undefined)?.id
    ?? (data.channels.length > 0 ? 'channels' : undefined);
  if (architectureOnly !== undefined) {
    throw new NormalizeError('invalid-membership', architectureOnly, `track, span, edge flow and channels are read only by variant 'architecture', not '${options.variant}'`, "remove them, or set options.variant to 'architecture'");
  }
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
