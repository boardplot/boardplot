/** The categories and series of a category chart (bar, column, line, combo, mekko), read one way. */

import { NormalizeError, normalizeCategory, normalizeScenario, normalizeSeriesValues } from '../normalize/shared';
import { cellMeta, cellValue, isPctCell, type Cell, type Scenario } from '../types/cell';
import type { Category, Series } from '../types/data';

/** The per-cell fields every category chart reads. */
interface CellFields {
  v: number | null;
  isPct: boolean;
  fill?: string;
  scenario?: Scenario;
  format?: string;
  labelOverride?: string | false;
  priority?: number;
}

/** One cell's value and its authored meta. `path` names the cell for a scenario refusal. */
export function cellFields(cell: Cell, path: string): CellFields {
  const meta = cellMeta(cell);
  return {
    v: cellValue(cell),
    isPct: isPctCell(cell),
    fill: meta?.fill,
    scenario: normalizeScenario(meta?.scenario as string | undefined, `${path}.scenario`),
    format: meta?.format,
    labelOverride: meta?.label,
    priority: meta?.priority,
  };
}

/**
 * The empty-data and series-id checks, the categories, and each series with
 * its cells in category order; `series` builds the type's own series record.
 */
export function normalizeCategorySeries<S extends Series & { values: unknown }, R>(
  type: string,
  data: { categories?: unknown; series?: readonly S[] } | null | undefined,
  series: (s: S, cells: Cell[], cats: Category[]) => R,
): { cats: Category[]; series: R[] } {
  if (!data || !Array.isArray(data.categories) || data.categories.length === 0) {
    throw new NormalizeError('empty-data', 'categories', `${type} requires at least one category`);
  }
  if (!Array.isArray(data.series) || data.series.length === 0) {
    throw new NormalizeError('empty-data', 'series', `${type} requires at least one series`);
  }
  const cats: Category[] = (data.categories as unknown[]).map((c, i) => normalizeCategory(c as never, i));
  return {
    cats,
    series: data.series.map((s, si) => {
      if (!s?.id) throw new NormalizeError('missing-id', `series[${si}]`, 'series requires an id');
      return series(s, normalizeSeriesValues(s, cats, si), cats);
    }),
  };
}
