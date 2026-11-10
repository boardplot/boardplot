import { boldMeasurer, hasBold, markBold, plainText } from './inlineBold';
import { formatScenarios } from './normalize/shared';
import { wrapFootnote } from './footer';
import { fitText } from './label/fitText';
import { footnoteMark } from './footnoteMark';
import { chartString, localeStrings } from './strings/frame';
import {
  allQuiet, defaultNoteLines, defaultNotePlacement, engineNoteMeta, isQuiet, keepNoteMeta, notesPointer, sourceLine,
  type ChartCredit, type ChartNote, type EngineNoteMeta, type NoteKind, type NoteList, type NotePlacement,
} from './notes';
import type { FontSpec, TextMeasurer } from './text';
import type { BaseOptions, Subtitle } from './types/options';
import type { LintWarning } from './types/scene';

/**
 * The frame's text decisions: which notes the footer prints, which go to the
 * notes list, the pointer, the source line and the credit. `solveFrame` draws
 * what this returns, and the React table reads it for its HTML footer. It
 * reads no global state: the surface policy and the notes' kinds come in.
 */

/** The note line the registered layout adds for labels the drawing hid. */
export const HIDDEN_LABEL_LEAD = 'Not labelled on the chart';

/** How the surface shows the frame: a pinned static image prints every enabled note; a live surface has the 'info' button. */
export interface FrameTextPolicy {
  /** A static export with a pinned canvas (`staticFrame.pinned`): every enabled note prints, no budget, no pointer. */
  pinned: boolean;
  /** A live React surface (`staticFrame.live`): under 'info' its button lists every note the frame does not print. */
  live: boolean;
}

/** One composed note and the kind its composer gave it; a note without `meta` is an author note or a method note. */
export interface FrameTextNote {
  text: string;
  meta?: EngineNoteMeta;
}

export interface FrameTextInput {
  target?: BaseOptions['target'];
  title?: string;
  /** The subtitle, or the unit line the layout composed in its place. */
  subtitle?: Subtitle;
  unit?: string;
  source?: string;
  credit?: ChartCredit;
  notes?: BaseOptions['notes'];
  /** The author wrote `notes.show` (not only `methodNote: true` or a `notes.placement`): its disclosures print outside the line budget. */
  notesShowAuthored?: boolean;
  strings?: BaseOptions['strings'];
  /** The composed notes in order, each with its kind. */
  footnotes: readonly FrameTextNote[];
  footnotesOff?: boolean;
  numberedFootnotes?: readonly string[];
  unreferencedNotes?: readonly number[];
  numberedDisclosures?: readonly number[];
  pointedNotes?: readonly string[];
  /** A fixed compact frame's source retry: 1 fits the source line on one line, 0 leaves it to the host. */
  compactSourceLines?: 0 | 1;
  /** The canvas width the target's default line budget reads. */
  width: number;
  /** The width the footer lines wrap at, and their font. */
  footWidth: number;
  footFont: FontSpec;
  /** The weight a `**bold**` run takes. */
  boldWeight: number;
  measure: TextMeasurer;
  policy: FrameTextPolicy;
}

/** A note as the frame sorts and prints it. */
export interface FrameTextEntry {
  kind: NoteKind;
  text: string;
  short?: string;
  /** The text the footer draws: the number mark, then the short form where the kind prints it. */
  drawn: string;
  ref?: number;
  ranks?: true;
}

export interface FrameText {
  title?: string;
  /** The subtitle with its unit clause. */
  subtitle?: SubtitleText;
  placement: NotePlacement;
  /** The measurer the footer lines wrap with: bold runs measure at the bold weight. */
  footMeasure: TextMeasurer;
  /** Every note, sorted by kind. */
  entries: FrameTextEntry[];
  /** The notes printed in the frame, in order, each with its wrapped lines. */
  printed: { entry: FrameTextEntry; lines: string[] }[];
  /** The source line without its pointer, as drawn ("Source: …"), or undefined. */
  sourceText?: string;
  /** A fixed compact frame left the source line to the host. */
  sourceOff: boolean;
  /** The source paragraph: the source line, then the pointer; or the pointer alone. */
  sourceBlock?: string;
  /** The pointer at the end of the source paragraph ("+2 notes"), or undefined. */
  pointer?: string;
  /** The source paragraph's lines (a compact one-line source fits with an ellipsis, `title` then holds its full text). */
  sourceLines: (text: string) => { lines: string[]; title?: string };
  /** The required credit prints in the frame. */
  creditInFrame: boolean;
  /** The pointer is on (no pinned frame, notes not off, `notes.pointer` not false). */
  pointerOn: boolean;
  /** The notes list: every note, then the source, then the credit, each with `inFrame`. */
  noteList: ChartNote[];
  /** The texts of the notes the frame does not print. */
  unprinted: string[];
  warnings: LintWarning[];
  /** A capped list note in a pinned frame: the static footer counts its names. */
  countable: boolean;
  /** List notes the frame fitted to two lines, with the kinds they now carry. */
  marked: { text: string; meta: EngineNoteMeta }[];
}

