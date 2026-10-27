/** Heatmap / matrix registration. */

import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import type { HeatmapData } from '../../types/data';
import type { HeatmapOptions } from '../../types/options';
import type { HeatmapDerived, HeatmapMarks } from './layout';
import { heatmapCore } from './core';
import { heatmapDataSchema, heatmapOptionsSchema } from './schema';

export { heatmapDataSchema, heatmapOptionsSchema };

export const heatmapDefinition: ChartDefinition<HeatmapData, HeatmapOptions, HeatmapMarks, HeatmapDerived> = {
  ...heatmapCore,
  discovery: {
    example: {
      data: {
        categories: [{ id: 'jan', label: 'Jan' }, { id: 'feb', label: 'Feb' }],
        series: [
          { id: 'north', label: 'North', values: [80, 95] },
          { id: 'south', label: 'South', values: [65, 85] },
        ],
      },
      options: { unit: 'orders', title: 'Orders rise in both regions in February', source: 'Illustrative data' },
    },
  },
  normalize: (raw) => heatmapCore.prepare!(parseData(heatmapDataSchema, raw)),
  dataSchema: heatmapDataSchema,
  optionsSchema: heatmapOptionsSchema,
};
