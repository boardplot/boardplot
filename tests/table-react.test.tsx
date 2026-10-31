// @vitest-environment jsdom
/**
 * The table's markup is a CSS grid of
 * `role=grid/treegrid` / `role=row` / `role=gridcell` divs, every column stays in the DOM
 * with a zero track while it is hidden, and every row keeps its element while
 * its parent is closed. The selectors below read the roles and the kept
 * attributes; "drawn" now means visible, not present.
 */

import { getFixtures } from '../src/fixtures';
import { act } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveProbe = vi.hoisted(() => vi.fn());
const recordsProbe = vi.hoisted(() => vi.fn());

vi.mock('../src/core/a11y/structuralRecords', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/a11y/structuralRecords')>();
  return { ...actual, preparedTableRecords: (...args: Parameters<typeof actual.preparedTableRecords>) => {
    recordsProbe();
    return actual.preparedTableRecords(...args);
  } };
});

vi.mock('../src/core/charts/table/resolve', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/charts/table/resolve')>();
  return {
    ...actual,
    resolveTable: (...args: Parameters<typeof actual.resolveTable>) => {
      resolveProbe(...args);
      return actual.resolveTable(...args);
    },
  };
});

import '../src/core/charts';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { requireGeometry } from '../src/core/sizing';
import { emitSparkline, sparklineDomains } from '../src/core/charts/table/encodings/sparkline';
import { resolveTable } from '../src/core/charts/table/resolve';
import { defaultMeasurer } from '../src/core/text';
import { paintColor, resolveTargetTheme, resolveTheme, themeForWidth } from '../src/core/theme';
import { tableStylesheet } from '../src/react/tablePresentation';
import { toneTextPaint } from '../src/core/charts/table/chips';
import { tableFonts } from '../src/core/charts/table/tracks';
import { levelLadder } from '../src/core/charts/table/ladder';
import {
  collapsedByDefault,
  groupSpans,
  visibleColumns,
  visibleRows,
} from '../src/core/charts/table/view';
import type { Fixture } from '../src/core/registry';
import type { TableData, TableOptions } from '../src/core/types/table';
import { TableChart } from '../src/react';

const actGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
actGlobal.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function managementFixture(): Fixture<TableData, TableOptions> {
  return getFixtures('table').find(
    (candidate) => candidate.id === 'management-report',
  )! as Fixture<TableData, TableOptions>;
}

function renderTable(props: Partial<React.ComponentProps<typeof TableChart>> = {}): void {
  const selected = managementFixture();
  act(() => {
    root.render(<TableChart data={selected.data} {...selected.options} {...props} />);
  });
}

/** The rows on screen: every row keeps its element, a closed parent hides its own. */
function rowIds(): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-bp-rowgroup="body"] [role="row"]'))
    .filter((row) => row.closest('.bp-children[data-bp-collapsed]') === null)
    .map((row) => row.dataset.rowId!);
}

/** The columns on screen: a hidden one keeps its cells and takes a zero track. */
function columnIds(): string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('.bp-columns [data-col-id]:not([data-bp-hidden])'),
  ).map((column) => column.dataset.colId!);
}

function gridElement(): HTMLElement {
  return container.querySelector<HTMLElement>('.bp-table-grid')!;
}

function click(element: Element): void {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  resolveProbe.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  expect(document.head.querySelectorAll('style[data-bp-table-theme]')).toHaveLength(0);
});

// Bold figures must retain browser slack when metric-only tracks would clip wider browser text.
it('keeps bold automatic value tracks safe when browser measurement is unavailable', () => {
  const data: TableData = {
    columns: [{ id: 'label', kind: 'rowLabel', label: 'Item' }, { id: 'v', kind: 'value', label: 'Value', format: '1' }],
    rows: [{ id: 'total', role: 'total', label: 'Total', cells: { v: 987654321 } }],
  };
  const theme = { preset: 'standard', overrides: { type: { family: 'Geist Variable', numeric: 'proportional' as const } } };
  for (const measureWidths of ['tables', 'browser'] as const) {
    // jsdom has no font/canvas measurement, so browser mode must use the same safe fallback.
    act(() => root.render(<TableChart data={data} theme={theme} size={{ width: 720 }} frameFill="none" measureWidths={measureWidths} />));
    expect(container.querySelector('[data-bp-row="total"][data-bp-column="v"] .bp-value')?.textContent).toBe('987654321');
    const valueTrack = Number.parseFloat(gridElement().style.getPropertyValue('--bp-cols').split(' ')[1]!);
    // The 96 px metric track needs the existing 3 px bold browser allowance.
    expect(valueTrack, measureWidths).toBeGreaterThanOrEqual(99);
  }
});

// A scrolling table must show the whole name within its allowed lines, including a leading glyph.
it('keeps the one-line or two-line label floor before a React table scrolls', () => {
  const data: TableData = {
    columns: [{ id: 'label', kind: 'rowLabel', label: 'Region' }, { id: 'v', kind: 'value', label: 'Value', width: 200 }],
    rows: [{ id: 'a', label: 'North America enterprise customer acquisition', cells: { v: 1234 } }],
  };
  for (const [rowLabelLines, floor] of [[2, 168], [1, 289]] as const) {
    for (const lead of [0, 24.5]) {
      act(() => root.render(<TableChart data={data} size={{ width: 300 }} margin={{ left: 0, right: 0 }}
        theme={{ preset: 'standard', overrides: { type: { family: 'Geist Variable' } } }}
        rowLabelLines={rowLabelLines} frameFill="none" measureWidths="tables"
        rowLabelLead={lead === 0 ? undefined : { width: lead, render: () => <span>•</span> }} />));
      const tracks = gridElement().style.getPropertyValue('--bp-cols').split(' ').map(Number.parseFloat);
      expect(tracks[0], `${rowLabelLines} lines, ${lead} px lead`).toBeGreaterThanOrEqual(floor + Math.ceil(lead));
      expect(tracks[1]).toBe(200);
    }
  }
});

// Hidden changes must not enlarge the parent or understate its minimum display width.
it('applies the larger change box only when a change line is visible', async () => {
  const data: TableData = {
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value', noteLine: true }],
    rows: [{ id: 'value', label: 'Orders', cells: { v: { v: 120, note: 'Observed' } } },
      { id: 'change', parentId: 'value', label: 'Change', inline: true, relation: 'displayOnly', cells: { v: 20 } }],
  };
  const options = {
    theme: { preset: 'standard', overrides: { type: { label: { size: 8, weight: 400 }, micro: { size: 8, weight: 400 } } } } };
  const { layoutTable } = await import('../src/core/charts/table/layout');
  const hidden = layoutTable(data, { ...options, inlineVisibility: { change: false }, size: { width: 400 } });
  const baseline = layoutTable({ ...data, rows: [data.rows[0]!] }, { ...options, size: { width: 400 } });
  const value = hidden.scene.find(node => node.t === 'text' && node.id === 'cell:value:v');
  expect(value?.t === 'text' && value.font.size).toBe(8);
  expect(hidden.marks.rows.find(row => row.id === 'value')!.h).toBe(baseline.marks.rows.find(row => row.id === 'value')!.h);
  const { prepareChart } = await import('../src/react/prepare');
  const preparedOptions: TableOptions = { ...options, inlineVisibility: { change: false } };
  const prepare = (rows: TableData['rows']) => prepareChart({ type: 'table', data: { ...data, rows }, size: { width: 400 },
    options: preparedOptions });
  expect((await prepare(data.rows)).presentation).toEqual((await prepare([data.rows[0]!])).presentation);
  renderTable({ data, ...options, inlineVisibility: { change: false } });
  const row = container.querySelector<HTMLElement>('[role="row"][data-row-id="value"]')!;
  expect(row.querySelector('.bp-line-off[data-bp-line]')).not.toBeNull();
  const rules = Array.from(document.head.querySelector<HTMLStyleElement>('style[data-bp-table-theme]')!.sheet!.cssRules)
    .filter((rule): rule is CSSStyleRule => rule.type === CSSRule.STYLE_RULE &&
      ((rule as CSSStyleRule).style.getPropertyValue('--bp-inline-box').includes('--bp-change-size') ||
        (rule as CSSStyleRule).style.getPropertyValue('--bp-row-line').includes('max(11px') ||
        (rule as CSSStyleRule).style.getPropertyValue('font-size').includes('max(11px')));
  expect(rules.length).toBeGreaterThan(0);
  // jsdom cannot match nested :has/:not; test the rule's child selector on this row.
  const hasChangeBox = () => rules.some(rule => row.querySelector(rule.selectorText.match(/:has\((.*)\)/)![1]!) !== null);
  expect(hasChangeBox()).toBe(false);
  renderTable({ data, ...options, inlineVisibility: { change: true } });
  expect(hasChangeBox()).toBe(true);
  const shown = layoutTable(data, { ...options, inlineVisibility: { change: true }, size: { width: 400 } });
  const shownValue = shown.scene.find(node => node.t === 'text' && node.id === 'cell:value:v');
  expect(shownValue?.t === 'text' && shownValue.font.size).toBe(11);
});

