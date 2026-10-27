// boardplot — pure core (package root).

/**
 * ROOT-ENTRY REGISTRATION IS STRUCTURAL.
 *
 * The chart modules do not register themselves, and package.json lists no
 * `dist/chunk-*.js` as side-effectful, so nothing here may rest on a bare
 * import. Every root export whose answer depends on the catalogue calls
 * `ensureCatalogueRegistered()` first: a consumer that keeps `listCharts` keeps
 * that call, and the call keeps `registerCatalogue` and every definition. A
 * consumer that imports only `formatNumber` keeps none of it. The React
 * subpath entries do the same through `src/react/chartEntry.ts`.
 *
 * The theme checks are linked at module scope, because `resolveTheme` is a
 * root export in its own right and resolves a patched theme synchronously.
 * The annotation engine is linked with the catalogue, because only a chart
 * layout draws annotations (see core/deferred).
 *
 * Note what this deliberately does NOT do: it does not register the geo packs.
 * A pack is opted into (`boardplot/geo/<id>`), and a root consumer that
 * lays out a choropleth gets `GeoPackNotRegisteredError` naming the exact
 * import.
 */

import { linkStoryLayer } from './core/storyLayer';
import { linkAnnotateEngine } from './core/annotateEngine';
import { registerCatalogue } from './core/charts';
import { linkThemeShapeRules } from './core/themeShapeRules';
import { canDraw as canDrawRegistered, measure as measureRegistered, resolveChartRequest as resolveRegisteredRequest } from './core/request';
import type { ChartRequest, RequestContext, RequestOptions } from './core/request';
import { validateChartInput } from './core/doc/chartValidation';
import type { DocChart, DocumentEnvelope, BoardplotDoc } from './core/doc/document';
import { NormalizeError } from './core/normalize/shared';
import {
  getChart as getRegisteredChart,
  getChartDefinition as getRegisteredChartDefinition,
  getChartSchemas as getRegisteredChartSchemas,
  listCharts as listRegisteredCharts,
  type ChartSchemas,
  type ChartDefinition,
} from './core/registry';

linkThemeShapeRules();

function ensureCatalogueRegistered(): void {
  registerCatalogue();
  linkAnnotateEngine();
  linkStoryLayer();
}

/** Resolves a chart with its validation schemas loaded. */
export function getChartDefinition(typeOrAlias: string): ChartDefinition<any, any, any, any> | undefined {
  ensureCatalogueRegistered();
  return getRegisteredChartDefinition(typeOrAlias);
}

/** Every registered chart type, with aliases and summary. */
export function listCharts(): ReturnType<typeof listRegisteredCharts> {
  ensureCatalogueRegistered();
  return listRegisteredCharts();
}

/** The data and options schemas of a type or alias. */
export function getChartSchemas(typeOrAlias: string): ChartSchemas<any, any> | undefined {
  ensureCatalogueRegistered();
  return getRegisteredChartSchemas(typeOrAlias);
}

export function resolveChartRequest<D, O extends object>(request: ChartRequest<D, O & RequestOptions>, context?: RequestContext) {
  ensureCatalogueRegistered();
  const validated = validatedRequest(request, context, 'schema');
  const resolved = resolveRegisteredRequest(validated.request, context);
  return validated.warnings.length
    ? { ...resolved, inputWarnings: [...validated.warnings, ...(resolved.inputWarnings ?? [])] } : resolved;
}

