/** Gantt data and options schemas, without the chart engine. */

import * as z from 'zod';
import {
  colorRoleField,
  addDuplicateIdIssues,
  baseOptionsSchema,
  idSchema,
  refusedBaseOptions,
} from '../../schema/shared';
import type { GanttData } from '../../types/data';
import type { GanttOptions } from './layout';

const anchorSchema = z.strictObject({
  toItemId: idSchema.describe("Target item id whose start or end anchors this item."),
  edge: z.enum(['start', 'end']).describe("Target edge used to resolve the anchored start date."),
  offsetDays: z.number().int().optional().describe("Signed number of days added to the target edge; defaults to zero."),
});

const itemSchema = z.strictObject({
  id: idSchema.describe("Unique item identity used by annotations and scene elements."),
  kind: z.enum(['bar', 'milestone', 'chevron', 'bracket', 'shade', 'rule']).describe("Timeline mark. Milestone labels try their row bands before the lane; unsafe leaders use a numbered key. 'rule' is a quiet span for the state before a change: a 2 px neutral line at the bottom of the bar box with its label above it in muted ink, flush left; it never takes a colour or a colour-key entry."),
  start: z.string().describe("ISO 8601 start date; an anchor can move it while preserving duration."),
  end: z.string().optional().describe("Inclusive ISO 8601 end date for an interval; omission uses the start date."),
  label: z.string().optional().describe("Displayed item name. An omitted name leaves category content empty."),
  colorRole: colorRoleField("Theme color role for this timeline mark."),
  colorLabel: z.string().min(1).optional().describe("What this bar's or chevron's colour means. When bars differ in colour, the colour key names each colour by the first label its items declare. legend.order lists item ids; an entry takes the place of the first of its items listed."),
  scope: z.enum(['row', 'shared']).optional().describe("Milestone scope: 'row' (default) keeps the milestone in its activity row; 'shared' moves it to one shared milestone row below the activities, labelled beside its diamond, for dates that affect several activities such as steering committees."),
  anchor: anchorSchema.optional().describe("Resolve the start relative to another item edge while preserving the authored duration."),
});

const rowBaseSchema = z.strictObject({
  id: idSchema.describe("Unique timeline row identity."),
  label: z.string().describe("Visible timeline row name."),
  sublabel: z.string().optional().describe("Second line under the row name, such as what the row measures. Printed in the label font and muted ink, on one line and never cut; the name band takes the wider of name and sublabel. On narrow canvases it follows the name on the row's name line. labels.activity: false hides it with the name."),
  indent: z.number().int().min(0).optional().describe("Nonnegative indentation level for the row label."),
  cols: z.array(z.union([
    z.string(),
    z.strictObject({
      text: z.string().describe("Cell text, such as a status word."),
      tone: z.enum(['good', 'warn', 'bad', 'neutral']).optional().describe("Status tone; omitted, the cell is plain text. A tone is drawn as a small filled marker in the tone's colour before the text. The row's bars and chevrons without a colorRole take the same colour, as do those of rows indented under it without a status, so the status column keys them."),
    }).describe("A metadata cell: text, optionally with a status tone."),
  ])).optional().describe("Metadata columns beside the row label, such as owner and status; up to three are displayed. A cell is text, or text with a tone."),
});

const taskRowSchema = rowBaseSchema.extend({
  kind: z.literal('task').optional().describe("Task row containing individual timeline items; task is the default row kind."),
  items: z.array(itemSchema).describe("Timeline items placed in this task row."),
});

const cadenceRowSchema = rowBaseSchema.extend({
  kind: z.literal('cadence').describe("Cadence row showing repeated dated event markers."),
  events: z.array(z.strictObject({ id: idSchema.describe("Unique event identity shared with the timeline mark id namespace."), date: z.string().describe("ISO 8601 date of the cadence event.") })).min(1).describe("Dated events placed along this cadence row."),
  marker: z.enum(['diamond', 'triangle']).optional().describe("Cadence event shape; defaults to diamond."),
  colorRole: colorRoleField("Theme color role shared by the cadence markers."),
});

const rowSchema = z.union([taskRowSchema, cadenceRowSchema]);

