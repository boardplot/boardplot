export const MAX_FORMAT_DECIMALS = 20;

/** Lift a label set together when different values round to the same text. */
export function distinctDecimalLift(entries: readonly { value: number; format: (extra: number) => string }[]): number {
  for (let extra = 0; extra < 2; extra++) {
    const printed = new Map<string, number>();
    let tied = false;
    for (const entry of entries) {
      const text = entry.format(extra);
      if (printed.has(text) && printed.get(text) !== entry.value) { tied = true; break; }
      printed.set(text, entry.value);
    }
    if (!tied) return extra;
  }
  return 2;
}

export function checkedDecimals(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_FORMAT_DECIMALS) {
    throw new RangeError(`decimals must be an integer between 0 and ${MAX_FORMAT_DECIMALS}`);
  }
  return value;
}

/**
 * Round a non-negative number to `decimals` places the way a reader rounds:
 * half away from zero on the DECIMAL digits. `toFixed` rounds the binary
 * value, so 1.005 becomes "1.00" and 2.675 becomes "2.67" while the default
 * formatter (Intl) prints 1.01 and 2.68 for the same inputs. Both engines
 * share this one path. Numbers already in exponent form fall back to
 * toFixed, where the decimal trick cannot be applied.
 */
/**
 * Business default for an unformatted value: whole numbers and anything at
 * or above 100 print with no decimals; a small non-integer keeps one, so a
 * 0.4 sliver never prints as "0". One rule, shared by every chart.
 */
export function autoDecimals(value: number): number {
  return Number.isInteger(value) || Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 1 ? 1 : typicalDecimals([value]);
}

/** The most decimals an automatic format prints, anywhere. */
export const AUTO_MAX_DECIMALS = 4;

/**
 * The automatic precision of a column or series whose values are all below
 * 1: the typical value is the LARGEST absolute value (as decimalCap reads
 * it), and it keeps two significant digits: 0.0341 takes three decimals, so
 * 0.0123 and 0.0051 print 0.012 and 0.005. No more decimals than the values
 * carry (0.5 stays 0.5) and at most AUTO_MAX_DECIMALS. A smaller value
 * prints its bound ("<0.001"). 0 when the largest value is 1 or more: the
 * caller's own rule for larger values stands.
 */
export function typicalDecimals(values: Iterable<number>): number {
  let largest = 0;
  let carried = 0;
  for (const value of values) {
    if (!Number.isFinite(value) || value === 0) continue;
    largest = Math.max(largest, Math.abs(value));
    carried = Math.max(carried, authoredDecimals(value));
  }
  if (largest === 0 || largest >= 1) return 0;
  return Math.min(carried, AUTO_MAX_DECIMALS, 1 - Math.floor(Math.log10(largest)));
}

/**
 * How an automatic format prints a nonzero value below its last shown digit
 * (options.smallValues): 'bound' "<0.01" (default), 'zero' the format's own
 * "0.00", 'scientific' "1.2 × 10⁻⁹". 'p-value' prints every value from 0 to
 * 1 as APA 7 writes a p-value: three decimals, no leading zero, "<.001" below.
 */
export type SmallValues = 'bound' | 'zero' | 'scientific' | 'p-value';
let smallValuesMode: SmallValues = 'bound';

/** The decimals of an APA p-value. */
export const P_VALUE_DECIMALS = 3;

/** True where an automatic value prints as an APA p-value (options.smallValues 'p-value'): from 0 to 1 only. */
export function printsPValue(value: number): boolean {
  return smallValuesMode === 'p-value' && value >= 0 && value <= 1;
}

/** APA 7 drops the leading zero of a value that cannot exceed 1: "0.042" prints ".042", "<0.001" "<.001". */
export function withoutLeadingZero(text: string): string {
  return text.replace(/(^|[^\d])0(?=[.,]\d)/, '$1');
}

/**
 * How an automatic value that prints as 0 at `decimals` prints instead. At
 * the AUTO_MAX_DECIMALS floor the bound gives way to scientific form: a
 * series of values near 1e-13 would otherwise print "<0.0001" on every
 * label and tick.
 */
