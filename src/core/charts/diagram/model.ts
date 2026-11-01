import { NormalizeError } from '../../normalize/shared';
import { diagramKindError } from '../../schema/diagramKind';
import type {
  DiagramAuthoredEdge,
  DiagramData,
  DiagramEdge,
  DiagramEndpoint,
  DiagramGroup,
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
  callouts: NonNullable<DiagramData['callouts']>;
  /** The zone an edge end stands on. The edge names a node of that zone for ordering. */
  groupEnds: Map<string, { source?: string; target?: string }>;
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
  // Presets can add generated ports; keep those on layout-owned nodes.
  const nodes = stableOrder(rawData.nodes).map(node => ({ ...node }));
  const groups = stableOrder(rawData.groups ?? []);
  const groupEnds: NormalizedDiagram['groupEnds'] = new Map();
  const resolveEnd = (edge: DiagramAuthoredEdge, end: 'source' | 'target'): DiagramEndpoint => {
    const endpoint = edge[end];
    if (!('groupId' in endpoint)) return endpoint;
    if (rawOptions.variant !== 'architecture') throw new NormalizeError('invalid-membership', `edges[${edge.id}].${end}`, `only variant 'architecture' ends an edge on a group, not '${rawOptions.variant}'`, 'name a node, or set options.variant to architecture');
    const member = nodes.find((node) => node.groupId !== undefined && groupWithin(groups, node.groupId, endpoint.groupId));
    if (!member) throw new NormalizeError('invalid-membership', `edges[${edge.id}].${end}`, `group '${endpoint.groupId}' has no nodes to end edge '${edge.id}' on`, `add a node to group '${endpoint.groupId}'`);
    groupEnds.set(edge.id, { ...groupEnds.get(edge.id), [end]: endpoint.groupId });
    return { nodeId: member.id };
  };
  const data: NormalizedDiagram = {
    nodes,
    edges: (rawData.edges ?? []).map((edge) => ({ ...edge, source: resolveEnd(edge, 'source'), target: resolveEnd(edge, 'target') })).sort((a, b) => compareDiagramIds(a.id, b.id)),
    groups,
    lanes: stableOrder(rawData.lanes ?? []),
    key: rawData.key ?? [],
    channels: rawData.channels ?? [],
    callouts: rawData.callouts ?? [],
    groupEnds,
  };
  validatePreset(data, rawOptions, rawData.nodes);
  if (rawOptions.variant === 'architecture') {
    const policy = new Set(groups.filter((group) => group.kind === 'policy').map((group) => group.id));
    data.nodes = data.nodes.map((node) => (node.groupId !== undefined && policy.has(node.groupId) ? { ...node, shape: { kind: 'text' as const } } : node));
    applyHighlight(data, rawOptions.highlight);
  }
  return { data, options: rawOptions };
}

/** Whether a group is this group or sits inside it. */
export function groupWithin(groups: readonly DiagramGroup[], id: string, within: string): boolean {
  const seen = new Set<string>();
  for (let at: string | undefined = id; at !== undefined && !seen.has(at); at = groups.find((group) => group.id === at)?.parentId) {
    if (at === within) return true;
    seen.add(at);
  }
  return false;
}

const DEVIATIONS: ReadonlySet<string | undefined> = new Set(['good', 'bad', 'warn', 'category']);

/** One message: the named nodes and edges take the accent, and the rest recedes. A deviation keeps its colour. */
function applyHighlight(data: NormalizedDiagram, highlight: string | readonly string[] | undefined): void {
  if (highlight === undefined) return;
  const focus = typeof highlight === 'string' ? [highlight] : highlight;
  const named = new Set(focus);
  const nodeIds = new Set(data.nodes.map((node) => node.id));
  const edgeIds = new Set(data.edges.map((edge) => edge.id));
  const unknown = focus.find((id) => !nodeIds.has(id) && !edgeIds.has(id));
  if (unknown !== undefined) throw new NormalizeError('invalid-membership', 'options.highlight', `highlight names '${unknown}', which is no node or edge`, 'name ids of data.nodes or data.edges');
  const focalNodes = new Set(focus.filter((id) => nodeIds.has(id)));
  // Named edges are the path. With nodes alone, the edges between them are.
  const pathNamed = focus.some((id) => edgeIds.has(id));
  for (const edge of data.edges) {
    if (!named.has(edge.id)) continue;
    focalNodes.add(edge.source.nodeId);
    focalNodes.add(edge.target.nodeId);
  }
  data.nodes = data.nodes.map((node) => (DEVIATIONS.has(node.role) && focalNodes.has(node.id) ? node
    : { ...node, role: focalNodes.has(node.id) ? 'accent' : 'muted', paletteKey: undefined }));
  data.edges = data.edges.map((edge) => {
    const focal = pathNamed ? named.has(edge.id) : focalNodes.has(edge.source.nodeId) && focalNodes.has(edge.target.nodeId);
    return focal ? { ...edge, role: 'accent', paletteKey: undefined, weight: 'strong' } : { ...edge, role: 'muted', paletteKey: undefined };
  });
}

