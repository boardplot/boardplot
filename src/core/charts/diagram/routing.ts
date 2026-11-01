import { strokeToken, dashToken } from '../../theme';
import type { Theme } from '../../types/theme';
import { boundsOf, inflate, rectCenter, type Point, type Rect } from '../../geometry';
import type {
  DiagramEdge,
  DiagramNode,
  DiagramPort,
  ResolvedDiagramEdge,
  ResolvedDiagramEndpoint,
  ResolvedDiagramPort,
} from '../../types/diagram';
import type { LintWarning, Paint, SceneNode } from '../../types/scene';
import { compareDiagramIds, diagramSceneId } from './ids';
import type { FixedRoute } from './orgChart';
import {
  edgeOwner,
  type DiagramPalette,
  pathBounds,
  polylinePath,
  q,
  qPoint,
  segmentBounds,
} from './primitives';
import { pushAll } from '../../arrays';

interface RouteDiagramInput {
  preset: string;
  nodes: readonly DiagramNode[];
  nodeRects: ReadonlyMap<string, Rect>;
  edges: readonly DiagramEdge[];
  plot: Rect;
  clearance: number;
  labelSizes: ReadonlyMap<string, { width: number; height: number }>;
  reserved: readonly Rect[];
  palette: DiagramPalette;
  /** Routes a preset drew itself (the compact org chart): used as given. */
  fixedRoutes?: ReadonlyMap<string, FixedRoute>;
  /** The paint of an edge without its own role, in place of the leader. */
  edgePaint?: Paint;
}

interface RouteDiagramResult {
  edges: ResolvedDiagramEdge[];
  scene: SceneNode[];
  warnings: LintWarning[];
  portsByNode: Map<string, ResolvedDiagramPort[]>;
  labelBoxes: Map<string, Rect>;
  claims: Array<{ rect: Rect; edgeId: string; part: string }>;
}

interface PortCandidate {
  port: ResolvedDiagramPort;
  explicit: boolean;
}

interface CandidateRoute {
  points: Point[];
  bends: number;
  crossings: number;
  length: number;
}

/** One edge's obstacles are fixed across all of its port pairs and routes. */
class RouteObstacles {
  private readonly horizontal = new Map<number, readonly Rect[]>();
  private readonly vertical = new Map<number, readonly Rect[]>();
  private readonly pointRows = new Map<number, readonly Rect[]>();

  constructor(readonly rects: readonly Rect[]) {}

  contains(point: Point): boolean {
    let row = this.pointRows.get(point.y);
    if (!row) {
      row = this.rects.filter(rect => point.y > rect.y && point.y < rect.y + rect.h);
      this.pointRows.set(point.y, row);
    }
    return row.some(rect => pointInsideOpenRect(point, rect));
  }

  blocks(a: Point, b: Point): boolean {
    const horizontal = a.y === b.y;
    if (!horizontal && a.x !== b.x) {
      return this.rects.some(rect => segmentIntersectsOpenRect(a, b, rect));
    }
    const index = horizontal ? this.horizontal : this.vertical;
    const coordinate = horizontal ? a.y : a.x;
    let candidates = index.get(coordinate);
    if (!candidates) {
      candidates = this.rects.filter(rect => {
        const start = (horizontal ? rect.y : rect.x) + 1e-6;
        const span = Math.max(0, (horizontal ? rect.h : rect.w) - 2e-6);
        // Match the parallel-axis checks in segmentIntersectsOpenRect,
        // including its epsilon and zero-width rectangle behavior.
        return !(coordinate - start < 0 || start + span - coordinate < 0);
      });
      index.set(coordinate, candidates);
    }
    return candidates.some(rect => segmentIntersectsOpenRect(a, b, rect));
  }
}

