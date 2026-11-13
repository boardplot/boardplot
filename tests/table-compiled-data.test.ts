import { expect, it } from 'vitest';
import '../src/core/charts';
import { getFixtures } from '../src/fixtures';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { registerTheme, resolveTheme } from '../src/core/theme';
import { prepareChart } from '../src/react/prepare';
import { prepareTableData, resolvePreparedTable, resolveTable, ZERO_LIFT } from '../src/core/charts/table/resolve';
import { AUTOMATIC_FORMAT, LABEL_ONLY_ROW, MAGNITUDE_GROUP, MAGNITUDE_FIGURES } from '../src/core/formatSpec';
import { zeroLifts } from '../src/core/formatPrecision';
import { withPlanInputs } from '../src/core/layoutPlan';
import type { TableData, TableOptions } from '../src/core/types/table';

const accountingData = (): TableData => ({
  columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value' }, { id: 's', kind: 'status' }],
  columnToggles: [{ id: 'values', label: 'Values', columns: ['v'], defaultVisible: true }],
  rows: [{ id: 'total', label: 'Total', totalPolicy: 'derive', children: [
    { id: 'a', label: 'First', cells: { v: 2, s: 4 } },
    { id: 'b', label: 'Second', cells: { v: 3 } },
  ] }],
});

// Folding must reuse calculated cells while preserving warning order and isolating caller edits.
it('projects expansion from one accounting model and keeps public results owned', () => {
  const data = accountingData();
  const closed: TableOptions = { expansion: { collapsed: ['total'] }, columnVisibility: { unknown: false } };
  const open: TableOptions = { expansion: { depth: 'all', collapsed: ['absent'] }, columnVisibility: { unknown: false } };
  const model = prepareTableData(data, closed);
  expect(prepareTableData(data, open)).toBe(model);
  expect(model.rowIds).toEqual(['total', 'a', 'b']);
  expect(model.rowIndex.get('b')).toBe(2);
  expect(model.columnIndex.get('v')).toBe(1);
  const first = resolvePreparedTable(model, closed);
  const second = resolvePreparedTable(model, open);
  expect(first.table.rows[0]!.defaultExpanded).toBe(false);
  expect(second.table.rows[0]!.defaultExpanded).toBe(true);
  expect(second.table.rows[0]!.cells).toBe(first.table.rows[0]!.cells);
  expect(second.computedCells).toBe(first.computedCells);
  expect(second.table.rows[0]!.cells.v).toMatchObject({ raw: 5, displayed: '5.0' });
  expect(second.warnings.map(w => w.code)).toEqual([
    'column-visibility-ref-unknown', 'expansion-ref-unknown', 'status-value-number',
  ]);
  expect(second).toEqual(resolveTable(structuredClone(data), open));

  const owned = resolveTable(data, open);
  owned.table.rows[0]!.cells.v!.raw = 999;
  owned.table.columnToggles[0]!.columnIds.push('s');
  owned.computedCells[0]!.inputs[0]!.value = 999;
  owned.warnings[0]!.message = 'edited';
  expect(resolveTable(data, open)).toEqual(second);
  data.rows[0]!.children![0]!.cells!.v = 9;
  expect(prepareTableData(data, open)).not.toBe(model);
  expect(resolveTable(data, open).table.rows[0]!.cells.v!.raw).toBe(12);
});

// A hidden large period changes a money row's precision without changing its raw accounting.
it('selects visibility-dependent formatting while retaining the accounting model', () => {
  const data: TableData = {
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'period', kind: 'value' }, { id: 'range', kind: 'value' }],
    columnToggles: [{ id: 'range', label: 'Range', columns: ['range'], defaultVisible: true }],
    rows: [{ id: 'money', label: 'Revenue', scale: 'money', cells: { period: 1200, range: 1200000 } }],
  };
  const shown = { columnVisibility: { range: true } };
  const hidden = { columnVisibility: { range: false } };
  const model = prepareTableData(data, shown);
  expect(prepareTableData(data, hidden)).toBe(model);
  const full = resolvePreparedTable(model, shown);
  const narrow = resolvePreparedTable(model, hidden);
  expect(full.table.rows[0]!.cells.period!.raw).toBe(1200);
  expect(narrow.table.rows[0]!.cells.period!.raw).toBe(1200);
  expect(narrow.table.rows[0]!.cells.period!.displayed).not.toBe(full.table.rows[0]!.cells.period!.displayed);
  expect(narrow).toEqual(resolveTable(structuredClone(data), hidden));
  expect(resolvePreparedTable(model, shown)).toBe(full);
});

