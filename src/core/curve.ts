/**
 * Monotone cubic interpolation (the Steffen method) — the single smoothing
 * authority for every chart surface (line/combo `smooth`, diagram roadmap
 * trajectory). One implementation so two packages cannot drift apart on
 * slope limiting or number formatting (one rounding path).
 *
 * Guarantees, enforced by tests/curve.test.ts:
 * - the interpolant passes through every input point;
 * - within each interval the curve stays inside the y-range of that
 * interval's endpoints (no overshoot, local extrema only at data points);
 * - monotone input runs produce monotone output;
 * - byte-identical output for identical input (no environment dependence).
 */

import type { Point } from './geometry';


/** One cubic-bezier piece of the interpolant, ready for path emission. */
export interface CurveSegment {
  from: Point;
  c1: Point;
  c2: Point;
  to: Point;
}

/**
 * De Casteljau splitting for phase-painted curves. The line and combo layouts
 * share these helpers: the AC→FC paint split partitions one continuous curve
 * for phase fills.
 */
function pointBetween(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function splitCurve(segment: CurveSegment, t: number): [CurveSegment, CurveSegment] {
  const a = pointBetween(segment.from, segment.c1, t);
  const b = pointBetween(segment.c1, segment.c2, t);
  const c = pointBetween(segment.c2, segment.to, t);
  const d = pointBetween(a, b, t);
  const e = pointBetween(b, c, t);
  const middle = pointBetween(d, e, t);
  return [
    { from: segment.from, c1: a, c2: d, to: middle },
    { from: middle, c1: e, c2: c, to: segment.to },
  ];
}

export function splitCurveSegmentsAtX(
  segments: readonly CurveSegment[],
  x: number,
): [CurveSegment[], CurveSegment[]] {
  const before: CurveSegment[] = [];
  const after: CurveSegment[] = [];
  for (const segment of segments) {
    if (segment.to.x <= x) {
      before.push(segment);
    } else if (segment.from.x >= x) {
      after.push(segment);
    } else {
      const t = (x - segment.from.x) / (segment.to.x - segment.from.x);
      const [left, right] = splitCurve(segment, t);
      before.push(left);
      after.push(right);
    }
  }
  return [before, after];
}

function assertStrictlyIncreasingX(points: readonly Point[]): void {
  for (let i = 1; i < points.length; i++) {
    if (!(points[i]!.x > points[i - 1]!.x)) {
      throw new Error(
        `monotone curve requires strictly increasing x: x[${i - 1}]=${points[i - 1]!.x} !< x[${i}]=${points[i]!.x}`,
      );
    }
  }
}

/**
 * Per-point derivatives after Steffen's limiter. Interior slopes are the
 * weighted parabola slope clamped to twice the smaller adjacent secant and
 * zeroed at sign changes; endpoint slopes are the one-sided parabola slope
 * clamped to [0, 2·secant] on the secant's side of zero.
 */
function steffenSlopes(points: readonly Point[]): number[] {
  const n = points.length;
  if (n === 0) return [];
  if (n === 1) return [0];
  assertStrictlyIncreasingX(points);

  const h: number[] = [];
  const s: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(points[i + 1]!.x - points[i]!.x);
    s.push((points[i + 1]!.y - points[i]!.y) / h[i]!);
  }

  const m: number[] = new Array(n);
  for (let i = 1; i < n - 1; i++) {
    const p = (s[i - 1]! * h[i]! + s[i]! * h[i - 1]!) / (h[i - 1]! + h[i]!);
    if (s[i - 1]! * s[i]! <= 0) {
      m[i] = 0;
    } else {
      const cap = 2 * Math.min(Math.abs(s[i - 1]!), Math.abs(s[i]!));
      m[i] = (Math.sign(s[i - 1]!) || Math.sign(s[i]!)) * Math.min(Math.abs(p), cap);
    }
  }

  const endpoint = (sNear: number, sFar: number, hNear: number, hFar: number): number => {
    const p = sNear * (1 + hNear / (hNear + hFar)) - sFar * (hNear / (hNear + hFar));
    if (p * sNear <= 0) return 0;
    if (Math.abs(p) > 2 * Math.abs(sNear)) return 2 * sNear;
    return p;
  };

  if (n === 2) {
    m[0] = s[0]!;
    m[1] = s[0]!;
  } else {
    m[0] = endpoint(s[0]!, s[1]!, h[0]!, h[1]!);
    m[n - 1] = endpoint(s[n - 2]!, s[n - 3]!, h[n - 2]!, h[n - 3]!);
  }
  return m;
}

/**
 * The interpolant as cubic-bezier segments (Hermite → Bézier conversion).
 * With Steffen-limited slopes every control point stays inside its
 * interval's bounding box, so the curve inherits the no-overshoot bound
 * from the Bézier hull property.
 */