/**
 * Select the frame's notes and source. The footer prints the author's notes
 * within the target's line budget, then the source line, then a required map
 * credit; the rest goes to the notes list and the source line ends with
 * "+N notes".
 */
export function frameText(input: FrameTextInput): FrameText {
  const { footFont, measure, footWidth: footW, policy } = input;
  const footMeasure = (input.source && hasBold(input.source)) || input.footnotes.some((note) => hasBold(note.text))
    ? boldMeasurer(measure, input.boldWeight) : measure;
  const warnings: LintWarning[] = [];
  const marked: FrameText['marked'] = [];
  let countable = false;
  const fullStatic = policy.pinned;
  const placement = fullStatic ? 'frame' : input.notes?.placement ?? defaultNotePlacement(input.target);
  const budget = fullStatic ? Infinity : input.notes?.maxLines ?? defaultNoteLines(input.target, input.width);
  // Engine notes (method, disclosure) print only where the author asks for them (notes.show).
  const shown = new Set<string>(input.notes?.show ?? ['note']);
  const pointerOn = !fullStatic && !input.footnotesOff && input.notes?.pointer !== false;
  // The kinds the composers gave, by text; a list note the frame fits takes its fitted kind here.
  const metas = new Map<string, EngineNoteMeta | undefined>();
  for (const note of input.footnotes) metas.set(note.text, note.meta);
  const mark = (text: string, meta: EngineNoteMeta) => { metas.set(text, meta); marked.push({ text, meta }); return text; };
  // A note a mark points at keeps its number; a note about the exhibit
  // prints unnumbered. The numbered list is matched in order, so a
  // derived note that happens to repeat one of its strings does not steal its
  // number. A numbered note is the author's (or one a mark points at); every
  // other note is the engine's, a disclosure where its composer said so.
  const entries: FrameTextEntry[] = [];
  {
    const notes = input.footnotes.map((note) => note.text);
    const numbered = input.numberedFootnotes ?? notes;
    const unreferencedNotes = new Set(input.unreferencedNotes ?? []);
    let next = 0;
    let referenced = false;
    const unmarked: number[] = [];
    for (let f of notes) {
      // The note line of hidden labels names no mark, so it never
      // takes a number, even where a composing layout handed it on as authored.
      const numberedHere = next < numbered.length && numbered[next] === f && !f.startsWith(`${HIDDEN_LABEL_LEAD}:`);
      // Marked where the engine made it, never looked up by text: an authored note stays a note.
      const numberedDisclosure = numberedHere && (input.numberedDisclosures?.includes(next + 1) ?? false);
      const marker = numberedHere && !unreferencedNotes.has(next + 1) ? `${footnoteMark(next + 1)} ` : '';
      if (marker) referenced = true;
      if (numberedHere && marker === '') unmarked.push(next + 1);
      if (numberedHere) next += 1;
      const meta = numberedHere ? undefined : metas.get(f);
      if (fullStatic && meta?.list) countable = true;
      // a capped list note names what fits two footer lines at this width.
      if (meta?.list) {
        const fitted = fittedNote(meta.list, (text) => wrapFootnote(markBold(text), footFont, footW, footMeasure).length <= 2);
        f = meta.short
          ? mark(f, { kind: 'disclosure', short: fitted, values: meta.values, list: meta.list })
          : mark(fitted, { kind: 'disclosure', values: meta.values, list: meta.list });
      }
      const kind: NoteKind = numberedDisclosure ? 'disclosure' : numberedHere ? 'note' : meta?.kind ?? 'method';
      // A disclosure draws its short form only where it is narrower than the full note;
      // an author-set notes.maxListed keeps its form.
      const fittedShort = metas.get(f)?.short ?? meta?.short;
      const short = fittedShort && (kind !== 'disclosure' || input.notes?.maxListed !== undefined || footMeasure(markBold(fittedShort), footFont).width < footMeasure(markBold(f), footFont).width) ? fittedShort : undefined;
      const storedMeta = meta ? { ...meta, ...metas.get(f), ...(meta.ranks ? { ranks: true as const } : {}) } : undefined;
      entries.push(keepNoteMeta({ kind, text: f, ...(short ? { short } : {}), drawn: `${marker}${kind === 'disclosure' || (kind === 'method' && !fullStatic) ? short ?? f : f}`, ...(marker ? { ref: next } : {}), ...(meta?.ranks ? { ranks: true as const } : {}) }, storedMeta));
    }
    // A number with no mark pointing at it sends the reader looking
    // for one, so the note prints unnumbered and the author hears why.
    // Without any mark references, the authored notes describe the exhibit.
    if (!input.footnotesOff && unmarked.length > 0 && referenced) {
      warnings.push({
        code: 'footnote-unreferenced',
        severity: 'info',
        message: `${unmarked.length === 1 ? 'note' : 'notes'} ${unmarked.join(', ')} ${unmarked.length === 1 ? 'has' : 'have'} no category or cell pointing at ${unmarked.length === 1 ? 'it' : 'them'} (footnote: n), so ${unmarked.length === 1 ? 'it prints' : 'they print'} without a number`,
        suggest: "set footnote: n on the category or cell the note explains, or keep it as a note about the whole exhibit",
      });
    }
  }
  // Author notes first, then the disclosures and the engine's method notes
  // (a stable sort keeps each kind in composed order); source and credit last.
  const rank: Record<NoteKind, number> = { note: 0, disclosure: 1, method: 2, source: 3, credit: 4 };
  entries.sort((a, b) => rank[a.kind] - rank[b.kind]);
  const credit = input.credit;
  // A required credit stays on every target and under `footnotes: false`.
  const creditInFrame = credit !== undefined && (credit.required || fullStatic);
  const sourceText = input.source ? sourceLine(input.source, input.strings?.source ?? localeStrings().source) : undefined;
  const sourceOff = sourceText !== undefined && !fullStatic && input.compactSourceLines === 0;
  if (sourceOff) {
    warnings.push({ code: 'footnotes-off', severity: 'info', message: `compact frame has no room for the source line: ${sourceText}` });
  }
  // A disclosure whose kind the author lists in notes.show himself, and an
  // author note a drawn mark points at (pointedNotes), stay in the frame outside
  // the line budget, like a required credit. A disclosure asked for only by
  // methodNote or notes.placement counts against the live budget, after the
  // author notes; static output prints every note anyway, so its layout keeps
  // that disclosure too. `footnotes: false` hands every other note to the host;
  // a disclosure the author lists stays.
  const pointed = new Set(input.pointedNotes ?? []);
  const kept = entries.filter((entry) => entry.kind === 'disclosure'
    ? (input.notesShowAuthored === true || !policy.live) && (shown.has('disclosure') || (entry.ranks === true && shown.has('ranks')))
    : !input.footnotesOff && pointed.has(entry.text));
  const candidates = input.footnotesOff || placement === 'list' ? [] : entries.filter((entry) => !kept.includes(entry) && shown.has(entry.kind) && !isQuiet(entry));
  // The pointer counts the notes of the kinds the author prints; the engine's
  // hidden notes stay in the notes list without a pointer under the chart.
  // React's 'info' footer is the exception: its "Notes and sources (N)" button lists the engine's
  // hidden notes too (ChartFooter), so the pointer counts every note the frame does not draw and
  // the frame reserves the button's row. A 280 px card with one hidden value drew the button
  // below the card.
  const infoPanel = policy.live && placement === 'info';
  // Quiet method notes alone raise no pointer: the button for them is left off where its row would grow the footer.
  const infoCount = (hidden: readonly object[]) => allQuiet(hidden) && !(credit && !creditInFrame) ? 0 : hidden.length;
  const listed = (k: number) => infoPanel
    ? infoCount(entries.filter((entry) => !kept.includes(entry) && !candidates.slice(0, k).includes(entry))) + (credit && !creditInFrame ? 1 : 0)
    : entries.filter((entry) => shown.has(entry.kind) && !kept.includes(entry) && !isQuiet(entry)).length - k + (credit && !creditInFrame ? 1 : 0);
  const pointerAt = (k: number): string | undefined => {
    const hidden = listed(k);
    return pointerOn && hidden > 0 ? notesPointer(hidden, input.strings) : undefined;
  };
  const sourcePara = (k: number): string | undefined => {
    const pointer = pointerAt(k);
    const source = sourceOff ? undefined : sourceText;
    if (source === undefined) return pointer;
    return pointer === undefined ? source : `${source}${/[.!?]$/.test(source) ? '' : '.'} ${pointer}`;
  };
  const sourceLines = (text: string): { lines: string[]; title?: string } => {
    const fitted = !fullStatic && input.compactSourceLines === 1 ? fitText(markBold(text), footFont, footW, 1, footMeasure) : undefined;
    return fitted ? { lines: fitted.lines, ...(fitted.title ? { title: fitted.title } : {}) } : { lines: wrapFootnote(markBold(text), footFont, footW, footMeasure) };
  };
  const noteLines = candidates.map((entry) => wrapFootnote(markBold(entry.drawn), footFont, footW, footMeasure));
  // The most notes, in order, that fit the budget with the source line (and
  // its pointer); the source line itself is never cut.
  let k = candidates.length;
  for (; k > 0; k--) {
    const para = sourcePara(k);
    const used = noteLines.slice(0, k).reduce((sum, lines) => sum + lines.length, 0) + (para ? sourceLines(para).lines.length : 0);
    if (used <= budget) break;
  }
  const visible = new Set([...candidates.slice(0, k), ...kept]);
  const sourceBlock = sourcePara(k);
  if (input.footnotesOff) {
    // The host that switched the notes off carries them in its own frame, so
    // it is told which ones the chart would have printed. The source line
    // and a required credit stay (footer rule).
    const leftOff = entries.filter((entry) => !kept.includes(entry)).map((entry) => entry.text);
    if (leftOff.length) {
      warnings.push({ code: 'footnotes-off', severity: 'info', message: `footnotes: false left these notes off: ${leftOff.join(' | ')}` });
    }
  }
  const unprinted = entries.filter((entry) => !visible.has(entry)).map((entry) => entry.text);
  const noteList: ChartNote[] = [
    ...entries.map((entry) => keepNoteMeta({ kind: entry.kind, text: entry.text, ...(entry.short ? { short: entry.short } : {}), inFrame: visible.has(entry), ...(entry.ref ? { ref: entry.ref } : {}) }, engineNoteMeta(entry))),
    ...(input.source ? [{ kind: 'source' as const, text: input.source, inFrame: !sourceOff }] : []),
    ...(credit ? [{ kind: 'credit' as const, text: credit.text, short: credit.short, ...(credit.links.length ? { links: credit.links.map((link) => ({ ...link })) } : {}), inFrame: creditInFrame }] : []),
  ].map((entry, i) => keepNoteMeta({ n: i + 1, ...entry }, engineNoteMeta(entry)));
  const printed = entries.filter((entry) => visible.has(entry)).map((entry) => {
    const at = candidates.indexOf(entry);
    return { entry, lines: at >= 0 ? noteLines[at]! : wrapFootnote(markBold(entry.drawn), footFont, footW, footMeasure) };
  });
  return {
    ...(input.title ? { title: input.title } : {}),
    ...(input.subtitle ? { subtitle: subtitleText(input.subtitle, input.unit) } : {}),
    placement, footMeasure, entries, printed, sourceText, sourceOff, sourceBlock, pointer: pointerAt(k), sourceLines,
    creditInFrame, pointerOn, noteList, unprinted, warnings, countable, marked,
  };
}

