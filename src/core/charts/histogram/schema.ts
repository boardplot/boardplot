/** Histogram data and options schemas, without the chart engine. */

import * as z from 'zod';
import { baseOptionsSchema, refusedBaseOptions } from '../../schema/shared';
import type { HistogramData, HistogramOptions } from './types';

// `.strict()` for the same reason box uses it: a caller (or a model) that
// sends `{ observations, counts, edges }` is told here that pre-binned counts
// are rejected. A non-strict object would strip those keys, draw bins that
// disagree with the ones that were sent, and say nothing.
export const histogramDataSchema = z
  .object({
    observations: z
      .array(z.number().finite())
      .min(4)
      .describe(
        'Raw observations, at least four. Pre-binned counts and edges are rejected: bins the engine cannot recompute cannot be checked. Rows: value.',
      ),
  })
  .strict() as unknown as z.ZodType<HistogramData>;

export const histogramOptionsSchema = baseOptionsSchema.safeExtend(refusedBaseOptions('histogram')).safeExtend({
  axisTitles: z
    .strictObject({
      y: z.string().trim().min(1).optional().describe("Title of the frequency axis, e.g. 'Orders'."),
    })
    .optional()
    .describe('Title of the frequency axis, drawn in the top row left of the plot while the axis is drawn. When every bin carries its count, the automatic axis gives way and this title leads the base note under the plot. The bin labels carry the measure and its unit.'),
  bins: z
    .union(
      [
        z.literal('auto'),
        z.number().int().positive().max(250),
        z.object({
          width: z.number().positive().optional().describe("Authored bin width in observation units; bypasses automatic width selection and snapping. Leave it out with openAbove to let the automatic rule pick the width."),
          anchor: z.number().finite().optional().describe("Origin of the regularly spaced bin boundaries. Needs width."),
          openAbove: z.number().finite().optional().describe("Value from which every observation goes into one open last bin, named '≥ value (max …)' under its bar, drawn a small gap apart and always labelled with its count. The bin edges run through it. Use it when a few extreme values stretch the axis."),
        }).strict()
          .refine((spec) => spec.width !== undefined || spec.openAbove !== undefined, { message: 'bins as an object needs width, openAbove or both' })
          .refine((spec) => spec.anchor === undefined || spec.width !== undefined, { message: 'bins.anchor needs bins.width', path: ['anchor'] }),
      ],
      {
        // A union reports "Invalid input" and nothing else, which sends an
        // agent that guessed `bins: 'sturges'` straight into a retry loop.
        // The accepted forms are cheaper to print than to guess.
        error:
          "bins accepts 'auto' (the engine derives and states the rule), a positive integer bin COUNT (max 250), or { width?, anchor?, openAbove? }. Named rules such as 'sturges', 'fd', 'scott' or 'rice' are not accepted: the engine picks between Freedman-Diaconis and Sturges itself and prints which one it used.",
      },
    )
    .optional()
    .describe(
      "Binning. 'auto' (default) takes the narrower of the Freedman-Diaconis and Sturges widths, then snaps it to a round number. A positive integer is an EXACT bin count: that many equal bins from the smallest to the largest observation, so the width is rarely round. { width } sets the width outright and skips the snap. When every observation is a whole number and the width is 1 ('auto' or { width: 1 } without an anchor), each bin holds one value, centres on it and is named under its bar. { openAbove } gathers every value at or above it into one open last bin, so a long tail no longer stretches the axis; under 'auto' a warning (histogram-long-tail) proposes a value when most bins past the first quarter of the axis are nearly empty. Named rules such as 'sturges' or 'fd' are not accepted — the engine states which rule it used on the exhibit.",
    ),
  binSnap: z
    .boolean()
    .optional()
    .describe(
      "Snap an 'auto' width onto the {1, 2, 2.5, 5} ladder so bin edges are round numbers. Default true; ignored for an authored count or width.",
    ),
  labelDensity: baseOptionsSchema.shape.labelDensity.describe("Count-label density. Default: every bin count competes for a seat over its bar, and an empty bin prints no 0 when one value fills each bin or most bins are empty. When more than 12 bins hold observations and a count is too wide for its bin and loses its seat, only the tallest bin keeps its count, the frequency axis carries the scale, and no tail callout prints (info histogram-counts-peak-only). 'full' keeps every count: a count without a seat moves onto a leader or into the note. 'minimal' keeps only the essential labels."),
  methodNote: z
    .boolean()
    .optional()
    .describe(
      'Default false: the axis caption states the sample base n and the realized bins; without a caption, a method note carries them. true adds the binning rule, width, first edge and interval convention. footnotes: false hides method notes.',
    ),
}) as unknown as z.ZodType<HistogramOptions>;
