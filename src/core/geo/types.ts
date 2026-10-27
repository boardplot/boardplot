import type { ChartCredit } from '../notes';
import type { Rect } from '../geometry';

export type GeoPackId = 'de-states' | 'eu27' | 'dach' | 'europe' | 'world' | 'us-states';
export type GeoWorldview = 'sourceDefined' | 'naturalEarthDeFacto' | 'naturalEarthPovDeu';
export type GeoPoint = readonly [number, number];
export type GeoArc = readonly GeoPoint[];
export interface GeoPackedArcs {
  encoding: 'delta-zigzag-varint-base64';
  lengths: readonly number[];
  data: string;
}
type GeoRingRefs = readonly number[];
export type GeoLineRefs = readonly number[];
type GeoPolygonRefs = readonly GeoRingRefs[];
export type GeoMultiPolygonRefs = readonly GeoPolygonRefs[];
type GeoRegionGeometryClass = 'administrative' | 'disputed-area';
export type GeoBoundaryClass = 'disputed-boundary';

interface GeoTransform {
  scale: GeoPoint;
  translate: GeoPoint;
}

interface GeoAnchor {
  x: number;
  y: number;
  clearance: number;
  name: string;
  shortName: string;
  fontTier: 0 | 1 | 2;
  leader: boolean;
}

interface GeoMarker {
  x: number;
  y: number;
  radius: number;
}

interface GeoRegionRecord {
  id: string;
  aliases: readonly string[];
  polygons: GeoMultiPolygonRefs;
  anchor: GeoAnchor;
  geometryClass?: GeoRegionGeometryClass;
  microState?: boolean;
  marker?: GeoMarker;
}

interface GeoBoundaryRecord {
  id: string;
  geometryClass: GeoBoundaryClass;
  lines: readonly GeoLineRefs[];
}

interface GeoDisputeTreatment {
  regionId: string;
  treatment:
    | 'assigned-to-region'
    | 'separate-administrative-unit'
    | 'separate-disputed-area';
}

interface GeoPackMeta {
  source: string;
  sourceUrl: string;
  sourceVersion: string;
  sourceSha256: string;
  license: string;
  attribution: string;
  /**
   * The licence credit the frame prints (footer rule).
   * `required` keeps it visible on every target; otherwise it goes to the
   * notes list. The change detail of `attribution` stays in NOTICE.md.
   */
  credit?: ChartCredit;
  projection:
    | 'laea-europe-epsg3035-equivalent'
    | 'equal-earth'
    | 'albers-usa-composite';
  projectionCenter: GeoPoint | null;
  projectionRotation?: GeoPoint;
  projectionScale?: number;
  projectionTranslate?: GeoPoint;
  quantization: 100000;
  worldview: GeoWorldview;
  disputes: {
    status: 'not-triggered' | 'active';
    geometryClasses: readonly ['administrative', 'disputed-boundary', 'disputed-area'];
    disputedLayerVersion: string | null;
    disputedLayerSourceSha256?: string;
    treatments?: Readonly<Partial<Record<
      'crimea' | 'kosovo' | 'taiwan' | 'westernSahara' | 'hongKong',
      GeoDisputeTreatment
    >>>;
  };
  chartNote?: string;
  /** Border choices of the pack. Kept in the meta, NOTICE.md and the docs; never drawn on the map. */
  borderNote?: string;
  insetScaleNote?: string;
  scopeNote?: string;
  /** Set only where a pack was simplified past the standard 0.5 px gate. */
  displacementLimitPx800?: number;
  packRev: number;
  hash: string;
  maxBoundaryDisplacementPx800: number;
  rasterDiffPixels800: number;
  rasterDiffRate800: number;
}

export interface GeoPack {
  id: GeoPackId;
  canonicalSize: readonly [number, number];
  bounds: readonly [number, number, number, number];
  transform: GeoTransform;
  arcs: GeoPackedArcs;
  regions: readonly GeoRegionRecord[];
  boundaries?: readonly GeoBoundaryRecord[];
  meta: GeoPackMeta;
}

export interface DecodedGeoRegion {
  id: string;
  aliases: readonly string[];
  polygons: GeoPoint[][][];
  anchor: GeoAnchor;
  geometryClass: GeoRegionGeometryClass;
  microState: boolean;
  marker?: GeoMarker;
}

interface DecodedGeoBoundary {
  id: string;
  geometryClass: GeoBoundaryClass;
  lines: GeoPoint[][];
}

export interface DecodedGeoPack {
  pack: GeoPack;
  regions: DecodedGeoRegion[];
  boundaries: DecodedGeoBoundary[];
}

export interface FittedGeoRegion {
  id: string;
  aliases: readonly string[];
  polygons: GeoPoint[][][];
  anchor: GeoAnchor;
  geometryClass: GeoRegionGeometryClass;
  microState: boolean;
  marker?: GeoMarker;
}

export interface FittedGeoBoundary {
  id: string;
  geometryClass: GeoBoundaryClass;
  lines: GeoPoint[][];
}

export interface FittedGeoPack {
  pack: GeoPack;
  frame: Rect;
  scale: number;
  offsetX: number;
  offsetY: number;
  regions: FittedGeoRegion[];
  boundaries: FittedGeoBoundary[];
}
