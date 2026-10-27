import { localeStrings, stringFields } from './strings';
import type { StringsSpec } from './types/options';
/**
 * The notes model of the footer rule. Every note the frame prints under a
 * chart has a kind, the kind decides where it goes, and the render target
 * decides how much of it
 * fits in the frame. The rest goes to the notes list that every render
 * returns, so a host can build an appendix or an "i" panel from it.
 *
 * - source: the author's `source`. Always visible, last.
 * - credit: a map pack's licence credit. In the frame when the licence
 *   requires it (BKG, US Census), else in the notes list.
 * - note: the author's `footnotes`, and an engine note a mark on the chart
 *   numbers (gantt's event key). Visible within the line budget.
 * - method: engine text on how a number is built. Notes list; the short form
 *   prints in the frame under `notes.show: ['note', 'method']`.
 * - disclosure: engine text the reader needs to read the chart right: it
 *   explains an encoding on the chart ("One cell = 5%", "W38 partial",
 *   "Columns by rank"), a change to the data ("1 value below zero shown as
 *   0."), or names the marks the drawing leaves unlabelled ("Not labelled on
 *   the chart: ..."). Always in the frame, outside the line budget, like a
 *   required credit. So is an author note a mark on the
 *   chart points at ("1)").
 */
import { typeWidthClass } from './theme';
import type { RenderTarget } from './types/options';
import { DEFAULT_TARGET } from './target';

export type NoteKind = 'source' | 'credit' | 'note' | 'method' | 'disclosure';
export type NotePlacement = 'frame' | 'info' | 'list';

export interface CreditLink {
  /** The words of `text` that carry the link. */
  text: string;
  href: string;
}

/** A map pack's licence credit (`GeoPackMeta.credit`). */
export interface ChartCredit {
  /** The full credit as the licence asks for it. */
  text: string;
  /** One short line, for a narrow host. */
  short: string;
  /** Words of `text` a web page links. */
  links: readonly Readonly<CreditLink>[];
  /** True: the licence asks for a visible credit; it stays in the frame on every target. */
  required: boolean;
}

/** One entry of the notes list, in list order (author notes first, source and credit last). */
export interface ChartNote {
  /** 1-based position in the list. */
  n: number;
  kind: NoteKind;
  text: string;
  /** The engine's short form for the drawing; text keeps the full note. */
  short?: string;
  /** Links inside `text` (a credit). */
  links?: CreditLink[];
  /** The number the note prints with, "1)", where the chart numbers it; absent for an unnumbered note. */
  ref?: number;
  /** True when the SVG frame prints this entry; false when it is only in the list. */
  inFrame: boolean;
}

/** Where the notes go when the author sets no `notes.placement`. */
export function defaultNotePlacement(target: RenderTarget | undefined): NotePlacement {
  return target === 'dashboard' ? 'info' : target === 'slide' ? 'list' : 'frame';
}

/**
 * The visible lines the frame gives notes and source, a required credit not
 * counted: report 3 at M and L, 2 at S (a dashboard's SVG or PNG export uses
 * the report rule, since a static image has no button), slide 2, print 3.
 */
export function defaultNoteLines(target: RenderTarget = DEFAULT_TARGET, width: number): number {
  if (target === 'slide') return 2;
  if (target === 'print') return 3;
  return typeWidthClass(width) === 'S' ? 2 : 3;
}

/**
 * The source credit as drawn: "Source: <source>", unless the author's text
 * already opens with that word ("Source:", "Sources:"), which printed
 * "Source: Source: …".
 */
export function sourceLine(source: string, word: string): string {
  const opensWithWord = source.slice(0, word.length).toLowerCase() === word.toLowerCase() &&
    /^\p{L}*\s*:/u.test(source.slice(word.length));
  return opensWithWord ? source : `${word}: ${source}`;
}

/**
 * Whether a note of this kind prints under the chart: the source and a credit
 * always, an author note by default, the engine's method and disclosure notes
 * only where the author lists their kind in `notes.show`. Every note stays in
 * the notes list either way.
 */
export function printsNoteKind(kind: NoteKind, show: readonly string[] = ['note']): boolean {
  return kind === 'source' || kind === 'credit' || show.includes(kind);
}

