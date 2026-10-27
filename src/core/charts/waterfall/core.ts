import { chartSizing } from '../../sizing';
/** Zod-free waterfall chart registration. */

import type { ChartCore } from '../../registry';
import type { WaterfallData } from '../../types/data';
import type { WaterfallOptions } from '../../types/options';
import { layoutWaterfall, type WaterfallDerived, type WaterfallMarks } from './layout';

export const waterfallCore: ChartCore<
  WaterfallData,
  WaterfallOptions,
  WaterfallMarks,
  WaterfallDerived
> = {
  type: 'waterfall',
  sizing: chartSizing('waterfall'),
  title: 'Waterfall / bridge',
  summary: 'Contribution-to-change bridge with computed totals, connectors, and delta labels',
  aliases: ['bridge'],
  layout: layoutWaterfall,
  namesMustPrint: true,
  defaults: { build: 'up', variant: 'vertical' },
  annotationKinds: ['cagr', 'diff', 'delta', 'note', 'callout', 'valueLine', 'abs']
};
