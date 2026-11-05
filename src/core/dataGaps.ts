import type { Theme } from './types/theme';
import { strokeToken } from './theme';
/**
 * Gaps in the data that a chart discloses instead of drawing over (data
 * honesty): a composition with a missing part, printed shares that do not add
 * to 100, a mark dropped for a missing value. The warnings share one wording
 * per code across every chart type; a chart with nothing plotted is checked
 * once for every type in registry.ts.
 */

import { printedShare } from './format';
import type { OwnerRef } from './types/cell';
import type { LintWarning, Paint, SceneNode } from './types/scene';

const quoted = (names: readonly string[]): string => names.map((name) => `'${name}'`).join(', ');

/**
 * At least one part is missing, so the whole is not known. A composition
 * with every part missing is incomplete too: its total is no 0.
 */
export function isIncomplete(parts: readonly (number | null)[]): boolean {
  return parts.some((part) => part === null);
}

/**
 * One warning per chart for the categories whose composition misses a part.
 * `withheld` says what the chart did not print for them, or what the reader
 * must know when it still prints (a pie's shares of the known slices).
 * `every`: every composition of a chart with several misses a part. That is
 * mostly a component that does not apply, authored as null, so the advice
 * names the zero rule first.
 */
export function warnIncompleteComposition(warnings: LintWarning[], names: readonly string[], withheld: string, every = false): void {
  if (names.length === 0) return;
  warnings.push({
    code: 'incomplete-composition',
    severity: 'warn',
    message: `missing value (null) in ${quoted(names)}: ${withheld}`,
    suggest: `${every ? 'Every composition misses a part. ' : ''}A component known to be zero there (one that does not apply) takes 0; null means unknown. Supply every component value. In rows, an absent pair is null; add an explicit 0 row only when the source proves absence. Or author total100 on the category when the whole is known.`,
  });
}

/**
 * The printed shares of one whole sum to something other than 100. Display
 * rounding is never corrected: a printed number must equal the data it came
 * from, so the drift is disclosed instead (likert's rule, shared).
 */
export function shareDrift(printed: readonly number[]): number | null {
  const sum = printed.reduce((a, share) => a + share, 0);
  return Math.abs(sum - 100) > 1e-9 ? Math.round(sum * 1e6) / 1e6 : null;
}

/**
 * One info warning per chart naming each whole whose shares, as formatShare
 * prints them, do not add to 100. `shares` are the unrounded percents.
 */
export function warnShareRoundingDrift(warnings: LintWarning[], wholes: readonly { name: string; shares: readonly number[]; decimals?: number }[]): void {
  const drifts = wholes.flatMap((whole) => {
    // At the precision the labels print, where the chart sets one.
    const sum = shareDrift(whole.shares.map((share) => printedShare(share, whole.decimals)));
    return sum === null ? [] : [`${sum}% for '${whole.name}'`];
  });
  if (drifts.length === 0) return;
  warnings.push({
    code: 'share-rounding-drift',
    severity: 'info',
    message: `the printed shares sum to ${drifts.join(', ')}, not 100% — rounding, not an error in the data; no share is adjusted to close the gap`,
    suggest: 'the shares are computed; on pie, bar, column and mekko a percent options.format such as 1.0% sets their decimals, and elsewhere options.format does not change how they print; if exact shares matter, print the underlying values, or author the shares as data',
  });
}

/** A value the author left empty, so the mark it would draw is not drawn. Scatter's wording, shared. */
export function warnMissingValue(warnings: LintWarning[], where: string, owner: OwnerRef, dropped = 'not drawn'): void {
  warnings.push({ code: 'missing-value', severity: 'info', message: `${where}: missing value — ${dropped}`, owner });
}

/**
 * The mark a missing value leaves, so a gap reads as "no value here"
 * and not as a zero or a smooth run: a hollow ring in the series' ink, on
 * the line where it would have been, or at the baseline of an empty column
 * slot. Its hover record says "no value". One shape for every type (line,
 * sparkline, kpi spark, column), keyed once where a key is drawn.
 */
export function gapMarkerNode(theme: Theme, input: { id: string; x: number; y: number; ink: Paint; owner: OwnerRef; r?: number }): SceneNode {
  return {
    t: 'circle', id: input.id, cx: input.x, cy: input.y, r: input.r ?? 3,
    fill: { token: 'background' }, stroke: input.ink, strokeWidth: strokeToken(theme, 'mark'), owner: input.owner,
    part: 'gapMarker', display: { value: 'no value', state: 'missing' },
  };
}
