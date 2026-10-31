import { tableWidths } from './widths';
import { copyFrame, footerPlans } from '../../footer';
import { liftOrFallback, missesSize, tightSpacingWarning } from '../tableFit';
import { chartTheme } from '../chartEnv';
import { structureCount } from '../../structureCounts';
/**
 * Table layout v0. Consumes resolveTable()'s semantic
 * model and emits a paint-ready scene. Body cells are plain text nodes —
 * the label solver is never invoked; invariant (every cell text rect
 * inside its cell contentRect; disjoint tiling) replaces the solver
 * invariants and is enforced by the test suite. Claims are COARSE (row
 * bands, column bands, header band) so occupied stays proportional to
 * structure.
 */

import { cutWithTitle, distinctCut, fitText } from '../../label/fitText';
import { disclosureNote } from '../../notes';
import { authoredNotes, frameTextOptions, legendOff, legendRequired, solveFrame } from '../../frame';
import type { Rect, Size } from '../../geometry';
import { createOccupiedIndex } from '../../label/occupied';
import { parseFormatExample } from '../../formatSpec';
import { accessibleTitle, resolveSize } from '../../normalize/shared';
import { defaultMeasurer, ellipsize, WIDTH_SAFETY, type FontSpec, type TextMeasurer } from '../../text';
import { composedTextRole } from '../../textRole';
import { groundTextWarnings } from '../../paintWarnings';
import {
  canvasMargin,
  colorblindRoles,
  markRolePaint,
  panelTypeClass,
  typeWidthClass,
  resolveSemanticPaletteTheme,
  resolveSurface,
  semanticPalettePaint,
  strokeToken,
} from '../../theme';
import type { Theme } from '../../types/theme';
import type { Id } from '../../types/cell';
import type { FrameGeometry, Geometry, SceneNode, LintWarning, Paint, PaintWarningRule } from '../../types/scene';
import type { ColumnKind, ResolvedCell, ResolvedColumn, ResolvedRow, RowRole, TableData, TableDerived, TableOptions } from '../../types/table';
import { arrowKey, emitArrow, emitHeat, emitInCellBar, emitSparkline, heatKey, heatRanges, sparklineDomains, sparklineSourceValues, tableSparklineDomain } from './encodings';
import { tableCellKey, tableCellNodeId } from './cellKey';
import { isCohortDensity, levelLadder } from './ladder';
import { presetLanguage } from './presets';
import {
  CHIP_PAD_X, HINT_GAP, INDENT_BASE, MARK_SIZE, kindFont, strongColumnFont,
  HEADING_CUT_MIN as CUT_MIN, SECTION_CHIP_GAP as BADGE_GAP,
  ENGINE_NOTES, LABEL_WRAP_FLOOR, SOFT_LABEL_CAP, INLINE_LABEL_INDENT, cellPadX as trackCellPadX, figureFont, inlineFont as ladderInlineFont, changeLineFont, changeLineFitFont,
  rowFont as ladderRowFont, tableFonts,
} from './tracks';
import { groupHeadingFaces, groupHeadingLabel, groupHeadingNote, groupHeadingWidth } from './groupHeading';
import { fitTableFormats, formatsFittedWarning } from './fitFormats';
import { qualifierFont, tableInk, tableRuleInk } from './statement';
import { chipHeight, chipPaints, hasPolarityBadge, isFigureCell, polarityBadgeInk, onTableGround, statusSquare, statusSquarePaint, tableGround, toneTextPaint } from './chips';
import { lastObservedIndex, type SparklineDomain } from '../sparkline/layout';
import { resolveTable, ZERO_LIFT, type ZeroLiftOptions } from './resolve';
import { DEFAULT_EMPTY_MESSAGE } from '../../emptyData';
import { cellDrawsTabular, cellHoldsNumber, emptyMessageRow, expansionRootsHidden, finalClosers, hasNoDataRows, groupSpans, heatColumn, printsFigures, rowGrounds, tableFootnotes, visibleColumns, visibleInlineRows, visibleRows } from './view';
import { rowDrivenHeight } from '../../rowCanvas';
import { CARD_CLASS_WIDTH, heightOmitted, rowSizing, VERIFY_ADVICE } from '../../sizing';
import { TARGET_SIZE, type TargetSizeOptions } from '../../target';
import { textScaleOf } from '../../typeFloors';
import { currentSmallValues } from '../../formatPrecision';
import { maxOf, minOf, pushAll } from '../../arrays';
import { emptyIdRecord } from '../../idRecords';

export interface TableMarks {
  table: Rect;
  columns: { id: Id; x: number; w: number }[];
  rows: { id: Id; y: number; h: number }[];
  headerBand: Rect;
}

/**
 * One rule weight. The two-weight system drew the header, the
 * totals and the close at 1.5 px, which renders as a 2 px grey smear beside
 * the 1 px row rules; hairlines throughout read cleaner and say
 * which rule matters through its ink (`axis` for structure, `grid` between
 * rows), not through its weight.
 */
/** Crisp 1px strokes sit on half-pixel y (stroke centered → fills one row of pixels). */
const CRISP = 0.5;
/**
 * Baseline lock for inline notes: under dominant-baseline=text-before-edge
 * the baseline sits ≈0.88·size below the node y — a note shares its host's
 * baseline when its top is shifted by the ascent difference.
 */
const NOTE_BASELINE_LOCK = 0.88;
/** Constant gap between the column headers and the rule under them. */
const HEADER_RULE_GAP = 7;
/**
 * The default group row in the terms of `theme.table.groupPad`: its
 * line box plus 9 px is 6 px of air, the line box, the 1 px hairline and
 * 2 px of air, with the hairline where the default row draws it.
 */
const GROUP_PAD_TOP = 6;
const GROUP_PAD_BOTTOM = 2;
/** The cell a heat-only grid draws: ground alone, 22 x 14. */
const HEAT_ONLY_ROW_H = 14;
/**
 * Row labels, text and status cells are names; the part alone reads as a
 * value. `cellHoldsNumber` is the shared rule, so the SVG and the
 * HTML table agree on which cells carry figures.
 */
function cellRole(kind: ColumnKind, text: string): { role?: 'category' } {
  return cellHoldsNumber(kind, text) ? {} : { role: 'category' };
}

const COMPACT_RETRY = Symbol('tableCompactRetry');
/** A class-floor probe reads sizing, not the selected rung's scene. */
const SIZING_ONLY = Symbol('tableSizingOnly');
/** A ladder step lets the value heads wrap to two lines. */
const HEAD_LINES = Symbol('tableHeadLines');
/** The tight rung (refuse-less): which air shrinks, across (cell air, gaps, side margins) and down (row air, top and bottom margins). */
const TIGHT_SPACING = Symbol('tableTightSpacing');
/** The head and group rows at their least air (no air above the head, 7 px to its rule), whatever the theme's `headPad` and `groupPad`. */
const HEAD_AIR_MIN = Symbol('tableHeadAirMin');
/** The tight rung's cell air; a column gap is twice this, the side margin too. */
const TIGHT_PAD = 2;
/** The last height step: sub-labels on one line, cut with a title, where a pinned height misses. */
const SUB_LINES = Symbol('tableSubLines');
/** Regular spacing only: no tight rung. A caller that has other regular forms to try first (dimswitch) or only reads the floor (classFloor) sets it. */
export const REGULAR_SPACING = Symbol('tableRegularSpacing');
/** The compact retry carries the canvas height its caller gave the full table. */
type LayoutOptions = TableOptions & { [SIZING_ONLY]?: boolean; [COMPACT_RETRY]?: number; [HEAD_LINES]?: number; [TIGHT_SPACING]?: { columns: boolean; rows: boolean }; [HEAD_AIR_MIN]?: boolean; [SUB_LINES]?: number; [REGULAR_SPACING]?: boolean; [ENGINE_NOTES]?: string[]; [SOFT_LABEL_CAP]?: boolean; [LABEL_WRAP_FLOOR]?: boolean };
type FormatFits = Map<string, ReturnType<typeof fitTableFormats>>;
/** The frame gutter of a card-class table: 12 px a side at 480 px and narrower. */
const CARD_GUTTER = 12;

/** The cell texts a layout cut (each keeps its full text as a title). */
function cutCount(geometry: Geometry<TableMarks, TableDerived>): number {
  return geometry.scene.filter((node) => node.t === 'text' && node.id.startsWith('cell:') && node.title !== undefined).length;
}

/**
 * Try the full table, then step down before refusing:
 * the 12 px gutter, then cell air to 6 px, then to 3 px, then value heads
 * on two lines, all at the table's own density, and last the compact
 * density with a row-driven height. The first step that fits draws; a table
 * that fits none reports the floor of the last, which is the narrowest it
 * can draw. A table keeps the frame's own margin at every width: the 12 px
 * gutter is a rung, taken where the table would otherwise refuse or cut a
 * text.
 */
export function layoutTable(authoredData: TableData, options: TableOptions = {}, resolved = resolveTable(authoredData, options)): Geometry<TableMarks, TableDerived> {
  // A nonzero figure lifted off "0.0" ("0.0005") is wider than the plain rounded text. Where that costs a refusal,
  // a cut or a compact step the rounded text does not take, it prints its bound ("<0.1"), also where the bound costs
  // one too: the automatic number rule never prints a nonzero figure as a bare "0.0". Only where the bound would
  // refuse a size the rounded text draws at does the rounded text draw.
  return liftOrFallback((mode) => {
    if (mode === 'full') return layoutTableLadder(authoredData, options, resolved);
    const step = { ...options, [ZERO_LIFT]: mode } as TableOptions & ZeroLiftOptions;
    return layoutTableLadder(authoredData, step, resolveTable(authoredData, step));
  }, (lifted, plain) => costsWidth(lifted, plain, options), resolved.lifted,
  (bound, plain) => missesFrame(bound, options) && !missesFrame(plain, options));
}

/** Whether a table layout misses the size its frame fixes. */
function missesFrame(geometry: Geometry<TableMarks, TableDerived>, options: TableOptions): boolean {
  const open = (options as TargetSizeOptions)[TARGET_SIZE]?.fixed;
  return geometry.sizing !== undefined
    && ((open?.width !== false && geometry.size.width < geometry.sizing.minWidth)
      || (options.size !== undefined && open?.height !== false && geometry.size.height < geometry.sizing.minHeight));
}

/** Whether `lifted` refuses, misses its frame, cuts or steps down where `plain` does not. */
function costsWidth(lifted: Geometry<TableMarks, TableDerived>, plain: Geometry<TableMarks, TableDerived>, options: TableOptions): boolean {
  const misses = (geometry: Geometry<TableMarks, TableDerived>) => missesFrame(geometry, options);
  if (misses(plain)) return false;
  if (misses(lifted) || cutCount(lifted) > cutCount(plain)) return true;
  const stepped = new Set(['table-compact-fallback', 'table-column-clipped', 'table-overflow', 'table-formats-fitted']);
  const before = new Set(plain.warnings.map((warning) => warning.code));
  return lifted.warnings.some((warning) => stepped.has(warning.code) && !before.has(warning.code));
}

/**
 * The theme's group-row air. A side the theme leaves out keeps the air the
 * default row gives it, 6 px above the line box and 2 px under the hairline
 * that closes it, so a theme that names one side moves that side alone.
 * Undefined: the theme names neither side and the default row draws.
 */
function themeGroupPad(theme: Theme): { top: number; bottom: number } | undefined {
  const pad = theme.table?.groupPad;
  return pad?.top === undefined && pad?.bottom === undefined ? undefined : { top: pad?.top ?? GROUP_PAD_TOP, bottom: pad?.bottom ?? GROUP_PAD_BOTTOM };
}

/** Whether a group-row air is more than the default row's 9 px around the line box, its hairline included. */
const groupAirAboveLeast = (pad: { top: number; bottom: number }, ruleSpace: number) => pad.top + ruleSpace + pad.bottom > 9;

/** Whether the theme gives the head or group row more air than its least. */
function hasHeadAir(options: TableOptions): boolean {
  const theme = chartTheme(options);
  const group = themeGroupPad(theme);
  return (theme.table?.headPad?.top ?? 0) > 0 || (theme.table?.headPad?.bottom ?? HEADER_RULE_GAP) > HEADER_RULE_GAP
    || (group !== undefined && groupAirAboveLeast(group, Math.ceil(strokeToken(theme, 'hair'))));
}

// The fit ladder changes spacing, not cell values or cohort density.
function layoutTableLadder(authoredData: TableData, options: TableOptions, resolved: ReturnType<typeof resolveTable>): Geometry<TableMarks, TableDerived> {
  const base = options;
  const sizingOnly = (options as LayoutOptions)[SIZING_ONLY] === true;
  const formatFits: FormatFits = new Map();
  const once = (step: LayoutOptions) => layoutTableOnce(authoredData, step, resolved, sizingOnly, formatFits);
  const targetSize = (options as TargetSizeOptions)[TARGET_SIZE];
  // A floor that misses full width never reads its scene. Keep the initial height pass intact.
  const fullSizingOnly = sizingOnly && resolveSize(options.size).width !== targetSize?.sizePx.width;
  let full = layoutTableOnce(authoredData, base, resolved, fullSizingOnly, formatFits);
  // A wider-size patch reruns the original spacing. A compact rung must not
  // advertise a width that fits only its temporary margins or cell padding.
  const widthRepair = full.warnings.find(warning => warning.code === 'table-overflow' && warning.fix?.length);
  const withWidthRepair = (drawn: Geometry<TableMarks, TableDerived>) => {
    if (widthRepair) drawn.warnings = drawn.warnings.map(warning =>
      warning.code === 'table-overflow' && warning.fix?.length ? widthRepair : warning);
    return drawn;
  };
  // A side the caller left open is no limit: the frame grows there, so only a fixed side can miss.
  // The registry lays an open side out at a provisional size and names it open in TARGET_SIZE.
  const open = (options as TargetSizeOptions)[TARGET_SIZE]?.fixed;
  const widthFits = (geometry: Geometry<TableMarks, TableDerived>) => open?.width === false || geometry.size.width >= (geometry.sizing?.minWidth ?? 0);
  const heightFits = (geometry: Geometry<TableMarks, TableDerived>) => options.size === undefined || open?.height === false || geometry.size.height >= (geometry.sizing?.minHeight ?? 0);
  const pad = options.cellPadX ?? trackCellPadX(full.marks.columns.length);
  const margin = { ...base.margin, left: Math.min(base.margin?.left ?? CARD_GUTTER, CARD_GUTTER), right: Math.min(base.margin?.right ?? CARD_GUTTER, CARD_GUTTER) };
  // The gutter rung: the full table with 12 px sides, where the frame's own margin is wider.
  const gutterHelps = full.plot.x > margin.left + 0.5 || full.size.width - (full.plot.x + full.plot.w) > margin.right + 0.5;
  const fits = (geometry: Geometry<TableMarks, TableDerived>) => widthFits(geometry) && heightFits(geometry);
  // An open height keeps a rung's own: the frame grows to the rows that rung draws.
  const fixedHeight = !heightOmitted(options.size) && open?.height !== false;
  /** The floor is the last rung's: the compact table draws where this rung's tracks or rows no longer fit. */
  const withFloor = (drawn: Geometry<TableMarks, TableDerived>) => {
    const compact = drawn.sizing === undefined ? undefined : compactTable(authoredData, options, full, margin, Math.min(pad, 3), 2, resolved, true, formatFits);
    if (compact?.sizing && !compact.refused) {
      drawn.sizing = { ...drawn.sizing!, minWidth: Math.min(drawn.sizing!.minWidth, compact.sizing.minWidth),
        minHeight: fixedHeight ? Math.min(drawn.sizing!.minHeight, compact.sizing.minHeight) : drawn.sizing!.minHeight };
    }
    return withWidthRepair(drawn);
  };
  if (options.belowMinimum === 'refuse' || !full.sizing) return full;
  if (fits(full)) {
    if (fullSizingOnly) full = layoutTableOnce(authoredData, base, resolved, false, formatFits);
    // A table that fits names the same minimum as one that steps down (one minimum at every width).
    // An open width keeps the full table's: the frame grows to it rather than stepping down.
    const cut = cutCount(full);
    const gutter = cut === 0 || !gutterHelps ? undefined : layoutTableOnce(authoredData, { ...base, margin }, resolved, false, formatFits);
    const drawn = gutter?.sizing !== undefined && fits(gutter) && cutCount(gutter) < cut ? gutter : full;
    return open?.width === false ? drawn : withFloor(drawn);
  }
  // Head air gives way before row air: a pinned height that the theme's head and group air
  // alone miss keeps the full rows with the head at its least air.
  if (widthFits(full) && fixedHeight && hasHeadAir(options)) {
    const lean = once({ ...base, [HEAD_AIR_MIN]: true });
    if (lean.sizing !== undefined && fits(lean)) {
      withFloor(lean);
      lean.warnings.push({ code: 'table-compact-fallback', severity: 'info', message: 'The full table did not fit. The head and group rows took their least air.' });
      return lean;
    }
  }
  // A table that misses on height alone goes straight to the compact density: air between figures does not buy rows.
  if (widthFits(full)) return withWidthRepair(compactTable(authoredData, options, full, margin, Math.min(pad, 6), undefined, resolved, sizingOnly, formatFits));
  const rung = (step: { pad: number; heads?: number }) =>
    once({ ...base, margin, cellPadX: step.pad, ...(step.heads === undefined ? {} : { [HEAD_LINES]: step.heads }) });
  // Each rung is narrower than the one before, so where the narrowest misses the width every rung does.
  const narrowest = rung({ pad: Math.min(pad, 3), heads: 2 });
  if (narrowest.sizing !== undefined && !widthFits(narrowest)) return withWidthRepair(compactTable(authoredData, options, full, margin, Math.min(pad, 3), 2, resolved, sizingOnly, formatFits));
  const tried = new Set<string>(gutterHelps ? [] : [`${pad}`]);
  for (const step of [{ pad }, { pad: Math.min(pad, 6) }, { pad: Math.min(pad, 3) }, { pad: Math.min(pad, 3), heads: 2 }]) {
    const key = `${step.pad}${step.heads === undefined ? '' : `:${step.heads}`}`;
    if (tried.has(key)) continue;
    tried.add(key);
    const last = step.heads === undefined ? rung(step) : narrowest;
    if (last.sizing === undefined || (widthFits(last) && heightFits(last))) {
      withFloor(last);
      last.warnings.push({ code: 'table-compact-fallback', severity: 'info', message: `The full table did not fit. ${step.pad === pad && step.heads === undefined ? '12 px side margins were' : `${step.pad} px cell air${step.heads === undefined ? '' : ', heads on two lines'} and 12 px side margins were`} used.` });
      return last;
    }
  }
  return withWidthRepair(compactTable(authoredData, options, full, margin, Math.min(pad, 3), 2, resolved, sizingOnly, formatFits));
}

