/**
 * A continuous time axis: instants in a named IANA zone. Parsing, the zone's
 * offsets, the tick ladder and every tick, record and note text. The engine
 * formats its own text from the zone offsets `Intl` reports, so the output
 * does not depend on the host's locale data beyond the zone rules.
 */

import { dateNames } from './dateNames';
import { MINUS } from './format';
import { wordLanguage } from './numberMarks';
import { NormalizeError } from './normalize/shared';
import { parseTimeText } from './isoTime';

export { parseTimeText };

/** Numeric annotation x anchors name epoch milliseconds, independent of the axis zone. */
export function timeAnnotationAnchors(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const instant = (value: unknown): unknown => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return value;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : value;
  };
  const anchor = (value: unknown): unknown => value && typeof value === 'object' && 'categoryId' in value
    ? { ...value, categoryId: instant(value.categoryId) } : instant(value);
  const annotation = { ...raw } as Record<string, unknown>;
  for (const key of ['at', 'from', 'to', 'date', 'end']) {
    if (Object.hasOwn(annotation, key)) annotation[key] = anchor(annotation[key]);
  }
  // A plain numeric vs is a value, not an x anchor. An object names a reading.
  if (annotation.kind === 'delta' && typeof annotation.vs === 'object') annotation.vs = anchor(annotation.vs);
  return annotation;
}

const MINUTE = 60_000;
const pad2 = (n: number) => String(n).padStart(2, '0');
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** Zone transitions fall on quarter hours of UTC; one offset lookup serves each quarter. */
const QUARTER_HOUR = 900_000;

export interface ZoneClock {
  zone: string;
  /** Offset of local wall time from UTC at the instant, in ms. */
  offsetAt(ms: number): number;
}

const clocks = new Map<string, ZoneClock>();

/** The clock of an IANA zone; an unknown name is refused. */
export function zoneClock(zone = 'UTC', path = 'options.xAxis.zone'): ZoneClock {
  const known = clocks.get(zone);
  if (known) return known;
  if (zone === 'UTC') {
    const utc: ZoneClock = { zone, offsetAt: () => 0 };
    clocks.set(zone, utc);
    return utc;
  }
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
  } catch {
    throw new NormalizeError('x-zone-unknown', path, `'${zone}' is not an IANA time zone this runtime knows`, "use a zone name such as 'Europe/Berlin', 'America/New_York' or 'UTC'");
  }
  const cache = new Map<number, number>();
  const lookup = (ms: number): number => {
    const parts: Record<string, number> = {};
    for (const part of format.formatToParts(new Date(ms))) if (part.type !== 'literal') parts[part.type] = Number(part.value);
    const wall = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
    return wall - Math.floor(ms / 1000) * 1000;
  };
  const clock: ZoneClock = {
    zone,
    offsetAt(ms) {
      const bucket = Math.floor(ms / QUARTER_HOUR);
      let offset = cache.get(bucket);
      if (offset === undefined) {
        offset = lookup(bucket * QUARTER_HOUR);
        cache.set(bucket, offset);
      }
      return offset;
    },
  };
  clocks.set(zone, clock);
  return clock;
}

/** The instants a wall-clock time names in the zone: one, two in a repeated hour, none in a skipped hour. */
export function wallInstants(wall: number, clock: ZoneClock): number[] {
  const before = clock.offsetAt(wall - DAY), after = clock.offsetAt(wall + DAY);
  const found: number[] = [];
  for (const offset of before === after ? [before] : [before, after]) {
    const instant = wall - offset;
    if (clock.offsetAt(instant) === offset && !found.includes(instant)) found.push(instant);
  }
  return found.sort((a, b) => a - b);
}

/** A wall time in a skipped hour reads forward by the gap, as a clock that springs forward does. */
function forwardInstant(wall: number, clock: ZoneClock): number {
  return wall - clock.offsetAt(wall - DAY);
}

