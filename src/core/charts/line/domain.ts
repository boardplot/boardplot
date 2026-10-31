/**
 * Line phase 1: options and data in, the series, the plotted matrix
 * and every preset that rewrites it (stacked100-area shares, bump ranks, fan bounds,
 * phases, rebase100, the view window), the stacks and the value domain out.
 * Nothing here knows a pixel.
 */

import { compositionBasis, mixedSignsWarning, overfullShareSum, overfullWarning } from '../band/stacks';
import { cellFields, normalizeCategorySeries } from '../categorySeries';
import { breakUnsupported, chartPalette, chartTheme } from '../chartEnv';
import { defaultMeasurer } from '../../text';
import { formatAuthoredPercent, formatShare } from '../../format';
import { formatStatWithSpec, seriesRasterFormatter } from '../../formatSpec';
import { anomalyCorridor, anomalyModel, refuseAnomalySpec } from '../column/anomaly';
import { isIncomplete, warnIncompleteComposition, warnShareRoundingDrift } from '../../dataGaps';
import { round2 } from '../../geometry';
import { roundWholes, shareRoundingNotes } from '../../shareRounding';
import { parseISODate } from '../../isoDate';
import { fitLineTrends, trendTimeline } from './trend';
import { lineXModel, resolveLineXOptions, unmatchedPartial, type LineXModel } from './continuous';
import {
  NormalizeError,
  normalizeScenario,
  resolveHighlight,
  resolveSize,
} from '../../normalize/shared';
import { applyAxisBounds, axisGrid, niceDomain } from '../../scale';
import { type Id } from '../../types/cell';
import type { Category, LineChartData } from '../../types/data';
import type { LintWarning } from '../../types/scene';
import { applyCategoryViewport, liveWindowOptions } from '../../viewport';
import { deriveBumpRanks, prepareBump } from './bump';
import type { NormSer, NormTarget } from './context';
import { resolveGapFillSeries } from './difference';
import { resolveFan, type FanResolved } from './fan';
import { lineLabelModes, type LineLabelModes } from './labelModes';
import { projectLineViewport } from './live';
import { rangeCut, rangeRuns, type LineRange } from './range';
import type { LinePhaseResolved } from './marks';
import type { BumpDerived } from './layout';
import type { LineAnomaly, LineDomain, LineEnv, LineVariant } from './model';
import type { LineInterpolation, LineOptionTarget, LineOptions } from './types';
import { maxOf, minOf, pushAll } from '../../arrays';
import { emptyIdRecord } from '../../idRecords';
import { checkPointBudget } from '../../itemBudget';

/**
 * The nice domain already caps wasted domain on either side at 15%. If the plotted data
 * uses less than that same share, an authored value line has reduced the data
 * to less space than the scale normally allows for one side's padding.
 */
const DOMAIN_ECONOMY_FRACTION = 0.15;

/** The category rebase100 indexes every series to: the first unless `at` names one. */
function rebaseAtId(rebase100: LineOptions['rebase100'], cats: Category[]): Id {
  return typeof rebase100 === 'object' ? rebase100.at : cats[0]!.id;
}

/** Resolve the options once: theme, palette, size, measurer, highlights. */
export function resolveLineEnv(options: LineOptions, warnings: LintWarning[]): LineEnv {
  const isBump = options.variant === 'bump';
  breakUnsupported('line', options, warnings);
  const theme = chartTheme(options);
  const paletteRamp = chartPalette(theme, options.palette, warnings);
  const highlights = new Set(resolveHighlight(options.highlight));
  return {
    isBump,
    theme,
    paletteRamp,
    size: resolveSize(options.size),
    measure: options.measure ?? defaultMeasurer,
    pctFmt: (p: number) => formatShare(p, options.locale?.language),
    authoredPctFmt: (p: number) => formatAuthoredPercent(p, options.locale?.language),
    highlights,
    anyHighlight: highlights.size > 0,
    density: options.labelDensity ?? 'smart',
  };
}

/**
 * A null breaks the line by default: a bridge would draw a line
 * through a figure the author withheld.
 */
function normalizeLineData(data: LineChartData): { cats: Category[]; seriesNorm: NormSer[] } {
  const { cats, series } = normalizeCategorySeries('line', data, (s, cells): NormSer => ({
    id: s.id,
    label: s.label ?? s.id,
    shortLabel: s.shortLabel,
    role: s.role ?? 'data',
    scenario: normalizeScenario(s.scenario as string | undefined, `series[${s.id}].scenario`),
    colorRole: s.colorRole,
    fill: s.fill,
    lineStyle: s.lineStyle,
    marker: s.marker,
    smooth: s.smooth,
    interpolateGaps: s.interpolateGaps ?? false,
    targets: s.targets ?? [],
    format: s.format,
    unit: s.unit,
    vals: cells.map((cell, ci) => cellFields(cell, `series[${s.id}].values[${ci}]`)),
  }));
  return { cats, seriesNorm: series };
}

/** A year label: "2022", "2030F", "FY2024", "2025E". */
const YEAR_LABEL = /^(?:FY\s?)?(\d{4})\s?[A-Z]{0,2}$/;

/**
 * Time runs on a proportional axis. When every category carries an
 * ISO date, or every label is a year, and the longest gap is more than half
 * again the shortest, each category sits at its time distance from the first,
 * counted in shortest gaps. Otherwise undefined: even gaps, or categories that
 * are not time, keep even spacing.
 */
function categoryTimeline(cats: Category[]): { positions: number[]; span: number } | undefined {
  const dated = cats.every((c) => c.date !== undefined);
  const times = cats.map((c) => {
    if (dated) return parseISODate(c.date!)?.getTime() ?? null;
    const year = YEAR_LABEL.exec((c.label ?? c.id).trim());
    return year ? Number(year[1]) : null;
  });
  if (times.length < 3 || times.some((t) => t === null)) return undefined;
  const gaps = times.slice(1).map((t, i) => t! - times[i]!);
  if (gaps.some((gap) => gap <= 0)) return undefined;
  const unit = minOf(gaps);
  if (maxOf(gaps) / unit <= 1.5) return undefined;
  const positions = times.map((t) => (t! - times[0]!) / unit);
  return { positions, span: positions[positions.length - 1]! + 1 };
}

/** Above this many categories, and four per pixel of width, a plain line or area samples its points (lineWindow). */
const AUTO_DECIMATE_MIN = 2000;

/**
 * The window the viewport applies. An authored window wins; `decimate: 'none'`
 * keeps every point. A plain line or area with no window, no zoom and evenly spaced
 * periods, longer than AUTO_DECIMATE_MIN and four categories per pixel of
 * width, keeps each series' min and max in two buckets per pixel: 100,000 days
 * took 2.2 s to draw a line no screen shows at that grain. The subtitle says
 * "Showing N of M periods · min-max sampled", and the warning says what the
 * reader loses. Every series keeps the same periods, so a stacked area stacks
 * real values; 150,000 stacked days drew a 13 MB SVG in 24 s, and 300,000
 * ran the process out of memory.
 */
