/**
 * Format-by-example: users (and AI agents) supply an example like "$1.2M",
 * "1.000,00", "(1,234)", "+20.5%", "EUR −1.234" — we infer the complete
 * formatting spec from it. This avoids
 * printf-style format strings entirely.
 */

import { NormalizeError } from './normalize/shared';
import type { RenderTarget } from './types/options';
import type { LintWarning, PlacedLabel, SceneNode } from './types/scene';

import { chartString } from './strings';
import { fractionFormat, numberFormat } from './numberFormatCache';
import { splitNumberMarks, wordLanguage } from './numberMarks';
import { currencyWholeNumbers, MAGNITUDE_SUFFIX, magnitudeSuffix, MINUS, formatPercent, nonFiniteGlyph, smallRateDecimals } from './format';
import {
  AUTO_MAX_DECIMALS,
  MAX_FORMAT_DECIMALS,
  checkedDecimals,
  belowPrecision,
  currentSmallValues,
  P_VALUE_DECIMALS,
  printsPValue,
  distinctDecimalLift,
  groupInteger,
  nonzeroDecimals,
  roundHalfUp,
  roundForDisplay,
  roundSignificant,
  roundsToZero,
  scientificParts,
  scientificText,
  underflowScientificText,
  withoutLeadingZero,
  zeroLifts,
  type SmallValues,
} from './formatPrecision';
import { maxOf, minOf } from './arrays';
import { withUnit } from './unitJoin';

/** A composing chart's generated example is still an automatic format. */
export const AUTOMATIC_FORMAT = Symbol('automatic-format');
export type AutomaticFormatSource = { [AUTOMATIC_FORMAT]?: true };
/** A composing chart's rows of one measure: they print in one magnitude, picked from their largest cell. */
export const MAGNITUDE_GROUP = Symbol('magnitude-group');
/** Figures of a group that print nowhere, by column: they still set the group's magnitude and precision. */
export const MAGNITUDE_FIGURES = Symbol('magnitude-figures');
export type MagnitudeGroupSource = { [MAGNITUDE_GROUP]?: string; [MAGNITUDE_FIGURES]?: readonly (readonly [string, number])[] };
/** A composing chart's row that prints a label and no value by design: its blank cells are no gap in the data, so it has no record. */
export const LABEL_ONLY_ROW = Symbol('label-only-row');
export type LabelOnlyRowSource = { [LABEL_ONLY_ROW]?: true };

export interface NumberFormatSpec {
  decimals: number;
  /**
   * Engine-selected format: a nonzero value must not print as zero. 'compact'
   * prints such a value as its bound ("<0.1", ">−0.1") where the full digits cost width.
   */
  automatic?: boolean | 'compact';
  /** Locale for unauthored number formats; explicit examples keep their separators. */
  locale?: string;
  /** Maximum significant digits after magnitude scale. Overrides `decimals` when set. */
  significantDigits?: number;
  /** '' means no grouping. */
  thousandsSep: '' | ',' | '.' | ' ' | "'";
  decimalSep: '.' | ',';
  magnitude: 'none' | 'k' | 'm' | 'bn' | 't';
  /** Divisor applied before rendering (derived from magnitude). */
  prefix: string;
  suffix: string;
  /** How negatives render. */
  negative: 'minus' | 'parens' | 'trailing';
  trailingMinus?: '-' | '−';
  /** Direction signs are separate from the unit and disappear on a printed zero. */
  glyphs?: { up: string; down: string; at: 'start' | 'end'; space: string };
  ordinal?: 'lower' | 'upper';
  exponent?: { letter: 'E' | 'e'; sign: '+' | ''; digits: number };
  /** The affix or a shared unit label already names the divisor. */
  magnitudeInAffix?: true;
  /** Carry a sign on positive values: '+' or a direction glyph. */
  signed: boolean;
  /** Unit rule: values that round to at least this print without decimals. */
  wholeFrom?: number;
  /** A whole count prints without decimals beside fractional values of its raster (funnel counts: '1' beside '0.6'). */
  wholeCounts?: boolean;
  /** Unformatted currency on a new target: unscaled magnitudes of at least 1,000 print whole. */
  currencyWhole?: boolean;
  /**
   * Hold `magnitude` where it is instead of rolling it up at 1000.
   * A table whose author forced one scale (`options.magnitude`) asked for
   * exactly that: every derived money column in thousands, so the reader
   * compares the numbers and not the letters after them. Parsing never sets
   * this — only a caller who forced the scale does.
   */
  lockMagnitude?: boolean;
  /** A row chose its own scale and decimals; do not roll individual cells up. */
  rollMagnitude?: false;
  /**
   * The engine chose `magnitude` from the largest value (no authored scale).
   * A value below that magnitude prints at its own (k, or none): "20", not
   * "0.00000002B" beside billions.
   */
  autoMagnitude?: true;
  /** The decimals every value under the engine scale shares at its own scale ("+0.50" beside "+0.04"). */
  stepDecimals?: number;
  /**
   * The magnitude word as the example wrote it, with the space before it
   * (" Mio.", "bn"): a value at that magnitude prints it. A value
   * the formatter rolls to another magnitude prints that magnitude's local
   * word (or letter for a letter example), so the word names the right scale.
   */
  magnitudeWord?: { magnitude: NumberFormatSpec['magnitude']; text: string };
  /**
   * A chart value formatter (exampleSpec) never prints a nonzero value as 0:
   * a free scale rolls down its word family ("$1.0 billion", not "$0.0
   * trillion"), a held scale lifts its decimals ("0.004k", not "0k"). A
   * table names its scale in a head and lifts in fitFormats instead.
   */
  nonzero?: true;
}

/**
 * The magnitude words an example may carry after its number: the letters k,
 * m, b and T and the abbreviation mm (glued, or spaced beside a currency: "12 m/s" is
 * metres per second and "50 B" bytes; T upper case only: "12 t" is tonnes),
 * the abbreviations mn, bn and tn, the German Tsd., Mio., Mrd. and Bio. (dot optional), and the
 * spelled-out words thousand, million, billion and trillion, German Tausend,
 * Million(en), Milliarde(n) and Billionen, and French milliard(s). "billion"
 * (German "Billion" and French "billion": 10¹²) reads as 10⁹, the smaller
 * scale, so no value below it prints as 0 and a larger one rolls up; a
 * German or French chart prints its own word for the scale a value takes
 * (localFamily), so the false friend never reaches the reader. Each must
 * end the word:
 * a letter or digit after it makes a unit ("kg", "m2", "m²"). A spelling
 * prints as MAGNITUDE_SUFFIX ("182.4M" for a "€1.2mn" example), unless the
 * caller keeps the authored word (`keepWord`; the value formatters do). An
 * unknown word would leave the value unscaled under a suffix that claims
 * millions, a factor of a million off: "512.0 million" for 512.
 */
const WORD_END = String.raw`(?![\p{L}\p{N}]|-\p{L})`;
const MAGNITUDE_SUFFIXES: Array<{ re: RegExp; key: Scale; glued?: true }> = [
  { re: new RegExp(String.raw`^(?:trillions?|billionen)${WORD_END}`, 'iu'), key: 't' },
  { re: new RegExp(String.raw`^(?:billions?|milliard(?:en?|s)?)${WORD_END}`, 'iu'), key: 'bn' },
  { re: new RegExp(String.raw`^(?:thousands?|tausend)${WORD_END}`, 'iu'), key: 'k' },
  { re: new RegExp(String.raw`^(?:millions?|millionen)${WORD_END}`, 'iu'), key: 'm' },
  { re: new RegExp(String.raw`^(?:tn|bio\.?)${WORD_END}`, 'iu'), key: 't' },
  { re: new RegExp(String.raw`^(?:bn|mrd\.?)${WORD_END}`, 'iu'), key: 'bn' },
  { re: new RegExp(String.raw`^(?:tsd\.?)${WORD_END}`, 'iu'), key: 'k' },
  { re: new RegExp(String.raw`^(?:mn|mio\.?)${WORD_END}`, 'iu'), key: 'm' },
  // Without a currency these letters must be glued: "1.5 T" stays tesla, "12 m/s" metres per second and "50 B" bytes,
  // while "$1.2T", "1.2m" and "50B" scale.
  { re: new RegExp(String.raw`^T${WORD_END}`, 'u'), key: 't', glued: true },
  { re: new RegExp(String.raw`^b${WORD_END}`, 'iu'), key: 'bn', glued: true },
  { re: new RegExp(String.raw`^k${WORD_END}`, 'iu'), key: 'k', glued: true },
  { re: new RegExp(String.raw`^(?:mm|m)${WORD_END}`, 'iu'), key: 'm', glued: true },
];

/** The one-letter spelling of every magnitude word `sameUnit` and `MAGNITUDE_UNIT` accept. */
const MAGNITUDE_WORD_LETTER: Record<string, string> = {
  bn: 'b', mn: 'm', mm: 'm', mio: 'm', mrd: 'b', tsd: 'k', thousand: 'k', thousands: 'k', tausend: 'k',
  million: 'm', millions: 'm', millionen: 'm', billion: 'b', billions: 'b', milliarde: 'b', milliarden: 'b',
  milliard: 'b', milliards: 'b', tn: 't', bio: 't', trillion: 't', trillions: 't', billionen: 't',
};

/** The most significant figures an `@` example names: a double holds 15 of them. */
const MAX_FIGURES = 15;

/**
 * A significant-figure example writes one `@` for each figure and no digit ("$@@@M",
 * "@@@%"). Any digit in the text makes it an ordinary example, and an `@` in it stays text.
 * Undefined for an ordinary example; otherwise the example with "1,234" for the run (grouped, as a count is) and the count.
 */
function figureExample(s: string): { standIn: string; figures: number } | undefined {
  if (!s.includes('@') || /[0-9]/.test(s)) return undefined;
  const runs = s.match(/@+/g)!;
  if (runs.length > 1) {
    const fixed = s.slice(0, s.indexOf('@')) + '@'.repeat(runs.join('').length) + s.slice(s.lastIndexOf('@') + 1);
    throw new NormalizeError('invalid-format', 'format', `invalid-format-example: '${s}' splits its significant figures into more than one run of @; the engine places the decimal mark and the group marks`, `write one run of @, e.g. '${fixed}'`);
  }
  if (runs[0]!.length > MAX_FIGURES) {
    throw new NormalizeError('invalid-format', 'format', `invalid-format-example: '${s}' asks for ${runs[0]!.length} significant figures; the most is ${MAX_FIGURES}`, `write at most ${MAX_FIGURES} @`);
  }
  return { standIn: s.replace('@'.repeat(runs[0]!.length), '1,234'), figures: runs[0]!.length };
}

/** A spec for each example text; callers change what they get, so every read is a copy. */
const parsedExamples = new Map<string, NumberFormatSpec>();
const MAX_PARSED_EXAMPLES = 2048;

function copySpec(spec: NumberFormatSpec): NumberFormatSpec {
  const copy = { ...spec };
  if (spec.magnitudeWord) copy.magnitudeWord = { ...spec.magnitudeWord };
  if (spec.glyphs) copy.glyphs = { ...spec.glyphs };
  if (spec.exponent) copy.exponent = { ...spec.exponent };
  return copy;
}

export function parseFormatExample(example: string, keepWord = false): NumberFormatSpec {
  const key = `${keepWord ? 'w' : 'n'}${String(example)}`;
  const known = parsedExamples.get(key);
  if (known) return copySpec(known);
  const spec = parseExample(example, keepWord);
  if (parsedExamples.size >= MAX_PARSED_EXAMPLES) parsedExamples.clear();
  parsedExamples.set(key, copySpec(spec));
  return spec;
}

function parseExample(example: string, keepWord: boolean): NumberFormatSpec {
  const s = formatExampleText(String(example)).trim();
  const figures = figureExample(s);
  if (figures) {
    // The "1,234" is a stand-in: grouped, no decimals. The grouped digits before a magnitude lock the scale; a figure count rolls up at 1000.
    const spec = parseFormatExample(figures.standIn, keepWord);
    // A magnitude inside a currency affix ("USDm @@@") fixes the scale: the affix cannot name another one.
    if (!spec.magnitudeInAffix) delete spec.rollMagnitude;
    spec.significantDigits = figures.figures;
    spec.decimals = Math.min(MAX_FORMAT_DECIMALS, figures.figures - 1);
    return spec;
  }

  const spec: NumberFormatSpec = {
    decimals: 0,
    thousandsSep: '',
    decimalSep: '.',
    magnitude: 'none',
    prefix: '',
    suffix: '',
    negative: 'minus',
    signed: false,
  };

  // Locate the numeric body (digits with optional . , ' and space groupings).
  const hasParens = /[()]/.test(s);
  // A parenthesis ends the number, so "1,234 (2020 USD)" keeps 2020 as text.
  const bodyMatch = numericBody(s);
  if (!bodyMatch) {
    throw new NormalizeError('invalid-format', 'format', 'invalid-format-example: format examples must contain at least one digit', "write an example number as it should print, e.g. '1,234' or '12.5%'");
  }
  const body = bodyMatch.text.trimEnd(); // trailing spaces belong to suffix
  let before = s.slice(0, bodyMatch.index);
  let after = s.slice(bodyMatch.index + body.length);
  if (hasParens) {
    // One pair around the number means accounting, even with units outside it
    // ("$(1,234)", "(1.234) €"). A pair that opens with a note ("(n=1,234)") and
    // a pair beside the number ("1,234 (kg)") are literal text, as before.
    const open = before.lastIndexOf('(');
    const close = after.indexOf(')');
    const pairs = (text: string) => /^[^()]*(?:\([^()]*\)[^()]*)*$/.test(text);
    const accounting = open >= 0 && close >= 0 && !before.slice(open).includes(')') && !after.slice(0, close).includes('(');
    // Digits of a unit name ("CO2 (1.2)") are text, not a second number.
    const outside = (before.slice(0, open) + after.slice(close + 1)).replace(/[0-9]+/g, (run, at: number, text: string) =>
      /\p{L}$/u.test(text.slice(Math.max(0, at - 2), at)) || /^\p{L}/u.test(text.slice(at + run.length, at + run.length + 2)) ? '' : run);
    if (accounting ? /[()0-9]/.test(outside) : !pairs(before) || !pairs(after)) {
      throw new NormalizeError('invalid-format', 'format', 'invalid-format-example: parentheses must enclose one example number and its units, or sit beside it as balanced text', "write an example number as it should print, e.g. '($1,234)' for negatives in parentheses or '1,234 (kg)' for a unit");
    }
    if (accounting && !/[=:]/.test(before.slice(open))) {
      spec.negative = 'parens';
      before = before.slice(0, open) + before.slice(open + 1);
      after = after.slice(0, close) + after.slice(close + 1);
    }
  }

  // Sign markers in the leading part.
  let lead;
  [lead, after] = exampleSigns(spec, before, after, s);
  if (/[+]/.test(lead)) {
    spec.signed = true;
    lead = lead.replace(/\+/g, '');
  }
  lead = lead.replace(new RegExp(`[-${MINUS}]`, 'g'), '');
  spec.prefix = lead.trimStart();

  // Trailing part: magnitude suffix then unit suffix.
  let tail = after.trimEnd();
  const tailTrimmed = tail.trimStart();
  for (const m of MAGNITUDE_SUFFIXES) {
    const word = magnitudeAfterNumber(m, lead, tail, tailTrimmed);
    if (word) {
      spec.magnitude = m.key;
      // "€1.2bn" prints "bn", "1,2 Mio. €" prints " Mio."; the letter is the engine's spelling.
      if (keepWord) spec.magnitudeWord = { magnitude: m.key, text: tail.slice(0, tail.length - tailTrimmed.length) + word[0] };
      tail = tailTrimmed.replace(m.re, '');
      break;
    }
  }
  spec.suffix = tail; // keep remaining unit text (e.g. '%', 'pp', ' €')
  affixMagnitude(spec);

  // Analyze the numeric body for separators.
  analyzeBody(body, spec);
  exampleNumberStyle(spec, body);
  checkedDecimals(spec.decimals);
  // An example that groups the digits before its magnitude ('1,234k', '$1,234.5M') shows four
  // digits in that magnitude: every value prints in it ("1,080k"), none rolls to the next letter.
  if (spec.magnitude !== 'none' && spec.thousandsSep !== '') spec.rollMagnitude = false;
  return spec;
}

