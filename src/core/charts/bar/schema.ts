/** Bar data and options schemas, without the chart engine. */

import * as z from 'zod';
import { CONNECTOR_STYLE_DESCRIPTION } from '../seriesConnector';
import { rangeCellSchema } from '../../range';
import { refusalSuggest } from '../../schema/capabilityReasons';
import type { ChartData } from '../../types/data';
import {
  colorRoleField,
  addCategorySeriesIdIssues,
  averageMarkerSchema,
  baseOptionsSchema,
  idSchema,
  partialCategorySchema,
  refusedBaseOptions,
  refuseUnstackedShares,
  categoryDateSchema,
  valueKindSchema,
  scenarioField,
  formatExample,
  dataValueKindSchema,
  categorySchemaOf,
} from '../../schema/shared';
import type { BarOptions } from '../../types/options';

const categorySchema = categorySchemaOf({
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
  },
});

const seriesSchema = z.strictObject({
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
  format: formatExample.optional().describe("Format-by-example for this series' labels, for example 1,234 or 1.2%. Overrides options.format; a cell format overrides it."),
});

export const barDataSchema = z
  .strictObject({
    valueKind: dataValueKindSchema,
    categories: z.array(categorySchema).min(1).describe("Ordered categories defining the displayed rows and positional value alignment."),
    series: z.array(seriesSchema).min(1).describe("Series supplying values for each category, with optional reference series for comparisons."),
  })
  .superRefine((data, ctx) => {
    addCategorySeriesIdIssues(ctx, data);
  }) as unknown as z.ZodType<ChartData>;

const BAR_RIBBONS_REFUSED = refusalSuggest('bar', ['ribbons'])!;