/** Whether this note prints under the chart: its kind, or the rank key under `notes.show` 'ranks'. */
export function printsNote(note: { kind: NoteKind; text: string }, show: readonly string[] = ['note']): boolean {
  return printsNoteKind(note.kind, show) || (note.kind === 'disclosure' && show.includes('ranks') && engineNoteMeta(note)?.ranks === true);
}

/**
 * What the React footer (ChartFooter) draws under a chart: the notes it prints,
 * the source, a required credit and the notes behind its button. A React layout
 * reserves these rows in the frame (frame.ts), so both read them here.
 * 'info': the source, the credit and the disclosures the reader needs on the
 * chart; every other note sits in the panel. 'frame' and 'list': the notes the
 * frame printed and the source line; the panel holds the hidden notes of the
 * kinds `notes.show` prints. The source line always shows, so the panel never
 * repeats it.
 */
export function footerParts(notes: readonly ChartNote[], placement: NotePlacement | undefined, show: readonly string[] | undefined, pointer: boolean) {
  const info = placement === 'info';
  const source = notes.find((note) => note.kind === 'source');
  const credit = notes.find((note) => note.kind === 'credit' && note.inFrame);
  const shown = notes.filter((note) => note.inFrame && note.kind !== 'source' && note.kind !== 'credit' && (!info || note.kind === 'disclosure'));
  const panel = !pointer ? [] : notes.filter((note) => note.kind !== 'source'
    && (info ? !(note === credit || shown.includes(note)) : !note.inFrame && printsNote(note, show)));
  return { info, source, credit, shown, panel };
}

/**
 * Under content fit with 'info', the notes behind React's "Notes and sources (N)" button: every
 * note the static footer does not print. A note it prints (a compact note can repeat one) stays out.
 */
export function unprintedNotes(notes: readonly ChartNote[]): ChartNote[] {
  return notes.filter((note) => !note.inFrame && note.kind !== 'source' && !notes.some((other) => other.inFrame && other.text === note.text));
}

type NoteAsk = { methodNote?: unknown; notes?: { show?: readonly string[]; placement?: unknown } } | undefined;

/**
 * The note kinds the chart prints: `notes.show`, else every engine note where
 * the author asked for notes another way (`methodNote: true`, an authored
 * `notes.placement`), else undefined (author notes only).
 */
export function shownNoteKinds(options: NoteAsk): readonly string[] | undefined {
  if (options?.notes?.show !== undefined) return options.notes.show;
  return options?.methodNote === true || options?.notes?.placement !== undefined ? ['note', 'method', 'disclosure'] : undefined;
}

/** The options a composing chart hands its host chart, with the note kinds its `methodNote` asked for. */
export function keepShownNotes<T extends object>(options: NoteAsk, passed: T): T {
  const show = shownNoteKinds(options);
  return show === undefined ? passed : { ...passed, notes: { ...(passed as { notes?: object }).notes, show } };
}

/**
 * True where the author prints the engine's disclosures (`notes.show` lists
 * 'disclosure'). Only then may a chart key its marks to a disclosure (rank
 * numbers, a note mark on a cut name); else it draws marks that read alone.
 */
export function disclosuresShown(options: { notes?: { show?: readonly string[] } } | undefined): boolean {
  return options?.notes?.show?.includes('disclosure') === true;
}

/** The lead of the note on stack totals that miss a part: it names the "(partial)" marker only where the marker prints. */
export function knownPartsLead(options: { notes?: { show?: readonly string[] }; strings?: StringsSpec }): string {
  const strings = options.strings ?? {};
  return disclosuresShown(options)
    ? stringFields(strings.partialTotals ?? localeStrings().partialTotals, { partial: strings.incomplete ?? localeStrings().incomplete })
    : strings.knownPartsTotals ?? localeStrings().knownPartsTotals;
}

/**
 * True where the rank key prints: `notes.show` lists 'disclosure', or 'ranks'
 * for the rank key alone. Only then may a column row draw rank numbers.
 */
