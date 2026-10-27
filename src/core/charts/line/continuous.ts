/**
 * The continuous x axis of a line (options.xAxis with data.x). The readings
 * become one internal category each, sorted by x, with the canonical x as id
 * and the full x text as label: hover cards, records, sampling and the data
 * table keep working on categories. The model then places them by value and
 * draws the scale's own ticks (plot.ts, xTicks.ts).
 */

import { seriesRasterFormatter } from '../../formatSpec';
import { NormalizeError } from '../../normalize/shared';
import type { LaneScale } from '../../eventLane';
import { formatTimePattern, instantName, resolveTimes, timeAnnotationAnchors, timePrecision, zoneClock, type TimePrecision, type ZoneClock } from '../../timeAxis';
import type { Cell } from '../../types/cell';
import type { Category, LineCategoryData, LineChartData, LineXValue } from '../../types/data';
import type { LineOptions, LineXAxis } from './types';

/** What the layout knows about a continuous axis. */
export interface LineXModel {
  axis: LineXAxis;
  type: 'time' | 'number';
  clock: ZoneClock | undefined;
  /** The x of each source category, in category order (ascending). */
  xs: number[];
  /** Readings with a time of day, or with seconds. */
  precision: TimePrecision | undefined;
  /** x of one authored value (a tick, a bound, an annotation anchor); refuses one it cannot read. */
  read(value: LineXValue, path: string): number;
  /** The record text of an x: the full time, or the number in the axis format. */
  name(x: number): string;
  language: string | undefined;
}

const lowered = new WeakMap<object, { key: string; data: LineCategoryData }>();
/** Marks a lowered document; a symbol key survives the spreads later preparation steps make. */
const LOWERED = Symbol('lineX');
/** The `data.partial` values that name no reading, for the domain's warning. */
const UNMATCHED_PARTIAL = Symbol('lineXUnmatchedPartial');

/** The `data.partial` values of a lowered document that name no reading. */
export function unmatchedPartial(data: LineChartData): readonly (string | number)[] {
  return (data as { [UNMATCHED_PARTIAL]?: (string | number)[] })[UNMATCHED_PARTIAL] ?? [];
}

/** The category id of an x: the ISO instant in UTC, or the number as text. */
export function xId(type: 'time' | 'number', x: number): string {
  return type === 'time' ? new Date(x).toISOString() : String(x === 0 ? 0 : x);
}

function readNumber(value: unknown, path: string): number {
  const x = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  if (!Number.isFinite(x)) throw new NormalizeError('x-invalid', path, `x value ${JSON.stringify(value)} is not a finite number`, "give plain numbers on xAxis.type 'number'");
  return x;
}

/** The axis model of a chart whose options carry xAxis, else undefined. */
export function lineXModel(options: Pick<LineOptions, 'xAxis' | 'locale'>, cats?: readonly Category[]): LineXModel | undefined {
  const axis = options.xAxis;
  if (!axis) return undefined;
  const type = axis.type;
  const clock = type === 'time' ? zoneClock(axis.zone) : undefined;
  const xs = cats ? cats.map((c) => (type === 'time' ? Date.parse(c.id) : Number(c.id))) : [];
  const language = options.locale?.language;
  const precision = clock ? timePrecision(xs, clock) : undefined;
  const numberName = type === 'number' ? seriesRasterFormatter(axis.format, xs, language).fmt : undefined;
  return {
    axis, type, clock, xs, precision, language,
    read: (value, path) => (clock ? resolveTimes([value], clock, () => path)[0]! : readNumber(value, path)),
    name: (x) => (clock ? instantName(x, clock, precision!, language) : numberName!(x)),
  };
}

/**
 * data.x and its series as the category document the engine reads: readings
 * sorted by x, each category `{ id: canonical x, label: full x text }`. A
 * document without x passes through.
 */
