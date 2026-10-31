/**
 * `boardplot render --format png`: resvg when installed, else
 * headless Chrome, else the SVG with a no-rasterizer warning. Each raster
 * case is skipped where its rasterizer is missing; the refusals and the SVG
 * fallback are checked everywhere.
 */
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/core/charts';
import { getFixtures } from '../src/fixtures';
import { main } from '../src/cli/main';
import { availableRasterizer, completePng, pngSize, rasterize, uncoveredCharacters } from '../src/cli/raster';
import { glyphFallbackFamily, installedFamilies, loadResvg, rasterFamily, rasterizeWithResvg } from '../src/cli/resvg';

// The fallback case needs a machine without resvg; the mock hides it on demand.
const hideResvg = vi.hoisted(() => ({ value: false }));
vi.mock('../src/cli/resvg', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cli/resvg')>();
  return { ...actual, loadResvg: () => (hideResvg.value ? null : actual.loadResvg()) };
});

const resvg = loadResvg();
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function runCli(args: string[]): { code: number; log: string[]; error: string[] } {
  const log: string[] = [];
  const error: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...v) => log.push(v.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...v) => error.push(v.join(' ')));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const code = main(args);
  vi.restoreAllMocks();
  return { code, log, error };
}

function docWithColumn(): string {
  const dir = mkdtempSync(join(tmpdir(), 'boardplot-png-test-'));
  dirs.push(dir);
  const fixture = getFixtures('column').find((f) => f.id === 'stacked-revenue-cagr') ?? getFixtures('column')[0]!;
  const doc = {
    version: 1,
    charts: [
      {
        name: 'revenue',
        type: 'column',
        data: fixture.data,
        // Report type needs 720 x 406 for this chart; 800 x 450 draws.
        options: { ...fixture.options, size: { width: 800, height: 450 } },
        ...(fixture.annotations ? { annotations: fixture.annotations } : {}),
      },
    ],
  };
  const path = join(dir, 'doc.json');
  writeFileSync(path, JSON.stringify(doc));
  return path;
}

