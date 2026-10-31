// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToPipeableStream, renderToStaticMarkup } from 'react-dom/server';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest';
import { PROBE_STYLE, useContainerSize, type ContainerSizeOptions } from '../src/react/useContainerSize';
import { canDraw, measure } from '../src/index';
import { measure as measureRequest } from '../src/core/request';
import type { Geometry, RefusedLayout } from '../src/core/types/scene';
import type { RenderTarget } from '../src/core/types/options';
import { LineChart } from '../src/react/charts/line';
import { ColumnChart } from '../src/react/charts/column';
import { BarChart } from '../src/react/charts/bar';
import { DiagramChart } from '../src/react/charts/diagram';
import { TableChart } from '../src/react/charts/table';
import { DimSwitchChart } from '../src/react/charts/dimswitch';
import { BarTableChart } from '../src/react/charts/bartable';
import { LikertChart } from '../src/react/charts/likert';
import { ChoroplethChart } from '../src/react/charts/choropleth';
import '../src/core/geo/packs/all';
import { SparklineChart } from '../src/react/charts/sparkline';
import { CohortChart } from '../src/react/charts/cohort';
import { ScatterChart } from '../src/react/charts/scatter';
import { GridChart } from '../src/react/charts/grid';
import { withStory } from '../src/react/story';
import { BoardplotTheme } from '../src/react/BoardplotTheme';
import { prepareChart } from '../src/react/prepare';
import { getFixtures } from '../src/fixtures';
import { getChart } from '../src/core/registry';
import { resolveChartRequest } from '../src/index';
import { layoutResolvedRequest } from '../src/core/request';
import { requireGeometry } from '../src/core/sizing';
import { layoutContainerRequest } from '../src/react/containerLayout';
import { webcrypto } from 'node:crypto';
import { defaultMeasurer } from '../src/core/text';
import { Buffer } from 'node:buffer';
import { exportSvg, useExport, type UseExport } from '../src/react/export';

const StoryScatter = withStory(ScatterChart);

const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let callbacks: ResizeObserverCallback[];
let observers: Observer[];
let frames: Map<number, FrameRequestCallback>;
let frameId: number;
let renders: number;

class Observer implements ResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(callback: ResizeObserverCallback) {
    callbacks.push(callback);
    observers.push(this);
  }
}

function Probe(props: ContainerSizeOptions & { target?: RenderTarget; hostlessHeight?: (width: number) => number }) {
  const { wrapperRef, wrapperStyle, probed, size, ready } = useContainerSize(props);
  renders++;
  return <div ref={wrapperRef} style={wrapperStyle}>{probed && <div data-bp-probe="" style={PROBE_STYLE} />}{`${size.width}x${size.height}:${ready}`}</div>;
}

/** The wrapper reports the width the host gives, the probe the height (0: the host has none). */
function resize(width: number, height: number, target?: Element) {
  const wrapper = host.firstElementChild ?? host;
  const probe = wrapper.querySelector('[data-bp-probe]');
  const entry = (element: Element, box: DOMRectReadOnly) => ({ target: element, contentRect: box, contentBoxSize: [], borderBoxSize: [], devicePixelContentBoxSize: [] });
  const entries = target ? [entry(target, new DOMRectReadOnly(0, 0, width, height))]
    : [entry(wrapper, new DOMRectReadOnly(0, 0, width, 0)), ...(probe ? [entry(probe, new DOMRectReadOnly(0, 0, 0, height))] : [])];
  const index = observers.map(observer => observer.observe.mock.calls.some(([element]) => element === wrapper)).lastIndexOf(true);
  callbacks.at(index)!(entries, observers.at(index)!);
}

/** A size refusal shows once the container's size holds still (SETTLE_MS in createChartComponent). */
async function settle() {
  await act(() => new Promise(resolve => setTimeout(resolve, 150)));
}

/** Finish the lazy reader card before sending the server HTML to a browser. */
function serverMarkup(chart: ReactElement): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    const output = new Writable({ write(chunk, _encoding, next) { body += chunk; next(); } });
    output.on('finish', () => resolve(body));
    const stream = renderToPipeableStream(chart, {
      onAllReady() { stream.pipe(output); },
      onError: reject,
    });
  });
}

function flush() {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(0));
  });
}

it.each([148, undefined])('reports a renderable stacked100-area floor with height %s', height => {
  const data = {
    categories: ['2019', '2021', '2023', '2025'].map(id => ({ id, label: id })),
    series: [
      { id: 'a', label: 'A', values: [31, 58, 96, 148] },
      { id: 'b', label: 'B', values: [64, 71, 74, 70] },
      { id: 'c', label: 'C', values: [58, 49, 38, 27] },
    ],
  };
  const options = {
    variant: 'stacked100-area' as const, seriesLabels: 'key' as const, valueLabels: 'all' as const,
    title: false as const, unit: '%', legend: 'top' as const,
    canvas: { margin: { top: 0, right: 0, bottom: 0, left: 0 } },
    notes: { pointer: false }, size: { width: 263, ...(height === undefined ? {} : { height }) },
  };
  const input = { type: 'line', data, options };
  const expected = height === undefined ? measure(input).refused! : undefined;
  const minimum = expected?.warnings[0]?.expected?.minimum as { width: number; height: number } | undefined
    ?? canDraw(input).minimum!;
  let actual: RefusedLayout | undefined;
  act(() => root.render(<LineChart data={data} {...options} onRefused={result => { actual = result; }} />));
  expect(host.querySelector('[data-bp-refused]')?.getAttribute('data-bp-refused')).toBe('size-below-floor');
  expect(actual?.size.width).toBe(options.size.width);
  expect(actual?.warnings[0]).toMatchObject({ code: 'size-below-floor', expected: { minimum },
    fix: [{ op: 'replace', path: '/options/size', value: minimum }] });
  if (expected) {
    expect(actual?.warnings).toEqual(expected.warnings);
    expect(actual?.sizing).toEqual(expected.sizing);
  }
  act(() => root.render(<LineChart data={data} {...options} size={minimum} />));
  expect(host.querySelector('[data-bp-refused]')).toBeNull();
  expect(host.querySelector('svg')).not.toBeNull();
});

it('names the measured refusal for content fit despite its fixed fallback seed', async () => {
  const data = { categories: [{ id: 'a', label: 'A' }], series: [{ id: 's', values: [1] }] };
  const expected = measure({ type: 'column', data, options: { size: { width: 279 } } }).refused!;
  let actual: RefusedLayout | undefined;
  act(() => root.render(<ColumnChart data={data} size="container" fit="content" fallbackSize={{ width: 279, height: 180 }}
    onRefused={result => { actual = result; }} />));
  await settle();
  expect(actual?.sizing.minWidth).toBe(expected.sizing.minWidth);
  const minimum = actual?.warnings[0]?.expected?.minimum as { width: number; height: number };
  expect(minimum).toEqual(expected.warnings[0]?.expected?.minimum);
  act(() => root.render(<ColumnChart data={data} size={minimum} />));
  expect(host.querySelector('[data-bp-refused]')).toBeNull();
  expect(host.querySelector('svg')).not.toBeNull();
});

// A phone container drew a refusal for a two-panel bartable that measure draws compact at the same width.
it('draws a content-fit container at a width measure draws, at the height compact takes', async () => {
  const fixture = getFixtures('bartable').find(candidate => candidate.id === 'cascade-two-periods')!;
  const measured = measure({ type: 'bartable', data: fixture.data, options: { ...fixture.options, size: { width: 358 } } });
  expect(measured.mode).toBe('compact');
  let refused: RefusedLayout | undefined;
  act(() => root.render(<BarTableChart data={fixture.data} {...fixture.options} size="container" onRefused={result => { refused = result; }} />));
  resize(358, 0);
  flush();
  await settle();
  expect(refused).toBeUndefined();
  expect(host.querySelector('svg[data-bp-chart]')?.getAttribute('viewBox')?.split(' ')[2]).toBe('358');
});

