import { formatAutomaticNumber } from '../../format';
import { trendRateFormatter } from '../../formatSpec';
import { parseISODate, utcDate } from '../../isoDate';
import { dayUnit } from '../../calendarLabels';
import { trendTimeUnit } from '../../timeAxis';
import { olsFit, olsMoments, clipTrendToDomain, type OlsFit, type OlsMoments } from '../../ols';
import { NormalizeError } from '../../normalize/shared';
import { chartString } from '../../strings/line';
import { dashToken, strokeToken } from '../../theme';
import type { LegendItemInput } from '../../frame';
import type { Category } from '../../types/data';
import type { LintWarning, SceneNode } from '../../types/scene';
import type { OccupiedIndex } from '../../label/occupied';
import type { Theme } from '../../types/theme';
import type { LineArea, LineDomain, LinePaints } from './model';
import { minOf } from '../../arrays';

type CalendarTrendUnit = 'day' | 'week' | 'month' | 'quarter' | 'year';
/** 'second' to 'hour' fit elapsed time on a continuous time axis; 'x' the plain x of a number axis. */
export type TrendUnit = CalendarTrendUnit | 'period' | 'second' | 'minute' | 'hour' | 'x';

export interface LineTrend extends OlsMoments, OlsFit {
  id: string;
  x0: number;
  x1: number;
  /** x counts from the first shown category: calendar periods for month, quarter and year dates, else weeks or elapsed UTC days; other categories use their positions. */
  unit: TrendUnit;
}

const DAY = 86_400_000;

/** A year label, including fiscal years and forecast suffixes. */
export function categoryYear(category: Category): number | undefined {
  const year = /^(?:FY\s?)?(\d{4})\s?[A-Z]{0,2}$/.exec((category.label ?? category.id).trim());
  return year ? Number(year[1]) : undefined;
}

/** An explicit date wins; a year label uses the start of that year for spacing. */
function categoryDate(category: Category): Date | null | undefined {
  if (category.date) return parseISODate(category.date);
  const year = categoryYear(category);
  return year === undefined ? undefined : utcDate(year, 0);
}

/** Valid, strictly increasing dates, else undefined. */
function datesOf(cats: Category[]): Date[] | undefined {
  const dates = cats.map(categoryDate);
  if (dates.length < 2 || dates.some((d, i) => !d || (i > 0 && d.getTime() <= dates[i - 1]!.getTime()))) return undefined;
  return dates as Date[];
}

/** The reporting period the rate prints in: calendar months, quarters and years count periods, so no month length is assumed. */
function trendUnit(cats: Category[]): CalendarTrendUnit | 'period' {
  const dates = datesOf(cats);
  if (!dates) return 'period';
  const months = dates.map(d => d.getUTCFullYear() * 12 + d.getUTCMonth());
  const steps = months.slice(1).map((m, i) => m - months[i]!);
  const sameDay = dates.every(d => d.getUTCDate() === dates[0]!.getUTCDate());
  const calendar = sameDay || dayUnit(dates) !== 'day';
  // Calendar labels name the date's boundary; a rate names the spacing, on any day of the year.
  if (calendar && steps.every(step => step > 0 && step % 12 === 0)) return 'year';
  if (calendar && steps.every(step => step > 0 && step % 3 === 0)) return 'quarter';
  if (calendar && steps.every(step => step > 0)) return 'month';
  return dates.slice(1).every((d, i) => d.getTime() - dates[i]!.getTime() === 7 * DAY) ? 'week' : 'day';
}

/** x in `unit` from the first category; a skipped calendar period keeps its step (January to March is 2 months). */
function trendXs(cats: Category[], unit: CalendarTrendUnit): number[] {
  const dates = cats.map(c => categoryDate(c)!);
  const months = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth();
  const per = { month: 1, quarter: 3, year: 12 } as const;
  return dates.map(d => unit === 'day' || unit === 'week'
    ? (d.getTime() - dates[0]!.getTime()) / DAY / (unit === 'week' ? 7 : 1)
    : (months(d) - months(dates[0]!)) / per[unit]);
}

