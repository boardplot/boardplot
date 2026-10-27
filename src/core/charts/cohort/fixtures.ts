/**
 * Cohort fixtures: two consulting exhibits + one torture triangle. Every one
 * carries a message title and a declared unit.
 *
 * The shapes this chart REFUSES (an inverted staircase, a
 * zero base, a declared base that disagrees with the period-0 count) live in
 * tests/cohort.test.ts, not here: a throwing fixture would break the invariant
 * sweep, which runs every registered fixture automatically.
 */

import { registerFixtures } from '../../../fixtures/registry';
import type { Fixture } from '../../registry';
import type { CohortData, CohortOptions } from './types';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Twelve invented 2025 cohorts. Month-3 retention trends up from 50% (Jan)
 * to 64% (Sep) with a fixed wobble per cohort; month 1 rises with it and
 * later months decay at the rate that joins the two, wobbled per cell
 * (never above the month before, never at month 3).
 */
const LOGO_M1_WOBBLE = [0, 0.012, -0.008, 0.015, -0.005, 0.01, -0.012, 0.006, 0, 0.014, -0.006, 0.009];
const LOGO_M3_WOBBLE = [0, -0.01, 0.012, -0.006, 0.011, -0.013, 0.008, 0.004, 0, -0.009, 0.007, -0.004];
const LOGO_COHORTS = [1200, 1150, 1300, 1400, 1350, 1500, 1600, 1550, 1700, 1750, 1800, 1900].map((size, c) => {
  const month1 = 0.62 + 0.0125 * c + LOGO_M1_WOBBLE[c]!;
  const month3 = 0.5 + 0.0175 * c + LOGO_M3_WOBBLE[c]!;
  const decay = Math.sqrt(month3 / month1);
  const active: number[] = [];
  for (let t = 0; t < 12 - c; t += 1) {
    const wobble = t === 3 ? 0 : (((c * 7 + t * 3) % 5) - 2) * 0.006;
    active.push(t === 0 ? size : Math.min(active[t - 1]!, Math.round(size * month1 * decay ** (t - 1) * (1 + wobble))));
  }
  return { id: `c${String(c + 1).padStart(2, '0')}`, label: `${MONTH_NAMES[c]} 2025`, active };
});

const SEGMENTS = ['enterprise, EMEA direct', 'mid-market, partner-led', 'self-serve, product-led', 'enterprise, NA field'];

/**
 * 24 invented weekly cohorts: sizes shrink by 40 a week and step down every
 * fifth week; week 06 re-activates above its own base in week 3, and the
 * week 21 pilot shrinks to a single member.
 */
const WEEKLY_COHORTS = Array.from({ length: 24 }, (_, w) => {
  const id = `w${String(w + 1).padStart(2, '0')}`;
  if (w === 20) return { id, label: 'Week 21 pilot, APAC self-serve', active: [180, 45, 12, 1] };
  const size = 2400 - 40 * w - 200 * Math.floor(w / 5);
  const week1 = 0.6 + 0.005 * w;
  const decay = 0.93 + 0.001 * w;
  const active = Array.from({ length: 24 - w }, (_, t) => (t === 0 ? size : Math.round(size * week1 * decay ** (t - 1))));
  if (w === 5) active[3] = Math.round(size * 1.02);
  return { id, label: `Week ${id.slice(1)} ${SEGMENTS[w % 4]}`, active };
});

