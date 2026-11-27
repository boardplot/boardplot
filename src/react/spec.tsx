"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore, type ComponentType, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactElement } from 'react';
import type { InteractionRecord } from '../core/a11y/types';
import type { ZoomOption } from './useZoom';
import { chartLoaders } from './chartLoaders';
import { aliasOwners, chartTypeAliases, schemaLoaders } from './schemaLoaders';
import { getChart, getChartSchemas, registerChartSchemas } from '../core/registry';
import type { Id } from '../core/types/cell';
import type { Annotation } from '../core/types/annotations';
import { withAnnotationOrigins } from '../core/annotationOrigin';
import type { DocumentFinding } from '../core/doc/diagnostics';
import type { Geometry, LintWarning } from '../core/types/scene';
import type { BaseOptions, RenderTarget } from '../core/types/options';
import { resolveSize } from '../core/normalize/shared';
import type { ThemeRef } from '../core/types/theme';
import type { TableData } from '../core/types/table';
import { createChartComponent, type ChartProps } from './createChartComponent';
import { EmptyPlaceholder, LoadingPlaceholder, type EmptyProps, type RefusalProps } from './SizePlaceholder';
import type { PreparedChart } from './prepared';
import type { PreparedTable } from './preparedTable';
import type { ParsedChartSpec } from './specValidation';
import { loadedDimSwitchChart, loadedSpecValidator, loadedTableChart, onHandover, publishDimSwitchChart, publishSpecValidator, publishTableChart, type SpecValidator } from './specHandover';
import { usePreparedFirstFrame } from './preparedFirstFrame';
import { withoutZodCodeGeneration } from './zodSetup';
import type { DimSwitchChartProps } from './DimSwitchChart';
import { SpecErrorCard } from './SpecErrorCard';
import { useSpecFrame } from './specFrame';
import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect';
import type { TableChartProps } from './TableChart';
import type { ContainerSizeOptions } from './useContainerSize';
import type { HoverOption, RenderHoverContent } from './useHover';
import { DataTableContext } from './hover/HoverSurface';
import type { ExportLink } from './exportLink';
import { useRowsInput, type RowsProps } from './rowsInput';
import { zoomHookFor } from './zoomHook';
export type { ParsedChartSpec, BoardplotSpecSettings } from './specValidation';
export type { BoardplotSpec } from '../core/types/specInput';
export type { HoverContentContext, HoverOption, RenderHoverContent } from './useHover';

export interface BoardplotChartProps extends ContainerSizeOptions, RefusalProps, EmptyProps, RowsProps {
  /** A bare chart `{ name, type, data, options, annotations, theme }` or an envelope with one chart; with `rows`, a bare chart whose data the rows fill. */
  spec: unknown;
  /** Host theme; it overrides the spec's theme. */
  theme?: ThemeRef;
  /** Overrides spec.options.target; otherwise inherits the provider target. */
  target?: RenderTarget;
  /** Canonical and observed display findings. */
  onWarnings?: (warnings: LintWarning[]) => void;
  /**
   * Called after commit with the findings `SpecErrorCard` shows: an invalid spec or setting, or a chunk
   * that did not load. Once per distinct set. It is called once with `[]` when a later valid spec
   * replaces the error card (its chart engine is ready, or its data is empty), without waiting for the
   * chart to draw, because a valid spec can still wait for its container or refuse its size.
   * Empty data stays on `onEmpty`, a layout refusal on `onRefused`.
   */
  onSpecError?: (errors: readonly DocumentFinding[]) => void;
  /** Label card and series highlight on pointer hover. Off by default. */
  hover?: HoverOption;
  /** Called with the series id when the reader clicks a series' line or area, its name label or its legend entry. SVG charts only. */
  onSeriesClick?: (seriesId: Id) => void;
  /** Called with the record the reader clicks, the one the hover card names, or presses Enter or Space on; a click on a mark then fires no `onSeriesClick`. SVG charts only. */
  onRecordClick?: (record: InteractionRecord, event: MouseEvent<Element> | KeyboardEvent<Element>) => void;
  /**
   * Called with the row id and `{ row, event, columnId }` when the reader picks a table row: a click in
   * it outside a link or a button, or Enter or Space on its focused cell. Tables only: `table` (alias
   * `tbl`) and `dimswitch`; no other chart type receives it.
   */
  onRowSelect?: TableChartProps['onRowSelect'];
  /** Which table rows `onRowSelect` covers; absent, every row but a section heading. Tables only. */
  isRowSelectable?: TableChartProps['isRowSelectable'];
  /** Line and area on a time, date or number x: Ctrl or Cmd with the wheel, a pinch, or + and - on the focused chart zoom; see the chart components. */
  zoom?: ZoomOption;
  /** Your own hover card content: `(record, { records, defaultContent, source })`; return `defaultContent`, wrap it, replace it or return null. Turns on `hover` when it is absent. SVG charts only. */
  renderHoverContent?: RenderHoverContent;
  /** SVG charts only; prepared attachment does not manufacture full geometry. */
  onGeometry?: (geometry: Geometry) => void;
  /** Server result of `prepareChart` for the same spec and settings. */
  prepared?: PreparedChart | PreparedTable;
  /** Render at intrinsic size instead of filling the parent. SVG charts only. */
  fixedSize?: boolean;
  /** On by default: a new size or new data lays the chart out in the background while the last drawing stays. `false` lays it out at once. SVG charts only. */
  deferLayout?: boolean;
  /** CSP nonce for the style elements this component renders. */
  styleNonce?: string;
  /** Prepended to every id the chart writes; one per separately rendered React root. */
  idPrefix?: string;
  /** The handle from `useExport()` (`boardplot/react/export`): it exports this chart as drawn on screen. */
  exporter?: ExportLink;
  /** Tables only: the reader's folds as an `options.expansion`, after each fold or unfold. Store it in the spec to keep the view; see `TableChart`. */
  onExpansionChange?: TableChartProps['onExpansionChange'];
  /** Applied to one wrapper around every state the component draws: the busy placeholder, a card and the chart. */
  className?: string;
  style?: CSSProperties;
  /** Your own text measurer for the layout, as on the chart components. Pass the same function on every render. Not with `prepared`. */
  measure?: BaseOptions['measure'];
}

