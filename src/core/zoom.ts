/**
 * Zoom on a time or number line (the React `zoom` prop): the visible range,
 * the grain a range asks for, and the spec that draws it. Pure: React holds
 * the range and the gesture, the layout stays in core.
 *
 * A line zooms when its x is a continuous axis (data.x with options.xAxis) or
 * when every category carries an ISO date. Without an aggregation the zoom
 * changes only the range. With one (`aggregate`), a range too wide for one
 * point per 6 px draws coarser buckets: zone-aligned [start, end) periods of
 * the source readings, never averages of averages, an empty bucket missing.
 */

import { formatDate } from './dateFormat';
import { localeStrings } from './strings';
import { parseISODate } from './isoDate';
import { NormalizeError } from './normalize/shared';
import { resolveTimes, timeTicks, zoneClock, type TimeStep, type ZoneClock } from './timeAxis';

export type ZoomAggregate = 'sum' | 'mean' | 'last' | 'min' | 'max';
export type ZoomGrainUnit = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';
export interface ZoomGrain { unit: ZoomGrainUnit; step: number }
export type ZoomReason = 'wheel' | 'keyboard' | 'pan' | 'reset';

/** What `onZoom` receives after a reader zooms or pans. */
export interface ZoomChange {
  /** The visible range: UTC ISO instants on a time axis, ISO dates on a date category axis, numbers on a number axis. */
  range: [string, string] | [number, number];
  /** The grain the range asks for, which can be finer than the data (send finer data); null on a number axis. */
  grain: ZoomGrain | null;
  /** The grain the chart draws; null draws the readings as given. */
  drawn: ZoomGrain | null;
  /** The IANA zone of the buckets and labels. */
  zone: string;
  reason: ZoomReason;
}

/** The chart's zoom settings (the React `zoom` prop without its callbacks). */
export interface ZoomSettings {
  /** How readings combine into a coarser bucket: one rule, or one per series id. Without it the zoom changes only the range. */
  aggregate?: ZoomAggregate | Record<string, ZoomAggregate>;
  /** The grains it may draw, finest first; default minute to year. */
  grains?: ZoomGrainUnit[];
}

const GRAIN_MS: Record<ZoomGrainUnit, number> = {
  minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000, month: 2_629_746_000, quarter: 7_889_238_000, year: 31_556_952_000,
};
const GRAINS: ZoomGrainUnit[] = ['minute', 'hour', 'day', 'week', 'month', 'quarter', 'year'];
/** At most one drawn point per this many px. */
const POINT_PX = 6;

/** The x the zoom reads off a line spec. */
export interface ZoomAxis {
  kind: 'time' | 'date' | 'number';
  zone: string;
  clock: ZoneClock;
  /** The readings' x, ascending: epoch ms, or numbers. */
  xs: number[];
  /** The x of each reading in data order. */
  source: number[];
  /** The whole range: the authored bounds, else the readings. */
  extent: [number, number];
  /** The range the chart opens at: the authored `viewDomain.x`, else the extent. */
  start: [number, number];
  /** The median distance between readings. */
  native: number;
  /** The series ids, which an aggregation must each name a rule for. */
  series: string[];
  /** Every cell is a plain number or null, so buckets can combine them. */
  combinable: boolean;
}

export interface ZoomSpec {
  type: string;
  data: { categories?: { id: string; date?: string; label?: string }[]; x?: (string | number)[]; series: { id: string; values: unknown[]; [key: string]: unknown }[]; [key: string]: unknown };
  options?: Record<string, unknown>;
}

interface XAxisLike { type: 'time' | 'number'; zone?: string; min?: string | number; max?: string | number }

