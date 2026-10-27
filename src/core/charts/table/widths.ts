/** One width pass for SVG, React, measurement and composed tables. */
import { resolveCanvasOptions, resolveSize } from '../../normalize/shared';
import { canvasMargin } from '../../theme';
import { chartSizing, fitsSize, resolveSizing } from '../../sizing';
import { twoLineWidth, type FontSpec, type TextMeasurer } from '../../text';
import type { Id } from '../../types/cell';
import type { LintWarning } from '../../types/scene';
import type { Theme } from '../../types/theme';
import type { ResolvedTable, ResolvedColumn, ResolvedRow, ResolvedCell, TableOptions } from '../../types/table';
import { levelLadder } from './ladder';
import { textScaleOf, tableHeadFloorPx } from '../../typeFloors';
import { targetFloorsPx, TARGET_SIZE, type TargetSizeOptions } from '../../target';
import { footerType } from '../../footer';
import type { RenderTarget } from '../../types/options';
import type { PresentationInfo } from '../../types/sizing';
import { columnHeadLabel, columnHeaderAffix } from './resolve';
import { visibleColumns, visibleRows, visibleInlineRows, treeChildCounts, heatColumn, printsFigures, cellDrawsTabular } from './view';
import { operatorWidth, qualifierFont } from './statement';
import { groupHeadingFaces, groupHeadingFloors } from './groupHeading';
import {
  DENSE_COLUMNS, LABEL_WRAP_FLOOR, SOFT_LABEL_CAP, INLINE_LABEL_INDENT, cellPadX as trackCellPadX,
  tableFonts, rowFont as ladderRowFont, kindFont, labelIndents, inlineFont as ladderInlineFont,
  changeLineFont, encodingReserve, intrinsicColumnWidth, authoredTrackWidth, authoredWidthWarnings,
  wrapFloorWidth, sectionChipFloor, collapsedHintWidth, headsFit, frameFillExtras,
  SORT_CHEVRON_RESERVE, DEFAULT_TRACK_GROWTH, headerContentWidth, columnTracks, type TableFonts, type WidthContext,
} from './tracks';
import { maxOf } from '../../arrays';

const FLEX_MIN = 80;
const HEAT_ONLY_CELL_W = 22;

interface TableWidthView {
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
}

type WidthOptions = TableOptions & { [LABEL_WRAP_FLOOR]?: boolean; [SOFT_LABEL_CAP]?: boolean };

/** One content width rule. Dense padding is a fallback only when normal padding cannot fit. */
export function tableWidths(table: ResolvedTable, theme: Theme, measure: TextMeasurer, options: WidthOptions = {}, view: TableWidthView = {}) {
  const regular = tableWidthsOnce(table, theme, measure, options, view);
  const count = (view.columns ?? visibleColumns(table)).length;
  const densePad = count >= 25 ? 3 : count >= DENSE_COLUMNS ? 5 : regular.cellPadX;
  if (options.cellPadX !== undefined || densePad >= regular.cellPadX || Math.max(regular.minimumW, regular.totalW) <= (view.available ?? Infinity)) return regular;
  const dense = tableWidthsOnce(table, theme, measure, { ...options, cellPadX: densePad }, view);
  const regularOverflow = regular.warnings.find(warning => warning.code === 'table-overflow');
  // The wider-size repair must also fit after normal padding returns.
  if (regularOverflow) dense.warnings = dense.warnings.map(warning => warning.code === 'table-overflow' ? regularOverflow : warning);
  return dense;
}

