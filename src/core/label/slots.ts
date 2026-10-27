import { rectsOverlap, type Rect } from '../geometry';
import type { SlotCandidate } from './solver';
import { segmentLabelCandidates } from '../charts/band/labels';


/**
 * Cascade for a stacked-column segment label: centred inside when
 * it fits with room, then tight inside, then outside with a leader, else
 * dropped. Shared by combo, mekko and waterfall; `tightLast` is the
 * waterfall order (outside before the tight inside slot).
 */
export function stackSegmentCandidates(
  rect: Rect,
  tsize: { width: number; height: number },
  fits: boolean,
  fillCss: string,
  opts: { baselineY?: number; leaderY?: number; tightLast?: boolean; insidePaint?: SlotCandidate['insidePaint']; insidePattern?: SlotCandidate['insidePattern'] } = {},
): SlotCandidate[] {
  return segmentLabelCandidates('vertical', rect, tsize, fillCss, {
    fits,
    insidePaint: opts.insidePaint,
    insidePattern: opts.insidePattern,
    baseline: opts.baselineY,
    leaderPosition: opts.leaderY,
    tightLast: opts.tightLast,
  });
}

/**
 * The nearest seats just past whatever blocks a label's canonical rect, found
 * by sliding along one axis: a value label steps past a thin rule or a
 * neighbour in its own row instead of leaving for a far lane with a leader.
 * `lo`..`hi` bounds the whole rect along `axis` (its row or ownership lane).
 * Only obstacles across the rect's cross-axis extent count. A seat keeps
 * `gap` clear of each of them and must pass the solver's own test at `pad`,
 * so `gap` should exceed `pad`. At most one seat per direction, nearest
 * first; none when the canonical rect is already free.
 */
export function seatsPastBlockers(rect: Rect, axis: 'x' | 'y', lo: number, hi: number, obstacles: readonly Rect[], gap: number, pad = 2): Rect[] {
  const [at, size, cross, crossSize] = axis === 'x' ? (['x', 'w', 'y', 'h'] as const) : (['y', 'h', 'x', 'w'] as const);
  const inRow = obstacles.filter((o) => o[cross] < rect[cross] + rect[crossSize] + gap && rect[cross] < o[cross] + o[crossSize] + gap);
  const blocked = (r: Rect): boolean => inRow.some((o) => rectsOverlap(o, r, pad));
  if (!blocked(rect)) return [];
  const distance = (r: Rect): number => Math.abs(r[at] - rect[at]);
  const seats = inRow
    .flatMap((o) => [o[at] - gap - rect[size], o[at] + o[size] + gap])
    .filter((p) => p >= lo && p + rect[size] <= hi)
    .map((p): Rect => ({ ...rect, [at]: p }))
    .filter((r) => !blocked(r))
    .sort((a, b) => distance(a) - distance(b));
  const after = seats.find((r) => r[at] > rect[at]);
  const before = seats.find((r) => r[at] < rect[at]);
  return [after, before].filter((r): r is Rect => r !== undefined).sort((a, b) => distance(a) - distance(b));
}
