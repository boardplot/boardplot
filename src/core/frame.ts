import { chartString } from './strings/frame';
/**
 * Frame solver (pipeline stage 2): measures title, subtitle,
 * source, footnotes, and legend FIRST, claims their space in the
 * OccupiedIndex, and returns the shrunken plot rect. The legend is a layout
 * participant before the plot area is sized — never an overlay.
 *
 * Subtitle follows the notation rule: "Company · Measure in unit · Period, AC FC" with
 * the measure in bold (one text node whose styled runs flow natively).
 */

import { currencySign } from './format';
import { furnitureBudget } from './aspect';
import { COLLECT_IDENTITIES, identityCollector, type IdentityCollectionOptions, identityAppearance, identityCollisionWarnings, type SeriesIdentity as LegendItemInput } from './seriesIdentity';
import { dedupeLegendKeys } from './label/legendFidelity';
import type { Margin, Rect, Size } from './geometry';
import { resolveTargetTheme, panelTypeClass, smallestTitleSize, spaceTokens, emphasisWeight, secondaryType, strokeToken, WIDE_CANVAS_MIN_WIDTH } from './theme';
import { formatScenarios, resolveSubtitle } from './normalize/shared';
import type { TextMeasurer } from './text';
import { DEFAULT_TARGET, resolveTargetSize, scaleTextAtFloor, targetFloorsPx, targetTypeSizesPx } from './target';
import { textScaleOf, textSizeOf } from './typeFloors';
import { fitText } from './label/fitText';
import { containsText, cutLabels } from './label/omissions';
import { isNumberAlone } from './textRole';
import { PRIORITY } from './label/solver';
import { footnoteMark } from './footnoteMark';
import { localeStrings } from './strings/frame';
import { withLocaleStrings } from './strings';
import { chartNotes, copyNote, defaultNoteLines, defaultNotePlacement, engineNote, engineNoteMeta, footerParts, keepNoteMeta, notesPointer, shownNoteKinds, sourceLine, valueNote, type ChartCredit, type ChartNote, type NoteKind, type NoteList } from './notes';
import { harveyWedgePath } from './svgPath';
import { parseFormatExample, unitOfSpec } from './formatSpec';
import { hasAuthoredTypeSize, type FontSpec } from './text';
import type { Id } from './types/cell';
import { defaultAnnotationId, type AnnotationKind } from './types/annotations';
import { loadedDeferred } from './deferred';
import type { BaseOptions, LegendOptions, Subtitle } from './types/options';
import type {
  FrameGeometry,
  Geometry,
  LayoutResult,
  LegendGeometry,
  LintWarning,
  Paint,
  PlacedLabel,
  SceneNode,
} from './types/scene';
import type { Theme, ThemeRef } from './types/theme';
import { VALUE_SELECTION } from './types/sizing';
import { createOccupiedIndex, type OccupiedIndex } from './label/occupied';
import { COMPACT_OMITTED_NOTES, LIVE_NOTE_SHOW, footerPlans, footerType, liveFooterExtra, recordFreedChrome, staticFrame, wrapFootnote } from './footer';
import { chartString as wordingString } from './strings';
import { TEXT_ASCENT } from './svg/renderSvg';
import { maxOf, pushAll } from './arrays';

type LegendOptionInput = 'none' | 'auto' | LegendOptions['position'] | LegendOptions | undefined;

/**
 * The one shared normalization of the authored legend option. Per-chart
 * defaults, required-legend warnings and derived orders stay at the call
 * sites; only the 'none'/position-string/object dance lives here.
 */
/**
 * A key the chart cannot be read without: a map's range and no-data encoding,
 * or a colour, hatch or glyph that no mark names. It cannot be hidden. 'none'
 * is answered with an info lint and the key at the theme's required position
 * (top by default: one row above the plot, which keeps the plot's width).
 * `reason` completes "the legend cannot be hidden because ...".
 */
export function legendRequired(
  option: LegendOptionInput,
  warnings: LintWarning[],
  chartType: string,
  theme?: Theme,
  reason = 'the mapped range and no-data encoding must remain explicit',
): LegendOptions {
  // The theme places a key the spec hides or leaves; a named position wins.
  const position = theme?.legend?.required ?? 'top';
  if (option === 'none') {
    warnings.push({
      code: `${chartType}-legend-required`,
      severity: 'info',
      message: `${chartType} legend cannot be hidden because ${reason}`,
    });
    return { position };
  }
  return normalizeLegendOption(option, { position });
}

/**
 * `legend: 'none'` drops the key of a table, heatmap, cohort or
 * variance for a host that draws its own. One info lint names what it left
 * off, as `footnotes-off` names the notes, so no key goes missing silently.
 */
export function legendOff(warnings: LintWarning[], chartType: string, labels: readonly string[]): void {
  if (labels.length > 0) warnings.push({ code: 'legend-off', severity: 'info', message: `legend: 'none' left the ${chartType} key off: ${labels.join(' | ')}` });
}

export function normalizeLegendOption(option: Exclude<LegendOptionInput, 'none' | 'auto' | undefined>): LegendOptions;
export function normalizeLegendOption(option: Exclude<LegendOptionInput, 'none'>, defaultOptions: LegendOptions): LegendOptions;
export function normalizeLegendOption(option: LegendOptionInput, defaultOptions?: LegendOptions): LegendOptions | undefined;
export function normalizeLegendOption(option: LegendOptionInput, defaultOptions?: LegendOptions): LegendOptions | undefined {
  if (option === 'none') return undefined;
  // Registered layouts resolve 'auto' before constructing the frame.
  // Raw layout callers retain the chart's existing fallback here.
  if (option === undefined || option === 'auto') return defaultOptions;
  return typeof option === 'string' ? { position: option } : option;
}

export type { SeriesIdentity as LegendItemInput } from './seriesIdentity';

/** Internal fixed-frame retries: shorten attribution before leaving it off. */
export const COMPACT_SOURCE_LINES = Symbol('compactSourceLines');
/** Automatic frame budget, or the height left after chart axes have been measured. */
export const LEGEND_HEIGHT = Symbol('legendHeight');
export interface LegendBudget {
  height: number | 'auto';
  names: ReadonlyMap<string, string>;
}
export interface CompactSourceOptions {
  [COMPACT_SOURCE_LINES]?: 0 | 1;
  [COMPACT_OMITTED_NOTES]?: number;
  [LIVE_NOTE_SHOW]?: readonly string[];
}

const CUT_LABEL_NOTES = Symbol('cutLabelNotes');
const CUT_LABEL_LIST = Symbol('cutLabelList');

export interface FrameInput extends IdentityCollectionOptions, CompactSourceOptions {
  [LEGEND_HEIGHT]?: LegendBudget;
  [CUT_LABEL_NOTES]?: string[];
  /** Internal footer plan: all enabled static text already has room in this frame. */
  fullStaticFooter?: boolean;
  target?: BaseOptions['target'];
  /** The chart's `textScale`; the title's shrink floor scales with it. */
  textScale?: number;
  size: Size;
  /** A content chart can settle its height before it builds marks and labels. */
  autoHeight?: (plot: Rect) => number | undefined;
  margin: Margin;
  /**
   * Extra inset applied ONLY to the returned plot rect, not to the frame
   * furniture. A label reserve (bump's left rail, the indicator100 gutter) is
   * a PLOT concern: folding it into `margin.left` drags the title, subtitle
   * and source line a third of the way across the canvas on bump fixtures —
   * a 113-unit swing between fixtures of one registered type, reading as a
   * broken export. Furniture anchors at the authored margin; the plot alone
   * clears the reserve.
   */
  plotInset?: { left?: number };
  /** Inset of the footer lines from both content edges: a table passes its cell air, so its notes line up with the cell text. */
  footerInset?: number;
  /**
   * Card-class charts (kpi, bullet) keep the compact frame: the gap tokens
   * step by width class and cards are exempt from the width classes entirely.
   * On a 144px tile the widened gaps cost labels (a kpi card loses its delta
   * pair at 12px gaps), and drawing every label outranks spacing taste.
   */
  cardGaps?: boolean;
  mode?: BaseOptions['mode'];
  title?: BaseOptions['title'];
  subtitle?: Subtitle;
  unit?: string;
  source?: string;
  /**
   * A map pack's licence credit. A required one prints under the source line
   * on every target and survives `footnotes: false`; another goes to the
   * notes list.
   */
  credit?: ChartCredit;
  /** `options.notes`: the footer rule's placement, line budget, kinds shown and pointer. */
  notes?: BaseOptions['notes'];
  /** Built-in wording for the renderer-composed labels this frame draws. */
  strings?: BaseOptions['strings'];
  footnotes?: string[];
  /**
   * `options.footnotes: false`: no footnote block. The frame draws
   * none of `footnotes`, the notes the layout derived included, and says
   * which it left off in an info lint. A layout sets `footnotes` after it
   * spreads `frameTextOptions`, so the switch travels in a key of its own
   * that no layout writes.
   */
  footnotesOff?: boolean;
  /**
   * The notes a MARK on the canvas points at, in the order their numbers
   * run: the author's own first, as written, then the ones the engine
   * derived that a drawn mark references — gantt's event legend, whose
   * badges read 1, 2, 3 beside the rule they mark. Everything else in `footnotes`
   * is a note about the exhibit with nothing to point at it (a partial
   * period, a method note, a near-zero tail) and prints unnumbered, because
   * a number the reader cannot follow points at nothing.
   * Absent numbers the whole list.
   */
  numberedFootnotes?: string[];
  /**
   * 1-based positions of authored notes that no mark on the chart refers to.
   * They print unnumbered: a "1)" that nothing points at points at nothing
   * Later notes keep their positions, so a category marked 2) still finds
   * note 2.
   */
  unreferencedNotes?: number[];
  /**
   * 1-based positions of numbered notes the engine words (a metric stack's state note, a gantt
   * milestone key): disclosures that keep their number. An authored note is never one of them.
   */
  numberedDisclosures?: number[];
  /**
   * The notes a drawn mark points at with its number: an authored note a
   * category or cell names (`footnote: n`), a cut or ranked category name, a
   * Gantt event badge. The footer rule keeps them in the frame outside the
   * line budget and on every placement, so the "1)" on the chart always finds
   * its note on the canvas. `footnotes: false` still removes them.
   */
  pointedNotes?: string[];
  /**
   * The ink of the notes, not of the source line. A table's notes take the
   * tertiary `inkMeta`, which resolves to `inkMuted` on a theme that
   * sets no such role; every other chart keeps `inkMuted`.
   */
  footnoteInk?: 'inkMuted' | 'inkMeta';
  /**
   * The event key (core/eventLane): the events the lane numbered instead of
   * setting inline, drawn as a band above the footnotes. It changes the frame
   * height only, never the plot width, so category positions stay put.
   */
  eventKey?: FrameBand;
  legend?: { options: LegendOptions; items: LegendItemInput[] };
  /** Automatic legend keys use the footnote token ('compact': the smaller of it and the secondary step); explicit keys keep axis type. */
  legendFont?: 'footnote' | 'compact';
  theme: Theme;
  measure: TextMeasurer;
  /**
   * Title size in compact mode: the theme's smallest title step, resolved
   * from the unstepped theme by `frameTextOptions` (the `theme` above is
   * already stepped to the canvas width class and has lost its steps).
   */
  compactTitleSize?: number;
}

type FrameTextKey = 'target' | 'textScale' | 'title' | 'subtitle' | 'unit' | 'source' | 'footnotes' | 'notes' | 'mode' | 'strings';

/** Shared authored frame text; layouts can override derived units and required notes. */
/**
 * Layout-internal footnote provenance. A layout that composes a list before
 * handing it to ANOTHER layout (pareto builds a combo, likert a bar) says
 * which part of it the author wrote, so only those keep a number.
 *
 * It is not on `BaseOptions`: the public options type must accept exactly
 * what the schemas accept, and a caller who set this key on a request would
 * be refused by validation while TypeScript said yes. It
 * travels on the options OBJECT between two layouts and never off the
 * engine, so `withAuthoredFootnotes` and `footnoteSwitch` are the only ways
 * to put it there.
 */
export interface InternalFootnoteOptions {
  [CUT_LABEL_NOTES]?: string[];
  authoredFootnotes?: string[];
  /**
   * `footnotes: false`, as `footnoteSwitch` records it for the layouts
   * they read an empty list where they compose notes, and the
   * frame reads this to leave every note off.
   */
  footnotesOff?: boolean;
}

/**
 * The author's notes as a list. `footnotes: false` has none: it switches the
 * whole block off, which the frame answers for, not the list.
 */
export function authoredNotes(options: Pick<BaseOptions, 'footnotes'>): string[] {
  return options.footnotes === false ? [] : options.footnotes ?? [];
}

/**
 * The registered layout's first step for `footnotes: false`. Every
 * layout composes its notes from the derived ones and `options.footnotes`,
 * so the switch reaches them as an empty list, and reaches the frame, the
 * one place that draws a note, as `footnotesOff`. A layout that hands its
 * options on to another (pareto, histogram, likert, pvm, cohort) spreads
 * them, and the switch goes with it.
 */
export function footnoteSwitch<O extends Pick<BaseOptions, 'footnotes'>>(options: O): O {
  if (options.footnotes !== false) return options;
  return { ...options, footnotes: [], footnotesOff: true } as O;
}

/**
 * The options one layout hands another, with the composed footnote list and
 * the author's own subset of it.
 */
export function withAuthoredFootnotes<T extends object>(
  options: T,
  footnotes: string[],
  authored: BaseOptions['footnotes'],
): T {
  return { ...options, footnotes, authoredFootnotes: authoredNotes({ footnotes: authored }) } satisfies T & InternalFootnoteOptions;
}

/**
 * How many numbers the author's own notes have already taken when gantt's
 * event badges start counting. It reads the same authored subset
 * `numberedFootnotesWith` does, not the composed list: a layout that came
 * through pareto or histogram carries derived notes in `footnotes`, and
 * counting those made the first badge read 3 beside a legend entry that
 * reads 1).
 */
export function authoredFootnoteCount(
  options: Pick<BaseOptions, 'footnotes'> & InternalFootnoteOptions,
): number {
  return (options.authoredFootnotes ?? authoredNotes(options)).length;
}

/**
 * The numbered list when a layout adds notes a MARK points at (gantt's event
 * legend) to what it was handed. It starts from the authored subset a
 * composing layout declared, not from the composed list, so a derived note
 * that came down from pareto or histogram does not pick up a number here.
 */
export function numberedFootnotesWith(
  options: Pick<BaseOptions, 'footnotes'> & InternalFootnoteOptions,
  referenced: string[],
): string[] {
  return [...(options.authoredFootnotes ?? authoredNotes(options)), ...referenced];
}

/**
 * Internal layout marker for the unit line: the chart printed its
 * `options.unit` nowhere, so the frame prints it where the subtitle goes, as
 * "<measure> in <unit>". The value is the measure the engine can name (the
 * primary series), or '' when it can name none; the line is then the unit
 * alone. `layoutWithLegendPolicy` sets it on a second pass; authored JSON
 * cannot.
 */
export const UNIT_LINE = Symbol('unitLine');

/**
 * Internal layout marker: the note numbers the chart's data refers to (a
 * category's or a cell's `footnote`), set by `layoutWithLegendPolicy`. An
 * authored note outside it prints unnumbered.
 */
export const FOOTNOTE_REFS = Symbol('footnoteRefs');

/**
 * Internal layout marker: notes the layout composed whose number a drawn mark
 * carries (cut or ranked category names). `frameTextOptions` hands them to the
 * frame as `pointedNotes`, with the authored notes the data refers to.
 */
export const POINTED_NOTES = Symbol('pointedNotes');

function unitLineSubtitle(options: object & { unit?: string }): Subtitle | undefined {
  const measure = (options as { [UNIT_LINE]?: string })[UNIT_LINE];
  if (measure === undefined || !options.unit?.trim()) return undefined;
  return { measure: measure || options.unit.trim() };
}

function unreferenced(options: object & InternalFootnoteOptions & Pick<BaseOptions, 'footnotes'>): Pick<FrameInput, 'unreferencedNotes' | 'pointedNotes'> {
  const refs = (options as { [FOOTNOTE_REFS]?: ReadonlySet<number> })[FOOTNOTE_REFS];
  const composed = (options as { [POINTED_NOTES]?: readonly string[] })[POINTED_NOTES] ?? [];
  const notes = options.authoredFootnotes ?? authoredNotes(options);
  const positions = refs ? notes.flatMap((_, i) => (refs.has(i + 1) ? [] : [i + 1])) : [];
  const pointed = [...(refs ? notes.filter((_, i) => refs.has(i + 1)) : []), ...composed];
  return { ...(positions.length > 0 ? { unreferencedNotes: positions } : {}), ...(pointed.length > 0 ? { pointedNotes: pointed } : {}) };
}

export function frameTextOptions(
  options: Pick<BaseOptions, Exclude<FrameTextKey, 'mode'> | 'textSize'> & InternalFootnoteOptions & CompactSourceOptions
    & { mode?: unknown; theme?: ThemeRef; [LEGEND_HEIGHT]?: LegendBudget },
): Pick<FrameInput, FrameTextKey | 'footnotesOff' | 'numberedFootnotes' | 'unreferencedNotes' | 'pointedNotes' | 'legendFont' | 'compactTitleSize' | typeof CUT_LABEL_NOTES | typeof LEGEND_HEIGHT> & IdentityCollectionOptions & CompactSourceOptions {
  const mode = options.mode === 'full' || options.mode === 'compact' ? options.mode : undefined;
  const unitLine = resolveSubtitle(options.subtitle) === undefined ? unitLineSubtitle(options) : undefined;
  return {
    ...identityCollector(options),
    ...(options[LEGEND_HEIGHT] !== undefined ? { [LEGEND_HEIGHT]: options[LEGEND_HEIGHT] } : {}),
    ...(options[CUT_LABEL_NOTES] ? { [CUT_LABEL_NOTES]: options[CUT_LABEL_NOTES] } : {}),
    target: options.target,
    ...(options.textScale === undefined && options.textSize === undefined ? {} : { textScale: textScaleOf(options) }),
    title: options.title,
    subtitle: resolveSubtitle(options.subtitle) ?? unitLine,
    // A measure that already carries the unit ("Retained customers" in
    // customers, or the unit itself) prints it once.
    unit: unitLine && squeezeUnit(unitLine.measure).includes(squeezeUnit(options.unit!)) ? undefined : options.unit,
    source: options.source,
    ...(options[COMPACT_SOURCE_LINES] !== undefined ? { [COMPACT_SOURCE_LINES]: options[COMPACT_SOURCE_LINES] } : {}),
    ...(options[COMPACT_OMITTED_NOTES] ? { [COMPACT_OMITTED_NOTES]: options[COMPACT_OMITTED_NOTES] } : {}),
    ...(options[LIVE_NOTE_SHOW] ? { [LIVE_NOTE_SHOW]: options[LIVE_NOTE_SHOW] } : {}),
    strings: options.strings,
    ...(options.notes !== undefined || shownNoteKinds(options) !== undefined ? { notes: { ...options.notes, show: shownNoteKinds(options) as NonNullable<FrameInput['notes']>['show'] } } : {}),
    footnotes: options.footnotes === false ? [] : options.footnotes,
    ...(options.footnotesOff === true || options.footnotes === false ? { footnotesOff: true } : {}),
    numberedFootnotes: options.authoredFootnotes ?? authoredNotes(options),
    ...unreferenced(options),
    mode,
    ...(mode === 'compact' ? { compactTitleSize: smallestTitleSize(resolveTargetTheme(options.theme, options.target ?? DEFAULT_TARGET, textScaleOf(options), textSizeOf(options))) } : {}),
    // Compact keeps its key and may shrink it: the key takes the footnote size
    // (12 px), or the secondary step where that is smaller (11 px on a report card); a full
    // chart's automatic key prints at the key size (13 px).
    ...(mode === 'compact' ? { legendFont: 'compact' as const } : {}),
  };
}

