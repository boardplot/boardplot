/**
 * The Boardplot chart view. It shows the SVG the server drew and the
 * hover cards the server wrote. It has no chart engine and formats no number.
 * It talks to the host over the MCP Apps postMessage protocol directly,
 * because the ext-apps App class with its dependencies is about three times
 * the view's size budget.
 */

type Json = Record<string, unknown>;

interface ViewRecord { id: string; n?: string[]; a?: number[]; r: string[][] }
interface Payload {
  /** Absent when only the dark drawing travelled (a scheme request). */
  svgLight?: string;
  svgDark?: string;
  records: ViewRecord[];
  frame: { width: number; height: number };
  size: { width: number; height: number };
  revision: string;
  title: string | null;
  type: string;
  explicitTheme: boolean;
  fit?: { minWidth?: number; refused?: { message: string } | null };
  seq?: number;
  scheme?: Scheme;
  warnings?: { code: string; message: string }[];
}

type Scheme = 'light' | 'dark';

/** The server offers no claude-slides export yet, so "Add to slides" would lead the model into a refusal. */
const SLIDES_EXPORT = false;

interface HostCapabilities {
  downloadFile?: Json;
  serverTools?: Json;
  message?: Json;
  updateModelContext?: Json;
  sandbox?: { permissions?: { clipboardWrite?: Json } };
}
interface HostContext {
  theme?: 'light' | 'dark';
  displayMode?: 'inline' | 'fullscreen' | 'pip';
  availableDisplayModes?: string[];
  styles?: { variables?: Record<string, string | undefined> };
  [key: string]: unknown;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const root = $('bp-root');
const chartBox = $('bp-chart');
const tip = $('bp-tip');
const statusBox = $('bp-status');
const note = $('bp-note');

// ------------------------------------------------------------ bridge

let rpcId = 1;
const waiting = new Map<number, { resolve(value: Json): void; reject(error: Error): void }>();

function post(message: Json): void {
  window.parent.postMessage({ jsonrpc: '2.0', ...message }, '*');
}

function request(method: string, params: Json): Promise<Json> {
  const id = rpcId++;
  post({ id, method, params });
  return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
}

function notify(method: string, params: Json = {}): void {
  post({ method, params });
}

let host: HostCapabilities = {};
let context: HostContext = {};
let toolInput: Json | undefined;
let payload: Payload | undefined;
let wantRecovery = false;

window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  const message = event.data as Json;
  if (!message || message.jsonrpc !== '2.0') return;
  const id = message.id as number | undefined;
  if (typeof message.method !== 'string') {
    const entry = id === undefined ? undefined : waiting.get(id);
    if (!entry) return;
    waiting.delete(id!);
    if (message.error) entry.reject(new Error(String((message.error as Json).message ?? 'host error')));
    else entry.resolve((message.result ?? {}) as Json);
    return;
  }
  const params = (message.params ?? {}) as Json;
  switch (message.method) {
    case 'ui/notifications/tool-input':
      toolInput = params.arguments as Json | undefined;
      if (wantRecovery) recover();
      break;
    case 'ui/notifications/tool-result':
      onToolResult(params);
      break;
    case 'ui/notifications/tool-cancelled':
      showStatus('The chart call was cancelled.');
      break;
    case 'ui/notifications/host-context-changed':
      applyContext({ ...context, ...params } as HostContext);
      break;
    case 'ui/resource-teardown':
    case 'ping':
      if (id !== undefined) post({ id, result: {} });
      break;
    default:
      if (id !== undefined) post({ id, error: { code: -32601, message: 'Method not found' } });
  }
});

// ------------------------------------------------------------ drawing

let shownSvg = '';
/** The scheme requests already sent for a revision and frame, so a missing drawing is asked for once. */
const schemeAsked = new Set<string>();
/** Every drawing the view has had, by revision and frame: a scheme switch shows a kept drawing without a request. */
const drawings = new Map<string, { light?: string; dark?: string }>();

const drawingKey = (next: Payload) => `${next.revision} ${next.frame.width}x${next.frame.height}`;

/** Keeps the new payload's drawings and fills in the other scheme's drawing kept for the same revision and frame. */
function remember(next: Payload): Payload {
  const key = drawingKey(next);
  const kept = drawings.get(key) ?? {};
  if (next.svgLight) kept.light = next.svgLight;
  if (next.svgDark) kept.dark = next.svgDark;
  drawings.set(key, kept);
  return { ...next, ...(kept.light ? { svgLight: kept.light } : {}), ...(kept.dark ? { svgDark: kept.dark } : {}) };
}
let darkPreview: boolean | undefined;

