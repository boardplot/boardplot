// boardplot/theme — theme registration without a chart engine.

/**
 * A host that brings its own theme registers it before the first chart
 * draws. The package root exports `registerTheme` too, but the root
 * registers the whole catalogue (see src/index.ts), so importing it for one
 * function put every chart engine into the host's main bundle. This entry
 * links the theme store and the checks a patched theme goes through, and no
 * chart type: `scripts/package-smoke.mjs` holds it to that and to a byte
 * limit.
 *
 * It shares the registry with every other entry. tsup splits the modules
 * the entries have in common into shared chunks (tsup.config.ts), so a theme
 * registered here is the theme `boardplot/react/<type>` resolves by
 * name.
 */

import { linkThemeShapeRules } from './core/themeShapeRules';

// Links the checks `resolveTheme` runs over a patched theme, so this entry
// resolves `{ preset, overrides }` synchronously, as the root entry does
// (see core/deferred). A call, because a host bundler drops a bare import.
linkThemeShapeRules();

export { registerTheme, resolveTheme, typeForTarget } from './core/theme';
export type { Theme, ThemeRef } from './core/types/theme';

export type { RenderTarget } from './core/types/options';
