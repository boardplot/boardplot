/**
 * The ONE region-identity resolver.
 *
 * A pack alias can be claimed by more than one region ('J' is POSTAL for
 * Jamaica, Jordan and Japan in Natural Earth). Every surface (choropleth,
 * tilemap) resolves through `resolveGeoRegionId`, whose answer depends only on
 * the SET of claimants and never on iteration order. So all surfaces name the
 * same region for the same alias by construction.
 *
 * Ambiguous aliases stay in the packs on purpose. They are the vocabulary of
 * the diagnostic: dropping 'J' from the data would turn a precise "'J' is
 * ambiguous between JM, JO, JP" into an unhelpful "unknown region 'J'".
 * `scripts/build-geo-packs.mjs` carries the matching bake-time gate, so no
 * new ambiguity can be baked without an explicit entry.
 */

/** The shape both geo-pack regions and tile-pack regions share. */
export interface GeoIdentifiableRegion {
  readonly id: string;
  readonly aliases: readonly string[];
}

export interface GeoRegionIdIndex {
  /** Canonical ids plus every alias that names exactly one region. */
  readonly canonical: ReadonlyMap<string, string>;
  /** Alias -> the sorted canonical ids that claim it, for aliases with >1 claimant. */
  readonly ambiguous: ReadonlyMap<string, readonly string[]>;
  /** Every accepted spelling, ambiguous ones included — the vocabulary for suggestions. */
  readonly keys: readonly string[];
}

type GeoRegionResolution =
  | { kind: 'resolved'; id: string }
  | { kind: 'ambiguous'; candidates: readonly string[] }
  | { kind: 'unknown' };

const indexCache = new WeakMap<object, GeoRegionIdIndex>();

/**
 * Identity rules, in force on every surface:
 *  1. a canonical region id always wins — an alias may never shadow one;
 *  2. an alias claimed by exactly one region resolves to that region;
 *  3. an alias claimed by two or more regions resolves to NOTHING. Picking a
 *     winner is what made this a defect; the caller must warn instead.
 */
export function buildGeoRegionIdIndex(
  regions: readonly GeoIdentifiableRegion[],
): GeoRegionIdIndex {
  const claimants = new Map<string, string[]>();
  for (const region of regions) {
    for (const alias of region.aliases) {
      const list = claimants.get(alias) ?? [];
      if (!list.includes(region.id)) list.push(region.id);
      claimants.set(alias, list);
    }
  }
  const canonical = new Map<string, string>();
  const ambiguous = new Map<string, readonly string[]>();
  for (const region of regions) canonical.set(region.id, region.id);
  for (const [alias, ids] of claimants) {
    if (canonical.has(alias)) continue;
    if (ids.length > 1) {
      ambiguous.set(alias, [...ids].sort());
      continue;
    }
    canonical.set(alias, ids[0]!);
  }
  const keys = [...canonical.keys(), ...ambiguous.keys()];
  return { canonical, ambiguous, keys };
}

/** Cached per regions array; pack region arrays are module constants. */
export function geoRegionIdIndex(
  regions: readonly GeoIdentifiableRegion[],
): GeoRegionIdIndex {
  const key = regions as unknown as object;
  let index = indexCache.get(key);
  if (!index) {
    index = buildGeoRegionIdIndex(regions);
    indexCache.set(key, index);
  }
  return index;
}

export function resolveGeoRegionId(
  index: GeoRegionIdIndex,
  id: string,
): GeoRegionResolution {
  const resolved = index.canonical.get(id);
  if (resolved !== undefined) return { kind: 'resolved', id: resolved };
  const candidates = index.ambiguous.get(id);
  if (candidates) return { kind: 'ambiguous', candidates };
  return { kind: 'unknown' };
}

/**
 * Every pack region a spelling lays claim to: the one it resolves to, or ALL of
 * them when it is ambiguous. Documents de-duplicate against this rather than
 * against the resolved id — otherwise 'J' and 'JP' in one document stop
 * colliding the moment 'J' becomes unmappable, and a document naming Japan
 * twice is accepted in silence.
 */
export function claimedRegionIds(resolution: GeoRegionResolution): readonly string[] {
  if (resolution.kind === 'resolved') return [resolution.id];
  if (resolution.kind === 'ambiguous') return resolution.candidates;
  return [];
}
