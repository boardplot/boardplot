/** Sankey registration. */

import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import { sankeyCore } from './core';
import type { SankeyData, SankeyDerived, SankeyMarks, SankeyOptions } from './types';
import { sankeyDataSchema, sankeyOptionsSchema } from './schema';

export { sankeyDataSchema, sankeyOptionsSchema };

export const sankeyDefinition: ChartDefinition<SankeyData, SankeyOptions, SankeyMarks, SankeyDerived> = {
  ...sankeyCore,
  discovery: {
    notFor: 'Flows that loop back without stages (refused as a cycle; give links sourceStage and targetStage), or parts of one total (use treemap or bar). Pairwise rows do not say which channel a purchase came from once flows merge at a page: for that, build path-qualified nodes from journey data.',
    example: {
      data: {
        links: [
          { source: 'search', target: 'product', value: 420 },
          { source: 'search', target: 'home', value: 180 },
          { source: 'social', target: 'home', value: 260 },
          { source: 'email', target: 'product', value: 140 },
          { source: 'product', target: 'purchase', value: 210 },
          { source: 'home', target: 'purchase', value: 90 },
        ],
        nodes: [
          { id: 'search', label: 'Search' }, { id: 'social', label: 'Social' }, { id: 'email', label: 'Email' },
          { id: 'product', label: 'Product page' }, { id: 'home', label: 'Home page' }, { id: 'purchase', label: 'Purchase' },
        ],
        stages: [{ id: 'channel', label: 'Channel' }, { id: 'page', label: 'Landing page' }, { id: 'outcome', label: 'Outcome' }],
      },
      options: { title: 'Search brings most visits that end in a purchase', unit: 'k visits', source: 'Illustrative data' },
    },
  },
  normalize: (raw) => parseData(sankeyDataSchema, raw),
  dataSchema: sankeyDataSchema,
  optionsSchema: sankeyOptionsSchema,
};
