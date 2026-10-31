/**
 * Text measurement without a DOM.
 *
 * The layout engine must know label sizes before anything renders, in any
 * environment (browser, tests, CLI). Widths come from the advance-width
 * tables of the faces the presets render with (src/core/fontMetrics,
 * generated from the font files); a family without a table falls back to a
 * per-character-class model. One explicit safety margin (WIDTH_SAFETY)
 * covers kerning, which the tables ignore. All measurements are quantized
 * to 0.5px before any placement decision. A canvas-based refiner may
 * fine-trim rendered text in-browser but never changes placement decisions.
 */

import { resolveFace, type Face } from './fontMetrics';

/** An authored role size survives the frame's default key and footer sizes. */
export const AUTHORED_TYPE_SIZE = Symbol('authoredTypeSize');
export function hasAuthoredTypeSize(font: FontSpec): boolean {
  return (font as FontSpec & { [AUTHORED_TYPE_SIZE]?: true })[AUTHORED_TYPE_SIZE] === true;
}

export interface FontSpec {
  /** Limit: italic widths measured with upright metrics; add italic tables if a cut appears */
  style?: 'normal' | 'italic';
  family?: string;
  size: number;
  weight: number;
  lineHeight?: number;
  /**
   * Tracking in px (uppercase table headers use 0.5). The measurer
   * counts the VISIBLE width (len−1 gaps); SVG letter-spacing adds a
   * trailing advance after the last glyph, which the renderer compensates
   * for end/middle anchors so tracked headers keep shared edges.
   */
  letterSpacing?: number;
  /**
   * The text is drawn with tabular figures (`font-variant-numeric:
   * tabular-nums`), so every digit measures at the face's widest digit.
   * Only a caller that draws the string that way sets it; a scene
   * node's font leaves it out.
   */
  tabular?: boolean;
}

export interface TextSize {
  width: number;
  height: number;
  ascent: number;
}

/**
 * Measures text. `capHeight`, when present, answers the cap height in px of the face the
 * measurer resolves for a font, or undefined when no table has the family; emission centres a
 * one-line label's figures with it. A wrapper that does not forward it keeps the line-box top.
 */
export type TextMeasurer = ((text: string, font: FontSpec) => TextSize) & {
  capHeight?: (font: FontSpec) => number | undefined;
};

/** Width factors relative to font size, per character class. */
const NARROW = 0.3; // i j l t f r I . , : ; ' | ! ( ) [ ] -
const DIGIT = 0.6; // tabular numerals — numbers render with tnum
const UPPER = 0.72;
const WIDE = 0.95; // m w M W @ %
const DEFAULT = 0.56;
const SPACE = 0.28;

const NARROW_RE = /[ijltfrI.,:;'|!()[\]\-]/;
const WIDE_RE = /[mwMW@%]/;
/**
 * East Asian Wide and Fullwidth characters (UAX #11): Hangul, CJK, kana, Yi
 * and the fullwidth forms draw one em wide. No shipped face tables them, so
 * the class model measured 東京都 at 0.56 em a character and the drawn text
 * ran past its box.
 */
const EAST_ASIAN_WIDE =
  /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6\u{20000}-\u{3FFFD}]/u;
/** A cluster drawn as an emoji: emoji presentation by default, or asked for with U+FE0F. One em. */
const EMOJI_RE = /\p{Emoji_Presentation}|\uFE0F/u;
/**
 * Default-ignorable code points (soft hyphen, zero-width space and joiners,
 * word joiner, BOM) draw with no width. A font table can still hold an
 * advance for one, even a wrapped one (65,519 units for a soft hyphen in one
 * variable face), so a cluster whose base is one measures zero. The Hangul
 * fillers and the shorthand format controls stay: browsers draw them as
 * spacing glyphs, the exceptions HarfBuzz makes (hb-unicode.hh).
 */
const DEFAULT_IGNORABLE = /\p{Default_Ignorable_Code_Point}/u;
const SPACING_IGNORABLES = new Set([0x115f, 0x1160, 0x3164, 0xffa0, 0x1bca0, 0x1bca1, 0x1bca2, 0x1bca3]);
function drawsNoWidth(codePoint: number): boolean {
  if (codePoint < 0xad) return false;
  return !SPACING_IGNORABLES.has(codePoint) && DEFAULT_IGNORABLE.test(String.fromCodePoint(codePoint));
}
/**
 * Characters that join the one before them into one drawn cluster: combining
 * marks (variation selectors are marks too), ZWJ, skin-tone modifiers and
 * tag characters.
 */
