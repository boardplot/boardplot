/**
 * Core modules a browser bundle fetches only when a chart turns out to need
 * them, with a synchronous fast path when the graph already holds them.
 *
 * Two modules qualify, and both are answers to the same measurement: each
 * costs every entry bytes, and the charts that need it are the minority.
 *
 *   `theme-rules`   the structural theme checker (`core/themeShape`), which
 *                   `resolveTheme` runs over a theme a caller PATCHED. A
 *                   preset needs no check; an override does. 8.9 KB of the
 *                   9.8 KB every chart entry carried for `themeRules` was
 *                   this one function.
 *   `annotate`      `runAnnotatePass`, the event lane (column, combo, line)
 *                   and the two arm drawers the funnel reaches, 39 KB
 *                   minified of placement engine plus the lane, linked by
 *                   every layout that can draw an annotation whether or not
 *                   a chart carries one.
 *
 * `requireDeferred` THROWS `DeferredCoreError` when the module is not here.
 * That is the whole protocol: core code asks for what it needs at the moment
 * it needs it, the React layer catches the throw, draws the busy placeholder
 * and fetches the chunk, and the CLI, the MCP server, `react/prepare` and
 * `useChartLayout` never see it because their entries import the publishing
 * module statically. Nothing is guessed about a chart in advance.
 *
 * This is a fast path, not a registry: each publisher is a module side
 * effect, and a graph that holds it renders in the same pass it always did.
 */

/** The theme checks `resolveTheme` runs over a PATCHED theme. */
interface ThemeShapeRules {
  checkThemeShape: typeof import('./themeShape').checkThemeShape;
  semanticErasureWarnings: typeof import('./themeShape').semanticErasureWarnings;
  unknownThemeKeyRepair: typeof import('./themeShape').unknownThemeKeyRepair;
}

/** The annotation placement pass, the event lane, and the two arms the rows funnel draws itself. */
export interface AnnotateEngine {
  runAnnotatePass: typeof import('./annotate').runAnnotatePass;
  settleEventLane: typeof import('./eventLane').settleEventLane;
  emitEventLane: typeof import('./eventLane').emitEventLane;
  drawCagrArm: typeof import('./annotateArms').drawCagrArm;
  drawHorizontalLevelDiff: typeof import('./annotateArms').drawHorizontalLevelDiff;
  /** Callout and note labels that print their anchor's value (`${value}`), for the hidden-label note. */
  valueAnnotationLabels: (labels: readonly import('./types/scene').PlacedLabel[], annotations: unknown) => [import('./types/scene').PlacedLabel, object][];
}

export interface DeferredCoreModules {
  /** Static entry points link this before layout; live React does not need it. */
  footer: typeof import('./staticFooter').layoutWithStaticFooter;
  'theme-rules': ThemeShapeRules;
  annotate: AnnotateEngine;
  /** The story pass (options.story); opt-in for React through `boardplot/react/story`, never fetched on its own. */
  story: { applyStory: typeof import('./story').applyStory };
}

/**
 * `chart-cores` is the third name, and it is not one module: it stands for
 * the chart cores a grid's panels need (`requireChartCores`). The grid
 * React entry links only the grid core and registers a loader for the rest.
 */
export type DeferredName = keyof DeferredCoreModules | 'chart-cores';

/** Thrown by `requireDeferred`: this graph does not hold the module yet. */
export class DeferredCoreError extends Error {
  /** `failure`: why a core this chart needs did not load ('chart-cores' only); the chart shows it instead of the busy box. */
  constructor(readonly module: DeferredName, readonly failure?: string) {
    super(`the '${module}' module is not loaded in this bundle yet`);
    this.name = 'DeferredCoreError';
  }
}

const held = new Map<keyof DeferredCoreModules, unknown>();
const loaders = new Map<keyof DeferredCoreModules, () => Promise<unknown>>();
const loading = new Set<DeferredName>();
/** Module -> the message of the load that failed, so the same failure is announced once. */
const failures = new Map<DeferredName, string>();
const waiting = new Set<() => void>();
/** Changes whenever a module lands; `useSyncExternalStore` reads it as the snapshot. */
let revision = 0;

function notify(): void {
  revision += 1;
  for (const redraw of [...waiting]) redraw();
}

/** Called at module scope by the accessor that knows which chunk carries the module. */
export function registerDeferredLoader(name: keyof DeferredCoreModules, load: () => Promise<unknown>): void {
  if (!loaders.has(name)) loaders.set(name, load);
}

/** Called at module scope by the publishing module. The first copy wins. */
export function publishDeferred<K extends keyof DeferredCoreModules>(name: K, value: DeferredCoreModules[K]): void {
  if (held.has(name)) return;
  held.set(name, value);
  failures.delete(name);
  // No chart waits for the static footer: content fit links it right before
  // it lays out, which is inside a chart's render. Announcing it there would
  // redraw every other mounted chart from that render, which React refuses
  // ("Cannot update a component while rendering a different component").
  if (name !== 'footer') notify();
}

/** The modules a React chart fetches on demand: whether a process holds them says nothing about the browser. */
const FETCHED: ReadonlySet<DeferredName> = new Set(['theme-rules', 'annotate', 'chart-cores']);
/** Set while a render must match the server's first frame: the fetched modules its own entry links. */
let firstFrameLinks: ReadonlySet<DeferredName> | undefined;

/**
 * Runs `render` as the server's first frame and the hydrating client's first
 * frame see the module store: a fetched module counts only when the chart's
 * own entry links it (`linked`). A server process holds every module any
 * route linked, and the browser holds only what the page's own graph links,
 * so a chart drawn with a module the page does not link would hydrate
 * against the busy placeholder (React error #418). Here both frames draw the
 * placeholder, and the chart follows once hydration has finished.
 */
