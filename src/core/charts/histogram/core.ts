import { chartSizing } from '../../sizing';
/** Zod-free histogram chart registration. */

import type { ChartCore } from '../../registry';
import { layoutHistogram } from './layout';
import type { HistogramData, HistogramDerived, HistogramMarks, HistogramOptions } from './types';

export const histogramCore: ChartCore<
  HistogramData,
  HistogramOptions,
  HistogramMarks,
  HistogramDerived
> = {
  type: 'histogram',
  sizing: chartSizing('histogram'),
  title: 'Histogram (distribution of one measure)',
  summary:
    'Groups raw observations into equal-width bins and displays their frequencies',
  aliases: ['distribution', 'frequency'],
  layout: layoutHistogram,
  defaults: {},
  annotationKinds: []
};