function lineWindow(options: LineOptions, cats: Category[], variant: LineVariant, isBump: boolean, fan: boolean, width: number, warnings: LintWarning[], continuous = false): { window?: LineOptions['window']; anchors?: string[]; auto?: true } {
  const authored = options.window;
  if (authored?.decimate === 'none') return authored.last === undefined ? {} : { window: { last: authored.last } };
  if (authored || options.viewDomain || isBump || fan) return { window: authored };
  const budget = Math.max(AUTO_DECIMATE_MIN, 4 * Math.round(width));
  // A continuous axis samples by x value (live/window), so uneven readings sample too.
  if (cats.length <= budget || (!continuous && (categoryTimeline(cats) || !datesIncrease(cats)))) return {};
  const maxPoints = 2 * Math.round(width);
  warnings.push({
    code: 'line-decimated',
    severity: 'info',
    message: `${cats.length} categories exceed the point budget (${budget}): the ${variant === 'line' ? 'line' : 'area'} keeps each series' minimum and maximum in ${maxPoints / 2} buckets, so dropped periods have no point, hover value or label, and a segment may join periods that are not neighbours`,
    suggest: "set window: { decimate: 'none' } to draw every point, or aggregate the periods (weeks, months)",
  });
  return { window: { decimate: 'minmax', maxPoints }, ...(continuous ? {} : { anchors: calendarStarts(cats, maxPoints) }), auto: true };
}

/**
 * The value positions of a continuous axis: each drawn reading at its x,
 * from 0 at the range start to 1 at its end, on a span of 2 so that the
 * edge-to-edge placement (crossesBetween false) maps 0 and 1 to the plot ends.
 */
function valueTimeline(model: LineXModel, range: { lo: number; hi: number }, population: { indexes: number[] } | undefined, cats: Category[]): { positions: number[]; span: number } {
  const width = range.hi - range.lo;
  const xs = population ? population.indexes.map((i) => model.xs[i]!) : cats.map((_, i) => model.xs[i]!);
  return { positions: xs.map((x) => (x - range.lo) / width), span: 2 };
}

/** Authored dates strictly increase: a sample over any other order would be refused (live/window.ts). */
function datesIncrease(cats: Category[]): boolean {
  let previous: string | undefined;
  for (const { date } of cats) {
    if (date === undefined) continue;
    if (previous !== undefined && date <= previous) return false;
    previous = date;
  }
  return true;
}

/**
 * The first category of each month, else of each year, where there are at
 * most `limit` of them: the sample keeps them, so the date row ticks and names
 * real period starts at an even step.
 */
function calendarStarts(cats: Category[], limit: number): string[] | undefined {
  const isoOf = (c: Category) => c.date ?? (/^\d{4}-\d{2}/.test(c.id) ? c.id : undefined);
  if (!cats.every((c) => isoOf(c) !== undefined)) return undefined;
  for (const length of [7, 4]) {
    const starts: string[] = [];
    let previous: string | undefined;
    for (const c of cats) {
      const key = isoOf(c)!.slice(0, length);
      if (key !== previous) starts.push(c.id);
      previous = key;
    }
    if (starts.length <= limit) return starts;
  }
  return undefined;
}

/** Series targets, then chart targets; a target naming an unknown series or category is refused out loud. */
function collectTargets(seriesNorm: NormSer[], cats: Category[], options: LineOptions, warnings: LintWarning[]): NormTarget[] {
  const categoryIds = new Set(cats.map((category) => category.id));
  const seriesIds = new Set(seriesNorm.map((series) => series.id));
  const targets: NormTarget[] = [];
  let targetSeq = 0;
  const addTarget = (target: LineOptionTarget): void => {
    const id = `target:${target.seriesId}:${target.at}:${targetSeq++}`;
    const owner = { seriesId: target.seriesId, categoryId: target.at };
    if (!seriesIds.has(target.seriesId)) {
      warnings.push({ code: 'target-unknown-series', severity: 'error', message: `target '${id}' names unknown series '${target.seriesId}'`, owner });
      return;
    }
    if (!categoryIds.has(target.at)) {
      warnings.push({ code: 'target-unknown-category', severity: 'error', message: `target '${id}' names unknown category '${target.at}'`, owner });
      return;
    }
    if (!Number.isFinite(target.value)) {
      warnings.push({ code: 'target-invalid-value', severity: 'error', message: `target '${id}' requires a finite value`, owner });
      return;
    }
    targets.push({ ...target, id });
  };
  seriesNorm.forEach((series) => {
    series.targets.forEach((target) => addTarget({ ...target, seriesId: series.id }));
  });
  (options.targets ?? []).forEach(addTarget);
  return targets;
}

/** The variant (valueAxis.percent ⇒ 100% area) and the interpolation each series gets. */
function lineVariant(options: LineOptions, isBump: boolean, seriesNorm: NormSer[], warnings: LintWarning[]) {
  let variant: LineVariant = isBump ? 'line' : (options.variant as LineVariant | undefined) ?? 'line';
  const va = options.valueAxis ?? {};
  if (va.percent) {
    // `variant` holds ONE value, so 'bump' + 'area' is unreachable by
    // construction — but `valueAxis.percent` PROMOTES to stacked100-area behind the
    // author's back, and a 100% composition of ranks is nonsense. Fail closed.
    if (isBump) {
      throw new NormalizeError(
        'bump-variant-conflict',
        'valueAxis.percent',
        "variant 'bump' plots derived ranks; valueAxis.percent promotes the chart to a 100% area composition, which ranks cannot form — drop one of the two",
      );
    }
    // An author who wanted percent-formatted lines gets shares of a stacked whole without a word.
    if (variant !== 'stacked100-area') {
      warnings.push({
        code: 'percent-axis-stacks-area',
        severity: 'warn',
        message: `valueAxis.percent draws a 100% stacked area: each series becomes its share of the category sum, not its own value (variant '${variant}' ignored)`,
        suggest: "For percent-formatted lines, remove valueAxis.percent and set data.valueKind: 'fraction' for fraction values, or a percent format such as '0%' for values already in percent. For a 100% composition, set variant: 'stacked100-area'.",
      });
    }
    variant = 'stacked100-area';
  }
  const isStacked = variant === 'stacked-area' || variant === 'stacked100-area';
  const chartInterpolation = options.interpolate ?? 'linear';
  const requestedInterpolationFor = (series: NormSer): LineInterpolation =>
    series.smooth === true ? 'monotone' : series.smooth === false ? 'linear' : chartInterpolation;
  const interpolationFor = (series: NormSer): LineInterpolation => {
    const requested = requestedInterpolationFor(series);
    if (isBump && requested === 'monotone') return 'linear';
    if (isStacked && (requested === 'step-after' || requested === 'step-before')) return 'linear';
    return requested;
  };
  if (isStacked && seriesNorm.some((series) => {
    const requested = requestedInterpolationFor(series);
    return requested === 'step-after' || requested === 'step-before';
  })) {
    warnings.push({
      code: 'step-composition-unsupported',
      severity: 'warn',
      message: `${variant} does not support stepped interpolation — affected series rendered linearly`,
    });
  }
  if (isBump && seriesNorm.some((series) => requestedInterpolationFor(series) === 'monotone')) {
    warnings.push({
      code: 'bump-smooth-unsupported',
      severity: 'warn',
      message:
        "variant 'bump' plots discrete derived ranks; monotone smoothing would imply fractional standings between periods — affected series rendered linearly",
      suggest: "Drop smooth: true and interpolate: 'monotone' on a bump chart.",
    });
  }
  return { variant, isArea: variant !== 'line', isStacked, interpolationFor };
}

