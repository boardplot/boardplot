import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import type { BaseOptions } from '../../types/options';
import { choroplethDataSchema, choroplethOptionsSchema } from './schema';
import type {
  ChoroplethData,
  ChoroplethDerived,
  ChoroplethMarks,
} from './types';
import { choroplethCore } from './core';

export * from './layout';
export * from './schema';
export * from './types';

export const choroplethDefinition: ChartDefinition<ChoroplethData, BaseOptions, ChoroplethMarks, ChoroplethDerived> = {
  ...choroplethCore,
  discovery: {
    example: {
      data: {
        pack: 'eu27',
        regions: [{ id: 'DE', value: 2.3 }, { id: 'FR', value: 1.6 }, { id: 'IT', value: 1.1 }],
      },
      options: {
        title: 'Germany has the highest inflation rate among the three supplied countries',
        unit: '%',
        classes: 3,
        source: 'Illustrative data',
      },
    },
  },
  normalize: (raw) => parseData(choroplethDataSchema, raw),
  dataSchema: choroplethDataSchema,
  optionsSchema: choroplethOptionsSchema as unknown as ChartDefinition<ChoroplethData, BaseOptions>['optionsSchema'],
};