// ---- capped list notes ----

export const listText = (lead: string, items: readonly string[]) => `${lead}: ${items.join(', ').replace(/\.$/, '')}.`;

/**
 * a capped list note names as many items as fit `fits` (two footer lines at
 * the drawn width), at most noteCap, in its order, then "and N more"; a lone last item only when
 * it fits. When not even one name fits, the note counts: "18 of 36 values", else "18 items".
 */
export function fittedNote(list: NoteList, fits: (text: string) => boolean): string {
  const at = (k: number) => listedNoteText(list, k);
  // The largest k that fits; a shorter list fits whenever a longer one does.
  let low = 0, high = Math.min(list.items.length, noteCap(list.options, list.items.length));
  if (fits(at(high))) return at(high);
  while (high - low > 1) { const mid = (low + high) >> 1; if (fits(at(mid))) low = mid; else high = mid; }
  return at(low);
}

/** The list note that names the first `k` items and counts the rest; with k = 0 it only counts. */
export function listedNoteText({ lead, items, total, options }: NoteList, k: number): string {
  const n = items.length;
  if (k === 0) return listText(lead, [total !== undefined && total >= n ? countedValuesText(n, total, options) : moreListedText(n, options, true)]);
  return listText(lead, k < n ? [...items.slice(0, k), moreListedText(n - k, options)] : items);
}