export function asFirstFrame<T>(linked: readonly DeferredName[], render: () => T): T {
  const outer = firstFrameLinks;
  firstFrameLinks = new Set(linked);
  try { return render(); } finally { firstFrameLinks = outer; }
}

function visible(name: DeferredName): boolean {
  return firstFrameLinks === undefined || !FETCHED.has(name) || firstFrameLinks.has(name);
}

/** The module this graph already holds, or undefined while its chunk loads. */
export function loadedDeferred<K extends keyof DeferredCoreModules>(name: K): DeferredCoreModules[K] | undefined {
  return visible(name) ? held.get(name) as DeferredCoreModules[K] | undefined : undefined;
}

/** The module, or `DeferredCoreError` for the caller above to answer. */
export function requireDeferred<K extends keyof DeferredCoreModules>(name: K): DeferredCoreModules[K] {
  const value = loadedDeferred(name);
  if (value === undefined) throw new DeferredCoreError(name);
  return value;
}

/**
 * Starts the module's chunk, one load at a time. A rejected load leaves no
 * entry behind, so the next render asks again — but it announces a failure
 * only when the message is new, which is what stops a chunk that is simply
 * not deployed from retrying in a loop: one redraw, one more attempt, then
 * the chart stays on the busy placeholder.
 */
export function loadDeferred(name: DeferredName): void {
  if (name === 'chart-cores') { loadChartCores(); return; }
  if (held.has(name) || loading.has(name)) return;
  const load = loaders.get(name);
  if (!load) return;
  loading.add(name);
  void load().then(() => {
    loading.delete(name);
    failures.delete(name);
  }, (reason: unknown) => {
    loading.delete(name);
    const message = reason instanceof Error ? reason.message : String(reason);
    const first = failures.get(name) !== message;
    failures.set(name, message);
    if (first) notify();
  });
}

/**
 * Why the module's last load failed, while no load is running and the module
 * is still missing: what a chart shows instead of the busy placeholder.
 */
export function deferredFailure(name: DeferredName): string | undefined {
  // A grid's failure names the types it needs: it comes on its DeferredCoreError.
  if (name === 'chart-cores') return undefined;
  return held.has(name) || loading.has(name) ? undefined : failures.get(name);
}

/** Loads and registers one chart core; `knows` says which types it can load. */
export interface ChartCoreLoader {
  knows(type: string): boolean;
  load(type: string): Promise<void>;
}

let coreLoader: ChartCoreLoader | undefined;
/** The panel types a layout asked for and this graph does not hold yet. */
const wantedCores = new Set<string>();
/** Type -> the message of its last failed load. A grid that needs none of them draws. */
const coreFailures = new Map<string, string>();
/** The revision an empty round last redrew at: a chart that keeps asking with nothing to load redraws once, not in a loop. */
let emptyRoundRevision = -1;

/** Called by the grid React entry, which links no panel core. The first loader wins. */
export function registerChartCoreLoader(loader: ChartCoreLoader): void {
  coreLoader ??= loader;
}

/**
 * Asks for the cores of a grid's panels, all at once, before the grid lays
 * any of them out. Without a registered loader (the CLI, the MCP server, a
 * graph that links the catalogue) it does nothing and `getChart` decides as
 * before. With one, it throws `DeferredCoreError('chart-cores')` when a type
 * the loader knows is missing, or when this is the server's or the hydrating
 * client's first frame and the chart's entry does not link the cores
 * (`asFirstFrame`): a server that holds them from another route would draw
 * a chart that the browser's first frame cannot.
 */
export function requireChartCores(types: readonly string[], has: (type: string) => boolean): void {
  if (!coreLoader) return;
  const missing = types.filter((type) => !has(type) && coreLoader!.knows(type));
  if (missing.length === 0 && visible('chart-cores')) return;
  for (const type of missing) wantedCores.add(type);
  const failed = loading.has('chart-cores') ? undefined : missing.map((type) => coreFailures.get(type)).find((message) => message !== undefined);
  throw new DeferredCoreError('chart-cores', failed);
}

/**
 * Loads every wanted core in one round. It redraws the waiting charts when
 * the round ends, also when nothing was missing: a first frame that only
 * waited for hydration then lays out with the cores it already has.
 */
function loadChartCores(): void {
  if (!coreLoader || loading.has('chart-cores')) return;
  if (wantedCores.size === 0 && emptyRoundRevision === revision) return;
  const types = [...wantedCores];
  wantedCores.clear();
  loading.add('chart-cores');
  // Every load settles before the round ends: one failed core does not hide
  // the cores that loaded beside it, and each failure stays with its type.
  void Promise.allSettled(types.map((type) => coreLoader!.load(type))).then((results) => {
    loading.delete('chart-cores');
    // A round that only repeats known failures stays quiet, as `loadDeferred`
    // does: a chunk that is not deployed is asked for once more, not in a loop.
    let news = types.length === 0;
    results.forEach((result, index) => {
      const type = types[index]!;
      if (result.status === 'fulfilled') {
        news = true;
        coreFailures.delete(type);
        return;
      }
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      if (coreFailures.get(type) !== message) news = true;
      coreFailures.set(type, message);
    });
    if (news) notify();
    if (types.length === 0) emptyRoundRevision = revision;
    // Types first asked for while this round ran get their own round. A type
    // that failed waits for the next render to ask again, so it cannot loop.
    if ([...wantedCores].some((type) => !coreFailures.has(type))) loadChartCores();
  });
}

/** Redraws everything waiting when a module lands. */
export function onDeferred(redraw: () => void): () => void {
  waiting.add(redraw);
  return () => { waiting.delete(redraw); };
}

/** The store snapshot: a number that changes when a module lands. */
export function deferredRevision(): number {
  return revision;
}
