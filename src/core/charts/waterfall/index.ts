/** Waterfall chart registration. */

import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import type { WaterfallData } from '../../types/data';
import type { WaterfallOptions } from '../../types/options';
import type { WaterfallDerived, WaterfallMarks } from './layout';
import { waterfallCore } from './core';
import { waterfallDataSchema, waterfallOptionsSchema } from './schema';

export { waterfallDataSchema, waterfallOptionsSchema };

export const waterfallDefinition: ChartDefinition<
  WaterfallData,
  WaterfallOptions,
  WaterfallMarks,
  WaterfallDerived
> = {
  ...waterfallCore,
  discovery: {
    example: {
      data: {
        items: [
          { id: 'start', label: 'Prior', type: 'total', value: 100 },
          { id: 'growth', label: 'Growth', value: 25 },
          { id: 'cost', label: 'Cost', value: -10 },
          { id: 'end', label: 'Current', type: 'total', value: 115 },
        ],
      },
      options: { unit: '$k', title: 'Growth offsets cost to lift revenue by $15k', source: 'Illustrative data' },
    },
  },
  normalize: (raw) => parseData(waterfallDataSchema, raw),
  dataSchema: waterfallDataSchema,
  optionsSchema: waterfallOptionsSchema,
};
