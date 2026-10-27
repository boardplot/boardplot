/**
 * Font metrics for DOM-free text measurement.
 *
 * `tables.generated.ts` carries the advance widths of the faces the shipped
 * themes render with (generated from the real font files by
 * scripts/build-font-metrics.mjs). `resolveFace` maps a CSS family stack and
 * a weight to the first tabled face; a stack without a tabled family gets
 * `undefined` and the measurer falls back to its character-class model.
 */

import { CODE_POINT_RANGES, EXTRA_CODE_POINTS, FACE_TABLES, type FaceTable } from './tables.generated';

export interface Face {
  family: string;
  weight: number;
  /** Vertical metrics in 1/1000 em. */
  ascent: number;
  descent: number;
  lineGap: number;
  capHeight: number;
  xHeight: number;
  /** Measured advance in 1/1000 em, including recorded fallbacks; undefined when unmeasured. */
  advance(codePoint: number): number | undefined;
  /**
   * Code points measured with GLYPH_FALLBACK_FAMILIES. The PNG raster
   * isolates them so resvg cannot replace the surrounding letters.
   */
  borrowed?: ReadonlySet<number>;
}

/** The family a font spec without `family` is measured as: the boardroom default. */
export const DEFAULT_FAMILY = 'Helvetica Neue';

/** Position of each code point inside a width table, in table order. */
export function buildCodePointIndex(
  ranges: readonly (readonly [number, number])[],
  extras: readonly number[],
): Map<number, number> {
  const index = new Map<number, number>();
  let i = 0;
  for (const [from, to] of ranges) for (let cp = from; cp <= to; cp++) index.set(cp, i++);
  for (const cp of extras) index.set(cp, i++);
  return index;
}

const CODE_POINT_INDEX: Map<number, number> = buildCodePointIndex(CODE_POINT_RANGES, EXTRA_CODE_POINTS);

/** Decode the base64 little-endian widths of an imported font table. */
export function decodeFace(table: FaceTable, index: Map<number, number> = CODE_POINT_INDEX): Face {
  const { widths: encoded, borrowed: _borrowed, ...metrics } = table;
  const widths = new DataView(Uint8Array.from(atob(encoded), character => character.charCodeAt(0)).buffer);
  return {
    ...metrics,
    advance(codePoint) {
      const i = index.get(codePoint);
      if (i === undefined) return undefined;
      return widths.getUint16(i * 2, true) || undefined;
    },
  };
}

/** Built-in tables retain their compact base36 encoding. */
function decodeBuiltInFace(table: FaceTable & { base?: number }, decoded: number[][]): Face {
  const { widths: encoded, borrowed, base, ...metrics } = table;
  const widths = encoded.split(',').map((value, index) =>
    parseInt(value, 36) + (base === undefined ? 0 : decoded[base]![index]!));
  decoded.push(widths);
  return {
    ...metrics,
    ...(borrowed ? { borrowed: new Set(borrowed.split(',').map(value => parseInt(value, 36))) } : {}),
    advance(codePoint) {
      return widths[CODE_POINT_INDEX.get(codePoint) ?? -1] || undefined;
    },
  };
}

/**
 * Bundled families measured with another family's rows. No free Helvetica
 * Neue font exists, so Boardplot ships no Helvetica Neue widths: a stack that
 * names it measures with the Helvetica rows (Liberation Sans 2.1.5, metric
 * compatible with Arial). Weight 500 measures with the bold row: real Helvetica
 * Neue Medium draws up to 11% wider than the regular row, so the bold row is the
 * side that keeps text inside its box. 600 measures bold as well.
 * The faces keep the stack's family name, so the PNG raster still shapes the
 * installed Helvetica Neue and isolates the same borrowed arrows. Unlike
 * FAMILY_ALIASES this applies to the bundled tables only: tables a host
 * builds for Helvetica Neue with `boardplot fonts build` measure Helvetica
 * Neue and nothing else.
 */
