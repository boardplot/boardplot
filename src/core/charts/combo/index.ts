/** Combo chart registration. */

import * as z from 'zod';
import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import type { ChartData } from '../../types/data';
import type { BaseOptions } from '../../types/options';
import type { ComboDerived, ComboMarks } from './layout';
import { comboCore } from './core';
import { comboDataSchema, comboOptionsSchema } from './schema';

export { comboDataSchema, comboOptionsSchema };

// ComboOptions WIDENS `secondaryAxis` past BaseOptions — it is the one chart
// whose schema accepts the percent `ruler` form — so it does not satisfy the
// `O extends BaseOptions` constraint the registry carries. Same shape as
// StatusOptions, which narrows `legend` and casts at :108 for the same
// reason. The alternative is declaring `ruler` on the shared BaseOptions,
// which would promise 27 chart types an option 26 of them reject at runtime —
// checked by the React API surface test.
export const comboDefinition: ChartDefinition<ChartData, BaseOptions, ComboMarks, ComboDerived> = {
  ...comboCore,
  discovery: {
    example: {
      data: {
        categories: [{ id: 'jan', label: 'Jan' }, { id: 'feb', label: 'Feb' }, { id: 'mar', label: 'Mar' }],
        series: [
          { id: 'revenue', label: 'Revenue', values: [80, 95, 110], kind: 'column', scenario: 'AC' },
          { id: 'plan', label: 'Plan', values: [90, 90, 100], kind: 'line', scenario: 'PL' },
        ],
      },
      options: {
        unit: '$k',
        title: 'Revenue moves from below plan to above plan',
        source: 'Illustrative data',
        footnotes: ['AC = actual; PL = plan.'],
      },
    },
  },
  normalize: (raw) => comboCore.prepare!(parseData(comboDataSchema, raw)),
  dataSchema: comboDataSchema,
  optionsSchema: comboOptionsSchema as unknown as z.ZodType<BaseOptions>,
};
