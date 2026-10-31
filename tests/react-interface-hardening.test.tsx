// @vitest-environment jsdom

// Patched themes are checked by `core/themeShape`, which a CLI-shaped graph links and a chart entry fetches (core/deferred).
import '../src/core/themeShapeRules';
import { act, createElement, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadedDeferred } from '../src/core/deferred';
import { getChart } from '../src/core/registry';
import { invertedRangeTorture } from '../src/core/charts/dot/fixtures';
import { getFixtures } from '../src/fixtures';
import { NormalizeError } from '../src/core/normalize/shared';
import { resolveTheme } from '../src/core/theme';
import { renderSvg } from '../src/core/svg/renderSvg';
import type { Geometry, SceneNode } from '../src/core/types/scene';
import { BarChart } from '../src/react/charts/bar';
import { CohortChart } from '../src/react/charts/cohort';
import { ChoroplethChart } from '../src/react/charts/choropleth';
import { ColumnChart } from '../src/react/charts/column';
import { DimSwitchChart } from '../src/react/DimSwitchChart';
import { exampleData as dimSwitchData } from '../src/core/charts/dimswitch/example';
import { BoardplotChart } from '../src/react/spec';
import { BoardplotTheme } from '../src/react/BoardplotTheme';
import { createChartComponent } from '../src/react/createChartComponent';
import { DotChart } from '../src/react/charts/dot';
import { KpiChart } from '../src/react/charts/kpi';
import { TableChart } from '../src/react/charts/table';
import { SceneRenderer } from '../src/react/SceneRenderer';

const DATA = {
  categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
  series: [{ id: 's', label: 'Series', values: [1, 2] }],
};

const GEOMETRY = {
  type: 'adapter-test',
  size: { width: 320, height: 180 },
  plot: { x: 0, y: 0, w: 320, h: 180 },
  scene: [
    {
      t: 'rect',
      id: 'rounded',
      rect: { x: 1, y: 2, w: 30, h: 20 },
      radius: 6,
      fill: { token: 'highlight' },
      owner: {},
      part: 'bar',
      display: { value: '42' },
    },
    {
      t: 'text',
      id: 'tracked',
      x: 100,
      y: 10,
      lines: ['ABC'],
      align: 'end',
      font: { size: 10, weight: 500, letterSpacing: 2 },
      ink: { token: 'ink' },
      owner: {},
      part: 'label',
    },
  ],
  labels: [],
  axes: [],
  annotations: [],
  frame: {},
  marks: {},
  derived: {},
  a11y: { title: 'Adapter test', desc: 'Two renderer contract nodes' },
  warnings: [],
  debug: { occupied: [], decisions: [] },
} as unknown as Geometry;

const HATCH_GEOMETRY = {
  ...GEOMETRY,
  scene: [
    {
      ...(GEOMETRY.scene[0] as object),
      pattern: 'hatch45',
    },
  ],
} as Geometry;

