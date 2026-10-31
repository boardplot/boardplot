/**
 * The tick row of a continuous x axis: the scale's own ticks, not one label
 * per reading. The ladder takes the finest step whose labels fit; an authored
 * step or tick list thins by a whole stride where its labels would touch. Under
 * clock times a second row names the days, under dates the years; the axis
 * title closes the row at the right end.
 */

import { seriesRasterFormatter } from '../../formatSpec';
import { niceStep } from '../../scale';
import { disclosureNote } from '../../notes';
import { chartString } from '../../strings/line';
import {
  authoredTimeStep, formatTimePattern, offsetChanges, offsetText, timeContextRow, timeLadder, timeReadingUnit, timeTicks, timeTickText, type TimeStep,
} from '../../timeAxis';
import type { CategoryRowPlan } from '../../label/categoryRow';
import { PRIORITY, type LabelRequest } from '../../label/solver';
import type { FontSpec, TextMeasurer } from '../../text';
import type { LintWarning } from '../../types/scene';
import type { LineXModel } from './continuous';
import type { LineOptions } from './types';

/** Clear room between two neighbouring tick labels. */
const TICK_GAP = 12;
/** Room between the tick labels and the rows under them. */
const ROW_GAP = 2;
const DEFAULT_MAX_TICKS = 10;
const DAY = 86_400_000;

export interface XTickPlan {
  values: number[];
  labels: string[];
  widths: number[];
  keep: boolean[];
  /** The day or year row: each label starts at its x value. */
  context: { at: number; text: string; w: number }[];
  title: { text: string; w: number } | undefined;
  font: FontSpec;
  lineH: number;
  rowHeight: number;
  /** A row of its own for a running period's words, when the tick and day rows have no room for them. */
  partialRow?: true;
}

/** The rerun that gives a running period's words a row of their own under the time axis. */
export const X_PARTIAL_ROW = Symbol('boardplot.xPartialRow');

interface Row { values: number[]; labels: string[]; step?: TimeStep }

/** Multiples of `step` inside [lo, hi], free of float residue. */
function numberTicks(lo: number, hi: number, step: number): number[] {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  const out: number[] = [];
  for (let k = Math.ceil(lo / step - 1e-9); k <= Math.floor(hi / step + 1e-9) && out.length <= 1000; k++) {
    out.push(Number((k * step).toFixed(Math.min(20, decimals))));
  }
  return out;
}

/** The step an authored tick list implies, for the second row: hours under clock times, days under dates. */
function impliedStep(values: readonly number[], model: LineXModel): TimeStep {
  const clock = model.clock!;
  const wall = (ms: number) => new Date(ms + clock.offsetAt(ms));
  if (values.some((v) => (v + clock.offsetAt(v)) % DAY !== 0)) return { unit: 'hour', n: 1 };
  if (values.some((v) => wall(v).getUTCDate() !== 1)) return { unit: 'day', n: 1 };
  if (values.some((v) => wall(v).getUTCMonth() !== 0)) return { unit: 'month', n: 1 };
  return { unit: 'year', n: 1 };
}

function labelOf(model: LineXModel, value: number, step: TimeStep | undefined, numberFmt: ((v: number) => string) | undefined): string {
  if (model.clock) {
    return model.axis.format ? formatTimePattern(value, model.clock, model.axis.format, model.language) : timeTickText(value, step!, model.clock, model.language);
  }
  return numberFmt!(value);
}

/** Tick label rects fit when each pair keeps TICK_GAP, edge labels clamped inside [left, right]. */
function fits(xs: readonly number[], widths: readonly number[], keep: readonly boolean[], left: number, right: number): boolean {
  let previousEnd = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < xs.length; i++) {
    if (!keep[i]) continue;
    const w = widths[i]!;
    const x = Math.max(left, Math.min(xs[i]! - w / 2, right - w));
    if (x < previousEnd + TICK_GAP) return false;
    previousEnd = x + w;
  }
  return true;
}

/** Keep every k-th tick, the smallest k that fits; the first tick is always one of them. */
function thinned(xs: readonly number[], widths: readonly number[], left: number, right: number): { keep: boolean[]; stride: number } {
  for (let stride = 1; stride <= xs.length; stride++) {
    const keep = xs.map((_, i) => i % stride === 0);
    if (fits(xs, widths, keep, left, right)) return { keep, stride };
  }
  return { keep: xs.map((_, i) => i === 0), stride: xs.length };
}

