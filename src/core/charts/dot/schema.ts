/** Dot data and options schemas, without the chart engine. */

import * as z from 'zod';
import { rangeCellSchema } from '../../range';
import type { ChartData } from '../../types/data';
import type { DotOptions } from '../../types/options';
import {
  colorRoleField,
  addCategorySeriesIdIssues,
  averageMarkerSchema,
  baseOptionsSchema,
  idSchema,
  refusedBaseOptions,
  valueKindSchema,
  scenarioField,
  formatExample,
  dataValueKindSchema,
  primaryAxisTitleSchema,
  categorySchemaOf,
} from '../../schema/shared';

const categorySchema = categorySchemaOf({
  date: z.string().optional().describe("ISO 8601 date associated with the category."),
});

const seriesSchema = z.strictObject({
  valueKind: valueKindSchema,
  id: idSchema.describe("Series identity used by keyed options, annotations and legend entries."),
  label: z.string().optional().describe("Displayed series name; defaults to the series id."),
  values: z.array(
    z.union([rangeCellSchema, z.strictObject({ categoryId: idSchema.describe("Category id identifying this value independently of array position."), value: rangeCellSchema.describe("Cell assigned to the named category in this series.") })]),
  ).describe("Values in category order, or keyed entries pairing a categoryId with its value."),
  scenario: scenarioField(''),
  direction: z.enum(['higherIsBetter', 'lowerIsBetter']).optional().describe("Declared preference for higher or lower values in directional comparisons."),
  role: z.enum(['data', 'reference']).optional().describe("Declares a plotted data series or a comparison reference series."),
  colorRole: colorRoleField("Theme color role used for this series when no explicit fill takes precedence."),
  fill: z.string().optional().describe("Explicit CSS fill color for this series; remains authored across theme changes."),
  unit: z.string().optional().describe("Unit of this series' values. Without a format example, a $k, $m, k or m unit prints its labels whole from 100 up, in place of options.unit."),
  format: formatExample.optional().describe("Format-by-example for this series' labels, for example 1,234 or 1.2%. Overrides options.format; a cell format overrides it."),
});

export const dotDataSchema = z
  .strictObject({
    valueKind: dataValueKindSchema,
    categories: z.array(categorySchema).min(1).describe("Categories defining the dot-chart rows."),
    series: z.array(seriesSchema).min(1).describe("Values and optional ranges to compare across each category row."),
  })
  .superRefine((data, ctx) => {
    addCategorySeriesIdIssues(ctx, data);
  }) as unknown as z.ZodType<ChartData>;

export const dotOptionsSchema = baseOptionsSchema.safeExtend(refusedBaseOptions('dot')).safeExtend({
  axisTitles: primaryAxisTitleSchema('under the value-axis tick row, ending at the right edge of the plot'),
  legend: baseOptionsSchema.shape.legend.describe("Key position. Multiple series get a key by default unless visible direct labels name them. 'none' hides the key; unnamed series warn."),
  variant: z.enum(['dot', 'dumbbell', 'lollipop']).optional().describe("Dot by default; dumbbell joins paired values and lollipop joins values to the baseline."),
  averageMarker: averageMarkerSchema.describe("Computed dashed average rule with a solver-placed Ø label, as on bar and column: the mean of every dot of the series in scope ('all' by default, or the listed series)."),
  arrow: z
    .boolean()
    .optional()
    .describe("Dumbbell only (warning arrow-dumbbell-only otherwise): an arrowhead at the second series' dot shows the direction of change. The connector is painted good or bad by the sign of the change when the second series declares direction, neutral otherwise; a pair whose dots nearly touch keeps a plain connector."),
  methodNote: z
    .boolean()
    .optional()
    .describe('Default false. true adds the method footnote that names the marker inside a range as its supplied mid-point. A supplied range.mid is drawn and keyed either way.'),
  range: z.strictObject({
    label: z.string().min(1).optional().describe("The key entry for the drawn ranges, naming the interval, for example 'Peer range, min to max' or 'Interquartile range'. Default 'Range'."),
    values: z.boolean().optional().describe('Default false. true prints each range\'s low and high value beside its caps.'),
    midLabel: z.string().min(1).optional().describe("The key entry for the open marker that draws each supplied range.mid, for example 'Peer midpoint'. Default 'Midpoint'. When only some rows carry a mid, a note names the others."),
  }).optional().describe('What the drawn ranges are: their key entry and, on request, their bounds as numbers.'),
}) as unknown as z.ZodType<DotOptions>;
