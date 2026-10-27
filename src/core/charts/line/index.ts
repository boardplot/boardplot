/** Line/area chart registration. Alias: 'profile'. */

import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import type { LineChartData } from '../../types/data';
import type { LineDerived, LineMarks } from './layout';
import type { LineOptions } from './types';
import { lineCore } from './core';
import { lineDataSchema, lineOptionsSchema } from './schema';

export { lineDataSchema, lineOptionsSchema };

export const lineDefinition: ChartDefinition<LineChartData, LineOptions, LineMarks, LineDerived> = {
  ...lineCore,
  discovery: {
    example: {
      data: {
        categories: [{ id: 'jan', label: 'Jan' }, { id: 'feb', label: 'Feb' }, { id: 'mar', label: 'Mar' }],
        series: [{ id: 'revenue', label: 'Revenue', values: [80, 95, 110] }],
      },
      options: { unit: '$k', title: 'Revenue rises from $80k to $110k', source: 'Illustrative data' },
    },
  },
  normalize: (raw) => lineCore.prepare!(parseData(lineDataSchema, raw)),
  dataSchema: lineDataSchema,
  optionsSchema: lineOptionsSchema,
};
