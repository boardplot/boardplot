/**
 * The chart widget's module, a few KB. It asks the page for the runtime
 * widget's exports, checks the build identity and mounts the chart. When the
 * runtime cannot be reached it shows the static SVG and one line why.
 */
import type { MountEvent, MountHandle, MountOptions, MountStatus } from './mount';
import { identity as loaderIdentity, sameIdentity, type BuildIdentity } from './identity';

interface Model {
  get(name: string): unknown;
  on(event: string, callback: (...args: unknown[]) => void): void;
  off(event?: string | null, callback?: ((...args: unknown[]) => void) | null): void;
  set(name: string, value: unknown): void;
  save_changes(): void;
  send(content: unknown): void;
}

interface Host {
  getWidget?: (ref: unknown) => Promise<{ exports: unknown }>;
}

interface RenderProps {
  model: Model;
  el: HTMLElement;
  host?: Host;
  signal?: AbortSignal;
}

interface RuntimeExports {
  mount: (el: HTMLElement, options: MountOptions) => MountHandle;
  identity: BuildIdentity;
}

/**
 * Covers the whole `host.getWidget` call: anywidget's own 10 s timer starts
 * only after the runtime model is found, and other hosts may have none.
 */
const RUNTIME_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer within ${ms / 1000} s`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/** The static SVG as an image (no markup from the model enters the page), plus the reason. */
function showFallback(el: HTMLElement, svg: unknown, reason: string): void {
  el.replaceChildren();
  if (typeof svg === 'string' && svg.length > 0) {
    const img = document.createElement('img');
    img.alt = 'Boardplot chart (static view)';
    img.style.maxWidth = '100%';
    img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    img.addEventListener('load', () => URL.revokeObjectURL(img.src), { once: true });
    el.appendChild(img);
  }
  const note = document.createElement('div');
  note.setAttribute('data-bp-fallback', '');
  note.style.cssText = 'font: 12px system-ui, sans-serif; opacity: 0.7; margin-top: 4px;';
  note.textContent = `Static view: ${reason}`;
  el.appendChild(note);
}

async function render({ model, el, host, signal }: RenderProps): Promise<void> {
  // Status and the reactive click state go through synced traits (marimo reruns on state updates).
  const sync = (name: string, value: unknown) => { model.set(name, value); model.save_changes(); };
  const revision = () => Number(model.get('revision') ?? 0);
  const sendStatus = (status: MountStatus) => sync('status', status);
  const fail = (reason: string) => {
    showFallback(el, model.get('fallback_svg'), reason);
    sendStatus({ state: 'error', revision: revision(), detail: { message: reason } });
    if (signal?.aborted) return;
    // The static SVG belongs to the first spec: after a spec change it would show old numbers, so drop it.
    const onRevision = () => {
      const stale = `${reason} The chart changed after this view was drawn; run the cell again.`;
      showFallback(el, '', stale);
      sendStatus({ state: 'error', revision: revision(), detail: { message: stale } });
    };
    model.on('change:revision', onRevision);
    signal?.addEventListener('abort', () => model.off('change:revision', onRevision), { once: true });
  };

  let runtime: RuntimeExports;
  try {
    if (typeof host?.getWidget !== 'function') {
      fail('this notebook front end has no widget composition (needs anywidget 0.11 or later).');
      return;
    }
    const child = await withTimeout(host.getWidget(model.get('runtime')), RUNTIME_TIMEOUT_MS);
    runtime = child.exports as RuntimeExports;
  } catch (error) {
    fail(`the Boardplot runtime did not load (${error instanceof Error ? error.message : String(error)}).`);
    return;
  }
  if (signal?.aborted) return;
  if (!runtime || typeof runtime.mount !== 'function') {
    fail('the Boardplot runtime has no mount function.');
    return;
  }
  const expected = model.get('identity');
  if (!sameIdentity(runtime.identity, expected) || !sameIdentity(loaderIdentity, expected)) {
    fail('the Boardplot browser code and the Python package come from different builds. Restart the kernel.');
    return;
  }

  el.replaceChildren();
  // Inside an ipywidgets HBox or VBox the view is a flex item, which takes its
  // content's width; a container-sized chart then grows to its natural width.
  el.style.width = '100%';
  el.style.minWidth = '0';
  const handle = runtime.mount(el, {
    spec: model.get('spec'),
    hover: model.get('hover') !== false,
    clicks: true,
    revision: revision(),
    onEvent: (event: MountEvent) => {
      // Callbacks: one custom message per click, so a burst loses none (ipywidgets merges pending state updates).
      model.send({ type: 'event', ...event });
      // Reactivity: the last record and its seq as synced state; Python runs no callback from these.
      model.set('selection', event.record);
      model.set('event_seq', event.seq);
      model.save_changes();
    },
    onStatus: sendStatus,
  });
  const onSpec = () => handle.update({ spec: model.get('spec'), revision: revision() });
  const onRevision = () => handle.update({ revision: revision() });
  const onHover = () => handle.update({ hover: model.get('hover') !== false });
  model.on('change:spec', onSpec);
  model.on('change:revision', onRevision);
  model.on('change:hover', onHover);
  signal?.addEventListener('abort', () => {
    model.off('change:spec', onSpec);
    model.off('change:revision', onRevision);
    model.off('change:hover', onHover);
    handle.unmount();
  }, { once: true });
}

export default { render };
