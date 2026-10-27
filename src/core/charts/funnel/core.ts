import { prepareFractionData } from '../../normalize/fraction';
import { calendarCategories } from '../../calendarLabels';
import { chartSizing } from '../../sizing';
/** Zod-free funnel chart registration. */

import type { ChartCore } from '../../registry';
import type { ChartData } from '../../types/data';
import type { FunnelOptions } from '../../types/options';
import { layoutFunnel, type FunnelDerived, type FunnelMarks } from './layout';

export const funnelCore: ChartCore<
  ChartData,
  FunnelOptions,
  FunnelMarks,
  FunnelDerived
> = {
  type: 'funnel',
  sizing: chartSizing('funnel'),
  title: 'Funnel / pipeline',
  summary:
    'Stage-flow funnel: stacked rows or an honest-width centered silhouette with derived conversion rates',
  layout: (data, options) => layoutFunnel(prepareFractionData(data), options),
  categoryLabels: calendarCategories,
  prepare: prepareFractionData,
  defaults: { worstDropCallout: false },
  annotationKinds: ['note', 'callout', 'delta', 'abs', 'diff', 'cagr']
};