export function lowerLineX(data: LineChartData, options: Pick<LineOptions, 'xAxis' | 'locale'> | undefined): LineCategoryData {
  if (data.x === undefined) {
    if (options?.xAxis && !(LOWERED in data)) {
      throw new NormalizeError('x-axis-needs-x', 'options.xAxis', 'xAxis places readings by value, and the data gives categories, which are ordered names; a continuous axis reads its readings from data.x',
        'move the x values from data.categories to data.x, or drop xAxis for a category axis');
    }
    return data;
  }
  const axis = options?.xAxis;
  if (!axis) {
    throw new NormalizeError('x-needs-axis', 'data.x', 'data.x gives continuous x values, and nothing says whether they are times or numbers',
      "add options.xAxis: { type: 'time' } (with zone, such as 'Europe/Berlin') or { type: 'number' }", [{ op: 'add', path: '/options/xAxis', value: { type: 'time' } }]);
  }
  const key = JSON.stringify([axis.type, axis.zone ?? null, axis.format ?? null, options?.locale?.language ?? null]);
  const cached = lowered.get(data);
  if (cached?.key === key) return cached.data;
  const clock = axis.type === 'time' ? zoneClock(axis.zone) : undefined;
  const xs = clock ? resolveTimes(data.x, clock, (i) => `data.x[${i}]`) : data.x.map((value, i) => readNumber(value, `data.x[${i}]`));
  const order = xs.map((_, i) => i).sort((a, b) => xs[a]! - xs[b]! || a - b);
  for (let k = 1; k < order.length; k++) {
    if (xs[order[k]!] === xs[order[k - 1]!]) {
      const a = Math.min(order[k - 1]!, order[k]!), b = Math.max(order[k - 1]!, order[k]!);
      throw new NormalizeError('x-duplicate', `data.x[${b}]`, `data.x[${a}] and data.x[${b}] are the same x (${JSON.stringify(data.x[a])}, ${JSON.stringify(data.x[b])}); one x holds one reading per series`,
        'drop or merge the repeated reading upstream');
    }
  }
  data.series.forEach((series, si) => {
    const values = series.values as unknown[];
    if (!Array.isArray(values) || values.length !== xs.length) {
      throw new NormalizeError('x-values-length', `series[${series.id ?? si}].values`, `series '${series.id}' has ${Array.isArray(values) ? values.length : 0} values for ${xs.length} x values; on a continuous axis each series gives one value per x, in the order of data.x`,
        'give a value, or null for a missing reading, at every x');
    }
    values.forEach((value, vi) => {
      if (typeof value === 'object' && value !== null && 'categoryId' in value) {
        throw new NormalizeError('x-values-keyed', `series[${series.id}].values[${vi}]`, 'a keyed { categoryId, value } entry has no category to name on a continuous axis', 'give the values in the order of data.x, with null where a series has no reading');
      }
    });
  });
  const sortedXs = order.map((i) => xs[i]!);
  const model = lineXModel({ xAxis: axis, locale: options?.locale }, undefined)!;
  const precision = clock ? timePrecision(sortedXs, clock) : undefined;
  const numberName = clock ? undefined : seriesRasterFormatter(axis.format, sortedXs, options?.locale?.language).fmt;
  // A period the readings cover only in part: matched by value, so '2026-01-05' names the reading at 2026-01-05T00:00.
  const partial = new Set<number>(), unmatched: (string | number)[] = [];
  data.partial?.forEach((value, i) => {
    const x = model.read(value, `data.partial[${i}]`);
    if (sortedXs.includes(x)) partial.add(x);
    else unmatched.push(value);
  });
  const categories: Category[] = sortedXs.map((x) => ({
    id: xId(axis.type, x),
    label: clock ? instantName(x, clock, precision!, model.language) : numberName!(x),
    ...(partial.has(x) ? { partial: true } : {}),
  }));
  const result: LineCategoryData & { [LOWERED]: true; [UNMATCHED_PARTIAL]?: (string | number)[] } = {
    [LOWERED]: true,
    ...(unmatched.length ? { [UNMATCHED_PARTIAL]: unmatched } : {}),
    ...(data.valueKind ? { valueKind: data.valueKind } : {}),
    categories,
    series: data.series.map((series, si) => ({
      ...series,
      values: order.map((i) => (series.values as Cell[])[i]!),
      // A series target names the x of one of its readings.
      ...(series.targets ? { targets: series.targets.map((target, ti) => {
        const path = `series[${series.id ?? si}].targets[${ti}].at`;
        const x = model.read(target.at, path);
        if (!sortedXs.includes(x)) throw new NormalizeError('x-anchor-no-reading', path, `target at ${JSON.stringify(target.at)} names an x with no reading`, 'name the x of a reading exactly, as data.x gives it');
        return { ...target, at: xId(axis.type, x) };
      }) } : {}),
    })),
  };
  lowered.set(data, { key, data: result });
  return result;
}

/** The visible x range and the options with every x anchor resolved. */
export interface LineXResolved {
  options: LineOptions;
  lo: number;
  hi: number;
}

type Anchor = string | number | { categoryId?: string; [key: string]: unknown };

