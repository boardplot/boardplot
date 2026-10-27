import { prepareFractionData } from '../../normalize/fraction';
import { calendarCategories } from '../../calendarLabels';
import { chartSizing } from '../../sizing';
/** Zod-free pie chart registration. */

import type { ChartCore } from '../../registry';
import type { ChartData } from '../../types/data';
import type { PieOptions } from '../../types/options';
import type { LintWarning } from '../../types/scene';
import { DEFAULT_REST_MIN, DEFAULT_TOP_N, PIE_SLICE_LIMIT, layoutPie, type PieDerived, type PieMarks } from './layout';

export const pieCore: ChartCore<ChartData, PieOptions, PieMarks, PieDerived> = {
  type: 'pie',
  sizing: chartSizing('pie'),
  title: 'Pie / doughnut',
  summary:
    'Share-of-total slices with inside/outside label cascade, doughnut center total, explode',
  aliases: ['doughnut', 'donut'],
  layout: (data, options) => layoutPie(prepareFractionData(data), options),
  categoryLabels: calendarCategories,
  prepare: prepareFractionData,
  defaults: {},
  annotationKinds: ['cagr', 'diff', 'note', 'callout', 'delta', 'abs'],
  lint: (data, options): LintWarning[] => {
    const warnings: LintWarning[] = [];
    const n = data.categories.length;
    const topN = options.topN ?? DEFAULT_TOP_N;
    const merges = options.topN !== undefined || n - topN.n >= DEFAULT_REST_MIN;
    const effective = topN.n > 0 && merges ? Math.min(n, topN.n + (topN.rest === false ? 0 : 1)) : n;
    if (effective > PIE_SLICE_LIMIT) {
      warnings.push({
        code: 'pie-too-many-slices',
        severity: 'warn',
        message: `${effective} slices exceed the ${PIE_SLICE_LIMIT}-slice readability limit`,
        suggest: 'aggregate with topN: { n: 7, rest: true } or switch to a bar chart',
      });
    }
    if (data.series.length > 1) {
      warnings.push({
        code: 'pie-single-series',
        severity: 'warn',
        message: `pie plots exactly one series — ${data.series.length} supplied, first wins`,
        suggest: 'use one series per pie, or a column/bar chart for multi-series comparison',
      });
    }
    return warnings;
  }
};
