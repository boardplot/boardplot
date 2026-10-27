import { chartSizing } from '../../sizing';
/** Zod-free choropleth chart registration. */

import type { ChartCore } from '../../registry';
import type { BaseOptions } from '../../types/options';
import { layoutChoropleth } from './layout';
import type {
  ChoroplethData,
  ChoroplethDerived,
  ChoroplethMarks,
} from './types';

export const choroplethCore: ChartCore<ChoroplethData, BaseOptions, ChoroplethMarks, ChoroplethDerived> = {
  type: 'choropleth',
  sizing: chartSizing('choropleth'),
  title: 'Choropleth map',
  summary: 'Equal-area region map with deterministic pre-baked geometry and explicit missing-data traces',
  layout: layoutChoropleth as ChartCore<ChoroplethData, BaseOptions, ChoroplethMarks, ChoroplethDerived>['layout'],
  defaults: {
    scale: { kind: 'sequential' as const },
    labels: 'auto' as const,
  } as unknown as Partial<BaseOptions>,
  annotationKinds: []
};
