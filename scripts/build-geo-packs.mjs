#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { geoAlbersUsa, geoAzimuthalEqualArea, geoEqualEarth } from 'd3-geo';
import polylabel from 'polylabel';
import { feature as topoFeature, merge as topoMerge, quantize as quantizeTopology } from 'topojson-client';
import { topology } from 'topojson-server';
import {
  planarTriangleArea,
  presimplify,
  quantile,
  simplify,
} from 'topojson-simplify';
import { TILE_LAYOUTS, parseTileLayout, tileLayoutFaults } from './tile-layouts.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REFERENCE_DIR = resolve(ROOT, 'reference/geo');
const OUTPUT_DIR = resolve(ROOT, 'src/core/geo/packs');
const TILE_OUTPUT_DIR = resolve(ROOT, 'src/core/geo/tiles');
const QUANTIZATION = 100000;
const CANONICAL_PX = 800;
const DISPLACEMENT_LIMIT_PX = 0.5;
const TARGET_DISPLACEMENT_PX = 0.44;
const RASTER_DIFF_LIMIT = 0.005;
const TINY_RING_AREA_PX2 = 0.16;
// Size limit for the combined source of the de-states, eu27 and dach packs.
const EUROPE_PACKS_SIZE_LIMIT = 300 * 1024;
const WORLD_PACK_SIZE_LIMIT = 150 * 1024;
const US_PACK_SIZE_LIMIT = 120 * 1024;
const EUROPE_PACK_SIZE_LIMIT = 80 * 1024;
// Centre distance between two marker dots on the 800 px canvas: two radii
// (2.5 px each) plus 2 px, so painted dots and their outlines never touch.
const MARKER_MIN_GAP_PX = 7;

const SOURCES = {
  de: {
    file: 'vg2500_12-31.utm32s.shape.zip',
    url: 'https://daten.gdz.bkg.bund.de/produkte/vg/vg2500/2024/vg2500_12-31.utm32s.shape.zip',
    sha256: 'c66883a566907c17ae5fd8cc2006d7e2e9c6c2303e80ffa9c46df604de3ad010',
    shp: 'vg2500_12-31.utm32s.shape/vg2500/VG2500_LAN.shp',
    dbf: 'vg2500_12-31.utm32s.shape/vg2500/VG2500_LAN.dbf',
  },
  ne50: {
    file: 'ne_50m_admin_0_countries.zip',
    url: 'https://naturalearth.s3.amazonaws.com/5.1.1/50m_cultural/ne_50m_admin_0_countries.zip',
    sha256: '5fed433373581fa648920435f937d95f2d3c0200e067409c6478dcdf1b853139',
    shp: 'ne_50m_admin_0_countries.shp',
    dbf: 'ne_50m_admin_0_countries.dbf',
  },
  ne10: {
    file: 'ne_10m_admin_0_countries.zip',
    url: 'https://naturalearth.s3.amazonaws.com/5.1.1/10m_cultural/ne_10m_admin_0_countries.zip',
    sha256: 'ce1ac7036499a0edd641fbc093cd209a98f96a49d2eca8480aaacad35138a7f6',
    shp: 'ne_10m_admin_0_countries.shp',
    dbf: 'ne_10m_admin_0_countries.dbf',
  },
  // Point-of-view variant of ne10: Crimea belongs to Ukraine (German view).
  // Natural Earth 5.1.1 publishes the variants at 1:10m only.
  ne10Deu: {
    file: 'ne_10m_admin_0_countries_deu.zip',
    url: 'https://naturalearth.s3.amazonaws.com/5.1.1/10m_cultural/ne_10m_admin_0_countries_deu.zip',
    sha256: '125fc4b1f425926b8bd22dce23af6f9f873543c2fe330915ccbe0aa7fa21ff82',
    shp: 'ne_10m_admin_0_countries_deu.shp',
    dbf: 'ne_10m_admin_0_countries_deu.dbf',
  },
  ne110: {
    file: 'ne_110m_admin_0_countries.zip',
    url: 'https://naturalearth.s3.amazonaws.com/5.1.1/110m_cultural/ne_110m_admin_0_countries.zip',
    sha256: '0f243aeac8ac6cf26f0417285b0bd33ac47f1b5bdb719fd3e0df37d03ea37110',
    shp: 'ne_110m_admin_0_countries.shp',
    dbf: 'ne_110m_admin_0_countries.dbf',
  },
  ne110Tiny: {
    file: 'ne_110m_admin_0_tiny_countries.zip',
    url: 'https://naturalearth.s3.amazonaws.com/5.1.1/110m_cultural/ne_110m_admin_0_tiny_countries.zip',
    sha256: '076ae0cd04648c22756f574d4c3889266ea779593e717ab5e17b8ff06700d2a0',
    shp: 'ne_110m_admin_0_tiny_countries.shp',
    dbf: 'ne_110m_admin_0_tiny_countries.dbf',
  },
  ne110Boundaries: {
    file: 'ne_110m_admin_0_boundary_lines_land.zip',
    url: 'https://naturalearth.s3.amazonaws.com/5.1.1/110m_cultural/ne_110m_admin_0_boundary_lines_land.zip',
    sha256: 'bb2954981570498a4b4344f8e83fa54caa5858e15e800094112407d2bd2f940d',
    shp: 'ne_110m_admin_0_boundary_lines_land.shp',
    dbf: 'ne_110m_admin_0_boundary_lines_land.dbf',
  },
  us2025: {
    file: 'cb_2025_us_state_5m.zip',
    url: 'https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_us_state_5m.zip',
    sha256: '8a45692bc532dbd38938a1924f445850cef2682ea67d750d7fd2f19cfe836903',
    shp: 'cb_2025_us_state_5m.shp',
    dbf: 'cb_2025_us_state_5m.dbf',
  },
};

/**
 * Point of view of the `europe` pack. This is the ONE place to change it.
 *   'deu'     German view (Natural Earth `_deu` variant): Crimea is part of UA.
 *   'defacto' Natural Earth default: Crimea is part of RU. The europe pack has
 *             no RU, so Crimea would be a hole next to UA.
 * Changing it changes the pack hash, the pack note and the worldview field.
 */
const EUROPE_POV = 'deu';
const EUROPE_POVS = {
  deu: {
    source: SOURCES.ne10Deu,
    worldview: 'naturalEarthPovDeu',
    sourceName: 'Natural Earth Admin-0 Countries 10m, point of view Germany (deu)',
    note: 'Borders follow the EU view; Crimea is shown as part of Ukraine; Cyprus is shown whole.',
  },
  defacto: {
    source: SOURCES.ne10,
    worldview: 'naturalEarthDeFacto',
    sourceName: 'Natural Earth Admin-0 Countries 10m',
    note: 'Borders follow Natural Earth de facto; Crimea is not part of Ukraine here; Cyprus is shown whole.',
  },
};
const EUROPE_POV_CONFIG = EUROPE_POVS[EUROPE_POV];

const DE_IDS = {
  '01': 'DE-SH',
  '02': 'DE-HH',
  '03': 'DE-NI',
  '04': 'DE-HB',
  '05': 'DE-NW',
  '06': 'DE-HE',
  '07': 'DE-RP',
  '08': 'DE-BW',
  '09': 'DE-BY',
  '10': 'DE-SL',
  '11': 'DE-BE',
  '12': 'DE-BB',
  '13': 'DE-MV',
  '14': 'DE-SN',
  '15': 'DE-ST',
  '16': 'DE-TH',
};

/** English display names for the states whose BKG name is German. */
const DE_NAMES = {
  'DE-BY': 'Bavaria',
  'DE-HE': 'Hesse',
  'DE-MV': 'Mecklenburg-Western Pomerania',
  'DE-NI': 'Lower Saxony',
  'DE-NW': 'North Rhine-Westphalia',
  'DE-RP': 'Rhineland-Palatinate',
  'DE-SN': 'Saxony',
  'DE-ST': 'Saxony-Anhalt',
  'DE-TH': 'Thuringia',
};

const COUNTRY_SHORT_NAMES = {
  AT: 'Austria',
  BE: 'Belgium',
  BG: 'Bulgaria',
  CH: 'Switzerland',
  CY: 'Cyprus',
  CZ: 'Czechia',
  DE: 'Germany',
  DK: 'Denmark',
  EE: 'Estonia',
  ES: 'Spain',
  FI: 'Finland',
  FR: 'France',
  GR: 'Greece',
  HR: 'Croatia',
  HU: 'Hungary',
  IE: 'Ireland',
  IT: 'Italy',
  LT: 'Lithuania',
  LU: 'Luxembourg',
  LV: 'Latvia',
  MT: 'Malta',
  NL: 'Netherlands',
  PL: 'Poland',
  PT: 'Portugal',
  RO: 'Romania',
  SE: 'Sweden',
  SI: 'Slovenia',
  SK: 'Slovakia',
};

/**
 * EU view of Cyprus: the whole island is CY. Natural Earth keeps Northern
 * Cyprus (CYN), the UN buffer zone (CNM) and the British base areas (ESB, WSB)
 * as separate rows without an ISO code. The eu27 and europe packs read them
 * as parts of CY and dissolve the shared borders; world keeps them apart.
 */
const CYPRUS_PARTS = { CYN: 'CY', CNM: 'CY', ESB: 'CY', WSB: 'CY' };

/**
 * The licence credits the frame prints (footer rule). BKG asks for a clearly visible note with the year of the
 * last data download, the licence with a link, the Datenquellen reference and
 * a change notice (dl-de/by-2-0 §2, §3; VG2500 terms of 30.06.2025). The
 * repository records no download date: the pack was first baked on 2026-07-24
 * and re-baked on 2026-08-10 against the sha256-pinned archive, so the year is
 * 2026. The change detail stays in `attribution` and NOTICE.md.
 */
