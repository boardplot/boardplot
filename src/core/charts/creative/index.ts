import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import { creativeCore } from './core';
import { creativeDataSchema, creativeOptionsSchema } from './schema';
import type { CreativeData, CreativeOptions } from './types';
import type { CreativeDerived, CreativeMarks } from './layout';

export const creativeDefinition: ChartDefinition<CreativeData, CreativeOptions, CreativeMarks, CreativeDerived> = {
  ...creativeCore, dataSchema: creativeDataSchema, optionsSchema: creativeOptionsSchema,
  normalize: raw => parseData(creativeDataSchema, raw),
  discovery: { example: { options: { title: 'Creative review', source: 'Illustrative data' }, data: {
      id: 'example', media: { kind: 'placeholder', aspect: '4:5', alt: 'Creative media not supplied' },
      facts: { name: 'Example creative', format: 'Image', currency: 'EUR', spendToDate: null, launchDate: '2026-09-01', endDate: null, asOf: '2026-09-01' },
      comparison: { startDate: '2026-09-01', endDate: '2026-09-01', population: 'Account creatives active on this day' },
      metrics: Object.fromEntries(['ctr', 'cpa', 'roas', 'hookRate', 'holdRate', 'frequency'].map(key => [key, { value: null, accountMedian: null }])), observations: [],
    } },
  },
};
