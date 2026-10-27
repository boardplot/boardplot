/** Population-pyramid registration (ordered mirrored bands). */

import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import type { PyramidMarks } from './layout';
import type { PyramidData, PyramidDerived, PyramidOptions } from './types';
import { pyramidCore } from './core';
import { pyramidDataSchema, pyramidOptionsSchema } from './schema';

export { pyramidDataSchema, pyramidOptionsSchema };

export const pyramidDefinition: ChartDefinition<
  PyramidData,
  PyramidOptions,
  PyramidMarks,
  PyramidDerived
> = {
  ...pyramidCore,
  discovery: {
    notFor: 'More than two groups or unordered bands; pyramid mirrors two groups over contiguous ordered bands.',
    example: {
      data: {
        bands: [
          { id: 'junior', from: 0, to: 5 },
          { id: 'senior', from: 5, to: 10 },
          { id: 'long', from: 10, to: 15 },
        ],
        groups: [
          { id: 'north', label: 'North', values: [40, 30, 20] },
          { id: 'south', label: 'South', values: [35, 25, 15] },
        ],
      },
      options: {
        title: 'North has more employees in every tenure band',
        unit: 'employees',
        source: 'Illustrative data',
      },
    },
  },
  normalize: (raw) => parseData(pyramidDataSchema, raw),
  dataSchema: pyramidDataSchema,
  optionsSchema: pyramidOptionsSchema,
};
