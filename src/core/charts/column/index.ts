/** Column chart registration. */

import { keylessFitBounds } from '../../legendPolicy';
import type { ChartDefinition } from '../../registry';
import type { ChartData } from '../../types/data';
import type { ColumnOptions } from '../../types/options';
import { parseData } from '../../schema/shared';
import type { ColumnDerived, ColumnMarks } from './layout';
import { columnCore, columnKeyFirst } from './core';
import { columnDataSchema, columnOptionsSchema } from './schema';

export { columnDataSchema, columnOptionsSchema };

export const columnDefinition: ChartDefinition<
  ChartData,
  ColumnOptions,
  ColumnMarks,
  ColumnDerived
> = {
  ...columnCore,
  discovery: {
    example: {
      data: {
        categories: [{ id: 'north', label: 'North' }, { id: 'south', label: 'South' }],
        series: [{ id: 'revenue', label: 'Revenue', values: [120, 90] }],
      },
      options: { unit: '$k', title: 'North revenue exceeds South by $30k', source: 'Illustrative data' },
    },
  },
  normalize: (raw) => columnCore.prepare!(parseData(columnDataSchema, raw)),
  dataSchema: columnDataSchema,
  optionsSchema: columnOptionsSchema,
};

keylessFitBounds.set(columnDefinition, columnKeyFirst);