export function rankKeyShown(options: { notes?: { show?: readonly string[] } } | undefined): boolean {
  const show = options?.notes?.show;
  return show?.includes('disclosure') === true || show?.includes('ranks') === true;
}

/** The pointer to the notes list. */
export function notesPointer(count: number, strings?: StringsSpec): string {
  return stringFields(count === 1 ? strings?.noteOne ?? localeStrings().noteOne : strings?.noteMany ?? localeStrings().noteMany, { count });
}

/** A capped list note: the frame names as many of its items as fit two footer lines. */
export interface NoteList { lead: string; items: readonly string[]; total?: number; options: object }
interface EngineNoteMeta { kind: 'note' | 'method' | 'disclosure'; short?: string; values?: readonly string[]; list?: NoteList; ranks?: true }

const NOTE_META = Symbol('noteMetadata');
type Noted = { [NOTE_META]?: EngineNoteMeta };
// Text lists exist only while a chart is laid out. Each finished note carries
// its own metadata, including consumers that run after the layout has ended.
let current: { notes: Map<string, EngineNoteMeta> } | undefined;

export function withEngineNotes<T>(run: () => T): T {
  if (current) return run();
  current = { notes: new Map() };
  try { return run(); } finally { current = undefined; }
}

/** Each note owns metadata outside its public, enumerable fields. */
export function keepNoteMeta<T extends object>(note: T, meta: EngineNoteMeta | undefined): T {
  return meta ? Object.defineProperty(note, NOTE_META, { value: { ...meta }, configurable: true }) : note;
}

export function copyNote<T extends object>(note: T, patch: Partial<T> = {}): T {
  return keepNoteMeta({ ...note, ...patch }, engineNoteMeta(note));
}

/**
 * Marks a note the engine composes with its kind (and a method note with its
 * one-line short form) and returns the text unchanged. A derived note without
 * a mark is a method note. Kind 'note' is a readout the author asked for by an
 * option (bartable `combinedShare`): it prints within the budget like a footnote.
 * A disclosure keeps the values it names (`valueNote`) when it is marked again.
 */
export function engineNote(text: string, kind: EngineNoteMeta['kind'], short?: string, values = engineNoteMeta(text)?.values, list: NoteList | null | undefined = engineNoteMeta(text)?.list): string {
  current?.notes.set(text, { kind, ...(short === undefined ? {} : { short }), ...(kind === 'disclosure' ? { values, list: list ?? undefined } : {}) });
  return text;
}

/** A note on how to read the chart; the frame prints it where `notes.show` lists 'disclosure'. */
export function disclosureNote(text: string): string {
  return engineNote(text, 'disclosure');
}

/** The rank key: a disclosure that also prints where `notes.show` lists 'ranks'. */
export function rankKeyNote(text: string): string {
  engineNote(text, 'disclosure');
  const meta = engineNoteMeta(text);
  if (meta) meta.ranks = true;
  return text;
}

/** A disclosure that names values the drawing does not print; the `values-in-note` warning lists them. */
export function valueNote(text: string, values: readonly string[]): string {
  return engineNote(text, 'disclosure', undefined, values);
}

/** A method note with its one-line form. */
export function methodNote(text: string, short: string): string {
  return engineNote(text, 'method', short);
}

export function engineNoteMeta(note: string | object): EngineNoteMeta | undefined {
  return typeof note === 'string' ? current?.notes.get(note) : (note as Noted)[NOTE_META];
}

/**
 * The notes list of one drawn chart: the frame's list, with the author notes
 * compact mode left off the canvas added after the frame's own author notes.
 */
export function chartNotes(geometry: { frame?: { noteList?: ChartNote[] }; a11y?: { compactNotes?: string[] } }): ChartNote[] {
  const list = geometry.frame?.noteList ?? [];
  const compact = (geometry.a11y?.compactNotes ?? []).map((text): ChartNote => ({ n: 0, kind: 'note', text, inFrame: false }));
  const at = list.findIndex((entry) => entry.kind !== 'note');
  const cut = at < 0 ? list.length : at;
  return [...list.slice(0, cut), ...compact, ...list.slice(cut)].map((entry, i) => copyNote(entry, { n: i + 1 }));
}
