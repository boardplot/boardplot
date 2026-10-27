#!/usr/bin/env node
/**
 * Gallery: every chart type and every fixture, per output form, for review by eye.
 *
 *   npm run gallery                         all types
 *   npm run gallery -- --types line,table   only these type pages
 *   npm run gallery -- --compare <dir>      plus reference-compare.html from
 *                                           <dir>/manifest.json (scripts/gallery-compare.mjs)
 *   npm run gallery -- --out <dir>          write to <dir> instead
 *   npm run gallery -- --examples           example fixtures only: no torture or
 *                                           refusal examples
 *
 * It runs on request only: no build, test, CI job or hook calls it. It reuses
 * the built dist/ (run `npm run build` first) and replaces artifacts/gallery/
 * (gitignored), or the --out folder, with:
 *
 *   index.html        every type with its fixture counts and, per type, every
 *                     option of `boardplot describe <type> --full` with the
 *                     fixtures that set it; an option no fixture sets is a gap
 *   <type>.html       per fixture: BoardplotChart live in the browser, the SVG as
 *                     `boardplot render` writes it and its PNG at scale 2, with
 *                     switches for scheme, theme and panes
 *   <type>/<theme>/   the SVG and PNG files, rendered by dist/cli in parallel
 *   pptx/<type>.pptx  one slide per fixture: the PNG left, the same chart as an
 *                     SVG picture with the PNG as fallback right
 *   gallery.js        scripts/gallery-client.jsx bundled by esbuild
 *   coverage.json     the coverage table of index.html
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import * as zlib from 'node:zlib';
import { build } from 'esbuild';
import { comparePage } from './gallery-compare.mjs';

const started = performance.now();
const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(repo, 'dist');
const cliPath = join(dist, 'cli', 'index.js');
if (!existsSync(cliPath)) throw new Error('dist/ is missing: run `npm run build` first.');

const { values: args } = parseArgs({ options: { types: { type: 'string' }, compare: { type: 'string' }, out: { type: 'string' }, examples: { type: 'boolean' } } });
const requested = args.types?.split(',').map((type) => type.trim()).filter(Boolean);
const out = args.out ? resolve(args.out) : join(repo, 'artifacts', 'gallery');
// The build empties `out`, so it refuses a folder that holds anything but an earlier gallery.
if (existsSync(out) && readdirSync(out).length && !existsSync(join(out, 'gallery.css'))) {
  throw new Error(`${out} is not empty and holds no gallery: pick a new or empty folder for --out`);
}

/**
 * The page switch. The default preset renders the fixture as written, so its
 * folder is `authored`; every other theme is forced through options.theme,
 * as the notation golden variant does. A fixture that pins its own theme keeps
 * its overrides under the chosen preset, unless they set colours.
 */
const THEMES = [
  { key: 'boardroom', label: 'Boardroom', scheme: 'light', dir: 'authored' },
  { key: 'notation', label: 'Notation', scheme: 'light', dir: 'notation' },
  { key: 'capital', label: 'Capital', scheme: 'light', dir: 'capital' },
  { key: 'studio', label: 'Studio', scheme: 'light', dir: 'studio' },
  { key: 'notation-dark', label: 'Notation', scheme: 'dark', dir: 'notation-dark' },
  { key: 'glass', label: 'Glass', scheme: 'dark', dir: 'glass' },
];
const isDefault = (theme) => theme.key === THEMES[0].key;
const WORKERS = availableParallelism();
const CHUNK = 10;

/** One CLI call. A rejected spec exits 1 with JSON on stdout, which is an answer, not a failure. */
function cli(cliArgs, stdin) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [cliPath, ...cliArgs], { cwd: repo, maxBuffer: 1 << 30 }, (error, stdout, stderr) => {
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`boardplot ${cliArgs.join(' ')} failed: ${stderr || error?.message}`));
      }
    });
    if (stdin !== undefined) child.stdin.end(stdin);
  });
}

async function pool(items, size, work) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  }));
  return results;
}

const esc = (value) => String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
const specOf = (type, fixture) => ({
  type,
  data: fixture.data,
  ...(fixture.options ? { options: fixture.options } : {}),
  ...(fixture.annotations ? { annotations: fixture.annotations } : {}),
});
/**
 * a fixture that pins its theme follows the switch when its overrides
 * set no colour (type, space, marks, legend, value axis, table): the chosen
 * preset replaces the pinned one and the overrides stay. Colour overrides are
 * hex values tuned for one preset, and theme overrides take no role names, so
 * such a fixture keeps its pin and the page says why.
 */
const pinOf = (fixture) => fixture.options?.theme;
const colourOverrides = (fixture) => {
  const pin = pinOf(fixture);
  return pin && typeof pin === 'object' ? Object.keys(pin.overrides?.color ?? {}) : [];
};
const lockReason = (fixture) => {
  const pin = pinOf(fixture);
  if (pin === undefined) return undefined;
  if (typeof pin === 'object' && !pin.preset) return 'the fixture supplies a complete theme of its own, not a preset with overrides';
  const colours = colourOverrides(fixture);
  return colours.length ? `its colour overrides (${colours.join(', ')}) are hex values tuned for ${pin.preset}, and would clash with another preset` : undefined;
};
const ownTheme = (fixture) => lockReason(fixture) !== undefined;
/** The options a fixture renders with under a theme of the switch. */
const themedOptions = (fixture, theme) => {
  const pin = pinOf(fixture);
  if (isDefault(theme) || ownTheme(fixture)) return fixture.options;
  return { ...fixture.options, theme: pin === undefined || typeof pin === 'string' ? theme.key : { ...pin, preset: theme.key } };
};

