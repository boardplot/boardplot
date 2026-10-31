import { expect, it } from 'vitest';
import '../src/core/charts';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { requireGeometry } from '../src/core/sizing';
import { repaintGeometry } from '../src/core/repaintGeometry';
import { resolveTable } from '../src/core/charts/table/resolve';
import { preparedTableRecords } from '../src/core/a11y/structuralRecords';
import { displayedValueText, interactionValueText } from '../src/core/a11y/valueText';
import { claimsForChart } from '../src/core/claims/browser';
import { bartableDataSchema } from '../src/core/charts/bartable/schema';
import { tableDataSchema } from '../src/core/charts/table/schema';
import { authoredTrackWidth, intrinsicColumnWidth, tableFonts, ENCODING_WIDTH } from '../src/core/charts/table/tracks';
import { levelLadder } from '../src/core/charts/table/ladder';
import { defaultMeasurer } from '../src/core/text';
import { cellGrounds, paintColor, registerTheme, resolveTheme, themes } from '../src/core/theme';
import { contrastRatio, hueSaturation, mixColors } from '../src/core/color';
import { onTableGround, toneTextPaint } from '../src/core/charts/table/chips';
import { tableStylesheet } from '../src/react/tablePresentation';
import type { TableData } from '../src/core/types/table';
import type { Paint, SceneNode } from '../src/core/types/scene';
import { getFixtures } from '../src/fixtures';
import { render } from '../src/cli/render';

type TextNode = Extract<SceneNode, { t: 'text' }>;

const layout = (type: string, data: unknown, options: object = {}) =>
  requireGeometry(layoutResolvedRequest(resolveChartRequest({ type, data, options } as never)));

// A missing value with cell metadata must draw the same missing state as a scalar null.
it('accepts null inside an annotated table cell', () => {
  const data = tableDataSchema.parse({
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value' }],
    rows: [{ id: 'a', label: 'Orders', cells: { v: { v: null, note: 'Awaiting source' } } }],
  });
  const resolved = resolveTable(data).table.rows[0]!.cells.v!;
  expect(resolved).toMatchObject({ raw: null, state: 'missing' });
  const geometry = layout('table', data, { size: { width: 400, height: 300 } });
  expect(geometry.scene.filter(node => node.t === 'text' && node.id === 'cell:a:v')).toHaveLength(1);
});

// Accepted IDs with colons or percent escapes must not mix up printed shares, records or claim targets.
it('keeps compound table cell keys and escaped scene IDs distinct', () => {
  const data: TableData = {
    columns: [
      { id: 'label', kind: 'rowLabel' },
      { id: 'v', kind: 'value' },
      { id: 'w', kind: 'value' },
      { id: 'c', kind: 'computed', calc: { op: 'share', of: 'v' } },
      { id: 'b:c', kind: 'computed', calc: { op: 'share', of: 'w' } },
      { id: 'x%3Ay', kind: 'computed', calc: { op: 'share', of: 'v' } },
      { id: 'x:y', kind: 'computed', calc: { op: 'share', of: 'w' } },
    ],
    rows: [
      { id: 'a:b', label: 'First', cells: { v: 1, w: 3 } },
      { id: 'a', label: 'Second', cells: { v: 3, w: 1 } },
    ],
  };
  const { computedCells } = resolveTable(data);
  const geometry = layout('table', data, { size: { width: 960 } });
  const text = (id: string) => geometry.scene.find((node): node is TextNode => node.t === 'text' && node.id === id)!;
  expect([text('cell:a%3Ab:c')?.lines.join(' '), text('cell:a:c')?.lines.join(' ')]).toEqual(['25.0%', '75.0%']);
  expect(new Set(geometry.scene.map(node => node.id)).size).toBe(geometry.scene.length);
  const claims = claimsForChart('table', geometry);
  for (const [rowId, escapedRow, share, reverse] of [
    ['a:b', 'a%3Ab', '25.0%', '75.0%'],
    ['a', 'a', '75.0%', '25.0%'],
  ]) {
    for (const [colId, escapedCol, displayed] of [
      ['c', 'c', share], ['b:c', 'b%3Ac', reverse],
      ['x%3Ay', 'x%253Ay', share], ['x:y', 'x%3Ay', reverse],
    ]) {
      const records = computedCells.filter(record => record.kind === 'calc' && record.rowId === rowId && record.colId === colId);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ rowId, colId, displayed });
      const nodeId = `cell:${escapedRow}:${escapedCol}`;
      expect(text(nodeId)).toMatchObject({ owner: { rowId, colId }, lines: [displayed] });
      expect(claims.filter(claim => claim.nodeId === nodeId)).toMatchObject([{ output: { displayed } }]);
    }
  }
});

// A child row's change must not look more important than its value, even with a large micro face or a strong judgment.
it('keeps changes below their own row values at regular weight with their sign colours', () => {
  const data: TableData = {
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value' }],
    rows: [
      { id: 'kpi', label: 'Orders', cells: { v: 120 } },
      { id: 'kpi-change', parentId: 'kpi', label: 'Change', inline: true, relation: 'displayOnly', format: '+1.1%', cells: { v: { v: 20, tone: 'good', strong: true } } },
      { id: 'channel', parentId: 'kpi', label: 'Search', cells: { v: 120 } },
      { id: 'channel-change', parentId: 'channel', label: 'Change', inline: true, relation: 'displayOnly', format: '+1.1%', cells: { v: { v: -5, tone: 'bad', strong: true } } },
      { id: 'channel-reference', parentId: 'channel', label: 'Reference', inline: true, relation: 'displayOnly', cells: { v: 10 } },
    ],
  };
  const options = { size: { width: 400 }, theme: { preset: 'standard', overrides: { type: { micro: { size: 18 } }, table: { weights: { change: 700 }, tones: 'fill' } } } };
  const g = layout('table', data, options);
  const text = (id: string) => g.scene.find((n): n is TextNode => n.t === 'text' && n.id === id)!;
  expect(text('cell:kpi:v').font.size).toBe(12);
  expect(text('cell:channel:v').font.size).toBe(11);
  const kpi = text('cellline:kpi:v:kpi-change');
  const channel = text('cellline:channel:v:channel-change');
  const reference = text('cellline:channel:v:channel-reference');
  expect([kpi, channel, reference].map((node) => [node.font.size, node.font.weight])).toEqual([[11, 400], [11, 400], [11, 400]]);
  expect(kpi.ink).toMatchObject({ theme: { kind: 'series-text', base: { token: 'good' } } });
  expect(channel.ink).toMatchObject({ theme: { kind: 'series-text', base: { token: 'bad' } } });
  expect(reference.ink).toEqual({ token: 'inkMuted', theme: { kind: 'table-ink', role: 'secondary' } });
  expect(g.warnings.find(warning => warning.code === 'option-deprecated')).toMatchObject({
    field: ['options', 'theme', 'overrides', 'table', 'weights', 'change'],
    fix: [{ op: 'remove', path: '/options/theme/overrides/table/weights/change' }],
  });
});

// A theme selected by name must not offer a removal patch beneath a string.
it('points change-weight advice to the registered theme definition', () => {
  const base = resolveTheme('standard');
  const name = 'table-change-weight-advice';
  registerTheme({ ...base, name, table: { ...base.table, weights: { ...base.table?.weights, change: 700 } } });
  try {
    const data: TableData = {
      columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value' }],
      rows: [{ id: 'value', label: 'Orders', cells: { v: 120 } },
        { id: 'change', parentId: 'value', label: 'Change', inline: true, relation: 'displayOnly', format: '+1.1%', cells: { v: 5 } }],
    };
    const warning = layout('table', data, { theme: name, size: { width: 400 } }).warnings.find(w => w.code === 'option-deprecated');
    expect(warning).toMatchObject({ field: ['options', 'theme'] });
    expect(warning?.fix).toBeUndefined();
    expect(warning?.suggest).toContain(name);
    expect(warning?.suggest).toContain('theme definition');
  } finally {
    delete themes[name];
  }
});

// An override removal must not leave the same retired key active in its registered base theme.
it('points to the base definition when removing an override would leave the retired key', () => {
  const base = resolveTheme('standard');
  const name = 'table-change-weight-base';
  registerTheme({ ...base, name, table: { ...base.table, weights: { ...base.table?.weights, change: 700 } } });
  try {
    const data: TableData = {
      columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value' }],
      rows: [{ id: 'value', label: 'Orders', cells: { v: 120 } }],
    };
    const warning = layout('table', data, { theme: { preset: name, overrides: { table: { weights: { change: 400 } } } }, size: { width: 400 } })
      .warnings.find(w => w.code === 'option-deprecated');
    expect(warning).toMatchObject({ field: ['options', 'theme'] });
    expect(warning?.fix).toBeUndefined();
    expect(warning?.suggest).toContain(name);
    expect(warning?.suggest).toContain('theme definition and authored overrides');
  } finally {
    delete themes[name];
  }
});

// An ignored change-weight key must not keep a bold width budget that shortens the change text.
it('ignores the retired change weight when fitting change text', () => {
  const data: TableData = {
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value', width: 71 }],
    rows: [{ id: 'value', label: 'Orders', cells: { v: 120 } },
      { id: 'change', parentId: 'value', label: 'Change', inline: true, relation: 'displayOnly', format: '+1.12%', cells: { v: 54.12 } }],
  };
  const measure: typeof defaultMeasurer = (text, font) => ({
    ...defaultMeasurer(text, font),
    ...(text === '+54.12%' ? { width: (font.weight ?? 400) >= 600 ? 49 : 46.5 } : {}),
  });
  const g = layout('table', data, { fitFormats: true, measure, size: { width: 320 },
    theme: { preset: 'standard', overrides: { type: { micro: { size: 10.9 } }, table: { weights: { change: 700 } } } } });
  const change = g.scene.find((n): n is TextNode => n.t === 'text' && n.id === 'cellline:value:v:change')!;
  expect(change.lines.join('')).toBe('+54.12%');
  expect(change.font).toMatchObject({ size: 11, weight: 400 });
});

// Every authored change-weight key needs a usable migration warning, even at 400 or without change rows.
it('accepts and ignores change weights and offers a working removal fix without depending on rows', () => {
  const value = { id: 'value', label: 'Orders', cells: { v: { v: 120, note: 'Observed' } } };
  const change = { id: 'change', parentId: 'value', label: 'Change', inline: true as const, relation: 'displayOnly' as const, cells: { v: 5 } };
  for (const rows of [[value], [value, change]]) {
    const data: TableData = { columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value' }], rows };
    const baseline = layout('table', data, { theme: 'standard', size: { width: 400 } });
    for (const weight of [400, 700]) {
      const request = { type: 'table', data, options: { theme: { preset: 'standard', overrides: { table: { weights: { change: weight } } } }, size: { width: 400 } } };
      const result = layout(request.type, data, request.options);
      expect(result.scene).toEqual(baseline.scene);
      const warnings = result.warnings.filter(w => w.code === 'option-deprecated');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.fix).toEqual([{ op: 'remove', path: '/options/theme/overrides/table/weights/change' }]);
      const fixed = structuredClone(request);
      delete (fixed.options.theme.overrides.table.weights as { change?: number }).change;
      expect(layout(fixed.type, data, fixed.options).warnings.some(w => w.code === 'option-deprecated')).toBe(false);
    }
  }
});

