import { boxGap, rectLineDistance, type Point, type Rect } from '../../geometry';
import { prepareOutlineDistance } from '../../polyline';
import type { FittedGeoRegion, GeoPoint } from '../../geo/types';

/** Test against the drawn outlines, not the map's 4 px occupancy strips. */
export function outsideLabelGuard(regions: readonly FittedGeoRegion[]) {
  interface Query {
    x: number; y: number; w: number; h: number;
    fromX?: number; fromY?: number; toX?: number; toY?: number;
    fits: boolean;
  }
  let boundsScale = 1;
  const shapes = regions.map(region => {
    let pointCount = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const polygons: Point[][][] = [], rings: Point[][] = [], samples: Point[] = [];
    for (const polygon of region.polygons) {
      const fitted: Point[][] = [];
      for (const ring of polygon) {
        const points: Point[] = [];
        for (const [x, y] of ring) {
          const point = { x, y };
          if (pointCount === 0) samples.push(point, point, point, point);
          if (x < minX) samples[0] = point;
          if (x > maxX) samples[1] = point;
          if (y < minY) samples[2] = point;
          if (y > maxY) samples[3] = point;
          pointCount++;
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
          points.push(point);
        }
        fitted.push(points);
        rings.push(points);
      }
      polygons.push(fitted);
    }
    let outlineDistance: ReturnType<typeof prepareOutlineDistance> | undefined;
    const marker = region.marker ?? { x: region.anchor.x, y: region.anchor.y, radius: 2.5 };
    const x = pointCount ? minX : marker.x - marker.radius;
    const y = pointCount ? minY : marker.y - marker.radius;
    const bounds = { x, y,
      w: pointCount ? maxX - x : 2 * marker.radius,
      h: pointCount ? maxY - y : 2 * marker.radius };
    const right = x + bounds.w, bottom = y + bounds.h;
    boundsScale = Math.max(boundsScale, Math.abs(x), Math.abs(y), Math.abs(right), Math.abs(bottom), Math.abs(bounds.w), Math.abs(bounds.h));
    return { id: region.id, polygons, rings, samples,
      get outlineDistance() { return outlineDistance ??= prepareOutlineDistance(rings); },
      marker, bounds, right, bottom, maxY, queries: new Map<number, Query>() };
  });
  type Shape = (typeof shapes)[number];
  const shapesById = new Map<string, Shape>();
  for (const shape of shapes) if (!shapesById.has(shape.id)) shapesById.set(shape.id, shape);
  const contains = (shape: Shape, point: Point) => {
    // No edge can cross the ray outside this half-open Y range.
    if (point.y < shape.bounds.y || point.y >= shape.maxY) return false;
    for (const polygon of shape.polygons) {
      let inside = false;
      for (const ring of polygon) inside = inside !== inRing(point, ring);
      if (inside) return true;
    }
    return false;
  };
  const distance = (shape: Shape, rect: Rect, ownDistance?: number) => {
    if (!shape.polygons.length) return Math.max(0, rectLineDistance(rect, [shape.marker]) - shape.marker.radius);
    if (contains(shape, { x: rect.x, y: rect.y })) return 0;
    return shape.outlineDistance(rect, ownDistance);
  };
  // Every sample is an actual outline vertex, so its point-to-box distance is an upper bound
  // for the full outline distance. The exact distance is needed only when a rival is that near.
  const upperDistance = (shape: Shape, rect: Rect) => {
    if (!shape.polygons.length) return distance(shape, rect);
    let best = Infinity, gapX = Infinity, gapY = Infinity;
    for (const point of shape.samples) {
      const dx = Math.max(rect.x - point.x, 0, point.x - rect.x - rect.w);
      const dy = Math.max(rect.y - point.y, 0, point.y - rect.y - rect.h);
      const squared = dx * dx + dy * dy;
      if (squared < best) { best = squared; gapX = dx; gapY = dy; }
    }
    return Math.hypot(gapX, gapY);
  };
  const crossed = (shape: Shape, from: Point, to: Point) => {
    if (!shape.polygons.length) return rectLineDistance({ x: shape.marker.x, y: shape.marker.y, w: 0, h: 0 }, [from, to]) < shape.marker.radius;
    const dx = to.x - from.x, dy = to.y - from.y;
    const cuts = [0, 1];
    for (const ring of shape.rings) for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1]!, b = ring[i]!;
      const ex = b.x - a.x, ey = b.y - a.y;
      const cross = dx * ey - dy * ex;
      if (cross === 0) continue;
      const t = ((a.x - from.x) * ey - (a.y - from.y) * ex) / cross;
      const u = ((a.x - from.x) * dy - (a.y - from.y) * dx) / cross;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
    }
    cuts.sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i++) {
      const end = cuts[i]!, start = cuts[i - 1]!;
      const t = (start + end) / 2;
      if (end - start > 1e-8 && contains(shape, { x: from.x + t * dx, y: from.y + t * dy })) return true;
    }
    return false;
  };
  // Keep exact coordinates, including signed zero, without formatting a string for every seat.
  // The numeric key only selects a cache entry; compare every coordinate before reusing it.
  // A collision replaces an entry and can only cost a cache hit.
  return (id: string, rect: Rect, from?: GeoPoint, to?: GeoPoint): boolean => {
    const own = shapesById.get(id)!;
    const fromX = from && to ? from[0] : undefined, fromY = from && to ? from[1] : undefined;
    const toX = from && to ? to[0] : undefined, toY = from && to ? to[1] : undefined;
    const key = rect.x + 8192 * rect.y;
    const cached = own.queries.get(key);
    if (cached && Object.is(cached.x, rect.x) && Object.is(cached.y, rect.y) && Object.is(cached.w, rect.w) && Object.is(cached.h, rect.h)
      && Object.is(cached.fromX, fromX) && Object.is(cached.fromY, fromY) && Object.is(cached.toX, toX) && Object.is(cached.toY, toY)) return cached.fits;
    let ownDistance: number | undefined;
    let limit = upperDistance(own, rect) + 0.02;
    const right = rect.x + rect.w, bottom = rect.y + rect.h;
    const routeBox = from && to ? { x: Math.min(from[0], to[0]), y: Math.min(from[1], to[1]),
      w: Math.abs(to[0] - from[0]), h: Math.abs(to[1] - from[1]) } : undefined;
    const start = from && to ? { x: from[0], y: from[1] } : undefined;
    const end = from && to ? { x: to[0], y: to[1] } : undefined;
    const routeRight = routeBox ? routeBox.x + routeBox.w : -Infinity;
    const routeBottom = routeBox ? routeBox.y + routeBox.h : -Infinity;
    const nearX = Math.min(rect.x - limit, routeBox?.x ?? Infinity);
    const nearY = Math.min(rect.y - limit, routeBox?.y ?? Infinity);
    const farX = Math.max(right + limit, routeRight), farY = Math.max(bottom + limit, routeBottom);
    const scale = Math.max(boundsScale, Math.abs(rect.x), Math.abs(rect.y), Math.abs(right), Math.abs(bottom),
      Math.abs(rect.w), Math.abs(rect.h), Math.abs(nearX), Math.abs(nearY), Math.abs(farX), Math.abs(farY));
    const safe = scale <= 2 ** 40 && rect.w >= 0 && rect.h >= 0;
    const error = 64 * Number.EPSILON * scale;
    let fits = true;
    for (const shape of shapes) {
      if (shape.id === id) continue;
      const bounded = safe && shape.bounds.w >= 0 && shape.bounds.h >= 0;
      // A rival must reach the expanded label or its route. Keep touching and rounding cases.
      if (bounded && (shape.right < nearX - error || shape.bounds.x > farX + error
        || shape.bottom < nearY - error || shape.bounds.y > farY + error)) continue;
      const gapX = Math.max(0, rect.x - shape.right, shape.bounds.x - right);
      const gapY = Math.max(0, rect.y - shape.bottom, shape.bounds.y - bottom);
      if (gapX <= limit && gapY <= limit) {
        const gap = Math.hypot(gapX, gapY);
        if (gap <= limit) {
          ownDistance ??= distance(own, rect);
          limit = ownDistance + 0.02;
          if (gap <= limit) {
            const otherDistance = distance(shape, rect, ownDistance);
            if (otherDistance <= 0.02 || ownDistance >= otherDistance - 0.02) { fits = false; break; }
          }
        }
      }
      if (routeBox) {
        const apart = bounded
          ? shape.right < routeBox.x || routeRight < shape.bounds.x || shape.bottom < routeBox.y || routeBottom < shape.bounds.y
          : boxGap(shape.bounds, routeBox) > 0;
        if (!apart && crossed(shape, start!, end!)) { fits = false; break; }
      }
    }
    own.queries.set(key, { x: rect.x, y: rect.y, w: rect.w, h: rect.h, fromX, fromY, toX, toY, fits });
    return fits;
  };
}


function inRing(point: Point, ring: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < a.x + (point.y - a.y) * (b.x - a.x) / (b.y - a.y)) inside = !inside;
  }
  return inside;
}