const JOINS_PREVIOUS = /[\p{M}\u200D\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/u;
const REGIONAL_INDICATOR = /[\u{1F1E6}-\u{1F1FF}]/u;
const CLUSTER_RE = /[\p{M}\u200D\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}\u{1F1E6}-\u{1F1FF}]/u;

/**
 * The drawn clusters of a string: a combining mark, a skin-tone modifier, a
 * tag character or a ZWJ belongs to the character before it, the code point
 * after a ZWJ joins it too, and two regional indicators make one flag. One
 * small splitter on every host: `Intl.Segmenter` is missing on some and
 * follows the host's Unicode version on the others, and measuring by it
 * gave the same label different widths, and different SVG bytes, per host.
 */
export function graphemes(text: string): string[] {
  if (!CLUSTER_RE.test(text)) return Array.from(text);
  const clusters: string[] = [];
  let joinNext = false;
  let loneIndicator = false;
  for (const ch of text) {
    const indicator = REGIONAL_INDICATOR.test(ch);
    if (clusters.length > 0 && (joinNext || JOINS_PREVIOUS.test(ch) || (indicator && loneIndicator))) {
      clusters[clusters.length - 1] += ch;
      loneIndicator = false;
    } else {
      clusters.push(ch);
      loneIndicator = indicator;
    }
    joinNext = ch === '\u200D';
  }
  return clusters;
}

/**
 * Order two strings by UTF-16 code unit. `localeCompare` follows the host's
 * collation, so a sort that used it wrote different bytes under LANG=da_DK
 * than under en_US ("aa" sorts after "z" in Danish).
 */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Quantize to 0.5px — placement decisions are stable across platforms. */
export function quantize(v: number): number {
  return Math.ceil(v * 2) / 2;
}

/**
 * Multiplier on table-measured widths. Browsers and PowerPoint kern; the
 * tables carry plain advances, so a kerned pair renders up to about 1.5%
 * narrower than the sum. The margin keeps the estimate at or above the
 * rendered width without hiding labels that fit.
 */
export const WIDTH_SAFETY = 1.015;

function classUnits(ch: string): number {
  // U+00A0 renders at the same advance as a word space in every font this
  // model covers. Counting it in the DEFAULT class (2× a space) would push the
  // subtitle's segment joins ~one extra space apart. U+202F,
  // the group separator French and other locales format numbers with, is
  // narrower still; a space's advance keeps it on the safe side.
  if (ch === ' ' || ch === '\u00A0' || ch === '\u202F') return SPACE;
  // A mark with no base before it (a cluster's own marks never reach here).
  if (/\p{M}/u.test(ch)) return 0;
  if (EAST_ASIAN_WIDE.test(ch)) return 1;
  if (/[0-9]/.test(ch)) return DIGIT;
  if (NARROW_RE.test(ch)) return NARROW;
  if (WIDE_RE.test(ch)) return WIDE;
  if (/[A-ZÄÖÜ]/.test(ch)) return UPPER;
  return DEFAULT;
}

export function estimateTextWidth(text: string, font: FontSpec): number {
  return estimateTextWidthForFace(text, font, resolveFace(font.family, font.weight));
}

/**
 * The width arithmetic itself, for a face the caller already resolved.
 * `estimateTextWidth` resolves from the built-in tables; a host that injected
 * its own tables (src/core/fontMetrics/injected.ts) resolves from those. One
 * body, so an injected measurer cannot drift from the built-in one.
 */
export function estimateTextWidthForFace(text: string, font: FontSpec, face: Face | undefined): number {
  const s = String(text);
  // The class model has no bold face of its own; the tables do.
  const boldFactor = font.weight >= 600 ? 1.06 : 1;
  const figure = font.tabular === true && face !== undefined ? widestDigit(face) : 0;
  let units = 0;
  let drawn = 0;
  // One advance per drawn cluster: its base character's, or one em for an emoji.
  const clusters = graphemes(s);
  for (const cluster of clusters) {
    const base = cluster.codePointAt(0)!;
    if (drawsNoWidth(base)) continue;
    drawn++;
    if (EMOJI_RE.test(cluster)) {
      units += 1;
      continue;
    }
    const advance = figure > 0 && base >= 0x30 && base <= 0x39 ? figure : face?.advance(base);
    units += advance !== undefined ? advance / 1000 : classUnits(String.fromCodePoint(base)) * boldFactor;
  }
  const tracking = font.letterSpacing ? font.letterSpacing * Math.max(0, drawn - 1) : 0;
  return units * font.size * (face ? WIDTH_SAFETY : 1) + tracking;
}

