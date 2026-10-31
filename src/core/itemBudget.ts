/**
 * The most categories, rows or items one chart draws. Layout time grows
 * with about the square of the count: a column of 2,000 categories takes
 * 1.3 s, 10,000 take 19 s and 150,000 ran for more than 15 minutes, with no
 * category wider than a pixel. Above the budget the chart refuses at once and
 * names the fix. The budget is the line's sampling floor (AUTO_DECIMATE_MIN
 * in line/domain.ts): a dated line samples a long series instead. Likert lays
 * out a diverging stack per item and took 24.5 s for 1,000 items, so it keeps
 * a quarter of the budget; mekko grows about linearly and draws 20,000
 * categories in 7 s. Pie keeps the seven largest slices by default and pvm
 * draws a few aggregate effects, so neither draws one entry per source item.
 * The budget counts what the chart draws: after topN, after a column's or
 * combo's viewDomain and window.last, and after a Pareto's automatic tail fold.
 */

import { crowdedTailCut } from './paretoTail';
import { NormalizeError } from './normalize/shared';

export const ITEM_BUDGET = 2000;

const TYPE_BUDGETS: Readonly<Record<string, number>> = { likert: 500, mekko: 20_000 };

export const TOO_MANY_ITEMS = 'too-many-items';

/** What a point-drawing chart may cost: points (drawn categories times series) plus `perSeries` for each series. */
interface PointLimit { budget: number; perSeries: number }

/**
 * A line or area costs its points plus 100 per series, up to 300,000. Memory follows the points
 * (about 7 KB each: 1,000 categories by 201 series use 1.4 GB, 1,999 by 200 ran out of memory),
 * and time grows faster than linearly with the series (100 categories by 2,000 series take 11 s and
 * 2 GB, by 4,000 take 78 s). The line counts after its viewport and its sampling, so a dated line
 * that samples keeps drawing.
 */
export const LINE_LIMIT: PointLimit = { budget: 300_000, perSeries: 100 };

/**
 * A combo labels and stacks every point, so it costs its points plus 40 per series, up to 20,000:
 * 300 categories by 51 series take 10 s and 2.1 GB, 10 by 600 take 22 s, and 10 by 1,000 did not
 * finish in 150 s.
 */
export const COMBO_LIMIT: PointLimit = { budget: 20_000, perSeries: 40 };

/** Throws the `too-many-items` refusal when a chart costs more than its limit (a line or area by default). */
export function checkPointBudget(categories: number, series: number, limit: PointLimit = LINE_LIMIT, chart = 'a line or area chart'): void {
  const cost = categories * series + limit.perSeries * series;
  if (cost <= limit.budget) return;
  throw new NormalizeError(
    TOO_MANY_ITEMS,
    'series',
    `${series} series of ${categories} categories cost ${cost} (the points plus ${limit.perSeries} for each series), over the ${limit.budget} ${chart} draws; it would take minutes or run out of memory`,
    'draw fewer series, aggregate the periods first (weeks or months), or set window.last or viewDomain to draw part of the periods',
    undefined,
    ['data', 'series'],
  );
}

/** The data lists whose length sets what a type draws. Line, area and combo count points in checkPointBudget, tables scroll, and the other types draw aggregates. */
const BUDGETED_LISTS: Readonly<Record<string, readonly string[]>> = {
  column: ['categories'], bar: ['categories'], combo: ['categories'], dot: ['categories'], variance: ['categories'],
  butterfly: ['categories'], funnel: ['categories'], mekko: ['categories'], waffle: ['categories'],
  bartable: ['categories'], heatmap: ['categories', 'series'], status: ['rows', 'columns'],
  bullet: ['rows'], gantt: ['rows'], pareto: ['items'], waterfall: ['items'], likert: ['items'],
  treemap: ['items'], pyramid: ['bands'], cohort: ['cohorts'],
};

/** Types whose layout keeps only `topN.n` items, so a long list with topN draws. */
const TOP_N_TYPES = new Set(['bar', 'butterfly', 'column', 'mekko', 'pareto', 'likert', 'pyramid']);

/** Banded types that draw only the categories inside `viewDomain.x` and `window.last`. */
const VIEWPORT_TYPES = new Set(['column', 'combo']);

