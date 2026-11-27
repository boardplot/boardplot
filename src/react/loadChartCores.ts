/**
 * The cores of the chart types a grid's panels name, on demand: `react/grid`
 * fetches them through `core/deferred`. No schemas: the grid entry and the
 * barrel link this module, and one `import()` of a schema here would add
 * every schema chunk to their builds, even where nothing calls it. The
 * schemas load through `loadChartTypes.ts`.
 */

import { getChart, type ChartCore } from '../core/registry';
import { registerChartCoreLoader } from '../core/deferred';
import { registeredType } from './chartEntry';
import { chartTypeAliases, coreLoaders } from './coreLoaders';
import { caseInsensitiveValue } from '../core/inputConversion';

/** alias -> the type it names, built once from the generated table. */
const aliasOwners = new Map<string, string>();
for (const [type, aliases] of Object.entries(chartTypeAliases)) {
  for (const alias of aliases) aliasOwners.set(alias, type);
}

/** The type a name stands for, or undefined for a name Boardplot does not draw. */
export function knownChartType(name: string): string | undefined {
  name = caseInsensitiveValue(name, [...Object.keys(coreLoaders), ...aliasOwners.keys()]) ?? name;
  // Object.hasOwn, not `in`: a type called 'toString' would find Object.prototype's.
  return Object.hasOwn(coreLoaders, name) ? name : aliasOwners.get(name);
}

// Every graph that links this module can load cores, so it can also load the
// cores a grid's panels name, which `requireChartCores` fetches before the
// grid lays them out: a grid core registered by an export or a prepare call
// draws its panels as the grid entry's does.
registerChartCoreLoader({
  knows: (type) => knownChartType(type) !== undefined,
  load: async (name) => {
    const type = knownChartType(name);
    if (type !== undefined && getChart(type) === undefined) registeredType(await coreLoaders[type]!());
  },
});

/** The grid entry's registration: the grid core by value; this module's load installed its panel loader. */
export function registeredTypeWithPanelCores(core: ChartCore<any, any, any, any>): string {
  return registeredType(core);
}
