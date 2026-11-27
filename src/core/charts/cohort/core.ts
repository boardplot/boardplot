import { chartSizing } from '../../sizing';
/** Zod-free cohort chart registration. */

import type { ChartCore } from '../../registry';
import { layoutCohort } from './layout';
import type { CohortData, CohortDerived, CohortMarks, CohortOptions } from './types';
import { retiredSettings } from './retired';

export const cohortCore: ChartCore<
  CohortData,
  CohortOptions,
  CohortMarks,
  CohortDerived
> = {
  type: 'cohort',
  retired: retiredSettings,
  sizing: chartSizing('cohort'),
  title: 'Cohort retention triangle',
  summary:
    'Cohorts by periods-since-start: counts in, every retention rate derived, weighted averages that are never the mean of percentages',
  aliases: ['retention'],
  layout: layoutCohort,
  frameOwnsSourceLimit: true,
  defaults: { basis: 'cohort', averages: false, variant: 'heatmap' },
  annotationKinds: []
};
