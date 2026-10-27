/** Gantt / timeline chart registration. */

import type { ChartDefinition } from '../../registry';
import { parseData } from '../../schema/shared';
import type { GanttData } from '../../types/data';
import type { GanttDerived, GanttMarks, GanttOptions } from './layout';
import { ganttCore } from './core';
import { ganttDataSchema, ganttOptionsSchema } from './schema';

export { ganttDataSchema, ganttOptionsSchema };

export const ganttDefinition: ChartDefinition<GanttData, GanttOptions, GanttMarks, GanttDerived> = {
  ...ganttCore,
  discovery: {
    notFor: 'Steps without dates; gantt places spans and events on a calendar.',
    example: {
      data: {
        rows: [
          {
            id: 'design',
            label: 'Design',
            items: [{ id: 'design-bar', kind: 'bar', start: '2026-04-01', end: '2026-04-10' }],
          },
          {
            id: 'launch',
            label: 'Launch',
            items: [{ id: 'launch-date', kind: 'milestone', start: '2026-04-15' }],
          },
        ],
      },
      options: { title: 'Design ends five days before launch', source: 'Illustrative data' },
    },
  },
  normalize: (raw) => parseData(ganttDataSchema, raw),
  dataSchema: ganttDataSchema,
  optionsSchema: ganttOptionsSchema,
};
