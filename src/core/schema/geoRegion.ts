import * as z from 'zod';
import { idSchema } from './shared';
import { NAMED_COLUMN_STATES } from './namedColumns';

/** Map values use the same named null states as row input. */
export const geoRegionSchema = z.strictObject({
  id: idSchema.describe('Region identifier from the selected geographic pack.'),
  value: z.number().finite().nullable().describe('Region measure; null without a state means missing data.'),
  state: z.enum(NAMED_COLUMN_STATES).optional().describe('Named null state: suppressed, not meaningful (nm), or not applicable (na). Each has a distinct pattern and key. Requires value null.'),
}).superRefine((region, ctx) => {
  if (region.state !== undefined && region.value !== null) ctx.addIssue({
    code: 'custom', path: ['state'], message: 'a region state requires value null; remove the value or the state',
  });
});
