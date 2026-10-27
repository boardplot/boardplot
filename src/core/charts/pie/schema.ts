/** Pie data and options schemas, without the chart engine. */

import * as z from 'zod';
import {
  colorRoleField,
  addCategorySeriesIdIssues,
  baseOptionsSchema,
  detailCellSchema,
  idRecord,
  idSchema,
  refusedBaseOptions,
  valueKindSchema,
  scenarioField,
  formatExample,
  dataValueKindSchema,
  categorySchemaOf,
} from '../../schema/shared';
import { othersShadeDescribe } from '../../othersShade';
import type { ChartData } from '../../types/data';
import type { PieOptions } from '../../types/options';

/** Category: bare string shorthand or canonical object. */
const categorySchema = categorySchemaOf({
  nonEmpty: true,
  date: z.string().optional().describe("Accepted ISO 8601 date metadata; pie slices do not use a date axis."),
  footnote: z.number().int().optional().describe("1-based reference into options.footnotes. The note it points at keeps that number, and notes the engine derives print unnumbered; this type draws no mark at the label, because a slice label composes the category name with its value and share and the number would land inside that phrase."),
});

/** Series values: positional cells or point-keyed entries. */
const seriesSchema = z.strictObject({
  valueKind: valueKindSchema,
  id: idSchema.describe("Series identity used by keyed options, annotations and legend entries."),
  label: z.string().optional().describe("Displayed series name; defaults to the series id."),
  values: z.array(z.union([detailCellSchema, z.strictObject({ categoryId: idSchema.describe("Category id identifying this value independently of array position."), value: detailCellSchema.describe("Cell assigned to the named category in this series.") })])).describe("Values in category order, or keyed entries pairing a categoryId with its value."),
  scenario: scenarioField('Controls scenario labels and paint conventions.'),
  role: z.enum(['data', 'reference']).optional().describe("Data series or comparison-only reference series; references are excluded from the main plotted data."),
  colorRole: colorRoleField("Theme color role used for a single displayed slice; multi-slice charts use the selected slice ramp."),
  unit: z.string().optional().describe("Unit shown with this series values and used to check shared-scale compatibility."),
  format: formatExample.optional().describe("Format-by-example for this series values, for example 1,234 or 1.2%."),
});

export const pieDataSchema = z
  .strictObject({
    valueKind: dataValueKindSchema,
    categories: z.array(categorySchema).min(1).describe("Slice categories in source order; sorting and topN may change the displayed order."),
    series: z.array(seriesSchema).min(1).describe("Slice values from the first non-reference series; additional series are ignored with a warning."),
  })
  .superRefine((data, ctx) => {
    addCategorySeriesIdIssues(ctx, data);
  }) as unknown as z.ZodType<ChartData>;

export const pieOptionsSchema = baseOptionsSchema.safeExtend(refusedBaseOptions('pie')).safeExtend({
  doughnut: z.number().min(0).max(1).optional().describe(
    'Hole radius as a fraction of outer radius. Inside labels cap the hole at 0.72; centre totals include the declared unit.',
  ),
  topN: baseOptionsSchema.shape.topN.describe('Defaults to the seven largest slices plus Others, merged only when Others would hold three slices or more; an authored topN overrides the default.'),
  labels: baseOptionsSchema.shape.labels.describe(
    'Up to four displayed slices (eight without a legend) default to named outside labels with leaders in two columns; without a legend every label names its slice at any count. Explicit inside/outside settings take priority.',
  ),
  rotate: z
    .union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
    .optional().describe("Starting angle clockwise from 12 o'clock, in quarter turns. Defaults to 0 degrees."),
  explode: idRecord(z.string(), z.number().min(0).max(1)).optional().describe("Slice category ids mapped to outward offsets as fractions of the outer radius."),
  colors: z
    .enum(['categorical', 'sequential'])
    .optional()
    .describe(
      "Slice colour strategy. Defaults to 'categorical' for up to four nominal slices without topN/palette; otherwise 'sequential'.",
    ),
  othersShade: z
    .enum(['quietest', 'apart'])
    .optional()
    .describe(othersShadeDescribe('Sequential ramp beside an Others slice. Without an Others slice the ramp does not change.')),
}) as unknown as z.ZodType<PieOptions>;
