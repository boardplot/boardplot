import { getFixtures } from '../src/fixtures';
import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { layoutTable } from '../src/core/charts/table/layout';
import { resolveTable } from '../src/core/charts/table/resolve';
import { tableDataSchema, tableOptionsSchema } from '../src/core/charts/table/schema';
import {
  collapsedByDefault,
  groupSpans,
  sortRows,
  visibleColumns,
  visibleRows,
} from '../src/core/charts/table/view';
import { renderSvg } from '../src/core/svg/renderSvg';
import { resolveTheme } from '../src/core/theme';
import type { TableData, TableOptions } from '../src/core/types/table';
import { withNumberMarks } from '../src/core/numberMarks';

function managementFixture(id = 'management-report') {
  return getFixtures('table').find((fixture) => fixture.id === id)!;
}

function errorCode(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

// Ranking must not turn a signed cost into income or discard a retained row's calculation and presentation.
it('preserves authored row fields and accounting through no-op and real top-N folds', () => {
  const data: TableData = {
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value' }],
    rows: [{ id: 'net', label: 'Net revenue', kind: 'subtotal', totalPolicy: 'validate', cells: { v: 70 }, children: [
      { id: 'revenue', label: 'Revenue', cells: { v: 100 } },
      { id: 'cost', label: 'Cost', sign: -1, cells: { v: 30 } },
    ] }],
  };
  for (const flat of [false, true]) {
    const input = structuredClone(data);
    if (flat) {
      const children = input.rows[0]!.children!;
      delete input.rows[0]!.children;
      input.rows.push(...children.map(child => ({ ...child, parentId: 'net' })));
    }
    for (const n of [10, 1]) {
      const result = resolveTable(input, { topN: { n, rest: true } });
      expect(result.table.rows.find(row => row.id === 'net')!.cells.v!.raw).toBe(70);
      expect(result.table.rows.find(row => row.id === 'cost')).toMatchObject({ sign: -1, cells: { v: { displayed: '−30' } } });
    }
    expect(errorCode(() => resolveTable(input, { topN: { n: 1, rest: false } }))).toBe('table-topn-rest-required');
  }
  const metadata: TableData = { ...data, rows: [...data.rows,
    { id: 'double', label: 'Twice revenue', relation: 'displayOnly', calc: { op: 'mul', a: { ref: { row: 'revenue' } }, b: { lit: 2 } }, format: '1.12', polarity: 'higherIsBetter', fitFormat: false },
    { id: 'change', parentId: 'revenue', label: 'Change', relation: 'displayOnly', inline: true, inlineGroup: 'changes', format: '+1.1%', polarity: 'higherIsBetter', cells: { v: 5 } },
  ] };
  expect(resolveTable(metadata, { topN: { n: 10 } }).table.rows).toEqual(resolveTable(metadata).table.rows);
});

// A driver or result row taking a top-N seat pushes a real data row into Others and inflates the Others total.
it('ranks only data rows for top-N and keeps result and driver rows in place', () => {
  const data: TableData = {
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value' }],
    rows: [
      { id: 'a', label: 'A', cells: { v: 40 } },
      { id: 'b', label: 'B', cells: { v: 30 } },
      { id: 'c', label: 'C', cells: { v: 20 } },
      { id: 'd', label: 'D', cells: { v: 10 } },
      { id: 'aov', label: 'AOV', kind: 'driver', cells: { v: 500 } },
      { id: 'gap', label: 'A minus B', kind: 'result', calc: { op: 'sub', a: { ref: { row: 'a' } }, b: { ref: { row: 'b' } } } },
    ],
  };
  const rows = resolveTable(data, { topN: { n: 2 } }).table.rows;
  expect(rows.map(row => [row.id, row.parentId ?? null, row.cells.v?.raw])).toEqual([
    ['a', null, 40], ['b', null, 30], ['others', null, 30], ['c', 'others', 20], ['d', 'others', 10],
    ['aov', null, 500], ['gap', null, 10],
  ]);
});

// Sorting categories must not move a driver or result row among the data rows it explains.
it('keeps result and driver rows in their authored place under sort.categories', () => {
  const data: TableData = {
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value' }],
    rows: [
      { id: 'a', label: 'A', cells: { v: 10 } },
      { id: 'b', label: 'B', cells: { v: 30 } },
      { id: 'aov', label: 'AOV', kind: 'driver', cells: { v: 500 } },
      { id: 'c', label: 'C', cells: { v: 20 } },
      { id: 'gap', label: 'B minus A', kind: 'result', calc: { op: 'sub', a: { ref: { row: 'b' } }, b: { ref: { row: 'a' } } } },
    ],
  };
  const order = (categories: 'asc' | 'desc' | 'reverse') =>
    resolveTable(data, { sort: { categories } }).table.rows.map(row => row.id);
  expect(order('asc')).toEqual(['a', 'c', 'aov', 'b', 'gap']);
  expect(order('desc')).toEqual(['b', 'c', 'aov', 'a', 'gap']);
  expect(order('reverse')).toEqual(['c', 'b', 'aov', 'a', 'gap']);
});

// A numeric driver must not satisfy the ranking check when no data row has a rank key; top-N would keep an arbitrary row.
it('refuses top-N when only a result or driver row has an additive number', () => {
  const data: TableData = {
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value' }],
    rows: [
      { id: 'a', label: 'A', cells: {} },
      { id: 'b', label: 'B', cells: {} },
      { id: 'c', label: 'C', cells: {} },
      { id: 'aov', label: 'AOV', kind: 'driver', cells: { v: 500 } },
    ],
  };
  expect(errorCode(() => resolveTable(data, { topN: { n: 1 } }))).toBe('table-rank-unranked');
});

// A kept result must read the rows top-N hides; otherwise rest false refuses calc-ref-missing or the result loses its value.
it('computes a kept result row from rows that top-N omits or folds', () => {
  const data: TableData = {
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value' }],
    rows: [
      { id: 'a', label: 'A', cells: { v: 40 } },
      { id: 'b', label: 'B', cells: { v: 30 } },
      { id: 'c', label: 'C', cells: { v: 20 } },
      { id: 'gap', label: 'A minus B', kind: 'result', calc: { op: 'sub', a: { ref: { row: 'a' } }, b: { ref: { row: 'b' } } } },
    ],
  };
  const values = (rest: boolean) =>
    resolveTable(data, { topN: { n: 1, rest } }).table.rows.map(row => [row.id, row.parentId ?? null, row.cells.v?.raw]);
  expect(values(false)).toEqual([['a', null, 40], ['gap', null, 10]]);
  expect(values(true)).toEqual([['a', null, 40], ['others', null, 50], ['b', 'others', 30], ['c', 'others', 20], ['gap', null, 10]]);
});

describe('table view schema and validation', () => {
  const columns: TableData['columns'] = [
    { id: 'label', kind: 'rowLabel', align: 'center' },
    { id: 'a', kind: 'value', align: 'right', polarity: 'higherIsBetter', materiality: { abs: 1 } },
    { id: 'b', kind: 'value' },
  ];

  it('parses every additive view-state field', () => {
    expect(() => tableDataSchema.parse({
      columnGroups: [{ id: 'g', label: 'Group', columns: ['a', 'b'] }],
      columnToggles: [{ id: 'detail', label: 'Detail', columns: ['b'], defaultVisible: true }],
      columns,
      rows: [{ id: 'r', cells: { a: 1, b: 2 } }],
    })).not.toThrow();
    expect(() => tableOptionsSchema.parse({
      expansion: { depth: 0, collapsed: ['r'], expanded: ['r'] },
      columnVisibility: { detail: false },
      anchorWash: true,
    })).not.toThrow();
    expect(() => tableOptionsSchema.parse({ expansion: { depth: 'all' } })).not.toThrow();
  });

  it('teaches toggle reference, uniqueness, and one-band rules through schema issues', () => {
    const invalid = tableDataSchema.safeParse({
      columnGroups: [{ id: 'g', label: 'Group', columns: ['a'] }],
      columnToggles: [
        { id: 'detail', label: 'Detail', columns: ['a', 'missing'] },
        { id: 'detail', label: 'Again', columns: ['a', 'b'] },
      ],
      columns,
      rows: [{ id: 'r' }],
    });
    expect(invalid.success).toBe(false);
    const messages = invalid.success ? '' : invalid.error.issues.map((issue) => issue.message).join('\n');
    expect(messages).toContain('toggle-ref-invalid');
    expect(messages).toContain('duplicate-toggle-id');
    expect(messages).toContain('toggle-group-span');
  });

  it('preserves exact resolver error codes for direct typed callers', () => {
    const base = { columns, rows: [{ id: 'r' }] } satisfies TableData;
    expect(errorCode(() => resolveTable({
      ...base,
      columnGroups: [{ id: 'g', label: 'Group', columns: ['a', 'b'] }],
      columnToggles: [{ id: 'x', label: 'X', columns: ['missing'] }],
    }))).toBe('toggle-ref-invalid');
    expect(errorCode(() => resolveTable({
      ...base,
      columnGroups: [{ id: 'g', label: 'Group', columns: ['a', 'b'] }],
      columnToggles: [
        { id: 'x', label: 'X', columns: ['a'] },
        { id: 'y', label: 'Y', columns: ['a'] },
      ],
    }))).toBe('toggle-ref-invalid');
    expect(errorCode(() => resolveTable({
      ...base,
      columnGroups: [{ id: 'g', label: 'Group', columns: ['a'] }],
      columnToggles: [{ id: 'x', label: 'X', columns: ['a', 'b'] }],
    }))).toBe('toggle-group-span');
    expect(errorCode(() => resolveTable({
      ...base,
      columnGroups: [{ id: 'g', label: 'Group', columns: ['a', 'b'] }],
      columnToggles: [
        { id: 'x', label: 'X', columns: ['a'] },
        { id: 'x', label: 'Again', columns: ['b'] },
      ],
    }))).toBe('duplicate-toggle-id');
  });
});

describe('expansion resolution and ancestor visibility', () => {
  const data: TableData = {
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value' }],
    rows: [
      {
        id: 'root',
        children: [
          { id: 'branch', children: [{ id: 'leaf', cells: { v: 1 } }] },
          { id: 'sibling', cells: { v: 2 } },
        ],
      },
      { id: 'total', role: 'total', cells: { v: 3 } },
    ],
  };

  it('applies depth, then collapsed, then expanded and lints invalid refs', () => {
    const result = resolveTable(data, {
      expansion: {
        depth: 1,
        collapsed: ['root', 'leaf'],
        expanded: ['root', 'unknown'],
      },
    });
    const root = result.table.rows.find((row) => row.id === 'root')!;
    const branch = result.table.rows.find((row) => row.id === 'branch')!;
    const leaf = result.table.rows.find((row) => row.id === 'leaf')!;
    expect(root).toMatchObject({ hasChildren: true, defaultExpanded: true, level: 0 });
    expect(branch).toMatchObject({ parentId: 'root', hasChildren: true, defaultExpanded: false, level: 1 });
    expect(leaf).toMatchObject({ parentId: 'branch', hasChildren: false, level: 2 });
    expect('defaultExpanded' in leaf).toBe(false);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'expansion-ref-leaf', severity: 'info' }),
      expect.objectContaining({ code: 'expansion-ref-unknown', severity: 'warn' }),
    ]));
    expect([...collapsedByDefault(result.table)]).toEqual(['branch']);
    expect(visibleRows(result.table).map((row) => row.id)).toEqual([
      'root', 'branch', 'sibling', 'total',
    ]);
  });
});

