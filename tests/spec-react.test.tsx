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
import { ScaleGroup } from '../src/react/ScaleGroup';
import { parseChartSpec } from '../src/react/parseChartSpec';
import { beginSpecParse } from '../src/react/specValidation';
import { loadChartTypes } from '../src/react/loadChartTypes';
import { mount, mountedMarkup, settle } from './helpers/spec-chunks';
import spec from './fixtures/spec-document.json';
import { exampleData } from '../src/core/charts/dimswitch/example';
import { defaultMeasurer } from '../src/core/text';

const dataTableLoads = vi.hoisted(() => ({ count: 0 }));
vi.mock('../src/react/hover/dataTable', async (importOriginal) => { dataTableLoads.count += 1; return importOriginal(); });

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/** BoardplotChart draws one chart: the envelope reduced to the named one. */
const only = (name: string) => ({ ...spec, charts: spec.charts.filter(chart => chart.name === name) });
let host: HTMLDivElement;
let root: Root | undefined;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); });
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; host.remove(); vi.restoreAllMocks(); });
const mountRoot = (element: Parameters<typeof mount>[0]) => mount(element, host);

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
  expect(host.innerHTML).toContain('<svg');
  expect(host.innerHTML).not.toContain('data-bp-loading');
  const first = host.querySelector('svg')!;
  const errors = vi.fn();
  await act(async () => { root = hydrateRoot(host, chart('standard'), { onRecoverableError: errors }); });
  expect(errors).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(host.querySelector('svg')).not.toBe(first));
  expect(host.querySelector('[data-bp-loading]')).toBeNull();
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

const rowTable = {
  type: 'tbl',
  data: {
    columns: [{ id: 'name', kind: 'rowLabel' }, { id: 'value', kind: 'value', label: 'Volume' }],
    rows: [{ id: 'a', label: 'A', cells: { value: 1 } }, { id: 'b', label: 'B', cells: { value: 2 } }, { id: 'c', label: 'C', cells: { value: 3 } }],
  },
  options: { title: 'Volume by row' },
};

