/**
 * Treemap data and option types (registry type 'treemap'). They live in the
 * chart directory: nothing outside this type accepts them.
 */

import type { BaseOptionsFor } from '../../types/options';
import type { ColorRole, Id } from '../../types/cell';

export interface TreemapGroup {
  id: Id;
  /** Name in the legend; defaults to the id. */
  label?: string;
  colorRole?: ColorRole;
  fill?: string;
}

export interface TreemapItem {
  id: Id;
  /** Name on or beside the cell; defaults to the id. */
  label?: string;
  /** Group id; leave it out on every item for a one-level treemap. */
  group?: Id;
  /** Positive value; the cell area is proportional to it. */
  value: number;
}

export interface TreemapData {
  /** Groups in source order; derived from the items when left out. */
  groups?: TreemapGroup[];
  items: TreemapItem[];
}

export interface TreemapOptions extends BaseOptionsFor<'treemap'> {
  /** 'rect' (default): squarified rectangles, exact areas. 'circle': a Voronoi treemap inside a circle. */
  variant?: 'rect' | 'circle';
  /** 'value' (default): largest group and item first. 'sheet': source order. */
  order?: 'value' | 'sheet';
  /** What a cell prints under its name: 'value' (default), 'share' of the total, or 'value-share'. */
  cellValue?: 'value' | 'share' | 'value-share';
  /** The total callout: true prints the formatted total; a string prints itself with '{value}' for it. Off by default. */
  total?: boolean | string;
}

export interface TreemapItemDerived {
  id: Id;
  group?: Id;
  label: string;
  value: number;
  /** Share of the grand total, in percent. */
  share: number;
  /** Drawn area over target area, minus 1. 0 on 'rect'. */
  areaError: number;
}

export interface TreemapGroupDerived {
  id: Id;
  label: string;
  total: number;
  share: number;
}

export interface TreemapDerived {
  variant: 'rect' | 'circle';
  total: number;
  groups: TreemapGroupDerived[];
  items: TreemapItemDerived[];
  /** Largest |drawn area − target area| / target area over all items. 0 on 'rect' up to float rounding. */
  maxAreaError: number;
  /** 'circle' only: iterations of the group level and the most any item level took. */
  iterations?: { groups: number; items: number };
}

export interface TreemapMarks {
  cells: { id: Id; group?: Id; nodeId: Id; labelNodeId?: Id }[];
  groups: { id: Id; nodeId?: Id }[];
}
