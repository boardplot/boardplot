import { prepareFractionData } from '../../normalize/fraction';
import { calendarCategories } from '../../calendarLabels';
import { chartSizing } from '../../sizing';
/** Zod-free bar chart registration. */

import { prepareRangeData } from '../../rangeRules';
import type { ChartCore } from '../../registry';
import type { ChartData } from '../../types/data';
import { layoutBar, type BarDerived, type BarMarks } from './layout';
import type { BarOptions } from '../../types/options';

export const barCore: ChartCore<ChartData, BarOptions, BarMarks, BarDerived> = {
  type: 'bar',
  sizing: chartSizing('bar'),
  title: 'Bar (horizontal)',
  summary: 'Horizontal item comparison — grouped, stacked, or 100%-stacked rows with direct labels',
  layout: (data, options) => layoutBar(prepareFractionData(data), options),
  categoryLabels: calendarCategories,
  defaults: { variant: 'grouped', referenceStyle: 'tick' },
  annotationKinds: ['valueLine', 'indicator100', 'callout', 'note', 'delta', 'abs', 'diff', 'band', 'cagr'],
  prepare: prepareRangeData
};
