import { chartString } from '../../strings/waffle';
/**
 * Waffle chart. Each category is one panel: a wrapped label, a big headline
 * number (the panel total) and a grid of square cells. The first series fills
 * the first cells, the next series the cells after them, and the rest of the
 * panel stays empty. Segments are whole cells (largest-remainder rounding,
 * cells.ts).
 *
 * Layout owns all geometry. Panels share one width, one square cell size and
 * one grid top, so grids align when labels wrap to different line counts.
 * Text goes through the label solver with the kpi text roles (roles.ts).
 * Each segment, and the empty cells, is ONE path node of many cell squares:
 * a 10 × 10 panel is a few nodes, not a hundred.
 */

import { chartPalette } from '../chartEnv';
import { structureCount } from '../../structureCounts';
import { COMPACT_SOURCE_LINES, authoredNotes, frameTextOptions, legendRequired, normalizeLegendOption, solveFrame, type CompactSourceOptions, type FrameInput, type LegendItemInput } from '../../frame';
import { formatAutomaticPercent, shareText } from '../../format';
import { exampleSpec, formatWithSpec, roundedNumber } from '../../formatSpec';
import { authoredDecimals, autoDecimals } from '../../formatPrecision';
import { round2, type Rect } from '../../geometry';
import { labelsToNodes } from '../../label/emit';
import { createOccupiedIndex } from '../../label/occupied';
import { labelCtx, PRIORITY, solveLabels, type LabelRequest, type SolveCtx } from '../../label/solver';
import { accessibleTitle, normalizeCategory, normalizeSeriesValues, NormalizeError, resolveSize } from '../../normalize/shared';
import { type RoundingAdjustment } from '../../shareRounding';
import { heightOmitted, resolveSizing } from '../../sizing';
import { rowDrivenHeight } from '../../rowCanvas';
import { defaultMeasurer, wrapText, type FontSpec } from '../../text';
import { textRole } from '../../textRole';
import { arrowHeadPath, arrowShaftEnd } from '../../svgPath';
import { strokeToken, dashToken, canvasMargin, contrastInkPaint, markRolePaint, mixedPaint, surfaceFloorPaint, panelTypeClass, resolveTheme, seriesPaint, spaceTokens, themeForWidth } from '../../theme';
import { DEFAULT_TARGET, kpiHeroSizesPx, panelHeroSizesPx, TARGET_SIZE, type TargetSizeOptions } from '../../target';
import { KPI_VALUE_SIZE, textScaleOf } from '../../typeFloors';
import { cellMeta, cellValue, type Id } from '../../types/cell';
import type { Category, ChartData } from '../../types/data';
import type { Geometry, LintWarning, Paint, PlacedLabel, SceneNode } from '../../types/scene';
import { allocateCells, cellAt } from './cells';
import { WAFFLE_MAX_GRID_SIDE, WAFFLE_SIZING } from './sizing';
import { eyebrowFont, figureRole } from '../cardRoles';
import type { WaffleDerived, WaffleMarks, WaffleOptions, WafflePanelDerived } from './types';
import { disclosureNote, engineNote } from '../../notes';
import { TEXT_ASCENT } from '../../svg/renderSvg';
import { localeStrings } from '../../strings';
import { maxOf, minOf, pushAll } from '../../arrays';

/** The smallest cell side a panel still reads at, in px, and the largest one an unpinned chart draws. */
const MIN_PITCH = 8;
const NATURAL_PITCH = 32;
/** Values within this of 100 count as 100: float sums such as 33.3 + 33.3 + 33.4. */
const WHOLE_TOLERANCE = 1e-6;
const DEFAULT_GRID = { rows: 10, columns: 10 } as const;
/** Square mode: share of the hue in the pale 100% square; the rest is the page. */
const PALE_SQUARE = 0.16;
/** Square mode: the reference outline's dash and the arrow head size, in px. */

const ARROW_HEAD = 5;
/** Square mode: the narrowest gap between panels that still holds an arrow. */
const ARROW_GUTTER = 28;
/** Square mode: the smallest panel side that still reads, and the gap between panels when the full gap leaves panels under the cell floor. */
const SQUARE_MIN_SIDE = 40;
const COMPACT_GUTTER = 10;
/** Square mode: label block to square, square to headline box, and headline box to group caption (it holds the rule). */
const SQUARE_LABEL_GAP = 6;
const SQUARE_HEADLINE_GAP = 8;
const SQUARE_CAPTION_GAP = 11;
/** Square mode: a panel label may run into the gap up to this distance before the next label. */
const LABEL_CLEAR = 4;
/** Square mode: the share of a panel's width its headline may take, so adjacent headlines do not run together. */
const HEADLINE_SHARE = 0.72;
/** One-panel readout: the largest cell pitch beside the key, the smallest that still takes the key beside the grid, and the gap between cells. */
const SIDE_NATURAL_PITCH = 37;
const SIDE_MIN_PITCH = 24;
const READOUT_GAP = 3;
/** One panel, one series, pinned height: the value and label stand beside the filled cells. Gap from the grid to the text, the widest label line (in label sizes) and the gain in cell pitch that earns the form. */
const VALUE_SIDE_GAP = 26;
const VALUE_SIDE_LABEL_EMS = 10;
const VALUE_SIDE_GAIN = 1.1;

interface Pass {
  geometry: Geometry<WaffleMarks, WaffleDerived>;
  /** Canvas height at which every grid has its natural cell size. */
  naturalHeight: number;
  /** The content floor fits the size this pass was laid out at. */
  fits: boolean;
}