type AnyChart = ComponentType<ChartProps<unknown, Record<string, unknown>>>;

/** One component per chart type, built once, so a rerender never remounts the chart. */
const components = new Map<string, AnyChart>();

function componentFor(type: string): AnyChart {
  let component = components.get(type);
  if (!component) {
    component = createChartComponent<unknown, Record<string, unknown>>(type, undefined, undefined, zoomHookFor(type)) as unknown as AnyChart;
    components.set(type, component);
  }
  return component;
}

/**
 * What this page has loaded on demand, as one store. `subscribe` is shared,
 * so a chunk that lands redraws every chart that was waiting for it.
 */
const waiting = new Set<() => void>();
/** Chunk key -> the message of the load that failed. */
const failures = new Map<string, string>();
/** Chunk key -> the load in flight. A settled load leaves no entry behind. */
const loads = new Map<string, Promise<void>>();
const VALIDATION = 'validation';

function subscribe(redraw: () => void): () => void {
  waiting.add(redraw);
  const stop = onHandover(redraw);
  return () => { waiting.delete(redraw); stop(); };
}

function announce(): void {
  for (const redraw of [...waiting]) redraw();
}

/**
 * Starts one chunk's load, one at a time per key. A rejected load leaves no
 * cache entry, so the next render tries again, and it announces its message
 * only when that message is new — a chunk that is simply not deployed settles
 * on the error card instead of retrying in a loop.
 */
/** Drops a stored failure once its chunk is here after all, so nothing announces it again. */
function forget(key: string): void {
  if (failures.delete(key)) announce();
}

function load(key: string, start: () => Promise<void>): void {
  if (loads.has(key)) return;
  loads.set(key, start().then(() => {
    loads.delete(key);
    failures.delete(key);
    announce();
  }, (reason: unknown) => {
    loads.delete(key);
    const message = reason instanceof Error ? reason.message : String(reason);
    const first = failures.get(key) !== message;
    failures.set(key, message);
    if (first) announce();
  }));
}

/**
 * The server holds nothing, whatever this process loaded for an earlier
 * request: `getServerSnapshot` is what the server pass and the client pass
 * that hydrates it both read, so identical requests produce identical markup
 * and hydration never meets a chart where the server wrote a placeholder.
 */
const nothingLoaded = () => undefined;
const notReady = () => false;
/** A stored failure counts only while the chunk is still missing: a validator or engine that
 * arrived by another route (a static import, another code-split page) wins over it. */
const readValidationFailure = () => (loadedSpecValidator() ? undefined : failures.get(VALIDATION));

