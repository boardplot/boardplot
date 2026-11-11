/** One width pass for SVG, React, measurement and composed tables. */
import { resolveCanvasOptions, resolveSize } from '../../normalize/shared';
import { canvasMargin } from '../../theme';
import { chartSizing, fitsSize, resolveSizing } from '../../sizing';
import { lineBlockWidth, type FontSpec, type TextMeasurer } from '../../text';
import type { Id } from '../../types/cell';
import type { LintWarning } from '../../types/scene';
import type { Theme } from '../../types/theme';
import type { ResolvedTable, ResolvedColumn, ResolvedRow, ResolvedCell, TableOptions } from '../../types/table';
import { isCohortDensity, levelLadder } from './ladder';
import { textScaleOf, tableHeadFloorPx } from '../../typeFloors';
import { targetFloorsPx, TARGET_SIZE, type TargetSizeOptions } from '../../target';
import { footerType } from '../../footer';
import type { RenderTarget } from '../../types/options';
import type { PresentationInfo } from '../../types/sizing';
import { fieldHeadText } from './headFace';
import { columnHeaderAffix } from './resolve';
import { visibleColumns, visibleRows, visibleInlineRows, treeChildCounts, heatColumn, printsFigures, cellDrawsTabular } from './view';
import { operatorWidth, qualifierFont } from './statement';
import { groupHeadingFaces, groupHeadingFloors, groupHeadingNeed, groupHeadingWrap } from './groupHeading';
import {
  DENSE_COLUMNS, LABEL_WRAP_FLOOR, SOFT_LABEL_CAP, INLINE_LABEL_INDENT, cellPadX as trackCellPadX,
  tableFonts, rowFont as ladderRowFont, kindFont, strongColumnFont, labelIndents, inlineFont as ladderInlineFont,
  changeLineFont, encodingReserve, intrinsicColumnWidth, authoredTrackWidth, authoredWidthWarnings,
  wrapFloorWidth, sectionChipFloor, collapsedHintWidth, headsFit, frameFillAmounts,
  SORT_CHEVRON_RESERVE, DEFAULT_TRACK_GROWTH, headerContentWidth, columnTracks, type TableFonts, type WidthContext, type BodyWidthMeasurements,
} from './tracks';
import { maxOf } from '../../arrays';

const FLEX_MIN = 80;
const HEAT_ONLY_CELL_W = 22;

export interface TableWidthView {
  columns?: readonly ResolvedColumn[];
  rows?: readonly ResolvedRow[];
  widthRows?: readonly ResolvedRow[];
  fullRows?: readonly ResolvedRow[];
  available?: number;
  /** A scrolling host keeps authored tracks; a fixed frame uses the existing shrink order. */
  scroll?: boolean;
  spacerTotal?: number;
  headLines?: number;
  subLines?: number;
  withMarks?: boolean;
  sortable?: ReadonlySet<Id>;
  trailingTracking?: boolean;
  slack?: WidthContext['slack'];
  groupStart?: ReadonlySet<Id>;
  groupEnd?: ReadonlySet<Id>;
  leadWidth?: number;
  allColumns?: readonly ResolvedColumn[];
  fit?: 'fill' | 'content';
  frameStart?: number;
  /**
   * The columns the table shows before the reader switches any group. A scrolling host sizes its label track
   * from them, so a toggle never wraps a row label or moves the content below.
   */
  defaultColumns?: readonly ResolvedColumn[];
  /** The label track the default columns need; the label never shrinks below it in a scrolling host. */
  labelKeep?: number;
  /** false: a head may break before a short last word (the tight rung). */
  headGlue?: boolean;
  /**
   * A scrolling host's box that scrolls: its width and the frame width outside it. The tracks are laid out
   * in `available`; they overflow only past this box, and the advised frame is the box's least frame.
   */
  scrollBox?: { width: number; inset: number };
}

export type WidthOptions = TableOptions & { [LABEL_WRAP_FLOOR]?: boolean; [SOFT_LABEL_CAP]?: boolean };

/** Only a discarded regular rung may stop before its tracks and warnings are complete. */
export interface TableWidthProbe { canvasWidth: number; footerInset: number }
export interface TableWidthMiss { widthMiss: true; minimumW: number; totalW: number; cellPadX: number }
export type TableWidthPlan = ReturnType<typeof materializeTableWidthPlan>;
export type TableWidthRungPlan = Exclude<ReturnType<typeof solveTableWidthRung>, TableWidthMiss>;

/**
 * A column head as every surface sets it: the label in the theme's case
 * (`table.head.case`) and the affix as written ("SPEND ($k)"). The tracks
 * also glue a short last word to the one before it; the React grid does not.
 */
export function columnHeadText(column: ResolvedColumn, theme: Pick<Theme, 'table'>): string {
  return fieldHeadText(column.label, theme) + columnHeaderAffix(column);
}

/** One content width rule. Dense padding is a fallback only when normal padding cannot fit. */
export function tableWidths(table: ResolvedTable, theme: Theme, measure: TextMeasurer, options: WidthOptions, view: TableWidthView, probe: TableWidthProbe | undefined): TableWidthPlan | TableWidthMiss;
export function tableWidths(table: ResolvedTable, theme: Theme, measure: TextMeasurer, options?: WidthOptions, view?: TableWidthView): TableWidthPlan;
export function tableWidths(table: ResolvedTable, theme: Theme, measure: TextMeasurer, options: WidthOptions = {}, view: TableWidthView = {}, probe?: TableWidthProbe): TableWidthPlan | TableWidthMiss {
  if (options.columnHeads !== false) return tableWidthsWithHeads(table, theme, measure, options, view, probe);
  // No head draws, so no head pays for a track: only the cells size the columns.
  const { columnHeads: _heads, ...withHeads } = options;
  const bare = (columns: readonly ResolvedColumn[]) => columns.map((col): ResolvedColumn => {
    const { subLabel: _sub, unitLabel: _unit, partial: _partial, scenario: _scenario, ...rest } = col;
    return { ...rest, label: '' };
  });
  return tableWidthsWithHeads({ ...table, columns: bare(table.columns), columnGroups: table.columnGroups.map((group) => ({ ...group, heading: false as const })) }, theme, measure, withHeads, {
    ...view,
    ...(view.columns === undefined ? {} : { columns: bare(view.columns) }),
    ...(view.allColumns === undefined ? {} : { allColumns: bare(view.allColumns) }),
    ...(view.defaultColumns === undefined ? {} : { defaultColumns: bare(view.defaultColumns) }),
  }, probe);
}

