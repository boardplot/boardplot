import { chartSizing } from '../../sizing';
/** Zod-free kpi chart registration. */

import type { ChartCore } from '../../registry';
import type { KpiData } from '../../types/data';
import type { KpiOptions } from '../../types/options';
import { layoutKpi, type KpiDerived, type KpiMarks } from './layout';

export const kpiCore: ChartCore<KpiData, KpiOptions, KpiMarks, KpiDerived> = {
  type: 'kpi',
  sizing: chartSizing('kpi'),
  title: 'KPI card',
  summary: 'Single-metric card: label, big value, up to two comparison pills, optional attainment, shape-only line/area/column sparkline with last observed value labelled',
  layout: layoutKpi,
  // comparisons has no default: omitted, a standalone card draws the steering
  // form (steering.ts) and a grid panel, a compact card or a card with a spark draws chips.
  defaults: { density: 'regular' },
  annotationKinds: []
};
