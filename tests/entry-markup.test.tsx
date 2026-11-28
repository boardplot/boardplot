// @vitest-environment jsdom
/**
 * the static markup each `boardplot/react/<type>` entry draws.
 *
 * Modules can move out of the per-type entries' initial
 * load and behind a dynamic import. Bytes may move; pixels may not. This
 * mounts the demo fixture of every registered type through the type's OWN
 * entry, waits for every chunk the component asks for, and compares the
 * resulting markup with the recorded hash.
 *
 * Recorded as hashes for the same reason the golden SVG set is: identical
 * input owes identical output, and a hash per entry is the whole net.
 *
 * npx vitest run tests/entry-markup.test.tsx compare
 * MARKUP_UPDATE=1 npx vitest run tests/entry-markup.test.tsx re-record
 * MARKUP_WRITE_DIR=/tmp/after npx vitest run … dump markup
 */
import { act, type ReactElement } from 'react';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { getFixtures } from '../src/fixtures';
import { chartLoaders } from '../src/react/chartLoaders';
import { maskEngineStamp, stampFreeSha } from './golden/stamp';
import '../src/core/geo/packs';
import { render } from '../src/cli/render';
import { interactionRecords } from '../src/core/a11y/records';
import type { LineMarks } from '../src/core/charts/line/layout';
import { fmtPathNumber } from '../src/core/curve';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { requireGeometry } from '../src/core/sizing';
import type { LineOptions } from '../src/core/types/options';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const MANIFEST = join(__dirname, 'fixtures', 'react-entry-markup.json');
// Above every registered type's size floor, so no entry records a refusal box.
const SIZE = { width: 960, height: 640 };
const TYPES = Object.keys(chartLoaders).sort();

function readManifest(): Record<string, string> {
  if (!existsSync(MANIFEST)) return {};
  return JSON.parse(readFileSync(MANIFEST, 'utf8')) as Record<string, string>;
}

/** The component an entry publishes: the one built from a chart type, else its table renderer. */
function componentOf(module: Record<string, unknown>, type: string): (props: Record<string, unknown>) => ReactElement {
  for (const value of Object.values(module)) {
    if (typeof value === 'function' && (value as { chartType?: string }).chartType === type) {
      return value as (props: Record<string, unknown>) => ReactElement;
    }
  }
  const table = module.TableChart;
  if (typeof table === 'function') return table as (props: Record<string, unknown>) => ReactElement;
  throw new Error(`the ${type} entry publishes no component`);
}

/** Mount, let every pending chunk land, and read the markup back. */
async function mount(element: ReactElement): Promise<string> {
  const host = document.createElement('div');
  document.body.append(host);
  let root: Root | undefined;
  await act(async () => { root = createRoot(host); root.render(element); });
  // A deferred core module is a real module load; under vitest that is a
  // transform, not a microtask, so this waits on the clock.
  const deadline = Date.now() + 20_000;
  while (host.querySelector('[data-bp-loading]') && Date.now() < deadline) {
    await act(async () => { await new Promise(settled => setTimeout(settled, 10)); });
  }
  // React's useId counts mounts within a document, so two mounts of the same
  // chart differ in that one token and nowhere else.
  const markup = host.innerHTML.replace(/_r_[0-9a-z]+_/g, '_r_id_');
  await act(async () => { root!.unmount(); });
  host.remove();
  return markup;
}

async function markupOf(type: string): Promise<string> {
  const fixture = getFixtures(type).find(candidate => candidate.tags.includes('demo')) ?? getFixtures(type)[0]!;
  const module = await chartLoaders[type]!() as Record<string, unknown>;
  const Chart = componentOf(module, type);
  return mount(<Chart
    {...structuredClone(fixture.options ?? {}) as Record<string, unknown>}
    data={structuredClone(fixture.data)}
    annotations={fixture.annotations ? structuredClone(fixture.annotations) : undefined}
    size={SIZE}
  />);
}

