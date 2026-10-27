/** Column data and options schemas, without the chart engine. */

import * as z from 'zod';
import { CONNECTOR_STYLE_DESCRIPTION } from '../seriesConnector';
import { parseFormatExample, specUnitKind } from '../../formatSpec';
import { rangeCellSchema } from '../../range';
import { bandWindowOptionsSchema } from '../../live/schema';
import type { ChartData } from '../../types/data';
import { othersShadeDescribe } from '../../othersShade';
import type { ColumnOptions } from '../../types/options';
import {
  colorRoleField,
  addCategorySeriesIdIssues,
  anomalyOptionSchema,
  averageMarkerSchema,
  baseOptionsSchema,
  derivedRatioTierSchema,
  eventOptionsSchema,
  idSchema,
  partialCategorySchema,
  refusedBaseOptions,
  refuseUnstackedShares,
  categoryDateSchema,
  valueKindSchema,
  scenarioField,
  contextFormatExample,
  formatExample,
  dataValueKindSchema,
  categorySchemaOf,
} from '../../schema/shared';
import { addSeriesKindIssues, seriesAxisField, seriesKindField } from '../../schema/seriesKind';

/**
 * A format example that parses and prints something other than a percent. A
 * format that does not parse already has its one invalid-format finding.
 */
function notPercentExample(example: string): boolean {
  try {
    return specUnitKind(parseFormatExample(example)) !== 'percent';
  } catch {
    return false;
  }
}

/** Bare category string ⇒ { id, label }. */
const categorySchema = categorySchemaOf({
  nonEmpty: true,
  label: z.string().optional().describe("Displayed category name; defaults to the category id and supports line breaks. A date id or `date` without a label prints a short date such as 'Sep'. Day ticks include the month ('2 Oct', or 'Fri 2 Oct' where room allows). A separate row carries the year under day, month and quarter ticks."),
  date: categoryDateSchema.optional().describe("ISO 8601 category date, yyyy-mm-dd; strictly increasing dates permit date-axis promotion where supported."),
  fields: {
    total100: z.number().optional().describe("Authored quantity represented by 100%; otherwise percentage variants derive their basis from the category values."),
    gapAfter: z
      .union([z.boolean(), z.number().nonnegative()])
      .optional()
      .describe('Extra band-step fractions after this category; true defaults to 0.5.'),
    breakAfter: z
      .boolean()
      .optional()
      .describe('Category axis break after this category: a gap of at least half a band step with the straight break glyph on the category baseline. Series connectors and net-line steps do not cross it.'),
  },
  after: {
    partial: partialCategorySchema,
    role: z.enum(['data', 'total']).optional().describe("'total' sets a summary column apart: gap and divider before it, bold head and values, no ribbons or connectors into it. On stacked100 with all its cells null and total100 (respondent base) on every other column, it prints the base-weighted share Σ total100 × share / Σ total100 (a percent cell is the share as authored, a count cell's share is count / total100), not the mean of the group shares. A series with a null in some group keeps an empty total cell and warns total-not-computed."),
  },
});

/** Positional cells or point-keyed { categoryId, value } entries. */
const seriesSchema = z.strictObject({
  kind: seriesKindField,
  axis: seriesAxisField,
  valueKind: valueKindSchema,
  id: idSchema.describe("Series identity used by keyed options, annotations and legend entries."),
  label: z.string().optional().describe("Displayed series name; defaults to the series id."),
  values: z.array(
    z.union([rangeCellSchema, z.strictObject({ categoryId: idSchema.describe("Category id identifying this value independently of array position."), value: rangeCellSchema.describe("Cell assigned to the named category in this series.") })]),
  ).describe("Values in category order, or keyed entries pairing a categoryId with its value."),
  scenario: scenarioField('Controls scenario labels and paint conventions.'),
  direction: z.enum(['higherIsBetter', 'lowerIsBetter']).optional().describe("Whether increases are favorable; defaults to higherIsBetter for directional comparisons."),
  role: z.enum(['data', 'reference']).optional().describe("Data series or comparison-only reference series; references are excluded from the main plotted data."),
  colorRole: colorRoleField("Theme color role used for this series when no explicit fill takes precedence."),
  fill: z.string().optional().describe("Explicit CSS fill color for this series; remains authored across theme changes."),
  unit: z.string().optional().describe("Unit of this series' values, used to check shared-scale compatibility. Without a format example, a $k, $m, k or m unit prints its labels whole from 100 up, in place of options.unit."),
  format: formatExample.optional().describe("Format-by-example for this series' labels, for example 1,234 or 1.2%. Overrides options.format."),
});

