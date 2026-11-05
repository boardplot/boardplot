/**
 * Design advice: the `engine` rules of the design cards in catalog.ts. Each
 * one returns a warning of severity `advice` whose code is the rule id and
 * whose message is the rule text, with a fix patch and the reference anchor.
 * Advice reads the authored spec and the drawn geometry. Patches use replace,
 * so diagnostics completion builds a missing `options` parent; it never changes the
 * drawing and never refuses. It judges only charts that drew, and only the
 * outer chart of a document: a grid panel keeps the order and the key its
 * grid shares. A render returns at most ADVICE_PER_RENDER of them.
 */
import { designRuleText } from '../catalog';
import { CROWDED_NAMES } from '../label/categoryRow';
import type { JsonPatchOperation } from '../diagnostics/jsonPatch';
import type { LintWarning } from '../types/scene';
import { categoriesOf, cellNumber, chartOptions, isRecord, labelOf, records, seriesOf, type LintRecord, type ScopedLintChart } from './shared';

export const designCodes = [
  'design-bar-sort',
  'design-bar-many',
  'design-line-direct-labels',
  'design-line-label-points',
  'design-waterfall-closing-total',
  'design-waterfall-horizontal',
] as const;

export type DesignCode = (typeof designCodes)[number];
export interface DesignWarning extends Omit<LintWarning, 'code'> {
  code: DesignCode;
}

/** Literal anchors, so the anchor check finds each one in the generated reference. */
const DOCS: Record<DesignCode, string> = {
  'design-bar-sort': 'docs/reference/bar.md#design-bar-sort',
  'design-bar-many': 'docs/reference/bar.md#design-bar-many',
  'design-line-direct-labels': 'docs/reference/line.md#design-line-direct-labels',
  'design-line-label-points': 'docs/reference/line.md#design-line-label-points',
  'design-waterfall-closing-total': 'docs/reference/waterfall.md#design-waterfall-closing-total',
  'design-waterfall-horizontal': 'docs/reference/waterfall.md#design-waterfall-horizontal',
};

export const ADVICE_PER_RENDER = 3;

/** Bars above this count fold their tail into Others. */
const BARS_MAX = 15;
/** The bars a topN fix keeps before its Others bar. */
const BARS_KEPT = 10;
/** Periods above this count print too many values when every point is labelled. */
const LABELLED_POINTS_MAX = 12;
/** A line chart with more series than this gets series-overload, not this advice. */
const LINES_MAX = 6;

/**
 * Names whose order means something: periods, ranges, scales and sequences.
 * A digit covers years, quarters, age bands and size classes.
 */
const ORDERED_NAME = /\d|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|very|strongly|somewhat|low|medium|mid|high|small|large|first|second|third|last|before|after|early|late|stage|phase|step)\b/i;
/** Rows that keep their place whatever the values: totals, rests and averages. */
const PINNED_NAME = /^(?:total|others?|rest|average|avg|all|overall)\b/i;

export function runDesignLints(charts: readonly ScopedLintChart[]): DesignWarning[] {
  const found: DesignWarning[] = [];
  for (const chart of charts) {
    if (!chart.requireMessageTitle || !chart.geometry) continue;
    if (chart.type === 'bar') found.push(...barAdvice(chart));
    else if (chart.type === 'line') found.push(...lineAdvice(chart));
    else if (chart.type === 'waterfall') found.push(...waterfallAdvice(chart));
  }
  return found.slice(0, ADVICE_PER_RENDER);
}

function advice(chart: ScopedLintChart, code: DesignCode, field: string, suggest: string, fix: JsonPatchOperation[], drawn?: string): DesignWarning {
  const base = chart.path;
  return {
    code,
    severity: 'advice',
    message: `chart '${chart.displayName}'${drawn ? ` (${drawn})` : ''}: ${designRuleText(code)}`,
    suggest,
    docs: DOCS[code],
    ...(base === undefined ? {} : {
      path: `${base}${field}`,
      fix: fix.map((operation) => ({ ...operation, path: `${base}${operation.path}` })),
    }),
  };
}

