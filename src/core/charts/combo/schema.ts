/** Combo data and options schemas, without the chart engine. */

import * as z from 'zod';
import {
  colorRoleField,
  addCanvasBoundsIssues,
  refuseBadgeEvents,
  addCategorySeriesIdIssues,
  addProjectedDashIssues,
  anomalyOptionSchema,
  averageMarkerSchema,
  baseOptionsSchema,
  detailCellSchema,
  eventOptionsSchema,
  idSchema,
  partialCategorySchema,
  refusedBaseOptions,
  categoryDateSchema,
  valueKindSchema,
  scenarioField,
  formatExample,
  dataValueKindSchema,
  categorySchemaOf,
} from '../../schema/shared';
import type { ChartData } from '../../types/data';
import { bandWindowOptionsSchema } from '../../live/schema';
import type { ComboOptions } from '../../types/options';

/** Bare category string ⇒ { id, label }. */
const categorySchema = categorySchemaOf({
  nonEmpty: true,
  label: z.string().optional().describe("Displayed category name; defaults to the category id and supports line breaks. A date id or `date` without a label prints a short date such as 'Sep'. Day ticks include the month ('2 Oct', or 'Fri 2 Oct' where room allows). A separate row carries the year under day, month and quarter ticks."),
  date: categoryDateSchema.optional().describe("ISO 8601 category date, yyyy-mm-dd; strictly increasing dates permit date-axis promotion where supported."),
  fields: {
    total100: z.number().optional().describe("Shared category percentage-basis metadata; this chart derives its comparisons from series values."),
    gapAfter: z.union([z.boolean(), z.number()]).optional().describe("Category spacing hint accepted by the data schema; this chart does not apply band-step gaps."),
    breakAfter: z.boolean().optional().describe("Reserved category discontinuity hint; does not create an axis break in this chart."),
  },
  after: {
    partial: partialCategorySchema,
  },
});

/** Positional cells or point-keyed { categoryId, value } entries;
 *  `kind` switches column/line/area, `axis` requests the gated secondary. */
const seriesSchema = z.strictObject({
  valueKind: valueKindSchema,
  id: idSchema.describe("Series identity used by keyed options, annotations and legend entries."),
  label: z.string().optional().describe("Displayed series name; defaults to the series id."),
  values: z.array(z.union([detailCellSchema, z.strictObject({ categoryId: idSchema.describe("Category id identifying this value independently of array position."), value: detailCellSchema.describe("Cell assigned to the named category in this series.") })])).describe("Values in category order, or keyed entries pairing a categoryId with its value."),
  scenario: scenarioField('Controls scenario labels and paint conventions.'),
  role: z.enum(['data', 'reference']).optional().describe("Data series or comparison-only reference series; references are excluded from the main plotted data."),
  colorRole: colorRoleField("Theme color role used for this series when no explicit fill takes precedence."),
  fill: z.string().optional().describe("Explicit CSS fill color for this series; remains authored across theme changes."),
  unit: z.string().optional().describe("Unit shown with this series values and used to check shared-scale compatibility."),
  format: formatExample.optional().describe("Format-by-example for this series values, for example 1,234 or 1.2%."),
  kind: z.enum(['column', 'line', 'area']).optional().describe("Geometry for this series: column by default, or an overlaid line or area."),
  axis: z.enum(['primary', 'secondary']).optional().describe("Value scale used by this series; secondary requires a declared secondaryAxis."),
  lineStyle: z.enum(['solid', 'dashed', 'dotted']).optional().describe("Stroke pattern; dashed and dotted strokes require a projected scenario such as FC or PL."),
  marker: z.enum(['circle', 'square', 'triangle', 'diamond', 'none']).optional().describe("Point symbol; none suppresses point markers."),
  smooth: z.boolean().optional().describe("Use monotone interpolation when true or linear interpolation when false; omission inherits chart interpolation."),
  interpolateGaps: z.boolean().optional().describe("true draws the line across a missing cell; false breaks it there, so no line suggests a value that is not there. Default false."),
});

export const comboDataSchema = z
  .strictObject({
    valueKind: dataValueKindSchema,
    categories: z.array(categorySchema).min(1).describe("Ordered categories defining the displayed columns or positions and positional value alignment."),
    series: z.array(seriesSchema).min(1).describe("Series supplying values for each category, with optional reference series for comparisons."),
  })
  .superRefine((data, ctx) => {
    addCategorySeriesIdIssues(ctx, data, () => {
      // Only line-kind series draw stroke ink in a combo; lineStyle on columns
      // and areas never reaches the page, so the dash-semantics refusal
      // applies exactly where the claim would render.
      addProjectedDashIssues(
        ctx,
        data.series.map((series) => (series.kind === 'line' ? series : { ...series, lineStyle: undefined })),
      );
    });
  }) as unknown as z.ZodType<ChartData>;

