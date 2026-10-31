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
import { maxOf } from './arrays';

/** A composing chart's generated example is still an automatic format. */
export const AUTOMATIC_FORMAT = Symbol('automatic-format');
export type AutomaticFormatSource = { [AUTOMATIC_FORMAT]?: true };
/** A composing chart's rows of one measure: they print in one magnitude, picked from their largest cell. */
export const MAGNITUDE_GROUP = Symbol('magnitude-group');
export type MagnitudeGroupSource = { [MAGNITUDE_GROUP]?: string };

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
  negative: 'minus' | 'parens';
  /** Force '+' on positive values. */
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
 * m, b and T (upper case only: "12 t" is tonnes), the abbreviations mn, mm,
 * bn and tn, the German Tsd., Mio., Mrd. and Bio. (dot optional), and the
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
  // Glued only: SI spaces a unit, so "1.5 T" stays tesla and "$1.2T" is trillions.
  { re: new RegExp(String.raw`^T${WORD_END}`, 'u'), key: 't', glued: true },
  { re: new RegExp(String.raw`^(?:bn|b|mrd\.?)${WORD_END}`, 'iu'), key: 'bn' },
  { re: new RegExp(String.raw`^(?:k|tsd\.?)${WORD_END}`, 'iu'), key: 'k' },
  { re: new RegExp(String.raw`^(?:mm|mn|m|mio\.?)${WORD_END}`, 'iu'), key: 'm' },
];

/** The one-letter spelling of every magnitude word `sameUnit` and `MAGNITUDE_UNIT` accept. */
const MAGNITUDE_WORD_LETTER: Record<string, string> = {
  bn: 'b', mn: 'm', mm: 'm', mio: 'm', mrd: 'b', tsd: 'k', thousand: 'k', thousands: 'k', tausend: 'k',
  million: 'm', millions: 'm', millionen: 'm', billion: 'b', billions: 'b', milliarde: 'b', milliarden: 'b',
  milliard: 'b', milliards: 'b', tn: 't', bio: 't', trillion: 't', trillions: 't', billionen: 't',
};

