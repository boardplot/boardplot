/** Pvm data and options schemas, without the chart engine. */

import * as z from 'zod';
import { addDuplicateIdIssues, baseOptionsSchema, idSchema, refusedBaseOptions } from '../../schema/shared';
import type { PvmData, PvmOptions } from './types';

const periodSchema = z.strictObject({
  qty: z
    .number()
    .finite()
    .describe('Units sold in the period. Never negative; 0 only with revenue 0.'),
  revenue: z
    .number()
    .finite()
    .describe('Revenue for those units. Price is derived as revenue / qty.'),
});

const itemSchema = z.strictObject({
  id: idSchema.describe("Unique item identity binding prior and current decomposition inputs."),
  label: z.string().optional().describe("Displayed item name; defaults to its id."),
  prior: periodSchema.describe('Base period.'),
  current: periodSchema.describe('Comparison period.'),
});

export const pvmDataSchema = z
  .strictObject({
    priorLabel: z.string().min(1).optional().describe('Opening total-bar name; default Prior.'),
    currentLabel: z.string().min(1).optional().describe('Closing total-bar name; default Current.'),
    items: z.array(itemSchema).min(1).describe("Comparable items with prior and current quantities and revenues for the price/volume/mix decomposition."),
    priorDate: z.string().optional().describe("ISO date of the common base period, attached to the prior total for CAGR."),
    currentDate: z.string().optional().describe("ISO date of the common comparison period, attached to the current total. Effects do not represent elapsed time."),
    quantityUnit: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The common unit every item's qty is counted in ('licences', 'cases', 'seats'). The volume/mix split is a function of it — the same business counted in cases rather than units moves the Volume and Mix bars — so leaving it out warns and the exhibit says so.",
      ),
  })
  .superRefine((data, ctx) => {
    addDuplicateIdIssues(ctx, data.items, ['items'], {
      name: 'item',
      keys: 'price, volume and mix decomposition inputs',
    });
  }) as unknown as z.ZodType<PvmData>;

export const pvmOptionsSchema = baseOptionsSchema.safeExtend(refusedBaseOptions('pvm')).safeExtend({
  interaction: z
    .enum(['in-price', 'separate'])
    .optional()
    .describe(
      "Where the price x volume interaction is booked: 'in-price' reads price at current volumes and absorbs it; 'separate' splits it into a Laspeyres price bar plus an explicit joint bar.",
    ),
  volumeMix: z
    .enum(['split', 'combined'])
    .optional()
    .describe(
      "'split' (default) draws Volume and Mix separately; the boundary between them depends on the counting unit, which methodNote: true states on the exhibit. 'combined' draws one 'Volume & mix' bar and the decomposition is then unit-invariant.",
    ),
  methodNote: z
    .boolean()
    .optional()
    .describe(
      'Default false. true adds the short convention ("volume and mix at prior prices") to the one footer line, which joins the coverage note ("Covers the 4 items in both periods") while items enter or leave the book; the coverage part prints regardless. Where Volume and Mix nearly cancel (their sum under a tenth of the larger) the convention and the counting unit print without it, since the split between them then carries the story. The long method notes are in derived, and join the notes list when notes is set.',
    ),
  netChange: z
    .boolean()
    .optional()
    .describe(
      'Default true. Prints the net change from the opening to the closing total, absolute and in percent, in its sign colour above the closing column. false leaves the closing column with its value only.',
    ),
}) as unknown as z.ZodType<PvmOptions>;
