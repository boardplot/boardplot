/**
 * Number formatting for executive charts: true minus sign, thin separators,
 * magnitude collapsing (1.2k / 3.4M / 5.6B), percent and percentage points.
 */

import { chartString } from './strings/format';
import { fractionFormat, numberFormat } from './numberFormatCache';
import { wordLanguage } from './numberMarks';
import type { BaseOptions, RenderTarget } from './types/options';
import {
  AUTO_MAX_DECIMALS,
  checkedDecimals,
  checkedSignificantDigits,
  belowPrecision,
  P_VALUE_DECIMALS,
  printsPValue,
  roundHalfUp,
  roundSignificant,
  roundsToZero,
  scientificText,
  shareDecimals,
  shareSetDecimals,
  typicalDecimals,
  underflowScientificText,
  valueSetDecimals,
  withoutLeadingZero,
} from './formatPrecision';

export interface NumberFormatOptions {
  decimals?: number;
  /** The caller computed the precision: at most AUTO_MAX_DECIMALS, and a nonzero value below the last digit prints as options.smallValues says ("<0.1" by default; 'compact' is the same). */
  automatic?: boolean | 'compact';
  /** Maximum significant digits after any magnitude scale. Overrides `decimals` when set. */
  significantDigits?: number;
  /** 'auto' collapses large magnitudes: 1200 -> 1.2k, 3.4e6 -> 3.4M. 'none' keeps full number. */
  magnitude?: 'none' | 'auto' | 'k' | 'm' | 'bn';
  /** Appended verbatim after the number (e.g. '%', 'pp', ' €'). */
  suffix?: string;
  /** Prepended verbatim (e.g. '$'). */
  prefix?: string;
  /** Show explicit '+' for positive values (variance charts). */
  signed?: boolean;
  /** BCP 47 tag mapped to decimal and grouping separators. Default en-US. */
  locale?: string;
}

/** Typographically correct minus (U+2212), what print and slide charts use. */
export const MINUS = '−';

/** Glued suffix for a difference of two percent levels, not a relative change. */
export const PERCENTAGE_POINTS = 'pp';

/**
 * State glyphs for values that exist but cannot be shown as a number. The
 * spelling is frozen by the table state-glyph policy (charts/table/resolve.ts):
 * 'n/a' = not applicable, 'n.m.' = not meaningful.
 */
export const NOT_AVAILABLE = 'n/a';
export const NOT_MEANINGFUL = 'n.m.';

/** The drawn not-applicable glyph: `strings.notApplicable` (German 'k. A.' from the locale table), else 'n/a'. */
export function notApplicableGlyph(strings?: { notApplicable?: string }): string {
  return strings?.notApplicable ?? NOT_AVAILABLE;
}

/**
 * The single spelling of a non-finite number, shared by BOTH formatting
 * engines. A formatter is the last boundary before a reader; letting a
 * non-finite through would produce two different lies at once — "∞%" from
 * formatNumber, "$Infinity" from formatWithSpec — and NaN would produce no text
 * at all, an invisible suppression.
 *
 * The mapping follows the frozen table policy for the divisions that create
 * these values: a non-zero numerator over a vanishing denominator overflows to
 * ±Infinity and is not meaningful; 0/0 is NaN and is not applicable.
 * Returns null when `value` is an ordinary finite number.
 */
export function nonFiniteGlyph(value: number): string | null {
  if (Number.isFinite(value)) return null;
  return Number.isNaN(value) ? NOT_AVAILABLE : NOT_MEANINGFUL;
}

const MAGNITUDES: Array<{ key: 'bn' | 'm' | 'k'; value: number }> = [
  { key: 'bn', value: 1e9 },
  { key: 'm', value: 1e6 },
  { key: 'k', value: 1e3 },
];

/**
 * How a magnitude is written after a figure, in every format output: `k`
 * lower case, `M`, `B` and `T` upper case ("$65k", "$1.1M", "$4.2B", "$2.5T"). One table
 * for both formatting engines, so one exhibit never mixes "65K" or "1.1m"
 * with its neighbours. The keys stay the option names 'k' | 'm' | 'bn'; 't'
 * (10¹²) comes only from a format example.
 */
