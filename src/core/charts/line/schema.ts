/** Line data and options schemas, without the chart engine. */

import * as z from 'zod';
import { liveWindowOptionsSchema } from '../../live/schema';
import {
  colorRoleField,
  addCategorySeriesIdIssues, addDuplicateIdIssues,
  addProjectedDashIssues,
  annotationArraySchema,
  annotationSchema,
  timeAnnotationSchema,
  anomalyOptionSchema,
  baseOptionsSchema,
  detailCellSchema,
  derivedRatioTierSchema,
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
import { addSeriesKindIssues, seriesAxisField, seriesKindField } from '../../schema/seriesKind';
import { othersShadeDescribe } from '../../othersShade';
import { timeAnnotationAnchors } from '../../timeAxis';
import type { LineChartData } from '../../types/data';
import type { LineOptions } from './types';

const targetSchema = z
  .strictObject({
    at: idSchema.describe('Category id receiving the target marker.'),
    value: z.number().finite().describe("Target value in the series scale at the named category."),
    label: z.string().min(1).optional().describe("Optional authored text identifying the target."),
  })
  .strict();

const optionTargetSchema = targetSchema.extend({
  seriesId: idSchema.describe('Data-series id the target marker belongs to.'),
});

const categoryAnnotationsSchema = annotationArraySchema(annotationSchema);

const lineAnnotationSchema = timeAnnotationSchema.superRefine((annotation, ctx) => {
  if (annotation.kind !== 'event') return;
  const placement = (annotation as Record<string, unknown>).labelPlacement;
  if (placement !== undefined && placement !== 'top' && placement !== 'inline') {
    ctx.addIssue({
      code: 'custom',
      path: ['labelPlacement'],
      message: "event labelPlacement must be 'top' or 'inline'",
    });
  }
});

/** Bare category string ⇒ { id, label }. */
const categorySchema = categorySchemaOf({
  nonEmpty: true,
  label: z.string().optional().describe("Displayed category name; defaults to the category id and supports line breaks. A date id or `date` without a label prints a short date such as 'Sep'. Day ticks include the month ('2 Oct', or 'Fri 2 Oct' where room allows). A separate row carries the year under day, month and quarter ticks."),
  date: categoryDateSchema.optional().describe("ISO 8601 category date, yyyy-mm-dd; strictly increasing dates permit date-axis promotion where supported."),
  fields: {
    total100: z.number().optional().describe("Authored quantity represented by 100%; otherwise percentage variants derive their basis from the category values."),
    gapAfter: z.union([z.boolean(), z.number()]).optional().describe("Category spacing hint accepted by the data schema; this chart does not apply band-step gaps."),
    breakAfter: z.boolean().optional().describe("Reserved category discontinuity hint; does not create an axis break in this chart."),
  },
  after: {
    partial: partialCategorySchema,
  },
});

/** Positional cells or point-keyed { categoryId, value } entries. */
const seriesSchema = z.strictObject({
  kind: seriesKindField,
  axis: seriesAxisField,
  valueKind: valueKindSchema,
  id: idSchema.describe("Series identity used by keyed options, annotations and legend entries."),
  label: z.string().optional().describe("Displayed series name; defaults to the series id."),
  shortLabel: z.string().min(1).optional().describe("Short end-label name. End labels get 18% of the effective width: Boardplot tries the full label on one line, then on two, then shortLabel with a full-name legend key, then a legend with value-only end labels. legend 'none' removes the shortLabel and legend steps, a labelPlacements pin the legend step. Boardplot adds no abbreviation or ellipsis."),
  values: z.array(z.union([detailCellSchema, z.strictObject({ categoryId: idSchema.describe("Category id identifying this value independently of array position."), value: detailCellSchema.describe("Cell assigned to the named category in this series.") })])).describe("Values in category order, or keyed entries pairing a categoryId with its value."),
  scenario: scenarioField('Controls scenario labels and paint conventions.'),
  role: z.enum(['data', 'reference']).optional().describe("Data series or comparison-only reference series; references are excluded from the main plotted data."),
  colorRole: colorRoleField("Theme color role used for this series when no explicit fill takes precedence."),
  fill: z.string().optional().describe("Explicit CSS fill color for this series; remains authored across theme changes."),
  unit: z.string().optional().describe("Unit of this series' values, used to check shared-scale compatibility. Without a format example, a $k, $m, k or m unit prints its labels whole from 100 up, in place of options.unit."),
  format: formatExample.optional().describe("Format-by-example for this series' labels, for example 1,234 or 1.2%. Overrides options.format."),
  lineStyle: z.enum(['solid', 'dashed', 'dotted']).optional().describe("Stroke pattern; dashed and dotted strokes require a projected scenario such as FC or PL."),
  marker: z.enum(['circle', 'square', 'triangle', 'diamond', 'none']).optional().describe("Point symbol; none suppresses point markers."),
  smooth: z.boolean().optional().describe("Use monotone interpolation when true or linear interpolation when false; omission inherits chart interpolation."),
  interpolateGaps: z.boolean().optional().describe("true bridges a missing cell with a dashed segment and a hollow ring per missing category; false breaks the line, and an area fill, there, so no line suggests a value that is not there. Stacked variants (stacked-area, stacked100-area) stack a null as zero and do not break. Default false."),
  targets: z.array(targetSchema).optional().describe("Authored target markers for this series at named categories."),
});

/** One x value of a continuous axis: an ISO 8601 date or date-time, epoch milliseconds, or a plain number. */
const xValueSchema = z.union([z.string().min(1), z.number().finite()]);

export const lineDataSchema = z
  .strictObject({
    valueKind: dataValueKindSchema,
    categories: z.array(categorySchema).min(1).optional().describe("Categories in display order, with matching positional values. Required unless data.x gives continuous x values."),
    x: z.array(xValueSchema).min(1).optional().describe("Continuous x values, one per reading, with options.xAxis setting their type; replaces categories. Each series' values then match x by position. Under xAxis.type 'time', an ISO 8601 date or date-time ('2026-10-25', '2026-10-25T02:30', seconds and milliseconds allowed) with an optional Z or UTC offset ('2026-10-25T02:30+01:00'), or epoch milliseconds; a time without an offset is a wall-clock time in xAxis.zone. Under 'number', finite numbers. Values may come in any order: the chart sorts the readings by x and places each at its value, so uneven readings keep their spacing. A repeated x is refused (x-duplicate). A wall-clock time in the hour a zone repeats when its clocks go back is read from the order of the values (an increasing run that comes back through the hour reads the first pass at the summer offset); one the order cannot place is refused (x-time-ambiguous), as is a time the zone skips (x-time-skipped). Example: ['2026-10-25T01:55', '2026-10-25T02:00', '2026-10-25T02:05']."),
    partial: z.array(xValueSchema).min(1).optional().describe("With data.x: the x values whose period the readings cover only in part, such as a first or last week that starts or ends mid-week. Each marks its reading as categories[].partial does (hollow marker, a note naming it). Each must be the x of a reading, read as data.x is read; one that names no reading warns (x-partial-no-reading) and marks nothing. Example: ['2026-01-05']."),
    series: z.array(seriesSchema).min(1).describe("Series supplying values for each category, with optional reference series for comparisons."),
  })
  .superRefine((data, ctx) => {
    if (data.x !== undefined && data.categories !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['x'], message: 'give the readings as data.x or as data.categories, not both: x places them by value on a continuous axis, categories in order' });
      return;
    }
    if (data.partial !== undefined && data.x === undefined) {
      ctx.addIssue({ code: 'custom', path: ['partial'], message: 'data.partial names x values of data.x; with data.categories, mark a category with categories[].partial' });
    }
    if (data.x === undefined && data.categories === undefined) {
      ctx.addIssue({ code: 'custom', path: ['categories'], message: 'line needs data.categories, or data.x with options.xAxis for a continuous axis' });
      return;
    }
    addCategorySeriesIdIssues(ctx, { ...data, categories: data.categories ?? [] }, () => {
      addProjectedDashIssues(ctx, data.series);
      addSeriesKindIssues(ctx, data.series, 'line');
    });
  }) as unknown as z.ZodType<LineChartData>;

