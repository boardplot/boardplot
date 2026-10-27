import { crossesLinearBreak, type LinearScale } from './scale';
import type { LintWarning } from './types/scene';

/** The two rectangles painted by column, bar and waterfall omit 4 px, not the scale's 12 px gap. */
export function paintedBarLength(scale: LinearScale, start: number, end: number): number {
  const meta = scale.break;
  if (!meta || !crossesLinearBreak(start, end, meta)) return Math.max(Math.abs(scale(end) - scale(start)), 0.5);
  const a = scale(start), b = scale(end);
  const direction = b >= a ? 1 : -1;
  return Math.max(Math.abs(meta.position - direction * 2 - a), 0.5)
    + Math.max(Math.abs(b - meta.position - direction * 2), 0.5);
}

export interface BreakBar { value: number; start: number; end: number }

/** Equal-valued steps must not read longer than a total either. */
export function breakReversesOrder(scale: LinearScale, levels: readonly BreakBar[], steps: readonly BreakBar[]): boolean {
  return levels.some(level => steps.some(step => Math.abs(level.value) >= Math.abs(step.value)
    && paintedBarLength(scale, level.start, level.end) < paintedBarLength(scale, step.start, step.end) + 1));
}

export function axisBreakHeightOrderWarning(): LintWarning {
  return {
    code: 'axis-break-height-order', severity: 'warn',
    message: 'valueAxis.break ignored: it makes a total or level no taller than a smaller step or segment, or shorter than an equal one',
    suggest: 'set valueAxis.break to false to keep totals and levels visibly taller than smaller steps and segments',
    field: ['options', 'valueAxis', 'break'],
    fix: [{ op: 'replace', path: '/options/valueAxis/break', value: false }],
  };
}
