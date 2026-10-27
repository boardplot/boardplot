import { prepareFractionData } from '../../normalize/fraction';
import { calendarCategories } from '../../calendarLabels';
import { chartSizing } from '../../sizing';
/** Zod-free mekko chart registration. */

import type { ChartCore } from '../../registry';
import type { ChartData } from '../../types/data';
import type { MekkoOptions } from '../../types/options';
import { layoutMekko, type MekkoDerived, type MekkoMarks } from './layout';

export const mekkoCore: ChartCore<
  ChartData,
  MekkoOptions,
  MekkoMarks,
  MekkoDerived
> = {
  type: 'mekko',
  sizing: chartSizing('mekko'),
  title: 'Mekko / Marimekko',
  summary:
    'Variable-width marimekko: stacked100 or stacked columns, plus bar-mekko profit pools (alias bar-mekko draws variant:\'bar\')',
  aliases: ['marimekko', 'bar-mekko'],
  aliasDefaults: { 'bar-mekko': { variant: 'bar' } },
  layout: (data, options) => layoutMekko(prepareFractionData(data), options),
  categoryLabels: calendarCategories,
  prepare: prepareFractionData,
  defaults: { variant: 'stacked100' },
  annotationKinds: ['cagr', 'diff', 'delta', 'note', 'callout', 'valueLine', 'indicator100', 'abs']
};
