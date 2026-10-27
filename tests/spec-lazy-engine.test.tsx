// @vitest-environment jsdom
/**
 * BoardplotChart loads spec validation and each chart type's engine on
 * demand, and draws the same markup it drew when both were linked statically.
 *
 * Nothing here is imported for effect: this file holds no static import of
 * `parseChartSpec` and none of the per-type entries, so the first pass is the
 * cold one a page gets. Each case mounts BoardplotChart FIRST and only then
 * loads the type's own entry to compare against, so the comparison runs
 * against a component that arrived through the loader map.
 *
 * Every case draws a cold engine now: validation loads the schemas of the
 * one type a spec names, and a schema chunk registers nothing in the chart
 * registry. The first case asserts exactly that.
 */
import { act, startTransition, Suspense, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { getFixtures } from '../src/fixtures';

/** The table chunk, refusable: table is the one type whose readiness is its component, not the registry. */
const tableChunk = vi.hoisted(() => ({ missing: false }));
/** The waffle engine chunk, held open until a test settles it. */
const waffleEngine = vi.hoisted(() => ({ hold: undefined as Promise<unknown> | undefined, calls: 0 }));
/** The funnel SCHEMA chunk, refusable, for the load that fails before any engine is asked for. */
const funnelSchema = vi.hoisted(() => ({ missing: false }));
vi.mock('../src/react/schemaLoaders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/react/schemaLoaders')>();
  return { ...actual, schemaLoaders: { ...actual.schemaLoaders,
    funnel: () => (funnelSchema.missing ? Promise.reject(new Error('chunk 404')) : actual.schemaLoaders.funnel!()) } };
});
vi.mock('../src/react/chartLoaders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/react/chartLoaders')>();
  return { chartLoaders: { ...actual.chartLoaders,
    table: () => (tableChunk.missing ? Promise.reject(new Error('chunk 404')) : actual.chartLoaders.table!()),
    waffle: () => { waffleEngine.calls += 1; return waffleEngine.hold ?? actual.chartLoaders.waffle!(); } } };
});

import { BoardplotChart } from '../src/react/spec';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const SIZE = { width: 800, height: 450 };

/** type -> the export its own entry publishes, the old path this compares against. */
const ENTRIES = {
  column: () => import('../src/react/charts/column').then(module => module.ColumnChart),
  line: () => import('../src/react/charts/line').then(module => module.LineChart),
  table: () => import('../src/react/charts/table').then(module => module.TableChart),
  kpi: () => import('../src/react/charts/kpi').then(module => module.KpiChart),
  funnel: () => import('../src/react/charts/funnel').then(module => module.FunnelChart),
} as const;

function demoSpec(type: string) {
  const fixture = getFixtures(type).find(candidate => candidate.tags.includes('demo'))!;
  return structuredClone({
    type, data: fixture.data, options: { ...fixture.options as object, size: SIZE },
    ...(fixture.annotations ? { annotations: fixture.annotations } : {}),
  });
}

/** Mount, let every pending chunk land, and read the markup back. */
async function mount(element: ReactElement): Promise<string> {
  const host = document.createElement('div');
  document.body.append(host);
  let root: Root | undefined;
  await act(async () => { root = createRoot(host); root.render(element); });
  // Loading a chart engine is a real module load; under vitest that is a
  // transform, not a microtask, so this waits on the clock.
  const deadline = Date.now() + 20_000;
  while (host.querySelector('[data-bp-loading]') && Date.now() < deadline) {
    await act(async () => { await new Promise(settled => setTimeout(settled, 10)); });
  }
  // React's useId counts mounts within a document, so two mounts of the same
  // chart differ in that one token and nowhere else.
  const markup = host.innerHTML.replace(/_r_[0-9a-z]+_/g, '_r_id_');
  await act(async () => { root!.unmount(); });
  host.remove();
  return markup;
}

