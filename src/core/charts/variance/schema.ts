/** Variance data and options schemas, without the chart engine. */

import * as z from 'zod';
import {
  colorRoleField,
  addCategorySeriesIdIssues,
  baseOptionsSchema,
  cellSchema,
  idSchema,
  primaryAxisTitleSchema,
  partialCategorySchema,
  refusedBaseOptions,
  valueKindSchema,
  scenarioField,
  formatExample,
  dataValueKindSchema,
  categorySchemaOf,
} from '../../schema/shared';
import type { ChartData } from '../../types/data';
import type { VarianceOptions } from '../../types/options';

/** Bare category string ⇒ { id, label }. */
const categorySchema = categorySchemaOf({
  nonEmpty: true,
  date: z.string().optional().describe("ISO 8601 category date; strictly increasing dates permit date-axis promotion where supported."),
  after: {
    partial: partialCategorySchema.describe('Period still running. Actual columns, variance caps and absolute variance bars are hatched; relative pin heads are hollow. Marks keep their positions. The frame adds "<label> partial", and a drawn bar legend adds a hatch key.'),
  },
});

/** Positional cells or point-keyed { categoryId, value } entries. */
const seriesSchema = z.strictObject({
  valueKind: valueKindSchema,
  id: idSchema.describe("Series identity used by keyed options, annotations and legend entries."),
  label: z.string().optional().describe("Displayed series name; defaults to the series id."),
  values: z.array(z.union([cellSchema, z.strictObject({ categoryId: idSchema.describe("Category id identifying this value independently of array position."), value: cellSchema.describe("Cell assigned to the named category in this series.") })])).describe("Values in category order, or keyed entries pairing a categoryId with its value."),
  scenario: scenarioField("Read only on the variance.vs series, where it names the tier (ΔPL). Every data value draws as the actual, so name a forecast or plan value in its category label or a footnote."),
  direction: z.enum(['higherIsBetter', 'lowerIsBetter']).optional().describe("Whether increases are favorable; defaults to higherIsBetter for directional comparisons."),
  role: z.enum(['data', 'reference']).optional().describe("Data series or comparison-only reference series; references are excluded from the main plotted data."),
  colorRole: colorRoleField("Theme color role of the integrated actual columns and their key when this series is the actual and sets no fill; no effect in the other modes or on a reference series."),
  fill: z.string().optional().describe("CSS fill of the integrated actual columns and their key when this series is the actual; a cell fill wins. No effect in the other modes or on a reference series."),
  unit: z.string().optional().describe("Unit of this series' values, read by the grid shared-scale check and the hover card; the drawn labels print options.unit."),
  format: formatExample.optional().describe("Format-by-example for this series values, for example 1,234 or 1.2%."),
});

export const varianceDataSchema = z
  .strictObject({
    valueKind: dataValueKindSchema,
    categories: z.array(categorySchema).min(1).describe("Ordered categories defining the displayed columns or positions and positional value alignment."),
    series: z.array(seriesSchema).min(1).describe("Series supplying values for each category, with optional reference series for comparisons."),
  })
  .superRefine((data, ctx) => {
    addCategorySeriesIdIssues(ctx, data);
  }) as unknown as z.ZodType<ChartData>;

const varianceSpecSchema = z.object({
  of: z.union([z.literal('total'), idSchema]).optional().describe("Compared series id, or total for the sum of data series. Defaults to total."), // default 'total'
  vs: idSchema.describe("Reference-series id; its scenario names the comparison tier."), // reference series id; its scenario names the tier
});

export const varianceOptionsSchema = baseOptionsSchema.safeExtend(refusedBaseOptions('variance')).safeExtend({
  axisTitles: primaryAxisTitleSchema('over the value axis, in the top row left of the plot, when valueAxis.show draws it'),
  variant: z.enum(['absolute', 'relative', 'integrated']).describe("Show raw differences, relative percentage differences, or an integrated comparison with the absolute values. The key builds its entries from the scenario code of the variance.vs series (AC, PY, PL or FC), or from its label when it has no scenario, here PY. absolute and relative: 'Better than PY' and 'Worse than PY', with (lower) and (higher) for a lowerIsBetter series. integrated: the compared series, then 'Above PY' and 'Below PY' for the caps, the same wording at every width, and 'Within rounding of PY' for a muted cap that prints as zero. On report, dashboard, slide and print, the actual value label sits inside the column at its foot; a column too short for it uses the actual edge, then a side position at the same height."),
  variance: varianceSpecSchema.describe("Required comparison identifying the measured quantity and the reference series."),
  missingMark: z.enum(['dash', 'none']).optional()
    .describe("What a category with no prior value leaves behind. 'dash' prints an en dash in the muted ink, at the baseline or, over an integrated actual column, where the cap would sit, so a missing reference reads as missing and not as no difference; 'none' (the default) draws nothing. A reference that exists and is not positive keeps its own 'n.m.' glyph."),
}) as unknown as z.ZodType<VarianceOptions>;