const BKG_DATENQUELLEN = 'https://sgx.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg_nuts.pdf';
const BKG_CREDIT = {
  text: `© BKG (2026) dl-de/by-2-0 (data changed), Datenquellen: ${BKG_DATENQUELLEN}`,
  short: '© BKG (2026) dl-de/by-2-0 (data changed)',
  links: [
    { text: 'BKG', href: 'https://www.bkg.bund.de' },
    { text: 'dl-de/by-2-0', href: 'https://www.govdata.de/dl-de/by-2-0' },
    { text: 'Datenquellen', href: BKG_DATENQUELLEN },
  ],
  required: true,
};
/** Natural Earth is public domain: the credit is a courtesy and goes to the notes list. */
const naturalEarthCredit = (attribution) => ({
  text: attribution,
  short: 'Made with Natural Earth',
  links: [{ text: 'Natural Earth', href: 'https://www.naturalearthdata.com' }],
  required: false,
});
/** The Census file metadata asks to acknowledge the Census Bureau. */
const CENSUS_CREDIT = { text: 'U.S. Census Bureau (2025)', short: 'U.S. Census Bureau (2025)', links: [], required: true };

const PACKS = [
  {
    id: 'de-states',
    exportName: 'DE_STATES_PACK',
    output: 'de-states.generated.ts',
    source: SOURCES.de,
    load: loadGermany,
    sourceName: 'BKG VG2500 Länder',
    sourceVersion: '2024-12-31',
    license: 'DL-DE/BY-2.0',
    attribution:
      '© BKG (2026), dl-de/by-2-0; modified by Boardplot: filtered, preprojected, simplified, quantized.',
    credit: BKG_CREDIT,
    worldview: 'sourceDefined',
    disputedLayerVersion: null,
    project: projectEurope,
    anchorPrecision: 15,
    canonicalSize: [800, 800],
  },
  {
    id: 'eu27',
    exportName: 'EU27_PACK',
    output: 'eu27.generated.ts',
    source: SOURCES.ne50,
    load: loadEu27,
    sourceName: 'Natural Earth Admin-0 Countries 50m',
    sourceVersion: '5.1.1; EU member selection as of 2026-07-24',
    license: 'Public domain',
    attribution:
      'Natural Earth v5.1.1 (public domain); EU member selection as of 2026-07-24; modified by Boardplot.',
    credit: naturalEarthCredit('Natural Earth v5.1.1 (public domain); EU member selection as of 2026-07-24; modified by Boardplot.'),
    worldview: 'naturalEarthDeFacto',
    disputedLayerVersion: 'Natural Earth 5.1.1',
    borderNote: 'Borders follow the EU view; Cyprus is shown whole.',
    project: projectEurope,
    anchorPrecision: 15,
    canonicalSize: [800, 800],
  },
  {
    id: 'dach',
    exportName: 'DACH_PACK',
    output: 'dach.generated.ts',
    source: SOURCES.ne10,
    load: loadDach,
    sourceName: 'Natural Earth Admin-0 Countries 10m',
    sourceVersion: '5.1.1',
    license: 'Public domain',
    attribution:
      'Natural Earth v5.1.1 (public domain); modified by Boardplot: filtered, preprojected, simplified, quantized.',
    credit: naturalEarthCredit('Natural Earth v5.1.1 (public domain); modified by Boardplot: filtered, preprojected, simplified, quantized.'),
    worldview: 'naturalEarthDeFacto',
    disputedLayerVersion: 'Natural Earth 5.1.1',
    project: projectEurope,
    canonicalSize: [800, 800],
  },
  {
    id: 'europe',
    exportName: 'EUROPE_PACK',
    output: 'europe.generated.ts',
    source: EUROPE_POV_CONFIG.source,
    load: loadEurope,
    sourceName: EUROPE_POV_CONFIG.sourceName,
    sourceVersion: '5.1.1; Europe member selection as of 2026-10-09',
    license: 'Public domain',
    attribution:
      'Natural Earth v5.1.1 (public domain); Europe member selection as of 2026-10-09; modified by Boardplot.',
    credit: naturalEarthCredit('Natural Earth v5.1.1 (public domain); Europe member selection as of 2026-10-09; modified by Boardplot.'),
    worldview: EUROPE_POV_CONFIG.worldview,
    disputedLayerVersion: 'Natural Earth 5.1.1',
    disputesStatus: 'active',
    disputeTreatments: {
      crimea: { regionId: EUROPE_POV === 'deu' ? 'UA' : 'RU', treatment: 'assigned-to-region' },
      kosovo: { regionId: 'XK', treatment: 'separate-disputed-area' },
    },
    chartNote: 'Boundaries and names shown do not imply official endorsement.',
    borderNote: EUROPE_POV_CONFIG.note,
    scopeNote:
      'Europe without RU, TR and the Caucasus states: Russia and Turkey span two continents, and no map frame shows them whole without shrinking the rest.',
    project: projectEurope,
    anchorPrecision: 15,
    canonicalSize: [800, 800],
    // The 10m source is about five times denser than the 50m file behind eu27.
    // A bake at eu27's 0.44 px tolerance keeps twice eu27's vertices per country
    // (110 KB gzip). 5 px at 800 px (about 30 km at worst) leaves 1.07 times
    // eu27's vertices for its 27 members (measured), so one country has the same
    // detail in both packs. The pack records its own limit in meta.
    sizeLimit: EUROPE_PACK_SIZE_LIMIT,
    displacementLimitPx: 5,
    simplifyCandidates: [0.02, 0.05, 0.08, 0.1, 0.12, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.65, 0.8, 0.9, 0.97, 0],
    maximizeSimplification: true,
    spreadMarkers: true,
    // Under 8 px^2 on the 800 px canvas a region is not readable as a shape
    // (LI, SM, MC, VA, GI, JE, GG); it becomes a marker. MT, AD, IM, FO and AX stay outlines.
    markerBelowPx2: 8,
  },
  {
    id: 'world',
    exportName: 'WORLD_PACK',
    output: 'world.generated.ts',
    source: SOURCES.ne110,
    load: loadWorld,
    sourceName: 'Natural Earth Admin-0 Countries 110m',
    sourceVersion: '5.1.1; boundary lines 5.1.0',
    license: 'Public domain',
    attribution:
      'Natural Earth v5.1.1 (public domain); modified by Boardplot. Boundaries and names shown do not imply official endorsement.',
    credit: naturalEarthCredit('Natural Earth v5.1.1 (public domain); modified by Boardplot. Boundaries and names shown do not imply official endorsement.'),
    worldview: 'naturalEarthDeFacto',
    disputedLayerVersion: 'Natural Earth Admin-0 Boundary Lines Land 5.1.0',
    disputedLayerSourceSha256: SOURCES.ne110Boundaries.sha256,
    disputesStatus: 'active',
    disputeTreatments: {
      crimea: { regionId: 'UA', treatment: 'assigned-to-region' },
      kosovo: { regionId: 'XK', treatment: 'separate-disputed-area' },
      taiwan: { regionId: 'TW', treatment: 'separate-administrative-unit' },
      hongKong: { regionId: 'HK', treatment: 'separate-administrative-unit' },
      westernSahara: { regionId: 'EH', treatment: 'separate-disputed-area' },
    },
    chartNote: 'Boundaries and names shown do not imply official endorsement.',
    // Not drawn on the map: it lives in the pack meta, NOTICE.md and the docs.
    borderNote: "Crimea is shown as part of Ukraine; other borders follow Natural Earth's de facto view.",
    project: projectWorld,
    anchorPrecision: 12,
    projection: 'equal-earth',
    projectionCenter: [0, 0],
    projectionRotation: [0, 0],
    projectionScale: 147,
    projectionTranslate: [400, 220],
    canonicalSize: [800, 440],
    sizeLimit: WORLD_PACK_SIZE_LIMIT,
    spreadMarkers: true,
    maximizeSimplification: true,
  },
  {
    id: 'us-states',
    exportName: 'US_STATES_PACK',
    output: 'us-states.generated.ts',
    source: SOURCES.us2025,
    load: loadUsStates,
    sourceName: 'US Census Bureau 2025 Cartographic Boundary Files, states 1:5m',
    sourceVersion: '2025',
    license: 'US federal-government work; no US copyright under 17 USC §105',
    attribution:
      'US Census Bureau 2025 Cartographic Boundary Files (1:5m); modified by Boardplot. Alaska and Hawaii insets use non-comparable scales.',
    credit: CENSUS_CREDIT,
    worldview: 'sourceDefined',
    disputedLayerVersion: null,
    insetScaleNote:
      'Alaska and Hawaii are shown as composite insets at non-comparable scales; area comparisons across insets are not valid.',
    scopeNote: 'Includes 50 states and the District of Columbia; territories are excluded.',
    project: projectUs,
    anchorPrecision: 11,
    projection: 'albers-usa-composite',
    projectionCenter: null,
    projectionRotation: [0, 0],
    projectionScale: 1300,
    projectionTranslate: [487.5, 305],
    canonicalSize: [975, 610],
    sizeLimit: US_PACK_SIZE_LIMIT,
    maximizeSimplification: true,
  },
];

const laea = geoAzimuthalEqualArea()
  .rotate([-10, -52])
  .scale(1)
  .translate([0, 0])
  .precision(0.01);
const equalEarth = geoEqualEarth()
  .rotate([0, 0])
  .scale(147)
  .translate([400, 220])
  .precision(0.01);
const albersUsa = geoAlbersUsa()
  .scale(1300)
  .translate([487.5, 305])
  .precision(0.01);

