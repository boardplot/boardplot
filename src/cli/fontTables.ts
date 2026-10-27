/**
 * `boardplot fonts build`: a licensed font directory in, one reusable
 * width table file out.
 *
 * The widths come from fontkit (already a project dependency) with the same
 * arithmetic scripts/build-font-metrics.mjs uses for the built-in tables:
 * hmtx/glyph advances scaled to 1/1000 em, rounded, 0 where the face has no
 * glyph. The code points are the built-in ranges, so a face built here covers
 * exactly what the shipped tables cover and the injected measurer compares
 * like for like.
 *
 * fontkit is loaded with `import()`, which tsup resolves at build time into a
 * chunk of its own. The package.json entry is a devDependency, so a
 * `createRequire('fontkit')` would work in this checkout and fail for every
 * installed consumer; the bundled chunk means the shipped `boardplot fonts
 * build` carries its reader and needs nothing installed. `loadFontReader`
 * prepares this builder before a `fonts` call. The synchronous PNG path also
 * imports fontkit to shape split text. Root, react and geo entries stay free
 * of this Node-only reader.
 *
 * Determinism: files are sorted by their '/'-joined relative path, faces by
 * file name then collection index in that order, no absolute path, no
 * timestamp, no environment data. Two runs over the same tree write the same
 * bytes.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import type { FontkitCollection, FontkitFont } from 'fontkit';
import { CODE_POINT_RANGES, EXTRA_CODE_POINTS } from '../core/fontMetrics/tables.generated';
import {
  FONT_METRIC_GENERATOR,
  FONT_METRIC_TABLE_FORMAT,
  codePointsOf,
  encodeWidths,
  type FontMetricFace,
  type FontMetricTables,
  type SkippedFont,
} from '../core/fontMetrics/tableDocument';

/** Extensions fontkit opens. Anything else in the directory is ignored. */
const SUPPORTED_EXTENSIONS = new Set(['.ttf', '.otf', '.ttc', '.otc', '.dfont', '.woff', '.woff2']);

/** Font files this command refuses out loud instead of guessing. */
const UNSUPPORTED_EXTENSIONS = new Map([
  ['.eot', 'EOT is an Internet Explorer wrapper; convert to TTF or WOFF2 first'],
  ['.pfb', 'bare PostScript Type 1 is not supported; convert to OTF first'],
  ['.pfa', 'bare PostScript Type 1 is not supported; convert to OTF first'],
]);

const CODE_POINTS = codePointsOf(CODE_POINT_RANGES, EXTRA_CODE_POINTS);

/**
 * The OpenType feature the renderers turn on for figures: numeric text
 * (values, ticks, table numbers) carries `font-variant-numeric: tabular-nums`,
 * so a proportional-digit face renders those digits at its tabular advance.
 * Widths have to come from the same substitution or a host face with
 * proportional default digits measures every number wrong. Other text renders
 * without it and measures the same way without changing geometry.
 */
const FIGURE_FEATURES = ['tnum'];

/** The face members the width reader needs; fontkit's Font satisfies it. */
export interface FaceAdvanceSource {
  hasGlyphForCodePoint(codePoint: number): boolean;
  glyphForCodePoint(codePoint: number): { advanceWidth: number };
  layout(text: string, features?: string[]): { advanceWidth: number };
}

/**
 * Advance widths in 1/1000 em for `codePoints`: 0 where the face has no glyph.
 * The shaped advance (`layout` with tnum) comes first, the plain glyph advance
 * is the fallback when shaping a single code point throws (a few faces refuse
 * it for symbol ranges), so a whole file is never lost to one code point.
 */
export function advanceWidths(
  font: FaceAdvanceSource,
  codePoints: readonly number[],
  scale: number,
): number[] {
  return codePoints.map((cp) => {
    if (!font.hasGlyphForCodePoint(cp)) return 0;
    const character = String.fromCodePoint(cp);
    let advance: number;
    try {
      advance = font.layout(character, FIGURE_FEATURES).advanceWidth;
    } catch {
      advance = font.glyphForCodePoint(cp).advanceWidth;
    }
    return Number.isFinite(advance) ? Math.round(advance * scale) : 0;
  });
}