/** One series' numbers in category order, keyed or positional. */
function valuesInOrder(series: LintRecord, categories: readonly LintRecord[]): (number | null)[] {
  const entries = Array.isArray(series.values) ? series.values : [];
  const keyed = entries.length > 0 && entries.every((entry) => isRecord(entry) && 'categoryId' in entry);
  return categories.map((category, index) => {
    const entry = keyed ? entries.find((candidate) => isRecord(candidate) && candidate.categoryId === category.id) : entries[index];
    return cellNumber(isRecord(entry) && 'categoryId' in entry ? entry.value : entry);
  });
}

/** Largest first: what the sort fix gives, and what a sorted ranking already shows. */
function largestFirst(values: readonly number[]): boolean {
  return values.every((value, index) => index === 0 || value <= values[index - 1]!);
}

/**
 * Categories a ranking may reorder: no dates, no authored groups or breaks,
 * and no names of periods, ranges, scales, totals or rests.
 */
function rankable(categories: readonly LintRecord[]): boolean {
  return categories.every((category) => {
    const name = labelOf(category) ?? '';
    return category.date === undefined && !category.gapAfter && !category.breakAfter
      && !ORDERED_NAME.test(name) && !PINNED_NAME.test(name.trim());
  });
}

/** Categories that draw a bar in the geometry; undefined when the geometry has no bar marks. */
function drawnBars(chart: ScopedLintChart): number | undefined {
  const ids = new Set<string>();
  for (const node of chart.geometry?.scene ?? []) {
    if (node.t === 'rect' && node.part === 'bar' && node.owner.categoryId) ids.add(node.owner.categoryId);
  }
  return ids.size || undefined;
}

function barAdvice(chart: ScopedLintChart): DesignWarning[] {
  const options = chartOptions(chart);
  const variant = options.variant ?? 'grouped';
  if (variant === 'tornado' || variant === 'football-field') return [];
  const categories = categoriesOf(chart);
  const found: DesignWarning[] = [];
  const dataSeries = seriesOf(chart).filter((series) => series.role !== 'reference');
  // Sorting or folding reorders the bars: both rules stand down where the order means something.
  if (!rankable(categories)) return [];
  if (variant === 'grouped' && options.sort === undefined && options.topN === undefined && dataSeries.length === 1
    && categories.length >= 5 && categories.length <= BARS_MAX) {
    const values = valuesInOrder(dataSeries[0]!, categories);
    if (values.every((value) => value !== null) && !largestFirst(values as number[])) {
      found.push(advice(chart, 'design-bar-sort', '/options/sort', 'set options.sort.categories to desc',
        [{ op: 'replace', path: '/options/sort', value: { categories: 'desc' } }]));
    }
  }
  // The bars that draw, after any topN cut and its Others bar.
  const topN = isRecord(options.topN) && typeof options.topN.n === 'number' ? options.topN : undefined;
  const cut = topN && categories.length > (topN.n as number)
    ? (topN.n as number) + (topN.rest === false ? 0 : 1) : categories.length;
  const drawn = drawnBars(chart) ?? cut;
  if (drawn > BARS_MAX) {
    // An authored topN keeps its other fields; only the count changes.
    const fix: JsonPatchOperation[] = isRecord(options.topN)
      ? [{ op: 'replace', path: '/options/topN/n', value: BARS_KEPT }]
      : [{ op: 'replace', path: '/options/topN', value: { n: BARS_KEPT, rest: true } }];
    found.push(advice(chart, 'design-bar-many', '/options/topN', `keep the top ${BARS_KEPT} with options.topN and fold the rest into Others`, fix, `${drawn} bars drawn`));
  }
  return found;
}

function legendPosition(legend: unknown): unknown {
  return isRecord(legend) ? legend.position : legend;
}

function between(count: number, low: number, high: number): boolean {
  return count >= low && count <= high;
}

/** Series that draw a line in the geometry; a series with no value in a zoom or window draws none. Undefined without line marks. */
function drawnLines(chart: ScopedLintChart): number | undefined {
  const ids = new Set<string>();
  for (const node of chart.geometry?.scene ?? []) {
    if (node.t === 'path' && node.part === 'line' && node.owner.seriesId) ids.add(node.owner.seriesId);
  }
  return ids.size || undefined;
}

