import type { LintWarning } from './types/scene';

/**
 * The refusal a break-drawing type returns when its data forbids the span. It
 * names the field and proposes removing it; the chart is refused, so nothing
 * is drawn and nothing is ignored.
 */
export function axisBreakInvalid(type: string, reason: string): LintWarning {
  return {
    code: 'axis-break-invalid',
    severity: 'error',
    message: `${type} valueAxis.break is invalid: ${reason}`,
    suggest: 'Move from and to so the span holds no drawn value and not zero, or remove valueAxis.break.',
    field: ['options', 'valueAxis', 'break'],
    fix: [{ op: 'remove', path: '/options/valueAxis/break' }],
  };
}
