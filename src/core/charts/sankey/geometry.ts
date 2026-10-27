/**
 * Sankey geometry without text: columns, node order, node positions and
 * ribbon paths. Every step is deterministic: fixed round counts, stable sorts
 * with explicit tie-breaks, no randomness.
 *
 * A link that skips columns runs through one virtual node per skipped column
 * (a waypoint: no bar, no label, no record). The layout works on segments,
 * each between two adjacent columns, so a ribbon never passes through an
 * unrelated node and the crossing reduction sees it.
 */

/** One node of the layered graph. `first` is its rank in the shared id order, the last tie-break. */
export interface FlowNode {
  column: number;
  value: number;
  first: number;
  /** The Other bucket of its column: always drawn last. */
  other?: true;
  /** A waypoint of a long link. */
  virtual?: true;
}

/** A link between two nodes of the graph (any columns apart). */
export interface FlowLink {
  source: number;
  target: number;
  value: number;
  first: number;
}

/** Barycentre rounds; each round is one sweep forward and one back. */
const ORDER_ROUNDS = 4;
/** Relaxation rounds of the vertical positions; each round runs back, then forward. */
const RELAX_ROUNDS = 6;

/**
 * Columns from the graph: a node's column is its longest path from a node
 * without inflow. Nodes without outflow then move to the last column, so a
 * funnel's end sits at the right edge. The graph must be acyclic.
 */
export function graphColumns(count: number, links: readonly FlowLink[]): number[] {
  const into = Array.from({ length: count }, () => [] as number[]);
  const outCount = new Array<number>(count).fill(0);
  for (const link of links) { into[link.target]!.push(link.source); outCount[link.source]!++; }
  const column = new Array<number>(count).fill(-1);
  const depth = (node: number): number => {
    if (column[node]! >= 0) return column[node]!;
    let d = 0;
    for (const from of into[node]!) d = Math.max(d, depth(from) + 1);
    column[node] = d;
    return d;
  };
  for (let node = 0; node < count; node++) depth(node);
  const last = Math.max(0, ...column);
  return column.map((c, node) => (outCount[node] === 0 && into[node]!.length > 0 ? last : c));
}

/**
 * One cycle of the graph as node indices (the first node repeated at the end),
 * or undefined when the graph is acyclic. Depth-first in node order and link
 * order, so the cycle named is the same for the same input.
 */
export function findCycle(count: number, links: readonly FlowLink[]): number[] | undefined {
  const out = Array.from({ length: count }, () => [] as number[]);
  for (const link of [...links].sort((a, b) => a.first - b.first)) out[link.source]!.push(link.target);
  const state = new Array<number>(count).fill(0);
  const path: number[] = [];
  const visit = (node: number): number[] | undefined => {
    state[node] = 1;
    path.push(node);
    for (const next of out[node]!) {
      if (state[next] === 1) return [...path.slice(path.indexOf(next)), next];
      if (state[next] === 0) {
        const found = visit(next);
        if (found) return found;
      }
    }
    path.pop();
    state[node] = 2;
    return undefined;
  };
  for (let node = 0; node < count; node++) {
    if (state[node] !== 0) continue;
    const found = visit(node);
    if (found) return found;
  }
  return undefined;
}

/** The layered graph: the real nodes, then one virtual node per skipped column; segments join adjacent columns. */
export interface Layered {
  nodes: FlowNode[];
  segments: FlowLink[];
  /** Per link, its segments in column order. */
  chains: number[][];
}

/** Split every link that skips columns into segments through virtual nodes. Real node indices stay. */
export function layer(nodes: readonly FlowNode[], links: readonly FlowLink[]): Layered {
  const all: FlowNode[] = nodes.map((node) => ({ ...node }));
  const segments: FlowLink[] = [];
  const chains = links.map((link) => {
    const chain: number[] = [];
    let from = link.source;
    for (let column = nodes[link.source]!.column + 1; column < nodes[link.target]!.column; column++) {
      const waypoint = all.length;
      all.push({ column, value: link.value, first: link.first, virtual: true });
      chain.push(segments.length);
      segments.push({ source: from, target: waypoint, value: link.value, first: link.first });
      from = waypoint;
    }
    chain.push(segments.length);
    segments.push({ source: from, target: link.target, value: link.value, first: link.first });
    return chain;
  });
  return { nodes: all, segments, chains };
}

/**
 * The node order of every column. 'flow' runs value-weighted barycentre sweeps
 * and keeps the order with the fewest weighted crossings; the first order found
 * wins a tie. 'data' keeps the real nodes in the shared id order and lets the
 * sweeps place only the waypoints between them. Other stays last.
 */