// A missing calculation input must not look like a first period or a skipped calculation.
it('names missing calculation inputs while keeping structural and authored placeholders', () => {
  const data: TableData = {
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'range', kind: 'value' }, { id: 'a', kind: 'value' }, { id: 'b', kind: 'value' }, { id: 'c', kind: 'value' },
      { id: 'twice', kind: 'computed', calc: { op: 'mul', a: { ref: 'c' }, b: { lit: 2 } } }, { id: 'pct', kind: 'computed', calc: { op: 'percentDelta', a: 'a', b: 'b' } }],
    columnGroups: [{ id: 'weeks', label: 'Weeks', columns: ['a', 'b', 'c'] }],
    rows: [{ id: 'source', label: 'Orders', cells: { range: 10, a: 0, b: 0, c: null } },
      { id: 'double', label: 'Twice orders', relation: 'displayOnly', calc: { op: 'mul', a: { ref: { row: 'source' } }, b: { lit: 2 } } },
      { id: 'change', label: 'Change', relation: 'displayOnly', calc: { op: 'delta', a: { row: 'source' }, b: { row: 'source', previous: true } } },
      { id: 'ratio', label: 'Ratio', relation: 'displayOnly', calc: { op: 'div', a: { ref: { row: 'source' } }, b: { ref: { row: 'source', previous: true } } } }],
  };
  // The theme patch of the old look: the n/a word for a data gap, the em dash elsewhere.
  const oldLook = { preset: 'standard', overrides: { table: { dataGap: 'word' as const, glyphs: { missing: '\u2014', suppressed: '\u2014' } } } };
  const table = resolveTable(data, { target: 'report', theme: oldLook }).table, cell = (row: string, col: string) => table.rows.find(r => r.id === row)!.cells[col]!;
  expect(cell('source', 'twice')).toMatchObject({ raw: null, state: 'missing', displayed: 'n/a' });
  expect(cell('double', 'c').displayed).toBe('n/a'); expect(cell('change', 'c').displayed).toBe('n/a');
  expect(cell('ratio', 'b')).toMatchObject({ raw: null, state: 'na', displayed: 'n/a' });
  expect(cell('change', 'a').displayed).toBe('—'); expect(cell('change', 'range').displayed).toBe('—'); expect(cell('change', 'pct').displayed).toBe('—');
  expect(cell('change', 'b')).toMatchObject({ raw: 0, state: 'value' });
  expect(resolveTable(data, { target: 'report', nulls: 'blank', theme: oldLook }).table.rows.find(r => r.id === 'double')!.cells.c!.displayed).toBe('');
  const kit = resolveTable(data, { target: 'report' }).table.rows.find(r => r.id === 'change')!;
  expect(kit.cells.a!.displayed).toBe('\u2013'); expect(kit.cells.c!.displayed).toBe('\u2013');
});

// An input left blank on purpose has nothing to compare, so the change keeps the structural dash and not n/a.
it('keeps the dash when a calculation input is an explicit blank', () => {
  const data: TableData = {
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'fy', kind: 'value' }, { id: 'plan', kind: 'value' }],
    rows: [{ id: 'now', label: 'Revenue', cells: { fy: 40, plan: 38 } },
      { id: 'yoy', label: 'YoY', relation: 'displayOnly', calc: { op: 'percentDelta', a: { row: 'now' }, b: { row: 'py' } } },
      { id: 'py', label: 'Prior year', relation: 'displayOnly', missing: 'blank', cells: { fy: 36 } }],
  };
  const yoy = resolveTable(data, { target: 'report', theme: { preset: 'standard', overrides: { table: { dataGap: 'word' } } } }).table.rows.find(r => r.id === 'yoy')!;
  expect(yoy.cells.plan!.displayed).toBe('\u2013');
});

// A row's money format printed a percent change and a parent share as "$0.0M", and a cell format on a computed cell was ignored.
it('keeps a computed column in its own kind under a row format and honours a computed cell format', () => {
  const data: TableData = {
    columns: [{ id: 'l', kind: 'rowLabel' }, { id: 'ac', kind: 'value' }, { id: 'py', kind: 'value' },
      { id: 'yoy', kind: 'computed', calc: { op: 'percentDelta', a: 'ac', b: 'py' } },
      { id: 'share', kind: 'computed', calc: { op: 'share', of: 'ac' } }],
    rows: [
      { id: 'p', format: '$1.2m', children: [
        { id: 'a', format: '$1.2m', cells: { ac: 2500000, py: 2000000 } },
        { id: 'b', format: '$1.2m', cells: { ac: 1500000, py: 1000000 } }] },
      { id: 'c', format: '$1.2m', cells: { ac: 1000000, py: 1000000 } }],
  };
  const rows = resolveTable(data, {}).table.rows;
  const shown = (row: string, col: string) => rows.find(r => r.id === row)!.cells[col]!.displayed;
  expect(['yoy', 'share'].map(col => shown('a', col))).toEqual(['25.0%', '50.0%']);
  expect(['yoy', 'share'].map(col => shown('p', col))).toEqual(['33.3%', '80.0%']);

  const delta = resolveTable({
    columns: [{ id: 'l', kind: 'rowLabel' }, { id: 'ac', kind: 'value', format: '1,234' }, { id: 'py', kind: 'value', format: '1,234' },
      { id: 'd', kind: 'computed', format: '+1,234', calc: { op: 'delta', a: 'ac', b: 'py' } }],
    rows: [{ id: 'rev', cells: { ac: 200, py: 100 } }, { id: 'margin', cells: { ac: { v: 19.84, format: '1.0%' }, py: { v: 18.5, format: '1.0%' }, d: { format: '+1.0pp' } } }],
  }, {}).table.rows;
  expect(delta.map(r => r.cells.d!.displayed)).toEqual(['+100', '+1.3pp']);

  // A column that multiplies or divides by a literal lost its row's currency and unit ("2.6" and "208,333" instead of "$2.6M" and "$0.2M").
  const scaled = resolveTable({
    columns: [{ id: 'l', kind: 'rowLabel' }, { id: 'ac', kind: 'value' },
      { id: 'fc', kind: 'computed', calc: { op: 'mul', a: { ref: 'ac' }, b: { lit: 1.05 } } },
      { id: 'rr', kind: 'computed', calc: { op: 'div', a: { ref: 'ac' }, b: { lit: 12 } } }],
    rows: [{ id: 'rev', format: '$1.2m', cells: { ac: 2500000 } }],
  }, {}).table.rows;
  expect(['ac', 'fc', 'rr'].map(col => scaled[0]!.cells[col]!.displayed)).toEqual(['$2.5M', '$2.6M', '$0.2M']);
});

// A large Range total made unequal weekly counts and money both print as 0.2B.
it('keeps scaled weekly levels accurate beside a large range total', () => {
  const cells = { range: 5_705_293_076, w1: 188_633_562, w2: 195_633_562, zero: 0 };
  const { table } = resolveTable({
    columns: [{ id: 'label', kind: 'rowLabel' }, ...Object.keys(cells).map(id => ({ id, kind: 'value' as const }))],
    rows: [
      { id: 'sessions', label: 'Sessions', scale: 'count', cells },
      { id: 'revenue', label: 'Revenue', scale: 'money', format: '$1.2', unitAffix: '$', cells },
      { id: 'exact', label: 'Authored counts', scale: 'count', format: '1,234', cells },
    ],
  });
  const printed = (index: number) => Object.keys(cells).map(id => table.rows[index]!.cells[id]!.displayed);
  expect(printed(0)).toEqual(['5.705B', '0.189B', '0.196B', '0.000B']);
  expect(printed(1)).toEqual(['5.705B', '0.189B', '0.196B', '0.000B']);
  expect(table.rows[1]!.unitAffix).toBe('$');
  expect(printed(2)).toEqual(['5,705,293,076', '188,633,562', '195,633,562', '0']);
});

// Rounding made different acquisition costs and small fees look equal, with or without an authored format.
it('keeps fractional per-unit costs distinct with authored and default precision', () => {
  const { table } = resolveTable({
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'w1', kind: 'value' }, { id: 'w2', kind: 'value' }],
    rows: [
      { id: 'cac', label: 'CAC', scale: 'perUnit', unitAffix: '$', format: '$1.2', cells: { w1: 29.0625, w2: 28.6363636364 } },
      { id: 'auto', label: 'Automatic CAC', scale: 'perUnit', unitAffix: '$', cells: { w1: 29.0625, w2: 28.6363636364 } },
      { id: 'fees', label: 'Fees per order', scale: 'perUnit', unitAffix: '$', cells: { w1: 0.038, w2: 0.042 } },
    ],
  });
  expect([table.rows[0]!.cells.w1!.displayed, table.rows[0]!.cells.w2!.displayed]).toEqual(['29.1', '28.6']);
  expect(table.rows[0]!.unitAffix).toBe('$');
  expect([table.rows[1]!.cells.w1!.displayed, table.rows[1]!.cells.w2!.displayed]).toEqual(['29.1', '28.6']);
  expect([table.rows[2]!.cells.w1!.displayed, table.rows[2]!.cells.w2!.displayed]).toEqual(['0.038', '0.042']);
});

// An authored magnitude of thousand or million had no effect on money rows, which always climbed k, M, B.
it('holds an authored magnitude on money rows and climbs for auto', () => {
  const printed = (cells: number[], magnitude?: 'auto' | 'thousand' | 'million') => resolveTable({
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value' }],
    rows: cells.map((v, i) => ({ id: `r${i}`, label: `Row ${i}`, scale: 'money' as const, cells: { v } })),
  }, magnitude === undefined ? {} : { magnitude }).table.rows.map((row) => row.cells.v!.displayed);
  expect(printed([14_814_804, 2_222_220], 'thousand')).toEqual(['14,815k', '2,222k']);
  expect(printed([1_200_000_000], 'million')[0]).toMatch(/M$/);
  expect(printed([14_814_804, 2_222_220], 'auto')).toEqual(['14.8M', '2.2M']);
  expect(printed([1_200_000_000])[0]).toMatch(/B$/);
});

// A forced thousand printed a $12.93 per-order row as "13": the row left the scale but lost its authored decimals.
it('keeps the authored decimals of a small money row under a forced magnitude', () => {
  const { table } = resolveTable({
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'q1', kind: 'value' }],
    rows: [{ id: 'sales', label: 'Sales', format: '$1.2M', cells: { q1: 4_120_000 } }, { id: 'aov', label: 'AOV', format: '$1.23', cells: { q1: 12.93 } }],
  }, { magnitude: 'thousand' });
  expect(table.rows.map((row) => row.cells.q1!.displayed)).toEqual(['4,120', '12.93']);
});

