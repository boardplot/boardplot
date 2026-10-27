import { settle } from './helpers/spec-chunks';
// @vitest-environment jsdom

import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/core/charts';
import { render } from '../src/cli/render';
import { canDraw } from '../src/index';
import { getChart, listCharts } from '../src/core/registry';
import { getFixtures } from '../src/fixtures';
import { BoardplotTheme } from '../src/react/BoardplotTheme';
import { ColumnChart } from '../src/react/charts/column';
import { BoardplotChart } from '../src/react/spec';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const none = { categories: [], series: [] };
// One empty main collection for each family of data shapes.
const EMPTY: Record<string, unknown> = {
  column: none, bar: none, line: none, pie: none, funnel: none, heatmap: none,
  scatter: { points: [] }, bullet: { rows: [] }, waterfall: { items: [] }, gantt: { rows: [] },
  sparkline: { values: [] }, histogram: { observations: [] }, cohort: { cohorts: [] }, diagram: { nodes: [], edges: [] },
  pyramid: { bands: [], groups: [] }, box: { groups: [] }, status: { rows: [], columns: [] },
};

describe('empty-data, the one code for a chart with nothing to draw', () => {
  it.each(Object.keys(EMPTY))('%s reports it from the layout', (type) => {
    expect(() => getChart(type)!.layout(EMPTY[type] as never, (type === 'diagram' ? { variant: 'hierarchy' } : {}) as never)).toThrow(expect.objectContaining({ code: 'empty-data' }));
  });
  it('is the code of the schema finding too', () => {
    const body = render({ spec: { type: 'column', data: none } }).body as { errors: { code: string }[] };
    expect(body.errors.map((error) => error.code)).toEqual(['empty-data', 'empty-data']);
  });
});

describe('canDraw', () => {
  const data = { categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], series: [{ id: 's', values: [1, 2] }] };
  it('answers without drawing: empty data, a canvas below its floor, or fine', () => {
    expect(canDraw({ type: 'column', data: none })).toMatchObject({ ok: false, code: 'empty-data' });
    expect(canDraw({ type: 'column', data, options: { size: { width: 260, height: 100 } } }))
      .toMatchObject({ ok: false, code: 'size-below-floor', minimum: { width: 280, height: 180 } });
    expect(canDraw({ type: 'column', data, options: { belowMinimum: 'refuse', size: { width: 400, height: 200 } } }))
      .toMatchObject({ ok: false, code: 'size-below-floor', minimum: { width: 480, height: 270 } });
    expect(canDraw({ type: 'column', data })).toEqual({ ok: true });
  });
});