// A content-fit line with no height drew at its 270 px floor and warned to leave out a height nobody set.
it('gives a filling type under content fit the automatic height that measure gives its width', () => {
  const months = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}-01`);
  const data = { categories: months, series: ['North', 'South', 'West'].map((id, s) => ({ id, values: months.map((_, m) => 120 + m * 14 + s * 56) })) };
  const options = { title: 'Monthly revenue', subtitle: { measure: 'Revenue' }, unit: 'USD', format: '$0k', target: 'dashboard' as RenderTarget };
  const expected = measure({ type: 'line', data, options: { ...options, size: { width: 325 } } });
  const drawn = layoutContainerRequest(resolveChartRequest({ type: 'line', data, options: { ...options, size: { width: 325, height: 405 } } }), 'content');
  expect(drawn.size).toEqual(expected.geometry!.size);
  expect(drawn.warnings.map(warning => warning.code)).not.toContain('plot-under-floor');
});

// A content-fit container seeded its height and shrank to its natural width: in a 358 px box a pie drew 327 px wide
// and a likert 10 px shorter than `boardplot render --width 358`, so the live chart jumped from its static image.
it.each([['pie', 'streaming-genre-share'], ['likert', 'employee-engagement-5pt']])('lays out a content-fit %s as the CLI does at the box width', (type, id) => {
  const { size: _size, ...options } = getFixtures(type).find(candidate => candidate.id === id)!.options as Record<string, unknown>;
  const data = getFixtures(type).find(candidate => candidate.id === id)!.data;
  const expected = measure({ type, data, options: { ...options, size: { width: 358 } } });
  const drawn = layoutContainerRequest(resolveChartRequest({ type, data, options: { ...options, size: { width: 358, height: 320 } } }), 'content');
  expect(drawn.size).toEqual(expected.geometry!.size);
});

// A content-fit likert kept three method notes behind "+3 notes" and printed short forms: 495 px live against
// 632 px for its image. Content fit prints the image's footer, so the SVG and the HTML footer are as tall as the image.
it('prints the static footer under a content-fit chart, at the height of its image', async () => {
  const fixture = getFixtures('likert').find(candidate => candidate.id === 'manager-review-4pt')!;
  const expected = measure({ type: 'likert', data: fixture.data, options: { ...fixture.options, size: { width: 358 } } });
  act(() => root.render(<LikertChart data={fixture.data} {...fixture.options} size="container" fit="content" />));
  resize(358, 0);
  flush();
  await settle();
  const footer = host.querySelector<HTMLElement>('[data-bp-footer]')!;
  expect(footer.querySelector('[data-bp-notes-toggle]')).toBeNull();
  expect(footer.textContent).toContain('Statements are sorted by net score, descending.');
  const svgHeight = Number(host.querySelector('svg[data-bp-chart]')!.getAttribute('viewBox')!.split(' ')[3]);
  const footerHeight = [...footer.children].reduce((sum, child) => {
    const style = (child as HTMLElement).style;
    const lines = child.tagName === 'P' ? child.children.length * parseFloat(style.lineHeight || style.font.split('/')[1]!) : 0;
    return sum + parseFloat(style.marginTop || '0') + lines + parseFloat(style.height || '0');
  }, 0);
  expect(svgHeight + footerHeight).toBeCloseTo(expected.geometry!.size.height, 1);
});

// A dashboard chart ('info') under content fit dropped its "Notes and sources" button: a method note outside notes.show could not be opened.
it('keeps the notes the footer does not print one press away under content fit', async () => {
  const fixture = getFixtures('likert').find(candidate => candidate.id === 'manager-review-4pt')!;
  const { methodNote: _methodNote, ...options } = fixture.options as typeof fixture.options & { methodNote?: boolean };
  const expected = measure({ type: 'likert', data: fixture.data, options: { ...options, target: 'dashboard', size: { width: 358 } } });
  act(() => root.render(<LikertChart data={fixture.data} {...options} target="dashboard" size="container" fit="content" />));
  resize(358, 0);
  flush();
  await settle();
  const footer = host.querySelector<HTMLElement>('[data-bp-footer]')!;
  const button = footer.querySelector<HTMLButtonElement>('[data-bp-notes-toggle]')!;
  expect(button.textContent).toMatch(/^Notes and sources \(\d+\)$/);
  const panel = footer.querySelector<HTMLElement>(`#${button.getAttribute('aria-controls')}`)!;
  expect(panel.hidden).toBe(true);
  act(() => button.click());
  expect(panel.hidden).toBe(false);
  expect(panel.querySelector('[data-kind="method"]')?.textContent).toContain("Shares are of each statement's own base");
  const svgHeight = Number(host.querySelector('svg[data-bp-chart]')!.getAttribute('viewBox')!.split(' ')[3]);
  act(() => button.click());
  const footerHeight = [...footer.children].reduce((sum, child) => {
    const style = (child as HTMLElement).style;
    const lines = child.tagName === 'P' ? child.children.length * parseFloat(style.lineHeight || style.font.split('/')[1]!) : 0;
    return sum + parseFloat(style.marginTop || '0') + lines + parseFloat(style.height || '0');
  }, 0);
  expect(svgHeight + footerHeight).toBeCloseTo(expected.geometry!.size.height, 1);
});

// A host appendix (`renderNotes`) got the notes twice under content fit: the footer printed them as well.
it('leaves the notes to renderNotes under content fit and keeps the source line', async () => {
  const fixture = getFixtures('likert').find(candidate => candidate.id === 'manager-review-4pt')!;
  act(() => root.render(<LikertChart data={fixture.data} {...fixture.options} size="container" fit="content" renderNotes={notes => <ol data-host-notes="">{notes.length}</ol>} />));
  resize(358, 0);
  flush();
  await settle();
  const footer = host.querySelector<HTMLElement>('[data-bp-footer]')!;
  expect(footer.textContent).not.toContain('Statements are sorted by net score');
  expect(footer.querySelector('[data-part="source"]')?.textContent).toContain('Upward feedback');
  expect(footer.querySelector('[data-host-notes]')).not.toBeNull();
});

// Under content fit a grid panel's note and source move into the shared footer; with `renderNotes` they were dropped.
it('keeps a grid panel\'s footer lines beside renderNotes under content fit', async () => {
  const fixture = getFixtures('likert').find(candidate => candidate.id === 'manager-review-4pt')!;
  const panel = { id: 'team', type: 'likert', data: fixture.data, options: { ...fixture.options, source: 'Team pulse survey', footnotes: ['Team leads answered twice.'] } };
  act(() => root.render(<GridChart data={{ panels: [panel] } as never} title="Feedback by statement" source="Group survey" size="container" fit="content" renderNotes={notes => <ol data-host-notes="">{notes.length}</ol>} />));
  resize(760, 0);
  flush();
  await settle();
  const footer = host.querySelector<HTMLElement>('[data-bp-footer]')!;
  expect(footer.textContent).toContain('Team pulse survey');
  expect(footer.textContent).toContain('Team leads answered twice.');
});

// A map credit whose link wrapped onto two footer lines lost the link under content fit.
it('keeps a wrapped credit link a link on both lines', async () => {
  const fixture = getFixtures('choropleth').find(candidate => candidate.id === 'world-inflation')!;
  const { size: _size, ...options } = fixture.options as Record<string, unknown>;
  act(() => root.render(<ChoroplethChart data={fixture.data} {...options} strings={{ mapCredit: 'This is the required map attribution for' }} size="container" fit="content" />));
  resize(280, 0);
  flush();
  await settle();
  const credit = host.querySelector<HTMLElement>('[data-bp-footer] [data-part="credit"]')!;
  expect(credit.children.length).toBeGreaterThan(1);
  expect([...credit.querySelectorAll('a')].map(link => link.textContent).join(' ')).toContain('Natural Earth');
});

// A content-fit container drew a 520 px sparkline exhibit at its 176 px spark width, its title one word a line.
it('keeps a framed sparkline at the content-fit container width', async () => {
  const fixture = getFixtures('sparkline').find(candidate => candidate.id === 'orders-nine-months')!;
  act(() => root.render(<SparklineChart data={fixture.data} {...fixture.options} size="container" fit="content" />));
  resize(358, 0);
  flush();
  await settle();
  expect(host.querySelector('svg[data-bp-chart]')?.getAttribute('viewBox')?.split(' ')[2]).toBe('358');
});

it('uses the report floor for an open-height fill container when target is omitted', async () => {
  const data = { categories: [{ id: 'a', label: 'A' }], series: [{ id: 's', values: [1] }] };
  const expected = measure({ type: 'column', data, options: { size: { width: 279 } } }).refused!;
  for (const target of [undefined, 'report'] as const) {
    let actual: RefusedLayout | undefined;
    act(() => root.render(<ColumnChart data={data} target={target} size="container" fit="fill"
      fallbackSize={{ width: 279, height: 180 }} onRefused={result => { actual = result; }} />));
    resize(279, 0);
    flush();
    await settle();
    expect(host.querySelector('[data-bp-refused]')).not.toBeNull();
    expect(actual?.warnings).toEqual(expected.warnings);
    expect(actual?.sizing).toEqual(expected.sizing);
    const minimum = actual?.warnings[0]?.expected?.minimum as { width: number; height: number };
    // The column falls back to compact at its 280 px floor and does not start at 16:9 there.
    expect(minimum).toEqual({ width: 280, height: 270 });
    act(() => root.render(<ColumnChart data={data} target={target} size={minimum} />));
    expect(host.querySelector('[data-bp-refused]')).toBeNull();
    expect(host.querySelector('svg')).not.toBeNull();
  }
});

