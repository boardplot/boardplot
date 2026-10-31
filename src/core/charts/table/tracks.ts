/**
 * Column tracks. The SVG grid and the HTML grid ask the same two
 * questions: how wide does a column need to be for the strings it holds, and
 * what width does each track take once some columns are hidden and the frame
 * is wider or narrower than the table. Both answers live here, pixel-free:
 * the arithmetic takes numbers and returns numbers, and the renderers apply
 * them. A renderer that measured its own columns would drift from the SVG
 * the first time a face or a padding changed.
 */

import { tableEmphasis } from '../../theme';
import { twoLineWidth, type FontSpec, type TextMeasurer } from '../../text';
import type { Theme } from '../../types/theme';
import type { Id } from '../../types/cell';
import type { LintWarning } from '../../types/scene';
import type { ResolvedCell, ResolvedColumn, ResolvedRow, ResolvedTable, RowRole } from '../../types/table';
import type { LevelLadder, TableDensity } from './ladder';
import { groupHeadingFloors, type GroupHeadingCell, type GroupHeadingFaces } from './groupHeading';
import { qualifierFont } from './statement';
import { statusSquare } from './chips';
import { readerFloorPx, tableHeadFloorPx } from '../../typeFloors';
import { scaleTextPx } from '../../target';
import { SPARK_LABEL_SHARE } from '../sparkline/share';
import { maxOf } from '../../arrays';

/** Room an in-cell bar keeps beside its value. */
const BAR_VISUAL_RESERVE = 72;
/** Air on each side of a cell's content. */
const CELL_PAD_X = 12;
/** Indents: 24 base, +16 per level. */
export const INDENT_BASE = 24;
const INDENT_STEP = 16;

/**
 * A tree label's start past the cell air, and its step per rung.
 * `options.labelIndent` measures the ladder from the row's edge, the way a
 * table ladder is usually written as 24 / 40 / 56, so the cell air is part of it: with
 * 6 px of air the base past the air is 18. A base inside the air clamps to
 * the air. Absent, a table without marks starts at the air. Outline marks
 * and interactive fold buttons add 24 px. Both step 16 px.
 */
export function labelIndents(padX: number, authored: { base: number; step?: number } | undefined, withMarks = true): { base: number; step: number } {
  if (authored === undefined) return { base: withMarks ? INDENT_BASE : 0, step: INDENT_STEP };
  return { base: Math.max(0, authored.base - padX), step: authored.step ?? INDENT_STEP };
}
/** The outline mark is 8 px square and sits 16 px left of its label. */
export const MARK_SIZE = 8;
export const CHIP_PAD_X = 8;
/** Air between a section heading's text and its status chip. */
export const SECTION_CHIP_GAP = 8;
/** The narrowest a row label or a heading is cut to. */
export const HEADING_CUT_MIN = 20;
/**
 * Room a sortable header keeps beside its text for the chevron: the
 * 8 px mark plus its gap. The track is a hard width, so a header that grew a
 * chevron without claiming the pixels would clip its own label.
 */
export const SORT_CHEVRON_RESERVE = MARK_SIZE + 4;
/** Disclosure notes a composing layout (dimswitch) adds to a table: printed after the author's, without a number. */
export const ENGINE_NOTES = Symbol('tableEngineNotes');
/**
 * The label track's authored maxWidth is its width before frame fill, not a
 * cap: the track may take free frame width so a name prints whole. A dimswitch
 * sets it for an authored `widths.label`.
 */
export const SOFT_LABEL_CAP = Symbol('tableSoftLabelCap');
/**
 * The label track never shrinks below the width where every row label prints
 * whole on two lines broken at a space, its unit on a line of its own, and
 * every word of the head whole. A dimswitch sets it: below that width its card
 * form or a refusal takes over, so no label is cut to a stub.
 */
export const LABEL_WRAP_FLOOR = Symbol('tableLabelWrapFloor');
/** Width an encoding column claims whatever it draws. */
export const ENCODING_WIDTH = 88;
/**
 * Default value-track growth cap: value tracks take frame
 * slack up to 2.5 times their width before the label track takes any.
 */
export const DEFAULT_TRACK_GROWTH = 2.5;
/**
 * How far an inline line's label sits in from its parent's. The one
 * place the indent is chosen; SVG and React read it.
 */
export const INLINE_LABEL_INDENT = 8;

/** The faces a table draws, derived once from the theme and its ladder. */
export interface TableFonts {
  header: FontSpec;
  /** The second head line under a column label: the ladder's micro step. */
  sub: FontSpec;
  group: FontSpec;
  body: FontSpec;
  /** A total row's label, and the face its cells are measured in. */
  total: FontSpec;
  /**
   * The figures of a total row. The same face as `total` except under
   * `table.fixedType` in a cohort grid, where the label keeps the total size
   * and the figures take the matrix step.
   */
  totalValue: FontSpec;
  section: FontSpec;
  hint: FontSpec;
  note: FontSpec;
  chip: FontSpec;
}

/** uppercase header letter-spacing (px) */
const TRACKING = 0.5;
/** Tracked uppercase: section 0.14 em, group heading 0.12 em. */
const SECTION_TRACKING_EM = 0.14;
const GROUP_TRACKING_EM = 0.12;