/** Validation: zod, the document parser and the diagnostics, in one chunk, no chart type in it. */
function useSpecValidator(): { validator?: SpecValidator; failure?: string } {
  const validator = useSyncExternalStore(subscribe, loadedSpecValidator, nothingLoaded);
  const failure = useSyncExternalStore(subscribe, readValidationFailure, nothingLoaded);
  // No dependency list: a render that still has no validator asks again, so a
  // load that failed is retried rather than leaving the chart in limbo.
  useEffect(() => {
    if (validator) { forget(VALIDATION); return; }
    withoutZodCodeGeneration();
    load(VALIDATION, () => import('./specValidation').then(module => {
      publishSpecValidator({
        beginSpecParse: module.beginSpecParse,
        specSettings: module.specSettings,
        BoardplotSpecError: module.BoardplotSpecError,
      });
    }));
  });
  return { validator, failure };
}

type DataTableModule = typeof import('./hover/dataTable');
const DATA_TABLE = 'data-table';
let dataTableModule: DataTableModule | undefined;
const noFailure = () => false;

/**
 * The accessible data table's module, loaded only for a spec that asks for the table. The chart waits
 * for it, so the table is in the first client render, as before. Charts without the table never link it.
 * A load that failed ends the wait: the chart draws, and the chart component retries the table itself.
 */
function useDataTable(wanted: boolean): { module?: DataTableModule; waiting: boolean } {
  const module = useSyncExternalStore(subscribe, () => dataTableModule, nothingLoaded);
  const failed = useSyncExternalStore(subscribe, () => failures.has(DATA_TABLE), noFailure);
  useEffect(() => {
    if (!wanted || module || failed) return;
    load(DATA_TABLE, () => import('./hover/dataTable').then(loaded => { dataTableModule = loaded; }));
  });
  return { module, waiting: wanted && !module && !failed };
}

const NO_TYPES: readonly string[] = [];


/** The type a spec's name stands for, or undefined for a name Boardplot does not draw. */
function knownType(name: string): string | undefined {
  // Object.hasOwn, not `in`: an authored type called 'toString' would
  // otherwise pick Object.prototype's and be called as a loader.
  return Object.hasOwn(schemaLoaders, name) ? name : aliasOwners.get(name);
}

/** What a type's schema chunk is keyed by, beside the engine chunk of the same name. */
const schemaKey = (type: string) => `schema:${type}`;

/**
 * Settled means validation can judge this type now: either its schemas are
 * here, or the name is not one Boardplot draws and no chunk would ever supply
 * them — that one validation refuses itself, with the unknown-type
 * diagnostic and its suggestion.
 */
function schemasSettled(type: string): boolean {
  return getChartSchemas(type) !== undefined || knownType(type) === undefined;
}

/**
 * The schemas of every type one spec is validated against: the chart's own,
 * and for a grid its panels' too. Each is its own chunk and carries no
 * engine, so `getChart` stays undefined and the chart still waits for
 * `chartLoaders` below.
 */
function useChartSchemas(types: readonly string[] | undefined): { ready: boolean; failure?: string; failedType?: string } {
  const wanted = types ?? NO_TYPES;
  const ready = useSyncExternalStore(subscribe, () => wanted.every(schemasSettled), notReady);
  // The store reads hand back strings, never fresh objects: useSyncExternalStore
  // re-renders on every snapshot that is not identical to the last one.
  const failedType = useSyncExternalStore(subscribe, () => refusedSchema(wanted), nothingLoaded);
  useEffect(() => {
    for (const type of wanted) {
      if (schemasSettled(type)) { forget(schemaKey(type)); continue; }
      const start = schemaLoaders[knownType(type)!]!;
      load(schemaKey(type), () => start().then(schemas => {
        registerChartSchemas(schemas, chartTypeAliases[schemas.type]);
      }));
    }
  });
  return { ready, ...(failedType === undefined ? {} : { failedType, failure: failures.get(schemaKey(failedType)) }) };
}

/** The first type of this spec whose schema chunk did not load and is still missing. */
function refusedSchema(types: readonly string[]): string | undefined {
  return types.find(type => getChartSchemas(type) === undefined && failures.has(schemaKey(type)));
}

