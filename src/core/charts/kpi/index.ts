/** KPI card registration. */

import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import type { KpiData } from '../../types/data';
import type { KpiOptions } from '../../types/options';
import type { KpiDerived, KpiMarks } from './layout';
import { kpiCore } from './core';
import { kpiDataSchema, kpiOptionsSchema } from './schema';

export { kpiDataSchema, kpiOptionsSchema };

export const kpiDefinition: ChartDefinition<KpiData, KpiOptions, KpiMarks, KpiDerived> = {
  ...kpiCore,
  discovery: {
    notFor: 'Several categories side by side; kpi shows one metric.',
    example: {
      data: { label: 'Revenue', value: 120, delta: { vs: 100, scenario: 'PY' } },
      options: { unit: '$k', title: 'Revenue is $20k above prior year', source: 'Illustrative data' },
    },
  },
  normalize: (raw) => parseData(kpiDataSchema, raw),
  dataSchema: kpiDataSchema,
  optionsSchema: kpiOptionsSchema,
};
