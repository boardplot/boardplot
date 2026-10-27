/**
 * Cohort layers: what the active base is made of, one stacked
 * column per calendar month with the oldest cohort at the bottom. The
 * layers read their order off one ink ramp, the totals print on top, and
 * five cohorts are named once at the right edge of the last column, so the
 * chart needs no legend.
 */

import {
  COHORT_MONTHS,
  COHORT_PERIODS,
  cohortActive,
} from '../cohortSample';
import type { Fixture } from '../../registry';
import type { RangeChartData } from '../../types/data';
import type { ColumnOptions } from '../../types/options';

/**
 * The twelve monthly cohorts pool into four quarter cohorts, each
 * named in the key row in ramp order, so every layer is keyed. The
 * layers take the theme's ordered ramp, the oldest darkest, which reaches
 * 3:1 on the page in both schemes; no literal colour is authored.
 */
const QUARTERS = [0, 1, 2, 3].map((q) => ({ id: `q${q + 1}`, label: `Q${q + 1} 25 cohorts`, cohorts: [3 * q, 3 * q + 1, 3 * q + 2] }));

export const cohortColumnFixtures: Fixture<RangeChartData, ColumnOptions>[] = [
  {
    id: 'cohort-layers',
    title: 'The active base by acquisition cohort, oldest at the bottom',
    kind: 'example',
    data: {
      categories: COHORT_MONTHS.map((month) => ({ id: month.toLowerCase(), label: month })),
      series: QUARTERS.map(({ id, label, cohorts }) => ({
        id,
        label,
        // A cohort before its acquisition month has no subscribers: 0, not
        // null. A null is an unknown part and withholds the month's total.
        values: Array.from({ length: COHORT_PERIODS }, (_, month) =>
          cohorts.reduce((sum, cohort) => sum + (cohortActive(cohort, month) ?? 0), 0)),
      })),
    },
    options: {
      variant: 'stacked',
      format: '1,234',
      legend: 'top',
      seriesRamp: true,
      // No figure inside a layer: the question the chart answers is what the base is made of.
      labels: { segment: false },
      grandTotalLabels: true,
      size: { width: 760, height: 380 },
      title: 'What the base is made of',
      subtitle: 'Active subscribers by acquisition quarter · 2025 · the older the cohort, the stronger the tone',
      source: 'Synthetic cohort set: twelve 2025 monthly cohorts observed to 31 Dec 2025, pooled by quarter',
    },
  },
];
