/** Box data and options schemas, without the chart engine. */

import * as z from 'zod';
import { addDuplicateIdIssues, baseOptionsSchema, idSchema, primaryAxisTitleSchema, refusedBaseOptions } from '../../schema/shared';
import type { BoxData, BoxOptions } from './types';

// `.strict()` is the difference between REJECTING a pre-computed summary and
// silently deleting it. A caller (or a model) that sends `{id, observations,
// q1, median, q3}` was told by the module comment that summaries are rejected;
// a non-strict object would strip the three keys, draw quartiles that disagree
// with the ones that were sent, and say nothing. Precedent: line, bar,
// choropleth and tilemap all use strict data schemas.
const groupSchema = z
  .object({
    id: idSchema,
    label: z.string().optional().describe('Visible group name; defaults to the group id.'),
    date: z.string().optional().describe('ISO observation date for CAGR between group snapshots; requires a positive date interval.'),
    observations: z
      .array(z.number().finite())
      .describe(
        'Raw observations. Pre-computed q1/median/q3 are rejected in v1: quartiles the engine cannot recompute cannot be checked.',
      ),
  })
  .strict();

export const boxDataSchema = z
  .object({
    groups: z.array(groupSchema).min(1).describe('Observation groups whose quartiles and whiskers are computed by the engine. Rows: category,value; optional categoryLabel,date.'),
  })
  .strict()
  .superRefine((data, ctx) => {
    addDuplicateIdIssues(ctx, data.groups, ['groups'], {
      name: 'group',
      keys: 'observations and scene identities',
    });
  }) as unknown as z.ZodType<BoxData>;

export const boxOptionsSchema = baseOptionsSchema.safeExtend(refusedBaseOptions('box')).safeExtend({
  axisTitles: primaryAxisTitleSchema('under the tick row, ending at the right end of the axis'),
  whiskers: z
    .enum(['tukey', 'minmax', 'p10p90'])
    .optional()
    .describe(
      "Whisker rule. 'tukey' (default): most extreme observations within 1.5xIQR of the quartiles. 'minmax': whiskers reach every observation. 'p10p90': whiskers at the 10th/90th type-7 percentile.",
    ).meta({ default: 'tukey' }),
  showOutliers: z
    .boolean()
    .optional()
    .describe(
      "Draw values beyond the whisker rule individually. Default true; ignored for minmax. Under 'tukey' those values are outliers; under 'p10p90' they are the outer deciles, which every sample has. Setting it false withholds real observations from both the ink and the value axis, and the exhibit says so in a footnote.",
    ).meta({ default: true }),
  showObservations: z
    .enum(['none', 'small-n'])
    .optional()
    .describe("Default 'small-n': groups with fewer than 5 observations plot their values instead of a box.").meta({ default: 'small-n' }),
  methodNote: z
    .boolean()
    .optional()
    .describe(
      "Default false. true adds the footnote stating the quartile definition and the Tukey whisker rule. A 'minmax' or 'p10p90' whisker rule changes what whiskers and dots mean, so its note prints regardless, as do the small-n dot note and the note on withheld observations.",
    ).meta({ default: false }),
  boxValues: z
    .enum(['median', 'all'])
    .optional()
    .describe("Default 'median': each box prints its median. 'all' also prints Q1 and Q3 under the box edges and the whisker ends under the caps, so a quartile or percentile reads as a number.").meta({ default: 'median' }),
}) as unknown as z.ZodType<BoxOptions>;
