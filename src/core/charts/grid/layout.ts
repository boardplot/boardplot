import { alignCategoryPanels, alignValuePanels, moveChildPlot } from '../../grid/panelAlignment';
import { currentSmallValues } from '../../formatPrecision';
import { chartString } from '../../strings/grid';
import { authoredStrings } from '../../strings';
import { isRecord } from '../../lint/shared';
import { isMetricStackData, stackError } from './metricStack';
import { layoutMetricStack, type MetricStackDerived } from './metricStackLayout';
import { structureCount } from '../../structureCounts';
import { boundsOf, type Rect } from '../../geometry';
import { fmtPathNumber as fmtN } from '../../curve';
import { inferLinearYDomain } from '../../axis';
import { frameTextOptions, normalizeLegendOption, solveFrame, type FrameInput, type LegendItemInput } from '../../frame';
import { collectGridLegendItems, gridLegendInput, gridPanelsKeepEndNames, hatchStrengthFor } from '../../grid/gridKey';
import { balanceVarianceTierPlots, VARIANCE_TIER, varianceTierWeights } from '../../grid/varianceTiers';
import { scalePanelSemantics } from '../../grid/sharedScale';
import {
  layoutGrid as composeGrid,
  FACET_GAPS,
  SCALE_GROUP_MEMBERS,
  facetHeadedGaps,
  gridShare,
  measuredCaption,
  bottomUpTierOrder,
  tierWeights,
  sharedCategoryLabelOwner,
  sharedYGroup,
  withoutCategoryLabels,
  type GridDerived as ComposedGridDerived,
  type GridMarks as ComposedGridMarks,
} from '../../grid/layoutGrid';
import { labelsToNodes } from '../../label/emit';
import { createOccupiedIndex } from '../../label/occupied';
import {
  labelCtx,
  PRIORITY,
  solveLabels,
  type LabelRequest,
  type SolveCtx,
} from '../../label/solver';
import { accessibleTitle, NormalizeError, normalizeCategory, normalizeSeriesValues, resolveCanvasOptions, resolveHighlight, resolveSize } from '../../normalize/shared';
import { getChart } from '../../registry';
import { requireChartCores } from '../../deferred';
import { panelNoteData } from '../../panelNoteData';
import { GridChildRefusal, gridRowHeights, gridSizing, hasKpiFigure, layoutChildChart, smallestKpiValueSize } from '../../grid/childLayout';
import { KPI_HOST_TEXT, KPI_VALUE_SIZE } from '../../typeFloors';
import { LEFT_OUT_OF_NOTE, panelNoteTexts, stringsIn } from '../../frame';
import { autoPlotPx, CARD_CLASS_WIDTH, CARD_MIN_WIDTH, chartSizing, DIGIT_SEAT, heightOmitted, type DigitSeated, NARROW_SHARE_WIDTH, stackedColumnPlotPx } from '../../sizing';
import { defaultMeasurer, type FontSpec, type TextMeasurer } from '../../text';
import {
  canvasMargin,
  panelTypeClass,
  themeRegistrations,
  resolveTheme,
  themeForWidth,
  typeWidthClass,
  type TypeWidthClass,
  emphasisWeight,
  strokeToken,
  WIDE_CANVAS_MIN_WIDTH,
} from '../../theme';
import { GRID_MAX_TRACKS } from './limits';
import { DEFAULT_TARGET, TARGET_SIZE, type TargetSizeOptions } from '../../target';
import { STACK_ROOM } from '../band/labels';
import { cellMeta, cellValue, type OwnerRef } from '../../types/cell';
import type { ThemeRef } from '../../types/theme';
import type { LegendOptions } from '../../types/options';
import type { ChartData } from '../../types/data';
import type {
  AxisGeometry,
  Geometry,
  LayoutResult,
  LintWarning,
  PlacedLabel,
  SceneNode,
} from '../../types/scene';
import {
  normalizeGridData,
  parseGridLegendPanelData,
  parseGridTextPanelData,
  type ExplicitGridData,
  type GridInput,
  type GridThemeFacts,
  type GridLayoutOptions,
  type GridPanelSpec,
  type GridTrackScope,
} from './normalize';
import { maxOf, minOf, pushAll } from '../../arrays';
import { emptyIdRecord } from '../../idRecords';

export interface GridMarks extends ComposedGridMarks {
  panels: (ComposedGridMarks['panels'][number] & {
    titleNodeId?: string;
    captionNodeId?: string;
    row?: number;
    column?: number;
    rowSpan?: number;
    columnSpan?: number;
  })[];
  alignmentRules?: { id: string; nodeId: string; orientation: 'horizontal' | 'vertical' }[];
}

export interface GridDerived extends ComposedGridDerived {
  metricStack?: MetricStackDerived;
  sharedYDomains?: Record<string, [number, number]>;
  tracks?: {
    rows: Rect[];
    columns: Rect[];
    rowGaps: number[];
    columnGaps: number[];
  };
  sharedAnchors?: Record<string, number>;
}

interface CaptionSlot {
  panel: GridPanelSpec;
  slot: Rect;
  titleNodeId?: string;
  captionNodeId?: string;
}

/** A host that skips the schema must not hang the layout on a huge track count (loops and arrays are sized by it). */
function assertTrackLimits(options: GridLayoutOptions, panels: readonly GridPanelSpec[] = []): void {
  const refuse = (field: string, what: string) => {
    throw new NormalizeError('grid-too-many-tracks', field, `${what} is over the limit of ${GRID_MAX_TRACKS} tracks`, `use at most ${GRID_MAX_TRACKS} row tracks and ${GRID_MAX_TRACKS} column tracks`);
  };
  const over = (value: unknown) => typeof value === 'number' && !(value <= GRID_MAX_TRACKS);
  if (over(options.columns)) refuse('options.columns', `options.columns ${options.columns}`);
  if (Array.isArray(options.columns) && options.columns.length > GRID_MAX_TRACKS) refuse('options.columns', 'options.columns');
  if (Array.isArray(options.rows) && options.rows.length > GRID_MAX_TRACKS) refuse('options.rows', 'options.rows');
  panels.forEach((panel, index) => {
    const reach = (start: number | undefined, span: number | undefined) => (start ?? 0) + (span ?? 1);
    if (over(reach(panel.row, panel.span?.rows))) refuse(`panels[${index}]`, `panels[${index}] reaching row ${reach(panel.row, panel.span?.rows)}`);
    if (over(reach(panel.column, panel.span?.columns))) refuse(`panels[${index}]`, `panels[${index}] reaching column ${reach(panel.column, panel.span?.columns)}`);
  });
}

/**
 * Normalizes grid data with the facts of the themes the panels render in: a
 * panel's own `options.theme` replaces the grid's. A theme that does not
 * resolve reports neutral facts here and fails where the panel is laid out.
 */
export function normalizeGridWithTheme(data: unknown, options: GridLayoutOptions): ExplicitGridData {
  const facts = new Map<unknown, GridThemeFacts>();
  const themeFacts = (panelTheme: unknown): GridThemeFacts => {
    const ref = panelTheme ?? options.theme;
    let found = facts.get(ref);
    if (!found) {
      try {
        const theme = resolveTheme(ref as ThemeRef);
        found = { seriesCount: theme.color.series.length, stylesSeries: theme.marks?.comboLine === 'ink' || theme.marks?.comboColumnTint !== undefined };
      } catch {
        found = { seriesCount: Infinity, stylesSeries: false };
      }
      facts.set(ref, found);
    }
    return found;
  };
  return normalizeGridData(data, { palette: options.palette, themeFacts });
}

export function layoutGrid(
  data: GridInput,
  options: GridLayoutOptions = {},
): LayoutResult<GridMarks, GridDerived> {
  options = resolveCanvasOptions(options);
  assertTrackLimits(options);
  const metricStack = isMetricStackData(data);
  // A retired option stays accepted on every layout.
  const formatWarnings: LintWarning[] = options.format === undefined ? [] : [{
    code: 'format-unused', severity: 'warn', field: ['options', 'format'],
    message: "Grid-level options.format is ignored",
    suggest: metricStack
      ? 'Set decimals and divisor on each metric stack panel; remove the grid-level format.'
      : 'Set format on each numeric panel in data.panels[].options.format; remove the grid-level format.',
    fix: [{ op: 'remove', path: '/options/format' }],
  }];
  // Metric stacks measure a fixed readout gutter and every category value.
  // Their sizing probe is not a compact column panel and must keep its floor.
  // The React grid entry links no panel core: it fetches them all at once, before any panel lays out.
  if (metricStack) {
    requireChartCores(data.panels.map((panel) => panel.type), (type) => getChart(type) !== undefined);
    return withWarnings(layoutMetricStack(data, options), formatWarnings);
  }
  if (options.stack) stackError('data', 'Metric stack mode needs shared categories and measures');
  const normalized = normalizeGridWithTheme(data, options);
  requireChartCores(normalized.panels.map((panel) => panel.type), (type) => getChart(type) !== undefined);
  assertTrackLimits(options, normalized.panels);
  normalized.panels = normalized.panels.map((panel) => panel.options
    ? { ...panel, options: resolveCanvasOptions(panel.options) } : panel);
  const authored = usesAuthoredLayout(normalized.panels, options);
  // An authored layout has no row band: the row caption goes back under each panel.
  if (authored && normalized.rowCaption) {
    normalized.panels = normalized.panels.map((panel) => ({ ...panel, caption: panel.caption ?? normalized.rowCaption }));
    delete normalized.rowCaption;
  }
  options = { ...options, sharedAxis: gridShare(normalized.panels, options.sharedAxis) };
  // Ordered HERE and not inside normalizeGridData: normalize runs
  // lockPaletteBySeriesId in authored order, so sorting before it would swap
  // every panel's colour role, and its indexes are what the schema's
  // superRefine uses for issue paths.
  const ordered = orderPanels(normalized.panels, options, authored);
  pushAll(ordered.warnings, formatWarnings);
  if (options.sharedScale === true) {
    const charts = ordered.panels.filter((panel) => panel.type !== 'text' && panel.type !== 'legend');
    const semantics = charts.map(panelScaleSemantics);
    const first = semantics[0];
    const matching =
      first != null &&
      semantics.every((candidate) => candidate !== null && candidate.unit === first.unit && candidate.format === first.format);
    if (charts.length > 1 && !matching) {
      throw new NormalizeError(
        'scale-mix',
        'options.sharedScale',
        'sharedScale:true needs matching unit and format on every numeric panel',
        'drop sharedScale, set sharedScale:false, or give every panel the same unit and format',
      );
    }
  }
  const legacy = (at: GridLayoutOptions) => layoutLegacyGrid({ ...normalized, panels: ordered.panels }, at);
  const legacyGrid = (at: GridLayoutOptions) => withSliverRoom(withOnePanelContent(withTierPlot(legacy(at), ordered.panels, at), legacy, ordered.panels, at), legacy, at, data);
  const geometry = withWarnings(authored ? layoutAuthoredGrid(ordered.panels, options, normalized.repeatFacet === true)
    : legacyGrid(reflowed(legacyGrid, ordered.panels, options, data)), ordered.warnings);
  if (!geometry.refused && heightOmitted(options.size) && geometry.sizing?.fit === 'content'
    && Math.abs(geometry.size.height - geometry.sizing.naturalHeight) > 1) {
    return layoutGrid(data, { ...options, size: { width: geometry.size.width, height: geometry.sizing.naturalHeight } });
  }
  return withCardFloor(geometry, ordered.panels.map((panel) => panel.type), options);
}

/** The facet panels that drop category names for room (category-stride): a width loss, whatever the height. */
/** Whether a layout at an authored height keeps it: the sizing pass refuses a height under minHeight. */
const seats = (geometry: LayoutResult<GridMarks, GridDerived>, height: number) =>
  !geometry.refused && (geometry.sizing?.minHeight ?? 0) <= height;
const strideLosses = (geometry: LayoutResult<GridMarks, GridDerived>): number => geometry.refused
  ? Number.POSITIVE_INFINITY : geometry.warnings.filter((warning) => warning.code === 'category-stride').length;

/**
 * A facet grid of more panels than a numeric `columns` count, on a card (under
 * CARD_CLASS_WIDTH), reads `columns` as a maximum (`reflow`, default true): where a
 * panel drops category names for room, it takes the largest smaller count, down to two,
 * that prints them all. Nine panels in three columns at 320 px lost every middle year
 * and ran a title into a value; in two columns every name prints. Where no count prints
 * every name the authored one stays. One row of panels keeps its row: those panels
 * compare side by side. Wider canvases lay out as before.
 *
 * The count follows the width alone, read with the height left to the grid, so the sizing
 * pass, which lays the grid out at several heights, gets one count per width. It is chosen
 * before the layout and kept per width, options and data: each layout runs once, as before.
 */
