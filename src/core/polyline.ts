import { rectLineDistance, segmentHitsRect, type Point, type Rect } from './geometry';

const MAX_COORDINATE = 2 ** 40;
const MIN_DELTA = 2 ** -256;

function prepareRun(ring: readonly Point[], step: number) {
  const safe = ring.every((p, i) => {
    if (!(Math.abs(p.x) <= MAX_COORDINATE && Math.abs(p.y) <= MAX_COORDINATE)) return false;
    if (i === 0) return true;
    const dx = Math.abs(p.x - ring[i - 1]!.x), dy = Math.abs(p.y - ring[i - 1]!.y);
    return (dx === 0 || dx >= MIN_DELTA) && (dy === 0 || dy >= MIN_DELTA);
  });
  if (!safe) return { ring, chunks: null };
  const chunks: { points: Point[]; minX: number; maxX: number; minY: number; maxY: number; scale: number }[] = [];
  // Adjacent runs share their endpoint so no segment is lost.
  for (let start = 0; start < Math.max(1, ring.length - 1); start += step) {
    const points = ring.slice(start, start + step + 1);
    if (!points.length) continue;
    // One pass, no spread arrays. The coordinates are finite here (the safe check), so the
    // comparisons give the same extrema as Math.min/Math.max, including -0 against 0.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const { x, y } of points) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    chunks.push({ points, minX, maxX, minY, maxY,
      scale: Math.max(1, Math.abs(minX), Math.abs(maxX), Math.abs(minY), Math.abs(maxY)) });
  }
  return { ring, chunks };
}

function preparedDistance(outlines: ReturnType<typeof prepareRun>[]) {
  const safeOutlines = outlines.every(outline => outline.chunks !== null);
  return (rect: Rect, ownDistance?: number): number => {
    const right = rect.x + rect.w, bottom = rect.y + rect.h;
    const rectScale = Math.max(1, Math.abs(rect.x), Math.abs(rect.y), Math.abs(rect.w), Math.abs(rect.h), Math.abs(right), Math.abs(bottom));
    const safeRect = rectScale <= MAX_COORDINATE && rect.w >= 0 && rect.h >= 0;
    // A rival region needs only the existing tolerance comparison. Unsafe runs need every ring.
    const thresholdOnly = ownDistance !== undefined && safeOutlines && safeRect;
    const limit = thresholdOnly ? Math.max(0.02, ownDistance + 0.02) : Infinity;
    let best = Infinity;
    for (const { ring, chunks } of outlines) {
      if (!chunks || !safeRect) {
        // A later intersection returns 0 within a ring; Math.min retains NaN across rings.
        best = Math.min(best, rectLineDistance(rect, ring));
        continue;
      }
      for (const chunk of chunks) {
        // Direct extrema and the allowance cover rounding in corner sums and segment interpolation.
        const error = 64 * Number.EPSILON * Math.max(rectScale, chunk.scale);
        const dx = Math.max(0, rect.x - chunk.maxX, chunk.minX - right);
        const dy = Math.max(0, rect.y - chunk.maxY, chunk.minY - bottom);
        const bound = Math.min(best, limit);
        if (dx - error > bound || dy - error > bound || Math.hypot(dx, dy) - error > bound) continue;
        best = Math.min(best, rectLineDistance(rect, chunk.points));
        if (thresholdOnly && (best <= 0.02 || ownDistance >= best - 0.02)) return best;
        if (best === 0) break;
      }
    }
    return best;
  };
}

/**
 * `distance(rect) < limit`, with the same answer: it stops at the first chunk nearer than the
 * limit and skips a chunk whose bounding box is at least the limit away.
 */
function preparedCloser(outline: ReturnType<typeof prepareRun>, distance: (rect: Rect) => number) {
  return (rect: Rect, limit: number): boolean => {
    const { chunks } = outline;
    const right = rect.x + rect.w, bottom = rect.y + rect.h;
    const rectScale = Math.max(1, Math.abs(rect.x), Math.abs(rect.y), Math.abs(rect.w), Math.abs(rect.h), Math.abs(right), Math.abs(bottom));
    // Unsafe rings and rects keep the full distance and its NaN rules. A safe distance is never
    // negative or NaN, so no limit at or under 0 (or NaN) is beaten.
    if (!chunks || !(rectScale <= MAX_COORDINATE && rect.w >= 0 && rect.h >= 0)) return distance(rect) < limit;
    if (!(limit > 0)) return false;
    for (const chunk of chunks) {
      const error = 64 * Number.EPSILON * Math.max(rectScale, chunk.scale);
      const dx = Math.max(0, rect.x - chunk.maxX, chunk.minX - right);
      const dy = Math.max(0, rect.y - chunk.maxY, chunk.minY - bottom);
      if (dx - error >= limit || dy - error >= limit || Math.hypot(dx, dy) - error >= limit) continue;
      if (rectLineDistance(rect, chunk.points) < limit) return true;
    }
    return false;
  };
}

/** Exact outline distance, prepared once for fixed map rings. */
export function prepareOutlineDistance(rings: readonly (readonly Point[])[]) {
  return preparedDistance(rings.map(ring => prepareRun(ring, 16)));
}

/** Distance and touching tests for a stroke whose points stay fixed in one label pass. */
export function preparePolyline(line: readonly Point[]) {
  const run = prepareRun(line, 8);
  const byX = [...(run.chunks ?? [])].sort((a, b) => a.minX - b.minX);
  let largestX = -Infinity, lineScale = 1;
  // Prefix maxima keep long, backtracking segments in the candidate set.
  const rightEdges = byX.map(chunk => {
    lineScale = Math.max(lineScale, chunk.scale);
    return largestX = Math.max(largestX, chunk.maxX);
  });
  const directHits = (rect: Rect, pad: number) => line.some((point, i) => i > 0 && segmentHitsRect(line[i - 1]!, point, rect, pad));
  const distance = preparedDistance([run]);
  return {
    distance,
    /** Whether `distance(rect) < limit`; cheaper when only the comparison matters. */
    closerThan: preparedCloser(run, distance),
    hits(rect: Rect, pad: number): boolean {
      const x0 = rect.x - pad, x1 = rect.x + rect.w + pad;
      const y0 = rect.y - pad, y1 = rect.y + rect.h + pad;
      const scale = Math.max(1, Math.abs(x0), Math.abs(x1), Math.abs(y0), Math.abs(y1), Math.abs(pad));
      if (!run.chunks || !(scale <= MAX_COORDINATE && x0 <= x1 && y0 <= y1)) return directHits(rect, pad);
      const error = 64 * Number.EPSILON * Math.max(scale, lineScale);
      let lo = 0, hi = byX.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (x0 - rightEdges[mid]! > error) lo = mid + 1;
        else hi = mid;
      }
      for (let at = lo; at < byX.length && byX[at]!.minX - x1 <= error; at++) {
        const chunk = byX[at]!;
        const dx = Math.max(0, x0 - chunk.maxX, chunk.minX - x1);
        const dy = Math.max(0, y0 - chunk.maxY, chunk.minY - y1);
        if (dx > error || dy > error) continue;
        for (let i = 1; i < chunk.points.length; i++) {
          if (segmentHitsRect(chunk.points[i - 1]!, chunk.points[i]!, rect, pad)) return true;
        }
      }
      return false;
    },
  };
}

export type PolylineQueries = ReturnType<typeof preparePolyline>;
