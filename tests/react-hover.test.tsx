// @vitest-environment jsdom
import './helpers/hover-viewport';
import { act, type ComponentProps } from 'react';
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
import { mount, mountedMarkup } from './helpers/spec-chunks';
import { loadHoverEngine } from '../src/react/useHover';

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

/** The drawn node of one record, found through the records the server would prepare. */
async function nodeOf(type: string, data: unknown, options: object, owner: object): Promise<Element> {
  const prepared = await prepareChart({ type, data, options: { ...options, size }, scope });
  const record = prepared.records!.find(entry => entry.id === targetId({ ...scope, owner }))!;
  return host.querySelector(`[data-id="${record.nodeIds[0]}"]`)!;
}

function drawn(part: string): boolean {
  return (part === 'interaction-card' ? document : host).querySelector(`[data-part="${part}"]`) !== null;
}

function card(): string | undefined {
  const texts = Array.from(document.querySelectorAll('[data-bp-chart-card] [data-part="interaction-label"]')).map(node => node.textContent ?? '');
  return texts.length ? texts.join(' | ') : undefined;
}

describe('hover card and highlight on a column fixture', () => {
  const props = { data: column.data, ...column.options as object, size } as unknown as ComponentProps<typeof ColumnChart>;

  it('shows the card with the hovered record facts and dims the other marks', async () => {
    await render(<ColumnChart {...props} hover />);
    const target = await nodeOf('column', column.data, column.options as object, column.hover!.owner);
    expect(card()).toBeUndefined();
    pointer(target, 'pointermove');
    expect(drawn('interaction-card')).toBe(true);
    expect(card()).toContain('Q3F / Revenue');
    expect(card()).toContain('$96m');
    expect(card()).toContain('low: | $89m');
    expect(drawn('interaction-outline')).toBe(true);
    pointer(host.querySelector('[data-bp-hover]')!, 'pointerout');
    expect(drawn('interaction-card')).toBe(false);
    expect(drawn('interaction-outline')).toBe(false);
  });

  // A tap leaves no pointer to move away: without this, a card opened by a tap stayed open after a tap elsewhere on the page.
  it('closes a card opened by a tap when the reader taps outside the chart', async () => {
    await render(<ColumnChart {...props} hover />);
    pointer(await nodeOf('column', column.data, column.options as object, column.hover!.owner), 'pointerdown', 'touch');
    expect(drawn('interaction-card')).toBe(true);
    pointer(document.body, 'pointerdown', 'touch');
    expect(drawn('interaction-card')).toBe(false);
  });

  it('draws the static chart without the prop and the same SVG before any pointer input', async () => {
    const plain = renderToString(<ColumnChart {...props} />);
    const hovered = renderToString(<ColumnChart {...props} hover />);
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
    expect(parseFloat(portal.style.left)).toBeGreaterThanOrEqual(8);
    expect(parseFloat(portal.style.top)).toBeGreaterThanOrEqual(8);
    expect(parseFloat(portal.style.left) + width).toBeLessThanOrEqual(window.innerWidth - 8);
    expect(parseFloat(portal.style.top) + height).toBeLessThanOrEqual(window.innerHeight - 8);
    expect(portal.getAttribute('role')).toBe('tooltip');
    expect(portal.getAttribute('aria-label')).toContain('$96m');
    expect(portal.style.pointerEvents).toBe('none');
    expect(portal.style.zIndex).toBe('8');
    expect(portal.style.animation).toContain('bp-chart-card-in');
    const style = host.querySelector('style')!.textContent!;
    expect(style).toContain('@media (prefers-reduced-motion:reduce){[data-bp-chart-card]{animation:none!important}}');
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
    expect(card()).toContain('Q3F / Revenue');
    expect(layout).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });

  it('BoardplotChart takes the bare spec and the same prop', async () => {
    await render(<BoardplotChart spec={{ type: 'column', data: column.data, options: { ...column.options as object, size } }} hover />);
    pointer(await nodeOf('column', column.data, column.options as object, column.hover!.owner), 'pointermove');
    expect(card()).toContain('Q3F / Revenue');
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
      // The member's caption is first, so a key never silently opens the first series' card.
      expect(document.querySelector('[data-bp-chart-card] [data-bp-role="caption"]')?.textContent).toBe(member);
      const markers = Array.from(host.querySelectorAll(`[data-id^="marker:${id}:"]`));
      expect(markers.length).toBeGreaterThan(0);
      expect(markers.every(node => node.getAttribute('opacity') === '0.25')).toBe(false);
      expect(label.getAttribute('role')).toBe('button');
      expect(label.getAttribute('tabindex')).toBe('0');
      pointer(host.querySelector('[data-bp-hover]')!, 'pointerout');
      act(() => label.dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
      expect(document.querySelector('[data-bp-chart-card] [data-bp-role="caption"]')?.textContent).toBe(member);
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
    // A per-type component renders this surface too; without the statically
    // provided engine it draws no style on the server, so no tag can lack one.
    const bare = renderToStaticMarkup(<ColumnChart data={column.data as never} {...column.options as object} size={size} hover styleNonce="abc" />);
    expect(styleTags(bare)).toEqual([]);
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
