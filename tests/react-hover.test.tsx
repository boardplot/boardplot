// @vitest-environment jsdom
import './helpers/hover-viewport';
import { act, useState, type ComponentProps } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { ComboChart } from '../src/react/charts/combo';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/core/charts';
import { targetId } from '../src/core/a11y/recordsShared';
import { getChart } from '../src/core/registry';
import { getFixtures } from '../src/fixtures';
import { ColumnChart } from '../src/react/charts/column';
import { LineChart } from '../src/react/charts/line';
import { SlopeChart } from '../src/react/charts/slope';
import { prepareChart } from '../src/react/prepare';
import { BoardplotChart } from '../src/react/spec';
import { BarChart } from '../src/react/charts/bar';
import { VarianceChart } from '../src/react/charts/variance';
import { HoverGroup } from '../src/react/HoverGroup';
import type { InteractionRecord } from '../src/core/a11y/types';
import { mount, mountedMarkup } from './helpers/spec-chunks';
import { loadHoverEngine } from '../src/react/useHover';
import { followSeat } from '../src/react/hover/labelCard';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

/** acceptance: the column fixture the registry marks as its hover demo. */
const column = getFixtures('column').find(fixture => fixture.kind === 'example' && fixture.hover)!;
const size = { width: 800, height: 450 };
const scope = { chart: 'chart' };

let host: HTMLDivElement;
let root: Root | undefined;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); });
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; host.remove(); vi.restoreAllMocks(); });

async function render(element: React.ReactElement) {
  root ??= createRoot(host);
  await act(async () => { root!.render(element); await loadHoverEngine(); });
}

function pointer(target: Element, kind: string, pointerType = 'mouse') {
  const event = new Event(kind, { bubbles: true });
  Object.assign(event, { pointerType, clientX: 0, clientY: 0 });
  act(() => target.dispatchEvent(event));
}

/** A mouse move over `target` at client (x, y). */
function move(target: Element, x: number, y: number) {
  const event = new Event('pointermove', { bubbles: true });
  Object.assign(event, { pointerType: 'mouse', clientX: x, clientY: y });
  act(() => target.dispatchEvent(event));
}

/** The drawn node of one record, found through the records the server would prepare. */
async function nodeOf(type: string, data: unknown, options: object, owner: object): Promise<Element> {
  const prepared = await prepareChart({ type, data, options: { ...options, size }, scope });
  const record = prepared.records!.find(entry => entry.id === targetId({ ...scope, owner }))!;
  return host.querySelector(`[data-id="${record.nodeIds[0]}"]`)!;
}

/** jsdom lays nothing out: a chart card's box is its fixed seat, so a pointer over it lands on it as in a browser. */
function cardBox(node: HTMLElement): DOMRect {
  const [left = 0, top = 0] = node.style.translate.split(' ').map(parseFloat);
  const width = parseFloat(node.style.width), height = parseFloat(node.style.height);
  return { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON() {} } as DOMRect;
}

function mockCardBoxes() {
  const plain = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-bp-chart-card') ? cardBox(this) : plain.call(this);
  });
}

/** A mouse move at client (x, y): on the card where it takes the pointer, else on the chart under it. */
function moveTo(x: number, y: number) {
  const shown = document.querySelector<HTMLElement>('[data-bp-chart-card]');
  const box = shown && shown.style.pointerEvents !== 'none' ? cardBox(shown) : undefined;
  const onCard = box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
  const event = new Event('pointermove', { bubbles: true });
  Object.assign(event, { pointerType: 'mouse', clientX: x, clientY: y });
  act(() => (onCard ? shown!.querySelector('svg')! : host.querySelector('svg')!).dispatchEvent(event));
}

function drawn(part: string): boolean {
  return (part === 'interaction-card' ? document : host).querySelector(`[data-part="${part}"]`) !== null;
}

function card(): string | undefined {
  const texts = Array.from(document.querySelectorAll('[data-bp-chart-card] [data-part="interaction-label"]')).map(node => node.textContent ?? '');
  return texts.length ? texts.join(' | ') : undefined;
}

describe('the seat of a card that follows the pointer', () => {
  const chart = { x: 0, y: 0, w: 800, h: 450 };
  const view = { x: -300, y: -300, w: 1400, h: 1000 };
  it('sits 20 px right of and below the pointer', () => {
    expect(followSeat({ x: 100, y: 100 }, 150, 80, chart, view)).toMatchObject({ x: 120, y: 120 });
  });
  it('flips each axis on its own at the chart edge', () => {
    expect(followSeat({ x: 700, y: 100 }, 150, 80, chart, view)).toMatchObject({ x: 530, y: 120 });
    expect(followSeat({ x: 100, y: 400 }, 150, 80, chart, view)).toMatchObject({ x: 120, y: 300 });
  });
  it('leaves a chart too small for the card on its usual side, inside the viewport', () => {
    expect(followSeat({ x: 100, y: 20 }, 150, 80, { x: 0, y: 0, w: 176, h: 42 }, view)).toMatchObject({ x: 120, y: 40 });
  });
  it('clamps into a viewport where neither side fits', () => {
    expect(followSeat({ x: 100, y: 50 }, 150, 80, chart, { x: 0, y: 0, w: 200, h: 100 })).toMatchObject({ x: 50, y: 20 });
  });
});

