#!/usr/bin/env node
// Shared speed check: a PR head against the origin/main commit it merges.
//
//   node scripts/speed-tool.mjs [--head <ref>] [--base <ref>] [--input <file.json>]... [--case <key>]... [--out <dir>]
//
// Options: --head (default HEAD), --base (default origin/main, fetched), --input a chart request
// JSON ({type, data, options} or {request: ...}) when the changed path runs in no golden,
// --out (default <work>/out), --work (temporary checkouts, default under the OS temp dir),
// --force (run even when the skip rule applies), --all-ran (treat every case as running the
// changed code: control runs), --min-ms (default 20; diagnostics only), --pairs (default 9),
// --keep (keep the temporary checkouts), --no-fetch, --case (time only this case, a golden key such as
// column/ranked-dense.authored or golden/..., input/... or extra/...; repeatable; skips the full identity pass).
// Importing the module runs nothing; `markdown(report)` is exported.
// Run it with no other heavy job of your own (builds, sweeps, test runs) on the machine.
//
// Steps:
//  1. Resolve base (default origin/main, fetched first) and head (default HEAD). A head that does
//     not contain base is merged with base in a temporary checkout, as GitHub tests a PR.
//  2. Stop before timing when the diff changes no src/core code beyond whitespace: SKIPPED when
//     no src code changed (docs, tests, packaging, formatting), NO EVIDENCE when src code outside
//     src/core changed (CLI, MCP, React). The tool times the src/core render route only.
//  3. Render every common case once per side and each head-only case once on head. Record
//     changed SVG bytes. The head runs under V8 coverage to find changed src lines per case.
//     Each side must keep its own first SVG hash in every timing phase.
//  4. Case set: (a) cases where changed code ran and main takes 15 ms or more in step 3,
//     (b) the 30 slowest goldens on main, (c) scripts/speed-inputs, (d) --input files.
//     Common cases with changed output are timed too. Head-only cases are timed separately,
//     without a base ratio or slowdown verdict; they cannot turn NO EVIDENCE into PASS.
//     Other common cases where changed code did not run are listed, not timed.
//     Per case: 2 warm-up pairs (1 from 200 ms), then 9 interleaved pairs main, head. Medians per side.
//     A sample averages 1 to 5 draws, so that a sample takes about 40 ms.
//  5. A case is slower only when main > 20 ms, changed code ran for it, and the same case is above
//     head/main 1.05 in both runs: run 1 (main first) and run 2 (head first, in fresh processes, so
//     a bias of one process cannot confirm itself). The report prints the min and max samples of
//     each side for every case that went to run 2, and for a confirmed case whether the run-2
//     ranges of main and head overlap. A confirmed case whose run-2 ranges overlap is timed once
//     more on its own in fresh processes (main first), as --case would, and the report prints that
//     ratio beside the verdict. Both are extra evidence only: the rule reads neither, and a single
//     re-time never erases two slower runs.
// Verdict (first line of the report):
//   PASS         changed code ran in at least one timed case and no case is confirmed slower.
//   SLOWER       at least one case is confirmed slower.
//   NO EVIDENCE  0 timed cases ran changed code, or only src code outside src/core changed.
//                This is not a pass: the change was not timed. Time it another way.
//   SKIPPED      no src code changed beyond whitespace.
// Output: a Markdown table on stdout and in <out>/speed.md, the full record in <out>/speed.json.
// Exit codes: 0 pass, no evidence or skipped (read the verdict line), 1 confirmed slowdown, 2 error.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const WORKER = join(TOOL_DIR, 'speed-tool-worker.mjs');
const INPUT_DIR = join(TOOL_DIR, 'speed-inputs');