describe('TableChart uncontrolled state', () => {
  // Pinned summary columns must leave the period values reachable in a narrow card.
  it('reduces pins until a full scrolling column fits', () => {
    const data: TableData = {
      columns: [
        { id: 'label', kind: 'rowLabel', label: 'Item', width: 160 },
        { id: 'range', kind: 'value', label: 'Range', width: 120 },
        { id: 'prior', kind: 'value', label: 'Prior', width: 120 },
        { id: 'period', kind: 'value', label: 'Period', width: 100 },
      ],
      rows: [{ id: 'a', label: 'Item A', cells: { range: 10, prior: 9, period: 8 } }],
    };
    const draw = (width: number) => act(() => root.render(<TableChart data={data} size={{ width }} frameFill="none" stickyLabels={3} />));
    const pins = () => Array.from(container.querySelectorAll<HTMLElement>('.bp-columns [data-bp-pin]'), node => node.dataset.colId);
    draw(400);
    expect(pins()).toEqual(['label', 'range']);
    expect(columnIds()).toEqual(['label', 'range', 'prior', 'period']);
    draw(250);
    expect(pins()).toEqual([]);
    expect(columnIds()).toEqual(['label', 'range', 'prior', 'period']);
    draw(1000);
    expect(pins()).toEqual(['label', 'range', 'prior']);
  });

  // Medium cards must keep the requested pins when one full scrolling column still fits.
  it('keeps summary columns pinned above the full-column breakpoint', () => {
    const data: TableData = {
      columns: [
        { id: 'label', kind: 'rowLabel', label: 'Item', width: 160 },
        { id: 'range', kind: 'value', label: 'Range', width: 120 },
        { id: 'prior', kind: 'value', label: 'Prior', width: 120 },
        { id: 'period', kind: 'value', label: 'Period', width: 100 },
      ],
      rows: [{ id: 'a', label: 'Item A', cells: { range: 10, prior: 9, period: 8 } }],
    };
    act(() => root.render(<TableChart data={data} size={{ width: 720 }} frameFill="none" stickyLabels={3} />));
    const pins = Array.from(container.querySelectorAll<HTMLElement>('.bp-columns [data-bp-pin]'));
    expect(pins.map(node => node.dataset.colId)).toEqual(['label', 'range', 'prior']);
    expect(pins.map(node => node.style.getPropertyValue('--bp-pin-left'))).toEqual(['0px', '160px', '280px']);
    expect(pins.at(-1)!.hasAttribute('data-bp-pin-last')).toBe(true);
  });

  // Revealing a hidden table must restore its full row height without waiting for a prop change.
  it('ignores zero row pitch and measures the row again on resize', () => {
    const observers: { callback: ResizeObserverCallback; elements: Element[] }[] = [];
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('ResizeObserver', class {
      elements: Element[] = [];
      constructor(callback: ResizeObserverCallback) { observers.push({ callback, elements: this.elements }); }
      observe(element: Element) { this.elements.push(element); }
      disconnect() {}
    });
    try {
      const data: TableData = {
        columns: [{ id: 'label', kind: 'rowLabel', label: 'Item' }, { id: 'value', kind: 'value', label: 'Value' }],
        rows: Array.from({ length: 600 }, (_, index) => ({ id: `r${index}`, label: `Item ${index}`, cells: { value: index } })),
      };
      act(() => root.render(<TableChart data={data} size={{ width: 1200 }} />));
      const body = container.querySelector<HTMLElement>('[data-bp-rowgroup="body"]')!;
      expect(body.style.getPropertyValue('--bp-row-pitch')).toBe('');
      const sample = body.querySelectorAll<HTMLElement>('[role="row"]')[1]!;
      const observer = observers.find(candidate => candidate.elements.includes(sample))!;
      expect(observer).toBeDefined();
      sample.style.height = '40px';
      act(() => observer.callback([], {} as ResizeObserver));
      expect(body.style.getPropertyValue('--bp-row-pitch')).toBe('40px');
      sample.style.height = '0px';
      act(() => observer.callback([], {} as ResizeObserver));
      expect(body.style.getPropertyValue('--bp-row-pitch')).toBe('40px');
      sample.style.height = '44.5px';
      act(() => observer.callback([], {} as ResizeObserver));
      expect(body.style.getPropertyValue('--bp-row-pitch')).toBe('44.5px');
    } finally { vi.unstubAllGlobals(); }
  });

  // A live insertion must keep the active cell when its row moves to another page, without stealing outside focus.
  it('retains cell focus across row-page boundaries', () => {
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
    const outside = document.createElement('button');
    document.body.append(outside);
    try {
      const data: TableData = {
        columns: [{ id: 'label', kind: 'rowLabel', label: 'Item' }, { id: 'value', kind: 'value', label: 'Value' }],
        rows: Array.from({ length: 600 }, (_, index) => ({ id: `r${index}`, label: `Item ${index}`, cells: { value: index } })),
      };
      act(() => root.render(<TableChart data={data} size={{ width: 1200 }} />));
      act(() => container.querySelector<HTMLElement>('[data-bp-row="r63"][data-bp-column="value"]')!.focus());
      const inserted = { ...data, rows: [{ id: 'new', label: 'New', cells: { value: 1 } }, ...data.rows] };
      act(() => root.render(<TableChart data={inserted} size={{ width: 1200 }} />));
      expect(document.activeElement?.getAttribute('data-bp-row')).toBe('r63');
      expect(document.activeElement?.getAttribute('data-bp-column')).toBe('value');
      act(() => outside.focus());
      act(() => root.render(<TableChart data={data} size={{ width: 1200 }} />));
      expect(document.activeElement).toBe(outside);
      // A host can move from an offscreen cell to a dialog before decoration finishes.
      act(() => {
        container.querySelector<HTMLElement>('[data-bp-row="r599"][data-bp-column="value"]')!.focus({ preventScroll: true });
        outside.focus();
      });
      expect(document.activeElement).toBe(outside);
    } finally { outside.remove(); vi.unstubAllGlobals(); }
  });

  // A mounted large table must keep its values and focused cell when its host starts measuring its width.
  it('keeps a large table visible when its fallback width is removed', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    try {
      const data: TableData = {
        columns: [{ id: 'label', kind: 'rowLabel', label: 'Item' }, { id: 'value', kind: 'value', label: 'Value' }],
        rows: Array.from({ length: 600 }, (_, index) => ({ id: `r${index}`, label: `Item ${index}`, cells: { value: index + 1 } })),
      };
      act(() => root.render(<TableChart data={data} size="container" fallbackSize={{ width: 1200 }} />));
      const cell = container.querySelector<HTMLElement>('[data-bp-row="r0"][data-bp-column="value"]')!;
      act(() => cell.focus());
      act(() => root.render(<TableChart data={data} size="container" />));
      expect(container.querySelector('[data-bp-loading]')).toBeNull();
      expect(container.querySelectorAll('[data-row-id]')).toHaveLength(600);
      expect(document.activeElement).toBe(cell);
    } finally { vi.unstubAllGlobals(); }
  });

  // A container table wider than its printed box was squeezed by the print rules until its figures dropped out.
  it('scales a container table that needs more than its printed box down into it, and back after print', () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener) }));
    try {
      const data: TableData = {
        columns: [{ id: 'label', kind: 'rowLabel', label: 'Item' }, ...['a', 'b', 'c', 'd', 'e'].map(id => ({ id, kind: 'value' as const, label: `Value ${id}` }))],
        rows: [{ id: 'r', label: 'Item', cells: { a: 1200, b: 3400, c: 5600, d: 7800, e: 9100 } }],
      };
      act(() => root.render(<TableChart data={data} size="container" fallbackSize={{ width: 800 }} />));
      const grid = container.querySelector<HTMLElement>('.bp-table-grid')!;
      Object.defineProperty(grid.parentElement!, 'clientWidth', { configurable: true, value: 120 });
      act(() => { window.dispatchEvent(new Event('beforeprint')); listeners.forEach(listener => listener({ matches: true } as MediaQueryListEvent)); });
      const zoom = Number(grid.style.zoom);
      expect(zoom).toBeGreaterThan(0);
      expect(zoom).toBeCloseTo(120 / parseFloat(grid.style.width), 5);
      act(() => window.dispatchEvent(new Event('afterprint')));
      expect(grid.style.zoom).toBe('');
    } finally { vi.unstubAllGlobals(); }
  });

  // A large table must keep offscreen text literal and current, retain focus and selection, and print all bars.
  it('keeps every row text and opens all row pages for print', () => {
    const observers: { callback: IntersectionObserverCallback; pages: Element[] }[] = [];
    vi.stubGlobal('IntersectionObserver', class {
      pages: Element[] = [];
      constructor(callback: IntersectionObserverCallback) { observers.push({ callback, pages: this.pages }); }
      observe(page: Element) { this.pages.push(page); }
      disconnect() {}
    });
    try {
      const data: TableData = {
        columns: [{ id: 'label', kind: 'rowLabel', label: 'Item' }, { id: 'value', kind: 'value', label: 'Value' }],
        rows: Array.from({ length: 600 }, (_, index) => ({ id: `r${index}`, label: `Item ${index}`, cells: { value: index + 1 } })),
      };
      act(() => root.render(<TableChart data={data} size={{ width: 1200 }} encodings={{ value: 'inCellBar' }} />));
      expect(container.querySelectorAll('[data-row-id]')).toHaveLength(600);
      expect(container.querySelector('[data-row-id="r599"]')?.textContent).toContain('Item 599');
      expect(container.querySelectorAll('.bp-in-cell-bar')).toHaveLength(64);
      const observer = observers[observers.length - 1]!;
      act(() => observer.callback([{ target: observer.pages[2]!, isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver));
      expect(container.querySelectorAll('.bp-in-cell-bar')).toHaveLength(128);
      act(() => window.dispatchEvent(new Event('beforeprint')));
      expect(container.querySelectorAll('.bp-in-cell-bar')).toHaveLength(600);
      act(() => window.dispatchEvent(new Event('afterprint')));
      expect(container.querySelectorAll('.bp-in-cell-bar')).toHaveLength(128);
      const updated = { ...data, rows: data.rows.map((row, index) => index === 599
        ? { ...row, label: 'Item 599 <img src=x>', cells: { value: 9876 } } : row) };
      act(() => root.render(<TableChart data={updated} size={{ width: 1200 }} encodings={{ value: 'inCellBar' }} />));
      expect(container.querySelector('[data-row-id="r599"]')?.textContent).toContain('Item 599 <img src=x>');
      expect(container.querySelector('[data-row-id="r599"] img')).toBeNull();
      expect(container.querySelector('[data-row-id="r599"] [data-bp-column="value"]')?.textContent).toContain('9,876');
      act(() => container.querySelector<HTMLElement>('[data-row-id="r599"] [data-bp-column="value"]')!.focus());
      expect(document.activeElement?.getAttribute('data-bp-row')).toBe('r599');
      expect(document.activeElement?.getAttribute('data-bp-column')).toBe('value');
      const select = vi.fn();
      act(() => root.render(<TableChart data={updated} size={{ width: 1200 }} encodings={{ value: 'inCellBar' }} onRowSelect={select} />));
      click(container.querySelector('[data-row-id="r500"] [data-bp-column="value"]')!);
      expect(select).toHaveBeenCalledWith('r500', expect.objectContaining({ columnId: 'value' }));
    } finally { vi.unstubAllGlobals(); }
  });

  // Offscreen source text must stay literal and current, even when it contains HTML-shaped content.
  it('keeps grouped offscreen text literal and current when a wide table updates', () => {
    const text = '<img src=x onerror="alert(1)"> & "quoted"\rnext';
    const data: TableData = {
      columns: [{ id: 'label', kind: 'rowLabel', label: 'Item', width: 100 },
        ...Array.from({ length: 45 }, (_, index) => ({ id: `c${index}`, kind: 'text' as const, label: `Field ${index}`, width: 80 }))],
      rows: [{ id: 'r', label: 'Item', cells: Object.fromEntries(Array.from({ length: 45 }, (_, index) => [`c${index}`, index === 44 ? text : `Value ${index}`])) }],
    };
    act(() => root.render(<TableChart data={data} size={{ width: 400 }} />));
    const last = () => container.querySelector('[data-bp-rowgroup="body"] [data-bp-lite] [aria-colindex="46"]');
    expect(last()?.textContent).toBe(text);
    expect(container.querySelector('img')).toBeNull();
    const updated = { ...data, rows: [{ ...data.rows[0]!, cells: { ...data.rows[0]!.cells, c44: 'Updated & still text' } }] };
    act(() => root.render(<TableChart data={updated} size={{ width: 400 }} />));
    expect(last()?.textContent).toBe('Updated & still text');
  });

  // Opening a large table must not build hover facts before a pointer reaches a cell, including after data updates.
  it('builds hover facts on first use and refreshes them when data changes', async () => {
    const { loadHoverEngine } = await import('../src/react/useHover');
    await loadHoverEngine();
    const data: TableData = {
      columns: [{ id: 'label', kind: 'rowLabel', label: 'Item' }, { id: 'value', kind: 'value', label: 'Value' }],
      rows: [{ id: 'r', label: 'Item', cells: { value: 10 } }],
    };
    recordsProbe.mockClear();
    await act(async () => root.render(<TableChart data={data} hover />));
    expect(recordsProbe).not.toHaveBeenCalled();
    const hover = () => act(() => container.querySelector('[data-bp-mark]')!.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })));
    hover();
    hover();
    expect(recordsProbe).toHaveBeenCalledTimes(1);
    const updated = { ...data, rows: [{ ...data.rows[0]!, cells: { value: 20 } }] };
    await act(async () => root.render(<TableChart data={updated} hover />));
    expect(recordsProbe).toHaveBeenCalledTimes(1);
    hover();
    expect(recordsProbe).toHaveBeenCalledTimes(2);
    expect(Number(container.querySelector('[data-bp-mark]')?.textContent)).toBe(20);
  });

  it('seeds the management report from the IR and expands rows and forecast detail', () => {
    const selected = managementFixture();
    const expected = resolveTable(selected.data, selected.options).table;
    const onCollapsedChange = vi.fn();
    const onColumnVisibilityChange = vi.fn();

    renderTable({ onCollapsedChange, onColumnVisibilityChange });

    expect(rowIds()).toEqual(
      visibleRows(expected, collapsedByDefault(expected)).map((row) => row.id),
    );
    expect(columnIds()).toEqual(visibleColumns(expected).map((column) => column.id));

    const printRow = container.querySelector<HTMLElement>(
      '[role="row"][data-row-id="subs-cloud"]',
    )!;
    const printToggle = printRow.querySelector<HTMLButtonElement>('.bp-tree-toggle')!;
    expect(printToggle.getAttribute('aria-expanded')).toBe('false');
    expect(rowIds()).not.toContain('cloud-europe');

    click(printRow);

    expect(onCollapsedChange).toHaveBeenLastCalledWith([
      'cloud-europe',
      'europe-eu',
      'seg-unallocated',
    ]);
    expect(printToggle.getAttribute('aria-expanded')).toBe('true');
    expect(rowIds()).toContain('cloud-europe');
    expect(rowIds()).toContain('cloud-americas');

    const landingGroup = container.querySelector<HTMLElement>(
      '[data-group-id="g-forecast"]',
    )!;
    // The toggles live in a toolbar, NOT in the group header they act on: four of
    // the five can empty their own group, and the header cell then stopped
    // rendering and took the control with it.
    const toolbar = container.querySelector<HTMLElement>('.bp-col-toolbar')!;
    expect(toolbar).not.toBeNull();
    expect(landingGroup.querySelector('.bp-col-toggle')).toBeNull();
    const detailToggle = toolbar.querySelector<HTMLButtonElement>(
      '[data-bp-toggle-cols="forecast-detail"]',
    )!;
    expect(columnIds()).toHaveLength(21);
    expect(landingGroup.getAttribute('aria-colspan')).toBe('5');
    expect(detailToggle.getAttribute('aria-pressed')).toBe('false');

    // Every toggle must survive its own click, including the four that reduce
    // their group to zero columns. Otherwise the table cannot be recovered from the UI.
    const toggleIds = () =>
      Array.from(container.querySelectorAll<HTMLElement>('[data-bp-toggle-cols]')).map(
        (button) => button.dataset.bpToggleCols,
      );
    const allToggles = toggleIds();
    expect(allToggles).toHaveLength(5);
    for (const id of allToggles) {
      const button = container.querySelector<HTMLButtonElement>(
        `[data-bp-toggle-cols="${id!}"]`,
      )!;
      click(button);
      expect(toggleIds(), `clicking '${id!}' must not remove any toggle`).toEqual(allToggles);
      click(button);
      expect(toggleIds()).toEqual(allToggles);
    }

    click(detailToggle);

    expect(onColumnVisibilityChange).toHaveBeenLastCalledWith({
      'forecast-detail': true,
      'mtd-band': true,
      'ytd-closed-band': true,
      'full-year-pace-band': true,
      'full-year-outlook-band': true,
    });
    expect(columnIds()).toHaveLength(26);
    expect(columnIds()).toEqual(visibleColumns(expected, { 'forecast-detail': true }).map((column) => column.id));
    expect(
      container.querySelectorAll('.bp-columns [data-bp-detail="forecast-detail"]:not([data-bp-hidden])'),
    ).toHaveLength(5);
    expect(
      container.querySelector('[data-bp-rowgroup="body"] [role="gridcell"][data-bp-detail="forecast-detail"]:not([data-bp-hidden])'),
    ).not.toBeNull();
    expect(landingGroup.getAttribute('aria-colspan')).toBe('10');
    expect(detailToggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('lets explicit defaults override the IR seed without becoming controlled', () => {
    renderTable({
      defaultCollapsed: [],
      defaultColumnVisibility: { 'forecast-detail': true },
    });

    expect(rowIds()).toHaveLength(19);
    expect(columnIds()).toHaveLength(26);

    click(container.querySelector('[role="row"][data-row-id="subs-cloud"]')!);
    click(container.querySelector('[data-bp-toggle-cols="forecast-detail"]')!);

    expect(rowIds()).toHaveLength(13);
    expect(columnIds()).toHaveLength(21);
  });

  it('pins an open subtree before the fold reads its height, so the rows leave on the unfold path', () => {
    renderTable();
    const box = container.querySelector<HTMLElement>('[data-bp-children="seg-subscriptions"]')!;
    const capAtRead: string[] = [];
    Object.defineProperty(box, 'scrollHeight', { configurable: true, get: () => { capAtRead.push(box.style.maxHeight); return 60; } });
    click(container.querySelector('[data-row-id="seg-subscriptions"] .bp-tree-toggle')!);
    // With no cap, the read applied the closed rule's max-height: 0 from
    // `none`, which does not interpolate, and the rows went at once.
    expect(capAtRead).toEqual(['none']);
  });

  it('lets the leaving rows take no pointer while they fade', () => {
    renderTable();
    const css = document.head.querySelector('style[data-bp-table-theme]')!.textContent!;
    expect(css).toContain('.bp-children[data-bp-collapsed]{max-height:0;opacity:0;pointer-events:none}');
  });
});

describe('TableChart controlled state', () => {
  it('reports row-toggle intent while the collapsed prop remains authoritative', () => {
    const onCollapsedChange = vi.fn();
    renderTable({ collapsed: ['seg-subscriptions'], onCollapsedChange });

    const clientRow = container.querySelector('[role="row"][data-row-id="seg-subscriptions"]')!;
    expect(rowIds()).not.toContain('subs-cloud');

    click(clientRow);

    expect(onCollapsedChange).toHaveBeenCalledWith([]);
    expect(rowIds()).not.toContain('subs-cloud');

    renderTable({ collapsed: [], onCollapsedChange });
    expect(rowIds()).toContain('subs-cloud');
    expect(rowIds()).toContain('cloud-europe');
  });

  it('reports column-toggle intent while columnVisibility remains authoritative', () => {
    const onColumnVisibilityChange = vi.fn();
    renderTable({
      columnVisibility: { 'forecast-detail': false },
      onColumnVisibilityChange,
    });

    click(container.querySelector('[data-bp-toggle-cols="forecast-detail"]')!);

    expect(onColumnVisibilityChange).toHaveBeenCalledWith({
      'forecast-detail': true,
      'mtd-band': true,
      'ytd-closed-band': true,
      'full-year-pace-band': true,
      'full-year-outlook-band': true,
    });
    expect(columnIds()).toHaveLength(21);

    renderTable({
      columnVisibility: { 'forecast-detail': true },
      onColumnVisibilityChange,
    });
    expect(columnIds()).toHaveLength(26);
  });
});

describe('TableChart DOM vocabulary', () => {
  it('renders the frozen vocabulary, visible group spans, and no string-runtime annotations', () => {
    const selected = managementFixture();
    const expected = resolveTable(selected.data, selected.options).table;
    // The departments on their authored rung, so the rung-0 anchor wash is
    // part of the vocabulary under test (the fixture itself takes
    // `levelOffset: 1`).
    renderTable({ stickyLabels: true, levelOffset: 0 });

    const scroll = container.querySelector('.bp-scroll')!;
    const table = scroll.querySelector<HTMLElement>('.bp-table-grid')!;
    expect(table.getAttribute('role')).toBe('treegrid');
    expect(table.getAttribute('aria-describedby')).toBe(container.querySelector('.bp-summary')!.id);
    expect(table.hasAttribute('data-bp-tree')).toBe(true);
    expect(table.hasAttribute('data-bp-sticky')).toBe(true);
    expect(table.getAttribute('data-bp-density')).toBe('compact');
    expect(table.hasAttribute('data-bp-wired')).toBe(true);
    expect(table.hasAttribute('data-bp-interactive')).toBe(false);
    expect(table.hasAttribute('data-bp-collapsed')).toBe(false);
    expect(container.querySelector('[hidden]')).toBeNull();

    const clientRow = table.querySelector<HTMLElement>(
      '[role="row"][data-row-id="seg-subscriptions"]',
    )!;
    expect(clientRow.dataset.hasChildren).toBe('true');
    expect(clientRow.hasAttribute('data-anchor')).toBe(true);
    expect(clientRow.dataset.level).toBe('0');
    expect(clientRow.dataset.role).toBe('data');
    expect(clientRow.dataset.relation).toBe('additive');
    expect(
      table.querySelector('[role="row"][data-row-id="subs-cloud"]')!.getAttribute('data-parent-id'),
    ).toBe('seg-subscriptions');

    const chevron = clientRow.querySelector<HTMLButtonElement>(
      'button.bp-tree-toggle[data-bp-toggle-row]',
    )!;
    expect(chevron.type).toBe('button');
    expect(chevron.getAttribute('aria-expanded')).toBe('true');
    expect(chevron.getAttribute('aria-label')).toBe('Collapse Subscriptions');

    const detailToggle = container.querySelector<HTMLButtonElement>(
      '.bp-col-toolbar button.bp-col-toggle[data-bp-toggle-cols="forecast-detail"]',
    )!;
    expect(detailToggle.dataset.bpDefaultVisible).toBe('false');
    expect(detailToggle.getAttribute('aria-pressed')).toBe('false');
    expect(
      table.querySelectorAll('[data-bp-detail="forecast-detail"]:not([data-bp-hidden])'),
    ).toHaveLength(0);

    const expectedColumns = visibleColumns(expected);
    const expectedSpans = groupSpans(expected, expectedColumns);
    for (const span of expectedSpans) {
      expect(
        table.querySelector<HTMLElement>(`[data-group-id="${span.id}"]`)!.getAttribute('aria-colspan'),
      ).toBe(String(span.span));
    }
    const groupSpanTotal = Array.from(
      table.querySelectorAll<HTMLElement>('.bp-groups > *:not([data-bp-hidden])'),
    ).reduce((sum, cell) => sum + Number(cell.getAttribute('aria-colspan') ?? 1), 0);
    expect(groupSpanTotal).toBe(expectedColumns.length);

    // A hidden column's head sits in a zero-wide track; a label that wraps there
    // breaks after every letter and stretches the whole head row hundreds of px.
    const hiddenLabel = table.querySelector<HTMLElement>('.bp-columns [data-bp-detail="forecast-detail"][data-bp-hidden] .bp-head-label')!;
    expect(getComputedStyle(hiddenLabel).whiteSpace).toBe('nowrap');
  });

  it('draws the outline mark, the band, the emphasis and one rule weight ', () => {
    renderTable();
    const table = gridElement();

    // the mark is an 8px outline glyph, not a CSS triangle, and it says open
    const mark = table.querySelector<SVGSVGElement>(
      '[role="row"][data-row-id="seg-subscriptions"] button.bp-tree-toggle svg path',
    )!;
    expect(mark.getAttribute('d')).toBe('M1 4h6');
    expect(mark.getAttribute('stroke-width')).toBe('var(--bp-stroke-mark)');
    expect(mark.getAttribute('stroke-linecap')).toBe('round');
    const closed = table.querySelector<SVGPathElement>(
      '[role="row"][data-row-id="subs-cloud"] button.bp-tree-toggle svg path',
    )!;
    expect(closed.getAttribute('d')).toBe('M1 4h6M4 1v6');

    // a closed parent says how many lines it hides, in the authored noun
    expect(
      table.querySelector('[role="row"][data-row-id="subs-cloud"] .bp-hint')!.textContent,
    ).toBe('\u00b7 2 regions');

    // the banded column group wears the band and opens with a divider
    const outlook = table.querySelector<HTMLElement>('[role="gridcell"][data-bp-column="foLy"]')!;
    expect(outlook.hasAttribute('data-bp-band')).toBe(true);
    expect(outlook.hasAttribute('data-bp-group-start')).toBe(true);
    expect(
      table.querySelector('[role="gridcell"][data-bp-column="foOut"]')!.hasAttribute('data-bp-group-start'),
    ).toBe(false);

    // and the stylesheet carries one rule weight, the grounds and the ladder
    const css = document.head.querySelector('style[data-bp-table-theme]')!.textContent!;
    // every rule is a hairline but the section rule; the 2px focus ring stays
    expect(css.replace(/border-bottom:2px solid var\(--bp-ink\)/, '')).not.toMatch(/border[a-z-]*:[^;}]*2px/);
    // 600 is the one strong weight: column heads and table emphasis alike
    expect(css).toMatch(/font-weight:600/);
    expect(css).not.toMatch(/font-weight:700/);
    expect(css).not.toContain('rotate(90deg)');
    expect(css).toContain('border-bottom:var(--bp-stroke-hair) solid var(--bp-rule)');
    expect(css).toContain('background:var(--bp-emphasis)');
    expect(css).toContain('background:var(--bp-band)');
    expect(css).toContain('--bp-level-2-size');
    expect(css).toContain('--bp-motion-layout');
    expect(css).toContain('var(--bp-indent-base,24px) + var(--bp-level)*var(--bp-indent-step,16px)');
    expect(css).toContain('[data-emphasis="strong"]{font-weight:600}');
  });

  it('draws no column toolbar when the host turns it off', () => {
    renderTable();
    expect(container.querySelectorAll('.bp-col-toolbar')).toHaveLength(1);
    renderTable({ toolbar: false });
    expect(container.querySelector('.bp-col-toolbar')).toBeNull();
    expect(container.querySelector('.bp-col-toggle')).toBeNull();
    // the table itself is untouched: the toolbar is a control, not content
    expect(rowIds().length).toBeGreaterThan(0);
  });

  it('keeps row links and the chevron from double-triggering whole-row clicks', () => {
    const data: TableData = {
      columns: [{ id: 'label', kind: 'rowLabel', label: 'Item' }],
      rows: [
        {
          id: 'parent',
          label: 'Parent',
          cells: { label: { href: '#parent' } },
          children: [{ id: 'child', label: 'Child' }],
        },
      ],
    };
    const onCollapsedChange = vi.fn();
    act(() => {
      root.render(
        <TableChart
          data={data}
          defaultCollapsed={['parent']}
          onCollapsedChange={onCollapsedChange}
        />,
      );
    });

    click(container.querySelector('a[href="#parent"]')!);
    expect(onCollapsedChange).not.toHaveBeenCalled();
    expect(rowIds()).toEqual(['parent']);

    click(container.querySelector('.bp-tree-toggle')!);
    expect(onCollapsedChange).toHaveBeenCalledTimes(1);
    expect(rowIds()).toEqual(['parent', 'child']);
  });

  it('mounts one generated stylesheet per resolved theme and reference-counts it', () => {
    const selected = managementFixture();
    act(() => {
      root.render(
        <>
          <TableChart data={selected.data} {...selected.options} />
          <TableChart data={selected.data} {...selected.options} />
        </>,
      );
    });

    expect(document.head.querySelectorAll('style[data-bp-table-theme]')).toHaveLength(1);
    const stylesheet = document.head.querySelector<HTMLStyleElement>('style[data-bp-table-theme]')!;
    expect(stylesheet.textContent).toMatch(/\.bp-table-grid\[data-bp-table-theme="[^"]+"\]\{width:var\(--bp-table-width,max-content\);/);
    expect(stylesheet.textContent).not.toMatch(/\.bp-table-grid\[data-bp-table-theme="[^"]+"\]\{[^}]*min-width:100%/);
  });
});

describe('TableChart resolution memo', () => {
  it('resolves once for unchanged data/options content and again for new data', () => {
    const selected = managementFixture();
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();

    renderTable({ onCollapsedChange: firstCallback });
    expect(resolveProbe).toHaveBeenCalledTimes(1);

    renderTable({ onCollapsedChange: secondCallback });
    expect(resolveProbe).toHaveBeenCalledTimes(1);

    // A copy with the same content, as data written inline is.
    renderTable({
      data: { ...selected.data },
      onCollapsedChange: secondCallback,
    });
    expect(resolveProbe).toHaveBeenCalledTimes(1);

    // Resizing must keep the current values without resolving unchanged data again.
    renderTable({ size: { width: 800 }, onCollapsedChange: secondCallback });
    expect(resolveProbe).toHaveBeenCalledTimes(1);

    renderTable({
      data: { ...selected.data, rows: selected.data.rows.slice(0, -1) },
      size: { width: 800 },
      onCollapsedChange: secondCallback,
    });
    expect(resolveProbe).toHaveBeenCalledTimes(2);
  });
});

describe('TableChart carries the unit (the third surface of the twin)', () => {
  const money: TableData = {
    columns: [
      { id: 'label', kind: 'rowLabel', label: 'Segment' },
      { id: 'v', kind: 'value', label: 'Revenue', format: '$1.1m' },
      { id: 'c', kind: 'value', label: 'Cost', format: '$1k' },
    ],
    rows: [{ id: 'a', label: 'A', cells: { v: 5_000_000, c: 12_000 } }],
  };

  it('prints per-column unit affixes when the unit did not hoist to the frame', () => {
    act(() => {
      root.render(<TableChart data={money} title="Revenue by segment" />);
    });
    const headers = Array.from(
      container.querySelectorAll<HTMLElement>('.bp-columns [role="columnheader"]'),
    ).map((cell) => cell.textContent);
    // mixed money scales cannot hoist, so each column states its own
    expect(headers).toEqual(['SEGMENT', 'REVENUE ($M)', 'COST ($k)']);
  });

  it('prints the hoisted uniform unit in the subtitle, without a unit prop', () => {
    const uniform: TableData = {
      ...money,
      columns: money.columns.map((column) =>
        column.kind === 'value' ? { ...column, format: '$1.1m' } : column,
      ),
    };
    act(() => {
      root.render(<TableChart data={uniform} subtitle={{ measure: 'Revenue' }} />);
    });
    expect(container.querySelector('.bp-subtitle')!.textContent).toBe('Revenue in $M');
    const headers = Array.from(
      container.querySelectorAll<HTMLElement>('.bp-columns [role="columnheader"]'),
    ).map((cell) => cell.textContent);
    expect(headers).toEqual(['SEGMENT', 'REVENUE', 'COST']);
  });

  it('states the same subtitle for a STRING subtitle as for the object form', () => {
    const uniform: TableData = {
      ...money,
      columns: money.columns.map((column) =>
        column.kind === 'value' ? { ...column, format: '$1.1m' } : column,
      ),
    };
    act(() => {
      root.render(<TableChart data={uniform} subtitle="Revenue" />);
    });
    // the string form is the common authoring shape and it hoists the unit
    // the same way — so it must print the same scale, not a bare label
    expect(container.querySelector('.bp-subtitle')!.textContent).toBe('Revenue in $M');
  });
});

describe('TableChart presentation mode', () => {
  it('keeps the subtitle, source, required notes and cells when the title becomes compact', () => {
    const selected = getFixtures('table').find((item) => item.id === 'nulls-policy')! as Fixture<TableData, TableOptions>;
    const renderMode = (mode: 'full' | 'compact') => act(() => root.render(
      <TableChart data={selected.data} {...selected.options} mode={mode} notes={{ show: ['note', 'disclosure'] }}
        source="Finance ledger" footnotes={['Board draft only.']} />,
    ));
    renderMode('full');
    const cells = gridElement().innerHTML;
    const subtitle = container.querySelector('.bp-subtitle')!.textContent;
    expect(container.querySelector('.bp-footnotes')!.textContent).toContain('Board draft only.');

    renderMode('compact');
    expect(container.querySelector('figure')!.dataset.bpMode).toBe('compact');
    expect(container.querySelector('.bp-title sup')!.textContent).toBe('1');
    expect(container.querySelector('.bp-title sup')!.getAttribute('aria-label')).toBe('Board draft only.');
    expect(container.querySelector('.bp-footnotes')!.textContent).toContain('Partial aggregate: missing values skipped.');
    expect(container.querySelector('.bp-footnotes')!.textContent).not.toContain('Board draft only.');
    expect(container.querySelector('.bp-source')!.textContent).toBe('Source: Finance ledger');
    expect(container.querySelector('.bp-subtitle')!.textContent).toBe(subtitle);
    expect(gridElement().innerHTML).toBe(cells);
  });

  // At canvas margin 0 the notes sat flush on the card edge in the body size.
  it('insets the footer by the cell padding and sets it in the footer size', () => {
    const selected = getFixtures('table').find((item) => item.id === 'nulls-policy')! as Fixture<TableData, TableOptions>;
    act(() => root.render(<TableChart data={selected.data} {...selected.options} target="dashboard" margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
      source="Finance ledger" notes={{ show: ['note', 'disclosure'] }} />));
    expect(container.querySelector<HTMLElement>('figure')!.style.getPropertyValue('--bp-note-indent')).toBe('12px');
    // The dashboard's 12 px footnote step; the footer draws 11 px, as the SVG footer does.
    const css = tableStylesheet(themeForWidth(resolveTargetTheme(undefined, 'dashboard'), 960), 'dashboard');
    expect(css).toContain('--bp-foot-size:11px');
    expect(css).toMatch(/\.bp-table \.bp-footnotes\{[^}]*padding-inline:var\(--bp-note-indent,0\)[^}]*font-size:var\(--bp-foot-size\)/);
  });

  // Narrow row labels must wrap at spaces, ellipsize an oversized word, and keep the full label in a title.
  it('keeps whole words and full label titles in a narrow row header', () => {
    const label = 'South Coast';
    const data: TableData = { columns: [{ id: 'label', kind: 'rowLabel', width: 52 }, { id: 'value', kind: 'value' }],
      rows: [{ id: 'south', label, cells: { value: 12 } }] };
    act(() => root.render(<TableChart data={data} size={{ width: 375 }} />));
    expect(container.querySelector('[role="rowheader"] .bp-value')!.getAttribute('title')).toBe(label);
    const styles = tableStylesheet(resolveTheme());
    const labelRule = styles.match(/\[role="rowheader"\] \.bp-value\{([^}]+)\}/)![1]!;
    expect(labelRule).toContain('white-space:normal;overflow-wrap:normal');
    expect(labelRule).toContain('-webkit-line-clamp:2');
    expect(styles).toMatch(/\.bp-value,[^{]+\{[^}]*overflow:hidden;text-overflow:ellipsis/);
  });

  // A label column with no width never wrapped its names in a narrow card; the grid scrolled instead.
  it('keeps a long name on one line while the card has room and narrows the label track before the grid scrolls', () => {
    const selected = getFixtures('table').find((item) => item.id === 'long-campaign-names')! as Fixture<TableData, TableOptions>;
    const data = { ...selected.data, columns: selected.data.columns.map((column) => {
      if (column.kind !== 'rowLabel') return column;
      const { maxWidth: _cap, ...free } = column;
      return free;
    }) };
    const labelTrack = (width: number) => {
      act(() => root.render(<TableChart data={data} {...selected.options} size={{ width, height: 900 }} margin={{ top: 0, right: 0, bottom: 0, left: 0 }} />));
      const cols = container.querySelector<HTMLElement>('.bp-table-grid')!.style.getPropertyValue('--bp-cols');
      return Number.parseFloat(cols);
    };
    const wide = labelTrack(1200);
    const narrow = labelTrack(420);
    expect(narrow).toBeLessThan(wide);
  });

  // A cohort row kept its fixed 26 or 20 px pitch and cut the second line of a wrapped name.
  it('grows a cohort row by one line pitch for a two-line name, as the SVG layout does', async () => {
    const { layoutTable } = await import('../src/core/charts/table/layout');
    const name = 'Brand_Paid-Social_Segment-North_Broad_Prospecting_Lookalike-2pct_Video.Reels';
    const data: TableData = { columns: [{ id: 'label', kind: 'rowLabel', label: 'Ad set', maxWidth: 200 }, ...['m0', 'm1', 'm2'].map((id) => ({ id, kind: 'value' as const, label: id }))],
      rows: [{ id: 'long', label: name, cells: { m0: 100, m1: 82, m2: 67 } }, { id: 'short', label: 'Email', cells: { m0: 100, m1: 80, m2: 64 } }] };
    const css = tableStylesheet(resolveTargetTheme(undefined, 'dashboard'), 'dashboard', false, true);
    // React: the name lines sit 1.2em apart, and the block keeps the pitch's air less the rule above the cell.
    expect(css).toContain('[role="rowheader"] .bp-value{line-height:round(up,1.2em,1px);margin-block:calc((var(--bp-row-h) - round(up,1.2em,1px) - var(--bp-rule-top,var(--bp-stroke-hair)))/2)}');
    for (const density of ['cohort', 'cohort-small'] as const) {
      const pitch = Number(css.match(new RegExp(`\\[data-bp-density="${density}"\\]\\{[^}]*--bp-row-h:(\\d+)px`))![1]);
      const geometry = layoutTable(data, { density, target: 'dashboard', size: { width: 720 } });
      const label = geometry.scene.find((node) => node.id === 'cell:long:label') as { lines: string[]; font: { size: number } };
      expect(label.lines, density).toHaveLength(2);
      // React's row: pitch - rule + 2 lines of round(up, 1.2em) and the rule = pitch + one line.
      const line = Math.ceil(label.font.size * 1.2);
      expect(geometry.marks.rows.map((row) => row.h), density).toEqual([pitch + line, pitch]);
    }
  });

  // An unbounded name pushed the hovered value out of a card capped to a short canvas.
  it('fits a long name to the room a short sparkline card leaves and keeps the value row in the card', async () => {
    const { tableSparklineCard } = await import('../src/react/hover/sparklineCard');
    const name = Array.from({ length: 12 }, (_, i) => `Brand_Paid-Social_Segment-${i}`).join('_');
    const { table } = resolveTable({
      columns: [{ id: 'label', kind: 'rowLabel', label: 'Ad set' }, ...['m1', 'm2', 'm3', 'm4'].map((id) => ({ id, kind: 'value' as const, label: id }))],
      columnGroups: [{ id: 'months', label: 'months', columns: ['m1', 'm2', 'm3', 'm4'] }],
      rows: [{ id: 'row', label: name, cells: { m1: 3, m2: 5, m3: 4, m4: 6 } }],
    });
    const card = tableSparklineCard({
      record: { target: { owner: { rowId: 'row', colId: 'm2' } } } as Parameters<typeof tableSparklineCard>[0]['record'],
      table, columns: table.columns, theme: themeForWidth(resolveTargetTheme(undefined, 'dashboard'), 960),
      canvas: { x: 0, y: 0, w: 320, h: 200 }, measure: defaultMeasurer,
    })!;
    const nodes = card.geometry.scene;
    const title = nodes.find((node) => node.id === 'spark-card:title') as Extract<typeof nodes[number], { t: 'text' }>;
    const value = nodes.find((node) => node.id === 'spark-card:value') as Extract<typeof nodes[number], { t: 'text' }>;
    expect(title.lines.at(-1)).toMatch(/…$/);
    expect(title.title).toBe(name);
    expect(value.y + value.lines.length * value.font.size).toBeLessThanOrEqual(card.rect.h);
  });

  // On a nested row the React status square and its label shrank with the stepped row size while the SVG kept the body size.
  it('sizes the square status mark at the body size on every row level', () => {
    const css = tableStylesheet(resolveTargetTheme(undefined, 'report'), 'report');
    expect(css).toMatch(/\.bp-table-grid \.bp-status-mark\{[^}]*font-size:calc\(var\(--bp-label-size\) \+ var\(--bp-size-step\)\)/);
  });

  // The hover card ignored options.palette, so its tone lines printed another colour than the same line in the grid.
  it('prints the hover card tone lines in the grid colour of the selected palette', async () => {
    const { tableSparklineCard } = await import('../src/react/hover/sparklineCard');
    const fixture = getFixtures('table').find((f) => f.id === 'steering-kpi-rows')!;
    const { table } = resolveTable(fixture.data as TableData, fixture.options as TableOptions);
    const theme = resolveTheme('boardroom');
    let checked = 0;
    for (const colId of table.columnGroups.find((g) => g.id === 'months')!.columnIds) {
      const row = table.rows.find((r) => r.id === 'net-revenue')!;
      const card = tableSparklineCard({
        record: { target: { owner: { rowId: row.id, colId } } } as Parameters<typeof tableSparklineCard>[0]['record'],
        table, columns: table.columns, theme, palette: 'atlantic', canvas: { x: 0, y: 0, w: 480, h: 400 }, measure: defaultMeasurer,
      });
      const toned = (row.inlineRows ?? []).filter((line) => line.polarity !== undefined && line.cells[colId]?.tone !== undefined && line.cells[colId]?.tone !== 'neutral');
      for (const line of toned) {
        const node = card?.geometry.scene.find((n) => n.t === 'text' && n.lines.join(' ').includes(line.cells[colId]!.displayed) && n.id.includes('line'));
        expect(node, `${colId} ${line.id}`).toBeDefined();
        const tone = line.cells[colId]!.tone as 'good' | 'bad' | 'warn';
        expect(paintColor(theme, (node as { ink: Parameters<typeof paintColor>[1] }).ink)).toBe(paintColor(theme, toneTextPaint(theme, tone, 'atlantic')));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('uses the HTML viewport floor for automatic mode and honors explicit mode', () => {
    const mode = () => container.querySelector('figure')!.dataset.bpMode ?? 'full';
    renderTable({ size: undefined, mode: undefined });
    expect(mode()).toBe('full');
    // at or above the 100 x 80 floor the table is full; below it the
    // React table refuses, so compact is only ever authored here.
    renderTable({ size: { width: 124, height: 100 }, mode: undefined });
    expect(mode()).toBe('full');
    renderTable({ size: { width: 100, height: 80 }, mode: undefined });
    expect(mode()).toBe('full');
    renderTable({ size: { width: 124, height: 100 }, mode: 'compact' });
    expect(mode()).toBe('compact');
    renderTable({ size: { width: 500, height: 400 }, mode: 'compact' });
    expect(mode()).toBe('compact');
    expect(container.querySelector('.bp-scroll .bp-table-grid')).not.toBeNull();
  });
});

describe('TableChart reads the footer rule notes model', () => {
  const data: TableData = {
    columns: [{ id: 'label', kind: 'rowLabel', label: 'Item' }, { id: 'v', kind: 'value', label: 'Value' }],
    rows: [{ id: 'a', label: 'A', cells: { v: 10 } }],
  };
  const printed = () => Array.from(container.querySelectorAll('figure > .bp-footnotes li'), (li) => li.textContent);
  const listed = () => Array.from(container.querySelectorAll('.bp-notes .bp-footnotes li'), (li) => li.textContent);

  it('prints the author notes as notes in the frame and puts them behind the pointer under info and list', () => {
    act(() => root.render(<TableChart data={data} target="report" footnotes={['A limitation']} source="Example" />));
    expect(printed()).toEqual(['A limitation']);
    expect(container.querySelector('.bp-notes')).toBeNull();

    act(() => root.render(<TableChart data={data} target="dashboard" footnotes={['A limitation']} source="Example" />));
    expect(printed()).toEqual([]);
    expect(listed()).toEqual(['A limitation']);
    expect(container.querySelector('.bp-notes summary')!.textContent).toBe('Notes and sources (1)');
    // Print opens the notes: the list prints in place of the closed disclosure.
    expect(Array.from(container.querySelectorAll('.bp-notes-print li'), (li) => li.textContent)).toEqual(['A limitation']);
    expect(tableStylesheet(resolveTheme())).toContain('@media print{.bp-table .bp-notes{display:none}.bp-table .bp-notes-print{display:block}}');

    act(() => root.render(<TableChart data={data} target="report" notes={{ placement: 'list' }} footnotes={['A limitation']} />));
    expect(container.querySelector('.bp-notes summary')!.textContent).toBe('+1 note');

    act(() => root.render(<TableChart data={data} target="report" notes={{ placement: 'list', pointer: false }} footnotes={['A limitation']} />));
    expect(container.querySelector('.bp-notes')).toBeNull();
  });

  it('holds an authored notes.maxLines with the source line, and names the pointer in the locale', () => {
    act(() => root.render(<TableChart data={data} target="report" notes={{ maxLines: 2 }} footnotes={['First', 'Second']} source="Example" />));
    expect(printed()).toEqual(['First']);
    expect(listed()).toEqual(['Second']);
    act(() => root.render(<TableChart data={data} target="dashboard" locale={{ language: 'de' }} footnotes={['First']} />));
    expect(container.querySelector('.bp-notes summary')!.textContent).not.toBe('Notes and sources (1)');
  });

  it('ends a one-track table at the frame edge, and the rows at the last track under a capped label, as the SVG', () => {
    // every table ends at the frame edge; the label track takes the rest of the width.
    act(() => root.render(<TableChart data={data} target="report" size={{ width: 900, height: 200 }} />));
    expect(gridElement().style.getPropertyValue('--bp-cols')).toContain('1fr');
    const capped: TableData = { ...data, columns: [{ id: 'label', kind: 'rowLabel', label: 'Item', maxWidth: 120 }, data.columns[1]!] };
    act(() => root.render(<TableChart data={capped} target="report" size={{ width: 900, height: 200 }} />));
    expect(gridElement().style.getPropertyValue('--bp-table-width')).toMatch(/^\d+(\.\d+)?px$/);
    expect(gridElement().style.getPropertyValue('--bp-cols')).not.toContain('1fr');
  });
});

describe('TableChart footnotes track what is on screen ', () => {
  const withHiddenMarker: TableData = {
    columns: [
      { id: 'label', kind: 'rowLabel', label: 'Segment' },
      { id: 'v', kind: 'value', label: 'Revenue', format: '1.1' },
    ],
    rows: [
      {
        id: 'p',
        label: 'P',
        totalPolicy: 'source',
        cells: { v: 5 },
        children: [{ id: 'kid', label: 'Kid', cells: { v: { v: 5, state: 'suppressed' } } }],
      },
    ],
  };
  const note = '* Suppressed: value withheld, not missing.';
  const footnoteTexts = () =>
    Array.from(container.querySelectorAll('.bp-footnotes li')).map((li) => li.textContent);
  const markerCells = () =>
    Array.from(container.querySelectorAll('[role="gridcell"]')).filter(
      (cell) => cell.textContent?.includes('\u2013*') && cell.closest('.bp-children[data-bp-collapsed]') === null,
    );

  it('withholds the marker footnote while the only marked cell is collapsed, and prints it on expand', () => {
    act(() => {
      root.render(<TableChart data={withHiddenMarker} defaultCollapsed={['p']} notes={{ show: ['note', 'disclosure'] }} />);
    });
    // nothing on screen carries the marker, so nothing needs explaining
    expect(markerCells()).toHaveLength(0);
    expect(footnoteTexts()).not.toContain(note);

    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!.click();
    });
    // the marker is now visible — and so is the sentence that decodes it
    expect(markerCells()).toHaveLength(1);
    expect(footnoteTexts()).toContain(note);
  });
});

describe('TableChart document identity', () => {
  /**
   * Uncontrolled state initializers run once per mount. Replacing a document
   * in the same mounted instance must reset the state, or the
   * new table inherits the old one's collapsed ids and column visibility and
   * overrides its own defaults.
   */
  const doc = (prefix: string): TableData =>
    ({
      columns: [
        { id: 'label', kind: 'rowLabel', label: 'Item' },
        { id: `${prefix}-base`, kind: 'value', label: 'X' },
      ],
      rows: [
        { id: `${prefix}-parent`, label: 'Parent', cells: { [`${prefix}-base`]: 1 } },
        {
          id: `${prefix}-child`,
          label: 'Child',
          parentId: `${prefix}-parent`,
          cells: { [`${prefix}-base`]: 2 },
        },
      ],
    }) as unknown as TableData;

  const docA = doc('a');
  const docB = doc('b');
  // B is authored COLLAPSED. That is what lets this gate fail: state leaked from
  // A carries no 'b-parent', so a leaking instance shows B expanded while a fresh
  // mount shows it collapsed. Two documents that both defaulted to
  // expanded would agree with each other and pass even without the fix.
  const optionsB = { expansion: { collapsed: ['b-parent'] } } as unknown as TableOptions;

  const renderDoc = (data: TableData, options: TableOptions = {} as TableOptions): void => {
    act(() => {
      root.render(<TableChart data={data} {...options} />);
    });
  };

  it('reseeds collapse state when the document is replaced in a mounted instance', () => {
    renderDoc(docA);
    expect(rowIds()).toEqual(['a-parent', 'a-child']);

    click(container.querySelector<HTMLButtonElement>('.bp-tree-toggle')!);
    expect(rowIds()).toEqual(['a-parent']);

    renderDoc(docB, optionsB);
    const throughA = rowIds();

    act(() => root.unmount());
    container.remove();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    renderDoc(docB, optionsB);
    const freshB = rowIds();

    expect(freshB).toEqual(['b-parent']);
    expect(throughA).toEqual(freshB);
  });

  it('keeps reader state when only the VALUES change under the same structure', () => {
    renderDoc(docA);
    click(container.querySelector<HTMLButtonElement>('.bp-tree-toggle')!);
    const collapsedRows = rowIds();

    const sameShapeNewNumbers = {
      ...(docA as unknown as { columns: unknown[]; rows: { cells: unknown }[] }),
      rows: (docA as unknown as { rows: Record<string, unknown>[] }).rows.map((row) => ({
        ...row,
        cells: { 'a-base': 99 },
      })),
    } as unknown as TableData;
    renderDoc(sameShapeNewNumbers);

    // Structure is the reset key, so an expansion the reader made survives a pure
    // value update. Keying on the whole document would throw it away.
    expect(rowIds()).toEqual(collapsedRows);
  });

  it('distinguishes structural ID lists that collide under comma joining', () => {
    const collisionDoc = (parentId: string, childId: string): TableData => ({
      columns: [
        { id: 'label', kind: 'rowLabel', label: 'Item' },
        { id: 'v', kind: 'value', label: 'Value' },
      ],
      rows: [
        { id: parentId, label: 'Parent', cells: { v: 1 } },
        { id: childId, label: 'Child', parentId, cells: { v: 2 } },
      ],
    });
    const first = collisionDoc('a,b', 'c');
    const second = collisionDoc('a', 'b,c');

    renderDoc(first);
    click(container.querySelector<HTMLButtonElement>('.bp-tree-toggle')!);
    expect(rowIds()).toEqual(['a,b']);

    renderDoc(second, { expansion: { collapsed: ['a'] } } as TableOptions);
    const throughFirst = rowIds();

    act(() => root.unmount());
    container.remove();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    renderDoc(second, { expansion: { collapsed: ['a'] } } as TableOptions);

    expect(throughFirst).toEqual(['a']);
    expect(rowIds()).toEqual(throughFirst);
  });
});

describe('TableChart keyboard grid', () => {
  function press(target: Element, key: string): void {
    act(() => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    });
  }

  // Keyboard and screen-reader users must reach both ends and get current row positions when a tree folds.
  it('names the treegrid and navigates pages, edges and folds with logical indices', () => {
    const data: TableData = {
      columns: [{ id: 'label', kind: 'rowLabel', label: 'Item' }, { id: 'value', kind: 'value', label: 'Value' }],
      rows: [{ id: 'parent', label: 'Parent', cells: { value: 30 }, children: [
        { id: 'b', label: 'Child B', cells: { value: 20 } },
        { id: 'a', label: 'Child A', cells: { value: 10 } },
      ] }, { id: 'z', label: 'Last', cells: { value: 5 } }],
    };
    act(() => root.render(<TableChart data={data} title="Operations" defaultCollapsed={['parent']} />));
    const grid = gridElement();
    expect(grid.getAttribute('role')).toBe('treegrid');
    expect(grid.getAttribute('aria-label')).toBe('Operations');
    expect(grid.getAttribute('aria-rowcount')).toBe('3');
    const first = container.querySelector<HTMLElement>('[role="rowheader"][tabindex="0"]')!;
    act(() => first.focus());
    press(first, 'ArrowRight');
    expect(grid.getAttribute('aria-rowcount')).toBe('5');
    expect(Array.from(grid.querySelectorAll('[aria-rowindex]')).map(row => row.getAttribute('aria-rowindex'))).toEqual(['1', '2', '3', '4', '5']);
    expect(grid.querySelector('[data-row-id="b"]')?.getAttribute('aria-level')).toBe('2');
    // After expanding a parent, the next right arrow must enter its first child.
    press(first, 'ArrowRight');
    expect(document.activeElement?.getAttribute('data-bp-row')).toBe('b');
    expect(document.activeElement?.getAttribute('data-bp-column')).toBe('label');
    press(document.activeElement!, 'ArrowLeft');
    expect(document.activeElement).toBe(first);
    for (const [key, rowId, colId] of [['End', 'parent', 'value'], ['PageDown', 'z', 'value'], ['PageUp', 'parent', 'value']] as const) {
      press(document.activeElement!, key);
      expect(document.activeElement?.getAttribute('data-bp-row')).toBe(rowId);
      expect(document.activeElement?.getAttribute('data-bp-column')).toBe(colId);
    }
    for (const [key, rowId, colId] of [['End', 'z', 'value'], ['Home', 'parent', 'label']] as const) {
      act(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true })));
      expect(document.activeElement?.getAttribute('data-bp-row')).toBe(rowId);
      expect(document.activeElement?.getAttribute('data-bp-column')).toBe(colId);
    }
    press(document.activeElement!, 'Enter');
    expect(grid.getAttribute('aria-rowcount')).toBe('3');
    press(document.activeElement!, ' ');
    press(document.activeElement!, 'ArrowDown');
    press(document.activeElement!, 'ArrowLeft');
    expect(document.activeElement).toBe(first);
    expect(grid.querySelector('[data-row-id="z"] [role="gridcell"]')?.getAttribute('aria-colindex')).toBe('2');
  });

  // A label column after a value column must still take keyboard users up the tree, and a group must announce its first drawn column.
  it('keeps tree and group positions when the label column is not first', () => {
    const data: TableData = {
      columns: [
        { id: 'share', kind: 'value', label: 'Share' },
        { id: 'label', kind: 'rowLabel', label: 'Item' },
        { id: 'a', kind: 'value', label: 'A' },
        { id: 'b', kind: 'value', label: 'B' },
      ],
      columnGroups: [{ id: 'block', label: 'Block', columns: ['b', 'a'] }],
      rows: [{ id: 'parent', label: 'Parent', cells: { share: 1, a: 3, b: 4 }, children: [
        { id: 'child', label: 'Child', cells: { share: 2, a: 1, b: 2 } },
      ] }],
    };
    act(() => root.render(<TableChart data={data} />));
    expect(container.querySelector('[role="columnheader"][aria-colspan="2"]')?.getAttribute('aria-colindex')).toBe('3');
    const child = container.querySelector<HTMLElement>('[data-row-id="child"] [role="rowheader"]')!;
    act(() => child.focus());
    press(child, 'ArrowLeft');
    expect(document.activeElement?.getAttribute('data-bp-row')).toBe('parent');
    expect(document.activeElement?.getAttribute('data-bp-column')).toBe('label');
  });

  // PageDown must move one visible page, not the full height of an unconstrained table.
  it('limits page navigation to the window and an outer scroll box', () => {
    const data: TableData = {
      columns: [{ id: 'label', kind: 'rowLabel', label: 'Item' }, { id: 'value', kind: 'value', label: 'Value' }],
      rows: Array.from({ length: 100 }, (_, index) => ({ id: `r${index}`, label: `Item ${index}`, cells: { value: index } })),
    };
    act(() => root.render(<TableChart data={data} size={{ width: 800 }} />));
    const scroller = container.querySelector<HTMLElement>('.bp-scroll')!;
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 2000 });
    const first = container.querySelector<HTMLElement>('[data-row-id="r0"] [role="rowheader"]')!;
    const box = vi.spyOn(first.parentElement!, 'getBoundingClientRect').mockReturnValue({ height: 20 } as DOMRect);
    try {
      act(() => first.focus());
      press(first, 'PageDown');
      expect(document.activeElement?.getAttribute('data-bp-row')).toBe(`r${Math.floor(window.innerHeight / 20)}`);
      container.style.overflowY = 'auto';
      Object.defineProperty(container, 'clientHeight', { configurable: true, value: 100 });
      act(() => first.focus());
      press(first, 'PageDown');
      expect(document.activeElement?.getAttribute('data-bp-row')).toBe('r5');
    } finally { box.mockRestore(); }
  });

  it('keeps a roving tabindex on stable row and column ids', () => {
    renderTable({ stickyLabels: true, defaultColumnVisibility: { 'forecast-detail': true } });
    const start = container.querySelector<HTMLElement>('[data-bp-rowgroup="body"] [role="gridcell"]')!;
    const rowId = start.getAttribute('data-bp-row')!;
    const cols = Array.from(
      container.querySelectorAll<HTMLElement>(
        `[data-bp-rowgroup="body"] [role="row"][data-row-id="${rowId}"] [data-bp-column]:not([data-bp-hidden])`,
      ),
    ).map((cell) => cell.getAttribute('data-bp-column')!);
    expect(cols.length).toBeGreaterThan(2);
    act(() => start.focus());
    press(start, 'ArrowRight');
    const moved = document.activeElement as HTMLElement;
    expect(moved.getAttribute('data-bp-row')).toBe(rowId);
    expect(moved.getAttribute('data-bp-column')).toBe(cols[cols.indexOf(start.getAttribute('data-bp-column')!) + 1]);
    expect(moved.tabIndex).toBe(0);
    expect(start.tabIndex).toBe(-1);
    press(moved, 'ArrowDown');
    const down = document.activeElement as HTMLElement;
    expect(down.getAttribute('data-bp-column')).toBe(moved.getAttribute('data-bp-column'));
    expect(down.getAttribute('data-bp-row')).not.toBe(rowId);
  });

  it('keeps the focused row when a column group disappears', () => {
    renderTable({ stickyLabels: true, defaultColumnVisibility: { 'forecast-detail': true } });
    const detail = container.querySelector<HTMLElement>(
      '[data-bp-rowgroup="body"] [data-bp-row="seg-subscriptions"][data-bp-detail="forecast-detail"]',
    )!;
    const colId = detail.getAttribute('data-bp-column')!;
    act(() => detail.focus());
    expect(detail.tabIndex).toBe(0);
    click(container.querySelector('[data-bp-toggle-cols="forecast-detail"]')!);
    expect(container.querySelector(`[data-bp-column="${colId}"]:not([data-bp-hidden])`)).toBeNull();
    const kept = container.querySelector<HTMLElement>('[data-bp-rowgroup="body"] [tabindex="0"]')!;
    expect(kept.getAttribute('data-bp-row')).toBe('seg-subscriptions');
    expect(kept.getAttribute('data-bp-column')).not.toBe(colId);
  });
});