/** Whether the named type's engine is here, and why it is not. */
function useChartEngine(type: string | undefined): { ready: boolean; failure?: string } {
  const ready = useSyncExternalStore(subscribe, () => type !== undefined && engineReady(type), notReady);
  const failure = useSyncExternalStore(subscribe, () => (type === undefined || engineReady(type) ? undefined : failures.get(type)), nothingLoaded);
  useEffect(() => {
    if (type === undefined) return;
    if (ready) { forget(type); return; }
    const start = chartLoaders[type];
    // An unknown type has no loader; validation has already refused it.
    if (!start) return;
    load(type, () => start().then(module => {
      if (type === 'table') publishTableChart((module as { TableChart: ComponentType<TableChartProps> }).TableChart);
      if (type === 'dimswitch') publishDimSwitchChart((module as { DimSwitchChart: ComponentType<DimSwitchChartProps> }).DimSwitchChart);
    }));
  });
  return { ready, failure };
}

/**
 * The registry is the handover for the 30 component types, the published
 * component for table. A page that already drew that type, or that imported
 * `boardplot/react/<type>`, draws it without waiting.
 */
function engineReady(type: string): boolean {
  // A line chart also waits for its entry, which carries the zoom hook: a server or an export can register its core alone.
  return type === 'table' ? loadedTableChart() !== undefined
    : (type === 'dimswitch' ? loadedDimSwitchChart() !== undefined : getChart(type) !== undefined && (type !== 'line' || zoomHookFor(type) !== undefined));
}

/** What the reader sees when a chunk did not arrive at all. */
function chunkFailure(what: string, message: string): DocumentFinding[] {
  return [{
    code: 'chunk-load-failed',
    message: `Loading the ${what} failed: ${message}`,
    path: '',
    suggest: 'Reload the page; if it persists the deployment lacks this chunk.',
    docs: 'docs/reference/react.md#boardplotchart',
  }];
}

/** What one BoardplotChart last told its host, shared by the card paths of BoardplotChart and SpecChart. */
interface SpecErrorChannel { listener: { current?: (errors: readonly DocumentFinding[]) => void }; reported: { current: string } }

const NO_ERRORS: readonly DocumentFinding[] = [];

/**
 * Tells the host about the findings this committed render shows: the card's findings, `NO_ERRORS`
 * once a valid spec replaces the card (its engine is ready, or its data is empty), and nothing while
 * a chunk loads. The findings come from the effect's own render. A set counts as reported only once
 * a listener has taken it, so a host that adds `onSpecError` while the card shows still hears it.
 * A set equal to the last one delivered is not sent again, so a host that sets state from the call
 * does not loop, and StrictMode's second effect run finds the set already delivered. A first draw
 * sends nothing.
 */
function useSpecErrorReport(channel: SpecErrorChannel, errors: readonly DocumentFinding[] | undefined, listening: boolean): void {
  const key = errors === undefined ? undefined : JSON.stringify(errors);
  useEffect(() => {
    const listener = channel.listener.current;
    if (key === undefined || channel.reported.current === key || !listener) return;
    channel.reported.current = key;
    listener(errors!);
    // `errors` is left out of the list: it changes with `key`, and an equal set is no new report.
  }, [channel, key, listening]);
}

function specResult<T>(validator: SpecValidator, read: () => T): { value?: T; errors?: readonly DocumentFinding[] } {
  try { return { value: read() }; }
  catch (error) {
    if (!(error instanceof validator.BoardplotSpecError)) throw error;
    return { errors: error.errors };
  }
}

/**
 * BoardplotChart takes no chart name, so the parse's advice to pass one cannot
 * be followed here; the card says what the component takes instead.
 */
function oneChart<T>(result: { value?: T; errors?: readonly DocumentFinding[] }): typeof result {
  return result.errors ? { errors: result.errors.map((error) => error.code !== 'chart-selection-required' ? error : {
    ...error,
    message: 'BoardplotChart draws one chart, and this document holds several.',
    suggest: 'Pass a bare chart or an envelope with one chart, one BoardplotChart per chart.',
    expected: { ...error.expected, condition: 'a bare chart or an envelope with one chart' },
    docs: 'docs/reference/react.md#boardplotchart',
  }) } : result;
}

/**
 * The spec-driven chart. It takes the same spec `boardplot_render` validates and
 * draws it with the per-type component of its type. Three things load on
 * demand, in that order: the shared validation chunk, the schemas of the type
 * the spec names, and that type's engine. The entry links none of them. Until
 * they are there, a server pass and the browser draw the busy placeholder, or
 * the chart of a `prepared` SVG value for the same props as a picture. A
 * `dimswitch` spec draws the interactive dimension-switch table. An invalid spec
 * or setting renders `SpecErrorCard` with each diagnostic's path, expected and
 * received values, suggestion, JSON Patch fix and reference link, and so does
 * a chunk that could not be loaded. `className` and `style` sit on one wrapper
 * around every state.
 */
