import { prepareFractionData } from '../../normalize/fraction';
import { calendarCategories } from '../../calendarLabels';
import { chartSizing } from '../../sizing';
/** Zod-free heatmap chart registration. */

import type { ChartCore } from '../../registry';
import type { HeatmapData } from '../../types/data';
import type { HeatmapOptions } from '../../types/options';
import { yieldingWidths } from './columnTracks';
import { layoutHeatmap, type HeatmapDerived, type HeatmapMarks } from './layout';

export const heatmapCore: ChartCore<HeatmapData, HeatmapOptions, HeatmapMarks, HeatmapDerived> = {
  type: 'heatmap',
  sizing: chartSizing('heatmap'),
  title: 'Heatmap / matrix',
  summary: 'Row × column matrix — continuous or discrete color scale, in-cell values or Harvey balls',
  aliases: ['matrix'],
  layout: yieldingWidths('heatmap', (data: HeatmapData, options?: HeatmapOptions) => layoutHeatmap(prepareFractionData(data), options), (data) => data.categories.length + 1),
  categoryLabels: calendarCategories,
  prepare: prepareFractionData,
  defaults: { scale: 'continuous', variant: 'value' },
  annotationKinds: ['cagr', 'diff', 'callout', 'note', 'delta', 'abs']
};