// The grids themselves are hand-authored in ./tile-layouts.mjs.
const TILE_PACKS = [
  { id: 'eu27', sourcePack: 'eu27', memberDate: '2026-07-24' },
  { id: 'europe', sourcePack: 'europe', memberDate: '2026-10-09' },
  { id: 'world', sourcePack: 'world', memberDate: '2022-05-09' },
  { id: 'us-states', sourcePack: 'us-states', memberDate: '2025' },
];

/**
 * Region-identity ledger. A source vocabulary is not guaranteed unique —
 * Natural Earth's POSTAL code 'J' is carried by Jamaica, Jordan AND Japan — and
 * an alias that names several regions would resolve to a different country on
 * every surface that read it. The collisions are kept in the packs on purpose:
 * they are what lets the engine answer "'J' is ambiguous between JM, JO, JP"
 * instead of "unknown region 'J'", and src/core/geo/resolveRegionId.ts refuses
 * to map them. What must never happen again is a collision arriving unnoticed,
 * so every one is written down here with its exact claimants and the bake fails
 * on anything undeclared, mis-declared, or stale.
 */
const DECLARED_AMBIGUOUS_ALIASES = {
  world: { J: ['JM', 'JO', 'JP'] },
};

function aliasClaimants(regions) {
  const claimants = new Map();
  for (const region of regions) {
    for (const alias of region.aliases) {
      const ids = claimants.get(alias) ?? new Set();
      ids.add(region.id);
      claimants.set(alias, ids);
    }
  }
  return claimants;
}

/** Bake-time uniqueness gate. Mirrors `ambiguousAliases` in the TS resolver. */
function assertRegionIdentity(label, packId, regions) {
  const canonicalIds = new Set(regions.map((region) => region.id));
  const claimants = aliasClaimants(regions);
  const shadowing = [...claimants.keys()].filter((alias) => canonicalIds.has(alias)).sort();
  if (shadowing.length > 0) {
    throw new Error(
      `${label}: alias(es) ${shadowing.join(', ')} shadow a canonical region id; ` +
        'an alias may never name a region other than its own',
    );
  }
  const declared = DECLARED_AMBIGUOUS_ALIASES[packId] ?? {};
  const found = new Map(
    [...claimants.entries()]
      .filter(([, ids]) => ids.size > 1)
      .map(([alias, ids]) => [alias, [...ids].sort()]),
  );
  for (const [alias, ids] of [...found.entries()].sort()) {
    const expected = declared[alias];
    if (!expected) {
      throw new Error(
        `${label}: alias '${alias}' is claimed by ${ids.join(', ')} — an ambiguous region id ` +
          'may not be baked. Drop it at its source, or declare it in ' +
          'DECLARED_AMBIGUOUS_ALIASES with a written reason.',
      );
    }
    if (expected.join(',') !== ids.join(',')) {
      throw new Error(
        `${label}: alias '${alias}' is declared ambiguous between ${expected.join(', ')} ` +
          `but is now claimed by ${ids.join(', ')}; update DECLARED_AMBIGUOUS_ALIASES.`,
      );
    }
  }
  for (const alias of Object.keys(declared).sort()) {
    if (!found.has(alias)) {
      throw new Error(
        `${label}: alias '${alias}' is declared ambiguous but no longer collides; ` +
          'remove the stale DECLARED_AMBIGUOUS_ALIASES entry.',
      );
    }
  }
  for (const [alias, ids] of [...found.entries()].sort()) {
    console.log(`${label}: declared ambiguous alias '${alias}' -> ${ids.join(', ')} (unmappable by design)`);
  }
}

/** Pack id -> region ids that a later release added; the geo and tile packs list them last. */
const APPENDED_IDS = new Map();

const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');
// --fetch is accepted for old command lines; missing archives are always fetched.
const unknownArgs = [...args].filter((arg) => arg !== '--check' && arg !== '--fetch');
if (unknownArgs.length > 0) {
  throw new Error(`unknown argument(s): ${unknownArgs.join(', ')}; supported: --check`);
}

// The source archives are not committed. A missing one is downloaded from the
// URL pinned in SOURCES (also listed in NOTICE.md) and kept
// only when its SHA-256 matches; every archive is checked again before use.
await fetchMissingSources();
await verifySources();

const first = await buildAll();
const second = await buildAll();
for (const pack of PACKS) {
  const a = first.get(pack.id);
  const b = second.get(pack.id);
  if (!a || !b || a.source !== b.source) {
    throw new Error(`${pack.id}: determinism gate failed; consecutive generated bytes differ`);
  }
}
const firstTiles = buildAllTilePacks(first);
const secondTiles = buildAllTilePacks(second);
for (const tileConfig of TILE_PACKS) {
  const a = firstTiles.get(tileConfig.id);
  const b = secondTiles.get(tileConfig.id);
  if (!a || !b || a.source !== b.source) {
    throw new Error(`${tileConfig.id} tile pack: determinism gate failed; consecutive generated bytes differ`);
  }
}

const europePacksRaw = ['de-states', 'eu27', 'dach']
  .reduce((sum, id) => sum + Buffer.byteLength(first.get(id).source), 0);
if (europePacksRaw > EUROPE_PACKS_SIZE_LIMIT) {
  throw new Error(`The de-states, eu27 and dach packs are ${europePacksRaw} bytes; limit is ${EUROPE_PACKS_SIZE_LIMIT}`);
}
for (const config of PACKS) {
  const raw = Buffer.byteLength(first.get(config.id).source);
  if (config.sizeLimit && raw > config.sizeLimit) {
    throw new Error(`${config.id}: generated TypeScript is ${raw} bytes; limit is ${config.sizeLimit}`);
  }
}

if (checkOnly) {
  for (const pack of PACKS) {
    const result = first.get(pack.id);
    const outputPath = resolve(OUTPUT_DIR, pack.output);
    if (!existsSync(outputPath)) throw new Error(`${pack.id}: missing generated file ${outputPath}`);
    const committed = await readFile(outputPath, 'utf8');
    if (committed !== result.source) {
      throw new Error(`${pack.id}: committed generated file is stale; run scripts/build-geo-packs.mjs`);
    }
  }
  for (const tileConfig of TILE_PACKS) {
    const result = firstTiles.get(tileConfig.id);
    const outputPath = resolve(TILE_OUTPUT_DIR, `${tileConfig.id}.generated.ts`);
    if (!existsSync(outputPath)) throw new Error(`${tileConfig.id}: missing generated tile file ${outputPath}`);
    const committed = await readFile(outputPath, 'utf8');
    if (committed !== result.source) {
      throw new Error(`${tileConfig.id}: committed tile file is stale; run scripts/build-geo-packs.mjs`);
    }
  }
} else {
  await mkdir(OUTPUT_DIR, { recursive: true });
  for (const pack of PACKS) {
    const result = first.get(pack.id);
    await writeFile(resolve(OUTPUT_DIR, pack.output), result.source);
  }
  await mkdir(TILE_OUTPUT_DIR, { recursive: true });
  for (const tileConfig of TILE_PACKS) {
    const result = firstTiles.get(tileConfig.id);
    await writeFile(resolve(TILE_OUTPUT_DIR, `${tileConfig.id}.generated.ts`), result.source);
  }
}

for (const pack of PACKS) {
  const result = first.get(pack.id);
  console.log(
    `${pack.id}: regions=${result.pack.regions.length} ` +
      `arcs=${result.pack.arcs.lengths.length} ` +
      `raw=${Buffer.byteLength(result.source)} gzip=${gzipSync(result.source).length} ` +
      `max-displacement@800=${result.pack.meta.maxBoundaryDisplacementPx800}px ` +
      `raster-diff@800=${result.pack.meta.rasterDiffPixels800}px/` +
      `${result.pack.meta.rasterDiffRate800} ` +
      `hash=${result.pack.meta.hash}`,
  );
}
for (const tileConfig of TILE_PACKS) {
  const result = firstTiles.get(tileConfig.id);
  console.log(
    `${tileConfig.id} tiles: regions=${result.pack.regions.length} ` +
      `grid=${result.pack.cols}x${result.pack.rows} ` +
      `adjacency-exceptions=${result.pack.meta.adjacencyExceptions.length} ` +
      `raw=${Buffer.byteLength(result.source)} gzip=${gzipSync(result.source).length}`,
  );
}
console.log(
  `geo packs ${checkOnly ? 'check' : 'build'}: byte-identical double bake; ` +
    `europe-packs raw=${europePacksRaw}/${EUROPE_PACKS_SIZE_LIMIT}`,
);

async function buildAll() {
  const outputs = new Map();
  for (const config of PACKS) {
    const loaded = await config.load(config.source, config);
    const input = Array.isArray(loaded) ? { regions: loaded, boundaries: [] } : loaded;
    const result = buildPack(config, input);
    outputs.set(config.id, result);
  }
  return outputs;
}

function buildAllTilePacks(geoPacks) {
  const outputs = new Map();
  for (const config of TILE_PACKS) {
    const geo = geoPacks.get(config.sourcePack);
    if (!geo) throw new Error(`${config.id}: missing source geo pack '${config.sourcePack}'`);
    outputs.set(config.id, buildTilePack(config, geo.pack));
  }
  return outputs;
}

