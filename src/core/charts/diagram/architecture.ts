import type { Point, Rect, Size } from '../../geometry';
import { NormalizeError } from '../../normalize/shared';
import { fitText } from '../../label/fitText';
import { wrapText, type FontSpec, type TextMeasurer } from '../../text';
import type { DiagramEdge, DiagramGroup, DiagramLane, DiagramNode, DiagramOptions } from '../../types/diagram';
import type { LintWarning, Paint, SceneNode } from '../../types/scene';
import { dashToken, strokeToken } from '../../theme';
import type { Theme } from '../../types/theme';
import { diagramSceneId } from './ids';
import type { NormalizedDiagram } from './model';
import { snap, type FixedRoute, type OrgChartLayout } from './orgChart';
import { edgeOwner, laneOwner, q, qRect, type DiagramPalette } from './primitives';

/**
 * The architecture diagram: zones side by side or labelled lanes, with every
 * edge routed through the gutters between them. Agents describe relationships
 * and tracks; this file owns all geometry. Zones wrap into bands and nodes
 * into fewer columns as the width falls. Routes search one graph of corridor
 * lines, edges with a common end share a trunk with a junction dot, and
 * unrelated edges take separate tracks. A layout that cannot keep lines off
 * text and off each other is refused.
 */

/** The smallest distance between two unrelated parallel lines. */
const PITCH = 8;
/** A corridor keeps this much room on each side, for a stub and an arrowhead. */
const GAP_HALF = 16;
/** Lines keep this far from a node, and text boxes this far from any line. */
const NODE_CLEARANCE = 7;
const TEXT_CLEARANCE = 4;
const BEND_COST = 40;
const CROSSING_COST = 64;
const SIDE_COST = 48;
/** Tints toward the background of the lane ramp, lightest lane first. */
const LANE_RAMP = [0.9, 0.78, 0.6, 0.22, 0];
const ZONE_TINT = 0.93;
/** One pass learns the tracks, one fits them, one moves a label without a seat to the outer corridors, one fits that. */
const ROUTE_PASSES = 4;

interface Env {
  data: NormalizedDiagram;
  options: DiagramOptions & { variant: 'architecture' };
  plot: Rect;
  name: FontSpec;
  text: FontSpec;
  title: FontSpec;
  measure: TextMeasurer;
  u: number;
  badges: ReadonlyMap<string, Size>;
  order: ReadonlyMap<string, number>;
  neighbours: ReadonlyMap<string, DiagramNode[]>;
}

interface Cell { node: DiagramNode; band: number; c0: number; c1: number; r0: number; r1: number }
interface Unit { group?: DiagramGroup; nodes: DiagramNode[]; c0: number; c1: number }
interface Band { cols: number; rows: number; units: Unit[] }
interface LaneRows { lane: DiagramLane; r0: number; r1: number }
interface Arrangement { cells: Map<string, Cell>; bands: Band[]; lanes?: LaneRows[]; labelAbove?: boolean }

interface Line { pos: number; keys: string[] }
interface Gap { key: string; rect: Rect; axis: 'v' | 'h' }
interface Geometry {
  rects: Map<string, Rect>;
  textBoxes: Map<string, Rect>;
  icons: Map<string, Rect>;
  badges: Map<string, Rect>;
  zones: Array<{ id: string; bounds: Rect; titleBox: Rect; memberNodeIds: string[]; dashed: boolean }>;
  lanes: Array<{ id: string; bounds: Rect; headerBox?: Rect; memberNodeIds: string[]; rule?: number }>;
  labelClaims: Rect[];
  xs: Line[];
  ys: Line[];
  gaps: Gap[];
  width: number;
}

type Side = 'top' | 'right' | 'bottom' | 'left';

export function architectureEligible(options: DiagramOptions): options is DiagramOptions & { variant: 'architecture' } {
  return options.variant === 'architecture';
}

export function layoutArchitecture(
  data: NormalizedDiagram,
  options: DiagramOptions & { variant: 'architecture' },
  plot: Rect,
  fonts: { name: FontSpec; text: FontSpec; title: FontSpec },
  measure: TextMeasurer,
  u: number,
  palette: DiagramPalette,
  theme: Theme,
  badges: ReadonlyMap<string, Size>,
): OrgChartLayout {
  const env: Env = { data, options, plot, ...fonts, measure, u, badges, order: rankNodes(data), neighbours: neighboursOf(data) };
  let last: { geometry: Geometry; routed: Routed; arrangement: Arrangement } | undefined;
  for (const arrangement of arrangements(env)) {
    const gaps = new Map<string, number>();
    const wants = new Map<string, number>();
    const outward = new Set<string>();
    let clean: typeof last;
    for (let pass = 0; pass < ROUTE_PASSES; pass++) {
      // A wanted width gives way before the arrangement does.
      const geometry = place(arrangement, new Map([...gaps, ...[...wants].filter(([key, need]) => need > (gaps.get(key) ?? 0))]), env) ?? place(arrangement, gaps, env);
      if (!geometry) break;
      const routed = routeEdges(geometry, env, outward);
      last = { geometry, routed, arrangement };
      if (routed.problems.length === 0) clean = last;
      let grew = false;
      for (const id of routed.unseated) {
        if (!outward.has(id)) {
          outward.add(id);
          grew = true;
        }
      }
      for (const [name, need] of routed.needs) {
        const key = name.replace('want:', '');
        const store = key === name ? gaps : wants;
        if ((store.get(key) ?? 0) < need) {
          store.set(key, need);
          grew = true;
        }
      }
      if (!grew) break;
    }
    if (clean) return emit(clean.arrangement, clean.geometry, clean.routed, env, palette, theme);
  }
  if (!last) {
    const fallback = fallbackArrangement(env);
    const geometry = place(fallback, new Map(), { ...env, plot: { ...plot, w: Math.max(plot.w, 40 * u) } }, true)!;
    last = { geometry, routed: routeEdges(geometry, env, new Set()), arrangement: fallback };
  }
  return emit(last.arrangement, last.geometry, last.routed, env, palette, theme);
}

