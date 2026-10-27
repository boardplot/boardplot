// Builds the hosted server: the view as one inline HTML file, the HTTP entry,
// and the render worker with the repository's own engine source bundled in.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { distributionIdentity } from '../scripts/build-identity.mjs';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const root = here('../');
mkdirSync(here('dist'), { recursive: true });

// 1. The view: script and style inline, no external resource.
const script = await build({
  entryPoints: [here('src/view/chart.ts')], bundle: true, minify: true, format: 'iife', platform: 'browser',
  target: 'es2022', write: false, legalComments: 'none',
});
const style = await build({ entryPoints: [here('src/view/chart.css')], bundle: true, minify: true, write: false, loader: { '.css': 'css' } });
const html = readFileSync(here('src/view/chart.html'), 'utf8')
  .replace('/*CSS*/', () => style.outputFiles[0].text.trim())
  .replace('/*JS*/', () => script.outputFiles[0].text.trim().replace(/<\/script/gi, '<\\/script'));
writeFileSync(here('dist/view.html'), html);
const gzip = gzipSync(html).length;
console.log(`view: ${html.length} bytes, ${gzip} bytes gzip (target 51200)`);

// 2. The server entry and the worker. The engine comes from ../src; one zod copy (the server's).
const identity = distributionIdentity(root);
const shared = {
  bundle: true, platform: 'node', format: 'esm', target: 'node22', legalComments: 'none',
  sourcesContent: false, minifySyntax: true,
  // Native and optional: resolved at run time from server/node_modules.
  external: ['@resvg/resvg-js', 'react', 'react-dom'],
  alias: { zod: here('node_modules/zod') },
  define: {
    __BOARDPLOT_BUILD_VERSION__: JSON.stringify(identity.version),
    __BOARDPLOT_ENGINE__: JSON.stringify(identity),
    __VIEW_HTML__: JSON.stringify(html),
  },
  banner: { js: "import { createRequire as __bpRequire } from 'node:module'; const require = __bpRequire(import.meta.url);" },
  logLevel: 'warning',
};
await build({ ...shared, entryPoints: { index: here('src/index.ts'), worker: here('src/worker.ts') }, outdir: here('dist'), outExtension: { '.js': '.mjs' } });
console.log(`server: dist/index.mjs, dist/worker.mjs (engine ${identity.version})`);