describe('render --format png', () => {
  it('needs an output directory and a scale within bounds', () => {
    const doc = docWithColumn();
    const noOut = runCli(['render', doc, '--format', 'png']);
    expect(noOut.code).toBe(1);
    expect(JSON.parse(noOut.log.join('\n')).errors[0].code).toBe('png-needs-out');
    const tooLarge = runCli(['render', doc, '--format', 'png', '--scale', '9', '--out', join(doc, '..', 'out')]);
    expect(tooLarge.code).toBe(1);
    expect(JSON.parse(tooLarge.log.join('\n')).errors[0]).toMatchObject({ code: 'invalid-argument', path: '/scale' });
  });

  // A 1000000 x 1000000 px canvas made resvg abort the whole process, and the MCP server with it.
  it('refuses a PNG above the pixel limit before any rasterizer runs', () => {
    const doc = docWithColumn();
    const huge = runCli(['render', doc, '--format', 'png', '--width', '1000000', '--height', '1000000', '--out', join(doc, '..', 'out')]);
    expect(huge.code).toBe(1);
    expect(JSON.parse(huge.log.join('\n')).errors[0]).toMatchObject({ code: 'png-too-large', path: '/format' });
  });

  it.skipIf(!resvg)('rasterises through resvg at the chart size times the scale', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"><rect width="300" height="200" fill="#10529E"/><text x="10" y="40" font-size="20">Revenue</text></svg>';
    const png = rasterize([{ svg, size: { width: 300, height: 200 }, fontFamily: "'Helvetica Neue', Arial, sans-serif" }], 2, 'resvg').pngs![0]!;
    expect(pngSize(png)).toEqual({ width: 600, height: 400 });
    // 192 dpi in pHYs, so Office places the scale-2 PNG at 300 x 200.
    const phys = png.indexOf('pHYs');
    expect([png.readUInt32BE(phys + 4), png.readUInt32BE(phys + 8), png[phys + 12]]).toEqual([7559, 7559, 1]);
  });

  it.skipIf(!resvg || !existsSync('/System/Library/Fonts/HelveticaNeue.ttc'))('keeps surrounding PNG letters in their face when a symbol needs fallback', () => {
    const font = { loadSystemFonts: false, fontFiles: [
      '/System/Library/Fonts/HelveticaNeue.ttc', '/System/Library/Fonts/Supplemental/Arial.ttf',
      '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/Supplemental/STIXGeneral.otf',
      '/System/Library/Fonts/Supplemental/STIXGeneralBol.otf',
    ] };
    let prepared = '';
    const capture = { Resvg: class {
      constructor(svg: string) { prepared = svg; }
      render() { return { asPng: () => new resvg!.Resvg(prepared, { font }).render().asPng() }; }
    } };
    const document = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="120" font-family="Helvetica Neue"><defs><clipPath id="prefix"><rect width="38" height="120"/></clipPath></defs>${body}</svg>`;
    for (const weight of [400, 700]) {
      const text = (body: string) => `<text x="10" y="45" font-size="30" font-weight="${weight}" clip-path="url(#prefix)">${body}</text>`;
      const expected = new resvg!.Resvg(document(text('III')), { font }).render().asPng();
      for (const symbol of ['→', '↗', '↘']) {
        const actual = rasterizeWithResvg(capture, document(text(`III ${symbol} III † − – —`)), 500, 1, 'Helvetica Neue');
        expect(actual.equals(expected), `${weight} ${symbol}: prefix pixels`).toBe(true);
        expect(prepared).toContain(`font-family="${symbol === '→' ? 'Arial' : 'STIXGeneral'}"`);
      }
    }
    const whitespaceLine = (gap: string) => document(`<text x="10" y="45" font-size="30">III${gap}→B</text>`);
    const plainSpace = rasterizeWithResvg(capture, whitespaceLine(' '), 500, 1, 'Helvetica Neue');
    for (const gap of ['&#9;', '&#10;', '&#13;', '&#9;&#9;', '  &#9;&#10;&#13;  ']) {
      expect(rasterizeWithResvg(capture, whitespaceLine(gap), 500, 1, 'Helvetica Neue').equals(plainSpace)).toBe(true);
    }
    expect(glyphFallbackFamily(0x2197, new Set(['dejavu sans']))).toBeNull();
    expect(glyphFallbackFamily(0x2192, new Set(['arial']))).toBe('Arial');
    // End/middle anchors and styled/multiline spans must keep the same left edge.
    for (const anchor of ['end', 'middle']) {
      const body = `<text x="250" y="40" text-anchor="${anchor}" font-size="20" font-weight="400" letter-spacing="0.2"><tspan>III </tspan><tspan font-weight="700">→</tspan><tspan> III †</tspan></text>`;
      rasterizeWithResvg(capture, document(body), 500, 1, 'Helvetica Neue');
      expect(prepared).toMatch(/font-weight="700" font-family="Arial" x="[\d.]+" text-anchor="start">→/);
      const positions = [...prepared.matchAll(/<tspan[^>]* x="([\d.]+)"/g)].map(match => Number(match[1]));
      expect(positions).toHaveLength(3);
      expect(positions[1]! - positions[0]!).toBeCloseTo(21.9, 2);
      expect(positions[2]! - positions[1]!).toBeCloseTo(20.2, 2);
    }
    rasterizeWithResvg(capture, document('<text x="10" y="40" font-size="20"><tspan x="10" dy="0">III →</tspan><tspan x="10" dy="24">III ↗</tspan></text>'), 500, 1, 'Helvetica Neue');
    expect(prepared).toContain('<tspan dy="24"><tspan x="10" text-anchor="start">III </tspan>');
    const dagger = document('<text x="10" y="40" font-size="20">† − – — n/a</text>');
    rasterizeWithResvg(capture, dagger, 500, 1, 'Helvetica Neue');
    expect(prepared).toBe(dagger);
    expect(new resvg!.Resvg(dagger, { font }).toString()).toContain('<path');
    expect(uncoveredCharacters('† − – — n/a ←↑→↓↗↘', 'Helvetica Neue, Arial')).toEqual([]);
  });

  it.skipIf(!resvg || !existsSync('/System/Library/Fonts/Supplemental/STIXGeneral.otf'))('draws all fallback arrows at text size with their true advances and space gaps', () => {
    const font = { loadSystemFonts: false, fontFiles: [
      '/System/Library/Fonts/HelveticaNeue.ttc', '/System/Library/Fonts/Supplemental/Arial.ttf',
      '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/Supplemental/STIXGeneral.otf',
      '/System/Library/Fonts/Supplemental/STIXGeneralBol.otf',
    ] };
    let prepared = '';
    const capture = { Resvg: class {
      constructor(svg: string) { prepared = svg; }
      render() { return { asPng: () => new resvg!.Resvg(prepared, { font }).render().asPng() }; }
    } };
    for (const weight of [400, 700]) for (const size of [12, 24]) for (const arrow of '←↑→↓↗↘') {
      const doc = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80" font-family="Helvetica Neue"><text x="10" y="45" font-size="${size}" font-weight="${weight}">${body}</text></svg>`;
      rasterizeWithResvg(capture, doc(arrow), 200, 1, 'Helvetica Neue');
      const rendered = new resvg!.Resvg(prepared, { font }).render() as unknown as { pixels: Uint8Array };
      const pixels = rendered.pixels;
      const ys: number[] = [];
      for (let y = 0; y < 80; y++) for (let x = 0; x < 200; x++) {
        if (pixels[(y * 200 + x) * 4 + 3]! > 16) ys.push(y);
      }
      const inkHeight = Math.max(...ys) - Math.min(...ys) + 1;
      expect(inkHeight, `${arrow} ${size}/${weight}: visible arrow height`).toBeGreaterThanOrEqual(size * ('←→'.includes(arrow) ? 0.25 : 0.70));
      expect(inkHeight).toBeLessThanOrEqual(size);
      rasterizeWithResvg(capture, doc(`III ${arrow} III`), 200, 1, 'Helvetica Neue');
      const positions = [...prepared.matchAll(/<tspan[^>]* x="([\d.]+)"/g)].map(match => Number(match[1]));
      const advance = '↗↘'.includes(arrow) ? (weight === 700 ? 0.977 : 0.926) : '←→'.includes(arrow) ? 1 : 0.5;
      expect(positions[2]! - positions[1]!).toBeCloseTo(size * advance, 2);
      expect(prepared).toMatch(/>III <\/tspan>/);
      expect(prepared).toMatch(/> III<\/tspan>/);
    }
  });

  it.skipIf(!resvg || !existsSync('/System/Library/Fonts/HelveticaNeue.ttc'))('positions split glyphs with shaped advances and preserves end anchors', () => {
    const font = { loadSystemFonts: false, fontFiles: [
      '/System/Library/Fonts/HelveticaNeue.ttc', '/System/Library/Fonts/Supplemental/Arial.ttf',
    ] };
    let prepared = '';
    const capture = { Resvg: class {
      constructor(svg: string) { prepared = svg; }
      render() { return { asPng: () => new resvg!.Resvg(prepared, { font }).render().asPng() }; }
    } };
    const document = (attrs: string, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="80" font-family="Helvetica Neue"><text y="45" font-size="30" ${attrs}>${body}</text></svg>`;
    // Helvetica Neue shapes AVATAR + space to 114.48 px, not the 122.76 px glyph sum.
    for (const [prefix, spacing, advance, endStart] of [['AVATAR', 0, 114.48, 84.97], ['office', 0.2, 82.75, 116.30], ['A\u0301', 0.2, 28.18, 170.87]] as const) {
      for (const [anchor, x, start] of [['start', 10, 10], ['end', 250, endStart]] as const) {
        const expected = new resvg!.Resvg(document(`x="${start}" letter-spacing="${spacing}"`,
          `${prefix} <tspan x="${start + advance}" font-family="Arial">→</tspan><tspan x="${start + advance + 30 + spacing}">B</tspan>`), { font }).render().asPng();
        for (const gap of [' ', '&#9;&#9;']) {
          const actual = rasterizeWithResvg(capture, document(`x="${x}" text-anchor="${anchor}" letter-spacing="${spacing}"`, `${prefix}${gap}→B`), 500, 1, 'Helvetica Neue');
          expect(actual.equals(expected), `${prefix} ${anchor} ${gap}: shaped PNG`).toBe(true);
          const positions = [...prepared.matchAll(/<tspan[^>]* x="([\d.]+)"/g)].map(match => Number(match[1]));
          expect(positions).toEqual([start, Number((start + advance).toFixed(3)), Number((start + advance + 30 + spacing).toFixed(3))]);
        }
      }
    }
  });

  it.skipIf(!resvg || !existsSync('/System/Library/Fonts/HelveticaNeue.ttc'))('keeps the old PNG for unverified theme fonts and unrelated symbols', () => {
    const font = { loadSystemFonts: false, fontFiles: [
      '/System/Library/Fonts/HelveticaNeue.ttc', '/System/Library/Fonts/Supplemental/Arial.ttf',
    ] };
    let prepared = '';
    const capture = { Resvg: class {
      constructor(svg: string) { prepared = svg; }
      render() { return { asPng: () => new resvg!.Resvg(prepared, { font }).render().asPng() }; }
    } };
    for (const [family, text] of [['Geist', 'AVATAR →B'], ['Unverified, Helvetica Neue', 'AVATAR →B'], ['Helvetica Neue', 'III ▲ III'], ['Helvetica Neue', '\u0301 →B']]) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="80" font-family="${family}"><text x="10" y="45" font-size="30">${text}</text></svg>`;
      const expected = new resvg!.Resvg(svg, { font }).render().asPng();
      expect(rasterizeWithResvg(capture, svg, 500, 1, family!).equals(expected), `${family}: old PNG`).toBe(true);
      expect(prepared).toBe(svg);
    }
  });

  it('draws resvg text with an installed family and names glyphs the theme font lacks ', () => {
    const stack = "'Helvetica Neue', Arial, sans-serif";
    expect(rasterFamily(stack, null)).toBe('Helvetica Neue');
    expect(rasterFamily(stack, new Set(['dejavu sans', 'arial']))).toBe('Arial');
    expect(rasterFamily(stack, new Set(['dejavu sans', 'liberation sans']))).toBe('Liberation Sans');
    expect(rasterFamily(stack, new Set(['courier']))).toBeNull();
    expect(uncoveredCharacters('Umsatz 🚀 日本 € −5 %', stack)).toEqual(['🚀', '日', '本']);
  });

  it.skipIf(!availableRasterizer())('writes a PNG of the chart size times --scale', () => {
    const doc = docWithColumn();
    const dir = join(doc, '..');
    const result = runCli(['render', doc, '--out', join(dir, 'one'), '--format', 'png', '--scale', '1']);
    expect(result.error.at(-1)).toBe(`Wrote ${join(dir, 'one', 'revenue.png')}`);
    expect(result.code).toBe(0);
    expect(pngSize(readFileSync(join(dir, 'one', 'revenue.png')))).toEqual({ width: 800, height: 450 });

    const twice = runCli(['render', doc, '--out', join(dir, 'two'), '--format', 'png', '--scale', '2']);
    expect(twice.code).toBe(0);
    expect(pngSize(readFileSync(join(dir, 'two', 'revenue.png')))).toEqual({ width: 1600, height: 900 });
  }, 60_000);

  it('falls back to SVG with a no-rasterizer warning when nothing can rasterise', () => {
    const doc = docWithColumn();
    const previous = process.env.BOARDPLOT_CHROME_PATH;
    process.env.BOARDPLOT_CHROME_PATH = join(doc, '..', 'no-such-chrome');
    hideResvg.value = true;
    try {
      const result = runCli(['render', doc, '--out', join(doc, '..', 'fallback'), '--format', 'png']);
      const body = JSON.parse(result.log.join('\n'));
      expect(result.code).toBe(0);
      expect(body.warnings.map((warning: { code: string }) => warning.code)).toContain('no-rasterizer');
      expect(body.warnings.find((warning: { code: string }) => warning.code === 'no-rasterizer').message)
        .toBe('PNG needs @resvg/resvg-js (npm i @resvg/resvg-js) or Chrome; returning SVG only');
      expect(body.charts[0].svg).toMatch(/^<svg/);
      expect(body.outputs).toEqual([join(doc, '..', 'fallback', 'revenue.svg')]);
    } finally {
      hideResvg.value = false;
      if (previous === undefined) delete process.env.BOARDPLOT_CHROME_PATH;
      else process.env.BOARDPLOT_CHROME_PATH = previous;
    }
  });

  // A stand-in for Chrome under load: it writes a whole PNG of the window
  // times the scale, says so, then exits 2 as Chrome does when its teardown
  // watchdog expires. 'no-file' writes nothing, 'truncated' half the file.
  const FAKE_CHROME = `#!/usr/bin/env node
const { appendFileSync, writeFileSync } = require('node:fs');
const { deflateSync } = require('node:zlib');
const arg = (name) => process.argv.find((a) => a.startsWith('--' + name + '=')).slice(name.length + 3);
appendFileSync(process.env.FAKE_CHROME_LOG, 'run\\n');
const [w, h] = arg('window-size').split(',').map(Number);
const scale = Number(arg('force-device-scale-factor'));
const width = Math.round(w * scale), height = Math.round(h * scale);
const crc = (bytes) => { let c = ~0; for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return ~c >>> 0; };
const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type, 'ascii'), data]); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc(height * (1 + width * 4)))), chunk('IEND', Buffer.alloc(0))]);
const mode = process.env.FAKE_CHROME_MODE;
if (mode !== 'no-file') writeFileSync(arg('screenshot'), mode === 'truncated' ? png.subarray(0, png.length >> 1) : png);
process.stderr.write(mode === 'no-file' ? 'Check failed: renderer gone\\n' : png.length + ' bytes written to file\\nTeardown watchdog expired\\n');
process.exit(2);
`;

  function withFakeChrome<T>(mode: string, doc: string, work: (runs: () => number) => T): T {
    const dir = join(doc, '..');
    const chromePath = join(dir, 'fake-chrome.cjs');
    const log = join(dir, `fake-chrome-${mode}.log`);
    writeFileSync(chromePath, FAKE_CHROME);
    chmodSync(chromePath, 0o755);
    writeFileSync(log, '');
    const previous = { path: process.env.BOARDPLOT_CHROME_PATH, mode: process.env.FAKE_CHROME_MODE, log: process.env.FAKE_CHROME_LOG };
    Object.assign(process.env, { BOARDPLOT_CHROME_PATH: chromePath, FAKE_CHROME_MODE: mode, FAKE_CHROME_LOG: log });
    hideResvg.value = true;
    try {
      return work(() => readFileSync(log, 'utf8').split('\n').filter(Boolean).length);
    } finally {
      hideResvg.value = false;
      for (const [key, value] of [['BOARDPLOT_CHROME_PATH', previous.path], ['FAKE_CHROME_MODE', previous.mode], ['FAKE_CHROME_LOG', previous.log]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  it('keeps the PNG Chrome wrote before it exited 2', () => {
    const doc = docWithColumn();
    withFakeChrome('written-exit-2', doc, (runs) => {
      const result = runCli(['render', doc, '--out', join(doc, '..', 'exit2'), '--format', 'png', '--scale', '1']);
      expect(JSON.parse(result.log.join('\n')).errors).toEqual([]);
      expect(result.code).toBe(0);
      const png = readFileSync(join(doc, '..', 'exit2', 'revenue.png'));
      expect(pngSize(png)).toEqual({ width: 800, height: 450 });
      expect(completePng(png, { width: 800, height: 450 })).toBe(true);
      expect(runs()).toBe(1);
    });
  });

  // resvg replaces a whole text run that holds a glyph it lacks, so '🇩🇪 Germany' lost its Latin word too.
  it.skipIf(!resvg)('hands a drawing with emoji or CJK to Chrome, and without Chrome names the labels that can be lost', () => {
    const stack = "'Helvetica Neue', Arial, sans-serif";
    const drawing = { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"><rect width="300" height="200" fill="#fff"/></svg>', size: { width: 300, height: 200 }, fontFamily: stack, text: '🇩🇪 Germany\nRevenue' };
    withFakeChrome('written-exit-2', docWithColumn(), (runs) => {
      hideResvg.value = false;
      expect(rasterize([drawing], 1, 'resvg').warnings).toEqual([]);
      expect(runs()).toBe(1);
      // Chrome on a host without CJK or emoji fonts still draws a whole PNG with boxes, so only macOS and Windows clear the warning.
      const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
      try {
        for (const [name, count] of [['darwin', 0], ['win32', 0], ['linux', 1]] as const) {
          Object.defineProperty(process, 'platform', { value: name });
          const warnings = rasterize([drawing], 1, 'resvg').warnings;
          expect(warnings).toHaveLength(count);
          if (count) expect(warnings[0]!.message).toContain('Chrome drew the PNG');
        }
      } finally {
        Object.defineProperty(process, 'platform', platform);
      }
      process.env.BOARDPLOT_CHROME_PATH = join(tmpdir(), 'no-such-chrome');
      if (rasterFamily(stack, installedFamilies()) === null) return;
      const warning = rasterize([drawing], 1, 'resvg').warnings[0]!;
      expect(warning.code).toBe('png-glyph-coverage');
      expect(warning.message).toContain("whole label can go with them: '🇩🇪 Germany'.");
    });
  });

  it('runs Chrome once more when it draws no whole PNG, then names the cause', () => {
    for (const [mode, cause] of [
      ['no-file', 'exited with code 2 without writing the PNG (Chrome said: Check failed: renderer gone)'],
      ['truncated', 'wrote an incomplete or wrongly sized PNG (exit code 2) (Chrome said: Teardown watchdog expired)'],
    ] as const) {
      const doc = docWithColumn();
      withFakeChrome(mode, doc, (runs) => {
        const result = runCli(['render', doc, '--out', join(doc, '..', mode), '--format', 'png', '--scale', '1']);
        expect(result.code).toBe(2);
        expect(JSON.parse(result.log.join('\n')).errors).toEqual([{
          code: 'png-export-failed',
          message: `headless Chrome drew no complete PNG in two runs: ${cause}; then ${cause}`,
          path: '/format',
          suggest: 'Retry when the machine is less busy, render --format svg, or install @resvg/resvg-js to draw PNGs without Chrome.',
        }]);
        expect(runs()).toBe(2);
      });
    }
  });
});
