/**
 * A ring tone without a ring paints nothing. The schema refuses it
 * for the CLI and BoardplotChart; the layout raises the same code, path and
 * remove patch as an error lint, so the per-type React entry, which does not
 * link the schema, refuses it too. Without zod, like kpi/sparkLabels.ts.
 */
import type { LintWarning } from '../../types/scene';

export const RING_TONE_WITHOUT_RING_REFUSED = "ringTone paints the end ring, and ring: 'none' draws no ring; drop ringTone, or set ring to 'last'";

export function ringToneRefusal(options: { ring?: unknown; ringTone?: unknown }): LintWarning[] {
  return options.ring === 'none' && options.ringTone !== undefined
    ? [{
      code: 'invalid-options', severity: 'error', message: RING_TONE_WITHOUT_RING_REFUSED,
      field: ['options', 'ringTone'], fix: [{ op: 'remove', path: '/options/ringTone' }],
    }]
    : [];
}
