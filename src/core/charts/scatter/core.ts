import { chartSizing } from '../../sizing';
/** Zod-free scatter chart registration. */

import type { ChartCore } from '../../registry';
import type { ScatterData } from '../../types/data';
import { layoutScatter, type ScatterDerived, type ScatterMarks } from './layout';
import type { ScatterStrategyOptions } from './types';

export const scatterCore: ChartCore<
  ScatterData,
  ScatterStrategyOptions,
  ScatterMarks,
  ScatterDerived
> = {
  type: 'scatter',
  sizing: chartSizing('scatter'),
  title: 'Scatter / bubble',
  summary: 'XY point cloud with group colors, spiral point labels, and area-true bubbles',
  aliases: ['bubble'],
  layout: layoutScatter,
  defaults: { sizeBy: 'area', maxPointLabels: 300 },
  annotationKinds: ['diff', 'delta', 'abs', 'note', 'callout', 'valueLine']
};