// The exporter link: an export lays out what the chart drew, not its props at a fallback size.
function stubDigest() {
  // jsdom has no SubtleCrypto for the receipt hashes.
  if (!globalThis.crypto?.subtle) vi.stubGlobal('crypto', { subtle: { digest: (algorithm: string, input: ArrayBuffer) =>
    webcrypto.subtle.digest(algorithm, Buffer.from(new Uint8Array(input))) } });
}
const exportedWidth = (result: Awaited<ReturnType<UseExport['svg']>>) => Number(/viewBox="0 0 ([\d.]+)/.exec((result.ok && result.artifact.text) || '')?.[1]);
const labelColumn = { id: 'label', kind: 'rowLabel' as const, label: 'Item' };
const valueColumn = { id: 'v', kind: 'value' as const, label: 'Value' };
const wideTable = { columns: [labelColumn, ...Array.from({ length: 10 }, (_, index) => ({ id: `c${index}`, kind: 'value' as const, label: `Column ${index}` }))],
  rows: [{ id: 'w', label: 'Row', cells: Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`c${index}`, 1000 * index])) }] };

/** Mounts one chart with its own handle and returns the handle once the chart drew. */
async function exporterOf(chart: (exporter: UseExport) => ReactElement): Promise<UseExport> {
  stubDigest();
  let handle: UseExport | undefined;
  function Card() {
    handle = useExport();
    return chart(handle);
  }
  act(() => root.render(<Card />));
  await settle();
  return handle!;
}

// Export laid a container chart out at its fallback size, not at the size the reader saw.
it('exports a container chart at the size drawn on screen', async () => {
  const data = { categories: ['Q1', 'Q2', 'Q3', 'Q4'].map(id => ({ id, label: id })), series: [{ id: 's', label: 'Sales', values: [4, 6, 5, 8] }] };
  stubDigest();
  let handle: UseExport | undefined;
  function Card() {
    handle = useExport();
    return <ColumnChart data={data} title="Sales" size="container" fit="fill" fallbackSize={{ width: 480, height: 270 }} exporter={handle} />;
  }
  act(() => root.render(<Card />));
  resize(640, 320);
  flush();
  await settle();
  expect(host.querySelector('svg')).not.toBeNull();
  const result = await handle!.svg();
  expect(result.ok ? result.artifact.text : result.message).toContain('viewBox="0 0 640 320"');
});

// A parent the reader folded must not print its child.
it('exports a table with the rows the reader folded', async () => {
  const table = { columns: [labelColumn, valueColumn],
    rows: [{ id: 'parent', label: 'Parent', cells: { v: 1 } }, { id: 'child', label: 'Hidden child', parentId: 'parent', cells: { v: 2 } }] };
  const handle = await exporterOf(exporter => <TableChart data={table} size={{ width: 400 }} collapsed={['parent']} onCollapsedChange={() => {}} exporter={exporter} />);
  const folded = await handle.svg();
  expect(folded.ok && folded.artifact.text).toContain('Parent');
  expect(folded.ok && folded.artifact.text).not.toContain('Hidden child');
});

// A generated Others row starts folded even at depth 'all'; the reader opened it, so the export keeps it open.
it('exports an open generated Others row open', async () => {
  const ranked = { columns: [labelColumn, valueColumn], rows: [5, 3, 2].map((v, index) => ({ id: `r${index}`, label: `Region ${index}`, cells: { v } })) };
  const handle = await exporterOf(exporter => <TableChart data={ranked} size={{ width: 400 }} topN={{ n: 1 }} expansion={{ expanded: ['others'] }} exporter={exporter} />);
  expect(host.textContent).toContain('Region 2');
  const others = await handle.svg();
  expect(others.ok && others.artifact.text).toContain('Region 2');
});

// A fixed height scrolls rows on screen; the export takes the height its rows need, not a refusal.
it('exports a table that scrolls rows at the height its rows need', async () => {
  const tall = { columns: [labelColumn, valueColumn], rows: Array.from({ length: 30 }, (_, index) => ({ id: `t${index}`, label: `Row ${index}`, cells: { v: index } })) };
  const handle = await exporterOf(exporter => <TableChart data={tall} size={{ width: 600, height: 300 }} exporter={exporter} />);
  const grown = await handle.svg();
  expect(grown.ok ? grown.artifact.text : grown.message).toContain('Row 29');
});

// Ten columns scroll sideways in a 400 px box; the export takes the width they scroll at, not the static minimum.
it('exports a table that scrolls sideways at the width it scrolls at', async () => {
  let scrollsAt = 0;
  const handle = await exporterOf(exporter => <TableChart data={wideTable} size={{ width: 400 }} onContentWidth={width => { scrollsAt = width; }} exporter={exporter} />);
  const widened = await handle.svg();
  expect(widened.ok ? '' : widened.message).toBe('');
  expect(scrollsAt).toBeGreaterThan(400);
  expect(exportedWidth(widened)).toBe(scrollsAt);
});

// A DimSwitch draws a compiled table; its exported document must be its own spec, which Boardplot opens again.
it('exports a DimSwitch whose document opens again', async () => {
  const fixture = getFixtures('dimswitch').find(item => item.id === 'by-measure')!;
  const handle = await exporterOf(exporter => <DimSwitchChart {...fixture.options as object} data={fixture.data as never} size={{ width: 720 }} exporter={exporter} />);
  const result = await handle.svg();
  expect(result.ok ? '' : result.message).toBe('');
  const document = result.ok ? result.document as { charts: { type: string; data: unknown; options: object }[] } : undefined;
  expect(document?.charts[0]!.type).toBe('dimswitch');
  const again = await exportSvg({ spec: document!.charts[0] });
  expect(again.ok ? '' : again.message).toBe('');
});

// A theme switch repaints the table but keeps its layout request: the export must take the theme on screen.
it('exports a table in the theme it shows after a theme switch', async () => {
  stubDigest();
  const data = { columns: [labelColumn, valueColumn], rows: [{ id: 'a', label: 'Alpha', cells: { v: 1 } }] };
  let handle: UseExport | undefined;
  function Card({ theme }: { theme: 'standard' | 'standard-dark' }) {
    handle = useExport();
    return <BoardplotTheme theme={theme}><TableChart data={data} size={{ width: 400 }} exporter={handle} /></BoardplotTheme>;
  }
  act(() => root.render(<Card theme="standard" />));
  await settle();
  const light = await handle!.svg();
  act(() => root.render(<Card theme="standard-dark" />));
  await settle();
  const dark = await handle!.svg();
  expect(light.ok && dark.ok).toBe(true);
  expect(dark.ok && light.ok && dark.artifact.text).not.toBe(light.ok && light.artifact.text);
});

// A cohort too wide for its box scrolls on screen; the export takes the scroll width, not a refusal.
// Since the compact cohort form this fixture fits 400 px, so the box is a phone-card 240 px, where it still scrolls.
it('exports a cohort that scrolls at its scroll width', async () => {
  const cohort = getFixtures('cohort').find(f => f.id === 'retention-pure-exhibit')!;
  const { size: _size, ...cohortOptions } = cohort.options as Record<string, unknown>;
  const handle = await exporterOf(exporter => <CohortChart {...cohortOptions as object} data={cohort.data as never} size={{ width: 240 }} exporter={exporter} />);
  expect(host.querySelector('.bp-scroll')).not.toBeNull();
  const scrollsAt = Number(host.querySelector('svg')!.getAttribute('viewBox')!.split(' ')[2]);
  expect(scrollsAt).toBeGreaterThan(240);
  const scrolled = await handle.svg();
  expect(scrolled.ok ? '' : scrolled.message).toBe('');
  expect(exportedWidth(scrolled)).toBe(scrollsAt);
});

// A table refused on screen hands over no snapshot: the handle exports its own request, which refuses as before.
it('hands the exporter no snapshot from a chart refused on screen', async () => {
  stubDigest();
  const request = { type: 'table', data: wideTable, options: { size: { width: 400, height: 40 } } };
  let handle: UseExport | undefined;
  function Card() {
    handle = useExport({ request });
    return <TableChart data={wideTable} size={{ width: 400, height: 40 }} exporter={handle} />;
  }
  act(() => root.render(<Card />));
  await settle();
  const refused = await handle!.svg();
  expect(refused.ok ? 'ok' : refused.code).toBe('refused');
});

// A 200 mm chart whose printed notes need more height exports at its drawn width in px, not at 200 px.
it('exports a chart sized in mm at its drawn width when its notes need more height', async () => {
  const data = { categories: ['Q1', 'Q2', 'Q3', 'Q4'].map(id => ({ id })), series: [{ id: 's', label: 'Sales', values: [4, 6, 5, 8] }] };
  const footnotes = Array.from({ length: 15 }, (_, index) => `Note ${index + 1} on the sales figures.`);
  const handle = await exporterOf(exporter => <ColumnChart data={data} title="Sales" footnotes={footnotes} size={{ width: 200, height: 80, unit: 'mm' }} exporter={exporter} />);
  const drawnWidth = Number(host.querySelector('svg')!.getAttribute('viewBox')!.split(' ')[2]);
  expect(drawnWidth).toBeGreaterThan(700);
  const result = await handle.svg();
  expect(result.ok ? '' : result.message).toBe('');
  expect(exportedWidth(result)).toBeCloseTo(drawnWidth, 1);
});

