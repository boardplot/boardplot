/** Funnel chart registration. */

import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import type { ChartData } from '../../types/data';
import type { FunnelOptions } from '../../types/options';
import type { FunnelDerived, FunnelMarks } from './layout';
import { funnelCore } from './core';
import { funnelDataSchema, funnelOptionsSchema } from './schema';

export { funnelDataSchema, funnelOptionsSchema };

export const funnelDefinition: ChartDefinition<
  ChartData,
  FunnelOptions,
  FunnelMarks,
  FunnelDerived
> = {
  ...funnelCore,
  discovery: {
    notFor: 'Stages that are not successive steps; each conversion rate divides a stage by the one before it.',
    example: {
      data: {
        categories: [
          { id: 'visits', label: 'Visits' },
          { id: 'trials', label: 'Trials' },
          { id: 'paid', label: 'Paid' },
        ],
        series: [{ id: 'users', label: 'Users', values: [1000, 300, 100] }],
      },
      options: { unit: 'users', title: 'One in ten visits becomes a paid user', source: 'Illustrative data' },
    },
  },
  normalize: (raw) => funnelCore.prepare!(parseData(funnelDataSchema, raw)),
  dataSchema: funnelDataSchema,
  optionsSchema: funnelOptionsSchema,
};