export function belowPrecision(decimals: number): SmallValues {
  // A value outside a p-value's 0 to 1 prints by the default rule.
  const mode = smallValuesMode === 'p-value' ? 'bound' : smallValuesMode;
  return mode === 'bound' && decimals >= AUTO_MAX_DECIMALS ? 'scientific' : mode;
}

/** The options.smallValues mode in force: a part of every cache key that keeps formatted text across layouts. */
export function currentSmallValues(): SmallValues {
  return smallValuesMode;
}

/**
 * Run one chart layout under its smallValues mode; undefined keeps the
 * enclosing mode, so a grid panel follows its grid.
 * Limit: module state for a synchronous layout, as withLayoutMemo; a formatter argument if layouts ever interleave.
 */
export function withSmallValues<T>(mode: SmallValues | undefined, run: () => T): T {
  if (mode === undefined || mode === smallValuesMode) return run();
  const before = smallValuesMode;
  smallValuesMode = mode;
  try { return run(); } finally { smallValuesMode = before; }
}

/** The stand-ins that readFormatExamples wrote for a chart's unit-only formats, on its resolved options. */
export const UNIT_STAND_INS = Symbol('unit-stand-ins');
/** The examples the author wrote for a chart, and their differences (readFormatExamples), on its resolved options. */
export const AUTHORED_EXAMPLES = Symbol('authored-examples');
type FormatSets = { [UNIT_STAND_INS]?: ReadonlySet<string>; [AUTHORED_EXAMPLES]?: ReadonlySet<string> };
let unitStandIns: ReadonlySet<string> | undefined;
let authoredExamples: ReadonlySet<string> | undefined;

/** The stand-ins in force for these options: their own when they have any, else the enclosing ones. */
function standInsOf(options: object | undefined): ReadonlySet<string> | undefined {
  const own = (options as FormatSets | undefined)?.[UNIT_STAND_INS];
  return own?.size ? own : unitStandIns;
}

/** The authored examples in force for these options: their own, else the enclosing ones. */
function authoredOf(options: object | undefined): ReadonlySet<string> | undefined {
  return (options as FormatSets | undefined)?.[AUTHORED_EXAMPLES] ?? authoredExamples;
}

/**
 * Run one chart's layout or text under its unit-only stand-ins and the
 * examples its author wrote; a chart without stand-ins keeps the enclosing
 * ones, and one without its own examples the enclosing examples, so a grid
 * panel follows its grid. Limit: module state for synchronous work, as
 * withSmallValues.
 */
export function withUnitStandIns<T>(options: object | undefined, run: () => T): T {
  const standIns = standInsOf(options);
  const authored = authoredOf(options);
  if (standIns === unitStandIns && authored === authoredExamples) return run();
  const before = { standIns: unitStandIns, authored: authoredExamples };
  unitStandIns = standIns;
  authoredExamples = authored;
  try { return run(); } finally { unitStandIns = before.standIns; authoredExamples = before.authored; }
}

/** Whether readFormatExamples wrote this example for a unit-only format of the chart in force. */
export function isUnitStandIn(example: string): boolean {
  return unitStandIns?.has(example) === true;
}

/** Whether the chart in force names this example as authored; outside any chart every example is. */
export function isAuthoredExample(example: string): boolean {
  return authoredExamples === undefined || authoredExamples.has(example);
}

/** Whether these options, or the chart in force, carry the record of which formats the author wrote. */
export function hasFormatRecord(options?: object): boolean {
  return authoredOf(options) !== undefined;
}

const setKeys = new WeakMap<ReadonlySet<string>, string>();
function setKey(set: ReadonlySet<string> | undefined): string {
  if (set === undefined) return '-';
  let key = setKeys.get(set);
  if (key === undefined) setKeys.set(set, key = JSON.stringify([...set].sort()));
  return key;
}

/**
 * The format sets in force for these options (or the enclosing chart's), as
 * a part of every cache key that keeps formatted text: the same examples
 * print otherwise under another chart's sets. Each set's part is built once.
 */
