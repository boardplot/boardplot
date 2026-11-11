// Generated specs: draws fixture specs with named changes (option pairs, data shapes, extra widths)
// and checks four rules on every drawn case. A manual investigation tool: it exits 0 when it ran.
//
// Usage: npm run check:generated -- [--seed <n>] [--only <type,...>] [--cases <n per type>] [--jobs <n>] [--out <dir>]
//        npm run check:generated -- --spec <saved failing spec.json>   (checks rules 1 to 3 on that one request)
//
// A case is a fixture, a list of named changes and a theme, drawn at a series of widths with an
// automatic height. The seed and the type fix every case, so `--only <type>` rebuilds the cases of a full run.
// Rules:
//   1 crash     resolve, layout, render and reading end with a result or a structured refusal (an error with a code)
//   2 label     a label the layout requested is drawn, in reading.omissions, or named by a label-hidden warning
//               (the scorecard's R7)
//   3 number    every printed number is in the reading: the number census (scripts/number-census.mjs), authored theme
//   4 width     a spec that draws at a width draws at every wider width of its series
//               (past a text-size breakpoint, a refusal whose advised width draws is honest)
// For each distinct failure (type, rule, signature) it removes the changes one at a time while the failure stays
// and writes the smallest case as a request file to <out>/<n>-<type>-<rule>.json; <out>/index.json lists them,
// each with the seed, the command of its run and the command that reruns that one file.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { getChartDefinition, listCharts, measure, resolveChartRequest } from '../src/index.ts';
import { getFixtures } from '../src/fixtures/index.ts';
import '../src/core/geo/packs/all.ts';
import { typeWidthClass } from '../src/core/theme.ts';
import { chartReading } from '../src/core/reading.ts';
import { renderSvg } from '../src/core/svg/renderSvg.ts';
import { leaves, undrawnLabels } from './layout-scorecard.mjs';
import { censusCase } from './number-census.mjs';

const FIXED_WIDTHS = [320, 400, 480, 720, 960];
const BETWEEN_WIDTHS = [360, 440, 600, 840];
// The theme's text-size breakpoints: the widths where themeForWidth's size class (typeWidthClass) steps up.
const TEXT_BREAKPOINTS = Array.from({ length: 2000 }, (_, i) => i + 1).filter((w) => typeWidthClass(w) !== typeWidthClass(w - 1));
// Both sides of each breakpoint.
const EDGE_WIDTHS = TEXT_BREAKPOINTS.flatMap((w) => [w - 1, w]);
const EXTRA_PER_CASE = 3;
const THEMES = ['authored', 'notation'];
const RULE_NAMES = { 1: 'crash', 2: 'label', 3: 'number', 4: 'width' };
const clone = (value) => structuredClone(value);

/** mulberry32: a seeded generator, so a seed rebuilds every case. */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const typeSeed = (seed, type) => createHash('sha256').update(`${seed}/${type}`).digest().readUInt32BE(0);
const pick = (next, list) => list[Math.floor(next() * list.length)];
const sample = (next, list, n) => {
  const pool = [...list], out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(next() * pool.length), 1)[0]);
  return out;
};

// Numbers that place or count things rather than carry a value.
const LAYOUT_KEYS = new Set(['order', 'capacity', 'padding', 'width', 'height', 'offset', 'repeat', 'indent', 'offsetDays',
  'row', 'column', 'columns', 'top', 'right', 'bottom', 'left', 'minObservations', 'thresholdPct', 'level', 'depth', 'index']);
/**
 * Map every value number of a data object; `i` counts the values in document order. A formula (an object with an
 * `op`, such as a dimswitch measure's value) keeps its constants and its factor: they are not data.
 */
function mapValues(data, fn) {
  let i = 0;
  const walk = (value, key, formula) => {
    if (typeof value === 'number') return formula || LAYOUT_KEYS.has(key) ? value : fn(value, i++);
    if (Array.isArray(value)) return value.map((entry) => walk(entry, key, formula));
    if (value && typeof value === 'object') {
      const inner = formula || typeof value.op === 'string';
      return Object.fromEntries(Object.entries(value).map(([k, entry]) => [k, walk(entry, k, inner)]));
    }
    return value;
  };
  return walk(data, '', false);
}
/**
 * The value without its authored number formats at any depth. A number format is an example with a figure ("$412k",
 * "12%", "1,234"); a `format` without one is a name and stays (a creative's media format "Video").
 */
