/** Scatter / bubble chart registration. */

import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import type { ScatterData } from '../../types/data';
import type { ScatterDerived, ScatterMarks } from './layout';
import type { ScatterStrategyOptions } from './types';
import { scatterCore } from './core';
import { quadrantOptionsSchema, scatterClampSchema, scatterDataSchema, scatterOptionsSchema } from './schema';

export * from './types';
export { quadrantOptionsSchema, scatterClampSchema, scatterDataSchema, scatterOptionsSchema };

export const scatterDefinition: ChartDefinition<
  ScatterData,
  ScatterStrategyOptions,
  ScatterMarks,
  ScatterDerived
> = {
  ...scatterCore,
  discovery: {
    example: {
      data: {
        points: [
          { id: 'a', label: 'A', x: 10, y: 40 },
          { id: 'b', label: 'B', x: 20, y: 55 },
          { id: 'c', label: 'C', x: 30, y: 45 },
        ],
      },
      options: {
        axisTitles: { x: 'Price ($)', y: 'Quality score' },
        title: 'Quality is highest for the mid-priced offer',
        source: 'Illustrative data',
      },
    },
  },
  normalize: (raw) => parseData(scatterDataSchema, raw),
  dataSchema: scatterDataSchema,
  optionsSchema: scatterOptionsSchema,
};
