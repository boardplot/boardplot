import type { Rect } from '../geometry';
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

/**
 * `reuse` offers an earlier fit of the same decoded pack: its point arrays are taken when its
 * transform is this one. Anchors and markers are read again, since a pack's anchor and marker
 * objects stay live (decodeGeoPack).
 */
function fitDecodedGeoPack(decoded: DecodedGeoPack, frame: Rect, reuse?: FittedGeoPack): FittedGeoPack {
  const [minX, minY, maxX, maxY] = decoded.pack.bounds;
  const sx = frame.w / (maxX - minX);
  const sy = frame.h / (maxY - minY);
  const scale = sx < sy ? sx : sy;
  const offsetX = frame.x + (frame.w - (maxX - minX) * scale) / 2 - minX * scale;
  const offsetY = frame.y + (frame.h - (maxY - minY) * scale) / 2 - minY * scale;
  const points = reuse !== undefined && reuse.pack === decoded.pack && reuse.scale === scale
    && reuse.offsetX === offsetX && reuse.offsetY === offsetY ? reuse : undefined;
  const fitPoint = (point: GeoPoint): GeoPoint => [
    point[0] * scale + offsetX,
    point[1] * scale + offsetY,
  ];
  return {
    pack: decoded.pack,
    frame,
    scale,
    offsetX,
    offsetY,
    regions: decoded.regions.map((region, index) => ({
      id: region.id,
      aliases: region.aliases,
      polygons: points?.regions[index]!.polygons ?? region.polygons.map((polygon) => polygon.map((ring) => ring.map(fitPoint))),
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
      lines: points?.boundaries[index]!.lines ?? boundary.lines.map((line) => line.map(fitPoint)),
    })),
  };
}

// The label probe fits the same frame on each pass, and a map layout fits it once more for the
// marks. The point arrays of a fit depend only on the decoded pack and the transform, so the
// last fit lends them to the next fit with the same transform. More fits kept would hit little
// more often (3% more calls at eight) and a fitted pack holds up to 2 MB.
let lastFit: FittedGeoPack | undefined;

/** The point arrays (polygons, boundary lines) are shared between fits of one transform: read-only. */
export function fitGeoPack(pack: GeoPack, frame: Rect): FittedGeoPack {
  return lastFit = fitDecodedGeoPack(decodeGeoPack(pack), frame, lastFit);
}
