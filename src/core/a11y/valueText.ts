import { chartString, localizedRecordReason } from '../strings/a11y-valueText';
import { changePercentText, currencyWholeNumbers, defaultNumberDecimals, wholeCurrencyValue, formatExactNumber, formatNumber, NOT_AVAILABLE, NOT_MEANINGFUL, isPercentagePointUnit } from '../format';
import { withUnit } from '../unitJoin';
import { differenceExample, exampleSpec, formatNonzeroWithSpec, formatWithSpec, parseFormatExample } from '../formatSpec';
import { datePatternFromExample, formatDate, parseISODate } from '../dateFormat';
import { MAX_FORMAT_DECIMALS, nonzeroDecimals } from '../formatPrecision';
import type { RenderTarget } from '../types/options';
import type { InteractionValue } from './types';

/**
 * Value wording shared by the accessible data table and the hover card. It
 * formats the record's own source value; nothing is rounded to a display
 * string first and a withheld value never prints its number.
 */

/** Decimal places the source number carries, including exponent notation. */
export function decimalPrecision(raw: number | string | null): number {
  if (typeof raw !== 'number') return 0;
  const [mantissa, exponent = '0'] = String(raw).split('e');
  return Math.max(0, (mantissa!.split('.')[1]?.length ?? 0) - Number(exponent));
}

/**
 * The format every derived percentage names (`derivedPercent` in
 * recordsShared.ts): two decimals and a percent sign, as the hover card
 * prints a share ("22.94%"). The printers below read a value the record
 * marks `derived: 'percent'` in the reader's locale, and a retention kept
 * as a fraction as its percentage. An authored format that happens to read
 * "12.34%" is the author's and keeps its own separators.
 */
export const DERIVED_PERCENT_FORMAT = '12.34%';

/** The most decimals a computed sum, level or effect prints: 7,433.77, never 7,433.76623376623. */
const DERIVED_NUMBER_DECIMALS = 2;

/**
 * Decimals a derived percentage prints at: its format's (the exhibit's
 * percent precision, see `withExhibitPercentFormat`), raised until a nonzero
 * value does not print as 0.
 */
function percentDecimals(value: InteractionValue, percent: number): number {
  return nonzeroDecimals(percent, value.format ? parseFormatExample(value.format).decimals : 2);
}

function derivedPercentText(value: InteractionValue, locale?: string): string | undefined {
  if (value.derived !== 'percent' || value.state !== 'value' || typeof value.raw !== 'number') return undefined;
  const percent = value.unit === 'fraction' ? value.raw * 100 : value.raw;
  return derivedValueText({ ...value, raw: percent, unit: '%' }, percentDecimals(value, percent), false, locale, true);
}

/** A percent example with `decimals` places: 0 → '12%', 1 → '12.3%'. */
export function percentExample(decimals: number): string {
  return decimals > 0 ? `12.${'3'.padEnd(decimals, '4')}%` : '12%';
}

/**
 * A unit without its magnitude: "$M" is "$", "EUR k" is "EUR", "M" is none. A physical unit keeps
 * its letters: "m²" and "kg/m2" have no magnitude; a lowercase "m" is one only beside a currency ("$m", "EUR m").
 */
export function unscaledUnit(unit: string): string | undefined {
  // A magnitude stands alone ("EUR k"), or sits on a currency sign or code ("$m", "EURk", "kEUR", "m€").
  const magnitude = /(?<![\p{L}\p{N}/])(?:k|K|M|mm|mn|B|bn|T|tn|Bn|Md|Mio\.?|Mrd\.?|Bio\.?|Tsd\.?)(?![\p{L}\p{N}/²³])|(?<=(?:\p{Sc}|\b[A-Z]{3})\s?)(?:k|K|M|m|mm|mn|B|bn|T|tn)(?![\p{L}\p{N}/²³])|(?<![\p{L}\p{N}/])(?:k|K|M|m|mm|mn|B|bn|T|tn)(?=\s?(?:\p{Sc}|[A-Z]{3}\b))/u;
  return unit.replace(magnitude, '').trim() || undefined;
}

