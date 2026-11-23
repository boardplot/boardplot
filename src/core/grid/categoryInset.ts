/**
 * The room a grid takes off each end of a panel's category range, in px. The
 * plot keeps its edges: only the categories move in, so stacked panels keep
 * one axis line while their category centres line up.
 */
export const CATEGORY_INSET = Symbol('categoryInset');

export interface CategoryInset {
  left: number;
  right: number;
}

export const NO_CATEGORY_INSET: CategoryInset = Object.freeze({ left: 0, right: 0 });

export const categoryInsetOf = (options: object | undefined): CategoryInset =>
  (options as { [CATEGORY_INSET]?: CategoryInset } | undefined)?.[CATEGORY_INSET] ?? NO_CATEGORY_INSET;

/** Chart types whose layout reads CATEGORY_INSET (definition types, not aliases). */
export const INSETS_CATEGORIES: ReadonlySet<string> = new Set(['column', 'line', 'combo', 'variance']);

const AREA_VARIANTS: ReadonlySet<unknown> = new Set(['area', 'stacked-area', 'stacked100-area']);

/**
 * Whether a panel takes a category inset. An area keeps room outside its plot for its edge
 * labels, and that room changes with the inset, so an area panel moves its plot as before.
 */
export const takesCategoryInset = (type: string, options: unknown): boolean =>
  INSETS_CATEGORIES.has(type) && !(type === 'line' && AREA_VARIANTS.has((options as { variant?: unknown } | undefined)?.variant));

/** The category range inside a plot span: the inset comes off both ends, with the 10 px floor every span keeps. */
export function insetRange(x: number, w: number, inset: CategoryInset): { x: number; w: number } {
  if (inset.left === 0 && inset.right === 0) return { x, w };
  return { x: x + inset.left, w: Math.max(10, w - inset.left - inset.right) };
}
