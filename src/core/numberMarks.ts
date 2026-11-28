/**
 * A chart's locale sets the decimal, grouping and minus glyphs. The defaults
 * are '.', ',' and '−'. With `decimal: ','` alone, grouping uses '.'. The
 * language changes words. A format example sets the shape, including the
 * placement of the sign.
 *
 * The marks travel in the chart's language tag as a BCP 47 private-use
 * subtag ("de-x-marks-pc"), because every number formatter already receives
 * that tag. `withNumberMarks` writes it once, where a chart request enters
 * (resolveChartRequest, the registry layout); `numberFormat`
 * (numberFormatCache.ts) reads it where a number becomes text. The tag is
 * per options object, so two charts with different marks never meet.
 */

import { groupInteger } from './formatPrecision';
import type { LocaleSpec } from './types/options';

type SmallValues = 'bound' | 'zero' | 'scientific' | 'p-value';

interface NumberMarks {
  decimal: '.' | ',';
  thousands: ',' | '.' | ' ' | "'";
  minusGlyph?: LocaleSpec['minusGlyph'];
}

export const MINUS = '−';
const PRIVATE = '-x-marks-';
const CODE = { '.': 'p', ',': 'c', ' ': 's', "'": 'a' } as const;
const MARK: Record<string, NumberMarks['thousands']> = { p: '.', c: ',', s: ' ', a: "'" };
const MINUS_CODE = { [MINUS]: 'u', '-': 'h' } as const;
/** The `smallValues` mode rides in the same subtag: the default number rule reads it from the request, not from module state. */
const SMALL_CODE: Record<SmallValues, string> = { bound: 'b', zero: 'z', scientific: 'e', 'p-value': 'v' };
const SMALL: Record<string, SmallValues> = { b: 'bound', z: 'zero', e: 'scientific', v: 'p-value' };

/** The chart's separators and its optional minus override. */
export function chartNumberMarks(locale: Pick<LocaleSpec, 'decimal' | 'thousands' | 'minusGlyph'> | undefined): NumberMarks {
  // The typed apostrophe and the curly one are one mark, as are the space and the narrow no-break space.
  const requested = locale?.thousands === '’' ? "'" : locale?.thousands === '\u202f' ? ' ' : locale?.thousands;
  const decimal = locale?.decimal ?? '.';
  const thousands = requested !== undefined && requested !== decimal ? requested : decimal === ',' ? '.' : ',';
  return { decimal, thousands, minusGlyph: locale?.minusGlyph };
}

/** A marked chart uses English digits. A short decimal already rounded to its printed precision needs only its two separators. */
export function markedDecimal(text: string, decimals: number, grouped: boolean, locale: string): string | undefined {
  // Longer decimals can change when the Intl path converts the printed digits back to a Number.
  if (text.length > 15 || !/^-?\d+(?:\.\d+)?$/.test(text)) return undefined;
  const [integer, fraction = ''] = text.split('.');
  if (fraction.length !== decimals) return undefined;
  const { marks } = splitNumberMarks(locale);
  if (!marks) return undefined;
  const leading = grouped ? groupInteger(integer!, marks.thousands === ' ' ? '\u00a0' : marks.thousands) : integer!;
  return fraction ? leading + marks.decimal + fraction : leading;
}

/** The language tag without a marks subtag, and the marks it carries. */
export function splitNumberMarks(tag: string): { language: string; marks?: NumberMarks; small?: SmallValues } {
  // Only a tag this module wrote decodes: a caller's own private-use subtag ("en-x-marks-zz") stays a language tag.
  const match = /^(.+)-x-marks-([pc])([pcsa])([bzev])?([hu])?$/.exec(tag);
  if (!match) return { language: tag };
  const minusGlyph = match[5] === 'h' ? '-' : match[5] === 'u' ? MINUS : undefined;
  const marks: NumberMarks = { decimal: MARK[match[2]!] as NumberMarks['decimal'], thousands: MARK[match[3]!]!, minusGlyph };
  return { language: match[1]!, marks, ...(match[4] ? { small: SMALL[match[4]]! } : {}) };
}

/** The requested minus glyph or the format's default. */
export function numberMinus(locale: string | undefined, fallback: string = MINUS): string {
  return (locale === undefined ? undefined : splitNumberMarks(locale).marks?.minusGlyph) ?? fallback;
}

/** The language a word comes from: the tag without its marks ("de-x-marks-pc" gives "de"). */
export function wordLanguage(tag: string | undefined): string | undefined {
  return tag === undefined ? undefined : splitNumberMarks(tag).language;
}

/** Options whose `locale.language` carries the chart's marks. Without a language the words stay English ('en'). */
export function withNumberMarks<O extends { locale?: LocaleSpec; smallValues?: SmallValues }>(options: O): O {
  const marks = chartNumberMarks(options.locale);
  const split = splitNumberMarks(options.locale?.language ?? 'en');
  const small = options.smallValues ?? split.small;
  const minus = marks.minusGlyph === undefined ? '' : MINUS_CODE[marks.minusGlyph];
  const locale = { ...options.locale, language: `${split.language}${PRIVATE}${CODE[marks.decimal]}${CODE[marks.thousands]}${small ? SMALL_CODE[small] : ''}${minus}` };
  AUTHORED.set(locale, AUTHORED.has(options.locale ?? {}) ? AUTHORED.get(options.locale!) : options.locale);
  return { ...options, locale };
}

const AUTHORED = new WeakMap<object, LocaleSpec | undefined>();

/** The locale as written before `withNumberMarks`, for a source that is handed back (an export's spec). */
export function authoredLocale(locale: LocaleSpec | undefined): LocaleSpec | undefined {
  return locale !== undefined && AUTHORED.has(locale) ? AUTHORED.get(locale) : locale;
}
