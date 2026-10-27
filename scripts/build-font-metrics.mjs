#!/usr/bin/env node
/**
 * Generate src/core/fontMetrics/tables.generated.ts from free fonts (Geist,
 * Liberation Sans, STIX; all SIL OFL 1.1). Advance widths (hmtx) and the vertical metrics of each
 * face are read with fontkit and written as compact tables; the engine
 * measures text from these tables instead of guessing by character class.
 *
 *   node scripts/build-font-metrics.mjs            write the tables
 *   node scripts/build-font-metrics.mjs --check    exit 1 when the file drifts
 *
 * The tables are committed, so consumers never need the fonts. Widths are
 * stored in 1/1000 em for the code points listed in RANGES and EXTRA; a code
 * point the face does not cover is stored as 0 and the measurer falls back to
 * its character-class model for that glyph.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'src', 'core', 'fontMetrics', 'tables.generated.ts');

const GEIST_DIR = join(here, '..', 'node_modules', '@fontsource', 'geist', 'files');
// Liberation Sans as LibreOffice ships it; BOARDPLOT_LIBERATION_DIR points elsewhere.
const LIBERATION_DIR = process.env.BOARDPLOT_LIBERATION_DIR
  ?? '/Applications/LibreOffice.app/Contents/Resources/fonts/truetype';
const HELVETICA_ARROWS = [0x2190, 0x2191, 0x2192, 0x2193];
const HELVETICA_MISSING = [0x25b2, 0x25bc, 0x25cb];

/**
 * Faces the engine ships tables for. `pick` selects one font of a
 * collection. Only faces with a free licence may be listed:
 * a licensed commercial face gets its tables from `boardplot fonts build`.
 */
const FACES = [
  // Geist (OFL) is a free grotesque; fontkit reads
  // the woff2 @fontsource ships, so no extra decoding step is needed.
  { family: 'Geist', weight: 400, file: join(GEIST_DIR, 'geist-latin-400-normal.woff2') },
  { family: 'Geist', weight: 500, file: join(GEIST_DIR, 'geist-latin-500-normal.woff2') },
  { family: 'Geist', weight: 600, file: join(GEIST_DIR, 'geist-latin-600-normal.woff2') },
  // Helvetica and Arial: Liberation Sans 2.1.5 (SIL OFL 1.1), metric-compatible
  // with Arial; Helvetica shares Arial's ASCII widths. No free Helvetica Neue
  // exists: the engine measures it with the Helvetica rows
  // (BUNDLED_STAND_INS in src/core/fontMetrics/index.ts). capHeight keeps the
  // published cap height of each family, so label baselines do not move.
  // Helvetica as installed has no arrows and no ▲ ▼ ○: the arrows stay
  // borrowed, so the PNG renderer keeps drawing them from the fallback family,
  // and the shapes stay unmeasured (character-class estimate), as before.
  { family: 'Helvetica', weight: 400, file: join(LIBERATION_DIR, 'LiberationSans-Regular.ttf'), capHeight: 717, borrow: HELVETICA_ARROWS, missing: HELVETICA_MISSING },
  { family: 'Helvetica', weight: 700, file: join(LIBERATION_DIR, 'LiberationSans-Bold.ttf'), capHeight: 720, borrow: HELVETICA_ARROWS, missing: HELVETICA_MISSING },
  { family: 'Arial', weight: 400, file: join(LIBERATION_DIR, 'LiberationSans-Regular.ttf'), capHeight: 716 },
  { family: 'Arial', weight: 700, file: join(LIBERATION_DIR, 'LiberationSans-Bold.ttf'), capHeight: 716 },
];

/** Contiguous code point ranges, inclusive. */
const RANGES = [
  [0x0020, 0x007e], // ASCII
  [0x00a0, 0x017f], // Latin-1 supplement, Latin Extended-A
];
/** Symbols the engine emits outside those ranges. */
const EXTRA = [
  0x0394, // Δ
  0x2013, 0x2014, // en dash, em dash
  0x2018, 0x2019, 0x201c, 0x201d, // quotes
  0x2022, 0x2026, 0x2030, // bullet, ellipsis, per mille
  0x20ac, // euro
  0x2190, 0x2191, 0x2192, 0x2193, // arrows
  0x2212, 0x2248, 0x2264, 0x2265, // minus, approx, ≤, ≥
  0x25b2, 0x25b4, 0x25b6, 0x25bc, 0x25be, 0x25cf, 0x25cb, // triangles, circles
  0x2020, // dagger
  0x2197, 0x2198, // diagonal arrows
];

const BORROWED_GLYPHS = new Set([0x2190, 0x2191, 0x2192, 0x2193, 0x2197, 0x2198, 0x2020]);

