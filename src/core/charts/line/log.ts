import { NormalizeError } from '../../normalize/shared';
import type { JsonPatchOperation } from '../../diagnostics/jsonPatch';
import type { Category, LineChartData } from '../../types/data';
import type { NormSer } from './context';
import { dropLog, nonpositive, nonpositiveAnnotation, validateLogBounds, validateLogSeriesValues, validateLogValueLine } from '../logAxis';
import { lineMeans } from './means';
import type { LineOptions } from './types';

function conflict(path: string, reason: string, fix: JsonPatchOperation[] = dropLog): never {
  throw new NormalizeError('log-line-conflict', path, reason, 'remove valueAxis.log or the incompatible option', fix, path.split('.'));
}

/** Check source positions before a continuous x axis sorts the readings. */
export function validateLineLogSource(options: LineOptions, data: LineChartData): void {
  if ((options.valueAxis?.log !== true && options.valueAxis?.log !== 'y') || !Array.isArray(data?.series)) return;
  validateLogSeriesValues(data.series);
}

/** Refuse values and options that cannot be drawn on the vertical log axis. */
export function validateLineLog(options: LineOptions, series: NormSer[]): void {
  const va = options.valueAxis;
  if (!va?.log) return;
  if (va.log === 'x' || va.log === 'both') {
    conflict('options.valueAxis.log', 'line has no numeric horizontal log axis; only the vertical value axis can use a log scale',
      [{ op: 'replace', path: '/options/valueAxis/log', value: 'y' }]);
  }
  if (options.variant && options.variant !== 'line') {
    conflict('options.variant', `variant '${options.variant}' uses zero-based areas, stack sums or ranks, which cannot be drawn exactly on this log axis`);
  }
  if (va.percent) conflict('options.valueAxis.percent', 'valueAxis.percent turns the line into a 100% stacked area, which needs a zero baseline');
  if (options.trend) conflict('options.trend', 'a fitted straight trend in data units bends on a log axis');
  if (options.phases) conflict('options.phases', 'phases fill the area under a line and require a zero baseline');
  validateLogBounds(va);
  series.forEach((s, si) => {
    s.vals.forEach((cell, ci) => {
      if (cell.v !== null && cell.v <= 0) nonpositive(['data', 'series', si, 'values', ci], cell.v);
    });
    s.targets.forEach((target, ti) => {
      if (target.value <= 0) nonpositive(['data', 'series', si, 'targets', ti, 'value'], target.value);
    });
  });
  options.targets?.forEach((target, i) => {
    if (target.value <= 0) nonpositive(['options', 'targets', i, 'value'], target.value);
  });
  options.referenceBands?.forEach((band, i) => {
    for (const key of ['value', 'low', 'high'] as const) {
      const value = band[key];
      if (value !== undefined && value <= 0) nonpositive(['options', 'referenceBands', i, key], value);
    }
  });
  options.annotations?.forEach((ann, i) => {
    if (ann.kind === 'valueLine') validateLogValueLine(ann, i);
    if (ann.kind === 'band' && (ann.style === 'corridor' || ann.style === 'tolerance' || ann.style === 'attainment')) {
      for (const key of ['value', 'low', 'high'] as const) {
        const value = ann[key];
        if (value !== undefined && value <= 0) nonpositiveAnnotation(ann, i, [key], value);
      }
    }
  });
}

/** Resolve mean tolerance bands over the same visible data as the annotation. */
export function validateLogTolerances(options: LineOptions, series: NormSer[], cats: Category[],
  pv: (number | null)[][], rowOf: Map<NormSer, number>, ownUnits: boolean, sourceAnnotations: LineOptions['annotations']): void {
  if (!options.valueAxis?.log) return;
  const { meanValue, meanValueFor } = lineMeans(pv, rowOf, series, cats, ownUnits);
  options.annotations?.forEach((ann, i) => {
    if (ann.kind !== 'valueLine' || typeof ann.tolerance !== 'number') return;
    const scope = ann.seriesId !== undefined || ann.from !== undefined || ann.to !== undefined
      ? meanValueFor({ seriesId: ann.seriesId, from: ann.from as string | undefined, to: ann.to as string | undefined })
      : undefined;
    const value = typeof ann.value === 'number' ? ann.value : scope && 'value' in scope ? scope.value : meanValue;
    const sourceIndex = sourceAnnotations?.indexOf(ann) ?? i;
    if (value !== undefined && value - ann.tolerance <= 0) nonpositiveAnnotation(ann, sourceIndex < 0 ? i : sourceIndex, ['tolerance'], value - ann.tolerance);
  });
}
