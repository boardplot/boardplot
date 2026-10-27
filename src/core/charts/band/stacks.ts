import type { StringsSpec } from '../../types/options';
import { localeStrings } from '../../strings';
/**
 * Data-unit stack accumulation shared by column and bar charts.
 *
 * Positive and negative values grow from separate zero baselines. Null keeps
 * its series slot as a gap and never changes either accumulator. The result
 * stays in data units so a host can map it through any linear scale.
 */

import { warnIncompleteComposition } from '../../dataGaps';
import { formatWithSpec, specUnitKind, type NumberFormatSpec } from '../../formatSpec';
import { SHARES_OF_ONE_WHOLE_FIX } from '../../stackAdds';
import type { Annotation } from '../../types/annotations';
import type { Id } from '../../types/cell';
import type { LintWarning } from '../../types/scene';

/**
 * The key of a series and a category. The delimiter is U+001F (unit
 * separator), not a space: ids carry spaces ("North America"), and a space
 * delimiter makes sk('North','America X') and sk('North America','X') the
 * same key, so an annotation anchored to one segment resolves to the other's
 * edges and value.
 */
export const sk = (a: Id, b: Id): string => `${a}\u001f${b}`;

type StackVariant = 'grouped' | 'stacked' | 'stacked100';

interface StackSegmentExtent {
  index: number;
  value: number;
  start: number;
  end: number;
}

export interface StackExtents {
  segments: (StackSegmentExtent | null)[];
  positive: number;
  negative: number;
  total: number;
  hasValue: boolean;
}

/**
 * The parts behind each stack total, per category and series: the operands of
 * the total's claim record. Only categories that have a total get an entry.
 */
export function stackParts(
  totals: Record<Id, number>,
  cats: readonly { id: Id }[],
  series: readonly { id: Id }[],
  valueOf: (seriesIndex: number, categoryIndex: number) => number | null,
): Record<Id, Record<Id, number>> {
  return Object.fromEntries(cats.flatMap((c, ci) => Object.hasOwn(totals, c.id)
    ? [[c.id, Object.fromEntries(series.flatMap((s, si) => { const v = valueOf(si, ci); return v === null ? [] : [[s.id, v]]; }))]]
    : []));
}

/**
 * `ranked` stacks the segments by value instead of series order: the largest
 * sits furthest from zero, so each column reads as its own ranking (column
 * `ribbons`). Ties keep series order. Segments stay indexed by series either way.
 */
export function accumulateStack(values: readonly (number | null)[], ranked = false): StackExtents {
  let positive = 0;
  let negative = 0;
  let total = 0;
  let hasValue = false;
  const segments: (StackSegmentExtent | null)[] = values.map(() => null);
  const order = values.map((_, index) => index);
  if (ranked) order.sort((a, b) => Math.abs(values[a] ?? 0) - Math.abs(values[b] ?? 0) || a - b);
  for (const index of order) {
    const value = values[index] ?? null;
    if (value === null) continue;
    hasValue = true;
    total += value;
    const start = value >= 0 ? positive : negative;
    const end = start + value;
    if (value >= 0) positive = end;
    else negative = end;
    segments[index] = { index, value, start, end };
  }
  return { segments, positive, negative, total, hasValue };
}

/**
 * The name a net line's ticks carry. With a boundary series
 * it is the series the boundary closes, joined in stack order ("Core +
 * Growth"). Without one the line runs along the positive stack top: that is
 * the net only where no stack mixes signs, so where one does it is named
 * "Positive total", as the footnote that explains it says.
 */
export function netLineName(
  series: readonly { id: Id; label: string }[],
  boundary: { id: Id } | undefined,
  stacks: readonly Pick<StackExtents, 'positive' | 'negative'>[],
  strings?: StringsSpec,
): string {
  if (boundary) return series.slice(0, series.findIndex((s) => s.id === boundary.id) + 1).map((s) => s.label).join(' + ');
  return stacks.some((stack) => stack.positive > 0 && stack.negative < 0) ? strings?.positiveTotal ?? localeStrings().positiveTotal : strings?.net ?? localeStrings().net;
}

/**
 * The formatter for a stack's absolute total. A 100 % stack is shares, but its
 * total is the count behind them, so a percent format example ("0%") must not
 * put a '%' on it. Other variants keep the chart format. Column and bar share it.
 */
export function stackTotalFormatter(variant: StackVariant, spec: NumberFormatSpec, fmt: (v: number) => string): (v: number) => string {
  if (variant !== 'stacked100' || specUnitKind(spec) !== 'percent') return fmt;
  const plain = { ...spec, suffix: spec.suffix.replace(/\s*%/, '') };
  return (v) => formatWithSpec(v, plain);
}

/**
 * Whether grand totals print: on by default on a plain stack, authored on a
 * 100 % stack, and never on grouped bars, whose side-by-side values add
 * to nothing a reader asked for. Column and bar share it.
 */
