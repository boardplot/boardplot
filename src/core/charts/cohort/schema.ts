/** Cohort data and options schemas, without the chart engine. */

import * as z from 'zod';
import { baseOptionsSchema, idSchema, refusedBaseOptions } from '../../schema/shared';
import { AVERAGE_ROW_ID } from './retention';
import type { CohortData, CohortOptions } from './types';

const cohortSchema = z.strictObject({
  id: idSchema.describe("Unique cohort identity; the computed average-row id is reserved."),
  label: z.string().optional().describe("Displayed cohort name; defaults to its id."),
  // Null marks a missing count inside the reached span, not a future period.
  active: z
    .array(
      z
        .number()
        .int({
          message:
            'a cohort count is a whole number of members; round to whole members, or scale revenue/FTE retention to whole units before plotting',
        })
        .nonnegative({ message: 'a cohort count cannot be negative' }).nullable(),
    )
    .min(1, { message: 'active[0] is the cohort base; supply at least the period-0 count' }).describe("Whole nonnegative active-member counts from period zero onward; null is a missing count. The first count must be a known positive cohort base; shorter rows leave later periods unobserved."),
  size: z
    .number()
    .int({ message: 'a declared cohort base is a whole number of members' })
    .nonnegative({ message: 'a declared cohort base cannot be negative' })
    .optional()
    .describe('Declared cohort base; VERIFIED against active[0], never used in its place.'),
});

export const cohortDataSchema = z
  .strictObject({
    periodLabel: z
      .string()
      .min(1)
      .optional()
      .describe("Period unit, e.g. 'Month' -> columns M0, M1, ...; omitted gives 'Period 0'."),
    cohorts: z
      .array(cohortSchema)
      .min(2, { message: 'a cohort triangle compares at least two cohorts; one cohort is a line chart' }).describe("At least two cohorts in chronological order, oldest first."),
  })
  .superRefine((data, ctx) => {
    const seen = new Set<string>();
    data.cohorts.forEach((cohort, index) => {
      if (cohort.id === AVERAGE_ROW_ID) {
        ctx.addIssue({
          code: 'custom',
          path: ['cohorts', index, 'id'],
          message: `cohort id '${AVERAGE_ROW_ID}' is reserved for the computed average row`,
        });
      }
      if (seen.has(cohort.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['cohorts', index, 'id'],
          message: `duplicate cohort id '${cohort.id}'`,
        });
      }
      seen.add(cohort.id);
    });
  }) as unknown as z.ZodType<CohortData>;

export const cohortOptionsSchema = baseOptionsSchema.safeExtend(refusedBaseOptions('cohort')).safeExtend({
  format: baseOptionsSchema.shape.format.describe("Rate format in percentage units, such as '1.0%' or '1.00' for two decimals without a sign on exhibit tables. Default: a decimal below 10%, whole percent otherwise on the heatmap. Exhibit tables share the needed decimal precision. The M0 anchor is neutral and the colour scale stays fixed at 0–100%."),
  basis: z
    .enum(['cohort', 'previous'])
    .optional()
    .describe(
      "'cohort' = active / cohort base (comparable down a column); 'previous' = active / the previous period's active.",
    ),
  averages: z
    .union([z.literal(false), z.literal('weighted')])
    .optional()
    .describe('Weighted column average = total active / total base of the observed cohorts.'),
  methodNote: z
    .boolean()
    .optional()
    .describe(
      "Default false. true adds the measure formula and explains the visible anchor column and blank cells. strings.cohortMeasure and strings.cohortFormula name another count-based measure, such as cumulative conversion. Required interpretation notes still print: the formula under basis 'previous', not-meaningful cells, weighted averages and rates too narrow to print.",
    ),
  variant: z
    .enum(['heatmap', 'pure', 'stepped'])
    .optional()
    .describe(
      "Form. 'heatmap' (the default) draws the heatmap surface, which honours 'labels'. 'pure' and 'stepped' draw the exhibit. Stepped columns share the width the label and size columns leave, as pure columns do, and preserve weighted-average and missing-cell notes. The exhibit variants draw a fixed label set, so authoring 'labels' together with variant is refused (the legacy surface honours it).",
    ),
  formatScope: z
    .enum(['classic', 'column'])
    .optional()
    .describe("Stepped fills use absolute bins ('classic') or normalize within each period ('column')."),
  steps: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])
    .refine((steps) => steps.every((step, index) => index === 0 || step > steps[index - 1]!), 'steps must ascend')
    .optional()
    .describe("Four ascending thresholds in percentage points that split the absolute ('classic') stepped fills into five classes the key names, such as [70, 80, 85, 90] for period-to-period retention. Default [30, 40, 50, 60]."),
  visiblePeriods: z.array(z.number().int().nonnegative()).min(1).optional().describe("Original zero-based period indices displayed in chronological order by exhibit presets."),
  cohortSizeLabel: z.string().min(1).optional().describe("Header for the exhibit cohort-size column; defaults to Cohort size."),
  showPercentSign: z.boolean().optional().describe("Print a percent sign in every exhibit cell; defaults to false because the unit is stated once."),
  threshold: z.union([z.number().finite(), z.literal(false)]).optional().describe("Pure-exhibit emphasis threshold in percentage points: cohort and total rates above it print bold; period 0 stays neutral. A note prints only when a visible cell uses that emphasis. Defaults to 60; false disables emphasis and its note."),
  designatedPeriod: z.number().int().nonnegative().optional().describe("Original zero-based period index receiving the pure-exhibit column tint; defaults to 3."),
  total: z.union([z.literal(false), z.literal('weighted')]).optional().describe("Exhibit summary row: weighted retention by default, or false to hide it. Never averages cohort percentages equally."),
  excludeCurrentPeriod: z.boolean().optional().describe("Remove the newest cohort and longest period before exhibit derivation."),
  exhibitLabel: z.string().min(1).optional().describe("Short exhibit heading above the assertion title."),
})
  // Cohort honours `labels` only on the legacy heatmap surface: the exhibit
  // presets return early into layoutCohortExhibit, which draws a fixed
  // consulting-table label set and never consults the toggle map (the exhibit
  // output with labels:false is byte-identical). Half-implemented is the same defect class as
  // unimplemented, so the combination is refused rather than accepted inert.
  .superRefine((options, ctx) => {
    // steps name the absolute classes; nothing else draws them.
    if (options.steps !== undefined && (options.variant !== 'stepped' || options.formatScope !== 'classic')) {
      ctx.addIssue({
        code: 'custom',
        path: ['steps'],
        message: "'steps' sets the absolute classes of variant 'stepped' with formatScope 'classic' and does nothing elsewhere; set both, or drop 'steps'",
      });
    }
    if (options.variant !== undefined && options.variant !== 'heatmap' && (options as { labels?: unknown }).labels !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['labels'],
        message:
          "'labels' is not implemented by the cohort exhibit variants — pure and stepped draw a fixed label set; drop 'labels', or set variant 'heatmap', which honours it",
      });
    }
  }) as unknown as z.ZodType<CohortOptions>;
