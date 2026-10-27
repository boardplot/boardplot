/** Box-and-whisker registration (distribution comparison). */

import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import type { BoxData, BoxDerived, BoxMarks, BoxOptions } from './types';
import { boxCore } from './core';
import { boxDataSchema, boxOptionsSchema } from './schema';

export { boxDataSchema, boxOptionsSchema };

export const boxDefinition: ChartDefinition<BoxData, BoxOptions, BoxMarks, BoxDerived> = {
  ...boxCore,
  discovery: {
    notFor: 'Precomputed quartiles; box takes raw observations and computes them.',
    example: {
      data: {
        groups: [
          { id: 'north', label: 'North', observations: [4, 5, 6, 7, 8, 10] },
          { id: 'south', label: 'South', observations: [3, 4, 5, 6, 7, 9] },
        ],
      },
      options: { unit: 'days', title: 'North has a higher median delivery time', source: 'Illustrative data' },
    },
  },
  normalize: (raw) => parseData(boxDataSchema, raw),
  dataSchema: boxDataSchema,
  optionsSchema: boxOptionsSchema,
};