/**
 * The stacked100-area basis. A 100% composition requires nonnegative components.
 * Signed categories fail closed as n.m.; an all-zero/nonpositive basis fails
 * closed as n/a.
 */
function percentBasis(cats: Category[], dataSeries: NormSer[], variant: LineVariant, warnings: LintWarning[]) {
  const nmCats100 = new Set<Id>();
  const naCats100 = new Set<Id>();
  const basisByCat: number[] = cats.map((c, ci) => {
    if (variant !== 'stacked100-area') return 1;
    const { basis, nm, na, direct: hasDirectShare } = compositionBasis(dataSeries.map((s) => s.vals[ci]!), c.total100);
    if (nm) {
      nmCats100.add(c.id);
      return 0;
    }
    if (!(basis <= 0)) return basis;
    if (na) naCats100.add(c.id);
    // A category of direct shares only has no absolute part to set to 0.
    else if (dataSeries.every((s) => s.vals[ci]!.isPct || !s.vals[ci]!.v)) return 0;
    warnings.push({
      code: 'percent-basis-nonpositive',
      severity: 'warn',
      message: hasDirectShare
        ? `category '${c.id}': non-positive 100% basis — percents set to 0`
        : `category '${c.id}': non-positive 100% basis — nothing to compose, category marked n/a`,
      owner: { categoryId: c.id },
    });
    return 0;
  });
  if (nmCats100.size > 0) {
    warnings.push(mixedSignsWarning([...nmCats100], cats.length, { tail: '', suggest: "use stacked columns (type 'column', variant 'stacked') or a waterfall for signed contributions" }));
  }
  // A category past 100% is no composition either: it draws as n.m., as a signed one does.
  const overfull = variant !== 'stacked100-area' ? [] : cats.flatMap((c, ci) => {
    if (nmCats100.has(c.id) || naCats100.has(c.id)) return [];
    const sum = overfullShareSum(dataSeries.map((s) => s.vals[ci]!), basisByCat[ci]!);
    return sum === undefined ? [] : [{ id: c.id, sum }];
  });
  for (const row of overfull) nmCats100.add(row.id);
  if (overfull.length > 0) warnings.push(overfullWarning(overfull, nmCats100.size + naCats100.size === cats.length, "give every part as a share of the same whole, or use variant 'line' for shares that overlap, such as answers to a multi-select question"));
  return { nmCats100, overfullCats100: new Set(overfull.map((row) => row.id)), naCats100, basisByCat };
}

/**
 * A stacked area has one baseline: a negative component in a category with
 * positive ones folds its band back over the band beneath, and the bands cross.
 */
function stackedAreaSignWarnings(cats: Category[], dataSeries: NormSer[], variant: LineVariant): LintWarning[] {
  if (variant !== 'stacked-area') return [];
  const mixed = cats.filter((_, ci) => {
    const values = dataSeries.flatMap((s) => (s.vals[ci]!.v === null ? [] : [s.vals[ci]!.v!]));
    return values.some((v) => v > 0) && values.some((v) => v < 0);
  });
  return mixed.length === 0 ? [] : [{
    code: 'stacked-area-mixed-signs',
    severity: 'warn',
    message: `stacked areas share one baseline, so a negative component folds its band over the band beneath; mixed signs in: ${mixed.map((c) => c.id).join(', ')}`,
    suggest: "use stacked columns (type 'column', variant 'stacked'), which stack negatives below zero",
  }];
}

/** Phases paint one continuous curve, so every condition that breaks one is refused out loud. */
function validatePhases(
  options: LineOptions,
  input: { isBump: boolean; isArea: boolean; variant: LineVariant; fan: FanResolved | null; drawnSeries: NormSer[]; cats: Category[]; pv: (number | null)[][]; rowOf: Map<NormSer, number> },
  interpolationFor: (s: NormSer) => LineInterpolation,
  warnings: LintWarning[],
): LinePhaseResolved | null {
  if (!options.phases) return null;
  const { cats, drawnSeries } = input;
  const reject = (message: string, suggest?: string): null => {
    warnings.push({
      code: 'phases-invalid',
      severity: 'error',
      message: `${message}, so the chart with phases is refused`,
      ...(suggest ? { suggest } : {}),
    });
    return null;
  };
  if (input.isBump) return reject("variant 'bump' plots ranks rather than a continuous data curve", "drop phases or variant 'bump'");
  // On variant 'area' the phase fills are the area: each phase fills its stretch under the curve in its own tone.
  if (input.variant === 'stacked-area' || input.variant === 'stacked100-area') {
    return reject(
      `variant '${input.variant}' stacks bands of several series, and phases partition the area under one curve`,
      "use variant 'area' or 'line' with one series; phases fill the area under it",
    );
  }
  if (input.fan && input.fan.origin !== null) return reject('fan and phases are two wash systems with competing meanings', 'split them into two exhibits');
  if (options.gapFill) return reject('gapFill and phases are two wash systems with competing meanings', 'split them into two exhibits');
  if (options.rebase100) return reject('rebase100 can suppress a series after phase validation', 'rebase the data before authoring phases');
  if (drawnSeries.length !== 1) {
    return reject(
      `phases require exactly one visible data series; ${drawnSeries.length} would be visible`,
      'keep one data-role series or remove phases',
    );
  }
  if (cats.length < 2) return reject('phases require at least two categories so the covered span has width');
  const series = drawnSeries[0]!;
  const interpolation = interpolationFor(series);
  if (interpolation !== 'linear' && interpolation !== 'monotone') {
    return reject(`'${interpolation}' has a discontinuous phase-boundary value`, "use interpolate:'linear' or interpolate:'monotone'");
  }
  if (input.pv[input.rowOf.get(series)!]!.some((value) => value === null)) {
    return reject(
      `series '${series.id}' contains a null, so there is no single continuous curve to partition`,
      'supply every category value or remove phases',
    );
  }
  const resolved = options.phases.map((phase) => ({
    phase,
    from: cats.findIndex((category) => category.id === phase.from),
    to: cats.findIndex((category) => category.id === phase.to),
  }));
  const issue =
    resolved.find(({ from, to }) => from < 0 || to < 0)?.phase.id ??
    resolved.find(({ from, to }) => from > to)?.phase.id;
  if (issue) return reject(`phase '${issue}' has an unknown or reversed from/to category range`, 'use ordered category ids from this chart');
  if (resolved[0]!.from !== 0 || resolved[resolved.length - 1]!.to !== cats.length - 1) {
    return reject('phases do not cover the full first-to-last category span');
  }
  const discontinuity = resolved.findIndex((phase, index) => index > 0 && phase.from !== resolved[index - 1]!.to + 1);
  if (discontinuity !== -1) {
    return reject(
      `phases '${resolved[discontinuity - 1]!.phase.id}' and '${resolved[discontinuity]!.phase.id}' overlap or leave a category gap`,
      'make each next phase start at the category immediately after the previous phase ends',
    );
  }
  return { phases: options.phases, series, interpolation };
}