/** Longest path over the forward edges, with each return edge read backward. */
function rankNodes(data: NormalizedDiagram): Map<string, number> {
  const rank = new Map(data.nodes.map((node) => [node.id, 0]));
  const steps = data.edges.map((edge) => edge.flow === 'return'
    ? [edge.target.nodeId, edge.source.nodeId] as const : [edge.source.nodeId, edge.target.nodeId] as const);
  for (let pass = 0; pass < data.nodes.length; pass++) {
    let changed = false;
    for (const [from, to] of steps) {
      if (rank.get(to)! < rank.get(from)! + 1 && rank.get(from)! + 1 < data.nodes.length) {
        rank.set(to, rank.get(from)! + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return rank;
}

function neighboursOf(data: NormalizedDiagram): Map<string, DiagramNode[]> {
  const byId = new Map(data.nodes.map((node) => [node.id, node]));
  const out = new Map<string, DiagramNode[]>(data.nodes.map((node) => [node.id, []]));
  for (const edge of data.edges) {
    if (edge.flow === 'return') continue;
    out.get(edge.source.nodeId)!.push(byId.get(edge.target.nodeId)!);
    out.get(edge.target.nodeId)!.push(byId.get(edge.source.nodeId)!);
  }
  return out;
}

/** Zones in authored order, each run of nodes without a zone in a frameless unit where its edges lead. */
function unitsOf(env: Env): Unit[] {
  const { data } = env;
  const units: Unit[] = data.groups.map((group) => ({ group, nodes: data.nodes.filter((node) => node.groupId === group.id), c0: 0, c1: 0 }));
  const free = data.nodes.filter((node) => !node.groupId).sort((a, b) => env.order.get(a.id)! - env.order.get(b.id)!);
  for (const node of free) {
    const to = data.edges.filter((edge) => edge.flow !== 'return' && edge.source.nodeId === node.id).map((edge) => unitIndex(units, edge.target.nodeId)).filter((index) => index >= 0);
    const from = data.edges.filter((edge) => edge.flow !== 'return' && edge.target.nodeId === node.id).map((edge) => unitIndex(units, edge.source.nodeId)).filter((index) => index >= 0);
    const seat = to.length > 0 ? Math.min(...to) : from.length > 0 ? Math.max(...from) + 1 : units.length;
    const beside = units[seat - 1]?.group === undefined ? units[seat - 1] : units[seat]?.group === undefined ? units[seat] : undefined;
    if (beside) beside.nodes.push(node);
    else units.splice(seat, 0, { nodes: [node], c0: 0, c1: 0 });
  }
  return units.filter((unit) => unit.nodes.length > 0 || unit.group);
}

const unitIndex = (units: readonly Unit[], id: string): number => units.findIndex((unit) => unit.nodes.some((node) => node.id === id));

/** How many node columns fit a width. Under 400 px each node takes its own row. */
function columnsFor(env: Env): number {
  const { plot, u } = env;
  return plot.w < 380 ? 1 : Math.max(1, Math.floor((plot.w + 6 * u) / (40 * u)));
}

/** Every arrangement worth trying, widest first. */
function* arrangements(env: Env): Generator<Arrangement> {
  if (env.options.flow === 'lanes') {
    const wide = columnsFor(env);
    for (let cap = wide; cap >= 1; cap--) {
      const arrangement = arrangeLanes(env, cap);
      if (arrangement) yield arrangement;
    }
    return;
  }
  const units = unitsOf(env);
  const cap = columnsFor(env);
  for (let perBand = Math.min(5, units.length); perBand >= 1; perBand--) {
    for (let inner = cap; inner >= 1; inner--) {
      const arrangement = arrangeColumns(env, units, perBand, inner, cap);
      if (arrangement) yield arrangement;
    }
  }
}

function fallbackArrangement(env: Env): Arrangement {
  return env.options.flow === 'lanes' ? arrangeLanes(env, 1)! : arrangeColumns(env, unitsOf(env), 1, 1, 1)!;
}

function refuseTrack(a: string, b: string): never {
  throw new NormalizeError('diagram-track-conflict', 'nodes', `nodes '${a}' and '${b}' claim one cell`, `give '${b}' another track`);
}

function arrangeColumns(env: Env, units: readonly Unit[], perBand: number, inner: number, cap: number): Arrangement | undefined {
  const tracks = [...new Set(env.data.nodes.flatMap((node) => (node.track === undefined ? [] : [node.track])))];
  const cells = new Map<string, Cell>();
  const bands: Band[] = [];
  for (let start = 0; start < units.length; start += perBand) {
    const members = units.slice(start, start + perBand).map((unit) => ({ ...unit }));
    const band = bands.length;
    const taken = new Map<string, string>();
    const claim = (id: string, c: number, r: number) => {
      const other = taken.get(`${c}:${r}`);
      if (other) refuseTrack(other, id);
      taken.set(`${c}:${r}`, id);
    };
    const free = (c: number, r: number) => !taken.has(`${c}:${r}`);
    let cols = 0;
    const pending: Array<{ node: DiagramNode; col: number }> = [];
    const full: Array<{ node: DiagramNode; col: number }> = [];
    for (const unit of members) {
      unit.c0 = cols;
      const local = localColumns(unit, env);
      const ranks = [...new Set(local.values())].sort((a, b) => a - b);
      const own = Math.max(1, ranks.length);
      if (own <= inner) {
        unit.c1 = cols + own - 1;
        for (const node of unit.nodes) {
          const col = cols + ranks.indexOf(local.get(node.id)!);
          if (node.span === 'full') full.push({ node, col });
          else if (node.track !== undefined) {
            const row = tracks.indexOf(node.track);
            claim(node.id, col, row);
            cells.set(node.id, { node, band, c0: col, c1: col, r0: row, r1: row });
          } else pending.push({ node, col });
        }
      } else {
        // Too wide for the width: the nodes flow in reading order and leave their tracks.
        const read = [...unit.nodes].sort((a, b) => env.order.get(a.id)! - env.order.get(b.id)!);
        unit.c1 = cols + inner - 1;
        read.forEach((node, index) => {
          const col = cols + (index % inner);
          const row = Math.floor(index / inner);
          claim(node.id, col, row);
          cells.set(node.id, { node, band, c0: col, c1: col, r0: row, r1: row });
        });
      }
      cols = unit.c1 + 1;
    }
    if (cols > cap) return undefined;
    settleUntracked(pending, cells, free, claim, band, env);
    const rows = Math.max(1, ...[...cells.values()].filter((cell) => cell.band === band).map((cell) => cell.r1 + 1));
    for (const { node, col } of full) {
      for (let r = 0; r < rows; r++) claim(node.id, col, r);
      cells.set(node.id, { node, band, c0: col, c1: col, r0: 0, r1: rows - 1 });
    }
    bands.push({ cols, rows, units: members });
  }
  compressRows(cells, bands);
  return { cells, bands };
}

/** Each edge inside a unit steps one column, unless its ends sit on different tracks and can stack. */
function localColumns(unit: Unit, env: Env): Map<string, number> {
  const ids = new Map(unit.nodes.map((node) => [node.id, node]));
  const col = new Map(unit.nodes.map((node) => [node.id, 0]));
  const steps = env.data.edges.filter((edge) => ids.has(edge.source.nodeId) && ids.has(edge.target.nodeId))
    .map((edge) => (edge.flow === 'return' ? [edge.target.nodeId, edge.source.nodeId] : [edge.source.nodeId, edge.target.nodeId]) as [string, string]);
  for (let pass = 0; pass < unit.nodes.length; pass++) {
    let changed = false;
    for (const [from, to] of steps) {
      const [a, b] = [ids.get(from)!.track, ids.get(to)!.track];
      const need = col.get(from)! + (a !== undefined && b !== undefined && a !== b ? 0 : 1);
      if (need > col.get(to)! && need < unit.nodes.length) {
        col.set(to, need);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return col;
}

/**
 * A node without a track takes the track of its neighbours, and spans the
 * tracks of all of them, so every one of its edges can run straight.
 */
function settleUntracked(
  pending: Array<{ node: DiagramNode; col: number }>, cells: Map<string, Cell>,
  free: (c: number, r: number) => boolean, claim: (id: string, c: number, r: number) => void, band: number, env: Env,
): void {
  const rest = [...pending];
  const inBand = (id: string) => (cells.get(id)?.band === band ? cells.get(id) : undefined);
  const known = (node: DiagramNode) => (env.neighbours.get(node.id) ?? []).filter((other) => inBand(other.id));
  const total = (node: DiagramNode) => (env.neighbours.get(node.id) ?? []).filter((other) => rest.some((item) => item.node.id === other.id) || inBand(other.id)).length;
  while (rest.length > 0) {
    const pick = rest.findIndex(({ node }) => total(node) > 0 && known(node).length === total(node));
    const some = rest.findIndex(({ node }) => known(node).length > 0);
    const chosen = pick >= 0 ? pick : Math.max(0, some);
    const { node, col } = rest.splice(chosen, 1)[0]!;
    const near = known(node).map((other) => inBand(other.id)!);
    const lo = Math.min(...near.map((cell) => cell.r0));
    const hi = Math.max(...near.map((cell) => cell.r1));
    const span = near.length > 1 && hi > lo && Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).every((r) => free(col, r));
    if (span) {
      for (let r = lo; r <= hi; r++) claim(node.id, col, r);
      cells.set(node.id, { node, band, c0: col, c1: col, r0: lo, r1: hi });
      continue;
    }
    let row = near.length > 0 ? lo : 0;
    while (!free(col, row)) row++;
    claim(node.id, col, row);
    cells.set(node.id, { node, band, c0: col, c1: col, r0: row, r1: row });
  }
}

/** Tracks that a band does not use leave no empty row. */
function compressRows(cells: Map<string, Cell>, bands: Band[]): void {
  bands.forEach((band, index) => {
    const own = [...cells.values()].filter((cell) => cell.band === index);
    const used = [...new Set(own.flatMap((cell) => [cell.r0, cell.r1]))].sort((a, b) => a - b);
    const next = new Map(used.map((row, rank) => [row, rank]));
    for (const cell of own) {
      cell.r0 = next.get(cell.r0)!;
      cell.r1 = next.get(cell.r1)!;
    }
    band.rows = Math.max(1, used.length);
  });
}

function arrangeLanes(env: Env, cap: number): Arrangement | undefined {
  const { data } = env;
  const tracks = [...new Set(data.nodes.flatMap((node) => (node.track === undefined ? [] : [node.track])))];
  const members = data.lanes.map((lane) => data.nodes.filter((node) => node.laneId === lane.id));
  const seats = Math.max(tracks.length, ...members.map((nodes) => nodes.filter((node) => node.span !== 'full').length), 1);
  const cols = Math.min(seats, cap);
  const reflow = seats > cap;
  const cells = new Map<string, Cell>();
  const lanes: LaneRows[] = [];
  let row = 0;
  data.lanes.forEach((lane, laneIndex) => {
    const nodes = members[laneIndex]!;
    const r0 = row;
    const wide = nodes.filter((node) => node.span === 'full');
    const seated = nodes.filter((node) => node.span !== 'full');
    if (seated.length > 0) {
      if (reflow) {
        seated.forEach((node, index) => cells.set(node.id, { node, band: 0, c0: index % cols, c1: index % cols, r0: row + Math.floor(index / cols), r1: row + Math.floor(index / cols) }));
        row += Math.ceil(seated.length / cols);
      } else {
        seatLane(seated, tracks, cols, row, cells, env);
        row++;
      }
    }
    for (const node of wide) cells.set(node.id, { node, band: 0, c0: 0, c1: cols - 1, r0: row, r1: row++ });
    if (row === r0) row++;
    lanes.push({ lane, r0, r1: row - 1 });
  });
  if (!reflow) widenToNeighbours(cells, env);
  const units: Unit[] = [{ nodes: data.nodes, c0: 0, c1: cols - 1 }];
  return { cells, lanes, bands: [{ cols, rows: row, units }], labelAbove: env.plot.w < 520 };
}

/** Tracks first, then each node under its neighbours, then evenly across the free columns. */
function seatLane(nodes: readonly DiagramNode[], tracks: readonly string[], cols: number, row: number, cells: Map<string, Cell>, env: Env): void {
  const taken = new Map<number, string>();
  const seat = (node: DiagramNode, col: number) => {
    taken.set(col, node.id);
    cells.set(node.id, { node, band: 0, c0: col, c1: col, r0: row, r1: row });
  };
  for (const node of nodes) {
    if (node.track === undefined) continue;
    const col = tracks.indexOf(node.track);
    if (taken.has(col)) refuseTrack(taken.get(col)!, node.id);
    seat(node, col);
  }
  const open = nodes.filter((node) => node.track === undefined);
  open.forEach((node, index) => {
    const known = (env.neighbours.get(node.id) ?? []).flatMap((other) => (cells.has(other.id) ? [(cells.get(other.id)!.c0 + cells.get(other.id)!.c1) / 2] : []));
    const wanted = known.length > 0 ? known.reduce((sum, value) => sum + value, 0) / known.length
      : open.length === 1 && nodes.length === 1 ? 0 : ((index + 0.5) * cols) / open.length - 0.5;
    let best = -1;
    for (let col = 0; col < cols; col++) {
      if (!taken.has(col) && (best < 0 || Math.abs(col - wanted) < Math.abs(best - wanted))) best = col;
    }
    seat(node, best);
  });
}

function widenToNeighbours(cells: Map<string, Cell>, env: Env): void {
  const cellsIn = [...cells.values()];
  for (const cell of cellsIn) {
    if (cell.node.track !== undefined || cell.node.span === 'full') continue;
    const near = (env.neighbours.get(cell.node.id) ?? []).map((other) => cells.get(other.id)!);
    if (near.length < 2) continue;
    const lo = Math.min(...near.map((other) => other.c0));
    const hi = Math.max(...near.map((other) => other.c1));
    const clear = (c: number) => !cellsIn.some((other) => other !== cell && other.r0 <= cell.r0 && other.r1 >= cell.r0 && other.c0 <= c && other.c1 >= c);
    while (cell.c0 > lo && clear(cell.c0 - 1)) cell.c0--;
    while (cell.c1 < hi && clear(cell.c1 + 1)) cell.c1++;
  }
}

interface NodeText { height: number }

function nodeText(node: DiagramNode, width: number, env: Env): NodeText | undefined {
  const { name, text, measure, options, u } = env;
  const inner = width - 4 * u - (node.icon ? 3.5 * u : 0);
  if (inner < 1) return undefined;
  const lineH = (font: FontSpec) => font.size * (font.lineHeight ?? 1.2);
  const lead = fitText(node.label, name, inner, 3, measure, { target: options.target, typeRole: 'label' });
  if (lead.title !== undefined) return undefined;
  const second = node.secondaryLabel ? fitText(node.secondaryLabel, text, inner, 2, measure, { target: options.target, typeRole: 'label' }) : undefined;
  if (second?.title !== undefined) return undefined;
  return { height: lead.lines.length * lineH(name) + (second ? u + second.lines.length * lineH(text) : 0) };
}

/** Turns cells and gap widths into pixels and corridor lines. */
function place(arrangement: Arrangement, gaps: ReadonlyMap<string, number>, env: Env, force = false): Geometry | undefined {
  const { plot, u, title, measure } = env;
  const lanesFlow = arrangement.lanes !== undefined;
  const pad = 2.5 * u;
  const titleH = title.size * (title.lineHeight ?? 1.2);
  const innerGap = 2 * GAP_HALF;
  const unitGap = 2 * GAP_HALF;
  const gap = (key: string, base: number) => Math.max(base, gaps.get(key) ?? 0);
  const geometry: Geometry = { rects: new Map(), textBoxes: new Map(), icons: new Map(), badges: new Map(), zones: [], lanes: [], labelClaims: [], xs: [], ys: [], gaps: [], width: plot.w };
  const outerL = gap('oL', 0);
  const outerR = gap('oR', 0);
  const laneLabel = lanesFlow && !arrangement.labelAbove ? laneLabelWidth(env) : 0;
  // A dashed zone's frame stands 1.5 u off its nodes and stays in the plot.
  const frameInset = lanesFlow && env.data.groups.length > 0 ? 1.5 * u + 1 : 0;
  const left = plot.x + laneLabel + outerL + frameInset;
  const right = plot.x + plot.w - outerR - frameInset;
  const axisX: Array<[number, string?]> = [[left - Math.max(outerL, 2 * PITCH) / 2, 'oL'], [right + Math.max(outerR, 2 * PITCH) / 2, 'oR']];
  const axisY: Array<[number, string?]> = [];
  let y = plot.y;

  for (const [b, band] of arrangement.bands.entries()) {
    const key = (axis: string, index: number) => `${axis}:${b}:${index}`;
    const framed = band.units.filter((unit) => unit.group);
    const unitAfter = new Set(band.units.map((unit) => unit.c1));
    let fixed = 0;
    for (let c = 0; c + 1 < band.cols; c++) fixed += gap(key('v', c), unitAfter.has(c) ? unitGap : innerGap);
    if (!lanesFlow) fixed += framed.length * 2 * pad;
    const avail = right - left - fixed;
    if (avail / band.cols < 1 && !force) return undefined;
    const fair = Math.max(1, avail / band.cols);
    // A short pipeline keeps its boxes in proportion, and the gutters take the rest.
    const columnW = band.units.length > 1 || band.cols > 1 ? Math.min(fair, 60 * u) : fair;
    const spare = band.cols > 1 ? (avail - columnW * band.cols) / (band.cols - 1) : 0;
    const colX: number[] = [];
    let x = left;
    const unitOf = (c: number) => band.units.find((unit) => c >= unit.c0 && c <= unit.c1)!;
    for (let c = 0; c < band.cols; c++) {
      const unit = unitOf(c);
      if (c === unit.c0 && unit.group && !lanesFlow) x += pad;
      colX[c] = q(x);
      x += columnW;
      if (c === unit.c1 && unit.group && !lanesFlow) x += pad;
      if (c + 1 < band.cols) {
        const width = gap(key('v', c), unitAfter.has(c) ? unitGap : innerGap) + spare;
        geometry.gaps.push({ key: key('v', c), axis: 'v', rect: { x, y: 0, w: width, h: 0 } });
        axisX.push([x + width / 2, key('v', c)]);
        x += width;
      }
      axisX.push([colX[c]! + columnW / 2]);
    }

    const own = [...arrangement.cells.values()].filter((cell) => cell.band === b);
    const heights = new Map<string, number>();
    const textH = new Map<string, number>();
    const rowH = new Array<number>(band.rows).fill(11 * u);
    for (const cell of own) {
      const width = columnW * (cell.c1 - cell.c0 + 1) + colX[cell.c1]! - colX[cell.c0]! - columnW * (cell.c1 - cell.c0);
      const text = nodeText(cell.node, width, env);
      if (!text) {
        if (!force) return undefined;
      }
      const badge = env.badges.get(cell.node.id);
      const height = Math.max(11 * u, (text?.height ?? 0) + 3 * u + (badge ? badge.height + 0.5 * u : 0));
      textH.set(cell.node.id, text?.height ?? 0);
      heights.set(cell.node.id, height);
      if (cell.r0 === cell.r1) rowH[cell.r0] = Math.max(rowH[cell.r0]!, height);
    }

    const titled = !lanesFlow && framed.length > 0;
    const lines = new Map<Unit, string[]>();
    let head = 0;
    if (titled) {
      for (const unit of framed) {
        const width = colX[unit.c1]! + columnW - colX[unit.c0]! + 2 * pad - 2 * u;
        const wrapped = wrapText(unit.group!.title, title, width, 2, measure);
        if (wrapped.truncated && !force) return undefined;
        lines.set(unit, wrapped.lines);
        head = Math.max(head, wrapped.lines.length * titleH);
      }
      head += 2 * u + 1.5 * u;
    }
    const laneOfRow = (r: number) => arrangement.lanes?.find((lane) => r >= lane.r0 && r <= lane.r1);
    const rowY: number[] = [];
    let cursor = y + head;
    const top = y;
    for (let r = 0; r < band.rows; r++) {
      const lane = laneOfRow(r);
      if (lane && r === lane.r0) {
        const headerH = arrangement.labelAbove && lane.lane.label ? titleH + u : 0;
        const box = lane.lane.label ? laneHeader(lane.lane.label, plot.x, cursor + u, laneLabel, env, arrangement.labelAbove) : undefined;
        if (box) geometry.labelClaims.push(box);
        geometry.lanes.push({ id: lane.lane.id, bounds: { x: plot.x, y: cursor, w: plot.w, h: 0 }, ...(box ? { headerBox: box } : {}),
          memberNodeIds: env.data.nodes.filter((node) => node.laneId === lane.lane.id).map((node) => node.id), ...(r > 0 ? { rule: cursor } : {}) });
        // A dashed zone's title sits on its frame, clear of the lane rule above.
        const framedLane = env.data.nodes.some((node) => node.laneId === lane.lane.id && node.groupId !== undefined);
        cursor += headerH + 2 * u + (framedLane ? titleH / 2 + u : 0);
      }
      rowY[r] = q(cursor);
      cursor += rowH[r]!;
      axisY.push([rowY[r]! + rowH[r]! / 2]);
      if (lane && r === lane.r1) {
        const laneBox = geometry.lanes.at(-1)!;
        cursor += 2 * u;
        laneBox.bounds.h = cursor - laneBox.bounds.y;
      }
      if (r + 1 < band.rows) {
        const width = gap(key('h', r), lane && r === lane.r1 ? 2 * GAP_HALF - 4 * u : innerGap);
        geometry.gaps.push({ key: key('h', r), axis: 'h', rect: { x: plot.x, y: cursor, w: plot.w, h: width } });
        axisY.push([cursor + width / 2, key('h', r)]);
        cursor += width;
      }
    }
    const bandBottom = cursor + (titled ? pad : 0);
    for (const item of geometry.gaps) {
      if (item.axis === 'v' && item.rect.h === 0) {
        item.rect.y = top;
        item.rect.h = bandBottom - top;
      }
    }

    for (const cell of own) {
      const x0 = colX[cell.c0]!;
      const x1 = colX[cell.c1]! + columnW;
      const y0 = rowY[cell.r0]!;
      const y1 = rowY[cell.r1]! + rowH[cell.r1]!;
      const rect = qRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      const id = cell.node.id;
      geometry.rects.set(id, rect);
      const badge = env.badges.get(id);
      const reserve = badge ? badge.height + 0.5 * u : 0;
      if (badge) geometry.badges.set(id, qRect({ x: rect.x + rect.w - badge.width - u, y: rect.y + u, ...{ w: badge.width, h: badge.height } }));
      const icon = cell.node.icon ? 3.5 * u : 0;
      const box = textH.get(id)!;
      const bodyTop = rect.y + reserve + (rect.h - reserve - box) / 2;
      geometry.textBoxes.set(id, qRect({ x: rect.x + 2 * u + icon, y: bodyTop - 0.5, w: rect.w - 4 * u - icon, h: box + 1 }));
      if (icon) geometry.icons.set(id, qRect({ x: rect.x + 2 * u, y: bodyTop + (env.name.size * 1.2 - 2.5 * u) / 2, w: 2.5 * u, h: 2.5 * u }));
    }

    for (const unit of framed) {
      if (lanesFlow) continue;
      const x0 = colX[unit.c0]! - pad;
      const x1 = colX[unit.c1]! + columnW + pad;
      const text = lines.get(unit)!;
      const width = Math.max(...text.map((line) => measure(line, title).width));
      const titleBox = qRect({ x: x0 + 2 * u - 4, y: top + 2 * u, w: width + 8, h: text.length * titleH });
      geometry.labelClaims.push(titleBox);
      geometry.zones.push({ id: unit.group!.id, bounds: qRect({ x: x0, y: top, w: x1 - x0, h: bandBottom - top }), titleBox,
        memberNodeIds: unit.nodes.map((node) => node.id), dashed: false });
    }
    y = bandBottom;
    if (b + 1 < arrangement.bands.length) {
      const width = gap(`b:${b}`, 2 * GAP_HALF);
      geometry.gaps.push({ key: `b:${b}`, axis: 'h', rect: { x: plot.x, y, w: plot.w, h: width } });
      axisY.push([y + width / 2, `b:${b}`]);
      y += width;
    }
  }
  geometry.gaps.push({ key: 'oL', axis: 'v', rect: { x: left - Math.max(outerL, 2 * PITCH), y: plot.y, w: Math.max(outerL, 2 * PITCH), h: y - plot.y } });
  geometry.gaps.push({ key: 'oR', axis: 'v', rect: { x: right, y: plot.y, w: Math.max(outerR, 2 * PITCH), h: y - plot.y } });
  const bottom = gap('oB', 0);
  axisY.push([y + Math.max(bottom, 2 * PITCH) / 2, 'oB']);
  geometry.gaps.push({ key: 'oB', axis: 'h', rect: { x: plot.x, y, w: plot.w, h: Math.max(bottom, 2 * PITCH) } });

  if (lanesFlow) laneZones(geometry, env);
  geometry.xs = corridorLines(axisX);
  geometry.ys = corridorLines(axisY);
  return geometry;
}

function laneLabelWidth(env: Env): number {
  const { data, title, measure, plot, u } = env;
  const widest = Math.max(0, ...data.lanes.map((lane) => {
    const words = (lane.label ?? '').split(/\s+/).map((word) => measure(word, title).width);
    return Math.min(measure(lane.label ?? '', title).width, Math.max(...words, plot.w * 0.13));
  }));
  // A long unbroken word wraps inside the cap, so it cannot take the plot from the nodes.
  return Math.ceil(Math.min(widest, plot.w * 0.25)) + 3 * u;
}

function laneHeader(label: string, x: number, y: number, width: number, env: Env, above?: boolean): Rect {
  const { title, measure, plot, u } = env;
  const room = above ? plot.w : Math.max(1, width - 3 * u);
  const lines = wrapText(label, title, room, 2, measure).lines;
  const w = Math.max(...lines.map((line) => measure(line, title).width));
  return qRect({ x: x - 4, y, w: w + 8, h: lines.length * title.size * (title.lineHeight ?? 1.2) });
}

/** In lanes a zone wraps its members across neighbouring lanes, with its title on the frame. */
function laneZones(geometry: Geometry, env: Env): void {
  const { data, title, measure, u } = env;
  for (const group of data.groups) {
    const members = data.nodes.filter((node) => node.groupId === group.id);
    if (members.length === 0) continue;
    const rects = members.map((node) => geometry.rects.get(node.id)!);
    const x0 = Math.min(...rects.map((rect) => rect.x)) - 1.5 * u;
    // The title centres on the top line and keeps clear of the nodes below it.
    const y0 = Math.min(...rects.map((rect) => rect.y)) - 2 * u;
    const x1 = Math.max(...rects.map((rect) => rect.x + rect.w)) + 1.5 * u;
    const y1 = Math.max(...rects.map((rect) => rect.y + rect.h)) + 1.5 * u;
    const bounds = qRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    const height = title.size * (title.lineHeight ?? 1.2);
    const width = measure(group.title, title).width;
    const titleBox = qRect({ x: x0 + 2 * u - 4, y: y0 - height / 2, w: width + 8, h: height });
    geometry.labelClaims.push(titleBox);
    geometry.zones.push({ id: group.id, bounds, titleBox, memberNodeIds: members.map((node) => node.id), dashed: true });
  }
}

function corridorLines(raw: Array<[number, string?]>): Line[] {
  const sorted = raw.map(([pos, key]) => ({ pos: snap(pos), keys: key ? [key] : [] })).sort((a, b) => a.pos - b.pos || a.keys.length - b.keys.length);
  const lines: Line[] = [];
  for (const line of sorted) {
    const last = lines.at(-1);
    if (last && line.pos === last.pos) last.keys.push(...line.keys);
    else if (last && line.pos - last.pos < PITCH && line.keys.length === 0) continue;
    else if (last && line.pos - last.pos < PITCH && last.keys.length === 0) lines[lines.length - 1] = line;
    else lines.push(line);
  }
  return lines;
}

// ---- Routing ------------------------------------------------------------

interface Run { edge: number; horizontal: boolean; line: number; from: number; to: number; fromLine: number; toLine: number; track: number }
interface Routed {
  routes: Map<string, FixedRoute>;
  dots: Point[];
  labels: Map<string, Rect>;
  channels: Array<{ id: string; label: string; rect: Rect; edgeId: string }>;
  problems: string[];
  needs: Map<string, number>;
  /** Edges whose label found no seat. */
  unseated: string[];
}

const styleOf = (edge: DiagramEdge) => [edge.dash ?? 'solid', edge.weight ?? 'normal', edge.role ?? '', edge.paletteKey ?? '', edge.flow ?? 'forward', edge.arrowStart ? 1 : 0].join('|');

function compatible(a: DiagramEdge, b: DiagramEdge): boolean {
  if (styleOf(a) !== styleOf(b)) return false;
  if (a.source.nodeId === b.source.nodeId) return true;
  // Dashes of two lines from different starts do not line up on a shared run.
  return a.target.nodeId === b.target.nodeId && (a.dash ?? 'solid') === 'solid';
}

function sideLines(lines: readonly Line[], from: number, to: number): number[] {
  const out: number[] = [];
  lines.forEach((line, index) => { if (line.pos >= from + 4 && line.pos <= to - 4) out.push(index); });
  return out;
}

function routeEdges(geometry: Geometry, env: Env, outward: ReadonlySet<string>): Routed {
  const { data } = env;
  const { xs, ys, rects } = geometry;
  const W = xs.length;
  const H = ys.length;
  const blocked = obstacleGrid(geometry, W, H);
  const order = [...data.edges].sort((a, b) => Number(a.flow === 'return') - Number(b.flow === 'return')
    || env.order.get(a.source.nodeId)! - env.order.get(b.source.nodeId)! || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const useH = new Map<number, number[]>();
  const useV = new Map<number, number[]>();
  const states = 4 * W * H;
  const cost = new Float64Array(states);
  const prev = new Int32Array(states);
  const goal = new Float64Array(states);
  const runs: Run[][] = [];
  const problems: string[] = [];
  const sides: Array<{ source: Side; target: Side }> = [];
  const down = env.options.flow === 'lanes';

  order.forEach((edge, edgeIndex) => {
    const sourceRect = rects.get(edge.source.nodeId)!;
    const targetRect = rects.get(edge.target.nodeId)!;
    cost.fill(Infinity);
    prev.fill(-1);
    goal.fill(Infinity);
    const heap = new StateHeap(cost);
    const startSide = new Map<number, Side>();
    const endSide = new Map<number, Side>();
    const across = sourceRect.x < targetRect.x + targetRect.w && targetRect.x < sourceRect.x + sourceRect.w;
    const level = sourceRect.y < targetRect.y + targetRect.h && targetRect.y < sourceRect.y + sourceRect.h;
    // Lanes flow down and zones flow across, unless the ends sit straight above or beside each other.
    const towards: Side = (down ? level : !across)
      ? (targetRect.x >= sourceRect.x ? 'right' : 'left') : targetRect.y >= sourceRect.y ? 'bottom' : 'top';
    const open = (side: Side, rect: Rect, source: boolean) => {
      const penalty = edge.flow === 'return' || side === (source ? towards : ({ top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const)[towards]) ? 0 : SIDE_COST;
      const dir = source ? ({ right: 0, bottom: 1, left: 2, top: 3 } as const)[side] : ({ left: 0, top: 1, right: 2, bottom: 3 } as const)[side];
      const horizontal = side === 'left' || side === 'right';
      const crossLines = horizontal ? sideLines(ys, rect.y, rect.y + rect.h) : sideLines(xs, rect.x, rect.x + rect.w);
      for (const cross of crossLines) {
        const lines = horizontal ? xs : ys;
        const edgePos = side === 'left' ? rect.x : side === 'right' ? rect.x + rect.w : side === 'top' ? rect.y : rect.y + rect.h;
        const outward = side === 'right' || side === 'bottom';
        const index = outward ? lines.findIndex((line) => line.pos > edgePos + NODE_CLEARANCE) : findLast(lines, (line) => line.pos < edgePos - NODE_CLEARANCE);
        if (index < 0) continue;
        const i = horizontal ? index : cross;
        const j = horizontal ? cross : index;
        if (blocked.vertex[i + j * W]) continue;
        const crossPos = (horizontal ? ys : xs)[cross]!.pos;
        const [stubA, stubB] = horizontal
          ? [{ x: edgePos, y: crossPos }, { x: lines[index]!.pos, y: crossPos }]
          : [{ x: crossPos, y: edgePos }, { x: crossPos, y: lines[index]!.pos }];
        // A port stub stays off a lane or zone title too.
        if (geometry.labelClaims.some((claim) => segmentHits(stubA, stubB, grown(claim, TEXT_CLEARANCE)))) continue;
        const state = (i + j * W) * 4 + dir;
        const stub = Math.abs(lines[index]!.pos - edgePos) + penalty;
        if (source) {
          if (stub < cost[state]!) {
            cost[state] = stub;
            startSide.set(state, side);
            heap.push(state);
          }
        } else if (stub < goal[state]!) {
          goal[state] = stub;
          endSide.set(state, side);
        }
      }
    };
    for (const side of ['right', 'bottom', 'left', 'top'] as const) {
      open(side, sourceRect, true);
      open(side, targetRect, false);
    }
    const self = edgeIndex;
    const incompatible = (users: readonly number[] | undefined) => (users ?? []).filter((user) => !compatible(order[user]!, edge)).length;
    const friendly = (users: readonly number[] | undefined) => (users ?? []).some((user) => compatible(order[user]!, edge));
    let best = Infinity;
    let bestState = -1;
    let bestEnd = -1;
    while (heap.size > 0) {
      const state = heap.pop();
      const here = cost[state]!;
      if (here >= best) break;
      const dir = state & 3;
      const vertex = state >> 2;
      // The last corner may fall on the vertex in front of the port.
      for (const arrive of [dir, (dir + 1) & 3, (dir + 3) & 3]) {
        const total = here + goal[vertex * 4 + arrive]! + (arrive === dir ? 0 : BEND_COST);
        if (total < best) {
          best = total;
          bestState = state;
          bestEnd = vertex * 4 + arrive;
        }
      }
      const i = vertex % W;
      const j = (vertex - i) / W;
      for (const next of [dir, (dir + 1) & 3, (dir + 3) & 3]) {
        const horizontal = next === 0 || next === 2;
        const ni = next === 0 ? i + 1 : next === 2 ? i - 1 : i;
        const nj = next === 1 ? j + 1 : next === 3 ? j - 1 : j;
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const seg = horizontal ? Math.min(i, ni) + j * W : i + Math.min(j, nj) * W;
        if ((horizontal ? blocked.h : blocked.v)[seg]) continue;
        const length = horizontal ? Math.abs(xs[ni]!.pos - xs[i]!.pos) : Math.abs(ys[nj]!.pos - ys[j]!.pos);
        const users = (horizontal ? useH : useV).get(seg);
        let step = length;
        const against = incompatible(users);
        if (against > 0) step += 24 * against;
        else if (friendly(users)) step *= 0.15;
        // A return keeps to the outer corridors, off the forward flow.
        if ((edge.flow === 'return' || outward.has(edge.id)) && !(horizontal ? ys[j]! : xs[i]!).keys.some((key) => key.startsWith('o'))) step *= outward.has(edge.id) ? 40 : 2.5;
        if (next !== dir) step += BEND_COST;
        else {
          const across = horizontal
            ? [...(useV.get(i + j * W) ?? []), ...(useV.get(i + (j - 1) * W) ?? [])]
            : [...(useH.get(i + j * W) ?? []), ...(useH.get(i - 1 + j * W) ?? [])];
          if (incompatible(across) > 0) step += CROSSING_COST;
        }
        const target = (ni + nj * W) * 4 + next;
        if (here + step < cost[target]!) {
          cost[target] = here + step;
          prev[target] = state;
          heap.push(target);
        }
      }
    }
    if (bestState < 0) {
      problems.push(edge.id);
      runs.push([]);
      sides.push({ source: 'right', target: 'left' });
      return;
    }
    const trail: number[] = [];
    for (let state = bestState; state >= 0; state = prev[state]!) trail.unshift(state);
    if (bestEnd !== bestState) trail.push(bestEnd);
    for (let index = 1; index < trail.length; index++) {
      const a = trail[index - 1]! >> 2;
      const b = trail[index]! >> 2;
      if (a === b) continue;
      const horizontal = (trail[index]! & 3) % 2 === 0;
      const ai = a % W;
      const bi = b % W;
      const aj = (a - ai) / W;
      const bj = (b - bi) / W;
      const seg = horizontal ? Math.min(ai, bi) + aj * W : ai + Math.min(aj, bj) * W;
      const map = horizontal ? useH : useV;
      map.set(seg, [...(map.get(seg) ?? []), self]);
    }
    const first = startSide.get(trail[0]!)!;
    const lastSide = endSide.get(bestEnd)!;
    sides.push({ source: first, target: lastSide });
    runs.push(runsOf(trail, W, geometry, sourceRect, targetRect, first, lastSide, edgeIndex));
  });

  const all = runs.flat();
  const counts = assignTracks(all, order);
  const offsets = (run: Run) => trackOffset(run, counts);
  let polylines = runs.map((path) => polyline(path, geometry, offsets));
  polylines = settleCrossings(all, runs, counts, order, geometry, polylines);

  const routes = new Map<string, FixedRoute>();
  order.forEach((edge, index) => {
    if (runs[index]!.length === 0) return;
    routes.set(edge.id, { points: polylines[index]!, sourceSide: sides[index]!.source, targetSide: sides[index]!.target });
  });

  const needs = new Map<string, number>();
  const need = (keys: readonly string[], value: number) => keys.forEach((key) => needs.set(key, Math.max(needs.get(key) ?? 0, value)));
  for (const [key, tracks] of counts) {
    const [axis, index] = key.split(':');
    const line = (axis === 'h' ? ys : xs)[Number(index)]!;
    const outer = line.keys.some((name) => name.startsWith('o'));
    if (outer) need(line.keys, tracks * PITCH + 2 * PITCH);
    else if (tracks > 1) need(line.keys, (tracks - 1) * PITCH + 2 * GAP_HALF);
  }
  problems.push(...lineProblems(order, polylines, rects));
  const unseated: string[] = [];
  const labels = placeLabels(order, polylines, geometry, env, needs, unseated, outward);
  problems.push(...unseated);
  const channels = placeChannels(order, polylines, geometry, labels, env, needs, problems);
  return { routes, dots: junctions(order, polylines), labels, channels, problems, needs, unseated };
}

function findLast<T>(items: readonly T[], test: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index--) if (test(items[index]!)) return index;
  return -1;
}

function obstacleGrid(geometry: Geometry, W: number, H: number): { h: Uint8Array; v: Uint8Array; vertex: Uint8Array } {
  const { xs, ys } = geometry;
  const grid = { h: new Uint8Array(W * H), v: new Uint8Array(W * H), vertex: new Uint8Array(W * H) };
  const boxes = [
    ...[...geometry.rects.values()].map((rect) => ({ x: rect.x - NODE_CLEARANCE, y: rect.y - NODE_CLEARANCE, w: rect.w + 2 * NODE_CLEARANCE, h: rect.h + 2 * NODE_CLEARANCE })),
    ...geometry.labelClaims.map((rect) => ({ x: rect.x - TEXT_CLEARANCE, y: rect.y - TEXT_CLEARANCE, w: rect.w + 2 * TEXT_CLEARANCE, h: rect.h + 2 * TEXT_CLEARANCE })),
  ];
  for (const box of boxes) {
    const x1 = box.x + box.w;
    const y1 = box.y + box.h;
    for (let j = 0; j < H; j++) {
      const y = ys[j]!.pos;
      for (let i = 0; i < W; i++) {
        const x = xs[i]!.pos;
        if (y > box.y && y < y1) {
          if (x > box.x && x < x1) grid.vertex[i + j * W] = 1;
          if (i + 1 < W && xs[i + 1]!.pos > box.x && x < x1) grid.h[i + j * W] = 1;
        }
        if (x > box.x && x < x1 && j + 1 < H && ys[j + 1]!.pos > box.y && y < y1) grid.v[i + j * W] = 1;
      }
    }
  }
  return grid;
}

class StateHeap {
  private items: number[] = [];
  constructor(private cost: Float64Array) {}
  get size(): number { return this.items.length; }
  private less(a: number, b: number): boolean { return this.cost[a]! < this.cost[b]! || (this.cost[a] === this.cost[b] && a < b); }
  push(state: number): void {
    const items = this.items;
    items.push(state);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.less(items[index]!, items[parent]!)) break;
      [items[index], items[parent]] = [items[parent]!, items[index]!];
      index = parent;
    }
  }
  pop(): number {
    const items = this.items;
    const top = items[0]!;
    const tail = items.pop()!;
    if (items.length > 0) {
      items[0] = tail;
      let index = 0;
      for (;;) {
        const left = 2 * index + 1;
        const right = left + 1;
        let least = index;
        if (left < items.length && this.less(items[left]!, items[least]!)) least = left;
        if (right < items.length && this.less(items[right]!, items[least]!)) least = right;
        if (least === index) break;
        [items[index], items[least]] = [items[least]!, items[index]!];
        index = least;
      }
    }
    return top;
  }
}

function runsOf(trail: readonly number[], W: number, geometry: Geometry, source: Rect, target: Rect, sourceSide: Side, targetSide: Side, edge: number): Run[] {
  const { xs, ys } = geometry;
  const at = (state: number) => {
    const vertex = state >> 2;
    const i = vertex % W;
    return { i, j: (vertex - i) / W, horizontal: (state & 3) % 2 === 0 };
  };
  const coordinate = (side: Side, rect: Rect) => (side === 'left' ? rect.x : side === 'right' ? rect.x + rect.w : side === 'top' ? rect.y : rect.y + rect.h);
  const runs: Run[] = [];
  const head = at(trail[0]!);
  let run: Run = { edge, horizontal: head.horizontal, line: head.horizontal ? head.j : head.i, from: coordinate(sourceSide, source), to: 0, fromLine: -1, toLine: -1, track: 0 };
  for (let index = 1; index < trail.length; index++) {
    const point = at(trail[index]!);
    if (point.horizontal === run.horizontal) continue;
    const corner = at(trail[index - 1]!);
    run.to = run.horizontal ? xs[corner.i]!.pos : ys[corner.j]!.pos;
    run.toLine = run.horizontal ? corner.i : corner.j;
    runs.push(run);
    run = { edge, horizontal: point.horizontal, line: point.horizontal ? corner.j : corner.i, from: run.horizontal ? ys[corner.j]!.pos : xs[corner.i]!.pos, to: 0, fromLine: run.horizontal ? corner.j : corner.i, toLine: -1, track: 0 };
  }
  run.to = coordinate(targetSide, target);
  runs.push(run);
  return runs;
}

const lineKey = (run: Run) => `${run.horizontal ? 'h' : 'v'}:${run.line}`;

/** Left-edge track assignment on each corridor line. A run joins a compatible run's track first. */
function assignTracks(runs: readonly Run[], order: readonly DiagramEdge[]): Map<string, number> {
  const lines = new Map<string, Run[]>();
  for (const run of runs) lines.set(lineKey(run), [...(lines.get(lineKey(run)) ?? []), run]);
  const counts = new Map<string, number>();
  for (const [key, members] of lines) {
    members.sort((a, b) => Math.min(a.from, a.to) - Math.min(b.from, b.to) || a.edge - b.edge);
    const tracks: Run[][] = [];
    const meets = (a: Run, b: Run) => Math.min(a.from, a.to) - PITCH < Math.max(b.from, b.to) && Math.min(b.from, b.to) - PITCH < Math.max(a.from, a.to);
    for (const run of members) {
      const allowed = (track: Run[]) => track.every((other) => other.edge === run.edge || !meets(other, run) || compatible(order[other.edge]!, order[run.edge]!));
      const joined = tracks.findIndex((track) => allowed(track) && track.some((other) => other.edge !== run.edge && meets(other, run) && compatible(order[other.edge]!, order[run.edge]!)));
      const index = joined >= 0 ? joined : tracks.findIndex(allowed);
      if (index >= 0) {
        tracks[index]!.push(run);
        run.track = index;
      } else {
        run.track = tracks.length;
        tracks.push([run]);
      }
    }
    counts.set(key, tracks.length);
  }
  return counts;
}

function trackOffset(run: Run, counts: ReadonlyMap<string, number>): number {
  const tracks = counts.get(lineKey(run)) ?? 1;
  return (run.track - (tracks - 1) / 2) * PITCH;
}

function polyline(path: readonly Run[], geometry: Geometry, offset: (run: Run) => number): Point[] {
  if (path.length === 0) return [];
  const position = (run: Run) => (run.horizontal ? geometry.ys : geometry.xs)[run.line]!.pos + offset(run);
  const first = path[0]!;
  const last = path.at(-1)!;
  const points: Point[] = [first.horizontal ? { x: first.from, y: position(first) } : { x: position(first), y: first.from }];
  for (let index = 1; index < path.length; index++) {
    const a = path[index - 1]!;
    const b = path[index]!;
    points.push(a.horizontal ? { x: position(b), y: position(a) } : { x: position(a), y: position(b) });
  }
  points.push(last.horizontal ? { x: last.to, y: position(last) } : { x: position(last), y: last.to });
  return points.map((point) => ({ x: q(point.x), y: q(point.y) }));
}

function crossings(polylines: readonly Point[][], order: readonly DiagramEdge[]): number {
  let total = 0;
  for (let a = 0; a < polylines.length; a++) {
    for (let b = a + 1; b < polylines.length; b++) {
      if (compatible(order[a]!, order[b]!)) continue;
      forSegments(polylines[a]!, (p, q1) => forSegments(polylines[b]!, (r, s) => {
        const pH = p.y === q1.y;
        const rH = r.y === s.y;
        if (pH === rH) return;
        const [h0, h1, v0, v1] = pH ? [p, q1, r, s] : [r, s, p, q1];
        if (Math.min(h0.x, h1.x) < v0.x && v0.x < Math.max(h0.x, h1.x) && Math.min(v0.y, v1.y) < h0.y && h0.y < Math.max(v0.y, v1.y)) total++;
      }));
    }
  }
  return total;
}

function forSegments(points: readonly Point[], visit: (a: Point, b: Point) => void): void {
  for (let index = 1; index < points.length; index++) visit(points[index - 1]!, points[index]!);
}

/** Reverse the tracks of a corridor where this removes crossings. */
function settleCrossings(all: readonly Run[], runs: readonly Run[][], counts: ReadonlyMap<string, number>, order: readonly DiagramEdge[], geometry: Geometry, start: Point[][]): Point[][] {
  let polylines = start;
  let score = crossings(polylines, order);
  const keys = [...counts].filter(([, tracks]) => tracks > 1).map(([key]) => key).sort();
  for (const key of keys) {
    if (score === 0) break;
    const members = all.filter((run) => lineKey(run) === key);
    const tracks = counts.get(key)!;
    members.forEach((run) => { run.track = tracks - 1 - run.track; });
    const trial = runs.map((path) => polyline(path, geometry, (run) => trackOffset(run, counts)));
    const next = crossings(trial, order);
    if (next < score) {
      score = next;
      polylines = trial;
    } else members.forEach((run) => { run.track = tracks - 1 - run.track; });
  }
  return polylines;
}

function lineProblems(order: readonly DiagramEdge[], polylines: readonly Point[][], rects: ReadonlyMap<string, Rect>): string[] {
  const problems: string[] = [];
  order.forEach((edge, index) => {
    const points = polylines[index]!;
    // A track offset can push an end past its node's side, so the line would float.
    if (!touches(points[0]!, rects.get(edge.source.nodeId)!) || !touches(points.at(-1)!, rects.get(edge.target.nodeId)!)) problems.push(edge.id);
    forSegments(points, (a, b) => {
      for (const [id, rect] of rects) {
        const own = id === edge.source.nodeId || id === edge.target.nodeId;
        if (segmentHits(a, b, own ? { x: rect.x + 1, y: rect.y + 1, w: rect.w - 2, h: rect.h - 2 } : { x: rect.x - 1, y: rect.y - 1, w: rect.w + 2, h: rect.h + 2 })) problems.push(edge.id);
      }
    });
    for (let other = index + 1; other < order.length; other++) {
      if (compatible(edge, order[other]!)) continue;
      forSegments(points, (a, b) => forSegments(polylines[other]!, (c, d) => {
        const horizontal = a.y === b.y;
        if (horizontal !== (c.y === d.y)) return;
        const apart = horizontal ? Math.abs(a.y - c.y) : Math.abs(a.x - c.x);
        const [a0, a1, c0, c1] = horizontal ? [a.x, b.x, c.x, d.x] : [a.y, b.y, c.y, d.y];
        if (apart < PITCH - 1 && Math.min(a0, a1) < Math.max(c0, c1) && Math.min(c0, c1) < Math.max(a0, a1)) problems.push(edge.id);
      }));
    }
  });
  return problems;
}

const touches = (point: Point, rect: Rect) => point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;

function segmentHits(a: Point, b: Point, rect: Rect): boolean {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return x0 < rect.x + rect.w && x1 > rect.x && y0 < rect.y + rect.h && y1 > rect.y;
}

function grown(rect: Rect, by: number): Rect {
  return { x: rect.x - by, y: rect.y - by, w: rect.w + 2 * by, h: rect.h + 2 * by };
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function labelClear(box: Rect, polylines: readonly Point[][], blockers: readonly Rect[], plot: Rect): boolean {
  if (box.x < plot.x || box.x + box.w > plot.x + plot.w) return false;
  const halo = grown(box, TEXT_CLEARANCE);
  if (blockers.some((rect) => overlaps(halo, rect))) return false;
  let clear = true;
  for (const points of polylines) forSegments(points, (a, b) => { if (segmentHits(a, b, halo)) clear = false; });
  return clear;
}

/** A label sits by the longest free run of its edge, reserved in the routing passes. */
function placeLabels(
  order: readonly DiagramEdge[], polylines: readonly Point[][], geometry: Geometry, env: Env,
  needs: Map<string, number>, unseated: string[], outward: ReadonlySet<string>,
): Map<string, Rect> {
  const { text, measure } = env;
  const out = new Map<string, Rect>();
  const rules = geometry.lanes.flatMap((lane) => (lane.rule === undefined ? [] : [{ x: env.plot.x, y: lane.rule, w: env.plot.w, h: 1 }]));
  const frames = geometry.zones.flatMap(({ bounds: { x, y, w, h } }) => [{ x, y, w, h: 1 }, { x, y: y + h, w, h: 1 }, { x, y, w: 1, h }, { x: x + w, y, w: 1, h }]);
  const blockers: Rect[] = [...geometry.rects.values(), ...geometry.labelClaims, ...rules, ...frames];
  const lineH = text.size * (text.lineHeight ?? 1.2);
  order.forEach((edge, index) => {
    if (!edge.label) return;
    const points = polylines[index]!;
    const segments: Array<[Point, Point]> = [];
    forSegments(points, (a, b) => segments.push([a, b]));
    const length = (s: [Point, Point]) => Math.abs(s[0].x - s[1].x) + Math.abs(s[0].y - s[1].y);
    const flat = segments.filter((s) => s[0].y === s[1].y).sort((a, b) => length(b) - length(a));
    const upright = segments.filter((s) => s[0].x === s[1].x).sort((a, b) => length(b) - length(a));
    const off = TEXT_CLEARANCE + 1;
    const one = Math.ceil(measure(edge.label, text).width) + 1;
    const two = wrapText(edge.label, text, Math.ceil(one * 0.6), 2, measure);
    const blocks = [{ width: one, height: lineH }];
    const three = wrapText(edge.label, text, Math.ceil(one * 0.42), 3, measure);
    for (const wrapped of [two, three]) {
      if (!wrapped.truncated && wrapped.lines.length > 1) blocks.push({ width: Math.ceil(Math.max(...wrapped.lines.map((line) => measure(line, text).width))) + 1, height: wrapped.lines.length * lineH });
    }
    const rows = geometry.gaps.filter((item) => item.axis === 'h');
    const seats = blocks.flatMap(({ width, height }) => [
      ...flat.flatMap(([a, b]) => {
        // A run near the plot edge keeps its label inside the plot.
        const inPlot = (x: number) => Math.max(env.plot.x, Math.min(x, env.plot.x + env.plot.w - width));
        // Besides the middle of the run, each side of a gutter it crosses, clear of a trunk there.
        const columns = geometry.gaps.filter((item) => item.axis === 'v' && Math.min(a.x, b.x) <= item.rect.x && Math.max(a.x, b.x) >= item.rect.x + item.rect.w);
        const spots = [(a.x + b.x) / 2, ...columns.flatMap(({ rect }) => [rect.x + rect.w / 4, rect.x + (3 * rect.w) / 4])];
        return spots.flatMap((spot) => [{ x: inPlot(spot - width / 2), y: a.y - off - height, w: width, h: height }, { x: inPlot(spot - width / 2), y: a.y + off, w: width, h: height }]);
      }),
      ...upright.flatMap(([a, b]) => {
        const y = (a.y + b.y) / 2 - height / 2;
        const beside = (top: number) => [{ x: a.x + off + 2, y: top, w: width, h: height }, { x: a.x - off - 2 - width, y: top, w: width, h: height }];
        const crossed = rows.filter((row) => row.rect.y > Math.min(a.y, b.y) && row.rect.y + row.rect.h < Math.max(a.y, b.y));
        // A line just outside a zone seats its label inside the frame, in the same row gutter.
        const inset = (top: number) => geometry.zones.flatMap(({ bounds }) => (a.x > bounds.x + bounds.w && a.x - bounds.x - bounds.w < width + 2 * off
          ? [{ x: bounds.x + bounds.w - off - width, y: top, w: width, h: height }]
          : a.x < bounds.x && bounds.x - a.x < width + 2 * off ? [{ x: bounds.x + off, y: top, w: width, h: height }] : []));
        return [...beside(y), ...crossed.flatMap((row) => {
          const top = row.rect.y + (row.rect.h - height) / 2;
          return [...beside(top), ...inset(top)];
        })];
      }),
    ]).map(qRect);
    const seat = seats.find((box) => labelClear(box, polylines, blockers, env.plot));
    if (seat) {
      out.set(edge.id, seat);
      blockers.push(seat);
      return;
    }
    unseated.push(edge.id);
    // A return tries the outer corridors before any gutter grows.
    if (edge.flow === 'return' && !outward.has(edge.id)) return;
    const block = blocks.at(-1)!;
    const contains = (item: Gap, point: Point) => point.x >= item.rect.x && point.x <= item.rect.x + item.rect.w && point.y >= item.rect.y && point.y <= item.rect.y + item.rect.h;
    const middle = ([a, b]: [Point, Point]) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const beside = (width: number, seg: [Point, Point]) => (seg[0].x === seg[1].x ? 2 : 1) * (width + 2 * off);
    const tall = 2 * (block.height + off + TEXT_CLEARANCE);
    const along = flat.find((seg) => length(seg) >= block.width + 2 * off && rows.some((row) => contains(row, middle(seg))));
    if (along) {
      const row = rows.find((item) => contains(item, middle(along)))!;
      needs.set(row.key, Math.max(needs.get(row.key) ?? 0, tall));
      return;
    }
    const longest = [...segments].sort((a, b) => length(b) - length(a))[0];
    if (!longest) return;
    const inside = geometry.gaps.find((item) => contains(item, middle(longest)));
    // A wide label does not fit a gutter beside the nodes: it takes a row gutter that the run crosses.
    // A line along a gutter runs down its middle, so a label beside it takes half the gutter.
    const wide = beside(block.width, longest);
    const row = inside?.axis === 'v' && wide > env.plot.w / 3
      ? rows.filter((item) => item.rect.y > Math.min(longest[0].y, longest[1].y) && item.rect.y + item.rect.h < Math.max(longest[0].y, longest[1].y))
        .sort((a, b) => Math.abs(a.rect.y - middle(longest).y) - Math.abs(b.rect.y - middle(longest).y))[0] : undefined;
    const gap = row ?? inside;
    if (!gap) return;
    needs.set(gap.key, Math.max(needs.get(gap.key) ?? 0, gap.axis === 'v' ? wide : tall));
    if (gap.axis === 'v' && block !== blocks[0]) needs.set(`want:${gap.key}`, beside(blocks[0]!.width, longest));
  });
  return out;
}

/** A channel's label centres between its edges in the gutter they all cross. */
function placeChannels(
  order: readonly DiagramEdge[], polylines: readonly Point[][], geometry: Geometry, labels: ReadonlyMap<string, Rect>,
  env: Env, needs: Map<string, number>, problems: string[],
): Routed['channels'] {
  const { text, measure, data } = env;
  const out: Routed['channels'] = [];
  const blockers = [...geometry.rects.values(), ...geometry.labelClaims, ...labels.values()];
  const lineH = text.size * (text.lineHeight ?? 1.2);
  for (const channel of data.channels) {
    const crossing = (gap: Gap, points: readonly Point[]): number[] => {
      const hits: number[] = [];
      forSegments(points, (a, b) => {
        if (gap.axis === 'v' && a.y === b.y && Math.min(a.x, b.x) <= gap.rect.x && Math.max(a.x, b.x) >= gap.rect.x + gap.rect.w
          && a.y >= gap.rect.y && a.y <= gap.rect.y + gap.rect.h) hits.push(a.y);
        if (gap.axis === 'h' && a.x === b.x && Math.min(a.y, b.y) <= gap.rect.y && Math.max(a.y, b.y) >= gap.rect.y + gap.rect.h) hits.push(a.x);
      });
      return hits;
    };
    const members = channel.edgeIds.map((id) => polylines[order.findIndex((edge) => edge.id === id)]!);
    const gap = geometry.gaps.find((item) => members.every((points) => crossing(item, points).length > 0));
    if (!gap) {
      problems.push(`channel:${channel.id}`);
      continue;
    }
    const hits = members.flatMap((points) => crossing(gap, points)).sort((a, b) => a - b);
    const room = gap.axis === 'v' ? gap.rect.w - 2 * TEXT_CLEARANCE - 2 : Math.abs(hits.at(-1)! - hits[0]!) - 2 * TEXT_CLEARANCE - 2;
    const oneLine = Math.ceil(measure(channel.label, text).width) + 1;
    // One line where the width allows it: the gutter grows, and a width it cannot spare wraps the label.
    if (gap.axis === 'v') needs.set(`want:${gap.key}`, oneLine + 2 * GAP_HALF);
    const wrapped = wrapText(channel.label, text, Math.max(1, Math.min(oneLine, room > 0 ? room : oneLine)), 2, measure);
    const width = Math.ceil(Math.max(...wrapped.lines.map((line) => measure(line, text).width))) + 1;
    const height = wrapped.lines.length * lineH;
    const box = gap.axis === 'v'
      ? { x: gap.rect.x + (gap.rect.w - width) / 2, y: hits.length > 1 ? (hits[0]! + hits.at(-1)!) / 2 - height / 2 : hits[0]! + 2 * TEXT_CLEARANCE, w: width, h: height }
      : { x: hits.length > 1 ? (hits[0]! + hits.at(-1)!) / 2 - width / 2 : hits[0]! + 2 * TEXT_CLEARANCE, y: gap.rect.y + (gap.rect.h - height) / 2, w: width, h: height };
    const rect = qRect(box);
    if (wrapped.truncated || !labelClear(rect, polylines, blockers, env.plot)) {
      problems.push(`channel:${channel.id}`);
      needs.set(gap.key, Math.max(needs.get(gap.key) ?? 0, gap.axis === 'v' ? width + 2 * GAP_HALF : height + 2 * GAP_HALF));
      continue;
    }
    // The first line sits at the box's left edge, so each channel line stays one block.
    out.push({ id: channel.id, label: channel.label, rect, edgeId: channel.edgeIds[0]! });
    blockers.push(rect);
  }
  return out;
}

/** A dot where a compatible edge leaves a shared run, never at a shared end. */
function junctions(order: readonly DiagramEdge[], polylines: readonly Point[][]): Point[] {
  const dots = new Map<string, Point>();
  const add = (point: Point) => dots.set(`${point.x}:${point.y}`, point);
  for (let a = 0; a < order.length; a++) {
    for (let b = a + 1; b < order.length; b++) {
      if (!compatible(order[a]!, order[b]!)) continue;
      const [pa, pb] = [polylines[a]!, polylines[b]!];
      const ends = new Set([pa[0], pa.at(-1), pb[0], pb.at(-1)].map((point) => `${point?.x}:${point?.y}`));
      forSegments(pa, (p, r) => forSegments(pb, (s, t) => {
        const horizontal = p.y === r.y;
        if (horizontal !== (s.y === t.y)) return;
        if (horizontal ? p.y !== s.y : p.x !== s.x) return;
        const [p0, p1, s0, s1] = horizontal ? [p.x, r.x, s.x, t.x] : [p.y, r.y, s.y, t.y];
        const lo = Math.max(Math.min(p0, p1), Math.min(s0, s1));
        const hi = Math.min(Math.max(p0, p1), Math.max(s0, s1));
        if (lo >= hi) return;
        for (const value of [lo, hi]) {
          const point = horizontal ? { x: value, y: p.y } : { x: p.x, y: value };
          if (!ends.has(`${point.x}:${point.y}`)) add(point);
        }
      }));
    }
  }
  return [...dots.keys()].sort().map((key) => dots.get(key)!);
}

// ---- Result -------------------------------------------------------------

/** Lanes ramp by layer, lightest first, by rank alone, so a repaint keeps the choice. */
function laneRamp(index: number, count: number): Paint {
  const step = count === 1 ? 0 : Math.round((index * (LANE_RAMP.length - 1)) / (count - 1));
  const tint = LANE_RAMP[step]!;
  return tint === 0 ? { token: 'total' } : { token: 'total', tint };
}

/** The fill of a node, with the ring of one that sits on the background. The diagram key shows the same paints. */
export function architectureFill(node: DiagramNode, lanes: readonly { id: string }[], palette: DiagramPalette): { fill: Paint; ring?: 'axis' | 'grid' } {
  const plain = node.role === undefined || node.role === 'primary';
  const lane = lanes.findIndex((item) => item.id === node.laneId);
  if (plain && lane >= 0) return { fill: laneRamp(lane, lanes.length) };
  if (plain || node.role === 'secondary' || node.role === 'muted') return { fill: { token: 'background' }, ring: node.role === 'muted' ? 'grid' : 'axis' };
  // The focal node stays apart from the solid lane, which shares its colour in some themes.
  if (node.role === 'accent' && lane >= 0) return { fill: { token: 'focus', theme: { kind: 'focus-apart', apartFrom: [{ token: 'total' }] } } };
  return { fill: palette.fill(node.role, node.paletteKey) };
}

function emit(arrangement: Arrangement, geometry: Geometry, routed: Routed, env: Env, palette: DiagramPalette, theme: Theme): OrgChartLayout {
  const { data, name } = env;
  const fills = new Map<string, Paint>();
  const rings = new Map<string, { stroke: Paint; width: number }>();
  const hair = strokeToken(theme, 'hair');
  for (const node of data.nodes) {
    const { fill, ring } = architectureFill(node, data.lanes, palette);
    fills.set(node.id, fill);
    if (ring) rings.set(node.id, { stroke: { token: ring }, width: hair });
  }

  for (const [id, label] of routed.labels) {
    const route = routed.routes.get(id);
    if (route) route.labelBox = label;
  }
  const scene: SceneNode[] = [];
  const claims: OrgChartLayout['preset']['decorationClaims'] = [];
  const lanes = geometry.lanes.map(({ rule, ...lane }) => {
    if (rule !== undefined) {
      const y = snap(rule);
      scene.push({ t: 'line', id: diagramSceneId('lane', lane.id, 'partition'), x1: env.plot.x, y1: y, x2: env.plot.x + env.plot.w, y2: y,
        stroke: { token: 'grid' }, width: hair, owner: laneOwner(lane.id), part: 'diagramLanePartition' } as SceneNode);
    }
    return lane;
  });
  for (const zone of geometry.zones.filter((item) => item.dashed)) {
    const { x, y, w, h } = zone.bounds;
    scene.push({ t: 'path', id: diagramSceneId('group', zone.id), d: `M${x} ${y}H${x + w}V${y + h}H${x}Z`, fill: { token: 'background' }, stroke: { token: 'axis' }, width: hair,
      dash: dashToken(theme, 'reference'), owner: { seriesId: zone.id }, part: 'diagramGroup' } as SceneNode);
    scene.push({ t: 'rect', id: diagramSceneId('group', zone.id, 'title'), rect: zone.titleBox, fill: { token: 'background' }, owner: { seriesId: zone.id }, part: 'diagramGroupTitle' } as SceneNode);
  }
  routed.dots.forEach((dot, index) => {
    scene.push({ t: 'circle', id: diagramSceneId('junction', String(index)), cx: dot.x, cy: dot.y, r: 3, fill: { token: 'inkMuted' }, owner: {}, part: 'diagramJunction' } as SceneNode);
  });

  const edges = data.edges.map((edge) => ({ ...edge, arrowEnd: edge.arrowEnd ?? true }));
  const unresolved = [...new Set(routed.problems)];
  const warnings: LintWarning[] = [];
  if (unresolved.length > 0) {
    const channel = unresolved.find((id) => id.startsWith('channel:') && !routed.channels.some((item) => `channel:${item.id}` === id));
    warnings.push(channel && unresolved.length === 1 ? {
      code: 'diagram-channel-mismatch', severity: 'error',
      message: `channel '${channel.slice(8)}' has no gutter that all its edges cross, or no room for its label there`,
      suggest: 'keep its edges between the same two zones, or shorten the label',
    } : {
      code: 'diagram-route-unresolved', severity: 'error',
      message: `no clean route or label seat for ${unresolved.map((id) => `'${id}'`).join(', ')}`,
      suggest: 'widen the canvas, shorten the edge labels, or split the exhibit',
    });
  }
  const extent = [...routed.routes.values()].flatMap((route) => [...route.points.map((point) => ({ x: point.x, y: point.y, w: 1, h: 1 })), ...(route.labelBox ? [route.labelBox] : [])]);
  const bottom = Math.max(...extent.map((rect) => rect.y + rect.h), ...[...geometry.rects.values()].map((rect) => rect.y + rect.h));
  if (bottom > env.plot.y + env.plot.h + 1) {
    warnings.push({ code: 'diagram-size-too-small', severity: 'error', message: `architecture needs ${Math.ceil(bottom - env.plot.y - env.plot.h)} px more height` });
  }

  const readingOrder = [...arrangement.cells.values()].sort((a, b) => a.band - b.band || a.c0 - b.c0 || a.r0 - b.r0 || (a.node.id < b.node.id ? -1 : 1)).map((cell) => cell.node.id);
  const fonts = new Map(data.nodes.map((node) => [node.id, name]));
  return {
    mode: 'columns',
    preset: {
      nodeRects: geometry.rects, readingOrder, edges, syntheticEdgeIds: [],
      groups: geometry.zones.map(({ id, bounds, titleBox, memberNodeIds }) => ({ id, bounds, titleBox, memberNodeIds })),
      lanes, decorationScene: scene, decorationClaims: claims, contentTopReserves: new Map(),
    },
    routes: routed.routes, fonts, labelBoxes: geometry.textBoxes, icons: geometry.icons, rings, fills, plainShape: true,
    badges: geometry.badges, labelInks: new Map(), laneFills: new Map(data.lanes.map((lane) => [lane.id, { token: 'background' as const }])),
    extent, edgePaint: { token: 'inkMuted' }, secondaryFont: env.text,
    groupPaint: {
      fill: { token: 'total', tint: ZONE_TINT }, stroke: { token: 'axis' },
      dashed: new Set(geometry.zones.filter((zone) => zone.dashed).map((zone) => zone.id)),
    },
    warnings,
    channelLabels: routed.channels.map((channel) => ({ id: `channel-label:${channel.id}`, text: channel.label, rect: channel.rect, owner: edgeOwner(channel.edgeId) })),
  };
}
