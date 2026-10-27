// @vitest-environment jsdom
/**
 * A depth control on a mounted table: the table follows the new expansion in
 * place, a fold that mounts on open also closes with its fold, the focus
 * follows a closed row to its parent, the host can tell the reader's own
 * folds from its depth step, and the totals step shows the totals.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '../src/core/charts';
import { getFixtures } from '../src/fixtures';
import { resolveTable } from '../src/core/charts/table/resolve';
import { collapsedByDefault, expansionRootsHidden, visibleRows } from '../src/core/charts/table/view';
import { exampleData } from '../src/core/charts/dimswitch/example';
import { dimswitchRowId } from '../src/core/charts/dimswitch/compile';
import type { Fixture } from '../src/core/registry';
import type { TableData, TableOptions } from '../src/core/types/table';
import { TableChart } from '../src/react';
import { DimSwitchChart } from '../src/react/DimSwitchChart';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const report = getFixtures('table').find((fixture) => fixture.id === 'management-report')! as Fixture<TableData, TableOptions>;
const drawReport = (props: Partial<React.ComponentProps<typeof TableChart>>) =>
  act(() => root.render(<TableChart data={report.data} {...report.options} {...props} />));
/** The rows on screen: a row inside a folded subtree is not. */
const shownRows = () => Array.from(host.querySelectorAll<HTMLElement>('[data-bp-rowgroup="body"] [role="row"]'))
  .filter((row) => row.closest('.bp-children[data-bp-collapsed]') === null)
  .map((row) => row.dataset.rowId!);
const expectedRows = (options: TableOptions) => {
  const { table } = resolveTable(report.data, options);
  return visibleRows(table, collapsedByDefault(table), expansionRootsHidden(table, options.expansion)).map((row) => row.id);
};
const rowToggle = (id: string) => host.querySelector<HTMLButtonElement>(`[data-row-id="${CSS.escape(id)}"] [data-bp-toggle-row]`)!;

it('follows a new expansion depth on the mounted table and keeps its column toggles and scroll', () => {
  drawReport({ expansion: { depth: 'all' } });
  const grid = host.querySelector('.bp-table-grid');
  const toggle = host.querySelector<HTMLButtonElement>('.bp-col-toggle[aria-pressed="true"]')!;
  act(() => toggle.click());
  const scroller = host.querySelector<HTMLElement>('.bp-scroll')!;
  scroller.scrollLeft = 40;
  drawReport({ expansion: { depth: 1 } });
  expect(shownRows()).toEqual(expectedRows({ ...report.options, expansion: { depth: 1 } }));
  expect(host.querySelector('.bp-table-grid')).toBe(grid);
  expect(host.querySelector(`.bp-col-toggle[data-bp-toggle-cols="${toggle.dataset.bpToggleCols}"]`)?.getAttribute('aria-pressed')).toBe('false');
  expect(scroller.scrollLeft).toBe(40);
});

it('reports the reader fold as an expansion, and the authored lists again once the fold is undone', () => {
  const reports: unknown[] = [];
  drawReport({ onExpansionChange: (expansion) => reports.push(expansion) });
  act(() => rowToggle('seg-subscriptions').click());
  act(() => rowToggle('seg-subscriptions').click());
  act(() => rowToggle('seg-unallocated').click());
  // The authored view is depth 1 with seg-unallocated folded: folding Subscriptions and opening Unallocated are the reader's own.
  expect(reports).toEqual([
    { depth: 1, collapsed: ['seg-unallocated', 'seg-subscriptions'] },
    { depth: 1, collapsed: ['seg-unallocated'] },
    { depth: 1, expanded: ['seg-unallocated'] },
  ]);
});

it('shows the totals at the totals step, and the folded top rows on a table without a total', () => {
  drawReport({ expansion: { depth: 'totals' } });
  expect(shownRows()).toEqual(['total']);
  const sections = getFixtures('table').find((fixture) => fixture.id === 'monthly-kpi-sections')! as Fixture<TableData, TableOptions>;
  act(() => root.render(<TableChart data={sections.data} {...sections.options} expansion={{ depth: 'totals' }} />));
  const { table } = resolveTable(sections.data, sections.options);
  const roots = table.rows.filter((row) => row.role === 'data' && (row.parentId === undefined || table.rows.find((parent) => parent.id === row.parentId)?.role === 'section'));
  // Every section heading and every top data row shows, each top row folded.
  expect(shownRows()).toEqual(table.rows.filter((row) => row.role === 'section' || roots.includes(row)).map((row) => row.id));
  expect(roots.filter((row) => row.hasChildren).every((row) => rowToggle(row.id).getAttribute('aria-expanded') === 'false')).toBe(true);
});

it('moves the focus to the parent when the focused row closes', () => {
  drawReport({ expansion: { depth: 'all' } });
  const child = host.querySelector<HTMLElement>('[role="row"][data-parent-id="seg-subscriptions"]')!.dataset.rowId!;
  const cell = host.querySelector<HTMLElement>(`[data-bp-row="${child}"][data-bp-column]`)!;
  act(() => cell.focus());
  drawReport({ expansion: { depth: 0 } });
  expect(document.activeElement?.closest('[role="row"]')?.getAttribute('data-row-id')).toBe('seg-subscriptions');
});

const orders = dimswitchRowId('by-measure', 'total', 'orders');
const drawSwitch = (props: Partial<React.ComponentProps<typeof DimSwitchChart>> = {}) =>
  act(() => root.render(<DimSwitchChart data={exampleData} variant="by-measure" depth={2} {...props} />));
const transitionEnd = (element: Element) => act(() => {
  element.dispatchEvent(Object.assign(new Event('transitionend', { bubbles: true }), { propertyName: 'max-height' }));
});

it('folds a dimswitch subtree before it unmounts, and at once under reduced motion', () => {
  // jsdom lays nothing out and runs no transition: give the subtree a height and the fold a duration.
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(120);
  let duration = '0.2s';
  const style = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) =>
    Object.assign(style(element, pseudo), { transitionDuration: duration }));
  const subtree = () => host.querySelector(`[data-bp-children="${CSS.escape(orders)}"]`);
  drawSwitch();
  act(() => rowToggle(orders).click());
  expect(subtree()?.hasAttribute('data-bp-collapsed')).toBe(true);
  transitionEnd(subtree()!);
  expect(subtree()).toBeNull();
  // Under reduced motion no transition runs, so no transitionend comes.
  act(() => rowToggle(orders).click());
  duration = '0s';
  act(() => rowToggle(orders).click());
  expect(subtree()).toBeNull();
});

it('gives a dimswitch the depth folds back when the host lets go of them or writes a new expansion', () => {
  const views: string[][] = [];
  drawSwitch({ onViewChange: (view) => views.push(view.collapsed) });
  act(() => rowToggle(orders).click());
  const folds = views.at(-1)!;
  drawSwitch({ collapsed: folds });
  expect(rowToggle(orders).getAttribute('aria-expanded')).toBe('false');
  drawSwitch();
  expect(rowToggle(orders).getAttribute('aria-expanded')).toBe('true');
  drawSwitch({ expansion: { collapsed: [orders] } });
  expect(rowToggle(orders).getAttribute('aria-expanded')).toBe('false');
});