/**
 * The column count from which a table has a dense head face: the
 * header at 8 px and the group heading at 9, from twenty-five columns 7 and 8.
 */
export const DENSE_COLUMNS = 20;

/**
 * The faces a table draws. `denseColumns` shrinks the heads by column count,
 * and a caller passes it only where the heads at the regular face do not fit
 * (`headsFit`). Shrinking by column count fits a surface that cannot
 * scroll into its width. The grid scrolls, so for it only a track it cannot
 * widen can refuse a regular head; the SVG also shrinks where the tracks at
 * the regular face are wider than its plot. Nothing below the heads moves.
 */
export function tableFonts(theme: Theme, ladder: LevelLadder, denseColumns = 0): TableFonts {
  // The theme's head and section faces; an absent key keeps the
  // engine's value, so a theme without them draws what it drew before. A
  // head size the theme writes holds at every column count: the dense face
  // is only for a theme that left the size to the engine.
  const head = theme.table?.head;
  const wide = denseColumns >= DENSE_COLUMNS && head?.size === undefined;
  const label = ladder.label;
  const target = ladder.target;
  const d = (px: number): number => scaleTextPx(px, ladder.textScale);
  const headFloor = Math.min(ladder.axis, tableHeadFloorPx(target, ladder.textScale));
  const labelFloor = Math.min(label, readerFloorPx(target, 'label', ladder.textScale));
  // No head under the reader floor, dense or not.
  const headSize = Math.max(headFloor, ladder.axis);
  const groupSize = Math.max(headFloor, ladder.group);
  const headTracking = head?.tracking === undefined ? d(wide ? 0.2 : TRACKING) : head.tracking * headSize;
  // A section heading opens a block: tracked capitals at the column-head size
  // and the emphasis weight, over a heavy rule. A theme size or weight wins.
  const section = theme.table?.section;
  const sectionSize = section?.size ?? headSize;
  return {
    header: { family: theme.type.family, size: headSize, weight: head?.weight ?? theme.type.axis.weight, lineHeight: 1.2, letterSpacing: headTracking },
    sub: { family: theme.type.family, size: Math.max(headFloor, ladder.micro), weight: (theme.type.micro ?? theme.type.footnote).weight, lineHeight: 1.2 },
    group: { family: theme.type.family, size: groupSize, weight: theme.type.axis.weight, lineHeight: 1.2, letterSpacing: groupSize * GROUP_TRACKING_EM },
    body: { family: theme.type.family, size: label, weight: theme.type.label.weight, lineHeight: 1.2 },
    total: { family: theme.type.family, size: ladder.total, weight: tableEmphasis(theme), lineHeight: 1.2 },
    totalValue: { family: theme.type.family, size: label, weight: tableEmphasis(theme), lineHeight: 1.2 },
    section: { family: theme.type.family, size: sectionSize, weight: section?.weight ?? tableEmphasis(theme), lineHeight: 1.2, letterSpacing: sectionSize * (section?.tracking ?? SECTION_TRACKING_EM) },
    hint: { family: theme.type.family, size: Math.max(labelFloor, ladder.group), weight: theme.type.axis.weight, lineHeight: 1.2 },
    note: { family: theme.type.family, size: theme.type.footnote.size, weight: theme.type.footnote.weight, lineHeight: 1.2 },
    // Data-bearing chips stop at the label floor.
    chip: { family: theme.type.family, size: Math.max(labelFloor, theme.type.footnote.size), weight: theme.type.label.weight, lineHeight: 1.2 },
  };
}

/** Normal horizontal cell padding; the shared width pass selects a dense fallback only when needed. */
export function cellPadX(_columnCount: number): number {
  return CELL_PAD_X;
}

/** The face a row draws at its rung, shared by the SVG and the HTML grid. */
export function rowFont(theme: Theme, ladder: LevelLadder, fonts: TableFonts, role: RowRole, level: number, hasChildren: boolean, hasChanges = false): FontSpec {
  if (role === 'section') return fonts.section;
  if (role === 'total') return fonts.total;
  const size = hasChanges ? Math.max(ladder.size(level), CHANGE_LINE_MIN_PX) : ladder.size(level);
  return { family: theme.type.family, size, weight: ladder.weight(level, hasChildren), lineHeight: 1.2 };
}

/**
 * A presentation kind keeps the row face unless the theme sets its weight.
 * Subtotals, results and parent rows use emphasis; leaves stay regular.
 */
export function kindFont(font: FontSpec, kind: ResolvedRow['kind'], label: boolean, theme: Theme): FontSpec {
  if (kind === undefined || kind === 'section') return font;
  const weights = theme.table?.weights;
  const weight = kind === 'detail' || kind === 'split' || kind === 'driver' ? font.weight
    : label ? weights?.[kind] ?? (kind === 'result' || kind === 'subtotal' ? tableEmphasis(theme) : font.weight)
      : weights?.figures?.[kind] ?? (kind === 'result' || kind === 'subtotal' ? tableEmphasis(theme) : font.weight);
  return { ...font, weight, ...(kind === 'driver' && theme.table?.driver?.italic !== false ? { style: 'italic' as const } : {}) };
}

/**
 * A `strong` column carries the header's weight down its cells, except on a subtotal, a result or a
 * de-emphasized cell. The tracks measure this face, so a bold label gets the room it draws in.
 */