/**
 * The years from one instant to a later one on the zone's calendar: the
 * whole years to the last anniversary, plus the rest over the length of the
 * year after it, in ms (actual/actual by anniversaries). 1 Jan 2020 to
 * 1 Jan 2025 at the same wall time is 5. An anniversary keeps the start's
 * wall time; 29 February falls on 28 February in a common year, a repeated
 * wall time takes the earlier instant and a skipped one reads forward.
 */
export function zoneYearSpan(from: number, to: number, clock: ZoneClock): number {
  if (to < from) return -zoneYearSpan(to, from, clock);
  const start = new Date(from + clock.offsetAt(from));
  const anniversary = (n: number): number => {
    // setUTCFullYear keeps years before 100, which Date.UTC reads as 19xx.
    const year = start.getUTCFullYear() + n, month = start.getUTCMonth();
    const monthEnd = new Date(0);
    monthEnd.setUTCFullYear(year, month + 1, 0);
    const at = new Date(start.getTime());
    at.setUTCFullYear(year, month, Math.min(start.getUTCDate(), monthEnd.getUTCDate()));
    const wall = at.getTime();
    return n === 0 ? from : wallInstants(wall, clock)[0] ?? forwardInstant(wall, clock);
  };
  let n = Math.max(0, new Date(to + clock.offsetAt(to)).getUTCFullYear() - start.getUTCFullYear());
  while (n > 0 && anniversary(n) > to) n--;
  while (anniversary(n + 1) <= to) n++;
  const last = anniversary(n);
  return n + (to - last) / (anniversary(n + 1) - last);
}

/**
 * Authored x values to instants, in input order. A number is epoch ms. A
 * wall time in the hour the zone repeats takes the earliest instant after the
 * value before it, and the order must prove it: an increasing run that comes
 * back through the hour reads the first pass at the earlier offset and the
 * second at the later one. A repeated time the run never comes back to, and a
 * time the zone skips, are refused: the chart does not guess when a reading
 * happened.
 */
export function resolveTimes(values: readonly unknown[], clock: ZoneClock, path: (index: number) => string): number[] {
  let previous = Number.NEGATIVE_INFINITY;
  // Repeated-hour readings read at the earlier offset, per wall day, until a later pass proves them.
  const unproven = new Map<number, number>();
  const instants = values.map((value, index) => {
    let ms: number;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new NormalizeError('x-invalid', path(index), `x value ${String(value)} is not a finite time`, 'give an ISO 8601 date-time such as 2026-10-25T02:30 or epoch milliseconds');
      ms = value;
    } else {
      const parsed = typeof value === 'string' ? parseTimeText(value) : null;
      if (!parsed) {
        throw new NormalizeError('x-invalid', path(index), `x value ${JSON.stringify(value)} is not an ISO 8601 date or date-time`,
          'write it as 2026-10-25, 2026-10-25T02:30, 2026-10-25T02:30:15 or with an offset, 2026-10-25T02:30+01:00');
      }
      if (parsed.offset !== undefined) ms = parsed.wall - parsed.offset;
      else {
        const found = wallInstants(parsed.wall, clock);
        if (found.length === 0) {
          throw new NormalizeError('x-time-skipped', path(index), `x value '${String(value)}' names a wall-clock time that ${clock.zone} skips when its clocks go forward, so no reading can have happened then`,
            'check the source clock, or give the time with its UTC offset');
        }
        if (found.length === 1) ms = found[0]!;
        else {
          ms = found.find((instant) => instant > previous) ?? found[0]!;
          const day = Math.floor(parsed.wall / DAY);
          if (ms === found[0]) { if (!unproven.has(day)) unproven.set(day, index); }
          else unproven.delete(day);
        }
      }
    }
    previous = ms;
    return ms;
  });
  for (const index of unproven.values()) {
    throw new NormalizeError('x-time-ambiguous', path(index), `x value '${String(values[index])}' falls in the hour ${clock.zone} repeats when its clocks go back, and the order of the values does not show which of the two passes it is`,
      `give it with its UTC offset, such as ${String(values[index])}${offsetSuffix(clock.offsetAt(instants[index]!))} for the first pass`);
  }
  return instants;
}