/** The message body of an unknown throwable, without a stack or a path. */
function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Keep skip details independent of the machine-local font directory. */
function scanDetail(e: unknown, dir: string, file: string): string {
  let text = errorText(e).split(join(dir, file)).join(file);
  if (dir) text = text.split(dir).join('<font-dir>');
  return text;
}

/** True when the directory holds no font-looking file at all. */
function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Every file under `dir`, as paths relative to it with '/' separators,
 * sorted bytewise. Sorting the relative path (not each directory level)
 * keeps `a-b.ttf` and `a/x.ttf` in one unambiguous order.
 */
export function fontFilesIn(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      // A symlink is a file when it points at one (Linux font directories are
      // full of them), and a symlinked DIRECTORY is not walked: that is how a
      // tree acquires a cycle.
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      const stats = statSync(abs, { throwIfNoEntry: false });
      if (stats?.isFile()) found.push(relative(dir, abs).split(sep).join('/'));
    }
  };
  walk(dir);
  return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The weight a face declares: OS/2 first, subfamily name when it does not. */
function faceWeight(font: FontkitFont): number {
  const declared = font['OS/2']?.usWeightClass;
  if (typeof declared === 'number' && Number.isInteger(declared) && declared >= 1 && declared <= 1000) {
    return declared;
  }
  const name = `${font.subfamilyName} ${font.fullName}`.toLowerCase();
  if (/\b(black|heavy|extra ?bold|ultra ?bold)\b/.test(name)) return 900;
  if (/\b(semi ?bold|demi ?bold)\b/.test(name)) return 600;
  if (/\bbold\b/.test(name)) return 700;
  if (/\bmedium\b/.test(name)) return 500;
  if (/\b(light|hairline|thin)\b/.test(name)) return name.includes('thin') || name.includes('hairline') ? 100 : 300;
  return 400;
}

function faceStyle(font: FontkitFont): 'normal' | 'italic' {
  const selection = font['OS/2']?.fsSelection;
  if (selection?.italic || selection?.oblique) return 'italic';
  return /\b(italic|oblique)\b/i.test(`${font.subfamilyName} ${font.fullName}`) ? 'italic' : 'normal';
}

/** A font's own number in 1/1000 em; 0 when the face does not state one. */
function em(value: number | undefined, scale: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * scale) : 0;
}

/** Wrong units are worse than no table: refuse the face instead. */
function requireUnitsPerEm(font: FontkitFont): number {
  const upem = font.unitsPerEm;
  if (!Number.isInteger(upem) || upem <= 0) {
    throw new Error(`the face declares unitsPerEm ${String(upem)}`);
  }
  return upem;
}

/** A variable face tabled at one weight: the weight and its advances. */
interface WeightInstance {
  weight: number;
  advances: FaceAdvanceSource;
}

/**
 * One face's table. Throws a plain Error when the face cannot be measured
 * (no units, no glyph access, no coverage), which the caller records as a
 * skipped file. A zero-width table is refused rather than written: a host
 * would measure every label as 0 wide and place labels on top of each other.
 */
function faceTable(font: FontkitFont, file: string, sha256: string, faceIndex: number, at?: WeightInstance): FontMetricFace {
  const upem = requireUnitsPerEm(font);
  if (typeof font.hasGlyphForCodePoint !== 'function' || typeof font.glyphForCodePoint !== 'function') {
    throw new Error('the face exposes no glyph accessors');
  }
  const scale = 1000 / upem;
  const widths = advanceWidths(at?.advances ?? font, CODE_POINTS, scale);
  if (widths.every((w) => w === 0)) {
    throw new Error('the face has no glyph for any tabled code point');
  }
  return {
    family: font.familyName,
    subfamily: at ? `wght ${at.weight}` : font.subfamilyName,
    style: faceStyle(font),
    weight: at?.weight ?? faceWeight(font),
    file,
    faceIndex,
    postscriptName: font.postscriptName,
    sha256,
    unitsPerEm: upem,
    ascent: em(font.ascent, scale),
    descent: em(font.descent, scale),
    lineGap: em(font.lineGap, scale),
    capHeight: em(font.capHeight, scale),
    xHeight: em(font.xHeight, scale),
    widths: encodeWidths(widths),
  };
}

