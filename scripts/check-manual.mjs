#!/usr/bin/env node
/**
 * Runs the code blocks of docs/manual.md, docs/reference/react.md and
 * docs/reference/dimswitch.md against the built package (run `npm run build`
 * first); pass other files to check
 * those instead. A JSON spec goes through `boardplot render`, a JSON
 * `{ name, arguments }` through the MCP server, a sh block through bash with
 * `boardplot` bound to the built CLI, and a tsx or ts block is imported and its exported
 * components rendered to a string. A JSON block that is none of these, or
 * that carries `ok`, is an excerpt of the result above it and has to match
 * that result.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transformSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { renderToString } from 'react-dom/server';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(ROOT, 'dist/cli/index.js');
const SERVER = join(ROOT, 'dist/mcp/server.js');
const FILES = process.argv.length > 2 ? process.argv.slice(2) : ['docs/manual.md', 'docs/reference/react.md', 'docs/reference/dimswitch.md'];
if (!existsSync(CLI)) {
  console.error('check-manual: dist/ is missing: run `npm run build` first.');
  process.exit(1);
}

function blocks(file) {
  const text = readFileSync(isAbsolute(file) ? file : join(ROOT, file), 'utf8');
  return [...text.matchAll(/^```(\w+)\n([\s\S]*?)^```$/gm)].map((match) => ({
    lang: match[1], text: match[2], where: `${file}:${text.slice(0, match.index).split('\n').length}`,
  }));
}

/** An excerpt matches when every key it shows has the same value in the result. */
function contains(actual, excerpt) {
  if (excerpt === null || typeof excerpt !== 'object') return Object.is(actual, excerpt);
  if (actual === null || typeof actual !== 'object' || Array.isArray(actual) !== Array.isArray(excerpt)) return false;
  return Object.keys(excerpt).every((key) => Object.hasOwn(actual, key) && contains(actual[key], excerpt[key]));
}

function lastJson(stdout) {
  const lines = stdout.trim().split('\n').filter(Boolean);
  return lines.map((line) => JSON.parse(line)).at(-1);
}

function cli(args, input, cwd) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, input, encoding: 'utf8' });
  return lastJson(result.stdout);
}

/**
 * Every `boardplot` call records its exit status. Any command but the last has
 * to exit 0 and print ok true; the last one's status has to agree with its
 * ok, and the caller checks that result like any other. Other commands run
 * under `set -euo pipefail`.
 */
function shell(script, cwd) {
  const status = join(cwd, 'status');
  rmSync(status, { force: true });
  const prelude = `set -euo pipefail\nboardplot() { local code=0; node "${CLI}" "$@" || code=$?; echo "$code" >> "${status}"; }\n`;
  const result = spawnSync('bash', ['-c', `${prelude}${script}`], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`the block exited ${result.status}: ${result.stderr.trim()}`);
  const codes = existsSync(status) ? readFileSync(status, 'utf8').trim().split('\n').map(Number) : [];
  const outputs = result.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  if (codes.length === 0 || codes.length !== outputs.length) throw new Error(`${codes.length} boardplot commands printed ${outputs.length} JSON objects`);
  codes.forEach((code, index) => {
    const last = index === codes.length - 1;
    if (!last && (code !== 0 || outputs[index].ok !== true)) throw new Error(`command ${index + 1} of ${codes.length} exited ${code}: ${JSON.stringify(outputs[index]).slice(0, 300)}`);
    if (last && (code === 0) !== (outputs[index].ok === true)) throw new Error(`the last command exited ${code} with ok ${outputs[index].ok}`);
  });
  return outputs.at(-1);
}

function mcp(call) {
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'check-manual', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: call },
  ];
  const result = spawnSync(process.execPath, [SERVER], { input: `${requests.map((entry) => JSON.stringify(entry)).join('\n')}\n`, encoding: 'utf8' });
  const response = result.stdout.trim().split('\n').map((line) => JSON.parse(line)).find((entry) => entry.id === 2);
  return response.result.structuredContent;
}