/** Each field the architecture layout owns, with what to write instead. */
const ARCHITECTURE_NODE_REFUSALS = [
  ['position', 'the engine owns geometry: use track and order'],
  ['size', 'the engine sizes nodes from their text: shorten the text'],
  ['minSize', 'the engine sizes nodes from their text: shorten the text'],
  ['caption', 'use secondaryLabel'],
  ['ports', 'the engine picks the ports: remove them'],
] as const;

function validateGroups(data: NormalizedDiagram, options: DiagramOptions & { variant: 'architecture' }): void {
  const byId = new Map(data.groups.map((group) => [group.id, group]));
  for (const group of data.groups) {
    const path = [group.id];
    for (let at = group.parentId; at !== undefined; at = byId.get(at)?.parentId) {
      if (path.includes(at)) throw new NormalizeError('diagram-group-cycle', `groups[${group.id}].parentId`, `the groups ${[...path, at].map((id) => `'${id}'`).join(' → ')} form a cycle`, `remove parentId from group '${at}'`);
      path.push(at);
    }
    if (path.length > 3) throw new NormalizeError('invalid-membership', `groups[${group.id}].parentId`, `group '${group.id}' sits ${path.length} levels deep, and zones nest up to three`, 'flatten one level');
    if (group.parentId !== undefined && options.flow === 'lanes') throw new NormalizeError('invalid-membership', `groups[${group.id}].parentId`, "flow 'lanes' draws flat zones", "remove parentId, or use flow 'columns'");
  }
  const policies = data.groups.filter((group) => group.kind === 'policy');
  if (policies.length > 1) throw new NormalizeError('invalid-membership', 'groups', 'an exhibit has one policy strip', `merge group '${policies[1]!.id}' into '${policies[0]!.id}'`);
  const policy = policies[0];
  if (!policy) return;
  if (policy.parentId !== undefined || policy.protected || data.groups.some((group) => group.parentId === policy.id)) {
    throw new NormalizeError('invalid-membership', `groups[${policy.id}]`, 'a policy strip spans the exhibit, so it takes no parent, no child and no protection', 'use a zone for that');
  }
  const wired = data.edges.find((edge) => [edge.source.nodeId, edge.target.nodeId].some((id) => data.nodes.find((node) => node.id === id)?.groupId === policy.id));
  if (wired) throw new NormalizeError('invalid-membership', `edges[${wired.id}]`, `edge '${wired.id}' touches the policy strip, whose items take no edges`, 'move the node to a zone, or remove the edge');
}