// ------------------------------------------------------------------ inputs
const list = await cli(['list']);
const allTypes = list.types.map((entry) => entry.type);
const unknown = (requested ?? []).filter((type) => !allTypes.includes(type));
if (unknown.length) throw new Error(`unknown type ${unknown.join(', ')}; the types are ${allTypes.join(', ')}`);
const built = requested ?? allTypes;

const { getFixtures, getRefusalExamples } = await import(pathToFileURL(join(dist, 'fixtures.js')).href);
const { resolveTheme } = await import(pathToFileURL(join(dist, 'theme.js')).href);
// Refusal examples (fixture.refuses) show as refusal cards with their path and fix.
const fixturesOf = Object.fromEntries(allTypes.map((type) => [type, args.examples
  ? getFixtures(type).filter((fixture) => fixture.kind === 'example')
  : [...getFixtures(type), ...getRefusalExamples(type)]]));
const described = Object.fromEntries(await pool(allTypes, WORKERS, async (type) => [type, await cli(['describe', type, '--full'])]));
const themes = THEMES.map((theme) => {
  const { background, ink, inkMuted, grid } = resolveTheme(theme.key).color;
  return { ...theme, colors: { bg: background, ink, muted: inkMuted, line: grid } };
});

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'pptx'), { recursive: true });
const compare = args.compare ? comparePage(resolve(args.compare), out, themes) : undefined;
if (compare) writeFileSync(join(out, 'reference-compare.html'), compare.html);

// ------------------------------------------------------------------ render
const chartIndex = (path) => {
  const match = /^\/charts\/(\d+)/.exec(path ?? '');
  return match ? Number(match[1]) : undefined;
};
const findingsFor = (findings, index) => findings
  .filter((finding) => chartIndex(finding.path) === index)
  .map(({ code, severity, message, displayPath, suggest, fix }) => ({
    code, severity: severity ?? 'error', message, ...(displayPath ? { path: displayPath } : {}), ...(suggest ? { suggest } : {}), ...(fix ? { fix } : {}),
  }));

/** `${type}/${id}` -> theme folder -> { png, size, warnings } or { errors } */
const renders = new Map();
const record = (type, id, dir, result) => {
  const key = `${type}/${id}`;
  renders.set(key, { ...renders.get(key), [dir]: result });
};

/**
 * One envelope per chunk, drawn by `boardplot render` exactly as a caller gets
 * it: the SVG bytes equal a bare render of the same spec, because a chart's
 * ids hash its content, not its name. A refused chart refuses the whole call
 * and nothing is written, so its errors are recorded and the rest is drawn again.
 */
async function renderChunk({ type, theme, fixtures }) {
  const dir = join(out, type, theme.dir);
  mkdirSync(dir, { recursive: true });
  let pending = fixtures;
  while (pending.length) {
    const charts = pending.map((fixture) => {
      const options = themedOptions(fixture, theme);
      return { name: fixture.id, ...specOf(type, fixture), ...(options ? { options } : {}) };
    });
    const result = await cli(['render', '-', '--format', 'png', '--scale', '2', '--out', dir, '--return', 'svg'], JSON.stringify({ version: 1, charts }));
    if (result.ok) {
      result.charts.forEach((chart, index) => {
        const { id } = pending[index];
        writeFileSync(join(dir, `${id}.svg`), chart.svg);
        // Without a rasterizer the CLI writes SVG and warns; the PNG pane and the slides need the PNG.
        if (!result.outputs[index].endsWith('.png')) throw new Error(`boardplot render drew no PNG: ${result.warnings.map((w) => w.message).join('; ')}`);
        record(type, id, theme.dir, { png: basename(result.outputs[index]), size: chart.size, warnings: findingsFor(result.warnings, index) });
      });
      return;
    }
    const refused = new Set(result.errors.map((error) => chartIndex(error.path)).filter((index) => index !== undefined));
    if (!refused.size) {
      if (pending.length === 1) {
        record(type, pending[0].id, theme.dir, { errors: findingsFor(result.errors.map((error) => ({ ...error, path: '/charts/0' })), 0) });
      } else {
        for (const fixture of pending) await renderChunk({ type, theme, fixtures: [fixture] });
      }
      return;
    }
    pending.forEach((fixture, index) => {
      if (refused.has(index)) record(type, fixture.id, theme.dir, { errors: findingsFor(result.errors, index) });
    });
    pending = pending.filter((_, index) => !refused.has(index));
  }
}

