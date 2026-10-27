// @vitest-environment jsdom

import { act, createElement } from 'react';
import { webcrypto } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256 } from '../src/core/claims';
import { measure } from '../src/index';
import { defaultMeasurer } from '../src/core/text';

const sourceHash = (chart: { type: string; data: unknown; options?: unknown }) => sha256(canonicalJson({ type: chart.type, data: chart.data, options: chart.options ?? {} }));
const themeHash = (resolvedTheme: unknown) => sha256(canonicalJson(resolvedTheme));
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { requireGeometry } from '../src/core/sizing';
import { renderSvg } from '../src/core/svg/renderSvg';
import { INTERACTIVE_LAYOUT } from '../src/core/footer';
import { layoutWithStaticFooter } from '../src/core/staticFooter';
import { canonicalJson } from '../src/core/claims/canonical';
import { layoutContainerRequest } from '../src/react/containerLayout';
import { render } from '../src/cli/render';
import type { ManifestV1 } from '../src/core/claims';
import {
  copyData, copyImage, exportCsv, exportPng, exportSvg, useExport,
} from '../src/react/export';
import { rasterizeCanonicalSvg } from '../src/react/export/png';
import type { ExportInput, ExportOk, UseExport } from '../src/react/export';
import { resolveThemeRequest } from '../src/react/themeRequest';
import { BoardplotTheme } from '../src/react/BoardplotTheme';
import { utf8Bytes } from '../src/react/export/hash';
import { ChoroplethChart } from '../src/react/charts/choropleth';
import '../src/core/geo/packs/de-states';

// jsdom has no SubtleCrypto. Node 18 also requires byte buffers from its own realm.
beforeEach(() => {
  if (!globalThis.crypto?.subtle) vi.stubGlobal('crypto', {
    subtle: { digest: (algorithm: string, input: ArrayBuffer) =>
      webcrypto.subtle.digest(algorithm, Buffer.from(new Uint8Array(input))) },
  });
});
afterAll(() => vi.unstubAllGlobals());

const data = {
  categories: [{ id: 'north', label: 'North' }, { id: 'south', label: 'South' }],
  series: [{ id: 'actual', label: 'Actual', values: [12, 14] }],
};
const request = {
  type: 'column',
  scope: { chart: 'sales' },
  data,
  options: { title: 'Revenue', unit: 'EUR m' },
  size: { width: 800, height: 450 },
};
const spec = { version: 1, charts: [{ name: 'sales', type: 'column', data, options: request.options }] };

function expectOk(result: Awaited<ReturnType<typeof exportSvg>>): ExportOk {
  expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result;
}

function digest(bytes: Uint8Array | string): string {
  return sha256(typeof bytes === 'string' ? bytes : Buffer.from(bytes));
}

function manifest(result: ExportOk): ManifestV1 {
  if (!('bpManifest' in result.receipt)) throw new Error('Expected SVG manifest');
  return result.receipt;
}

function artifactHash(result: ExportOk): string {
  return 'bpManifest' in result.receipt ? result.receipt.entries[0]!.artifactSha256 : result.receipt.artifactSha256;
}

