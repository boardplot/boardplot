import { NormalizeError } from '../../normalize/shared';
import type { JsonPatchOperation } from '../../diagnostics/jsonPatch';
import type { Category, LineChartData } from '../../types/data';
import type { NormSer } from './context';
import { lineMeans } from './means';
import type { LineOptions } from './types';

const dropLog = [{ op: 'remove' as const, path: '/options/valueAxis/log' }];

function conflict(path: string, reason: string, fix: JsonPatchOperation[] = dropLog): never {
  throw new NormalizeError('log-line-conflict', path, reason, 'remove valueAxis.log or the incompatible option', fix, path.split('.'));
}

function nonpositive(path: (string | number)[], value: number | string): never {
  const name = path.map((part, index) => typeof part === 'number' ? `[${part}]` : `${index ? '.' : ''}${part}`).join('');
  throw new NormalizeError('log-nonpositive', name,
    `${name} is ${value}; a log scale has no place for zero or a negative value`,
    'use a value above zero or remove valueAxis.log', dropLog, path);
}

function annotationPath(index: number): (string | number)[] {
  return ['options', 'annotations', index];
}

/** Check source positions before a continuous x axis sorts the readings. */
export function validateLineLogSource(options: LineOptions, data: LineChartData): void {
  if ((options.valueAxis?.log !== true && options.valueAxis?.log !== 'y') || !Array.isArray(data?.series)) return;
  data.series.forEach((series, si) => {
    if (!Array.isArray(series.values)) return;
    series.values.forEach((raw, ci) => {
      const keyed = raw !== null && typeof raw === 'object' && 'categoryId' in raw && 'value' in raw;
      const cell = keyed ? raw.value : raw;
      const value = typeof cell === 'number' ? cell : cell && typeof cell === 'object'
        ? ('number' in cell ? cell.number : 'pct' in cell ? cell.pct : undefined) : undefined;
      if (typeof value === 'number' && value <= 0) {
        nonpositive(['data', 'series', si, 'values', ci, ...(keyed ? ['value'] : [])], value);
      }
    });
  });
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
  for (const key of ['min', 'max'] as const) {
    const value = va[key];
    if (value !== undefined && value <= 0) nonpositive(['options', 'valueAxis', key], value);
  }
  if (va.includeZero) nonpositive(['options', 'valueAxis', 'includeZero'], 'true');
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
    const path = annotationPath(i);
    if (ann.kind === 'valueLine' && typeof ann.value === 'number' && ann.value <= 0) nonpositive([...path, 'value'], ann.value);
    if (ann.kind === 'band' && (ann.style === 'corridor' || ann.style === 'tolerance' || ann.style === 'attainment')) {
      for (const key of ['value', 'low', 'high'] as const) {
        const value = ann[key];
        if (value !== undefined && value <= 0) nonpositive([...path, key], value);
      }
    }
    if (ann.kind === 'valueLine' && typeof ann.tolerance === 'object') {
      for (const key of ['low', 'high'] as const) {
        if (ann.tolerance[key] <= 0) nonpositive([...path, 'tolerance', key], ann.tolerance[key]);
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
    if (value !== undefined && value - ann.tolerance <= 0) nonpositive([...annotationPath(sourceIndex < 0 ? i : sourceIndex), 'tolerance'], value - ann.tolerance);
  });
}
