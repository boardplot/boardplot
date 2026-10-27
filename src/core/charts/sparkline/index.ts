/** Sparkline chart registration, and the geometry its hosts share. */

import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import type { SparklineData } from '../../types/data';
import type { SparklineOptions } from '../../types/options';
import type { SparklineDerived, SparklineMarks } from './layout';
import { sparklineCore } from './core';
import { sparklineDataSchema, sparklineOptionsSchema } from './schema';

export { sparklineDataSchema, sparklineOptionsSchema };

export const sparklineDefinition: ChartDefinition<SparklineData, SparklineOptions, SparklineMarks, SparklineDerived> = {
  ...sparklineCore,
  discovery: {
    example: {
      data: {
        values: [112, 114.2, 113.1, 116.8, 118.4],
        labels: ['May', 'Jun', 'Jul', 'Aug', 'Sep'],
      },
      options: { format: '1.1', title: 'Orders climb through the summer', source: 'Illustrative data' },
    },
    notFor: 'A chart a reader takes numbers off; a sparkline states a shape and nothing else.',
  },
  normalize: (raw) => sparklineCore.prepare!(parseData(sparklineDataSchema, raw)),
  dataSchema: sparklineDataSchema,
  optionsSchema: sparklineOptionsSchema,
};