describe('per-type React entries draw the recorded markup', { timeout: 120_000 }, () => {
  it('every entry matches, and none is left on the busy placeholder', async () => {
    const recorded = readManifest();
    const writeDirectory = process.env.MARKUP_WRITE_DIR;
    if (writeDirectory) mkdirSync(writeDirectory, { recursive: true });
    const fresh: Record<string, string> = {};
    const changed: string[] = [];

    for (const type of TYPES) {
      const markup = await markupOf(type);
      expect(markup, `${type} is still on the busy placeholder`).not.toContain('data-bp-loading');
      expect(markup.length, `${type} drew nothing`).toBeGreaterThan(200);
      if (writeDirectory) writeFileSync(join(writeDirectory, `${type}.html`), markup);
      fresh[type] = `${stampFreeSha(markup)}:${maskEngineStamp(markup).length}`;
      if (recorded[type] !== undefined && recorded[type] !== fresh[type]) changed.push(type);
    }

    if (process.env.MARKUP_UPDATE === '1') {
      writeFileSync(MANIFEST, `${JSON.stringify(fresh, null, 2)}\n`);
      return;
    }
    expect(Object.keys(recorded).length, 'no recorded markup; run with MARKUP_UPDATE=1').toBe(TYPES.length);
    expect(changed, `the markup of these entries changed: ${changed.join(', ')}`).toEqual([]);
    expect(fresh).toEqual(recorded);
  });

  // The typed React entry needs to tell the author when a dashed actual line can read as a forecast.
  it('reports dashed actuals through LineChart onWarnings', async () => {
    const { LineChart } = await import('../src/react/charts/line');
    const data = {
      categories: [{ id: 'Jan' }, { id: 'Feb' }, { id: 'Mar' }, { id: 'Apr' }],
      series: [
        { id: 'a', label: '2025', values: [10, 12, 14, 13] },
        { id: 'b', label: '2024', values: [8, 9, 11, 10], lineStyle: 'dashed' as const },
      ],
    };
    const onWarnings = vi.fn();
    const markup = await mount(<LineChart data={data} size={SIZE} onWarnings={onWarnings} />);
    expect(markup.match(/<path[^>]*data-id="mark:line:b:0"[^>]*>/)?.[0]).toContain('stroke-dasharray=');
    expect(onWarnings).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ code: 'dash-on-actual-data' })]));
  });

  // A capped line endpoint needs an open marker and its real value, and a bar cannot imply a shortened value.
  it('draws a clipped line endpoint and keeps its reading', async () => {
    const { LineChart } = await import('../src/react/charts/line');
    const data = {
      categories: ['Q1', 'Q2', 'Q3', 'Q4'].map(id => ({ id })),
      series: [{ id: 'rate', label: 'Rate', values: [20, 40, 50, 300] }],
    };
    const options: LineOptions = { title: 'Rate peaks in Q4', size: SIZE, valueAxis: { min: 30, clamp: { max: 100 }, show: true } };
    const request = resolveChartRequest({ type: 'line', data, options });
    const geometry = requireGeometry(layoutResolvedRequest(request));
    const series = (geometry.marks as unknown as LineMarks).series[0]!;
    const point = series.points.at(-1)!;
    expect(point).toMatchObject({ categoryId: 'Q4', y: geometry.plot.y, clipped: true });
    const path = geometry.scene.find(node => node.id === series.pathNodeId);
    expect(path).toMatchObject({ t: 'path', d: expect.stringContaining(`L${fmtPathNumber(point.x)} ${fmtPathNumber(point.y)}`) });
    const marker = geometry.scene.find(node => node.id === point.nodeId);
    expect(marker).toMatchObject({ t: 'path', dash: expect.any(Array), display: { value: '300', state: 'clipped at 100' } });
    expect(marker).not.toHaveProperty('fill');
    expect(geometry.derived).toMatchObject({ clipped: [{ limit: 100, points: [{ value: 300 }] }] });
    expect(geometry.a11y.desc).toContain('Q4 / Rate (300)');
    const records = interactionRecords({ request, geometry, scope: request.scope, claims: [] });
    expect(records.find(record => record.target.owner.categoryId === 'Q4')).toMatchObject({ anchor: { y: point.y }, value: { raw: 300 } });

    const onWarnings = vi.fn();
    const markup = await mount(<LineChart data={data} {...options} onWarnings={onWarnings} />);
    expect(markup).toContain('1 point clipped at 100 (y).');
    expect(markup).toMatch(/>300<|>Rate 300</);
    expect(onWarnings).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ code: 'value-axis-min-ignored' })]));
    const hidden = await mount(<LineChart data={data} {...options} notes={{ show: ['note'] }} />);
    expect(hidden).not.toContain('1 point clipped at 100 (y).');

    const bar = render({ spec: { type: 'bar', data, options: { valueAxis: { clamp: { max: 100 } } } } });
    expect(bar.body.errors).toMatchObject([{ code: 'unknown-option', path: '/options/valueAxis/clamp' }]);
  });
});
