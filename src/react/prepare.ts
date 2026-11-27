import type { ChartRequest, RequestInputOptions } from '../core/request';
import type { DataInput } from '../core/types/dataInput';
import type { LiveWindowOptions } from '../core/live/types';
import type { BoardplotThemeOptions } from './themeContext';
import type { ContainerSizeOptions } from './useContainerSize';
import type { RowsColumns, RowsProps } from './rowsInput';
import { canonicalJson } from './canonicalJson';
import type { PreparedChart } from './prepared';
import type { PreparedTable } from './preparedTable';

export type PrepareChartRequest<D = unknown, O extends object = RequestInputOptions> =
  (| (Omit<ChartRequest<DataInput<D>, O>, 'size'> & { rows?: undefined; columns?: undefined })
   | (Omit<ChartRequest<D, O>, 'size' | 'data'> & { data?: Partial<D>; rows: NonNullable<RowsProps['rows']>; columns: RowsColumns }))
  & ContainerSizeOptions & { window?: LiveWindowOptions };

type Planner = ReturnType<typeof import('./prepareEngine').linkedPlanner>;
let planner: Promise<Planner> | undefined;
let ready: Planner | undefined;
/** The planner, loaded once, at the first call: a page or server that only parses specs does not load layout. */
const loaded = () => planner ??= import('./prepareEngine').then((module) => ready = module.linkedPlanner(), (error: unknown) => { planner = undefined; throw error; });

/**
 * Prepare once on the server and pass this JSON value with the same React props.
 * It loads the cores of the chart's type and, for a grid, its panels' types, and no other.
 */
export async function prepareChart(input: PrepareChartRequest & { type: 'table' }, context?: BoardplotThemeOptions): Promise<PreparedTable>;
export async function prepareChart(input: PrepareChartRequest, context?: BoardplotThemeOptions): Promise<PreparedChart>;
export async function prepareChart(input: PrepareChartRequest, context?: BoardplotThemeOptions): Promise<PreparedChart | PreparedTable> {
  if (ready) return ready.prepareChart(input, context);
  // The first call reads the request as the planner would at the call, so a later change to it prepares nothing else.
  const own = { ...input }, theme = context && { ...context };
  return (await loaded()).prepareChart(own, theme);
}

/** @internal Host planner. Load only the requested types before synchronous size calculations. */
export async function loadChartPlanner(input: Pick<ChartRequest, 'type' | 'data'>) {
  return (await loaded()).loadChartPlanner(input);
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
