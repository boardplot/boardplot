/** Sparkline data and options schemas, without the chart engine. */

import * as z from 'zod';
import { valueKindSchema } from '../../schema/shared';
import { baseOptionsSchema, boundedNumber, cellSchema, refusedBaseOptions } from '../../schema/shared';
import type { SparklineData } from '../../types/data';
import type { SparklineOptions } from '../../types/options';
import { RING_TONE_WITHOUT_RING_REFUSED, ringToneRefusal } from './refusals';

export const sparklineDataSchema = z
  .strictObject({
    valueKind: valueKindSchema,
    values: z.array(cellSchema).min(2)
      .describe('The series in order, at least two points. A null is bridged by a dotted segment with a ring on the missing point.'),
    labels: z.array(z.string().min(1).describe('Name of one point.')).optional()
      .describe('One name per value, in the same order. The end labels and the hover records read them; without them a point is named by its position.'),
  })
  .describe('One series drawn as a mini line: no axes, no smoothing, no fill.') as unknown as z.ZodType<SparklineData>;

export const sparklineOptionsSchema = baseOptionsSchema
  .safeExtend(refusedBaseOptions('sparkline'))
  .safeExtend({
    ring: z.enum(['last', 'none']).optional()
      .describe("A ring on the last observed point, in the highlight. 'last' is the default; 'none' draws the bare line.").meta({ default: 'last' }),
    endLabels: z.enum(['ends', 'none']).optional()
      .describe("'ends' prints the first and last authored label under the ends of the line, at the micro step in the muted ink. Default 'none'. The key is endLabels because labels is the shared per-label-kind switch. The labels take one text line of the height, about half of a 36 px card, so the line and a reference inside its range share the rest. Use 'none' on a short card, or when a reference must read apart from the line.").meta({ default: 'none' }),
    valueLabel: z.enum(['last', 'none']).optional()
      .describe("'last' prints the last observed value beside the end of the line, in the format. On a framed sparkline (title, subtitle or source) whose line band keeps 60 px, it also marks the high point with a dot and its value, muted, above it, unless the last point is the high. Default 'none': a card that hosts the bare mark prints the figure itself.").meta({ default: 'none' }),
    stroke: z.number().positive().max(8).optional()
      .describe('Stroke width of the line in px. Default uses the theme stroke.data token (2 px).').meta({ default: 2 }),
    reference: boundedNumber.optional()
      .describe('A 1 px dashed line at this value in the muted ink, with no label. The scale always includes it.'),
    ringTone: z.enum(['good', 'warn', 'bad']).optional()
      .describe("Paints the end ring in this tone instead of the highlight. Refused with ring 'none'."),
  })
  .superRefine((options, ctx) => {
    if (ringToneRefusal(options).length) ctx.addIssue({ code: 'custom', path: ['ringTone'], message: RING_TONE_WITHOUT_RING_REFUSED, params: { refused: true } });
  })
  .describe('A bare sparkline draws edge to edge, because it is a mark inside someone else\'s card; one that carries a title, subtitle, source or note takes the canvas margin, starts its line on the text edge, is 320 px wide when it authors no width (wider for a long title) and, with no height, grows its line band with the width (46 px plus a tenth of the width, 70 to 200 px) on an authored width and on any card from 320 px, the dashboard tile included. canvas.margin overrides either. Default size of a bare sparkline 176 by 36.') as unknown as z.ZodType<SparklineOptions>;