export function strongColumnFont(font: FontSpec, column: Pick<ResolvedColumn, 'emphasis'> | undefined, cell: ResolvedCell, kind: ResolvedRow['kind'], theme: Theme): FontSpec {
  return column?.emphasis === 'strong' && !cell.deEmphasized && kind !== 'subtotal' && kind !== 'result'
    ? { ...font, weight: theme.table?.weights?.block ?? tableEmphasis(theme) } : font;
}

/**
 * The legacy inline-note and unit face. Change lines use `changeLineFont`.
 */
export function inlineFont(theme: Theme, ladder: LevelLadder, _step: number, _signed: boolean): FontSpec {
  return { family: theme.type.family, size: ladder.inlineSize(), weight: theme.type.label.weight, lineHeight: 1.2 };
}

/** Change text follows its own row's value face on both surfaces. */
export const CHANGE_LINE_MIN_PX = 11;
export const CHANGE_LINE_SIZE_STEP_PX = 1;
export function changeLineFont(theme: Theme, ladder: LevelLadder, step: number): FontSpec {
  return { family: theme.type.family, size: Math.max(CHANGE_LINE_MIN_PX, ladder.size(step) - CHANGE_LINE_SIZE_STEP_PX), weight: 400, lineHeight: 1.2 };
}

/** Smaller change text must not undo an existing fitted number format. */
export function changeLineFitFont(theme: Theme, ladder: LevelLadder, step: number, signed: boolean, text: string, measure: TextMeasurer, tabular?: boolean, slack?: (font: FontSpec, width: number) => number): FontSpec {
  const current = changeLineFont(theme, ladder, step);
  const previous = inlineFont(theme, ladder, step, signed);
  if (current.size === previous.size && current.weight === previous.weight) return current;
  const previousWidth = measure(text, figureFont(previous, tabular)).width;
  const currentWidth = measure(text, figureFont(current, tabular)).width;
  return previousWidth + (slack?.(previous, previousWidth) ?? 0) >= currentWidth + (slack?.(current, currentWidth) ?? 0) ? previous : current;
}

/**
 * What a browser draws beyond our metrics at weight 600. The
 * shipped width tables are measured from the font's own advance widths; a
 * browser rasterising Geist Variable at 600 lands 1 to 5 px wider on a
 * figure, and a grid track is a hard width, so the last characters of
 * "$101.90" met an ellipsis. Only the surface that hands the text to a
 * browser asks for it; the SVG measures and draws with the same numbers.
 */
const BOLD_BROWSER_SLACK = 0.04;

export function browserSlack(font: FontSpec, width: number): number {
  return (font.weight ?? 400) >= 600 ? Math.ceil(width * BOLD_BROWSER_SLACK) : 0;
}

export interface WidthContext {
  theme?: Theme;
  measure: TextMeasurer;
  fonts: TableFonts;
  cellFont: (cell: ResolvedCell) => FontSpec;
  inlineFont: (level: number, signed: boolean) => FontSpec;
  changeFont?: (level: number) => FontSpec;
  /** Indent of a row label at this level; 0 on a table that is not a tree. */
  rowIndent: (level: number) => number;
  /** An inline line label's indent past its row's (`inlineLabelIndent`); absent, a new target's 8 px. */
  inlineIndent?: number;
  padX: number;
  headerText: (column: ResolvedColumn) => string;
  /** Room an encoding reserves beside the value (the in-cell bar, the arrow). */
  reserve?: (column: ResolvedColumn) => number;
  /** Room the HEADER reserves beside its text (the React sort chevron). */
  headerReserve?: (column: ResolvedColumn) => number;
  /**
   * The surface tracks its header with CSS letter-spacing, which follows the
   * last letter as well as the gaps the measurer counts.
   */
  headerTrailingTracking?: boolean;
  /** Extra a browser needs over the measured width; `browserSlack` on React. */
  slack?: (font: FontSpec, width: number) => number;
  /** A row label or a text cell counts at its two-line width (`twoLineWidth`, a label broken as a name breaks): the width that prints it uncut. */
  twoLineLabels?: boolean;
  /**
   * Whether the surface draws a cell's string, or a line inside that cell,
   * with tabular figures. Absent means the face's own digits.
   */
  figures?: (column: ResolvedColumn, cellText: string, lineText?: string) => boolean;
  /**
   * Room a parent row's collapsed hint takes on the label's line, gap
   * included, on a surface that prints it there. It counts for every
   * parent that can print one, collapsed now or not, so an expansion moves no
   * column. Absent: the surface clips the hint inside the label cell.
   */
  hint?: (row: ResolvedRow) => number;
  /**
   * 2 lets a value column's head wrap to two lines: the
   * last step a card table takes before it refuses. Absent: one line.
   */
  headLines?: number;
  /**
   * The face a table sparkline prints its end value in. A sparkline track
   * without an authored width takes the room that value needs; absent, it
   * keeps the 88 px floor.
   */
  sparkFont?: FontSpec;
}

/** The face a string is measured in: flagged tabular where it is drawn so. */
export function figureFont(font: FontSpec, tabular: boolean | undefined): FontSpec {
  return tabular === true ? { ...font, tabular: true } : font;
}

