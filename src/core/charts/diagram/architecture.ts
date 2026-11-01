import { rectLineDistance, type Point, type Rect, type Size } from '../../geometry';
import { NormalizeError } from '../../normalize/shared';
import { fitText } from '../../label/fitText';
import { compileIcon } from '../../icons';
import { wrapText, type FontSpec, type TextMeasurer } from '../../text';
import type { DiagramEdge, DiagramGroup, DiagramLane, DiagramNode, DiagramOptions } from '../../types/diagram';
import type { LintWarning, Paint, SceneNode } from '../../types/scene';
import { dashToken, strokeToken } from '../../theme';
import type { Theme } from '../../types/theme';
import { diagramSceneId } from './ids';
import { groupWithin, type NormalizedDiagram } from './model';
import { snap, type FixedRoute, type OrgChartLayout } from './orgChart';
import { edgeOwner, laneOwner, nodeOwner, q, qRect, storePath, type DiagramPalette } from './primitives';

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
/** The tint of a protected node or zone, and the inset of its inner frame. */
const PROTECTED_TINT = 0.89;
const PROTECTED_INSET = 3;
/** Each stacked copy of a repeated node steps this far down and right. */
const REPEAT_STEP = 3;
/** How far a self-loop hangs below its node, in spacing units. */
const LOOP_REACH = 2.25;
/** A callout's disc across, in spacing units. */
const DISC_UNITS = 3.5;
/** A route pays this for each zone frame it need not cross. */
const ZONE_COST = 160;
/** From this plot width the inset sits beside the exhibit, and takes at most this share. */
const INSET_BESIDE_WIDTH = 800;
const INSET_MAX_SHARE = 0.3;
/** One pass learns the tracks, one fits them, one moves a label without a seat to the outer corridors, one fits that. */
const ROUTE_PASSES = 4;

