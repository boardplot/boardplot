/** Bar table data and options schemas, without the chart engine. */

import * as z from 'zod';
import { formatExample } from '../../schema/shared';
import { addDuplicateIdIssues, baseOptionsSchema, colorRoleField, idRecord, idSchema, refusedBaseOptions } from '../../schema/shared';
import type { BarTableData, BarTableOptions } from './types';

// The states a table cell takes that make sense for a bar: n/a and n.m. print as the table prints them.
// 'suppressed' needs a footnote and 'open' a period ground, and a bar table has neither.
const cellState = z.strictObject({
  state: z.enum(['na', 'nm']).describe("'na' prints n/a, 'nm' prints n.m."),
}).describe('Cell state, as in a table cell.');

const barValue = z
  .union([
    z
      .number()
      .finite()
      .nonnegative({ message: 'bars grow from zero, so a bar table takes no negative values; use waterfall or variance for signed values' }),
    z.null(),
    cellState,
  ])
  .describe("Nonnegative value; null is missing: the row prints the missing glyph and the Total leaves the panel open. { state: 'na' | 'nm' } prints n/a or n.m. instead.");

// rangeSchema (range.ts) also takes a `mid` this table would ignore, and zod
// cannot omit a key from a refined object; the refusal message is the same.
const endSchema = z
  .strictObject({
    low: z.number().finite().nonnegative({ message: 'bars grow from zero, so a range starts at zero or above' }).describe('Lower end of the row total, where the segments end; zero or more.'),
    high: z.number().finite().describe('Upper end of the row total, where the light extension ends; at least low.'),
  })
  .superRefine((range, ctx) => {
    if (range.low > range.high) {
      ctx.addIssue({ code: 'custom', path: ['low'], message: 'range-inverted: low must be less than or equal to high' });
    }
  })
  .describe('Authored range for the row total, printed "low–high" after the bar. The segments fill the bar to low; a light outlined extension runs on to high.');

const rowSchema = z.strictObject({
  id: idSchema.describe('Row identity; not __total, which names the Total row.'),
  label: z.string().optional().describe('Row name in the label column; defaults to the id. Long names wrap to two lines.'),
  group: idSchema.optional().describe('Row group id from data.rowGroups: the bar takes its colour. Required under rowGroups, except on a residual row.'),
  residual: z.boolean().optional().describe('A rest row ("Rest of world"): neutral grey, pinned below the other rows.'),
});

const rowGroupSchema = z.strictObject({
  id: idSchema.describe('Group identity; rows name it in group.'),
  label: z.string().optional().describe('Name in the key; defaults to the id.'),
  colorRole: colorRoleField('Theme colour role when no fill is set.'),
  fill: z.string().optional().describe('Explicit CSS fill.'),
});

const segmentSchema = z.strictObject({
  id: idSchema.describe('Segment identity; every panel keys its values by it.'),
  label: z.string().optional().describe('Segment name in the key; defaults to the id.'),
  colorRole: colorRoleField('Theme colour role for this segment when no fill is set.'),
  fill: z.string().optional().describe('Explicit CSS fill for this segment.'),
});

const columnSchema = z.strictObject({
  id: idSchema.describe('Column identity; distinct from every panel id.'),
  label: z.string().optional().describe('Column head, right-aligned over the numbers; wraps to two lines.'),
  values: z.array(z.union([z.number().finite(), z.null(), cellState])).describe("One number per row, in row order; null prints the missing glyph, { state } n/a or n.m."),
  format: formatExample.optional().describe('Format by example, such as 1,234 or 12.5%.'),
  aggregate: z.enum(['sum', 'none']).optional().describe("What the Total row prints: 'sum' (default) adds the column, 'none' leaves the cell empty for numbers that do not add up, such as averages or rates."),
});

const panelSchema = z.strictObject({
  id: idSchema.describe('Panel identity; distinct from every column id.'),
  label: z.string().optional().describe('The measure, printed in the head as "label, unit".'),
  unit: z.string().optional().describe('Unit of this panel, such as $bn or %; printed in the head, never in the end labels.'),
  weight: z.number().positive().optional().describe('Share of the width left for the panels; default 1. A weight of 2 beside 1 gives the first panel two thirds.'),
  values: idRecord(idSchema, z.array(barValue)).describe('Segment id -> one value per row, in row order. Every segment in data.series appears, and every key is a segment id.'),
  ends: z.array(endSchema.nullable()).optional().describe(
    'Per row, in row order: a range for the row total, or null for none. A row with a range draws its segments to low, ' +
    'each keeping its share of the segments\' sum, then a light outlined extension from low to high, and prints "low–high" after it. ' +
    'So the segment values set the split only: Run 40 and Grow 100 with a range of 110–160 draw, hover and list in the data table as about 31 and 79, their parts of 110. ' +
    'A row without a range draws and prints its sum. The Total row adds the ranges, counting a row without one at its sum at both ends.',
  ),
  format: formatExample.optional().describe('Format by example for the end labels and the total; falls back to options.format.'),
  aggregate: z.enum(['sum', 'none']).optional().describe("What the Total row prints for this panel: 'sum' (default) adds the rows, or their ranges when a row has one; 'none' leaves it empty. Use 'none' for shares, rates or averages, such as a % of each row's own base, whose sum means nothing."),
});

