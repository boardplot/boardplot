import { chartString } from '../../strings/status';
import { chartTheme } from '../chartEnv';
import { labelOn as chartLabelOn } from '../labelOn';
import { separationStroke } from '../../markVisibility';
import { structureCount } from '../../structureCounts';
import { cellMeta, cellValue, isPctCell } from '../../types/cell';
import { formatNonzeroWithSpec, formatterFromExample, seriesRasterFormatter } from '../../formatSpec';
/**
 * Categorical status matrix. Rows and columns preserve authored order; every
 * binding emits a cell mark, including sparse bindings and unknown states,
 * which fail closed to the visible `none` treatment.
 */

import { sweepHide } from '../../collide';
import { frameTextOptions, legendRequired, normalizeLegendOption, solveFrame, type FrameInput, type LegendItemInput, authoredFootnoteCount } from '../../frame';
import type { Rect } from '../../geometry';
import { linePath } from '../../svgPath';
import { labelsToNodes } from '../../label/emit';
import { createOccupiedIndex } from '../../label/occupied';
import { labelCtx, PRIORITY, solveLabels, type LabelRequest, type SolveCtx } from '../../label/solver';
import { accessibleTitle,
  NormalizeError,
  resolveHighlight,
  resolveSize,
} from '../../normalize/shared';
import { defaultMeasurer, type FontSpec } from '../../text';
import { strokeToken, canvasMargin, colorblindPaint, hatchGroundPaint, markRolePaint, paintColor, panelTypeClass, resolveSemanticPaletteTheme, semanticPalettePaint } from '../../theme';
import type { ColorRole, Id, OwnerRef } from '../../types/cell';
import type { BaseOptionsFor, LabelKind, LegendOptions } from '../../types/options';
import type { Geometry, LintWarning, Paint, SceneNode } from '../../types/scene';
import type { Theme } from '../../types/theme';
import { rowDrivenHeight } from '../../rowCanvas';
import { rowLabelBand } from '../../label/rowLabels';
import { fittedLabel, gutterBudget, stepDownFont } from '../../label/rowFit';
import { heightOmitted, matrixWidths, rowSizing } from '../../sizing';
import { TARGET_SIZE, type TargetSizeOptions } from '../../target';
import { textScaleOf } from '../../typeFloors';
import { maxOf, pushAll } from '../../arrays';
import { headInk as tableHeadInk, plainInk } from '../table/headFace';

export interface StatusRow {
  id: Id;
  label?: string;
}

export interface StatusColumn {
  id: Id;
  label?: string;
}

export interface StatusCell {
  row: Id;
  col: Id;
  state: Id;
  value?: import('../../types/cell').Cell;
}

export interface StatusData {
  rows: StatusRow[];
  columns: StatusColumn[];
  cells: StatusCell[];
}

export type StatusTone =
  | 'good'
  | 'bad'
  | 'neutral'
  | 'warn'
  | 'info'
  | { role: ColorRole };

export interface StatusState {
  id: Id;
  label: string;
  tone: StatusTone;
  pattern?: 'hatch45';
}

export interface StatusOptions extends Omit<BaseOptionsFor<'status'>, 'legend'> {
  states: StatusState[];
  columnLabels?: 'top' | 'bottom';
  /**
   * status omits BaseOptions' legend and re-declares it: its own legendSchema
   * is a strictObject with `position` only, so `legend: { position, order }` —
   * which the inherited declaration promised — is HARD-rejected at runtime.
   */
  legend?: 'none' | 'right' | 'bottom' | 'top' | { position: 'right' | 'bottom' | 'top' };
}

interface StatusCellMark {
  row: Id;
  col: Id;
  state: Id;
  sourceState?: Id;
  missing: boolean;
  rect: Rect;
  nodeId: Id;
}

export interface StatusMarks {
  cells: StatusCellMark[];
}

/**
 * The cells per state the accessible description prints, each with the text
 * it prints, so the claims back every number in it. Missing cells use an
 * identity that differs from every authored state ID.
 */
export interface StatusDerived {
  stateCounts: { state: Id; count: number; displayed: string }[];
}

interface NormRow {
  id: Id;
  label: string;
}

interface NormColumn {
  id: Id;
  label: string;
}

const CELL_GAP = 1;
/** The label solver keeps this gap between labels; a row name needs its height plus this gap per row pitch. */
const LABEL_PAD = 2;
const LABEL_GAP = 8;
const COLUMN_GAP = 6;
/** The narrowest colour-only cell the band leaves the grid: a state still reads at 24 px. */
const MIN_CELL_W = 24;
const EMPTY_STATE = 'none';
/**
 * A cell with no status: the neutral washed nearly to the page, held at the
 * fill-separation floor so it still reads as a cell of the grid on a light
 * or a dark page.
 */
const EMPTY_CELL_PAINT: Paint = {
  token: 'neutral',
  theme: { kind: 'visible-tint', base: { token: 'neutral' }, amount: 0.92, floor: 1.1 },
};

export function lintStatus(data: StatusData, options: StatusOptions): LintWarning[] {
  const declared = new Set((options.states ?? []).map((state) => state.id));
  const used = new Set<Id>();
  const warnings: LintWarning[] = [];

  for (const cell of data.cells ?? []) {
    if (declared.has(cell.state)) {
      used.add(cell.state);
      continue;
    }
    warnings.push({
      code: 'status-unknown-state',
      severity: 'error',
      message: `cell '${cell.row}/${cell.col}' references undeclared state '${cell.state}'`,
      owner: { seriesId: cell.row, categoryId: cell.col },
      suggest: `declare '${cell.state}' in options.states or correct the cell binding`,
    });
  }

  if (used.size > 1 && options.legend === 'none') {
    warnings.push({
      code: 'status-states-unexplained',
      severity: 'warn',
      message: `${used.size} status states are drawn but the state legend is suppressed`,
      suggest: "remove legend: 'none' or choose legend: 'top', 'bottom', or 'right'",
    });
  }
  if (used.size === 1) {
    warnings.push({
      code: 'status-single-state',
      severity: 'info',
      message: 'a one-state status matrix carries no categorical comparison',
      suggest: "use a table for a single verdict, a heatmap for magnitude, or add the missing states",
    });
  }

  return warnings;
}