describe('the React surfaces', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it('shows the empty message, not renderRefused, and calls onEmpty and never onRefused', async () => {
    const onEmpty = vi.fn(); const onRefused = vi.fn(); const renderRefused = vi.fn(() => 'host refusal');
    await act(async () => root.render(createElement(ColumnChart as never, { data: none, size: { width: 600, height: 300 }, onEmpty, onRefused, renderRefused })));
    await settle(container);
    expect(container.querySelector('[data-bp-empty]')?.textContent).toContain('No data to show.');
    expect(onEmpty).toHaveBeenCalledTimes(1);
    expect(onRefused).not.toHaveBeenCalled();
    expect(renderRefused).not.toHaveBeenCalled();
  });

  it('calls onEmpty once per empty state, whatever callback the parent passes', async () => {
    const calls: number[] = [];
    const full = { categories: [{ id: 'a', label: 'A' }], series: [{ id: 's', values: [1] }] };
    const size = { width: 600, height: 300 };
    const settle = async () => { await act(async () => { await new Promise((done) => { setTimeout(done, 50); }); }); };
    const charts = [
      (data: unknown, n: number) => createElement(ColumnChart as never, { data, size, onEmpty: () => calls.push(n) }),
      (data: unknown, n: number) => createElement(BoardplotChart as never, { spec: { type: 'column', data }, size, onEmpty: () => calls.push(n) }),
    ];
    for (const chart of charts) {
      calls.length = 0;
      for (const n of [1, 2, 3, 4]) { await act(async () => { root.render(chart(none, n)); }); await settle(); }
      // The count is the contract: which of the four callbacks runs depends on when the chart load finishes.
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      await act(async () => { root.render(chart(full, 5)); }); await settle();
      await act(async () => { root.render(chart(none, 6)); }); await settle();
      await vi.waitFor(() => expect(calls).toHaveLength(2));
      expect(calls[1]).toBe(6);
    }
  });

  it('calls onEmpty once under StrictMode, and again after a non-empty to empty change', async () => {
    const onEmpty = vi.fn();
    const full = { categories: [{ id: 'a', label: 'A' }], series: [{ id: 's', values: [1] }] };
    const chart = (data: unknown) => createElement(StrictMode, null, createElement(ColumnChart as never, { data, size: { width: 600, height: 300 }, onEmpty }));
    await act(async () => { root.render(chart(none)); });
    expect(onEmpty).toHaveBeenCalledTimes(1);
    await act(async () => { root.render(chart(full)); });
    await act(async () => { root.render(chart(none)); });
    expect(onEmpty).toHaveBeenCalledTimes(2);
  });

  it('calls onEmpty once and shows the default or the provider wording', async () => {
    const onEmpty = vi.fn();
    act(() => root.render(createElement(ColumnChart as never, { data: none, size: { width: 600, height: 300 }, onEmpty })));
    await settle(container);
    expect(onEmpty).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-bp-empty]')?.textContent).toContain('No data to show.');
    act(() => root.render(createElement(BoardplotTheme, { strings: { emptyMessage: 'Nothing here' } },
      createElement(ColumnChart as never, { data: none, size: { width: 600, height: 300 }, onEmpty }))));
    expect(container.querySelector('[data-bp-empty]')?.textContent).toContain('Nothing here');
  });
  it('does the same for a spec', async () => {
    const onEmpty = vi.fn();
    await act(async () => {
      root.render(createElement(BoardplotChart, { spec: { type: 'column', data: none }, size: { width: 600, height: 300 }, onEmpty }));
    });
    for (let i = 0; i < 400 && !container.querySelector('[data-bp-empty], [data-bp-spec-error]'); i++) {
      await act(async () => { await new Promise((done) => { setTimeout(done, 10); }); });
    }
    expect(onEmpty).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-bp-empty]')).not.toBeNull();
    expect(container.querySelector('[data-bp-spec-error]')).toBeNull();
  });
});

// Every top-level data array of a type, emptied together: the schema and canDraw both say empty-data, whatever the schema's minimum.
// Types left out: choropleth needs a geo pack; table has its own no-row rule; kpi has no top-level array (see below).
describe('a collection with zero items is empty-data, whatever its minimum', () => {
  const types = listCharts().map((chart) => chart.type).filter((type) => !['choropleth', 'table', 'creative', 'kpi', 'bartable'].includes(type));
  const emptied = (type: string) => {
    const data = getFixtures(type)[0]?.data as Record<string, unknown> | undefined;
    return { type, data: Object.fromEntries(Object.entries(data ?? {}).map(([key, value]) => [key, Array.isArray(value) ? [] : value])), options: getFixtures(type)[0]?.options };
  };
  it.each(types)('%s', (type) => {
    const spec = emptied(type);
    const errors = (render({ spec }).body as { errors: { code: string }[] }).errors;
    expect([...new Set(errors.map((error) => error.code))]).toEqual(['empty-data']);
    expect(canDraw(spec as never)).toMatchObject({ ok: false, code: 'empty-data' });
  });
  it.each([['slope', 'categories'], ['butterfly', 'series'], ['butterfly', 'categories']])('%s with empty %s (minimum 2)', (type, key) => {
    const fixture = getFixtures(type)[0]!;
    const spec = { type, data: { ...(fixture.data as object), [key]: [] }, options: fixture.options };
    const codes = (render({ spec }).body as { errors: { code: string }[] }).errors.map((error) => error.code);
    expect(codes.length).toBeGreaterThan(0);
    expect(new Set(codes)).toEqual(new Set(['empty-data']));
    expect(canDraw(spec as never)).toMatchObject({ code: 'empty-data' });
  });
  it('keeps a non-empty collection below its minimum as invalid-data', () => {
    const fixture = getFixtures('butterfly')[0]!;
    const series = (fixture.data as { series: unknown[] }).series.slice(0, 1);
    const codes = (render({ spec: { type: 'butterfly', data: { ...(fixture.data as object), series }, options: fixture.options } }).body as { errors: { code: string }[] }).errors.map((error) => error.code);
    expect(codes).toContain('invalid-data');
    expect(codes).not.toContain('empty-data');
  });
});

