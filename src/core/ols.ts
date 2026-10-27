/**
 * Ordinary least squares, y = intercept + slope * x, from six moments.
 * The scatter trend line computes its fit here and its claim receipts
 * recompute it here, so the moments are the whole receipt: a reader who holds
 * them lands on the same slope, intercept and r².
 *
 * The squares are summed over deviations from the means, in a second pass.
 * Raw sums (n·Σx² − (Σx)²) cancel every digit when the mean dwarfs the
 * spread: x = 100000000, 100000001, 100000002 came out with no variance at all.
 */

export interface OlsMoments {
  n: number;
  meanX: number;
  meanY: number;
  /** Σ(x − x̄)². */
  sxx: number;
  /** Σ(y − ȳ)². */
  syy: number;
  /** Σ(x − x̄)(y − ȳ). */
  sxy: number;
}

export interface OlsFit {
  slope: number;
  intercept: number;
  /** Null when y does not vary: every point lies on the flat fit and r² is 0 over 0. */
  r2: number | null;
}

export function olsMoments(points: readonly { x: number; y: number }[]): OlsMoments {
  const n = points.length;
  let meanX = 0;
  let meanY = 0;
  for (const { x, y } of points) {
    meanX += x;
    meanY += y;
  }
  if (n > 0) {
    meanX /= n;
    meanY /= n;
  }
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const { x, y } of points) {
    const dx = x - meanX;
    const dy = y - meanY;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  return { n, meanX, meanY, sxx, syy, sxy };
}

/** The fit, or null when x does not vary (or fewer than two points): then no line is defined. */
export function olsFit(m: OlsMoments): OlsFit | null {
  // Equal values leave only the rounding of their mean, about 1e-16 of it per
  // point; a spread below 1e-12 of the mean is that dust, not data.
  const flat = (spread: number, mean: number) => spread <= m.n * (1e-12 * mean) ** 2;
  if (m.n < 2 || flat(m.sxx, m.meanX)) return null;
  const slope = m.sxy / m.sxx;
  return {
    slope,
    intercept: m.meanY - slope * m.meanX,
    r2: flat(m.syy, m.meanY) ? null : Math.min(1, (m.sxy * m.sxy) / (m.sxx * m.syy)),
  };
}

/** The fitted segment clipped, in data space, to the axis domains; null when it misses them. */
export function clipTrendToDomain(fit: OlsFit & { x0: number; x1: number }, dx: [number, number], dy: [number, number]): [number, number] | null {
  let lo = Math.max(fit.x0, dx[0]);
  let hi = Math.min(fit.x1, dx[1]);
  if (fit.slope !== 0) {
    const a = (dy[0] - fit.intercept) / fit.slope;
    const b = (dy[1] - fit.intercept) / fit.slope;
    lo = Math.max(lo, Math.min(a, b));
    hi = Math.min(hi, Math.max(a, b));
  } else if (fit.intercept < dy[0] || fit.intercept > dy[1]) {
    return null;
  }
  return lo < hi ? [lo, hi] : null;
}