/** The zoom axis of a line spec, or undefined when its x is neither continuous nor dated. */
export function zoomAxis(spec: ZoomSpec): ZoomAxis | undefined {
  if (spec.type !== 'line' || spec.options?.variant === 'bump') return undefined;
  const xAxis = spec.options?.xAxis as XAxisLike | undefined;
  let kind: ZoomAxis['kind'];
  let clock = zoneClock('UTC');
  let xs: number[];
  try {
    if (xAxis && spec.data.x) {
      kind = xAxis.type;
      if (kind === 'time') clock = zoneClock(xAxis.zone);
      xs = kind === 'time' ? resolveTimes(spec.data.x, clock, (i) => `data.x[${i}]`) : spec.data.x.map(Number);
    } else {
      const dates = spec.data.categories?.map((c) => (c.date ? parseISODate(c.date) : null));
      if (!dates?.length || dates.some((d) => d === null)) return undefined;
      kind = 'date';
      xs = dates.map((d) => d!.getTime());
    }
  } catch (error) {
    // The layout refuses the same input with its own message.
    if (error instanceof NormalizeError) return undefined;
    throw error;
  }
  if (xs.length < 2 || xs.some((x) => !Number.isFinite(x))) return undefined;
  const source = xs;
  xs = [...xs].sort((a, b) => a - b);
  const bound = (value: string | number | undefined, fallback: number) =>
    value === undefined ? fallback : kind === 'time' ? resolveTimes([value], clock, () => 'options.xAxis')[0]! : kind === 'number' ? Number(value) : fallback;
  let extent: [number, number] = [xs[0]!, xs[xs.length - 1]!];
  try {
    extent = [bound(xAxis?.min, extent[0]), bound(xAxis?.max, extent[1])];
  } catch { /* an unreadable bound: the layout refuses it */ }
  const gaps = xs.slice(1).map((x, i) => x - xs[i]!).filter((d) => d > 0).sort((a, b) => a - b);
  const native = gaps[Math.floor(gaps.length / 2)] ?? (extent[1] - extent[0] || 1);
  const combinable = spec.data.series.every((s) => s.values.every((v) => plain(v) !== undefined));
  const axis: ZoomAxis = { kind, zone: clock.zone, clock, xs, source, extent, start: extent, native, series: spec.data.series.map((s) => s.id), combinable };
  // A chart that opens on part of its readings zooms from that view; a date axis names it by category ids.
  const view = (spec.options?.viewDomain as { x?: [string | number, string | number] } | undefined)?.x;
  if (Array.isArray(view) && view.length === 2) {
    const dateOf = new Map((spec.data.categories ?? []).map((c) => [c.id, c.date]));
    try {
      axis.start = readZoomRange(axis, [view[0], view[1]].map((v) => (kind === 'date' ? dateOf.get(String(v)) ?? v : v)) as [string | number, string | number]);
    } catch { /* an unreadable view: the layout refuses it */ }
  }
  return axis;
}

/** The range as numbers, from a controlled `zoom.range`. */
export function readZoomRange(axis: ZoomAxis, range: readonly [string | number, string | number]): [number, number] {
  const read = (value: string | number) => (axis.kind === 'number' ? Number(value)
    : axis.kind === 'date' && typeof value === 'string' && parseISODate(value) ? parseISODate(value)!.getTime()
      : resolveTimes([value], axis.clock, () => 'zoom.range')[0]!);
  const [a, b] = [read(range[0]), read(range[1])];
  return inExtent(axis, [Math.min(a, b), Math.max(a, b)]);
}

/** The smallest span: about three readings, or five minutes when the host can send finer data. */
function minSpan(axis: ZoomAxis, finer: boolean): number {
  const readings = 3 * axis.native;
  return finer && axis.kind === 'time' ? Math.min(readings, 5 * 60_000) : readings;
}

/** A range inside the extent. */
function inExtent(axis: ZoomAxis, [lo, hi]: [number, number]): [number, number] {
  const [min, max] = axis.extent;
  const span = Math.min(hi - lo, max - min);
  lo = Math.min(Math.max(lo, min), max - span);
  return [lo, lo + span];
}

/**
 * The range a view draws: the asked range, widened to the two readings
 * nearest its centre when it holds fewer. The asked range stays what
 * `onZoom` reports, so a host can answer a range finer than the data.
 */
export function drawableRange(axis: ZoomAxis, range: [number, number]): [number, number] {
  const [lo, hi] = inExtent(axis, range);
  const xs = axis.xs;
  let inside = 0;
  for (const x of xs) if (x >= lo && x <= hi && ++inside >= 2) return [lo, hi];
  // Too few readings: widen to the two readings nearest the centre.
  const centre = (lo + hi) / 2;
  let k = 0;
  while (k < xs.length - 2 && xs[k + 1]! <= centre) k++;
  return [Math.min(lo, xs[k]!), Math.max(hi, xs[k + 1]!)];
}

/**
 * Zoom by `factor` (under 1 zooms in) around the point at `at`, the share of
 * the plot width left of the pointer or the focused record.
 */
