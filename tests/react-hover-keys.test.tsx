// @vitest-environment jsdom
import './helpers/hover-viewport';
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/core/charts';
import type { InteractionRecord } from '../src/core/a11y/types';
import { getFixtures } from '../src/fixtures';
import { ColumnChart } from '../src/react/charts/column';
import { LineChart } from '../src/react/charts/line';
import { ScatterChart } from '../src/react/charts/scatter';
import { HeatmapChart } from '../src/react/charts/heatmap';
import { BarChart } from '../src/react/charts/bar';
import { DiagramChart } from '../src/react/charts/diagram';
import { TableChart } from '../src/react/TableChart';
import { loadHoverEngine } from '../src/react/useHover';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

/**
 * Keyboard access to chart records (WCAG 2.1.1): one tab stop per chart,
 * arrows in reading order, the pointer's card on focus, Enter as the click.
 */
const size = { width: 800, height: 450 };
const fixture = (type: string) => getFixtures(type).find(entry => entry.kind === 'example')!;

let host: HTMLDivElement;
let root: Root | undefined;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); });
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; host.remove(); vi.restoreAllMocks(); });

async function render(element: React.ReactElement) {
  root ??= createRoot(host);
  await act(async () => { root!.render(element); await loadHoverEngine(); });
}

function keyStop(): HTMLElement { return host.querySelector<HTMLElement>('[data-bp-keys]')!; }
function press(target: Element, key: string) {
  act(() => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
}
function option(): string | undefined { return host.querySelector('[data-bp-keys] [role="option"]')?.textContent ?? undefined; }
function card(): string | undefined {
  const texts = Array.from(document.querySelectorAll('[data-bp-chart-card] [data-part="interaction-label"]')).map(node => node.textContent ?? '');
  return texts.length ? texts.join(' | ') : undefined;
}

/** The owners the arrow keys reach, read through Enter on every step. */
function readingOrder(onRecordClick: ReturnType<typeof vi.fn>, count: number): string[] {
  const stop = keyStop();
  act(() => stop.focus());
  press(stop, 'Home');
  for (let step = 0; step < count; step++) {
    press(stop, 'Enter');
    press(stop, 'ArrowRight');
  }
  return onRecordClick.mock.calls.map(([record]) => {
    const { categoryId, seriesId, pointId } = (record as InteractionRecord).target.owner;
    return [categoryId, seriesId, pointId].filter(part => part !== undefined).join('/');
  });
}

describe('keyboard access to chart records', () => {
  const column = fixture('column');
  const columnProps = { data: column.data, ...column.options as object, size } as unknown as ComponentProps<typeof ColumnChart>;

  // A keyboard reader could not reach a value or a drill-down: data marks had no tab stop.
  it('gives a hover chart one tab stop that opens the card on focus and closes it on leaving', async () => {
    await render(<ColumnChart {...columnProps} hover />);
    const stops = host.querySelectorAll('[tabindex="0"]');
    expect(stops).toHaveLength(1);
    const stop = keyStop();
    expect(stop.getAttribute('role')).toBe('listbox');
    expect(host.querySelector('svg')!.getAttribute('role')).toBe('img');
    act(() => stop.focus());
    expect(card()).toContain('Q1 AC / Revenue');
    expect(option()).toContain('Q1');
    expect(stop.getAttribute('aria-activedescendant')).toBe(host.querySelector('[role="option"]')!.id);
    expect(host.querySelector('[data-part="interaction-outline"]')).not.toBeNull();
    act(() => stop.blur());
    expect(card()).toBeUndefined();
    expect(option()).toBeUndefined();
  });

  // A keyboard card stayed pinned at the screen edge after its record scrolled away.
  it('keeps a keyboard card at its record when the record scrolls out of the viewport', async () => {
    await render(<ColumnChart {...columnProps} hover />);
    act(() => keyStop().focus());
    const top = () => parseFloat(document.querySelector<HTMLElement>('[data-bp-chart-card]')!.style.top);
    const opened = top();
    vi.mocked(SVGSVGElement.prototype.getBoundingClientRect).mockImplementation(() =>
      ({ x: 0, y: -2000, left: 0, top: -2000, right: 800, bottom: -1550, width: 800, height: 450, toJSON() {} }));
    act(() => { window.dispatchEvent(new Event('scroll')); });
    await act(() => new Promise(resolve => requestAnimationFrame(() => resolve(undefined))));
    // Before the fix the card stayed in the viewport, 2,000 px away from its record.
    expect(Math.abs(top() - (opened - 2000))).toBeLessThan(20);
  });

  // A static chart must stay out of the tab order.
  it('adds no tab stop to a chart with hover off', async () => {
    await render(<ColumnChart {...columnProps} />);
    expect(host.querySelector('[data-bp-keys]')).toBeNull();
  });

  // Arrow keys must follow the documented reading order, not the raw record order.
  it('steps a column chart by category and fires onRecordClick on Enter with the keyboard event', async () => {
    const onRecordClick = vi.fn();
    await render(<ColumnChart {...columnProps} hover onRecordClick={onRecordClick} />);
    expect(readingOrder(onRecordClick, 5)).toEqual(['q1/revenue', 'q2/revenue', 'q3/revenue', 'q4/revenue', 'fy27/revenue']);
    expect(onRecordClick.mock.calls[0]![1].type).toBe('keydown');
    press(keyStop(), 'End');
    expect(keyStop().querySelector('[role="option"]')!.getAttribute('aria-posinset')).toBe('5');
  });

  // A reader must reach another series at the same month without traversing its 24 months, and Up must reach the line drawn above.
  it('moves along a line series horizontally and to the line drawn above or below, including missing values', async () => {
    const data = { categories: Array.from({ length: 24 }, (_, i) => ({ id: `m${i}` })), series: [
      { id: 'revenue', label: 'Revenue', values: Array.from({ length: 24 }, (_, i) => 90 + i) },
      { id: 'plan', label: 'Plan', values: Array.from({ length: 24 }, (_, i) => i === 2 ? null : 110 + i) },
      { id: 'prior', label: 'Prior', values: Array.from({ length: 24 }, (_, i) => 70 + i) },
    ] };
    const onRecordClick = vi.fn();
    await render(<LineChart data={data} size={size} hover onRecordClick={onRecordClick} />);
    const stop = keyStop();
    act(() => stop.focus());
    for (const key of ['ArrowRight', 'ArrowRight', 'ArrowUp', 'Enter', 'ArrowDown', 'ArrowDown', 'Enter', 'ArrowLeft', 'Enter', 'ArrowUp', 'Enter', 'ArrowUp', 'Enter']) press(stop, key);
    // Plan is drawn on top, Revenue in the middle, Prior at the bottom; the missing Plan value sits on its gap.
    expect(onRecordClick.mock.calls.map(([record]) => record.target.owner)).toEqual([
      { categoryId: 'm2', seriesId: 'plan' }, { categoryId: 'm2', seriesId: 'prior' },
      { categoryId: 'm1', seriesId: 'prior' }, { categoryId: 'm1', seriesId: 'revenue' }, { categoryId: 'm1', seriesId: 'plan' },
    ]);
    expect(onRecordClick.mock.calls[0]![0].value.state).toBe('missing');
    expect(stop.getAttribute('role')).toBe('listbox');
    expect(stop.getAttribute('aria-activedescendant')).toBe(stop.querySelector('[role="option"]')!.id);
    press(stop, 'Home');
    press(stop, 'ArrowLeft');
    expect(stop.querySelector('[role="option"]')!.getAttribute('aria-posinset')).toBe('1');
    press(stop, 'End');
    expect(stop.querySelector('[role="option"]')!.getAttribute('aria-posinset')).toBe('72');
    press(stop, 'ArrowRight');
    expect(stop.querySelector('[role="option"]')!.getAttribute('aria-posinset')).toBe('72');
  });

  // A stacked segment must keep its series, Up must reach the segment drawn above, and Home must start at the leftmost bar of a sorted axis.
  it('moves between stacked column segments as drawn without wrapping at an edge', async () => {
    const data = { categories: ['Jan', 'Feb', 'Mar'].map(id => ({ id })), series: [
      { id: 'base', values: [10, 12, 14] }, { id: 'top', values: [5, 6, 7] },
    ] };
    const onRecordClick = vi.fn();
    await render(<ColumnChart data={data} variant="stacked" unit="$" size={size} hover onRecordClick={onRecordClick} />);
    const stop = keyStop();
    act(() => stop.focus());
    for (const key of ['ArrowRight', 'Enter', 'ArrowUp', 'Enter', 'ArrowLeft', 'ArrowLeft', 'Enter', 'ArrowDown', 'Enter', 'ArrowDown', 'Enter']) press(stop, key);
    expect(onRecordClick.mock.calls.map(([record]) => record.target.owner)).toEqual([
      { categoryId: 'Feb', seriesId: 'base' }, { categoryId: 'Feb', seriesId: 'top' },
      { categoryId: 'Jan', seriesId: 'top' }, { categoryId: 'Jan', seriesId: 'base' }, { categoryId: 'Jan', seriesId: 'base' },
    ]);
    await render(<ColumnChart data={data} variant="stacked" unit="$" sort={{ categories: 'desc' }} size={size} hover onRecordClick={onRecordClick} />);
    onRecordClick.mockClear();
    press(stop, 'Home');
    for (const key of ['Enter', 'ArrowRight', 'Enter', 'ArrowRight', 'Enter', 'ArrowUp', 'Enter']) press(stop, key);
    expect(onRecordClick.mock.calls.map(([record]) => record.target.owner)).toEqual([
      { categoryId: 'Mar', seriesId: 'base' }, { categoryId: 'Feb', seriesId: 'base' },
      { categoryId: 'Jan', seriesId: 'base' }, { categoryId: 'Jan', seriesId: 'top' },
    ]);
    expect(stop.querySelector('[role="option"]')!.getAttribute('aria-posinset')).toBe('6');
  });

  // On horizontal bars the categories run down the screen: Down must reach the next bar and Right the next segment.
  it('moves down horizontal stacked bars and right along their segments', async () => {
    const data = { categories: ['North', 'South'].map(id => ({ id })), series: [{ id: 'base', values: [10, 12] }, { id: 'top', values: [5, 6] }] };
    const onRecordClick = vi.fn();
    await render(<BarChart data={data} variant="stacked" size={size} hover onRecordClick={onRecordClick} />);
    const stop = keyStop();
    act(() => stop.focus());
    for (const key of ['ArrowDown', 'Enter', 'ArrowRight', 'Enter', 'ArrowUp', 'Enter']) press(stop, key);
    expect(onRecordClick.mock.calls.map(([record]) => record.target.owner)).toEqual([
      { categoryId: 'South', seriesId: 'base' }, { categoryId: 'South', seriesId: 'top' }, { categoryId: 'North', seriesId: 'top' },
    ]);
  });

  // Nearest-point arrows left points no arrow reached; Left/Right now step through drawn x, Up/Down through points at one x first.
  it('moves a scatter by drawn x and keeps every point reachable', async () => {
    const points = [
      { id: 'left', x: 0, y: 5 }, { id: 'decoy', x: 0.1, y: 10 }, { id: 'centre', x: 0.4, y: 5 },
      { id: 'high', x: 0.4, y: 8 }, { id: 'low', x: 0.4, y: 1 }, { id: 'right', x: 8, y: 5 },
    ];
    const onRecordClick = vi.fn();
    await render(<ScatterChart data={{ points }} size={{ width: 600, height: 600 }} hover onRecordClick={onRecordClick} />);
    const stop = keyStop();
    act(() => stop.focus());
    for (const key of ['ArrowRight', 'Enter', 'ArrowRight', 'Enter', 'ArrowDown', 'Enter', 'ArrowDown', 'Enter', 'ArrowUp', 'ArrowUp', 'ArrowRight', 'Enter', 'ArrowLeft', 'Enter']) press(stop, key);
    expect(onRecordClick.mock.calls.map(([record]) => record.target.owner.pointId)).toEqual(['decoy', 'high', 'centre', 'low', 'right', 'centre']);
    press(stop, 'Home');
    press(stop, 'ArrowLeft');
    press(stop, 'Enter');
    expect(onRecordClick.mock.calls.at(-1)![0].target.owner.pointId).toBe('left');
    press(stop, 'End');
    press(stop, 'Enter');
    expect(onRecordClick.mock.calls.at(-1)![0].target.owner.pointId).toBe('right');
  });

  // A scatter record filtered out of the drawing must not trap focus before the visible points.
  it('keeps list access to scatter records without a drawn position', async () => {
    const points = [
      { id: 'hidden-a', x: 0, y: 0, count: 0 }, { id: 'hidden-b', x: 1, y: 1, count: 0 },
      { id: 'visible-a', x: 2, y: 2, count: 10 }, { id: 'hidden-c', x: 2.5, y: 2.5, count: 0 },
      { id: 'visible-b', x: 3, y: 3, count: 10 },
    ];
    const onRecordClick = vi.fn();
    await render(<ScatterChart data={{ points }} minCount={1} size={size} hover onRecordClick={onRecordClick} />);
    const stop = keyStop();
    act(() => stop.focus());
    for (let i = 0; i < 4; i++) { press(stop, 'ArrowRight'); press(stop, 'Enter'); }
    expect(onRecordClick.mock.calls.map(([record]) => record.target.owner.pointId)).toEqual(['hidden-b', 'visible-a', 'hidden-c', 'visible-b']);
  });

  // Coincident scatter points must each stay reachable instead of one always winning the distance tie.
  it('reads coincident scatter points with Left and Right before moving away', async () => {
    const points = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 0, y: 0 }, { id: 'c', x: 1, y: 1 }];
    const onRecordClick = vi.fn();
    await render(<ScatterChart data={{ points }} size={size} hover onRecordClick={onRecordClick} />);
    const stop = keyStop();
    act(() => stop.focus());
    for (const key of ['ArrowRight', 'Enter', 'ArrowLeft', 'Enter', 'ArrowRight', 'ArrowRight', 'Enter']) press(stop, key);
    expect(onRecordClick.mock.calls.map(([record]) => record.target.owner.pointId)).toEqual(['b', 'a', 'c']);
  });

  // A heatmap arrow must move one row or column without stepping through the whole row.
  it('moves a heatmap by its drawn rows and columns and stops at their edges', async () => {
    const data = { categories: ['Jan', 'Feb', 'Mar'].map(id => ({ id })), series: [
      { id: 'north', values: [1, 2, 3] }, { id: 'south', values: [4, 5, 6] },
    ] };
    const onRecordClick = vi.fn();
    await render(<HeatmapChart data={data} size={size} hover onRecordClick={onRecordClick} />);
    const stop = keyStop();
    act(() => stop.focus());
    for (const key of ['ArrowRight', 'Enter', 'ArrowDown', 'Enter', 'ArrowDown', 'Enter', 'ArrowLeft', 'Enter', 'ArrowUp', 'Enter']) press(stop, key);
    expect(onRecordClick.mock.calls.map(([record]) => record.target.owner)).toEqual([
      { categoryId: 'Feb', seriesId: 'north' }, { categoryId: 'Feb', seriesId: 'south' },
      { categoryId: 'Feb', seriesId: 'south' }, { categoryId: 'Jan', seriesId: 'south' },
      { categoryId: 'Jan', seriesId: 'north' },
    ]);
  });

  // A heatmap that draws its categories as rows stranded 70 of 72 cells: arrows must follow drawn rows, not series ids.
  it('reaches every cell of a heatmap whose rows are categories', async () => {
    const selected = getFixtures('heatmap').find(entry => entry.id === 'survey-journey-long-names')!;
    const onRecordClick = vi.fn();
    await render(<HeatmapChart data={selected.data as never} {...selected.options as object} hover onRecordClick={onRecordClick} />);
    const stop = keyStop();
    act(() => stop.focus());
    for (const key of ['ArrowRight', 'Enter', 'ArrowDown', 'Enter']) press(stop, key);
    const [right, down] = onRecordClick.mock.calls.map(([record]) => (record as InteractionRecord).target.owner);
    expect(right!.categoryId).toBe('t1');
    expect(down!.seriesId).toBe(right!.seriesId);
    expect(down!.categoryId).not.toBe('t1');
  });

  // A fully printed diagram node has no card, and so it could not be clicked or focused: activation must not depend on the card.
  it('activates a diagram node with no card fields by pointer and keyboard', async () => {
    const data = { nodes: [
      { id: 'review', kind: 'step', shape: { kind: 'rectangle' }, label: 'Review' },
      { id: 'deliver', kind: 'step', shape: { kind: 'rectangle' }, label: 'Deliver' },
    ], edges: [{ id: 'edge', source: { nodeId: 'review' }, target: { nodeId: 'deliver' } }] };
    const onRecordClick = vi.fn();
    // The keyboard order first built without a callback must take the nodes in once the callback arrives.
    await render(<DiagramChart data={data as never} variant="linear-process" size={{ width: 800, height: 350 }} hover />);
    act(() => keyStop().focus());
    act(() => keyStop().blur());
    await render(<DiagramChart data={data as never} variant="linear-process" size={{ width: 800, height: 350 }} hover onRecordClick={onRecordClick} />);
    const node = Array.from(host.querySelectorAll('[data-id]')).find(element => element.getAttribute('data-id')!.includes('review') && element.tagName !== 'text')!;
    act(() => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const stop = keyStop();
    act(() => stop.focus());
    press(stop, 'ArrowRight');
    press(stop, 'Enter');
    expect(onRecordClick.mock.calls.map(([record, event]) => [(record as InteractionRecord).target.owner.pointId, event.type])).toEqual([['review', 'click'], ['deliver', 'keydown']]);
  });

  // The last line point listed its trend legend entry, so the keyboard ring went to the legend swatch instead of the point.
  it('rings the line point, not its legend swatch, on the last point of a trend line', async () => {
    const data = { categories: ['First', 'Second', 'Third'].map(id => ({ id })), series: [{ id: 'output', label: 'Output', values: [10, 20, 30], marker: 'none' as const }] };
    await render(<LineChart data={data} trend size={{ width: 800, height: 400 }} hover />);
    const stop = keyStop();
    act(() => stop.focus());
    press(stop, 'End');
    const outlines = Array.from(host.querySelectorAll('[data-part="interaction-outline"]')).map(element => element.getAttribute('data-id'));
    expect(outlines.some(id => id?.startsWith('interaction:vertex:'))).toBe(true);
    expect(outlines.some(id => id?.includes('swatch') || id?.includes('legendLabel'))).toBe(false);
  });

  // Enter fired onRecordClick for a value line while a click on it did not: one rule for both inputs, annotations are read, not activated.
  it('reads a value line with the keyboard but activates it with neither input', async () => {
    const onRecordClick = vi.fn();
    await render(<ColumnChart data={{ categories: ['North', 'South'].map(id => ({ id })), series: [{ id: 'sales', values: [10, 20] }] }}
      annotations={[{ kind: 'valueLine', id: 'goal', value: 15, label: 'Goal' }] as never} size={size} hover onRecordClick={onRecordClick} />);
    const stop = keyStop();
    act(() => stop.focus());
    press(stop, 'End');
    expect(option()).toContain('Goal');
    press(stop, 'Enter');
    press(stop, 'Home');
    press(stop, 'Enter');
    expect(onRecordClick.mock.calls.map(([record]) => (record as InteractionRecord).target.owner)).toEqual([{ categoryId: 'North', seriesId: 'sales' }]);
  });

  // Escape must close the card without throwing the reader out of the chart.
  it('closes the card on Escape, keeps the focus, and opens it again on the next arrow', async () => {
    await render(<ColumnChart {...columnProps} hover />);
    const stop = keyStop();
    act(() => stop.focus());
    press(stop, 'ArrowRight');
    expect(card()).toContain('Q2 AC');
    press(stop, 'Escape');
    expect(card()).toBeUndefined();
    expect(document.activeElement).toBe(stop);
    expect(option()).toContain('Q2 AC');
    press(stop, 'ArrowRight');
    expect(card()).toContain('Q3F');
  });

  // A data refresh dropped the reader back to the first record or closed the card.
  it('keeps the focused record across a data update, else the record at its place', async () => {
    await render(<ColumnChart {...columnProps} hover />);
    act(() => keyStop().focus());
    press(keyStop(), 'ArrowRight');
    press(keyStop(), 'ArrowRight');
    expect(card()).toContain('Q3F /');
    const data = column.data as { categories: unknown[]; series: { values: unknown[] }[] };
    const bumped = { ...data, series: data.series.map(series => ({ ...series, values: series.values.map(value => typeof value === 'number' ? value + 1 : value) })) };
    await render(<ColumnChart {...{ ...columnProps, data: bumped } as typeof columnProps} hover />);
    expect(document.activeElement).toBe(keyStop());
    expect(card()).toContain('Q3F /');
    const fewer = { ...data, categories: data.categories.slice(0, 2), series: data.series.map(series => ({ ...series, values: series.values.slice(0, 2) })) };
    await render(<ColumnChart {...{ ...columnProps, data: fewer } as typeof columnProps} hover />);
    expect(card()).toContain('Q2 AC /');
  });

  // The pointer and the keyboard fought over one card: the last input must win.
  it('lets a pointer move take the card over from the keyboard', async () => {
    await render(<ColumnChart {...columnProps} hover />);
    act(() => keyStop().focus());
    expect(host.querySelector('[data-bp-keyed]')).not.toBeNull();
    const event = new Event('pointermove', { bubbles: true });
    Object.assign(event, { pointerType: 'mouse', clientX: 0, clientY: 0 });
    act(() => host.querySelector('svg')!.dispatchEvent(event));
    expect(host.querySelector('[data-bp-keyed]')).toBeNull();
    // Enter fires for the keyboard's record, so the card returns to that record.
    press(keyStop(), 'Enter');
    expect(host.querySelector('[data-bp-keyed]')).not.toBeNull();
    expect(card()).toContain('Q1 AC');
  });

  // The pointer's 150 ms close timer must not close a card that the keyboard has just opened.
  it('keeps the card open when keyboard use starts during the pointer leave grace', async () => {
    const column = fixture('column');
    const columnProps = { data: column.data, ...column.options as object, size } as unknown as ComponentProps<typeof ColumnChart>;
    await render(<ColumnChart {...columnProps} renderHoverContent={(_record, { defaultContent }) => defaultContent} />);
    vi.useFakeTimers();
    try {
      const stop = keyStop();
      act(() => stop.focus());
      const surface = host.querySelector('[data-bp-hover]')!;
      act(() => surface.dispatchEvent(Object.assign(new Event('pointerout', { bubbles: true }), { pointerType: 'mouse', relatedTarget: document.body })));
      act(() => vi.advanceTimersByTime(50));
      press(stop, 'ArrowRight');
      const cardText = () => document.querySelector('[data-bp-custom-card]')?.textContent;
      const selected = cardText();
      expect(selected).toBeDefined();
      act(() => vi.advanceTimersByTime(150));
      expect(cardText()).toBe(selected);
      expect(document.activeElement).toBe(stop);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('keyboard access to table records', () => {
  // The table grid moved the focus, but its card and row highlight followed the pointer only.
  it('selects the focused cell as the pointer does and lets Escape clear it, keeping the focus', async () => {
    const table = getFixtures('table').find(entry => entry.kind === 'example' && entry.hover)!;
    const { rowId, colId } = table.hover!.owner;
    // jsdom has no layout: give every box a size so the cell counts as visible.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() =>
      ({ x: 10, y: 10, left: 10, top: 10, right: 110, bottom: 30, width: 100, height: 20, toJSON() {} }) as DOMRect);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(700);
    await render(<TableChart data={table.data as never} {...table.options as object} hover />);
    const cell = host.querySelector<HTMLElement>(`[data-bp-row="${rowId}"][data-bp-column="${colId}"]`)!;
    const active = () => host.querySelector('[data-bp-active-row]')?.getAttribute('data-bp-active-row');
    act(() => cell.focus());
    expect(active()).toBe(rowId);
    press(cell, 'Escape');
    expect(active()).toBeUndefined();
    expect(document.activeElement).toBe(cell);
  });

  // A host link in the card was unreachable by keyboard and a click on it fired the drill-down underneath.
  it('opens host card content on focus, lets Tab reach its link and Escape return to the stop', async () => {
    const onRecordClick = vi.fn();
    const column = fixture('column');
    const columnProps = { data: column.data, ...column.options as object, size } as unknown as ComponentProps<typeof ColumnChart>;
    await render(<ColumnChart {...columnProps} onRecordClick={onRecordClick} renderHoverContent={(record, { defaultContent }) =>
      <>{defaultContent}<a href={`#${record.target.owner.categoryId}`}>Open {record.categoryLabel}</a></>} />);
    const stop = keyStop();
    act(() => stop.focus());
    const custom = document.querySelector<HTMLElement>('[data-bp-custom-card]')!;
    expect(custom.getAttribute('role')).toBe('dialog');
    expect(custom.querySelector('[data-part="interaction-label"]')?.textContent).toContain('Q1 AC / Revenue');
    const link = custom.querySelector('a')!;
    expect(link.textContent).toBe('Open Q1 AC');
    const described = host.querySelector('[role="option"]')!.getAttribute('aria-describedby')!;
    expect(document.getElementById(described)!.textContent).toContain('Press Tab to reach the card.');
    act(() => link.focus());
    expect(document.querySelector('[data-bp-custom-card] a')).toBe(link);
    act(() => link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    expect(onRecordClick).not.toHaveBeenCalled();
    // A pointer move over the chart must not unmount the card that holds focus.
    const move = Object.assign(new Event('pointermove', { bubbles: true }), { pointerType: 'mouse', clientX: 0, clientY: 0 });
    act(() => host.querySelector('svg')!.dispatchEvent(move));
    expect(document.activeElement).toBe(link);
    press(link, 'Escape');
    expect(document.activeElement).toBe(stop);
    expect(document.querySelector('[data-bp-custom-card]')).toBeNull();
  });
});