describe('tilemap, dimswitch and kpi', () => {
  it('kpi treats compare: [] like an absent compare', () => {
    const fixture = getFixtures('kpi').find((f) => !(f.data as { delta?: unknown }).delta)!;
    const spec = { type: 'kpi', data: { ...(fixture.data as object), compare: [] }, options: fixture.options };
    expect((render({ spec }).body as { errors: unknown[] }).errors).toEqual([]);
    expect(canDraw(spec as never)).toEqual({ ok: true });
  });
  it('kpi still refuses delta together with a non-empty compare', () => {
    const fixture = getFixtures('kpi').find((f) => (f.data as { delta?: unknown }).delta)!;
    const compare = [{ vs: 1, label: 'PY' }];
    expect(canDraw({ type: 'kpi', data: { ...(fixture.data as object), compare }, options: fixture.options } as never)).toMatchObject({ ok: false });
    expect(canDraw({ type: 'kpi', data: { ...(fixture.data as object), compare: [] }, options: fixture.options } as never)).toEqual({ ok: true });
  });
  it('tilemap with the regions listed in the fixture still draws', () => {
    const fixture = getFixtures('tilemap')[0]!;
    expect(canDraw({ type: 'tilemap', data: fixture.data, options: fixture.options } as never)).toEqual({ ok: true });
  });
  it('dimswitch with an emptied view is one empty-data finding, not invalid-data', () => {
    const fixture = getFixtures('dimswitch')[0]!;
    for (const key of ['facts', 'periods', 'measures']) {
      const spec = { type: 'dimswitch', data: { ...(fixture.data as object), [key]: [] }, options: fixture.options };
      expect([...new Set((render({ spec }).body as { errors: { code: string }[] }).errors.map((e) => e.code))]).toEqual(['empty-data']);
      expect(canDraw(spec as never)).toMatchObject({ ok: false, code: 'empty-data' });
    }
  });
});

// A host must hide the same empty table whether the caller uses its type or its alias.
it('gives table and tbl the same canDraw answer for empty, totals-only and populated rows', () => {
  const columns = [{ id: 'label', kind: 'rowLabel', label: 'Item' }, { id: 'v', kind: 'value', label: 'Value' }];
  for (const rows of [[], [{ id: 'total', role: 'total', label: 'Total', cells: { v: 0 } }],
    [{ id: 'row', label: 'Row', cells: { v: 3 } }]]) {
    const canonical = canDraw({ type: 'table', data: { columns, rows } });
    expect(canDraw({ type: 'tbl', data: { columns, rows } })).toEqual(canonical);
    expect(canonical.ok).toBe(rows[0]?.id === 'row');
    for (const type of ['table', 'tbl']) {
      const geometry = getChart(type)!.layout({ columns, rows } as never, {} as never);
      expect(geometry.refused).not.toBe(true);
      expect(geometry).toEqual(getChart('table')!.layout({ columns, rows } as never, {} as never));
    }
  }
});