function dark(): boolean {
  return darkPreview ?? context.theme === 'dark';
}

/** The scheme the view shows: an explicit theme draws the same in both, as its light drawing. */
function scheme(): Scheme {
  return payload?.explicitTheme || !dark() ? 'light' : 'dark';
}

function currentSvg(): string | undefined {
  if (!payload) return undefined;
  return scheme() === 'dark' ? payload.svgDark : payload.svgLight;
}

const nodeRecord = new Map<string, number>();

function show(): void {
  if (!payload) return;
  const svg = currentSvg();
  const key = `${scheme()} ${drawingKey(payload)}`;
  if (svg === undefined && !schemeAsked.has(key)) {
    // This scheme's drawing did not travel (budget or a scheme request); ask for it once.
    schemeAsked.add(key);
    void relayout(payload.frame);
  }
  const markup = svg ?? payload.svgLight ?? payload.svgDark ?? '';
  if (markup !== shownSvg) {
    chartBox.innerHTML = markup;
    shownSvg = markup;
  }
  fitWidth();
  nodeRecord.clear();
  payload.records.forEach((record, index) => record.n?.forEach((node) => nodeRecord.set(node, index)));
  const fit = payload.fit;
  const needs = fit?.minWidth;
  // The note line also carries the material warnings: rows left out and a brand that was not applied.
  const material = materialWarnings();
  if (fit?.refused) setNote([fit.refused.message, material].filter(Boolean).join(' '), true);
  else if (needs && root.clientWidth < needs) setNote([`This chart needs ${needs} px to stay readable; scroll sideways or open full screen.`, material].filter(Boolean).join(' '), true);
  else setNote(material, false);
  updateActions();
}

/** Rows left out and brand colours not applied, in the server's own words. */
function materialWarnings(): string {
  const parts: string[] = [];
  for (const warning of payload?.warnings ?? []) {
    if (warning.code === 'csv-rows-left-out') parts.push(`${warning.message.replace(/^left out (\d+) CSV rows?:.*$/, 'Left out $1 CSV rows.')}`);
    if (warning.code === 'brand-not-applied') parts.push('Brand colours not applied: contrast.');
  }
  return parts.join(' ');
}

/**
 * Below the chart's minimum width the drawing keeps its own size and the box
 * scrolls sideways: scaling it down would put the text below its floor.
 */
function fitWidth(): void {
  const svg = chartBox.querySelector('svg');
  if (!svg || !payload) return;
  const needs = payload.fit?.minWidth;
  const narrow = needs !== undefined && root.clientWidth < needs;
  chartBox.classList.toggle('bp-scroll', narrow);
  svg.style.maxWidth = narrow ? 'none' : '';
  svg.style.width = narrow ? `${payload.size.width}px` : '';
}

function setNote(text: string, offerFullscreen: boolean): void {
  note.hidden = text === '';
  ($('bp-note-text')).textContent = text;
  $('bp-note-full').hidden = !(offerFullscreen && canFullscreen());
}

function showStatus(text: string): void {
  statusBox.textContent = text;
  statusBox.hidden = text === "";
  if (text) setTimeout(() => { if (statusBox.textContent === text) statusBox.hidden = true; }, 4000);
}

function applyContext(next: HostContext): void {
  const themeChanged = next.theme !== context.theme;
  context = next;
  const variables = next.styles?.variables;
  if (variables) for (const [key, value] of Object.entries(variables)) if (value) document.documentElement.style.setProperty(key, value);
  document.documentElement.dataset.theme = next.theme ?? 'light';
  document.documentElement.dataset.mode = next.displayMode ?? 'inline';
  if (themeChanged) show();
  updateActions();
}

function onToolResult(result: Json): void {
  const meta = (result._meta as Json | undefined)?.boardplot as Payload | undefined;
  if (result.isError) {
    const text = ((result.content as Json[] | undefined) ?? []).map((block) => block.text).filter(Boolean).join('\n');
    showStatus(text || 'The chart could not be drawn.');
    return;
  }
  if (meta?.svgLight) {
    payload = remember({ ...meta, seq: 0 });
    show();
    watchWidth();
    return;
  }
  // The host dropped _meta: ask the server again with the tool input.
  wantRecovery = true;
  recover();
}