/** '+02:00' for an ISO time. */
function offsetSuffix(offset: number): string {
  const minutes = Math.round(Math.abs(offset) / MINUTE);
  return `${offset < 0 ? '-' : '+'}${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

/** Local wall-clock fields of an instant. */
function wallOf(ms: number, clock: ZoneClock): Date {
  return new Date(ms + clock.offsetAt(ms));
}

/** 'UTC+2', 'UTC+5:30', 'UTC−3'. */
export function offsetText(offset: number): string {
  if (offset === 0) return 'UTC';
  const minutes = Math.round(Math.abs(offset) / MINUTE);
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return `UTC${offset < 0 ? MINUS : '+'}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

/** The instant's wall time occurs twice in the zone. */
export function inRepeatedHour(ms: number, clock: ZoneClock): boolean {
  return wallInstants(ms + clock.offsetAt(ms), clock).length > 1;
}

type DayStyle = 'de' | 'us' | 'en';
function dayStyle(language?: string): DayStyle {
  const tag = (wordLanguage(language) ?? 'en').toLowerCase().replace(/_/g, '-');
  return tag === 'de' || tag.startsWith('de-') ? 'de' : tag === 'en-us' ? 'us' : 'en';
}


/** '24 Oct', '24. Okt.', 'Oct 24'. */
function dayMonth(wall: Date, language?: string): string {
  const month = dateNames(language).monthsShort[wall.getUTCMonth()]!;
  const day = wall.getUTCDate();
  const style = dayStyle(language);
  return style === 'de' ? `${day}. ${month}` : style === 'us' ? `${month} ${day}` : `${day} ${month}`;
}

/** 'Sat 24 Oct', 'Sa 24. Okt.', 'Sat Oct 24'. */
function weekdayDayMonth(wall: Date, language?: string): string {
  return `${dateNames(language).daysShort[wall.getUTCDay()]!} ${dayMonth(wall, language)}`;
}

/** What the readings resolve to: the clock is shown when any reading has a time of day, seconds when any has them. */
export interface TimePrecision { clock: boolean; seconds: boolean }

export function timePrecision(instants: readonly number[], clock: ZoneClock): TimePrecision {
  let hasClock = false, seconds = false;
  for (const ms of instants) {
    const wall = ms + clock.offsetAt(ms);
    const inDay = ((wall % DAY) + DAY) % DAY;
    if (inDay !== 0) hasClock = true;
    if (inDay % MINUTE !== 0) { seconds = true; break; }
  }
  return { clock: hasClock, seconds };
}

function clockText(wall: Date, seconds: boolean): string {
  return `${pad2(wall.getUTCHours())}:${pad2(wall.getUTCMinutes())}${seconds ? `:${pad2(wall.getUTCSeconds())}` : ''}`;
}

/**
 * The full name of one reading, for the hover card, the records and the data
 * table: 'Sun 25 Oct 2026, 02:35', with the offset in a repeated hour.
 */
export function instantName(ms: number, clock: ZoneClock, precision: TimePrecision, language?: string): string {
  const wall = wallOf(ms, clock);
  const style = dayStyle(language);
  const day = `${weekdayDayMonth(wall, language)}${style === 'us' ? ',' : ''} ${wall.getUTCFullYear()}`;
  if (!precision.clock) return day;
  const time = clockText(wall, precision.seconds);
  return `${day}, ${time}${inRepeatedHour(ms, clock) ? ` ${offsetText(clock.offsetAt(ms))}` : ''}`;
}

export type TimeUnit = 'millisecond' | 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';
export interface TimeStep { unit: TimeUnit; n: number }

/** The finest automatic calendar ticks the readings support on the axis clock. */
export function timeReadingUnit(instants: readonly number[], clock: ZoneClock): 'day' | 'month' | 'year' | undefined {
  if (!instants.length) return undefined;
  let unit: 'day' | 'month' | 'year' = 'year';
  for (const ms of instants) {
    const wall = ms + clock.offsetAt(ms);
    if (wall % DAY !== 0) return undefined;
    const date = new Date(wall);
    if (date.getUTCDate() !== 1) unit = 'day';
    else if (unit === 'year' && date.getUTCMonth() !== 0) unit = 'month';
  }
  return unit;
}

/** The automatic ladder, finest first. */
const TIME_LADDER: readonly TimeStep[] = [
  ...[1, 2, 5, 10, 20, 50, 100, 200, 500].map((n) => ({ unit: 'millisecond' as const, n })),
  { unit: 'second', n: 1 }, { unit: 'second', n: 5 }, { unit: 'second', n: 15 }, { unit: 'second', n: 30 },
  { unit: 'minute', n: 1 }, { unit: 'minute', n: 5 }, { unit: 'minute', n: 15 }, { unit: 'minute', n: 30 },
  { unit: 'hour', n: 1 }, { unit: 'hour', n: 3 }, { unit: 'hour', n: 6 }, { unit: 'hour', n: 12 },
  { unit: 'day', n: 1 }, { unit: 'day', n: 2 }, { unit: 'week', n: 1 }, { unit: 'month', n: 1 }, { unit: 'month', n: 3 },
  { unit: 'year', n: 1 }, { unit: 'year', n: 2 }, { unit: 'year', n: 5 }, { unit: 'year', n: 10 },
  { unit: 'year', n: 20 }, { unit: 'year', n: 50 }, { unit: 'year', n: 100 },
];

/** An authored { unit, step } as a ladder step; a quarter is three months. */
export function authoredTimeStep(step: { unit: TimeUnit | 'quarter'; step?: number }): TimeStep {
  const n = step.step ?? 1;
  return step.unit === 'quarter' ? { unit: 'month', n: 3 * n } : { unit: step.unit, n };
}

const UNIT_MS: Partial<Record<TimeUnit, number>> = { millisecond: 1, second: 1000, minute: MINUTE, hour: HOUR };

/** The approximate length of a step, to bound the tick count before ticks are made. */
function stepLength(step: TimeStep): number {
  const unit = { millisecond: 1, second: 1000, minute: MINUTE, hour: HOUR, day: DAY, week: 7 * DAY, month: 30.44 * DAY, year: 365.25 * DAY }[step.unit];
  return unit * step.n;
}

/**
 * The ticks of one step inside [lo, hi], on the zone's wall clock: 6-hour
 * ticks at 00, 06, 12 and 18 local time, days at local midnight, weeks on the
 * week start, months on the 1st, years on 1 January. A wall time the zone
 * repeats ticks at both instants; one it skips has no tick.
 */
export function timeTicks(lo: number, hi: number, step: TimeStep, clock: ZoneClock, weekStartsOn: 0 | 1 = 1, limit = 400): number[] | undefined {
  if (!(hi >= lo) || (hi - lo) / stepLength(step) > limit) return undefined;
  const walls: number[] = [];
  const wallLo = lo + clock.offsetAt(lo) - DAY, wallHi = hi + clock.offsetAt(hi) + DAY;
  const subDay = UNIT_MS[step.unit];
  if (subDay !== undefined) {
    // Ticks count from each local midnight, so 6 h steps read 00, 06, 12, 18 every day.
    const size = subDay * step.n;
    if (QUARTER_HOUR % size === 0) {
      // Zone offsets are whole quarter hours, so a step that divides 15 minutes ticks at the same
      // instants on every clock; a millisecond range never walks the wall clock.
      const ticks: number[] = [];
      for (let at = Math.ceil(lo / size) * size; at <= hi; at += size) ticks.push(at);
      return ticks;
    }
    // Only the wall times of [lo, hi]: between the earlier offset at the start and the later one at the end.
    const offLo = clock.offsetAt(lo), offHi = clock.offsetAt(hi);
    const from = lo + Math.min(offLo, offHi) - size, to = hi + Math.max(offLo, offHi) + size;
    for (let day = Math.floor(from / DAY) * DAY; day <= to; day += DAY) {
      const end = Math.min(day + DAY, to + size);
      for (let at = day + Math.max(0, Math.floor((from - day) / size) * size); at < end; at += size) walls.push(at);
    }
  } else if (step.unit === 'day' || step.unit === 'week') {
    const days = step.unit === 'week' ? 7 * step.n : step.n;
    let day = Math.floor(wallLo / DAY) * DAY;
    if (step.unit === 'week') while (new Date(day).getUTCDay() !== weekStartsOn) day += DAY;
    else day = Math.floor(day / DAY / days) * days * DAY;
    for (; day <= wallHi; day += days * DAY) walls.push(day);
  } else {
    const months = step.unit === 'year' ? 12 * step.n : step.n;
    const start = new Date(wallLo);
    let index = start.getUTCFullYear() * 12 + start.getUTCMonth();
    index = Math.floor(index / months) * months;
    for (;; index += months) {
      const date = new Date(0);
      date.setUTCFullYear(Math.floor(index / 12), index % 12, 1);
      if (date.getTime() > wallHi) break;
      walls.push(date.getTime());
    }
  }
  const ticks: number[] = [];
  for (const wall of walls) {
    const instants = wallInstants(wall, clock);
    // A midnight the zone skips starts the day at the first instant after it.
    const at = instants.length === 0 && subDay === undefined ? [forwardInstant(wall, clock)] : instants;
    for (const instant of at) if (instant >= lo && instant <= hi) ticks.push(instant);
  }
  // A repeated hour gives its wall times twice, so the instants come out of order.
  ticks.sort((a, b) => a - b);
  return ticks.filter((t, i) => i === 0 || t !== ticks[i - 1]);
}

/** The text of one tick at its step: '06:00', '24 Oct', 'Oct', '2026'. */
export function timeTickText(ms: number, step: TimeStep, clock: ZoneClock, language?: string): string {
  const wall = wallOf(ms, clock);
  switch (step.unit) {
    case 'millisecond': return `${clockText(wall, true)}.${String(wall.getUTCMilliseconds()).padStart(3, '0')}`;
    case 'second': return clockText(wall, true);
    case 'minute':
    case 'hour': return `${clockText(wall, false)}${inRepeatedHour(ms, clock) ? ` ${offsetText(clock.offsetAt(ms))}` : ''}`;
    case 'day':
    case 'week': return dayMonth(wall, language);
    case 'month': return step.n % 3 === 0 && wall.getUTCMonth() % 3 === 0 ? `Q${wall.getUTCMonth() / 3 + 1}` : dateNames(language).monthsShort[wall.getUTCMonth()]!;
    default: return String(wall.getUTCFullYear());
  }
}

/**
 * The second row under the ticks: under clock times one day per label
 * ('Sat 24 Oct'), starting at its midnight or the axis start; under days,
 * weeks and months one year per label. None under years.
 */
export function timeContextRow(lo: number, hi: number, step: TimeStep, clock: ZoneClock, ticks: readonly number[], language?: string): { at: number; text: string }[] {
  if (step.unit === 'year') return [];
  const subDay = UNIT_MS[step.unit] !== undefined;
  const out: { at: number; text: string }[] = [];
  if (subDay) {
    const days = timeTicks(lo, hi, { unit: 'day', n: 1 }, clock) ?? [];
    if (days[0] !== lo) out.push({ at: lo, text: weekdayDayMonth(wallOf(lo, clock), language) });
    for (const day of days) out.push({ at: day, text: weekdayDayMonth(wallOf(day, clock), language) });
    return out;
  }
  let year: number | undefined;
  for (const tick of ticks) {
    const y = wallOf(tick, clock).getUTCFullYear();
    if (y !== year) out.push({ at: tick, text: String(y) });
    year = y;
  }
  return out;
}

/** The automatic candidates for a span, finest first, without the steps that would draw more than `maxTicks`. */
export function timeLadder(lo: number, hi: number, maxTicks: number, readingUnit?: 'day' | 'month' | 'year'): TimeStep[] {
  const floor = readingUnit ? stepLength({ unit: readingUnit, n: 1 }) : 0;
  return TIME_LADDER.filter((step) => stepLength(step) >= floor && (hi - lo) / stepLength(step) <= maxTicks * 1.5 + 1);
}

/** Slope units of a fit over a time span, in elapsed time: per second, minute, hour, day (24 h) or week (7 × 24 h). */
export function trendTimeUnit(span: number): { unit: 'second' | 'minute' | 'hour' | 'day' | 'week'; ms: number } {
  if (span < 3 * MINUTE) return { unit: 'second', ms: 1000 };
  if (span < 3 * HOUR) return { unit: 'minute', ms: MINUTE };
  if (span < 3 * DAY) return { unit: 'hour', ms: HOUR };
  if (span < 180 * DAY) return { unit: 'day', ms: DAY };
  return { unit: 'week', ms: 7 * DAY };
}

/**
 * Where the zone's offset changes inside [lo, hi]: each instant and the wall
 * clock just before it, for the note that says when the clocks changed.
 */
export function offsetChanges(lo: number, hi: number, clock: ZoneClock): { at: number; from: number; to: number }[] {
  const changes: { at: number; from: number; to: number }[] = [];
  if (clock.zone === 'UTC' || hi - lo > 200 * 365 * DAY) return changes;
  let previous = clock.offsetAt(lo);
  // Offsets change at most a few times a year; a 6-hour probe then a quarter-hour search finds each one.
  for (let probe = lo; probe <= hi; probe += 6 * HOUR) {
    const offset = clock.offsetAt(Math.min(probe, hi));
    if (offset === previous) continue;
    let a = Math.max(lo, probe - 6 * HOUR), b = Math.min(probe, hi);
    while (b - a > QUARTER_HOUR) {
      const mid = Math.floor((a + b) / 2 / QUARTER_HOUR) * QUARTER_HOUR;
      if (mid <= a) break;
      if (clock.offsetAt(mid) === previous) a = mid; else b = mid;
    }
    const at = Math.ceil(b / QUARTER_HOUR) * QUARTER_HOUR;
    changes.push({ at, from: previous, to: offset });
    previous = offset;
  }
  return changes;
}

/** 'Sun 25 Oct, 03:00': the wall time a change happened at, read on the clock before it. */
export function changeMoment(change: { at: number; from: number }, language?: string): string {
  const wall = new Date(change.at + change.from);
  return `${weekdayDayMonth(wall, language)}, ${clockText(wall, false)}`;
}

const PATTERN_TOKEN = /('[^']*')|yyyy|yy|MMMM|MMM|MM|M|dddd|ddd|dd|d|HH|H|hh|h|mm|ss|SSS|a/g;

/** An authored tick pattern ('HH:mm', 'd MMM', 'h a'): each token reads the instant's wall clock in the zone. */
export function formatTimePattern(ms: number, clock: ZoneClock, pattern: string, language?: string): string {
  const wall = wallOf(ms, clock);
  const names = dateNames(language);
  const hour = wall.getUTCHours();
  return pattern.replace(PATTERN_TOKEN, (token) => {
    if (token.startsWith("'")) return token.slice(1, -1);
    switch (token) {
      case 'yyyy': return String(wall.getUTCFullYear()).padStart(4, '0');
      case 'yy': return pad2(wall.getUTCFullYear() % 100);
      case 'MMMM': return names.months[wall.getUTCMonth()]!;
      case 'MMM': return names.monthsShort[wall.getUTCMonth()]!;
      case 'MM': return pad2(wall.getUTCMonth() + 1);
      case 'M': return String(wall.getUTCMonth() + 1);
      case 'dddd': return names.days[wall.getUTCDay()]!;
      case 'ddd': return names.daysShort[wall.getUTCDay()]!;
      case 'dd': return pad2(wall.getUTCDate());
      case 'd': return String(wall.getUTCDate());
      case 'HH': return pad2(hour);
      case 'H': return String(hour);
      case 'hh': return pad2(hour % 12 || 12);
      case 'h': return String(hour % 12 || 12);
      case 'mm': return pad2(wall.getUTCMinutes());
      case 'ss': return pad2(wall.getUTCSeconds());
      case 'SSS': return String(wall.getUTCMilliseconds()).padStart(3, '0');
      default: return hour < 12 ? 'AM' : 'PM';
    }
  });
}
