import { strokeToken } from './theme';
import type { OccupiedIndex } from './label/occupied';
import type { LintWarning, SceneNode } from './types/scene';
import type { Theme } from './types/theme';

/** The length of a short tick under a category row that marks a calendar interval. */
export const INTERVAL_TICK = 4;

/**
 * categoryAxis.dateTicks on a banded row: a short tick at the centre of the
 * first category of every calendar interval, from `top` down, labelled or not.
 */
export function bandedIntervalTicks(
  theme: Theme,
  cats: readonly { id: string }[],
  ticks: readonly boolean[],
  centerOf: (ci: number) => number,
  top: number,
  nodes: SceneNode[],
  claims: OccupiedIndex,
): void {
  ticks.forEach((tick, ci) => {
    if (!tick) return;
    const x = centerOf(ci);
    const id = cats[ci]!.id;
    nodes.push({ t: 'line', id: `axis:x:tick:${id}`, x1: x, y1: top, x2: x, y2: top + INTERVAL_TICK, stroke: { token: 'axis' }, width: strokeToken(theme, 'rule'), owner: { categoryId: id }, part: 'tick' });
    claims.claim({ x: x - 0.5, y: top, w: 1, h: INTERVAL_TICK }, 'axis', { categoryId: id }, 'tick');
  });
}

/**
 * A banded row (column, combo) puts every category in the middle of its band, so
 * crossesBetween false, which moves the end categories to the plot edges, changes nothing there.
 */
export function bandedCrossesBetween(options: { categoryAxis?: { crossesBetween?: boolean } }, warnings: LintWarning[]): void {
  if (options.categoryAxis?.crossesBetween !== false) return;
  warnings.push({
    code: 'cross-between-ignored',
    severity: 'info',
    message: 'categoryAxis.crossesBetween false was ignored: columns always sit in the middle of their bands, so the end categories cannot sit on the plot edges',
    suggest: "drop categoryAxis.crossesBetween, or use type 'line' to place the end categories on the plot edges",
  });
}
