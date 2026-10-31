/** Pie / doughnut chart registration. Aliases: doughnut, donut. */

import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import type { ChartData } from '../../types/data';
import type { PieOptions } from '../../types/options';
import type { PieDerived, PieMarks } from './layout';
import { pieCore } from './core';
import { pieDataSchema, pieOptionsSchema } from './schema';

export { pieDataSchema, pieOptionsSchema };

export const pieDefinition: ChartDefinition<ChartData, PieOptions, PieMarks, PieDerived> = {
  ...pieCore,
  discovery: {
    notFor: 'Negative parts; pie divides a nonnegative whole. A negative slice is not drawn and the centre total is left out.',
    example: {
      data: {
        categories: [{ id: 'renewals', label: 'Renewals' }, { id: 'new', label: 'New' }],
        series: [{ id: 'revenue', label: 'Revenue', values: [70, 30] }],
      },
      options: { unit: '$k', title: 'Renewals contribute 70% of revenue', source: 'Illustrative data' },
    },
  },
  normalize: (raw) => pieCore.prepare!(parseData(pieDataSchema, raw)),
  dataSchema: pieDataSchema,
  optionsSchema: pieOptionsSchema,
};
