/** Likert diverging survey registration (agreement distribution). */

import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import type { LikertData, LikertDerived, LikertMarks, LikertOptions } from './layout';
import { likertCore } from './core';
import { likertDataSchema, likertOptionsSchema } from './schema';

export { likertDataSchema, likertOptionsSchema };

export const likertDefinition: ChartDefinition<
  LikertData,
  LikertOptions,
  LikertMarks,
  LikertDerived
> = {
  ...likertCore,
  discovery: {
    notFor: 'Unordered response categories; likert centres an ordered scale on its neutral point.',
    example: {
      data: {
        scale: [
          { id: 'disagree', label: 'Disagree' },
          { id: 'neutral', label: 'Neutral', role: 'neutral' },
          { id: 'agree', label: 'Agree' },
        ],
        items: [
          { id: 'service', label: 'Helpful service', values: [10, 20, 70] },
          { id: 'speed', label: 'Fast response', values: [20, 30, 50] },
        ],
      },
      options: {
        values: 'counts',
        unit: 'responses',
        title: 'Helpful service receives more agreement than fast response',
        source: 'Illustrative data',
      },
    },
  },
  normalize: (raw) => parseData(likertDataSchema, raw),
  dataSchema: likertDataSchema,
  optionsSchema: likertOptionsSchema,
};