/**
 * What the tracks a section heading spans, the label column and every one
 * after it, must add up to for what follows the heading on its line: the
 * cell air, the indent, the shortest cut of the heading, the unit affix,
 * the gap and the status chip. One answer for both
 * surfaces, so the grid reports the width the SVG draws. The chip's 2 x 8 px
 * of measured air is wider than the grid's .52em, which leaves the browser
 * room for its bolder 600 weight.
 *
 * Where `ctx.hint` gives a foldable section a collapsed hint, the hint
 * follows the whole heading, so the tracks pay for the whole heading and the
 * hint. A caller passes `hint` for the natural width only, as the
 * label track pays for a data row's hint: a frame that squeezes the
 * table cuts the hint first.
 */
export function sectionChipFloor(
  rows: readonly ResolvedRow[],
  ctx: Pick<WidthContext, 'measure' | 'fonts' | 'padX' | 'rowIndent' | 'inlineFont' | 'slack' | 'hint' | 'theme'>,
): number {
  let floor = 0;
  for (const row of rows) {
    if (row.role !== 'section') continue;
    const hint = ctx.hint?.(row) ?? 0;
    if (row.badge === undefined && hint === 0) continue;
    const chip = row.badge === undefined ? 0
      : SECTION_CHIP_GAP + Math.round(ctx.measure(row.badge.text, ctx.fonts.chip).width + 2 * CHIP_PAD_X);
    const qualifier = ctx.theme?.table?.qualifier;
    const affix = row.unitAffix === undefined ? 0 : qualifier && ctx.theme
      ? ctx.measure(row.unitAffix, qualifierFont(ctx.fonts.section, ctx.theme)).width + (qualifier.gap ?? 4)
      : ctx.measure(` ${row.unitAffix}`, ctx.inlineFont(row.step, false)).width;
    const whole = ctx.measure(ctx.theme?.table?.section?.case === 'asis' ? row.label : row.label.toUpperCase(), ctx.fonts.section).width;
    const heading = hint === 0 ? HEADING_CUT_MIN : whole + (ctx.slack?.(ctx.fonts.section, whole) ?? 0);
    floor = Math.max(floor, 2 * ctx.padX + ctx.rowIndent(row.step) + heading + affix + chip + hint);
  }
  return Math.ceil(floor);
}

/** The gap before a collapsed hint, after the label and whatever follows it. */
export const HINT_GAP = 6;

/**
 * Room a parent's collapsed hint takes after its label, its gap included, or
 * 0 where it prints none: a row that does not fold, or a level without a
 * noun. The same answer on both surfaces.
 */
export function collapsedHintWidth(
  row: ResolvedRow, levelNouns: ResolvedTable['levelNouns'], count: number, measure: TextMeasurer, font: FontSpec,
): number {
  const noun = levelNouns?.[row.level + 1];
  if (!row.hasChildren || row.foldable === false || noun === undefined || count === 0) return 0;
  return HINT_GAP + measure(`· ${count} ${count === 1 ? noun.one : noun.other}`, font).width;
}

/**
 * The track of an encoding column without an authored width: 88 px, and for a
 * sparkline wide enough that its end value prints whole. The plot may give
 * the value no more than SPARK_LABEL_SHARE of the track, so the track is the
 * widest end value over that share.
 */
function encodingTrackWidth(column: ResolvedColumn, rows: readonly ResolvedRow[], ctx: WidthContext): number {
  const encoding = column.encoding;
  if (encoding?.type !== 'sparkline' || ctx.sparkFont === undefined) return ENCODING_WIDTH;
  let widest = 0;
  for (const row of rows) {
    if (row.role === 'section' || row.inline === true) continue;
    // The last source cell that holds a number: the one the sparkline labels.
    let text: string | undefined;
    for (const id of encoding.sourceColumns) {
      const cell = row.cells[id];
      if (cell?.state === 'value' && typeof cell.raw === 'number') text = cell.displayed;
    }
    if (!text) continue;
    const width = ctx.measure(text, ctx.sparkFont).width;
    widest = Math.max(widest, width + (ctx.slack?.(ctx.sparkFont, width) ?? 0));
  }
  return Math.max(ENCODING_WIDTH, Math.ceil(widest / SPARK_LABEL_SHARE));
}

/**
 * The width one column needs for the strings it holds: its header, every
 * cell, the note beside a cell, the indent of a row label, and the lines a
 * row prints inside the cell. Every AUTHORED line counts, hidden ones
 * included, so a Changes control that brings a line back does not move the
 * column it lands in.
 *
 * Two rows of strings do NOT set this width. A row-label note
 * prints UNDER its label, so the label column needs the wider of the two and
 * not their sum. And a section heading spans the whole table on both
 * surfaces, so the one long heading of a KPI board ("Sales mix · group
 * share of sales, sales channel within the group", 394 px) stopped setting a
 * 445 px row-label track while the longest label needed 200. A hoisted unit
 * affix DOES share the label's line, so the track pays for both, and so does
 * a collapsed hint where the surface prints one (`ctx.hint`).
 */