const withoutFormats = (value) => {
  if (Array.isArray(value)) return value.map(withoutFormats);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key, entry]) => !(['format', 'valueFormat'].includes(key) && typeof entry === 'string' && /\d/.test(entry)))
    .map(([key, entry]) => [key, withoutFormats(entry)]));
};
// Keep a scaled value free of float residue: the census flags binary-float digits of computed values only.
const clean = (value) => Number(value.toPrecision(12));
// A copied entry: a plain string entry (a category) and every id and label get a suffix; other strings (colours, references) stay.
const renamedEntry = (entry) => (typeof entry === 'string' ? `${entry} copy` : renamed(entry));
const renamed = (value) => {
  if (Array.isArray(value)) return value.map(renamed);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
    key === 'id' && typeof entry === 'string' ? `${entry}-2` : key === 'label' && typeof entry === 'string' ? `${entry} copy` : renamed(entry)]));
};
// The entry list of a type without categories, in this order.
const LISTS = ['items', 'rows', 'points', 'observations', 'regions', 'cohorts', 'groups', 'nodes', 'panels', 'facts', 'bands', 'links'];
/** One entry, or twice the entries with unique ids. Series arrays aligned with the categories follow them. */
function resize(data, double) {
  const fit = (list) => (double ? [...list, ...list.map(renamedEntry)] : list.slice(0, 1));
  if (Array.isArray(data.categories) && Array.isArray(data.series)) {
    const n = data.categories.length;
    const walk = (value) => {
      if (Array.isArray(value)) {
        const out = value.map(walk);
        return out.length === n ? (double ? [...out, ...out] : out.slice(0, 1)) : out;
      }
      return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, entry]) => [k, walk(entry)])) : value;
    };
    return { ...data, categories: fit(data.categories), series: data.series.map(walk) };
  }
  const key = LISTS.find((name) => Array.isArray(data[name]) && data[name].length > 0);
  return key ? { ...data, [key]: fit(data[key]) } : data;
}
const LONG = ' and its much longer descriptive name';
function longLabels(data) {
  const walk = (value, key) => {
    if (typeof value === 'string') return key === 'label' || key === 'categories' ? value + LONG : value;
    if (Array.isArray(value)) return value.map((entry) => walk(entry, key));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, entry]) => [k, walk(entry, k)]));
    return value;
  };
  return walk(data, '');
}

/** Generic data changes: each keeps most specs valid. */
const DATA_CHANGES = {
  'one-entry': (data) => resize(data, false),
  'one-series': (data) => (Array.isArray(data.series) && data.series.length > 1 ? { ...data, series: data.series.slice(0, 1) } : data),
  double: (data) => resize(data, true),
  'long-labels': longLabels,
  'scale-1e3': (data) => mapValues(data, (v) => clean(v * 1e3)),
  'scale-1e6': (data) => mapValues(data, (v) => clean(v * 1e6)),
  'scale-1e-3': (data) => mapValues(data, (v) => clean(v * 1e-3)),
  zeros: (data) => mapValues(data, (v, i) => (i % 3 === 1 ? 0 : v)),
  'all-zero': (data) => mapValues(data, () => 0),
  negatives: (data) => mapValues(data, (v, i) => (i % 2 ? -Math.abs(v) : v)),
  equal: (data) => { let first; return mapValues(data, (v) => (first ??= v)); },
  missing: (data) => mapValues(data, (v, i) => (i % 3 === 1 ? null : v)),
};
// Data changes dropped for a type: the schema or the layout refused 80% or more of the specs they made
// (seeds 1, 2 and 1110), so they find nothing there. Mostly ids that other entries reference, and values the type forbids.
const DROPPED = {
  bartable: ['double', 'all-zero'], box: ['missing'], bullet: ['double'], butterfly: ['one-series'],
  cohort: ['negatives', 'one-entry', 'double', 'all-zero'], creative: ['scale-1e3', 'equal', 'double', 'negatives'],
  diagram: ['double', 'one-entry'], dimswitch: ['double'], gantt: ['double'], grid: ['double'],
  histogram: ['one-entry', 'all-zero', 'scale-1e3', 'missing', 'equal'], kpi: ['missing'], likert: ['all-zero', 'negatives', 'missing'],
  pareto: ['missing', 'negatives', 'all-zero'], pie: ['all-zero'], pvm: ['missing'],
  pyramid: ['double', 'missing', 'one-entry', 'negatives', 'equal', 'zeros'], sankey: ['missing', 'negatives', 'all-zero'],
  scatter: ['all-zero'], slope: ['one-entry'], status: ['one-entry'], treemap: ['all-zero', 'negatives'],
  waffle: ['negatives', 'scale-1e6', 'scale-1e3'], waterfall: ['double', 'missing'],
};

