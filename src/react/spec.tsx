"use client";

import { useEffect, useMemo, useSyncExternalStore, type ComponentType, type KeyboardEvent, type MouseEvent, type ReactElement } from 'react';
import type { InteractionRecord } from '../core/a11y/types';
import type { ZoomOption } from './useZoom';
import { chartLoaders } from './chartLoaders';
import { chartTypeAliases, schemaLoaders } from './schemaLoaders';
import { getChart, getChartSchemas, registerChartSchemas } from '../core/registry';
import type { Id } from '../core/types/cell';
import type { Annotation } from '../core/types/annotations';
import type { DocumentFinding } from '../core/doc/diagnostics';
import type { Geometry, LintWarning } from '../core/types/scene';
import type { RenderTarget } from '../core/types/options';
import type { ThemeRef } from '../core/types/theme';
import type { TableData } from '../core/types/table';
import { createChartComponent, type ChartProps } from './createChartComponent';
import { EmptyPlaceholder, LoadingPlaceholder, type EmptyProps, type RefusalProps } from './SizePlaceholder';
import type { PreparedChart } from './prepared';
import type { PreparedTable } from './preparedTable';
import type { ParsedChartSpec } from './specValidation';
import { loadedSpecValidator, loadedTableChart, onHandover, publishSpecValidator, publishTableChart, type SpecValidator } from './specHandover';
import { SpecErrorCard } from './SpecErrorCard';
import { useSpecFrame } from './specFrame';
import type { TableChartProps } from './TableChart';
import type { ContainerSizeOptions } from './useContainerSize';
import type { HoverOption, RenderHoverContent } from './useHover';
import { DataTableContext } from './hover/HoverSurface';
import type { ExportLink } from './exportLink';
import * as dataTable from './hover/dataTable';
import { useRowsInput, type RowsProps } from './rowsInput';
export type { ParsedChartSpec, BoardplotSpecSettings } from './specValidation';
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
  /** Label card and series highlight on pointer hover. Off by default. */
  hover?: HoverOption;
  /** Called with the series id when the reader clicks a series' line or area, its name label or its legend entry. SVG charts only. */
  onSeriesClick?: (seriesId: Id) => void;
  /** Called with the record the reader clicks, the one the hover card names, or presses Enter or Space on; a click on a mark then fires no `onSeriesClick`. SVG charts only. */
  onRecordClick?: (record: InteractionRecord, event: MouseEvent<Element> | KeyboardEvent<Element>) => void;
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
}

type AnyChart = ComponentType<ChartProps<unknown, Record<string, unknown>>>;

/** One component per chart type, built once, so a rerender never remounts the chart. */
const components = new Map<string, AnyChart>();

