/**
 * Date format codes (a subset of common date-format codes):
 *   d, dd          day of month (1, 01)
 *   ddd, dddd      weekday (Mon, Monday)
 *   M, MM, MMM, MMMM, MMMMM   month (1, 01, Jan, January, J)
 *   Q, QQ, QQQ     quarter (1, Q1, Quarter 1)
 *   w, ww          ISO week (5, 05)
 *   yy, yyyy       year (26, 2026)
 *   'literal'      quoted literals pass through
 */

import { dateNames } from './dateNames';
import { parseISODate, utcDate } from './isoDate';

// parseISODate lives in its own module so that a chart whose layout only
// parses dates does not pull the display formatter into its React bundle.
// The name tables do too: the tick grammar reads them on every category axis.
export { parseISODate };

function isoWeek(date: Date): number {
  const d = utcDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = utcDate(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function quarterOf(date: Date): number {
  return Math.floor(date.getUTCMonth() / 3) + 1;
}

const TOKEN_RE = /('[^']*')|dddd|ddd|dd|d|MMMMM|MMMM|MMM|MM|M|QQQ|QQ|Q|ww|w|yyyy|yy/g;

export function formatDate(date: Date, pattern: string, language?: string): string {
  const names = dateNames(language);
  return pattern.replace(TOKEN_RE, (tok) => {
    if (tok.startsWith("'")) return tok.slice(1, -1);
    switch (tok) {
      case 'd': return String(date.getUTCDate());
      case 'dd': return String(date.getUTCDate()).padStart(2, '0');
      case 'ddd': return names.daysShort[date.getUTCDay()]!;
      case 'dddd': return names.days[date.getUTCDay()]!;
      case 'M': return String(date.getUTCMonth() + 1);
      case 'MM': return String(date.getUTCMonth() + 1).padStart(2, '0');
      case 'MMM': return names.monthsShort[date.getUTCMonth()]!;
      case 'MMMM': return names.months[date.getUTCMonth()]!;
      case 'MMMMM': return names.months[date.getUTCMonth()]![0]!;
      case 'Q': return String(quarterOf(date));
      case 'QQ': return `Q${quarterOf(date)}`;
      case 'QQQ': return `Quarter ${quarterOf(date)}`;
      case 'w': return String(isoWeek(date));
      case 'ww': return String(isoWeek(date)).padStart(2, '0');
      case 'yy': return String(date.getUTCFullYear() % 100).padStart(2, '0');
      case 'yyyy': return String(date.getUTCFullYear()).padStart(4, '0');
      default: return tok;
    }
  });
}

/** Intervals the category axis can label one tick per. */
export type DateTickInterval = 'years' | 'quarters' | 'months' | 'weeks' | 'days';

/**
 * Day count of the week a date falls in. The epoch (1970-01-01) was a Thursday,
 * so a Monday-start ladder needs an offset of 3 and a Sunday-start ladder 4.
 * ISO weeks stay Monday-based: `formatDate`'s 'w' token is unchanged, and only
 * the tick ladder follows `weekStartsOn`.
 */
function weekOrdinal(date: Date, weekStartsOn: 0 | 1): number {
  const days = Math.floor(date.getTime() / 86400000);
  return Math.floor((days + (weekStartsOn === 1 ? 3 : 4)) / 7);
}

/**
 * Calendar ordinal of one interval: two dates share a tick when their
 * ordinals match, and consecutive intervals count up by one (the year, the
 * quarter or month since year 0, the week or the day since the epoch), so a
 * stride over them can keep the round ones.
 */
function intervalOrdinal(date: Date, interval: DateTickInterval, weekStartsOn: 0 | 1): number {
  const year = date.getUTCFullYear();
  switch (interval) {
    case 'years': return year;
    case 'quarters': return year * 4 + quarterOf(date) - 1;
    case 'months': return year * 12 + date.getUTCMonth();
    case 'weeks': return weekOrdinal(date, weekStartsOn);
    case 'days': return Math.floor(date.getTime() / 86400000);
  }
}

/**
 * The strides a date row thins its ticks by, per interval: each keeps round
 * intervals only, such as every tenth year from 1980 or every third month
 * from January.
 */
export const DATE_TICK_STRIDES: Record<DateTickInterval, readonly number[]> = {
  years: [2, 5, 10, 20, 25, 50, 100],
  quarters: [2, 4, 8, 20, 40],
  months: [2, 3, 6, 12, 24, 60, 120],
  weeks: [2, 4, 13, 26, 52],
  days: [2, 7, 14, 28],
};

/**
 * The interval ordinal of every category, or null when any category lacks a
 * parseable ISO date, which is the combination the caller refuses and reports
 * rather than guessing an interval from authored label text.
 */
export function dateTickOrdinals(
  dates: readonly (string | undefined)[],
  interval: DateTickInterval,
  weekStartsOn?: 0 | 1,
): number[] | null {
  const start: 0 | 1 = weekStartsOn === 0 ? 0 : 1;
  const ordinals: number[] = [];
  for (const raw of dates) {
    const date = raw === undefined ? null : parseISODate(raw);
    if (!date) return null;
    ordinals.push(intervalOrdinal(date, interval, start));
  }
  return ordinals.length === 0 ? null : ordinals;
}

/** Calendar boundaries by default; with fromEnd, matching periods counted back from the latest date. */
export function dateTickKeep(
  dates: readonly (string | undefined)[],
  interval: DateTickInterval,
  weekStartsOn?: 0 | 1,
  fromEnd = false,
): boolean[] | null {
  if (fromEnd) {
    const parsed = dates.map(raw => raw === undefined ? null : parseISODate(raw));
    const latest = parsed.at(-1);
    if (!latest || parsed.some(date => !date)) return null;
    const monthEnd = (date: Date) => { const end = new Date(date); end.setUTCMonth(date.getUTCMonth() + 1, 0); return end.getUTCDate(); };
    const atMonthEnd = latest.getUTCDate() === monthEnd(latest);
    const ordinals = dateTickOrdinals(dates, interval, weekStartsOn)!;
    const lastOrdinal = ordinals.at(-1)!;
    const keep = dates.map(() => false);
    let group: number | undefined;
    let target = 0;
    let best = -1;
    for (let i = 0; i < parsed.length; i++) {
      const ordinal = ordinals[i]!;
      if (ordinal !== group) {
        group = ordinal;
        best = -1;
        const back = lastOrdinal - ordinal;
        const date = new Date(latest);
        if (interval === 'days' || interval === 'weeks') date.setUTCDate(latest.getUTCDate() - back * (interval === 'weeks' ? 7 : 1));
        else {
          date.setUTCDate(1);
          date.setUTCMonth(latest.getUTCMonth() - back * (interval === 'years' ? 12 : interval === 'quarters' ? 3 : 1));
          date.setUTCDate(atMonthEnd ? monthEnd(date) : Math.min(latest.getUTCDate(), monthEnd(date)));
        }
        target = date.getTime();
      }
      // A partial first interval may drop. Within a calendar interval use
      // the nearest available period, so a weekend does not erase its month.
      if (target < parsed[0]!.getTime()) continue;
      if (best < 0 || Math.abs(parsed[i]!.getTime() - target) < Math.abs(parsed[best]!.getTime() - target)) {
        if (best >= 0) keep[best] = false;
        best = i;
        keep[i] = true;
      }
    }
    return keep;
  }
  return dateTickOrdinals(dates, interval, weekStartsOn)?.map((ordinal, i, all) => i === 0 || ordinal !== all[i - 1]) ?? null;
}

/**
 * Calendar ticks: the first category of each calendar year, quarter
 * or month. A first category that does not begin its interval (data from
 * November, ticks by quarter) is not a quarter start and gets no tick: it
 * sits more than one category step after the interval start, so an earlier
 * category of that interval is missing. A period-end date counts as its period.
 */
export function dateTickKeepCalendar(
  dates: readonly (string | undefined)[],
  interval: 'years' | 'quarters' | 'months',
): boolean[] | null {
  const keep = dateTickKeep(dates, interval);
  if (!keep?.[0]) return keep;
  const parsed = dates.map(raw => raw === undefined ? null : parseISODate(raw));
  if (parsed.some(date => !date)) return keep;
  const first = parsed[0]!;
  const months = interval === 'years' ? 12 : interval === 'quarters' ? 3 : 1;
  const start = new Date(first);
  start.setUTCDate(1);
  start.setUTCMonth(Math.floor(first.getUTCMonth() / months) * months);
  let gap = Infinity;
  for (let i = 1; i < parsed.length; i++) gap = Math.min(gap, (parsed[i]!.getTime() - parsed[i - 1]!.getTime()) / 86400000);
  if ((first.getTime() - start.getTime()) / 86400000 > gap) keep[0] = false;
  return keep;
}

/** Date format-by-example → formatDate pattern (tokens in this file). */
export function datePatternFromExample(example?: string): string {
  if (!example) return 'd MMM yyyy';
  if (/^\d{4}-\d{2}-\d{2}$/.test(example)) return 'yyyy-MM-dd';
  if (/^[A-Za-z]{3}-\d{2}$/.test(example)) return 'MMM-yy';
  if (/^\d{1,2} [A-Za-z]{3} \d{4}$/.test(example)) return 'd MMM yyyy';
  if (/^[A-Za-z]{3} \d{4}$/.test(example)) return 'MMM yyyy';
  if (/^Q\d \d{4}$/.test(example)) return 'QQ yyyy';
  return 'd MMM yyyy';
}