/**
 * Dated points take the trend's x spacing, so the straight fit passes through
 * them; regular months, quarters and years keep even steps. A sampled window
 * takes the unit and step of its shown source range, as the fit does.
 */
export function trendTimeline(cats: Category[], source: Category[] = cats): { positions: number[]; span: number } | undefined {
  const unit = trendUnit(source);
  if (unit === 'period') return undefined;
  const all = trendXs(source, unit);
  const steps = all.slice(1).map((x, i) => x - all[i]!);
  const step = minOf(steps);
  // Even steps keep the plain category spacing, so the trend changes no point.
  if (cats === source && steps.every(gap => gap === step)) return undefined;
  const xs = trendXs(cats, unit);
  return { positions: xs.map(x => x / step), span: xs[xs.length - 1]! / step + 1 };
}

/**
 * Fit every non-null source value in the shown range (after a window or zoom,
 * before any min-max sampling), so the slope does not depend on the chart width.
 */
export function fitLineTrends(domain: Omit<LineDomain, 'trends'>, warnings: LintWarning[]): LineTrend[] {
  if (!domain.options.trend) return [];
  if (domain.isStacked || domain.bumpDerived) {
    throw new NormalizeError('trend-unsupported', 'options.trend', "trend needs variant 'line' or 'area'; a stack or rank is not a series value");
  }
  const population = domain.population;
  const lo = population ? population.indexes[0]! : 0;
  const hi = population ? population.indexes[population.indexes.length - 1]! : domain.cats.length - 1;
  const cats = population ? population.categories.slice(lo, hi + 1) : domain.cats;
  const rows = population ? population.plotted : domain.pv;
  // A continuous axis fits on elapsed time in its slope unit, or on the plain x.
  const continuous = domain.x ? continuousTrend(domain.x, lo, hi) : undefined;
  const unit = continuous?.unit ?? trendUnit(cats);
  const xs = continuous?.xs ?? (unit === 'period' ? cats.map((_, i) => population ? i : domain.timeline?.positions[i] ?? i) : trendXs(cats, unit as CalendarTrendUnit));
  return domain.drawnSeries.flatMap(s => {
    const row = rows[domain.rowOf.get(s)!]!;
    const points = xs.flatMap((x, i) => row[lo + i] === null ? [] : [{ x, y: row[lo + i]! }]);
    const moments = olsMoments(points);
    const fit = moments.n >= 3 ? olsFit(moments) : null;
    if (!fit) {
      warnings.push({ code: 'trend-undefined', severity: 'warn', field: ['options', 'trend'], owner: { seriesId: s.id },
        message: `no trend line for series '${s.id}': a fit needs at least 3 non-null points at distinct x positions; it has ${moments.n}` });
      return [];
    }
    return [{ id: s.id, ...moments, ...fit, x0: points[0]!.x, x1: points[points.length - 1]!.x, unit }];
  });
}

/** The source x of categories lo..hi on a continuous axis, in the slope unit from the first of them. */
function continuousTrend(x: NonNullable<LineDomain['x']>, lo: number, hi: number): { unit: TrendUnit; xs: number[] } {
  const source = x.model.xs.slice(lo, hi + 1);
  if (!x.model.clock) return { unit: 'x', xs: source };
  const { unit, ms } = trendTimeUnit(source[source.length - 1]! - source[0]!);
  return { unit, xs: source.map((v) => (v - source[0]!) / ms) };
}

/** The trend's x of each drawn category: the screen maps it linearly. */
function drawnXs(domain: LineDomain, unit: TrendUnit): number[] {
  if (domain.x) {
    const first = domain.x.model.xs[domain.population?.indexes[0] ?? 0]!;
    const ms = domain.x.model.clock ? ({ second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 } as Record<string, number>)[unit]! : 1;
    return domain.x.shown.map((v) => (domain.x!.model.clock ? (v - first) / ms : v));
  }
  return unit === 'period' ? domain.cats.map((_, ci) => domain.population?.positions[ci] ?? domain.timeline?.positions[ci] ?? ci) : trendXs(domain.cats, unit as CalendarTrendUnit);
}

