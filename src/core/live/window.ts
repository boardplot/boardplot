/**
 * The sampling behind the line `window` option: which categories a live
 * window and its opt-in display decimation keep, as indexes into the
 * categories passed in. `applyCategoryViewport` (core/viewport) applies them.
 *
 * Decimation keeps whole original categories. Each series keeps its own bucket
 * min and max; ranking only the largest value across series would drop another
 * series' spike or trough. No value is averaged, interpolated or manufactured.
 * The kept count can exceed `maxPoints` because the window ends always survive,
 * distinct per-series extrema are retained, and both sides of a gap stay.
 */

import { LiveDataError, type LiveSamplingMethod, type LiveWindowOptions } from './types';

const MIN_DECIMATION_POINTS = 4;

interface LiveWindowSampling {
  method: LiveSamplingMethod;
  /** Indexes into the categories passed in, ascending. */
  kept: number[];
  /** The requested category budget when minmax ran. */
  maxPoints?: number;
}

/** `rows` holds one value row per series, aligned with `categories`. */
export function sampleLiveWindow(
  categories: readonly { date?: string }[],
  rows: readonly (readonly (number | null)[])[],
  options: LiveWindowOptions,
  /** The x of each category on a continuous axis: buckets then span equal x ranges, so uneven readings keep each pixel's extremes. */
  xs?: readonly number[],
): LiveWindowSampling {
  if (categories.length === 0) {
    throw new LiveDataError('unsupported-shape', 'data.categories', 'live windows need at least one category');
  }
  assertOrdering(categories);
  const plan = requestedMetric(options);
  const windowStart = plan.last === undefined ? 0 : Math.max(0, categories.length - plan.last);
  const windowed: number[] = [];
  for (let index = windowStart; index < categories.length; index += 1) windowed.push(index);
  const kept = plan.bucketCount === 0 || windowed.length <= plan.bucketCount * 2
    ? windowed
    : decimateIndexes(rows, windowed, plan.bucketCount, xs);
  return { method: plan.method, kept, ...(plan.maxPoints === undefined ? {} : { maxPoints: plan.maxPoints }) };
}

interface LiveMetricPlan {
  last?: number;
  method: LiveSamplingMethod;
  bucketCount: number;
  maxPoints?: number;
}

function requestedMetric(options: LiveWindowOptions): LiveMetricPlan {
  const last = options.last;
  if (last !== undefined && (!Number.isInteger(last) || last < 1)) {
    throw new LiveDataError('invalid-window', 'last', 'last must be a positive integer');
  }
  const decimate = options.decimate;
  if (decimate === undefined || decimate === 'none') return { last, method: last === undefined ? 'none' : 'last-n', bucketCount: 0 };
  if (decimate !== 'minmax') {
    throw new LiveDataError(
      'unsupported-metric',
      'decimate',
      `decimation metric '${String(decimate)}' is unsupported; this build implements 'minmax' only`,
    );
  }
  const maxPoints = options.maxPoints;
  if (!Number.isInteger(maxPoints) || (maxPoints as number) < MIN_DECIMATION_POINTS) {
    throw new LiveDataError(
      'invalid-window',
      'maxPoints',
      `decimation needs maxPoints to be an integer of at least ${MIN_DECIMATION_POINTS}`,
    );
  }
  return {
    last,
    method: last === undefined ? 'minmax' : 'last-n+minmax',
    bucketCount: Math.floor((maxPoints as number) / 2),
    maxPoints: maxPoints as number,
  };
}

/**
 * Category dates must be strictly increasing when they are authored at all.
 * A window or a decimation over an undefined order would be a guess, so the
 * out-of-order case is refused rather than sorted behind the author's back.
 */
function assertOrdering(categories: readonly { date?: string }[]): void {
  let previous: string | undefined;
  categories.forEach(({ date }, index) => {
    if (date === undefined) return;
    if (previous !== undefined && date <= previous) {
      throw new LiveDataError(
        'unsupported-ordering',
        `data.categories[${index}].date`,
        `category dates must strictly increase for a live window; '${date}' does not follow '${previous}'`,
      );
    }
    previous = date;
  });
}

/**
 * One bucket per two kept categories of a single series. Each series contributes
 * its own min and max category, ties to the earlier original index, so a second
 * series' spike or trough is not discarded. Duplicate category identities collapse.
 */
function decimateIndexes(rows: readonly (readonly (number | null)[])[], windowed: number[], bucketCount: number, xs?: readonly number[]): number[] {
  const kept = new Set<number>([windowed[0] as number, windowed[windowed.length - 1] as number]);
  for (const slice of xs ? valueBuckets(windowed, bucketCount, xs) : indexBuckets(windowed, bucketCount)) {
    if (slice.length === 0) continue;
    for (const values of rows) for (const index of seriesExtrema(values, slice)) kept.add(index);
  }
  // Keep both sides of a missing-value boundary so sampling cannot join a gap.
  for (const values of rows) {
    for (let at = 1; at < windowed.length; at += 1) {
      const before = windowed[at - 1]!, after = windowed[at]!;
      if ((finite(values[before]) === undefined) !== (finite(values[after]) === undefined)) {
        kept.add(before); kept.add(after);
      }
    }
  }
  return [...kept].sort((left, right) => left - right);
}

function indexBuckets(windowed: number[], bucketCount: number): number[][] {
  const buckets: number[][] = [];
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    buckets.push(windowed.slice(Math.floor((bucket * windowed.length) / bucketCount), Math.floor(((bucket + 1) * windowed.length) / bucketCount)));
  }
  return buckets;
}

/** Buckets of equal x range across the window; `xs` ascend with the indexes. */
function valueBuckets(windowed: number[], bucketCount: number, xs: readonly number[]): number[][] {
  const x0 = xs[windowed[0]!]!, x1 = xs[windowed[windowed.length - 1]!]!;
  const width = (x1 - x0) / bucketCount || 1;
  const buckets: number[][] = Array.from({ length: bucketCount }, () => []);
  for (const index of windowed) buckets[Math.min(bucketCount - 1, Math.floor((xs[index]! - x0) / width))]!.push(index);
  return buckets;
}

/** Min and max original indexes for one series inside a bucket. Equal values keep the earlier category. */
function seriesExtrema(values: readonly (number | null)[], slice: number[]): number[] {
  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;
  let minIndex: number | undefined;
  let maxIndex: number | undefined;
  for (const index of slice) {
    const value = finite(values[index]);
    if (value === undefined) continue;
    if (minIndex === undefined || value < minValue) {
      minValue = value;
      minIndex = index;
    }
    if (maxIndex === undefined || value > maxValue) {
      maxValue = value;
      maxIndex = index;
    }
  }
  return [minIndex, maxIndex].filter((index): index is number => index !== undefined);
}

function finite(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
