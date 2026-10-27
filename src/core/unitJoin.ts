/** How a number and its unit join, for every text that prints both. */

import { MINUS, isPercentagePointUnit } from './format';

/**
 * A unit the marks print as a sign or a magnitude letter goes where a format
 * example would put it: the currency sign before the number, the magnitude
 * letter, the percent sign, the multiple or both after it, without a space
 * ("$213k", "12.3%", "€1.2m", "3.2x"). Any other unit follows the number
 * after a space ("2,100 leads", "74 index", "54 USD m"). A currency sign
 * before a word goes before the number and the word after it ("$17,843
 * million"). A leading sign stays in front of everything,
 * as `formatWithSpec` prints it.
 *
 * With `locale`, a currency sign goes where that locale writes it: after
 * the number and the unit word in de or fr ("17.843 Mio. €"). Without it,
 * the sign goes first.
 *
 * The hover card, the data table and the line labels join a unit here.
 * It is a module of its own because a bundler splits whole
 * modules: inside `a11y/valueText` it put the hover card's wording into
 * every line chart's initial load.
 */
const SYMBOL_UNIT = /^([$€£¥])?\s*(k|m|mm|mn|bn|%|x|×)?$/i;
const SIGN_WORD = /^([$€£¥])\s*(\p{L}.*)$/u;
const signAfter = new Map<string, boolean>();
/** Whether `locale` writes a currency sign after the number ("1,00 €"). */
function currencyAfter(locale: string): boolean {
  let after = signAfter.get(locale);
  if (after === undefined) {
    const parts = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).formatToParts(1);
    after = parts.findIndex((part) => part.type === 'currency') > parts.findIndex((part) => part.type === 'integer');
    if (signAfter.size >= 16) signAfter.delete(signAfter.keys().next().value!);
    signAfter.set(locale, after);
  }
  return after;
}
export function withUnit(text: string, unit: string | undefined, deduplicatePercent = false, locale?: string): string {
  const trimmed = unit?.trim() ?? '';
  if (!trimmed) return text;
  // Line labels keep a format's sign once.
  // The format's sign may sit before a literal suffix ("12% change").
  if (deduplicatePercent && trimmed === '%' && text.includes('%')) return text;
  // "% of units" after a value that prints its own sign: "9.6% of units".
  if (deduplicatePercent && trimmed.startsWith('%') && text.includes('%')) return `${text} ${trimmed.slice(1).trim()}`;
  if (isPercentagePointUnit(trimmed)) return `${text}pp`;
  const signWord = SYMBOL_UNIT.test(trimmed) ? null : SIGN_WORD.exec(trimmed);
  const match = signWord ? [trimmed, signWord[1], ''] : SYMBOL_UNIT.exec(trimmed);
  if (!match) return `${text} ${trimmed}`;
  const word = signWord ? ` ${signWord[2]}` : '';
  if (match[1] && locale && currencyAfter(locale)) return `${text}${match[2] ?? ''}${word}\u00a0${match[1]}`;
  const prefix = match[1] ?? ''; const suffix = `${match[2] ?? ''}${word}`;
  // An accounting example prints its negative in parentheses; the unit goes inside them.
  if (text.startsWith('(') && text.endsWith(')')) return `(${prefix}${text.slice(1, -1)}${suffix})`;
  // The sign stays in front of everything: the typographic minus, the ASCII
  // minus of the exponent fallback (`String(1e-25)`), or an authored plus.
  const sign = text.startsWith(MINUS) || text.startsWith('-') || text.startsWith('+') ? text[0]! : '';
  return `${sign}${prefix}${text.slice(sign.length)}${suffix}`;
}