/** What a note line reads from the options: how many items it names, and the wording of its count. */
export interface NoteCapOptions {
  notes?: { maxListed?: number | 'all' };
  strings?: { moreListed?: string };
}

/**
 * Items a note line names by default: the first 8 in the note's order, then
 * "and N more"; the reading keeps the full list. An author-set `notes.maxListed` wins: 'all'
 * names every item, 0 names none and counts them ("18 of 36 values").
 */
export const DEFAULT_NOTE_LIMIT = 8;

/** The most items one note line names; `Infinity` under `notes.maxListed: 'all'`, 0 under `notes.maxListed: 0`. */
export function noteCap(options?: NoteCapOptions, count = 0): number {
  const max = options?.notes?.maxListed;
  const cap = max === 'all' ? Infinity : typeof max === 'number' && max >= 0 ? Math.floor(max) : DEFAULT_NOTE_LIMIT;
  // With `count` items: all when only one would be left, since "and 1 more" is no shorter than the item.
  return cap && count === cap + 1 ? count : cap;
}

/** The closing item of a capped list: the count of items left out, or of all items when the line names none. */
export function moreListedText(count: number, options?: NoteCapOptions, alone = false): string {
  return alone ? chartString(options as Parameters<typeof chartString>[0], 'countedItems', { count })
    : (options?.strings?.moreListed ?? 'and {count} more').replace('{count}', String(count));
}

