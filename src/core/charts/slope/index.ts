/** Slope chart registration. */

import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import type { ChartData } from '../../types/data';
import type { SlopeOptions } from '../../types/options';
import type { SlopeDerived, SlopeMarks } from './layout';
import { slopeCore } from './core';
import { slopeDataSchema, slopeOptionsSchema } from './schema';

export { slopeDataSchema, slopeOptionsSchema };

export const slopeDefinition: ChartDefinition<ChartData, SlopeOptions, SlopeMarks, SlopeDerived> = {
  ...slopeCore,
  discovery: {
    notFor: 'Intermediate periods; slope draws the first and last value of each series.',
    example: {
      data: {
        categories: [{ id: '2025', label: '2025' }, { id: '2026', label: '2026' }],
        series: [
          { id: 'north', label: 'North', values: [80, 100] },
          { id: 'south', label: 'South', values: [90, 70] },
        ],
      },
      options: { unit: '$k', title: 'North grows while South declines', source: 'Illustrative data' },
    },
  },
  normalize: (raw) => slopeCore.prepare!(parseData(slopeDataSchema, raw)),
  dataSchema: slopeDataSchema,
  optionsSchema: slopeOptionsSchema,
};
