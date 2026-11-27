/**
 * What the hover card says about the hovered category beyond the record's own
 * facts: the period it names, with its grain and year ("Week of 14 Sep 2026",
 * "January 2027", "W38 to date"), and the order its series take (the key's).
 * The records keep their own wording for the data table; only the card reads
 * these.
 */

import { chartString } from '../../core/strings/hover';
import { calendarPoint, dayUnit } from '../../core/calendarLabels';
import { dateNames } from '../../core/dateNames';
import { wordLanguage } from '../../core/numberMarks';
import { runningPeriodIds, saysToDate } from '../../core/partialPeriod';
import { scenarioFillPattern } from '../../core/scenarioPairs';
import type { ResolvedChartRequest } from '../../core/request';
import type { InteractionRecord } from '../../core/a11y/types';
import type { StringsSpec } from '../../core/types/options';
import type { Category } from '../../core/types/data';

interface SourceCategory { id: string; label?: string; date?: string; partial?: boolean; role?: string }
interface SourceSeries { id?: unknown; label?: unknown; role?: unknown; scenario?: unknown; values?: unknown }
interface SourceChart { type?: string; data?: { categories?: unknown[]; series?: unknown[]; panels?: unknown[] };
  options?: { strings?: StringsSpec; subtitle?: unknown; title?: unknown; legend?: { order?: unknown } } }

const DAY = 86400000;

/** The panel a record's `target.panel` path names inside a grid's data, else the chart itself. */
function sourceChart(request: ResolvedChartRequest, panel: string | undefined): SourceChart {
  let chart = request as unknown as SourceChart;
  for (const id of panel?.split('/') ?? []) {
    const child = chart.data?.panels?.find(entry => (entry as { id?: unknown })?.id === id) as SourceChart | undefined;
    // A metric stack's panels hold no data of their own: the stack's categories name the period.
    if (!child?.data) break;
    chart = child;
  }
  return chart;
}

function categoriesOf(chart: SourceChart): SourceCategory[] | undefined {
  const list = chart.data?.categories;
  if (!Array.isArray(list)) return undefined;
  return list.map(entry => typeof entry === 'string' ? { id: entry } : entry as SourceCategory);
}

/**
 * A category's period with its grain and year, from the dates of every
 * category of its chart: a 7-day step is a week, month starts a month. An
 * authored quarter or year keeps its label, which may name a fiscal period.
 */
