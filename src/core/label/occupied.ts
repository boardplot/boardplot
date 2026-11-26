/**
 * The occupied-rect substrate. One accumulator per layout
 * run; every mark, axis element, frame block, legend, annotation, and label
 * registers into it. Returned verbatim as `debug.occupied`.
 */

import type { Point, Rect } from '../geometry';
import { prepareConvexPolygon, rectsOverlap } from '../geometry';
import type { OwnerRef } from '../types/cell';
import type { OccupiedRect } from '../types/scene';

/**
 * A claim as the index keeps it. `polygon` is the convex outline of a mark
 * whose bounding `rect` overstates it, a sloped area band: a query that
 * meets the rect is then tested against the outline with the same pad.
 */
export interface OccupiedClaim extends OccupiedRect {
  polygon?: readonly Point[];
}

export interface OccupiedIndex {
  claim(rect: Rect, kind: OccupiedRect['kind'], owner: OwnerRef, part?: string, polygon?: readonly Point[]): void;
  /** `skip` names claims the query ignores, such as a map's region fills under a backed label. */
  hits(rect: Rect, pad?: number, skip?: (claim: OccupiedClaim) => boolean): boolean;
  hitsWhich(rect: Rect, pad?: number, skip?: (claim: OccupiedClaim) => boolean): OccupiedClaim[];
  /**
   * `hitsWhich(rect, pad).some(test)` without the list: it stops at the first hit that passes.
   * `test` must not query this index again (a nested query restarts the visit stamps).
   */
  some?(rect: Rect, pad: number, test: (claim: OccupiedClaim) => boolean): boolean;
  /** Transfer claims in insertion order. The receiving index owns its copies. */
  copyTo?(target: OccupiedIndex, withPolygons?: boolean): void;
  snapshot(keep?: (claim: OccupiedClaim) => boolean): OccupiedClaim[];
  /**
   * Takes back a claim that `hitsWhich` returned, for a layout that seats a
   * label and then moves it: no query meets it and `snapshot` leaves it out.
   */
  release?(claim: OccupiedClaim): void;
  /**
   * The value axis's tick label columns. Only the label solver
   * reads them, for values (a bare number there reads as a tick); names,
   * annotations and leaders may still cross them.
   */
  tickColumns?: Rect[];
}

/**
 * The read half of an index. A layout phase that consults the claims made
 * before it, without adding any, gets this: the type has no claim
 * method, so the phase cannot move the geometry it reads.
 */
export type OccupiedView = Pick<OccupiedIndex, 'hits' | 'hitsWhich' | 'snapshot'>;

interface PolygonSource {
  points: readonly Point[];
  test?: ReturnType<typeof prepareConvexPolygon>;
}

const polygonSources = new WeakMap<readonly Point[], PolygonSource>();

/** A layout-owned outline, before claim() makes the independently editable copies for each index. */
export function sharePolygonProjection(points: readonly Point[]): readonly Point[] {
  polygonSources.set(points, { points: points.map(p => ({ ...p })) });
  return points;
}

function polygonTest(points: readonly Point[]): ReturnType<typeof prepareConvexPolygon> {
  const source = polygonSources.get(points);
  // A snapshot exposes its index's polygon. A copy edited before its first query needs its own projection.
  if (source && source.points.length === points.length
    && points.every((p, i) => p.x === source.points[i]!.x && p.y === source.points[i]!.y)) {
    return source.test ??= prepareConvexPolygon(source.points);
  }
  return prepareConvexPolygon(points);
}

/**
 * The grid cells a rect grown by `pad` meets, as the range [x0, x1] x [y0, y1],
 * or undefined for a rect off the grid, inverted, or over 256 cells: those scan
 * every claim. Any point two overlapping rects share lies in a cell of both.
 * A cell's key is x * 65536 + y.
 */
function cellRange(rect: Rect, pad: number, cellSize: number, range: [number, number, number, number]): [number, number, number, number] | undefined {
  const x0 = Math.floor((rect.x - pad) / cellSize), x1 = Math.floor((rect.x + rect.w + pad) / cellSize);
  const y0 = Math.floor((rect.y - pad) / cellSize), y1 = Math.floor((rect.y + rect.h + pad) / cellSize);
  // NaN fails every comparison, so it scans every claim too.
  if (!(x0 <= x1 && y0 <= y1 && (x1 - x0 + 1) * (y1 - y0 + 1) <= 256 && Math.max(-x0, x1, -y0, y1) < 1 << 15)) return undefined;
  range[0] = x0; range[1] = x1; range[2] = y0; range[3] = y1;
  return range;
}