export function routeDiagramEdges(theme: Theme, input: RouteDiagramInput): RouteDiagramResult {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const portsByNode = new Map<string, ResolvedDiagramPort[]>();
  const warnings: LintWarning[] = [];
  const resolved: ResolvedDiagramEdge[] = [];
  const scene: SceneNode[] = [];
  const claims: RouteDiagramResult['claims'] = [];
  const labelBoxes = new Map<string, Rect>();
  const acceptedSegments: Array<{ edgeId: string; from: Point; to: Point }> = [];
  const used = new Map<string, number>();
  const reserved = [...input.reserved];

  for (const edge of [...input.edges].sort((a, b) => compareDiagramIds(a.id, b.id))) {
    const sourceNode = nodeById.get(edge.source.nodeId)!;
    const targetNode = nodeById.get(edge.target.nodeId)!;
    const sourceRect = input.nodeRects.get(sourceNode.id)!;
    const targetRect = input.nodeRects.get(targetNode.id)!;
    const sourceCandidates = endpointCandidates(sourceNode, sourceRect, edge.source.portId, 'source', used);
    const targetCandidates = endpointCandidates(targetNode, targetRect, edge.target.portId, 'target', used);
    const requested = edge.routing ?? 'orthogonal';
    const fixed = input.fixedRoutes?.get(edge.id);
    if (fixed) {
      const points = fixed.points;
      const start = points[0]!;
      const end = points.at(-1)!;
      const at = (side: 'top' | 'bottom' | 'left' | 'right', point: Point, rect: Rect) => ({
        side, offset: side === 'left' || side === 'right' ? (point.y - rect.y) / rect.h : (point.x - rect.x) / rect.w,
      });
      const sourcePort = resolvePort(sourceNode.id, sourceRect, { id: 'auto:org-out', at: at(fixed.sourceSide ?? 'bottom', start, sourceRect), intent: 'out' }, true);
      const targetPort = resolvePort(targetNode.id, targetRect, { id: 'auto:org-in', at: at(fixed.targetSide, end, targetRect), intent: 'in' }, true);
      const edgeResult: ResolvedDiagramEdge = {
        id: edge.id,
        source: endpoint({ ...sourcePort, point: start }, points[1] ?? end, input.clearance),
        target: endpoint({ ...targetPort, point: end }, points.at(-2) ?? start, input.clearance),
        requestedRouting: requested,
        actualRouting: requested,
        route: {
          kind: 'polyline',
          points,
          segments: points.slice(0, -1).map((from, index) => ({ from, to: points[index + 1]! })),
          bounds: pathBounds(points, strokeWidth(theme, edge)),
        },
        bends: countBends(points),
        crossings: 0,
        sceneNodeIds: [],
        ...(fixed.labelBox ? { labelBox: fixed.labelBox } : {}),
      };
      if (fixed.labelBox) labelBoxes.set(edge.id, fixed.labelBox);
      edgeResult.sceneNodeIds = emitRouteScene(theme, edge, edgeResult, scene, claims, input.clearance, warnings, input.palette, input.edgePaint);
      resolved.push(edgeResult);
      recordPorts({ ...sourcePort, point: start }, { ...targetPort, point: end }, portsByNode, used);
      continue;
    }

    if (input.preset === 'circular-process' && requested === 'curved') {
      const circular = circularRoute(
        edge,
        sourceCandidates[0]!,
        targetCandidates[0]!,
        sourceRect,
        targetRect,
        input.plot,
        input.clearance,
        input.reserved,
      );
      const arrowIds = emitRouteScene(
    theme,
        edge,
        circular,
        scene,
        claims,
        input.clearance,
        warnings,
        input.palette,
        input.edgePaint,
      );
      resolved.push({ ...circular, sceneNodeIds: arrowIds });
      recordPorts(sourceCandidates[0]!.port, targetCandidates[0]!.port, portsByNode, used);
      continue;
    }

    const hard = input.nodes.map((node) => {
      const rect = input.nodeRects.get(node.id)!;
      return node.id === sourceNode.id || node.id === targetNode.id
        ? rect
        : inflate(rect, input.clearance);
    });
    pushAll(hard, reserved.map((rect) => inflate(rect, input.clearance / 2)));
    const obstacles = new RouteObstacles(hard);
    // Every port pair uses the same obstacle channels. Equal snapped
    // coordinates produce identical candidates, so keep only the first.
    const channels = {
      x: [...new Set([input.plot.x + input.clearance, input.plot.x + input.plot.w - input.clearance,
        ...hard.flatMap(rect => [rect.x, rect.x + rect.w])].map(q))],
      y: [...new Set([input.plot.y + input.clearance, input.plot.y + input.plot.h - input.clearance,
        ...hard.flatMap(rect => [rect.y, rect.y + rect.h])].map(q))],
    };

    let best:
      | {
          candidate: CandidateRoute;
          source: PortCandidate;
          target: PortCandidate;
          degraded: boolean;
          selectionCost: number;
          automaticCount: number;
        }
      | undefined;
    for (const source of sourceCandidates) {
      for (const target of targetCandidates) {
        const candidate = routePair(
          input.preset,
          requested,
          source.port,
          target.port,
          edge,
          obstacles,
          input.plot,
          input.clearance,
          acceptedSegments,
          channels,
        );
        if (!candidate) continue;
        const degraded =
          requested === 'curved' ||
          (requested === 'straight' && candidate.bends > 0) ||
          (requested === 'elbow' && candidate.bends > 1);
        const selectionCost =
          routeCost(candidate) +
          endpointDirectionCost(
            source.port,
            target.port,
            sourceRect,
            targetRect,
            input.clearance,
          );
        const automaticCount = Number(!source.explicit) + Number(!target.explicit);
        if (
          !best ||
          selectionCost < best.selectionCost ||
          (selectionCost === best.selectionCost &&
            (candidate.bends < best.candidate.bends ||
              (candidate.bends === best.candidate.bends &&
                (candidate.crossings < best.candidate.crossings ||
                  (candidate.crossings === best.candidate.crossings &&
                    (automaticCount < best.automaticCount ||
                      (automaticCount === best.automaticCount &&
                        (compareDiagramIds(
                          serializePoints(candidate.points),
                          serializePoints(best.candidate.points),
                        ) < 0 ||
                          (serializePoints(candidate.points) ===
                            serializePoints(best.candidate.points) &&
                            `${source.port.portId}\u0000${target.port.portId}` <
                              `${best.source.port.portId}\u0000${best.target.port.portId}`)))))))))
        ) {
          best = {
            candidate,
            source,
            target,
            degraded,
            selectionCost,
            automaticCount,
          };
        }
      }
    }

    if (!best) {
      warnings.push({
        code: 'diagram-route-unresolved',
        severity: 'error',
        message: `edge '${edge.id}' has no obstacle-safe route`,
        owner: edgeOwner(edge.id),
      });
      continue;
    }
    if (best.degraded) {
      warnings.push({
        code: 'diagram-route-degraded',
        severity: 'warn',
        message: `edge '${edge.id}' requested ${requested} routing and used orthogonal routing to preserve clearance`,
        owner: edgeOwner(edge.id),
      });
    }
    for (const [end, selected, candidates] of [
      ['source', best.source, sourceCandidates],
      ['target', best.target, targetCandidates],
    ] as const) {
      if (selected.explicit || !candidates.some((candidate) => candidate.explicit)) continue;
      warnings.push({
        code: 'diagram-port-degraded',
        severity: 'warn',
        message: `edge '${edge.id}' used an automatic ${end} port because no authored candidate produced the safest route`,
        owner: edgeOwner(edge.id),
      });
    }
    if (best.candidate.crossings > 0) {
      warnings.push({
        code: 'diagram-edge-crossing',
        severity: 'warn',
        message: `edge '${edge.id}' has ${best.candidate.crossings} unavoidable crossing${best.candidate.crossings === 1 ? '' : 's'}`,
        owner: edgeOwner(edge.id),
      });
    }

    const points = simplify(best.candidate.points);
    const sourceEndpoint = endpoint(
      best.source.port,
      points[1] ?? points[0]!,
      edge.arrowStart ? 3 * input.clearance : input.clearance,
    );
    const targetEndpoint = endpoint(
      best.target.port,
      points[points.length - 2] ?? points[points.length - 1]!,
      edge.arrowEnd ? 3 * input.clearance : input.clearance,
    );
    const route = {
      kind: 'polyline' as const,
      points,
      segments: points.slice(0, -1).map((from, index) => ({ from, to: points[index + 1]! })),
      bounds: pathBounds(points, strokeWidth(theme, edge)),
    };
    const edgeResult: ResolvedDiagramEdge = {
      id: edge.id,
      source: sourceEndpoint,
      target: targetEndpoint,
      requestedRouting: requested,
      actualRouting: best.degraded ? 'orthogonal' : requested,
      route,
      bends: countBends(points),
      crossings: countCrossings(points, acceptedSegments),
      sceneNodeIds: [],
    };
    const labelSize = edge.label ? input.labelSizes.get(edge.id) : undefined;
    if (edge.label && labelSize) {
      const labelBox = chooseEdgeLabelBox(points, labelSize, hard, reserved, input.plot, input.clearance);
      if (labelBox) {
        edgeResult.labelBox = labelBox;
        labelBoxes.set(edge.id, labelBox);
        reserved.push(labelBox);
      } else {
        warnings.push({
          code: 'diagram-edge-label-unplaced',
          severity: 'warn',
          message: `edge label '${edge.label}' on '${edge.id}' has no collision-free candidate`,
          owner: edgeOwner(edge.id),
        });
      }
    }
    edgeResult.sceneNodeIds = emitRouteScene(
    theme,
      edge,
      edgeResult,
      scene,
      claims,
      input.clearance,
      warnings,
      input.palette,
    );
    resolved.push(edgeResult);
    if (edgeResult.route.kind === 'polyline') {
      edgeResult.route.segments.forEach((segment) =>
        acceptedSegments.push({ edgeId: edge.id, from: segment.from, to: segment.to }),
      );
    }
    recordPorts(best.source.port, best.target.port, portsByNode, used);
  }

  for (const ports of portsByNode.values()) {
    ports.forEach((port) => {
      port.used = used.get(portKey(port)) ?? 0;
    });
    ports.sort((a, b) => compareDiagramIds(a.portId, b.portId));
  }
  return { edges: resolved, scene, warnings, portsByNode, labelBoxes, claims };
}