interface Env {
  data: NormalizedDiagram;
  options: DiagramOptions & { variant: 'architecture' };
  plot: Rect;
  ownReturnLabels?: boolean;
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
/** A run of nodes in the zones of `chain`, outermost first. An empty chain has no frame. */
interface Unit { chain: DiagramGroup[]; nodes: DiagramNode[]; c0: number; c1: number }
/** A zone in one band, with its depth in the zone tree. */
interface BandFrame { group: DiagramGroup; depth: number; c0: number; c1: number }
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
  zones: Array<{ id: string; bounds: Rect; titleBox: Rect; memberNodeIds: string[]; dashed: boolean; depth: number; policy?: boolean }>;
  /** What the self-loops take below their nodes. */
  loops: Rect[];
  /** The lock beside a protected zone's title. */
  locks: Map<string, Rect>;
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

type ArchitectureFonts = { name: FontSpec; text: FontSpec; title: FontSpec };
type Plan = { geometry: Geometry; routed: Routed; arrangement: Arrangement };

/**
 * One render's chosen plans. A size search probes many heights, and height does
 * not change the plan, so each width is planned once.
 */
export const ARCHITECTURE_PLANS = Symbol('architecturePlans');
export type ArchitecturePlans = Map<string, Plan>;

export function layoutArchitecture(
  data: NormalizedDiagram,
  options: DiagramOptions & { variant: 'architecture' },
  plot: Rect,
  fonts: ArchitectureFonts,
  measure: TextMeasurer,
  u: number,
  palette: DiagramPalette,
  theme: Theme,
  badges: ReadonlyMap<string, Size>,
  plans?: ArchitecturePlans,
): OrgChartLayout {
  if (!data.inset) return planArchitecture(data, options, plot, fonts, measure, u, palette, theme, badges, plans);
  const beside = plot.w >= INSET_BESIDE_WIDTH;
  const gap = 6 * u;
  const width = beside ? insetWidth(data.inset, plot.w, fonts, measure, u) : plot.w;
  const layout = planArchitecture(data, options, beside ? { ...plot, w: plot.w - width - gap } : plot, fonts, measure, u, palette, theme, badges, plans);
  const bottom = Math.max(...[...layout.preset.nodeRects.values(), ...layout.preset.groups.map((group) => group.bounds), ...layout.preset.lanes.map((lane) => lane.bounds), ...layout.extent!]
    .map((rect) => rect.y + rect.h));
  const box = { x: plot.x + plot.w - width, y: beside ? plot.y : bottom + gap, w: width };
  const panel = insetPanel(data.inset, box, !beside, fonts, measure, u);
  const end = box.y + panel.height;
  const stroke = { token: 'axis' } as const;
  const hair = strokeToken(theme, 'hair');
  const rule = beside ? { x1: box.x - gap / 2, y1: plot.y, x2: box.x - gap / 2, y2: Math.max(bottom, end) } : { x1: plot.x, y1: bottom + gap / 2, x2: plot.x + plot.w, y2: bottom + gap / 2 };
  layout.preset.decorationScene.push({ t: 'line', id: diagramSceneId('inset', 'rule'), ...rule, stroke, width: hair, owner: {}, part: 'diagramLane' } as SceneNode);
  layout.channelLabels = [...(layout.channelLabels ?? []), ...panel.labels];
  layout.extent!.push(...panel.labels.map((label) => label.rect));
  if (end > plot.y + plot.h + 1 && !layout.warnings!.some((warning) => warning.code === 'diagram-size-too-small')) {
    layout.warnings!.push({ code: 'diagram-size-too-small', severity: 'error', message: `architecture needs ${Math.ceil(end - plot.y - plot.h)} px more height` });
  }
  return layout;
}

/** The panel's width beside the exhibit: what its text asks for, within limits. */
function insetWidth(inset: NonNullable<NormalizedDiagram['inset']>, plotW: number, fonts: ArchitectureFonts, measure: TextMeasurer, u: number): number {
  const need = Math.max(measure(inset.title, fonts.title).width,
    ...(inset.rows ?? []).map((row) => measure(row.label, fonts.text).width + measure(row.value, fonts.name).width + 3 * u),
    ...(inset.kpis ?? []).flatMap((kpi) => [measure(kpi.value, kpiFont(fonts)).width, measure(kpi.label, fonts.text).width]));
  return q(Math.max(36 * u, Math.min(Math.ceil(need), INSET_MAX_SHARE * plotW)));
}

const kpiFont = (fonts: ArchitectureFonts): FontSpec => ({ ...fonts.title, size: Math.round(fonts.title.size * 1.75) });

/** The panel's text seats. Numbers sit in a row under the exhibit, and in a column beside it. */
function insetPanel(inset: NonNullable<NormalizedDiagram['inset']>, box: { x: number; y: number; w: number }, wide: boolean, fonts: ArchitectureFonts, measure: TextMeasurer, u: number) {
  const labels: NonNullable<OrgChartLayout['channelLabels']> = [];
  const seat = (id: string, text: string, font: FontSpec, x: number, y: number, width: number, right = false) => {
    const wrapped = wrapText(text, font, width, 4, measure);
    const w = Math.ceil(Math.max(...wrapped.lines.map((line) => measure(line, font).width))) + 1;
    const h = wrapped.lines.length * font.size * (font.lineHeight ?? 1.2);
    labels.push({ id: `inset-label:${id}`, text, rect: qRect({ x: right ? x + width - w : x, y, w, h }), owner: {}, font });
    return h;
  };
  let y = box.y + seat('title', inset.title, fonts.title, box.x, box.y, box.w) + 2 * u;
  const kpis = inset.kpis ?? [];
  const across = wide ? kpis.length : 1;
  const cell = (box.w - (across - 1) * 3 * u) / Math.max(1, across);
  for (let at = 0; at < kpis.length; at += across) {
    let tallest = 0;
    kpis.slice(at, at + across).forEach((kpi, index) => {
      const x = box.x + index * (cell + 3 * u);
      const top = seat(`kpi:${at + index}:value`, kpi.value, kpiFont(fonts), x, y, cell);
      tallest = Math.max(tallest, top + u + seat(`kpi:${at + index}:label`, kpi.label, fonts.text, x, y + top + u, cell));
    });
    y += tallest + 2 * u;
  }
  (inset.rows ?? []).forEach((row, index) => {
    const value = Math.ceil(measure(row.value, fonts.name).width) + 1;
    const name = seat(`row:${index}:label`, row.label, fonts.text, box.x, y, box.w - value - 2 * u);
    seat(`row:${index}:value`, row.value, fonts.name, box.x + box.w - value, y, value, true);
    y += name + u;
  });
  return { labels, height: y - box.y - u };
}

function planArchitecture(
  data: NormalizedDiagram,
  options: DiagramOptions & { variant: 'architecture' },
  plot: Rect,
  fonts: ArchitectureFonts,
  measure: TextMeasurer,
  u: number,
  palette: DiagramPalette,
  theme: Theme,
  badges: ReadonlyMap<string, Size>,
  plans?: ArchitecturePlans,
): OrgChartLayout {
  // Height never shapes a plan: labels may run past the plot, and emit reports a shortfall.
  const env: Env = { data, options, plot: { ...plot, h: Infinity }, ...fonts, measure, u, badges, order: rankNodes(data), neighbours: neighboursOf(data) };
  const key = [plot.x, plot.y, plot.w, u, fonts.name.size, fonts.text.size, fonts.title.size].join();
  const planned = plans?.get(key);
  if (planned) return emit(planned.arrangement, planned.geometry, planned.routed, { ...env, plot }, palette, theme);
  const finish = (plan: Plan) => {
    plans?.set(key, plan);
    return emit(plan.arrangement, plan.geometry, plan.routed, { ...env, plot }, palette, theme);
  };
  let last: Plan | undefined;
  // A return label sits closer to its own line than to any other, unless no layout allows that.
  for (const ownReturnLabels of env.data.edges.some((edge) => edge.flow === 'return' && edge.label) ? [true, false] : [false]) for (const arrangement of arrangements(env)) {
    env.ownReturnLabels = ownReturnLabels;
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
        // An edge inside one zone keeps its path, and its gutter grows instead.
        if (!outward.has(id) && !heldInZone(env.data.edges.find((edge) => edge.id === id)!, geometry, env.data)) {
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
    if (clean) return finish(clean);
  }
  if (!last) {
    const fallback = fallbackArrangement(env);
    const geometry = place(fallback, new Map(), { ...env, plot: { ...plot, w: Math.max(plot.w, 40 * u) } }, true)!;
    last = { geometry, routed: routeEdges(geometry, env, new Set()), arrangement: fallback };
  }
  return finish(last);
}

/** Longest path over the forward edges, with each return edge read backward. */
function rankNodes(data: NormalizedDiagram): Map<string, number> {
  const rank = new Map(data.nodes.map((node) => [node.id, 0]));
  const steps = data.edges.filter((edge) => !selfLoop(edge)).map((edge) => edge.flow === 'return'
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

const selfLoop = (edge: DiagramEdge) => edge.source.nodeId === edge.target.nodeId;

function neighboursOf(data: NormalizedDiagram): Map<string, DiagramNode[]> {
  const byId = new Map(data.nodes.map((node) => [node.id, node]));
  const out = new Map<string, DiagramNode[]>(data.nodes.map((node) => [node.id, []]));
  for (const edge of data.edges) {
    if (edge.flow === 'return' || selfLoop(edge)) continue;
    out.get(edge.source.nodeId)!.push(byId.get(edge.target.nodeId)!);
    out.get(edge.target.nodeId)!.push(byId.get(edge.source.nodeId)!);
  }
  return out;
}

/** Zones in authored order, each run of nodes without a zone in a frameless unit where its edges lead. */
function unitsOf(env: Env): Unit[] {
  const { data } = env;
  const tree = (parent: string | undefined, chain: DiagramGroup[]): Unit[] => data.groups
    .filter((group) => group.kind !== 'policy' && group.parentId === parent).flatMap((group) => {
      const inner = [...chain, group];
      const nodes = data.nodes.filter((node) => node.groupId === group.id);
      const children = tree(group.id, inner);
      return nodes.length > 0 || children.length === 0 ? [{ chain: inner, nodes, c0: 0, c1: 0 }, ...children] : children;
    });
  const units = tree(undefined, []);
  const free = data.nodes.filter((node) => !node.groupId).sort((a, b) => env.order.get(a.id)! - env.order.get(b.id)!);
  for (const node of free) {
    const to = data.edges.filter((edge) => edge.flow !== 'return' && !selfLoop(edge) && edge.source.nodeId === node.id).map((edge) => unitIndex(units, edge.target.nodeId)).filter((index) => index >= 0);
    const from = data.edges.filter((edge) => edge.flow !== 'return' && !selfLoop(edge) && edge.target.nodeId === node.id).map((edge) => unitIndex(units, edge.source.nodeId)).filter((index) => index >= 0);
    let seat = to.length > 0 ? Math.min(...to) : from.length > 0 ? Math.max(...from) + 1 : units.length;
    // A frameless run stays out of a nested zone.
    while (seat > 0 && seat < units.length && units[seat]!.chain[0] !== undefined && units[seat - 1]!.chain[0] === units[seat]!.chain[0]) seat++;
    const beside = units[seat - 1]?.chain.length === 0 ? units[seat - 1] : units[seat]?.chain.length === 0 ? units[seat] : undefined;
    if (beside) beside.nodes.push(node);
    else units.splice(seat, 0, { chain: [], nodes: [node], c0: 0, c1: 0 });
  }
  return units.filter((unit) => unit.nodes.length > 0 || unit.chain.length > 0);
}

/** The units of each root zone stay together, and each frameless run stands alone. */
function rootsOf(units: readonly Unit[]): Unit[][] {
  const roots: Unit[][] = [];
  for (const unit of units) {
    const last = roots.at(-1);
    if (last && unit.chain[0] !== undefined && last[0]!.chain[0] === unit.chain[0]) last.push(unit);
    else roots.push([unit]);
  }
  return roots;
}

/** The zones of a band, outermost first. */
function bandFrames(band: Band): BandFrame[] {
  const frames = new Map<string, BandFrame>();
  for (const unit of band.units) {
    unit.chain.forEach((group, depth) => {
      const frame = frames.get(group.id);
      if (frame) frame.c1 = unit.c1;
      else frames.set(group.id, { group, depth, c0: unit.c0, c1: unit.c1 });
    });
  }
  return [...frames.values()];
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
  for (let perBand = Math.min(5, rootsOf(units).length); perBand >= 1; perBand--) {
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
  const width = (unit: Unit) => Math.min(inner, Math.max(1, new Set(localColumns(unit, env).values()).size));
  const slices: Unit[][] = [];
  const roots = rootsOf(units);
  for (let start = 0; start < roots.length; start += perBand) {
    const slice = roots.slice(start, start + perBand);
    if (slice.length > 1 || slice.flat().reduce((sum, unit) => sum + width(unit), 0) <= cap) {
      slices.push(slice.flat());
      continue;
    }
    // A nested zone too wide for the width breaks across bands, and has them to itself.
    let line: Unit[] = [];
    let used = 0;
    for (const unit of slice.flat()) {
      if (line.length > 0 && used + width(unit) > cap) {
        slices.push(line);
        line = [];
        used = 0;
      }
      line.push(unit);
      used += width(unit);
    }
    slices.push(line);
  }
  for (const slice of slices) {
    const members = slice.map((unit) => ({ ...unit }));
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
  const steps = env.data.edges.filter((edge) => ids.has(edge.source.nodeId) && ids.has(edge.target.nodeId) && !selfLoop(edge))
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
  const placed = data.nodes.filter((node) => node.laneId !== undefined);
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
  const units: Unit[] = [{ chain: [], nodes: placed, c0: 0, c1: cols - 1 }];
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

const lockWidth = (node: DiagramNode, u: number) => (node.protected ? 3.5 * u : 0);

/** What a repeated node gives up to its stacked copies. */
const stackOf = (node: DiagramNode) => (node.repeat ? (node.repeat - 1) * REPEAT_STEP : 0);

/** A repeated node's own card, in the top left of the rectangle that its stack fills. */
function frontRect(node: DiagramNode, rect: Rect): Rect {
  const stack = stackOf(node);
  return stack === 0 ? rect : { ...rect, w: rect.w - stack, h: rect.h - stack };
}

/** The curve of a store's ends. */
const storeCap = (node: DiagramNode, u: number) => (node.shape.kind === 'store' ? 2 * u : 0);

function nodeText(node: DiagramNode, width: number, env: Env): NodeText | undefined {
  const { name, text, measure, options, u } = env;
  const inner = width - 4 * u - (node.icon ? 3.5 * u : 0) - lockWidth(node, u);
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
  const narrowLaneGrid = !!arrangement.labelAbove && arrangement.bands.some((band) => band.cols > 1);
  const laneZoneGap = narrowLaneGrid ? Math.max(0, titleH / 2 + 2 - 2 * u) : 0;
  const innerGap = 2 * GAP_HALF;
  const unitGap = 2 * GAP_HALF;
  const gap = (key: string, base: number) => Math.max(base, gaps.get(key) ?? 0);
  const geometry: Geometry = { rects: new Map(), textBoxes: new Map(), icons: new Map(), badges: new Map(), zones: [], loops: [], locks: new Map(), lanes: [], labelClaims: [], xs: [], ys: [], gaps: [], width: plot.w };
  const outerL = gap('oL', 0);
  const outerR = gap('oR', 0);
  const laneLabel = lanesFlow && !arrangement.labelAbove ? laneLabelWidth(env) : 0;
  // A dashed zone's frame stands 1.5 u off its nodes and stays in the plot.
  const frameInset = lanesFlow && env.data.groups.some((group) => group.kind !== 'policy') ? 1.5 * u + 1 : 0;
  const left = plot.x + laneLabel + outerL + frameInset;
  const right = plot.x + plot.w - outerR - frameInset;
  const axisX: Array<[number, string?]> = [[left - Math.max(outerL, 2 * PITCH) / 2, 'oL'], [right + Math.max(outerR, 2 * PITCH) / 2, 'oR']];
  const axisY: Array<[number, string?]> = [];
  const strip = placePolicy(geometry, env);
  if (strip === undefined) {
    if (!force) return undefined;
  }
  const flowTop = plot.y + (strip ?? 0);
  let y = flowTop;
  const spans = new Map<string, { frame: BandFrame; x0: number; x1: number; y0: number; y1: number; lines: string[]; opened: number }>();

  for (const [b, band] of arrangement.bands.entries()) {
    const key = (axis: string, index: number) => `${axis}:${b}:${index}`;
    const frames = lanesFlow ? [] : bandFrames(band);
    const opening = frames.filter((frame) => !spans.has(frame.group.id));
    const unitAfter = new Set(band.units.map((unit) => unit.c1));
    let fixed = 0;
    for (let c = 0; c + 1 < band.cols; c++) fixed += gap(key('v', c), unitAfter.has(c) ? unitGap : innerGap);
    if (!lanesFlow) fixed += frames.length * 2 * pad;
    const avail = right - left - fixed;
    if (avail / band.cols < 1 && !force) return undefined;
    const fair = Math.max(1, avail / band.cols);
    // A short pipeline keeps its boxes in proportion, and the gutters take the rest.
    const columnW = band.units.length > 1 || band.cols > 1 ? Math.min(fair, 60 * u) : fair;
    const spare = band.cols > 1 ? (avail - columnW * band.cols) / (band.cols - 1) : 0;
    const colX: number[] = [];
    let x = left;
    for (let c = 0; c < band.cols; c++) {
      x += frames.filter((frame) => frame.c0 === c).length * pad;
      colX[c] = q(x);
      x += columnW;
      x += frames.filter((frame) => frame.c1 === c).length * pad;
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
      const stack = stackOf(cell.node);
      const text = nodeText(cell.node, width - stack, env);
      if (!text) {
        if (!force) return undefined;
      }
      const badge = env.badges.get(cell.node.id);
      const height = Math.max(11 * u, (text?.height ?? 0) + 3 * u + (badge ? badge.height + 0.5 * u : 0) + 2 * storeCap(cell.node, u)) + stack;
      textH.set(cell.node.id, text?.height ?? 0);
      heights.set(cell.node.id, height);
      if (cell.r0 === cell.r1) rowH[cell.r0] = Math.max(rowH[cell.r0]!, height);
    }

    const lines = new Map<string, string[]>();
    // One title row for each depth that opens here. A child's frame starts below its parent's title.
    const rowsAt: number[] = [];
    for (const frame of opening) {
      const width = colX[frame.c1]! + columnW - colX[frame.c0]! + 2 * pad - 2 * u - (frame.group.protected ? 3.5 * u : 0);
      const wrapped = wrapText(frame.group.title, title, width, 2, measure);
      if (wrapped.truncated && !force) return undefined;
      lines.set(frame.group.id, wrapped.lines);
      rowsAt[frame.depth] = Math.max(rowsAt[frame.depth] ?? 0, wrapped.lines.length * titleH + 2 * u);
    }
    const topAt = (depth: number) => {
      let at = 0;
      for (let d = 0; d < depth; d++) at += (rowsAt[d] ?? 0) + u;
      return at;
    };
    const deepest = Math.max(-1, ...frames.map((frame) => frame.depth));
    const head = opening.length > 0 ? topAt(rowsAt.length - 1) + rowsAt.at(-1)! + 1.5 * u : 0;
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
        cursor += headerH + 2 * u + (framedLane ? titleH / 2 + u + laneZoneGap : 0);
      }
      rowY[r] = q(cursor);
      cursor += rowH[r]!;
      axisY.push([rowY[r]! + rowH[r]! / 2]);
      // A self-loop hangs below its node, with its label under it, clear of any corridor.
      const loop = env.data.edges.filter((edge) => selfLoop(edge) && own.some((cell) => cell.r1 === r && cell.node.id === edge.source.nodeId));
      if (loop.length > 0) cursor += LOOP_REACH * u + PITCH + (loop.some((edge) => edge.label) ? env.text.size * (env.text.lineHeight ?? 1.2) + TEXT_CLEARANCE + 1 : 0);
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
    const bandBottom = cursor + (deepest + 1) * pad;
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
      const id = cell.node.id;
      geometry.rects.set(id, qRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }));
      // The stack takes the bottom right of the cell, and the rest reads as an ordinary node.
      const rect = frontRect(cell.node, geometry.rects.get(id)!);
      const badge = env.badges.get(id);
      const cap = storeCap(cell.node, u);
      const reserve = (badge ? badge.height + 0.5 * u : 0) + 2 * cap;
      if (badge) geometry.badges.set(id, qRect({ x: rect.x + rect.w - badge.width - u - lockWidth(cell.node, u), y: rect.y + u, ...{ w: badge.width, h: badge.height } }));
      const icon = cell.node.icon ? 3.5 * u : 0;
      const box = textH.get(id)!;
      const bodyTop = rect.y + reserve + (rect.h - reserve - box) / 2;
      geometry.textBoxes.set(id, qRect({ x: rect.x + 2 * u + icon, y: bodyTop - 0.5, w: rect.w - 4 * u - icon - lockWidth(cell.node, u), h: box + 1 }));
      if (icon) geometry.icons.set(id, qRect({ x: rect.x + 2 * u, y: bodyTop + (env.name.size * 1.2 - 2.5 * u) / 2, w: 2.5 * u, h: 2.5 * u }));
    }

    for (const frame of frames) {
      // A frame stands one pad outside each frame that opens or closes on the same column inside it.
      const within = (edge: 'c0' | 'c1') => frames.filter((other) => other[edge] === frame[edge] && other.depth > frame.depth).length + 1;
      const x0 = colX[frame.c0]! - within('c0') * pad;
      const x1 = colX[frame.c1]! + columnW + within('c1') * pad;
      const y1 = bandBottom - frame.depth * pad;
      // A route that stays in the parent runs between the parent's frame and this one.
      if (frame.depth > 0) axisX.push([x0 - pad / 2], [x1 + pad / 2]);
      const span = spans.get(frame.group.id);
      if (span) {
        span.x0 = Math.min(span.x0, x0);
        span.x1 = Math.max(span.x1, x1);
        span.y1 = y1;
      } else spans.set(frame.group.id, { frame, x0, x1, y0: top + topAt(frame.depth), y1, lines: lines.get(frame.group.id)!, opened: b });
    }
    y = bandBottom;
    if (b + 1 < arrangement.bands.length) {
      const width = gap(`b:${b}`, 2 * GAP_HALF);
      geometry.gaps.push({ key: `b:${b}`, axis: 'h', rect: { x: plot.x, y, w: plot.w, h: width } });
      axisY.push([y + width / 2, `b:${b}`]);
      y += width;
    }
  }
  for (const { frame, x0, x1, y0, y1, lines } of spans.values()) {
    const width = Math.max(...lines.map((line) => measure(line, title).width));
    const titleBox = qRect({ x: x0 + 2 * u - 4, y: y0 + 2 * u, w: width + 8, h: lines.length * titleH });
    geometry.labelClaims.push(titleBox);
    if (frame.group.protected) addZoneLock(geometry, frame.group.id, titleBox, u);
    geometry.zones.push({ id: frame.group.id, bounds: qRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }), titleBox,
      memberNodeIds: zoneMembers(frame.group.id, env), dashed: false, depth: frame.depth });
  }
  geometry.gaps.push({ key: 'oL', axis: 'v', rect: { x: left - Math.max(outerL, 2 * PITCH), y: flowTop, w: Math.max(outerL, 2 * PITCH), h: y - flowTop } });
  geometry.gaps.push({ key: 'oR', axis: 'v', rect: { x: right, y: flowTop, w: Math.max(outerR, 2 * PITCH), h: y - flowTop } });
  const bottom = gap('oB', 0);
  axisY.push([y + Math.max(bottom, 2 * PITCH) / 2, 'oB']);
  geometry.gaps.push({ key: 'oB', axis: 'h', rect: { x: plot.x, y, w: plot.w, h: Math.max(bottom, 2 * PITCH) } });

  if (lanesFlow) laneZones(geometry, env, laneZoneGap);
  geometry.xs = corridorLines(axisX);
  geometry.ys = corridorLines(axisY);
  return geometry;
}

const zoneMembers = (id: string, env: Env) => env.data.nodes.filter((node) => node.groupId !== undefined && groupWithin(env.data.groups, node.groupId, id)).map((node) => node.id);

function addZoneLock(geometry: Geometry, id: string, titleBox: Rect, u: number): void {
  const size = 2.5 * u;
  const lock = qRect({ x: titleBox.x + titleBox.w, y: titleBox.y + (Math.min(titleBox.h, 3 * u) - size) / 2, w: size, h: size });
  geometry.locks.set(id, lock);
  geometry.labelClaims.push(lock);
}

/**
 * The policy strip: a dashed frame across the top, with its title on the frame
 * and its items in equal columns, as many as keep each on one line.
 */
function placePolicy(geometry: Geometry, env: Env): number | undefined {
  const { data, plot, name, title, measure, u } = env;
  const group = data.groups.find((item) => item.kind === 'policy');
  if (!group) return 0;
  const items = data.nodes.filter((node) => node.groupId === group.id);
  const titleH = title.size * (title.lineHeight ?? 1.2);
  const pad = 2 * u;
  const inner = plot.w - 2 * pad;
  const wide = (node: DiagramNode) => measure(node.label, name).width + (node.icon ? 3.5 * u : 0);
  const longest = Math.max(1, ...items.map(wide));
  const columnsWide = Math.max(1, Math.min(items.length, Math.floor((inner + pad) / (longest + pad))));
  const columnW = (inner - (columnsWide - 1) * pad) / columnsWide;
  const y0 = plot.y + titleH / 2;
  // The items start below the title that sits on the frame.
  let y = y0 + titleH / 2 + u;
  for (let start = 0; start < items.length; start += columnsWide) {
    const row = items.slice(start, start + columnsWide);
    const texts = row.map((node) => nodeText(node, columnW + 4 * u, env));
    if (texts.some((text) => !text)) return undefined;
    const height = Math.max(...texts.map((text) => text!.height));
    row.forEach((node, index) => {
      const rect = qRect({ x: plot.x + pad + index * (columnW + pad), y, w: columnW, h: height });
      const icon = node.icon ? 3.5 * u : 0;
      geometry.rects.set(node.id, rect);
      geometry.textBoxes.set(node.id, { ...rect, x: q(rect.x + icon), w: q(rect.w - icon) });
      if (icon) geometry.icons.set(node.id, qRect({ x: rect.x, y: rect.y + (name.size * 1.2 - 2.5 * u) / 2, w: 2.5 * u, h: 2.5 * u }));
    });
    y += height + u;
  }
  const y1 = y - u + 1.5 * u;
  const titleBox = qRect({ x: plot.x + 2 * u - 4, y: y0 - titleH / 2, w: measure(group.title, title).width + 8, h: titleH });
  geometry.labelClaims.push(titleBox);
  geometry.zones.push({ id: group.id, bounds: qRect({ x: plot.x, y: y0, w: plot.w, h: y1 - y0 }), titleBox, memberNodeIds: items.map((node) => node.id), dashed: true, depth: 0, policy: true });
  return y1 + 3 * u - plot.y;
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
function laneZones(geometry: Geometry, env: Env, clearance: number): void {
  const { data, title, measure, u } = env;
  for (const group of data.groups) {
    const members = data.nodes.filter((node) => node.groupId === group.id);
    if (members.length === 0 || group.kind === 'policy') continue;
    const rects = members.map((node) => geometry.rects.get(node.id)!);
    const x0 = Math.min(...rects.map((rect) => rect.x)) - 1.5 * u;
    // The title centres on the top line and keeps clear of the nodes below it.
    const y0 = Math.min(...rects.map((rect) => rect.y)) - 2 * u - clearance;
    const x1 = Math.max(...rects.map((rect) => rect.x + rect.w)) + 1.5 * u;
    const y1 = Math.max(...rects.map((rect) => rect.y + rect.h)) + 1.5 * u;
    const bounds = qRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    const height = title.size * (title.lineHeight ?? 1.2);
    const width = measure(group.title, title).width;
    const titleBox = qRect({ x: x0 + 2 * u - 4, y: y0 - height / 2, w: width + 8, h: height });
    geometry.labelClaims.push(titleBox);
    if (group.protected) addZoneLock(geometry, group.id, titleBox, u);
    geometry.zones.push({ id: group.id, bounds, titleBox, memberNodeIds: members.map((node) => node.id), dashed: true, depth: 0 });
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

// The router asks for this on every grid step, so each edge keeps its key.
const styleKeys = new WeakMap<DiagramEdge, string>();
function styleOf(edge: DiagramEdge): string {
  let key = styleKeys.get(edge);
  if (key === undefined) styleKeys.set(edge, key = [edge.dash ?? 'solid', edge.weight ?? 'normal', edge.role ?? '', edge.paletteKey ?? '', edge.flow ?? 'forward', edge.arrowStart ? 1 : 0].join('|'));
  return key;
}

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
  // Each self-loop holds its corner of the gutter before any other edge routes.
  const loops = new Map(data.edges.filter(selfLoop).map((edge) => [edge.id, selfLoopRoute(rects.get(edge.source.nodeId)!, env)]));
  geometry.loops = [...loops.values()].map(([a, b, c]) => ({ x: a!.x, y: a!.y, w: c!.x - a!.x, h: b!.y - a!.y }));
  const blocked = obstacleGrid(geometry, W, H);
  const zones = geometry.zones.filter((zone) => !zone.policy);
  const frameUse = frameCrossings(geometry, zones, W, H);
  const walledH = new Uint8Array(W * H);
  const walledV = new Uint8Array(W * H);
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
    if (loops.has(edge.id)) {
      runs.push([]);
      sides.push({ source: 'bottom', target: 'bottom' });
      return;
    }
    const sourceRect = endRect(edge, 'source', geometry, data);
    const targetRect = endRect(edge, 'target', geometry, data);
    walledH.fill(0);
    walledV.fill(0);
    zones.forEach((zone, index) => {
      if (mustCross(edge, zone, data)) return;
      for (const seg of frameUse[index]!.h) walledH[seg] = 1;
      for (const seg of frameUse[index]!.v) walledV[seg] = 1;
    });
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
        if ([...geometry.labelClaims, ...geometry.loops].some((claim) => segmentHits(stubA, stubB, grown(claim, TEXT_CLEARANCE)))) continue;
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
        if ((horizontal ? walledH : walledV)[seg]) step += ZONE_COST;
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
  order.forEach((edge, index) => {
    const loop = loops.get(edge.id);
    if (loop) polylines[index] = loop;
  });

  const routes = new Map<string, FixedRoute>();
  order.forEach((edge, index) => {
    if (polylines[index]!.length === 0) return;
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
  problems.push(...lineProblems(order, polylines, rects, geometry, data, zones));
  const unseated: string[] = [];
  const labels = placeLabels(order, polylines, geometry, env, needs, unseated, outward);
  problems.push(...unseated);
  const channels = placeChannels(order, polylines, geometry, labels, env, needs, problems);
  return { routes, dots: junctions(order, polylines), labels, channels, problems, needs, unseated };
}

/** What an edge end stands on: its node, or the zone it names. */
function endRect(edge: DiagramEdge, end: 'source' | 'target', geometry: Geometry, data: NormalizedDiagram): Rect {
  const group = data.groupEnds.get(edge.id)?.[end];
  return group === undefined ? geometry.rects.get(edge[end].nodeId)! : geometry.zones.find((zone) => zone.id === group)!.bounds;
}

/** Whether an end sits inside a zone. An end on the zone's own frame counts as outside. */
function endInside(edge: DiagramEdge, end: 'source' | 'target', zone: Geometry['zones'][number], data: NormalizedDiagram): boolean {
  const group = data.groupEnds.get(edge.id)?.[end];
  if (group === undefined) return zone.memberNodeIds.includes(edge[end].nodeId);
  return group !== zone.id && groupWithin(data.groups, group, zone.id);
}

const heldInZone = (edge: DiagramEdge, geometry: Geometry, data: NormalizedDiagram) =>
  geometry.zones.some((zone) => !zone.policy && endInside(edge, 'source', zone, data) && endInside(edge, 'target', zone, data));

const mustCross = (edge: DiagramEdge, zone: Geometry['zones'][number], data: NormalizedDiagram) => endInside(edge, 'source', zone, data) !== endInside(edge, 'target', zone, data);

/** The grid steps that cross each zone's frame. */
function frameCrossings(geometry: Geometry, zones: Geometry['zones'], W: number, H: number): Array<{ h: number[]; v: number[] }> {
  const { xs, ys } = geometry;
  const stepOver = (lines: readonly { pos: number }[], frame: number) => lines.findIndex((line, index) => index + 1 < lines.length && line.pos < frame && frame < lines[index + 1]!.pos);
  return zones.map(({ bounds: { x, y, w, h: tall } }) => {
    const h: number[] = [];
    const v: number[] = [];
    for (const frame of [x, x + w]) {
      const i = stepOver(xs, frame);
      if (i >= 0) for (let j = 0; j < H; j++) if (ys[j]!.pos > y && ys[j]!.pos < y + tall) h.push(i + j * W);
    }
    for (const frame of [y, y + tall]) {
      const j = stepOver(ys, frame);
      if (j >= 0) for (let i = 0; i < W; i++) if (xs[i]!.pos > x && xs[i]!.pos < x + w) v.push(i + j * W);
    }
    return { h, v };
  });
}

/** Where a route crosses a zone's frame. */
function frameHits(points: readonly Point[], { x, y, w, h }: Rect): Point[] {
  const hits: Point[] = [];
  forSegments(points, (a, b) => {
    const [lo, hi] = [{ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) }, { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) }];
    if (a.y === b.y && a.y > y && a.y < y + h) for (const frame of [x, x + w]) if (lo.x < frame && frame < hi.x) hits.push({ x: frame, y: a.y });
    if (a.x === b.x && a.x > x && a.x < x + w) for (const frame of [y, y + h]) if (lo.y < frame && frame < hi.y) hits.push({ x: a.x, y: frame });
  });
  return hits;
}

/** A small loop under the right end of a node, clear of the ports at the middle of its sides. */
function selfLoopRoute(rect: Rect, env: Env): Point[] {
  const bottom = rect.y + rect.h;
  const reach = snap(bottom + LOOP_REACH * env.u);
  const right = snap(rect.x + rect.w - 2 * env.u);
  const left = snap(right - 4 * env.u);
  return [{ x: left, y: bottom }, { x: left, y: reach }, { x: right, y: reach }, { x: right, y: bottom }];
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
    ...geometry.loops,
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

function lineProblems(order: readonly DiagramEdge[], polylines: readonly Point[][], rects: ReadonlyMap<string, Rect>, geometry: Geometry, data: NormalizedDiagram, zones: Geometry['zones']): string[] {
  const problems: string[] = [];
  order.forEach((edge, index) => {
    const points = polylines[index]!;
    if (points.length === 0) return;
    // A track offset can push an end past its node's side, so the line would float.
    if (!touches(points[0]!, endRect(edge, 'source', geometry, data)) || !touches(points.at(-1)!, endRect(edge, 'target', geometry, data))) problems.push(edge.id);
    // Each edge crosses the frames on its path through the zones, once each.
    // A return edge inside an open zone may loop out through its gutter and back.
    for (const zone of zones) {
      const loops = edge.flow === 'return' && endInside(edge, 'source', zone, data) && endInside(edge, 'target', zone, data)
        && !data.groups.find((group) => group.id === zone.id)?.protected;
      if (frameHits(points, zone.bounds).length > (mustCross(edge, zone, data) ? 1 : loops ? 2 : 0)) problems.push(edge.id);
    }
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
    // A callout on this edge sits at the end of its label, inside the same seat.
    const disc = env.data.callouts.some((callout) => 'edgeId' in callout.target && callout.target.edgeId === edge.id) ? DISC_UNITS * env.u + 2 : 0;
    const blocks = [{ width: one + disc, height: Math.max(lineH, disc) }];
    const three = wrapText(edge.label, text, Math.ceil(one * 0.42), 3, measure);
    for (const wrapped of [two, three]) {
      if (!wrapped.truncated && wrapped.lines.length > 1) blocks.push({ width: Math.ceil(Math.max(...wrapped.lines.map((line) => measure(line, text).width))) + 1 + disc, height: wrapped.lines.length * lineH });
    }
    const rows = geometry.gaps.filter((item) => item.axis === 'h');
    const seats = blocks.flatMap(({ width, height }) => [
      ...flat.flatMap(([a, b]) => {
        // A run near the plot edge keeps its label inside the plot.
        const inPlot = (x: number) => Math.max(env.plot.x, Math.min(x, env.plot.x + env.plot.w - width));
        // Besides the middle of the run, each side of a gutter it crosses, clear of a trunk there.
        const columns = geometry.gaps.filter((item) => item.axis === 'v' && Math.min(a.x, b.x) <= item.rect.x && Math.max(a.x, b.x) >= item.rect.x + item.rect.w);
        // And the middle of each stretch between a zone frame and the end of the run.
        const walls = geometry.zones.flatMap(({ bounds }) => [bounds.x, bounds.x + bounds.w]).filter((x) => x > Math.min(a.x, b.x) && x < Math.max(a.x, b.x));
        const spots = [(a.x + b.x) / 2, ...columns.flatMap(({ rect }) => [rect.x + rect.w / 4, rect.x + (3 * rect.w) / 4]),
          ...walls.flatMap((x) => [(a.x + x) / 2, (b.x + x) / 2])];
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
        // The middle of each stretch between a zone frame and the end of the run.
        const walls = geometry.zones.flatMap(({ bounds }) => [bounds.y, bounds.y + bounds.h]).filter((wall) => wall > Math.min(a.y, b.y) && wall < Math.max(a.y, b.y));
        return [...beside(y), ...walls.flatMap((wall) => [...beside((a.y + wall) / 2 - height / 2), ...beside((b.y + wall) / 2 - height / 2)]), ...crossed.flatMap((row) => {
          const top = row.rect.y + (row.rect.h - height) / 2;
          return [...beside(top), ...inset(top)];
        })];
      }),
    ]).map(qRect);
    const clear = (box: Rect) => labelClear(box, polylines, blockers, env.plot);
    const seat = seats.find((box) => clear(box) && (!env.ownReturnLabels || edge.flow !== 'return'
      || polylines.every((line, i) => i === index || rectLineDistance(box, points) <= rectLineDistance(box, line))));
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
  if (node.shape.kind === 'text') return { fill: { token: 'background' } };
  const plain = node.role === undefined || node.role === 'primary';
  const lane = lanes.findIndex((item) => item.id === node.laneId);
  if (node.protected && (plain || node.role === 'secondary' || node.role === 'muted')) return { fill: { token: 'total', tint: PROTECTED_TINT }, ring: 'axis' };
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
  const groupById = new Map(data.groups.map((group) => [group.id, group]));
  const zoneFills = new Map<string, Paint>();
  for (const zone of geometry.zones) {
    if (groupById.get(zone.id)!.protected) zoneFills.set(zone.id, { token: 'total', tint: PROTECTED_TINT });
    // Nested zones alternate, so a child stands apart from its parent without a stronger tint.
    else if (zone.depth % 2 === 1) zoneFills.set(zone.id, { token: 'background' });
  }

  const calloutEdges = new Set(data.callouts.flatMap((callout) => ('edgeId' in callout.target ? [callout.target.edgeId] : [])));
  for (const [id, label] of routed.labels) {
    const route = routed.routes.get(id);
    // A callout's disc takes the end of the seat, and the label keeps the rest.
    if (route) route.labelBox = calloutEdges.has(id) ? { ...label, w: label.w - DISC_UNITS * env.u - 2 } : label;
  }
  const scene: SceneNode[] = [];
  const claims: OrgChartLayout['preset']['decorationClaims'] = [];
  const overlay: SceneNode[] = [];
  const ink: Paint = { token: 'inkMuted' };
  const lock = (id: string, box: Rect, owner: SceneNode['owner']) => compileIcon('lock', box).forEach((primitive, index) => {
    const common = { id: diagramSceneId('lock', id, String(index)), owner, part: 'diagramIcon' };
    overlay.push((primitive.kind === 'circle'
      ? { t: 'circle', ...common, cx: primitive.cx, cy: primitive.cy, r: primitive.r, stroke: ink, strokeWidth: strokeToken(theme, 'rule') }
      : { t: 'path', ...common, d: primitive.d, stroke: ink, width: strokeToken(theme, 'rule'), lineCap: 'round' }) as SceneNode);
  });
  const innerFrame = (id: string, rect: Rect, owner: SceneNode['owner']) => {
    const [x, y, w, h] = [q(rect.x + PROTECTED_INSET), q(rect.y + PROTECTED_INSET), q(rect.w - 2 * PROTECTED_INSET), q(rect.h - 2 * PROTECTED_INSET)];
    return { t: 'path', id: diagramSceneId('protected', id), d: `M${x} ${y}H${q(x + w)}V${q(y + h)}H${x}Z`, stroke: { token: 'axis' }, width: hair, owner, part: 'diagramGroup' } as SceneNode;
  };
  const fronts = new Map<string, Rect>();
  for (const node of data.nodes) {
    const rect = geometry.rects.get(node.id)!;
    const front = frontRect(node, rect);
    fronts.set(node.id, front);
    for (let copy = (node.repeat ?? 1) - 1; copy >= 1; copy--) {
      scene.push({ t: 'rect', id: diagramSceneId('node', node.id, `copy-${copy}`), rect: qRect({ ...front, x: front.x + copy * REPEAT_STEP, y: front.y + copy * REPEAT_STEP }),
        fill: fills.get(node.id)!, stroke: { token: 'axis' }, strokeWidth: hair, owner: nodeOwner(node.id), part: 'diagramNode' } as SceneNode);
    }
    if (node.protected) {
      overlay.push(innerFrame(node.id, front, nodeOwner(node.id)));
      const size = 2.5 * env.u;
      lock(node.id, qRect({ x: front.x + front.w - size - 1.5 * env.u, y: front.y + 1.5 * env.u, w: size, h: size }), nodeOwner(node.id));
    }
  }
  for (const zone of geometry.zones) {
    if (!groupById.get(zone.id)!.protected) continue;
    (zone.dashed ? overlay : scene).push(innerFrame(zone.id, zone.bounds, { seriesId: zone.id }));
    lock(zone.id, geometry.locks.get(zone.id)!, { seriesId: zone.id });
  }
  // A hollow marker where a channel edge or any edge crosses a protected frame. It claims no security property.
  const channelled = new Set(data.channels.flatMap((channel) => channel.edgeIds));
  const marked = new Map<string, Point>();
  for (const edge of data.edges) {
    const route = routed.routes.get(edge.id);
    if (!route) continue;
    for (const zone of geometry.zones) {
      if (zone.policy || (!channelled.has(edge.id) && !groupById.get(zone.id)!.protected)) continue;
      for (const hit of frameHits(route.points, zone.bounds)) marked.set(`${hit.x}:${hit.y}`, hit);
    }
  }
  [...marked.keys()].sort().forEach((key, index) => {
    const hit = marked.get(key)!;
    overlay.push({ t: 'circle', id: diagramSceneId('boundary', String(index)), cx: hit.x, cy: hit.y, r: 2.5, fill: { token: 'background' }, stroke: { token: 'axis' }, strokeWidth: hair, owner: {}, part: 'diagramJunction' } as SceneNode);
  });
  const disc = DISC_UNITS * env.u;
  const discs = data.callouts.map((callout, index) => {
    const target = callout.target;
    const seat = (point: Point) => qRect({ x: point.x - disc / 2, y: point.y - disc / 2, w: disc, h: disc });
    const text = String(index + 1);
    if ('nodeId' in target) {
      const front = fronts.get(target.nodeId)!;
      const node = data.nodes.find((item) => item.id === target.nodeId)!;
      // The top right corner, clear of a zone title and of a lock or badge inside the node.
      const inset = (node.protected || node.badge ? 6 : 2) * env.u;
      return { id: callout.id, text, rect: seat({ x: front.x + front.w - inset - disc / 2, y: front.y }), owner: nodeOwner(target.nodeId) };
    }
    if ('groupId' in target) {
      const zone = geometry.zones.find((item) => item.id === target.groupId)!;
      return { id: callout.id, text, rect: seat({ x: zone.bounds.x + zone.bounds.w - 3 * env.u, y: zone.bounds.y }), owner: { seriesId: zone.id } };
    }
    const label = routed.labels.get(target.edgeId);
    if (label) return { id: callout.id, text, rect: qRect({ x: label.x + label.w - disc, y: label.y + (label.h - disc) / 2, w: disc, h: disc }), owner: edgeOwner(target.edgeId) };
    const points = routed.routes.get(target.edgeId)!.points;
    let longest: [Point, Point] = [points[0]!, points[1]!];
    const length = ([a, b]: [Point, Point]) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    forSegments(points, (a, b) => { if (length([a, b]) > length(longest)) longest = [a, b]; });
    return { id: callout.id, text, rect: seat({ x: (longest[0].x + longest[1].x) / 2, y: (longest[0].y + longest[1].y) / 2 }), owner: edgeOwner(target.edgeId) };
  });
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
    scene.push({ t: 'path', id: diagramSceneId('group', zone.id), d: `M${x} ${y}H${x + w}V${y + h}H${x}Z`, fill: zoneFills.get(zone.id) ?? { token: 'background' }, stroke: { token: 'axis' }, width: hair,
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
  const paths = new Map(data.nodes.filter((node) => node.shape.kind === 'store').map((node) => [node.id, storePath(fronts.get(node.id)!, storeCap(node, env.u))]));
  const extent = [...routed.routes.values()].flatMap((route) => [...route.points.map((point) => ({ x: point.x, y: point.y, w: 1, h: 1 })), ...(route.labelBox ? [route.labelBox] : [])]);
  const bottom = Math.max(...extent.map((rect) => rect.y + rect.h), ...[...geometry.rects.values()].map((rect) => rect.y + rect.h));
  if (bottom > env.plot.y + env.plot.h + 1) {
    warnings.push({ code: 'diagram-size-too-small', severity: 'error', message: `architecture needs ${Math.ceil(bottom - env.plot.y - env.plot.h)} px more height` });
  }

  const policy = data.nodes.filter((node) => geometry.zones.some((zone) => zone.policy && zone.memberNodeIds.includes(node.id))).map((node) => node.id);
  const readingOrder = [...policy, ...[...arrangement.cells.values()].sort((a, b) => a.band - b.band || a.c0 - b.c0 || a.r0 - b.r0 || (a.node.id < b.node.id ? -1 : 1)).map((cell) => cell.node.id)];
  const fonts = new Map(data.nodes.map((node) => [node.id, name]));
  return {
    mode: 'columns',
    preset: {
      nodeRects: fronts, readingOrder, edges, syntheticEdgeIds: [],
      groups: geometry.zones.map(({ id, bounds, titleBox, memberNodeIds }) => ({ id, bounds, titleBox, memberNodeIds })),
      lanes, decorationScene: scene, decorationClaims: claims, contentTopReserves: new Map(),
    },
    routes: routed.routes, fonts, labelBoxes: geometry.textBoxes, icons: geometry.icons, rings, fills, plainShape: true, paths, overlay, discs,
    badges: geometry.badges, labelInks: new Map(), laneFills: new Map(data.lanes.map((lane) => [lane.id, { token: 'background' as const }])),
    extent, edgePaint: { token: 'inkMuted' }, secondaryFont: env.text,
    groupPaint: {
      fill: { token: 'total', tint: ZONE_TINT }, stroke: { token: 'axis' }, fills: zoneFills,
      dashed: new Set(geometry.zones.filter((zone) => zone.dashed).map((zone) => zone.id)),
    },
    warnings,
    channelLabels: routed.channels.map((channel) => ({ id: `channel-label:${channel.id}`, text: channel.label, rect: channel.rect, owner: edgeOwner(channel.edgeId) })),
  };
}
