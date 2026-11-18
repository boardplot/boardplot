/**
 * Value lines and the value domain, for the charts whose value axis never
 * clips its data.
 *
 * Scatter sizes its domain to every drawn value line too, but it lets an
 * authored `valueAxis.min` / `valueAxis.max` end the axis, and then refuses a
 * line those bounds leave outside (scatter/valueLines.ts,
 * `value-line-outside-axis`). Waterfall and variance do not work that way: an
 * authored bound only widens their domain (`Math.min(va.min, lo, 0)`), and
 * waterfall computes the domain from the drawn levels alone. There is no
 * authored end for a line to fall outside of, so the rule here is the other
 * half of scatter's: the domain takes the union of the data, the authored
 * bounds and every value line the chart draws, and the line is always visible.
 * pvm draws through waterfall, so it inherits the same rule.
 *
 * A line whose value is not a number (a measured mean, which these charts
 * resolve themselves, or a refused line) says nothing about the domain: the
 * mean of the plotted values already lies inside the data extent.
 */

import { valueLineHasTargetExtras } from './annotateFields';
import { toleranceBounds } from './annotateTargets';
import type { Annotation } from './types/annotations';
import { maxOf, minOf } from './arrays';

/** The range the value lines ask the value axis to contain. */
export interface ValueLineExtent {
  lo: number;
  hi: number;
}

/**
 * The extent of the numeric value lines drawn on `axis` (default primary), or
 * null if there are none. A line the annotation pass refuses on these charts
 * says nothing about the domain: one naming the other axis, one scoped to a
 * series (a line-chart feature), or one given a category span without a
 * tolerance or attainment band is left out, so it cannot squeeze the marks.
 */
export function valueLineExtent(annotations: readonly Annotation[] | undefined, axis: 'primary' | 'secondary' = 'primary'): ValueLineExtent | null {
  const values = valueLineValues(annotations, axis);
  return values.length ? { lo: minOf(values), hi: maxOf(values) } : null;
}

/** The numeric value lines drawn on `axis`, by the rule of valueLineExtent. */
function drawnValueLines(annotations: readonly Annotation[] | undefined, axis: 'primary' | 'secondary'): (Annotation & { kind: 'valueLine' })[] {
  // Number.isFinite is false for anything that is not a finite number, so a
  // measured mean (no numeric value) falls out here too.
  return (annotations ?? []).filter((a): a is Annotation & { kind: 'valueLine' } => a.kind === 'valueLine' && Number.isFinite(a.value) && (a.axis ?? 'primary') === axis && a.seriesId === undefined && ((a.from === undefined && a.to === undefined) || valueLineHasTargetExtras(a)));
}

/** Each value of a drawn value line, so an axis break can check every one, not only the extremes. */
export function valueLineValues(annotations: readonly Annotation[] | undefined, axis: 'primary' | 'secondary' = 'primary'): number[] {
  return drawnValueLines(annotations, axis).map((a) => a.value as number);
}

/**
 * The extent of the tolerance bands of the drawn value lines, or null if there are none. A chart whose
 * domain ends at its data (dot) takes it, so a band is never cut at the axis end.
 */
export function toleranceExtent(annotations: readonly Annotation[] | undefined): ValueLineExtent | null {
  const bounds = drawnValueLines(annotations, 'primary').flatMap((a) => {
    if (a.tolerance === undefined) return [];
    const band = toleranceBounds(a.value as number, a.tolerance);
    return typeof band === 'string' ? [] : [band.low, band.high];
  });
  return bounds.length ? { lo: minOf(bounds), hi: maxOf(bounds) } : null;
}