export const ganttDataSchema = z
  .strictObject({
    rows: z.array(rowSchema).min(1).describe("Task and cadence rows displayed in the supplied order."),
  })
  .superRefine((data, ctx) => {
    addDuplicateIdIssues(ctx, data.rows, ['rows'], {
      name: 'row',
      keys: 'timeline lanes and scene identities',
    });
    const marks = data.rows.flatMap((row, rowIndex) =>
      row.kind === 'cadence'
        ? row.events.map((event, eventIndex) => ({
            id: event.id,
            issuePath: ['rows', rowIndex, 'events', eventIndex, 'id'],
          }))
        : row.items.map((item, itemIndex) => ({
            id: item.id,
            issuePath: ['rows', rowIndex, 'items', itemIndex, 'id'],
          })),
    );
    data.rows.forEach((row, rowIndex) => {
      if (row.kind === 'cadence') return;
      row.items.forEach((item, itemIndex) => {
        if (item.scope === 'shared' && item.kind !== 'milestone') {
          ctx.addIssue({ code: 'custom', path: ['rows', rowIndex, 'items', itemIndex, 'scope'], message: "scope 'shared' applies to milestones only" });
        }
        // A rule is the quiet state before a change: a colour would put it in the key.
        if (item.kind === 'rule') for (const key of ['colorRole', 'colorLabel'] as const) {
          if (item[key] !== undefined) ctx.addIssue({ code: 'custom', path: ['rows', rowIndex, 'items', itemIndex, key], message: "a rule is always the quiet neutral; use kind 'bar' for a coloured span", params: { refused: true } });
        }
      });
    });
    addDuplicateIdIssues(ctx, marks, [], {
      name: 'Gantt mark',
      keys: 'anchors, timeline marks and scene identities',
    });
  }) as unknown as z.ZodType<GanttData>;

export const ganttOptionsSchema = baseOptionsSchema.safeExtend(refusedBaseOptions('gantt')).safeExtend({
  labels: baseOptionsSchema.shape.labels.describe("False hides timeline item labels. Row names, metadata cells and column headers remain. Use labels.activity: false to hide those, or labels.item: false to hide only item labels. For milestones, labels.item: ['category'] prints the item name without its date; ['absolute'] or the legacy ['value'] prints only the date. Span items print the inclusive date range. Parts follow the supplied order. An empty requested part is named in a note."),
  today: z.string().optional().describe("Authored ISO 8601 date for the dashed today marker; the system clock is not read. The marker, like an event rule, passes the period names of the calendar head with a gap. A bar, arrow or shade name with no seat clear of the marker and the event rules sits inside its mark across them, and the rules break over that mark."),
  elapsed: z.boolean().optional().describe("Tint the visible time before today; defaults to true when the today marker is displayed."),
  weekends: z.boolean().optional().describe("Shade Saturday and Sunday at week granularity; defaults to false."),
  rowTint: z.boolean().optional().describe("Apply alternating faint row backgrounds; defaults to false."),
  calendar: z.object({
    weeks: z.enum(['isoWeek', 'startDay']).optional().describe("Week cell names. 'isoWeek' (default): ISO week numbers such as 'W11'. 'startDay': the day of the month each week cell starts on ('9'), flush left in its cell under the month tier, so the number reads as the day the week starts; a clipped first or last cell names the day it starts on. Week granularity only; elsewhere it is ignored with the info lint calendar-weeks-ignored."),
    span: z.enum(['periods', 'data']).optional().describe("Timeline span. 'periods' (default): whole calendar periods of the head's finer tier. 'data': from the first item or cadence day to the later of the last item end and options.today, so the arrows end at the edge. A milestone or cadence marker on the first or last day keeps room for its radius inside the edge. Event annotations and a today before the first item do not extend the span; they are left out with event-out-of-range or today-out-of-range."),
  }).strict().optional().describe('Calendar head and span. The defaults keep the ISO week head over whole periods.'),
  colHeaders: z.array(z.string()).max(3).optional()
    .describe('Positional headers for up to three existing metadata columns. Omitted or empty entries have no header; entries without a displayed column are ignored.'),
}).superRefine((options, ctx) => {
  // Gantt prints one label per event; `items` (column, combo and line only) would lose its text silently.
  (options.annotations ?? []).forEach((annotation, index) => {
    if (annotation.kind === 'event' && Object.hasOwn(annotation, 'items')) {
      ctx.addIssue({
        code: 'custom',
        path: ['annotations', index, 'items'],
        message: "Gantt events take one label and no 'items'; put more changes in separate events, or remove items",
        params: { refused: true },
      });
    }
    // A badge circle holds a short mark such as a number; a longer label would burst it.
    if (annotation.kind === 'event' && annotation.labelPlacement === 'badge' && [...String(annotation.label ?? '')].length > 3) {
      ctx.addIssue({
        code: 'custom',
        path: ['annotations', index, 'label'],
        message: "a badge holds at most 3 characters; use labelPlacement 'top' for a longer label",
        params: { refused: true },
      });
    }
  });
}) as unknown as z.ZodType<GanttOptions>;
