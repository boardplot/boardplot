/**
 * The Streamlit Components v2 entry of Boardplot's Python package.
 *
 * Streamlit calls the default export with the component's arguments each time
 * the Python side sends new data. One mount per component instance lives
 * across those calls, keyed by `parentElement` (a ShadowRoot under Streamlit's
 * default style isolation). The returned function unmounts it when Streamlit
 * removes the instance.
 *
 * Data from Python: `{ spec, clicks, hover, identity }`. Clicks go back only
 * when `clicks` is true: the record as the trigger value `click` (one script
 * rerun per click) and as the state value `selection`. The view status stays
 * in the browser, because every value sent to Python reruns the script.
 */
import { mount, type MountHandle, type MountStatus } from './mount';
import { identity as bundleIdentity, sameIdentity } from './identity';

/** The renderer arguments of Streamlit's Components v2 (`FrontendRendererArgs`). */
export interface FrontendRendererArgs {
  data: unknown;
  key: string;
  name: string;
  parentElement: HTMLElement | ShadowRoot;
  setStateValue: (name: string, value: unknown) => void;
  setTriggerValue: (name: string, value: unknown) => void;
}

interface ChartData {
  spec?: unknown;
  clicks?: unknown;
  hover?: unknown;
  identity?: unknown;
}

interface Instance {
  el: HTMLElement;
  handle: MountHandle | null;
  /** The setters of the latest call; a click uses them. */
  args: FrontendRendererArgs;
  clicks: boolean;
  specText: string;
  revision: number;
}

const instances = new WeakMap<HTMLElement | ShadowRoot, Instance>();

function readData(raw: unknown): ChartData {
  if (typeof raw === 'string') {
    try { return readData(JSON.parse(raw)); } catch { return {}; }
  }
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw as ChartData : {};
}

/** The literal colour behind the chart: Streamlit's theme variable, which also reaches into the shadow root. */
function streamlitBackground(el: HTMLElement): string | null {
  const value = getComputedStyle(el).getPropertyValue('--st-background-color').trim();
  return value.length > 0 ? value : null;
}

function showMessage(el: HTMLElement, text: string): void {
  const note = document.createElement('div');
  note.setAttribute('role', 'alert');
  note.setAttribute('data-bp-mount-error', '');
  note.style.cssText = 'font: 13px system-ui, sans-serif; padding: 8px;';
  note.textContent = text;
  el.replaceChildren(note);
}

/** The status as attributes on the chart's element, for the page's own tools; nothing goes to Python. */
function mark(el: HTMLElement, status: MountStatus): void {
  el.setAttribute('data-bp-state', status.state);
  const theme = status.detail?.theme as { name?: unknown; hostBackground?: unknown } | undefined;
  if (theme && typeof theme.name === 'string') el.setAttribute('data-bp-theme', `${theme.name}${theme.hostBackground === true ? '+host' : ''}`);
}

function create(args: FrontendRendererArgs): Instance {
  const el = document.createElement('div');
  el.className = 'boardplot-streamlit';
  el.style.width = '100%';
  el.style.minWidth = '0';
  args.parentElement.appendChild(el);
  return { el, handle: null, args, clicks: false, specText: '', revision: 0 };
}

export default function renderBoardplot(args: FrontendRendererArgs): () => void {
  const { parentElement } = args;
  let instance = instances.get(parentElement);
  if (!instance) {
    instance = create(args);
    instances.set(parentElement, instance);
  }
  const current = instance;
  current.args = args;

  const data = readData(args.data);
  if (!sameIdentity(bundleIdentity, data.identity)) {
    current.handle?.unmount();
    current.handle = null;
    current.specText = '';
    showMessage(current.el, 'Boardplot: the browser code and the Python package come from different builds. Restart the Streamlit server.');
  } else {
    current.clicks = data.clicks === true;
    const hover = data.hover !== false;
    const specText = JSON.stringify(data.spec ?? null);
    const specChanged = specText !== current.specText;
    if (specChanged) {
      current.specText = specText;
      current.revision++;
    }
    if (!current.handle) {
      current.el.replaceChildren();
      current.handle = mount(current.el, {
        spec: data.spec,
        hover,
        clicks: current.clicks,
        revision: current.revision,
        hostBackground: () => streamlitBackground(current.el),
        onEvent: (event) => {
          if (!current.clicks) return;
          current.args.setStateValue('selection', event.record);
          current.args.setTriggerValue('click', event.record);
        },
        onStatus: (status: MountStatus) => { mark(current.el, status); },
      });
    } else {
      // A new spec object only when the spec changed, so a rerun with the same chart keeps the drawn view.
      current.handle.update({
        ...(specChanged ? { spec: data.spec } : {}),
        hover,
        clicks: current.clicks,
        revision: current.revision,
      });
    }
  }

  return () => {
    const live = instances.get(parentElement);
    if (!live) return;
    instances.delete(parentElement);
    live.handle?.unmount();
    live.el.remove();
  };
}
