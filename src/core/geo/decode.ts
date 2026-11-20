import type { Rect } from '../geometry';
import { requestMemo } from '../layoutPlan';
import type {
  DecodedGeoPack,
  DecodedGeoRegion,
  FittedGeoPack,
  GeoArc,
  GeoLineRefs,
  GeoMultiPolygonRefs,
  GeoPackedArcs,
  GeoPack,
  GeoPoint,
} from './types';

const packedArcCache = new WeakMap<GeoPack, readonly GeoArc[]>();

function decodeArc(arc: GeoArc, pack: GeoPack): GeoPoint[] {
  let x = 0;
  let y = 0;
  const out: GeoPoint[] = [];
  for (const delta of arc) {
    x += delta[0];
    y += delta[1];
    out.push([
      x * pack.transform.scale[0] + pack.transform.translate[0],
      y * pack.transform.scale[1] + pack.transform.translate[1],
    ]);
  }
  return out;
}

function arcAt(pack: GeoPack, index: number): GeoArc | undefined {
  let decoded = packedArcCache.get(pack);
  if (!decoded) {
    decoded = decodePackedArcs(pack.arcs);
    packedArcCache.set(pack, decoded);
  }
  return decoded[index];
}

function decodePackedArcs(packed: GeoPackedArcs): readonly GeoArc[] {
  if (packed.encoding !== 'delta-zigzag-varint-base64') {
    throw new Error(`unsupported geo arc encoding '${String(packed.encoding)}'`);
  }
  const binary = atob(packed.data);
  let offset = 0;
  const readVarint = (): number => {
    let value = 0;
    let shift = 0;
    while (offset < binary.length) {
      const byte = binary.charCodeAt(offset++);
      value += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7;
      if (shift > 49) throw new Error('geo packed arc varint exceeds the safe integer range');
    }
    throw new Error('geo packed arc payload ended inside a varint');
  };
  const signed = (value: number) => value % 2 === 0 ? value / 2 : -(value + 1) / 2;
  const arcs = packed.lengths.map((length) =>
    Array.from({ length }, () => [signed(readVarint()), signed(readVarint())] as const)
  );
  if (offset !== binary.length) throw new Error('geo packed arc payload has trailing bytes');
  return arcs;
}

function arcByRef(pack: GeoPack, cache: Map<number, GeoPoint[]>, ref: number): GeoPoint[] {
  const index = ref < 0 ? ~ref : ref;
  let decoded = cache.get(index);
  if (!decoded) {
    const arc = arcAt(pack, index);
    if (!arc) throw new Error(`geo pack '${pack.id}' references missing arc ${index}`);
    decoded = decodeArc(arc, pack);
    cache.set(index, decoded);
  }
  return ref < 0 ? decoded.slice().reverse() : decoded;
}

function decodeLine(pack: GeoPack, cache: Map<number, GeoPoint[]>, refs: GeoLineRefs): GeoPoint[] {
  const line: GeoPoint[] = [];
  for (const ref of refs) {
    const arc = arcByRef(pack, cache, ref);
    for (let i = line.length === 0 ? 0 : 1; i < arc.length; i++) line.push(arc[i]!);
  }
  return line;
}

function decodeRing(pack: GeoPack, cache: Map<number, GeoPoint[]>, refs: readonly number[]): GeoPoint[] {
  const ring = decodeLine(pack, cache, refs);
  if (ring.length > 0) {
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
  }
  return ring;
}

function decodePolygons(
  pack: GeoPack,
  cache: Map<number, GeoPoint[]>,
  refs: GeoMultiPolygonRefs,
): GeoPoint[][][] {
  return refs.map((polygon) => polygon.map((ring) => decodeRing(pack, cache, ring)));
}

// A pack decodes the same every time; a map lays out many frames of it.
const decodedPackCache = new WeakMap<GeoPack, DecodedGeoPack>();

/** Read-only: callers share one decoded pack. */
export function decodeGeoPack(pack: GeoPack): DecodedGeoPack {
  const known = decodedPackCache.get(pack);
  if (known) return known;
  const cache = new Map<number, GeoPoint[]>();
  const regions: DecodedGeoRegion[] = pack.regions.map((region) => ({
    id: region.id,
    aliases: region.aliases,
    polygons: decodePolygons(pack, cache, region.polygons),
    anchor: region.anchor,
    geometryClass: region.geometryClass ?? 'administrative',
    microState: region.microState ?? false,
    ...(region.marker ? { marker: region.marker } : {}),
  }));
  const boundaries = (pack.boundaries ?? []).map((boundary) => ({
    id: boundary.id,
    geometryClass: boundary.geometryClass,
    lines: boundary.lines.map((line) => decodeLine(pack, cache, line)),
  }));
  const decoded = { pack, regions, boundaries };
  decodedPackCache.set(pack, decoded);
  return decoded;
}

type Bounds = [number, number, number, number];
interface PolygonExtrema {
  bounds: Bounds;
  samples: GeoPoint[];
}
const extrema = new WeakMap<GeoPoint[][][], PolygonExtrema>();

