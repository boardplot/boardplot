/** Price/volume/mix bridge registration. */

import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import type { WaterfallMarks } from '../waterfall/layout';
import type { PvmData, PvmDerived, PvmOptions } from './types';
import { pvmCore } from './core';
import { pvmDataSchema, pvmOptionsSchema } from './schema';

export { pvmDataSchema, pvmOptionsSchema };

export const pvmDefinition: ChartDefinition<PvmData, PvmOptions, WaterfallMarks, PvmDerived> = {
  ...pvmCore,
  discovery: {
    notFor: 'Revenue without unit quantities; pvm derives price, volume and mix from both.',
    example: {
      data: {
        quantityUnit: 'units',
        items: [
          {
            id: 'basic',
            label: 'Basic',
            prior: { qty: 100, revenue: 1000 },
            current: { qty: 120, revenue: 1320 },
          },
          {
            id: 'premium',
            label: 'Premium',
            prior: { qty: 50, revenue: 1000 },
            current: { qty: 60, revenue: 1320 },
          },
        ],
      },
      options: {
        unit: '$',
        title: 'Higher prices and quantities lift revenue by $640',
        source: 'Illustrative data',
      },
    },
  },
  normalize: (raw) => parseData(pvmDataSchema, raw),
  dataSchema: pvmDataSchema,
  optionsSchema: pvmOptionsSchema,
};