/**
 * The options a continuous axis reads: refusals for what it cannot draw, the
 * axis range (xAxis.min and max, a viewDomain of two x values), and each
 * annotation and target anchor named by its reading's id. Events and bands
 * may stand between readings: an event keeps its time as `date`, a band its
 * x values, and the layout places them by value.
 */
export function resolveLineXOptions(options: LineOptions, model: LineXModel, cats: readonly Category[], warnings: import('../../types/scene').LintWarning[]): LineXResolved {
  if (options.variant === 'bump') {
    throw new NormalizeError('x-axis-unsupported', 'options.xAxis', "variant 'bump' ranks the series at each category, and a continuous axis has readings at any x, not shared periods",
      "drop xAxis and give the periods as data.categories, or draw the values with variant 'line'");
  }
  if (options.categoryAxis !== undefined) {
    throw new NormalizeError('x-axis-conflict', 'options.categoryAxis', 'categoryAxis sets a category row, and xAxis replaces that row with a continuous scale',
      'drop categoryAxis; set ticks with xAxis.tickStep or xAxis.ticks', [{ op: 'remove', path: '/options/categoryAxis' }]);
  }
  const xs = model.xs;
  const ids = cats.map((c) => c.id);
  const idSet = new Set(ids);
  const byX = new Map(xs.map((x, i) => [x, ids[i]!] as const));
  const nearest = (x: number): string => {
    let k = 0;
    while (k < xs.length - 1 && xs[k + 1]! <= x) k++;
    return [...new Set([cats[k]!, cats[Math.min(xs.length - 1, k + 1)]!])].map((c) => `'${c.label ?? c.id}'`).join(' and ');
  };
  /** The id of the reading at an authored x, or undefined between readings. */
  const readingAt = (value: string | number, path: string): string | undefined => {
    if (typeof value === 'string' && idSet.has(value)) return value;
    return byX.get(model.read(value, path));
  };
  const exact = (value: string | number, path: string, what: string): string => {
    const id = readingAt(value, path);
    if (id !== undefined) return id;
    throw new NormalizeError('x-anchor-no-reading', path, `${what} names x ${JSON.stringify(value)}, where no series has a reading; the nearest readings are ${nearest(model.read(value, path))}`,
      'name the x of a reading exactly, as data.x gives it');
  };
  const anchor = (value: Anchor | undefined, path: string, what: string): Anchor | undefined => {
    if (value === undefined) return value;
    if (typeof value === 'string' || typeof value === 'number') return exact(value, path, what);
    if (typeof value === 'object' && value.categoryId !== undefined) return { ...value, categoryId: exact(value.categoryId, `${path}.categoryId`, what) };
    return value;
  };
  /** The x values of each band's ends: a band wholly outside the range is left out. */
  const bandEnds = new Map<object, number[]>();
  const authored = options.annotations?.flatMap((raw, index) => {
    const a = (model.clock ? timeAnnotationAnchors(raw) : raw) as unknown as Record<string, unknown> & { kind: string; id?: string };
    const path = (key: string) => `options.annotations[${index}].${key}`;
    const what = `annotation '${a.id ?? `${a.kind}-${index + 1}`}'`;
    switch (a.kind) {
      case 'cagr':
        // A time axis counts the years between the two readings; a number axis has no years.
        if (model.clock) return [{ ...a, ...(a.from === undefined ? {} : { from: anchor(a.from as Anchor, path('from'), what) }), ...(a.to === undefined ? {} : { to: anchor(a.to as Anchor, path('to'), what) }) }];
        warnings.push({ code: 'x-cagr-unsupported', severity: 'warn', field: ['options', 'annotations', index],
          message: `${what}: a CAGR is a rate per year, and a number axis has no years, so it is not drawn`,
          suggest: "use a 'diff' annotation between two readings for the change over the range" });
        return [];
      case 'diff': return [{ ...a, from: anchor(a.from as Anchor, path('from'), what), to: anchor(a.to as Anchor, path('to'), what) }];
      case 'delta': return [{ ...a, at: anchor(a.at as Anchor, path('at'), what), ...(typeof a.vs === 'number' ? {} : { vs: anchor(a.vs as Anchor, path('vs'), what) }) }];
      case 'abs': case 'note': case 'callout': return [{ ...a, at: anchor(a.at as Anchor, path('at'), what) }];
      case 'valueLine': return [{ ...a, ...(a.from === undefined ? {} : { from: exact(a.from as string, path('from'), what) }), ...(a.to === undefined ? {} : { to: exact(a.to as string, path('to'), what) }) }];
      case 'band': {
        // A band may start or end between readings; the layout reads its x values and clips them.
        if (a.from === undefined && a.to === undefined) return [a];
        const band = { ...a };
        bandEnds.set(band, (['from', 'to'] as const).flatMap((key) => (a[key] === undefined ? [] : [model.read(a[key] as string, path(key))])));
        return [band];
      }
      case 'event': {
        if (a.at === undefined) return [a];
        // Every event stands at its x, on a reading or between two, as a dated event does.
        const at = typeof a.at === 'object' ? (a.at as { categoryId: string | number }).categoryId : a.at as string | number;
        const { at: _at, to, ...rest } = a;
        return [{ ...rest, date: String(at), ...(to === undefined ? {} : { end: String(to) }) }];
      }
      default: return [a];
    }
  }) as LineOptions['annotations'];
  const targets = options.targets?.map((target, i) => ({ ...target, at: exact(target.at, `options.targets[${i}].at`, `target '${target.seriesId}'`) }));
  const rebase100 = typeof options.rebase100 === 'object' ? { ...options.rebase100, at: exact(options.rebase100.at, 'options.rebase100.at', 'rebase100') } : options.rebase100;
  const phases = options.phases?.map((phase, i) => ({ ...phase, from: exact(phase.from, `options.phases[${i}].from`, `phase '${phase.id}'`), to: exact(phase.to, `options.phases[${i}].to`, `phase '${phase.id}'`) }));
  // The range: a zoom (viewDomain) wins over the authored bounds, which default to the readings.
  const first = xs[0]!, last = xs[xs.length - 1]!;
  const view = options.viewDomain?.x;
  let lo = view ? model.read(view[0], 'options.viewDomain.x[0]') : options.xAxis?.min !== undefined ? model.read(options.xAxis.min, 'options.xAxis.min') : first;
  let hi = view ? model.read(view[1], 'options.viewDomain.x[1]') : options.xAxis?.max !== undefined ? model.read(options.xAxis.max, 'options.xAxis.max') : last;
  if (lo > hi) [lo, hi] = [hi, lo];
  const inside = xs.flatMap((x, i) => (x >= lo && x <= hi ? [i] : []));
  if (inside.length === 0) {
    throw new NormalizeError('x-range-empty', view ? 'options.viewDomain.x' : 'options.xAxis', `no reading lies inside the x range ${model.name(lo)} to ${model.name(hi)}; the readings run from ${cats[0]!.label} to ${cats[cats.length - 1]!.label}`,
      'widen the range, or drop xAxis.min and xAxis.max');
  }
  const annotations = authored?.filter((a) => {
    const ends = bandEnds.get(a);
    return !ends || !ends.every((x) => x < lo) && !ends.every((x) => x > hi);
  });
  const cut = inside.length < xs.length;
  if (cut && !view) {
    warnings.push({ code: 'x-range-cut', severity: 'info', field: ['options', 'xAxis'],
      message: `${xs.length - inside.length} of ${xs.length} readings lie outside xAxis.min and xAxis.max and are not drawn`,
      suggest: 'widen xAxis.min and xAxis.max to draw every reading' });
  }
  if (lo === hi) {
    // One reading: the axis spans a step around it, so the point sits in the middle.
    const pad = model.clock ? 3_600_000 : Math.abs(lo) / 10 || 1;
    lo -= pad; hi += pad;
  }
  const { viewDomain: _view, ...rest } = options;
  return {
    options: {
      ...rest,
      ...(cut ? { viewDomain: { x: [ids[inside[0]!]!, ids[inside[inside.length - 1]!]!] } } : {}),
      ...(annotations ? { annotations } : {}),
      ...(targets ? { targets } : {}),
      ...(rebase100 !== undefined ? { rebase100 } : {}),
      ...(phases ? { phases } : {}),
    },
    lo, hi,
  };
}

const DAY_ONLY = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/;

/** The event lane's reading of a continuous axis: dates and ends as x values, in the visible range. */
export function laneScale(x: { model: LineXModel; lo: number; hi: number }): LaneScale {
  const { model, lo, hi } = x;
  const clock = model.clock;
  return {
    lo, hi,
    read: (text, path, end) => {
      const day = end && clock ? DAY_ONLY.exec(text) : null;
      // An end that names a day ends with that day: at the next midnight.
      if (day) return model.read(new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]) + 1)).toISOString().slice(0, 10), path);
      return model.read(text, path);
    },
    short: (v) => (clock ? formatTimePattern(v, clock, formatTimePattern(v, clock, 'HH:mm') === '00:00' ? 'd MMM' : 'd MMM, HH:mm', model.language) : model.name(v)),
    full: (v) => model.name(v),
  };
}