export function intrinsicColumnWidth(
  column: ResolvedColumn,
  rows: readonly ResolvedRow[],
  ctx: WidthContext,
  figuresOnly = false,
): number {
  if (column.kind === 'encoding') return encodingTrackWidth(column, rows, ctx);
  const isRowLabel = column.kind === 'rowLabel';
  const headerW = figuresOnly ? 0 : headerContentWidth(column, ctx);
  let cellMax = 0;
  for (const row of rows) {
    if (row.inline === true) continue;
    if (isRowLabel && row.role === 'section') continue;
    const cell = row.cells[column.id];
    if (!cell) continue;
    const font = ctx.cellFont(cell);
    let width = (isRowLabel || column.kind === 'text') && ctx.twoLineLabels === true
      ? twoLineWidth(cell.displayed, font, ctx.measure, isRowLabel)
      : ctx.measure(cell.displayed, figureFont(font, ctx.figures?.(column, cell.displayed))).width;
    width += ctx.slack?.(font, width) ?? 0;
    // Only what the text adds is capped here: the indent, the affix and the hint come on top, and a wider column from other content gives labels the room.
    if (isRowLabel && column.width === undefined && column.maxTextWidth !== undefined) width = Math.min(width, column.maxTextWidth);
    if (isRowLabel && row.unitAffix !== undefined) {
      width += ctx.theme?.table?.qualifier
        ? ctx.measure(row.unitAffix, qualifierFont(font, ctx.theme)).width + (ctx.theme.table.qualifier.gap ?? 4)
        : ctx.measure(` ${row.unitAffix}`, ctx.inlineFont(row.step, false)).width;
    }
    if (isRowLabel) width += ctx.hint?.(row) ?? 0;
    if (cell.note && !figuresOnly) {
      // A note that takes a line of its own needs the wider of the two, the
      // way a row-label note does; one that stays inline adds to the figure.
      const underFigure = isRowLabel || column.noteLine === true;
      const note = ctx.measure(
        underFigure ? cell.note : ` ${cell.note}`,
        underFigure ? ctx.inlineFont(row.step, false) : ctx.fonts.note,
      ).width;
      width = underFigure ? Math.max(width, note) : width + note;
    }
    if (isRowLabel) width += ctx.rowIndent(row.step);
    if (cell.kind === 'status' && cell.state === 'value' && column.statusMark === 'square') {
      const text = ctx.measure(cell.displayed, ctx.fonts.body).width;
      const square = statusSquare(ctx.fonts.body.size);
      width = text + (ctx.slack?.(ctx.fonts.body, text) ?? 0) + square.side + square.gap;
    } else if (cell.kind === 'status' && cell.state === 'value') {
      // chips measure with the CHIP font (600 bold factor) + real padding
      const chip = ctx.measure(cell.displayed, ctx.fonts.chip).width;
      width = chip + (ctx.slack?.(ctx.fonts.chip, chip) ?? 0) + 2 * CHIP_PAD_X;
    }
    cellMax = Math.max(cellMax, width);
    for (const line of row.inlineRows ?? []) {
      const lineFont = ctx.changeFont?.(row.step) ?? ctx.inlineFont(row.step, line.polarity !== undefined);
      const text = isRowLabel ? line.label : (line.cells[column.id]?.displayed ?? '');
      if (!text) continue;
      const tabular = !isRowLabel && ctx.figures?.(column, cell.displayed, text);
      cellMax = Math.max(
        cellMax,
        // An inline line's label sits in from its parent's (inlineLabelIndent).
        ctx.measure(text, figureFont(lineFont, tabular)).width + (isRowLabel ? ctx.rowIndent(row.step) + (ctx.inlineIndent ?? 8) : 0),
      );
    }
  }
  const natural = Math.ceil(Math.max(headerW, cellMax + (figuresOnly ? 0 : ctx.reserve?.(column) ?? 0)) + 2 * ctx.padX);
  return column.kind === 'rowLabel' && column.width === undefined && column.maxWidth !== undefined ? Math.min(natural, column.maxWidth) : natural;
}

/** The widest an authored row-label width grows so that no label is cut. */
export const LABEL_WIDTH_GROWTH_CAP = 180;

/**
 * The track an authored `width` gives a column. A number is never cut: a value
 * or computed column takes the wider of the authored width and the width its
 * widest printed value needs, with the cell air. A note beside the value and an
 * encoding reserve do not count: they may still clip. A row label is not cut
 * either, up to LABEL_WIDTH_GROWTH_CAP (or a smaller maxWidth): the track grows
 * to the labels' own width, on two lines where `ctx.twoLineLabels` allows them.
 * Any other column keeps the width as authored.
 */
export function authoredTrackWidth(column: ResolvedColumn, rows: readonly ResolvedRow[], ctx: WidthContext): number | undefined {
  if (column.width === undefined) return undefined;
  if (column.kind === 'rowLabel') {
    const cap = Math.min(LABEL_WIDTH_GROWTH_CAP, column.maxWidth ?? Infinity);
    return Math.max(column.width, Math.min(cap, intrinsicColumnWidth(column, rows, ctx)));
  }
  return column.kind === 'value' || column.kind === 'computed'
    ? Math.max(column.width, intrinsicColumnWidth(column, rows, ctx, true)) : column.width;
}

/**
 * What an authored `width` costs a value, computed or text column, one rule for the SVG and the
 * grid, each with its own measurements: `table-column-widened` where the track grew past the width
 * to print its widest figure, `table-column-clipped` where the track is narrower than the content
 * needs. `index` is the column's place in `data.columns`.
 */
