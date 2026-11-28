// @vitest-environment jsdom
import './helpers/hover-viewport';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getFixtures } from '../src/fixtures';
import { BarChart } from '../src/react/charts/bar';
import { ColumnChart } from '../src/react/charts/column';
import { loadHoverEngine } from '../src/react/useHover';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const data = { categories: ['A', 'B', 'C'], series: [
  { id: 'north', label: 'North', values: [3, 4, 2] }, { id: 'south', label: 'South', values: [2, 3, 4] }, { id: 'west', label: 'West', values: [4, 3, 6] }] };
const size = { width: 600, height: 400 };

let host: HTMLDivElement;
let root: Root | undefined;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); });
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; host.remove(); });

async function render(element: ReactElement) {
  root ??= createRoot(host);
  await act(async () => { root!.render(element); await loadHoverEngine(); });
}
const label = (name: string) => Array.from(host.querySelectorAll('[data-part="legendLabel"]')).find((node) => node.textContent === name)!;
const key = (name: string) => Array.from(host.querySelectorAll('[data-bp-legend-key]')).find((node) => node.textContent === name)!;
const fire = (node: Element, event: Event) => act(() => { node.dispatchEvent(event); });
const click = (node: Element) => fire(node, new MouseEvent('click', { bubbles: true }));
const marks = (id: string) => host.querySelectorAll(`[data-id^="mark:${id}:"]`).length;
const fills = () => Array.from(host.querySelectorAll('[data-id^="mark:"]')).map((node) => `${node.getAttribute('data-id')} ${node.getAttribute('fill')}`);

// A reader who hides a series could not bring it back, or the other series would change colour.
it('hides a series on a legend click and shows it again on the next', async () => {
  await render(<ColumnChart data={data} legend="top" size={size} />);
  const before = fills();
  click(label('North'));
  expect(marks('north')).toBe(0);
  expect(fills()).toEqual(before.filter((entry) => !entry.startsWith('mark:north:')));
  expect(key('North').getAttribute('aria-pressed')).toBe('false');
  expect(key('South').getAttribute('aria-pressed')).toBe('true');
  // The SVG keeps role="img", so no control sits inside it.
  expect(host.querySelector('svg [role="button"], svg [tabindex]')).toBeNull();
  // The hover card of a category counts the visible series only.
  const south = host.querySelector('[data-id="mark:south:A"]')!;
  const move = Object.assign(new Event('pointermove', { bubbles: true }), { pointerType: 'mouse', clientX: 0, clientY: 0 });
  fire(south, move);
  const card = Array.from(document.querySelectorAll('[data-bp-chart-card]')).map((node) => node.textContent).join(' ');
  expect(card).toContain('South');
  expect(card).not.toContain('North');
  click(label('North'));
  expect(fills()).toEqual(before);
  // The last visible series stays.
  click(label('North'));
  click(label('South'));
  click(label('West'));
  expect(marks('west')).toBe(3);
  // The keyboard button of a series works as the click does.
  click(key('South'));
  expect(marks('south')).toBe(3);
  // Only hover={false} is the static chart.
  await render(<ColumnChart data={data} legend="top" size={size} hover={{ card: false, highlight: false }} />);
  expect(key('West')).toBeDefined();
});

// A series would stay hidden with no control left to show it.
it('shows every series again when the page takes the legend click or turns hover off', async () => {
  await render(<ColumnChart data={data} legend="top" size={size} />);
  click(label('North'));
  const onSeriesClick = vi.fn();
  await render(<ColumnChart data={data} legend="top" size={size} onSeriesClick={onSeriesClick} />);
  expect(marks('north')).toBe(3);
  click(label('North'));
  expect(onSeriesClick.mock.calls).toEqual([['north']]);
  await render(<ColumnChart data={data} legend="top" size={size} />);
  expect(marks('north')).toBe(3);
  click(label('North'));
  await render(<ColumnChart data={data} legend="top" size={size} hover={false} />);
  expect(marks('north')).toBe(3);
  // A chart whose legend goes away has no entry left to click the series back.
  await render(<ColumnChart data={data} legend="top" size={size} />);
  click(label('North'));
  await render(<ColumnChart data={data} legend="none" size={size} />);
  expect(marks('north')).toBe(3);
  expect(host.querySelector('[data-bp-legend-key]')).toBeNull();
});

// The legend would mark a case as hidden while the chart still draws it.
it('offers no legend click on a tornado chart', async () => {
  const fixture = getFixtures('bar').find((entry) => entry.id === 'tornado-two-drivers')!;
  await render(<BarChart data={fixture.data as never} {...fixture.options as object} size={size} />);
  expect(host.querySelectorAll('[data-part="legendLabel"]').length).toBeGreaterThan(0);
  expect(host.querySelector('[data-bp-legend-key]')).toBeNull();
  const before = fills();
  click(host.querySelector('[data-part="swatch"]')!);
  expect(fills()).toEqual(before);
});

// New data that drops series kept a stale hidden list: the legend marked drawn series as hidden and a click hid another
// series, and a legend that lost its click kept dead buttons.
it('follows new data and leaves no button behind', async () => {
  await render(<ColumnChart data={data} legend="top" size={size} />);
  click(label('West'));
  const two = { ...data, series: data.series.slice(0, 2) };
  await render(<ColumnChart data={two} legend="top" size={size} />);
  expect(key('North').getAttribute('aria-pressed')).toBe('true');
  click(label('North'));
  expect(marks('north')).toBe(0);
  expect(marks('south')).toBe(3);
  await render(<ColumnChart data={{ ...data, series: data.series.slice(0, 1) }} legend="top" size={size} />);
  expect(host.querySelector('[data-bp-legend-key]')).toBeNull();
  // A series that leaves takes its button with it, and a focused button keeps the focus.
  await render(<ColumnChart data={data} legend="top" size={size} />);
  (key('South') as HTMLElement).focus();
  const reference = { ...data, series: [{ ...data.series[0]!, role: 'reference' as const }, ...data.series.slice(1)] };
  await render(<ColumnChart data={reference} legend="top" size={size} />);
  expect(document.activeElement).toBe(key('South'));
  // A new order moves the focused button, and it keeps the focus.
  (key('West') as HTMLElement).focus();
  await render(<ColumnChart data={{ ...reference, series: [...reference.series].reverse() }} legend="top" size={size} />);
  expect(document.activeElement).toBe(key('West'));
  await render(<ColumnChart data={data} legend="top" size={size} />);
  await render(<ColumnChart data={data} legend="top" size={size} onSeriesClick={vi.fn()} />);
  expect(host.querySelector('[aria-pressed]')).toBeNull();
  expect(label('North').getAttribute('role')).toBe('button');
});

// The focus ring of a legend button sat tight on the label and touched letters that reach below the line.
it('makes the focus button of a legend label larger than the label', async () => {
  await render(<ColumnChart data={data} legend="top" size={size} />);
  const button = key('North') as HTMLButtonElement;
  act(() => button.focus());
  // A layout-less test document measures every label as 0 x 0 px, so the button's size is its room alone.
  expect(button.style.width).toBe('6px');
  expect(button.style.height).toBe('6px');
});
