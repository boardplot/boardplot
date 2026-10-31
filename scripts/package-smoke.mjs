#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function fail(message) {
  throw new Error(`package-smoke: ${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', ...(options.env ?? {}) },
    input: options.input,
    timeout: options.timeout,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 || result.signal || result.error) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    fail(
      `${command} ${args.join(' ')} failed (${result.error?.message ?? result.signal ?? `exit ${result.status}`})` +
        (detail ? `\n${detail}` : ''),
    );
  }
  return result.stdout ?? '';
}

export function parseArguments(argv) {
  let artifacts;
  let reactFrom;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if ((flag === '--artifacts' || flag === '--react-from') && value) {
      if (flag === '--artifacts') artifacts = resolve(value);
      else reactFrom = resolve(value);
      index += 1;
      continue;
    }
    fail(
      'usage: node scripts/package-smoke.mjs [--artifacts <empty-directory>] [--react-from <node_modules>]',
    );
  }
  return { artifacts, reactFrom };
}

export function reactPeerDirectories(reactFrom) {
  const from = reactFrom ?? join(ROOT, 'node_modules');
  return { from, react: join(from, 'react'), reactDom: join(from, 'react-dom') };
}

export function readInstalledVersion(packageRoot) {
  return JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version;
}

function assertFile(path) {
  if (!existsSync(path)) fail(`required artifact is missing: ${path}`);
}

function assertPackageTargets(packageRoot, packageManifest) {
  const pending = Object.entries(packageManifest.exports ?? {});
  let targetCount = 0;

  while (pending.length > 0) {
    const [label, value] = pending.pop();
    if (typeof value === 'string') {
      if (!value.startsWith('./')) fail(`export target must be package-relative: ${label} -> ${value}`);
      const targetPath = resolve(packageRoot, value);
      const relativeTarget = relative(packageRoot, targetPath);
      if (
        relativeTarget === '' ||
        relativeTarget === '..' ||
        relativeTarget.startsWith(`..${sep}`) ||
        isAbsolute(relativeTarget)
      ) {
        fail(`export target escapes the package: ${label} -> ${value}`);
      }
      assertFile(targetPath);
      targetCount += 1;
      continue;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      fail(`export target has an unsupported shape: ${label}`);
    }
    for (const [condition, nested] of Object.entries(value)) {
      pending.push([`${label}.${condition}`, nested]);
    }
  }

  if (targetCount === 0) fail('installed package declares no export targets');
  return targetCount;
}

/**
 * Webpack and Vite skip the body of an entry that package.json does not list
 * in `sideEffects` when the host uses only names the entry re-exports. A
 * module-scope call such as `linkThemeShapeRules()` then never runs, and
 * `resolveTheme` from `boardplot/theme` throws `DeferredCoreError` in a host
 * bundle while it works in Node. Node and esbuild always run an entry body, so
 * no other check here sees it.
 */
function assertCallingEntriesHaveSideEffects(packageRoot, packageManifest) {
  const listed = new Set(packageManifest.sideEffects ?? []);
  const missing = [];
  for (const target of Object.values(packageManifest.exports ?? {})) {
    const file = typeof target?.import === 'string' ? target.import.replace(/^\.\//, '') : undefined;
    if (!file?.endsWith('.js')) continue;
    const calls = readFileSync(join(packageRoot, file), 'utf8').match(/^[A-Za-z_$][\w$.]*\([^)]*\);?$/gm);
    if (calls && !listed.has(file)) missing.push(`${file} (${calls.join(' ')})`);
  }
  if (missing.length) fail(`package.json sideEffects must list each entry that makes a module-scope call: ${missing.join(', ')}`);
}

/** gzip -9 bytes of one byte stream. */
function gzipBytes(contents) {
  return gzipSync(contents, { level: 9 }).byteLength;
}

/**
 * Initial-load gzip bytes for one React entry, with React external and minified.
 * The first-chart check below also counts imports started at mount.
 */
function measureReactEntry(entry) {
  const common = {
    absWorkingDir: ROOT,
    entryPoints: [entry], bundle: true, format: 'esm', external: ['react', 'react-dom'],
    minify: true, write: false, logLevel: 'silent',
  };
  const split = buildSync({ ...common, splitting: true, outdir: '/react-entry', metafile: true });
  const contents = new Map(split.outputFiles.map((file) => [basename(file.path), file.contents]));
  const { outputs, loaded } = initialChunks(split.metafile, ROOT, entry);
  const initial = Buffer.concat([...loaded].map((key) => Buffer.from(contents.get(basename(key)))));
  const modules = new Set();
  for (const key of loaded) for (const module of Object.keys(outputs[key].inputs)) modules.add(module);
  return { initial: gzipBytes(initial), modules };
}

/**
 * The chunks a page has before it runs: the entry chunk plus everything it
 * reaches through `import` statements. esbuild marks every dynamic-import
 * chunk with an `entryPoint` too, so the entry is found by its path — taking
 * the first marked output picks a lazy chunk once an entry has several.
 */
function initialChunks(metafile, workingDirectory, entry) {
  const outputs = metafile.outputs;
  // The installed package sits under the OS temporary directory, which is a
  // symlink on macOS; esbuild reports the resolved path.
  const real = (path) => { try { return realpathSync(resolve(workingDirectory, path)); } catch { return resolve(workingDirectory, path); } };
  const wanted = real(entry);
  const entryKey = Object.keys(outputs).find((key) => outputs[key].entryPoint && real(outputs[key].entryPoint) === wanted);
  if (!entryKey) fail(`${entry} produced no entry chunk`);
  const loaded = new Set();
  const visit = (key) => {
    if (loaded.has(key)) return;
    loaded.add(key);
    for (const imported of outputs[key].imports) {
      if (imported.kind === 'import-statement' && outputs[imported.path]) visit(imported.path);
    }
  };
  visit(entryKey);
  return { outputs, loaded };
}

/**
 * Every installed React export must bundle for a browser, without a warning.
 * An entry imports its shared chunks bare (`import "../chunk-*.js"`); a chunk
 * that package.json does not list in `sideEffects` draws esbuild's
 * `ignored-bare-import` warning in the host's build, once per import.
 */
function checkReactBundles(packageRoot, manifest) {
  const entries = Object.entries(manifest.exports)
    .filter(([name]) => name === './react' || name.startsWith('./react/'))
    .map(([name, target]) => [name === './react' ? 'index' : name.slice('./react/'.length), join(packageRoot, target.import)])
    .sort(([left], [right]) => left.localeCompare(right));
  const { warnings } = buildSync({
    absWorkingDir: ROOT,
    entryPoints: entries.map(([, entry]) => entry),
    bundle: true, platform: 'browser', format: 'esm', splitting: true,
    outdir: '/react-entries', external: ['react', 'react-dom'],
    minify: true, write: false, logLevel: 'silent',
  });
  if (warnings.length) fail(`React entries bundle with ${warnings.length} esbuild warnings, first: ${warnings[0].id} ${warnings[0].text}`);
}

/**
 * Chart modules the shared validation chunk may reach without a chart engine
 * being linked there. The initial load of `react/spec` may link none.
 */
const SPEC_INITIAL_CHART_MODULES = new Set([
  'src/core/charts/creative/fatigue.ts',
  'src/core/charts/creative/layout.ts',
  'src/core/charts/grid/normalize.ts',
  'src/core/charts/line/nearZero.ts',
  'src/core/charts/sparkline/layout.ts',
  // The ring-tone refusal the sparkline layout raises: zod-free, one function.
  'src/core/charts/sparkline/refusals.ts',
]);

/**
 * The bytes a page fetches before it can draw its first chart of one type
 * through `react/spec`, gzip -9: the entry's initial load, the shared
 * validation chunk, that type's schema chunk, that type's engine chunk and
 * imports started at mount, each counted once.
 * The sizes are printed; no limit applies.
 */

/** The engine chunks that may carry map geometry: the two map types. A grid fetches a map panel's core. */
const GEO_ENGINES = new Set(['choropleth', 'tilemap']);

/** Trace imports during a cold client mount; measure the original, uninstrumented chunks. */
function mountImports(build, types) {
  const directory = mkdtempSync(join(tmpdir(), 'boardplot-mount-chunks-'));
  try {
    writeFileSync(join(directory, 'package.json'), '{"type":"module","private":true}');
    symlinkSync(join(ROOT, 'node_modules'), join(directory, 'node_modules'), 'junction');
    for (const file of build.outputFiles) {
      const code = file.text.replace(/import\("(\.\/[^"\n]+)"\)/g,
        (_, path) => `globalThis.trackImport(${JSON.stringify(basename(path))}, () => import(${JSON.stringify(path)}))`);
      writeFileSync(join(directory, basename(file.path)), code);
    }
    const probe = join(directory, 'mount.mjs');
    writeFileSync(probe, `
import { JSDOM } from 'jsdom';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { getFixtures } from ${JSON.stringify(join(ROOT, 'dist/fixtures.js'))};
const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document,
  Node: dom.window.Node, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const requested = new Set();
const pending = new Set();
globalThis.trackImport = (path, load) => {
  requested.add(path);
  const promise = load();
  pending.add(promise);
  promise.finally(() => pending.delete(promise));
  return promise;
};
const { BoardplotChart } = await import('./spec.js');
const type = process.argv[2];
const fixtures = getFixtures(type);
const fixture = fixtures.find(item => item.tags.includes('demo')) ?? fixtures[0];
if (!fixture) throw new Error('No mount fixture for ' + type);
const { annotations, story, ...options } = fixture.options ?? {};
const host = document.getElementById('root');
const root = createRoot(host);
try {
await act(async () => root.render(createElement(BoardplotChart, {
  spec: { type, data: fixture.data, options: { ...options, size: { width: 800, height: 450 } } },
})));
const deadline = Date.now() + 20000;
while (pending.size || host.querySelector('[data-bp-loading]')) {
  if (Date.now() > deadline) throw new Error('Mount did not settle: ' + type);
  await act(async () => { await Promise.all([...pending]); });
}
} catch (error) {
  // Map packs are separate host imports, outside the spec graph measured here.
  if (error.code !== 'geo-pack-not-registered') throw error;
}
// A map chart without its pack draws the refusal card with that code, for the same reason.
if (host.querySelector('[data-bp-spec-error]') && !host.querySelector('[data-bp-error-code="geo-pack-not-registered"]')) throw new Error(host.textContent);
await act(async () => root.unmount());
dom.window.close();
console.log(JSON.stringify([...requested]));
`);
    const outputs = new Map(Object.keys(build.metafile.outputs).map(key => [basename(key), key]));
    return new Map(types.map(type => {
      const requested = JSON.parse(run(process.execPath, [probe, type], { timeout: 30_000 }));
      return [type, requested.map(name => {
        const key = outputs.get(name);
        if (!key) fail(`mounted ${type} imported an unknown chunk: ${name}`);
        return key;
      })];
    }));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * What `react/spec` links, chunk by chunk: no chart engine before a spec
 * names its type, no schema chunk carrying its type's engine, and map
 * geometry only where a map is drawn. It reads the source entry rather than
 * the built one, because shipped chunks carry no module names.
 */
function checkSpecChunks(types) {
  const entry = join(ROOT, 'src/react/spec.tsx');
  const build = buildSync({
    absWorkingDir: ROOT, entryPoints: [entry], bundle: true, format: 'esm', splitting: true,
    outdir: '/react-entry', metafile: true, minify: true, write: false, logLevel: 'silent',
    external: ['react', 'react-dom', 'react/jsx-runtime'],
    define: { __BOARDPLOT_BUILD_VERSION__: '"0"' },
  });
  const outputs = build.metafile.outputs;
  const contents = new Map(build.outputFiles.map((file) => [basename(file.path), file.contents]));
  const real = (path) => { try { return realpathSync(resolve(ROOT, path)); } catch { return resolve(ROOT, path); } };
  // Every dynamic import is an output chunk of its own, marked with the module it loads.
  const byEntryPoint = new Map();
  for (const [key, output] of Object.entries(outputs)) {
    if (output.entryPoint) byEntryPoint.set(real(output.entryPoint), key);
  }
  const chunkFor = (source) => {
    const key = byEntryPoint.get(real(source));
    if (!key) fail(`${source} is not a chunk of the react/spec graph; the loader map no longer imports it`);
    return key;
  };
  /** One chunk plus everything it reaches through `import` statements. */
  const reach = (key) => {
    const seen = new Set();
    const visit = (current) => {
      if (seen.has(current)) return;
      seen.add(current);
      for (const imported of outputs[current].imports) {
        if (imported.kind === 'import-statement' && outputs[imported.path]) visit(imported.path);
      }
    };
    visit(key);
    return seen;
  };
  const without = (keys, ...counted) => new Set([...keys].filter((key) => !counted.some((set) => set.has(key))));
  const bytes = (keys) => gzipBytes(Buffer.concat([...keys].map((key) => Buffer.from(contents.get(basename(key))))));
  const modulesOf = (keys) => new Set([...keys].flatMap((key) => Object.keys(outputs[key].inputs)));
  const mounted = mountImports(build, types);

  const initial = reach(chunkFor('src/react/spec.tsx'));
  const validation = without(reach(chunkFor('src/react/specValidation.ts')), initial);
  const failures = [];

  const initialModules = modulesOf(initial);
  const linkedEarly = [...initialModules].filter((module) =>
    /(^|\/)node_modules\/zod\//.test(module) ||
    module.startsWith('src/core/geo/') ||
    // The accessible data table loads only for a spec that asks for it.
    module === 'src/react/hover/dataTable.tsx' ||
    /^src\/core\/charts\/[^/]+\//.test(module));
  if (linkedEarly.length > 0) {
    failures.push(`react/spec loads ${linkedEarly.length} module(s) it must not link before it draws: ${linkedEarly.sort().join(', ')}`);
  } else {
    console.log(`react/spec initial load: ${initialModules.size} modules, no chart engine, no zod, no map geometry`);
  }

  const validationModules = [...modulesOf(validation)].filter((module) =>
    module.startsWith('src/core/geo/') ||
    (/^src\/core\/charts\/[^/]+\//.test(module) && !SPEC_INITIAL_CHART_MODULES.has(module)));
  if (validationModules.length > 0) {
    failures.push(`the shared validation chunk carries ${validationModules.length} module(s) of a chart type or of the map geometry: ${validationModules.sort().join(', ')}`);
  } else {
    console.log(`shared validation chunk: ${modulesOf(validation).size} modules, no chart type, no map geometry`);
  }

  const lines = [`First chart through react/spec, gzip -9 bytes (initial ${bytes(initial)} + shared validation ${bytes(validation)} + schema + engine + mount imports):`];
  for (const type of types) {
    const schema = without(reach(chunkFor(`src/core/charts/${type}/schema.ts`)), initial, validation);
    const engine = without(reach(chunkFor(`src/react/charts/${type}.ts`)), initial, validation);
    const mount = without(new Set(mounted.get(type).flatMap(key => [...reach(key)])), initial, validation, schema, engine);
    const total = bytes(new Set([...initial, ...validation, ...schema, ...engine, ...mount]));
    lines.push(`  ${type}: ${bytes(schema)} schema + ${bytes(without(engine, schema))} engine; first chart ${total}`);
    const engineInSchema = [...modulesOf(schema)].filter((module) =>
      new RegExp(`^src/core/charts/${type}/(layout|marks|domain|core)\\.ts$`).test(module));
    if (engineInSchema.length > 0) {
      failures.push(`the ${type} schema chunk carries its engine: ${engineInSchema.sort().join(', ')}`);
    }
    const geo = [...modulesOf(engine)].filter((module) => module.startsWith('src/core/geo/'));
    if (geo.length > 0 && !GEO_ENGINES.has(type)) {
      failures.push(`the ${type} engine chunk carries map geometry: ${geo.sort().join(', ')}`);
    }
  }
  console.log(lines.join('\n'));
  return failures;
}

/**
 * Core modules a per-type React entry must NOT link before it draws. Each
 * one is fetched on demand through `src/core/deferred`, and each is here
 * because a bundler splits WHOLE modules: a single static import anywhere in
 * the graph puts the module back in the initial load, silently. This check
 * detects that import.
 *
 * Not listed: `src/core/fontMetrics/tables.generated.ts`. Text measurement
 * is synchronous inside layout and has no empty case, so every chart needs
 * the width tables before it can lay out; splitting them per family would
 * put every chart behind a readiness gate and end server rendering through
 * a per-type entry. All nine faces stay linked, deliberately.
 */
const DEFERRED_CORE_MODULES = new Map([
  ['src/core/themeShape.ts', 'the checks a patched theme goes through'],
  ['src/core/annotate.ts', 'the annotation placement engine'],
  ['src/core/eventLane.ts', 'the annotation placement engine'],
  ['src/core/annotateTargets.ts', 'the annotation placement engine'],
  ['src/core/annotateArms.ts', 'the annotation placement engine'],
  ['src/core/a11y/records.ts', 'the interaction records behind the hover card and the data table'],
  ['src/core/a11y/businessRecords.ts', 'the interaction records behind the hover card and the data table'],
  ['src/core/a11y/categoryRecords.ts', 'the interaction records behind the hover card and the data table'],
  ['src/core/a11y/statisticsRecords.ts', 'the interaction records behind the hover card and the data table'],
  ['src/core/a11y/structuralRecords.ts', 'the interaction records behind the hover card and the data table'],
]);

/**
 * The entries that link one of those modules on purpose, and what each may
 * link. Every entry here is a measured fact about the type's layout, stated
 * in scripts/generate-chart-entries.mjs beside the import it generates:
 *
 *   grid    resolves its panels through `getChart(panel.type)` at layout
 *           time, so its entry registers the whole catalogue — and a graph
 *           with the catalogue links what a CLI-shaped graph links.
 *   pareto  derives the cumulative threshold as a value line whenever
 *           `cumulative` is on, which is the default: the engine is work
 *           every pareto does.
 *   likert  patches the theme for its statement labels on every layout.
 *
 * Anything beyond this is an entry that stopped fetching on demand.
 */
const LINKED_BY_DESIGN = new Map([
  ['pareto', new Set(['src/core/annotate.ts', 'src/core/annotateTargets.ts', 'src/core/annotateArms.ts', 'src/core/eventLane.ts'])],
  ['likert', new Set(['src/core/themeShape.ts'])],
]);

/**
 * What each `src/react/charts/<type>.ts` links before it draws. It reads the
 * source entries rather than the shipped ones, because the packed chunks no
 * longer carry module names.
 */
function checkTypeEntryChunks(types) {
  const failures = [];
  let checked = 0;
  for (const type of types) {
    const allowed = LINKED_BY_DESIGN.get(type);
    const entry = join(ROOT, `src/react/charts/${type}.ts`);
    if (!existsSync(entry)) fail(`no source entry for react/${type}`);
    const build = buildSync({
      absWorkingDir: ROOT, entryPoints: [entry], bundle: true, format: 'esm', splitting: true,
      outdir: '/react-entry', metafile: true, minify: true, write: false, logLevel: 'silent',
      external: ['react', 'react-dom', 'react/jsx-runtime'],
      define: { __BOARDPLOT_BUILD_VERSION__: '"0"' },
    });
    const { outputs, loaded } = initialChunks(build.metafile, ROOT, entry);
    const linked = new Set();
    for (const key of loaded) for (const module of Object.keys(outputs[key].inputs)) linked.add(module);
    for (const [module, what] of DEFERRED_CORE_MODULES) {
      if (!linked.has(module) || allowed?.has(module)) continue;
      failures.push(`react/${type} links ${module} before it draws — ${what} loads on demand`);
    }
    checked += 1;
  }
  if (failures.length === 0) {
    console.log(
      `${checked} per-type React entries link none of the ${DEFERRED_CORE_MODULES.size} on-demand core modules before they draw, ` +
        `beyond what ${[...LINKED_BY_DESIGN.keys()].join(', ')} link by design`,
    );
  }
  return failures;
}

/**
 * The theme entry: its gzip size from the installed package, and what it
 * links from the source entry, whose chunks still carry module names. No
 * module of a chart type, no map geometry, no zod and no React.
 */
function checkThemeEntry(packageRoot) {
  const failures = [];
  console.log(`theme entry initial-load gzip -9 bytes: ${measureReactEntry(join(packageRoot, 'dist/theme.js')).initial}`);
  const entry = join(ROOT, 'src/theme.ts');
  const build = buildSync({
    absWorkingDir: ROOT, entryPoints: [entry], bundle: true, format: 'esm', splitting: true,
    outdir: '/theme-entry', metafile: true, minify: true, write: false, logLevel: 'silent',
    external: ['react', 'react-dom', 'react/jsx-runtime'],
    define: { __BOARDPLOT_BUILD_VERSION__: '"0"' },
  });
  const { outputs, loaded } = initialChunks(build.metafile, ROOT, entry);
  const linked = new Set();
  for (const key of loaded) for (const module of Object.keys(outputs[key].inputs)) linked.add(module);
  const engines = [...linked].filter((module) =>
    /^src\/core\/charts\//.test(module) || module.startsWith('src/core/geo/') || module.startsWith('src/react/') ||
    /(^|\/)node_modules\/zod\//.test(module));
  if (engines.length > 0) {
    failures.push(`boardplot/theme links ${engines.length} module(s) of a chart engine, the map geometry, React or zod: ${engines.sort().join(', ')}`);
  } else {
    console.log(`theme entry: ${linked.size} modules, no chart engine, no map geometry, no React, no zod`);
  }
  return failures;
}

/**
 * `boardplot/react/theme` beside one per-type chart. A host that wraps its
 * per-type charts in `BoardplotTheme` must not link the whole catalogue: the
 * pair links exactly one chart core, column's, and no core registry (the
 * barrel's loop). It reads the source entries, whose chunks still carry
 * module names. The installed pair also renders: a provider from this entry
 * reaches a chart from `boardplot/react/column`, so both share one context.
 */
function checkReactThemeEntry(installRoot, packageRoot) {
  const failures = [];
  const consumer = join(installRoot, 'react-theme-consumer.mjs');
  writeFileSync(consumer,
    `import { createElement } from 'react';\n` +
      `import { renderToStaticMarkup } from 'react-dom/server';\n` +
      `import { BoardplotTheme } from 'boardplot/react/theme';\n` +
      `import { ColumnChart } from 'boardplot/react/column';\n` +
      `const chart = createElement(ColumnChart, { data: { categories: ['A'], series: [{ id: 's', values: [1] }] }, size: 'dashboard' });\n` +
      `const plain = renderToStaticMarkup(chart);\n` +
      `const themed = renderToStaticMarkup(createElement(BoardplotTheme, { theme: 'notation' }, chart));\n` +
      `if (!themed.includes('<svg') || themed === plain) throw new Error('BoardplotTheme from boardplot/react/theme did not reach ColumnChart from boardplot/react/column');\n` +
      `console.log('BoardplotTheme from boardplot/react/theme themes ColumnChart from boardplot/react/column');\n`,
  );
  console.log(run(process.execPath, [consumer], { cwd: installRoot }).trim());

  const installed = join(installRoot, 'react-theme-pair.mjs');
  writeFileSync(installed, `export { BoardplotTheme } from 'boardplot/react/theme';\nexport { ColumnChart } from 'boardplot/react/column';\n`);
  const pair = measureReactEntry(installed).initial;
  const column = measureReactEntry(join(packageRoot, 'dist/react/column.js')).initial;
  console.log(`react/theme + react/column initial-load gzip -9 bytes: ${pair} (react/column alone: ${column})`);

  const entry = join(installRoot, 'react-theme-source-pair.mjs');
  writeFileSync(entry,
    `export { BoardplotTheme } from ${JSON.stringify(join(ROOT, 'src/react/theme.ts'))};\n` +
      `export { ColumnChart } from ${JSON.stringify(join(ROOT, 'src/react/charts/column.ts'))};\n`,
  );
  const build = buildSync({
    absWorkingDir: ROOT, entryPoints: [entry], bundle: true, format: 'esm', splitting: true,
    outdir: '/react-theme-entry', metafile: true, minify: true, write: false, logLevel: 'silent',
    external: ['react', 'react-dom', 'react/jsx-runtime'],
    define: { __BOARDPLOT_BUILD_VERSION__: '"0"' },
  });
  const { outputs, loaded } = initialChunks(build.metafile, ROOT, entry);
  const linked = new Set();
  for (const key of loaded) for (const module of Object.keys(outputs[key].inputs)) linked.add(module);
  const cores = [...linked].filter((module) => /^src\/core\/charts\/[^/]+\/core\.ts$/.test(module) || module === 'src/core/charts/cores.ts');
  if (cores.length !== 1 || cores[0] !== 'src/core/charts/column/core.ts') {
    failures.push(`boardplot/react/theme + boardplot/react/column link ${cores.length} chart core module(s), expected column's alone: ${cores.sort().join(', ')}`);
  } else {
    console.log(`react/theme + react/column: ${linked.size} modules, one chart core (column)`);
  }
  // The rows transform loads when a chart gets rows: a page without rows does not pay for it.
  const rowsModules = [...linked].filter((module) => module === 'src/core/rows.ts' || module === 'src/react/rowsModule.ts');
  if (rowsModules.length) failures.push(`boardplot/react/column links the rows transform before a chart gets rows: ${rowsModules.join(', ')}`);
  return failures;
}