export function formatScopeKey(options?: object): string {
  return setKey(standInsOf(options)) + '/' + setKey(authoredOf(options));
}

const SUPERSCRIPT: Record<string, string> = { '-': '\u207b', 0: '\u2070', 1: '\u00b9', 2: '\u00b2', 3: '\u00b3', 4: '\u2074', 5: '\u2075', 6: '\u2076', 7: '\u2077', 8: '\u2078', 9: '\u2079' };

/**
 * A nonzero value in scientific form, two significant digits and a power of
 * ten as ISO 80000-1 and the SI Brochure write it: "1.2 × 10⁻⁹". `mantissa`
 * prints the one-decimal mantissa with the format's marks.
 */
export function scientificText(abs: number, mantissa: (value: number) => string): string {
  const { digits, exponent } = scientificParts(abs);
  return `${mantissa(digits)}\u00a0×\u00a010${String(exponent).replace(/[-\d]/g, (c) => SUPERSCRIPT[c]!)}`;
}

/** The two-significant-digit mantissa and the power of ten scientificText prints. */
export function scientificParts(abs: number): { digits: number; exponent: number } {
  let exponent = Math.floor(Math.log10(abs));
  let digits = Number(roundHalfUp(abs / 10 ** exponent, 1));
  if (digits >= 10) digits = Number(roundHalfUp(abs / 10 ** ++exponent, 1));
  return { digits, exponent };
}

/**
 * Share precision for a computed share in percent points (stacked100, pie,
 * mekko, stacked100-area): one decimal below 10 % and none from 10 % up, so a
 * 0.4 % share never reads "0%". The magnitude-unit twin is
 * NumberFormatSpec.wholeFrom.
 */
export function shareDecimals(percent: number): number {
  return percent !== 0 && Number(roundHalfUp(Math.abs(percent), 1)) < 10 ? 1 : 0;
}

/**
 * One precision for the shares of one whole ("8 % beside 92 %", never
 * "8.4 % beside 92 %"): whole percents, one decimal more for as long as a
 * nonzero share would print as 0. For the lanes that print shares of one
 * whole side by side (pie, mekko, stacked100).
 */
export function shareSetDecimals(percents: Iterable<number>): number {
  let decimals = 0;
  // At most one decimal: a share under 0.05 % prints "<0.1%"
  // (formatShare), so one tiny share does not lift every share of the
  // chart to ten decimals.
  for (const percent of percents) decimals = Math.min(SHARE_MAX_DECIMALS, nonzeroDecimals(percent, decimals));
  return decimals;
}

/** A computed share prints whole or with one decimal, never more. */
const SHARE_MAX_DECIMALS = 1;

/**
 * `decimals`, raised for as long as a nonzero `value` would print as 0:
 * 0.004 at two decimals takes three and prints "0.004". The one lift every
 * reading that must not print a nonzero value as zero goes through.
 */
export function nonzeroDecimals(value: number, decimals: number): number {
  while (decimals < MAX_FORMAT_DECIMALS && value !== 0 && Number.isFinite(value) && roundsToZero(value, decimals)) decimals++;
  return decimals;
}

/**
 * Lifts made so far. A table layout reads it before and after one resolve:
 * only a resolve that lifted lays out again to check the lift costs no width.
 * Limit: a module counter, single-threaded; a returned flag if formatting ever runs concurrently.
 */
export const zeroLifts = { count: 0 };

/** Keep normal rounding; lift only an automatic value that would print as zero. */
export function roundForDisplay(abs: number, decimals: number, automatic = false): { text: string; decimals: number; scientific?: true } {
  const rounded = roundHalfUp(abs, decimals);
  if (!automatic || abs >= 1 || abs === 0 || !Number.isFinite(abs) || Number(rounded) !== 0) return { text: rounded, decimals };
  zeroLifts.count++;
  const places = nonzeroDecimals(abs, decimals);
  const text = roundHalfUp(abs, places);
  // Fixed decimals stop at 20. Smaller finite values still need a visible digit.
  if (Number(text) === 0) {
    return { text: abs.toExponential(0), decimals: 0, scientific: true };
  }
  return { text, decimals: places };
}

