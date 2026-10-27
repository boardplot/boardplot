import { withEventsDescribed } from '../../eventReading';
import { prepareFractionData } from '../../normalize/fraction';
import { calendarCategories } from '../../calendarLabels';
import { chartSizing } from '../../sizing';
/** Zod-free combo chart registration. */

import type { ChartCore } from '../../registry';
import type { ChartData } from '../../types/data';
import type { BaseOptions, ComboOptions } from '../../types/options';
import { layoutCombo, type ComboDerived, type ComboMarks } from './layout';

export const comboCore: ChartCore<ChartData, BaseOptions, ComboMarks, ComboDerived> = {
  type: 'combo',
  sizing: chartSizing('combo'),
  title: 'Combo',
  summary: 'Stacked columns with line/area overlays; gated, tick-synced secondary axis',
  layout: (data, options) => withEventsDescribed(layoutCombo(prepareFractionData(data), options as ComboOptions | undefined), options),
  categoryLabels: (categories, language) => calendarCategories(categories, language, true),
  prepare: prepareFractionData,
  defaults: {},
  annotationKinds: ['cagr', 'diff', 'delta', 'note', 'callout', 'valueLine', 'abs', 'event', 'band']
};
