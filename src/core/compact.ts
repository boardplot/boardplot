import { libraryPatch, resolveTheme } from './theme';
import { themeForDensity } from './themeDensity';
import type { BaseOptions } from './types/options';
import type { ThemeRef } from './types/theme';
import { authoredNotes, hiddenNoteLine, withAuthoredFootnotes } from './frame';
import { COMPACT_OMITTED_NOTES, staticFrame } from './footer';

/**
 * Compact spacing as a theme override, so the thirty layouts that already read
 * their margins and gaps from `spaceTokens` pick it up without each learning
 * about the mode. The ratio is the one `themeForDensity` uses everywhere else.
 */
function tightTheme(ref: ThemeRef | undefined, width?: number): ThemeRef {
  const dense = themeForDensity(resolveTheme(ref), 'compact', width);
  // resolveTheme(ref) above succeeded, so a named ref resolves again with the
  // same overrides (a registered, adopted or self-contained theme alike).
  const named = typeof ref === 'string' ? ref : ref?.preset;
  const preset = named ?? 'boardroom';
  const authored = typeof ref === 'object' && ref !== null ? ref.overrides ?? {} : {};
  return { preset, overrides: libraryPatch({ ...authored, space: dense.space }, authored) };
}

/**
 * The author's own notes. A chart that composed its notes before this call
 * (gantt adds 'Not labelled on the chart: ...') keeps the authored list in
 * `authoredFootnotes`; passing the composed list as authored prints the
 * composed line twice.
 */
function authoredList(options: Omit<BaseOptions, 'mode' | 'labels'>): BaseOptions['footnotes'] {
  return (options as { authoredFootnotes?: string[] }).authoredFootnotes ?? options.footnotes;
}

/** The subtitle a fixed slot moved into the notes list. Compact mode keeps it there. */
export const MOVED_SUBTITLE = Symbol('boardplot.movedSubtitle');

/** Required explanations and title-less notes stay visible in compact mode. */
export function omittedCompactNotes(type: string, options: Omit<BaseOptions, 'mode' | 'labels'>): string[] {
  const hasReplacementNote = 'methodNote' in options && options.methodNote === false;
  const preserveNotes = staticFrame.pinned || type === 'bullet' || hasReplacementNote || !options.title;
  // The moved subtitle and the note naming what the chart did not draw stay on the canvas.
  const moved = (options as { [MOVED_SUBTITLE]?: string })[MOVED_SUBTITLE];
  const hidden = hiddenNoteLine(options);
  return preserveNotes ? [] : authoredNotes(options).filter((note) => note !== moved && note !== hidden);
}

/**
 * Keep authored replacements for required explanations visible.
 *
 * `tight` is the band between a type's compact floor and its own minimum. A
 * chart drawn there gives up all but a few value labels and a fifth of its
 * spacing, because the alternative at that width is a refusal and an empty
 * box. Where the frame can grow, it keeps its series key and its whole title: the title wraps and the frame grows.
 */
export function compactOptions<O extends Omit<BaseOptions, 'mode' | 'labels'>>(
  type: string, options: O, floor?: { width: number; height: number }, width?: number,
): O {
  const omitted = omittedCompactNotes(type, options);
  // A note the compact frame leaves out is still a note the author wrote:
  // the count travels on, so a category referencing note 1 keeps its mark
  // and is not reported as pointing at a chart with no notes. The
  // title keeps the author's words: a '¹' after it pointed at no drawn note,
  // so the compact-notes-omitted lint names the notes instead.
  const base = omitted.length === 0
    ? { ...options, mode: 'compact' }
    : withAuthoredFootnotes({ ...options, mode: 'compact', [COMPACT_OMITTED_NOTES]: omitted.length }, authoredNotes(options).filter((note) => !omitted.includes(note)), authoredList(options));
  if (!floor) return base as O;
  // Attribution reaches the reader even in a narrow slot. The shared frame
  // wraps it; fixed frames try a shorter line before an explicit omission.
  return withAuthoredFootnotes({
    ...base,
    legend: options.legend,
    // The tight band keeps the author's density. Value labels fit one by
    // one against the marks, in priority order; a forced 'minimal' would drop
    // every segment value as a block although they fit. An authored
    // 'minimal' keeps its gate.
    theme: tightTheme(options.theme as ThemeRef | undefined, width),
    sizeFloor: floor,
    // Notes that stay on the canvas stay in the list: the registry puts the note that names a
    // hidden label there, and a cleared list left that label owed (the chart then refused for it).
  }, authoredNotes(options).filter((note) => !omitted.includes(note)), authoredList(options)) as O;
}
