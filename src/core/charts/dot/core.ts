import { prepareFractionData } from '../../normalize/fraction';
import { calendarCategories } from '../../calendarLabels';
import { chartSizing } from '../../sizing';
/** Zod-free dot chart registration. */

import { prepareRangeData } from '../../rangeRules';
import type { ChartCore } from '../../registry';
import type { ChartData } from '../../types/data';
import type { DotOptions } from '../../types/options';
import { layoutDot, type DotDerived, type DotMarks } from './layout';

export const dotCore: ChartCore<ChartData, DotOptions, DotMarks, DotDerived> = {
  type: 'dot',
  sizing: chartSizing('dot'),
  title: 'Dot / dumbbell / lollipop',
  summary:
    'Position-encoded item comparison — Cleveland dots, dumbbell ranges with derived gaps, or lollipops',
  aliases: ['cleveland', 'dumbbell', 'lollipop'],
  aliasDefaults: { dumbbell: { variant: 'dumbbell' }, lollipop: { variant: 'lollipop' } },
  layout: (data, options) => layoutDot(prepareFractionData(data), options),
  categoryLabels: calendarCategories,
  defaults: { variant: 'dot' },
  annotationKinds: ['valueLine', 'callout', 'note', 'delta', 'abs', 'diff', 'cagr'],
  prepare: prepareRangeData
};