describe('column toggle view and semantic invariance', () => {
  it('resolves visibility and column metadata without dropping semantic columns', () => {
    const fixture = managementFixture();
    const hidden = resolveTable(fixture.data as TableData, fixture.options as TableOptions);
    const shown = resolveTable(fixture.data as TableData, {
      ...(fixture.options as TableOptions),
      columnVisibility: { 'forecast-detail': true, unknown: true },
    });
    expect(hidden.table.columns).toHaveLength(26);
    expect(visibleColumns(hidden.table)).toHaveLength(21);
    expect(visibleColumns(shown.table)).toHaveLength(26);
    expect(hidden.table.columnToggles).toEqual([
      {
        id: 'forecast-detail',
        label: 'Forecast detail',
        columnIds: ['laBilled', 'laBooked', 'laRenew', 'laUsage', 'laPipe'],
        defaultVisible: false,
        visible: false,
      },
      {
        id: 'mtd-band',
        label: 'Month-to-Date',
        columnIds: ['mtdLy', 'mtdAc', 'mtdYoY'],
        defaultVisible: true,
        visible: true,
      },
      {
        id: 'ytd-closed-band',
        label: 'YTD Closed',
        columnIds: ['ycLy', 'ycAc', 'ycYoY', 'ycPlan', 'ycVsPlan'],
        defaultVisible: true,
        visible: true,
      },
      {
        id: 'full-year-pace-band',
        label: 'Full Year Pace',
        columnIds: ['fpLy', 'fpPace', 'fpPlan', 'fpDelta', 'fpVsOut'],
        defaultVisible: true,
        visible: true,
      },
      {
        id: 'full-year-outlook-band',
        label: 'Full Year Outlook',
        columnIds: ['foLy', 'foOut'],
        defaultVisible: true,
        visible: true,
      },
    ]);
    expect(hidden.table.columns.find((column) => column.id === 'laBilled')).toMatchObject({
      toggleGroup: 'forecast-detail', width: 92, align: 'right',
    });
    expect(groupSpans(hidden.table, visibleColumns(hidden.table)).find((group) => group.id === 'g-forecast'))
      .toMatchObject({ span: 5, fullSpan: 10 });
    expect(groupSpans(shown.table, visibleColumns(shown.table)).find((group) => group.id === 'g-forecast'))
      .toMatchObject({ span: 10, fullSpan: 10 });
    expect(shown.warnings).toContainEqual(expect.objectContaining({ code: 'column-visibility-ref-unknown' }));
  });

  it('keeps hidden-column computed records identical across every expansion and band state', () => {
    const fixture = managementFixture();
    const base = fixture.options as TableOptions;
    const toggleIds = (fixture.data as TableData).columnToggles!.map((toggle) => toggle.id);
    const states: TableOptions[] = [
      { ...base, expansion: { depth: 0 }, columnVisibility: { 'forecast-detail': false } },
      { ...base, expansion: { depth: 'all' }, columnVisibility: { 'forecast-detail': true } },
      { ...base, expansion: { depth: 2, collapsed: ['seg-subscriptions'], expanded: ['subs-cloud'] } },
      ...toggleIds.map((toggleId) => ({
        ...base,
        columnVisibility: { 'forecast-detail': true, [toggleId]: false },
      })),
    ];
    const results = states.map((options) => resolveTable(fixture.data as TableData, options));
    for (const result of results) {
      expect(result.table.rows).toHaveLength(19);
      expect(result.table.columns).toHaveLength(26);
      expect(result.computedCells).toEqual(results[0]!.computedCells);
    }
    for (const toggleId of toggleIds) {
      const hidden = resolveTable(fixture.data as TableData, {
        ...base,
        columnVisibility: { 'forecast-detail': true, [toggleId]: false },
      });
      const toggle = hidden.table.columnToggles.find((candidate) => candidate.id === toggleId)!;
      expect(visibleColumns(hidden.table).map((column) => column.id))
        .not.toEqual(expect.arrayContaining(toggle.columnIds));
      const hiddenComputed = results[0]!.computedCells.filter((record) => toggle.columnIds.includes(record.colId));
      expect(hiddenComputed.length, `${toggleId} keeps computed records`).toBeGreaterThan(0);
      expect(hidden.computedCells.filter((record) => toggle.columnIds.includes(record.colId))).toEqual(hiddenComputed);
    }
  });
});