function endpointCandidates(
  node: DiagramNode,
  rect: Rect,
  portId: string | undefined,
  end: 'source' | 'target',
  used: ReadonlyMap<string, number>,
): PortCandidate[] {
  const authored = (node.ports ?? [])
    .filter((port) => !portId || port.id === portId)
    .filter((port) => (end === 'source' ? port.intent !== 'in' : port.intent !== 'out'))
    .filter((port) => port.capacity === undefined || (used.get(`${node.id}\u0000${port.id}`) ?? 0) < port.capacity)
    .map((port) => ({ port: resolvePort(node.id, rect, port, false), explicit: true }));
  if (portId) return authored;
  const automatic = (['top', 'right', 'bottom', 'left'] as const).map((side) => ({
    port: resolvePort(
      node.id,
      rect,
      { id: `auto:${side}`, at: { side }, intent: 'bidi' },
      true,
    ),
    explicit: false,
  }));
  return authored.length > 0 ? [...authored, ...automatic] : automatic;
}

function resolvePort(
  nodeId: string,
  rect: Rect,
  source: DiagramPort,
  automatic: boolean,
): ResolvedDiagramPort {
  let point: Point;
  let normal: Point;
  if ('side' in source.at) {
    const offset = source.at.offset ?? 0.5;
    switch (source.at.side) {
      case 'top':
        point = { x: rect.x + rect.w * offset, y: rect.y };
        normal = { x: 0, y: -1 };
        break;
      case 'right':
        point = { x: rect.x + rect.w, y: rect.y + rect.h * offset };
        normal = { x: 1, y: 0 };
        break;
      case 'bottom':
        point = { x: rect.x + rect.w * offset, y: rect.y + rect.h };
        normal = { x: 0, y: 1 };
        break;
      case 'left':
        point = { x: rect.x, y: rect.y + rect.h * offset };
        normal = { x: -1, y: 0 };
        break;
    }
  } else {
    const perimeter = ((source.at.perimeter % 1) + 1) % 1;
    const distance = perimeter * 2 * (rect.w + rect.h);
    if (distance <= rect.w) {
      point = { x: rect.x + rect.w / 2 + distance, y: rect.y };
      normal = { x: 0, y: -1 };
    } else if (distance <= rect.w + rect.h) {
      point = { x: rect.x + rect.w, y: rect.y + distance - rect.w };
      normal = { x: 1, y: 0 };
    } else if (distance <= 2 * rect.w + rect.h) {
      point = { x: rect.x + rect.w - (distance - rect.w - rect.h), y: rect.y + rect.h };
      normal = { x: 0, y: 1 };
    } else {
      point = { x: rect.x, y: rect.y + rect.h - (distance - 2 * rect.w - rect.h) };
      normal = { x: -1, y: 0 };
    }
  }
  return {
    nodeId,
    portId: source.id,
    automatic,
    point: qPoint(point),
    normal,
    intent: source.intent ?? 'bidi',
    capacity: source.capacity,
    used: 0,
  };
}

