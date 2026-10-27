import type { ChartSizing } from '../../types/sizing';

/**
 * Waffle sizing. An unpinned waffle takes the height its content needs, so
 * a wider chart gets larger square cells instead of empty space. The layout
 * reports a content floor from the grid, panel rows, text and required key.
 * These static floors describe one default panel.
 */
/** The most rows or columns a waffle grid takes: the schema and the layout both enforce it. */
export const WAFFLE_MAX_GRID_SIDE = 50;

export const WAFFLE_SIZING: ChartSizing = {
  aspect: 'content',
  minWidth: 240,
  minHeight: 200,
  fit: 'content',
  compactFloor: { width: 160, height: 160 },
};