export const columnDataSchema = z
  .strictObject({
    valueKind: dataValueKindSchema,
    categories: z.array(categorySchema).min(1).describe("Ordered categories defining the displayed columns or positions and positional value alignment."),
    series: z.array(seriesSchema).min(1).describe("Series supplying values for each category, with optional reference series for comparisons."),
  })
  .superRefine((data, ctx) => {
    addCategorySeriesIdIssues(ctx, data, () => {
      addSeriesKindIssues(ctx, data.series, 'column');
    });
  }) as unknown as z.ZodType<ChartData>;

export const columnOptionsSchema = baseOptionsSchema.safeExtend(refusedBaseOptions('column')).safeExtend({
  labelDensity: baseOptionsSchema.shape.labelDensity.describe("Value-label density. Default 'smart': every value stays eligible. A chart with more than 12 categories, or with most labels wider than the band, ranks the first, last, highest and lowest value (ties: the first) first. The other values then use only their natural seat beside the mark; with none free they are drawn nowhere and left out of the note. Those four may take one step, and the note names any that finds no seat. A smaller chart keeps every value on the bounded one-step rule and names any that finds no seat. 'full' treats all values alike and names every one that finds no seat. 'minimal' also applies the shared priority gate. Seats stay inside the plot band and one step from the natural seat. All values remain in reading records. When valueLabels is set, it wins: labelDensity is not read for the value labels."),
  legend: baseOptionsSchema.shape.legend.describe("Key position. Multiple series get a key by default unless visible direct labels name them all. 'none' hides the key and warns if names are missing. Subtitle and footnote mentions do not replace the key."),
  axisTitles: z.strictObject({
    primary: z.string().trim().min(1).optional().describe("'Measure, unit' title over the value axis, e.g. 'Revenue, €m'."),
  }).optional().describe("Title over the value axis when valueAxis.show draws it, in the top row left of the plot. A theme with valueAxis.titles derives 'Measure, unit' from subtitle.measure and a unit the drawn subtitle does not print, when none is authored."),
  valueLabels: z
    .enum(['none', 'last', 'ends', 'extremes', 'all'])
    .optional()
    .describe("Which values print, with line's choices: 'none', 'last', 'ends' (first and last), 'extremes' (first, last, highest and lowest; a tie takes the first) or 'all', chosen per series over the categories in their drawn order. Unset (default): every value is eligible and labelDensity decides. When set, valueLabels wins over labelDensity: each chosen value takes the one-step rule of 'full', and one with no seat is named in the note. A value not chosen is unlabelled by choice: the note does not name it, and the value axis is drawn so it stays readable (all modes but 'all'; valueAxis.show false turns it off). Authored cell labels and flagged anomaly periods print in every mode. Grouped only: a stack has no single value per category, so stacked and stacked100 refuse every mode but 'all' with value-labels-variant. Example: 24 monthly columns with 'extremes' print the first, peak, low and last value."),
  variant: z.enum(['grouped', 'stacked', 'stacked100']).optional().describe("Vertical arrangement: grouped by default, stacked in raw units, or stacked100 as category percentages. Plain stacked series use theme.overrides.color.stack, not color.series. Set options.palette or series fill for categorical colours."),
  grandTotalLabels: z.boolean().optional().describe("Show category stack-total labels in addition to segment labels; default on for the stacked variant and off for stacked100, where every bar would end on the same share. true keeps the absolute total on a 100% stack."),
  sharesOfOneWhole: z.boolean().optional().describe("true declares every stacked series a share of the same whole, such as channel shares of all orders: the stack then has a total, and percent series warn non-additive-stack only where a category adds to more than 100. Stacked and stacked100 only; refused on other variants."),
  referenceStyle: z.enum(['tick', 'line', 'marker']).optional().describe("Reference-series mark style; defaults to tick."),
  netLine: z
    .union([
      z.boolean(),
      z.object({
        seriesId: idSchema
          .optional()
          .describe('Series whose cumulative boundary receives a tick; omitted uses the positive stack top, or the negative stack bottom when no value is positive.'),
        connectors: z
          .boolean()
          .optional()
          .describe('Connect adjacent category ticks as a stepped line; defaults to true for columns.'),
      }),
    ])
    .optional()
    .describe('Per-category ticks at a cumulative boundary of stacked columns, connected by default.'),
  averageMarker: averageMarkerSchema.describe('Computed dashed average rule with a solver-placed Ø label.'),
  connectors: z
    .union([
      z.boolean(),
      z.object({
        style: z
          .enum(['line', 'dashed'])
          .optional()
          .describe(CONNECTOR_STYLE_DESCRIPTION),
        scope: z
          .union([z.literal('all'), z.array(idSchema)])
          .optional()
          .describe("Series boundaries to connect; defaults to 'all'."),
      }),
    ])
    .optional()
    .describe('Connect matching series boundaries between adjacent stacked columns.'),
  ribbons: z
    .union([
      z.boolean(),
      z.strictObject({
        order: z.enum(['rank', 'sheet']).optional().describe("'rank' (stacked default) stacks each column by its own values, largest on top; a crossing is a rank swap. 'sheet' (stacked100 default) keeps the series order, as an answer scale needs."),
      }),
    ])
    .optional()
    .describe("Ribbon chart: translucent bands (S-curves when ranked, straight in sheet order) join each series' segments in adjacent columns. Stacked variants only. Only for ordered columns (periods, waves, age bands); between nominal groups a band implies a false flow, so use connectors. Ranked ribbons narrow the columns; names default to seriesLabels right-edge; bands stop at a gap, break or total column. Over 6 ranked series warn ribbon-crowded. Not a sankey: nothing splits or merges."),
  ratioTier: derivedRatioTierSchema.optional(),
  seriesRamp: z.boolean().optional().describe(
    "true paints the data series on the theme's ordered ramp instead of its categorical palette, for series whose order is the encoding (acquisition cohorts, oldest first): the first series takes the full mark ink, each later one a weaker rung, and every rung reaches 3:1 on the page in the light and the dark scheme. A series fill or colorRole keeps its own paint. Default false.",
  ),
  othersShade: z.enum(['quietest', 'apart']).optional().describe(othersShadeDescribe("With seriesRamp and a Rest series (colorRole 'others'): how the ramp sits beside Rest.")),
  signColor: z
    .boolean()
    .optional()
    .describe(
      "Paint each column good/bad/neutral by sign(value) × series.direction (zero is neutral). Under series.direction 'lowerIsBetter' the encoding INVERTS — positives paint bad, negatives good — so the chart brings its own legend naming the polarity in words; suppressing it with legend 'none' is reported as legend-suppressed-encoding. Requires variant 'grouped' with exactly one data-role series; anything else is refused with sign-color-unsupported. Cells with an explicit fill, a highlight, or the topN 'Others' bucket keep their own paint and report sign-color-overridden.",
    ),
  anomaly: anomalyOptionSchema.optional().describe(
    "Flag exceptional periods against a visible, named corridor. 'mad' applies the modified z-score |x − c| / (1.4826 × MAD) > k, which does not let an outlier inflate its own threshold; 'threshold' applies authored bounds with no statistics at all. TWO DIFFERENT NUMBERS, never conflated: c is the CENTRE of the judgement, which is 0 under the default baseline 'zero' and the series' median under baseline 'median'; MAD is median|x − median| and is ALWAYS measured around the actual median, whichever baseline is in force. So under the default the corridor is centred on 0 while its width comes from the spread around the median, and both numbers are printed. Needs exactly one data-role series and an absolute variant. Fewer than 8 non-null values, or MAD = 0, flags nothing and says so (anomaly-sample-too-small / anomaly-mad-zero) — no mean ± sigma is ever substituted. Every render emits the anomaly-method info warning carrying method, baseline, k (dimensionless), centre, median, MAD, scale, n and the flag count. The decision runs on unrounded values; if two periods print the same label on opposite sides of the cut, anomaly-flag-label-tie says so. This is NOT an SPC control chart: no run rules, no subgroup limits, no seasonality adjustment.",
  ),
  seriesLabels: z
    .strictObject({
      at: z.enum(['right-edge', 'left-edge']).describe("Where the names sit, on the middle of each named layer: 'right-edge' beside the last column, 'left-edge' before the first, right-aligned."),
      only: z.array(idSchema).min(1).optional().describe('The series that carry a name; without it every stacked series gets one, and the solver hides the ones that do not fit.'),
      cagr: z
        .union([
          z.literal(true).describe('From the first to the last category.'),
          z.strictObject({
            from: idSchema.optional().describe('First category of the span; default the first category.'),
            to: idSchema.optional().describe('Last category of the span; default the last category.'),
            format: contextFormatExample.optional().describe('Percent format-by-example for the rates, such as +0.00% for two decimals; default one decimal.'),
          }).superRefine((span, ctx) => {
            if (span.format !== undefined && notPercentExample(span.format)) {
              ctx.addIssue({ code: 'custom', path: ['format'], message: 'a CAGR prints a percent, so its format is a percent example such as +0.0% or +0.00%' });
            }
          }).describe('Over a chosen span, or with a chosen format.'),
        ])
        .optional()
        .describe("Series CAGR: each name carries its series' compound annual growth rate over the span, 'Product B +10.1% p.a.', with a claim record per series. The years come from the categories' ISO dates or year-bearing labels; a series with a missing value, a start at or below zero or a negative end prints its name alone and warns; an end of zero reads -100%."),
    })
    .optional()
    .describe('Name the stacked series once, at the right edge of the LAST column or the left edge of the FIRST, instead of in a legend: the layers of a cohort chart are read off their own bars. Stacked variants only; a grouped chart keeps its legend.'),
  shareLabels: z
    .strictObject({
      only: z.array(idSchema).min(1).optional().describe('Categories whose segment labels print value and share, such as the last year only; the other columns print the value alone. Default every column.'),
      format: contextFormatExample.optional().describe('Percent format-by-example for the shares, such as 26.3% for one decimal; default whole percent, one decimal under 1%.'),
    })
    .superRefine((shares, ctx) => {
      if (shares.format !== undefined && notPercentExample(shares.format)) {
        ctx.addIssue({ code: 'custom', path: ['format'], message: 'a share prints a percent, so its format is a percent example such as 26.3%' });
      }
    })
    .optional()
    .describe("Where and how stacked segment labels print their share of the column: '30 (26.3%)' in the last year only. Adds the share to labels.segment in the columns named by only and drops it from the others. Stacked and stacked100 variants; a grouped chart has no shares and warns."),
  events: eventOptionsSchema.optional(),
  window: bandWindowOptionsSchema.optional(),
  viewDomain: z.object({ x: z.tuple([idSchema, idSchema]).describe('Inclusive category ids bounding the visible x axis.') }).optional().describe('Zoom the visible categories. Means, the average marker and anomaly rules keep every source period. A mean\'s Ø label names the periods it covers where the plot draws fewer, \'Ø 40.4 (Jan 25–Dec 26)\'. Refused with a category sort or topN, which break the period order.'),
}).superRefine(refuseUnstackedShares) as unknown as z.ZodType<ColumnOptions>;

