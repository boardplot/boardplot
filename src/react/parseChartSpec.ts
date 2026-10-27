import { referencedChartTypes } from '../core/doc/chartValidation';
import { knownChartType, loadChartTypes } from './loadChartTypes';
import { beginSpecParse, type ParsedChartSpec } from './specValidation';

export type { ParsedChartSpec, BoardplotSpecSettings } from './specValidation';
export { specSettings } from './specValidation';

/**
 * Parse and select without layout. `spec` is a bare chart or an envelope; an
 * envelope with several charts needs `chart`. The returned request can also be
 * passed to prepareChart.
 *
 * It loads the schemas of the types the spec names (the chart's own and, for
 * a grid, its panels') and no others, as `BoardplotChart` does
 * (src/react/spec.tsx).
 */
export async function parseChartSpec(spec: unknown, chart?: string): Promise<ParsedChartSpec> {
  const begun = beginSpecParse(spec, chart);
  await loadChartTypes(begun.types, { schemas: true, cores: false });
  return begun.finish();
}

/** The chart's own type and, for a grid, its panels' types: the cores a layout of this request reaches. */
export function requestChartTypes(type: string, data: unknown): string[] {
  return referencedChartTypes(type, data, knownChartType);
}

export { BoardplotSpecError } from '../core/doc/specError';