const chunks = built.flatMap((type) => themes.flatMap((theme) => {
  const todo = fixturesOf[type].filter((fixture) => isDefault(theme) || !ownTheme(fixture));
  return Array.from({ length: Math.ceil(todo.length / CHUNK) }, (_, i) => ({ type, theme, fixtures: todo.slice(i * CHUNK, (i + 1) * CHUNK) }));
}));
const drawings = chunks.reduce((sum, chunk) => sum + chunk.fixtures.length, 0);
console.log(`rendering ${drawings} charts (SVG and PNG) of ${built.length} types in ${WORKERS} processes`);
await Promise.all([
  pool(chunks, WORKERS, renderChunk),
  build({
    entryPoints: [join(repo, 'scripts', 'gallery-client.jsx')],
    bundle: true,
    format: 'iife',
    minify: true,
    jsx: 'automatic',
    legalComments: 'none',
    define: { 'process.env.NODE_ENV': '"production"' },
    outfile: join(out, 'gallery.js'),
    logLevel: 'error',
  }),
]);

// ------------------------------------------------------------------ coverage
function valuesAt(input, path) {
  let values = [input];
  for (const step of path.split('.')) {
    values = values.flatMap((value) => {
      if (step === '*') return value && typeof value === 'object' ? Object.values(value) : [];
      const array = step.endsWith('[]');
      const next = value?.[array ? step.slice(0, -2) : step];
      return array ? (Array.isArray(next) ? next : []) : next === undefined ? [] : [next];
    });
  }
  return values;
}

/**
 * The values an option takes when a fixture leaves it out: the schema default,
 * else the values its description calls the default ("'dash' (the default)",
 * "default 'ink'").
 */
// shortcut: reads the description where the schema declares no default; drop the pattern once describe lists every default.
function defaultsOf(entry) {
  if (entry.default !== undefined) return [entry.default];
  return (entry.values ?? []).filter((value) => {
    const word = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`'${word}' \\((the )?default[),:]|\\bdefaults?(?: to| is)? '?${word}'?(?=[\\s.,;:)]|$)`, 'i').test(entry.description ?? '');
  });
}

/**
 * Coverage counts rendered fixtures. A fixture the CLI refuses as authored is a
 * refusal example and is listed apart; a `--types` run knows refusals only for
 * the types it rendered. A default counts as shown when a rendered fixture
 * leaves the option out while setting its parent.
 */
