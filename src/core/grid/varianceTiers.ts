import type { Rect } from '../geometry';
import { maxOf } from '../arrays';

export const VARIANCE_TIER = Symbol('varianceTier');

type TierPanel = { type?: string; options?: object };

export function varianceTierWeights(panels: readonly TierPanel[]): number[] | undefined {
  if (panels.length < 2 || panels.filter((panel) => panel.type === 'column').length !== 1) return undefined;
  if (!panels.every((panel) => panel.type === 'column' || (
    panel.type === 'variance' &&
    (panel.options as { variant?: string } | undefined)?.variant !== 'integrated'
  ))) return undefined;
  // One variance tier over a stacked column takes a third of the column plot (grid.tiers: 0, 5, 10%).
  // Two or more tiers keep a quarter each: at 3:1:1 the column lost the room its values print in.
  return panels.map((panel) => panel.type !== 'column' ? 1
    : (panel.options as { variant?: string } | undefined)?.variant === 'stacked' && panels.length === 2 ? 3 : 4);
}

/** The tier is the only one over its column (the grid has two panels): grid.tiers. */
export function isSingleVarianceTier(options: unknown): boolean {
  return Boolean(options && typeof options === 'object'
    && (options as { [VARIANCE_TIER]?: unknown })[VARIANCE_TIER] === 2);
}

export function isVarianceTier(options: unknown): boolean {
  return Boolean(options && typeof options === 'object' &&
    (options as { [VARIANCE_TIER]?: unknown })[VARIANCE_TIER]);
}

/** Change slot heights by the measured plot deficit; existing packing preserves the ratio. */
export function balanceVarianceTierPlots<T extends { geo: { size: { height: number }; plot: Rect } }>(
  slots: Rect[], children: T[], weights: readonly number[] | undefined, layout: () => T[],
): T[] {
  if (!weights) return children;
  let measured = children;
  if (children.some((child) => child.geo.plot.h <= 10)) {
    const heights = slots.map((slot) => slot.h);
    const extra = maxOf(heights);
    try {
      slots.forEach((slot) => { slot.h += extra; });
      measured = layout();
    } finally {
      slots.forEach((slot, i) => { slot.h = heights[i]!; });
    }
    if (measured.some((child) => child.geo.plot.h <= 10)) return layout();
  }
  const chrome = measured.map((child) => child.geo.size.height - child.geo.plot.h);
  const total = slots.reduce((sum, slot, i) => sum + slot.h - chrome[i]!, 0);
  const weight = weights.reduce((sum, value) => sum + value, 0);
  const heights = weights.map((value) => total * value / weight);
  if (heights.some((height) => height < 10) || heights.every((height, i) => Math.abs(height - children[i]!.geo.plot.h) < 0.001)) return measured === children ? children : layout();
  slots.forEach((slot, i) => { slot.h = chrome[i]! + heights[i]!; });
  return layout();
}