function routePair(
  preset: string,
  requested: NonNullable<DiagramEdge['routing']>,
  source: ResolvedDiagramPort,
  target: ResolvedDiagramPort,
  edge: DiagramEdge,
  obstacles: RouteObstacles,
  plot: Rect,
  clearance: number,
  accepted: readonly { edgeId: string; from: Point; to: Point }[],
  channels: { x: readonly number[]; y: readonly number[] },
): CandidateRoute | undefined {
  const sourceEscape = qPoint({
    x: source.point.x + source.normal.x * clearance * (edge.arrowStart ? 3 : 1),
    y: source.point.y + source.normal.y * clearance * (edge.arrowStart ? 3 : 1),
  });
  const targetEscape = qPoint({
    x: target.point.x + target.normal.x * clearance * (edge.arrowEnd ? 3 : 1),
    y: target.point.y + target.normal.y * clearance * (edge.arrowEnd ? 3 : 1),
  });
  // Every simple candidate contains these stubs (simplify can only merge
  // collinear segments). Keep the grid fallback's existing stub semantics.
  if (!routeClear([source.point, sourceEscape], obstacles, plot) ||
    !routeClear([targetEscape, target.point], obstacles, plot)) {
    return visibilityGridRoute(source.point, target.point, sourceEscape, targetEscape, obstacles, plot, clearance, accepted);
  }
  const waypoints = (edge.waypoints ?? []).map((point) =>
    qPoint({ x: plot.x + point.x * plot.w, y: plot.y + point.y * plot.h }),
  );

  const special =
    edge.waypoints?.length || !['hierarchy', 'issue-tree'].includes(preset)
      ? undefined
      : preset === 'hierarchy'
        ? hierarchyCandidate(source, target, sourceEscape, targetEscape)
        : issueTreeCandidate(source, target, sourceEscape, targetEscape);
  const candidateBodies: Point[][] = [];
  if (special) candidateBodies.push(special);
  if (requested === 'straight') candidateBodies.push([sourceEscape, targetEscape]);
  candidateBodies.push(
    [sourceEscape, { x: targetEscape.x, y: sourceEscape.y }, targetEscape],
    [sourceEscape, { x: sourceEscape.x, y: targetEscape.y }, targetEscape],
  );

  channels.x.forEach((x) =>
    candidateBodies.push([
      sourceEscape,
      { x: q(x), y: sourceEscape.y },
      { x: q(x), y: targetEscape.y },
      targetEscape,
    ]),
  );
  channels.y.forEach((y) =>
    candidateBodies.push([
      sourceEscape,
      { x: sourceEscape.x, y: q(y) },
      { x: targetEscape.x, y: q(y) },
      targetEscape,
    ]),
  );

  const routeBodies =
    waypoints.length === 0
      ? candidateBodies
      : routeThroughWaypoints(sourceEscape, targetEscape, waypoints, obstacles, plot);
  let best: CandidateRoute | undefined;
  for (const body of routeBodies) {
    const points = simplify([source.point, ...body, target.point].map(qPoint));
    const bends = countBends(points);
    const length = routeLength(points);
    // Crossings only add cost. A strictly worse lower bound cannot win,
    // including any of the existing tie-breaks.
    if (best && length + bends * 32 > routeCost(best)) continue;
    if (!routeClear(points, obstacles, plot)) continue;
    const candidate = { points, bends, length, crossings: countCrossings(points, accepted) };
    if (!best || compareRoute(candidate, best, source.portId, target.portId) < 0) best = candidate;
  }
  return best ?? visibilityGridRoute(source.point, target.point, sourceEscape, targetEscape, obstacles, plot, clearance, accepted);
}

function hierarchyCandidate(
  source: ResolvedDiagramPort,
  target: ResolvedDiagramPort,
  sourceEscape: Point,
  targetEscape: Point,
): Point[] {
  const y = q((source.point.y + target.point.y) / 2);
  return [sourceEscape, { x: sourceEscape.x, y }, { x: targetEscape.x, y }, targetEscape];
}

function issueTreeCandidate(
  source: ResolvedDiagramPort,
  target: ResolvedDiagramPort,
  sourceEscape: Point,
  targetEscape: Point,
): Point[] {
  const x = q((source.point.x + target.point.x) / 2);
  return [sourceEscape, { x, y: sourceEscape.y }, { x, y: targetEscape.y }, targetEscape];
}

function routeThroughWaypoints(
  start: Point,
  end: Point,
  waypoints: readonly Point[],
  obstacles: RouteObstacles,
  plot: Rect,
): Point[][] {
  let routes: Point[][] = [[start]];
  const stops = [...waypoints, end];
  for (const stop of stops) {
    const next: Point[][] = [];
    for (const route of routes) {
      const from = route[route.length - 1]!;
      const legs = [
        [from, { x: stop.x, y: from.y }, stop],
        [from, { x: from.x, y: stop.y }, stop],
      ];
      for (const leg of legs) {
        if (routeClear(leg, obstacles, plot)) next.push([...route.slice(0, -1), ...leg]);
      }
    }
    routes = next;
    if (routes.length === 0) return [];
  }
  return routes;
}