// A '1,234k' column printed 1,080,000 as "1.1M" under its "(k)" head: the example's grouped digits hold the magnitude.
// An authored '$0k' printed 2,496,000 as "$2.5M" beside "$640k", with fitFormats off and no warning.
it('holds the magnitude of an authored example, grouped or not', () => {
  const { table } = resolveTable({
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'spend', kind: 'value', format: '1,234k' }, { id: 'short', kind: 'value', format: '$1.2k' }],
    rows: [950_000, 1_080_000].map((v, i) => ({ id: `r${i}`, label: `Row ${i}`, cells: { spend: v, short: v } })),
  });
  expect(table.rows.map((row) => row.cells.spend!.displayed)).toEqual(['950', '1,080']);
  expect(table.rows.map((row) => row.cells.short!.displayed)).toEqual(['950.0', '1,080.0']);
  expect(table.columns.find((column) => column.id === 'short')!.unitLabel).toBe('$k');
});

// fitFormats printed 80,000 and 100,000 both as "0.1" under (M): every figure keeps two significant digits.
it('keeps two significant digits of every figure when it fits formats', () => {
  const cells = (data: TableData) => layout('table', data, { fitFormats: true, size: { width: 320 } }).scene
    .filter((node): node is TextNode => node.t === 'text' && /^cell:r\d:v$/.test(node.id)).map((node) => node.lines.join(''));
  const column = (values: number[], format: string) => cells({ columns: [{ id: 'label', kind: 'rowLabel', label: 'Region', width: 120 }, { id: 'v', kind: 'value', label: 'Orders', width: 44, format }],
    rows: values.map((v, i) => ({ id: `r${i}`, label: `Row ${i}`, cells: { v } })) });
  expect(column([80_000, 100_000, 1_234_567], '1,234')).toEqual(['80', '100', '1,235']);
  expect(column([2_470_000, 2_630_000], '$1.23M')).toEqual(['2.5', '2.6']);
  // A small figure blocks a magnitude that would print it as zero: 12 never reads "0.00001" under M.
  expect(column([12, 100_000, 1_234_567], '1,234').every((text) => !/^0[.,]0/.test(text))).toBe(true);
  // So does a chart-level format, and a shorter decimal keeps one magnitude: 950 and 1,000 under (k), not 950 and 1.0M.
  const chartFormat = layout('table', { columns: [{ id: 'label', kind: 'rowLabel', label: 'Region', width: 120 }, { id: 'v', kind: 'value', label: 'Orders', width: 44 }],
    rows: [12, 100_000, 1_234_567].map((v, i) => ({ id: `r${i}`, label: `Row ${i}`, cells: { v } })) }, { format: '1,234', fitFormats: true, size: { width: 320 } }).scene
    .filter((node): node is TextNode => node.t === 'text' && /^cell:r\d:v$/.test(node.id)).map((node) => node.lines.join(''));
  expect(chartFormat.every((text) => !/^0[.,]0/.test(text))).toBe(true);
  expect(column([950_000, 999_600], '1.2k').filter((text) => /M/.test(text))).toEqual([]);
  // A unit word takes no magnitude: '1,234 m²' never fits to 1.2 under "(km²)".
  const area = layout('table', { columns: [{ id: 'label', kind: 'rowLabel', label: 'Region', width: 120 }, { id: 'v', kind: 'value', label: 'Area', width: 44, format: '1,234 m²' }],
    rows: [{ id: 'r0', label: 'Row 0', cells: { v: 1234 } }] }, { fitFormats: true, size: { width: 320 } }).scene
    .filter((node): node is TextNode => node.t === 'text' && /^(header:v|cell:r0:v)$/.test(node.id)).map((node) => node.lines.join(' '));
  expect(area.join(' ')).not.toMatch(/km²/);
});

// A bar table refused { state: 'nm' } cells, and a null in a one-series panel was called a blank sum with an incomplete-composition warning.
it('prints bar table cell states and calls a one-series null a missing value', () => {
  const data = (values: unknown[]) => ({
    categories: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }, { id: 'c', label: 'Gamma' }],
    series: [{ id: 'cpo', label: 'Cost per order' }],
    panels: [{ id: 'p', label: 'CPO', unit: '$', values: { cpo: values } }],
  });
  const stated = data([12.5, { state: 'na' }, { state: 'nm' }]);
  expect(bartableDataSchema.safeParse(stated).success).toBe(true);
  const g = layout('bartable', stated, { total: false });
  expect(Object.fromEntries(g.labels.filter((l) => l.id.startsWith('end:p:')).map((l) => [l.id.slice(6), l.text])))
    .toEqual({ a: '12.5', b: 'n/a', c: 'n.m.' });
  const missing = layout('bartable', data([12.5, 18.2, null]), { total: false, notes: { show: ['note', 'disclosure', 'method'] } });
  const codes = missing.warnings.map((w) => w.code);
  expect(codes).toContain('missing-value');
  expect(codes).not.toContain('incomplete-composition');
  const text = missing.scene.filter((n): n is TextNode => n.t === 'text').map((n) => n.lines.join(' ')).join(' | ');
  expect(text).toContain('marks a missing value');
  expect(text).not.toContain('sum');
});

// A table sparkline column ignored its width and cut a wide end value ("240...") in its fixed 88 px track.
it('sizes the sparkline track from its end value and keeps an authored width', () => {
  const table = {
    columns: [
      { id: 'label', kind: 'rowLabel', label: 'Metric' },
      { id: 'm1', kind: 'value', label: 'M1', format: '$1,1' },
      { id: 'm2', kind: 'value', label: 'M2', format: '$1,1' },
      { id: 'trend', kind: 'encoding', label: 'Trend', encoding: { type: 'sparkline', sourceColumns: ['m1', 'm2'] } },
    ],
    rows: [{ id: 'a', label: 'Revenue', cells: { m1: 1_800_000, m2: 2_400_000 } }],
  };
  const last = layout('table', table, { size: { width: 720 } }).scene.find((n): n is TextNode => n.t === 'text' && n.id === 'sparkLast:a:trend')!;
  expect(last.lines.join('')).toBe('2400000.0');
  // The React grid reads the same track functions.
  const theme = resolveTheme(undefined);
  const resolved = resolveTable(table as unknown as TableData).table;
  const trend = resolved.columns.find((column) => column.id === 'trend')!;
  const font = { family: theme.type.family, ...theme.type.axis };
  const context = {
    measure: defaultMeasurer, fonts: tableFonts(theme, levelLadder(theme), 4), cellFont: () => font, inlineFont: () => font,
    rowIndent: () => 0, padX: 12, headerText: (column: { label?: string }) => column.label ?? '', sparkFont: font,
  };
  expect(intrinsicColumnWidth(trend, resolved.rows, context as never)).toBeGreaterThan(ENCODING_WIDTH);
  expect(authoredTrackWidth({ ...trend, width: 120 }, resolved.rows, context as never)).toBe(120);
});

// only a nonzero figure that prints as 0 changes; fitting, row precision and the width stay unchanged.
it('lifts only zero-looking figures, after fitting, without costing the table its width', () => {
  const texts = (geometry: { scene: SceneNode[] }, prefix: string) => geometry.scene.filter((node): node is TextNode => node.t === 'text' && node.id.startsWith(prefix)).map(node => node.lines.join(' '));
  const fit = (values: number[], width: number) => texts(layout('table', { columns: [{ id: 'label', kind: 'rowLabel', label: 'Item', width: 140 }, { id: 'value', kind: 'value', label: 'Orders', width }],
    rows: values.map((v, i) => ({ id: `r${i}`, label: `Row ${i}`, cells: { value: v } })) }, { target: 'report', size: { width: 960 }, fitFormats: true }), 'cell:r');
  expect(fit([30680, 10336, 4], 56).filter(text => /\d/.test(text) && !text.startsWith('Row'))).toEqual(['30.7', '10.3', '<0.1']);
  expect(fit([3068000, 1033600, 1200], 50).filter(text => /\d/.test(text) && !text.startsWith('Row'))).toEqual(['3.1', '1.0', '<0.1']);
  const money = resolveTable({ columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'a', kind: 'value' }, { id: 'b', kind: 'value' }, { id: 'c', kind: 'value' }],
    rows: [{ id: 'm', label: 'Money', scale: 'money', cells: { a: 1500, b: 40, c: 2300 } }] }, { target: 'report' }).table.rows[0]!;
  expect(['a', 'b', 'c'].map(id => money.cells[id]!.displayed)).toEqual(['1,500', '40', '2,300']);
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  const wide = layout('table', { columns: [{ id: 'label', kind: 'rowLabel', label: 'Item' }, ...ids.map(id => ({ id, kind: 'value', label: id.toUpperCase() }))],
    rows: ['x', 'y', 'z'].map((r, i) => ({ id: r, label: `Row ${r}`, cells: Object.fromEntries(ids.map((c, j) => [c, j === 3 && i === 1 ? 450 : 1234567 + j * 1000 + i])) })) }, { target: 'report', size: { width: 320 } });
  expect(texts(wide, 'cell:y:d')).toEqual(['<0.1']);
  const share = resolveTable({ columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value' }, { id: 's', kind: 'computed', calc: { op: 'share', of: 'v' } }],
    rows: [{ id: 'a', label: 'A', cells: { v: 99990 } }, { id: 'b', label: 'B', cells: { v: 4 } }] }, { target: 'report' }).table.rows;
  expect(share.map(row => row.cells.s!.displayed)).toEqual(['100.0%', '<0.1%']);
});

// A tight table fell back to the plain rounded text and printed 0.001 as a bare "0.00"; it prints the bound.
it('prints the bound, not a bare zero, where the bound costs a compact step', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const geometry = layout('table', { columns: [{ id: 'label', kind: 'rowLabel', label: 'Item' }, ...ids.map(id => ({ id, kind: 'value', label: id.toUpperCase() }))],
    rows: ['x', 'y'].map((r, i) => ({ id: r, label: `Row ${r}`, cells: Object.fromEntries(ids.map((c, j) => [c, j === 3 ? (i ? 0.001 : 0.42) : 0.5 + j / 10 + i / 100])) })) }, { target: 'report', size: { width: 454 } });
  expect(geometry.scene.filter((node): node is TextNode => node.t === 'text' && node.id === 'cell:y:d').map(node => node.lines.join(''))).toEqual(['<0.01']);
});