/** The right-hand axis is EITHER an independent acknowledged scale OR a
 *  relabelling of the primary one; the union refuses both at the schema edge
 *  for the same reason the TS type does. Only combo widens `secondaryAxis`
 *  beyond the shared `{ acknowledge: true }`. */
const secondaryAxisSchema = z.union([
  z
    .object({
      acknowledge: z.literal(true).describe("Explicit acknowledgement that the right axis uses an independent scale."),
      domain: z
        .tuple([z.number(), z.number()])
        .optional()
        .describe('Pin the secondary domain (data may only widen it, never be clipped).'),
      format: formatExample
        .optional()
        .describe(
          "Format-by-example for the right-axis TICKS only (e.g. '1.2%'); wins over series formats. Data labels keep their series/scale formats.",
        ),
      show: z
        .boolean()
        .optional()
        .describe("false keeps the independent scale and draws no right tick column: the secondary series is read from its labelled values and the secondary axis title, which sits at the right edge. Default true.").meta({ default: true }),
    })
    .strict()
    .describe('Opt in to a genuinely independent second scale (always lint-warned).'),
  z
    .object({
      ruler: z
        .object({
          of: z.literal('primary').describe("Use the primary axis positions for the percentage ruler."),
          total: z.number().describe('The quantity 100% refers to; positive and finite.'),
          ticks: z
            .number()
            .int()
            .min(1)
            .max(20)
            .optional()
            .describe('Tick INTERVALS on the percent ladder; default 5 ⇒ 0…100 by 20.').meta({ default: 5 }),
        })
        .strict().describe("Percentage ruler derived from the primary scale and a declared total."),
    })
    .strict()
    .describe('Relabel the primary domain as a share of a total; no second scale is created.'),
]);