const TREND_UNIT_KEY = { day: 'trendPerDay', week: 'trendPerWeek', month: 'trendPerMonth', quarter: 'trendPerQuarter', year: 'trendPerYear', period: 'trendPerPeriod', second: 'trendPerSecond', minute: 'trendPerMinute', hour: 'trendPerHour' } as const;

/** The rate uses the chart's value units; a percent-level change is in percentage points. */
export function lineTrendLabel(domain: LineDomain, fit: LineTrend): string {
  const { options } = domain;
  const label = typeof options.trend === 'object' ? options.trend.label : undefined;
  const series = domain.drawnSeries.find(s => s.id === fit.id)!;
  const example = domain.rebased ? undefined : series.format ?? options.format;
  const unit = domain.rebased ? undefined : series.unit ?? options.unit;
  const percent = !domain.rebased && series.vals.some(v => v.isPct);
  const slope = trendRateFormatter(example, options.locale?.language, percent ? '%' : unit, true)(fit.slope);
  const r2 = fit.r2 === null ? chartString(options, 'trendUndefined') : formatAutomaticNumber(fit.r2, { decimals: 2, locale: options.locale?.language });
  return chartString(options, 'lineTrendKey', {
    v1: label ?? chartString(options, 'linearTrend'), v2: series.label, v3: slope,
    v4: fit.unit === 'x' ? (options.xAxis?.unit ? chartString(options, 'trendPerXUnit', { v1: options.xAxis.unit }) : chartString(options, 'trendPerUnitOfX')) : chartString(options, TREND_UNIT_KEY[fit.unit]), v5: r2,
  });
}

/** The legend uses the frame's label solver; the plot keeps its point and series labels. */
export function lineTrendKeys(theme: Theme, domain: LineDomain, paints: LinePaints): LegendItemInput[] {
  return domain.trends.map(fit => {
    const i = domain.drawnSeries.findIndex(s => s.id === fit.id);
    return { id: `trend:${fit.id}`, label: lineTrendLabel(domain, fit), paint: paints.series(domain.drawnSeries[i]!, i),
      key: 'line', width: strokeToken(theme, 'rule'), dash: dashToken(theme, 'reference') };
  });
}

/** Clip the fitted range to the value axis and claim thin slices for label avoidance. */
export function drawLineTrends(theme: Theme, domain: LineDomain, area: LineArea, paints: LinePaints, nodes: SceneNode[], claims: OccupiedIndex): void {
  for (const fit of domain.trends) {
    const span = clipTrendToDomain(fit, [fit.x0, fit.x1], [domain.dLo, domain.dHi]);
    if (!span) continue;
    const xs = drawnXs(domain, fit.unit), n = xs.length - 1;
    if (n < 1 || xs[n] === xs[0]) continue;
    const x = (value: number) => area.xOf(0) + (value - xs[0]!) / (xs[n]! - xs[0]!) * (area.xOf(n) - area.xOf(0));
    const x1 = x(span[0]), x2 = x(span[1]);
    const y1 = area.y(fit.intercept + fit.slope * span[0]), y2 = area.y(fit.intercept + fit.slope * span[1]);
    const i = domain.drawnSeries.findIndex(s => s.id === fit.id);
    const owner = { seriesId: fit.id };
    nodes.push({ t: 'line', id: `trend:${fit.id}`, x1, y1, x2, y2, owner, part: 'trendLine',
      stroke: paints.series(domain.drawnSeries[i]!, i), width: strokeToken(theme, 'rule'), dash: dashToken(theme, 'reference') });
    for (let k = 0; k < 12; k++) {
      const a = y1 + (y2 - y1) * k / 12, b = y1 + (y2 - y1) * (k + 1) / 12;
      claims.claim({ x: x1 + (x2 - x1) * k / 12, y: Math.min(a, b) - 1.5, w: Math.max((x2 - x1) / 12, 1), h: Math.abs(b - a) + 3 },
        'annotation', { annotationId: `trend:${fit.id}` }, 'trendLine');
    }
  }
}