/** Validate public library input once, before request preparation or layout. */
function validatedRequest<D, O extends object>(
  request: ChartRequest<D, O & RequestOptions>, context?: RequestContext,
  dataOwnership: 'document' | 'schema' = 'document',
) {
  if (!getRegisteredChart(request.type)) throw new NormalizeError('unknown-type', 'type', `unknown chart type '${request.type}'`);
  // A custom core without schemas keeps its typed input contract.
  if (!getRegisteredChartSchemas(request.type)) return { request, warnings: [] };
  // `options.measure` is a TypeScript-only callback outside the JSON schema; it skips validation
  // and rejoins before layout, where a top-level `fontMetrics` still wins over it.
  const { measure: measurer, ...authored } = (request.options ?? {}) as O & RequestOptions;
  // The same authored-input validation as render, before layout adds internal options.
  // It lives here, not in core/request, so the schema validator stays out of the React bundles.
  const inheritedLocale = typeof context?.locale === 'string' ? { language: context.locale } : context?.locale;
  // A chart that sets textScale or textSize takes neither from the context.
  const own = authored as { textScale?: unknown; textSize?: unknown };
  const contextOwnsText = [own.textScale, own.textSize, request.textScale, request.textSize].some(value => value !== undefined);
  const chart: DocChart = { name: 'chart', type: request.type, data: request.data, options: {
    ...(context?.theme === undefined ? {} : { theme: context.theme }),
    ...(inheritedLocale ? { locale: inheritedLocale } : {}),
    ...(context?.target === undefined ? {} : { target: context.target }),
    ...(contextOwnsText ? {} : { ...(context?.textScale === undefined ? {} : { textScale: context.textScale }), ...(context?.textSize === undefined ? {} : { textSize: context.textSize }) }),
    ...authored,
    ...(request.theme === undefined ? {} : { theme: request.theme }),
    ...(request.locale === undefined ? {} : { locale: typeof request.locale === 'string' ? { language: request.locale } : request.locale }),
    ...(request.target === undefined ? {} : { target: request.target }),
    ...(request.textScale === undefined ? {} : { textScale: request.textScale }),
    ...(request.textSize === undefined ? {} : { textSize: request.textSize }),
    ...(request.size === undefined ? {} : { size: request.size }),
  }, ...(request.annotations === undefined ? {} : { annotations: request.annotations }) };
  const envelope: DocumentEnvelope = { ok: true, errors: [], warnings: [] };
  const valid = validateChartInput({ version: 1, charts: [chart] } satisfies BoardplotDoc, chart, envelope, dataOwnership);
  if (!valid) {
    const error = envelope.errors[0]!;
    throw new NormalizeError(error.code, error.path ?? 'options', error.message, error.suggest, error.fix, error.field);
  }
  const options = { ...valid.options, ...(measurer === undefined ? {} : { measure: measurer }) } as O & RequestOptions;
  return { request: { ...request, data: valid.data as D, options }, warnings: envelope.warnings };
}

export function measure<D, O extends object>(request: ChartRequest<D, O & RequestOptions>, context?: RequestContext) {
  ensureCatalogueRegistered();
  const validated = validatedRequest(request, context);
  const measured = measureRegistered(validated.request, context);
  return validated.warnings.length ? { ...measured, warnings: [...validated.warnings, ...measured.warnings] } : measured;
}

export function canDraw<D, O extends object>(request: ChartRequest<D, O & RequestOptions>, context?: RequestContext) {
  ensureCatalogueRegistered();
  try { return canDrawRegistered(validatedRequest(request, context, 'schema').request, context); }
  catch (error) {
    if (error instanceof NormalizeError) return { ok: false, code: error.code, message: error.message };
    throw error;
  }
}

export type { CanDraw } from './core/request';
export { layoutResolvedRequest, measureResolvedRequest } from './core/request';
export { isRefused } from './core/schema/refusals';
export { InputError, specFromRows, type RowsColumns, type RowsReading, type SpecFromRowsInput } from './rows';
export type { ChartRequest, ResolvedChartRequest, RequestOptions, RequestContext, ChartMeasurement } from './core/request';
export type { InteractionScope, InteractionTarget, InteractionRecord, InteractionValue, InteractionComparison } from './core/a11y/types';
export type { ChartDefinition, ChartOptions, ChartSchemas, Fixture } from './core/registry';