function tableWidthsWithHeads(table: ResolvedTable, theme: Theme, measure: TextMeasurer, options: WidthOptions, view: TableWidthView, probe: TableWidthProbe | undefined): TableWidthPlan | TableWidthMiss;
function tableWidthsWithHeads(table: ResolvedTable, theme: Theme, measure: TextMeasurer, options: WidthOptions, view: TableWidthView): TableWidthPlan;
function tableWidthsWithHeads(table: ResolvedTable, theme: Theme, measure: TextMeasurer, options: WidthOptions, view: TableWidthView, probe?: TableWidthProbe): TableWidthPlan | TableWidthMiss {
  const { defaultColumns, ...own } = view;
  const shown = own.columns ?? visibleColumns(table);
  if (own.scroll && defaultColumns !== undefined
    && (defaultColumns.length !== shown.length || defaultColumns.some((col, index) => col.id !== shown[index]!.id))) {
    const base = tableWidthsWithHeads(table, theme, measure, options, { ...own, columns: defaultColumns });
    const track = base.tracks.find((entry) => entry.id === defaultColumns.find((col) => col.kind === 'rowLabel')?.id)?.width;
    // The width the labels and their folded-row hints need, not the room a wide frame handed the label: only that keeps rows from wrapping.
    if (track !== undefined && base.labelNeed !== undefined) own.labelKeep = Math.min(track, Math.max(base.labelNeed, base.labelBeforeFill ?? 0));
  }
  const regular = tableWidthsOnce(table, theme, measure, options, own, probe);
  if ('widthMiss' in regular) return regular;
  const count = (view.columns ?? visibleColumns(table)).length;
  const densePad = count >= 25 ? 3 : count >= DENSE_COLUMNS ? 5 : regular.cellPadX;
  if (options.cellPadX !== undefined || densePad >= regular.cellPadX || Math.max(regular.minimumW, regular.totalW) <= (view.available ?? Infinity)) return regular;
  const dense = tableWidthsOnce(table, theme, measure, { ...options, cellPadX: densePad }, own);
  if ('widthMiss' in dense) return dense;
  const regularOverflow = regular.warnings.find(warning => warning.code === 'table-overflow');
  // The wider-size repair must also fit after normal padding returns.
  if (regularOverflow) dense.warnings = dense.warnings.map(warning => warning.code === 'table-overflow' ? regularOverflow : warning);
  return dense;
}

