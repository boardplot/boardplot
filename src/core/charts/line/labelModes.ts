/**
 * A line chart makes two label choices. `seriesLabels` says where the series
 * names print, `valueLabels` which point values print.
 */

import type { Id } from '../../types/cell';
import type { LabelContent, LineOptions, SeriesLabelMode, ValueLabelMode } from '../../types/options';

export interface LineLabelModes {
  /** Where the names print, before the key-row fallback for unnamed series. */
  series: SeriesLabelMode;
  values: ValueLabelMode;
  /** The series `{ only }` names; the others carry no name and no value. */
  only?: ReadonlySet<Id>;
  /** The value parts of a labels.series content list: the default content of the printed values. */
  seriesValueContent?: LabelContent;
}

type LabelOptions = Pick<LineOptions, 'seriesLabels' | 'valueLabels' | 'labels' | 'legend'>;

export function lineLabelModes(
  options: LabelOptions,
  variant: 'line' | 'area' | 'stacked-area' | 'stacked100-area' | 'bump',
  drawnSeries: number,
): LineLabelModes {
  const authored = options.seriesLabels;
  const only = typeof authored === 'object' && authored !== null ? authored.only : undefined;
  const seriesSetting = options.labels === false ? false : options.labels?.series;
  const content = Array.isArray(seriesSetting) ? seriesSetting : undefined;
  const valueParts = content?.filter((part) => part !== 'series');
  // labels: false and labels.series: false turn the names off, whatever mode asks for them.
  const series: SeriesLabelMode = seriesSetting === false
    ? 'none'
    : typeof authored === 'string'
      ? authored
      : content !== undefined && !content.includes('series')
        ? 'none'
        // A lone area carries no name either; the title names it.
        : only !== undefined || content !== undefined || !((variant === 'line' || variant === 'area') && drawnSeries === 1) ? 'end' : 'none';
  // Line values default to the last value, names on the lines included, so
  // the chart prints a number and not only names. A filled area reads its
  // start, its AC/FC split and its end, as stacked100-area reads its ends.
  const values: ValueLabelMode = options.valueLabels
    ?? (valueParts?.length === 0 ? 'none' : variant === 'bump' ? 'none' : variant === 'stacked100-area' || variant === 'area' ? 'ends' : 'last');
  return {
    series,
    values,
    ...(only !== undefined && series === 'end' ? { only: new Set(only) } : {}),
    ...(valueParts !== undefined && valueParts.length > 0 ? { seriesValueContent: valueParts } : {}),
  };
}
