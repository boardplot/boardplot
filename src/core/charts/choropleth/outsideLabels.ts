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
  const shapes = regions.map(region => {
    let pointCount = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const polygons = region.polygons.map(polygon => polygon.map(ring => ring.map(([x, y]) => {
      pointCount++;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      return { x, y };
    })));
    const rings = polygons.flat();
    const outlineDistance = prepareOutlineDistance(rings);
    const marker = region.marker ?? { x: region.anchor.x, y: region.anchor.y, radius: 2.5 };
    const x = pointCount ? minX : marker.x - marker.radius;
    const y = pointCount ? minY : marker.y - marker.radius;
    const bounds = { x, y,
      w: pointCount ? maxX - x : 2 * marker.radius,
      h: pointCount ? maxY - y : 2 * marker.radius };
    return { id: region.id, polygons, rings, outlineDistance, marker, bounds, maxY, queries: new Map<number, Query>() };
  });
  type Shape = (typeof shapes)[number];
  const shapesById = new Map<string, Shape>();
  for (const shape of shapes) if (!shapesById.has(shape.id)) shapesById.set(shape.id, shape);
  const contains = (shape: Shape, point: Point) => {
    // No edge can cross the ray outside this half-open Y range.
    if (point.y < shape.bounds.y || point.y >= shape.maxY) return false;
    return shape.polygons.some(polygon =>
      polygon.reduce((inside, ring) => inside !== inRing(point, ring), false));
  };
  const distance = (shape: Shape, rect: Rect, ownDistance?: number) => {
    if (!shape.polygons.length) return Math.max(0, rectLineDistance(rect, [shape.marker]) - shape.marker.radius);
    if (contains(shape, { x: rect.x, y: rect.y })) return 0;
    return shape.outlineDistance(rect, ownDistance);
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
    return cuts.slice(1).some((end, i) => {
      const t = (cuts[i]! + end) / 2;
      return end - cuts[i]! > 1e-8 && contains(shape, { x: from.x + t * dx, y: from.y + t * dy });
    });
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
    const ownDistance = distance(own, rect);
    const routeBox = from && to ? { x: Math.min(from[0], to[0]), y: Math.min(from[1], to[1]),
      w: Math.abs(to[0] - from[0]), h: Math.abs(to[1] - from[1]) } : undefined;
    const fits = shapes.every(shape => {
      if (shape.id === id) return true;
      if (boxGap(shape.bounds, rect) <= ownDistance + 0.02) {
        const otherDistance = distance(shape, rect, ownDistance);
        if (otherDistance <= 0.02 || ownDistance >= otherDistance - 0.02) return false;
      }
      return !routeBox || boxGap(shape.bounds, routeBox) > 0 ||
        !crossed(shape, { x: from![0], y: from![1] }, { x: to![0], y: to![1] });
    });
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
