// @vitest-environment jsdom
/**
 * Dashboard hover: the hover card says a category's date once, the
 * line highlight can keep every series' own colour, and a host can hear a
 * series click without reading the engine's SVG ids.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import '../src/core/charts';
import { interactionRecords } from '../src/core/a11y/records';
import { accessibleDataTable } from '../src/core/a11y/accessibility';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { resolveChartRequest as resolvePublicRequest } from '../src/index';
import { paintColor } from '../src/core/theme';
import { requireGeometry } from '../src/core/sizing';
import { renderSvg } from '../src/core/svg/renderSvg';
import { LineChart } from '../src/react/charts/line';
import { labelCardContent, sharedLabelCardContent, layoutLabelCardContent } from '../src/react/hover/labelCard';
import { categorySiblings, hoverModel, hoverTargets } from '../src/react/hover/engine';
import { highlightScene } from '../src/react/hover/highlight';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const series = ['search', 'social', 'video', 'email', 'display'].map((id, index) =>
  ({ id, label: id[0]!.toUpperCase() + id.slice(1), values: [10 + index * 9, 12 + index * 9, 15 + index * 8, 14 + index * 9] }));
const dates = ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23'];
const categories = (labelled: boolean) => dates.map((date, index) => ({ id: `w${index + 1}`, ...(labelled ? { label: `Week ${index + 1}` } : {}), date }));
const lineSpec = (options: object = {}, labelled = true) =>
  ({ type: 'line', data: { categories: categories(labelled), series }, options: { title: 'Visits', size: { width: 640, height: 360 }, ...options } });

function build(spec: object) {
  const request = resolveChartRequest(spec as Parameters<typeof resolveChartRequest>[0]);
  const geometry = requireGeometry(layoutResolvedRequest(request));
  return { request, geometry };
}

describe('hover card date', () => {
  // A line that has ended must leave the shared card, while an internal gap stays visible as missing.
  it('leaves ended lines out of a shared card and keeps internal gaps', () => {
    const { request, geometry } = build({ type: 'line', data: {
      categories: ['a', 'b', 'c'].map(id => ({ id, label: id.toUpperCase() })),
      series: [
        { id: 'active', label: 'Active', values: [1, 2, 3] },
        { id: 'ended', label: 'Ended', values: [2, null, null] },
        { id: 'gap', label: 'Gap', values: [3, null, 4] },
      ],
    }, options: { size: { width: 640, height: 360 } } });
    const records = interactionRecords({ request, geometry, scope: request.scope, claims: [] });
    const hit = records.find(record => record.target.owner.categoryId === 'b' && record.target.owner.seriesId === 'active')!;
    expect(categorySiblings(records, hit, true, true).map(record => record.seriesLabel)).toEqual(['Gap']);
    expect(categorySiblings(records, hit, true).map(record => record.seriesLabel)).toEqual(['Ended', 'Gap']);
  });
  // A single line's gap opened no card, and a stacked area's zero read as a share: the reader could not tell missing from zero.
  it('opens a card on a gap that says the value is missing, and in a stack that it is drawn as zero', () => {
    const gapCard = (variant: string, values: (number | null)[][]) => {
      const { request, geometry } = build({ type: 'line', data: {
        categories: ['a', 'b', 'c'].map(id => ({ id, label: id.toUpperCase() })),
        series: values.map((row, index) => ({ id: `s${index}`, label: `S${index}`, values: row })),
      }, options: { variant, size: { width: 640, height: 360 } } });
      const model = hoverModel(request, geometry);
      const gap = model.records.find(record => record.target.owner.categoryId === 'b' && record.value.state === 'missing')!;
      const hit = hoverTargets(model, request, { point: gap.anchor as { x: number; y: number } });
      return hit.length > 1 ? sharedLabelCardContent(hit).rows.map(row => row.text) : labelCardContent(hit[0]!).rows.map(row => row.text);
    };
    expect(gapCard('line', [[1, null, 3]])).toEqual(['B / S0', 'No observation']);
    const stacked = gapCard('stacked-area', [[1, null, 3], [2, 2, 2]]);
    expect(stacked).toContain('S0. No observation; drawn as 0 in the stack');
    expect(stacked.filter(text => text.includes('unavailable'))).toEqual([]);
  });
  const week1 = (labelled: boolean) => {
    const { request, geometry } = build(lineSpec({}, labelled));
    return interactionRecords({ request, geometry, scope: request.scope, claims: [] }).filter(record => record.target.owner.categoryId === 'w1');
  };

  // The axis names an unlabelled date category as its period; a heading of the raw id and ISO date read as a different category.
  it('a card names an unlabelled date category as the axis does, with its year, and no date row', () => {
    const rows = sharedLabelCardContent(week1(false)).rows.map(row => row.text);
    expect(rows[0]).toBe('2 Mar 2026');
    expect(rows.filter(text => text.startsWith('Date:'))).toEqual([]);
    expect(labelCardContent(week1(false)[0]!).rows.map(row => row.text)).not.toContain('Date: 2026-03-02');
    expect(sharedLabelCardContent(week1(true)).rows[0]!.text).toBe('Week 1');
  });
});

describe("highlightMode 'fade'", () => {
  const lineColours = (options: object) => {
    const { request, geometry } = build(lineSpec(options));
    return new Map(geometry.scene.filter(node => node.part === 'line').map(node =>
      [node.owner.seriesId!, paintColor(request.theme, (node as { stroke: Parameters<typeof paintColor>[1] }).stroke)]));
  };

  it('keeps one colour per series, the highlighted one as drawn without a highlight', () => {
    const plain = lineColours({});
    const grey = lineColours({ highlight: 'video' });
    const fade = lineColours({ highlight: 'video', highlightMode: 'fade' });
    expect(new Set(fade.values()).size).toBe(5);
    expect(fade.get('video')).toBe(plain.get('video'));
    for (const id of ['search', 'social', 'email', 'display']) expect(fade.get(id)).not.toBe(plain.get(id));
    expect(grey.get('video')).not.toBe(plain.get('video'));
  });

  it("'grey' and no mode draw the same SVG", () => {
    const svg = (options: object) => JSON.stringify(build(lineSpec(options)).geometry.scene);
    expect(svg({ highlight: 'video', highlightMode: 'grey' })).toBe(svg({ highlight: 'video' }));
  });
});

describe('onSeriesClick', () => {
  async function mount(props: object) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const { type: _type, ...spec } = lineSpec({ legend: { position: 'bottom' } }) as { type: string; data: never; options: object };
    await act(async () => { root.render(<LineChart data={spec.data} {...spec.options} {...props} />); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    return host;
  }

  it('fires with the series id from the line, the name label and the legend entry', async () => {
    const onSeriesClick = vi.fn();
    const host = await mount({ onSeriesClick });
    const click = (element: Element | undefined) => act(async () => { element!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await click(host.querySelector('[data-id="mark:line:video:0"]')!);
    await click(host.querySelector('[data-id="label:series:video"]')!);
    await click(Array.from(host.querySelectorAll('[data-part="legendLabel"]')).find(element => element.textContent === 'Video'));
    expect(onSeriesClick.mock.calls).toEqual([['video'], ['video'], ['video']]);
    // Only the name and legend labels are keyboard stops; a line adds none.
    expect(host.querySelector('[data-part="line"]')!.getAttribute('tabindex')).toBeNull();
    expect(host.querySelector('[data-part="series"]')!.getAttribute('role')).toBe('button');
  });

  // A shading drawn over an area fill took the click and hover from the fill under it, so
  // onSeriesClick stopped firing there; the overlay and band edges pass the pointer through.
  it('passes the pointer through the shading and band edges over an area fill', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const data = { categories: ['q1', 'q2', 'q3', 'q4'], series: [{ id: 'volume', label: 'Volume', values: [86, 91, 88, 97] }] };
    const annotations = [{ kind: 'band', from: 'q2', to: 'q3', label: 'Era' }, { kind: 'valueLine', id: 'target', value: 90, tolerance: 5 }];
    await act(async () => { root.render(<LineChart data={data as never} title="Volume" variant="area" annotations={annotations as never} onSeriesClick={() => {}} />); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    const decorative = host.querySelectorAll('[data-part="shadingOverFill"], [data-part="bandEdge"]');
    expect(decorative.length).toBeGreaterThan(2);
    for (const element of decorative) expect(element.getAttribute('pointer-events')).toBe('none');
    const { request, geometry } = build({ type: 'line', data, annotations, options: { title: 'Volume', variant: 'area' } });
    const svg = renderSvg(geometry, request.theme);
    expect(svg.match(/data-part="(shadingOverFill|bandEdge)"[^>]*pointer-events="none"/g)).toHaveLength(decorative.length);
  });

  it('adds no interaction attributes without the prop', async () => {
    const host = await mount({});
    expect(host.querySelector('[role="button"], [tabindex], [style*="cursor"]')).toBeNull();
  });
});

// A German hover card must translate its own omitted-row message and keep authored rows intact.
it('localizes the hover row limit message', () => {
  const { request, geometry } = build(lineSpec());
  const record = interactionRecords({ request, geometry, scope: request.scope, claims: [] })[0]!;
  const rows = Array.from({ length: 10 }, (_, i) => ({ kind: 'value' as const, text: `Authored ${i}: 1,234.5`, series: true }));
  const card = layoutLabelCardContent({ record, theme: request.theme, locale: 'de',
    canvas: { x: 0, y: 0, w: 640, h: 500 }, occupied: [] }, { rows, accessibleText: 'Authored full reading' });
  expect(card.rows.at(-1)?.text).toBe('… 2 weitere Zeilen');
  expect(card.rows[0]?.text).toBe('Authored 0: 1,234.5');
});

// A value line had no card: a reader could not read the value a rounded or hidden label stands for, nor what a mean measures.
it('opens a value line card from its line and its label, and keeps it out of the data table', () => {
  const { request, geometry } = build({ type: 'line', data: { categories: ['2025-01', '2025-02', '2025-03', '2025-04'],
    series: [{ id: 'sales', label: 'Sales', values: [1, 2, 2, 3] }] }, annotations: [{ kind: 'valueLine', seriesId: 'sales', from: '2025-01', to: '2025-03' }],
  options: { size: { width: 640, height: 360 } } });
  const model = hoverModel(request, geometry);
  const nodes = geometry.scene.filter(node => node.owner.annotationId !== undefined).map(node => node.id);
  expect(nodes.length).toBe(2);
  for (const nodeId of nodes) {
    expect(labelCardContent(hoverTargets(model, request, { nodeId })[0]!).rows.map(row => row.text))
      .toEqual(['Average 1.7', 'Value: 1.7', 'Measure: Mean of Sales, Jan 2025 to Mar 2025']);
  }
  // The value reads in the line's own format and scale, never in the chart's unit ("$50" for a 50% line).
  const percent = build({ type: 'line', data: { categories: ['a', 'b'], series: [{ id: 'x', values: [1, 2] }, { id: 'y', values: [3, 2] }] },
    annotations: [{ kind: 'valueLine', value: 50, label: 'Half', format: '0%' }], options: { variant: 'stacked100-area', unit: '$', size: { width: 640, height: 360 } } });
  const half = hoverModel(percent.request, percent.geometry);
  const line = half.records.find(record => record.target.owner.annotationId !== undefined)!;
  expect(labelCardContent(line).rows.map(row => row.text)).toEqual([line.label, 'Value: 50%']);
  // A tolerance band's bounds read as the band prints them, unit included.
  const banded = build({ type: 'line', data: { categories: ['a', 'b'], series: [{ id: 'x', values: [18, 22] }] },
    annotations: [{ kind: 'valueLine', value: 20, label: 'Goal', tolerance: 5 }], options: { format: '1.0%', size: { width: 640, height: 360 } } });
  const goal = hoverModel(banded.request, banded.geometry).records.find(record => record.target.owner.annotationId !== undefined)!;
  expect(labelCardContent(goal).rows.map(row => row.text).at(-1)).toBe('Tolerance: 15.0% to 25.0%');
  expect(accessibleDataTable(model.records).rows.map(row => row.header)).toEqual(['Jan 2025', 'Feb 2025', 'Mar 2025', 'Apr 2025']);
});

// Small multiples compare one series across panels: hovering it in one panel faded the same series in the others.
it('keeps the pointed series at full ink in the other grid panels', () => {
  const panel = (id: string, offset: number) => ({ id, type: 'column', data: { categories: ['q1', 'q2'],
    series: [{ id: 'north', label: 'North', values: [1 + offset, 2] }, { id: 'south', label: 'South', values: [3, 4 + offset] }] } });
  const { request, geometry } = build({ type: 'grid', data: { panels: [panel('a', 0), panel('b', 1)] }, options: { size: { width: 800, height: 400 } } });
  const records = interactionRecords({ request, geometry, scope: request.scope, claims: [] });
  const at = (panelId: string, seriesId: string, categoryId = 'q1') => records.find(record => record.target.panel === panelId
    && record.target.owner.seriesId === seriesId && record.target.owner.categoryId === categoryId)!;
  const scene = highlightScene(geometry.scene, records, [at('a', 'north'), at('a', 'south')], request.theme);
  const opacity = (record: ReturnType<typeof at>) => scene.find(node => node.id === record.nodeIds[0])!.opacity;
  expect(opacity(at('b', 'north'))).toBeUndefined();
  expect(opacity(at('b', 'north', 'q2'))).toBeUndefined();
  expect(opacity(at('b', 'south'))).toBeLessThan(1);
  expect(scene.filter(node => node.part === 'interaction-outline' && node.id.includes(at('b', 'north').nodeIds[0]!))).toEqual([]);
  // A value inside the twin keeps the ink of its own full-strength bar, not of the faded bar with the same ids in panel a.
  const stacked = build({ type: 'grid', data: { panels: [panel('a', 0), panel('b', 1)].map(entry => ({ ...entry, options: { variant: 'stacked' } })) },
    options: { size: { width: 800, height: 400 } } });
  const stackedRecords = interactionRecords({ request: stacked.request, geometry: stacked.geometry, scope: stacked.request.scope, claims: [] });
  const pointed = stackedRecords.filter(record => record.target.panel === 'a' && record.target.owner.categoryId === 'q1');
  const lit = highlightScene(stacked.geometry.scene, stackedRecords, pointed, stacked.request.theme);
  const inks = (nodes: readonly typeof lit[number][]) => nodes.filter(node => node.t === 'text' && node.origin?.panels.includes('b')
    && node.owner.seriesId === 'north' && 'token' in node.ink && node.ink.theme?.kind === 'contrast-ink').map(node => JSON.stringify((node as { ink: unknown }).ink));
  expect(inks(stacked.geometry.scene).length).toBeGreaterThan(0);
  expect(inks(lit)).toEqual(inks(stacked.geometry.scene));
});

// A German band printed "85 to 95" on the chart while its card said "85 bis 95": two languages in one exhibit.
it('prints a tolerance band in the chart language, as its card reads it', () => {
  const { request, geometry } = build({ type: 'line', data: { categories: ['a', 'b'], series: [{ id: 'x', values: [18, 22] }] },
    annotations: [{ kind: 'valueLine', value: 20, label: 'Goal', tolerance: 5 }], options: { locale: { language: 'de-DE' }, size: { width: 640, height: 360 } } });
  const goal = hoverModel(request, geometry).records.find(record => record.target.owner.annotationId !== undefined)!;
  const band = geometry.scene.find(node => node.t === 'text' && node.id.includes('tolerance')) as { text?: string; lines?: string[] } | undefined;
  expect(labelCardContent(goal).rows.map(row => row.text).at(-1)).toBe('Toleranz: 15 bis 25');
  expect(band?.lines?.join(' ') ?? band?.text).toBe('15 bis 25');
});

// A caller's tolerance wording must reach the drawn band and its hover card on a waterfall too.
it('uses a German tolerance string override on the waterfall band and card', () => {
  const request = resolvePublicRequest({ type: 'waterfall', data: { items: [
    { id: 'start', type: 'total', label: 'Start', value: 18 },
    { id: 'gain', type: 'delta', label: 'Gain', value: 4 },
    { id: 'end', type: 'total', label: 'End', value: 22 },
  ] }, annotations: [{ kind: 'valueLine', value: 20, label: 'Goal', tolerance: 5 }],
  options: { locale: { language: 'de-DE' }, strings: { valueLineRange: 'von {v1} bis {v2}' }, size: { width: 640, height: 360 } } });
  const geometry = requireGeometry(layoutResolvedRequest(request));
  const goal = hoverModel(request, geometry).records.find(record => record.target.owner.annotationId !== undefined)!;
  const band = geometry.scene.find(node => node.t === 'text' && node.id.includes('tolerance'));
  expect(band?.t === 'text' && band.lines.join(' ')).toBe('von 15 bis 25');
  expect(labelCardContent(goal).rows.map(row => row.text).at(-1)).toBe('Toleranz: von 15 bis 25');
  expect(renderSvg(geometry, request.theme)).toBe(renderSvg(requireGeometry(layoutResolvedRequest(request)), request.theme));
});

// Above 5,000 points the dots draw as one path per colour, and hovering a dot left the other group at full ink.
it('dims the dense paths of the other groups when a dot of a dense scatter is hovered', () => {
  const points = Array.from({ length: 5002 }, (_, i) => ({ id: `p${i}`, x: i % 97, y: (i * 7) % 89, group: i % 2 ? 'Trial' : 'Paid' }));
  const { request, geometry } = build({ type: 'scatter', data: { points }, options: { size: { width: 640, height: 360 } } });
  const records = interactionRecords({ request, geometry, scope: request.scope, claims: [] });
  const paid = records.find(record => record.target.owner.pointId === 'p0')!;
  const trial = records.find(record => record.target.owner.pointId === 'p1')!;
  expect(paid.nodeIds[0]).not.toBe(trial.nodeIds[0]);
  const scene = highlightScene(geometry.scene, records, [paid], request.theme);
  expect(scene.find(node => node.id === trial.nodeIds[0])!.opacity).toBeLessThan(1);
  expect(scene.find(node => node.id === paid.nodeIds[0])!.opacity).toBeUndefined();
});

// A column category with no value in any series had no record, so its empty slot opened no card.
it('opens a No observation card on an empty column slot', () => {
  const { request, geometry } = build({ type: 'column', data: { categories: ['a', 'b', 'c'].map(id => ({ id, label: id.toUpperCase() })),
    series: [{ id: 's', label: 'S', values: [1, null, 3] }] }, options: { size: { width: 640, height: 360 } } });
  const model = hoverModel(request, geometry);
  const tick = geometry.axes.find(axis => axis.axis === 'x')!.ticks.find(entry => entry.at === 'b')!;
  const hit = hoverTargets(model, request, { point: { x: tick.pos, y: 300 } });
  expect(labelCardContent(hit[0]!).rows.map(row => row.text)).toEqual(['B / S', 'No observation']);
});

// A host's extra facts must reach the card in their declared label, format and order, with no key dropped.
it('lists cell details in the card through detailFields, then the undeclared keys', () => {
  const { request, geometry } = build({ type: 'column', data: {
    categories: [{ id: 'q1', label: 'Q1' }, { id: 'q2', label: 'Q2' }],
    series: [{ id: 'rev', label: 'Revenue', values: [{ number: 42, details: { owner: 'North team', deals: 1234, winRate: 31.5, date: null } }, 38] }],
  }, options: { unit: 'EUR m', size: { width: 640, height: 360 },
    detailFields: [{ key: 'deals', label: 'Deals', format: '1,234' }, { key: 'winRate', label: 'Win rate', format: '0.0%' }] } });
  const records = interactionRecords({ request, geometry, scope: request.scope, claims: [] });
  const rows = (categoryId: string) => labelCardContent(records.find(record => record.target.owner.categoryId === categoryId)!).rows
    .filter(row => row.kind === 'field').map(row => row.text);
  expect(rows('q1')).toEqual(['Deals: 1,234', 'Win rate: 31.5%', 'owner: North team', 'date: No observation']);
  expect(rows('q2')).toEqual([]);
});