/** Measurements do not depend on available space. Rungs solve copies of these numeric tracks. */
function measureTableTracks(table: ResolvedTable, theme: Theme, measure: TextMeasurer, options: WidthOptions, view: TableWidthView) {
  const cols = view.columns ?? visibleColumns(table);
  const columnIndex = new Map(cols.map((col, index) => [col.id, index]));
  const rows = view.rows ?? visibleRows(table);
  const fullRows = view.fullRows ?? table.rows;
  const widthRows = view.widthRows ?? table.rows;
  const spacerBefore = new Map<Id, number>();
  for (const group of table.columnGroups) {
    if (group.spacer === undefined || group.spacer <= 0) continue;
    const ordered = view.allColumns ?? cols;
    const first = ordered.find(col => group.columnIds.includes(col.id));
    if (first && first.id !== ordered[0]?.id) spacerBefore.set(first.id, cols.some(col => group.columnIds.includes(col.id)) ? group.spacer : 0);
  }
  const spacerTotal = view.spacerTotal ?? [...spacerBefore.values()].reduce((sum, width) => sum + width, 0);
  const figures = printsFigures(options.figures, cols);
  const wideTable = cols.length >= DENSE_COLUMNS;
  const cellPadX = options.cellPadX ?? trackCellPadX(cols.length);
  const labelColumn = cols.find(col => col.kind === 'rowLabel');
  const labelLead = labelColumn?.width === undefined ? Math.ceil(view.leadWidth ?? 0) : 0;
  const groupCell = { padX: cellPadX, trailingTracking: view.trailingTracking,
    startRule: view.groupStart === undefined ? undefined : (groupId: Id) => {
      const first = cols.find(col => col.groupId === groupId);
      return first && view.groupStart!.has(first.id) ? 1 : 0;
    } };
  const headingFaces = (faces: TableFonts) => groupHeadingFaces(view.trailingTracking
    ? { ...faces.group, letterSpacing: Math.round((faces.group.letterSpacing ?? 0) * 1000) / 1000 } : faces.group);
  const { ladder, regularFonts, cellStep, indentStep, childCount, cellFont, inlineFont, hasChanges, bodyWidths } =
    measuredTypography(table, theme, measure, options, view, cols, rows, widthRows);
  const isTree = fullRows.some(row => row.hasChildren);
  const indents = labelIndents(cellPadX, options.labelIndent, view.withMarks ?? options.outlineMarks === true);
  const operatorSlot = operatorWidth(rows, theme);
  const rowIndent = (level: number) => (isTree ? indents.base + level * indents.step : 0) + operatorSlot;
  function affixRoom(row: ResolvedRow, font: FontSpec): number {
    if (row.unitAffix === undefined) return 0;
    return theme.table?.qualifier === undefined ? measure(` ${row.unitAffix}`, inlineFont(row.step, false)).width
      : measure(row.unitAffix, qualifierFont(font, theme)).width + (theme.table.qualifier.gap ?? 4);
  }
  // ---- column widths: intrinsic from RESOLVED strings (format-first) ----
  // columnHeaderAffix is SHARED with the HTML and React heads: the affix is
  // the same fact on all three surfaces (which scenario, which money scale),
  // and only the typography differs. A private copy here is how the surfaces
  // came to state two different scales for one table.
  // The label's case is the theme's (`table.head.case`), and the
  // tracks measure the text the head draws.
  // A short last word stays on the line before it: a narrow card broke "WEEK 1" into "WEEK" over "1".
  // The tight rung lets it break again: "PERIOD" over "1" beats a card that leaves the period out.
  const columnHeaderText = (col: (typeof cols)[number]) => {
    const text = columnHeadText(col, theme);
    return view.headGlue === false ? text : text.replace(/ (\S{1,2})$/u, '\u00a0$1');
  };
  /** The tracks every column takes at one set of head faces, and the cuts they report. */
  function trackWidths(faces: TableFonts) {
    const widths: number[] = [];
    const minimumWidths: number[] = [];
    const wrappedOneLines: { index: number; width: number }[] = [];
    const context: WidthContext = {
      theme, measure, bodyWidths, fonts: faces, cellFont, inlineFont, changeFont: (level) => changeLineFont(theme, ladder, level), rowIndent, inlineIndent: INLINE_LABEL_INDENT, padX: cellPadX,
      headerText: columnHeaderText,
      headerReserve: col => view.sortable?.has(col.id) ? SORT_CHEVRON_RESERVE : 0,
      headerTrailingTracking: view.trailingTracking,
      slack: view.slack,
      reserve: (col: ResolvedColumn) => encodingReserve(col, measure, faces),
      // The face the sparkline cells draw their end value in (`emitSparkline`).
      sparkFont: { family: theme.type.family, ...theme.type.label },
      // A cell and each line in it take figures by their own string, as the
      // text nodes below take their role.
      figures: (col: ResolvedColumn, cellText: string, lineText?: string) => cellDrawsTabular(theme, col.kind, lineText ?? cellText),
      // the collapsed hint shares the label's line, as a unit affix does, so the track pays for it.
      hint: (row: ResolvedRow) => collapsedHintWidth(row, table.levelNouns, childCount.get(row.id) ?? 0, measure, faces.hint),
      ...(view.headLines === undefined ? {} : { headLines: view.headLines }),
    };
    for (let index = 0; index < cols.length; index++) {
      const col = cols[index]!;
      const heatOnlyWidth = Math.max(HEAT_ONLY_CELL_W, Math.ceil((view.scroll ? headerContentWidth(col, context)
        : measure(columnHeaderText(col), faces.header).width) + 2 * cellPadX));
      const intrinsicWidth = figures || !heatColumn(col)
        ? intrinsicColumnWidth(col, widthRows, context)
        : heatOnlyWidth;
      const endRule = col.width === undefined && (figures || !heatColumn(col)) && view.groupEnd?.has(col.id) ? 1 : 0;
      if (col.kind === 'encoding') {
        // An authored width is the track, as for any column that is not a value; without one the track fits its end value.
        const track = (authoredTrackWidth(col, widthRows, context) ?? intrinsicWidth) + endRule;
        widths[index] = track;
        minimumWidths[index] = track;
        continue;
      }
      const headerW = view.scroll ? headerContentWidth(col, context)
        : measure(columnHeaderText(col), faces.header).width + (context.headerReserve?.(col) ?? 0);
      // The collapsed hint is paid for at the natural width only: the floor a frame may squeeze the
      // label track to stays the label's, and a squeezed hint is cut instead.
      const minimumWidth = col.wrap ? wrapFloorWidth(col, widthRows, headerW, context)
        : col.kind === 'rowLabel' ? intrinsicColumnWidth(col, widthRows, { ...context, hint: undefined }) : intrinsicWidth;
      minimumWidths[index] = minimumWidth;
      // A heat lane with its figures off takes the 22 px cell over an
      // authored width: that width was set for the figures it does not
      // print, and the triangle narrows only if its cells do.
      // A value or computed column never prints a cut number, so its authored
      // width is a floor there (`authoredTrackWidth`); a text column keeps it fixed.
      const wrapped = view.scroll && col.wrap && col.width === undefined && (figures || !heatColumn(col));
      // An authored label track grows to the labels as they wrap (`authoredTrackWidth`).
      // Labels that fit the authored width on one line skip the wrapped measure.
      const authoredContext = col.kind === 'rowLabel' ? { ...context, labelLines: options.rowLabelLines ?? 2 } : context;
      const authored = col.kind === 'rowLabel' && col.width !== undefined && intrinsicWidth <= col.width ? col.width
        : authoredTrackWidth(col, widthRows, authoredContext);
      widths[index] = figures || !heatColumn(col) ? authored ?? (wrapped ? minimumWidth : intrinsicWidth) : heatOnlyWidth;
      if (wrapped) wrappedOneLines.push({ index, width: intrinsicWidth });
      const extra = (col.kind === 'rowLabel' ? labelLead : 0) + endRule;
      if (extra > 0) for (const target of [widths, minimumWidths]) target[index] = target[index]! + extra;
    }
    // A group heading is drawn over its member tracks, and they pay for it:
    // any shortfall goes to the last member that authored no width,
    // on the drawn width and on the floor a compacting table stops at. A heat
    // lane without figures is fixed at 22 px too: a heading wider than its
    // lanes takes the shortfall elsewhere or runs past them.
    {
      const groupFaces = headingFaces(faces);
      const drawn = cols.map((col) => col.id);
      const isFixed = (id: Id) => {
        const col = cols.find((candidate) => candidate.id === id);
        return col !== undefined && (col.width !== undefined || (!figures && heatColumn(col)));
      };
      for (const target of [widths, minimumWidths]) {
        const floors = groupHeadingFloors(table.columnGroups, drawn, (id) => target[columnIndex.get(id)!] ?? 0, isFixed, groupFaces, measure, groupCell);
        for (const [id, extra] of floors) target[columnIndex.get(id)!] = target[columnIndex.get(id)!]! + extra;
      }
    }
    // A section heading spans the tracks from the label column on, and they pay for what its chip
    // needs: the cell air, the indent, the shortest cut of the heading, its unit affix, the
    // gap and the chip. The shortfall goes to the label track, on the drawn width and on the floor the
    // size gate reads. A collapsed hint counts on the drawn width only, as a data row's does.
    const chipFloor = sectionChipFloor(widthRows, { ...context, hint: undefined });
    if (labelColumn !== undefined) {
      for (const [target, floor] of [[widths, sectionChipFloor(widthRows, context)], [minimumWidths, chipFloor]] as const) {
        const span = chipSpan(target);
        if (span < floor) target[columnIndex.get(labelColumn.id)!] = target[columnIndex.get(labelColumn.id)!]! + floor - span;
      }
    }
    // LABEL_WRAP_FLOOR: the label track holds every label whole on its `rowLabelLines` lines, its unit and its inline
    // lines on their own lines, and every head word, over a hard maxWidth too.
    let labelFloor = options[LABEL_WRAP_FLOOR] === true && labelColumn !== undefined
      ? labelWrapFloor(labelColumn, faces) + labelLead : 0;
    if (labelFloor > 0) for (const target of [widths, minimumWidths]) target[columnIndex.get(labelColumn!.id)!] = Math.max(target[columnIndex.get(labelColumn!.id)!]!, labelFloor);
    if (view.scroll && labelColumn?.width === undefined && labelColumn !== undefined) {
      labelFloor = Math.max(labelFloor, view.labelKeep ?? 0, intrinsicColumnWidth(labelColumn, widthRows, {
        ...context, hint: undefined, labelLines: options.rowLabelLines ?? 2,
      }) + labelLead + (view.groupEnd?.has(labelColumn.id) ? 1 : 0));
    }
    // Prose columns that set the width with their one-line text, where
    // wrapping would take less: the size refusal names them.
    const wrapFloors: (number | undefined)[] = [];
    const wouldWrap = cols.filter((col) => {
      if (col.kind !== 'text' || col.wrap || col.width !== undefined) return false;
      const floor = wrapFloorWidth(col, widthRows, measure(columnHeaderText(col), faces.header).width, context);
      if (floor >= minimumWidths[columnIndex.get(col.id)!]!) return false;
      wrapFloors[columnIndex.get(col.id)!] = floor;
      return true;
    });
    return { widths: widths as readonly number[], minimumWidths: minimumWidths as readonly number[], context, wouldWrap, wrapFloors: wrapFloors as readonly (number | undefined)[], chipFloor, labelFloor, wrappedOneLines };
  }
  /**
   * The narrowest label track at which no row label, inline label or head word is cut and no unit runs past the
   * column (LABEL_WRAP_FLOOR). A unit on its own line may use the cell air on its right, as it always has.
   */
  function labelWrapFloor(col: ResolvedColumn, faces: TableFonts): number {
    let text = rowIndent(0) + Math.max(0, ...columnHeaderText(col).split(/\s+/).map((word) => measure(word, faces.header).width));
    let unit = 0;
    // The drawn rows: a static frame holds what it prints, not the rows its folds hide. An open member prints no unit.
    const open = new Set(rows.map((row) => row.parentId));
    for (const row of rows) {
      const cell = row.cells[col.id];
      if (row.role === 'section' || row.inline === true || !cell?.displayed) continue;
      const font = cellFont(cell);
      const indent = rowIndent(indentStep(cell));
      text = Math.max(text, indent + lineBlockWidth(cell.displayed, options.rowLabelLines ?? 2, font, measure, true));
      if (row.unitAffix !== undefined && !(row.kind === 'member' && open.has(row.id))) {
        const unitFont = theme.table?.qualifier === undefined ? { ...inlineFont(row.step, false), ...(font.style ? { style: font.style } : {}) } : qualifierFont(font, theme);
        unit = Math.max(unit, indent + measure(row.unitAffix, unitFont).width);
      }
      // Only the lines the cell prints: a hidden line (the effect line by default) shows in the hover, not here.
      for (const line of visibleInlineRows(row, options.inlineVisibility)) {
        if (line.label) text = Math.max(text, indent + INLINE_LABEL_INDENT + measure(line.label, changeLineFont(theme, ladder, row.step)).width);
      }
    }
    return Math.ceil(Math.max(text + 2 * cellPadX, unit + cellPadX));
  }
  /** The tracks a section heading spans: the label column and every one after it. */
  function chipSpan(target: readonly number[]): number {
    return cols.slice(cols.indexOf(labelColumn!)).reduce((sum, col) => sum + (target[columnIndex.get(col.id)!] ?? 0), 0);
  }
  /** What a set of tracks and the spacers between them take across the plot. */
  const sumOf = (values: readonly number[]): number => values.reduce((a, b) => a + b, spacerTotal);
  // Only the visible rows contribute to this uncut label need. It is independent of available width and head face.
  let oneLineLabelWidth: number | undefined;
  const uncutLabelWidth = (): number => oneLineLabelWidth ??= Math.ceil(Math.max(0, maxOf(rows.map((row) => {
    const cell = row.cells[labelColumn!.id];
    if (row.role === 'section' || !cell?.displayed) return 0;
    const font = cellFont(cell);
    return measure(cell.displayed, font).width + affixRoom(row, font) + rowIndent(indentStep(cell)) + 2 * cellPadX;
  }))));
  /**
   * The head faces. A table of twenty columns or more shrank its
   * heads by column count, on a canvas wide enough for the regular face too.
   * The shrink is how a surface that cannot scroll fits its width, so the
   * heads keep the regular face unless it does not fit: a head wider than a
   * track the pass cannot widen, or tracks wider than the plot, which is the
   * test that starts the shrink below. The minimum the table reports is the
   * dense one, which it can still draw at.
   */
  const regular = trackWidths(regularFonts);
  // Dense heads change only tracking. An authored head face can make the two plans identical.
  const denseFonts = cols.length >= DENSE_COLUMNS ? tableFonts(theme, ladder, cols.length) : undefined;
  const dense = denseFonts === undefined ? undefined : denseFonts.header.letterSpacing === regularFonts.header.letterSpacing
    ? regular : trackWidths(denseFonts);
  const sizing = dense ?? regular;
  let reach = spacerTotal;
  for (let index = 0; index < cols.length; index++) {
    const col = cols[index]!;
    const width = sizing.widths[index] ?? 0;
    const minimum = sizing.minimumWidths[index] ?? width;
    reach += col.kind !== 'rowLabel' && col.kind !== 'text' ? wideTable ? Math.min(width, minimum) : width
      : Math.min(width, shrinkFloorWidth(col, wideTable, sizing.minimumWidths[index], sizing.labelFloor), col.kind === 'rowLabel' ? minimum : width);
  }
  const minimumW = Math.max(sumOf(sizing.minimumWidths), reach);
  const wrapMinimumWidth = dense === undefined && table.columnGroups.length === 0 && regular.chipFloor === 0
    ? cols.reduce((sum, _col, index) => sum + (regular.wrapFloors[index] ?? regular.minimumWidths[index]!), spacerTotal)
    : undefined;
  const regularHeadsFit = dense === undefined || headsFit(
    cols, table.columnGroups, (id) => regular.widths[columnIndex.get(id)!] ?? 0, figures,
    regular.context, headingFaces(regularFonts), groupCell,
  );
  const columnIds = cols.map(col => col.id);
  const indices = cols.map((_col, index) => index);
  const labelIndices = indices.filter(index => cols[index]!.kind === 'rowLabel' && (!view.scroll || cols[index]!.width === undefined));
  const textIndices = view.scroll ? [] : indices.filter(index => cols[index]!.kind === 'text');
  const compactIndices = view.scroll ? [] : indices.filter(index => cols[index]!.kind !== 'rowLabel' && cols[index]!.kind !== 'text');
  const growingIndices = indices.filter(index => {
    const col = cols[index]!;
    return col.width === undefined && (col.kind === 'value' || col.kind === 'computed') && (figures || !heatColumn(col));
  });
  return { cols, columnIds, columnIndex, indices, labelIndices, textIndices, compactIndices, growingIndices, rows, widthRows, spacerBefore, spacerTotal, figures, wideTable, cellPadX, labelColumn, labelLead, groupCell, headingFaces, regularFonts, cellStep, indentStep, childCount, indents, operatorSlot, rowIndent, cellFont, affixRoom, columnHeaderText, chipSpan, sumOf, hasChanges, uncutLabelWidth, regular, dense, minimumW, wrapMinimumWidth, regularHeadsFit };
}

