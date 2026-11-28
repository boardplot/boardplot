import { linkAnnotateEngine } from './core/annotateEngine';
import { linkWordKeys } from './core/schema/linkWordKeys';
import { registerCatalogue } from './core/charts';
import { linkThemeShapeRules } from './core/themeShapeRules';

// Called, not bare-imported: a host bundler keeps a call in this entry where it
// would drop a bare import of a shared chunk. This entry reads the catalogue,
// resolves patched themes and lays out annotations synchronously (see
// core/deferred).
registerCatalogue();
linkWordKeys();
linkThemeShapeRules();
linkAnnotateEngine();

import { getChartDefinition as registeredDefinition } from './core/registry';
import { linkSchemaDescriptions } from './core/schema/linkDescriptions';

export function getChartDefinition(typeOrAlias: string): ReturnType<typeof registeredDefinition> {
  linkSchemaDescriptions();
  return registeredDefinition(typeOrAlias);
}

export { listCharts } from './core/registry';
export { parseThemeJson } from './core/themeValidate';
export { validateTheme } from './core/themeRules';