describe('react export', () => {
  // Prevents authored CSV text from running as a spreadsheet formula while numbers and CSV punctuation keep their meaning.
  it('protects spreadsheet formula prefixes and preserves numeric cells and CSV quoting', async () => {
    const labels = [
      ['=1+1', "'=1+1"],
      ['+SUM(1,2)', '"\'+SUM(1,2)"'],
      ['-1+2', "'-1+2"],
      ['@SUM(1)', "'@SUM(1)"],
      ['\t=1+1', '"\'\t=1+1"'],
      ['\n=1+1', '"\'\n=1+1"'],
      ['\r=1+1', '"\'\r=1+1"'],
      ['x;=1+1;', '"x;=1+1;"'],
      ['x\t=1+1\t', '"x\t=1+1\t"'],
      ['=HYPERLINK("a","b")', '"\'=HYPERLINK(""a"",""b"")"'],
      ['Name, "quoted"\nnext', '"Name, ""quoted""\nnext"'],
      ['-12', '-12'],
      ['+12.5', '+12.5'],
      ['-.5', '-.5'],
      ['-1e3', '-1e3'],
      ['-12\n', '"\'-12\n"'],
    ];
    for (const [label, cell] of labels) {
      const result = expectOk(await exportCsv({ request: {
        type: 'kpi', data: { label, value: -12 }, size: { width: 960 },
      } }));
      expect(result.artifact.text, label).toContain(`,${cell},number,-12,value,`);
      expect((result.document as { charts: { data: { label: string } }[] }).charts[0]!.data.label).toBe(label);
    }
  });

  // Prevents the required map credit or its source links from being hidden on a narrow React chart or in print.
  it('shows the full linked BKG credit at 320 and 960 px with notes disabled', () => {
    const credit = '© BKG (2026) dl-de/by-2-0 (data changed), Datenquellen: https://sgx.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg_nuts.pdf';
    for (const width of [320, 960]) {
      for (const target of ['report', 'dashboard'] as const) {
        const host = document.createElement('div');
        host.innerHTML = renderToStaticMarkup(createElement(ChoroplethChart, {
          data: { pack: 'de-states', regions: [{ id: 'DE-BY', value: 12 }] },
          target, footnotes: false, size: { width },
        }));
        const footer = host.querySelector('[data-bp-footer]')!;
        expect(footer.textContent).toContain(credit);
        expect(Array.from(footer.querySelectorAll('a')).map(link => [link.textContent, link.getAttribute('href')])).toEqual([
          ['BKG', 'https://www.bkg.bund.de'],
          ['dl-de/by-2-0', 'https://www.govdata.de/dl-de/by-2-0'],
          ['Datenquellen', 'https://sgx.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg_nuts.pdf'],
        ]);
        for (const link of Array.from(footer.querySelectorAll('a'))) {
          expect(link.closest('[hidden], [data-bp-notes-panel], [data-bp-notes-popover], [data-bp-notes-toggle]')).toBeNull();
        }
        expect(footer.querySelector('button')).toBeNull();
      }
    }
  });

  it.each([400, 320])('keeps the original plot when automatic sizing probes a wider card at %s px', (width) => {
    const dashboard = { ...request, size: { width }, options: {
      ...request.options, target: 'dashboard' as const, source: 'Invented data',
      footnotes: ['First note.', 'Second note.', 'Third note.', 'Fourth note.', 'Fifth note.'],
    } };
    const resolved = resolveChartRequest(dashboard);
    const live = requireGeometry(layoutContainerRequest(resolved));
    const geometry = requireGeometry(layoutResolvedRequest(resolved));
    // The card frame (16 px card margin, card plot targets) draws 363 px, x 13 with this invented data.
    expect(live.size.height).toBe(363);
    // The 'info' footer keeps 24 px for its notes button (frame.ts NOTE_HIT_PX): the plot is 1.7 px shorter.
    expect(JSON.stringify(geometry.plot)).toBe(JSON.stringify({ x: 13, y: 67.9, w: width - 26, h: 237.50000000000003 }));
    expect(geometry.plot).toEqual(live.plot);
    expect(geometry.frame.footerRect!.y).toBe(363);
  });

  it('still fits static notes after a nested layout throws', () => {
    expect(() => layoutWithStaticFooter(() => {
      layoutWithStaticFooter(() => { throw new Error('Failed layout'); }, {});
      throw new Error('Unreachable');
    }, {})).toThrow('Failed layout');
    const geometry = requireGeometry(layoutResolvedRequest(resolveChartRequest({ ...request, options: {
      ...request.options, target: 'dashboard', footnotes: ['First note.', 'Second note.', 'Third note.', 'Fourth note.', 'Fifth note.'],
    } })));
    expect(geometry.size).toEqual(request.size);
    expect(geometry.frame.noteList?.filter(note => note.kind === 'note')).toHaveLength(5);
    expect(geometry.frame.noteList?.every(note => note.inFrame)).toBe(true);
  });

  it('exports a live five-note request with static layout and no internal flag in JSON, claims or hashes', async () => {
    const footnotes = ['First note.', 'Second note.', 'Third note.', 'Fourth note.', 'Fifth note.'];
    const dashboard = { ...request, size: { width: 480, height: 320 }, options: {
      ...request.options, target: 'dashboard' as const, source: 'Invented data', footnotes,
    } };
    const liveOptions = { ...dashboard.options, [INTERACTIVE_LAYOUT]: true };
    const resolved = resolveChartRequest(dashboard);
    const liveRequest = { ...resolved, options: { ...resolved.options, [INTERACTIVE_LAYOUT]: true } };
    const live = requireGeometry(layoutResolvedRequest(liveRequest));
    expect(live.size.height).toBe(320);
    expect(live.frame.noteList?.some(note => !note.inFrame)).toBe(true);
    expect(canonicalJson(liveOptions)).toBe(canonicalJson(dashboard.options));
    expect(sourceHash({ type: 'column', data, options: liveOptions })).toBe(sourceHash({ type: 'column', data, options: dashboard.options }));
    const plain = expectOk(await exportSvg({ request: dashboard }));
    const fromLive = expectOk(await exportSvg({ request: { ...dashboard, options: liveOptions } }));
    const svg = new DOMParser().parseFromString(fromLive.artifact.text!, 'image/svg+xml');
    for (const note of footnotes) expect(svg.documentElement.textContent).toContain(note);
    expect(Number(svg.documentElement.getAttribute('viewBox')!.split(' ')[3])).toBe(live.size.height);
    expect(fromLive.document).toEqual(plain.document);
    expect(Object.getOwnPropertySymbols((fromLive.document as typeof spec).charts[0]!.options)).toEqual([]);
    expect(fromLive.receipt).toEqual(plain.receipt);
    // The full SVG includes the ids derived from the exported document hash.
    expect(fromLive.artifact.text).toBe(plain.artifact.text);
    const cliSpec = { type: 'column', data, options: { ...dashboard.options, size: dashboard.size } };
    const cli = render({ spec: cliSpec, return: ['svg'] });
    const cliLive = render({ spec: { ...cliSpec, options: { ...cliSpec.options, [INTERACTIVE_LAYOUT]: true } }, return: ['svg'] });
    expect(cli.body.ok).toBe(true);
    expect(cliLive.body).toEqual(cli.body);
  });

  it.each([{ width: 480 }, { width: 320 }, { width: 480, mode: 'compact' as const }])('prints all five dashboard notes in static SVG, PNG and clipboard at $width / $mode', async ({ width, mode }) => {
    const footnotes = ['Note one is here.', 'Note two is here.', 'Note three is here.', 'Note four is here.', 'Note five is here.'];
    const dashboard = { ...request, data: { ...data, categories: [data.categories[0]!, { ...data.categories[1]!, footnote: 3 }] }, size: { width, height: 320 }, options: {
      ...request.options, target: 'dashboard' as const, source: 'Invented data', footnotes, ...(mode ? { mode } : {}),
    } };
    const resolved = resolveChartRequest(dashboard);
    const live = requireGeometry(layoutContainerRequest(resolved));
    const geometry = requireGeometry(layoutResolvedRequest(resolved));
    const snapshot = JSON.stringify(geometry);
    const staticSvg = renderSvg(geometry, resolved.theme);
    expect(renderSvg(JSON.parse(snapshot), resolved.theme)).toBe(staticSvg);
    expect(JSON.stringify(geometry)).toBe(snapshot);
    expect(geometry.frame.noteList?.find(note => note.text === footnotes[2])?.ref).toBe(3);
    expect(live.size.height).toBe(320);
    expect(geometry.size).toEqual(dashboard.size);
    expect(geometry.frame.footerRect!.y).toBeGreaterThanOrEqual(geometry.plot.y + geometry.plot.h);
    expect(geometry.frame.footerRect!.y + geometry.frame.footerRect!.h).toBeLessThanOrEqual(geometry.size.height);
    for (const node of geometry.scene.filter(node => ['source', 'credit', 'footnote'].includes(node.part ?? ''))) {
      if (node.t === 'text') {
        expect(node.y).toBeGreaterThanOrEqual(geometry.plot.y + geometry.plot.h);
        expect(node.y + node.lines.length * node.font.size * (node.font.lineHeight ?? 1.3)).toBeLessThanOrEqual(geometry.size.height);
      }
    }
    const assertNotes = (svg: string) => {
      const texts = Array.from(new DOMParser().parseFromString(svg, 'image/svg+xml').querySelectorAll('text')).map((node) => node.textContent).join(' ');
      for (const note of footnotes) expect(texts).toContain(note);
      expect(texts).not.toMatch(/\+\d+ notes?/);
    };
    const cli = render({ spec: { type: 'column', data: dashboard.data, options: { ...dashboard.options, size: dashboard.size } }, return: ['svg'] });
    expect(cli.body.ok).toBe(true);
    assertNotes(cli.body.svg as string);
    const svg = expectOk(await exportSvg({ request: dashboard }));
    assertNotes(svg.artifact.text!);
    const height = Number(new DOMParser().parseFromString(svg.artifact.text!, 'image/svg+xml').documentElement.getAttribute('viewBox')!.split(' ')[3]);
    expect(height).toBe(live.size.height);
    expect(height).toBeCloseTo(geometry.size.height, 2);
    expect(svg.artifact.text).toContain('3) Note three is here.');
    const rasterizePng = vi.fn(async (text: string, size: { width: number; height: number }) => {
      assertNotes(text);
      expect(size.width).toBe(width);
      expect(size.height).toBeCloseTo(height, 2);
      return new Uint8Array([1]);
    });
    expectOk(await exportPng({ request: dashboard, rasterizePng }, 1));
    vi.stubGlobal('navigator', { clipboard: { write: async () => {} } });
    vi.stubGlobal('ClipboardItem', class { constructor(readonly items: Record<string, Promise<Blob>>) {} });
    try {
      expect(expectOk(await copyImage({ request: dashboard, rasterizePng })).clipboard).toEqual({ ok: true });
      expect(rasterizePng).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([false, true])('collects grid panel notes into the outer static footer (outer note: %s)', async (outerNote) => {
    const footnotes = ['First panel note.', 'Second panel note.', 'Third panel note.', 'Fourth panel note.', 'Fifth panel note.'];
    const grid = { type: 'grid', data: { panels: [
      { id: 'one', title: 'First panel', type: 'column', data, options: { source: 'Invented panel data', footnotes } },
      { id: 'two', title: 'Second panel', type: 'column', data },
    ] }, options: { target: 'dashboard' as const, columns: 2, sharedAxis: 'none', title: 'Two panels',
      ...(outerNote ? { footnotes: ['Outer note.'] } : {}) }, size: { width: 1200, height: 720 } };
    const resolved = resolveChartRequest(grid);
    const live = requireGeometry(layoutContainerRequest(resolved));
    const geometry = requireGeometry(layoutResolvedRequest(resolved));
    expect(geometry.plot).toEqual(live.plot);
    expect(geometry.size.height).toBeGreaterThan(720);
    expect(renderSvg(JSON.parse(JSON.stringify(geometry)), resolved.theme)).toBe(renderSvg(geometry, resolved.theme));
    const result = expectOk(await exportSvg({ request: grid }));
    const svg = new DOMParser().parseFromString(result.artifact.text!, 'image/svg+xml');
    const texts = Array.from(svg.querySelectorAll('text')).map(node => node.textContent).join(' ');
    for (const note of footnotes) expect(texts).toContain(note);
    expect(texts).not.toMatch(/\+\d+ notes?/);
    if (outerNote) expect(texts).toContain('Outer note.');
    const footer = geometry.scene.filter(node => node.t === 'text' && node.id.startsWith('static-footer:'));
    expect(footer.some(node => node.t === 'text' && node.lines.includes('First panel (one)'))).toBe(true);
    expect(geometry.scene.filter(node => node.id.startsWith('one/') || node.id.startsWith('two/')))
      .toEqual(live.scene.filter(node => (node.id.startsWith('one/') || node.id.startsWith('two/'))
        && !['source', 'footnote', 'credit'].includes(node.part ?? '')));
  });

  it('prints expanded notes below a story panel without covering its text', async () => {
    const footnotes = ['First note.', 'Second note.', 'Third note.', 'Fourth note.', 'Fifth note.'];
    const storyRequest = { ...request, size: { width: 480, height: 320 }, options: {
      ...request.options, target: 'dashboard' as const, footnotes, source: 'Invented data',
      story: { steps: [{ id: 'one', title: 'Coverage', body: 'These five notes belong to this chart.' }] },
    } };
    const live = requireGeometry(layoutContainerRequest(resolveChartRequest(storyRequest)));
    expect(live.story?.placement).toBe('below');
    const result = expectOk(await exportSvg({ request: storyRequest }));
    const svg = new DOMParser().parseFromString(result.artifact.text!, 'image/svg+xml');
    const panel = svg.querySelector('[data-part="storyPanel"]')!;
    const bottom = Number(panel.getAttribute('y')) + Number(panel.getAttribute('height'));
    const notes = Array.from(svg.querySelectorAll('text[data-part="footnote"]'));
    expect(notes).toHaveLength(5);
    for (const note of notes) expect(Number(note.getAttribute('y'))).toBeGreaterThan(bottom);
    expect(notes.map(note => note.textContent)).toEqual(expect.arrayContaining(footnotes));
  });

  it('returns fresh svg and csv from the latest source, with matching sidecar receipts', async () => {
    const first = expectOk(await exportSvg({ request }));
    const secondData = { ...data, series: [{ id: 'actual', label: 'Actual', values: [12, 20] }] };
    const second = expectOk(await exportSvg({ request: { ...request, data: secondData } }));
    expect(first.artifact.text).toContain('<svg');
    expect(first.artifact.text).not.toContain('bpManifest');
    expect(manifest(first).bpManifest).toBe(1);
    expect(first.artifact.text).not.toEqual(second.artifact.text);
    expect(artifactHash(first)).not.toBe(artifactHash(second));
    expect(sha256(first.artifact.text!)).toBe(artifactHash(first));
    expect(artifactHash(first)).toBe(digest(first.artifact.text!));
    const resolved = resolveChartRequest(request);
    expect(manifest(first).entries[0]!.sourceSha256).toBe(sourceHash({
      ...(first.document as { charts: { type: string; data: unknown; options: unknown }[] }).charts[0]!,
    }));
    expect(manifest(first).entries[0]!.themeSha256).toBe(themeHash(resolved.theme));
    expect(manifest(first).entries[0]!.claims).toEqual(expect.any(Array));

    const csvFirst = expectOk(await exportCsv({ spec, chart: 'sales', request: { ...request, size: request.size } }));
    const csvSecond = expectOk(await exportCsv({ request: { ...request, data: secondData } }));
    expect(csvFirst.artifact.text).toContain('north');
    expect(csvFirst.artifact.text).toMatch(/12/);
    expect(csvSecond.artifact.text).toMatch(/20/);
    expect(csvFirst.artifact.text).not.toEqual(csvSecond.artifact.text);
    expect(sha256(csvFirst.artifact.text!)).toBe(artifactHash(csvFirst));
  });

  it.each(['compact'] as const)('preserves provider theme and size at %s density in the source and matching SVG receipt', async (density) => {
    const plain = expectOk(await exportSvg({ request }));
    const themed = expectOk(await exportSvg({ request, context: { theme: 'glass', density, locale: 'de-DE' } }));
    expect(themed.artifact.text).not.toBe(plain.artifact.text);
    expect(manifest(themed).entries[0]!.themeSha256).not.toBe(manifest(plain).entries[0]!.themeSha256);
    expect(manifest(themed).entries[0]!.themeSha256).toBe(themeHash(resolveThemeRequest(request, { theme: 'glass', density, locale: 'de-DE' }).theme));
    expect(themed.document).toMatchObject({ charts: [{ options: { size: request.size, locale: { language: 'de-DE' } } }] });
    const reproduced = expectOk(await exportSvg({ spec: themed.document }));
    expect(reproduced.artifact.text).toBe(themed.artifact.text);
    expect(artifactHash(reproduced)).toBe(artifactHash(themed));
    expect(manifest(reproduced).entries[0]!.themeSha256).toBe(manifest(themed).entries[0]!.themeSha256);
  });

  it('rasters png from canonical svg when a rasterizer is supplied, not from a live DOM node', async () => {
    const svg = expectOk(await exportSvg({ request }));
    const png = expectOk(await exportPng({
      request,
      rasterizePng: async (text, size, scale) => {
        expect(text).toBe(svg.artifact.text);
        expect(size.width).toBeGreaterThan(0);
        expect(scale).toBe(2);
        return utf8Bytes(`png:${text.length}`);
      },
    }, 2));
    expect(png.artifact.mediaType).toBe('image/png');
    expect(png.receipt).toMatchObject({ coverage: 'artifact-bytes-only' });
    expect(sha256(Buffer.from(png.artifact.bytes))).toBe(artifactHash(png));
  });

  it('warns once before SVG or PNG export when the theme font is not loaded', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const original = Object.getOwnPropertyDescriptor(document, 'fonts');
    const check = vi.fn(() => true);
    Object.defineProperty(document, 'fonts', { configurable: true, value: { check, forEach: () => {} } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const root = createRoot(document.createElement('div'));
    let api: UseExport | undefined;
    const rasterizePng = vi.fn(async () => new Uint8Array([1]));
    function Probe() {
      api = useExport({ request, rasterizePng });
      return null;
    }
    try {
      await act(async () => { root.render(createElement(Probe)); });
      expectOk(await api!.png(1));
      expect(warn).not.toHaveBeenCalled();
      check.mockReturnValue(false);
      expectOk(await api!.svg());
      expect(warn).toHaveBeenCalledOnce();
      expectOk(await api!.png(1));
      expectOk(await api!.png(2));
      expect(check).toHaveBeenCalledWith(`12px ${resolveChartRequest(request).theme.type.family}`);
      expect(warn).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('is not loaded in the page'));
    } finally {
      await act(async () => { root.unmount(); });
      warn.mockRestore();
      if (original) Object.defineProperty(document, 'fonts', original);
      else Reflect.deleteProperty(document, 'fonts');
    }
  });

  // An SVG opened on another machine fell back from the page's web font; a copy of every face, or of a later web font in the stack, bloated each file.
  it('copies into the SVG only the page font faces its text draws with', async () => {
    const font = (bytes: string) => `data:font/woff2;base64,${Buffer.from(bytes).toString('base64')}`;
    // jsdom's CSSOM drops src and unicode-range, so the page's rules are built by hand.
    const rule = (family: string, file: string, weight: string, more: Record<string, string> = {}) => {
      const values: Record<string, string> = { 'font-family': family, src: `url("${font(file)}") format("woff2")`, 'font-weight': weight, ...more };
      const names = Object.keys(values);
      return Object.defineProperty(Object.create(CSSFontFaceRule.prototype), 'style', {
        value: { length: names.length, item: (i: number) => names[i], getPropertyValue: (name: string) => values[name] ?? '' },
      }) as CSSFontFaceRule;
    };
    const cssRules = [
      rule('"Test Sans"', 'regular-latin', '400', { 'unicode-range': 'U+0-FF' }),
      rule('"Test Sans"', 'regular-cyrillic', '400', { 'unicode-range': 'U+400-45F' }),
      rule('"Test Sans"', 'condensed', '400', { 'font-stretch': '75%' }),
      rule('"Test Sans"', 'light', '300'),
      rule('"Test Sans"', 'semibold', '600', { 'size-adjust': '96%' }),
      rule('"Page Roboto"', 'roboto', '400'),
    ];
    // A family counts as installed when its measured width differs from the fallback's.
    vi.stubGlobal('OffscreenCanvas', class {
      getContext() { return { font: '', measureText(this: { font: string }) { return { width: /Arial/.test(this.font) ? 2 : 1 }; } }; }
    });
    const loaded = [{ family: '"Test Sans"', status: 'loaded' }, { family: 'Page Roboto', status: 'loaded' }];
    const original = Object.getOwnPropertyDescriptor(document, 'fonts');
    Object.defineProperty(document, 'fonts', { configurable: true, value: { check: () => true, forEach: (visit: (face: unknown) => void) => loaded.forEach(visit) } });
    Object.defineProperty(document, 'styleSheets', { configurable: true, value: [{ href: null, cssRules }] });
    try {
      const themed = { ...request, options: { ...request.options, theme: { preset: 'boardroom', overrides: { type: { family: "'Absent Sans', 'Test Sans', Arial, 'Page Roboto', sans-serif" } } } } };
      const svg = expectOk(await exportSvg({ request: themed }));
      const text = svg.artifact.text!;
      // Text draws at 400 and the 700 title, which the 600 face draws as the nearest heavier one;
      // the uninstalled 'Absent Sans' is skipped, and installed Arial stops the stack before Roboto.
      expect(text).toContain(font('regular-latin'));
      expect(text).toContain(`size-adjust:96%;src:url("${font('semibold')}")`);
      for (const unused of ['regular-cyrillic', 'condensed', 'light', 'roboto']) expect(text).not.toContain(font(unused));
      expect(artifactHash(svg)).toBe(digest(text));
      const painted = vi.fn(async (_svg: string) => new Uint8Array([1]));
      expectOk(await exportPng({ request: themed, rasterizePng: painted }, 1));
      expect(painted.mock.calls[0]![0]).toBe(text);
      // Arial lacks these glyphs, so the page draws them with the later web font.
      const japanese = { ...themed, data: { ...data, categories: [{ id: 'north', label: '大阪' }, data.categories[1]!] } };
      expect(expectOk(await exportSvg({ request: japanese })).artifact.text).toContain(font('roboto'));
      expect(expectOk(await exportSvg({ request: themed, embedFonts: false })).artifact.text).not.toContain('@font-face');
    } finally {
      vi.unstubAllGlobals();
      Reflect.deleteProperty(document, 'styleSheets');
      if (original) Object.defineProperty(document, 'fonts', original);
      else Reflect.deleteProperty(document, 'fonts');
    }
  });

  it('writes 96 dpi times the scale into the canvas PNG, as the CLI does ', async () => {
    const chunk = (type: string, length: number) => [0, 0, 0, length, ...Buffer.from(type), ...new Array(length + 4).fill(0)];
    const canvasPng = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', 13), ...chunk('IEND', 0)]);
    vi.stubGlobal('Image', class { onload?: () => void; set src(_url: string) { queueMicrotask(() => this.onload?.()); } });
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:chart', revokeObjectURL: () => {} });
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: () => {} } as never);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done) => done({ arrayBuffer: async () => canvasPng.buffer } as Blob));
    try {
      const png = Buffer.from(await rasterizeCanonicalSvg('<svg/>', { width: 720, height: 405 }, 2));
      const phys = png.indexOf('pHYs');
      expect([png.readUInt32BE(phys + 4), png.readUInt32BE(phys + 8), png[phys + 12]]).toEqual([7559, 7559, 1]);
    } finally {
      context.mockRestore();
      toBlob.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('reports clipboard failure without dropping the csv artifact', async () => {
    const writeText = vi.fn(async () => { throw new Error('Permission denied'); });
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const copied = expectOk(await copyData({ request }));
    expect(copied.artifact.format).toBe('csv');
    expect(copied.clipboard).toEqual({ ok: false, error: 'Permission denied' });
    expect(artifactHash(copied)).toBe(digest(copied.artifact.text!));
    vi.unstubAllGlobals();
  });

  it('starts the image clipboard write before its first await, as Safari requires ', async () => {
    const write = vi.fn(async (items: Array<{ items: Record<string, Promise<Blob>> }>) => { await items[0]!.items['image/png']; });
    vi.stubGlobal('navigator', { clipboard: { write } });
    vi.stubGlobal('ClipboardItem', class { constructor(readonly items: Record<string, Promise<Blob>>) {} });
    const copied = copyImage({ request, rasterizePng: async () => new Uint8Array([1]) });
    expect(write).toHaveBeenCalledOnce();
    expect(expectOk(await copied).clipboard).toEqual({ ok: true });
    vi.unstubAllGlobals();
  });

  it('exports a container request at its fallback size and answers a bad one with invalid ', async () => {
    const container = { ...request, size: undefined, options: { ...request.options, size: 'container', fallbackSize: { width: 640, height: 360 } } };
    expect(expectOk(await exportSvg({ request: container as never })).artifact.text).toContain('viewBox="0 0 640 360"');
    expect(await exportSvg({ request: { ...request, size: 'wide' } as never })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('refuses a chart its own error lint refuses, as render does', async () => {
    const node = (id: string, x: number) => ({ id, kind: 'entity', shape: { kind: 'roundedRect' }, label: id, position: { x, y: 0.5 } });
    const overlap = {
      type: 'diagram',
      data: { nodes: [node('A', 0.5), node('B', 0.52)], edges: [{ id: 'e', source: { nodeId: 'A' }, target: { nodeId: 'B' } }] },
      options: { variant: 'hierarchy', title: 'Fixed' },
      size: { width: 480, height: 270 },
    };
    expect(await exportSvg({ request: overlap })).toMatchObject({ ok: false, code: 'refused', message: "fixed nodes 'A' and 'B' overlap" });
  });

  it('useExport reads the latest caller inputs on each call', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    const root = createRoot(container);
    let api: UseExport | undefined;
    function Probe({ input }: { input: ExportInput }) {
      api = useExport(input);
      return null;
    }
    try {
      await act(async () => { root.render(createElement(Probe, { input: { request } })); });
      const first = expectOk(await api!.svg());
      const next = { ...request, data: { ...data, series: [{ id: 'actual', label: 'Actual', values: [40, 41] }] } };
      await act(async () => { root.render(createElement(BoardplotTheme, { theme: 'glass', children: createElement(Probe, { input: { request: next } }) })); });
      const second = expectOk(await api!.svg());
      expect(second.artifact.text).not.toEqual(first.artifact.text);
      expect(second.artifact.text).toContain('40');
      expect(manifest(second).entries[0]!.themeSha256).toBe(themeHash(resolveChartRequest(next, { theme: 'glass' }).theme));
    } finally {
      await act(async () => { root.unmount(); });
    }
  });
});

// Raw SVG export must reject the same invalid options as render and measure, without losing caller measurements.
it('validates raw export options with the shared rules and keeps custom measurement and context', async () => {
  for (const options of [{ nonsenseAuditOption: true }, { valueAxis: { auditUnknown: true } }, { format: '1,234', topN: { n: 0 } }]) {
    const raw = { ...request, options };
    const cli = render({ spec: { type: raw.type, data: raw.data, options }, return: ['svg'] });
    const error = (cli.body.errors as { code: string; message: string }[])[0]!;
    expect(cli.body.ok).toBe(false);
    expect(() => measure(raw as never)).toThrow(expect.objectContaining({ code: error.code }));
    expect(await exportSvg({ request: raw as never })).toMatchObject({ ok: false, code: 'invalid', message: expect.stringContaining(error.message) });
    expect(await exportSvg({ spec, request: raw as never })).toMatchObject({ ok: false, code: 'invalid', message: expect.stringContaining(error.message) });
  }
  for (const [chart, filename] of [['Sales Q4', 'Sales_Q4.svg'], ['sales/chart', 'sales_chart.svg']] as const) {
    const named = expectOk(await exportSvg({ request: { ...request, scope: { chart } } }));
    expect(named.artifact.filename).toBe(filename);
    expect(named.document).toMatchObject({ charts: [{ name: chart }] });
    expect(manifest(named).entries[0]!.chart).toBe(chart);
  }
  const custom = vi.fn<typeof defaultMeasurer>((text, font) => {
    const measured = defaultMeasurer(text, font);
    return { ...measured, width: measured.width * 1.1 };
  });
  const context = { theme: 'glass', density: 'compact' as const, locale: 'de-DE' };
  const raw = { ...request, options: { ...request.options, measure: custom } };
  const exported = expectOk(await exportSvg({ request: raw, context }));
  expect(custom).toHaveBeenCalled();
  const resolved = resolveThemeRequest(raw, context);
  const geometry = requireGeometry(layoutResolvedRequest(resolved));
  const idScope = sha256(canonicalJson(exported.document)).slice(0, 10);
  expect(exported.artifact.text).toBe(renderSvg(geometry, resolved.theme, { idScope }));
  expect(expectOk(await exportSvg({ request: { ...request, fontMetrics: custom }, context })).artifact.text).toBe(exported.artifact.text);
});