/**
 * `react/export`, `react/prepare` and `react/grid` fetch the chart cores a
 * call names. Each used to register every core when it loaded (0.8 to 1.1 MB
 * gzip). Their initial load links no chart core and no core list, beyond
 * grid's own core. It reads the source entries, whose chunks still carry
 * module names. The sizes are printed; no limit applies.
 */
function checkLightEntries(packageRoot) {
  const failures = [];
  const entries = [
    ['react/export', 'src/react/export/index.ts', []],
    ['react/prepare', 'src/react/prepare.ts', []],
    ['react/grid', 'src/react/charts/grid.ts', ['src/core/charts/grid/core.ts']],
  ];
  for (const [name, source, allowed] of entries) {
    console.log(`${name} initial-load gzip -9 bytes: ${measureReactEntry(join(packageRoot, `dist/${name}.js`)).initial}`);
    const entry = join(ROOT, source);
    const build = buildSync({
      absWorkingDir: ROOT, entryPoints: [entry], bundle: true, format: 'esm', splitting: true,
      outdir: '/light-entry', metafile: true, minify: true, write: false, logLevel: 'silent',
      external: ['react', 'react-dom', 'react/jsx-runtime'],
      define: { __BOARDPLOT_BUILD_VERSION__: '"0"' },
    });
    const { outputs, loaded } = initialChunks(build.metafile, ROOT, entry);
    const linked = new Set();
    for (const key of loaded) for (const module of Object.keys(outputs[key].inputs)) linked.add(module);
    const cores = [...linked].filter((module) =>
      (/^src\/core\/charts\/[^/]+\/core\.ts$/.test(module) || module === 'src/core/charts/cores.ts' || module === 'src/core/charts/index.ts') &&
      !allowed.includes(module));
    if (cores.length > 0) failures.push(`boardplot/${name} links ${cores.length} chart core module(s) before its first call: ${cores.sort().join(', ')}`);
    else console.log(`${name}: ${linked.size} modules, no chart core beyond its own`);
  }
  return failures;
}