const measuredTables = new WeakMap<ResolvedTable, Map<string, ReturnType<typeof measureTableTracks>>>();
const measureIds = new WeakMap<object, number>();
let nextMeasureId = 0;
const measureId = (fn: object | undefined): number | undefined => {
  if (fn === undefined) return undefined;
  let id = measureIds.get(fn);
  if (id === undefined) measureIds.set(fn, id = nextMeasureId++);
  return id;
};

/** Only text and spacing values read by the width pass. Table paints never invalidate measurements. */
function measurementTheme(theme: Theme) {
  const table = theme.table;
  return [theme.type, table?.head && [table.head.size, table.head.weight, table.head.tracking, table.head.case],
    table?.section && [table.section.size, table.section.weight, table.section.tracking, table.section.case],
    table?.fixedType, table?.rows !== undefined, table?.weights, table?.driver?.italic, table?.qualifier, table?.operator?.width];
}

function prepareWidthTypography(table: ResolvedTable, theme: Theme, options: WidthOptions,
  cols: readonly ResolvedColumn[], rows: readonly ResolvedRow[], widthRows: readonly ResolvedRow[]) {
  const ladder = levelLadder(theme, options.density ?? 'regular', options.target, textScaleOf(options));
  const regularFonts = tableFonts(theme, ladder);
  const rowById = new Map([...widthRows, ...rows].map(row => [row.id, row]));
  const colById = new Map(cols.map(col => [col.id, col]));
  const hasChanges = new Set(table.rows.filter(row => visibleInlineRows(row, options.inlineVisibility).length > 0).map(row => row.id));
  const cellStep = (cell: ResolvedCell) => rowById.get(cell.rowId)?.step ?? cell.level;
  /** The rung a label indents at: a memo row may indent with its parent (`ResolvedRow.indentStep`). */
  const indentStep = (cell: ResolvedCell) => rowById.get(cell.rowId)?.indentStep ?? cellStep(cell);
  const childCount = treeChildCounts(table);
  const inlineFont = (level: number, signed: boolean) => ladderInlineFont(theme, ladder, level, signed);
  const cellIndex = new Map<ResolvedCell, number>();
  const cellFonts: FontSpec[] = [];
  function makeCellFont(cell: ResolvedCell): FontSpec {
    const row = rowById.get(cell.rowId);
    const kind = row?.kind;
    const totalFace = kind === undefined || (kind !== 'subtotal' && kind !== 'result' && kind !== 'driver' &&
      ((kind !== 'member' && kind !== 'measure') || theme.table?.weights?.figures?.[kind] === undefined));
    if (cell.role === 'total' && cell.kind !== 'rowLabel' && totalFace) return regularFonts.totalValue;
    const font = kindFont(ladderRowFont(theme, ladder, regularFonts, cell.role, cellStep(cell), row?.hasChildren === true, hasChanges.has(cell.rowId)), kind, cell.kind === 'rowLabel', theme);
    return cell.state === 'value' ? strongColumnFont(font, colById.get(cell.colId), cell, kind, theme) : font;
  }
  for (const row of rowById.values()) for (const col of cols) {
    const cell = row.cells[col.id];
    if (cell === undefined || cellIndex.has(cell)) continue;
    cellIndex.set(cell, cellFonts.length);
    cellFonts.push(makeCellFont(cell));
  }
  function cellFont(cell: ResolvedCell): FontSpec {
    const index = cellIndex.get(cell);
    return index === undefined ? makeCellFont(cell) : cellFonts[index]!;
  }
  const bodyWidths: BodyWidthMeasurements = {
    columnIndex: new Map(cols.map((col, index) => [col.id, index])),
    columns: cols.map(() => []),
  };
  return { ladder, regularFonts, cellStep, indentStep, childCount, cellFont, inlineFont, hasChanges, bodyWidths };
}

