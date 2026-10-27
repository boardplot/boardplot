// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { act, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { resolveChartRequest } from '../src/core/request';
import type { TableData, TableOptions } from '../src/core/types/table';
import { prepareTableRender } from '../src/react/preparedTable';
import { TableChart } from '../src/react/TableChart';
import { useStableValue } from '../src/react/useStableValue';

// A frozen outer prop must not leave edited nested data or options stale on screen.
it('updates shallow-frozen nested values and reuses equal content', () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  let renders = 0;
  function Readout({ data }: { data: { nested: { value: number } } }) {
    const stable = useStableValue(data);
    return <output>{useMemo(() => { renders++; return stable.nested.value; }, [stable])}</output>;
  }
  const data = Object.freeze({ nested: { value: 1 } });
  act(() => root.render(<Readout data={data} />));
  data.nested.value = 2;
  act(() => root.render(<Readout data={data} />));
  expect(host.textContent).toBe('2');
  act(() => root.render(<Readout data={{ nested: { value: 2 } }} />));
  expect(renders).toBe(2);
  act(() => root.unmount());
});

const columns: TableData['columns'] = [
  { id: 'row/name?', kind: 'rowLabel', label: 'Row' },
  { id: 'actual %:q?', kind: 'value', label: 'Actual' },
];
const rows: TableData['rows'] = [
  { id: 'north/east:1', label: 'North', cells: { 'actual %:q?': 12 } },
  { id: 'south west%', label: 'South', cells: { 'actual %:q?': 8 } },
];
const options: TableOptions = { title: 'Hooks' };

function render(data: TableData, prepared = false): HTMLElement {
  const snapshot = prepared
    ? prepareTableRender(resolveChartRequest({ type: 'table', data, options }))
    : undefined;
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(<TableChart data={data} {...options} prepared={snapshot} />);
  return host;
}

function hooks(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('[data-bp-label],[data-bp-mark]'))
    .map(element => element.getAttribute('data-bp-label') ?? element.getAttribute('data-bp-mark')!)
    .sort();
}

function testingAttributes(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('[data-bp-chart],[data-bp-row],[data-bp-column],[data-bp-label],[data-bp-mark]'))
    .map(element => ['data-bp-chart', 'data-bp-row', 'data-bp-column', 'data-bp-label', 'data-bp-mark']
      .flatMap(name => element.hasAttribute(name) ? [`${element.tagName}:${name}=${element.getAttribute(name)}`] : []))
    .flat()
    .sort();
}

describe('table testing attributes', () => {
  it('keeps semantic hooks stable across row reordering and prepared rendering', () => {
    const data = { columns, rows };
    const reordered = { columns, rows: [...rows].reverse() };
    const fresh = render(data);
    const prepared = render(data, true);
    const reorderedFresh = render(reordered);

    expect(testingAttributes(prepared)).toEqual(testingAttributes(fresh));
    expect(hooks(reorderedFresh)).toEqual(hooks(fresh));
    expect(fresh.querySelector('figure')?.getAttribute('data-bp-chart')).toBe('table');

    const rowKey = encodeURIComponent('north/east:1');
    const labelKey = `${rowKey}:${encodeURIComponent('row/name?')}`;
    const markKey = `${rowKey}:${encodeURIComponent('actual %:q?')}`;
    const row = fresh.querySelector(`[role="row"][data-bp-row="north/east:1"]`)!;
    const label = fresh.querySelector(`[data-bp-label="${labelKey}"]`)!;
    const mark = fresh.querySelector(`[data-bp-mark="${markKey}"]`)!;

    expect(row.getAttribute('data-row-id')).toBe('north/east:1');
    expect(label.getAttribute('role')).toBe('rowheader');
    expect(label.getAttribute('data-bp-row')).toBe('north/east:1');
    expect(label.getAttribute('data-bp-column')).toBe('row/name?');
    expect(mark.getAttribute('role')).toBe('gridcell');
    expect(mark.getAttribute('data-bp-row')).toBe('north/east:1');
    expect(mark.getAttribute('data-bp-column')).toBe('actual %:q?');
    expect(mark.getAttribute('data-col-id')).toBe('actual %:q?');
    expect(mark.getAttribute('data-state')).toBe('value');
    expect(fresh.querySelector('.bp-columns [data-bp-column="actual %:q?"]')?.getAttribute('data-col-id')).toBe('actual %:q?');
    expect(fresh.querySelector('.bp-columns [role="columnheader"][data-bp-column="actual %:q?"]')?.getAttribute('data-col-id')).toBe('actual %:q?');
    expect(fresh.querySelector('.bp-table-grid')?.hasAttribute('data-bp-wired')).toBe(true);
  });
});
