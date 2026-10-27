/**
 * Cohort curves: twelve retention curves that read their order off
 * the theme's ordered ramp instead of twelve colours, named at their own
 * ends, and a ring on the newest cohort's last point. The ramp follows the
 * theme, so every rung stays 3:1 on the page in the dark themes too.
 */

import {
  COHORT_IDS,
  COHORT_LABEL,
  COHORT_PERIODS,
  COHORT_RETAINED,
} from '../cohortSample';
import type { Fixture } from '../../registry';
import type { LineChartData } from '../../types/data';
import type { LineOptions } from './types';

/** The four cohorts the board names: one per quarter of the year. */
const NAMED = [COHORT_IDS[0]!, COHORT_IDS[3]!, COHORT_IDS[6]!, COHORT_IDS[9]!];
/** The newest cohort with enough points to carry a ring. */
const RINGED = COHORT_IDS[9]!;

export const cohortLineFixtures: Fixture<LineChartData, LineOptions>[] = [
  {
    id: 'cohort-curves',
    title: 'Twelve retention curves on one ink ramp, each named at its end',
    kind: 'example',
    data: {
      categories: Array.from({ length: COHORT_PERIODS }, (_, month) => ({ id: `m${month}`, label: `M${month}` })),
      series: COHORT_IDS.map((id, cohort) => ({
        id,
        label: COHORT_LABEL[cohort]!,
        // No point markers: twelve curves with a dot on every month is a
        // field of dots, and the ring on the newest cohort is the one mark
        // the exhibit wants read.
        marker: 'none' as const,
        values: Array.from({ length: COHORT_PERIODS }, (_, month) => COHORT_RETAINED[cohort]![month] ?? null),
      })),
    },
    options: {
      format: '1%',
      legend: 'none',
      // The order is the encoding: each cohort takes its rung of the theme's ordered ramp.
      emphasis: 'ordered',
      // Every cohort is named at its own line end.
      latestPoint: { series: RINGED, marker: 'ring' },
      size: { width: 720, height: 444 },
      title: 'Twelve curves, one ink',
      subtitle: '% retained by months since acquisition · the newer the cohort, the stronger the line · ring: the newest cohort with three observations',
      source: 'Synthetic cohort set: twelve 2025 monthly cohorts observed to 31 Dec 2025',
    },
  },
  {
    // the same curves with each name at its own line end, a
    // zero-based axis on a 20 % grid and its title.
    id: 'cohort-curves-line-end',
    title: 'Retention curves named at their own ends on a 20 % grid',
    kind: 'example',
    data: {
      categories: Array.from({ length: COHORT_PERIODS }, (_, month) => ({ id: `m${month}`, label: `M${month}` })),
      series: COHORT_IDS.map((id, cohort) => ({
        id,
        label: COHORT_LABEL[cohort]!,
        marker: 'none' as const,
        values: Array.from({ length: COHORT_PERIODS }, (_, month) => COHORT_RETAINED[cohort]![month] ?? null),
      })),
    },
    options: {
      format: '1%',
      legend: 'none',
      // The order is the encoding: each cohort takes its rung of the theme's ordered ramp.
      emphasis: 'ordered',
      seriesLabels: { only: NAMED },
      endLabelPlacement: 'lineEnd',
      latestPoint: { series: RINGED, marker: 'ring' },
      valueAxis: { show: true, gridlines: true, includeZero: true, tickStep: 20 },
      axisTitles: { primary: 'Retained, % of cohort' },
      size: { width: 720, height: 360 },
      title: 'Newer cohorts keep more customers at every month',
      subtitle: '% retained by months since acquisition',
      source: 'Synthetic cohort set: twelve 2025 monthly cohorts observed to 31 Dec 2025',
    },
  },
];
