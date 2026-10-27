/**
 * The host-neutral browser mount for Boardplot's Python package.
 *
 * One function, `mount(el, options)`, draws a resolved Boardplot spec with
 * `BoardplotChart` at the width of `el`, and reports record clicks and a view
 * status back to the host through callbacks. The anywidget runtime and the
 * Streamlit component both build on it; neither host's code belongs here.
 */
import { Component, useLayoutEffect, type ErrorInfo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BoardplotChart } from '../../../src/react/spec';
import { withStory } from '../../../src/react/story';
import type { InteractionRecord } from '../../../src/core/a11y/types';
import type { Geometry, RefusedLayout } from '../../../src/core/types/scene';
import type { ThemeRef } from '../../../src/core/types/theme';
import { resolveTheme } from '../../../src/core/theme';
import { validateTheme } from '../../../src/core/themeRules';
import { linkThemeShapeRules } from '../../../src/core/themeShapeRules';
import {
  DACH_PACK, DE_STATES_PACK, EU27_PACK, EUROPE_PACK, US_STATES_PACK, WORLD_PACK, registerGeoPack,
} from '../../../src/core/geo/packs/index';

export type MountState = 'loading' | 'ready' | 'refused' | 'error';

export interface MountStatus {
  state: MountState;
  /** The `revision` the status belongs to. */
  revision: number;
  detail?: Record<string, unknown>;
}

export interface MountEvent {
  seq: number;
  revision: number;
  kind: 'record';
  record: Record<string, unknown>;
}

export interface MountOptions {
  /** A resolved bare chart spec. An explicit theme sits in `spec.theme`. */
  spec: unknown;
  /** Hover card and highlight. Default true. */
  hover?: boolean;
  /** Send record clicks to `onEvent`. Default false. */
  clicks?: boolean;
  /** The host's spec revision, copied into every event and status. */
  revision: number;
  onEvent?: (event: MountEvent) => void;
  onStatus?: (status: MountStatus) => void;
  /** A host that knows its background colour returns it; null falls back to the DOM walk. */
  hostBackground?: () => string | null;
}

export interface MountHandle {
  update(partial: Partial<MountOptions>): void;
  unmount(): void;
}

/** The engine draws `options.story`, so the interactive view must too. */
const Chart = withStory(BoardplotChart);

let linked = false;

/**
 * Called, not bare-imported: the repository's package.json `sideEffects`
 * list makes esbuild drop a bare import of these modules. The geo packs go
 * in by value so choropleth and tilemap draw without a separate import.
 */
function linkOnce(): void {
  if (linked) return;
  linked = true;
  linkThemeShapeRules();
  for (const pack of [DE_STATES_PACK, EU27_PACK, DACH_PACK, EUROPE_PACK, WORLD_PACK, US_STATES_PACK]) registerGeoPack(pack);
}

// ---------------------------------------------------------------------------
// Host theme

type Rgba = [number, number, number, number];

const LIGHT_PRESET = 'boardroom';
const DARK_PRESET = 'standard-dark';

let probe: CanvasRenderingContext2D | null | undefined;

/** Any CSS colour to RGBA 0-255 (alpha 0-1). Unknown syntax goes through a 1x1 canvas. */
function parseColor(value: string | null | undefined): Rgba | undefined {
  if (!value) return undefined;
  const text = value.trim().toLowerCase();
  if (text === 'transparent') return [0, 0, 0, 0];
  const rgb = text.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), alpha];
  }
  const hex = text.match(/^#([0-9a-f]{3,8})$/);
  if (hex && [3, 4, 6, 8].includes(hex[1]!.length)) {
    const h = hex[1]!.length <= 4 ? [...hex[1]!].map(c => c + c).join('') : hex[1]!;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  if (probe === undefined) {
    try { probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true }); } catch { probe = null; }
  }
  if (!probe) return undefined;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = '#00000000';
  probe.fillStyle = text;
  probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  return [d[0]!, d[1]!, d[2]!, d[3]! / 255];
}

/** `top` painted over `bottom`. */
function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top[3] + bottom[3] * (1 - top[3]);
  if (a === 0) return [0, 0, 0, 0];
  const mix = (i: number) => (top[i]! * top[3] + bottom[i]! * bottom[3] * (1 - top[3])) / a;
  return [mix(0), mix(1), mix(2), a];
}

/** The parent element, crossing from a shadow root to its host (Streamlit mounts inside one). */
function parentOf(node: Element): Element | null {
  if (node.parentElement) return node.parentElement;
  const parent = node.parentNode;
  return typeof ShadowRoot !== 'undefined' && parent instanceof ShadowRoot ? parent.host : null;
}

