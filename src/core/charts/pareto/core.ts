import { chartSizing } from '../../sizing';
/** Zod-free pareto chart registration. */

import type { ChartCore } from '../../registry';
import type { ParetoOptions } from '../../types/options';
import { layoutPareto, type ParetoData, type ParetoDerived, type ParetoMarks } from './layout';

export const paretoCore: ChartCore<
  ParetoData,
  ParetoOptions,
  ParetoMarks,
  ParetoDerived
> = {
  type: 'pareto',
  sizing: chartSizing('pareto'),
  title: 'Pareto (vital few)',
  summary:
    'Sorted columns plus a derived cumulative curve whose 100% is the grand total; the vital few reaching a stated threshold are highlighted, and a flat distribution says so instead of implying concentration',
  aliases: ['pareto-chart'],
  layout: layoutPareto,
  defaults: { threshold: 80, cumulative: true, methodNote: false },
  annotationKinds: ['note', 'callout', 'cagr', 'diff', 'delta']
};