/** CSS weights a variable face is tabled at, inside its weight axis; 1000 is the scale's top, which themes accept. */
const STANDARD_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];

type WeightAxis = FontkitFont['variationAxes'][string];

/**
 * The `wght` axis of a variable face when it is on the CSS weight scale. The
 * OpenType spec limits `wght` to 1..1000; an older axis outside it (one legacy
 * face's runs 0.48 to 3.2) names no CSS weight, so that face keeps one table.
 */
function weightAxis(font: FontkitFont): WeightAxis | undefined {
  const axis = font.variationAxes?.wght;
  return axis && axis.min >= 1 && axis.max <= 1000 ? axis : undefined;
}

/** Each standard weight clamped to the axis, plus the axis default; ascending, no repeats. */
function axisWeights(axis: WeightAxis): number[] {
  const clamp = (w: number): number => Math.min(axis.max, Math.max(axis.min, w));
  return [...new Set([...STANDARD_WEIGHTS.map(clamp), axis.default])].sort((a, b) => a - b);
}

/**
 * Advances of a variable face at `wght`: the default instance's shaped glyphs
 * plus each glyph's HVAR delta at that weight.
 *
 * fontkit 2.0.4's `getVariation` is not usable here. It rebuilds the instance
 * as bare TrueType whatever the container, which throws for WOFF and WOFF2,
 * and a WOFF2 face with coordinates set throws on its first composite glyph.
 * So the default face keeps doing the shaping (cmap, tnum), and a second open
 * of the same bytes, with coordinates set before anything reads them, only
 * supplies fontkit's own variation processor for the HVAR step. On TrueType
 * files this gives the same advances as `getVariation`.
 * shortcut: a glyph swap a font makes by weight (GSUB feature variations)
 * keeps the default glyph; read it from a real instance if a face needs it.
 */
function hvarAdvancesAt(
  reader: typeof import('fontkit'),
  bytes: Uint8Array,
  faceIndex: number,
  font: FontkitFont,
  wght: number,
): FaceAdvanceSource {
  const opened = reader.create(bytes);
  const probe = 'fonts' in opened ? opened.fonts[faceIndex]! : opened;
  probe.variationCoords = Object.entries(probe.variationAxes).map(([tag, axis]) => (tag === 'wght' ? wght : axis.default));
  const processor = probe._variationProcessor!;
  const hvar = probe.HVAR!;
  const plusDeltas = (advance: number, glyphs: readonly { id: number }[]): number =>
    glyphs.reduce((sum, glyph) => sum + processor.getAdvanceAdjustment(glyph.id, hvar), advance);
  return {
    hasGlyphForCodePoint: (cp) => font.hasGlyphForCodePoint(cp),
    glyphForCodePoint(cp) {
      const glyph = font.glyphForCodePoint(cp);
      return { advanceWidth: plusDeltas(glyph.advanceWidth, [glyph]) };
    },
    layout(text, features) {
      const run = font.layout(text, features);
      return { advanceWidth: plusDeltas(run.advanceWidth, run.glyphs) };
    },
  };
}

/**
 * The tables of one face. A variable face with a CSS `wght` axis and an HVAR
 * table gets one per weight from axisWeights, so a 700 label is measured with
 * 700 advances. Without HVAR it keeps its default instance only and says so
 * in `skipped`.
 */
function facesOfFont(
  reader: typeof import('fontkit'),
  bytes: Uint8Array,
  font: FontkitFont,
  file: string,
  sha256: string,
  faceIndex: number,
  skipped: SkippedFont[],
): FontMetricFace[] {
  const axis = weightAxis(font);
  if (!axis) return [faceTable(font, file, sha256, faceIndex)];
  if (!font.HVAR) {
    const face = faceTable(font, file, sha256, faceIndex);
    skipped.push({
      file,
      reason: 'weights-not-tabled',
      detail: `face ${faceIndex}: variable weights need an HVAR table; only the default instance (wght ${axis.default}) is tabled`,
    });
    return [face];
  }
  return axisWeights(axis).map((wght) =>
    faceTable(font, file, sha256, faceIndex, {
      weight: Math.round(wght),
      advances: wght === axis.default ? font : hvarAdvancesAt(reader, bytes, faceIndex, font, wght),
    }),
  );
}