function visibilityGridRoute(
  source: Point,
  target: Point,
  sourceEscape: Point,
  targetEscape: Point,
  obstacles: RouteObstacles,
  plot: Rect,
  clearance: number,
  accepted: readonly { edgeId: string; from: Point; to: Point }[],
): CandidateRoute | undefined {
  // These exact points must be vertices. Test them before constructing the
  // grid: a missing endpoint makes the search fail regardless of its edges.
  if ([sourceEscape, targetEscape].some(point =>
    !pointInPlot(point, plot) || obstacles.contains(point))) return undefined;
  const xs = uniqueSorted([
    sourceEscape.x,
    targetEscape.x,
    plot.x + clearance,
    plot.x + plot.w - clearance,
    ...obstacles.rects.flatMap((rect) => [rect.x, rect.x + rect.w]),
  ]);
  const ys = uniqueSorted([
    sourceEscape.y,
    targetEscape.y,
    plot.y + clearance,
    plot.y + plot.h - clearance,
    ...obstacles.rects.flatMap((rect) => [rect.y, rect.y + rect.h]),
  ]);
  const vertices: Point[] = [];
  const index = new Map<string, number>();
  ys.forEach((y) =>
    xs.forEach((x) => {
      const point = { x, y };
      if (!pointInPlot(point, plot) || obstacles.contains(point)) return;
      index.set(pointKey(point), vertices.length);
      vertices.push(point);
    }),
  );
  const startIndex = index.get(pointKey(sourceEscape));
  const endIndex = index.get(pointKey(targetEscape));
  if (startIndex === undefined || endIndex === undefined) return undefined;
  const neighbors = new Map<number, number[]>();
  for (let yi = 0; yi < ys.length; yi++) {
    const row = xs.flatMap((x) => {
      const value = index.get(pointKey({ x, y: ys[yi]! }));
      return value === undefined ? [] : [value];
    });
    connectVisible(row, vertices, obstacles, neighbors);
  }
  for (let xi = 0; xi < xs.length; xi++) {
    const column = ys.flatMap((y) => {
      const value = index.get(pointKey({ x: xs[xi]!, y }));
      return value === undefined ? [] : [value];
    });
    connectVisible(column, vertices, obstacles, neighbors);
  }
  // Order the search by cost, then serialized path, for deterministic routes.
  // Cache each path key on push and use a heap to avoid sorting the queue
  // and serializing paths on every comparison.
  const queue = new GridSearchHeap();
  queue.push({ node: startIndex, direction: source.x === sourceEscape.x ? 'v' : 'h', cost: 0, path: [startIndex], key: serializeIndices([startIndex]) });
  const best = new Map<string, number>();
  for (let current = queue.pop(); current; current = queue.pop()) {
    const stateKey = `${current.node}:${current.direction}`;
    if ((best.get(stateKey) ?? Infinity) <= current.cost) continue;
    best.set(stateKey, current.cost);
    if (current.node === endIndex) {
      return scoreRoute(
        [source, ...current.path.map((value) => vertices[value]!), target].map(qPoint),
        accepted,
      );
    }
    for (const neighbor of neighbors.get(current.node) ?? []) {
      const a = vertices[current.node]!;
      const b = vertices[neighbor]!;
      // Neither escape stub may double back towards its node before turning.
      if (current.node === startIndex && (b.x - a.x) * (sourceEscape.x - source.x) + (b.y - a.y) * (sourceEscape.y - source.y) < 0) continue;
      if (neighbor === endIndex && (a.x - b.x) * (targetEscape.x - target.x) + (a.y - b.y) * (targetEscape.y - target.y) < 0) continue;
      const direction = a.x === b.x ? 'v' : 'h';
      const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      const bend = current.direction !== 'none' && current.direction !== direction ? 8 * clearance : 0;
      const path = [...current.path, neighbor];
      queue.push({
        node: neighbor,
        direction,
        cost: current.cost + length + bend,
        path,
        key: serializeIndices(path),
      });
    }
  }
  return undefined;
}

interface GridSearchEntry {
  node: number;
  direction: 'h' | 'v' | 'none';
  cost: number;
  path: number[];
  /** serializeIndices(path) — the deterministic tie-break, serialized once. */
  key: string;
}

/** Min-heap on (cost, key); distinct paths give a strict total order. */
class GridSearchHeap {
  private readonly entries: GridSearchEntry[] = [];

  push(entry: GridSearchEntry): void {
    const entries = this.entries;
    entries.push(entry);
    let index = entries.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (compareGridEntries(entries[index]!, entries[parent]!) >= 0) break;
      [entries[index], entries[parent]] = [entries[parent]!, entries[index]!];
      index = parent;
    }
  }

  pop(): GridSearchEntry | undefined {
    const entries = this.entries;
    if (entries.length === 0) return undefined;
    const top = entries[0]!;
    const last = entries.pop()!;
    if (entries.length > 0) {
      entries[0] = last;
      let index = 0;
      for (;;) {
        const left = 2 * index + 1;
        const right = left + 1;
        let smallest = index;
        if (left < entries.length && compareGridEntries(entries[left]!, entries[smallest]!) < 0) smallest = left;
        if (right < entries.length && compareGridEntries(entries[right]!, entries[smallest]!) < 0) smallest = right;
        if (smallest === index) break;
        [entries[index], entries[smallest]] = [entries[smallest]!, entries[index]!];
        index = smallest;
      }
    }
    return top;
  }
}

const compareGridEntries = (a: GridSearchEntry, b: GridSearchEntry): number =>
  a.cost - b.cost || compareDiagramIds(a.key, b.key);

function connectVisible(
  ordered: readonly number[],
  vertices: readonly Point[],
  obstacles: RouteObstacles,
  neighbors: Map<number, number[]>,
): void {
  for (let index = 0; index < ordered.length - 1; index++) {
    const a = ordered[index]!;
    const b = ordered[index + 1]!;
    if (obstacles.blocks(vertices[a]!, vertices[b]!)) continue;
    neighbors.set(a, [...(neighbors.get(a) ?? []), b]);
    neighbors.set(b, [...(neighbors.get(b) ?? []), a]);
  }
}