/**
 * The advance a tabular digit measures at. The renderers draw a
 * value with tabular figures, and a face with proportional default digits,
 * Geist for one, sets "1" at 384/1000 and "0" at 663: its table measured
 * "+150%" narrower than the browser drew it, and a grid track cut the
 * figure. The tables carry no tabular advance, so the widest digit stands
 * in for it: 663 in Geist against a tabular 600, a figure a little wide and
 * never narrow. A face whose digits share one advance (Helvetica, Arial,
 * the tabular-shaped tables) measures at its digit advance.
 */
function widestDigit(face: Face): number {
  let widest = 0;
  for (let digit = 0x30; digit <= 0x39; digit++) widest = Math.max(widest, face.advance(digit) ?? 0);
  return widest;
}

/**
 * Create the default measurer (bundled char-class metrics). `tables` is a
 * future extension point for real per-font metric tables — the signature is
 * fixed by the spec now so adding tables later is non-breaking.
 */
export function createMeasurer(): TextMeasurer {
  const families = new Map<FontSpec['family'], Map<string, Map<string, number>>>();
  let widthCount = 0;
  // The last font's plan: a run of measurements in one font skips the key and the box arithmetic.
  let last: { family: FontSpec['family']; size: number; weight: number; letterSpacing: FontSpec['letterSpacing']; tabular: FontSpec['tabular']; lineHeight: FontSpec['lineHeight']; widths: Map<string, number>; height: number; ascent: number } | undefined;
  const plan = (font: FontSpec) => {
    if (last !== undefined && last.family === font.family && last.size === font.size && last.weight === font.weight
      && last.letterSpacing === font.letterSpacing && last.tabular === font.tabular && last.lineHeight === font.lineHeight) return last;
    // Family and text stay separate keys; only numeric and boolean fields are joined.
    const key = `${font.size}:${font.weight}:${font.letterSpacing}:${font.tabular}`;
    let faces = families.get(font.family);
    if (!faces) families.set(font.family, faces = new Map());
    let widths = faces.get(key);
    if (!widths) faces.set(key, widths = new Map());
    return last = {
      family: font.family, size: font.size, weight: font.weight, letterSpacing: font.letterSpacing, tabular: font.tabular, lineHeight: font.lineHeight,
      widths, height: quantize(font.size * (font.lineHeight ?? 1.2)), ascent: quantize(font.size * 0.8),
    };
  };
  const measure: TextMeasurer = (text, font) => {
    let current = plan(font);
    let width = current.widths.get(text);
    if (width === undefined) {
      width = quantize(estimateTextWidth(text, font));
      // Bound authored text in long-lived renderers; a fit pass reuses the same strings.
      if (widthCount >= 4096) { families.clear(); widthCount = 0; last = undefined; current = plan(font); }
      current.widths.set(text, width);
      widthCount++;
    }
    return { width, height: current.height, ascent: current.ascent };
  };
  measure.capHeight = (font) => capHeightOfFace(font, resolveFace(font.family, font.weight));
  return measure;
}

/** Cap height in px of a resolved face (tables hold it in 1/1000 em). */
export function capHeightOfFace(font: FontSpec, face: Face | undefined): number | undefined {
  // The table generator records 0 for a face without a cap-height metric: unknown, not zero.
  return face && face.capHeight > 0 ? (font.size * face.capHeight) / 1000 : undefined;
}

export const defaultMeasurer: TextMeasurer = createMeasurer();

/** The default measurer; a chart measures with `options.measure` when a caller passes one. */
export function measureText(text: string, font: FontSpec): TextSize {
  return defaultMeasurer(text, font);
}

/**
 * Greedy word-wrap into at most `maxLines` lines of width <= maxWidth.
 * Returns the lines plus whether truncation occurred (last line ellipsized).
 */
