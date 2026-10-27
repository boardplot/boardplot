#!/usr/bin/env node
/**
 * Measure reference strings in headless Chrome and regenerate
 * tests/core/fixtures/chrome-text-widths.jsonl, the fixture that
 * tests/core/text-metrics.test.ts reads to check the DOM-free measurer.
 *
 *   node scripts/measure-in-chrome.mjs            rewrite tests/core/fixtures/chrome-text-widths.jsonl
 *
 * Needs Google Chrome (BOARDPLOT_CHROME_PATH overrides the default location).
 * Canvas measureText is the browser's own shaping, kerning included, so the
 * engine's table-based estimate is expected to land a hair above it.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'tests', 'core', 'fixtures', 'chrome-text-widths.jsonl');

const STRINGS = [
  'Jan 25', 'Feb 25', 'Mar 25', 'May 25', 'Nov 25', 'Dec 25',
  'Price realisation', 'Volume growth core markets', 'Nordrhein-Westfalen', 'Mecklenburg-Vorpommern',
  'EBIT grew 5.6% p.a., driven almost entirely by pricing',
  '−131.5', '1,284.6', '+142.8', 'Addressable market', 'Discounted cash flow',
  'Q1 AC', 'FY27F', '12,345.67', 'ARR',
];
// Arial only: the fixture is committed, and Boardplot ships no Helvetica Neue
// widths (docs/FONTS.md). Arial checks the Liberation Sans rows.
const FONTS = [
  ['Arial', 12, 400],
  ['Arial', 12, 700],
  ['Arial', 13, 400],
  ['Arial', 18, 700],
];

const chrome =
  process.env.BOARDPLOT_CHROME_PATH ??
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
if (!chrome) {
  console.error('Google Chrome not found; set BOARDPLOT_CHROME_PATH');
  process.exit(2);
}

const html = `<!doctype html><html><body><pre id="out"></pre><script>
const labels = ${JSON.stringify(STRINGS)};
const fonts = ${JSON.stringify(FONTS)};
const c = document.createElement('canvas').getContext('2d');
const out = [];
for (const [fam, size, w] of fonts) {
  c.font = w + ' ' + size + 'px ' + fam;
  for (const l of labels) out.push(JSON.stringify({ fam, size, w, l, width: c.measureText(l).width }));
}
document.getElementById('out').textContent = out.join('\\n');
</script></body></html>`;

const dir = mkdtempSync(join(tmpdir(), 'boardplot-measure-'));
const page = join(dir, 'measure.html');
writeFileSync(page, html);
const dom = execFileSync(chrome, ['--headless=new', '--disable-gpu', '--dump-dom', `file://${page}`], { encoding: 'utf8' });
rmSync(dir, { recursive: true, force: true });
const match = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/);
if (!match) throw new Error('no measurements in the page output');
const lines = match[1]
  .replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&')
  .split('\n')
  .filter((l) => l.startsWith('{'));
writeFileSync(OUT, `${lines.join('\n')}\n`);
console.log(`wrote ${OUT} (${lines.length} measurements)`);
