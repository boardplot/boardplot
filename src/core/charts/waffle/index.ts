/** Waffle chart registration. */

import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import type { ChartData } from '../../types/data';
import { waffleCore } from './core';
import type { WaffleDerived, WaffleMarks, WaffleOptions } from './types';
import { waffleDataSchema, waffleOptionsSchema } from './schema';

export { waffleDataSchema, waffleOptionsSchema };

export const waffleDefinition: ChartDefinition<ChartData, WaffleOptions, WaffleMarks, WaffleDerived> = {
  ...waffleCore,
  discovery: {
    notFor: 'Levels or values that are not shares of a whole; waffle fills part of 100%. Use bar or column for levels, pie for slices of a total.',
    example: {
      data: {
        categories: [{ id: 'high-spend', label: 'Share of high-spending customers out of all customers' }],
        series: [{ id: 'share', label: 'High spenders', values: [30] }],
      },
      options: { title: 'Three in ten customers are high spenders', source: 'Illustrative data' },
    },
  },
  normalize: (raw) => waffleCore.prepare!(parseData(waffleDataSchema, raw)),
  dataSchema: waffleDataSchema,
  optionsSchema: waffleOptionsSchema,
};
