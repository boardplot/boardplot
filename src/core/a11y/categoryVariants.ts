import { chartString } from '../strings/a11y-categoryVariants';
import type { BarDerived, BarMarks } from '../charts/bar/layout';
import type { VarianceDerived, VarianceMarks } from '../charts/variance/layout';
import { normalizeCategory, normalizeSeriesValues } from '../normalize/shared';
import type { ChartData } from '../types/data';
import type { VarianceOptions } from '../types/options';
import { compareValues, unavailableValue } from './comparison';
import { cellRecordValue, derivedValue, makeRecord, numericValue, type RecordContext } from './recordsShared';
import type { InteractionRecord } from './types';

function tornadoRecords(ctx: RecordContext): InteractionRecord[] | undefined {
  const derived = ctx.geometry.derived as unknown as BarDerived;
  if (!derived.tornado) return undefined;
  const data = ctx.request.data as ChartData;
  const categories = data.categories.map(normalizeCategory);
  const marks = ctx.geometry.marks as unknown as BarMarks;
  const number = (value: number) => numericValue(value, ctx.request.options.unit, ctx.request.options.format);
  return derived.tornado.rows.map(row => {
    const mark = marks.rows.find(mark => mark.id === row.id);
    const rank = derived.tornado!.ties.find(tie => tie.categoryIds.includes(row.id))?.rank;
    return makeRecord(ctx, { categoryId: row.id }, derivedValue(row.swing, ctx.request.options.unit, ctx.request.options.format), {
      label: categories.find(category => category.id === row.id)?.label ?? row.id,
      anchor: mark?.rect,
      fields: [
        { key: 'low', label: chartString(ctx.request.options, 'lowCase'), value: number(row.low) },
        { key: 'high', label: chartString(ctx.request.options, 'highCase'), value: number(row.high) },
        { key: 'base', label: chartString(ctx.request.options, 'baseCaseName'), value: number(derived.tornado!.baseValue) },
      ],
      members: data.series.map(series => ({ categoryId: row.id, seriesId: series.id })),
      ...(rank ? { rank: { value: rank, of: derived.tornado!.rows.length, policy: 'competition' as const, direction: 'desc' as const } } : {}),
    });
  });
}

export function categoryVariantRecords(ctx: RecordContext): InteractionRecord[] | undefined {
  if (ctx.request.type === 'bar') return tornadoRecords(ctx);
  if (ctx.request.type !== 'variance') return undefined;
  const data = ctx.request.data as ChartData;
  const options = ctx.request.options as VarianceOptions;
  const marks = ctx.geometry.marks as unknown as VarianceMarks;
  const derived = ctx.geometry.derived as unknown as VarianceDerived;
  const referenceSeries = data.series.find(series => series.id === options.variance.vs)!;
  const categories = data.categories.map(normalizeCategory);
  const cells = new Map(data.series.map((series, index) => [series.id, normalizeSeriesValues(series, categories, index)]));
  const sources = data.series.filter(series => options.variance.of && options.variance.of !== 'total'
    ? series.id === options.variance.of : series.role !== 'reference');
  const mode = options.variant;
  // On a relative chart a percent unit names the difference, not the plain values (as the layout reads it).
  const valueUnit = mode === 'relative' && (options.unit === '%' || options.unit === 'pp') ? undefined : options.unit;
  return categories.map((category, index) => {
    const operands = sources.map(series => cellRecordValue(cells.get(series.id)![index]!, series.unit ?? valueUnit, series.format ?? options.format));
    const values = operands.map(value => value.raw).filter((value): value is number => typeof value === 'number');
    const units = new Set(operands.map(value => value.unit));
    const current = operands.length === 1 ? operands[0]! : units.size > 1 ? unavailableValue('Current total combines incompatible units')
      : derivedValue(derived.ac[category.id] === null ? null : values.reduce((sum, value) => sum + value, 0), operands[0]?.unit, options.format);
    const reference = cellRecordValue(cells.get(referenceSeries.id)![index]!, referenceSeries.unit ?? valueUnit, referenceSeries.format ?? options.format);
    const comparison = compareValues(current, reference, referenceSeries.label ?? referenceSeries.id, referenceSeries.scenario);
    const mark = marks.bars.find(mark => mark.categoryId === category.id) ?? marks.pins.find(mark => mark.categoryId === category.id);
    return makeRecord(ctx, { categoryId: category.id }, mode === 'integrated' ? current : mode === 'relative' ? comparison.percent : comparison.delta, {
      label: category.label ?? category.id, anchor: mark?.rect, comparisons: [comparison],
      // the fields carry the series' own labels; a sum of several reads 'Current'.
      fields: [{ key: 'current', label: sources.length === 1 ? sources[0]!.label ?? sources[0]!.id : chartString(ctx.request.options, 'current'), value: current },
        { key: 'reference', label: referenceSeries.label ?? referenceSeries.id, value: reference }],
      ...(options.variance.of === undefined || options.variance.of === 'total'
        ? { members: data.series.filter(series => series.role !== 'reference').map(series => ({ categoryId: category.id, seriesId: series.id })) } : {}),
    });
  });
}
