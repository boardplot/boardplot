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
  snapshot(): OccupiedClaim[];
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

const CELL = 16;

/**
 * The grid cells a rect grown by `pad` meets, as the range [x0, x1] x [y0, y1],
 * or undefined for a rect off the grid, inverted, or over 256 cells: those scan
 * every claim. Any point two overlapping rects share lies in a cell of both.
 * A cell's key is x * 65536 + y.
 */
function cellRange(rect: Rect, pad: number): [number, number, number, number] | undefined {
  const x0 = Math.floor((rect.x - pad) / CELL), x1 = Math.floor((rect.x + rect.w + pad) / CELL);
  const y0 = Math.floor((rect.y - pad) / CELL), y1 = Math.floor((rect.y + rect.h + pad) / CELL);
  // NaN fails every comparison, so it scans every claim too.
  if (!(x0 <= x1 && y0 <= y1 && (x1 - x0 + 1) * (y1 - y0 + 1) <= 256 && Math.max(-x0, x1, -y0, y1) < 1 << 15)) return undefined;
  return [x0, x1, y0, y1];
}

export function createOccupiedIndex(_plot: Rect): OccupiedIndex {
  const rects: OccupiedClaim[] = [];
  // Claims by grid cell, so a query tests the claims near it, not every
  // claim (a map claims its region fills as a thousand strips). Claims off
  // the grid are tested on every query.
  const cells = new Map<number, number[]>();
  const wide: number[] = [];
  const polygonTests: ReturnType<typeof prepareConvexPolygon>[] = [];
  const hit = (index: number, rect: Rect, pad: number): boolean => {
    const claim = rects[index]!;
    return rectsOverlap(claim.rect, rect, pad) && (claim.polygon === undefined
      || (polygonTests[index] ??= prepareConvexPolygon(claim.polygon))(rect, pad));
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
    try { return visitClaims(rect, pad, visit); } finally { visiting = false; }
  };
  const visitClaims = (rect: Rect, pad: number, visit: (i: number) => boolean): boolean => {
    const range = cellRange(rect, pad);
    if (range === undefined) {
      for (let i = 0; i < rects.length; i++) if (visit(i)) return true;
      return false;
    }
    stamp++;
    for (let w = 0; w < wide.length; w++) if (visit(wide[w]!)) return true;
    const [x0, x1, y0, y1] = range;
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
  return {
    claim(rect, kind, owner, part, polygon) {
      const claimed: OccupiedClaim = part === undefined ? { rect: { ...rect }, kind, owner } : { rect: { ...rect }, kind, owner, part };
      if (polygon !== undefined) claimed.polygon = polygon.map((point) => ({ ...point }));
      const index = rects.push(claimed) - 1;
      const range = cellRange(rect, 0);
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
    snapshot() {
      return rects.map((entry) => ({ ...entry, rect: { ...entry.rect } }));
    },
  };
}