/** The registered table layout: the ladder above, then the height floor at card widths. */
export function layoutTableCard(data: TableData, options: TableOptions = {}): Geometry<TableMarks, TableDerived> {
  return memoLayout(data, options, () => cardHeightFloor(layoutTableCard, data, options, classFloor(layoutTable, data, options, layoutTable(data, options))));
}

const layouts = new WeakMap<object, Map<string, unknown>>();
const functionIds = new WeakMap<object, number>();
let nextFunctionId = 0;

/**
 * One request lays a table out many times (the fit passes, the repair loop,
 * the legend probe, the React render after measure), and each layout climbs
 * the whole ladder. A layout is a pure function of its data and options, so
 * the registered table layouts keep each result per data object and hand
 * out a deep copy, which a caller may change. The key holds the data too, so
 * data changed in place lays out again; a function in the options (the text
 * measurer) enters the key by identity. A theme named by string always lays
 * out, because a custom theme can be registered again under its name.
 * shortcut: 32 results per data object, then the map starts again.
 */
export function memoLayout<G>(data: object, options: object, layout: () => G): G {
  if (typeof (options as { theme?: unknown }).theme === 'string') return layout();
  const key = layoutKey(data, options);
  let byKey = layouts.get(data);
  if (!byKey || byKey.size >= 32) layouts.set(data, byKey = new Map());
  if (!byKey.has(key)) byKey.set(key, layout());
  return deepCopy(byKey.get(key)) as G;
}

/**
 * The cache key of a layout: the data, the options and their symbol keys.
 * A function (the text measurer) enters by identity. The data is part of the
 * key, so data changed in place never reads an older result.
 */
export function layoutKey(data: object, options: object): string {
  const symbols = Object.getOwnPropertySymbols(options).map((symbol) => [symbol.description, (options as Record<symbol, unknown>)[symbol]]);
  // The smallValues mode in force too: a nested table inherits its enclosing chart's mode.
  return JSON.stringify([data, options, symbols, currentSmallValues()], (_key, value: unknown) => {
    if (typeof value !== 'function') return value;
    if (!functionIds.has(value)) functionIds.set(value, nextFunctionId++);
    return `function ${functionIds.get(value)}`;
  });
}

/** Copy shared fonts and cells once per result. A copy of every array, Map, Set and plain object; a function and any other value is shared (the compiled options hold the measurer). */
function deepCopy<T>(value: T, copies = new Map<object, unknown>()): T {
  if (value === null || typeof value !== 'object') return value;
  if (copies.has(value)) return copies.get(value) as T;
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    copies.set(value, copy);
    for (const entry of value) copy.push(deepCopy(entry, copies));
    return copy as T;
  }
  if (value instanceof Map) {
    const copy = new Map();
    copies.set(value, copy);
    for (const [key, entry] of value) copy.set(key, deepCopy(entry, copies));
    return copy as T;
  }
  if (value instanceof Set) {
    const copy = new Set();
    copies.set(value, copy);
    for (const entry of value) copy.add(deepCopy(entry, copies));
    return copy as T;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return value;
  // A null-prototype record (cells keyed by column id) stays one, so a column named __proto__ keeps its cell.
  const copy: Record<PropertyKey, unknown> = footerPlans.has(value as FrameGeometry)
    ? copyFrame(value as FrameGeometry) as Record<PropertyKey, unknown> : Object.getPrototypeOf(value) === null ? emptyIdRecord() : {};
  copies.set(value, copy);
  for (const key of Reflect.ownKeys(value)) copy[key] = deepCopy((value as Record<PropertyKey, unknown>)[key], copies);
  return copy as T;
}

/**
 * With the ladder, a table reports one minimum
 * width at every frame width. The floor a layout measures is in the type
 * class of its own frame, and a narrower class draws smaller type, so a
 * 1,200 px frame would measure 715 px where the table draws at 704. The floor is
 * laid out again at the width it names until it names itself. A grid panel
 * keeps the floor of its own frame.
 */
export function classFloor<D extends object, O extends Omit<TableOptions, 'variant'>, G extends Geometry<TableMarks, object>>(
  layout: (data: D, options: O) => G, data: D, options: O, geometry: G,
): G {
  if (geometry.refused || !geometry.sizing || panelTypeClass(options) !== undefined) return geometry;
  const sizing = geometry.sizing;
  if (sizing.minWidth >= geometry.size.width || typeWidthClass(sizing.minWidth) === typeWidthClass(geometry.size.width)) return geometry;
  // At the height the fix names: a frame too short for the rows refuses there, and the floor must hold at its fix.
  const height = Math.max(geometry.size.height, sizing.minHeight);
  let byKey = classFloors.get(data);
  if (!byKey || byKey.size >= 32) classFloors.set(data, byKey = new Map());
  // The registry lays a table out several times per request; the floor is cached per data and options.
  const key = layoutKey(data, { ...options, size: [sizing.minWidth, typeWidthClass(geometry.size.width), height] });
  let floor = byKey.get(key);
  if (floor === undefined) {
    floor = sizing.minWidth;
    for (let pass = 0; pass < 3 && typeWidthClass(floor) !== typeWidthClass(geometry.size.width); pass++) {
      // The regular floor: the tight rung only draws where a request misses it, and probing it here cost every fitting table 3-4 layouts.
      const probe = layout(data, { ...options, size: { width: floor, height }, [SIZING_ONLY]: true, [REGULAR_SPACING]: true });
      if (probe.refused || !probe.sizing || probe.sizing.minWidth >= floor) break;
      floor = probe.sizing.minWidth;
    }
    byKey.set(key, floor);
  }
  if (floor !== sizing.minWidth) geometry.sizing = { ...sizing, minWidth: floor };
  return geometry;
}

const classFloors = new WeakMap<object, Map<string, number>>();
const cardHeights = new WeakMap<object, Map<string, number | undefined>>();

/**
 * A table takes its height from its content: under
 * 480 px a card is never shorter than the same table at the next wider card
 * step (400, then 480), so 320 >= 400 >= 480. The narrower card can be
 * shorter because a head that wrapped at the wider step fits on one line, or
 * a period the card leaves out took a line. The wider card is laid out by the
 * same layout and its height is cached per data object and options. A fixed
 * height and a panel in a grid keep their own height.
 */
export function cardHeightFloor<D extends object, O extends Omit<TableOptions, 'variant'>, G extends Geometry<TableMarks, object>>(
  layout: (data: D, options: O) => G, data: D, options: O, geometry: G,
): G {
  const width = geometry.size.width;
  const automatic = (options as TargetSizeOptions)[TARGET_SIZE]?.fixed?.height === false;
  if (!automatic || geometry.refused || !geometry.sizing || width >= CARD_CLASS_WIDTH || panelTypeClass(options) !== undefined) return geometry;
  const step = width < 400 ? 400 : CARD_CLASS_WIDTH;
  let byKey = cardHeights.get(data);
  if (!byKey || byKey.size >= 32) cardHeights.set(data, byKey = new Map());
  const key = layoutKey(data, { ...options, size: step });
  if (!byKey.has(key)) {
    const wider = layout(data, { ...options, size: { width: step } });
    byKey.set(key, wider.refused || !wider.sizing ? undefined : wider.sizing.naturalHeight);
  }
  const floor = byKey.get(key);
  if (floor !== undefined && floor > geometry.sizing.naturalHeight) geometry.sizing = { ...geometry.sizing, naturalHeight: floor };
  return geometry;
}

/** The last step: the compact density, tight margins and, where the height was left open, a row-driven height. */
function compactTable(
  authoredData: TableData, options: TableOptions, full: Geometry<TableMarks, TableDerived>,
  margin: NonNullable<TableOptions['margin']>, cellPadX: number, heads: number | undefined,
  resolved: ReturnType<typeof resolveTable>, sizingOnly: boolean, formatFits: FormatFits,
): Geometry<TableMarks, TableDerived> {
  const compactOptions: LayoutOptions = {
    ...options,
    density: isCohortDensity(options.density ?? 'regular') ? options.density : 'compact',
    margin,
    // Tighter than the full table, never wider: a dense table already pads 3 or 5 px.
    cellPadX,
    labelIndent: { base: 8 + (options.outlineMarks === true ? INDENT_BASE : 0), step: 8 },
    // A fixed height never grows (docs/manual.md, "Fixed height"): only an omitted height turns automatic.
    size: heightOmitted(options.size) ? { width: full.size.width } : { width: full.size.width, height: full.size.height },
    [COMPACT_RETRY]: full.size.height,
    ...(heads === undefined ? {} : { [HEAD_LINES]: heads }),
  };
  let compact = layoutTableOnce(authoredData, compactOptions, resolved, sizingOnly, formatFits);
  // Refuse-less: comfort air is a preference. Where the compact table still misses
  // a fixed side, the side margins, cell air and spacers shrink to a readable floor, and the row air
  // too where the height misses. Text, numbers and columns stay as they are; the warning names the
  // size that keeps compact spacing.
  // The most the tight rung can take across: cell air on both sides of each track, the side margins,
  // the spacers and the label indents. A miss wider than that skips the futile layout (a dimswitch
  // period search probes many such widths).
  const across = 2 * Math.max(0, cellPadX - TIGHT_PAD) * compact.marks.columns.length
    + Math.max(0, compact.plot.x - TIGHT_PAD * 2) + Math.max(0, compact.size.width - compact.plot.x - compact.plot.w - TIGHT_PAD * 2)
    + (authoredData.columnGroups ?? []).reduce((sum, group) => sum + Math.max(0, (group.spacer ?? 0) - TIGHT_PAD * 2), 0)
    + 6 + 4 * Math.max(0, maxOf(resolved.table.rows.map((row) => row.level))) + 4;
  const misses = missesSize(compact, options);
  const { width: missesWidth, height: missesHeight } = misses;
  const reachable = !missesWidth || (compact.sizing?.minWidth ?? 0) - compact.size.width <= across;
  let lastOptions = compactOptions;
  if (!(options as LayoutOptions)[REGULAR_SPACING] && compact.sizing && (missesWidth || missesHeight) && reachable) {
    const tightWarning = tightSpacingWarning(misses, { width: 'cell air, column gaps and side margins', height: 'row air and top and bottom margins' }, 'the table', 'compact', { ...compact, sizing: compact.sizing }, options);
    compact = layoutTableOnce(authoredData, lastOptions = {
      ...compactOptions, [TIGHT_SPACING]: { columns: missesWidth, rows: missesHeight },
      ...(missesWidth ? {
        cellPadX: Math.min(cellPadX, TIGHT_PAD),
        labelIndent: { base: TIGHT_PAD + (options.outlineMarks === true ? INDENT_BASE : 0), step: TIGHT_PAD * 2 },
      } : {}),
      margin: {
        ...(missesHeight ? { top: TIGHT_PAD * 2, bottom: TIGHT_PAD * 2 } : {}), ...margin,
        ...(missesWidth ? { left: Math.min(margin.left ?? CARD_GUTTER, TIGHT_PAD * 2), right: Math.min(margin.right ?? CARD_GUTTER, TIGHT_PAD * 2) } : {}),
      },
    }, resolved, sizingOnly, formatFits);
    compact.warnings.push(tightWarning);
  }
  // A pinned height that still misses takes the sub-labels back to one line before it refuses:
  // a wrapped sub-label must not refuse a table that draws with it on one line. Each keeps its
  // track's cell air, cut with the full text as a title, as a head label is.
  if (missesHeight && compact.sizing && compact.size.height + 0.5 < compact.sizing.minHeight
    && resolved.table.columns.some((col) => col.subLabel !== undefined)) {
    const warnings = compact.warnings;
    compact = layoutTableOnce(authoredData, { ...lastOptions, [SUB_LINES]: 1 }, resolved, sizingOnly, formatFits);
    // The tight rung's size advice still holds.
    for (const warning of warnings) if (warning.code === 'table-tight-spacing' && !compact.warnings.includes(warning)) compact.warnings.push(warning);
  }
  compact.warnings.push({ code: 'table-compact-fallback', severity: 'info', message: `The full table did not fit. Compact spacing and tight margins${heightOmitted(options.size) ? ' and automatic height' : ''} were used.` });
  return compact;
}