async function fetchMissingSources() {
  await mkdir(REFERENCE_DIR, { recursive: true });
  for (const source of Object.values(SOURCES)) {
    const target = resolve(REFERENCE_DIR, source.file);
    if (existsSync(target)) continue;
    const response = await fetch(source.url);
    if (!response.ok) throw new Error(`${source.url}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const actual = sha256(bytes);
    if (actual !== source.sha256) {
      throw new Error(`${source.url}: downloaded SHA-256 ${actual} does not match pinned ${source.sha256}`);
    }
    await writeFile(target, bytes);
    console.log(`downloaded ${basename(target)}`);
  }
}

async function verifySources() {
  for (const source of Object.values(SOURCES)) {
    const target = resolve(REFERENCE_DIR, source.file);
    if (!existsSync(target)) {
      throw new Error(`missing ${target} after download`);
    }
    const actual = sha256(await readFile(target));
    if (actual !== source.sha256) {
      throw new Error(`${source.file}: SHA-256 ${actual} does not match pinned ${source.sha256}`);
    }
  }
}

async function loadGermany(source) {
  const rows = parseDbf(readArchiveEntry(source, source.dbf));
  const shapes = parsePolygonShapefile(readArchiveEntry(source, source.shp));
  if (rows.length !== shapes.length) throw new Error('BKG DBF/SHP record counts differ');
  const byId = new Map();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.GF !== '9') continue;
    const id = DE_IDS[row.AGS];
    if (!id) continue;
    const record = byId.get(id) ?? {
      id,
      // The BKG name (GEN) stays an alias where the English name differs, so data written with it still resolves.
      aliases: DE_NAMES[id] ? [row.AGS, row.GEN] : [row.AGS],
      name: DE_NAMES[id] ?? row.GEN,
      shortName: row.LKZ,
      polygons: [],
    };
    record.polygons.push(...ringsToPolygons(shapes[i]).map(projectUtmPolygon));
    byId.set(id, record);
  }
  const regions = [...byId.values()].sort(compareId);
  if (regions.length !== 16) throw new Error(`BKG Länder selection has ${regions.length} regions, expected 16`);
  return regions;
}

async function loadEu27(source) {
  const membership = JSON.parse(
    await readFile(resolve(REFERENCE_DIR, 'eu27-members-2026-07-24.json'), 'utf8'),
  );
  if (membership.selection !== 'EU member selection' || membership.codes.length !== 27) {
    throw new Error('EU membership table must be a dated 27-code EU member selection');
  }
  return loadNaturalEarth(
    source,
    new Set(membership.codes),
    membership.geometryScope,
    projectRoundedLonLat,
    { mergeInto: CYPRUS_PARTS },
  );
}

async function loadEurope(source) {
  const membership = JSON.parse(
    await readFile(resolve(REFERENCE_DIR, 'europe-members-2026-10-09.json'), 'utf8'),
  );
  if (membership.selection !== 'Europe member selection') {
    throw new Error('Europe membership table must be a dated Europe member selection');
  }
  // One rule for every member: an outline, or a marker when it draws under
  // `markerBelowPx2` (see prepareRegion). No hand-kept marker list.
  return loadNaturalEarth(
    source,
    new Set(membership.codes),
    membership.geometryScope,
    projectRoundedLonLat,
    { classify: true, mergeInto: CYPRUS_PARTS },
  );
}

async function loadDach(source) {
  return loadNaturalEarth(source, new Set(['AT', 'CH', 'DE']));
}

async function loadWorld(source, config) {
  const rows = parseDbf(readArchiveEntry(source, source.dbf));
  const shapes = parsePolygonShapefile(readArchiveEntry(source, source.shp));
  if (rows.length !== shapes.length) throw new Error('Natural Earth world DBF/SHP record counts differ');

  const raw = rows.map((row, index) => ({
    id: naturalEarthId(row),
    row,
    polygons: ringsToPolygons(shapes[index]),
  }));
  const crimeaOwner = raw.find((region) =>
    region.polygons.some((polygon) => pointInPolygon([34.1, 45.2], polygon))
  )?.id;
  if (crimeaOwner !== 'RU') {
    throw new Error(`Natural Earth 5.1.1 Crimea audit resolved to '${crimeaOwner ?? 'none'}', expected RU`);
  }

  // Crimea follows the EU view: the 110m file keeps it as its own
  // ring of RU, so that ring moves to UA, unchanged. Natural Earth 5.1.1 has
  // no 110m point-of-view variant to read it from.
  const russia = raw.find((region) => region.id === 'RU');
  const ukraine = raw.find((region) => region.id === 'UA');
  const crimeaRings = russia.polygons.filter((polygon) => pointInPolygon([34.1, 45.2], polygon));
  if (crimeaRings.length !== 1) throw new Error('Natural Earth 110m Crimea ring audit failed');
  russia.polygons = russia.polygons.filter((polygon) => polygon !== crimeaRings[0]);
  ukraine.polygons.push(crimeaRings[0]);

  const regions = raw.map(({ id, row, polygons }) => ({
    id,
    aliases: uniqueStrings([row.ISO_A2_EH, row.ISO_A2, row.ISO_A3_EH, row.ADM0_A3, row.POSTAL], id),
    name: row.NAME_EN || row.NAME,
    shortName: id,
    geometryClass:
      row.TYPE === 'Disputed' || row.TYPE === 'Indeterminate'
        ? 'disputed-area'
        : 'administrative',
    microState: false,
    polygons: polygons.map((polygon) => projectPolygon(polygon, config.project)),
  }));
  const byId = new Map(regions.map((region) => [region.id, region]));
  for (const [id, geometryClass] of [['XK', 'disputed-area'], ['TW', 'administrative'], ['EH', 'disputed-area']]) {
    const region = byId.get(id);
    if (!region || region.geometryClass !== geometryClass) {
      throw new Error(`Natural Earth 5.1.1 treatment audit failed for ${id}`);
    }
  }

  const tinyRows = parseDbf(readArchiveEntry(SOURCES.ne110Tiny, SOURCES.ne110Tiny.dbf));
  const tinyPoints = parsePointShapefile(readArchiveEntry(SOURCES.ne110Tiny, SOURCES.ne110Tiny.shp));
  if (tinyRows.length !== tinyPoints.length) throw new Error('Natural Earth tiny-country DBF/SHP record counts differ');
  tinyRows.forEach((row, index) => {
    const id = naturalEarthId(row);
    const existing = byId.get(id);
    if (existing) {
      existing.microState = true;
      return;
    }
    const markerPoint = projectPoint(tinyPoints[index], config.project);
    const region = {
      id,
      aliases: uniqueStrings([row.ISO_A2_EH, row.ISO_A2, row.ISO_A3_EH, row.ADM0_A3, row.POSTAL], id),
      name: row.NAME_EN || row.NAME,
      shortName: id,
      geometryClass: 'administrative',
      microState: true,
      polygons: [],
      markerPoint,
    };
    regions.push(region);
    byId.set(id, region);
  });
  regions.sort(compareId);
  // Every ISO alpha-2 place that the 1:10m file has and the 110m files lack
  // (Hong Kong, Macau, Gibraltar, Monaco, Malta ...) joins as a marker-only region.
  // They come AFTER the earlier regions in the pack and in the tile pack's
  // region list, so no earlier record moves.
  const baseCount = regions.length;
  const wideRows = parseDbf(readArchiveEntry(SOURCES.ne10, SOURCES.ne10.dbf));
  const wideShapes = parsePolygonShapefile(readArchiveEntry(SOURCES.ne10, SOURCES.ne10.shp));
  if (wideRows.length !== wideShapes.length) throw new Error('Natural Earth 10m DBF/SHP record counts differ');
  const appended = [];
  wideRows.forEach((row, index) => {
    if (!/^[A-Z]{2}$/.test(row.ISO_A2_EH) || byId.has(row.ISO_A2_EH)) return;
    const region = markerRegionFromRow(row, ringsToPolygons(wideShapes[index]), config.project);
    byId.set(region.id, region);
    appended.push(region);
  });
  appended.sort(compareId);
  regions.push(...appended);
  APPENDED_IDS.set('world', new Set(appended.map((region) => region.id)));
  if (regions.length === baseCount) throw new Error('world pack: no 10m additions found');
  const canonicalRegionIds = new Set(regions.map((region) => region.id));
  for (const region of regions) {
    region.aliases = region.aliases.filter((alias) => !canonicalRegionIds.has(alias));
  }

  const boundaryRows = parseDbf(
    readArchiveEntry(SOURCES.ne110Boundaries, SOURCES.ne110Boundaries.dbf),
  );
  const boundaryShapes = parsePolylineShapefile(
    readArchiveEntry(SOURCES.ne110Boundaries, SOURCES.ne110Boundaries.shp),
  );
  if (boundaryRows.length !== boundaryShapes.length) {
    throw new Error('Natural Earth boundary DBF/SHP record counts differ');
  }
  const boundaries = boundaryRows.flatMap((row, index) =>
    row.FEATURECLA === 'International boundary (verify)'
      ? []
      : [{
          id: `disputed:${row.NE_ID || String(index + 1).padStart(3, '0')}`,
          geometryClass: 'disputed-boundary',
          lines: boundaryShapes[index].map((line) =>
            line.map((point) => projectPoint(point, config.project))
          ),
        }]
  );
  if (boundaries.length === 0) throw new Error('Natural Earth world audit found no disputed boundaries');
  return { regions, boundaries };
}

async function loadUsStates(source, config) {
  const rows = parseDbf(readArchiveEntry(source, source.dbf));
  const shapes = parsePolygonShapefile(readArchiveEntry(source, source.shp));
  if (rows.length !== shapes.length) throw new Error('Census states DBF/SHP record counts differ');
  const territories = new Set(['60', '66', '69', '72', '78']);
  const regions = rows.flatMap((row, index) =>
    territories.has(row.STATEFP)
      ? []
      : [{
          id: `US-${row.STUSPS}`,
          aliases: [row.STUSPS, row.STATEFP],
          name: row.NAME,
          shortName: row.STUSPS,
          geometryClass: 'administrative',
          microState: row.STUSPS === 'DC',
          polygons: ringsToPolygons(shapes[index]).map((polygon) =>
            projectPolygon(polygon, config.project)
          ),
        }]
  ).sort(compareId);
  if (regions.length !== 51 || !regions.some((region) => region.id === 'US-DC')) {
    throw new Error(`Census states selection has ${regions.length} regions, expected 50 states + DC`);
  }
  return regions;
}

/** Natural Earth type to the pack's region class; same rule for world and europe. */
function naturalEarthGeometryClass(row) {
  return row.TYPE === 'Disputed' || row.TYPE === 'Indeterminate' ? 'disputed-area' : 'administrative';
}

/**
 * A marker-only region from a polygon row: no outline, one point at the pole of
 * inaccessibility of the largest polygon. Used for places too small or too
 * scattered to draw at pack scale (Gibraltar, Jersey, Hong Kong ...).
 */
function markerRegionFromRow(row, polygons, project) {
  const id = naturalEarthId(row);
  const largest = polygons
    .map(normalizeWinding)
    .sort((a, b) => Math.abs(ringArea(b[0])) - Math.abs(ringArea(a[0])))[0];
  const label = polylabel(largest, 1e-5);
  return {
    id,
    aliases: uniqueStrings([row.ISO_A2_EH, row.ISO_A2, row.ISO_A3_EH, row.ADM0_A3, row.POSTAL], id),
    name: row.NAME_EN || row.NAME,
    shortName: COUNTRY_SHORT_NAMES[id] ?? id,
    geometryClass: naturalEarthGeometryClass(row),
    microState: true,
    polygons: [],
    markerPoint: projectPoint([label[0], label[1]], project),
  };
}

function loadNaturalEarth(source, selected, geometryScope, project = projectLonLat, { classify = false, mergeInto = {} } = {}) {
  const rows = parseDbf(readArchiveEntry(source, source.dbf));
  const shapes = parsePolygonShapefile(readArchiveEntry(source, source.shp));
  if (rows.length !== shapes.length) throw new Error('Natural Earth DBF/SHP record counts differ');
  // Rows join by code: France and Clipperton share one in the 1:10m files, and
  // `mergeInto` names rows without a code that belong to a member. Each row
  // keeps its own polygons here; the scope filter drops the overseas ones.
  const byId = new Map();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const id = mergeInto[row.ADM0_A3] ?? row.ISO_A2_EH;
    if (!selected.has(id)) continue;
    const polygons = ringsToPolygons(shapes[i]).filter((polygon) =>
      geometryScope ? polygonWithinScope(polygon, geometryScope) : true,
    );
    const entry = byId.get(id) ?? { id, parts: [] };
    entry.parts.push(polygons.map(normalizeWinding));
    if (row.ISO_A2_EH === id) {
      entry.name = row.NAME_EN || row.NAME;
      entry.shortName = COUNTRY_SHORT_NAMES[id] ?? row.NAME;
      if (classify) entry.geometryClass = naturalEarthGeometryClass(row);
    }
    byId.set(id, entry);
  }
  const regions = [...byId.values()].filter((entry) => entry.name !== undefined).map((entry) => {
    // Parts that share a border dissolve into one outline (no line across the island).
    const polygons = entry.parts.length > 1 ? dissolvePolygons(entry.parts) : entry.parts[0];
    return {
      id: entry.id,
      aliases: [],
      name: entry.name,
      shortName: entry.shortName,
      ...(entry.geometryClass ? { geometryClass: entry.geometryClass } : {}),
      polygons: polygons.map((polygon) => polygon.map((ring) => ring.map(project))),
    };
  }).sort(compareId);
  if (regions.length !== selected.size) {
    const missing = [...selected].filter((id) => !regions.some((region) => region.id === id));
    throw new Error(`Natural Earth selection missing ${missing.join(', ')}`);
  }
  return regions;
}

/** Union of polygon lists that touch along identical vertices (one source file, so they do). */
function dissolvePolygons(parts) {
  const features = parts.map((polygons, index) => ({
    type: 'Feature',
    id: index,
    properties: {},
    geometry: { type: 'MultiPolygon', coordinates: polygons },
  }));
  const joined = topology({ parts: { type: 'FeatureCollection', features } });
  return topoMerge(joined, joined.objects.parts.geometries).coordinates;
}

function naturalEarthId(row) {
  return row.ISO_A2_EH && row.ISO_A2_EH !== '-99' ? row.ISO_A2_EH : row.ADM0_A3;
}

function uniqueStrings(values, canonical) {
  return [...new Set(values.filter((value) => value && value !== '-99' && value !== canonical))];
}

function polygonWithinScope(polygon, scope) {
  const bounds = boundsOfRings(polygon);
  const centerLon = (bounds[0] + bounds[2]) / 2;
  const centerLat = (bounds[1] + bounds[3]) / 2;
  return (
    centerLon >= scope.longitude[0] &&
    centerLon <= scope.longitude[1] &&
    centerLat >= scope.latitude[0] &&
    centerLat <= scope.latitude[1]
  );
}

function boundsOfRings(rings) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const point of ring) {
      minX = Math.min(minX, point[0]);
      minY = Math.min(minY, point[1]);
      maxX = Math.max(maxX, point[0]);
      maxY = Math.max(maxY, point[1]);
    }
  }
  return [minX, minY, maxX, maxY];
}

function buildPack(config, input) {
  const rawRegions = input.regions;
  const rawBoundaries = input.boundaries;
  const rawBounds = boundsOfRegions(rawRegions);
  const span = Math.max(rawBounds[2] - rawBounds[0], rawBounds[3] - rawBounds[1]);
  const canonicalSpan = Math.max(config.canonicalSize[0], config.canonicalSize[1]);
  const pxScale = canonicalSpan / span;
  const prepared = rawRegions.map((region) =>
    prepareRegion(region, pxScale, config.anchorPrecision, config.markerBelowPx2),
  );
  if (config.spreadMarkers) spreadMarkers(config, prepared, pxScale);
  const polygonFeatures = prepared
    .filter((region) => region.polygons.length > 0)
    .map((region) => ({
      type: 'Feature',
      id: region.id,
      properties: { id: region.id },
      geometry: {
        type: region.polygons.length === 1 ? 'Polygon' : 'MultiPolygon',
        coordinates: region.polygons.length === 1 ? region.polygons[0] : region.polygons,
      },
    }));
  const boundaryFeatures = rawBoundaries.map((boundary) => ({
    type: 'Feature',
    id: boundary.id,
    properties: { id: boundary.id, geometryClass: boundary.geometryClass },
    geometry: {
      type: boundary.lines.length === 1 ? 'LineString' : 'MultiLineString',
      coordinates: boundary.lines.length === 1 ? boundary.lines[0] : boundary.lines,
    },
  }));
  const collection = { type: 'FeatureCollection', features: polygonFeatures };
  const topologyInput = { regions: collection };
  if (boundaryFeatures.length > 0) {
    topologyInput.boundaries = { type: 'FeatureCollection', features: boundaryFeatures };
  }
  const unsimplified = topology(topologyInput, QUANTIZATION);
  const simplified = chooseSimplification(
    unsimplified,
    rawBounds,
    config.maximizeSimplification ?? false,
    config.displacementLimitPx,
    config.simplifyCandidates,
  );
  const objectFeatures = topoFeature(simplified.topology, simplified.topology.objects.regions);
  const geometries = new Map(
    objectFeatures.features.map((item) => [item.id ?? item.properties.id, item]),
  );
  const topologyObjects = new Map(
    simplified.topology.objects.regions.geometries.map((geometry) => [
      geometry.id ?? geometry.properties.id,
      geometry,
    ]),
  );

  const packRegions = prepared.map((region) => {
    const geometry = topologyObjects.get(region.id);
    const polygons =
      geometry?.type === 'Polygon'
        ? [geometry.arcs]
        : geometry?.type === 'MultiPolygon'
          ? geometry.arcs
          : [];
    if (region.polygons.length > 0 && !geometries.has(region.id)) {
      throw new Error(`${config.id}/${region.id}: topology lost a polygon region`);
    }
    return {
      id: region.id,
      aliases: region.aliases,
      polygons,
      anchor: region.anchor,
      ...(region.geometryClass !== 'administrative' ? { geometryClass: region.geometryClass } : {}),
      ...(region.microState ? { microState: true } : {}),
      ...(region.marker ? { marker: region.marker } : {}),
    };
  });
  const packBoundaries = rawBoundaries.map((boundary) => {
    const object = simplified.topology.objects.boundaries;
    const geometry = object?.geometries.find((candidate) =>
      (candidate.id ?? candidate.properties.id) === boundary.id
    );
    const lines =
      geometry?.type === 'LineString'
        ? [geometry.arcs]
        : geometry?.type === 'MultiLineString'
          ? geometry.arcs
          : [];
    if (lines.length === 0) throw new Error(`${config.id}/${boundary.id}: topology lost a boundary`);
    return { id: boundary.id, geometryClass: boundary.geometryClass, lines };
  });

  assertRegionIdentity(`${config.id} pack`, config.id, packRegions);

  const transform = simplified.topology.transform;
  if (!transform) throw new Error(`${config.id}: quantized topology has no transform`);
  const pack = {
    id: config.id,
    canonicalSize: config.canonicalSize,
    bounds: rawBounds,
    transform: {
      scale: transform.scale,
      translate: transform.translate,
    },
    arcs: packTopologyArcs(simplified.topology.arcs),
    regions: packRegions,
    ...(packBoundaries.length > 0 ? { boundaries: packBoundaries } : {}),
    meta: {
      source: config.sourceName,
      sourceUrl: config.source.url,
      sourceVersion: config.sourceVersion,
      sourceSha256: config.source.sha256,
      license: config.license,
      attribution: config.attribution,
      credit: config.credit,
      projection: config.projection ?? 'laea-europe-epsg3035-equivalent',
      projectionCenter:
        Object.hasOwn(config, 'projectionCenter') ? config.projectionCenter : [10, 52],
      ...(config.projectionRotation ? { projectionRotation: config.projectionRotation } : {}),
      ...(config.projectionScale ? { projectionScale: config.projectionScale } : {}),
      ...(config.projectionTranslate ? { projectionTranslate: config.projectionTranslate } : {}),
      quantization: QUANTIZATION,
      worldview: config.worldview,
      disputes: {
        status: config.disputesStatus ?? 'not-triggered',
        geometryClasses: ['administrative', 'disputed-boundary', 'disputed-area'],
        disputedLayerVersion: config.disputedLayerVersion,
        ...(config.disputedLayerSourceSha256
          ? { disputedLayerSourceSha256: config.disputedLayerSourceSha256 }
          : {}),
        ...(config.disputeTreatments ? { treatments: config.disputeTreatments } : {}),
      },
      ...(config.chartNote ? { chartNote: config.chartNote } : {}),
      ...(config.borderNote ? { borderNote: config.borderNote } : {}),
      ...(config.insetScaleNote ? { insetScaleNote: config.insetScaleNote } : {}),
      ...(config.scopeNote ? { scopeNote: config.scopeNote } : {}),
      ...(config.displacementLimitPx ? { displacementLimitPx800: config.displacementLimitPx } : {}),
      packRev: 1,
      hash: '',
      maxBoundaryDisplacementPx800: round6(simplified.displacementPx),
      rasterDiffPixels800: simplified.rasterDiffPixels,
      rasterDiffRate800: round6(simplified.rasterDiffRate),
    },
  };
  pack.meta.hash = sha256(JSON.stringify(pack));
  const source =
    `import type {GeoPack} from '../types';` +
    `export const ${config.exportName}=${JSON.stringify(pack)} as const satisfies GeoPack;\n`;
  return { pack, source };
}

/**
 * Two marker dots may not overlap (a hidden dot is a hidden value). Markers that
 * sit closer than MARKER_MIN_GAP_PX are pushed apart along the line between
 * them, in a fixed order, until none touch. In the world pack only the
 * newer places move, so the older markers stay where they are; every marker
 * moves in the europe pack. The anchor follows its marker.
 */
function spreadMarkers(config, prepared, pxScale) {
  const appended = APPENDED_IDS.get(config.id);
  const markers = prepared.filter((region) => region.marker);
  const movable = markers.filter((region) => !appended || appended.has(region.id)).sort(compareId);
  const minGap = MARKER_MIN_GAP_PX / pxScale;
  const shift = (region, dx, dy) => {
    for (const point of [region.anchor, region.marker]) {
      point.x += dx;
      point.y += dy;
    }
  };
  for (let round = 0; round < 1000; round++) {
    let moved = false;
    for (const mover of movable) {
      for (const other of markers) {
        if (other === mover) continue;
        let dx = mover.marker.x - other.marker.x;
        let dy = mover.marker.y - other.marker.y;
        let distance = Math.hypot(dx, dy);
        if (distance >= minGap) continue;
        if (distance === 0) {
          dx = 1;
          dy = 0;
          distance = 1;
        }
        const push = (minGap - distance) * (movable.includes(other) ? 0.5 : 1) + 1e-9;
        const [ux, uy] = [dx / distance, dy / distance];
        shift(mover, ux * push, uy * push);
        if (movable.includes(other)) shift(other, -ux * push, -uy * push);
        moved = true;
      }
    }
    if (!moved) break;
  }
  for (const region of movable) {
    for (const point of [region.anchor, region.marker]) {
      point.x = roundTo(point.x, config.anchorPrecision);
      point.y = roundTo(point.y, config.anchorPrecision);
    }
  }
  for (const a of markers) {
    for (const b of markers) {
      if (a.id < b.id && (movable.includes(a) || movable.includes(b)) && Math.hypot(a.marker.x - b.marker.x, a.marker.y - b.marker.y) < minGap * 0.99) {
        throw new Error(`${config.id}: markers ${a.id} and ${b.id} still overlap after spreading`);
      }
    }
  }
}

function prepareRegion(region, pxScale, anchorPrecision, markerBelowPx2 = 0) {
  const originalPolygons = region.polygons.map(normalizeWinding);
  let bestAnchor = null;
  for (const polygon of originalPolygons) {
    const candidate = polylabel(polygon, 0.1 / pxScale);
    if (!bestAnchor || candidate.distance > bestAnchor.distance) bestAnchor = candidate;
  }
  if (!bestAnchor && !region.markerPoint) throw new Error(`${region.id}: cannot compute label anchor`);

  const polygons = [];
  for (const polygon of originalPolygons) {
    const outerAreaPx = Math.abs(ringArea(polygon[0])) * pxScale * pxScale;
    if (outerAreaPx < TINY_RING_AREA_PX2) continue;
    const rings = [polygon[0]];
    for (const hole of polygon.slice(1)) {
      if (Math.abs(ringArea(hole)) * pxScale * pxScale >= TINY_RING_AREA_PX2) rings.push(hole);
    }
    polygons.push(rings);
  }

  // A region that would draw smaller than markerBelowPx2 on the canvas is a
  // marker, like a region whose rings were all dropped above.
  const drawnAreaPx2 = polygons.reduce(
    (sum, polygon) => sum + Math.abs(ringArea(polygon[0])) * pxScale * pxScale,
    0,
  );
  if (polygons.length > 0 && drawnAreaPx2 < markerBelowPx2) polygons.length = 0;

  const anchorPoint = bestAnchor ?? {
    0: region.markerPoint[0],
    1: region.markerPoint[1],
    distance: 2.5 / pxScale,
  };
  const clearancePx = anchorPoint.distance * pxScale;
  const markerOnly = polygons.length === 0 || Boolean(region.markerPoint);
  const leader = markerOnly || clearancePx < 8;
  const canonicalAnchor = (value) => roundTo(value, anchorPrecision);
  return {
    id: region.id,
    aliases: region.aliases,
    polygons,
    geometryClass: region.geometryClass ?? 'administrative',
    microState: Boolean(region.microState || markerOnly),
    anchor: {
      x: canonicalAnchor(anchorPoint[0]),
      y: canonicalAnchor(anchorPoint[1]),
      clearance: canonicalAnchor(anchorPoint.distance),
      name: region.name,
      shortName: region.shortName,
      fontTier: clearancePx >= 20 ? 0 : clearancePx >= 10 ? 1 : 2,
      leader,
    },
    ...(markerOnly
      ? {
          marker: {
            x: canonicalAnchor(anchorPoint[0]),
            y: canonicalAnchor(anchorPoint[1]),
            radius: canonicalAnchor(2.5 / pxScale),
          },
        }
      : {}),
  };
}

function buildTilePack(config, geoPack) {
  const layout = parseTileLayout(config.id, TILE_LAYOUTS[config.id]);
  const regionsById = new Map(geoPack.regions.map((region) => [region.id, region]));
  const laidOut = new Set();
  for (const { id } of layout.cells) {
    if (!regionsById.has(id)) throw new Error(`${config.id} tile layout: unknown region ${id}`);
    if (laidOut.has(id)) throw new Error(`${config.id} tile layout: ${id} is placed twice`);
    laidOut.add(id);
  }
  const unplaced = geoPack.regions.filter((region) => !laidOut.has(region.id)).map((region) => region.id);
  if (unplaced.length > 0) {
    throw new Error(`${config.id} tile layout: no tile for ${unplaced.join(', ')}; place it in scripts/tile-layouts.mjs`);
  }
  const placed = layout.cells.map(({ id, row, col }) => {
    const region = regionsById.get(id);
    return { id, aliases: region.aliases, name: region.anchor.name, shortName: region.anchor.shortName, row, col };
  });
  const appended = APPENDED_IDS.get(config.sourcePack) ?? new Set();
  placed.sort((a, b) => Number(appended.has(a.id)) - Number(appended.has(b.id)) || compareId(a, b));
  assertRegionIdentity(`${config.id} tile pack`, config.id, placed);

  const geographicAdjacencies = geographicAdjacencyPairs(geoPack);
  const faults = tileLayoutFaults(
    placed.map((cell) => ({ ...cell, x: regionsById.get(cell.id).anchor.x, y: regionsById.get(cell.id).anchor.y })),
    geographicAdjacencies,
  );
  if (faults.length > 0) {
    throw new Error(
      `${config.id} tile layout: neighbours in the wrong place: ` +
        faults.map((f) => (f.kind === 'direction' ? `${f.b} lies ${f.geo} of ${f.a}, tile ${f.tile}` : `${f.a}|${f.b} touch but are far apart`)).join('; '),
    );
  }
  const tileAdjacencies = tileAdjacencyPairs(placed);
  const geographicKeys = new Set(geographicAdjacencies.map(adjacencyKey));
  const tileKeys = new Set(tileAdjacencies.map(adjacencyKey));
  const adjacencyExceptions = [
    ...geographicAdjacencies.flatMap((pair) =>
      tileKeys.has(adjacencyKey(pair)) ? [] : [{ ...pair, kind: 'missing' }]
    ),
    ...tileAdjacencies.flatMap((pair) =>
      geographicKeys.has(adjacencyKey(pair)) ? [] : [{ ...pair, kind: 'extra' }]
    ),
  ].sort((a, b) =>
    compareText(a.kind, b.kind) || compareText(a.a, b.a) || compareText(a.b, b.b)
  );
  const pack = {
    id: config.id,
    rows: layout.rows,
    cols: layout.cols,
    regions: placed,
    geographicAdjacencies,
    meta: {
      layoutAuthor: 'Boardplot',
      layoutSource: 'Boardplot original',
      layoutSourceUrl:
        'https://github.com/boardplot/boardplot/blob/main/scripts/build-geo-packs.mjs',
      layoutVersion: 'G3-2026-10-25',
      license: 'Boardplot project license',
      memberDate: config.memberDate,
      sourcePack: config.sourcePack,
      attribution:
        `Boardplot original ${config.id} tile layout; hand-authored and checked against the pinned ${geoPack.meta.source} anchors.`,
      adjacencyExceptions,
    },
  };
  const exportName = `${config.id.replace(/-/g, '_').toUpperCase()}_TILE_PACK`;
  const source =
    `import type {TilePack} from './types';` +
    `export const ${exportName}=${tilePackLiteral(pack)} as const satisfies TilePack;\n`;
  return { pack, source };
}

/** Compact world storage; expansion preserves the exported records and key order. */
function tilePackLiteral(pack) {
  const literal = JSON.stringify(pack);
  if (pack.id !== 'world') return literal;
  let source = literal;
  if (pack.regions.every((region) => region.shortName === region.id)) {
    const rows = pack.regions.map(({ id, aliases, name, row, col }) => [id, aliases, name, row, col]);
    const regions = `(${JSON.stringify(rows)} as const).map(([id,aliases,name,row,col])=>({id,aliases,name,shortName:id,row,col} as const))`;
    source = source.replace(`"regions":${JSON.stringify(pack.regions)}`, `"regions":${regions}`);
  }
  const pairs = pack.meta.adjacencyExceptions.map(({ a, b, kind }) => [a, b, kind]);
  const exceptions = `(${JSON.stringify(pairs)} as const).map(([a,b,kind])=>({a,b,kind} as const))`;
  return source.replace(`"adjacencyExceptions":${JSON.stringify(pack.meta.adjacencyExceptions)}`, `"adjacencyExceptions":${exceptions}`);
}

function geographicAdjacencyPairs(pack) {
  const regionsByArc = new Map();
  for (const region of pack.regions) {
    for (const polygon of region.polygons) {
      for (const ring of polygon) {
        for (const ref of ring) {
          const index = ref < 0 ? ~ref : ref;
          const ids = regionsByArc.get(index) ?? new Set();
          ids.add(region.id);
          regionsByArc.set(index, ids);
        }
      }
    }
  }
  const pairs = new Map();
  for (const ids of regionsByArc.values()) {
    const ordered = [...ids].sort(compareText);
    for (let first = 0; first < ordered.length; first++) {
      for (let second = first + 1; second < ordered.length; second++) {
        const pair = { a: ordered[first], b: ordered[second] };
        pairs.set(adjacencyKey(pair), pair);
      }
    }
  }
  return [...pairs.values()].sort(
    (a, b) => compareText(a.a, b.a) || compareText(a.b, b.b),
  );
}

function tileAdjacencyPairs(regions) {
  const at = new Map(regions.map((region) => [`${region.row}:${region.col}`, region.id]));
  const pairs = new Map();
  for (const region of regions) {
    for (const [dr, dc] of [[0, 1], [1, 0]]) {
      const other = at.get(`${region.row + dr}:${region.col + dc}`);
      if (!other) continue;
      const [a, b] = [region.id, other].sort(compareText);
      const pair = { a, b };
      pairs.set(adjacencyKey(pair), pair);
    }
  }
  return [...pairs.values()].sort(
    (a, b) => compareText(a.a, b.a) || compareText(a.b, b.b),
  );
}

function adjacencyKey(pair) {
  return `${pair.a}|${pair.b}`;
}

function chooseSimplification(unsimplified, bounds, maximize, limitPx = DISPLACEMENT_LIMIT_PX, candidatesOverride) {
  const weighted = maximize ? null : presimplify(unsimplified, planarTriangleArea);
  const candidates = candidatesOverride ?? [
    0.001, 0.002, 0.005, 0.01, 0.02, 0.03, 0.05, 0.08, 0.1, 0.15, 0.2,
    0.3, 0.4, 0.5, 0.65, 0.8, 0.9, 0.97, 0.99, 0.995, 0,
  ];
  const span = Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]);
  let fallback = null;
  for (const p of candidates) {
    const candidateWeighted = maximize
      ? presimplify(structuredClone(unsimplified), planarTriangleArea)
      : weighted;
    const threshold = p === 0 ? 0 : quantile(candidateWeighted, p);
    const candidate = simplify(candidateWeighted, threshold);
    const finalTopology = quantizeTopology(candidate, unsimplified.transform);
    const displacement =
      maxArcDisplacement(unsimplified, finalTopology) * (CANONICAL_PX / span);
    const rasterDiff = rasterRegionDiff(unsimplified, finalTopology, bounds);
    fallback = {
      topology: finalTopology,
      displacementPx: displacement,
      rasterDiffPixels: rasterDiff.pixels,
      rasterDiffRate: rasterDiff.rate,
    };
    if (
      (!maximize || p !== 0) &&
      displacement <= (maximize || limitPx !== DISPLACEMENT_LIMIT_PX ? limitPx : TARGET_DISPLACEMENT_PX) &&
      rasterDiff.rate <= RASTER_DIFF_LIMIT
    ) {
      return fallback;
    }
  }
  if (
    !fallback ||
    fallback.displacementPx > limitPx ||
    fallback.rasterDiffRate > RASTER_DIFF_LIMIT
  ) {
    throw new Error(
      `simplification gates failed: displacement=${fallback?.displacementPx ?? 'unknown'}px ` +
      `(limit ${limitPx}), raster=${fallback?.rasterDiffPixels ?? 'unknown'}px/` +
      `${fallback?.rasterDiffRate ?? 'unknown'} (limit ${RASTER_DIFF_LIMIT})`,
    );
  }
  return fallback;
}

function rasterRegionDiff(original, simplifiedTopology, bounds) {
  const before = rasterizeBoundaries(original, bounds);
  const after = rasterizeBoundaries(simplifiedTopology, bounds);
  let pixels = 0;
  let beforePixels = 0;
  let afterPixels = 0;
  for (let index = 0; index < before.length; index++) {
    if (before[index] !== 0) beforePixels++;
    if (after[index] !== 0) afterPixels++;
    if (before[index] !== 0 && !rasterHasNeighbor(after, index)) pixels++;
    if (after[index] !== 0 && !rasterHasNeighbor(before, index)) pixels++;
  }
  const compared = beforePixels + afterPixels;
  return { pixels, rate: compared === 0 ? 0 : pixels / compared, beforePixels, afterPixels };
}

function rasterizeBoundaries(inputTopology, bounds) {
  const raster = new Uint8Array(CANONICAL_PX * CANONICAL_PX);
  const span = Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]);
  const scale = (CANONICAL_PX - 2) / span;
  const offsetX = 1 + (CANONICAL_PX - 2 - (bounds[2] - bounds[0]) * scale) / 2;
  const offsetY = 1 + (CANONICAL_PX - 2 - (bounds[3] - bounds[1]) * scale) / 2;
  for (const arc of inputTopology.arcs) {
    const decoded = decodeTopologyArc(arc, inputTopology.transform).map((point) => [
      (point[0] - bounds[0]) * scale + offsetX,
      (point[1] - bounds[1]) * scale + offsetY,
    ]);
    for (let index = 1; index < decoded.length; index++) {
      const a = decoded[index - 1];
      const b = decoded[index];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
      for (let step = 0; step <= steps; step++) {
        const t = step / steps;
        const x = Math.max(0, Math.min(CANONICAL_PX - 1, Math.round(a[0] + dx * t)));
        const y = Math.max(0, Math.min(CANONICAL_PX - 1, Math.round(a[1] + dy * t)));
        raster[y * CANONICAL_PX + x] = 1;
      }
    }
  }
  return raster;
}

function rasterHasNeighbor(raster, index) {
  const x = index % CANONICAL_PX;
  const y = Math.floor(index / CANONICAL_PX);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (
        nx >= 0 &&
        nx < CANONICAL_PX &&
        ny >= 0 &&
        ny < CANONICAL_PX &&
        raster[ny * CANONICAL_PX + nx] !== 0
      ) {
        return true;
      }
    }
  }
  return false;
}

function maxArcDisplacement(original, simplifiedTopology) {
  let max = 0;
  for (let i = 0; i < original.arcs.length; i++) {
    const source = decodeTopologyArc(original.arcs[i], original.transform);
    const target = decodeTopologyArc(simplifiedTopology.arcs[i], simplifiedTopology.transform);
    for (const point of source) {
      let nearest = Infinity;
      for (let j = 1; j < target.length; j++) {
        const distance = pointSegmentDistance(point, target[j - 1], target[j]);
        if (distance < nearest) nearest = distance;
      }
      if (nearest > max) max = nearest;
    }
  }
  return max;
}

function decodeTopologyArc(arc, transform) {
  if (!transform) return arc.map((point) => [point[0], point[1]]);
  let x = 0;
  let y = 0;
  return arc.map((point) => {
    x += point[0];
    y += point[1];
    return [
      x * transform.scale[0] + transform.translate[0],
      y * transform.scale[1] + transform.translate[1],
    ];
  });
}

function pointSegmentDistance(point, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(point[0] - a[0], point[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
}

function readArchiveEntry(source, entry) {
  const archive = resolve(REFERENCE_DIR, source.file);
  const result = spawnSync('unzip', ['-p', archive, entry], {
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${source.file}/${entry}: unzip failed: ${String(result.stderr)}`);
  }
  return result.stdout;
}

