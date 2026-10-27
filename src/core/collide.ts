/**
 * 1-D collision strategies — candidate-generation helpers used by charts to
 * compute slot positions for dense label rows before feeding the solver
 * (src/core/label/solver.ts).
 *
 * - sweepHide:      1-D priority sweep, hides losers instead of moving them
 * - spread1D:       cluster-merge spreading (labels move, order preserved)
 *
 * Everything is deterministic: no randomness, stable tie-breaks by index.
 */

import type { LintWarning } from './types/scene';
import { maxOf } from './arrays';

interface SweepItem {
  /** Interval start along the sweep axis. */
  start: number;
  size: number;
  /** Higher wins. Ties broken by input order (earlier wins). */
  priority: number;
}

/**
 * 1-D visibility sweep: keep as many labels as possible without overlap,
 * preferring higher priority. Returns keep-flags aligned to input order.
 */
export function sweepHide(items: readonly SweepItem[], gap = 2): boolean[] {
  const keep = new Array<boolean>(items.length).fill(false);
  const order = items
    .map((_, i) => i)
    .sort((a, b) => items[b]!.priority - items[a]!.priority || a - b);
  const kept: Array<{ start: number; end: number }> = [];
  for (const i of order) {
    const it = items[i]!;
    const start = it.start;
    const end = it.start + it.size;
    const clash = kept.some((k) => start < k.end + gap && k.start < end + gap);
    if (!clash) {
      keep[i] = true;
      kept.push({ start, end });
    }
  }
  return keep;
}

interface SpreadItem {
  /** Ideal center position. */
  desired: number;
  /** Extent along the axis. */
  size: number;
}

interface Spread1DResult {
  positions: number[];
  /** False means the requested extents and gaps cannot fit inside the bounds. */
  fits: boolean;
}

/**
 * Deterministic 1-D label spreading (the "clusterSpread" strategy): labels
 * keep their relative order, overlapping runs merge into clusters centered on
 * the mean of their desired positions, clusters clamp to bounds. Returns
 * center positions aligned to input order.
 */
export function spread1D(
  items: readonly SpreadItem[],
  bounds: [number, number],
  gap = 2,
): number[] {
  return calculateSpread1D(items, bounds, gap, false).positions;
}

/**
 * Status-bearing twin of spread1D. Existing callers keep the number[] API;
 * callers that must distinguish a valid spread from unavoidable overlap can
 * use this result without inferring failure from coordinates.
 */
export function spread1DResult(
  items: readonly SpreadItem[],
  bounds: [number, number],
  gap = 2,
): Spread1DResult {
  return calculateSpread1D(items, bounds, gap, true);
}

/**
 * The shared disclosure for an unfit spread: every call site keeps its own
 * message wording; only the warning shape is centralized.
 */
export function warnSpreadOverflow(warnings: LintWarning[], fits: boolean, message: string): void {
  if (!fits) warnings.push({ code: 'label-spread-overflow', severity: 'warn', message });
}

function calculateSpread1D(
  items: readonly SpreadItem[],
  bounds: [number, number],
  gap: number,
  containImpossiblePack: boolean,
): Spread1DResult {
  const n = items.length;
  if (n === 0) return { positions: [], fits: true };
  const [lo, hi] = bounds;
  const span = Math.max(0, hi - lo);
  const required = items.reduce((sum, item) => sum + item.size, 0) + gap * Math.max(0, n - 1);

  // Work in sorted-by-desired order, remember mapping back.
  const order = items.map((_, i) => i).sort((a, b) => items[a]!.desired - items[b]!.desired || a - b);

  if (required > span && containImpossiblePack) {
    const maxHalfSize = Math.min(
      span / 2,
      maxOf(items.map((item) => Math.max(0, item.size) / 2)),
    );
    const first = lo + maxHalfSize;
    const last = hi - maxHalfSize;
    const positions = new Array<number>(n);
    for (let k = 0; k < n; k++) {
      const idx = order[k]!;
      positions[idx] = n === 1 ? (lo + hi) / 2 : first + (last - first) * (k / (n - 1));
    }
    return { positions, fits: false };
  }

  interface Cluster {
    indices: number[]; // sorted-order indices (into `order`)
    sumDesired: number;
    size: number; // total extent incl. inner gaps
  }

  const clusters: Cluster[] = [];
  for (let k = 0; k < n; k++) {
    const idx = order[k]!;
    const it = items[idx]!;
    let cur: Cluster = { indices: [k], sumDesired: it.desired, size: it.size };
    // Merge backwards while overlapping the previous cluster.
    while (clusters.length > 0) {
      const prev = clusters[clusters.length - 1]!;
      const prevCenter = prev.sumDesired / prev.indices.length;
      const prevStart = clamp1(prevCenter - prev.size / 2, lo, hi - prev.size);
      const prevEnd = prevStart + prev.size;
      const curCenter = cur.sumDesired / cur.indices.length;
      const curStart = clamp1(curCenter - cur.size / 2, lo, hi - cur.size);
      if (curStart < prevEnd + gap) {
        clusters.pop();
        cur = {
          indices: [...prev.indices, ...cur.indices],
          sumDesired: prev.sumDesired + cur.sumDesired,
          size: prev.size + gap + cur.size,
        };
      } else {
        break;
      }
    }
    clusters.push(cur);
  }

  // Lay out each cluster: centered on mean desired, clamped into bounds.
  const posBySortedIndex = new Array<number>(n);
  for (const c of clusters) {
    const center = c.sumDesired / c.indices.length;
    let start = clamp1(center - c.size / 2, lo, Math.max(lo, hi - c.size));
    for (const k of c.indices) {
      const idx = order[k]!;
      const it = items[idx]!;
      posBySortedIndex[k] = start + it.size / 2;
      start += it.size + gap;
    }
  }

  const out = new Array<number>(n);
  for (let k = 0; k < n; k++) out[order[k]!] = posBySortedIndex[k]!;
  return { positions: out, fits: required <= span };
}

function clamp1(v: number, lo: number, hi: number): number {
  return hi < lo ? lo : v < lo ? lo : v > hi ? hi : v;
}
