/** Bar table registration. */

import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import { bartableCore } from './core';
import { bartableDataSchema, bartableOptionsSchema } from './schema';
import type { BarTableData, BarTableDerived, BarTableMarks, BarTableOptions } from './types';

export { bartableDataSchema, bartableOptionsSchema };

export const bartableDefinition: ChartDefinition<BarTableData, BarTableOptions, BarTableMarks, BarTableDerived> = {
  ...bartableCore,
  discovery: {
    notFor: 'Values of different sign: bars grow from zero. Comparing bars of different units by length: each panel has its own scale.',
    // Two panels: the same Run/Grow split in $bn and in % of each row's own
    // EBITDA, which does not add up, hence aggregate 'none'. With a single
    // measure, keep one entry in `panels`.
    example: {
      data: {
        categories: [{ id: 'sw', label: 'Software' }, { id: 'ut', label: 'Utilities' }],
        series: [{ id: 'run', label: 'Run' }, { id: 'grow', label: 'Grow' }],
        columns: [{ id: 'n', label: '# of companies', values: [30, 45], format: '1,234' }],
        panels: [
          {
            id: 'abs', label: 'EBITDA impact', unit: '$bn', weight: 2,
            values: { run: [40, 30], grow: [100, 75] },
            ends: [{ low: 110, high: 160 }, { low: 80, high: 160 }],
          },
          {
            id: 'pct', label: 'Share of 2030 EBITDA', unit: '%', weight: 1, aggregate: 'none',
            values: { run: [8, 9], grow: [26, 30] },
            ends: [{ low: 28, high: 40 }, { low: 29, high: 60 }],
          },
        ],
      },
      options: {
        total: true,
        title: 'Software and utilities carry half of the upside',
        subtitle: { measure: 'Estimated 2030 EBITDA run-rate impact' },
        source: 'Illustrative model',
      },
    },
  },
  normalize: (raw) => parseData(bartableDataSchema, raw),
  dataSchema: bartableDataSchema,
  optionsSchema: bartableOptionsSchema,
};