export const MAGNITUDE_SUFFIX: Record<'none' | 'k' | 'm' | 'bn' | 't', string> = { none: '', k: 'k', m: 'M', bn: 'B', t: 'T' };

/**
 * The scale letter under a chart locale. A German reader takes "B" for
 * "Billion" (10¹²) and "T" for "Tausend", a French reader "B" for "billion"
 * (10¹²): those charts print the local short form (CLDR: " Mrd.", " Bio.";
 * " Md", " Bn"). k and M read alike everywhere.
 */
export function magnitudeSuffix(magnitude: keyof typeof MAGNITUDE_SUFFIX, locale: string | undefined): string {
  if (magnitude !== 'bn' && magnitude !== 't') return MAGNITUDE_SUFFIX[magnitude];
  const language = wordLanguage(locale)?.toLowerCase().split(/[-_]/)[0];
  if (language === 'de') return magnitude === 'bn' ? ' Mrd.' : ' Bio.';
  if (language === 'fr') return magnitude === 'bn' ? ' Md' : ' Bn';
  return MAGNITUDE_SUFFIX[magnitude];
}

const MAGNITUDE_NEXT: Record<'k' | 'm' | 'bn', 'm' | 'bn' | null> = {
  k: 'm',
  m: 'bn',
  bn: null,
};

export function isPercentagePointUnit(unit?: string): boolean {
  if (!unit) return false;
  const text = unit.trim().toLowerCase();
  return text === 'pp' || text === 'p.p.' || text === 'percentage points' || text === 'percentage point';
}

// Currency units repeat across cells. Cache missing signs too, and bound authored units.
const currencyCodes = new Set(Intl.supportedValuesOf('currency'));
const currencySigns = new Map<string, string | undefined>();

/**
 * The currency sign a text names, or undefined: an ISO code reads as its
 * English sign (USD as $, EUR as €, CAD as CA$), else the first sign. Capitals
 * before a $ name another dollar ('CA$'), but 'US$' is $; before another sign
 * they are a magnitude ('M€' is €, 'CN¥' is ¥).
 */
export function currencySign(text: string): string | undefined {
  if (currencySigns.has(text)) return currencySigns.get(text);
  const sign = uncachedCurrencySign(text);
  if (currencySigns.size >= 16) currencySigns.delete(currencySigns.keys().next().value!);
  currencySigns.set(text, sign);
  return sign;
}

function uncachedCurrencySign(text: string): string | undefined {
  const code = text.match(/(?<![A-Za-z])[A-Z]{3}(?![A-Za-z])/g)?.find((word) => currencyCodes.has(word));
  const named = code ? new Intl.NumberFormat('en', { style: 'currency', currency: code }).formatToParts(0).find((part) => part.type === 'currency')!.value : text;
  const [, letters = '', sign] = /(\p{Lu}*)(\p{Sc})/u.exec(named) ?? [];
  if (!sign) return code;
  // Keep a country qualifier (CA$, CN¥, HK$): JPY's ¥ is not CNY's CN¥. A
  // magnitude letter (M€, K$) is no qualifier, and US$ is $.
  const qualifier = /^(?:K|M|B|BN|MN|MM|T)$/.test(letters) ? '' : letters;
  return sign === '$' && qualifier === 'US' ? '$' : `${qualifier}${sign}`;
}

/** The default currency rule uses raw magnitude, before rounding. */
export function currencyWholeNumbers(unit?: string, target?: RenderTarget): boolean {
  return target !== undefined && currencySign(unit ?? '') !== undefined;
}

export function wholeCurrencyValue(value: number, unit?: string, target?: RenderTarget): boolean {
  return Math.abs(value) >= 1000 && currencyWholeNumbers(unit, target);
}

/** Keep the caller's existing precision except for large, unformatted currency. */
export function defaultNumberDecimals(value: number, decimals: number, unit?: string, target?: RenderTarget): number {
  return wholeCurrencyValue(value, unit, target) ? 0 : decimals;
}