export function createOccupiedIndex(_plot: Rect, mode?: 'short-label-pass' | 'scatter-label-pass'): OccupiedIndex {
  // Scatter names and their leaders often span several cells of the ordinary chart index.
  const cellSize = mode === 'scatter-label-pass' ? 32 : 16;
  const rects: OccupiedClaim[] = [];
  const scratchRange: [number, number, number, number] = [0, 0, 0, 0];
  const released = new Set<number>();
  // Claims by grid cell, so a query tests the claims near it, not every
  // claim (a map claims its region fills as a thousand strips). Claims off
  // the grid are tested on every query.
  const cells = new Map<number, number[]>();
  const wide: number[] = [];
  const polygonTests: ReturnType<typeof prepareConvexPolygon>[] = [];
  let indexed = 0;
  // A layout can return its claims for debugging without ever searching their grid cells.
  const indexPendingClaims = () => {
    while (indexed < rects.length) {
      const index = indexed++;
      const range = cellRange(rects[index]!.rect, 0, cellSize, scratchRange);
      if (range === undefined) wide.push(index);
      else {
        const [x0, x1, y0, y1] = range;
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
          const key = x * 65536 + y;
          const cell = cells.get(key);
          if (cell === undefined) cells.set(key, [index]);
          else cell.push(index);
        }
      }
    }
  };
  const hit = (index: number, rect: Rect, pad: number): boolean => {
    const claim = rects[index]!;
    return rectsOverlap(claim.rect, rect, pad) && (claim.polygon === undefined
      || (polygonTests[index] ??= polygonTest(claim.polygon))(rect, pad));
  };
  // A claim spans several cells; `seen` stamps it once per query.
  const seen: number[] = [];
  let stamp = 0;
  /**
   * Visits each claim a query can meet once, until `visit` returns true: the wide claims, then
   * the cells column by column. Plain loops: a map measure runs millions of these queries.
   */
  let visiting = false;
  const visitNear = (rect: Rect, pad: number, visit: (i: number) => boolean): boolean => {
    // A query inside a query's callback would restamp `seen` and skip claims of the outer one.
    if (visiting) throw new Error('occupied index: a query ran inside another query\'s callback');
    visiting = true;
    try { return query(rect, pad, visit); } finally { visiting = false; }
  };
  const visitClaims = (rect: Rect, pad: number, visit: (i: number) => boolean): boolean => {
    const range = cellRange(rect, pad, cellSize, scratchRange);
    if (range === undefined) {
      for (let i = 0; i < rects.length; i++) if (visit(i)) return true;
      return false;
    }
    // Read the scratch range before a callback can add a claim to the same index.
    const [x0, x1, y0, y1] = range;
    if (indexed < rects.length) indexPendingClaims();
    stamp++;
    for (let w = 0; w < wide.length; w++) if (visit(wide[w]!)) return true;
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const cell = cells.get(x * 65536 + y);
        if (cell === undefined) continue;
        for (let c = 0; c < cell.length; c++) {
          const i = cell[c]!;
          if (seen[i] === stamp) continue;
          seen[i] = stamp;
          if (visit(i)) return true;
        }
      }
    }
    return false;
  };
  // A short label pass can finish before building a grid repays its cost.
  // Longer searches switch back to the usual grid for the rest of the pass.
  let scans = 0;
  const query: typeof visitClaims = mode === 'short-label-pass' ? (rect, pad, visit) => {
    if (rects.length <= 64 && scans < 32 && indexed === 0) {
      scans++;
      for (let i = 0; i < rects.length; i++) if (visit(i)) return true;
      return false;
    }
    return visitClaims(rect, pad, visit);
  } : visitClaims;
  return {
    claim(rect, kind, owner, part, polygon) {
      const claimed: OccupiedClaim = part === undefined ? { rect: { ...rect }, kind, owner } : { rect: { ...rect }, kind, owner, part };
      if (polygon !== undefined) {
        claimed.polygon = polygon.map((point) => ({ ...point }));
        const source = polygonSources.get(polygon);
        if (source) polygonSources.set(claimed.polygon, source);
      }
      rects.push(claimed);
      if (visiting) indexPendingClaims();
    },
    hits(rect, pad = 0, skip) {
      return visitNear(rect, pad, (i) => !skip?.(rects[i]!) && hit(i, rect, pad));
    },
    some(rect, pad, test) {
      return visitNear(rect, pad, (i) => hit(i, rect, pad) && test(rects[i]!));
    },
    hitsWhich(rect, pad = 0, skip) {
      // In claim order, as a scan of every claim returns them.
      const found: number[] = [];
      visitNear(rect, pad, (i) => { if (!skip?.(rects[i]!) && hit(i, rect, pad)) found.push(i); return false; });
      return found.sort((a, b) => a - b).map((i) => rects[i]!);
    },
    copyTo(target, withPolygons = true) {
      const count = rects.length;
      for (let i = 0; i < count; i++) {
        if (released.size && released.has(i)) continue;
        const c = rects[i]!;
        target.claim(c.rect, c.kind, c.owner, c.part, withPolygons ? c.polygon : undefined);
      }
    },
    snapshot(keep) {
      const copy = (entry: OccupiedClaim): OccupiedClaim => ({ ...entry, rect: { ...entry.rect } });
      // Most layouts release nothing: copy in one pass, as before release existed.
      if (!keep && released.size === 0) return rects.map(copy);
      const kept: OccupiedClaim[] = [];
      rects.forEach((entry, index) => { if (!released.has(index) && (!keep || keep(entry))) kept.push(copy(entry)); });
      return kept;
    },
    release(claim) {
      const index = rects.indexOf(claim);
      if (index < 0) return;
      released.add(index);
      // The claim stays in its cells, but its rect now lies where no query reaches.
      claim.rect = { x: -1e9, y: -1e9, w: 0, h: 0 };
      claim.polygon = undefined;
    },
  };
}