function circularRoute(
  edge: DiagramEdge,
  source: PortCandidate,
  target: PortCandidate,
  sourceRect: Rect,
  targetRect: Rect,
  plot: Rect,
  clearance: number,
  reserved: readonly Rect[],
): ResolvedDiagramEdge {
  const centre = rectCenter(plot);
  const sourceCentre = rectCenter(sourceRect);
  const targetCentre = rectCenter(targetRect);
  let a = Math.atan2(sourceCentre.y - centre.y, sourceCentre.x - centre.x);
  let b = Math.atan2(targetCentre.y - centre.y, targetCentre.x - centre.x);
  while (b <= a) b += Math.PI * 2;
  const mid = (a + b) / 2;
  const baseRadius =
    Math.max(
      Math.hypot(sourceCentre.x - centre.x, sourceCentre.y - centre.y),
      Math.hypot(targetCentre.x - centre.x, targetCentre.y - centre.y),
    ) +
    4 * clearance;
  let control = qPoint({
    x: centre.x + Math.cos(mid) * baseRadius,
    y: centre.y + Math.sin(mid) * baseRadius,
  });
  let start = pointOnRectToward(sourceRect, control);
  let end = pointOnRectToward(targetRect, control);
  for (let step = 0; step <= 8; step++) {
    const radius = baseRadius + step * 2 * clearance;
    const candidateControl = qPoint({
      x: centre.x + Math.cos(mid) * radius,
      y: centre.y + Math.sin(mid) * radius,
    });
    const candidateStart = pointOnRectToward(sourceRect, candidateControl);
    const candidateEnd = pointOnRectToward(targetRect, candidateControl);
    const points = sampleQuadratic([candidateStart, candidateControl, candidateEnd]);
    const clear =
      points.every((point) => pointInPlot(point, plot)) &&
      reserved.every((rect) => !routeIntersectsRect(points, rect));
    if (!clear) continue;
    control = candidateControl;
    start = candidateStart;
    end = candidateEnd;
    break;
  }
  const d = `M${q(start.x)} ${q(start.y)}Q${q(control.x)} ${q(control.y)} ${q(end.x)} ${q(end.y)}`;
  const bounds = boundsOf([start, control, end].map((point) => ({ x: point.x, y: point.y, w: 0, h: 0 })));
  return {
    id: edge.id,
    source: endpoint({ ...source.port, point: start }, control, clearance),
    target: endpoint({ ...target.port, point: end }, control, clearance),
    requestedRouting: 'curved',
    actualRouting: 'curved',
    route: { kind: 'path', d, controlPoints: [start, control, end], bounds },
    bends: 0,
    crossings: 0,
    sceneNodeIds: [],
  };
}

function emitRouteScene(
  theme: Theme,
  edge: DiagramEdge,
  resolved: ResolvedDiagramEdge,
  scene: SceneNode[],
  claims: RouteDiagramResult['claims'],
  clearance: number,
  warnings: LintWarning[],
  palette: DiagramPalette,
  plainPaint: Paint = { token: 'leader' },
): string[] {
  const ids: string[] = [];
  const shaftId = diagramSceneId('edge', edge.id);
  const width = strokeWidth(theme, edge);
  const dash = edgeDash(theme, edge.dash);
  // A role paints the edge as it paints a node; secondary and muted,
  // the grey roles, and no role draw the plain leader.
  const paint: Paint = edge.role === undefined || edge.role === 'secondary' || edge.role === 'muted'
    ? plainPaint
    : palette.paint(edge.role, edge.paletteKey);
  if (resolved.route.kind === 'path') {
    scene.push({
      t: 'path',
      id: shaftId,
      d: resolved.route.d,
      stroke: paint,
      width,
      dash,
      lineCap: edge.dash === 'dotted' ? 'round' : 'butt',
      owner: edgeOwner(edge.id),
      part: 'diagramEdge',
    });
    sampleQuadratic(resolved.route.controlPoints).forEach((point, index, points) => {
      const next = points[index + 1];
      if (next) {
        claims.push({
          rect: segmentBounds(point, next, width),
          edgeId: edge.id,
          part: 'diagramEdge',
        });
      }
    });
  } else {
    scene.push({
      t: 'path',
      id: shaftId,
      d: polylinePath(resolved.route.points),
      stroke: paint,
      width,
      dash,
      lineCap: edge.dash === 'dotted' ? 'round' : 'butt',
      owner: edgeOwner(edge.id),
      part: 'diagramEdge',
    });
    resolved.route.segments.forEach((segment) =>
      claims.push({ rect: segmentBounds(segment.from, segment.to, width), edgeId: edge.id, part: 'diagramEdge' }),
    );
  }
  ids.push(shaftId);
  if (edge.arrowEnd) {
    const arrow = arrowScene(edge, resolved, false, clearance, paint);
    if (arrow) {
      scene.push(arrow);
      ids.push(arrow.id);
    } else {
      warnings.push({
        code: 'diagram-arrowhead-unplaced',
        severity: 'warn',
        message: `edge '${edge.id}' omitted its end arrow because the terminal segment is too short`,
        owner: edgeOwner(edge.id),
      });
    }
  }
  if (edge.arrowStart) {
    const arrow = arrowScene(edge, resolved, true, clearance, paint);
    if (arrow) {
      scene.push(arrow);
      ids.push(arrow.id);
    } else {
      warnings.push({
        code: 'diagram-arrowhead-unplaced',
        severity: 'warn',
        message: `edge '${edge.id}' omitted its start arrow because the terminal segment is too short`,
        owner: edgeOwner(edge.id),
      });
    }
  }
  return ids;
}

