/**
 * Publishes the structural theme checks for `resolveTheme` (see
 * `core/deferred`). Linking this module links `core/themeShape` and makes
 * a patched theme resolve synchronously; the CLI, the MCP server,
 * `boardplot`, `boardplot/validate`, `boardplot/theme`,
 * `react/prepare` and `useChartLayout` all do. A per-type React entry does
 * not, and fetches this chunk when a caller actually patches a theme.
 *
 * It is a module of its own rather than a call inside `themeShape`: that
 * module is what the chunk carries, and a publisher inside it would have to
 * be imported to have run.
 *
 * An entry links it by calling `linkThemeShapeRules()` at module scope. A
 * bare import is not enough in the published package: the publish lands in a
 * shared `dist/chunk-*.js`, and a host bundler drops a bare import of a chunk
 * that package.json does not list as side-effectful. The call is a value
 * dependency no bundler drops, and the deferred loader calls it too.
 */

import { publishDeferred } from './deferred';
import { checkThemeShape, semanticErasureWarnings, unknownThemeKeyRepair } from './themeShape';

export function linkThemeShapeRules(): void {
  publishDeferred('theme-rules', { checkThemeShape, semanticErasureWarnings, unknownThemeKeyRepair });
}

linkThemeShapeRules();