export function authoredWidthWarnings(col: ResolvedColumn, index: number, track: number, minimumWidth: number, ctx: WidthContext): LintWarning[] {
  if (col.width === undefined || (col.kind !== 'value' && col.kind !== 'computed' && col.kind !== 'text' && col.kind !== 'status' && col.kind !== 'rowLabel')) return [];
  const warnings: LintWarning[] = [];
  if (track > col.width) {
    warnings.push({
      code: 'table-column-widened',
      severity: 'warn',
      message: col.kind === 'rowLabel'
        ? `column '${col.id}' is ${col.width} px wide and its labels need ${track} px — the column was widened so no label is cut`
        : `column '${col.id}' is ${col.width} px wide and its widest value needs ${track} px — the column was widened so no number is cut`,
      owner: { colId: col.id },
      field: ['data', 'columns', index, 'width'],
      detail: { width: col.width, widened: track },
      suggest: col.kind === 'rowLabel' ? `Set the width to ${track} px or more, or remove it, or shorten the labels so they fit ${col.width} px.`
        : `Set the width to ${track} px or more, or remove it, or shorten the format so the values fit ${col.width} px.`,
    });
  }
  if (track < minimumWidth) {
    // A value or computed track already holds its widest figure, so what a
    // shortfall cuts there is the head, or a note or reserve beside the figures.
    const figuresFit = col.kind !== 'text' && col.kind !== 'status' && col.kind !== 'rowLabel';
    const headCut = figuresFit && Math.ceil(headerContentWidth(col, ctx) + 2 * ctx.padX) > track;
    const cut = col.kind === 'rowLabel' ? 'the labels are' : !figuresFit ? 'the cells are' : headCut ? 'the column head is' : 'the notes beside the figures are';
    warnings.push({
      code: 'table-column-clipped',
      severity: 'warn',
      message: `column '${col.id}' is ${track} px wide and its content needs ${minimumWidth} px — ${cut} cut at ${col.kind === 'rowLabel' && track > col.width ? `the ${track} px label cap` : 'the authored width'}${figuresFit ? ' (the figures print whole)' : ''}`,
      owner: { colId: col.id },
      field: ['data', 'columns', index, 'width'],
      detail: { width: track, natural: minimumWidth },
      suggest: `Set the width to ${minimumWidth} px or more, or remove it so the column takes the width its content needs.`,
    });
  }
  return warnings;
}

/** The room a column's head takes inside the cell air, at `ctx.fonts`. */
export function headerContentWidth(column: ResolvedColumn, ctx: WidthContext): number {
  const text = ctx.headerText(column);
  const headerMeasured = ctx.headLines === 2 && column.kind !== 'rowLabel'
    ? twoLineWidth(text, ctx.fonts.header, ctx.measure) : ctx.measure(text, ctx.fonts.header).width;
  // A sub-label is a SECOND line under the label, so the head needs the
  // wider of the two and not their sum.
  const subW = column.subLabel === undefined ? 0 : ctx.measure(column.subLabel, ctx.fonts.sub).width;
  return Math.max(
    headerMeasured
      + (ctx.slack?.(ctx.fonts.header, headerMeasured) ?? 0)
      + headerTrailing(text, ctx)
      + (ctx.headerReserve?.(column) ?? 0),
    subW,
  )
    // The label column's header sits where the level-0 labels sit,
    // so the track pays for that indent as the labels' own rows do.
    + (column.kind === 'rowLabel' ? ctx.rowIndent(0) : 0);
}

/** The tracking step CSS draws after a header's last letter, where the surface asks for it. */
export function headerTrailing(text: string, ctx: Pick<WidthContext, 'fonts' | 'headerTrailingTracking'>): number {
  return ctx.headerTrailingTracking === true && text.length > 0 ? ctx.fonts.header.letterSpacing ?? 0 : 0;
}

/**
 * Whether every head fits the track it is drawn over at `ctx.fonts`.
 * A measured track paid for its own head, so only a track the width pass
 * cannot widen can refuse one: an authored width, an encoding column, and a
 * heat cell where the table draws no `figures`. A group heading fails only over members that are all
 * fixed, since the floors widen the last free member for it. Both surfaces
 * ask this before they take the dense face; the SVG also asks whether the
 * tracks fit its plot.
 */
export function headsFit(
  columns: readonly ResolvedColumn[],
  groups: ResolvedTable['columnGroups'],
  widthOf: (id: Id) => number,
  figures: boolean,
  ctx: WidthContext,
  faces: GroupHeadingFaces,
  cell: GroupHeadingCell,
): boolean {
  for (const column of columns) {
    const fixed = column.width !== undefined || column.kind === 'encoding' || (!figures && column.cellEncoding?.type === 'heat');
    if (fixed && Math.ceil(headerContentWidth(column, ctx) + 2 * ctx.padX) > widthOf(column.id)) return false;
  }
  const ids = columns.map((column) => column.id);
  return groupHeadingFloors(groups, ids, widthOf, () => false, faces, ctx.measure, cell).size === 0;
}

export interface ColumnTrack {
  id: Id;
  /** What the column needs for its own strings. */
  natural: number;
  /** What it takes on screen: 0 while hidden, the natural width scaled otherwise. */
  width: number;
  /** The last drawn track under `lastTrackFlex`: `minmax(natural, 1fr)`. */
  flex?: true;
}

