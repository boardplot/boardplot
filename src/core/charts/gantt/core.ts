import { chartSizing } from '../../sizing';
/** Zod-free gantt chart registration. */

import type { ChartCore } from '../../registry';
import type { GanttData } from '../../types/data';
import { layoutGantt, type GanttDerived, type GanttMarks, type GanttOptions } from './layout';

export const ganttCore: ChartCore<GanttData, GanttOptions, GanttMarks, GanttDerived> = {
  type: 'gantt',
  sizing: chartSizing('gantt'),
  title: 'Gantt / timeline',
  summary: 'Project timeline: adaptive calendar, activity spans, cadence rows, events, and elapsed-time context',
  aliases: ['timeline'],
  layout: layoutGantt,
  defaults: {},
  annotationKinds: ['event']
};