export const fixtures: Fixture<CohortData, CohortOptions>[] = [
  {
    id: 'retention-pure-exhibit',
    title: 'Pure Exhibit cohort table with a dedicated size column and weighted total',
    kind: 'example',
    tags: ['interaction'],
    hover: { owner: { seriesId: 'jan-26', categoryId: 't0' } },
    data: {
      periodLabel: 'Month',
      cohorts: [
        { id: 'jan-26', label: 'Jan 2026', active: [1200, 780, 690, 636] },
        { id: 'feb-26', label: 'Feb 2026', active: [900, 603, 531] },
        { id: 'mar-26', label: 'Mar 2026', active: [1050, 735] },
        { id: 'apr-26', label: 'Apr 2026', active: [800] },
      ],
    },
    options: {
      variant: 'pure',
      exhibitLabel: 'EXHIBIT 13',
      cohortSizeLabel: 'New Customers',
      designatedPeriod: 3,
      threshold: 60,
      total: 'weighted',
      // The table and its notes, with no callout.
      size: { width: 760, height: 379 },
      title: 'Monthly customer retention by acquisition cohort',
      subtitle: { measure: 'Customers retained', period: 'Jan-Apr 2026' },
      unit: '% of cohort base',
      source: 'Subscription ledger, monthly customer snapshots, 30 Apr 2026',
    },
  },
  {
    id: 'retention-stepped-column',
    title: 'Stepped cohort table with column-normalized fills and an incomplete-month exclusion',
    kind: 'example',
    data: {
      periodLabel: 'Month',
      cohorts: [
        { id: 'nov-25', label: 'Nov 2025', active: [1100, 704, 616, 561, 517] },
        { id: 'dec-25', label: 'Dec 2025', active: [1160, 766, 685, 638] },
        { id: 'jan-26', label: 'Jan 2026', active: [1240, 843, 769] },
        { id: 'feb-26', label: 'Feb 2026', active: [1310, 917] },
        { id: 'mar-26', label: 'Mar 2026', active: [900] },
      ],
    },
    options: {
      variant: 'stepped',
      formatScope: 'column',
      visiblePeriods: [0, 1, 2, 3],
      showPercentSign: false,
      total: 'weighted',
      excludeCurrentPeriod: true,
      size: { width: 760, height: 420 },
      title: 'Completed cohort retention by month since acquisition',
      subtitle: { measure: 'Customers retained', period: 'Nov 2025-Mar 2026' },
      unit: '% of cohort base',
      source: 'Subscription ledger, completed monthly cohorts through Feb 2026',
    },
  },
  {
    id: 'saas-logo-retention',
    title: 'Logo retention triangle: month-3 retention climbs from 50% to 64% across the 2025 cohorts',
    kind: 'example',
    data: {
      periodLabel: 'Month',
      cohorts: [
        ...LOGO_COHORTS,
      ],
    },
    options: {
      // Clears the measured floor for twelve readable rows, the colour key
      // and the two method notes (565px with all three).
      size: { width: 720, height: 580 },
      title: 'Newer cohorts retain better: month-3 logo retention improved from 50% to 64% through 2025',
      subtitle: {
        company: 'Nurthwold Cloud',
        measure: 'Paying accounts still active',
        period: 'Cohorts Jan-Dec 2025',
      },
      unit: '% of cohort base',
      source: 'Illustrative subscription ledger, monthly logo snapshots',
      // The column the title is about is outlined.
      highlight: 't3',
    },
  },
  {
    id: 'program-participation-quarterly',
    title: 'Quarterly participation triangle with weighted averages: 60% at quarter 1, on a support base that halves by quarter 3',
    kind: 'example',
    data: {
      periodLabel: 'Quarter',
      cohorts: [
        { id: 'q1-2024', label: 'Q1 2024', size: 4200, active: [4200, 2352, 1806, 1512, 1302, 1134] },
        { id: 'q2-2024', label: 'Q2 2024', active: [3800, 2166, 1672, 1406, 1216] },
        { id: 'q3-2024', label: 'Q3 2024', active: [900, 639, 549, 495] },
        { id: 'q4-2024', label: 'Q4 2024', active: [820, 590, 512] },
        { id: 'q1-2025', label: 'Q1 2025', active: [640, 480] },
        { id: 'q2-2025', label: 'Q2 2025', active: [610] },
      ],
    },
    options: {
      // Four footnote lines of method notes plus source would starve a slide-height
      // matrix of its height, so the canvas is taller.
      size: { width: 720, height: 511 },
      averages: 'weighted',
      // The unweighted average the title compares against prints in the title itself;
      // an authored note would drop in compact mode.
      title: 'Weighted participation holds at 60% after one quarter, six points below the unweighted 66%',
      subtitle: {
        company: 'Federal Skills Programme',
        measure: 'Enrolled participants still attending',
        period: 'Intakes Q1 2024 - Q2 2025',
      },
      unit: '% of intake',
      source: 'Attendance register, quarter-end headcount, 30 Jun 2025',

    },
  },
  {
    id: 'retention-24x24-resurrection',
    title: 'Torture: 24 weekly cohorts x 24 periods, long cohort labels, one resurrection cell and one pilot cohort down to a single member',
    kind: 'torture',
    data: {
      periodLabel: 'Week',
      cohorts: [
        ...WEEKLY_COHORTS,
      ],
    },
    options: {
      // Keep the width needed for all 576 labels; this height clears the 904px row floor.
      size: { width: 1344, height: 953 },
      title: 'Week 06 shows a re-activation spike above its own base; the Week 21 pilot is down to one member',
      subtitle: {
        company: 'Nurthwold Cloud',
        measure: 'Weekly signup cohorts still active',
        period: 'Weeks 01-24, 2025',
      },
      unit: '% of cohort base',
      source: 'Illustrative product analytics, weekly active snapshots',
    },
  },
  {
    id: 'missing-counts',
    title: 'Missing counts leave rates and dependent totals unknown',
    kind: 'torture',
    data: {
      periodLabel: 'Month',
      cohorts: [
        { id: 'a', label: 'Cohort A', active: [100, null, 50, 40] },
        { id: 'b', label: 'Cohort B', active: [100, 60, 30] },
        { id: 'c', label: 'Cohort C', active: [100, 0, null] },
      ],
    },
    options: {
      variant: 'pure',
      title: 'Retention by cohort with missing counts',
      unit: '% of cohort base',
      size: { width: 900 },
    },
  },
];