// The data, option, scene and theme types every chart takes.
export type * from './core/types';
export { dimswitchRowId } from './core/charts/dimswitch/compile';
export type { DimSwitchData, DimSwitchOptions, DimSwitchExpression, DimSwitchMeasure, DimSwitchMember, DimSwitchPeriod, DimSwitchSums, DimSwitchVariant, CompiledDimSwitch } from './core/charts/dimswitch/types';
export { renderSvg, type RenderSvgOptions } from './core/svg/renderSvg';
export { measureText, type FontSpec, type TextMeasurer } from './core/text';
export type { Size } from './core/geometry';
export { formatWithSpec, parseFormatExample } from './core/formatSpec';
export { registerTheme, resolveTheme, typeForTarget } from './core/theme';
export { parseThemeJson } from './core/themeValidate';
export { PALETTE_CVD_FLOOR, PALETTE_NORMAL_FLOOR, palettePerceptualDistance, validateTheme } from './core/themeRules';
export { targetFloorsPx } from './core/target';
export type { ChartNote, NoteKind, NotePlacement, ChartCredit, CreditLink } from './core/notes';
// Every registered type must name its data and options in the published
// declarations; a type whose interface stays module-private is a chart a
// TypeScript consumer cannot describe. The public API check enumerates these types.
export type { BoxData, BoxOptions } from './core/charts/box/types';
export type {
  ChoroplethData,
  ChoroplethDatum,
  ChoroplethLabelPolicy,
  ChoroplethOptions,
  ChoroplethScale,
} from './core/charts/choropleth/types';
export type { CohortData, CohortOptions } from './core/charts/cohort/types';
export type { BarTableData, BarTableOptions } from './core/charts/bartable/types';
export type {
  DiagramData,
  DiagramDerived,
  DiagramEdge,
  DiagramGroup,
  DiagramLane,
  DiagramMarks,
  DiagramNode,
  DiagramOptions,
  DiagramVariant,
} from './core/types/diagram';
export type {
  GeoOverlay,
  GeoOverlayAnchor,
  GeoOverlaySize,
  GeoOverlayTone,
} from './core/charts/choropleth/overlayTypes';
export type {
  ExplicitGridData,
  GridInput,
  GridLayoutOptions as GridOptions,
  GridLayoutOptions,
  GridPanelPlacement,
  GridPanelSpec,
  GridRepeatFacet,
  GridTextPanelData,
  GridTrackScope,
  RepeatGridData,
} from './core/charts/grid/schema';
export type {
  ScatterStrategyOptions as ScatterOptions,
  ScatterStrategyOptions,
  StrategyZoneCell,
  StrategyZoneGrid,
  StrategyZoneRegion,
  StrategyZoneTone,
  StrategyZones,
} from './core/charts/scatter/types';
export type { AnnotationGlyphSlot } from './core/types/annotations';
export type { GanttOptions } from './core/charts/gantt/layout';
export type { HistogramData, HistogramOptions } from './core/charts/histogram/types';
export type {
  LikertData,
  LikertDerived,
  LikertItem,
  LikertNeutralMode,
  LikertOptions,
  LikertResponse,
  LikertScaleOption,
} from './core/charts/likert/layout';
export type { PvmData, PvmOptions } from './core/charts/pvm/types';
export type {
  PyramidBand,
  PyramidData,
  PyramidDerived,
  PyramidGroup,
  PyramidGroupValue,
  PyramidOptions,
} from './core/charts/pyramid/types';
export type {
  TreemapData,
  TreemapDerived,
  TreemapGroup,
  TreemapItem,
  TreemapMarks,
  TreemapOptions,
} from './core/charts/treemap/types';
export type {
  SankeyData,
  SankeyDerived,
  SankeyLink,
  SankeyLinkDerived,
  SankeyMarks,
  SankeyNode,
  SankeyNodeDerived,
  SankeyOptions,
  SankeyStage,
} from './core/charts/sankey/types';
export type {
  WaffleDerived,
  WaffleGrid,
  WaffleMarks,
  WaffleOptions,
} from './core/charts/waffle/types';
export type {
  StatusCell,
  StatusColumn,
  StatusData,
  StatusOptions,
  StatusRow,
  StatusState,
  StatusTone,
} from './core/charts/status/layout';
export type {
  TilemapData,
  TilemapDatum,
  TilemapOptions,
  TilemapScale,
} from './core/charts/tilemap/types';
/**
 * The parts a host builds a table from: a column, a row, a cell and
 * the closed vocabularies they take. A host that assembled `TableData` from
 * its own query rows had to restate each of them, and a restated union does
 * not learn a new member such as the `warn` tone.
 */
export type {
  CellTone,
  ColumnKind,
  ResolvedTable,
  RowRole,
  TableCell,
  TableCellEncoding,
  TableCellObject,
  TableColumn,
  TableData,
  TableOptions,
  TableVariant,
  TableRow,
} from './core/types/table';
/** The pixel-free table view state a host drives: folds by depth and the sorted row order. */
export { collapsedForDepth, depthToExpansion, sortRows } from './core/charts/table/view';
export type { TableSort } from './core/charts/table/view';

export type { CreativeData, CreativeOptions, CreativeMedia, CreativeMetric, CreativeFatigueRule } from './core/charts/creative/types';

/** Build a per-chart measurer from a generated font table document. */
export {
  parseFontMetricTables,
  type FontMetricFace,
  type FontMetricTables,
  type FontMetricStyle,
  type SkippedFont,
} from './core/fontMetrics/tableDocument';
export { createMetricTablesMeasurer, measurableFamilies, metricTablesFamilies } from './core/fontMetrics/injected';

export type { ChartReading, StructureCount } from './core/reading';

export type { MetricStackData, MetricStackPanel, MetricStackOptions, StackReadout } from './core/charts/grid/metricStack';

export { tableLooks } from './tableLooks';