// A table measured with the host's font metrics exports with the same metrics, so its widths match the screen.
it('exports a table with the font metrics it drew with', async () => {
  let calls = 0;
  const metrics = Object.assign((...args: Parameters<typeof defaultMeasurer>) => { calls += 1; return defaultMeasurer(...args); }, defaultMeasurer);
  const data = { columns: [labelColumn, valueColumn], rows: [{ id: 'a', label: 'Alpha', cells: { v: 1 } }] };
  const handle = await exporterOf(exporter => <TableChart data={data} size={{ width: 400 }} fontMetrics={metrics} exporter={exporter} />);
  calls = 0;
  const result = await handle.svg();
  expect(result.ok ? '' : result.message).toBe('');
  expect(calls).toBeGreaterThan(0);
});

// After the reader pressed Next, the export must draw that step, not the authored first step.
it('exports the story step the reader moved to', async () => {
  const fixture = getFixtures('scatter').find(item => item.id === 'story-use-case-matrix')!;
  const steps = (fixture.options as { story: { steps: { id: string; title: string }[] } }).story.steps;
  const handle = await exporterOf(exporter => <StoryScatter data={fixture.data as never} {...fixture.options as object} size={{ width: 900, height: 560 }} exporter={exporter} />);
  act(() => (host.querySelector('[data-bp-story-button=next]') as HTMLButtonElement).click());
  const result = await handle.svg();
  expect(result.ok ? '' : result.message).toBe('');
  const options = (result.ok && (result.document as { charts: { options: { story: { step?: string } } }[] }).charts[0]!.options) || undefined;
  expect(options?.story.step).toBe(steps[1]!.id);
});

// One handle on two charts cannot know which chart to export: every call says so instead of guessing.
it('answers invalid when one handle is the exporter of two charts', async () => {
  stubDigest();
  const data = { categories: ['Q1', 'Q2'].map(id => ({ id })), series: [{ id: 's', label: 'Sales', values: [4, 6] }] };
  let handle: UseExport | undefined;
  function Page() {
    handle = useExport();
    return <><ColumnChart data={data} size={{ width: 480, height: 270 }} exporter={handle} /><ColumnChart data={data} size={{ width: 480, height: 270 }} exporter={handle} /></>;
  }
  act(() => root.render(<Page />));
  await settle();
  const answers = await Promise.all([handle!.svg(), handle!.png(2), handle!.csv(), handle!.copyImage(), handle!.copyData()]);
  expect(answers.map(answer => (answer.ok ? 'ok' : answer.code))).toEqual(['invalid', 'invalid', 'invalid', 'invalid', 'invalid']);
});

// After a Ctrl+wheel zoom, the export must draw the range on screen: its document holds the data the layout drew.
it('exports the range a zoomed chart shows', async () => {
  const x = Array.from({ length: 1100 }, (_, i) => new Date(Date.UTC(2023, 0, 1) + i * 86_400_000).toISOString().slice(0, 10));
  const data = { x, series: [{ id: 's', label: 'Sales', values: x.map(() => 1) }] };
  const handle = await exporterOf(exporter => <LineChart data={data} xAxis={{ type: 'time' }} zoom={{ aggregate: 'sum' }} size={{ width: 700, height: 400 }} exporter={exporter} />);
  act(() => { host.querySelector('[aria-keyshortcuts]')!.dispatchEvent(new WheelEvent('wheel', { deltaY: -800, ctrlKey: true, bubbles: true, cancelable: true })); });
  act(() => { for (const [id, run] of [...frames]) { frames.delete(id); run(0); } });
  await settle();
  const result = await handle.svg();
  expect(result.ok ? '' : result.message).toBe('');
  const spec = (result.ok && (result.document as { charts: { type: string; data: { x: string[] }; options: object }[] }).charts[0]) || undefined;
  expect(spec!.data.x.length).toBeLessThan(1100);
  const again = await exportSvg({ spec: spec! });
  expect(again.ok && result.ok && again.artifact.text === result.artifact.text).toBe(true);
});

// Wheel and key zoom exports must retain the edge segments seen on screen, without adding edge readings.
it('keeps both range edges in the live zoom and its export', async () => {
  const x = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString());
  const data = { x, series: [{ id: 'a', label: 'Probe', values: [10, 14, 12, 18, 17, 22, 19, 21, 18, 24, 20, 23] }] };
  const handle = await exporterOf(exporter => <LineChart data={data} xAxis={{ type: 'time', zone: 'UTC' }} zoom
    viewDomain={{ x: ['2026-01-02T12:00:00Z', '2026-01-10T12:00:00Z'] }} size={{ width: 700, height: 400 }} exporter={exporter} />);
  for (const event of [new WheelEvent('wheel', { deltaY: -20, ctrlKey: true, bubbles: true, cancelable: true }), new KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true })]) {
    act(() => { host.querySelector('[aria-keyshortcuts]')!.dispatchEvent(event); });
    act(() => { for (const [id, run] of [...frames]) { frames.delete(id); run(0); } });
    await settle();
    const result = await handle.svg();
    expect(result.ok ? '' : result.message).toBe('');
    if (!result.ok) throw new Error(result.message);
    const spec = (result.document as { charts: Parameters<typeof resolveChartRequest>[0][] }).charts[0]!;
    const layout = requireGeometry(layoutResolvedRequest(resolveChartRequest(spec)));
    const paths = host.querySelectorAll<SVGPathElement>('path[data-part="line"]');
    expect(paths.length).toBe(1);
    const path = paths[0]!.getAttribute('d')!;
    expect(Number(path.match(/^M([\d.-]+)/)![1])).toBeCloseTo(layout.plot.x, 1);
    expect(Number([...path.matchAll(/L([\d.-]+) /g)].at(-1)![1])).toBeCloseTo(layout.plot.x + layout.plot.w, 1);
    expect(result.artifact.text).toContain(`d="${path}"`);
    const again = await exportSvg({ spec });
    expect(again.ok && again.artifact.text).toBe(result.artifact.text);
    expect((spec.data as typeof data).x).toEqual(x);
  }
  const dates = Array.from({ length: 125 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString());
  const bucketed = await exporterOf(exporter => <LineChart data={{ x: dates, series: [{ id: 'a', values: dates.map(() => 1) }] }}
    xAxis={{ type: 'time', zone: 'UTC' }} zoom={{ aggregate: 'sum', grains: ['month'] }}
    viewDomain={{ x: ['2026-02-20T12:00:00Z', '2026-04-15T12:00:00Z'] }} size={{ width: 700, height: 400 }} exporter={exporter} />);
  const bucketExport = await bucketed.svg();
  if (!bucketExport.ok) throw new Error(bucketExport.message);
  const bucketSpec = (bucketExport.document as { charts: Parameters<typeof resolveChartRequest>[0][] }).charts[0]!;
  // Bucket bounds snap to bucket starts, which are readings: the view draws as main does, and its export draws the same path.
  const bucketPath = host.querySelector('path[data-part="line"]')!.getAttribute('d')!;
  expect(bucketExport.artifact.text).toContain(`d="${bucketPath}"`);
  expect((bucketSpec.data as { x: unknown[] }).x.length).toBeGreaterThan(2);
});

// Hiding the label must not freeze the first value track while the other tracks share container width.
it('shares capped container growth across all visible tracks after the anchor is hidden', () => {
  const data = {
    columns: [{ id: 'label', kind: 'rowLabel' as const, label: 'Item' },
      { id: 'a', kind: 'value' as const, label: 'A' }, { id: 'b', kind: 'value' as const, label: 'B' }],
    columnToggles: [{ id: 'label', label: 'Item', columns: ['label'] }],
    rows: [{ id: 'row', label: 'Row', cells: { a: 100, b: 100 } }],
  };
  const draw = (fit: 'content' | 'fill', maxGrowth?: number | false) => {
    act(() => root.render(<TableChart data={data} size="container" fit={fit} rowExtent="tracks"
      columnVisibility={{ label: false }} maxGrowth={maxGrowth} measureWidths="tables" />));
    resize(800, 0);
    flush();
    return host.querySelector<HTMLElement>('.bp-table-grid')!.style.getPropertyValue('--bp-cols').split(' ').map(Number.parseFloat);
  };
  const natural = draw('content');
  for (const [cap, factor] of [[undefined, 2.5], [1.25, 1.25], [false, undefined]] as const) {
    const tracks = draw('fill', cap);
    expect(tracks[0]).toBe(0);
    for (const index of [1, 2]) {
      expect(tracks[index], `column ${index}, cap ${cap}`).toBeCloseTo(factor === undefined ? 400 : Math.round(natural[index]! * factor * 10) / 10, 1);
    }
  }
});