function layoutTableOnce(authoredData: TableData, options: LayoutOptions, initialResolved: ReturnType<typeof resolveTable>, sizingOnly: boolean, formatFits: FormatFits): Geometry<TableMarks, TableDerived> {
  const tight = options[TIGHT_SPACING]?.columns === true;
  const tightRows = options[TIGHT_SPACING]?.rows === true;
  let size = resolveSize(options.size);
  const measure = options.measure ?? defaultMeasurer;
  let data = authoredData;
  let resolved = initialResolved;
  const warnings: LintWarning[] = [...resolved.warnings];
  const theme = resolveSemanticPaletteTheme(
    chartTheme(options),
    options.palette,
    warnings,
  );
  // Reserve whole pixels so fractional rules keep the table tracks aligned.
  const ruleSpace = Math.ceil(strokeToken(theme, 'hair'));
  // `table.section.rule`: a heavy rule in the text ink (twice the rule
  // stroke) under a section label, or the row hairline. It sits inside the
  // section row, which reserves its whole pixels.
  const heavySectionRule = theme.table?.section?.rule !== 'hair';
  /** The quiet rule between body rows, under a column-group heading and down a column divider. */
  const rowRuleWidth = theme.table?.ruleWidths?.row ?? strokeToken(theme, 'hair');
  const sectionRuleWidth = heavySectionRule ? 2 * strokeToken(theme, 'rule') : rowRuleWidth;
  const sectionRuleSpace = Math.ceil(sectionRuleWidth);
  // Formats that fit their authored tracks: shortened before
  // anything is measured, so every width, claim and hoisted unit below reads
  // the strings the table prints.
  if (options.fitFormats === true) {
    const padX = options.cellPadX ?? trackCellPadX(visibleColumns(resolved.table).length);
    // Within one ladder only density and cell air change the format-fitting inputs.
    const fitKey = `${options.density ?? 'regular'}:${padX}`;
    let fitted = formatFits.get(fitKey);
    if (!formatFits.has(fitKey)) {
      const fitLadder = levelLadder(theme, options.density ?? 'regular', options.target, textScaleOf(options));
      const fitFonts = tableFonts(theme, fitLadder);
      const rowById = new Map(resolved.table.rows.map((row) => [row.id, row]));
      const fitChanges = new Set(resolved.table.rows.filter(row => visibleInlineRows(row, options.inlineVisibility).length > 0).map(row => row.id));
      fitted = fitTableFormats(data, options, resolved, (table) => visibleColumns(table), {
        measure,
        padX,
        cellFont: (cell) => {
          const row = rowById.get(cell.rowId);
          return kindFont(ladderRowFont(theme, fitLadder, fitFonts, cell.role, row?.step ?? cell.level, row?.hasChildren === true, fitChanges.size > 0 && fitChanges.has(cell.rowId)), row?.kind, cell.kind === 'rowLabel', theme);
        },
        figures: (col, text) => cellDrawsTabular(theme, col.kind, text),
        lineFont: (parent, line, text, tabular) => changeLineFitFont(theme, fitLadder, parent.step, line.polarity !== undefined, text, measure, tabular),
        ...(options.locale?.decimal === undefined ? {} : { decimal: options.locale.decimal }),
      });
      formatFits.set(fitKey, fitted);
    }
    if (fitted !== undefined) {
      const warningsAfter = warnings.splice(resolved.warnings.length);
      warnings.length = 0;
      pushAll(warnings, fitted.resolved.warnings);
      pushAll(warnings, warningsAfter);
      const fittedNote = formatsFittedWarning(fitted.changes);
      if (fittedNote !== undefined) warnings.push(fittedNote);
      data = fitted.data;
      resolved = fitted.resolved;
    }
  }

  const table = resolved.table;
  // The totals-only step of a depth control: every level-0 data row
  // goes with its subtree and the totals and section headings stay.
  const dataRows = visibleRows(table, undefined, expansionRootsHidden(table, options.expansion));
  // A table with no data row draws one row under its head that says so; the React grid draws the same row.
  const rows = hasNoDataRows(table) ? [...dataRows, emptyMessageRow(table, DEFAULT_EMPTY_MESSAGE)] : dataRows;
  // Column widths follow the full data set: every authored row before topN
  // folds it (collapsed rows included), plus the rows topN generates. Another
  // sort, topN or expansion then keeps every column in place, unless a
  // generated rest label is wider than every authored one.
  const fullRows = options.topN ? resolveTable(data, { ...options, topN: undefined }).table.rows : table.rows;
  const fullIds = new Set(fullRows.map((row) => row.id));
  const widthRows = [...fullRows, ...table.rows.filter((row) => !fullIds.has(row.id)), ...rows.filter((row) => !fullIds.has(row.id) && !table.rows.includes(row))];
  const cols = visibleColumns(table);
  const spans = groupSpans(table, cols);
  /**
   * Runs of neighbouring banded columns. A band on the columns
   * themselves is how a block inside a group gets its ground: the FY-to-date
   * pair at the end of a twelve-month group is a band, and a group of its
   * own there would split the toggle that covers the fiscal year.
   */
  const bandedColumnRuns: { columnIds: Id[] }[] = [];
  for (const col of cols) {
    if (col.band !== true) continue;
    const previous = bandedColumnRuns[bandedColumnRuns.length - 1];
    const neighbour = previous !== undefined
      && cols[cols.indexOf(col) - 1]?.id === previous.columnIds[previous.columnIds.length - 1];
    if (neighbour) previous!.columnIds.push(col.id);
    else bandedColumnRuns.push({ columnIds: [col.id] });
  }

  /**
   * The empty track a column group stands off by: 16 px between
   * the metric blocks of a cohort grid. It carries no cell, so nothing is
   * drawn in it and the hover of the block beside it stops at its edge.
   */
  const spacerBefore = new Map<Id, number>();
  for (const group of table.columnGroups) {
    if (group.spacer === undefined || group.spacer <= 0) continue;
    const first = cols.find((col) => group.columnIds.includes(col.id));
    if (first === undefined || first.id === cols[0]?.id) continue;
    spacerBefore.set(first.id, tight ? Math.min(group.spacer, TIGHT_PAD * 2) : group.spacer);
  }
  /**
   * The room the spacers take beside the tracks. Every test of the
   * table's width against its plot counts them, and so do the widths it
   * reports: `cohort-heat-blocks` drew 1,080 px into a 1,056 px plot with no
   * warning, because only its columns were counted.
   */
  const spacerTotal = [...spacerBefore.values()].reduce((a, b) => a + b, 0);
  /**
   * Heat-only mode: the grounds carry the reading and the figures
   * come off, so a sixty-column triangle fits one screen. The heads keep
   * their labels and the a11y table keeps every number. Only a column that
   * carries a heat lane drops its figures: the core columns beside the
   * matrix keep theirs, and so does a total row, which takes no ground to
   * read. A table with no heat column keeps them all, since the option
   * parse can be skipped on the way here.
   */
  const figures = printsFigures(options.figures, cols);
  // A heat-only matrix (`figures: false`) keeps the quiet grid hairline: a visible rule would stripe its thin cells.
  const rowRule: { paint: Paint; width: number } = figures ? { paint: tableRuleInk(), width: rowRuleWidth } : { paint: { token: 'grid' }, width: strokeToken(theme, 'hair') };
  if (options.figures === false && figures) {
    warnings.push({
      code: 'figures-need-heat',
      severity: 'warn',
      message: "figures: false needs a heat column, and this table draws none, so it prints its figures",
      field: ['options', 'figures'],
      suggest: "Remove figures: false, or give a column a heat lane in options.encodings.",
    });
  }

  // Horizontal cell air: the column-count default, or the px an author
  // names for a board with tighter tracks.
  let cellPadX = options.cellPadX ?? trackCellPadX(cols.length);
  let occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  // A lane cut at fixed edges names them in one row above the grid.
  // `legend: 'none'` drops the row: a host that draws its own key
  // for the same scale would otherwise show two.
  const keyless = options.legend === 'none';
  // One lane per heat column, derived where both surfaces can ask for it.
  const heatLanes = heatRanges(cols, rows);
  const heatEntries = heatKey(cols, heatLanes, theme, options.strings, options.locale?.language);
  // The arrow shapes a table draws, keyed in the same row.
  const arrowShapes = arrowKey(cols, rows);
  if (keyless) legendOff(warnings, 'table', [...heatEntries, ...arrowShapes].map((entry) => entry.label));
  const keyEntries = keyless ? [] : heatEntries;
  const arrowEntries = keyless ? [] : arrowShapes;
  const authored = authoredNotes(options);
  const frameInput: Parameters<typeof solveFrame>[0] = {
      size,
      margin: { ...canvasMargin(theme, size.width), ...options.margin },
      ...frameTextOptions(options),
      // uniform money unit hoisted out of every cell → the frame slot
      // (solveFrame prepends 'in' itself)
      unit: table.unit ?? options.unit,
      // rows/cols, not table.rows/table.columns: this surface is static, so a
      // marker inside a collapsed row or a hidden column is unreachable here
      // and its footnote would point at nothing
      footnotes: [...tableFootnotes(table, rows, cols), ...authored, ...(options[ENGINE_NOTES] ?? [])],
      // Nothing in a table points at a note: no head or cell carries a
      // mark, so a "1)" before the note is a number the reader cannot follow
      // (the same rule as for the engine's own notes). The author's
      // notes stay notes and print without a number.
      numberedFootnotes: authored,
      unreferencedNotes: authored.map((_, i) => i + 1),
      // A table's notes read in the tertiary ink where the theme names one.
      footnoteInk: 'inkMeta',
      // The notes and the source keep the cell air in from both edges, as on React, also at canvas margin 0.
      footerInset: cellPadX,
      ...(keyEntries.length + arrowEntries.length > 0 ? {
        legend: {
          options: legendRequired(options.legend, warnings, 'table', theme, keyEntries.length > 0 ? 'its heat bands cut at edges no cell prints' : 'its arrow shapes stand for shares no cell prints'),
          items: [
            ...keyEntries.map((entry) => ({ id: entry.id, label: entry.label, paint: entry.fill, key: 'box' as const, stroke: { token: 'grid' as const } })),
            ...arrowEntries.map((entry) => ({ id: entry.id, label: entry.label, paint: { token: 'ink' as const }, key: 'glyph' as const, glyph: entry.glyph })),
          ],
        },
        legendFont: 'footnote' as const,
      } : {}),
      theme,
      measure,
  };
  let frame = solveFrame(frameInput, occupied);
  let plot = frame.plot;
  // Text drawn on an authored ground, by paint: whether it reads there is decided in the theme it is painted in.
  const groundTexts = new Map<string, Paint>();
  // Status labels cut to their track, by column, with the rows of a label drawn as the square alone: the notes list names each in full.
  const statusCuts = new Map<Id, Map<string, { shown: string; full: string; rows: string[] }>>();
  const statusFits = new Map<string, Map<string, { text: string; title?: string } | null>>();
  const surface = resolveSurface(theme);
  // ---- the level ladder ----
  // Every step is derived from `theme.type`, never written as a literal: a
  // level reads as one step down from its parent in size, weight and indent,
  // which is the whole hierarchy signal the table uses besides the ground.
  const density = options.density ?? 'regular';
  const language = presetLanguage(options.variant);
  const ladder = levelLadder(theme, density, options.target, textScaleOf(options));
  if (tightRows) {
    ladder.pad = () => 1;
    ladder.totalPad = 1;
    if (ladder.rowHeight !== undefined) ladder.rowHeight = ladder.lineBox(ladder.label) + 2;
  }
  const { lineBox, pad: levelPad } = ladder;
  const widthPlan = tableWidths(table, theme, measure, options, {
    columns: cols, rows, widthRows, fullRows, available: plot.w, spacerTotal, headLines: options[HEAD_LINES], subLines: options[SUB_LINES],
  });
  cellPadX = widthPlan.cellPadX;
  if (frameInput.footerInset !== cellPadX) {
    frameInput.footerInset = cellPadX;
    occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
    frame = solveFrame(frameInput, occupied);
    plot = frame.plot;
  }
  const nodes: SceneNode[] = [...frame.nodes];
  // The table grid lives on INTEGER pixels regardless of the frame's
  // fractional plot origin — hairlines on .92px y render as 2px grey smears
  // and 1/3px column anchors antialias into fake font-weight differences.
  const gridX = Math.round(plot.x);
  const gridY = Math.round(plot.y);
  const { widths, sizingMinimums, totalW, minimumW, fonts, regularFonts, columnHeaderText, cellFont, cellStep, rowIndent, operatorSlot, childCount, hasChanges: hasChangesById } = widthPlan;
  const rowFont = (role: RowRole, level: number, hasChildren: boolean, hasChanges = false): FontSpec =>
    ladderRowFont(theme, ladder, regularFonts, role, level, hasChildren, hasChanges);
  // Theme conventions for the ink: the section heading's colour, and
  // whether an ofWhich row whispers or keeps the text colour.
  const sectionInk = theme.table?.section?.ink;
  const ofWhichMuted = theme.table?.ofWhich !== 'ink';
  /**
   * The one place a row height is computed: the line box of the
   * row's own step plus its own air, plus the rule under it. A total is
   * closed above and below, so it carries both.
   */
  function rowHeight(row: ResolvedRow): number {
    if (row.role === 'total' && row.kind !== 'result' && row.kind !== 'driver') {
      // A total is closed above and below, so it carries both rules.
      return ladder.totalPad * 2 + lineBox(fonts.total.size) + 2 * ruleSpace;
    }
    if (row.role === 'section') {
      // A section after other rows opens a new block: `table.section.spaceBefore` of air
      // (default one body line box) above its label, inside the row so bands and grounds run on.
      // The first row under the head takes a quarter line box (never more), so its label has
      // at least the air above that its pad and rule give it below.
      // The compact and tight retries of a size that misses give the air back before the table refuses.
      if (tightRows || options[COMPACT_RETRY] !== undefined) return sectionNatural();
      const space = theme.table?.section?.spaceBefore ?? lineBox(ladder.label);
      return sectionNatural() + Math.round(row.id === rows[0]?.id ? Math.min(space, lineBox(ladder.label) / 4) : space);
    }
    const pad = levelPad(row.step, row.hasChildren);
    // A matrix density is a fixed pitch: the row takes it whatever its
    // level, and the 1 px rule under it is the grid's own gap.
    // Heat-only: the 14 px cell of the board, or the line box the resolved
    // face needs where the width class stepped the type up.
    if (!figures) return Math.max(HEAT_ONLY_ROW_H, lineBox(ladder.size(0)));
    if (ladder.rowHeight !== undefined) return ladder.rowHeight + inlineBlock(row).extra;
    return pad * 2 + lineBox(rowFont(row.role, row.step, row.hasChildren, hasChangesById.size > 0 && hasChangesById.has(row.id)).size) + ruleSpace
      + inlineBlock(row).extra;
  }
  /** A section heading's own box: its line and air, and the rule under it. */
  function sectionNatural(): number {
    return levelPad(1, false) * 2 + ladder.sectionBox(fonts.section.size) + sectionRuleSpace;
  }
  /** True where an inline line prints a VALUE in this column's cell. */
  function lineHoldsValue(line: ResolvedRow, colId: Id): boolean {
    const cell = line.cells[colId];
    return cell !== undefined && cell.state === 'value' && cell.displayed !== '';
  }
  /** The id of the row-label column, where a row's note prints under its label. */
  const labelColumnId = cols.find((col) => col.kind === 'rowLabel')?.id;
  /**
   * The note under a row's label. It is not a second word on the
   * label's line: "$k" sits under "Revenue (net)" on the ladder's inline
   * step, so the label column stops paying for both on one line.
   */
  function labelNoteOf(row: ResolvedRow): string | undefined {
    if (labelColumnId === undefined || row.role === 'section') return undefined;
    return row.cells[labelColumnId]?.note;
  }
  /**
   * The lines a row prints inside its own cells and what they cost it: one
   * gap under the value, then a line box each. A row-label note
   * takes the first of those boxes, so the change lines stay level across
   * the row. A row without either pays nothing and keeps the height the
   * ladder gave it.
   */
  const inlineBlocks = new Map<ResolvedRow, ReturnType<typeof inlineBlock>>();
  function inlineBlock(row: ResolvedRow): {
    lines: ResolvedRow[]; note?: string; box: number; extra: number; noteSlots: Map<Id, number>;
  } {
    const cached = inlineBlocks.get(row);
    if (cached !== undefined) return cached;
    const lines = visibleInlineRows(row, options.inlineVisibility);
    const box = ladder.inlineBox(Math.max(ladder.inlineSize(), lines.length ? changeLineFont(theme, ladder, row.step).size : 0));
    const note = labelNoteOf(row);
    const base = note === undefined ? 0 : 1;
    let stacked = base + lines.length;
    // A note in a `noteLine` column is a line of its own. It takes
    // the first slot where this cell's change lines hold no value: a
    // year-to-date block has no month before it, so its month-on-month line
    // reads n/a in every row, and that is the slot the board's "sum"
    // belongs in. Where every line of the cell holds a value, or the row
    // prints no line at all, the note takes the next slot and the row pays
    // one inline line for it.
    const noteSlots = new Map<Id, number>();
    for (const col of cols) {
      if (col.noteLine !== true || col.kind === 'rowLabel') continue;
      if (row.cells[col.id]?.note === undefined) continue;
      let slot = base + lines.length;
      for (const [index, line] of lines.entries()) {
        if (!lineHoldsValue(line, col.id)) { slot = base + index; break; }
      }
      noteSlots.set(col.id, slot);
      stacked = Math.max(stacked, slot + 1);
    }
    const block = {
      lines, ...(note === undefined ? {} : { note }), box, noteSlots,
      extra: stacked === 0 ? 0 : ladder.inlineGap + stacked * box,
    };
    inlineBlocks.set(row, block);
    return block;
  }
  const inlineFont = (level: number, signed: boolean): FontSpec => ladderInlineFont(theme, ladder, level, signed);
  const sumOf = (map: Map<Id, number>): number => [...map.values()].reduce((a, b) => a + b, spacerTotal);
  pushAll(warnings, widthPlan.warnings);
  function sizingProbe(sizing: ReturnType<typeof tableSizing>, marks: TableMarks): Geometry<TableMarks, TableDerived> {
    return {
      type: 'table', size, sizing, plot, scene: [], labels: [], axes: [], annotations: [], frame: frame.frame, marks,
      derived: { table, computedCells: resolved.computedCells }, a11y: { title: '', desc: '', counts: [] }, warnings,
      debug: { occupied: [], decisions: [] },
    };
  }
  // An open-height floor reads only minWidth; neither the ladder nor withFloor consumes its row geometry.
  if (sizingOnly && (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height === false && !heightOmitted(options.size)) {
    return sizingProbe(tableSizing(size, plot, plot.y, totalW, minimumW), {
      table: { x: gridX, y: gridY, w: totalW, h: 0 },
      columns: cols.map(col => ({ id: col.id, x: gridX, w: widths.get(col.id)! })), rows: [],
      headerBand: { x: gridX, y: gridY, w: totalW, h: 0 },
    });
  }
  // ---- geometry: header band + rows ----
  const hasGroups = table.columnGroups.length > 0;
  // A group may keep its meaning and draw no heading; where none
  // draws one, the head has no group row to pay for.
  const hasGroupHeads = table.columnGroups.some((g) => g.heading !== false);
  // The header band is its text plus the constant 7 px gap to the rule below
  // it — the gap must not drift with density, and the band
  // keeps no dead air above the text.
  // The head block's air, where the theme names it: above the head
  // text and between it and the rule, above the group heading and under its
  // hairline. Unset, the head keeps the constant 7 px gap and no top air,
  // and the group row its 9 px. The faces reserve the line box the grid
  // paints.
  // The compact fallback and the lean-head rung keep the head at its least
  // air, and never give a theme with less air more.
  const leanHead = options[HEAD_AIR_MIN] === true || options[COMPACT_RETRY] !== undefined;
  const headPadTop = tightRows || leanHead ? 0 : theme.table?.headPad?.top ?? 0;
  const themeHeadBottom = theme.table?.headPad?.bottom ?? HEADER_RULE_GAP;
  const headPadBottom = tightRows ? 2 : leanHead ? Math.min(themeHeadBottom, HEADER_RULE_GAP) : themeHeadBottom;
  const themeGroup = themeGroupPad(theme);
  const groupPad = tightRows ? { top: 2, bottom: 2 }
    : leanHead && themeGroup !== undefined && groupAirAboveLeast(themeGroup, ruleSpace) ? undefined : themeGroup;
  const headRoom = (col: ResolvedColumn) => Math.max(1, Math.round(widths.get(col.id)!) - 2 * cellPadX - (col.kind === 'rowLabel' ? rowIndent(0) : 0));
  const headerFits = new Map(cols.map(col => [col.id, fitText(columnHeaderText(col), fonts.header,
    headRoom(col), Infinity, measure, { target: options.target, typeRole: 'axis' })]));
  // The sub-label keeps inside the same cell air as the label above it, so
  // neighbouring heads keep the column gap: it wraps at a space, and a word
  // wider than the track takes the label's cut ("4 weeks before" over an
  // authored 84 px track ran into the head beside it).
  // A row-label head without a label draws nothing, so its sub-label keeps
  // one line of height instead of wrapping into blank lines.
  const subFits = new Map(cols.flatMap(col => col.subLabel === undefined ? [] : [[col.id, fitText(col.subLabel, fonts.sub,
    headRoom(col), !col.label && col.kind === 'rowLabel' ? 1 : options[SUB_LINES] ?? Infinity, measure, { target: options.target, typeRole: 'axis' })] as const]));
  // A second head line: the weekday under a date, the ISO week
  // under a week start. The head row pays one micro line box per sub-label
  // line and every PRIMARY label keeps the same baseline, whether its own
  // column carries a sub-label or not.
  const headerSubH = subFits.size === 0 ? 0
    : maxOf([...subFits.values()].map(fit => lineBox(fonts.sub.size) + (fit.lines.length > 1 ? (fit.h * (fit.lines.length - 1)) / fit.lines.length : 0)));
  const headerTextH = Math.max(fonts.header.size * 1.2, maxOf([...headerFits.values()].map(fit => fit.h)));
  const headerLabelH = headPadTop + Math.max(ladder.headBox(fonts.header.size), headerTextH) + headerSubH + headPadBottom + ruleSpace;
  const headerGroupH = !hasGroupHeads ? 0
    : groupPad === undefined ? ladder.headBox(fonts.group.size) + 9
      : groupPad.top + ladder.headBox(fonts.group.size) + ruleSpace + groupPad.bottom;
  const headerH = headerGroupH + headerLabelH;
  // The rule spans the group's columns by default, so it says which columns the heading covers; 'label' underlines the heading text alone.
  const spanRule = (options.groupRule ?? 'span') === 'span';
  const groupAlign = options.groupAlign ?? 'center';

  const colX = new Map<Id, { x: number; w: number }>();
  let x = gridX;
  for (const col of cols) {
    // An empty track before a metric block: the block stands off
    // its neighbour by 16 px and draws no cell there, so nothing else
    // moves and the group heading centres over its own columns.
    x += spacerBefore.get(col.id) ?? 0;
    const w = Math.round(widths.get(col.id)!);
    colX.set(col.id, { x, w });
    x += w;
  }
  const tableW = x - gridX;
  /**
   * How far a row reaches. 'tracks' stops its ground and its rules
   * where the last column ends. 'frame' runs them to the plot's right edge
   * when the columns end short of it, and to the canvas edge where the
   * author set a right margin: the margin insets the columns, not the rows.
   * A table wider than its plot keeps its own width.
   */
  // An authored left margin insets the columns the same way, and under
  // 'frame' the rows reach the canvas edge through it.
  const rowX = options.rowExtent === 'frame' && (options.margin?.left ?? 0) > 0 ? 0 : gridX;
  // Where frame fill leaves room beside a capped table, the room stays outside it and the rules end at the last track.
  // An explicit rowExtent 'frame' is the author's ask and keeps rows to the frame.
  const filledShort = options.rowExtent === undefined && options.frameFill !== 'none' && Math.floor(plot.w - tableW) >= 1;
  const rowToFrame = (options.rowExtent ?? 'frame') === 'frame';
  const rowW = rowToFrame && !filledShort
    ? Math.max(tableW + gridX - rowX, (options.rowExtent === 'frame' && (options.margin?.right ?? 0) > 0 ? size.width : Math.round(plot.x + plot.w)) - rowX)
    : tableW + gridX - rowX;

  // Prose cells wrap to two lines and their row grows; an ellipsis is the
  // last resort, never the first: a readout column that reads
  // "Price carry-over compensating…" fails the reader. A `wrap: true`
  // column takes as many lines as its text needs. Row labels follow the
  // same order: wrap before any cut.
  const wrappedLines = new Map<string, string[]>();
  const cutTitles = new Map<string, string>();
  const rowExtra = new Map<Id, number>();
  /** The height a row label's second line and own-line unit add above the row's inline lines. */
  const labelHead = new Map<Id, number>();
  /** Rows whose unit affix sits on its own line under the label (the order before a cut). */
  const affixBelow = new Set<Id>();
  // a cut row label keeps the tail that tells it from its siblings.
  const labelTexts = (colId: Id) => rows.flatMap((row) => row.role === 'section' ? [] : [row.cells[colId]?.displayed ?? '']);
  for (const row of rows) {
    // A section heading spans the table and wraps to two lines before its cut, so
    // "GROWTH FROM FIRST…" never prints beside free table width.
    const sectionCol = row.role === 'section' ? cols.find((col) => col.kind === 'rowLabel') : undefined;
    const sectionCell = sectionCol === undefined ? undefined : row.cells[sectionCol.id];
    if (sectionCol !== undefined && sectionCell?.displayed) {
      const font = cellFont(sectionCell);
      const text = theme.table?.section?.case === 'asis' ? sectionCell.displayed : sectionCell.displayed.toUpperCase();
      const badgeW = row.badge === undefined ? 0 : Math.round(measure(row.badge.text, fonts.chip).width + 2 * CHIP_PAD_X) + BADGE_GAP;
      const room = tableW - (colX.get(sectionCol.id)!.x - gridX) - 2 * cellPadX - rowIndent(cellStep(sectionCell)) - affixRoom(row, font) - badgeW;
      if (measure(text, font).width > room) {
        const wrap = fitText(text, font, Math.max(room, 20), 2, measure, { target: options.target, typeRole: 'label' });
        wrappedLines.set(tableCellKey(row.id, sectionCol.id), wrap.lines);
        if (wrap.title !== undefined) cutTitles.set(tableCellKey(row.id, sectionCol.id), wrap.title);
        if (wrap.lines.length > 1) rowExtra.set(row.id, Math.ceil((wrap.lines.length - 1) * font.size * 1.2));
      }
    }
    for (const col of cols) {
      const rowLabel = col.kind === 'rowLabel' && row.role !== 'section';
      if (col.kind !== 'text' && !rowLabel) continue;
      const cell = row.cells[col.id];
      if (!cell || !cell.displayed) continue;
      const font = cellFont(cell);
      const w = colX.get(col.id)!.w;
      const indent = cell.kind === 'rowLabel' ? rowIndent(cellStep(cell)) : 0;
      const room = w - 2 * cellPadX - indent
        - (cell.note && cell.kind !== 'rowLabel' && col.noteLine !== true ? measure(` ${cell.note}`, fonts.note).width : 0);
      const affix = cell.kind === 'rowLabel' ? affixRoom(row, font) : 0;
      const textW = measure(cell.displayed, font).width;
      // A wrapping text cell keeps the author's line breaks, also where the whole text would fit on one line.
      const authoredBreak = col.kind === 'text' && col.wrap === true && cell.displayed.includes('\n');
      if (textW <= room - affix && !authoredBreak) continue;
      // The order before a cut: the unit moves to its own
      // line under the name, then the name wraps to two lines; the row grows
      // for both, so the lines under the label move down with it. A cut is the
      // last resort and keeps the full name as its title.
      const ownLine = rowLabel && affix > 0;
      const maxW = ownLine ? room : room - affix;
      // Lines under the label without a label of their own leave their slots free: the label's
      // extra lines sit in them and the row grows only for the rest.
      const slack = rowLabel && !visibleInlineRows(row, options.inlineVisibility).some((line) => line.label !== '') ? inlineBlock(row).extra : 0;
      const affixHead = ownLine ? Math.ceil((theme.table?.qualifier === undefined ? inlineFont(row.step, false) : qualifierFont(font, theme)).size * 1.2) : 0;
      const setHead = (own: number) => {
        const head = Math.max(0, own - slack);
        if (head > 0) labelHead.set(row.id, head);
        if (head > 0) rowExtra.set(row.id, Math.max(rowExtra.get(row.id) ?? 0, head));
      };
      if (ownLine) {
        affixBelow.add(row.id);
        if (textW <= maxW) {
          wrappedLines.set(tableCellKey(row.id, col.id), [cell.displayed]);
          setHead(affixHead);
          continue;
        }
      }
      // A row label takes `rowLabelLines` and breaks after _ - / . too, so a long campaign name wraps.
      const wrap = rowLabel
        ? fitText(cell.displayed, font, Math.max(maxW, 20), options.rowLabelLines ?? 2, measure, { target: options.target, typeRole: 'label', breakAfter: true })
        : fitText(cell.displayed, font, Math.max(maxW, 20), col.kind === 'text' && col.wrap ? Infinity : 2, measure, { target: options.target, typeRole: 'label' });
      const last = rowLabel && wrap.title !== undefined
        ? distinctCut(cell.displayed, wrap.lines, labelTexts(col.id), font, Math.max(maxW, 20), measure, true) : undefined;
      if (last !== undefined) wrap.lines = [...wrap.lines.slice(0, -1), last];
      wrappedLines.set(tableCellKey(row.id, col.id), wrap.lines);
      if (wrap.title !== undefined) cutTitles.set(tableCellKey(row.id, col.id), wrap.title);
      // Whole pixels: the grid stays on integer y and its rules stay crisp.
      const grow = Math.ceil((wrap.lines.length - 1) * font.size * 1.2);
      if (rowLabel) setHead(grow + affixHead);
      else if (grow > 0) rowExtra.set(row.id, Math.max(rowExtra.get(row.id) ?? 0, grow));
    }
  }
  const rowY = new Map<Id, { y: number; h: number }>();
  let y = gridY + headerH;
  for (const [index, row] of rows.entries()) {
    // An empty band before the row, the row twin of a group spacer.
    // The first drawn row takes none: the head rule already opens the body.
    if (index > 0 && row.spacer !== undefined) y += Math.round(row.spacer);
    const h = rowHeight(row) + (rowExtra.get(row.id) ?? 0);
    rowY.set(row.id, { y, h });
    y += h;
  }
  const tableH = y - gridY;
  // Row-driven canvas: a table the author did not size
  // takes the height its rows need, never a 16:9 canvas with a blank third.
  {
    // The compact retry takes automatic height when the caller gave none, but the 1400 px cap never
    // squeezes it under the canvas its caller gave: a caller that probes the
    // floor the retry reports must get a table that fits there.
    const callerH = options[COMPACT_RETRY];
    const grow = rowDrivenHeight({ options: callerH === undefined || !heightOmitted(options.size) ? options : {}, width: size.width, height: size.height, chromeH: size.height - plot.h, rowsH: y - plot.y + 4,
      ...(callerH === undefined ? {} : { ceiling: callerH }) });
    if (grow !== undefined) return layoutTableOnce(authoredData, { ...options, size: { width: size.width, height: grow } }, initialResolved, sizingOnly, formatFits);
  }
  // The first open-height pass already measured the rows. Move only the frame
  // when its top and width stay fixed; otherwise the normal height retry handles it.
  const targetSize = (options as TargetSizeOptions)[TARGET_SIZE];
  if (!sizingOnly && targetSize?.fixed.height === false
    && size.width === targetSize.sizePx.width && size.height === targetSize.sizePx.height) {
    const height = tableSizing(size, plot, y, totalW, 0).naturalHeight;
    if (height !== size.height) {
      const nextSize = { width: size.width, height };
      const nextOccupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: height });
      const nextFrame = solveFrame({ ...frameInput, size: nextSize }, nextOccupied);
      if (nextFrame.plot.x === plot.x && nextFrame.plot.y === plot.y && nextFrame.plot.w === plot.w
        && tableSizing(nextSize, nextFrame.plot, y, totalW, 0).naturalHeight === height) {
        size = nextSize;
        occupied = nextOccupied;
        frame = nextFrame;
        plot = frame.plot;
        nodes.length = 0;
        pushAll(nodes, frame.nodes);
      }
    }
  }
  if (y > plot.y + plot.h) {
    warnings.push({
      code: 'table-overflow',
      severity: 'error',
      message: `${rows.length} rows exceed the plot height at density '${density}' — use 'compact', fewer rows, or a taller size`,
    });
  }

  // Render rules wrapping out only when the measured width floors prove it
  // cannot fit. Measurement verifies the full frame, including fixed heights.
  let wrapFits = false;
  if (widthPlan.wouldWrap.length > 0 && size.width - plot.w + sumOf(sizingMinimums) > size.width) {
    if ((options as { [VERIFY_ADVICE]?: boolean })[VERIFY_ADVICE]) {
      const ids = new Set(widthPlan.wouldWrap.map(col => col.id));
      const wrapped = { ...authoredData, columns: authoredData.columns.map(col => ids.has(col.id) ? { ...col, wrap: true } : col) };
      wrapFits = !missesFrame(layoutTable(wrapped, options), options);
    } else {
      wrapFits = widthPlan.wrapMinimumWidth === undefined || widthPlan.wrapMinimumWidth <= plot.w;
    }
  }
  const sizing = {
      ...tableSizing(size, plot, y, totalW, minimumW),
      ...(wrapFits
        ? { hint: `Or set wrap: true on text column ${widthPlan.wouldWrap.map((col) => `'${col.id}'`).join(', ')}: its cells then take as many lines as they need instead of one line's width.` }
        : {}),
    };
  // A floor probe only reads sizing; its tracks and wrapped rows are already measured.
  if (sizingOnly) return sizingProbe(sizing, { table: { x: gridX, y: gridY, w: tableW, h: tableH }, columns: cols.map(col => ({ id: col.id, ...colX.get(col.id)! })), rows: [], headerBand: { x: gridX, y: gridY, w: tableW, h: headerH } });

  const numericStats = new Map<
    Id,
    { min: number; max: number; maxAbs: number; textReserve: number; signed: boolean }
  >();
  for (const col of cols) {
    if (col.kind !== 'value' && col.kind !== 'computed') continue;
    const values: number[] = [];
    let textReserve = 0;
    for (const row of rows) {
      const cell = row.cells[col.id];
      if (!cell) continue;
      if (cell.state === 'value' && typeof cell.raw === 'number') values.push(cell.raw);
      textReserve = Math.max(textReserve, measure(cell.displayed, figureFont(cellFont(cell), cellDrawsTabular(theme, col.kind, cell.displayed))).width);
    }
    const signed =
      (col.kind === 'computed' && !!col.polarity) ||
      (col.format ? parseFormatExample(col.format).signed : false);
    numericStats.set(col.id, {
      min: values.length > 0 ? minOf(values) : 0,
      max: values.length > 0 ? maxOf(values) : 0,
      maxAbs: values.length > 0 ? maxOf(values.map((value) => Math.abs(value))) : 0,
      textReserve,
      signed,
    });
  }
  const sparkDomains = sparklineDomains(cols, rows);

  // ---- header nodes ----
  if (hasGroupHeads) {
    // Where the last heading ended: a heading that runs past its group pushes the next one on by one em.
    let headingFrom = -Infinity;
    let headingEnd = -Infinity;
    for (const [groupIndex, g] of table.columnGroups.entries()) {
      if (spans[groupIndex]!.span === 0 || g.heading === false) continue;
      const visibleGroupIds = g.columnIds.filter((columnId) => colX.has(columnId));
      // First and last in drawn order: a group may list its columns in any order.
      const tracks = visibleGroupIds.map((columnId) => colX.get(columnId)!);
      const first = tracks.reduce((a, b) => (b.x < a.x ? b : a));
      const last = tracks.reduce((a, b) => (b.x + b.w > a.x + a.w ? b : a));
      const cx = Math.round(first.x + (last.x + last.w - first.x) / 2);
      const bracketY = groupPad === undefined
        ? gridY + headerGroupH - 3 + CRISP
        : gridY + groupPad.top + ladder.headBox(fonts.group.size) + CRISP;
      const label = groupHeadingLabel(g.label);
      const labelY = groupPad === undefined
        ? bracketY - 4 - fonts.group.size * 1.2
        : gridY + groupPad.top + (ladder.headBox(fonts.group.size) - fonts.group.size * 1.2) / 2;
      // The qualifier a heading cannot say in its own words: the
      // period the block covers, printed after the label as "· note",
      // lowercase, untracked and at 400 as in the grid, and
      // underlined with it. The measurer already counts the label's
      // tracking; adding it again drew every underline one tracking step per
      // letter too wide.
      const note = groupHeadingNote(g.note);
      const faces = groupHeadingFaces(fonts.group);
      const noteFont = faces.note;
      const measured = groupHeadingWidth(g, faces, measure);
      const trackedW = measured.label;
      const labelW = trackedW + measured.note;
      const spanStart = Math.round(first.x + cellPadX);
      const spanEnd = Math.round(last.x + last.w - cellPadX);
      // A heading wider than its columns starts at the first, whatever the alignment.
      const overflows = labelW > spanEnd - spanStart;
      const centred = groupAlign === 'center' && !overflows;
      const clear = first.x > headingFrom ? Math.round(headingEnd + fonts.group.size) : -Infinity;
      const startX = overflows || groupAlign === 'left' ? Math.max(spanStart, clear)
        : groupAlign === 'right' ? Math.round(spanEnd - labelW) : Math.round(cx - labelW / 2);
      headingFrom = first.x;
      headingEnd = centred ? cx + labelW / 2 : startX + labelW;
      if (!centred) {
        nodes.push({
          t: 'text', typeRole: 'axis', id: `group:${g.id}`, x: startX, y: labelY, lines: [label], align: 'start',
          font: fonts.group, ink: tableInk('head'), owner: {}, part: 'tableGroupHeader',
        });
        if (note !== undefined) {
          nodes.push({
            t: 'text', typeRole: 'footnote', id: `group-note:${g.id}`, x: startX + trackedW, y: labelY, lines: [note], align: 'start',
            font: noteFont, ink: tableInk('secondary'), owner: {}, part: 'tableGroupHeader',
          });
        }
      } else if (note === undefined) {
        nodes.push({
          t: 'text', typeRole: 'axis',
          id: `group:${g.id}`,
          x: cx,
          y: labelY,
          lines: [label],
          align: 'middle',
          font: fonts.group,
          ink: tableInk('head'),
          owner: {},
          part: 'tableGroupHeader',
        });
      } else {
        nodes.push({
          t: 'text', typeRole: 'axis',
          id: `group:${g.id}`,
          x: startX,
          y: labelY,
          lines: [label],
          align: 'start',
          font: fonts.group,
          ink: tableInk('head'),
          owner: {},
          part: 'tableGroupHeader',
        });
        nodes.push({
          t: 'text', typeRole: 'footnote',
          id: `group-note:${g.id}`,
          x: startX + trackedW,
          y: labelY,
          lines: [note],
          align: 'start',
          font: noteFont,
          ink: tableInk('secondary'),
          owner: {},
          part: 'tableGroupHeader',
        });
      }
      // 'span' rules the group's columns; 'label' underlines the heading's own text.
      nodes.push({
        t: 'line',
        id: `group-rule:${g.id}`,
        x1: spanRule ? spanStart : centred ? Math.round(cx - labelW / 2) : startX,
        y1: bracketY,
        // A heading wider than its block runs on, but the rule stops at the block's last column.
        x2: spanRule ? spanEnd : centred ? Math.round(cx + labelW / 2) : Math.round(startX + labelW),
        y2: bracketY,
        stroke: tableRuleInk(),
        width: rowRuleWidth,
        owner: {},
        part: 'tableGroupRule',
      });
    }
  }
  // header labels anchor to the RULE (constant 7px gap above it), not the
  // band center — the gap must not drift with density
  const headerRuleY = gridY + headerH - 1 + CRISP;
  const headerBaseY = headerRuleY - headPadBottom - headerSubH - fonts.header.size * 1.2;
  const headerSubY = headerBaseY + fonts.header.size * 1.2;
  for (const col of cols) {
    if (!col.label && col.kind === 'rowLabel') continue;
    const { x: cx, w } = colX.get(col.id)!;
    const align = col.align === 'right' ? 'end' : col.align === 'center' ? 'middle' : 'start';
    // The label column's header text starts where the level-0 labels start:
    // cell padding plus the outline gutter of a tree table.
    const headerIndent = col.kind === 'rowLabel' ? rowIndent(0) : 0;
    const tx = align === 'end' ? cx + w - cellPadX : align === 'middle' ? cx + w / 2 : cx + cellPadX + headerIndent;
    const label = columnHeaderText(col);
    nodes.push({
      t: 'text', typeRole: 'axis',
      id: `header:${col.id}`,
      x: tx,
      y: headerSubY - headerFits.get(col.id)!.h,
      lines: headerFits.get(col.id)!.lines,
      ...(headerFits.get(col.id)!.title ? { title: label } : {}),
      align,
      font: fonts.header,
      ink: tableInk('head'),
      owner: { colId: col.id },
      part: 'tableHeader',
    });
    if (col.subLabel === undefined) continue;
    nodes.push({
      t: 'text', typeRole: 'axis',
      id: `header-sub:${col.id}`,
      x: tx,
      y: headerSubY,
      lines: subFits.get(col.id)!.lines,
      ...(subFits.get(col.id)!.title ? { title: col.subLabel } : {}),
      align,
      font: fonts.sub,
      ink: tableInk('subLabel'),
      owner: { colId: col.id },
      part: 'tableHeaderSub',
    });
  }
  // header underline: a hairline in the structural ink (never a filled band)
  nodes.push({
    t: 'line',
    id: 'rule:header',
    x1: rowX,
    y1: headerRuleY,
    x2: rowX + rowW,
    y2: headerRuleY,
    // `table.headRule: 'ink'` closes the head on the text ink.
    stroke: { token: theme.table?.headRule === 'ink' ? 'ink' : 'rule' },
    width: theme.table?.ruleWidths?.head ?? strokeToken(theme, 'hair'),
    owner: {},
    part: 'tableHeaderRule',
  });
  // Group dividers: a hairline down the left edge of every group after the
  // first, from the group heading to the close rule, so a banded block reads
  // as one field of columns instead of five neighbours.
  const bodyBottom = rowY.size > 0 ? maxOf([...rowY.values()].map((r) => r.y + r.h)) : gridY + headerH;
  /** The vertical hairline that opens a block: a column group or a band run. */
  /**
   * The gaps row spacers open. A divider stops at each and starts
   * again under it, as the grid draws it: a gap has no cell to carry a rule.
   */
  const spacerGaps: { from: number; to: number }[] = [];
  rows.forEach((row, index) => {
    if (index === 0 || row.spacer === undefined) return;
    const previous = rowY.get(rows[index - 1]!.id)!;
    spacerGaps.push({ from: previous.y + previous.h, to: rowY.get(row.id)!.y });
  });
  const blockDivider = (id: string, columnId: Id, fromY = gridY): void => {
    const edge = colX.get(columnId)?.x;
    if (edge === undefined || edge <= gridX) return;
    dividerAt(id, Math.round(edge) + CRISP, fromY);
  };
  function dividerAt(id: string, x: number, fromY: number): void {
    if (nodes.some((node) => node.t === 'line' && node.x1 === x && node.part === 'tableGroupDivider')) return;
    const segments: [number, number][] = [];
    let start = fromY;
    for (const gap of spacerGaps) {
      if (gap.from <= start) continue;
      segments.push([start, Math.round(gap.from) + CRISP]);
      start = Math.round(gap.to);
    }
    segments.push([start, Math.round(bodyBottom) + CRISP]);
    segments.forEach(([y1, y2], index) => nodes.push({
      t: 'line',
      id: index === 0 ? id : `${id}:${index}`,
      x1: x,
      y1,
      x2: x,
      y2,
      stroke: tableRuleInk(),
      width: rowRuleWidth,
      owner: {},
      part: 'tableGroupDivider',
    }));
  }
  if (hasGroups) {
    for (const [groupIndex, g] of table.columnGroups.entries()) {
      if (groupIndex === 0 || spans[groupIndex]!.span === 0) continue;
      // A spacer IS the separation; a hairline on top of it would draw the
      // divider inside the gap instead of at a column edge.
      if (g.spacer !== undefined && g.spacer > 0) continue;
      const firstVisible = g.columnIds.find((columnId) => colX.has(columnId));
      if (firstVisible === undefined) continue;
      blockDivider(`rule:group-divider:${g.id}`, firstVisible);
    }
  }
  // The first column of a banded run carries the same hairline, unless the
  // run opens where a group already does. It starts under the group heading:
  // a run inside a group would otherwise cut through that group's own label.
  for (const run of bandedColumnRuns) {
    blockDivider(`rule:band-divider:${run.columnIds[0]}`, run.columnIds[0]!, gridY + headerGroupH);
  }
  // The right edge of a banded block closes on the same hairline: the
  // column after it opens with it, one line where a group opens there too. A
  // block that ends the drawn columns closes on it where the rows reach on to
  // the frame; under 'tracks' the table's own end rule stands there. A spacer
  // after the block is the separation, as before a group.
  const closeBlock = (id: string, lastId: Id, fromY: number): void => {
    const index = cols.findIndex((col) => col.id === lastId);
    const next = cols[index + 1];
    if (next !== undefined) {
      const nextGroup = table.columnGroups.find((group) => group.columnIds.includes(next.id));
      const opensWithSpacer = nextGroup !== undefined && (nextGroup.spacer ?? 0) > 0
        && nextGroup.columnIds.find((columnId) => colX.has(columnId)) === next.id;
      if (!opensWithSpacer) blockDivider(id, next.id, fromY);
      return;
    }
    if (options.rowExtent !== 'frame') return;
    const last = colX.get(lastId)!;
    dividerAt(id, Math.round(last.x + last.w) - 1 + CRISP, fromY);
  };
  for (const group of table.columnGroups) {
    if (group.band !== true) continue;
    const visible = group.columnIds.filter((columnId) => colX.has(columnId));
    if (visible.length > 0) closeBlock(`rule:band-close:${group.id}`, visible[visible.length - 1]!, gridY);
  }
  for (const run of bandedColumnRuns) {
    closeBlock(`rule:band-close:${run.columnIds[run.columnIds.length - 1]}`, run.columnIds[run.columnIds.length - 1]!, gridY + headerGroupH);
  }

  // ---- body ----
  // Two grounds: group rows on the band, the total one step
  // heavier (for example cream and sand over the same canvas). Both are the theme's
  // neutral over its background, so a theme whose neutral IS the band colour
  // sets `surface.bandTint: 1` and gets that exact pair.
  const bandPaint: Paint = semanticPalettePaint(theme, options.palette, 'neutral', 1 - surface.bandTint);
  const totalGroundPaint: Paint = semanticPalettePaint(
    theme, options.palette, 'neutral', 1 - Math.min(1, surface.bandTint * 2),
  );
  const strongColumnBandPaint: Paint = {
    token: 'neutral',
    theme: { kind: 'mix', from: { token: 'ink' }, to: totalGroundPaint, weight: surface.bandTint },
  };
  const grounds = rowGrounds(table);
  // The column band each row draws under a banded column, by row and column: the ground that column's text reads on.
  const columnBandFills = new Map<string, Paint>();
  const rowWashes = new Map<string, Paint>();
  const bandedGroups = table.columnGroups.filter((g) => g.band === true);
  /** The x span a banded column group covers among the visible columns. */
  const bandRect = (g: { columnIds: Id[] }): { x: number; w: number } | undefined => {
    const visible = g.columnIds.filter((columnId) => colX.has(columnId));
    if (visible.length === 0) return undefined;
    const first = colX.get(visible[0]!)!;
    const last = colX.get(visible[visible.length - 1]!)!;
    // A band stops at its last column, under 'frame' too: the empty track is
    // the row's and carries only the row's grounds and rules.
    return { x: first.x, w: last.x + last.w - first.x };
  };
  // A parent is expanded when its children are among the drawn rows; a
  // collapsed one hides them, and its mark and hint say so.
  const expandedIds = new Set<Id>(rows.map((row) => row.parentId).filter((id): id is Id => id !== undefined));
  // `options.groupGround`, else the theme key: only an open group's header row carries the group ground by default.
  const groundMode = options.groupGround ?? theme.table?.groupGround ?? 'expanded';
  const groundShown = (open: boolean) => groundMode === 'always' || (groundMode === 'expanded' && open);
  const closers = finalClosers(rows);
  // `table.grounds.total: 'transparent'` (every preset): the total rule and weight mark the total, on no ground.
  const totalGroundless = theme.table?.grounds?.total !== undefined && transparentCss(theme.table.grounds.total);
  // `table.blockRule: 'rule'`: an open top-level block reads as one, with the
  // rule ink above its parent and above the top-level row after it. A section
  // heading has its own rule and opens no block.
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const topOf = (row: ResolvedRow): ResolvedRow => {
    let top = row;
    while (top.parentId !== undefined && rowById.has(top.parentId)) top = rowById.get(top.parentId)!;
    return top;
  };
  /** The rows a block rule opens: their ground starts under the rule, so it never covers it. */
  const blockRuled = new Set<Id>();
  const opensBlock = (row: ResolvedRow): boolean => row.parentId === undefined && row.role !== 'section' && expandedIds.has(row.id);
  const blockRuleAbove = (row: ResolvedRow, next: ResolvedRow): boolean => theme.table?.blockRule === 'rule'
    && next.parentId === undefined && (opensBlock(next) || (next.id !== topOf(row).id && opensBlock(topOf(row))));
  const lastRow = rows[rows.length - 1];
  rows.forEach((row, ri) => {
    const { y: ry, h: rh } = rowY.get(row.id)!;
    const isTotal = row.role === 'total' && row.kind !== 'result' && row.kind !== 'driver';
    const isSection = row.role === 'section';

    // ---- grounds: the total between its two rules, the group rows
    // and the banded column groups one step lighter. Ground marks levels 0
    // and 1 only; below that the ladder carries the hierarchy on its own.
    // Three grounds: the total and the top-level groups
    // on the emphasis, the parents one level down on the lighter band,
    // everything under them and every section heading on the panel.
    const ground = row.kind === 'member' ? (expandedIds.has(row.id) && groundMode !== 'none' ? 'band' : undefined) : row.kind === 'measure' || row.kind === 'detail' || row.kind === 'split' || row.kind === 'subtotal' || row.kind === 'result' || row.kind === 'driver' ? undefined : isTotal ? 'emphasis' : language.groupBand && groundShown(expandedIds.has(row.id)) ? grounds.get(row.id) : undefined;
    // The first body row sits on the head rule and takes no line of its own, as in the grid.
    if (ri > 0 && row.kind === 'member') nodes.push(rule(`rule:member:${row.id}`, ry, { token: 'rule' }, strokeToken(theme, 'rule'), 'tableMemberRule'));
    else if (ri > 0 && row.divider) nodes.push(rule(`rule:divider:${row.id}`, ry, { token: 'rule' }, strokeToken(theme, 'rule'), 'tableDividerRule'));
    const customGround = authoredGround(row, isTotal);
    if (customGround !== undefined) nodes.push({ t: 'rect', id: `statementground:${row.id}`, rect: { x: rowX, y: ry, w: rowW, h: rh }, fill: { css: customGround }, owner: { rowId: row.id }, part: 'tableStatementGround' });
    if (row.kind === 'result' && theme.table?.resultRule !== 'none') nodes.push(rule(`rule:result:${row.id}`, ry, { token: theme.table?.resultRule === 'rule' ? 'rule' : 'ink' }, strokeToken(theme, 'hair'), 'tableResultRule'));
    if (ground !== undefined && customGround === undefined && !(isTotal && totalGroundless)) {
      const part = isTotal ? 'tableTotalGround' : ground === 'emphasis' ? 'tableGroupGround' : 'tableGroupBand';
      nodes.push({
        t: 'rect',
        id: `${isTotal ? 'totalground' : ground === 'emphasis' ? 'groupground' : 'groupband'}:${row.id}`,
        rect: blockRuled.has(row.id) ? { x: rowX, y: ry + 1, w: rowW, h: rh - 1 } : { x: rowX, y: ry, w: rowW, h: rh },
        fill: isTotal ? totalGroundPaint : bandPaint,
        owner: { rowId: row.id },
        part,
      });
    }
    for (const g of [...bandedGroups, ...bandedColumnRuns]) {
      const band = bandRect(g);
      if (band === undefined) continue;
      for (const id of g.columnIds) columnBandFills.set(`${row.id}\0${id}`, ground === 'emphasis' ? strongColumnBandPaint : totalGroundPaint);
      nodes.push({
        t: 'rect',
        id: `columnband:${'id' in g ? g.id : g.columnIds[0]}:${row.id}`,
        rect: { x: band.x, y: ry, w: band.w, h: rh },
        fill: ground === 'emphasis' ? strongColumnBandPaint : totalGroundPaint,
        owner: { rowId: row.id },
        part: 'tableColumnBand',
      });
    }

    // A row wash (anchor or highlight) paints over the row's grounds, so it is the ground under the row's text.
    let rowWash: Paint | undefined;
    if (options.anchorWash && row.step === 0 && row.hasChildren && row.defaultExpanded) {
      rowWash = semanticPalettePaint(theme, options.palette, 'neutral', surface.anchorTint);
      nodes.push({
        t: 'rect',
        id: `anchorwash:${row.id}`,
        rect: { x: rowX, y: ry, w: rowW, h: rh },
        fill: rowWash,
        owner: { rowId: row.id },
        part: 'tableAnchorTint',
      });
    }

    if (row.highlightTone) {
      const tone = row.highlightTone;
      // A highlighted row with no judgment takes the focus colour, which
      // resolves to the highlight on a theme without the role.
      const edgePaint: Paint =
        tone === 'highlight' ? semanticPalettePaint(theme, options.palette, 'focus') : { token: tone };
      rowWash = tone === 'highlight'
        ? semanticPalettePaint(theme, options.palette, 'focus', surface.rowTint)
        // A row wash is a large fill: goodFill, badFill or warnFill.
        : { ...markRolePaint(tone, true), tint: surface.rowTint };
      nodes.push({
        t: 'rect',
        id: `rowtint:${row.id}`,
        rect: { x: rowX, y: ry, w: rowW, h: rh },
        fill: rowWash,
        owner: { rowId: row.id },
        part: 'tableRowTint',
      });
      nodes.push({
        t: 'rect',
        id: `rowedge:${row.id}`,
        rect: { x: rowX, y: ry, w: 3, h: rh },
        fill: edgePaint,
        owner: { rowId: row.id },
        part: 'tableRowEdge',
      });
    }

    if (rowWash !== undefined) rowWashes.set(row.id, rowWash);

    for (const col of cols) {
      const cell = row.cells[col.id];
      if (!cell) continue;
      const { x: cx, w } = colX.get(col.id)!;
      if (col.kind === 'encoding') {
        pushAll(
          nodes,
          encodingSparklineNodes(col, row, { x: cx, y: ry, w, h: rh }, theme, options.palette, measure, sparkDomains.get(col.id), options.locale?.language),
        );
        continue;
      }
      if ((isSection || (row.kind === 'member' && expandedIds.has(row.id))) && col.kind !== 'rowLabel') continue;
      // A section heading sits on its rule, at the bottom of its row under the air above it,
      // next to the block it opens; the grid aligns it the same way.
      const drop = isSection ? Math.max(0, rh - sectionNatural() - (rowExtra.get(row.id) ?? 0)) : 0;
      emitCell(cell, row, col.id, cx, w, ry + drop, rh - drop, isTotal, isSection);
    }

    // Row separators: every rule is a hairline and says what it separates
    // through its ink — `axis` around the header, the total and the close,
    // `grid` between rows and under a section heading.
    const isLast = row.id === lastRow?.id;
    const next = rows[ri + 1];
    // A spacer IS the separation between two rows, so the grid rule goes;
    // a total keeps its rule, drawn on its own top edge past the gap.
    const spacedNext = next?.spacer !== undefined;
    if (closers.has(row.id)) {
      const finalRule = theme.table?.finalRule ?? 'double';
      if (finalRule === 'double') {
        nodes.push(rule(`rule:final:${row.id}:1`, ry + rh - 2, { token: 'ink' }, strokeToken(theme, 'hair'), 'tableFinalRule'));
        nodes.push(rule(`rule:final:${row.id}:2`, ry + rh, { token: 'ink' }, strokeToken(theme, 'hair'), 'tableFinalRule'));
      } else if (finalRule === 'rule') nodes.push(rule(`rule:final:${row.id}`, ry + rh, { token: 'rule' }, strokeToken(theme, 'hair'), 'tableFinalRule'));
    } else if (next?.kind === 'result') {
      // The result owns its top rule, including an explicit none.
    } else if (spacedNext && next!.role === 'total') {
      nodes.push(rule(`rule:pre-total:${next!.id}`, rowY.get(next!.id)!.y, { token: 'rule' }, strokeToken(theme, 'rule'), 'tableTotalRule'));
      if (isTotal) nodes.push(rule(`rule:total:${row.id}`, ry + rh, { token: 'rule' }, strokeToken(theme, 'rule'), 'tableTotalRule'));
    } else if (spacedNext && !isTotal) {
      // no rule inside the gap
    } else if (isTotal && next) {
      nodes.push(rule(`rule:total:${row.id}`, ry + rh, { token: 'rule' }, strokeToken(theme, 'rule'), 'tableTotalRule'));
    } else if (isLast) {
      // The close takes the theme's `table.closeRule`: the rule ink, the
      // row-hairline ink or none. A table that ends on its total keeps the
      // total's own rule under it, as the grid draws it on the total row.
      const close = isTotal ? 'rule' : theme.table?.closeRule ?? 'rule';
      if (close !== 'none') nodes.push(rule('rule:close', ry + rh, close === 'grid' ? tableRuleInk() : { token: close }, close === 'grid' ? rowRuleWidth : strokeToken(theme, 'rule'), 'tableCloseRule'));
    } else if (next?.role === 'total') {
      nodes.push(rule(`rule:pre-total:${next.id}`, ry + rh, { token: 'rule' }, strokeToken(theme, 'rule'), 'tableTotalRule'));
    } else if (isSection && heavySectionRule) {
      // Drawn below, with the rule the row takes as the last row or before a total or a gap.
    } else if (isSection) {
      nodes.push(rule(`rule:section:${row.id}`, ry + rh, theme.table?.headRule === 'ink' ? { token: 'ink' } : tableRuleInk(), rowRuleWidth, 'tableSectionRule'));
    } else if (next !== undefined && blockRuleAbove(row, next)) {
      nodes.push(rule(`rule:block:${next.id}`, ry + rh, { token: 'rule' }, strokeToken(theme, 'rule'), 'tableBlockRule'));
      blockRuled.add(next.id);
    } else {
      nodes.push(rule(`rule:row:${row.id}`, ry + rh, rowRule.paint, rowRule.width, 'tableRowRule'));
    }
    // A section heading keeps its heavy rule wherever it sits, a collapsed last section too, as the grid draws it,
    // except where the theme draws no line there: the close under `closeRule: 'none'`, the top of a result row
    // under `resultRule: 'none'`.
    const ruleRefused = (isLast && theme.table?.closeRule === 'none') || (next?.kind === 'result' && theme.table?.resultRule === 'none');
    if (isSection && heavySectionRule && !ruleRefused) {
      // The heavy rule ends where a hairline ends; the pixels it adds come out of the section row,
      // which reserves them, so the row under it keeps its own air.
      const atY = Math.round(ry + rh) + ruleSpace - sectionRuleSpace / 2;
      nodes.push({ t: 'line', id: `rule:section:${row.id}`, x1: rowX, y1: atY, x2: rowX + rowW, y2: atY, stroke: { token: 'ink' }, width: sectionRuleWidth, owner: {}, part: 'tableSectionRule' });
    }
  });

  function rule(id: string, atY: number, stroke: Paint, width: number, part: string): SceneNode {
    const yCrisp = Math.round(atY) + CRISP;
    return { t: 'line', id, x1: rowX, y1: yCrisp, x2: rowX + rowW, y2: yCrisp, stroke, width, owner: {}, part };
  }

  function usesTotalFace(kind: ResolvedRow['kind']): boolean {
    if (kind === undefined) return true;
    if (kind === 'subtotal' || kind === 'result' || kind === 'driver') return false;
    return (kind !== 'member' && kind !== 'measure') || theme.table?.weights?.figures?.[kind] === undefined;
  }

  /** The room a row's unit affix takes on its label's line. */
  function affixRoom(row: ResolvedRow, font: FontSpec): number {
    if (row.unitAffix === undefined) return 0;
    return theme.table?.qualifier === undefined ? measure(` ${row.unitAffix}`, inlineFont(row.step, false)).width
      : measure(row.unitAffix, qualifierFont(font, theme)).width + (theme.table.qualifier.gap ?? 4);
  }

  function noteStatusCut(col: ResolvedColumn, row: ResolvedRow, shown: string, full: string): void {
    let cuts = statusCuts.get(col.id);
    if (!cuts) statusCuts.set(col.id, cuts = new Map());
    // One entry per label: a square alone names its rows.
    const key = `${shown}\0${full}`;
    const cut = cuts.get(key) ?? { shown, full, rows: [] };
    cuts.set(key, cut);
    if (shown === '' && !cut.rows.includes(row.label)) cut.rows.push(row.label);
  }
  /** A status track too narrow for the cut floor draws the tone square alone, centred, with the full label as its title. */
  function emitStatusMark(cell: ResolvedCell, row: ResolvedRow, col: ResolvedColumn, cx: number, w: number, ry: number, rh: number): void {
    const owner = { rowId: row.id, colId: col.id };
    const square = statusSquare(fonts.body.size);
    const side = Math.min(square.side, Math.max(0, w - 2));
    nodes.push({
      t: 'rect',
      id: tableCellNodeId('chip', row.id, col.id),
      rect: { x: Math.round(cx + (w - side) / 2), y: Math.round(ry + (rh - side) / 2), w: side, h: side },
      fill: statusSquarePaint(cell.tone),
      owner,
      part: 'tableChip',
      title: cell.displayed,
      display: { state: cell.displayed },
    });
    noteStatusCut(col, row, '', cell.displayed);
  }
  /**
   * A status label cut for its track. All labels of the column are cut together, so two
   * labels never share one cut: a cut that would read like another takes `distinctCut`,
   * and of labels that still share a cut only the shortest prints it.
   */
  function statusFit(col: ResolvedColumn, label: string, font: FontSpec, room: number, trackRoom: number): { text: string; title?: string } | null {
    const key = `${col.id}\0${room}\0${trackRoom}`;
    let fits = statusFits.get(key);
    if (fits === undefined) {
      // Every row of the column, visible or not, so an expand, sort or topN step keeps each cut.
      const labels = [...new Set(widthRows.flatMap((row) => {
        const cell = row.cells[col.id];
        return cell?.kind === 'status' && cell.state === 'value' ? [cell.displayed] : [];
      }))];
      fits = new Map(labels.map((text) => {
        const fit = fitStatusLabel(text, font, room, trackRoom, measure);
        const distinct = fit?.title === undefined ? undefined : distinctCut(text, [fit.text], labels, font, room, measure);
        // A cut with no leading letter ("…limited") reads as nothing: the mark draws alone. A label's own leading "…" is not the cutter's.
        const cut = distinct === undefined ? fit : { text: distinct, title: text };
        return [text, cut && cut.text !== text && cut.text.slice(text.startsWith('…') ? 1 : 0).startsWith('…') ? null : cut];
      }));
      // Of labels that share a cut, the shortest keeps it; the others draw the square, named in the notes.
      const keeper = new Map<string, string>();
      for (const [text, fit] of fits) {
        const kept = fit?.title === undefined ? undefined : keeper.get(fit.text);
        if (fit?.title !== undefined && (kept === undefined || text.length < kept.length)) keeper.set(fit.text, text);
      }
      for (const [text, fit] of fits) if (fit?.title !== undefined && keeper.get(fit.text) !== text) fits.set(text, null);
      statusFits.set(key, fits);
    }
    const fit = fits.get(label);
    return fit === undefined ? fitStatusLabel(label, font, room, trackRoom, measure) : fit;
  }
  /** The theme's authored ground under a total or subtotal row. */
  /** The ground the theme authors for a subtotal or total row; a transparent one is no ground. */
  function authoredGround(row: ResolvedRow, isTotal: boolean): string | undefined {
    const css = row.kind === 'subtotal' ? theme.table?.grounds?.subtotal : isTotal ? theme.table?.grounds?.total : undefined;
    return css === undefined || transparentCss(css) ? undefined : css;
  }

  /** Text on an authored ground (onTableGround), kept for the warning when nothing reads there. */
  function groundInk(ground: Paint | undefined, ink: Paint, tone?: 'good' | 'bad' | 'warn'): Paint {
    if (ground === undefined || ('theme' in ink && ink.theme?.kind === 'ground-text')) return ink;
    const paint = onTableGround(ink, ground, tone);
    const key = JSON.stringify(paint);
    // Equal recipes share one object, so the paint resolves its contrast walk once.
    const known = groundTexts.get(key);
    if (known !== undefined) return known;
    groundTexts.set(key, paint);
    return paint;
  }
  /** A tone's text on an authored ground. Not a closure per cell: one per cell cost a table of many cells its speed. */
  function toneInk(ground: Paint | undefined, tone: 'good' | 'bad' | 'warn'): Paint {
    return groundInk(ground, toneTextPaint(theme, tone, options.palette), tone);
  }

  function emitCell(
    cell: ResolvedCell,
    row: ResolvedRow,
    colId: Id,
    cx: number,
    w: number,
    ry: number,
    rh: number,
    isTotal: boolean,
    isSection: boolean,
  ) {
    const rowId = row.id;
    const col = cols.find((c) => c.id === colId)!;
    const font = cellFont(cell);
    const owner = { rowId, colId };
    // An open period: no figure and no glyph, the band ground under it.
    if (cell.state === 'open') {
      nodes.push({ t: 'rect', id: tableCellNodeId('openground', rowId, colId), rect: { x: cx, y: ry, w, h: rh }, fill: bandPaint, owner, part: 'tableOpenGround' });
    }
    const inline = inlineBlock(row);
    // A row with lines stacks its cell: the value on the first box, then the
    // gap, then a box per line, the whole block centred between the rules.
    const valueBox = lineBox(font.size);
    // A row whose label wrapped or put its unit on its own line stacks too:
    // the label's head sits between the value line and the lines under it.
    const head = inline.extra > 0 || affixBelow.has(rowId) ? labelHead.get(rowId) ?? 0 : 0;
    const blockTop = ry + Math.max(0, (rh - ruleSpace - (valueBox + head + inline.extra)) / 2);
    const figureCell = isFigureCell(cell, col);
    // A cell tint (a tone ground or a heat band) stands 1 px clear of the
    // cell's sides and of the rules: the rule above owns the row's first
    // pixel and the next row's rule sits just under its last, so a tint
    // never paints over a rule and two tinted neighbours keep a gap.
    const tintBox = { x: cx + 1, y: ry + ruleSpace + 1, w: Math.max(0, w - 2), h: Math.max(0, rh - ruleSpace - 2) };
    // `table.tones: 'fill'`: a judged figure stands on a ground in its tone;
    // a size bar runs from the cell's left edge behind the figure, 2 px
    // inside the line box.
    const toneFill = figureCell && cell.tone !== 'neutral' && theme.table?.tones === 'fill' && !isTotal ? tableGround(cell.tone === 'good' && cell.strong ? 'goodStrong' : cell.tone) : undefined;
    if (toneFill !== undefined) nodes.push({ t: 'rect', id: tableCellNodeId('toneground', rowId, colId), rect: tintBox, fill: toneFill, owner, part: 'tableToneGround' });
    // Plain cells keep the shared ink. Only the strong column band needs its own ink without an authored row ground.
    // An authored row still uses its topmost ground: a row wash, a column band, else the authored ground.
    // A tone fill or a heat band takes over where drawn.
    const rowGround = authoredGround(row, isTotal);
    const columnBand = columnBandFills.get(`${rowId}\0${colId}`);
    let textGround: Paint | undefined = toneFill ?? (rowGround === undefined
      ? (columnBand === strongColumnBandPaint && !rowWashes.has(rowId) ? columnBand : undefined)
      : rowWashes.get(rowId) ?? columnBand ?? { css: rowGround });
    if (figureCell && cell.bar !== undefined && cell.bar > 0) {
      const top = (inline.extra + head > 0 ? blockTop : ry + (rh - ruleSpace - valueBox) / 2) + 2;
      nodes.push({ t: 'rect', id: tableCellNodeId('sizebar', rowId, colId), rect: { x: cx + 1, y: top, w: (w - 1) * cell.bar, h: valueBox - 4 }, fill: { token: 'background', theme: { kind: 'table-ground', ground: col.emphasis === 'muted' ? 'barMuted' : 'bar' } }, owner, part: 'tableSizeBar' });
    }
    // A row is positioned as a BLOCK as soon as it pays for anything under
    // its value, a note as much as a change line: a row that grows for the
    // note but keeps its label centred in the taller box overlaps the two
    // and sets the outline mark beside the wrong line.
    const stacked = inline.extra + head > 0;
    const textY = stacked
      ? blockTop + (valueBox - font.size * 1.2) / 2
      : ry + (rh - font.size * 1.2) / 2;
    const contentX = cx + cellPadX;
    // A section heading is drawn across the whole table on both surfaces,
    // so it reads against the table's width and not against the row-label
    // track, and one long heading does not set that track alone.
    const contentW = (isSection ? tableW - (cx - gridX) : w) - 2 * cellPadX;

    if (cell.kind === 'status' && cell.state === 'value' && col.statusMark === 'square') {
      // The quiet mark: a small tone square before the label in ink, centred as one group.
      // A label wider than the track is cut there, as a text cell is, and keeps its full text as the title.
      const square = statusSquare(fonts.body.size);
      const fit = statusFit(col, cell.displayed, fonts.body, w - 2 * cellPadX - square.side - square.gap, w - square.side - square.gap);
      if (fit === null) return emitStatusMark(cell, row, col, cx, w, ry, rh);
      const { text: label, title } = fit;
      if (title !== undefined) noteStatusCut(col, row, label, title);
      const groupW = square.side + square.gap + measure(label, fonts.body).width;
      const markX = Math.round(cx + (w - groupW) / 2);
      nodes.push({
        t: 'rect',
        id: tableCellNodeId('chip', rowId, colId),
        rect: { x: markX, y: Math.round(ry + (rh - square.side) / 2), w: square.side, h: square.side },
        fill: statusSquarePaint(cell.tone),
        owner,
        part: 'tableChip',
      });
      nodes.push({
        t: 'text', typeRole: 'label',
        id: tableCellNodeId('cell', rowId, colId),
        x: markX + square.side + square.gap,
        y: ry + (rh - fonts.body.size * 1.2) / 2,
        lines: [label],
        align: 'start',
        font: fonts.body,
        ink: groundInk(textGround, { token: 'ink' }),
        owner,
        part: 'tableCell', role: 'category',
        display: { state: cell.displayed },
        ...(title === undefined ? {} : { title }),
      });
      return;
    }
    if (cell.kind === 'status' && cell.state === 'value') {
      // Publisher badge anatomy: bg-tone wash + ink-mixed tone text
      const fit = statusFit(col, cell.displayed, fonts.chip, w - 2 * cellPadX - 2 * CHIP_PAD_X, w - 2 * CHIP_PAD_X);
      if (fit === null) return emitStatusMark(cell, row, col, cx, w, ry, rh);
      const { text: label, title } = fit;
      if (title !== undefined) noteStatusCut(col, row, label, title);
      const tw = measure(label, fonts.chip).width;
      const chipW = Math.round(tw + 2 * CHIP_PAD_X);
      const chipH = chipHeight(rh, fonts.chip.size);
      const chipX = Math.round(cx + (w - chipW) / 2);
      const chipY = Math.round(ry + (rh - chipH) / 2);
      const chip = chipPaints(theme, cell.tone, options.palette);
      nodes.push({
        t: 'rect',
        id: tableCellNodeId('chip', rowId, colId),
        rect: { x: chipX, y: chipY, w: chipW, h: chipH },
        fill: chip.fill,
        // A status preset's chips are square; everywhere else they keep the
        // theme's chip radius.
        radius: language.squareChips ? 0 : surface.chipRadius,
        owner,
        part: 'tableChip',
      });
      nodes.push({
        t: 'text', typeRole: 'label',
        id: tableCellNodeId('cell', rowId, colId),
        x: chipX + chipW / 2,
        y: chipY + (chipH - fonts.chip.size * 1.2) / 2,
        lines: [label],
        align: 'middle',
        font: fonts.chip,
        ink: chip.ink,
        owner,
        part: 'tableCell', role: 'category',
        display: { state: cell.displayed },
        ...(title === undefined ? {} : { title }),
      });
      return;
    }

    // Depth adds indent. Opt-in outline marks reserve their gutter.
    const indent = cell.kind === 'rowLabel' ? rowIndent(cellStep(cell)) : 0;
    const align = col.align === 'right' ? 'end' : col.align === 'center' ? 'middle' : 'start';
    let tx = align === 'end' ? cx + w - cellPadX : align === 'middle' ? cx + w / 2 : contentX + indent;

    // The outline mark: the one glyph in the table, and only where a row has
    // children. Minus open, plus closed — no rotation, no triangle.
    const parentRow = cell.kind === 'rowLabel' && row.hasChildren;
    const expanded = parentRow && expandedIds.has(rowId);
    // Marks are opt-in; a table without them keeps the hint;
    // a row authored foldable: false has nothing to fold and takes none.
    if (parentRow && options.outlineMarks === true && row.foldable !== false) {
      // The gutter is inside the cell even where there is no indent to take
      // it from — a generated Others parent in an otherwise flat table.
      const boxed = (theme.table?.mark ?? (options.variant === 'steering' ? 'boxed' : 'bare')) === 'boxed';
      const mx = Math.round(Math.max(cx + 2, contentX + indent - operatorSlot - (theme.table?.toggle?.gap ?? (boxed ? 17 : 16))));
      // On the label's own line, not in the middle of the row: a row with
      // two lines under its value is three lines tall, and a mark centred on
      // the row sits beside the first line instead of beside the label.
      const my = Math.round(stacked
        ? blockTop + (valueBox - MARK_SIZE) / 2
        : ry + (rh - MARK_SIZE) / 2);
      const toggleSize = theme.table?.toggle?.size ?? 11;
      const boxY = my + (MARK_SIZE - toggleSize) / 2;
      if (boxed) nodes.push({ t: 'path', id: `markbox:${rowId}`, d: `M${mx} ${boxY}h${toggleSize}v${toggleSize}h-${toggleSize}Z`, stroke: tableInk('toggle'), width: strokeToken(theme, 'mark'), owner, part: 'tableOutlineBox' });
      nodes.push({
        t: 'path',
        id: `mark:${rowId}`,
        d: boxed ? `M${mx + (toggleSize - 5) / 2} ${my + 4}h5${expanded ? '' : `M${mx + toggleSize / 2} ${my + 1.5}v5`}` : expanded
          ? `M${mx + 1} ${my + 4}h6`
          : `M${mx + 1} ${my + 4}h6M${mx + 4} ${my + 1}v6`,
        stroke: boxed ? { token: 'ink' } : tableInk('toggle'),
        width: strokeToken(theme, 'mark'),
        lineCap: 'round',
        owner,
        part: 'tableOutlineMark',
      });
    }

    // a section heading's status chip after its text; the text is cut to leave it room.
    const badge = isSection && col.kind === 'rowLabel' ? row.badge : undefined;
    const badgeW = badge === undefined ? 0 : Math.round(measure(badge.text, fonts.chip).width + 2 * CHIP_PAD_X);
    const badgeReserve = badgeW === 0 ? 0 : badgeW + BADGE_GAP;
    // The unit a forced magnitude hoisted off this row's cells, on the label's own line after the
    // label, drawn below.
    const affixFont = theme.table?.qualifier === undefined
      ? { ...inlineFont(row.step, false), weight: theme.type.label.weight, ...(font.style ? { style: font.style } : {}) }
      : qualifierFont(font, theme);
    const affixWidth = col.kind === 'rowLabel' && row.unitAffix !== undefined && !(row.kind === 'member' && expandedIds.has(row.id))
      ? theme.table?.qualifier === undefined ? measure(` ${row.unitAffix}`, affixFont).width : measure(row.unitAffix!, affixFont).width + (theme.table.qualifier.gap ?? 4)
      : 0;
    // A unit on its own line under the label takes no room on the label's line.
    const lineAffix = affixBelow.has(rowId) ? 0 : affixWidth;
    const maxW = contentW - indent - badgeReserve - lineAffix
      - (cell.note && col.kind !== 'rowLabel' && col.noteLine !== true ? measure(` ${cell.note}`, fonts.note).width : 0);
    const wrappedCell = wrappedLines.get(tableCellKey(rowId, colId));
    const { text, title: cutTitle } = cellText(
      cell, col.kind, isSection, font, maxW, wrappedCell, cutTitles.get(tableCellKey(rowId, colId)), measure, theme.table?.section?.case,
    );
    const lines = wrappedCell ?? [text];
    // A section heading spans the table, and its text and chip align across it as one group, as
    // the grid's flex line aligns them: the chip follows the text's own end, never the
    // anchor of a right or centred text. The unit affix between them is part of the group.
    const sectionLabel = isSection && col.kind === 'rowLabel';
    if (sectionLabel && align !== 'start') {
      const groupW = measure(lines[lines.length - 1] ?? text, font).width / WIDTH_SAFETY + lineAffix + badgeReserve;
      const start = contentX + indent;
      tx = align === 'end' ? contentX + contentW - groupW : start + (contentX + contentW - start - groupW) / 2;
    }
    const drawnAlign = sectionLabel ? 'start' : align;
    const textTop = lines.length > 1
      ? (stacked ? blockTop : ry + (rh - lines.length * font.size * 1.2) / 2)
      : textY;
    // A 'strong' column carries the header's weight down its cells; a glyph
    // never does, and a total row already sets its own.
    // A muted column in a cohort grid is its unshaded baseline (the M0
    // column): it prints at the body weight, not the grid's 500.
    let drawnFont: FontSpec = cell.state !== 'value'
      ? row.kind === 'driver' ? kindFont(fonts.body, 'driver', false, theme) : fonts.body
      : isTotal && cell.kind !== 'rowLabel' && usesTotalFace(row.kind)
        ? fonts.totalValue
        : col.emphasis === 'strong'
          ? strongColumnFont(font, col, cell, row.kind, theme)
          : col.emphasis === 'muted' && isCohortDensity(density)
            ? { ...font, weight: fonts.body.weight }
            : font;

    const enc = col.cellEncoding;
    const box = { x: cx, y: ry, w, h: rh };
    const context = {
      cell,
      box,
      theme,
      ...(options.palette === undefined ? {} : { palette: options.palette }),
      ...(cell.tone === 'neutral' || enc?.type !== 'arrow' ? {} : { toneInk: toneInk(textGround, cell.tone) }),
      measure,
      nodeId: (suffix: string) => tableCellNodeId(suffix, rowId, colId),
      owner,
    };
    const stats = numericStats.get(colId);
    let encodingInk: Paint | undefined;
    // A badge lays its own ground under the figure, a heat band under all of the cell's text; each picks its ink there.
    const ownGround = hasPolarityBadge(cell, col);
    const lane = heatLanes.get(colId);
    if ((col.kind === 'value' || col.kind === 'computed') && enc?.type === 'heat' && lane) {
      const heat = emitHeat({ ...context, box: tintBox }, lane, enc);
      // A cell the lane leaves bare (a total, by default) keeps the ground below under its text.
      const heatGround = heat.nodes.find((node): node is Extract<SceneNode, { t: 'rect' }> => node.t === 'rect')?.fill;
      if (heatGround !== undefined) textGround = heatGround;
      nodes.push(...heat.nodes);
      if (!cell.deEmphasized && !(cell.relation === 'ofWhich' && ofWhichMuted)) encodingInk = heat.ink;
      // The darkest band prints on the full ink and the skipped column
      // whispers: the band decides the weight as well as the ground.
      if (heat.weight !== undefined && !isTotal) drawnFont = { ...drawnFont, weight: heat.weight };
    } else if ((col.kind === 'value' || col.kind === 'computed') && enc?.type === 'inCellBar' && stats) {
      nodes.push(
        ...emitInCellBar(context, {
          contentBox: { x: contentX, y: ry, w: contentW, h: rh },
          maxAbs: stats.maxAbs,
          textReserve: stats.textReserve,
        }),
      );
    } else if (col.kind === 'computed' && col.polarity && enc?.type === 'arrow' && stats) {
      nodes.push(...emitArrow(context, { scale: enc.scale, target: options.target, textScale: textScaleOf(options), font, maxAbs: stats.maxAbs, valueX: cx + w - cellPadX }));
    }

    // polarityBadge encoding: tinted backing behind the number
    if (ownGround) {
      const badgeH = chipHeight(rh, font.size);
      const tw = measure(text, figureFont(font, cellDrawsTabular(theme, col.kind, text))).width;
      nodes.push({
        t: 'rect',
        id: tableCellNodeId('badge', rowId, colId),
        rect: {
          x: Math.round(cx + w - cellPadX - tw - 6),
          y: Math.round(textTop + (font.size * 1.2 - badgeH) / 2),
          w: Math.round(tw + 12),
          h: badgeH,
        },
        fill: chipPaints(theme, cell.tone, options.palette).fill,
        radius: surface.chipRadius,
        owner,
        part: 'tableBadge',
      });
      tx = cx + w - cellPadX;
    }

    // ink policy: empty-state glyphs whisper everywhere (never bold, never
    // toned); a muted column and a level-4 row label whisper too;
    // then de-emphasis; then judgment tone
    const isGlyph = cell.state !== 'value';
    const quiet =
      col.emphasis === 'muted';
    // A glyph, a muted column and a zero take the secondary ink (`table.inks.secondary`).
    // A driver prints in the driver ink; one that `options.driverTones` allows takes the tone its figure earned (a neutral figure and the label keep the ink).
    const driverToned = row.driverTone === true && cell.kind !== 'rowLabel' && cell.state === 'value' && cell.tone !== 'neutral';
    const plainInk: Paint = row.kind === 'driver' && !driverToned ? tableInk('driver')
      : cell.kind === 'rowLabel' && (row.kind === 'detail' || row.kind === 'split') ? tableInk('child')
      : isGlyph
      ? tableInk('secondary')
      : quiet
        ? tableInk('secondary')
      : isSection && sectionInk !== undefined
        ? { token: sectionInk }
      : (encodingInk ??
        (cell.deEmphasized || (cell.relation === 'ofWhich' && ofWhichMuted)
          ? tableInk('secondary')
          : cell.tone === 'neutral'
            ? cell.zero ? tableInk('secondary') : tableInk(cell.kind === 'rowLabel' ? 'label' : 'figure')
            : theme.table?.tones === 'fill' && (col.kind === 'value' || col.kind === 'computed') && !isTotal
              ? tableInk('figure')
              // A polarity badge's text sits on its chip, which the one colour per tone already reads on.
              : enc?.type === 'polarityBadge' ? toneTextPaint(theme, cell.tone, options.palette) : toneInk(textGround, cell.tone)));
    const ink = ownGround ? polarityBadgeInk(theme, cell, col, row, options.palette) : groundInk(textGround, plainInk);

    // The matrix says its numbers through its grounds; the core columns
    // beside it and the closing row under it still print theirs.
    const printsFigure = figures || !heatColumn(col) || isTotal;
    if (cell.kind === 'rowLabel' && row.operator !== undefined && operatorSlot > 0) nodes.push({
      t: 'text', id: `operator:${rowId}`, x: tx - operatorSlot, y: textTop, lines: [row.operator], align: 'start', font, ink: groundInk(textGround, tableInk('operator')), owner, part: 'tableOperator', typeRole: 'label', role: 'category',
    });
    if (printsFigure) nodes.push({
      t: 'text', typeRole: 'label',
      id: tableCellNodeId('cell', rowId, colId),
      x: tx,
      y: textTop,
      lines,
      ...(cutTitle !== undefined ? { title: cutTitle } : {}),
      align: drawnAlign,
      font: drawnFont,
      ink,
      owner,
      part: 'tableCell', ...cellRole(col.kind, lines.join(' ')),
      ...(cell.displayed === ''
        ? {}
        : {
            display:
              cell.state === 'value'
                ? { value: cell.displayed }
                : { state: cell.displayed },
          }),
    });

    // The lines inside the cell: the row label column prints each
    // line's authored label on its baseline, a value column prints that
    // line's own cell. A signed change carries its judgment tone; a share or
    // a year-on-year reference whispers. No line is ever invented text.
    if (inline.lines.length > 0 && (col.kind === 'rowLabel' || col.kind === 'value' || col.kind === 'computed')) {
      const base = inline.note === undefined ? 0 : 1;
      let lineY = blockTop + valueBox + head + ladder.inlineGap + base * inline.box;
      for (const [index, line] of inline.lines.entries()) {
        const baseLineFont = changeLineFont(theme, ladder, row.step);
        const driverLine = row.kind === 'driver' || line.kind === 'driver';
        const lineFont = driverLine && theme.table?.driver?.italic !== false ? { ...baseLineFont, style: 'italic' as const } : baseLineFont;
        const lineCell = line.cells[colId];
        // A line's label stays inside its track: cut, never run into the figures.
        const printed = col.kind === 'rowLabel'
          ? ellipsize(line.label, lineFont, contentW - indent - INLINE_LABEL_INDENT, measure).text
          : (lineCell?.displayed ?? '');
        const y = lineY + (inline.box - lineFont.size * 1.2) / 2;
        lineY += inline.box;
        // The note of a `noteLine` column owns this slot: the line it stands
        // in holds no value here, and two texts on one baseline is a smear.
        // The line keeps its place in the accessible table.
        if (inline.noteSlots.get(colId) === base + index) continue;
        if (!printed) continue;
        // A line takes the tone its cell carries: a signed change's judgement, or one the author or the compiler gave.
        const toned = col.kind !== 'rowLabel' && lineCell?.state === 'value' && lineCell.tone !== 'neutral';
        nodes.push({
          t: 'text', typeRole: 'label',
          id: tableCellNodeId('cellline', rowId, colId, line.id),
          x: col.kind === 'rowLabel' ? contentX + indent + INLINE_LABEL_INDENT : cx + w - cellPadX,
          y,
          lines: [printed],
          align: col.kind === 'rowLabel' ? 'start' : 'end',
          font: lineFont,
          ink: groundInk(textGround, driverLine && !(toned && (row.driverTone === true || line.driverTone === true)) ? tableInk('driver') : toned && !(theme.table?.tones === 'fill' && lineCell!.tone === 'warn') ? toneInk(textGround, lineCell!.tone as 'good' | 'bad' | 'warn')
            : tableInk('secondary')),
          owner,
          part: 'tableCellLine',
          ...(col.kind === 'rowLabel' ? { role: 'category' as const } : cellRole(col.kind, printed)),
          ...(lineCell === undefined || lineCell.displayed === '' || col.kind === 'rowLabel'
            ? {}
            : { display: lineCell.state === 'value' ? { value: lineCell.displayed } : { state: lineCell.displayed } }),
        });
      }
    }

    // The unit affix: "Revenue (net) $k". It is not a line of its own, so the
    // change lines under the label stay level with the ones under the values.
    if (affixWidth > 0) {
      nodes.push({
        t: 'text', typeRole: 'label',
        id: `unit:${rowId}`,
        // Measured in the face the label is drawn in: a bolder label measured in the body face ran
        // into its unit ("marginof product sales"). Under the label, the unit starts its own line.
        x: affixBelow.has(rowId) ? tx : tx + measure(lines[lines.length - 1] ?? text, drawnFont).width + Math.max(theme.table?.qualifier?.gap ?? 4, measure(' ', affixFont).width),
        // baseline lock: the affix shares the label's baseline exactly
        y: affixBelow.has(rowId) ? textTop + lines.length * font.size * 1.2
          : textTop + (lines.length - 1) * font.size * 1.2 + (font.size - affixFont.size) * NOTE_BASELINE_LOCK,
        lines: [row.unitAffix!],
        align: 'start',
        font: affixFont,
        ink: groundInk(textGround, tableInk(row.kind === 'driver' ? 'driver' : 'qualifier')),
        owner,
        part: 'tableRowUnit',
        // A hoisted scale letter is a number's tail and takes the figures;
        // an authored unit is a phrase ("$ per order") and reads as prose,
        // which is the composed-role rule.
        role: composedTextRole(row.unitAffix!, 'caption'),
      });
    }

    if (badge !== undefined) {
      const chip = chipPaints(theme, badge.tone, options.palette);
      const chipH = chipHeight(rh, fonts.chip.size);
      // The chip sits on the drawn end of the heading. The measurer adds WIDTH_SAFETY so a text never
      // overflows its box; here that margin would be extra air growing with the heading, 1.6 px after
      // a cut 18-letter one against 0.4 px after "COST", so it comes off.
      const chipX = Math.round(tx + measure(lines[lines.length - 1] ?? text, font).width / WIDTH_SAFETY + lineAffix + BADGE_GAP);
      // An 11 px heading line is shorter than an 18 px chip. On a wrapped heading the chip
      // keeps clear of the line above it, or its fill runs into that line's text box.
      const clearAbove = lines.length > 1 ? Math.ceil(textTop + (lines.length - 2) * font.size * 1.2 + font.size) : -Infinity;
      const chipY = Math.max(clearAbove, Math.round(textTop + (lines.length - 1) * font.size * 1.2 + (font.size * 1.2 - chipH) / 2));
      nodes.push({
        t: 'rect', id: `sectionbadge:${rowId}`, rect: { x: chipX, y: chipY, w: badgeW, h: chipH }, fill: chip.fill,
        radius: language.squareChips ? 0 : surface.chipRadius, owner, part: 'tableSectionBadge',
      });
      nodes.push({
        t: 'text', typeRole: 'label', id: `sectionbadge-text:${rowId}`, x: chipX + badgeW / 2, y: chipY + (chipH - fonts.chip.size * 1.2) / 2,
        lines: [badge.text], align: 'middle', font: fonts.chip, ink: chip.ink, owner, part: 'tableSectionBadge', role: 'category',
        display: { state: badge.text },
      });
    }

    // A collapsed parent says how many lines it hides, in the noun the author
    // wrote for that level. Without `levelNouns` there is no hint: the engine
    // does not invent the word.
    if (parentRow && !expanded && align === 'start') {
      const noun = table.levelNouns?.[cell.level + 1];
      const count = childCount.get(rowId) ?? 0;
      if (noun !== undefined && count > 0) {
        const word = count === 1 ? noun.one : noun.other;
        const hintX = tx + measure(lines[lines.length - 1] ?? text, font).width + lineAffix + badgeReserve + HINT_GAP;
        // the label track pays for the hint at its natural width. A frame that squeezes the
        // track cuts the hint to the room the label cell has left, keeping the count ("· 2…"), and
        // leaves it out where not even that fits, so it never runs on into the next column.
        const full = `· ${count} ${word}`;
        const room = contentX + contentW - hintX;
        const short = `· ${count}…`;
        const hint = measure(full, fonts.hint).width <= room ? { text: full }
          : measure(short, fonts.hint).width <= room ? { text: short, title: full } : undefined;
        if (hint !== undefined) nodes.push({
          t: 'text', typeRole: 'label',
          id: `hint:${rowId}`,
          x: hintX,
          y: textTop + (lines.length - 1) * font.size * 1.2 + (font.size - fonts.hint.size) * NOTE_BASELINE_LOCK,
          lines: [hint.text],
          ...(hint.title === undefined ? {} : { title: hint.title }),
          align: 'start',
          font: fonts.hint,
          ink: groundInk(textGround, tableInk('secondary')),
          owner,
          part: 'tableCollapsedHint', role: 'category',
        });
      }
    }

    const noteSlot = inline.noteSlots.get(colId);
    if (cell.note && noteSlot !== undefined) {
      // A second line under the figure, on the ladder's inline step in the
      // muted ink, in the slot the lines left it.
      const noteFont = inlineFont(row.step, false);
      nodes.push({
        t: 'text', typeRole: 'footnote',
        id: tableCellNodeId('note', rowId, colId),
        x: align === 'end' ? cx + w - cellPadX : align === 'middle' ? cx + w / 2 : contentX + indent,
        y: blockTop + valueBox + head + ladder.inlineGap + noteSlot * inline.box
          + (inline.box - noteFont.size * 1.2) / 2,
        lines: [cell.note],
        align,
        font: noteFont,
        ink: groundInk(textGround, tableInk('secondary')),
        owner,
        part: 'tableCellNote',
      });
    } else if (cell.note && col.kind === 'rowLabel' && inline.note !== undefined) {
      // Under the label, on the ladder's inline step. The lines a
      // row prints start one box further down, so nothing collides.
      const noteFont = inlineFont(row.step, false);
      nodes.push({
        t: 'text', typeRole: 'footnote',
        id: tableCellNodeId('note', rowId, colId),
        x: contentX + indent,
        y: blockTop + valueBox + head + ladder.inlineGap + (inline.box - noteFont.size * 1.2) / 2,
        lines: [cell.note],
        align: 'start',
        font: noteFont,
        ink: groundInk(textGround, tableInk('secondary')),
        owner,
        part: 'tableCellNote',
      });
    } else if (cell.note) {
      // A wrapped cell carries its note after the last line, on that line's baseline.
      const lastLine = lines[lines.length - 1] ?? text;
      const noteX =
        align === 'end' ? tx - measure(lastLine, font).width - 4 : tx + measure(lastLine, font).width + 4;
      // baseline lock: the note shares its host numeral's baseline exactly
      const hostFont = drawnFont;
      const noteY = textTop + (lines.length - 1) * font.size * 1.2 + (hostFont.size - fonts.note.size) * NOTE_BASELINE_LOCK;
      nodes.push({
        t: 'text', typeRole: 'footnote',
        id: tableCellNodeId('note', rowId, colId),
        x: noteX,
        y: noteY,
        lines: [cell.note],
        align: align === 'end' ? 'end' : 'start',
        font: fonts.note,
        ink: groundInk(textGround, tableInk('secondary')),
        owner,
        part: 'tableCellNote',
      });
    }
  }

  // ---- coarse claims (structure-proportional) ----
  occupied.claim({ x: rowX, y: gridY, w: rowW, h: headerH }, 'mark', {}, 'tableHeader');
  for (const row of rows) {
    const { y: ry, h: rh } = rowY.get(row.id)!;
    occupied.claim({ x: rowX, y: ry, w: rowW, h: rh }, 'mark', { rowId: row.id }, 'tableRow');
  }
  for (const col of cols) {
    const { x: cx, w } = colX.get(col.id)!;
    occupied.claim({ x: cx, y: gridY, w, h: tableH }, 'mark', { colId: col.id }, 'tableColumn');
  }

  const marks: TableMarks = {
    table: { x: gridX, y: gridY, w: tableW, h: tableH },
    headerBand: { x: gridX, y: gridY, w: tableW, h: headerH },
    columns: cols.map((c) => ({ id: c.id, ...colX.get(c.id)! })),
    rows: rows.map((r) => ({ id: r.id, ...rowY.get(r.id)! })),
  };

  // Text on an authored ground on the other side of the page's lightness that keeps no tone, or reads under 4.5:1: warn, in every theme it is painted in.
  const paintWarningRules: PaintWarningRule[] = [];
  if (groundTexts.size > 0) {
    const texts = options.colorblindSafe === true ? colorblindRoles([...groundTexts.values()]).value : [...groundTexts.values()];
    paintWarningRules.push({ kind: 'table-ground-text', texts, before: warnings.length });
    pushAll(warnings, groundTextWarnings(theme, texts));
  }

  // colorblindSafe swaps every good/bad paint the table drew; a
  // table that drew none is refused, since the option would change nothing.
  let scene = nodes;
  if (options.colorblindSafe === true) {
    const swap = colorblindRoles(nodes);
    scene = swap.value;
    if (swap.swapped === 0) {
      warnings.push({
        code: 'table-colorblind-safe-unused',
        severity: 'error',
        message: 'colorblindSafe swaps the good/bad pair, and this table paints none: no good or bad tone, diverging or status heat lane, in-cell bar below zero, toned badge or row highlight, so it would change nothing',
        suggest: 'drop colorblindSafe; options.palette names a colorblind-safe categorical ramp',
        field: ['options', 'colorblindSafe'],
        fix: [{ op: 'remove', path: '/options/colorblindSafe' }],
      });
    }
  }

  // The cut labels in full, one disclosure per status column. The tracks do
  // not depend on the notes, so the second pass draws the same cuts.
  const cutNotes = cols.flatMap((col) => {
    const cuts = statusCuts.get(col.id);
    // A label drawn as the square alone names every row that draws it; entries part with "; " since one can list several rows.
    const entry = ({ shown, full, rows: named }: { shown: string; full: string; rows: string[] }) => `${shown !== '' ? shown : named.join(', ')} = ${full}`;
    return cuts ? [disclosureNote(`${col.label}: ${[...cuts.values()].map(entry).join('; ')}`)] : [];
  }).filter((note) => !(options[ENGINE_NOTES] ?? []).includes(note));
  if (cutNotes.length > 0) return layoutTableOnce(authoredData, { ...options, [ENGINE_NOTES]: [...(options[ENGINE_NOTES] ?? []), ...cutNotes] }, initialResolved, sizingOnly, formatFits);

  return {
    type: 'table',
    size,
    sizing,
    plot,
    scene,
    labels: [],
    axes: [],
    annotations: [],
    frame: frame.frame,
    marks,
    derived: { table, computedCells: resolved.computedCells },
    a11y: {
      title: accessibleTitle(options.title, 'Table'),
      counts: [structureCount('rows', dataRows.length), structureCount('columns', cols.length)],
      desc: `Table with ${dataRows.length} rows and ${cols.length} columns`,
    },
    warnings,
    ...(paintWarningRules.length > 0 ? { paintWarningRules } : {}),
    debug: { occupied: occupied.snapshot(), decisions: [] },
  };
}

