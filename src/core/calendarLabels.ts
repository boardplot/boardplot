/**
 * Labels for date categories the author left unlabelled: '4 Sep', 'Sep', 'Q3',
 * 'W36' and '2026' instead of the ISO id. A category's date is its `date`, else its id when
 * that is an ISO day (2026-09-04), month (2026-09), week (2026-W36) or
 * quarter (2026-Q3). Day dates on the first of each month (or on each month
 * end) read as months, quarters or years when every step between them is one.
 * The year shows on the first label and at each change; on a chart that draws
 * a year row under its months and quarters, it shows there instead. On such a
 * chart a day keeps its month ('4 Sep'), and its year prints once
 * in a row under the days. Authored
 * labels always win, and nothing changes unless every category has a date.
 */
import { DATE_TICK_STRIDES, dateTickKeep, dateTickKeepCalendar, dateTickOrdinals, type DateTickInterval } from './dateFormat';
import { dateNames } from './dateNames';
import { wordLanguage } from './numberMarks';
import { parseISODate, utcDate } from './isoDate';
import type { Category } from './types/data';

type CalendarUnit = 'day' | 'week' | 'month' | 'quarter' | 'year';

/** What the engine derived for a category; layouts read it, authors never write it. */
export interface CalendarInfo {
  unit: CalendarUnit;
  /** The calendar year, or the ISO week-year for a week. */
  year: number;
  /** The label names the year: the stride keeps it, so the row never loses the year. */
  yearShown: boolean;
  /** The year prints in a row of its own under this day, month or quarter. */
  yearRow?: true;
  /** The day's month ('Sep'), printed with the year in a row of its own under the day numbers. */
  monthRow?: string;
  /** The day's label with its weekday ('Fri 4 Sep'), drawn where the row has room for it. */
  weekday?: string;
  /** The name a note gives this derived period when the categories span more than one year ("Nov 2023"). */
  named?: string;
}

type Raw = string | (Category & { calendar?: CalendarInfo });

interface Point { unit: 'day' | 'week' | 'month' | 'quarter'; date: Date; week?: number; weekYear?: number }

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const WEEK = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/;
const QUARTER = /^(\d{4})-Q([1-4])$/;

/** ISO 8601 week and week-year: the week holding the year's first Thursday is week 1. */
function isoWeek(date: Date): { week: number; weekYear: number } {
  const thursday = utcDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7));
  const weekYear = thursday.getUTCFullYear();
  return { week: 1 + Math.floor((thursday.getTime() - utcDate(weekYear, 0, 1).getTime()) / 604800000), weekYear };
}

function pointOf(text: string): Point | undefined {
  const day = parseISODate(text);
  if (day) return { unit: 'day', date: day };
  const month = MONTH.exec(text);
  if (month) return { unit: 'month', date: utcDate(+month[1]!, +month[2]! - 1) };
  const quarter = QUARTER.exec(text);
  if (quarter) return { unit: 'quarter', date: utcDate(+quarter[1]!, (+quarter[2]! - 1) * 3) };
  const week = WEEK.exec(text);
  if (!week) return undefined;
  // Monday of the week: week 1 holds 4 January.
  const jan4 = utcDate(+week[1]!, 0, 4);
  const date = utcDate(+week[1]!, 0, 4 - ((jan4.getUTCDay() + 6) % 7) + (+week[2]! - 1) * 7);
  const iso = isoWeek(date);
  return iso.weekYear === +week[1]! && iso.week === +week[2]! ? { unit: 'week', date, ...iso } : undefined;
}

const monthIndex = (date: Date) => date.getUTCFullYear() * 12 + date.getUTCMonth();
const isMonthEnd = (date: Date) => utcDate(date.getUTCFullYear(), date.getUTCMonth() + 1, 0).getUTCDate() === date.getUTCDate();

/** Day dates that all sit on month starts (or all on month ends) at whole-month steps read as months, quarters or years. */
export function dayUnit(dates: readonly Date[]): CalendarUnit {
  if (dates.length < 2) return 'day';
  const ends = dates.every(isMonthEnd);
  if (!ends && !dates.every((date) => date.getUTCDate() === 1)) return 'day';
  const months = dates.map(monthIndex);
  const steps = months.slice(1).map((m, i) => m - months[i]!);
  if (steps.some((step) => step <= 0)) return 'day';
  // A quarter ends in March, June, September or December; it starts a month after the one before.
  const phase = ends ? 2 : 0;
  if (months.every((m) => m % 12 === (ends ? 11 : 0)) && steps.every((step) => step % 12 === 0)) return 'year';
  if (months.every((m) => m % 3 === phase) && steps.every((step) => step % 3 === 0)) return 'quarter';
  return 'month';
}

/**
 * The categories with derived labels and calendar info, or undefined when no
 * category needs one. `yearRow` says the chart draws the year under its
 * day, month and quarter labels, so those labels leave the year out.
 */