export function orderColumns(nodes: readonly FlowNode[], segments: readonly FlowLink[], columnCount: number, mode: 'flow' | 'data'): number[][] {
  const start: number[][] = Array.from({ length: columnCount }, () => []);
  nodes.map((node, index) => ({ node, index }))
    .sort((a, b) => Number(a.node.other ?? false) - Number(b.node.other ?? false)
      || Number(a.node.virtual ?? false) - Number(b.node.virtual ?? false) || a.node.first - b.node.first || a.index - b.index)
    .forEach(({ node, index }) => start[node.column]!.push(index));
  const into = nodes.map(() => [] as FlowLink[]);
  const outOf = nodes.map(() => [] as FlowLink[]);
  for (const segment of segments) { into[segment.target]!.push(segment); outOf[segment.source]!.push(segment); }
  const rank = new Array<number>(nodes.length).fill(0);
  const size = (node: number) => Math.max(1, current[nodes[node]!.column]!.length);
  const relative = (node: number) => (rank[node]! + 0.5) / size(node);
  let current = start.map((column) => [...column]);
  current.forEach((column) => column.forEach((node, i) => { rank[node] = i; }));
  let best = current.map((column) => [...column]);
  let bestCrossings = weightedCrossings(best, segments, nodes);
  if (bestCrossings === 0) return best;
  const sweep = (column: number[], forward: boolean): number[] => {
    const centre = new Map<number, number>();
    for (const node of column) {
      const near = forward ? into[node]! : outOf[node]!;
      let weight = 0;
      let sum = 0;
      for (const segment of near) {
        sum += segment.value * relative(forward ? segment.source : segment.target);
        weight += segment.value;
      }
      // 'data' fixes the real nodes where they stand; a node with no neighbour on this side stays too.
      const fixed = (mode === 'data' && !nodes[node]!.virtual) || weight === 0;
      centre.set(node, fixed ? relative(node) : sum / weight);
    }
    return [...column].sort((a, b) => Number(nodes[a]!.other ?? false) - Number(nodes[b]!.other ?? false)
      || centre.get(a)! - centre.get(b)! || rank[a]! - rank[b]! || nodes[a]!.first - nodes[b]!.first || a - b);
  };
  for (let round = 0; round < ORDER_ROUNDS; round++) {
    for (const forward of [true, false]) {
      const columns = current.map((_, c) => c);
      for (const c of forward ? columns.slice(1) : columns.slice(0, -1).reverse()) {
        current[c] = sweep(current[c]!, forward);
        current[c]!.forEach((node, i) => { rank[node] = i; });
      }
      const crossings = weightedCrossings(current, segments, nodes);
      if (crossings < bestCrossings) {
        best = current.map((column) => [...column]);
        bestCrossings = crossings;
      }
    }
  }
  return best;
}

/**
 * Pairs of segments that cross between two adjacent columns, each weighted by
 * the product of the two values. Two segments cross when their sources and
 * their targets are in opposite order; segments that share an end do not.
 */
export function weightedCrossings(order: readonly (readonly number[])[], segments: readonly FlowLink[], nodes: readonly FlowNode[]): number {
  const position = new Array<number>(nodes.length).fill(0);
  order.forEach((column) => column.forEach((node, i) => { position[node] = i; }));
  const byColumn = new Map<number, FlowLink[]>();
  for (const segment of segments) {
    const column = nodes[segment.source]!.column;
    byColumn.set(column, [...byColumn.get(column) ?? [], segment]);
  }
  let total = 0;
  for (const list of byColumn.values()) {
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]!;
        if ((position[a.source]! - position[b.source]!) * (position[a.target]! - position[b.target]!) < 0) total += a.value * b.value;
      }
    }
  }
  return total;
}

/** A node's drawn box: top and bottom in px, from the top of the plot. */
export interface NodeBox { y0: number; y1: number }

/**
 * Node heights and positions in a plot `height` px tall. One scale for all
 * columns (value × k px): the busiest column fills the height with `gap`
 * between its nodes. Heights stay proportional. Then relaxation pulls each
 * node toward the value-weighted centre of its segments' other ends, and a
 * collision pass keeps the order, the gap and the plot bounds.
 */
