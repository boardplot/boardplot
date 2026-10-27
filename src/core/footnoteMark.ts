/**
 * Footnote reference marks.
 *
 * Numbering every note the frame prints, engine-derived ones included, would
 * leave nothing on the canvas that carries a matching number. "1) W38
 * partial" would point at a category the reader has to find by reading the
 * note itself, and an authored `categories[].footnote: 1` would print as "2)"
 * because the derived note had taken 1. Two rules prevent both:
 *
 * - The engine's own notes print unnumbered. They describe the exhibit, not
 *   one category, and a number a reader cannot follow is furniture.
 * - An authored note keeps the number the author referenced, and the
 *   category that references it draws that number beside its label.
 *
 * The mark is the frame's own "1)", drawn in the label's type rather than
 * raised. A superscript would need either a baseline-shifted run, which the
 * scene has no vocabulary for (`SceneNode.runs` styles weight and nothing
 * else), or the superscript digits, and the shipped font metric tables carry
 * those only up to ³ — a mark that changed shape at footnote 4 reads worse
 * than one that never rises.
 */

import type { CalendarInfo } from './calendarLabels';
import type { Id } from './types/cell';
import type { LintWarning } from './types/scene';
import { saysToDate } from './partialPeriod';

/** The printed form of one footnote number, at the note and at the mark. */
export function footnoteMark(footnote: number): string {
  return `${footnote})`;
}

/**
 * What a chart knows about its own authored notes when it draws a mark:
 * how many there are, and where to report a reference that points past
 * them. A reference is a 1-BASED index into `options.footnotes`, so 0, a
 * negative and anything past the end name no note at all; drawing that
 * number puts a "2)" on a category under a frame that prints one note,
 * which is the defect the mark exists to remove.
 */
export interface FootnoteRefs {
  /**
   * Authored notes on this chart: `authoredFootnoteCount(options)`, never
   * `options.footnotes.length`. Compact mode leaves the notes off the
   * frame and empties that list, and a reference the author wrote is
   * still valid there, so the count travels beside the emptied list.
   */
  count: number;
  warnings: LintWarning[];
}

/** Whether a reference names a note, reporting it once when it does not. */
function referenceDrawn(footnote: number, owner: Id, refs: FootnoteRefs | undefined): boolean {
  if (refs === undefined) return true;
  if (Number.isInteger(footnote) && footnote >= 1 && footnote <= refs.count) return true;
  const already = refs.warnings.some((warning) => warning.code === 'footnote-reference-unknown' && warning.owner?.categoryId === owner);
  if (!already) {
    refs.warnings.push({
      code: 'footnote-reference-unknown',
      severity: 'warn',
      message: refs.count === 0
        ? `category '${owner}' references footnote ${footnote}, and this chart has no authored footnotes — no mark drawn`
        : `category '${owner}' references footnote ${footnote}, outside the ${refs.count} authored footnote${refs.count === 1 ? '' : 's'} — no mark drawn`,
      owner: { categoryId: owner },
      suggest: refs.count === 0
        ? 'add the note to options.footnotes, or drop the reference'
        : `use a number from 1 to ${refs.count}, the 1-based position of the note in options.footnotes`,
    });
  }
  return false;
}

interface LabelledCategory {
  id: Id;
  label?: string;
  date?: string;
  footnote?: number;
  calendar?: CalendarInfo;
  partial?: boolean;
}

/** Name referenced periods in line-family notes, even when their tick is thinned. */
export function withCategoryNoteNames<T extends { footnotes?: string[] | false; authoredFootnotes?: string[] }>(options: T, categories: readonly LabelledCategory[]): T {
  const authored = options.authoredFootnotes ?? options.footnotes;
  if (!authored || !categories.some(category => category.footnote !== undefined)) return options;
  const names = new Map<number, string[]>();
  for (const category of categories) {
    if (category.footnote === undefined) continue;
    const list = names.get(category.footnote) ?? [];
    list.push(category.label ?? category.id);
    names.set(category.footnote, list);
  }
  const named = authored.map((note, i) => names.has(i + 1) ? `${names.get(i + 1)!.join(', ')}: ${note}` : note);
  const replace = (note: string) => { const i = authored.indexOf(note); return i >= 0 ? named[i]! : note; };
  return { ...options, footnotes: options.footnotes === false ? false : options.footnotes?.map(replace), authoredFootnotes: named };
}

/**
 * A drawn label with the reference mark of the footnote it carries. A label
 * with no authored footnote is returned unchanged, so a chart that never
 * uses the field measures and fits exactly what it did before, and so is
 * one whose reference names no note.
 */
export function markedLabel(label: string, footnote: number | undefined, owner: Id = label, refs?: FootnoteRefs): string {
  return `${label}${footnoteSuffix(footnote, owner, refs)}`;
}

/**
 * The mark on its own, for a caller that fits the NAME first and appends
 * it after: a label cut to its band ends "Enterprise cloud infra… 1)", not
 * with the reference swallowed by the ellipsis.
 */
export function footnoteSuffix(footnote: number | undefined, owner: Id, refs?: FootnoteRefs): string {
  return footnote === undefined || !referenceDrawn(footnote, owner, refs) ? '' : ` ${footnoteMark(footnote)}`;
}

/**
 * A category row split in two: the names, and the marks to draw after
 * them. Every row that fits its names to a pitch takes this form, so a cut
 * name keeps its reference. `toDate` ("to date") goes on a line under the
 * name of a running period where nothing else on the chart names it
 * (`partialAxisWords`), so it takes no room from the other names.
 */
export function categoryLabelsAndMarks(
  categories: readonly LabelledCategory[],
  refs?: FootnoteRefs,
  toDate?: string,
): { labels: string[]; suffixes: string[]; dates: (string | undefined)[]; calendar?: (CalendarInfo | undefined)[]; under?: (string | undefined)[] } {
  const under = categories.map((category) => toDate !== undefined && category.partial === true && !saysToDate(category.label ?? category.id, toDate) ? toDate : undefined);
  return {
    labels: categories.map((category) => category.label ?? category.id),
    // The ISO date of each category, else its id: the row's tick rule reads the calendar from it.
    dates: categories.map((category) => category.date ?? String(category.id)),
    suffixes: categories.map((category) => footnoteSuffix(category.footnote, category.id, refs)),
    ...(under.some(Boolean) ? { under } : {}),
    ...(categories.some((category) => category.calendar) ? { calendar: categories.map((category) => category.calendar) } : {}),
  };
}