/**
 * The fonts entry: what it links from the source entry. It may link zod (the
 * table parser) and the bundled preset tables, but no chart engine, no map
 * geometry and no React, so a host that only builds a measurer does not pay
 * for the catalogue the root entry registers.
 */
function checkFontsEntry() {
  const entry = join(ROOT, 'src/fonts.ts');
  const build = buildSync({
    absWorkingDir: ROOT, entryPoints: [entry], bundle: true, format: 'esm', splitting: true,
    outdir: '/fonts-entry', metafile: true, minify: true, write: false, logLevel: 'silent',
    external: ['react', 'react-dom', 'react/jsx-runtime'],
    define: { __BOARDPLOT_BUILD_VERSION__: '"0"' },
  });
  const { outputs, loaded } = initialChunks(build.metafile, ROOT, entry);
  const linked = new Set();
  for (const key of loaded) for (const module of Object.keys(outputs[key].inputs)) linked.add(module);
  const engines = [...linked].filter((module) =>
    /^src\/core\/charts\//.test(module) || module.startsWith('src/core/geo/') || module.startsWith('src/react/'));
  if (engines.length > 0) {
    return [`boardplot/fonts links ${engines.length} module(s) of a chart engine, the map geometry or React: ${engines.sort().join(', ')}`];
  }
  console.log(`fonts entry: ${linked.size} modules, no chart engine, no map geometry, no React`);
  return [];
}

/**
 * The rows entry: the same data and refusal in Node and in a Vite browser
 * build of the installed package, its gzip size beside `react/spec`, and
 * what it links from the source entry: no chart engine, no tile or map
 * geometry, no zod and no React.
 */
function checkRowsEntry(installRoot, packageRoot) {
  const consumer = join(installRoot, 'rows-consumer.mjs');
  writeFileSync(consumer,
    `import { InputError, specFromRows } from 'boardplot/rows';\n` +
    `const columns = { category: 'week', series: 'channel', value: 'revenue' };\n` +
    `const { spec, reading } = specFromRows({ type: 'line' }, { rows: [{ week: 'W1', channel: 'Search', revenue: 10 }, { week: 'W2', channel: 'Search', revenue: 12 }], columns });\n` +
    `let refused;\n` +
    `try { specFromRows({ type: 'line' }, { rows: [{ week: 'W1', channel: 'Search', revenue: 'ten' }], columns }); } catch (error) { refused = error instanceof InputError && error.details.path; }\n` +
    `console.log(JSON.stringify({ data: spec.data, rows: reading.rows, refused }));\n`);
  const direct = run(process.execPath, [consumer], { cwd: installRoot });
  if (!direct.includes('"refused":"/rows/0/revenue"')) fail(`boardplot/rows in Node returned ${direct.trim()}`);
  const viteBuild = join(installRoot, 'rows-vite.mjs');
  writeFileSync(viteBuild,
    `import { build } from ${JSON.stringify(import.meta.resolve('vite'))};\n` +
    `await build({ root: ${JSON.stringify(installRoot)}, configFile: false, logLevel: 'silent', build: { outDir: 'rows-vite', emptyOutDir: true, minify: false, ` +
    `lib: { entry: ${JSON.stringify(consumer)}, formats: ['es'], fileName: () => 'rows.mjs' } } });\n`);
  run(process.execPath, [viteBuild], { cwd: installRoot });
  if (run(process.execPath, [join(installRoot, 'rows-vite/rows.mjs')], { cwd: installRoot }) !== direct) fail('the Vite browser build of boardplot/rows returned other data than Node');
  console.log(`rows entry initial-load gzip -9 bytes: ${measureReactEntry(join(packageRoot, 'dist/rows.js')).initial} ` +
    `(react/spec: ${measureReactEntry(join(packageRoot, 'dist/react/spec.js')).initial}); Vite browser build and Node agree`);
  const entry = join(ROOT, 'src/rows.ts');
  const build = buildSync({
    absWorkingDir: ROOT, entryPoints: [entry], bundle: true, format: 'esm', splitting: true,
    outdir: '/rows-entry', metafile: true, minify: true, write: false, logLevel: 'silent',
  });
  const { outputs, loaded } = initialChunks(build.metafile, ROOT, entry);
  const linked = new Set();
  for (const key of loaded) for (const module of Object.keys(outputs[key].inputs)) linked.add(module);
  const heavy = [...linked].filter((module) => /^src\/core\/charts\//.test(module) || module.startsWith('src/react/') ||
    module.endsWith('.generated.ts') || /(^|\/)node_modules\//.test(module));
  if (heavy.length > 0) return [`boardplot/rows links ${heavy.length} module(s) of a chart engine, the map geometry, React or zod: ${heavy.sort().join(', ')}`];
  console.log(`rows entry: ${linked.size} modules, no chart engine, no map geometry, no React, no zod`);
  return [];
}

/**
 * A Vite production build of a per-type entry draws the three charts that
 * fetch a chunk: one with rows, one with an annotation, one with a patched
 * theme. Rolldown drops a chunk body whose only effect is a module-scope
 * call when `sideEffects` does not list it, and a chart then stays on the
 * busy placeholder (0.52.5: rows never drew). Node and esbuild run every
 * chunk body, so no other check here sees it.
 */
function checkViteDeferredChunks(installRoot) {
  const consumer = join(installRoot, 'vite-deferred-consumer.mjs');
  writeFileSync(consumer,
    `import { createElement } from 'react';\n` +
    `import { LineChart } from 'boardplot/react/line';\n` +
    `const data = { categories: ['2022', '2023', '2024'], series: [{ id: 'revenue', name: 'Revenue', values: [10, 12, 15] }] };\n` +
    `export const charts = {\n` +
    `  rows: createElement(LineChart, { rows: [{ year: '2022', channel: 'Search', revenue: 10 }, { year: '2023', channel: 'Search', revenue: 12 }], columns: { category: 'year', series: 'channel', value: 'revenue' } }),\n` +
    `  annotate: createElement(LineChart, { data, annotations: [{ kind: 'cagr' }] }),\n` +
    `  'theme-rules': createElement(LineChart, { data, theme: { preset: 'boardroom', overrides: { color: { ink: '#1A2B3C' } } } }),\n` +
    `};\n` +
    `export { createRoot } from 'react-dom/client';\n`);
  const viteBuild = join(installRoot, 'deferred-vite.mjs');
  writeFileSync(viteBuild,
    `import { build } from ${JSON.stringify(import.meta.resolve('vite'))};\n` +
    `await build({ root: ${JSON.stringify(installRoot)}, configFile: false, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"production"' }, ` +
    `build: { outDir: 'deferred-vite', emptyOutDir: true, minify: false, lib: { entry: ${JSON.stringify(consumer)}, formats: ['es'], fileName: () => 'app.mjs' } } });\n`);
  run(process.execPath, [viteBuild], { cwd: installRoot });
  const probe = join(installRoot, 'deferred-vite-mount.mjs');
  writeFileSync(probe,
    `import { JSDOM } from ${JSON.stringify(import.meta.resolve('jsdom'))};\n` +
    `const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });\n` +
    `Object.assign(globalThis, { window: dom.window, document: dom.window.document, Node: dom.window.Node, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement });\n` +
    `const { charts, createRoot } = await import('./deferred-vite/app.mjs');\n` +
    `const stuck = [];\n` +
    `for (const [name, chart] of Object.entries(charts)) {\n` +
    `  const host = document.body.appendChild(document.createElement('div'));\n` +
    `  createRoot(host).render(chart);\n` +
    `  const deadline = Date.now() + 10000;\n` +
    `  while (!host.querySelector('svg') || host.querySelector('[data-bp-loading]')) {\n` +
    `    const card = host.querySelector('[data-bp-load-failed], [data-bp-spec-error], [data-bp-refused]');\n` +
    `    if (card || Date.now() > deadline) { stuck.push(name + (card ? ' (error card)' : ' (busy placeholder after 10 s)')); break; }\n` +
    `    await new Promise((resolve) => setTimeout(resolve, 20));\n` +
    `  }\n` +
    `}\n` +
    `process.stdout.write(JSON.stringify(stuck), () => process.exit(0));\n`);
  const stuck = JSON.parse(run(process.execPath, [probe], { cwd: installRoot, timeout: 60_000 }));
  if (stuck.length) return [`a Vite production build of boardplot/react/line does not draw the chart that fetches: ${stuck.join(', ')}`];
  console.log('Vite production build of boardplot/react/line draws charts with rows, an annotation and a patched theme');
  return [];
}

/**
 * A theme registered through `boardplot/theme` is the theme a per-type
 * entry resolves by name: both entries read one registry, the shared chunk
 * tsup splits out. The brand background proves the chart drew with it.
 */
function assertThemeRegistry(installRoot) {
  const consumer = join(installRoot, 'theme-consumer.mjs');
  writeFileSync(
    consumer,
    `import { createElement } from 'react';\n` +
      `import { renderToStaticMarkup } from 'react-dom/server';\n` +
      `import { registerTheme, resolveTheme } from 'boardplot/theme';\n` +
      `import { ColumnChart } from 'boardplot/react/column';\n` +
      `const brand = { ...resolveTheme('boardroom'), name: 'smoke-brand' };\n` +
      `brand.color = { ...brand.color, background: '#FDF6E3' };\n` +
      `registerTheme(brand);\n` +
      `if (resolveTheme('smoke-brand').color.background !== '#FDF6E3') throw new Error('theme entry did not register the theme');\n` +
      `if (resolveTheme({ preset: 'smoke-brand', overrides: { color: { highlight: '#0B5CAD' } } }).color.highlight !== '#0B5CAD') throw new Error('theme entry did not resolve a patched theme');\n` +
      `const html = renderToStaticMarkup(createElement(ColumnChart, {\n` +
      `  data: { categories: ['A'], series: [{ id: 's', values: [1] }] },\n` +
      `  size: 'dashboard', theme: 'smoke-brand',\n` +
      `}));\n` +
      `if (!html.includes('<svg') || !html.toUpperCase().includes('#FDF6E3')) throw new Error('react/column did not draw with the theme registered through boardplot/theme');\n` +
      `console.log('boardplot/theme registers a theme that react/column draws with');\n`,
  );
  console.log(run(process.execPath, [consumer], { cwd: installRoot }).trim());
}

/** A CommonJS host's require('boardplot') failed with ERR_PACKAGE_PATH_NOT_EXPORTED while the exports named only `import`. */
function assertRequire(installRoot) {
  const consumer = join(installRoot, 'require-consumer.cjs');
  writeFileSync(
    consumer,
    `const { renderSvg } = require('boardplot');\n` +
      `const { resolveTheme } = require('boardplot/theme');\n` +
      `if (typeof renderSvg !== 'function' || resolveTheme('boardroom').color.background !== '#FFFFFF') throw new Error('require did not load the ES module entries');\n` +
      `console.log('require() loads boardplot and boardplot/theme from CommonJS');\n`,
  );
  console.log(run(process.execPath, [consumer], { cwd: installRoot }).trim());
}

/** Chart types with a `./react/<type>` subpath: every React subpath except the named utility entries. */
function listReactTypes(manifest) {
  const utilities = new Set(['index', 'spec', 'prepare', 'export', 'report', 'story', 'theme', 'print', 'live', 'hybrid', 'annotation-edit', 'scale-group']);
  return Object.keys(manifest.exports)
    .filter((name) => name.startsWith('./react/'))
    .map((name) => name.slice('./react/'.length))
    .filter((name) => !utilities.has(name));
}

function jsonOutput(command, args, options) {
  const output = run(command, args, options);
  try {
    return JSON.parse(output);
  } catch {
    fail(`${args.join(' ')} did not return JSON:\n${output}`);
  }
}

function packOutput(output) {
  const lines = output.split(/\r?\n/);
  let jsonStart = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim() === '[') {
      jsonStart = index;
      break;
    }
  }
  if (jsonStart < 0) fail(`npm pack returned no JSON array:\n${output}`);
  try {
    return JSON.parse(lines.slice(jsonStart).join('\n'));
  } catch {
    fail(`npm pack returned malformed JSON:\n${output}`);
  }
}

