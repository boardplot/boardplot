/** Mekko data and options schemas, without the chart engine. */

import * as z from 'zod';
import { notImplemented } from '../../schema/capabilityReasons';
import {
  colorRoleField,
  addCategorySeriesIdIssues,
  addCanvasBoundsIssues,
  baseOptionsSchema,
  detailCellSchema,
  idSchema,
  primaryAxisTitleSchema,
  refusedBaseOptions,
  valueKindSchema,
  scenarioField,
  formatExample,
  dataValueKindSchema,
  categorySchemaOf,
} from '../../schema/shared';
import type { ChartData } from '../../types/data';
import type { MekkoOptions } from '../../types/options';

/** Bare category string ⇒ { id, label }. */
const categorySchema = categorySchemaOf({
  nonEmpty: true,
  date: z.string().optional().describe("ISO 8601 date associated with the category."),
  fields: {
    total100: z.number().optional().describe("Authored category total used as the percentage basis; omission uses the sum of category values."),
  },
});

/** Positional cells or point-keyed { categoryId, value } entries. */
const seriesSchema = z.strictObject({
  valueKind: valueKindSchema,
  id: idSchema.describe("Series identity used by keyed options, annotations and legend entries."),
  label: z.string().optional().describe("Displayed series name; defaults to the series id."),
  values: z.array(z.union([detailCellSchema, z.strictObject({ categoryId: idSchema.describe("Category id identifying this value independently of array position."), value: detailCellSchema.describe("Cell assigned to the named category in this series.") })])).describe("Values in category order, or keyed entries pairing a categoryId with its value."),
  scenario: scenarioField(''),
  direction: z.enum(['higherIsBetter', 'lowerIsBetter']).optional().describe("Declared preference for higher or lower values in directional comparisons."),
  role: z.enum(['data', 'reference']).optional().describe("Declares a plotted data series or a comparison reference series."),
  colorRole: colorRoleField("Theme color role used for this series when no explicit fill takes precedence."),
  fill: z.string().optional().describe("Explicit CSS fill color for this series; remains authored across theme changes."),
  unit: z.string().optional().describe("Unit associated with the series values. Under stacked100, column totals use this unit only when every data series declares the same unit; options.unit belongs to the shares."),
  format: formatExample.optional().describe("Format-by-example for this series values, for example 1,234 or 1.2%."),
});

export const mekkoDataSchema = z
  .strictObject({
    valueKind: dataValueKindSchema,
    categories: z.array(categorySchema).min(1).describe("Categories defining the variable-width columns."),
    series: z.array(seriesSchema).min(1).describe("Stack components and optional reference series supplying widths."),
  })
  .superRefine((data, ctx) => {
    addCategorySeriesIdIssues(ctx, data);
  }) as unknown as z.ZodType<ChartData>;

export const mekkoOptionsSchema = z.object({
  ...baseOptionsSchema.shape,
  ...refusedBaseOptions('mekko'),
  axisTitles: primaryAxisTitleSchema('over the value axis, in the top row left of the plot'),
  // Percent totals use the original measure's unit; options.unit names shares.
  mode: z.never({ error: notImplemented('mode', 'mekko', 'a mekko draws one framing at every width; remove mode and set size for a smaller canvas') }).optional().describe("Refused on 'mekko': a mekko draws one framing at every width."),
  variant: z.enum(['stacked100', 'stacked', 'bar']).optional().describe("stacked100 by default gives 100% stacks with widths proportional to category totals. stacked uses absolute stack heights; bar uses one value-height rectangle per category."),
  widthSeriesId: idSchema.optional().describe("Series supplying category widths; omitted uses category totals, or equal widths in bar mode."),
  ridge: idSchema.optional().describe("Data-series id whose top boundary is emphasized across the variable-width columns."),
}).superRefine(addCanvasBoundsIssues) as unknown as z.ZodType<MekkoOptions>;