/** At most six named levels: past that the column is a table and the reader stops matching names to bands. */
const REFERENCE_BAND_LIMIT = 6;

const referenceBandSchema = z
  .strictObject({
    id: idSchema.optional().describe("Stable identity of the band, used in scene ids and warnings; default 'band-<n>' in authored order. Example: 'strong'."),
    value: z.number().finite().optional().describe('One level in the value-axis units, drawn as a 4 px band centred on it. Give value or low and high, not both. Example: 60.'),
    low: z.number().finite().optional().describe('Lower edge of a range band in the value-axis units, with high; a range thinner than 4 px still draws 4 px. Example: 35.'),
    high: z.number().finite().optional().describe('Upper edge of a range band, above low. Example: 40.'),
    label: z.string().trim().min(1).describe("REQUIRED. The band's name, printed bold at the start of its entry in the column right of the plot: the level or range as the reader should say it. Example: '60+'."),
    description: z.string().trim().min(1).optional().describe("What the level means, in plain type after the name; it wraps under it when the column is narrow. Example: 'very strong cycle'."),
  })
  .superRefine((band, ctx) => {
    const range = band.low !== undefined || band.high !== undefined;
    if (band.value !== undefined && range) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'a reference band is one level (value) or a range (low and high), not both' });
    } else if (band.value === undefined && !range) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'a reference band needs a level (value) or a range (low and high)' });
    } else if (range && (band.low === undefined || band.high === undefined)) {
      ctx.addIssue({ code: 'custom', path: [band.low === undefined ? 'low' : 'high'], message: 'a range band needs both low and high; for one level use value' });
    } else if (range && band.low! >= band.high!) {
      ctx.addIssue({ code: 'custom', path: ['high'], message: `a range band needs low below high (low ${band.low}, high ${band.high})` });
    }
  });

