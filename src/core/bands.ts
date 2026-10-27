/** Shared qualitative value bands: the schema for non-bullet uses and the one selector bullet also uses. */

import * as z from 'zod';
import { boundedNumber } from './schema/shared';

export { type ValueBand } from './bandSelect';

/** Non-empty bands with finite, strictly ascending `to`. Negative bounds are allowed. */
export const valueBandsSchema = z
  .array(
    z.strictObject({
      tone: z.enum(['good', 'warn', 'bad', 'neutral']).optional().describe('Semantic band tone.'),
      to: boundedNumber.describe('Upper endpoint of this band in the value units.'),
      label: z.string().trim().min(1).optional().describe('Visible name of this band.'),
    }),
  )
  .min(1)
  .refine((bands) => bands.every((band, i) => i === 0 || band.to > bands[i - 1]!.to), {
    message: 'band `to` values must be strictly ascending',
  });