export function zoomBy(axis: ZoomAxis, range: [number, number], factor: number, at: number, finer = false): [number, number] {
  // A pointer over an unmeasured box (zero width) gives no share: zoom around the centre.
  const share = Number.isFinite(at) ? Math.min(1, Math.max(0, at)) : 0.5;
  const span = range[1] - range[0];
  const next = Math.min(axis.extent[1] - axis.extent[0], Math.max(minSpan(axis, finer), span * factor));
  const anchor = range[0] + share * span;
  const asked = inExtent(axis, [anchor - share * next, anchor - share * next + next]);
  const out = finer ? asked : drawableRange(axis, asked);
  // Zooming in never widens: a range already at the smallest span (an authored narrow view) stays.
  return factor < 1 && out[1] - out[0] >= span ? range : out;
}

/** Pan by half the visible range, left (-1) or right (1). */
export function panBy(axis: ZoomAxis, range: [number, number], direction: -1 | 1): [number, number] {
  const shift = ((range[1] - range[0]) / 2) * direction;
  return inExtent(axis, [range[0] + shift, range[1] + shift]);
}

/** The grain a range asks for at a plot width: the finest that keeps one point per 6 px. */
export function wantedGrain(axis: ZoomAxis, range: [number, number], plotWidth: number, settings: ZoomSettings = {}): ZoomGrain | null {
  if (axis.kind === 'number') return null;
  const units = GRAINS.filter((unit) => !settings.grains || settings.grains.includes(unit));
  const budget = Math.max(2, Math.floor(plotWidth / POINT_PX));
  const span = range[1] - range[0];
  const unit = units.find((u) => span / GRAIN_MS[u] <= budget) ?? units[units.length - 1];
  return unit ? { unit, step: 1 } : null;
}

/** The grain the chart draws: the wanted grain when it is coarser than the readings and an aggregation is set, else none. */
export function drawnGrain(axis: ZoomAxis, wanted: ZoomGrain | null, settings: ZoomSettings): ZoomGrain | null {
  const rules = settings.aggregate;
  // A series without a rule is not combined: the zoom then changes only the range.
  if (!wanted || !rules || !axis.combinable || (typeof rules === 'object' && axis.series.some((id) => !rules[id]))) return null;
  return GRAIN_MS[wanted.unit] > axis.native * 1.5 ? wanted : null;
}

const step = (grain: ZoomGrain): TimeStep => (grain.unit === 'quarter' ? { unit: 'month', n: 3 * grain.step } : { unit: grain.unit, n: grain.step });

/** A plain number, null for a missing reading, or undefined for a cell the zoom cannot combine (a scenario, a status). */
function plain(cell: unknown): number | null | undefined {
  if (cell === null || typeof cell === 'number') return cell;
  if (typeof cell === 'object' && Object.keys(cell).length === 1 && typeof (cell as { number?: unknown }).number === 'number') return (cell as { number: number }).number;
  return undefined;
}

function combine(values: (number | null)[], rule: ZoomAggregate): number | null {
  // A sum with a missing reading is not the bucket's sum.
  if (values.length === 0 || (rule === 'sum' && values.includes(null))) return null;
  const known = values.filter((v): v is number => v !== null);
  if (known.length === 0) return null;
  switch (rule) {
    case 'sum': return known.reduce((a, b) => a + b, 0);
    case 'mean': return known.reduce((a, b) => a + b, 0) / known.length;
    case 'last': return known[known.length - 1]!;
    case 'min': return known.reduce((a, b) => Math.min(a, b));
    case 'max': return known.reduce((a, b) => Math.max(a, b));
  }
}