/**
 * Spreadsheet number-code placeholder runs and section marks, which no
 * format-by-example prints: a # or ? beside another placeholder, a comma or
 * a dot, or a ; section. A lone # before a digit is a literal ("#0", "#1").
 */
const SPREADSHEET_CODE = /[#?][#?,.]|[,.][#?]|;/;
const SPREADSHEET_BRACKET = /^\[(?:Black|Blue|Cyan|Green|Magenta|Red|White|Yellow|Color(?:[1-9]|[1-4][0-9]|5[0-6])|[<>=][^\]]*|\$[^\]]*)\]$/i;
const SPREADSHEET_SCALE_COMMAS = /[0#?](,+)(?=\s*(?:$|["\\_[;]))/;

/** Remove Excel colour, condition and locale brackets in one pass; other bracket text stays. */
function withoutSpreadsheetBrackets(text: string): string {
  let out = '';
  let at = 0;
  for (let open = text.indexOf('['); open >= 0; open = text.indexOf('[', at)) {
    const close = text.indexOf(']', open + 1);
    if (close < 0) break;
    out += text.slice(at, open);
    const bracket = text.slice(open, close + 1);
    if (!SPREADSHEET_BRACKET.test(bracket)) out += bracket;
    at = close + 1;
  }
  return out + text.slice(at);
}

function isSpreadsheetCode(text: string): boolean {
  const withoutInstructions = withoutSpreadsheetBrackets(text);
  return SPREADSHEET_CODE.test(text) || (!/[1-9]/.test(withoutInstructions)
    && (withoutInstructions !== text || /"|\\|_[()]|\* |[Ee][+-]0+/.test(text) || SPREADSHEET_SCALE_COMMAS.test(text)));
}

type CodeToken = { text: string; literal: boolean; at: number };

/** Quoted and escaped characters stay literal; display instructions do not print. */
function spreadsheetSections(code: string): CodeToken[][] | undefined {
  const sections: CodeToken[][] = [[]];
  for (let i = 0; i < code.length; i++) {
    const char = code[i]!;
    const section = sections[sections.length - 1]!;
    if (char === ';') { sections.push([]); continue; }
    if (char === '"') {
      const end = code.indexOf('"', i + 1);
      if (end < 0) return undefined;
      section.push({ text: code.slice(i + 1, end), literal: true, at: i });
      i = end;
    } else if (char === '\\') {
      if (++i === code.length) return undefined;
      section.push({ text: code[i]!, literal: true, at: i });
    } else if (char === '[') {
      const end = code.indexOf(']', i + 1);
      if (end < 0) return undefined;
      const currency = /^\$(.*?)(?:-[0-9a-f]+)?$/i.exec(code.slice(i + 1, end));
      if (currency) section.push({ text: currency[1]!, literal: true, at: i });
      else if (!SPREADSHEET_BRACKET.test(code.slice(i, end + 1))) section.push({ text: code.slice(i, end + 1), literal: true, at: i });
      i = end;
    } else if (char === '_' || char === '*') {
      if (++i === code.length) return undefined;
    } else section.push({ text: char, literal: false, at: i });
  }
  return sections;
}

/** Translate spreadsheet placeholders to an example without changing the numeric divisor. */
export function spreadsheetExample(code: string): { example: string; notes: string[] } | undefined {
  if (!isSpreadsheetCode(code)) return undefined;
  const sections = spreadsheetSections(code);
  if (!sections || sections.length > 4) return undefined;
  let tokens = sections[0]!;
  const digit = (token: CodeToken) => !token.literal && /^[0-9#?]$/.test(token.text);
  const first = tokens.findIndex(digit);
  if (first < 0) return undefined;
  let exponent = '';
  const e = tokens.findIndex((token, index) => index > first && !token.literal && /^[Ee]$/.test(token.text)
    && /^[+-]$/.test(tokens[index + 1]?.text ?? '') && tokens[index + 2]?.text === '0');
  if (e >= 0) {
    let end = e + 2;
    while (tokens[end]?.text === '0' && !tokens[end]!.literal) end++;
    exponent = tokens.slice(e, end).map(token => token.text).join('').replace(/0+$/, zeros => '0'.repeat(Math.max(zeros.length - 1, 0)) + '6');
    tokens = [...tokens.slice(0, e), ...tokens.slice(end)];
  }
  let last = tokens.length - 1;
  while (last >= first && !digit(tokens[last]!)) last--;
  const body = tokens.slice(first, last + 1);
  if (body.some(token => token.literal) || !/^[0-9#?,]+(?:\.[0-9#?]+)?$/.test(body.map(token => token.text).join(''))) return undefined;
  const numeric = body.map(token => token.text).join('');
  const [integer, fraction = ''] = numeric.split('.');
  const grouped = /[0-9#?],[0-9#?]{2,}/.test(integer!);
  const decimals = fraction.length;
  let end = last + 1;
  if (SPREADSHEET_SCALE_COMMAS.exec(code.slice(tokens[last]!.at))?.index === 0) {
    while (tokens[end]?.text === ',' && !tokens[end]!.literal) end++;
  }
  const commas = end - last - 1;
  if (commas > 4 || (exponent && commas > 0)) return undefined;
  const magnitude: NumberFormatSpec['magnitude'] = (['none', 'k', 'm', 'bn', 't'] as const)[commas]!;
  const suffix = tokens.slice(end);
  const literalScale = (token: CodeToken) => token.literal && MAGNITUDE_SUFFIXES.some(entry => {
    const word = entry.re.exec(token.text.trim());
    return word?.[0] === token.text.trim();
  });
  const scaleLiterals = tokens.filter(literalScale);
  if (scaleLiterals.some(token => commas === 0 || unitMagnitude(token.text.trim()) !== magnitude)) return undefined;
  // A magnitude before the number cannot be expressed as a suffix without moving authored text.
  if (tokens.slice(0, first).some(literalScale)) return undefined;
  const notes: string[] = [];
  if (sections.length > 2) notes.push('zero and text sections are dropped');
  if (tokens.some(token => token.text.includes('%'))) notes.push('percent values are percent points: 12.5 prints 12.5%');
  const added = commas > 0 && scaleLiterals.length === 0 ? MAGNITUDE_LABEL[magnitude] : '';
  if (added) notes.push(`the scale letter '${added}' is added for ${commas} trailing comma${commas === 1 ? '' : 's'}`);
  const whole = grouped ? (commas === 1 && decimals === 0 ? '1,235' : '1,234') : decimals === 3 ? '0' : '1';
  const digits = grouped ? `5${'0'.repeat(Math.max(0, decimals - 1))}` : decimals === 3 ? '555' : '23456789012345678901'.slice(0, decimals);
  let example = tokens.slice(0, first).map(token => token.text).join('') + whole + (decimals ? `.${digits}` : '')
    + exponent + added + suffix.map(token => token.text).join('');
  const negative = sections[1]?.map(token => token.text).join('').trim();
  if (negative?.startsWith('(') && negative.endsWith(')') && sections[1]!.some(digit)) example = `(${example})`;
  if (isSpreadsheetCode(example)) return undefined;
  // The translated example must carry the divisor in its printed scale, never only in literal text.
  try {
    const parsed = parseFormatExample(example, true);
    if (parsed.decimals !== decimals || (parsed.thousandsSep !== '') !== (grouped && !exponent) || parsed.magnitude !== magnitude) return undefined;
  } catch { return undefined; }
  return { example, notes };
}

function isCurrency(text: string): boolean {
  const trimmed = text.trim();
  return /^\p{Sc}$/u.test(trimmed) || CURRENCY_CODES.has(trimmed.toUpperCase());
}

function currencyAffixMagnitude(text: string): NumberFormatSpec['magnitude'] | undefined {
  // Every magnitude word has an ASCII letter; a symbol or a space alone names no scale.
  if (!/[A-Za-z]/.test(text)) return undefined;
  const trimmed = text.trim();
  if (!/^[\p{Sc}\p{L}. ]+$/u.test(trimmed)) return undefined;
  const magnitude = unitMagnitude(trimmed);
  if (!magnitude) return undefined;
  return /\p{Sc}/u.test(trimmed) || CURRENCY_CODES.has(trimmed.slice(0, 3).toUpperCase()) || CURRENCY_CODES.has(trimmed.slice(-3).toUpperCase()) ? magnitude : undefined;
}

/** A unit alone chooses its placement and scale; chart data supplies its precision. */
function unitOnlyExample(text: string): string | undefined {
  if (/[0-9]/.test(text)) return undefined;
  const unit = text.trim();
  if (/^(?:%|pp|x|×)$/.test(unit)) return `1.2${unit}`;
  if (/^\p{Sc}$/u.test(unit)) return `${unit}1,234`;
  if (CURRENCY_CODES.has(unit.toUpperCase())) return `1.2 ${unit}`;
  if (!currencyAffixMagnitude(unit)) return undefined;
  const symbol = /^\p{Sc}/u.exec(unit)?.[0];
  return symbol ? `${symbol}1.2${unit.slice(symbol.length)}` : /\p{Sc}$/u.test(unit) ? `1.2${unit}` : `1.2 ${unit}`;
}

/** The ordinary example every reader uses, including callers before request resolution. */
export function formatExampleText(example: string): string {
  if (isSpreadsheetCode(example)) {
    const translated = spreadsheetExample(example);
    if (translated) return translated.example;
    throw new NormalizeError('invalid-format', 'format', `invalid-format-example: '${example}' is a spreadsheet number code, not a format-by-example; write an example number as it should print`, "write an example number as it should print, e.g. '1,234' instead of '#,##0'");
  }
  return unitOnlyExample(example) ?? example;
}

const DIRECTION_GLYPHS = [['▲', '▼'], ['△', '▽'], ['↑', '↓'], ['⬆', '⬇'], ['▴', '▾']].map(([up, down]) => (
  { up: up!, down: down!, start: new RegExp(`^[${up}${down}](\\s?)`), end: new RegExp(`(\\s?)[${up}${down}]$`) }));
const ANY_GLYPH = /^[▲▼△▽↑↓⬆⬇▴▾]|[▲▼△▽↑↓⬆⬇▴▾]$/;

function exampleSigns(spec: NumberFormatSpec, before: string, after: string, example: string): [string, string] {
  if (before.includes('±')) before = before.replace(/±/g, '+');
  const last = example.charCodeAt(example.length - 1);
  // Only an example that ends in a minus can carry a trailing one.
  const trailing = last === 0x2d || last === 0x2212 ? /([^\s])([-−])$/.exec(before + '0' + after) : null;
  if (trailing && !/[-−]/.test((before + after).slice(0, -1))) {
    after = after.slice(0, -1);
    if (spec.negative !== 'parens') {
      spec.negative = 'trailing';
      spec.trailingMinus = trailing[2] as '-' | '−';
    }
  }
  if (!ANY_GLYPH.test(example)) return [before, after];
  for (const { up, down, start: startPattern, end: endPattern } of DIRECTION_GLYPHS) {
    const start = startPattern.exec(example);
    const end = endPattern.exec(example);
    if (!start && !end) continue;
    spec.glyphs = { up, down, at: start ? 'start' : 'end', space: (start ?? end)![1]! };
    spec.signed = true;
    if (start) before = before.replace(start[0], '');
    else after = after.slice(0, -end![0].length);
    break;
  }
  return [before, after];
}

function magnitudeAfterNumber(entry: typeof MAGNITUDE_SUFFIXES[number], lead: string, tail: string, trimmed: string): RegExpExecArray | null {
  const word = entry.re.exec(trimmed);
  if (!word || !entry.glued || tail === trimmed) return word;
  return !trimmed.slice(word[0].length).startsWith('/') && (isCurrency(lead) || isCurrency(trimmed.slice(word[0].length))) ? word : null;
}

function affixMagnitude(spec: NumberFormatSpec): void {
  if (spec.magnitude !== 'none' || (spec.prefix === '' && spec.suffix === '')) return;
  const magnitude = currencyAffixMagnitude(spec.prefix) ?? currencyAffixMagnitude(spec.suffix);
  if (magnitude) {
    spec.magnitude = magnitude;
    spec.magnitudeInAffix = true;
    spec.rollMagnitude = false;
  }
}

function exampleNumberStyle(spec: NumberFormatSpec, body: string): void {
  const exponent = /^([Ee])([+-]?)([0-9]+)/.exec(spec.suffix);
  if (exponent) {
    spec.exponent = { letter: exponent[1] as 'E' | 'e', sign: exponent[2] === '+' ? '+' : '', digits: exponent[3]!.length };
    spec.suffix = spec.suffix.slice(exponent[0].length);
    spec.thousandsSep = '';
    const point = Math.max(body.lastIndexOf('.'), body.lastIndexOf(','));
    spec.decimals = point < 0 ? 0 : body.length - point - 1;
    spec.decimalSep = point >= 0 && body[point] === ',' ? ',' : '.';
    spec.rollMagnitude = false;
  }
  const ordinal = /^(st|nd|rd|th)(?![\p{L}\p{N}])/iu.exec(spec.suffix);
  if (ordinal && spec.decimals === 0 && spec.magnitude === 'none') {
    spec.ordinal = ordinal[0] === ordinal[0].toUpperCase() ? 'upper' : 'lower';
    spec.suffix = spec.suffix.slice(ordinal[0].length);
  }
}

/**
 * Why `example` is not a format-by-example, with the example to write
 * instead (the spreadsheet code's own grouping and decimals applied to
 * 1234); undefined when it parses.
 */
export function formatExampleProblem(example: string): { message: string; replacement: string } | undefined {
  // An empty format is no format: the data sets the precision, as before.
  if (example === '') return undefined;
  try {
    parseFormatExample(example);
    return undefined;
  } catch (error) {
    // Figures split over runs, or past the most: one run of at most MAX_FIGURES @.
    if (example.includes('@') && !/[0-9]/.test(example)) {
      const figures = Math.min(MAX_FIGURES, example.replace(/[^@]/g, '').length);
      return { message: (error as Error).message, replacement: example.slice(0, example.indexOf('@')) + '@'.repeat(figures) + example.slice(example.lastIndexOf('@') + 1) };
    }
    const code = example.replace(/"/g, '').replace(/;.*$/, '');
    let replacement = '1,234';
    try {
      replacement = formatterFromExample(code.replace(/[#?]/g, '1'), undefined)(1234);
    } catch {
      // No number at all: a unit alone keeps its place beside the example.
      const unit = code.trim();
      if (/^[$€£¥]$/.test(unit)) replacement = `${unit}1,234`;
      else if (/^(?:%|pp|x|[A-Z]{3})$/.test(unit)) replacement = `1,234${/^[A-Z]/.test(unit) ? ' ' : ''}${unit}`;
    }
    return { message: (error as Error).message, replacement };
  }
}

/** One dot before three digits ("1.234", "$12.345M"): a thousands group to one reader, three decimals to another. */
const GROUP_OR_DECIMALS = /^[1-9][0-9]{0,2}\.[0-9]{3}$/;

/** `example` with no integer part left to group, which reads as decimals ("$1.234M" as "$0.234M"); undefined where it reads one way only. */
function decimalExample(example: string): string | undefined {
  example = formatExampleText(example);
  const body = numericBody(example);
  const text = body?.text.trimEnd();
  if (text === undefined || !GROUP_OR_DECIMALS.test(text)) return undefined;
  if (/^[Ee][+-]?[0-9]+/.test(example.slice(body!.index + text.length))) return undefined;
  return example.slice(0, body!.index) + text.replace(/^[0-9]+/, '0') + example.slice(body!.index + text.length);
}

/**
 * How a chart with `numbers` reads `example`. The data decides a `GROUP_OR_DECIMALS`
 * example, as a group needs four digits to show: where every number stays below
 * 1000 and one has a fraction, it names three decimals, so 0.512 prints "0.512"
 * and not "1" (`decimals`). Where the numbers reach 1000 it stays a group, and
 * `lost` is the first small number that group rounds to a whole one.
 */
function exampleReading(example: string, numbers: readonly number[]): { decimals?: string; lost?: number } {
  const decimals = decimalExample(example);
  if (decimals === undefined) return {};
  const divisor = MAGNITUDE_DIVISOR[parseFormatExample(example).magnitude];
  const lost = numbers.find((value) => Math.abs(value) / divisor < 1000 && !Number.isInteger(value / divisor));
  if (lost === undefined) return {};
  return maxOf(numbers.map((value) => Math.abs(value))) / divisor < 1000 ? { decimals } : { lost };
}

function isPlainTree(node: unknown): node is Record<string, unknown> {
  if (typeof node !== 'object' || node === null) return false;
  const proto = Object.getPrototypeOf(node) as unknown;
  return proto === Object.prototype || proto === Array.prototype || proto === null;
}

/** `node` with each format example passed through `change`, the same object where nothing changed. */
function mapExamples<T>(node: T, change: (example: string, owner: Record<string, unknown>, path: (string | number)[]) => string, seen = new Map<unknown, unknown>(), keys: 'format' | 'all' | 'none' = 'format', path: (string | number)[] = [], plain?: { value: boolean }): T {
  if (!isPlainTree(node)) return node;
  if (seen.has(node)) return seen.get(node) as T;
  seen.set(node, node);
  let changed: Record<string, unknown> | undefined;
  for (const key of Object.keys(node)) {
    const descriptor = plain && Object.getOwnPropertyDescriptor(node, key);
    const child = node[key];
    // A getter or a Proxy can answer differently on the next read, so the second collection pass still runs.
    if (plain && (!descriptor || !('value' in descriptor) || !Object.is(descriptor.value, child))) plain.value = false;
    const example = keys === 'all' || (keys === 'format' && key === 'format');
    // `cells` is keyed by column id, so a text column named format holds no example; a cell object's own format does.
    const childPath = [...path, Array.isArray(node) ? Number(key) : key];
    const next = typeof child === 'string' ? (example ? change(child, node, childPath) : child)
      : mapExamples(child, change, seen, key === 'axisFormat' ? 'all' : key === 'cells' ? 'none' : 'format', childPath, plain);
    if (next === child) continue;
    changed ??= Array.isArray(node) ? [...node] as unknown as Record<string, unknown> : Object.assign(Object.create(Object.getPrototypeOf(node) as object | null) as object, node) as Record<string, unknown>;
    changed[key] = next;
  }
  seen.set(node, changed ?? node);
  return (changed ?? node) as T;
}

/** Every finite number in `node`, the keys of a table or a chart that are no values included. */
function treeNumbers(node: unknown, into: number[] = [], seen = new Set<unknown>()): number[] {
  if (typeof node === 'number') {
    if (Number.isFinite(node)) into.push(node);
  } else if (isPlainTree(node) && !seen.has(node)) {
    seen.add(node);
    for (const key of Object.keys(node)) treeNumbers(node[key], into, seen);
  }
  return into;
}

/**
 * The chart's data and options with each format example read by that data
 * (`exampleReading`), and a warning where a group rounds a small number.
 * Each chart gets one reading, taken from all of its numbers. A number that is
 * not a data value counts too. Fields are not read one by one.
 */
export function readFormatExamples<D, O>(data: D, options: O): { data: D; options: O; warnings: LintWarning[] } {
  const warnings: LintWarning[] = [];
  const warned = new Set<string>();
  let allNumbers: number[] | undefined;
  const numbersOf = (owner: Record<string, unknown>): number[] | undefined => {
    const own = normalizedSeriesNumbers(owner);
    if (own) return own;
    const table = data as { columns?: { id?: string }[]; rows?: { cells?: Record<string, unknown>; children?: unknown[] }[] };
    if (Array.isArray(table?.columns) && table.columns.some(column => column === owner) && typeof owner.id === 'string') {
      const cells: unknown[] = [];
      const collect = (rows: typeof table.rows): void => {
        for (const row of rows ?? []) {
          cells.push(row.cells?.[owner.id as string]);
          if (Array.isArray(row.children)) collect(row.children as typeof table.rows);
        }
      };
      collect(table.rows);
      return normalizedSeriesNumbers({ values: cells });
    }
    return allNumbers ??= treeNumbers(data);
  };
  const rewrite = (example: string, owner: Record<string, unknown>, field: (string | number)[]): string => {
    const translated = spreadsheetExample(example);
    if (translated) {
      if (!warned.has(example)) {
        warned.add(example);
        warnings.push({ code: 'format-spreadsheet-code', severity: 'warn',
          message: `format '${example}' is a spreadsheet number code, so the chart prints it as the example '${translated.example}'${translated.notes.length ? `; ${translated.notes.join('; ')}` : ''}`,
          suggest: `write the example '${translated.example}' instead`, field });
      }
      return translated.example;
    }
    const standIn = unitOnlyExample(example);
    if (!standIn) return example;
    const numbers = numbersOf(owner);
    if (!numbers?.length) return standIn;
    const spec = parseFormatExample(standIn);
    // The smallest nonzero value below 1 keeps two significant digits, so no value of the field prints as 0.
    let smallest = Infinity;
    for (const value of numbers) {
      const scaled = Math.abs(value / MAGNITUDE_DIVISOR[spec.magnitude]);
      if (scaled > 0 && scaled < smallest) smallest = scaled;
    }
    const figures = smallest < 1 ? Math.min(MAX_FORMAT_DECIMALS, 1 - Math.floor(Math.log10(smallest))) : 0;
    const decimals = Math.max(rasterDecimals(numbers, spec), figures);
    const body = numericBody(standIn)!;
    const whole = spec.thousandsSep ? '1,234' : decimals === 3 ? '0' : '1';
    return standIn.slice(0, body.index) + whole + (decimals ? `.${'5'.repeat(decimals)}` : '') + standIn.slice(body.index + body.text.trimEnd().length);
  };
  const examples = new Set<string>();
  const collect = (example: string) => {
    if (decimalExample(example) !== undefined) examples.add(example);
    return example;
  };
  const originalData = data, originalOptions = options;
  const plain = { value: true };
  const rewriteAndCollect = (example: string, owner: Record<string, unknown>, field: (string | number)[]) => collect(rewrite(example, owner, field));
  data = mapExamples(data, rewriteAndCollect, undefined, 'format', ['data'], plain);
  options = mapExamples(options, rewriteAndCollect, undefined, 'format', ['options'], plain);
  // Rewrites can change aliases, and getters can change the second reading.
  if (!plain.value || data !== originalData || options !== originalOptions) {
    examples.clear();
    mapExamples(data, collect);
    mapExamples(options, collect);
  }
  if (examples.size === 0) return { data, options, warnings };
  const numbers = treeNumbers(data);
  const readings = new Map([...examples].map((example) => [example, exampleReading(example, numbers)]));
  const change = (example: string) => readings.get(example)?.decimals ?? example;
  return {
    data: mapExamples(data, change),
    options: mapExamples(options, change),
    warnings: [...warnings, ...[...readings].flatMap(([example, { lost }]) => lost === undefined ? [] : [{
      code: 'format-reads-as-group',
      severity: 'warn' as const,
      message: `format '${example}' reads as a thousands group on this chart, so ${lost} prints ${formatWithSpec(lost, parseFormatExample(example))}`,
      suggest: `write ${JSON.stringify(decimalExample(example))} for three decimals, or remove the format to let the engine pick the precision`,
    }])],
  };
}

/** A number run; a leading separator counts when a digit follows and no letter precedes (".5", not "Fr.5"). */
/** The spaces a format example groups digits with: space, no-break space, narrow no-break space (what `Intl` prints for fr-FR) and thin space. */
const GROUP_SPACES = ' \u00a0\u202f\u2009';

const NUMBER_RUN = new RegExp(`(?:(?<!\\p{L})[.,](?=[0-9]))?[0-9][0-9.,'${GROUP_SPACES}]*`, 'u');

/**
 * The example's number. Digits after a letter belong to a unit name
 * ("CO2 1.2", "H2O 12", "m2 12", "PM2.5 1.2", "CO2 (1.2)"): when another
 * number follows, that one is the body and the unit name is text. A note in
 * parentheses ("EUR1bn (2020 USD)") is not a number. Without a second
 * number ("EUR1.2") the glued run stays the body. Digits before a letter
 * stay the number ("$1M in 2020 prices", "1kg / 100m²").
 */
function numericBody(s: string): { index: number; text: string } | null {
  const first = NUMBER_RUN.exec(s);
  if (!first) return null;
  const body = { index: first.index, text: first[0] };
  if (!/\p{L}$/u.test(s.slice(0, first.index))) return body;
  // A unit name keeps its digits up to the next space ("2.5" of "PM2.5 1.2"); the run may run on over the space into the number.
  const unitEnd = first.index + /^[^\s\u00a0\u202f]+/u.exec(first[0])![0].length;
  // The next number stands apart: no letter, digit or separator before it, and not inside a note ("(2020 USD)").
  const runs = new RegExp(NUMBER_RUN.source, 'gu');
  runs.lastIndex = unitEnd;
  for (let run = runs.exec(s); run; run = runs.exec(s)) {
    if (/[Ee][+-]?$/.test(s.slice(0, run.index))) continue;
    if (/[\p{L}\p{N}.,]$/u.test(s.slice(0, run.index))) continue;
    const open = s.lastIndexOf('(', run.index);
    const note = open > s.lastIndexOf(')', run.index) && /\p{L}/u.test(s.slice(open, s.indexOf(')', run.index) >>> 0));
    if (!note) return { index: run.index, text: run[0] };
  }
  return body;
}

function analyzeBody(body: string, spec: NumberFormatSpec): void {
  const seps = body.match(new RegExp(`[.,'${GROUP_SPACES}]`, 'g')) ?? [];
  if (seps.length === 0) {
    spec.decimals = 0;
    return;
  }
  const lastSep = seps[seps.length - 1]!;
  const lastIdx = body.lastIndexOf(lastSep);
  const digitsAfterLast = body.length - lastIdx - 1;
  const uniqueSeps = [...new Set(seps)];

  const asThousands = (ch: string) => {
    spec.thousandsSep = normalizeSep(ch);
    spec.decimalSep = ch === '.' ? ',' : '.';
    spec.decimals = 0;
  };
  const asDecimal = (ch: string) => {
    spec.decimalSep = ch === ',' ? ',' : '.';
    spec.thousandsSep = '';
    spec.decimals = digitsAfterLast;
  };

  if (uniqueSeps.length > 1) {
    // Two different separators: the last one is decimal, the other grouping.
    const decimal = lastSep!;
    const grouping = uniqueSeps.find((c) => c !== decimal)!;
    spec.decimalSep = decimal === ',' ? ',' : '.';
    spec.thousandsSep = normalizeSep(grouping);
    spec.decimals = digitsAfterLast;
    return;
  }

  const ch = uniqueSeps[0]!;
  // Space/prime, repeated separators and three trailing digits imply grouping,
  // except after a zero or empty integer part: "0.125" and ".125" are decimals.
  const fractionOnly = /^0?$/.test(body.slice(0, lastIdx));
  if (GROUP_SPACES.includes(ch) || ch === "'" || seps.length > 1 || (digitsAfterLast === 3 && !fractionOnly)) asThousands(ch);
  else asDecimal(ch);
}

function normalizeSep(ch: string): NumberFormatSpec['thousandsSep'] {
  if (GROUP_SPACES.includes(ch)) return ' ';
  return ch as NumberFormatSpec['thousandsSep'];
}

export const MAGNITUDE_DIVISOR: Record<NumberFormatSpec['magnitude'], number> = {
  none: 1,
  k: 1e3,
  m: 1e6,
  bn: 1e9,
  t: 1e12,
};

export const MAGNITUDE_LABEL: Record<NumberFormatSpec['magnitude'], string> = MAGNITUDE_SUFFIX;

/**
 * Whether two unit strings name the same unit, ignoring case, spaces and the
 * spelling of the magnitude: "$bn", "$ B" and "$b" are one unit, as are
 * "€m", "€mn" and "€M". The formatters print one spelling (MAGNITUDE_SUFFIX),
 * and an author may still write the others.
 */
export function sameUnit(a: string, b: string): boolean {
  const canonical = (unit: string) =>
    unit.toLowerCase().replace(/\b(bn|mn|mm|mio|mrd|tsd|tn|bio|thousands?|tausend|millions?|millionen|billions?|billionen|trillions?|milliard(?:en?|s)?)\b\.?/gu, (_, word: string) => MAGNITUDE_WORD_LETTER[word]!).replace(/\s+/gu, '');
  return canonical(a) === canonical(b);
}

/**
 * Whether two groups of values of one measure are in one scale: false when
 * their medians are 1000 times or more apart. A spark given in
 * millions beside a card in euros is a thousand-thousandfold off, and one
 * format printed it as "€0.00B". A group with no finite value, or a median
 * of zero, has no scale to compare, so it passes. A genuine difference below
 * 1000x stays valid.
 */
export function sameScale(a: Iterable<number | null | undefined>, b: Iterable<number | null | undefined>): boolean {
  const median = (values: Iterable<number | null | undefined>): number => {
    const sorted = [...values].flatMap((value) => (typeof value === 'number' && Number.isFinite(value) ? [Math.abs(value)] : [])).sort((x, y) => x - y);
    if (sorted.length === 0) return 0;
    const middle = sorted.length >> 1;
    return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  };
  const [ma, mb] = [median(a), median(b)];
  return ma === 0 || mb === 0 || Math.max(ma, mb) / Math.min(ma, mb) < 1000;
}

/**
 * The unit a money format carries per cell ('€' + 'M' → '€M'), or null
 * when there is nothing to hoist. Tables hoist this into the frame unit
 * or the column header so cells show bare numbers (units once,
 * not per cell). Percent suffixes stay in cells — signs are data.
 */
export function unitOfSpec(spec: NumberFormatSpec): string | null {
  if (spec.suffix.includes('%') || specUnitKind(spec) === 'pp') return null;
  const magnitude = magnitudeText(spec, spec.magnitude);
  // A local short form keeps its space beside a sign: "$ Mio.", not "$Mio.".
  const unit = !spec.magnitudeWord && /^\s/.test(magnitude)
    ? [spec.prefix.trim(), magnitude.trim(), spec.suffix.trim()].filter(Boolean).join(' ')
    : `${spec.prefix.trim()}${magnitude.trim()}${spec.suffix.trim()}`;
  return unit.length > 0 ? unit : null;
}

/** '%' is a level or a relative change. 'pp' is the difference of two percent levels. */
export function specUnitKind(spec: NumberFormatSpec): 'percent' | 'pp' | 'number' {
  const suffix = spec.suffix.trim().toLowerCase().replace(/\s+/g, '');
  if (suffix === 'pp' || suffix === 'p.p.') return 'pp';
  if (spec.suffix.includes('%')) return 'percent';
  return 'number';
}

/** A percentage, percentage points or a multiple ("1.0x"): a figure that does not add. */
export function nonAdditiveSpec(spec: NumberFormatSpec): boolean {
  return specUnitKind(spec) !== 'number' || /^[x×]$/i.test(spec.suffix.trim());
}

export function nonAdditiveFormat(format: string | undefined): boolean {
  return !!format && nonAdditiveSpec(parseFormatExample(format));
}

const MAGNITUDE_PREVIOUS: Record<Scale, NumberFormatSpec['magnitude']> = { k: 'none', m: 'k', bn: 'm', t: 'bn' };

const MAGNITUDE_NEXT: Record<NumberFormatSpec['magnitude'], NumberFormatSpec['magnitude'] | null> = {
  none: null,
  k: 'm',
  m: 'bn',
  bn: 't',
  t: null,
};

/**
 * A pinned magnitude ROLLS OVER at 1000 instead of printing four digits of
 * itself: "$1000k" is a notation no reader should meet — the honest spelling
 * is "$1.0M". The decision runs on the ROUNDED value, so 999.6k at zero
 * decimals rolls too rather than rounding into "1000k" after the check.
 * Rolled values below 10 keep one decimal ("$1.0M", not "$1M") so the scale
 * continuity stays visible. formatWithSpec and roundedNumber MUST share this
 * — a reader-facing 1.0M whose reconciliation number stayed 1,049,000 would
 * fabricate a phantom gap (see roundedNumber's contract below).
 */
export function effectiveScale(
  value: number,
  spec: NumberFormatSpec,
): { magnitude: NumberFormatSpec['magnitude']; decimals: number } {
  let magnitude: NumberFormatSpec['magnitude'] = spec.magnitude;
  const currencyWhole = spec.currencyWhole && magnitude === 'none' && Math.abs(value) >= 1000;
  const checked = checkedDecimals(spec.decimals);
  const baseDecimals = currencyWhole ? 0 : checked;
  let decimals = baseDecimals;
  if (magnitude === 'none') {
    // Unit rule: a value that rounds to at least wholeFrom prints whole.
    if (spec.wholeCounts && Number.isInteger(value)) return { magnitude, decimals: 0 };
    return { magnitude, decimals: spec.wholeFrom && Number(roundHalfUp(Math.abs(value), decimals)) >= spec.wholeFrom ? 0 : decimals };
  }
  // A forced scale does not roll: "2,400k" is what a board asked for when it
  // put every column in thousands, and "2.4M" in the middle of that board is
  // the defect. roundedNumber shares this function, so the
  // reconciliation number stays in step with the printed one.
  // Its decimals are a property of the SCALE, never of the value:
  // one rule down the whole row or column, so "2,430" never stands beside
  // "940.0". Thousands print whole, because a figure in thousands already
  // carries the digits a reader compares; millions keep the example's own
  // decimals, because "11.3" without them is "11".
  if (spec.autoMagnitude) {
    // shortcut: the stepped-down value keeps the raster's decimals as a cap; one scale per label, not per column.
    while (magnitude !== 'none' && Math.abs(value) < MAGNITUDE_DIVISOR[magnitude]) magnitude = MAGNITUDE_PREVIOUS[magnitude];
    // Up to two decimals at its own scale, so distinct small values stay distinct.
    // The scale is chosen after rounding: 999,999.7 prints "1.00M", not "1,000.00k".
    while (magnitude !== spec.magnitude) {
      const scaled = value / MAGNITUDE_DIVISOR[magnitude];
      const own = Math.max(spec.stepDecimals ?? 0, neededDecimals(scaled, Math.max(decimals, 2)));
      if (Number(roundHalfUp(Math.abs(scaled), own)) < 1000) return { magnitude, decimals: own };
      magnitude = magnitude === 'none' ? 'k' : MAGNITUDE_NEXT[magnitude]!;
    }
  }
  if (spec.rollMagnitude === false) {
    return spec.nonzero && !spec.automatic ? { magnitude, decimals: nonzeroDecimals(value / MAGNITUDE_DIVISOR[magnitude], decimals) } : { magnitude, decimals };
  }
  if (spec.lockMagnitude) return { magnitude, decimals: magnitude === 'k' ? 0 : decimals };
  for (;;) {
    const scaled = Math.abs(value) / MAGNITUDE_DIVISOR[magnitude];
    decimals = !currencyWhole && scaled < 10 && magnitude !== spec.magnitude ? Math.max(baseDecimals, 1) : baseDecimals;
    const next: NumberFormatSpec['magnitude'] | null = MAGNITUDE_NEXT[magnitude];
    // Figures count from the first digit: 999.6 at three figures prints 1000 and rolls, 0.0004 prints 0.000400 and stays.
    const shown = spec.significantDigits === undefined ? Number(scaled.toFixed(decimals)) : Number(roundSignificant(scaled, spec.significantDigits).text);
    if (shown < 1000 || next === null) {
      return !spec.nonzero || spec.automatic || spec.significantDigits !== undefined || value === 0 || !roundsToZero(scaled, decimals) ? { magnitude, decimals } : rolledDown(value, magnitude, baseDecimals);
    }
    magnitude = next;
  }
}

/**
 * An authored scale that would print a nonzero value as 0 ("$0.0 trillion"
 * for 1e9, "0.0 mn" for 1,000) rolls down its word family to the first scale
 * that shows the value ("$1.0 billion", "1.0 k"), as an engine scale prints
 * 20 beside billions; past the smallest scale the decimals grow ("0.004").
 */
function rolledDown(value: number, from: NumberFormatSpec['magnitude'], baseDecimals: number): { magnitude: NumberFormatSpec['magnitude']; decimals: number } {
  let magnitude = from;
  for (;;) {
    const scaled = Math.abs(value) / MAGNITUDE_DIVISOR[magnitude];
    const decimals = scaled < 10 && magnitude !== from ? Math.max(baseDecimals, 1) : baseDecimals;
    if (!roundsToZero(scaled, decimals)) return { magnitude, decimals };
    if (magnitude === 'none') return { magnitude, decimals: nonzeroDecimals(scaled, decimals) };
    magnitude = MAGNITUDE_PREVIOUS[magnitude];
  }
}

type Scale = Exclude<NumberFormatSpec['magnitude'], 'none'>;

/**
 * The words of one spelling family, by scale: the engine letters, the
 * English abbreviations (mn, mm), the English words, the German
 * abbreviations, the German words and the French words. `one` is the
 * singular: German after a printed 1 ("1 Million", "2 Millionen"), French
 * below 2 ("1,5 milliard", "2 milliards").
 */
interface WordFamily { language?: 'en' | 'de' | 'fr'; words: Record<Scale, string>; one?: Partial<Record<Scale, string>> }
const LETTERS: WordFamily = { words: { k: 'k', m: 'M', bn: 'B', t: 'T' } };
const ABBREVIATIONS: WordFamily = { language: 'en', words: { k: 'k', m: 'mn', bn: 'bn', t: 'tn' } };
const FAMILIES: Record<string, WordFamily> = {
  mn: ABBREVIATIONS,
  bn: ABBREVIATIONS,
  tn: ABBREVIATIONS,
  mm: { language: 'en', words: { k: 'k', m: 'mm', bn: 'bn', t: 'tn' } },
  word: { language: 'en', words: { k: 'thousand', m: 'million', bn: 'billion', t: 'trillion' } },
  tsd: { language: 'de', words: { k: 'Tsd.', m: 'Mio.', bn: 'Mrd.', t: 'Bio.' } },
  wort: { language: 'de', words: { k: 'Tausend', m: 'Millionen', bn: 'Milliarden', t: 'Billionen' }, one: { m: 'Million', bn: 'Milliarde', t: 'Billion' } },
  mot: { language: 'fr', words: { k: 'mille', m: 'millions', bn: 'milliards', t: 'billions' }, one: { m: 'million', bn: 'milliard', t: 'billion' } },
  court: { language: 'fr', words: { k: 'k', m: 'M', bn: 'Md', t: 'Bn' } },
};

/**
 * The chart language's own family for a family whose words read otherwise
 * there: on a German chart "bn" and "B" can read as "Billion" (10¹²) and "T"
 * as "Tausend"; on a French chart "bn" and "B" can read as "billion" (10¹²).
 * The English words take the local words, the abbreviations and the
 * ambiguous letters the local short forms (CLDR: Mrd., Bio.; Md, Bn).
 */
function localFamily(family: WordFamily, language: string | undefined): WordFamily {
  if (language === 'de') return family === FAMILIES.word ? FAMILIES.wort! : family.language === 'en' ? FAMILIES.tsd! : family;
  if (language === 'fr') return family === FAMILIES.word ? FAMILIES.mot! : family.language === 'en' ? FAMILIES.court! : family;
  return family === FAMILIES.word && language !== undefined && language !== 'en' ? LETTERS : family;
}

/** The chart's word language: 'de' for "de-CH", undefined without a locale. */
function chartLanguage(locale: string | undefined): string | undefined {
  return wordLanguage(locale)?.toLowerCase().split(/[-_]/)[0];
}

/**
 * The family an authored word belongs to. "Million" and "Billion" are German
 * on a German chart and French on a French chart, English elsewhere;
 * "milliard" is French.
 */
function wordFamily(text: string, locale: string | undefined): WordFamily {
  const word = text.trim().toLowerCase().replace(/\.$/, '');
  const language = chartLanguage(locale);
  if (word.length === 1) return LETTERS;
  if (word === 'tsd' || word === 'mio' || word === 'mrd' || word === 'bio') return FAMILIES.tsd!;
  if (word === 'milliard' || word === 'milliards' || (language === 'fr' && /^(?:million|billion)s?$/.test(word))) return FAMILIES.mot!;
  if (word === 'tausend' || word === 'millionen' || word === 'billionen' || word.startsWith('milliard') || (language === 'de' && (word === 'million' || word === 'billion'))) return FAMILIES.wort!;
  if (/^(?:thousand|million|billion|trillion)s?$/.test(word)) return FAMILIES.word!;
  return FAMILIES[word] ?? LETTERS;
}

/** The authored word's case pattern applied to a family word: "Mn" gives "Bn", "MN" gives "BN". */
function authoredCase(word: string, authored: string): string {
  const letters = authored.replace(/[^\p{L}]/gu, '');
  if (letters.length > 1 && letters === letters.toUpperCase()) return word.toUpperCase();
  return /^\p{Lu}/u.test(letters) ? word[0]!.toUpperCase() + word.slice(1) : word;
}

/** The scale a spec without an authored word prints: the letter, or the local short form for B and T (magnitudeSuffix). */
export function magnitudeLabel(spec: NumberFormatSpec, magnitude: NumberFormatSpec['magnitude']): string {
  return magnitudeSuffix(magnitude, spec.locale);
}

/**
 * The magnitude word a value prints, from the authored word's family, so one
 * chart never mixes spellings ("$500.0 mn" beside "$1.0 bn", not "$1.0
 * billion"). The authored word prints as written at its own scale; a German
 * or French word takes its singular after a printed 1 (French: below 2). An
 * English word on a chart in another language would be a false friend
 * ("billion" is 10¹² in French and German): a German or French chart prints
 * its own words or short forms at every scale (localFamily), a chart in a
 * language the helpers have no words for prints the letter at the other
 * scales.
 */
function magnitudeText(spec: NumberFormatSpec, magnitude: NumberFormatSpec['magnitude'], printed = '', printedValue = 0): string {
  if (magnitude === 'none' || spec.magnitudeInAffix) return '';
  const authored = spec.magnitudeWord;
  if (!authored) return magnitudeLabel(spec, magnitude);
  const authoredFamily = wordFamily(authored.text, spec.locale);
  const language = chartLanguage(spec.locale);
  const family = localFamily(authoredFamily, language);
  const space = /^\s*/.exec(authored.text)![0];
  if (family === LETTERS) {
    // k and M read alike in German and French; B and T take the local short form ("2,5 Mrd.", "2,5 Md"), as the engine letters do.
    if ((language === 'de' || language === 'fr') && (magnitude === 'bn' || magnitude === 't')) return magnitudeSuffix(magnitude, spec.locale);
    return authored.magnitude === magnitude ? authored.text : space + MAGNITUDE_LABEL[magnitude];
  }
  // A translated family and the German and French words (which agree with the number) replace even the authored word.
  if (authored.magnitude === magnitude && family === authoredFamily && family !== FAMILIES.wort && family !== FAMILIES.mot) return authored.text;
  const one = family.one?.[magnitude];
  const singular = family === FAMILIES.mot ? printedValue < 2 : /^[−+-]?1$/.test(printed);
  const word = one !== undefined && singular ? one : family.words[magnitude];
  if (family === FAMILIES.tsd) {
    // An abbreviation keeps the authored dot or its absence ("Mio" gives "Mrd"); a translated one takes the dot and a space.
    return family === authoredFamily ? space + (authored.text.endsWith('.') ? word : word.slice(0, -1)) : ' ' + word;
  }
  if (family.language === 'de' || family.language === 'fr') return space + word;
  return space + authoredCase(word, authored.text);
}

/**
 * The rounding a spec prints, shared by formatWithSpec and roundedNumber. An
 * automatic spec prints a p-value at three decimals, never more than
 * AUTO_MAX_DECIMALS, and `mode` says how a nonzero value that rounds to 0
 * prints (undefined: as rounded).
 */
function printedRounding(abs: number, scaled: number, spec: NumberFormatSpec, decimals: number): { rounded: { text: string; decimals: number }; pValue: boolean; mode?: ReturnType<typeof belowPrecision> } {
  const pValue = !!spec.automatic && printsPValue(scaled);
  let rounded: { text: string; decimals: number } = pValue ? { text: roundHalfUp(abs, P_VALUE_DECIMALS), decimals: P_VALUE_DECIMALS } : roundedAbsForSpec(abs, spec, decimals, false);
  if (!spec.automatic || abs === 0) return { rounded, pValue };
  if (rounded.decimals > AUTO_MAX_DECIMALS) rounded = { text: roundHalfUp(abs, AUTO_MAX_DECIMALS), decimals: AUTO_MAX_DECIMALS };
  const mode = Number(rounded.text) !== 0 ? undefined : pValue ? 'bound' : belowPrecision(rounded.decimals);
  return { rounded, pValue, mode: mode === 'bound' || mode === 'scientific' ? mode : undefined };
}

function roundedAbsForSpec(abs: number, spec: NumberFormatSpec, decimals: number, lift = !!spec.automatic): ReturnType<typeof roundForDisplay> {
  if (spec.significantDigits != null) {
    const rounded = roundSignificant(abs, spec.significantDigits);
    return lift && abs > 0 && abs < 1 && Number(rounded.text) === 0
      ? roundForDisplay(abs, rounded.decimals, true) : rounded;
  }
  return roundForDisplay(abs, decimals, lift);
}

/**
 * A spec's printed texts, shared by every spec object with the same fields and
 * small-values mode. `lifts` is what one print adds to zeroLifts; a reuse adds
 * it again, so tableFit counts a lift whether the text was cached or not.
 */
interface TextPlan { keys: string[]; values: unknown[]; nested: (string | undefined)[]; small: SmallValues; generation: number; texts?: Map<number, { text: string; lifts: number }> }
const textPlans = new WeakMap<NumberFormatSpec, TextPlan>();
const sharedTexts = new Map<string, Map<number, { text: string; lifts: number }>>();
const MAX_SPEC_TEXTS = 16_384;
let specTexts = 0;
let textGeneration = 0;

/** The spec's plan, rebuilt when a field changed since (treemap sets wholeFrom on a live spec). */
function textPlan(spec: NumberFormatSpec): TextPlan {
  const small = currentSmallValues();
  const plan = textPlans.get(spec);
  if (plan !== undefined && plan.small === small && plan.generation === textGeneration) {
    let index = 0;
    let same = true;
    for (const key in spec) {
      const field = spec[key as keyof NumberFormatSpec];
      // A nested field (magnitudeWord) compares by its content too, so an edit in place is seen.
      if (plan.keys[index] !== key || plan.values[index] !== field
        || (plan.nested[index] !== undefined && plan.nested[index] !== JSON.stringify(field))) { same = false; break; }
      index++;
    }
    if (same && index === plan.keys.length) return plan;
  }
  const keys: string[] = [];
  const values: unknown[] = [];
  const nested: (string | undefined)[] = [];
  // Only a plain object of plain fields is cached: JSON cannot tell NaN, ±Infinity or -0 apart,
  // and drops functions and symbols. Specs are literals and spreads, so this costs no hits.
  let shareable = Object.getPrototypeOf(spec) === Object.prototype;
  for (const key in spec) {
    const field: unknown = spec[key as keyof NumberFormatSpec];
    if (typeof field === 'number' ? !Number.isFinite(field) || Object.is(field, -0)
      : typeof field === 'function' || typeof field === 'symbol' || typeof field === 'bigint') shareable = false;
    keys.push(key);
    values.push(field);
    nested.push(shareable && typeof field === 'object' && field !== null ? JSON.stringify(field) : undefined);
  }
  // shortcut: a getter or non-enumerable field is not seen; specs never define one.
  const content = shareable ? `${small}\u0000${JSON.stringify(spec)}` : undefined;
  let texts = content === undefined ? undefined : sharedTexts.get(content);
  if (content !== undefined && texts === undefined) {
    sharedTexts.set(content, texts = new Map());
    // A map counts toward the bound, so prints that throw cannot pile up empty maps.
    specTexts++;
  }
  const next: TextPlan = { keys, values, nested, small, generation: textGeneration, texts };
  textPlans.set(spec, next);
  return next;
}

function boundSpecTexts(): void {
  if (specTexts >= MAX_SPEC_TEXTS) {
    // Bound long-lived hosts: drop every shared text and every plan that points at one.
    for (const texts of sharedTexts.values()) texts.clear();
    sharedTexts.clear();
    specTexts = 0;
    textGeneration++;
  }
}

export function formatWithSpec(value: number, spec: NumberFormatSpec): string {
  if (value == null || !Number.isFinite(value) || Object.is(value, -0)) return formatWithSpecUncached(value, spec);
  boundSpecTexts();
  return formatPlannedNumber(value, spec, textPlan(spec).texts);
}

/** The table owns and finalizes this spec before compiling it. Public mutable specs use formatWithSpec. */
export function compileNumberFormat(spec: NumberFormatSpec): (value: number) => string {
  let plan: TextPlan | undefined;
  return (value) => {
    if (value == null || !Number.isFinite(value) || Object.is(value, -0)) return formatWithSpecUncached(value, spec);
    boundSpecTexts();
    if (plan === undefined || plan.generation !== textGeneration || plan.small !== currentSmallValues()) plan = textPlan(spec);
    return formatPlannedNumber(value, spec, plan.texts);
  };
}

function formatPlannedNumber(value: number, spec: NumberFormatSpec, texts: TextPlan['texts']): string {
  if (texts === undefined) return formatWithSpecUncached(value, spec);
  const cached = texts.get(value);
  if (cached !== undefined) {
    zeroLifts.count += cached.lifts;
    return cached.text;
  }
  const before = zeroLifts.count;
  const text = formatWithSpecUncached(value, spec);
  texts.set(value, { text, lifts: zeroLifts.count - before });
  specTexts++;
  return text;
}

function signedText(core: string, negative: boolean, zero: boolean, spec: NumberFormatSpec): string {
  if (spec.glyphs) {
    if (zero) return core;
    const glyph = negative ? spec.glyphs.down : spec.glyphs.up;
    return spec.glyphs.at === 'start' ? glyph + spec.glyphs.space + core : core + spec.glyphs.space + glyph;
  }
  if (negative) return spec.negative === 'parens' ? `(${core})` : spec.negative === 'trailing' ? core + spec.trailingMinus : MINUS + core;
  return spec.signed && !zero ? `+${core}` : core;
}

function ordinalText(integer: number, style: NonNullable<NumberFormatSpec['ordinal']>): string {
  const lastTwo = integer % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[integer % 10] ?? 'th';
  return style === 'upper' ? suffix.toUpperCase() : suffix;
}

/** Round the mantissa before choosing the final exponent, including a carry from 9.99. */
function exampleScientific(value: number, spec: NumberFormatSpec): { mantissa: string; exponent: number; value: number } {
  const [coefficient, power] = Math.abs(value).toExponential().split('e');
  let exponent = Number(power);
  let mantissa = roundHalfUp(Number(coefficient), spec.decimals);
  if (Number(mantissa) >= 10) {
    exponent++;
    mantissa = roundHalfUp(Number(mantissa) / 10, spec.decimals);
  }
  const rounded = Number(`${mantissa}e${exponent}`);
  return { mantissa, exponent, value: value < 0 ? -rounded : rounded };
}

function formatWithSpecUncached(value: number, spec: NumberFormatSpec): string {
  if (value == null) return '';
  // Same state glyph as formatNumber — one spelling of a non-finite across both
  // engines. Emitted bare: prefix/suffix/parens are unit and sign claims that a
  // non-value cannot make ("$Infinity.M" and "(Infinity)" were both possible).
  const glyph = nonFiniteGlyph(value);
  if (glyph !== null) return glyph === 'n/a' ? chartString({ locale: { language: spec.locale } }, 'notApplicable') : glyph;
  if (spec.exponent) {
    const { mantissa, exponent } = exampleScientific(value, spec);
    const digits = spec.locale ? fractionFormat(spec.locale, spec.decimals, false).format(Number(mantissa)) : mantissa.replace('.', spec.decimalSep);
    const power = `${exponent < 0 ? '-' : spec.exponent.sign}${String(Math.abs(exponent)).padStart(spec.exponent.digits, '0')}`;
    return signedText(`${spec.prefix}${digits}${spec.exponent.letter}${power}${spec.suffix}`, value < 0, value === 0, spec);
  }
  const { magnitude, decimals } = effectiveScale(value, spec);
  const scaled = value / MAGNITUDE_DIVISOR[magnitude];
  const abs = Math.abs(scaled);
  // An automatic format prints at most AUTO_MAX_DECIMALS; a nonzero value below its last digit prints as options.smallValues says.
  const { rounded, pValue, mode } = printedRounding(abs, scaled, spec, decimals);
  let scientific: string | undefined;
  if (mode !== undefined) {
    if (mode === 'bound') {
      // The shareText bound: "<0.1" above zero, ">−0.1" below, at the format's own decimals; a signed spec keeps its sign, "<+0.1".
      zeroLifts.count++;
      const bound = `${value > 0 ? '<' : '>'}${formatWithSpec(Math.sign(value) * 10 ** -rounded.decimals * MAGNITUDE_DIVISOR[magnitude], { ...spec, automatic: false, decimals: rounded.decimals, significantDigits: undefined })}`;
      return pValue ? withoutLeadingZero(bound) : bound;
    }
    if (mode === 'scientific') {
      zeroLifts.count++;
      scientific = scientificText(abs, (mantissa) => spec.locale
        ? numberFormat(spec.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(mantissa)
        : mantissa.toFixed(1).replace('.', spec.decimalSep));
    }
  }
  const underflow = spec.automatic && scaled === 0 && value !== 0
    ? underflowScientificText(value, MAGNITUDE_DIVISOR[magnitude]) : undefined;
  if (underflow) zeroLifts.count++;
  const isZero = !underflow && !scientific && Number(rounded.text) === 0;
  const negative = value < 0 && !isZero;

  const [intPart, fracPart] = rounded.text.split('.');
  // A space groups with a no-break space, so no figure breaks across two
  // lines.
  let num = groupInteger(intPart!, spec.thousandsSep === ' ' ? '\u00a0' : spec.thousandsSep);
  if (rounded.decimals > 0) num += spec.decimalSep + (fracPart ?? '');
  if (scientific) num = scientific;
  else if (spec.locale) num = fractionFormat(spec.locale, rounded.decimals, spec.thousandsSep !== '').format(Number(rounded.text));
  if (underflow) num = underflow;
  if (pValue) num = withoutLeadingZero(num);
  num += magnitudeText(spec, magnitude, num, Number(rounded.text));
  if (spec.ordinal) num += ordinalText(Number(rounded.text), spec.ordinal);

  const core = `${spec.prefix}${num}${spec.suffix}`;
  return signedText(core, negative, isZero, spec);
}

/**
 * The numeric value a reader SEES for `value` under `spec` — the exact same
 * rounding path as formatWithSpec (toFixed on the magnitude-scaled abs,
 * INCLUDING the 1000-rollover to the next magnitude). Reconciliation math
 * must use THIS, never a reimplemented rounding: two rounding paths that
 * disagree on one cell fabricate a phantom gap.
 */
export function roundedNumber(value: number, spec: NumberFormatSpec): number {
  if (spec.exponent && Number.isFinite(value)) return exampleScientific(value, spec).value;
  const { magnitude, decimals } = effectiveScale(value, spec);
  const divisor = MAGNITUDE_DIVISOR[magnitude];
  const scaled = value / divisor;
  if (spec.automatic && scaled === 0 && value !== 0) return Number(value.toPrecision(1));
  // The number printed: a bound ("<0.001") reads as its bound, never as zero, a scientific form as its two digits.
  const { rounded, mode } = printedRounding(Math.abs(scaled), scaled, spec, decimals);
  const parts = mode === 'scientific' ? scientificParts(Math.abs(scaled)) : undefined;
  const abs = parts ? Number(`${parts.digits}e${parts.exponent}`) : mode === 'bound' ? 10 ** -rounded.decimals : Number(rounded.text);
  return (scaled < 0 && abs !== 0 ? -abs : abs) * divisor;
}

/**
 * `spec` printed with the chart's marks (numberMarks.ts) when `locale` is a
 * chart's marked tag; unchanged otherwise. For a spec parsed straight from an
 * example.
 */
export function withChartMarks(spec: NumberFormatSpec, locale: string | undefined): NumberFormatSpec {
  return locale !== undefined && splitNumberMarks(locale).marks ? { ...spec, locale } : spec;
}

/**
 * Marks under a chart locale (numberMarks.ts). Inside a chart the locale tag
 * carries the chart's pair (locale.decimal and locale.thousands, default '.'
 * and ','), which every number takes, authored or not. The example sets all
 * else: the decimals, grouping on or off, prefix, suffix, magnitude word, sign
 * and negative style. Outside a chart (no locale) the example's own marks stand.
 */
export function localized(spec: NumberFormatSpec, locale: string | undefined): NumberFormatSpec {
  return locale ? { ...spec, locale } : spec;
}

/**
 * An authored example as every value formatter prints it: the
 * authored magnitude word, the chart locale's separators, and the scale a
 * unit states held at the example's own decimals ("$0.4k" and "$1000.0k"
 * under "$k" for a "$1.2k" example, never "$1.0M"). `values` are the chart's
 * printed numbers, which share one scale and one decimal count (shareAuthoredScale).
 */
export function exampleSpec(example: string, locale?: string, unit?: string, values?: Iterable<number | null | undefined>): NumberFormatSpec {
  const spec = localized(parseFormatExample(example, true), locale);
  spec.nonzero = true;
  if (spec.magnitude !== 'none' && unitMagnitude(unit) === spec.magnitude) spec.rollMagnitude = false;
  if (values) shareAuthoredScale(spec, [...values]);
  // An example under 1000 ("12%", "1.2") cannot show grouping, so a value from
  // 1000 up groups in the example's style ("40,000,000,000%"), as table cells
  // do. "1234" and "2024" state no grouping, nor does a literal-# rank ("#1").
  if (spec.prefix.endsWith('#') || spec.exponent) return spec;
  const body = numericBody(formatExampleText(String(example)))?.text ?? '';
  const integer = spec.decimals > 0 ? body.slice(0, body.lastIndexOf(spec.decimalSep)) : body;
  if (spec.thousandsSep === '' && integer.replace(/\D/g, '').length < 4) spec.thousandsSep = spec.decimalSep === ',' ? '.' : ',';
  return spec;
}

/**
 * The example that sets how a chart prints its computed shares: `shareLabels.format`,
 * else `options.format` when it is a percent example ("1.0%"). A format without a
 * percent sign belongs to the values and gives none.
 */
export function shareFormatExample(options: { format?: string; shareLabels?: { format?: string } }): string | undefined {
  if (options.shareLabels?.format) return formatExampleText(options.shareLabels.format);
  return options.format && parseFormatExample(options.format).suffix.includes('%') ? formatExampleText(options.format) : undefined;
}

/** Parse an example and return a ready-to-use formatter. The chart locale is required (pass undefined for none), so no caller forgets it. */
export function formatterFromExample(example: string, locale: string | undefined, unit?: string, values?: Iterable<number | null | undefined>): (value: number) => string {
  const spec = exampleSpec(example, locale, unit, values);
  return (value: number) => formatWithSpec(value, spec);
}

/**
 * An automatic format keeps its normal rounding and lifts only a zeroed value.
 */
export function formatNonzeroWithSpec(value: number, spec: NumberFormatSpec): string {
  // A scaled chart value spec already keeps a nonzero value off 0 by its scale ("$1.0 billion", not "$0.001 trillion").
  // An unscaled one ("$1.0") has no scale to roll down to and lifts here ("$0.004", not "$0.0").
  if (spec.automatic || (spec.nonzero && spec.magnitude !== 'none')) return formatWithSpec(value, spec);
  // Preserve existing callers that explicitly request this authored-format lift.
  const scaled = value / MAGNITUDE_DIVISOR[spec.autoMagnitude ? effectiveScale(value, spec).magnitude : spec.magnitude];
  const lifted = nonzeroDecimals(scaled, spec.decimals);
  return formatWithSpec(value, { ...spec, decimals: roundsToZero(scaled, lifted) ? spec.decimals : lifted });
}

/**
 * The derived-delta face of an example: '+' on a positive value, once, and
 * no sign on a value that prints as zero. Prefixing '+' to the formatted
 * text would print "++18.20" for a "+1.0" example and "+0" for 0.02.
 */
export function signedFormatterFromExample(example: string, locale: string | undefined, unit?: string, values?: Iterable<number | null | undefined>): (value: number) => string {
  const spec = { ...exampleSpec(example, locale, unit, values), signed: true };
  return (value: number) => formatWithSpec(value, spec);
}

/**
 * The level face of a spec keeps negative signs and removes forced positive signs and direction glyphs.
 */
export function levelFormatSpec(spec: NumberFormatSpec): NumberFormatSpec {
  const level = { ...spec, signed: false };
  delete level.glyphs;
  return level;
}

/**
 * The level face of an example: the same, without a forced '+' or direction glyph. A bridge writes "+$1.2M"
 * for its steps; its totals are levels and print "$1.2M".
 */
export function levelFormatterFromExample(example: string, locale: string | undefined, unit?: string, values?: Iterable<number | null | undefined>): (value: number) => string {
  const level = levelFormatSpec(exampleSpec(example, locale, unit, values));
  return (value: number) => formatWithSpec(value, level);
}

/**
 * The example a difference of two values prints with: the same, except that
 * the difference of two percent levels is in percentage points.
 */
export function differenceExample(example: string): string {
  example = formatExampleText(example);
  return specUnitKind(parseFormatExample(example)) === 'percent' ? example.replace(/%/g, 'pp') : example;
}

// ---------------------------------------------------------------------------
// Series-wide format raster.
// The format example carries STYLE — separators, unit prefix/suffix, pinned
// magnitude. PRECISION is not style: it is a claim about the data, and it is
// decided ONCE per exhibit from the plotted values. Per-value decimal
// decisions put "53" beside "52.2" on one revenue stack (false precision
// difference inside one series), an example's incidental ".0" forced "47.0%"
// onto an all-integer share series (dead precision), and a "1,234" example
// truncated 53.2 to "53" on the one endpoint label the exhibit had.
// ---------------------------------------------------------------------------

/**
 * The decimal cap for a set of scaled values: 2, lifted so that the largest
 * magnitude keeps two significant digits, at most MAX_FORMAT_DECIMALS. At a
 * flat cap of 2 an exhibit of values near 0.001 would print "0.00" on every label
 * and tick. The largest value sets it, not the smallest: a tail that
 * fades to 0.004 beside values of 25 still prints at the exhibit's precision
 * and shares the zero label, instead of pushing "25.800" onto the rest.
 *
 * `authored` is the example's own decimal count, and lifts the cap too: an
 * exchange rate under a "1.0000" example is a claim to four decimals, and the
 * flat cap printed 1.0851 and 1.0853 as one "1.09". The example lifts only
 * the cap, so "47.0" on an all-integer series still prints 47.
 */
export function decimalCap(scaled: Iterable<number>, authored = 0): number {
  let max = 0;
  for (const value of scaled) if (Number.isFinite(value)) max = Math.max(max, Math.abs(value));
  const floor = Math.max(2, authored);
  return max === 0 ? floor : Math.min(MAX_FORMAT_DECIMALS, Math.max(floor, 1 - Math.floor(Math.log10(max))));
}

/**
 * Decimals `value` actually needs to render exactly, capped (default 2).
 * `scale` is the size below which a remainder counts as float noise: 1 for
 * ordinary values, the exhibit's largest value when that is smaller, so a
 * bridge of steps near 1e-13 is not read as whole numbers and printed as 0.
 *
 * A remainder under one part in 1e9 is float noise, unless the example's
 * `authored` decimals reach that far: under a "1.0000000000" example the
 * tenth decimal is a claim, and the fixed margin read 1.0000000001 as a
 * whole 1.
 */
export function neededDecimals(value: number, cap = 2, scale = 1, authored = 0): number {
  if (!Number.isFinite(value)) return 0;
  const noise = Math.min(1e-9, 10 ** -(authored + 1));
  for (let d = 0; d <= cap; d++) {
    const shifted = value * 10 ** d;
    if (Math.abs(shifted - Math.round(shifted)) < noise * Math.max(scale, Math.abs(shifted))) {
      return d;
    }
  }
  return cap;
}

/**
 * The one precision an exhibit's value labels share: the maximum any plotted
 * value needs at the spec's display magnitude, capped at 2, at the example's
 * own decimals, or at the decimals that keep the smallest value's two
 * significant digits (decimalCap), whichever is most.
 *
 * Two kinds of value do not DEMAND decimals (they still render at whatever
 * raster the others set, unless the unit rule prints them whole):
 *   - values at |scaled| ≥ 100 — their fractional digits sit below 0.1% of
 *     the value, relative information the exhibit does not owe the reader
 *     (a PVM bridge whose Laspeyres effects carry float cents must not force
 *     "65,980.00" onto every total; 52.2 beside 53 rightly forces "53.0").
 *     The example's own decimals are owed: under a "1.0000" example 100.0101
 *     and 100.0202 demand their four, where the flat exemption printed both
 *     as "100";
 *   - values that will roll to the next magnitude — effectiveScale gives
 *     them their own decimals.
 *
 * With no finite demanding values the example's own decimals stand.
 */
export function rasterDecimals(
  values: Iterable<number | null | undefined>,
  spec: NumberFormatSpec,
): number {
  const divisor = MAGNITUDE_DIVISOR[spec.magnitude];
  const shown: number[] = [];
  for (const value of values) {
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    const scaled = value / divisor;
    if (spec.magnitude !== 'none' && Math.abs(scaled) >= 1000) continue;
    // A value under an engine-chosen scale prints at its own scale (effectiveScale).
    if (spec.autoMagnitude && Math.abs(scaled) < 1) continue;
    shown.push(scaled);
  }
  if (shown.length === 0) return spec.decimals;
  // An automatic raster prints at most AUTO_MAX_DECIMALS; a smaller value prints its bound.
  const cap = spec.automatic ? Math.min(AUTO_MAX_DECIMALS, decimalCap(shown, spec.decimals)) : decimalCap(shown, spec.decimals);
  const largest = maxOf(shown.map(Math.abs));
  const scale = largest > 0 && largest < 1 ? largest : 1;
  return shown.reduce((max, scaled) => {
    const needed = neededDecimals(scaled, cap, scale, spec.decimals);
    // Under an engine scale the preference is four significant digits:
    // 107.8B, not 108B. seriesRasterFormatter lifts further while
    // two different values print one text.
    const owed = spec.autoMagnitude ? Math.max(spec.decimals, 1) : spec.decimals;
    return Math.max(max, Math.abs(scaled) >= 100 ? Math.min(owed, needed) : needed);
  }, 0);
}

/**
 * The one decimal count of a set of comparable values (setFormatPlan), at the
 * set's one magnitude. A value from 1 at that magnitude asks what the raster
 * asks today (rasterDecimals). A value below 1 under an engine scale keeps the
 * three significant digits its own scale printed (935k: "0.935M", 140M:
 * "0.14B"). A nonzero value that would print as 0 lifts the whole set. No
 * value asks for more than AUTO_MAX_DECIMALS, and a value that is still 0
 * there asks for nothing: it prints its bound at the set's decimals ("<0.1B"),
 * so one tiny value does not pad every label with zeros.
 */
function setDecimals(values: readonly (number | null | undefined)[], spec: NumberFormatSpec, engineScale: boolean): number {
  const divisor = MAGNITUDE_DIVISOR[spec.magnitude];
  let decimals = rasterDecimals(values, engineScale ? { ...spec, autoMagnitude: true } : spec);
  for (const value of values) {
    if (value == null || !Number.isFinite(value) || value === 0) continue;
    const scaled = Math.abs(value / divisor);
    const asked = engineScale && scaled < 1 ? neededDecimals(scaled, 2 - Math.floor(Math.log10(scaled))) : nonzeroDecimals(scaled, decimals);
    const shown = Math.min(asked, AUTO_MAX_DECIMALS);
    if (!roundsToZero(scaled, shown)) decimals = Math.max(decimals, shown);
  }
  return decimals;
}

/**
 * Derived statistics — means, medians, MADs, corridor bounds — are the
 * exhibit's OWN claims, not plotted data: they render in the exhibit's style
 * but never round to a DIFFERENT number than they are. Decimals lift at most
 * ONE step past the raster — enough that an integer-rastered exhibit prints
 * its mean as "27.5" and never "28", without escalating every irrational
 * bound to full precision ("23.4", not "23.35").
 */
export function formatStatWithSpec(value: number, spec: NumberFormatSpec): string {
  if (spec.exponent) return formatWithSpec(value, spec);
  // The unit rule is for plotted values; a mean of 100.5 stays 100.5.
  const own = { ...spec, wholeFrom: undefined };
  // Decimals count at the scale the label prints in: 1.25M under "1M" needs one, not the none of 1,250,000.
  const scaled = value / MAGNITUDE_DIVISOR[effectiveScale(value, own).magnitude];
  return formatWithSpec(value, { ...own, decimals: Math.max(spec.decimals, neededDecimals(scaled, spec.decimals + 1)) });
}

/** Trend rates choose their own magnitude and precision; they never use the small-value bound policy. */
export function trendRateFormatter(example: string | undefined, locale?: string, unit?: string, signed = false): (rate: number) => string {
  const spec = example ? exampleSpec(example, locale) : defaultFormatSpec(locale);
  // Unsigned scatter rates keep their minus style under a parentheses example.
  // Points take the spacing the chart's % takes: "+0.40pp" beside "12.5%", "+0,40 pp" beside "12,5 %".
  const face = { ...spec, automatic: false, signed, negative: signed ? spec.negative : 'minus' as const,
    suffix: spec.suffix.includes('%') ? spec.suffix.replace(/%/g, 'pp') : unit?.includes('%') ? 'pp' : spec.suffix };
  const missingUnit = spec.prefix || face.suffix || spec.magnitude !== 'none' ? undefined : unit;
  const precision = (scaled: number): number => scaled === 0 || scaled >= 100 ? 0 : scaled >= 1 ? 1 : 1 - Math.floor(Math.log10(scaled));
  if (spec.magnitudeInAffix || spec.exponent) return rate => withUnit(formatWithSpec(rate, face), missingUnit, false, locale);
  return rate => {
    const abs = Math.abs(rate);
    let magnitude: NumberFormatSpec['magnitude'] = spec.magnitude === 'none' ? 'none' : abs >= 1e9 ? 'bn' : abs >= 1e6 ? 'm' : abs >= 1e3 ? 'k' : 'none';
    let decimals = 0;
    let authored = false;
    // The magnitude and the band are chosen after rounding: 999,960 prints "+1.0M", not "+1,000.0k"; 0.00099996 prints "+0.0010".
    for (;;) {
      const scaled = abs / MAGNITUDE_DIVISOR[magnitude];
      const order = scaled === 0 ? 0 : Math.floor(Math.log10(scaled));
      authored = example !== undefined && (scaled === 0 || order + spec.decimals >= 1);
      decimals = authored ? spec.decimals : precision(scaled);
      // A rounded boundary belongs to its new band: 99.96 → 100, 0.996 → 1.0.
      if (!authored && decimals <= MAX_FORMAT_DECIMALS) decimals = precision(Number(roundHalfUp(scaled, decimals)));
      const next: NumberFormatSpec['magnitude'] | null = MAGNITUDE_NEXT[magnitude];
      if (spec.magnitude === 'none' || (next === null && magnitude !== 'none') || Number(roundHalfUp(scaled, Math.min(decimals, MAX_FORMAT_DECIMALS))) < 1000) break;
      magnitude = next ?? 'k';
    }
    // Two significant digits past AUTO_MAX_DECIMALS print in scientific form, as automatic values do: "1.0 × 10⁻¹³", not 14 decimals.
    const scientific = !authored && decimals > AUTO_MAX_DECIMALS;
    const rateSpec = { ...face, magnitude, decimals: Math.min(MAX_FORMAT_DECIMALS, decimals), rollMagnitude: false as const };
    if (scientific) {
      const { digits } = scientificParts(Math.abs(rate));
      return withUnit(formatWithSpec(Math.sign(rate) * digits, { ...rateSpec, decimals: 1, suffix: `${scientificText(Math.abs(rate), () => '')}${face.suffix}` }), missingUnit, false, locale);
    }
    return withUnit(formatWithSpec(rate, rateSpec), missingUnit, false, locale);
  };
}

/** Past this many decimals an authored scale no longer reads, so a value that small keeps its own scale. */
const SCALE_MAX_DECIMALS = 3;

/**
 * Hold a chart's values to one scale and one decimal count under an authored
 * scale word. Decided per label, 1000, 50 and -20 under "1.2k" printed "1.0k",
 * "+0.1k" and "-20.0": 50 read as 100 and -20 left the thousands. Every value
 * shows its first digit instead, so all print "1.00k", "+0.05k" and "-0.02k".
 * A scale above every value steps down first. A scale the unit fixes holds at
 * any decimals. Elsewhere a value past SCALE_MAX_DECIMALS rolls down alone
 * (effectiveScale), as 20 prints beside billions.
 */
function shareAuthoredScale(spec: NumberFormatSpec, values: readonly (number | null | undefined)[]): void {
  const shown = values.flatMap((value) => value != null && Number.isFinite(value) && value !== 0 ? [Math.abs(value)] : []);
  if (spec.magnitude === 'none' || shown.length === 0) return;
  const locked = spec.rollMagnitude === false;
  const largest = maxOf(shown);
  let magnitude: NumberFormatSpec['magnitude'] = spec.magnitude;
  while (!locked && magnitude !== 'none' && largest < MAGNITUDE_DIVISOR[magnitude]) magnitude = MAGNITUDE_PREVIOUS[magnitude];
  const divisor = MAGNITUDE_DIVISOR[magnitude];
  const decimals = Math.max(spec.decimals, -Math.floor(Math.log10(minOf(shown) / divisor)));
  spec.magnitude = magnitude;
  if (locked || decimals <= SCALE_MAX_DECIMALS) spec.decimals = Math.min(MAX_FORMAT_DECIMALS, decimals);
}

/** Style-only default for charts with no authored example: en-US grouping,
 *  point decimal, no unit — the exact face formatNumber's default shows. */
export function defaultFormatSpec(locale?: string): NumberFormatSpec {
  return {
    decimals: 0,
    automatic: true,
    ...(locale ? { locale } : {}),
    thousandsSep: ',',
    decimalSep: '.',
    magnitude: 'none',
    prefix: '',
    suffix: '',
    negative: 'minus',
    signed: false,
  };
}

/**
 * The percent-cell formatter: precision rastered ONCE over the authored
 * percent values, exactly as `seriesRasterFormatter` rasters the numeric
 * scale group. A flat 0 decimals (1 below |1|) would flatten
 * an authored 36.2 to "36%" while the title says 36.2 — the label would round
 * to a DIFFERENT number than the doc states. Computed shares (pie, stacked100,
 * stacked100-area) are derived values with their own integer face and do NOT come
 * through here.
 */
export function percentRasterFormatter(
  values: Iterable<number | null | undefined>,
  locale?: string,
): (value: number) => string {
  // Deliberately NOT rasterDecimals: its |v| >= 100 exemption is a monetary-
  // magnitude rule (fractional digits under 0.1% of a scaled value), and an
  // authored 102.5% attainment demands its decimal exactly as 36.2 does —
  // exempting it would re-create the flattening this formatter exists to
  // stop, just past the 100% line.
  let decimals = 0;
  for (const value of values) {
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    decimals = Math.max(decimals, neededDecimals(value));
  }
  return (value: number) =>
    formatPercent(value, Math.max(decimals, smallRateDecimals(value)), false, locale, true);
}

/**
 * An authored format with no scale word prints a value of 1e6 or
 * more in all its digits ("1310000000.0" under "1.1"), and one that prints a
 * series' different values as one string hides them. The format stays the
 * author's; this warns and offers a compact or finer example of the same style.
 */
export function unscaledFormatLint(
  options: Record<string, unknown> | undefined,
  data: unknown,
  geo?: { labels?: readonly PlacedLabel[]; scene: readonly SceneNode[] },
): LintWarning[] {
  const authored = typeof options?.format === 'string' ? options.format : undefined;
  // Series rows, one row of values (sparkline, kpi), or waterfall items.
  const own = data as { series?: { values?: unknown[] }[]; values?: unknown[]; items?: { value?: unknown }[] } | undefined;
  const rows = [...(Array.isArray(own?.series) ? own.series : []), ...(Array.isArray(own?.values) ? [own] : []),
    ...(Array.isArray(own?.items) ? [{ values: own.items.map((item) => item?.value) }] : [])];
  const numbers = rows.map((s) => (Array.isArray(s?.values) ? s.values : []).flatMap((cell) => {
    const value = typeof cell === 'number' ? cell : (cell as { number?: unknown } | null)?.number;
    return typeof value === 'number' && Number.isFinite(value) ? [value] : [];
  }));
  // A unit that names a scale gets no second one, so values of seven integer
  // digits print in full under it ("27,900,000,001 in €m"). Such values are
  // most likely in base units: the author decides. The check reads
  // what the chart draws (value labels, totals, segments, ticks), not the
  // cells: a football-field cell number that never prints does not count, a
  // computed total does. No compact format is offered: a magnitude word
  // under "€m" would print a second scale.
  const unit = typeof options?.unit === 'string' ? options.unit : undefined;
  const long = unitMagnitude(unit) && geo ? drawnNumberTexts(geo).find((text) => SEVEN_DIGITS.test(text)) : undefined;
  if (long) {
    return [{
      code: 'unit-scale-digits',
      severity: 'warn',
      message: `options.unit '${unit}' already names a scale, so the chart prints '${long}' in all its digits`,
      suggest: `give the values in the unit's scale (${unit}), or set options.unit to the base unit and let the engine pick k, M or B`,
      field: ['options', 'unit'],
    }];
  }
  if (!authored) return [];
  let format: string;
  let spec: NumberFormatSpec;
  try {
    format = formatExampleText(authored);
    format = exampleReading(format, numbers.flat()).decimals ?? format;
    spec = parseFormatExample(format);
  } catch { return []; }
  if (spec.ordinal || spec.exponent) return [];
  // A series whose different values all print as one string hides them. The
  // format stays the author's; the fix adds one decimal. Bump ranks read
  // equal strings as ties on purpose. A % format is left out: a fraction
  // series prints scaled by 100, not as given.
  // A nonzero value that prints as the zero does ("0.0" for 0.004) loses its
  // sign and size; the fix carries the decimals that show it.
  const found = numericBody(format);
  const body = found && { index: found.index, text: found.text.trimEnd() }; // as parseFormatExample: a space after the number belongs to the unit
  // A figure count names its own precision: it shows every nonzero value and hides what its count says.
  const figures = spec.significantDigits;
  const checked = options?.variant !== 'bump' && !spec.suffix.includes('%') && figures === undefined;
  const zero = formatWithSpec(0, spec);
  const zeroed = checked ? numbers.flat().filter((v) => v !== 0 && formatWithSpec(v, spec) === zero) : [];
  // An authored scale holds the chart to one precision (shareAuthoredScale): the warning says what that draws.
  const locale = (options?.locale as { language?: string } | undefined)?.language;
  const shared = spec.magnitude !== 'none' && figures === undefined ? seriesRasterFormatter(format, numbers.flat(), locale, unit) : undefined;
  const raised = checked && shared !== undefined && shared.spec.decimals > spec.decimals;
  const smallest = numbers.flat().reduce((small, v) => v !== 0 && (small === 0 || Math.abs(v) < Math.abs(small)) ? v : small, 0);
  // Distinct at 12 significant digits, so float noise never asks for 20 decimals.
  const distinct = (row: readonly number[]) => new Set(row.map((v) => Number(v.toPrecision(12)))).size;
  const hidden = (row: readonly number[]) => distinct(row) > 1 && new Set(row.map((v) => formatWithSpec(v, spec))).size === 1;
  const hides = checked && numbers.some(hidden);
  if ((hides || raised || zeroed.length > 0) && body) {
    // The finer body keeps the style; an integer part of 0 keeps three decimals from reading as a group ("0.004", not "1.004").
    const finerAt = (decimals: number) => format.slice(0, body.index) + formatWithSpec(((spec.thousandsSep ? 1234 : decimals === 3 ? 0 : 1) + 0.123456789),
      { ...spec, decimals, signed: false, prefix: '', suffix: '', magnitude: 'none', magnitudeWord: undefined, locale: undefined }) + format.slice(body.index + body.text.length);
    // The proposed example must show what this one hides: every value of a hidden row apart, every zeroed value off 0.
    const shows = (example: string) => {
      const finerSpec = parseFormatExample(example);
      const print = (v: number) => formatWithSpec(v, finerSpec);
      return zeroed.every((v) => print(v) !== print(0))
        && numbers.every((row) => !hidden(row) || new Set(row.map(print)).size >= distinct(row));
    };
    let decimals = Math.max(spec.decimals + 1, raised ? shared.spec.decimals : 0);
    while (decimals < MAX_FORMAT_DECIMALS && !shows(finerAt(decimals))) decimals++;
    const finer = finerAt(decimals);
    return [{
      code: 'format-hides-values',
      severity: 'warn',
      message: raised
        ? `format '${format}' cannot show ${smallest} near its size, so the chart prints every value with ${shared.spec.decimals} decimals: ${smallest} as ${shared.fmt(smallest)}`
        : shared && zeroed.length > 0
        ? `format '${format}' cannot show ${zeroed[0]} on its scale, so the chart prints it as ${shared.fmt(zeroed[0]!)}`
        : zeroed.length > 0
        ? `format '${format}' prints the nonzero value ${zeroed[0]} as ${zero}`
        : `format '${format}' prints the different values of a series as one string`,
      suggest: `set a finer format such as '${finer}', or remove options.format to let the engine pick the precision`,
      field: ['options', 'format'],
      fix: [{ op: 'replace', path: '/options/format', value: finer }],
    }];
  }
  if (spec.magnitude !== 'none' || spec.suffix.includes('%') || unitMagnitude(unit)) return [];
  const largest = Math.max(0, maxOf(numbers.flat().map(Math.abs)));
  if (largest < 1e6) return [];
  const compact = `${spec.prefix}${figures === undefined ? `1${spec.decimalSep}2` : '@'.repeat(figures)}${largest >= 1e9 ? 'bn' : 'm'}${spec.suffix}`;
  return [{
    code: 'format-unscaled',
    severity: 'warn',
    message: `format '${format}' has no scale word, so values up to ${formatWithSpec(largest, spec)} print in all their digits`,
    suggest: `set a compact format such as '${compact}', or remove options.format to let the engine pick k, M or B`,
    field: ['options', 'format'],
    fix: [{ op: 'replace', path: '/options/format', value: compact }],
  }];
}

/** A printed number of seven or more integer digits, in any grouping ("1,800,000", "1.800.000", "1800000"); fraction digits do not count. Every group uses one separator, so "1,234.567" has four integer digits. */
const SEVEN_DIGITS = /(?<![\d.,])(?:\d{1,3}([,.\s\u00a0\u202f'’])\d{3}(?:\1\d{3})+|\d{7,})(?!\d)/u;
const NOT_VALUE_LABELS = new Set(['category', 'series', 'axisTitle']);

/** The texts of the drawn value labels, axis ticks and numeric table cells: what a reader reads as numbers. */
function drawnNumberTexts(geo: { labels?: readonly PlacedLabel[]; scene: readonly SceneNode[] }): string[] {
  return [
    ...(geo.labels ?? []).flatMap((label) => (label.hidden || NOT_VALUE_LABELS.has(label.kind) ? [] : [label.text])),
    ...geo.scene.flatMap((node) => (node.t === 'text' && (node.id.includes(':tick:') || (node.part === 'tableCell' && node.role !== 'category'))
      ? [node.lines.join(' ')] : [])),
  ];
}

/**
 * Unit rule. With no authored format example, a value in a magnitude
 * unit ($k, $m, k, m, €m, k€, EUR m, USD bn) prints without decimals from
 * 100 up; smaller values keep the raster. Authored percent values keep the
 * raster too (an authored 36.2 % must not flatten to 36 %); computed shares
 * follow `formatShare`.
 */
const MAGNITUDE_UNIT = /^\W*(?:([a-z]{3})(\W*))?(k|mm?|mn|bn?|tn|tsd|mio|mrd|bio|thousands?|tausend|millions?|millionen|billions?|billionen|trillions?|milliard(?:en?|s)?)\W*(?:([a-z]{3})\W*)?$/i;
const CURRENCY_CODES = new Set(Intl.supportedValuesOf('currency'));
// A scale word of MAGNITUDE_UNIT before a spaced noun of letters ("k visits", "Mio. Besucher"). Lowercase "m" and "mm"
// stay out: "m height" and "mm Hg" are physical units. A unit with "per" or a slash is a rate and never matches.
const SCALED_NOUN_UNIT = /^(?!.*\bper\b)(k|mm?|mn|bn?|tn|tsd|mio|mrd|bio|thousands?|tausend|millions?|millionen|billions?|billionen|trillions?|milliard(?:en?|s)?)\.?\s+\p{L}+(?:\s+\p{L}+)*$/iu;
const scaleOfWord = (word: string): NumberFormatSpec['magnitude'] => {
  const letter = MAGNITUDE_WORD_LETTER[word.toLowerCase()] ?? word.toLowerCase();
  return letter === 'k' ? 'k' : letter === 'b' ? 'bn' : letter === 't' ? 't' : 'm';
};

/**
 * The scale a unit names: "€M", "EUR m" and "CHFm" are millions, "k€"
 * thousands, "USD bn" billions, "Mio. CHF" millions; none for "%" or "EUR".
 * Three letters joined to the word must be a currency code: "USDm" names
 * millions, "item" does not. A currency may follow the word too. A scale
 * before a noun names one as well: "k visits", "million tonnes", "M users".
 */
export function unitMagnitude(unit: string | undefined): NumberFormatSpec['magnitude'] | undefined {
  const word = SCALED_NOUN_UNIT.exec(unit?.trim() ?? '')?.[1];
  if (word !== undefined && word !== 'm' && word !== 'mm') return scaleOfWord(word);
  const match = MAGNITUDE_UNIT.exec(unit ?? '');
  if (!match || (match[1] && !match[2] && !CURRENCY_CODES.has(match[1].toUpperCase()))) return undefined;
  if (match[4] && (match[1] || !CURRENCY_CODES.has(match[4].toUpperCase()))) return undefined;
  return scaleOfWord(match[3]!);
}

/**
 * The exhibit-wide value formatter: an authored example sets style and
 * precision. Without an example, plotted values set the precision. `fmtSigned` forces '+' on positives — the
 * derived-delta face used by waterfall sums and diff/delta annotations.
 * `unit` applies the unit rule; an authored example overrides it.
 * `defaultExample` preserves a composing chart's existing default precision;
 * it is not authored and therefore still permits the currency default.
 *
 * `forSeries` is the formatter for one series' value labels (a series
 * format overrides). A series `format` example prints in its own style and
 * precision, as a cell `format` does. A series `unit` applies the unit rule
 * in place of the chart unit, on the exhibit raster. A series with neither
 * prints with `fmt`. `shared` keeps one precision for every series: series
 * that share a stack or a total read as one set. `'set'` is the set rule of
 * setFormatPlan: shared, and every value prints at the set's one magnitude
 * and one decimal count.
 */
export function seriesRasterFormatter(
  example: string | undefined,
  values: Iterable<number | null | undefined>,
  locale?: string,
  unit?: string,
  target?: RenderTarget,
  defaultExample?: string,
  shared: boolean | 'set' = false,
): {
  spec: NumberFormatSpec;
  fmt: (value: number) => string;
  fmtSigned: (value: number) => string;
  /** An authored percent cell ({ pct }): the exhibit raster with '%', unless an example sets the style. */
  fmtPercent: (value: number) => string;
  /** The spec fmtPercent prints with, for a value axis whose ticks print what the percent cells print. */
  percentSpec: NumberFormatSpec;
  /** `values` gives the series' numbers where it is not a normalized series (`vals` or `cells`). */
  forSeries: (series: { format?: string; unit?: string; values?: readonly unknown[] }, cellFormat?: string) => (value: number) => string;
  /** The spec behind `forSeries` for a series without a cell format. */
  specForSeries: (series: { format?: string; unit?: string; values?: readonly unknown[] }) => NumberFormatSpec;
  /** True when the value prints as zero at its formatter's precision before the nonzero lift. */
  roundsToZeroAt: (value: number, series?: { format?: string; unit?: string }, cellFormat?: string) => boolean;
} {
  // Iterators must survive both magnitude selection and precision selection.
  const raster = [...values];
  const unitScale = unitMagnitude(unit);
  const spec = example ? exampleSpec(example, locale, unit, raster) : defaultExample ? localized(parseFormatExample(defaultExample, true), locale) : defaultFormatSpec(locale);
  if (!example) spec.automatic = true;
  const unscaledSpec = { ...spec };
  const set = shared === 'set';
  let autoMagnitude = false;
  // From 1e6 the engine picks M or B from the largest value. A unit that
  // names a scale ("€M", "USD bn") gets no second one: "48B" under "in €M"
  // reads as 48 billion millions. An authored example keeps its
  // digits; unscaledFormatLint warns.
  if (!example && target !== undefined && spec.magnitude === 'none' && !unitScale) {
    const max = raster.reduce<number>((largest, value) => value != null && Number.isFinite(value) ? Math.max(largest, Math.abs(value)) : largest, 0);
    if (max >= 1e6) {
      spec.magnitude = max >= 1e9 ? 'bn' : 'm';
      spec.rollMagnitude = false;
      autoMagnitude = true;
    }
    // A set prints every value at the one scale: "0.14B" beside "1.18B", never "140M".
    if (autoMagnitude && !set) {
      spec.autoMagnitude = true;
      // One decimal count for the values under the scale, each at its own scale.
      let stepDecimals = 0;
      for (const value of raster) {
        if (value == null || !Number.isFinite(value) || Math.abs(value) >= MAGNITUDE_DIVISOR[spec.magnitude]) continue;
        let own: NumberFormatSpec['magnitude'] = spec.magnitude;
        while (own !== 'none' && Math.abs(value) < MAGNITUDE_DIVISOR[own]) own = MAGNITUDE_PREVIOUS[own];
        const scaled = value / MAGNITUDE_DIVISOR[own];
        // The lift that keeps 0.004 off 0 is part of the shared count: "+0.004" beside "+0.040", not "+0.04".
        stepDecimals = Math.max(stepDecimals, nonzeroDecimals(scaled, neededDecimals(scaled, 2)));
      }
      if (stepDecimals > 0) spec.stepDecimals = stepDecimals;
    }
  }
  // A set takes one decimal count: no value of it prints whole on its own (unit rule, whole counts, whole currency).
  if (!example && !defaultExample && unitScale && !set) spec.wholeFrom = 100;
  // A unit ("%", "% of units") is not repeated on the numbers: the subtitle,
  // a panel or column head, or the axis title states it.
  if (!example) {
    // A default example's precision was set for unscaled values; after an automatic M/B the raster sets it (1.5M, not 2M).
    if (!defaultExample || autoMagnitude) spec.decimals = set ? setDecimals(raster, spec, autoMagnitude) : rasterDecimals(raster, spec);
    // Four significant digits is a preference, not a cap: different values that print one text under the engine scale get the decimals that part them.
    if (autoMagnitude) {
      const scaled = raster.filter((value): value is number => value != null && Number.isFinite(value) && (set || Math.abs(value) >= MAGNITUDE_DIVISOR[spec.magnitude]));
      spec.decimals += distinctDecimalLift(scaled.map((value) => ({ value, format: (extra: number) => formatWithSpec(value, { ...spec, decimals: spec.decimals + extra }) })));
    }
    if (currencyWholeNumbers(unit, target) && !set) spec.currencyWhole = true;
    // The unit rule already prints part of this raster whole, so a whole value under it
    // prints whole too: "32" beside "410", not "32.00".
    if (spec.wholeFrom && spec.decimals > 0 && raster.some((value) => value != null && Math.abs(value) >= spec.wholeFrom!)) spec.wholeCounts = true;
  }
  // The shared raster never prints a nonzero value as 0: a
  // value the raster rounds to zero keeps the digits that show it, 0.004
  // beside 12 prints "0.004". An authored example keeps the precision it
  // names, as status and heatmap do.
  const face = example ? formatWithSpec : formatNonzeroWithSpec;
  const fmt = (value: number) => face(value, spec);
  const signedSpec = { ...spec, signed: true };
  const fmtSigned = (value: number) => face(value, signedSpec);
  const percentSpec = { ...(spec.rollMagnitude === false ? { ...unscaledSpec, decimals: rasterDecimals(raster, unscaledSpec) } : spec), suffix: '%', wholeFrom: undefined, currencyWhole: undefined };
  const fmtPercent = example ? fmt : (value: number) => face(value, percentSpec);
  const byExample = memoFormatterFromExample(locale);
  // Each series takes its own precision: 0.034 beside a series of 0.5, not 0.03; 100 beside a series of 1.23, not 100.00.
  const seriesSpecs = new WeakMap<object, NumberFormatSpec>();
  const ownPrecision = (series: object, base: NumberFormatSpec): NumberFormatSpec => {
    if (example || defaultExample || autoMagnitude || shared) return base;
    let made = seriesSpecs.get(series);
    if (!made) {
      const numbers = normalizedSeriesNumbers(series);
      const decimals = numbers ? rasterDecimals(numbers, { ...base, decimals: unscaledSpec.decimals }) : base.decimals;
      made = decimals === base.decimals ? base : { ...base, decimals };
      seriesSpecs.set(series, made);
    }
    return made;
  };
  const plainSpec = (series: { unit?: string }): NumberFormatSpec => {
    const wholeFrom = !defaultExample && unitMagnitude(series.unit) ? 100 : undefined;
    const currencyWhole = currencyWholeNumbers(series.unit, target);
    // A series unit that names a scale gets no engine scale on top.
    const unscaled = autoMagnitude && unitMagnitude(series.unit) !== undefined;
    const base = example || series.unit === undefined || (wholeFrom === spec.wholeFrom && currencyWhole === Boolean(spec.currencyWhole) && !unscaled) ? spec
      : { ...(unscaled ? { ...spec, magnitude: 'none' as const, autoMagnitude: undefined, rollMagnitude: undefined } : spec), wholeFrom, currencyWhole };
    return ownPrecision(series, base);
  };
  /** The spec forSeries prints a series with, for a value axis whose ticks must read at the precision of their spacing. */
  const specForSeries = (series: { format?: string; unit?: string; values?: readonly unknown[] }): NumberFormatSpec =>
    series.format ? exampleSpec(series.format, locale, series.unit ?? unit, normalizedSeriesNumbers(series)) : plainSpec(series);
  const seriesFormatters = new WeakMap<object, (value: number) => string>();
  const forSeries = (series: { format?: string; unit?: string }, cellFormat?: string): ((value: number) => string) => {
    // The unit the value is in states the scale an example holds (exampleSpec).
    if (cellFormat) return byExample(cellFormat, series.unit ?? unit);
    let formatter = seriesFormatters.get(series);
    if (formatter) return formatter;
    if (series.format) {
      // A series format holds its own values to one scale and one decimal count (exampleSpec).
      formatter = formatterFromExample(series.format, locale, series.unit ?? unit, normalizedSeriesNumbers(series));
      seriesFormatters.set(series, formatter);
      return formatter;
    }
    const own = plainSpec(series);
    formatter = own === spec ? fmt : (value: number) => face(value, own);
    seriesFormatters.set(series, formatter);
    return formatter;
  };
  /**
   * Whether `value` is zero at the precision its formatter prints in, the
   * raster's before the nonzero lift: the test a rule about a
   * printed zero reads, since no nonzero value prints as one. An authored
   * format answers by its own text.
   */
  const roundsToZeroAt = (value: number, series: { format?: string; unit?: string } = {}, cellFormat?: string): boolean => {
    if (example || cellFormat || series.format) {
      const formatter = forSeries(series, cellFormat);
      return formatter(value) === formatter(0);
    }
    return roundsToZero(value / MAGNITUDE_DIVISOR[spec.magnitude], ownPrecision(series, spec).decimals);
  };
  return { spec, fmt, fmtSigned, fmtPercent, percentSpec: example ? spec : percentSpec, forSeries, specForSeries, roundsToZeroAt };
}

/** What a reader compares in one set: amounts, or shares in percent points (a set of its own). */
export type SetRole = 'value' | 'share';

/** seriesRasterFormatter's result for one set, with the magnitude and decimal count the set prints at. */
export type SetFormatPlan = ReturnType<typeof seriesRasterFormatter> & { magnitude: NumberFormatSpec['magnitude']; decimals: number };

/**
 * The precision plan of one set of comparable values: the value labels of
 * the series that share one axis or one stack, with their totals. Every
 * value prints at one magnitude, chosen from the largest absolute value at
 * the engine's thresholds, and at one decimal count, the most any value
 * asks (setDecimals): "1.18B · 0.59B · 0.29B · 0.14B", never "590M" beside
 * "1.18B". An authored `format` keeps its meaning at the existing precedence
 * (cell, series, chart), so the plan decides only what the author left open.
 * A `share` set holds percent points ("9.7" for 9.7 %) and takes its own
 * decimals: one below 10 %, none from 10 % up, the most any share asks, and
 * a trailing zero only where a share needs that place ("9.7% · 31.0%").
 * A value that stands alone keeps its own formatter.
 */
export function setFormatPlan(
  values: Iterable<number | null | undefined>,
  { role = 'value', format, locale, unit, target }: { role?: SetRole; format?: string; locale?: string; unit?: string; target?: RenderTarget } = {},
): SetFormatPlan {
  if (role === 'value') {
    const raster = seriesRasterFormatter(format, values, locale, unit, target, undefined, 'set');
    return { ...raster, magnitude: raster.spec.magnitude, decimals: raster.spec.decimals };
  }
  const shares = [...values].filter((value): value is number => value != null && Number.isFinite(value) && value !== 0).map(Math.abs);
  let decimals = 0;
  for (const share of shares) decimals = Math.max(decimals, neededDecimals(share, smallRateDecimals(share)));
  for (const share of shares) {
    const shown = Math.min(nonzeroDecimals(share, decimals), AUTO_MAX_DECIMALS);
    if (!roundsToZero(share, shown)) decimals = Math.max(decimals, shown);
  }
  const spec: NumberFormatSpec = { ...defaultFormatSpec(locale), suffix: '%', decimals };
  const signedSpec = { ...spec, signed: true };
  const fmt = (value: number) => formatWithSpec(value, spec);
  return {
    spec, fmt, fmtSigned: (value) => formatWithSpec(value, signedSpec), fmtPercent: fmt, percentSpec: spec,
    forSeries: () => fmt, specForSeries: () => spec, roundsToZeroAt: (value) => roundsToZero(value, decimals),
    magnitude: 'none', decimals,
  };
}

/**
 * The printed numbers of a series: its `values`, or a normalized series'
 * `vals` or `cells`. A cell is a number, `{ v }`, `{ number }` or a keyed
 * `{ value }`, and its `range` ends count too. Undefined where none is read:
 * the shared precision stands, never a precision of 0.
 */
export function normalizedSeriesNumbers(series: object): number[] | undefined {
  const { values, vals, cells } = series as { values?: unknown; vals?: unknown; cells?: unknown };
  const list = Array.isArray(values) ? values : Array.isArray(vals) ? vals : Array.isArray(cells) ? cells : undefined;
  if (!list) return undefined;
  const numbers: number[] = [];
  const read = (item: unknown): void => {
    if (typeof item === 'number') { if (Number.isFinite(item)) numbers.push(item); return; }
    if (item === null || typeof item !== 'object') return;
    const cell = item as { v?: unknown; number?: unknown; value?: unknown; range?: { low?: unknown; high?: unknown; mid?: unknown } | null };
    read(cell.v ?? cell.number ?? cell.value);
    if (cell.range && typeof cell.range === 'object') for (const end of [cell.range.low, cell.range.high, cell.range.mid]) read(end);
  };
  for (const item of list) read(item);
  return numbers.length > 0 ? numbers : undefined;
}

/**
 * One formatter per example string for the life of a layout call: a layout
 * that formats every value of a series by its example builds the formatter
 * once instead of once per value.
 */
export function memoFormatterFromExample(locale?: string): (example: string, unit?: string) => ReturnType<typeof formatterFromExample> {
  const cache = new Map<string, ReturnType<typeof formatterFromExample>>();
  return (example, unit) => {
    const key = `${unit ?? ''}\u0000${example}`;
    let formatter = cache.get(key);
    if (!formatter) {
      formatter = formatterFromExample(example, locale, unit);
      cache.set(key, formatter);
    }
    return formatter;
  };
}
