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
import { readDateFormat } from './dateFormatRead';
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
function readTickDates(
  dates: readonly (string | undefined)[],
  interval: DateTickInterval,
  weekStartsOn?: 0 | 1,
) {
  const start = weekStartsOn === 0 ? 0 : 1;
  const parsed: Date[] = [];
  const ordinals: number[] = [];
  for (const raw of dates) {
    const date = raw === undefined ? null : parseISODate(raw);
    if (!date) return null;
    parsed.push(date);
    ordinals.push(intervalOrdinal(date, interval, start));
  }
  return parsed.length ? { parsed, ordinals } : null;
}

function startsOfIntervals(ordinals: number[]): boolean[] {
  return ordinals.map((ordinal, i) => i === 0 || ordinal !== ordinals[i - 1]);
}

/** Calendar boundaries by default; with fromEnd, matching periods counted back from the latest date. */
export function dateTickKeep(
  dates: readonly (string | undefined)[],
  interval: DateTickInterval,
  weekStartsOn?: 0 | 1,
  fromEnd = false,
): boolean[] | null {
  const series = readTickDates(dates, interval, weekStartsOn);
  if (!series) return null;
  return fromEnd ? keepFromEnd(series.parsed, series.ordinals, interval) : startsOfIntervals(series.ordinals);
}

function keepFromEnd(parsed: Date[], ordinals: number[], interval: DateTickInterval): boolean[] {
  const latest = parsed.at(-1)!;
  const monthEnd = (date: Date) => { const end = new Date(date); end.setUTCMonth(date.getUTCMonth() + 1, 0); return end.getUTCDate(); };
  const atMonthEnd = latest.getUTCDate() === monthEnd(latest);
  const lastOrdinal = ordinals.at(-1)!;
  const keep = parsed.map(() => false);
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

/** Keep a partial first calendar interval only when the data starts within one category step of its boundary. */
function keepCalendar(parsed: Date[], interval: 'years' | 'quarters' | 'months', keep: boolean[]): boolean[] {
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

/** The tick mask and planner use the same parsed dates and interval ordinals. */
export function planDateTicks(dates: readonly (string | undefined)[], interval: DateTickInterval, weekStartsOn?: 0 | 1) {
  const series = readTickDates(dates, interval, weekStartsOn);
  if (!series) return null;
  const { parsed, ordinals } = series;
  const ticks = startsOfIntervals(ordinals);
  const keep = interval === 'months' || interval === 'quarters' || interval === 'years'
    ? keepCalendar(parsed, interval, ticks.slice())
    : keepFromEnd(parsed, ordinals, interval);
  return { ordinals, ticks, keep };
}

/** Date format-by-example → formatDate pattern (tokens in this file). */
export function datePatternFromExample(example?: string, language?: string): string {
  return readDateFormat(example, 'table', language).pattern!;
}
