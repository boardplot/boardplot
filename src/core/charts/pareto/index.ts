/** Pareto registration (vital-few concentration). */

import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import type { ParetoOptions } from '../../types/options';
import type { ParetoData, ParetoDerived, ParetoMarks } from './layout';
import { paretoCore } from './core';
import { paretoDataSchema, paretoOptionsSchema } from './schema';

export { paretoDataSchema, paretoOptionsSchema };

export const paretoDefinition: ChartDefinition<
  ParetoData,
  ParetoOptions,
  ParetoMarks,
  ParetoDerived
> = {
  ...paretoCore,
  discovery: {
    notFor: 'Negative contributions; pareto accumulates nonnegative parts of one total.',
    example: {
      data: {
        items: [
          { id: 'billing', label: 'Billing', value: 80 },
          { id: 'delivery', label: 'Delivery', value: 15 },
          { id: 'other', label: 'Other', value: 5 },
        ],
      },
      options: { unit: 'cases', title: 'Billing accounts for 80% of cases', source: 'Illustrative data' },
    },
  },
  normalize: (raw) => parseData(paretoDataSchema, raw),
  dataSchema: paretoDataSchema,
  optionsSchema: paretoOptionsSchema,
};