// Reusing prepared text must retain the small-value disclosure and each call's lift signal.
it('replays zero lifts and keeps unlifted formatting in a separate variant', () => {
  const data: TableData = {
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value' }],
    rows: [{ id: 'a', label: 'Small', cells: { v: 0.0000001 } }, { id: 'b', label: 'Large', cells: { v: 100 } }],
  };
  const before = zeroLifts.count;
  const first = resolveTable(data);
  const lifts = zeroLifts.count - before;
  expect(lifts).toBeGreaterThan(0);
  expect(first.lifted).toBe(true);
  const again = zeroLifts.count;
  expect(resolveTable(data)).toEqual(first);
  expect(zeroLifts.count - again).toBe(lifts);
  const unlifted = { [ZERO_LIFT]: 'none' as const } as TableOptions;
  const model = prepareTableData(data);
  expect(resolvePreparedTable(model, unlifted)).toEqual(resolveTable(structuredClone(data), unlifted));
  expect(resolvePreparedTable(model, unlifted).table.rows[0]!.cells.v!.displayed).not.toBe(first.table.rows[0]!.cells.v!.displayed);
});

// Request normalization can produce equal fresh data objects for each theme or width retry.
it('shares exact normalized data across regular and compact preparation', () => {
  const data = accountingData();
  const copy = structuredClone(data);
  const first = withPlanInputs(() => {
    const prepared = prepareTableData(data, { density: 'regular' });
    expect(prepareTableData(data, { density: 'compact' })).toBe(prepared);
    expect(prepareTableData(copy, { density: 'compact' })).toBe(prepared);
    return prepared;
  });
  expect(resolveTable(copy, { density: 'compact' })).toEqual(resolveTable(data, { density: 'regular' }));
  expect(prepareTableData(copy, { density: 'cohort' })).not.toBe(first);
  const returned = resolveTable(copy);
  returned.table.rows[0]!.cells.v!.raw = 999;
  expect(resolveTable(data).table.rows[0]!.cells.v!.raw).toBe(5);
  copy.rows[0]!.children![0]!.cells!.v = 10;
  withPlanInputs(() => {
    expect(prepareTableData(copy)).not.toBe(first);
    expect(resolveTable(copy).table.rows[0]!.cells.v!.raw).toBe(13);
  });
});

// Content sharing must keep metadata, number distinctions and property order exact, and unsupported inputs are not cached.
it('keeps distinct prepared content apart and preserves private format symbols', () => {
  const simple = (value: number | null): TableData => ({
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'text', kind: 'text' }],
    rows: [{ id: 'a', label: 'Text', cells: { text: value } }],
  });
  const values = [0, -0, NaN, Infinity, -Infinity, null];
  expect(new Set(values.map(value => prepareTableData(simple(value)))).size).toBe(values.length);
  expect(values.map(value => resolveTable(simple(value)).table.rows[0]!.cells.text!.displayed))
    .toEqual(['0', '0', 'NaN', 'Infinity', '-Infinity', '']);
  const metadata = () => {
    const data = accountingData();
    Object.assign(data.rows[0]!, { [AUTOMATIC_FORMAT]: true, [MAGNITUDE_GROUP]: 'amount', [MAGNITUDE_FIGURES]: [['v', 500]] });
    return data;
  };
  const original = metadata();
  const shared = prepareTableData(original);
  expect(prepareTableData(metadata())).toBe(shared);
  Object.assign(original.rows[0]!, { [MAGNITUDE_GROUP]: 'other' });
  expect(prepareTableData(original)).not.toBe(shared);
  const ordered = accountingData();
  const reordered = accountingData();
  reordered.rows[0]!.children![0]!.cells = { s: 4, v: 2 };
  expect(prepareTableData(reordered)).not.toBe(prepareTableData(ordered));
  const callback = () => 1;
  const withFunction = Object.assign(accountingData(), { callback });
  expect(prepareTableData(withFunction)).not.toBe(prepareTableData(withFunction));
  expect(prepareTableData(Object.assign(accountingData(), { callback }))).not.toBe(prepareTableData(withFunction));
});

// DimSwitch marks label-only rows, and a key that rejects the marker compiled one table six times per render.
it('reuses the prepared model for data with label-only rows', () => {
  const marked = (flag: boolean): TableData => {
    const data = accountingData();
    if (flag) Object.assign(data.rows[0]!, { [LABEL_ONLY_ROW]: true });
    return data;
  };
  expect(prepareTableData(marked(true))).toBe(prepareTableData(marked(true)));
  expect(prepareTableData(marked(true))).not.toBe(prepareTableData(marked(false)));
});

// Snapshotting JSON-authored cells must keep "__proto__" as data rather than change an object's prototype.
it('keeps JSON-authored prototype-name cells through preparation and public copies', () => {
  const data: TableData = JSON.parse('{"columns":[{"id":"label","kind":"rowLabel"},{"id":"__proto__","kind":"value","format":"1"}],"rows":[{"id":"a","label":"Orders","cells":{"__proto__":{"v":7,"note":"Confirmed"}}}]}');
  const model = prepareTableData(data);
  expect(prepareTableData(data)).toBe(model);
  const copy: TableData = JSON.parse(JSON.stringify(data));
  expect(prepareTableData(copy)).toBe(model);
  const first = resolveTable(data);
  expect(first.table.rows[0]!.cells['__proto__']).toMatchObject({ raw: 7, displayed: '7', note: 'Confirmed' });
  first.table.rows[0]!.cells['__proto__']!.raw = 99;
  expect(resolveTable(copy).table.rows[0]!.cells['__proto__']).toMatchObject({ raw: 7, displayed: '7', note: 'Confirmed' });
  expect(Object.hasOwn(data.rows[0]!.cells!, '__proto__')).toBe(true);
  expect(Object.getPrototypeOf(data.rows[0]!.cells!)).toBe(Object.prototype);
});