const CONNECTOR = /^(?:&|and|\/|-|–)$/i;

/**
 * The narrowest width at which `wrapText` holds a text on two lines without a
 * cut, by its rules: an explicit '\n' breaks the line, and any whitespace but a
 * non-breaking space separates words. A text it cannot hold on two lines
 * takes its one-line width.
 */
export function twoLineWidth(text: string, font: FontSpec, measure: TextMeasurer, breakAfter = false): number {
  // A table asks again for every cell on each layout pass, and a long text takes a measure per split.
  let known = twoLineMemo.get(measure);
  if (known === undefined) twoLineMemo.set(measure, known = new Map());
  const key = `${font.family}|${font.size}|${font.weight}|${font.style}|${font.letterSpacing}|${font.tabular}|${breakAfter}|${text}`;
  let width = known.get(key);
  if (width === undefined) {
    // Bound the memo in a long-lived renderer, as the default measurer bounds its widths.
    if (known.size >= 20000) known.clear();
    known.set(key, width = twoLineWidthOf(text, font, measure, breakAfter));
  }
  return width;
}

const twoLineMemo = new WeakMap<TextMeasurer, Map<string, number>>();

function twoLineWidthOf(text: string, font: FontSpec, measure: TextMeasurer, breakAfter: boolean): number {
  const paragraphs = String(text).split('\n').map(wordsOf).filter((words) => words.length > 0);
  if (paragraphs.length === 2) return Math.max(...paragraphs.map((words) => measure(words.join(' '), font).width));
  if (paragraphs.length !== 1) return measure(text, font).width;
  const { words, glued } = breakAfter ? namePieces(paragraphs[0]!) : { words: paragraphs[0]!, glued: undefined };
  let best = measure(joinPieces(words, glued, 0), font).width;
  for (let i = 1; i < words.length; i++) {
    best = Math.min(best, Math.max(measure(joinPieces(words, glued, 0, i), font).width, measure(joinPieces(words, glued, i), font).width));
  }
  return best;
}

/**
 * Where a name may break besides a space (`breakAfter`): after `_`, `-` or
 * `/`, and after a dot that no digit follows, so "v2.1" stays whole.
 */
const NAME_BREAK = /(?<=[_/-])(?=.)|(?<=\.)(?=\D)/u;

/** A name split where a line may break after `_ - / .` (NAME_BREAK); joined, the pieces are the name. */
export function splitNameBreaks(text: string): string[] {
  return text.split(NAME_BREAK);
}

/** A name's pieces at NAME_BREAK; `glued[i]` joins piece i to the one before it without a space. */
function namePieces(words: readonly string[]): { words: string[]; glued: boolean[] } {
  const pieces: string[] = [];
  const glued: boolean[] = [];
  for (const word of words) word.split(NAME_BREAK).forEach((piece, i) => { pieces.push(piece); glued.push(i > 0); });
  return { words: pieces, glued };
}

function joinPieces(words: readonly string[], glued: readonly boolean[] | undefined, from: number, to = words.length): string {
  let text = '';
  for (let i = from; i < to; i++) text += i === from ? words[i] : `${glued?.[i] ? '' : ' '}${words[i]}`;
  return text;
}

export function wrapText(
  text: string,
  font: FontSpec,
  maxWidth: number,
  maxLines = 2,
  measure: TextMeasurer = measureText,
  /** Names: a line may also break after `_`, `-`, `/` or `.` (NAME_BREAK). */
  breakAfter = false,
): { lines: string[]; truncated: boolean } {
  const lineLimit = Math.max(0, Math.floor(maxLines));
  if (lineLimit === 0) {
    return { lines: [], truncated: String(text).length > 0 };
  }
  // explicit '\n' in labels forces line breaks first
  const paragraphs = String(text).split('\n');
  if (paragraphs.length > 1) {
    const lines: string[] = [];
    let truncated = false;
    for (const p of paragraphs) {
      if (lines.length >= lineLimit) {
        truncated = true;
        break;
      }
      const sub = wrapText(p, font, maxWidth, lineLimit - lines.length, measure, breakAfter);
      lines.push(...sub.lines);
      truncated = truncated || sub.truncated;
    }
    return { lines, truncated };
  }

  const separate = wordsOf(text);
  // Prefer a connector at the end of its line: "UK &" / "Ireland".
  const words: string[] = [];
  for (const word of separate) {
    if (words.length > 0 && CONNECTOR.test(word)) words[words.length - 1] += ` ${word}`;
    else words.push(word);
  }
  const wrap = (list: readonly string[]) => {
    const pieces = breakAfter ? namePieces(list) : { words: list, glued: undefined };
    return wrapWords(pieces.words, font, maxWidth, lineLimit, measure, pieces.glued);
  };
  const joined = wrap(words);
  if (!joined.truncated || words.length === separate.length) return joined;
  // Keeping a connector must not cut a complete wrap or hide more of a name.
  const plain = wrap(separate);
  const source = separate.join(' ');
  const prefix = (lines: string[]) => {
    const drawn = lines.join(' ');
    let length = 0;
    while (length < source.length && length < drawn.length && source[length] === drawn[length]) length++;
    return length;
  };
  return !plain.truncated || prefix(plain.lines) > prefix(joined.lines) ? plain : joined;
}

