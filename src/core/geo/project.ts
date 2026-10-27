import type { Point } from '../geometry';
import type { FittedGeoPack, GeoPack } from './types';

const RAD = Math.PI / 180;
const EQUAL_EARTH_A1 = 1.340264;
const EQUAL_EARTH_A2 = -0.081106;
const EQUAL_EARTH_A3 = 0.000893;
const EQUAL_EARTH_A4 = 0.003796;
const EQUAL_EARTH_M = Math.SQRT1_2 * Math.sqrt(1.5);
const CLIP_EPSILON = 1e-6;

/**
 * Project longitude/latitude through the metadata-backed projection used to
 * bake a geo pack. Returning pack coordinates keeps the final fit under the
 * same scale/translation as region geometry.
 */
export function projectGeoLonLat(pack: GeoPack, lon: number, lat: number): Point | null {
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error(`invalid longitude/latitude (${lon}, ${lat})`);
  }
  const normalizedLon = normalizeLongitude(lon);
  if (pack.meta.projection === 'equal-earth') return projectEqualEarth(pack, normalizedLon, lat);
  if (pack.meta.projection === 'laea-europe-epsg3035-equivalent') {
    return projectEuropeanLaea(pack, normalizedLon, lat);
  }
  return projectAlbersUsa(pack, normalizedLon, lat);
}

export function fitGeoLonLat(fitted: FittedGeoPack, lon: number, lat: number): Point | null {
  const projected = projectGeoLonLat(fitted.pack, lon, lat);
  if (!projected) return null;
  return {
    x: projected.x * fitted.scale + fitted.offsetX,
    y: projected.y * fitted.scale + fitted.offsetY,
  };
}

function projectEqualEarth(pack: GeoPack, lon: number, lat: number): Point {
  const lambda = lon * RAD;
  const phi = lat * RAD;
  const l = Math.asin(EQUAL_EARTH_M * Math.sin(phi));
  const l2 = l * l;
  const l6 = l2 * l2 * l2;
  const rawX =
    (lambda * Math.cos(l)) /
    (EQUAL_EARTH_M *
      (EQUAL_EARTH_A1 + 3 * EQUAL_EARTH_A2 * l2 + l6 * (7 * EQUAL_EARTH_A3 + 9 * EQUAL_EARTH_A4 * l2)));
  const rawY = l * (EQUAL_EARTH_A1 + EQUAL_EARTH_A2 * l2 + l6 * (EQUAL_EARTH_A3 + EQUAL_EARTH_A4 * l2));
  const scale = pack.meta.projectionScale ?? 1;
  const translate = pack.meta.projectionTranslate ?? [0, 0];
  return { x: translate[0] + scale * rawX, y: translate[1] - scale * rawY };
}

function projectEuropeanLaea(pack: GeoPack, lon: number, lat: number): Point {
  const center = pack.meta.projectionCenter ?? [10, 52];
  const lambda = lon * RAD;
  const phi = lat * RAD;
  const lambda0 = center[0] * RAD;
  const phi0 = center[1] * RAD;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinPhi0 = Math.sin(phi0);
  const cosPhi0 = Math.cos(phi0);
  const delta = lambda - lambda0;
  const k = Math.sqrt(2 / (1 + sinPhi0 * sinPhi + cosPhi0 * cosPhi * Math.cos(delta)));
  return {
    x: k * cosPhi * Math.sin(delta),
    y: -k * (cosPhi0 * sinPhi - sinPhi0 * cosPhi * Math.cos(delta)),
  };
}

/**
 * The baked US pack uses the standard d3 geoAlbersUsa composite. The
 * lower-48 branch covers ordinary mainland anchors; the geographic bounds
 * below select the canonical Alaska and Hawaii inset branches.
 */
function projectAlbersUsa(pack: GeoPack, lon: number, lat: number): Point | null {
  const scale = pack.meta.projectionScale ?? 1070;
  const translate = pack.meta.projectionTranslate ?? [480, 250];
  const lower48 = conicEqualArea(lon, lat, {
    rotate: 96,
    center: [-0.6, 38.7],
    parallels: [29.5, 45.5],
    scale,
    translate,
  });
  if (
    insideClip(
      lower48,
      translate[0] - 0.455 * scale,
      translate[1] - 0.238 * scale,
      translate[0] + 0.455 * scale,
      translate[1] + 0.238 * scale,
    )
  ) {
    return lower48;
  }
  const alaska = conicEqualArea(lon, lat, {
    rotate: 154,
    center: [-2, 58.5],
    parallels: [55, 65],
    scale: scale * 0.35,
    translate: [translate[0] - 0.307 * scale, translate[1] + 0.201 * scale],
  });
  if (
    insideClip(
      alaska,
      translate[0] - 0.425 * scale + CLIP_EPSILON,
      translate[1] + 0.12 * scale + CLIP_EPSILON,
      translate[0] - 0.214 * scale - CLIP_EPSILON,
      translate[1] + 0.234 * scale - CLIP_EPSILON,
    )
  ) {
    return alaska;
  }
  const hawaii = conicEqualArea(lon, lat, {
    rotate: 157,
    center: [-3, 19.9],
    parallels: [8, 18],
    scale,
    translate: [translate[0] - 0.205 * scale, translate[1] + 0.212 * scale],
  });
  return insideClip(
    hawaii,
    translate[0] - 0.214 * scale + CLIP_EPSILON,
    translate[1] + 0.166 * scale + CLIP_EPSILON,
    translate[0] - 0.115 * scale - CLIP_EPSILON,
    translate[1] + 0.234 * scale - CLIP_EPSILON,
  )
    ? hawaii
    : null;
}

function insideClip(point: Point, x0: number, y0: number, x1: number, y1: number): boolean {
  return point.x >= x0 && point.x <= x1 && point.y >= y0 && point.y <= y1;
}

function conicEqualArea(
  lon: number,
  lat: number,
  params: {
    rotate: number;
    center: readonly [number, number];
    parallels: readonly [number, number];
    scale: number;
    translate: readonly [number, number];
  },
): Point {
  const phi0 = params.parallels[0] * RAD;
  const phi1 = params.parallels[1] * RAD;
  const sy0 = Math.sin(phi0);
  const n = (sy0 + Math.sin(phi1)) / 2;
  const c = 1 + sy0 * (2 * n - sy0);
  const r0 = Math.sqrt(c) / n;
  const raw = (lambda: number, phi: number): Point => {
    const r = Math.sqrt(c - 2 * n * Math.sin(phi)) / n;
    return { x: r * Math.sin(lambda * n), y: r0 - r * Math.cos(lambda * n) };
  };
  const point = raw(normalizeLongitude(lon + params.rotate) * RAD, lat * RAD);
  const center = raw(params.center[0] * RAD, params.center[1] * RAD);
  return {
    x: params.translate[0] + params.scale * (point.x - center.x),
    y: params.translate[1] - params.scale * (point.y - center.y),
  };
}

function normalizeLongitude(lon: number): number {
  if (lon >= -180 && lon < 180) return lon;
  return ((lon + 180) % 360 + 360) % 360 - 180;
}