export interface FrameResult {
  /** Pixels the frame band lacks to give the plot its 10px minimum; absent when it fits. */
  deficit?: number;
  /** Height a key band above or below the plot takes from it; absent beside the subtitle, on the right or with no key. */
  legendBand?: number;
  plot: Rect;
  nodes: SceneNode[];
  frame: FrameGeometry;
  legend?: LegendGeometry;
}

/** WCAG 2.2 AA 2.5.8 minimum target size of the React notes button. */
const NOTE_HIT_PX = 24;

/**
 * The height of the footer React draws in place of this one (ChartFooter): the
 * printed notes, then a row of wrapping items (the source line, an 'info'
 * credit and the 24 px notes button, 0.75 em apart, 2 px between lines; an item
 * wider than the row takes a line of its own and wraps its text), then a
 * credit. The bottom margin stays the frame's.
 */
function htmlFooterHeight(input: FrameInput, parts: ReturnType<typeof footerParts>, sourceText: string | undefined,
  font: FontSpec, width: number, lineH: number, measure: TextMeasurer): number {
  const height = (text: string) => wrapFootnote(text, font, width, measure).length * lineH;
  let total = 0;
  for (const note of parts.shown) {
    total += height(`${note.ref ? `${footnoteMark(note.ref)} ` : ''}${note.kind === 'method' || note.kind === 'disclosure' ? note.short ?? note.text : note.text}`);
  }
  const credit = parts.credit && `${chartString(input, 'mapCredit')}: ${parts.credit.text}`;
  const label = parts.panel.length === 0 ? undefined
    : parts.info ? `${wordingString(input, 'notesAndSources')} (${parts.panel.length})` : notesPointer(parts.panel.length, input.strings);
  const items = [
    ...(parts.source && sourceText ? [{ w: measure(sourceText, font).width, text: sourceText }] : []),
    ...(credit && parts.info ? [{ w: measure(credit, font).width, text: credit }] : []),
    ...(label ? [{ w: Math.max(NOTE_HIT_PX, measure(label, font).width), h: Math.max(NOTE_HIT_PX, lineH) }] : []),
  ];
  let used = -1;
  let line = 0;
  for (const item of items) {
    const h = item.text === undefined ? item.h! : item.w > width ? height(item.text) : lineH;
    if (used >= 0 && used + 0.75 * font.size + item.w <= width) {
      used += 0.75 * font.size + item.w;
      line = Math.max(line, h);
      continue;
    }
    if (used >= 0) total += line + 2;
    used = Math.min(item.w, width);
    line = h;
  }
  if (items.length > 0) total += line + (parts.shown.length > 0 ? 4 : 0);
  if (credit && !parts.info) total += height(credit);
  return total;
}
const frameChrome = new WeakMap<FrameGeometry, number>();
/** Measured or equivalent chrome that certifies the minimum automatic height. */
export const plotChromeFloor = new WeakMap<object, number>();
/** A raw layout already repeated at its final automatic height, without retained retry state. */
export const settledAutoHeight = new WeakSet<FrameGeometry>();

export { freedChromeOf, recordFreedChrome, slotDemandHeight } from './footer';
/** The reference gaps the freeing rules measure against. */
const REFERENCE_SUBTITLE_PLOT_GAP = 12;
const REFERENCE_FOOTER_GAP = 12;

/** Call only when the chrome certifies that smaller heights cannot keep the plot floor. */
export function fixedPlotChrome(result: FrameResult, reserve = 0): void {
  const chrome = frameChrome.get(result.frame);
  if (chrome !== undefined) plotChromeFloor.set(result.frame, chrome + reserve);
}

const SWATCH = 12;
/** Lines an authored title wraps to on the new targets before it takes more. */
const TITLE_LINES = 3;
/** Two dash periods long, so a dashed or dotted line reads as one in its key. */
const LINE_SWATCH = 18;
/**
 * A line key with a marker is 16 px, the dot at its centre (5 px across, as
 * the plot's marker): the line reads on both sides of it. A plain line keeps
 * 18 px, two dash periods.
 */
const MARKER_LINE_SWATCH = 16;
const lineSwatch = (item: LegendItemInput): number => (item.marker ? MARKER_LINE_SWATCH : LINE_SWATCH);
const SWATCH_GAP = 5;
const ITEM_GAP = 14;
/**
 * Inter-block gaps are space tokens: title→subtitle 4, subtitle→plot 8/14,
 * plot→footer 12/14, bottom key→footer 10/14, footnotes→source 4, legend 8 —
 * resolved per width class through `spaceTokens()`. BLOCK_GAP=8 is the
 * legend token's value only.
 */
/** The smallest plot band the frame hands a chart. */
const MIN_PLOT_H = 10;


export { wrapFootnote } from './footer';

/**
 * The plot height a chart keeps inside the frame band after its own reserves
 * (axis rows, category band, title band), computed by the chart as `h`. When
 * they leave less than the minimum plot, the frame records the canvas height
 * that would hold them, so sizing grows or refuses the chart instead of
 * drawing its axes into the footer.
 */
export function plotHeightAfter(frameResult: FrameResult, canvasH: number, h: number): number {
  const { frame } = frameResult;
  frame.plotMinHeight = Math.max(frame.plotMinHeight ?? 0, canvasH + (frameResult.deficit ?? 0) + MIN_PLOT_H - h);
  return Math.max(MIN_PLOT_H, h);
}

function legendKeyNodes(
  theme: Theme,
  item: LegendItemInput,
  id: Id,
  x: number,
  y: number,
  lineH: number,
  font?: FontSpec,
): SceneNode[] {
  const nodes = shapeKeyNodes(theme, item, id, x, y, lineH, font);
  return item.key === 'line' && item.marker ? [...nodes, lineKeyMarker(theme, item, item.marker, `${id}:marker`, x + MARKER_LINE_SWATCH / 2, y + lineH / 2)] : nodes;
}

/** The marker on a line key, 5 px across, in the line's paint; a hollow one is a ring round the page colour. */
function lineKeyMarker(theme: Theme, item: LegendItemInput, marker: NonNullable<LegendItemInput['marker']>, id: Id, cx: number, cy: number): SceneNode {
  const r = (v: number) => Math.round(v * 100) / 100;
  const { shape, hollow } = marker;
  const fill: Paint = hollow ? { token: 'background' } : item.paint;
  const owner = { seriesId: item.id };
  const ringWidth = strokeToken(theme, 'mark');
  if (shape === 'circle') return { t: 'circle', id, cx, cy, r: 2.5, fill, ...(hollow ? { stroke: item.paint, strokeWidth: ringWidth } : {}), owner, part: 'swatch' };
  if (shape === 'square') return { t: 'rect', id, rect: { x: cx - 2.5, y: cy - 2.5, w: 5, h: 5 }, fill, ...(hollow ? { stroke: item.paint, strokeWidth: ringWidth } : {}), owner, part: 'swatch' };
  const d = shape === 'triangle'
    ? `M ${r(cx)} ${r(cy - 3)} L ${r(cx + 3)} ${r(cy + 2.5)} L ${r(cx - 3)} ${r(cy + 2.5)} Z`
    : `M ${r(cx)} ${r(cy - 3.5)} L ${r(cx + 3.5)} ${r(cy)} L ${r(cx)} ${r(cy + 3.5)} L ${r(cx - 3.5)} ${r(cy)} Z`;
  return { t: 'path', id, d, fill, ...(hollow ? { stroke: item.paint, width: ringWidth } : {}), owner, part: 'swatch' };
}

function shapeKeyNodes(
  theme: Theme,
  item: LegendItemInput,
  id: Id,
  x: number,
  y: number,
  lineH: number,
  font?: FontSpec,
): SceneNode[] {
  if (item.key === 'heading') return [];
  const cy = y + lineH / 2;
  if (item.key === 'glyph' && font) {
    const textH = font.size * (font.lineHeight ?? 1.2);
    return [{ t: 'text', id, x: x + SWATCH / 2, y: y + (lineH - textH) / 2, lines: [item.glyph ?? ''], align: 'middle', font, ink: item.paint, owner: { seriesId: item.id }, part: 'swatch', typeRole: 'axis' }];
  }
  if (item.key === 'line' && item.hollow) {
    const outer = legendKeyNode(theme, item, id, x, y, lineH) as Extract<SceneNode, { t: 'line' }>;
    return [outer, { ...outer, id: `${id}:inner`, stroke: { token: 'background' }, width: strokeToken(theme, 'hair') }];
  }
  if (item.key === 'line' && item.caps) {
    const caps = item.caps;
    const cap = (end: 'low' | 'high', cx: number): SceneNode => ({ t: 'line', id: `${id}:${end}`, x1: cx, y1: cy - caps.half, x2: cx, y2: cy + caps.half,
      stroke: caps.paint, width: caps.width ?? strokeToken(theme, 'mark'), owner: { seriesId: item.id }, part: 'swatch' });
    return [legendKeyNode(theme, item, id, x, y, lineH), cap('low', x), cap('high', x + lineSwatch(item))];
  }
  if (item.withLine) {
    const lx = x + SWATCH + WITH_LINE_GAP;
    return [legendKeyNode(theme, item, id, x, y, lineH), {
      t: 'line', id: `${id}:line`, x1: lx, y1: cy, x2: lx + LINE_SWATCH, y2: cy, stroke: item.withLine.paint,
      width: item.withLine.width ?? strokeToken(theme, 'data'), ...(item.withLine.dash ? { dash: item.withLine.dash, lineCap: item.withLine.lineCap } : {}), owner: { seriesId: item.id }, part: 'swatch',
    }];
  }
  if (item.key === 'harvey') {
    // The ball as the heatmap draws it: a ring on the page colour, then the
    // filled quarters on top.
    const cx = x + SWATCH / 2;
    const r = SWATCH / 2 - 0.5;
    const level = Math.max(0, Math.min(4, Math.round(item.level ?? 0)));
    const owner = { seriesId: item.id };
    const ring: SceneNode = { t: 'circle', id, cx, cy, r, fill: { token: 'background' }, stroke: { token: 'neutralMark' }, strokeWidth: strokeToken(theme, 'mark'), owner, part: 'swatch' };
    if (level === 0) return [ring];
    return [ring, level === 4
      ? { t: 'circle', id: `${id}:fill`, cx, cy, r, fill: item.paint, owner, part: 'swatch' }
      : { t: 'path', id: `${id}:fill`, d: harveyWedgePath(cx, cy, r, level), fill: item.paint, owner, part: 'swatch' }];
  }
  if (item.key === 'sizes') {
    // Nested rings standing on the key row's baseline, each centred over the widest.
    const radii = sizeKeyRadii(item, lineH);
    const outer = radii[0] ?? SWATCH / 2;
    const bottom = cy + Math.min(lineH / 2, outer);
    const owner = { seriesId: item.id };
    return radii.map((r, i): SceneNode => ({
      t: 'circle', id: i === 0 ? id : `${id}:size${i}`, cx: x + outer, cy: bottom - r, r,
      fill: { token: 'background' }, stroke: item.paint, strokeWidth: strokeToken(theme, 'mark'), owner, part: 'swatch',
    }));
  }
  if (item.key === 'whisker') {
    // The interval as the chart draws it: a stem the key's height, capped at both ends.
    const cx = x + SWATCH / 2;
    const top = cy - SWATCH / 2;
    const bottom = cy + SWATCH / 2;
    const stroke = { stroke: item.paint, width: item.width ?? strokeToken(theme, 'rule'), owner: { seriesId: item.id }, part: 'swatch' };
    return [
      { t: 'line', id, x1: cx, y1: top, x2: cx, y2: bottom, ...stroke },
      { t: 'line', id: `${id}:capTop`, x1: cx - 3, y1: top, x2: cx + 3, y2: top, ...stroke },
      { t: 'line', id: `${id}:capBottom`, x1: cx - 3, y1: bottom, x2: cx + 3, y2: bottom, ...stroke },
    ];
  }
  return [legendKeyNode(theme, item, id, x, y, lineH)];
}

function legendKeyNode(
  theme: Theme,
  item: LegendItemInput,
  id: Id,
  x: number,
  y: number,
  lineH: number,
): SceneNode {
  const cy = y + lineH / 2;
  if (item.key === 'line') {
    return {
      t: 'line',
      id,
      x1: x,
      y1: cy,
      x2: x + lineSwatch(item),
      y2: cy,
      stroke: item.paint,
      width: item.width ?? strokeToken(theme, 'data'),
      ...(item.dash ? { dash: item.dash, lineCap: item.lineCap } : {}),
      owner: { seriesId: item.id },
      part: 'swatch',
    };
  }
  if (item.key === 'tick') {
    const cx = x + SWATCH / 2;
    return {
      t: 'line',
      id,
      x1: cx,
      y1: cy - SWATCH / 2,
      x2: cx,
      y2: cy + SWATCH / 2,
      stroke: item.paint,
      width: item.width ?? strokeToken(theme, 'mark'),
      owner: { seriesId: item.id },
      part: 'swatch',
    };
  }
  if (item.key === 'bracket') {
    // A gantt summary bracket, a bar with a leg down at each end, in its stroke.
    return {
      t: 'path',
      id,
      d: bracketPath(x, cy),
      stroke: item.paint,
      width: item.width ?? strokeToken(theme, 'mark'),
      owner: { seriesId: item.id },
      part: 'swatch',
    };
  }
  if (item.key === 'diamond') {
    // A scatter group drawn as a diamond is keyed as one, filled or ringed as the mark is.
    return {
      t: 'path',
      id,
      d: diamondPath(x + SWATCH / 2, cy),
      fill: item.paint, ...(item.separation ? { separation: item.separation } : {}),
      ...(item.stroke ? { stroke: item.stroke, width: item.width ?? strokeToken(theme, 'mark') } : {}),
      owner: { seriesId: item.id },
      part: 'swatch',
    };
  }
  if (item.key === 'triangle') {
    // The anomaly flag as the chart draws it (8 x 6 px), a quarter larger.
    const cx = x + SWATCH / 2;
    return {
      t: 'path',
      id,
      d: trianglePath(cx, cy),
      fill: item.paint,
      ...(item.stroke ? { stroke: item.stroke, width: item.width ?? strokeToken(theme, 'mark') } : {}),
      owner: { seriesId: item.id },
      part: 'swatch',
    };
  }
  if (item.key === 'marker') {
    return {
      t: 'circle',
      id,
      cx: x + SWATCH / 2,
      cy,
      r: item.radius ?? SWATCH / 2,
      fill: item.paint,
      ...(item.stroke ? { stroke: item.stroke, strokeWidth: item.width ?? strokeToken(theme, 'mark') } : {}),
      owner: { seriesId: item.id },
      part: 'swatch',
    };
  }
  return {
    t: 'rect',
    id,
    rect: { x, y: y + (lineH - SWATCH) / 2, w: SWATCH, h: SWATCH },
    fill: item.paint,
    pattern: item.hollow ? 'hollow' : item.pattern,
    ...(item.separation ? { separation: item.separation } : {}),
    ...(item.hatchGround && item.pattern === 'hatch45' ? { hatchGround: item.hatchGround } : {}),
    ...(item.hatchEdge === false && item.pattern === 'hatch45' ? { hatchEdge: false as const } : {}),
    ...(item.stroke ? { stroke: item.stroke, strokeWidth: item.width ?? strokeToken(theme, 'mark') } : {}),
    owner: { seriesId: item.id },
    part: 'swatch',
  };
}

/** A size key's radii, largest first, none above half the key row. */
function sizeKeyRadii(item: LegendItemInput, lineH: number): number[] {
  return (item.radii ?? []).map((r) => Math.min(Math.max(0.5, r), lineH / 2)).sort((a, b) => b - a);
}

/** The width a key's glyph takes before its label: the key box, or a size key's widest ring. */
function keyWidth(item: LegendItemInput, lineH: number): number {
  if (item.key === 'heading') return -SWATCH_GAP;
  if (item.withLine) return SWATCH + WITH_LINE_GAP + LINE_SWATCH;
  if (item.key === 'line') return lineSwatch(item);
  return item.key === 'sizes' ? 2 * (sizeKeyRadii(item, lineH)[0] ?? SWATCH / 2) : SWATCH;
}

/** Air between a box key and the line style it shares an entry with. */
const WITH_LINE_GAP = 3;

/** The legend's summary bracket across the key box: a bar 3 px over the centre, legs 6 px down at both ends. */
function bracketPath(x: number, cy: number): string {
  const r = (v: number) => Math.round(v * 100) / 100;
  return `M ${r(x)} ${r(cy + 3)} L ${r(x)} ${r(cy - 3)} L ${r(x + SWATCH)} ${r(cy - 3)} L ${r(x + SWATCH)} ${r(cy + 3)}`;
}

/** The legend's diamond, 10 px across both ways, centred on (cx, cy). */
function diamondPath(cx: number, cy: number): string {
  const r = (v: number) => Math.round(v * 100) / 100;
  return `M ${r(cx)} ${r(cy - 5)} L ${r(cx + 5)} ${r(cy)} L ${r(cx)} ${r(cy + 5)} L ${r(cx - 5)} ${r(cy)} Z`;
}

/** The legend's flag triangle, 10 px wide and 7.5 px tall, centred on (cx, cy). */
function trianglePath(cx: number, cy: number): string {
  const r = (v: number) => Math.round(v * 100) / 100;
  return `M ${r(cx - 5)} ${r(cy + 3.75)} L ${r(cx + 5)} ${r(cy + 3.75)} L ${r(cx)} ${r(cy - 3.75)} Z`;
}

