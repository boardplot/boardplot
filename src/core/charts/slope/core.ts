import { prepareFractionData } from '../../normalize/fraction';
import { calendarCategories } from '../../calendarLabels';
import { SLOPE_SIZING } from './slopeSizing';
/** Zod-free slope chart registration. */

import type { ChartCore } from '../../registry';
import type { ChartData } from '../../types/data';
import type { SlopeOptions } from '../../types/options';
import { layoutSlope, type SlopeDerived, type SlopeMarks } from './layout';

export const slopeCore: ChartCore<ChartData, SlopeOptions, SlopeMarks, SlopeDerived> = {
  type: 'slope',
  sizing: SLOPE_SIZING,
  title: 'Slope',
  summary: 'Two-point slope lines with collision-spread end labels and highlight emphasis. Each end label names its series and prints its value, so the line chart\'s seriesLabels and valueLabels are refused; labels.series sets the parts',
  layout: (data, options) => layoutSlope(prepareFractionData(data), options),
  categoryLabels: calendarCategories,
  prepare: prepareFractionData,
  defaults: {},
  annotationKinds: ['cagr', 'diff', 'delta', 'abs', 'note', 'callout', 'valueLine'],
  lint: (data) =>
    Array.isArray(data?.categories) && data.categories.length > 2
      ? [
        {
          code: 'slope-too-many-points',
          severity: 'error',
          message: `slope requires exactly 2 categories, got ${data.categories.length} — layout uses first and last only`,
          suggest: "use chart type 'line' for more than two time points",
        },
      ]
      : []
};
