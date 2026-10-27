#!/usr/bin/env node
/**
 * Builds the Boardplot runtime for a Claude Dashboard: classic scripts that
 * draw a column chart from `dash.data` rows. See scripts/dashboard/README.md.
 *
 *   node scripts/dashboard/build.mjs [--out <dir>] [--entry <file>] [--no-minify]
 *   (default out: artifacts/dashboard)
 *
 * Rollup bundles scripts/dashboard/entry.ts from src/ (TypeScript stripped by
 * esbuild, no type check) into AMD chunks, one chunk per output file. The
 * split follows the modules' execution order and cuts only where no import
 * crosses the cut backwards (an import cycle stays inside one file), so every
 * file needs only the files before it. Each chunk calls
 * `BoardplotDefine(id, deps, factory)`; the first file starts with the loader
 * that defines it, and the last file ends with `window.Boardplot = ...`.
 * Beside each script the build writes `docs/<file>.json`, the store document
 * `{"text": ...}` for `ArtifactData` `set` with `file_path`, and refuses any
 * document above LIMIT bytes (JSON in UTF-8, escapes counted).
 */
import { rollup } from 'rollup';
import { transform } from 'esbuild';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const out = resolve(outArg >= 0 ? args[outArg + 1] : resolve(root, 'artifacts/dashboard'));
const minify = !args.includes('--no-minify');
/** The store refuses a document above 262,144 bytes; this keeps a margin. */
const LIMIT = 250_000;
const entryArg = args.indexOf('--entry');
/** `--entry` builds another entry, for example one that registers a second chart type. */
const ENTRY = entryArg >= 0 ? resolve(args[entryArg + 1]) : resolve(here, 'entry.ts');
const ZOD_LOCALES = '\0zod-locales-en';
let minifyChunks = false;
/** Module id -> the ids it imports statically. */
const imports = new Map();