function setPath(object, path, value) {
  const parts = path.split('.');
  let node = object;
  for (const part of parts.slice(0, -1)) {
    if (!node[part] || typeof node[part] !== 'object' || Array.isArray(node[part])) node[part] = {};
    node = node[part];
  }
  node[parts.at(-1)] = value;
}
const getPath = (object, path) => path.split('.').reduce((node, part) => node?.[part], object);

/** Every single option setting the options schema accepts on this fixture: each enum and boolean leaf value. */
function optionChanges(type, fixture) {
  const schema = getChartDefinition(type).optionsSchema;
  const changes = [];
  for (const [path, values] of leaves(schema)) {
    if (/^(size|locale|strings)(\.|$)/.test(path)) continue;
    for (const value of values) {
      if (getPath(fixture.options ?? {}, path) === value) continue;
      const options = clone(fixture.options ?? {});
      setPath(options, path, value);
      if (schema.safeParse(options).success) changes.push(`opt:${path}=${JSON.stringify(value)}`);
    }
  }
  return changes;
}

const fixtureOf = (type, id) => getFixtures(type).find((fixture) => fixture.id === id);

/** The request of a case at one width. Changes apply in order. */
export function requestFor(item, width) {
  const fixture = fixtureOf(item.type, item.fixture);
  let options = clone(fixture.options ?? {});
  let data = clone(fixture.data);
  for (const change of item.changes) {
    if (change.startsWith('opt:')) {
      const at = change.indexOf('=');
      setPath(options, change.slice(4, at), JSON.parse(change.slice(at + 1)));
    } else data = DATA_CHANGES[change.slice(5)](data);
  }
  // An authored format states the magnitude and precision of the unscaled data ("$412k", "12%", "1,234"):
  // beside scaled data it is an absurd input, so a scaled case prints in the engine's own formats.
  if (item.changes.some((change) => change.startsWith('data:scale-'))) { data = withoutFormats(data); options = withoutFormats(options); }
  // No annotations, no key: the empty list is the retired top-level form and makes every CLI render warn.
  const annotations = clone(fixture.annotations ?? fixture.options?.annotations ?? []);
  return { type: item.type, data, options: { ...options, size: { width } },
    ...(annotations.length ? { annotations } : {}), ...(item.theme === 'authored' ? {} : { theme: item.theme }) };
}

const normalMessage = (message) => String(message ?? '').replace(/'[^']*'|"[^"]*"/g, '…').replace(/\d+(\.\d+)?/g, 'N').slice(0, 120);

/** Draw one case at one width and check rules 1 to 3. */
export function checkWidth(item, width) {
  return checkRequest(requestFor(item, width), item.fixture);
}

/** Check rules 1 to 3 on one request at its width: a case, or a saved failing spec. */
export function checkRequest(request, id) {
  const item = { type: request.type, fixture: id, theme: request.theme ?? 'authored' };
  const width = request.options.size.width;
  const violations = [];
  const crash = (stage, error) => violations.push({ rule: 1, signature: `${stage}: ${normalMessage(error?.message ?? error)}`, message: String(error?.stack ?? error).split('\n').slice(0, 3).join(' | ') });
  let resolved, measured;
  try {
    resolved = resolveChartRequest(request);
    measured = measure(request);
  } catch (error) {
    if (error?.code !== undefined) return { status: 'refused', codes: [error.code], violations };
    crash('layout', error);
    return { status: 'error', violations };
  }
  const geometry = measured.geometry;
  if (!geometry) {
    const warnings = measured.refused?.warnings ?? measured.warnings;
    // The width a refusal's own size patch asks for, if it names one.
    const advised = warnings.flatMap((warning) => warning.fix ?? []).find((op) => op.op === 'replace' && op.path === '/options/size')?.value?.width;
    return { status: 'refused', codes: warnings.map((warning) => warning.code), ...(advised !== undefined ? { advised } : {}), violations };
  }
  try { renderSvg(geometry, resolved.theme); } catch (error) { crash('render', error); }
  let reading;
  try { reading = chartReading({ name: 'generated', type: item.type, request: resolved, geometry, claims: [] }); } catch (error) { crash('reading', error); }
  if (reading) {
    // A label-hidden warning that names the label reports it too.
    const warned = new Set(geometry.warnings.flatMap((warning) => warning.code !== 'label-hidden' ? []
      : [...(warning.detail?.hidden ?? []), warning.detail?.labelId].filter(Boolean)));
    for (const { id, kind } of undrawnLabels(request, geometry, reading)) {
      if (!warned.has(id)) violations.push({ rule: 2, signature: `${kind} ${id.split(':')[0]}`, message: `label ${id} (${kind}) is not drawn, not in reading.omissions and not in a warning` });
    }
  }
  if (item.theme === 'authored') {
    const { size, ...options } = request.options;
    try {
      const census = censusCase(item.type, { id: item.fixture, data: request.data, options, annotations: request.annotations }, width, 'en', measured);
      for (const finding of census.findings) {
        violations.push({ rule: 3, signature: `${finding.class} ${finding.surface}`, message: `${finding.class} ${finding.surface} ${finding.id}: ${JSON.stringify(finding.text)} source ${finding.raw ?? ''} ${finding.why ?? ''}`.trim() });
      }
    } catch (error) { crash('census', error); }
  }
  return { status: 'drawn', violations };
}