// Creating an Intl formatter for every point dominates large scatter layouts.
// The shared cache is bounded, so changing host locales cannot grow it indefinitely.
function numberFormatter(locale: string, decimals: number | 'exact'): Pick<Intl.NumberFormat, 'format'> {
  return decimals === 'exact' ? numberFormat(locale, { maximumSignificantDigits: 21 }) : fractionFormat(locale, decimals);
}

export function formatNumber(value: number, opts: NumberFormatOptions = {}): string {
  const automatic = opts.automatic ?? (opts.decimals === undefined && opts.significantDigits === undefined && (opts.magnitude === undefined || opts.magnitude === 'none' || opts.magnitude === 'auto'));
  return formattedNumber(value, opts, automatic);
}

function formattedNumber(value: number, opts: NumberFormatOptions, automatic: boolean | 'compact'): string {
  if (value == null) return '';
  // Prefix/suffix are unit claims; a state glyph carries no unit, so it is
  // emitted bare ("n.m.", never "$n.m." or "n.m.%").
  const glyph = nonFiniteGlyph(value);
  if (glyph !== null) return glyph === NOT_AVAILABLE ? chartString({ locale: { language: opts.locale } }, 'notApplicable') : glyph;
  const { magnitude = 'none', suffix = '', prefix = '', signed = false, locale = 'en-US' } = opts;

  let v = value;
  let magSuffix: '' | 'k' | 'm' | 'bn' = '';
  if (magnitude === 'auto') {
    for (const m of MAGNITUDES) {
      if (Math.abs(v) >= m.value) {
        v = v / m.value;
        magSuffix = m.key;
        break;
      }
    }
  } else if (magnitude !== 'none') {
    const m = MAGNITUDES.find((m) => m.key === magnitude)!;
    v = v / m.value;
    magSuffix = m.key;
  }

  // Without a precision, an automatic value under 1 keeps its own two significant digits (typicalDecimals).
  let decimals = checkedDecimals(
    opts.decimals ?? (magSuffix && Math.abs(v) < 10 && !Number.isInteger(v) ? 1 : automatic && Math.abs(v) < 1 ? typicalDecimals([v]) : 0),
  );
  if (opts.significantDigits != null) checkedSignificantDigits(opts.significantDigits);
  // Only an automatic magnitude rolls to the next one; a fixed 'k' is what
  // the caller asked for and prints "5,000k", as formatWithSpec's locked scale does.
  while (magnitude === 'auto' && magSuffix && Number(Math.abs(v).toFixed(decimals)) >= 1000) {
    const next = MAGNITUDE_NEXT[magSuffix];
    if (!next) break;
    const divisor = MAGNITUDES.find((entry) => entry.key === next)!.value;
    v = value / divisor;
    magSuffix = next;
    if (Math.abs(v) < 10) decimals = Math.max(decimals, 1);
  }
  // Rounded once, on the decimal digits, before grouping: the same path
  // formatWithSpec takes, so one value never prints two ways.
  const abs = Math.abs(v);
  const significant = opts.significantDigits != null
    ? roundSignificant(abs, opts.significantDigits)
    : undefined;
  let roundedAbs = significant ? significant.text : roundHalfUp(abs, decimals);
  let usedDecimals = significant ? significant.decimals : decimals;
  let scientific: string | undefined;
  const pValue = automatic && printsPValue(v);
  if (pValue) roundedAbs = roundHalfUp(abs, usedDecimals = P_VALUE_DECIMALS);
  if (automatic && abs > 0) {
    if (usedDecimals > AUTO_MAX_DECIMALS) roundedAbs = roundHalfUp(abs, usedDecimals = AUTO_MAX_DECIMALS);
    const mode = Number(roundedAbs) === 0 ? pValue ? 'bound' : belowPrecision(usedDecimals) : undefined;
    if (mode === 'bound') {
      // Below the last shown digit: "<0.01" above zero, ">−0.01" below; a signed change keeps its sign, "<+0.01".
      const divisor = magSuffix ? MAGNITUDES.find((entry) => entry.key === magSuffix)!.value : 1;
      const bound = `${value > 0 ? '<' : '>'}${formattedNumber(Math.sign(value) * 10 ** -usedDecimals * divisor, { ...opts, decimals: usedDecimals, significantDigits: undefined }, false)}`;
      return pValue ? withoutLeadingZero(bound) : bound;
    }
    if (mode === 'scientific') scientific = scientificText(abs, (mantissa) => numberFormatter(locale, 1).format(mantissa));
  }
  const underflow = automatic && v === 0 && value !== 0
    ? underflowScientificText(value, MAGNITUDES.find(entry => entry.key === magSuffix)!.value) : undefined;
  const body = underflow ?? scientific ?? numberFormatter(locale, usedDecimals).format(Number(roundedAbs));
  const isZero = !underflow && !scientific && Number(roundedAbs) === 0;
  const sign = value < 0 && !isZero ? MINUS : signed && value > 0 && !isZero ? '+' : '';
  const text = `${sign}${prefix}${body}${magSuffix ? magnitudeSuffix(magSuffix, opts.locale) : ''}${suffix}`;
  return pValue ? withoutLeadingZero(text) : text;
}