function sampleQuadratic(controlPoints: readonly Point[]): Point[] {
  if (controlPoints.length !== 3) return [...controlPoints];
  const [start, control, end] = controlPoints;
  return Array.from({ length: 17 }, (_, index) => {
    const t = index / 16;
    const inverse = 1 - t;
    return qPoint({
      x: inverse * inverse * start!.x + 2 * inverse * t * control!.x + t * t * end!.x,
      y: inverse * inverse * start!.y + 2 * inverse * t * control!.y + t * t * end!.y,
    });
  });
}

function arrowScene(
  edge: DiagramEdge,
  resolved: ResolvedDiagramEdge,
  atStart: boolean,
  clearance: number,
  fill: Paint,
): SceneNode | undefined {
  const points =
    resolved.route.kind === 'polyline'
      ? resolved.route.points
      : resolved.route.controlPoints;
  if (points.length < 2) return undefined;
  const tip = atStart ? points[0]! : points[points.length - 1]!;
  const previous = atStart ? points[1]! : points[points.length - 2]!;
  const dx = tip.x - previous.x;
  const dy = tip.y - previous.y;
  const length = Math.hypot(dx, dy);
  if (length < 3 * clearance) return undefined;
  const arrowLength = 3 * clearance;
  const arrowWidth = 2 * clearance;
  const ux = dx / length;
  const uy = dy / length;
  const bx = tip.x - ux * arrowLength;
  const by = tip.y - uy * arrowLength;
  const px = -uy * arrowWidth / 2;
  const py = ux * arrowWidth / 2;
  return {
    t: 'path',
    id: diagramSceneId('arrow', edge.id, atStart ? 'start' : 'end'),
    d:
      `M${q(tip.x)} ${q(tip.y)}` +
      `L${q(bx + px)} ${q(by + py)}` +
      `L${q(bx - px)} ${q(by - py)}Z`,
    fill,
    owner: edgeOwner(edge.id),
    part: 'diagramArrow',
  };
}

function chooseEdgeLabelBox(
  points: readonly Point[],
  size: { width: number; height: number },
  hard: readonly Rect[],
  reserved: readonly Rect[],
  plot: Rect,
  clearance: number,
): Rect | undefined {
  const segments = points
    .slice(0, -1)
    .map((from, index) => ({ from, to: points[index + 1]! }))
    .sort(
      (a, b) =>
        Math.hypot(b.to.x - b.from.x, b.to.y - b.from.y) -
        Math.hypot(a.to.x - a.from.x, a.to.y - a.from.y),
    );
  for (const segment of segments) {
    const centre = {
      x: (segment.from.x + segment.to.x) / 2,
      y: (segment.from.y + segment.to.y) / 2,
    };
    const candidates = [
      { x: centre.x - size.width / 2, y: centre.y - size.height - clearance, w: size.width, h: size.height },
      { x: centre.x - size.width / 2, y: centre.y + clearance, w: size.width, h: size.height },
    ].map((rect) => ({ x: q(rect.x), y: q(rect.y), w: q(rect.w), h: q(rect.h) }));
    const accepted = candidates.find(
      (rect) =>
        rect.x >= plot.x &&
        rect.y >= plot.y &&
        rect.x + rect.w <= plot.x + plot.w &&
        rect.y + rect.h <= plot.y + plot.h &&
        ![...hard, ...reserved].some((obstacle) => rectsOverlapOpen(rect, obstacle)),
    );
    if (accepted) return accepted;
  }
  return undefined;
}

function endpoint(port: ResolvedDiagramPort, toward: Point, clearance: number): ResolvedDiagramEndpoint {
  const dx = toward.x - port.point.x;
  const dy = toward.y - port.point.y;
  const length = Math.hypot(dx, dy) || 1;
  return {
    nodeId: port.nodeId,
    portId: port.portId,
    point: port.point,
    escapePoint: qPoint({
      x: port.point.x + (dx / length) * clearance,
      y: port.point.y + (dy / length) * clearance,
    }),
  };
}

function recordPorts(
  source: ResolvedDiagramPort,
  target: ResolvedDiagramPort,
  portsByNode: Map<string, ResolvedDiagramPort[]>,
  used: Map<string, number>,
): void {
  for (const port of [source, target]) {
    const key = portKey(port);
    used.set(key, (used.get(key) ?? 0) + 1);
    const ports = portsByNode.get(port.nodeId) ?? [];
    if (!ports.some((candidate) => candidate.portId === port.portId)) ports.push({ ...port });
    portsByNode.set(port.nodeId, ports);
  }
}

const portKey = (port: ResolvedDiagramPort): string => `${port.nodeId}\u0000${port.portId}`;

/** The dash an edge style draws; the diagram key draws the same. */
export function edgeDash(theme: Theme, style: DiagramEdge['dash']): number[] | undefined {
  return style === 'dotted' ? dashToken(theme, 'dotted') : style === 'dashed' ? dashToken(theme, 'reference') : undefined;
}

function strokeWidth(theme: Theme, edge: DiagramEdge): number {
  return strokeToken(theme, edge.weight === 'hairline' ? 'hair' : edge.weight === 'strong' ? 'focus' : 'rule');
}

function scoreRoute(
  points: Point[],
  accepted: readonly { edgeId: string; from: Point; to: Point }[],
): CandidateRoute {
  return {
    points,
    bends: countBends(points),
    crossings: countCrossings(points, accepted),
    length: routeLength(points),
  };
}

function routeLength(points: readonly Point[]): number {
  return points.slice(0, -1).reduce((sum, point, index) => {
    const next = points[index + 1]!;
    return sum + Math.hypot(next.x - point.x, next.y - point.y);
  }, 0);
}