/**
 * Rule 4 on a series: every width above the narrowest drawn one draws too. A text-size breakpoint between the
 * two sets larger text, which can need more room: a refusal there is honest when no narrower width of its own
 * text size drew and the width its size patch asks for draws, with the height still automatic.
 */
function widthViolations(results, item) {
  const first = results.findIndex((result) => result.status === 'drawn');
  if (first < 0) return [];
  const honest = (result) => {
    const own = typeWidthClass(result.width);
    if (own === typeWidthClass(results[first].width) || result.advised === undefined || result.advised <= result.width) return false;
    if (results.some((other) => other.status === 'drawn' && other.width < result.width && typeWidthClass(other.width) === own)) return false;
    return typeWidthClass(result.advised) === own && checkWidth(item, result.advised).status === 'drawn';
  };
  return results.slice(first + 1).filter((result) => result.status === 'refused' && !honest(result)).map((result) => ({
    width: result.width, rule: 4, signature: (result.codes ?? []).join(','), drawnAt: results[first].width,
    message: `draws at ${results[first].width} px, refused at ${result.width} px (${(result.codes ?? []).join(', ')})`,
  }));
}

/** Whether a case still shows one failure: the same rule and signature at the same width. */
function stillFails(item, failure) {
  if (failure.rule === 4) {
    return widthViolations([{ width: failure.drawnAt, ...checkWidth(item, failure.drawnAt) }, { width: failure.width, ...checkWidth(item, failure.width) }], item)
      .some((v) => v.signature === failure.signature);
  }
  return checkWidth(item, failure.width).violations.some((v) => v.rule === failure.rule && v.signature === failure.signature);
}

/** The cases of one type: the seed fixes them. */
export function casesFor(type, seed, count) {
  const next = random(typeSeed(seed, type));
  const fixtures = getFixtures(type);
  const options = new Map(), datas = new Map();
  const cases = [];
  for (let i = 0; i < count; i++) {
    const fixture = pick(next, fixtures);
    if (!options.has(fixture.id)) {
      options.set(fixture.id, optionChanges(type, fixture));
      const before = JSON.stringify(fixture.data);
      datas.set(fixture.id, Object.keys(DATA_CHANGES).filter((name) => !DROPPED[type]?.includes(name)
        && JSON.stringify(DATA_CHANGES[name](clone(fixture.data))) !== before).map((name) => `data:${name}`));
    }
    let nOptions = pick(next, [0, 1, 2, 2]), nData = pick(next, [0, 1, 1]);
    if (nOptions + nData === 0) nOptions = 2;
    const changes = [...sample(next, options.get(fixture.id), nOptions), ...sample(next, datas.get(fixture.id), nData)];
    const widths = [...new Set([...FIXED_WIDTHS, ...sample(next, [...BETWEEN_WIDTHS, ...EDGE_WIDTHS], EXTRA_PER_CASE)])].sort((a, b) => a - b);
    cases.push({ type, fixture: fixture.id, changes, theme: pick(next, THEMES), widths });
  }
  return cases;
}