interface TrackOptions {
  /** Columns a toggle has switched off; their track closes to zero. */
  hidden?: ReadonlySet<Id>;
  /** 'fill' shares the frame between the drawn tracks; 'content' keeps them natural. */
  fit?: 'fill' | 'content';
  /** Width the frame offers, when the host measured one. */
  available?: number;
  /** The column that keeps its natural width while the others share the rest. */
  anchorId?: Id;
  /**
   * Columns whose width the author wrote down. They keep exactly
   * that many pixels while the table fills its frame: a board that says
   * `220 | 9 × 88 | 90 | 112` means those numbers, and a growth factor over
   * them turns a month column into 90.7.
   */
  fixed?: ReadonlySet<Id>;
  /**
   * Give the last drawn track the room the fixed tracks left over, so the
   * grounds and the rules reach the frame edge. Two pixels of rounding
   * slack are two pixels of bare canvas beside a banded block.
   */
  lastTrackFlex?: boolean;
  /**
   * How far a drawn track may stretch past its natural width. Uncapped when
   * absent; the React grid passes `DEFAULT_TRACK_GROWTH` or the table's own
   * `options.maxGrowth`.
   */
  maxGrowth?: number;
}

/**
 * What each track takes. A hidden column closes to zero and keeps its place
 * in the list, so the track list a renderer transitions between has the same
 * shape before and after and the browser can interpolate it. A filling table
 * shares the frame between the tracks that are left: the anchor keeps its
 * natural width and the rest grow in proportion to theirs, taking the whole
 * room. A caller that wants the growth capped passes `maxGrowth`, and the
 * room left over after that cap stays to the right of the table rather than
 * being poured into the row-label column.
 */
export function columnTracks(
  columns: readonly { id: Id; natural: number }[],
  options: TrackOptions = {},
): ColumnTrack[] {
  const hidden = options.hidden;
  const drawn = columns.filter((column) => hidden?.has(column.id) !== true);
  const anchor = options.anchorId === undefined ? undefined : drawn.find((column) => column.id === options.anchorId);
  const isFixed = (column: { id: Id }) => column !== anchor && options.fixed?.has(column.id) === true;
  const flexible = drawn.filter((column) => column !== anchor && !isFixed(column));
  const flexibleNatural = flexible.reduce((sum, column) => sum + column.natural, 0);
  const fixedNatural = drawn.filter(isFixed).reduce((sum, column) => sum + column.natural, 0);
  const room = options.available === undefined
    ? undefined
    : options.available - (anchor?.natural ?? 0) - fixedNatural;
  // Never below 1: a table wider than its frame is not squeezed
  // into it, it scrolls. A factor under 1 would cut every track's last
  // characters to an ellipsis inside a box the reader can scroll.
  const growth = room === undefined ? 1 : room / flexibleNatural;
  const factor = options.fit !== 'fill' || room === undefined || flexibleNatural <= 0
    ? 1
    : Math.max(1, options.maxGrowth === undefined ? growth : Math.min(options.maxGrowth, growth));
  const tracks: ColumnTrack[] = columns.map((column) => ({
    id: column.id,
    natural: column.natural,
    width: hidden?.has(column.id) === true
      ? 0
      : column === anchor || isFixed(column)
        ? column.natural
        : Math.round(column.natural * factor * 10) / 10,
  }));
  if (options.lastTrackFlex === true && drawn.length > 0) {
    const lastId = drawn[drawn.length - 1]!.id;
    const last = tracks.find((track) => track.id === lastId)!;
    last.flex = true;
    // The room every other track left: a board of fixed tracks inside a
    // wider frame ends two pixels short of it, and those two pixels are
    // where a band stops before the card edge.
    if (options.fit === 'fill' && options.available !== undefined) {
      const slack = Math.round((options.available - trackTotal(tracks)) * 10) / 10;
      if (slack > 0) last.width = Math.round((last.width + slack) * 10) / 10;
    }
  }
  return tracks;
}

/**
 * Share frame slack between value tracks, up to the growth cap, and give the
 * rest to an unauthored label track, so the table and its rules end at the
 * frame edge (every table, one value track too). Both surfaces use whole pixels and the same rounding
 * order.
 */
export function frameFillExtras(tracks: readonly { id: Id; width: number }[], slack: number, growth?: number | false, labelId?: Id): Map<Id, number> {
  const maxGrowth = growth ?? DEFAULT_TRACK_GROWTH;
  const extras = new Map<Id, number>();
  const room = Math.floor(slack);
  const total = tracks.reduce((sum, track) => sum + track.width, 0);
  if (room < 1) return extras;
  const valueRoom = total <= 0 ? 0 : maxGrowth === false ? room : Math.min(room, Math.floor(total * (maxGrowth - 1)));
  // The room fills the narrowest tracks first, each up to its own growth cap, so the value tracks even out and no
  // single wide track takes the leftover (a Q4 column with a wider head would grow in proportion and take it).
  const cap = (width: number) => (maxGrowth === false ? Infinity : width * (maxGrowth - 1));
  const fill = (level: number) => tracks.reduce((sum, track) => sum + Math.min(cap(track.width), Math.max(0, level - track.width)), 0);
  let low = 0;
  let high = Math.max(0, maxOf(tracks.map((track) => track.width))) + valueRoom;
  for (let pass = 0; pass < 60; pass++) {
    const mid = (low + high) / 2;
    if (fill(mid) < valueRoom) low = mid; else high = mid;
  }
  const shares = tracks.map((track, index) => ({ id: track.id, index, exact: total <= 0 ? 0
    : Math.min(cap(track.width), Math.max(0, high - track.width)) }));
  let left = valueRoom;
  for (const share of shares) {
    const whole = Math.floor(share.exact);
    extras.set(share.id, whole);
    left -= whole;
  }
  // The px the rounding left go to the largest fractions, earlier tracks first.
  for (const share of [...shares].sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)) || a.index - b.index).slice(0, Math.max(0, left))) {
    extras.set(share.id, extras.get(share.id)! + 1);
  }
  if (labelId !== undefined && room > valueRoom) extras.set(labelId, room - valueRoom);
  return extras;
}