function periodName(all: readonly SourceCategory[], at: number, locale: string | undefined): string | undefined {
  // A total category names no period, and the periods beside it keep theirs.
  if (all[at]!.role === 'total') return undefined;
  const categories = all.filter(category => category.role !== 'total');
  const index = categories.indexOf(all[at]!);
  const points = categories.map(category => calendarPoint(category.date ?? category.id));
  if (points.some(point => point === undefined) || new Set(points.map(point => point!.unit)).size !== 1) return undefined;
  const point = points[index]!;
  const dates = points.map(entry => entry!.date);
  let unit: string = point.unit;
  if (unit === 'day') {
    unit = dayUnit(dates);
    const steps = dates.slice(1).map((date, at) => date.getTime() - dates[at]!.getTime());
    if (unit === 'day' && steps.length > 0 && steps.every(step => step === 7 * DAY)) unit = 'week';
  }
  if ((unit === 'quarter' || unit === 'year') && categories[index]!.label !== undefined) return undefined;
  const { date } = point;
  const year = date.getUTCFullYear();
  const names = dateNames(locale);
  const tag = (wordLanguage(locale) ?? 'en').toLowerCase().replace(/_/g, '-');
  const day = tag === 'de' || tag.startsWith('de-') ? `${date.getUTCDate()}. ${names.monthsShort[date.getUTCMonth()]} ${year}`
    : tag === 'en-us' ? `${names.monthsShort[date.getUTCMonth()]} ${date.getUTCDate()}, ${year}`
      : `${date.getUTCDate()} ${names.monthsShort[date.getUTCMonth()]} ${year}`;
  if (unit === 'year') return String(year);
  if (unit === 'quarter') return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${year}`;
  if (unit === 'month') return `${names.months[date.getUTCMonth()]} ${year}`;
  if (unit === 'week') return chartString({ locale: { language: locale } }, 'weekOf', { v1: day });
  return day;
}

/**
 * The card's title for a record's category: its period where every category
 * of the chart has a date, else its authored label; a running period
 * (`partial`) adds the chart's "to date" words. Undefined where the record
 * has no category, or where the card's own heading already says it all.
 */
export function cardTitle(request: ResolvedChartRequest, record: InteractionRecord, records: readonly InteractionRecord[] = []): string | undefined {
  const categoryId = record.target.owner.categoryId;
  if (categoryId === undefined || record.target.owner.annotationId !== undefined || record.event) return undefined;
  // A record that names its series only in its label (a waffle of several series) keeps that label.
  if (record.target.owner.seriesId !== undefined && !record.seriesLabel && !record.valueLabel && record.label !== record.categoryLabel) return undefined;
  const chart = sourceChart(request, record.target.panel);
  const categories = categoriesOf(chart);
  const index = categories?.findIndex(category => category.id === categoryId) ?? -1;
  if (index < 0) return undefined;
  const locale = request.locale?.language;
  const period = periodName(categories!, index, locale);
  if (!categories![index]!.partial || !running(chart, categories!, records.filter(other => other.target.panel === record.target.panel)).has(categoryId)) return period;
  const heading = period ?? record.categoryLabel ?? categories![index]!.label ?? categoryId;
  const toDate = chartString({ locale: { language: locale }, strings: chart.options?.strings ?? request.options.strings }, 'toDate');
  return toDate === '' || saysToDate(heading, toDate) ? heading : `${heading} ${toDate}`;
}

/**
 * The categories that run now: a partial period with no actual after it. An
 * earlier partial period has closed. An actual is a value the chart's
 * records hold for a series that is no reference, and that the chart does
 * not draw as forecast or plan (hatched, outlined), as the chart counts it.
 */
function running(chart: SourceChart, categories: readonly SourceCategory[], records: readonly InteractionRecord[]): Set<string> {
  const series = (Array.isArray(chart.data?.series) ? chart.data!.series : []) as SourceSeries[];
  const references = new Set(series.filter(entry => entry?.role === 'reference').map(entry => entry.id));
  const actual = new Set<string>();
  for (const record of records) {
    const { categoryId, seriesId, annotationId } = record.target.owner;
    if (categoryId !== undefined && annotationId === undefined && !references.has(seriesId) && record.value.state === 'value'
      && scenarioFillPattern(record.scenario) === undefined) actual.add(categoryId);
  }
  return runningPeriodIds(categories as readonly Category[], index => records.length === 0 || actual.has(categories[index]!.id));
}

/**
 * The chart's metric where its records name none: a sparkline's subtitle
 * measure (or a subtitle of words alone), else a title short enough to be a
 * name; a funnel's series, which its last stages name nowhere else.
 */
export function metricName(request: ResolvedChartRequest, panel?: string, seriesId?: string): string | undefined {
  const chart = sourceChart(request, panel);
  const top = chart === (request as unknown as SourceChart);
  const type = top ? request.type : chart.type;
  const options = (top ? request.options : chart.options) as SourceChart['options'];
  if (type === 'funnel') {
    const series = (Array.isArray(chart.data?.series) ? chart.data!.series : []) as SourceSeries[];
    const label = (series.length === 1 ? series[0] : series.find(entry => entry?.id === seriesId))?.label;
    return typeof label === 'string' && label.trim() ? label.trim() : undefined;
  }
  if (type !== 'sparkline') return undefined;
  const subtitle = options?.subtitle;
  const measure = typeof subtitle === 'string' ? subtitle : (subtitle as { measure?: unknown } | undefined)?.measure;
  if (typeof measure === 'string' && measure.trim()) return measure.trim();
  const title = typeof options?.title === 'string' ? options.title.trim() : '';
  return title && title.split(/\s+/).length <= 4 ? title : undefined;
}

/**
 * The series that stand in a stack, by `stackKey`: every series of a
 * stacked column, bar or area that is no reference, and a combo's column
 * series. A part with no value in any shown category still has its place.
 */
export function stackSeries(request: ResolvedChartRequest, panels: readonly (string | undefined)[]): Set<string> {
  const ids = new Set<string>();
  for (const panel of panels) {
    const chart = sourceChart(request, panel);
    const top = chart === (request as unknown as SourceChart);
    const type = top ? request.type : chart.type;
    const variant = ((top ? request.options : chart.options) as { variant?: unknown } | undefined)?.variant;
    const series = (Array.isArray(chart.data?.series) ? chart.data!.series : []) as (SourceSeries & { kind?: unknown })[];
    const stacked = (type === 'column' || type === 'bar' || type === 'area') && (variant === 'stacked' || variant === 'stacked100');
    for (const entry of series) {
      if (typeof entry?.id !== 'string' || entry.role === 'reference') continue;
      if (stacked || (type === 'combo' && (entry.kind ?? 'column') === 'column')) ids.add(`${top ? '' : panel ?? ''}\u0000${entry.id}`);
    }
  }
  return ids;
}

/**
 * The place of each record's series in the key: its place in the drawn
 * legend (`legend`, the chart's own) or the legend's authored order (a
 * panel's), else in the spec's series list, else (a series the engine
 * adds) after them in record order.
 */
export function keyOrder(request: ResolvedChartRequest, records: readonly InteractionRecord[], legend?: readonly string[]): Map<InteractionRecord, number> {
  const ranks = new Map<string | undefined, Map<string, number>>();
  const rankOf = (panel: string | undefined) => {
    let rank = ranks.get(panel);
    if (!rank) {
      const chart = sourceChart(request, panel);
      const series = chart.data?.series;
      const ids = (Array.isArray(series) ? series : []).flatMap(entry => {
        const id = (entry as { id?: unknown } | undefined)?.id;
        return typeof id === 'string' ? [id] : [];
      });
      // An authored legend order leads; series it leaves out follow in data order.
      const authored = (chart === (request as unknown as SourceChart) ? request.options : chart.options) as SourceChart['options'];
      const order = panel === undefined && legend?.length ? [...legend]
        : Array.isArray(authored?.legend?.order) ? (authored!.legend!.order as unknown[]).filter((id): id is string => typeof id === 'string') : [];
      ranks.set(panel, rank = new Map([...order, ...ids.filter(id => !order.includes(id))].map((id, index) => [id, index] as const)));
    }
    return rank;
  };
  return new Map(records.map((record, index) => {
    const { seriesId } = record.target.owner;
    const rank = seriesId === undefined ? undefined : rankOf(record.target.panel).get(seriesId);
    return [record, rank ?? records.length + index];
  }));
}