/**
 * `type.numeric` reaches the table too, where a digit grid is the point: no
 * `font-variant-numeric` on the table element, so the prose readout column and
 * the status badges do not carry tabular figures along with the numbers.
 */
describe('TableChart figures follow theme.type.numeric', () => {
  function receiptsFixture(): Fixture<TableData, TableOptions> {
    return getFixtures('table').find((candidate) => candidate.id === 'receipts-changelog')! as Fixture<TableData, TableOptions>;
  }
  function stylesheet(): string {
    return document.head.querySelector<HTMLStyleElement>('style[data-bp-table-theme]')!.textContent!;
  }
  function classesOf(columnId: string): string[] {
    return Array.from(container.querySelectorAll<HTMLElement>(`[data-bp-rowgroup="body"] [data-bp-column="${columnId}"]`))
      .map((cell) => cell.className);
  }

  it('declares tabular figures by default and proportional ones when the theme asks', () => {
    const selected = managementFixture();
    act(() => { root.render(<TableChart data={selected.data} {...selected.options} />); });
    expect(stylesheet()).toContain('font-variant-numeric:tabular-nums lining-nums');
    expect(stylesheet()).not.toContain('proportional-nums');

    act(() => {
      root.render(
        <TableChart data={selected.data} {...selected.options} theme={{ preset: 'standard', overrides: { type: { numeric: 'proportional' } } }} />,
      );
    });
    expect(stylesheet()).toContain('font-variant-numeric:proportional-nums lining-nums');
    expect(stylesheet()).not.toContain('tabular-nums');
  });

  it('puts the figures on the numeric cells and on nothing else', () => {
    const selected = managementFixture();
    act(() => { root.render(<TableChart data={selected.data} {...selected.options} />); });
    // No blanket declaration on the table element.
    expect(stylesheet()).not.toMatch(/\.bp-table-grid\[[^\]]*\]\{[^}]*font-variant-numeric/);
    // Alignment does not decide figures.
    expect(stylesheet()).not.toMatch(/\.bp-num\{[^}]*font-variant-numeric/);

    const table = gridElement();
    expect(table.querySelectorAll('[role="columnheader"].bp-figures')).toHaveLength(0);
    const rowLabels = Array.from(table.querySelectorAll<HTMLElement>('[role="rowheader"]'));
    expect(rowLabels.length).toBeGreaterThan(0);
    for (const label of rowLabels) expect(label.className).not.toContain('bp-figures');
    expect(table.querySelectorAll('[role="gridcell"].bp-figures').length).toBeGreaterThan(0);
  });

  it('leaves a readout column, a status badge and a written date without figures', () => {
    const selected = receiptsFixture();
    act(() => { root.render(<TableChart data={selected.data} {...selected.options} />); });
    for (const columnId of ['scope', 'change', 'status', 'date']) {
      const classes = classesOf(columnId);
      expect(classes.length, `no cells in column '${columnId}'`).toBeGreaterThan(0);
      for (const value of classes) expect(value, `column '${columnId}' carries figures`).not.toContain('bp-figures');
    }
  });
});