const xTickValueSchema = z.union([z.string().min(1), z.number().finite()]);

const xAxisSchema = z
  .strictObject({
    type: z.enum(['time', 'number']).describe("REQUIRED. 'time' reads data.x as instants and draws a time axis in xAxis.zone; 'number' reads plain numbers."),
    zone: z.string().min(1).optional().describe("Time only. IANA time zone of the ticks, the labels and of every x time without an offset, such as 'Europe/Berlin' or 'America/New_York'. Default 'UTC'. A note under the chart names it ('Time zone: Europe/Berlin'), with the offsets where they change inside the range ('(UTC+2, then UTC+1)'). Zone rules come from the host's Intl time zone data."),
    min: xTickValueSchema.optional().describe('Start of the axis, an x value. Default: the first reading. A start after the first reading leaves the earlier readings undrawn (info x-range-cut); one before it leaves room.'),
    max: xTickValueSchema.optional().describe('End of the axis, an x value. Default: the last reading. An end before the last reading leaves the later readings undrawn (info x-range-cut).'),
    tickStep: z
      .union([
        z.number().positive().describe("Number axes: the tick step in x units, ticks at its multiples."),
        z.strictObject({
          unit: z.enum(['millisecond', 'second', 'minute', 'hour', 'day', 'week', 'month', 'quarter', 'year']).describe('Calendar unit of the step.'),
          step: z.number().int().positive().optional().describe('Units per step; default 1. 6 with hour ticks at 00, 06, 12 and 18 local time.'),
        }).describe("Time axes: ticks on the zone's wall clock (hours from midnight, days at midnight, weeks on locale.weekStartsOn, months on the 1st, quarters in January, April, July and October, years on 1 January)."),
      ])
      .optional()
      .describe("Authored tick step instead of the automatic ladder. Ticks whose labels would overlap thin to every second, third or later tick and warn x-ticks-thinned. Not with ticks."),
    ticks: z
      .array(z.union([xTickValueSchema, z.strictObject({ value: xTickValueSchema.describe('The x value of the tick.'), label: z.string().optional().describe('Text printed at the tick instead of the formatted value.') })]))
      .min(1)
      .optional()
      .describe("Explicit ticks: x values, or { value, label } pairs. Ticks outside the axis range are dropped; labels that would overlap thin and warn x-ticks-thinned. Not with tickStep."),
    format: z.string().min(1).optional().describe("Tick label format. Time: a pattern of yyyy, yy, MMMM, MMM, MM, M, dddd, ddd, dd, d, HH, H, hh, h, mm, ss, a and 'quoted literals', such as 'HH:mm' or 'd MMM'; default by step: 'HH:mm' (24-hour clock in every language), '24 Oct' (en-US 'Oct 24'), 'Oct', 'Q4', '2026'. Number: a format-by-example such as 1,234.5 or 0.0%, through the shared number formatting."),
    title: z.string().trim().min(1).optional().describe("Axis title printed under the tick row at the right end, such as 'Distance, km'."),
    unit: z.string().trim().min(1).optional().describe("Number axes: the unit of x, which names the trend slope ('+0.42 per km'). Without it the slope reads 'per unit of x'."),
    maxTicks: z.number().int().min(2).max(24).optional().describe('Most ticks the automatic ladder draws; default 10. The ladder takes the finest step whose labels fit with that count.').meta({ default: 10 }),
  })
  .superRefine((axis, ctx) => {
    if (axis.ticks !== undefined && axis.tickStep !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['ticks'], message: 'give ticks or tickStep, not both: ticks names each tick, tickStep the spacing' });
    }
    if (axis.tickStep !== undefined && (typeof axis.tickStep === 'number') !== (axis.type === 'number')) {
      ctx.addIssue({ code: 'custom', path: ['tickStep'], message: axis.type === 'time' ? "a time axis takes tickStep as { unit, step }, such as { unit: 'hour', step: 6 }" : 'a number axis takes tickStep as a positive number, such as 0.5' });
    }
    if (axis.zone !== undefined && axis.type !== 'time') {
      ctx.addIssue({ code: 'custom', path: ['zone'], message: "zone applies to xAxis.type 'time' only" });
    }
    if (axis.unit !== undefined && axis.type !== 'number') {
      ctx.addIssue({ code: 'custom', path: ['unit'], message: "unit applies to xAxis.type 'number'; a time axis names its slope per second, minute, hour or day" });
    }
  })
  .describe("Continuous x axis on line and area: readings placed by value, for times with a time of day in a named zone or for plain numbers. Opt-in: needs data.x, and without xAxis the axis stays an ordered category row. Ticks come from a ladder (time: 1, 5, 15 and 30 seconds and minutes; 1, 3, 6 and 12 hours; 1 and 2 days; weeks; months; quarters; 1, 2, 5, 10 years and up; numbers: 1-2-5 steps), the finest whose labels fit, at most maxTicks. Under clock times a second row names each day ('Sat 24 Oct'); under days, weeks, months and quarters it names the year. Hover cards, keyboard records and the data table name each reading in full ('Sun 25 Oct 2026, 02:35', with the offset in a repeated hour). Lines, areas, gaps (null breaks the line), trend lines (fitted on the real x), min-max sampling (buckets by x), events and bands (at any x), value lines and point annotations (at the x of a reading) work as on categories. A CAGR annotation counts the exact years between its two readings on a time axis; a number axis has no years and warns x-cagr-unsupported. Not with variant 'bump' or categoryAxis.");

