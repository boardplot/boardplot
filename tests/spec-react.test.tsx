// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getChart } from '../src/core/registry';
import * as tableResolver from '../src/core/charts/table/resolve';
import type { Geometry } from '../src/core/types/scene';
import { prepareChart } from '../src/react/prepare';
import { BoardplotTheme } from '../src/react/BoardplotTheme';
import { BoardplotChart } from '../src/react/spec';
import { parseChartSpec } from '../src/react/parseChartSpec';
import { mountedMarkup, settle } from './helpers/spec-chunks';
import spec from './fixtures/spec-document.json';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/** BoardplotChart draws one chart: the envelope reduced to the named one. */
const only = (name: string) => ({ ...spec, charts: spec.charts.filter(chart => chart.name === name) });
let host: HTMLDivElement;
let root: Root | undefined;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); });
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; host.remove(); vi.restoreAllMocks(); });

it('attaches a prepared SVG after hydration and switches provider paint without layout', async () => {
  const prepared = await prepareChart((await parseChartSpec(spec, 'regions')).request, { theme: 'standard' });
  const layout = vi.spyOn(getChart('column')!, 'layout');
  // One spec object: BoardplotChart parses by identity, and a new object is a new spec.
  const regions = only('regions');
  const chart = (theme: string) => <BoardplotTheme theme={theme}><BoardplotChart spec={regions} prepared={prepared} /></BoardplotTheme>;
  // The spec entry links no chart engine, so the server pass is the busy
  // placeholder and hydration matches it; the prepared scene attaches once
  // the chunks are there, and no layout runs on the way.
  host.innerHTML = renderToString(chart('standard'));
  expect(host.innerHTML).toContain('data-bp-loading');
  const errors = vi.fn();
  await act(async () => { root = hydrateRoot(host, chart('standard'), { onRecoverableError: errors }); });
  expect(errors).not.toHaveBeenCalled();
  await settle(host);
  const svg = host.querySelector('svg')!;
  const paints = svg.getAttribute('style');
  await act(async () => { root!.render(chart('standard-dark')); });
  expect(host.querySelector('svg')).toBe(svg);
  expect(svg.getAttribute('style')).not.toBe(paints);
  expect(layout).not.toHaveBeenCalled();
});

it('attaches a prepared HTML table after hydration and preserves expansion controls', async () => {
  const prepared = await prepareChart((await parseChartSpec(spec, 'detail')).request);
  const resolve = vi.spyOn(tableResolver, 'resolveTable');
  const chart = <BoardplotChart spec={only('detail')} prepared={prepared} />;
  host.innerHTML = renderToString(chart);
  expect(host.innerHTML).toContain('data-bp-loading');
  const errors = vi.fn();
  await act(async () => { root = hydrateRoot(host, chart, { onRecoverableError: errors }); });
  expect(errors).not.toHaveBeenCalled();
  await settle(host);
  expect(document.head.querySelector('style[data-bp-table-theme]')?.textContent).toContain('data-bp-table');
  expect(host.querySelector('.bp-table-grid')).not.toBeNull();
  // A closed row keeps its element inside a folded container.
  const retail = () => host.querySelector('[data-row-id="north-retail"]');
  expect(retail()!.closest('.bp-children[data-bp-collapsed]')).not.toBeNull();
  act(() => host.querySelector<HTMLButtonElement>('[data-bp-toggle-row]')!.click());
  expect(retail()!.closest('.bp-children[data-bp-collapsed]')).toBeNull();
  expect(retail()?.textContent).toContain('80');
  expect(resolve).not.toHaveBeenCalled();
});

it('applies explicit host settings after document and chart settings', async () => {
  const document = { ...spec, theme: 'standard', charts: [{ ...spec.charts[1], options: {
    ...spec.charts[1]!.options, theme: 'capital', locale: { language: 'de' },
  } }] };
  const resolve = vi.spyOn(tableResolver, 'resolveTable');
  await mountedMarkup(<BoardplotTheme theme="studio" locale="it"><BoardplotChart spec={document} /></BoardplotTheme>);
  expect(resolve.mock.calls.at(-1)![1]).toMatchObject({ theme: 'capital', locale: { language: 'de-x-marks-pc' } });
  await mountedMarkup(<BoardplotTheme theme="studio" locale="it"><BoardplotChart spec={document} theme="boardroom" /></BoardplotTheme>);
  expect(resolve.mock.calls.at(-1)![1]).toMatchObject({ theme: 'boardroom', locale: { language: 'de-x-marks-pc' } });
});

it('recovers from an explicit small frame and changes selected chart types', () => {
  const refused = vi.fn();
  const geometry = vi.fn<(value: Geometry) => void>();
  act(() => { root = createRoot(host); root.render(<BoardplotChart spec={only('regions')} size={{ width: 200, height: 100 }} onRefused={refused} />); });
  expect(host.querySelector('[data-bp-refused]')).not.toBeNull();
  expect(refused).toHaveBeenCalledOnce();
  act(() => root!.render(<BoardplotChart spec={only('regions')} onGeometry={geometry} />));
  expect(host.querySelector('svg')).not.toBeNull();
  expect(geometry.mock.calls.at(-1)![0].size).toEqual({ width: 800, height: 450 });
  act(() => root!.render(<BoardplotChart spec={only('detail')} />));
  // A table draws no chart SVG. The only <svg> it holds is the 8 px
  // outline mark in the gutter of a row with children.
  expect(host.querySelector('svg[data-bp-chart]')).toBeNull();
  expect(host.querySelector('.bp-table-grid')).not.toBeNull();
  expect(host.querySelector('.bp-table-grid')).not.toBeNull();
});
