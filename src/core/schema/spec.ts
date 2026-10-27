import { baseOptionsSchema } from './shared';
import { reactSizingOptionsSchema, hoverSchema } from './react';

/** Host settings for the spec entry. The spec itself uses the shared document parser. */
export const boardplotSpecSettingsSchema = reactSizingOptionsSchema.extend({
  target: baseOptionsSchema.shape.target,
  theme: baseOptionsSchema.shape.theme.describe('Explicit host theme overriding the spec theme.'),
  hover: hoverSchema.optional(),
}).describe('Serializable settings for BoardplotChart. Chart data, options and annotations remain in the spec. An invalid spec or setting renders a diagnostic card.');
