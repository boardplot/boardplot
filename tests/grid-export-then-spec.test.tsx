// @vitest-environment jsdom
// An export registers the grid core without the grid entry. A BoardplotChart grid drawn after it,
// in the same process, must still fetch its panels' cores; it refused a panel type the export had not loaded.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Buffer } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { getChart } from '../src/core/registry';
import { exportSvg } from '../src/react/export';
import { BoardplotChart } from '../src/react/spec';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const grid = (type: string) => ({
  type: 'grid',
  data: { panels: [{ id: 'p', type, data: { categories: [{ id: 'North' }, { id: 'South' }], series: [{ id: 's', label: 'Orders', values: [42, 35] }] } }] },
  options: { size: { width: 800, height: 450 } },
});

it('draws a grid through BoardplotChart after an export registered the grid core', async () => {
  if (!globalThis.crypto?.subtle) vi.stubGlobal('crypto', { subtle: { digest: (algorithm: string, input: ArrayBuffer) =>
    webcrypto.subtle.digest(algorithm, Buffer.from(new Uint8Array(input))) } });
  const exported = await exportSvg({ spec: grid('column') });
  expect(exported.ok).toBe(true);
  expect(getChart('grid')).toBeDefined();
  expect(getChart('bar')).toBeUndefined();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(<BoardplotChart spec={grid('bar')} />); });
  const deadline = Date.now() + 20_000;
  while (host.querySelector('[data-bp-loading]') && Date.now() < deadline) {
    await act(async () => { await new Promise(settled => setTimeout(settled, 10)); });
  }
  expect(host.textContent).not.toContain('unknown chart type');
  expect(host.querySelector('svg')).not.toBeNull();
  expect(getChart('bar')).toBeDefined();
  await act(async () => { root.unmount(); });
  host.remove();
});