it('uses the original table and dimswitch floors for open-height fill containers', async () => {
  for (const { type, id, Chart, minimum } of [
    // The first full-width floor needs more height at the narrower frame.
    { type: 'table', id: 'steering-monthly', Chart: TableChart, minimum: { width: 529, height: 311 } },
    // Tight row air draws a fixed 280 px card at 440 px.
    { type: 'dimswitch', id: 'by-measure', Chart: DimSwitchChart, minimum: { width: 280, height: 440 } },
  ]) for (const fillHeight of [false, true]) {
    const fixture = getFixtures(type).find(candidate => candidate.id === id)!;
    const expected = measureRequest({ type, data: fixture.data, options: { ...fixture.options, size: { width: 99 } } }).refused!;
    let actual: RefusedLayout | undefined;
    act(() => root.render(<Chart data={fixture.data} {...fixture.options} target="report" size="container" fit="fill" fillHeight={fillHeight}
      fallbackSize={{ width: 99, height: 80 }} onRefused={result => { actual = result; }} />));
    resize(99, 0);
    flush();
    await settle();
    expect(host.querySelector('[data-bp-refused]')).not.toBeNull();
    expect(actual?.type).toBe(type);
    expect(actual?.warnings).toEqual(expected.warnings);
    expect(actual?.sizing).toEqual(expected.sizing);
    expect(actual?.warnings[0]?.expected?.minimum).toEqual(minimum);
    act(() => root.render(<Chart data={fixture.data} {...fixture.options} target="report" size={minimum} />));
    expect(host.querySelector('[data-bp-refused]')).toBeNull();
    expect(host.querySelector('.bp-table-grid')).not.toBeNull();
  }
});

it.each([
  { type: 'table', id: 'steering-monthly', Chart: TableChart },
  { type: 'dimswitch', id: 'by-measure', Chart: DimSwitchChart },
])('uses the observed fixed-height viewport for $type with fillHeight', async ({ type, id, Chart }) => {
  const fixture = getFixtures(type).find(candidate => candidate.id === id)!;
  host.style.width = '99px';
  host.style.height = '80px';
  let actual: RefusedLayout | undefined;
  act(() => root.render(<Chart data={fixture.data} {...fixture.options} target="report" size="container" fit="fill" fillHeight
    fallbackSize={{ width: 99, height: 80 }} onRefused={result => { actual = result; }} />));
  resize(99, 80);
  flush();
  await settle();
  expect(host.querySelector('[data-bp-refused]')).not.toBeNull();
  expect(actual?.type).toBe(type);
  const measured = (size: { width: number; height: number }) => measureRequest({ type, data: fixture.data,
    target: 'report', options: { ...fixture.options, size } }).refused!;
  expect(actual?.sizing).toEqual(measured({ width: 99, height: 80 }).sizing);
  expect(actual?.warnings).toEqual(measured({ width: 99, height: 80 }).warnings);
  // A later host height must replace the fallback seed.
  host.style.height = '120px';
  resize(99, 120);
  flush();
  await settle();
  expect(actual?.size).toEqual({ width: 99, height: 120 });
  expect(actual?.warnings).toEqual(measured({ width: 99, height: 120 }).warnings);
  host.style.width = '100px';
  host.style.height = '80px';
  resize(100, 80);
  flush();
  expect(host.querySelector('[data-bp-refused]')).toBeNull();
  expect(host.querySelector('.bp-table-grid')).not.toBeNull();
});

// A fixed HTML frame must report the same repair size as measure(), including compiled dimswitch data.
it.each([
  { type: 'table', id: 'steering-monthly', Chart: TableChart },
  { type: 'dimswitch', id: 'by-measure', Chart: DimSwitchChart },
])('reports the $type floor for its fixed and open HTML frames', async ({ type, id, Chart }) => {
  const fixture = getFixtures(type).find(candidate => candidate.id === id)!;
  for (const size of [{ width: 192, height: 48 }, { width: 99 }]) {
    const options = { ...fixture.options, size };
    // React accepts sub-100px host widths. The request measurer checks the
    // open-height floor without the document schema's 100px input limit.
    const expected = measureRequest({ type, data: fixture.data, options }).refused!;
    const minimum = expected.warnings[0]?.expected?.minimum as { width: number; height: number };
    let actual: RefusedLayout | undefined;
    act(() => root.render(<Chart data={fixture.data} {...options} onRefused={result => { actual = result; }} />));
    expect(host.querySelector('[data-bp-refused]')?.getAttribute('data-bp-refused')).toBe('size-below-floor');
    expect(actual?.type).toBe(type);
    expect(actual?.size.width).toBe(size.width);
    expect(actual?.warnings[0]).toMatchObject({ code: 'size-below-floor', expected: { minimum },
      fix: [{ op: 'replace', path: '/options/size', value: minimum }] });
    expect(actual?.warnings).toEqual(expected.warnings);
    expect(actual?.sizing).toEqual(expected.sizing);
    act(() => root.render(<Chart data={fixture.data} {...options} size={minimum} />));
    expect(host.querySelector('[data-bp-refused]')).toBeNull();
    expect(host.querySelector('.bp-table-grid')).not.toBeNull();
  }
  // Content fit leaves height open even when its server fallback has a height.
  const expected = measureRequest({ type, data: fixture.data, options: { ...fixture.options, size: { width: 99 } } }).refused!;
  let actual: RefusedLayout | undefined;
  act(() => root.render(<Chart data={fixture.data} {...fixture.options} size="container" fit="content" fallbackSize={{ width: 99, height: 80 }}
    onRefused={result => { actual = result; }} />));
  await settle();
  expect(actual?.type).toBe(type);
  expect(actual?.sizing.minWidth).toBe(expected.sizing.minWidth);
});