function parseDbf(buffer) {
  const count = buffer.readUInt32LE(4);
  const headerLength = buffer.readUInt16LE(8);
  const recordLength = buffer.readUInt16LE(10);
  const fields = [];
  for (let offset = 32; offset < headerLength - 1; offset += 32) {
    if (buffer[offset] === 0x0d) break;
    fields.push({
      name: buffer.subarray(offset, offset + 11).toString('ascii').replace(/\0.*$/u, '').trim(),
      length: buffer[offset + 16],
    });
  }
  const rows = [];
  for (let index = 0; index < count; index++) {
    const start = headerLength + index * recordLength;
    if (buffer[start] === 0x2a) continue;
    let offset = start + 1;
    const row = {};
    for (const field of fields) {
      row[field.name] = buffer
        .subarray(offset, offset + field.length)
        .toString('utf8')
        .replace(/\0/g, '')
        .trim();
      offset += field.length;
    }
    rows.push(row);
  }
  return rows;
}

function parsePartShapefile(buffer, expectedType, label) {
  if (buffer.readInt32BE(0) !== 9994 || buffer.readInt32LE(32) !== expectedType) {
    throw new Error(`expected a ${label} shapefile`);
  }
  const records = [];
  let recordOffset = 100;
  while (recordOffset + 8 <= buffer.length) {
    const byteLength = buffer.readUInt32BE(recordOffset + 4) * 2;
    const offset = recordOffset + 8;
    if (offset + byteLength > buffer.length) throw new Error('truncated shapefile record');
    const shapeType = buffer.readInt32LE(offset);
    if (shapeType !== expectedType) throw new Error(`unsupported shapefile record type ${shapeType}`);
    const partCount = buffer.readUInt32LE(offset + 36);
    const pointCount = buffer.readUInt32LE(offset + 40);
    const parts = Array.from({ length: partCount }, (_, index) =>
      buffer.readUInt32LE(offset + 44 + index * 4),
    );
    const pointsOffset = offset + 44 + partCount * 4;
    const points = Array.from({ length: pointCount }, (_, index) => [
      buffer.readDoubleLE(pointsOffset + index * 16),
      buffer.readDoubleLE(pointsOffset + index * 16 + 8),
    ]);
    records.push(
      parts.map((start, index) => points.slice(start, parts[index + 1] ?? points.length)),
    );
    recordOffset = offset + byteLength;
  }
  return records;
}