describe('the sparkline cell', () => {
  function sparklineFixture(): Fixture<TableData, TableOptions> {
    return getFixtures('table').find(
      (candidate) => candidate.id === 'kpi-trend-sparkline',
    )! as Fixture<TableData, TableOptions>;
  }

  function cellOf(rowId: string): HTMLElement {
    return container.querySelector<HTMLElement>(
      `[role="row"][data-row-id="${rowId}"] [data-bp-column="trend"]`,
    )!;
  }

  beforeEach(() => {
    const selected = sparklineFixture();
    act(() => { root.render(<TableChart data={selected.data} {...selected.options} />); });
  });

  it('draws the mini chart and keeps the sentence for a reader', () => {
    const cell = cellOf('revenue');
    const svg = cell.querySelector<SVGSVGElement>('svg.bp-spark')!;
    expect(svg).not.toBeNull();
    // The line, the endpoint dot and the last value the column already prints.
    expect(svg.querySelector('path')).not.toBeNull();
    expect(svg.querySelector('circle')).not.toBeNull();
    expect(svg.querySelector('text')?.textContent).toBe('112.0');
    // The drawing is aria-hidden, so the cell keeps a summary sentence, out of sight.
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    const summary = cell.querySelector<HTMLElement>('.bp-spark-text')!;
    expect(summary.textContent).toContain('→');
    expect(summary.textContent!.endsWith('112.0')).toBe(true);
  });

  it('breaks the line at a gap, exactly as the SVG does', () => {
    const { table } = resolveTable(sparklineFixture().data, sparklineFixture().options);
    const rows = visibleRows(table);
    const column = table.columns.find((candidate) => candidate.id === 'trend')!;
    const domains = sparklineDomains(table.columns, rows);
    const row = rows.find((candidate) => candidate.id === 'nps')!;
    const width = Number(cellOf('nps').querySelector('svg')!.getAttribute('width'));
    const expected = emitSparkline(
      {
        cell: row.cells.trend!,
        box: { x: 0, y: 0, w: width, h: 28 },
        // The type the frame's width class sets, as the SVG table takes it.
        // The React default now resolves report typography.
        theme: themeForWidth(resolveTargetTheme(undefined, 'report'), 558),
        measure: defaultMeasurer,
        nodeId: (suffix) => `${suffix}:${row.id}:${column.id}`,
        owner: { rowId: row.id, colId: column.id },
      },
      [44, null, 48, 51, null, 55],
      { kind: 'line', domain: domains.get('trend')!, lastText: '55.0' },
    );
    const paths = Array.from(cellOf('nps').querySelectorAll('path')).map((path) => path.getAttribute('d'));
    const drawn = expected.filter((node) => node.t === 'path').map((node) => (node as { d: string }).d);
    expect(paths).toEqual(drawn);
  });

  /**
   * The drawing fills the track the way the SVG surface does, so the cell
   * gives it the whole track: with the cell's 12 px of air on each side the
   * endpoint and its label sit outside `.bp-value`, which clips, and both
   * are cut off.
   */
  it('draws across the whole track, with no cell padding to clip it', () => {
    const cell = cellOf('revenue');
    expect(cell.dataset.encoding).toBe('sparkline');
    const grid = container.querySelector<HTMLElement>('.bp-table-grid')!;
    const tracks = grid.style.getPropertyValue('--bp-cols').split(' ').map(Number.parseFloat);
    const columns = Array.from(container.querySelectorAll<HTMLElement>('.bp-columns [data-col-id]'))
      .map((header) => header.dataset.colId);
    const track = tracks[columns.indexOf('trend')]!;
    expect(Number(cell.querySelector('svg')!.getAttribute('width'))).toBe(track);
    const stylesheet = document.head.querySelector<HTMLStyleElement>('style[data-bp-table-theme]')!.textContent!;
    expect(stylesheet).toMatch(/\[role="row"\]>\[data-encoding="sparkline"\]\{padding:0;/);
  });

  it('says nothing where a row has no observation', () => {
    const cell = cellOf('pending');
    // The drawing prints the missing glyph and the hidden summary says the same.
    expect(cell.querySelector<SVGSVGElement>('svg.bp-spark text')!.textContent).toBe('\u2013');
    expect(cell.querySelector<HTMLElement>('.bp-spark-text')!.textContent).toBe('\u2013');
  });
});

describe('TableChart in the host document', () => {
  const small: TableData = {
    columns: [{ id: 'name', kind: 'rowLabel', label: 'Region' }, { id: 'rev', kind: 'value', label: 'Revenue', format: '1,234.5' }],
    rows: [{ id: 'a', label: 'North America and Caribbean', cells: { rev: 17512.25 } }],
  };

  it('mounts its stylesheet in the shadow root it renders in ', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const mount = document.createElement('div');
    shadow.append(mount);
    const shadowRoot = createRoot(mount);
    act(() => shadowRoot.render(<TableChart data={small} />));
    expect(shadow.querySelectorAll('style[data-bp-table-theme]')).toHaveLength(1);
    expect(document.head.querySelectorAll('style[data-bp-table-theme]')).toHaveLength(0);
    act(() => shadowRoot.unmount());
    host.remove();
  });

  it('puts its idPrefix on the summary id, so separately rendered tables do not share it', () => {
    const summaryIds = ['left', 'right'].map((idPrefix) => /id="(bp-table-summary-[^"]+)"/.exec(renderToString(<TableChart data={small} idPrefix={idPrefix} />))![1]);
    expect(summaryIds[0]).toMatch(/^bp-table-summary-left-/);
    expect(summaryIds[1]).toMatch(/^bp-table-summary-right-/);
  });

  it('mounts its stylesheet in the head of the iframe document it renders in', () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const inner = frame.contentDocument!;
    const mount = inner.createElement('div');
    inner.body.append(mount);
    const frameRoot = createRoot(mount);
    act(() => frameRoot.render(<TableChart data={small} />));
    expect(inner.head.querySelectorAll('style[data-bp-table-theme]')).toHaveLength(1);
    expect(document.head.querySelectorAll('style[data-bp-table-theme]')).toHaveLength(0);
    act(() => frameRoot.unmount());
    frame.remove();
  });

  // The table keeps the first canvas context it gets for the whole module, so every canvas mock reads one advance.
  let canvasAdvance = 9;
  const mockCanvas = () => vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({ font: '', measureText: (text: string) => ({ width: text.length * canvasAdvance }) })) as never);
  it('measures its tracks with the canvas once hydration has drawn the server tracks ', async () => {
    const html = renderToString(<TableChart data={small} />);
    const serverTracks = /--bp-cols:([^;"]+)/.exec(html)![1];
    Object.defineProperty(document, 'fonts', { value: { ready: Promise.resolve() }, configurable: true });
    const canvas = mockCanvas();
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.append(host);
    const errors = vi.fn();
    let hydrated: Root | undefined;
    try {
      await act(async () => { hydrated = hydrateRoot(host, <TableChart data={small} />, { onRecoverableError: errors }); });
      expect(errors).not.toHaveBeenCalled();
      expect(host.querySelector<HTMLElement>('.bp-table-grid')!.style.getPropertyValue('--bp-cols')).not.toBe(serverTracks);
    } finally {
      act(() => hydrated?.unmount());
      canvas.mockRestore();
      Reflect.deleteProperty(document, 'fonts');
      host.remove();
    }
  });
  // A web font the page first asks for when the table draws its text loads after `fonts.ready` has resolved. The
  // tracks kept the fallback face's widths, and the wider face cut the text columns ("2026-10-26 15…").
  it('measures its tracks again when a font face loads after the first measure', async () => {
    const fonts = Object.assign(new EventTarget(), { ready: Promise.resolve() });
    Object.defineProperty(document, 'fonts', { value: fonts, configurable: true });
    const canvas = mockCanvas();
    const data = {
      columns: [{ id: 'label', kind: 'rowLabel', label: 'Shipment' }, { id: 'updated', kind: 'text', label: 'Last update' }],
      rows: [{ id: 'dock', label: 'Dock cargo', cells: { updated: '2026-10-26 15:42' } }],
    } as TableData;
    const updatedTrack = () => Number.parseFloat(container.querySelector<HTMLElement>('.bp-table-grid')!.style.getPropertyValue('--bp-cols').split(' ')[1]!);
    try {
      await act(async () => { root.render(<TableChart data={data} />); });
      const before = updatedTrack();
      canvasAdvance = 14;
      await act(async () => { fonts.dispatchEvent(new Event('loadingdone')); });
      expect(updatedTrack()).toBeGreaterThanOrEqual('2026-10-26 15:42'.length * 14);
      expect(updatedTrack()).toBeGreaterThan(before);
    } finally {
      canvasAdvance = 9;
      canvas.mockRestore();
      Reflect.deleteProperty(document, 'fonts');
    }
  });
});