// The React grid and its server snapshot resolve cells outside a chart layout and printed the default bound under smallValues 'zero'.
it('resolves table cells in the table smallValues mode outside a layout', () => {
  const data = { columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value' }], rows: [0.042, 0.0000000012].map((v, i) => ({ id: `r${i}`, label: `R${i}`, cells: { v } })) };
  expect(resolveTable(data as unknown as TableData, { smallValues: 'zero' }).table.rows.map(row => row.cells.v!.displayed)).toEqual(['0.042', '0.000']);
});

// The table hover card printed 0.000000001 for 0.0000000012 under the column's generated example; the bar card prints the source digits.
it('prints the source digits in the card of a table cell that rounds to zero', () => {
  const data = { columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value' }], rows: [0.042, 0.0000000012].map((v, i) => ({ id: `r${i}`, label: `R${i}`, cells: { v } })) } as unknown as TableData;
  const options = { smallValues: 'zero' as const };
  const records = preparedTableRecords(resolveTable(data, options).table, data, { chartId: 't' } as never, options);
  expect(displayedValueText(records.find(record => record.target.owner.rowId === 'r1')!.value)).toBe('0.0000000012');
});

// A table a little wider than its card draws with tighter spacing, not a refusal box. Comfort air gives way first; every cell prints whole.
it('draws a table a little wider than its card with tight spacing instead of refusing', () => {
  const fixture = getFixtures('table').find((entry) => entry.id === 'benchmark-competitors')!;
  const geometry = layout('table', fixture.data, { ...fixture.options, size: { width: 320 } });
  expect(geometry.size.width).toBe(320);
  expect(geometry.warnings.map((warning) => warning.code)).toContain('table-tight-spacing');
  expect(geometry.scene.filter((node) => node.t === 'text' && node.id.startsWith('cell:') && node.title !== undefined)).toEqual([]);
});

// Addition noise on billion-scale children must not read as a reconciliation gap or drop the partial mark.
it('validates a partial authored total with a scale-aware tolerance', () => {
  const data = tableDataSchema.parse({
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value', nulls: 'skip' }],
    rows: [{ id: 'p', role: 'total', totalPolicy: 'validate', cells: { v: 1000000000.946312 } },
      { id: 'a', parentId: 'p', cells: { v: 1000000000.44814 } }, { id: 'b', parentId: 'p', cells: { v: 0.498172 } },
      { id: 'c', parentId: 'p', cells: { v: null } }],
  });
  const resolved = resolveTable(data, { target: 'report' });
  expect(resolved.warnings.map(w => w.code)).not.toContain('total-reconciliation');
  expect(resolved.table.rows.find(r => r.id === 'p')!.cells.v!.displayed).toContain('(partial)');
});

// A full pace against an outlook that skipped a child printed "+167.1% (partial)", a change between two different sets of rows.
it('prints n.m. for a change between a full total and a partial one, and keeps a like-for-like partial change', () => {
  const data = tableDataSchema.parse({
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'pace', kind: 'value' }, { id: 'out', kind: 'value', nulls: 'skip' },
      { id: 'plan', kind: 'value', nulls: 'skip' },
      { id: 'vsOut', kind: 'computed', calc: { op: 'percentDelta', a: 'pace', b: 'out' } },
      { id: 'vsPlan', kind: 'computed', calc: { op: 'percentDelta', a: 'out', b: 'plan' } },
      { id: 'both', kind: 'computed', calc: { op: 'add', a: { ref: 'pace' }, b: { ref: 'out' } } },
      { id: 'scaled', kind: 'computed', calc: { op: 'div', a: { ref: 'out' }, b: { lit: 1000 } } }],
    rows: [{ id: 'p', cells: {} },
      { id: 'a', parentId: 'p', cells: { pace: 700, out: null, plan: null } }, { id: 'b', parentId: 'p', cells: { pace: 395, out: 410, plan: 400 } }],
  });
  const resolved = resolveTable(data, { target: 'report' });
  const parent = resolved.table.rows.find(r => r.id === 'p')!.cells;
  expect(parent.vsOut!.displayed).toBe('n.m.');
  expect(parent.vsPlan!.displayed).toContain('(partial)');
  // A sum of a full and a partial total stays the partial sum of what exists.
  expect(parent.both!.displayed).toContain('(partial)');
  // A literal covers no rows: a partial total over 1000 stays a value.
  expect(parent.scaled!.displayed).toContain('(partial)');
  expect(resolved.table.footnotes).toContain('n.m.: not meaningful, the compared totals cover different rows.');
});

// A row calc compared a full row total with a partial one and printed a change between two different sets of rows.
it('prints n.m. for a row calc that compares a full total with a partial one', () => {
  const data = tableDataSchema.parse({
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'pace', kind: 'value' }, { id: 'out', kind: 'value', nulls: 'skip' }],
    rows: [{ id: 'p', cells: {} },
      { id: 'a', parentId: 'p', cells: { pace: 700, out: null } }, { id: 'b', parentId: 'p', cells: { pace: 395, out: 410 } },
      { id: 'f', cells: { pace: 1000, out: 900 } },
      { id: 'r', relation: 'displayOnly', calc: { op: 'sub', a: { ref: { row: 'p' } }, b: { ref: { row: 'f' } } }, cells: {} }],
  });
  const resolved = resolveTable(data, { target: 'report' });
  const r = resolved.table.rows.find(row => row.id === 'r')!.cells;
  expect(r.out!.displayed).toBe('n.m.');
  expect(r.pace!.displayed).not.toBe('n.m.');
  // A row calc that changed its own partial cell does not make a later column, which read the authored cell, partial.
  const own = tableDataSchema.parse({
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value', nulls: 'skip' }, { id: 'w', kind: 'value' }],
    rows: [{ id: 'p', cells: {} }, { id: 'a', parentId: 'p', cells: { v: null, w: 100 } }, { id: 'b', parentId: 'p', cells: { v: 10, w: 200 } },
      { id: 'r', kind: 'result', cells: { v: 5 }, calc: { op: 'add', a: { ref: 'v' }, b: { ref: { row: 'p' } } } },
      { id: 's', kind: 'result', calc: { op: 'sub', a: { ref: { row: 'r', col: 'w' } }, b: { ref: { row: 'p', col: 'w' } } } }],
  });
  const s = resolveTable(own, { target: 'report' }).table.rows.find(row => row.id === 's')!.cells;
  expect(s.w!.displayed).toBe('5');
});

// A row topN.rest false omits kept its value for the calcs that read it, but lost which child its total skipped.
it('prints n.m. where a kept row calc compares a full total with a partial total that top-N omits', () => {
  const data = tableDataSchema.parse({
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'pace', kind: 'value' }, { id: 'out', kind: 'value', nulls: 'skip' }],
    rows: [{ id: 'big', cells: { pace: 1000, out: 950 } }, { id: 'next', cells: { pace: 900, out: 880 } },
      { id: 'mid', cells: {} }, { id: 'm1', parentId: 'mid', cells: { pace: 300, out: null } }, { id: 'm2', parentId: 'mid', cells: { pace: 200, out: 210 } },
      { id: 'gap', kind: 'result', calc: { op: 'sub', a: { ref: { row: 'big' } }, b: { ref: { row: 'mid' } } } }],
  });
  const resolved = resolveTable(data, { target: 'report', topN: { n: 2, rest: false } });
  expect(resolved.table.rows.some(row => row.id === 'mid')).toBe(false);
  const gap = resolved.table.rows.find(row => row.id === 'gap')!.cells;
  expect(gap.out!.displayed).toBe('n.m.');
  expect(gap.pace!.displayed).not.toBe('n.m.');
});

// Tone text printed in the raw tone read 2.96:1 on the standard total ground of this fixture.
it('prints table tone text at 4.5:1 or more on its ground', () => {
  const tones = new Set(['good', 'bad', 'warn']);
  const toneOf = (ink: Paint) => 'token' in ink && ink.theme?.kind === 'series-text' && 'token' in ink.theme.base ? ink.theme.base.token : 'token' in ink ? ink.token : undefined;
  const theme = resolveTheme('standard');
  const fixture = getFixtures('table').find((f) => f.id === 'management-report')!;
  const scene = layout('table', fixture.data, { ...fixture.options, theme: 'standard' }).scene;
  const toned = scene.flatMap((node, i) => node.t === 'text' && tones.has(toneOf(node.ink) ?? '') ? [[node, i] as const] : []);
  expect(toned.length).toBeGreaterThan(0);
  for (const [node, i] of toned) {
    // The ground is the last rect drawn under the text's first line.
    const px = node.align === 'end' ? node.x - 2 : node.x + 2;
    const py = node.y + node.font.size * 0.6;
    const ground = scene.slice(0, i).reverse().find((r): r is Extract<SceneNode, { t: 'rect' }> =>
      r.t === 'rect' && r.fill !== undefined && px >= r.rect.x && px <= r.rect.x + r.rect.w && py >= r.rect.y && py <= r.rect.y + r.rect.h);
    const ratio = contrastRatio(paintColor(theme, node.ink), ground ? paintColor(theme, ground.fill!) : theme.color.background);
    expect(ratio, `${node.id} on ${ground?.part ?? 'page'}`).toBeGreaterThanOrEqual(4.5);
  }
});

// A theme-authored total ground must not leave a toned figure under 4.5:1 on it.
it('deepens tone text for a light authored total ground', () => {
  const base = resolveTheme();
  const theme = { ...base, table: { ...base.table, grounds: { ...base.table?.grounds, total: '#C8CCD2' } } };
  expect(contrastRatio(paintColor(theme, toneTextPaint(theme, 'good')), '#C8CCD2')).toBeGreaterThanOrEqual(4.5);
});

// A strong column band at bandTint 0.52 must not turn all table and dimswitch tone text near-black or white.
it('keeps tone hues on page-side grounds and gives a strong column band its own readable ink', () => {
  const tones = ['good', 'bad', 'warn'] as const;
  const data: TableData = {
    columns: [{ id: 'l', kind: 'rowLabel' }, ...tones.map(id => ({ id, kind: 'value' as const, band: true }))],
    rows: [{ id: 't', label: 'Total', role: 'total', cells: Object.fromEntries(tones.map(tone => [tone, { v: 1, tone }])) }],
  };
  for (const [preset, color] of [
    ['standard', { background: '#FFFFFF', ink: '#1C1F24', neutral: '#EDEDEB', good: '#157C48', bad: '#B42318', warn: '#7E6C14' }],
    ['standard-dark', { background: '#171A1F', ink: '#F5F5F4', neutral: '#24272C', good: '#4CC38A', bad: '#F2847A', warn: '#D4AE2A' }],
  ] as const) {
    const request = resolveChartRequest({ type: 'table', data, theme: { preset, overrides: {
      color, surface: { bandTint: 0.52, chipTint: 0.9, rowTint: 0.94, anchorTint: 0.97 },
    } } } as never);
    const theme = request.theme;
    const band = mixColors(color.neutral, color.background, 0.52);
    const strong = mixColors(color.ink, color.neutral, 0.52);
    const geometry = requireGeometry(layoutResolvedRequest(request));
    const css = tableStylesheet(theme);
    const cellRule = css.split('\n').find(rule => rule.startsWith('.bp-table-grid [data-bp-rowgroup="body"] [role="row"][data-bp-ground="emphasis"]') && rule.includes('--bp-good-text:'))!;
    expect(cellRule).toBeDefined();
    for (const tone of tones) {
      const shared = paintColor(theme, toneTextPaint(theme, tone));
      const hue = hueSaturation(shared)!;
      expect(hue.saturation).toBeGreaterThan(0.25);
      expect(Math.abs(hue.hue - hueSaturation(color[tone])!.hue)).toBeLessThan(3);
      for (const ground of [color.background, band, color.neutral]) expect(contrastRatio(shared, ground)).toBeGreaterThanOrEqual(4.5);
      const own = paintColor(theme, onTableGround(toneTextPaint(theme, tone), { css: strong }, tone));
      expect(contrastRatio(own, strong)).toBeGreaterThanOrEqual(4.5);
      const text = geometry.scene.find((node): node is TextNode => node.t === 'text' && node.id === `cell:t:${tone}`)!;
      expect(paintColor(theme, text.ink)).toBe(own);
      expect(cellRule).toContain(`--bp-${tone}-text:${own}`);
    }
  }
});

