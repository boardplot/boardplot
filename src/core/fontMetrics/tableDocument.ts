/**
 * The reusable font width table file.
 *
 * `boardplot fonts build <dir>` writes one of these from a licensed font
 * directory; `createMetricTablesMeasurer` (./injected) reads it back into a
 * TextMeasurer. Layout stays the only thing that places labels: the tables
 * supply text widths to layout without changing built-in theme defaults.
 *
 * The width encoding is deliberately the same one `tables.generated.ts` uses
 * (little-endian Uint16 in 1/1000 em, base64, 0 = no glyph for that code
 * point), so the injected measurer and the built-in one share one decoder
 * (src/core/fontMetrics/index.ts).
 */

import * as z from 'zod';
import { pushAll } from '../arrays';

/** Bump only when the file shape changes in a way readers cannot absorb. */
export const FONT_METRIC_TABLE_FORMAT = 1;

/** Written into the file; a reader can tell how it was produced. */
export const FONT_METRIC_GENERATOR = 'boardplot fonts build';

/** Default file name inside the scanned directory. */
export const FONT_TABLE_FILE_NAME = 'boardplot-font-tables.json';

export type FontMetricStyle = 'normal' | 'italic';

/** One face of one font file, with everything a host needs to match it. */
export interface FontMetricFace {
  /** Family as the font names it; this is what a CSS stack is matched against. */
  family: string;
  subfamily: string;
  style: FontMetricStyle;
  /** OS/2 usWeightClass when the font states one, else read off the subfamily. */
  weight: number;
  /** Path relative to the scanned directory, '/' separated. Never absolute. */
  file: string;
  /** Index of this face inside a collection; 0 for a single-font file. */
  faceIndex: number;
  postscriptName: string;
  /** SHA-256 of the font file, so a host can match the file it loads. */
  sha256: string;
  unitsPerEm: number;
  /** Vertical metrics in 1/1000 em, like the built-in tables. */
  ascent: number;
  descent: number;
  lineGap: number;
  /** 0 when the face states none. */
  capHeight: number;
  xHeight: number;
  /** Advance widths in 1/1000 em: base64, little-endian Uint16, 0 = missing. */
  widths: string;
}

/** A font file the build did not table, and why. */
export interface SkippedFont {
  file: string;
  reason: string;
  /** Human detail (fontkit's message, or the reason the face was refused). */
  detail?: string;
}

export interface FontMetricTables {
  bpFontMetrics: typeof FONT_METRIC_TABLE_FORMAT;
  generator: string;
  widthEncoding: 'base64-le-uint16';
  unitsPerEmBase: number;
  codePointRanges: readonly (readonly [number, number])[];
  extraCodePoints: readonly number[];
  faces: readonly FontMetricFace[];
  skipped: readonly SkippedFont[];
}

/** Last Unicode code point; an endpoint above this names nothing. */
const MAX_UNICODE_CODE_POINT = 0x10ffff;

/** Cap expansion at one complete Unicode code space. */
const MAX_TABLE_CODE_POINTS = 0x110000;

/** Validate bounds and total expansion before allocating code-point arrays. */
function validateCodePointRanges(
  ranges: readonly (readonly [number, number])[],
  extras: readonly number[],
): void {
  const fail = (issue: string): never => {
    throw new Error(`not a boardplot font tables file (${issue})`);
  };
  extras.forEach((cp, i) => {
    if (cp < 0 || cp > MAX_UNICODE_CODE_POINT) {
      fail(`extraCodePoints.${i}: ${cp} is outside the Unicode code point range 0..${MAX_UNICODE_CODE_POINT}`);
    }
  });
  // Count extras even when no ranges are present.
  let total = extras.length;
  if (total > MAX_TABLE_CODE_POINTS) {
    fail(`codePointRanges: ranges and extras name ${total} code points, more than the ${MAX_TABLE_CODE_POINTS} in the Unicode code space`);
  }
  ranges.forEach(([from, to], i) => {
    if (from > to) fail(`codePointRanges.${i}: [${from}, ${to}] is not an ascending range`);
    if (from < 0 || to > MAX_UNICODE_CODE_POINT) {
      fail(`codePointRanges.${i}: [${from}, ${to}] is outside the Unicode code point range 0..${MAX_UNICODE_CODE_POINT}`);
    }
    total += to - from + 1;
    if (total > MAX_TABLE_CODE_POINTS) {
      fail(`codePointRanges.${i}: ranges and extras name ${total} code points, more than the ${MAX_TABLE_CODE_POINTS} in the Unicode code space`);
    }
  });
}

/** Code points read out of `ranges` (inclusive) then `extras`, in that order. */
export function codePointsOf(
  ranges: readonly (readonly [number, number])[],
  extras: readonly number[],
): number[] {
  const out: number[] = [];
  for (const [from, to] of ranges) for (let cp = from; cp <= to; cp++) out.push(cp);
  pushAll(out, extras);
  return out;
}

/** Pack widths as the built-in tables do: little-endian Uint16, base64. */
export function encodeWidths(widths: readonly number[]): string {
  const bytes = new Uint8Array(widths.length * 2);
  widths.forEach((w, i) => {
    bytes[i * 2] = w & 0xff;
    bytes[i * 2 + 1] = (w >> 8) & 0xff;
  });
  // btoa in chunks (the argument list has a length limit) so this module
  // works in Node and in a browser host alike.
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

const faceSchema = z.strictObject({
  family: z.string().min(1),
  subfamily: z.string(),
  style: z.enum(['normal', 'italic']),
  weight: z.number().int().min(1).max(1000),
  file: z.string().min(1),
  faceIndex: z.number().int().min(0),
  postscriptName: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  unitsPerEm: z.number().int().positive(),
  ascent: z.number().int(),
  descent: z.number().int(),
  lineGap: z.number().int(),
  capHeight: z.number().int(),
  xHeight: z.number().int(),
  widths: z.string().min(1).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'widths must be base64'),
});

const tablesSchema = z.strictObject({
  bpFontMetrics: z.literal(FONT_METRIC_TABLE_FORMAT),
  generator: z.string().min(1),
  widthEncoding: z.literal('base64-le-uint16'),
  unitsPerEmBase: z.literal(1000),
  codePointRanges: z.array(z.tuple([z.number().int(), z.number().int()])).min(1),
  extraCodePoints: z.array(z.number().int()),
  faces: z.array(faceSchema).min(1),
  skipped: z.array(z.strictObject({ file: z.string().min(1), reason: z.string().min(1), detail: z.string().optional() })),
});

/**
 * Parse a table file. Named code points are deliberately not reused here: a
 * table whose widths do not line up one-for-one with its code points measures
 * garbage, so that is a parse error, not a warning.
 */
export function parseFontMetricTables(input: unknown): FontMetricTables {
  const parsed = tablesSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`not a boardplot font tables file (${issues})`);
  }
  const tables = parsed.data as FontMetricTables;
  validateCodePointRanges(tables.codePointRanges, tables.extraCodePoints);
  const expectedBytes = codePointsOf(tables.codePointRanges, tables.extraCodePoints).length * 2;
  tables.faces.forEach((face, i) => {
    // atob, not Buffer: a host may parse the file in the browser, and this
    // module is shared by both sides.
    const bytes = atob(face.widths).length;
    if (bytes !== expectedBytes) {
      throw new Error(
        `not a boardplot font tables file (faces.${i} (${face.family} ${face.weight}): ${bytes} width bytes, expected ${expectedBytes})`,
      );
    }
  });
  return tables;
}
