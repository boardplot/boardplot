/** Cohort retention triangle registration. */

import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import type { CohortData, CohortDerived, CohortMarks, CohortOptions } from './types';
import { cohortCore } from './core';
import { cohortDataSchema, cohortOptionsSchema } from './schema';

export { cohortDataSchema, cohortOptionsSchema };

export const cohortDefinition: ChartDefinition<
  CohortData,
  CohortOptions,
  CohortMarks,
  CohortDerived
> = {
  ...cohortCore,
  discovery: {
    notFor: 'Precomputed retention percentages; cohort takes active-member counts and derives the rates.',
    example: {
      data: {
        periodLabel: 'Month',
        cohorts: [
          { id: 'jan', label: 'Jan 2026', active: [100, 70, 60], size: 100 },
          { id: 'feb', label: 'Feb 2026', active: [80, 60], size: 80 },
        ],
      },
      options: {
        unit: '% of cohort base',
        title: 'January retains 60% of its customers at month two',
        source: 'Illustrative data',
      },
    },
  },
  normalize: (raw) => parseData(cohortDataSchema, raw),
  dataSchema: cohortDataSchema,
  optionsSchema: cohortOptionsSchema,
};
