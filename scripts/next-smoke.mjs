#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
if (args[0] !== '--tarball' || !args[1] || (args.length !== 2 && (args.length !== 4 || args[2] !== '--artifacts'))) {
  throw new Error('usage: node scripts/next-smoke.mjs --tarball <package.tgz> [--artifacts <empty-directory>]');
}
const tarball = resolve(args[1]);
if (!existsSync(tarball)) throw new Error(`Missing package: ${tarball}`);
const kept = args[3] && resolve(args[3]);
if (kept && existsSync(kept) && readdirSync(kept).length) throw new Error('Next artifacts directory must be empty.');
const directory = kept || mkdtempSync(join(tmpdir(), 'boardplot-next-'));
mkdirSync(directory, { recursive: true });
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let server;

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd: directory, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.error ?? result.stderr}\n${result.stdout}`);
  return result.stdout;
}

async function availablePort() {
  const socket = createServer();
  await new Promise((done, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', done); });
  const port = socket.address().port;
  await new Promise(done => socket.close(done));
  return port;
}

try {
  cpSync(join(root, 'tests/next-app'), directory, {
    recursive: true, filter: path => !/(?:^|[/\\])(?:node_modules|\.next|package-lock\.json)(?:$|[/\\])/.test(path),
  });
  run(npm, ['install', '--no-save', '--package-lock=false', '--ignore-scripts', '--no-audit', '--no-fund', tarball]);
  writeFileSync(join(directory, 'build.log'), run(npm, ['run', 'build']));
  const port = await availablePort();
  let output = '';
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: directory, env });
  server.stdout.on('data', chunk => { output += chunk; });
  server.stderr.on('data', chunk => { output += chunk; });
  let html;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Next stopped before serving the page:\n${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new Error(`Next returned ${response.status}: ${await response.text()}`);
      html = await response.text(); break;
    } catch (error) {
      if (error.message.startsWith('Next returned')) throw error;
      await new Promise(done => setTimeout(done, 250));
    }
  }
  if (!html) throw new Error(`Next did not respond within 60 seconds:\n${output}`);
  // The table is a CSS grid of ARIA roles, not a <table>: the
  // server pass prints `role="grid"` or `role="treegrid"` on `.bp-table-grid` with the row and
  // cell roles under it. data-bp-loading: the spec entry links no chart
  // engine, so its server pass is the busy placeholder and the chart
  // attaches once the chunk is there.
  for (const pattern of [
    /<svg\b/, /<div[^>]+role="(?:grid|treegrid)"/, /class="[^"]*\bbp-table-grid\b/, /role="rowheader"/,
    /<style[^>]*data-bp-table-theme/, /data-bp-engine=/, /data-bp-chart="column"/, /data-bp-loading/,
  ]) {
    if (!pattern.test(html)) throw new Error(`Next server output is missing ${pattern}`);
  }
  writeFileSync(join(directory, 'server.html'), html);
  const nextVersion = JSON.parse(readFileSync(join(directory, 'node_modules/next/package.json'), 'utf8')).version;
  const reactVersion = JSON.parse(readFileSync(join(directory, 'node_modules/react/package.json'), 'utf8')).version;
  console.log(
    `PASS Next server/client build and initial SVG and table-grid output next=${nextVersion} react=${reactVersion} node=${process.version}` +
      `${kept ? `; artifacts: ${kept}` : ''}`,
  );
} finally {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(done => server.once('exit', done)); }
  if (!kept) rmSync(directory, { recursive: true, force: true });
}
