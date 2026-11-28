import { linkStoryLayer } from '../core/storyLayer';
import { linkAnnotateEngine } from '../core/annotateEngine';
import { linkThemeShapeRules } from '../core/themeShapeRules';
import { themes } from '../core/theme';
import { claimsForChart } from '../core/claims/browser';
import { interactionRecords } from '../core/a11y/records';
import { overlayInputs } from './hover/placement';
import { resolveSize } from '../core/normalize/shared';
import { sceneThemeBindings } from '../core/repaintGeometry';
import { resolveChartRequest, planResolvedRequest, tableViewportFrame, measureResolvedRequest, type ChartRequest } from '../core/request';
import type { TableData, TableOptions } from '../core/types/table';
import type { PrepareChartRequest } from './prepare';
import type { ResolvedChartRequest } from '../core/request';
import { loadChartTypes } from './loadChartTypes';
import { parseChartSpec, requestChartTypes } from './parseChartSpec';
import { specSettings } from './specValidation';
import { containerFit, layoutContainerRequest } from './containerLayout';
import { canonicalJson, prepareChartRender, requestRenderKey, type PreparedChart } from './prepared';
import { prepareTableRender, type PreparedTable } from './preparedTable';
import type { BoardplotThemeOptions } from './themeContext';
import { resolveThemeRequest } from './themeRequest';
import { LiveDataError } from '../core/live/types';
import { rowsKey } from './rowsStore';
import { rowsModule } from './rowsModule';
import { dataHash, preparedInputKey } from './preparedInput';

/** The spec that `parseChartSpec` read, on the request it returns (parseChartSpec.ts writes it): `prepareChart` keys the page of that spec. */
const SPEC_SOURCE = Symbol.for('boardplot.specSource');

/**
 * The planner of `boardplot/react/prepare`: layout, the renderers and the interaction records. The entry loads it at
 * the first call. The links run through this call, not at module scope, because a host bundler can drop the body of
 * a chunk it treats as free of side effects; with them a patched theme and annotations lay out synchronously.
 */
export function linkedPlanner() {
  linkThemeShapeRules();
  linkAnnotateEngine();
  linkStoryLayer();
  return { prepareChart, loadChartPlanner };
}

async function prepareChart(input: PrepareChartRequest, context: BoardplotThemeOptions = {}): Promise<PreparedChart | PreparedTable> {
  const { size, fallbackSize, fit, window, rows, columns, ...authored } = input;
  // Rows map as the component maps them, and a refused mapping throws its InputError, as specFromRows does.
  const adapted = rows === undefined && columns === undefined ? undefined
    : rowsModule.adaptRows({ type: input.type, data: input.data }, columns, { argument: '/rows', load: () => ({ rows }) });
  const request = (adapted ? { ...authored, data: adapted.spec.data } : authored) as Omit<ChartRequest, 'size'>;
  await loadChartTypes(requestChartTypes(input.type, request.data), { schemas: false, cores: true });
  if (window && !['line', 'profile'].includes(input.type)) throw new LiveDataError('unsupported-shape', 'window', 'The live window prop supports line and area charts.');
  const container = size === 'container';
  const activeFit = container ? containerFit(input.type, fit) : undefined;
  const frame = container ? resolveSize(fallbackSize, request.target ?? request.options?.target ?? context.target) : size;
  const resolveFor = (chart: Omit<ChartRequest, 'size'>) => resolveThemeRequest({ ...chart, options: (window ? { ...chart.options, window } : chart.options) as ChartRequest['options'], size: frame }, context);
  const resolved = resolveFor(request);
  // A patched theme travels with the snapshot; a preset is the same object in every bundle.
  const theme = typeof resolved.options.theme === 'object' && resolved.options.theme.overrides !== undefined ? { theme: resolved.theme } : {};
  if (resolved.type === 'table') return JSON.parse(canonicalJson({ ...prepareTableRender(resolved as ResolvedChartRequest<TableData, TableOptions>), fit: activeFit, ...theme })) as PreparedTable;
  const laidOut = layoutContainerRequest(resolved, activeFit);
  // The findings name the rows field, and the snapshot carries the mapped data, so hydration draws without the rows chunk.
  const geometry = adapted ? { ...laidOut, warnings: rowsModule.rewriteWarningFields(laidOut.warnings, adapted.pathMap) } as typeof laidOut : laidOut;
  const mapped = adapted && { rows: { key: rowsKey({ type: resolved.type, data: input.data }, rows, columns), data: adapted.spec.data,
    reading: { rows: adapted.rows, ignoredColumns: adapted.ignoredColumns, states: adapted.states } } };
  const inputKeys = window ? [] : await pageKeys(authored, adapted && ((page: Record<string, unknown>) => rowsModule.adaptRows({ type: page.type as string, data: page.data }, columns, { argument: '/rows', load: () => ({ rows }) }).spec.data), { size, fit, fallbackSize, rows, columns }, context, resolved, resolveFor, 'theme' in theme);
  const prepared = { ...prepareChartRender(resolved, geometry), ...mapped, ...(inputKeys.length ? { inputKeys } : {}) };
  if (geometry.refused) return { ...prepared, fit: activeFit, records: [], ...theme };
  const records = interactionRecords({ request: resolved, geometry, scope: resolved.scope, claims: claimsForChart(resolved.type, geometry) });
  return JSON.parse(canonicalJson({ ...prepared, fit: activeFit, records, ...theme,
    overlay: overlayInputs(resolved, geometry),
    paintThemes: sceneThemeBindings(geometry) })) as PreparedChart;
}