function checkFixtureImports(installRoot, chartTypes, example) {
  const consumer = join(installRoot, 'fixtures-consumer.mjs');
  writeFileSync(consumer,
    `import { getFixtures, allFixtures } from 'boardplot/fixtures';\n` +
    `const types = ${JSON.stringify(chartTypes)};\n` +
    `const catalogue = allFixtures();\n` +
    `if (types.some(type => getFixtures(type).length === 0)) throw new Error('fixture family missing');\n` +
    `if (catalogue.length !== types.reduce((n, type) => n + getFixtures(type).length, 0)) throw new Error('fixture catalogue mismatch');\n` +
    `if (getFixtures('unknown-type').length) throw new Error('unexpected fixture registration');\n` +
    `const example = getFixtures('waterfall').find(f => f.id === ${JSON.stringify(example.name)});\n` +
    `if (JSON.stringify(example?.data) !== ${JSON.stringify(JSON.stringify(example.data))}) throw new Error('fixture differs from CLI');\n` +
    `console.log(JSON.stringify(catalogue.map(f => f.id)));\n`,
  );
  const direct = run(process.execPath, [consumer], { cwd: installRoot });
  const bundled = join(installRoot, 'fixtures-bundled.mjs');
  buildSync({ entryPoints: [consumer], bundle: true, platform: 'browser', format: 'esm', outfile: bundled, logLevel: 'silent' });
  if (run(process.execPath, [bundled], { cwd: installRoot }) !== direct) fail('browser bundling dropped fixture registrations');
  for (const entry of ['dist/index.js', 'dist/react/waterfall.js']) {
    const result = buildSync({
      entryPoints: [join(installRoot, 'node_modules/boardplot', entry)],
      bundle: true, format: 'esm', external: ['react', 'react-dom'], write: false, logLevel: 'silent',
    });
    if (result.outputFiles[0].text.includes(JSON.stringify(example.name))) fail(`${entry} imports optional fixture data`);
  }
}

