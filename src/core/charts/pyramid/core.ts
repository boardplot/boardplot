import { chartSizing } from '../../sizing';
/** Zod-free pyramid chart registration. */

import type { ChartCore } from '../../registry';
import { layoutPyramid, type PyramidMarks } from './layout';
import type { PyramidData, PyramidDerived, PyramidOptions } from './types';

export const pyramidCore: ChartCore<
  PyramidData,
  PyramidOptions,
  PyramidMarks,
  PyramidDerived
> = {
  type: 'pyramid',
  sizing: chartSizing('pyramid'),
  title: 'Population pyramid',
  summary:
    'Mirrored ordered bands on one shared scale: band geometry is validated for equal width and contiguity, and the youngest band is rendered at the bottom no matter which way the data was authored',
  aliases: ['age-pyramid', 'population-pyramid'],
  layout: layoutPyramid,
  defaults: { basis: 'count' },
  annotationKinds: ['cagr', 'diff', 'delta', 'note', 'callout']
};