export const lineOptionsSchema = baseOptionsSchema.safeExtend(refusedBaseOptions('line')).safeExtend({
  trend: z.union([z.boolean(), z.strictObject({ label: z.string().min(1).optional().describe('Name of the fitted lines in the legend; default Linear trend.') })]).optional().describe("One least-squares line per shown data series, using the shared scatter fit. Fits every non-null source value in the shown range, with at least 3 points; min-max sampling changes the drawn points, not the fit. Regular month, quarter and year dates fit on the calendar period index and keep their spacing; exact 7-day steps fit per week; other dates use elapsed UTC days and exact date spacing; other categories use their original positions. The dashed series-colour line covers only its fitted range and is clipped to the value axis. The legend prints the series name, signed slope per month, quarter, year, week, day or period, and r². The layout derived.trends receipt carries slope, intercept, r² and the fit moments. Plain line and area only; stacks and bump refuse trend-unsupported. Too few points warn trend-undefined. A window or zoom changes the fitted range. Default false."),
  rounding: baseOptionsSchema.shape.rounding.describe("stacked100-area defaults to sum-consistent rounding of complete computed wholes. Authored percentages and incomplete total100 bases keep their values. nearest rounds each computed share separately. Other line variants do not use this setting."),
  window: liveWindowOptionsSchema.optional().describe("Display the last n periods and optionally sample extrema while preserving source calculations, ranks, uncertainty intervals and phase boundaries. A mean's Ø label names the periods it covers where the plot draws fewer, 'Ø 54.3 (Day 1–Day 20)'."),
  viewDomain: z.object({ x: z.tuple([z.union([idSchema, z.number().finite()]), z.union([idSchema, z.number().finite()])]).describe('Inclusive category ids bounding the visible x axis; on a continuous axis (xAxis), two x values.') }).optional().describe("Visible categories with full-source means and index baselines. A mean's Ø label names the periods it covers where the plot draws fewer. On a continuous axis the two x values bound the visible range exactly, and the readings inside it draw."),
  xAxis: xAxisSchema.optional(),
  annotations: annotationArraySchema(lineAnnotationSchema).optional().describe('Data-bound annotations. On a time x axis, each x anchor also accepts epoch milliseconds, including categoryId in an object anchor and event date/end. A numeric delta.vs stays a comparison value; use { categoryId: epoch } to compare with another reading.'),
  anomaly: anomalyOptionSchema.optional().describe("Flag exceptional periods of the one drawn line against a visible, named corridor, with column's rule: 'mad' flags |x − c| / (1.4826 × MAD) > k (c is 0 under the default baseline 'zero', the median under 'median'; the spread is always measured around the median), 'threshold' flags values outside authored bounds. The corridor rules carry their numbers, each flagged point gets a marker beyond it and prints its value, the legend keys the marker and the corridor, and a footnote states the rule. Needs the plain line variant with exactly one drawn series. Under a window or zoom the rule keeps every source period. Fewer than 8 values or MAD = 0 flags nothing and says so."),
  events: eventOptionsSchema.optional(),
  axisTitles: z.strictObject({
    primary: z.string().trim().min(1).optional().describe("'Measure, unit' title over the value axis, e.g. 'Revenue, $m'."),
  }).optional().describe("Title over the value axis when valueAxis.show draws it, in the top row left of the plot. A theme with valueAxis.titles derives 'Measure, unit' from subtitle.measure and a unit the drawn subtitle does not print, when none is authored. A rank ladder (variant 'bump') takes none."),
  endLabelPlacement: z.enum(['gutter', 'lineEnd']).optional().describe("Position of early-ending series labels. 'gutter' puts every end label in the column right of the plot with a leader; 'lineEnd' (default) puts it beside the series' own last point, right of it or above or below, and falls back to the gutter with a leader when those collide. Area variants keep the gutter. Default: the theme's labels.endLabelPlacement, else 'lineEnd'. To move one label, pin it in labelPlacements. Its valid slots depend on the data, so a wrong slot warns unknown-slot and lists the slots of that render.").meta({ 'x-boardplot-defaultDependsOn': ['theme', 'variant'] }),
  variant: z.enum(['line', 'area', 'stacked-area', 'stacked100-area', 'bump']).optional().describe('Line geometry. Forecast areas use hatching; forecast lines use a contrast-safe tint. Actual-to-forecast transitions add a divider with the FC header centred over it, reusing authored period furniture. Area endpoints have leaders. An unstacked area with several series fills one, the lead (the first highlighted series, else the first), and draws the others as lines on top, so no fill hides another or reads as a stacked band; it says so in the info line-area-lead. Use stacked-area when the series add up to a total. Stacked and 100% area values sit wholly on their band, the first and last moved inward along it; stacked100-area values need twice their measured label height and shared band edges have 1px separators. valueAxis.percent sets stacked100-area, which draws each series as its share of the category sum; for lines of percentages use data valueKind \'fraction\' or a percent format instead.'),
  bump: z
    .object({
      direction: z.enum(['higherIsBetter', 'lowerIsBetter']).optional().describe("Ranking direction across series; higherIsBetter places the largest value first."),
      focus: z.array(idSchema).min(1).max(12).optional().describe("The entities to draw, at most 12. Every series is still ranked; the others are named in a note with their last rank and keep their values in the data table. A bump of more than 12 entities without focus is refused (bump-series-limit)."),
    })
    .strict()
    .optional()
    .describe(
      "Rank preset controls (variant 'bump'); direction is chart-level because ranking compares series against each other.",
    ),
  seriesLabels: z
    .union([
      z.enum(['end', 'inline', 'key', 'none']),
      z.strictObject({
        only: z.array(idSchema).min(1).describe('The series named at their line ends; the others get neither a name nor a value, so twelve cohort curves read under four names.'),
      }),
    ])
    .optional()
    .describe(
      "Where series names print; a name carries no value, except where two or more lines end within a line of each other at the last category: there each name takes its last value. On report, dashboard, slide and print, plain-line names use medium weight at the label role size, in a contrast-safe series colour. Values use regular weight. Crowded blocks use one line if two lines would move more than three label line heights from the endpoint. If one line cannot fit within that bound, a right-hand key lists names and end values from highest to lowest, with a reading disclosure. 'end' (default): a column just past the line ends, names only, short leaders; too wide for 18% of the width, shortLabel, then the key row. 'inline': on a clear stretch of each line; the last values still print. An authored 'end' or 'inline' that ends in the key row warns line-end-label-key. 'key': a key row above the plot. 'none': no names; two or more drawn series still get the key row (info series-labels-key) unless legend is set. A lone 'line' defaults to 'none'. { only } names the listed series and gives the rest no name and no value.",
    ).meta({ 'x-boardplot-defaultDependsOn': ['variant', 'data.series'] }),
  valueLabels: z
    .enum(['none', 'last', 'ends', 'extremes', 'all'])
    .optional()
    .describe(
      "Point values: default last, inline and bump none, stacked100-area ends. Distinct end values that round to the same text gain up to two decimals as one label set; the reading uses that precision. Bump keeps the precision used to rank its values. Choices: 'none' (default under seriesLabels 'inline'), 'last' (default), 'ends' (first and last; stacked100-area default), 'extremes' (ends plus each series' low and high) or 'all'. A value sits on the side of its point away from other lines and never nearer another line than its own; one with no free seat goes to the note line, and missing labels warn label-hidden once per chart; reading.omissions names each label and its destination. Stacked values sit in their band. labels.point sets the content. When the author sets valueLabels and every non-null value in a series has a string label (ignoring label:false cells), valueLabels selects the values and each selected value uses its cell text. Otherwise a string cell label also selects its point, outside the valueLabels selection, even when labels.point is false. label:false removes a value label. bump defaults to 'none'; its values are the measure behind the ranks, so each carries the unit, and without a unit or format it warns bump-values-unnamed.",
    ).meta({ 'x-boardplot-defaultDependsOn': ['variant', 'seriesLabels'] }),
  latestPoint: z
    .union([
      z.enum(['ring', 'none']).describe("'ring' rings the primary series; 'none' rings nothing."),
      z.strictObject({
        series: idSchema.describe('The series whose last observed point is ringed.'),
        marker: z.literal('ring').optional().describe("Marker shape; 'ring' is the only one and the default.").meta({ default: 'ring' }),
      }).describe('Ring the named series.'),
    ])
    .optional()
    .describe("Ring the last observed point in the highlight colour, r 4.5 with a dot inside it: the newest cohort of a curves chart, the current period of a trend. 'ring' picks the primary series, the hero where emphasis names one and otherwise the first data series that is not a prior year, plan or forecast; { series } names one outright. Default 'none'. Line and area variants only: a stacked band's last point is the top of the stack, so stacked-area and stacked100-area refuse it.",
    ).meta({ default: 'none' }),
  emphasis: z
    .enum(['first', 'ordered', 'none'])
    .optional()
    .describe(
      "Multi-series line colouring. 'none': every series takes its theme ramp colour, color.series[i], in data order. 'first': the first series takes ink at 2.4px and the others step back to muted context tints, for one line read against context. 'ordered': the series take the theme's ordered ramp in data order, the first the lightest (still 3:1 on the page) and the last the full ink, for series whose order is the encoding, such as cohorts; a highlighted series keeps the focus and a series fill or colorRole its own colour. Unset means 'none', except on a drawn fan, whose centre is the subject and takes the ink ('first'). Plain line variant only; highlight, palette, series fill, colorRole and series-level scenario keep their own colours (cell-level FC and PL keep their dash notation), and an explicit 'first' that cannot apply, including on a single drawn series, warns line-emphasis-ignored.",
    ),
  othersShade: z.enum(['quietest', 'apart']).optional().describe(othersShadeDescribe("With emphasis 'ordered' and a Rest series (colorRole 'others'): how the ramp sits beside Rest.")),
  highlightMode: z
    .enum(['grey', 'fade'])
    .optional()
    .describe("How options.highlight treats the other series. 'grey': one grey ladder, today's look. 'fade': they keep their own colour, washed toward the page, and the highlighted series keeps its colour at 2.6px.")
    .meta({ default: 'grey' }),
  scenarioStyle: z
    .partialRecord(
      z.enum(['AC', 'PY', 'PL', 'FC']).describe('Scenario the weight and ink apply to.'),
      z.object({
        width: z.number().positive().max(8).optional().describe('Stroke width in px for the lines of this scenario.'),
        ink: z.enum(['ink', 'inkMuted']).optional().describe('Which neutral ink the lines of this scenario take.'),
      }).strict().describe('Weight and ink one scenario takes.'),
    )
    .optional()
    .describe(
      "Weight and ink per scenario, opt-in. A board that draws an actual against its prior year authors { AC: { width: 1.5, ink: 'ink' }, PY: { width: 1, ink: 'inkMuted' } }; without it every line keeps the default 2px and its ramp colour. An authored series fill or colorRole, a highlight and emphasis: 'first' all still win, and a series with no scenario is untouched.",
    ),
  rebase100: z.union([z.boolean(), z.object({ at: idSchema.describe("Category whose nonzero value becomes 100 in each series.") })]).optional().describe("Index each series to 100 at the first category, or at the supplied category id. A series with a missing or zero base is not drawn, and the key names it. Ignored for stacked100-area."),
  ratioTier: derivedRatioTierSchema.optional(),
  interpolate: z
    .enum(['linear', 'step-after', 'step-before', 'monotone'])
    .optional()
    .describe('Line and overlaid-area interpolation; monotone uses the shared Steffen curve authority.'),
  phases: z
    .array(
      z
        .object({
          id: idSchema.describe("Unique phase identity used by scene elements and diagnostics."),
          label: z.string().min(1).describe("Visible name of this category-span phase."),
          from: idSchema.describe("First category id included in the phase."),
          to: idSchema.describe("Last category id included in the phase."),
          tone: z.enum(['neutral', 'muted', 'highlight', 'good', 'bad', 'warn']).optional().describe("Semantic fill tone for the phase; choose tone or rank, not both."),
          rank: z.number().int().min(1).optional().describe("One-based palette rank for the phase; choose rank or tone, not both."),
        })
        .strict()
        .superRefine((phase, ctx) => {
          if (phase.tone !== undefined && phase.rank !== undefined) {
            ctx.addIssue({
              code: 'custom',
              path: ['tone'],
              message: `phase '${phase.id}' chooses both tone and rank; use one fill authority`,
            });
          }
        }),
    )
    .min(1)
    .superRefine((phases, ctx) => {
      const seen = new Set<string>();
      phases.forEach((phase, index) => {
        if (seen.has(phase.id)) {
          ctx.addIssue({
            code: 'custom',
            path: [index, 'id'],
            message: `duplicate phase id '${phase.id}'`,
          });
        }
        seen.add(phase.id);
      });
    })
    .optional()
    .describe('Contiguous category-span partition painted beneath one visible data series.'),
  gapFill: z
    .object({
      between: z.tuple([idSchema, idSchema]).describe('Exactly two named series bounding the wash.'),
      positiveTone: z.enum(['good', 'bad', 'neutral']).optional().describe("Wash tone where the first named series is above the second."),
      negativeTone: z.enum(['good', 'bad', 'neutral']).optional().describe("Wash tone where the first named series is below the second."),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (value.between[0] === value.between[1]) {
        ctx.addIssue({ code: 'custom', path: ['between'], message: 'gapFill requires two distinct series ids' });
      }
    })
    .optional().describe("Shade the signed difference between two named series, splitting the wash where they cross. The key names each tone; a neutral wash between two lines named at their ends or inline gets no key row. A delta or diff between the same two series at the last category draws the gap bracket by default."),
  fan: z
    .object({
      of: idSchema.describe('Central trajectory series id; the bands are painted around it.'),
      bands: z
        .array(
          z
            .object({
              low: idSchema.describe('Series id carrying the lower bound of this band.'),
              high: idSchema.describe('Series id carrying the upper bound of this band.'),
              label: z
                .string()
                .min(1)
                .describe(
                  "REQUIRED. What the interval means — '80% predictive interval', 'P10-P90 of 500 sims' and 'min/max of three scenarios' are drawn identically and mean different things.",
                ),
            })
            .strict(),
        )
        // No .max(4) here ON PURPOSE: the cap is enforced in the layout so a
        // five-band doc fails with `fan-too-many-bands` and its suggestion,
        // not with a generic zod 'too_big' the author has to decode.
        .min(1)
        .describe('1..4 nested bands, authored OUTERMOST FIRST.'),
      showBounds: z
        .boolean()
        .optional()
        .describe('Also draw the bound series as dotted hairlines; default false.').meta({ default: false }),
    })
    .strict()
    .optional()
    .describe(
      'Uncertainty fan: nested bands declared as ordinary series pairs. The engine derives no quantiles — it paints declared numbers and verifies their nesting.',
    ),
  targets: z.array(optionTargetSchema).optional().describe("Chart-level target markers, each naming its owning series and category."),
  methodNote: z
    .boolean()
    .optional()
    .describe(
      'Default false. true adds the method footnote of a bump chart: how ranks are derived and how ties are ranked. A fan whose interval is undeclared at some periods and near-zero end labels that were folded print their notes regardless.',
    ).meta({ default: false }),
  referenceBands: z
    .array(referenceBandSchema)
    .min(1)
    .max(REFERENCE_BAND_LIMIT, { error: `at most ${REFERENCE_BAND_LIMIT} reference bands: more named levels than that read as a table, so keep the levels the title talks about` })
    .superRefine((bands, ctx) => addDuplicateIdIssues(ctx, bands.flatMap((band, index) => (band.id === undefined ? [] : [{ id: band.id, issuePath: [index, 'id'] }])), [], { name: 'reference band', keys: 'scene ids and warnings' }))
    .optional()
    .describe(
      "Named reference levels behind the line, such as the cycle regimes of a growth rate: each band is one level (value) or a range (low, high) in the value-axis units, drawn as a thin neutral band across the plot. Each is named in a column right of the plot, the bold label then the plain description; where the names have to spread apart to fit, a thin elbow leader ties each name to its band, and the leaders never cross each other or the line. The value axis reaches every band. At most 6 bands; overlapping bands warn reference-band-overlap, a band named only by numbers warns reference-band-unexplained. Not on variant 'bump'. Example: [{ \"value\": 60, \"label\": \"60+\", \"description\": \"very strong cycle\" }, { \"low\": 35, \"high\": 40, \"label\": \"35 to 40+\", \"description\": \"typical cycle\" }].",
    ),
}).superRefine((options, ctx) => {
  const numericAnchors = options.annotations?.some((annotation) => ['at', 'from', 'to', 'date', 'end', 'vs'].some((key) => {
    const value = (annotation as Record<string, unknown>)[key];
    if (key === 'vs' && typeof value !== 'object') return false;
    return typeof value === 'number' || (value !== null && typeof value === 'object' && 'categoryId' in value && typeof value.categoryId === 'number');
  }));
  if (numericAnchors && options.xAxis?.type !== 'time') {
    const checked = categoryAnnotationsSchema.safeParse(options.annotations);
    if (!checked.success) for (const issue of checked.error.issues) ctx.addIssue({ ...issue, path: ['annotations', ...issue.path] });
  }
  // A rank ladder has no value units for a level to live in.
  if (options.variant === 'bump' && options.referenceBands !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['referenceBands'],
      message: "referenceBands are levels in value units, and variant 'bump' plots ranks; drop referenceBands or draw the values with variant 'line'",
    });
  }
  // A stacked band's last point is the top of the stack, not the series' value.
  if ((options.variant === 'stacked-area' || options.variant === 'stacked100-area') && options.latestPoint !== undefined && options.latestPoint !== 'none') {
    ctx.addIssue({
      code: 'custom',
      path: ['latestPoint'],
      message: `latestPoint rings a series' own last value, and on a ${options.variant} chart that point is the top edge of the stack; use it on the 'line' or 'area' variant, or drop it`,
    });
  }
}).overwrite((options) => options.xAxis?.type === 'time' && options.annotations
  ? { ...options, annotations: options.annotations.map((annotation) => timeAnnotationAnchors(annotation) as typeof annotation) }
  : options) as unknown as z.ZodType<LineOptions>;
