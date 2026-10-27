import { localeStrings } from './strings';
/**
 * A running period keeps its geometry. Filled marks take a hatch and line
 * markers turn hollow. One key names the period; without that key a note
 * names it. The caller can replace the wording through options.strings.
 */

import type { LegendItemInput } from './frame';
import type { FontSpec, TextMeasurer } from './text';
import { secondaryFont } from './theme';
import type { Category } from './types/data';
import type { StringsSpec } from './types/options';
import type { Theme } from './types/theme';
import { disclosureNote, disclosuresShown } from './notes';

/**
 * The pattern a bar or segment paints. A scenario pattern (FC hatch, PL
 * outline) or an outlined plan category already carries its notation and
 * wins; a plain fill on a partial category takes the hatch.
 */
export function partialPattern(
  category: Pick<Category, 'partial'> | undefined,
  pattern: 'hatch45' | 'outline' | undefined,
  outlined = false,
): 'hatch45' | 'outline' | undefined {
  return pattern ?? (category?.partial === true && !outlined ? 'hatch45' : undefined);
}

/** Names running categories once when their hatch has no drawn key. */
export function partialFootnotes(
  categories: readonly Pick<Category, 'id' | 'label' | 'partial'>[],
  strings: StringsSpec | undefined,
  keyed = false,
): string[] {
  const labels = categories
    .filter((category) => category.partial === true)
    .map((category) => (category.label ?? category.id).replace(/\s*\n\s*/g, ' '));
  return labels.length === 0 || keyed ? [] : [disclosureNote(`${labels.join(', ')} ${strings?.toDate ?? localeStrings().toDate}`)];
}

/**
 * The words a running period's axis name ends with ("W38 to date") where no
 * drawn key names the period and the note naming it does not print.
 */
export function partialAxisWords(strings: StringsSpec | undefined, options: { notes?: { show?: readonly string[] } }, keyed = false): string | undefined {
  return keyed || disclosuresShown(options) ? undefined : strings?.toDate ?? localeStrings().toDate;
}

/** The English words for a running period ("to date", "MTD"), which a label may carry under any locale. */
const TO_DATE_EN = /\bto[\s-]date\b|\b[WMQY]TD\b/i;

/** Whether a running period's own words already say "to date" (any case, the locale's or the English words), so no mark repeats it. */
export function saysToDate(words: string, toDate: string): boolean {
  return words.toLowerCase().includes(toDate.toLowerCase()) || TO_DATE_EN.test(words);
}

/** The ids of the categories marked partial, for the annotation pass. */
export function partialIds(categories: readonly Pick<Category, 'id' | 'partial'>[]): Set<string> {
  return new Set(categories.filter((category) => category.partial === true).map((category) => category.id));
}

/**
 * The legend key for the partial hatch: neutral, like the scenario keys, since
 * the hatch sits on top of every series identity. It is hatched in the mark
 * ink: the swatch is small and its stripes are drawn 0.7 px wide, where the
 * neutral mark washes out to about 2:1 on a light page (notation #939393).
 * `painted` must come from the cells the layout emits, so a
 * partial category with nothing drawn adds no key.
 */
export function partialLegendKeys(painted: boolean, strings: StringsSpec | undefined, categories: readonly Pick<Category, 'id' | 'label' | 'partial'>[] = []): LegendItemInput[] {
  const labels = categories.filter(c => c.partial).map(c => (c.label ?? c.id).replace(/\s*\n\s*/g, ' '));
  const label = labels.length > 0 ? `${labels.join(', ')} ${strings?.toDate ?? localeStrings().toDate}` : strings?.partial ?? localeStrings().partial;
  return painted
    ? [{ id: '__partial', label, paint: { token: 'markInk' }, pattern: 'hatch45' }]
    : [];
}

/** Internal: a running value with the to-date words lost its seat, so the layout runs again with the hatch key. */
export const PARTIAL_KEY = Symbol('boardplot.partialKey');

/** Whether the layout runs with the hatch key because a to-date value lost its seat. */
export function partialKeyForced(options: object): boolean {
  return (options as { [PARTIAL_KEY]?: true })[PARTIAL_KEY] === true;
}

/** The to-date words under a running value: the secondary step at the label weight. */
export function toDateFont(theme: Theme): FontSpec {
  return { ...secondaryFont(theme), weight: theme.type.label.weight };
}

/**
 * Whether the to-date words fit the room over their mark. Before layout the
 * room is the widest step the categories can take (canvas width / count), so a
 * dense card keeps the hatch key at once. After layout it is `toDateRoom` of
 * the drawn mark: words wider than that run off their mark, so the layout
 * runs again with the hatch key.
 */
export function toDateFits(words: string, theme: Theme, measure: TextMeasurer, room: number): boolean {
  return measure(words, toDateFont(theme)).width + 4 <= room;
}

/**
 * The room the to-date words may take over a drawn mark: twice the mark, so
 * they overhang it by at most half a mark a side and never float over a thin
 * column (a small bandFraction). Words that reach a neighbour lose their seat
 * in the label solve, which brings the key back too.
 */
export function toDateRoom(mark: number): number {
  return 2 * mark;
}

/**
 * A running value's label with the to-date words under it ("316" over
 * "to date"): its lines, its box and the request fields that set the words
 * in the secondary step and the muted ink. The words are the period's only
 * cue (no hatch key), so the density gates pass them.
 */
export function toDateLabel(text: string, font: FontSpec, words: string, theme: Theme, measure: TextMeasurer) {
  const wordsFont = toDateFont(theme);
  const head = measure(text, font);
  const body = measure(words, wordsFont);
  return {
    lines: [text, words],
    size: { width: Math.max(head.width, body.width), height: head.height + body.height },
    request: { keepWhenDense: true as const, align: 'middle' as const, headLines: 1, headWeight: font.weight, bodyFont: wordsFont, bodyInk: { token: 'inkMuted' as const } },
  };
}