/** Bounds and four actual outline vertices, at the left, right, top and bottom. */
export function geoPolygonExtrema(polygons: GeoPoint[][][]): PolygonExtrema {
  const cached = extrema.get(polygons);
  if (cached) return cached;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const samples: GeoPoint[] = [];
  for (const polygon of polygons) for (const ring of polygon) for (const point of ring) {
    const [x, y] = point;
    if (!samples.length) samples.push(point, point, point, point);
    if (x < minX) samples[0] = point;
    if (x > maxX) samples[1] = point;
    if (y < minY) samples[2] = point;
    if (y > maxY) samples[3] = point;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  const result: PolygonExtrema = { bounds: [minX, minY, maxX, maxY], samples };
  extrema.set(polygons, result);
  return result;
}

interface ProjectedOutlines {
  scale: number;
  offsetX: number;
  offsetY: number;
  regions: GeoPoint[][][][];
  boundaries: GeoPoint[][][];
}
interface OutlineCache {
  frames: ProjectedOutlines[];
  keys: Map<string, object[]>;
  capacity: number;
}

// Within a layout, paths and fill strips can outlive evicted arrays of projected vertices.
const projectedKeys = new WeakMap<GeoPoint[][][], object>();
export function projectedRegionKey(polygons: GeoPoint[][][]): object {
  return projectedKeys.get(polygons) ?? polygons;
}

/** Label probes revisit earlier frames. Keep a bounded set of points and keys for this layout only. */
function outlineCache(decoded: DecodedGeoPack): OutlineCache {
  return requestMemo(decoded, 'geo:outlines', () => {
    let points = 0;
    for (const region of decoded.regions) {
      for (const polygon of region.polygons) for (const ring of polygon) points += ring.length;
    }
    for (const boundary of decoded.boundaries) for (const line of boundary.lines) points += line.length;
    return { frames: [], keys: new Map(), capacity: Math.max(1, Math.min(12, Math.floor(300_000 / Math.max(1, points)))) };
  });
}

/** The number of projected frames held for this pack. */
export const cachedFittedOutlineFrames = (pack: GeoPack): number => outlineCache(decodeGeoPack(pack)).frames.length;

function projectOutlines(decoded: DecodedGeoPack, scale: number, offsetX: number, offsetY: number): ProjectedOutlines {
  const cache = outlineCache(decoded);
  const frames = cache.frames;
  for (let i = 0; i < frames.length; i++) {
    const fit = frames[i]!;
    if (fit.scale === scale && fit.offsetX === offsetX && fit.offsetY === offsetY) {
      if (i) { frames.splice(i, 1); frames.unshift(fit); }
      return fit;
    }
  }
  const fitPoint = (point: GeoPoint): GeoPoint => [
    point[0] * scale + offsetX,
    point[1] * scale + offsetY,
  ];
  const transform = [scale, offsetX, offsetY].map(n => Object.is(n, -0) ? '-0' : String(n)).join(',');
  let keys = cache.keys.get(transform);
  if (!keys) {
    keys = decoded.regions.map(() => ({}));
    if (cache.keys.size >= 4 * cache.capacity) cache.keys.delete(cache.keys.keys().next().value!);
    cache.keys.set(transform, keys);
  }
  const regions = decoded.regions.map((region, index) => {
    const projected = region.polygons.map(polygon => polygon.map(ring => ring.map(fitPoint)));
    projectedKeys.set(projected, keys[index]!);
    if (scale > 0 && Number.isFinite(scale) && Number.isFinite(offsetX) && Number.isFinite(offsetY)) {
      // A positive affine fit preserves the order of coordinates. Use the same multiply and add
      // as fitPoint so the bounds match a scan of the screen coordinates, including rounding.
      const source = geoPolygonExtrema(region.polygons);
      if (source.samples.length) {
        const [minX, minY, maxX, maxY] = source.bounds;
        extrema.set(projected, { bounds: [minX * scale + offsetX, minY * scale + offsetY,
          maxX * scale + offsetX, maxY * scale + offsetY], samples: source.samples.map(fitPoint) });
      } else {
        extrema.set(projected, source);
      }
    }
    return projected;
  });
  const boundaries = decoded.boundaries.map(boundary => boundary.lines.map(line => line.map(fitPoint)));
  const fit = { scale, offsetX, offsetY, regions, boundaries };
  if (frames.length === cache.capacity) frames.pop();
  frames.unshift(fit);
  return fit;
}

/** Point arrays are read-only. Read live region anchors, marker sizes and pack bounds on every fit. */
export function fitGeoPack(pack: GeoPack, frame: Rect): FittedGeoPack {
  const decoded = decodeGeoPack(pack);
  const [minX, minY, maxX, maxY] = decoded.pack.bounds;
  const sx = frame.w / (maxX - minX);
  const sy = frame.h / (maxY - minY);
  const scale = sx < sy ? sx : sy;
  const offsetX = frame.x + (frame.w - (maxX - minX) * scale) / 2 - minX * scale;
  const offsetY = frame.y + (frame.h - (maxY - minY) * scale) / 2 - minY * scale;
  const points = projectOutlines(decoded, scale, offsetX, offsetY);
  return {
    pack: decoded.pack,
    frame,
    scale,
    offsetX,
    offsetY,
    regions: decoded.regions.map((region, index) => ({
      id: region.id,
      aliases: region.aliases,
      polygons: points.regions[index]!,
      anchor: {
        ...region.anchor,
        x: region.anchor.x * scale + offsetX,
        y: region.anchor.y * scale + offsetY,
        clearance: region.anchor.clearance * scale,
      },
      geometryClass: region.geometryClass,
      microState: region.microState,
      ...(region.marker
        ? {
            marker: {
              x: region.marker.x * scale + offsetX,
              y: region.marker.y * scale + offsetY,
              radius: region.marker.radius * scale,
            },
          }
        : {}),
    })),
    boundaries: decoded.boundaries.map((boundary, index) => ({
      id: boundary.id,
      geometryClass: boundary.geometryClass,
      lines: points.boundaries[index]!,
    })),
  };
}
