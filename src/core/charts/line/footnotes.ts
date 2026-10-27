import { stringFields } from '../../strings';
/**
 * The frame footnotes of a line exhibit: the ones the engine derives first,
 * then the author's own. Kept out of `layoutLine` so a new derived note is
 * one argument here.
 * The bump ranking note is a method note and needs `methodNote: true`;
 * a fan gap and a folded near-zero tail change what the reader sees and stay.
 */

import { authoredNotes, moreListedText, noteCap } from '../../frame';
import type { FontSpec, TextMeasurer } from '../../text';
import { partialFootnotes } from '../../partialPeriod';
import type { Category } from '../../types/data';
import { bumpMethodNote } from './bump';
import { fanGapNote, type FanResolved } from './fan';
import type { BumpDerived } from './layout';
import { nearZeroTailNote, type NearZeroTail } from './nearZero';
import type { LineOptions } from './types';
import { disclosureNote } from '../../notes';

export function lineFrameFootnotes(input: {
  fan: FanResolved | null;
  cats: Category[];
  /** Every running value prints the to-date words: no note names the period. */
  partialNamed?: boolean;
  bumpDerived: BumpDerived | undefined;
  nearZeroTail: NearZeroTail | undefined;
  options: LineOptions;
  footer: { width: number; font: FontSpec; measure: TextMeasurer };
  /** 100% categories withheld because their parts mix signs. */
  mixedSign?: readonly Category[];
  /** stacked-area categories with a missing part drawn as zero. */
  incompleteStack?: readonly Category[];
  rebaseSuppressed?: readonly { series: string; period: string; zero: boolean }[];
  knownParts?: readonly Category[];
  /** Ranked entities bump.focus leaves undrawn. */
  bumpOmitted?: readonly { id: string; label: string }[];
}): string[] {
  const { fan, cats, bumpDerived, nearZeroTail, options } = input;
  const mixed = input.mixedSign ?? [];
  const rebase = (input.rebaseSuppressed ?? []).map(s => stringFields(s.zero ? options.strings!.rebaseZero! : options.strings!.rebaseMissing!, { series: s.series, period: s.period }));
  return [
    ...partialFootnotes(cats, options.strings, input.partialNamed),
    ...missingStackNote(cats, input.incompleteStack ?? [], options, input.footer),
    ...missingStackNote(cats, input.knownParts ?? [], options, input.footer, options.strings!.knownPartsShares!),
    ...(options.mode === 'compact' && rebase.length ? [rebase.join(' ')] : rebase).map(disclosureNote),
    // The n.m. at the baseline says what; this line says why.
    ...(mixed.length > 0 ? [disclosureNote(stringFields(options.strings!.mixedShares!, { categories: mixed.map(c => c.label ?? c.id).join(', ') }))] : []),
    ...fanGapNote(fan, cats, options.strings),
    ...bumpOmittedNote(input.bumpOmitted ?? [], bumpDerived, cats, options),
    ...(options.methodNote === true ? bumpMethodNote(bumpDerived, options.format, options.strings) : []),
    ...nearZeroTailNote(nearZeroTail),
    ...authoredNotes(options),
  ];
}

/** Consecutive source nulls form ranges. Count omitted categories, not omitted ranges. */
function missingStackNote(cats: readonly Category[], incomplete: readonly Category[], options: LineOptions, footer: { width: number; font: FontSpec; measure: TextMeasurer }, template = options.strings!.missingStack!): string[] {
  if (!incomplete.length) return [];
  const missing = new Set(incomplete.map(c => c.id));
  const runs: { text: string; count: number }[] = [];
  for (let i = 0; i < cats.length; i++) {
    if (!missing.has(cats[i]!.id)) continue;
    const first = i;
    while (i + 1 < cats.length && missing.has(cats[i + 1]!.id)) i++;
    const name = (at: number) => cats[at]!.label ?? cats[at]!.id;
    runs.push({ text: first === i ? name(i) : `${name(first)}–${name(i)}`, count: i - first + 1 });
  }
  const { width, font, measure } = footer;
  let count = Math.min(runs.length, noteCap(options, runs.length));
  const sentence = () => {
    const shown = runs.slice(0, count);
    const left = incomplete.length - shown.reduce((sum, run) => sum + run.count, 0);
    const categories = [...shown.map(run => run.text), ...(left ? [moreListedText(left, options, shown.length === 0)] : [])].join(', ');
    return stringFields(template, { categories });
  };
  while (count > 1 && measure(sentence(), font).width > width) count--;
  return [disclosureNote(sentence())];
}


/**
 * The entities a focused bump ranks but does not draw, each
 * with its rank in the last period, so no entity leaves the exhibit unnamed.
 */
function bumpOmittedNote(omitted: readonly { id: string; label: string }[], bump: BumpDerived | undefined, cats: Category[], options: LineOptions): string[] {
  if (omitted.length === 0 || !bump) return [];
  const last = cats.length - 1;
  const period = cats[last]!.label ?? cats[last]!.id;
  const entries = omitted.map((s) => {
    const rank = bump.ranks[s.id]?.[last];
    return rank === null || rank === undefined ? `${s.label} (${options.strings!.noRank})` : `${s.label} ${rank}`;
  });
  return [disclosureNote(stringFields(options.strings!.rankOmitted!, { period, count: bump.participants[cats[last]!.id]!, entries: entries.join(', ') }))];
}