/** The count form of a note under `notes.maxListed: 0`: "18 of 36 values". */
export function countedValuesText(count: number, total: number, options?: NoteCapOptions): string {
  return chartString(options as Parameters<typeof chartString>[0], 'countedValues', { count, total });
}

/**
 * The items a note line prints: the first `noteCap` items and the count of the rest ("and 3
 * more"). Under `notes.maxListed: 0` it only counts: "18 of 36 values" when the caller knows
 * the `total` of values, else "18 items".
 */
export function cappedItems(items: readonly string[], options?: NoteCapOptions, total?: number): string[] {
  const cap = noteCap(options, items.length);
  if (items.length <= cap) return [...items];
  if (cap === 0 && total !== undefined && total >= items.length) return [countedValuesText(items.length, total, options)];
  return [...items.slice(0, cap), moreListedText(items.length - cap, options, cap === 0)];
}

export function measureNamesUnit(unit: string, measure: string): boolean {
  measure = plainText(measure);
  const escaped = unit.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return escaped.length > 0 && new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu').test(measure);
}

export function subtitleUnitClause(unit: string, measure: string): string {
  const normalized = unit.trim().toLowerCase();
  if (normalized === 'x' || normalized === '×' || normalized === 'ratio') {
    if (/\bper\b/i.test(measure)) return '';
    return /\bratio\b/i.test(measure) ? ' (×)' : ' ratio (×)';
  }
  return measureNamesUnit(unit, measure) ? '' : ` in ${unit}`;
}

/**
 * Does the subtitle print the unit clause for this exact measure and unit?
 * Callers use the same predicate before moving a unit out of endpoint labels
 * or table headers. A subtitle can still render when this returns false.
 */