export function layoutStatus(
  data: StatusData,
  options: StatusOptions = { states: [] },
  rowLines?: 1,
): Geometry<StatusMarks, StatusDerived> {
  const { rows, columns, cells, states } = normalizeStatusInput(data, options);
  const stateById = new Map(states.map((state) => [state.id, state]));
  let missingState = EMPTY_STATE;
  while (stateById.has(missingState)) missingState = `_${missingState}`;
  const cellByBinding = new Map(cells.map((cell) => [`${cell.row}\u0000${cell.col}`, cell]));
  // One raster for every value without its own format, as on the heatmap: "12.0" beside "13.4", not "12".
  const raster = seriesRasterFormatter(options.format, cells.flatMap((cell) =>
    cell.value === undefined || cellMeta(cell.value)?.format ? [] : [cellValue(cell.value)]), options.locale?.language, options.unit, options.target);
  const usedStateIds = new Set(
    cells.filter((cell) => stateById.has(cell.state)).map((cell) => cell.state),
  );
  const usedStates = states.filter((state) => usedStateIds.has(state.id));
  const warnings = lintStatus(data, options);

  const theme = resolveSemanticPaletteTheme(
    chartTheme(options),
    options.palette,
    warnings,
  );
  const statePaint = statePaints(usedStates, options, theme);
  const plainPaint = statePaint.plain;
  const size = resolveSize(options.size);
  const measure = options.measure ?? defaultMeasurer;
  const highlights = new Set(resolveHighlight(options.highlight));
  // labels: false takes the state texts off; the row and column names stay.
  const labelOn = (kind: LabelKind): boolean => chartLabelOn(options, kind, ['series', 'category']);
  // Two states that paint alike read as one: an unpatterned later state takes
  // the hatch unless an earlier state of that colour already holds it. Status
  // knows one pattern (its schema's hatch45); 'outline' is the plan notation
  // and a hollow cell reads as a missing one, so it stays out.
  const patternOf = new Map<Id, 'hatch45' | undefined>();
  const seenLook = new Map<string, StatusState>();
  for (const state of usedStates) {
    const css = paintColor(theme, plainPaint(state));
    const look = (pattern: 'hatch45' | undefined) => `${css}|${pattern ?? ''}`;
    const earlier = seenLook.get(look(state.pattern));
    const pattern = earlier && !state.pattern && !seenLook.has(look('hatch45')) ? 'hatch45' : state.pattern;
    if (earlier) {
      warnings.push({
        code: 'status-states-alike',
        severity: 'warn',
        message: `states '${earlier.id}' and '${state.id}' resolve to the same colour${pattern !== state.pattern ? `; '${state.id}' is hatched to tell them apart` : ' and pattern, so the cells cannot be told apart'}`,
        suggest: 'give each state its own tone, or a pattern',
      });
    }
    if (!seenLook.has(look(pattern))) seenLook.set(look(pattern), state);
    patternOf.set(state.id, pattern);
  }
    // A hatched state paints its full tone: the hatch ground washes it.
  const paintForState = (state: StatusState): Paint => patternOf.get(state.id) ? statePaint.full(state) : plainPaint(state);
const legendOptions = resolveLegendOptions(options, usedStates.length);
  // A hatched cell lays its stripes on its own tone, washed toward the page,
  // so it reads as that tone and never as an empty cell. Its key
  // draws the same recipe: the cell, a hatch without an edge.
  // Each state resolves its hatch alone. Joined with the other states, as a
  // column's forecast series are, the warn stripes stop deepening at about
  // 2.2:1 to keep apart from the green and red ones under colour-vision
  // floors, which judgment tones are not held to. Every cell already prints
  // or keys its state's name.
  // options.hatchStrength sets how strongly the stripes draw on that ground,
  // the cell with no status the floor they fade to.
  const grounding = options.hatchStrength === undefined ? undefined : { strength: options.hatchStrength, apart: EMPTY_CELL_PAINT };
  const hatchOf = (state: StatusState) => patternOf.get(state.id)
    ? { pattern: patternOf.get(state.id), hatchEdge: false as const, hatchGround: hatchGroundPaint(paintForState(state), undefined, grounding) }
    : {};
  // A plain state fill under 3:1 whose cells print no state word takes a 3:1 edge
  // (fillEdges); its key swatch carries the same rule, so key and cells match.
  const separationOf = (state: StatusState) => patternOf.get(state.id) ? {}
    : { separation: { fill: paintForState(state), backing: { token: 'background' } as Paint } };
  const legendItems: LegendItemInput[] = usedStates.map((state) => ({
    id: state.id,
    label: state.label,
    paint: paintForState(state),
    ...hatchOf(state),
    ...separationOf(state),
    key: 'box',
  }));
  // A cell with no state is drawn blank in a grid rule. Beside coloured
  // keys, a blank cell with no entry of its own is a guess (not yet due?
  // not assessed?), so it gets one, in the words its hover card uses.
  const blankCells = rows.length * columns.length > cells.filter((cell) => stateById.has(cell.state)).length;
  if (blankCells && legendItems.length > 0) {
    legendItems.push({ id: missingState, label: chartString(options, 'noStatus'), paint: EMPTY_CELL_PAINT, key: 'box' });
  }
  const legend: FrameInput['legend'] =
    legendOptions && legendItems.length > 0
      ? { options: legendOptions, items: legendItems }
      : undefined;
  // A drawn key names the states, and colour or hatch tells every
  // used state apart, so the cells print no state words under smart and minimal density. A
  // board of repeated names hides the pattern the title talks about, and a word on a hatch
  // reads worst where the eye goes first. labelDensity 'full' keeps the names that fit.
  const keyNamesStates = legend !== undefined && seenLook.size === usedStates.length
    && (options.labelDensity ?? 'smart') !== 'full';

  const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const margin = { ...canvasMargin(theme, size.width), ...options.margin };
  const frameResult = solveFrame(
    {
      size,
      margin,
      ...frameTextOptions(options),
      legend,
      theme,
      measure,
    },
    occupied,
  );
  const framePlot = frameResult.plot;
  const axisFont: FontSpec = { family: theme.type.family, ...theme.type.axis };
  const cellFont: FontSpec = { family: theme.type.family, ...theme.type.label };
  const axisLineH = axisFont.size * (axisFont.lineHeight ?? 1.2);

  const rowBandCap = Math.max(24, framePlot.w * 0.3);
  const estimatedCellH = Math.max(
    1,
    (framePlot.h - axisLineH - COLUMN_GAP - (rows.length - 1) * CELL_GAP) / rows.length,
  );
  // Row names wrap to two lines before the band widens when the chart takes its
  // height: the rows grow to hold them. A pinned height never grows, so there two lines need cells that hold them.
  const openHeight = (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height === false;
  // The two-line test reads the same pad as the natural pitch below (a keyed board keeps the solver's gap only),
  // so a pinned frame at the natural height wraps its row names as the taller frame did and round-trips.
  const rowMaxLines = rowLines ?? (openHeight || estimatedCellH >= axisLineH * 2 + (keyNamesStates ? LABEL_PAD : 4) ? 2 : 1);
  const axisStep = stepDownFont(theme, axisFont, 'axis', options.target, textScaleOf(options));
  // The grid keeps its natural 28 px per column, and the band widens into the rest. When a row
  // name would still be cut, the grid gives the band room down to MIN_CELL_W per column, so a
  // narrow card wraps its row names whole and its stage heads stagger.
  const fitRows = (cellFloor: number, refWarnings: LintWarning[]) => rowLabelBand(rows, axisFont, rowBandCap, rowMaxLines, axisLineH, measure, {
    wider: gutterBudget(rowBandCap, framePlot.w, LABEL_GAP + columns.length * cellFloor + (columns.length - 1) * CELL_GAP),
    target: options.target, textScale: textScaleOf(options), typeRole: 'axis', shrink: axisStep,
    footnoteRefs: { count: authoredFootnoteCount(options), warnings: refWarnings },
  });
  const calendarHeaders = columns.every(column => /^\d{4}-(0[1-9]|1[0-2])$/.test(column.id)
    || measure(column.label, axisFont).width <= 40);
  const naturalRefWarnings: LintWarning[] = [];
  const naturalBand = fitRows(28, naturalRefWarnings);
  // Short calendar heads never stagger, so their columns keep 28 px to keep every head.
  let { labels: rowText, width: rowBandW } = !calendarHeaders && naturalBand.labels.some(text => text.title !== undefined)
    ? fitRows(MIN_CELL_W, warnings) : (pushAll(warnings, naturalRefWarnings), naturalBand);
  // At the 13 px floor a two-line row name sets a 33 px pitch, where 29 px rows
  // hold one line. Under narrow columns (below 48 px), a
  // wider band that keeps every name on one line and every cell at least 32 px wide wins.
  const cellWFor = (bandW: number) => (framePlot.w - bandW - LABEL_GAP - (columns.length - 1) * CELL_GAP) / columns.length;
  if (keyNamesStates && rowText.some(text => text.lines.length > 1) && cellWFor(rowBandW) < 48) {
    const oneLine = rowLabelBand(rows, axisFont, framePlot.w, 1, axisLineH, measure,
      { target: options.target, textScale: textScaleOf(options), typeRole: 'axis', footnoteRefs: { count: authoredFootnoteCount(options), warnings: [] } });
    if (oneLine.labels.every(text => text.title === undefined && text.lines.length === 1 && text.font === axisFont) && cellWFor(oneLine.width) >= 32) {
      ({ labels: rowText, width: rowBandW } = oneLine);
    }
  }
  const gridX = framePlot.x + rowBandW + LABEL_GAP;
  const gridW = Math.max(10, framePlot.w - rowBandW - LABEL_GAP);
  const cellW = Math.max(1, (gridW - (columns.length - 1) * CELL_GAP) / columns.length);
  const columnStep = cellW + CELL_GAP;
  const columnCenter = (index: number) => gridX + index * columnStep + cellW / 2;

  const columnTextCap = Math.max(calendarHeaders ? 40 : 12, cellW - 2);
  // Try the complete header in the air left by its neighbours before wrapping.
  const headerWidths = columns.map(column => measure(column.label, axisFont).width);
  const headerLeft = columns.map((_, index) => Math.max(framePlot.x,
    Math.min(columnCenter(index) - headerWidths[index]! / 2, framePlot.x + framePlot.w - headerWidths[index]!)));
  const headerFits = columns.map((_, index) => headerWidths[index]! <= framePlot.w
    && (index === 0 || headerLeft[index]! >= headerLeft[index - 1]! + headerWidths[index - 1]! + 4)
    && (index === columns.length - 1 || headerLeft[index]! + headerWidths[index]! + 4 <= headerLeft[index + 1]!));
  let headerTiers = !calendarHeaders && headerFits.some(fits => !fits)
    ? [2, 3].find(tiers => columns.every((_, index) => headerWidths[index]! <= framePlot.w
      && (index < tiers || headerLeft[index]! >= headerLeft[index - tiers]! + headerWidths[index - tiers]! + 4))) ?? 1 : 1;
  let staggerHeaders = headerTiers > 1;
  let { labels: columnText } = rowLabelBand(columns.map((column, index) => ({ ...column,
    label: calendarHeaders || staggerHeaders || headerFits[index] ? column.label : wrapHeader(column.label, columnTextCap, axisFont, measure),
  })), axisFont, columnTextCap, 3, axisLineH, measure, { target: options.target, textScale: textScaleOf(options), typeRole: 'axis', shrink: axisStep });
  columnText.forEach((text, index) => {
    if (staggerHeaders || headerFits[index]) Object.assign(text, { lines: [columns[index]!.label], w: headerWidths[index]!, h: axisLineH, title: undefined });
  });
  // A monthly head that fits on one line ('Jan 21') can need a coarser stride than the same head on
  // two lines ('Jan' over '21'): at a 13 px axis 'Jan 21' fits the 40 px cap, and the chart would lose
  // every second quarter head. The two-line form wins when it keeps a finer stride.
  if (!staggerHeaders && columns.every(column => /^\d{4}-(0[1-9]|1[0-2])$/.test(column.id) && /\s/u.test(column.label))) {
    const month = columns.map(column => Number(column.id.slice(5, 7)));
    const strideFor = (widths: readonly number[]) => [1, 2, 3, 6, 12].find(stride => {
      const kept = columns.flatMap((_, index) => ((month[index]! - 1) % stride === 0 ? [index] : []));
      return kept.every((index, k) => k === 0 || columnCenter(kept[k - 1]!) + widths[kept[k - 1]!]! / 2 + 4 <= columnCenter(index) - widths[index]! / 2);
    }) ?? 13;
    const stackedW = columns.map(column => Math.max(...column.label.split(/\s/u).map(part => measure(part, axisFont).width)));
    if (strideFor(stackedW) < strideFor(columnText.map(text => text.w))) {
      columnText = rowLabelBand(columns, axisFont, maxOf(stackedW) + 0.5, 2, axisLineH, measure,
        { target: options.target, textScale: textScaleOf(options), typeRole: 'axis', shrink: axisStep }).labels;
      headerFits.fill(false);
    }
  }
  let columnLabelH =
    Math.max(headerTiers, maxOf(columnText.map((text) => text.lines.length))) * axisLineH + (headerTiers - 1) * 2 * LABEL_PAD;
  const fixedHeight = (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height ?? !heightOmitted(options.size);
  const minimumRowsH = rows.length * Math.max(28, maxOf(rowText.map(text => text.h + LABEL_PAD - CELL_GAP))) + (rows.length - 1) * CELL_GAP;
  if (fixedHeight && columnLabelH + COLUMN_GAP + minimumRowsH > framePlot.h) {
    // The two-line header form keeps accepted fixed frames drawable.
    columnText = rowLabelBand(columns, axisFont, Math.max(40, cellW - 2), 2, axisLineH, measure,
      { target: options.target, textScale: textScaleOf(options), typeRole: 'axis', shrink: axisStep }).labels;
    headerTiers = 1;
    staggerHeaders = false;
    headerFits.fill(false);
    columnLabelH = Math.max(1, maxOf(columnText.map(text => text.lines.length))) * axisLineH;
  }
  const columnBandH = columnLabelH + COLUMN_GAP;
  const columnPosition = options.columnLabels ?? 'top';
  const gridY = columnPosition === 'top' ? framePlot.y + columnBandH : framePlot.y;
  const gridH = Math.max(10, framePlot.h - columnBandH);
  const cellH = Math.max(1, (gridH - (rows.length - 1) * CELL_GAP) / rows.length);
  const rowStep = cellH + CELL_GAP;
  const rowCenter = (index: number) => gridY + index * rowStep + cellH / 2;
  const plot: Rect = { x: gridX, y: gridY, w: gridW, h: gridH };
  const minimumCellH = cellFont.size * (cellFont.lineHeight ?? 1.2)
    * (labelOn('point') && cells.some(cell => cell.value !== undefined) ? 2 : 1) + 4;
  const namedCellHeights = labelOn('point') && !keyNamesStates ? cells.flatMap(binding => {
    const state = stateById.get(binding.state);
    if (!state) return [];
    const value = binding.value === undefined ? undefined : valueForStatus(binding.value, raster, options.format !== undefined);
    const sizes = [state.label, ...(value ? [value] : [])].map(line => measure(line, cellFont));
    return Math.max(...sizes.map(size => size.width)) + 8 <= cellW
      ? [sizes.reduce((height, size) => height + size.height, 0) + 4] : [];
  }) : [];
  // The natural height keeps state names and values that fit at this width.
  // Colour-only cells sit in a tighter pitch as the columns narrow: 36 px under wide columns,
  // 33 px under card columns and 29 px under columns narrower than 48 px; a two-line row name
  // still keeps the solver's gap.
  const pitchCellH = keyNamesStates ? (cellW >= 72 ? 36 : cellW >= 48 ? Math.min(33, cellW) : Math.min(29, cellW)) : Math.min(36, cellW);
  // More height must not switch to wrapped row names before the full header and rows fit.
  if (fixedHeight && rowMaxLines === 2 && minimumRowsH > gridH) {
    return layoutStatus(data, options, 1);
  }
  const naturalCellH = Math.max(minimumCellH, maxOf(namedCellHeights), maxOf(rowText.map(text => text.h + (keyNamesStates ? LABEL_PAD : 4))), pitchCellH);
  {
    const grow = rowDrivenHeight({
      options,
      width: size.width,
      height: size.height,
      chromeH: size.height - gridH,
      rowsH: rows.length * naturalCellH + (rows.length - 1) * CELL_GAP,
    });
    if (grow !== undefined) return layoutStatus(data, { ...options, size: { width: size.width, height: grow } }, rowLines);
  }

  // Monthly columns ('2024-01') keep calendar-aligned heads at one
  // stride (every month, quarter, half or year) to the end of the axis, and a
  // rule marks each new year, so no gap jumps from Jul 25 to Dec 25.
  const months = columns.every((column) => /^\d{4}-(0[1-9]|1[0-2])$/.test(column.id))
    ? columns.map((column) => Number(column.id.slice(5, 7)))
    : undefined;
  const monthlyKeep = months && [1, 2, 3, 6, 12].map((stride) => columns.map((_, index) => (months[index]! - 1) % stride === 0))
    .find((keep) => {
      const kept = keep.flatMap((on, index) => (on ? [index] : []));
      return kept.every((index, k) => k === 0
        || columnCenter(kept[k - 1]!) + columnText[kept[k - 1]!]!.w / 2 + 4 <= columnCenter(index) - columnText[index]!.w / 2);
    });
  const headerKeep = staggerHeaders ? columns.map(() => true) : monthlyKeep ?? sweepHide(
    columns.map((column, index) => ({
      start: columnCenter(index) - columnText[index]!.w / 2,
      size: columnText[index]!.w,
      priority:
        (index === 0 || index === columns.length - 1
          ? PRIORITY.endpoint
          : PRIORITY.interior) +
        (highlights.has(column.id) ? PRIORITY.highlightBonus : 0),
    })),
    4,
  );

  const scene: SceneNode[] = [...frameResult.nodes];
  const marks: StatusMarks = { cells: [] };
  const labelRequests: LabelRequest[] = [];
  // A panel whose host holds the key keeps its per-cell names: no key can be added here.
  const hostHoldsKey = options.legend === 'none' && panelTypeClass(options) !== undefined;
  const namedCells = labelOn('point') && !keyNamesStates && (hostHoldsKey || cells.every(binding => {
    const state = stateById.get(binding.state);
    if (!state) return true;
    const value = binding.value === undefined ? undefined : valueForStatus(binding.value, raster, options.format !== undefined);
    const lines = [state.label, ...(value ? [value] : [])];
    return Math.max(...lines.map(line => measure(line, cellFont).width)) + 8 <= cellW
      && lines.reduce((height, line) => height + measure(line, cellFont).height, 0) + 4 <= cellH;
  }));

  rows.forEach((row, rowIndex) => {
    columns.forEach((column, columnIndex) => {
      const binding = cellByBinding.get(`${row.id}\u0000${column.id}`);
      const state = binding ? stateById.get(binding.state) : undefined;
      const missing = state === undefined;
      const owner: OwnerRef = { seriesId: row.id, categoryId: column.id };
      const rect: Rect = {
        x: gridX + columnIndex * columnStep,
        y: gridY + rowIndex * rowStep,
        w: cellW,
        h: cellH,
      };
      const nodeId = `cell:${row.id}:${column.id}`;

      scene.push({
        t: 'rect',
        id: nodeId,
        rect,
        // Every cell is its fill alone, so the one-pixel gutter between cells
        // is the only separator and has one width everywhere: a
        // hatch draws no edge, and a cell with no status is a light cell of
        // the same grid, not an outlined box.
        fill: state ? paintForState(state) : EMPTY_CELL_PAINT,
        ...(state ? hatchOf(state) : {}),
        owner,
        part: 'cell',
        display: { state: state?.label ?? 'No status', ...(binding?.value !== undefined ? { value: valueForStatus(binding.value, raster, options.format !== undefined) } : {}) },
      });
      // The edge is a separate closed path inside the fill. Its stroke cannot cover the cell gutter.
      // Reserve both possible edge widths even when this theme needs none, so repaint keeps its path.
      if (state && !patternOf.get(state.id)) {
        const fill = paintForState(state);
        const inset = Math.min(rect.w / 2, rect.h / 2, Math.max(strokeToken(theme, 'rule'), theme.pattern.outlineStrokeWidth) / 2 + 0.01);
        const edge = separationStroke(paintColor(theme, fill), theme.color.background, theme);
        scene.push({ t: 'path', id: `cellOutline:${row.id}:${column.id}`,
          d: linePath([{ x: rect.x + inset, y: rect.y + inset }, { x: rect.x + rect.w - inset, y: rect.y + inset },
            { x: rect.x + rect.w - inset, y: rect.y + rect.h - inset }, { x: rect.x + inset, y: rect.y + rect.h - inset }]) + 'Z',
          ...(edge ? { stroke: edge.stroke, width: edge.strokeWidth } : {}),
          ...separationOf(state), owner, part: 'cellOutline' });
      }
      occupied.claim(rect, 'mark', owner, 'cell');
      const valueText = binding?.value === undefined ? undefined : valueForStatus(binding.value, raster, options.format !== undefined);
      // A cell that holds its state's name prints it, so the state does
      // not rest on colour alone; small cells keep the key. A cell too small
      // for name and value prints the value alone: colour and key
      // still carry the state, and only a value with no room hides.
      // labels: false takes the state texts off: colour, hatch and the key carry the state.
      if (state && labelOn('point')) {
        const fit = (lines: string[]) => {
          const sizes = lines.map(line => measure(line, cellFont));
          const size = { width: Math.max(...sizes.map(size => size.width)), height: sizes.reduce((sum, size) => sum + size.height, 0) };
          return { lines, size, fits: size.width + 8 <= rect.w && size.height + 4 <= rect.h };
        };
        const named = fit(namedCells ? [state.label, ...(valueText ? [valueText] : [])] : valueText ? [valueText] : []);
        const { lines, size, fits } = named.fits || valueText === undefined ? named : fit([valueText]);
        const text = lines.join('\n');
        if (lines.length > 0 && (fits || valueText !== undefined)) {
          labelRequests.push({
            id: `state:${row.id}:${column.id}`,
            kind: 'point',
            typeRole: 'label',
            role: 'category',
            owner,
            // A value alone does not say the state: only the state word is equivalent text.
            ...(lines.includes(state.label) ? {} : { printsFor: [] }),
            text,
            lines,
            font: cellFont,
            priority: fits ? PRIORITY.interior : PRIORITY.valueLine,
            candidates: fits ? [{
              slot: 'inside',
              rect: { x: rect.x + (rect.w - size.width) / 2, y: rect.y + (rect.h - size.height) / 2, w: size.width, h: size.height },
              penalty: 0,
              insideFill: paintColor(theme, paintForState(state)),
              insidePaint: paintForState(state),
            }] : [],
          });
        }
      }
      marks.cells.push({
        row: row.id,
        col: column.id,
        state: state?.id ?? missingState,
        ...(binding && !state ? { sourceState: binding.state } : {}),
        missing,
        rect,
        nodeId,
      });
    });
  });

  if (months) {
    months.forEach((month, index) => {
      if (month !== 1 || index === 0) return;
      const x = gridX + index * columnStep - CELL_GAP / 2;
      scene.push({
        t: 'line', id: `yearRule:${columns[index]!.id}`, x1: x, y1: gridY, x2: x, y2: gridY + gridH + (columnPosition === 'bottom' ? 4 : 0),
        stroke: { token: 'axis' }, width: strokeToken(theme, 'rule'), owner: { categoryId: columns[index]!.id }, part: 'yearRule',
      });
    });
  }

  if (labelOn('series')) {
    rows.forEach((row, index) => {
      const text = rowText[index]!;
      labelRequests.push({
        id: `series:${row.id}`,
        kind: 'series',
        owner: { seriesId: row.id },
        text: row.label,
        ...fittedLabel(text, axisFont),
        font: axisFont,
        priority:
          PRIORITY.endpoint +
          (highlights.has(row.id) ? PRIORITY.highlightBonus : 0),
        candidates: [
          {
            slot: 'left',
            rect: {
              x: framePlot.x + rowBandW - text.w,
              y: rowCenter(index) - text.h / 2,
              w: text.w,
              h: text.h,
            },
            penalty: 0,
          },
        ],
      });
    });
  }

  if (labelOn('category')) {
    columns.forEach((column, index) => {
      const text = columnText[index]!;
      const kept = headerKeep[index]!;
      // Off-stride months stay unnamed; the stride and the year rules carry them.
      if (monthlyKeep && !kept) return;
      const y =
        columnPosition === 'top'
          ? framePlot.y + (staggerHeaders ? (index % headerTiers) * (axisLineH + 2 * LABEL_PAD) : columnLabelH - text.h)
          : gridY + gridH + COLUMN_GAP + (staggerHeaders ? (index % headerTiers) * (axisLineH + 2 * LABEL_PAD) : 0);
      labelRequests.push({
        id: `category:${column.id}`,
        kind: 'category',
        owner: { categoryId: column.id },
        text: column.label,
        ...fittedLabel(text, axisFont),
        font: axisFont,
        priority: kept
          ? PRIORITY.endpoint +
            (highlights.has(column.id) ? PRIORITY.highlightBonus : 0)
          : PRIORITY.interior - 50,
        candidates: [
          {
            slot: columnPosition,
            rect: {
              x: staggerHeaders || headerFits[index] ? headerLeft[index]! : columnCenter(index) - text.w / 2,
              y,
              w: text.w,
              h: text.h,
            },
            penalty: 0,
          },
        ],
      });
    });
  }

  const solveCtx: SolveCtx = labelCtx(theme, size, options, {
    measure,
    plot,
    labelPad: LABEL_PAD,
  });
  const solved = solveLabels(labelRequests, occupied, solveCtx);
  if (fixedHeight && rowMaxLines === 2 && solved.placed.some(label => label.kind === 'series' && label.hidden === 'collision')) {
    return layoutStatus(data, options, 1);
  }
  // A panel's explicit none leaves its state key with the host.
  if (!legend && !(options.legend === 'none' && panelTypeClass(options) !== undefined) && usedStates.some(state => !solved.placed.some(label =>
    !label.hidden && label.id.startsWith('state:') && label.lines[0] === state.label
    && cellByBinding.get(`${label.owner.seriesId}\u0000${label.owner.categoryId}`)?.state === state.id))) {
    const key = legendRequired(options.legend, warnings, 'status', theme, 'cell state names are not drawn');
    const keyed = layoutStatus(data, { ...options, legend: key }, rowLines);
    pushAll(keyed.warnings, warnings.filter(warning => warning.code === 'status-legend-required'));
    return keyed;
  }
  // A hidden value is named in the note line by its row and column; the
  // registered layout names each one or refuses the canvas.
  for (const label of solved.placed) {
    if (!label.hidden || !label.id.startsWith('state:')) continue;
    const value = cellByBinding.get(`${label.owner.seriesId}\u0000${label.owner.categoryId}`)?.value;
    if (value === undefined) continue;
    const row = rows.find(row => row.id === label.owner.seriesId)!;
    const column = columns.find(column => column.id === label.owner.categoryId)!;
    label.noteText = `${row.label} / ${column.label}: ${valueForStatus(value, raster, options.format !== undefined)}`;
  }
  pushAll(warnings, solved.warnings);
  for (const label of solved.placed) if (label.kind === 'series' && label.hidden === 'collision') {
    const warning = warnings.find(w => w.code === 'label-hidden' && w.owner?.seriesId === label.owner.seriesId);
    if (warning) warning.severity = 'error';
  }
  // A wrapped row label is right-aligned line by line to the grid edge.
  const labelRects = new Map(solved.placed.map((label) => [`label:${label.id}`, label.rect]));
  // The column heads print in the table family's head ink; a highlighted or emphasised head keeps its own.
  const headInk = tableHeadInk();
  for (const label of solved.placed) {
    if (label.kind === 'category' && !highlights.has(label.owner.categoryId ?? '') && !label.emphasis && plainInk(label.ink)) label.ink = headInk;
  }
  pushAll(scene, labelsToNodes(theme, solved.placed, label => label.kind === 'point' ? cellFont : axisFont, scene)
    .map((node): SceneNode => node.t === 'text' && node.part === 'series' && node.lines.length > 1 && node.align === 'start'
      ? { ...node, align: 'end', x: labelRects.get(node.id)!.x + labelRects.get(node.id)!.w } : node));

  const stateCounts = new Map<Id, number>();
  let noneCount = 0;
  for (const mark of marks.cells) {
    if (mark.missing) noneCount++;
    else stateCounts.set(mark.state, (stateCounts.get(mark.state) ?? 0) + 1);
  }
  const describedCounts = [
    ...usedStates.map((state) => ({ state: state.id, count: stateCounts.get(state.id) ?? 0, displayed: `${state.label} ${stateCounts.get(state.id) ?? 0}` })),
    ...(noneCount > 0 ? [{ state: missingState, count: noneCount, displayed: chartString(options, 'noStatusCount', { v1: noneCount }) }] : []),
  ];
  const stateSummary = describedCounts.map((entry) => entry.displayed).join(', ');

  return {
    type: 'status',
    size,
    sizing: rowSizing('status', size, {
      chromeH: size.height - gridH,
      // A two-line row name sets the pitch: its height and the solver's gap, of which the cell gap gives one px.
      minimumRowsH: rows.length * Math.max(28, maxOf(rowText.map((label) => label.h + LABEL_PAD - CELL_GAP)),
        maxOf(!legend ? namedCellHeights : [])) + (rows.length - 1) * CELL_GAP,
      naturalRowsH: rows.length * naturalCellH + (rows.length - 1) * CELL_GAP,
      ...matrixWidths(size.width - gridW, columns.length, CELL_GAP, columnText.map((label) => label.w / headerTiers)),
    }),
    plot,
    scene,
    labels: solved.placed,
    axes: [
      {
        axis: 'x',
        ticks: columns.map((column, index) => ({
          at: column.id,
          pos: columnCenter(index),
          labelId: `category:${column.id}`,
        })),
      },
      {
        axis: 'y',
        ticks: rows.map((row, index) => ({
          at: row.id,
          pos: rowCenter(index),
          labelId: `series:${row.id}`,
        })),
      },
    ],
    annotations: [],
    legend: frameResult.legend,
    frame: frameResult.frame,
    marks,
    derived: { stateCounts: describedCounts },
    a11y: {
      title: accessibleTitle(options.title, chartString(options, 'statusTitle', { v1: rows.length, v2: columns.length })),
      counts: [structureCount('rows', rows.length, undefined, options), structureCount('columns', columns.length, undefined, options)],
      desc: chartString(options, 'statusDesc', { v1: rows.length, v2: columns.length, v3: stateSummary }),
    },
    warnings,
    debug: {
      occupied: occupied.snapshot(),
      decisions: solved.decisions,
    },
  };
}

/** Break a long stage name between characters before the shared fitter cuts it. */
function wrapHeader(text: string, width: number, font: FontSpec, measure: import('../../text').TextMeasurer): string {
  const words = text.split(/\s+/).flatMap(word => {
    const parts: string[] = [];
    let part = '';
    for (const character of word) {
      if (part && measure(part + character, font).width > width) { parts.push(part); part = ''; }
      part += character;
    }
    if (part) parts.push(part);
    return parts;
  });
  return words.join('\n');
}

function normalizeStatusInput(
  data: StatusData,
  options: StatusOptions,
): {
  rows: NormRow[];
  columns: NormColumn[];
  cells: StatusCell[];
  states: StatusState[];
} {
  if (!data || !Array.isArray(data.rows) || data.rows.length === 0) {
    throw new NormalizeError('empty-data', 'rows', 'status requires at least one row');
  }
  if (!Array.isArray(data.columns) || data.columns.length === 0) {
    throw new NormalizeError('empty-data', 'columns', 'status requires at least one column');
  }
  if (!Array.isArray(data.cells)) {
    throw new NormalizeError('invalid-data', 'cells', 'status cells must be an array');
  }
  if (!Array.isArray(options?.states) || options.states.length === 0) {
    throw new NormalizeError(
      'invalid-options',
      'options.states',
      'status requires at least one declared state',
    );
  }
  if (options.states.length > 6) {
    throw new NormalizeError(
      'invalid-options',
      'options.states',
      `status supports at most 6 states, got ${options.states.length}`,
      'bucket related verdicts into 6 or fewer states',
    );
  }

  const rows = data.rows.map((row, index) => {
    if (!row?.id) {
      throw new NormalizeError('missing-id', `rows[${index}]`, 'status row requires an id');
    }
    return { id: row.id, label: row.label ?? row.id };
  });
  const columns = data.columns.map((column, index) => {
    if (!column?.id) {
      throw new NormalizeError(
        'missing-id',
        `columns[${index}]`,
        'status column requires an id',
      );
    }
    return { id: column.id, label: column.label ?? column.id };
  });
  const rowIds = new Set(rows.map((row) => row.id));
  const columnIds = new Set(columns.map((column) => column.id));
  const bindings = new Set<string>();
  data.cells.forEach((cell, index) => {
    if (!rowIds.has(cell.row)) {
      throw new NormalizeError(
        'unknown-row',
        `cells[${index}].row`,
        `status cell references unknown row '${cell.row}'`,
      );
    }
    if (!columnIds.has(cell.col)) {
      throw new NormalizeError(
        'unknown-column',
        `cells[${index}].col`,
        `status cell references unknown column '${cell.col}'`,
      );
    }
    const binding = `${cell.row}\u0000${cell.col}`;
    if (bindings.has(binding)) {
      throw new NormalizeError(
        'duplicate-binding',
        `cells[${index}]`,
        `status cell binding '${cell.row}/${cell.col}' is duplicated`,
      );
    }
    bindings.add(binding);
  });

  return { rows, columns, cells: data.cells, states: options.states };
}

function resolveLegendOptions(
  options: StatusOptions,
  usedStateCount: number,
): LegendOptions | undefined {
  const normalized = normalizeLegendOption(
    options.legend,
    usedStateCount > 1 ? { position: 'top' } : undefined,
  );
  return normalized ? { position: normalized.position } : undefined;
}

function tonePaint(state: StatusState, options: StatusOptions, theme: Theme): { paint: Paint; quiet?: 'good' | 'neutral' } {
  const role: ColorRole =
    typeof state.tone === 'string'
      ? state.tone === 'info'
        ? 'highlight'
        : state.tone
      : state.tone.role;
  if (options.colorblindSafe && (role === 'good' || role === 'bad')) {
    return { paint: colorblindPaint(role, true) };
  }
  if (role === 'neutral') return { paint: semanticPalettePaint(theme, options.palette, 'neutralMark'), quiet: 'neutral' };
  // A status cell is larger than a point: the highlight role takes the focus
  // and good / bad their fill roles.
  if (role === 'highlight') return { paint: semanticPalettePaint(theme, options.palette, 'focus') };
  return role === 'good' ? { paint: markRolePaint(role, true), quiet: 'good' } : { paint: markRolePaint(role, true) };
}

/**
 * The fill of each state. On-track and not-started cells are the ones a
 * reader passes over: the good and the neutral tone draw washed toward the
 * page (status-tone), so off-track and at-risk cells carry the colour. The
 * wash is decided in the theme the scene is painted in, apart from the cell
 * with no status and from every other state's colour. A hatched state keeps
 * the full tone (full): its hatch already washes the ground, and the stripes
 * carry the tone.
 */
function statePaints(states: readonly StatusState[], options: StatusOptions, theme: Theme): { plain: (state: StatusState) => Paint; full: (state: StatusState) => Paint } {
  const tones = new Map(states.map((state) => [state.id, tonePaint(state, options, theme)]));
  const loud = [...tones.values()].filter((tone) => tone.quiet === undefined).map((tone) => tone.paint);
  // A hatched state of the same tone (a forecast twin) keeps the full tone
  // under its hatch; the plain cell stays at least as strong as that ground.
  const grounding = options.hatchStrength === undefined ? undefined : { strength: options.hatchStrength, apart: EMPTY_CELL_PAINT };
  const hatchedGrounds = (role: 'good' | 'neutral') => states
    .filter((state) => state.pattern !== undefined && tones.get(state.id)?.quiet === role)
    .map((state) => hatchGroundPaint(tones.get(state.id)!.paint, undefined, grounding));
  const quiet = (role: 'good' | 'neutral', base: Paint, apartFrom: Paint[]): Paint => {
    const under = hatchedGrounds(role);
    return { token: 'token' in base ? base.token : role === 'good' ? 'goodFill' : 'neutralMark',
      theme: { kind: 'status-tone', role, base, empty: EMPTY_CELL_PAINT, ...(apartFrom.length > 0 ? { apartFrom } : {}), ...(under.length > 0 ? { under } : {}) } };
  };
  const neutrals = new Map<Id, Paint>();
  for (const [id, tone] of tones) if (tone.quiet === 'neutral') neutrals.set(id, quiet('neutral', tone.paint, loud));
  const paints = new Map<Id, Paint>();
  for (const [id, tone] of tones) {
    paints.set(id, tone.quiet === 'neutral' ? neutrals.get(id)!
      : tone.quiet === 'good' ? quiet('good', tone.paint, [...loud, ...neutrals.values()])
        : tone.paint);
  }
  const full = (state: StatusState) => tones.get(state.id)?.paint ?? tonePaint(state, options, theme).paint;
  return { plain: (state) => paints.get(state.id) ?? full(state), full };
}

function valueForStatus(value: import('../../types/cell').Cell, format: ReturnType<typeof seriesRasterFormatter>, authored: boolean): string {
  const raw = cellValue(value);
  if (raw === null) return '–';
  const meta = cellMeta(value);
  if (meta?.format) return formatterFromExample(meta.format, format.spec.locale)(raw);
  if (authored) return format.fmt(raw);
  // The shared raster never prints a nonzero value as 0: 0.004 beside 12 keeps its digits.
  return formatNonzeroWithSpec(raw, isPctCell(value) ? { ...format.spec, suffix: '%', wholeFrom: undefined } : format.spec);
}
