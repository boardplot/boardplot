/**
 * The first refusals of bar variants 'tornado' and 'football-field'. A caller without the
 * interval code, such as a column that steps to bars, refuses here as the full layout would.
 */

import { NormalizeError } from '../../normalize/shared';
import { chartString } from '../../strings/bar';
import type { ChartData } from '../../types/data';
import type { BarOptions } from '../../types/options';

export type RowIntervalMode = 'football-field' | 'tornado';

/** The data-role series of a tornado (two cases) or a football field (one), or the refusal. */
export function intervalSeries(data: ChartData, mode: RowIntervalMode): ChartData['series'] {
  const tornado = mode === 'tornado';
  if (!data || !Array.isArray(data.categories) || data.categories.length === 0) {
    throw new NormalizeError('empty-data', 'categories', tornado ? 'tornado requires at least one driver' : 'football-field requires at least one method', undefined, undefined, ['data', 'categories']);
  }
  if (!Array.isArray(data.series) || data.series.length === 0) {
    throw new NormalizeError('empty-data', 'series', tornado ? 'tornado requires two case series' : 'football-field requires one data series', undefined, undefined, ['data', 'series']);
  }
  const series = data.series.filter((s) => (s.role ?? 'data') === 'data');
  if (series.length !== (tornado ? 2 : 1)) {
    throw new NormalizeError(
      tornado ? 'tornado-two-series' : 'football-field-one-series',
      'series',
      tornado
        ? `tornado requires exactly two data-role series (the low-input case and the high-input case), got ${series.length}`
        : `football-field requires exactly one data-role series, got ${series.length}`,
      undefined, undefined, ['data', 'series'],
    );
  }
  return series;
}

export function tornadoBaseRequired(): NormalizeError {
  return new NormalizeError(
    'tornado-base-required',
    'options.baseValue',
    'tornado requires options.baseValue: the output metric computed with every driver at its base input', undefined, undefined, ['options', 'baseValue'],
  );
}

/** No method of the football field has a range; `first` is the first method's index. */
export function footballRangeRequired(data: ChartData, options: BarOptions, series: ChartData['series'][number], first: number): NormalizeError {
  return new NormalizeError(
    'football-field-range-required',
    `series[${series.id}].values[${first}].range`,
    chartString(options, 'footballRangeRequired'),
    chartString(options, 'footballRangeSuggest'),
    undefined, ['data', 'series', data.series.indexOf(series), 'values'],
  );
}

/**
 * A tornado or a football field without the interval code. Such a caller's request has no baseValue and no
 * range cell, so the interval layout would refuse it with exactly these errors.
 */
export function refuseRowIntervals(data: ChartData, options: BarOptions, mode: RowIntervalMode): never {
  const series = intervalSeries(data, mode);
  throw mode === 'tornado' ? tornadoBaseRequired() : footballRangeRequired(data, options, series[0]!, 0);
}