/** Keep the longest requested pin prefix that leaves a whole scrolling column visible. */
export function pinnedColumns(
  columns: readonly Pick<ResolvedColumn, 'id'>[],
  tracks: readonly Pick<ColumnTrack, 'id' | 'width'>[],
  count: number,
  viewport?: number,
): Map<Id, { left: number; last: boolean }> {
  const pins = new Map<Id, { left: number; last: boolean }>();
  if (count <= 0) return pins;
  const widthById = new Map(tracks.map(track => [track.id, track.width]));
  const width = (id: Id) => widthById.get(id) ?? 0;
  const drawn = columns.slice(0, count);
  let pinnedWidth = drawn.reduce((sum, column) => sum + width(`bp-spacer:${column.id}`) + width(column.id), 0);
  let scrollingWidth = Math.max(0, maxOf(columns.slice(drawn.length).map(column => width(column.id))));
  while (drawn.length > 0 && viewport !== undefined && pinnedWidth + scrollingWidth > viewport) {
    const column = drawn.pop()!;
    pinnedWidth -= width(`bp-spacer:${column.id}`) + width(column.id);
    scrollingWidth = Math.max(scrollingWidth, width(column.id));
  }
  let left = 0;
  drawn.forEach((column, index) => {
    pins.set(column.id, { left, last: index === drawn.length - 1 });
    left += width(`bp-spacer:${column.id}`) + width(column.id);
  });
  return pins;
}

/**
 * The CSS track list a row's grid uses. The flexible last track is written
 * as `minmax(<natural>px, 1fr)`: it never falls under what its own strings
 * need, and it takes whatever the fixed tracks left of the frame.
 */
export function trackTemplate(tracks: readonly ColumnTrack[]): string {
  return tracks
    .map((track) => (track.flex === true && track.width > 0
      ? `minmax(${track.natural}px, 1fr)`
      : `${track.width}px`))
    .join(' ');
}

/**
 * What the drawn tracks add up to. The grid element is given this width
 * outright instead of being left to infer it from `max-content`:
 * the table is then exactly as wide as the columns it draws, and the room a
 * capped fill did not use stays to the right of it.
 */
export function trackTotal(tracks: readonly ColumnTrack[]): number {
  return Math.round(tracks.reduce((sum, track) => sum + track.width, 0) * 10) / 10;
}

/** The density a table draws at, as both surfaces name it. */
export type { TableDensity };


/**
 * Room an encoding keeps beside the value: the in-cell bar's lane, the
 * direction arrow's glyph. Both surfaces reserve the same width, so a bar
 * has the same room in the SVG and in the HTML grid.
 */
export function encodingReserve(column: ResolvedColumn, measure: TextMeasurer, fonts: TableFonts): number {
  const encoding = column.cellEncoding;
  if (encoding?.type === 'inCellBar' && (column.kind === 'value' || column.kind === 'computed')) {
    return BAR_VISUAL_RESERVE;
  }
  if (encoding?.type === 'arrow' && column.kind === 'computed' && column.polarity) {
    return measure('↗', fonts.body).width + 4;
  }
  return 0;
}

/** The widest single word: below it a line would have to cut a word. */
function longestWord(text: string, font: FontSpec, measure: TextMeasurer): number {
  return Math.max(20, ...text.split(/\s+/).filter(Boolean).map((word) => measure(word, font).width));
}

/**
 * Width floor of a `wrap: true` prose column. Without the flag a text column
 * claims its longest note on one line, and that claim becomes the whole
 * table's minimum width. That costs roughly 5 px per character of the longest
 * note, so a 120-character note refuses a 900 px canvas. With the flag the
 * cells take as many lines as they need and the row grows, so the
 * column claims only its longest word.
 */
export function wrapFloorWidth(
  column: ResolvedColumn,
  rows: readonly ResolvedRow[],
  headerWidth: number,
  ctx: Pick<WidthContext, 'measure' | 'fonts' | 'cellFont' | 'padX'>,
): number {
  let content = 0;
  for (const row of rows) {
    const cell = row.cells[column.id];
    if (!cell || !cell.displayed) continue;
    const font = ctx.cellFont(cell);
    const noteWidth = cell.note ? ctx.measure(` ${cell.note}`, ctx.fonts.note).width : 0;
    content = Math.max(content, longestWord(cell.displayed, font, ctx.measure) + noteWidth);
  }
  return Math.ceil(Math.max(headerWidth, content) + 2 * ctx.padX);
}