/** rebase100: index every series to 100 at categories[0] / at.{Id}. Returns whether it applied. */
function applyRebase(options: LineOptions, variant: LineVariant, cats: Category[], seriesNorm: NormSer[], pv: (number | null)[][], rowOf: Map<NormSer, number>, warnings: LintWarning[], suppressed: LineDomain['rebaseSuppressed']): boolean {
  if (!options.rebase100) return false;
  if (variant === 'stacked100-area') {
    warnings.push({ code: 'rebase-ignored', severity: 'warn', message: 'rebase100 is ignored for stacked100-area (values are already percent-normalized)' });
    return false;
  }
  const atId = rebaseAtId(options.rebase100, cats);
  const baseIdx = cats.findIndex((c) => c.id === atId);
  if (baseIdx === -1) {
    warnings.push({ code: 'rebase-unknown-category', severity: 'warn', message: `rebase100.at '${atId}' is not a category id — rebase skipped` });
    return false;
  }
  for (const s of seriesNorm) {
    const row = pv[rowOf.get(s)!]!;
    const base = row[baseIdx] ?? null;
    // An index to 100 has no meaning on a base at or below zero: it would flip the series.
    if (base === null || base <= 0) {
      suppressed.push({ id: s.id, series: s.label, period: cats[baseIdx]!.label ?? atId, zero: base !== null });
      warnings.push({
        code: 'rebase-base-invalid',
        severity: 'warn',
        message: `series '${s.id}': value at '${atId}' is ${base === null ? 'missing' : base === 0 ? 'zero' : 'negative'} — series suppressed by rebase100`,
        owner: { seriesId: s.id },
      });
      for (let ci = 0; ci < row.length; ci++) row[ci] = null;
    } else {
      for (let ci = 0; ci < row.length; ci++) {
        const v = row[ci]!;
        row[ci] = v === null ? null : round2((v / base) * 100);
      }
    }
  }
  warnings.push({
    code: 'rebased',
    severity: 'info',
    message: `series rebased to 100 at '${atId}' — indexed (${baseIdx === 0 ? 'first period' : atId} = 100)`,
  });
  return true;
}

type Core = Pick<LineDomain, 'options' | 'cats' | 'seriesNorm' | 'dataSeries' | 'targets' | 'variant' | 'isArea' | 'isStacked' | 'pv' | 'rowOf' | 'bumpDerived'>;

/**
 * The value domain. Targets and fixed value lines state the same range intent
 * as the data, so both enter the extent passed to niceDomain; scale changes do
 * not alter acceptance.
 */