export function BoardplotChart({ className, style, ...props }: BoardplotChartProps): ReactElement {
  const chart = <SpecStates {...props} />;
  return className !== undefined || style !== undefined ? <div className={className} style={style}>{chart}</div> : chart;
}

/** Every state of one spec: the busy placeholder or the prepared chart's first frame, a card, and the chart. */
function SpecStates(props: BoardplotChartProps): ReactElement {
  const { spec: authored, size, fit, fallbackSize, theme, target, hover, rows, columns, onRowsReading } = props;
  const listener = useRef<SpecErrorChannel['listener']['current']>(undefined);
  const reported = useRef(JSON.stringify(NO_ERRORS));
  const channel = useMemo((): SpecErrorChannel => ({ listener, reported }), []);
  // The committed callback only: a render that never commits (a suspended transition) must not
  // replace it. Layout effects run before every passive effect of the commit, SpecChart's included.
  useIsomorphicLayoutEffect(() => { listener.current = props.onSpecError; });
  const listening = props.onSpecError !== undefined;
  // Rows fill the spec's data before validation, so the spec is judged as `boardplot_render` judges it with rows.
  const mapped = useRowsInput<unknown>(authored as { type?: unknown; data?: unknown } | undefined, { rows, columns, onRowsReading });
  const withRows = rows !== undefined || columns !== undefined;
  const spec = withRows ? mapped.spec : authored;
  const { validator, failure } = useSpecValidator();
  const frame = useSpecFrame(spec ?? authored, props);
  // Two steps, because the type has to be read before its schemas can be
  // asked for: the shared chunk selects the chart and names the types, the
  // schema chunks judge it. Both halves refuse with the same diagnostics the
  // one-pass parse produced.
  // Only rows that are still mapping hold the parse back; any spec without rows is judged as sent.
  const parse = useMemo(() => (validator && !(withRows && spec === undefined) ? oneChart(specResult(validator, () => validator.beginSpecParse(spec))) : undefined), [validator, spec, withRows]);
  const schemas = useChartSchemas(parse?.value?.types);
  const parsed = useMemo((): { value?: ParsedChartSpec; errors?: readonly DocumentFinding[] } | undefined => {
    if (parse?.errors) return { errors: parse.errors };
    if (!parse?.value || !validator || !schemas.ready) return undefined;
    return specResult(validator, () => parse.value!.finish());
  }, [parse, validator, schemas.ready]);
  const settings = useMemo(() => validator && specResult(validator, () => validator.specSettings({ size, fit, fallbackSize, theme, target, hover })),
    [validator, size, fit, fallbackSize, theme, target, hover]);
  const dataTable = useDataTable(Boolean(parsed?.value?.request.options?.a11y?.table));
  // A prepared chart for these props draws from the prepared value until the chart of its type can take its place in one step.
  const firstFrame = usePreparedFirstFrame(authored, props, frame);
  const engine = useChartEngine(firstFrame ? parsed?.value?.request.type : undefined);
  const waiting = firstFrame ?? <LoadingPlaceholder {...frame} />;
  const errors = !parsed || !settings ? undefined
    : settings.errors ?? (parsed.errors && mapped.rewrite ? mapped.rewrite([...parsed.errors]) : parsed.errors);
  // A spec that fails only on an empty data collection is an empty chart: the host hears onEmpty and no error card shows.
  const empty = errors !== undefined && errors.length > 0 && errors.every((error) => error.code === 'empty-data');
  const card = mapped.failure !== undefined ? chunkFailure('rows chunk', mapped.failure)
    : mapped.refusal ? [mapped.refusal]
    : failure !== undefined ? chunkFailure('chart validation chunk', failure)
    : schemas.failure !== undefined ? chunkFailure(`'${schemas.failedType}' chart schema`, schemas.failure)
    : empty ? undefined : errors;
  // Nothing while a chunk loads or while SpecChart decides; it reports the engine's card and the drawn chart itself.
  useSpecErrorReport(channel, card ?? (empty ? NO_ERRORS : undefined), listening);
  if (card) return <SpecErrorCard errors={card} {...frame} />;
  if (!parsed || !settings) return waiting;
  if (empty) return <EmptyPlaceholder {...frame} onEmpty={props.onEmpty} />;
  if (dataTable.waiting || (firstFrame && !engine.ready && engine.failure === undefined)) return waiting;
  return <DataTableContext.Provider value={dataTable.module}><SpecChart {...props} parsed={parsed.value!} channel={channel} listening={listening} rewriteWarnings={mapped.rewriteWarnings} drawn={firstFrame !== undefined} /></DataTableContext.Provider>;
}