// A cached model must keep the theme a caller named, or a registered theme outside the override limits throws invalid-theme-override.
it('draws a table and a DimSwitch under a registered theme with a tall head line', () => {
  const base = resolveTheme('bridge');
  const name = 'tall-head-line';
  registerTheme({ ...base, name, table: { ...base.table, head: { ...base.table?.head, lineHeight: 2.2 } } });
  const dimension = getFixtures('dimswitch').find(fixture => fixture.id === 'by-member')!;
  const specs = [
    { type: 'table', data: accountingData() as unknown, options: {} as object },
    { type: 'dimswitch', data: dimension.data as unknown, options: dimension.options as object },
  ];
  for (const { type, data, options } of specs) {
    const draw = (theme: unknown) => JSON.stringify(layoutResolvedRequest(resolveChartRequest({ type, data: structuredClone(data), options: { ...options, theme, size: { width: 878 } } } as never)));
    const named = draw(name);
    expect(JSON.parse(named).refused).not.toBe(true);
    expect(draw({ preset: name })).toBe(named);
    expect(named).not.toBe(draw('bridge'));
  }
});

// A value the content key cannot read as plain data must not serve an old number from the cache.
it.each([
  ['a non-enumerable getter', (read: () => number) => Object.defineProperty({}, 'v', { get: read, enumerable: false, configurable: true })],
  ['a Proxy over an accessor', (read: () => number) => new Proxy({ get v() { return read(); } }, {})],
  ['a Proxy with a get trap', (read: () => number) => new Proxy({ v: 7 }, { get: (target, key, receiver) => key === 'v' ? read() : Reflect.get(target, key, receiver) })],
])('shows the current number of %s through prepareChart', async (_name, cell) => {
  let value = 7;
  const data = {
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value', format: '1' }],
    rows: [{ id: 'a', label: 'Orders', cells: { v: cell(() => value) } }],
  };
  const shown = async () => JSON.stringify(await prepareChart({ type: 'table', data, options: { size: { width: 600 } } } as never));
  expect(await shown()).toContain('"displayed":"7"');
  value = 12;
  expect(await shown()).toContain('"displayed":"12"');
});

// The process-wide map must not pin one very large table or grow past its total limit in a long-lived host.
it('bounds the content shared across data objects', () => {
  const labelled = (index: number, length: number): TableData => ({
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value' }],
    rows: [{ id: 'a', label: String(index).padEnd(length, 'x'), cells: { v: 1 } }],
  });
  const huge = labelled(0, 132 * 1024);
  expect(prepareTableData(structuredClone(huge))).not.toBe(prepareTableData(huge));
  const tables = Array.from({ length: 20 }, (_, index) => labelled(index + 1, 120 * 1024));
  const models = tables.map(table => prepareTableData(table));
  expect(prepareTableData(structuredClone(tables[19]!))).toBe(models[19]);
  expect(prepareTableData(structuredClone(tables[0]!))).not.toBe(models[0]);
});

// A change off a base above zero that its format prints as 0 (0.04 under '1') printed n.m. with the near-zero note, though the base is not zero.
it('decides a percent change n.m. on its received base, not on the base as printed', () => {
  const data = (prev: number): TableData => ({
    columns: [
      { id: 'name', kind: 'rowLabel' }, { id: 'conv', kind: 'value', format: '1' }, { id: 'prev', kind: 'value', format: '1' },
      { id: 'chg', kind: 'computed', format: '+1%', calc: { op: 'percentDelta', a: 'conv', b: 'prev' } },
    ],
    rows: [{ id: 'a', label: 'Campaign A', cells: { conv: 0.05, prev } }],
  });
  const small = resolveTable(data(0.04)).table;
  expect([small.rows[0]!.cells.prev!.displayed, small.rows[0]!.cells.chg!.displayed]).toEqual(['0', '+25%']);
  expect(small.footnotes).toEqual([]);
  // A base of zero or below stays n.m.; the near-zero note stands where n.m. prints for a zero base.
  const zero = resolveTable(data(0)).table;
  expect(zero.rows[0]!.cells.chg!.displayed).toBe('n.m.');
  expect(zero.footnotes).toContain('n.m.: not meaningful, the base is near zero.');
  expect(resolveTable(data(-0.04)).table.rows[0]!.cells.chg!.displayed).toBe('n.m.');
});
