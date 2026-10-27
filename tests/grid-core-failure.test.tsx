// @vitest-environment jsdom
// Two grids load their panels' cores in one round. A core whose chunk fails refused every grid of
// that round, and a core that loaded beside it sent no redraw: the bar grid never drew.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { getChart } from '../src/core/registry';
import { GridChart } from '../src/react/charts/grid';

vi.mock('../src/react/coreLoaders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/react/coreLoaders')>();
  return { coreLoaders: { ...actual.coreLoaders, column: () => Promise.reject(new Error('column chunk is missing')) } };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const panels = (type: string) => ({ panels: [{ id: 'p', type, data: { categories: [{ id: 'North' }, { id: 'South' }], series: [{ id: 's', label: 'Orders', values: [42, 35] }] } }] });
const Grid = GridChart as unknown as (props: Record<string, unknown>) => ReturnType<typeof GridChart>;

it('draws the grid whose panel core loaded when another grid\'s core fails in the same round', async () => {
  expect(getChart('column')).toBeUndefined();
  expect(getChart('bar')).toBeUndefined();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<>
      <div data-grid="column"><Grid data={panels('column')} size={{ width: 800, height: 450 }} /></div>
      <div data-grid="bar"><Grid data={panels('bar')} size={{ width: 800, height: 450 }} /></div>
    </>);
  });
  const bar = host.querySelector('[data-grid=bar]')!;
  const column = host.querySelector('[data-grid=column]')!;
  const deadline = Date.now() + 10_000;
  while ((bar.querySelector('[data-bp-loading]') || column.querySelector('[data-bp-loading]')) && Date.now() < deadline) {
    await act(async () => { await new Promise(settled => setTimeout(settled, 10)); });
  }
  expect(getChart('bar')).toBeDefined();
  expect(bar.querySelector('svg')).not.toBeNull();
  expect(bar.innerHTML).not.toContain('chunk-load-failed');
  expect(column.innerHTML).toContain('chunk-load-failed');
  expect(column.textContent).toContain('column chunk is missing');
  await act(async () => { root.unmount(); });
  host.remove();
});
