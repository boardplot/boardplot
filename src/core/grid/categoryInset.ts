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
 * Whether a panel takes a category inset. An area keeps room outside its plot for its edge labels, and a
 * rank line keeps room for its start and end names; that room changes with the inset, so both move their
 * plot as before. `valueAxis.percent` draws a line as a 100% area whatever its variant says.
 */
export const takesCategoryInset = (type: string, options: unknown): boolean => {
  if (!INSETS_CATEGORIES.has(type)) return false;
  if (type !== 'line') return true;
  const line = (options ?? {}) as { variant?: string; valueAxis?: { percent?: boolean } };
  return line.variant !== 'bump' && !AREA_VARIANTS.has(line.valueAxis?.percent ? 'stacked100-area' : line.variant);
};
/**
 * How a grid panel takes part in category alignment: the inset holder for a type that reads it, a mark for
 * a panel that draws a category row or a value sequence without one (a sparkline, bar, dot or waterfall panel), nothing else.
 */
export function panelAnchoring(type: string, options: unknown, data: unknown): { categoryInset?: CategoryInset; holdsCategories?: boolean } {
  if (takesCategoryInset(type, options)) return { categoryInset: { left: 0, right: 0 } };
  const record = (data ?? {}) as { categories?: unknown; labels?: unknown; items?: unknown; values?: unknown };
  const rows = [record.categories, record.labels, record.items, record.values].some((list) => Array.isArray(list) && list.length >= 2);
  return rows ? { holdsCategories: true } : {};
}

/** The category range inside a plot span: the inset comes off both ends, with the 10 px floor every span keeps. */
export function insetRange(x: number, w: number, inset: CategoryInset): { x: number; w: number } {
  if (inset.left === 0 && inset.right === 0) return { x, w };
  return { x: x + inset.left, w: Math.max(10, w - inset.left - inset.right) };
}