/** Preserve a nonzero source when division by a display magnitude underflows. */
export function underflowScientificText(value: number, divisor: number): string {
  const [digit, exponent] = Math.abs(value).toExponential(0).split('e');
  return `${digit}E${Number(exponent) - Math.log10(divisor)}`;
}

/**
 * One precision for a set of values: the decimals the finest
 * value needs, so 6 prints "6.0" beside "7.9" and never "6" beside it.
 */
export function valueSetDecimals(values: Iterable<number>): number {
  const set = [...values];
  // A value under 1 asks for one decimal here; typicalDecimals sets more when the whole set is under 1.
  let decimals = typicalDecimals(set);
  for (const value of set) if (Number.isFinite(value)) decimals = Math.max(decimals, Math.abs(value) < 1 ? (value === 0 ? 0 : 1) : autoDecimals(value));
  return decimals;
}

/** The decimal places an authored number carries as written: 80.04 has 2, 1.5e-7 has 8, 1200 has 0. */
export function authoredDecimals(value: number): number {
  const [mantissa = '', exponent = '0'] = String(Math.abs(value)).split('e');
  const dot = mantissa.indexOf('.');
  return Math.min(MAX_FORMAT_DECIMALS, Math.max(0, (dot === -1 ? 0 : mantissa.length - dot - 1) - Number(exponent)));
}

export function roundHalfUp(abs: number, decimals: number): string {
  const text = String(abs);
  if (!/e/i.test(text)) {
    const shifted = Number(`${text}e${decimals}`);
    if (Number.isFinite(shifted)) return (Math.round(shifted) / 10 ** decimals).toFixed(decimals);
  }
  return abs.toFixed(decimals);
}

const MAX_SIGNIFICANT_DIGITS = 21;

export function checkedSignificantDigits(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_SIGNIFICANT_DIGITS) {
    throw new RangeError(`significantDigits must be an integer between 1 and ${MAX_SIGNIFICANT_DIGITS}`);
  }
  return value;
}

/** Group an integer digit string with a thousands separator. Empty separator leaves digits untouched. */
export function groupInteger(intPart: string, thousandsSep: string): string {
  return thousandsSep ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousandsSep) : intPart;
}

/**
 * Round a non-negative number to `sig` significant digits. Fraction digits
 * are the ones a reader sees after the decimal; values that round into tens
 * or hundreds keep zero fraction digits (1234 at 3 significant digits is 1230).
 */
export function roundSignificant(abs: number, sig: number): { text: string; decimals: number } {
  const digits = checkedSignificantDigits(sig);
  if (!Number.isFinite(abs) || abs === 0) {
    const decimals = Math.min(MAX_FORMAT_DECIMALS, digits - 1);
    return { text: (0).toFixed(decimals), decimals };
  }
  const order = Math.floor(Math.log10(abs));
  const rounded = significantAt(abs, digits, order);
  // 9.996 at three figures rounds up to 10.00, a figure too many: the carry moves the order up by one.
  return Number(rounded.text) >= 10 ** (order + 1) ? significantAt(abs, digits, order + 1) : rounded;
}

function significantAt(abs: number, digits: number, order: number): { text: string; decimals: number } {
  const decimals = digits - order - 1;
  if (decimals >= 0) {
    const fraction = Math.min(MAX_FORMAT_DECIMALS, decimals);
    return { text: roundHalfUp(abs, fraction), decimals: fraction };
  }
  const factor = 10 ** -decimals;
  const rounded = Math.round(abs / factor) * factor;
  return { text: String(rounded), decimals: 0 };
}

/**
 * True where `value` prints as zero at `decimals` places, rounded
 * the way the formatters round. A value that rounds to zero at the precision
 * it is shown at has no sign a reader can see, so it takes no judgment tone.
 * The test reads the number, not the printed string: a digit in a unit affix
 * ("0.0 CO2") does not hide the zero.
 */
export function roundsToZero(value: number, decimals: number): boolean {
  return Number(roundHalfUp(Math.abs(value), decimals)) === 0;
}