describe('the grid draws the SVG table ', () => {
  const fixtureOf = (id: string) => getFixtures('table').find((candidate) => candidate.id === id)! as Fixture<TableData, TableOptions>;
  const tracks = () => container.querySelector<HTMLElement>('.bp-table-grid')!.style.getPropertyValue('--bp-cols')
    .split(' ').map(Number.parseFloat);

  it('takes the SVG tracks at the frame width class, the prose column in the room the others leave ', async () => {
    const { layoutResolvedRequest, resolveChartRequest } = await import('../src/core/request');
    for (const id of ['table-scorecard', 'fatigue-cell-encodings']) {
      const fixture = fixtureOf(id);
      act(() => { root.render(<TableChart data={fixture.data} {...fixture.options} measureWidths="tables" />); });
      const laid = layoutResolvedRequest(resolveChartRequest({ type: 'table', data: fixture.data, options: fixture.options }));
      if (laid.refused) throw new Error(`${id} refused`);
      const svg = (laid.marks as { columns: { w: number }[] }).columns.map((column) => column.w);
      // jsdom measures with the metric tables plus the slack a browser draws
      // a bold head with, a few px per track; the grid drew the base type in
      // an L frame and ran 9 to 11 px short on every track of the fatigue
      // table. The browser capture measures within 1 px.
      const drawn = tracks().slice(0, svg.length);
      drawn.forEach((track, index) => expect(Math.abs(track - svg[index]!), `${id} column ${index}`).toBeLessThanOrEqual(6));
    }
  });

  it('sets a direction arrow before each change the SVG sets one before ', () => {
    const fixture = fixtureOf('fatigue-cell-encodings');
    act(() => { root.render(<TableChart data={fixture.data} {...fixture.options} />); });
    expect(Array.from(container.querySelectorAll('[data-bp-column="dCpa"] .bp-arrow'), (arrow) => arrow.textContent)).toEqual(['↑', '↘', '↗', '↑']);
  });

  it('angles the arrows against the rows it draws when a collapsed subtree holds the largest change', () => {
    const data: TableData = {
      columns: [
        { id: 'label', kind: 'rowLabel', label: 'Line' },
        { id: 'prev', kind: 'value', label: 'Prior', format: '1' },
        { id: 'cur', kind: 'value', label: 'Current', format: '1' },
        { id: 'delta', kind: 'computed', label: 'Change', calc: { op: 'percentDelta', a: 'cur', b: 'prev' }, polarity: 'higherIsBetter', format: '+1.1%' },
      ],
      rows: [
        // g sums to 110 and 121, +10%; its child c1 grows +100%, the largest change.
        { id: 'g', label: 'Group', children: [
          { id: 'c1', label: 'Fast', cells: { prev: 10, cur: 20 } },
          { id: 'c2', label: 'Slow', cells: { prev: 100, cur: 101 } },
        ] },
        { id: 'h', label: 'Other', cells: { prev: 100, cur: 105 } },
      ],
    };
    act(() => { root.render(<TableChart data={data} encodings={{ delta: { type: 'arrow', scale: 'relative' } }} collapsed={['g']} />); });
    const glyph = (rowId: string) => container.querySelector(`[data-bp-row="${rowId}"][data-bp-column="delta"] .bp-arrow`)?.textContent;
    const key = Array.from(container.querySelectorAll('.bp-key .bp-key-glyph'), (node) => node.textContent);
    // Against the drawn +10%, +5% is half the largest change: both rise straight.
    // Against the hidden +100% both took the angled arrow, which the key did not list.
    expect({ g: glyph('g'), h: glyph('h'), key }).toEqual({ g: '↑', h: '↑', key: ['↑'] });
  });
});