// A named palette must not select white band ink against a light neutral background that the React grid paints.
it('matches React column-band ink to the painted neutral grounds with a named palette', () => {
  for (const [preset, color] of [
    ['standard', { background: '#FFFFFF', ink: '#1C1F24', neutral: '#EDEDEB' }],
    ['standard-dark', { background: '#171A1F', ink: '#F5F5F4', neutral: '#24272C' }],
  ] as const) {
    const theme = resolveTheme({ preset, overrides: { color, surface: { bandTint: 0.52 } } });
    for (const palette of [undefined, 'atlantic']) {
      const css = tableStylesheet(theme, undefined, false, false, false, 1, palette);
      for (const [variable, qualifier] of [['emphasis', ''], ['column-band-strong', '[data-bp-ground="emphasis"]']] as const) {
        const ground = css.match(new RegExp(`--bp-${variable}:([^;}]+)`))![1]!;
        const selector = `.bp-table-grid [data-bp-rowgroup="body"] [role="row"]${qualifier}:not([data-highlight-tone]):not([data-anchor])>[data-bp-band]`;
        const rule = css.split('\n').find(line => line.startsWith(`${selector}{--bp-ink:`));
        const ink = rule?.match(/--bp-ink:([^;}]+)/)?.[1] ?? theme.color.ink;
        expect(contrastRatio(ink, ground), `${preset} ${palette ?? 'default'} ${variable}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  }
});

// Alpha hex and percentage rgba grounds must keep tone text as readable as the same opaque ground.
it('checks table tone text on the composited colour of every accepted alpha form', () => {
  const base = resolveTheme('standard');
  const ink = (ground: string) => {
    const theme = { ...base, table: { ...base.table, grounds: { ...base.table?.grounds, total: ground } } };
    return paintColor(theme, toneTextPaint(theme, 'good'));
  };
  const opaque = ink('#cccccc');
  expect(contrastRatio(opaque, '#cccccc')).toBeGreaterThanOrEqual(4.5);
  for (const ground of ['#0003', '#00000033', 'rgba(0, 0, 0, 0.2)', 'rgb(0, 0, 0, 0.2)', 'rgba(0%, 0%, 0%, 20%)']) {
    expect(ink(ground), ground).toBe(opaque);
  }
  for (const ground of ['#0000', '#00000000', 'rgba(0, 0, 0, 0)', 'transparent']) {
    expect(ink(ground), ground).toBe(ink(base.color.background));
  }
});

// A collapsed last section must keep its heavy rule in the SVG, as the grid draws it.
it('draws the section rule under a collapsed last section', () => {
  const geometry = layout('table', {
    columns: [{ id: 'l', kind: 'rowLabel' }, { id: 'ac', kind: 'value' }],
    rows: [
      { id: 's1', label: 'Growth', role: 'section', children: [{ id: 'a', label: 'First', cells: { ac: 1 } }] },
      { id: 's2', label: 'Cost', role: 'section', children: [{ id: 'c', label: 'Cost per order', cells: { ac: 12 } }] },
    ],
  }, { size: { width: 360 }, expansion: { collapsed: ['s2'] } });
  expect(geometry.scene.some((node) => node.id === 'rule:section:s2')).toBe(true);
});

// A number in a status column printed the missing dash with no warning; it keeps the dash and warns.
it('warns about a number in a status cell', () => {
  const data: TableData = {
    columns: [{ id: 'l', kind: 'rowLabel', label: 'Ad' }, { id: 's', kind: 'status', label: 'State' }],
    rows: [{ id: 'a', label: 'Ad A', cells: { s: 1 } }],
  };
  const { table, warnings } = resolveTable(data);
  expect(table.rows[0]!.cells.s!.state).not.toBe('value');
  expect(warnings.map((w) => w.code)).toContain('status-value-number');
});

// Whitespace-only status labels must stay accepted and draw as before while both surfaces receive a repair warning.
it('warns once per blank status label and offers its removal', () => {
  const data = tableDataSchema.parse({
    columns: [{ id: 'l', kind: 'rowLabel' }, { id: 's', kind: 'status', labels: { pending: '   ', done: '\t', 'on-track': ' On track ' } }],
    rows: [{ id: 'a', cells: { s: 'pending' } }, { id: 'b', cells: { s: { v: 'pending' } } }],
  });
  const resolved = resolveTable(data);
  expect(resolved.table.rows.map(row => row.cells.s!.displayed)).toEqual(['   ', '   ']);
  const warnings = resolved.warnings.filter(warning => warning.code === 'status-label-blank');
  expect(warnings.map(warning => ({ field: warning.field, fix: warning.fix }))).toEqual(['pending', 'done'].map(key => ({
    field: ['data', 'columns', 1, 'labels', key], fix: [{ op: 'remove', path: `/data/columns/1/labels/${key}` }],
  })));
  expect(layout('table', data).warnings.filter(warning => warning.code === 'status-label-blank')).toEqual(warnings);
});

// Under tones: 'fill' an inline line of one tone sits on its parent's fill of another tone; its text read under 4.5:1 there.
it('prints tone text at 4.5:1 on every tone fill under tones fill', () => {
  for (const [name, preset] of Object.entries(themes)) {
    const theme = { ...preset, table: { ...preset.table, tones: 'fill' as const } };
    const grounds = cellGrounds(theme);
    for (const tone of ['good', 'bad', 'warn'] as const) for (const fill of ['good', 'goodStrong', 'warn', 'bad'] as const) {
      expect(contrastRatio(paintColor(theme, toneTextPaint(theme, tone)), grounds[fill]), `${name} ${tone} on ${fill}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

// The heavy section rule drew where the theme asks for no line: the close under closeRule 'none', above a result under resultRule 'none'.
it('draws no heavy section rule where the theme rules are none', () => {
  const data = {
    columns: [{ id: 'l', kind: 'rowLabel' }, { id: 'v', kind: 'value' }],
    rows: [
      { id: 's1', kind: 'section', label: 'Revenue' }, { id: 'a', label: 'Product', cells: { v: 120 } },
      { id: 's2', kind: 'section', label: 'Result' }, { id: 'r', label: 'Net', kind: 'result', cells: { v: 120 } },
      { id: 's3', kind: 'section', label: 'Later' },
    ],
  };
  const rules = (overrides: object) => layout('table', data, { theme: { preset: 'boardroom', overrides: { table: overrides } } })
    .scene.filter((node) => node.id.startsWith('rule:section:')).map((node) => node.id);
  expect(rules({})).toEqual(['rule:section:s1', 'rule:section:s2', 'rule:section:s3']);
  expect(rules({ closeRule: 'none', resultRule: 'none' })).toEqual(['rule:section:s1']);
});

// A status label wider than an authored column width drew over its neighbours with no warning.
it('cuts a status label at its authored column width and warns', () => {
  for (const mark of ['square', undefined]) {
    const geometry = layout('table', {
      columns: [{ id: 'l', kind: 'rowLabel' }, { id: 's', kind: 'status', width: 70, ...(mark ? { mark } : {}), labels: { 'at-risk': 'Learning limited' } }, { id: 'v', kind: 'value' }],
      rows: [{ id: 'a', label: 'Lookalike', cells: { s: 'at-risk', v: 900 } }],
    });
    const label = geometry.scene.find((node): node is TextNode => node.t === 'text' && node.id === 'cell:a:s')!;
    expect(label.lines.join(''), String(mark)).toMatch(/…$/);
    expect(label.title).toBe('Learning limited');
    expect(geometry.warnings.map((w) => w.code), String(mark)).toContain('table-column-clipped');
  }
});

// A row calc that reads the previous period printed the dash in every cell, with no warning, when no columnGroup ordered the periods.
it('warns when a previous-period calc has no column group to read', () => {
  const data = {
    columns: [{ id: 'l', kind: 'rowLabel' }, { id: 'jan', kind: 'value' }, { id: 'feb', kind: 'value' }],
    rows: [{ id: 'rev', cells: { jan: { v: 100, tone: 'good', strong: true }, feb: { v: 110, tone: 'good' } }, children: [
      { id: 'mom', relation: 'displayOnly', inline: true, calc: { op: 'percentDelta', a: { row: 'rev' }, b: { row: 'rev', previous: true } } },
    ] }],
  } as TableData;
  expect(resolveTable(data).warnings.filter(warning => warning.code === 'calc-previous-ungrouped').map(warning => warning.owner)).toEqual([{ rowId: 'mom' }]);
  const grouped = resolveTable({ ...data, columnGroups: [{ id: 'm', label: 'Months', columns: ['jan', 'feb'] }] });
  expect(grouped.warnings.some(warning => warning.code === 'calc-previous-ungrouped')).toBe(false);
  expect(grouped.table.rows.find(row => row.id === 'mom')!.cells.feb!.displayed).toBe('10.0%');
  // A group over the label column and one month gives no value column a predecessor, so it still warns.
  const unrelated = resolveTable({ ...data, columnGroups: [{ id: 'x', label: 'X', columns: ['l', 'jan'] }] });
  expect(unrelated.warnings.some(warning => warning.code === 'calc-previous-ungrouped')).toBe(true);
  // A value column after a ratio column reads the ratio as its previous member, so no warning.
  const afterRatio = resolveTable({ ...data, columns: [...data.columns, { id: 'r', kind: 'computed', calc: { op: 'div', a: { ref: 'feb' }, b: { ref: 'jan' } } }, { id: 'mar', kind: 'value' }], columnGroups: [{ id: 'x', label: 'X', columns: ['r', 'mar'] }] } as TableData);
  expect(afterRatio.warnings.some(warning => warning.code === 'calc-previous-ungrouped')).toBe(false);
});

// A status group wider than its authored track overlapped its neighbours, and a cut label kept its full text only in the SVG title.
it('fits a status group into a narrow track and names cut labels in the notes list', () => {
  const columns = (width: number) => [
    { id: 'l', kind: 'rowLabel' }, { id: 'v', kind: 'value' },
    { id: 's', kind: 'status', width, labels: { 'on-track': 'Active', 'at-risk': 'Learning limited' } },
  ];
  const rows = [{ id: 'a', label: 'Alpha', cells: { v: 1, s: 'on-track' } }, { id: 'b', label: 'Beta', cells: { v: 2, s: 'at-risk' } }];
  for (const [width, note] of [[20, 's: Alpha = Active; Beta = Learning limited'], [64, 's: A… = Active; L… = Learning limited']] as const) {
    const geometry = layout('table', { columns: columns(width), rows }, { size: { width: 480, height: 160 } });
    const track = (geometry.marks as { columns: { id: string; x: number; w: number }[] }).columns.find(column => column.id === 's')!;
    const chips = geometry.scene.filter((node): node is Extract<SceneNode, { t: 'rect' }> => node.t === 'rect' && node.part === 'tableChip');
    for (const chip of chips) expect(chip.rect.x >= track.x && chip.rect.x + chip.rect.w <= track.x + track.w, `${width}`).toBe(true);
    // The narrower track cuts its heading too; retain that name without repeating the status note.
    expect(geometry.frame.noteList?.filter(entry => entry.kind === 'disclosure').map(entry => entry.text))
      .toEqual(width === 20 ? [note, 'Full text of shortened labels: S.'] : [note]);
  }
  // Under the cut floor a short label that fits the track without the cell padding still prints whole.
  const short = layout('table', {
    columns: [{ id: 'l', kind: 'rowLabel' }, { id: 'v', kind: 'value' }, { id: 's', kind: 'status', width: 40, labels: { 'on-track': 'OK', pending: 'Hold', 'at-risk': 'Late', 'off-track': 'No' } }],
    rows: ['on-track', 'pending', 'at-risk', 'off-track'].map((s, i) => ({ id: `r${i}`, label: `R${i}`, cells: { v: i, s } })),
  }, { size: { width: 480, height: 200 } });
  const printed = short.scene.filter((node): node is TextNode => node.t === 'text' && node.part === 'tableCell' && node.owner.colId === 's').map(node => node.lines[0]);
  expect(printed).toEqual(['OK', 'Late', 'No']);
  expect(short.frame.noteList?.filter(entry => entry.kind === 'disclosure').map(entry => entry.text)).toEqual(['s: R1 = Hold']);
  // A note that named only the first rows of a squared label left the others with no status a reader can find.
  const many = layout('table', {
    columns: [{ id: 'l', kind: 'rowLabel' }, { id: 'v', kind: 'value' }, { id: 's', kind: 'status', width: 20, labels: { 'at-risk': 'Learning limited' } }],
    rows: [0, 1, 2, 3, 4].map((i) => ({ id: `r${i}`, label: `R${i}`, cells: { v: i, s: 'at-risk' } })),
  }, { size: { width: 480, height: 240 } });
  expect(many.frame.noteList?.filter(entry => entry.kind === 'disclosure').map(entry => entry.text))
    .toEqual(['s: R0, R1, R2, R3, R4 = Learning limited', 'Full text of shortened labels: S.']);
  // A label that fits whole but starts with "…" is not a tail-only cut and prints.
  const lead = layout('table', {
    columns: [{ id: 'l', kind: 'rowLabel' }, { id: 'v', kind: 'value' }, { id: 's', kind: 'status', width: 100, labels: { pending: '…held' } }],
    rows: [{ id: 'a', label: 'Alpha', cells: { v: 1, s: 'pending' } }],
  }, { size: { width: 480, height: 160 } });
  expect(lead.scene.find((node): node is TextNode => node.t === 'text' && node.id === 'cell:a:s')?.lines[0]).toBe('…held');
  // Such a label too wide for its column drew the square alone: its own "…" read as the cutter's.
  const leadCut = layout('table', {
    columns: [{ id: 'l', kind: 'rowLabel' }, { id: 'v', kind: 'value' }, { id: 's', kind: 'status', width: 80, labels: { pending: '…held by budget' } }],
    rows: [{ id: 'a', label: 'Alpha', cells: { v: 1, s: 'pending' } }],
  }, { size: { width: 480, height: 160 } });
  expect(leadCut.scene.find((node): node is TextNode => node.t === 'text' && node.id === 'cell:a:s')?.lines[0]).toMatch(/^…\p{L}+…$/u);
});

// A dark authored total ground on a light page printed the row label and figures in the page ink at about 1.2:1,
// and a repaint from a light to a dark theme kept the light page's choice for a light ground.
it('prints every text on a ground across the page lightness at 4.5:1, after a repaint too', () => {
  const data: TableData = {
    columns: [{ id: 'l', kind: 'rowLabel' }, { id: 'ac', kind: 'value' }, { id: 'pl', kind: 'value' }, { id: 'd', kind: 'computed', calc: { op: 'percentDelta', a: 'ac', b: 'pl' }, polarity: 'higherIsBetter', format: '+1.1%' }],
    rows: [{ id: 't', label: 'Group', role: 'total', cells: { ac: 128, pl: 121 } }, { id: 'a', label: 'North', cells: { ac: 70, pl: 60 } }],
  };
  const texts = (geometry: { scene: SceneNode[] }, theme: ReturnType<typeof resolveTheme>, ground: string) => geometry.scene
    .filter((node): node is TextNode => node.t === 'text' && node.owner?.rowId === 't' && node.lines.join('') !== '')
    .map((node) => contrastRatio(paintColor(theme, node.ink), ground));
  const request = (preset: string, total: string, options: object = {}) => resolveChartRequest({ type: 'table', data, options, theme: { preset, overrides: { table: { grounds: { total } } } } } as never);
  // A heat lane leaves the total bare, so its figure stands on the row's ground too.
  const dark = layoutResolvedRequest(request('boardroom', '#1F2A44', { encodings: { ac: 'heat' } }));
  expect(Math.min(...texts(requireGeometry(dark), resolveTheme('boardroom'), '#1F2A44'))).toBeGreaterThanOrEqual(4.5);
  const light = requireGeometry(layoutResolvedRequest(request('standard', '#eeeeee')));
  const target = request('standard-dark', '#eeeeee');
  const repainted = repaintGeometry(light, target.theme, {});
  expect(Math.min(...texts(repainted, target.theme, '#eeeeee'))).toBeGreaterThanOrEqual(4.5);
  // A banded column draws its band over the dark total; its figures printed white on that light band (1.28:1).
  const band = getFixtures('table').find((fixture) => fixture.id === 'column-band')!;
  const banded = requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'table', data: band.data, options: band.options, theme: { preset: 'standard', overrides: { table: { grounds: { total: '#1F2A44' } } } } } as never)));
  const standard = resolveTheme('standard');
  const bandFill = banded.scene.find((node): node is Extract<SceneNode, { t: 'rect' }> => node.t === 'rect' && node.part === 'tableColumnBand' && node.owner?.rowId === 'total')!;
  const bandedText = banded.scene.find((node): node is TextNode => node.t === 'text' && node.id === 'cell:total:ytdAc')!;
  expect(contrastRatio(paintColor(standard, bandedText.ink), paintColor(standard, bandFill.fill!))).toBeGreaterThanOrEqual(4.5);
  // A highlight washes over the dark total; its text printed white on that light wash (1.10:1).
  const washed = requireGeometry(layoutResolvedRequest(request('standard', '#111111', { highlight: ['t'] })));
  const wash = washed.scene.find((node): node is Extract<SceneNode, { t: 'rect' }> => node.t === 'rect' && node.part === 'tableRowTint')!;
  expect(Math.min(...texts(washed, standard, paintColor(standard, wash.fill!)))).toBeGreaterThanOrEqual(4.5);
  // A repaint replaces the ground-text warnings it re-decides; it kept a stale one beside the new.
  const stale = { ...light, warnings: [...light.warnings, { code: 'table-tone-text-unreadable', severity: 'warn' as const, message: 'stale' }] };
  expect(repaintGeometry(stale, target.theme, {}).warnings.map((warning) => warning.code)).not.toContain('table-tone-text-unreadable');
});

// Two status labels cut to one text ("L… = Learning, L… = Learning limited") left the reader unable to tell the marks apart,
// and a square drawn alone lost the cell's data-bp-state.
it('keeps the status cuts of one column distinct and states a square drawn alone', () => {
  const geometry = (width: number) => layout('table', {
    columns: [{ id: 'l', kind: 'rowLabel' }, { id: 'v', kind: 'value' }, { id: 's', kind: 'status', width, labels: { 'on-track': 'Learning', 'at-risk': 'Learning limited' } }],
    rows: [{ id: 'a', label: 'Alpha', cells: { v: 1, s: 'on-track' } }, { id: 'b', label: 'Beta', cells: { v: 2, s: 'at-risk' } }],
  }, { size: { width: 480, height: 160 } });
  const notes = (width: number) => geometry(width).frame.noteList?.filter(entry => entry.kind === 'disclosure').map(entry => entry.text);
  expect(notes(64)).toEqual(['s: L… = Learning; Beta = Learning limited']);
  expect(notes(100)).toEqual(['s: L…limited = Learning limited']);
  const square = geometry(64).scene.find((node): node is Extract<SceneNode, { t: 'rect' }> => node.t === 'rect' && node.part === 'tableChip' && node.owner.rowId === 'b')!;
  expect(square.display?.state).toBe('Learning limited');
  // The cuts read every row of the column, so expanding a parent does not change a visible cut.
  const cut = (expanded: boolean) => layout('table', {
    columns: [{ id: 'l', kind: 'rowLabel' }, { id: 'v', kind: 'value' }, { id: 's', kind: 'status', width: 100, labels: { 'at-risk': 'Learning limited', 'off-track': 'Learning paused' } }],
    rows: [{ id: 'a', label: 'Alpha', cells: { v: 1, s: 'at-risk' }, children: [{ id: 'c', label: 'Child', cells: { v: 1, s: 'off-track' } }] }],
  }, { size: { width: 480, height: 160 }, expansion: expanded ? { depth: 'all' } : { depth: 0 } }).scene.find((node): node is TextNode => node.t === 'text' && node.id === 'cell:a:s')!.lines[0];
  expect(cut(false)).toBe(cut(true));
});

// A bullet card of neutral rows only described an "on target or better" zone and lower-is-better bands it does not draw.
it('describes the bands of a neutral-only bullet card', () => {
  const desc = (direction?: string) => layout('bullet', { rows: [
    { id: 'a', label: 'A', value: 5, target: 6, direction: 'neutral' },
    { id: 'b', label: 'B', value: 7, target: 6, ...(direction === undefined ? {} : { direction }) },
  ] }, { sharedScale: 'percentOfTarget' }).a11y.desc;
  expect(desc('neutral')).toContain('No side is better');
  expect(desc('neutral')).not.toContain('or better');
  expect(desc()).not.toContain('lower is better');
});

// A column-count threshold must not remove cell padding while the frame has room for all columns.
it('keeps cell padding in a wide table with free frame space', () => {
  const columns: TableData['columns'] = [{ id: 'label', kind: 'rowLabel', label: 'Item' },
    ...Array.from({ length: 25 }, (_, index) => ({ id: `v${index}`, kind: 'value' as const, label: `${index + 1}`, format: '1,234' }))];
  const data: TableData = { columns, rows: [{ id: 'north', label: 'North',
    cells: Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`v${index}`, 1234])) }] };
  const geometry = layout('table', data, { size: { width: 3000 }, frameFill: 'none' });
  const track = (geometry.marks as { columns: { id: string; x: number; w: number }[] }).columns.find(column => column.id === 'v0')!;
  const text = geometry.scene.find((node): node is TextNode => node.t === 'text' && node.id === 'cell:north:v0')!;
  expect(track.x + track.w - text.x).toBe(12);
});