/** ComboOptions = BaseOptions — series.kind does the switching. */
export const comboOptionsSchema = z
  .object({
    ...baseOptionsSchema.shape,
    ...refusedBaseOptions('combo'),
    legend: baseOptionsSchema.shape.legend.describe("Key position. Multiple series get a key unless direct labels name them. 'none' hides the key; render warns when names are missing. A series key also explains its scenario styling."),
    viewDomain: z.object({ x: z.tuple([idSchema, idSchema]).describe('Inclusive category ids bounding the visible x axis.') }).optional().describe("Visible category window, retaining all source observations for means. A mean's Ø label names the periods it covers where the plot draws fewer."),
    window: bandWindowOptionsSchema.optional(),
    anomaly: anomalyOptionSchema.optional().describe("Flag exceptional periods of the combo's one line series against a visible, named corridor on that line's axis, with column's rule: 'mad' flags |x − c| / (1.4826 × MAD) > k (c is 0 under the default baseline 'zero', the median under 'median'), 'threshold' flags values outside authored bounds. The corridor rules carry their numbers, each flagged point gets a marker beyond it and prints its value, the legend keys the marker and the corridor, and a footnote states the rule. Needs exactly one line-kind series. Under a window or zoom the rule keeps every source period."),
    labelDensity: baseOptionsSchema.shape.labelDensity.describe("Default 'smart': every column total stays eligible. A chart with more than 12 categories, or with most totals wider than the band, ranks the first, last, highest and lowest (ties: the first) first. The other totals then use only their natural seat above the column; with none free they are drawn nowhere and left out of the note. Those four may take one step, and the note names any that finds no seat. A smaller chart keeps every total on the bounded one-step rule and names any that finds no seat. 'full' treats all totals alike and names every one that finds no seat. Seats stay inside the plot band and one step from the natural seat. Reading records keep every value."),
    labels: baseOptionsSchema.shape.labels.describe("Line end labels default to the value alone at both ends; point: ['series', 'absolute'] adds the series name. Authored point content applies to both ends. On stacked columns, segment: ['absolute', 'percent'] prints value and share in each segment, and a value its segment cannot hold is named in the note line; grandTotal: false hides stack totals. A single column series prints its values as grandTotal labels, so grandTotal: false hides them and keeps the line values; point governs line values only. Combo has no labels.growth: the growth statements of the dual-axis anatomy are dualAxis.growth."),
    secondaryAxis: secondaryAxisSchema.optional().describe("Independent acknowledged secondary scale, or a percentage relabeling of the primary scale. An independent secondary scale returns the warning dual-axis."),
    axisTitles: z.object({
      primary: z.string().trim().min(1).optional().describe("Visible title above the primary value axis."),
      secondary: z.string().trim().min(1).optional().describe("Visible title above the active secondary value axis."),
    }).strict().optional().describe('One-line titles over the tick columns of active axes. Drawn only when authored; the engine infers none.'),
    interpolate: z
      .enum(['linear', 'step-after', 'step-before', 'monotone'])
      .optional()
      .describe('Interpolation for line/area series; per-series smooth overrides it.'),
    dualAxis: z.strictObject({
      anatomy: z.boolean().optional().describe("true draws the dual-axis anatomy on an acknowledged secondary scale the author did not pin. Default: the theme's valueAxis.dualAxis, else false.").meta({ 'x-boardplot-defaultDependsOn': ['theme'] }),
      growth: z.boolean().optional().describe("With the anatomy, states each series' growth from its first to its last complete value beyond the right ticks, bold in the series' text ink, on one line with the series name up to its first comma ('+128% Units sold'); the name goes under the figure when one line would take more than a fifth of the canvas width. A partial category is no end, and the name then says the span. On a canvas narrower than 600 px the statements move to one note line ('Units sold +128%, Revenue +33%, 2019–2024.') and the plot keeps the width. Default false.").meta({ default: false }),
    }).optional().describe("Dual-axis anatomy: both scales from zero with one interval count and shared gridlines, maxima chosen so the line runs above the columns (the synced default scales stay when no pair does), axis titles with a swatch of their series, column values inside the column top, the line's values above their points on a halo (every point up to 8 categories, else the first and last). Column values the line still covers are dropped; when one value is wider than its column, every column value sits above its column instead (labels.grandTotal: false hides them). With valueLabels 'all' (the anatomy's default up to 8 categories) every value is labelled, so neither tick column is drawn and the axis titles key both series in one row from the left; valueAxis.show or secondaryAxis.show brings the ticks back, and so does a value that finds no seat. Authored valueAxis.min or max, or a negative value, keep the plain dual axis and report the info lint dual-axis-anatomy-off."),
    valueLabels: z
      .enum(['none', 'last', 'ends', 'extremes', 'all'])
      .optional()
      .describe("Which line values print, each at its point; the key row names the series. 'none', 'last' (default; the dual-axis anatomy defaults to 'all' up to 8 categories, else 'ends'), 'ends' (first and last), 'extremes' (ends plus low and high) or 'all'. Interior values sit on the side away from other lines, never nearer another line, or on the column with a backing; authored cell labels always print.").meta({ 'x-boardplot-defaultDependsOn': ['dualAxis.anatomy'] }),
    latestPoint: z
      .enum(['ring', 'none'])
      .optional()
      .describe("Ring the last observed point of the lead line in the highlight colour, r 4.5 with a dot inside it, as on the line chart. 'ring' picks the first line series that is not a prior year, plan or forecast, and a forecast or plan point is never the one ringed. 'none' rings nothing, including the ring a theme with an ink lead line draws by default; omitted, the theme decides.").meta({ 'x-boardplot-defaultDependsOn': ['theme'] }),
    averageMarker: averageMarkerSchema.describe("Computed dashed average rule with a solver-placed Ø label on the primary axis, as on column: the mean over every category of the column stack, the columns in scope summed ('all' by default). A line named in the scope is left out with the warning average-marker-scope."),
    referenceStyle: z.enum(['tick', 'line', 'marker']).optional().describe("How reference series draw, as on bar and column: 'tick' (default) a solid plan tick across the column, 'line' the same span dashed at 1.25px, 'marker' a dot at the column centre.").meta({ default: 'tick' }),
    referenceTick: z
      .object({
        width: z.number().positive().max(8).optional().describe('Stroke width of the tick in px; default 2.2.').meta({ default: 2.2 }),
        color: z.enum(['ink', 'highlight']).optional().describe("Ink of the tick; default 'ink', or the series fill or colorRole where one is set. 'highlight' is the accent for the one mark the reader should find first."),
      })
      .strict()
      .optional()
      .describe("Weight and ink of the reference tick, as on bar, read under referenceStyle 'tick' only: the dashed 'line' keeps its 1.25px and the 'marker' its dot."),
    events: eventOptionsSchema.optional(),
  })
  .superRefine(addCanvasBoundsIssues).superRefine(refuseBadgeEvents) as unknown as z.ZodType<ComboOptions>;