function shiftLegendKeyY(node: SceneNode, dy: number): void {
  if (node.t === 'rect') node.rect.y += dy;
  else if (node.t === 'line') {
    node.y1 += dy;
    node.y2 += dy;
  } else if (node.t === 'circle') node.cy += dy;
  else if (node.t === 'text') node.y += dy;
  // The path swatches: the triangle is redrawn round its centre; the
  // diamond and the bracket move every point down by dy.
  else if (node.t === 'path') {
    const numbers = node.d.match(/-?[\d.]+/g)!.map(Number);
    if (numbers.length === 6) node.d = trianglePath((numbers[0]! + numbers[2]!) / 2, numbers[1]! - 3.75 + dy);
    else {
      let k = 0;
      node.d = node.d.replace(/-?[\d.]+/g, (n) => (k++ % 2 === 1 ? String(Math.round((Number(n) + dy) * 100) / 100) : n));
    }
  }
}

function measureNamesUnit(unit: string, measure: string): boolean {
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
  input: Pick<FrameInput, 'subtitle' | 'unit'>,
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
  input: Pick<FrameInput, 'subtitle' | 'unit'> & { unitShown?: boolean },
): boolean {
  return Boolean(input.unitShown && input.unit) || frameRendersUnit(input);
}

/**
 * `unit-not-shown`: an authored options.unit printed
 * nowhere on the drawing. The subtitle prints it only beside a measure, so a
 * chart with a unit and no subtitle showed bare numbers. Judged on the
 * rendered text: a line counts when it carries the unit once digits, spaces
 * and number separators are squeezed out of both, so "$120m" carries "$m"
 * and "Revenue, EUR m" carries "EUR m". A subtitle that drops the unit on
 * purpose (a ratio beside a "per" measure) and a host that prints it
 * (unitShown) count as shown.
 */
export function unitNotShownLints(
  options: Record<string, unknown> | undefined,
  geo: { type?: string; scene: readonly SceneNode[]; warnings: readonly LintWarning[] },
): LintWarning[] {
  if (!unitMissing(options, geo)) return [];
  const unit = (options!.unit as string).trim();
  return [{
    code: 'unit-not-shown',
    severity: 'warn',
    message: `options.unit '${unit}' is printed nowhere on the chart: no subtitle measure, axis title or value label carries it`,
    suggest: `name the measure in the subtitle (subtitle: { measure: 'Revenue' } prints "Revenue in ${unit}"), or title the value axis with the unit; set unitShown: true when the host prints the unit beside the chart`,
    field: ['options', 'unit'],
  }];
}

/**
 * `unit-in-format`: an options.unit beside an options.format that
 * already prints it. A line end label read "$2,456 USD" for unit 'USD' and
 * format '$1,234'. The format carries the unit when it prints the same unit
 * text (USD reads as $, as in textCarriesUnit) or the same currency (EUR and
 * €, USD and $ or US$, GBP and £). A unit that names another currency than
 * the format's sign warns `unit-format-conflict` instead, with no fix: which
 * of the two is right is the author's call. A percent format is left alone:
 * its sign is part of each value. `at` is the path of the options' owner
 * inside the chart, for a grid panel.
 */
export function unitInFormatLints(
  options: Record<string, unknown> | undefined, at: readonly (string | number)[] = [],
): LintWarning[] {
  const unit = typeof options?.unit === 'string' ? options.unit.trim() : '';
  const format = typeof options?.format === 'string' ? options.format : '';
  if (!unit || !format) return [];
  const spec = parseFormatExample(format);
  const printed = unitOfSpec(spec);
  const [unitSign, formatSign] = [currencySign(unit), currencySign(`${spec.prefix} ${spec.suffix}`)];
  const field = [...at, 'options', 'unit'];
  if (unit === '%' && spec.suffix.includes('%')) {
    return [{
      code: 'unit-format-conflict', severity: 'warn',
      message: `options.unit '%' repeats the percent sign in format '${format}'; line labels print the sign once`,
      suggest: 'remove options.unit; the format already prints %', field,
      fix: [{ op: 'remove', path: `/${field.join('/')}` }],
    }];
  }
  if (!printed) return [];
  if (unitSign && formatSign && unitSign !== formatSign) {
    return [{
      code: 'unit-format-conflict',
      severity: 'warn',
      message: `options.unit '${unit}' names another currency than format '${format}', which prints ${formatSign} on every value`,
      suggest: `use one currency: set a format that prints the currency of '${unit}', or set options.unit to the currency of ${formatSign}`,
      field,
    }];
  }
  if (!textCarriesUnit(printed, unit) && !(unitSign && formatSign)) return [];
  return [{
    code: 'unit-in-format',
    severity: 'warn',
    message: `options.unit '${unit}' repeats the ${printed} that format '${format}' prints on every value, so a label can read it twice`,
    suggest: `remove options.unit; the format already prints ${printed}`,
    field,
    fix: [{ op: 'remove', path: `/${field.join('/')}` }],
  }];
}

/**
 * The note line: one derived footnote that gives back what the
 * drawing left out or cannot show, "<lead>: a, b, c." It prints nothing when
 * there is nothing to name. A layout spreads it into the footnotes it
 * composes; it prints unnumbered in every mode and is a disclosure, so it
 * prints under `footnotes: false` too.
 *
 * It names every item unless the caller passes its options: then it names the
 * first `notes.maxListed` items (default DEFAULT_NOTE_LIMIT) and ends with a
 * count, "and 236 more". The caller keeps the rest reachable in the reading
 * and the hover records. An item that ends in a period ("+26.0% p.a.") does
 * not print a second one.
 */
export function noteLine(lead: string, items: readonly string[], options?: NoteCapOptions, total?: number): string[] {
  // shortcut: entries may break between name and value; keep them together when
  // the height search can avoid the extra layout work.
  return items.length === 0 ? [] : [engineNote(listText(lead, options === undefined ? items : cappedItems(items, options, total)), 'disclosure', undefined, undefined,
    // unless the author set notes.maxListed, the frame names as many items as fit two lines.
    options?.notes?.maxListed === undefined && options ? { lead, items, total, options } : undefined)];
}

const listText = (lead: string, items: readonly string[]) => `${lead}: ${items.join(', ').replace(/\.$/, '')}.`;

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
function listedNoteText({ lead, items, total, options }: NoteList, k: number): string {
  const n = items.length;
  if (k === 0) return listText(lead, [total !== undefined && total >= n ? countedValuesText(n, total, options) : moreListedText(n, options, true)]);
  return listText(lead, k < n ? [...items.slice(0, k), moreListedText(n - k, options)] : items);
}

/** How many items a drawn list note names (the frame fitted it, `fittedNote`); undefined when `drawn` is not one of its forms. */
function namedInDrawnNote(list: NoteList, drawn: string): number | undefined {
  const flat = (text: string) => text.replace(/\s+/g, '');
  const target = flat(drawn);
  for (let k = Math.min(list.items.length, noteCap(list.options, list.items.length)); k >= 0; k--) if (flat(listedNoteText(list, k)) === target) return k;
  return undefined;
}