function parsePolygonShapefile(buffer) {
  return parsePartShapefile(buffer, 5, 'polygon');
}

function parsePolylineShapefile(buffer) {
  return parsePartShapefile(buffer, 3, 'polyline');
}

function parsePointShapefile(buffer) {
  if (buffer.readInt32BE(0) !== 9994 || buffer.readInt32LE(32) !== 1) {
    throw new Error('expected a point shapefile');
  }
  const records = [];
  let recordOffset = 100;
  while (recordOffset + 8 <= buffer.length) {
    const byteLength = buffer.readUInt32BE(recordOffset + 4) * 2;
    const offset = recordOffset + 8;
    if (offset + byteLength > buffer.length) throw new Error('truncated shapefile record');
    const shapeType = buffer.readInt32LE(offset);
    if (shapeType !== 1) throw new Error(`unsupported shapefile record type ${shapeType}`);
    records.push([buffer.readDoubleLE(offset + 4), buffer.readDoubleLE(offset + 12)]);
    recordOffset = offset + byteLength;
  }
  return records;
}

function ringsToPolygons(rings) {
  const ordered = rings
    .map((ring) => closeRing(ring))
    .filter((ring) => ring.length >= 4)
    .sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
  const nodes = [];
  ordered.forEach((ring, index) => {
    let parent = -1;
    let parentArea = Infinity;
    for (let candidate = 0; candidate < index; candidate++) {
      const area = Math.abs(ringArea(ordered[candidate]));
      if (area < parentArea && pointInRing(ring[0], ordered[candidate])) {
        parent = candidate;
        parentArea = area;
      }
    }
    const depth = parent < 0 ? 0 : nodes[parent].depth + 1;
    nodes.push({ ring, parent, depth });
  });
  const polygons = [];
  const polygonByOuter = new Map();
  nodes.forEach((node, index) => {
    if (node.depth % 2 === 0) {
      const polygon = [node.ring];
      polygonByOuter.set(index, polygon);
      polygons.push(polygon);
      return;
    }
    let outer = node.parent;
    while (outer >= 0 && nodes[outer].depth % 2 !== 0) outer = nodes[outer].parent;
    polygonByOuter.get(outer)?.push(node.ring);
  });
  return polygons;
}

