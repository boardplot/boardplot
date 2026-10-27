/** Variance chart registration. */

import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import type { ChartData } from '../../types/data';
import type { VarianceOptions } from '../../types/options';
import type { VarianceDerived, VarianceMarks } from './layout';
import { varianceCore } from './core';
import { varianceDataSchema, varianceOptionsSchema } from './schema';

export { varianceDataSchema, varianceOptionsSchema };

export const varianceDefinition: ChartDefinition<
  ChartData,
  VarianceOptions,
  VarianceMarks,
  VarianceDerived
> = {
  ...varianceCore,
  discovery: {
    notFor: 'Relative variance against a zero or negative reference.',
    example: {
      data: {
        categories: [{ id: 'north', label: 'North' }, { id: 'south', label: 'South' }],
        series: [
          { id: 'revenue', label: 'Revenue', values: [120, 90], scenario: 'AC' },
          { id: 'plan', label: 'Plan', values: [100, 100], role: 'reference', scenario: 'PL' },
        ],
      },
      options: {
        variant: 'absolute', variance: { of: 'revenue', vs: 'plan' },
        unit: '$k',
        title: 'North exceeds plan by $20k; South misses by $10k',
        source: 'Illustrative data',
        footnotes: ['AC = actual; PL = plan.'],
      },
    },
  },
  normalize: (raw) => varianceCore.prepare!(parseData(varianceDataSchema, raw)),
  dataSchema: varianceDataSchema,
  optionsSchema: varianceOptionsSchema,
};
