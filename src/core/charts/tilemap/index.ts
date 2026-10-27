import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import { tilemapDataSchema, tilemapOptionsSchema } from './schema';
import type {
  TilemapData,
  TilemapDerived,
  TilemapMarks,
  TilemapOptions,
} from './types';
import { tilemapCore } from './core';

export * from './layout';
export * from './schema';
export * from './types';

export const tilemapDefinition: ChartDefinition<
  TilemapData,
  TilemapOptions,
  TilemapMarks,
  TilemapDerived
> = {
  ...tilemapCore,
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
  normalize: (raw) => parseData(tilemapDataSchema, raw),
  dataSchema: tilemapDataSchema,
  optionsSchema: tilemapOptionsSchema,
};