/** Run the cases of some types; shrink each distinct failure. */
export function runTypes(types, seed, count) {
  const rows = [], distinct = new Map();
  for (const type of types) {
    const row = { type, cases: 0, widths: 0, refused: 0, errors: 0, rules: { 1: 0, 2: 0, 3: 0, 4: 0 }, refusedBy: {}, usedBy: {} };
    for (const item of casesFor(type, seed, count)) {
      row.cases++;
      const results = item.widths.map((width) => ({ width, ...checkWidth(item, width) }));
      const failures = [...results.flatMap((result) => result.violations.map((v) => ({ ...v, width: result.width }))), ...widthViolations(results, item)];
      for (const result of results) {
        row.widths++;
        for (const change of item.changes) row.usedBy[change] = (row.usedBy[change] ?? 0) + 1;
        if (result.status === 'refused') {
          row.refused++;
          for (const change of item.changes) row.refusedBy[change] = (row.refusedBy[change] ?? 0) + 1;
        }
        if (result.status === 'error') row.errors++;
      }
      // A rule counts once per case and width.
      for (const rule of [1, 2, 3, 4]) row.rules[rule] += new Set(failures.filter((f) => f.rule === rule).map((f) => f.width)).size;
      for (const failure of failures) {
        const key = `${type}|${failure.rule}|${failure.signature}`;
        const seen = distinct.get(key);
        if (seen) { seen.where.add(`${row.cases}@${failure.width}`); if (item.changes.length < seen.item.changes.length) Object.assign(seen, { item, failure }); }
        else distinct.set(key, { key, type, rule: failure.rule, signature: failure.signature, where: new Set([`${row.cases}@${failure.width}`]), item, failure });
      }
    }
    rows.push(row);
  }
  for (const entry of distinct.values()) {
    // Case-widths that show this failure.
    entry.count = entry.where.size;
    delete entry.where;
    let item = entry.item;
    for (const change of entry.item.changes) {
      const trial = { ...item, changes: item.changes.filter((c) => c !== change) };
      if (stillFails(trial, entry.failure)) item = trial;
    }
    entry.smallest = { ...item, width: entry.failure.width };
    entry.message = (entry.failure.rule === 4 ? widthViolations([
      { width: entry.failure.drawnAt, ...checkWidth(item, entry.failure.drawnAt) }, { width: entry.failure.width, ...checkWidth(item, entry.failure.width) },
    ], item)[0] : checkWidth(item, entry.failure.width).violations.find((v) => v.rule === entry.rule && v.signature === entry.signature))?.message ?? entry.failure.message;
    entry.request = requestFor(item, entry.failure.width);
    delete entry.item;
  }
  return { rows, distinct: [...distinct.values()] };
}

