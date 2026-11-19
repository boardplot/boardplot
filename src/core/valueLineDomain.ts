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
import { bandBoundText, toleranceBounds, TOLERANCE_FILL, type TargetScaleInput } from './annotateTargets';
import { defaultAnnotationId, type Annotation } from './types/annotations';
import type { Id } from './types/cell';
import type { StringsSpec } from './types/options';
import type { SeriesIdentity } from './seriesIdentity';
import { localeStrings } from './strings';
import { chartString } from './strings/a11y-valueLineRecords';
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
  // Number.isFinite is false for anything that is not a finite number, so a
  // measured mean (no numeric value) falls out here too.
  const values = (annotations ?? []).flatMap((a) => (a.kind === 'valueLine' && Number.isFinite(a.value) && (a.axis ?? 'primary') === axis && a.seriesId === undefined && ((a.from === undefined && a.to === undefined) || valueLineHasTargetExtras(a)) ? [a.value as number] : []));
  return values.length ? { lo: minOf(values), hi: maxOf(values) } : null;
}

/**
 * The tolerance bands the annotation pass draws on a chart that measures no scoped mean (bar, dot),
 * so the chart can keep each of them whole inside its value axis. A band counts when its line is
 * drawn (a number by the rule of valueLineExtent, or the plotted mean of a line without a span),
 * its bounds are valid and its span, if it has one, names two categories of the chart. A band
 * the pass omits says nothing about the domain.
 */
export function drawnToleranceBands(
  annotations: readonly Annotation[] | undefined, meanValue: number | undefined, categoryIds: readonly Id[],
): ValueLineExtent[] {
  return toleranceBands(annotations, meanValue, categoryIds).map(({ lo, hi }) => ({ lo, hi }));
}

function toleranceBands(
  annotations: readonly Annotation[] | undefined, meanValue: number | undefined, categoryIds: readonly Id[],
): (ValueLineExtent & { line: Extract<Annotation, { kind: 'valueLine' }>; index: number })[] {
  return (annotations ?? []).flatMap((a, index) => {
    if (a.kind !== 'valueLine' || a.tolerance === undefined || (a.axis ?? 'primary') !== 'primary' || a.seriesId !== undefined) return [];
    const spanned = a.from !== undefined || a.to !== undefined;
    const value = typeof a.value === 'number' ? a.value : spanned ? undefined : meanValue;
    if (value === undefined || !Number.isFinite(value)) return [];
    if (spanned && !(a.from !== undefined && a.to !== undefined && categoryIds.includes(a.from) && categoryIds.includes(a.to))) return [];
    const band = toleranceBounds(value, a.tolerance);
    return typeof band === 'string' ? [] : [{ lo: Math.min(band.low, band.high), hi: Math.max(band.low, band.high), line: a, index }];
  });
}

/** The key id of a value line's tolerance band. */
export const toleranceKeyId = (annotationId: Id): Id => `__tolerance:${annotationId}`;

/**
 * The keys of the tolerance bands of `annotations`, the list the annotation pass gets. A band says
 * nothing about itself, so the key names it after its line and prints its bounds: "Target range:
 * 95 to 105". A line without a name gives "Range: 95 to 105". The box has the band's fill and a
 * thin edge, because the fill alone is too light to see at key size.
 */
export function toleranceLegendKeys(
  annotations: readonly Annotation[] | undefined, meanValue: number | undefined, categoryIds: readonly Id[],
  text: Pick<TargetScaleInput, 'format' | 'locale' | 'levelSpec'> & { strings?: StringsSpec },
): SeriesIdentity[] {
  const words = { locale: text.locale, strings: text.strings };
  return toleranceBands(annotations, meanValue, categoryIds).map(({ lo, hi, line, index }) => {
    const mean = line.value === undefined || line.value === 'mean';
    // The line's name is its label up to the value: "Target" of "Target: ${value} units".
    const name = typeof line.label === 'string'
      ? line.label.split('${value}').map((part) => part.replace(/\s+/g, ' ').replace(/^[\s:=()–-]+|[\s:=()–-]+$/g, '')).find(Boolean) ?? ''
      : line.label === undefined && mean ? text.strings?.average ?? localeStrings(text.locale).average : '';
    const range = chartString(words, 'valueLineRange', { v1: bandBoundText(text, lo), v2: bandBoundText(text, hi) });
    return {
      id: toleranceKeyId(defaultAnnotationId(line, index)),
      label: name ? chartString(words, 'valueLineRangeKey', { name, range }) : chartString(words, 'valueLineRangeKeyPlain', { range }),
      paint: TOLERANCE_FILL,
      stroke: { token: 'axis' },
      width: 0.75,
    };
  });
}

/** The value lines of `annotations` whose tolerance band the drawn key `drawn` names. */
export function toleranceKeyed(annotations: readonly Annotation[] | undefined, drawn: readonly { id: Id }[] | undefined): ReadonlySet<Id> {
  const ids = new Set((drawn ?? []).map((item) => item.id));
  return new Set((annotations ?? []).flatMap((a, index) => (ids.has(toleranceKeyId(defaultAnnotationId(a, index))) ? [defaultAnnotationId(a, index)] : [])));
}
