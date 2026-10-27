import { fmtPathNumber as fmtN } from '../../curve';
import type { Theme } from '../../types/theme';
import { strokeToken, dashToken } from '../../theme';
/**
 * Scatter linear trend: an ordinary least squares fit over the drawn
 * points, one over all of them or one per group. The line runs across the
 * fitted x range only, under the points and clipped to the plot. Slope,
 * intercept and r² go into the claims, and the key entry prints the slope
 * and r²; on the plot the engine prints only the author's label at an end
 * of the line.
 */

import type { OccupiedIndex } from '../../label/occupied';
import { olsFit, olsMoments, clipTrendToDomain, type OlsFit, type OlsMoments } from '../../ols';
import type { Id } from '../../types/cell';
import type { LintWarning, Paint, SceneNode } from '../../types/scene';
import { type NormPt, type ScatterEnv, type ScatterPaints, type ScatterPlotArea } from './model';
import { maxOf, minOf } from '../../arrays';

export interface TrendFit extends OlsMoments, OlsFit {
  /** 'all', or the id of the group the fit runs over. */
  id: Id;
  group?: Id;
  /** The fitted x range; the line is drawn across it and no further. */
  x0: number;
  x1: number;
}

/** Where a fit is drawn, in pixels, after clipping to the plot; absent when none of it is in view. */
export interface TrendLine {
  fit: TrendFit;
  nodeId: Id;
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** The line's pixel y at pixel x: straight on linear axes, the fit mapped through the scales on a log axis. */
  yAt: (px: number) => number;
}

/** Samples of a fit drawn across a log axis, where the straight fit is a curve. */
const CURVE_SAMPLES = 24;

/**
 * The fits the options ask for over the drawn points. A fit over fewer than
 * three points, or over points that share one x, has no honest line and is
 * left out with `trend-undefined`. The fit is in the values on any scale; a
 * log axis bends the drawn line, not the fit.
 */
export function fitScatterTrends(
  env: ScatterEnv,
  drawn: readonly NormPt[],
  groupOrder: readonly Id[],
  warnings: LintWarning[],
): TrendFit[] {
  const trend = env.options.trend;
  if (!trend) return [];
  const groups = trend === true ? 'all' : (trend.groups ?? 'all');
  const buckets: [Id, Id | undefined, NormPt[]][] =
    groups === 'all'
      ? [['all', undefined, [...drawn]]]
      : (groups === 'each' ? eachGroup(drawn, groupOrder) : groups).map((group) => [
          group ?? 'ungrouped',
          group,
          drawn.filter((p) => p.group === group),
        ]);
  const fits: TrendFit[] = [];
  for (const [id, group, points] of buckets) {
    const moments = olsMoments(points);
    const fit = moments.n >= 3 ? olsFit(moments) : null;
    if (!fit) {
      warnings.push({
        code: 'trend-undefined',
        severity: 'warn',
        message: `no trend line for ${group === undefined ? 'the points' : `group '${group}'`}: ${moments.n < 3 ? `a fit needs at least 3 drawn points, it has ${moments.n}` : 'every drawn point has the same x'}`,
        field: ['options', 'trend'],
      });
      continue;
    }
    const xs = points.map((p) => p.x);
    fits.push({ id, ...(group === undefined ? {} : { group }), ...moments, ...fit, x0: minOf(xs), x1: maxOf(xs) });
  }
  return fits;
}

/** The groups with drawn points in declaration order, then the ungrouped points as one more. */
function eachGroup(drawn: readonly NormPt[], groupOrder: readonly Id[]): (Id | undefined)[] {
  const present = new Set(drawn.map((p) => p.group));
  return [...groupOrder.filter((id) => present.has(id)), ...(present.has(undefined) ? [undefined] : [])];
}

/**
 * The trend lines, dashed, painted before the points. Each claims its path in
 * short slices, so a label keeps off it where it can and one bounding box
 * never blocks the corners of a diagonal; a label with no other seat crosses
 * it on a halo (the solver's `trendLine` rule) instead of vanishing.
 */
export function drawScatterTrends(
  theme: Theme,
  fits: readonly TrendFit[],
  domain: { dx: [number, number]; dy: [number, number] },
  area: ScatterPlotArea,
  paints: ScatterPaints,
  nodes: SceneNode[],
  claims: OccupiedIndex,
): TrendLine[] {
  const lines: TrendLine[] = [];
  for (const fit of fits) {
    const span = clipTrendToDomain(fit, domain.dx, domain.dy);
    if (!span) continue;
    const at = (x: number) => ({ x: area.x(x), y: area.y(fit.intercept + fit.slope * x) });
    const from = at(span[0]);
    const to = at(span[1]);
    const nodeId = `trend:${fit.id}`;
    const stroke: Paint = fit.group === undefined ? { token: 'ink' } : paints.group(fit.group);
    const curved = area.x.log === true || area.y.log === true;
    const yAt = curved
      ? (px: number) => area.y(fit.intercept + fit.slope * area.x.invert(px))
      : (px: number) => from.y + ((to.y - from.y) * (px - from.x)) / (to.x - from.x || 1);
    const slices = curved ? CURVE_SAMPLES : 12;
    const vertices = Array.from({ length: slices + 1 }, (_, k) => {
      if (curved && (k === 0 || k === slices)) return k === 0 ? from : to;
      const px = from.x + ((to.x - from.x) * k) / slices;
      return { x: px, y: curved ? yAt(px) : from.y + ((to.y - from.y) * k) / slices };
    });
    nodes.push(curved
      ? { t: 'path', id: nodeId, d: vertices.map((v, k) => `${k === 0 ? 'M' : 'L'}${fmtN(v.x)} ${fmtN(v.y)}`).join(''), stroke, width: strokeToken(theme, 'data'), dash: dashToken(theme, 'reference'), owner: {}, part: 'trendLine' }
      : { t: 'line', id: nodeId, x1: from.x, y1: from.y, x2: to.x, y2: to.y, stroke, width: strokeToken(theme, 'data'), dash: dashToken(theme, 'reference'), owner: {}, part: 'trendLine' });
    for (let k = 0; k < slices; k++) {
      const { x: x0, y: y0 } = vertices[k]!;
      const { x: x1, y: y1 } = vertices[k + 1]!;
      claims.claim({ x: Math.min(x0, x1), y: Math.min(y0, y1) - 1.5, w: Math.max(Math.abs(x1 - x0), 1), h: Math.abs(y1 - y0) + 3 }, 'annotation', { annotationId: nodeId }, 'trendLine');
    }
    lines.push({ fit, nodeId, from, to, yAt });
  }
  return lines;
}
