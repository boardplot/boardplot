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

/**
 * Whether a grid panel may take a category inset: a column (grouped or stacked), a plain line, a combo or a
 * variance panel. Every other type and variant (an area, also through `valueAxis.percent`, a rank line, a
 * 100% column, a sparkline, a waterfall) draws as before, and so does every panel of its grid column.
 */
export const takesCategoryInset = (type: string, options: unknown): boolean => {
  if (type === 'combo' || type === 'variance') return true;
  const record = (options ?? {}) as { variant?: string; valueAxis?: { percent?: boolean } };
  if (type === 'column') return record.variant === undefined || record.variant === 'grouped' || record.variant === 'stacked';
  if (type === 'line') return (record.variant === undefined || record.variant === 'line') && record.valueAxis?.percent !== true;
  return false;
};

/** The holder a grid panel's relayout reads its category inset from: present only where the panel may take one. */
export const panelAnchoring = (type: string, options: unknown): { categoryInset?: CategoryInset } =>
  takesCategoryInset(type, options) ? { categoryInset: { left: 0, right: 0 } } : {};

/** The category range inside a plot span: the inset comes off both ends, with the 10 px floor every span keeps. */
export function insetRange(x: number, w: number, inset: CategoryInset): { x: number; w: number } {
  if (inset.left === 0 && inset.right === 0) return { x, w };
  return { x: x + inset.left, w: Math.max(10, w - inset.left - inset.right) };
}
