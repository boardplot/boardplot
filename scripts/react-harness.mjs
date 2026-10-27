#!/usr/bin/env node
/**
 * React harness: one spec in BoardplotChart in a real browser, to reproduce
 * React-only behaviour (hover, the grid transition, measured sizes).
 *
 *   node scripts/react-harness.mjs <spec.json | -> [--out <dir>] [--width <px>]
 *
 * It bundles src/react/spec.tsx with esbuild (no build needed) and writes
 * <dir>/index.html (default artifacts/react-harness/, gitignored). Open the file
 * in a browser; no server is needed. The page logs every onWarnings and
 * onRefused call to the console and to the log under the chart, and keeps them
 * in `window.boardplotLog` for a script to read.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' }, width: { type: 'string', default: '720' } } });
if (positionals.length !== 1) {
  console.error('Usage: node scripts/react-harness.mjs <spec.json | -> [--out <dir>] [--width <px>]');
  process.exit(2);
}
const spec = JSON.parse(readFileSync(positionals[0] === '-' ? 0 : positionals[0], 'utf8'));
const out = resolve(values.out ?? join(repo, 'artifacts', 'react-harness'));
const width = Number(values.width);

const client = `
import { createRoot } from 'react-dom/client';
import './src/core/geo/packs/all.ts';
import { BoardplotChart } from './src/react/spec.tsx';
const spec = JSON.parse(document.getElementById('spec').textContent);
const log = (window.boardplotLog = []);
const record = (kind, payload) => {
  log.push({ kind, payload });
  console.log('[boardplot] ' + kind, payload);
  document.getElementById('log').textContent = log.map((entry) => entry.kind + ' ' + JSON.stringify(entry.payload, null, 2)).join('\\n');
};
createRoot(document.getElementById('chart')).render(
  <BoardplotChart spec={spec} hover onWarnings={(warnings) => record('onWarnings', warnings)} onRefused={(result) => record('onRefused', result)} />,
);`;

mkdirSync(out, { recursive: true });
const bundle = await build({
  stdin: { contents: client, loader: 'jsx', resolveDir: repo },
  bundle: true,
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  write: false,
  logLevel: 'error',
});
const script = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const json = JSON.stringify(spec).replace(/</g, '\\u003c');
writeFileSync(join(out, 'index.html'), `<!doctype html>
<meta charset="utf-8">
<title>Boardplot React harness</title>
<style>body { margin: 16px; font: 13px system-ui, sans-serif; } #chart { width: ${width}px; } #log { white-space: pre-wrap; }</style>
<div id="chart"></div>
<h2>onWarnings and onRefused</h2>
<pre id="log">(no calls yet)</pre>
<script type="application/json" id="spec">${json}</script>
<script>${script}</script>
`);
console.log(join(out, 'index.html'));