// A narrow frame must not silently undercut an authored label width.
it('warns before narrowing authored tracks and gives a size that keeps them', () => {
  const data: TableData = { columns: [{ id: 'label', kind: 'rowLabel', label: 'Item', width: 360 },
    { id: 'value', kind: 'value', label: 'Value', width: 90 }],
    rows: [{ id: 'north', label: 'North division', cells: { value: 1234 } }] };
  const geometry = layout('table', data, { size: { width: 375 }, margin: { left: 0, right: 0, top: 0, bottom: 0 } });
  expect((geometry.marks as { columns: { w: number }[] }).columns.map(column => column.w)).toEqual([285, 90]);
  const warnings = geometry.warnings.filter(warning => warning.code === 'table-overflow');
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toMatchObject({ severity: 'warn', fix: [{ op: 'add', path: '/options/size', value: { width: 450 } }] });
  const fixed = layout('table', data, { size: { width: 450 }, margin: { left: 0, right: 0, top: 0, bottom: 0 } });
  expect((fixed.marks as { columns: { w: number }[] }).columns.map(column => column.w)).toEqual([360, 90]);
  expect(fixed.warnings.some(warning => warning.code === 'table-overflow')).toBe(false);
  expect(geometry.sizing?.naturalWidth).toBe(fixed.sizing?.naturalWidth);
  const fixture = getFixtures('table').find(item => item.id === 'contribution-margin-statement')!;
  const narrow = layout('table', fixture.data, { ...fixture.options, size: { width: 320 } });
  const repair = narrow.warnings.find(warning => warning.code === 'table-overflow')!.fix![0];
  if (repair?.op !== 'add') throw new Error('Expected a size patch.');
  expect(repair.value).not.toHaveProperty('height');
  const repaired = layout('table', fixture.data, { ...fixture.options, size: repair.value });
  expect(repaired.warnings.some(warning => warning.severity === 'error')).toBe(false);
  expect(repaired.warnings.some(warning => warning.code === 'table-overflow')).toBe(false);
  expect((repaired.marks as { columns: { w: number }[] }).columns.map(column => column.w)).toEqual([260, 100, 100]);
});