/**
 * Periods the line draws: the live window's displayed categories (window.last,
 * decimation, within any zoom), else the viewDomain range, else every category.
 */
function drawnPeriods(chart: ScopedLintChart, options: LintRecord): number {
  const live = (chart.geometry?.derived as { liveWindow?: { displayedCategoryIds?: unknown } } | undefined)?.liveWindow;
  if (Array.isArray(live?.displayedCategoryIds)) return live.displayedCategoryIds.length;
  const categories = categoriesOf(chart);
  const zoom = isRecord(options.viewDomain) && Array.isArray(options.viewDomain.x) ? options.viewDomain.x : undefined;
  if (zoom) {
    const [from, to] = zoom.map((id) => categories.findIndex((category) => category.id === id));
    if (from !== undefined && to !== undefined && from >= 0 && to >= 0) return Math.abs(to - from) + 1;
  }
  return categories.length;
}

function lineAdvice(chart: ScopedLintChart): DesignWarning[] {
  const options = chartOptions(chart);
  const found: DesignWarning[] = [];
  const series = seriesOf(chart);
  const dataSeries = series.filter((item) => item.role !== 'reference');
  const plainLines = (options.variant ?? 'line') === 'line' && options.fan === undefined
    && dataSeries.length === series.length && between(drawnLines(chart) ?? dataSeries.length, 2, LINES_MAX)
    // A scenario's dash pattern is read from the key.
    && dataSeries.every((item) => item.scenario === undefined || String(item.scenario).toUpperCase().startsWith('AC'));
  const position = legendPosition(options.legend);
  // By default the lines name themselves beside the legend; legend-redundant reports that pair.
  const namedOnLines = options.seriesLabels !== 'key' && options.seriesLabels !== 'none';
  // End names that do not fit fall back to a key: the probe advises the fix only where it draws without a new finding.
  if (plainLines && (position === 'top' || position === 'bottom') && !namedOnLines
    && chart.drawsWith?.({ legend: 'none', seriesLabels: 'end' }) !== false) {
    found.push(advice(chart, 'design-line-direct-labels', '/options/legend', 'set options.legend to none and options.seriesLabels to end', [
      { op: 'replace', path: '/options/legend', value: 'none' },
      { op: 'replace', path: '/options/seriesLabels', value: 'end' },
    ]));
  }
  const periods = drawnPeriods(chart, options);
  if (options.valueLabels === 'all' && periods > LABELLED_POINTS_MAX) {
    found.push(advice(chart, 'design-line-label-points', '/options/valueLabels', 'remove options.valueLabels for the default, or set it to last or ends',
      [{ op: 'remove', path: '/options/valueLabels' }], `${periods} periods drawn`));
  }
  return found;
}

/** Category-row findings that say the step names did not fit upright. */
function waterfallAdvice(chart: ScopedLintChart): DesignWarning[] {
  const options = chartOptions(chart);
  const items = records(isRecord(chart.data) ? chart.data.items : undefined);
  const found: DesignWarning[] = [];
  const last = items.at(-1);
  if (items.length >= 2 && last && last.type !== 'total' && last.type !== 'subtotal') {
    const ids = new Set(items.map((item) => item.id));
    let id = 'total';
    for (let suffix = 2; ids.has(id); suffix++) id = `total-${suffix}`;
    found.push(advice(chart, 'design-waterfall-closing-total', '/data/items', 'add a last item with type total (with rows, a last row whose type is total); Boardplot sums the steps',
      [{ op: 'add', path: '/data/items/-', value: { id, label: 'Total', type: 'total' } }]));
  }
  // A horizontal bridge has its own floor and drops some annotations: the probe advises it only where it draws without a new finding.
  if (options.variant !== 'horizontal' && chart.geometry!.warnings.some((warning) => CROWDED_NAMES.has(warning.code))
    && chart.drawsWith?.({ variant: 'horizontal' }) !== false) {
    found.push(advice(chart, 'design-waterfall-horizontal', '/options/variant', 'set options.variant to horizontal; the names then read in a column left of the bars',
      [{ op: 'replace', path: '/options/variant', value: 'horizontal' }]));
  }
  return found;
}