describe('a banded block closes on its right edge', () => {
  const fixtureOf = (id: string) => getFixtures('table').find((candidate) => candidate.id === id)! as Fixture<TableData, TableOptions>;

  it('draws the divider after the block in the SVG and the grid alike, once where a group opens there', async () => {
    const { layoutTable } = await import('../src/core/charts/table/layout');
    const dividers = (geometry: ReturnType<typeof layoutTable>) => new Set(geometry.scene
      .filter((node) => node.t === 'line' && node.part === 'tableGroupDivider' && node.x1 === node.x2)
      .map((node) => (node as { x1: number }).x1));
    // The steering table: the banded block is the last drawn column
    // and the rows reach on to the frame.
    const steering = fixtureOf('steering-table-v2');
    const framed = { ...steering.options, rowExtent: 'frame' as const };
    const geometry = layoutTable(steering.data, framed);
    const total = geometry.marks.columns.find((column) => column.id === 'fy')!;
    const ytd = geometry.marks.columns.find((column) => column.id === 'ytd')!;
    act(() => { root.render(<TableChart data={steering.data} {...framed} />); });
    const closes = Array.from(container.querySelectorAll('[data-bp-group-end]'), (node) => node.getAttribute('data-bp-column') ?? node.getAttribute('data-group-id'));
    // A band run followed by a plain column: that column opens with the divider.
    const run: TableData = {
      columns: [
        { id: 'label', kind: 'rowLabel', label: 'Line' },
        { id: 'a', kind: 'value', label: 'A', format: '1' },
        { id: 'b', kind: 'value', label: 'B', format: '1', band: true },
        { id: 'c', kind: 'value', label: 'C', format: '1' },
      ],
      rows: [{ id: 'r', label: 'Row', cells: { a: 1, b: 2, c: 3 } }],
    };
    const runGeometry = layoutTable(run, { size: { width: 480, height: 160 } });
    const c = runGeometry.marks.columns.find((column) => column.id === 'c')!;
    act(() => { root.render(<TableChart data={run} size={{ width: 480, height: 160 }} />); });
    const opensAfterRun = container.querySelector('.bp-columns [data-col-id="c"]')!.hasAttribute('data-bp-group-start');
    expect({
      // The block's right edge in the last pixel of FY25 Total, and one line
      // where FY25 Total opens after the YTD block.
      svgClose: dividers(geometry).has(Math.round(total.x + total.w) - 1 + 0.5),
      svgOnceAfterYtd: geometry.scene.filter((node) => node.t === 'line' && node.part === 'tableGroupDivider'
        && node.x1 === Math.round(ytd.x + ytd.w) + 0.5 && node.y1 === Math.min(...geometry.scene.filter((line) => line.t === 'line' && line.part === 'tableGroupDivider').map((line) => (line as { y1: number }).y1))).length,
      reactCloses: closes.includes('fy'),
      svgAfterRun: dividers(runGeometry).has(Math.round(c.x) + 0.5),
      reactAfterRun: opensAfterRun,
    }).toEqual({ svgClose: true, svgOnceAfterYtd: 1, reactCloses: true, svgAfterRun: true, reactAfterRun: true });
  });
});