function valueDomain(d: Core & { cumTop: number[][]; cumBot: number[][] }, isBump: boolean, warnings: LintWarning[], edges: number[] = []) {
  const { options, cats, variant, pv, rowOf } = d;
  const va = options.valueAxis ?? {};
  let lo = Infinity;
  let hi = -Infinity;
  if (d.isStacked) {
    d.dataSeries.forEach((_, di) => {
      cats.forEach((__, ci) => {
        lo = Math.min(lo, d.cumBot[di]![ci]!, d.cumTop[di]![ci]!);
        hi = Math.max(hi, d.cumBot[di]![ci]!, d.cumTop[di]![ci]!);
      });
    });
  } else {
    for (const s of d.seriesNorm) {
      for (const v of pv[rowOf.get(s)!]!) {
        if (v === null) continue;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
  }
  for (const value of edges) { lo = Math.min(lo, value); hi = Math.max(hi, value); }
  const plottedDataLo = lo;
  const plottedDataHi = hi;
  for (const target of d.targets) {
    lo = Math.min(lo, target.value);
    hi = Math.max(hi, target.value);
  }
  const domainExtendingValueLines: { id: Id; value: number }[] = [];
  // Authored numeric value lines are part of the picture's stated range. The
  // scale must contain them before annotation geometry is calculated. Scoped
  // seriesId/from/to lines are derived later and deliberately stay clipped by
  // the data domain.
  for (const [annotationIndex, annotation] of (options.annotations ?? []).entries()) {
    if (annotation.kind !== 'valueLine' || annotation.axis === 'secondary' || typeof annotation.value !== 'number' ||
      !Number.isFinite(annotation.value) || annotation.seriesId !== undefined || annotation.from !== undefined || annotation.to !== undefined) {
      continue;
    }
    const annotationId = annotation.id ?? `valueLine-${annotationIndex + 1}`;
    if (variant === 'stacked100-area' && (annotation.value < 0 || annotation.value > 100)) {
      throw new NormalizeError(
        'value-line-composition-domain',
        `annotations[${annotationIndex}]`,
        `valueLine '${annotationId}' at ${annotation.value} is outside the fixed 0..100 composition axis`,
        'keep the value line between 0 and 100; a reference line cannot rescale a 100% composition',
      );
    }
    if (annotation.value < lo || annotation.value > hi) domainExtendingValueLines.push({ id: annotationId, value: annotation.value });
    lo = Math.min(lo, annotation.value);
    hi = Math.max(hi, annotation.value);
  }
  // A named reference band is part of the stated range too: the axis reaches every one.
  for (const [bandIndex, band] of (options.referenceBands ?? []).entries()) {
    // A 100% composition keeps its fixed 0..100 scale, as a value line does.
    const field = variant === 'stacked100-area'
      ? (['value', 'low', 'high'] as const).find((key) => band[key] !== undefined && (band[key]! < 0 || band[key]! > 100))
      : undefined;
    if (field !== undefined) {
      const level = band[field]!;
      throw new NormalizeError(
        'reference-band-composition-domain',
        `options.referenceBands[${bandIndex}].${field}`,
        `reference band '${band.label ?? band.id ?? bandIndex + 1}' at ${level} is outside the fixed 0..100 composition axis`,
        'keep the band between 0 and 100; a reference band cannot rescale a 100% composition',
        [{ op: 'remove', path: `/options/referenceBands/${bandIndex}` }],
        ['options', 'referenceBands', bandIndex, field],
      );
    }
    lo = Math.min(lo, band.value ?? band.low ?? lo);
    hi = Math.max(hi, band.value ?? band.high ?? hi);
  }
  if (!Number.isFinite(lo)) {
    lo = 0;
    hi = 1;
  }
  const dataLo = lo;
  const dataHi = hi;
  let dLo: number;
  let dHi: number;
  if (variant === 'stacked100-area') {
    dLo = Math.min(0, lo);
    dHi = Math.max(100, hi);
  } else if (d.isArea || va.includeZero) {
    // area variants force includeZero; the bound covers this zero-anchored
    // branch too, as well as the profile branch below
    const lo2 = Math.min(0, lo);
    const hi2 = Math.max(0, hi > 0 ? hi * 1.06 : hi);
    [dLo, dHi] = niceDomain(lo2, lo2 === hi2 ? hi2 + 1 : hi2, 5, { dataExtent: [lo2, Math.max(0, hi)], maxWasteFraction: DOMAIN_ECONOMY_FRACTION });
  } else {
    // plain lines: zero NOT forced — profile view
    const span = hi - lo || Math.abs(hi) || 1;
    [dLo, dHi] = niceDomain(lo - span * 0.08, hi + span * 0.08, 5, {
      dataExtent: [dataLo, dataHi],
      preserveDataSideOfZero: true,
      // Two-sided domain: the summed waste of both sides is bounded too, so the data fills at least 80% of the axis.
      maxWasteFraction: DOMAIN_ECONOMY_FRACTION,
      maxTotalWasteFraction: 0.2,
    });
  }
  let stepTicks: number[] | undefined;
  // A drawn value axis ends on its ticks: the plot's top edge is its top
  // gridline, and a label over the top point needs no headroom inside the
  // domain. Authored bounds and an authored tick step keep their own rules.
  const zeroBased = d.isArea || va.includeZero;
  const grid = va.show === true && !isBump && !d.bumpDerived && variant !== 'stacked100-area' &&
    va.min === undefined && va.max === undefined && va.tickStep === undefined
    ? axisGrid(zeroBased ? Math.min(0, lo) : lo, zeroBased ? Math.max(0, hi) : hi)
    : undefined;
  if (grid) {
    [dLo, dHi] = grid.domain;
    stepTicks = grid.ticks;
  }
  const plottedDataSpan = plottedDataHi - plottedDataLo;
  const plottedDataFraction = plottedDataSpan / (dHi - dLo);
  if (!isBump && variant !== 'stacked100-area' && plottedDataSpan > 0 && Number.isFinite(plottedDataFraction) && plottedDataFraction < DOMAIN_ECONOMY_FRACTION) {
    for (const annotation of domainExtendingValueLines) {
      warnings.push({
        code: 'value-line-data-span-collapsed',
        severity: 'warn',
        message:
          `valueLine '${annotation.id}' at ${annotation.value} leaves the plotted data span at ` +
          `${(plottedDataFraction * 100).toFixed(1)}% of the plot, below the ${(DOMAIN_ECONOMY_FRACTION * 100).toFixed(0)}% readability floor`,
        suggest: 'use a nearer reference value or move the distant reference to a separate exhibit',
      });
    }
  }
  [dLo, dHi] = applyAxisBounds([dLo, dHi], [lo, hi], va, isBump ? [] : warnings);
  // Bump replaces the whole value domain: the half-step padding keeps the
  // rank-1 and rank-maxRank markers and labels off the plot edges, and
  // overriding here (after va.min/va.max) is what makes those two options
  // genuinely ignored, as `bump-axis-option-ignored` says they are. EXCEPT in
  // a y scale GROUP: `grid` shares a y scale by injecting the union of the
  // panel domains back as `valueAxis.min/max`, and overriding unconditionally
  // made `scaleGroup: { y }` a silent no-op on bump panels (ladders 1..2 and
  // 1..5 side by side, a rank-2 line level with a rank-5 one). Under a
  // declared y group the injected bounds are HONOURED as the shared ladder.
  // an authored tick step sets the tick rhythm (a cohort grid at 20 %
  // steps). The data extent snaps OUT to the step, so no value is cut, and
  // keeps zero when the domain holds it; a step that would draw more than 20
  // intervals is ignored with a warning.
  const tickStep = va.tickStep;
  if (!d.bumpDerived && tickStep !== undefined && tickStep > 0) {
    const baseLo = va.min !== undefined || variant === 'stacked100-area' ? dLo : dLo <= 0 && dataLo >= 0 ? 0 : dataLo;
    const baseHi = va.max !== undefined || variant === 'stacked100-area' ? dHi : dHi >= 0 && dataHi <= 0 ? 0 : dataHi;
    const from = Math.floor(baseLo / tickStep + 1e-9);
    const to = Math.ceil(baseHi / tickStep - 1e-9);
    if (to - from >= 1 && to - from <= 20) {
      stepTicks = Array.from({ length: to - from + 1 }, (_, i) => Number(((from + i) * tickStep).toFixed(10)));
      dLo = stepTicks[0]!;
      dHi = stepTicks[stepTicks.length - 1]!;
    } else {
      warnings.push({
        code: 'tick-step-ignored', severity: 'warn',
        message: `valueAxis.tickStep ${tickStep} would draw ${to - from} intervals over the value domain; the nice ticks are drawn instead`,
        suggest: 'pick a step that gives 1 to 20 intervals',
      });
    }
  }
  let bumpLadderMax = d.bumpDerived?.maxRank ?? 1;
  if (d.bumpDerived) {
    dLo = 0.5;
    if (typeof options.scaleGroup?.y === 'string' && va.max !== undefined) {
      bumpLadderMax = Math.max(bumpLadderMax, Math.round(va.max - 0.5));
    }
    dHi = bumpLadderMax + 0.5;
  }
  return { dLo, dHi, domainExtendingValueLines, bumpLadderMax, stepTicks, ...(grid ? { gridDataHi: dataHi } : {}) };
}

/** Phase 1: data in, the series, the plotted matrix after every preset, the stacks and the value domain out. */
/** Stacking (stacked-area / stacked100-area, nulls count as 0) and the last non-null plotted value per drawn series. */
function stackAndEndpoints(cats: Category[], dataSeries: NormSer[], drawnSeries: NormSer[], pv: (number | null)[][], rowOf: Map<NormSer, number>, isStacked: boolean) {
  // stacking (stacked-area / stacked100-area): nulls count as 0
  const cumTop: number[][] = dataSeries.map(() => []);
  const cumBot: number[][] = dataSeries.map(() => []);
  if (isStacked) {
    cats.forEach((_, ci) => {
      let run = 0;
      dataSeries.forEach((s, di) => {
        const v = pv[rowOf.get(s)!]![ci] ?? 0;
        cumBot[di]![ci] = run;
        run += v;
        cumTop[di]![ci] = run;
      });
    });
  }
  // endpoints: the last non-null plotted value per drawn series
  const endpoints: Record<Id, { categoryId: Id; value: number }> = emptyIdRecord();
  const lastIdxOf = new Map<Id, number>();
  drawnSeries.forEach((s) => {
    const row = pv[rowOf.get(s)!]!;
    for (let ci = row.length - 1; ci >= 0; ci--) {
      if (row[ci] !== null) {
        lastIdxOf.set(s.id, ci);
        // Twelve significant digits clear float noise; round2 turned 5e-13 into 0 and 0.1234 into 0.12.
        endpoints[s.id] = { categoryId: cats[ci]!.id, value: Number(row[ci]!.toPrecision(12)) };
        break;
      }
    }
  });
  return { cumTop, cumBot, endpoints, lastIdxOf };
}

/**
 * No guessing: two or more drawn series without names would be told apart by
 * colour alone, so the key row names them. An explicit legend ('none', a
 * position or an object) is the author's or the host's call, and a grid
 * panel whose grid names the series in its own legend needs no second one.
 */
function namedSeries(modes: LineLabelModes, options: LineOptions, drawn: number, warnings: LintWarning[]): LineLabelModes {
  const gridLegend = (options as LineOptions & { gridEndpointIdentity?: unknown }).gridEndpointIdentity === 'legend';
  if (modes.series !== 'none' || drawn < 2 || gridLegend || options.legend !== undefined) return modes;
  warnings.push({
    code: 'series-labels-key',
    severity: 'info',
    message: `seriesLabels 'none' would leave ${drawn} drawn series told apart by colour alone, so the key row above the plot names them`,
    suggest: "set seriesLabels to 'end', 'inline' or 'key', or legend to 'none' where the host names the series",
  });
  return { ...modes, series: 'key' };
}

export function resolveLineDomain(data: LineChartData, input: LineOptions, env: LineEnv, warnings: LintWarning[]): LineDomain {
  let options = input;
  // a theme may make a zero-based value axis the default; an
  // authored includeZero, true or false, still wins.
  const themeZero = env.theme.valueAxis?.includeZero;
  if (themeZero !== undefined && options.valueAxis?.includeZero === undefined) {
    options = { ...options, valueAxis: { ...options.valueAxis, includeZero: themeZero } };
  }
  const { isBump } = env;
  const { cats, seriesNorm } = normalizeLineData(data);
  // A continuous x axis: refusals, the range and every x anchor, before the presets read them.
  const xModel = lineXModel(options, cats);
  const xRange = xModel ? resolveLineXOptions(options, xModel, cats, warnings) : undefined;
  if (xRange) options = xRange.options;
  for (const value of unmatchedPartial(data)) {
    warnings.push({ code: 'x-partial-no-reading', severity: 'warn', field: ['data', 'partial'],
      message: `data.partial names ${JSON.stringify(value)}, which is the x of no reading, so nothing is marked partial there`,
      suggest: 'name the x of a reading exactly, as data.x gives it' });
  }
  // `let` only so the bump preset can drop series that cannot be ranked
  // (all-null entities, value-scale reference lines) BEFORE pv is built.
  let dataSeries = seriesNorm.filter((s) => s.role !== 'reference');
  let refSeries = seriesNorm.filter((s) => s.role === 'reference');
  if (dataSeries.length === 0) {
    throw new NormalizeError('empty-data', 'series', 'line requires at least one data-role series');
  }
  const seriesById = new Map(seriesNorm.map((series) => [series.id, series] as const));
  const targets = collectTargets(seriesNorm, cats, options, warnings);
  const { variant, isArea, isStacked, interpolationFor } = lineVariant(options, isBump, seriesNorm, warnings);
  // Exhibit-wide format raster: style from the example, ONE precision for
  // every value label, decided over the plotted values, so an endpoint reads
  // 53.2 under a "1,234" example instead of "53". A rebased chart prints an
  // index, not the data unit, so the unit rule stays off it.
  const indexed = options.rebase100 && variant !== 'stacked100-area' && cats.some((c) => c.id === rebaseAtId(options.rebase100, cats));
  let valueSpec = seriesRasterFormatter(options.format, seriesNorm.flatMap((s) => s.vals.map((val) => val.v)), options.locale?.language, indexed ? undefined : options.unit, options.target, undefined, isStacked);
  const bumpPrepared = prepareBump({
    isBump, options, valueAxis: options.valueAxis ?? {}, targetsLength: targets.length,
    dataSeries, refSeries, seriesNorm, cats, warnings,
  });
  dataSeries = bumpPrepared.dataSeries;
  refSeries = bumpPrepared.refSeries;
  const { nmCats100, overfullCats100, naCats100, basisByCat } = percentBasis(cats, dataSeries, variant, warnings);
  // An stacked100-area category with a missing part is normalised over the known
  // parts only: its shares are not printed. An authored total100 is a
  // known whole. The labels read the set; the areas still draw.
  const sharesWithheld = new Set(variant === 'stacked100-area' ? cats
    .filter((c, ci) => c.total100 === undefined && isIncomplete(dataSeries.map((s) => s.vals[ci]!.v)))
    .map((c) => c.id) : []);
  warnIncompleteComposition(warnings, cats.filter((c) => sharesWithheld.has(c.id)).map((c) => c.label ?? c.id),
    'these categories are drawn as shares of their known parts only; their share labels are not printed');
  pushAll(warnings, stackedAreaSignWarnings(cats, dataSeries, variant));
  // TWIN of mekko's compositionInvalidAt. Identical but for the
  // composition-mode name ('stacked100-area' here, 'percent' in mekko) and the
  // correspondingly-named suppression sets. Nothing else may differ.
  const compositionInvalidAt = (ci: number): boolean =>
    variant === 'stacked100-area' && (nmCats100.has(cats[ci]!.id) || naCats100.has(cats[ci]!.id));
  // TWIN of column's absOf. Identical but for the composition-mode
  // name — line's is 'stacked100-area', column's 'stacked100'.
  const absOf = (s: NormSer, ci: number): number | null => {
    const val = s.vals[ci]!;
    if (val.v === null) return null;
    if (!val.isPct) return val.v;
    if (variant !== 'stacked100-area') return val.v;
    const b = basisByCat[ci]!;
    return b > 0 ? (val.v * b) / 100 : null;
  };
  /** pv = value in plotted units (percent for stacked100-area, else absolute). */
  const pv: (number | null)[][] = seriesNorm.map((s) => cats.map((_, ci) => {
    const val = s.vals[ci]!;
    if (val.v === null) return null;
    if (variant !== 'stacked100-area') return val.v;
    if (compositionInvalidAt(ci)) return null;
    if (val.isPct) return val.v;
    const b = basisByCat[ci]!;
    return b > 0 ? (val.v / b) * 100 : 0;
  }));
  const rowOf = new Map<NormSer, number>(seriesNorm.map((s, k) => [s, k] as const));
  const rounded = variant === 'stacked100-area' && options.rounding !== 'nearest'
    ? roundWholes(cats.flatMap((category, ci) => {
      if (compositionInvalidAt(ci) || dataSeries.some(s => s.vals[ci]!.v === null || s.vals[ci]!.isPct)) return [];
      return [{ id: category.id, name: category.label ?? category.id,
        parts: dataSeries.map(s => ({ id: s.id, name: s.label, share: pv[rowOf.get(s)!]![ci]! })) }];
    }), options.locale?.language, undefined, true)
    : undefined;
  if (rounded) pushAll(warnings, rounded.warnings);
  // The printed stacked100-area shares (both ends, every category under 'all') sum to
  // 100, or the drift is disclosed. Computed shares only.
  const printedValues = lineLabelModes(options, variant, 0).values;
  const printedAt = variant === 'stacked100-area' && printedValues !== 'none' && options.labels !== false
    ? printedValues === 'all' ? cats.map((_, ci) => ci) : printedValues === 'last' ? [cats.length - 1] : [...new Set([0, cats.length - 1])]
    : [];
  if (options.rounding === 'nearest' && printedAt.length > 0) {
    warnShareRoundingDrift(warnings, printedAt.flatMap((ci) => {
      const c = cats[ci]!;
      return compositionInvalidAt(ci) || sharesWithheld.has(c.id) || c.total100 !== undefined || dataSeries.some((s) => s.vals[ci]!.isPct)
        ? []
        : [{ name: c.label ?? c.id, shares: dataSeries.flatMap((s) => pv[rowOf.get(s)!]![ci] ?? []) }];
    }));
  }
  // The method note speaks only of moved shares that print: the categories whose labels show.
  const printedNames = new Set(printedAt.map((ci) => cats[ci]!.label ?? cats[ci]!.id));
  const shareNotes = shareRoundingNotes(options, rounded?.adjustments.filter((adjustment) => printedNames.has(adjustment.whole)) ?? []);
  // Bump: derive ranks (standard competition ranking, "1224") and PLOT THEM IN
  // PLACE OF THE VALUES. The rank is written back into `pv`, so everything
  // below operates on rank without knowing it; `s.vals` keeps the metric, and
  // `absOf` still reads it, which is how a point can display both quantities.
  const bumpDerived = deriveBumpRanks({
    isBump, direction: bumpPrepared.bumpDirection, dataSeries, cats, pv, rowOf, fmt: valueSpec.fmt, format: options.format, warnings,
  });
  const gapFillSeries = resolveGapFillSeries({ gapFill: options.gapFill, seriesById, warnings });
  const fan = resolveFan({
    spec: options.fan, seriesById, seriesNorm, cats, variant, isArea, rebase100: options.rebase100, gapFill: options.gapFill, pv, rowOf, warnings,
  });
  // A fan that does not PAINT does not strip anything: if there is no wash to
  // draw, the bounds are ordinary series and are drawn as such.
  const bumpFocus = bumpFocusOf(isBump, options, dataSeries, bumpDerived, cats, warnings);
  const drawnSeries = bumpFocus
    ? dataSeries.filter((s) => bumpFocus.has(s.id))
    : fan && fan.origin !== null ? dataSeries.filter((s) => !fan.boundIds.has(s.id)) : dataSeries;
  const bumpOmitted = bumpFocus ? dataSeries.filter((s) => !bumpFocus.has(s.id)) : [];
  const resolvedModes = lineLabelModes(options, isBump ? 'bump' : variant, drawnSeries.length);
  const legendPosition = typeof options.legend === 'object' ? options.legend.position : options.legend;
  if (isArea && options.seriesLabels === undefined && options.labels !== false && options.labels?.series === undefined
    && (legendPosition === 'top' || legendPosition === 'bottom' || legendPosition === 'right')) {
    // An authored area key carries the automatic series names once.
    resolvedModes.series = 'key';
  }
  const labelModes = namedSeries(resolvedModes, options, drawnSeries.length, warnings);
  const phases = validatePhases(options, { isBump, isArea, variant, fan, drawnSeries, cats, pv, rowOf }, interpolationFor, warnings);
  // Source nulls survive rebase suppression and follow the viewport by category id.
  const sourceNulls = new Set(variant === 'stacked-area'
    ? cats.filter((_, ci) => dataSeries.some(s => s.vals[ci]!.v === null)).map(c => c.id) : []);
  const rebaseSuppressed: LineDomain['rebaseSuppressed'] = [];
  const rebased = applyRebase(options, variant, cats, seriesNorm, pv, rowOf, warnings, rebaseSuppressed);
  if (rebased) {
    // The format raster: a rebased chart prints an index, so the raster runs over
    // the rebased values, judged to one decimal (the precision an index is read
    // at), and one spec serves the point labels, the a11y description and the
    // y-axis ticks. The unit rule stays off it.
    valueSpec = seriesRasterFormatter(
      options.format,
      seriesNorm.flatMap((s) => pv[rowOf.get(s)!]!.map((v) => (v === null ? null : Math.round(v * 10) / 10))),
      options.locale?.language,
      undefined,
      options.target,
      undefined,
      isStacked,
    );
  }
  if (fan) {
    // A fan's bounds belong to the line they surround: the line takes one precision with its bounds ("−48.00" beside "−13.50").
    const made = valueSpec;
    const withBounds = { format: fan.of.format, unit: fan.of.unit, values: [fan.of, ...fan.bands.flatMap((band) => [band.low, band.high])].flatMap((s) => s.vals.map((val) => val.v)) };
    valueSpec = { ...made, forSeries: (series, cellFormat) => made.forSeries(series === fan.of ? withBounds : series, cellFormat) };
  }
  // The anomaly rule reads every source period, before a window or zoom.
  const statFmt = (v: number) => formatStatWithSpec(v, valueSpec.spec);
  const anomalyRun = options.anomaly
    ? lineAnomalyModel(options.anomaly, { variant, isBump, drawnSeries, cats, pv, rowOf, fmt: valueSpec.fmt, statFmt, locale: options.locale?.language, strings: options.strings, warnings })
    : undefined;
  const live = lineWindow(options, cats, variant, isBump, Boolean(fan), env.size.width, warnings, xModel !== undefined);
  const population = applyCategoryViewport({ domain: options.viewDomain as { x: [string, string] } | undefined, window: live.window, categories: cats, series: seriesNorm,
    ...(xModel ? { positions: xModel.xs } : {}),
    plotted: pv, basis: basisByCat, targets, annotations: options.annotations,
    anchors: [...phases?.phases.flatMap(phase => [phase.from, phase.to]) ?? [], ...live.anchors ?? []],
    samplingRows: [...(isBump ? pv : []), ...(isStacked ? stackBoundaries(dataSeries.map(s => pv[rowOf.get(s)!]!)) : []), ...(fan?.bands.map(band => band.widths) ?? [])] });
  checkPointBudget(cats.length, seriesNorm.length);
  if (population) projectLineViewport({ ...population, bump: bumpDerived, fan, phases });
  if (population) options = liveWindowOptions({ ...options, annotations: population.annotations }, population.sampling);
  // After the viewport: the rounded shares are keyed by category, so they follow its projection.
  const labelPv = rounded ? seriesNorm.map((s, si) => cats.map((c, ci) => rounded.values.get(`${c.id}\0${s.id}`) ?? pv[si]![ci]!)) : pv;

  // A zoom or sampled window keeps its own source spacing.
  const shown = population ? population.categories.slice(population.indexes[0], population.indexes[population.indexes.length - 1]! + 1) : cats;
  const timeline = xModel ? valueTimeline(xModel, xRange!, population, cats)
    : (options.trend ? trendTimeline(cats, shown) : undefined) ?? (population ? undefined : categoryTimeline(cats));
  if ((options.trend || xModel) && population && timeline) Object.assign(population, timeline);

  const { cumTop, cumBot, endpoints, lastIdxOf } = stackAndEndpoints(cats, dataSeries, drawnSeries, pv, rowOf, isStacked);
  // A side is cut only where its bound falls between a kept reading and the reading outside it.
  const cut = xModel && population ? rangeCut(xModel.xs, population.indexes, xRange!.lo, xRange!.hi) : undefined;
  const range: LineRange | undefined = xModel && population && cut && (cut.lo || cut.hi)
    ? { lo: xRange!.lo, hi: xRange!.hi, cut, xs: xModel.xs, categories: population.categories, indexes: population.indexes, plotted: population.plotted, values: population.values,
      ...stackAndEndpoints(population.categories, dataSeries, drawnSeries, population.plotted, rowOf, isStacked),
      invalid: new Set(population.categories.flatMap((c, i) => nmCats100.has(c.id) || naCats100.has(c.id) ? [i] : [])) }
    : undefined;
  const edgeValues = range ? seriesNorm.flatMap(s => {
    const di = dataSeries.indexOf(s);
    const row = range.plotted[rowOf.get(s)!]!;
    const rows = isStacked && di >= 0 ? [range.cumTop[di]!.map((v, i) => row[i] === null && (i <= range.indexes[0]! || i >= range.indexes[range.indexes.length - 1]!) ? null : v), range.cumBot[di]!] : [row];
    return rangeRuns(range, rows, interpolationFor(s), s.interpolateGaps).flatMap(run => run.flatMap(edge => edge.points.flatMap(p => p.x === range.lo || p.x === range.hi ? [p.y] : [])));
  }) : [];
  const incompleteStack = variant === 'stacked-area'
    ? cats.filter(c => sourceNulls.has(c.id)) : [];
  if (incompleteStack.length > 0) warnings.push({
    code: 'incomplete-composition', severity: 'warn',
    message: `missing value (null) in ${incompleteStack.map(c => `'${c.label ?? c.id}'`).join(', ')}: missing values are drawn as zero in the stack; these stack heights are not complete totals`,
    suggest: 'Supply each missing component value. Use 0 only when the source proves zero.',
  });
  const core = { options, cats, seriesNorm, dataSeries, targets, variant, isArea, isStacked, pv, rowOf, bumpDerived };
  const values = valueDomain({ ...core, cumTop, cumBot }, isBump, warnings, edgeValues);
  const anomaly: LineAnomaly | undefined = anomalyRun && {
    model: anomalyRun.anomaly, seriesId: anomalyRun.seriesId, statFmt,
    ...anomalyCorridor(anomalyRun.anomaly, anomalyRun.values, values.dLo, values.dHi, statFmt, warnings, options.strings),
  };
  const resolved = {
    ...core,
    refSeries, drawnSeries, bumpOmitted, valueSpec, fmt: valueSpec.fmt, interpolationFor, labelModes, labelOnly: labelModes.only, gapFillSeries, fan, phases, rebased,
    population, timeline, ...(xModel ? { x: { model: xModel, lo: xRange!.lo, hi: xRange!.hi, shown: population ? population.indexes.map((i) => xModel.xs[i]!) : xModel.xs, ...(range ? { range } : {}) } } : {}), autoSampled: live.auto === true, absOf, compositionInvalidAt, nmCats100, overfullCats100, naCats100, sharesWithheld, incompleteStack, rebaseSuppressed, cumTop, cumBot, endpoints, lastIdxOf,
    labelPv, shareTexts: rounded?.texts ?? new Map(), ...(rounded ? { roundingAdjustments: rounded.adjustments } : {}), shareNotes,
    ...values,
    anomaly,
  };
  return { ...resolved, trends: fitLineTrends(resolved, warnings) };
}

/**
 * options.anomaly on a line: column's rule over the one drawn series, on the
 * values the line plots. A stack, a share or a rank has no deviation to judge.
 */
function lineAnomalyModel(
  spec: NonNullable<LineOptions['anomaly']>,
  d: {
    variant: LineVariant; isBump: boolean; drawnSeries: NormSer[]; cats: Category[]; pv: (number | null)[][]; rowOf: Map<NormSer, number>;
    fmt: (v: number) => string; statFmt: (v: number) => string; locale: string | undefined; strings?: import('../../types/options').StringsSpec; warnings: LintWarning[];
  },
) {
  if (d.isBump || d.variant !== 'line') {
    throw new NormalizeError(
      'anomaly-composition-conflict',
      'options.anomaly',
      `anomaly needs the plain line variant; '${d.isBump ? 'bump' : d.variant}' draws ${d.isBump ? 'ranks' : 'a composition'}, which have no deviation baseline`,
      "use variant 'line' on the values themselves",
    );
  }
  if (d.drawnSeries.length !== 1) {
    throw new NormalizeError(
      'anomaly-single-series',
      'options.anomaly',
      `anomaly needs exactly one drawn series; got ${d.drawnSeries.length} — a robust score across two different measures is meaningless`,
      'chart one measure per exhibit, or pre-compute the deviation upstream',
    );
  }
  refuseAnomalySpec(spec);
  const series = d.drawnSeries[0]!;
  const row = d.pv[d.rowOf.get(series)!]!;
  const present = d.cats.flatMap((c, ci) => {
    const value = row[ci];
    return value === null || value === undefined || !Number.isFinite(value) ? [] : [{ categoryId: c.id, value }];
  });
  return { ...anomalyModel(spec, present, d.fmt, d.statFmt, d.locale, d.warnings, d.strings), seriesId: series.id };
}

/** A reader follows at most this many rank lines. */
export const BUMP_SERIES_LIMIT = 12;

/**
 * The entities a bump draws. More than BUMP_SERIES_LIMIT
 * without `bump.focus` is refused with the limit and the option to use,
 * never thinned silently; the fix names the five best-ranked at the end.
 */
function bumpFocusOf(
  isBump: boolean, options: LineOptions, dataSeries: NormSer[], bump: BumpDerived | undefined, cats: Category[], warnings: LintWarning[],
): Set<Id> | undefined {
  if (!isBump || !bump) return undefined;
  const focus = options.bump?.focus;
  if (focus) {
    const unknown = focus.filter((id) => !dataSeries.some((s) => s.id === id));
    if (unknown.length > 0) throw new NormalizeError('bump-focus-unknown', 'options.bump.focus', `bump.focus names ${unknown.map((id) => `'${id}'`).join(', ')}, which are not ranked series; valid ids: ${dataSeries.map((s) => s.id).join(', ')}`);
    return new Set(focus);
  }
  if (dataSeries.length <= BUMP_SERIES_LIMIT) return undefined;
  const last = cats.length - 1;
  const best = [...dataSeries].filter((s) => bump.ranks[s.id]?.[last] !== null && bump.ranks[s.id]?.[last] !== undefined)
    .sort((a, b) => bump.ranks[a.id]![last]! - bump.ranks[b.id]![last]!).slice(0, 5).map((s) => s.id);
  warnings.push({
    code: 'bump-series-limit',
    severity: 'error',
    message: `a bump chart draws at most ${BUMP_SERIES_LIMIT} entities, so each line can be followed; this one ranks ${dataSeries.length}`,
    suggest: `set bump.focus to the entities the exhibit is about (at most ${BUMP_SERIES_LIMIT}; the five best at the end are ${best.join(', ')}). Every entity is still ranked, and the others are named in a note and keep their values in the data table. The chosen lines and their names must fit the chart size; leave the height open or give them more room. Or show the ranks in a table.`,
    field: ['options', 'bump', 'focus'],
  });
  return undefined;
}

/**
 * The drawn edges of a stacked area: each series' running sum over the series
 * below it. Sampling keeps each row's bucket extremes, so the stack's peaks and
 * troughs survive, not only those of the single series.
 */
function stackBoundaries(rows: readonly (number | null)[][]): number[][] {
  const edges: number[][] = [];
  let below: number[] | undefined;
  for (const row of rows) {
    const edge = row.map((value, ci) => (below?.[ci] ?? 0) + (value ?? 0));
    edges.push(edge);
    below = edge;
  }
  return edges;
}