/**
 * The colour a reader sees behind `el`: the background colours from `el`
 * upwards, painted over each other until one is opaque. A page with no
 * background at all is the browser's white canvas.
 */
function effectiveBackground(el: Element): Rgba {
  const layers: Rgba[] = [];
  for (let node: Element | null = el; node; node = parentOf(node)) {
    const color = parseColor(getComputedStyle(node).backgroundColor);
    if (!color || color[3] === 0) continue;
    layers.push(color);
    if (color[3] >= 1) break;
  }
  let result: Rgba = [255, 255, 255, 1];
  for (let i = layers.length - 1; i >= 0; i--) result = over(layers[i]!, result);
  return result;
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Dark when white text has more contrast on it than black text, as the engine decides. */
function isDark(color: Rgba): boolean {
  const l = luminance(color);
  return (1.05) / (l + 0.05) > (l + 0.05) / 0.05;
}

function toHex([r, g, b]: Rgba): string {
  return '#' + [r, g, b].map(c => Math.round(c).toString(16).padStart(2, '0')).join('').toUpperCase();
}

const findingCodes = (ref: ThemeRef): string[] => validateTheme(resolveTheme(ref)).map(w => w.code).sort();
const themeCache = new Map<string, ThemeRef>();

/**
 * The preset for the host's lightness, with the host's background colour
 * only when the engine's contrast findings for the merged theme add nothing
 * to the preset's own findings. Any failure keeps the preset as it is.
 */
export function hostTheme(background: Rgba): ThemeRef {
  const preset = isDark(background) ? DARK_PRESET : LIGHT_PRESET;
  const hex = toHex(background);
  const key = `${preset}|${hex}`;
  const cached = themeCache.get(key);
  if (cached) return cached;
  let result: ThemeRef = preset;
  try {
    const merged: ThemeRef = { preset, overrides: { color: { background: hex } } };
    const base = findingCodes(preset);
    const added = findingCodes(merged);
    const left = [...base];
    const extra = added.filter(code => { const i = left.indexOf(code); if (i < 0) return true; left.splice(i, 1); return false; });
    if (extra.length === 0) result = merged;
  } catch {
    result = preset;
  }
  themeCache.set(key, result);
  return result;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/**
 * Whether the spec names a theme itself: the chart's `options.theme`, the
 * chart's `theme` or the envelope's `theme`, the places and order
 * `useSpecFrame` reads (src/react/specFrame.ts). A one-chart envelope's chart
 * is `charts[0]`.
 */
function hasExplicitTheme(spec: unknown): boolean {
  const root = asRecord(spec);
  const chart = Array.isArray(root.charts) ? asRecord(root.charts.length === 1 ? root.charts[0] : undefined) : root;
  return asRecord(chart.options).theme !== undefined || chart.theme !== undefined || root.theme !== undefined;
}

function specType(spec: unknown): string | undefined {
  if (!spec || typeof spec !== 'object') return undefined;
  const s = spec as { type?: unknown; charts?: { type?: unknown }[] };
  if (typeof s.type === 'string') return s.type;
  const first = Array.isArray(s.charts) ? s.charts[0] : undefined;
  return first && typeof first.type === 'string' ? first.type : undefined;
}

// ---------------------------------------------------------------------------
// Keyboard

/**
 * Keys the chart's own keyboard model uses, plus single characters, must not
 * run notebook command-mode shortcuts (cell navigation, insert, delete) while
 * focus is inside the chart. Lumino, the toolkit of JupyterLab and Notebook
 * 7, reads shortcuts on `document`: JupyterLab 4 in the bubbling phase,
 * Notebook 7 in the capture phase. Two guards cover both:
 * - the mount element stops the key's propagation (bubbling hosts);
 * - a capture listener on `window`, which runs before `document`'s, sets
 *   `data-lm-suppress-shortcuts` on the key's target for this one key.
 *   Lumino walks up from the target and stops at that attribute; it must sit
 *   on the target itself, because the focused element already matches
 *   command-mode selectors such as `.jp-mod-commandMode :focus`.
 * Keys with Ctrl, Meta or Alt, Shift+Enter and Tab still reach the host, so
 * save, run and focus movement keep working.
 */
const CHART_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Home', 'End', 'PageUp', 'PageDown']);

function isChartKey(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.key === 'Enter' && event.shiftKey) return false;
  // One printable character covers Space and the single-letter notebook shortcuts (a, b, d, m, x, ...).
  return CHART_KEYS.has(event.key) || event.key.length === 1;
}

function stopHostShortcut(event: KeyboardEvent): void {
  if (isChartKey(event)) event.stopPropagation();
}

const SUPPRESS = 'data-lm-suppress-shortcuts';

// ---------------------------------------------------------------------------
// Error boundary

interface BoundaryProps { onError: (error: unknown) => void; children: ReactNode }

class Boundary extends Component<BoundaryProps, { failed: string | null }> {
  override state: { failed: string | null } = { failed: null };
  static getDerivedStateFromError(error: unknown) {
    return { failed: error instanceof Error ? error.message : String(error) };
  }
  override componentDidCatch(error: unknown, _info: ErrorInfo) {
    this.props.onError(error);
  }
  override render() {
    if (this.state.failed !== null) {
      return <div role="alert" data-bp-mount-error="" style={{ font: '13px system-ui, sans-serif', padding: 8 }}>Boardplot could not draw this chart: {this.state.failed}</div>;
    }
    return this.props.children;
  }
}

/** Tells the mount when React has committed the render of one spec. */
function Committed({ token, onCommit }: { token: number; onCommit: () => void }): null {
  useLayoutEffect(() => { onCommit(); }, [token]);
  return null;
}

// ---------------------------------------------------------------------------
// Mount

let mounts = 0;
const pageTag = Math.random().toString(36).slice(2, 8);

/** InteractionRecord as plain JSON: no functions, DOM nodes or non-finite numbers. */
function plain(record: InteractionRecord): Record<string, unknown> {
  return JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
}

function refusalDetail(result: RefusedLayout): Record<string, unknown> {
  const first = result.warnings[0] as (RefusedLayout['warnings'][number] & { expected?: { minimum?: unknown } }) | undefined;
  return JSON.parse(JSON.stringify({
    code: first?.code,
    message: first?.message,
    minimum: first?.expected?.minimum,
    size: result.size,
  })) as Record<string, unknown>;
}

export function mount(el: HTMLElement, initial: MountOptions): MountHandle {
  linkOnce();
  let options: MountOptions = { ...initial };
  const idPrefix = `bp${pageTag}m${++mounts}`;
  const container = document.createElement('div');
  container.className = 'boardplot-mount';
  container.style.width = '100%';
  el.appendChild(container);
  const root: Root = createRoot(container);

  let seq = 0;
  let generation = 0;
  /** Counts spec changes. Callbacks and DOM from an older spec do not count for the current one. */
  let specSeq = 0;
  /** The spec count whose render React has committed. */
  let committedSpec = -1;
  let geometrySeen = false;
  let laidOut: { width: number; height: number } | null = null;
  let refusal: RefusedLayout | null = null;
  let boundaryError: string | null = null;
  let lastStatus = '';
  let theme: ThemeRef | undefined;
  let alive = true;

  const report = (state: MountState, detail?: Record<string, unknown>) => {
    const status: MountStatus = detail === undefined ? { state, revision: options.revision } : { state, revision: options.revision, detail };
    const key = JSON.stringify(status);
    if (key === lastStatus) return;
    lastStatus = key;
    options.onStatus?.(status);
  };

  /** The theme the chart is drawn in: "spec" for the spec's own, else the preset and whether the host background went in. */
  const themeDetail = () => {
    if (hasExplicitTheme(options.spec) || theme === undefined) return { name: 'spec', hostBackground: false };
    return typeof theme === 'string' ? { name: theme, hostBackground: false } : { name: theme.preset, hostBackground: true };
  };

  /**
   * Reads the status from the callbacks and the rendered tree of the current
   * spec. A table is ready only when its real table output is in the tree,
   * not its loading or refusal stage.
   */
  const evaluate = () => {
    if (!alive) return;
    if (boundaryError !== null) return report('error', { message: boundaryError });
    if (committedSpec !== specSeq) return report('loading');
    const specError = container.querySelector('[data-bp-spec-error]');
    if (specError) {
      const codes = [...specError.querySelectorAll('[data-bp-error-code]')].map(node => node.getAttribute('data-bp-error-code'));
      return report('error', { codes });
    }
    const refused = container.querySelector('[data-bp-refused]');
    if (refused) {
      if (refusal) return report('refused', refusalDetail(refusal));
      return report('refused', { code: refused.getAttribute('data-bp-refused') });
    }
    if (container.querySelector('[data-bp-empty]')) return report('ready', { empty: true, theme: themeDetail() });
    if (container.querySelector('[data-bp-loading]')) return report('loading');
    if (specType(options.spec) === 'table') {
      const table = container.querySelector('[data-bp-table-theme]');
      if (table) {
        const box = table.getBoundingClientRect();
        return report('ready', { theme: themeDetail(), size: { width: Math.round(box.width), height: Math.round(box.height) } });
      }
    } else if (geometrySeen) {
      return report('ready', { theme: themeDetail(), ...(laidOut ? { size: laidOut } : {}) });
    }
    report('loading');
  };
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; evaluate(); });
  };

  const domObserver = new MutationObserver(schedule);
  domObserver.observe(container, { subtree: true, childList: true, attributes: true });

  const render = () => {
    if (!alive) return;
    const { spec, hover = true, clicks = false } = options;
    const explicit = hasExplicitTheme(spec);
    const mine = specSeq;
    const current = () => mine === specSeq;
    // An event carries the revision of the drawing it came from, not the newest one.
    const drawn = options.revision;
    root.render(
      <>
        <Committed token={mine} onCommit={() => { committedSpec = mine; schedule(); }} />
        <Boundary key={generation} onError={(error) => { boundaryError = error instanceof Error ? error.message : String(error); schedule(); }}>
          <Chart
            spec={spec}
            size="container"
            idPrefix={idPrefix}
            hover={hover}
            {...(explicit || theme === undefined ? {} : { theme })}
            onRecordClick={clicks ? (record) => {
              if (!current()) return;
              options.onEvent?.({ seq: ++seq, revision: drawn, kind: 'record', record: plain(record) });
            } : undefined}
            onGeometry={(geometry: Geometry) => {
              if (!current()) return;
              geometrySeen = true;
              laidOut = { width: geometry.size.width, height: geometry.size.height };
              refusal = null;
              schedule();
            }}
            onRefused={(result) => { if (!current()) return; refusal = result; geometrySeen = false; schedule(); }}
            onWarnings={() => { schedule(); }}
          />
        </Boundary>
      </>,
    );
  };

  // Host theme: recomputed on attribute changes of <html>, <body> and every
  // ancestor, on a colour-scheme change, and when the element is attached or
  // resized (a host may render into a detached element first).
  const readTheme = (): ThemeRef | undefined => {
    if (hasExplicitTheme(options.spec)) return undefined;
    const supplied = options.hostBackground?.();
    const parsed = supplied ? parseColor(supplied) : undefined;
    const color = parsed && parsed[3] > 0 ? over(parsed, [255, 255, 255, 1]) : effectiveBackground(el);
    return hostTheme(color);
  };
  const sameTheme = (a: ThemeRef | undefined, b: ThemeRef | undefined) => JSON.stringify(a) === JSON.stringify(b);
  const refreshTheme = () => {
    if (!alive) return;
    watchAncestors();
    const next = readTheme();
    if (sameTheme(next, theme)) return;
    theme = next;
    render();
    schedule();
  };

  const themeObserver = new MutationObserver(refreshTheme);
  let watched: Element[] = [];
  function watchAncestors() {
    const chain: Element[] = [];
    for (let node: Element | null = el; node; node = parentOf(node)) chain.push(node);
    if (chain.length === watched.length && chain.every((node, i) => node === watched[i])) return;
    themeObserver.disconnect();
    watched = chain;
    for (const node of chain) themeObserver.observe(node, { attributes: true });
  }
  const resizeObserver = new ResizeObserver(refreshTheme);
  resizeObserver.observe(el);
  const scheme = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  scheme?.addEventListener('change', refreshTheme);

  container.addEventListener('keydown', stopHostShortcut);
  const suppressForKey = (event: KeyboardEvent) => {
    const target = event.target;
    if (!(target instanceof Element) || !container.contains(target) || !isChartKey(event) || target.hasAttribute(SUPPRESS)) return;
    target.setAttribute(SUPPRESS, 'true');
    // A timeout, not a microtask: microtasks run between listeners, before document's.
    setTimeout(() => target.removeAttribute(SUPPRESS), 0);
  };
  window.addEventListener('keydown', suppressForKey, true);

  watchAncestors();
  theme = readTheme();
  report('loading');
  render();

  return {
    update(partial) {
      if (!alive) return;
      const specChanged = 'spec' in partial && partial.spec !== options.spec;
      options = { ...options, ...partial };
      if (specChanged) {
        if (boundaryError !== null) generation++;
        specSeq++;
        geometrySeen = false;
        laidOut = null;
        refusal = null;
        boundaryError = null;
        theme = readTheme();
        report('loading');
      }
      render();
      schedule();
    },
    unmount() {
      if (!alive) return;
      alive = false;
      domObserver.disconnect();
      themeObserver.disconnect();
      resizeObserver.disconnect();
      scheme?.removeEventListener('change', refreshTheme);
      container.removeEventListener('keydown', stopHostShortcut);
      window.removeEventListener('keydown', suppressForKey, true);
      root.unmount();
      container.remove();
    },
  };
}
