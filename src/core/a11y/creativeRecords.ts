import { chartString } from '../strings/a11y-creativeRecords';
import { creativeMetrics } from '../charts/creative/layout';
import type { CreativeDerived, CreativeMarks } from '../charts/creative/layout';
import type { CreativeData } from '../charts/creative/types';
import { derivedPercent, makeRecord, numericValue, textValue, type RecordContext } from './recordsShared';
import type { InteractionRecord } from './types';

export function creativeRecords(ctx: RecordContext): InteractionRecord[] | undefined {
  if (ctx.request.type !== 'creative') return undefined;
  const data = ctx.request.data as CreativeData;
  const marks = ctx.geometry.marks as unknown as CreativeMarks;
  const fatigue = (ctx.geometry.derived as unknown as CreativeDerived).fatigue;
  const records = creativeMetrics.map(([key, label, suffix]) => {
    const unit = suffix === 'currency' ? data.facts.currency : suffix;
    const owner = { seriesId: key, categoryId: data.id };
    return makeRecord(ctx, owner, numericValue(data.metrics[key].value, unit), {
      label, seriesLabel: label, categoryLabel: data.facts.name, anchor: marks.metrics[key],
      nodeIds: [`creative:row:${key}`, `label:creative:metric:${key}`, `label:creative:value:${key}`, `label:creative:median:${key}`],
      fields: [
        { key: 'accountMedian', label: chartString(ctx.request.options, 'accountMedian'), value: numericValue(data.metrics[key].accountMedian, unit) },
        { key: 'population', label: chartString(ctx.request.options, 'medianPopulation'), value: textValue(data.comparison.population) },
        { key: 'window', label: chartString(ctx.request.options, 'medianWindow'), value: textValue(`${data.comparison.startDate} to ${data.comparison.endDate}`) },
      ],
    });
  });
  records.push(makeRecord(ctx, { pointId: data.id }, textValue(data.media.alt), { label: data.facts.name, anchor: marks.media,
    fields: [{ key: 'spendToDate', label: chartString(ctx.request.options, 'spendToDate'), value: numericValue(data.facts.spendToDate, data.facts.currency) }] }));
  records.push(makeRecord(ctx, { seriesId: 'fatigue', categoryId: data.id }, fatigue.status === 'unavailable'
    ? { kind: 'text', raw: null, state: 'unavailable', reason: fatigue.reason } : textValue(fatigue.status), {
    label: chartString(ctx.request.options, 'fatigueRule'), nodeIds: ['label:creative:fatigue:0'],
    claimIds: ctx.claims.filter(claim => claim.id.startsWith('creative:fatigue:')).map(claim => claim.id),
    fields: [{ key: 'changePct', label: chartString(ctx.request.options, 'dailyMeanChange'), value: derivedPercent(fatigue.changePct) },
      { key: 'baselineN', label: chartString(ctx.request.options, 'baselineObservations'), value: numericValue(fatigue.baseline.inputs.length) },
      { key: 'currentN', label: chartString(ctx.request.options, 'currentObservations'), value: numericValue(fatigue.current.inputs.length) }],
  }));
  for (const row of data.observations) for (const key of ['spend', 'cpa', 'ctr'] as const) records.push(makeRecord(ctx,
    { seriesId: `daily:${key}`, categoryId: row.date }, numericValue(row[key], key === 'ctr' ? '%' : data.facts.currency),
    { label: `${row.date} ${key.toUpperCase()}`, categoryLabel: row.date, seriesLabel: chartString(ctx.request.options, 'dailyMetric', { v1: key.toUpperCase() }) }));
  return records;
}