function tableSizing(size: Size, plot: Rect, bottom: number, totalW: number, minimumW: number) {
  return rowSizing('table', size, {
    chromeH: size.height - plot.h,
    minimumRowsH: bottom - plot.y + 4,
    naturalRowsH: bottom - plot.y + 4,
    minWidth: size.width - plot.w + minimumW,
    naturalWidth: size.width - plot.w + totalW,
  });
}

/**
 * A status label cut to the room its chip or square group leaves in the
 * track; null where that room is under the cut floor or keeps no letter, so
 * the mark draws alone. Under the floor a short label that fits the track
 * without the cell padding (`trackRoom`) still prints whole.
 */
function fitStatusLabel(label: string, font: FontSpec, room: number, trackRoom: number, measure: TextMeasurer): { text: string; title?: string } | null {
  const width = measure(label, font).width;
  if (width <= room) return { text: label };
  if (room < CUT_MIN) return width <= trackRoom ? { text: label } : null;
  const cut = cutWithTitle(label, font, room, measure);
  // A cut that keeps no letter reads as nothing: the mark draws alone.
  return cut.text === '…' || cut.text === '' ? null : cut;
}

/**
 * The single-line text of a cell and the `<title>` of a cut: a
 * wrapped cell draws its lines, a row label or prose cell too wide for one
 * line is cut last with its full text kept.
 */