const measuredBodies = new WeakMap<ResolvedTable, Map<string, ReturnType<typeof prepareWidthTypography>>>();

/** Padding, head wrapping and frame width share the same immutable row/font measurements. */
function measuredTypography(table: ResolvedTable, theme: Theme, measure: TextMeasurer, options: WidthOptions, view: TableWidthView,
  cols: readonly ResolvedColumn[], rows: readonly ResolvedRow[], widthRows: readonly ResolvedRow[]) {
  const key = JSON.stringify([measurementTheme(theme), measureId(measure), measureId(view.slack),
    // Ordinary densities change row air only. Cohort densities also change the measured type.
    isCohortDensity(options.density ?? 'regular') ? options.density : undefined,
    options.target, textScaleOf(options), options.inlineVisibility, cols.map(col => col.id), rows.map(row => row.id), widthRows.map(row => row.id)]);
  let variants = measuredBodies.get(table);
  if (!variants) measuredBodies.set(table, variants = new Map());
  let measured = variants.get(key);
  if (!measured) {
    if (variants.size >= 64) variants.delete(variants.keys().next().value!);
    variants.set(key, measured = prepareWidthTypography(table, theme, options, cols, rows, widthRows));
  }
  return measured;
}

/** Resolved tables are private immutable models; all frame-dependent typography enters by value. */
function measuredTable(table: ResolvedTable, theme: Theme, measure: TextMeasurer, options: WidthOptions, view: TableWidthView) {
  const ids = (entries: readonly { id: Id }[] | undefined) => entries?.map(entry => entry.id);
  const key = JSON.stringify([
    measurementTheme(theme), measureId(measure), measureId(view.slack),
    isCohortDensity(options.density ?? 'regular') ? options.density : undefined, options.target, textScaleOf(options), options.cellPadX, options.labelIndent,
    options.outlineMarks, options.figures, options.inlineVisibility, options.rowLabelLines, options[LABEL_WRAP_FLOOR],
    ids(view.columns), ids(view.rows), ids(view.widthRows), ids(view.fullRows), ids(view.allColumns),
    view.spacerTotal, view.scroll, view.headLines, view.headGlue, view.withMarks, view.trailingTracking,
    view.sortable && [...view.sortable], view.groupStart && [...view.groupStart], view.groupEnd && [...view.groupEnd], view.leadWidth, view.labelKeep,
  ]);
  let variants = measuredTables.get(table);
  if (!variants) measuredTables.set(table, variants = new Map());
  let measured = variants.get(key);
  if (!measured) {
    // shortcut: retain 64 typography/spacing variants per resolved table; another variant replaces the oldest.
    if (variants.size >= 64) variants.delete(variants.keys().next().value!);
    variants.set(key, measured = measureTableTracks(table, theme, measure, options, view));
  }
  return measured;
}

/**
 * One exact typography/padding/head rung. The SVG executor supplies explicit padding and drawn heads.
 * General calls keep the headless, automatic-padding and scrolling policies in tableWidths.
 */
export function prepareTableWidthRung(table: ResolvedTable, theme: Theme, measure: TextMeasurer, options: WidthOptions, view: TableWidthView) {
  return { table, theme, measure, options, view, measured: measuredTable(table, theme, measure, options, view) };
}

export type TableWidthRung = ReturnType<typeof prepareTableWidthRung>;

/**
 * Solve one prepared rung at another frame width. Only frame size/metadata may change in options;
 * new typography, padding or head/view policy requires another rung.
 */