// STIX diagonals have text-sized ink; Apple Symbols diagonals are only 0.42 em high.
const SYMBOL_FONT = '/System/Library/Fonts/Supplemental/STIXGeneral.otf';
const SYMBOL_BOLD_FONT = '/System/Library/Fonts/Supplemental/STIXGeneralBol.otf';

function codePoints() {
  const out = [];
  for (const [a, b] of RANGES) for (let cp = a; cp <= b; cp++) out.push(cp);
  out.push(...EXTRA);
  return out;
}

function openFace(spec) {
  if (!spec.file || !existsSync(spec.file)) throw new Error(`font file missing: ${spec.file} (${spec.family} ${spec.weight})`);
  const opened = fontkit.openSync(spec.file);
  const font = opened.fonts ? opened.fonts.find((f) => f.subfamilyName === spec.pick) : opened;
  if (!font) throw new Error(`face '${spec.pick}' not in ${spec.file}: ${opened.fonts.map((f) => f.subfamilyName).join(', ')}`);
  return font;
}

function buildFace(spec, fallback) {
  const font = openFace(spec);
  const upem = font.unitsPerEm;
  const scale = 1000 / upem;
  const borrowed = [];
  const widths = codePoints().map((cp) => {
    if (spec.missing?.includes(cp)) return 0;
    if (!font.hasGlyphForCodePoint(cp) || spec.borrow?.includes(cp)) {
      const lent = BORROWED_GLYPHS.has(cp) ? fallback?.(cp) ?? 0 : 0;
      if (lent) borrowed.push(cp);
      return lent;
    }
    return Math.round(font.glyphForCodePoint(cp).advanceWidth * scale);
  });
  return {
    family: spec.family,
    weight: spec.weight,
    ascent: Math.round(font.ascent * scale),
    descent: Math.round(font.descent * scale),
    lineGap: Math.round(font.lineGap * scale),
    capHeight: spec.capHeight ?? Math.round(font.capHeight * scale),
    xHeight: Math.round(font.xHeight * scale),
    widths: widths.map(width => width.toString(36)).join(','),
    borrowed: borrowed.map(cp => cp.toString(36)).join(','),
  };
}

function render() {
  const lenders = FACES.filter((spec) => spec.family === 'Arial').map((spec) => buildFace(spec));
  const symbols = fontkit.openSync(SYMBOL_FONT);
  const boldSymbols = fontkit.openSync(SYMBOL_BOLD_FONT);
  const points = codePoints();
  const symbolWidth = (cp, weight = 400) => {
    const font = weight > 500 ? boldSymbols : symbols;
    return font.hasGlyphForCodePoint(cp)
      ? Math.round(font.glyphForCodePoint(cp).advanceWidth * 1000 / font.unitsPerEm) : 0;
  };
  const fallbackFamilies = Object.fromEntries([...BORROWED_GLYPHS].flatMap((cp) => {
    const i = points.indexOf(cp);
    return parseInt(lenders[0].widths.split(',')[i], 36) ? [[cp, 'Arial']]
      : symbolWidth(cp) ? [[cp, 'STIXGeneral']] : [];
  }));
  const faces = FACES.map((spec) => {
    const lender = lenders.reduce((best, face) => Math.abs(face.weight - spec.weight) < Math.abs(best.weight - spec.weight) ? face : best);
    const widths = lender.widths.split(',').map((width) => parseInt(width, 36));
    return buildFace(spec, (cp) => widths[points.indexOf(cp)] || symbolWidth(cp, spec.weight));
  });
  const previousFamily = new Map();
  const encodedFaces = faces.map((face, index) => {
    const base = previousFamily.get(face.family);
    previousFamily.set(face.family, index);
    if (base === undefined) return face;
    const previous = faces[base].widths.split(',').map(width => parseInt(width, 36));
    return { ...face, base, widths: face.widths.split(',')
      .map((width, column) => (parseInt(width, 36) - previous[column]).toString(36)).join(',') };
  });
  const lines = [
    '// Generated by scripts/build-font-metrics.mjs. Do not edit by hand.',
    '// Advance widths in 1/1000 em, comma-separated base-36 integers, one entry per code',
    '// point of CODE_POINT_RANGES then EXTRA_CODE_POINTS; 0 = glyph missing. A row with',
    '// `base` stores signed differences from that earlier decoded row. `borrowed` lists',
    '// (base 36) the EXTRA code points drawn by GLYPH_FALLBACK_FAMILIES; their widths',
    '// are the fallback advances. Font files are not bundled.',
    '',
    'export interface FaceTable {',
    '  family: string;',
    '  weight: number;',
    '  ascent: number;',
    '  descent: number;',
    '  lineGap: number;',
    '  capHeight: number;',
    '  xHeight: number;',
    '  widths: string;',
    '  borrowed?: string;',
    '}',
    '',
    `export const CODE_POINT_RANGES: readonly (readonly [number, number])[] = ${JSON.stringify(RANGES)};`,
    `export const EXTRA_CODE_POINTS: readonly number[] = ${JSON.stringify(EXTRA)};`,
    `export const GLYPH_FALLBACK_FAMILIES: Readonly<Record<number, string>> = ${JSON.stringify(fallbackFamilies)};`,
    '',
    'export const FACE_TABLES: readonly (FaceTable & { base?: number })[] = [',
    ...encodedFaces.map(
      (f) =>
        `  { family: ${JSON.stringify(f.family)}, weight: ${f.weight}, ascent: ${f.ascent}, descent: ${f.descent}, lineGap: ${f.lineGap}, capHeight: ${f.capHeight}, xHeight: ${f.xHeight},\n    widths: ${JSON.stringify(f.widths)}${f.base === undefined ? '' : `, base: ${f.base}`}${f.borrowed ? `, borrowed: ${JSON.stringify(f.borrowed)}` : ''} },`,
    ),
    '];',
    '',
  ];
  return lines.join('\n');
}

