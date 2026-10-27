import { chartSizing } from '../../sizing';
/** Zod-free box chart registration. */

import type { ChartCore } from '../../registry';
import { layoutBox } from './layout';
import type { BoxData, BoxDerived, BoxMarks, BoxOptions } from './types';

export const boxCore: ChartCore<BoxData, BoxOptions, BoxMarks, BoxDerived> = {
  type: 'box',
  sizing: chartSizing('box'),
  title: 'Box plot (distribution comparison)',
  summary:
    'Compares group distributions from raw observations — type-7 quartiles, a declared whisker rule, individually drawn outliers, and a mandatory per-group n',
  aliases: ['boxplot', 'box-and-whisker'],
  layout: layoutBox,
  defaults: {},
  annotationKinds: ['cagr', 'diff', 'delta']
};