// Every heat scale must have a readable key on both surfaces, with no duplicate key for equal scales.
it('explains distinct heat scales with their columns in SVG and React', async () => {
  const { render } = await import('../src/cli/render');
  const data = { columns: [{ id: 'label', kind: 'rowLabel' as const, label: 'Item' },
    ...['a', 'b', 'c'].map(id => ({ id, kind: 'value' as const, label: `Rate ${id.toUpperCase()}` }))],
    rows: [{ id: 'r1', label: 'First', cells: { a: 15, b: 150, c: 15 } },
      { id: 'r2', label: 'Second', cells: { a: 25, b: 250, c: 25 } }] };
  const heat = (bins: number[]) => ({ type: 'heat' as const, scale: 'absolute' as const, bins, steps: 3 });
  for (const same of [false, true]) {
    const options = { encodings: { a: heat([10, 20]), b: heat(same ? [10, 20] : [100, 200]), c: heat([10, 20]) }, size: { width: 960, height: 500 } };
    const result = render({ spec: { type: 'table', data, options }, return: ['svg'] });
    expect(result.body.ok).toBe(true);
    const svg = new DOMParser().parseFromString(result.body.svg as string, 'image/svg+xml');
    const svgLabels = Array.from(svg.querySelectorAll('text[data-id^="frame:legendLabel"]')).map(node => node.textContent);
    const html = document.createElement('div');
    html.innerHTML = renderToString(<TableChart data={data} {...options} />);
    const reactLabels = Array.from(html.querySelectorAll('[aria-label="Key"] [role="listitem"]')).map(node => node.textContent);
    expect(svgLabels).toEqual(reactLabels);
    expect(reactLabels).toEqual(same ? ['under 10.0', '10.0 to under 20.0', '20.0 and more'] : [
      'Rate A, Rate C: under 10.0', 'Rate A, Rate C: 10.0 to under 20.0', 'Rate A, Rate C: 20.0 and more',
      'Rate B: under 100', 'Rate B: 100 to under 200', 'Rate B: 200 and more',
    ]);
    const row = html.querySelector('[role="row"][data-row-id="r1"]');
    expect(row?.textContent).toContain('150');
    expect(svg.documentElement.textContent).toContain('150');
  }
});