export function planXTicks(input: {
  model: LineXModel; lo: number; hi: number;
  /** Pixel x of an x value on the provisional span. */
  xOf: (x: number) => number;
  left: number; right: number;
  font: FontSpec; measure: TextMeasurer; weekStartsOn?: 0 | 1;
  warnings: LintWarning[];
  partialRow?: boolean;
}): XTickPlan {
  const { model, lo, hi, measure, font } = input;
  const axis = model.axis;
  const width = (text: string) => measure(text, font).width;
  const lineH = font.size * (font.lineHeight ?? 1.2);
  const maxTicks = axis.maxTicks ?? DEFAULT_MAX_TICKS;
  const numberFmt = (values: readonly number[]) => (model.clock ? undefined : seriesRasterFormatter(axis.format, values, model.language).fmt);
  const build = (values: number[], step: TimeStep | undefined, authoredLabels?: (string | undefined)[]): Row => {
    const fmt = numberFmt(values);
    return { values, step, labels: values.map((v, i) => authoredLabels?.[i] ?? labelOf(model, v, step, fmt)) };
  };
  let row: Row | undefined;
  let authored = false;
  if (axis.ticks) {
    authored = true;
    const read = axis.ticks.map((tick, i) => {
      const value = typeof tick === 'object' ? tick.value : tick;
      return { x: model.read(value, `options.xAxis.ticks[${i}]`), label: typeof tick === 'object' ? tick.label : undefined };
    }).filter((tick) => tick.x >= lo && tick.x <= hi).sort((a, b) => a.x - b.x);
    const values = read.map((tick) => tick.x);
    row = build(values, model.clock && values.length ? impliedStep(values, model) : undefined, read.map((tick) => tick.label));
  } else if (axis.tickStep !== undefined) {
    authored = true;
    if (typeof axis.tickStep === 'number') row = build(numberTicks(lo, hi, axis.tickStep), undefined);
    else {
      const step = authoredTimeStep(axis.tickStep);
      row = build(timeTicks(lo, hi, step, model.clock!, input.weekStartsOn) ?? [], step);
    }
  } else if (model.clock) {
    for (const step of timeLadder(lo, hi, maxTicks, timeReadingUnit(model.xs, model.clock))) {
      const values = timeTicks(lo, hi, step, model.clock, input.weekStartsOn);
      if (!values || values.length > maxTicks || values.length === 0) continue;
      const candidate = build(values, step);
      const keep = values.map(() => true);
      row = candidate;
      if (fits(values.map(input.xOf), candidate.labels.map(width), keep, input.left, input.right)) break;
    }
  } else {
    const span = hi - lo || Math.abs(hi) || 1;
    for (let count = maxTicks; count >= 1; count--) {
      const values = numberTicks(lo, hi, niceStep(span / count));
      if (values.length > maxTicks || values.length === 0) continue;
      const candidate = build(values, undefined);
      row = candidate;
      if (fits(values.map(input.xOf), candidate.labels.map(width), values.map(() => true), input.left, input.right)) break;
    }
  }
  row ??= { values: [], labels: [] };
  const xs = row.values.map(input.xOf);
  const widths = row.labels.map(width);
  const { keep, stride } = thinned(xs, widths, input.left, input.right);
  if (stride > 1 && authored) {
    input.warnings.push({
      code: 'x-ticks-thinned', severity: 'info', field: ['options', 'xAxis', axis.ticks ? 'ticks' : 'tickStep'],
      message: `the authored x ticks do not fit side by side at this width, so every ${stride === 2 ? 'second' : `${stride}th`} tick prints its label`,
      suggest: 'give a coarser tickStep or fewer ticks, a shorter xAxis.format, or more width',
    });
  }
  const contextStep = row.step;
  const context = model.clock && contextStep
    ? timeContextRow(lo, hi, contextStep, model.clock, row.values.filter((_, i) => keep[i]), model.language).map((item) => ({ ...item, w: width(item.text) }))
    : [];
  const title = axis.title ? { text: axis.title, w: width(axis.title) } : undefined;
  const rowHeight = (row.values.length ? lineH : 0) + (context.length ? ROW_GAP + lineH : 0) + (input.partialRow ? ROW_GAP + lineH : 0) + (title ? ROW_GAP + lineH : 0);
  return { values: row.values, labels: row.labels, widths, keep, context, title, font, lineH, rowHeight, ...(input.partialRow ? { partialRow: true as const } : {}) };
}

/** Context labels start at their x; one that would run into the next yields, a partial first day before a full one. */
export function placedContext(plan: XTickPlan, xOf: (x: number) => number, left: number, right: number): { text: string; x: number; w: number }[] {
  const placed: { text: string; x: number; w: number }[] = [];
  for (const item of plan.context) {
    const x = Math.max(left, Math.min(xOf(item.at), right - item.w));
    const last = placed[placed.length - 1];
    if (last && last.x + last.w + TICK_GAP > x) {
      // The later label names a whole day or year; the earlier one only the stretch before it.
      placed[placed.length - 1] = { text: item.text, x, w: item.w };
      continue;
    }
    placed.push({ text: item.text, x, w: item.w });
  }
  return placed;
}

/** The tick label rect's left edge, clamped inside the row. */
export function tickLabelX(plan: XTickPlan, index: number, xOf: (x: number) => number, left: number, right: number): number {
  const w = plan.widths[index]!;
  return Math.max(left, Math.min(xOf(plan.values[index]!) - w / 2, right - w));
}

/** The category-row plan the rest of the line layout reads: font, height, no rotation. */
export function xTickRowPlan(plan: XTickPlan): CategoryRowPlan {
  return {
    dateNumeric: false,
    typeRole: 'secondary',
    font: plan.font,
    infos: plan.labels.map((label, i) => ({ lines: [label], w: plan.widths[i]!, h: plan.lineH, truncated: false })),
    keep: plan.keep,
    stride: 1,
    rotation: 0,
    maxLines: 1,
    rowHeight: plan.rowHeight,
    x: () => 0,
    anchor: () => 0,
    step: 'fit',
    warnings: [],
    cutNotes: [],
  };
}

