/** Zod-free waffle chart registration. */

import type { ChartCore } from '../../registry';
import { prepareFractionData } from '../../normalize/fraction';
import type { ChartData } from '../../types/data';
import { layoutWaffle } from './layout';
import { WAFFLE_SIZING } from './sizing';
import type { WaffleDerived, WaffleMarks, WaffleOptions } from './types';

export const waffleCore: ChartCore<ChartData, WaffleOptions, WaffleMarks, WaffleDerived> = {
  type: 'waffle',
  sizing: WAFFLE_SIZING,
  title: 'Waffle',
  summary: 'Share of a whole as a grid of square cells, one panel per category: label, headline total and whole-cell segments (largest-remainder rounding), filled from the bottom left',
  layout: (data, options) => layoutWaffle(prepareFractionData(data), options),
  prepare: prepareFractionData,
  defaults: { grid: { rows: 10, columns: 10 }, fillFrom: 'bottom' },
  annotationKinds: [],
};
