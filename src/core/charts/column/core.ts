import { withEventsDescribed } from '../../eventReading';
import { prepareFractionData } from '../../normalize/fraction';
import { calendarCategories } from '../../calendarLabels';
import { chartSizing } from '../../sizing';
/** Zod-free column chart registration. */

import { prepareRangeData } from '../../rangeRules';
import type { ChartCore } from '../../registry';
import type { ChartData } from '../../types/data';
import type { ColumnOptions } from '../../types/options';
import { layoutColumn, type ColumnDerived, type ColumnMarks } from './layout';

export const columnCore: ChartCore<
  ChartData,
  ColumnOptions,
  ColumnMarks,
  ColumnDerived
> = {
  type: 'column',
  sizing: chartSizing('column'),
  title: 'Column',
  summary:
    'Grouped, stacked, or 100%-stacked vertical bars; stacked columns can integrate an external PY tick and derived growth',
  layout: (data, options) => withEventsDescribed(layoutColumn(prepareFractionData(data), options), options),
  categoryLabels: (categories, language) => calendarCategories(categories, language, true),
  defaults: { variant: 'grouped', referenceStyle: 'tick' },
  annotationKinds: ['cagr', 'diff', 'delta', 'note', 'callout', 'valueLine', 'indicator100', 'abs', 'event', 'band'],
  prepare: prepareRangeData
};
