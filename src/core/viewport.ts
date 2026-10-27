import { chartString } from './strings/viewport';
import type { Category } from './types/data';
import type { Annotation } from './types/annotations';
import { NormalizeError } from './normalize/shared';
import { sampleLiveWindow } from './live/window';
import type { LiveSampling, LiveWindowOptions } from './live/types';
import type { BaseOptions } from './types/options';
import { pushAll } from './arrays';

/** `target.splice(0, target.length, ...items)` without the argument limit. */
function replaceItems<T>(target: T[], items: T[]): void {
  target.length = 0;
  pushAll(target, items);
}

/** Select the painting window after index/rank/composition values are derived. */
export function applyCategoryViewport<S extends { id: string; vals: { v: number | null }[] }>(input: {
  domain?: { x: [string, string] };
  window?: LiveWindowOptions;
  categories: Category[];
  series: S[];
  plotted: (number | null)[][];
  basis: number[];
  targets: { at: string }[];
  annotations?: Annotation[];
  anchors?: string[];
  samplingRows?: (number | null)[][];
  /** The x value of each category on a continuous axis: sampling buckets by x, not by index. */
  positions?: readonly number[];
}) {
  if (!input.domain && !input.window) return undefined;
  const first = input.domain ? input.categories.findIndex(category => category.id === input.domain!.x[0]) : 0;
  const last = input.domain ? input.categories.findIndex(category => category.id === input.domain!.x[1]) : input.categories.length - 1;
  if (first < 0 || last < 0) throw new NormalizeError('unknown-category', 'viewDomain.x', 'Zoom endpoints must name source categories.');
  const lo = Math.min(first, last), hi = Math.max(first, last) + 1;
  const original = {
    categories: input.categories.slice(),
    plotted: input.plotted.map(row => row.slice()),
    values: new Map(input.series.map(series => [series.id, series.vals.slice()])),
  };
  const sampled = input.window ? sampleLiveWindow(input.categories.slice(lo, hi),
    [...input.series.map(series => series.vals.map(value => value.v)), ...(input.samplingRows ?? [])].map(row => row.slice(lo, hi)),
    input.window, input.positions?.slice(lo, hi)) : undefined;
  let indexes = sampled ? sampled.kept.map(index => index + lo)
    : Array.from({ length: hi - lo }, (_, index) => lo + index);
  if (sampled && input.window?.decimate) indexes = keepDeclaredAnchors(input, indexes);
  const select = <T>(values: T[]): T[] => indexes.map(index => values[index]!);
  replaceItems(input.categories, select(input.categories));
  replaceItems(input.basis, select(input.basis));
  for (const row of input.plotted) replaceItems(row, select(row));
  for (const series of input.series) series.vals = select(series.vals);
  const visible = new Set(input.categories.map(category => category.id));
  replaceItems(input.targets, input.targets.filter(target => visible.has(target.at)));
  const source = new Set(original.categories.map(category => category.id));
  // On a continuous axis a band's ends are x values, which the layout clips to the range.
  const annotations = input.annotations?.filter(annotation => (input.positions !== undefined && annotation.kind === 'band') || ['at', 'from', 'to'].every(field => {
    const anchor = (annotation as unknown as Record<string, unknown>)[field];
    const id = typeof anchor === 'string' ? anchor : (anchor as { categoryId?: string } | null)?.categoryId;
    return id === undefined || !source.has(id) || visible.has(id);
  }));
  return { ...original, annotations, indexes, positions: indexes.map(index => index - indexes[0]!),
    span: indexes[indexes.length - 1]! - indexes[0]! + 1,
    sampling: sampled ? { method: sampled.method, sourceCategoryIds: original.categories.map(category => category.id),
      displayedCategoryIds: input.categories.map(category => category.id), displayedSourceIndexes: indexes,
      droppedObservations: original.categories.length - indexes.length, categoryObjectsReused: true,
      ...(sampled.maxPoints === undefined ? {} : { maxPoints: sampled.maxPoints }),
      exceededMaxPoints: sampled.maxPoints === undefined ? undefined : indexes.length > sampled.maxPoints } : undefined };
}