function resolveFile(base) {
  // A TypeScript source may name its sibling `x.js` for `x.ts`.
  const stem = base.replace(/\.js$/, '');
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${stem}.ts`, `${stem}.tsx`]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

const sourcePlugin = {
  name: 'boardplot-dashboard-source',
  resolveId(source, importer) {
    if (source.startsWith('node:')) this.error(`${source} is not available in a dashboard page (imported by ${importer})`);
    // Zod's classic entry configures English itself; its locale barrel adds every other language.
    if (/\/locales\/index\.js$/.test(source) && importer?.includes('/node_modules/zod/')) return ZOD_LOCALES;
    if (source.startsWith('.') || source.startsWith('/')) {
      const found = resolveFile(resolve(importer ? dirname(importer) : root, source));
      if (!found) this.error(`cannot resolve ${source} from ${importer}`);
      return found;
    }
    return fileURLToPath(import.meta.resolve(source));
  },
  async load(id) {
    if (id === ZOD_LOCALES) return `export { default as en } from ${JSON.stringify(fileURLToPath(import.meta.resolve('zod/v4/locales/en.js')))};`;
    if (id.endsWith('.json')) {
      const value = JSON.parse(readFileSync(id, 'utf8'));
      const named = Object.entries(value).filter(([key]) => /^[A-Za-z_$][\w$]*$/.test(key) && typeof value[key] !== 'object');
      return `${named.map(([key, item]) => `export const ${key} = ${JSON.stringify(item)};`).join('\n')}\nexport default ${JSON.stringify(value)};`;
    }
    if (!/\.tsx?$/.test(id)) return null;
    const { code } = await transform(readFileSync(id, 'utf8'), { loader: id.endsWith('x') ? 'tsx' : 'ts', format: 'esm', target: 'es2020', sourcefile: id });
    // The deferred loaders (src/core/deferred) fetch a chunk with import(); classic scripts cannot.
    // This build links the theme checks statically and leaves the annotation engine out, so a
    // deferred load fails and the chart reports the module it needs.
    return code.replace(/\bimport\((['"])([^'"]+)\1\)/g,
      (_, quote, path) => `Promise.reject(new Error(${JSON.stringify(`${path} is not in the dashboard build`)}))`);
  },
  buildEnd() {
    for (const id of this.getModuleIds()) imports.set(id, this.getModuleInfo(id).importedIds);
  },
  async renderChunk(code) {
    if (!minify || !minifyChunks) return null;
    const result = await transform(code, { minify: true, target: 'es2020', legalComments: 'none' });
    return result.code;
  },
};

/** Stores factories by id and runs one with its dependencies on first require. Sets zod's jitless flag first. */
const LOADER = `(function(g){var c=g.__zod_globalConfig||(g.__zod_globalConfig={});c.jitless=true;var f={},m={};`
  + `function r(id){id=id.replace(/^\\.\\//,"");if(m[id])return m[id];var d=f[id];if(!d)throw new Error("Boardplot: module "+id+" is not loaded");`
  + `var e=m[id]={};d[1].apply(null,d[0].map(function(x){return x==="exports"?e:r(x)}));return e}`
  + `g.BoardplotDefine=function(id,deps,fn){if(typeof deps==="function"){fn=deps;deps=[]}f[id]=[deps,fn]};g.BoardplotRequire=r})(window);\n`;
const FINISH = `\nwindow.Boardplot=BoardplotRequire("boardplot");\n`;

const bundle = await rollup({
  input: { boardplot: ENTRY },
  plugins: [sourcePlugin],
  onwarn(warning, warn) {
    // Zod's comments sit where Rollup cannot read an annotation; module cycles are handled below.
    if (warning.code !== 'CIRCULAR_DEPENDENCY' && warning.code !== 'INVALID_ANNOTATION') warn(warning);
  },
});

// Pass 1: one chunk gives the execution order and each module's rendered size.
const single = (await bundle.generate({ format: 'es' })).output.filter((item) => item.type === 'chunk');
if (single.length !== 1) throw new Error(`expected one chunk without a split, got ${single.length} (a dynamic import?)`);
const modules = Object.entries(single[0].modules).filter(([, info]) => info.renderedLength > 0).map(([id, info]) => ({ id, size: info.renderedLength }));
const position = new Map(modules.map((module, index) => [module.id, index]));
const ratio = minify ? (await transform(single[0].code, { minify: true, target: 'es2020', legalComments: 'none' })).code.length / single[0].code.length : 1;

// A cut after position p is open when no module at or before p imports one after p.
const blocked = new Int32Array(modules.length + 1);
for (const { id } of modules) {
  const from = position.get(id);
  for (const imported of imports.get(id) ?? []) {
    const to = position.get(imported);
    if (to !== undefined && to > from) { blocked[from] += 1; blocked[to] -= 1; }
  }
}
const open = [];
for (let index = 0, depth = 0; index < modules.length - 1; index += 1) {
  depth += blocked[index];
  open[index] = depth === 0;
}

/** Packs the modules into files of at most `budget` estimated bytes, cutting only where a cut is open. */
function pack(budget) {
  const files = [];
  let start = 0;
  while (start < modules.length) {
    let size = 0;
    let lastCut = -1;
    let index = start;
    for (; index < modules.length; index += 1) {
      size += modules[index].size * ratio;
      if (size > budget && lastCut >= start) break;
      if (index === modules.length - 1 || open[index]) lastCut = index;
    }
    const end = index >= modules.length ? modules.length - 1 : lastCut;
    files.push(modules.slice(start, end + 1).map((module) => module.id));
    start = end + 1;
  }
  return files;
}

let budget = LIMIT * 0.94;
let rows;
let order;
for (let round = 0; ; round += 1) {
  const files = pack(budget);
  const nameOf = new Map();
  files.forEach((ids, index) => ids.forEach((id) => nameOf.set(id, index === files.length - 1 ? 'boardplot' : `bp-${index + 1}`)));
  minifyChunks = true;
  const { output } = await bundle.generate({
    format: 'amd',
    amd: { autoId: true, define: 'BoardplotDefine' },
    entryFileNames: '[name].js',
    chunkFileNames: '[name].js',
    manualChunks: (id) => nameOf.get(id),
  });
  const chunks = output.filter((item) => item.type === 'chunk');
  order = files.map((_, index) => (index === files.length - 1 ? 'boardplot' : `bp-${index + 1}`));
  if (chunks.length !== order.length || chunks.some((chunk) => !order.includes(chunk.name))) {
    throw new Error(`Rollup made other chunks than the plan: ${chunks.map((chunk) => chunk.fileName).join(', ')}`);
  }
  rows = order.map((name, index) => {
    const chunk = chunks.find((item) => item.name === name);
    const text = (index === 0 ? LOADER : '') + chunk.code + (index === order.length - 1 ? FINISH : '');
    return { name: `${name}.js`, text, chunk, serialized: Buffer.byteLength(JSON.stringify({ text })) };
  });
  const largest = Math.max(...rows.map((row) => row.serialized));
  if (largest <= LIMIT) break;
  if (round === 4) throw new Error(`a file stays above ${LIMIT} bytes (${largest}): an import cycle larger than the limit cannot be split at a module seam`);
  budget *= LIMIT / largest * 0.98;
}
await bundle.close();

for (const row of rows) {
  if (/\beval\s*\(|new\s+Function\s*\(/.test(row.text)) console.warn(`note: ${row.name} contains the text eval( or new Function( (see the README)`);
}

const groupOf = (id) => {
  if (id === ZOD_LOCALES || id.includes('/node_modules/zod/')) return 'zod';
  const path = relative(root, id);
  const match = /^src\/(?:core\/)?(charts\/[^/]+|[^/]+?)(?:\/|\.tsx?$|\.json$)/.exec(path);
  return match ? match[1] : path;
};
const groupsOf = (chunk) => {
  const sizes = new Map();
  for (const [id, info] of Object.entries(chunk.modules)) sizes.set(groupOf(id), (sizes.get(groupOf(id)) ?? 0) + info.renderedLength);
  return [...sizes].sort((a, b) => b[1] - a[1]);
};

// The marker lists what the last build wrote. The build removes only those files, and it refuses
// a folder that holds files but no marker, so it never deletes what it did not write.
const MARKER = '.boardplot-dashboard-build.json';
if (existsSync(out)) {
  const marker = resolve(out, MARKER);
  if (existsSync(marker)) {
    // An edited marker could name a path outside the folder: refuse the whole list, delete nothing.
    const files = JSON.parse(readFileSync(marker, 'utf8')).files;
    const targets = (Array.isArray(files) ? files : [null]).map((file) => (typeof file === 'string' ? resolve(out, file) : null));
    const outside = targets.find((target) => target === null || relative(out, target).startsWith('..') || isAbsolute(relative(out, target)) || target === out);
    if (outside !== undefined) throw new Error(`${marker} names a path outside ${out}, so nothing was deleted; remove the marker or pass a new --out folder`);
    for (const target of targets) rmSync(target, { force: true });
  } else if (readdirSync(out).length) {
    throw new Error(`${out} holds files that no dashboard build wrote; pass an empty or new --out folder`);
  }
}
mkdirSync(resolve(out, 'docs'), { recursive: true });
const written = [];
const table = [];
const write = (name, text, holds) => {
  writeFileSync(resolve(out, name), text);
  const doc = JSON.stringify({ text });
  writeFileSync(resolve(out, 'docs', `${name}.json`), doc);
  written.push(name, `docs/${name}.json`);
  table.push({ name, raw: Buffer.byteLength(text), serialized: Buffer.byteLength(doc), holds });
};
for (const row of rows) {
  const groups = groupsOf(row.chunk);
  write(row.name, row.text, `${Object.keys(row.chunk.modules).length} modules: ${groups.slice(0, 5).map(([group]) => group).join(', ')}`);
}
const scripts = [...rows.map((row) => row.name), 'draw.js'];
write('draw.js', readFileSync(resolve(here, 'draw.js'), 'utf8'), 'page script');
const page = readFileSync(resolve(here, 'index.html'), 'utf8');
if (!page.includes('<!-- boardplot scripts -->')) throw new Error('index.html has no <!-- boardplot scripts --> line');
write('index.html', page.replace('<!-- boardplot scripts -->', scripts.map((name) => `<script src="${name}"></script>`).join('\n')), 'page fragment');
writeFileSync(resolve(out, 'load-order.json'), `${JSON.stringify(scripts, null, 2)}\n`);
written.push('load-order.json');
writeFileSync(resolve(out, MARKER), `${JSON.stringify({ files: written }, null, 2)}\n`);

const totals = new Map();
for (const [id, info] of Object.entries(single[0].modules)) totals.set(groupOf(id), (totals.get(groupOf(id)) ?? 0) + info.renderedLength);
const pad = (value, width) => String(value).padStart(width);
console.log(`file${' '.repeat(10)}raw bytes  serialized  holds`);
for (const row of table) console.log(`${row.name.padEnd(14)}${pad(row.raw, 9)}  ${pad(row.serialized, 10)}  ${row.holds}`);
console.log(`total serialized: ${table.reduce((sum, row) => sum + row.serialized, 0)} bytes in ${table.length} documents (${minify ? 'minified' : 'not minified'}, ${modules.length} modules)`);
console.log(`largest module groups (bytes before minification, of ${[...totals.values()].reduce((sum, size) => sum + size, 0)}):`);
for (const [group, size] of [...totals].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${group.padEnd(28)}${pad(size, 9)}`);
console.log(`wrote ${out}`);
