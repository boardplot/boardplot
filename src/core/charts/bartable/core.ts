/** Zod-free bar table registration. */

import { calendarCategories } from '../../calendarLabels';
import type { ChartCore } from '../../registry';
import { chartSizing } from '../../sizing';
import { yieldingWidths } from '../heatmap/columnTracks';
import { layoutBarTable } from './layout';
import type { BarTableData, BarTableDerived, BarTableMarks, BarTableOptions } from './types';

export const bartableCore: ChartCore<BarTableData, BarTableOptions, BarTableMarks, BarTableDerived> = {
  type: 'bartable',
  sizing: chartSizing('bartable'),
  title: 'Bar table',
  summary:
    'Table rows with number columns and stacked bars. One panel when the rows compare one measure (impact in $bn, split into Run and Grow); ' +
    'several panels when the same split reads in different units side by side ($bn and % of EBITDA). Each panel has its own scale; the end label is the row total or an authored range, whose bar fills the segments to low and extends lightly to high. ' +
    "variant 'cascade': panels as periods of one total (category share by year).",
  aliases: ['bar-table', 'table-bars'],
  layout: layoutBarTable,
  finishLayout: (layout) => yieldingWidths('bartable', layout, (data) => [...(data.columns ?? []).map((column) => column.id), ...data.panels.map((panel) => panel.id)], {
    head: (id) => `head:${id}`, // Only number cells read align. Nothing inside a panel does: its Total and values keep their place.
    cell: (label, id, data) => (data.columns ?? []).some((column) => column.id === id) && (label.startsWith(`cell:${id}:`) || label === `total:${id}`),
  }),
  categoryLabels: calendarCategories,
  defaults: { total: true },
  annotationKinds: [],
};