const stepped = fixtures.find((fixture) => fixture.id === 'retention-stepped-column')!;
fixtures.push({
  ...stepped,
  id: 'retention-stepped-content',
  title: 'Measured cohort columns and a separated weighted average',
  options: { ...stepped.options, size: undefined, mode: 'compact',
    title: 'Completed cohorts retain at least 64% after one month' },
});

fixtures.push({
  ...fixtures[1]!,
  id: 'retention-previous-period',
  title: 'Period-to-period retention with absolute stepped fills and no total row',
  options: {
    ...fixtures[1]!.options!,
    // The grid takes the height of its cohorts.
    size: undefined,
    // Period-to-period rates run 64 to 91: classes that split them.
    basis: 'previous', formatScope: 'classic', total: false, steps: [70, 80, 85, 90],
    title: 'Customer retention compared with the previous month',
    unit: '% of previous period',
  },
});

// Coverage: the method notes under a logo retention grid.
const logoRetention = fixtures.find((fixture) => fixture.id === 'saas-logo-retention')!;
fixtures.push({
  ...logoRetention,
  id: 'logo-retention-method-note',
  title: 'Logo retention with the retention formula and the anchor column explained',
  tags: ['coverage'],
  options: { ...logoRetention.options, methodNote: true, size: { width: 720, height: 613 } },
});

fixtures.push({
  id: 'crowded-average-bases', title: 'Hidden average bases name their periods', kind: 'torture',
  data: { periodLabel: 'Month', cohorts: Array.from({ length: 6 }, (_, i) => ({
    id: `r${i}`, label: `Batch ${i + 1}`, active: Array.from({ length: 8 - i }, (_, j) => 432100 - j * 1703),
  })) },
  options: { title: 'Average support narrows in later periods', variant: 'stepped', averages: 'weighted', size: { width: 1351 } },
});

fixtures.push({
  id: 'emphasis-disabled', title: 'Pure cohort without threshold emphasis', kind: 'example',
  data: { cohorts: [{ id: 'a', label: 'Batch A', active: [200, 90, 40] }, { id: 'b', label: 'Batch B', active: [150, 70] }] },
  options: { title: 'Later cohorts retain fewer members', variant: 'pure', threshold: false, size: { width: 800 } },
}, {
  id: 'fractional-step-key', title: 'Cohort classes keep fractional open upper bounds', kind: 'torture',
  data: { cohorts: [{ id: 'a', label: 'Batch A', active: [1000, 24, 15] }, { id: 'b', label: 'Batch B', active: [800, 8] }] },
  options: { title: 'Low rates need fractional class thresholds', variant: 'stepped', formatScope: 'classic', steps: [0.5, 1, 2, 3], size: { width: 1100 } },
});
for (const variant of ['pure', 'stepped'] as const) fixtures.push({
  id: `cumulative-conversion-${variant}`, title: 'Count-derived cumulative conversion with its own wording', kind: 'example',
  data: { periodLabel: 'Week', cohorts: [{ id: 'a', label: 'Batch A', active: [1000, 5, 12] }, { id: 'b', label: 'Batch B', active: [800, 4] }] },
  options: { title: 'Cumulative conversion rises by the second week', variant, formatScope: 'classic', ...(variant === 'stepped' ? { steps: [0.5, 1, 2, 3] } : {}),
    basis: 'cohort', unit: '%', visiblePeriods: [1, 2], methodNote: true, threshold: 0, size: { width: 1100 },
    strings: { cohortMeasure: 'Cumulative conversion', cohortFormula: 'Cumulative conversion = converted so far / cohort base.' } },
});
registerFixtures('cohort', fixtures);