export function grandTotalRequested(authored: boolean | undefined, variant: StackVariant, warnings: LintWarning[], partsAdd = true): boolean {
  if (variant !== 'grouped' && partsAdd) return authored ?? variant === 'stacked';
  // percents of different wholes have no total to print.
  if (variant !== 'grouped') {
    if (authored === true) {
      warnings.push({
        code: 'grand-total-ignored',
        severity: 'warn',
        message: 'grandTotalLabels needs parts that add: series stated in percent are shares of different wholes, and their sum is no total — ignored',
        suggest: 'set sharesOfOneWhole: true when every series is a share of the same whole, or drop grandTotalLabels',
      });
    }
    return false;
  }
  if (authored === true) {
    warnings.push({
      code: 'grand-total-ignored',
      severity: 'warn',
      message: 'grandTotalLabels needs a stacked variant: grouped bars stand side by side, and their sum is no total the chart shows — ignored',
      suggest: "use variant 'stacked' to show the total, or drop grandTotalLabels",
    });
  }
  return false;
}

/**
 * a stack whose parts do not add has no sums to average, so an
 * average marker over it is skipped with a warning. True when skipped.
 */
export function averageOfUnaddedSums(partsAdd: boolean, warnings: LintWarning[]): boolean {
  if (partsAdd) return false;
  warnings.push({
    code: 'average-marker-ignored',
    severity: 'warn',
    message: 'averageMarker over a stack whose parts do not add would average sums of percents of different wholes — marker omitted',
    suggest: `${SHARES_OF_ONE_WHOLE_FIX}: averageMarker: { scope: ['<seriesId>'] }`,
  });
  return true;
}

/**
 * A 100 % stack sums to 100 in every category, so an average marker over all
 * its series is always 100 and says nothing: skipped with a warning.
 * A marker scoped to some series averages their share and still draws.
 */
export function averageOfWholeShares(variant: StackVariant, scope: 'all' | Id[], warnings: LintWarning[]): boolean {
  if (variant !== 'stacked100' || scope !== 'all') return false;
  warnings.push({
    code: 'average-marker-ignored',
    severity: 'warn',
    message: 'averageMarker over every series of a 100% stack is always 100% — marker omitted',
    suggest: 'scope the marker to the series whose average share matters: averageMarker: { scope: [\'<seriesId>\'] }',
  });
  return true;
}

/**
 * The average marker as the valueLine it draws, "Ø <mean>", under an id no
 * other annotation holds. Column, bar, dot and combo add it to their list.
 */
export function averageMarkerLine(
  annotations: readonly { id?: Id }[],
  value: number,
  statFmt: (v: number) => string,
  /** The periods it covers where a window or zoom draws fewer (viewportMeanSpan). */
  span?: string,
  average = localeStrings().average,
): Extract<Annotation, { kind: 'valueLine' }> {
  let id = 'averageMarker';
  let suffix = 2;
  while (annotations.some((annotation) => annotation.id === id)) id = `averageMarker-${suffix++}`;
  return { kind: 'valueLine', id, value, label: averageMarkerText(value, statFmt, span, average) };
}

/** The average marker's label: "Ø 42.1", and the periods it covers where the plot draws fewer. */
function averageMarkerText(value: number, statFmt: (v: number) => string, span?: string, average = localeStrings().average): string {
  return `${average} ${statFmt(value)}${span ? ` (${span})` : ''}`;
}

/** The series an average marker takes in, or undefined when it is off. */
export function averageMarkerScope(option: boolean | { scope: 'all' | Id[] } | undefined): 'all' | Id[] | undefined {
  if (option === undefined || option === false) return undefined;
  return typeof option === 'object' ? option.scope : 'all';
}

/** Whether a stack draws exactly one part (no null, no zero): its segment value and its total are one number. */
export function onePartDrawn(parts: readonly (number | null)[]): boolean {
  return parts.filter((part) => part !== null && part !== 0).length === 1;
}

/** An authored cell label that prints the value through its ${value} slot. On a one-part stack the total carries it, so it prints once. */
export function printsValue(label: unknown): label is string {
  return typeof label === 'string' && label.includes('${value}');
}

/** One incomplete-composition warning for the stacks whose total or shares the chart withholds; `marked`: disclosures print, so totals carry the partial marker. */
export function warnIncompleteStacks(
  variant: StackVariant,
  cats: readonly { id: Id; label?: string }[],
  incomplete: ReadonlySet<Id>,
  totalsOn: boolean,
  sharesOn: boolean,
  marks: 'columns' | 'bars',
  warnings: LintWarning[],
  marked: boolean,
): void {
  const names = cats.filter((c) => incomplete.has(c.id)).map((c) => c.label ?? c.id);
  const every = cats.length > 1 && names.length === cats.length;
  if (variant === 'stacked100') {
    const withheld = [sharesOn ? 'share labels' : '', totalsOn ? 'totals' : ''].filter(Boolean).join(' and ');
    warnIncompleteComposition(warnings, names, `these ${marks} are drawn as shares of their known parts only${withheld ? `; their ${withheld} are not printed` : ''}`, every);
  } else if (variant === 'stacked') {
    // The "(partial)" marker and its note print only where disclosures print, so the default total reads as whole.
    warnIncompleteComposition(warnings, names, !totalsOn
      ? `these ${marks} contain the known parts only; missing components are not drawn`
      : marked
        ? 'their totals count the drawn parts only, with a note naming the missing parts'
        : "their totals count the drawn parts only and print as plain totals; notes.show ['disclosure'] marks them (partial) and prints the note naming the missing parts", every);
  }
}

