/**
 * The synthetic cohort set the cohort fixtures share: twelve monthly 2025
 * cohorts, their sizes, and the share of each still active M months after
 * acquisition. One copy, so the heat grid, the curves and the layers state
 * the same facts and a reader can check one against the other.
 *
 * The numbers are invented.
 */

export const COHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** New subscribers acquired in each month of 2025. */
export const COHORT_SIZE = [1240, 1180, 1310, 1425, 1390, 1508, 1622, 1570, 1690, 1745, 1820, 1905];

/** Share of each cohort still active M months after acquisition. */
export const COHORT_RETAINED: number[][] = [
  [100, 62, 56, 50, 45, 41, 37, 33, 30, 27, 24, 21],
  [100, 63, 57, 52, 47, 43, 39, 35, 32, 28, 26],
  [100, 64, 59, 53, 49, 45, 41, 37, 34, 31],
  [100, 65, 60, 55, 51, 46, 43, 39, 36],
  [100, 66, 62, 57, 53, 48, 45, 41],
  [100, 68, 63, 59, 55, 51, 47],
  [100, 69, 65, 60, 57, 53],
  [100, 70, 66, 62, 59],
  [100, 71, 68, 64],
  [100, 73, 69],
  [100, 74],
  [100],
];

export const COHORT_LABEL = COHORT_MONTHS.map((month) => `${month} 25`);
export const COHORT_PERIODS = COHORT_RETAINED[0]!.length;
export const COHORT_IDS = COHORT_LABEL.map((_, index) => `c${index}`);

export const cohortSum = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0);

/** Retention on the since-acquisition axis: cohort i at M months. */
export const cohortRelative = (cohort: number, month: number): number | null =>
  COHORT_RETAINED[cohort]![month] ?? null;

/** The same cohorts on calendar time: a cohort's first value sits in its own month. */
export const cohortCalendar = (cohort: number, month: number): number | null =>
  month < cohort ? null : (COHORT_RETAINED[cohort]![month - cohort] ?? null);

/** Subscribers of one cohort still active in a calendar month. */
export const cohortActive = (cohort: number, month: number): number | null => {
  const value = cohortCalendar(cohort, month);
  return value === null ? null : Math.round((COHORT_SIZE[cohort]! * value) / 100);
};