export const bartableDataSchema = z
  .strictObject({
    categories: z.array(rowSchema).min(1).describe('The rows, top to bottom.'),
    series: z.array(segmentSchema).min(1).describe('The segments of every bar, left to right. Two or more draw a key; one draws none and the panel head names the measure.'),
    columns: z.array(columnSchema).optional().describe('Number columns between the row labels and the panels, such as a count per row. Zero or more.'),
    panels: z
      .array(panelSchema)
      .min(1)
      .describe(
        'One stacked-bar panel per measure, each with its own unit and scale. Use one panel when the rows compare one measure: EBITDA impact in $bn, split into Run and Grow. ' +
        'Use several when the same split reads in different units side by side: the impact in $bn and the same impact as % of EBITDA. ' +
        'Bars in different panels compare by length only under sharedScale true. Under variant \'cascade\' the panels are periods of one total.',
      ),
    rowGroups: z.strictObject({
      title: z.string().optional().describe('Key title with the unit ("Margin of market, %").'),
      groups: z.array(rowGroupSchema).min(1).describe('In key order.'),
    }).optional().describe('Colour bars by a row attribute, keyed under a title. Needs one segment.'),
  })
  .superRefine((data, ctx) => {
    const rows = data.categories.length;
    addDuplicateIdIssues(ctx, data.categories, ['categories'], { name: 'row', keys: 'values by position and scene identities' });
    // Records and hover give the Total row this id, BARTABLE_TOTAL_ROW in
    // a11y/structuralRecords.ts. A shared constant would link a bar table
    // module into react/spec before it draws, which the package smoke refuses.
    data.categories.forEach((row, index) => {
      if (row.id === '__total') ctx.addIssue({ code: 'custom', path: ['categories', index, 'id'], message: "'__total' is the id of the Total row in records and hover; give this row another id" });
    });
    addDuplicateIdIssues(ctx, data.series, ['series'], { name: 'segment', keys: 'panel values and the key' });
    // The key names the range extension '__range', RANGE_KEY in layout.ts.
    data.series.forEach((segment, index) => {
      if (segment.id === '__range') ctx.addIssue({ code: 'custom', path: ['series', index, 'id'], message: "'__range' is the id of the range entry in the key; give this segment another id" });
    });
    addDuplicateIdIssues(ctx, [
      ...(data.columns ?? []).map((column, index) => ({ id: column.id, issuePath: ['columns', index, 'id'] })),
      ...data.panels.map((panel, index) => ({ id: panel.id, issuePath: ['panels', index, 'id'] })),
    ], [], { name: 'column or panel', keys: 'the head and the cells of one column' });
    if (data.rowGroups) {
      addDuplicateIdIssues(ctx, data.rowGroups.groups, ['rowGroups', 'groups'], { name: 'row group', keys: 'the rows and the key' });
      if (data.series.length > 1) ctx.addIssue({ code: 'custom', path: ['rowGroups'], message: `row groups colour each bar, and the bars split into ${data.series.length} segments that need their own colours; keep one segment or drop rowGroups` });
      const ids = new Set(data.rowGroups.groups.map((group) => group.id));
      data.categories.forEach((row, index) => {
        if (row.group === undefined ? !row.residual : !ids.has(row.group)) {
          ctx.addIssue({ code: 'custom', path: ['categories', index, 'group'], message: `row '${row.id}' ${row.group === undefined ? 'names no group' : `names group '${row.group}', which rowGroups does not have`}; use one of ${[...ids].join(', ')}, or mark the row residual` });
        }
      });
    } else {
      data.categories.forEach((row, index) => {
        if (row.group !== undefined) ctx.addIssue({ code: 'custom', path: ['categories', index, 'group'], message: `row '${row.id}' names group '${row.group}', and data.rowGroups is not set; add rowGroups or drop group` });
      });
    }
    const length = (values: readonly unknown[], path: PropertyKey[]) => {
      if (values.length !== rows) ctx.addIssue({ code: 'custom', path, message: `expected ${rows} values, one per row in row order; got ${values.length}` });
    };
    data.columns?.forEach((column, index) => length(column.values, ['columns', index, 'values']));
    const segments = new Set(data.series.map((segment) => segment.id));
    data.panels.forEach((panel, index) => {
      for (const [key, values] of Object.entries(panel.values)) {
        if (!segments.has(key)) {
          ctx.addIssue({ code: 'custom', path: ['panels', index, 'values', key], message: `'${key}' is no segment id; the keys are ${[...segments].join(', ')}` });
        } else length(values, ['panels', index, 'values', key]);
      }
      for (const id of segments) {
        if (!Object.hasOwn(panel.values, id)) ctx.addIssue({ code: 'custom', path: ['panels', index, 'values'], message: `segment '${id}' has no values in this panel; every panel splits its bars into the same segments` });
      }
      if (panel.ends) length(panel.ends, ['panels', index, 'ends']);
      // The segments split low by their shares, so a row whose segments sum to nothing has no split.
      panel.ends?.forEach((range, row) => {
        const split = Object.values(panel.values).reduce((sum, values) => sum + (typeof values[row] === 'number' ? Math.max(0, values[row]) : 0), 0);
        if (range && range.low > 0 && !(split > 0)) {
          ctx.addIssue({ code: 'custom', path: ['panels', index, 'ends', row], message: 'range-without-split: the segments fill the bar to low by their shares, and this row\'s segments sum to zero; give them values or drop the range' });
        }
      });
    });
  }) as unknown as z.ZodType<BarTableData>;