function recover(): void {
  if (!toolInput) return;
  wantRecovery = false;
  const width = Math.round(root.clientWidth) || 720;
  const frame = (toolInput.frame as Payload['frame'] | undefined) ?? { width: 720, height: 405 };
  relayout(Math.abs(width - frame.width) / frame.width > 0.15 ? { width, height: Math.round(width * frame.height / frame.width) } : frame);
}

// ------------------------------------------------------------ re-layout

let seq = 0;
let latest = 0;

/** Asks the server for the chart at `frame`, in the scheme the view shows. */
async function relayout(frame: Payload['frame']): Promise<void> {
  if (!toolInput || !host.serverTools) return;
  const mine = ++seq;
  latest = mine;
  const wanted = scheme();
  try {
    const result = await request('tools/call', {
      name: 'boardplot_view',
      arguments: { ...toolInput, frame, ...(payload ? { revision: payload.revision } : {}), seq: mine, scheme: wanted },
    });
    // A slow answer, success or failure, never touches a newer request's view.
    if (mine < latest) return;
    if (result.isError) {
      showStatus('The chart could not be drawn at this width.');
      return;
    }
    const next = (result.structuredContent as Payload | undefined)
      ?? JSON.parse(String(((result.content as Json[])[0] ?? {}).text ?? '{}')) as Payload;
    if ((next.seq ?? 0) < latest) return;
    payload = remember(next);
    show();
    watchWidth();
  } catch {
    if (mine < latest) return;
    showStatus('The host did not pass the request on.');
  }
}

let observer: ResizeObserver | undefined;
let debounce: ReturnType<typeof setTimeout> | undefined;

function watchWidth(): void {
  if (observer) return;
  observer = new ResizeObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (!payload) return;
      const width = Math.round(root.clientWidth);
      const base = payload.frame;
      // Below the minimum width the chart is laid out at that width and scrolls.
      const minWidth = payload.fit?.minWidth;
      const target = minWidth && width < minWidth ? minWidth : width;
      if (!target || Math.abs(target - base.width) / base.width <= 0.15) { show(); return; }
      void relayout({ width: target, height: Math.round(target * base.height / base.width) });
    }, 250);
  });
  observer.observe(root);
}

// ------------------------------------------------------------ hover and focus

let focused = -1;

function svgPoint(svg: SVGSVGElement, x: number, y: number): { x: number; y: number } | undefined {
  const matrix = svg.getScreenCTM();
  if (!matrix) return undefined;
  const point = new DOMPoint(x, y).matrixTransform(matrix.inverse());
  return { x: point.x, y: point.y };
}

/** The record under the pointer: the mark's own data-id first, else the nearest geometry anchor. */
function hit(target: EventTarget | null, x: number, y: number): number {
  for (let element = target as Element | null; element && element !== chartBox; element = element.parentElement) {
    const id = element.getAttribute('data-id');
    if (id && nodeRecord.has(id)) return nodeRecord.get(id)!;
  }
  const svg = chartBox.querySelector('svg');
  if (!svg || !payload) return -1;
  const point = svgPoint(svg, x, y);
  if (!point) return -1;
  let best = -1;
  let bestDistance = 24;
  payload.records.forEach((record, index) => {
    const a = record.a;
    if (!a) return;
    const distance = a.length === 4
      ? Math.hypot(Math.max(a[0]! - point.x, 0, point.x - a[0]! - a[2]!), Math.max(a[1]! - point.y, 0, point.y - a[1]! - a[3]!))
      : Math.hypot(a[0]! - point.x, a[1]! - point.y);
    if (distance < bestDistance) { bestDistance = distance; best = index; }
  });
  return best;
}

function rowsHtml(record: ViewRecord): void {
  tip.replaceChildren(...record.r.map(([kind, first, second]) => {
    const row = document.createElement('div');
    row.className = `bp-row bp-${kind}`;
    if (second !== undefined) {
      const label = document.createElement('span');
      label.textContent = `${first} `;
      const value = document.createElement('b');
      value.textContent = second;
      row.append(label, value);
    } else row.textContent = first ?? '';
    return row;
  }));
}

function anchorBox(record: ViewRecord): DOMRect | undefined {
  const node = record.n?.map((id) => chartBox.querySelector(`[data-id="${CSS.escape(id)}"]`)).find(Boolean) as SVGGraphicsElement | undefined;
  if (node) return node.getBoundingClientRect();
  const svg = chartBox.querySelector('svg');
  const a = record.a;
  const matrix = svg?.getScreenCTM();
  if (!a || !matrix) return undefined;
  const point = new DOMPoint(a[0], a[1]).matrixTransform(matrix);
  return new DOMRect(point.x, point.y, (a[2] ?? 0) * matrix.a, (a[3] ?? 0) * matrix.d);
}

