/** Grid chart registration — facets + variance tiers. */

import * as z from 'zod';
import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import type { GridDerived, GridMarks } from './layout';
import type { GridInput, GridLayoutOptions } from './normalize';
import { gridDataSchema, gridOptionsSchema, metricStackDataSchema } from './schema';
import { gridCore } from './core';

export {
  normalizeGridData,
} from './normalize';
export { gridDataSchema } from './schema';

export const gridDefinition: ChartDefinition<GridInput, GridLayoutOptions, GridMarks, GridDerived> = {
  ...gridCore,
  discovery: {
    example: {
      data: {
        panels: [
          { id: 'revenue', type: 'kpi', data: { label: 'Revenue', value: 120 }, options: { unit: '$k' } },
          {
            id: 'orders',
            type: 'kpi',
            data: { label: 'Orders', value: 85 },
            options: { unit: 'orders' },
          },
        ],
      },
      options: { sharedScale: false, title: 'Revenue is $120k and orders total 85', source: 'Illustrative data' },
    },
  },
  normalize: (raw) => gridCore.prepare!(parseData(gridDataSchema as z.ZodType<GridInput>, raw)),
  dataSchema: gridDataSchema as z.ZodType<GridInput>,
  dataSchemaByOption: { stack: metricStackDataSchema },
  optionsSchema: gridOptionsSchema,
};