function bucketLabel(start: number, grain: ZoomGrain, language?: string): string {
  const date = new Date(start);
  switch (grain.unit) {
    case 'year': return formatDate(date, 'yyyy', language);
    case 'quarter': return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${date.getUTCFullYear()}`;
    case 'month': return formatDate(date, 'MMM yy', language);
    default: return formatDate(date, 'd MMM', language);
  }
}

const BUCKET_WORDS = {
  en: {
    grain: { minute: 'Per-minute', hour: 'Hourly', day: 'Daily', week: 'Weekly', month: 'Monthly', quarter: 'Quarterly', year: 'Yearly' },
    rule: { sum: 'sums', mean: 'means', last: 'last values', min: 'minimums', max: 'maximums' },
    covers: 'Covers', to: 'to', of: 'of', days: 'days', hours: 'hours', minutes: 'min',
  },
  de: {
    grain: { minute: 'Minütliche', hour: 'Stündliche', day: 'Tägliche', week: 'Wöchentliche', month: 'Monatliche', quarter: 'Vierteljährliche', year: 'Jährliche' },
    rule: { sum: 'Summen', mean: 'Mittelwerte', last: 'letzte Werte', min: 'Minima', max: 'Maxima' },
    covers: 'Umfasst', to: 'bis', of: 'von', days: 'Tagen', hours: 'Std.', minutes: 'Min.',
  },
} as const;

/**
 * The rules whose bucket over fewer days reads as a drop or a rise: a sum
 * counts fewer readings, a minimum and a maximum pick from fewer. A mean and a
 * last value stay on the scale of a full bucket, so their edge bucket is not marked.
 */
const COVERAGE_RULES: ReadonlySet<ZoomAggregate> = new Set(['sum', 'min', 'max']);

/** The detail key that names a part-covered bucket's readings on its hover card. */
const COVERS_KEY = 'covers';

/** The wall-clock parts of an instant in a zone, as a UTC date for the date formatter. */
function wallDate(instant: number, zone: string): Date {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
    .formatToParts(new Date(instant)).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
  return new Date(Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!));
}

/**
 * What a part-covered bucket's readings cover: whole days as "3 Jan 2024 to
 * 7 Jan 2024 (5 of 7 days)", else clock times with hours or minutes, such as
 * "2 Oct 00:00 to 2 Oct 12:00 (12 of 24 hours)".
 */
function coverText(from: number, to: number, start: number, end: number, grain: ZoomGrain, zone: string, language?: string): string {
  const words = language?.toLowerCase().startsWith('de') ? BUCKET_WORDS.de : BUCKET_WORDS.en;
  const midnight = (instant: number) => { const wall = wallDate(instant, zone); return wall.getUTCHours() === 0 && wall.getUTCMinutes() === 0; };
  const daily = GRAIN_MS[grain.unit] >= GRAIN_MS.day && midnight(from) && midnight(to);
  const unit = daily ? GRAIN_MS.day : GRAIN_MS[grain.unit] >= GRAIN_MS.day || (to - from) % 3_600_000 === 0 ? 3_600_000 : 60_000;
  const name = (instant: number) => {
    const wall = wallDate(instant, zone);
    if (daily) return formatDate(wall, 'd MMM yyyy', language);
    const clock = `${String(wall.getUTCHours()).padStart(2, '0')}:${String(wall.getUTCMinutes()).padStart(2, '0')}`;
    return GRAIN_MS[grain.unit] >= GRAIN_MS.day ? `${formatDate(wall, 'd MMM', language)} ${clock}` : clock;
  };
  // A part of an hour counts in tenths ("12.5 of 24 hours"), so the count is never rounded up.
  const count = new Intl.NumberFormat(language ?? 'en', { maximumFractionDigits: 1 }).format(Math.floor(((to - from) / unit) * 10) / 10);
  const whole = Math.round((end - start) / unit);
  // Whole days name the last covered day; clock times name the end.
  const last = daily ? to - unit : to;
  const span = name(from) === name(last) ? name(from) : `${name(from)} ${words.to} ${name(last)}`;
  return `${span} (${count} ${words.of} ${whole} ${daily ? words.days : unit === 3_600_000 ? words.hours : words.minutes})`;
}

/** The note a bucketed view prints, so a monthly sum never reads as a reading: "Monthly sums", "Monthly: Orders sums, Visits means". */
function bucketNote(grain: ZoomGrain, rules: { label: string; rule: ZoomAggregate }[], language?: string): string {
  const words = language?.toLowerCase().startsWith('de') ? BUCKET_WORDS.de : BUCKET_WORDS.en;
  const kinds = new Set(rules.map((r) => r.rule));
  return kinds.size === 1
    ? `${words.grain[grain.unit]} ${words.rule[rules[0]!.rule]}`
    : `${words.grain[grain.unit]}: ${rules.map((r) => `${r.label} ${words.rule[r.rule]}`).join(', ')}`;
}

/** The kinds a coarser view keeps: they stand at a time, not on a reading. */
const FREE_KINDS = new Set(['event', 'band']);

/**
 * The spec that draws a range at a grain: the source spec with the range as
 * its view, or with the readings combined into buckets. Anchors that name a
 * reading (targets, value lines, callouts, phases) draw only at the source
 * grain; a bucketed view keeps events and, on a continuous axis, bands.
 */
export function zoomSpec(spec: ZoomSpec, axis: ZoomAxis, range: [number, number], drawn: ZoomGrain | null, settings: ZoomSettings, language?: string, inheritedStrings?: Record<string, unknown>): ZoomSpec {
  if (!drawn && range[0] === axis.start[0] && range[1] === axis.start[1]) return spec;
  range = drawableRange(axis, range);
  const whole = range[0] <= axis.extent[0] && range[1] >= axis.extent[1];
  if (!drawn) {
    if (!whole) return { ...spec, options: { ...spec.options, viewDomain: { x: viewOf(spec, axis, range) } } };
    const { viewDomain: _view, ...options } = spec.options ?? {};
    return spec.options?.viewDomain === undefined ? spec : { ...spec, options };
  }
  const rows = spec.data.series.map((s) => s.values.map(plain));
  const rules = settings.aggregate;
  if (!rules || rows.some((row) => row.some((v) => v === undefined)) || (typeof rules === 'object' && spec.data.series.some((s) => !rules[s.id]))) {
    return zoomSpec(spec, axis, range, null, settings);
  }
  // The buckets around the range, one more on each side so the line runs to the edge.
  const pad = GRAIN_MS[drawn.unit] * drawn.step * 2.2;
  const starts = timeTicks(Math.max(axis.extent[0], range[0]) - pad, Math.min(axis.extent[1], range[1]) + pad, step(drawn), axis.clock, 1, 2000);
  if (!starts || starts.length < 2) return zoomSpec(spec, axis, range, null, settings);
  const order = axis.source.map((_, i) => i).sort((a, c) => axis.source[a]! - axis.source[c]! || a - c);
  const members: number[][] = starts.slice(0, -1).map(() => []);
  let b = 0;
  for (const i of order) {
    const x = axis.source[i]!;
    while (b < members.length && x >= starts[b + 1]!) b++;
    if (b >= members.length) break;
    if (x >= starts[b]!) members[b]!.push(i);
  }
  const keep = members.flatMap((m, k) => (m.length || (starts[k]! <= range[1] && starts[k + 1]! > range[0]) ? [k] : []));
  const ruleOf = (id: string): ZoomAggregate => (typeof rules === 'string' ? rules : rules[id]!);
  // An edge bucket the readings cover only in part: under a sum, a minimum or a maximum it reads as a drop or a rise.
  const marks = spec.data.series.some((s) => COVERAGE_RULES.has(ruleOf(s.id)));
  const firstReading = axis.xs[0]!, lastReading = axis.xs[axis.xs.length - 1]!;
  const covers = new Map<number, string>();
  if (marks) {
    for (const k of keep) {
      const start = starts[k]!, end = starts[k + 1]!;
      const from = Math.max(start, firstReading), to = Math.min(end, lastReading + axis.native);
      if (members[k]!.length && (from > start || to < end)) covers.set(k, coverText(from, to, start, end, drawn, axis.zone, language));
    }
  }
  const series = spec.data.series.map((s, si) => {
    const { targets: _targets, ...rest } = s;
    return { ...rest, values: keep.map((k) => {
      const value = combine(members[k]!.map((i) => rows[si]![i]!), ruleOf(s.id));
      const text = covers.get(k);
      return text === undefined || value === null ? value : { number: value, details: { [COVERS_KEY]: text } };
    }) };
  });
  const options: Record<string, unknown> = { ...spec.options };
  for (const key of ['targets', 'phases', 'viewDomain']) delete options[key];
  // Buckets start before the authored bounds; the view below sets the range.
  if (options.xAxis) {
    const { min: _min, max: _max, ...xAxis } = options.xAxis as Record<string, unknown>;
    options.xAxis = xAxis;
  }
  if (options.footnotes !== false) {
    const rules = spec.data.series.map((s) => ({ label: String(s.label ?? s.id), rule: ruleOf(s.id) }));
    options.footnotes = [...(options.footnotes as string[] | undefined) ?? [], bucketNote(drawn, rules, language)];
  }
  if (typeof options.rebase100 === 'object') delete options.rebase100;
  if (covers.size) {
    const words = language?.toLowerCase().startsWith('de') ? BUCKET_WORDS.de : BUCKET_WORDS.en;
    const fields = (options.detailFields as { key: string }[] | undefined) ?? [];
    if (!fields.some((f) => f.key === COVERS_KEY)) options.detailFields = [...fields, { key: COVERS_KEY, label: words.covers }];
    // A part-covered bucket is partial, not running: its note says "partial", not "to date".
    // The host's strings (a BoardplotTheme provider) count as authored: their toDate wins.
    const strings = options.strings as Record<string, unknown> | undefined;
    const authored = { ...inheritedStrings, ...strings };
    if (authored.toDate === undefined) options.strings = { ...strings, toDate: String(authored.partial ?? localeStrings(language).partial).toLowerCase() };
  }
  const continuous = axis.kind === 'time' && spec.data.x !== undefined;
  // The buckets replace the categories, so an event at a category stands on that category's date.
  const dateOf = new Map((spec.data.categories ?? []).flatMap((c) => (c.date ? [[c.id, c.date] as const] : [])));
  const onDate = (a: Record<string, unknown>) => {
    const id = typeof a.at === 'object' ? (a.at as { categoryId?: string } | null)?.categoryId : a.at as string | undefined;
    const date = id === undefined ? undefined : dateOf.get(id);
    const end = a.to === undefined ? undefined : dateOf.get(a.to as string);
    if (date === undefined || (a.to !== undefined && end === undefined)) return a;
    const { at: _at, to: _to, ...rest } = a;
    return { ...rest, date, ...(end === undefined ? {} : { end }) };
  };
  const annotations = (spec.options?.annotations as { kind: string }[] | undefined)?.filter((a) => a.kind === 'event' || (continuous && FREE_KINDS.has(a.kind)))
    .map((a) => (continuous || a.kind !== 'event' ? a : onDate(a as Record<string, unknown>)));
  if (annotations) options.annotations = annotations;
  if (continuous) {
    const x = keep.map((k) => new Date(starts[k]!).toISOString());
    const first = keep.findIndex((k) => starts[k + 1]! > range[0]);
    const last = keep.length - 1 - [...keep].reverse().findIndex((k) => starts[k]! <= range[1]);
    const view = first > 0 || last < keep.length - 1 ? { viewDomain: { x: [x[Math.max(0, first)]!, x[last]!] } } : {};
    const partial = keep.flatMap((k, j) => (covers.has(k) ? [x[j]!] : []));
    const { partial: _authored, ...source } = spec.data;
    return { ...spec, data: { ...source, x, series, ...(partial.length ? { partial } : {}) }, options: { ...options, ...view } };
  }
  const categories = keep.map((k) => {
    const date = new Date(starts[k]!).toISOString().slice(0, 10);
    return { id: date, date, label: bucketLabel(starts[k]!, drawn, language), ...(covers.has(k) ? { partial: true } : {}) };
  });
  const inView = categories.filter((_, j) => starts[keep[j]!]! <= range[1] && starts[keep[j]! + 1]! > range[0]);
  const view = inView.length && inView.length < categories.length ? { viewDomain: { x: [inView[0]!.id, inView[inView.length - 1]!.id] } } : {};
  return { ...spec, data: { ...spec.data, categories, series }, options: { ...options, ...view } };
}

/** A range as the line's viewDomain: x values on a continuous axis, the first and last category inside it on a date axis. */
function viewOf(spec: ZoomSpec, axis: ZoomAxis, [lo, hi]: [number, number]): [string, string] | [number, number] {
  if (axis.kind === 'number') return [lo, hi];
  if (axis.kind === 'time') return [new Date(lo).toISOString(), new Date(hi).toISOString()];
  const cats = spec.data.categories!;
  const inside = cats.filter((c) => { const t = parseISODate(c.date!)!.getTime(); return t >= lo && t <= hi; });
  return [inside[0]!.id, inside[inside.length - 1]!.id];
}

/** The change `onZoom` receives. */
export function zoomChange(axis: ZoomAxis, range: [number, number], wanted: ZoomGrain | null, drawn: ZoomGrain | null, reason: ZoomReason): ZoomChange {
  const text = (x: number) => (axis.kind === 'date' ? new Date(x).toISOString().slice(0, 10) : new Date(x).toISOString());
  return {
    range: axis.kind === 'number' ? [range[0], range[1]] : [text(range[0]), text(range[1])],
    grain: wanted, drawn, zone: axis.zone, reason,
  };
}