export function solveTableWidthRung(rung: TableWidthRung, available: number, options: WidthOptions = rung.options, probe?: TableWidthProbe) {
  const { table, theme, measure, view } = rung;
  const { cols, columnIds, columnIndex, indices, labelIndices, textIndices, compactIndices, growingIndices, widthRows, spacerBefore, spacerTotal, figures, wideTable, cellPadX, labelColumn, labelLead, groupCell, headingFaces, regularFonts, cellStep, indentStep, childCount, indents, operatorSlot, rowIndent, cellFont, columnHeaderText, chipSpan, sumOf, hasChanges, uncutLabelWidth, regular, dense, minimumW, wrapMinimumWidth, regularHeadsFit } = rung.measured;
  const warnings: LintWarning[] = [];
  const denseHeads = dense !== undefined && (!regularHeadsFit || (!view.scroll && sumOf(regular.widths) > available));
  const chosen = denseHeads ? dense : regular;
  const fonts = chosen.context.fonts;
  // Only this solve owns mutable track storage. All measured inputs remain unchanged.
  const widths = chosen.widths.slice();
  const minimumWidths = chosen.minimumWidths;
  const sizingMinimums = (dense ?? regular).minimumWidths;
  // An authored frame lets wrapped prose use spare room up to its one-line width. Containers start at the wrap floor.
  if (view.scroll && view.fit === undefined && Number.isFinite(available) && chosen.wrappedOneLines.length > 0) {
    const want = chosen.wrappedOneLines.reduce((sum, entry) => sum + Math.max(0, entry.width - widths[entry.index]!), 0);
    const share = Math.max(0, Math.min(want, available - sumOf(widths)));
    if (share > 0) for (const { index, width: oneLine } of chosen.wrappedOneLines) {
      const natural = widths[index]!;
      widths[index] = Math.floor(natural + share * Math.max(0, oneLine - natural) / want);
    }
  }

  // Flex columns absorb only a width deficit. Canvas slack remains trailing
  // margin outside the grid; authored column.width is the sole grow control.
  const totalW = sumOf(widths);
  // Keep the existing refusal floor. The natural width reports the tracks before fitting,
  // on both surfaces; the warning offers that width when a fixed frame narrows them.
  // Explicit padding keeps the current frame and disables the automatic dense-padding fallback.
  // Keep the layout's subtraction order at fractional width boundaries.
  if (probe && !view.scroll && options.cellPadX !== undefined && cellPadX === probe.footerInset
    && probe.canvasWidth < probe.canvasWidth - available + minimumW) {
    return { widthMiss: true as const, minimumW, totalW, cellPadX };
  }
  if (totalW > available && labelIndices.length + textIndices.length > 0) {
    // Shrink priority: prose (text) columns absorb the deficit first —
    // they truncate gracefully; entity names (rowLabel) are cut only when
    // prose has hit its floor. A truncated country name next to slack
    // prose reads as a layout fault.
    let deficit = totalW - available;
    const beforeShrink = widths.slice();
    const floorOf = (index: number) => view.scroll ? chosen.labelFloor : shrinkFloorWidth(cols[index]!, wideTable, minimumWidths[index], chosen.labelFloor);
    // The hint room in the label track is optional and goes first: the hint is then cut or
    // left out, and no other column shrinks for it.
    for (const index of labelIndices) {
      const take = Math.min(deficit, Math.max(0, widths[index]! - Math.max(minimumWidths[index]!, view.scroll ? view.labelKeep ?? 0 : 0)));
      if (take > 0) {
        widths[index] = widths[index]! - take;
        deficit -= take;
      }
    }
    for (const kind of ['text', 'rowLabel'] as const) {
      if (deficit <= 0) break;
      const tier = kind === 'text' ? textIndices : labelIndices;
      const shrinkable = tier
        .map((index) => ({
          index,
          room: Math.max(0, widths[index]! - floorOf(index)),
        }))
        .filter((f) => f.room > 0);
      const totalRoom = shrinkable.reduce((a, f) => a + f.room, 0);
      if (totalRoom <= 0) continue;
      const take = Math.min(deficit, totalRoom);
      for (const f of shrinkable) {
        const cut = (take * f.room) / totalRoom;
        widths[f.index] = Math.round(widths[f.index]! - cut);
      }
      deficit -= take;
    }
    // Each cut above is rounded, so tracks that cover the deficit in exact arithmetic can end a
    // pixel or more over the plot. The columns with the most room give that pixel back.
    if (deficit <= 0) {
      const flex = indices.filter(index => labelIndices.includes(index) || textIndices.includes(index));
      for (let over = Math.ceil(sumOf(widths) - available); over > 0; over--) {
        const roomOf = (index: number) => widths[index]! - floorOf(index);
        const widest = flex.reduce<number | undefined>((best, index) => best === undefined || roomOf(index) > roomOf(best) ? index : best, undefined);
        if (widest === undefined || roomOf(widest) < 1) break;
        widths[widest] = widths[widest]! - 1;
      }
    }
    let remaining = Math.ceil(sumOf(widths) - available);
    if (remaining > 0 && wideTable) {
      const compactable = compactIndices;
      // A pixel from each column per round. Equal rounds go together, so the passes follow the
      // column count and not an authored width.
      while (remaining > 0) {
        const open = compactable.filter((index) => widths[index]! > minimumWidths[index]!);
        if (open.length === 0) break;
        const rounds = Math.max(1, Math.min(Math.floor(remaining / open.length), ...open.map((index) => Math.ceil(widths[index]! - minimumWidths[index]!))));
        for (const index of open) {
          if (remaining <= 0) break;
          widths[index] = widths[index]! - rounds;
          remaining -= rounds;
        }
      }
    }
    // A text column the shrink cut while another keeps width above what prints it uncut takes that
    // width: the cut column is the one that loses text, and the slack column only wraps more.
    const printsUncut = (col: ResolvedColumn) => col.wrap ? minimumWidths[columnIndex.get(col.id)!]!
      : intrinsicColumnWidth(col, widthRows, { ...chosen.context, hint: undefined, labelLines: 2 });
    const flexText = textIndices.map(index => cols[index]!).filter(col => col.width === undefined);
    // Only a column the shrink cut can want width, and the uncut width of the others is measured
    // only when one does: the two-line measure costs a cell-by-cell pass over each text column.
    const gapOf = (col: ResolvedColumn) => ({ id: col.id, gap: printsUncut(col) - widths[columnIndex.get(col.id)!]! });
    const cutGaps = flexText.filter((col) => widths[columnIndex.get(col.id)!]! < beforeShrink[columnIndex.get(col.id)!]!).map(gapOf);
    const wants = cutGaps.filter((entry) => entry.gap > 0);
    const gaps = wants.length === 0 ? [] : flexText.map((col) => cutGaps.find((entry) => entry.id === col.id) ?? gapOf(col));
    const wanted = wants.reduce((sum, entry) => sum + entry.gap, 0);
    // A donor gives at most the width it keeps above its uncut text, and no group heading it sits
    // under gives up the room its heading needs: the later group pass cannot restore that room
    // when the frame is full.
    const groupFaces = headingFaces(fonts);
    const spare = new Map(table.columnGroups.filter((group) => group.heading !== false).map((group) => [group.id,
      cols.filter((col) => group.columnIds.includes(col.id)).reduce((sum, col) => sum + widths[columnIndex.get(col.id)!]!, 0)
        - groupHeadingNeed(group, groupFaces, measure, groupCell)]));
    const donors = gaps.filter((entry) => entry.gap < 0).map((entry) => ({
      id: entry.id,
      slack: Math.floor(-entry.gap),
      groups: table.columnGroups.filter((group) => spare.has(group.id) && group.columnIds.includes(entry.id)),
    }));
    const roomOf = (donor: (typeof donors)[number]) => Math.max(0, Math.min(donor.slack, ...donor.groups.map((group) => spare.get(group.id)!)));
    const rooms = donors.map(roomOf);
    const given = rooms.reduce((sum, room) => sum + room, 0);
    const move = Math.floor(Math.min(wanted, given));
    let moved = 0;
    const cut = (donor: (typeof donors)[number], amount: number) => {
      const take = Math.min(amount, roomOf(donor));
      widths[columnIndex.get(donor.id)!] = widths[columnIndex.get(donor.id)!]! - take;
      donor.slack -= take;
      for (const group of donor.groups) spare.set(group.id, spare.get(group.id)! - take);
      moved += take;
    };
    if (move > 0) {
      donors.forEach((donor, index) => cut(donor, Math.floor(move * rooms[index]! / given)));
      for (let progress = true; progress && moved < move;) {
        progress = false;
        for (const donor of donors) if (moved < move && roomOf(donor) > 0) { cut(donor, 1); progress = true; }
      }
      let toTake = moved;
      for (const [index, entry] of wants.entries()) {
        const add = index === wants.length - 1 ? toTake : Math.min(toTake, Math.floor(moved * entry.gap / wanted));
        widths[columnIndex.get(entry.id)!] = widths[columnIndex.get(entry.id)!]! + add;
        toTake -= add;
      }
    }
    // A shrink never takes a section chip past the table's end: a frame without room for it
    // overflows and says so below.
    if (labelColumn !== undefined && chipSpan(widths) < chosen.chipFloor) {
      widths[columnIndex.get(labelColumn.id)!] = widths[columnIndex.get(labelColumn.id)!]! + chosen.chipFloor - chipSpan(widths);
    }
  }
  const narrowed = cols.some(col => col.width !== undefined && (figures || !heatColumn(col)) && widths[columnIndex.get(col.id)!]! < col.width);
  if (narrowed || sumOf(widths) > (view.scrollBox?.width ?? available)) {
    // A wider frame can cross a margin breakpoint. Resolve its margins again so the fix fits.
    const margin = resolveCanvasOptions(options).margin;
    let frameWidth = Math.ceil(totalW + (view.scrollBox?.inset ?? 0));
    if (view.scrollBox === undefined) for (let pass = 0; pass < 4; pass++) {
      const sides = { ...canvasMargin(theme, frameWidth), ...margin };
      const next = Math.ceil(totalW + sides.left + sides.right);
      if (next === frameWidth) break;
      frameWidth = next;
    }
    const size = options.size === undefined ? undefined : resolveSize(options.size);
    const heightOpen = (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height === false
      || (typeof options.size === 'object' && options.size.height === undefined);
    const height = heightOpen ? undefined : size?.height;
    warnings.push({ code: 'table-overflow', severity: 'warn',
      message: narrowed ? `authored column widths were narrowed to fit the frame; use a frame at least ${frameWidth} px wide to keep them`
        : `table wider than the plot area; use a frame at least ${frameWidth} px wide to show all columns`,
      field: ['options', 'size'], detail: { naturalWidth: frameWidth },
      suggest: `Set the frame width to ${frameWidth} px or more.`,
      fix: [{ op: 'add', path: '/options/size', value: { width: frameWidth, ...(height === undefined ? {} : { height }) } }],
    });
  }
  // An authored width that cuts its head (a "WEEK / 1" wrap) takes free frame
  // width first, up to what its content needs, before the frame stays bare
  // beside it. A frame without room keeps the authored width and its warning.
  const grownFrom: (number | undefined)[] = [];
  const grow = (id: Id, add: number) => {
    const index = columnIndex.get(id)!;
    if (grownFrom[index] === undefined) grownFrom[index] = widths[index]!;
    widths[index] = widths[index]! + add;
  };
  let room = Number.isFinite(available) ? Math.floor(available - sumOf(widths)) : Infinity;
  if (Number.isFinite(available) && options.frameFill !== 'none') {
    for (const col of cols) {
      if (room < 1) break;
      if (col.width === undefined || (col.kind !== 'value' && col.kind !== 'computed') || (!figures && heatColumn(col))) continue;
      const add = Math.min(room, Math.ceil(minimumWidths[columnIndex.get(col.id)!]! - widths[columnIndex.get(col.id)!]!));
      if (add < 1) continue;
      grow(col.id, add);
      room -= add;
    }
  }
  // A group heading over members that all keep authored widths takes free
  // width on its last member. Without room it runs past its block, and says so.
  for (const [id, short] of groupHeadingFloors(table.columnGroups, columnIds, (member) => widths[columnIndex.get(member)!] ?? 0, () => false, headingFaces(fonts), measure, groupCell)) {
    const add = options.frameFill === 'none' ? 0 : Math.max(0, Math.min(room, Math.ceil(short)));
    if (add >= 1) { grow(id, add); room -= add; }
    const group = table.columnGroups.find((candidate) => candidate.columnIds.includes(id))!;
    // The SVG wraps a heading inside its block; only one it cannot wrap runs past.
    const wraps = () => !view.scroll && groupHeadingWrap(group, headingFaces(fonts), measure,
      cols.filter((col) => group.columnIds.includes(col.id)).reduce((sum, col) => sum + widths[columnIndex.get(col.id)!]!, 0)
        - 2 * cellPadX - (groupCell.startRule?.(group.id) ?? 0)) !== undefined;
    if (short - add > 0.5 && !wraps()) {
      warnings.push({ code: 'table-group-heading-overflow', severity: 'warn',
        message: `column group '${group.id}' heading needs ${Math.ceil(short - add)} px more than its columns' authored widths; it runs past the block`,
        suggest: 'Shorten the heading or its note, widen a column of the group, or give the table a wider frame.' });
    }
  }
  for (const col of cols) if (figures || !heatColumn(col)) {
    // A head that took free width is not cut: only a figure the authored width could not hold still warns.
    const grown = grownFrom[columnIndex.get(col.id)!];
    // A label cut is measured as the labels wrap, not on one line; labels that fit on one line are not cut.
    const track = grown ?? widths[columnIndex.get(col.id)!]!;
    const minimum = col.kind === 'rowLabel' && col.width !== undefined && minimumWidths[columnIndex.get(col.id)!]! > track
      ? intrinsicColumnWidth(col, widthRows, { ...chosen.context, labelLines: options.rowLabelLines ?? 2 }) : minimumWidths[columnIndex.get(col.id)!]!;
    const found = authoredWidthWarnings(col, table.columns.findIndex(authored => authored.id === col.id), track, minimum, chosen.context);
    warnings.push(...(grown === undefined ? found : found.filter(warning => warning.code === 'table-column-widened'
      || widths[columnIndex.get(col.id)!]! < minimumWidths[columnIndex.get(col.id)!]!)));
  }

  // The last track takes the room the others left. A board of
  // authored widths inside a wider frame stops short of the frame edge, and
  // that gap is bare canvas beside a banded block and under every rule.
  // Under `rowExtent: 'frame'` the rows reach the edge on their own and the
  // room stays theirs, as the grid's empty track takes it: the
  // last column keeps its width on both surfaces.
  const rowToFrame = (options.rowExtent ?? 'frame') === 'frame';
  if (Number.isFinite(available) && options.lastTrackFlex === true && !rowToFrame && cols.length > 0) {
    const slack = available - sumOf(widths);
    const lastCol = cols[cols.length - 1]!;
    if (slack > 0 && lastCol.width === undefined) widths[columnIndex.get(lastCol.id)!] = widths[columnIndex.get(lastCol.id)!]! + slack;
  }

  const beforeFill = widths.slice();
  // Frame fill caps value-track growth. The label track takes the rest.
  // `frameFill: 'none'` keeps the 0.27 look: the columns keep their widths and an empty stretch carries the rows to the edge.
  if (Number.isFinite(available) && rowToFrame && options.frameFill !== 'none') {
    const extras = frameFillAmounts(growingIndices.map(index => widths[index]!), available - sumOf(widths), options.maxGrowth);
    for (let item = 0; item < extras.values.length; item++) {
      const index = growingIndices[item]!;
      widths[index] = widths[index]! + extras.values[item]!;
    }
    // An authored maxWidth caps the whole label track, frame fill included.
    if (labelColumn !== undefined && labelColumn.width === undefined && extras.remainder > 0) {
      const index = columnIndex.get(labelColumn.id)!;
      const extra = labelColumn.maxWidth === undefined ? extras.remainder
        : Math.max(0, Math.min(extras.remainder, labelColumn.maxWidth - widths[index]!));
      widths[index] = widths[index]! + extra;
    }
  }

  // Never cut a name while the frame has free width: a
  // label track too narrow for its longest name and unit takes the room
  // outside the table first, then the value tracks' frame growth, back down
  // to their own widths. An authored width or a hard maxWidth stays.
  let labelNeed: number | undefined;
  if (labelColumn !== undefined && labelColumn.width === undefined) {
    const labelId = labelColumn.id;
    const need = view.scroll ? intrinsicColumnWidth({ ...labelColumn, maxWidth: undefined, maxTextWidth: undefined }, widthRows,
      { ...chosen.context, hint: undefined }) + labelLead : uncutLabelWidth();
    const cap = labelColumn.maxWidth !== undefined && options[SOFT_LABEL_CAP] !== true ? labelColumn.maxWidth : Infinity;
    labelNeed = Math.min(need, cap);
    let short = labelNeed - widths[columnIndex.get(labelId)!]!;
    if (short > 0) {
      const outside = Number.isFinite(available) ? Math.min(short, Math.max(0, Math.floor(available - sumOf(widths)))) : 0;
      widths[columnIndex.get(labelId)!] = widths[columnIndex.get(labelId)!]! + outside;
      short -= outside;
      const grown = cols.filter((col) => col.id !== labelId && widths[columnIndex.get(col.id)!]! > beforeFill[columnIndex.get(col.id)!]!);
      const total = grown.reduce((sum, col) => sum + widths[columnIndex.get(col.id)!]! - beforeFill[columnIndex.get(col.id)!]!, 0);
      const take = Math.min(short, Math.floor(total));
      let left = take;
      for (const [index, col] of grown.entries()) {
        const extra = widths[columnIndex.get(col.id)!]! - beforeFill[columnIndex.get(col.id)!]!;
        const back = index === grown.length - 1 ? Math.min(left, Math.floor(extra)) : Math.min(left, Math.floor((take * extra) / total));
        widths[columnIndex.get(col.id)!] = widths[columnIndex.get(col.id)!]! - back;
        left -= back;
      }
      widths[columnIndex.get(labelId)!] = widths[columnIndex.get(labelId)!]! + take - left;
    }
  }

  const tracks = columnTracks((view.allColumns ?? cols).map(col => ({ id: col.id, natural: widths[columnIndex.get(col.id)!] ?? 0 })), {
    fit: !rowToFrame ? view.fit : 'content',
    available: Number.isFinite(available) && (!view.scroll || view.fit !== undefined) ? Math.max(0, available - spacerTotal) : undefined,
    anchorId: (view.allColumns ?? cols)[0]?.id,
    hidden: view.allColumns === undefined ? undefined : new Set(view.allColumns.filter(col => !columnIndex.has(col.id)).map(col => col.id)),
    fixed: new Set(cols.filter(col => col.width !== undefined || (!figures && heatColumn(col))).map(col => col.id)),
    ...(options.maxGrowth === false ? {} : { maxGrowth: options.maxGrowth ?? DEFAULT_TRACK_GROWTH }),
  });
  const labelsWrap = labelColumn !== undefined && labelNeed !== undefined && widths[columnIndex.get(labelColumn.id)!]! < labelNeed;
  const gridTracks = tracks.flatMap((track, index) => {
    const spacer = spacerBefore.get(track.id);
    const drawn = index === 0 && (view.frameStart ?? 0) > 0 ? { ...track, width: track.width + view.frameStart! } : track;
    return spacer === undefined ? [drawn] : [{ id: `bp-spacer:${track.id}`, natural: spacer, width: spacer }, drawn];
  });
  const labelBeforeFill = labelColumn === undefined ? undefined : beforeFill[columnIndex.get(labelColumn.id)!];
  return { tracks, gridTracks, spacerBefore, spacerTotal, labelNeed, labelBeforeFill, labelsWrap, columnIndex, widths, minimumWidths, sizingMinimums, totalW, minimumW, fonts, regularFonts,
    context: chosen.context.theme === theme ? chosen.context : { ...chosen.context, theme }, wouldWrap: (dense ?? regular).wouldWrap, wrapMinimumWidth, warnings, cellPadX,
    rowIndent, cellFont, cellStep, indentStep, columnHeaderText, indents, operatorSlot, childCount, hasChanges };
}

/** Public callers retain ordered Maps; discarded numeric candidates never allocate them. */
export function materializeTableWidthPlan(plan: TableWidthRungPlan) {
  const { columnIndex, ...rest } = plan;
  const map = (values: readonly number[]) => new Map([...columnIndex].map(([id, index]) => [id, values[index]!]));
  return { ...rest, widths: map(plan.widths), minimumWidths: map(plan.minimumWidths), sizingMinimums: map(plan.sizingMinimums) };
}

function tableWidthsOnce(table: ResolvedTable, theme: Theme, measure: TextMeasurer, options: WidthOptions = {}, view: TableWidthView = {}, probe?: TableWidthProbe) {
  const result = solveTableWidthRung(prepareTableWidthRung(table, theme, measure, options, view), view.available ?? Infinity, options, probe);
  return result.widthMiss === true ? result : materializeTableWidthPlan(result);
}

/**
 * How far a flexible column may shrink; a wrap column stops at its two-line floor. A label track
 * that grew past its authored width gives the growth back down to that width.
 */
function shrinkFloorWidth(col: ResolvedColumn, wideTable: boolean, minimumWidth: number | undefined, labelFloor = 0): number {
  if (col.kind === 'rowLabel') return Math.min(col.width ?? Infinity, Math.max(wideTable ? 180 : FLEX_MIN, labelFloor));
  if (col.kind === 'text' && col.wrap) return Math.max(FLEX_MIN, minimumWidth ?? FLEX_MIN);
  return FLEX_MIN;
}

/** The type floor for a table grid and its frame, independent of the renderer. */
export function tableDisplayFloor(table: ResolvedTable, theme: Theme, options: TableOptions, target: RenderTarget, width: number,
  frame: { title?: unknown; subtitle?: unknown; source?: unknown; footnotes: readonly unknown[] }): Pick<PresentationInfo, 'target' | 'minDisplayWidth'> {
  const ladder = levelLadder(theme, options.density ?? 'regular', target, textScaleOf(options));
  const fonts = tableFonts(theme, ladder);
  const floors = targetFloorsPx(target);
  let scale = 0.9;
  const include = (size: number, role: keyof typeof floors) => { scale = Math.max(scale, floors[role] / size); };
  if (frame.title) include(theme.type.title.size, 'title');
  if (frame.subtitle) include(theme.type.subtitle.size, 'subtitle');
  if (frame.source || frame.footnotes.length) include(footerType(theme.type.footnote, target, textScaleOf(options)).size, 'footnote');
  const includeHead = (size: number) => { scale = Math.max(scale, tableHeadFloorPx(target) / size); };
  if (options.columnHeads !== false) {
    if (table.columns.length) includeHead(fonts.header.size);
    if (table.columns.some(column => column.subLabel)) includeHead(fonts.sub.size);
    if (table.columnGroups.some(group => group.heading !== false)) includeHead(fonts.group.size);
  }
  for (const row of table.rows) {
    if (row.inline) continue;
    const hasChanges = visibleInlineRows(row, options.inlineVisibility).length > 0;
    include(ladderRowFont(theme, ladder, fonts, row.role, row.step, row.hasChildren, hasChanges).size, 'label');
    if (hasChanges) include(changeLineFont(theme, ladder, row.step).size, 'label');
    if (row.badge) include(fonts.chip.size, 'label');
    if (row.unitAffix) include(ladder.inlineSize(), 'label');
    for (const cell of Object.values(row.cells)) {
      if (cell.kind === 'status') include(fonts.chip.size, 'label');
      if (cell.note) include(ladder.inlineSize(), 'footnote');
    }
  }
  return { target: target, minDisplayWidth: width * scale };
}

/** HTML tables retain horizontal scrolling above the viewport floor. */
export function belowTableViewportFloor(authoredSize: TableOptions['size']): boolean {
  if (authoredSize === undefined) return false;
  const size = resolveSize(authoredSize);
  const sizing = resolveSizing(chartSizing('table'), size);
  // A width-only size leaves the height to the rows, as the SVG layout does,
  // so only an authored height is held to the floor.
  const heightAuthored = typeof authoredSize !== 'object' || authoredSize.height !== undefined;
  return !fitsSize({ width: size.width, height: heightAuthored ? size.height : Infinity }, sizing);
}


/** Compact only below the table's own floor, as for charts. */
export function tableFrameMode(options: TableOptions): 'full' | 'compact' {
  if (options.mode) return options.mode;
  if (options.size === undefined) return 'full';
  const size = resolveSize(options.size);
  const sizing = resolveSizing(chartSizing('table'), size);
  return !fitsSize(size, sizing) ? 'compact' : 'full';
}