/** Content, authored widths, fitting and the width floor are resolved together. */
function tableWidthsOnce(table: ResolvedTable, theme: Theme, measure: TextMeasurer, options: WidthOptions = {}, view: TableWidthView = {}) {
  const cols = view.columns ?? visibleColumns(table);
  const rows = view.rows ?? visibleRows(table);
  const fullRows = view.fullRows ?? table.rows;
  const widthRows = view.widthRows ?? table.rows;
  const available = view.available ?? Infinity;
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
  const warnings: LintWarning[] = [];
  const ladder = levelLadder(theme, options.density ?? 'regular', options.target, textScaleOf(options));
  const regularFonts = tableFonts(theme, ladder);
  const rowById = new Map([...widthRows, ...rows].map(row => [row.id, row]));
  const hasChanges = new Set(table.rows.filter(row => visibleInlineRows(row, options.inlineVisibility).length > 0).map(row => row.id));
  const cellStep = (cell: ResolvedCell) => rowById.get(cell.rowId)?.step ?? cell.level;
  const childCount = treeChildCounts(table);
  const isTree = fullRows.some(row => row.hasChildren);
  const indents = labelIndents(cellPadX, options.labelIndent, view.withMarks ?? options.outlineMarks === true);
  const operatorSlot = operatorWidth(rows, theme);
  const rowIndent = (level: number) => (isTree ? indents.base + level * indents.step : 0) + operatorSlot;
  const inlineFont = (level: number, signed: boolean) => ladderInlineFont(theme, ladder, level, signed);
  function cellFont(cell: ResolvedCell): FontSpec {
    const row = rowById.get(cell.rowId);
    const kind = row?.kind;
    const totalFace = kind === undefined || (kind !== 'subtotal' && kind !== 'result' && kind !== 'driver' &&
      ((kind !== 'member' && kind !== 'measure') || theme.table?.weights?.figures?.[kind] === undefined));
    if (cell.role === 'total' && cell.kind !== 'rowLabel' && totalFace) return regularFonts.totalValue;
    return kindFont(ladderRowFont(theme, ladder, regularFonts, cell.role, cellStep(cell), row?.hasChildren === true, hasChanges.has(cell.rowId)), kind, cell.kind === 'rowLabel', theme);
  }
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
  const columnHeaderText = (col: (typeof cols)[number]) =>
    columnHeadLabel(col.label, theme) + columnHeaderAffix(col);
  /** The tracks every column takes at one set of head faces, and the cuts they report. */
  function trackWidths(faces: TableFonts) {
    const widths = new Map<Id, number>();
    const minimumWidths = new Map<Id, number>();
    const wrappedOneLines = new Map<Id, number>();
    const context: WidthContext = {
      theme, measure, fonts: faces, cellFont, inlineFont, changeFont: (level) => changeLineFont(theme, ladder, level), rowIndent, inlineIndent: INLINE_LABEL_INDENT, padX: cellPadX,
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
    for (const col of cols) {
      const heatOnlyWidth = Math.max(HEAT_ONLY_CELL_W, Math.ceil((view.scroll ? headerContentWidth(col, context)
        : measure(columnHeaderText(col), faces.header).width) + 2 * cellPadX));
      const intrinsicWidth = figures || !heatColumn(col)
        ? intrinsicColumnWidth(col, widthRows, context)
        : heatOnlyWidth;
      const endRule = col.width === undefined && (figures || !heatColumn(col)) && view.groupEnd?.has(col.id) ? 1 : 0;
      if (col.kind === 'encoding') {
        // An authored width is the track, as for any column that is not a value; without one the track fits its end value.
        const track = (authoredTrackWidth(col, widthRows, context) ?? intrinsicWidth) + endRule;
        widths.set(col.id, track);
        minimumWidths.set(col.id, track);
        continue;
      }
      const headerW = view.scroll ? headerContentWidth(col, context)
        : measure(columnHeaderText(col), faces.header).width + (context.headerReserve?.(col) ?? 0);
      // The collapsed hint is paid for at the natural width only: the floor a frame may squeeze the
      // label track to stays the label's, and a squeezed hint is cut instead.
      const minimumWidth = col.wrap ? wrapFloorWidth(col, widthRows, headerW, context)
        : col.kind === 'rowLabel' ? intrinsicColumnWidth(col, widthRows, { ...context, hint: undefined }) : intrinsicWidth;
      minimumWidths.set(col.id, minimumWidth);
      // A heat lane with its figures off takes the 22 px cell over an
      // authored width: that width was set for the figures it does not
      // print, and the triangle narrows only if its cells do.
      // A value or computed column never prints a cut number, so its authored
      // width is a floor there (`authoredTrackWidth`); a text column keeps it fixed.
      const wrapped = view.scroll && col.wrap && col.width === undefined && (figures || !heatColumn(col));
      // An authored label track grows to the labels as they wrap (`authoredTrackWidth`).
      // Labels that fit the authored width on one line skip the two-line measure.
      const authoredContext = col.kind === 'rowLabel' ? { ...context, twoLineLabels: options.rowLabelLines !== 1 } : context;
      const authored = col.kind === 'rowLabel' && col.width !== undefined && intrinsicWidth <= col.width ? col.width
        : authoredTrackWidth(col, widthRows, authoredContext);
      widths.set(col.id, figures || !heatColumn(col) ? authored ?? (wrapped ? minimumWidth : intrinsicWidth) : heatOnlyWidth);
      if (wrapped) wrappedOneLines.set(col.id, intrinsicWidth);
      const extra = (col.kind === 'rowLabel' ? labelLead : 0) + endRule;
      if (extra > 0) for (const target of [widths, minimumWidths]) target.set(col.id, target.get(col.id)! + extra);
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
        const floors = groupHeadingFloors(table.columnGroups, drawn, (id) => target.get(id) ?? 0, isFixed, groupFaces, measure, groupCell);
        for (const [id, extra] of floors) target.set(id, target.get(id)! + extra);
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
        if (span < floor) target.set(labelColumn.id, target.get(labelColumn.id)! + floor - span);
      }
    }
    // LABEL_WRAP_FLOOR: the label track holds every label whole on two lines, its unit and its inline
    // lines on their own lines, and every head word, over a hard maxWidth too.
    let labelFloor = options[LABEL_WRAP_FLOOR] === true && labelColumn !== undefined
      ? labelWrapFloor(labelColumn, faces) + labelLead : 0;
    if (labelFloor > 0) for (const target of [widths, minimumWidths]) target.set(labelColumn!.id, Math.max(target.get(labelColumn!.id)!, labelFloor));
    if (view.scroll && labelColumn?.width === undefined && labelColumn !== undefined) {
      labelFloor = Math.max(labelFloor, intrinsicColumnWidth(labelColumn, widthRows, {
        ...context, hint: undefined, twoLineLabels: options.rowLabelLines !== 1,
      }) + labelLead + (view.groupEnd?.has(labelColumn.id) ? 1 : 0));
    }
    // Prose columns that set the width with their one-line text, where
    // wrapping would take less: the size refusal names them.
    const wrapFloors = new Map<Id, number>();
    const wouldWrap = cols.filter((col) => {
      if (col.kind !== 'text' || col.wrap || col.width !== undefined) return false;
      const floor = wrapFloorWidth(col, widthRows, measure(columnHeaderText(col), faces.header).width, context);
      if (floor >= minimumWidths.get(col.id)!) return false;
      wrapFloors.set(col.id, floor);
      return true;
    });
    return { widths, minimumWidths, context, wouldWrap, wrapFloors, chipFloor, labelFloor, wrappedOneLines };
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
      const indent = rowIndent(cellStep(cell));
      text = Math.max(text, indent + (options.rowLabelLines === 1 ? measure(cell.displayed, font).width : twoLineWidth(cell.displayed, font, measure, true)));
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
  function chipSpan(target: Map<Id, number>): number {
    return cols.slice(cols.indexOf(labelColumn!)).reduce((sum, col) => sum + (target.get(col.id) ?? 0), 0);
  }
  /** What a set of tracks and the spacers between them take across the plot. */
  const sumOf = (map: Map<Id, number>): number => [...map.values()].reduce((a, b) => a + b, spacerTotal);
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
  const dense = cols.length >= DENSE_COLUMNS ? trackWidths(tableFonts(theme, ladder, cols.length)) : undefined;
  // A lower bound can rule wrapping out without another layout. These floors
  // include the longest word, header and padding. Keep unknown spans and dense
  // heads undecided; render retains the existing advice in those cases.
  const wrapMinimumWidth = dense === undefined && table.columnGroups.length === 0 && regular.chipFloor === 0
    ? cols.reduce((sum, col) => sum + (regular.wrapFloors.get(col.id) ?? regular.minimumWidths.get(col.id)!), spacerTotal)
    : undefined;
  const regularHeadsFit = dense === undefined || headsFit(
    cols, table.columnGroups, (id) => regular.widths.get(id) ?? 0, figures,
    regular.context, headingFaces(regularFonts), groupCell,
  );
  const denseHeads = dense !== undefined && (!regularHeadsFit || (!view.scroll && sumOf(regular.widths) > available));
  const chosen = denseHeads ? dense : regular;
  const fonts = chosen.context.fonts;
  const widths = chosen.widths;
  const minimumWidths = chosen.minimumWidths;
  const sizingMinimums = (dense ?? regular).minimumWidths;
  const sizingTracks = new Map((dense ?? regular).widths);
  // An authored frame lets wrapped prose use spare room up to its one-line width. Containers start at the wrap floor.
  if (view.scroll && view.fit === undefined && Number.isFinite(available) && chosen.wrappedOneLines.size > 0) {
    const want = [...chosen.wrappedOneLines].reduce((sum, [id, oneLine]) => sum + Math.max(0, oneLine - widths.get(id)!), 0);
    const share = Math.max(0, Math.min(want, available - sumOf(widths)));
    if (share > 0) for (const [id, oneLine] of chosen.wrappedOneLines) {
      const natural = widths.get(id)!;
      widths.set(id, Math.floor(natural + share * Math.max(0, oneLine - natural) / want));
    }
  }

  // Flex columns absorb only a width deficit. Canvas slack remains trailing
  // margin outside the grid; authored column.width is the sole grow control.
  const canShrink = (col: ResolvedColumn) => !view.scroll || (col.width === undefined && col.kind === 'rowLabel');
  const flexIds = cols.filter(c => canShrink(c) && (c.kind === 'rowLabel' || c.kind === 'text')).map(c => c.id);
  const totalW = sumOf(widths);
  // Keep the existing refusal floor. The natural width reports the tracks before fitting,
  // on both surfaces; the warning offers that width when a fixed frame narrows them.
  const floorFlexIds = cols.filter(col => col.kind === 'rowLabel' || col.kind === 'text').map(col => col.id);
  const minimumW = Math.max(sumOf(sizingMinimums), sumOf(shrinkReach(cols, floorFlexIds, wideTable, sizingTracks, sizingMinimums, (dense ?? regular).labelFloor)));
  if (totalW > available && flexIds.length > 0) {
    // Shrink priority: prose (text) columns absorb the deficit first —
    // they truncate gracefully; entity names (rowLabel) are cut only when
    // prose has hit its floor. A truncated country name next to slack
    // prose reads as a layout fault.
    let deficit = totalW - available;
    // The hint room in the label track is optional and goes first: the hint is then cut or
    // left out, and no other column shrinks for it.
    for (const col of cols.filter((c) => canShrink(c) && c.kind === 'rowLabel')) {
      const take = Math.min(deficit, Math.max(0, widths.get(col.id)! - minimumWidths.get(col.id)!));
      if (take > 0) {
        widths.set(col.id, widths.get(col.id)! - take);
        deficit -= take;
      }
    }
    for (const kind of ['text', 'rowLabel'] as const) {
      if (deficit <= 0) break;
      const tier = cols.filter((c) => canShrink(c) && c.kind === kind);
      const shrinkable = tier
        .map((col) => ({
          id: col.id,
          room: Math.max(0, widths.get(col.id)! - (view.scroll ? chosen.labelFloor : shrinkFloorWidth(col, wideTable, minimumWidths, chosen.labelFloor))),
        }))
        .filter((f) => f.room > 0);
      const totalRoom = shrinkable.reduce((a, f) => a + f.room, 0);
      if (totalRoom <= 0) continue;
      const take = Math.min(deficit, totalRoom);
      for (const f of shrinkable) {
        const cut = (take * f.room) / totalRoom;
        widths.set(f.id, Math.round(widths.get(f.id)! - cut));
      }
      deficit -= take;
    }
    let remaining = Math.ceil(sumOf(widths) - available);
    if (remaining > 0 && wideTable) {
      const compactable = cols
        .filter((col) => canShrink(col) && col.kind !== 'rowLabel' && col.kind !== 'text')
        .map((col) => col.id);
      while (remaining > 0) {
        let changed = false;
        for (const id of compactable) {
          if (remaining <= 0) break;
          const current = widths.get(id)!;
          const minimum = minimumWidths.get(id)!;
          if (current <= minimum) continue;
          widths.set(id, current - 1);
          remaining--;
          changed = true;
        }
        if (!changed) break;
      }
    }
    // A shrink never takes a section chip past the table's end: a frame without room for it
    // overflows and says so below.
    if (labelColumn !== undefined && chipSpan(widths) < chosen.chipFloor) {
      widths.set(labelColumn.id, widths.get(labelColumn.id)! + chosen.chipFloor - chipSpan(widths));
    }
  }
  const narrowed = cols.some(col => col.width !== undefined && (figures || !heatColumn(col)) && widths.get(col.id)! < col.width);
  if (narrowed || sumOf(widths) > available) {
    // A wider frame can cross a margin breakpoint. Resolve its margins again so the fix fits.
    const margin = resolveCanvasOptions(options).margin;
    let frameWidth = Math.ceil(totalW);
    for (let pass = 0; pass < 4; pass++) {
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
  const grownFrom = new Map<Id, number>();
  const grow = (id: Id, add: number) => {
    if (!grownFrom.has(id)) grownFrom.set(id, widths.get(id)!);
    widths.set(id, widths.get(id)! + add);
  };
  let room = Number.isFinite(available) ? Math.floor(available - sumOf(widths)) : Infinity;
  if (Number.isFinite(available) && options.frameFill !== 'none') {
    for (const col of cols) {
      if (room < 1) break;
      if (col.width === undefined || (col.kind !== 'value' && col.kind !== 'computed') || (!figures && heatColumn(col))) continue;
      const add = Math.min(room, Math.ceil(minimumWidths.get(col.id)! - widths.get(col.id)!));
      if (add < 1) continue;
      grow(col.id, add);
      room -= add;
    }
  }
  // A group heading over members that all keep authored widths takes free
  // width on its last member. Without room it runs past its block, and says so.
  for (const [id, short] of groupHeadingFloors(table.columnGroups, cols.map((col) => col.id), (member) => widths.get(member) ?? 0, () => false, headingFaces(fonts), measure, groupCell)) {
    const add = options.frameFill === 'none' ? 0 : Math.max(0, Math.min(room, Math.ceil(short)));
    if (add >= 1) { grow(id, add); room -= add; }
    if (short - add > 0.5) {
      const group = table.columnGroups.find((candidate) => candidate.columnIds.includes(id))!;
      warnings.push({ code: 'table-group-heading-overflow', severity: 'warn',
        message: `column group '${group.id}' heading needs ${Math.ceil(short - add)} px more than its columns' authored widths; it runs past the block`,
        suggest: 'Shorten the heading or its note, widen a column of the group, or give the table a wider frame.' });
    }
  }
  for (const col of cols) if (figures || !heatColumn(col)) {
    // A head that took free width is not cut: only a figure the authored width could not hold still warns.
    const grown = grownFrom.get(col.id);
    // A label cut is measured as the labels wrap, not on one line; labels that fit on one line are not cut.
    const track = grown ?? widths.get(col.id)!;
    const minimum = col.kind === 'rowLabel' && col.width !== undefined && minimumWidths.get(col.id)! > track
      ? intrinsicColumnWidth(col, widthRows, { ...chosen.context, twoLineLabels: options.rowLabelLines !== 1 }) : minimumWidths.get(col.id)!;
    const found = authoredWidthWarnings(col, table.columns.findIndex(authored => authored.id === col.id), track, minimum, chosen.context);
    warnings.push(...(grown === undefined ? found : found.filter(warning => warning.code === 'table-column-widened'
      || widths.get(col.id)! < minimumWidths.get(col.id)!)));
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
    if (slack > 0 && lastCol.width === undefined) widths.set(lastCol.id, widths.get(lastCol.id)! + slack);
  }

  const beforeFill = new Map(widths);
  // Frame fill caps value-track growth. The label track takes the rest.
  // `frameFill: 'none'` keeps the 0.27 look: the columns keep their widths and an empty stretch carries the rows to the edge.
  if (Number.isFinite(available) && rowToFrame && options.frameFill !== 'none') {
    const growing = cols.filter((col) => col.width === undefined && (col.kind === 'value' || col.kind === 'computed') && (figures || !heatColumn(col)));
    const extras = frameFillExtras(growing.map((col) => ({ id: col.id, width: widths.get(col.id)! })), available - sumOf(widths), options.maxGrowth,
      labelColumn?.width === undefined ? labelColumn?.id : undefined);
    // An authored maxWidth caps the whole label track, frame fill included.
    const labelCap = labelColumn?.maxWidth;
    if (labelColumn !== undefined && labelCap !== undefined && extras.has(labelColumn.id)) {
      extras.set(labelColumn.id, Math.max(0, Math.min(extras.get(labelColumn.id)!, labelCap - widths.get(labelColumn.id)!)));
    }
    for (const [id, extra] of extras) widths.set(id, widths.get(id)! + extra);
  }

  // Never cut a name while the frame has free width: a
  // label track too narrow for its longest name and unit takes the room
  // outside the table first, then the value tracks' frame growth, back down
  // to their own widths. An authored width or a hard maxWidth stays.
  let labelNeed: number | undefined;
  if (labelColumn !== undefined && labelColumn.width === undefined) {
    const labelId = labelColumn.id;
    const need = view.scroll ? intrinsicColumnWidth({ ...labelColumn, maxWidth: undefined, maxTextWidth: undefined }, widthRows,
      { ...chosen.context, hint: undefined }) + labelLead : Math.ceil(Math.max(0, maxOf(rows.map((row) => {
      const cell = row.cells[labelId];
      if (row.role === 'section' || !cell?.displayed) return 0;
      const font = cellFont(cell);
      return measure(cell.displayed, font).width + affixRoom(row, font) + rowIndent(cellStep(cell)) + 2 * cellPadX;
    }))));
    const cap = labelColumn.maxWidth !== undefined && options[SOFT_LABEL_CAP] !== true ? labelColumn.maxWidth : Infinity;
    labelNeed = Math.min(need, cap);
    let short = labelNeed - widths.get(labelId)!;
    if (short > 0) {
      const outside = Number.isFinite(available) ? Math.min(short, Math.max(0, Math.floor(available - sumOf(widths)))) : 0;
      widths.set(labelId, widths.get(labelId)! + outside);
      short -= outside;
      const grown = cols.filter((col) => col.id !== labelId && widths.get(col.id)! > beforeFill.get(col.id)!);
      const total = grown.reduce((sum, col) => sum + widths.get(col.id)! - beforeFill.get(col.id)!, 0);
      const take = Math.min(short, Math.floor(total));
      let left = take;
      for (const [index, col] of grown.entries()) {
        const extra = widths.get(col.id)! - beforeFill.get(col.id)!;
        const back = index === grown.length - 1 ? Math.min(left, Math.floor(extra)) : Math.min(left, Math.floor((take * extra) / total));
        widths.set(col.id, widths.get(col.id)! - back);
        left -= back;
      }
      widths.set(labelId, widths.get(labelId)! + take - left);
    }
  }

  const tracks = columnTracks((view.allColumns ?? cols).map(col => ({ id: col.id, natural: widths.get(col.id) ?? 0 })), {
    fit: !rowToFrame ? view.fit : 'content',
    available: Number.isFinite(available) && (!view.scroll || view.fit !== undefined) ? Math.max(0, available - spacerTotal) : undefined,
    anchorId: (view.allColumns ?? cols)[0]?.id,
    hidden: view.allColumns === undefined ? undefined : new Set(view.allColumns.filter(col => !widths.has(col.id)).map(col => col.id)),
    fixed: new Set(cols.filter(col => col.width !== undefined || (!figures && heatColumn(col))).map(col => col.id)),
    ...(options.maxGrowth === false ? {} : { maxGrowth: options.maxGrowth ?? DEFAULT_TRACK_GROWTH }),
  });
  const labelsWrap = labelColumn !== undefined && labelNeed !== undefined && widths.get(labelColumn.id)! < labelNeed;
  const gridTracks = tracks.flatMap((track, index) => {
    const spacer = spacerBefore.get(track.id);
    const drawn = index === 0 && (view.frameStart ?? 0) > 0 ? { ...track, width: track.width + view.frameStart! } : track;
    return spacer === undefined ? [drawn] : [{ id: `bp-spacer:${track.id}`, natural: spacer, width: spacer }, drawn];
  });
  return { tracks, gridTracks, spacerBefore, spacerTotal, labelNeed, labelsWrap, widths, minimumWidths, sizingMinimums, totalW, minimumW, fonts, regularFonts,
    context: chosen.context, wouldWrap: (dense ?? regular).wouldWrap, wrapMinimumWidth, warnings, cellPadX,
    rowIndent, cellFont, cellStep, columnHeaderText, indents, operatorSlot, childCount, hasChanges };
}

/**
 * How far a flexible column may shrink; a wrap column stops at its two-line floor. A label track
 * that grew past its authored width gives the growth back down to that width.
 */
function shrinkFloorWidth(col: ResolvedColumn, wideTable: boolean, minimumWidths: Map<Id, number>, labelFloor = 0): number {
  if (col.kind === 'rowLabel') return Math.min(col.width ?? Infinity, Math.max(wideTable ? 180 : FLEX_MIN, labelFloor));
  if (col.kind === 'text' && col.wrap) return Math.max(FLEX_MIN, minimumWidths.get(col.id) ?? FLEX_MIN);
  return FLEX_MIN;
}

/**
 * The narrowest tracks the width shrink reaches. A label or prose
 * column stops at its shrink floor, a label first at its minimum; the other
 * columns keep their width, except in a wide table, which compacts them to
 * their minimum. A minimum narrower than this is a frame the table overflows.
 */
function shrinkReach(
  cols: readonly ResolvedColumn[], flexIds: readonly Id[], wideTable: boolean,
  drawn: Map<Id, number>, minimumWidths: Map<Id, number>, labelFloor = 0,
): Map<Id, number> {
  return new Map(cols.map((col) => {
    const width = drawn.get(col.id) ?? 0;
    const minimum = minimumWidths.get(col.id) ?? width;
    if (!flexIds.includes(col.id)) return [col.id, wideTable ? Math.min(width, minimum) : width];
    const floor = shrinkFloorWidth(col, wideTable, minimumWidths, labelFloor);
    return [col.id, Math.min(width, floor, col.kind === 'rowLabel' ? minimum : width)];
  }));
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
  if (table.columns.length) includeHead(fonts.header.size);
  if (table.columns.some(column => column.subLabel)) includeHead(fonts.sub.size);
  if (table.columnGroups.some(group => group.heading !== false)) includeHead(fonts.group.size);
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