/** The unit of the raw value: a hoisted scale unit names the printed figure, so the raw drops its magnitude ("80,000", not "80,000 M"). */
export function rawUnit(value: InteractionValue): string | undefined {
  return value.scaledUnit && value.unit !== undefined ? unscaledUnit(value.unit) : value.unit;
}

function valueUnit(value: InteractionValue): string {
  const spec = value.format ? parseFormatExample(value.format) : undefined;
  return (value.unit === undefined ? undefined : rawUnit(value) ?? '') ?? (spec ? `${spec.prefix.trim()}${spec.suffix.trim()}` : '');
}

/** A derived number (a delta, a share) at the precision its inputs carry, the unit placed as on the marks. */
export function derivedValueText(value: InteractionValue, decimals: number, signed: boolean, locale?: string, percent = false): string {
  if (value.state !== 'value' || typeof value.raw !== 'number') return interactionValueText(value, locale);
  const text = decimals > MAX_FORMAT_DECIMALS && !percent
    ? `${signed && value.raw > 0 ? '+' : ''}${formatExactNumber(value.raw, locale)}`
    : formatNumber(value.raw, { decimals: defaultNumberDecimals(value.raw, Math.min(MAX_FORMAT_DECIMALS, decimals), value.format ? undefined : value.unit, value.renderTarget), signed, magnitude: 'none', locale, automatic: value.format === undefined });
  if (percent) return `${text}${isPercentagePointUnit(value.unit) ? 'pp' : '%'}`;
  // The unit sits as the marks place it: "+€11m", not "+11 €m".
  return withUnit(text, valueUnit(value));
}

/**
 * A comparison's change, for the hover card: its shown text where the chart
 * draws the change (`shownValueText`), else through the format the value
 * prints with, signed, so "$1,235" sits beside "−$12" and not beside
 * "−12.3456901235 $". A change between two percent levels takes the
 * format's percentage-point face. Without a format, the precision `decimals`
 * its operands carry.
 */
export function deltaValueText(delta: InteractionValue, decimals: number, locale?: string): string {
  const shown = shownValueText(delta);
  if (shown !== undefined) return shown;
  if (delta.state !== 'value' || typeof delta.raw !== 'number' || !delta.format) return derivedValueText(delta, decimals, true, locale);
  // As the marks print it (exampleSpec): the authored word, the chart locale's separators, the unit's scale held.
  const spec = { ...exampleSpec(isPercentagePointUnit(delta.unit) ? differenceExample(delta.format) : delta.format, locale, delta.unit), signed: true,
    currencyWhole: currencyWholeNumbers(delta.unit, delta.renderTarget) };
  const text = formatNonzeroWithSpec(delta.raw, spec);
  return spec.prefix || spec.suffix || spec.magnitude !== 'none' ? text : withUnit(text, delta.unit);
}

/** A signed change in percent: its shown text where the chart draws it, else at its format's decimals (the exhibit's), else two. */
export function signedPercentText(percent: InteractionValue, locale?: string): string {
  const shown = shownValueText(percent);
  if (shown !== undefined) return shown;
  const decimals = typeof percent.raw === 'number' ? percentDecimals(percent, percent.raw) : 2;
  // The one change face: ">999%" from 1000 % up (changePercentText).
  if (percent.state === 'value' && typeof percent.raw === 'number' && !isPercentagePointUnit(percent.unit)) return changePercentText(percent.raw, Math.min(MAX_FORMAT_DECIMALS, decimals), locale);
  return derivedValueText(percent, decimals, true, locale, true);
}