function parseArgs(argv) {
  const options = {
    base: 'origin/main', head: 'HEAD', inputs: [], cases: [], out: undefined, work: undefined,
    pairs: 9, warm: 2, top: 30, minMs: 20, screenMs: 15, limit: 1.05,
    fetch: true, force: false, allRan: false, keep: false,
  };
  const value = (i) => { if (argv[i + 1] === undefined) throw new Error(`${argv[i]} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--base') options.base = value(i++);
    else if (arg === '--head') options.head = value(i++);
    else if (arg === '--input') options.inputs.push(resolve(value(i++)));
    else if (arg === '--case') options.cases.push(value(i++));
    else if (arg === '--out') options.out = resolve(value(i++));
    else if (arg === '--work') options.work = resolve(value(i++));
    else if (arg === '--pairs') options.pairs = Number(value(i++));
    else if (arg === '--min-ms') { options.minMs = Number(value(i++)); options.screenMs = options.minMs * 0.75; }
    else if (arg === '--no-fetch') options.fetch = false;
    else if (arg === '--force') options.force = true;
    else if (arg === '--all-ran') options.allRan = true;
    else if (arg === '--keep') options.keep = true;
    else if (arg === '--help' || arg === '-h') { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\nimport ')[0]); process.exit(0); }
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!(options.minMs > 0)) throw new Error('--min-ms must be a positive number');
  if (!Number.isInteger(options.pairs) || options.pairs < 3 || options.pairs % 2 === 0) throw new Error('--pairs must be an odd integer of 3 or more');
  return options;
}

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted[(sorted.length - 1) >> 1]; };
const log = (message) => process.stderr.write(`[speed-tool] ${message}\n`);
/** Whether two sample ranges overlap. Extra evidence only: the verdict rule does not read it. */
const overlap = (a, b) => Math.max(Math.min(...a), Math.min(...b)) <= Math.min(Math.max(...a), Math.max(...b));

/** Changed head lines per src file, from a zero-context diff that ignores whitespace, as the skip rule does. A pure deletion marks the head lines around it. */
function changedLines(repo, base, head) {
  const diff = git(repo, 'diff', '-U0', '-w', '--ignore-blank-lines', '--no-color', '--no-ext-diff', base, head, '--', 'src');
  const files = {};
  let file = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) { file = line === '+++ /dev/null' ? null : line.slice(6); if (file) files[file] ??= []; continue; }
    const hunk = file && /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!hunk) continue;
    const start = Number(hunk[1]), count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    if (count === 0) files[file].push(start, start + 1);
    else for (let n = start; n < start + count; n++) files[file].push(n);
  }
  return files;
}

/** Why the tool times nothing for this diff ({status, reason}), or null when src/core code changed beyond whitespace. */
function skipReason(repo, base, head) {
  const names = git(repo, 'diff', '--name-only', base, head).split('\n').filter(Boolean);
  const real = (files) => files.length > 0 && git(repo, 'diff', '-w', '--ignore-blank-lines', '--stat', base, head, '--', ...files) !== '';
  const code = names.filter((name) => /^src\/.*\.tsx?$/.test(name));
  const core = code.filter((name) => name.startsWith('src/core/'));
  if (real(core)) return null;
  const outside = code.filter((name) => !name.startsWith('src/core/'));
  if (real(outside)) {
    return { status: 'NO EVIDENCE', reason: `Code outside src/core changed (${outside.slice(0, 5).join(', ')}${outside.length > 5 ? ', ...' : ''}); the tool times the src/core render route only and cannot reach it` };
  }
  return { status: 'SKIPPED', reason: core.length ? `Only whitespace changed in src/core (${core.length} files)` : `No src code changed (${names.length} changed files)` };
}

const liveWorkers = new Set();

class Worker {
  constructor(root, mode, inputsFile, changedFile) {
    this.process = spawn(process.execPath, ['--expose-gc', WORKER, root, mode, inputsFile, ...(changedFile ? [changedFile] : [])], {
      cwd: root, stdio: ['pipe', 'pipe', 'inherit'],
    });
    this.lines = createInterface({ input: this.process.stdout })[Symbol.asyncIterator]();
    this.exited = new Promise((done) => this.process.on('exit', (code) => done(code)));
    liveWorkers.add(this);
    this.exited.then(() => liveWorkers.delete(this));
  }
  async read() {
    const next = await Promise.race([this.lines.next(), this.exited.then((code) => ({ exited: code }))]);
    if ('exited' in next || next.done) throw new Error(`worker exited (${next.exited ?? 'stdout closed'})`);
    const message = JSON.parse(next.value);
    if (message.fatal) throw new Error(message.fatal);
    return message;
  }
  async call(command) { this.process.stdin.write(`${JSON.stringify(command)}\n`); return this.read(); }
  /** Ends the worker and resolves when its process has exited. */
  stop() { this.process.stdin.end(); this.process.kill(); return this.exited; }
}

async function startPair(roots, inputsFile, changedFile, modes) {
  const workers = {
    main: new Worker(roots.main, modes.main, inputsFile),
    head: new Worker(roots.head, modes.head, inputsFile, modes.head === 'cover' ? changedFile : undefined),
  };
  const [mainReady, headReady] = await Promise.all([workers.main.read(), workers.head.read()]);
  if (mainReady.keys.join('\n') !== headReady.keys.join('\n')) {
    const mainKeys = new Set(mainReady.keys), headKeys = new Set(headReady.keys);
    workers.main.keysOnly = mainReady.keys.filter((key) => !headKeys.has(key));
    workers.head.keysOnly = headReady.keys.filter((key) => !mainKeys.has(key));
  }
  return { workers, mainKeys: mainReady.keys, headKeys: headReady.keys, loadRan: headReady.loadRan };
}

export function markdown(report) {
  const lines = [];
  const ms = (value) => value.toFixed(1);
  const heading = `Speed tool: **${report.status}**. Head ${report.head.slice(0, 9)}${report.merged ? ' (merged with base)' : ''} vs main ${report.base.slice(0, 9)}.`;
  if (report.status === 'ERROR') return `Verdict: ERROR. ${report.error.replace(/[\r\n]/g, ' ')}\n${heading}\n`;
  if (report.skipReason) {
    lines.push(report.status === 'SKIPPED' ? `Verdict: SKIPPED. ${report.skipReason}.` : `Verdict: NO EVIDENCE, not a pass. ${report.skipReason}.`);
    lines.push(heading);
    return `${lines.join('\n')}\n`;
  }
  const verdict = {
    PASS: `Verdict: PASS. Changed code ran in ${report.counts.timed} timed cases; none is confirmed slower.`,
    SLOWER: `Verdict: SLOWER. ${report.slower.length} cases are confirmed slower in both runs.`,
    'NO EVIDENCE': 'Verdict: NO EVIDENCE, not a pass. Changed code ran in 0 timed cases, so the change was not timed. Add an --input where it runs.',
  }[report.status];
  lines.push(verdict, heading);
  const alone = (report.cases ?? []).filter((c) => c.alone);
  if (alone.length) {
    lines.push(`Re-timed alone, as extra evidence (the run-2 ranges overlap; the verdict stands): ${alone.map((c) => `${c.key} ${c.alone.ratio.toFixed(3)} (main ${ms(c.alone.mainMs)} ms, head ${ms(c.alone.headMs)} ms)`).join('; ')}.`);
  }
  // Under --case the case set is the picked cases only, so the corpus-wide counts do not apply.
  const caseSet = `Common cases${report.picked ? ' (--case)' : ''}: changed code ran in ${report.ranCases.length} of ${report.counts.all}. Timed: ${report.cases.length} (${report.counts.timed} where it ran, ${report.counts.top} of the ${report.rule.top} slowest goldens, ${report.counts.inputs} inputs). Not timed: ${report.counts.notRan} selected cases where it did not run. Changed output: ${report.counts.outputChanged}. Head-only timed: ${report.headOnly.length}; no base ratio or slowdown verdict.`;
  lines.push('', `${caseSet} Changed code ran during module load: ${report.loadRan ? 'yes (load is not timed; if the change alters data that unchanged code reads, run again with --all-ran)' : 'no'}. Rule: main > ${report.rule.minMs} ms, changed code ran, ratio > ${report.rule.limit} in run 1 and in run 2 (head first, fresh processes).`);
  const rows = report.cases.filter((c) => c.ratio > report.rule.limit || c.confirmed !== undefined);
  const rest = report.cases.filter((c) => !rows.includes(c)).sort((a, b) => b.ratio - a.ratio).slice(0, Math.max(0, 12 - rows.length));
  lines.push('', '| Case | Main ms | Head ms | Ratio | Changed code ran | Output changed | Confirmed |', '| --- | ---: | ---: | ---: | --- | --- | --- |');
  const shown = [...rows.sort((a, b) => (b.confirmed ?? false) - (a.confirmed ?? false) || b.ratio - a.ratio), ...rest].slice(0, 25);
  for (const c of shown) {
    const confirmed = c.confirmed === undefined ? '-' : `${c.confirmed ? 'yes' : 'no'} (${c.confirmRatio.toFixed(3)})`;
    lines.push(`| ${c.key} | ${ms(c.mainMs)} | ${ms(c.headMs)} | ${c.ratio.toFixed(3)} | ${c.ran ? 'yes' : 'no'} | ${c.outputChanged ? 'yes' : 'no'} | ${confirmed} |`);
  }
  if (report.notRan.length) lines.push('', `Not timed, changed code did not run: ${report.notRan.map((c) => c.key).join(', ')}`);
  lines.push('', `${report.cases.length} timed cases in ${report.json}; the table shows up to 25 rows: confirmed cases first, then the highest ratios.`);
  if (report.outputChanged.length) {
    lines.push('', `Changed output (${report.outputChanged.length}), timed with each side's own SVG hash: ${report.outputChanged.slice(0, 20).join(', ')}${report.outputChanged.length > 20 ? ', ...' : ''}`);
  }
  if (report.headOnly.length) {
    lines.push('', '| Head-only case | Head ms | Changed code ran |', '| --- | ---: | --- |');
    for (const c of report.headOnly) lines.push(`| ${c.key} | ${ms(c.headMs)} | ${c.ran ? 'yes' : 'no'} |`);
  }
  if (report.keysOnlyMain?.length) lines.push('', `Only on main, not timed: ${report.keysOnlyMain.join(', ')}`);
  const spread = (values) => `${ms(Math.min(...values))}-${ms(Math.max(...values))}`;
  const flagged = report.cases.filter((c) => c.confirmed !== undefined);
  if (flagged.length) {
    lines.push('', 'Spread of the cases in run 2 (min-max sample ms, main / head):');
    for (const c of flagged) {
      const context = c.confirmed ? `; run-2 ranges overlap: ${overlap(c.samples.confirmMain, c.samples.confirmHead) ? 'yes' : 'no'}` : '';
      lines.push(`- ${c.key}: run 1 ${spread(c.samples.main)} / ${spread(c.samples.head)}; run 2 ${spread(c.samples.confirmMain)} / ${spread(c.samples.confirmHead)}${context}`);
    }
  }
  if (report.slower.length) lines.push('', `Confirmed slower (${report.slower.length}): ${report.slower.slice(0, 30).join(', ')}${report.slower.length > 30 ? ', ...' : ''}`);
  lines.push('', `Run time: ${(report.seconds / 60).toFixed(1)} min.`);
  return `${lines.join('\n')}\n`;
}

async function main() {
  const started = Date.now();
  const options = parseArgs(process.argv.slice(2));
  const repo = git(process.cwd(), 'rev-parse', '--show-toplevel');
  const modules = join(repo, 'node_modules');
  if (!existsSync(join(modules, 'tsx'))) throw new Error(`${modules} has no tsx; run npm ci first`);
  if (options.fetch && options.base.startsWith('origin/')) git(repo, 'fetch', '--quiet', 'origin', options.base.slice('origin/'.length));
  const base = git(repo, 'rev-parse', '--verify', `${options.base}^{commit}`);
  const headRef = git(repo, 'rev-parse', '--verify', `${options.head}^{commit}`);
  const work = options.work ?? join(tmpdir(), `boardplot-speed-${process.pid}`);
  const out = options.out ?? join(work, 'out');
  mkdirSync(out, { recursive: true });
  const report = { status: 'ERROR', tool: git(TOOL_DIR, 'rev-parse', 'HEAD'), base, head: headRef, merged: false, json: join(out, 'speed.json') };
  const roots = { main: join(work, 'main'), head: join(work, 'head') };
  const write = (status, exitCode) => {
    report.status = status;
    report.seconds = (Date.now() - started) / 1000;
    writeFileSync(report.json, `${JSON.stringify(report, null, 2)}\n`);
    const text = markdown(report);
    writeFileSync(join(out, 'speed.md'), text);
    process.stdout.write(text);
    return exitCode;
  };
  // Only checkouts this run created are removed; a checkout that existed before the run is never touched.
  const created = [];
  const cleanup = () => {
    if (options.keep) { log(`kept checkouts in ${work}`); return; }
    for (const root of created.splice(0)) if (existsSync(root)) git(repo, 'worktree', 'remove', '--force', root);
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    for (const worker of liveWorkers) worker.process.kill();
    cleanup();
    process.exit(2);
  });

  try {
    // The head merges base when it does not contain it, so the diff and the timing see only the PR's change.
    let merged = headRef;
    let mergeCheck = true;
    try { git(repo, 'merge-base', '--is-ancestor', base, headRef); } catch { mergeCheck = false; }
    // The skip rule reads the PR's own change: a stale head is compared as the tree of its merge with base.
    let mergedTree = headRef;
    if (!mergeCheck) {
      try { mergedTree = git(repo, 'merge-tree', '--write-tree', base, headRef).split('\n')[0]; } catch (error) {
        throw new Error(`head does not merge cleanly with ${options.base}; merge it first (${error.message.split('\n')[0]})`);
      }
    }
    const reason = skipReason(repo, base, mergedTree);
    if (reason && !options.force) {
      report.skipReason = reason.reason;
      return write(reason.status, 0);
    }
    for (const root of Object.values(roots)) {
      if (existsSync(root)) throw new Error(`${root} already exists; pass a --work folder without main and head`);
    }
    git(repo, 'worktree', 'add', '--quiet', '--detach', roots.main, base);
    created.push(roots.main);
    git(repo, 'worktree', 'add', '--quiet', '--detach', roots.head, headRef);
    created.push(roots.head);
    if (!mergeCheck) {
      log(`head ${headRef.slice(0, 9)} does not contain ${base.slice(0, 9)}; merging it in the temporary checkout`);
      try {
        git(roots.head, '-c', 'user.name=speed-tool', '-c', 'user.email=speed-tool@invalid', 'merge', '--quiet', '--no-edit', base);
      } catch (error) {
        throw new Error(`head does not merge cleanly with ${options.base}; merge it first (${error.message.split('\n')[0]})`);
      }
      merged = git(roots.head, 'rev-parse', 'HEAD');
      report.merged = true;
      report.mergedHead = merged;
    }
    for (const root of Object.values(roots)) symlinkSync(modules, join(root, 'node_modules'), 'dir');
    for (const lock of ['package-lock.json']) {
      if (readFileSync(join(roots.main, lock), 'utf8') !== readFileSync(join(roots.head, lock), 'utf8')) log(`warning: ${lock} differs; both sides use ${modules}`);
    }

    const changed = changedLines(repo, base, merged);
    const changedFile = join(work, 'changed-lines.json');
    writeFileSync(changedFile, JSON.stringify(changed));
    report.changedFiles = Object.keys(changed);
    log(`changed src files: ${report.changedFiles.join(', ') || 'none'}`);

    // Fixed benchmark inputs (c) and caller inputs (d), written once so both sides read the same bytes.
    const { largeInputs } = await import(pathToFileURL(join(INPUT_DIR, 'large.mjs')).href);
    const inputs = [];
    for (const name of ['in-line.json', 'in-combo.json', 'in-cagr.json']) {
      inputs.push({ key: `input/${name.replace(/\.json$/, '')}`, request: JSON.parse(readFileSync(join(INPUT_DIR, name), 'utf8')).request });
    }
    for (const [name, build] of Object.entries(largeInputs)) inputs.push({ key: `input/${name}`, request: build() });
    for (const file of options.inputs) {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      // Two files with the same name get -2, -3 ..., so every case has its own key.
      const name = `extra/${file.split('/').pop().replace(/\.json$/, '')}`;
      let key = name;
      for (let n = 2; inputs.some((input) => input.key === key); n++) key = `${name}-${n}`;
      inputs.push({ key, file, request: parsed.request ?? parsed });
    }
    const inputsFile = join(work, 'inputs.json');
    writeFileSync(inputsFile, JSON.stringify(inputs));

    // Identity pass: one draw per case and side. Main timing here only ranks and screens.
    log('identity pass: rendering every case once per side (head under coverage)');
    const first = await startPair(roots, inputsFile, changedFile, { main: 'time', head: 'cover' });
    if (first.workers.main.keysOnly || first.workers.head.keysOnly) {
      report.keysOnlyMain = first.workers.main.keysOnly;
      report.keysOnlyHead = first.workers.head.keysOnly;
      log(`case sets differ: ${report.keysOnlyMain.length} only on main (not timed), ${report.keysOnlyHead.length} only on head (timed separately)`);
    }
    report.loadRan = first.loadRan;
    const headIndex = new Map(first.headKeys.map((key, i) => [key, i]));
    const mainIndex = new Map(first.mainKeys.map((key, i) => [key, i]));
    // --case: only the named cases, timed whether or not they are slow or among the slowest goldens.
    const picked = options.cases.length ? new Set(options.cases.map((name) => {
      const key = [name, `golden/${name}`].find((k) => headIndex.has(k) || mainIndex.has(k));
      if (!key) throw new Error(`--case ${name}: no such case`);
      return key;
    })) : null;
    const all = [];
    for (const [i, key] of first.mainKeys.entries()) {
      if (!headIndex.has(key) || (picked && !picked.has(key))) continue;
      const [m, h] = await Promise.all([first.workers.main.call({ op: 'first', i }), first.workers.head.call({ op: 'first', i: headIndex.get(key) })]);
      all.push({ key, i, hi: headIndex.get(key), screenMs: m.ms, mainSha: m.sha, headSha: h.sha, same: m.sha === h.sha, ran: options.allRan || h.ran, error: m.error ?? h.error });
      if (all.length % 250 === 0) log(`  ${all.length}/${first.mainKeys.length} cases rendered`);
    }
    const headOnly = [];
    for (const [key, i] of headIndex) {
      if (mainIndex.has(key) || (picked && !picked.has(key))) continue;
      const h = await first.workers.head.call({ op: 'first', i });
      headOnly.push({ key, i, screenMs: h.ms, headSha: h.sha, ran: options.allRan || h.ran, error: h.error });
    }
    await Promise.all([first.workers.main.stop(), first.workers.head.stop()]);
    // A benchmark input that throws is a broken case set, not a result: stop with exit 2.
    const brokenInputs = [...all, ...headOnly].filter((c) => !c.key.startsWith('golden/') && c.error);
    if (brokenInputs.length) throw new Error(`benchmark input failed: ${brokenInputs.map((c) => `${c.key}: ${c.error}`).join('; ')}`);
    report.outputChanged = all.filter((c) => !c.same).map((c) => c.key);
    report.ranCases = all.filter((c) => c.ran).map((c) => c.key);

    // Case set.
    const top = new Set(all.filter((c) => c.key.startsWith('golden/')).sort((a, b) => b.screenMs - a.screenMs).slice(0, options.top).map((c) => c.key));
    // A case can count only where changed code ran, so (b) to (d) cases where it did not run are listed, not timed.
    const listed = all.filter((c) => picked || top.has(c.key) || !c.key.startsWith('golden/'));
    const timed = all.filter((c) => !c.same || (c.ran && (c.screenMs >= options.screenMs || listed.includes(c))));
    report.notRan = listed.filter((c) => c.same && !c.ran).map((c) => ({ key: c.key, mainMs: c.screenMs }));
    report.counts = {
      all: all.length, timed: timed.filter((c) => c.ran).length, outputChanged: report.outputChanged.length,
      top: timed.filter((c) => top.has(c.key)).length, notRan: report.notRan.length,
      inputs: timed.filter((c) => !c.key.startsWith('golden/')).length,
    };
    if (picked) report.picked = [...picked];
    report.rule = { top: options.top, minMs: options.minMs, limit: options.limit, pairs: options.pairs, warmPairs: options.warm, screenMs: options.screenMs };
    log(`timing ${timed.length} cases: ${options.warm} warm-up and ${options.pairs} timed pairs each, main first`);

    // Timing run 1, main first, in fresh processes.
    const timing = await startPair(roots, inputsFile, changedFile, { main: 'time', head: 'time' });
    const asSide = (side) => timed.map((c) => ({ ...c, i: side === 'main' ? c.i : c.hi }));
    // Each side has its own case index; the timing workers get the expected hash for their index.
    for (const c of timed) {
      await timing.workers.main.call({ op: 'expect', i: c.i, sha: c.mainSha });
      await timing.workers.head.call({ op: 'expect', i: c.hi, sha: c.headSha });
    }
    const sided = { main: asSide('main'), head: asSide('head') };
    const runOne = await timedRunSided(timing.workers, sided, options, false);
    report.headOnly = await timedHeadOnly(timing.workers.head, headOnly, options);

    await Promise.all([timing.workers.main.stop(), timing.workers.head.stop()]);

    // Run 2, head first, in fresh processes, for the cases the rule could count.
    const suspects = timed.filter((c) => runOne[c.key].mainMs > options.minMs && runOne[c.key].ratio > options.limit && c.ran);
    let runTwo = {};
    if (suspects.length) {
      log(`confirming ${suspects.length} cases with head first in fresh processes`);
      const confirm = await startPair(roots, inputsFile, changedFile, { main: 'time', head: 'time' });
      for (const c of suspects) {
        await confirm.workers.main.call({ op: 'expect', i: c.i, sha: c.mainSha });
        await confirm.workers.head.call({ op: 'expect', i: c.hi, sha: c.headSha });
      }
      const keys = new Set(suspects.map((c) => c.key));
      runTwo = await timedRunSided(confirm.workers, { main: sided.main.filter((c) => keys.has(c.key)), head: sided.head.filter((c) => keys.has(c.key)) }, options, true);
      await Promise.all([confirm.workers.main.stop(), confirm.workers.head.stop()]);
    }

    // Extra evidence: a confirmed case whose run-2 ranges overlap is timed once more on its own, in
    // fresh processes, main first. The verdict does not read it.
    const alone = {};
    for (const c of suspects.filter((s) => runTwo[s.key].ratio > options.limit && overlap(runTwo[s.key].samples.main, runTwo[s.key].samples.head))) {
      log(`re-timing ${c.key} alone in fresh processes`);
      const single = await startPair(roots, inputsFile, changedFile, { main: 'time', head: 'time' });
      await single.workers.main.call({ op: 'expect', i: c.i, sha: c.mainSha });
      await single.workers.head.call({ op: 'expect', i: c.hi, sha: c.headSha });
      Object.assign(alone, await timedRunSided(single.workers, { main: sided.main.filter((k) => k.key === c.key), head: sided.head.filter((k) => k.key === c.key) }, options, false));
      await Promise.all([single.workers.main.stop(), single.workers.head.stop()]);
    }

    report.cases = timed.map((c) => {
      const one = runOne[c.key], two = runTwo[c.key];
      return {
        key: c.key, mainMs: one.mainMs, headMs: one.headMs, ratio: one.ratio, ran: c.ran, top: top.has(c.key),
        outputChanged: !c.same, mainSha: c.mainSha, headSha: c.headSha,
        drawsPerSample: one.drawsPerSample,
        ...(two ? { confirmed: two.ratio > options.limit, confirmRatio: two.ratio, confirmMainMs: two.mainMs, confirmHeadMs: two.headMs } : {}),
        ...(alone[c.key] ? { alone: { mainMs: alone[c.key].mainMs, headMs: alone[c.key].headMs, ratio: alone[c.key].ratio, samples: alone[c.key].samples } } : {}),
        samples: { main: one.samples.main, head: one.samples.head, ...(two ? { confirmMain: two.samples.main, confirmHead: two.samples.head } : {}) },
      };
    });
    report.slower = report.cases.filter((c) => c.confirmed).map((c) => c.key);
    if (report.slower.length) return write('SLOWER', 1);
    return write(report.counts.timed ? 'PASS' : 'NO EVIDENCE', 0);
  } catch (error) {
    report.error = error.stack ?? error.message;
    return write('ERROR', 2);
  } finally {
    // A failed call leaves the other worker waiting on stdin; stop both so that this process can end.
    await Promise.all([...liveWorkers].map((worker) => worker.stop()));
    cleanup();
  }
}

