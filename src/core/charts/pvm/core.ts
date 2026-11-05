import { chartSizing } from '../../sizing';
/** Zod-free pvm chart registration. */

import type { ChartCore } from '../../registry';
import type { WaterfallMarks } from '../waterfall/layout';
import { layoutPvm } from './layout';
import type { PvmData, PvmDerived, PvmOptions } from './types';

export const pvmCore: ChartCore<PvmData, PvmOptions, WaterfallMarks, PvmDerived> = {
  type: 'pvm',
  sizing: chartSizing('pvm'),
  title: 'Price / volume / mix bridge',
  summary:
    'Derives the price, volume, mix, new, and lost decomposition of a revenue change from per-item units and revenue, and proves it reconciles exactly',
  aliases: ['price-volume-mix'],
  layout: layoutPvm,
  namesMustPrint: true,
  defaults: { interaction: 'in-price', volumeMix: 'split', netChange: true },
  annotationKinds: ['cagr', 'diff', 'delta', 'note', 'callout', 'valueLine', 'abs']
};
