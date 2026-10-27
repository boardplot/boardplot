import { linkStoryLayer } from '../core/storyLayer';
import { linkAnnotateEngine } from '../core/annotateEngine';
import { linkThemeShapeRules } from '../core/themeShapeRules';
import { claimsForChart } from '../core/claims/browser';
import { interactionRecords } from '../core/a11y/records';
import { overlayInputs } from './hover/placement';
import { resolveSize } from '../core/normalize/shared';
import { sceneThemeBindings } from '../core/repaintGeometry';
import type { ChartRequest, RequestInputOptions, RequestOptions } from '../core/request';
import type { TableData, TableOptions } from '../core/types/table';
import type { ResolvedChartRequest } from '../core/request';
import { loadChartTypes } from './loadChartTypes';
import { requestChartTypes } from './parseChartSpec';
import { containerFit, layoutContainerRequest } from './containerLayout';
import { canonicalJson, prepareChartRender, type PreparedChart } from './prepared';
import { prepareTableRender, type PreparedTable } from './preparedTable';
import type { BoardplotThemeOptions } from './themeContext';
import { resolveThemeRequest } from './themeRequest';
import type { ContainerSizeOptions } from './useContainerSize';
import { LiveDataError, type LiveWindowOptions } from '../core/live/types';
import type { RowsColumns, RowsProps } from './rowsInput';
import { rowsKey } from './rowsStore';
import { rowsModule } from './rowsModule';

// Linked by value, so this entry resolves a patched theme and lays out
// annotations synchronously (see core/deferred) in a host bundle too.
linkThemeShapeRules();
linkAnnotateEngine();
linkStoryLayer();

export type PrepareChartRequest<D = unknown, O extends Omit<RequestOptions, 'annotations'> = RequestInputOptions> =
  (| (Omit<ChartRequest<D, O>, 'size'> & { rows?: undefined; columns?: undefined })
   | (Omit<ChartRequest<D, O>, 'size' | 'data'> & { data?: Partial<D>; rows: NonNullable<RowsProps['rows']>; columns: RowsColumns }))
  & ContainerSizeOptions & { window?: LiveWindowOptions };

/**
 * Prepare once on the server and pass this JSON value with the same React props.
 * It loads the cores of the chart's type and, for a grid, its panels' types, and no other.
 */
export async function prepareChart(input: PrepareChartRequest & { type: 'table' }, context?: BoardplotThemeOptions): Promise<PreparedTable>;
export async function prepareChart(input: PrepareChartRequest, context?: BoardplotThemeOptions): Promise<PreparedChart>;
export async function prepareChart(input: PrepareChartRequest, context: BoardplotThemeOptions = {}): Promise<PreparedChart | PreparedTable> {
  const { size, fallbackSize, fit, window, rows, columns, ...authored } = input;
  // Rows map as the component maps them, and a refused mapping throws its InputError, as specFromRows does.
  const adapted = rows === undefined && columns === undefined ? undefined
    : rowsModule.adaptRows({ type: input.type, data: input.data }, columns, { argument: '/rows', load: () => ({ rows }) });
  const request = (adapted ? { ...authored, data: adapted.spec.data } : authored) as Omit<ChartRequest, 'size'>;
  await loadChartTypes(requestChartTypes(input.type, request.data), { schemas: false, cores: true });
  if (window && !['line', 'profile'].includes(input.type)) throw new LiveDataError('unsupported-shape', 'window', 'The live window prop supports line and area charts.');
  const container = size === 'container';
  const activeFit = container ? containerFit(input.type, fit) : undefined;
  const options = window ? { ...request.options, window } : request.options;
  const frame = container ? resolveSize(fallbackSize, request.target ?? request.options?.target ?? context.target) : size;
  const resolved = resolveThemeRequest({ ...request, options, size: frame }, context);
  // A patched theme travels with the snapshot; a preset is the same object in every bundle.
  const theme = typeof resolved.options.theme === 'object' && resolved.options.theme.overrides !== undefined ? { theme: resolved.theme } : {};
  if (resolved.type === 'table') return JSON.parse(canonicalJson({ ...prepareTableRender(resolved as ResolvedChartRequest<TableData, TableOptions>), fit: activeFit, ...theme })) as PreparedTable;
  const laidOut = layoutContainerRequest(resolved, activeFit);
  // The findings name the rows field, and the snapshot carries the mapped data, so hydration draws without the rows chunk.
  const geometry = adapted ? { ...laidOut, warnings: rowsModule.rewriteWarningFields(laidOut.warnings, adapted.pathMap) } as typeof laidOut : laidOut;
  const mapped = adapted && { rows: { key: rowsKey({ type: resolved.type, data: input.data }, rows, columns), data: adapted.spec.data,
    reading: { rows: adapted.rows, ignoredColumns: adapted.ignoredColumns, states: adapted.states } } };
  const prepared = { ...prepareChartRender(resolved, geometry), ...mapped };
  if (geometry.refused) return { ...prepared, fit: activeFit, records: [], ...theme };
  const records = interactionRecords({ request: resolved, geometry, scope: resolved.scope, claims: claimsForChart(resolved.type, geometry) });
  return JSON.parse(canonicalJson({ ...prepared, fit: activeFit, records, ...theme,
    overlay: overlayInputs(resolved, geometry),
    paintThemes: sceneThemeBindings(geometry) })) as PreparedChart;
}

/** JSON text safe for an application/json script element; this is not a verification receipt. */
export function serializePreparedChart(prepared: PreparedChart | PreparedTable): string {
  return canonicalJson(prepared).replace(/[<>&\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export { parseChartSpec } from './parseChartSpec';
export type { ParsedChartSpec } from './parseChartSpec';
export { BoardplotSpecError } from '../core/doc/specError';
export type { PreparedChart, PreparedHeader, RenderGeometry } from './prepared';
export type { PreparedTable } from './preparedTable';