/** Chart defaults use computed precision. Authored formats use formatNumber or formatWithSpec. */
export function formatAutomaticNumber(value: number, opts: NumberFormatOptions = {}): string {
  return formattedNumber(value, opts, opts.automatic ?? true);
}

/** Exact source digits outside the fixed-decimal formatter's limit. */
export function formatExactNumber(value: number, locale?: string): string {
  if (!Number.isFinite(value)) return formatNumber(value, { locale });
  // A chart's marked tag prints every source digit by English rules in its marks (numberMarks.ts).
  return locale ? numberFormatter(locale, 'exact').format(value).replace(/^-/, MINUS) : String(value);
}

export function formatPercent(value: number, decimals = 0, signed = false, locale?: string, automatic = false): string {
  return formatNumber(value, { decimals, suffix: '%', signed, locale, automatic });
}

export function formatAutomaticPercent(value: number, decimals = 0, signed = false, locale?: string): string {
  return formatPercent(value, decimals, signed, locale, true);
}

/**
 * The plain formatter for numbers that print side by side without an
 * authored example: one precision for the set (valueSetDecimals, so 6 prints
 * "6.0" beside "7.9"), lifted per value so no nonzero value prints as 0
 * (0.004 at one decimal prints "0.004").
 */
export function valueSetFormatter(values: Iterable<number>, locale?: string, signed = false, unit?: string, target?: RenderTarget): (value: number) => string {
  const decimals = valueSetDecimals(values);
  // A headline value that rounds to 0 at the set precision takes its own (typicalDecimals): "0.04 EUR" beside "28.0 EUR", not "<0.1 EUR".
  const own = (value: number) => value !== 0 && Number(roundHalfUp(Math.abs(value), decimals)) === 0 ? Math.max(decimals, typicalDecimals([value])) : decimals;
  return (value: number) => formatNumber(value, { locale, signed, decimals: defaultNumberDecimals(value, own(value), unit, target), automatic: true });
}

/**
 * The automatic number rule for one series' labels: one precision for the
 * series (valueSetDecimals), so 0.0341 prints "0.034" beside another
 * series' "0.5"; a nonzero value below the last digit prints its bound ("<0.01").
 */
export function seriesValueFormatter(values: Iterable<number | null | undefined>, locale?: string, unit?: string, target?: RenderTarget): (value: number, signed?: boolean) => string {
  const decimals = valueSetDecimals([...values].filter((value): value is number => typeof value === 'number' && Number.isFinite(value)));
  return (value, signed = false) => formatAutomaticNumber(value, { locale, signed, decimals: defaultNumberDecimals(value, decimals, unit, target) });
}

/**
 * A relative change in percent, signed: the one change face. A change that prints at 1000 % or more reads ">999%" (below −1000 %,
 * "<−999%"); "+181,874.2%" is a ratio no reader compares.
 */
