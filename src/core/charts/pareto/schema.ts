/** Pareto data and options schemas, without the chart engine. */

import * as z from 'zod';
import { addDuplicateIdIssues, baseOptionsSchema, idSchema, refusedBaseOptions } from '../../schema/shared';
import type { ParetoOptions } from '../../types/options';
import type { ParetoData } from './layout';
import { categoryLabelsSchema } from '../../schema/categoryLabels';

// `.strict()` is the whole point on this data path. Elsewhere in the repo an
// unknown key on `data` is silently accepted; here a dropped `cumulative`,
// `share` or `pct` key would mean the caller believes it authored the curve
// while the engine quietly derived a different one. Rejecting is the only
// honest answer. Precedent: box, line, bar, choropleth, tilemap.
const itemSchema = z
  .object({
    id: idSchema,
    label: z.string().optional().describe('Visible category name; defaults to the item id.'),
    date: z.string().optional().describe('Optional ISO period date for CAGR between explicitly named items. Does not change the descending value order.'),
    value: z
      .union([z.number(), z.null()])
      .describe(
        'Count or amount. Shares are DERIVED: a percent cell, a null, a negative or a non-finite value is refused with its own error code.',
      ),
    rest: z.boolean().optional().describe('An authored aggregate remainder. Kept last and included in the cumulative denominator, excluded from the vital-few ranking. At most one remainder. A tail that topN folds joins it: one remainder column, with the authored label and no member count.'),
    fill: z.string().optional().describe('Authored CSS colour for this item; preserved across theme changes.'),
  })
  .strict();

export const paretoDataSchema = z
  .object({
    items: z.array(itemSchema).min(1).describe('Category contributions ranked by descending value to derive cumulative shares.'),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.items.filter(item => item.rest).length > 1) ctx.addIssue({ code: 'custom', path: ['items'], message: 'Pareto accepts at most one authored rest item' });
    addDuplicateIdIssues(ctx, data.items, ['items'], {
      name: 'item',
      keys: 'contributions, cumulative shares and scene identities',
    });
  }) as unknown as z.ZodType<ParetoData>;

export const paretoOptionsSchema = baseOptionsSchema
  .safeExtend(refusedBaseOptions('pareto'))
  .safeExtend({
    topN: baseOptionsSchema.shape.topN.describe('Keep the n largest causes. rest: false hides only the remainder column (the folded tail, or the authored rest that holds it); its labelled curve point and the full-population total remain.'),
    // `.omit({ sort: true })` would refuse nothing: a zod object STRIPS
    // unknown keys, so `sort` would parse away silently and leave the
    // published JSON Schema. Refusing it out loud is the same call the
    // shared table makes.
    sort: z
      .never({
        error:
          "'sort' is not accepted on a pareto: the ranking IS the analysis — a Pareto chart is descending by contribution by construction, and the cumulative curve and the vital-few set are only meaningful in that order",
      })
      .optional()
      .describe('Refused: a Pareto is descending by contribution by construction.'),
    categoryLabels: categoryLabelsSchema.describe("'staircase' names each cause over the lower columns; it needs cumulative: false, as the curve climbs through that space. Default 'axis'."),
    threshold: z
      .union([z.number().gt(0).lt(100), z.literal(false)])
      .optional()
      .describe(
        'Cumulative-share reference, default 80. A convention to choose, not a property of the data: 80 is the classic Pareto rule, 90 or 95 asks which causes carry nearly all of the total. The dashed rule is drawn at the value, and the highlighted vital few and their key follow it. false draws the curve with no reference and no vital-few split: every column in one colour, no key.',
      ),
    cumulative: z
      .boolean()
      .optional()
      .describe('Draw the derived cumulative curve. Default true; false also withholds the threshold rule.'),
    axisTitles: z
      .object({
        primary: z.string().trim().min(1).optional().describe('Title over the left value axis.'),
      })
      .strict()
      .optional()
      .describe("Title over the left value axis, which is drawn by default. Drawn when authored, or as 'Measure, unit' under a theme that derives value-axis titles."),
    totalScale: z
      .boolean()
      .optional()
      .describe('Scale the left axis to the total: 100% on the right sits level with the total on the left, so the curve starts at the top of the first column and each column reads against the curve. Default false: the column axis is capped on the columns alone and the curve rides its own 0-100% scale.'),
    methodNote: z
      .boolean()
      .optional()
      .describe('Footnotes stating the derivation and the vital-few set. Default false: the reader gets the exhibit, not a method statement.'),
  }) as unknown as z.ZodType<ParetoOptions>;
