import type { LintWarning } from '../../types/scene';

/**
 * The values the sliver gate dropped, reported once per chart: a value
 * that is not on the page is something the reader lost, so it is said, not
 * hidden in silence. `names` reads "B in Q1".
 */
export function warnSliverLabels(
  warnings: LintWarning[],
  names: readonly string[],
  suggest = "set labelDensity 'full' to move them outside on leaders, or pin one with labelPlacements",
): void {
  if (names.length === 0) return;
  const shown = names.slice(0, 5).join(', ') + (names.length > 5 ? ', ...' : '');
  warnings.push({
    code: 'sliver-labels-hidden',
    severity: 'info',
    message: `${names.length} segment value${names.length === 1 ? ' is' : 's are'} not printed because the segment is shorter than its label (${shown})`,
    suggest,
  });
}