describe('hover card and highlight on a column fixture', () => {
  const props = { data: column.data, ...column.options as object, size } as unknown as ComponentProps<typeof ColumnChart>;

  it('shows the card with the hovered record facts and dims the other marks', async () => {
    await render(<ColumnChart {...props} hover />);
    const target = await nodeOf('column', column.data, column.options as object, column.hover!.owner);
    expect(card()).toBeUndefined();
    pointer(target, 'pointermove');
    expect(drawn('interaction-card')).toBe(true);
    expect(card()).toContain('Q3F | Revenue:');
    expect(card()).toContain('$96m');
    expect(card()).toContain('low: | $89m');
    expect(drawn('interaction-outline')).toBe(true);
    pointer(host.querySelector('[data-bp-hover]')!, 'pointerout');
    // The card closes 100 ms after the pointer leaves, fades out and unmounts 500 ms later.
    await act(() => new Promise(resolve => setTimeout(resolve, 200)));
    expect(drawn('interaction-outline')).toBe(false);
    expect(document.querySelector<HTMLElement>('[data-bp-chart-card]')!.style.visibility).toBe('hidden');
    await act(() => new Promise(resolve => setTimeout(resolve, 600)));
    expect(drawn('interaction-card')).toBe(false);
  });

  // The card jumped between seats beside each mark. It now follows the pointer as one element, as an ECharts tooltip does.
  it('follows the pointer within one record without drawing the chart again', async () => {
    await render(<ColumnChart {...props} hover />);
    const target = await nodeOf('column', column.data, column.options as object, column.hover!.owner);
    move(target, 100, 100);
    const shown = document.querySelector<HTMLElement>('[data-bp-chart-card]')!;
    expect(shown.style.translate).toBe('120px 120px');
    expect(shown.style.pointerEvents).toBe('none');
    expect(shown.style.transition).toContain('translate 400ms cubic-bezier(0.23, 1, 0.32, 1)');
    const changes: MutationRecord[] = [];
    const observer = new MutationObserver(records => changes.push(...records));
    observer.observe(host.querySelector('svg')!, { subtree: true, attributes: true, childList: true, characterData: true });
    const content = shown.innerHTML;
    // The first move within the record shows at once, a second within 50 ms waits for the next step and ends at the last point.
    move(target, 110, 140);
    expect(shown.style.translate).toBe('130px 160px');
    move(target, 130, 150);
    expect(shown.style.translate).toBe('130px 160px');
    await act(() => new Promise(resolve => setTimeout(resolve, 80)));
    expect(shown.style.translate).toBe('150px 170px');
    observer.disconnect();
    expect(changes).toEqual([]);
    expect(shown.innerHTML).toBe(content);
    // Another record changes the content of the same element, which keeps gliding.
    const other = Array.from(host.querySelectorAll('[data-part="bar"]')).find(node => node !== target)!;
    move(other, 300, 200);
    expect(document.querySelector('[data-bp-chart-card]')).toBe(shown);
    expect(shown.innerHTML).not.toBe(content);
    expect(shown.style.translate).toBe('320px 220px');
  });

  // After a wheel scroll the card stayed at the still pointer and named the mark that had been under it, while another mark was.
  it('closes a card at the pointer when a scroll moves the chart under it', async () => {
    const at = { x: 0, y: 0 };
    vi.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockImplementation(() =>
      ({ x: at.x, y: at.y, left: at.x, top: at.y, right: at.x + 800, bottom: at.y + 450, width: 800, height: 450, toJSON() {} }));
    await render(<ColumnChart {...props} hover />);
    const target = await nodeOf('column', column.data, column.options as object, column.hover!.owner);
    move(target, 100, 100);
    expect(drawn('interaction-outline')).toBe(true);
    at.y = -127;
    act(() => { window.dispatchEvent(new Event('scroll')); });
    await act(() => new Promise(resolve => requestAnimationFrame(() => resolve(undefined))));
    expect(drawn('interaction-outline')).toBe(false);
    expect(document.querySelector<HTMLElement>('[data-bp-chart-card]')!.style.opacity).toBe('0');
  });

  it('fades a closed card out and glides a card that opens again soon from its place', async () => {
    await render(<ColumnChart {...props} hover />);
    const target = await nodeOf('column', column.data, column.options as object, column.hover!.owner);
    const other = Array.from(host.querySelectorAll('[data-part="bar"]')).find(node => node !== target)!;
    move(target, 100, 100);
    const shown = document.querySelector<HTMLElement>('[data-bp-chart-card]')!;
    pointer(host.querySelector('[data-bp-hover]')!, 'pointerout');
    await act(() => new Promise(resolve => setTimeout(resolve, 150)));
    expect(shown.isConnected).toBe(true);
    expect(shown.style.opacity).toBe('0');
    expect(shown.getAttribute('aria-hidden')).toBe('true');
    // Within 500 ms the same element opens again at the new point: it glides there and fades in.
    move(other, 300, 200);
    expect(document.querySelector('[data-bp-chart-card]')).toBe(shown);
    expect(shown.style.opacity).toBe('1');
    expect(shown.style.translate).toBe('320px 220px');
    pointer(host.querySelector('[data-bp-hover]')!, 'pointerout');
    // React renders a timer's update when `act` ends: one wait for the close after 100 ms, one for the 500 ms the faded card stays.
    await act(() => new Promise(resolve => setTimeout(resolve, 150)));
    expect(shown.style.opacity).toBe('0');
    await act(() => new Promise(resolve => setTimeout(resolve, 600)));
    expect(shown.isConnected).toBe(false);
    // Later the card mounts afresh: it fades in at the pointer without travel.
    move(target, 100, 100);
    expect(document.querySelector('[data-bp-chart-card]')).not.toBe(shown);
  });

  // A card seated on a small sparkline's line caught the pointer moving along the line, so the earlier points could not be reached.
  it('lets the pointer move along a tile sparkline to every point while the card is open', async () => {
    const labels = Array.from({ length: 24 }, (_, index) => `M${index + 1}`);
    const values = [40, 44.3, 47.9, 50.4, 51.5, 51.1, 49.5, 47.1, 44.6, 42.5, 41.5, 41.9, 43.8, 47, 51, 55.4, 59.4, 62.5, 64.2, 64.4, 63.3, 61.2, 58.7, 56.3];
    const spec = { type: 'sparkline', data: { values, labels }, options: { ring: 'last', endLabels: 'ends', valueLabel: 'none', title: false, size: { width: 176, height: 42 } } };
    // A dashboard tile: the chart sits at (300, 300) with free page space on every side.
    const at = { x: 300, y: 300 };
    vi.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockImplementation(() =>
      ({ x: at.x, y: at.y, left: at.x, top: at.y, right: at.x + 176, bottom: at.y + 42, width: 176, height: 42, toJSON() {} }));
    mockCardBoxes();
    await render(<BoardplotChart spec={spec as never} hover />);
    const prepared = await prepareChart(spec as never);
    const points = prepared.records!.map(record => {
      const box = record.anchor as { x: number; y: number; w: number; h: number };
      return { label: record.label, x: at.x + box.x + box.w / 2, y: at.y + box.y + box.h / 2 };
    });
    // Open the card on point 22, then follow the line to the left in 2 px steps.
    const reached = new Set<string>();
    for (let x = points[21]!.x; x >= points[0]!.x; x -= 2) {
      const next = points.findIndex(point => point.x >= x);
      const [a, b] = [points[Math.max(next - 1, 0)]!, points[next]!];
      moveTo(x, b.x === a.x ? a.y : a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x));
      const shown = card() ?? '';
      reached.add(points.find(point => shown.startsWith(`${point.label} `))?.label ?? '');
    }
    expect([...reached].filter(Boolean).sort()).toEqual(labels.slice(0, 22).sort());
  });

  // A card beside a point between several lines lay over the other lines and held its point, so the pointer could not reach the points under it.
  it('lets the pointer through a card that lies over the lines and picks the point under it', async () => {
    const wave = (base: number, step: number) => Array.from({ length: 24 }, (_, index) => Math.round((base + 8 * Math.sin(index / 2.3) + index * step) * 10) / 10);
    const spec = { type: 'line', data: { categories: Array.from({ length: 24 }, (_, index) => ({ id: `m${index + 1}`, label: `M${index + 1}` })),
      series: [{ id: 'north', label: 'North', values: wave(62, 0.9) }, { id: 'central', label: 'Central', values: wave(42, 0.8) }, { id: 'south', label: 'South', values: wave(24, 0.4) }] },
    options: { title: false, size: { width: 720, height: 405 } } };
    mockCardBoxes();
    await render(<BoardplotChart spec={spec as never} hover />);
    const prepared = await prepareChart(spec as never);
    const points = prepared.records!.filter(record => record.target.owner.seriesId === 'north').map(record => ({ label: record.target.owner.categoryId!.toUpperCase(), ...record.anchor as { x: number; y: number } }));
    moveTo(points[12]!.x, points[12]!.y);
    expect(card()).toMatch(/^M13 /);
    const shown = document.querySelector<HTMLElement>('[data-bp-chart-card]')!;
    expect(shown.style.pointerEvents).toBe('none');
    const box = cardBox(shown);
    const at = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    moveTo(at.x, at.y);
    const under = points.reduce((best, point) => Math.abs(point.x - at.x) < Math.abs(best.x - at.x) ? point : best);
    expect(under.label).not.toBe('M13');
    expect(card()).toMatch(new RegExp(`^${under.label} `));
  });

  // A tap leaves no pointer to move away: without this, a card opened by a tap stayed open after a tap elsewhere on the page.
  it('closes a card opened by a tap when the reader taps outside the chart', async () => {
    await render(<ColumnChart {...props} hover />);
    pointer(await nodeOf('column', column.data, column.options as object, column.hover!.owner), 'pointerdown', 'touch');
    expect(drawn('interaction-card')).toBe(true);
    pointer(document.body, 'pointerdown', 'touch');
    expect(drawn('interaction-card')).toBe(false);
  });

  it('draws the static chart with hover off and the same SVG before any pointer input', async () => {
    const plain = renderToString(<ColumnChart {...props} hover={false} />);
    const hovered = renderToString(<ColumnChart {...props} />);
    expect(plain).not.toContain('data-bp-hover');
    expect(hovered).toContain('data-bp-hover');
    // Only the React instance id differs between two renders.
    const svg = (html: string) => html.slice(html.indexOf('<svg'), html.indexOf('</svg>')).replace(/_R_\w+_/g, 'id');
    expect(svg(hovered)).toBe(svg(plain));
  });

  it('keeps the chart stylesheet in place across different card contents', async () => {
    await render(<ColumnChart {...props} hover />);
    const style = host.querySelector('[data-bp-hover] > style')!;
    const text = style.firstChild;
    const target = await nodeOf('column', column.data, column.options as object, column.hover!.owner);
    pointer(target, 'pointermove');
    const first = card();
    const other = Array.from(host.querySelectorAll('[data-part="bar"]')).find(node => node !== target)!;
    pointer(other, 'pointermove');
    expect(card()).not.toBe(first);
    expect(style.firstChild).toBe(text);
  });

  it('portals an unscaled card outside a clipping host and remeasures viewport edges after resize', async () => {
    await render(<ColumnChart {...props} hover />);
    host.style.overflow = 'hidden';
    const svg = host.querySelector('svg')!;
    const target = await nodeOf('column', column.data, column.options as object, column.hover!.owner);
    pointer(target, 'pointermove');
    const original = document.querySelector<HTMLElement>('[data-bp-chart-card]')!;
    const width = parseFloat(original.style.width);
    const height = parseFloat(original.style.height);
    const box = { x: 780, y: 610, left: 780, top: 610, right: 1180, bottom: 835, width: 400, height: 225, toJSON() {} };
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue(box);
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
      await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
    });
    const portal = document.querySelector<HTMLElement>('[data-bp-chart-card]')!;
    expect(portal.parentElement).toBe(document.body);
    expect(host.contains(portal)).toBe(false);
    expect(svg.querySelector('[data-part="interaction-card"]')).toBeNull();
    expect(parseFloat(portal.style.width)).toBe(width);
    expect(parseFloat(portal.style.height)).toBe(height);
    expect(Number(portal.querySelector('svg')!.getAttribute('width'))).toBe(width);
    expect(Number(portal.querySelector('svg')!.getAttribute('height'))).toBe(height);
    // Without the top layer the card is fixed to the viewport, so it adds nothing to the page's scroll area.
    const [left, top] = portal.style.translate.split(' ').map(parseFloat) as [number, number];
    expect(portal.style.position).toBe('fixed');
    expect(left).toBeGreaterThanOrEqual(8);
    expect(top).toBeGreaterThanOrEqual(8);
    expect(left + width).toBeLessThanOrEqual(window.innerWidth - 8);
    expect(top + height).toBeLessThanOrEqual(window.innerHeight - 8);
    expect(portal.getAttribute('role')).toBe('tooltip');
    expect(portal.getAttribute('aria-label')).toContain('$96m');
    expect(portal.style.pointerEvents).toBe('none');
    expect(portal.style.zIndex).toBe('8');
    expect(portal.style.animation).toContain('bp-chart-card-in');
    const style = host.querySelector('style')!.textContent!;
    expect(style).toContain('@media (prefers-reduced-motion:reduce){[data-bp-chart-card]{animation:none!important;transition:none!important}}');
    expect(portal.classList.contains('bp-interaction-card')).toBe(true);
    expect(style).toContain('.bp-interaction-card [data-part="interaction-card"]{forced-color-adjust:none;fill:Canvas;stroke:CanvasText}');
  });

  it('turns the card and the highlight off separately', async () => {
    await render(<ColumnChart {...props} hover={{ card: false }} />);
    pointer(await nodeOf('column', column.data, column.options as object, column.hover!.owner), 'pointermove');
    expect(drawn('interaction-card')).toBe(false);
    expect(drawn('interaction-outline')).toBe(true);
    await render(<ColumnChart {...props} hover={{ highlight: false }} />);
    pointer(await nodeOf('column', column.data, column.options as object, column.hover!.owner), 'pointermove');
    expect(drawn('interaction-card')).toBe(true);
    expect(drawn('interaction-outline')).toBe(false);
  });

  it('hovers a prepared chart after hydration without a second layout', async () => {
    const prepared = JSON.parse(JSON.stringify(await prepareChart({ type: 'column', data: column.data, options: { ...column.options as object, size } })));
    const chart = <ColumnChart {...props} prepared={prepared} hover />;
    host.innerHTML = renderToString(chart);
    const svg = host.querySelector('svg');
    const target = await nodeOf('column', column.data, column.options as object, column.hover!.owner);
    const layout = vi.spyOn(getChart('column')!, 'layout');
    const errors = vi.fn();
    await act(async () => { root = hydrateRoot(host, chart, { onRecoverableError: errors }); await loadHoverEngine(); });
    expect(host.querySelector('svg') === svg).toBe(true);
    pointer(target, 'pointermove');
    expect(card()).toContain('Q3F | Revenue:');
    expect(layout).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });

  it('BoardplotChart takes the bare spec and the same prop', async () => {
    await render(<BoardplotChart spec={{ type: 'column', data: column.data, options: { ...column.options as object, size } }} hover />);
    pointer(await nodeOf('column', column.data, column.options as object, column.hover!.owner), 'pointermove');
    expect(card()).toContain('Q3F | Revenue:');
  });
});