/**
 * The mean over the plotted values: per cell when grouped, per category total
 * when stacked. Undefined when nothing is plotted; there is no mean of no values.
 */
export function plottedMean<S extends { id: Id }>(
  scope: 'all' | Id[],
  stackedLike: boolean,
  categoryCount: number,
  dataSeries: readonly S[],
  plotted: (s: S, si: number, ci: number) => number | null,
): number | undefined {
  const selected = dataSeries.flatMap((series, si) => (scope === 'all' || scope.includes(series.id) ? [[series, si] as const] : []));
  const values: number[] = [];
  if (stackedLike) {
    for (let ci = 0; ci < categoryCount; ci++) {
      let any = false;
      let total = 0;
      for (const [series, si] of selected) {
        const value = plotted(series, si, ci);
        if (value === null) continue;
        any = true;
        total += value;
      }
      if (any) values.push(total);
    }
  } else {
    for (const [series, si] of selected) {
      for (let ci = 0; ci < categoryCount; ci++) {
        const value = plotted(series, si, ci);
        if (value !== null) values.push(value);
      }
    }
  }
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
}

/** Segment order of a stack: by series total, ties by series id. */
export function sortSegments<T extends { id: string }>(
  series: T[],
  order: 'sheet' | 'asc' | 'desc' | 'reverse' | undefined,
  total: (s: T) => number,
): T[] {
  if (!order || order === 'sheet') return series;
  if (order === 'reverse') return [...series].reverse();
  const dir = order === 'asc' ? 1 : -1;
  return [...series].sort(
    (a, b) => (total(a) - total(b)) * dir || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/**
 * The 100% basis of one category: total100, else the sum of its absolute
 * (non-percent) values. Any negative component, a direct share included,
 * leaves the composition undefined (n.m.). A basis of zero or less with no
 * direct share has nothing to compose (n/a); direct shares still draw.
 */
export function compositionBasis(
  values: readonly { v: number | null; isPct?: boolean }[],
  total100: number | undefined,
): { basis: number; nm: boolean; na: boolean; direct: boolean } {
  const nm = values.some((x) => x.v !== null && x.v < 0);
  const basis = total100 ?? values.reduce((a, x) => a + (x.isPct || x.v === null ? 0 : x.v), 0);
  const direct = values.some((x) => x.isPct === true && x.v !== null);
  return { basis, nm, direct, na: !nm && basis <= 0 && !direct };
}

/**
 * The sum of one category's 100% shares when they run past 100% by more than
 * the rounding of their printed labels allows (half a point per drawn part):
 * 60% + 60% + 10% are not parts of one whole (overlapping answers, a data
 * error), and a bar of them would run past the 100% end. Undefined for a row
 * within 100%: 34% + 33% + 34% draws. A direct share counts as given, an
 * absolute part as its share of `basis`. Callers check after the n.m. and n/a
 * rules, so every part is nonnegative.
 */
export function overfullShareSum(values: readonly { v: number | null; isPct?: boolean }[], basis: number): number | undefined {
  const shares = values.flatMap((x) => (x.v === null ? [] : [x.isPct ? x.v : basis > 0 ? (x.v / basis) * 100 : 0])).filter((share) => share > 0);
  const sum = shares.reduce((a, share) => a + share, 0);
  return sum > 100 + 0.5 * shares.length + 1e-9 ? sum : undefined;
}

/**
 * The n.m. disclosure of 100% compositions whose parts add past 100%: each
 * category with its sum. An error when no category is left to draw.
 */
export function overfullWarning(rows: readonly { id: Id; sum: number }[], allSuppressed: boolean, suggest: string): LintWarning {
  return {
    code: 'stacked100-over-100',
    severity: allSuppressed ? 'error' : 'warn',
    message: `100% composition is undefined where the parts add past 100%; suppressed and marked n.m.: ${rows.map((row) => `${row.id} (${Math.round(row.sum * 10) / 10}%)`).join(', ')}`,
    suggest,
    ...(rows.length === 1 ? { owner: { categoryId: rows[0]!.id } } : {}),
  };
}

/** The n.m. disclosure of a 100% composition with negative components. */
export function mixedSignsWarning(
  ids: readonly Id[],
  categoryCount: number,
  advice = { tail: " — use variant:'stacked' or a variance/waterfall chart for signed contributions", suggest: "use variant 'stacked', or type 'variance' or 'waterfall' for signed contributions" },
): LintWarning {
  return {
    code: 'stacked100-mixed-signs',
    severity: ids.length === categoryCount ? 'error' : 'warn',
    message: `100% composition is undefined for categories with negative components; suppressed and marked n.m.: ${ids.join(', ')}${advice.tail}`,
    suggest: advice.suggest,
  };
}
