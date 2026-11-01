/** Heatmap data and options schemas, without the chart engine. */

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
import { NAMED_COLUMN_STATES } from '../../schema/namedColumns';
import type { HeatmapData } from '../../types/data';
import type { HeatmapOptions } from '../../types/options';

const categorySchema = categorySchemaOf({
  date: z.string().optional().describe("Accepted ISO 8601 date metadata; heatmap columns remain category bands."),
});

const seriesSchema = z.strictObject({
  valueKind: valueKindSchema,
  id: idSchema.describe("Series identity used by keyed options, annotations and legend entries."),
  label: z.string().optional().describe("Displayed series name; defaults to the series id."),
  values: z.array(
    z.union([detailCellSchema, z.strictObject({ categoryId: idSchema.describe("Category id identifying this value independently of array position."), value: detailCellSchema.describe("Cell assigned to the named category in this series.") })]),
  ).describe("Values in category order, or keyed entries pairing a categoryId with its value."),
  scenario: scenarioField('Controls scenario labels and paint conventions.'),
  direction: z
    .enum(['higherIsBetter', 'lowerIsBetter'])
    .optional()
    .describe(
      "Declares this row's judgment for the continuous scale and PINS the whole matrix on the good/bad valence ramp (like table heat's signed flag) — declaring 'higherIsBetter' is therefore not a paint no-op on an all-positive matrix. 'lowerIsBetter' inverts the row's poles. Breaks bins go bad to good; under a breaks key every row needs the same direction (else refused). Ignored by the plain discrete ladder and harvey glyphs (warned).",
    ),
  colorRole: colorRoleField("Accepted series color role; heatmap colors are resolved by the matrix scale and cell fills."),
  unit: z.string().optional().describe("Unit shown with this series values and used to check shared-scale compatibility."),
  format: formatExample.optional().describe("Format-by-example for this series values, for example 1,234 or 1.2%."),
  sizes: z.array(z.number().nonnegative().nullable()).optional().describe("Bubble sizes. One per category, in order: a level 1 to n with bubble.levels, else area ∝ size."),
  bases: z.array(z.number().nonnegative().nullable()).optional().describe("Cell bases (n). One per category, in order; below minBase draws hatched."),
  states: z.array(z.enum(NAMED_COLUMN_STATES).nullable()).optional().describe("Why a cell has no value. One per category, in order: suppressed, nm (not meaningful), na (not applicable) or null. A stated cell needs value null; it draws hatched and the key names its state."),
});

export const heatmapDataSchema = z
  .strictObject({
    valueKind: dataValueKindSchema,
    categories: z.array(categorySchema).min(1).describe("Matrix columns in display order; each series supplies the values for one row."),
    series: z.array(seriesSchema).min(1).describe("Matrix rows, each supplying one cell value per category."),
  })
  .superRefine((data, ctx) => {
    addCategorySeriesIdIssues(ctx, data);
  }) as unknown as z.ZodType<HeatmapData>;

export const heatmapOptionsSchema = baseOptionsSchema.safeExtend(refusedBaseOptions('heatmap')).safeExtend({
  scale: z.enum(['continuous', 'discrete']).optional().describe("Continuous color interpolation by default, or a discrete color ladder."),
  variant: z.enum(['value', 'harvey', 'bubble']).optional().describe("Value labels fit as a whole row, and an automatic number text loses a % sign the unit names, then takes fewer decimals, before a value is hidden; authored labels and valid pins retain precedence. Harvey glyphs suppress values and take ratings 0 to 4 only; any other value is refused. 'bubble': one circle per cell, colour = value, area = series sizes; values print where they fit."),
  cap: z.strictObject({
    pct: z.number().positive().optional().describe('Cap in points when every cell is a percent. Example: 20 saturates at ±20%.'),
    abs: z.number().positive().optional().describe('Cap in source units for other values.'),
  }).optional().describe("Where the continuous scale saturates, as table heat's cap: a value at or past it paints full strength, measured from zero. Without it the good/bad scale is symmetric, full at the largest |value|, and the magnitude ramp spans the data. The discrete ladder and harvey glyphs ignore it (cap-ignored)."),
  breaks: z.array(z.number()).min(2).refine((edges) => edges.every((edge, i) => i === 0 || edge > edges[i - 1]!), 'breaks must ascend strictly')
    .optional().describe("Bin edges. Ascending, for scale 'discrete', e.g. [0, 30, 50, 100]; an edge value takes the upper bin. A series direction paints bins bad to good."),
  bubble: z.strictObject({
    levels: z.array(z.string()).min(1).optional().describe("Size levels. Names smallest first, e.g. ['Low', 'Medium', 'High']; sizes hold levels 1 to n."),
    sizeLabel: z.string().optional().describe('Size key title.'),
    colorLabel: z.string().optional().describe('Colour key title.'),
    track: z.boolean().optional().describe('Row track. A line with an arrow through each row; implies ordered columns. Default false.'),
  }).optional().describe("Bubble glyph. Its keys stand above the matrix; legend 'none' drops them."),
  minBase: z.number().positive().optional().describe('Low-base threshold. Cells whose series bases entry is below it draw hatched, with a note.'),
  missing: z.enum(['hatch', 'blank']).optional().describe("How a cell with no value is drawn. 'hatch' (the default) stripes the cell and names it in the key. 'blank' draws no fill and no stripe; the same key entry or note still says that a blank cell is no data. A blank cell keeps its grid line and dash, so it does not read as the palest value. A low base (bases and minBase) stays hatched."),
}) as unknown as z.ZodType<HeatmapOptions>;