function invokedAsMain() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

/** Copies packages and their dependencies into the consumer's node_modules. */
function copyPackageClosure(installRoot, packages) {
  const pending = [...packages];
  const copied = new Set();
  for (const [name, packageRoot] of pending) {
    if (copied.has(name)) continue;
    copied.add(name);
    assertFile(join(packageRoot, 'package.json'));
    cpSync(packageRoot, join(installRoot, 'node_modules', name), { recursive: true });
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    const requirePeer = createRequire(join(packageRoot, 'package.json'));
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      pending.push([dependency, dirname(requirePeer.resolve(`${dependency}/package.json`))]);
    }
  }
}

function copyReactPeers(installRoot, reactFrom) {
  const peers = reactPeerDirectories(reactFrom);
  copyPackageClosure(installRoot, [['react', peers.react], ['react-dom', peers.reactDom]]);
  const reactVersion = readInstalledVersion(peers.react);
  const reactDomVersion = readInstalledVersion(peers.reactDom);
  if (reactVersion.split('.')[0] !== reactDomVersion.split('.')[0]) {
    fail(`react ${reactVersion} and react-dom ${reactDomVersion} majors differ`);
  }
  console.log(`React peers for package smoke: react=${reactVersion} react-dom=${reactDomVersion} from ${peers.from}`);
  return reactVersion;
}

