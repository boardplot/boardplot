// One engine side for scripts/speed-tool.mjs. It loads the source of one
// checkout through tsx and answers JSON-line commands on stdin:
//   {"op":"first","i":n}            render case n once: ms, sha256 and, in cover mode, whether changed code ran
//   {"op":"time","i":n,"k":k,"gc":b} render case n k times: mean ms per draw; checks the output against the first sha
// Usage: node --expose-gc scripts/speed-tool-worker.mjs <root> <time|cover> <inputs.json> [changed-lines.json]
import { readFileSync, realpathSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { createRequire, findSourceMap } from 'node:module';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const [rootArg, mode, inputsFile, changedFile] = process.argv.slice(2);
// Node resolves imported files through symlinks, including macOS /var -> /private/var.
const root = realpathSync(rootArg);
const cover = mode === 'cover';
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

// Coverage starts before the engine compiles, so every engine function is counted.
let session;
if (cover) {
  session = new Session();
  session.connect();
  await session.post('Profiler.enable');
  await session.post('Debugger.enable');
  await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
}
process.setSourceMapsEnabled(true);
const { register } = await import(pathToFileURL(createRequire(join(root, 'package.json')).resolve('tsx/esm/api')).href);
register();
const load = (file) => import(pathToFileURL(join(root, file)).href);

const golden = await load('tests/golden/render.ts');
const { resolveChartRequest, layoutResolvedRequest } = await load('src/index.ts');
const { renderSvg } = await load('src/core/svg/renderSvg.ts');
const { requireGeometry } = await load('src/core/sizing.ts');

/** The public library route: validate, resolve, lay out, serialize; a refusal is its JSON. */
function renderRequest(request) {
  const resolved = resolveChartRequest(request);
  const layout = layoutResolvedRequest(resolved);
  if (layout.refused) return `REFUSED: ${JSON.stringify(layout.refused)}`;
  return renderSvg(requireGeometry(layout), resolved.theme);
}

const cases = golden.goldenCases().map((c) => ({
  key: `golden/${c.key}`,
  draw: () => golden.renderGolden(c.definition, c.fixture, c.variant).output,
}));
for (const input of JSON.parse(readFileSync(inputsFile, 'utf8'))) {
  const request = input.request;
  cases.push({
    key: input.key,
    // The clone is outside the timer; the engine may keep references into the request.
    prepare: () => structuredClone(request),
    draw: (copy) => {
      try { return renderRequest(copy); } catch (error) { return `ERROR: ${error.message}`; }
    },
  });
}

// The engine stamp differs between releases; the golden mask hides it, so a release compared with the previous one
// still gets timed. Loaded from this tool's own tree: the base checkout may predate the helper.
const { stampFreeSha: sha } = await import(new URL('../tests/golden/stamp.ts', import.meta.url).href);
const firstSha = new Map();

// ---- coverage: map changed source lines to generated offsets through the tsx source maps.
const changed = cover && changedFile ? JSON.parse(readFileSync(changedFile, 'utf8')) : {};
const changedByUrl = new Map(Object.entries(changed).map(([file, lines]) => [pathToFileURL(join(root, file)).href, new Set(lines)]));
const offsetsByScript = new Map();

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** Decoded source-map segments: [generated line, generated column, source line] (all 0-based). */
function decodeMappings(mappings) {
  const out = [];
  let sourceLine = 0, line = 0;
  for (const row of mappings.split(';')) {
    let column = 0;
    if (row) for (const segment of row.split(',')) {
      const values = [];
      let value = 0, shift = 0;
      for (const char of segment) {
        const digit = B64.indexOf(char);
        value += (digit & 31) << shift;
        if (digit & 32) shift += 5;
        else { values.push(value & 1 ? -(value >>> 1) : value >>> 1); value = 0; shift = 0; }
      }
      column += values[0];
      if (values.length >= 4) { sourceLine += values[2]; out.push([line, column, sourceLine]); }
    }
    line++;
  }
  return out;
}

/** Generated offsets of every mapped position on a changed line of this script, or null when it has none. */
async function changedOffsets(script) {
  if (offsetsByScript.has(script.scriptId)) return offsetsByScript.get(script.scriptId);
  let offsets = null;
  const lines = changedByUrl.get(script.url.split('?')[0]);
  const map = lines && findSourceMap(script.url);
  if (lines && !map) throw new Error(`no source map for ${script.url}`);
  if (map) {
    const { scriptSource } = await session.post('Debugger.getScriptSource', { scriptId: script.scriptId });
    const starts = [0];
    for (let i = 0; i < scriptSource.length; i++) if (scriptSource.charCodeAt(i) === 10) starts.push(i + 1);
    offsets = decodeMappings(map.payload.mappings).filter(([, , sourceLine]) => lines.has(sourceLine + 1))
      .map(([line, column]) => starts[line] + column);
  }
  offsetsByScript.set(script.scriptId, offsets);
  return offsets;
}

/** Whether any changed line ran since the last coverage take: its innermost covering range has a count above 0. */
async function changedRan() {
  const { result } = await session.post('Profiler.takePreciseCoverage');
  for (const script of result) {
    if (!changedByUrl.has(script.url.split('?')[0])) continue;
    const offsets = await changedOffsets(script);
    if (!offsets?.length) continue;
    const ranges = script.functions.flatMap((fn) => fn.ranges);
    for (const offset of offsets) {
      let best = null;
      for (const range of ranges) {
        if (range.startOffset <= offset && offset < range.endOffset
          && (!best || range.endOffset - range.startOffset <= best.endOffset - best.startOffset)) best = range;
      }
      if (best && best.count > 0) return true;
    }
  }
  return false;
}

// Changed code that runs while the modules load is reported; load is outside the timer, so it does not count for a case.
const loadRan = cover ? await changedRan() : false;
send({ ready: true, keys: cases.map((c) => c.key), loadRan });

for await (const line of createInterface({ input: process.stdin })) {
  const command = JSON.parse(line);
  const c = cases[command.i];
  try {
    if (command.op === 'first') {
      const copy = c.prepare?.();
      if (cover) await session.post('Profiler.takePreciseCoverage');
      const start = performance.now();
      const output = c.draw(copy);
      const ms = performance.now() - start;
      const ran = cover ? await changedRan() : undefined;
      const hash = sha(output);
      firstSha.set(command.i, hash);
      send({ i: command.i, ms, sha: hash, bytes: output.length, error: output.startsWith('ERROR:') ? output.slice(0, 300) : undefined, ran });
    } else if (command.op === 'time') {
      let total = 0;
      for (let n = 0; n < command.k; n++) {
        const copy = c.prepare?.();
        if (command.gc && globalThis.gc) globalThis.gc();
        const start = performance.now();
        const output = c.draw(copy);
        total += performance.now() - start;
        if (firstSha.has(command.i) && sha(output) !== firstSha.get(command.i)) throw new Error(`unstable output for ${c.key}`);
      }
      send({ i: command.i, ms: total / command.k });
    } else if (command.op === 'expect') {
      firstSha.set(command.i, command.sha);
      send({ i: command.i });
    } else throw new Error(`unknown op ${command.op}`);
  } catch (error) {
    send({ i: command.i, fatal: `${c?.key}: ${error.stack ?? error.message}` });
  }
}