describe('BoardplotChart with engines on demand', { timeout: 60_000 }, () => {
  it('draws the busy placeholder, and no chart, before any chunk has landed', () => {
    const markup = renderToStaticMarkup(<BoardplotChart spec={demoSpec('column')} />);
    expect(markup).toContain('data-bp-loading');
    expect(markup).toContain('Loading');
    expect(markup).not.toContain('<svg');
    expect(markup).not.toContain('bp-table-grid');
  });

  it('names a chunk that will not load, and draws once it does', async () => {
    tableChunk.missing = true;
    const host = document.createElement('div');
    document.body.append(host);
    let root: Root | undefined;
    // A host that replaced its probe for the error card with onSpecError must hear a chunk that did not load, and its recovery.
    const specError = vi.fn();
    await act(async () => { root = createRoot(host); root.render(<BoardplotChart spec={demoSpec('table')} onSpecError={specError} />); });
    const deadline = Date.now() + 20_000;
    while (!host.querySelector('[data-bp-diagnostic-details]') && Date.now() < deadline) {
      await act(async () => { await new Promise((done) => { setTimeout(done, 10); }); });
    }
    const card = host.querySelector('[data-bp-spec-error]')!;
    expect(card.querySelector('[data-bp-error-code="chunk-load-failed"]') === null).toBe(false);
    expect(specError).toHaveBeenCalledOnce();
    expect(specError.mock.calls[0]![0]).toEqual([expect.objectContaining({ code: 'chunk-load-failed', message: expect.stringContaining('chunk 404') })]);
    expect(card.textContent).toContain("'table' chart engine");
    expect(card.textContent).toContain('chunk 404');
    expect(card.textContent).toContain('Reload the page');

    // The rejected load left no cache entry, so the next render tries again.
    tableChunk.missing = false;
    await act(async () => { root!.render(<BoardplotChart spec={demoSpec('table')} onSpecError={specError} />); });
    while (!host.querySelector('.bp-table-grid') && Date.now() < deadline) {
      await act(async () => { await new Promise((done) => { setTimeout(done, 10); }); });
    }
    expect(host.querySelector('.bp-table-grid') === null).toBe(false);
    expect(specError).toHaveBeenCalledTimes(2);
    expect(specError).toHaveBeenLastCalledWith([]);
    expect(host.querySelector('[data-bp-spec-error]')).toBeNull();
    await act(async () => { root!.unmount(); });
    host.remove();
  });

  it('names a schema chunk that will not load, and validates once it does', async () => {
    funnelSchema.missing = true;
    const host = document.createElement('div');
    document.body.append(host);
    let root: Root | undefined;
    await act(async () => { root = createRoot(host); root.render(<BoardplotChart spec={demoSpec('funnel')} />); });
    const deadline = Date.now() + 20_000;
    while (!host.querySelector('[data-bp-diagnostic-details]') && Date.now() < deadline) {
      await act(async () => { await new Promise((done) => { setTimeout(done, 10); }); });
    }
    const card = host.querySelector('[data-bp-spec-error]')!;
    expect(card.querySelector('[data-bp-error-code="chunk-load-failed"]') === null).toBe(false);
    expect(card.textContent).toContain("'funnel' chart schema");
    expect(card.textContent).toContain('chunk 404');

    funnelSchema.missing = false;
    await act(async () => { root!.render(<BoardplotChart spec={demoSpec('funnel')} />); });
    while (!host.querySelector('svg') && Date.now() < deadline) {
      await act(async () => { await new Promise((done) => { setTimeout(done, 10); }); });
    }
    expect(host.querySelector('svg') === null).toBe(false);
    expect(host.querySelector('[data-bp-spec-error]')).toBeNull();
    await act(async () => { root!.unmount(); });
    host.remove();
  });

  it.each(Object.keys(ENTRIES))('%s renders the same markup through BoardplotChart as through its own entry', async type => {
    const spec = demoSpec(type);
    const viaSpec = await mount(<BoardplotChart spec={structuredClone(spec)} />);
    expect(viaSpec).not.toContain('data-bp-loading');
    expect(viaSpec.length).toBeGreaterThan(200);

    const { parseChartSpec } = await import('../src/react/parseChartSpec');
    const request = (await parseChartSpec(structuredClone(spec))).request;
    const Chart = await ENTRIES[type as keyof typeof ENTRIES]() as unknown as (props: Record<string, unknown>) => ReactElement;
    const viaEntry = await mount(<Chart
      {...request.options as Record<string, unknown>}
      data={request.data}
      annotations={request.annotations}
      size={SIZE}
    />);

    expect(viaSpec).toBe(viaEntry);
  });

  // A transition that suspends and never commits must not leave its onSpecError behind for a later chunk failure.
  it('reports a chunk failure to the committed onSpecError, not to a suspended transition\'s', async () => {
    let fail!: (reason: Error) => void;
    waffleEngine.hold = new Promise((_, reject) => { fail = reject; });
    const committed = vi.fn();
    const suspended = vi.fn();
    const never = new Promise<never>(() => {});
    function Never(): ReactElement { throw never; }
    const view = (onSpecError: typeof committed, suspend: boolean, children?: ReactNode) => <Suspense fallback="busy">
      <BoardplotChart spec={demoSpec('waffle')} onSpecError={onSpecError} />{suspend && <Never />}{children}
    </Suspense>;
    const host = document.createElement('div');
    document.body.append(host);
    let root: Root | undefined;
    await act(async () => { root = createRoot(host); root.render(view(committed, false)); });
    const deadline = Date.now() + 20_000;
    while (waffleEngine.calls === 0 && Date.now() < deadline) {
      await act(async () => { await new Promise((done) => { setTimeout(done, 10); }); });
    }
    expect(waffleEngine.calls).toBeGreaterThan(0);
    await act(async () => { startTransition(() => { root!.render(view(suspended, true)); }); });
    expect(host.textContent).not.toContain('busy');
    await act(async () => { fail(new Error('chunk 404')); });
    while (!host.querySelector('[data-bp-spec-error]') && Date.now() < deadline) {
      await act(async () => { await new Promise((done) => { setTimeout(done, 10); }); });
    }
    expect(committed).toHaveBeenCalledOnce();
    expect(committed.mock.calls[0]![0]).toEqual([expect.objectContaining({ code: 'chunk-load-failed' })]);
    expect(suspended).not.toHaveBeenCalled();
    waffleEngine.hold = undefined;
    await act(async () => { root!.unmount(); });
    host.remove();
  });

  // The grid entry linked every chart core (about 0.8 MB gzip) for its panels. It now fetches the
  // cores its panels name, and its server pass stays the busy placeholder even where the process
  // already holds them, so hydration meets the same markup.
  it('draws a grid with only the cores its panels name, and keeps its server pass busy', async () => {
    const spec = demoSpec('grid');
    const panels = new Set((spec.data as { panels: { type: string }[] }).panels.map(panel => panel.type));
    const viaSpec = await mount(<BoardplotChart spec={structuredClone(spec)} />);
    expect(viaSpec).toContain('<svg');
    const { getChart } = await import('../src/core/registry');
    for (const type of panels) expect(getChart(type), type).toBeDefined();
    for (const type of ['treemap', 'gantt', 'choropleth', 'mekko']) expect(getChart(type), type).toBeUndefined();
    const Grid = (await import('../src/react/charts/grid')).GridChart as unknown as (props: Record<string, unknown>) => ReactElement;
    const props: Record<string, unknown> = { ...spec.options, data: spec.data };
    expect(renderToStaticMarkup(<Grid {...props} />)).toContain('data-bp-loading');
    expect(await mount(<Grid {...props} />)).toBe(viaSpec);
  });

  // While a grid fetches a new panel's core the screen keeps the old drawing; an export then must not print the new data.
  it('hands the exporter no snapshot while a grid panel core loads', async () => {
    const { getChart } = await import('../src/core/registry');
    expect(getChart('bar')).toBeUndefined();
    const Grid = (await import('../src/react/charts/grid')).GridChart as unknown as (props: Record<string, unknown>) => ReactElement;
    const { useExport } = await import('../src/react/export');
    const panel = (type: string, label: string, value: number) => ({ id: 'p', type, data: { categories: [{ id: label }], series: [{ id: 's', label: 'Sales', values: [value] }] } });
    let handle: ReturnType<typeof useExport> | undefined;
    function Page({ type, label, value }: { type: string; label: string; value: number }) {
      handle = useExport();
      return <Grid data={{ panels: [panel(type, label, value)] }} size={SIZE} exporter={handle} />;
    }
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => { root.render(<Page type="column" label="Old" value={10} />); });
    const deadline = Date.now() + 5000;
    while (host.querySelector('[data-bp-loading]') && Date.now() < deadline) await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    const old = await handle!.svg();
    expect(old.ok && old.artifact.text).toContain('Old');
    act(() => { root.render(<Page type="bar" label="New" value={90} />); });
    const pending = await handle!.svg();
    expect(pending.ok && pending.artifact.text).not.toContain('New');
    await act(async () => { root.unmount(); });
    host.remove();
  });
});