interface BudgetOptions {
  topN?: { n?: number; rest?: boolean; threshold?: number };
  anomaly?: unknown;
  viewDomain?: { x?: [string, string] };
  window?: { last?: number };
}

/** How many bar categories have an absolute total of at least `threshold`. */
function barTotalsAtLeast(data: unknown, threshold: number): number {
  const series = (data as { series?: unknown } | null | undefined)?.series;
  const categories = (data as { categories?: unknown[] } | null | undefined)?.categories ?? [];
  const totals = new Float64Array(categories.length);
  if (Array.isArray(series)) for (const one of series) {
    const values = (one as { values?: unknown } | null)?.values;
    if (!Array.isArray(values)) continue;
    for (let i = 0; i < totals.length && i < values.length; i += 1) {
      const cell = values[i];
      const value = typeof cell === 'number' ? cell : (cell as { v?: unknown } | null)?.v;
      if (typeof value === 'number' && Number.isFinite(value)) totals[i] = totals[i]! + value;
    }
  }
  let count = 0;
  for (const total of totals) if (Math.abs(total) >= threshold) count += 1;
  return count;
}

/** How many entries of `list` the chart draws after the reductions its layout applies. */
function drawnCount(type: string, key: string, list: unknown[], data: unknown, options: BudgetOptions | undefined): number {
  let count = list.length;
  // A column ignores topN when an anomaly rule needs every period.
  const topN = options?.topN;
  if (TOP_N_TYPES.has(type) && topN?.n !== undefined && topN.n > 0 && !(type === 'column' && options?.anomaly)) {
    let kept = Math.min(count, type === 'bar' ? Math.max(1, topN.n) : topN.n);
    // A bar's threshold drops every kept category whose total is under it (topNCut in charts/topN.ts).
    if (type === 'bar' && topN.threshold !== undefined) kept = Math.min(kept, Math.max(1, barTotalsAtLeast(data, topN.threshold)));
    count = Math.min(count, kept + (topN.rest === false || kept === count ? 0 : 1));
  }
  if (VIEWPORT_TYPES.has(type) && key === 'categories') {
    const ends = options?.viewDomain?.x;
    if (ends) {
      const first = list.findIndex((category) => (category as { id?: unknown })?.id === ends[0]);
      const last = list.findIndex((category) => (category as { id?: unknown })?.id === ends[1]);
      // An unknown end refuses in the layout with its own code.
      count = first < 0 || last < 0 ? 0 : Math.abs(last - first) + 1;
    }
    const window = options?.window?.last;
    if (window !== undefined && window > 0) count = Math.min(count, window);
  }
  if (type === 'pareto' && options?.topN === undefined) {
    // Pareto folds a crowded tail into Rest by default (crowdedTailCut in pareto/layout.ts).
    const values = list
      .filter((item) => !(item as { rest?: unknown })?.rest)
      .map((item) => (item as { value?: unknown })?.value)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)
      .sort((a, b) => b - a);
    const fold = crowdedTailCut(values.map((value) => ({ value })));
    if (fold !== undefined) count = Math.min(count, fold + 1 + list.length - values.length);
  }
  return count;
}

const NOUNS: Readonly<Record<string, string>> = { series: 'rows' };

/** Throws the `too-many-items` refusal when a budgeted list of `data` is longer than its type's budget. */
export function checkItemBudget(type: string, data: unknown, options: unknown): void {
  const lists = BUDGETED_LISTS[type];
  if (!lists) return;
  const budget = TYPE_BUDGETS[type] ?? ITEM_BUDGET;
  for (const key of lists) {
    const list = (data as Record<string, unknown> | null | undefined)?.[key];
    if (!Array.isArray(list) || list.length <= budget || drawnCount(type, key, list, data, options as BudgetOptions | undefined) <= budget) continue;
    const noun = NOUNS[key] ?? key;
    const fix = TOP_N_TYPES.has(type) ? ', set topN to keep the largest' : '';
    throw new NormalizeError(
      TOO_MANY_ITEMS,
      key,
      `${list.length} ${noun} exceed the ${budget} a ${type} chart draws; its layout would take minutes`,
      `aggregate the ${noun} first (weeks or months, or the largest with a rest)${fix}, or draw dated values as a line, which samples long series`,
      undefined,
      ['data', key],
    );
  }
}