export function monotoneSegments(points: readonly Point[]): CurveSegment[] {
  if (points.length < 2) return [];
  const m = steffenSlopes(points);
  const out: CurveSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const h = b.x - a.x;
    out.push({
      from: a,
      c1: { x: a.x + h / 3, y: a.y + (m[i]! * h) / 3 },
      c2: { x: b.x - h / 3, y: b.y - (m[i + 1]! * h) / 3 },
      to: b,
    });
  }
  return out;
}

/**
 * SVG path for one non-null run. A single point yields a bare moveto so
 * callers can still anchor markers; two-plus points always emit cubics,
 * degenerate-linear included, for byte stability across data changes.
 */
export function monotonePath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  const head = `M${fmtPathNumber(points[0]!.x)} ${fmtPathNumber(points[0]!.y)}`;
  if (points.length === 1) return head;
  return (
    head +
    monotoneSegments(points)
      .map(
        (seg) =>
          `C${fmtPathNumber(seg.c1.x)} ${fmtPathNumber(seg.c1.y)} ${fmtPathNumber(seg.c2.x)} ${fmtPathNumber(seg.c2.y)} ${fmtPathNumber(seg.to.x)} ${fmtPathNumber(seg.to.y)}`,
      )
      .join('')
  );
}

/**
 * Evaluate the interpolant at `x` (Hermite basis). Outside the covered
 * span the curve clamps to the end values — callers asking for a phase
 * boundary at the exact first/last category get the data value, never an
 * extrapolation.
 */
export function monotoneYAt(points: readonly Point[], x: number): number {
  const n = points.length;
  if (n === 0) throw new Error('monotoneYAt on an empty run');
  if (n === 1 || x <= points[0]!.x) return points[0]!.y;
  if (x >= points[n - 1]!.x) return points[n - 1]!.y;
  const m = steffenSlopes(points);
  let i = 0;
  while (i < n - 2 && points[i + 1]!.x < x) i++;
  const a = points[i]!;
  const b = points[i + 1]!;
  const h = b.x - a.x;
  const t = (x - a.x) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    a.y * (2 * t3 - 3 * t2 + 1) +
    m[i]! * h * (t3 - 2 * t2 + t) +
    b.y * (-2 * t3 + 3 * t2) +
    m[i + 1]! * h * (t3 - t2)
  );
}

/** Path-data number: integers bare, everything else to two decimals. */
export const fmtPathNumber = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(2));

/** SVG path data for a run of cubic segments. */
export function curvePathFromSegments(segments: readonly CurveSegment[]): string {
  const first = segments[0];
  if (!first) return '';
  return (
    `M${fmtPathNumber(first.from.x)} ${fmtPathNumber(first.from.y)}` +
    segments
      .map(
        (segment) =>
          `C${fmtPathNumber(segment.c1.x)} ${fmtPathNumber(segment.c1.y)} ${fmtPathNumber(segment.c2.x)} ${fmtPathNumber(segment.c2.y)} ${fmtPathNumber(segment.to.x)} ${fmtPathNumber(segment.to.y)}`,
      )
      .join('')
  );
}

/** Point on a cubic at parameter t. */
export function cubicPoint(segment: { from: Point; c1: Point; c2: Point; to: Point }, t: number): Point {
  const u = 1 - t;
  return {
    x:
      u * u * u * segment.from.x +
      3 * u * u * t * segment.c1.x +
      3 * u * t * t * segment.c2.x +
      t * t * t * segment.to.x,
    y:
      u * u * u * segment.from.y +
      3 * u * u * t * segment.c1.y +
      3 * u * t * t * segment.c2.y +
      t * t * t * segment.to.y,
  };
}

/** Chords per cubic when a monotone run is flattened for a stroke test. */
const STROKE_SAMPLES = 16;

/**
 * One drawn run of a line as a polyline, for a stroke test: the
 * points joined straight, through the elbow a step interpolation draws, or
 * along the Steffen curve `monotonePath` draws, flattened to 16 chords per
 * interval. A chord of a cubic this short strays well under a pixel from it
 * at chart sizes, which the test's pad covers.
 */
export function drawnStroke(points: readonly Point[], interpolation: string): Point[] {
  if (interpolation === 'monotone' && points.length > 1) {
    return [points[0]!, ...monotoneSegments(points).flatMap((segment) =>
      Array.from({ length: STROKE_SAMPLES }, (_, k) => cubicPoint(segment, (k + 1) / STROKE_SAMPLES)))];
  }
  if (interpolation !== 'step-after' && interpolation !== 'step-before') return [...points];
  return points.flatMap((point, i) => {
    if (i === 0) return [point];
    const previous = points[i - 1]!;
    const elbow = interpolation === 'step-after' ? { x: point.x, y: previous.y } : { x: previous.x, y: point.y };
    return [elbow, point];
  });
}