beforeEach(() => {
  callbacks = [];
  observers = [];
  frames = new Map();
  frameId = 0;
  renders = 0;
  vi.stubGlobal('ResizeObserver', Observer);
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('uses the same deterministic fallback on the server and initial client render', () => {
  const props = { size: 'container', fallbackSize: 'dashboard' } as const;
  const server = renderToStaticMarkup(<Probe {...props} />);
  expect(server).toContain('480x270:false');
  expect(observers).toHaveLength(0);
  act(() => root.render(<Probe {...props} />));
  const parsed = document.createElement('div');
  parsed.innerHTML = server;
  // React writes the wrapper's style through the CSSOM, so only the text is compared verbatim.
  expect(host.textContent).toBe(parsed.textContent);
  expect(host.querySelectorAll('[data-bp-probe]')).toHaveLength(parsed.querySelectorAll('[data-bp-probe]').length);
  expect(observers[0]!.observe).toHaveBeenCalledWith(host.firstElementChild, { box: 'content-box' });
});

it('coalesces the latest box once per frame and retains it while hidden', () => {
  act(() => root.render(<Probe size="container" />));
  resize(500, 300);
  resize(640, 360);
  expect(frames.size).toBe(1);
  expect(host.textContent).toBe('720x405:false');
  flush();
  expect(host.textContent).toBe('640x360:true');
  resize(0, 0);
  resize(Number.NaN, 400);
  expect(frames.size).toBe(0);
  expect(host.textContent).toBe('640x360:true');
  resize(640, 360);
  expect(frames.size).toBe(0);
  flush();
  const settledRenders = renders;
  resize(640, 360);
  flush();
  expect(renders).toBe(settledRenders);
});

// deferLayout keeps the last drawing while a new width renders in the background: a lagged input that never
// caught up would leave a chart drawn for an earlier width after the resize ends.
it('draws the same SVG after a run of widths as a fresh chart at the last width', () => {
  const fixture = getFixtures('column')[0]!;
  const chart = <ColumnChart data={fixture.data} {...fixture.options} size="container" />;
  const svgAt = (widths: number[]) => {
    act(() => root.render(chart));
    for (const width of widths) { resize(width, 300); flush(); }
    // useId differs between roots; the drawing does not.
    let n = 0;
    const ids = new Map<string, string>();
    return host.querySelector('svg[data-bp-chart]')!.outerHTML.replace(/_r_[0-9a-z]+_/g, id => ids.get(id) ?? ids.set(id, `id${n++}`).get(id)!);
  };
  const resized = svgAt([900, 420, 760, 640]);
  act(() => root.unmount());
  host.remove();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  expect(resized).toContain('viewBox="0 0 640 ');
  expect(resized).toBe(svgAt([640]));
});

/** Every element a commit inside `update` added that matches `selector`, even one a later commit removed. */
function addedDuring(selector: string, update: () => void): Element[] {
  const watcher = new MutationObserver(() => {});
  watcher.observe(host, { childList: true, subtree: true });
  update();
  const added = watcher.takeRecords().flatMap(record => [...record.addedNodes]).filter((node): node is Element => node instanceof Element);
  watcher.disconnect();
  return added.flatMap(node => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]);
}

// Turning deferLayout on read the empty stand-in value as the request and swapped a drawn chart for the busy box.
it('keeps the drawing when deferLayout turns on', () => {
  const fixture = getFixtures('column')[0]!;
  act(() => root.render(<ColumnChart data={fixture.data} {...fixture.options} size={{ width: 640, height: 360 }} deferLayout={false} />));
  expect(host.querySelector('svg[data-bp-chart]')).not.toBeNull();
  expect(addedDuring('[data-bp-loading]', () => act(() => root.render(<ColumnChart data={fixture.data} {...fixture.options}
    size={{ width: 640, height: 360 }} />)))).toEqual([]);
  expect(host.querySelector('svg[data-bp-chart]')).not.toBeNull();
});

// A cohort drawn in its scroll box met a new size in points with the old width refusal: the refusal card showed in between.
it('keeps a scrolling cohort drawn while a new size lays out', () => {
  const fixture = getFixtures('cohort').find(candidate => candidate.id === 'crowded-average-bases')!;
  act(() => root.render(<CohortChart data={fixture.data} {...fixture.options} size={{ width: 400 }} />));
  expect(host.querySelector('[data-bp-scroll] svg[data-bp-chart]')).not.toBeNull();
  expect(addedDuring('[data-bp-refused]', () => act(() => root.render(<CohortChart data={fixture.data} {...fixture.options}
    size={{ width: 750, height: 360, unit: 'pt' }} />)))).toEqual([]);
  expect(host.querySelector('svg[data-bp-chart]')).not.toBeNull();
});

it('content fit keeps the height seed and ignores height-only changes', () => {
  act(() => root.render(<Probe size="container" fit="content" fallbackSize={{ width: 700, height: 333 }} />));
  resize(500, 0);
  flush();
  expect(host.textContent).toBe('500x333:true');
  resize(500, 800);
  expect(frames.size).toBe(0);
  flush();
  const settledRenders = renders;
  resize(500, 900);
  flush();
  expect(renders).toBe(settledRenders);
  expect(host.textContent).toBe('500x333:true');
});

it('does not observe explicit sizes and cancels pending updates when leaving container mode', () => {
  act(() => root.render(<Probe size="dashboard" />));
  expect(observers).toHaveLength(0);
  expect(host.textContent).toBe('480x270:true');
  act(() => root.render(<Probe size="container" />));
  resize(600, 400);
  expect(frames.size).toBe(1);
  act(() => root.render(<Probe size={{ width: 300, height: 200 }} />));
  expect(observers[0]!.disconnect).toHaveBeenCalledOnce();
  expect(frames.size).toBe(0);
  resize(800, 500);
  expect(frames.size).toBe(0);
  expect(host.textContent).toBe('300x200:true');
});

it('disconnects and cancels its frame on unmount', () => {
  act(() => root.render(<Probe size="container" />));
  resize(600, 400);
  act(() => root.render(null));
  expect(observers[0]!.disconnect).toHaveBeenCalledOnce();
  expect(frames.size).toBe(0);
  resize(700, 500);
  expect(frames.size).toBe(0);
});


// Invalid data must show its refusal and report diagnostics without waiting for the container to settle.
it('reports a non-size refusal immediately in a container', () => {
  const data = { categories: [{ id: 'a', label: 'A' }], series: [{ id: 's', values: [Number.NaN] }] };
  const refused = vi.fn();
  const warnings = vi.fn();
  act(() => root.render(<ColumnChart data={data} size="container" fallbackSize="dashboard" onRefused={refused} onWarnings={warnings} />));
  expect(host.querySelector('[data-bp-refused]')?.getAttribute('data-bp-refused')).toBe('invalid-number');
  expect(refused).toHaveBeenCalledOnce();
  expect(warnings.mock.calls.at(-1)?.[0]).toEqual(refused.mock.calls[0]![0].warnings);
});

// A growing diagram must wait before reporting size-dependent error lints, just as it waits for a size floor.
it('settles diagram size errors and draws when the container grows', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const fixture = getFixtures('diagram').find(candidate => candidate.id === 'org-structure')!;
  const warnings = vi.fn();
  act(() => root.render(<DiagramChart data={fixture.data} {...fixture.options} size="container" fit="fill"
    fallbackSize={{ width: 330, height: 200 }} onWarnings={warnings} />));
  expect(host.querySelector('[data-bp-loading]')).not.toBeNull();
  expect(host.querySelector('[data-bp-spec-error]')).toBeNull();
  act(() => vi.advanceTimersByTime(119));
  expect(warnings).not.toHaveBeenCalled();
  await act(async () => { vi.advanceTimersByTime(1); });
  const card = host.querySelector('[data-bp-spec-error]');
  expect(JSON.parse(card!.getAttribute('data-bp-diagnostics')!)).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'diagram-size-too-small' }),
  ]));
  resize(960, 960);
  flush();
  expect(host.querySelector('[data-bp-spec-error]')).toBeNull();
  expect(host.querySelector('svg[data-bp-chart="diagram"]')).not.toBeNull();
  expect(warnings.mock.calls.at(-1)![0].some((warning: { severity: string }) => warning.severity === 'error')).toBe(false);
});

// Returning to a refused size or changing its refusal must wait again instead of reusing an old settle.
it('restarts the settle after a drawable size and a refusal change', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const data = { categories: [{ id: 'a', label: 'A' }], series: [{ id: 's', values: [1] }] };
  const refused = vi.fn();
  const chart = (title?: string) => <ColumnChart data={data} title={title} size="container" onRefused={refused} />;
  const expectWaiting = async (reports: number) => {
    expect(host.querySelector('[data-bp-refused]')).toBeNull();
    expect(host.querySelector('[data-bp-loading]')).not.toBeNull();
    act(() => vi.advanceTimersByTime(119));
    expect(host.querySelector('[data-bp-refused]')).toBeNull();
    expect(refused).toHaveBeenCalledTimes(reports);
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(host.querySelector('[data-bp-refused]')).not.toBeNull();
    expect(refused).toHaveBeenCalledTimes(reports + 1);
  };
  act(() => root.render(chart()));
  resize(120, 0);
  flush();
  await expectWaiting(0);
  resize(720, 0);
  flush();
  expect(host.querySelector('svg[data-bp-chart]')).not.toBeNull();
  resize(120, 0);
  flush();
  await expectWaiting(1);
  act(() => root.render(chart('Changed title')));
  await expectWaiting(2);
});

// A host that grows through sizes the chart refuses must show the busy box, not a refusal card, until its size holds still.
it('shows the busy box while a refused container size is still moving', async () => {
  const data = { categories: [{ id: 'a', label: 'A' }], series: [{ id: 's', values: [1] }] };
  const refused = vi.fn();
  act(() => root.render(<ColumnChart data={data} size="container" onRefused={refused} />));
  resize(120, 0);
  flush();
  const busy = host.querySelector<HTMLElement>('[data-bp-loading]');
  expect(busy).not.toBeNull();
  expect(refused).not.toHaveBeenCalled();
  await settle();
  const card = host.querySelector<HTMLElement>('[data-bp-refused]');
  expect(card).not.toBeNull();
  // A busy box of another height than the card can flip a host scrollbar and restart the settle without end.
  expect(busy!.style.aspectRatio).toBe(card!.style.aspectRatio);
  expect(refused).toHaveBeenCalledTimes(1);
});

// A server refusal must include the reader card and full diagnostics, without a container settle timer.
it('renders the full fallback-size refusal on the server', async () => {
  const data = { categories: [{ id: 'a', label: 'A' }], series: [{ id: 's', values: [1] }] };
  const fallbackSize = { width: 279, height: 180 };
  const chart = <ColumnChart data={data} size="container" fallbackSize={fallbackSize}
    renderRefused={result => <span>{result.warnings[0]!.message}</span>} />;
  const html = await serverMarkup(chart);
  const server = document.createElement('div');
  server.innerHTML = html;
  const card = server.querySelector('[data-bp-refused="size-below-floor"]');
  expect(card).not.toBeNull();
  expect(JSON.parse(card!.getAttribute('data-bp-diagnostics')!)).toMatchObject([{
    code: 'size-below-floor', expected: { minimum: { width: 280, height: 180 } },
    fix: [{ op: 'replace', path: '/options/size', value: { width: 280, height: 180 } }],
  }]);
  expect(card!.querySelector('[data-bp-error-code="size-below-floor"]')).not.toBeNull();
  expect(card!.textContent).toContain('This chart needs more room.');
  expect(card!.textContent).toContain('Column needs at least 280 × 180px; received 279 × 180px');
  expect(server.querySelector('[data-bp-loading]')).toBeNull();
  act(() => root.render(chart));
  expect(host.querySelector('[data-bp-refused]')).toBeNull();
  await settle();
  const client = host.querySelector('[data-bp-refused]');
  expect(client?.getAttribute('data-bp-diagnostics')).toBe(card!.getAttribute('data-bp-diagnostics'));
  expect(client?.textContent).toBe(card!.textContent);
});

