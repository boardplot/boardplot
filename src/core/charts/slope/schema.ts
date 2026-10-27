/** Slope data and options schemas, without the chart engine. */

import * as z from 'zod';
import { TYPE_REFUSED_REASONS } from '../../schema/capabilityReasons';
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
import type { SlopeOptions } from '../../types/options';

/** Bare category string ⇒ { id, label }. */
const categorySchema = categorySchemaOf({
  nonEmpty: true,
  date: z.string().optional().describe("ISO 8601 date associated with the category."),
});

/** Positional cells or point-keyed { categoryId, value } entries. */
const seriesSchema = z.strictObject({
  valueKind: valueKindSchema,
  id: idSchema.describe("Series identity used by keyed options, annotations and legend entries."),
  label: z.string().optional().describe("Displayed series name; defaults to the series id."),
  values: z.array(z.union([detailCellSchema, z.strictObject({ categoryId: idSchema.describe("Category id identifying this value independently of array position."), value: detailCellSchema.describe("Cell assigned to the named category in this series.") })])).describe("Values in category order, or keyed entries pairing a categoryId with its value."),
  scenario: scenarioField(''),
  role: z.enum(['data', 'reference']).optional().describe("Declares a plotted data series or a comparison reference series."),
  colorRole: colorRoleField("Theme color role used for this series when no explicit fill takes precedence."),
  fill: z.string().optional().describe("Explicit CSS fill color for this series; remains authored across theme changes."),
  unit: z.string().optional().describe("Unit associated with the series values."),
  format: formatExample.optional().describe("Format-by-example for this series values, for example 1,234 or 1.2%."),
  negative: z.array(detailCellSchema).optional().describe("Variant 'diverging', required there: the negative share per category, as a positive number."),
  n: z.union([z.number().nonnegative(), z.tuple([z.number().nonnegative(), z.number().nonnegative()])]).optional().describe("Variant 'diverging': base n, one number or exactly two (one per category); below diverging.minBase the panel is hatched."),
  footnote: z.number().int().optional().describe("Variant 'diverging': 1-based options.footnotes mark after the panel head."),
});

export const slopeDataSchema = z
  .strictObject({
    valueKind: dataValueKindSchema,
    // exactly 2 is the contract; >2 passes schema so layout can emit the
    // 'slope-too-many-points' lint error and still render first/last
    categories: z.array(categorySchema).min(2).describe("Endpoint categories; exactly two are intended. Extra categories are warned about and only first and last are shown."),
    series: z.array(seriesSchema).min(1).describe("Series whose first and last category values are joined by a slope."),
  })
  .superRefine((data, ctx) => {
    addCategorySeriesIdIssues(ctx, data);
  }) as unknown as z.ZodType<ChartData>;

export const slopeOptionsSchema = baseOptionsSchema
  .safeExtend(refusedBaseOptions('slope'))
  .safeExtend({
    // A slope names and values both ends of every line in one end label, by
    // design. The line chart's split options would be parsed away with a
    // generic unknown-option warning; refusing them says why.
    seriesLabels: z
      .never({ error: TYPE_REFUSED_REASONS.slope!.seriesLabels! })
      .optional()
      .describe('Refused: a slope keeps its own end labels, name and value at both ends; labels.series sets their parts.'),
    valueLabels: z
      .never({ error: TYPE_REFUSED_REASONS.slope!.valueLabels! })
      .optional()
      .describe('Refused: a slope keeps its own end labels, name and value at both ends; labels.series sets their parts.'),
    // The bound is NOT declared here. `z.number().gt(0).lt(1)` answers a percent
    // spelling with "Too big: expected number to be <1" and no repair, while
    // layout's `foldShareRefusal` names the share, the percent reading and the
    // JSON Patch that turns 5 into 0.05.
    foldBelowShare: z
      .number()
      .optional()
      .describe(
        "Share of the endpoint total below which series fold into one 'Other' line, measured at both ends: 0.05 is five percent. A value at or above 1 is refused. Highlighted series keep their own name.",
      ),
    variant: z.enum(['lines', 'diverging']).optional().describe("'diverging': one panel per series, values as the positive share up from zero and negative as the negative share down, on one scale; two categories, at most 12 series. Default 'lines'."),
    diverging: z.strictObject({
      labels: z.strictObject({
        positive: z.string().optional().describe("Default 'Positive'."),
        negative: z.string().optional().describe("Default 'Negative'."),
      }).optional().describe("Area names, such as Better and Worse."),
      sort: z.enum(['positive', 'net', 'data']).optional().describe("Panel order: 'positive' (default; second-period positive share, descending), 'net' or 'data'."),
      net: z.boolean().optional().describe("Net score (positive minus negative) and its change under each panel. Default true."),
      neutralNote: z.boolean().optional().describe("Note the share that chose neither answer. Default true."),
      minBase: z.number().nonnegative().optional().describe("Base n below which a panel is hatched and noted. Default 30."),
    }).optional().describe("Variant 'diverging' options."),
  }) as unknown as z.ZodType<SlopeOptions>;