function placeTip(index: number, x?: number, y?: number): void {
  if (!payload || index < 0) { hideTip(); return; }
  const record = payload.records[index]!;
  rowsHtml(record);
  tip.hidden = false;
  chartBox.querySelectorAll('[data-bp-on]').forEach((node) => node.removeAttribute('data-bp-on'));
  record.n?.forEach((id) => chartBox.querySelector(`[data-id="${CSS.escape(id)}"]`)?.setAttribute('data-bp-on', ''));
  const box = root.getBoundingClientRect();
  const at = x !== undefined && y !== undefined ? { x, y } : (() => {
    const rect = anchorBox(record);
    return rect ? { x: rect.x + rect.width / 2, y: rect.y } : { x: box.x + 20, y: box.y + 20 };
  })();
  const width = tip.offsetWidth;
  const height = tip.offsetHeight;
  let left = at.x - box.x + 12;
  let top = at.y - box.y - height - 8;
  if (left + width > box.width) left = Math.max(0, at.x - box.x - width - 12);
  if (top < 0) top = at.y - box.y + 16;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function hideTip(): void {
  tip.hidden = true;
  chartBox.querySelectorAll('[data-bp-on]').forEach((node) => node.removeAttribute('data-bp-on'));
}

chartBox.addEventListener('pointermove', (event) => placeTip(hit(event.target, event.clientX, event.clientY), event.clientX, event.clientY));
chartBox.addEventListener('pointerdown', (event) => placeTip(hit(event.target, event.clientX, event.clientY), event.clientX, event.clientY));
chartBox.addEventListener('pointerleave', hideTip);
chartBox.addEventListener('keydown', (event) => {
  if (!payload?.records.length) return;
  const count = payload.records.length;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') focused = (focused + 1) % count;
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') focused = (focused - 1 + count) % count;
  else if (event.key === 'Escape') { focused = -1; hideTip(); return; }
  else return;
  event.preventDefault();
  placeTip(focused);
});
chartBox.addEventListener('blur', () => { focused = -1; hideTip(); });

// ------------------------------------------------------------ actions

function canFullscreen(): boolean {
  return (context.availableDisplayModes ?? []).includes('fullscreen');
}

const fileName = (suffix: string) => `boardplot-${payload?.revision ?? 'chart'}${suffix}`;

/** The shown SVG drawn on a canvas at 2×: the browser's raster, with the viewer's fonts. */
function browserRaster(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!payload) { reject(new Error('no chart')); return; }
    const image = new Image();
    const { width, height } = payload.size;
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * 2);
      canvas.height = Math.round(height * 2);
      const draw = canvas.getContext('2d');
      if (!draw) { reject(new Error('no canvas')); return; }
      draw.scale(2, 2);
      draw.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL('image/png').split(',')[1]!);
    };
    image.onerror = () => reject(new Error('the SVG did not load as an image'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(shownSvg)}`;
  });
}

/** The server's PNG at exactly 2× through boardplot_export; the browser raster only when that path refuses. */
async function chartPng(): Promise<{ data: string; browser: boolean }> {
  if (host.serverTools && toolInput && payload) {
    try {
      // The scheme the view shows; the server keeps an explicit theme as it is.
      const result = await request('tools/call', { name: 'boardplot_export', arguments: { ...toolInput, frame: payload.frame, format: 'png', scheme: scheme() } });
      const image = ((result.content as Json[] | undefined) ?? []).find((block) => block.type === 'image');
      if (!result.isError && image) return { data: String(image.data), browser: false };
    } catch { /* the host refused the call: fall back below */ }
  }
  return { data: await browserRaster(), browser: true };
}

async function download(name: string, mimeType: string, content: { blob: string } | { text: string }): Promise<void> {
  const result = await request('ui/download-file', {
    contents: [{ type: 'resource', resource: { uri: `file:///${name}`, mimeType, ...content } }],
  });
  if (result.isError) showStatus('The download was cancelled or refused.');
}

async function downloadPng(): Promise<void> {
  showStatus('Preparing the PNG…');
  try {
    const png = await chartPng();
    await download(fileName(png.browser ? '-browser-raster.png' : '.png'), 'image/png', { blob: png.data });
    showStatus(png.browser ? 'Saved a browser raster: the fonts can differ from the chart.' : 'Saved the PNG at 2×.');
  } catch {
    showStatus('The PNG could not be made here.');
  }
}