const BUNDLED_STAND_INS: Readonly<Record<string, string>> = { 'Helvetica Neue': 'helvetica' };

const FACES_BY_FAMILY: Map<string, Face[]> = (() => {
  const map = new Map<string, Face[]>();
  const decoded: number[][] = [];
  for (const table of FACE_TABLES) {
    const key = normalizeFamilyName(table.family);
    const list = map.get(key) ?? [];
    list.push(decodeBuiltInFace(table, decoded));
    map.set(key, list);
  }
  for (const [family, source] of Object.entries(BUNDLED_STAND_INS)) {
    const faces = map.get(source)!.map((face) => ({ ...face, family }));
    const bold = nearestWeight(faces, 700);
    map.set(normalizeFamilyName(family), [...faces, { ...bold, weight: 500 }]);
  }
  return map;
})();

/** `'Helvetica Neue'` → `helvetica neue`; the comparison key for family names. */
function normalizeFamilyName(name: string): string {
  return name.trim().replace(/^['"]|['"]$/g, '').trim().toLowerCase();
}

/**
 * Families measured from another family's tables. `Geist Variable` is the
 * variable build of the same drawing @fontsource ships beside the static
 * weights, so a stack that names it measures from the Geist rows instead of
 * falling back to the character-class model.
 */
const FAMILY_ALIASES: Readonly<Record<string, string>> = { 'geist variable': 'geist' };

/** The table key a family name looks up, alias resolved. */
export function tableFamilyKey(name: string): string {
  const key = normalizeFamilyName(name);
  return FAMILY_ALIASES[key] ?? key;
}

/** Every family a CSS stack names, in order. */
export function familiesOf(stack: string): string[] {
  return stack.split(',').map(tableFamilyKey).filter(Boolean);
}

/** The tabled weight closest to the requested one; ties go to the heavier face. */
export function nearestWeight(faces: readonly Face[], weight: number): Face {
  let best = faces[0]!;
  for (const face of faces) {
    const d = Math.abs(face.weight - weight);
    const bestD = Math.abs(best.weight - weight);
    if (d < bestD || (d === bestD && face.weight > best.weight)) best = face;
  }
  return best;
}

// Keyed by the caller's family stack, which is authored text, so the map is
// capped: a long-running server fed arbitrary stacks would otherwise grow it
// without bound. A chart uses a handful of stacks and weights.
const RESOLVE_CACHE_LIMIT = 256;
const resolveCache = new Map<string, Face | undefined>();

/**
 * The face a font spec is measured with: the first family of `stack` that has
 * a table, at the nearest tabled weight. `undefined` when no family is
 * tabled, in which case the caller keeps its own estimate.
 */
export function resolveFace(stack: string | undefined, weight: number): Face | undefined {
  const key = `${stack ?? ''}|${weight}`;
  const cached = resolveCache.get(key);
  if (cached !== undefined || resolveCache.has(key)) return cached;
  let face: Face | undefined;
  for (const family of familiesOf(stack ?? DEFAULT_FAMILY)) {
    const faces = FACES_BY_FAMILY.get(family);
    if (faces) {
      face = nearestWeight(faces, weight);
      break;
    }
  }
  if (resolveCache.size >= RESOLVE_CACHE_LIMIT) resolveCache.delete(resolveCache.keys().next().value!);
  resolveCache.set(key, face);
  return face;
}

/** The bundled family whose rows a stand-in family is measured with (Helvetica Neue → helvetica), or undefined. */
export function bundledStandIn(family: string): string | undefined {
  const key = tableFamilyKey(family);
  const entry = Object.entries(BUNDLED_STAND_INS).find(([name]) => tableFamilyKey(name) === key);
  return entry?.[1];
}

/** Families with a shipped table, for diagnostics and tests. */
export function tabledFamilies(): string[] {
  return [...new Set([...FACE_TABLES.map((t) => t.family), ...Object.keys(BUNDLED_STAND_INS)])];
}