// Hydration must keep the server's refusal visible and report it once, without a busy-box flash.
it('keeps a server refusal held throughout hydration', async () => {
  const data = { categories: [{ id: 'a', label: 'A' }], series: [{ id: 's', values: [1] }] };
  const refused = vi.fn();
  const chart = <ColumnChart data={data} size="container" fallbackSize={{ width: 279, height: 180 }} onRefused={refused} />;
  const html = await serverMarkup(chart);
  act(() => root.unmount());
  host.innerHTML = html;
  expect(host.querySelector('[data-bp-refused]')).not.toBeNull();
  expect(refused).not.toHaveBeenCalled();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let busyAdded = false;
  const observer = new MutationObserver(records => {
    for (const { addedNodes } of records) for (const node of addedNodes) {
      if (node instanceof Element && (node.matches('[data-bp-loading]') || node.querySelector('[data-bp-loading]'))) busyAdded = true;
    }
  });
  observer.observe(host, { childList: true, subtree: true });
  const errors = vi.fn();
  try {
    await act(async () => { root = hydrateRoot(host, chart, { onRecoverableError: errors }); });
    expect(host.querySelector('[data-bp-loading]')).toBeNull();
    expect(refused).toHaveBeenCalledOnce();
    await act(async () => { vi.advanceTimersByTime(240); });
    expect(host.querySelector('[data-bp-refused]')).not.toBeNull();
    expect(busyAdded).toBe(false);
    expect(refused).toHaveBeenCalledOnce();
    expect(errors).not.toHaveBeenCalled();
  } finally {
    observer.disconnect();
  }
});

// A table host that grows through refused sizes must show the busy box, not a refusal card, as every other chart does.
it.each([
  { type: 'table', id: 'steering-monthly', Chart: TableChart },
  { type: 'dimswitch', id: 'by-measure', Chart: DimSwitchChart },
])('settles a $type size refusal while its container is still moving', async ({ type, id, Chart }) => {
  const fixture = getFixtures(type).find(candidate => candidate.id === id)!;
  const refused = vi.fn();
  act(() => root.render(<Chart data={fixture.data} {...fixture.options} size="container" onRefused={refused} />));
  resize(99, 0);
  flush();
  expect(host.querySelector('[data-bp-loading]')).not.toBeNull();
  expect(host.querySelector('[data-bp-refused]')).toBeNull();
  expect(refused).not.toHaveBeenCalled();
  await settle();
  expect(host.querySelector('[data-bp-refused]')?.getAttribute('data-bp-refused')).toBe('size-below-floor');
  expect(refused).toHaveBeenCalledOnce();
});

// A small table in a container drew at the 720 px fallback first and again at its width; it waits for the width as a chart does.
it('draws a small container table once, at its first measured width', () => {
  const fixture = getFixtures('table').find(candidate => candidate.id === 'steering-monthly')!;
  act(() => root.render(<TableChart data={fixture.data} {...fixture.options} size="container" />));
  expect(host.querySelector('[data-bp-loading]')).not.toBeNull();
  expect(host.querySelector('.bp-table-grid')).toBeNull();
  resize(760, 0);
  flush();
  expect(host.querySelector('[data-bp-loading]')).toBeNull();
  expect(host.querySelector('.bp-table-grid')).not.toBeNull();
});

// A cohort or status label-hidden refusal can clear with more width, so it waits for the size; a fixed label collision cannot, so it shows at once.
it.each([
  { code: 'label-hidden', waits: true },
  { code: 'label-collision', waits: false },
])('settles a $code refusal only when more room can lift it', async ({ code, waits }) => {
  const column = getChart('column')!;
  const original = column.layout;
  const spy = vi.spyOn(column, 'layout').mockImplementation((data, options) => {
    const result = original(data, options);
    return { refused: true, type: 'column', title: 'Column', size: result.size, sizing: result.sizing!, warnings: [{
      code, severity: 'error', message: "label 'a' has no free seat",
    }] };
  });
  onTestFinished(() => spy.mockRestore());
  const data = { categories: [{ id: 'a', label: 'A' }], series: [{ id: 's', values: [1] }] };
  const refused = vi.fn();
  act(() => root.render(<ColumnChart data={data} size="container" onRefused={refused} />));
  resize(720, 0);
  flush();
  expect(host.querySelector('[data-bp-refused]') === null).toBe(waits);
  expect(refused).toHaveBeenCalledTimes(waits ? 0 : 1);
  await settle();
  expect(host.querySelector('[data-bp-refused]')?.getAttribute('data-bp-refused')).toBe(code);
  expect(refused).toHaveBeenCalledOnce();
});

// A container width with fractions (615.609375 px) is drawn and reported rounded; that is not a smaller display.
it('warns observed-display-too-small only when the drawn width is a pixel or more short', () => {
  const data = { categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], series: [{ id: 's', values: [1, 2] }] };
  const warnings = vi.fn();
  let minimum = 0;
  act(() => root.render(<ColumnChart data={data} size={{ width: 615.609375, height: 400 }} onWarnings={warnings}
    onGeometry={geometry => { minimum = geometry.presentation!.minDisplayWidth; }} />));
  const svg = host.querySelector('svg[data-bp-chart]')!;
  const tooSmall = () => (warnings.mock.calls.at(-1)?.[0] as { code: string }[]).some(warning => warning.code === 'observed-display-too-small');
  act(() => resize(minimum - 0.01, 400, svg));
  expect(tooSmall()).toBe(false);
  act(() => resize(minimum - 1, 400, svg));
  expect(tooSmall()).toBe(true);
});

/** The print media query; `print(true)` is the moment the page is laid out for paper (printLayout.ts). */
function printMedia() {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  vi.stubGlobal('matchMedia', (query: string) => ({ media: query, matches: false,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener) }));
  return (matches: boolean) => listeners.forEach(listener => listener({ matches } as MediaQueryListEvent));
}

/** What the printed page gives: the wrapper's width and the height the drawn chart takes there. */
function printedBox(width: number, height: number) {
  host.querySelector('[data-bp-container]')!.getBoundingClientRect = () => new DOMRect(0, 0, width, 0);
  host.querySelector('svg[data-bp-chart]')!.getBoundingClientRect = () => new DOMRect(0, 0, width, height);
}

const viewBox = () => host.querySelector('svg[data-bp-chart]')?.getAttribute('viewBox');

// A chart kept its screen layout in print and the browser scaled it to the paper: its text shrank or was cut. The
// browser takes the page right after the print listener, so a deferred layout would print the screen drawing. A
// content-fit chart (bar) that took its own height grew past the pages the browser had counted and lost the page end.
it.each([['column', ColumnChart], ['bar', BarChart]] as const)('lays a container %s chart out for its printed box at once and puts the screen layout back after print', (type, Chart) => {
  const print = printMedia();
  const fixture = getFixtures(type)[0]!;
  act(() => root.render(<Chart data={fixture.data as never} {...fixture.options} size="container" />));
  resize(900, 0);
  flush();
  const screen = host.querySelector('svg[data-bp-chart]')!.outerHTML;
  act(() => window.dispatchEvent(new Event('beforeprint')));
  printedBox(480, 300);
  let printed: string | null | undefined;
  act(() => { print(true); printed = viewBox(); });
  // 300 px less the HTML footer: the chart keeps the height it has on the printed page.
  const [, , width, height] = printed!.split(' ').map(Number);
  expect(width).toBe(480);
  expect(height).toBeGreaterThan(200);
  expect(height).toBeLessThanOrEqual(300);
  act(() => { window.dispatchEvent(new Event('afterprint')); print(false); });
  expect(host.querySelector('svg[data-bp-chart]')!.outerHTML).toBe(screen);
});

// The printed box of a narrow dashboard column is below the chart's floor: paper showed a refusal card or the busy box.
it('scales a chart whose printed box is below its floor from the smallest box of the same shape', () => {
  const print = printMedia();
  const fixture = getFixtures('column')[0]!;
  let drawn: { width: number; height: number } | undefined;
  act(() => root.render(<ColumnChart data={fixture.data} {...fixture.options} size="container" onGeometry={geometry => { drawn = geometry.size; }} />));
  resize(900, 0);
  flush();
  printedBox(200, 120);
  act(() => print(true));
  expect(host.querySelector('[data-bp-refused], [data-bp-loading]')).toBeNull();
  // The whole chart takes the shape, its HTML footer included; the SVG ends at the footer's top.
  expect(drawn!.width).toBeGreaterThan(200);
  expect(drawn!.width / drawn!.height).toBeCloseTo(200 / 120, 1);
});

