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
import { saysToDate } from '../../core/partialPeriod';
import type { ResolvedChartRequest } from '../../core/request';
import type { InteractionRecord } from '../../core/a11y/types';
import type { StringsSpec } from '../../core/types/options';

interface SourceCategory { id: string; label?: string; date?: string; partial?: boolean }
interface SourceChart { data?: { categories?: unknown[]; series?: unknown[]; panels?: unknown[] }; options?: { strings?: StringsSpec; subtitle?: unknown; title?: unknown } }

const DAY = 86400000;

/** The panel a record's `target.panel` path names inside a grid's data, else the chart itself. */
function sourceChart(request: ResolvedChartRequest, panel: string | undefined): SourceChart {
  let chart = request as unknown as SourceChart;
  for (const id of panel?.split('/') ?? []) {
    const child = chart.data?.panels?.find(entry => (entry as { id?: unknown })?.id === id) as SourceChart | undefined;
    if (child) chart = child;
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
function periodName(categories: readonly SourceCategory[], index: number, locale: string | undefined): string | undefined {
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
export function cardTitle(request: ResolvedChartRequest, record: InteractionRecord): string | undefined {
  const categoryId = record.target.owner.categoryId;
  if (categoryId === undefined || record.target.owner.annotationId !== undefined || record.event) return undefined;
  const chart = sourceChart(request, record.target.panel);
  const categories = categoriesOf(chart);
  const index = categories?.findIndex(category => category.id === categoryId) ?? -1;
  if (index < 0) return undefined;
  const locale = request.locale?.language;
  const period = periodName(categories!, index, locale);
  if (!categories![index]!.partial) return period;
  const heading = period ?? record.categoryLabel ?? categories![index]!.label ?? categoryId;
  const toDate = chartString({ locale: { language: locale }, strings: chart.options?.strings ?? request.options.strings }, 'toDate');
  return toDate === '' || saysToDate(heading, toDate) ? heading : `${heading} ${toDate}`;
}

/** A sparkline's metric where its data names none: the subtitle's measure, else a title short enough to be a name. */
export function metricName(request: ResolvedChartRequest): string | undefined {
  if (request.type !== 'sparkline') return undefined;
  const options = request.options as SourceChart['options'];
  const measure = (options?.subtitle as { measure?: unknown } | undefined)?.measure;
  if (typeof measure === 'string' && measure.trim()) return measure.trim();
  const title = typeof options?.title === 'string' ? options.title.trim() : '';
  return title && title.split(/\s+/).length <= 4 ? title : undefined;
}

/**
 * The place of each record's series in the key: its place in the spec's
 * series list, else (a series the engine adds) after them in record order.
 */
export function keyOrder(request: ResolvedChartRequest, records: readonly InteractionRecord[]): Map<InteractionRecord, number> {
  const ranks = new Map<string | undefined, Map<string, number>>();
  const rankOf = (panel: string | undefined) => {
    let rank = ranks.get(panel);
    if (!rank) {
      const series = sourceChart(request, panel).data?.series;
      ranks.set(panel, rank = new Map((Array.isArray(series) ? series : []).flatMap((entry, index) => {
        const id = (entry as { id?: unknown } | undefined)?.id;
        return typeof id === 'string' ? [[id, index] as const] : [];
      })));
    }
    return rank;
  };
  return new Map(records.map((record, index) => {
    const { seriesId } = record.target.owner;
    const rank = seriesId === undefined ? undefined : rankOf(record.target.panel).get(seriesId);
    return [record, rank ?? records.length + index];
  }));
}
