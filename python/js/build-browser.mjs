/**
 * Builds the browser bundles of the Python package into python/src/boardplot/_assets/:
 *
 *   runtime.js  the full browser bundle (React, BoardplotChart, every chart type,
 *               the geo packs), the anywidget runtime widget's module
 *   widget.js   the chart widget's loader, a few KB
 *   streamlit/boardplot-<hash>.js
 *               the Streamlit Components v2 entry (full bundle). The content
 *               hash in the name lets browsers cache it; boardplot/pyproject.toml
 *               names the folder as the component's asset_dir, and Python
 *               finds the one file with the glob `boardplot-*.js` (build.mjs
 *               empties _assets/ first, so older builds are gone).
 *
 * All are ESM, minified, one file per entry, with no extra chunks and no source
 * maps. Each carries the build identity, so the loader can refuse a runtime from
 * another build.
 *
 * python/js/build.mjs calls `buildBrowser(identity)` with the identity it gives
 * the engine bundle, then writes build.json. The identity covers every source
 * under python/js/, so a change here needs the full build: `node python/js/build.mjs`.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
export const ASSETS = resolve(repo, 'python', 'src', 'boardplot', '_assets');

/** Size limits per entry: over the budget warns, over the hard limit fails. */
const ENTRY_BUDGET = 4.5 * 1024 * 1024;
const ENTRY_LIMIT = 6 * 1024 * 1024;

/** `hashed`: the file name gets the content hash. */
const ENTRIES = [
  { entry: join(here, 'browser', 'anywidget-runtime.ts'), out: 'runtime.js' },
  { entry: join(here, 'browser', 'anywidget-loader.ts'), out: 'widget.js' },
  { entry: join(here, 'browser', 'streamlit.ts'), out: 'streamlit/boardplot-[hash].js', hashed: true },
];

/**
 * @param {{ version: string, frontendProtocol: number } & Record<string, unknown>} identity
 * @returns {Promise<{ file: string, bytes: number, gzip: number, metafile: import('esbuild').Metafile }[]>}
 */
export async function buildBrowser(identity) {
  if (!identity || typeof identity.version !== 'string' || typeof identity.frontendProtocol !== 'number') {
    throw new Error('buildBrowser(identity): identity needs a version string and a frontendProtocol number.');
  }
  mkdirSync(ASSETS, { recursive: true });
  const results = [];
  for (const { entry, out, hashed } of ENTRIES) {
    const result = await build({
      absWorkingDir: repo,
      entryPoints: [entry],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      jsx: 'automatic',
      minify: true,
      splitting: false,
      sourcemap: false,
      legalComments: 'none',
      define: {
        'process.env.NODE_ENV': '"production"',
        __BOARDPLOT_IDENTITY__: JSON.stringify(identity),
      },
      write: false,
      metafile: true,
      logLevel: 'error',
    });
    if (result.outputFiles.length !== 1) throw new Error(`${out}: expected one output file, got ${result.outputFiles.length}.`);
    const bytes = result.outputFiles[0].contents;
    if (bytes.length > ENTRY_LIMIT) throw new Error(`${out} has ${bytes.length} bytes, over the hard limit of ${ENTRY_LIMIT}`);
    if (bytes.length > ENTRY_BUDGET) console.warn(`warning: ${out} has ${bytes.length} bytes, over the budget of ${ENTRY_BUDGET}`);
    const name = hashed ? out.replace('[hash]', createHash('sha256').update(bytes).digest('hex').slice(0, 16)) : out;
    const file = join(ASSETS, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    results.push({ file, bytes: bytes.length, gzip: gzipSync(bytes).length, metafile: result.metafile });
  }
  for (const { file, bytes, gzip } of results) {
    console.log(`${relative(repo, file)}  ${(bytes / 1024).toFixed(1)} KB raw, ${(gzip / 1024).toFixed(1)} KB gzip`);
  }
  return results;
}