function main() {
  const args = process.argv.slice(2);
  const usage = 'Usage: npm run check:generated -- [--seed <n>] [--only <type,...>] [--cases <n per type>] [--jobs <n>] [--out <dir>] | --spec <file>';
  let seed = 1, count = 40, only, out, jobs = availableParallelism() - 1;
  if (args[0] === '--spec' && args[1] && args.length === 2) {
    const result = checkRequest(JSON.parse(readFileSync(args[1], 'utf8')), basename(args[1], '.json'));
    console.log([`${args[1]}: ${result.status}${result.codes ? ` (${result.codes.join(', ')})` : ''}, ${result.violations.length} violations`,
      ...result.violations.map((v) => `  ${v.rule} ${RULE_NAMES[v.rule]} ${v.message.slice(0, 300)}`)].join('\n'));
    return Promise.resolve();
  }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--seed' && /^\d+$/.test(args[i + 1] ?? '')) seed = Number(args[++i]);
    else if (args[i] === '--cases' && /^\d+$/.test(args[i + 1] ?? '')) count = Number(args[++i]);
    else if (args[i] === '--only' && args[i + 1]) only = args[++i].split(',').map((entry) => entry.trim()).filter(Boolean);
    else if (args[i] === '--out' && args[i + 1]) out = args[++i];
    else if (args[i] === '--jobs' && /^[1-9]\d*$/.test(args[i + 1] ?? '')) jobs = Number(args[++i]);
    else throw new Error(usage);
  }
  const all = listCharts().map(({ type }) => type);
  for (const type of only ?? []) if (!all.includes(type)) throw new Error(`--only: no chart type ${type}`);
  const types = only ?? all;
  out = resolve(out ?? `artifacts/generated-specs/seed-${seed}-${Date.now()}`);
  // Types in round robin over worker threads; the result does not depend on the split.
  jobs = Math.max(1, Math.min(types.length, jobs));
  const parts = Array.from({ length: jobs }, (_, k) => types.filter((_, i) => i % jobs === k));
  return Promise.all(parts.map((part) => new Promise((done, fail) => {
    const worker = new Worker(`
      const { workerData } = require('node:worker_threads');
      require('tsx/esm/api').register();
      import(workerData.url);
    `, { eval: true, execArgv: [], workerData: { types: part, seed, count, url: import.meta.url } });
    worker.once('message', done);
    worker.once('error', fail);
    worker.once('exit', (code) => { if (code !== 0) fail(new Error(`worker exited ${code}`)); });
  }))).then((results) => {
    const rows = results.flatMap((result) => result.rows).sort((a, b) => (a.type < b.type ? -1 : 1));
    const distinct = results.flatMap((result) => result.distinct).sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1));
    mkdirSync(out, { recursive: true });
    const command = (type) => `npm run check:generated -- --seed ${seed} --cases ${count} --only ${type}`;
    const index = distinct.map((entry, i) => {
      const file = `${String(i + 1).padStart(3, '0')}-${entry.type}-${RULE_NAMES[entry.rule]}.json`;
      writeFileSync(resolve(out, file), JSON.stringify(entry.request, null, 2) + '\n');
      return { file, seed, command: command(entry.type), rerun: `npm run check:generated -- --spec ${resolve(out, file)}`, type: entry.type, rule: `${entry.rule} ${RULE_NAMES[entry.rule]}`, signature: entry.signature,
        cases: entry.count, fixture: entry.smallest.fixture, changes: entry.smallest.changes, theme: entry.smallest.theme, width: entry.smallest.width, message: entry.message };
    });
    writeFileSync(resolve(out, 'index.json'), JSON.stringify({ seed, cases: count, rows, failures: index }, null, 1) + '\n');
    const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(0)}%` : '-');
    const lines = [`Generated specs, seed ${seed}, ${count} cases per type, widths ${FIXED_WIDTHS.join(',')} plus ${EXTRA_PER_CASE} of ${[...BETWEEN_WIDTHS, ...EDGE_WIDTHS].join(',')} (text breakpoints ${TEXT_BREAKPOINTS.join(', ')}).`,
      'Violations count case-widths; distinct is per type, rule and signature.', '',
      '| type | cases | widths | refused | 1 crash | 2 label | 3 number | 4 width | distinct |', '|---|--:|--:|--:|--:|--:|--:|--:|--:|'];
    const total = { cases: 0, widths: 0, refused: 0, rules: { 1: 0, 2: 0, 3: 0, 4: 0 } };
    for (const row of rows) {
      const n = distinct.filter((entry) => entry.type === row.type).length;
      lines.push(`| ${row.type} | ${row.cases} | ${row.widths} | ${pct(row.refused, row.widths)} | ${row.rules[1]} | ${row.rules[2]} | ${row.rules[3]} | ${row.rules[4]} | ${n} |`);
      total.cases += row.cases; total.widths += row.widths; total.refused += row.refused;
      for (const rule of [1, 2, 3, 4]) total.rules[rule] += row.rules[rule];
    }
    lines.push(`| all | ${total.cases} | ${total.widths} | ${pct(total.refused, total.widths)} | ${total.rules[1]} | ${total.rules[2]} | ${total.rules[3]} | ${total.rules[4]} | ${distinct.length} |`, '');
    // A change that is refused in most of its widths finds nothing for that type.
    const mostlyRefused = rows.flatMap((row) => Object.entries(row.refusedBy).filter(([change, n]) => n >= 0.8 * row.usedBy[change] && n >= 10)
      .map(([change, n]) => `${row.type} ${change} ${n}/${row.usedBy[change]}`));
    if (mostlyRefused.length) lines.push(`Changes refused in 80% or more of their case-widths: ${mostlyRefused.join('; ')}`, '');
    lines.push('Distinct failures, most cases first:');
    for (const entry of index) lines.push(`  ${entry.file} [${entry.cases}] ${entry.rule} ${entry.signature}: ${entry.message.slice(0, 200)}`);
    lines.push('', `Smallest failing specs and index.json: ${out}`, `Rerun one of them: npm run check:generated -- --spec ${out}/<file>`);
    console.log(lines.join('\n'));
  });
}

if (!isMainThread && workerData?.url === import.meta.url) {
  parentPort.postMessage(runTypes(workerData.types, workerData.seed, workerData.count));
} else if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { console.error(error.message ?? error); process.exitCode = 2; });
}
