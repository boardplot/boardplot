/** Butterfly data and options schemas, without the chart engine. */

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
import type { ButterflyOptions } from '../../types/options';

const categorySchema = categorySchemaOf({
  date: z.string().optional().describe("ISO 8601 date associated with the category."),
});

const seriesSchema = z.strictObject({
  valueKind: valueKindSchema,
  id: idSchema.describe("Series identity used by keyed options, annotations and legend entries."),
  label: z.string().optional().describe("Displayed series name; defaults to the series id."),
  values: z.array(
    z.union([detailCellSchema, z.strictObject({ categoryId: idSchema.describe("Category id identifying this value independently of array position."), value: detailCellSchema.describe("Cell assigned to the named category in this series.") })]),
  ).describe("Values in category order, or keyed entries pairing a categoryId with its value."),
  scenario: scenarioField(''),
  colorRole: colorRoleField("Theme color role used for this series when no explicit fill takes precedence."),
  fill: z.string().optional().describe("Explicit CSS fill color for this series; remains authored across theme changes."),
  unit: z.string().optional().describe("Unit associated with the series values."),
  format: formatExample.optional().describe("Format-by-example for this series values, for example 1,234 or 1.2%."),
});

export const butterflyDataSchema = z
  .strictObject({
    valueKind: dataValueKindSchema,
    categories: z.array(categorySchema).min(1).describe("Categories defining the matched rows in both panes."),
    series: z.array(seriesSchema).min(2).describe("Series containing the two pane values selected by options.a and options.b."),
  })
  .superRefine((data, ctx) => {
    addCategorySeriesIdIssues(ctx, data);
  }) as unknown as z.ZodType<ChartData>;

export const butterflyOptionsSchema = baseOptionsSchema.safeExtend(refusedBaseOptions('butterfly')).safeExtend({
  a: idSchema.describe("Series id displayed in the left pane."),
  b: idSchema.describe("Series id displayed in the right pane."),
  centerColumnWidth: z.number().positive().optional().describe("Width in pixels reserved between the panes for category labels; omission uses their measured width."),
  sortBy: z.enum(['sheet', 'a', 'b', 'sum', 'diff']).optional().describe("Row order: sheet by default, or descending a, b, sum a+b, or difference b-a."),
  sharedScale: z.boolean().optional().describe("Use the same value scale on both sides by default. False gives independent scales and warns that lengths are not comparable."),
}) as unknown as z.ZodType<ButterflyOptions>;