function normalizeWinding(polygon) {
  return polygon.map((ring, index) => {
    const shouldBePositive = index === 0;
    const positive = ringArea(ring) > 0;
    return positive === shouldBePositive ? ring : ring.slice().reverse();
  });
}

function closeRing(ring) {
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
}

function ringArea(ring) {
  let sum = 0;
  for (let i = 1; i < ring.length; i++) {
    sum += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1];
  }
  return sum / 2;
}

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (
      (a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygon(point, polygon) {
  return pointInRing(point, polygon[0]) &&
    polygon.slice(1).every((hole) => !pointInRing(point, hole));
}

function projectLonLat(point) {
  return projectEurope(point);
}

function projectRoundedLonLat(point) {
  return projectEurope(point).map((coordinate) => roundTo(coordinate, 12));
}

function projectEurope(point) {
  return projectPoint(point, laea);
}

function projectWorld(point) {
  // Natural Earth splits rings at the antimeridian but stores some of those
  // vertices a float step past it (Wrangel Island at 180.00000000000003). d3
  // wraps such a vertex to the other edge of the map, and the ring then draws
  // a hairline across the whole world. Clamped, every ring stays on
  // its own side of the antimeridian.
  return projectPoint([Math.max(-180, Math.min(180, point[0])), point[1]], equalEarth);
}

function projectUs(point) {
  return projectPoint(point, albersUsa);
}

function projectPoint(point, projection) {
  const projected = projection(point);
  if (!projected) throw new Error(`projection rejected ${point.join(',')}`);
  return projected;
}

function projectPolygon(polygon, projection) {
  return polygon.map((ring) => ring.map((point) => projectPoint(point, projection)));
}

function projectUtmPolygon(polygon) {
  return polygon.map((ring) => ring.map((point) => projectLonLat(inverseUtm32(point))));
}

function inverseUtm32(point) {
  const a = 6378137;
  const eccentricitySquared = 0.0066943800229;
  const k0 = 0.9996;
  const x = point[0] - 500000;
  const y = point[1];
  const eccentricityPrimeSquared = eccentricitySquared / (1 - eccentricitySquared);
  const m = y / k0;
  const mu =
    m /
    (a *
      (1 -
        eccentricitySquared / 4 -
        (3 * eccentricitySquared ** 2) / 64 -
        (5 * eccentricitySquared ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - eccentricitySquared)) / (1 + Math.sqrt(1 - eccentricitySquared));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const n1 = a / Math.sqrt(1 - eccentricitySquared * Math.sin(phi1) ** 2);
  const t1 = Math.tan(phi1) ** 2;
  const c1 = eccentricityPrimeSquared * Math.cos(phi1) ** 2;
  const r1 =
    (a * (1 - eccentricitySquared)) /
    (1 - eccentricitySquared * Math.sin(phi1) ** 2) ** 1.5;
  const d = x / (n1 * k0);
  const lat =
    phi1 -
    ((n1 * Math.tan(phi1)) / r1) *
      (d ** 2 / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * eccentricityPrimeSquared) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * eccentricityPrimeSquared - 3 * c1 ** 2) *
          d ** 6) /
          720);
  const lon =
    (d -
      ((1 + 2 * t1 + c1) * d ** 3) / 6 +
      ((5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * eccentricityPrimeSquared + 24 * t1 ** 2) *
        d ** 5) /
        120) /
      Math.cos(phi1);
  return [(lon * 180) / Math.PI + 9, (lat * 180) / Math.PI];
}

