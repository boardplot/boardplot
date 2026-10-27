/** Treemap registration. Alias: voronoi-treemap (variant 'circle'). */

import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import { treemapCore } from './core';
import type { TreemapData, TreemapDerived, TreemapMarks, TreemapOptions } from './types';
import { treemapDataSchema, treemapOptionsSchema } from './schema';

export { treemapDataSchema, treemapOptionsSchema };

export const treemapDefinition: ChartDefinition<TreemapData, TreemapOptions, TreemapMarks, TreemapDerived> = {
  ...treemapCore,
  discovery: {
    notFor: 'Zero or negative values, or values that do not add up to one whole; use bar for a ranking and waterfall for signed changes.',
    example: {
      data: {
        groups: [{ id: 'core', label: 'Core' }, { id: 'new', label: 'New' }],
        items: [
          { id: 'a', label: 'Product A', group: 'core', value: 420 },
          { id: 'b', label: 'Product B', group: 'core', value: 260 },
          { id: 'c', label: 'Product C', group: 'new', value: 180 },
          { id: 'd', label: 'Product D', group: 'new', value: 40 },
        ],
      },
      options: { title: 'Core products earn three quarters of revenue', unit: '$m', source: 'Illustrative data' },
    },
  },
  normalize: (raw) => parseData(treemapDataSchema, raw),
  dataSchema: treemapDataSchema,
  optionsSchema: treemapOptionsSchema,
};