// A host that reads onWarnings must learn that an authored width was widened or cuts text, as the CLI reports it.
it('reports authored column widths through onWarnings', () => {
  const onWarnings = vi.fn();
  const data: TableData = {
    columns: [{ id: 'l', kind: 'rowLabel' }, { id: 'note', kind: 'text', label: 'Status note', width: 30 }, { id: 'd', kind: 'value', label: '18', width: 14 }],
    rows: [{ id: 'r', label: 'North', cells: { note: 'On track this week', d: 44 } }],
  };
  act(() => root.render(<TableChart data={data} onWarnings={onWarnings} />));
  expect(onWarnings.mock.lastCall?.[0].map((warning: { code: string }) => warning.code)).toEqual(expect.arrayContaining(['table-column-clipped', 'table-column-widened']));
});

// A wrapped text column must warn when its header fits only without the sort chevron and trailing tracking.
it('warns when a wrapped column clips its sortable heading', () => {
  const onWarnings = vi.fn();
  const data: TableData = {
    columns: [{ id: 'l', kind: 'rowLabel' }, { id: 'note', kind: 'text', label: 'Note', width: 70, wrap: true }],
    rows: [{ id: 'r', label: 'North', cells: { note: 'ok' } }],
  };
  for (const sortable of [false, true]) {
    act(() => root.render(<TableChart data={data} theme="standard" sortable={sortable} onWarnings={onWarnings} />));
    const clipped = onWarnings.mock.lastCall?.[0].filter((warning: { code: string; owner?: { colId?: string } }) => warning.code === 'table-column-clipped' && warning.owner?.colId === 'note');
    expect(clipped, JSON.stringify(clipped)).toHaveLength(sortable ? 1 : 0);
  }
});

// The grid must print a toned figure in the SVG's colour when the table selects a palette.
it('paints grid tone text from the selected palette', () => {
  const theme = resolveTheme('boardroom');
  expect(tableStylesheet(theme, undefined, false, false, false, 1, 'atlantic')).toContain(`--bp-good-text:${paintColor(theme, toneTextPaint(theme, 'good', 'atlantic'))}`);
});

// Under textScale the grid's section heading must take the SVG's size, not an older override after it.
it('sizes the section heading from the shared face under textScale', () => {
  const theme = resolveTheme();
  const size = tableFonts(theme, levelLadder(theme, 'regular', 'dashboard', 1.25)).section.size;
  const rules = [...tableStylesheet(theme, 'dashboard', false, false, false, 1.25).matchAll(/\[data-role="section"\]\{--bp-row-size:([^}]*)\}/g)].map((match) => match[1]);
  expect(rules.at(-1)).toBe(`calc(${size}px + var(--bp-size-step))`);
});

// A scrolling table must retain authored tracks even when the fixed SVG frame must narrow them.
it('keeps authored tracks in a scrolling host and shares the SVG natural width', async () => {
  const { layoutResolvedRequest, resolveChartRequest } = await import('../src/core/request');
  const data: TableData = {
    columns: [{ id: 'label', kind: 'rowLabel', label: 'Item', width: 360 },
      { id: 'actual', kind: 'value', label: 'Actual', width: 90 }],
    rows: [{ id: 'north', label: 'North', cells: { actual: 12 } }],
  };
  const options: TableOptions = { size: { width: 375 }, margin: { left: 0, right: 0, top: 0, bottom: 0 } };
  act(() => root.render(<TableChart data={data} {...options} measureWidths="tables" />));
  const result = layoutResolvedRequest(resolveChartRequest({ type: 'table', data, options }));
  if (result.refused) throw new Error('The table must fit the frame.');
  const svg = (result.marks as { columns: { w: number }[] }).columns.map(column => column.w);
  const react = gridElement().style.getPropertyValue('--bp-cols').split(' ').slice(0, 2).map(Number.parseFloat);
  expect(svg).toEqual([285, 90]);
  expect(react).toEqual([360, 90]);
  expect(result.sizing?.naturalWidth).toBe(react.reduce((sum, width) => sum + width, 0));
  act(() => root.render(<TableChart data={data} {...options} size={{ width: 720 }} measureWidths="tables" />));
  expect(gridElement().style.getPropertyValue('--bp-cols').split(' ').slice(0, 2).map(Number.parseFloat)).toEqual([360, 90]);
  const wide = layoutResolvedRequest(resolveChartRequest({ type: 'table', data, options: { ...options, size: { width: 720 } } }));
  if (wide.refused) throw new Error('The wider table must fit.');
  expect((wide.marks as { columns: { w: number }[] }).columns.map(column => column.w)).toEqual([360, 90]);
});

// A polarity number must keep its chip and page-side ink even on a dark total ground.
it('draws polarity chips with the SVG paints on total grounds', () => {
  const data: TableData = { columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value' }],
    rows: [{ id: 'total', role: 'total', label: 'Total', cells: { v: { v: 12, tone: 'good' } } }] };
  act(() => root.render(<TableChart data={data} encodings={{ v: 'polarityBadge' }} measureWidths="tables" />));
  expect(container.querySelector('[data-bp-row="total"][data-bp-column="v"] .bp-polarity-badge')?.textContent).toBe('12.0');
});

// A status chip must not acquire the extra figure ground that the SVG leaves out.
it('marks only value cells for tone grounds', () => {
  const data: TableData = { columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value' }, { id: 's', kind: 'status' }],
    rows: [{ id: 'r', label: 'North', cells: { v: { v: 12, tone: 'good' }, s: 'on-track' } }] };
  act(() => root.render(<TableChart data={data} measureWidths="tables" />));
  expect(container.querySelector('[data-bp-row="r"][data-bp-column="v"]')?.getAttribute('data-bp-figure')).toBe('');
  expect(container.querySelector('[data-bp-row="r"][data-bp-column="s"]')?.hasAttribute('data-bp-figure')).toBe(false);
});

// A theme without tertiary ink must still print state glyphs in muted ink.
it('keeps state glyphs in the secondary ink without a tertiary theme colour', () => {
  const theme = resolveTheme('standard');
  delete theme.color.inkMeta;
  const css = tableStylesheet(theme, undefined, undefined);
  expect(css).toContain('.bp-line[data-state]{color:var(--bp-ink-2)}');
});

// A fixed frame must fill its last natural track and keep an authored last width unchanged.
it('fills only an unauthored last track at a fixed or container width', () => {
  const data = (fixed = false): TableData => ({ columns: [
    { id: 'label', kind: 'rowLabel', label: 'Item', ...(fixed ? { width: 100 } : {}) },
    { id: 'v', kind: 'value', label: 'Value', ...(fixed ? { width: 100 } : {}) }], rows: [{ id: 'r', label: 'Row', cells: { v: 10 } }] });
  const natural = renderToString(<TableChart data={data()} size={{ width: 800 }} margin={{ left: 0, right: 0 }} rowExtent="tracks" lastTrackFlex measureWidths="tables" />);
  container.innerHTML = natural;
  expect(gridElement().style.getPropertyValue('--bp-table-width')).toBe('800px');
  container.innerHTML = renderToString(<TableChart data={data(true)} size="container" fallbackSize={{ width: 800, height: 100 }} fit="fill" margin={{ left: 0, right: 0 }} rowExtent="tracks" lastTrackFlex measureWidths="tables" />);
  expect(gridElement().style.getPropertyValue('--bp-cols')).toBe('100px 100px');
  container.innerHTML = '';
});

// A hoisted magnitude must reach both frames, with the same single warning and a working fix for the ignored raw unit.
it('prints the resolved table unit in both frames', () => {
  const data: TableData = { columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value', format: '$1.2k' }], rows: [{ id: 'r', label: 'North', cells: { v: 8743 } }] };
  const options = { unit: '$', subtitle: { measure: 'Revenue' } };
  const geometry = requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'table', data, options })));
  const subtitle = geometry.scene.find(n => n.t === 'text' && n.id === 'frame:subtitle:0');
  expect(subtitle?.t === 'text' && subtitle.lines.join(' ').replace(/\s/g, ' ')).toBe('Revenue in $k');
  const warnings = geometry.warnings.filter(warning => warning.code === 'table-unit-overridden');
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toMatchObject({ field: ['options', 'unit'], fix: [{ op: 'remove', path: '/options/unit' }] });
  const onWarnings = vi.fn();
  act(() => root.render(<TableChart data={data} {...options} onWarnings={onWarnings} measureWidths="tables" />));
  expect(container.textContent?.replace(/\s/g, ' ')).toContain('Revenue in $k');
  expect(onWarnings.mock.calls.at(-1)?.[0].filter((warning: { code: string }) => warning.code === 'table-unit-overridden')).toEqual(warnings);
  expect(resolveTable(data, { subtitle: options.subtitle }).warnings.some(warning => warning.code === 'table-unit-overridden')).toBe(false);
  expect(resolveTable(data, { ...options, unit: '$k' }).warnings.some(warning => warning.code === 'table-unit-overridden')).toBe(false);
});

// A bare shared scale ('1.2bn') replaced options.unit in the frame, so "Revenue in B" printed with the currency nowhere.
it('keeps the currency of options.unit in front of a shared bare scale', () => {
  const data: TableData = { columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value', format: '1.2bn' }], rows: [{ id: 'r', label: 'North', cells: { v: 2500000000 } }] };
  const unitOf = (unit: string) => {
    const { table, warnings } = resolveTable(data, { subtitle: { measure: 'Revenue' }, unit });
    return { unit: table.unit, overridden: warnings.some(warning => warning.code === 'table-unit-overridden') };
  };
  expect(unitOf('EUR')).toEqual({ unit: 'EUR B', overridden: false });
  expect(unitOf('EUR bn')).toEqual({ unit: 'EUR bn', overridden: false });
  expect(unitOf('$m')).toEqual({ unit: 'B', overridden: true });
  // A scale word that is not the last word still counts: it never gets a second scale appended.
  expect(unitOf('Mio. EUR')).toEqual({ unit: 'B', overridden: true });
  expect(unitOf('k EUR')).toEqual({ unit: 'B', overridden: true });
  expect(unitOf('EUR bn (adj.)')).toEqual({ unit: 'EUR bn (adj.)', overridden: false });
  expect(unitOf('Mrd. EUR')).toEqual({ unit: 'Mrd. EUR', overridden: false });
  // A scale glued to the currency ('USDbn') or in another language ('Md') is not a bare currency, so it never gets a second scale.
  for (const unit of ['USDbn', 'EURm', 'kEUR', 'EUR Md']) expect(unitOf(unit)).toEqual({ unit: 'B', overridden: true });
  const de = resolveTable({ ...data, columns: [data.columns[0]!, { id: 'v', kind: 'value', format: '1,2 Mrd' }] }, { subtitle: { measure: 'Umsatz' }, unit: 'Mio. EUR', locale: { decimal: ',', thousands: '.' } });
  expect(de.warnings.some(warning => warning.code === 'table-unit-overridden')).toBe(true);
  expect(de.table.unit).not.toContain('Mio.');
});

// Row formats ('$1.2k') hoist their own currency; unformatted columns carry no affix, so they must not make the unit look bare.
it('does not compose options.unit with a unit hoisted from row formats', () => {
  const data: TableData = {
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value' }],
    rows: [{ id: 'a', label: 'North', format: '$1.2k', cells: { v: 2500 } }, { id: 'b', label: 'South', format: '$1.2k', cells: { v: 1800 } }],
  };
  for (const unit of ['EUR', '$']) {
    const { table, warnings } = resolveTable(data, { magnitude: 'thousand', unit, subtitle: { measure: 'Revenue' } });
    expect(table.unit).toBe('$k');
    expect(warnings.some(warning => warning.code === 'table-unit-overridden')).toBe(true);
  }
});