describe('value polarity, materiality, locale, and authored alignment', () => {
  it('applies judgment to value columns without hiding sub-material values', () => {
    const data: TableData = {
      columns: [
        { id: 'label', kind: 'rowLabel' },
        { id: 'pct', kind: 'value', format: '+1.1%', polarity: 'higherIsBetter', materiality: { pct: 0.5 } },
        { id: 'abs', kind: 'value', format: '1', polarity: 'lowerIsBetter', materiality: { abs: 5 } },
      ],
      rows: [
        { id: 'positive', cells: { pct: 2, abs: 10 } },
        { id: 'negative', cells: { pct: -2, abs: -10 } },
        { id: 'tiny', cells: { pct: 0.4, abs: 4 } },
        { id: 'zero', cells: { pct: 0, abs: 0 } },
        { id: 'context', relation: 'ofWhich', cells: { pct: 3, abs: -20 } },
      ],
    };
    const rows = resolveTable(data).table.rows;
    const cell = (rowId: string, colId: string) => rows.find((row) => row.id === rowId)!.cells[colId]!;
    expect(cell('positive', 'pct').tone).toBe('good');
    expect(cell('positive', 'abs').tone).toBe('bad');
    expect(cell('negative', 'pct').tone).toBe('bad');
    expect(cell('negative', 'abs').tone).toBe('good');
    expect(cell('tiny', 'pct')).toMatchObject({ raw: 0.4, displayed: '+0.4%', tone: 'neutral', deEmphasized: true });
    expect(cell('tiny', 'abs')).toMatchObject({ raw: 4, displayed: '4', tone: 'neutral', deEmphasized: true });
    expect(cell('zero', 'pct')).toMatchObject({ raw: 0, displayed: '0.0%', tone: 'neutral', deEmphasized: true });
    expect(cell('context', 'pct').tone).toBe('neutral');
    expect(cell('context', 'abs').tone).toBe('neutral');
  });

  it('applies explicit locale marks to derived, authored and document formats', () => {
    const data: TableData = {
      columns: [
        { id: 'label', kind: 'rowLabel' },
        { id: 'small', kind: 'value' },
        { id: 'grouped', kind: 'value' },
        { id: 'authored', kind: 'value', format: '1,234' },
      ],
      rows: [{ id: 'r', cells: { small: -12.3, grouped: 1234, authored: 1234 } }],
    };
    // resolveTable reads the marks a chart entry wrote into the language tag.
    const german = resolveTable(data, withNumberMarks({
      locale: { decimal: ',', thousands: '.', minusGlyph: '-' },
    })).table.rows[0]!;
    expect(german.cells.small!.displayed).toBe('-12,3');
    expect(german.cells.grouped!.displayed).toBe('1.234');
    expect(german.cells.authored!.displayed).toBe('1.234');
    const documented = resolveTable(data, withNumberMarks({
      locale: { decimal: ',', thousands: '.' },
      format: '1,234',
    })).table.rows[0]!;
    expect(documented.cells.grouped!.displayed).toBe('1.234');
  });

  it('passes through align/width and warns only for suspicious numeric left alignment', () => {
    const result = resolveTable({
      columns: [
        { id: 'label', kind: 'rowLabel', align: 'center', width: 180 },
        { id: 'v', kind: 'value', align: 'left', width: 92 },
        { id: 'c', kind: 'computed', align: 'center', calc: { ref: 'v' } },
      ],
      rows: [{ id: 'r', cells: { v: 1 } }],
    });
    expect(result.table.columns.map((column) => ({ id: column.id, align: column.align, width: column.width })))
      .toEqual([
        { id: 'label', align: 'center', width: 180 },
        { id: 'v', align: 'left', width: 92 },
        { id: 'c', align: 'center', width: undefined },
      ]);
    expect(result.warnings.filter((warning) => warning.code === 'align-override-suspect'))
      .toEqual([expect.objectContaining({ owner: { colId: 'v' } })]);
  });
});