export function layoutWaffle(data: ChartData, options: WaffleOptions = {}): Geometry<WaffleMarks, WaffleDerived> {
  const pass = layoutPass(data, options);
  const { size } = pass.geometry;
  // A pinned size does not grow for its plot or key (a static footer grows only for notes left
  // out of the frame). When the extra readouts of this layout
  // (side key, value key, rest key, label in the frame) do not fit it, one
  // lean pass draws the panels without them, so the chart still draws at that size.
  // Only an authored height pins: a width-only request is probed at trial heights, and those may grow.
  const authoredHeight = !heightOmitted(options.size) && (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height !== false;
  if (authoredHeight && !pass.fits) {
    const lean = layoutPass(data, options, true);
    if (lean.fits) return lean.geometry;
    // Cell panels wrap only where the wrapped form fits; below its floor the one row draws, with cut names.
    if ((options.variant ?? 'cells') === 'cells') {
      for (const oneRowLean of [false, true]) {
        const row = layoutPass(data, options, oneRowLean, true);
        if (row.fits) return row.geometry;
      }
      return leanFloor(data, options, layoutPass(data, options, false, true).geometry);
    }
    return leanFloor(data, options, pass.geometry);
  }
  // An unpinned chart takes the height its content needs.
  const grow = rowDrivenHeight({ options, width: size.width, height: size.height, chromeH: 0, rowsH: pass.naturalHeight });
  return leanFloor(data, options, grow === undefined ? pass.geometry : layoutPass(data, { ...options, size: { width: size.width, height: grow } }).geometry);
}

/**
 * The reference key row is optional for the floor: a pinned height without
 * room for it draws the lean pass, which names the outline in a note. The
 * reported minimum height is then the lean one, so a card that fits the lean form still draws.
 */
function leanFloor(data: ChartData, options: WaffleOptions, geometry: Geometry<WaffleMarks, WaffleDerived>): Geometry<WaffleMarks, WaffleDerived> {
  if (!geometry.derived.reference || !geometry.legend?.items.some((item) => /^_*__reference$/.test(item.id))) return geometry;
  const lean = layoutPass(data, { ...options, size: geometry.size }, true).geometry.sizing;
  if (!lean || !geometry.sizing || lean.minHeight >= geometry.sizing.minHeight) return geometry;
  return { ...geometry, sizing: { ...geometry.sizing, minHeight: lean.minHeight, measuredMinHeight: lean.measuredMinHeight, comfortableHeight: Math.ceil(lean.minHeight * 1.25) } };
}

/**
 * One layout at one size. The key (or, when the key is off or the pass is
 * lean, a note) names the reference outline: one fixed place at every width,
 * never text over a share square. `lean`: a pinned size
 * too small for the readouts, so the key holds only the series names, the
 * panel label stays above its grid and no side key is used.
 */
function layoutPass(data: ChartData, options: WaffleOptions, lean = false, oneRow = false): Pass {
  const warnings: LintWarning[] = [];
  const size = resolveSize(options.size, options.target);
  const theme = themeForWidth(resolveTheme(options.theme), panelTypeClass(options) ?? size.width);
  const palette = chartPalette(theme, options.palette, warnings);
  const measure = options.measure ?? defaultMeasurer;
  const strings = localeStrings(options.locale?.language);
  const target = options.target ?? DEFAULT_TARGET;
  const grid = options.grid ?? DEFAULT_GRID;
  const fillFrom = options.fillFrom ?? 'bottom';
  // Checked before any cell is counted or allocated: a host can skip the schema.
  const gridOk = (n: number) => Number.isInteger(n) && n >= 1 && n <= WAFFLE_MAX_GRID_SIDE;
  if (!(gridOk(grid.rows) && gridOk(grid.columns))) {
    throw new NormalizeError('invalid-grid', 'grid', `grid.rows and grid.columns must be whole numbers from 1 to ${WAFFLE_MAX_GRID_SIDE}`,
      'Set grid to { rows: 10, columns: 10 }.', undefined, ['options', 'grid']);
  }
  const cellCount = grid.rows * grid.columns;
  const cellShare = 100 / cellCount;

  // ---- normalize: categories are panels, series are segments ----
  if (!data || !Array.isArray(data.categories) || data.categories.length === 0) {
    throw new NormalizeError('empty-data', 'categories', 'waffle requires at least one category');
  }
  if (!Array.isArray(data.series) || data.series.length === 0) {
    throw new NormalizeError('empty-data', 'series', 'waffle requires at least one series');
  }
  const cats: Category[] = data.categories.map((c, i) => normalizeCategory(c as never, i));
  const series = data.series.map((s, si) => {
    if (!s.id) throw new NormalizeError('missing-id', `series[${si}]`, 'series requires an id');
    return { ser: s, label: s.label ?? s.id, cells: normalizeSeriesValues(s, cats, si) };
  });
  const square = (options.variant ?? 'cells') === 'square';
  const refuse = (code: string, key: string, message: string, suggest: string): never => {
    throw new NormalizeError(code, key, message, suggest, undefined, ['options', key]);
  };
  if (square) {
    // The request fills in the 10 × 10 default grid, so only another grid is an authored one.
    if (grid.rows !== DEFAULT_GRID.rows || grid.columns !== DEFAULT_GRID.columns) refuse('waffle-square-grid', 'grid', "variant 'square' draws no cells, so it takes no grid", "Remove grid, or set variant: 'cells'.");
    if (series.length !== 1) {
      refuse('waffle-square-one-series', 'variant', `variant 'square' draws one share per panel; this chart has ${series.length} series`,
        "Send one series, or use variant: 'cells' for stacked segments: a nested second square reads as an L-shape, not as its share.");
    }
  } else {
    if (options.reference !== undefined) refuse('waffle-square-only', 'reference', "reference is drawn by variant 'square' only", "Set variant: 'square', or remove reference.");
    if (options.arrows) refuse('waffle-square-only', 'arrows', "arrows are drawn by variant 'square' only", "Set variant: 'square', or remove arrows.");
  }
  // Subtotal: the sum of the first segments of one cells panel.
  const subtotal = options.subtotal;
  if (subtotal) {
    if (square) refuse('waffle-subtotal-cells-only', 'subtotal', "subtotal is drawn by variant 'cells' only", "Set variant: 'cells', or remove subtotal.");
    if (cats.length !== 1) refuse('waffle-subtotal-one-panel', 'subtotal', `subtotal sums the segments of one panel; this chart has ${cats.length} panels`, 'Send one category, or remove subtotal.');
    const at = subtotal.series.map((id) => series.findIndex((s) => s.ser.id === id));
    const unknown = subtotal.series.find((_, k) => at[k]! < 0);
    if (unknown !== undefined) refuse('waffle-subtotal-unknown-series', 'subtotal', `subtotal names '${unknown}', which is not a series`, 'Name series ids in subtotal.series.');
    if ([...at].sort((a, b) => a - b).some((index, k) => index !== k)) {
      refuse('waffle-subtotal-not-first', 'subtotal', 'subtotal.series must name the first series and the ones right after it, each once', 'List the first series in series order.');
    }
  }
  // Panel groups: contiguous runs of panels, each panel in at most one.
  const groups = options.panelGroups ?? [];
  const groupOf: (number | undefined)[] = cats.map(() => undefined);
  groups.forEach((group, gi) => {
    if (groups.findIndex((other) => other.id === group.id) !== gi) refuse('waffle-group-duplicate-id', 'panelGroups', `duplicate panel group id '${group.id}'`, 'Give each panel group its own id.');
    const at = group.panels.map((id) => cats.findIndex((cat) => cat.id === id));
    const unknown = group.panels.find((_, k) => at[k]! < 0);
    if (unknown !== undefined) refuse('waffle-group-unknown-panel', 'panelGroups', `panel group '${group.id}' names '${unknown}', which is not a category`, 'Name category ids in panels.');
    if (at.some((index, k) => index !== at[0]! + k)) refuse('waffle-group-not-contiguous', 'panelGroups', `the panels of group '${group.id}' are not contiguous in category order`, 'List adjacent categories in category order.');
    for (const index of at) {
      if (groupOf[index] !== undefined) refuse('waffle-group-overlap', 'panelGroups', `panel '${cats[index]!.id}' is in two panel groups`, 'Put each panel in one group at most.');
      groupOf[index] = gi;
    }
    if (group.colorRole && series.length > 1) refuse('waffle-group-color-one-series', 'panelGroups', `group '${group.id}' sets colorRole on a chart with ${series.length} series`, 'Send one series, or colour the series instead.');
  });
  const defaultFormat = (value: number): string => {
    const text = shareText(value, autoDecimals(value), options.locale?.language);
    return /^[<>]/.test(text) ? text : shareText(value, Math.max(autoDecimals(value), authoredDecimals(value)), options.locale?.language);
  };
  // An authored chart format holds every printed share to one scale and one decimal count (exampleSpec).
  const cellNumbers = series.flatMap((row) => row.cells.map(cellValue));
  // A cell's own format wins, then its series' format, then options.format (the pie rule).
  const formatFor = (seriesIndex: number, panelIndex: number, exact = true): ((value: number) => string) => {
    const example = cellMeta(series[seriesIndex]!.cells[panelIndex]!)?.format ?? series[seriesIndex]!.ser.format ?? options.format;
    if (!example) return exact ? defaultFormat : (value) => shareText(value, autoDecimals(value), options.locale?.language);
    const spec = exampleSpec(example, options.locale?.language, undefined, example === options.format ? cellNumbers : undefined);
    return (value) => {
      const rounded = roundedNumber(value, spec);
      if ((value > 0 && rounded === 0) || (value < 100 && rounded === 100)) return shareText(value, exact ? 1 : spec.decimals, options.locale?.language);
      // A rounded key must not claim a different share from the authored cells.
      return formatWithSpec(value, { ...spec, decimals: !exact || rounded === value ? spec.decimals : Math.max(spec.decimals, authoredDecimals(value)) });
    };
  };
  // The headline is a sum of all segments of a panel: it takes the format of the panel's first segment.
  const headlineFormat = (panelIndex: number) => formatFor(0, panelIndex, false);

  // ---- derive: whole cells per segment, by largest remainder ----
  const adjustments: RoundingAdjustment[] = [];
  const missingPanel: boolean[] = [];
  const panels: WafflePanelDerived[] = cats.map((cat, ci) => {
    const values = series.map((s, si) => {
      const value = cellValue(s.cells[ci]!);
      if (value !== null && !(value >= 0)) {
        throw new NormalizeError('negative-value', `series[${s.ser.id}].values[${ci}]`,
          `waffle value ${value} for '${cat.id}' is negative; a waffle fills part of one whole`,
          'Send values from 0 to 100, or use a bar chart for signed values.', undefined, ['data', 'series', si, 'values', ci]);
      }
      return value;
    });
    const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    if (total > 100 + WHOLE_TOLERANCE) {
      throw new NormalizeError('waffle-over-100', `categories[${cat.id}]`,
        `the values of '${cat.id}' add up to ${Math.round(total * 1e6) / 1e6}; one waffle holds at most 100`,
        "Lower the values so they add up to 100 or less. If the values are fractions, add valueKind: 'fraction'.");
    }
    const noValue = values.every((value) => value === null);
    missingPanel.push(noValue);
    if (noValue) {
      warnings.push({ code: 'waffle-missing-value', severity: 'info', message: `'${cat.id}' has no value, so its ${square ? 'square' : 'grid'} is empty and it prints no headline`, owner: { categoryId: cat.id } });
    }
    // Square mode draws no cells: every segment keeps zero cells and reads as its share.
    const { exact, whole } = square ? { exact: values.map(() => 0), whole: values.map(() => 0) } : allocateCells(values.map((value) => value ?? 0), cellCount);
    const segments = series.map((s, si) => {
      const value = values[si] ?? 0;
      if (!square && value > 0 && whole[si] === 0) {
        warnings.push({
          code: 'waffle-segment-no-cells', severity: 'warn',
          message: `'${s.label}' in '${cat.id}' is ${formatFor(si, ci)(value)}, under half a cell, so it draws no cells`,
          owner: { categoryId: cat.id, seriesId: s.ser.id },
          suggest: "use a finer grid, or add valueKind: 'fraction' if the values are fractions of 1",
        });
      }
      if (whole[si] !== Math.round(exact[si]! + 1e-9) && value > 0) {
        adjustments.push({
          whole: cat.label ?? cat.id, part: s.label, share: value,
          nearest: `${Math.round(exact[si]! + 1e-9)} of ${cellCount} cells`, printed: `${whole[si]} of ${cellCount} cells`,
        });
      }
      return {
        seriesId: s.ser.id, value, exactCells: exact[si]!, cells: whole[si]!,
        reading: values[si] === null ? chartString(options, 'noValue') : square ? chartString(options, 'waffleWholeReading', { v1: formatFor(si, ci)(value) }) : chartString(options, 'waffleCellsReading', { v1: formatFor(si, ci)(value), v2: whole[si], v3: cellCount }),
      };
    });
    return {
      categoryId: cat.id, label: cat.label ?? cat.id, total: Math.round(total * 1e9) / 1e9,
      filledCells: segments.reduce((sum, segment) => sum + segment.cells, 0), segments,
    };
  });
  const missing = (panel: WafflePanelDerived): boolean => missingPanel[panels.indexOf(panel)]!;

  // ---- reference: one share for every panel, from a panel or a number ----
  let reference: WaffleDerived['reference'];
  if (square && options.reference) {
    const ref = options.reference;
    if ((ref.categoryId === undefined) === (ref.value === undefined)) {
      refuse('waffle-reference-source', 'reference', 'reference takes exactly one of categoryId and value', 'Name the panel in categoryId, or give the share in value.');
    }
    if (ref.categoryId !== undefined) {
      const pi = panels.findIndex((panel) => panel.categoryId === ref.categoryId);
      if (pi < 0) refuse('waffle-reference-unknown-panel', 'reference', `reference names '${ref.categoryId}', which is not a category`, 'Name a category id in reference.categoryId.');
      if (missingPanel[pi]) refuse('waffle-reference-no-value', 'reference', `the reference panel '${ref.categoryId}' has no value`, 'Name a panel with a value, or give reference.value.');
      const value = panels[pi]!.total;
      if (!(value > 0)) refuse('waffle-reference-zero', 'reference', `the reference panel '${ref.categoryId}' is 0%, so it has no square to outline`, 'Name a panel with a share above 0, or remove reference.');
      reference = { value, label: ref.label ?? `${panels[pi]!.label} ${headlineFormat(pi)(value)}`, categoryId: ref.categoryId };
    } else {
      const value = ref.value!;
      if (value === 0) refuse('waffle-reference-zero', 'reference', 'reference value 0 has no square to outline', 'Give a reference share above 0, or remove reference.');
      if (!(value > 0 && value <= 100)) refuse('waffle-reference-out-of-range', 'reference', `reference value ${value} is outside 0 to 100`, 'Give the reference share in percent, above 0 and up to 100.');
      // A bare share does not say what it stands for: a number reference names itself.
      if (ref.label === undefined) refuse('waffle-reference-label-required', 'reference', 'a reference given as a value needs a label that says what it stands for', "Add reference.label, such as 'Headcount 6%', or name the panel in reference.categoryId.");
      reference = { value, label: ref.label! };
    }
  }

  // ---- paints: the first series takes the first palette colour; the rest of the panel is the others ground ----
  const paints: Paint[] = series.map(({ ser }, si) =>
    ser.fill ? { css: ser.fill } : ser.colorRole ? markRolePaint(ser.colorRole, true) : seriesPaint(si, palette ? options.palette : undefined));
  // Rest cells carry no outline (a field of boxed cells draws the eye to the empty part). The Others
  // fill deepens toward the mark ink (lightens on a dark page) just past the mark floor instead; a fill that clears it stays.
  const restPaint: Paint = surfaceFloorPaint({ token: 'othersMark' }, []);
  // A panel group's colour role wins over the series colour for its panels.
  const panelPaint = (pi: number, si: number): Paint => {
    const role = groupOf[pi] === undefined ? undefined : groups[groupOf[pi]!]!.colorRole;
    return role ? markRolePaint(role, true) : paints[si]!;
  };
  const referenceGround = (pi: number): Paint => panels[pi]!.segments[0]!.value > reference!.value
    ? panelPaint(pi, 0) : mixedPaint(panelPaint(pi, 0), { token: 'background' }, PALE_SQUARE);
  const referencePanel = Math.max(0, panels.findIndex((panel) => panel.categoryId !== reference?.categoryId));

  const valueText = (si: number, pi: number) => cellValue(series[si]!.cells[pi]!) === null
    ? theme.table?.glyphs?.missing ?? '–' : formatFor(si, pi)(panels[pi]!.segments[si]!.value);
  // The computed rest has no series format of its own: it takes the chart format, or the default.
  const restSpec = options.format ? exampleSpec(options.format, options.locale?.language, undefined, cellNumbers) : undefined;
  // As a series format: a rounded rest must not claim a different share from its cells.
  const restFormat = (value: number): string => {
    if (!restSpec) return defaultFormat(value);
    const rounded = roundedNumber(value, restSpec);
    if ((value > 0 && rounded === 0) || (value < 100 && rounded === 100)) return defaultFormat(value);
    return formatWithSpec(value, { ...restSpec, decimals: rounded === value ? restSpec.decimals : Math.max(restSpec.decimals, authoredDecimals(value)) });
  };
  const restText = (pi: number) => series.some((series) => cellValue(series.cells[pi]!) === null)
    ? theme.table?.glyphs?.missing ?? '–' : restFormat(Math.round((100 - panels[pi]!.total) * 1e9) / 1e9);
  const subtotalCount = subtotal?.series.length ?? 0;
  const subtotalText = !subtotal ? '' : series.slice(0, subtotalCount).some((s) => cellValue(s.cells[0]!) === null)
    ? theme.table?.glyphs?.missing ?? '–' : formatFor(0, 0)(Math.round(panels[0]!.segments.slice(0, subtotalCount).reduce((sum, segment) => sum + segment.value, 0) * 1e9) / 1e9);

  // ---- frame; the key names the segments, so it shows with more than one ----
  const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const margin = { ...canvasMargin(theme, size.width), ...options.margin };
  const items: LegendItemInput[] = (series.length > 1 ? series : []).map(({ ser, label }, si) => ({
    id: ser.id, label: !lean && panels.length === 1 && series.length > 1 ? `${label} ${valueText(si, 0)}` : label, paint: paints[si]!,
  }));
  const hasRest = !square && panels.some((panel) => panel.filledCells < cellCount);
  let restId = '__rest';
  while (series.some(({ ser }) => ser.id === restId)) restId = `_${restId}`;
  let referenceId = '__reference';
  while (series.some(({ ser }) => ser.id === referenceId)) referenceId = `_${referenceId}`;
  if (!lean && hasRest && series.length > 1) items.push({ id: restId, label: panels.length === 1 ? `${options.strings?.others ?? strings.others} ${restText(0)}` : options.strings?.others ?? strings.others, paint: restPaint });
  // Lean: the reference label goes to the notes, where a full frame counts it.
  const referenceNote = !!reference && (lean || options.legend === 'none');
  // The key swatch shows the outline corner on the pale ground of the first panel that draws it there,
  // so the key ink is a drawn outline's ink (under the notation theme the first panel's pale ground could
  // otherwise take a dark ink no outline draws). With every outline inside a solid square, the key still
  // shows a pale ground with the dark outline: white dashes on the solid square are barely visible in the key.
  const paleOutlined = reference ? panels.findIndex((panel) => panel.categoryId !== reference!.categoryId && panel.segments[0]!.value <= reference!.value) : -1;
  const referenceKeyGround = reference
    ? mixedPaint(panelPaint(paleOutlined >= 0 ? paleOutlined : referencePanel, 0), { token: 'background' }, PALE_SQUARE)
    : undefined;
  if (reference && !referenceNote) items.push({ id: referenceId, label: chartString(options, 'referenceKey', { label: reference.label }), paint: contrastInkPaint(referenceKeyGround!), key: 'line', width: strokeToken(theme, 'rule'), dash: dashToken(theme, 'reference') });
  const authoredKey = options.legend !== undefined && options.legend !== 'none' && options.legend !== 'auto';
  // The key shows the series colour; group colours would leave it wrong.
  if (authoredKey && groups.some((group) => group.colorRole)) {
    refuse('waffle-group-color-legend', 'legend', 'panelGroups colour the panels by group, but the key shows the series colour', 'Remove legend (the group captions name the groups), or remove colorRole from panelGroups.');
  }
  let legend: FrameInput['legend'] = series.length > 1
    ? { options: legendRequired(options.legend, warnings, 'waffle', theme, 'the segments are named only by their colours'), items }
    : items.length > 0 ? { options: normalizeLegendOption(options.legend, { position: reference ? 'top' : 'bottom' }) ?? { position: 'bottom' }, items } : undefined;
  if (groups.some((group) => group.colorRole) && legend) legend.items = items.filter((item) => (hasRest && item.id === restId) || (reference && item.id === referenceId));
  // Up to two decimals, no trailing zeros: 5%, 2.5%, 4.76%.
  const rounded = Math.round(cellShare * 100) / 100;
  const shareDecimals = Number.isInteger(rounded) ? 0 : Number.isInteger(rounded * 10) ? 1 : 2;
  // The share of one cell, named when it is not 1% (the 10 × 10 default needs no note).
  const cellNote = (options.cellNote ?? 'auto') === 'auto' && Math.abs(cellShare - 1) > 1e-9
    ? [disclosureNote((options.strings?.cellNote ?? 'One cell = {value}').replace('{value}', formatAutomaticPercent(cellShare, shareDecimals, false, options.locale?.language)))] : [];
  // Use spare width beside a single grid only when the key fits there; authored positions stay.
  const labelFont = eyebrowFont(theme, textScaleOf(options));
  const keyFont: FontSpec = { family: theme.type.family, ...theme.type.label };
  // One panel with several segments: the readout (value and name of each segment and of the rest, and the
  // subtotal) replaces the frame key, beside the grid when it fits there and under it otherwise. Authored positions stay.
  const readout = !lean && !square && panels.length === 1 && series.length > 1 && !authoredKey && !!legend;
  if (readout) legend = undefined;
  const subtotalNotes = subtotal && !readout ? [disclosureNote(`${subtotalText} ${subtotal.label}`)] : [];
  const measureInFrame = !lean && panels.length === 1 && !options.subtitle && panels[0]!.label !== '';
  const referenceNotes = referenceNote ? [lean ? engineNote(reference!.label, 'note') : disclosureNote(reference!.label)] : [];
  // A fixed frame that hands its source line to the host (COMPACT_SOURCE_LINES 0) has no row for a
  // "+1 note" pointer either: the reference note stays in the notes list, and a static footer prints it.
  const pointerOff = lean && referenceNote && (options as CompactSourceOptions)[COMPACT_SOURCE_LINES] === 0 && authoredNotes(options).length === 0;
  const frame = solveFrame({ size, margin, ...frameTextOptions(options), ...(measureInFrame ? { subtitle: { measure: panels[0]!.label } } : {}), ...(referenceNote ? { footnotesOff: false } : {}), ...(pointerOff ? { notes: { ...options.notes, pointer: false } } : {}), footnotes: [...authoredNotes(options), ...cellNote, ...referenceNotes, ...subtotalNotes], legend, theme, measure }, occupied);
  // The contrast stroke needs the mark's ground to stay readable in its key.
  const referenceKey = frame.legend?.items.find((item) => item.id === referenceId);
  const referenceSwatch = frame.nodes.find((node) => node.id === referenceKey?.swatchNodeId);
  if (reference && referenceSwatch?.t === 'line') {
    // The swatch is a small panel: the pale ground and the dashed corner of the outline (bottom fill: top and right edges).
    const at = frame.nodes.indexOf(referenceSwatch);
    const x = referenceSwatch.x1, top = referenceSwatch.y1 - 5.5, r = 10;
    const d = fillFrom === 'bottom' ? `M${round2(x + 0.5)} ${round2(top + 0.5)}H${round2(x + r + 0.5)}V${round2(top + 11)}` : `M${round2(x + r + 0.5)} ${round2(top)}V${round2(top + r + 0.5)}H${round2(x + 0.5)}`;
    frame.nodes.splice(at, 1,
      { t: 'rect', id: `${referenceSwatch.id}:ground`, rect: { x, y: top, w: 16, h: 11 }, fill: referenceKeyGround!, owner: {}, part: 'legendGround' },
      { t: 'path', id: referenceSwatch.id, d, stroke: referenceSwatch.stroke, width: referenceSwatch.width, dash: referenceSwatch.dash, owner: referenceSwatch.owner, part: referenceSwatch.part });
  }
  const plot = frame.plot;

  // ---- panel columns, text blocks, one grid top ----
  const space = spaceTokens(theme, size.width);
  const arrows = square && options.arrows === true;
  const n = panels.length;
  const fullGutter = arrows ? Math.max(space.margin.left, ARROW_GUTTER) : space.margin.left;
  // Square mode on a narrow card: a 10 px gap when the full gap leaves panels under the cell floor.
  const gutter = square && !arrows && n > 1 && (plot.w - (n - 1) * fullGutter) / n < grid.columns * MIN_PITCH ? COMPACT_GUTTER : fullGutter;
  const figure = figureRole(theme);
  // Several panels print panel numbers (22/18 px on a report); one panel keeps the hero size.
  const hero = n > 1
    ? panelHeroSizesPx(target, theme.type.title.size, size.width, textScaleOf(options))
    : kpiHeroSizesPx(target, theme.type.title.size, textScaleOf(options));
  const heroBase = (options as WaffleOptions & { [KPI_VALUE_SIZE]?: number })[KPI_VALUE_SIZE] ?? hero.preferred;
  // Only an authored height pins: trial heights of a width-only request do not.
  const pinnedH = !heightOmitted(options.size) && (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height !== false;
  // One panel with one series on a pinned slot: the value and the panel label stand beside the filled cells
  // when that gives the grid a clearly larger cell than the value and label above it do.
  const sideValueText = !lean && !square && n === 1 && series.length === 1 && !subtotal && pinnedH && options.heightFill !== 'none' && options.headline !== 'none' && !missing(panels[0]!)
    ? headlineFormat(0)(panels[0]!.total) : undefined;
  const sideValueFont: FontSpec = { family: figure.family, size: heroBase, weight: figure.weight, lineHeight: 1.2 };
  // With no subtitle the frame names the panel; otherwise the label stands under the value.
  const sideLabelText = measureInFrame ? '' : panels[0]!.label;
  const sideValueW = sideValueText === undefined ? 0 : measure(sideValueText, sideValueFont).width;
  const sideLabelWrap = wrapText(sideLabelText, labelFont, Math.max(sideValueW, VALUE_SIDE_LABEL_EMS * labelFont.size), 3, measure);
  const sideLabelLines = sideLabelText === '' ? [] : sideLabelWrap.lines;
  const sideTextW = Math.max(sideValueW, ...sideLabelLines.map((line) => measure(line, labelFont).width));
  const sideValueH = measure('0', sideValueFont).height;
  const sideLabelH = sideLabelLines.length === 0 ? 0 : measure('0', labelFont).height + (sideLabelLines.length - 1) * labelFont.size * (labelFont.lineHeight ?? 1.2);
  const stackedTopH = (sideLabelLines.length === 0 ? 0 : measure('0', labelFont).height + space.gapTitleSubtitle) + sideValueH + space.gapSubtitlePlot;
  const sidePanelW = plot.w - VALUE_SIDE_GAP - sideTextW;
  const sideValuePitch = Math.min(sidePanelW / grid.columns, plot.h / grid.rows);
  const valueSide = sideValueText !== undefined && sideValuePitch >= MIN_PITCH
    && sideValuePitch > VALUE_SIDE_GAIN * Math.min(plot.w / grid.columns, (plot.h - stackedTopH) / grid.rows);
  const labelTexts = panels.map((panel) => (measureInFrame || valueSide ? '' : panel.label));
  // The widest word of each label: a label wraps between words and never cuts one.
  const longestWord = labelTexts.map((text) => Math.max(0, ...text.split(/\s+/).filter(Boolean).map((word) => measure(word, labelFont).width)));
  const rowsFor = (maxColumns: number): number[][] => {
    const rows: number[][] = [[]];
    for (let pi = 0; pi < n; pi++) {
      let row = rows[rows.length - 1]!;
      const gi = groupOf[pi];
      const groupLength = gi === undefined ? 1 : groups[gi]!.panels.length;
      const groupStarts = gi !== undefined && groups[gi]!.panels[0] === cats[pi]!.id;
      if (row.length === maxColumns || (groupStarts && groupLength <= maxColumns && row.length + groupLength > maxColumns)) {
        row = []; rows.push(row);
      }
      row.push(pi);
    }
    return rows;
  };
  // The gap between panel columns. A wrapped form with narrow panels spreads its columns over the plot (below).
  let colGap = gutter;
  // A square panel label may run into the gap after it, but not past the plot.
  const labelRoom = (rows: number[][], pi: number, w: number): number => square && !rows.some((row) => row[row.length - 1] === pi) ? w + colGap - LABEL_CLEAR : w;
  // Both modes wrap to at most two rows, groups kept together, when a label word is wider than its room;
  // square mode also wraps when one row leaves a panel under the floor.
  // The floor is that of the two-row form, so it does not depend on the width asked for.
  const minColumns = oneRow && !square ? n : Math.min(n, Math.max(Math.ceil(n / 2), maxOf(groups.map((group) => group.panels.length))));
  let panelRows = rowsFor(n);
  for (let c = n; c >= minColumns; c--) {
    panelRows = rowsFor(c);
    const cols = maxOf(panelRows.map((row) => row.length));
    const w = (plot.w - (cols - 1) * gutter) / cols;
    if ((!square || w >= SQUARE_MIN_SIDE) && panels.every((_, pi) => longestWord[pi]! <= labelRoom(panelRows, pi, w))) break;
  }
  // Two rows split evenly: 4 + 4 or 3 + 2, never 7 + 1 or 4 + 1.
  if (panelRows.length > 1) {
    const even = rowsFor(Math.max(minColumns, Math.ceil(n / panelRows.length)));
    if (even.length === panelRows.length) panelRows = even;
  }
  const columns = maxOf(panelRows.map((row) => row.length));
  const lineH = (font: FontSpec): number => font.size * (font.lineHeight ?? 1.2);
  // ---- readout: entries, fonts and the form (beside or under the grid) ----
  const others = options.strings?.others ?? strings.others;
  const entries = readout ? [
    ...series.map((s, si) => ({ id: s.ser.id, value: valueText(si, 0), name: s.label, paint: paints[si]!, seriesId: s.ser.id as Id | undefined })),
    ...(hasRest ? [{ id: restId, value: restText(0), name: others, paint: restPaint, seriesId: undefined as Id | undefined }] : []),
  ] : [];
  const valueFont: FontSpec = { ...keyFont, weight: 700 };
  const subValueFont: FontSpec = { family: figure.family, weight: figure.weight, size: Math.round(theme.type.title.size * 1.1) };
  const valueCol = Math.max(0, maxOf(entries.map((entry) => measure(entry.value, valueFont).width))) + 8;
  const nameW = Math.max(0, maxOf(entries.map((entry) => measure(entry.name, keyFont).width)));
  const entryW = 16 + valueCol + nameW;
  const entryStep = Math.max(lineH(valueFont), lineH(keyFont)) + 4;
  const subValueW = subtotal ? measure(subtotalText, subValueFont).width : 0;
  const subLabelW = subtotal ? measure(subtotal.label, keyFont).width : 0;
  const subLineH = subtotal ? measure('0', subValueFont).height : 0;
  // Beside: tick, swatch, value, name, then the bracket and the subtotal.
  const readoutSideW = 20 + entryW + (subtotal ? 24 + 18 + Math.max(subValueW, subLabelW) : 0);
  // Under the grid: two columns when two entries fit side by side, then a rule and the subtotal on one line.
  const underColumns = 2 * entryW + 16 <= plot.w && entries.length > 1 ? 2 : 1;
  const subRowH = subtotal ? 8 + 10 + subLineH : 0;
  const underH = space.gapSubtitlePlot + Math.ceil(entries.length / underColumns) * entryStep + subRowH;
  // Beside when the grid keeps SIDE_MIN_PITCH there; a pinned height also keeps it beside when the grid is larger so.
  const sidePitch = (plot.w - readoutSideW) / grid.columns;
  const readoutSide = readout && sidePitch >= MIN_PITCH && (sidePitch >= SIDE_MIN_PITCH
    || (pinnedH && Math.min(plot.w / grid.columns, (plot.h - underH) / grid.rows) < Math.min(sidePitch, plot.h / grid.rows)));
  const keyColumns = readout && !readoutSide ? underColumns : 0;
  const keyRows = keyColumns > 0 ? Math.ceil(entries.length / keyColumns) : 0;
  const bottomReadoutH = keyColumns > 0 ? underH : 0;
  const columnW = (plot.w - (columns - 1) * gutter) / columns;
  // The two-row form keeps its panels as small as the one row
  // would draw them. A panel is as wide as its widest label word and its headline need,
  // not the whole column, so the second row does not double the chart's height.
  const wrappedW = (): number => {
    const isLast = (pi: number) => panelRows.some((row) => row[row.length - 1] === pi);
    const wordNeed = Math.max(0, maxOf(panels.map((_, pi) => longestWord[pi]! - (!square || isLast(pi) ? 0 : gutter - LABEL_CLEAR))));
    const heroFont: FontSpec = { family: figure.family, size: heroBase, weight: figure.weight };
    const heroNeed = Math.max(0, maxOf(panels.map((panel, pi) => missing(panel) ? 0 : measure(headlineFormat(pi)(panel.total), heroFont).width))) / (square ? HEADLINE_SHARE : 1);
    return Math.min(columnW, Math.max(square ? SQUARE_MIN_SIDE : grid.columns * MIN_PITCH, Math.ceil(wordNeed), Math.ceil(heroNeed)));
  };
  const panelW = Math.max(1, readoutSide ? plot.w - readoutSideW : valueSide ? sidePanelW
    : !lean && panelRows.length > 1 && series.length === 1 ? wrappedW() : columnW);
  // Narrow panels in wrapped rows spread their columns over the full plot width.
  if (panelW < columnW && columns > 1) colGap = (plot.w - columns * panelW) / (columns - 1);
  const positions = panels.map((_, pi) => {
    const row = panelRows.findIndex((row) => row.includes(pi));
    return { row, x: plot.x + panelRows[row]!.indexOf(pi) * (panelW + colGap) };
  });
  const labelW = panels.map((_, pi) => labelRoom(panelRows, pi, panelW));
  const wrapped = labelTexts.map((text, pi) => wrapText(text, labelFont, labelW[pi]!, 6, measure));
  const labelLines = Math.max(0, maxOf(wrapped.map((w, i) => (labelTexts[i] === '' ? 0 : w.lines.length))));
  const labelBlockH = labelLines === 0 ? 0 : measure('0', labelFont).height + (labelLines - 1) * lineH(labelFont);
  // Group captions, centred under each group's panels.
  const captionFont: FontSpec = { family: theme.type.family, ...theme.type.label };
  const groupSpans = groups.flatMap((group) => panelRows.flatMap((row, ri) => {
    const members = row.filter((pi) => group.panels.includes(cats[pi]!.id));
    if (!members.length) return [];
    const x = positions[members[0]!]!.x;
    const w = members.length * panelW + (members.length - 1) * colGap;
    return [{ group, row: ri, x, w, wrap: group.label ? wrapText(group.label, captionFont, w, 20, measure) : undefined }];
  }));
  const captionLines = Math.max(0, maxOf(groupSpans.map((span) => span.wrap?.lines.length ?? 0)));
  const captionH = captionLines === 0 ? 0 : measure('0', captionFont).height + (captionLines - 1) * lineH(captionFont);
  // The gap from the headlines to the caption; it holds the group rule. A lean pass keeps the default spacing.
  // The rule sits 8 px under the headline baseline.
  const captionGap = lean ? space.gapSubtitlePlot : square ? SQUARE_CAPTION_GAP : 15;
  const panelValueLines = panels.map((panel, pi) => [
    ...panel.segments.map((_, si) => `${series[si]!.label} ${valueText(si, pi)}`),
    ...(hasRest ? [`${options.strings?.others ?? strings.others} ${restText(pi)}`] : []),
  ]);
  const valueStep = Math.max(lineH(keyFont), maxOf(panelValueLines.flatMap((lines) => lines.map((text) => measure(text, keyFont).height + 4))));
  const preferredValuesH = series.length > 1 && n > 1 ? (series.length + (hasRest ? 1 : 0)) * valueStep + space.gapSubtitlePlot : 0;
  // Wrapped panels repeat the label block, caption and value rows in every row, so the cell floor counts every row.
  const rowCount = panelRows.length;
  const valuesFit = heightOmitted(options.size) || plot.h - (rowCount - 1) * gutter - rowCount * (labelBlockH + (labelBlockH > 0 ? space.gapSubtitlePlot : 0)
    + (captionH > 0 ? captionGap + captionH : 0) + preferredValuesH) >= rowCount * grid.rows * MIN_PITCH;
  // A pinned chart keeps the panel total when the segment readout has to give way.
  // A lean pass prints the panel total: the key then carries no values.
  const showHeadline = options.headline === 'value' || (options.headline !== 'none' && (lean || series.length === 1 || !valuesFit));
  const headlineValues = panels.map((panel, pi) => missing(panel) ? undefined : headlineFormat(pi)(panel.total));
  // Total names the sum when it fits; the numeric value alone sets the width floor.
  const headlineTexts = headlineValues.map((value) => {
    if (value === undefined || series.length === 1) return value;
    const named = `${options.strings?.total ?? strings.total} ${value}`;
    return measure(named, { family: figure.family, size: hero.minimum, weight: figure.weight }).width <= panelW ? named : value;
  });
  // One headline size for every panel: the preferred hero size, stepped down until the widest text fits.
  const widest = (font: FontSpec): number => Math.max(0, maxOf(headlineTexts.map((text) => (text === undefined ? 0 : measure(text, font).width))));
  let headlineFont: FontSpec = { family: figure.family, size: heroBase, weight: figure.weight, lineHeight: 1.2 };
  // Square mode keeps air between the headlines of adjacent panels: a headline takes at most HEADLINE_SHARE of its panel.
  const headlineRoom = square && n > 1 ? panelW * HEADLINE_SHARE : panelW;
  while (showHeadline && headlineFont.size > hero.minimum && widest(headlineFont) > headlineRoom) {
    headlineFont = { ...headlineFont, size: Math.max(hero.minimum, headlineFont.size - 0.5) };
  }
  const headlineH = !valueSide && showHeadline && headlineTexts.some((text) => text !== undefined) ? measure('0', headlineFont).height : 0;
  // Square mode prints the headline under the panel, left-aligned with the solid square (the share-squares look).
  const aboveH = square ? 0 : headlineH;
  const gapLabelHeadline = labelBlockH > 0 && aboveH > 0 ? space.gapTitleSubtitle : 0;
  // Square mode: 10 px from the last label baseline to the square, 8 px from the square to the headline.
  const gapGrid = labelBlockH + aboveH > 0 ? (square && !lean ? SQUARE_LABEL_GAP : space.gapSubtitlePlot) : 0;
  const gridTop = plot.y + labelBlockH + gapLabelHeadline + aboveH + gapGrid;
  const topBlockH = gridTop - plot.y;
  // Wrapped square rows: each row takes the label and caption lines
  // it holds, not those of the tallest row. One row keeps the shared blocks.
  const rowLabelH = panelRows.map((row) => {
    const lines = Math.max(0, maxOf(row.map((pi) => (labelTexts[pi] === '' ? 0 : wrapped[pi]!.lines.length))));
    return panelRows.length === 1 || lines === 0 ? labelBlockH : measure('0', labelFont).height + (lines - 1) * lineH(labelFont);
  });
  const rowCaptionH = panelRows.map((_, ri) => {
    const lines = Math.max(0, maxOf(groupSpans.filter((span) => span.row === ri).map((span) => span.wrap?.lines.length ?? 0)));
    return panelRows.length === 1 ? captionH : lines === 0 ? 0 : measure('0', captionFont).height + (lines - 1) * lineH(captionFont);
  });
  const rowTopH = rowLabelH.map((h) => topBlockH - labelBlockH + h);
  const gapBelow = square && !lean ? SQUARE_HEADLINE_GAP : space.gapSubtitlePlot;
  const belowH = square && headlineH > 0 ? gapBelow + headlineH : 0;
  const requiredBottomH = belowH + (captionH > 0 ? captionGap + captionH : 0) + bottomReadoutH;
  // Pinned charts keep the readable grid before the optional value rows.
  const rowRequiredBottomH = rowCaptionH.map((h) => requiredBottomH - (captionH > 0 ? captionGap + captionH : 0) + (h > 0 ? captionGap + h : 0));
  const blocksH = (bottom: readonly number[]): number => rowTopH.reduce((sum, top, ri) => sum + top + bottom[ri]!, 0);
  const valuesH = !heightOmitted(options.size) && plot.h - (rowCount - 1) * gutter - blocksH(rowRequiredBottomH) - rowCount * preferredValuesH < rowCount * grid.rows * MIN_PITCH ? 0 : preferredValuesH;
  const rowBottomH = rowRequiredBottomH.map((h) => h + valuesH);
  // Square mode sizes the panel as a 10 × 10 grid without gaps, so its floor and natural size match the cells mode.
  const pitch = Math.max(1, Math.min(panelW / grid.columns, ((plot.h - (panelRows.length - 1) * gutter - blocksH(rowBottomH)) / panelRows.length) / grid.rows));
  const gap = square ? 0 : Math.min(readout || valueSide ? READOUT_GAP : 4, Math.max(1, Math.round(pitch * 0.1)));
  const side = pitch - gap;
  const gridW = round2(grid.columns * pitch - gap);
  const gridH = round2(grid.rows * pitch - gap);
  const frameH = size.height - plot.h;
  // The readout under the grid lets the grid take the full width; beside it, the grid grows to SIDE_NATURAL_PITCH.
  const naturalPitch = keyColumns > 0 ? panelW / grid.columns : Math.min(panelW / grid.columns, readoutSide || valueSide ? SIDE_NATURAL_PITCH : NATURAL_PITCH);
  const keyH = readoutSide ? Math.max(entries.length * entryStep, subLineH + 4 + lineH(keyFont)) : valueSide ? sideValueH + sideLabelH : 0;
  const naturalHeight = Math.ceil(frameH + Math.max(blocksH(rowBottomH) + panelRows.length * naturalPitch * grid.rows + (panelRows.length - 1) * gutter, topBlockH + keyH) - 1e-6);
  const rowY = panelRows.map((_, ri) => plot.y + rowTopH.slice(0, ri).reduce((sum, top, rj) => sum + top + gridH + rowBottomH[rj]! + gutter, 0));
  const rowGridTop = (ri: number): number => rowY[ri]! + rowTopH[ri]!;
  if (square ? pitch * grid.columns < SQUARE_MIN_SIDE : pitch < MIN_PITCH) {
    warnings.push({
      code: 'waffle-cells-small', severity: 'warn',
      message: square ? `panels are ${Math.round(pitch * grid.columns)}px wide, under the ${SQUARE_MIN_SIDE}px a square reads at` : `cells are ${Math.round(pitch * 10) / 10}px wide, under the ${MIN_PITCH}px a cell reads at`,
      suggest: 'give the chart more width or height, drop a panel, or use a coarser grid',
    });
  }

  // ---- marks: one path per segment and one for the empty cells ----
  const nodes: SceneNode[] = [...frame.nodes];
  const referenceSide = reference ? gridW * Math.sqrt(reference.value / 100) : 0;
  const marks: WaffleMarks = { panels: [] };
  const requests: LabelRequest[] = [];
  const cellSquare = (col: number, row: number, x0: number, y0: number): string => {
    const x = round2(x0 + col * pitch);
    const y = round2(y0 + row * pitch);
    return `M${x} ${y}h${round2(side)}v${round2(side)}h${-round2(side)}z`;
  };
  panels.forEach((panel, pi) => {
    const x0 = positions[pi]!.x;
    const rect: Rect = { x: round2(x0), y: round2(rowGridTop(positions[pi]!.row)), w: gridW, h: gridH };
    const segmentMarks: WaffleMarks['panels'][number]['segments'] = [];
    if (square) {
      const squareMarks = drawSquarePanel(pi, x0, rect, segmentMarks);
      pushText(pi, x0, rect);
      marks.panels.push({ categoryId: panel.categoryId, rect, segments: segmentMarks, ...squareMarks });
      return;
    }
    occupied.claim(rect, 'mark', { categoryId: panel.categoryId });
    let next = 0;
    panel.segments.forEach((segment, si) => {
      if (segment.cells === 0) return;
      let d = '';
      for (let k = next; k < next + segment.cells; k++) {
        const { col, row } = cellAt(k, grid.columns, grid.rows, fillFrom);
        d += cellSquare(col, row, x0, rect.y);
      }
      next += segment.cells;
      const nodeId = `mark:${segment.seriesId}:${panel.categoryId}`;
      nodes.push({
        t: 'path', id: nodeId, d, fill: panelPaint(pi, si),
        owner: { seriesId: segment.seriesId, categoryId: panel.categoryId }, part: 'waffleSegment',
        display: { value: formatFor(si, pi)(segment.value) },
      });
      segmentMarks.push({ seriesId: segment.seriesId, nodeId, cells: segment.cells });
    });
    let restNodeId: Id | undefined;
    if (next < cellCount) {
      let d = '';
      for (let k = next; k < cellCount; k++) {
        const { col, row } = cellAt(k, grid.columns, grid.rows, fillFrom);
        d += cellSquare(col, row, x0, rect.y);
      }
      restNodeId = `mark:rest:${panel.categoryId}`;
      nodes.push({ t: 'path', id: restNodeId, d, fill: restPaint, owner: { categoryId: panel.categoryId, segmentId: 'rest' }, part: 'waffleRest' });
    }
    pushText(pi, x0, rect);
    marks.panels.push({ categoryId: panel.categoryId, rect, segments: segmentMarks, ...(restNodeId ? { restNodeId } : {}) });
  });
  // Wrapped rows keep the authored flow; the route stays in the row gap.
  if (arrows) {
    for (let pi = 0; pi + 1 < n; pi++) {
      const a = marks.panels[pi]!.rect, b = marks.panels[pi + 1]!.rect;
      const y = round2(referenceSide > 0 ? (fillFrom === 'bottom' ? a.y + a.h - referenceSide : a.y + referenceSide) : a.y + a.h / 2);
      const owner = { categoryId: panels[pi + 1]!.categoryId, segmentId: 'arrow' };
      const from = round2(a.x + a.w + 4);
      const tip = round2(b.x - 3);
      const targetY = round2(y + b.y - a.y);
      const shaft = arrowShaftEnd(ARROW_HEAD, strokeToken(theme, 'rule'));
      const d = a.y === b.y ? `M${from} ${y}H${round2(tip - shaft)}`
        : `M${from} ${y}H${round2(plot.x + plot.w + 6)}V${round2(b.y - rowTopH[positions[pi + 1]!.row]! - gutter / 2)}H${round2(plot.x - 8)}V${targetY}H${round2(tip - shaft)}`;
      nodes.push({ t: 'path', id: `mark:arrow:${panels[pi]!.categoryId}`, d, stroke: { token: 'ink' }, width: strokeToken(theme, 'rule'), owner, part: 'waffleArrow' });
      nodes.push({ t: 'path', id: `mark:arrowHead:${panels[pi]!.categoryId}`, d: arrowHeadPath({ x: tip, y: targetY }, 0, ARROW_HEAD), fill: { token: 'ink' }, owner, part: 'arrowHead' });
    }
  }
  // The reference label: named once in the key (or a note), so it takes no seat in the plot.
  if (reference && referenceSide > 0) {
    const font: FontSpec = { family: theme.type.family, ...theme.type.axis };
    requests.push({ id: 'reference', kind: 'annotation', owner: { segmentId: 'reference' }, text: reference.label, lines: [reference.label], font, typeRole: 'axis', priority: PRIORITY.reference, candidates: [] });
  }
  // Group captions, centred under the panels and their headlines.
  const captionTopOf = (ri: number): number => rowGridTop(ri) + gridH + belowH + valuesH + captionGap;
  for (const span of groupSpans) {
    if (!span.wrap) continue;
    const ruleY = captionTopOf(span.row) - 3;
    if (!lean) nodes.push({ t: 'path', id: `groupRule:${span.group.id}:${span.row}`, d: `M${round2(span.x)} ${round2(ruleY - 4)}V${round2(ruleY)}H${round2(span.x + span.w)}V${round2(ruleY - 4)}`, stroke: { token: 'inkMuted' }, width: strokeToken(theme, 'rule'), owner: { segmentId: span.group.id }, part: 'waffleGroupRule' });
    const w = Math.min(span.w, Math.max(...span.wrap.lines.map((line) => measure(line, captionFont).width)));
    requests.push({
      id: `group:${span.group.id}:${span.row}`, kind: 'annotation', owner: { segmentId: `group:${span.group.id}` }, text: span.group.label!, lines: span.wrap.lines,
      font: captionFont, typeRole: 'label', priority: PRIORITY.total, align: 'middle',
      ...(span.wrap.truncated ? { title: span.group.label } : {}),
      candidates: [{ slot: 'main', rect: { x: span.x + (span.w - w) / 2, y: captionTopOf(span.row), w, h: measure('0', captionFont).height + (span.wrap.lines.length - 1) * lineH(captionFont) }, penalty: 0 }],
    });
  }

  /** Square mode: the pale 100% square, the solid share square and the reference outline of one panel. */
  function drawSquarePanel(pi: number, x0: number, rect: Rect, segmentMarks: WaffleMarks['panels'][number]['segments']): Partial<WaffleMarks['panels'][number]> {
    const panel = panels[pi]!;
    const segment = panel.segments[0]!;
    const fill = panelPaint(pi, 0);
    const pale = mixedPaint(fill, { token: 'background' }, PALE_SQUARE);
    const box = (x: number, y: number, side: number): string => `M${round2(x)} ${round2(y)}h${round2(side)}v${round2(side)}h${-round2(side)}z`;
    const restNodeId = `mark:rest:${panel.categoryId}`;
    nodes.push({ t: 'path', id: restNodeId, d: box(x0, rect.y, rect.w), fill: pale, owner: { categoryId: panel.categoryId, segmentId: 'rest' }, part: 'waffleRest' });
    // Area is the share: side = sqrt(share) × panel side.
    const side = rect.w * Math.sqrt(segment.value / 100);
    let shareRect: Rect | undefined;
    if (side > 0) {
      shareRect = { x: round2(x0), y: round2(fillFrom === 'bottom' ? rect.y + rect.h - side : rect.y), w: round2(side), h: round2(side) };
      const nodeId = `mark:${segment.seriesId}:${panel.categoryId}`;
      nodes.push({
        t: 'path', id: nodeId, d: box(shareRect.x, shareRect.y, side), fill,
        owner: { seriesId: segment.seriesId, categoryId: panel.categoryId }, part: 'waffleSegment',
        display: { value: formatFor(0, pi)(segment.value) },
      });
      // Not claimed: the reference label may sit on the solid square, in the ink that reads on it.
      segmentMarks.push({ seriesId: segment.seriesId, nodeId, cells: 0 });
    }
    // The reference outline: its top and right edges (bottom fill), the other two lie on the panel's edges.
    let referenceNodeId: Id | undefined;
    if (referenceSide > 0 && reference!.categoryId !== panel.categoryId) {
      const r = referenceSide;
      const d = fillFrom === 'bottom'
        ? `M${round2(x0)} ${round2(rect.y + rect.h - r)}H${round2(x0 + r)}V${round2(rect.y + rect.h)}`
        : `M${round2(x0 + r)} ${round2(rect.y)}V${round2(rect.y + r)}H${round2(x0)}`;
      referenceNodeId = `mark:reference:${panel.categoryId}`;
      // Inside the solid square the dashes take the ink that reads on it; outside, the ink on the pale ground.
      nodes.push({ t: 'path', id: referenceNodeId, d, stroke: contrastInkPaint(referenceGround(pi)), width: strokeToken(theme, 'rule'), dash: dashToken(theme, 'reference'), owner: { categoryId: panel.categoryId, segmentId: 'reference' }, part: 'waffleReference' });
    }
    return { restNodeId, ...(shareRect ? { shareRect } : {}), ...(referenceNodeId ? { referenceNodeId } : {}) };
  }

  /** Label above the panel and the headline (above the grid; under the square in square mode). */
  function pushText(pi: number, x0: number, rect: Rect): void {
    const panel = panels[pi]!;
    // The label block has one height for every panel, so the grids share a top.
    if (labelBlockH > 0 && labelTexts[pi] !== '') {
      const w = wrapped[pi]!;
      requests.push({
        id: `category:${panel.categoryId}`, kind: 'category', owner: { categoryId: panel.categoryId },
        text: labelTexts[pi]!, lines: w.lines, font: labelFont, typeRole: 'label', priority: PRIORITY.total,
        ...(w.truncated ? { title: panel.label } : {}),
        candidates: [{ slot: 'main', rect: { x: x0, y: rowY[positions[pi]!.row]!, w: labelW[pi]!, h: measure('0', labelFont).height + (w.lines.length - 1) * lineH(labelFont) }, penalty: 0 }],
      });
    }
    const headline = headlineTexts[pi];
    if (headlineH > 0 && headline !== undefined) {
      const w = Math.min(panelW, measure(headline, headlineFont).width);
      requests.push({
        id: `total:${panel.categoryId}`, kind: 'total', owner: { categoryId: panel.categoryId },
        text: headline, lines: [headline], font: headlineFont, typeRole: n > 1 ? 'panelValue' : 'kpiValue', priority: PRIORITY.grandTotal,
        candidates: [{ slot: 'main', rect: { x: x0, y: square ? rect.y + rect.h + gapBelow : rowY[positions[pi]!.row]! + rowLabelH[positions[pi]!.row]! + gapLabelHeadline, w, h: headlineH }, penalty: 0 }],
      });
    }
  }
  if (!square && valuesH > 0) panels.forEach((panel, pi) => {
    const lines = panelValueLines[pi]!;
    lines.forEach((text, i) => {
      const value = series[i] ? valueText(i, pi) : restText(pi);
      const name = series[i]?.label ?? options.strings?.others ?? strings.others;
      const fitted = wrapText(name, keyFont, Math.max(1, panelW - measure(` ${value}`, keyFont).width), 1, measure);
      const line = `${fitted.lines[0]} ${value}`;
      requests.push({ id: `value:${panel.categoryId}:${i}`, kind: 'total', owner: { categoryId: panel.categoryId, ...(series[i] ? { seriesId: series[i]!.ser.id } : {}) }, text, lines: [line], ...(fitted.truncated ? { title: text } : {}), font: keyFont, typeRole: 'label', priority: PRIORITY.total, candidates: [{ slot: 'main', rect: { x: positions[pi]!.x, y: marks.panels[pi]!.rect.y + gridH + space.gapSubtitlePlot + i * valueStep, w: Math.min(panelW, measure(line, keyFont).width), h: measure(text, keyFont).height }, penalty: 0 }] });
    });
  });
  // ---- the one-panel readout ----
  const readoutLegend: NonNullable<Geometry<WaffleMarks, WaffleDerived>['legend']> | undefined = readout ? { rect: { x: 0, y: 0, w: 0, h: 0 }, items: [] } : undefined;
  if (readout) {
    const rect = marks.panels[0]!.rect;
    const rowMiddle = (row: number): number => rect.y + row * pitch + side / 2;
    // The top of a one-line label box whose baseline sits at `baseline`.
    const topAt = (baseline: number, font: FontSpec): number => baseline - font.size * TEXT_ASCENT;
    // The cells of each entry, in fill order: segments first, then the rest.
    let from = 0;
    const ranges = entries.map((_, i) => {
      const count = i < series.length ? panels[0]!.segments[i]!.cells : cellCount - from;
      const range = { from, to: from + count };
      from += count;
      return range;
    });
    const rowsOf = (range: { from: number; to: number }): number[] => {
      const counts = new Map<number, number>();
      for (let k = range.from; k < range.to; k++) { const { row } = cellAt(k, grid.columns, grid.rows, fillFrom); counts.set(row, (counts.get(row) ?? 0) + 1); }
      const most = Math.max(0, maxOf(counts.values()));
      return [...counts].filter(([, count]) => count === most).map(([row]) => row);
    };
    const place = (i: number, x: number, cy: number, tick: boolean): void => {
      const entry = entries[i]!;
      if (tick) nodes.push({ t: 'line', id: `keyTick:${entry.id}`, x1: round2(x - 16), y1: round2(cy), x2: round2(x - 4), y2: round2(cy), stroke: { token: 'leader' }, width: strokeToken(theme, 'hair'), owner: {}, part: 'leader' });
      nodes.push({ t: 'rect', id: `key:${entry.id}`, rect: { x: round2(x), y: round2(cy - 5), w: 10, h: 10 }, fill: entry.paint, owner: {}, part: 'legendSwatch' });
      const owner = entry.seriesId !== undefined ? { seriesId: entry.seriesId } : {};
      // Value and name share one baseline, with their caps centred on the swatch.
      // (measure().height is the line box, not the glyph: it put the caps 3 px low.)
      const baseline = cy + (measure.capHeight?.(valueFont) ?? valueFont.size * 0.72) / 2;
      requests.push({ id: `keyValue:${entry.id}`, kind: 'annotation', owner, text: entry.value, lines: [entry.value], font: valueFont, typeRole: 'label', priority: PRIORITY.total, candidates: [{ slot: 'main', rect: { x: x + 16, y: topAt(baseline, valueFont), w: measure(entry.value, valueFont).width, h: valueFont.size }, penalty: 0 }] });
      requests.push({ id: `key:${entry.id}`, kind: 'annotation', owner, text: entry.name, lines: [entry.name], font: keyFont, typeRole: 'label', priority: PRIORITY.total, candidates: [{ slot: 'main', rect: { x: x + 16 + valueCol, y: topAt(baseline, keyFont), w: measure(entry.name, keyFont).width, h: keyFont.size }, penalty: 0 }] });
      readoutLegend!.items.push({ id: entry.id, swatchNodeId: `key:${entry.id}`, labelId: `label:key:${entry.id}` });
    };
    // The covered cells of the subtotal, and the rows they span.
    const coveredCells = panels[0]!.segments.slice(0, subtotalCount).reduce((sum, segment) => sum + segment.cells, 0);
    if (readoutSide) {
      // Each entry at the middle of the rows its cells fill most, moved apart just enough to read.
      const order = entries.map((_, i) => {
        const rows = rowsOf(ranges[i]!);
        return { i, y: rows.length ? rows.reduce((sum, row) => sum + rowMiddle(row), 0) / rows.length : rect.y + rect.h / 2 };
      }).sort((a, b) => a.y - b.y || b.i - a.i);
      for (let k = 1; k < order.length; k++) order[k]!.y = Math.max(order[k]!.y, order[k - 1]!.y + entryStep);
      const lowest = rect.y + rect.h - entryStep / 2;
      if (order.length) order[order.length - 1]!.y = Math.min(order[order.length - 1]!.y, lowest);
      for (let k = order.length - 2; k >= 0; k--) order[k]!.y = Math.min(order[k]!.y, order[k + 1]!.y - entryStep);
      const x = rect.x + rect.w + 20;
      for (const { i, y } of order) place(i, x, y, true);
      readoutLegend!.rect = { x: rect.x + rect.w + 4, y: rect.y, w: entryW + 16, h: rect.h };
      if (subtotal && coveredCells > 0) {
        const rows = Array.from({ length: coveredCells }, (_, k) => cellAt(k, grid.columns, grid.rows, fillFrom).row);
        const top = rect.y + minOf(rows) * pitch;
        const bottom = rect.y + (maxOf(rows) + 1) * pitch - gap;
        const bx = x + entryW + 24;
        nodes.push({ t: 'path', id: 'subtotal:bracket', d: `M${round2(bx)} ${round2(top)}H${round2(bx + 6)}V${round2(bottom)}H${round2(bx)}`, stroke: { token: 'ink' }, width: strokeToken(theme, 'rule'), owner: { segmentId: 'subtotal' }, part: 'waffleSubtotal' });
        // The sum's baseline just above the bracket middle, the label's one line below it.
        const valueBase = (top + bottom) / 2 + 2;
        const labelBase = valueBase + lineH(keyFont) + 2;
        requests.push({ id: 'subtotal:value', kind: 'total', owner: { segmentId: 'subtotal' }, text: subtotalText, lines: [subtotalText], font: subValueFont, typeRole: 'label', priority: PRIORITY.grandTotal, candidates: [{ slot: 'main', rect: { x: bx + 18, y: topAt(valueBase, subValueFont), w: subValueW, h: subValueFont.size }, penalty: 0 }] });
        requests.push({ id: 'subtotal:label', kind: 'annotation', owner: { segmentId: 'subtotal' }, text: subtotal.label, lines: [subtotal.label], font: keyFont, typeRole: 'label', priority: PRIORITY.grandTotal, candidates: [{ slot: 'main', rect: { x: bx + 18, y: topAt(labelBase, keyFont), w: subLabelW, h: keyFont.size }, penalty: 0 }] });
      }
    } else {
      const top = rect.y + rect.h + space.gapSubtitlePlot;
      const colW = plot.w / keyColumns;
      entries.forEach((_, i) => place(i, plot.x + (i % keyColumns) * colW, top + Math.floor(i / keyColumns) * entryStep + entryStep / 2, false));
      readoutLegend!.rect = { x: plot.x, y: top, w: plot.w, h: keyRows * entryStep };
      if (subtotal) {
        const ruleY = round2(top + keyRows * entryStep + 8);
        nodes.push({ t: 'line', id: 'subtotal:rule', x1: plot.x, y1: ruleY, x2: round2(plot.x + plot.w), y2: ruleY, stroke: { token: 'leader' }, width: strokeToken(theme, 'hair'), owner: { segmentId: 'subtotal' }, part: 'waffleSubtotal' });
        const baseline = ruleY + 10 + subLineH;
        requests.push({ id: 'subtotal:value', kind: 'total', owner: { segmentId: 'subtotal' }, text: subtotalText, lines: [subtotalText], font: subValueFont, typeRole: 'label', priority: PRIORITY.grandTotal, candidates: [{ slot: 'main', rect: { x: plot.x, y: topAt(baseline, subValueFont), w: subValueW, h: subValueFont.size }, penalty: 0 }] });
        requests.push({ id: 'subtotal:label', kind: 'annotation', owner: { segmentId: 'subtotal' }, text: subtotal.label, lines: [subtotal.label], font: keyFont, typeRole: 'label', priority: PRIORITY.grandTotal, candidates: [{ slot: 'main', rect: { x: plot.x + subValueW + 6, y: topAt(baseline, keyFont), w: subLabelW, h: keyFont.size }, penalty: 0 }] });
      }
    }
  }
  // ---- one panel, one series: the value and the label beside the filled cells ----
  if (valueSide) {
    const rect = marks.panels[0]!.rect;
    const topAt = (baseline: number, font: FontSpec): number => baseline - font.size * TEXT_ASCENT;
    // The tick stands at the middle of the filled cells; the value's caps sit on it.
    const filled = panels[0]!.filledCells;
    let rowSum = 0;
    for (let k = 0; k < filled; k++) rowSum += cellAt(k, grid.columns, grid.rows, fillFrom).row;
    const cy = rect.y + (filled > 0 ? rowSum / filled : fillFrom === 'bottom' ? grid.rows - 1 : 0) * pitch + side / 2;
    const cap = measure.capHeight?.(sideValueFont) ?? sideValueFont.size * 0.72;
    const labelStep = labelFont.size * 1.5;
    const blockTop = (base: number): number => base - cap;
    const blockBottom = (base: number): number => base + (sideLabelLines.length > 0 ? labelStep + sideLabelH - measure('0', labelFont).height : 0);
    // The block stays inside the grid's height.
    let valueBase = cy + cap / 2;
    valueBase += Math.max(0, rect.y - blockTop(valueBase));
    valueBase -= Math.max(0, blockBottom(valueBase) - (rect.y + rect.h));
    const x = rect.x + rect.w + VALUE_SIDE_GAP;
    nodes.push({ t: 'line', id: `valueTick:${panels[0]!.categoryId}`, x1: round2(rect.x + rect.w + 4), y1: round2(cy), x2: round2(rect.x + rect.w + 18), y2: round2(cy), stroke: { token: 'leader' }, width: strokeToken(theme, 'hair'), owner: {}, part: 'leader' });
    requests.push({
      id: `total:${panels[0]!.categoryId}`, kind: 'total', owner: { categoryId: panels[0]!.categoryId },
      text: sideValueText!, lines: [sideValueText!], font: sideValueFont, typeRole: 'kpiValue', priority: PRIORITY.grandTotal,
      candidates: [{ slot: 'main', rect: { x, y: topAt(valueBase, sideValueFont), w: sideValueW, h: sideValueFont.size }, penalty: 0 }],
    });
    if (sideLabelLines.length > 0) {
      requests.push({
        id: `category:${panels[0]!.categoryId}`, kind: 'category', owner: { categoryId: panels[0]!.categoryId },
        text: sideLabelText, lines: sideLabelLines, font: labelFont, typeRole: 'label', priority: PRIORITY.total,
        ...(sideLabelWrap.truncated ? { title: panels[0]!.label } : {}),
        candidates: [{ slot: 'main', rect: { x, y: topAt(valueBase + labelStep, labelFont), w: Math.max(...sideLabelLines.map((line) => measure(line, labelFont).width)), h: sideLabelH }, penalty: 0 }],
      });
    }
  }
  // ---- text through the label solver ----
  const solveCtx: SolveCtx = labelCtx(theme, size, options, {
    measure,
    plot,
    labelPad: 2,
  });
  // Each label is emitted in the font it was measured with.
  const fontOf = new Map(requests.map((request) => [request.id, request.font]));
  const solved = solveLabels(requests, occupied, solveCtx);
  const hiddenReference = solved.placed.find((label) => label.id === 'reference' && label.hidden);
  if (hiddenReference) {
    hiddenReference.hidden = 'redundant';
    hiddenReference.noteLocation = referenceNote ? frame.frame.footnoteNodeIds?.[0] : `legend:${referenceId}`;
    // The notes list names it when a note holds it.
    if (referenceNote) hiddenReference.noted = true;
    solved.warnings = solved.warnings.filter((warning) => warning.code !== 'label-hidden' || !warning.message.includes("label 'reference'"));
  }
  pushAll(warnings, solved.warnings);
  for (const label of solved.placed) {
    if (!label.hidden && label.id.startsWith('category:')) label.ink = { token: theme.type.eyebrow?.ink ?? 'inkMuted' };
    if (!label.hidden && label.id === 'subtotal:label') label.ink = { token: 'inkMuted' };
  }
  const allLabels: PlacedLabel[] = solved.placed;
  pushAll(nodes, labelsToNodes(theme, allLabels, (label) => fontOf.get(label.id) ?? labelFont).map((node): SceneNode => {
    if (node.t === 'text' && node.owner.seriesId !== undefined && (node.id.startsWith('label:key:') || node.id.startsWith('label:value:'))) {
      return { ...node, part: 'legendLabel', role: textRole(node) };
    }
    // Readout numbers are computed values, whatever request kind seated them.
    if (node.t === 'text' && (node.id.startsWith('label:keyValue:') || node.id === 'label:subtotal:value')) return { ...node, role: 'value' };
    const total = node.id.startsWith('label:total:') ? panels.find((panel) => `label:total:${panel.categoryId}` === node.id) : undefined;
    return total && node.t === 'text' ? { ...node, display: { value: node.lines.join(' ') } } : node;
  }));
  marks.panels.forEach((mark) => {
    mark.labelNodeId = allLabels.find((label) => label.id === `category:${mark.categoryId}`)?.nodeId;
    mark.headlineNodeId = allLabels.find((label) => label.id === `total:${mark.categoryId}`)?.nodeId;
  });

  // ---- sizing: the floor is the smallest readable cell, and the widest headline at the hero floor ----
  const headlineMin = showHeadline ? Math.max(0, maxOf(headlineValues.map((text) =>
    (text === undefined ? 0 : measure(text, { ...headlineFont, size: hero.minimum }).width)))) : 0;
  // Square mode: the two-row form with the narrow gap, each label word inside its panel.
  const minPanelW = square
    ? Math.max(SQUARE_MIN_SIDE, Math.ceil(headlineMin), Math.ceil(Math.max(0, maxOf(longestWord))))
    : Math.max(grid.columns * MIN_PITCH, Math.ceil(headlineMin));
  const floorColumns = square ? minColumns : Math.min(n, columns);
  const floorGutter = square && !arrows && floorColumns > 1 ? COMPACT_GUTTER : gutter;
  // The readout under the grid needs one key entry and the subtotal line in the width.
  const minWidth = size.width - plot.w + Math.max(floorColumns * minPanelW + (floorColumns - 1) * floorGutter,
    readout ? Math.ceil(Math.max(entryW, subtotal ? subValueW + 6 + subLabelW : 0)) : 0);
  // The side key is not part of the floor: below the width that holds it the key stands under the grid.
  // A square is never taller than its panel is wide, so its floor stops there too.
  const floorGridH = square ? Math.min(grid.rows * MIN_PITCH, panelW) : grid.rows * MIN_PITCH;
  const minHeight = frameH + Math.max(blocksH(rowRequiredBottomH) + panelRows.length * floorGridH + (panelRows.length - 1) * gutter, topBlockH + keyH);

  const reading = panels.map((panel, pi) => describePanel(panel, series.map((s) => s.label), headlineFormat(pi), cellCount, options));
  const geometry: Geometry<WaffleMarks, WaffleDerived> = {
    type: 'waffle', size,
    sizing: resolveSizing({ ...WAFFLE_SIZING, minWidth: 0 }, size, { minWidth, minHeight, naturalHeight }),
    plot, scene: nodes, labels: allLabels, axes: [], annotations: [], legend: readoutLegend ?? frame.legend, frame: frame.frame, marks,
    derived: {
      grid: { ...grid, cells: cellCount }, fillFrom, variant: square ? 'square' : 'cells', ...(reference ? { reference } : {}), cellShare: Math.round(cellShare * 1e9) / 1e9,
      panels,
      ...(adjustments.length > 0 ? { roundingAdjustments: adjustments } : {}),
    },
    a11y: {
      title: accessibleTitle(options.title, chartString(options, 'waffleTitle', { v1: panels.map((panel) => panel.label).join(', ') })),
      counts: [structureCount('panels', n, chartString(options, 'panelsCount', { v1: n, v2: n === 1 ? 'panel' : 'panels' })), structureCount('series', series.length, chartString(options, 'seriesCount', { v1: series.length })), ...(square ? [] : [structureCount('cells', cellCount, undefined, options)])],
      desc: square
        ? chartString(options, 'waffleSquareDesc', { v1: n, v2: n === 1 ? 'panel' : 'panels', v3: series.length, v4: reading.join(' '), v5: reference && !(reference.categoryId !== undefined && n === 1) ? chartString(options, 'waffleReferenceDesc', { v1: reference.categoryId !== undefined ? chartString(options, 'otherPanels') : chartString(options, 'eachPanel'), v2: reference.label }) : '' })
        : chartString(options, 'waffleCellsDesc', { v1: n, v2: n === 1 ? 'panel' : 'panels', v3: series.length, v4: grid.rows, v5: grid.columns, v6: cellCount, v7: formatAutomaticPercent(cellShare, autoDecimals(cellShare), false, options.locale?.language), v8: reading.join(' ') }),
    },
    warnings, debug: { occupied: occupied.snapshot(), decisions: solved.decisions },
  };
  const fits = Math.max(minHeight, frame.frame.minHeight ?? 0) <= size.height + 1e-6 && minWidth <= size.width + 1e-6;
  return { geometry, naturalHeight, fits };
}

/** "Label: 30% = 30 of 100 cells." One sentence per panel, and the rounding of every segment. */
function describePanel(panel: WafflePanelDerived, names: string[], headline: (value: number) => string, cellCount: number, options: WaffleOptions): string {
  const many = panel.segments.length > 1;
  const parts = panel.segments.map((segment, si) => `${many ? `${names[si]} ` : ''}${segment.reading}`);
  const rest = cellCount - panel.filledCells;
  return `${panel.label}: ${parts.join(', ')}${many ? chartString(options, 'waffleAllClause', { v1: headline(panel.total) }) : ''}${rest > 0 && many ? chartString(options, 'emptyCellsClause', { v1: rest, v2: cellCount }) : ''}.`;
}
