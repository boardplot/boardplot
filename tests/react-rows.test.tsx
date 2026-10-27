// @vitest-environment jsdom
import { act } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getChart } from '../src/core/registry';
import { ColumnChart } from '../src/react/charts/column';
import { LineChart } from '../src/react/charts/line';
import { prepareChart } from '../src/react/prepare';
import { BoardplotChart } from '../src/react/spec';
import { useExport } from '../src/react/export';
import { specFromRows } from '../src/rows';
import { mount, mountedMarkup } from './helpers/spec-chunks';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const rows = [
  { month: '2026-01', channel: 'Search', revenue: 120, owner: 'Ana' },
  { month: '2026-01', channel: 'Social', revenue: 80, owner: 'Ana' },
  { month: '2026-02', channel: 'Search', revenue: 135, owner: 'Ben' },
  { month: '2026-02', channel: 'Social', revenue: 95, owner: 'Ben' },
];
const columns = { category: 'month', series: 'channel', value: 'revenue' } as const;
const size = { width: 640, height: 360 };
const svgOf = (markup: string) => /<svg[\s\S]*<\/svg>/.exec(markup)?.[0]?.replace(/_r_\w+_/g, 'id');

let host: HTMLDivElement;
let root: Root | undefined;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); });
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; host.remove(); vi.restoreAllMocks(); });

describe('rows and columns props', () => {
  // The props must map through the one rows transform: a second mapping would let React and specFromRows draw different charts.
  // Line reads its data while the request resolves, and zoom reads it too, so the frames before the rows chunk lands must read none.
  it('draws the chart specFromRows builds and reports its reading once', async () => {
    const { spec, reading } = specFromRows({ type: 'line' }, { rows, columns });
    const onRowsReading = vi.fn();
    const fromRows = await mountedMarkup(<LineChart rows={rows} columns={columns} onRowsReading={onRowsReading} title="Revenue" size={size} zoom />);
    const fromData = await mountedMarkup(<LineChart data={spec.data as never} title="Revenue" size={size} zoom />);
    expect(svgOf(fromRows)).toBeDefined();
    expect(svgOf(fromRows)).toBe(svgOf(fromData));
    expect(onRowsReading.mock.calls).toEqual([[reading]]);
    expect(reading.ignoredColumns).toEqual(['owner']);
  });

  // A server render must hydrate to the chart it wrote; a client that needed the rows chunk first would swap in the busy box (React #418).
  it('prepareChart maps the same rows, and hydration draws its SVG without the rows chunk or a layout', async () => {
    const { spec } = specFromRows({ type: 'column' }, { rows, columns });
    const prepared = JSON.parse(JSON.stringify(await prepareChart({ type: 'column', rows, columns, options: { title: 'Revenue', size } })));
    const fromData = await prepareChart({ type: 'column', data: spec.data, options: { title: 'Revenue', size } });
    expect(prepared.requestKey).toBe(fromData.requestKey);
    const chart = <ColumnChart rows={rows} columns={columns} title="Revenue" size={size} prepared={prepared} />;
    host.innerHTML = renderToString(chart);
    const svg = host.querySelector('svg');
    expect(svg).not.toBeNull();
    const layout = vi.spyOn(getChart('column')!, 'layout');
    const errors = vi.fn();
    await act(async () => { root = hydrateRoot(host, chart, { onRecoverableError: errors }); });
    await act(async () => { await import('../src/react/rowsModule'); });
    expect(host.querySelector('svg') === svg).toBe(true);
    expect(errors).not.toHaveBeenCalled();
    expect(layout).not.toHaveBeenCalled();
  });

  // A typo in one row must name that row with the CLI's code, in the card each component already draws for a refused spec.
  it('refuses unmappable rows with the InputError code and the rows path', async () => {
    const typo = [...rows, { month: '2026-03', channel: 'Search', revenue: '1,234 $' }];
    let thrown: { code: string; details: { path?: string } } | undefined;
    try { specFromRows({ type: 'column' }, { rows: typo, columns }); } catch (error) { thrown = error as typeof thrown; }
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const card = await mountedMarkup(<ColumnChart rows={typo} columns={columns} size={size} />);
    expect(card).toContain('role="alert"');
    expect(card).toContain(thrown!.code);
    expect(card).toContain('rows.4.revenue');
    const specCard = await mountedMarkup(<BoardplotChart spec={{ type: 'column' }} rows={typo} columns={columns} size={size} />);
    expect(specCard).toContain(thrown!.code);
    expect(specCard).toContain(thrown!.details.path);
    // A missing spec without rows still draws its validation card, not the busy box for good.
    expect(await mountedMarkup(<BoardplotChart spec={undefined} />)).toContain('role="alert"');
    // A type without a rows mapping answers as boardplot_render does.
    expect(await mountedMarkup(<BoardplotChart spec={{ type: 'treemap' }} rows={rows} columns={columns} />)).toContain('rows-unsupported-type');
  });

  // The export link must print the chart the reader sees, so it has to lay out the mapped data, not the empty template.
  it('exports the mapped chart through the exporter link', async () => {
    const { spec } = specFromRows({ type: 'column' }, { rows, columns });
    let handle: ReturnType<typeof useExport> | undefined;
    function Page({ fromRows }: { fromRows: boolean }) {
      handle = useExport();
      return fromRows ? <ColumnChart rows={rows} columns={columns} title="Revenue" size={size} exporter={handle} />
        : <ColumnChart data={spec.data as never} title="Revenue" size={size} exporter={handle} />;
    }
    const exported = async (fromRows: boolean) => {
      const root = await mount(<Page fromRows={fromRows} />, host);
      const result = await handle!.svg();
      act(() => root.unmount());
      return result.ok ? result.artifact.text : result.message;
    };
    const fromRows = await exported(true);
    expect(fromRows).toContain('<svg');
    expect(fromRows).toBe(await exported(false));
  });
});
