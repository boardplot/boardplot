import { CARD_MIN_WIDTH, chartSizing } from '../../sizing';
import { isMetricStackData, normalizeMetricStack, type MetricStackData } from './metricStack';
/** Zod-free grid chart registration. */

import type { ChartCore } from '../../registry';
import { gridRequiredKey } from '../../grid/gridKey';
import { compactStacks, layoutGrid, type GridDerived, type GridMarks } from './layout';
import {
  normalizeGridData,
  type ExplicitGridData,
  type GridInput,
  type GridLayoutOptions
} from './normalize';

// Keep stack preparation in the lazy grid core, outside shared a11y imports.
function normalizeGridInput(raw: unknown): ExplicitGridData | MetricStackData {
  return isMetricStackData(raw) ? normalizeMetricStack(raw) : normalizeGridData(raw);
}

export const gridCore: ChartCore<GridInput, GridLayoutOptions, GridMarks, GridDerived> = {
  type: 'grid',
  sizing: { ...chartSizing('grid'), minWidth: CARD_MIN_WIDTH },
  title: 'Grid / multi-tier',
  summary: 'Facets, variance tiers and metric stacks with shared categories and computed readouts',
  aliases: ['facets'],
  layout: layoutGrid,
  defaults: {},
  annotationKinds: [],
  prepare: normalizeGridInput,
  requiredKey: gridRequiredKey,
  compactForm: compactStacks
};