// A known width failure must not offer wrapping; an undecided render keeps the existing advice.
it('omits impossible wrap advice and keeps it when the width check cannot decide', async () => {
  const data: TableData = { columns: [{ id: 'label', kind: 'rowLabel', label: 'Item' }, { id: 'text', kind: 'text', label: 'Explanation' }, { id: 'v', kind: 'value', label: 'Value' }],
    rows: [{ id: 'r', label: 'North', cells: { text: 'This explanation contains several words that should fit on separate lines at a narrow width', v: 123456789 } }] };
  const draw = (width: number, wrap = false) => layoutResolvedRequest(resolveChartRequest({ type: 'table', data: { ...data, columns: data.columns.map(c => c.kind === 'text' ? { ...c, wrap } : c) }, options: { size: { width }, belowMinimum: 'refuse' } }));
  expect(draw(240).warnings.find(w => w.code === 'size-below-floor')?.suggest).not.toContain('Or set wrap: true');
  expect(draw(320).warnings.find(w => w.code === 'size-below-floor')?.suggest).toContain('Or set wrap: true');
  expect(draw(320, true).refused).not.toBe(true);
  const { measureResolvedRequest } = await import('../src/core/request');
  for (const width of [240, 320]) {
    const measured = measureResolvedRequest(resolveChartRequest({ type: 'table', data, options: { size: { width }, belowMinimum: 'refuse' } }));
    expect(measured.warnings.find(w => w.code === 'size-below-floor')?.suggest?.includes('Or set wrap: true')).toBe(width === 320);
  }
  // Width alone cannot settle the fixed height; measure can check the wrapped rows.
  const shortRequest = resolveChartRequest({ type: 'table', data, options: { size: { width: 320, height: 80 }, belowMinimum: 'refuse' } });
  expect(layoutResolvedRequest(shortRequest).warnings.find(w => w.code === 'size-below-floor')?.suggest).toContain('Or set wrap: true');
  expect(measureResolvedRequest(shortRequest).warnings.find(w => w.code === 'size-below-floor')?.suggest).not.toContain('Or set wrap: true');
  const { render } = await import('../src/cli/render');
  const { callTool } = await import('../src/mcp/server');
  for (const wrap of [false, true]) {
    const args = { spec: { type: 'table', data: { ...data, columns: data.columns.map(c => c.kind === 'text' ? { ...c, wrap } : c) }, options: { size: { width: 320 }, belowMinimum: 'refuse' } }, return: ['svg'] };
    const cli = render(args).body as { errors?: unknown; svg?: string };
    const mcp = callTool('boardplot_render', args).structuredContent as typeof cli;
    expect(JSON.stringify(mcp.errors)).toBe(JSON.stringify(cli.errors));
    expect(mcp.svg).toBe(cli.svg);
    if (wrap) expect(cli.svg).toContain('<svg');
  }
});

// Mid-tone heat bands must keep their figures and note lines readable after a paint-only theme change.
it('reads figures and notes on a heat band in the active theme', () => {
  const data = { columns: [{ id: 'l', kind: 'rowLabel' }, { id: 'v', kind: 'value', noteLine: true }], rows: [0, 1, 2, 3, 4].map(i => ({ id: `r${i}`, label: `Group ${i}`, cells: { v: { v: 10 + i, note: 'Estimate' } } })) };
  const options = { encodings: { v: { type: 'heat', steps: 5 } }, size: { width: 480 } };
  const source = requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'table', data, options, theme: 'standard' } as never)));
  const dark = resolveTheme('standard-dark');
  const painted = repaintGeometry(source, dark, {});
  const fresh = requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'table', data, options, theme: 'standard-dark' } as never)));
  for (const geometry of [painted, fresh]) {
    const ground = geometry.scene.find(n => n.t === 'rect' && n.owner?.rowId === 'r3' && n.part === 'tableHeat')! as Extract<SceneNode, { t: 'rect' }>;
    const texts = geometry.scene.filter((n): n is TextNode => n.t === 'text' && n.owner?.rowId === 'r3' && n.owner?.colId === 'v');
    expect(texts.length).toBeGreaterThanOrEqual(2);
    for (const text of texts) expect(contrastRatio(paintColor(dark, text.ink), paintColor(dark, ground.fill!)), text.id).toBeGreaterThanOrEqual(4.5);
  }
});

// A tone ground must not retain failing page ink or a failing inline-change ink on a mid-tone fill.
it('reads all text on a tone fill before and after repainting', () => {
  const data = { columns: [{ id: 'l', kind: 'rowLabel' }, { id: 'v', kind: 'value' }], rows: [{ id: 'regular', label: 'North', cells: { v: { v: 60, tone: 'good' } }, children: [{ id: 'change', label: 'Change', inline: true, relation: 'displayOnly', cells: { v: { v: 12, tone: 'bad' } } }] }] };
  const theme = { preset: 'standard', overrides: { table: { tones: 'fill', grounds: { good: '#777777' } } } };
  const source = requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'table', data, options: { size: { width: 480 } }, theme } as never)));
  for (const preset of ['standard', 'standard-dark']) {
    const target = resolveTheme({ ...theme, preset } as never);
    const painted = repaintGeometry(source, target, {});
    const texts = painted.scene.filter((n): n is TextNode => n.t === 'text' && n.owner?.rowId === 'regular' && n.owner?.colId === 'v');
    expect(texts).toHaveLength(2);
    for (const text of texts) expect(contrastRatio(paintColor(target, text.ink), '#777777'), text.id).toBeGreaterThanOrEqual(4.5);
  }
});

// A polarity badge in a two-line cell must sit behind its figure, clear of its change line.
it('centres a polarity badge on its figure line', () => {
  const geometry = layout('table', { columns: [{ id: 'l', kind: 'rowLabel' }, { id: 'v', kind: 'value' }], rows: [{ id: 'regular', label: 'North', cells: { v: { v: 60, tone: 'good' } }, children: [{ id: 'change', label: 'Change', inline: true, relation: 'displayOnly', cells: { v: 12 } }] }] }, { encodings: { v: 'polarityBadge' }, size: { width: 480 } });
  const badge = geometry.scene.find(n => n.id === 'badge:regular:v')! as Extract<SceneNode, { t: 'rect' }>;
  const figure = geometry.scene.find(n => n.id === 'cell:regular:v')! as TextNode;
  expect(Math.abs(badge.rect.y + badge.rect.h / 2 - (figure.y + figure.font.size * 1.2 / 2))).toBeLessThanOrEqual(0.5);
});

// A page-side total ground that needs its own muted ink must not overrule an authored figure ink that reads on it.
it('keeps a readable authored figure ink on a page-side total ground in React', () => {
  const theme = resolveTheme({ preset: 'standard', overrides: { table: { grounds: { total: '#dddddd' }, inks: { figure: '#990000' } } } } as never);
  const totalRules = tableStylesheet(theme).split('\n').filter(rule => rule.includes('[data-role="total"]') && rule.includes('[role="gridcell"]'));
  expect(totalRules.length).toBeGreaterThan(0);
  expect(totalRules.some(rule => rule.endsWith('{color:var(--bp-ink)}'))).toBe(false);
  expect(totalRules.some(rule => rule.endsWith('{color:#990000}'))).toBe(true);
});

// The group rule under "MONTH-TO-DATE · Jul 1–15" covered the heading text only: it stopped before YOY and started inside PRIOR YEAR.
it("rules every column of a column group under groupRule 'span'", () => {
  const fixture = getFixtures('table').find((f) => f.id === 'management-report-compact')!;
  const scene = layout('table', fixture.data, { ...fixture.options, groupRule: 'span' }).scene;
  const rule = scene.find((node): node is Extract<SceneNode, { t: 'line' }> => node.t === 'line' && node.id === 'group-rule:g-mtd')!;
  const yoyHead = scene.find((node): node is TextNode => node.t === 'text' && node.id === 'header:mtdYoY')!;
  expect(Math.abs(rule.x2 - yoyHead.x)).toBeLessThanOrEqual(1);
  // A group that lists its columns right to left still rules from its first drawn column to its last.
  const reversed = layout('table', {
    columnGroups: [{ id: 'g', label: 'Actual', columns: ['b', 'a'] }, { id: 'h', label: 'Plan', columns: ['c'] }],
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'a', kind: 'value', label: 'A' }, { id: 'b', kind: 'value', label: 'B' }, { id: 'c', kind: 'value', label: 'C' }],
    rows: [{ id: 'r', label: 'Revenue', cells: { a: 1, b: 2, c: 3 } }],
  }, { size: { width: 600, height: 300 }, groupRule: 'span' }).scene;
  const span = reversed.find((node): node is Extract<SceneNode, { t: 'line' }> => node.t === 'line' && node.id === 'group-rule:g')!;
  const heads = ['a', 'b'].map((id) => reversed.find((node): node is TextNode => node.t === 'text' && node.id === `header:${id}`)!);
  expect(span.x1).toBeLessThan(heads[0]!.x);
  expect(span.x2).toBeGreaterThanOrEqual(heads[1]!.x - 1);
});