function componentFor(type: string): AnyChart {
  let component = components.get(type);
  if (!component) {
    component = createChartComponent<unknown, Record<string, unknown>>(type) as unknown as AnyChart;
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

const NO_TYPES: readonly string[] = [];

/** alias -> the type it names, built once from the generated table. */
const aliasOwners = new Map<string, string>();
for (const [type, aliases] of Object.entries(chartTypeAliases)) {
  for (const alias of aliases) aliasOwners.set(alias, type);
}

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
function useChartEngine(type: string): { ready: boolean; failure?: string } {
  const ready = useSyncExternalStore(subscribe, () => engineReady(type), notReady);
  const failure = useSyncExternalStore(subscribe, () => (engineReady(type) ? undefined : failures.get(type)), nothingLoaded);
  useEffect(() => {
    if (ready) { forget(type); return; }
    const start = chartLoaders[type];
    // An unknown type has no loader; validation has already refused it.
    if (!start) return;
    load(type, () => start().then(module => {
      if (type === 'table') publishTableChart((module as { TableChart: ComponentType<TableChartProps> }).TableChart);
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
  return type === 'table' ? loadedTableChart() !== undefined : getChart(type) !== undefined;
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
 * the spec names, and that type's engine. The entry links none of them and a
 * server pass always draws the busy placeholder; markup that has to be in the
 * server response comes from the type's own component. An invalid spec or
 * setting renders `SpecErrorCard` with each diagnostic's path, expected and
 * received values, suggestion, JSON Patch fix and reference link, and so does
 * a chunk that could not be loaded.
 */
export function BoardplotChart(props: BoardplotChartProps): ReactElement {
  const { spec: authored, size, fit, fallbackSize, theme, target, hover, rows, columns, onRowsReading } = props;
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
  if (mapped.failure !== undefined) return <SpecErrorCard errors={chunkFailure('rows chunk', mapped.failure)} {...frame} />;
  if (mapped.refusal) return <SpecErrorCard errors={[mapped.refusal]} {...frame} />;
  if (failure !== undefined) return <SpecErrorCard errors={chunkFailure('chart validation chunk', failure)} {...frame} />;
  if (schemas.failure !== undefined) {
    return <SpecErrorCard errors={chunkFailure(`'${schemas.failedType}' chart schema`, schemas.failure)} {...frame} />;
  }
  if (!parsed || !settings) return <LoadingPlaceholder {...frame} />;
  const errors = settings.errors ?? (parsed.errors && mapped.rewrite ? mapped.rewrite([...parsed.errors]) : parsed.errors);
  // A spec that fails only on an empty data collection is an empty chart: the host hears onEmpty and no error card shows.
  if (errors?.length && errors.every((error) => error.code === 'empty-data')) return <EmptyPlaceholder {...frame} onEmpty={props.onEmpty} />;
  if (errors) return <SpecErrorCard errors={errors} {...frame} />;
  return <DataTableContext.Provider value={dataTable}><SpecChart {...props} parsed={parsed.value!} rewriteWarnings={mapped.rewriteWarnings} /></DataTableContext.Provider>;
}

function SpecChart({ parsed, spec: _spec, theme, size, target, onWarnings, prepared, rows: _rows, columns: _columns, onRowsReading: _onRowsReading, rewriteWarnings, ...host }: BoardplotChartProps & { parsed: ParsedChartSpec; rewriteWarnings?: (warnings: LintWarning[]) => LintWarning[] }): ReactElement {
  const { type, data, options = {} } = parsed.request;
  const { ready, failure } = useChartEngine(type);
  // Chart-level annotations win over options.annotations, as in resolveChartRequest.
  const annotations = parsed.request.annotations ?? (options as { annotations?: Annotation[] }).annotations;
  const common = { ...options, ...(target === undefined ? {} : { target }), ...(theme === undefined ? {} : { theme }), ...(size === undefined ? {} : { size }) };
  const frame = useSpecFrame({ type, data, options: common }, { ...host, size, theme, target, prepared });
  const reportWarnings = useMemo(() => onWarnings && ((warnings: LintWarning[]) => {
    const all = [...parsed.warnings, ...warnings];
    onWarnings(rewriteWarnings ? rewriteWarnings(all) : all);
  }), [onWarnings, parsed.warnings, rewriteWarnings]);
  if (failure !== undefined) return <SpecErrorCard errors={chunkFailure(`'${type}' chart engine`, failure)} {...frame} />;
  if (!ready) return <LoadingPlaceholder {...frame} />;
  if (type === 'table') {
    if (prepared && prepared.kind !== 'table') throw new Error('Expected a prepared table.');
    const { onGeometry: _onGeometry, fixedSize: _fixedSize, deferLayout: _deferLayout, ...table } = host;
    const Table = loadedTableChart()!;
    return <Table {...common as object} {...table} onWarnings={reportWarnings} data={data as TableData} annotations={annotations as Annotation[] | undefined} prepared={prepared} />;
  }
  if (prepared && prepared.kind !== 'svg') throw new Error('Expected a prepared SVG chart.');
  const Chart = componentFor(type);
  const { onExpansionChange: _onExpansionChange, ...chart } = host;
  return <Chart {...common} {...chart} onWarnings={reportWarnings} data={data} annotations={annotations} prepared={prepared} />;
}