function routeCost(route: CandidateRoute): number {
  return route.length + route.bends * 32 + route.crossings * 80;
}

function endpointDirectionCost(
  source: ResolvedDiagramPort,
  target: ResolvedDiagramPort,
  sourceRect: Rect,
  targetRect: Rect,
  clearance: number,
): number {
  const from = rectCenter(sourceRect);
  const to = rectCenter(targetRect);
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const direction = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
  const sourceDot = source.normal.x * direction.x + source.normal.y * direction.y;
  const targetDot = target.normal.x * -direction.x + target.normal.y * -direction.y;
  return (2 - sourceDot - targetDot) * 6 * clearance;
}

function compareRoute(a: CandidateRoute, b: CandidateRoute, sourcePort: string, targetPort: string): number {
  const costA = routeCost(a);
  const costB = routeCost(b);
  return (
    costA - costB ||
    a.bends - b.bends ||
    a.crossings - b.crossings ||
    compareDiagramIds(serializePoints(a.points), serializePoints(b.points)) ||
    compareDiagramIds(sourcePort, targetPort)
  );
}

function countBends(points: readonly Point[]): number {
  let bends = 0;
  for (let index = 1; index < points.length - 1; index++) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const c = points[index + 1]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) > 1e-9) bends++;
  }
  return bends;
}

function countCrossings(
  points: readonly Point[],
  accepted: readonly { edgeId: string; from: Point; to: Point }[],
): number {
  let count = 0;
  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index]!;
    const b = points[index + 1]!;
    for (const prior of accepted) {
      if (segmentsCrossInterior(a, b, prior.from, prior.to)) count++;
    }
  }
  return count;
}

function routeIntersectsRect(points: readonly Point[], rect: Rect): boolean {
  return points.slice(0, -1).some((from, index) => segmentIntersectsOpenRect(from, points[index + 1]!, rect));
}

export function simplify(points: readonly Point[]): Point[] {
  const deduped = points.filter(
    (point, index) => index === 0 || point.x !== points[index - 1]!.x || point.y !== points[index - 1]!.y,
  );
  const out: Point[] = [];
  for (let index = 0; index < deduped.length; index++) {
    const point = deduped[index]!;
    const a = out[out.length - 2];
    const b = out[out.length - 1];
    const preserveEndpointEscape = index <= 1 || index >= deduped.length - 2;
    const sameDirection =
      a &&
      b &&
      (b.x - a.x) * (point.x - b.x) + (b.y - a.y) * (point.y - b.y) > 0;
    if (
      !preserveEndpointEscape &&
      a &&
      b &&
      sameDirection &&
      ((a.x === b.x && b.x === point.x) || (a.y === b.y && b.y === point.y))
    ) {
      out[out.length - 1] = point;
    } else {
      out.push(point);
    }
  }
  return out;
}

function routeClear(points: readonly Point[], obstacles: RouteObstacles, plot: Rect): boolean {
  return (
    points.every((point) => pointInPlot(point, plot)) &&
    points
      .slice(0, -1)
      .every((from, index) => !obstacles.blocks(from, points[index + 1]!))
  );
}

function segmentIntersectsOpenRect(a: Point, b: Point, rect: Rect): boolean {
  const epsilon = 1e-6;
  const ix = rect.x + epsilon;
  const iy = rect.y + epsilon;
  const iw = Math.max(0, rect.w - 2 * epsilon);
  const ih = Math.max(0, rect.h - 2 * epsilon);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  // Liang-Barsky over the four edges, in the same order as before, without allocating.
  for (let edge = 0; edge < 4; edge++) {
    const p = edge === 0 ? -dx : edge === 1 ? dx : edge === 2 ? -dy : dy;
    const qValue = edge === 0 ? a.x - ix : edge === 1 ? ix + iw - a.x : edge === 2 ? a.y - iy : iy + ih - a.y;
    if (p === 0) {
      if (qValue < 0) return false;
      continue;
    }
    const ratio = qValue / p;
    if (p < 0) t0 = Math.max(t0, ratio);
    else t1 = Math.min(t1, ratio);
    if (t0 > t1) return false;
  }
  return t1 >= 0 && t0 <= 1 && t0 <= t1;
}

function pointInsideOpenRect(point: Point, rect: Rect): boolean {
  return point.x > rect.x && point.x < rect.x + rect.w && point.y > rect.y && point.y < rect.y + rect.h;
}

function pointInPlot(point: Point, plot: Rect): boolean {
  return (
    point.x >= plot.x &&
    point.y >= plot.y &&
    point.x <= plot.x + plot.w &&
    point.y <= plot.y + plot.h
  );
}

function rectsOverlapOpen(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function segmentsCrossInterior(a: Point, b: Point, c: Point, d: Point): boolean {
  const denominator = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(denominator) < 1e-9) return false;
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / denominator;
  const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / denominator;
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
}

function pointOnRectToward(rect: Rect, target: Point): Point {
  const centre = rectCenter(rect);
  const dx = target.x - centre.x;
  const dy = target.y - centre.y;
  const scale = 1 / Math.max(Math.abs(dx) / (rect.w / 2), Math.abs(dy) / (rect.h / 2), 1e-9);
  return qPoint({ x: centre.x + dx * scale, y: centre.y + dy * scale });
}

const pointKey = (point: Point): string => `${q(point.x)},${q(point.y)}`;
const uniqueSorted = (values: readonly number[]): number[] =>
  [...new Set(values.map(q))].sort((a, b) => a - b);
const serializePoints = (points: readonly Point[]): string =>
  points.map((point) => `${q(point.x)},${q(point.y)}`).join(';');
const serializeIndices = (indices: readonly number[]): string => indices.join(',');