const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
actGlobal.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('React adapter boundary', () => {
  it('runs the data schema before layout', () => {
    const definition = getChart('column')!;
    const layout = vi.spyOn(definition, 'layout');
    expect(() =>
      renderToStaticMarkup(
        createElement(ColumnChart, {
          data: { categories: [{ id: 'a' }], series: [{ id: 's', values: [{ range: { low: 9, high: 1 } }] }] } as never,
        }),
      ),
    ).toThrow();
    expect(layout).not.toHaveBeenCalled();
  });

  it('runs semantic normalization before range-family layout', () => {
    for (const Component of [BarChart, ColumnChart, DotChart]) {
      let caught: unknown;
      try {
        renderToStaticMarkup(
          createElement(Component as typeof DotChart, { data: invertedRangeTorture }),
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(NormalizeError);
      expect((caught as NormalizeError).code).toBe('range-inverted');
    }
  });

  it('keeps fixed charts intrinsic and calls onGeometry only after a client commit', () => {
    const onGeometry = vi.fn();
    const server = renderToStaticMarkup(
      createElement(ColumnChart, { data: DATA, fixedSize: true, onGeometry }),
    );
    expect(server).toMatch(/<svg[^>]*width="[0-9.]+"[^>]*height="[0-9.]+"/);
    expect(onGeometry).not.toHaveBeenCalled();

    act(() => {
      root.render(<ColumnChart data={DATA} fixedSize onGeometry={onGeometry} />);
    });
    expect(onGeometry).toHaveBeenCalledTimes(1);
  });

  it('keeps standalone KPI cards bounded inside a wide host while their SVG stays responsive', () => {
    container.style.width = '1000px';
    // A report card keeps its explicit width.
    for (const [size, width] of [[undefined, 360], [{ width: 800, height: 144 }, 800]] as const) {
      act(() => root.render(<KpiChart data={{ label: 'Revenue', value: 120 }} size={size} />));
      const svg = container.querySelector('svg')!;
      expect(svg.getAttribute('viewBox')?.split(' ')[2]).toBe(String(width));
      // A report card draws at its natural width and shrinks with its host, never wider.
      expect(svg.getAttribute('width')).toBe(String(width));
      expect(svg.style.maxWidth).toBe('100%');
      expect(svg.parentElement?.style.maxWidth).toBe(String(width) + 'px');
    }
    act(() => root.render(<KpiChart
      data={{ label: 'Net revenue churn', value: 3.2, delta: { vs: 4.1 }, spark: { kind: 'line', values: [4.1, 3.8, 3.2] } }}
      title="Churn fell to 3.2% in FY25, down 0.9 points vs PY" source="Retention model" mode="full"
    />));
    const grown = container.querySelector('svg')!;
    expect(Number(grown.getAttribute('viewBox')?.split(' ')[3])).toBeGreaterThan(144);
    // A fixed column is bounded at its natural width too.
    act(() => root.render(<ColumnChart data={DATA} />));
    const column = container.querySelector('svg')!;
    expect(column.style.maxWidth).toBe('100%');
    expect(column.parentElement?.style.maxWidth).toBe('720px');
  });

  it('shows an undersized chart placeholder without reporting successful geometry', async () => {
    const resized: ResizeObserverCallback[] = [];
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} constructor(callback: ResizeObserverCallback) { resized.push(callback); } });
    const onGeometry = vi.fn();
    const chart = <ColumnChart data={DATA} size={{ width: 279, height: 180 }} onGeometry={onGeometry} />;
    const server = renderToStaticMarkup(chart);
    expect(server).toContain('data-bp-refused="size-below-floor"');
    expect(server).not.toContain('<svg');

    await act(async () => { root.render(chart); });
    for (let i = 0; i < 20 && container.querySelector('[data-bp-loading]'); i++) await act(async () => { await new Promise(r => setTimeout(r, 25)); });
    const placeholder = container.querySelector('[role="status"]');
    // the lazy reader box says the chart needs more room; the exact sizes sit in its details and title.
    expect(placeholder?.textContent).toContain('This chart needs more room.');
    expect(placeholder?.textContent).toContain('Column needs at least 280 × 180px; received 279 × 180px');
    expect(placeholder?.getAttribute('data-bp-diagnostics')).toContain('needs at least 280 × 180px; received 279 × 180px');
    expect(container.querySelector('svg')).toBeNull();
    expect(onGeometry).not.toHaveBeenCalled();

    act(() => root.render(<ColumnChart data={DATA} size={{ width: 480, height: 270 }} onGeometry={onGeometry} />));
    expect(container.querySelector('[data-bp-refused]')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(onGeometry).toHaveBeenCalledTimes(1);
    // A browser can deliver a resize that the placeholder queued before it unmounted.
    expect(resized.length).toBeGreaterThan(0);
    for (const callback of resized) expect(() => callback([], {} as ResizeObserver)).not.toThrow();
  });

  // A host that stores a new object from an inline callback re-rendered the chart without end, because each new callback fired its effect again.
  it('calls an inline onGeometry, onNotes and onRefused once, even when each stores a new object', async () => {
    const calls = { geometry: 0, notes: 0, refused: 0 };
    let renders = 0;
    function Host({ size }: { size: { width: number; height: number } }) {
      const [, setBox] = useState<object>();
      if (++renders > 40) throw new Error('render loop');
      return <ColumnChart data={DATA} size={size} source="Invented source" notes={{ placement: 'list' }}
        onGeometry={g => { calls.geometry++; setBox({ w: g.size.width }); }}
        onNotes={n => { calls.notes++; setBox({ n: n.length }); }}
        onRefused={r => { calls.refused++; setBox({ r: r.warnings.length }); }} />;
    }
    const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 25)); }); };
    await act(async () => { root.render(<Host size={{ width: 480, height: 270 }} />); });
    await settle();
    expect(calls.geometry).toBe(1);
    expect(calls.notes).toBe(1);
    await act(async () => { root.render(<Host size={{ width: 200, height: 120 }} />); });
    await settle();
    expect(calls.refused).toBe(1);
    expect(renders).toBeLessThan(10);
  });

  // A table refused at an inline `size={{ … }}` re-rendered without end: the new size object remade the refusal on every render.
  it('calls onRefused once for a table refused at an inline size', async () => {
    const data = {
      columns: [
        { id: 'label', kind: 'rowLabel' as const, label: 'Item' },
        { id: 'value', kind: 'value' as const, label: 'Value' },
      ],
      rows: [{ id: 'a', label: 'A', cells: { value: 12 } }],
    };
    let renders = 0;
    let calls = 0;
    function Host() {
      const [, setBox] = useState<object>();
      if (++renders > 40) throw new Error('render loop');
      return <TableChart data={data} size={{ width: 40, height: 40 }} onRefused={r => { calls++; setBox({ r: r.warnings.length }); }} />;
    }
    await act(async () => { root.render(<Host />); });
    for (let i = 0; i < 4; i++) await act(async () => { await new Promise(r => setTimeout(r, 25)); });
    expect(calls).toBe(1);
    expect(renders).toBeLessThan(10);
  });

  // A host that handled the refusal through onRefused still got console noise for it.
  it('keeps the console quiet for a refusal the host takes through onRefused', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onRefused = vi.fn();
    await act(async () => { root.render(<ColumnChart data={DATA} size={{ width: 200, height: 120 }} onRefused={onRefused} />); });
    for (let i = 0; i < 20 && container.querySelector('[data-bp-loading]'); i++) await act(async () => { await new Promise(r => setTimeout(r, 25)); });
    expect(container.querySelector('[data-bp-refused]')).not.toBeNull();
    expect(onRefused).toHaveBeenCalled();
    expect(warn.mock.calls.filter(([text]) => String(text).startsWith('Boardplot refused'))).toEqual([]);
    warn.mockRestore();
  });

  // A bad axis bound, size, theme name or geo pack threw during render and unmounted the host's whole React root, with its good charts.
  it('draws a refusal card for a bad value and keeps its sibling chart', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const sparse: number[] = []; sparse[0] = 1; sparse[2] = 3;
    const bad: Record<string, ReactElement> = {
      'invalid-geometry': <ColumnChart data={DATA} size={{ width: 480, height: 270 }} valueAxis={{ min: 'low' } as never} />,
      'invalid-size': <ColumnChart data={DATA} size={{ width: '480', height: '270' } as never} />,
      'unknown-theme': <ColumnChart data={DATA} size={{ width: 480, height: 270 }} theme={'nope' as never} />,
      'geo-pack-not-registered': <ChoroplethChart data={{ pack: 'eu27', regions: [{ id: 'DE', value: 1 }] } as never} size={{ width: 480, height: 270 }} />,
    };
    for (const [code, element] of Object.entries(bad)) {
      await act(async () => { root.render(<div><ColumnChart data={DATA} size={{ width: 480, height: 270 }} />{element}</div>); });
      for (let i = 0; i < 20 && container.querySelector('[data-bp-loading]'); i++) await act(async () => { await new Promise(r => setTimeout(r, 25)); });
      expect(container.querySelectorAll('svg').length, code).toBe(1);
      expect(container.querySelector(`[data-bp-error-code="${code}"]`), code).not.toBeNull();
    }
    // A hole in a sparse values array reads as a missing value, as the null of a JSON spec does.
    await act(async () => { root.render(<ColumnChart data={{ ...DATA, categories: [...DATA.categories, { id: 'c', label: 'C' }], series: [{ id: 's', label: 'S', values: sparse }] }} size={{ width: 480, height: 270 }} />); });
    expect(container.querySelector('svg')).not.toBeNull();
  });

  // A bad theme from a BoardplotTheme provider that is later fixed left the refusal card up, because the chart's own props did not change.
  it('draws the chart again when the inherited theme is fixed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const chart = <ColumnChart data={DATA} size={{ width: 480, height: 270 }} />;
    let setTheme: (theme: string) => void = () => {};
    function Host() {
      const [theme, set] = useState('nope');
      setTheme = set;
      return <BoardplotTheme theme={theme as never}>{chart}</BoardplotTheme>;
    }
    await act(async () => { root.render(<Host />); });
    for (let i = 0; i < 20 && container.querySelector('[data-bp-loading]'); i++) await act(async () => { await new Promise(r => setTimeout(r, 25)); });
    expect(container.querySelector('[data-bp-error-code="unknown-theme"]')).not.toBeNull();
    await act(async () => { setTheme('standard'); });
    for (let i = 0; i < 20 && container.querySelector('[data-bp-loading]'); i++) await act(async () => { await new Promise(r => setTimeout(r, 25)); });
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('[data-bp-error-code]')).toBeNull();
  });

  // A table is not built by createChartComponent: it threw on the same bad values and unmounted the host's root.
  it('draws a refusal card for a bad value in a table and keeps its sibling chart', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const table = getFixtures('table').find(f => f.id === 'management-report')!.data;
    const bad: Record<string, ReactElement> = {
      'unknown-theme': <TableChart data={table} theme={'nope' as never} />,
      'invalid-size': <TableChart data={table} size={{ width: '800' } as never} />,
      'invalid-theme-override': <BoardplotChart spec={{ type: 'table', data: table, options: { theme: { preset: 'standard', overrides: { color: { ink: 'zzz' } } } } } as never} />,
      'unknown-theme-spec': <BoardplotChart spec={{ type: 'table', data: table, options: { theme: 'nope' } } as never} />,
      'unknown-theme-dimswitch': <DimSwitchChart data={dimSwitchData} variant="by-measure" depth={1} theme={'nope' as never} />,
    };
    for (const [code, element] of Object.entries(bad)) {
      await act(async () => { root.render(<div><ColumnChart data={DATA} size={{ width: 480, height: 270 }} />{element}</div>); });
      for (let i = 0; i < 20 && container.querySelector('[data-bp-loading]'); i++) await act(async () => { await new Promise(r => setTimeout(r, 25)); });
      expect(container.querySelectorAll('svg').length, code).toBe(1);
      expect(container.querySelector('[data-bp-error-code]'), code).not.toBeNull();
    }
  });

  // An annotation added after the first draw waits for the annotation chunk: the busy placeholder
  // came back over the drawn chart, and a host that swaps in the chart on its first draw showed "Loading".
  it('keeps the drawn chart on screen while a late core chunk loads', async () => {
    const fixture = getFixtures('column').find(candidate => candidate.id === 'stacked-series-cagr')!;
    expect(fixture.annotations?.length).toBeGreaterThan(0);
    expect(loadedDeferred('annotate')).toBeUndefined();
    act(() => root.render(<ColumnChart data={fixture.data} {...fixture.options} />));
    act(() => root.render(<ColumnChart data={fixture.data} {...fixture.options} annotations={fixture.annotations} />));
    expect(container.querySelector('[data-bp-loading]')).toBeNull();
    expect(container.querySelector('svg[data-bp-chart]')).not.toBeNull();
    for (let i = 0; i < 20 && !loadedDeferred('annotate'); i++) await act(async () => { await new Promise(r => setTimeout(r, 25)); });
    expect(container.querySelector('svg[data-bp-chart]')).not.toBeNull();
  });

  it('shows an undersized table placeholder and restores the table when space is available', () => {
    const data = {
      columns: [
        { id: 'label', kind: 'rowLabel' as const, label: 'Item' },
        { id: 'value', kind: 'value' as const, label: 'Value' },
      ],
      rows: [{ id: 'a', label: 'A', cells: { value: 12 } }],
    };
    act(() => root.render(<TableChart data={data} size={{ width: 99, height: 80 }} />));
    expect(container.querySelector('[role="status"][data-bp-refused="size-below-floor"]')).not.toBeNull();
    expect(container.querySelector('.bp-table-grid')).toBeNull();

    act(() => root.render(<TableChart data={data} />));
    expect(container.querySelector('[data-bp-refused]')).toBeNull();
    expect(container.querySelector('.bp-table-grid')).not.toBeNull();
    expect(container.querySelector('[data-bp-rowgroup="body"]')?.textContent).toContain('12');
  });

  it('matches the canonical rectangle and text attributes', () => {
    const html = renderToStaticMarkup(
      <SceneRenderer geometry={GEOMETRY} theme={resolveTheme()} responsive={false} />,
    );
    expect(html).toContain('width="320"');
    expect(html).toContain('height="180"');
    expect(html).toMatch(/data-id="rounded"[^>]*rx="6"/);
    expect(html).toMatch(/data-id="tracked"[\s\S]*x="102" y="18.8"/);
    expect(html).toContain('letter-spacing="2"');
    expect(html).not.toContain('dominant-baseline');
  });

  it('rejects non-finite geometry before rendering markup', () => {
    const invalid = {
      ...GEOMETRY,
      size: { ...GEOMETRY.size, width: Number.NaN },
    } as Geometry;
    expect(() =>
      renderToStaticMarkup(
        <SceneRenderer geometry={invalid} theme={resolveTheme()} />,
      ),
    ).toThrow(/invalid React geometry numeric size\.width/);
  });

  it('scopes hatch definitions per mounted chart', () => {
    const html = renderToStaticMarkup(
      <div>
        <SceneRenderer geometry={HATCH_GEOMETRY} theme={resolveTheme()} />
        <SceneRenderer geometry={HATCH_GEOMETRY} theme={resolveTheme()} />
      </div>,
    );
    const ids = [...html.matchAll(/<pattern id="([^"]+)"/g)].map((match) => match[1]!);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(html).toContain(`fill="url(#${id})"`);
  });

  it('matches canonical hatch paints and dimensions while preserving the segment border', () => {
    for (const hatchColor of ['segment', 'ink'] as const) {
      const theme = resolveTheme({ preset: 'standard', overrides: { pattern: { hatchColor, hatchGap: 6, hatchStrokeWidth: 1 } } });
      const expectedStroke = hatchColor === 'ink' ? theme.color.ink : theme.color.highlight;
      for (const markup of [renderSvg(HATCH_GEOMETRY, theme), renderToStaticMarkup(<SceneRenderer geometry={HATCH_GEOMETRY} theme={theme} />)]) {
        const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
        expect(doc.querySelector('pattern path')?.getAttribute('stroke')).toBe(expectedStroke);
        // The pre-rotated tile: side gap·√2, the theme's full stroke width.
        expect(doc.querySelector('pattern path')?.getAttribute('stroke-width')).toBe('1');
        expect(doc.querySelector('pattern')?.getAttribute('width')).toBe('8.48');
        expect(doc.querySelector('pattern')?.getAttribute('height')).toBe('8.48');
        expect(doc.querySelector('[data-id="rounded"]')?.getAttribute('stroke')).toBe(theme.color.highlight);
      }
    }
  });

  it('renders forecast path hatches in both serializers without adding a border', () => {
    const path: Extract<SceneNode, { t: 'path' }> = {
      t: 'path', id: 'forecast-area', d: 'M10 10L80 25L80 80L10 80Z',
      fill: { token: 'highlight' }, pattern: 'hatch45', owner: { seriesId: 's' }, part: 'area',
    };
    const geometry: Geometry = { ...GEOMETRY, scene: [path, { ...path, id: 'outlined-area', stroke: { token: 'leader' }, width: 2, dash: [3, 2] }, { ...path, id: 'actual-area', pattern: undefined }] };
    for (const preset of ['standard', 'standard-dark']) {
      for (const hatchColor of ['segment', 'ink'] as const) {
        const theme = resolveTheme({ preset, overrides: { pattern: { hatchColor } } });
        const svg = renderSvg(geometry, theme);
        expect(renderSvg(geometry, theme)).toBe(svg);
        for (const markup of [svg, renderToStaticMarkup(<SceneRenderer geometry={geometry} theme={theme} />)]) {
          const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
          const area = doc.querySelector('[data-id="forecast-area"]')!;
          const outlined = doc.querySelector('[data-id="outlined-area"]')!;
          expect(doc.querySelectorAll('pattern')).toHaveLength(1);
          expect(area.getAttribute('fill')).toBe(`url(#${doc.querySelector('pattern')!.id})`);
          expect(area.getAttribute('d')).toBe(path.d);
          expect(area.hasAttribute('stroke')).toBe(false);
          expect(doc.querySelector('pattern path')?.getAttribute('stroke')).toBe(hatchColor === 'ink' ? theme.color.ink : theme.color.highlight);
          expect(outlined.getAttribute('stroke')).toBe(theme.color.leader);
          expect(outlined.getAttribute('stroke-width')).toBe('2');
          expect(outlined.getAttribute('stroke-dasharray')).toBe('3 2');
          expect(doc.querySelector('[data-id="actual-area"]')?.getAttribute('fill')).toBe(theme.color.highlight);
        }
      }
    }
  });

  it('keeps actual and forecast path interaction keys separate when their paint matches', () => {
    const geometry: Geometry = { ...GEOMETRY, scene: [], legend: { rect: { x: 0, y: 0, w: 80, h: 20 }, items: [] } };
    for (const [index, id] of ['ac', 'fc'].entries()) {
      const pattern = id === 'fc' ? 'hatch45' : undefined;
      geometry.scene.push(
        { t: 'rect', id: `${id}-key`, rect: { x: index * 40, y: 0, w: 10, h: 10 }, fill: { token: 'highlight' }, pattern, owner: {}, part: 'swatch' },
        { t: 'text', id: `${id}-label`, x: index * 40 + 12, y: 0, lines: [id], font: { size: 10, weight: 400 }, align: 'start', ink: { token: 'ink' }, owner: {}, part: 'legendLabel' },
        { t: 'path', id: `${id}-area`, d: 'M10 20L30 30L30 60Z', fill: { token: 'highlight' }, pattern, owner: { seriesId: 'same-series' }, part: 'area' },
      );
      geometry.legend!.items.push({ id, swatchNodeId: `${id}-key`, labelId: `${id}-label` });
    }
    const doc = new DOMParser().parseFromString(renderSvg(geometry, resolveTheme(), { interactive: true }), 'image/svg+xml');
    expect(doc.querySelector('[data-id="ac-area"]')?.getAttribute('data-bp-key')).toBe('ac');
    expect(doc.querySelector('[data-id="fc-area"]')?.getAttribute('data-bp-key')).toBe('fc');
  });

  it('activates clickable SVG nodes with Enter and Space', () => {
    const onElementClick = vi.fn();
    const clickGeometry = {
      ...GEOMETRY,
      scene: [{ ...GEOMETRY.scene[0]!, part: '', display: undefined }],
    } as Geometry;
    act(() => {
      root.render(
        <SceneRenderer
          geometry={clickGeometry}
          theme={resolveTheme()}
          onElementClick={onElementClick}
        />,
      );
    });
    const target = container.querySelector<SVGElement>('[data-id="rounded"]')!;
    expect(target.getAttribute('role')).toBe('button');
    expect(target.getAttribute('tabindex')).toBe('0');
    expect(target.getAttribute('aria-label')).toBe('rounded');
    for (const key of ['Enter', ' ']) {
      act(() => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
    }
    expect(onElementClick).toHaveBeenCalledTimes(2);
    expect(onElementClick.mock.calls[0]![0]).toMatchObject({ id: 'rounded' });
  });

  it('keeps a text backing inside the label click target', () => {
    const onElementClick = vi.fn();
    const text = { ...GEOMETRY.scene[1]!, backing: { x: 60, y: 8, w: 44, h: 16 } } as SceneNode;
    act(() => {
      root.render(<SceneRenderer geometry={{ ...GEOMETRY, scene: [text] } as Geometry} theme={resolveTheme()} onElementClick={onElementClick} />);
    });
    const backing = container.querySelector<SVGRectElement>('rect[opacity="0.92"]')!;
    act(() => backing.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    act(() => container.querySelector('[data-id="tracked"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onElementClick).toHaveBeenCalledTimes(2);
    expect(onElementClick.mock.calls.map(([node]) => (node as SceneNode).id)).toEqual(['tracked', 'tracked']);
  });
});


describe('SVG accessible names and optional hover titles', () => {
  it('keeps names and separate descriptions for default and opted-in charts', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(createElement('div', null,
      createElement(ColumnChart, { data: DATA, title: 'First chart' }),
      createElement(ColumnChart, { data: DATA, title: 'Second chart', a11y: { title: true } }),
    ));
    const charts = Array.from(host.querySelectorAll('svg'));
    expect(charts).toHaveLength(2);
    expect(charts[0]!.querySelector('title')).toBeNull();
    expect(charts[1]!.querySelector('title')?.textContent).toBe('Second chart');
    const descriptions = charts.map((chart, index) => {
      expect(chart.getAttribute('aria-label')).toBe(index === 0 ? 'First chart' : 'Second chart');
      const id = chart.getAttribute('aria-describedby');
      expect(id).toBeTruthy();
      expect(chart.querySelector('desc')?.id).toBe(id);
      expect(chart.querySelector('desc')?.textContent).toBeTruthy();
      return id;
    });
    expect(new Set(descriptions).size).toBe(2);
  });
});

// A cohort table too wide for its card scrolls at the width it needs, as TableChart does, instead of the
// refusal card or a compact form that leaves periods out.
it('scrolls a cohort refused for width alone', () => {
  const fixture = getFixtures('cohort').find(f => f.id === 'crowded-average-bases')!;
  const { size: _size, ...options } = fixture.options as Record<string, unknown>;
  const html = renderToStaticMarkup(createElement(CohortChart, { data: fixture.data, ...options, size: { width: 400 } } as never));
  expect(html).toContain('data-bp-scroll');
  expect(html).not.toMatch(/needs at least/);
  expect(Number(/<svg[^>]*\swidth="([\d.]+)"/.exec(html)?.[1])).toBeGreaterThan(400);
  // A container cohort keeps its content fit on the wide retry: a short fallback height still scrolls.
  const contained = renderToStaticMarkup(createElement(CohortChart, { data: fixture.data, ...options, size: 'container', fallbackSize: { width: 400, height: 200 } } as never));
  expect(contained).toContain('data-bp-scroll');
  expect(contained).not.toMatch(/needs at least/);
});

// A host fades a scrolled cohort's cut edge from these reports, as it does a table's; without them a phone shows no cut.
it('reports the scroll state of a scrolled cohort', () => {
  const fixture = getFixtures('cohort').find(f => f.id === 'crowded-average-bases')!;
  const { size: _size, ...options } = fixture.options as Record<string, unknown>;
  const onScrollChange = vi.fn();
  act(() => root.render(createElement(CohortChart, { data: fixture.data, ...options, size: { width: 400 }, onScrollChange } as never)));
  const scroller = container.querySelector<HTMLElement>('[data-bp-scroll]');
  expect(scroller?.classList.contains('bp-scroll')).toBe(true);
  expect(onScrollChange).toHaveBeenCalledTimes(1);
  act(() => { scroller!.dispatchEvent(new Event('scroll')); });
  expect(onScrollChange).toHaveBeenCalledTimes(2);
  expect(onScrollChange.mock.lastCall?.[0]).toMatchObject({ scrollLeft: 0, gutterRight: 0 });
  // A box wide enough for the cohort drops the scroller and reports the empty state once.
  act(() => root.render(createElement(CohortChart, { data: fixture.data, ...options, size: { width: 1400 }, onScrollChange } as never)));
  expect(container.querySelector('[data-bp-scroll]')).toBeNull();
  expect(onScrollChange).toHaveBeenCalledTimes(3);
  expect(onScrollChange.mock.lastCall?.[0]).toMatchObject({ scrollWidth: 0, clientWidth: 0 });
});

// A per-role title family used to fall back to the base family, and React refused column's tickStep; both serializers must draw them.
it('draws a per-role title family and a dotted grid in the SVG and in React', () => {
  const fixture = getFixtures('column').find(f => f.id === 'ranked-dense-staggered')!;
  const { size: _size, ...options } = fixture.options as Record<string, unknown>;
  // The fixture patches the theme; a server frame draws it when the entry links the theme checks (core/deferred asFirstFrame).
  const LinkedColumn = createChartComponent('column', undefined, ['theme-rules']);
  const html = renderToStaticMarkup(createElement(LinkedColumn, { data: fixture.data, ...options, size: { width: 960, height: 460 } } as never));
  const geometry = getChart('column')!.layout(fixture.data as never, { ...options, size: { width: 960, height: 460 } } as never);
  const svg = renderSvg(geometry as Geometry, resolveTheme((options as { theme: never }).theme));
  for (const markup of [svg, html]) {
    const doc = new DOMParser().parseFromString(markup, 'text/html');
    expect(doc.querySelector('[data-part="title"]')?.getAttribute('font-family')).toMatch(/^'Inter'/);
    expect(doc.querySelector('[data-part="gridline"]')?.getAttribute('stroke-dasharray')).toBeTruthy();
  }
});