export function frameRendersUnit(
  input: { subtitle?: Subtitle; unit?: string },
): boolean {
  return Boolean(
    input.subtitle &&
      input.unit &&
      (measureNamesUnit(input.unit, input.subtitle.measure) || subtitleUnitClause(input.unit, input.subtitle.measure).length > 0),
  );
}

/**
 * Is the unit printed outside the labels: by the subtitle, or by the host
 * under `options.unitShown`? Endpoint labels, table heads and the legend
 * check read this, so no label repeats a unit the reader already sees.
 */
export function unitPrinted(
  input: { subtitle?: Subtitle; unit?: string } & { unitShown?: boolean },
): boolean {
  return Boolean(input.unitShown && input.unit) || frameRendersUnit(input);
}

/**
 * The subtitle as one plain line, in the order the frame prints it. A fixed slot that misses
 * moves it into the notes list. The unit stays on the canvas as the unit line.
 */
export function subtitleLine(sub: Subtitle): string {
  return [sub.company, sub.measure, sub.period, sub.scenarios?.length ? formatScenarios(sub.scenarios) : undefined]
    .filter(Boolean).join(' · ');
}

/**
 * The unit a measure names after its last comma, from the space after the
 * comma (" % of all orders", " EUR m", " in $m"), or ''. A tail that does
 * not read as a unit (", quarterly") stays part of the measure.
 */
export function measureUnitTail(measure: string, unit: string | undefined): string {
  const at = measure.lastIndexOf(', ');
  if (at <= 0) return '';
  const tail = measure.slice(at + 2);
  const reads = /^(%|in\s|per\s|[$€£¥]|(?:EUR|USD|CHF|GBP|JPY|US\$)(?![\p{L}])|index\b|score\b|share of\b|# )/iu.test(plainText(tail))
    || (unit !== undefined && unit.trim() !== '' && plainText(tail).trim().toLowerCase() === unit.trim().toLowerCase());
  // The comma stays with the bold part, so a wrapped line never starts with it.
  return reads ? measure.slice(at + 1) : '';
}

/** The subtitle as the frame prints it, with bold markers in place. */
export interface SubtitleText {
  /** The subtitle with its `**bold**` runs marked. */
  sub: Subtitle;
  /** The runs in order: the company, the measure (bold unless it stands alone), then one regular run with the unit clause, period and scenarios. */
  segments: { text: string; bold: boolean }[];
}

/**
 * Compose the subtitle line: "<company> · <measure> in <unit> · <period> · <scenarios>".
 * The unit clause follows `subtitleUnitClause`.
 */
export function subtitleText(authored: Subtitle, unit: string | undefined): SubtitleText {
  const sub = hasBold(authored.measure) || hasBold(authored.company ?? '') || hasBold(authored.period ?? '')
    ? { ...authored, measure: markBold(authored.measure),
      ...(authored.company ? { company: markBold(authored.company) } : {}),
      ...(authored.period ? { period: markBold(authored.period) } : {}) } : authored;
  // Three runs max: everything before the measure, the bold measure, and
  // one merged trailing segment — all inside a single text node.
  let trailing = '';
  if (frameRendersUnit({ subtitle: authored, unit })) trailing += subtitleUnitClause(unit!, sub.measure);
  if (sub.period) trailing += ` · ${sub.period}`;
  if (sub.scenarios && sub.scenarios.length > 0) trailing += ` · ${formatScenarios(sub.scenarios)}`;
  const segments: { text: string; bold: boolean }[] = [];
  if (sub.company) segments.push({ text: `${sub.company} · `, bold: false });
  // Only the measure is bold. A measure that names its own unit after a comma
  // ("Orders by delivery speed, % of all orders") keeps the unit regular, as
  // the frame's own " in <unit>" clause is.
  const unitTail = measureUnitTail(sub.measure, unit);
  // A subtitle that is the measure alone has no measure run to set apart: it
  // prints regular.
  const lone = !sub.company && !unitTail && !trailing;
  segments.push({ text: sub.measure.slice(0, sub.measure.length - unitTail.length), bold: !lone });
  if (unitTail || trailing) segments.push({ text: unitTail + trailing, bold: false });
  return { sub, segments };
}
