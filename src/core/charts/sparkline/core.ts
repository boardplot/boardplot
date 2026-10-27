import { prepareFractionData } from '../../normalize/fraction';
/** Zod-free sparkline chart registration. */

import { chartSizing } from '../../sizing';
import type { ChartCore } from '../../registry';
import type { SparklineData } from '../../types/data';
import type { SparklineOptions } from '../../types/options';
import { layoutSparkline, type SparklineDerived, type SparklineMarks } from './layout';

export const sparklineCore: ChartCore<SparklineData, SparklineOptions, SparklineMarks, SparklineDerived> = {
  type: 'sparkline',
  sizing: chartSizing('sparkline'),
  title: 'Sparkline',
  summary: 'One series as a 176 by 36 mini line — no axes, no smoothing, no fill, a ring on the last point',
  layout: (data, options) => layoutSparkline(prepareFractionData(data), options),
  prepare: prepareFractionData,
  defaults: {},
  annotationKinds: [],
};
