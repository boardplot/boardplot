/** Table registration. */

import * as z from 'zod';
import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import type { TableData, TableDerived, TableOptions } from '../../types/table';
import type { TableMarks } from './layout';
import { tableDataSchema, tableOptionsSchema } from './schema';
import { tableCore } from './core';

export { resolveTable } from './resolve';
export { tableDataSchema, tableOptionsSchema };

export const tableDefinition: ChartDefinition<TableData, TableOptions, TableMarks, TableDerived> = {
  ...tableCore,
  discovery: {
    example: {
      data: {
        columns: [
          { id: 'name', kind: 'rowLabel', label: 'Region' },
          { id: 'revenue', kind: 'value', label: 'Revenue ($k)' },
        ],
        rows: [
          { id: 'north', label: 'North', cells: { revenue: 120 } },
          { id: 'south', label: 'South', cells: { revenue: 90 } },
        ],
      },
      options: { title: 'North contributes $30k more revenue than South', source: 'Illustrative data' },
    },
  },
  normalize: (raw) => parseData(tableDataSchema as z.ZodType<TableData>, raw),
  dataSchema: tableDataSchema as z.ZodType<TableData>,
  optionsSchema: tableOptionsSchema,
};