// A chart the author gave a size is not the page's to resize.
it('keeps a fixed-size chart at its size in print', () => {
  const print = printMedia();
  const fixture = getFixtures('column')[0]!;
  act(() => root.render(<ColumnChart data={fixture.data} {...fixture.options} size={{ width: 640, height: 360 }} />));
  const screen = host.querySelector('svg[data-bp-chart]')!.outerHTML;
  act(() => { window.dispatchEvent(new Event('beforeprint')); print(true); });
  expect(host.querySelector('svg[data-bp-chart]')!.outerHTML).toBe(screen);
});

// A cohort that fits the screen but not its printed box gained a scroll box in print, which mounted the chart again
// and dropped the reader's state (a story step) after print.
it('keeps a cohort mounted when its printed box is below its floor', () => {
  const print = printMedia();
  const fixture = getFixtures('cohort').find(candidate => candidate.id === 'retention-pure-exhibit')!;
  act(() => root.render(<CohortChart data={fixture.data} {...fixture.options} size="container" />));
  resize(1400, 0);
  flush();
  const drawn = host.querySelector('svg[data-bp-chart]')!.parentElement!;
  printedBox(200, 120);
  act(() => print(true));
  expect(drawn.isConnected).toBe(true);
  act(() => { window.dispatchEvent(new Event('afterprint')); print(false); });
  expect(drawn.isConnected).toBe(true);
});

// A 280 px dashboard card with one value the chart left out drew its "Notes and sources (1)" button below the card.
it('reserves the info footer row for a hidden-value note inside a pinned card', () => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const spec = { type: 'column', data: { categories: months.map((m) => ({ id: m.toLowerCase(), label: m })), series: [
    { id: 'plan', label: 'Plan', values: [60, 70, 132.3, 117.2, 99.1, 80, 120, 110, 120.5, 95.2, 131.7, 65.1] },
    { id: 'actual', label: 'Actual', values: [60, 70.5, 110, 105, 70, 92, 137.8, 130, 125, 108, 85, 60] },
  ] }, options: { title: 'Plan against actual', target: 'dashboard', size: { width: 446, height: 280 } } };
  const geometry = layoutContainerRequest(resolveChartRequest(spec as never));
  if (geometry.refused) throw new Error('refused');
  expect(geometry.frame.noteList?.some((note) => !note.inFrame && note.kind === 'disclosure')).toBe(true);
  expect(geometry.size.height - geometry.frame.footerRect!.y).toBeGreaterThanOrEqual(24);
});

// A filling chart in a fixed-height host drew its HTML footer past the host: the "+1 note" button takes a 24 px row
// of its own under a two-line source, a row the frame did not reserve (cycle-bands, 390 × 520: 18 px below the
// host in Chromium). The frame now reserves the rows React draws, in the one layout each size gets.
it('reserves the rows of the HTML footer in the one layout a container size gets', () => {
  const fixture = getFixtures('line').find((entry) => entry.id === 'cycle-bands')!;
  const { size: _size, ...options } = fixture.options as Record<string, unknown>;
  const drawn: Geometry[] = [];
  act(() => root.render(<LineChart data={fixture.data as never} {...options} size="container" fit="fill" onGeometry={geometry => { drawn.push(geometry); }} />));
  resize(390, 520);
  flush();
  expect(drawn).toHaveLength(1);
  // Two source lines, the 2 px row gap and the 24 px button row; the 8 px bottom margin stays below them.
  const rect = drawn[0]!.frame.footerRect!;
  expect(drawn[0]!.size.height).toBe(520);
  expect(rect.h).toBeCloseTo(2 * 14.3 + 2 + 24, 5);
  expect(host.querySelector('[data-bp-footer]')!.textContent).toContain('+1 note');
  resize(390, 600);
  flush();
  expect(drawn).toHaveLength(2);
  // A fixed size reserves the same rows.
  const fixed = layoutContainerRequest(resolveChartRequest({ type: 'line', data: fixture.data, options: { ...options, size: { width: 390, height: 520 } } } as never));
  if (fixed.refused) throw new Error('refused');
  expect(fixed.frame.footerRect!.h).toBeCloseTo(rect.h, 5);
});

// A compact grid's "+1 note" opened a panel that held only the source line the footer already showed.
it('keeps the source line out of the notes panel', () => {
  const fixture = getFixtures('grid').find((entry) => entry.id === 'kpi-and-waffle')!;
  act(() => root.render(<GridChart data={fixture.data as never} {...fixture.options as object} size={{ width: 390, height: 520 }} />));
  const footer = host.querySelector('[data-bp-footer]')!;
  expect(footer.textContent).toContain('Illustrative data');
  expect(footer.querySelector('[data-bp-notes-toggle]')).toBeNull();
});

// A content-fit chart links the static footer inside its first render. Announcing that publish redrew
// every chart already on the page from inside that render, and React logged "Cannot update a component".
it('mounts a content-fit chart beside drawn charts without a render-phase update', async () => {
  const fixture = (type: string) => {
    const { size: _size, ...options } = getFixtures(type).find(candidate => candidate.tags.includes('demo'))!.options as Record<string, unknown>;
    return { data: getFixtures(type).find(candidate => candidate.tags.includes('demo'))!.data, ...options };
  };
  const props = { table: fixture('table'), waterfall: fixture('waterfall'), bartable: fixture('bartable') };
  // A fresh module graph: no chart has linked the static footer yet, as on a page's first render.
  vi.resetModules();
  const React = await import('react');
  const { createRoot: createFreshRoot } = await import('react-dom/client');
  const { TableChart: FreshTable } = await import('../src/react/charts/table');
  const { WaterfallChart: FreshWaterfall } = await import('../src/react/charts/waterfall');
  const { BarTableChart: FreshBarTable } = await import('../src/react/charts/bartable');
  const errors: string[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(' ')); });
  onTestFinished(() => spy.mockRestore());
  const fresh = createFreshRoot(document.body.appendChild(document.createElement('div')));
  const fallbackSize = { width: 700, height: 420 };
  const drawn = [
    React.createElement(FreshTable, { key: 'table', ...props.table, size: 'container', fallbackSize } as never),
    React.createElement(FreshWaterfall, { key: 'waterfall', ...props.waterfall, size: 'container', fallbackSize } as never),
  ];
  await React.act(async () => { fresh.render(React.createElement('div', null, ...drawn)); });
  await React.act(async () => {
    fresh.render(React.createElement('div', null, ...drawn, React.createElement(FreshBarTable, { key: 'bartable', ...props.bartable, size: 'container', fallbackSize } as never)));
  });
  React.act(() => fresh.unmount());
  expect(errors.filter(message => message.includes('Cannot update a component'))).toEqual([]);
});

// A host that re-renders with a new prepared object after the container measured a size other than the fallback
// threw "Prepared chart does not match the resolved request": the snapshot is keyed at the fallback frame.
// A host as wide as the fallback with no height has the fallback size but not its fixed flags, and threw too.
it.each(['chart', 'table'] as const)('accepts a new prepared %s after the container measured another size', async kind => {
  for (const [width, height] of [[820, 420], [640, 0]] as const) {
  const fallbackSize = { width: 640, height: 360 };
  const column = { categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], series: [{ id: 's', label: 'S', values: [3, 5] }] };
  const table = { columns: [{ id: 'label', kind: 'rowLabel' as const, label: 'Item' }, { id: 'a', kind: 'value' as const, label: 'A', format: '1.0' }],
    rows: [{ id: 'r1', label: 'One', cells: { a: 1 } }, { id: 'r2', label: 'Two', cells: { a: 2 } }] };
  const input = kind === 'chart' ? { type: 'column' as const, data: column } : { type: 'table' as const, data: table };
  const prepared = await prepareChart({ ...input, size: 'container', fit: kind === 'chart' ? 'fill' : 'content', fallbackSize } as never);
  const draw = (snapshot: typeof prepared) => kind === 'chart'
    ? <ColumnChart data={column} size="container" fit="fill" fallbackSize={fallbackSize} prepared={snapshot as never} />
    : <TableChart data={table} size="container" fallbackSize={fallbackSize} prepared={snapshot as never} />;
  act(() => root.render(draw(prepared)));
  resize(width, height);
  flush();
  act(() => root.render(draw(structuredClone(prepared))));
  expect(host.querySelector(kind === 'chart' ? 'svg[data-bp-chart]' : '.bp-table-grid')).not.toBeNull();
  if (kind === 'chart') expect(host.querySelector('svg[data-bp-chart]')?.getAttribute('viewBox')?.split(' ')[2]).toBe(String(width));
  }
});
