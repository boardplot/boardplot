import { fmtPathNumber as fmtN } from '../../curve';
import { strokeToken, dashToken } from '../../theme';
/**
 * Scatter Pareto line (options.frontier): the drawn points that no other drawn
 * point beats on both axes, joined in x order by a dotted ink line under the
 * points. The engine picks the points, so a verifier can pick them again from
 * the data. Pixel positions come from the plot's own x and y scales, so the
 * line follows whatever scale the axes draw.
 */

import type { Rect } from '../../geometry';
import type { OccupiedIndex } from '../../label/occupied';
import type { Id } from '../../types/cell';
import type { LintWarning, SceneNode } from '../../types/scene';
import type { ScatterClampPlan } from './clamp';
import { type NormPt, type ScatterEnv, type ScatterPlotArea } from './model';

type FrontierSide = 'min' | 'max';

export interface FrontierPlan {
  x: FrontierSide;
  y: FrontierSide;
  /** The frontier points in x order, the order the line runs through them. */
  ids: Id[];
}

/** Dotted, and keyed with the same stroke. */
/** How far `extend` runs the line past its end points, before clipping to the plot. */
const FRONTIER_EXTEND = 24;

/**
 * The points no other point beats: q beats p when q is at least as good on
 * both axes and better on one. Exact ties beat neither, so both stay.
 * Sorted by x, then y, which is the order the line runs through them.
 */
function paretoFront<T extends { x: number; y: number }>(points: readonly T[], better: { x: FrontierSide; y: FrontierSide }): T[] {
  const sx = better.x === 'min' ? -1 : 1;
  const sy = better.y === 'min' ? -1 : 1;
  const beats = (q: T, p: T) => sx * q.x >= sx * p.x && sy * q.y >= sy * p.y && (sx * q.x > sx * p.x || sy * q.y > sy * p.y);
  // shortcut: O(n²) dominance scan; a sort-and-sweep pass if a frontier ever runs over tens of thousands of points.
  return points.filter((p) => !points.some((q) => beats(q, p))).sort((a, b) => a.x - b.x || a.y - b.y);
}

/** The frontier options.frontier asks for over the drawn points; undefined, with a warning, when it has fewer than two. */
export function planFrontier(env: ScatterEnv, drawn: readonly NormPt[], warnings: LintWarning[]): FrontierPlan | undefined {
  const frontier = env.options.frontier;
  if (!frontier) return undefined;
  const groups = frontier.groups === undefined || frontier.groups === 'all' ? undefined : new Set(frontier.groups);
  const missing = groups ? [...groups].filter((id) => !drawn.some((p) => p.group === id)) : [];
  if (missing.length) {
    warnings.push({
      code: 'frontier-group-empty',
      severity: 'warn',
      message: `the Pareto line skips group${missing.length === 1 ? '' : 's'} ${missing.map((id) => `'${id}'`).join(', ')}: no drawn point belongs to ${missing.length === 1 ? 'it' : 'them'}`,
      suggest: 'correct the group id in frontier.groups, or drop it',
      field: ['options', 'frontier', 'groups'],
    });
  }
  const front = paretoFront(groups ? drawn.filter((p) => p.group !== undefined && groups.has(p.group)) : drawn, frontier);
  if (front.length < 2) {
    warnings.push({
      code: 'frontier-single-point',
      severity: 'warn',
      message: front.length
        ? `no Pareto line: '${front[0]!.label}' beats every other point on both axes, so the frontier is that one point`
        : 'no Pareto line: no drawn point to run it through',
      field: ['options', 'frontier'],
    });
    return undefined;
  }
  return { x: frontier.x, y: frontier.y, ids: front.map((p) => p.id) };
}

/** How far a ray from `from` along the unit vector `dir` may run inside `plot`, at most `max`. */
function reachInside(from: { x: number; y: number }, dir: { x: number; y: number }, plot: Rect, max: number): number {
  const along = (pos: number, d: number, lo: number, hi: number) => (d > 0 ? (hi - pos) / d : d < 0 ? (lo - pos) / d : Infinity);
  return Math.max(0, Math.min(max, along(from.x, dir.x, plot.x, plot.x + plot.w), along(from.y, dir.y, plot.y, plot.y + plot.h)));
}

/** One step past `end`, away from `prev`, clipped to the plot. */
function extendPast(prev: { x: number; y: number }, end: { x: number; y: number }, plot: Rect): { x: number; y: number } {
  const len = Math.hypot(end.x - prev.x, end.y - prev.y);
  if (len === 0) return end;
  const dir = { x: (end.x - prev.x) / len, y: (end.y - prev.y) / len };
  const t = reachInside(end, dir, plot, FRONTIER_EXTEND);
  return { x: end.x + dir.x * t, y: end.y + dir.y * t };
}

/**
 * The line, painted before the points. It claims its path in short slices as
 * the trend line does, so a label keeps off it where it can, and a label with
 * no other seat crosses it on a halo (the solver's `trendLine` rule).
 */
export function drawFrontier(
  plan: FrontierPlan | undefined,
  env: ScatterEnv,
  pts: readonly NormPt[],
  clamp: ScatterClampPlan | undefined,
  area: ScatterPlotArea,
  nodes: SceneNode[],
  claims: OccupiedIndex,
): void {
  if (!plan) return;
  const byId = new Map(pts.map((p) => [p.id, p]));
  const at = (p: NormPt) => ({ x: area.x(clamp ? clamp.project.x(p.x) : p.x), y: area.y(clamp ? clamp.project.y(p.y) : p.y) });
  const path = plan.ids.map((id) => at(byId.get(id)!));
  if (env.options.frontier?.extend) {
    path.unshift(extendPast(path[1]!, path[0]!, area.plot));
    path.push(extendPast(path[path.length - 2]!, path[path.length - 1]!, area.plot));
  }
  const d = path.map((pt, k) => `${k === 0 ? 'M' : 'L'}${fmtN(pt.x)} ${fmtN(pt.y)}`).join('');
  nodes.push({ t: 'path', id: 'frontier', d, stroke: { token: 'ink' }, width: strokeToken(env.theme, 'rule'), dash: dashToken(env.theme, 'dotted'), lineCap: 'round' as const, owner: {}, part: 'frontierLine' });
  for (let k = 1; k < path.length; k++) {
    const from = path[k - 1]!;
    const to = path[k]!;
    const slices = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 8));
    for (let s = 0; s < slices; s++) {
      const x0 = from.x + ((to.x - from.x) * s) / slices;
      const x1 = from.x + ((to.x - from.x) * (s + 1)) / slices;
      const y0 = from.y + ((to.y - from.y) * s) / slices;
      const y1 = from.y + ((to.y - from.y) * (s + 1)) / slices;
      claims.claim({ x: Math.min(x0, x1) - 1, y: Math.min(y0, y1) - 1, w: Math.abs(x1 - x0) + 2, h: Math.abs(y1 - y0) + 2 }, 'annotation', { annotationId: 'frontier' }, 'trendLine');
    }
  }
}
