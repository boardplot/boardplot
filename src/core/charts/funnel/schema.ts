/** Funnel data and options schemas, without the chart engine. */

import * as z from 'zod';
import {
  colorRoleField,
  addCategorySeriesIdIssues,
  baseOptionsSchema,
  detailCellSchema,
  idSchema,
  refusedBaseOptions,
  valueKindSchema,
  scenarioField,
  formatExample,
  dataValueKindSchema,
  categorySchemaOf,
} from '../../schema/shared';
import type { ChartData } from '../../types/data';
import type { FunnelOptions } from '../../types/options';

// `variant`, `totalCvr`, `stageShade` and `worstDropCallout` are declared on FunnelOptions itself: an augmentation
// here is copied verbatim into the declaration bundle, where '../../types/options'
// resolves to nothing and the merge silently never happens.

/** Category: bare string shorthand or canonical object. */
const categorySchema = categorySchemaOf({
  nonEmpty: true,
  date: z.string().optional().describe("ISO 8601 date associated with the category."),
});

/** Series values: positional cells or point-keyed entries. */
const pointValueSchema = z.strictObject({ categoryId: idSchema.describe("Funnel stage id identifying this value independently of array position."), value: detailCellSchema.describe("Cell value assigned to the named funnel stage.") });

const seriesSchema = z.strictObject({
  valueKind: valueKindSchema,
  id: idSchema.describe("Series identity used by keyed options, annotations and legend entries."),
  label: z.string().optional().describe("Displayed series name; defaults to the series id."),
  values: z.array(z.union([detailCellSchema, pointValueSchema])).describe("Values in category order, or keyed entries pairing a categoryId with its value. A cell label replaces its value text; false hides it. A centered funnel with several series prints stage totals and warns that cell labels need variant 'rows'."),
  scenario: scenarioField(''),
  role: z.enum(['data', 'reference']).optional().describe("Declares a plotted data series or a comparison reference series."),
  colorRole: colorRoleField("Theme outcome role for this series, such as a status role. 'others' paints the series in the Others fill (color.othersMark) which takes a separation outline when that fill is pale only under marks.contrastEdge: true, unless marks.othersOutline is false."),
  fill: z.string().optional().describe("Explicit CSS fill color for this series; remains authored across theme changes."),
  unit: z.string().optional().describe("Unit associated with the series values."),
  format: formatExample.optional().describe("Format-by-example for this series values, for example 1,234 or 1.2%."),
});

export const funnelDataSchema = z
  .strictObject({
    valueKind: dataValueKindSchema,
    categories: z.array(categorySchema).min(1).describe("Sequential funnel stages in process order."),
    series: z.array(seriesSchema).min(1).describe("Stage values, optionally split into outcome series."),
  })
  .superRefine((data, ctx) => {
    addCategorySeriesIdIssues(ctx, data);
  }) as unknown as z.ZodType<ChartData>;

export const funnelOptionsSchema = baseOptionsSchema.safeExtend(refusedBaseOptions('funnel')).safeExtend({
  variant: z
    .enum(['rows', 'centered'])
    .optional()
    .describe("Funnel geometry; default 'rows' bounds automatic callout leaders to three text widths. 'centered' uses symmetric stages and three centered label lines."),
  totalCvr: z
    .enum(['none', 'column'])
    .optional()
    .describe("Centered-only cumulative conversion column versus stage 1; default 'none'."),
  stageShade: z
    .enum(['darken', 'lighten'])
    .optional()
    .describe("Centered single-series stage shading; default 'darken'. Authored paints and palettes take priority."),
  worstDropCallout: z
    .boolean()
    .optional()
    .describe("Rows only: draws the automatic 'Biggest drop' callout at the step with the largest loss. Default false: the step captions already print every rate. An authored note replaces it."),
}) as unknown as z.ZodType<FunnelOptions>;
