/** Mekko chart registration. */

import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import type { ChartData } from '../../types/data';
import type { MekkoOptions } from '../../types/options';
import type { MekkoDerived, MekkoMarks } from './layout';
import { mekkoCore } from './core';
import { mekkoDataSchema, mekkoOptionsSchema } from './schema';

export { mekkoDataSchema, mekkoOptionsSchema };

export const mekkoDefinition: ChartDefinition<
  ChartData,
  MekkoOptions,
  MekkoMarks,
  MekkoDerived
> = {
  ...mekkoCore,
  discovery: {
    example: {
      data: {
        categories: [{ id: 'north', label: 'North' }, { id: 'south', label: 'South' }],
        series: [
          { id: 'renewals', label: 'Renewals', values: [80, 30] },
          { id: 'new', label: 'New', values: [40, 50] },
        ],
      },
      options: {
        unit: '$k',
        title: 'North has more revenue and a larger renewal share',
        source: 'Illustrative data',
      },
    },
  },
  normalize: (raw) => mekkoCore.prepare!(parseData(mekkoDataSchema, raw)),
  dataSchema: mekkoDataSchema,
  optionsSchema: mekkoOptionsSchema,
};
