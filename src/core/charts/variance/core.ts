import { prepareFractionData } from '../../normalize/fraction';
import { calendarCategories } from '../../calendarLabels';
import { chartSizing } from '../../sizing';
/** Zod-free variance chart registration. */

import type { ChartCore } from '../../registry';
import type { ChartData } from '../../types/data';
import type { VarianceOptions } from '../../types/options';
import { layoutVariance, type VarianceDerived, type VarianceMarks } from './layout';

export const varianceCore: ChartCore<
  ChartData,
  VarianceOptions,
  VarianceMarks,
  VarianceDerived
> = {
  type: 'variance',
  sizing: chartSizing('variance'),
  title: 'Variance / deviation',
  summary:
    'Variance tier vs PY/PL/FC: Δ columns, Δ% pins, or integrated good/bad caps on actuals',
  aliases: ['deviation'],
  layout: (data, options) => layoutVariance(prepareFractionData(data), options),
  namesMustPrint: true,
  categoryLabels: calendarCategories,
  prepare: prepareFractionData,
  defaults: {},
  annotationKinds: ['cagr', 'diff', 'delta', 'abs', 'note', 'callout', 'valueLine']
};