function reflowed(
  relayout: (options: GridLayoutOptions) => LayoutResult<GridMarks, GridDerived>,
  panels: GridPanelSpec[],
  options: GridLayoutOptions,
  data: GridInput,
): GridLayoutOptions {
  const columns = options.columns;
  const width = resolveSize(options.size).width;
  if (options.reflow === false || typeof columns !== 'number' || columns < 3 || panels.length <= columns
    || width >= CARD_CLASS_WIDTH || legacyGridForm(panels, options) !== 'facets') return options;
  // An authored height must still seat the fewer columns' extra rows; a sizing probe's height is
  // not authored, so the automatic height grows to the reflowed grid instead.
  const fixed = (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height ?? !heightOmitted(options.size);
  const height = fixed ? resolveSize(options.size).height : undefined;
  const choose = () => {
    const open = (count: number) => strideLosses(relayout({ ...options, columns: count, size: { width } }));
    if (open(columns) === 0) return columns;
    for (let fewer = columns - 1; fewer >= 2; fewer--) {
      if (open(fewer) === 0 && (height === undefined || seats(relayout({ ...options, columns: fewer }), height))) return fewer;
    }
    return columns;
  };
  // The request path injects its measurer, so the choices are kept per measurer.
  const { size: _size, measure, ...rest } = options;
  const key = `${width}:${height ?? 'auto'}:${currentSmallValues()}:${themeRegistrations()}:${JSON.stringify(rest)}:${JSON.stringify(data)}`;
  let cache = REFLOW_CACHE.get(measure ?? DEFAULT_MEASURER);
  if (!cache) REFLOW_CACHE.set(measure ?? DEFAULT_MEASURER, cache = new Map());
  if (!cache.has(key)) {
    if (cache.size >= REFLOW_CACHE_SIZE) cache.delete(cache.keys().next().value!);
    cache.set(key, choose());
  }
  const chosen = cache.get(key)!;
  return chosen === columns ? options : { ...options, columns: chosen };
}

/** The last reflow choices, by width, options and data (see reflowed). */
const REFLOW_CACHE = new WeakMap<object, Map<string, number>>();
const DEFAULT_MEASURER = {};
const REFLOW_CACHE_SIZE = 64;

/** Code of a panel warning that a segment value is not printed because its segment is too short. */
const SLIVER_HIDDEN = 'sliver-labels-hidden';

/** Whether a panel hides a sliver's value, as before the digit seat: a value only that seat holds counts (DIGIT_SEAT). */
function sliversHidden(probe: { warnings: readonly { code: string }[]; labels?: readonly object[] }): boolean {
  return probe.warnings.some((warning) => warning.code === SLIVER_HIDDEN) || (probe.labels ?? []).some((label) => (label as DigitSeated)[DIGIT_SEAT] !== undefined);
}
/** The sliver search finds the height within this many px, up to SLIVER_ROOM_MAX times the natural height. */
const SLIVER_ROOM_STEP = 4;
const SLIVER_ROOM_MAX = 1.3;

/**
 * A grid of fill panels (grid.panels) drawn at
 * its automatic height reports as its natural height the lowest height (within
 * SLIVER_ROOM_STEP px, up to SLIVER_ROOM_MAX times taller) at which no
 * panel leaves a segment value out for a short segment. The sizing pass then
 * draws an unpinned grid there; a pinned grid keeps its size and its note.
 * Only a one-column grid with one chart panel searches; facets keep their own
 * natural height (the facet share rule).
 */
function withSliverRoom(
  geometry: LayoutResult<GridMarks, GridDerived>,
  relayout: (options: GridLayoutOptions) => LayoutResult<GridMarks, GridDerived>,
  options: GridLayoutOptions,
  data: GridInput,
): LayoutResult<GridMarks, GridDerived> {
  const sizing = geometry.sizing;
  const hides = sliversHidden;
  if (!sizing || sizing.fit === 'content' || geometry.refused || !hides(geometry)) return geometry;
  const columns = options.sharedAxis === 'category' || options.sharedAxis === undefined ? 1 : Math.max(1, Number(options.columns ?? 1));
  // One chart panel only: a search over several tiers lays out every tier per step (seconds on a phone card).
  if (columns > 1 || geometry.marks.panels.filter((panel) => panel.chart).length !== 1) return geometry;
  // The sizing pass draws an unpinned grid at the natural height it reports at its first probe, so
  // the search starts there, not at the probe's height.
  const { width, height } = geometry.size;
  const at = (h: number) => relayout({ ...options, size: { ...resolveSize(options.size), width, height: h } });
  const start = Math.max(height, sizing.naturalHeight);
  const withNatural = (found: number | undefined) => (found === undefined ? geometry : { ...geometry, sizing: { ...sizing, naturalHeight: found } });
  // The sizing pass lays the same data out at many heights: one search per width, start, options and data.
  // The request path injects its measurer, so the results are kept per measurer.
  const { size: _size, measure, ...rest } = options;
  const key = `${width}:${start}:${currentSmallValues()}:${themeRegistrations()}:${JSON.stringify(rest)}:${JSON.stringify(data)}`;
  let cache = SLIVER_ROOM_CACHE.get(measure ?? DEFAULT_MEASURER);
  if (!cache) SLIVER_ROOM_CACHE.set(measure ?? DEFAULT_MEASURER, cache = new Map());
  if (!cache.has(key)) {
    if (cache.size >= SLIVER_ROOM_CACHE_SIZE) cache.delete(cache.keys().next().value!);
    cache.set(key, sliverRoomHeight(start, height, at, hides));
  }
  return withNatural(cache.get(key));
}

/** The last sliver search results, by measurer, width, start height, options and data (see withSliverRoom). */
const SLIVER_ROOM_CACHE = new WeakMap<object, Map<string, number | undefined>>();
const SLIVER_ROOM_CACHE_SIZE = 64;

function sliverRoomHeight(
  start: number,
  height: number,
  at: (h: number) => LayoutResult<GridMarks, GridDerived>,
  hides: (probe: LayoutResult<GridMarks, GridDerived>) => boolean,
): number | undefined {
  if (start !== height) {
    const probe = at(start);
    if (probe.refused || !hides(probe)) return undefined;
  }
  // Binary search: the tallest height first, then halve the interval to SLIVER_ROOM_STEP px.
  let low = start;
  let high = Math.floor(start * SLIVER_ROOM_MAX);
  const top = at(high);
  if (top.refused || hides(top)) return undefined;
  while (high - low > SLIVER_ROOM_STEP) {
    const mid = Math.floor((low + high) / 2);
    const probe = at(mid);
    if (!probe.refused && !hides(probe)) high = mid; else low = mid;
  }
  return high;
}

/**
 * Types whose compact floor holds only for the chart alone: a bullet
 * panel compacts by `density: 'compact'`, not by the grid's `mode: 'compact'`; a pie panel
 * under 240 px loses its labels and a slope panel its names. Such panels keep their full width floor.
 */
const STANDALONE_COMPACT = new Set(['bullet', 'pie', 'slope']);
// The type's own sizing: a waffle declares its compact floor in its definition, not in chartSizing.
// A nested grid's compact floor is only its fallback form (FALLBACK_COMPACT): it keeps its full panels.
const panelCompacts = (type: string): boolean => !STANDALONE_COMPACT.has(type) && type !== 'grid'
  && (getChart(type)?.sizing ?? chartSizing(type)).compactFloor !== undefined;

/**
 * A grid whose chart panels all draw on a compact card (their type has a
 * compact floor) is drawn on a card down to CARD_MIN_WIDTH: the panels
 * inherit that floor instead of refusing the card.
 * Text and legend panels have no floor of their own.
 */
function withCardFloor<M extends object, D extends object>(geometry: LayoutResult<M, D>, types: readonly string[], options: GridLayoutOptions): LayoutResult<M, D> {
  if (geometry.refused) return geometry;
  const sizing = geometry.sizing;
  // The compact form (stackCompactPanels) draws down to the width its widest panel measures.
  if (sizing && options.mode === 'compact' && geometry.size.width < CARD_CLASS_WIDTH && sizing.minWidth > Math.max(CARD_MIN_WIDTH, sizing.measuredMinWidth)) {
    const minWidth = Math.max(CARD_MIN_WIDTH, sizing.measuredMinWidth);
    return { ...geometry, sizing: { ...sizing, minWidth, comfortableWidth: Math.ceil(minWidth * 1.25) } };
  }
  const charts = types.filter((type) => type !== 'text' && type !== 'legend');
  if (!sizing || sizing.minWidth <= CARD_MIN_WIDTH || charts.length === 0
    || !charts.every(panelCompacts)) return geometry;
  return { ...geometry, sizing: { ...sizing, minWidth: CARD_MIN_WIDTH, measuredMinWidth: Math.min(sizing.measuredMinWidth, CARD_MIN_WIDTH), comfortableWidth: Math.ceil(CARD_MIN_WIDTH * 1.25) } };
}

/**
 * On a card narrower than the grid's full width (CARD_CLASS_WIDTH, which the
 * grid refused before the card floor) a chart panel draws in its compact mode
 * when its type has one, as the same chart does alone on that card. An
 * authored mode wins. Wider grids keep full panels.
 */
function compactPanelMode(panel: GridPanelSpec, canvasWidth: number): { mode?: 'compact' } {
  if (panel.type === 'text' || panel.type === 'legend' || panel.options?.mode !== undefined) return {};
  return panelCompacts(panel.type) && canvasWidth < CARD_CLASS_WIDTH ? { mode: 'compact' } : {};
}

function withWarnings<M extends object, D extends object>(
  geometry: LayoutResult<M, D>,
  warnings: readonly LintWarning[],
): LayoutResult<M, D> {
  if (warnings.length === 0) return geometry;
  return { ...geometry, warnings: [...(geometry.warnings ?? []), ...warnings] };
}

/**
 * Facet panel order.
 *
 * The order is a TOTAL one — measured key, then authored index — because two
 * layouts of the same input must be byte-identical (a test asserts this over
 * every fixture). A comparator that leaves ties to the sort's own stability is a
 * promise the spec does not make.
 *
 * Panels with nothing to measure sit LAST in both directions rather than
 * sorting as zero: a panel of all-null is not the smallest panel, it is an
 * unranked one, and putting it at the bottom of a descending list and the top
 * of an ascending one would be two different claims about the same data.
 */
function orderPanels(
  panels: GridPanelSpec[],
  options: GridLayoutOptions,
  authored: boolean,
): { panels: GridPanelSpec[]; warnings: LintWarning[] } {
  const order = options.panelOrder ?? 'sheet';
  if (order === 'sheet' || options.sharedAxis === 'category') return { panels, warnings: [] };
  if (authored) {
    // An authored row/column grid places its panels by coordinate. Reordering
    // the array would move nothing on screen, so the request fails loudly
    // instead of silently.
    return {
      panels,
      warnings: [
        {
          code: 'panel-order-authored-placement',
          severity: 'warn',
          message: `panelOrder '${order}' is ignored: this grid places its panels with authored row/column coordinates, so the array order does not decide what sits where`,
          suggest: 'remove the authored row/column coordinates, or drop panelOrder',
        },
      ],
    };
  }

  const key = (panel: GridPanelSpec): number | null => {
    const data = panel.data as Partial<ChartData> | undefined;
    const series = data?.series;
    if (!Array.isArray(series)) return null;
    const categories = Array.isArray(data?.categories) ? data.categories.map(normalizeCategory) : undefined;
    const normalized = categories ? series.map((entry, si) => ({ ...entry, values: normalizeSeriesValues(entry, categories, si) })) : series;
    // The child reads the same category-ordered cells that decide its panel's rank.
    if (categories) panel.data = { ...data, categories, series: normalized };
    const measured = normalized.filter((entry) => entry?.role !== 'reference');
    let total: number | null = null;
    for (const entry of measured) {
      const values = Array.isArray(entry.values) ? entry.values : [];
      const cells = order.startsWith('last') ? values.slice(-1) : values;
      for (const cell of cells) {
        const value = cellValue(cell as never);
        if (value === null) continue;
        total = (total ?? 0) + value;
      }
    }
    return total;
  };

  const keys = new Map(panels.map((panel, index) => [index, key(panel)] as const));
  const descending = order.endsWith('Desc');
  const sorted = panels
    .map((panel, index) => ({ panel, index }))
    .sort((left, right) => {
      const a = keys.get(left.index) ?? null;
      const b = keys.get(right.index) ?? null;
      if (a === null && b === null) return left.index - right.index;
      if (a === null) return 1;
      if (b === null) return -1;
      if (a !== b) return descending ? b - a : a - b;
      return left.index - right.index;
    })
    .map((entry) => entry.panel);

  const unmeasured = panels.filter((_, index) => keys.get(index) === null);
  const warnings: LintWarning[] =
    unmeasured.length === 0
      ? []
      : [
          {
            code: 'panel-order-unmeasured',
            severity: 'info',
            message: `panelOrder '${order}' could not rank ${unmeasured.length} panel(s) with no numeric value; they keep authored order at the end`,
          },
        ];
  return { panels: sorted, warnings };
}

/**
 * The width class of the GRID CANVAS — every panel inherits it through the
 * internal `typeClass` option, because a slot-sized panel is not a canvas
 * (the boundary the aspect lints draw for the same reason).
 */
function gridTypeClass(options: GridLayoutOptions): TypeWidthClass {
  return panelTypeClass(options) ?? typeWidthClass(resolveSize(options.size).width);
}

function panelCaptionBand(panel: GridPanelSpec, theme: ReturnType<typeof resolveTheme>, measure: TextMeasurer,
  slot: Rect, highlighted: Set<string>, compact = false, shift = 0): { nodes: SceneNode[]; claims: Geometry['debug']['occupied'] } {
  const margin = isRecord(panel.options?.margin) ? panel.options.margin : {};
  // An unset side follows the shared margin at the panel width (16/24/28), not a literal 28.
  const sides = canvasMargin(theme, slot.w);
  const x = slot.x + numeric(margin.left, sides.left);
  let y = slot.y + numeric(margin.top, 20) - measureCaptionBand(panel, theme, measure, slot.w, compact) + shift;
  const nodes: SceneNode[] = [];
  const claims: Geometry['debug']['occupied'] = [];
  for (const [part, value, font, ink] of [
    [compact ? 'tierCaption' : 'panelTitle', panel.title, compact ? { family: theme.type.family, ...theme.type.axis } : { family: theme.type.family, ...theme.type.label, weight: emphasisWeight(theme) }, { token: compact ? 'inkMuted' : highlighted.size === 0 || highlighted.has(panel.id) ? 'ink' : 'inkMuted' }],
    ['panelCaption', panel.caption, { family: theme.type.family, ...theme.type.axis }, { token: 'inkMuted' }],
  ] as const) {
    if (!value) continue;
    const width = Math.max(1, slot.w - numeric(margin.left, sides.left) - numeric(margin.right, sides.right));
    const text = measuredCaption(value, font, width, measure);
    const { lines, title } = text;
    const id = `panel:${panel.id}:${part === 'panelCaption' ? 'caption' : 'title'}`;
    const rect = { x, y, w: text.width, h: text.height };
    const occupied = createOccupiedIndex(rect);
    const solved = solveLabels([{ id, kind: 'annotation', typeRole: 'axis', owner: {}, text: value, lines, ...(title ? { title } : {}), font,
      priority: PRIORITY.total, candidates: [{ slot: 'panelCaption', rect, penalty: 0 }], role: 'note' }], occupied, {
      density: 'full', pins: {}, measure, plot: rect, canvas: rect,
      darkInk: theme.color.ink, lightInk: theme.color.inkInverse, labelPad: 0,
    });
    // Caption bands reserve the full line box, so text uses its top edge.
    pushAll(nodes, labelsToNodes(theme, solved.placed.map(label => ({ ...label, capHeight: undefined })), () => font).map(node => node.t === 'text' ? { ...node, ink, part } : node));
    claims.push({ rect, kind: 'frame', owner: {} });
    y += text.height + 2;
  }
  return { nodes, claims };
}

/**
 * A facet row read against one value axis (the first panel's): the other
 * panels draw that panel's gridlines across their own plots, behind their
 * marks, at the same values. The shared scale and the equal slot heights put
 * a value at the same height in every panel; the y mapping still follows each
 * plot's own top and height.
 */
function shareRowGridlines(geometry: Geometry<GridMarks, GridDerived>, columns: number): void {
  const panels = geometry.marks.panels;
  for (let start = 0; start < panels.length; start += columns) {
    const first = panels[start];
    const source = first?.chart?.geometry.plot;
    if (!first || !source) continue;
    const lines = geometry.scene.filter((node): node is Extract<SceneNode, { t: 'line' }> =>
      node.t === 'line' && node.part === 'gridline' && node.id.startsWith(`${first.id}/`));
    for (const panel of panels.slice(start + 1, start + columns)) {
      const chart = panel.chart;
      if (!chart) continue;
      const plot = chart.geometry.plot;
      const at = (y: number) => plot.y + (y - source.y) * (plot.h / Math.max(1, source.h));
      const copies: SceneNode[] = lines.map((line) => ({
        ...line, id: `${panel.id}/${line.id.slice(first.id.length + 1)}`, owner: {},
        x1: plot.x, x2: plot.x + plot.w, y1: at(line.y1), y2: at(line.y2),
        tx: chart.offset.x, ty: chart.offset.y,
      }));
      const index = geometry.scene.findIndex((node) => node.id.startsWith(`${panel.id}/`));
      const tail = geometry.scene.splice(index < 0 ? geometry.scene.length : index);
      pushAll(geometry.scene, copies);
      pushAll(geometry.scene, tail);
    }
  }
}

/** The space a hanging shared axis keeps from the canvas edge. */
const SHARED_AXIS_EDGE = 8;

/** A facet plot is at least this share of its width tall. */
const FACET_PLOT_SHARE = 0.5;
/** The plots of one facet column together are at least this share of the panel width tall (230 px over 270 px at 960). */
const FACET_COLUMN_SHARE = 0.85;
/**
 * Facet heading band: a heading stands
 * this far under its slot's top (subtitle to the first heading 30 px); and the
 * plot moves up under its heading by the pull (heading baseline to the tallest
 * value 17 px, not 28). The gaps between headed facets are the composer's
 * Facet gaps (grid/layoutGrid.ts).
 */
const FACET_HEAD_TOP = 5;
const FACET_HEAD_PULL = 11;

/**
 * How tall a facet's data stands: the tallest bar or column from the plot's
 * bottom (the size follows the tallest column, not the plot with its label
 * headroom, at half the panel width); the plot height for other marks.
 */
function facetSpan(geometry: Geometry): number {
  const plot = geometry.plot;
  const bars = (geometry.marks as { bars?: { rect?: Rect }[] } | undefined)?.bars;
  const tops = Array.isArray(bars) ? bars.flatMap((bar) => bar.rect && bar.rect.h > 0 ? [bar.rect.y] : []) : [];
  return tops.length > 0 ? plot.y + plot.h - minOf(tops) : plot.h;
}

/**
 * The plot height a facet aims for. A single row of narrow facets keeps
 * at least half its width plus 90 px (130 px plots at
 * 320, 150 at 480, 190 at 720), so three facets on a phone are not flat.
 */
function facetPlotHeight(width: number, share: number, rowCount: number): number {
  return Math.max(share * width, rowCount === 1 ? 0.5 * width + 90 : 0);
}

/** A row caption sits this close under the key (24 px from key to caption). */
const ROW_CAPTION_TOP = 6;

/**
 * The form the legacy grid draws, which the chart ID names (grid.tiers, grid.facets, grid.panels).
 * Tiers: two or more panels on the shared category axis. Facets (small multiples): several
 * columns of panels of one chart type that fills its slot. A mixed grid (KPI cards over a
 * chart) keeps its panels as they are.
 */
export function legacyGridForm(panels: readonly { type: string }[], options: Pick<GridLayoutOptions, 'sharedAxis' | 'columns'>): 'tiers' | 'facets' | 'panels' {
  const category = (options.sharedAxis ?? 'category') === 'category';
  if (category && panels.length > 1) return 'tiers';
  const columns = category ? 1 : Math.max(1, Number(options.columns ?? 1));
  return columns > 1 && panels.length > 1 && new Set(panels.map((panel) => panel.type)).size === 1
    && chartSizing(panels[0]!.type).fit === 'fill' ? 'facets' : 'panels';
}

/**
 * Whether the grid has a compact form: an authored layout of several columns, which
 * stackCompactPanels sets in one column. Metric stacks, tiers and the legacy facet grids have none,
 * nor has a grid whose anchors or alignment rules tie panels side by side.
 */
export function compactStacks(data: GridInput, options: GridLayoutOptions = {}): boolean {
  if (isMetricStackData(data) || options.anchors !== undefined || options.alignmentRules !== undefined) return false;
  // The sizing layer asks on every layout of a call. The answer reads only the panel placement and
  // these options, so they are the key: data changed in place gets its own answer.
  // A repeat input (no panels array) builds its panels from its template: it is not cached.
  const { panels: placed, ...rest } = data as { panels?: unknown };
  const key = Array.isArray(placed) ? JSON.stringify([options.columns, options.rows, options.gutters, options.sharedAxis, rest,
    (placed as GridPanelSpec[]).map((panel) => [panel.type, panel.row, panel.column, panel.span, panel.align, (panel.options as { variant?: unknown } | undefined)?.variant])]) : undefined;
  let answer = key === undefined ? undefined : COMPACT_STACKS.get(key);
  if (answer === undefined) {
    const { panels } = normalizeGridData(data);
    const authored = Array.isArray(options.columns) ? options.columns.length : options.columns
      ?? (options.rows ? Math.ceil(panels.length / options.rows.length) : Math.ceil(Math.sqrt(panels.length)));
    answer = usesAuthoredLayout(panels, options) && gridShare(panels, options.sharedAxis) !== 'category'
      && Math.max(authored, ...panels.map((panel) => (panel.column ?? 0) + (panel.span?.columns ?? 1))) >= 2;
    if (key !== undefined) {
      if (COMPACT_STACKS.size >= 64) COMPACT_STACKS.delete(COMPACT_STACKS.keys().next().value!);
      COMPACT_STACKS.set(key, answer);
    }
  }
  return answer;
}
const COMPACT_STACKS = new Map<string, boolean>();

/** The grid form a spec draws, as layoutGrid decides it: metric stacks aside, authored layouts draw panels. */
export function gridFormOf(data: GridInput, options: GridLayoutOptions = {}): 'metric-stack' | 'tiers' | 'facets' | 'panels' {
  if (isMetricStackData(data)) return 'metric-stack';
  const { panels } = normalizeGridData(data);
  if (usesAuthoredLayout(panels, options)) return 'panels';
  return legacyGridForm(panels, { ...options, sharedAxis: gridShare(panels, options.sharedAxis) });
}

function layoutLegacyGrid(
  normalized: ReturnType<typeof normalizeGridData>,
  options: GridLayoutOptions,
): LayoutResult<GridMarks, GridDerived> {
  const theme = themeForWidth(resolveTheme(options.theme), gridTypeClass(options));
  const measure = options.measure ?? defaultMeasurer;
  const groupResult = resolveSharedYDomains(normalized.panels, options, normalized.repeatFacet === true);
  const form = legacyGridForm(groupResult.panels, options);
  const compactTiers = form === 'tiers';
  const canvasWidth = resolveSize(options.size).width;
  const gridMargin = { ...canvasMargin(theme, canvasWidth), ...options.margin };
  const columns = options.sharedAxis === 'category' || options.sharedAxis === undefined ? 1 : Math.max(1, Number(options.columns ?? 1));
  const facets = form === 'facets';
  // Facets read against one value axis at the left of each row (grid.facets):
  // when the panels share a y scale group and show their axis, the
  // first panel of a row keeps the tick labels, the others draw only the
  // gridlines, which every panel of the row then draws.
  const sharedAxis = facets && sharedYGroup(groupResult.panels) !== null && groupResult.panels.every((panel) => {
    const axis = panel.options?.valueAxis;
    return isRecord(axis) && axis.show === true;
  });
  const rowCaption = facets ? normalized.rowCaption : undefined;
  // Facets with their own value axes (grid.facets) take the tight heading band; facets read
  // against one shared axis (grid.facets) keep theirs.
  const facetHeads = facets && !sharedAxis;
  const headedGaps = facetHeads ? facetHeadedGaps(theme.space.facetGap, canvasWidth) : undefined;
  const gap = columns === 1 ? theme.space.tierGap : headedGaps?.column ?? theme.space.facetGap;
  const slotWidth = (canvasWidth - gridMargin.left - gridMargin.right - gap * (columns - 1)) / columns;
  const rowCaptionFont = { family: theme.type.family, ...theme.type.axis };
  const rowCaptionHeight = rowCaption
    ? measuredCaption(rowCaption, rowCaptionFont, canvasWidth - gridMargin.left - gridMargin.right, measure).height + 6 : 0;
  const preparedPanels = groupResult.panels.map((authoredPanel, index) => {
    // A facet's own chart title is its panel heading (grid.facets): the
    // grid prints it in the heading band at the panel's edge, the chart none.
    const childTitle = authoredPanel.options?.title;
    const panel = facets && authoredPanel.title === undefined && typeof childTitle === 'string' && childTitle.trim().length > 0
      ? { ...authoredPanel, title: childTitle, options: Object.fromEntries(Object.entries(authoredPanel.options!).filter(([key]) => key !== 'title')) }
      : authoredPanel;
    const captionHeight = compactTiers ? 0 : measureCaptionBand(panel, theme, measure, slotWidth);
    const panelOptions = panel.options ?? {};
    const margin = isRecord(panelOptions.margin) ? panelOptions.margin : {};
    const { title: panelTitle, ...panelWithoutTitle } = panel;
    const axis = isRecord(panelOptions.valueAxis) ? panelOptions.valueAxis : {};
    const firstRow = index < columns;
    const headTop = facetHeads ? FACET_HEAD_TOP : 20;
    const pull = facetHeads && captionHeight > 0 ? FACET_HEAD_PULL : 0;
    return {
      ...(compactTiers ? panelWithoutTitle : panel),
      options: {
        ...panelOptions,
        ...(sharedAxis ? { valueAxis: { ...axis, gridlines: axis.gridlines ?? true, ...(index % columns === 0 ? {} : { show: false }) } } : {}),
        ...(compactTiers && panelOptions.title === undefined && panelTitle ? { title: panelTitle } : {}),
        ...(options.palette !== undefined && panelOptions.palette === undefined ? { palette: options.palette } : {}),
        ...compactPanelMode(panel, canvasWidth),
        // Facets: the grid's canvas margin and gutter are the panel's side margins; a
        // facet adds none of its own, so its plot spans the panel.
        // A compact panel on a narrow card spends no width on side margins either.
        margin: { ...(facets ? { left: 0, right: 0, bottom: 0 } : compactPanelMode(panel, canvasWidth).mode ? { left: 0, right: 0 } : {}), ...margin, top: numeric(margin.top, firstRow && rowCaptionHeight > 0 ? ROW_CAPTION_TOP : headTop) + captionHeight + (firstRow ? rowCaptionHeight : 0) - pull },
      },
    };
  });

  // The resolver's membership, not the authored scaleGroup: a clamped or log panel left its group.
  const members = Object.fromEntries(Object.entries(groupResult.members)
    .filter(([group]) => group !== DEFAULT_Y_GROUP && groupResult.domains[group]));
  const composeOptions = { ...options, [SCALE_GROUP_MEMBERS]: members, ...(headedGaps ? { [FACET_GAPS]: headedGaps } : {}) };
  let geometry = composeGrid(
    { panels: preparedPanels } as never,
    composeOptions as never,
  ) as LayoutResult<GridMarks, GridDerived>;
  if (geometry.refused) return geometry;
  if (sharedAxis) {
    // The shared axis hangs in the grid's left margin, so every plot of the row
    // keeps the same width (grid.facets); what the margin cannot hold
    // stays inside the first panel.
    const reserve = Math.max(0, maxOf(geometry.marks.panels.filter((_, index) => index % columns === 0)
      .map((panel) => panel.chart?.geometry.plot.x ?? 0)));
    const hang = Math.min(reserve, Math.max(0, gridMargin.left - SHARED_AXIS_EDGE));
    if (hang > 0) {
      geometry = composeGrid({ panels: preparedPanels.map((panel, index) => index % columns === 0
        ? { ...panel, options: { ...panel.options, margin: { ...panel.options.margin, left: -hang } } } : panel) } as never,
      composeOptions as never) as LayoutResult<GridMarks, GridDerived>;
    }
    if (geometry.refused) return geometry;
    shareRowGridlines(geometry, columns);
  }
  const slots = geometry.marks.panels.map(panel => ({ ...geometry.plot,
    ...((options.sharedAxis ?? 'category') !== 'category' && panel.chart
      ? { x: panel.chart.offset.x, y: panel.chart.offset.y, w: slotWidth } : {}),
  }));
  const captionSlots: CaptionSlot[] = compactTiers
    ? []
    : preparedPanels.map((panel, index) => ({ panel, slot: slots[index]! }));
  const captionNodes: SceneNode[] = [];
  const captionClaims: Geometry['debug']['occupied'] = [];
  const highlighted = new Set(
    resolveHighlight(options.highlight).filter((id) => preparedPanels.some((panel) => panel.id === id)),
  );

  const facetPull = facetHeads && preparedPanels[0] && measureCaptionBand(preparedPanels[0], theme, measure, slotWidth) > 0 ? FACET_HEAD_PULL : 0;
  if (rowCaption && preparedPanels.length > 0) {
    // The row caption sits above the first panel's heading band, across the grid.
    const first = preparedPanels[0]!;
    const top = numeric(first.options.margin.top, 20) - measureCaptionBand(first, theme, measure, slotWidth);
    const band = panelCaptionBand({ id: 'grid', type: 'text', data: {}, caption: rowCaption, options: { margin: { left: 0, right: 0, top } } },
      theme, measure, { ...slots[0]!, w: canvasWidth - gridMargin.left - gridMargin.right }, highlighted, false, facetPull);
    pushAll(captionNodes, band.nodes);
    pushAll(captionClaims, band.claims);
  }
  for (const entry of captionSlots) {
    const band = panelCaptionBand(entry.panel, theme, measure, entry.slot, highlighted, false, facetHeads && measureCaptionBand(entry.panel, theme, measure, slotWidth) > 0 ? FACET_HEAD_PULL : 0);
    entry.titleNodeId = band.nodes.find(n => n.part === 'panelTitle')?.id;
    entry.captionNodeId = band.nodes.find(n => n.part === 'panelCaption')?.id;
    pushAll(captionNodes, band.nodes);
    pushAll(captionClaims, band.claims);
  }

  const markById = new Map(geometry.marks.panels.map((panel) => [panel.id, panel]));
  for (const entry of captionSlots) {
    const mark = markById.get(entry.panel.id);
    if (!mark) continue;
    if (entry.titleNodeId && !mark.titleNodeId) mark.titleNodeId = entry.titleNodeId;
    if (entry.captionNodeId) mark.captionNodeId = entry.captionNodeId;
  }

  // A flat facet hides the steps it is there to compare (grid.facets).
  // The plots of one panel column together are at least
  // 0.85 times as tall as the panel is wide, and each plot at least half its width. The
  // natural height is the height at which the shortest plot of each row
  // meets that share; an unpinned grid is drawn at it, a pinned one keeps
  // its size. The facet rule replaces the type's 16:9 height: that height
  // gives 280 px plots on a 960 px canvas where the share rule gives 230 px.
  const rowCount = Math.ceil(geometry.marks.panels.length / columns);
  const share = Math.max(FACET_PLOT_SHARE, FACET_COLUMN_SHARE / rowCount);
  // Headed facets (grid.facets at 320: LATAM 66 stands 58 px where 70 is needed): the
  // tallest column of the grid meets the share, and the plot grows by the shortfall over the share
  // of the plot that column fills, so the probe at a squashed height already lands near it.
  const charts = geometry.marks.panels.flatMap((panel) => (panel.chart ? [panel.chart.geometry] : []));
  const tallest = charts.reduce<Geometry | undefined>((best, chart) => (!best || facetSpan(chart) > facetSpan(best) ? chart : best), undefined);
  const headedChange = (target: number) => {
    const span = tallest ? facetSpan(tallest) : 0;
    return span > 0 ? (target - span) * (tallest!.plot.h / span) : -Infinity;
  };
  const rowChange = facets && geometry.sizing ? Array.from({ length: rowCount }, (_, row) => maxOf(geometry.marks.panels
    .slice(row * columns, (row + 1) * columns)
    .map((panel) => panel.chart ? (facetHeads
      ? headedChange(facetPlotHeight(panel.chart.geometry.plot.w, share, rowCount))
      : facetPlotHeight(panel.chart.geometry.plot.w, share, rowCount) - panel.chart.geometry.plot.h) : -Infinity))) : [];
  const change = rowChange.every(Number.isFinite) ? rowChange.reduce((total, value) => total + value, 0) : 0;
  const sizing = rowChange.length > 0 && Math.abs(change) > 0.5 && geometry.sizing
    ? { ...geometry.sizing, naturalHeight: Math.max(geometry.sizing.minHeight, Math.ceil(geometry.size.height + change)) }
    : geometry.sizing;
  return {
    ...geometry,
    ...(sizing ? { sizing } : {}),
    scene: [...geometry.scene, ...captionNodes],
    warnings: [...geometry.warnings, ...groupResult.warnings],
    derived: {
      ...geometry.derived,
      ...(Object.keys(groupResult.domains).length > 0 ? { sharedYDomains: groupResult.domains } : {}),
    },
    debug: {
      ...geometry.debug,
      occupied: [...geometry.debug.occupied, ...captionClaims],
    },
  };
}

/**
 * Variance tiers over a stacked column (grid.tiers) report as their natural height the canvas
 * at which the column tier keeps the plot a column chart reserves on its own (autoPlotPx), so
 * its segment values print; the tiers above keep their weight share of it. Never shorter than
 * the height they had. A growing probe reports content fit, so the automatic-height pass lays
 * the grid out again at the height it names, until a canvas lands near it (TIER_HEIGHT_STEP).
 * A probe squashed below its minimum keeps more frame than its canvas: its guess leaves out
 * that overflow, and it always asks for one more pass.
 */
/** The plot a squashed tier keeps (balanceVarianceTierPlots steps in at 10 px), with rounding room. */
const TIER_PLOT_FLOOR = 10.5;
/** The frame changes with the canvas (wraps, notes), so the height search stops within a text line. */
const TIER_HEIGHT_STEP = 16;

function withTierPlot(
  geometry: LayoutResult<GridMarks, GridDerived>,
  panels: GridPanelSpec[],
  options: GridLayoutOptions,
): LayoutResult<GridMarks, GridDerived> {
  const sizing = geometry.sizing;
  const weights = options.sharedAxis === 'category' && sharedYGroup(panels) === null ? varianceTierWeights(panels) : undefined;
  if (!weights || !sizing || geometry.refused) return geometry;
  const column = panels.findIndex((panel) => panel.type === 'column');
  const columnOptions = panels[column]!.options as { variant?: string } | undefined;
  if (columnOptions?.variant !== 'stacked') return geometry;
  // The reserve and the growth of two or more tiers apply on an open height only; a pinned canvas
  // reports the tier height alone.
  const open = (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height === false;
  const hides = open && sliversHidden(geometry);
  const { width, height } = geometry.size;
  const plots = geometry.marks.panels.map((panel) => panel.chart?.geometry.plot.h ?? 0);
  const share = weights.reduce((sum, weight) => sum + weight, 0) / weights[column]!;
  const need = autoPlotPx(options.target ?? DEFAULT_TARGET, width) * share;
  // The stacked-column reserve (stackedColumnPlotPx) a column alone adds for its segment values,
  // scaled by the tier weights. The grid adds it only when a value needs more column plot than the
  // tier height gives, so a card that prints every value keeps that height (grid.tiers).
  const reservePlot = stackedColumnPlotPx('column', columnOptions, width);
  const reserve = Math.ceil(reservePlot * share);
  const reach = need / share + reservePlot;
  const squashed = plots.some((plot) => plot <= TIER_PLOT_FLOOR);
  // The column plot each segment value needs: its label height plus STACK_ROOM over its segment,
  // scaled to the plot. It does not change with the probe height, squashed or not, so the guesses
  // agree from probe to probe. A value the author withholds (label: false) is not owed.
  const id = panels[column]!.id;
  const columnData = panels[column]!.data as { categories?: { id: string }[]; series?: { id: string; values: unknown[] }[] } | undefined;
  const withheld = new Set(columnData?.series?.flatMap((series) => series.values.flatMap((cell, index) =>
    cellMeta(cell as never)?.label === false ? [`${id}/segment:${series.id}:${columnData.categories?.[index]?.id}`] : [])) ?? []);
  const needs = hides ? geometry.labels.filter((label) => label.id.startsWith(`${id}/segment:`) && !withheld.has(label.id)).map((label) => {
    const mark = geometry.scene.find((node) => node.id === label.id.replace('/segment:', '/mark:')) as { rect?: Rect } | undefined;
    return plots[column]! * (((label as DigitSeated)[DIGIT_SEAT]?.lineH ?? label.rect.h) + STACK_ROOM) / (mark?.rect?.h ?? 0);
  }) : [];
  // The largest need the reserve can meet: growing past it prints nothing more.
  const wanted = Math.max(0, maxOf(needs.filter((plot) => plot <= reach)));
  // The column plot the grid draws at its natural height without growth.
  const drawn = plots[column]! + (sizing.naturalHeight - height) / share;
  // A grid of two or more tiers grows only for a value its natural height does not print and growth can (each
  // growth pass lays all tiers out). Otherwise it keeps the original height and layout; a grown probe that
  // prints every value is its natural height.
  if (weights.length > 2 && (!open || !hides || wanted <= drawn + 0.5)) {
    return open && !hides && height > sizing.naturalHeight ? { ...geometry, sizing: { ...sizing, fit: 'content', naturalHeight: height } } : geometry;
  }
  const tierHeight = Math.ceil(height + need - plots.reduce((sum, plot) => sum + plot, 0)
    - (squashed ? Math.max(0, sizing.minHeight - height) : 0) - 1e-6);
  // A probe the reserve raised that prints every value is the natural height.
  if (open && !squashed && !hides && height > sizing.naturalHeight
    && height > tierHeight + 2 * TIER_HEIGHT_STEP && height <= tierHeight + reserve + 2 * TIER_HEIGHT_STEP) {
    return { ...geometry, sizing: { ...sizing, fit: 'content', naturalHeight: height } };
  }
  // One tier takes the reserve when a value needs more column plot than the grid draws without it:
  // the tier height's, or more at a natural height above it (960 px: 16:9). A squashed probe keeps
  // frame its canvas does not show, so it does not measure what the grid draws.
  const found = !squashed && wanted > Math.max(need / share, drawn) ? tierHeight + reserve : tierHeight;
  if (found <= sizing.naturalHeight + (squashed ? TIER_HEIGHT_STEP : 0)) {
    return squashed ? { ...geometry, sizing: { ...sizing, fit: 'content' } } : geometry;
  }
  // A canvas within TIER_HEIGHT_STEP of the height it needs (or two steps above it, as the
  // frame shifts) is the natural height; a squashed guess is always measured again.
  const naturalHeight = !squashed && found - height <= TIER_HEIGHT_STEP && height - found <= 2 * TIER_HEIGHT_STEP ? height : found;
  return { ...geometry, sizing: { ...sizing, fit: 'content', naturalHeight } };
}

/**
 * A one-column grid with one fill chart panel on a page canvas (NARROW_SHARE_WIDTH
 * up to the wide class) reports as its natural height the frame around the
 * panel plus the plot the panel's type reserves on its own (autoPlotPx and the
 * stacked-column reserve), never taller than the 16:9 height it had (grid.panels at 960: 468 px, not 540). Cards keep
 * their rule; the sliver search still grows the grid when a segment value hides.
 */
function withOnePanelContent(
  geometry: LayoutResult<GridMarks, GridDerived>,
  relayout: (options: GridLayoutOptions) => LayoutResult<GridMarks, GridDerived>,
  panels: readonly { type: string; options?: unknown }[],
  options: GridLayoutOptions,
): LayoutResult<GridMarks, GridDerived> {
  const sizing = geometry.sizing;
  const target = options.target ?? DEFAULT_TARGET;
  const { width, height } = geometry.size;
  const columns = options.sharedAxis === 'category' || options.sharedAxis === undefined ? 1 : Math.max(1, Number(options.columns ?? 1));
  if (!sizing || sizing.fit !== 'fill' || geometry.refused || columns !== 1 || panels.length !== 1
    || width < NARROW_SHARE_WIDTH || width >= WIDE_CANVAS_MIN_WIDTH) return geometry;
  const panel = panels[0]!;
  const plotPx = autoPlotPx(target, width) + stackedColumnPlotPx(panel.type, panel.options as object | undefined, width);
  const content = (probe: Geometry<GridMarks, GridDerived>) => {
    const chart = probe.marks.panels[0]?.chart?.geometry;
    return chart && chart.sizing?.fit === 'fill' ? Math.ceil(probe.size.height - chart.plot.h + plotPx - 1e-6) : undefined;
  };
  // A probe squashed below the content height measures a plot that does not
  // shrink with the canvas, so the frame is measured again at the first guess.
  let found = content(geometry);
  if (found === undefined) return geometry;
  found = Math.min(sizing.naturalHeight, found);
  if (Math.abs(found - height) > 1) {
    const probe = relayout({ ...options, size: { ...resolveSize(options.size), width, height: found } });
    const again = probe.refused ? undefined : content(probe);
    if (again !== undefined) found = Math.min(sizing.naturalHeight, again);
  }
  const naturalHeight = Math.max(sizing.minHeight, found);
  return naturalHeight === sizing.naturalHeight ? geometry : { ...geometry, sizing: { ...sizing, naturalHeight } };
}

interface AuthoredPlacement {
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
}

interface AuthoredChild {
  panel: GridPanelSpec;
  placement: AuthoredPlacement;
  slot: Rect;
  geometry: Geometry;
  recordOptions?: () => object;
  margin: { top?: number; right?: number; bottom?: number; left?: number };
  relayout?: (margin: AuthoredChild['margin'], kpiValueSize?: number) => Geometry;
}

function usesAuthoredLayout(panels: GridPanelSpec[], options: GridLayoutOptions): boolean {
  return (
    Array.isArray(options.columns) ||
    options.rows !== undefined ||
    options.gutters !== undefined ||
    options.anchors !== undefined ||
    options.alignmentRules !== undefined ||
    panels.some(
      (panel) =>
        panel.type === 'text' ||
        panel.type === 'legend' ||
        panel.row !== undefined ||
        panel.column !== undefined ||
        panel.span !== undefined ||
        panel.align !== undefined,
    )
  );
}

function isAuthoredVarianceStack(panels: GridPanelSpec[], options: GridLayoutOptions): boolean {
  if ((options.sharedAxis ?? 'category') !== 'category' || !varianceTierWeights(panels)) return false;
  const columns = Array.isArray(options.columns) ? options.columns.length
    : options.columns ?? Math.max(1, Math.ceil(Math.sqrt(panels.length)));
  const placements = panels.map((panel, index) => ({
    row: panel.row ?? Math.floor(index / columns),
    column: panel.column ?? index % columns,
  }));
  return new Set(placements.map((placement) => placement.column)).size === 1 &&
    new Set(placements.map((placement) => placement.row)).size === panels.length &&
    panels.every((panel) => (panel.span?.rows ?? 1) === 1 && (panel.span?.columns ?? 1) === 1);
}

function layoutAuthoredGrid(
  rawPanels: GridPanelSpec[],
  options: GridLayoutOptions,
  repeatFacet: boolean,
): LayoutResult<GridMarks, GridDerived> {
  const theme = themeForWidth(resolveTheme(options.theme), gridTypeClass(options));
  const size = resolveSize(options.size);
  const measure = options.measure ?? defaultMeasurer;
  const warnings: LintWarning[] = [];
  let automaticRows = options.rows === undefined;
  const naturalTierWeights = options.sharedAxis === 'category' && options.rows === undefined && sharedYGroup(rawPanels) === null
    ? varianceTierWeights(rawPanels) : undefined;
  if (options.sharedAxis === 'category') {
    const bottomUp = bottomUpTierOrder(rawPanels);
    const weights = tierWeights(rawPanels);
    const columns = Array.isArray(options.columns) ? options.columns.length : options.columns;
    if ((columns ?? 1) !== 1 || options.panelOrder !== undefined || rawPanels.some(panel => panel.row !== undefined || panel.column !== undefined || panel.span !== undefined)
      || (options.rows !== undefined && options.rows.length !== rawPanels.length)) {
      warnings.push({ code: 'grid-tier-order', severity: 'warn',
        message: 'Category tiers use one column and bottom-up order, with the category-axis owner at the bottom; authored placement and panelOrder do not set their visual order',
        suggest: "use sharedAxis: 'none' for authored facet placement" });
    }
    const authoredWeights = options.rows?.length === rawPanels.length ? options.rows : weights;
    options = { ...options, columns: 1, rows: [...bottomUp].reverse().map(index => authoredWeights[index]!) };
    rawPanels = rawPanels.map((panel, index) => ({ ...panel,
      row: rawPanels.length - 1 - bottomUp.indexOf(index), column: 0, span: undefined,
    }));
  }
  ({ panels: rawPanels, options } = stackNarrowReadouts(rawPanels, options, theme, measure, size.width));
  const stacked = stackCompactPanels(rawPanels, options, size.width);
  // The one-column stack drops the authored row weights: its rows fit their content.
  if (stacked.options !== options) automaticRows = true;
  ({ panels: rawPanels, options } = stacked);
  if (options.valueAxis?.break) {
    warnings.push({
      code: 'axis-break-unsupported',
      severity: 'warn',
      message: "chart type 'grid' does not support valueAxis.break — ignored",
    });
  }

  const legendItems = collectGridLegendItems(rawPanels, options, measure);
  let legendInput: FrameInput['legend'];
  if (options.legend && options.legend !== 'none' && options.legend !== 'auto') {
    const legendOptions: LegendOptions = normalizeLegendOption(options.legend);
    legendInput = gridLegendInput(legendItems, legendOptions, options, warnings);
  }

  const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const frameResult = solveFrame(
    {
      size,
      margin: { ...canvasMargin(theme, size.width), ...options.margin },
      ...frameTextOptions(options),
      legend: legendInput,
      theme,
      measure,
    },
    occupied,
  );
  const area = frameResult.plot;

  const authoredColumnCount =
    Array.isArray(options.columns)
      ? options.columns.length
      : typeof options.columns === 'number'
        ? options.columns
        : undefined;
  const fallbackColumns = authoredColumnCount ?? (options.rows
    ? Math.max(1, Math.ceil(rawPanels.length / options.rows.length)) : Math.max(1, Math.ceil(Math.sqrt(rawPanels.length))));
  const provisional = rawPanels.map((panel, index): AuthoredPlacement => ({
    row: panel.row ?? Math.floor(index / fallbackColumns),
    column: panel.column ?? index % fallbackColumns,
    rowSpan: panel.span?.rows ?? 1,
    columnSpan: panel.span?.columns ?? 1,
  }));
  provisional.forEach((entry, index) => {
    const exceedsRows =
      options.rows !== undefined && entry.row + entry.rowSpan > options.rows.length;
    const exceedsColumns =
      authoredColumnCount !== undefined &&
      entry.column + entry.columnSpan > authoredColumnCount;
    if (!exceedsRows && !exceedsColumns) return;
    const panel = rawPanels[index]!;
    throw new NormalizeError(
      'grid-span-exceeds-tracks',
      `panels[${index}].span`,
      `panel '${panel.id}' spans to row ${entry.row + entry.rowSpan} and column ${entry.column + entry.columnSpan}, outside the authored ${options.rows?.length ?? 'derived'}×${authoredColumnCount ?? 'derived'} grid`,
      'add tracks or reduce the span',
    );
  });
  // One cell, one panel: a second panel there would be drawn over the first.
  const occupant = new Map<string, number>();
  provisional.forEach((entry, index) => {
    for (let r = entry.row; r < entry.row + entry.rowSpan; r++) {
      for (let c = entry.column; c < entry.column + entry.columnSpan; c++) {
        const first = occupant.get(`${r}:${c}`);
        if (first !== undefined) {
          throw new NormalizeError(
            'grid-cell-overlap',
            `panels[${index}]`,
            `panels '${rawPanels[first]!.id}' and '${rawPanels[index]!.id}' both occupy row ${r}, column ${c}`,
            'move a panel or reduce its span',
          );
        }
        occupant.set(`${r}:${c}`, index);
      }
    }
  });
  const columnCount = Math.max(
    authoredColumnCount ?? 0,
    maxOf(provisional.map((entry) => entry.column + entry.columnSpan)),
  );
  const rowCount = Math.max(
    options.rows?.length ?? 0,
    maxOf(provisional.map((entry) => entry.row + entry.rowSpan)),
  );
  if (columnCount <= 0 || rowCount <= 0) {
    throw new NormalizeError('grid-empty-tracks', 'options.rows', 'grid requires row and column tracks');
  }
  let rowWeights = options.rows ?? Array.from({ length: rowCount }, () => 1);
  const columnWeights = Array.isArray(options.columns)
    ? options.columns
    : Array.from({ length: columnCount }, () => 1);
  if (rowWeights.length !== rowCount || columnWeights.length !== columnCount) {
    throw new NormalizeError(
      'grid-track-count',
      'options',
      `tracks declare ${rowWeights.length}×${columnWeights.length}; panels require ${rowCount}×${columnCount}`,
    );
  }
  const rowGaps = resolveGaps(options.gutters?.rows, rowCount - 1, theme.space.tierGap, 'rows');
  const columnGaps = resolveGaps(options.gutters?.columns, columnCount - 1, theme.space.facetGap, 'columns');
  let rowBands = trackBands(area.y, area.h, rowWeights, rowGaps, options.gutters?.rows !== undefined);
  const baseColumnBands = trackBands(area.x, area.w, columnWeights, columnGaps, options.gutters?.columns !== undefined);

  const scaledPanels = resolveSharedYDomains(
    rawPanels.filter((panel) => panel.type !== 'text' && panel.type !== 'legend'),
    options,
    repeatFacet,
  );
  pushAll(warnings, scaledPanels.warnings);
  const scaledById = new Map(scaledPanels.panels.map((panel) => [panel.id, panel]));
  let panels = rawPanels.map((panel) => scaledById.get(panel.id) ?? panel);

  const baseChildSlots = provisional.map((placement, index) => {
    const raw = spanRect(rowBands, baseColumnBands, placement);
    return alignInside(raw, panels[index]!.align);
  });
  let uniformLineEndpointLegend = false;
  const layoutChildren = (slots: Rect[]): AuthoredChild[] =>
    panels.map((panel, index) =>
      layoutAuthoredChild(
        panel,
        provisional[index]!,
        slots[index]!,
        panels,
        options,
        legendItems,
        theme,
        measure,
      ),
    );
  const uniformizeLineEndpointIdentity = (
    children: AuthoredChild[],
    slots: Rect[],
  ): AuthoredChild[] => {
    if (
      uniformLineEndpointLegend ||
      gridPanelsKeepEndNames(options) ||
      !children.some(
        (child) =>
          child.panel.type === 'line' &&
          (child.geometry.derived as { endpointLabelEconomy?: { strategy?: unknown } })
            .endpointLabelEconomy?.strategy === 'legend',
      )
    ) return children;
    uniformLineEndpointLegend = true;
    panels = panels.map((panel) =>
      panel.type === 'line'
        ? {
            ...panel,
            options: { ...panel.options, gridEndpointIdentity: 'legend' },
          }
        : panel,
    );
    return layoutChildren(slots);
  };
  try {
  let children = uniformizeLineEndpointIdentity(layoutChildren(baseChildSlots), baseChildSlots);

  const sharedAnchors: Record<string, number> = emptyIdRecord();
  let columnBands = baseColumnBands;
  if (
    options.anchors?.categories === 'column' ||
    options.anchors?.categories === 'all'
  ) {
    columnBands = categoryColumnBands(
      children,
      baseColumnBands,
      columnGaps,
      warnings,
    );
    if (columnBands !== baseColumnBands) {
      const anchoredSlots = provisional.map((placement, index) => {
        const columns =
          placement.columnSpan === 1 ? columnBands : baseColumnBands;
        return alignInside(
          spanRect(rowBands, columns, placement),
          panels[index]!.align,
        );
      });
      children = uniformizeLineEndpointIdentity(layoutChildren(anchoredSlots), anchoredSlots);
    }
    const indents = readoutIndents(children, columnBands.length);
    if (indents.size > 0) {
      panels = panels.map((panel) => indents.has(panel.id) ? { ...panel, readoutIndent: indents.get(panel.id) } as ReadoutPanel : panel);
      children = children.map((child, index) => indents.has(child.panel.id)
        ? layoutAuthoredChild(panels[index]!, child.placement, child.slot, panels, options, legendItems, theme, measure) : child);
    }
  }
  const columnRects = columnBands.map((band) => ({
    x: band.start,
    y: area.y,
    w: band.size,
    h: area.h,
  }));
  const edgeScopes = new Set<GridTrackScope>(options.sharedAxis === 'category' ? ['column'] : []);
  if (options.anchors?.plotEdges) edgeScopes.add(options.anchors.plotEdges);
  if (options.anchors?.categories) edgeScopes.add(options.anchors.categories);
  for (const scope of edgeScopes) {
    if (scope === 'row') continue;
    children = alignPlotEdges(children, scope, sharedAnchors, warnings, theme);
  }
  if (options.anchors?.categories && options.anchors.categories !== 'row') {
    const moved = Math.max(0, maxOf(scopeGroups(children, options.anchors.categories).map(group => alignCategoryPanels(group, theme))));
    // Both anchors cannot hold while a type insets its bands: the centres win, and the
    // edge anchors they moved are no longer exact, so they leave sharedAnchors.
    if (moved > 0.01) for (const key of Object.keys(sharedAnchors)) if (key.startsWith('plotEdges:')) delete sharedAnchors[key];
    if (moved > 0.01 && options.anchors.plotEdges) {
      warnings.push({
        code: 'grid-anchor-incompatible',
        severity: 'warn',
        message: `category centres are aligned across panels whose types inset their categories differently, so their plot edges differ by up to ${Math.round(moved * 10) / 10}px`,
      });
    }
  }
  if (automaticRows) {
    // The common figure size can shorten a card. Measure rows after fitting it.
    const valueSize = smallestKpiValueSize(children.map(child => child.geometry));
    if (valueSize !== undefined) {
      for (const child of children) {
        if (hasKpiFigure(child.panel.type)) child.geometry = child.relayout!(child.margin, valueSize);
      }
    }
    const heights = gridRowHeights(area.h, children.map(child => ({ geometry: child.geometry, ...child.placement })), rowWeights, rowGaps);
    if (heights) {
      let y = area.y;
      rowBands = heights.map((height, row) => {
        const band = { start: y, size: height };
        y += height + (rowGaps[row] ?? 0);
        return band;
      });
      children = children.map(child => {
        Object.assign(child.slot, alignInside(spanRect(rowBands,
          child.placement.columnSpan === 1 ? columnBands : baseColumnBands, child.placement), child.panel.align));
        return child.relayout ? { ...child, geometry: child.relayout(child.margin, valueSize) }
          : layoutAuthoredChild(child.panel, child.placement, child.slot, panels, options, legendItems, theme, measure);
      });
    }
  }
  if (naturalTierWeights) {
    // Final margins can change header wrapping and label rows. Balance the
    // plots after alignment, preserving the margins that alignment measured.
    const wrap = () => children.map(child => ({ child, geo: child.geometry }));
    const tierSlots = children.map(child => child.slot);
    for (let pass = 0; pass < 3; pass++) {
      balanceVarianceTierPlots(tierSlots, wrap(), naturalTierWeights, () => {
        for (const child of children) child.geometry = child.relayout!(child.margin);
        return wrap();
      });
    }
    // Automatic tiers spend the canvas on visible content, like the compact
    // composition path. Empty child margins do not become extra tier gutters.
    const contentHeight = () => children.reduce((sum, child) => sum + authoredOccupiedBounds(child.geometry).h, 0);
    const available = area.h - rowGaps.reduce((sum, gap) => sum + gap, 0);
    const weight = naturalTierWeights.reduce((sum, value) => sum + value, 0);
    const packed = children.every(child => !child.panel.align) && !options.anchors?.baselines;
    if (packed && children.every(child => child.slot.h >= (child.geometry.sizing?.minHeight ?? 0))) {
      for (let pass = 0; pass < 8; pass++) {
        const slack = available - contentHeight();
        if (slack < 1) break;
        const previous = children.map(child => child.slot.h);
        let accepted = false;
        for (let backoff = 0; backoff < 8; backoff++) {
          children.forEach((child, index) => {
            child.slot.h = previous[index]! + slack * naturalTierWeights[index]! / weight / 2 ** backoff;
            child.geometry = child.relayout!(child.margin);
          });
          balanceVarianceTierPlots(tierSlots, wrap(), naturalTierWeights, () => {
            for (const child of children) child.geometry = child.relayout!(child.margin);
            return wrap();
          });
          if (contentHeight() <= available) { accepted = true; break; }
        }
        if (!accepted) {
          children.forEach((child, index) => {
            child.slot.h = previous[index]!;
            child.geometry = child.relayout!(child.margin);
          });
          break;
        }
      }
    }
    rowWeights = rowWeights.map((_, row) => tierSlots[provisional.findIndex(p => p.row === row)]!.h);
    rowBands = trackBands(area.y, area.h, rowWeights, rowGaps, options.gutters?.rows !== undefined);
    tierSlots.forEach((slot, index) => { slot.y = rowBands[provisional[index]!.row]!.start; });
    let bottom = area.y + area.h;
    for (const index of packed ? bottomUpTierOrder(panels) : []) {
      const child = children[index]!;
      const bounds = authoredOccupiedBounds(child.geometry);
      child.slot.y = bottom - bounds.y - bounds.h;
      rowBands[child.placement.row] = { start: bottom - bounds.h, size: bounds.h };
      bottom -= bounds.h + (rowGaps[child.placement.row - 1] ?? 0);
    }
  }
  const rowRects = rowBands.map((band) => ({ x: area.x, y: band.start, w: area.w, h: band.size }));
  if (
    options.anchors?.categories === 'column' ||
    options.anchors?.categories === 'all'
  ) {
    recordCategoryColumnAnchors(children, columnBands, sharedAnchors, warnings);
  }
  if (options.anchors?.baselines) {
    children = alignBaselines(children, options.anchors.baselines, sharedAnchors);
  }
  // The resolver's membership, not the authored scaleGroup: a clamped or log panel left its group.
  const keepBaselines = options.anchors?.baselines ? {
    top: (child: AuthoredChild) => child.margin.top ?? numeric(isRecord(child.panel.options?.margin) ? child.panel.options.margin.top : undefined, 20),
    above: (child: AuthoredChild) => {
      const baseline = baselineY(child.geometry);
      const { y, h } = child.geometry.plot;
      return baseline === null || !(h > 0) ? 1 : Math.min(1, Math.max(0, (baseline - y) / h));
    },
  } : undefined;
  for (const [group, ids] of Object.entries(scaledPanels.members)) {
    if (group === DEFAULT_Y_GROUP || !scaledPanels.domains[group]) continue;
    alignValuePanels(children.filter(child => ids.includes(child.panel.id)), theme, keepBaselines);
  }
  // Alignment can narrow a panel or change its available height. Fit the
  // common figure size only after every pass that changes those constraints.
  const kpiValueSize = smallestKpiValueSize(children.map(child => child.geometry));
  if (kpiValueSize !== undefined) {
    for (const child of children) {
      if (hasKpiFigure(child.panel.type)) child.geometry = child.relayout!(child.margin, kpiValueSize);
    }
  }

  const scene: SceneNode[] = [...frameResult.nodes];
  const labels: PlacedLabel[] = [];
  const axes: AxisGeometry[] = [];
  const annotations: Geometry['annotations'] = [];
  const occupiedAll = occupied.snapshot().slice();
  const decisions: Geometry['debug']['decisions'] = [];
  const marks: GridMarks = { panels: [], alignmentRules: [] };

  for (const child of children) {
    const need = child.geometry.sizing;
    if (options.sharedAxis === 'category' && child.geometry.size.height + 1e-6 < (child.geometry.frame.plotMinHeight ?? 0)) {
      warnings.push({ code: 'grid-panel-too-short', severity: 'warn',
        message: `panel '${child.panel.id}' is below its measured plot height floor`,
        suggest: 'increase its authored rows weight or increase the grid height',
      });
    }
    if (child.panel.align && (child.slot.w < (need?.minWidth ?? 0) || child.slot.h < (need?.minHeight ?? child.geometry.frame.minHeight ?? 0))) {
      warnings.push({ code: 'grid-panel-too-short', severity: 'error',
        message: `panel '${child.panel.id}' needs a larger fixed alignment size`,
      });
    }
    appendAuthoredChild(child, scene, labels, axes, annotations, occupiedAll, decisions, warnings, marks);
  }

  const childById = new Map(children.map((child) => [child.panel.id, child]));
  const ruleIds = new Set<string>();
  for (const rule of options.alignmentRules ?? []) {
    if (ruleIds.has(rule.id)) {
      throw new NormalizeError(
        'duplicate-id',
        'options.alignmentRules',
        `duplicate alignment rule id '${rule.id}' — ids key guide scene identities`,
      );
    }
    ruleIds.add(rule.id);
    const source = childById.get(rule.at.panelId);
    if (!source) {
      throw new NormalizeError(
        'grid-rule-panel',
        `options.alignmentRules.${rule.id}.at.panelId`,
        `alignment rule '${rule.id}' names unknown panel '${rule.at.panelId}'`,
      );
    }
    const coordinate = resolveRuleCoordinate(source, rule.at.anchor, rule.at.categoryId);
    if (coordinate === null || coordinate.axis !== (rule.orientation === 'vertical' ? 'x' : 'y')) {
      throw new NormalizeError(
        'grid-rule-anchor',
        `options.alignmentRules.${rule.id}.at`,
        `alignment rule '${rule.id}' cannot resolve ${rule.orientation} guide from ${rule.at.anchor}${rule.at.categoryId ? ` '${rule.at.categoryId}'` : ''} on panel '${source.panel.id}'`,
      );
    }
    const from = rule.fromPanelId ? childById.get(rule.fromPanelId) : undefined;
    const to = rule.toPanelId ? childById.get(rule.toPanelId) : undefined;
    if ((rule.fromPanelId && !from) || (rule.toPanelId && !to)) {
      throw new NormalizeError(
        'grid-rule-panel',
        `options.alignmentRules.${rule.id}`,
        `alignment rule '${rule.id}' names an unknown from/to panel`,
      );
    }
    const nodeId = `grid:alignment:${rule.id}`;
    if (rule.orientation === 'vertical') {
      const y1 = from?.slot.y ?? area.y;
      const y2 = (to?.slot.y ?? area.y) + (to?.slot.h ?? area.h);
      const runs = guideRuns(occupiedAll, 'vertical', coordinate.value, y1, y2);
      scene.push(runs.length === 1 && runs[0]![0] === Math.min(y1, y2) && runs[0]![1] === Math.max(y1, y2)
        ? { t: 'line', id: nodeId, x1: coordinate.value, y1, x2: coordinate.value, y2, stroke: { token: 'grid' }, width: strokeToken(theme, 'hair'), owner: {}, part: 'alignmentRule' }
        : { t: 'path', id: nodeId, d: runs.map(([a, b]) => `M${fmtN(coordinate.value)} ${fmtN(a)}V${fmtN(b)}`).join(''), stroke: { token: 'grid' }, width: strokeToken(theme, 'hair'), owner: {}, part: 'alignmentRule' });
      occupiedAll.push({
        rect: { x: coordinate.value - 0.5, y: Math.min(y1, y2), w: 1, h: Math.abs(y2 - y1) },
        kind: 'axis',
        owner: {},
        part: 'alignmentRule',
      });
    } else {
      const x1 = from?.slot.x ?? area.x;
      const x2 = (to?.slot.x ?? area.x) + (to?.slot.w ?? area.w);
      const runs = guideRuns(occupiedAll, 'horizontal', coordinate.value, x1, x2);
      scene.push(runs.length === 1 && runs[0]![0] === Math.min(x1, x2) && runs[0]![1] === Math.max(x1, x2)
        ? { t: 'line', id: nodeId, x1, y1: coordinate.value, x2, y2: coordinate.value, stroke: { token: 'grid' }, width: strokeToken(theme, 'hair'), owner: {}, part: 'alignmentRule' }
        : { t: 'path', id: nodeId, d: runs.map(([a, b]) => `M${fmtN(a)} ${fmtN(coordinate.value)}H${fmtN(b)}`).join(''), stroke: { token: 'grid' }, width: strokeToken(theme, 'hair'), owner: {}, part: 'alignmentRule' });
      occupiedAll.push({
        rect: { x: Math.min(x1, x2), y: coordinate.value - 0.5, w: Math.abs(x2 - x1), h: 1 },
        kind: 'axis',
        owner: {},
        part: 'alignmentRule',
      });
    }
    marks.alignmentRules!.push({ id: rule.id, nodeId, orientation: rule.orientation });
  }

  const compactNotes = children.flatMap((child) => child.geometry.a11y.compactNotes ?? []);
  return {
    type: 'grid',
    size,
    sizing: withReadoutPlotHeight(gridSizing(size, area, children.map(child => ({ geometry: child.geometry, ...child.placement })), rowWeights, columnWeights, rowGaps, columnGaps, automaticRows),
      size, automaticRows ? children : []),
    plot: area,
    scene,
    labels,
    axes,
    annotations,
    frame: frameResult.frame,
    legend: frameResult.legend,
    marks,
    derived: {
      tracks: { rows: rowRects, columns: columnRects, rowGaps, columnGaps },
      ...(Object.keys(sharedAnchors).length > 0 ? { sharedAnchors } : {}),
      ...(Object.keys(scaledPanels.domains).length > 0 ? { sharedYDomains: scaledPanels.domains } : {}),
    },
    a11y: {
      titleCounts: [structureCount('panels', panels.length, undefined, options)],
      title: accessibleTitle(options.title, chartString(options, 'gridPanelsTitle', { v1: panels.length })),
      counts: [
        structureCount('rows', rowCount, chartString(options, 'authoredRows', { v1: rowCount })),
        structureCount('columns', columnCount, chartString(options, 'compositionColumns', { v1: columnCount })),
        ...children.flatMap(child => {
          const title = child.panel.title ?? child.geometry.a11y.title;
          return [...(child.geometry.a11y.counts ?? []), ...(child.geometry.a11y.titleCounts ?? [])]
            .filter(count => title.includes(count.text));
        }),
      ],
      desc: chartString(options, 'gridComposition', { v1: rowCount, v2: columnCount, v3: marks.panels.map((panel) => panel.title).join('; '), v4: compactNotes.length > 0 ? chartString(options, 'notesClause', { v1: compactNotes.join('; ') }) : '' }),
      ...(compactNotes.length > 0 ? { compactNotes } : {}),
    },
    warnings,
    debug: { occupied: occupiedAll, decisions },
  };
  } catch (error) {
    if (!(error instanceof GridChildRefusal)) throw error;
    const index = panels.findIndex(panel => panel.id === error.panelId);
    return error.result(size, gridSizing(size, area, [{ geometry: error.child, ...provisional[index]! }],
      rowWeights, columnWeights, rowGaps, columnGaps, automaticRows), index);
  }

}

function layoutAuthoredChild(
  panel: GridPanelSpec,
  placement: AuthoredPlacement,
  slot: Rect,
  panels: GridPanelSpec[],
  parentOptions: GridLayoutOptions,
  allLegendItems: LegendItemInput[],
  theme: ReturnType<typeof resolveTheme>,
  measure: TextMeasurer,
): AuthoredChild {
  if (panel.type === 'text') {
    return {
      panel,
      placement,
      slot,
      margin: {},
      geometry: layoutTextPanel(panel, slot, theme, measure),
    };
  }
  if (panel.type === 'legend') {
    const parsed = parseGridLegendPanelData(panel.data);
    const allow = parsed.from ? new Set(parsed.from) : undefined;
    const items = allow
      ? collectGridLegendItems(
          panels.filter((candidate) => allow.has(candidate.id)),
          parentOptions,
          measure,
        )
      : allLegendItems;
    return {
      panel,
      placement,
      slot,
      margin: {},
      geometry: layoutLegendPanel(panel, slot, items, theme, measure, parentOptions),
    };
  }
  const definition = getChart(panel.type);
  if (!definition) {
    throw new NormalizeError(
      'unknown-type',
      `panels[${panel.id}].type`,
      `unknown chart type '${panel.type}'`,
    );
  }
  const authoredOptions = panel.options ?? {};
  const compactTiers = parentOptions.sharedAxis === 'category' && panels.length > 1;
  const authoredTitle = panel.title ?? (typeof authoredOptions.title === 'string' ? authoredOptions.title : undefined);
  const panelOptions = parentOptions.sharedAxis === 'category' && panels.indexOf(panel) !== sharedCategoryLabelOwner(panels)
    ? { ...authoredOptions, labels: withoutCategoryLabels(authoredOptions.labels) } : authoredOptions;
  const authoredMargin = isRecord(panelOptions.margin) ? panelOptions.margin : {};
  let recordOptions: object;
  const relayout = (margin: AuthoredChild['margin'], kpiValueSize?: number): Geometry => {
    const captionPanel = compactTiers ? { ...panel, title: panelOptions.title === false ? undefined : authoredTitle } : panel;
    const captionHeight = () => measureCaptionBand(captionPanel, theme, measure, slot.w, compactTiers);
    const marginTop = numeric(margin.top ?? authoredMargin.top, 20);
    const resolvedOptions = {
      ...definition.defaults,
      ...panelOptions,
      ...((panelOptions.locale ?? parentOptions.locale) === undefined ? {} : { locale: panelOptions.locale ?? parentOptions.locale }),
      ...(Object.keys(authoredStrings(parentOptions) ?? {}).length ? { strings: { ...authoredStrings(parentOptions), ...(panelOptions.strings as object) } } : {}),
      ...(compactTiers && panelOptions.title !== false && (authoredTitle !== undefined || panel.type === 'variance') ? { title: '' } : {}),
      ...(hasKpiFigure(panel.type) && kpiValueSize !== undefined ? { [KPI_VALUE_SIZE]: kpiValueSize } : {}),
      ...(panel.type === 'kpi' ? { [KPI_HOST_TEXT]: stringsIn([panel.title, panel.caption, parentOptions.title, parentOptions.subtitle, parentOptions.footnotes, parentOptions.source]) } : {}),
      ...(panel.type === 'variance' && isAuthoredVarianceStack(panels, parentOptions) ? { [VARIANCE_TIER]: panels.length } : {}),
      ...(panel.annotations ? { annotations: panel.annotations } : {}),
      ...(parentOptions.palette !== undefined && panelOptions.palette === undefined
        ? { palette: parentOptions.palette }
        : {}),
      // A status panel resolves its hatch strength in its own layout.
      ...hatchStrengthFor(panelOptions, parentOptions),
      theme: panelOptions.theme ?? parentOptions.theme,
      target: parentOptions.target,
      size: { width: slot.w, height: slot.h },
      margin: { ...authoredMargin, ...margin, top: compactTiers ? Math.max(marginTop, captionHeight())
        : marginTop + measureCaptionBand({ ...panel, options: { ...panelOptions, margin: { ...authoredMargin, ...margin } } }, theme, measure, slot.w) },
      measure,
      typeClass: gridTypeClass(parentOptions),
    };
    let geometry = layoutChildChart(panel.data, resolvedOptions, definition.layout as (data: unknown, options: unknown) => LayoutResult);
    if (geometry.refused) throw new GridChildRefusal(panel.id, geometry);
    const tierName = (geometry.derived as { tierName?: string }).tierName;
    if (compactTiers && panelOptions.title !== false && !captionPanel.title && tierName) {
      captionPanel.title = tierName;
      if (captionHeight() > resolvedOptions.margin.top) {
        resolvedOptions.margin.top = captionHeight();
        geometry = layoutChildChart(panel.data, resolvedOptions, definition.layout as (data: unknown, options: unknown) => LayoutResult);
        if (geometry.refused) throw new GridChildRefusal(panel.id, geometry);
      }
    }
    const { measure: _measure, ...serializable } = resolvedOptions;
    recordOptions = serializable;
    const captionY = compactTiers && isAuthoredVarianceStack(panels, parentOptions)
      ? authoredOccupiedBounds(geometry).y - resolvedOptions.margin.top - theme.space.labelPad : 0;
    const band = panelCaptionBand({ ...captionPanel, options: resolvedOptions }, theme, measure, { x: 0, y: captionY, w: slot.w, h: slot.h }, new Set(resolveHighlight(parentOptions.highlight)), compactTiers);
    pushAll(geometry.scene, band.nodes);
    pushAll(geometry.debug.occupied, band.claims);
    return geometry;
  };
  const margin = { ...authoredMargin } as AuthoredChild['margin'];
  return { panel, placement, slot, geometry: relayout(margin), margin, relayout, recordOptions: () => recordOptions };
}

/**
 * A text panel under a category of an anchored chart. `readoutLead`: the
 * grid moved it out of its column, so the category name leads its title.
 * `readoutIndent`: its prose starts at the left edge of its category's
 * marks, not at the column edge.
 */
type ReadoutPanel = GridPanelSpec & { readoutLead?: string; readoutIndent?: number };

/**
 * Each readout of a category row starts where its category's marks start
 * (grid.metric-stack: the readout under Growth starts at the left
 * edge of the Growth cluster). The chart is the panel that spans every
 * column; its x-axis ticks name the categories in column order.
 */
function readoutIndents(children: AuthoredChild[], columns: number): Map<string, number> {
  const indents = new Map<string, number>();
  const chart = children.find((child) => child.placement.column === 0 && child.placement.columnSpan === columns
    && child.geometry.axes.find((axis) => axis.axis === 'x')?.ticks.length === columns);
  const ticks = chart?.geometry.axes.find((axis) => axis.axis === 'x')?.ticks;
  if (!chart || !ticks || columns < 2) return indents;
  for (const child of children) {
    if (child.panel.type !== 'text' || child.placement.columnSpan !== 1 || (child.panel as ReadoutPanel).readoutLead) continue;
    const category = ticks[child.placement.column]?.at;
    const lefts = chart.geometry.scene.flatMap((node) => node.t === 'rect' && node.part === 'bar' && node.owner?.categoryId === category ? [node.rect.x + (node.tx ?? 0)] : []);
    if (lefts.length === 0) continue;
    const indent = chart.slot.x + minOf(lefts) - child.slot.x - TEXT_PANEL_PAD;
    // Only inward, and never so far that the prose column goes under a third of its slot.
    if (indent > 0.5 && indent < child.slot.w * 2 / 3) indents.set(child.panel.id, indent);
  }
  return indents;
}

/**
 * A row of category readouts (one text panel under each category of a chart
 * that spans every column, anchors.categories 'column' or 'all') stacks into
 * one column on a card too narrow for the row (grid.metric-stack at
 * 320 px): a readout whose title would wrap in its column takes the full width
 * instead, in category order, led by its category name, which the column
 * position does not show. Wider grids keep the authored row.
 */
function stackNarrowReadouts(
  panels: GridPanelSpec[],
  options: GridLayoutOptions,
  theme: ReturnType<typeof resolveTheme>,
  measure: TextMeasurer,
  width: number,
): { panels: GridPanelSpec[]; options: GridLayoutOptions } {
  const anchored = options.anchors?.categories === 'column' || options.anchors?.categories === 'all';
  const columns = Array.isArray(options.columns) ? options.columns.length : typeof options.columns === 'number' ? options.columns : undefined;
  if (!anchored || columns === undefined || columns < 2 || width >= CARD_CLASS_WIDTH) return { panels, options };
  const chart = panels.find((panel) => panel.type !== 'text' && panel.type !== 'legend'
    && (panel.column ?? 0) === 0 && panel.span?.columns === columns && (panel.span?.rows ?? 1) === 1);
  const categories = chart && isRecord(chart.data) && Array.isArray(chart.data.categories) ? chart.data.categories : [];
  if (!chart || categories.length !== columns) return { panels, options };
  const readouts = panels.filter((panel) => panel.type === 'text' && panel.row !== undefined && panel.row > (chart.row ?? 0)
    && panel.column !== undefined && (panel.span?.columns ?? 1) === 1 && (panel.span?.rows ?? 1) === 1);
  const row = readouts[0]?.row;
  const inRow = readouts.filter((panel) => panel.row === row);
  if (row === undefined || inRow.length !== columns || new Set(inRow.map((panel) => panel.column)).size !== columns
    || panels.some((panel) => panel !== chart && !inRow.includes(panel))) return { panels, options };
  const weights = options.columns as number[] | number;
  const shares = Array.isArray(weights) ? weights : Array.from({ length: columns }, () => 1);
  const total = shares.reduce((sum, value) => sum + value, 0);
  const margin = canvasMargin(theme, width);
  const gaps = resolveGaps(options.gutters?.columns, columns - 1, theme.space.facetGap, 'columns');
  const inner = width - margin.left - margin.right - gaps.reduce((sum, gap) => sum + gap, 0);
  const titleFont: FontSpec = { family: theme.type.family, ...theme.type.label, weight: emphasisWeight(theme) };
  const wraps = inRow.some((panel) => {
    const title = isRecord(panel.data) && typeof panel.data.title === 'string' ? panel.data.title : '';
    return title !== '' && measure(title, titleFont).width > inner * shares[panel.column!]! / total - 2 * TEXT_PANEL_PAD;
  });
  if (!wraps) return { panels, options };
  const rows = options.rows?.flatMap((weight, index) => index === row ? inRow.map(() => weight) : [weight]);
  const label = (index: number) => {
    const category = categories[index];
    return isRecord(category) ? String(category.label ?? category.id ?? '') : '';
  };
  // Stacked readouts read as one list (39 px from one readout
  // to the next at 320): 6 px between them. The rows the author placed keep
  // their gutters; the gaps the stack adds are the engine's.
  const authored = options.gutters?.rows;
  const gutters = { ...options.gutters, rows: Array.from({ length: row + columns - 1 }, (_, index) => index >= row ? READOUT_STACK_GAP
    : typeof authored === 'number' ? authored : authored?.[index] ?? theme.space.tierGap) };
  return {
    options: { ...options, ...(rows ? { rows } : {}), gutters },
    panels: panels.map((panel): ReadoutPanel => {
      if (!inRow.includes(panel)) return panel.row !== undefined && panel.row > row ? { ...panel, row: panel.row + columns - 1 } : panel;
      const lead = label(panel.column!);
      return { ...panel, row: row + panel.column!, column: 0, span: { ...panel.span, columns }, ...(lead ? { readoutLead: lead } : {}) };
    }),
  };
}

/**
 * The grid's compact form, which the registry asks for when the full grid refuses
 * (FORCE_COMPACT, `mode: 'compact'`): on a card narrower than CARD_CLASS_WIDTH an authored
 * layout of several columns takes one column. Each panel is the card's full width, in
 * authored order, the reading order of the spec (a KPI beside a waffle that spans two rows
 * would otherwise read KPI, waffle, KPI). Spans, track weights and gutters give way, and a chart
 * panel's own side margins too, unless the author set them.
 */
function stackCompactPanels(panels: GridPanelSpec[], options: GridLayoutOptions, width: number): { panels: GridPanelSpec[]; options: GridLayoutOptions } {
  // The columns the layout derives (layoutAuthoredGrid's fallbackColumns), or the panels' own.
  const authored = Array.isArray(options.columns) ? options.columns.length : options.columns
    ?? (options.rows ? Math.ceil(panels.length / options.rows.length) : Math.ceil(Math.sqrt(panels.length)));
  const columns = Math.max(authored, ...panels.map((panel) => (panel.column ?? 0) + (panel.span?.columns ?? 1)));
  // A grid inside a grid panel (it carries the parent's typeClass) keeps its layout: only the outer card stacks.
  if (options.mode !== 'compact' || panelTypeClass(options) !== undefined || width >= CARD_CLASS_WIDTH || columns < 2
    || options.anchors !== undefined || options.alignmentRules !== undefined) return { panels, options };
  const { rows: _rows, columns: _gutterColumns, ...gutters } = options.gutters ?? {};
  return {
    options: { ...options, columns: 1, rows: undefined, gutters },
    // A chart panel takes the card's width as the same chart alone does: the grid's margin, not its own beside it.
    panels: panels.map((panel, index) => ({ ...panel, row: index, column: 0, span: undefined,
      ...(panel.type === 'text' || panel.type === 'legend' ? {} : { options: { ...panel.options, margin: { left: 0, right: 0, ...(isRecord(panel.options?.margin) ? panel.options.margin : {}) } } }) })),
  };
}

/**
 * A chart over readouts is this tall: 82 px plus 0.15 of its plot width
 * (grid.metric-stack plots: about 125 px at 320, 150 at 480,
 * 185 at 720 and 220 at 960). A share of the width alone made the wide
 * plots too tall and the narrow ones flat.
 */
const READOUT_PLOT_BASE = 82;
const READOUT_PLOT_SLOPE = 0.15;

/**
 * Automatic rows give text panels their content height and the charts the
 * rest of a 16:9 canvas, which left a 50 px plot over three readouts at 480
 * and a tall empty plot at 960. A grid that holds text panels and sizes its
 * rows itself instead takes the height at which each chart plot is
 * READOUT_PLOT_BASE plus READOUT_PLOT_SLOPE of its width tall. An unpinned
 * grid is drawn at it; a pinned one keeps its size.
 */
function withReadoutPlotHeight(sizing: NonNullable<Geometry['sizing']>, size: { width: number; height: number }, children: AuthoredChild[]): NonNullable<Geometry['sizing']> {
  if (!children.some((child) => child.panel.type === 'text')) return sizing;
  const charts = children.filter((child) => child.panel.type !== 'text' && child.panel.type !== 'legend' && child.geometry.sizing?.fit !== 'content');
  if (charts.length === 0) return sizing;
  const change = maxOf(charts.map((child) => {
    const plot = child.geometry.plot;
    return READOUT_PLOT_BASE + READOUT_PLOT_SLOPE * plot.w - plot.h;
  }));
  const naturalHeight = Math.max(sizing.minHeight, Math.ceil(size.height + change));
  return { ...sizing, naturalHeight, comfortableHeight: Math.max(sizing.comfortableHeight, naturalHeight) };
}

/** The inset of a text panel's prose from its slot. */
const TEXT_PANEL_PAD = 6;
/** The gap between two stacked readouts, and their inset above and below. */
const READOUT_STACK_GAP = 6;
const READOUT_STACK_PAD = 2;

function layoutTextPanel(
  panel: GridPanelSpec,
  slot: Rect,
  theme: ReturnType<typeof resolveTheme>,
  measure: TextMeasurer,
): Geometry {
  const data = parseGridTextPanelData(panel.data);
  const occupied = createOccupiedIndex({ x: 0, y: 0, w: slot.w, h: slot.h });
  const titleFont: FontSpec = { family: theme.type.family, ...theme.type.label, weight: emphasisWeight(theme) };
  const bodyFont: FontSpec = { family: theme.type.family, ...theme.type.label };
  const requests: LabelRequest[] = [];
  const pad = TEXT_PANEL_PAD;
  const indent = (panel as ReadoutPanel).readoutIndent ?? 0;
  // A stacked readout names its category before the title, in the body weight,
  // and sets its title and prose as one tight block. A readout's prose runs
  // to its slot's right edge: the column gutter already parts it from the next.
  const lead = (panel as ReadoutPanel).readoutLead;
  const cap = Math.max(20, slot.w - pad * (lead || indent > 0 ? 1 : 2) - indent);
  const padY = lead ? READOUT_STACK_PAD : pad;
  let y = padY;
  let lastGap = 0;
  const leadGap = measure('\u2002', bodyFont).width;
  const leadWidth = lead && data.title ? measure(lead, bodyFont).width + leadGap : 0;
  const add = (
    id: string,
    text: string,
    font: FontSpec,
    priority: number,
    prefix = '',
    offset = 0,
  ) => {
    // Authored prose wraps to as many lines as it needs: a panel never drops words.
    const lines = wrapMeasured(`${prefix}${text}`, font, Math.max(20, cap - offset), Number.MAX_SAFE_INTEGER, measure);
    const w = Math.max(1, ...lines.map((line) => measure(line, font).width));
    const h = lines.length * font.size * (font.lineHeight ?? 1.2);
    requests.push({
      id,
      kind: 'annotation',
      typeRole: font === titleFont ? 'axis' : 'label',
      owner: { categoryId: panel.id },
      text: lines.join(' '),
      lines,
      font,
      priority,
      candidates: [{ slot: 'panelFlow', rect: { x: pad + indent + offset, y, w, h }, penalty: 0 }],
      // Authored panel prose: a note, never a value label.
      role: 'note',
    });
    lastGap = font === titleFont ? (lead || indent > 0 ? 4 : 6) : 4;
    y += h + lastGap;
  };
  if (lead && data.title) {
    const h = bodyFont.size * (bodyFont.lineHeight ?? 1.2);
    requests.push({
      id: `text:${panel.id}:lead`, kind: 'annotation', typeRole: 'label', owner: { categoryId: panel.id },
      text: lead, lines: [lead], font: bodyFont, priority: PRIORITY.total,
      candidates: [{ slot: 'panelFlow', rect: { x: pad + indent, y, w: leadWidth - leadGap, h }, penalty: 0 }], role: 'note',
    });
  }
  if (data.title) add(`text:${panel.id}:title`, data.title, titleFont, PRIORITY.total, '', leadWidth);
  if (data.body) add(`text:${panel.id}:body`, data.body, bodyFont, PRIORITY.valueLine);
  (data.bullets ?? []).forEach((bullet, index) =>
    add(`text:${panel.id}:bullet:${index + 1}`, bullet, bodyFont, PRIORITY.extreme, '\u2022 '),
  );
  // A text panel is authored prose, not source-owned data: no focus applies.
  const solveCtx: SolveCtx = labelCtx(theme, { width: slot.w, height: slot.h }, {}, {
    density: 'full',
    measure,
    plot: { x: 0, y: 0, w: slot.w, h: slot.h },
    labelPad: 2,
  });
  const solved = solveLabels(requests, occupied, solveCtx);
  const nodes = labelsToNodes(theme, solved.placed, (label) =>
    label.id.endsWith(':title') ? titleFont : bodyFont,
  ).map((node) => {
    const ink = textPanelInk(node.id, data.tone);
    return ink && node.t === 'text' ? { ...node, ink } : node;
  });
  const contentHeight = Math.ceil(y - lastGap + padY);
  return {
    type: 'grid-text',
    size: { width: slot.w, height: slot.h },
    plot: { x: 0, y: 0, w: slot.w, h: slot.h },
    scene: nodes,
    labels: solved.placed,
    axes: [],
    annotations: [],
    // A text panel is as tall as its prose: an automatic row of text panels
    // takes that height and leaves the rest of the canvas to the charts.
    sizing: { aspect: 'content', fit: 'content', minWidth: 0, minHeight: contentHeight, measuredMinWidth: 0, measuredMinHeight: contentHeight,
      naturalWidth: slot.w, naturalHeight: contentHeight, comfortableWidth: slot.w, comfortableHeight: contentHeight },
    frame: { minHeight: y - lastGap + padY },
    marks: {},
    derived: {},
    a11y: {
      title: data.title ?? panel.title ?? panel.id,
      desc: [data.body, ...(data.bullets ?? [])].filter(Boolean).join(' '),
    },
    warnings: solved.warnings,
    debug: { occupied: occupied.snapshot(), decisions: solved.decisions },
  };
}

function layoutLegendPanel(
  panel: GridPanelSpec,
  slot: Rect,
  items: LegendItemInput[],
  theme: ReturnType<typeof resolveTheme>,
  measure: TextMeasurer,
  parentOptions: Pick<GridLayoutOptions, 'mode' | 'theme' | 'target' | 'locale' | 'strings'>,
): Geometry {
  const occupied = createOccupiedIndex({ x: 0, y: 0, w: slot.w, h: slot.h });
  const frame = solveFrame(
    {
      size: { width: slot.w, height: slot.h },
      margin: { top: 4, right: 4, bottom: 4, left: 4 },
      ...frameTextOptions({ title: panel.title, mode: parentOptions.mode, theme: parentOptions.theme, target: parentOptions.target }),
      legend: items.length > 0 ? { options: { position: 'top' }, items } : undefined,
      theme,
      measure,
    },
    occupied,
  );
  const warnings: LintWarning[] =
    items.length > 0
      ? []
      : [{
          code: 'grid-legend-empty',
          severity: 'warn',
          message: `legend panel '${panel.id}' has no contributing chart legend items`,
        }];
  // A legend panel has no plot. Its last key and bottom margin set its floor.
  if (frame.legend) frame.frame.minHeight = frame.legend.rect.y + frame.legend.rect.h + 4;
  return {
    type: 'grid-legend',
    size: { width: slot.w, height: slot.h },
    plot: frame.plot,
    scene: frame.nodes,
    labels: [],
    axes: [],
    annotations: [],
    legend: frame.legend,
    frame: frame.frame,
    marks: {},
    derived: {},
    a11y: { title: panel.title ?? chartString(parentOptions, 'legendName'), desc: chartString(parentOptions, 'legendItemsCount', { v1: items.length }) },
    warnings,
    debug: { occupied: occupied.snapshot(), decisions: [] },
  };
}

function resolveGaps(
  authored: number | number[] | undefined,
  count: number,
  fallback: number,
  axis: 'rows' | 'columns',
): number[] {
  if (count <= 0) return [];
  if (authored === undefined) return Array.from({ length: count }, () => fallback);
  if (typeof authored === 'number') return Array.from({ length: count }, () => authored);
  if (authored.length !== count) {
    throw new NormalizeError(
      'grid-gutter-count',
      `options.gutters.${axis}`,
      `${axis} gutters require exactly ${count} value${count === 1 ? '' : 's'} for the authored tracks; received ${authored.length}`,
    );
  }
  return [...authored];
}

function trackBands(
  start: number,
  span: number,
  weights: number[],
  gaps: number[],
  authoredGaps: boolean,
): { start: number; size: number }[] {
  // Default gaps that leave no room mean the canvas is below the grid's floor:
  // the tracks collapse and the size check refuses with a measured size.
  const usable = span - gaps.reduce((sum, gap) => sum + gap, 0);
  if (authoredGaps && usable <= 0) {
    throw new NormalizeError(
      'grid-gutters-exceed-space',
      'options.gutters',
      `authored gutters consume ${span - usable}px of ${span}px available space`,
      'make options.gutters smaller, or give the grid a larger size: the title, panel heads and gutters share the canvas',
    );
  }
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = start;
  return weights.map((weight, index) => {
    const size = (Math.max(0, usable) * weight) / total;
    const band = { start: cursor, size };
    cursor += size + (gaps[index] ?? 0);
    return band;
  });
}

function spanRect(
  rows: { start: number; size: number }[],
  columns: { start: number; size: number }[],
  placement: AuthoredPlacement,
): Rect {
  const firstRow = rows[placement.row]!;
  const lastRow = rows[placement.row + placement.rowSpan - 1]!;
  const firstColumn = columns[placement.column]!;
  const lastColumn = columns[placement.column + placement.columnSpan - 1]!;
  return {
    x: firstColumn.start,
    y: firstRow.start,
    w: lastColumn.start + lastColumn.size - firstColumn.start,
    h: lastRow.start + lastRow.size - firstRow.start,
  };
}

function alignInside(raw: Rect, align: GridPanelSpec['align']): Rect {
  if (!align) return raw;
  const horizontal = align.horizontal ?? 'stretch';
  const vertical = align.vertical ?? 'stretch';
  const w = horizontal === 'stretch' ? raw.w : Math.min(raw.w, align.width ?? raw.w);
  const h = vertical === 'stretch' ? raw.h : Math.min(raw.h, align.height ?? raw.h);
  const x =
    horizontal === 'end'
      ? raw.x + raw.w - w
      : horizontal === 'center'
        ? raw.x + (raw.w - w) / 2
        : raw.x;
  const y =
    vertical === 'end'
      ? raw.y + raw.h - h
      : vertical === 'center'
        ? raw.y + (raw.h - h) / 2
        : raw.y;
  return { x, y, w, h };
}

function scopeGroups(children: AuthoredChild[], scope: GridTrackScope): AuthoredChild[][] {
  if (scope === 'all') return [children];
  const groups = new Map<number, AuthoredChild[]>();
  for (const child of children) {
    const key = scope === 'row' ? child.placement.row : child.placement.column;
    const members = groups.get(key) ?? [];
    members.push(child);
    groups.set(key, members);
  }
  return [...groups.values()];
}

function categoryColumnBands(
  children: AuthoredChild[],
  columnBands: { start: number; size: number }[],
  columnGaps: number[],
  warnings: LintWarning[],
): { start: number; size: number }[] {
  const candidates = children.flatMap((child) => {
    const axis = child.geometry.axes.find((candidate) => candidate.axis === 'x');
    return child.placement.column === 0 &&
      child.placement.columnSpan === columnBands.length &&
      axis?.ticks.length === columnBands.length
      ? [{ child, axis }]
      : [];
  });
  if (candidates.length === 0 || columnBands.length < 2) return columnBands;

  const centers = candidates[0]!.axis.ticks.map(
    (tick) => candidates[0]!.child.slot.x + tick.pos,
  );
  for (const { child, axis } of candidates.slice(1)) {
    const other = axis.ticks.map((tick) => child.slot.x + tick.pos);
    if (other.some((value, index) => Math.abs(value - centers[index]!) > 1e-6)) {
      warnings.push({
        code: 'grid-anchor-incompatible',
        severity: 'warn',
        message: `panel '${child.panel.id}' proposes category anchors that conflict with panel '${candidates[0]!.child.panel.id}'`,
      });
    }
  }

  const signs = [1];
  const offsets = [0];
  for (let index = 0; index < centers.length - 1; index += 1) {
    const available = centers[index + 1]! - centers[index]! - columnGaps[index]!;
    if (!(available > 0)) {
      warnings.push({
        code: 'grid-anchor-incompatible',
        severity: 'warn',
        message: `category anchors leave no room for authored column gutter ${index + 1}`,
      });
      return columnBands;
    }
    signs.push(-signs[index]!);
    offsets.push(2 * available - offsets[index]!);
  }

  let lower = 1;
  let upper = Number.POSITIVE_INFINITY;
  for (let index = 0; index < signs.length; index += 1) {
    if (signs[index] === 1) lower = Math.max(lower, 1 - offsets[index]!);
    else upper = Math.min(upper, offsets[index]! - 1);
  }
  upper = Math.min(upper, 2 * (centers[0]! - columnBands[0]!.start));
  const last = columnBands.length - 1;
  const outerRight = columnBands[last]!.start + columnBands[last]!.size;
  const lastRoom = 2 * (outerRight - centers[last]!);
  if (signs[last] === 1) upper = Math.min(upper, lastRoom - offsets[last]!);
  else lower = Math.max(lower, offsets[last]! - lastRoom);
  if (lower > upper) {
    warnings.push({
      code: 'grid-anchor-incompatible',
      severity: 'warn',
      message: `category anchors cannot form positive column tracks inside the authored grid`,
    });
    return columnBands;
  }

  const leastSquares = signs.reduce(
    (sum, sign, index) =>
      sum + sign * (columnBands[index]!.size - offsets[index]!),
    0,
  ) / signs.length;
  const firstWidth = Math.max(lower, Math.min(upper, leastSquares));
  return centers.map((center, index) => {
    const size = signs[index]! * firstWidth + offsets[index]!;
    return { start: center - size / 2, size };
  });
}

function recordCategoryColumnAnchors(
  children: AuthoredChild[],
  columnBands: { start: number; size: number }[],
  derived: Record<string, number>,
  warnings: LintWarning[],
): void {
  for (const child of children) {
    const axis = child.geometry.axes.find((candidate) => candidate.axis === 'x');
    if (
      child.placement.column !== 0 ||
      child.placement.columnSpan !== columnBands.length ||
      axis?.ticks.length !== columnBands.length
    ) continue;
    axis.ticks.forEach((tick, index) => {
      const target = columnBands[index]!.start + columnBands[index]!.size / 2;
      const actual = child.slot.x + tick.pos;
      derived[`category:column:${child.panel.id}:${tick.at}`] = target;
      if (Math.abs(actual - target) > 1e-6) {
        const miss = Math.round(Math.abs(actual - target) * 1_000) / 1_000;
        warnings.push({
          code: 'grid-anchor-inexact',
          severity: 'warn',
          message: `panel '${child.panel.id}' category '${tick.at}' missed its authored column anchor by ${miss}px`,
        });
      }
    });
  }
}

function alignPlotEdges(
  input: AuthoredChild[],
  scope: GridTrackScope,
  derived: Record<string, number>,
  warnings: LintWarning[],
  theme: ReturnType<typeof resolveTheme>,
): AuthoredChild[] {
  const children = [...input];
  for (const [groupIndex, group] of scopeGroups(children, scope).entries()) {
    const candidates = group.filter((child) => child.relayout !== undefined);
    if (candidates.length < 2) continue;
    const left = maxOf(candidates.map((child) => child.slot.x + child.geometry.plot.x));
    const right = minOf(candidates.map((child) => child.slot.x + child.geometry.plot.x + child.geometry.plot.w));
    if (!(right > left)) {
      warnings.push({
        code: 'grid-anchor-incompatible',
        severity: 'warn',
        message: `${scope} plot-edge alignment group ${groupIndex + 1} has no shared horizontal span — plot edges were left unchanged`,
      });
      continue;
    }
    derived[`plotEdges:${scope}:${groupIndex}:left`] = left;
    derived[`plotEdges:${scope}:${groupIndex}:right`] = right;
    for (const child of candidates) {
      const currentLeft = child.slot.x + child.geometry.plot.x;
      const currentRight = currentLeft + child.geometry.plot.w;
      moveChildPlot(child, left - currentLeft, currentRight - right, theme);
    }
  }
  return children;
}

function alignBaselines(
  input: AuthoredChild[],
  scope: GridTrackScope,
  derived: Record<string, number>,
): AuthoredChild[] {
  const children = [...input];
  for (const [groupIndex, group] of scopeGroups(children, scope).entries()) {
    const candidates = group.flatMap((child) => {
      const baseline = baselineY(child.geometry);
      return baseline === null || !child.relayout
        ? []
        : [{ child, baseline: child.slot.y + baseline }];
    });
    if (candidates.length < 2) continue;
    const target = minOf(candidates.map((entry) => entry.baseline));
    derived[`baseline:${scope}:${groupIndex}`] = target;
    for (const entry of candidates) {
      const delta = entry.baseline - target;
      if (delta <= 0) continue;
      entry.child.margin = {
        ...entry.child.margin,
        bottom: (entry.child.margin.bottom ?? 16) + delta,
      };
      entry.child.geometry = entry.child.relayout!(entry.child.margin);
    }
  }
  return children;
}

function baselineY(geometry: Geometry): number | null {
  const axis = geometry.axes.find((candidate) => candidate.axis === 'x' && candidate.baselineNodeId);
  const node = axis?.baselineNodeId
    ? geometry.scene.find((candidate) => candidate.id === axis.baselineNodeId)
    : undefined;
  if (node?.t === 'line' && node.y1 === node.y2) return node.y1;
  return null;
}

/**
 * The stretches of an authored guide that cross no text and no mark:
 * the guide stops 3 px short of every label, tick label, title or bar it
 * would cross and resumes past it; a stub shorter than a text line (12 px)
 * reads as a tick, so it is dropped.
 */
function guideRuns(
  occupied: Geometry['debug']['occupied'],
  orientation: 'horizontal' | 'vertical',
  at: number,
  start: number,
  end: number,
): [number, number][] {
  const vertical = orientation === 'vertical';
  const blocks = occupied
    .filter((claim) => claim.part !== 'alignmentRule' && claim.rect.w > 2 && claim.rect.h > 2)
    .filter((claim) => vertical
      ? claim.rect.x < at && claim.rect.x + claim.rect.w > at
      : claim.rect.y < at && claim.rect.y + claim.rect.h > at)
    .map((claim) => vertical
      ? [claim.rect.y - 3, claim.rect.y + claim.rect.h + 3] as const
      : [claim.rect.x - 3, claim.rect.x + claim.rect.w + 3] as const)
    .sort((a, b) => a[0] - b[0]);
  const runs: [number, number][] = [];
  let from = Math.min(start, end);
  const last = Math.max(start, end);
  // A block past the guide's end (a panel below its toPanelId) cuts nothing.
  for (const [a, b] of blocks) {
    if (Math.min(a, last) - from >= 12) runs.push([from, Math.min(a, last)]);
    from = Math.max(from, b);
  }
  if (last - from >= 12) runs.push([from, last]);
  return runs;
}

function appendAuthoredChild(
  child: AuthoredChild,
  scene: SceneNode[],
  labels: PlacedLabel[],
  axes: AxisGeometry[],
  annotations: Geometry['annotations'],
  occupied: Geometry['debug']['occupied'],
  decisions: Geometry['debug']['decisions'],
  warnings: LintWarning[],
  marks: GridMarks,
): void {
  const prefix = `${child.panel.id}/`;
  const dx = child.slot.x;
  const dy = child.slot.y;
  const legendItems = new Map((child.geometry.legend?.items ?? []).flatMap(item => [
    [item.swatchNodeId, item.id] as const,
    [item.labelId, item.id] as const,
  ]));
  for (const node of child.geometry.scene) {
    const legendItem = node.origin?.legendItem ?? legendItems.get(node.id);
    scene.push({
      ...node,
      id: prefix + node.id,
      owner: prefixPanelOwner(node.owner, prefix),
      tx: (node.tx ?? 0) + dx,
      ty: (node.ty ?? 0) + dy,
      origin: {
        owner: node.origin?.owner ?? node.owner,
        panels: [child.panel.id, ...(node.origin?.panels ?? [])],
        ...(legendItem === undefined ? {} : { legendItem }),
      },
    } as SceneNode);
  }
  const noteData = panelNoteData(child.panel.type, child.panel.data,
    (child.panel.options?.locale as { language?: string } | undefined)?.language);
  const noteTexts = panelNoteTexts(child.geometry, noteData, child.panel.options, child.panel.annotations);
  for (const label of child.geometry.labels) {
    const noteText = noteTexts.texts.get(label.id);
    const named = noteText === undefined ? label : { ...label, noteText };
    labels.push(translatePlacedLabel(noteTexts.leftOut.has(label.id) ? { ...named, [LEFT_OUT_OF_NOTE]: true as const } as PlacedLabel : named, prefix, dx, dy));
  }
  for (const axis of child.geometry.axes) {
    axes.push({
      ...axis,
      baselineNodeId: axis.baselineNodeId ? prefix + axis.baselineNodeId : undefined,
      ticks: axis.ticks.map((tick) => ({
        ...tick,
        pos: tick.pos + (axis.axis === 'x' ? dx : dy),
        labelId: tick.labelId ? prefix + tick.labelId : undefined,
        gridNodeId: tick.gridNodeId ? prefix + tick.gridNodeId : undefined,
      })),
      scenarioBands: axis.scenarioBands?.map((band) => ({
        ...band,
        rect: { ...band.rect, x: band.rect.x + dx, y: band.rect.y + dy },
      })),
    });
  }
  for (const annotation of child.geometry.annotations) {
    annotations.push({
      ...annotation,
      id: prefix + annotation.id,
      // The event anchor is a child-scene rect: move it with the panel.
      ...(annotation.event?.anchor ? { event: { ...annotation.event, anchor: translateRect(annotation.event.anchor, dx, dy) } } : {}),
      nodeIds: annotation.nodeIds.map((id) => prefix + id),
      labelId: annotation.labelId ? prefix + annotation.labelId : undefined,
      labelNodeId: annotation.labelNodeId
        ? prefix + annotation.labelNodeId
        : annotation.labelId
          ? prefix + `label:${annotation.labelId}`
          : undefined,
    });
  }
  for (const claim of child.geometry.debug.occupied) {
    occupied.push({
      ...claim,
      owner: prefixPanelOwner(claim.owner, prefix),
      rect: { ...claim.rect, x: claim.rect.x + dx, y: claim.rect.y + dy },
    });
  }
  for (const decision of child.geometry.debug.decisions) {
    decisions.push({ ...decision, labelId: prefix + decision.labelId });
  }
  const warningOffset = warnings.length;
  // A child's field and fix are relative to the panel, not to the grid
  // chart, so they would point at the grid's own options; the message names the panel.
  pushAll(
    warnings,
    child.geometry.warnings.map(({ field: _field, fix: _fix, ...warning }) => ({
      ...warning,
      message: `[${child.panel.id}] ${warning.message}`,
      owner: warning.owner ? prefixPanelOwner(warning.owner, prefix) : undefined,
    })),
  );
  const content = authoredOccupiedBounds(child.geometry);
  marks.panels.push({
    id: child.panel.id,
    type: child.panel.type,
    ...(child.recordOptions ? { chart: { options: child.recordOptions(), geometry: child.geometry, offset: { x: dx, y: dy }, warningOffset, warningOwnerPrefix: prefix, ...(child.panel.options?.theme ? { theme: child.panel.options.theme as ThemeRef } : {}) } } : {}),
    plot: {
      x: child.geometry.plot.x + dx,
      y: child.geometry.plot.y + dy,
      w: child.geometry.plot.w,
      h: child.geometry.plot.h,
    },
    content: { x: content.x + dx, y: content.y + dy, w: content.w, h: content.h },
    title: child.panel.title ?? child.geometry.a11y.title ?? child.panel.id,
    row: child.placement.row,
    column: child.placement.column,
    rowSpan: child.placement.rowSpan,
    columnSpan: child.placement.columnSpan,
  });
}

type PlacedLabelCoordinateField = {
  [K in keyof PlacedLabel]-?: NonNullable<PlacedLabel[K]> extends
    | Rect
    | NonNullable<PlacedLabel['leader']>
    ? K
    : never;
}[keyof PlacedLabel];

const TRANSLATED_PLACED_LABEL_FIELDS = [
  'rect',
  'backing',
  'leader',
] as const satisfies readonly PlacedLabelCoordinateField[];

type UntranslatedPlacedLabelField = Exclude<
  PlacedLabelCoordinateField,
  (typeof TRANSLATED_PLACED_LABEL_FIELDS)[number]
>;

const PLACED_LABEL_TRANSLATION_IS_EXHAUSTIVE:
  UntranslatedPlacedLabelField extends never ? true : never = true;

function translatePlacedLabel(
  label: PlacedLabel,
  prefix: string,
  dx: number,
  dy: number,
): PlacedLabel {
  void PLACED_LABEL_TRANSLATION_IS_EXHAUSTIVE;
  return {
    ...label,
    id: prefix + label.id,
    ...(label.claimId ? { claimId: prefix + label.claimId } : {}),
    nodeId: label.nodeId ? prefix + label.nodeId : undefined,
    owner: prefixPanelOwner(label.owner, prefix),
    rect: translateRect(label.rect, dx, dy),
    backing: label.backing ? translateRect(label.backing, dx, dy) : undefined,
    leader: label.leader
      ? { ...label.leader, d: translateLeaderPath(label.leader.d, dx, dy) }
      : undefined,
  };
}

const PANEL_LOCAL_OWNER_FIELDS = [
  'annotationId',
  'valueLineId',
] as const satisfies readonly (keyof OwnerRef)[];

const PANEL_DATA_OWNER_FIELDS = [
  'seriesId',
  'categoryId',
  'segmentId',
  'pointId',
  'rowId',
  'colId',
] as const satisfies readonly (keyof OwnerRef)[];

type UnclassifiedOwnerField = Exclude<
  keyof OwnerRef,
  (typeof PANEL_LOCAL_OWNER_FIELDS)[number] | (typeof PANEL_DATA_OWNER_FIELDS)[number]
>;

const OWNER_FIELD_CLASSIFICATION_IS_EXHAUSTIVE:
  UnclassifiedOwnerField extends never ? true : never = true;

function prefixPanelOwner(owner: OwnerRef, prefix: string): OwnerRef {
  void OWNER_FIELD_CLASSIFICATION_IS_EXHAUSTIVE;
  const translated = { ...owner };
  for (const field of PANEL_LOCAL_OWNER_FIELDS) {
    const id = owner[field];
    if (id !== undefined) translated[field] = prefix + id;
  }
  return translated;
}

function translateRect(rect: Rect, dx: number, dy: number): Rect {
  return { ...rect, x: rect.x + dx, y: rect.y + dy };
}

function translateLeaderPath(path: string, dx: number, dy: number): string {
  let coordinateIndex = 0;
  return path.replace(
    /-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/gi,
    (raw) => String(Number(raw) + (coordinateIndex++ % 2 === 0 ? dx : dy)),
  );
}

function authoredOccupiedBounds(geometry: Geometry): Rect {
  const rects = geometry.debug.occupied
    .filter((item) => item.kind !== 'reserved')
    .map((item) => item.rect);
  return rects.length > 0 ? boundsOf(rects) : geometry.plot;
}

function resolveRuleCoordinate(
  child: AuthoredChild,
  anchor: NonNullable<GridLayoutOptions['alignmentRules']>[number]['at']['anchor'],
  categoryId?: string,
): { axis: 'x' | 'y'; value: number } | null {
  if (anchor === 'plotLeft') return { axis: 'x', value: child.slot.x + child.geometry.plot.x };
  if (anchor === 'plotRight') {
    return {
      axis: 'x',
      value: child.slot.x + child.geometry.plot.x + child.geometry.plot.w,
    };
  }
  if (anchor === 'baseline') {
    const value = baselineY(child.geometry);
    return value === null ? null : { axis: 'y', value: child.slot.y + value };
  }
  if (!categoryId) return null;
  const axis = child.geometry.axes.find((candidate) => candidate.axis === 'x');
  const tick = axis?.ticks.find((candidate) => candidate.at === categoryId);
  return tick ? { axis: 'x', value: child.slot.x + tick.pos } : null;
}

function textPanelInk(id: string, tone: 'message' | 'muted' | undefined): { token: 'ink' | 'inkMuted' } | undefined {
  if (tone === 'muted') return { token: 'inkMuted' };
  if (tone !== 'message') return undefined;
  return { token: id.endsWith(':title') ? 'ink' : 'inkMuted' };
}

function wrapMeasured(
  text: string,
  font: FontSpec,
  maxWidth: number,
  maxLines: number,
  measure: TextMeasurer,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && measure(next, font).width > maxWidth) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) break;
    } else {
      current = next;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

/** Group id for the implicit facet share, so the receipt names it. */
const DEFAULT_Y_GROUP = 'grid:y';

function panelScaleSemantics(
  panel: GridPanelSpec,
): { unit: string | null; format: string | null } | null {
  return scalePanelSemantics({
    type: panel.type,
    data: panel.data,
    options: panel.options,
  });
}

function probePanelGeometry(
  panel: GridPanelSpec,
  options: GridLayoutOptions,
  valueAxis: Record<string, unknown>,
): LayoutResult | null {
  const definition = getChart(panel.type);
  if (!definition) return null;
  const panelOptions = panel.options ?? {};
  return layoutChildChart(panel.data, {
    ...definition.defaults,
    ...panelOptions,
    ...(panel.annotations ? { annotations: panel.annotations } : {}),
    theme: panelOptions.theme ?? options.theme,
    size: { width: 720, height: 405 },
    valueAxis,
    measure: options.measure,
    typeClass: gridTypeClass(options),
  }, definition.layout as (data: unknown, options: unknown) => LayoutResult);
}

function panelValueAxisBreak(panel: GridPanelSpec): { from: number; to: number } | null {
  const valueAxis = isRecord(panel.options?.valueAxis) ? panel.options.valueAxis : undefined;
  const raw = valueAxis && isRecord(valueAxis.break) ? valueAxis.break : null;
  if (!raw) return null;
  const { from, to } = raw;
  if (typeof from !== 'number' || typeof to !== 'number') return null;
  return { from, to };
}

function sharedBreakForGroup(
  panels: GridPanelSpec[],
  indexes: number[],
): { kind: 'none' } | { kind: 'one'; axisBreak: { from: number; to: number } } | { kind: 'mismatch' } {
  const authored: { from: number; to: number }[] = [];
  for (const index of indexes) {
    const axisBreak = panelValueAxisBreak(panels[index]!);
    if (axisBreak) authored.push(axisBreak);
  }
  if (authored.length === 0) return { kind: 'none' };
  const keys = new Set(authored.map((axisBreak) => `${axisBreak.from}|${axisBreak.to}`));
  if (keys.size > 1) return { kind: 'mismatch' };
  return { kind: 'one', axisBreak: authored[0]! };
}

function groupHonorsSharedBreak(
  panels: GridPanelSpec[],
  indexes: number[],
  domain: [number, number],
  axisBreak: { from: number; to: number },
  options: GridLayoutOptions,
): boolean {
  for (const index of indexes) {
    const panel = panels[index]!;
    const panelOptions = panel.options ?? {};
    const valueAxis = isRecord(panelOptions.valueAxis) ? panelOptions.valueAxis : {};
    let geometry: LayoutResult | null = null;
    try {
      geometry = probePanelGeometry(panel, options, {
        ...valueAxis,
        show: true,
        min: domain[0],
        max: domain[1],
        break: axisBreak,
      });
    } catch {
      return false;
    }
    if (!geometry || geometry.refused || !geometry.axes.some((axis) => axis.axis === 'y' && axis.break !== undefined)) return false;
  }
  return true;
}

function resolveSharedYDomains(
  panels: GridPanelSpec[],
  options: GridLayoutOptions,
  repeatFacet: boolean,
): { panels: GridPanelSpec[]; domains: Record<string, [number, number]>; members: Record<string, string[]>; warnings: LintWarning[] } {
  const groups = new Map<string, number[]>();
  panels.forEach((panel, index) => {
    const scaleGroup = isRecord(panel.options?.scaleGroup) ? panel.options.scaleGroup : undefined;
    if (typeof scaleGroup?.y !== 'string') return;
    const members = groups.get(scaleGroup.y) ?? [];
    members.push(index);
    groups.set(scaleGroup.y, members);
  });

  const panelDomains = panels.map((panel): [number, number] | null => {
    const panelOptions = panel.options ?? {};
    const valueAxis = isRecord(panelOptions.valueAxis) ? panelOptions.valueAxis : {};
    const { break: _ignoredBreak, ...axisWithoutBreak } = valueAxis;
    const probe = probePanelGeometry(panel, options, { ...axisWithoutBreak, show: true });
    return probe && !probe.refused ? inferLinearYDomain(probe) : null;
  });

  /*
   * Numeric same-unit, same-format panels share one y scale by DEFAULT.
   *
   * Four regional panels side by side are read as a comparison — that is what
   * small multiples are for — and without a shared scale each solves its own domain, so a
   * panel peaking at 39 and one peaking at 66 draw the same bar height. Both
   * fill 86.7-88.0% of their own plot. The chart says "these are alike" and
   * the numbers say otherwise.
   *
   * The `repeat` shorthand writes `repeat:<dim>:y` onto every expanded panel,
   * so repeat-built facets share a scale; the default gives explicitly
   * authored facets the same behaviour.
   *
   * `share` controls placement, not scale semantics. Facets and aligned tiers
   * both compare panel heights when every panel resolves the same numeric
   * quantity. The opt-out is `sharedScale: false`.
   *
   * A default share needs positive evidence of one measure: the same non-empty
   * unit and format on every panel, a grid `unit`, a `repeat.facet` expansion
   * (`repeatFacet`), or a `repeat` by slice / `scaleGroup` (both arrive here as
   * authored groups). A missing unit is no
   * evidence, and neither is a shared chart type: a column panel of revenue
   * in thousands beside a column panel of order counts, both "1,234", keeps
   * two scales, or the count panel draws flat. An authored
   * `sharedScale: true` still shares them.
   */
  const authoredGroups = groups.size > 0;
  const semantics = panels.map(panelScaleSemantics);
  const firstSemantics = semantics[0];
  const matchingSemantics =
    firstSemantics !== undefined &&
    firstSemantics !== null &&
    semantics.every(
      (candidate) =>
        candidate !== null &&
        candidate.unit === firstSemantics.unit &&
        candidate.format === firstSemantics.format,
    );
  const sameMeasure =
    options.sharedScale === true || repeatFacet || firstSemantics?.unit != null || Boolean(options.unit?.trim());
  const defaultShareEligible =
    panels.length > 1 && panelDomains.every((domain) => domain !== null) && matchingSemantics && sameMeasure;
  if (options.sharedScale !== false && !authoredGroups && defaultShareEligible) {
    // Named, not anonymous: the group id lands in derived.sharedYDomains, so the
    // receipt says which panels were compared. Mirrors the shorthand's
    // `repeat:<dim>:y` convention.
    groups.set(
      DEFAULT_Y_GROUP,
      panels.map((_, index) => index),
    );
  }

  const clampWarnings = leaveClampedPanelsOut(groups, panels);

  // One source of truth for "which group is this panel in", used by the domain
  // union below and by the write-back at the end.
  const groupByIndex = new Map<number, string>();
  for (const [group, indexes] of groups) {
    for (const index of indexes) groupByIndex.set(index, group);
  }

  const { domains, breaks, warnings } = unionSharedYGroups(groups, panels, panelDomains, options);

  // The write-back reads groupByIndex, NOT panel.options.scaleGroup. Reading the
  // authored field would silently skip every panel in the implicit default
  // group: the shared domain would be computed, land in derived.sharedYDomains,
  // move the geometry hash — and change no pixel, because no panel's valueAxis
  // was ever pinned to it. Measured: facet-regions reported grid:y [0, 75] and
  // rendered byte-identically.
  return {
    panels: pinSharedYAxis(panels, groupByIndex, domains, breaks),
    domains,
    members: Object.fromEntries([...groups].map(([group, indexes]) => [group, indexes.map((index) => panels[index]!.id)])),
    warnings: [...clampWarnings, ...warnings],
  };
}

/**
 * Why a panel keeps its own y scale (scatter): it caps its vertical axis with
 * `valueAxis.clamp`, or draws it on a log scale, which no linear panel can share.
 */
function ownYScale(panel: GridPanelSpec): 'clamp' | 'log' | undefined {
  const valueAxis = panel.options?.valueAxis;
  if (!isRecord(valueAxis)) return undefined;
  if (valueAxis.log === true || valueAxis.log === 'y' || valueAxis.log === 'both') return 'log';
  const clamp = valueAxis.clamp;
  if (!isRecord(clamp)) return undefined;
  const y = isRecord(clamp.y) ? clamp.y : {};
  return [clamp.min, clamp.max, y.min, y.max].some((bound) => typeof bound === 'number') ? 'clamp' : undefined;
}

/**
 * A panel whose vertical axis is clamped keeps its own y scale. The clamp says
 * where that axis ends and draws the points beyond it on that edge; a shared
 * domain would end the axis somewhere else, and the pin the grid writes for it
 * collides with the clamp. A log axis keeps its own too: its domain is not the
 * linear one the group shares. The implicit group drops such a panel
 * silently, the way it drops any panel it cannot pin; an authored group says so.
 */
function leaveClampedPanelsOut(groups: Map<string, number[]>, panels: GridPanelSpec[]): LintWarning[] {
  const warnings: LintWarning[] = [];
  for (const [group, indexes] of groups) {
    const own = indexes.filter((index) => ownYScale(panels[index]!) !== undefined);
    if (own.length === 0) continue;
    groups.set(group, indexes.filter((index) => !own.includes(index)));
    if (group === DEFAULT_Y_GROUP) continue;
    for (const reason of ['clamp', 'log'] as const) {
      const names = own.filter((index) => ownYScale(panels[index]!) === reason).map((index) => `'${panels[index]!.id ?? index}'`).join(', ');
      if (!names) continue;
      warnings.push({
        code: `scale-${reason}`,
        severity: 'warn',
        message: `panel ${names} ${reason === 'clamp' ? 'caps its vertical axis with valueAxis.clamp' : 'draws its vertical axis on a log scale'}, so it keeps its own y scale and leaves y scale group '${group}'`,
        suggest: `drop valueAxis.${reason} to share the scale, or take the panel out of scaleGroup.y`,
      });
    }
  }
  return warnings;
}

function unionSharedYGroups(
  groups: Map<string, number[]>,
  panels: GridPanelSpec[],
  panelDomains: ([number, number] | null)[],
  options: GridLayoutOptions,
): {
  domains: Record<string, [number, number]>;
  breaks: Record<string, { from: number; to: number }>;
  warnings: LintWarning[];
} {
  const domains: Record<string, [number, number]> = emptyIdRecord();
  const breaks: Record<string, { from: number; to: number }> = emptyIdRecord();
  const warnings: LintWarning[] = [];
  for (const [group, indexes] of groups) {
    if (indexes.length < 2) continue;
    const memberDomains: [number, number][] = [];
    for (const index of indexes) {
      const domain = panelDomains[index];
      if (domain) memberDomains.push(domain);
    }
    if (memberDomains.length !== indexes.length) {
      /*
       * A DEFAULT that cannot be honoured falls back silently; an AUTHORED
       * request that cannot be honoured warns.
       *
       * The distinction matters because the default fires on every facet
       * grid, including ones with no numeric y scale at all. A KPI strip of
       * four kpi panels with sharedAxis:'none' has no y axis anywhere, and without
       * this branch it would
       * emit a warn-level lint that its author never asked for
       * and cannot act on. A default is not a request.
       */
      if (group !== DEFAULT_Y_GROUP) {
        warnings.push({
          code: 'scale-mix',
          severity: 'warn',
          message: `y scale group '${group}' contains a panel without a numeric linear y scale`,
        });
      }
      continue;
    }
    const domain: [number, number] = [
      minOf(memberDomains.map((entry) => entry[0])),
      maxOf(memberDomains.map((entry) => entry[1])),
    ];
    const agreed = sharedBreakForGroup(panels, indexes);
    if (agreed.kind === 'mismatch') {
      warnings.push({
        code: 'scale-break-mismatch',
        severity: 'error',
        message: `y scale group '${group}' has conflicting valueAxis.break spans, so panels keep independent scales`,
        suggest: 'give every panel in the group the same valueAxis.break, or drop the breaks',
      });
      continue;
    }
    if (agreed.kind === 'one' && !groupHonorsSharedBreak(panels, indexes, domain, agreed.axisBreak, options)) {
      warnings.push({
        code: 'scale-break-incompatible',
        severity: 'error',
        message: `y scale group '${group}' cannot honour valueAxis.break { from: ${agreed.axisBreak.from}, to: ${agreed.axisBreak.to} } on every panel, so panels keep independent scales`,
        suggest: 'choose a break every panel can honour, or drop valueAxis.break',
      });
      continue;
    }
    domains[group] = domain;
    if (agreed.kind === 'one') breaks[group] = agreed.axisBreak;
  }
  return { domains, breaks, warnings };
}

function pinSharedYAxis(
  panels: GridPanelSpec[],
  groupByIndex: Map<number, string>,
  domains: Record<string, [number, number]>,
  breaks: Record<string, { from: number; to: number }>,
): GridPanelSpec[] {
  return panels.map((panel, index) => {
    const group = groupByIndex.get(index);
    const domain = group === undefined ? undefined : domains[group];
    if (!domain) return panel;
    const panelOptions = panel.options ?? {};
    const valueAxis = isRecord(panelOptions.valueAxis) ? panelOptions.valueAxis : {};
    const axisBreak = group === undefined ? undefined : breaks[group];
    return {
      ...panel,
      options: {
        ...panelOptions,
        valueAxis: {
          ...valueAxis,
          min: domain[0],
          max: domain[1],
          ...(axisBreak ? { break: axisBreak } : {}),
        },
      },
    };
  });
}

function measureCaptionBand(
  panel: GridPanelSpec,
  theme: ReturnType<typeof resolveTheme>,
  measure: typeof defaultMeasurer,
  slotWidth: number,
  compact = false,
): number {
  const margin = isRecord(panel.options?.margin) ? panel.options.margin : {};
  // An unset side follows the shared margin at the panel width, not a literal 28.
  const sides = canvasMargin(theme, slotWidth);
  const width = Math.max(1, slotWidth - numeric(margin.left, sides.left) - numeric(margin.right, sides.right));
  const heightOf = (text: string, font: FontSpec) => measuredCaption(text, font, width, measure).height;
  let height = 0;
  if (panel.title) height += heightOf(panel.title, compact ? { family: theme.type.family, ...theme.type.axis } : { family: theme.type.family, ...theme.type.label, weight: emphasisWeight(theme) });
  if (panel.title && panel.caption) height += 2;
  if (panel.caption) height += heightOf(panel.caption, { family: theme.type.family, ...theme.type.axis });
  return height > 0 ? height + 6 : 0;
}

function numeric(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