function cellText(
  cell: { displayed: string }, kind: string, isSection: boolean, font: FontSpec, maxW: number,
  wrapped: string[] | undefined, wrappedTitle: string | undefined, measure: TextMeasurer, sectionCase?: 'upper' | 'asis',
): { text: string; title?: string } {
  const text = isSection && sectionCase !== 'asis' ? sectionText(cell.displayed) : cell.displayed;
  if (wrapped) return { text: wrapped[0] ?? text, ...(wrappedTitle !== undefined ? { title: wrappedTitle } : {}) };
  if ((kind === 'rowLabel' || kind === 'text') && measure(text, font).width > maxW) {
    return cutWithTitle(text, font, Math.max(maxW, CUT_MIN), measure);
  }
  return { text };
}

/** A section heading keeps its tracked capitals whatever the column heads do. */
function sectionText(s: string): string {
  return s.toUpperCase();
}

function encodingSparklineNodes(
  col: ResolvedColumn,
  row: ResolvedRow,
  box: Rect,
  theme: Theme,
  palette: string | undefined,
  measure: TextMeasurer,
  domain: SparklineDomain | undefined,
  language: string | undefined,
): SceneNode[] {
  if (row.role === 'section' || col.encoding?.type !== 'sparkline') return [];
  const values = sparklineSourceValues(row, col.encoding.sourceColumns);
  const last = lastObservedIndex(values);
  const lastSource = last === undefined ? undefined : col.encoding.sourceColumns[last];
  return emitSparkline(
    {
      cell: row.cells[col.id]!,
      box,
      theme,
      ...(palette === undefined ? {} : { palette }),
      measure,
      nodeId: (suffix) => tableCellNodeId(suffix, row.id, col.id),
      owner: { rowId: row.id, colId: col.id },
    },
    values,
    {
      kind: col.encoding.kind ?? 'line',
      domain: domain ?? tableSparklineDomain([row], col.encoding.sourceColumns, col.encoding.kind ?? 'line'),
      lastText: lastSource === undefined ? undefined : row.cells[lastSource]?.displayed,
      language,
    },
  );
}

function transparentCss(css: string): boolean {
  return css.trim().toLowerCase() === 'transparent';
}
