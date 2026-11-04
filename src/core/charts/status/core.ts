import { chartSizing } from '../../sizing';
/** Zod-free status chart registration. */

import type { ChartCore } from '../../registry';
import { yieldingWidths } from '../heatmap/columnTracks';
import {
  layoutStatus,
  lintStatus,
  type StatusData,
  type StatusDerived,
  type StatusMarks,
  type StatusOptions,
} from './layout';

export const statusCore: ChartCore<
  StatusData,
  StatusOptions,
  StatusMarks,
  StatusDerived
> = {
  type: 'status',
  sizing: chartSizing('status'),
  title: 'Categorical status matrix',
  summary:
    'Entity × period matrix with discrete semantic states, visible sparse cells, and truthful state keys',
  layout: layoutStatus,
  finishLayout: (layout) => yieldingWidths('status', layout, (data) => data.columns.map((column) => column.id)),
  defaults: { columnLabels: 'top' },
  annotationKinds: [],
  lint: lintStatus
};