async function downloadSvg(): Promise<void> {
  await download(fileName('.svg'), 'image/svg+xml', { text: shownSvg });
}

async function copyImage(): Promise<void> {
  try {
    const png = await chartPng();
    const bytes = Uint8Array.from(atob(png.data), (char) => char.charCodeAt(0));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
    showStatus(png.browser ? 'Copied a browser raster.' : 'Copied the image.');
  } catch {
    showStatus('The host did not allow the copy.');
  }
}

async function addToSlides(): Promise<void> {
  if (!payload) return;
  const { title, type, revision, frame } = payload;
  const name = title ?? `${type} chart`;
  try {
    if (host.updateModelContext) {
      await request('ui/update-model-context', {
        content: [{ type: 'text', text: `The user picked the Boardplot chart '${name}' (type ${type}, revision ${revision}, frame ${frame.width} × ${frame.height} px). Export the tool call that made revision ${revision}.` }],
        structuredContent: { title: name, type, revision, frame },
      });
    }
    await request('ui/message', { role: 'user', content: [{ type: 'text', text: `Add the chart '${name}' (revision ${revision}) to my slides.` }] });
  } catch {
    showStatus('The host did not take the request.');
  }
}

async function fullscreen(on: boolean): Promise<void> {
  try {
    const result = await request('ui/request-display-mode', { mode: on ? 'fullscreen' : 'inline' });
    applyContext({ ...context, displayMode: (result.mode as HostContext['displayMode']) ?? context.displayMode });
  } catch { /* the host keeps its mode */ }
}

/** Without ui/download-file, full screen shows the PNG and the SVG as images to save by hand. */
async function showSaveImages(): Promise<void> {
  const box = $('bp-save');
  if (!payload || host.downloadFile || context.displayMode !== 'fullscreen') { box.hidden = true; return; }
  box.hidden = false;
  const svgImage = $<HTMLImageElement>('bp-save-svg');
  svgImage.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(shownSvg)}`;
  try {
    const png = await chartPng();
    $<HTMLImageElement>('bp-save-png').src = `data:image/png;base64,${png.data}`;
    $('bp-save-png-label').textContent = png.browser ? 'PNG (browser raster)' : 'PNG at 2×';
  } catch { /* the SVG image stays */ }
}

const actions: [string, () => boolean, () => void][] = [
  ['bp-add', () => SLIDES_EXPORT && Boolean(host.message), () => void addToSlides()],
  ['bp-png', () => Boolean(host.downloadFile), () => void downloadPng()],
  ['bp-svg', () => Boolean(host.downloadFile) && context.displayMode === 'fullscreen', () => void downloadSvg()],
  ['bp-copy', () => Boolean(host.sandbox?.permissions?.clipboardWrite) && typeof ClipboardItem !== 'undefined' && context.displayMode === 'fullscreen', () => void copyImage()],
  ['bp-theme', () => context.displayMode === 'fullscreen' && Boolean(payload && !payload.explicitTheme), () => { darkPreview = !dark(); show(); }],
  ['bp-full', () => canFullscreen() && context.displayMode !== 'fullscreen', () => void fullscreen(true)],
  ['bp-exit', () => context.displayMode === 'fullscreen', () => void fullscreen(false)],
];

for (const [id, , run] of actions) $(id).addEventListener('click', run);
$('bp-note-full').addEventListener('click', () => void fullscreen(true));

function updateActions(): void {
  for (const [id, visible] of actions) $(id).hidden = !payload || !visible();
  void showSaveImages();
}

// ------------------------------------------------------------ start

// The root's own height: the document height never drops below the iframe, so it cannot shrink the frame.
let reportedHeight = 0;
new ResizeObserver(() => {
  const height = Math.ceil(root.getBoundingClientRect().height);
  if (height === reportedHeight) return;
  reportedHeight = height;
  notify('ui/notifications/size-changed', { height });
}).observe(root);

(async () => {
  const result = await request('ui/initialize', {
    appInfo: { name: 'boardplot-chart', version: '1' },
    appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
    protocolVersion: '2026-01-26',
  });
  host = (result.hostCapabilities ?? {}) as HostCapabilities;
  applyContext((result.hostContext ?? {}) as HostContext);
  notify('ui/notifications/initialized');
})();
