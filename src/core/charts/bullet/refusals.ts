/**
 * What a compact bullet has no room for: a value axis and its
 * title, a band key, row labels, value and delta labels, and the
 * percent-of-target scale's value column. Asked for anyway, each is refused
 * rather than dropped. The schema refuses them for the CLI and
 * BoardplotChart; the layout raises the same lints, so the per-type React
 * entry, which does not link the schema, refuses them too.
 */
import type { LintWarning } from '../../types/scene';

function refused(path: string[], message: string): LintWarning {
  return {
    code: 'invalid-options', severity: 'error', message,
    field: ['options', ...path], fix: [{ op: 'remove', path: `/options/${path.join('/')}` }],
  };
}

/**
 * A value that asks for what compact already draws, nothing: false, 'none',
 * or an object of such values ({} included). It is accepted as a no-op;
 * anything that asks for a mark stays refused.
 */
function asksNothing(value: unknown): boolean {
  if (value === undefined || value === false || value === 'none') return true;
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(asksNothing);
}

/** A rule's content form when every value but its no-op forms asks for a mark. */
const ANY_CONTENT = 'any value but a no-op form';
const NO_OPS = [false, 'none', {}];

/**
 * The compact refusals as data: the check below and `describe
 * --full` both read this list, so the conditions and the wording printed
 * cannot drift apart. A rule refuses its content form: any value but its
 * no-op forms, or the one literal named.
 */
export const COMPACT_BULLET_REFUSALS = [
  { key: 'labels', contentForm: ANY_CONTENT, noOpForms: NO_OPS,
    message: "density 'compact' prints no row, value or delta labels; drop labels, or density" },
  { key: 'rowLabels', contentForm: ANY_CONTENT, noOpForms: NO_OPS,
    message: "density 'compact' draws no row labels to align; drop rowLabels, or density" },
  { key: 'axisTitles', contentForm: ANY_CONTENT, noOpForms: NO_OPS,
    message: "density 'compact' draws no value axis to title; drop axisTitles, or density" },
  { key: 'valueAxis.show', contentForm: true, noOpForms: [false],
    message: "density 'compact' draws no value axis; drop valueAxis.show, or density" },
  { key: 'legend', contentForm: ANY_CONTENT, noOpForms: NO_OPS,
    message: "density 'compact' draws no band key; drop legend, or density" },
  { key: 'sharedScale', contentForm: 'percentOfTarget',
    message: "the percent-of-target scale prints a key and a value column, which density 'compact' leaves out; drop sharedScale, or density" },
];

export function compactBulletRefusals(options: {
  density?: unknown; valueAxis?: { show?: unknown }; legend?: unknown; sharedScale?: unknown;
  labels?: unknown; rowLabels?: unknown; axisTitles?: unknown;
}): LintWarning[] {
  if (options.density !== 'compact') return [];
  return COMPACT_BULLET_REFUSALS.flatMap((rule) => {
    const path = rule.key.split('.');
    const value = path.reduce<unknown>((at, key) => (at as Record<string, unknown> | undefined)?.[key], options);
    const asks = rule.contentForm === ANY_CONTENT ? !asksNothing(value) : value === rule.contentForm;
    return asks ? [refused(path, rule.message)] : [];
  });
}