// 0.52.0 started every group heading at its group's first column by default; the default is a centred heading again.
it('centres a group heading over its columns by default, on the SVG and in React', () => {
  const scene = layout('table', {
    columnGroups: [{ id: 'g', label: 'Actual', columns: ['a', 'b'] }, { id: 'h', label: 'Plan', columns: ['c'] }],
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'a', kind: 'value', label: 'A' }, { id: 'b', kind: 'value', label: 'B' }, { id: 'c', kind: 'value', label: 'C' }],
    rows: [{ id: 'r', label: 'Revenue', cells: { a: 1, b: 2, c: 3 } }],
  }, { size: { width: 600, height: 300 } }).scene;
  const heading = scene.find((node): node is TextNode => node.t === 'text' && node.id === 'group:g')!;
  const rule = scene.find((node): node is Extract<SceneNode, { t: 'line' }> => node.t === 'line' && node.id === 'group-rule:g')!;
  expect(heading.align).toBe('middle');
  expect(Math.abs(heading.x - (rule.x1 + rule.x2) / 2)).toBeLessThanOrEqual(1);
  // React: a group cell centres its heading unless 'left' is set or the group is wider than the scroll box.
  const css = tableStylesheet(resolveTheme());
  expect(css).toContain('.bp-groups>*{padding-bottom:.2em;align-items:safe center;');
  expect(css).toContain('.bp-table-grid:not([data-bp-group-align]) [data-bp-rowgroup="head"] .bp-groups>[data-bp-group-wide],.bp-table-grid[data-bp-group-align="left"] [data-bp-rowgroup="head"] .bp-groups>*{align-items:flex-start}');
});

// A heading wider than its fixed-width columns ran past the block divider with no warning, while the frame had free width.
it('gives a group heading over fixed columns free frame width, and warns where none is left', () => {
  const data = {
    columnGroups: [{ id: 'g', label: 'Rolling twelve months to date', columns: ['a', 'b'] }, { id: 'h', label: 'Plan', columns: ['c'] }],
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'a', kind: 'value', label: 'A', width: 40 }, { id: 'b', kind: 'value', label: 'B', width: 40 },
      { id: 'c', kind: 'value', label: 'C', width: 60 }],
    rows: [{ id: 'r', label: 'Row', cells: { a: 1, b: 2, c: 3 } }],
  };
  const wide = layout('table', data, { size: { width: 900, height: 300 } });
  expect(wide.warnings.map((w) => w.code)).not.toContain('table-group-heading-overflow');
  const rule = wide.scene.find((node): node is Extract<SceneNode, { t: 'line' }> => node.t === 'line' && node.id === 'group-rule:g')!;
  const heading = wide.scene.find((node): node is TextNode => node.t === 'text' && node.id === 'group:g')!;
  expect(rule.x2 - rule.x1).toBeGreaterThanOrEqual(defaultMeasurer(heading.lines[0]!, heading.font).width - 1);
  const narrow = layout('table', data, { size: { width: 240, height: 300 } });
  expect(narrow.warnings.map((w) => w.code)).toContain('table-group-heading-overflow');
});

// A pinned narrow label width cut "South" to "So…" in the SVG and the React grid; the track now grows to whole labels and gives the growth back to a narrow frame.
it('grows an authored row-label width to whole labels and still draws where the authored width drew', async () => {
  const data: TableData = { columns: [{ id: 'label', kind: 'rowLabel', label: 'Key', width: 52 }, ...['A', 'B', 'C', 'D'].map(id => ({ id, kind: 'value' as const, label: id, width: 64 }))],
    rows: ['South', 'North America'].map((label, i) => ({ id: `r${i}`, label, cells: { A: 12, B: 24, C: 36, D: 48 } })) };
  const { render } = await import('../src/cli/render');
  const svg = (width: number) => (render({ spec: { type: 'table', data, options: { size: { width } } }, return: ['svg'] }).body as { svg?: string }).svg ?? '';
  for (const width of [320, 480]) {
    expect(svg(width)).toMatch(/data-id="cell:r0:label"[^>]*>(<title>[^<]*<\/title>)?<tspan[^>]*>South<\/tspan>/);
    expect(svg(width)).toMatch(/data-id="cell:r1:label"[^>]*>(<title>[^<]*<\/title>)?<tspan[^>]*>North( America)?<\/tspan>/);
  }
  const warnings = layoutResolvedRequest(resolveChartRequest({ type: 'table', data, options: { size: { width: 480 } } })).warnings;
  expect(warnings.find(w => w.code === 'table-column-widened')?.detail).toMatchObject({ width: 52 });
});

// The compact fallback must not give a theme with no head air the least air of 7 px, or refuse a table that draws at 192 px.
it('never gives a theme with less head air more in the compact fallback', () => {
  const geometry = layout('table', {
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value', label: 'Value' }],
    rows: [{ id: 's', label: 'Section', role: 'section' }, ...Array.from({ length: 9 }, (_, i) => ({ id: `r${i}`, label: `Item ${i}`, cells: { v: i + 1 } }))],
  }, {
    size: { width: 600, height: 195 }, margin: { top: 0, bottom: 0, left: 12, right: 12 },
    theme: { preset: 'standard', overrides: { table: { headPad: { top: 0, bottom: 0 }, rows: { pad: 0 } } } },
  });
  expect(geometry.refused).not.toBe(true);
  expect(geometry.warnings.map(w => w.code)).not.toContain('size-below-floor');
});

// A capitalised head printed "Power,mW" as "POWER,MW": milliwatts read as megawatts.
it('keeps the unit after a head comma as written', async () => {
  const { fieldHeadText } = await import('../src/core/charts/table/headFace');
  const theme = resolveTheme('boardroom');
  expect(fieldHeadText('Power,mW', theme)).toBe('POWER,mW');
  expect(fieldHeadText('EBITDA impact, $bn', theme)).toBe('EBITDA IMPACT, $bn');
});

// `table.inks.head` was documented, but no table-family head read it, on the SVG or in the React grid.
it('paints every table-family column head in table.inks.head, on the SVG and in React', () => {
  const head = '#AA0000';
  const cases = [['table', 'management-report-compact'], ['cohort', 'retention-pure-exhibit'], ['bartable', 'impact-two-panels'], ['status', 'central-bank-decisions'], ['heatmap', 'harvey-quarter-steps']] as const;
  for (const [type, id] of cases) {
    const fixture = getFixtures(type).find((f) => f.id === id)!;
    const spec = { type, data: fixture.data, options: { ...fixture.options, theme: { preset: 'boardroom', overrides: { table: { inks: { head } } } } } };
    const svg = (render({ spec, return: ['svg'] }).body as { svg: string }).svg;
    expect(svg, type).toContain(`fill="${head}"`);
    expect((render({ spec, return: ['svg'] }).body as { svg: string }).svg, type).toBe(svg);
  }
  const groups = layout('table', getFixtures('table').find((f) => f.id === 'management-report-compact')!.data, { theme: { preset: 'boardroom', overrides: { table: { inks: { head } } } } }).scene;
  expect(groups.find((node): node is TextNode => node.t === 'text' && node.id === 'group:g-mtd')!.ink).toMatchObject({ theme: { kind: 'table-ink', role: 'head' } });
  const css = tableStylesheet(resolveTheme({ preset: 'boardroom', overrides: { table: { inks: { head } } } })).split('\n');
  const base = css.findIndex((rule) => rule.startsWith('.bp-table-grid [data-bp-rowgroup="head"] [role="row"]>*{'));
  const themed = css.findIndex((rule) => rule === `.bp-table-grid [data-bp-rowgroup="head"] .bp-columns>*,.bp-table-grid [data-bp-rowgroup="head"] .bp-groups>*{color:${head}}`);
  expect(themed).toBeGreaterThan(base);
  expect(base).toBeGreaterThanOrEqual(0);
});

// A transparent total ground once beat the pinned cell's page ground, so scrolled numbers showed through the Total label on a phone.
it('a pinned cell in a groundless total row keeps the page under it', () => {
  const css = tableStylesheet(resolveTheme('boardroom')).split('\n');
  const clear = css.findIndex((rule) => rule.includes('[data-role="total"]') && rule.endsWith('>*{background:transparent}'));
  const pinned = css.findIndex((rule) => rule.includes('[data-role="total"]') && rule.includes('>[data-bp-pin]{background:linear-gradient(var(--bp-row-ground),var(--bp-row-ground)),var(--bp-background)}'));
  expect(clear).toBeGreaterThanOrEqual(0);
  expect(pinned).toBeGreaterThan(clear);
});

// A narrow percent-change column under a money row format shortened the money and stayed clipped, though the percent fits at one digit less.
it('fits an overflowing percent change by its own format, not the money row format', () => {
  const data: TableData = {
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'ac', kind: 'value' }, { id: 'py', kind: 'value' },
      { id: 'yoy', kind: 'computed', calc: { op: 'percentDelta', a: 'ac', b: 'py' }, width: 60 }],
    rows: [{ id: 'rev', label: 'Revenue', format: '$1.2m', cells: { ac: 2500000, py: 2000000 } }],
  };
  const measure: typeof defaultMeasurer = (text, font) => ({ ...defaultMeasurer(text, font), width: text.length * 10 });
  const g = layout('table', data, { fitFormats: true, measure, size: { width: 480 } });
  const text = (col: string) => g.scene.find((n): n is TextNode => n.t === 'text' && n.id === `cell:rev:${col}`)!.lines.join('');
  expect([text('ac'), text('yoy')]).toEqual(['$2.5M', '25%']);
});

// The accessible table read the percent change under a money row format as "$25" while the cell printed 25.0%.
it('reads a percent change under a row format as a percent, as it reads one without the row format', () => {
  const data: TableData = {
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'ac', kind: 'value' }, { id: 'py', kind: 'value' },
      { id: 'yoy', kind: 'computed', calc: { op: 'percentDelta', a: 'ac', b: 'py' } }],
    rows: [{ id: 'rev', label: 'Revenue', format: '$1.2m', cells: { ac: 2500000, py: 2000000 } }],
  };
  const table = resolveTable(data, {}).table;
  const records = preparedTableRecords(table, data, { chartId: 't' } as never, {});
  const value = records.find(record => record.target.owner.rowId === 'rev' && record.target.owner.colId === 'yoy')!.value;
  expect(table.rows[0]!.cells.yoy!.displayed).toBe('25.0%');
  // The accessible table reads a derived percent at two decimals.
  expect(interactionValueText(value)).toBe('25.00%');
});

// fitFormats wrote the example "$1.234M" for a lifted cell, which reads back as a thousands group, so 3,000 printed "$0M".
it('keeps three lifted decimals as decimals when fitFormats writes the cell format', () => {
  const g = layout('table', { columns: [{ id: 'l', kind: 'rowLabel' }, { id: 'v', kind: 'value', format: '$1.23M', width: 62 }],
    rows: [{ id: 'a', cells: { v: 123_456_789 } }, { id: 'b', cells: { v: 3000 } }] }, { fitFormats: true });
  const cell = g.scene.find((node): node is TextNode => node.t === 'text' && node.id === 'cell:b:v');
  expect(cell!.lines.join('')).toBe('$0.003M');
});