/**
 * Typechecks a TypeScript consumer of the installed package under
 * `moduleResolution: nodenext`, the strictest resolution a consumer can use:
 * every relative import inside the shipped declarations must name its `.js`
 * file. skipLibCheck is off, so a declaration that resolves to nothing fails
 * here instead of turning into `any` in the consumer.
 */
function assertConsumerTypes(installRoot) {
  copyPackageClosure(installRoot, [['@types/react', join(ROOT, 'node_modules', '@types', 'react')]]);
  const consumerRoot = join(installRoot, 'types-consumer');
  mkdirSync(consumerRoot, { recursive: true });
  writeFileSync(join(consumerRoot, 'package.json'), `${JSON.stringify({ type: 'module', private: true })}\n`);
  writeFileSync(join(consumerRoot, 'tsconfig.json'), `${JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', lib: ['ES2022', 'DOM'],
      jsx: 'react-jsx', strict: true, noEmit: true, skipLibCheck: false, types: [],
    },
    files: ['consumer.tsx'],
  }, null, 2)}\n`);
  writeFileSync(join(consumerRoot, 'consumer.tsx'), [
    "import { listCharts, renderSvg } from 'boardplot';",
    "import type { CellTone, ColumnKind, RowRole, TableCell, TableCellEncoding, TableCellObject, TableColumn, TableVariant, TableRow } from 'boardplot';",
    "import { getChartDefinition } from 'boardplot/validate';",
    "import { BoardplotChart } from 'boardplot/react/spec';",
    "import { parseChartSpec } from 'boardplot/react/prepare';",
    "import { WaterfallChart } from 'boardplot/react/waterfall';",
    '',
    "export const types: string[] = listCharts().map((chart) => chart.type);",
    "const tableCell: TableCellObject = { v: 1, tone: 'warn' satisfies CellTone };",
    "export const tableColumn: TableColumn = { id: 'v', kind: 'value' satisfies ColumnKind };",
    "export const tableRow: TableRow = { id: 'r', role: 'data' satisfies RowRole, cells: { v: tableCell satisfies TableCell } };",
    "export const tableVariant: TableVariant = 'status';",
    "export const tableEncoding: TableCellEncoding = 'heat';",
    'export const render: typeof renderSvg = renderSvg;',
    "export const definition = getChartDefinition('waterfall');",
    "export const parsed = parseChartSpec({ type: 'column', data: { categories: ['A'], series: [{ id: 's', values: [1] }] } });",
    "export const spec = <BoardplotChart spec={{ type: 'column' }} size=\"dashboard\" />;",
    "export const waterfall = <WaterfallChart data={{ items: [{ id: 'a', value: 1 }] }} size=\"dashboard\" />;",
    '// @ts-expect-error data is required; this line fails if the props decay to any.',
    'export const missingData = <WaterfallChart size="dashboard" />;',
    '// @ts-expect-error getChartDefinition takes a type name.',
    'getChartDefinition(42);',
    '',
  ].join('\n'));
  run(process.execPath, [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', consumerRoot], { cwd: consumerRoot });
  console.log('TypeScript consumer (NodeNext) typechecks boardplot, /validate, /react/spec, /react/waterfall');
}

function assertReactSsr(installRoot) {
  const consumer = join(installRoot, 'react-ssr-consumer.mjs');
  writeFileSync(
    consumer,
    `import { createElement } from 'react';\n` +
      `import { renderToStaticMarkup } from 'react-dom/server';\n` +
      `import { ColumnChart } from 'boardplot/react/column';\n` +
      `const html = renderToStaticMarkup(createElement(ColumnChart, {\n` +
      `  data: { categories: ['A'], series: [{ id: 's', values: [1] }] },\n` +
      `  size: 'dashboard',\n` +
      `}));\n` +
      `if (!html.includes('<svg') || !html.includes('data-bp-engine=')) {\n` +
      `  throw new Error('React SSR did not emit a chart svg');\n` +
      `}\n` +
      `console.log('React SSR emitted chart svg');\n`,
  );
  run(process.execPath, [consumer], { cwd: installRoot });
  const hydration = join(installRoot, 'react-hydration-consumer.mjs');
  writeFileSync(hydration, `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as React from 'react';
import { act as legacyAct } from 'react-dom/test-utils';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { TableChart } from 'boardplot/react/table';
const { JSDOM } = createRequire(${JSON.stringify(import.meta.url)})('jsdom');
const { createElement } = React;
const act = React.act ?? legacyAct;
const chart = createElement(TableChart, {
  data: { columns: [{ id: 'label', kind: 'rowLabel', label: 'Measure' }, { id: 'v', kind: 'value', label: 'Value' }],
    rows: [{ id: 'r', label: 'Output', cells: { v: 12 } }] },
  hover: { card: 'sparkline', highlight: true }, styleNonce: 'hydration-nonce',
});
const dom = new JSDOM('<!doctype html><div id="root">' + renderToString(chart) + '</div>', { pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document,
  Node: dom.window.Node, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const host = document.getElementById('root');
const table = host.querySelector('.bp-table-grid');
const cell = host.querySelector('[data-bp-row="r"][data-bp-column="v"]');
const style = host.querySelector('.bp-hover-table > style');
assert.ok(table && cell && style);
const errors = [];
let root;
try {
  await act(async () => { root = hydrateRoot(host, chart, { onRecoverableError: error => errors.push(error.message) }); });
  assert.deepEqual(errors, []);
  assert.equal(host.querySelector('.bp-table-grid'), table);
  assert.equal(host.querySelector('[data-bp-row="r"][data-bp-column="v"]'), cell);
  assert.equal(host.querySelector('.bp-hover-table > style'), style);
  assert.equal(style.nonce, 'hydration-nonce');
  assert.ok(style.textContent.includes('[data-bp-active-row]>*'));
  assert.ok(style.sheet.cssRules[0].selectorText.includes('"'));
} finally {
  if (root) await act(async () => root.unmount());
  dom.window.close();
}
console.log('React table hydration preserves the original table, cell and hover stylesheet');
`);
  console.log(run(process.execPath, [hydration], { cwd: installRoot }).trim());
}

if (invokedAsMain()) {
const args = parseArguments(process.argv.slice(2));
const scratch = mkdtempSync(join(tmpdir(), 'boardplot-package-smoke-'));
const artifacts = args.artifacts ?? mkdtempSync(join(tmpdir(), 'boardplot-release-'));
const removeArtifacts = args.artifacts === undefined;

try {
  if (args.artifacts) {
    if (existsSync(artifacts) && readdirSync(artifacts).length > 0) {
      fail(`--artifacts directory must be empty: ${artifacts}`);
    }
    mkdirSync(artifacts, { recursive: true });
  }

  const packResult = packOutput(
    run(NPM, ['pack', '--json', '--silent', '--pack-destination', artifacts]),
  );
  if (!Array.isArray(packResult) || packResult.length !== 1 || !packResult[0]?.filename) {
    fail('npm pack returned no single package filename');
  }
  const tarball = join(artifacts, basename(packResult[0].filename));
  assertFile(tarball);
  const maps = (packResult[0].files ?? []).filter((file) => file.path.endsWith('.map'));
  if (maps.length > 0) fail(`the package ships ${maps.length} source maps, e.g. ${maps[0].path}`);

  const installRoot = join(scratch, 'install');
  mkdirSync(installRoot, { recursive: true });
  writeFileSync(
    join(installRoot, 'package.json'),
    `${JSON.stringify({ name: 'boardplot-package-smoke', private: true }, null, 2)}\n`,
  );
  run(
    NPM,
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball],
    { cwd: installRoot },
  );

  const installedPackageRoot = join(installRoot, 'node_modules', 'boardplot');
  const installedManifest = JSON.parse(
    readFileSync(join(installedPackageRoot, 'package.json'), 'utf8'),
  );
  const exportTargetCount = assertPackageTargets(installedPackageRoot, installedManifest);
  assertCallingEntriesHaveSideEffects(installedPackageRoot, installedManifest);

  const binDirectory = join(installRoot, 'node_modules', '.bin');
  const boardplot = join(binDirectory, process.platform === 'win32' ? 'boardplot.cmd' : 'boardplot');
  const boardplotMcp = join(binDirectory, process.platform === 'win32' ? 'boardplot-mcp.cmd' : 'boardplot-mcp');
  assertFile(boardplot);
  assertFile(boardplotMcp);
  const binNames = Object.keys(installedManifest.bin ?? {}).sort().join(', ');
  if (binNames !== 'boardplot, boardplot-mcp') fail(`installed package declares bins ${binNames}, expected boardplot, boardplot-mcp`);

  const help = run(boardplot, ['--help'], { cwd: installRoot });
  if (!help.includes('boardplot list') || !help.includes('boardplot render')) {
    fail('installed CLI help is incomplete');
  }

  const buildIdentity = JSON.parse(readFileSync(join(installedPackageRoot, 'dist/build-identity.json'), 'utf8'));
  const cliVersion = run(boardplot, ['--version'], { cwd: installRoot }).trim();
  if (cliVersion !== buildIdentity.version || !buildIdentity.version.startsWith(`${installedManifest.version}-engine.`)) {
    fail('installed package, build identity and CLI versions differ');
  }

  const listing = jsonOutput(boardplot, ['list'], { cwd: installRoot });
  if (listing.engineRev !== buildIdentity.engineRev) fail('installed engine revision differs');
  if (listing.ok !== true || !Array.isArray(listing.types) || listing.types.length === 0) {
    fail('installed CLI returned an empty chart catalogue');
  }

  const coreConsumer = join(installRoot, 'core-consumer.mjs');
  writeFileSync(
    coreConsumer,
    `import { listCharts } from 'boardplot';\n` +
      `const charts = listCharts();\n` +
      `if (charts.length !== ${listing.types.length}) throw new Error('core chart catalogue mismatch');\n`,
  );
  run(process.execPath, [coreConsumer], { cwd: installRoot });

  const validateConsumer = join(installRoot, 'validate-consumer.mjs');
  writeFileSync(
    validateConsumer,
    `import { getChartDefinition, listCharts, parseThemeJson } from 'boardplot/validate';\n` +
      `import { resolveTheme } from 'boardplot';\n` +
      `const definition = getChartDefinition('waterfall');\n` +
      `if (!definition?.normalize) throw new Error('waterfall schema registration is missing');\n` +
      `if (listCharts().length !== ${listing.types.length}) throw new Error('validate chart catalogue mismatch');\n` +
      `if (parseThemeJson(resolveTheme('boardroom')).theme.name !== 'boardroom') throw new Error('theme parser is missing');\n`,
  );
  run(process.execPath, [validateConsumer], { cwd: installRoot });

  const reactVersion = copyReactPeers(installRoot, args.reactFrom);
  for (const [name, entry] of Object.entries(installedManifest.exports)) {
    if (name !== './react' && !name.startsWith('./react/')) continue;
    const client = /^\s*["']use client["'];/.test(readFileSync(join(installedPackageRoot, entry.import), 'utf8'));
    if (client !== (name !== './react/prepare')) fail(`incorrect server/client boundary for ${name}`);
  }
  const serverConsumer = join(installRoot, 'server-consumer.mjs');
  writeFileSync(serverConsumer,
    `import { parseChartSpec, prepareChart, serializePreparedChart, BoardplotSpecError } from 'boardplot/react/prepare';\n` +
    `try { await parseChartSpec({}); throw new Error('invalid spec accepted'); } catch (error) { if (!(error instanceof BoardplotSpecError) || error.errors !== error.envelopeErrors) throw error; }\n` +
    `const parsed = await parseChartSpec({version:1,charts:[{name:'orders',type:'column',data:{categories:['A'],series:[{id:'s',values:[1]}]}}]});\n` +
    `if (JSON.parse(serializePreparedChart(await prepareChart(parsed.request))).kind !== 'svg') throw new Error('server preparation failed');\n`);
  run(process.execPath, ['--conditions=react-server', serverConsumer], { cwd: installRoot });
  const reactConsumer = join(installRoot, 'react-consumer.mjs');
  writeFileSync(
    reactConsumer,
    `import { WaterfallChart } from 'boardplot/react/waterfall';\n` +
      `import { prepareChart } from 'boardplot/react/prepare';\n` +
      `import { BoardplotChart } from 'boardplot/react/spec';\n` +
      `import { parseChartSpec, BoardplotSpecError } from 'boardplot/react/prepare';\n` +
      `try { await parseChartSpec({}); throw new Error('invalid spec accepted'); } catch (error) { if (!(error instanceof BoardplotSpecError)) throw error; }\n` +
      `if (!WaterfallChart) throw new Error('WaterfallChart export is missing');\n` +
      `const prepared = await prepareChart({type:'column',data:{categories:['A'],series:[{id:'s',values:[1]}]},size:'dashboard'});\n` +
      `if (prepared.kind !== 'svg' || prepared.result.refused || !prepared.result.scene.length || 'marks' in prepared.result) throw new Error('prepared chart export is invalid');\n` +
      `const spec = await parseChartSpec({version:1,charts:[{name:'volume',type:'column',data:{categories:['A'],series:[{id:'s',values:[1]}]},options:{size:'dashboard'}}]});\n` +
      `if (!BoardplotChart || spec.name !== 'volume' || (await prepareChart(spec.request)).kind !== 'svg') throw new Error('spec chart export is invalid');\n` +
      `if ((await parseChartSpec({type:'column',data:{categories:['A'],series:[{id:'s',values:[1]}]}})).request.type !== 'column') throw new Error('bare spec is not accepted');\n`,
  );
  run(process.execPath, [reactConsumer], { cwd: installRoot });
  assertReactSsr(installRoot);
  assertThemeRegistry(installRoot);
  assertRequire(installRoot);
  assertConsumerTypes(installRoot);
  checkReactBundles(installedPackageRoot, installedManifest);
  const sizeFailures = [
    ...checkSpecChunks(listReactTypes(installedManifest).sort()),
    ...checkTypeEntryChunks(listReactTypes(installedManifest).sort()),
    ...checkThemeEntry(installedPackageRoot),
    ...checkReactThemeEntry(installRoot, installedPackageRoot),
    ...checkLightEntries(installedPackageRoot),
    ...checkFontsEntry(),
    ...checkRowsEntry(installRoot, installedPackageRoot),
    ...checkViteDeferredChunks(installRoot),
  ];

  const documentPath = join(scratch, 'waterfall.json');
  const fixture = jsonOutput(boardplot, ['fixtures', '--type', 'waterfall'], { cwd: installRoot }).fixtures?.[0];
  if (!fixture?.spec) fail('installed CLI returned no waterfall fixture');
  checkFixtureImports(installRoot, listing.types.map((chart) => chart.type), { name: fixture.id, data: fixture.spec.data });
  writeFileSync(documentPath, JSON.stringify(fixture.spec));

  const validation = jsonOutput(boardplot, ['render', documentPath], { cwd: installRoot });
  if (validation.ok !== true) fail('installed CLI rejected its own waterfall fixture');

  const renderDirectory = join(scratch, 'rendered');
  const rendered = jsonOutput(boardplot, ['render', documentPath, '--out', renderDirectory], { cwd: installRoot });
  if (rendered.ok !== true || !rendered.reading?.derived?.length) {
    fail('installed CLI rendered the waterfall fixture without a reading of its derived numbers');
  }
  for (const output of rendered.outputs) assertFile(output);

  // The four family presets ship INSIDE the package (their JSON
  // is bundled at build time): each must resolve and render from the
  // installed tree with no repo files in reach.
  const themeContract = jsonOutput(boardplot, ['describe', 'theme'], { cwd: installRoot });
  for (const family of ['boardroom', 'capital', 'studio', 'glass']) {
    if (!themeContract.presets?.includes(family)) fail(`installed preset '${family}' is not listed`);
  }
  for (const family of ['boardroom', 'capital', 'studio', 'glass']) {
    const themed = join(scratch, `waterfall-${family}.json`);
    writeFileSync(themed, JSON.stringify({ ...fixture.spec, theme: family }));
    const familyRender = jsonOutput(boardplot, ['render', themed, '--out', join(scratch, `rendered-${family}`)], { cwd: installRoot });
    if (familyRender.ok !== true || familyRender.outputs.length === 0) fail(`installed preset '${family}' did not render`);
    for (const output of familyRender.outputs) assertFile(output);
  }

  // PNG without a browser: the optional @resvg/resvg-js installs with the
  // package and the installed CLI loads it at run time.
  if (existsSync(join(installRoot, 'node_modules', '@resvg', 'resvg-js'))) {
    const png = jsonOutput(boardplot, ['render', documentPath, '--format', 'png', '--out', join(scratch, 'rendered-png')], {
      cwd: installRoot,
      env: { ...process.env, BOARDPLOT_CHROME_PATH: join(scratch, 'no-chrome') },
    });
    if (png.ok !== true || !png.outputs?.[0]?.endsWith('.png')) fail('installed CLI did not rasterise through resvg');
    if (png.warnings?.some((warning) => warning.code === 'no-rasterizer')) fail('installed CLI did not find @resvg/resvg-js');
    assertFile(png.outputs[0]);
  } else {
    fail('npm did not install the optional @resvg/resvg-js with the package');
  }

  const requests = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'boardplot-package-smoke', version: '1' },
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ];
  const mcpOutput = run(boardplotMcp, [], {
    cwd: installRoot,
    input: `${requests.map((request) => JSON.stringify(request)).join('\n')}\n`,
  });
  const responses = mcpOutput
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const initialized = responses.find((response) => response.id === 1);
  const tools = responses.find((response) => response.id === 2)?.result?.tools;
  if (initialized?.result?.protocolVersion !== '2024-11-05') {
    fail('installed MCP server did not complete the protocol handshake');
  }
  const toolNames = new Set((tools ?? []).map((tool) => tool.name));
  for (const required of ['boardplot_list', 'boardplot_describe', 'boardplot_render', 'boardplot_measure', 'boardplot_fixtures', 'boardplot_feedback']) {
    if (!toolNames.has(required)) fail(`installed MCP server is missing tool '${required}'`);
  }
  if (toolNames.size !== 6) fail(`installed MCP server lists ${toolNames.size} tools, expected 6`);

  const marketplace = join(artifacts, 'boardplot-marketplace');
  run(process.execPath, ['scripts/build-plugin.mjs', '--tarball', tarball, '--out', artifacts]);
  // Both distributions must retain the same compiled-code and font notices.
  const packageNotices = readFileSync(join(installedPackageRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8').trimEnd();
  const pluginNotices = readFileSync(join(marketplace, 'plugins/boardplot/THIRD_PARTY_NOTICES.md'), 'utf8');
  if (!pluginNotices.startsWith(packageNotices + '\n') || !pluginNotices.includes('## zod ')) {
    fail('plugin notices must retain the tarball notices and add the vendored Zod licence');
  }

  // The plugin runtime's package.json names only files the runtime ships, its `types` conditions included.
  const pluginRuntime = join(marketplace, 'plugins', 'boardplot', 'runtime');
  assertPackageTargets(pluginRuntime, JSON.parse(readFileSync(join(pluginRuntime, 'package.json'), 'utf8')));

  for (const required of [
    join(marketplace, '.agents', 'plugins', 'marketplace.json'),
    join(marketplace, '.claude-plugin', 'marketplace.json'),
    join(marketplace, 'plugins', 'boardplot', '.claude-plugin', 'plugin.json'),
    join(marketplace, 'plugins', 'boardplot', '.codex-plugin', 'plugin.json'),
    join(marketplace, 'plugins', 'boardplot', 'runtime', 'dist', 'cli', 'index.js'),
    join(marketplace, 'plugins', 'boardplot', 'runtime', 'dist', 'mcp', 'server.js'),
    join(artifacts, 'BUILD-MANIFEST.json'),
    join(artifacts, 'boardplot-cowork.zip'),
  ]) {
    assertFile(required);
  }

  const codexManifest = JSON.parse(
    readFileSync(
      join(marketplace, 'plugins', 'boardplot', '.codex-plugin', 'plugin.json'),
      'utf8',
    ),
  );
  const claudeManifest = JSON.parse(
    readFileSync(
      join(marketplace, 'plugins', 'boardplot', '.claude-plugin', 'plugin.json'),
      'utf8',
    ),
  );
  if (codexManifest.name !== 'boardplot' || claudeManifest.name !== 'boardplot') {
    fail('plugin manifests do not identify boardplot');
  }

  if (sizeFailures.length > 0) fail(`every other check passed; the React bundle checks failed: ${sizeFailures.join('; ')}`);
  console.log(
    `PASS package smoke: ${exportTargetCount} export targets, boardplot and boardplot-mcp, ` +
      `core/validate/fixtures/React ${reactVersion} SSR, consumer types, MCP, and plugin bundle from ${basename(tarball)}`,
  );
  if (args.artifacts) console.log(`Artifacts: ${artifacts}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
  if (removeArtifacts) rmSync(artifacts, { recursive: true, force: true });
}
}
