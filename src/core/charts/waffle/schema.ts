/** Waffle data and options schemas, without the chart engine. */

import * as z from 'zod';
import {
  addDuplicateIdIssues,
  baseOptionsSchema,
  cellSchema,
  colorRoleField,
  dataValueKindSchema,
  formatExample,
  idSchema,
  refusedBaseOptions,
  valueKindSchema,
} from '../../schema/shared';
import type { ChartData } from '../../types/data';
import type { WaffleOptions } from './types';
import { WAFFLE_MAX_GRID_SIDE } from './sizing';

/** Category: bare string shorthand or canonical object. Each category is one panel. */
const categorySchema = z.union([
  z.string().min(1),
  z.strictObject({
    id: idSchema.describe('Panel identity used to match keyed values.'),
    label: z.string().optional().describe('Text above the panel, wrapped to the panel width; defaults to the category id.'),
  }),
]);

const seriesSchema = z.strictObject({
  valueKind: valueKindSchema,
  id: idSchema.describe('Segment identity used by keyed values and legend entries.'),
  label: z.string().optional().describe('Segment name in the legend; defaults to the series id.'),
  values: z
    .array(z.union([
      cellSchema,
      z.strictObject({ categoryId: idSchema.describe('Panel id this value belongs to.'), value: cellSchema.describe('Cell for the named panel.') }),
    ]))
    .describe('Percent of the whole (0 to 100) in panel order, or keyed entries pairing a categoryId with a value. Under valueKind fraction, 0.3 reads 30%.'),
  colorRole: colorRoleField('Theme color role of this segment; the palette is used when absent.'),
  fill: z.string().optional().describe('Authored fill of this segment.'),
  format: formatExample.optional().describe('Format-by-example for this segment value, for example 0.0%. Values are in percent units. The panel total takes the format of the first series; a cell format wins for its own value.'),
});

export const waffleDataSchema = z
  .strictObject({
    valueKind: dataValueKindSchema,
    categories: z.array(categorySchema).min(1).describe('Panels, one waffle each, in left-to-right order.'),
    series: z.array(seriesSchema).min(1).describe('Segments of every panel, filled in this order. One series is a single share; several make a stacked waffle. The values of one panel add up to 100 or less; the rest of the panel stays empty. Those rest cells use color.othersMark (default color.others), deepened just enough to clear the mark floor on the page, with no outline; marks.othersOutline does not apply to them.'),
  })
  .superRefine((data, ctx) => {
    addDuplicateIdIssues(ctx, data.categories, ['categories'], { name: 'category', keys: 'panel values and scene identities' });
    addDuplicateIdIssues(ctx, data.series, ['series'], { name: 'series', keys: 'values, legends and scene identities' });
  }) as unknown as z.ZodType<ChartData>;

const gridSide = z.number().int().min(1).max(WAFFLE_MAX_GRID_SIDE);

export const waffleOptionsSchema = baseOptionsSchema.safeExtend(refusedBaseOptions('waffle')).safeExtend({
  grid: z.strictObject({
    rows: gridSide.describe('Rows of cells in every panel, 1 to ' + WAFFLE_MAX_GRID_SIDE + '.'),
    columns: gridSide.describe('Columns of cells in every panel, 1 to ' + WAFFLE_MAX_GRID_SIDE + '.'),
  }).optional().describe('Cell grid of every panel. Default 10 rows by 10 columns, so one cell is 1%. One cell is 100 / (rows × columns) percent, and each segment is rounded to whole cells.'),
  fillFrom: z.enum(['bottom', 'top']).optional()
    .describe("Where the fill starts. 'bottom' (default) starts at the bottom left, fills each row left to right and moves up. 'top' starts at the top left and moves down. A partly filled row fills from the left."),
  headline: z.enum(['value', 'none']).optional()
    .describe("Automatic: a single-segment panel prints its value as a big number; several segments print their values in the key or below each grid. Authored 'value' prints a labelled total for several segments, in the format of the series or options.format. 'none' leaves the headline out."),
  heightFill: z.enum(['rows', 'none']).optional()
    .meta({ default: 'rows' })
    .describe("Spare canvas height of one panel with one series. 'rows' (default): a pinned canvas gives the grid the full plot height, with the value and the label beside the filled cells. 'none': the label, the value and the grid stack in a column."),
  cellNote: z.enum(['auto', 'none']).optional()
    .describe("'auto' (default) prints the note \"One cell = 5%\" under the chart when one cell is not 1% of the whole, so a coarse grid reads right. 'none' leaves it out. The wording comes from strings.cellNote, with '{value}' for the percent."),
  variant: z.enum(['cells', 'square']).optional()
    .describe("'cells' (default) draws the grid of cells. 'square' draws one solid square per panel whose AREA is the share (side = square root of the share × panel side), anchored at the fillFrom corner on the left, inside a pale tint of the same colour that stands for 100%. The headline prints under the panel. Square mode takes exactly one series (a nested second square would read as an L-shape, not a share) and refuses grid; there are no cells, so no cell note prints. Area understates differences (59% is 15 times 4% but only about 4 times as wide), so keep the headline.").meta({ default: 'cells' }),
  reference: z.strictObject({
    categoryId: idSchema.optional().describe('Panel whose share is the reference. Give this or value.'),
    value: z.number().gt(0).max(100).optional().describe('Reference share in percent, above 0 and up to 100 (a 0% reference has no square to outline). Give this or categoryId.'),
    label: z.string().min(1).optional().describe('Outline label; default the panel label and its share, such as "Population 4%". Required with value, since a bare share does not say what it stands for (waffle-reference-label-required).'),
  }).optional()
    .describe("Square mode only. One reference share for ALL panels, drawn as a dashed square outline of that area in every panel (not in the reference panel itself) and named once in a key line above the panels (a note when legend is 'none' or a pinned size has no room). One reference keeps the outline meaning the same in every panel."),
  arrows: z.boolean().optional()
    .describe('Square mode only. true draws an arrow in each gap between adjacent panels, at the height of the reference outline (or mid-panel without one). Default false: the panels are separate measures, and an arrow reads as a flow or a cause.').meta({ default: false }),
  panelGroups: z.array(z.strictObject({
    id: idSchema.describe('Group id.'),
    panels: z.array(idSchema.describe('Member panel (category) id.')).min(1).describe('Member panels, contiguous in category order.'),
    label: z.string().min(1).optional().describe('Caption centred under the group, wrapped to its width.'),
    colorRole: colorRoleField("Fill colour role of the group's panels; the series colour otherwise. Needs a single series."),
  })).superRefine((groups, ctx) => addDuplicateIdIssues(ctx, groups, [], { name: 'panel group', keys: 'captions and scene identities' })).optional()
    .describe('Runs of panels that tell one act of the story: a caption under each run and one colour per run. Members must exist, belong to at most one group, and be contiguous in category order.'),
  subtotal: z.strictObject({
    series: z.array(idSchema.describe('Series id.')).min(1).describe('The summed segments: the first series and the ones right after it, in series order.'),
    label: z.string().min(1).describe("What the sum stands for, such as 'within a day'; printed after the sum."),
  }).optional()
    .describe("Cells mode with one panel only. Sums the first segments and prints the sum with its label: beside a bracket that spans their rows when the key stands beside the grid, under the key otherwise. The sum takes the first series' format."),
}) as unknown as z.ZodType<WaffleOptions>;
