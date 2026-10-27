import { withEventsDescribed } from '../../eventReading';
import { prepareFractionData } from '../../normalize/fraction';
import { calendarCategories } from '../../calendarLabels';
import { chartSizing } from '../../sizing';
/** Zod-free line chart registration. */

import type { ChartCore } from '../../registry';
import type { LineChartData } from '../../types/data';
import { layoutLine, type LineDerived, type LineMarks } from './layout';
import { lowerLineX } from './continuous';
import type { LineOptions } from './types';

export const lineCore: ChartCore<LineChartData, LineOptions, LineMarks, LineDerived> = {
  type: 'line',
  sizing: chartSizing('line'),
  title: 'Line / area',
  summary:
    'Time-series lines and areas: step interpolation, gap fills, target markers, event context, AC→FC dashing, stacked and 100% variants',
  aliases: ['profile'],
  layout: (data, options) => withEventsDescribed(layoutLine(prepareFractionData(lowerLineX(data, options)), options), options),
  categoryLabels: (categories, language) => calendarCategories(categories, language, true),
  // Without options (schema normalisation) data.x stays as authored; the request and the layout lower it.
  prepare: (data, options) => prepareFractionData(options ? lowerLineX(data, options) : data),
  defaults: { variant: 'line' },
  annotationKinds: ['cagr', 'diff', 'delta', 'note', 'callout', 'valueLine', 'indicator100', 'abs', 'event', 'band']
};