/**
 * One rule for a mean under a window or zoom (column, bar, line, combo): the
 * mean keeps every source period, and where the plot draws fewer of the
 * periods it covers, its label names them, "Ø 42.1 (Jan 25–Dec 26)". The
 * function returns that span for a mean over the whole source or over
 * `from`–`to`, and undefined where every covered period draws. Bar has no
 * window; its topN drops or folds categories, which its mean follows.
 */
export function viewportMeanSpan(population: { categories: Category[]; indexes: number[] } | undefined) {
  return (scope: { from?: string; to?: string } = {}): string | undefined => {
    if (!population) return undefined;
    const cats = population.categories;
    const at = (id: string | undefined, fallback: number) => (id === undefined ? fallback : cats.findIndex((c) => c.id === id));
    const lo = at(scope.from, 0), hi = at(scope.to, cats.length - 1);
    if (lo < 0 || hi < 0) return undefined;
    const [a, b] = [Math.min(lo, hi), Math.max(lo, hi)];
    const drawn = new Set(population.indexes);
    const name = (c: Category) => (c.label ?? c.id).replace(/\s*\n\s*/g, ' ');
    for (let i = a; i <= b; i += 1) if (!drawn.has(i)) return `${name(cats[a]!)}–${name(cats[b]!)}`;
    return undefined;
  };
}

/** A sampled window says so in the subtitle: "Showing 12 of 36 periods". Line, column and combo. */
export function liveWindowOptions<T extends Pick<BaseOptions, 'subtitle' | 'locale' | 'strings'>>(options: T, sampling?: LiveSampling): T {
  if (!sampling) return options;
  const text = chartString(options, 'showingPeriods', { v1: sampling.displayedCategoryIds.length, v2: sampling.sourceCategoryIds.length, v3: sampling.method.includes('minmax') ? chartString(options, 'minmaxSampled') : '' });
  const authored = options.subtitle;
  if (!authored) return { ...options, subtitle: { measure: text } };
  const subtitle = typeof authored === 'string' ? { measure: authored } : authored;
  return { ...options, subtitle: { ...subtitle, period: [subtitle.period, text].filter(Boolean).join(' · ') } };
}

/** Numeric viewport limits are exact scale inputs, independent of data extents. */
export function numericViewportRange(range: [number, number] | undefined, fallback: [number, number]): [number, number] {
  if (!range) return fallback;
  const lo = Math.min(...range), hi = Math.max(...range);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) {
    throw new NormalizeError('invalid-domain', 'viewDomain', 'Numeric zoom needs two distinct finite endpoints.');
  }
  return [lo, hi];
}

/** Authored targets and annotations within the window survive sampling. */
function keepDeclaredAnchors(input: { categories: Category[]; series: { vals: { v: number | null; scenario?: string; labelOverride?: string | false }[] }[]; targets: { at: string }[]; annotations?: Annotation[]; anchors?: string[] }, indexes: number[]): number[] {
  const declared = new Set([...input.targets.map(target => target.at), ...(input.anchors ?? [])]);
  for (const annotation of input.annotations ?? []) for (const field of ['at', 'from', 'to']) {
    const value = (annotation as unknown as Record<string, unknown>)[field];
    const id = typeof value === 'string' ? value : (value as { categoryId?: string } | null)?.categoryId;
    if (id) declared.add(id);
  }
  const kept = new Set(indexes), lo = indexes[0]!, hi = indexes[indexes.length - 1]!;
  for (let index = lo; index <= hi; index += 1) {
    if (declared.has(input.categories[index]!.id)) kept.add(index);
    for (const series of input.series) {
      const value = series.vals[index]!;
      if (value.labelOverride !== undefined && value.labelOverride !== false) kept.add(index);
      if (index > lo && value.scenario !== series.vals[index - 1]!.scenario) { kept.add(index - 1); kept.add(index); }
    }
  }
  return [...kept].sort((a, b) => a - b);
}
