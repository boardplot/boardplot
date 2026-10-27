import { currencyWholeNumbers } from '../format';
import type { InteractionValue } from './types';
import { creativeRecords } from './creativeRecords';
import { businessRecords } from './businessRecords';
import { categoryRecords } from './categoryRecords';
import { eventRecords } from './eventRecords';
import { valueLineRecords } from './valueLineRecords';
import { categoryVariantRecords } from './categoryVariants';
import { statisticsRecords } from './statisticsRecords';
import { structuralRecords } from './structuralRecords';
import { withExhibitPercentFormat, type RecordContext } from './recordsShared';
import type { InteractionRecord } from './types';
import { localizedRecordReason } from '../strings/reasons';
import { withLocaleStrings } from '../strings';
import { withSmallValues } from '../formatPrecision';
import { pushAll } from '../arrays';

/** Pure extraction from the request and its accepted geometry; never lays out. */
export function interactionRecords(context: RecordContext): InteractionRecord[] {
  // Record text is formatted after layout: it follows the chart's smallValues mode as the drawn labels do.
  return withSmallValues(context.request.options.smallValues, () => recordsOf(context));
}

function recordsOf(context: RecordContext): InteractionRecord[] {
  // Records name things in the words the chart drew: the same locale fill as the registry.
  const ctx: RecordContext = { ...context, request: { ...context.request, options: withLocaleStrings(context.request.options) } };
  const records = categoryVariantRecords(ctx) ?? categoryRecords(ctx) ?? businessRecords(ctx)
    ?? creativeRecords(ctx) ?? statisticsRecords(ctx) ?? structuralRecords(ctx, interactionRecords);
  if (!records) throw new Error(`No interaction record adapter for chart type '${ctx.request.type}'`);
  // A grid's events and value lines are already in its panels' records (panel-scoped); its aggregated annotations would repeat them.
  if (ctx.request.type !== 'grid') {
    pushAll(records, eventRecords(ctx));
    pushAll(records, valueLineRecords(ctx));
  }
  const target = ctx.request.options.target;
  const currency = (value: InteractionValue): InteractionValue => {
    if (value.reason) value = { ...value, reason: localizedRecordReason(value.reason, ctx.request.locale?.language) };
    return !value.format && currencyWholeNumbers(value.unit, target) ? { ...value, renderTarget: target } : value;
  };
  for (const record of records) {
    record.value = currency(record.value);
    record.fields = record.fields.map(field => ({ ...field, value: currency(field.value) }));
    record.comparisons = record.comparisons.map(comparison => ({ ...comparison,
      current: currency(comparison.current), reference: currency(comparison.reference), delta: currency(comparison.delta),
    }));
    if (record.share) record.share = { ...record.share,
      numerator: currency(record.share.numerator), denominator: currency(record.share.denominator),
    };
  }
  return withExhibitPercentFormat(records, ctx.geometry.scene);
}