function validateArchitecture(data: NormalizedDiagram, options: DiagramOptions & { variant: 'architecture' }): void {
  validateGroups(data, options);
  const policy = data.groups.find((group) => group.kind === 'policy')?.id;
  if (options.flow === 'lanes') {
    if (data.lanes.length === 0) throw new NormalizeError('invalid-membership', 'lanes', "flow 'lanes' requires data.lanes", 'add data.lanes, or remove options.flow');
    const vertical = data.lanes.find((lane) => lane.orientation !== 'horizontal');
    if (vertical) throw new NormalizeError('invalid-membership', `lanes[${vertical.id}].orientation`, "flow 'lanes' stacks horizontal lanes", `set lane '${vertical.id}' to orientation 'horizontal'`);
    const outside = data.nodes.find((node) => !node.laneId && (policy === undefined || node.groupId !== policy));
    if (outside) throw new NormalizeError('invalid-membership', `nodes[${outside.id}].laneId`, `flow 'lanes' requires every node to name its lane, and '${outside.id}' names none`, `set nodes[${outside.id}].laneId`);
    const policyNode = data.nodes.find((node) => policy !== undefined && node.groupId === policy && node.laneId !== undefined);
    if (policyNode) throw new NormalizeError('invalid-membership', `nodes[${policyNode.id}].laneId`, `policy node '${policyNode.id}' cannot also belong to a lane`, 'remove laneId from the policy node, or move it out of the policy strip');
  } else if (data.lanes.length > 0 || data.nodes.some((node) => node.laneId)) {
    throw new NormalizeError('invalid-membership', 'lanes', "flow 'columns' reads groups, not lanes", "set options.flow to 'lanes', or remove the lanes");
  }
  for (const node of data.nodes) {
    for (const [field, fix] of ARCHITECTURE_NODE_REFUSALS) {
      if (node[field] !== undefined) throw new NormalizeError('invalid-membership', `nodes[${node.id}].${field}`, `variant 'architecture' does not read ${field}`, fix);
    }
    if (!['rectangle', 'roundedRect', 'store'].includes(node.shape.kind)) {
      throw new NormalizeError('invalid-membership', `nodes[${node.id}].shape`, `variant 'architecture' does not draw shape '${node.shape.kind}'`, "use shape 'rectangle', 'roundedRect' or 'store'");
    }
    if (node.shape.kind === 'store' && node.repeat !== undefined) throw new NormalizeError('invalid-membership', `nodes[${node.id}].repeat`, 'a store draws no stacked copies', 'remove repeat, or use a rectangle');
  }
  for (const edge of data.edges) {
    if (edge.waypoints) throw new NormalizeError('invalid-membership', `edges[${edge.id}].waypoints`, "variant 'architecture' does not read waypoints", 'the engine routes every edge: use track to line up its nodes');
    if (edge.routing) throw new NormalizeError('invalid-membership', `edges[${edge.id}].routing`, "variant 'architecture' does not read routing", 'the engine routes every edge: remove routing');
    if (edge.source.portId || edge.target.portId) throw new NormalizeError('invalid-membership', `edges[${edge.id}]`, "variant 'architecture' does not read portId", 'the engine picks the ports: remove portId');
  }
  // A self-loop sets no order, so it closes no cycle.
  const forward = data.edges.filter((edge) => edge.flow !== 'return' && edge.source.nodeId !== edge.target.nodeId);
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
  for (const [id, ends] of data.groupEnds) {
    const edge = data.edges.find((item) => item.id === id)!;
    const other = (end: 'source' | 'target') => data.nodes.find((node) => node.id === edge[end].nodeId)?.groupId;
    const inner = (group: string | undefined, end: 'source' | 'target') => group !== undefined && (ends[end] !== undefined ? groupWithin(data.groups, ends[end]!, group) : groupWithin(data.groups, other(end) ?? '', group));
    if (inner(ends.source, 'target') || inner(ends.target, 'source')) throw new NormalizeError('invalid-membership', `edges[${id}]`, `edge '${id}' ends on a zone that holds its other end`, 'end it on a node');
    if (ends.source === undefined ? false : data.groups.find((group) => group.id === ends.source)?.kind === 'policy') throw new NormalizeError('invalid-membership', `edges[${id}]`, 'a policy strip takes no edges', 'end the edge on a zone');
    if (ends.target === undefined ? false : data.groups.find((group) => group.id === ends.target)?.kind === 'policy') throw new NormalizeError('invalid-membership', `edges[${id}]`, 'a policy strip takes no edges', 'end the edge on a zone');
  }
  const groupIds = new Set(data.groups.map((group) => group.id));
  const calloutTargets = new Set<string>();
  for (const callout of data.callouts) {
    const target = callout.target;
    const known = 'nodeId' in target ? data.nodes.some((node) => node.id === target.nodeId) : 'edgeId' in target ? edgeIds.has(target.edgeId) : groupIds.has(target.groupId);
    if (!known) throw new NormalizeError('invalid-membership', `callouts[${callout.id}].target`, `callout '${callout.id}' names an unknown target`, 'name a node, edge or group of this diagram');
    if ('groupId' in target && options.flow === 'lanes' && data.groups.find((group) => group.id === target.groupId)?.kind !== 'policy' && !data.nodes.some((node) => node.groupId === target.groupId)) {
      throw new NormalizeError('invalid-membership', `callouts[${callout.id}].target`, `callout '${callout.id}' targets empty zone '${target.groupId}', which has no frame in flow 'lanes'`, `add a node to zone '${target.groupId}', or choose another target`);
    }
    const targetKey = 'nodeId' in target ? `node:${target.nodeId}` : 'edgeId' in target ? `edge:${target.edgeId}` : `group:${target.groupId}`;
    if (calloutTargets.has(targetKey)) throw new NormalizeError('invalid-membership', `callouts[${callout.id}].target`, `callout '${callout.id}' targets a node, edge or zone that already has a callout`, 'merge the callout text into one callout');
    calloutTargets.add(targetKey);
  }
}

function validatePreset(data: NormalizedDiagram, options: DiagramOptions, authoredNodes: DiagramNode[]): void {
  if (options.variant === 'architecture') {
    validateArchitecture(data, options);
    return;
  }
  const architectureOnly = data.nodes.find((node) => node.track !== undefined || node.span !== undefined || node.repeat !== undefined || node.protected !== undefined || node.shape.kind === 'store')?.id
    ?? data.edges.find((edge) => edge.flow !== undefined)?.id
    ?? data.groups.find((group) => group.kind !== undefined || group.parentId !== undefined || group.protected !== undefined)?.id
    ?? (data.channels.length > 0 ? 'channels' : data.callouts.length > 0 ? 'callouts' : undefined);
  if (architectureOnly !== undefined) {
    throw new NormalizeError('invalid-membership', architectureOnly, `track, span, repeat, protected, shape store, edge flow, group kind, parentId, channels and callouts are read only by variant 'architecture', not '${options.variant}'`, "remove them, or set options.variant to 'architecture'");
  }
  const looped = data.edges.find((edge) => edge.source.nodeId === edge.target.nodeId);
  if (looped) throw new NormalizeError('invalid-membership', `edges[${looped.id}]`, `self-loops are read only by variant 'architecture', not '${options.variant}'`, 'remove the edge');
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