export function changePercentText(percent: number, decimals: number, locale?: string): string {
  if (Number.isFinite(percent) && Number(roundHalfUp(Math.abs(percent), decimals)) >= 1000) return percent > 0 ? '>999%' : `<${MINUS}999%`;
  return formatPercent(percent, decimals, true, locale);
}

/** An authored percent value ({ pct } cell): whole points, one decimal below 1 %. */
export function formatAuthoredPercent(percent: number, locale?: string): string {
  return formatAutomaticPercent(percent, Math.abs(percent) < 1 && percent !== 0 ? 1 : 0, false, locale);
}

/** A computed share (part of a whole) in percent points, at the share precision. */
export function formatShare(percent: number, locale?: string): string {
  return shareText(percent, shareDecimals(percent), locale);
}

/**
 * A computed share at `decimals` (at most one): a nonzero share that prints
 * as zero there reads "<0.1%" (or "<1%" at whole percents), never "0%" and
 * never ten decimals. A share below 100 stays below 100.
 */
export function shareText(percent: number, decimals: number, locale?: string): string {
  const step = 10 ** -decimals;
  if (percent > 0 && roundsToZero(percent, decimals)) return `<${formatPercent(step, decimals, false, locale)}`;
  if (percent < 100 && percent > 0 && printedShare(percent, decimals) === 100) return `>${formatPercent(100 - step, decimals, false, locale)}`;
  return formatPercent(percent, decimals, false, locale);
}

/** The number a share prints as, for sums over printed shares: at `decimals`, or formatShare's own. */
export function printedShare(percent: number, decimals = shareDecimals(percent)): number {
  return Number(roundHalfUp(percent, decimals));
}

/**
 * The shares of one whole, or of one chart, at one precision: "8%" beside
 * "92%", with a decimal more only while a nonzero share would print as 0
 * (shareSetDecimals).
 */
export function shareSetFormatter(percents: Iterable<number>, locale?: string): { decimals: number; format: (percent: number) => string } {
  const decimals = shareSetDecimals(percents);
  return { decimals, format: (percent) => shareText(percent, decimals, locale) };
}

/** Arithmetic difference of two percent levels. Not a relative change. */
export function formatPercentagePoints(
  value: number,
  decimals = 0,
  signed = false,
  locale?: string,
): string {
  return formatNumber(value, { decimals, suffix: PERCENTAGE_POINTS, signed, locale });
}

/**
 * Compound annual growth rate between two values over n periods, in percent.
 * The one CAGR every path uses: the annotation, this public helper and the
 * receipt check (tests/helpers/recompute.ts). Null when undefined: no span, a
 * start at or below zero, or a negative end (no real rate carries a value
 * across zero). An end of zero lost everything: -100.
 *
 * A start at or below zero has no compound growth. A sign-flipped rate from
 * a loss would read as growth to a reader who does not know that convention,
 * so an author writes such a loss-reduction figure as a labelled annotation.
 */
export function cagr(first: number, last: number, periods: number): number | null {
  if (periods <= 0 || !(first > 0) || last < 0) return null;
  return (Math.pow(last / first, 1 / periods) - 1) * 100;
}

/**
 * An interval as a reader says it: "7 to under 8 days" for a
 * half-open interval, "12 to 13 days inclusive" for one closed at its upper
 * edge, such as a histogram's last bin. The texts come formatted, the unit
 * on the upper one; a range is never written with a hyphen or a dash.
 */
/** Joins two number texts as a range. An end with a sign gets a spaced en dash, so '−3.1 – −0.9' does not read as '−3.1––0.9'. */
export function numberRange(low: string, high: string): string {
  return /^[−+-]/.test(low) || /^[−+-]/.test(high) ? `${low} – ${high}` : `${low}–${high}`;
}

export function intervalText(low: string, high: string, closed = false, options?: Pick<BaseOptions, 'locale' | 'strings'>): string {
  return chartString(options, closed ? 'intervalClosed' : 'intervalOpen', { v1: low, v2: high });
}

/** Default precision for rates in percentage units. Authored formats override it. */
export function smallRateDecimals(percent: number): number {
  return percent !== 0 && Math.abs(percent) < 10 ? 1 : 0;
}