/** Digits of any script, grouping and decimal marks, a sign or accounting parentheses, nothing else. */
const BARE_NUMBER = /^[\s\u00a0\u202f\u2009()+\-\u2212\p{Nd}.,'\u066b\u066c]+$/u;

/** One number with its affixes; the group is the number, in any script's digits and separators. */
const ONE_NUMBER_LABEL = /^[^\p{Nd}]*(\p{Nd}[\p{Nd}.,'\s\u00a0\u202f\u066b\u066c]*)[^\p{Nd}]*$/u;

/** A decimal digit's value in any script: Unicode lays out each script's digits as a run of ten from 0. */
function digitValue(digit: string): number {
  let code = digit.codePointAt(0)!;
  let value = 0;
  while (/\p{Nd}/u.test(String.fromCodePoint(--code))) value++;
  return value % 10;
}

/** A label that prints zero: one number whose every digit is 0, in any script ("0.00", "€0.0B", "٠٫٠٠", "−0%"). */
function printsZero(label: string): boolean {
  const number = ONE_NUMBER_LABEL.exec(label)?.[1];
  return number !== undefined && [...number].every((char) => !/\p{Nd}/u.test(char) || digitValue(char) === 0);
}

/** Significant digits of a number's shortest exact spelling: 7.3 has 2, 215.909090909091 has 15. */
function significantDigits(raw: number): number {
  return Math.abs(raw).toExponential().split('e')[0]!.replace('.', '').length;
}

/**
 * A short decimal without the residue of binary arithmetic: 7.3, not
 * 7.300000000000001. Fifteen significant digits are all a double holds
 * exactly. Where rounding there leaves at most twelve (a run of at least three
 * 0s or 9s before the last digits), those digits were the arithmetic's. A long
 * fraction (2375 / 11) keeps its source digits.
 */
function withoutFloatResidue(raw: number): number {
  if (Number.isInteger(raw) || !Number.isFinite(raw)) return raw;
  const clean = Number(raw.toPrecision(15));
  return significantDigits(clean) <= 12 ? clean : raw;
}

/** The source number at its own precision (a computed one at most two decimals), in the reader's locale, without a unit. */
function sourceNumberText(raw: number, locale?: string, derived = false, unit?: string, target?: RenderTarget): string {
  // A derived number drops the residue of binary arithmetic first: 6.9, not 6.90.
  // A source number drops it where it is a short decimal: 7.3, not 7.300000000000001.
  raw = derived && !Number.isInteger(raw) ? Number(raw.toPrecision(15)) : withoutFloatResidue(raw);
  // Its cap never prints a nonzero sum as 0: 0.004 reads "0.004", not "0.00".
  const decimals = derived ? nonzeroDecimals(raw, Math.min(decimalPrecision(raw), DERIVED_NUMBER_DECIMALS)) : decimalPrecision(raw);
  // Preserve the source number even below the shared formatter's decimal limit.
  // A source number prints exact; only a derived one is an automatic format.
  return decimals > MAX_FORMAT_DECIMALS ? formatExactNumber(raw, locale) : formatNumber(raw, { decimals: defaultNumberDecimals(raw, decimals, unit, target), magnitude: 'none', locale, automatic: derived });
}

/**
 * The unit join, the one rule for a shown text: a bare number takes the
 * value's unit as a mark joins it. Only digits (any script), separators and a
 * sign are bare. A text that already carries a sign, a currency, a magnitude
 * letter or a percent sign is complete ("4.8%" stays "4.8%", "$213k" stays).
 * A value kept as a fraction prints as its percentage, so its bare number
 * takes "%" ("100.0%", not "100.0 fraction"). The digits and the scale word
 * are the label's.
 */
function joinShownUnit(shown: string, value: InteractionValue): string {
  return BARE_NUMBER.test(shown) ? withUnit(shown, value.unit === 'fraction' ? '%' : value.unit) : shown;
}

/**
 * The card's zero rule: a shown text that prints zero for a value above or
 * below zero (a tail sharing the zero label; a whole-percent table column) is
 * the chart's reading at its precision. The card is where a nonzero value
 * reads as nonzero, so it prints the value at the decimals that keep it off
 * zero instead (`formattedValueText`).
 */
function zeroRuleApplies(value: InteractionValue, shown: string): boolean {
  return value.raw !== 0 && printsZero(shown);
}

/**
 * The shown text of a number value (`displayed`: the text its label draws, or
 * under an authored format the text its label would draw), with the unit
 * joined to a bare number. Undefined where the value has none, or where the
 * zero rule takes the source digits instead. The hover card and the reading
 * print a value's shown text through this one helper.
 */
export function shownValueText(value: InteractionValue): string | undefined {
  if (value.state !== 'value' || value.kind !== 'number' || typeof value.raw !== 'number') return undefined;
  const shown = value.displayed?.trim();
  if (!shown || zeroRuleApplies(value, shown)) return undefined;
  return joinShownUnit(shown, value);
}

/**
 * A value, a field, a share or a change as the hover card prints it: its
 * shown text (`shownValueText`). A value without a shown text prints as on a
 * chart without shown texts: through its format (`formattedValueText`). The
 * zero rule prints there too, at the decimals that keep the value off zero.
 * The record keeps the source number, so nothing but the wording changes.
 */
export function displayedValueText(value: InteractionValue, locale?: string): string {
  return shownValueText(value) ?? formattedValueText(value, locale);
}

/**
 * A number through its record's format example where the series or the chart
 * declares one (its rounding, prefix and suffix, the example's own
 * separators), else the source number at its own precision; the unit placed
 * as the marks place it. The card's zero rule prints this. A plain number
 * whose shown text printed zero prints its source digits.
 */
export function formattedValueText(value: InteractionValue, locale?: string): string {
  if (value.state !== 'value' || value.kind !== 'number' || typeof value.raw !== 'number') return interactionValueText(value, locale);
  const drawn = value.displayed?.trim();
  const derived = derivedPercentText(value, locale);
  if (derived !== undefined) return derived;
  if (value.format) {
    // As the marks print it (exampleSpec): the authored word, the chart locale's separators, the unit's scale held.
    const spec = { ...exampleSpec(value.format, locale, value.unit), currencyWhole: currencyWholeNumbers(value.unit, value.renderTarget) };
    const styled = spec.prefix || spec.suffix || spec.magnitude !== 'none';
    // A plain number the drawn label rounded to zero prints its source digits, as a value without a format does: 0.0000000012, not 0.000000001.
    if (styled || spec.currencyWhole || !drawn) {
      // The example's style at the decimals that keep a nonzero value off 0.
      const text = spec.currencyWhole ? formatWithSpec(value.raw, spec) : formatNonzeroWithSpec(value.raw, spec);
      return styled ? text : withUnit(text, rawUnit(value));
    }
  }
  return withUnit(sourceNumberText(value.raw, locale, value.derived === 'number', value.format ? undefined : value.unit, value.renderTarget), rawUnit(value));
}

/** One interaction value as text (a suppressed value stays withheld). */
export function interactionValueText(value: InteractionValue, locale?: string): string {
  if (value.state === 'suppressed') return chartString({ locale: { language: locale } }, 'valueWithheld');
  if (value.state === 'na') return (value.reason ? localizedRecordReason(value.reason, locale) : undefined) || NOT_AVAILABLE;
  if (value.state === 'nm') return (value.reason ? localizedRecordReason(value.reason, locale) : undefined) || NOT_MEANINGFUL;
  if (value.state !== 'value') return (value.reason ? localizedRecordReason(value.reason, locale) : undefined) || chartString({ locale: { language: locale } }, 'valueUnavailable', { v1: value.state });
  if (value.raw === null) return chartString({ locale: { language: locale } }, 'observationUnavailable');
  if (value.kind === 'date') {
    if (typeof value.raw !== 'string') return String(value.raw);
    const parsed = parseISODate(value.raw);
    if (!parsed) return value.raw;
    if (!value.format) return value.raw;
    return formatDate(parsed, datePatternFromExample(value.format, locale), locale);
  }
  if (typeof value.raw !== 'number') return String(value.raw);
  // A whole currency amount under a format prints as the chart prints it: its shown text, else through the format.
  if (value.format && wholeCurrencyValue(value.raw, value.unit, value.renderTarget)) return shownValueText(value) ?? formattedValueText(value, locale);
  const derived = derivedPercentText(value, locale);
  if (derived !== undefined) return derived;
  const text = sourceNumberText(value.raw, locale, value.derived === 'number', value.format ? undefined : value.unit, value.renderTarget);
  if (isPercentagePointUnit(value.unit)) return `${text}pp`;
  // The unit sits as the marks place it: "$2,470,000", not "2,470,000 $".
  return withUnit(text, valueUnit(value));
}