describe('management-report fixture behavior and SVG view', () => {

  it('derives Landing from hidden inputs, reconciles authored leaf sums, and preserves state traces', () => {
    const fixture = managementFixture();
    const result = resolveTable(fixture.data as TableData, fixture.options as TableOptions);
    const row = (id: string) => result.table.rows.find((candidate) => candidate.id === id)!;
    const display = row('cloud-europe');
    const landingInputs = ['laBilled', 'laBooked', 'laRenew', 'laUsage', 'laPipe'];
    const expectedLanding = landingInputs.reduce((sum, colId) => sum + Number(display.cells[colId]!.raw), 0);
    expect(display.cells.laFc!.raw).toBe(expectedLanding);
    const record = result.computedCells.find((cell) => cell.rowId === display.id && cell.colId === 'laFc')!;
    expect(record.inputs.map((input) => input.colId)).toEqual(landingInputs);

    const leaves = result.table.rows.filter((candidate) => !candidate.hasChildren && candidate.role !== 'total');
    const total = row('total');
    for (const column of result.table.columns.filter((candidate) => candidate.kind === 'value')) {
      const sum = leaves.reduce((value, leaf) => {
        const cell = leaf.cells[column.id];
        return value + (cell?.state === 'value' && typeof cell.raw === 'number' ? cell.raw : 0);
      }, 0);
      expect(total.cells[column.id]!.raw, `total.${column.id}`).toBe(sum);
    }
    expect(result.warnings.some((warning) => warning.code === 'total-reconciliation')).toBe(false);
    expect(row('unalloc-other').cells.laYoY).toMatchObject({ state: 'nm', displayed: 'n.m.' });
    expect(row('unalloc-other').cells.laVsPlan).toMatchObject({ state: 'nm', displayed: 'n.m.' });
    expect(row('unalloc-other').cells.ycVsPlan).toMatchObject({ state: 'nm', displayed: 'n.m.' });
    expect(row('hw-appliances').cells.foOut).toMatchObject({ state: 'na', displayed: 'n/a' });
    expect(row('subs-addons').cells.foOut).toMatchObject({ state: 'missing', displayed: '\u2013' });
    expect(row('total').cells.ycAc!.displayed).toBe('6,670');
    expect(row('total').cells.fpDelta!.displayed).toBe('(683)');
    expect(row('unalloc-other').cells.fpVsOut).toMatchObject({ displayed: '0.0%', tone: 'neutral', deEmphasized: true });
  });

  it('derives every parent from authored leaves through levels L0 to L4', () => {
    const fixture = managementFixture();
    const result = resolveTable(fixture.data as TableData, {
      ...(fixture.options as TableOptions),
      expansion: { depth: 'all' },
    });
    const parents = result.table.rows.filter((row) => row.hasChildren);
    expect([...new Set(parents.map((row) => row.level))]).toEqual([0, 1, 2, 3]);
    expect(Math.max(...result.table.rows.map((row) => row.level))).toBe(4);
    const valueColumnIds = result.table.columns
      .filter((column) => column.kind === 'value')
      .map((column) => column.id);
    for (const parent of parents) {
      for (const colId of valueColumnIds) {
        const record = result.computedCells.find((candidate) =>
          candidate.rowId === parent.id && candidate.colId === colId && candidate.kind === 'aggregate');
        expect(record, `${parent.id}.${colId} aggregate record`).toBeDefined();
        expect(record!.raw, `${parent.id}.${colId} direct-child sum`)
          // an 'aggregate' record's operands are measured values by contract;
          // only the non-derivation 'unaudited' kind carries null operands
          .toBe(record!.inputs.reduce((sum, input) => sum + input.value!, 0));
        expect(parent.cells[colId]!.raw, `${parent.id}.${colId} resolved parent`).toBe(record!.raw);
      }
    }
  });

  it('keeps every column header in place when sort or topN changes the drawn rows', () => {
    // Column widths follow the columns and the
    // full data set, never the drawn subset. topN folds the widest label
    // under Others one level deeper; the width still comes from the authored rows.
    const labels = ['Subscriptions and licences', 'Cloud', 'Services', 'Hardware', 'Training', 'Devices'];
    const flat: TableData = {
      columns: [{ id: 'label', kind: 'rowLabel', label: 'Business' }, { id: 'v', kind: 'value', label: 'Revenue' }],
      rows: labels.map((label, index) => ({ id: `r${index}`, label, cells: { label, v: [12, 90, 80, 70, 60, 50][index]! } })),
    };
    const fixture = managementFixture();
    const headerXs = (data: TableData, options: TableOptions) =>
      Object.fromEntries(layoutTable(data, options).scene.flatMap((node) =>
        node.t === 'text' && node.id.startsWith('header:') ? [[node.id, node.x]] : []));
    const variants: Partial<TableOptions>[] = [
      { sort: { categories: 'asc' } },
      { sort: { categories: 'desc' } },
      { sort: { categories: 'reverse' } },
      { topN: { n: 2 } },
      { topN: { n: 1, showRestCount: true } },
      { sort: { categories: 'asc' }, topN: { n: 2 } },
    ];
    for (const [data, options] of [
      [flat, { size: { width: 600, height: 400 } }],
      [fixture.data as TableData, fixture.options as TableOptions],
    ] as const) {
      const base = headerXs(data, options);
      for (const variant of variants) {
        expect(headerXs(data, { ...options, ...variant }), JSON.stringify(variant)).toEqual(base);
      }
    }
  });

  it('renders the contract-derived collapsed view and the full override', () => {
    const fixture = managementFixture();
    const defaults = layoutTable(fixture.data as TableData, fixture.options as TableOptions);
    expect(defaults.marks.rows.map((row) => row.id)).toEqual([
      'total',
      'seg-subscriptions', 'subs-cloud', 'subs-onprem', 'subs-addons',
      'seg-services', 'svc-consulting', 'svc-training',
      'seg-hardware', 'hw-appliances', 'hw-devices',
      'seg-unallocated',
    ]);
    expect(defaults.marks.columns).toHaveLength(21);
    expect(defaults.derived.table.rows).toHaveLength(19);
    expect(defaults.derived.table.columns).toHaveLength(26);
    // The anchor tint marks rung-0 parents. The fixture's departments sit on
    // rung 1 under `levelOffset: 1`, so it draws none; on their
    // authored rung the three open departments take it.
    expect(defaults.scene.some((node) => node.part === 'tableAnchorTint')).toBe(false);
    const authoredRungs = layoutTable(fixture.data as TableData, { ...(fixture.options as TableOptions), levelOffset: 0 });
    expect(authoredRungs.scene.filter((node) => node.part === 'tableAnchorTint').map((node) => node.owner.rowId))
      .toEqual(['seg-subscriptions', 'seg-services', 'seg-hardware']);
    expect(defaults.scene.some((node) => /chevron|affordance/i.test(node.part))).toBe(false);
    expect(defaults.scene.filter((node) => node.id === 'rule:header')).toHaveLength(1);
    expect(defaults.scene.filter((node) => node.id === 'rule:close')).toHaveLength(1);

    const full = layoutTable(fixture.data as TableData, {
      ...(fixture.options as TableOptions),
      expansion: { depth: 'all' },
      columnVisibility: { 'forecast-detail': true },
    });
    expect(full.marks.rows).toHaveLength(19);
    expect(full.marks.columns).toHaveLength(26);
    expect(full.scene.some((node) => node.id === 'cell:subs-addons:foOut' && node.t === 'text' && node.lines[0] === '\u2013')).toBe(true);
    expect(full.scene.some((node) => node.id === 'cell:hw-appliances:foOut' && node.t === 'text' && node.lines[0] === 'n/a')).toBe(true);
    expect(full.scene.some((node) => node.id === 'cell:unalloc-other:laYoY' && node.t === 'text' && node.lines[0] === 'n.m.')).toBe(true);

    const labelX = (id: string) => {
      const node = full.scene.find((candidate) => candidate.id === `cell:${id}:label`)!;
      return node.t === 'text' ? node.x : NaN;
    };
    // The indent ladder is 24 px at level 0 and 16 px per level after it.
    expect(labelX('subs-cloud') - labelX('seg-subscriptions')).toBe(16);
    expect(labelX('cloud-europe') - labelX('subs-cloud')).toBe(16);
    expect(labelX('europe-eu') - labelX('cloud-europe')).toBe(16);
    expect(labelX('eu-dach') - labelX('europe-eu')).toBe(16);
    const header = full.scene.find((node) => node.id === 'header:mtdLy')!;
    const body = full.scene.find((node) => node.id === 'cell:total:mtdLy')!;
    expect(header.t === 'text' && body.t === 'text' ? header.x : NaN).toBe(body.t === 'text' ? body.x : NaN);
  });

  it('renders the English default byte-identically across repeated runs', () => {
    const fixture = managementFixture();
    const options = fixture.options as TableOptions;
    const first = renderSvg(layoutTable(fixture.data as TableData, options) as never, resolveTheme(options.theme));
    const second = renderSvg(layoutTable(fixture.data as TableData, options) as never, resolveTheme(options.theme));
    expect(second).toBe(first);
  });
});

// A version column sorted 0.9.1 after 0.20.3: text compared letter by letter, so "2" came before "9".
it('sorts text with the digits in it as numbers', () => {
  const data: TableData = {
    columns: [{ id: 'label', kind: 'rowLabel', label: 'Release' }, { id: 'version', kind: 'text', label: 'Version' }],
    rows: ['0.20.3', '0.9.1', '0.10.0', '1.0.0'].map((version) => ({ id: `r${version}`, label: `Release ${version}`, cells: { version } })),
  };
  const table = resolveTable(data, {}).table;
  const order = (direction: 'asc' | 'desc') => sortRows(table, { column: 'version', direction }, 'en').map((row) => row.cells.version!.displayed);
  expect(order('asc')).toEqual(['0.9.1', '0.10.0', '0.20.3', '1.0.0']);
  expect(order('desc')).toEqual(['1.0.0', '0.20.3', '0.10.0', '0.9.1']);
});
