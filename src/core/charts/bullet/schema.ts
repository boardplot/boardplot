/** Bullet data and options schemas, without the chart engine. */

import * as z from 'zod';
import {
  addDuplicateIdIssues,
  baseOptionsSchema,
  boundedNumber,
  cellSchema,
  comparisonDirectionSchema,
  idSchema,
  primaryAxisTitleSchema,
  refusedBaseOptions,
} from '../../schema/shared';
import type { BulletData } from '../../types/data';
import type { BulletOptions } from '../../types/options';
import { compactBulletRefusals } from './refusals';

const rowSchema = z.strictObject({
  id: idSchema.describe("Unique KPI-row identity used by annotations and scene elements."),
  label: z.string().optional().describe("Displayed KPI-row name; defaults to its id."),
  date: z.string().optional().describe("ISO period date for CAGR between same-measure rows on a shared scale."),
  value: cellSchema.describe("Actual measure drawn as the row bar."),
  target: cellSchema.optional().describe("Reference measure drawn as the target tick and used for target deltas. It uses the row value's format or options.format; a different target.format warns because it is ignored. options.strings.target renames the comparison mark in labels (e.g. 'peer median')."),
  bands: z
    .array(
      z.union([
        // same ±1e15 bound as every numeric cell: an absurd band
        // threshold would feed the row scale an unusable domain and collapse
        // bar and bands to the minimum-paint fallback — refuse it instead
        boundedNumber,
        z.strictObject({
          tone: z.enum(['good', 'warn', 'bad', 'neutral']).optional().describe("Semantic band tone. Toned bands define a two-sided corridor and set the delta tone for values inside them. A toned band paints its tone's fill washed toward the page (theme marks.bulletBandFill)."),
          to: boundedNumber.describe("Upper endpoint of this qualitative band in the row value units."),
          label: z.string().trim().min(1).optional().describe("Visible name of this qualitative band."),
        }),
      ]),
    )
    .optional().describe("Ordered qualitative band thresholds, as numbers or labeled threshold objects."),
  direction: comparisonDirectionSchema.optional().describe("Whether a higher measure is favorable when interpreting the target difference. Neutral uses plain ink without a judgment, including when bands have tones."),
});

export const bulletDataSchema = z
  .strictObject({
    rows: z.array(rowSchema).min(1).describe("KPI rows displayed in the supplied order."),
  })
  .superRefine((data, ctx) => {
    addDuplicateIdIssues(ctx, data.rows, ['rows'], {
      name: 'row',
      keys: 'values, targets and scene identities',
    });
  }) as unknown as z.ZodType<BulletData>;

export const bulletOptionsSchema = baseOptionsSchema
  .safeExtend(refusedBaseOptions('bullet'))
  .safeExtend({
    labels: baseOptionsSchema.shape.labels.describe("False hides value, target-value and delta labels. Row names remain. category: false hides row names. density: compact draws no labels."),
    axisTitles: primaryAxisTitleSchema('under the tick row of the shared-scale axis valueAxis.show draws, ending at its right end'),
    sharedScale: z
      .union([z.boolean(), z.literal('percentOfTarget')])
      .optional()
      .describe(
        "true: one absolute scale across all rows (same-unit rows, comparable magnitudes; supports valueAxis). false: each row normalized to its own zero-based extent — band maximum extended by value/target overshoot; a bandless row uses its value/target extent (the bullet-graph percent-of-scale — mixed-unit KPI rows stay legible; valueAxis is ignored with a warning). 'percentOfTarget': every row in percent of its own target (actual ÷ target) on one 0–120% scale, three shared bands named once in a key (below 80%, 80–100%, at or above target), mirrored at 100% on a lower-is-better row (the key then reads more than 20% off, up to 20% off, on target or better), one target line at 100%, value, share of target and delta beside each row; the rows' bands, valueAxis and annotations are not drawn. Default: false when every row declares bands and the rows differ in unit or band thresholds (warns bullet-row-scales), true otherwise.",
      ).meta({ 'x-boardplot-defaultDependsOn': ['data.rows'] }),
    bandKey: z.enum(['auto', 'labels', 'ramp', 'row']).optional()
      .describe("How the bands are named. 'labels': one key entry for each band label and shade. 'ramp': one worse-to-better key with one entry for each band (Worse ... Better); it needs the same 2 to 5 bands on every banded row, no band tone and no neutral row, and otherwise keeps labels with a warning. 'row': each band's name prints above its band on every row, as authored; on per-row scales the band edges are ticked and numbered under each row; the value sits just past the bar end; a key at the bottom names the bar (Actual), the target tick and, where it applies, the ramp. It needs a name on every band, rows side by side with the target column, and room for each name above its band; otherwise the key names the bands with a warning. 'auto': 'row' for at most 4 rows that name every band wherever it can show; else the ramp when rows run both directions, a label sits on more than one shade and the ramp can apply; otherwise labels. Default 'auto'. The percentOfTarget scale has its own key.").meta({ default: 'auto' }),
    targetColumns: z.boolean().optional()
      .describe("true: where the rows sit side by side and the plot keeps 45% of the width, a Target column and a Gap-to-target column print beside the rows, each under a head, with the gap's position (below, above or on target) under it and the row's direction (higher or lower is better) under its name. Where they do not fit, the target prints above its tick and the delta at the row end. false: always the second form. Default true. The percentOfTarget scale has its own columns.").meta({ default: true }),
    density: z.enum(['compact', 'regular']).optional()
      .describe("'compact' is the 120 x 28 text-free mark: bar, bands and target tick, no labels, axis or key. The percentOfTarget scale needs a key and a value column, so compact refuses it. 'regular' uses labelled stacked rows when side columns take too much plot width. Height depends on row count and text. Default 'regular'.").meta({ default: 'regular' }),
  })
  .superRefine((options, ctx) => {
    for (const refusal of compactBulletRefusals(options)) {
      ctx.addIssue({ code: 'custom', path: refusal.field!.slice(1), message: refusal.message, params: { refused: true } });
    }
  }).describe('Bullet rows use at most their natural 44px pitch (more when target values print above their ticks), enlarged for measured fonts. Target deltas use the label token; explicit canvas dimensions remain unchanged.') as unknown as z.ZodType<BulletOptions>;