describe('onRecordClick', () => {
  // A drill-down needs the clicked record; before, only a series id reached the host, and only from series parts.
  it('names the clicked mark with hover off, and leaves the legend its series click', async () => {
    const fixture = getFixtures('line').find(entry => entry.id === 'line-near-zero-tails')!;
    const onRecordClick = vi.fn();
    const onSeriesClick = vi.fn();
    await render(<LineChart data={fixture.data as never} {...fixture.options as object} size={size} onRecordClick={onRecordClick} onSeriesClick={onSeriesClick} />);
    const marker = host.querySelector('[data-id^="marker:inbox:"]')!;
    act(() => marker.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const record = onRecordClick.mock.calls[0]![0] as { target: { owner: { seriesId?: string; categoryId?: string } }; value: { raw: unknown } };
    expect(record.target.owner.seriesId).toBe('inbox');
    expect(record.target.owner.categoryId).toBeDefined();
    expect(typeof record.value.raw).toBe('number');
    expect(onSeriesClick).not.toHaveBeenCalled();
    const legend = Array.from(host.querySelectorAll('[data-part="legendLabel"]')).find(node => node.textContent?.startsWith('Owned'))!;
    act(() => legend.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onSeriesClick.mock.calls).toEqual([['owned']]);
    expect(onRecordClick).toHaveBeenCalledTimes(1);
  });
});

/** The caption the card sets in bold: the pointed record's name. */
const pointedCaption = () => Array.from(document.querySelectorAll<HTMLElement>('[data-bp-chart-card] [data-bp-role="caption"]'))
  .find(node => node.style.fontWeight === '600' || node.getAttribute('font-weight') === '600')?.textContent;

describe('near-zero value key', () => {
  // Replacing a shared end label with a value key must keep every member's hover, click and keyboard target.
  it('the near-zero value key addresses every member series', async () => {
    const fixture = getFixtures('line').find(entry => entry.id === 'line-near-zero-tails')!;
    const onSeriesClick = vi.fn();
    await render(<LineChart data={fixture.data as never} {...fixture.options as object} size={size} hover onSeriesClick={onSeriesClick} />);
    for (const [id, member] of [['inbox', 'Inbox'], ['newsfeed', 'Newsfeed'], ['owned', 'Owned']] as const) {
      const label = Array.from(host.querySelectorAll('[data-part="legendLabel"]')).find(node => node.textContent?.startsWith(member))!;
      expect(label).toBeDefined();
      pointer(label, 'pointermove');
      expect(card()).toContain(member);
      // The member's caption is the pointed one, so a key never silently opens the first series' card.
      expect(pointedCaption()).toBe(`${member}:`);
      const markers = Array.from(host.querySelectorAll(`[data-id^="marker:${id}:"]`));
      expect(markers.length).toBeGreaterThan(0);
      expect(markers.every(node => node.getAttribute('opacity') === '0.25')).toBe(false);
      expect(label.getAttribute('role')).toBe('button');
      expect(label.getAttribute('tabindex')).toBe('0');
      pointer(host.querySelector('[data-bp-hover]')!, 'pointerout');
      act(() => label.dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
      expect(pointedCaption()).toBe(`${member}:`);
      act(() => label.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      act(() => label.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
      expect(onSeriesClick.mock.calls.slice(-2)).toEqual([[id], [id]]);
    }
  });

  it('the slope fold Other line has records carrying its derived value', async () => {
    const fixture = getFixtures('slope').find(entry => (entry.options as { foldBelowShare?: number } | undefined)?.foldBelowShare !== undefined)!;
    const options = { ...fixture.options as object, size };
    const prepared = await prepareChart({ type: 'slope', data: fixture.data, options, scope });
    const other = prepared.records!.filter(record => record.seriesLabel === 'Other');
    expect(other).toHaveLength(2);
    for (const record of other) {
      expect(record.value.state).toBe('value');
      expect(typeof record.value.raw).toBe('number');
      expect(record.members!.length).toBeGreaterThan(1);
      expect(record.nodeIds.length).toBe(1);
    }
    await render(<SlopeChart data={fixture.data as never} {...options} hover />);
    pointer(host.querySelector(`[data-id="${other[1]!.nodeIds[0]}"]`)!, 'pointermove');
    expect(card()).toContain('Other');
  });
});

describe('style nonce for the hover surface', () => {
  /** Every `<style` opening tag of a server render, in document order. */
  const styleTags = (html: string) => html.match(/<style\b[^>]*>/g) ?? [];

  it('puts the nonce on every style a column chart with hover renders', async () => {
    const spec = { type: 'column', data: column.data, options: { ...column.options as object, size } };
    // Mounted, not server-rendered: the spec entry draws the busy placeholder
    // until the chunks it asked for are there.
    const html = await mountedMarkup(<BoardplotChart spec={spec} hover styleNonce="abc" />);
    const styles = styleTags(html);
    expect(styles).toHaveLength(1);
    for (const tag of styles) expect(tag).toContain('nonce="abc"');
    // Without the prop the same render carries no nonce attribute at all.
    expect(styleTags(await mountedMarkup(<BoardplotChart spec={spec} hover />))).toEqual(['<style>']);
    // A per-type component renders this surface too: its server style holds the footer's print rules, with the nonce.
    const bare = renderToStaticMarkup(<ColumnChart data={column.data as never} {...column.options as object} size={size} hover styleNonce="abc" />);
    for (const tag of styleTags(bare)) expect(tag).toContain('nonce="abc"');
  });

  it('puts the nonce on every style BoardplotChart renders for a table spec', async () => {
    const table = getFixtures('table').find(fixture => fixture.kind === 'example')!;
    const mounted = document.createElement('div');
    document.body.append(mounted);
    // A mounted table keeps its stylesheet in the document head.
    const root = await mount(<BoardplotChart spec={{ type: 'table', data: table.data, options: { ...table.options as object, size } }} styleNonce="abc" />, mounted);
    const sheet = document.head.querySelector('style[data-bp-table-theme]');
    expect(sheet === null).toBe(false);
    expect(sheet!.getAttribute('nonce')).toBe('abc');
    expect(styleTags(mounted.innerHTML)).toEqual([]);
    await act(async () => { root.unmount(); });
    mounted.remove();
  });
});

describe("the card of a category answers for the whole category", () => {
  const combo = getFixtures("combo").find(fixture => fixture.id === "revenue-units-secondary")!;
  const props = { data: combo.data, ...combo.options as object, size } as unknown as ComponentProps<typeof ComboChart>;

  it("lists the bar series and the line series of the hovered week, the pointed one first", async () => {
    await render(<ComboChart {...props} hover styleNonce="abc" />);
    expect(host.querySelector("style")?.getAttribute("nonce")).toBe("abc");
    const bar = host.querySelector("[data-id^=\"mark:bars:\"]") ?? host.querySelector("[data-id*=\"2019\"][data-part=\"segment\"], [data-id*=\"2019\"]");
    expect(bar, "a bar node of the combo").not.toBeNull();
    pointer(bar!, "pointermove");
    const text = card() ?? "";
    expect(text).toContain("2019");
    expect(text).toContain("Revenue");
    expect(text).toContain("Units sold");
    // Two value rows, one per series, and the category heading first.
    expect(text.indexOf("2019")).toBeLessThan(text.indexOf("Revenue"));
    expect(text.indexOf("Revenue")).toBeLessThan(text.indexOf("Units sold"));
    // Every mark of the category is outlined.
    expect(host.querySelectorAll("[data-part=\"interaction-outline\"]").length).toBeGreaterThanOrEqual(2);
  });
});

describe('hover callback, linked charts and touch', () => {
  const box = { width: 640, height: 360 };
  const regions = (north: number[]) => ({ categories: ['Q1', 'Q2', 'Q3'], series: [{ id: 'north', label: 'North', values: north }, { id: 'south', label: 'South', values: [2, 3, 3] }] });
  const mark = (scope: Element, id: string) => scope.querySelector(`[data-id="mark:${id}"]`)!;
  const outlined = (scope: Element) => [...new Set(Array.from(scope.querySelectorAll('[data-part="interaction-outline"]'), node => JSON.parse(node.getAttribute('data-bp-owner')!).categoryId))].join();
  const cards = () => Array.from(document.querySelectorAll<HTMLElement>('[data-bp-chart-card]')).filter(node => node.style.opacity !== '0')
    .map(node => Array.from(node.querySelectorAll('[data-part="interaction-label"]'), label => label.textContent).join(' | ')).sort();
  /** React reads a pointer leave from the native pointerout. */
  const leave = (target: Element) => {
    const event = new Event('pointerout', { bubbles: true });
    Object.assign(event, { pointerType: 'mouse', clientX: 0, clientY: 0, relatedTarget: document.body });
    act(() => target.dispatchEvent(event));
  };
  /** A finger on `target` at client (x, y), as a browser reports it. */
  const touch = (target: Element, kind: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointerout', at: readonly [number, number], pointerId = 7, isPrimary = true) => {
    const event = new Event(kind, { bubbles: true });
    Object.assign(event, { pointerType: 'touch', pointerId, isPrimary, clientX: at[0], clientY: at[1], relatedTarget: kind === 'pointerout' ? document.body : null });
    target.dispatchEvent(event);
  };
  const point = (id: string) => host.querySelector(`[data-id="marker:${id}"]`)!;
  const at = (node: Element) => [Number(node.getAttribute('cx')), Number(node.getAttribute('cy'))] as const;
  const quarters = { categories: ['Q1', 'Q2', 'Q3', 'Q4'], series: [{ id: 'north', label: 'North', values: [3, 5, 4, 6] }, { id: 'south', label: 'South', values: [2, 3, 3, 4] }] };

  // A page that shows the hovered values in its own panel would stay silent with card and highlight off, or keep old values after a data refresh under a resting pointer.
  it('tells a listening page each change of the hovered records, also with card and highlight off', async () => {
    const calls: InteractionRecord[][] = [];
    const chart = (north: number[], hover: boolean | object = { card: false, highlight: false }) =>
      <ColumnChart data={regions(north)} size={box} hover={hover as never} onHoverChange={records => calls.push(records)} />;
    await render(chart([3, 5, 4]));
    pointer(mark(host, 'north:Q2'), 'pointermove');
    expect(calls.map(records => records.map(record => record.value?.raw))).toEqual([[5, 3]]);
    pointer(mark(host, 'north:Q2'), 'pointermove');
    expect(calls).toHaveLength(1);
    expect(host.querySelector('[data-part="interaction-outline"]')).toBeNull();
    await render(chart([3, 9, 4]));
    expect(calls.map(records => records[0]?.value?.raw)).toEqual([5, 9]);
    await render(chart([3, 9, 4], false));
    expect(calls.map(records => records.length)).toEqual([2, 2, 0]);
  });

  // The late clear of the chart the reader left would erase the hover of the chart they are on.
  it('keeps the hover of the chart the reader entered when the chart they left clears late', async () => {
    vi.useFakeTimers();
    try {
      const ranked = (values: number[]) => ({ categories: ['A', 'B', 'C', 'D'], series: [{ id: 'v', label: 'Value', values }] });
      await render(<HoverGroup>
        <div id="one"><ColumnChart data={regions([3, 5, 4])} size={box} /></div>
        <div id="two"><ColumnChart data={regions([6, 7, 8])} size={box} /></div>
        <div id="three"><BarChart data={ranked([9, 8, 2, 1])} topN={{ n: 2 }} size={box} /></div>
        <div id="four"><BarChart data={ranked([1, 2, 8, 9])} topN={{ n: 2 }} size={box} /></div>
      </HoverGroup>);
      const [one, two, three, four] = ['#one', '#two', '#three', '#four'].map(id => host.querySelector(id)!) as [Element, Element, Element, Element];
      pointer(mark(one, 'north:Q2'), 'pointermove');
      // Each other chart shows its own number beside the same category.
      expect(outlined(two)).toBe('Q2');
      expect(cards()).toEqual(['Q2 | North: | 5 | South: | 3', 'Q2 | North: | 7']);
      // The reader moves to the same category of the second chart. The first chart closes 100 ms later.
      leave(one.querySelector('[data-bp-hover]')!);
      pointer(mark(two, 'north:Q2'), 'pointermove');
      act(() => { vi.advanceTimersByTime(150); });
      act(() => { vi.advanceTimersByTime(600); });
      expect(cards()).toEqual(['Q2 | North: | 5', 'Q2 | North: | 7 | South: | 3']);
      expect(outlined(one)).toBe('Q2');
      // The Others bar of one ranked chart holds other categories than the Others bar of the next: it is never linked.
      leave(two.querySelector('[data-bp-hover]')!);
      act(() => { vi.advanceTimersByTime(750); });
      expect(outlined(one) + outlined(two)).toBe('');
      const others = three.querySelector('[data-id*="others"]')!;
      pointer(others, 'pointermove');
      expect(outlined(three)).not.toBe('');
      expect(outlined(four)).toBe('');
      leave(three.querySelector('[data-bp-hover]')!);
      act(() => { vi.advanceTimersByTime(750); });
      expect(outlined(three)).toBe('');
      expect(cards()).toEqual([]);
    } finally { vi.useRealTimers(); }
  });

  // A variance category lists the series it sums as its members, and was taken for an Others bucket that never links.
  it('links a category that sums several series', async () => {
    const variance = { categories: ['Q1', 'Q2', 'Q3'], series: [{ id: 'north', label: 'North', values: [3, 5, 4] }, { id: 'south', label: 'South', values: [2, 3, 3] },
      { id: 'plan', label: 'Plan', values: [4, 9, 6], role: 'reference' as const }] };
    await render(<HoverGroup>
      <div id="one"><ColumnChart data={regions([3, 5, 4])} size={box} /></div>
      <div id="two"><VarianceChart data={variance} variant="absolute" variance={{ vs: 'plan' }} size={box} /></div>
    </HoverGroup>);
    pointer(mark(host.querySelector('#one')!, 'north:Q2'), 'pointermove');
    expect(outlined(host.querySelector('#two')!)).toBe('Q2');
  });

  // A page that stores the hovered records in its state rendered the chart again, and a column drawn as bars reported the same hover again on each render: a loop.
  it('reports a hover once on a column drawn as bars whose page keeps the records in its state', async () => {
    const names = Array.from({ length: 20 }, (_, i) => `Sector number ${i + 1} of the survey`);
    const sectors = { categories: names.map((label, i) => ({ id: `c${i}`, label })), series: [{ id: 's', label: 'Margin', values: names.map((_, i) => 8 + ((i * 7) % 23)) }] };
    let calls = 0;
    function Page() {
      const [records, setRecords] = useState<InteractionRecord[]>([]);
      return <><ColumnChart data={sectors} size={{ width: 320 }} onHoverChange={next => { calls++; setRecords(next); }} /><p>{records.length}</p></>;
    }
    await render(<Page />);
    expect(host.querySelector('svg')!.getAttribute('data-bp-chart')).toBe('bar');
    pointer(host.querySelector('[data-id^="mark:"]')!, 'pointermove');
    expect(calls).toBe(1);
  });

  // Two charts side by side in a group: a chart away from the window's left edge read the pointer at another category, a tap on the category another chart had linked closed both cards, and a tap outside left a card open.
  it('reads the pointer and the taps of a chart in a group at its place on the page', async () => {
    const left = 700;
    vi.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: SVGSVGElement) {
      const [, , width = 0, height = 0] = (this.getAttribute('viewBox') ?? '').split(' ').map(Number);
      const x = this.closest('#two') ? left : 0;
      return { x, y: 0, left: x, top: 0, right: x + width, bottom: height, width, height, toJSON() {} };
    });
    await render(<HoverGroup>
      <div id="one"><ColumnChart data={regions([3, 5, 4])} size={box} /></div>
      <div id="two"><ColumnChart data={{ categories: ['Q1', 'Q2', 'Q3'], series: [{ id: 'north', label: 'North', values: [6, 7, 8] }] }} size={box} /></div>
    </HoverGroup>);
    const [one, two] = ['#one', '#two'].map(id => host.querySelector(id)!) as [Element, Element];
    const tap = (target: Element, x: number, y: number) => {
      const event = new Event('pointerdown', { bubbles: true });
      Object.assign(event, { pointerType: 'touch', pointerId: 3, isPrimary: true, clientX: x, clientY: y });
      act(() => target.dispatchEvent(event));
    };
    const at = (node: Element, x = 0) => [Number(node.getAttribute('x')) + Number(node.getAttribute('width')) / 2 + x, Number(node.getAttribute('y')) + Number(node.getAttribute('height')) - 2] as const;
    // A point on the Q1 bar of chart two, read by its position alone.
    move(two.querySelector('[data-bp-hover]')!, at(mark(two, 'north:Q1'), left)[0], at(mark(two, 'north:Q1'))[1]);
    expect(outlined(one)).toBe('Q1');
    leave(two.querySelector('[data-bp-hover]')!);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)); });
    tap(mark(one, 'north:Q2'), ...at(mark(one, 'north:Q2')));
    expect(cards()).toEqual(['Q2 | North: | 5 | South: | 3', 'Q2 | North: | 7']);
    // A tap on the linked category of chart two makes that chart's hover its own.
    tap(mark(two, 'north:Q2'), at(mark(two, 'north:Q2'))[0] + left, at(mark(two, 'north:Q2'))[1]);
    expect(cards()).toEqual(['Q2 | North: | 5', 'Q2 | North: | 7']);
    tap(document.body, 5, 900);
    expect(cards()).toEqual([]);
  });

  // A pinch on a line chart would move the card to the point under the second finger.
  it('ignores a second finger while a finger slides along a line', async () => {
    await render(<LineChart data={quarters} size={box} />);
    const wrapper = host.querySelector<HTMLElement>('[data-bp-hover]')!;
    expect(wrapper.style.touchAction).toBe('pan-y pinch-zoom');
    act(() => touch(point('north:Q1'), 'pointerdown', at(point('north:Q1'))));
    act(() => touch(point('north:Q1'), 'pointermove', at(point('north:Q2'))));
    expect(cards()[0]).toMatch(/^Q2 /);
    act(() => touch(point('north:Q4'), 'pointerdown', at(point('north:Q4')), 8, false));
    act(() => { touch(point('north:Q4'), 'pointermove', at(point('north:Q4')), 8, false); touch(point('north:Q1'), 'pointermove', at(point('north:Q3'))); });
    expect(cards()[0]).toMatch(/^Q2 /);
    // The scrub's touch rule rides only with the hover: a drill-down chart keeps the page's own gestures.
    await render(<LineChart data={quarters} size={box} hover={false} onRecordClick={() => {}} />);
    expect(host.querySelector<HTMLElement>('svg')!.closest<HTMLElement>('[data-bp-hover]')?.style.touchAction ?? '').toBe('');
  });

  // A tap that lifts before the hover code is used stayed tracked as the sliding finger, and the next tap counted as a second finger.
  it('keeps the next tap on a line after a tap that lifted before the hover code was used', async () => {
    act(() => { root = createRoot(host); root.render(<LineChart data={quarters} size={box} />); });
    const first = point('north:Q2'), second = point('north:Q4');
    act(() => { touch(first, 'pointerdown', at(first)); touch(first, 'pointerup', at(first)); touch(host.querySelector('[data-bp-hover]')!, 'pointerout', at(first)); });
    await act(async () => { await loadHoverEngine(); });
    expect(cards()[0]).toMatch(/^Q2 /);
    act(() => touch(second, 'pointerdown', at(second)));
    expect(cards()[0]).toMatch(/^Q4 /);
  });
});
