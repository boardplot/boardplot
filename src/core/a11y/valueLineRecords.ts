import { chartString } from '../strings/a11y-valueLineRecords';
import { calendarNames } from '../calendarLabels';
import { normalizeCategory } from '../normalize/shared';
import type { Annotation } from '../types/annotations';
import type { ChartData } from '../types/data';
import { numericValue, targetId, textValue, type RecordContext } from './recordsShared';
import type { InteractionRecord } from './types';

/**
 * One record per drawn value line: its printed label as the heading, the
 * value it draws at, and for a measured mean what it measures. The hover card
 * reads it when the pointer rests on the line or its label; the data table
 * and the reading leave it out (it is no plotted value). A value line has no
 * anchor, so only a direct hit on its own nodes opens its card and a data
 * mark beside it keeps the pointer.
 */
export function valueLineRecords(ctx: RecordContext): InteractionRecord[] {
  const options = ctx.request.options;
  return ctx.geometry.annotations.flatMap((placed): InteractionRecord[] => {
    if (placed.kind !== 'valueLine') return [];
    const index = ctx.request.annotations.findIndex((annotation, at) => (annotation.id ?? `${annotation.kind}-${at + 1}`) === placed.id);
    const authored = ctx.request.annotations[index] as Extract<Annotation, { kind: 'valueLine' }> | undefined;
    const raw = placed.derivation?.raw ?? (typeof authored?.value === 'number' && authored.valueKind === undefined ? authored.value : null);
    // The line and its label only: a tolerance band or an attainment fill prints numbers of its own.
    const nodeIds = ctx.geometry.scene.filter(node => node.owner.annotationId === placed.id && node.part === 'valueLine').map(node => node.id);
    if (raw === null || nodeIds.length === 0) return [];
    const owner = { annotationId: placed.id };
    const target = { ...ctx.scope, owner };
    // The value reads as the label's own format prints it (the line's format, a
    // percent scale, the series' unit). A chart that keeps no such text gives
    // the plain number: the chart's unit could be the wrong one.
    const value = { ...numericValue(raw), ...(placed.valueText === undefined ? {} : { displayed: placed.valueText }),
      // Only a number the author typed reads exact; a mean the engine measured (an average marker too) is rounded.
      ...(typeof authored?.value === 'number' && authored.value === raw ? {} : { derived: 'number' as const }) };
    const measure = authored && placed.derivation?.basis === 'observed' ? measured(ctx, authored) : undefined;
    const band = tolerance(ctx, placed.toleranceText);
    return [{
      id: targetId(target), target, label: placed.computedText || chartString(options, 'valueLineName'),
      value, valueLabel: chartString(options, 'valueLineValue'),
      fields: [
        ...(measure ? [{ key: 'measure', label: chartString(options, 'valueLineMeasure'), value: textValue(measure) }] : []),
        ...(band ? [{ key: 'tolerance', label: chartString(options, 'valueLineTolerance'), value: textValue(band) }] : []),
      ],
      comparisons: [], annotations: [], claimIds: [], nodeIds,
    }];
  });
}

/** The bounds of a drawn tolerance band, in the band's own format: "15.0% to 25.0%". */
function tolerance(ctx: RecordContext, bounds: { low: string; high: string } | undefined): string | undefined {
  return bounds && chartString(ctx.request.options, 'valueLineRange', { v1: bounds.low, v2: bounds.high });
}

/** What a measured mean averages, in the words the axis uses: "Mean of Sales, Jan 2025 to Mar 2025". */
function measured(ctx: RecordContext, line: Extract<Annotation, { kind: 'valueLine' }>): string | undefined {
  if (line.seriesId === undefined && line.from === undefined) return undefined;
  const data = ctx.request.data as Partial<ChartData>;
  const series = data.series?.find(entry => entry.id === line.seriesId);
  const options = ctx.request.options;
  const base = series ? chartString(options, 'valueLineMeanOf', { v1: series.label ?? series.id }) : chartString(options, 'valueLineMean');
  if (line.from === undefined || line.to === undefined) return base;
  const categories = data.categories ?? [];
  const periods = ['line', 'column', 'combo'].includes(ctx.request.type) ? calendarNames(categories, ctx.request.locale?.language) : undefined;
  const name = (id: string) => {
    const index = categories.findIndex(category => (typeof category === 'string' ? category : category.id) === id);
    return index < 0 ? id : periods?.[index] ?? normalizeCategory(categories[index]!, index).label ?? id;
  };
  return chartString(options, 'valueLineSpan', { v1: base, v2: name(line.from), v3: name(line.to) });
}
