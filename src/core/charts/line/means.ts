import type { Id } from '../../types/cell';
import type { Category } from '../../types/data';
import type { NormSer } from './context';
import { maxOf, minOf } from '../../arrays';

export function lineMeans(
  pv: (number | null)[][],
  rowOf: ReadonlyMap<NormSer, number>,
  drawnSeries: NormSer[],
  cats: Category[],
  /** The plotted values are in the series' own units (not rebased, not stacked100-area shares). */
  ownUnits: boolean,
) {
  const firstRow = pv[rowOf.get(drawnSeries[0]!)!]!;
  const firstVals = firstRow.filter((v): v is number => v !== null);
  const meanValue =
    firstVals.length > 0 ? firstVals.reduce((a, b) => a + b, 0) / firstVals.length : undefined;
  const catIndex = new Map(cats.map((c, i) => [c.id, i] as const));
  // Scoped-mean measurement for valueLine seriesId/from/to: measured over the
  // PLOTTED values (pv), the same basis the whole-plot 'mean' uses, over an
  // inclusive category span.
  const meanValueFor = (scope: { seriesId?: Id; from?: Id; to?: Id }):
    | { value: number; seriesId: Id; from?: Id; to?: Id; format?: string }
    | { error: string } => {
    const s =
      scope.seriesId === undefined
        ? drawnSeries[0]
        : drawnSeries.find((item) => item.id === scope.seriesId);
    if (!s) {
      return {
        error: `series '${String(scope.seriesId)}' is not a drawn data series — the mean must be measured from plotted cells`,
      };
    }
    const row = pv[rowOf.get(s)!]!;
    let ci0 = 0;
    let ci1 = cats.length - 1;
    if (scope.from !== undefined && scope.to !== undefined) {
      const fi = catIndex.get(scope.from);
      const ti = catIndex.get(scope.to);
      if (fi === undefined || ti === undefined) {
        return {
          error: `category span '${scope.from}'..'${scope.to}' names a category that does not exist`,
        };
      }
      if (fi > ti) {
        return {
          error: `category span '${scope.from}'..'${scope.to}' is reversed — 'from' must not come after 'to'`,
        };
      }
      ci0 = fi;
      ci1 = ti;
    }
    const vals = row.slice(ci0, ci1 + 1).filter((value): value is number => value !== null);
    if (vals.length === 0) {
      return { error: `series '${s.id}' has no plotted values in the requested span` };
    }
    return {
      value: vals.reduce((a, b) => a + b, 0) / vals.length,
      seriesId: s.id,
      ...(scope.from !== undefined && scope.to !== undefined
        ? { from: scope.from, to: scope.to }
        : {}),
      ...(ownUnits && s.format !== undefined ? { format: s.format } : {}),
    };
  };
  return { meanValue, catIndex, meanValueFor };
}

/** Source statistics remain stable when the host changes the visible categories. */
export function lineValueStats(
  series: NormSer[],
  domainEpsilon: number,
  population?: ReadonlyMap<Id, readonly { v: number | null }[]>,
) {
  return Object.fromEntries(series.map(series => {
    const values = (population?.get(series.id) ?? series.vals).flatMap(value => value.v === null ? [] : [value.v]);
    const range = values.length > 0 ? maxOf(values) - minOf(values) : 0;
    const mean = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    return [series.id, { range, mean, relativeRange: range / Math.max(Math.abs(mean), domainEpsilon) }];
  }));
}
