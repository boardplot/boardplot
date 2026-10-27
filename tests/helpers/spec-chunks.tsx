/**
 * BoardplotChart links spec validation and each chart type's engine on demand,
 * and its server pass draws the busy placeholder whatever this process has
 * already loaded — that is what keeps one server's output the same before and
 * after warm-up, and what the pass that hydrates it matches. A test that
 * wants the drawn chart therefore mounts it in a browser and waits for the
 * chunks, the way a browser does.
 */
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/** Waits while a busy placeholder is on the page. Loading a chunk is a real module load. */
export async function settle(host: HTMLElement, timeout = 20_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (host.querySelector('[data-bp-loading]') && Date.now() < deadline) {
    await act(async () => { await new Promise((done) => { setTimeout(done, 10); }); });
  }
}

/** Mounts into `host` and returns the root once every chunk it asked for is there. */
export async function mount(element: ReactElement, host: HTMLElement): Promise<Root> {
  let root: Root | undefined;
  await act(async () => { root = createRoot(host); root.render(element); });
  await settle(host);
  return root!;
}

/** The markup one mount draws, with the root unmounted again. */
export async function mountedMarkup(element: ReactElement): Promise<string> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = await mount(element, host);
  const markup = host.innerHTML;
  await act(async () => { root.unmount(); });
  host.remove();
  return markup;
}
