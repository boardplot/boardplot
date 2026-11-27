// @vitest-environment jsdom
// Input that reaches a chart before its hover code is on the page. Its own file: a chart takes the hover code at once when
// an earlier test of the same file has loaded it, and these inputs must arrive before it.
import './helpers/hover-viewport';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '../src/core/charts';
import { ColumnChart } from '../src/react/charts/column';
import { loadHoverEngine } from '../src/react/useHover';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement;
let root: Root | undefined;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); });
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; host.remove(); vi.restoreAllMocks(); });
const keyStop = () => host.querySelector<HTMLElement>('[data-bp-keys]')!;
const option = () => host.querySelector('[data-bp-keys] [role="option"]')?.textContent ?? undefined;

// A key held down while the hover code loads queued dozens of inputs: their replay crashed the chart, and a held Enter gave onRecordClick an event without its methods.
it('replays a long run of held keys and gives a held Enter its keyboard event', async () => {
  const data = { categories: Array.from({ length: 60 }, (_, index) => `C${index + 1}`), series: [{ id: 'v', label: 'Value', values: Array.from({ length: 60 }, (_, index) => index + 1) }] };
  const clicked: string[] = [];
  root = createRoot(host);
  await act(async () => { root!.render(<ColumnChart data={data} size={{ width: 1200, height: 450 }} onRecordClick={(record, event) => { event.stopPropagation(); clicked.push(record.target.owner.categoryId as string); }} />); });
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  // One turn: every key reaches the chart before React renders again.
  act(() => {
    keyStop().focus();
    for (let step = 0; step < 40; step++) keyStop().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    keyStop().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
  await act(async () => { await loadHoverEngine(); });
  expect(errors).not.toHaveBeenCalled();
  expect(option()).toContain('C41');
  expect(clicked).toEqual(['C41']);
});
