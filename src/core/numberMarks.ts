/**
 * One pair of number marks per chart, as in a spreadsheet: `options.locale.decimal`
 * and `options.locale.thousands` set the decimal and grouping mark of every
 * number the chart prints. Without them the language gives the default: German
 * (de, de-DE, de-AT) prints ',' and '.', Swiss and Liechtenstein German
 * (de-CH, de-LI) print '.' and the apostrophe, every other language '.' and ','.
 * `decimal: ','` alone groups with '.'. Numbers follow English rules, then take
 * the two marks. A format example gives only the shape (decimals,
 * grouping on or off, prefix, suffix, scale, sign); its own marks never win.
 *
 * The pair travels in the chart's language tag as a BCP 47 private-use
 * subtag ("de-x-marks-pc"), because every number formatter already receives
 * that tag. `withNumberMarks` writes it once, where a chart request enters
 * (resolveChartRequest, the registry layout); `numberFormat`
 * (numberFormatCache.ts) reads it where a number becomes text. The tag is
 * per options object, so two charts with different marks never meet.
 */

import type { LocaleSpec } from './types/options';

interface NumberMarks {
  decimal: '.' | ',';
  thousands: ',' | '.' | ' ' | "'";
}

const PRIVATE = '-x-marks-';
const CODE = { '.': 'p', ',': 'c', ' ': 's', "'": 'a' } as const;
const MARK: Record<string, NumberMarks['thousands']> = { p: '.', c: ',', s: ' ', a: "'" };

/** The marks the language prints without an authored mark. Only German differs from English. */
function languageMarks(tag: string | undefined): NumberMarks {
  const [language, ...rest] = splitNumberMarks(tag ?? 'en').language.toLowerCase().split(/[-_]/);
  if (language !== 'de') return { decimal: '.', thousands: ',' };
  const region = rest.slice(0, rest.includes('x') ? rest.indexOf('x') : rest.length);
  return region.some((part) => part === 'ch' || part === 'li') ? { decimal: '.', thousands: "'" } : { decimal: ',', thousands: '.' };
}

/** The chart's pair: the explicit marks, else the language's marks (German '.' and ',' swapped). An explicit key wins over the language. */
export function chartNumberMarks(locale: Pick<LocaleSpec, 'decimal' | 'thousands' | 'language'> | undefined): NumberMarks {
  const base = languageMarks(locale?.language);
  const requested = locale?.thousands === '’' ? "'" : locale?.thousands;
  const decimal = locale?.decimal ?? base.decimal;
  const fallback = decimal === base.decimal ? base.thousands : decimal === ',' ? '.' : ',';
  const thousands = requested !== undefined && requested !== decimal ? requested : fallback;
  return { decimal, thousands };
}

/** The language tag without a marks subtag, and the marks it carries. */
export function splitNumberMarks(tag: string): { language: string; marks?: NumberMarks } {
  // Only a tag this module wrote decodes: a caller's own private-use subtag ("en-x-marks-zz") stays a language tag.
  const match = /^(.+)-x-marks-([pc])([pcsa])$/.exec(tag);
  if (!match) return { language: tag };
  return { language: match[1]!, marks: { decimal: MARK[match[2]!] as NumberMarks['decimal'], thousands: MARK[match[3]!]! } };
}

/** The language a word comes from: the tag without its marks ("de-x-marks-pc" gives "de"). */
export function wordLanguage(tag: string | undefined): string | undefined {
  return tag === undefined ? undefined : splitNumberMarks(tag).language;
}

/** Options whose `locale.language` carries the chart's marks. Without a language the words stay English ('en'). */
export function withNumberMarks<O extends { locale?: LocaleSpec }>(options: O): O {
  const marks = chartNumberMarks(options.locale);
  const language = splitNumberMarks(options.locale?.language ?? 'en').language;
  const locale = { ...options.locale, language: `${language}${PRIVATE}${CODE[marks.decimal]}${CODE[marks.thousands]}` };
  AUTHORED.set(locale, AUTHORED.has(options.locale ?? {}) ? AUTHORED.get(options.locale!) : options.locale);
  return { ...options, locale };
}

const AUTHORED = new WeakMap<object, LocaleSpec | undefined>();

/** The locale as written before `withNumberMarks`, for a source that is handed back (an export's spec). */
export function authoredLocale(locale: LocaleSpec | undefined): LocaleSpec | undefined {
  return locale !== undefined && AUTHORED.has(locale) ? AUTHORED.get(locale) : locale;
}
