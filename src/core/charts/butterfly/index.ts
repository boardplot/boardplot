/** Butterfly / tornado chart registration. */

import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import type { ChartData } from '../../types/data';
import type { ButterflyOptions } from '../../types/options';
import type { ButterflyDerived, ButterflyMarks } from './layout';
import { butterflyCore } from './core';
import { butterflyDataSchema, butterflyOptionsSchema } from './schema';

export { butterflyDataSchema, butterflyOptionsSchema };

export const butterflyDefinition: ChartDefinition<
  ChartData,
  ButterflyOptions,
  ButterflyMarks,
  ButterflyDerived
> = {
  ...butterflyCore,
  discovery: {
    notFor: 'More than two measures per category; butterfly has two panes.',
    example: {
      data: {
        categories: [{ id: 'north', label: 'North' }, { id: 'south', label: 'South' }],
        series: [
          { id: 'plan', label: 'Plan', values: [100, 80], scenario: 'PL' },
          { id: 'actual', label: 'Actual', values: [120, 70], scenario: 'AC' },
        ],
      },
      options: {
        a: 'plan',
        b: 'actual',
        unit: '$k',
        title: 'North beats plan while South falls short',
        source: 'Illustrative data',
        footnotes: ['AC = actual; PL = plan.'],
      },
    },
  },
  normalize: (raw) => butterflyCore.prepare!(parseData(butterflyDataSchema, raw)),
  dataSchema: butterflyDataSchema,
  optionsSchema: butterflyOptionsSchema,
};