/**
 * The words `wrapText` breaks between. Keeps non-breaking spaces inside a
 * token (note entries and number groups), and a BOM, which JavaScript counts
 * as white space but draws as a zero-width no-break character.
 */
function wordsOf(text: string): string[] {
  return String(text).split(/[^\S\u00a0\u202f\ufeff]+/).filter(Boolean);
}

function wrapWords(
  words: readonly string[], font: FontSpec, maxWidth: number, lineLimit: number, measure: TextMeasurer, glued?: readonly boolean[],
): { lines: string[]; truncated: boolean } {
  if (words.length === 0) return { lines: [], truncated: false };
  if (lineLimit === 1) {
    const fitted = ellipsize(joinPieces(words, glued, 0), font, maxWidth, measure);
    return { lines: [fitted.text], truncated: fitted.truncated };
  }
  const lines: string[] = [];
  let current = '';
  let truncated = false;
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const candidate = current ? `${current}${glued?.[i] ? '' : ' '}${word}` : word;
    if (measure(candidate, font).width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = '';
    if (lines.length === lineLimit - 1) {
      const fitted = ellipsize(joinPieces(words, glued, i), font, maxWidth, measure);
      lines.push(fitted.text);
      return { lines, truncated: truncated || fitted.truncated };
    }
    if (measure(word, font).width > maxWidth) {
      // A word wider than the line is cut on a line of its own, and the
      // words after it keep wrapping, so "Donaudampfschifffahrtsgesellschaft is
      // long" does not end at "Donaudampf…" with the rest dropped.
      lines.push(ellipsize(word, font, maxWidth, measure).text);
      truncated = true;
      // That cut word may have taken the second-to-last line: the rest then
      // shares the last one, or the text ran a line past maxLines.
      if (lines.length === lineLimit - 1 && i < words.length - 1) {
        lines.push(ellipsize(joinPieces(words, glued, i + 1), font, maxWidth, measure).text);
        return { lines, truncated };
      }
    } else {
      current = word;
    }
  }
  if (current) lines.push(current);
  return { lines, truncated };
}

export function ellipsize(
  text: string,
  font: FontSpec,
  maxWidth: number,
  measure: TextMeasurer = measureText,
): { text: string; truncated: boolean } {
  if (measure(text, font).width <= maxWidth) return { text, truncated: false };
  const ell = '…';
  if (measure(ell, font).width > maxWidth) return { text: '', truncated: true };
  // Cut between drawn clusters, never inside one. A prefix only grows
  // wider, so the longest one that fits with the ellipsis is found by
  // bisection instead of one measurement per dropped character.
  const clusters = graphemes(String(text));
  let fitting = 0;
  let over = clusters.length;
  while (over - fitting > 1) {
    const mid = (fitting + over) >> 1;
    if (measure(clusters.slice(0, mid).join('') + ell, font).width <= maxWidth) fitting = mid;
    else over = mid;
  }
  let s = clusters.slice(0, fitting).join('').trimEnd();
  // Prefer a nearby word boundary so the visible fragment still reads cleanly.
  // "Northern Eur…" reads worse than "Northern…"
  const lastSpace = s.lastIndexOf(' ');
  if (lastSpace > 0 && Array.from(s.slice(lastSpace + 1)).length <= 3) {
    s = s.slice(0, lastSpace).trimEnd();
  }
  return { text: s + ell, truncated: true };
}