function SpecChart({ parsed, channel, listening, spec: _spec, theme, size, target, onWarnings, onSpecError: _onSpecError, prepared, rows: _rows, columns: _columns, onRowsReading: _onRowsReading, rewriteWarnings, onRowSelect, isRowSelectable, drawn, ...host }: BoardplotChartProps & { parsed: ParsedChartSpec; channel: SpecErrorChannel; listening: boolean; rewriteWarnings?: (warnings: LintWarning[]) => LintWarning[]; drawn: boolean }): ReactElement {
  const { type, data, options = {} } = parsed.request;
  const { ready, failure } = useChartEngine(type);
  const engineFailure = useMemo(() => (failure === undefined ? undefined : chunkFailure(`'${type}' chart engine`, failure)), [type, failure]);
  useSpecErrorReport(channel, engineFailure ?? (ready ? NO_ERRORS : undefined), listening);
  // Chart-level annotations win over options.annotations, as in resolveChartRequest. The chart takes either list as
  // its annotations prop, so each entry records here the list the author wrote it in, for refusal pointers.
  const rootAnnotations = parsed.request.annotations;
  const optionAnnotations = (options as { annotations?: Annotation[] }).annotations;
  const annotations = useMemo(() => rootAnnotations ? withAnnotationOrigins(rootAnnotations, ['annotations'])
    : optionAnnotations && withAnnotationOrigins(optionAnnotations, ['options', 'annotations']), [rootAnnotations, optionAnnotations]);
  const common = { ...options, ...(target === undefined ? {} : { target }), ...(theme === undefined ? {} : { theme }), ...(size === undefined ? {} : { size }) };
  const frame = useSpecFrame({ type, data, options: common }, { ...host, size, theme, target, prepared });
  const reportWarnings = useMemo(() => onWarnings && ((warnings: LintWarning[]) => {
    const all = [...parsed.warnings, ...warnings];
    onWarnings(rewriteWarnings ? rewriteWarnings(all) : all);
  }), [onWarnings, parsed.warnings, rewriteWarnings]);
  if (engineFailure) return <SpecErrorCard errors={engineFailure} {...frame} />;
  if (!ready) return <LoadingPlaceholder {...frame} />;
  // The row props reach the table alone: a generic chart would take them into its options.
  if (type === 'table') {
    if (prepared && prepared.kind !== 'table') throw new Error('Expected a prepared table.');
    const { onGeometry: _onGeometry, fixedSize: _fixedSize, deferLayout: _deferLayout, ...table } = host;
    const Table = loadedTableChart()!;
    return <Table {...common as object} {...table} onRowSelect={onRowSelect} isRowSelectable={isRowSelectable} onWarnings={reportWarnings} data={data as TableData} {...{ annotations } as object} prepared={prepared} />;
  }
  const { onExpansionChange: _onExpansionChange, ...chart } = host;
  // The interactive table, unless the host asks for something only the picture has. The view comes from the options,
  // and a prepared picture cannot turn into the table, so the table draws from the data.
  if (type === 'dimswitch' && !chart.onGeometry && !chart.fixedSize && !chart.onRecordClick && !chart.onSeriesClick && !chart.renderHoverContent) {
    const { deferLayout: _deferLayout, zoom: _zoom, fixedSize: _fixedSize, ...table } = chart;
    const DimSwitch = loadedDimSwitchChart()!;
    return <DimSwitch {...common as object} {...table} onRowSelect={onRowSelect} isRowSelectable={isRowSelectable} onWarnings={reportWarnings} data={data as DimSwitchChartProps['data']} {...{ annotations } as object} />;
  }
  if (prepared && prepared.kind !== 'svg') throw new Error('Expected a prepared SVG chart.');
  const Chart = componentFor(type);
  // The first frame drew the prepared chart at the frame `prepareChart` used. The same frame as `fallbackSize` lets a
  // container chart attach to it at once, where it would otherwise wait for its first width on the busy placeholder.
  const frameSize = drawn && common.size === 'container' && chart.fallbackSize === undefined ? { fallbackSize: resolveSize(undefined, frame.options.target) } : undefined;
  return <Chart {...common} {...chart} {...frameSize} onWarnings={reportWarnings} data={data} annotations={annotations} prepared={prepared} />;
}