export function calendarCategories(categories: readonly Raw[], language?: string, yearRow = false): (Category & { calendar: CalendarInfo })[] | undefined {
  return deriveCalendar(categories, language, yearRow)?.categories;
}

/**
 * Each unlabelled category's period with its year ("Mar 2025", "4 Sep 2026",
 * "Q3 2026", "2026"), for a reader who meets one category at a time, such as
 * the hover card's heading; undefined where the author gave a label, or when
 * the categories have no calendar.
 */
export function calendarNames(categories: readonly Raw[], language?: string): (string | undefined)[] | undefined {
  return deriveCalendar(categories, language)?.names;
}

function deriveCalendar(categories: readonly Raw[], language?: string, yearRow = false) {
  const unlabelled = (raw: Raw) => typeof raw === 'string' || raw.label === undefined;
  if (categories.length === 0 || !categories.some(unlabelled)) return undefined;
  const points = categories.map((raw) => typeof raw === 'string' ? pointOf(raw) : pointOf(raw.date ?? raw.id));
  if (points.some((point) => point === undefined)) return undefined;
  const kinds = new Set(points.map((point) => point!.unit));
  if (kinds.size !== 1) return undefined;
  const kind = [...kinds][0]!;
  const unit: CalendarUnit = kind === 'day' ? dayUnit(points.map((point) => point!.date)) : kind;
  const tag = (wordLanguage(language) ?? 'en').toLowerCase().replace(/_/g, '-');
  const de = tag === 'de' || tag.startsWith('de-');
  const us = tag === 'en-us';
  const months = dateNames(language).monthsShort;
  const inRow = yearRow && (unit === 'day' || unit === 'month' || unit === 'quarter');
  let previous: number | undefined;
  // Over more than one year a short name repeats ("Nov" twice): a note names each period with its year.
  const years = unit !== 'year' && new Set(points.map((point) => point!.weekYear ?? point!.date.getUTCFullYear())).size > 1;
  const names: (string | undefined)[] = [];
  const derived = categories.map((raw, i) => {
    const point = points[i]!;
    const { date } = point;
    const year = unit === 'week' ? point.weekYear ?? isoWeek(date).weekYear : date.getUTCFullYear();
    const yearShown = unit !== 'year' && !inRow && year !== previous;
    // An authored label never prints the year, so the year stays pending for the next derived label.
    if (unlabelled(raw)) previous = year;
    const month = months[date.getUTCMonth()]!;
    const day = date.getUTCDate();
    const calendar: CalendarInfo = {
      unit, year, yearShown, ...(inRow ? { yearRow: true as const } : {}),
    };
    const category: Category & { calendar: CalendarInfo } = typeof raw === 'string' ? { id: raw, calendar } : { ...raw, calendar };
    if (!unlabelled(raw)) return { ...category, calendar: { ...category.calendar, yearShown: false } };
    const week = String(point.week ?? isoWeek(date).week).padStart(2, '0');
    const base = unit === 'year' ? String(year)
      : unit === 'quarter' ? `Q${Math.floor(date.getUTCMonth() / 3) + 1}`
        : unit === 'month' ? month
          : unit === 'week' ? (de ? `KW ${week}` : `W${week}`)
            : de ? `${day}. ${month}` : us ? `${month} ${day}` : `${day} ${month}`;
    if (inRow && unit === 'day') calendar.weekday = `${dateNames(language).daysShort[date.getUTCDay()]!} ${base}`;
    const named = `${base}${us && unit === 'day' ? ',' : ''} ${year}`;
    names[i] = unit === 'year' ? base : named;
    return { ...category, ...years && { calendar: { ...calendar, named } }, label: yearShown ? named : base };
  });
  return { categories: derived, names };
}

/**
 * The calendar a row of category dates lives on, for the tick rule. `texts` are
 * the categories' `date`, else their id: an ISO day, month, quarter or week.
 * The answer is undefined when any category has no such date or the kinds are
 * mixed. A row of months or quarters also returns each category's month index
 * (year * 12 + month, from 0), strictly rising: its ticks sit on
 * calendar-aligned steps, so every chart type that shares a category row picks
 * the same months. Days and weeks return no months; they count equal steps
 * back from the latest period.
 */
export function calendarMonths(texts: readonly (string | undefined)[]): { unit: CalendarUnit; months?: number[] } | undefined {
  const points = texts.map((text) => text === undefined ? undefined : pointOf(text));
  const kind = points[0]?.unit;
  if (!kind || points.some((point) => point?.unit !== kind)) return undefined;
  const unit: CalendarUnit = kind === 'day' ? dayUnit(points.map((point) => point!.date)) : kind;
  if (unit !== 'month' && unit !== 'quarter') return { unit };
  const months = points.map((point) => monthIndex(point!.date));
  return months.every((m, i) => i === 0 || m > months[i - 1]!) ? { unit, months } : undefined;
}