type Page = [spec: Record<string, unknown>, host: { theme?: unknown; target?: unknown }, parsed: Record<string, unknown>];

/**
 * The keys of the pages whose first frame shows this chart. A page counts only when the parser reads its spec and host
 * props, as `BoardplotChart` does, into a request that lays out as this one: so a page that the live chart refuses, or
 * draws in another way, never shows it. The pages are the spec `parseChartSpec` read, with and without the host's theme
 * and target props, and the request written as a bare chart with its theme and target in each place a page can hold them.
 * Each key also stands for the pages of the same form, see `pageForm` in preparedInput.ts.
 */
async function pageKeys(authored: Record<string | symbol, unknown>, mapRows: ((page: Record<string, unknown>) => unknown) | undefined, sizing: Record<string, unknown>, context: BoardplotThemeOptions,
  prepared: ResolvedChartRequest, resolveFor: (chart: Omit<ChartRequest, 'size'>) => ResolvedChartRequest, carriesTheme: boolean): Promise<string[]> {
  const { theme, target, [SPEC_SOURCE]: source, ...rest } = authored;
  const { theme: optionTheme, target: optionTarget, ...options } = (rest.options ?? {}) as Record<string, unknown>;
  const T = theme ?? optionTheme, G = target ?? optionTarget;
  const pages: Page[] = [];
  // The bare forms differ in where the theme stands, which the parser reads alike, and in whether the target stands in the
  // options, which decides the canvas the margins are checked against. One parse serves the forms of one target placement.
  const bare = (inOptions: boolean) => ({ ...rest, options: { ...options, ...(T !== undefined && { theme: T }), ...(inOptions && G !== undefined && { target: G }) } });
  const bareForms = [bare(false), bare(true)];
  const parses = new Map<object, ReturnType<typeof parseChartSpec>>();
  if (source) {
    // A document of several charts shows one of them as the document with that chart alone.
    const [spec, chart] = source as [Record<string, unknown>, string | undefined];
    const page = chart === undefined || !Array.isArray(spec.charts) ? spec : { ...spec, charts: spec.charts.filter((entry: { name?: unknown }) => entry?.name === chart) };
    // The page as written, and with the host's theme or target prop over the spec's own.
    for (const t of T === undefined ? [false] : [false, true]) for (const g of G === undefined ? [false] : [false, true]) {
      pages.push([page, { ...(t && { theme: T }), ...(g && { target: G }) }, page]);
    }
  }
  // The request written as a bare chart, with its theme at its top, in a prop or in its options, and its target in a prop or in its options.
  for (const t of T === undefined ? [''] : ['prop', 'top', 'options']) for (const g of G === undefined ? [''] : ['prop', 'options']) {
    pages.push([{ ...rest, ...(t === 'top' && { theme: T }), options: { ...options, ...(t === 'options' && { theme: T }), ...(g === 'options' && { target: G }) } },
      { ...(t === 'prop' && { theme: T }), ...(g === 'prop' && { target: G }) }, bareForms[g === 'options' ? 1 : 0]!]);
  }
  // A page draws the prepared chart when its render key without the data and its data as one JSON string are the same.
  // The data is the large part, so the check compares it as a string and every page hashes it once.
  const apart = (request: ResolvedChartRequest) => [requestRenderKey({ ...request, data: null }), canonicalJson(request.data)].join();
  const key = apart(prepared), hashes = new Map<unknown, string>();
  const hashData = (data: unknown) => hashes.get(data) ?? hashes.set(data, dataHash(data)).get(data)!;
  const keys = new Set<string>(), tried = new Set<string | undefined>();
  for (const [spec, host, form] of pages) {
    const page = preparedInputKey(spec, { ...host, ...sizing }, context, themes, hashData);
    // Pages of one form draw one chart, so one check serves them all. The first frame draws a theme object without a
    // preset that the prepared value does not carry in the default theme, so such a page shows the busy placeholder.
    // The theme the first frame reads, in its order. A grid panel's theme draws inside the prepared scene.
    const chart = Object(Array.isArray(spec.charts) ? spec.charts[0] : spec);
    const active = host.theme ?? Object(chart.options).theme ?? chart.theme ?? spec.theme;
    if (tried.has(page) || !carriesTheme && active !== null && typeof active === 'object' && !('preset' in active)) continue;
    tried.add(page);
    try {
      specSettings({ ...host, size: sizing.size, fit: sizing.fit, fallbackSize: sizing.fallbackSize } as never);
      if (!parses.has(form)) parses.set(form, parseChartSpec(mapRows ? { ...form, data: mapRows(form) } : form));
      const { request } = await parses.get(form)!;
      const live = { ...request, options: { ...request.options, ...Object.fromEntries(Object.entries(host).filter(([, value]) => value !== undefined)) } };
      if (page && apart(resolveFor(live)) === key) keys.add(page);
    } catch { /* a page the parser refuses shows no prepared chart */ }
  }
  return [...keys];
}

async function loadChartPlanner(input: Pick<ChartRequest, 'type' | 'data'>) {
  await loadChartTypes(requestChartTypes(input.type, input.data), { schemas: true, cores: true });
  return { resolve: resolveChartRequest, layout: planResolvedRequest, tableViewportFrame, measure: measureResolvedRequest };
}
