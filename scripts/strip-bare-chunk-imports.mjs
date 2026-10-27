import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * esbuild's code splitting writes `import "./chunk-XXXX.js";` into an entry
 * for every shared chunk the entry's code reaches, to fix their evaluation
 * order. A host bundler ignores such an import because package.json does not
 * list `dist/chunk-*.js` in `sideEffects` (listing it keeps the whole catalogue
 * in every host bundle), and esbuild warns `ignored-bare-import` once per
 * import: 136 warnings for `boardplot/react/table`.
 *
 * The package contract makes these imports dead weight: a shared chunk carries
 * no effect an entry needs, since registrations and publishes run through
 * calls (tsup.config.ts). Removing them gives Node the module graph a host
 * bundle already has. Each import becomes an empty line, so the line numbers
 * of `npm run build:debug` source maps still hold.
 *
 * A module that uses zod only in types (`import * as z from 'zod'` under
 * `verbatimModuleSyntax`) leaves `import "zod";` behind. zod's own
 * package.json marks its entry free of side effects, so it goes as well.
 */
const BARE_CHUNK_IMPORT = /^import "(?:(?:\.\.?\/)+chunk-[A-Z0-9]+\.js|zod)";$/gm;

export function stripBareChunkImports(directory) {
  let removed = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      removed += stripBareChunkImports(path);
      continue;
    }
    if (!entry.name.endsWith('.js')) continue;
    const source = readFileSync(path, 'utf8');
    const stripped = source.replace(BARE_CHUNK_IMPORT, () => {
      removed += 1;
      return '';
    });
    if (stripped !== source) writeFileSync(path, stripped);
  }
  return removed;
}