/** `noteLine` for values the drawing does not print and no label stands for: the `values-in-note` warning lists them. */
export function valueNoteLine(lead: string, items: readonly string[], options?: NoteCapOptions, total?: number): string[] {
  return noteLine(lead, items, options, total).map((line) => valueNote(line, items));
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
function countedValuesText(count: number, total: number, options?: NoteCapOptions): string {
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

/** The note line the registered layout adds for labels the drawing hid. */
export const HIDDEN_LABEL_LEAD = 'Not labelled on the chart';

/** Measure cut-label disclosures through the existing frame; a pinned canvas keeps its size. */
export function withCutLabelNotes<O extends Pick<BaseOptions, 'notes' | 'footnotes' | 'strings' | 'locale' | 'target' | 'size'>, M extends object, D extends object>(
  data: unknown, options: O, layout: (options: O) => LayoutResult<M, D>,
): LayoutResult<M, D> {
  const first = layout(options);
  if (first.refused) return first;
  const cuts = cutLabels(first);
  if (!cuts.length) return first;
  // An error layout will be refused; its diagnostics must not gain drawing-only disclosures.
  if (first.warnings.some(warning => warning.severity === 'error')) return first;
  const warn = (geo: Geometry<M, D>) => {
    geo.warnings = [...geo.warnings.filter(warning => warning.code !== 'label-truncated'), {
      code: 'label-truncated', severity: 'warn', message: `${cuts.length} shortened labels have their full text in the notes list and reading.omissions.`,
      detail: { labels: cuts.map(cut => cut.labelId) },
    }];
    return geo;
  };
  const existing = chartNotes(first).map(note => note.text.replace(/\s+/g, ' ').trim());
  // A count or a repeated number in another note does not identify a cut value.
  const unlisted = cuts.filter(cut => isNumberAlone(cut.text)
    || !existing.some(note => containsText(note, cut.text.replace(/\s+/g, ' ').trim())));
  if (!unlisted.length) return warn(first);
  const items = [...new Set(unlisted.map(cut => {
    const node = first.scene.find(node => node.t === 'text' && (node.id === cut.labelId || node.id === `label:${cut.labelId}`));
    const owner = node?.owner;
    const source = data as { rows?: { id: string; label?: string }[]; columns?: { id: string; label?: string }[] };
    const row = source?.rows?.find(row => row.id === owner?.rowId)?.label;
    const column = source?.columns?.find(column => column.id === owner?.colId)?.label;
    const place = [row, row ? column : undefined].filter(Boolean).join(' — ');
    return place ? `${place}: ${cut.text.trim()}` : cut.text.trim();
  }))];
  const lead = chartString(options, 'cutLabels');
  const short = noteLine(lead, items, options)[0]!;
  const full = engineNote(`${lead}: ${items.join('; ').replace(/\.$/, '')}.`, 'disclosure', short, undefined, engineNoteMeta(short)?.list ?? null);
  const planned = { ...options, [CUT_LABEL_NOTES]: [...((options as InternalFootnoteOptions)[CUT_LABEL_NOTES] ?? []), full] };
  let next = options.notes?.show?.includes('disclosure') ? layout(planned) : first;
  // Footer allocation is owned by the frame. Do not turn an accepted pinned chart into a refusal,
  // nor raise the height a grid panel needs past its slot, which would refuse the grid around it.
  const need = (geo: LayoutResult<M, D>) => geo.refused ? 0 : Math.max(geo.frame.minHeight ?? 0, geo.frame.plotMinHeight ?? 0, geo.sizing?.measuredMinHeight ?? 0);
  if (next.refused || resolveTargetSize(options.target ?? DEFAULT_TARGET, options.size).fixed.height
    && (next.size.height > first.size.height || need(next) > Math.max(next.size.height, need(first)))) next = first;
  if (next !== first) {
    const original = new Map(cuts.map(cut => [cut.labelId, cut.displayed]));
    const visible = new Set(first.labels.filter(label => !label.hidden).map(label => label.id));
    // A note cannot pay for its space by cutting other text or hiding a value that was drawn.
    if (cutLabels(next).some(cut => !original.has(cut.labelId) || cut.displayed.length < original.get(cut.labelId)!.length)
      || next.labels.some(label => label.hidden && visible.has(label.id))) next = first;
  }
  (next as Geometry<M, D> & { [CUT_LABEL_LIST]?: ChartNote })[CUT_LABEL_LIST] = keepNoteMeta<ChartNote>({ n: 0, kind: 'disclosure', text: full, short, inFrame: false }, engineNoteMeta(full));
  return warn(next);
}

/** A note that cannot fit stays in the result after the footer has used its measured space. */
export function finishCutLabelNotes(geo: Geometry<object, object>): void {
  const note = (geo as Geometry & { [CUT_LABEL_LIST]?: ChartNote })[CUT_LABEL_LIST];
  if (!note || geo.frame.noteList?.some(entry => entry.text === note.text)) return;
  const notes = geo.frame.noteList ?? [];
  const at = notes.findIndex(entry => entry.kind === 'source' || entry.kind === 'credit');
  const cut = at < 0 ? notes.length : at;
  geo.frame.noteList = [...notes.slice(0, cut), note, ...notes.slice(cut)].map((entry, i) => copyNote(entry, { n: i + 1 }));
}

/** Layouts whose density notes must not change their finished value selection. */
export const DEFER_DENSITY_NOTES = Symbol('deferDensityNotes');
/** Values selected for the disclosure do not compete with the kept labels. */
export const DENSITY_VALUES = Symbol('densityValues');
/**
 * Size refusals of a density pass on a pinned height. Their height is the refused frame's plot-floor
 * estimate, and the frame at that height can select other values and need more: the outer layout verifies it.
 */
export const UNVERIFIED_DENSITY_REFUSALS = new WeakSet<object>();
/** Layout continuation options that preserve the selected values' scale. */
export const DENSITY_LAYOUT_OPTIONS = Symbol('densityLayoutOptions');

/**
 * The label kinds a reader loses outright when hidden: values, names, an
 * authored value line and an annotation's label (a band's edge
 * values hide at bar's row pitch, at any height).
 */
const OWED_KINDS: ReadonlySet<string> = new Set(['point', 'series', 'valueLine', 'annotation', 'item', 'diagramSecondary']);
const BRIDGE_OWED_KINDS: ReadonlySet<string> = new Set(['total', 'segment', 'category']);

/**
 * The solver never overlaps, so a label without a
 * seat is hidden, and the one exit after it gives that label a second home.
 * This lists, by label id, what is still owed: a hidden value, name or value
 * line, or any label the author pinned, that no note line names by identity
 * (`noted`). A label hidden as printed elsewhere is owed only when it names
 * the label that prints it (`printedIn`) and that label's drawn lines lose
 * its text. A value reads "Series 12 (Category)" with the names `data`
 * gives its owner; an annotation's label reads "Tolerance 46" with the label
 * (or id) of its authored annotation. Automatic density drops are owed too;
 * only an authored `labelDensity: 'minimal'` can request their omission.
 */
export function owedHiddenLabels(
  geo: { [DEFER_DENSITY_NOTES]?: boolean; type?: string; presentation?: { target: BaseOptions['target'] }; legend?: { items: readonly { id: Id; labelId: Id }[] }; labels: readonly PlacedLabel[]; scene: readonly SceneNode[]; debug: { decisions: readonly { labelId: Id; reason: string }[] } },
  data: unknown,
  pins: Readonly<Record<string, unknown>> = {},
  annotations?: unknown,
  minimal = false,
): Map<Id, string> {
  const drawn = new Map(geo.scene.flatMap((node) => (node.t === 'text' ? [[node.id, node.lines.join(' ')] as const] : [])));
  const idOf = (item: unknown): unknown => (typeof item === 'object' && item !== null ? (item as { id?: unknown }).id : item);
  // Each list is indexed once per call: the first item with an id wins, as `find` would.
  const indexes = new Map<unknown[], Map<unknown, unknown>>();
  const nameIn = (list: unknown, id: Id | undefined): string | undefined => {
    if (!Array.isArray(list) || id === undefined) return undefined;
    let index = indexes.get(list);
    if (index === undefined) {
      index = new Map();
      for (let i = 0; i < list.length; i++) {
        const item: unknown = list[i];
        const key = idOf(item);
        if (key === key && !index.has(key)) index.set(key, item);
      }
      indexes.set(list, index);
    }
    const hit: unknown = index.get(id);
    if (hit === undefined) return undefined;
    // A date period across years carries its year (CalendarInfo.named).
    return typeof hit === 'object' && hit !== null ? String((hit as { calendar?: { named?: unknown }; label?: unknown }).calendar?.named ?? (hit as { label?: unknown }).label ?? id) : String(hit);
  };
  const legendName = (id: Id | undefined): string | undefined => {
    const item = id === undefined ? undefined : geo.legend?.items.find((entry) => entry.id === id);
    // Else the value-axis title the series owns (a Pareto's "Cumulative share, %").
    return item ? drawn.get(`label:${item.labelId}`) ?? drawn.get(item.labelId) ?? geo.labels.find((l) => l.id === item.labelId)?.text
      : id && geo.labels.find((l) => l.kind === 'axisTitle' && l.owner.seriesId === id)?.text;
  };
  const { series, categories, rows, items, cases } = (data ?? {}) as { series?: unknown; categories?: unknown; rows?: unknown; items?: unknown; cases?: unknown };
  // Only a chart with annotations draws a callout, and it has loaded the annotate module.
  const valueCallouts = loadedDeferred('annotate')?.valueAnnotationLabels(geo.labels, annotations) ?? [];
  const entries = geo.labels.flatMap((label) => {
    // LEFT_OUT_OF_NOTE: a grid panel's own chart leaves this value out of its note (panelNoteTexts).
    if (label.hidden === undefined || label.noted || (label as { [LEFT_OUT_OF_NOTE]?: true })[LEFT_OUT_OF_NOTE]
      || (minimal || geo[DEFER_DENSITY_NOTES]) && label.hidden === 'density' || !label.text) return [];
    // a drawn callout or note that prints this value with `${value}` at its mark is its label.
    const callout = valueCallouts.find(([own, at]) => holdsToken(own.text, label.text)
      && Object.entries(at).every(([key, id]) => key === 'edge' || (label.owner as Record<string, unknown>)[key] === id));
    if (callout) { label.printedIn = callout[0].id; return []; }
    // A series is unlabelled only when no drawn label names it (a bump's end name covers its start name).
    if (label.kind === 'series' && label.owner.seriesId !== undefined && geo.labels.some((other) => other !== label && other.kind === 'series'
      && other.hidden === undefined && other.owner.seriesId === label.owner.seriesId)) return [];
    // A value the chart marked redundant before the solver is
    // dropped unless it prints elsewhere: in the label the chart names, else in a
    // drawn label of its own category or series. An authored 'minimal' asked for the drop.
    // Only value kinds whose chart drops them for room (a mekko sliver, a Net total); a point or a name
    // a chart marks redundant is printed in another label or switched off by the author.
    // A value printed in a named label is owed when that label lost its seat or its text (any kind).
    if (label.hidden === 'redundant') {
      if (label.printedIn !== undefined) {
        // The host prints the same value in its own format: it is owed only when the host lost its own text.
        const host = geo.labels.find((other) => other.id === label.printedIn);
        if (holdsToken(drawn.get(`label:${label.printedIn}`), label.text) || (host?.text && holdsToken(drawn.get(`label:${label.printedIn}`), host.text))) return [];
      } else if (minimal || !['segment', 'total'].includes(label.kind) || geo.labels.some((other) => other !== label && other.hidden === undefined && holdsToken(other.text, label.text)
        && (label.owner.categoryId !== undefined ? other.owner.categoryId === label.owner.categoryId : other.owner.seriesId === label.owner.seriesId))) return [];
    }
    // bridge step totals, split values and names remain readable when larger type loses its seat.
    const bridgeValue = ['waterfall', 'pvm', 'variance'].includes(geo.type ?? '') && BRIDGE_OWED_KINDS.has(label.kind);
    // named reference ticks, segment values and map codes carry data, too.
    const extraValue = (label.kind === 'tick' && label.owner.seriesId !== undefined
      || label.kind === 'segment' && ['funnel', 'mekko'].includes(geo.type ?? '')
      // A total carries data too (slope and funnel Net).
      || label.kind === 'total'
      || label.kind === 'category' && geo.type === 'choropleth');
    // The shared density ranker gates points and stack totals. Segment
    // layouts retain their own omission notes and must not get a second list.
    const densityValue = label.hidden === 'density' && ['point', 'grandTotal'].includes(label.kind);
    if (!OWED_KINDS.has(label.kind) && !bridgeValue && !extraValue && !densityValue && !label.owed && pins[label.id] === undefined) return [];
    if (label.noteText) return [[label.id, label.noteText] as const];
    if (label.kind === 'annotation') {
      // Match by the id the annotate pass gives (authored, else kind-index); name it by its label, else its authored id.
      const list = (Array.isArray(annotations) ? annotations : []) as Array<{ kind: AnnotationKind; id?: Id; label?: unknown; text?: unknown }>;
      const hit = list.find((item, i) => item !== null && typeof item === 'object' && defaultAnnotationId(item, i) === label.owner.annotationId);
      // Authored text is the label itself (its \${value} resolved in label.text), not a name for it.
      const a = hit && (typeof hit.label === 'string' ? hit.label : typeof hit.text === 'string' ? undefined : hit.id);
      // A drawn label in another case (a band name prints in capitals) is the same name: note the authored spelling once.
      const same = typeof a === 'string' && label.text.toLowerCase().includes(a.toLowerCase());
      return [[label.id, a && !same ? `${a} ${label.text}` : same && label.text.toLowerCase() === a.toLowerCase() ? a : label.text] as const];
    }
    if (label.kind === 'item') {
      const row = nameIn(rows, label.owner.categoryId);
      return [[label.id, `${label.text}${row ? ` (${row})` : ''}`] as const];
    }
    if ((bridgeValue || extraValue || label.kind === 'grandTotal') && label.kind !== 'category') {
      const name = nameIn(categories, label.owner.categoryId) ?? nameIn(items, label.owner.categoryId) ?? nameIn(rows, label.owner.categoryId)
        ?? geo.labels.find(candidate => candidate.kind === 'category' && candidate.owner.categoryId === label.owner.categoryId)?.text ?? label.owner.categoryId;
      const itemSegments = Array.isArray(items) ? items.flatMap(item => item?.segments ?? []) : [];
      const segment = nameBeforeValue(nameIn(series, label.owner.seriesId) ?? nameIn(cases, label.owner.seriesId)
        ?? nameIn(itemSegments, label.owner.segmentId) ?? label.owner.segmentId, label.text);
      // A tick's text can name its series already ('90 Plan').
      return [[label.id, `${segment && !label.text.includes(segment) ? `${segment} ` : ''}${label.text}${name ? ` (${name})` : ''}`] as const];
    }
    if (label.kind !== 'point') return [[label.id, label.text] as const];
    // A value is named by its series and category (never a bare value): a series
    // the data does not list (a Pareto's cumulative line) by its legend entry, a category by its item or row.
    const s = nameBeforeValue(nameIn(series, label.owner.seriesId) ?? legendName(label.owner.seriesId), label.text);
    const c = nameIn(categories, label.owner.categoryId) ?? nameIn(items, label.owner.categoryId) ?? nameIn(rows, label.owner.categoryId)
      ?? (densityValue ? geo.labels.find(candidate => candidate.kind === 'category' && candidate.owner.categoryId === label.owner.categoryId)?.text : undefined);
    // An authored text that names its series already is not prefixed twice ('Coverage Coverage 99.8').
    return [[label.id, `${s && !label.text.includes(s) ? `${s} ` : ''}${label.text}${c ? ` (${c})` : ''}`] as const];
  });
  const byData = dataOrder(data, geo.labels);
  return new Map(entries.sort(([a], [b]) => byData(a, b)));
}

/**
 * A panel label its own chart leaves out of the note: a value an authored
 * `labelDensity: 'minimal'` drops when it finds no seat. The grid that takes
 * the label in owes it nothing either, so a panel names what the same chart
 * drawn alone names.
 */
export const LEFT_OUT_OF_NOTE = Symbol();

/**
 * The note texts of a panel's hidden labels, by the panel's label id, named
 * with the panel's own data ("Platform conversion 0.12% (7 Sep)"). A grid's
 * data holds panels, not series and categories, so its note line could only
 * print the bare value; a grid sets these as `noteText` when it takes the
 * panel's labels in. Labels that carry a `noteText` already keep it.
 * `leftOut` holds the hidden labels the panel drawn alone would not name
 * (its authored 'minimal'); the grid marks them with LEFT_OUT_OF_NOTE.
 */
export function panelNoteTexts(
  geo: Parameters<typeof owedHiddenLabels>[0],
  data: unknown,
  options?: { labelPlacements?: unknown; annotations?: unknown; labelDensity?: unknown },
  annotations?: unknown,
): { texts: Map<Id, string>; leftOut: ReadonlySet<Id> } {
  const minimal = options?.labelDensity === 'minimal';
  if (!geo.labels.some((label) => label.hidden !== undefined && (minimal || !label.noteText))) return { texts: new Map(), leftOut: new Set() };
  const pins = (typeof options?.labelPlacements === 'object' && options.labelPlacements !== null ? options.labelPlacements : {}) as Record<string, unknown>;
  const notes = annotations ?? options?.annotations;
  const named = owedHiddenLabels({ ...geo, [DEFER_DENSITY_NOTES]: false }, data, pins, notes);
  const leftOut = new Set<Id>();
  if (minimal) {
    const kept = owedHiddenLabels({ ...geo, [DEFER_DENSITY_NOTES]: false }, data, pins, notes, true);
    for (const id of named.keys()) if (!kept.has(id)) { leftOut.add(id); named.delete(id); }
  }
  for (const label of geo.labels) if (label.noteText) named.delete(label.id);
  return { texts: named, leftOut };
}

/**
 * A series name as the note prints it before its value. A name that ends in
 * its unit ("Cost per acquisition, $", "Conversion (%)") drops that unit when
 * the value prints it already, so the note reads "Cost per acquisition $551",
 * not "Cost per acquisition, $ $551".
 */
function nameBeforeValue(name: string | undefined, value: string): string | undefined {
  if (name === undefined) return undefined;
  const match = /^(.*?\S)\s*(?:,\s*([^\s,()]{1,4})|\(\s*([^\s()]{1,4})\s*\)|\s([%$€£¥]))$/u.exec(name);
  const unit = match?.[2] ?? match?.[3] ?? match?.[4];
  if (!match || unit === undefined || /^\d/.test(unit)) return name;
  // The value's own symbols: "$551" prints "$", "$88k" prints "$k", "0.12%" prints "%".
  const symbols = value.replace(/[\d\s.,'’+\-−–]/gu, '');
  return value.includes(unit) || symbols === unit ? match[1] : name;
}

/**
 * Compares two label ids by the order the data lists their owners: series
 * first, then category, then (with the authored `annotations`) the annotation.
 * A label without a series or category in the data keeps its place (the sort
 * is stable). Every note and every reading lists labels in this order.
 */
export function dataOrder(data: unknown, labels: readonly PlacedLabel[], annotations?: unknown): (a: Id, b: Id) => number {
  // A gantt names its rows, a table-like chart its items: they order the note as categories do .
  // A treemap's groups own its items as series do: the note keeps the group structure.
  const { series: authoredSeries, groups, categories: authoredCategories, rows, items } = (data ?? {}) as { series?: unknown; groups?: unknown; categories?: unknown; rows?: unknown; items?: unknown };
  const series = Array.isArray(authoredSeries) ? authoredSeries : groups;
  const categories = Array.isArray(authoredCategories) ? authoredCategories : Array.isArray(rows) ? rows : items;
  const rankIn = (list: unknown): Map<unknown, number> => {
    const rank = new Map<unknown, number>();
    if (Array.isArray(list)) list.forEach((item, i) => {
      const id = typeof item === 'object' && item !== null ? (item as { id?: unknown }).id : item;
      if (!rank.has(id)) rank.set(id, i);
    });
    return rank;
  };
  const seriesRank = rankIn(series);
  const categoryRank = rankIn(categories);
  const annotationRank = new Map<unknown, number>();
  if (Array.isArray(annotations)) annotations.forEach((item, i) => {
    if (item !== null && typeof item === 'object') annotationRank.set(defaultAnnotationId(item as { kind: AnnotationKind; id?: Id }, i), i);
  });
  const owners = new Map(labels.map((label) => [label.id, label.owner]));
  const at = (id: Id, rank: Map<unknown, number>, key: 'seriesId' | 'categoryId' | 'annotationId') => rank.get(owners.get(id)?.[key]) ?? -1;
  return (a, b) => at(a, seriesRank, 'seriesId') - at(b, seriesRank, 'seriesId') || at(a, categoryRank, 'categoryId') - at(b, categoryRank, 'categoryId')
    || at(a, annotationRank, 'annotationId') - at(b, annotationRank, 'annotationId');
}

/**
 * Reserve density notes through the normal frame layout before returning a
 * measured chart. The first pass selects values without the density footer;
 * the second pass measures the merged note and keeps that value selection.
 */
export function withDensityNotes<O extends BaseOptions, M extends object, D extends object>(
  data: unknown, options: O, layout: (options: O) => LayoutResult<M, D>,
): LayoutResult<M, D> {
  const first = layout({ ...options, [VALUE_SELECTION]: true });
  if (first.refused || !(first as Geometry & { [DEFER_DENSITY_NOTES]?: boolean })[DEFER_DENSITY_NOTES]
    || (options as O & { [VALUE_SELECTION]?: boolean })[VALUE_SELECTION] || options.labelDensity === 'minimal' || panelTypeClass(options) !== undefined) return first;
  const labels = first.labels.map(label => ({ ...label, noted: undefined }));
  const owed = owedHiddenLabels({ ...first, labels, [DEFER_DENSITY_NOTES]: false }, data, options.labelPlacements, options.annotations);
  const density = new Map(labels.flatMap(label => label.hidden === 'density' && ['point', 'grandTotal'].includes(label.kind)
    && owed.has(label.id) ? [[label.id, owed.get(label.id)!] as const] : []));
  if (density.size === 0) return first;
  // Merge earlier collision notes and deferred density values before the one cap.
  for (const [id, text] of owed) density.set(id, text);
  const fixed = resolveTargetSize(options.target ?? 'report', options.size).fixed.height;
  const visible = new Set(first.labels.filter(label => !label.hidden && ['point', 'grandTotal'].includes(label.kind)).map(label => label.id));
  // A taller automatic footer can also displace values; keep the selected chart in that case.
  const misfit = (run: LayoutResult<M, D>) => run.refused ? fixed : run.labels.some(label => visible.has(label.id) && label.hidden);
  const run = (from: O, values = density) => {
    const planned = withHiddenLabelNote(withLocaleStrings(from), values, { data, labels: first.labels, annotations: options.annotations });
    return { planned, next: layout({ ...planned, ...((first as Geometry & { [DENSITY_LAYOUT_OPTIONS]?: object })[DENSITY_LAYOUT_OPTIONS] ?? {}), [DENSITY_VALUES]: new Set(values.keys()) }) };
  };
  let from = options;
  let { planned, next } = run(from);
  // A pinned height is a promise to the host: a two-line note that still displaces values there
  // counts instead (one line), else the static footer would grow the canvas. An authored cap stays.
  if (fixed && options.notes?.maxListed === undefined && misfit(next)) {
    const countedFrom = { ...options, notes: { ...options.notes, maxListed: 0 } };
    const counted = run(countedFrom);
    if (!counted.next.refused) ({ planned, next, from } = { ...counted, from: countedFrom });
  }
  // A value the note's own line displaces in a pinned frame joins the note
  // (named or counted), or it would be dropped without a trace (pareto at 320 px on a dashboard).
  for (let pass = 0; fixed && !next.refused && pass < 3; pass++) {
    const shown = next;
    const owedNext = owedHiddenLabels({ ...shown, labels: shown.labels.map(label => ({ ...label, noted: undefined })), [DEFER_DENSITY_NOTES]: false },
      data, options.labelPlacements, options.annotations);
    const more = shown.labels.filter(label => label.hidden === 'density' && ['point', 'grandTotal'].includes(label.kind)
      && !density.has(label.id) && owedNext.has(label.id));
    if (more.length === 0) break;
    // The values join the note only when the layout that names them draws; a refused run keeps the last note.
    const wider = new Map(density);
    for (const label of more) wider.set(label.id, owedNext.get(label.id)!);
    const again = run(from, wider);
    if (again.next.refused) break;
    for (const label of more) density.set(label.id, wider.get(label.id)!);
    ({ planned, next } = again);
  }
  // A fixed frame keeps the fitted count note even if it moves another value into the note.
  // Returning the earlier selection here would add its note outside the frame and grow the canvas.
  if (!fixed && misfit(next)) {
    return densityNoteInList(first, planned, new Set(density.keys()));
  }
  if (!next.refused) {
    for (const label of next.labels) if (density.has(label.id)) { label.noted = undefined; label.noteCounted = undefined; }
    markNotedLabels(next, new Set(density.keys()), planned);
  } else if (fixed && next.warnings[0]?.code === 'size-below-floor') UNVERIFIED_DENSITY_REFUSALS.add(next.warnings[0]);
  return next;
}

/** Keep an omission explicit when its note cannot fit without displacing values. */
export function densityNoteInList<M extends object, D extends object>(first: Geometry<M, D>, planned: BaseOptions, ids: ReadonlySet<Id>): Geometry<M, D> {
  const line = (planned as BaseOptions & { [NOTE_LINE]: string })[NOTE_LINE];
  const heading = planned.strings?.hiddenLabels ?? HIDDEN_LABEL_LEAD;
  const prior = (text: string) => text.replace(/\s/g, '').startsWith(`${heading}:`.replace(/\s/g, ''));
  const priorIds = new Set(first.scene.flatMap(node => node.t === 'text' && first.frame.footnoteNodeIds?.includes(node.id) && prior(node.lines.join(' ')) ? [node.id] : []));
  first.scene = first.scene.filter(node => !priorIds.has(node.id));
  first.frame.footnoteNodeIds = first.frame.footnoteNodeIds?.filter(id => !priorIds.has(id));
  first.frame.notes = [...(first.frame.notes ?? []).filter(text => !prior(text)), line];
  const entries = (first.frame.noteList ?? []).filter(entry => !prior(entry.text));
  const at = entries.findIndex(entry => entry.kind !== 'note');
  entries.splice(at < 0 ? entries.length : at, 0, keepNoteMeta({ n: 0, kind: 'disclosure', text: line, inFrame: false }, engineNoteMeta(line)));
  first.frame.noteList = entries.map((entry, i) => copyNote(entry, { n: i + 1 }));
  first.a11y.desc += ` ${line}`;
  first.warnings.push({ code: 'compact-notes-omitted', severity: 'info', message: `the frame leaves this note in the notes list and accessible description: ${line}` });
  for (const label of first.labels) if (ids.has(label.id)) { label.noted = undefined; label.noteCounted = undefined; }
  markNotedLabels(first, ids, planned);
  return first;
}

/** The ids of the labels the note line names, for a layout that would print one elsewhere too (a bump value in its name). */
export const NOTED_LABELS = Symbol('notedLabels');

/** One item of the hidden-label note: its text and the label it names (for the order). */
interface NoteItem { text: string; label?: Pick<PlacedLabel, 'id' | 'owner' | 'kind' | 'priority'> }
/** Every item the options carry so far, and the note line they produced, so the next producer replaces it. */
const NOTE_ITEMS = Symbol('noteItems');
const NOTE_LINE = Symbol('noteLine');
/** The data and authored annotations the order of the items follows. */
const NOTE_CONTEXT = Symbol('noteContext');
/** Which noted ids the note line leaves to its count ("and 236 more"). */
const NOTE_COUNTED = Symbol('noteCounted');

/** What the note needs to order its items: the data, the authored annotations and the labels the ids name. */
interface NoteContext { data: unknown; labels: readonly PlacedLabel[]; annotations?: unknown }

/**
 * A reference line, an authored annotation, a series name or a line end value
 * leads the note: the chart's message is usually about them, and a long list
 * of column values must not push them off it.
 */
function leadsNote(item: NoteItem): boolean {
  const label = item.label;
  return label !== undefined && (['valueLine', 'annotation', 'series'].includes(label.kind) || label.kind === 'point' && label.priority >= PRIORITY.endpoint);
}

/**
 * The options for the next run: ONE note naming every item noted so far, the
 * ones in `noted` (label id to item) and the ones an earlier producer on the
 * same options left (the registry's owed labels and the band's collision
 * values share the note). It replaces the note line that producer wrote, so
 * a chart never carries two. Unnumbered, since no mark points at it.
 *
 * Order: leads first (see `leadsNote`), then series, category and annotation
 * order of the data. It names the first `noteCap` items (default 8, an
 * author-set `notes.maxListed` wins) and counts the rest; the ids it counts
 * travel under NOTE_COUNTED for markNotedLabels.
 * The ids of all items travel under NOTED_LABELS.
 */
export function withHiddenLabelNote<T extends object>(options: T, noted: ReadonlyMap<Id, string>, context: NoteContext): T {
  const own = options as T & Pick<BaseOptions, 'footnotes'> & InternalFootnoteOptions & NoteCapOptions
    & { [NOTE_ITEMS]?: ReadonlyMap<Id, NoteItem>; [NOTE_LINE]?: string; [NOTE_CONTEXT]?: { kindCounts?: Record<string, number> } };
  const byId = new Map(context.labels.map((label) => [label.id, label]));
  const items = new Map(own[NOTE_ITEMS]);
  // Only the fields the note reads: a label's rect would make equal notes at two heights unequal layout inputs.
  const picked = (label: PlacedLabel | undefined): NoteItem['label'] => label && { id: label.id, owner: label.owner, kind: label.kind, priority: label.priority };
  for (const [id, text] of noted) items.set(id, { text, label: picked(byId.get(id)) ?? items.get(id)?.label });
  const kindCounts = labelKindCounts(context.labels, own[NOTE_CONTEXT]?.kindCounts);
  const plan = planNote(items, { ...context, kindCounts }, own);
  const others = authoredNotes(own).filter((note) => note !== own[NOTE_LINE]);
  return {
    ...withAuthoredFootnotes(own, [...others, ...(plan.line ? [plan.line] : [])], own.authoredFootnotes ?? authoredNotes(own)),
    [NOTED_LABELS]: new Set(items.keys()),
    [NOTE_ITEMS]: items,
    [NOTE_CONTEXT]: { data: context.data, annotations: context.annotations, kindCounts },
    [NOTE_LINE]: plan.line,
    [NOTE_COUNTED]: plan.counted,
  };
}

/**
 * The hidden-label note line. Compact framing keeps it on the
 * canvas: whatever the chart could not draw (an annotation, a value, a name)
 * is named where the reader looks, not only in the accessible description.
 */
export function hiddenNoteLine(options: object): string | undefined {
  const own = options as { [NOTE_ITEMS]?: ReadonlyMap<Id, NoteItem>; [NOTE_LINE]?: string; [NOTE_TO_A11Y]?: true };
  const line = own[NOTE_LINE];
  if (!line || !own[NOTE_TO_A11Y]) return line || undefined;
  // A card too short for the line keeps only an undrawn annotation's note; the rest is in the description.
  return own[NOTE_ITEMS] && [...own[NOTE_ITEMS].values()].some((item) => (item.label?.kind === 'annotation' || item.label?.kind === 'valueLine')
    && item.label.owner.annotationId !== undefined) ? line : undefined;
}

const NOTE_TO_A11Y = Symbol('noteToA11y');
/**
 * The options again with the hidden-label note moved to the accessible
 * description on a compact card, for the card that has no room for its line.
 * Undefined when that changes nothing (the line is kept anyway).
 */
export function withNoteInA11y<T extends object>(options: T): T | undefined {
  const marked = { ...options, [NOTE_TO_A11Y]: true as const };
  return hiddenNoteLine(options) !== undefined && hiddenNoteLine(marked) === undefined ? marked : undefined;
}

/** Whether `needle` stands whole in `hay`: no letter, digit or sign joins it ('1%' is not in '11%' or '-1%', '1' is not in '1.5'). */
function holdsToken(hay: string | undefined, needle: string): boolean {
  for (let at = needle ? hay?.indexOf(needle) ?? -1 : -1; hay !== undefined && at >= 0; at = hay.indexOf(needle, at + 1)) {
    const after = hay.slice(at + needle.length);
    if (!/[\p{L}\p{N}.,+\-−]$/u.test(hay.slice(0, at)) && !/^([\p{L}\p{N}]|[.,]\p{N})/u.test(after)) return true;
  }
  return false;
}


/** Label kinds that hold values: under `notes.maxListed: 0` the note counts them instead of naming them. */
const COUNTED_KINDS = new Set(['point', 'segment', 'total', 'grandTotal']);

/** How many labels of each kind the chart carries, the total a counted note line names ("18 of 36 values"). An earlier producer's count of a kind stays when it is larger. */
function labelKindCounts(labels: readonly PlacedLabel[], prior?: Record<string, number>): Record<string, number> {
  const counts: Record<string, number> = { ...prior };
  const own: Record<string, number> = {};
  for (const label of labels) own[label.kind] = (own[label.kind] ?? 0) + 1;
  for (const [kind, n] of Object.entries(own)) counts[kind] = Math.max(counts[kind] ?? 0, n);
  return counts;
}

/** The numbers in the data's series, a grid's panels summed; undefined for data of another shape. */
function heldValues(data: unknown): number | undefined {
  const { series, panels } = (data ?? {}) as { series?: { values?: unknown[] }[]; panels?: { data?: unknown }[] };
  // A panel of another shape makes the sum NaN, read as unknown.
  const sum = Array.isArray(panels) ? panels.reduce((n, panel) => n + (heldValues(panel?.data) ?? NaN), 0)
    : series?.reduce((n, item) => n + (item?.values?.filter((cell) => cell != null && (cell as { number?: unknown }).number !== null).length ?? 0), 0);
  return sum || undefined;
}

/** The note line for the items, the ids it only counts, in the order and under the cap described at `withHiddenLabelNote`. */
function planNote(items: ReadonlyMap<Id, NoteItem>, context: { data: unknown; annotations?: unknown; kindCounts?: Record<string, number> }, cap: NoteCapOptions): { line: string | undefined; counted: Set<Id> } {
  const known = [...items.values()].flatMap((item) => (item.label ? [item.label as PlacedLabel] : []));
  const byData = dataOrder(context.data, known, context.annotations);
  // One mark is named once: an item whose text another item of the same
  // owner holds in full ('780' in 'Marketplaces 780') takes that item's text, and the set below drops the repeat.
  const ownerKey = (item: NoteItem): string | undefined => item.label?.owner.annotationId === undefined && (item.label?.owner.seriesId !== undefined || item.label?.owner.categoryId !== undefined)
    ? `${item.label!.owner.seriesId ?? ''}|${item.label!.owner.categoryId ?? ''}` : undefined;
  const byOwner = new Map<string, NoteItem[]>();
  for (const item of items.values()) {
    const key = ownerKey(item);
    if (key === undefined) continue;
    const group = byOwner.get(key);
    if (group) group.push(item); else byOwner.set(key, [item]);
  }
  const merged = [...items].map(([id, item]): [Id, NoteItem] => {
    const key = ownerKey(item);
    const cover = key === undefined ? undefined : byOwner.get(key)!.find((other) => other !== item && other.label?.kind !== item.label?.kind && other.text.length > item.text.length && holdsToken(other.text, item.text));
    return [id, cover ? { ...item, text: cover.text, label: cover.label } : item];
  });
  const ranked = merged.sort(([a, x], [b, y]) => Number(leadsNote(y)) - Number(leadsNote(x)) || byData(a, b));
  // A diagram's secondary text is the author's description, not a value: it is named in full.
  const described = new Set(ranked.filter(([, item]) => (item.label?.kind as string | undefined) === 'diagramSecondary').map(([, item]) => item.text));
  const texts = [...new Set(ranked.map(([, item]) => item.text))];
  const listed = new Set(texts.filter((text) => described.has(text)));
  // the note names its first noteCap items (default 8) in this order, then
  // "and N more". Under notes.maxListed: 0 it names only the leads (reference lines, annotations,
  // series names, end values) and counts the values against all values of their kinds, "18 of 36
  // values"; names (categories, regions, points a chart lists without a label) are counted alone.
  const countOnly = cap.notes?.maxListed === 0;
  const values = ranked.filter(([, item]) => !leadsNote(item) && !described.has(item.text));
  const valueKinds = new Set(values.map(([, item]) => item.label?.kind as string | undefined));
  const countable = context.kindCounts !== undefined && ![...valueKinds].some((kind) => kind === undefined || !COUNTED_KINDS.has(kind));
  // against all values the data holds, when the data says, not only the values a label stands for.
  const held = countable ? heldValues(context.data) : undefined;
  const allValues = !countable ? undefined : held ?? [...valueKinds].reduce((sum, kind) => sum + (context.kindCounts![kind!] ?? 0), 0);
  const total = countOnly ? allValues : undefined;
  const countValues = total !== undefined && total >= new Set(values.map(([, item]) => item.text)).size;
  if (countValues) { for (const [, item] of ranked) if (leadsNote(item)) listed.add(item.text); }
  else { const limit = noteCap(cap, texts.length - described.size); for (const text of texts) if (listed.size - described.size < limit) listed.add(text); }
  const counted = new Set(ranked.filter(([, item]) => !listed.has(item.text)).map(([id]) => id));
  const rest = texts.length - listed.size;
  // Counted, too: the values no label stands for at all (most line points), held beyond the value labels.
  const unlabelled = rest + Math.max(0, (held ?? 0) - [...COUNTED_KINDS].reduce((sum, kind) => sum + (context.kindCounts?.[kind] ?? 0), 0));
  const tail = counted.size === 0 ? [] : countValues ? [countedValuesText(unlabelled, total!, cap)] : [moreListedText(rest, cap, listed.size === 0)];
  const lead = (cap as BaseOptions).strings?.hiddenLabels ?? HIDDEN_LABEL_LEAD;
  const line = noteLine(lead, [...texts.filter((text) => listed.has(text)), ...tail])[0];
  if (line && !countOnly && !countValues && described.size === 0 && cap.notes?.maxListed === undefined) engineNote(line, 'disclosure', undefined, undefined, { lead, items: texts, total: values.length === ranked.length ? allValues : undefined, options: cap });
  return { line, counted };
}

/**
 * A chart type that lists names of its own (scatter) puts them in the same
 * note: the line over the registry's items and `extras` (id and text, in the
 * order to list them), and the footnotes without the line the registry wrote.
 * `counted` holds the ids the cap leaves to its count. The caller marks the
 * labels it names with `markNotedLabels`.
 */
export function hiddenNoteWith(options: object, extras: readonly { id: Id; text: string }[]): { footnotes: string[]; line: string[]; ids: Set<Id>; counted: ReadonlySet<Id> } {
  const own = options as Pick<BaseOptions, 'footnotes'> & NoteCapOptions
    & { [NOTE_ITEMS]?: ReadonlyMap<Id, NoteItem>; [NOTE_LINE]?: string; [NOTE_CONTEXT]?: { data: unknown; annotations?: unknown; kindCounts?: Record<string, number> } };
  const items = new Map(own[NOTE_ITEMS]);
  for (const { id, text } of extras) items.set(id, { text });
  const plan = planNote(items, own[NOTE_CONTEXT] ?? { data: undefined }, own);
  return { footnotes: authoredNotes(own).filter((note) => note !== own[NOTE_LINE]), line: plan.line ? [plan.line] : [], ids: new Set(items.keys()), counted: plan.counted };
}

/**
 * After a run that was handed the note: when the note reached the page (a
 * drawn note, `frame.notes` with the block off, or the compact notes), each
 * label it names is marked `noted`, and one the run placed after all (the
 * note moved the plot) is taken off the drawing, so the note never says a
 * drawn label is missing. A run that dropped the note marks nothing. A label
 * the note only counts ("and 236 more") is marked the same way, with a
 * location that says so; the reading's omissions keep it. A label an inner
 * producer has marked already keeps its mark.
 */
export function markNotedLabels(
  geo: { labels: PlacedLabel[]; scene: SceneNode[]; frame: FrameGeometry; a11y: { compactNotes?: string[] } },
  noted: ReadonlySet<Id>,
  /** The options the run was given, or the ids its note only counts. */
  from?: object | ReadonlySet<Id>,
): void {
  const ids = new Set(geo.frame.footnoteNodeIds ?? []);
  const notes = [
    ...geo.scene.flatMap((node) => (node.t === 'text' && ids.has(node.id) ? [node.lines.join(' ')] : [])),
    ...(geo.frame.notes ?? []),
    ...(geo.a11y.compactNotes ?? []),
  ];
  // A narrow note wraps inside a word, so lines joined with spaces are compared without spaces.
  const heading = (from as BaseOptions | undefined)?.strings?.hiddenLabels ?? HIDDEN_LABEL_LEAD;
  const leads = (text: string) => text.replace(/\s+/g, '').includes(`${heading}:`.replace(/\s+/g, ''));
  const destination = notes.find(leads);
  if (!destination) return;
  const own = from instanceof Set ? undefined : from as { [NOTE_COUNTED]?: ReadonlySet<Id>; [NOTE_ITEMS]?: ReadonlyMap<Id, NoteItem>; [NOTE_LINE]?: string } | undefined;
  // The drawn note is the one source: the frame names as many items as fit two lines, so an
  // item it leaves to "and N more" is counted, also when the planned line named it.
  const list = own?.[NOTE_LINE] ? engineNoteMeta(own[NOTE_LINE])?.list : undefined;
  const named = list && own?.[NOTE_ITEMS] ? namedInDrawnNote(list, destination) : undefined;
  const listed = named === undefined ? undefined : new Set(list!.items.slice(0, named));
  const counted = from instanceof Set ? from as ReadonlySet<Id>
    : listed ? new Set([...own![NOTE_ITEMS]!].filter(([, item]) => !listed.has(item.text)).map(([id]) => id)) : own?.[NOTE_COUNTED];
  const gone = new Set<Id>();
  for (const label of geo.labels) {
    if (!noted.has(label.id) || label.noted) continue;
    if (!label.hidden) {
      label.hidden = 'note';
      for (const id of [`label:${label.id}`, `label:${label.id}:body`, `leader:${label.id}`, `swatch:${label.id}`]) gone.add(id);
    }
    label.noted = true;
    // The reader-facing name the note gives it ("Elo 1,563 (Orion)"), for the omission lists.
    label.noteText ??= own?.[NOTE_ITEMS]?.get(label.id)?.text;
    if (counted?.has(label.id)) label.noteCounted = true;
    const node = geo.scene.find(node => node.t === 'text' && ids.has(node.id) && leads(node.lines.join(' ')));
    const note = geo.frame.noteList?.find(note => leads(note.text));
    label.noteLocation = chartString(from as BaseOptions | undefined, node && note
      ? counted?.has(label.id) ? 'countedInNote' : 'listedInNote'
      : counted?.has(label.id) ? 'countedInNotes' : 'listedInNotes', { n: note?.n ?? 1 });
  }
  if (gone.size > 0) geo.scene = geo.scene.filter((node) => !gone.has(node.id));
}

/** The drawing prints no `options.unit` although the author declared one (the test `unit-not-shown` and the unit line share). */
export function unitMissing(
  options: Record<string, unknown> | undefined,
  geo: { type?: string; scene: readonly SceneNode[]; warnings: readonly LintWarning[] },
): boolean {
  const unit = typeof options?.unit === 'string' ? options.unit.trim() : '';
  if (!unit || options?.unitShown === true || geo.warnings.some((w) => w.severity === 'error')) return false;
  // A relative variance prints its differences in % on purpose; the unit is the base's, not the drawing's.
  if (geo.type === 'variance' && (options as { variant?: string } | undefined)?.variant === 'relative') return false;
  const subtitle = resolveSubtitle(options?.subtitle as BaseOptions['subtitle']);
  if (subtitle && subtitleUnitClause(unit, subtitle.measure) === '') return false;
  if (!squeezeUnit(unit)) return false;
  // A wrapped subtitle splits "in % of revenue" over two lines: read it joined.
  const subtitleText = geo.scene.flatMap((node) => (node.t === 'text' && node.id.startsWith('frame:subtitle') ? node.lines : [])).join(' ');
  const carriesUnit = geo.type === 'cohort' ? textCarriesCohortUnit : textCarriesUnit;
  return !carriesUnit(subtitleText, unit) && !geo.scene.some((node) => node.t === 'text' && carriesUnit(node.lines.join(' '), unit));
}

/** A unit that says percent: "%", "% of revenue", "percent", "per cent", "pct", "percentage". */
const PERCENT_UNIT = /^(?:%|percent|per\s*cent|pct|percentage)(?!\p{L})/iu;

/**
 * `share-unit-conflict`: a computed-share variant (stacked100,
 * stacked100-area) plots % and its axis says %, but a subtitle that prints a unit
 * clause such as "in TWh" names the raw values. When the engine composed the
 * clause from options.unit, the fix removes options.unit and with it the
 * clause. An authored clause ("Generation in TWh", "Generation (TWh)") stays
 * the author's: the warning asks for a subtitle edit and offers no fix. A
 * measure that names the unit as its base ("Share of generation from 100
 * TWh of output") is no unit clause and does not warn.
 */
export function shareUnitLints(
  options: Record<string, unknown> | undefined,
  geo: { scene: readonly SceneNode[]; warnings: readonly LintWarning[] },
): LintWarning[] {
  const unit = typeof options?.unit === 'string' ? options.unit.trim() : '';
  if (!unit || PERCENT_UNIT.test(unit) || !['stacked100', 'stacked100-area'].includes(options?.variant as string)) return [];
  if (geo.warnings.some((w) => w.severity === 'error')) return [];
  const measure = resolveSubtitle(options?.subtitle as BaseOptions['subtitle'])?.measure ?? '';
  const subtitleText = geo.scene.flatMap((node) => (node.t === 'text' && node.id.startsWith('frame:subtitle') ? node.lines : [])).join(' ');
  if (!measure || !textCarriesUnit(subtitleText, unit)) return [];
  const composed = subtitleUnitClause(unit, measure) !== '';
  const escaped = unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const authored = !composed && new RegExp(`(?:\\bin|,|\\()\\s*${escaped}\\s*\\)?\\s*$`, 'iu').test(measure);
  if (!composed && !authored) return [];
  return [{
    code: 'share-unit-conflict',
    severity: 'warn',
    message: `variant '${options!.variant}' plots shares in %, but the subtitle names the unit '${unit}' of the raw values`,
    suggest: composed
      ? `remove options.unit, or name the base in the measure (subtitle: { measure: 'Share of generation' })`
      : `remove the unit clause from the subtitle measure '${measure}', or name the base instead ('Share of generation')`,
    field: composed ? ['options', 'unit'] : ['options', 'subtitle'],
    ...(composed ? { fix: [{ op: 'remove' as const, path: '/options/unit' }] } : {}),
  }];
}

/** The codes a sign prints for: "€1.2m" carries EUR, "12%" carries percent. Whole words only ("Europe" is no EUR). */
const UNIT_SIGNS: readonly [RegExp, string][] = [
  [/\b(?:EUR|euros?)\b/gi, '€'], [/\bUSD\b/gi, '$'], [/\bGBP\b/gi, '£'], [/\bJPY\b/gi, '¥'], [/\b(?:percent|pct)\b/gi, '%'],
];
const signedUnit = (text: string) => squeezeUnit(UNIT_SIGNS.reduce((out, [code, sign]) => out.replace(code, sign), text));

/**
 * Whether a printed text already carries `unit`: the unit lint and
 * the kpi card's own unit share this test, so neither prints or asks for a
 * unit the other counts as shown.
 */
export function textCarriesUnit(text: string, unit: string): boolean {
  const needle = signedUnit(unit);
  if (needle === '') return false;
  // A unit of up to two letters ("m", "k", "h", "€m", "%") must stand alone:
  // no letter on either side ("€12m", "(m)", "4.2h"), so "Monthly" carries no
  // m and "CA$" is not USD. A longer unit may sit inside a phrase.
  if (needle.replace(/[^\p{L}]/gu, '').length > 2) return signedUnit(text).includes(needle);
  const between = String.raw`[\d\s.,'’+\-−]*`;
  const pattern = [...needle].map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(between);
  return new RegExp(String.raw`(?<!\p{L})${pattern}(?!\p{L})`, 'iu').test(UNIT_SIGNS.reduce((out, [code, sign]) => out.replace(code, sign), text));
}

/** Cohort headers and unit warnings accept the same authored percent words. */
export function textCarriesCohortUnit(text: string, unit: string): boolean {
  const words = /\b(?:percentages?|per\s+cent|prozent)\b/gi;
  return textCarriesUnit(text.replace(words, 'percent').replace(/×/g, 'x'), unit.replace(words, 'percent').replace(/×/g, 'x'));
}

/** Every string inside an option value (a subtitle object, a footnote list), in order. */
export function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  return value !== null && typeof value === 'object' ? Object.values(value).flatMap(stringsIn) : [];
}

/** A text with digits, spaces, number separators and case squeezed out: "$120m" carries "$m", "Leads" carries "leads". */
function squeezeUnit(text: string): string {
  return text.replace(/[\d\s.,'’+\-−]/g, '').toLowerCase();
}

type TextNode = Extract<SceneNode, { t: 'text' }>;

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
function measureUnitTail(measure: string, unit: string | undefined): string {
  const at = measure.lastIndexOf(', ');
  if (at <= 0) return '';
  const tail = measure.slice(at + 2);
  const reads = /^(%|in\s|per\s|[$€£¥]|(?:EUR|USD|CHF|GBP|JPY|US\$)(?![\p{L}])|index\b|score\b|share of\b|# )/iu.test(tail)
    || (unit !== undefined && unit.trim() !== '' && tail.trim().toLowerCase() === unit.trim().toLowerCase());
  // The comma stays with the bold part, so a wrapped line never starts with it.
  return reads ? measure.slice(at + 1) : '';
}

function measureSubtitle(
  input: FrameInput, x: number, y: number, id: Id, nextId: () => Id, contentW: number,
): { nodes: TextNode[]; rect: Rect } {
  const sub = input.subtitle!;
  const font = { family: input.theme.type.family, ...input.theme.type.subtitle };
  const boldFont: FontSpec = { ...font, weight: emphasisWeight(input.theme) };
  // Three runs max: everything before the measure, the bold measure, and
  // one merged trailing segment — all inside a single text node below.
  let trailing = '';
  if (frameRendersUnit(input)) trailing += subtitleUnitClause(input.unit!, sub.measure);
  if (sub.period) trailing += ` · ${sub.period}`;
  if (sub.scenarios && sub.scenarios.length > 0) trailing += ` · ${formatScenarios(sub.scenarios)}`;
  const segments: { text: string; bold: boolean }[] = [];
  if (sub.company) segments.push({ text: `${sub.company} · `, bold: false });
  // Only the measure is bold. A measure that names its own unit after a comma
  // ("Orders by delivery speed, % of all orders") keeps the unit regular, as
  // the frame's own " in <unit>" clause is.
  const unitTail = measureUnitTail(sub.measure, input.unit);
  // A subtitle that is the measure alone has no measure run to set apart: it
  // prints regular.
  const lone = !sub.company && !unitTail && !trailing;
  segments.push({ text: sub.measure.slice(0, sub.measure.length - unitTail.length), bold: !lone });
  if (unitTail || trailing) segments.push({ text: unitTail + trailing, bold: false });
  const lineH = font.size * (font.lineHeight ?? 1.3);
  // ONE text node with styled runs. One <text> per segment, each positioned
  // at the summed MEASURED widths of its predecessors, prints the width
  // model's error into the visible joins: a bold measure rendering wider than
  // measured (SF Pro leading the theme family) runs into "in <unit>", and the
  // model's deliberate generosity doubles the separator gap even under the
  // calibrated class. Inside one <text>, the font engine
  // owns the intra-line advance — the joins are exact in every font, the
  // same way they are inside any multi-word label. Boundary spaces stay
  // non-breaking (xml:space default trims text-content edges), and U+00A0
  // measures in the SPACE class (see estimateTextWidth).
  const runs = segments.map((seg) => ({
    text: seg.text.replace(/^ /, '\u00A0').replace(/ $/, '\u00A0'),
    ...(seg.bold ? { weight: boldFont.weight } : {}),
  }));
  const width = runsWidth(runs, font, boldFont, input.measure);
  // A composed line wider than the frame wraps to a second line, and
  // a second line that still overflows ends with an ellipsis and carries the
  // full text as its <title>. The subtitle never shrinks.
  // The subtitle wraps until every word shows.
  const maxLines = Infinity;
  const scenarios = sub.scenarios && sub.scenarios.length > 0 ? formatScenarios(sub.scenarios) : undefined;
  if (width > contentW) return wrapSubtitle(segments, { x, y, id, nextId, contentW, lineH, font, boldFont, measure: input.measure, maxLines, scenarios, period: sub.period });
  const node: TextNode = {
    t: 'text',
    id,
    x,
    y,
    lines: [runs.map((run) => run.text).join('')],
    runs,
    align: 'start',
    font,
    ink: { token: 'ink' },
    owner: {},
    part: 'subtitle',
    typeRole: 'subtitle',
  };
  return { nodes: [node], rect: { x, y, w: width, h: lineH } };
}

type SubtitleRun = { text: string; weight?: number };

function runsWidth(runs: readonly SubtitleRun[], font: FontSpec, boldFont: FontSpec, measure: TextMeasurer): number {
  return (
    runs.reduce((w, run) => w + measure(run.text, run.weight ? boldFont : font).width, 0) +
    // measure() counts n−1 tracking gaps WITHIN each run; the renderer
    // tracks the continuous line, which adds one more gap per run boundary.
    // The subtitle font ships without tracking today — this keeps the
    // occupied claim honest the day a theme adds letterSpacing to it.
    (font.letterSpacing ? font.letterSpacing * (runs.length - 1) : 0)
  );
}

/** Words with their weight, rejoined into styled runs; the space before a new run stays U+00A0. */
function runsOf(words: readonly { text: string; bold: boolean }[], boldWeight: number): SubtitleRun[] {
  const runs: SubtitleRun[] = [];
  words.forEach((word, i) => {
    if (i > 0 && words[i - 1]!.bold === word.bold) runs[runs.length - 1]!.text += ` ${word.text}`;
    else runs.push({ text: i > 0 ? `\u00A0${word.text}` : word.text, ...(word.bold ? { weight: boldWeight } : {}) });
  });
  return runs;
}

/**
 * A wrapped title keeps its line count. Two lines take the break
 * with the shortest longest line, the first line not shorter than the last,
 * so two-line titles balance. Three lines take the break with
 * the least ragged right edge on the lines before the last, so they fill the
 * header width (butterfly 320 px). Four lines and more
 * keep their greedy lines. No single word sits alone on the last line of a
 * title of four words or more. 'p.a.' stays with its rate ('5.6% p.a.').
 * Words are never split; a title with an authored line break or a cut line
 * keeps its own lines.
 */
function balancedLines(text: string, font: FontSpec, maxWidth: number, lines: readonly string[], measure: TextMeasurer): string[] {
  const filled = filledLines(text, font, maxWidth, lines, measure);
  const own = text.includes('\n') || lines.some((line) => line.endsWith('…'))
    || lines.join(' ').split(/[^\S\u00a0\u202f]+/).filter(Boolean).join(' ') !== text.split(/[^\S\u00a0\u202f]+/).filter(Boolean).join(' ');
  if (own || filled.length < 2 || filled.length > 3) return filled;
  const units = filled.join(' ').split(' ').reduce<string[]>((out, word) => {
    if (out.length > 0 && /^p\.a\.[,;:]?$/i.test(word)) out[out.length - 1] += ` ${word}`; else out.push(word);
    return out;
  }, []);
  if (units.length > 40) return filled;
  const n = filled.length;
  let best: { cost: number; lines: string[] } | undefined;
  const consider = (cuts: number[]) => {
    const bounds = [0, ...cuts, units.length];
    const parts = bounds.slice(1).map((to, i) => units.slice(bounds[i]!, to).join(' '));
    const widths = parts.map((part) => measure(part, font).width);
    if (widths.some((w) => w > maxWidth)) return;
    if (units.length >= 4 && units.length - bounds[bounds.length - 2]! < 2) return;
    const widest = Math.max(...widths);
    const cost = n === 2
      ? widest + 0.25 * Math.max(0, widths[1]! - widths[0]!)
      : widths.slice(0, -1).reduce((sum, w) => sum + (widest - w) ** 2, 0);
    if (!best || cost < best.cost - 1e-9) best = { cost, lines: parts };
  };
  if (n === 2) for (let a = 1; a < units.length; a++) consider([a]);
  else for (let a = 1; a < units.length - 1; a++) for (let b = a + 1; b < units.length; b++) consider([a, b]);
  return best?.lines ?? filled;
}

/** Greedy title lines; a single word alone on the last line pulls one word down. */
function filledLines(text: string, font: FontSpec, maxWidth: number, lines: readonly string[], measure: TextMeasurer): string[] {
  if (text.includes('\n') || lines.some((line) => line.endsWith('…')) || lines.length < 2) return [...lines];
  const split = (line: string) => line.split(/[^\S\u00a0\u202f]+/).filter(Boolean);
  const words = split(text);
  if (lines.flatMap(split).join(' ') !== words.join(' ')) return [...lines];
  // 'p.a.' is one unit with its rate.
  const units = (line: string) => split(line).reduce<string[]>((out, word) => {
    if (out.length > 0 && /^p\.a\.[,;:]?$/i.test(word)) out[out.length - 1] += ` ${word}`; else out.push(word);
    return out;
  }, []);
  const out = lines.map(units);
  // A 'p.a.' greedy-wrapped away from its rate rejoins it on the line below.
  for (let i = 1; i < out.length; i++) {
    if (/^p\.a\.[,;:]?$/i.test(out[i]![0] ?? '') && out[i - 1]!.length > 1) {
      const rate = out[i - 1]!.pop()!;
      out[i]![0] = `${rate} ${out[i]![0]}`;
    }
  }
  const last = out[out.length - 1]!;
  const before = out[out.length - 2]!;
  if (last.length === 1 && before.length >= 2) {
    const moved = before[before.length - 1]!;
    if (measure(`${moved} ${last[0]}`, font).width <= maxWidth) {
      before.pop();
      last.unshift(moved);
    }
  }
  const joined = out.map((line) => line.join(' '));
  return joined.every((line) => line.length > 0 && measure(line, font).width <= maxWidth) ? joined : [...lines];
}

/**
 * No single word sits alone on the last line of a wrapped subtitle, as on the
 * titles: "... · FY25" / "AC" becomes
 * "..." / "FY25 · AC". A short scenario pair ("AC vs FC") and a short period
 * ("FY26 YTD") count as one word.
 * The break moves left, to the nearest part boundary first (a '·', or where
 * the bold measure meets its unit), then to a word that does not bind to the
 * next ('in', 'of', '$'), then to any word. A '·' at the new break is
 * dropped, as at every break. The line count stays, and nothing moves when no
 * break fits.
 */
function keepLastLineCompany<W extends { text: string; bold: boolean }>(
  broken: W[][], words: readonly W[], widthOf: (list: W[]) => number, maxWidth: number, scenarios: string | undefined,
  period?: string,
): void {
  if (broken.length < 2 || words.filter((word) => word.text !== '·').length < 4) return;
  const pairWord = scenarios !== undefined && scenarios.split(' ').length <= 3 ? scenarios : undefined;
  // A short period ("FY26 YTD", "Q3 2026") alone on the last line reads as a
  // lone word too.
  const periodWord = period !== undefined && period.trim().split(/\s+/).length <= 3 ? period.trim().split(/\s+/).join(' ') : undefined;
  const lone = (line: W[]) => {
    const text = line.filter((word) => word.text !== '·').map((word) => word.text).join(' ');
    return line.filter((word) => word.text !== '·').length < 2 || text === pairWord || text === periodWord;
  };
  if (!lone(broken[broken.length - 1]!)) return;
  const start = broken.slice(0, -2).reduce((at, line) => {
    const next = at + line.length;
    return words[next]?.text === '·' ? next + 1 : next;
  }, 0);
  const pair = words.slice(start);
  const trim = (line: W[]) => {
    let from = 0;
    let to = line.length;
    while (from < to && line[from]!.text === '·') from++;
    while (to > from && line[to - 1]!.text === '·') to--;
    return line.slice(from, to);
  };
  const boundary = (cut: number) => pair[cut]!.text === '·' || pair[cut - 1]!.text === '·' || pair[cut]!.bold !== pair[cut - 1]!.bold;
  const binds = (cut: number) => /^(in|of|by|vs\.?|per|to|and|or|the|a|an|for|from|at|on|[$€£¥]|US\$|Q[1-4]|H[12])$/i.test(pair[cut - 1]!.text);
  const tiers = [boundary, (cut: number) => !binds(cut), () => true];
  for (const allowed of tiers) {
    for (let cut = broken[broken.length - 2]!.length - 1; cut >= 1; cut--) {
      if (!allowed(cut)) continue;
      const first = trim(pair.slice(0, cut));
      const last = trim(pair.slice(cut));
      if (first.length === 0 || lone(last) || widthOf(first) > maxWidth || widthOf(last) > maxWidth) continue;
      broken.splice(broken.length - 2, 2, first, last);
      return;
    }
  }
}

function wrapSubtitle(
  segments: readonly { text: string; bold: boolean }[],
  ctx: {
    x: number; y: number; id: Id; nextId: () => Id; contentW: number; lineH: number;
    font: FontSpec; boldFont: FontSpec; measure: TextMeasurer; maxLines: number; scenarios?: string; period?: string;
  },
): { nodes: TextNode[]; rect: Rect } {
  type Word = { text: string; bold: boolean };
  const words: Word[] = segments.flatMap((seg) => seg.text.split(' ').filter(Boolean).map((text) => ({ text, bold: seg.bold })));
  const widthOf = (list: Word[]) => runsWidth(runsOf(list, ctx.boldFont.weight), ctx.font, ctx.boldFont, ctx.measure);
  // Each line takes the words that fit; it breaks at the last composed '·' when
  // the line keeps half the width, so a period stays on one line; the break
  // then replaces the separator. The last allowed line takes the rest.
  const broken: Word[][] = [];
  let rest = words;
  while (rest.length > 0 && broken.length < ctx.maxLines - 1 && widthOf(rest) > ctx.contentW) {
    let split = 1;
    while (split < rest.length && widthOf(rest.slice(0, split + 1)) <= ctx.contentW) split++;
    const dot = rest.slice(0, split + 1).map((word) => word.text).lastIndexOf('·');
    if (dot > 0 && widthOf(rest.slice(0, dot)) >= ctx.contentW / 2) split = dot;
    broken.push(rest.slice(0, split));
    rest = rest.slice(rest[split]?.text === '·' ? split + 1 : split);
  }
  if (rest.length > 0) broken.push(rest);
  if (ctx.maxLines === Infinity) keepLastLineCompany(broken, words, widthOf, ctx.contentW, ctx.scenarios, ctx.period);
  const withEllipsis = (list: Word[]) => [...list.slice(0, -1), { ...list[list.length - 1]!, text: `${list[list.length - 1]!.text}…` }];
  // Take characters off the end, word by word, until the line and its ellipsis fit.
  const cutLine = (line: Word[]): Word[] => {
    while (widthOf(withEllipsis(line)) > ctx.contentW && (line.length > 1 || line[0]!.text.length > 1)) {
      const last = line[line.length - 1]!;
      const kept = Array.from(last.text).slice(0, -1).join('').trimEnd();
      line = kept ? [...line.slice(0, -1), { ...last, text: kept }] : line.slice(0, -1);
    }
    return withEllipsis(line);
  };
  const title = words.map((word) => word.text).join(' ');
  // A first word wider than the frame (a URL, an identifier) is cut too, never left to run off the edge.
  const lines = broken
    .map((line) => (widthOf(line) > ctx.contentW ? { line: cutLine(line), cut: true } : { line, cut: false }));
  const nodes = lines.map(({ line, cut }, index): TextNode => {
    const runs = runsOf(line, ctx.boldFont.weight);
    return {
      t: 'text', id: index === 0 ? ctx.id : ctx.nextId(), x: ctx.x, y: ctx.y + index * ctx.lineH,
      lines: [runs.map((run) => run.text).join('')], runs,
      ...(cut ? { title } : {}),
      align: 'start', font: ctx.font, ink: { token: 'ink' }, owner: {}, part: 'subtitle', typeRole: 'subtitle',
    };
  });
  return { nodes, rect: { x: ctx.x, y: ctx.y, w: Math.max(...lines.map(({ line }) => widthOf(line))), h: lines.length * ctx.lineH } };
}

/**
 * A band the frame reserves above the footnotes and fills with what the band
 * draws: the event key (core/eventLane) lays itself out at the content width
 * the frame gives it. The frame owns the height, the position and the claim;
 * the band's own layout stays with the charts that draw one.
 */
export interface FrameBand {
  layout(x: number, width: number): { h: number; draw(top: number, nid: (part: string) => Id): SceneNode[] };
  /**
   * Key entries the band's marks need above the plot when the band itself
   * does not name them (the event colours and period brackets, once
   * the event key drops its kind labels). The frame adds them to its key row.
   */
  legend?: LegendItemInput[];
  /**
   * The compact lane (numbered markers, a key of "n title"): when the chart's
   * own key names series, those entries keep the row and the band's entries
   * are left out. Without a series key the band's entries stay, so the rings
   * of each event kind still have a name.
   */
  legendYieldsToSeries?: boolean;
}

/**
 * Where each key item starts a new row (index 0 never does). Rows fill
 * greedily. When that leaves a single item alone on the last row, the same
 * number of rows is balanced instead: every row
 * keeps two items or more, no row ends on a heading (a size key's title stays
 * with its rings), and the widest row is as narrow as it can be. Nothing
 * changes when no such split fits; the key text never shrinks for it.
 */
function keyRowStarts(widths: readonly number[], headings: readonly boolean[], rowW: number): boolean[] {
  const starts = widths.map(() => false);
  let x = 0;
  widths.forEach((w, i) => {
    if (i > 0 && x + w > rowW && x > 0) {
      starts[i] = true;
      x = 0;
    }
    x += w + ITEM_GAP;
  });
  const rows = starts.filter(Boolean).length + 1;
  const lastStart = starts.lastIndexOf(true);
  if (rows < 2 || lastStart !== widths.length - 1 || widths.length < 2 * rows || widths.length > 16) return starts;
  const span = (from: number, to: number) => widths.slice(from, to).reduce((sum, w) => sum + w, 0) + ITEM_GAP * (to - from - 1);
  let best: { widest: number; cuts: number[] } | undefined;
  const walk = (from: number, left: number, cuts: number[], widest: number) => {
    if (best && widest >= best.widest) return;
    if (left === 1) {
      const w = span(from, widths.length);
      if (widths.length - from >= 2 && w <= rowW && Math.max(widest, w) < (best?.widest ?? Infinity)) best = { widest: Math.max(widest, w), cuts };
      return;
    }
    for (let to = from + 2; to <= widths.length - 2 * (left - 1); to++) {
      const w = span(from, to);
      if (w > rowW) break;
      if (headings[to - 1]) continue;
      walk(to, left - 1, [...cuts, to], Math.max(widest, w));
    }
  };
  walk(0, rows, [], 0);
  if (!best) return starts;
  return widths.map((_, i) => best!.cuts.includes(i));
}

/** Gap between the event key and the footnotes under it. */
const KEY_NOTE_GAP = 8;

export function solveFrame(input: FrameInput, occupied: OccupiedIndex): FrameResult {
  if (input[CUT_LABEL_NOTES]?.length) input = { ...input, footnotes: [...(input.footnotes ?? []), ...input[CUT_LABEL_NOTES]!] };
  const destination = occupied;
  if (input.autoHeight) occupied = createOccupiedIndex({ x: 0, y: 0, w: input.size.width, h: input.size.height });
  input[COLLECT_IDENTITIES]?.([...(input.legend?.items ?? []), ...(input.eventKey?.legend ?? [])]);
  const { size, margin, theme, measure } = input;
  const tokens = input.cardGaps
    ? // The compact card frame's own gaps (see FrameInput.cardGaps).
      {
        ...spaceTokens(theme, size.width),
        gapSubtitlePlot: 8,
        gapAxisFootnote: 8,
        gapKeyFootnote: 8,
        gapFootnoteSource: 0,
        gapLegend: 8,
      }
    : spaceTokens(theme, size.width);
  const nodes: SceneNode[] = [];
  const frame: FrameGeometry = {};
  const warnings: LintWarning[] = [];
  const contentX = margin.left;
  const contentW = size.width - margin.left - margin.right;
  // The header (title, subtitle) spans the canvas to the token side margin.
  // A chart widens margin.right for its own labels (end names, value-line
  // labels, a gap bracket); that room belongs to the plot, and wrapping the
  // header in it gives line.bump at 320 px a 3-line title where 2 fit.
  const headerW = size.width - margin.left - Math.min(margin.right, Math.max(0, tokens.margin.right));
  let topY = margin.top;
  let bottomY = size.height - margin.bottom;
  let seq = 0;
  const nid = (part: string) => `frame:${part}:${seq++}`;
  const bottomBlocks: { node: Extract<SceneNode, { t: 'text' }>; height: number; gap: number }[] = [];
  let drawBottomLegend: ((bottom: number) => void) | undefined;

  const withFamily = (f: FontSpec): FontSpec => ({ family: theme.type.family, ...f });
  // A key row under the plot stands closer to the footer.
  const bottomKey = input.legend?.options.position === 'bottom' &&
    ((input.legend.items.length ?? 0) > 0 || (input.eventKey?.legend?.length ?? 0) > 0);
  const footGap = bottomKey ? tokens.gapKeyFootnote : tokens.gapAxisFootnote;

  // ---- title (action title, dominant, up to 2 lines) ----
  if (input.title) {
    // Compact keeps the title role at its smallest step, never label size.
    const titleFont = theme.type.title;
    const compactSize = input.mode === 'compact' ? input.compactTitleSize ?? titleFont.size : titleFont.size;
    const baseFont = withFamily(titleFont);
    // New targets never cut an authored title: it wraps
    // to TITLE_LINES lines, compact can take one discrete step bounded by the target floor,
    // and a title that still does not fit takes as many lines as it needs. The frame grows.
    const fitOptions = {
      target: input.target, textScale: input.textScale, typeRole: 'title' as const,
      shrink: { ...baseFont, size: Math.max(targetFloorsPx(input.target ?? DEFAULT_TARGET, input.textScale).title, compactSize) },
    };
    let wrapped = fitText(input.title, baseFont, headerW, TITLE_LINES, measure, fitOptions);
    if (wrapped.title !== undefined) {
      wrapped = fitText(input.title, wrapped.font, headerW, Number.MAX_SAFE_INTEGER, measure, { ...fitOptions, shrink: undefined });
    }
    const font = wrapped.font;
    // A wrapped title fills each line; no single word sits alone on the last line.
    const lines = wrapped.title === undefined && wrapped.lines.length >= 2
      ? balancedLines(input.title, font, headerW, wrapped.lines, measure) : wrapped.lines;
    if (wrapped.title !== undefined) {
      warnings.push({
        code: 'frame-title-truncated',
        severity: 'warn',
        message: `the title does not fit on ${TITLE_LINES} lines at the ${headerW}px content width and was cut`,
        suggest: 'Shorten the title, or draw the chart wider.',
      });
    }
    const lineH = font.size * (font.lineHeight ?? 1.25);
    const id = nid('title');
    nodes.push({
      t: 'text',
      id,
      x: contentX,
      y: topY,
      lines,
      // A cut title keeps its full text for the reader.
      ...(wrapped.title !== undefined ? { title: wrapped.title } : {}),
      align: 'start',
      font,
      ink: { token: 'ink' },
      owner: {},
      part: 'title',
      typeRole: 'title',
    });
    const h = lines.length * lineH;
    occupied.claim({ x: contentX, y: topY, w: headerW, h }, 'frame', {});
    frame.titleNodeId = id;
    frame.titleLines = lines.length;
    topY += h + tokens.gapTitleSubtitle;
  }

  // ---- subtitle (notation composed line; measure bold) ----
  if (input.subtitle) {
    const subtitle = measureSubtitle(input, contentX, topY, nid('subtitle'), () => nid('subtitle'), headerW);
    nodes.push(...subtitle.nodes);
    occupied.claim(subtitle.rect, 'frame', {});
    frame.subtitleNodeId = subtitle.nodes[0]!.id;
    topY += subtitle.rect.h + tokens.gapSubtitlePlot;
  } else if (input.title) {
    // Title-only: the header→plot boundary is the same subtitle-plot token —
    // it is the gap between the last header block and the plot, whichever
    // block that is. (The compact card frame keeps its own 4+8 gaps.)
    topY += input.cardGaps ? 8 : tokens.gapSubtitlePlot - tokens.gapTitleSubtitle;
  }
  // Header room below the wide width class (12 -> 8 px) is freed; sizing gives it to the plot.
  if (!input.cardGaps && (input.subtitle || input.title) && theme.space.gap?.subtitlePlot === undefined
    && size.width < WIDE_CANVAS_MIN_WIDTH) recordFreedChrome(frame, 'header-gap', REFERENCE_SUBTITLE_PLOT_GAP - tokens.gapSubtitlePlot);

  // ---- notes, source and credit (bottom): notes grouped by kind ----
  // Every note has a kind (core/notes). The frame prints the author's notes
  // within the target's line budget, then the source line, then a required
  // map credit; the rest goes to the notes list and the source line ends with
  // "+N notes". The small role, inkMuted, regular weight. A host that scales
  // text reads the size from this role only.
  const footFont = withFamily(footerType(theme.type.footnote, input.target, input.textScale));
  let liveFooterH = 0;
  const footLineH = footFont.size * (footFont.lineHeight ?? 1.3);
  const footInset = Math.max(0, Math.min(input.footerInset ?? 0, (contentW - 1) / 2));
  const footX = contentX + footInset;
  const footW = contentW - 2 * footInset;
  const fullStatic = staticFrame.pinned;
  const placement = fullStatic ? 'frame' : input.notes?.placement ?? defaultNotePlacement(input.target);
  // WCAG 2.2 AA 2.5.8: the 'info' footer is a 24 px button in React (ChartFooter), so the room
  // from the footer top to the canvas edge is at least 24 px; a 10 px card margin left 21 px.
  const hitRoom = (y: number) => placement === 'info' ? Math.min(y, size.height - NOTE_HIT_PX) : y;
  const budget = fullStatic ? Infinity : input.notes?.maxLines ?? defaultNoteLines(input.target, size.width);
  // Engine notes (method, disclosure) print only where the author asks for them (notes.show).
  const shown = new Set<string>(input.notes?.show ?? ['note']);
  const pointerOn = !fullStatic && !input.footnotesOff && input.notes?.pointer !== false;
  // A note a mark points at keeps its number; a note about the exhibit
  // prints unnumbered. The numbered list is matched in order, so a
  // derived note that happens to repeat one of its strings does not steal its
  // number. A numbered note is the author's (or one a mark points at); every
  // other note is the engine's, a disclosure where its composer said so.
  const entries: { kind: NoteKind; text: string; short?: string; drawn: string; ref?: number; ranks?: true }[] = [];
  {
    const notes = input.footnotes ?? [];
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
      const meta = numberedHere ? undefined : engineNoteMeta(f);
      if (fullStatic && meta?.list) staticFrame.countable = true;
      // a capped list note names what fits two footer lines at this width.
      if (meta?.list) {
        const fitted = fittedNote(meta.list, (text) => wrapFootnote(text, footFont, footW, measure).length <= 2);
        f = meta.short ? engineNote(f, 'disclosure', fitted, meta.values, meta.list) : engineNote(fitted, 'disclosure', undefined, meta.values, meta.list);
      }
      const kind: NoteKind = numberedDisclosure ? 'disclosure' : numberedHere ? 'note' : meta?.kind ?? 'method';
      // A disclosure draws its short form only where it is narrower than the full note;
      // an author-set notes.maxListed keeps its form.
      const fittedShort = engineNoteMeta(f)?.short ?? meta?.short;
      const short = fittedShort && (kind !== 'disclosure' || input.notes?.maxListed !== undefined || measure(fittedShort, footFont).width < measure(f, footFont).width) ? fittedShort : undefined;
      const storedMeta = meta ? { ...meta, ...engineNoteMeta(f), ...(meta.ranks ? { ranks: true as const } : {}) } : undefined;
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
  const sourceOff = sourceText !== undefined && !fullStatic && input[COMPACT_SOURCE_LINES] === 0;
  if (sourceOff) {
    frame.source = input.source;
    warnings.push({ code: 'footnotes-off', severity: 'info', message: `compact frame has no room for the source line: ${sourceText}` });
  }
  // A disclosure the author asks for (notes.show), and an author note a drawn
  // mark points at (pointedNotes), stay in the frame outside the line budget,
  // like a required credit. `footnotes: false` hands every other note to the
  // host; a disclosure the author asks for stays.
  const pointed = new Set(input.pointedNotes ?? []);
  const kept = entries.filter((entry) => entry.kind === 'disclosure' ? shown.has('disclosure') || (entry.ranks === true && shown.has('ranks')) : !input.footnotesOff && pointed.has(entry.text));
  const candidates = input.footnotesOff || placement === 'list' ? [] : entries.filter((entry) => !kept.includes(entry) && shown.has(entry.kind));
  // The pointer counts the notes of the kinds the author prints; the engine's
  // hidden notes stay in the notes list without a pointer under the chart.
  // React's 'info' footer is the exception: its "Notes and sources (N)" button lists the engine's
  // hidden notes too (ChartFooter), so the pointer counts every note the frame does not draw and
  // the frame reserves the button's row. A 280 px card with one hidden value drew the button
  // below the card.
  const infoPanel = staticFrame.live && placement === 'info';
  const listed = (k: number) => infoPanel
    ? entries.filter((entry) => !kept.includes(entry) && !candidates.slice(0, k).includes(entry)).length + (credit && !creditInFrame ? 1 : 0)
    : entries.filter((entry) => shown.has(entry.kind) && !kept.includes(entry)).length - k + (credit && !creditInFrame ? 1 : 0);
  const sourcePara = (k: number): string | undefined => {
    const hidden = listed(k);
    const pointer = pointerOn && hidden > 0 ? notesPointer(hidden, input.strings) : undefined;
    const source = sourceOff ? undefined : sourceText;
    if (source === undefined) return pointer;
    return pointer === undefined ? source : `${source}${/[.!?]$/.test(source) ? '' : '.'} ${pointer}`;
  };
  const sourceFit = (text: string) => !fullStatic && input[COMPACT_SOURCE_LINES] === 1 ? fitText(text, footFont, footW, 1, measure) : undefined;
  const sourceLines = (text: string): string[] => sourceFit(text)?.lines ?? wrapFootnote(text, footFont, footW, measure);
  const noteLines = candidates.map((entry) => wrapFootnote(entry.drawn, footFont, footW, measure));
  // The most notes, in order, that fit the budget with the source line (and
  // its pointer); the source line itself is never cut.
  let k = candidates.length;
  for (; k > 0; k--) {
    const para = sourcePara(k);
    const used = noteLines.slice(0, k).reduce((sum, lines) => sum + lines.length, 0) + (para ? sourceLines(para).length : 0);
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
  if (unprinted.length > 0) frame.notes = unprinted;
  const noteList: ChartNote[] = [
    ...entries.map((entry) => keepNoteMeta({ kind: entry.kind, text: entry.text, ...(entry.short ? { short: entry.short } : {}), inFrame: visible.has(entry), ...(entry.ref ? { ref: entry.ref } : {}) }, engineNoteMeta(entry))),
    ...(input.source ? [{ kind: 'source' as const, text: input.source, inFrame: !sourceOff }] : []),
    ...(credit ? [{ kind: 'credit' as const, text: credit.text, short: credit.short, ...(credit.links.length ? { links: credit.links.map((link) => ({ ...link })) } : {}), inFrame: creditInFrame }] : []),
  ].map((entry, i) => keepNoteMeta({ n: i + 1, ...entry }, engineNoteMeta(entry)));
  if (noteList.length > 0) frame.noteList = noteList;
  frame.notePlacement = placement;
  const footParts: { text: string; kind: 'source' | 'footnote' | 'credit'; lines?: string[] }[] = [
    ...entries.filter((entry) => visible.has(entry)).map((entry) => {
      const at = candidates.indexOf(entry);
      return { text: entry.drawn, kind: 'footnote' as const, lines: at >= 0 ? noteLines[at] : wrapFootnote(entry.drawn, footFont, footW, measure) };
    }),
    ...(sourceBlock ? [{ text: sourceBlock, kind: 'source' as const }] : []),
    ...(credit && creditInFrame ? [{ text: `${chartString(input, 'mapCredit')}: ${credit.text}`, kind: 'credit' as const }] : []),
  ];
  let footLines = 0;
  // React draws this footer as HTML and crops the SVG at its top (ChartFooter). A React layout
  // reserves the rows React draws: the "+N notes" button is a 24 px row of its own when the
  // source leaves it no room, and it also counts the notes compact mode left off the canvas.
  const omitted = Array.from({ length: input[COMPACT_OMITTED_NOTES] ?? 0 }, (): ChartNote => ({ n: 0, kind: 'note', text: '', inFrame: false }));
  // The 'info' button row reaches into the bottom margin, as hitRoom rules.
  liveFooterH = staticFrame.live && !fullStatic ? Math.max(0, htmlFooterHeight(input, footerParts([...noteList, ...omitted], placement, input[LIVE_NOTE_SHOW] ?? input.notes?.show, pointerOn),
    sourceText, footFont, contentW, footLineH, measure) - (placement === 'info' ? margin.bottom : 0)) : 0;
  if (footParts.length > 0 || liveFooterH > 0) {
    frame.footnoteNodeIds = [];
    // stack upward from the bottom
    for (let i = footParts.length - 1; i >= 0; i--) {
      const p = footParts[i]!;
      // A footnote is the sentence that makes an exhibit auditable. It wraps to
      // the content width and keeps every word on the canvas.
      const fitted = p.kind === 'source' ? sourceFit(p.text) : undefined;
      const lines = p.lines ?? (p.kind === 'source' ? sourceLines(p.text) : wrapFootnote(p.text, footFont, footW, measure));
      bottomY -= footLineH * lines.length;
      footLines += lines.length;
      const id = nid(p.kind);
      nodes.push({
        t: 'text',
        id,
        x: footX,
        y: bottomY,
        lines,
        ...(fitted?.title ? { title: fitted.title } : {}),
        align: 'start',
        font: footFont,
        ink: { token: p.kind === 'footnote' ? input.footnoteInk ?? 'inkMuted' : 'inkMuted' },
        owner: {},
        part: p.kind,
        typeRole: 'footnote',
      });
      occupied.claim({ x: footX, y: bottomY, w: footW, h: footLineH * lines.length }, 'frame', {});
      if (input.autoHeight) bottomBlocks.push({ node: nodes[nodes.length - 1] as Extract<SceneNode, { t: 'text' }>,
        height: footLineH * lines.length,
        gap: i > 0 && (p.kind === 'source' || (p.kind === 'credit' && footParts[i - 1]!.kind === 'footnote')) ? tokens.gapFootnoteSource : 0 });
      if (p.kind === 'credit') {
        frame.creditNodeId = id;
        // With no source line, the credit sits the same 4px clear of the notes.
        if (i > 0 && footParts[i - 1]!.kind === 'footnote') bottomY -= tokens.gapFootnoteSource;
      } else if (p.kind === 'source') {
        frame.sourceNodeId = id;
        // The source line sits 4px clear of the numbered notes above it
        // (source renders first — the stack grows upward).
        if (i > 0) bottomY -= tokens.gapFootnoteSource;
      } else {
        frame.footnoteNodeIds!.unshift(id);
      }
    }
    // The rows React draws, where they are taller than the footer text; a frame that drew no
    // footer text also takes the gap above the footer for them.
    if (liveFooterH > size.height - margin.bottom - bottomY + 0.01) {
      liveFooterExtra.set(frame, liveFooterH - (size.height - margin.bottom - bottomY) + (footParts.length === 0 ? input.eventKey ? KEY_NOTE_GAP : footGap : 0));
      bottomY = size.height - margin.bottom - liveFooterH;
    }
    bottomY = hitRoom(bottomY);
    frame.footerRect = { x: contentX, y: bottomY, w: contentW, h: size.height - margin.bottom - bottomY };
    bottomY -= input.eventKey ? KEY_NOTE_GAP : footGap;    // 11 px footer text and a 10 px key-to-footer gap.
    recordFreedChrome(frame, 'footer-text', footLines * (withFamily(theme.type.footnote).size - footFont.size) * (footFont.lineHeight ?? 1.3));
    if (!input.cardGaps && !input.eventKey && bottomKey && theme.space.gap?.axisFootnote === undefined && size.width < WIDE_CANVAS_MIN_WIDTH)
      recordFreedChrome(frame, 'key-footer-gap', REFERENCE_FOOTER_GAP - tokens.gapKeyFootnote);
  }
  // Layout-only input also keeps compact notes and their original reference numbers.
  footerPlans.set(frame, fullStatic ? { ...input, fullStaticFooter: true } : input);
  // The licence asks for a visible credit: no option path may drop it silently.
  if (credit?.required && frame.creditNodeId === undefined) {
    warnings.push({ code: 'credit-hidden', severity: 'warn', message: `the map credit the licence requires is not drawn: ${credit.text}`, suggest: 'Keep the credit visible under the chart, linked on a web page.' });
  }
  if (input.eventKey) {
    const key = input.eventKey.layout(contentX, contentW);
    bottomY -= key.h;
    pushAll(nodes, key.draw(bottomY, nid));
    frame.eventKeyRect = { x: contentX, y: bottomY, w: contentW, h: key.h };
    occupied.claim(frame.eventKeyRect, 'frame', {});
    bottomY -= tokens.gapAxisFootnote;
  }

  // ---- legend ----
  let legendGeom: LegendGeometry | undefined;
  let legendBand = 0;
  let rightLegendBottom = 0;
  let plotRight = size.width - margin.right;
  const bandKeys = input.eventKey?.legendYieldsToSeries && (input.legend?.items.length ?? 0) > 0 ? [] : input.eventKey?.legend ?? [];
  const legendInput = bandKeys.length > 0
    ? { options: input.legend?.options ?? { position: 'top' as const }, items: [...(input.legend?.items ?? []), ...bandKeys] }
    : input.legend;
  if (legendInput && legendInput.items.length > 0) {
    const { options } = legendInput;
    const { items } = dedupeLegendKeys(legendInput.items, item => identityAppearance(item, theme));
    pushAll(warnings, identityCollisionWarnings(items, theme));
    // The key is reference text, never larger than the
    // target's narrow-card axis size (13 px on report, times textScale). The
    // footnote-role key (compact, automatic legends) keeps its size.
    const footKey = input.legendFont === 'footnote' || (input.legendFont === 'compact' && theme.type.footnote.size <= secondaryType(theme).size);
    const keyCap = footKey ? Infinity
      : scaleTextAtFloor(targetTypeSizesPx(input.target ?? DEFAULT_TARGET, 'S').axis, input.textScale ?? 1, targetFloorsPx(input.target ?? DEFAULT_TARGET).secondary);
    // Type steps: the key text takes the secondary step, 12 px from 720 px and 11 px below.
    const keyRole = footKey ? theme.type.footnote : secondaryType(theme);
    const font = withFamily(!hasAuthoredTypeSize(keyRole) && keyRole.size > keyCap ? { ...keyRole, size: keyCap } : keyRole);
    const lineH = Math.max(SWATCH, font.size * (font.lineHeight ?? 1.2));
    const typeRole = footKey ? 'footnote' : 'secondary';
    const labelBudget = options.position === 'right' ? contentW * 0.45 : contentW;
    // A size key's ring is drawn at the plot's scale, and its row grows to the
    // ring's diameter, in whole pixels so the scatter's ring-and-row loop settles.
    const ringH = (it: LegendItemInput) => (it.key === 'sizes' ? Math.max(it.ringRow ?? 0, Math.ceil(2 * Math.max(0.5, ...(it.radii ?? [])))) : 0);
    // Key text wraps beside the widest key as it is drawn, a size key's ring included.
    const maxKeyW = maxOf(items.map(it => keyWidth(it, Math.max(lineH, ringH(it)))));
    const wrappedKeys = new Map(items.map(it => [it, wrapFootnote(it.label, font, Math.max(1, labelBudget - maxKeyW - SWATCH_GAP), measure)]));
    // A blank name wraps to no lines; its key still keeps one line of height and zero text width.
    const keyTextH = (it: LegendItemInput) => Math.max(1, wrappedKeys.get(it)!.length) * lineH;
    // A group's value (its total) sits after the label, bold, in every position.
    const valueFont: FontSpec = { ...font, weight: emphasisWeight(theme) };
    const textWOf = (it: LegendItemInput) => Math.max(0, ...wrappedKeys.get(it)!.map(line => measure(line, font).width));
    const itemTextW = (it: LegendItemInput) => textWOf(it) + (it.value ? SWATCH_GAP + measure(it.value, valueFont).width : 0);
    const valueNode = (it: LegendItemInput, lbId: Id, x: number, y: number): SceneNode => ({
      t: 'text', id: `${lbId}:value`, x: x + textWOf(it) + SWATCH_GAP, y, lines: [it.value!],
      typeRole, align: 'start', font: valueFont, ink: { token: 'ink' }, owner: { seriesId: it.id }, part: 'legendValue',
    });
    // Glyph keys use the same type token as their labels.
    const keyNodes = (it: LegendItemInput, id: Id, x: number, y: number, height: number) =>
      legendKeyNodes(theme, it, id, x, y, height, font).map((node): SceneNode => node.t === 'text' ? { ...node, typeRole } : node);
    // A key stands centred on the cap-height middle of
    // its label's first line (baseline minus half the cap height), not on the
    // line box, which left it about 1-4 px low.
    const capMidBelowTop = font.size * TEXT_ASCENT - (measure.capHeight?.(font) ?? font.size * 0.72) / 2;
    /** The top of a key box `height` tall whose centre meets the cap middle of a label at `textTop`. */
    const keyTopAt = (textTop: number, height: number) => textTop + capMidBelowTop - height / 2;
    /** A glyph key is a text in the label's font: it stands on the label's own line. */
    const onLabelLine = (keys: SceneNode[], textTop: number): SceneNode[] =>
      keys.map((node) => (node.t === 'text' && node.part === 'swatch' ? { ...node, y: textTop } : node));

    if (options.position === 'right') {
      const keyW = maxOf(items.map((it) => keyWidth(it, Math.max(lineH, ringH(it)))));
      const maxLabelW = maxOf(items.map(itemTextW));
      const legendW = keyW + SWATCH_GAP + maxLabelW;
      const legendX = size.width - margin.right - legendW;
      let y = topY;
      const legendItems: LegendGeometry['items'] = [];
      for (const it of items) {
        const swId = nid('swatch');
        const lbId = nid('legendLabel');
        const sideKeyH = Math.max(lineH, ringH(it));
        nodes.push(...onLabelLine(keyNodes(it, swId, legendX, keyTopAt(y, sideKeyH), sideKeyH), y));
        nodes.push({
          t: 'text',
          id: lbId,
          x: legendX + keyW + SWATCH_GAP,
          y,
          lines: wrappedKeys.get(it)!,
          typeRole,
          align: 'start',
          font,
          ink: { token: 'inkMuted' },
          owner: { seriesId: it.id },
          part: it.key === 'heading' ? 'legendHeading' : 'legendLabel',
        });
        if (it.value) nodes.push(valueNode(it, lbId, legendX + keyW + SWATCH_GAP, y));
        if (it.key !== 'heading') legendItems.push({ id: it.id, swatchNodeId: swId, labelId: lbId });
        y += Math.max(keyTextH(it), ringH(it)) + 4;
      }
      const rect: Rect = { x: legendX, y: topY, w: legendW, h: y - topY - 4 };
      rightLegendBottom = y - 4;
      occupied.claim(rect, 'legend', {});
      legendGeom = { rect, items: legendItems };
      plotRight = legendX - 16;
      // Only a spec that names 'right' gets here; every default is 'top'.
      warnings.push({
        code: 'legend-beside-plot',
        severity: 'info',
        message: `the key stands beside the plot and takes ${Math.round(size.width - margin.right - plotRight)} px of its width; 'top' keeps the plot full width`,
      });
    } else {
      // top/bottom: single wrapped band — rows step at the legend.rowH
      // token (18px), keys and text centered inside their row. The
      // compact card frame keeps a row rhythm of lineH + 4, text at
      // the row top.
      const keyH = lineH;
      const titles = new Map<LegendItemInput, string>();
      const plainRowH = Math.max(tokens.legendRowH, lineH, maxOf(items.map(ringH))) + (input.cardGaps ? 4 : 0);
      const budget = input[LEGEND_HEIGHT];
      const available = budget?.height === 'auto'
        ? size.height * furnitureBudget(size.width) - (size.height - bottomY + topY) - tokens.gapLegend
        : budget?.height ?? Infinity;
      let fullBlockH: number | undefined;
      if (Number.isFinite(available) && available >= plainRowH && items.every(it =>
        budget?.names.get(it.id) === it.label && it.key !== 'heading' && ringH(it) <= keyH)) {
        const widths = items.map(it => keyWidth(it, keyH) + SWATCH_GAP + itemTextW(it));
        const rows = 1 + keyRowStarts(widths, items.map(() => false), contentW).filter(Boolean).length;
        fullBlockH = rows * (Math.max(tokens.legendRowH, maxOf(items.map(keyTextH))) + (input.cardGaps ? 4 : 0)) - (input.cardGaps ? 4 : 0);
        if (fullBlockH > available) {
          const perRow = Math.ceil(items.length / Math.floor(available / plainRowH));
          const entryWidth = (contentW - ITEM_GAP * (perRow - 1)) / perRow;
          const fitted = items.map(it => fitText(it.label, font,
            entryWidth - keyWidth(it, Math.max(keyH, ringH(it))) - SWATCH_GAP - (it.value ? SWATCH_GAP + measure(it.value, valueFont).width : 0),
            1, measure, { target: input.target, typeRole }));
          // A short key must still distinguish its series. The full name stays in its title.
          // A cut whose visible start also starts another key ('Group 1…' beside 'Group 10…') does not.
          const texts = fitted.map(fit => fit.lines.join(''));
          const seen = new Map<string, string>();
          if (texts.every((text, i) => {
            if (!text || text === '…' || (seen.has(text) && seen.get(text) !== items[i]!.label)) return false;
            seen.set(text, items[i]!.label);
            const stem = text.endsWith('…') ? text.slice(0, -1) : undefined;
            return stem === undefined || !texts.some((other, j) => j !== i && items[j]!.label !== items[i]!.label && other.startsWith(stem));
          })) {
            items.forEach((it, i) => {
              wrappedKeys.set(it, fitted[i]!.lines);
              if (fitted[i]!.title) titles.set(it, it.label);
            });
          }
        }
      }
      const rowH = Math.max(tokens.legendRowH, maxOf(items.map(keyTextH)), maxOf(items.map(ringH))) + (input.cardGaps ? 4 : 0);
      const inRow = (rowY: number, h: number, height = rowH) =>
        input.cardGaps ? rowY : rowY + (height - h) / 2;
      // The key never shares the subtitle's line: it takes its own rows.
      const rowY0 = options.position === 'top' ? topY : bottomY;
      let x = contentX;
      let y = 0;
      const legendItems: LegendGeometry['items'] = [];
      // Key nodes past the swatch (a Harvey ball's quarters), redrawn at the
      // final row position once the band's place is known.
      const extraKeys = new Map<Id, { item: LegendItemInput; swId: Id; x: number; y: number; h: number }>();
      const itemW = (it: LegendItemInput) => keyWidth(it, Math.max(keyH, ringH(it))) + SWATCH_GAP + itemTextW(it);
      // Each row is as tall as its own items: a size key's tall rings grow
      // their row only, not the rows of the other keys.
      // Each item that starts a new row: greedy, then balanced when the
      // greedy rows leave one item alone on the last row (keyRowStarts).
      const rowStarts = keyRowStarts(items.map(itemW), items.map((it) => it.key === 'heading'), contentW);
      const rowHs: number[] = [];
      {
        const textRowH = Math.max(tokens.legendRowH, maxOf(items.map(keyTextH))) + (input.cardGaps ? 4 : 0);
        items.forEach((it, i) => {
          if (rowStarts[i] || !rowHs.length) rowHs.push(textRowH);
          rowHs[rowHs.length - 1] = Math.max(rowHs[rowHs.length - 1]!, ringH(it) + (input.cardGaps ? 4 : 0));
        });
      }
      let row = 0;
      for (const [i, it] of items.entries()) {
        const itemKeyH = Math.max(keyH, ringH(it));
        const w = itemW(it);
        if (rowStarts[i]) {
          x = contentX;
          y += rowHs[row]!;
          row++;
        }
        const thisRowH = rowHs[row] ?? rowH;
        const swId = nid('swatch');
        const lbId = nid('legendLabel');
        const textY = inRow(y, keyTextH(it), thisRowH);
        const keyY = keyTopAt(textY, itemKeyH);
        const keys = onLabelLine(keyNodes(it, swId, x, keyY, itemKeyH), textY);
        pushAll(nodes, keys);
        for (const extra of keys.slice(1)) extraKeys.set(extra.id, { item: it, swId, x, y: keyY, h: itemKeyH });
        nodes.push({
          t: 'text',
          id: lbId,
          x: x + keyWidth(it, itemKeyH) + SWATCH_GAP,
          y: textY,
          lines: wrappedKeys.get(it)!,
          ...(titles.has(it) ? { title: titles.get(it)! } : {}),
          typeRole,
          align: 'start',
          font,
          ink: { token: 'inkMuted' },
          owner: { seriesId: it.id },
          part: it.key === 'heading' ? 'legendHeading' : 'legendLabel',
        });
        if (it.value) nodes.push(valueNode(it, lbId, x + keyWidth(it, itemKeyH) + SWATCH_GAP, inRow(y, lineH, thisRowH)));
        if (it.key !== 'heading') legendItems.push({ id: it.id, swatchNodeId: swId, labelId: lbId });
        x += w + ITEM_GAP;
      }
      const lastRow = rowHs[row] ?? rowH;
      const blockH = y + (input.cardGaps ? lastRow - 4 : lastRow);
      if (fullBlockH !== undefined) recordFreedChrome(frame, 'legend', fullBlockH - blockH);
      const yAbs = options.position === 'top' ? rowY0 : rowY0 - blockH;
      // shift nodes into absolute position
      const swatchIds = new Set(legendItems.map((item) => item.swatchNodeId));
      if (input.autoHeight && options.position === 'bottom') {
        const relative = nodes.filter(node => swatchIds.has(node.id) || extraKeys.has(node.id)
          || ['legendHeading', 'legendValue', 'legendLabel'].includes(node.part))
          .map(node => ({ node, original: node.t === 'rect' ? { ...node, rect: { ...node.rect } } : { ...node } }));
        drawBottomLegend = (bottom) => {
          const yAbs = bottom - blockH;
          for (const { node, original } of relative) {
            const shifted = original.t === 'rect' ? { ...original, rect: { ...original.rect } } : { ...original };
            shiftLegendKeyY(shifted, yAbs);
            const extra = extraKeys.get(node.id);
            if (extra) Object.assign(shifted, keyNodes(extra.item, extra.swId, extra.x, extra.y + yAbs, extra.h).find(key => key.id === node.id));
            Object.assign(node, shifted);
          }
        };
      }
      for (const n of nodes) {
        if (swatchIds.has(n.id)) shiftLegendKeyY(n, yAbs);
        const extra = extraKeys.get(n.id);
        if (extra) Object.assign(n, keyNodes(extra.item, extra.swId, extra.x, extra.y + yAbs, extra.h).find((key) => key.id === n.id));
        if ((n.part === 'legendHeading' || n.part === 'legendValue' || (n.part === 'legendLabel' && legendItems.some((li) => li.labelId === n.id))) && n.t === 'text') {
          n.y += yAbs;
        }
      }
      const rect: Rect = { x: contentX, y: yAbs, w: contentW, h: blockH };
      occupied.claim(rect, 'legend', {});
      legendGeom = { rect, items: legendItems };
      legendBand = blockH + tokens.gapLegend;
      if (options.position === 'top') topY += legendBand;
      else bottomY -= legendBand;
    }
  }

  const plotInsetLeft = Math.max(0, input.plotInset?.left ?? 0);
  const plot: Rect = {
    x: contentX + plotInsetLeft,
    y: topY,
    w: Math.max(10, plotRight - contentX - plotInsetLeft),
    h: Math.max(MIN_PLOT_H, bottomY - topY),
  };
  // Repeat only bottom-position arithmetic: adding a delta can change React's float bytes.
  const height = bottomY - topY >= MIN_PLOT_H && rightLegendBottom === 0 && !input.eventKey ? input.autoHeight?.(plot) : undefined;
  const dy = height === undefined ? 0 : height - size.height;
  const moved = new Map<number, number>();
  const legendY = legendGeom?.rect.y;
  if (dy !== 0) {
    size.height = height!;
    bottomY = size.height - margin.bottom;
    for (const block of bottomBlocks) {
      bottomY -= block.height;
      moved.set(block.node.y, bottomY);
      block.node.y = bottomY;
      bottomY -= block.gap;
    }
    if (frame.footerRect) {
      if (liveFooterH > size.height - margin.bottom - bottomY + 0.01) bottomY = size.height - margin.bottom - liveFooterH;
      bottomY = hitRoom(bottomY);
      frame.footerRect.y = bottomY;
      frame.footerRect.h = size.height - margin.bottom - bottomY;
      bottomY -= footGap;
    }
    if (legendGeom && legendInput?.options.position === 'bottom') {
      drawBottomLegend!(bottomY);
      legendGeom.rect.y = bottomY - legendGeom.rect.h;
      bottomY -= legendBand;
    }
    plot.h = Math.max(MIN_PLOT_H, bottomY - topY);
  }
  if (input.autoHeight) for (const claim of occupied.snapshot()) {
    if (dy !== 0 && claim.kind === 'frame' && moved.has(claim.rect.y)) claim.rect.y = moved.get(claim.rect.y)!;
    if (dy !== 0 && claim.kind === 'legend' && legendInput?.options.position === 'bottom' && claim.rect.y === legendY) claim.rect.y = legendGeom!.rect.y;
    destination.claim(claim.rect, claim.kind, claim.owner, claim.part, claim.polygon);
  }
  // The frame's own record of its plot BLOCK (see FrameGeometry).
  frame.plotRect = { ...plot };
  frameChrome.set(frame, topY + size.height - bottomY);
  // A footer that wraps without a cap can outgrow the canvas. The frame names
  // the height it needs, and `fitLayout` grows an unsized chart to it or
  // refuses an explicit size, instead of drawing lines above the canvas. It
  // names it on a canvas that holds it too, so a chart drawn at its floor
  // reports that floor.
  const deficit = Math.max(MIN_PLOT_H - (bottomY - topY), rightLegendBottom > 0 ? rightLegendBottom - bottomY : -Infinity);
  frame.minHeight = size.height + deficit;
  if (warnings.length > 0) frame.warnings = warnings;

  return { plot, nodes, frame, legend: legendGeom, ...(deficit > 0 ? { deficit } : {}), ...(legendBand > 0 ? { legendBand } : {}) };
}