export function parseFormatExample(example: string, keepWord = false): NumberFormatSpec {
  const s = String(example).trim();

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
  let lead = before;
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
    const word = m.glued && tail !== tailTrimmed ? null : m.re.exec(tailTrimmed);
    if (word) {
      spec.magnitude = m.key;
      // "€1.2bn" prints "bn", "1,2 Mio. €" prints " Mio."; the letter is the engine's spelling.
      if (keepWord) spec.magnitudeWord = { magnitude: m.key, text: tail.slice(0, tail.length - tailTrimmed.length) + word[0] };
      tail = tailTrimmed.replace(m.re, '');
      break;
    }
  }
  spec.suffix = tail; // keep remaining unit text (e.g. '%', 'pp', ' €')
  // 'pp' is a unit suffix, never a magnitude. 1.2pp is 1.2 percentage points.
  // A spreadsheet code such as "#,##0" took its last 0 as the number and
  // printed "#,##" before every value. A lone literal # ("#1",
  // "Rank #1") is a unit, not a placeholder.
  if (SPREADSHEET_CODE.test(String(example))) {
    throw new NormalizeError('invalid-format', 'format', `invalid-format-example: '${example}' is a spreadsheet number code, not a format-by-example; write an example number as it should print`, "write an example number as it should print, e.g. '1,234' instead of '#,##0'");
  }

  // Analyze the numeric body for separators.
  analyzeBody(body, spec);
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
  const body = numericBody(example);
  const text = body?.text.trimEnd();
  if (text === undefined || !GROUP_OR_DECIMALS.test(text)) return undefined;
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
function mapExamples<T>(node: T, change: (example: string) => string, seen = new Map<unknown, unknown>(), keys: 'format' | 'all' | 'none' = 'format'): T {
  if (!isPlainTree(node)) return node;
  if (seen.has(node)) return seen.get(node) as T;
  seen.set(node, node);
  let changed: Record<string, unknown> | undefined;
  for (const key of Object.keys(node)) {
    const child = node[key];
    const example = keys === 'all' || (keys === 'format' && key === 'format');
    // `cells` is keyed by column id, so a text column named format holds no example; a cell object's own format does.
    const next = typeof child === 'string' ? (example ? change(child) : child)
      : mapExamples(child, change, seen, key === 'axisFormat' ? 'all' : key === 'cells' ? 'none' : 'format');
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
 * ponytail: one reading per chart from all of its numbers, a number that is no
 * value counts too; per-field numbers if a real chart needs them.
 */
export function readFormatExamples<D, O>(data: D, options: O): { data: D; options: O; warnings: LintWarning[] } {
  const examples = new Set<string>();
  const collect = (example: string) => {
    if (decimalExample(example) !== undefined) examples.add(example);
    return example;
  };
  mapExamples(data, collect);
  mapExamples(options, collect);
  if (examples.size === 0) return { data, options, warnings: [] };
  const numbers = treeNumbers(data);
  const readings = new Map([...examples].map((example) => [example, exampleReading(example, numbers)]));
  const change = (example: string) => readings.get(example)?.decimals ?? example;
  return {
    data: mapExamples(data, change),
    options: mapExamples(options, change),
    warnings: [...readings].flatMap(([example, { lost }]) => lost === undefined ? [] : [{
      code: 'format-reads-as-group',
      severity: 'warn' as const,
      message: `format '${example}' reads as a thousands group on this chart, so ${lost} prints ${formatWithSpec(lost, parseFormatExample(example))}`,
      suggest: `write ${JSON.stringify(decimalExample(example))} for three decimals, or remove the format to let the engine pick the precision`,
    }]),
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
  const unit = `${spec.prefix.trim()}${magnitudeText(spec, spec.magnitude).trim()}${spec.suffix.trim()}`;
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
    if (Number(scaled.toFixed(decimals)) < 1000 || next === null) {
      return !spec.nonzero || spec.automatic || value === 0 || !roundsToZero(scaled, decimals) ? { magnitude, decimals } : rolledDown(value, magnitude, baseDecimals);
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
  if (magnitude === 'none') return '';
  const authored = spec.magnitudeWord;
  if (!authored) return magnitudeLabel(spec, magnitude);
  const authoredFamily = wordFamily(authored.text, spec.locale);
  const language = chartLanguage(spec.locale);
  const family = localFamily(authoredFamily, language);
  const space = /^\s*/.exec(authored.text)![0];
  if (family === LETTERS) {
    // k and M read alike in German and French; B and T take the local short form ("2,5 Mrd.", "2,5 Md"), as the engine letters do.
    if ((language === 'de' || language === 'fr') && (magnitude === 'bn' || magnitude === 't')) return magnitudeSuffix(magnitude, spec.locale);
    return authored.magnitude === magnitude ? authored.text : MAGNITUDE_LABEL[magnitude];
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

export function formatWithSpec(value: number, spec: NumberFormatSpec): string {
  if (value == null || !Number.isFinite(value) || Object.is(value, -0)) return formatWithSpecUncached(value, spec);
  if (specTexts >= MAX_SPEC_TEXTS) {
    // Bound long-lived hosts: drop every shared text and every plan that points at one.
    for (const texts of sharedTexts.values()) texts.clear();
    sharedTexts.clear();
    specTexts = 0;
    textGeneration++;
  }
  const texts = textPlan(spec).texts;
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

function formatWithSpecUncached(value: number, spec: NumberFormatSpec): string {
  if (value == null) return '';
  // Same state glyph as formatNumber — one spelling of a non-finite across both
  // engines. Emitted bare: prefix/suffix/parens are unit and sign claims that a
  // non-value cannot make ("$Infinity.M" and "(Infinity)" were both possible).
  const glyph = nonFiniteGlyph(value);
  if (glyph !== null) return glyph === 'n/a' ? chartString({ locale: { language: spec.locale } }, 'notApplicable') : glyph;
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

  const core = `${spec.prefix}${num}${spec.suffix}`;
  if (negative) {
    return spec.negative === 'parens' ? `(${core})` : `${MINUS}${core}`;
  }
  return spec.signed && !isZero ? `+${core}` : core;
}

/**
 * The numeric value a reader SEES for `value` under `spec` — the exact same
 * rounding path as formatWithSpec (toFixed on the magnitude-scaled abs,
 * INCLUDING the 1000-rollover to the next magnitude). Reconciliation math
 * must use THIS, never a reimplemented rounding: two rounding paths that
 * disagree on one cell fabricate a phantom gap.
 */
export function roundedNumber(value: number, spec: NumberFormatSpec): number {
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
 * under "$k" for a "$1.2k" example, never "$1.0M").
 */
export function exampleSpec(example: string, locale?: string, unit?: string): NumberFormatSpec {
  const spec = localized(parseFormatExample(example, true), locale);
  spec.nonzero = true;
  if (spec.magnitude !== 'none' && unitMagnitude(unit) === spec.magnitude) spec.rollMagnitude = false;
  // An example under 1000 ("12%", "1.2") cannot show grouping, so a value from
  // 1000 up groups in the example's style ("40,000,000,000%"), as table cells
  // do. "1234" and "2024" state no grouping, nor does a literal-# rank ("#1").
  if (spec.prefix.endsWith('#')) return spec;
  const body = numericBody(String(example))?.text ?? '';
  const integer = spec.decimals > 0 ? body.slice(0, body.lastIndexOf(spec.decimalSep)) : body;
  if (spec.thousandsSep === '' && integer.replace(/\D/g, '').length < 4) spec.thousandsSep = spec.decimalSep === ',' ? '.' : ',';
  return spec;
}

/** Parse an example and return a ready-to-use formatter. The chart locale is required (pass undefined for none), so no caller forgets it. */
export function formatterFromExample(example: string, locale: string | undefined, unit?: string): (value: number) => string {
  const spec = exampleSpec(example, locale, unit);
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
export function signedFormatterFromExample(example: string, locale: string | undefined, unit?: string): (value: number) => string {
  const spec = { ...exampleSpec(example, locale, unit), signed: true };
  return (value: number) => formatWithSpec(value, spec);
}

/**
 * The example a difference of two values prints with: the same, except that
 * the difference of two percent levels is in percentage points.
 */
export function differenceExample(example: string): string {
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
 * Derived statistics — means, medians, MADs, corridor bounds — are the
 * exhibit's OWN claims, not plotted data: they render in the exhibit's style
 * but never round to a DIFFERENT number than they are. Decimals lift at most
 * ONE step past the raster — enough that an integer-rastered exhibit prints
 * its mean as "27.5" and never "28", without escalating every irrational
 * bound to full precision ("23.4", not "23.35").
 */
export function formatStatWithSpec(value: number, spec: NumberFormatSpec): string {
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
  const precision = (scaled: number): number => scaled === 0 || scaled >= 100 ? 0 : scaled >= 1 ? 1 : 1 - Math.floor(Math.log10(scaled));
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
      return formatWithSpec(Math.sign(rate) * digits, { ...rateSpec, decimals: 1, suffix: `${scientificText(Math.abs(rate), () => '')}${face.suffix}` });
    }
    return formatWithSpec(rate, rateSpec);
  };
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
  const format = exampleReading(authored, numbers.flat()).decimals ?? authored;
  let spec: NumberFormatSpec;
  try { spec = parseFormatExample(format); } catch { return []; }
  // A series whose different values all print as one string hides them. The
  // format stays the author's; the fix adds one decimal. Bump ranks read
  // equal strings as ties on purpose. A % format is left out: a fraction
  // series prints scaled by 100, not as given.
  // A nonzero value that prints as the zero does ("0.0" for 0.004) loses its
  // sign and size; the fix carries the decimals that show it.
  const body = numericBody(format);
  const checked = options?.variant !== 'bump' && !spec.suffix.includes('%');
  const zero = formatWithSpec(0, spec);
  const zeroed = checked ? numbers.flat().filter((v) => v !== 0 && formatWithSpec(v, spec) === zero) : [];
  // Distinct at 12 significant digits, so float noise never asks for 20 decimals.
  const distinct = (row: readonly number[]) => new Set(row.map((v) => Number(v.toPrecision(12)))).size;
  const hidden = (row: readonly number[]) => distinct(row) > 1 && new Set(row.map((v) => formatWithSpec(v, spec))).size === 1;
  const hides = checked && numbers.some(hidden);
  if ((hides || zeroed.length > 0) && body) {
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
    let decimals = spec.decimals + 1;
    while (decimals < MAX_FORMAT_DECIMALS && !shows(finerAt(decimals))) decimals++;
    const finer = finerAt(decimals);
    return [{
      code: 'format-hides-values',
      severity: 'warn',
      message: zeroed.length > 0
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
  const compact = `${spec.prefix}1${spec.decimalSep}2${largest >= 1e9 ? 'bn' : 'm'}${spec.suffix}`;
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

/** The texts of the drawn value labels and axis ticks: what a reader reads as numbers. */
function drawnNumberTexts(geo: { labels?: readonly PlacedLabel[]; scene: readonly SceneNode[] }): string[] {
  return [
    ...(geo.labels ?? []).flatMap((label) => (label.hidden || NOT_VALUE_LABELS.has(label.kind) ? [] : [label.text])),
    ...geo.scene.flatMap((node) => (node.t === 'text' && node.id.includes(':tick:') ? [node.lines.join(' ')] : [])),
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

/**
 * The scale a unit names: "€M", "EUR m" and "CHFm" are millions, "k€"
 * thousands, "USD bn" billions, "Mio. CHF" millions; none for "%" or "EUR".
 * Three letters joined to the word must be a currency code: "USDm" names
 * millions, "item" does not. A currency may follow the word too.
 */
export function unitMagnitude(unit: string | undefined): NumberFormatSpec['magnitude'] | undefined {
  const match = MAGNITUDE_UNIT.exec(unit ?? '');
  if (!match || (match[1] && !match[2] && !CURRENCY_CODES.has(match[1].toUpperCase()))) return undefined;
  if (match[4] && (match[1] || !CURRENCY_CODES.has(match[4].toUpperCase()))) return undefined;
  const letter = MAGNITUDE_WORD_LETTER[match[3]!.toLowerCase()] ?? match[3]!.toLowerCase();
  return letter === 'k' ? 'k' : letter === 'b' ? 'bn' : letter === 't' ? 't' : 'm';
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
 * that share a stack or a total read as one set.
 */
export function seriesRasterFormatter(
  example: string | undefined,
  values: Iterable<number | null | undefined>,
  locale?: string,
  unit?: string,
  target?: RenderTarget,
  defaultExample?: string,
  shared = false,
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
  /** True when the value prints as zero at its formatter's precision before the nonzero lift. */
  roundsToZeroAt: (value: number, series?: { format?: string; unit?: string }, cellFormat?: string) => boolean;
} {
  // Iterators must survive both magnitude selection and precision selection.
  const raster = [...values];
  const unitScale = unitMagnitude(unit);
  const spec = example ? exampleSpec(example, locale, unit) : defaultExample ? localized(parseFormatExample(defaultExample, true), locale) : defaultFormatSpec(locale);
  if (!example) spec.automatic = true;
  const unscaledSpec = { ...spec };
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
      spec.autoMagnitude = true;
      autoMagnitude = true;
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
  if (!example && !defaultExample && unitScale) spec.wholeFrom = 100;
  // A unit ("%", "% of units") is not repeated on the numbers: the subtitle,
  // a panel or column head, or the axis title states it.
  if (!example) {
    // A default example's precision was set for unscaled values; after an automatic M/B the raster sets it (1.5M, not 2M).
    if (!defaultExample || autoMagnitude) spec.decimals = rasterDecimals(raster, spec);
    // Four significant digits is a preference, not a cap: different values that print one text under the engine scale get the decimals that part them.
    if (autoMagnitude) {
      const scaled = raster.filter((value): value is number => value != null && Number.isFinite(value) && Math.abs(value) >= MAGNITUDE_DIVISOR[spec.magnitude]);
      spec.decimals += distinctDecimalLift(scaled.map((value) => ({ value, format: (extra: number) => formatWithSpec(value, { ...spec, decimals: spec.decimals + extra }) })));
    }
    if (currencyWholeNumbers(unit, target)) spec.currencyWhole = true;
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
  const seriesFormatters = new WeakMap<object, (value: number) => string>();
  const forSeries = (series: { format?: string; unit?: string }, cellFormat?: string): ((value: number) => string) => {
    // The unit the value is in states the scale an example holds (exampleSpec).
    if (cellFormat || series.format) return byExample((cellFormat ?? series.format)!, series.unit ?? unit);
    let formatter = seriesFormatters.get(series);
    if (formatter) return formatter;
    const wholeFrom = !defaultExample && unitMagnitude(series.unit) ? 100 : undefined;
    const currencyWhole = currencyWholeNumbers(series.unit, target);
    // A series unit that names a scale gets no engine scale on top.
    const unscaled = autoMagnitude && unitMagnitude(series.unit) !== undefined;
    const base = example || series.unit === undefined || (wholeFrom === spec.wholeFrom && currencyWhole === Boolean(spec.currencyWhole) && !unscaled) ? spec
      : { ...(unscaled ? { ...spec, magnitude: 'none' as const, autoMagnitude: undefined, rollMagnitude: undefined } : spec), wholeFrom, currencyWhole };
    const own = ownPrecision(series, base);
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
  return { spec, fmt, fmtSigned, fmtPercent, percentSpec: example ? spec : percentSpec, forSeries, roundsToZeroAt };
}

/**
 * The printed numbers of a series: its `values`, or a normalized series'
 * `vals` or `cells`. A cell is a number, `{ v }`, `{ number }` or a keyed
 * `{ value }`, and its `range` ends count too. Undefined where none is read:
 * the shared precision stands, never a precision of 0.
 */
function normalizedSeriesNumbers(series: object): number[] | undefined {
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
