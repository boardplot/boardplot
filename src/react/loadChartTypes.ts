/**
 * The schemas and cores of the chart types one call needs, on demand:
 * `react/export` and `react/prepare` await them before they parse and lay
 * out. All of them used to register every core when they loaded; now a
 * column export fetches the column core and nothing else. A type this graph
 * already holds (a static per-type import, an earlier call) loads nothing.
 * No zod. Importing `loadChartCores.ts` also installs the panel core loader
 * for a grid.
 */

import { getChart, getChartSchemas, registerChartSchemas } from '../core/registry';
import { registeredType } from './chartEntry';
import { chartTypeAliases, coreLoaders } from './coreLoaders';
import { schemaLoaders } from './schemaLoaders';
import { knownChartType } from './loadChartCores';

export { knownChartType };

/**
 * Registers the schemas (validation) and the cores (layout) of these types.
 * An unknown name loads nothing: validation or layout refuses it with its
 * own diagnostic, as before.
 */
export async function loadChartTypes(names: readonly string[], parts: { schemas: boolean; cores: boolean }): Promise<void> {
  const types = [...new Set(names.map(knownChartType).filter((type): type is string => type !== undefined))];
  await Promise.all(types.flatMap((type) => [
    parts.schemas && getChartSchemas(type) === undefined
      ? schemaLoaders[type]!().then((schemas) => { registerChartSchemas(schemas, chartTypeAliases[type]); })
      : undefined,
    parts.cores && getChart(type) === undefined
      ? coreLoaders[type]!().then((core) => { registeredType(core); })
      : undefined,
  ]));
}
