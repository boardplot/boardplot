/** Dot-family registration (Cleveland dot / dumbbell / lollipop). */

import type { ChartDefinition } from '../../registry';
import type { ChartData } from '../../types/data';
import type { DotOptions } from '../../types/options';
import { parseData } from '../../schema/shared';
import type { DotDerived, DotMarks } from './layout';
import { dotCore } from './core';
import { dotDataSchema, dotOptionsSchema } from './schema';

export { dotDataSchema, dotOptionsSchema };

export const dotDefinition: ChartDefinition<ChartData, DotOptions, DotMarks, DotDerived> = {
  ...dotCore,
  discovery: {
    example: {
      data: {
        categories: [{ id: 'north', label: 'North' }, { id: 'south', label: 'South' }],
        series: [{ id: 'revenue', label: 'Revenue', values: [120, 90] }],
      },
      options: { unit: '$k', title: 'North revenue exceeds South by $30k', source: 'Illustrative data' },
    },
  },
  normalize: (raw) => dotCore.prepare!(parseData(dotDataSchema, raw)),
  dataSchema: dotDataSchema,
  optionsSchema: dotOptionsSchema,
};