// A typed host of the spec component (the notebook and Streamlit views) could not pass row picks: BoardplotChart did not declare them.
it('passes table row picks by click and by key, within isRowSelectable, to the host', async () => {
  const select = vi.fn();
  root = await mountRoot(<BoardplotChart spec={rowTable} onRowSelect={select} isRowSelectable={(row) => row.id !== 'b'} />);
  const cell = (row: string) => host.querySelector<HTMLElement>(`[data-row-id="${row}"] [data-bp-column="value"]`)!;
  act(() => { cell('a').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  expect(select).toHaveBeenCalledTimes(1);
  expect(select).toHaveBeenLastCalledWith('a', expect.objectContaining({ columnId: 'value', row: expect.objectContaining({ id: 'a' }) }));
  act(() => { cell('b').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  expect(select).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[data-row-id="b"][data-bp-selectable]')).toBeNull();
  act(() => cell('c').focus());
  act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
  expect(select).toHaveBeenCalledTimes(2);
  expect(select.mock.calls[1]![0]).toBe('c');
  expect(select.mock.calls[1]![1]).toMatchObject({ columnId: 'value', event: expect.objectContaining({ type: 'keydown' }) });
});

// A generic chart takes unknown props into its layout options, so a row callback meant for a table must never reach one.
it('keeps the row props away from a chart that is not a table', async () => {
  await import('../src/react/charts/column');
  const layout = vi.spyOn(getChart('column')!, 'layout');
  root = await mountRoot(<BoardplotChart spec={only('regions')} onRowSelect={() => {}} isRowSelectable={() => true} />);
  expect(host.querySelector('svg[data-bp-chart="column"]')).not.toBeNull();
  expect(layout).toHaveBeenCalled();
  for (const [, options] of layout.mock.calls) expect(Object.keys(options ?? {})).not.toEqual(expect.arrayContaining(['onRowSelect']));
  for (const [, options] of layout.mock.calls) expect(Object.keys(options ?? {})).not.toEqual(expect.arrayContaining(['isRowSelectable']));
});

// BoardplotChart linked the accessible data table and its record code into every first chart, also with the table off.
it('loads the data table module only for a spec that asks for the table', async () => {
  root = await mountRoot(<BoardplotChart spec={only('regions')} />);
  expect(host.querySelector('svg[data-bp-chart="column"]')).not.toBeNull();
  expect(dataTableLoads.count).toBe(0);
  act(() => root!.unmount());
  const asked = { ...only('regions'), charts: only('regions').charts.map(chart => ({ ...chart, options: { ...chart.options, a11y: { table: 'hidden' } } })) };
  root = await mountRoot(<BoardplotChart spec={asked} />);
  expect(dataTableLoads.count).toBe(1);
  expect(host.querySelector('[data-bp-a11y-table]')).not.toBeNull();
});

// A dimswitch spec drew a static picture through BoardplotChart: the reader could not fold a row, and a row pick never reached the host.
it('draws a dimswitch spec as the interactive table, in the view the spec sets, and passes row picks', async () => {
  const select = vi.fn();
  const chart = (variant: string) => <BoardplotChart spec={{ type: 'dimswitch', data: exampleData, options: { variant } }} onRowSelect={select} />;
  root = await mountRoot(chart('by-measure'));
  expect(host.querySelector('.bp-table-grid')).not.toBeNull();
  expect(host.querySelector('svg[data-bp-chart="dimswitch"]')).toBeNull();
  const rowIds = () => Array.from(host.querySelectorAll('[data-row-id]'), (row) => row.getAttribute('data-row-id'));
  const byMeasure = rowIds();
  act(() => { host.querySelector<HTMLElement>('[data-row-id] [data-bp-column]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  expect(select).toHaveBeenCalledTimes(1);
  await act(async () => { root!.render(chart('by-member')); });
  await settle(host);
  expect(rowIds()).not.toEqual(byMeasure);
});

// BoardplotChart had no wrapper of its own, so a host class sat on the chart only and the busy placeholder had none, and it took no text measurer.
it('puts className and style on one wrapper in every state and lays out with the host measurer', async () => {
  let calls = 0;
  const measure = Object.assign((...args: Parameters<typeof defaultMeasurer>) => { calls += 1; return defaultMeasurer(...args); }, defaultMeasurer);
  const chart = <BoardplotChart spec={only('regions')} className="card" style={{ margin: 4 }} measure={measure} />;
  expect(renderToString(chart)).toMatch(/^<div class="card" style="margin:4px"><div role="status"/);
  root = await mountRoot(chart);
  expect(host.children).toHaveLength(1);
  expect(host.querySelector(':scope > .card svg[data-bp-chart="column"]')).not.toBeNull();
  expect(host.querySelectorAll('.card')).toHaveLength(1);
  expect(calls).toBeGreaterThan(0);
});

// A container chart that mounts without a fallback size waits on the busy placeholder for its first width, so the reader saw the server's chart, then "Loading", then the chart.
it('replaces the prepared picture of a container chart without the busy placeholder', async () => {
  // jsdom has no ResizeObserver, and the chart waits for a width only where one exists.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const regions = only('regions');
  const prepared = await prepareChart({ ...(await parseChartSpec(regions, 'regions')).request, size: 'container' });
  const chart = <BoardplotChart spec={regions} size="container" prepared={prepared} />;
  host.innerHTML = renderToString(chart);
  const first = host.querySelector('svg')!;
  let busy = 0;
  const watcher = new MutationObserver(() => { if (host.querySelector('[data-bp-loading]')) busy += 1; });
  watcher.observe(host, { childList: true, subtree: true });
  await act(async () => { root = hydrateRoot(host, chart); });
  await vi.waitFor(() => expect(host.querySelector('svg')).not.toBe(first));
  watcher.disconnect();
  vi.unstubAllGlobals();
  expect(host.querySelector('[data-bp-container]')).not.toBeNull();
  expect(busy).toBe(0);
});

// The first frame drew a prepared chart for a spec with a key validation refuses, and inside a ScaleGroup, whose shared scale the prepared value does not hold.
it('draws no prepared chart for a spec it does not match or inside a ScaleGroup', async () => {
  const regions = only('regions');
  const prepared = await prepareChart((await parseChartSpec(regions, 'regions')).request);
  expect(renderToString(<BoardplotChart spec={regions} prepared={prepared} />)).toContain('<svg');
  const stray = { ...regions, charts: [{ ...regions.charts[0]!, unit: '%' }] };
  expect(renderToString(<BoardplotChart spec={stray} prepared={prepared} />)).toContain('data-bp-loading');
  expect(renderToString(<ScaleGroup group="g" members={[]}><BoardplotChart spec={regions} prepared={prepared} /></ScaleGroup>)).toContain('data-bp-loading');
});

// A spec and the request prepared from it compared in two different forms, so a language tag, a bare chart's theme or an undefined option lost the first chart or broke hydration once JSON carried the spec.
it('draws the prepared chart in the first frame for every form of the same chart', async () => {
  const kpi = { type: 'kpi', data: { label: 'Sales', value: 1 } };
  // The server reads the spec as written, the browser as JSON carried it: both draw the chart.
  const first = async (spec: object, prepared: object) => [spec, JSON.parse(JSON.stringify(spec)) as object]
    .map((form) => renderToString(<BoardplotChart spec={form} prepared={prepared as never} />)).join('');
  const charts = (html: string) => html.split('<svg').length - 1;
  const tagged = { ...kpi, options: { locale: 'de-DE' } };
  expect(charts(await first(tagged, await prepareChart(tagged as never)))).toBe(2);
  const themed = { ...kpi, theme: 'standard-dark' };
  expect(charts(await first(themed, await prepareChart((await parseChartSpec(themed)).request)))).toBe(2);
  const untitled = { ...kpi, options: { title: undefined } };
  expect(charts(await first(untitled, await prepareChart(untitled as never)))).toBe(2);
  // The host's theme prop wins over the chart's own theme, so a chart prepared with the chart's theme is another chart.
  const light = renderToString(<BoardplotChart spec={themed} theme="standard" prepared={await prepareChart((await parseChartSpec(themed)).request) as never} />);
  expect(light).toContain('data-bp-loading');
  // A request's top-level target wins over its options, so a slide chart is not the report chart of the spec.
  const slide = await prepareChart({ ...kpi, target: 'slide', options: { target: 'report' } } as never);
  expect(renderToString(<BoardplotChart spec={{ ...kpi, options: { target: 'report' } }} prepared={slide as never} />)).toContain('data-bp-loading');
  expect(charts(renderToString(<BoardplotChart spec={kpi} target="slide" prepared={slide as never} />))).toBe(1);
  // The match read the spec a second way beside the parser, so a short form, a one-chart document or a prop over the spec's target showed the loading box.
  const sorted = { type: 'bar', data: { categories: ['North', 'South'], series: [{ id: 'orders', values: [35, 42] }] }, options: { sort: 'desc' } };
  expect(charts(await first(sorted, await prepareChart((await parseChartSpec(sorted)).request)))).toBe(2);
  const german = await prepareChart({ ...kpi, options: { locale: 'de-DE' } } as never);
  expect(charts(await first({ version: 1, locale: 'de-DE', charts: [{ name: 'sales', ...kpi }] }, german))).toBe(2);
  const report = await prepareChart((await parseChartSpec({ ...kpi, options: { target: 'report' } })).request);
  expect(charts(renderToString(<BoardplotChart spec={{ ...kpi, options: { target: 'slide' } }} target="report" prepared={report as never} />))).toBe(1);
  expect(renderToString(<BoardplotChart spec={{ ...kpi, options: { target: 'slides' } }} target="report" prepared={report as never} />)).toContain('data-bp-loading');
  // A spec that validation refuses read like a valid one, so its first chart showed before the error card.
  expect(renderToString(<BoardplotChart spec={{ ...kpi, options: null }} prepared={await prepareChart(kpi as never) as never} />)).toContain('data-bp-loading');
  // An option set to undefined hid the document's root locale only while the spec was not carried as JSON, so the live chart and the first chart differed.
  const unset = { version: 1, locale: 'de-DE', charts: [{ name: 'sales', ...kpi, options: { locale: undefined } }] };
  expect((await parseChartSpec(unset)).request.options?.locale).toEqual({ language: 'de-DE' });
  const begun = beginSpecParse(unset);
  await loadChartTypes(begun.types, { schemas: true, cores: false });
  expect(begun.finish().request.options?.locale).toEqual({ language: 'de-DE' });
});