export function placeNodes(order: readonly (readonly number[])[], nodes: readonly FlowNode[], segments: readonly FlowLink[],
  height: number, gap: number): { boxes: NodeBox[]; scale: number } {
  const totals = order.map((column) => column.reduce((sum, node) => sum + nodes[node]!.value, 0));
  const scale = Math.min(...order.flatMap((column, c) => (totals[c]! > 0 ? [Math.max(0, height - (column.length - 1) * gap) / totals[c]!] : [])));
  const k = Number.isFinite(scale) ? scale : 0;
  const boxes: NodeBox[] = nodes.map(() => ({ y0: 0, y1: 0 }));
  order.forEach((column, c) => {
    // A column shorter than the busiest one starts centred.
    let y = Math.max(0, (height - totals[c]! * k - (column.length - 1) * gap) / 2);
    for (const node of column) {
      boxes[node] = { y0: y, y1: y + nodes[node]!.value * k };
      y = boxes[node]!.y1 + gap;
    }
  });
  const into = nodes.map(() => [] as FlowLink[]);
  const outOf = nodes.map(() => [] as FlowLink[]);
  for (const segment of segments) { into[segment.target]!.push(segment); outOf[segment.source]!.push(segment); }
  const centre = (node: number) => (boxes[node]!.y0 + boxes[node]!.y1) / 2;
  const settle = (column: readonly number[]) => {
    // Top down keeps the gap; bottom up keeps the column inside the plot.
    let y = 0;
    for (const node of column) {
      const h = boxes[node]!.y1 - boxes[node]!.y0;
      const y0 = Math.max(y, boxes[node]!.y0);
      boxes[node] = { y0, y1: y0 + h };
      y = y0 + h + gap;
    }
    let bottom = height;
    for (let i = column.length - 1; i >= 0; i--) {
      const node = column[i]!;
      const h = boxes[node]!.y1 - boxes[node]!.y0;
      const y1 = Math.min(bottom, boxes[node]!.y1);
      boxes[node] = { y0: y1 - h, y1 };
      bottom = y1 - h - gap;
    }
  };
  for (let round = 0; round < RELAX_ROUNDS; round++) {
    for (const backward of [true, false]) {
      for (const column of backward ? [...order].reverse() : order) {
        for (const node of column) {
          const near = backward ? outOf[node]! : into[node]!;
          let weight = 0;
          let sum = 0;
          for (const segment of near) {
            sum += segment.value * centre(backward ? segment.target : segment.source);
            weight += segment.value;
          }
          if (weight === 0) continue;
          // Half a step per round: a full step overshoots between two neighbours.
          const dy = (sum / weight - centre(node)) * 0.5;
          boxes[node] = { y0: boxes[node]!.y0 + dy, y1: boxes[node]!.y1 + dy };
        }
        settle(column);
      }
    }
  }
  return { boxes, scale: k };
}

/** A segment's two ends: the top of its band at the source and at the target, and its thickness. */
export interface SegmentBand { sy: number; ty: number; w: number }

/**
 * Where each segment leaves its source and enters its target. Outgoing
 * segments stack from the top of the source in the order of their targets'
 * centres, incoming ones in the order of their sources' centres, so no two
 * ribbons cross at a node.
 */
export function segmentBands(segments: readonly FlowLink[], boxes: readonly NodeBox[], scale: number): SegmentBand[] {
  const centre = (node: number) => (boxes[node]!.y0 + boxes[node]!.y1) / 2;
  const bands: SegmentBand[] = segments.map((segment) => ({ sy: 0, ty: 0, w: segment.value * scale }));
  for (const end of ['source', 'target'] as const) {
    const other = end === 'source' ? 'target' : 'source';
    const groups = new Map<number, number[]>();
    segments.forEach((segment, i) => { groups.set(segment[end], [...groups.get(segment[end]) ?? [], i]); });
    for (const [node, list] of groups) {
      let y = boxes[node]!.y0;
      for (const i of [...list].sort((a, b) => centre(segments[a]![other]) - centre(segments[b]![other]) || segments[a]!.first - segments[b]!.first || a - b)) {
        if (end === 'source') bands[i]!.sy = y; else bands[i]!.ty = y;
        y += bands[i]!.w;
      }
    }
  }
  return bands;
}

/** One piece of a ribbon: from x0 at the top edge sy to x1 at ty. */
export interface RibbonPiece { x0: number; x1: number; sy: number; ty: number }

/**
 * A filled ribbon `w` thick through its pieces: a cubic curve across each
 * column gap (control points at the middle x) and a level run across each
 * waypoint between them. A ribbon under 0.5 px draws 0.5 px thick, so it stays visible.
 */
export function ribbonPath(pieces: readonly RibbonPiece[], w: number, round: (v: number) => number): string {
  const t = Math.max(w, 0.5);
  const p = (x: number, y: number) => `${round(x)} ${round(y)}`;
  const top = pieces.map((piece, i) => {
    const xm = (piece.x0 + piece.x1) / 2;
    return `${i === 0 ? 'M' : 'L'}${p(piece.x0, piece.sy)}C${p(xm, piece.sy)} ${p(xm, piece.ty)} ${p(piece.x1, piece.ty)}`;
  }).join('');
  const bottom = [...pieces].reverse().map((piece) => {
    const xm = (piece.x0 + piece.x1) / 2;
    return `L${p(piece.x1, piece.ty + t)}C${p(xm, piece.ty + t)} ${p(xm, piece.sy + t)} ${p(piece.x0, piece.sy + t)}`;
  }).join('');
  return `${top}${bottom}Z`;
}
