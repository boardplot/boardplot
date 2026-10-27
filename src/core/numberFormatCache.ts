/**
 * One shared `Intl.NumberFormat` per (locale, options) pair.
 *
 * `Number.prototype.toLocaleString(locale, options)` builds a new
 * `Intl.NumberFormat` on every call. A sizing search runs about 100 layout
 * passes, so one chart at 320 px made thousands of formatters (about 30% of
 * render time). `formatter.format(n)` returns the same string as
 * `n.toLocaleString(locale, options)`, so the cache changes no output.
 *
 * The Map is bounded: a host that cycles through many locales clears it
 * instead of growing without limit.
 */
import { splitNumberMarks } from './numberMarks';

const MAX_FORMATTERS = 256;
// One bound for the texts of all formatters: past it every text map is cleared, so long-lived
// hosts keep at most this many texts however many formatters they use.
const MAX_TEXTS = 16_384;
let cachedTexts = 0;
const textMaps = new Set<Map<number, string>>();
const formatters = new Map<string, Pick<Intl.NumberFormat, 'format'>>();

/**
 * The cached formatter for `locale` and `options`. Options must hold plain values.
 * A locale with chart marks ("de-x-marks-cp", numberMarks.ts) prints the
 * number by English rules with the chart's decimal and grouping marks.
 */
export function numberFormat(locale: string, options: Intl.NumberFormatOptions): Pick<Intl.NumberFormat, 'format'> {
  const key = `${locale}\u0000${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    const { language, marks } = splitNumberMarks(locale);
    // A marked tag writes numbers by English rules; the language changes words only.
    const intl = new Intl.NumberFormat(marks ? 'en-US' : language, options);
    // A space groups with a no-break space, as formatWithSpec does.
    const group = marks?.thousands === ' ' ? '\u00a0' : marks?.thousands;
    // English marks need no swap: the English formatter already writes them.
    const base: Pick<Intl.NumberFormat, 'format'> = marks && (marks.decimal !== '.' || marks.thousands !== ',') ? { format: (value: number) => intl.formatToParts(value)
      .map((part) => part.type === 'group' ? group : part.type === 'decimal' ? marks.decimal : part.value).join('') } : intl;
    // A size search formats the same values once per probe. The text depends on the value alone,
    // so each formatter keeps its texts. A Map key folds -0 into 0, so -0 skips the memo.
    const texts = new Map<number, string>();
    formatter = { format: (value: number) => {
      if (typeof value !== 'number' || Object.is(value, -0)) return base.format(value);
      let text = texts.get(value);
      if (text === undefined) {
        text = base.format(value);
        if (cachedTexts >= MAX_TEXTS) {
          for (const map of textMaps) map.clear();
          textMaps.clear();
          cachedTexts = 0;
        }
        texts.set(value, text);
        textMaps.add(texts);
        cachedTexts++;
      }
      return text;
    } };
    if (formatters.size >= MAX_FORMATTERS) formatters.clear();
    formatters.set(key, formatter);
  }
  return formatter;
}

// The fixed-decimals formatters by locale, then by decimals and grouping: no options key to build per value.
const fractionFormatters = new Map<string, Map<number, Pick<Intl.NumberFormat, 'format'>>>();
let fractionCount = 0;

/**
 * `numberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })`, plus
 * `useGrouping` when `grouping` is given: the same formatter, found without a JSON key.
 * Omitted grouping and `true` stay apart: Intl's default is 'auto', not 'always'.
 */
export function fractionFormat(locale: string, decimals: number, grouping?: boolean): Pick<Intl.NumberFormat, 'format'> {
  const slot = decimals * 3 + (grouping === undefined ? 0 : grouping ? 1 : 2);
  let byLocale = fractionFormatters.get(locale);
  let formatter = byLocale?.get(slot);
  if (formatter === undefined) {
    formatter = numberFormat(locale, grouping === undefined
      ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
      : { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouping });
    if (fractionCount >= MAX_FORMATTERS) { fractionFormatters.clear(); fractionCount = 0; byLocale = undefined; }
    if (!byLocale) fractionFormatters.set(locale, byLocale = new Map());
    byLocale.set(slot, formatter);
    fractionCount++;
  }
  return formatter;
}
