import { chartString } from '../strings/a11y-creativeRecords';
import { chartString as creativeString } from '../strings/creative';
import { tablePlan } from '../charts/creative/layout';
import type { CreativeDerived, CreativeMarks } from '../charts/creative/layout';
import type { CreativeData, CreativeOptions } from '../charts/creative/types';
import { derivedPercent, makeRecord, numericValue, textValue, type RecordContext } from './recordsShared';
import type { InteractionRecord, InteractionValue } from './types';

/** The change as the card prints it: the hover reads the same number. */
function printedChange(delta: { pct: number | null; text: string } | undefined): InteractionValue {
  const value = derivedPercent(delta?.pct);
  return delta?.pct === null || delta === undefined ? value : { ...value, displayed: delta.text };
}

export function creativeRecords(ctx: RecordContext): InteractionRecord[] | undefined {
  if (ctx.request.type !== 'creative') return undefined;
  const data = ctx.request.data as CreativeData;
  const marks = ctx.geometry.marks as unknown as CreativeMarks;
  const fatigue = (ctx.geometry.derived as unknown as CreativeDerived).fatigue;
  const options = ctx.request.options as CreativeOptions;
  const plan = tablePlan(options);
  const overrides = options.columnOverrides;
  const drawn = { value: plan.columns.includes('value'), median: plan.columns.includes('median'), delta: plan.columns.includes('delta') };
  const medianLabel = overrides?.median?.label ?? chartString(ctx.request.options, 'accountMedian');
  const deltaLabel = overrides?.delta?.label ?? creativeString(ctx.request.options, 'vsMedianColumn');
  const deltas = (ctx.geometry.derived as unknown as CreativeDerived).deltas ?? [];
  const drawnIds = new Set(ctx.geometry.scene.map(node => node.id));
  // A hidden row or column pushes no record and no hover field, as on a dimswitch. Medians and fatigue still read all six metrics.
  const records = plan.columns.length === 0 ? [] : plan.rows.map(([key, label, suffix]) => {
    const unit = suffix === 'currency' ? data.facts.currency : suffix;
    const owner = { seriesId: key, categoryId: data.id };
    const name = options.rowOverrides?.[key]?.label || label;
    const metric = data.metrics[key];
    // The record leads with the first number the row prints.
    const primary = drawn.value ? { value: numericValue(metric.value, unit), valueLabel: overrides?.value?.label ?? creativeString(ctx.request.options, 'creativeColumn') }
      : drawn.median ? { value: numericValue(metric.accountMedian, unit), valueLabel: medianLabel }
        : { value: printedChange(deltas.find(delta => delta.key === key)), valueLabel: deltaLabel };
    return makeRecord(ctx, owner, primary.value, {
      // The value is the creative's own, beside the account median: it carries the column's name.
      label: name, seriesLabel: name, categoryLabel: data.facts.name, valueLabel: primary.valueLabel, anchor: marks.metrics[key],
      nodeIds: [`creative:row:${key}`, `label:creative:metric:${key}`, `label:creative:value:${key}`, `label:creative:median:${key}`].filter(id => drawnIds.has(id)),
      fields: [
        ...(drawn.median && drawn.value ? [{ key: 'accountMedian', label: medianLabel, value: numericValue(metric.accountMedian, unit) }] : []),
        // A printed change keeps its source in the record once the value or the median it divides is hidden.
        ...(drawn.delta && drawn.value !== drawn.median ? [{ key: 'delta', label: deltaLabel, value: printedChange(deltas.find(delta => delta.key === key)) }] : []),
        ...(drawn.median || drawn.delta ? [
          { key: 'population', label: chartString(ctx.request.options, 'medianPopulation'), value: textValue(data.comparison.population) },
          { key: 'window', label: chartString(ctx.request.options, 'medianWindow'), value: textValue(`${data.comparison.startDate} to ${data.comparison.endDate}`) },
        ] : []),
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
