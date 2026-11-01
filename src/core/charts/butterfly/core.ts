import { prepareFractionData } from '../../normalize/fraction';
import { calendarCategories } from '../../calendarLabels';
import { chartSizing } from '../../sizing';
/** Zod-free butterfly chart registration. */

import type { ChartCore } from '../../registry';
import type { ChartData } from '../../types/data';
import type { ButterflyOptions } from '../../types/options';
import { layoutButterfly, type ButterflyDerived, type ButterflyMarks } from './layout';

export const butterflyCore: ChartCore<
  ChartData,
  ButterflyOptions,
  ButterflyMarks,
  ButterflyDerived
> = {
  type: 'butterfly',
  sizing: chartSizing('butterfly'),
  title: 'Butterfly / tornado',
  summary: 'Two mirrored horizontal panes around a shared center category column',
  layout: (data, options) => layoutButterfly(prepareFractionData(data), options),
  categoryLabels: calendarCategories,
  prepare: prepareFractionData,
  defaults: { sortBy: 'sheet', sharedScale: true, negatives: 'direction' },
  annotationKinds: ['cagr', 'delta', 'diff', 'note', 'callout', 'abs']
};
