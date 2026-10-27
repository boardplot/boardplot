/**
 * The schemas and cores of the chart types one call needs, on demand:
 * `react/export` and `react/prepare` await them before they parse and lay
 * out, and `react/grid` fetches its panels' cores through `core/deferred`.
 * All three used to register every core when they loaded; now a column
 * export fetches the column core and nothing else. A type this graph already
 * holds (a static per-type import, an earlier call) loads nothing. No zod:
 * the grid entry links this module.
 */

import { getChart, getChartSchemas, registerChartSchemas, type ChartCore } from '../core/registry';
import { registerChartCoreLoader } from '../core/deferred';
import { registeredType } from './chartEntry';
import { coreLoaders } from './coreLoaders';
import { chartTypeAliases, schemaLoaders } from './schemaLoaders';

/** alias -> the type it names, built once from the generated table. */
const aliasOwners = new Map<string, string>();
for (const [type, aliases] of Object.entries(chartTypeAliases)) {
  for (const alias of aliases) aliasOwners.set(alias, type);
}

/** The type a name stands for, or undefined for a name Boardplot does not draw. */
export function knownChartType(name: string): string | undefined {
  // Object.hasOwn, not `in`: a type called 'toString' would find Object.prototype's.
  return Object.hasOwn(coreLoaders, name) ? name : aliasOwners.get(name);
}

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

// Every graph that links this module can load cores, so it can also load the
// cores a grid's panels name, which `requireChartCores` fetches before the
// grid lays them out: a grid core registered by an export or a prepare call
// draws its panels as the grid entry's does.
registerChartCoreLoader({
  knows: (type) => knownChartType(type) !== undefined,
  load: (type) => loadChartTypes([type], { schemas: false, cores: true }),
});

/** The grid entry's registration: the grid core by value; this module's load installed its panel loader. */
export function registeredTypeWithPanelCores(core: ChartCore<any, any, any, any>): string {
  return registeredType(core);
}
