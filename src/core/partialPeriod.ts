import { localeStrings } from './strings';
/**
 * A partial period keeps its geometry. Filled marks take a hatch and line
 * markers turn hollow. Running periods also get wording through options.strings.
 */

import type { LegendItemInput } from './frame';
import type { FontSpec, TextMeasurer } from './text';
import { secondaryFont } from './theme';
import type { Category } from './types/data';
import type { StringsSpec } from './types/options';
import type { Theme } from './types/theme';
import { disclosureNote, disclosuresShown } from './notes';
import { calendarPoint } from './calendarLabels';

/** The partial categories with no later complete category, in calendar or authored order. */
export function runningPeriodIds(categories: readonly Pick<Category, 'id' | 'date' | 'partial'>[]): Set<string> {
  const running = partialIds(categories);
  if (running.size === 0 || running.size === categories.length) return running;
  const dates = categories.map(c => calendarPoint(c.date ?? c.id)?.date.getTime());
  const dated = dates.every(date => date !== undefined);
  const orderAt = (i: number) => dated ? dates[i]! : i;
  let lastComplete = -Infinity;
  categories.forEach((c, i) => {
    if (c.partial !== true) lastComplete = Math.max(lastComplete, orderAt(i));
  });
  categories.forEach((c, i) => {
    if (orderAt(i) < lastComplete) running.delete(c.id);
  });
  return running;
}

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
  categories: readonly Pick<Category, 'id' | 'label'>[],
  strings: StringsSpec | undefined,
  running: ReadonlySet<string>,
  keyed = false,
): string[] {
  if (keyed || running.size === 0 || strings?.toDate === '') return [];
  const names = partialNames(categories, strings, running);
  return names == null ? [] : [disclosureNote(names)];
}

/**
 * The running categories in authored order, with the to-date words once per run:
 * "W38, W39 to date". A label that already says them ("1 Nov to date") gets no second copy.
 * Undefined leaves the generic hatch key available. Null suppresses a named key whose text is empty.
 */
function partialNames(categories: readonly Pick<Category, 'id' | 'label'>[], strings: StringsSpec | undefined, running: ReadonlySet<string>): string | null | undefined {
  const toDate = strings?.toDate ?? localeStrings().toDate;
  const labels = categories.filter((c) => running.has(c.id)).map((c) => (c.label ?? c.id).replace(/\s*\n\s*/g, ' '));
  if (labels.length === 0) return undefined;
  if (toDate === '') return labels.map(label => label.trim()).filter(Boolean).join(', ') || null;
  // Authored order: each run of plain names ends with the words once, a name that says them stays as it is.
  const parts: string[] = [];
  let run: string[] = [];
  const close = () => { if (run.length > 0) parts.push(`${run.join(', ')} ${toDate}`.trim()); run = []; };
  for (const label of labels) {
    if (saysToDate(label, toDate)) { close(); parts.push(label); } else run.push(label);
  }
  close();
  return parts.join(', ');
}

/**
 * The words a running period's axis name ends with ("W38 to date") where no
 * drawn key names the period and the note naming it does not print.
 */
export function partialAxisWords(strings: StringsSpec | undefined, options: { notes?: { show?: readonly string[] } }, keyed = false): string | undefined {
  return keyed || disclosuresShown(options) || strings?.toDate === '' ? undefined : strings?.toDate ?? localeStrings().toDate;
}

/** The English words for a running period ("to date", "MTD"), which a label may carry under any locale. */
const TO_DATE_EN = /\bto[\s-]date\b|\b[WMQY]TD\b/i;

/** Whether a running period's own words already say "to date" (any case, the locale's or the English words), so no mark repeats it. */
export function saysToDate(words: string, toDate: string): boolean {
  return (toDate !== '' && words.toLowerCase().includes(toDate.toLowerCase())) || TO_DATE_EN.test(words);
}

/** The ids of the categories marked partial, for the annotation pass. */
export function partialIds(categories: readonly Pick<Category, 'id' | 'partial'>[]): Set<string> {
  return new Set(categories.filter((category) => category.partial === true).map((category) => category.id));
}

export const RUNNING_PERIOD_LEGEND_ID = '__partial';

export function hasEarlierPartialHatch(hatched: readonly Pick<Category, 'id'>[], running: ReadonlySet<string>): boolean {
  return hatched.some(c => !running.has(c.id));
}

/**
 * The legend key for the partial hatch: neutral, like the scenario keys, since
 * the hatch sits on top of every series identity. It is hatched in the mark
 * ink: the swatch is small and its stripes are drawn 0.7 px wide, where the
 * neutral mark washes out to about 2:1 on a light page (notation #939393).
 * `hatched` comes from the emitted cells. A key for earlier hatches leaves
 * the running periods to their values, axis names or note.
 */
export function partialLegendKeys(
  hatched: readonly Pick<Category, 'id'>[], strings: StringsSpec | undefined, running: ReadonlySet<string>,
  namedOnValues: boolean, categories: readonly Pick<Category, 'id' | 'label'>[] = [],
): LegendItemInput[] {
  if (hatched.length === 0) return [];
  const earlier = hasEarlierPartialHatch(hatched, running);
  if (namedOnValues && !earlier) return [];
  const names = earlier ? undefined : partialNames(categories, strings, running);
  const label = names === undefined ? strings?.partial ?? localeStrings().partial : names;
  return label !== null
    ? [{ id: earlier ? '__earlierPartial' : RUNNING_PERIOD_LEGEND_ID, label, paint: { token: 'markInk' }, pattern: 'hatch45' }]
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
  if (words === '') return undefined;
  const wordsFont = toDateFont(theme);
  const head = measure(text, font);
  const body = measure(words, wordsFont);
  return {
    lines: [text, words],
    size: { width: Math.max(head.width, body.width), height: head.height + body.height },
    request: { keepWhenDense: true as const, align: 'middle' as const, headLines: 1, headWeight: font.weight, bodyFont: wordsFont, bodyInk: { token: 'inkMuted' as const } },
  };
}
