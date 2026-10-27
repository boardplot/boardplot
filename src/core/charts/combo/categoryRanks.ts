import { chartString } from '../../strings/combo';
/**
 * Rank numbers under the columns when the names fit at neither 0° nor 45°.
 * A row of "ACME_Paid-Soci…" repeated twenty-eight times names
 * nothing, and a bare "…" names less; ranks name each column in one glyph and
 * the mapping goes on the page as a footnote.
 *
 * This lives beside combo, the one caller that asks for ranks, and not inside
 * `planCategoryRow`. That module is shared with bar, column, waterfall,
 * mekko and the rest, and every React per-type entry carries it: putting the
 * rank text and the lint's mapping string there cost the waterfall bundle
 * 218 gzip bytes and broke its 60 kB budget.
 */

import { calendarLike, numberedSequence, type CategoryRowPlan } from '../../label/categoryRow';
import type { FontSpec, TextMeasurer } from '../../text';
import type { LintWarning } from '../../types/scene';
import { rankKeyNote } from '../../notes';

/**
 * Internal layout marker: the pass after the key went to the notes draws
 * ranks whatever its own row decides. A notes pass shrinks the plot, so its
 * row could decide otherwise, and the axis would print 1-6 under a key that
 * names one cut name, the wrong one.
 */
export const FORCE_CATEGORY_RANKS = Symbol('forceCategoryRanks');

/** True when the notes a pass printed are not the notes its own row needs. */
export function categoryNotesDiffer(a: readonly string[], b: readonly string[]): boolean {
  return a.length !== b.length || a.some((note, i) => note !== b[i]);
}

/** The mapping IS the label row: without it on the page the ranks name nothing. */
function rankMapping(labels: readonly string[]): string[] {
  return labels.map((label, i) => `${i + 1}. ${label}`);
}

/** Ranks per mapping footnote; the frame caps one footnote at four lines,
 *  and a mapping past that cap loses its last ranks — the ones a reader looks
 *  up. Several short notes survive where one long one is cut. */
const RANK_NOTE_CHUNK = 6;

/** The rank → name mapping as footnotes, split so the frame prints all of it. */
export function rankNotes(labels: readonly string[], options: Pick<import('../../types/options').BaseOptions, 'locale' | 'strings'> = {}): string[] {
  // Each entry stays on one line where it fits: "3." at a line's end and its name on the next read as two entries.
  const entries = rankMapping(labels).map((entry) => entry.replace(/ /g, '\u00a0'));
  const notes: string[] = [];
  for (let i = 0; i < entries.length; i += RANK_NOTE_CHUNK) {
    const chunk = entries.slice(i, i + RANK_NOTE_CHUNK);
    // The axis prints rank numbers; this key names them (a disclosure, also under notes.show 'ranks').
    // Only the first part says what the list is: the parts print one under the other, and each entry starts with its rank.
    notes.push(rankKeyNote(i === 0 ? chartString(options, 'columnsRankNote', { v1: entries.length === 1 ? '1' : `1-${entries.length}`, v2: chunk.join('; ') }) : `${chunk.join('; ')}.`));
  }
  return notes;
}

export function categoryRanksLint(labels: readonly string[], step: number): LintWarning {
  const mapping = rankMapping(labels);
  return {
    code: 'labels-as-ranks',
    severity: 'info',
    message:
      `category labels are drawn as ranks 1-${labels.length}: at ${Math.round(step)}px per category the names ` +
      `fit neither horizontally nor rotated. The mapping is ${mapping.join('; ')}.`,
    suggest: 'widen the canvas, shorten the names, or use a bar chart to keep the names upright',
    detail: { mapping },
  };
}

/**
 * True when the cascade gave up on the names. One long name among short ones
 * still rotates, cut, with a note mark that gives it back whole; ranks
 * take over once several names would lose their tail, or once the row fell
 * through to the ellipsis step.
 */
function namesAreLost(plan: CategoryRowPlan, labels: readonly string[]): boolean {
  if (plan.step === 'ellipsis') return true;
  // A prose row too narrow to rotate draws only the names that fit, so the
  // others name no column; ranks with their key name every one. An
  // ordered row (months, weeks, stages) thinned by a step reads on (an info
  // stride), so it keeps its names; so does a row of calendar periods or a
  // numbered sequence (D0 to D33).
  const byFit = plan.warnings.some((w) => w.code === 'category-stride' && w.severity === 'warn');
  if (plan.step === 'stride' && !plan.dateNumeric && byFit && !calendarLike(labels) && !numberedSequence(labels)) return labels.some((label, i) => !plan.keep[i] && label.trim() !== '');
  if (plan.step !== 'rotate') return false;
  return plan.infos.filter((info) => info.truncated).length >= 2;
}

/**
 * The plan the row is drawn from, with ranks swapped in when the names are
 * lost. The rank row is upright and one line, so the caller's rotation
 * overhang and band height follow from the returned plan as usual.
 */
export function withCategoryRanks(
  plan: CategoryRowPlan,
  measure: TextMeasurer,
  labels: readonly string[],
  /** A later layout pass keeps the ranks an earlier pass printed the key for. */
  force = false,
  /** The key prints (`notes.show` lists 'disclosure' or 'ranks'); without it ranks name nothing. */
  keyed = true,
): CategoryRowPlan {
  if (!keyed || (!force && !namesAreLost(plan, labels))) return plan;
  const font: FontSpec = plan.font;
  const lineHeight = font.size * (font.lineHeight ?? 1.2);
  const infos = plan.infos.map((_, i) => {
    const text = String(i + 1);
    return { lines: [text], w: Math.max(measure(text, font).width, 1), h: lineHeight, truncated: false };
  });
  // A row that drew some names by fit keeps them when the ranks would not fit either.
  if (!force && plan.step === 'stride' && infos.some((info, i) => i > 0 && plan.anchor(i - 1, infos[i - 1]!.w) + infos[i - 1]!.w + 4 > plan.anchor(i, info.w))) return plan;
  return {
    ...plan,
    infos,
    // Every column gets its rank, also where the names row drew only some.
    keep: plan.keep.map(() => true),
    rotation: 0,
    maxLines: 1,
    rowHeight: lineHeight,
    step: 'ranks',
    // The cascade's own lint and cut notes describe a row the ranks replace.
    warnings: [],
    cutNotes: [],
    x: (index: number) => plan.anchor(index, infos[index]!.w),
  };
}