/**
 * A category row ticked by a calendar interval (categoryAxis.dateTicks).
 * `ticks` marks the first category of each interval, or is null when a
 * category has no ISO `date`. `plan` lets the row planner keep one label per
 * interval on round strides. `name` relabels the row so each kept label names
 * its interval.
 */
export function dateTickRow(cats: readonly Category[], dateTicks: DateTickInterval, language?: string, weekStartsOn?: 0 | 1) {
  const n = cats.length;
  const dates = cats.map((category) => category.date);
  const ordinals = dateTickOrdinals(dates, dateTicks, weekStartsOn);
  // Months, quarters and years sit on the calendar (the first category of each interval, round steps
  // from January); weeks and days count equal steps back from the latest period.
  const calendarTicks = dateTicks === 'months' || dateTicks === 'quarters' || dateTicks === 'years';
  const keep = ordinals ? calendarTicks ? dateTickKeepCalendar(dates, dateTicks) : dateTickKeep(dates, dateTicks, weekStartsOn, true) : null;
  // The derived labels, once per row: a layout plans its row in several passes.
  const dated = cats.map((category) => ({ id: category.id, date: category.date }));
  let full: ReturnType<typeof calendarCategories> | null = null;
  let inRow: ReturnType<typeof calendarCategories> | null = null;
  const fullCalendar = () => (full === null ? (full = calendarCategories(dated, language)) : full);
  const rowCalendar = () => (inRow === null ? (inRow = calendarCategories(dated, language, true)) : inRow);
  return {
    // A tick at the first category of each interval; the row thins them by the interval.
    ticks: ordinals?.map((ordinal, i) => i === 0 || ordinal !== ordinals[i - 1]) ?? null,
    plan: keep ? { keep, dateStride: { ordinals: ordinals!, strides: DATE_TICK_STRIDES[dateTicks], ...(calendarTicks ? { calendar: true as const } : {}) } } : {},
    name(row: { labels: string[]; calendar?: (CalendarInfo | undefined)[] }) {
      // A calendar interval names its year in the tick, without a separate year row.
      if (calendarTicks && row.calendar?.some(info => info?.unit === 'day' && info.yearRow)) {
        const inRow = rowCalendar();
        const full = fullCalendar();
        if (inRow && full) {
          row.labels = row.labels.map((label, i) => label === inRow[i]!.label ? full[i]!.label! : label);
          row.calendar = full.map((category, i) => row.calendar![i] && category.calendar);
        }
      }
      // A yearly tick names its year: "Jan 1980" reads 1980. A label that does
      // not carry the calendar year (FY24) keeps its own text.
      if (dateTicks === 'years' && ordinals) {
        row.labels = row.labels.map((label, i) => (i !== n - 1 && label.includes(String(ordinals[i])) ? String(ordinals[i]) : label));
      }
      // A monthly tick on daily dates names its month: "1 Apr 2025" reads "Apr
      // 2025" and "2 Jun" reads "Jun". Only the engine's own day labels change.
      if (dateTicks === 'months' && ordinals) {
        const derived = fullCalendar();
        const months = dateNames(language).monthsShort;
        if (derived?.[0]?.calendar.unit === 'day') row.labels = row.labels.map((label, i) => {
          const own = derived[i]!;
          if (i === n - 1 || label !== own.label) return label;
          const month = months[(ordinals[i]! % 12 + 12) % 12]!;
          return own.calendar.yearShown || i === 0 ? `${month} ${own.calendar.year}` : month;
        });
      }
    },
  };
}

/**
 * A default day row that steps past four weeks prints day numbers that drift
 * from month to month ("3 2 1 31 30"); the month calendar names that span
 * instead. Returns the categories to tick by month, each with its ISO id as
 * `date` where it has none, or undefined when the categories are not days.
 */
export function dayCategories<C extends Category>(cats: readonly C[]): C[] | undefined {
  if (calendarMonths(cats.map((category) => category.date ?? category.id))?.unit !== 'day') return undefined;
  // An ISO id names its date as `date` does; the month planner reads `date`.
  return cats.map((category) => (category.date === undefined ? { ...category, date: category.id } : category));
}

/** The last month row: a layout plans its row in many passes over the same categories. */
let lastMonthRow: { key: string; row: ReturnType<typeof dateTickRow> | null } | undefined;

/**
 * The month tick row for a banded day row (column, combo) whose `stride`
 * passes four weeks, else undefined. The row depends only on the category ids,
 * dates and language, so passes over the same categories reuse it.
 */
export function longDayMonths(cats: readonly Category[], stride: number, language?: string): ReturnType<typeof dateTickRow> | undefined {
  if (stride <= 28) return undefined;
  // JSON keeps ids apart whatever characters they hold.
  const key = JSON.stringify([language ?? null, cats.map((category) => [category.id, category.date ?? null])]);
  if (lastMonthRow?.key !== key) {
    const days = dayCategories(cats);
    lastMonthRow = { key, row: days ? dateTickRow(days, 'months', language) : null };
  }
  return lastMonthRow.row ?? undefined;
}