export const barOptionsSchema = baseOptionsSchema.safeExtend(refusedBaseOptions('bar')).safeExtend({
  labelDensity: baseOptionsSchema.shape.labelDensity.describe("Value-label density. Default 'smart': every value stays eligible. A chart with more than 12 categories, or with most labels wider than the band, ranks the first, last, highest and lowest value (ties: the first) first. The other values then use only their natural seat beside the mark; with none free they are drawn nowhere and left out of the note. Those four may take one step, and the note names any that finds no seat. A smaller chart keeps every value on the bounded one-step rule and names any that finds no seat. 'full' treats all values alike and names every one that finds no seat. 'minimal' also applies the shared priority gate. Seats stay inside the plot band and one step from the natural seat. All values remain in reading records. When valueLabels is set, it wins: labelDensity is not read for the value labels."),
  legend: baseOptionsSchema.shape.legend.describe("Key position. Multiple series get a key by default unless visible direct labels name them all. 'none' hides the key and warns if names are missing. Subtitle and footnote mentions do not replace the key."),
  axisTitles: z.strictObject({
    primary: z.string().trim().min(1).optional().describe("'Measure, unit' title of the value axis, e.g. 'Margin, %'."),
  }).optional().describe("Title of the value axis when valueAxis.show draws it: in the tick-label row, ending at the right end of the axis past the last tick label or short of the first tick label, and in a row of its own under the ticks only when neither side has room. A theme with valueAxis.titles derives 'Measure, unit' from subtitle.measure and a unit the drawn subtitle does not print, when none is authored."),
  valueLabels: z
    .enum(['none', 'last', 'ends', 'extremes', 'all'])
    .optional()
    .describe("Which values print, with line's choices: 'none', 'last', 'ends' (first and last), 'extremes' (first, last, highest and lowest; a tie takes the first) or 'all', chosen per series over the categories in their drawn order. Unset (default): every value is eligible and labelDensity decides. When set, valueLabels wins over labelDensity: each chosen value takes the one-step rule of 'full', and one with no seat is named in the note. A value not chosen is unlabelled by choice: the note does not name it, and the value axis is drawn so it stays readable (all modes but 'all'; valueAxis.show false turns it off). Authored cell labels print in every mode. Grouped only: a stack has no single value per category, so stacked, stacked100, football-field and tornado refuse every mode but 'all' with value-labels-variant. Example: a ranking of 12 bars with 'extremes' prints the top, bottom, highest and lowest value."),
  variant: z.enum(['grouped', 'stacked', 'stacked100', 'football-field', 'tornado']).optional().describe("Horizontal arrangement; grouped by default. Stacked100 normalizes category totals; football-field shows ranges and tornado compares low/high driver cases."),
  sharesOfOneWhole: z.boolean().optional().describe("true declares every stacked series a share of the same whole, such as channel shares of all orders: the stack then has a total, and percent series warn non-additive-stack only where a category adds to more than 100. Stacked and stacked100 only; refused on other variants."),
  baseValue: z
    .union([
      z.number().finite(),
      z
        .object({
          value: z.number().finite().describe("Base-case output value used as the tornado comparison spine."),
          label: z.string().min(1).optional().describe("Label naming the tornado base case."),
        })
        .strict(),
    ])
    .optional()
    .describe(
      "Tornado base-case output metric; the vertical spine every swing is measured against. Required for variant 'tornado'.",
    ),
  tornado: z
    .object({
      low: idSchema.describe('Series carrying the output metric with this driver at its LOW input.'),
      high: idSchema.describe('Series carrying the output metric with this driver at its HIGH input.'),
    })
    .strict()
    .optional()
    .describe(
      "Tornado case identity. Two named series, not one range cell: a range normalizes low>high away and would destroy an inverse driver's case colouring.",
    ),
  currentValue: z
    .union([
      z.number().finite(),
      z
        .object({
          value: z.number().finite().describe("Current output value marked across the football-field ranges."),
          label: z.string().min(1).optional().describe("Authored label for the football-field current-value marker."),
        })
        .strict(),
    ])
    .optional()
    .describe('Football-field vertical current-value marker; number shorthand uses an automatic label.'),
  methodNote: z
    .boolean()
    .optional()
    .describe(
      'Default false. true adds the method footnotes: the mid-point tick of a football-field range, drawn only with its note, and the one-at-a-time contract of a tornado. Hatched tornado bars and drivers that could not be drawn are required for interpretation and print regardless.',
    ),
  grandTotalLabels: z.boolean().optional().describe("Show category stack-total labels in addition to segment labels; default on for the stacked variant and off for stacked100, where every bar would end on the same share. true keeps the absolute total on a 100% stack."),
  referenceStyle: z.enum(['tick', 'line', 'marker']).optional().describe("Reference-series mark style; defaults to tick. Line references use a 1.25px stroke."),
  referenceTick: z
    .object({
      width: z.number().positive().max(8).optional().describe('Stroke width of the tick in px; default 1.6.'),
      color: z.enum(['ink', 'highlight']).optional().describe("Ink of the tick; default 'ink'. 'highlight' is the accent for the one mark the reader should find first."),
    })
    .strict()
    .optional()
    .describe("Weight and ink of the reference tick, read under referenceStyle 'tick' only: the dotted 'line' uses stroke.rule and the 'marker' its neutral dot. A prior-year mark that must stand out is { width: 2, color: 'highlight' }."),
  signColor: z
    .boolean()
    .optional()
    .describe(
      "Paint each bar good/bad/neutral by sign(value) × series.direction (zero is neutral), as on column. Under series.direction 'lowerIsBetter' the encoding inverts, positives paint bad and negatives good, so the chart brings its own legend naming the polarity in words; suppressing it with legend 'none' is reported as legend-suppressed-encoding. colorblindSafe swaps the pair for the colour-vision-safe one. Requires variant 'grouped' with exactly one data-role series; anything else is refused with sign-color-unsupported. Cells with an explicit fill, a highlight, or the topN 'Others' bucket keep their own paint and report sign-color-overridden.",
    ),
  netLine: z
    .union([
      z.boolean(),
      z.object({
        seriesId: idSchema
          .optional()
          .describe('Series whose cumulative boundary receives a tick; omitted uses the positive stack end.'),
        connectors: z
          .boolean()
          .optional()
          .describe('Must remain false for bars because structural category axes carry no sequence.'),
      }),
    ])
    .optional()
    .describe('Per-category ticks at a cumulative boundary of stacked bars; connectors default to false.'),
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
    .describe('Connect matching series boundaries between adjacent stacked bars.'),
  ribbons: z
    .never({ error: BAR_RIBBONS_REFUSED })
    .optional()
    .describe(`Refused on 'bar': ${BAR_RIBBONS_REFUSED}`),
}).superRefine((options, ctx) => {
  refuseUnstackedShares(options, ctx);
  if (typeof options.netLine === 'object' && options.netLine.connectors === true) {
    ctx.addIssue({
      code: 'custom',
      path: ['netLine', 'connectors'],
      message:
        'bar netLine connectors cannot be true: structural category axes carry no sequence; use per-category ticks only',
    });
  }
}) as unknown as z.ZodType<BarOptions>;
