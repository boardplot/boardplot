/** Zod-free treemap chart registration. */

import type { ChartCore } from '../../registry';
import { CARD_MIN_WIDTH, chartSizing } from '../../sizing';
import { layoutTreemap, treemapDefaultStrings } from './layout';
import type { TreemapData, TreemapDerived, TreemapMarks, TreemapOptions } from './types';

export const treemapCore: ChartCore<TreemapData, TreemapOptions, TreemapMarks, TreemapDerived> = {
  type: 'treemap',
  // No compact floor, which would multiply note probes: the full frame draws down to a
  // 320 px card, and the layout measures its own floor.
  sizing: { ...chartSizing('treemap'), compactFloor: undefined, minWidth: CARD_MIN_WIDTH },
  title: 'Treemap',
  summary: 'Part of a whole in one or two levels (group, item): cell area is value. Squarified rectangles with exact areas, or a circular Voronoi treemap; inside labels with bold values, outside names with leaders, group key with totals',
  aliases: ['voronoi-treemap'],
  aliasDefaults: { 'voronoi-treemap': { variant: 'circle' } },
  layout: (data, options) => layoutTreemap(data, options),
  // The note of unnamed cells leads with its own words per variant; an authored lead wins.
  defaultStrings: treemapDefaultStrings,
  // Every cell must stay identifiable: the note of names a cell cannot hold lists them all.
  defaults: { variant: 'rect', order: 'value', cellValue: 'value', notes: { maxListed: 'all' } },
  annotationKinds: [],
};