/**
 * The tick row's label requests: each kept tick centred on its x, the day
 * or year row under it, the axis title at the right end below them. Scale
 * labels have no category owner; the readings keep theirs.
 */
export function placeXTickLabels(input: {
  show: boolean; plan: XTickPlan; xOf: (x: number) => number;
  /** The row's outer edges: the frame's plot, value axis included. */
  row: { x: number; w: number };
  /** The top of the row. */
  bottom: number;
  plotRight: number;
  /** The plot's left edge: a first tick label that pokes left of it may shift to start here when the value axis' bottom label holds its seat. */
  plotLeft: number;
  labelRequests: LabelRequest[];
  /**
   * A running period's words under its readings, where no value carries them: in the tick row, else the day or
   * year row. Readings whose words would overlap share one; `groups` returns the reading names of each label.
   */
  partial?: { at: readonly number[]; names: readonly string[]; text: string; w: number; groups?: string[][] };
}): boolean {
  if (!input.show) return false;
  const { plan, xOf } = input;
  const left = input.row.x, right = input.row.x + input.row.w;
  const request = (id: string, text: string, x: number, y: number, w: number): LabelRequest => ({
    id, kind: 'category', owner: {}, text, lines: [text], typeRole: 'secondary', font: plan.font, priority: PRIORITY.endpoint,
    candidates: [{ slot: 'below', rect: { x, y, w, h: plan.lineH }, penalty: 0 }],
  });
  let y = input.bottom;
  if (plan.values.length) {
    plan.values.forEach((_, i) => {
      if (!plan.keep[i]) return;
      const x = tickLabelX(plan, i, xOf, left, right), w = plan.widths[i]!;
      const req = request(`xtick:${i}`, plan.labels[i]!, x, y, w);
      if (x < input.plotLeft - 0.5) req.candidates.push({ slot: 'below', rect: { x: input.plotLeft, y, w, h: plan.lineH }, penalty: 1 });
      input.labelRequests.push(req);
    });
    y += plan.lineH + ROW_GAP;
  }
  if (plan.context.length) {
    placedContext(plan, xOf, left, right).forEach((item, k) => input.labelRequests.push(request(`xcontext:${k}`, item.text, item.x, y, item.w)));
    y += plan.lineH + ROW_GAP;
  }
  const partialTop = y;
  if (plan.partialRow) y += plan.lineH + ROW_GAP;
  if (plan.title) input.labelRequests.push(request('axis:x:title', plan.title.text, Math.max(left, input.plotRight - plan.title.w), y, plan.title.w));
  // The words yield to the scale: a tick or a day label keeps its seat.
  const partial = input.partial;
  if (partial) {
    // Readings closer than the words' width share one label, centred under them.
    const groups: { from: number; to: number; names: string[] }[] = [];
    partial.at.map((at, i) => ({ c: xOf(at), name: partial.names[i]! })).sort((a, b) => a.c - b.c).forEach(({ c, name }) => {
      const last = groups[groups.length - 1];
      if (last && c - last.to < partial.w + TICK_GAP) { last.to = c; last.names.push(name); } else groups.push({ from: c, to: c, names: [name] });
    });
    partial.groups = groups.map((group) => group.names);
    const rows = plan.partialRow ? [partialTop] : [input.bottom, ...(plan.values.length && plan.context.length ? [input.bottom + plan.lineH + ROW_GAP] : [])];
    groups.forEach((group, k) => {
      const x = Math.max(left, Math.min((group.from + group.to) / 2 - partial.w / 2, right - partial.w));
      input.labelRequests.push({ ...request(`xpartial:${k}`, partial.text, x, input.bottom, partial.w), priority: PRIORITY.endpoint - 1,
        candidates: rows.map((top, r) => ({ slot: 'below' as const, rect: { x, y: top, w: partial.w, h: plan.lineH }, penalty: r })) });
    });
  }
  return true;
}

/**
 * The zone a time axis reads its clock times in, once under the chart:
 * 'Time zone: Europe/Berlin', with the offsets where they change inside the
 * range, '(UTC+2, then UTC+1)'. A time axis of whole days names none.
 */
export function timeZoneNote(domain: { x?: { model: LineXModel; lo: number; hi: number } }, options: Pick<LineOptions, 'strings' | 'locale'>): string[] {
  const x = domain.x;
  const clock = x?.model.clock;
  if (!x || !clock || !x.model.precision?.clock) return [];
  const changes = offsetChanges(x.lo, x.hi, clock);
  const text = changes.length === 0
    ? chartString(options, 'timeZoneNote', { v1: clock.zone })
    : chartString(options, 'timeZoneChangeNote', { v1: clock.zone, v2: [changes[0]!.from, ...changes.map((c) => c.to)].map(offsetText).join(chartString(options, 'offsetThen')) });
  return [disclosureNote(text)];
}
