#!/usr/bin/env node
// Starts Boardplot for this plugin.
//
//   node <plugin root>/scripts/boardplot.mjs mcp          the MCP server
//   node <plugin root>/scripts/boardplot.mjs <verb> ...   the CLI
//
// The offline ZIP bundles the runtime under <plugin root>/runtime and this
// launcher runs it. Otherwise the launcher installs the npm package below
// once into a Boardplot cache folder and runs it from there. npm runs with
// that folder as its working folder, so it never reads the .npmrc of the
// workspace the host started in; the user's own npm config still applies.
// Boardplot itself runs in the caller's working folder, so relative paths
// keep working.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The exact package this plugin version runs. scripts/plugin-version.mjs in
// the Boardplot repository writes it from package.json; do not edit by hand.
const PACKAGE = 'boardplot@0.54.0';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const [mode, ...rest] = process.argv.slice(2);
if (!mode) {
  console.error('Usage: node <plugin root>/scripts/boardplot.mjs mcp | <boardplot verb> [arguments]');
  process.exit(2);
}
const bin = mode === 'mcp' ? 'boardplot-mcp' : 'boardplot';
const args = mode === 'mcp' ? rest : [mode, ...rest];

function cacheFolder() {
  const base = process.platform === 'win32'
    ? process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    : process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(base, 'boardplot', 'plugin-runtime', PACKAGE.replace(/[^\w.@-]/g, '_'));
}

function installedPackage(folder) {
  const path = join(folder, 'node_modules', 'boardplot', 'package.json');
  if (!existsSync(path)) return null;
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  const pinned = /^boardplot@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(PACKAGE)?.[1];
  if (manifest.name !== 'boardplot' || (pinned && manifest.version !== pinned)) return null;
  return manifest;
}

function install(folder) {
  // Install into a fresh folder and rename it into place, so a broken or
  // concurrent install never leaves a half-filled cache behind.
  const staging = `${folder}.staging-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  // A package.json makes this folder npm's project root, so npm looks for a
  // project .npmrc here (there is none) and not in the caller's folders.
  writeFileSync(join(staging, 'package.json'), '{ "private": true }\n');
  const windows = process.platform === 'win32';
  const result = spawnSync(windows ? 'npm.cmd' : 'npm', [
    'install', PACKAGE, '--no-save', '--no-package-lock', '--no-audit', '--no-fund', '--ignore-scripts', '--loglevel=error',
  ], { cwd: staging, shell: windows, stdio: ['ignore', 2, 2] });
  if (result.status !== 0 || !installedPackage(staging)) {
    rmSync(staging, { recursive: true, force: true });
    const reason = result.error ? result.error.message : `npm exited with ${result.status}`;
    console.error(`Boardplot: could not install ${PACKAGE} (${reason}). Check that npm reaches its registry, or use the offline ZIP.`);
    process.exit(1);
  }
  try {
    renameSync(staging, folder);
  } catch (error) {
    // Another start finished first; its copy is as good as this one.
    rmSync(staging, { recursive: true, force: true });
    if (!installedPackage(folder)) throw error;
  }
}

function entry() {
  const bundled = join(root, 'runtime', 'dist', mode === 'mcp' ? 'mcp/server.js' : 'cli/index.js');
  if (existsSync(bundled)) return bundled;
  const folder = cacheFolder();
  if (!installedPackage(folder)) {
    mkdirSync(dirname(folder), { recursive: true });
    install(folder);
  }
  const packageRoot = join(folder, 'node_modules', 'boardplot');
  const manifest = installedPackage(folder);
  return join(packageRoot, manifest.bin[bin]);
}

const target = entry();
// Run the entry in this process, as if Node had started it directly.
process.argv = [process.argv[0], target, ...args];
await import(pathToFileURL(target).href);