function boundsOfRegions(regions) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const region of regions) {
    if (region.markerPoint) {
      minX = Math.min(minX, region.markerPoint[0]);
      minY = Math.min(minY, region.markerPoint[1]);
      maxX = Math.max(maxX, region.markerPoint[0]);
      maxY = Math.max(maxY, region.markerPoint[1]);
    }
    for (const polygon of region.polygons) {
      for (const ring of polygon) {
        for (const point of ring) {
          minX = Math.min(minX, point[0]);
          minY = Math.min(minY, point[1]);
          maxX = Math.max(maxX, point[0]);
          maxY = Math.max(maxY, point[1]);
        }
      }
    }
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) throw new Error('empty geographic bounds');
  return [minX, minY, maxX, maxY];
}

function compareId(a, b) {
  return compareText(a.id, b.id);
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function packTopologyArcs(arcs) {
  const bytes = [];
  const writeVarint = (signed) => {
    let value = signed < 0 ? -signed * 2 - 1 : signed * 2;
    while (value >= 0x80) {
      bytes.push((value % 0x80) + 0x80);
      value = Math.floor(value / 0x80);
    }
    bytes.push(value);
  };
  for (const arc of arcs) {
    for (const point of arc) {
      writeVarint(point[0]);
      writeVarint(point[1]);
    }
  }
  return {
    encoding: 'delta-zigzag-varint-base64',
    lengths: arcs.map((arc) => arc.length),
    data: Buffer.from(bytes).toString('base64'),
  };
}

function sha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}

function roundTo(value, digits) {
  if (digits === undefined) return value;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