async function component(block, scratch, index) {
  const { code } = transformSync(block.text, { loader: block.lang, jsx: 'automatic', format: 'esm' });
  const file = join(scratch, `block-${index}.mjs`);
  writeFileSync(file, code);
  const module = await import(pathToFileURL(file).href);
  const rendered = [];
  for (const Component of Object.values(module).filter((value) => typeof value === 'function')) {
    // An async component is a server component (it awaits prepareChart): it
    // runs once, as a React Server Components host runs it, and its element is drawn.
    const element = Component.constructor.name === 'AsyncFunction' ? await Component() : createElement(Component);
    // BoardplotChart links a chart engine on demand and draws the busy
    // placeholder in a server pass, so a busy component is mounted in a
    // browser and read once its chunks are there, as a reader's browser does.
    const html = renderToString(element);
    rendered.push(/data-bp-loading/.test(html) ? await drawInBrowser(element) : html);
  }
  if (rendered.some((html) => !/<svg|<table/.test(html))) throw new Error('a component rendered no chart');
  return { ok: true };
}

/** A browser for the components that load their chart engine on demand. */
function browser() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  for (const name of ['window', 'document', 'navigator', 'requestAnimationFrame', 'cancelAnimationFrame',
    'Node', 'Element', 'HTMLElement', 'SVGElement', 'DocumentFragment', 'Event', 'CustomEvent', 'MutationObserver',
    'getComputedStyle', 'DOMParser', 'ResizeObserver']) {
    if (dom.window[name] !== undefined && globalThis[name] === undefined) globalThis[name] = dom.window[name];
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return dom.window.document;
}

async function drawInBrowser(element) {
  const { createRoot } = await import('react-dom/client');
  const page = globalThis.document ?? browser();
  const host = page.createElement('div');
  page.body.append(host);
  let root;
  await act(async () => { root = createRoot(host); root.render(element); });
  const deadline = Date.now() + 30_000;
  while (host.querySelector('[data-bp-loading]') && Date.now() < deadline) {
    await act(async () => { await new Promise((settled) => { setTimeout(settled, 20); }); });
  }
  const html = host.innerHTML;
  await act(async () => { root.unmount(); });
  host.remove();
  return html;
}

async function run(block, scratch, index) {
  if (block.lang === 'sh') return shell(block.text, scratch);
  if (block.lang === 'tsx' || block.lang === 'ts') return component(block, scratch, index);
  const value = JSON.parse(block.text);
  if (typeof value.name === 'string' && value.arguments) return mcp(value);
  if (value.type && value.data && !Object.hasOwn(value, 'ok')) return cli(['render', '-'], block.text, scratch);
  return undefined;
}

async function main() {
  // Inside the repository, so `boardplot/...` resolves to this package's own exports.
  const scratch = mkdtempSync(join(ROOT, '.check-manual-'));
  const failures = [];
  let checked = 0;
  try {
    for (const file of FILES) {
      let previous;
      for (const [index, block] of blocks(file).entries()) {
        checked += 1;
        try {
          const result = await run(block, scratch, index);
          if (result === undefined) {
            if (!previous) failures.push(`${block.where}: excerpt without a passing block above it`);
            else if (!contains(previous.result, JSON.parse(block.text))) {
              failures.push(`${block.where}: excerpt differs from the result above it: ${JSON.stringify(previous.result).slice(0, 1500)}`);
            }
            previous = undefined;
            continue;
          }
          if (previous && previous.result.ok !== true) failures.push(`${previous.where}: returned ok ${previous.result.ok}`);
          previous = { result, where: block.where };
        } catch (error) {
          failures.push(`${block.where}: ${error instanceof Error ? error.message : String(error)}`);
          previous = undefined;
        }
      }
      if (previous && previous.result.ok !== true) failures.push(`${previous.where}: returned ok ${previous.result.ok}`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  for (const failure of failures) console.error(failure);
  console.log(`check-manual: ${checked} code blocks, ${failures.length} failed`);
  return failures.length === 0 ? 0 : 1;
}

process.exitCode = await main();