const coverage = Object.fromEntries(allTypes.map((type) => {
  const description = described[type];
  const fixtures = fixturesOf[type].map((fixture) => ({
    id: fixture.id,
    refused: Boolean(renders.get(`${type}/${fixture.id}`)?.authored?.errors),
    options: { ...fixture.options, ...(fixture.annotations ? { annotations: fixture.annotations } : {}) },
  }));
  const rendered = fixtures.filter((fixture) => !fixture.refused);
  const row = (path, entry = {}) => {
    const seen = rendered.map((fixture) => ({ id: fixture.id, values: valuesAt(fixture.options, path) })).filter((hit) => hit.values.length);
    const refusals = fixtures.filter((fixture) => fixture.refused && valuesAt(fixture.options, path).length).map((fixture) => fixture.id);
    const shown = new Set(seen.flatMap((hit) => hit.values));
    const parent = path.includes('.') ? path.slice(0, path.lastIndexOf('.')) : undefined;
    const leftOut = rendered.some((fixture) => !valuesAt(fixture.options, path).length && (!parent || valuesAt(fixture.options, parent).length));
    const defaultsShown = leftOut ? defaultsOf(entry).filter((value) => !shown.has(value)) : [];
    for (const value of defaultsShown) shown.add(value);
    return {
      path,
      type: entry.type,
      description: entry.description,
      fixtures: seen.map((hit) => hit.id),
      ...(refusals.length ? { refusals } : {}),
      ...(defaultsShown.length ? { defaultsShown } : {}),
      ...(entry.values ? { valuesNotShown: entry.values.filter((value) => !shown.has(value)) } : {}),
    };
  };
  const own = description.options.map((entry) => row(entry.path, entry));
  const ownTop = new Set(description.options.map((entry) => entry.path.split(/[.[]/)[0]));
  const refused = new Set(description.notAccepted ?? []);
  const shared = Object.entries(list.sharedOptions)
    .filter(([path]) => !ownTop.has(path) && !refused.has(path))
    .map(([path, text]) => row(path, { description: text }));
  return [type, { options: own, shared }];
}));
writeFileSync(join(out, 'coverage.json'), `${JSON.stringify(coverage, null, 2)}\n`);
/** An option no rendered fixture sets, unless it is enumerated and its defaults are its only values. */
const gap = (row) => !row.fixtures.length && !(row.defaultsShown && row.valuesNotShown?.length === 0);

// ------------------------------------------------------------------ pages
const CSS = `
/* Every rule names a gallery element; nothing reaches into the React panes. */
:root{--bg:#fff;--ink:#0d2a43;--muted:#4e6070;--line:#e9eef3;color-scheme:light}
:root[data-scheme=dark]{color-scheme:dark}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 -apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif}
.top a,.intro a,.toc a,.member>h2>a,.pane>figcaption>a,.cov a,.types a{color:inherit}
.intro code,.opts code,.findings code,.refused code,.cov code,.member>details>pre{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}
.top{position:sticky;top:0;z-index:20;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 24px;display:flex;flex-wrap:wrap;gap:8px 20px;align-items:center}
.top>h1{font-size:18px;margin:0}
.top>.nav{display:flex;flex-wrap:wrap;gap:12px;color:var(--muted)}
#controls{display:flex;flex-wrap:wrap;gap:8px 16px;margin-left:auto}
#controls .group,.variants .group{display:inline-flex;border:1px solid var(--line);border-radius:6px;overflow:hidden}
#controls .label,.variants .label{color:var(--muted);align-self:center;margin-right:6px}
#controls button,.variants button{font:inherit;color:inherit;background:transparent;border:0;border-left:1px solid var(--line);padding:4px 10px;cursor:pointer}
#controls button:first-child,.variants button:first-child{border-left:0}
#controls button[aria-pressed=true],.variants button[aria-pressed=true]{background:var(--ink);color:var(--bg)}
body>main{padding:16px 24px 64px}
.intro{color:var(--muted);max-width:980px}
.toc{columns:4 220px;margin:8px 0 24px;padding:0;list-style:none}
.fx{border-top:1px solid var(--line);padding:20px 0 28px}
.member>h2{font-size:16px;margin:0;display:inline}
.kind{display:inline-block;margin-left:8px;padding:0 6px;border:1px solid var(--line);border-radius:4px;color:var(--muted);font-size:12px}
.use{margin:4px 0}
.opts{margin:4px 0;color:var(--muted)}
.opts>code{display:inline-block;margin:2px 4px 2px 0;padding:0 4px;border:1px solid var(--line);border-radius:4px;color:var(--ink)}
.member>details>pre{max-height:360px;overflow:auto;border:1px solid var(--line);padding:8px;border-radius:4px}
.note{color:var(--muted);font-style:italic;margin:4px 0}
.note.locked>button{font:inherit;font-style:normal;margin-right:6px;padding:2px 8px;border:1px solid var(--line);border-radius:4px;background:transparent;color:var(--muted);cursor:not-allowed}
.variants{display:flex;flex-wrap:wrap;align-items:center;margin:8px 0 0}
.panes{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start;margin-top:12px}
.pane{margin:0;flex:none;max-width:100%}
.pane>figcaption{color:var(--muted);font-size:12px;margin-bottom:6px}
.pane>.body>img{display:block;outline:1px solid var(--line)}
.pane>.mount{outline:1px solid var(--line)}
.host{border:1px solid var(--line);border-radius:6px;padding:12px 12px 8px;background:var(--bg)}
.host-title{margin:0 0 8px;font-size:16px;font-weight:600}
.refused{max-width:520px;border:1px solid var(--line);padding:8px 12px;border-radius:4px}
[data-hide~=react] .pane[data-pane=react],[data-hide~=svg] .pane[data-pane=svg],[data-hide~=png] .pane[data-pane=png]{display:none}
.findings{margin:10px 0 0;padding-left:18px;color:var(--muted);font-size:12px}
.findings>.error,.gap{color:#c0392b}
:root[data-scheme=dark] .findings>.error,:root[data-scheme=dark] .gap{color:#ff8a80}
.types,.cov table{border-collapse:collapse;width:100%;max-width:1400px}
.types th,.types td,.cov th,.cov td{text-align:left;vertical-align:top;padding:4px 10px 4px 0;border-bottom:1px solid var(--line)}
.types th,.cov th{color:var(--muted);font-weight:600}
.types td.num{text-align:right;font-variant-numeric:tabular-nums}
.cov>summary{cursor:pointer;padding:6px 0}
.cov td:nth-child(3){max-width:760px}
.cov .ids>a{margin-right:8px;white-space:nowrap}
`;
writeFileSync(join(out, 'gallery.css'), CSS);

const page = ({ title, body, script }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><link rel="stylesheet" href="gallery.css"></head>
<body>${body}${script}</body></html>
`;

const info = Object.fromEntries(list.types.map((entry) => [entry.type, entry]));
const counts = (type) => {
  const fixtures = fixturesOf[type];
  const examples = fixtures.filter((fixture) => fixture.kind === 'example').length;
  return { total: fixtures.length, examples, torture: fixtures.length - examples };
};
const optionChip = ([key, value]) => {
  const text = JSON.stringify(value);
  const shown = value !== null && typeof value === 'object' ? `${key} ${text.length > 48 ? `${text.slice(0, 46)}…` : text}` : `${key}: ${text}`;
  return `<code title="${esc(text)}">${esc(shown)}</code>`;
};

/**
 * Fixtures tagged `variant-of:<id>` differ in one option (a facet order, a
 * pie rotation) and share one block with a switch between them. The
 * switch names the options that differ; an option a member leaves out shows
 * its default.
 */
const TEXT_OPTIONS = new Set(['title', 'subtitle', 'source', 'footnotes']);
function blocksOf(type, fixtures) {
  const blocks = [];
  const byGroup = new Map();
  fixtures.forEach((fixture, index) => {
    const group = fixture.tags?.find((tag) => tag.startsWith('variant-of:'));
    if (group && byGroup.has(group)) byGroup.get(group).members.push(index);
    else {
      const block = { members: [index] };
      blocks.push(block);
      if (group) byGroup.set(group, block);
    }
  });
  for (const block of blocks) {
    if (block.members.length < 2) continue;
    const options = block.members.map((index) => fixtures[index].options ?? {});
    block.keys = [...new Set(options.flatMap(Object.keys))].filter((key) => !TEXT_OPTIONS.has(key)
      && new Set(options.map((entry) => JSON.stringify(entry[key]))).size > 1);
    const entryOf = (key) => described[type].options.find((entry) => entry.path === key) ?? {};
    block.labels = options.map((entry) => block.keys.map((key) => entry[key] === undefined
      ? `${defaultsOf(entryOf(key)).map(String).join(' or ') || 'unset'} (default)`
      : typeof entry[key] === 'object' ? JSON.stringify(entry[key]) : String(entry[key])).join(', '));
  }
  return blocks;
}

function typePage(type, position) {
  const entry = info[type];
  const fixtures = fixturesOf[type];
  const { total, examples, torture } = counts(type);
  const prev = built[position - 1];
  const next = built[position + 1];
  const member = (fixture, index, shown) => {
    const annotations = fixture.annotations ?? fixture.options?.annotations;
    const theme = fixture.options?.theme;
    return `<div class="member" id="fx-${esc(fixture.id)}" data-member="${index}"${shown ? '' : ' hidden'}>
<h2><a href="#fx-${esc(fixture.id)}">${esc(fixture.id)}</a></h2><span class="kind">${fixture.refuses ? 'refusal example' : esc(fixture.kind)}</span>
<p class="use">${esc(fixture.title)}</p>
<p class="opts">Options it sets: ${Object.entries(fixture.options ?? {}).map(optionChip).join('') || 'none'}</p>
${annotations?.length ? `<p class="opts">Annotations: ${annotations.map((annotation) => `<code>${esc(annotation.kind)}</code>`).join('')}</p>` : ''}
${theme === undefined ? '' : ownTheme(fixture)
    ? `<p class="note locked"><button type="button" disabled>Theme switch off</button> Pinned to ${esc(theme.preset ?? theme.name ?? 'its own theme')}: ${esc(lockReason(fixture))}.</p>`
    : `<p class="note">Pinned to ${esc(typeof theme === 'string' ? theme : theme.preset)}${typeof theme === 'object' ? ` with ${esc(Object.keys(theme.overrides ?? {}).join(', ') || 'no')} overrides` : ''}: the default button shows it as written, every other theme swaps the preset and keeps the overrides.</p>`}
<details><summary>Spec</summary><pre>${esc(JSON.stringify(specOf(type, fixture), null, 2))}</pre></details>
</div>`;
  };
  const blocks = blocksOf(type, fixtures).map(({ members, keys, labels }) => {
    const [first] = members;
    const size = renders.get(`${type}/${fixtures[first].id}`)?.authored?.size ?? { width: 720, height: 405 };
    // a headless fixture shows inside a host frame that prints its title.
    const host = fixtures[first].hostTitle;
    const framed = (inner) => host ? `<div class="host"><p class="host-title">${esc(host)}</p>${inner}</div>` : inner;
    const variants = keys ? `<p class="variants"><span class="label">${esc(keys.join(', '))}</span><span class="group">${members.map((index, i) =>
      `<button type="button" data-variant="${index}" aria-pressed="${i === 0}">${esc(labels[i])}</button>`).join('')}</span></p>` : '';
    return `<section class="fx" data-active="${first}">
${members.map((index, i) => member(fixtures[index], index, i === 0)).join('\n')}
${variants}
${host ? `<p class="note">Shown in a host frame: the host prints the message title and the chart draws without one. Rendered alone, as <code>boardplot render</code> returns it, the chart warns missing-message-title, as it should.</p>` : ''}
<div class="panes">
<figure class="pane" data-pane="react"><figcaption>React: BoardplotChart, live, hover on</figcaption>${framed(`<div class="mount" data-react style="min-width:${size.width}px;min-height:${size.height}px"></div>`)}</figure>
<figure class="pane" data-pane="svg"><figcaption></figcaption>${framed('<div class="body"></div>')}</figure>
<figure class="pane" data-pane="png"><figcaption></figcaption>${framed('<div class="body"></div>')}</figure>
</div>
<ul class="findings"></ul>
</section>`;
  }).join('\n');
  const data = {
    type,
    themes,
    fixtures: fixtures.map((fixture) => ({
      id: fixture.id,
      spec: specOf(type, fixture),
      ownTheme: ownTheme(fixture),
      ...(pinOf(fixture) !== undefined && !ownTheme(fixture) ? { pinned: pinOf(fixture) } : {}),
      renders: renders.get(`${type}/${fixture.id}`) ?? {},
    })),
  };
  return page({
    title: `${type} · Boardplot gallery`,
    body: `<header class="top"><h1>${esc(type)}</h1>
<span class="nav"><a href="index.html">All types</a>${prev ? `<a href="${prev}.html">← ${esc(prev)}</a>` : ''}${next ? `<a href="${next}.html">${esc(next)} →</a>` : ''}<a href="index.html#cov-${type}">Option coverage</a><a href="pptx/${type}.pptx">PowerPoint</a></span>
<nav id="controls" aria-label="Page switches"></nav></header>
<main><p class="intro">${esc(entry.summary)}. ${total} fixtures: ${examples} examples, ${torture} torture. Chart IDs: ${esc((entry.ids ?? [type]).join(', '))}. Size floor ${entry.minWidth} × ${entry.minHeight}, fit ${esc(entry.fit)}.
Each block shows the same spec three ways: BoardplotChart mounted in this page, the SVG as <code>boardplot render</code> and <code>boardplot_render</code> return it, and the PNG at scale 2 shown at the chart's own size. The findings under a block are the CLI's warnings for the theme shown. Fixtures that differ in one option, such as a facet order or a pie rotation, share a block with a switch between them.</p>
<noscript><p class="refused">The page needs JavaScript for the React panes and the switches.</p></noscript>
<ul class="toc">${fixtures.map((fixture) => `<li><a href="#fx-${esc(fixture.id)}">${esc(fixture.id)}</a></li>`).join('')}</ul>
${blocks}</main>`,
    script: `<script type="application/json" id="gallery-data">${json(data)}</script><script src="gallery.js"></script>`,
  });
}

function indexPage() {
  const totals = allTypes.reduce((sum, type) => {
    const { options, shared } = coverage[type];
    return {
      fixtures: sum.fixtures + fixturesOf[type].length,
      options: sum.options + options.length,
      gaps: sum.gaps + options.filter(gap).length,
      sharedGaps: sum.sharedGaps + shared.filter(gap).length,
    };
  }, { fixtures: 0, options: 0, gaps: 0, sharedGaps: 0 });
  const link = (type, id) => built.includes(type) ? `<a href="${type}.html#fx-${esc(id)}">${esc(id)}</a>` : esc(id);
  const rows = (type, entries) => entries.map((row) => `<tr${gap(row) ? ' class="gap"' : ''}><td><code>${esc(row.path)}</code></td><td>${esc(row.type ?? '')}</td>
<td>${row.fixtures.length ? `<span class="ids">${row.fixtures.map((id) => link(type, id)).join(' ')}</span>` : gap(row) ? '<strong>Gap: no rendered fixture sets this option.</strong>' : 'No fixture sets it; every value it takes is its default, which the fixtures draw.'}${row.defaultsShown ? `<br>Default shown where a fixture leaves it out: ${row.defaultsShown.map((value) => `<code>${esc(JSON.stringify(value))}</code>`).join(' ')}` : ''}${row.fixtures.length && row.valuesNotShown?.length ? `<br><span class="gap">Values no fixture sets: ${row.valuesNotShown.map((value) => `<code>${esc(JSON.stringify(value))}</code>`).join(' ')}</span>` : ''}${row.refusals ? `<br>Refusal examples, not counted: <span class="ids">${row.refusals.map((id) => link(type, id)).join(' ')}</span>` : ''}</td></tr>`).join('');
  const summary = allTypes.map((type) => {
    const { total, examples, torture } = counts(type);
    const { options, shared } = coverage[type];
    const gaps = options.filter(gap).length;
    return `<tr><td>${built.includes(type) ? `<a href="${type}.html"><strong>${type}</strong></a>` : `<strong>${type}</strong>`}</td><td>${esc(info[type].summary)}</td>
<td class="num">${total}</td><td class="num">${examples}</td><td class="num">${torture}</td><td class="num">${options.length - gaps} of ${options.length}</td>
<td class="num"><a href="#cov-${type}"${gaps ? ' class="gap"' : ''}>${gaps}</a></td><td class="num">${shared.filter(gap).length}</td>
<td>${built.includes(type) ? `<a href="pptx/${type}.pptx">${type}.pptx</a>` : ''}</td></tr>`;
  }).join('\n');
  const sections = allTypes.map((type) => {
    const { options, shared } = coverage[type];
    const gaps = options.filter(gap).length;
    return `<details class="cov" id="cov-${type}"><summary><strong>${type}</strong>: ${options.length} option${options.length === 1 ? '' : 's'}, ${gaps} without a fixture; ${shared.length} shared options, ${shared.filter(gap).length} without a fixture</summary>
<table><thead><tr><th>Option</th><th>Type</th><th>Fixtures that set it</th></tr></thead><tbody>${rows(type, options)}
<tr><th colspan="3">Shared options this type accepts</th></tr>${rows(type, shared)}</tbody></table></details>`;
  }).join('\n');
  return page({
    title: 'Boardplot gallery',
    body: `<header class="top"><h1>Boardplot gallery</h1><span class="nav">engine ${esc(list.engine)}, engine rev ${list.engineRev}, built ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC${compare ? `<a href="reference-compare.html">${esc(compare.title)}</a>` : ''}</span><nav id="controls" aria-label="Page switches"></nav></header>
<main><p class="intro">${allTypes.length} chart types, ${totals.fixtures} fixtures. ${built.length === allTypes.length ? 'Every type has a page' : `Pages built for ${built.join(', ')} only (<code>--types</code>)`}: per fixture the React component live, the SVG of the CLI and MCP server, and the PNG at scale 2, under a light or dark scheme and each shipped theme family.
Option coverage: ${totals.options - totals.gaps} of ${totals.options} type options are set by at least one rendered fixture or shown by their default; ${totals.gaps} are not. Refusal examples count apart. Of the shared options a type accepts, ${totals.sharedGaps} are set by no fixture of that type. The PowerPoint files hold one slide per fixture, the PNG left and the SVG picture right, for testing Convert to Shape.</p>
<table class="types"><thead><tr><th>Type</th><th>Summary</th><th>Fixtures</th><th>Examples</th><th>Torture</th><th>Options with a fixture</th><th>Option gaps</th><th>Shared gaps</th><th>PowerPoint</th></tr></thead><tbody>${summary}</tbody></table>
<h2>Option coverage per type</h2>
<p class="intro">Every option <code>boardplot describe &lt;type&gt; --full</code> lists, with the fixtures whose options set it. An option counts as shown when a rendered fixture sets it, or when a rendered fixture leaves it out and so draws its default. The rest are marked as gaps, and so are enumerated values no fixture draws. Fixtures the CLI refuses are listed as refusal examples and not counted. Open a type to see its list.</p>
${sections}</main>`,
    script: `<script type="application/json" id="gallery-data">${json({ type: null, themes, fixtures: [] })}</script><script src="gallery.js"></script>`,
  });
}

for (const [position, type] of built.entries()) writeFileSync(join(out, `${type}.html`), typePage(type, position));
writeFileSync(join(out, 'index.html'), indexPage());

// ------------------------------------------------------------------ PowerPoint
const crc32 = zlib.crc32;

/** A zip archive: deflated XML, stored images. Node's zlib supplies deflate. */
function zip(files) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBytes = Buffer.from(name);
    const store = /\.(png)$/.test(name);
    const body = store ? data : zlib.deflateRawSync(data);
    const fields = (header) => {
      header.writeUInt16LE(store ? 0 : 8, 0);
      header.writeUInt16LE(0, 2); // 00:00
      header.writeUInt16LE(0x21, 4); // 1980-01-01
      header.writeUInt32LE(crc32(data), 6);
      header.writeUInt32LE(body.length, 10);
      header.writeUInt32LE(data.length, 14);
      header.writeUInt16LE(nameBytes.length, 18);
      return header;
    };
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    fields(head.subarray(8));
    local.push(head, nameBytes, body);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    fields(entry.subarray(10));
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += head.length + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PML = 'application/vnd.openxmlformats-officedocument.presentationml';
const rels = (entries) => `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('')}</Relationships>`;
const EMU = 9525; // per CSS pixel at 96 dpi
const IN = 914400;
const SLIDE = { w: 12192000, h: 6858000 };
const MARGIN = 0.4 * IN;
const GROUP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const xfrm = (x, y, w, h) => `<a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(w)}" cy="${Math.round(h)}"/></a:xfrm>`;
const titleShape = (spPr, paragraphs) => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>${spPr}<p:txBody><a:bodyPr anchor="t"/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
const textBox = (id, name, x, y, w, h, text, size = 1100) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0"/><a:lstStyle/>${text.split('\n').map((line) => `<a:p><a:r><a:rPr lang="en-US" sz="${size}"/><a:t>${esc(line)}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`;
const picture = (id, name, x, y, w, h, png, svg) => `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${name}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${png}">${svg ? `<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="${svg}"/></a:ext></a:extLst>` : ''}</a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
const THEME_XML = `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Gallery"><a:themeElements><a:clrScheme name="Gallery"><a:dk1><a:srgbClr val="0D2A43"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F3A56"/></a:dk2><a:lt2><a:srgbClr val="E9EEF3"/></a:lt2>${['10529E', '5B8DB8', 'A9C1D9', '79828C', 'CFD7DD', '0FA060'].map((c, i) => `<a:accent${i + 1}><a:srgbClr val="${c}"/></a:accent${i + 1}>`).join('')}<a:hlink><a:srgbClr val="10529E"/></a:hlink><a:folHlink><a:srgbClr val="5B8DB8"/></a:folHlink></a:clrScheme><a:fontScheme name="Gallery"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Gallery"><a:fillStyleLst>${'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${'<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'.repeat(3)}</a:lnStyleLst><a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
const TITLE_BOX = `<p:spPr>${xfrm(MARGIN, 0.25 * IN, SLIDE.w - 2 * MARGIN, 0.85 * IN)}</p:spPr>`;
const style = (size, bold) => `<a:lvl1pPr algn="l"><a:defRPr sz="${size}" b="${bold ? 1 : 0}"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr>`;
const MASTER = `${XML}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GROUP}${titleShape(TITLE_BOX, '<a:p><a:endParaRPr lang="en-US"/></a:p>')}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle>${style(2000, true)}</p:titleStyle><p:bodyStyle>${style(1400)}</p:bodyStyle><p:otherStyle>${style(1200)}</p:otherStyle></p:txStyles></p:sldMaster>`;
const LAYOUT = `${XML}<p:sldLayout ${NS} type="titleOnly" preserve="1"><p:cSld name="Title Only"><p:spTree>${GROUP}${titleShape('<p:spPr/>', '<a:p><a:endParaRPr lang="en-US"/></a:p>')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

/** One 16:9 slide per fixture: the PNG left, the SVG picture with the PNG as fallback right, both at one scale. */
function slideXml({ id, title, result }) {
  const heading = `<a:p><a:r><a:rPr lang="en-US" sz="2000" b="1"/><a:t>${esc(id)}</a:t></a:r><a:br><a:rPr lang="en-US" sz="2000"/></a:br><a:r><a:rPr lang="en-US" sz="1400" b="0"/><a:t>${esc(title)}</a:t></a:r></a:p>`;
  const top = 1.3 * IN;
  const column = (SLIDE.w - 3 * MARGIN) / 2;
  let shapes;
  if (result?.png) {
    const chartTop = top + 0.35 * IN;
    const scale = Math.min(1, column / (result.size.width * EMU), (SLIDE.h - chartTop - 0.3 * IN) / (result.size.height * EMU));
    const w = result.size.width * EMU * scale;
    const h = result.size.height * EMU * scale;
    const right = 2 * MARGIN + column;
    const percent = Math.round(scale * 100);
    shapes = textBox(3, 'Left caption', MARGIN, top, column, 0.3 * IN, `PNG, scale 2 (${percent} % of the chart's own size)`)
      + textBox(4, 'Right caption', right, top, column, 0.3 * IN, `SVG picture with the PNG as fallback (${percent} %)`)
      + picture(5, `${id} PNG`, MARGIN, chartTop, w, h, 'rId2')
      + picture(6, `${id} SVG`, right, chartTop, w, h, 'rId2', 'rId3');
  } else {
    const reason = result?.errors?.map((error) => `${error.code}: ${error.message}`).join('\n') ?? 'Not rendered.';
    shapes = textBox(3, 'Refusal', MARGIN, top, SLIDE.w - 2 * MARGIN, 3 * IN, `The CLI refused this fixture, so there is no chart to place.\n${reason}`, 1400);
  }
  return `${XML}<p:sld ${NS}><p:cSld><p:spTree>${GROUP}${titleShape(TITLE_BOX, heading)}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function deck(type) {
  const slides = fixturesOf[type].map((fixture) => ({ id: fixture.id, title: fixture.title, result: renders.get(`${type}/${fixture.id}`)?.authored }));
  const files = [];
  const add = (name, data) => files.push({ name, data: Buffer.isBuffer(data) ? data : Buffer.from(data) });
  add('[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="svg" ContentType="image/svg+xml"/><Override PartName="/ppt/presentation.xml" ContentType="${PML}.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${PML}.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${PML}.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/presProps.xml" ContentType="${PML}.presProps+xml"/><Override PartName="/ppt/viewProps.xml" ContentType="${PML}.viewProps+xml"/><Override PartName="/ppt/tableStyles.xml" ContentType="${PML}.tableStyles+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="${PML}.slide+xml"/>`).join('')}</Types>`);
  add('_rels/.rels', rels([['rId1', 'officeDocument', 'ppt/presentation.xml']]));
  add('ppt/presentation.xml', `${XML}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${10 + i}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${SLIDE.w}" cy="${SLIDE.h}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  add('ppt/_rels/presentation.xml.rels', rels([
    ['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'],
    ['rId2', 'presProps', 'presProps.xml'],
    ['rId3', 'viewProps', 'viewProps.xml'],
    ['rId4', 'theme', 'theme/theme1.xml'],
    ['rId5', 'tableStyles', 'tableStyles.xml'],
    ...slides.map((_, i) => [`rId${10 + i}`, 'slide', `slides/slide${i + 1}.xml`]),
  ]));
  add('ppt/presProps.xml', `${XML}<p:presentationPr ${NS}/>`);
  add('ppt/viewProps.xml', `${XML}<p:viewPr ${NS}/>`);
  add('ppt/tableStyles.xml', `${XML}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`);
  add('ppt/theme/theme1.xml', THEME_XML);
  add('ppt/slideMasters/slideMaster1.xml', MASTER);
  add('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]));
  add('ppt/slideLayouts/slideLayout1.xml', LAYOUT);
  add('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]));
  slides.forEach((slide, i) => {
    const n = i + 1;
    const media = [];
    if (slide.result?.png) {
      const dir = join(out, type, 'authored');
      add(`ppt/media/chart${n}.png`, readFileSync(join(dir, slide.result.png)));
      add(`ppt/media/chart${n}.svg`, readFileSync(join(dir, `${slide.id}.svg`)));
      media.push(['rId2', 'image', `../media/chart${n}.png`], ['rId3', 'image', `../media/chart${n}.svg`]);
    }
    add(`ppt/slides/slide${n}.xml`, slideXml(slide));
    add(`ppt/slides/_rels/slide${n}.xml.rels`, rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ...media]));
  });
  writeFileSync(join(out, 'pptx', `${type}.pptx`), zip(files));
}

for (const type of built) deck(type);

const refusedCount = [...renders.values()].filter((byTheme) => Object.values(byTheme).some((result) => result.errors)).length;
const seconds = ((performance.now() - started) / 1000).toFixed(1);
console.log(`${refusedCount} fixtures refused by the CLI in at least one theme (shown on their pages)`);
console.log(`gallery: ${join(out, 'index.html')}`);
console.log(`built in ${seconds} s`);
