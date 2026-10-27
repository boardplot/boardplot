/** Histogram registration (distribution of one measure). */

import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import type { HistogramData, HistogramDerived, HistogramMarks, HistogramOptions } from './types';
import { histogramCore } from './core';
import { histogramDataSchema, histogramOptionsSchema } from './schema';

export { histogramDataSchema, histogramOptionsSchema };

export const histogramDefinition: ChartDefinition<
  HistogramData,
  HistogramOptions,
  HistogramMarks,
  HistogramDerived
> = {
  ...histogramCore,
  discovery: {
    notFor: 'Binned counts or categorical values; histogram bins raw numeric observations.',
    example: {
      data: { observations: [2, 3, 3, 4, 4, 5, 6, 7, 8, 9, 10, 12] },
      options: {
        unit: 'days',
        bins: { width: 2.5, anchor: 2 },
        title: 'Delivery times range from 2 to 12 days',
        source: 'Illustrative data',
      },
    },
  },
  normalize: (raw) => parseData(histogramDataSchema, raw),
  dataSchema: histogramDataSchema,
  optionsSchema: histogramOptionsSchema,
};