/** Head-only cases have samples, but no base ratio and no slowdown verdict. */
async function timedHeadOnly(worker, cases, options) {
  const results = [];
  for (const c of cases) {
    await worker.call({ op: 'expect', i: c.i, sha: c.headSha });
    const k = Math.min(5, Math.max(1, Math.ceil(40 / Math.max(c.screenMs, 1))));
    const warm = c.screenMs >= 200 ? 1 : options.warm;
    const samples = [];
    for (let n = 0; n < warm + options.pairs; n++) {
      const { ms } = await worker.call({ op: 'time', i: c.i, k, gc: c.screenMs >= 100 });
      if (n >= warm) samples.push(ms);
    }
    results.push({ key: c.key, headMs: median(samples), headSha: c.headSha, ran: c.ran, drawsPerSample: k, samples });
  }
  return results;
}

/** One timed run over the cases, interleaved per pair; `headFirst` swaps the order inside each pair. */
async function timedRunSided(workers, sided, options, headFirst) {
  const results = {};
  const order = headFirst ? ['head', 'main'] : ['main', 'head'];
  for (let n = 0; n < sided.main.length; n++) {
    const c = sided.main[n];
    const index = { main: c.i, head: sided.head[n].i };
    const k = Math.min(5, Math.max(1, Math.ceil(40 / Math.max(c.screenMs, 1))));
    const gc = c.screenMs >= 100;
    const samples = { main: [], head: [] };
    const warm = c.screenMs >= 200 ? 1 : options.warm;
    for (let pair = 0; pair < warm + options.pairs; pair++) {
      for (const side of order) {
        const { ms } = await workers[side].call({ op: 'time', i: index[side], k, gc });
        if (pair >= warm) samples[side].push(ms);
      }
    }
    const mainMs = median(samples.main), headMs = median(samples.head);
    results[c.key] = { mainMs, headMs, ratio: headMs / mainMs, drawsPerSample: k, samples };
    if ((n + 1) % 25 === 0) log(`  ${n + 1}/${sided.main.length} cases timed`);
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; }, (error) => {
    console.error(`[speed-tool] error: ${error.stack ?? error.message}`);
    process.exitCode = 2;
  });
}
