/** Categorical status-matrix registration. */

import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import type { StatusData, StatusDerived, StatusMarks, StatusOptions } from './layout';
import { statusCore } from './core';
import { statusDataSchema, statusOptionsSchema } from './schema';

export { statusDataSchema, statusOptionsSchema };

export const statusDefinition: ChartDefinition<
  StatusData,
  StatusOptions,
  StatusMarks,
  StatusDerived
> = {
  ...statusCore,
  discovery: {
    notFor: 'Numeric magnitudes; status cells hold discrete states.',
    example: {
      data: {
        rows: [{ id: 'pricing', label: 'Pricing' }, { id: 'service', label: 'Service' }],
        columns: [{ id: 'design', label: 'Design' }, { id: 'pilot', label: 'Pilot' }],
        cells: [
          { row: 'pricing', col: 'design', state: 'done' },
          { row: 'pricing', col: 'pilot', state: 'open' },
          { row: 'service', col: 'design', state: 'open' },
        ],
      },
      options: {
        states: [{ id: 'done', label: 'Done', tone: 'good' }, { id: 'open', label: 'Open', tone: 'neutral' }],
        title: 'Pricing design is done; pilot work remains open',
        source: 'Illustrative data',
      },
    },
  },
  normalize: (raw) => parseData(statusDataSchema, raw),
  dataSchema: statusDataSchema,
  optionsSchema: statusOptionsSchema,
};
