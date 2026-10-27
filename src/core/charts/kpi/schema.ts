/** Kpi data and options schemas, without the chart engine. */

import * as z from 'zod';
import { formatExample } from '../../schema/shared';
import { baseOptionsSchema, comparisonDirectionSchema, cellSchema, refusedBaseOptions, scenarioField } from '../../schema/shared';
import type { KpiData } from '../../types/data';
import { valueBandsSchema } from '../../bands';
import { sparkLabelsProblem } from './sparkLabels';
import type { KpiOptions } from '../../types/options';

export const kpiDataSchema = z.strictObject({
  label: z.string().min(1).describe("Name of the metric displayed above the main value."),
  value: z.number().finite().describe("Main metric value in its original units."),
  format: formatExample.optional().describe("Format-by-example for the main metric and absolute comparison values (a % example expects percent units: 3.53 for 3.53%)."),
  delta: z
    .strictObject({
      vs: z.number().finite().describe("Reference value subtracted from the main metric."),
      scenario: scenarioField('Code of the comparison baseline; a baseline with its own name, such as a month, goes in compare[].label instead.'),
      direction: comparisonDirectionSchema.optional().describe("Whether an increase from the reference is favorable. neutral prints ordinary ink without a judgment; omission keeps higherIsBetter."),
      mode: z.enum(['absolute', 'relative', 'both']).optional().describe("Display absolute change, relative change, or both. Defaults to relative. A zero or negative vs shows the absolute change with a ref-nonpositive warning; under a percent format the absolute change prints in pp."),
    })
    .optional().describe("Single scenario comparison; cannot be combined with compare."),
  compare: z
    .array(
      z.strictObject({
        vs: z.number().finite().describe("Reference value for this named comparison."),
        label: z.string().trim().min(1).describe("Visible name of this comparison baseline."),
        direction: comparisonDirectionSchema.optional().describe("Whether an increase from this reference is favorable. neutral prints ordinary ink without a judgment; omission keeps higherIsBetter."),
        mode: z.enum(['absolute', 'relative', 'both']).optional().describe("Display absolute change, relative change, or both. Defaults to both. A zero or negative vs shows the absolute change with a ref-nonpositive warning; under a percent format the absolute change prints in pp."),
      }),
    )
    .max(2)
    .optional().describe("One or two named comparisons below the metric; cannot be combined with delta. An empty compare list is the same as none."),
  attainment: z
    .strictObject({
      vs: z.number().finite().describe("Target value used as the attainment denominator."),
      label: z.string().trim().min(1).describe("Visible name of the attainment target."),
      tone: z.enum(['good', 'bad', 'warn', 'neutral']).optional().describe("Attainment tone. Omitted, it is the tone of the comparison against the same reference, else neutral."),
    })
    .optional().describe("Ratio of the main value to a named target, displayed as attainment."),
  bands: valueBandsSchema.optional().describe("Qualitative bands for the main value, ascending by `to`. The band that holds the value sets the tone of the main value only; comparison tones stay separate. A band without a tone keeps the plain ink. A band `label` is added to the screen-reader text and the record."),
  note: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Authored caption under the value: the basis, filter or scope the number is true of. Printed as written; the card never composes it.'),
  spark: z
    .strictObject({
      kind: z.enum(['line', 'area', 'column'])
        .describe("Shape-only sparkline. 'column' is zero-anchored. The last observed value is labelled unless the card's figure already prints it. No axes."),
      values: z.array(cellSchema).min(1).describe("Trend observations in chronological order, in the same base units as the main value; the card format labels the last observed value unless it reads the same as the card's figure. A last value 1000 times or more off the main value is refused (spark-scale-mismatch). Missing cells create gaps."),
      labels: z.array(z.string()).optional().describe("One period name per value, such as 'W1' or 'Jan'. The card prints the first and the last under the spark's ends, so the reader sees the span."),
    })
    .optional().describe("Small trend chart displayed beneath the KPI comparison content."),
}).refine((data) => !(data.delta && data.compare?.length), {
  path: ['compare'],
  message: 'kpi accepts either delta or compare, not both',
}).superRefine((data, ctx) => {
  // One label per value, none empty: the remove patch drops them.
  const message = sparkLabelsProblem(data.spark);
  if (message) ctx.addIssue({ code: 'custom', path: ['spark', 'labels'], message, params: { refused: true } });
}) as unknown as z.ZodType<KpiData>;

export const kpiOptionsSchema = baseOptionsSchema.safeExtend(refusedBaseOptions('kpi')).safeExtend({
  labels: baseOptionsSchema.shape.labels.describe("False hides comparisons and spark endpoint values. The main number, metric name and authored note remain. total: false explicitly hides the main number."),
  density: z.enum(['compact', 'regular']).optional()
    .describe("Card density. 'compact' uses the smaller figure and spark share, and a 280 px default card width instead of 360. An unsized card takes its content height. 'regular' is the default."),
  comparisons: z.enum(['chip', 'text']).optional()
    .describe("How compare[] and attainment are drawn. Omitted, a standalone regular card without a spark draws the steering form: the comparisons as rows of toned text with their names in a column, the attainment as a progress bar with a 100% tick, in one band on a wide card; a grid panel, a compact card, a card with a spark and a card whose height cannot hold the form draw chips. 'chip' tints a chip behind each; 'text' draws each as delta is drawn: text in its tone, no fill, compare entries on one row."),
})
  .describe('Standalone KPI width defaults to 360px and is capped at 420px. Metric text is at least 13px; comparisons sit directly under the value. Minimum height includes measured card text and comparison rows. Nested grid sizing stays separate.') as unknown as z.ZodType<KpiOptions>;