export const bartableOptionsSchema = baseOptionsSchema.safeExtend(refusedBaseOptions('bartable')).safeExtend({
  total: z.boolean().optional().describe("Closing Total row, labelled with strings.total; default true. Summed number columns print their sum; a panel prints the summed ranges when a row has one (a row without counts its sum at both ends), else the sum of the bars, as text without a bar."),
  combinedShare: z.strictObject({
    rows: z.array(idSchema).min(2).describe('Row ids whose combined share prints; at least two, each once.'),
    label: z.string().trim().min(1).optional().describe("What the rows are called together in the note; default their labels joined with 'and'."),
  }).superRefine((combined, ctx) => {
    // A row named twice is counted twice and can print a share above 100 %.
    // The patch drops the repeat, or the whole note when fewer
    // than two distinct rows would remain.
    const distinct = new Set(combined.rows).size;
    combined.rows.forEach((id, index) => {
      if (combined.rows.indexOf(id) === index) return;
      ctx.addIssue({
        code: 'custom',
        path: distinct < 2 ? [] : ['rows', index],
        message: `combinedShare names row '${id}' twice, which counts it twice; name each row once`,
        params: { refused: true },
      });
    });
  }).optional().describe("A note with the combined share of these rows in each summed panel: their sum over the panel's, at the low and the high end where rows carry ranges ('Core segments: 120 of 300 $bn at the low end, 40%; 210 of 500 at the high end, 42%'). A row id that names no row is refused."),
  variant: z.enum(['panels', 'cascade']).optional().describe(
    "'panels' (default): one stacked-bar panel per measure. 'cascade': share cascade, each panel splits its total; a row starts where the row above ended, on a light track over the total. " +
    'The Total row is a dark bar. combinedShare draws a bracket over its rows, which must follow one another. Needs one segment, no ends, no nulls.',
  ),
  cascade: z.strictObject({
      share: z.boolean().optional().describe('Computed share column beside each panel; default true. rounding defaults to \'sum-consistent\' here, so each adds up to 100%.'),
      growth: z.strictObject({
        measure: z.enum(['cagr', 'share-change']).describe("'cagr': each row's CAGR, first panel to last, in %. 'share-change': last share minus first, in pp."),
        years: z.number().positive().optional().describe("Years from first to last panel for 'cagr'; default read from the panel labels (2019, FY24)."),
        label: z.string().trim().min(1).optional().describe('Column head; default from the panel labels.'),
      }).optional().describe('Growth column after the last panel.'),
  }).optional().describe("Settings of variant 'cascade'; refused with variant 'panels'."),
  sharedScale: z.boolean().optional().describe("false: each panel its own scale. true: one scale, panel width follows its longest bar; weights refused. Default false, true under cascade."),
}) as unknown as z.ZodType<BarTableOptions>;