/** Faces of one file: a collection yields one per face, in file order. */
function facesOfFile(
  fontkit: typeof import('fontkit'),
  dir: string,
  file: string,
  skipped: SkippedFont[],
): FontMetricFace[] {
  const abs = join(dir, file);
  let bytes: Buffer;
  let sha256: string;
  let opened: FontkitFont | FontkitCollection;
  try {
    bytes = readFileSync(abs);
    sha256 = createHash('sha256').update(bytes).digest('hex');
    opened = fontkit.openSync(abs);
  } catch (e) {
    skipped.push({ file, reason: 'unreadable', detail: scanDetail(e, dir, file) });
    return [];
  }
  const faces: FontkitFont[] = 'fonts' in opened ? opened.fonts : [opened];
  const built: FontMetricFace[] = [];
  faces.forEach((font, faceIndex) => {
    try {
      built.push(...facesOfFont(fontkit, bytes, font, file, sha256, faceIndex, skipped));
    } catch (e) {
      skipped.push({ file, reason: 'face-refused', detail: `face ${faceIndex}: ${scanDetail(e, dir, file)}` });
    }
  });
  return built;
}

export interface FontTableBuild {
  tables: FontMetricTables;
  /** Files read, font-looking or not. */
  filesScanned: number;
  /** Faces refused, with the reason; also inside `tables.skipped`. */
  skipped: readonly SkippedFont[];
}

/**
 * Build the table file for a font directory. Files whose extension is not a
 * font extension are ignored silently (a font directory holds licences and
 * readmes); a font-looking file that fontkit cannot parse, an unsupported
 * format, and a refused face all end up in `skipped` with a reason.
 */
let fontkit: typeof import('fontkit') | undefined;

/** Loads the font reader `buildFontTables` needs; the bin awaits it before a `fonts` call. */
export async function loadFontReader(): Promise<void> {
  fontkit ??= await import('fontkit');
}

export function buildFontTables(dir: string): FontTableBuild {
  if (!fontkit) throw new Error('the font reader is not loaded; await loadFontReader() first');
  const reader = fontkit;
  if (!isDirectory(dir)) throw new Error(`fonts build needs a directory of font files: ${dir} is not a directory`);
  const files = fontFilesIn(dir);
  const skipped: SkippedFont[] = [];
  const faces: FontMetricFace[] = [];
  let fontLooking = 0;
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (UNSUPPORTED_EXTENSIONS.has(ext)) {
      fontLooking++;
      skipped.push({ file, reason: 'unsupported-format', detail: UNSUPPORTED_EXTENSIONS.get(ext) });
      continue;
    }
    if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
    fontLooking++;
    faces.push(...facesOfFile(reader, dir, file, skipped));
  }
  const tables: FontMetricTables = {
    bpFontMetrics: FONT_METRIC_TABLE_FORMAT,
    generator: FONT_METRIC_GENERATOR,
    widthEncoding: 'base64-le-uint16',
    unitsPerEmBase: 1000,
    codePointRanges: CODE_POINT_RANGES,
    extraCodePoints: EXTRA_CODE_POINTS,
    faces,
    skipped,
  };
  if (faces.length === 0) {
    const detail = fontLooking === 0 ? 'no font files in the directory' : `every one of the ${fontLooking} font file(s) was refused`;
    throw new Error(`no face could be tabled in ${dir}: ${detail}${skipped.length ? ` (${skipped.map((s) => `${s.file}: ${s.reason}`).join('; ')})` : ''}`);
  }
  return { tables, filesScanned: files.length, skipped };
}

/** The bytes a build writes: pretty JSON with a trailing newline. */
export function serializeFontTables(tables: FontMetricTables): string {
  return `${JSON.stringify(tables, null, 2)}\n`;
}