/**
 * Without the font files (a Linux CI runner, a machine without LibreOffice) the table cannot be re-derived, but it can still be checked for
 * shape: the ranges and extras the generator would emit, one entry per
 * face, and a width table of exactly one integer per code point. That
 * catches a hand edit, a dropped face or a range change without fonts.
 */
function integrityProblems(current) {
  const problems = [];
  if (!current) return ['generated table missing'];
  if (!current.includes(`export const CODE_POINT_RANGES: readonly (readonly [number, number])[] = ${JSON.stringify(RANGES)};`)) {
    problems.push('CODE_POINT_RANGES differ from the generator');
  }
  if (!current.includes(`export const EXTRA_CODE_POINTS: readonly number[] = ${JSON.stringify(EXTRA)};`)) {
    problems.push('EXTRA_CODE_POINTS differ from the generator');
  }
  const expectedWidths = codePoints().length;
  const rows = [...current.matchAll(/family: "([^"]+)", weight: (\d+),[\s\S]*?widths: "([^"]*)"([^\n]*)/g)];
  if (rows.length !== FACES.length) problems.push(`expected ${FACES.length} faces, found ${rows.length}`);
  const decoded = [];
  // The generator bases each face on the previous face of its family; any other base decodes wrong widths.
  const previousFamily = new Map();
  for (const [index, spec] of FACES.entries()) {
    const expectedBase = previousFamily.get(spec.family);
    previousFamily.set(spec.family, index);
    const row = rows[index];
    if (!row || row[1] !== spec.family || Number(row[2]) !== spec.weight) {
      problems.push(`face ${spec.family} ${spec.weight} missing from the table`);
      continue;
    }
    const baseText = row[4].match(/, base: (\d+)/);
    const base = baseText ? Number(baseText[1]) : undefined;
    if ((row[4].includes('base:') && !baseText) || base !== expectedBase || (base !== undefined && !decoded[base])) {
      problems.push(`face ${spec.family} ${spec.weight}: invalid base row`);
      continue;
    }
    const widths = row[3].split(',');
    if (widths.length !== expectedWidths) problems.push(`face ${spec.family} ${spec.weight}: ${widths.length} widths, expected ${expectedWidths}`);
    const values = widths.map((width, column) => parseInt(width, 36) + (base === undefined ? 0 : decoded[base][column]));
    decoded[index] = values;
    if (widths.some((width) => !/^(0|-?[1-9a-z][0-9a-z]*)$/.test(width)) || values.some((width) => !Number.isInteger(width) || width < 0 || width > 65535)) {
      problems.push(`face ${spec.family} ${spec.weight}: invalid width integer`);
    }
  }
  return problems;
}

const fontsMissing = FACES.filter((spec) => process.env.BOARDPLOT_FONTS_UNAVAILABLE === '1' || !spec.file || !existsSync(spec.file));
if (process.argv.includes('--check')) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (fontsMissing.length > 0 || !existsSync(SYMBOL_FONT) || !existsSync(SYMBOL_BOLD_FONT)) {
    const problems = integrityProblems(current);
    if (problems.length > 0) {
      console.error(`${OUT} fails the structure check: ${problems.join('; ')}`);
      process.exit(1);
    }
    console.log(
      `font metrics: ${fontsMissing.length} of ${FACES.length} font files unavailable; table structure verified (${FACES.length} faces, ${codePoints().length} code points each); full font comparison skipped`,
    );
    process.exit(0);
  }
  if (current !== render()) {
    console.error(`${OUT} is out of date; run: node scripts/build-font-metrics.mjs`);
    process.exit(1);
  }
  console.log('font metrics up to date');
} else {
  const content = render();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, content);
  console.log(`wrote ${OUT} (${FACES.length} faces, ${codePoints().length} code points each)`);
}
