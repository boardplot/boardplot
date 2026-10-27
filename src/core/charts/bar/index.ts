/** Bar chart registration (horizontal twin of column). */

import type { ChartDefinition } from '../../registry';
import type { ChartData } from '../../types/data';
import { parseData } from '../../schema/shared';
import type { BarDerived, BarMarks } from './layout';
import type { BarOptions } from '../../types/options';
import { barCore } from './core';
import { barDataSchema, barOptionsSchema } from './schema';

export { barDataSchema, barOptionsSchema };

export const barDefinition: ChartDefinition<ChartData, BarOptions, BarMarks, BarDerived> = {
  ...barCore,
  discovery: {
    example: {
      data: {
        categories: [{ id: 'north', label: 'North' }, { id: 'south', label: 'South' }],
        series: [{ id: 'revenue', label: 'Revenue', values: [120, 90] }],
      },
      options: { unit: '$k', title: 'North revenue exceeds South by $30k', source: 'Illustrative data' },
    },
  },
  normalize: (raw) => barCore.prepare!(parseData(barDataSchema, raw)),
  dataSchema: barDataSchema,
  optionsSchema: barOptionsSchema,
};
