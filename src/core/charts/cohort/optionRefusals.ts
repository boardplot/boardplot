/**
 * The cohort keys a variant can never read, in the words the schema prints. The
 * schema refuses them for the CLI and BoardplotChart. The layout raises the same
 * code, path and remove patch as error lints, because the per-type React entry
 * does not link the schema. Its own module without zod, as geoRefusals.ts is.
 */
import type { LintWarning } from '../../types/scene';

const EXHIBIT_ONLY = ['columnVisibility', 'columnOverrides', 'columnOrder', 'columnHeads', 'totalPosition'] as const;

interface CohortKeys {
  variant?: string;
  columnVisibility?: unknown;
  columnOverrides?: unknown;
  columnOrder?: unknown;
  columnHeads?: unknown;
  totalPosition?: unknown;
  figures?: unknown;
  designatedPeriod?: unknown;
}

/** Each refused key with its reason. An omitted variant draws the heatmap. */
export function cohortKeyRefusals(options: CohortKeys): { key: string; message: string }[] {
  const heatmap = options.variant === undefined || options.variant === 'heatmap';
  return [
    ...(heatmap ? EXHIBIT_ONLY.filter((key) => options[key] !== undefined).map((key) => ({
      key, message: `'${key}' sets a part of the exhibit table, and the heatmap variant has none; set variant 'pure' or 'stepped', or drop '${key}'`,
    })) : []),
    ...(options.figures !== undefined && options.variant !== 'stepped' ? [{
      key: 'figures', message: "'figures' stops the numbers on stepped fills, and only variant 'stepped' draws them; set variant 'stepped', or drop 'figures'",
    }] : []),
    ...(options.designatedPeriod === false && options.variant !== 'pure' ? [{
      key: 'designatedPeriod', message: "designatedPeriod false turns off the column tint of variant 'pure', and only that variant draws one; set variant 'pure', or drop 'designatedPeriod'",
    }] : []),
  ];
}

export function cohortOptionRefusals(options: CohortKeys): LintWarning[] {
  return cohortKeyRefusals(options).map(({ key, message }) => ({
    code: 'invalid-options', severity: 'error' as const, message, field: ['options', key], fix: [{ op: 'remove' as const, path: `/options/${key}` }],
  }));
}
