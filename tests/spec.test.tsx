// @vitest-environment jsdom
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { storyView } from '../src/core/story';
import { main } from '../src/cli/main';
import { listCharts } from '../src/core/registry';
import { getFixtures } from '../src/fixtures';
import { resolveChartRequest, layoutResolvedRequest } from '../src/core/request';
import { requireGeometry } from '../src/core/sizing';
import { claimsForChart } from '../src/core/claims';
import { renderSvg } from '../src/core/svg/renderSvg';
import type { Geometry } from '../src/core/types/scene';
import type { Theme } from '../src/core/types/theme';

/** The id scope the CLI chose for this SVG; the parity checks reuse it. */
const cliIdScope = (svg: string) => /id="bp-desc-([0-9a-f]+)"/.exec(svg)?.[1];

const rendered = vi.hoisted(() => ({ geometry: undefined as Geometry | undefined, theme: undefined as Theme | undefined }));
vi.mock('../src/react/SceneRenderer', () => ({ SceneRenderer: ({ geometry, theme }: { geometry: Geometry; theme: Theme }) => {
  rendered.geometry = geometry; rendered.theme = theme; return null;
} }));
import { BoardplotChart } from '../src/react/spec';
import { parseChartSpec } from '../src/react/parseChartSpec';
import { mountedMarkup } from './helpers/spec-chunks';
import { withoutSvgFooter } from '../src/react/footerFrame';
import { layoutContainerRequest } from '../src/react/containerLayout';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const directories: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function directory() {
  const path = mkdtempSync(join(tmpdir(), 'boardplot-spec-')); directories.push(path); return path;
}
function cli(args: string[]) {
  const output: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((...values) => output.push(values.join(' ')));
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try { return { code: main(args), envelope: JSON.parse(output.join('\n')) }; }
  finally { log.mockRestore(); error.mockRestore(); warn.mockRestore(); }
}

describe('spec React entry', () => {
  // The spec entry links its chart engine on demand, so its charts are
  // mounted rather than server-rendered; the drawn geometry is the claim.
  it.each(listCharts().map(chart => chart.type))('%s demos share CLI canonical SVGs and render through the spec component', async type => {
    const fixtures = getFixtures(type).filter(fixture => fixture.tags.includes('demo'));
    const doc = JSON.parse(JSON.stringify({ version: 1, charts: fixtures.map((fixture, index) => ({
      name: `demo-${index}`, type, data: fixture.data, options: fixture.options, annotations: fixture.annotations,
    })) }));
    const root = directory(); const source = join(root, 'doc.json'); const output = join(root, 'svg');
    writeFileSync(source, JSON.stringify(doc));
    const result = cli(['render', source, '-o', output]);
    expect(result.code, JSON.stringify(result.envelope.errors)).toBe(0);
    for (const chart of doc.charts) {
      const parsed = await parseChartSpec(doc, chart.name);
      rendered.geometry = undefined; rendered.theme = undefined;
      const html = await mountedMarkup(<BoardplotChart spec={{ ...doc, charts: [chart] }} />);
      let geometry: Geometry; let theme: Theme;
      if (type === 'table') {
        expect(html, chart.name).toContain('bp-table-grid');
        const request = resolveChartRequest(parsed.request);
        geometry = requireGeometry(layoutResolvedRequest(request)); theme = request.theme;
      } else {
        expect(rendered.geometry, chart.name).toBeDefined();
        geometry = rendered.geometry!; theme = rendered.theme!;
        // A story draws its interactive step (buttons, counter); the CLI draws the static one.
        if (geometry.story) geometry = { ...geometry, ...storyView(geometry, geometry.story.step, false) };
      }
      const cliSvg = readFileSync(join(output, `${chart.name}.svg`), 'utf8');
      const draw = (shown: Geometry) => renderSvg(shown, theme, { claims: claimsForChart(type, shown), interactive: chart.options?.interactive === true, idScope: cliIdScope(cliSvg) });
      // Footer rule: React crops the SVG at the footer and draws the footer in
      // HTML. Static layout matches the CLI SVG; React crops its live layout.
      const request = resolveChartRequest(parsed.request);
      const full = requireGeometry(layoutResolvedRequest(request));
      expect(draw(full), `${type}/${chart.name} canonical`).toBe(cliSvg);
      const live = type === 'table' ? full : requireGeometry(layoutContainerRequest(request));
      const cropped = type !== 'table' && live.frame?.noteList?.length ? withoutSvgFooter(live) : live;
      expect(draw(geometry), `${type}/${chart.name}`).toBe(draw(cropped));
    }
  // 30 s: choropleth with its sizing passes needs more than 15 s on CI.
  }, 30_000);
});
