/**
 * The CLI contract: at most eight verbs, one JSON object on stdout,
 * exit 0 (ok), 1 (input rejected) or 2 (internal error). The grammar is
 * declared, not guessed: an unknown flag, a missing value or a repeated flag
 * is an error, never a silent default.
 */

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/core/charts';
import { FLAG_GRAMMAR, VERBS, main } from '../src/cli/main';
import { availableRasterizer } from '../src/cli/raster';
import { BOARDPLOT_VERSION } from '../src/version';
import { render } from '../src/cli/render';
import { measure } from '../src/cli/measure';
import * as chartRequest from '../src/core/request';
import { resolveTheme } from '../src/core/theme';
import { callTool, tools } from '../src/mcp/server';
import { InputError, specFromRows } from '../src/rows';
import { usageEvent } from '../src/telemetry/event';
import rowMappings from './fixtures/row-mappings.json';
import overwriteExample from './fixtures/render-overwrite.json';

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tdir(): string {
  const d = mkdtempSync(join(tmpdir(), 'boardplot-cli-contract-'));
  dirs.push(d);
  return d;
}

function runCli(args: string[]): { code: number; log: string[]; error: string[] } {
  const log: string[] = [];
  const error: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...v) => log.push(v.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...v) => error.push(v.join(' ')));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const code = main(args);
  vi.restoreAllMocks();
  return { code, log, error };
}

function envelope(result: { log: string[] }): {
  ok: boolean;
  errors: { code: string; message: string; path?: string }[];
  warnings: unknown[];
  outputs?: string[];
  charts?: { name: string; svg?: string }[];
  svg?: string;
  reading?: { data?: { rows: number; ignoredColumns: string[] } };
} {
  expect(result.log).toHaveLength(1);
  return JSON.parse(result.log[0]!);
}

const SPEC = {
  type: 'column',
  data: {
    categories: [{ id: 'q1', label: 'Q1' }, { id: 'q2', label: 'Q2' }],
    series: [{ id: 'rev', label: 'Revenue', values: [84, 91] }],
  },
  options: { title: 'Revenue rose in Q2' },
};
const DOC = { version: 1, charts: [{ name: 'c1', ...SPEC }] };

// Equivalent theme overrides must not add a full layout before the CLI draws a chart.
it('skips theme preflight only for resolved no-op overrides', () => {
  const layout = vi.spyOn(chartRequest, 'layoutResolvedRequest');
  const draw = (theme: unknown) => render({ spec: { ...SPEC, theme }, return: ['svg', 'reading'] });
  const preset = resolveTheme('boardroom');
  const expected = draw('boardroom');
  const draws = layout.mock.calls.length;
  expect(expected.body.ok).toBe(true);
  for (const overrides of [undefined, {}, { color: {} }, { color: { ink: preset.color.ink, series: [...preset.color.series] } }]) {
    layout.mockClear();
    expect(draw({ preset: 'boardroom', overrides })).toEqual(expected);
    expect(layout.mock.calls.length).toBe(draws);
  }
  layout.mockClear();
  draw({ preset: 'boardroom', overrides: { color: { highlight: '#123456' } } });
  expect(layout.mock.calls.length).toBeGreaterThan(draws);
  expect(draw({ preset: 'boardroom', overrides: { color: { ink: 42 } } }).body.ok).toBe(false);
});

describe('rows mappings', () => {
  // boardplot/rows must draw what the CLI's rows draw and refuse at the same row, or React and agent charts drift apart.
  it('specFromRows builds the data and the refusal that rows build in boardplot_render', () => {
    const template = { type: 'line', data: { series: [{ id: 'Search', label: 'Search ads' }] } };
    const rows = [{ week: 'W1', channel: 'Search', revenue: 10 }, { week: 'W1', channel: 'Social', revenue: 12 }, { week: 'W2', channel: 'Search', revenue: 11, note: 'x' }];
    const columns = { category: 'week', series: 'channel', value: 'revenue' };
    const { spec, reading } = specFromRows(template, { rows, columns });
    expect(reading).toEqual({ rows: 3, ignoredColumns: ['note'], states: [] });
    const drawn = render({ spec, return: ['svg'] }).body.svg;
    expect(drawn).toContain('<svg');
    expect(drawn).toBe(JSON.parse(callTool('boardplot_render', { spec: template, rows, columns, return: ['svg'] }).text).svg);
    const typo = [...rows, { week: 'W2', channel: 'Social', revenue: '1,234 $' }];
    const cli = JSON.parse(callTool('boardplot_render', { spec: template, rows: typo, columns }).text).errors[0];
    let thrown: unknown;
    try { specFromRows(template, { rows: typo, columns }); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(InputError);
    expect({ code: (thrown as InputError).code, path: (thrown as InputError).details.path, suggest: (thrown as InputError).details.suggest })
      .toEqual({ code: cli.code, path: cli.path, suggest: cli.suggest });
  });

  // A SQL month column mapped as category and date was refused, and a helper label equal to the id hid the automatic month labels.
  it('one date column fills category and date, and the categories keep their automatic date labels', () => {
    const rows = ['2026-01-01', '2026-02-01'].map((month) => ({ month, product: 'Sparrow', revenue: 131 }));
    const { spec } = specFromRows({ type: 'line' }, { rows, columns: { category: 'month', date: 'month', series: 'product', value: 'revenue' } });
    expect(spec.data.categories).toEqual([{ id: '2026-01-01', date: '2026-01-01' }, { id: '2026-02-01', date: '2026-02-01' }]);
  });

  for (const type of ['waterfall', 'scatter'] as const) it(`${type} rows render like authored data through CLI and MCP`, () => {
    const fixture = rowMappings[type];
    const dir = tdir();
    const rowsFile = writeDoc(dir, 'rows.json', fixture.rows);
    const columns = Object.entries(fixture.columns).map(([role, column]) => `${role}=${column}`).join(',');
    for (const alias of [type, type === 'waterfall' ? 'bridge' : 'bubble']) {
      const spec = { ...fixture.spec, type: alias };
      const authored = render({ spec: { ...spec, data: fixture.data }, return: ['svg'] });
      expect(authored.body.ok).toBe(true);
      const cli = envelope(runCli(['render', writeDoc(dir, 'spec.json', spec), '--rows', rowsFile, '--columns', columns, '--return', 'svg,reading']));
      const mcp = JSON.parse(callTool('boardplot_render', { spec, rows: fixture.rows, columns: fixture.columns, return: ['svg', 'reading'] }).text);
      expect(cli.ok, JSON.stringify(cli.errors)).toBe(true);
      expect(mcp.ok, JSON.stringify(mcp.errors)).toBe(true);
      expect(cli.svg).toBe(authored.body.svg);
      expect(mcp.svg).toBe(cli.svg);
      expect(cli.reading?.data).toMatchObject({ rows: fixture.rows.length, ignoredColumns: ['unused'] });
      expect(mcp.reading.data).toMatchObject({ rows: fixture.rows.length, ignoredColumns: ['unused'] });
      const measured = measure({ spec, rows: fixture.rows, columns: fixture.columns });
      expect(measured.body.ok).toBe(true);
      expect(JSON.parse(callTool('boardplot_measure', { spec, rows: fixture.rows, columns: fixture.columns }).text).data).toEqual(measured.body.data);
    }
    const minimal = type === 'waterfall'
      ? { columns: { label: 'item', value: 'amount' }, rows: [{ item: 'One', amount: 12 }], data: { items: [{ id: 'row-1', label: 'One', value: 12 }] } }
      : { columns: { x: 'effort', y: 'output' }, rows: [{ effort: 2.5, output: 8 }], data: { points: [{ id: 'row-1', x: 2.5, y: 8 }] } };
    const minimalRows = render({ spec: { type }, ...minimal, return: ['svg'] });
    const minimalAuthored = render({ spec: { type, data: minimal.data }, return: ['svg'] });
    expect(minimalRows.body.ok).toBe(true);
    expect(minimalAuthored.body.ok).toBe(true);
    expect(minimalRows.body.svg).toBe(minimalAuthored.body.svg);
    const csv = type === 'waterfall' ? 'item;amount\nOne;12\n' : 'effort;output\n2,5;8\n';
    writeFileSync(join(dir, 'rows.csv'), csv);
    const csvDrawn = envelope(runCli(['render', writeDoc(dir, 'minimal.json', { type }), '--rows', join(dir, 'rows.csv'), '--columns', Object.entries(minimal.columns).map(([role, column]) => `${role}=${column}`).join(','), '--return', 'svg']));
    expect(csvDrawn.ok).toBe(true);
    expect(csvDrawn.svg).toBe(minimalAuthored.body.svg);
    const invalidRole = type === 'waterfall' ? 'type' : 'size';
    const invalidColumn = fixture.columns[invalidRole as keyof typeof fixture.columns];
    const invalidRows = [{ ...fixture.rows[0], [invalidColumn!]: type === 'waterfall' ? 'wrong' : 'many' }];
    const refused = JSON.parse(callTool('boardplot_render', { spec: fixture.spec, rows: invalidRows, columns: fixture.columns }).text);
    expect(refused.ok).toBe(false);
    expect(refused.errors).toContainEqual(expect.objectContaining({ path: `/rows/0/${invalidColumn}` }));
    for (const rows of [[], [{}]]) {
      const empty = JSON.parse(callTool('boardplot_render', { spec: fixture.spec, rows, columns: fixture.columns }).text);
      expect(empty.errors).toContainEqual(expect.objectContaining({ code: rows.length ? 'missing-column' : 'rows-empty' }));
    }
    for (const tool of tools().filter(tool => ['boardplot_render', 'boardplot_measure'].includes(tool.name))) {
      const schema = tool.inputSchema.properties!.columns!;
      expect(schema.required ?? []).not.toContain('category');
      for (const role of Object.keys(fixture.columns)) expect(schema.properties).toHaveProperty(role);
    }
  });

  // A bar table from rows was refused at /data/panels, because the rows filled series values and a bar table reads its values from panels.
  it('bartable rows fill one panel keyed by segment, and a refused value points at its row', () => {
    const template = { type: 'bartable', data: { panels: [{ id: 'impact', label: 'Impact', ends: [{ low: 1, high: 2 }], values: {} }], columns: [{ id: 'n', values: [3] }] } };
    const rows = [{ c: 'A', s: 'run', v: 10 }, { c: 'A', s: 'grow', v: 5 }, { c: 'B', s: 'run', v: 7 }];
    const { spec } = specFromRows(template, { rows, columns: { category: 'c', series: 's', value: 'v', valueKind: 'percent' } });
    expect(spec.data).toEqual({
      categories: [{ id: 'A' }, { id: 'B' }],
      series: [{ id: 'run' }, { id: 'grow' }],
      panels: [{ id: 'impact', label: 'Impact', unit: '%', values: { run: [10, 7], grow: [5, null] } }],
    });
    expect(render({ spec, return: ['svg'] }).body.ok).toBe(true);
    const refused = JSON.parse(callTool('boardplot_render', { spec: { type: 'bartable' }, rows: [...rows, { c: 'C', s: 'run', v: -1 }], columns: { category: 'c', series: 's', value: 'v' } }).text);
    expect(refused.errors).toContainEqual(expect.objectContaining({ code: 'invalid-data', path: '/rows/3/v' }));
  });

  // One bar table panel adds its segments, so USD beside EUR, shares beside amounts, or a cell format were summed or lost without a word.
  it('bartable rows refuse two units, mixed percent and number values, and cell metadata at their row', () => {
    const refusal = (rows: Record<string, unknown>[], columns: Record<string, string>) => {
      try { specFromRows({ type: 'bartable' }, { rows, columns: { category: 'c', series: 's', value: 'v', ...columns } }); } catch (error) {
        return { code: (error as InputError).code, path: (error as InputError).details.path };
      }
      return undefined;
    };
    expect(refusal([{ c: 'A', s: 'us', v: 10, u: 'USD' }, { c: 'A', s: 'eu', v: 5, u: 'EUR' }], { unit: 'u' })).toEqual({ code: 'invalid-value', path: '/rows/1/u' });
    expect(refusal([{ c: 'A', s: 'run', v: 10 }, { c: 'B', s: 'run', v: { pct: 5 } }], {})).toEqual({ code: 'invalid-value', path: '/rows/1/v' });
    expect(refusal([{ c: 'A', s: 'run', v: 10 }, { c: 'B', s: 'run', v: { number: 10, format: '0.0' } }], {})).toEqual({ code: 'invalid-value', path: '/rows/1/v' });
    expect(refusal([{ c: 'A', s: 'us', v: 10, u: 'USD' }, { c: 'A', s: 'eu', v: 5, u: 'USD' }], { unit: 'u' })).toBeUndefined();
  });

  /** Rows as a CSV file with the given separator; null and an absent field become an empty field. */
  const rowsCsv = (rows: Record<string, unknown>[], separator: ',' | ';') => {
    const header = [...new Set(rows.flatMap(row => Object.keys(row)))];
    const field = (value: unknown) => (value === null || value === undefined ? ''
      : typeof value === 'number' && separator === ';' ? String(value).replace('.', ',') : String(value));
    return [header, ...rows.map(row => header.map(name => field(row[name])))].map(line => line.join(separator)).join('\n') + '\n';
  };

  // Table rows must draw the table that the same spec draws with authored rows, from JSON and both CSV separators, through CLI, MCP and measure, or a rows table drifts from the native one.
  it('table rows render like the authored table through CLI and MCP', () => {
    const fixture = rowMappings.table;
    const dir = tdir();
    const files = [
      writeDoc(dir, 'rows.json', fixture.rows),
      join(dir, 'comma.csv'), join(dir, 'semicolon.csv'),
    ];
    writeFileSync(files[1]!, rowsCsv(fixture.rows, ','));
    writeFileSync(files[2]!, rowsCsv(fixture.rows, ';'));
    for (const alias of ['table', 'tbl']) {
      const spec = { ...fixture.spec, type: alias };
      const native = { ...spec, data: { ...spec.data, rows: fixture.data.rows } };
      const authored = render({ spec: native, return: ['svg'] });
      expect(authored.body.ok, JSON.stringify(authored.body.errors)).toBe(true);
      const authoredSize = measure({ spec: native }).body;
      const authoredMcpSize = JSON.parse(callTool('boardplot_measure', { spec: native }).text);
      for (const file of files) {
        const cli = envelope(runCli(['render', writeDoc(dir, 'spec.json', spec), '--rows', file, '--columns', 'label=name,id=code', '--return', 'svg,reading']));
        expect(cli.ok, JSON.stringify(cli.errors)).toBe(true);
        expect(cli.svg).toBe(authored.body.svg);
        expect(cli.reading?.data).toMatchObject({ rows: 3, ignoredColumns: ['unused'] });
      }
      const mcp = JSON.parse(callTool('boardplot_render', { spec, rows: fixture.rows, columns: fixture.columns, return: ['svg', 'reading'] }).text);
      expect(mcp.svg).toBe(authored.body.svg);
      expect(mcp.reading.data).toMatchObject({ rows: 3, ignoredColumns: ['unused'] });
      const { data, ...measured } = JSON.parse(callTool('boardplot_measure', { spec, rows: fixture.rows, columns: fixture.columns }).text);
      expect(data).toMatchObject({ rows: 3 });
      expect(measured).toEqual(authoredMcpSize);
      const { data: cliData, ...cliMeasured } = measure({ spec, rows: fixture.rows, columns: fixture.columns }).body as Record<string, unknown>;
      expect(cliData).toMatchObject({ rows: 3 });
      expect(cliMeasured).toEqual(authoredSize);
    }
    // Without roles the rows are numbered in source order, and a field one row lacks is a missing cell.
    const { spec: numbered } = specFromRows(fixture.spec, { rows: fixture.rows.map(({ note, ...row }, index) => (index === 1 ? row : { ...row, note })), columns: {} });
    expect(numbered.data.rows).toMatchObject([{ id: 'row-1' }, { id: 'row-2', cells: { note: null } }, { id: 'row-3' }]);
    for (const tool of tools().filter(tool => ['boardplot_render', 'boardplot_measure'].includes(tool.name))) {
      expect(tool.inputSchema.properties!.columns!.properties).toHaveProperty('id');
    }
  });

  // Each table rows refusal must name the source row and field, or the spec column with no source field, so an agent fixes that cell instead of guessing.
  it('refuses table rows at the source row and field', () => {
    const { spec, rows, columns } = rowMappings.table;
    const refusal = (args: Record<string, unknown>) => JSON.parse(callTool('boardplot_render', { spec, rows, columns, ...args }).text).errors[0];
    expect(refusal({ rows: rows.map(({ note, ...row }) => row) })).toMatchObject({ code: 'missing-column', path: '/spec/data/columns/5/id' });
    expect(refusal({ rows: [{ ...rows[0], note: true }] })).toMatchObject({ code: 'invalid-value', path: '/rows/0/note' });
    expect(refusal({ rows: [rows[0], { ...rows[1], code: 'S' }] })).toMatchObject({ code: 'duplicate-id', path: '/rows/1/code' });
    expect(refusal({ rows: [{ ...rows[0], code: ' ' }] })).toMatchObject({ code: 'invalid-identity', path: '/rows/0/code' });
    expect(refusal({ rows: [{ ...rows[0], status: 'late' }] })).toMatchObject({ code: 'status-value-invalid', path: '/rows/0/status' });
    expect(refusal({ columns: { ...columns, label: 'region' } })).toMatchObject({ code: 'missing-column', path: '/columns/label' });
    expect(refusal({ columns: { ...columns, valueKind: 'percent' } })).toMatchObject({ code: 'invalid-argument', path: '/columns/valueKind' });
    expect(refusal({ spec: { type: 'table' } })).toMatchObject({ code: 'invalid-argument', path: '/spec/data/columns' });
    // A value column refuses text it cannot read as a number, as category rows do, instead of drawing the cell as missing.
    expect(refusal({ rows: [{ ...rows[0], revenue: '12%' }] })).toMatchObject({ code: 'invalid-value', path: '/rows/0/revenue', suggest: expect.stringContaining('percent format') });
    expect(refusal({ rows: [{ ...rows[0], plan: 'abc' }] })).toMatchObject({ code: 'invalid-value', path: '/rows/0/plan' });
    // A table warning about a source cell must point at that cell, not at path "".
    const numberStatus = JSON.parse(callTool('boardplot_render', { spec, rows: [{ ...rows[0], status: 3 }], columns }).text);
    expect(numberStatus.warnings).toContainEqual(expect.objectContaining({ code: 'status-value-number', path: '/rows/0/status' }));
    // Rows input must not hide what the native table refuses in the spec rows: a repeated id, a nested row with another parentId.
    const withRows = (specRows: unknown[]) => ({ spec: { ...spec, data: { ...spec.data, rows: specRows } } });
    expect(refusal(withRows([{ id: 'S' }, { id: 'S', format: '1.0' }]))).toMatchObject({ code: 'duplicate-row-id', path: '/spec/data/rows/1/id' });
    expect(refusal(withRows([{ id: 'T', children: [{ id: 'S', parentId: 'N' }] }]))).toMatchObject({ code: 'parent-conflict', path: '/spec/data/rows/0/children/0/parentId' });
    // A drawn row may not link to a spec row that no source row provides: its parent, or a row its calc names.
    expect(refusal(withRows([{ id: 'S', parentId: 'EU' }, { id: 'EU', label: 'Europe' }]))).toMatchObject({ code: 'parent-missing', path: '/spec/data/rows/0/parentId', suggest: expect.stringContaining("'EU'") });
    expect(refusal(withRows([{ id: 'N', relation: 'displayOnly', calc: { op: 'delta', a: 'revenue', b: { row: 'PY' } } }]))).toMatchObject({ code: 'calc-ref-missing', path: '/spec/data/rows/0/calc' });
    // A source field named __proto__ keeps its values, and an absent constructor field is a missing cell, not the inherited function.
    const protoSpec = { type: 'table', data: { columns: [{ id: 'name', kind: 'rowLabel' }, { id: '__proto__', kind: 'text' }, { id: 'constructor', kind: 'text' }] } };
    const protoRows = JSON.parse('[{ "name": "A", "__proto__": "x", "constructor": "c" }, { "name": "B", "__proto__": "y" }]');
    const { spec: proto } = specFromRows(protoSpec, { rows: protoRows, columns: { label: 'name' } });
    expect(JSON.parse(JSON.stringify(proto.data.rows))).toEqual([
      { id: 'row-1', label: 'A', cells: JSON.parse('{ "__proto__": "x", "constructor": "c" }') },
      { id: 'row-2', label: 'B', cells: JSON.parse('{ "__proto__": "y", "constructor": null }') },
    ]);
    expect(JSON.parse(callTool('boardplot_render', { spec: protoSpec, rows: protoRows, columns: { label: 'name' } }).text).ok).toBe(true);
    const dir = tdir();
    writeFileSync(join(dir, 'rows.csv'), rowsCsv([rows[0]!, { ...rows[1]!, code: 'S' }], ','));
    expect(envelope(runCli(['render', writeDoc(dir, 'spec.json', spec), '--rows', join(dir, 'rows.csv'), '--columns', 'label=name,id=code'])).errors)
      .toMatchObject([{ code: 'duplicate-id', path: '/rowsFile', message: expect.stringContaining('rowsFile row 2.code') }]);
  });

  // Histogram and box rows must draw what the same spec draws with authored observations, from JSON and both CSV separators, through CLI, MCP and measure, with box groups in first-appearance order.
  for (const type of ['histogram', 'box'] as const) it(`${type} rows render like authored observations through CLI and MCP`, () => {
    const fixture = rowMappings[type];
    const dir = tdir();
    const columns = Object.entries(fixture.columns).map(([role, column]) => `${role}=${column}`).join(',');
    const files = [writeDoc(dir, 'rows.json', fixture.rows), join(dir, 'comma.csv'), join(dir, 'semicolon.csv')];
    writeFileSync(files[1]!, rowsCsv(fixture.rows, ','));
    writeFileSync(files[2]!, rowsCsv(fixture.rows, ';'));
    for (const alias of type === 'histogram' ? ['histogram', 'distribution', 'frequency'] : ['box', 'boxplot', 'box-and-whisker']) {
      const spec = { ...fixture.spec, type: alias };
      const native = { ...spec, data: fixture.data };
      const authored = render({ spec: native, return: ['svg'] });
      expect(authored.body.ok, JSON.stringify(authored.body.errors)).toBe(true);
      for (const file of files) {
        const cli = envelope(runCli(['render', writeDoc(dir, 'spec.json', spec), '--rows', file, '--columns', columns, '--return', 'svg,reading']));
        expect(cli.ok, JSON.stringify(cli.errors)).toBe(true);
        expect(cli.svg).toBe(authored.body.svg);
        expect(cli.reading?.data).toMatchObject({ rows: fixture.rows.length, ignoredColumns: ['unused'] });
      }
      const mcp = JSON.parse(callTool('boardplot_render', { spec, rows: fixture.rows, columns: fixture.columns, return: ['svg'] }).text);
      expect(mcp.svg).toBe(authored.body.svg);
      const { data, ...measured } = JSON.parse(callTool('boardplot_measure', { spec, rows: fixture.rows, columns: fixture.columns }).text);
      expect(data).toMatchObject({ rows: fixture.rows.length });
      expect(measured).toEqual(JSON.parse(callTool('boardplot_measure', { spec: native }).text));
      const { data: cliData, ...cliMeasured } = measure({ spec, rows: fixture.rows, columns: fixture.columns }).body as Record<string, unknown>;
      expect(cliData).toMatchObject({ rows: fixture.rows.length });
      expect(cliMeasured).toEqual(measure({ spec: native }).body);
    }
  });

  // A missing or malformed observation must refuse at its source row and field, never drop out of the bins or quartiles in silence; box groups must refuse two labels or dates.
  it('refuses histogram and box observations at the source row and field', () => {
    for (const type of ['histogram', 'box'] as const) {
      const { spec, rows, columns } = rowMappings[type];
      const refusal = (args: Record<string, unknown>) => JSON.parse(callTool('boardplot_render', { spec, rows, columns, ...args }).text).errors[0];
      const withDays = (days: unknown) => rows.map((row, index) => (index === 2 ? { ...row, days } : row));
      expect(refusal({ rows: withDays(null) })).toMatchObject({ code: 'missing-value', path: '/rows/2/days' });
      expect(refusal({ rows: withDays(' ') })).toMatchObject({ code: 'missing-value', path: '/rows/2/days' });
      expect(refusal({ rows: withDays('n/a') })).toMatchObject({ code: 'invalid-value', path: '/rows/2/days' });
      expect(refusal({ rows: rows.map(({ days, ...row }, index) => (index === 2 ? row : { ...row, days })) })).toMatchObject({ code: 'missing-value', path: '/rows/2/days' });
      expect(refusal({ columns: { ...columns, value: 'minutes' } })).toMatchObject({ code: 'missing-column', path: '/columns/value' });
      expect(refusal({ columns: { ...columns, valueKind: 'fraction' } })).toMatchObject({ code: 'invalid-argument', path: '/columns/valueKind' });
      let thrown: unknown;
      try { specFromRows(spec, { rows: withDays(Infinity), columns }); } catch (error) { thrown = error; }
      expect(thrown).toMatchObject({ code: 'invalid-value', details: { path: '/rows/2/days' } });
    }
    expect(JSON.parse(callTool('boardplot_render', { spec: { type: 'histogram' }, rows: [{ days: 1 }, { days: 2 }, { days: 3 }], columns: { value: 'days' } }).text).ok).toBe(false);
    const { spec, rows, columns } = rowMappings.box;
    const refusal = (changed: Record<string, unknown>) => JSON.parse(callTool('boardplot_render', { spec, rows: rows.map((row, index) => (index === 4 ? { ...row, ...changed } : row)), columns }).text).errors[0];
    expect(refusal({ name: 'West region' })).toMatchObject({ code: 'ambiguous-mapping', path: '/rows/4/name' });
    const dated = rows.map((row, index) => ({ ...row, month: index === 4 ? '2026-02-01' : '2026-01-01' }));
    expect(JSON.parse(callTool('boardplot_render', { spec, rows: dated, columns: { ...columns, date: 'month' } }).text).errors[0]).toMatchObject({ code: 'ambiguous-mapping', path: '/rows/4/month' });
    expect(refusal({ team: '' })).toMatchObject({ code: 'invalid-identity', path: '/rows/4/team' });
    // A group label that is not text is a wrong value, not a second label for the group.
    expect(refusal({ name: 7 })).toMatchObject({ code: 'invalid-value', path: '/rows/4/name' });
    // Rows input must not hide the refusal the native box gives for a repeated spec group id.
    expect(JSON.parse(callTool('boardplot_render', { spec: { ...spec, data: { groups: [{ id: 'East' }, { id: 'East', label: 'East again' }] } }, rows, columns }).text).errors[0])
      .toMatchObject({ code: 'invalid-data', path: '/spec/data/groups/1/id' });
    const dir = tdir();
    writeFileSync(join(dir, 'rows.csv'), rowsCsv(rows.map((row, index) => (index === 4 ? { ...row, days: null } : row)), ';'));
    expect(envelope(runCli(['render', writeDoc(dir, 'spec.json', spec), '--rows', join(dir, 'rows.csv'), '--columns', 'category=team,value=days'])).errors)
      .toMatchObject([{ code: 'missing-value', path: '/rowsFile', message: expect.stringContaining('rowsFile row 5.days') }]);
  });

  it('refuses unsupported rows before checking category columns', () => {
    const dir = tdir();
    const spec = { type: 'kpi' };
    const rows = [{ item: 'One', delta: 12 }];
    const cli = envelope(runCli(['render', writeDoc(dir, 'spec.json', spec), '--rows', writeDoc(dir, 'rows.json', rows), '--columns', 'category=item,value=delta']));
    expect(cli.errors).toMatchObject([{ code: 'rows-unsupported-type', path: '/spec/type' }]);
    for (const name of ['boardplot_render', 'boardplot_measure']) {
      const mcp = JSON.parse(callTool(name, { spec, rows, columns: { category: 'item', value: 'delta' } }).text);
      expect(mcp.errors).toMatchObject([{ code: 'rows-unsupported-type', path: '/spec/type' }]);
    }
  });
});

function writeDoc(dir: string, name = 'doc.json', value: unknown = DOC): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
  return path;
}

describe('the verbs', () => {
  it('has at most nine verbs and prints the package version', () => {
    expect(VERBS).toEqual(['help', 'list', 'describe', 'fixtures', 'render', 'measure', 'fonts', 'telemetry', 'feedback']);
    for (const flag of ['--version', '-v']) {
      const result = runCli([flag]);
      expect(result.code).toBe(0);
      expect(result.log).toEqual([BOARDPLOT_VERSION]);
    }
  });

  // The published build must send nothing until a collector is approved, even after a stored yes and
  // an endpoint override; and an event, once a collector exists, must not carry a name the user typed.
  it('sends no usage event without a compiled collector, and keeps typed names out of events', () => {
    const config = tdir();
    vi.stubEnv('XDG_CONFIG_HOME', config);
    vi.stubEnv('BOARDPLOT_TELEMETRY_ENDPOINT', 'http://127.0.0.1:9');
    for (const name of ['CI', 'GITHUB_ACTIONS', 'DO_NOT_TRACK', 'BOARDPLOT_TELEMETRY']) vi.stubEnv(name, '');
    try {
      expect(envelope(runCli(['telemetry', 'on'])).ok).toBe(true);
      expect(runCli(['render', writeDoc(tdir())]).code).toBe(0);
      expect(readdirSync(join(config, 'boardplot'))).toEqual(['telemetry.json']);
      const status = JSON.parse(runCli(['telemetry', 'status']).log[0]!);
      expect(status).toMatchObject({ telemetry: 'off', reason: 'no-endpoint', choice: 'on', lastEvent: null });
    } finally {
      vi.unstubAllEnvs();
    }
    const event = usageEvent({
      surface: 'cli', command: 'render', host: 'none', install: '3f2b8c1e-4d5a-4b6c-9d7e-1a2b3c4d5e6f',
      spec: { type: 'clientChart', options: { acmeRevenue: 1, title: 'Acme' } },
      body: { ok: false, errors: [{ code: 'unknown-chart-type', message: 'clientChart' }] },
    });
    expect(event).toMatchObject({ types: ['other'], optionKeys: [], codes: ['unknown-chart-type'] });
    expect(JSON.stringify(event)).not.toMatch(/acme|clientChart/i);
  });

  it('answers every verb with exactly one JSON object', () => {
    const doc = writeDoc(tdir());
    for (const args of [['list'], ['describe', 'column'], ['describe', 'theme'], ['fixtures'], ['render', doc], ['measure', doc], ['help'], []]) {
      const result = runCli(args);
      expect(result.code, args.join(' ')).toBe(0);
      expect(envelope(result).ok, args.join(' ')).toBe(true);
    }
  });

  it('describes one field by path and returns the JSON Schema the docs promise', () => {
    expect(JSON.parse(runCli(['describe', 'mekko', '--path', 'valueAxis.break']).log[0]!)).toMatchObject({ ok: true, path: 'valueAxis.break', refused: expect.stringContaining("Refused on 'mekko'") });
    expect(JSON.parse(runCli(['describe', 'column', '--schema', 'data']).log[0]!)).toMatchObject({ ok: true, part: 'data', schema: { type: 'object', required: expect.arrayContaining(['categories', 'series']) } });
    expect(JSON.parse(runCli(['describe', 'column', '--path', 'name']).log[0]!)).toMatchObject({
      ok: true, part: 'spec', path: 'name', fields: [{ path: 'name', type: 'string', default: 'chart', description: expect.stringContaining('at most 100') }],
    });
  });

  it('refuses a mistyped verb with a typed envelope that names the verbs', () => {
    const result = runCli(['rendr', '--nope']);
    expect(result.code).toBe(1);
    const error = envelope(result).errors[0]!;
    expect(error.code).toBe('unknown-verb');
    expect(error.message).toContain("unknown command 'rendr'");
    expect(error.message).toContain('render');
  });
});

describe('the flag grammar', () => {
  it('declares every flag the dispatcher reads, and reads every flag it declares', () => {
    const source = readFileSync(new URL('../src/cli/main.ts', import.meta.url), 'utf8');
    const read = new Set<string>();
    for (const m of source.matchAll(/text\(flags, '([^']+)'\)/g)) read.add(m[1]!);
    for (const m of source.matchAll(/\bflags\.([A-Za-z][A-Za-z0-9]*)/g)) read.add(m[1]!);
    read.delete('_');
    read.delete('help'); // every verb takes --help and -h; flags.ts answers them outside the grammar
    const declared = new Set(Object.values(FLAG_GRAMMAR).flatMap((grammar) => Object.keys(grammar)));
    declared.delete('o');
    expect([...read].filter((name) => !declared.has(name)).sort()).toEqual([]);
    expect([...declared].filter((name) => !read.has(name)).sort()).toEqual([]);
  });

  it('rejects extra positional arguments for every verb', () => {
    const doc = writeDoc(tdir());
    for (const args of [['list', 'x'], ['describe', 'column', 'x'], ['fixtures', 'x'], ['render', doc, 'x'], ['measure', doc, 'x'], ['help', 'x']]) {
      const result = runCli(args);
      expect(result.code, args.join(' ')).toBe(1);
      expect(envelope(result).errors[0]!.code, args.join(' ')).toBe('extra-argument');
    }
  });

  it('answers --help and -h after a verb with that verb\'s usage', () => {
    for (const [verb, flag] of [['render', '--help'], ['fixtures', '-h']] as const) {
      const result = runCli([verb, flag]);
      expect(result.code, `${verb} ${flag}`).toBe(0);
      expect(JSON.parse(result.log[0]!).usage, `${verb} ${flag}`).toEqual({ [verb]: expect.stringContaining(`boardplot ${verb}`) });
    }
  });

  it('rejects an unknown flag and lists the verb\'s flags', () => {
    const result = runCli(['render', writeDoc(tdir()), '--json']);
    expect(result.code).toBe(1);
    const error = envelope(result).errors[0]!;
    expect(error.code).toBe('unknown-flag');
    expect(error.message).toContain("unknown flag '--json' for 'boardplot render'");
    expect(error.message).toContain('--format');
  });

  it('rejects a value flag without a value, and a repeated flag', () => {
    const doc = writeDoc(tdir());
    expect(envelope(runCli(['render', doc, '--out'])).errors[0]!.code).toBe('flag-missing-value');
    expect(envelope(runCli(['render', doc, '--out', '--format', 'svg'])).errors[0]!.code).toBe('flag-missing-value');
    expect(envelope(runCli(['render', doc, '--width', '800', '--width', '900'])).errors[0]!.code).toBe('flag-repeated');
    expect(envelope(runCli(['render', doc, '-o', tdir(), '--out', tdir()])).errors[0]!.code).toBe('flag-repeated');
    expect(envelope(runCli(['describe', 'column', '--full=yes'])).errors[0]!.code).toBe('flag-takes-no-value');
  });

  it('reads --flag=value like --flag value, and --full=false as no flag', () => {
    const doc = writeDoc(tdir());
    expect(runCli(['render', doc, '--width=800']).log).toEqual(runCli(['render', doc, '--width', '800']).log);
    expect(runCli(['describe', 'line', '--full=false']).log).toEqual(runCli(['describe', 'line']).log);
  });

  it('-- ends the flags so a path may begin with a dash', () => {
    const doc = writeDoc(tdir(), '-dash.json');
    const result = runCli(['render', '--', doc]);
    expect(result.code).toBe(0);
    expect(envelope(result).ok).toBe(true);
  });
});

describe('render and measure on the command line', () => {
  it('writes nothing without --out and leaves the working directory untouched', () => {
    const dir = tdir();
    const doc = writeDoc(dir);
    const result = runCli(['render', doc]);
    expect(result.code).toBe(0);
    expect(envelope(result).outputs).toBeUndefined();
    expect(readdirSync(dir)).toEqual(['doc.json']);
  });

  it('checks every chart before it creates the output directory', () => {
    const dir = tdir();
    const bad = { version: 1, charts: [DOC.charts[0], { ...DOC.charts[0], name: 'c2', data: { categories: [] } }] };
    const out = join(dir, 'out');
    const result = runCli(['render', writeDoc(dir, 'bad.json', bad), '--out', out]);
    expect(result.code).toBe(1);
    expect(existsSync(out)).toBe(false);
  });

  it('refuses duplicate chart names before any chart is drawn', () => {
    const dir = tdir();
    const duplicate = { version: 1, charts: [DOC.charts[0], DOC.charts[0]] };
    const result = runCli(['render', writeDoc(dir, 'dup.json', duplicate), '--out', join(dir, 'out')]);
    expect(result.code).toBe(1);
    expect(envelope(result).errors[0]).toMatchObject({ path: '/charts/1/name' });
    expect(existsSync(join(dir, 'out'))).toBe(false);
  });

  it('refuses a column below its size floor with the pixels it needs', () => {
    const dir = tdir();
    const small = { ...SPEC, options: { ...SPEC.options, size: { width: 240, height: 140 } } };
    const doc = writeDoc(dir, 'small.json', small);
    const result = runCli(['render', doc, '--out', join(dir, 'out')]);
    expect(result.code).toBe(1);
    expect(envelope(result).errors[0]).toMatchObject({ code: 'size-below-floor', path: '/options/size' });
    expect(existsSync(join(dir, 'out'))).toBe(false);
    const measured = JSON.parse(runCli(['measure', doc]).log[0]!);
    // Below the full floor the column falls back to compact, so measure names the size compact draws at.
    expect(measured.refused).toMatchObject({ code: 'size-below-floor', required: { width: 280, height: 240 } });
  });

  it('refuses in measure what render refuses for a reason other than size', () => {
    // Fixed overlapping nodes cannot be repaired by a canvas recommendation.
    const wide = {
      type: 'diagram', options: { variant: 'hierarchy', title: 'Fixed overlap', source: 'Invented data' },
      data: { nodes: ['A', 'B'].map(id => ({ id, kind: 'entity', shape: { kind: 'roundedRect' }, label: id, position: { x: 0.5, y: 0.5 } })) },
    };
    const doc = writeDoc(tdir(), 'wide.json', wide);
    const rendered = envelope(runCli(['render', doc]));
    expect(rendered.ok).toBe(false);
    const measured = envelope(runCli(['measure', doc]));
    expect(measured.ok).toBe(false);
    expect(measured.errors.map((error) => error.code)).toEqual(rendered.errors.map((error) => error.code));
  });

  // A host sizes its frame from measure's size. A circle treemap is bound by its width, so a pinned
  // frame taller than the circle and its labels used to be reported whole and left empty bands on a phone.
  it('measures the height a pinned circle treemap draws, and the whole frame of a chart that grows with it', () => {
    const items = [['Alpha', 'north', 520], ['Beta', 'north', 210], ['Gamma', 'south', 340], ['Delta', 'south', 90], ['Epsilon', 'south', 40]] as const;
    const circle = {
      type: 'treemap', options: { variant: 'circle', title: 'Alpha and Gamma lead the invented total', source: 'Invented data', size: { width: 960, height: 760 } },
      data: { groups: [{ id: 'north', label: 'North' }, { id: 'south', label: 'South' }], items: items.map(([label, group, value]) => ({ id: label.toLowerCase(), label, group, value })) },
    };
    const phone = measure({ spec: circle, width: '358' }).body as unknown as { size: { height: number } };
    expect(phone.size.height).toBeLessThan(560);
    // At the measured height the chart draws the same cells and the same words as in the pinned frame.
    const drawn = (height: number) => {
      const svg = (render({ spec: circle, width: '358', height: String(height), return: ['svg'] }).body as unknown as { svg: string }).svg;
      return { cells: svg.match(/data-part="treemapCell"/g)!.length, words: [...svg.matchAll(/>([^<>]+)</g)].map(word => word[1]) };
    };
    expect(drawn(phone.size.height)).toEqual(drawn(760));
    const columns = { type: 'column', options: { title: 'Invented sales', source: 'Invented data', size: { width: 960, height: 760 } }, data: {
      categories: ['A', 'B', 'C'], series: [{ id: 's', label: 'Sales', values: [3, 5, 4] }] } };
    expect((measure({ spec: columns, width: '700' }).body as unknown as { size: { height: number } }).size.height).toBe(760);
  });

  it('gives every chart its own file when names sanitize onto each other', () => {
    const dir = tdir();
    const names = ['a/', 'a?', 'a_-2', 'A_'];
    const doc = { version: 1, charts: names.map((name, index) => ({ ...DOC.charts[0], name, options: { title: `Chart ${index}` } })) };
    const out = join(dir, 'out');
    const result = JSON.parse(runCli(['render', writeDoc(dir, 'names.json', doc), '--out', out]).log[0]!);
    expect(result.outputs.map((path: string) => path.slice(out.length + 1))).toEqual(['a_.svg', 'a_-2.svg', 'a_-2-2.svg', 'A_-3.svg']);
    expect(readdirSync(out).sort()).toEqual(['A_-3.svg', 'a_-2-2.svg', 'a_-2.svg', 'a_.svg']);
    names.forEach((_, index) => expect(readFileSync(result.outputs[index], 'utf8')).toContain(`Chart ${index}`));
  });

  it('renders a bare spec to chart.svg and returns the markup on request', () => {
    const dir = tdir();
    const doc = writeDoc(dir, 'bare.json', SPEC);
    const out = join(dir, 'out');
    const result = JSON.parse(runCli(['render', doc, '--out', out, '--return', 'svg,reading']).log[0]!);
    expect(result.outputs).toEqual([join(out, 'chart.svg')]);
    expect(readFileSync(join(out, 'chart.svg'), 'utf8')).toBe(result.svg);
    expect(result.reading.title).toBe('Revenue rose in Q2');
    expect(envelope(runCli(['render', doc, '--return', 'png'])).errors[0]!.path).toBe('/return');
  });

  it('writes --out x.svg as that file for one chart, keeps a folder a folder and refuses a file for several charts', () => {
    const dir = tdir();
    const bare = writeDoc(dir, 'bare.json', SPEC);
    const file = join(dir, 'after', 'chart-x.SVG');
    expect(envelope(runCli(['render', bare, '--out', file])).outputs).toEqual([file]);
    expect(readFileSync(file, 'utf8')).toMatch(/^<svg/);

    const folder = join(dir, 'charts.svg');
    mkdirSync(folder);
    expect(envelope(runCli(['render', bare, '--out', `${folder}/`])).outputs).toEqual([join(folder, 'chart.svg')]);
    expect(envelope(runCli(['render', bare, '--out', join(dir, 'new.svg') + '/'])).outputs).toEqual([join(dir, 'new.svg', 'chart.svg')]);

    const two = writeDoc(dir, 'two.json', { version: 1, charts: [{ name: 'a', ...SPEC }, { name: 'b', ...SPEC }] });
    const many = join(dir, 'many.png');
    const refused = envelope(runCli(['render', two, '--out', many]));
    expect(refused.errors[0]!.message).toContain('--out names a folder');
    expect(existsSync(many)).toBe(false);
    expect(envelope(runCli(['render', bare, '--format', 'svg', '--out', many])).errors[0]!.message).toBe('--out many.png ends in .png, but the format is svg');
  });

  it('refuses an --out that cannot be a folder with out-unwritable and exit 1', () => {
    const dir = tdir();
    const bare = writeDoc(dir, 'bare.json', SPEC);
    const notes = join(dir, 'notes');
    writeFileSync(notes, '');
    const locked = join(dir, 'locked');
    mkdirSync(locked);
    chmodSync(locked, 0o555);
    // No search permission: even a stat of a path below it fails.
    const sealed = join(dir, 'sealed');
    mkdirSync(sealed);
    chmodSync(sealed, 0o000);
    try {
      const outs = [notes, join(notes, 'sub'), join(notes, 'x.svg'), ...(process.getuid?.() === 0 ? [] : [locked, join(locked, 'sub'), join(sealed, 'sub'), join(sealed, 'x.svg')])];
      for (const out of outs) {
        const result = runCli(['render', bare, '--out', out]);
        expect(result.code, out).toBe(1);
        expect(envelope(result).errors[0], out).toMatchObject({ code: 'out-unwritable', path: '/outDir' });
      }
    } finally {
      chmodSync(locked, 0o755);
      chmodSync(sealed, 0o755);
    }
  });

  it('prints only ok and outputs with --quiet, and keeps the errors of a refusal', () => {
    const dir = tdir();
    const out = join(dir, 'out');
    const result = runCli(['render', writeDoc(dir, 'bare.json', SPEC), '--out', out, '--quiet']);
    expect(result.code).toBe(0);
    expect(result.log).toEqual([JSON.stringify({ ok: true, outputs: [join(out, 'chart.svg')] })]);
    const refused = runCli(['render', writeDoc(dir, 'bad.json', { ...SPEC, type: 'colum' }), '--quiet']);
    expect(refused.code).toBe(1);
    expect(envelope(refused).errors[0]!.code).toBe('unknown-type');
    // --quiet --return svg printed {"ok":true} and dropped the SVG it was asked for.
    const returned = runCli(['render', writeDoc(dir, 'bare.json', SPEC), '--quiet', '--return', 'svg']);
    expect(Object.keys(JSON.parse(returned.log[0]!))).toEqual(['ok', 'svg']);
    // A document answers per chart, so the parts --return names stay under charts.
    const doc = runCli(['render', writeDoc(dir, 'doc.json', { version: 1, charts: [{ name: 'one', ...SPEC }] }), '--quiet', '--return', 'svg,reading']);
    expect(Object.keys(JSON.parse(doc.log[0]!).charts[0])).toEqual(['name', 'svg', 'reading']);
  });

  it.skipIf(!availableRasterizer())('draws a PNG for --out x.png without --format', () => {
    const dir = tdir();
    const file = join(dir, 'chart-x.png');
    expect(envelope(runCli(['render', writeDoc(dir, 'bare.json', SPEC), '--out', file])).outputs).toEqual([file]);
    expect(readFileSync(file).subarray(1, 4).toString()).toBe('PNG');
  }, 60_000);

  it('draws the canvas for background theme, leaves it out for transparent and refuses other values', () => {
    const doc = writeDoc(tdir(), 'bare.json', SPEC);
    const svgFor = (background: string): string =>
      JSON.parse(runCli(['render', doc, '--width', '640', '--height', '400', '--background', background, '--return', 'svg']).log[0]!).svg;
    const canvas = /<rect x="0" y="0" width="640" height="400" fill="[^"]+"\/>/;
    expect(svgFor('theme')).toMatch(canvas);
    expect(svgFor('transparent')).not.toMatch(canvas);
    const refused = runCli(['render', doc, '--background', 'white']);
    expect(refused.code).toBe(1);
    expect(envelope(refused).errors[0]!.path).toBe('/background');
  });

  it('keeps the row adapter refusals when rows come from a file: a repeated pair names its row', () => {
    const dir = tdir();
    writeFileSync(join(dir, 'rows.csv'), 'month,segment,revenue\nJan,B2B,10\nJan,B2B,12\n');
    const result = runCli(['render', writeDoc(dir, 'spec.json', { type: 'column' }), '--rows', join(dir, 'rows.csv'), '--columns', 'category=month,series=segment,value=revenue']);
    expect(envelope(result).errors).toMatchObject([{ code: 'ambiguous-mapping', path: '/rowsFile', message: expect.stringContaining('rows[1].segment') }]);
  });

  it('reads a semicolon CSV, detected from its header, with decimal commas as decimals', () => {
    const dir = tdir();
    writeFileSync(join(dir, 'rows.csv'), 'Month;Segment;Revenue\nJan;"B2B, direct";10,5\nFeb;"B2B, direct";12,25\n');
    const result = runCli(['render', writeDoc(dir, 'spec.json', { type: 'column' }), '--rows', join(dir, 'rows.csv'), '--columns', 'category=Month,series=Segment,value=Revenue', '--return', 'svg']);
    expect((envelope(result) as { svg?: string }).svg?.match(/>(10\.50|12\.25)</g)?.sort()).toEqual([">10.50<", ">12.25<"]);
  });

  it('refuses 1.234 in a semicolon CSV, which is 1234 or 1.234, instead of reading it as 1.234', () => {
    const dir = tdir();
    writeFileSync(join(dir, 'rows.csv'), 'Month;Segment;Revenue\nJan;A;980\nFeb;A;1.234\n');
    const result = runCli(['render', writeDoc(dir, 'spec.json', { type: 'column' }), '--rows', join(dir, 'rows.csv'), '--columns', 'category=Month,series=Segment,value=Revenue']);
    expect(envelope(result).errors).toMatchObject([{ code: 'invalid-value', path: '/rowsFile', message: expect.stringContaining('rows[1].Revenue') }]);
  });

  const rowsRender = (csv: string | Buffer, valueKind = 'number') => {
    const dir = tdir();
    writeFileSync(join(dir, 'rows.csv'), csv);
    const spec = writeDoc(dir, 'spec.json', { type: 'column' });
    return envelope(runCli(['render', spec, '--rows', join(dir, 'rows.csv'), '--columns', `category=month,series=segment,value=revenue,valueKind=${valueKind}`, '--return', 'svg'])) as ReturnType<typeof envelope> & { svg?: string };
  };
  const rowsError = (csv: string, valueKind?: string) => rowsRender(csv, valueKind).errors[0] as { suggest?: string } | undefined;

  it('refuses a value column the rows lack as missing instead of drawing an empty chart', () => {
    expect(rowsError('month,segment,Revenue\nJan,A,10\nFeb,A,12\n')).toMatchObject({ code: 'missing-column', path: '/columns/value' });
  });

  it('refuses a rows file with only its header as empty, not as three missing columns', () => {
    expect(rowsError('month,segment,revenue\n')).toMatchObject({ code: 'rows-empty', path: '/rowsFile' });
  });

  // A repeated header kept only its last column, so the chart drew the wrong numbers without a word.
  it('keeps both columns of a repeated CSV header and warns', () => {
    const first = rowsRender('month,segment,revenue,revenue\nJan,A,10,99\n');
    expect(first.warnings).toContainEqual(expect.objectContaining({ code: 'rows-header-repeated', path: '/rowsFile', message: expect.stringContaining("'revenue.1'") }));
    expect(first.svg).toContain('>10<');
    expect(first.svg).not.toContain('>99<');
  });

  // A Windows-1252 export decoded as UTF-8 printed U+FFFD in the labels with no warning.
  it('warns when a rows file is not UTF-8, and stays quiet for a real U+FFFD', () => {
    const latin1 = rowsRender(Buffer.from('month,segment,revenue\nM\xfcnchen,A,10\n', 'latin1'));
    expect(latin1.warnings).toContainEqual(expect.objectContaining({ code: 'rows-encoding-replaced', path: '/rowsFile', message: expect.stringContaining('offset 23') }));
    expect(rowsRender('month,segment,revenue\nM\uFFFDnchen,A,10\n').warnings.map((w) => (w as { code: string }).code)).not.toContain('rows-encoding-replaced');
    // A real U+FFFD (3 bytes) before the bad byte must not shift the reported offset (22 header bytes, then 10 for the first row, then 'M').
    const mixed = rowsRender(Buffer.concat([Buffer.from('month,segment,revenue\n'), Buffer.from('\uFFFDx,A,10\nM'), Buffer.from([0xfc]), Buffer.from('nchen,A,10\n')]));
    expect(mixed.warnings).toContainEqual(expect.objectContaining({ code: 'rows-encoding-replaced', message: expect.stringContaining('byte 0xfc at offset 33') }));
  });

  it('quotes a formatted number in a CSV and asks for a plain number', () => {
    expect(rowsError('month,segment,revenue\nJan,A,"1,234.5"\n')).toMatchObject({
      code: 'invalid-value', message: expect.stringContaining('"1,234.5" is a number written as text'), received: { type: 'string', value: '1,234.5' },
    });
  });

  it('fits the advice for a share with a percent sign to valueKind and the decimal mark, and the advised cell draws the share', () => {
    expect(rowsError('month,segment,revenue\nJan,A,12%\n', 'fraction')?.suggest).toContain('12% is written 0.12');
    expect(rowsRender('month,segment,revenue\nJan,A,0.12\n', 'fraction').svg).toContain('>12%<');
    expect(rowsError('month;segment;revenue\nJan;A;12,5%\n', 'percent')?.suggest).toContain('with a decimal comma');
    expect(rowsRender('month;segment;revenue\nJan;A;12,5\n', 'percent').svg).toContain('>12.5%<');
  });

  it('skips a byte order mark in a JSON spec file and a JSON rows file', () => {
    const dir = tdir();
    const bom = (name: string, value: unknown) => {
      writeFileSync(join(dir, name), `﻿${JSON.stringify(value)}`);
      return join(dir, name);
    };
    expect(envelope(runCli(['render', bom('spec.json', SPEC)])).ok).toBe(true);
    const rows = bom('rows.json', [{ month: 'Jan', segment: 'A', revenue: 10 }]);
    expect(envelope(runCli(['render', bom('bare.json', { type: 'column' }), '--rows', rows, '--columns', 'category=month,series=segment,value=revenue'])).ok).toBe(true);
  });

  it('refuses a spec file that holds a JSON string', () => {
    const doc = writeDoc(tdir(), 'string.json', JSON.stringify(SPEC));
    const result = runCli(['render', doc]);
    expect(result.code).toBe(1);
    expect(envelope(result).errors[0]).toMatchObject({
      code: 'spec-must-be-object', message: 'pass the spec as a JSON object, not a string',
    });
  });
});


// A symlink planted at the output name must not let overwrite replace the file it points to.
it('overwrite refuses to write through a symlink planted at the output name', () => {
  const dir = tdir();
  const out = join(dir, 'out');
  mkdirSync(out);
  writeFileSync(join(dir, 'target.txt'), 'keep me');
  symlinkSync(join(dir, 'target.txt'), join(out, 'chart.svg'));
  const result = callTool('boardplot_render', { ...overwriteExample, spec: { ...overwriteExample.spec, name: 'chart' }, outDir: out, overwrite: true });
  expect(result.structuredContent).toMatchObject({ ok: false, errors: [{ code: 'out-is-symlink', path: '/outDir' }] });
  expect(readFileSync(join(dir, 'target.txt'), 'utf8')).toBe('keep me');
});

// The last stderr line must name the new file, so callers do not read the file that was kept.
it('CLI and MCP overwrite only when requested and keep same-call chart names separate', async () => {
  const dir = tdir();
  const specFile = join(dir, 'spec.json');
  writeFileSync(specFile, JSON.stringify(overwriteExample.spec));
  const file = join(dir, 'sample.svg');
  writeFileSync(file, 'old chart');
  const keptRun = runCli(['render', specFile, '--out', file]);
  const kept = envelope(keptRun);
  expect(keptRun.error.at(-1)).toBe(`Wrote ${join(dir, 'sample-2.svg')}; use --overwrite to replace the existing file.`);
  expect(kept.outputs).toEqual([join(dir, 'sample-2.svg')]);
  expect(readFileSync(file, 'utf8')).toBe('old chart');
  const replacedRun = runCli(['render', specFile, '--out', file, '--overwrite']);
  const replaced = envelope(replacedRun);
  expect(replacedRun.error.at(-1)).toBe(`Wrote ${file}`);
  expect(replaced.ok).toBe(true);
  expect(replaced.outputs).toEqual([file]);
  expect(readFileSync(file, 'utf8')).toContain('<svg');
  expect(replaced.warnings).not.toEqual(expect.arrayContaining([expect.objectContaining({ code: 'out-name-taken' })]));
  writeFileSync(file, 'old chart');
  const mcp = await callTool('boardplot_render', { ...overwriteExample, outDir: file });
  expect(mcp.structuredContent).toMatchObject({ ok: true, outputs: [file] });
  expect(readFileSync(file, 'utf8')).toContain('<svg');
  const document = { version: 1, charts: [{ ...overwriteExample.spec, name: 'overwrite_example' }, { ...overwriteExample.spec, name: 'overwrite example', data: { categories: ['a'], series: [{ id: 's', values: [9] }] } }] };
  const siblings = render({ spec: document, outDir: dir, overwrite: true }).body as { outputs: string[] };
  expect(siblings.outputs).toEqual([join(dir, 'overwrite_example.svg'), join(dir, 'overwrite_example-2.svg')]);
  expect(readFileSync(siblings.outputs[0]!, 'utf8')).not.toBe(readFileSync(siblings.outputs[1]!, 'utf8'));
  const batchFile = join(dir, 'batch.json');
  writeFileSync(batchFile, JSON.stringify(document));
  const batchRun = runCli(['render', batchFile, '--out', join(dir, 'batch'), '--quiet']);
  const batch = envelope(batchRun);
  expect(batchRun.error.at(-1)).toContain(batch.outputs!.join(', '));
  const quietRun = runCli(['render', specFile, '--out', file, '--quiet']);
  expect(quietRun.error.at(-1)).toBe(`Wrote ${join(dir, 'sample-3.svg')}; use --overwrite to replace the existing file.`);
});

// Different input units have different document IDs even when the drawing is equal.
const withoutDescScope = (svg: unknown) => String(svg).replace(/bp-desc-[a-f0-9]{10}/g, 'bp-desc');

// Prevents fraction values with percent claims or authored labels from silently disagreeing with their axis.
it('warns for undeclared fraction-sized percent series and keeps declared fractions on one scale', () => {
  const draw = (values: unknown[], dataFields = {}, format?: string) => render({ spec: {
    type: 'line', data: { ...dataFields, categories: ['a', 'b', 'c'], series: [{ id: 'rate', values }] },
    options: { format, valueAxis: { show: true }, valueLabels: 'all', size: { width: 700, height: 400 } },
  }, return: ['svg'] }).body;
  const suspect = (result: Record<string, unknown>) => (result.warnings as { code: string }[]).filter(w => w.code === 'percent-scale-suspect');
  expect(suspect(draw([0.27, 0.33, 0.37], {}, '12%'))).toHaveLength(1);
  expect(suspect(draw([{ pct: 0.27 }, { pct: 0.33 }, { pct: 0.37 }]))).toHaveLength(1);
  expect(suspect(draw([0.27, 0.33, 0.37].map(number => ({ number, label: `${number * 100}%` })), {}, '12%'))).toHaveLength(1);
  expect(suspect(draw([0.27, 0.33, 0.37]))).toHaveLength(0);
  for (const values of [[0.2, 0.3], [{ number: 0.2, label: '20%' }, { number: 0.3, label: '30%' }]]) {
    const sparkline = (fraction: boolean) => render({ spec: { type: 'sparkline', data: { values, ...(fraction ? { valueKind: 'fraction' } : {}) }, options: { format: '0%' } } }).body;
    expect(sparkline(false).ok).toBe(true);
    expect(suspect(sparkline(false))).toHaveLength(1);
    expect(suspect(sparkline(true))).toHaveLength(0);
  }
  const data = { categories: ['a', 'b'], series: [{ id: 'rate', values: [0.2, 0.8] }] };
  for (const [type, options] of [['column', { variant: 'stacked100' }], ['bar', { variant: 'stacked100' }], ['line', { variant: 'stacked100-area' }], ['mekko', {}], ['pie', {}], ['waffle', {}]] as const) {
    const composed = render({ spec: { type, data, options: { ...options, format: '0%' } } }).body;
    expect(composed.ok).toBe(true);
    expect(suspect(composed)).toHaveLength(0);
  }
  const linePanel = { id: 'rates', type: 'line', data, options: { format: '0%' } };
  for (const gridData of [
    { panels: [linePanel] },
    { repeat: { dimension: 'group', values: ['one'] }, template: { type: 'line', data: { bySlice: { one: data } }, options: { format: '0%' } } },
    { panels: [{ id: 'nested', type: 'grid', data: { panels: [linePanel] } }] },
  ]) {
    const grid = render({ spec: { type: 'grid', data: gridData } }).body;
    expect(grid.ok, JSON.stringify(grid.errors)).toBe(true);
    expect(suspect(grid)).toHaveLength(1);
  }
  for (const values of [[0.27, 0.33, 0.37], [0.0027, 0.0033, 0.0037]]) {
    const result = draw(values, { valueKind: 'fraction' }, '0.00%');
    expect(result.ok).toBe(true);
    expect(suspect(result)).toHaveLength(0);
    expect(withoutDescScope(result.svg)).toBe(withoutDescScope(draw(values.map(pct => ({ pct: pct * 100 })), {}, '0.00%').svg));
  }
});

// Grid children must use alias defaults in percent warnings just as standalone charts do.
it('keeps alias defaults in percent warnings through explicit, repeated and nested grids', () => {
  const data = { categories: ['a', 'b'], series: [{ id: 'rate', values: [0.2, 0.8] }] };
  const child = { id: 'rates', type: 'bar-mekko', data, options: { format: '0%' } };
  const standalone = render({ spec: { type: child.type, data, options: child.options } }).body;
  const warnings = (result: Record<string, unknown>) => (result.warnings as { code: string; message: string }[]).filter(w => w.code === 'percent-scale-suspect');
  expect(standalone.ok).toBe(true);
  expect(warnings(standalone)).toHaveLength(1);
  for (const gridData of [
    { panels: [child] },
    { repeat: { dimension: 'group', values: ['one'] }, template: { type: child.type, data: { bySlice: { one: data } }, options: child.options } },
    { panels: [{ id: 'nested', type: 'grid', data: { panels: [child] } }] },
  ]) {
    const result = render({ spec: { type: 'grid', data: gridData } }).body;
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(warnings(result)).toHaveLength(1);
    expect(warnings(result)[0]!.message).toContain(warnings(standalone)[0]!.message);
  }
  const explicitComposition = render({ spec: { type: 'grid', data: { panels: [{ ...child, options: { ...child.options, variant: 'stacked100' } }] } } }).body;
  expect(explicitComposition.ok).toBe(true);
  expect(warnings(explicitComposition)).toHaveLength(0);
});

// Prevents a fraction reference line and its tolerance from being plotted 100 times below the series.
it('scales numeric fraction value lines before domains and annotation placement', () => {
  for (const type of ['dot', 'line', 'column']) {
    const spec = { type, data: { valueKind: 'fraction', categories: ['a', 'b'], series: [{ id: 'rate', values: [0.27, 0.43] }] },
      options: { format: '0%', size: { width: 700, height: 400 } } };
    const draw = (annotation: object) => render({ spec: { ...spec, annotations: [annotation] }, return: ['svg'] }).body;
    const fraction = { kind: 'valueLine', id: 'target', value: 0.35, valueKind: 'fraction', label: 'Target' };
    const points = { kind: 'valueLine', id: 'target', value: 35, label: 'Target' };
    expect(draw(fraction).ok).toBe(true);
    expect(withoutDescScope(draw(fraction).svg)).toBe(withoutDescScope(draw(points).svg));
    if (type !== 'dot') {
      for (const [fractionTolerance, pointsTolerance] of [[0.02, 2], [{ low: 0.32, high: 0.38 }, { low: 32, high: 38 }]]) {
        expect(withoutDescScope(draw({ ...fraction, tolerance: fractionTolerance }).svg)).toBe(withoutDescScope(draw({ ...points, tolerance: pointsTolerance }).svg));
      }
    }
    expect(draw({ ...fraction, value: 'mean' }).errors).toContainEqual(expect.objectContaining({ code: 'invalid-annotation', path: '/annotations/0/valueKind' }));
  }
});

// Prevents an invalid chart from being refused for unused theme tokens instead of the invalid input.
it('reports the input cause and judges only semantic paints that draw', () => {
  const theme = { preset: 'standard', overrides: { color: { warn: '#BB2200', bad: '#BB2200' } } };
  const draw = (series: object[], annotations: object[] = []) => render({ spec: {
    type: 'line', data: { categories: ['a', 'b'], series }, options: { theme }, annotations,
  }, return: ['svg'] }).body;
  for (const series of [[{ id: 'neutral', colorRole: 'highlight', values: [2, 3] }], [{ id: 'neutral', fill: '#123456', values: [2, 3] }]]) {
    expect(draw(series).ok).toBe(true);
    const refused = draw(series, [{ kind: 'valueLine', value: 2, invalidField: true }]);
    expect(refused.errors).toContainEqual(expect.objectContaining({ code: 'invalid-annotation', path: '/annotations/0/invalidField' }));
    expect(refused.errors).not.toContainEqual(expect.objectContaining({ code: 'warn-bad-similar' }));
  }
  const used = draw([{ id: 'risk-series', colorRole: 'warn', values: [2, 3] }, { id: 'loss-series', colorRole: 'bad', values: [4, 5] }]);
  expect(used.errors).toContainEqual(expect.objectContaining({ code: 'warn-bad-similar', message: expect.stringMatching(/risk-series.*loss-series/) }));
});

// Prevents a categorical palette override from being silently ignored by a stacked column.
it('discloses the stack palette without changing its paint', () => {
  const draw = (variant: string, color: object, extra = {}) => render({ spec: { type: 'column',
    data: { categories: ['a', 'b'], series: [{ id: 's', values: [12, 17] }, { id: 't', values: [9, 8] }] },
    options: { variant, ...extra, theme: { preset: 'standard', overrides: { color } } },
  }, return: ['svg'] }).body;
  const series = ['#111111', '#444444', '#777777'];
  for (const variant of ['stacked', 'stacked100']) {
    const result = draw(variant, { series });
    expect(result.ok).toBe(true);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'stack-palette-used', suggest: expect.stringContaining('color.stack') }));
    expect(withoutDescScope(result.svg)).toBe(withoutDescScope(draw(variant, {}).svg));
    const explicit = draw(variant, { series, stack: series });
    expect(explicit.ok).toBe(true);
    expect(explicit.warnings).not.toContainEqual(expect.objectContaining({ code: 'stack-palette-used' }));
    expect(explicit.svg).not.toBe(result.svg);
    expect(withoutDescScope(explicit.svg)).toBe(withoutDescScope(draw(variant, { stack: series }).svg));
  }
  expect(draw('grouped', { series }).warnings).not.toContainEqual(expect.objectContaining({ code: 'stack-palette-used' }));
  const panel = { id: 'parts', type: 'column', data: { categories: ['a', 'b'], series: [{ id: 's', values: [12, 17] }, { id: 't', values: [9, 8] }] }, options: { variant: 'stacked100' } };
  const theme = { preset: 'standard', overrides: { color: { series } } };
  for (const [data, options] of [
    [{ panels: [{ ...panel, options: { ...panel.options, theme } }] }, {}],
    [{ panels: [panel] }, { theme }],
    [{ panels: [{ id: 'nested', type: 'grid', data: { panels: [panel] } }] }, { theme }],
  ]) {
    const grid = render({ spec: { type: 'grid', data, options } }).body;
    expect(grid.ok, JSON.stringify(grid.errors)).toBe(true);
    expect(grid.warnings).toContainEqual(expect.objectContaining({ code: 'stack-palette-used', message: expect.stringContaining('[parts]') }));
  }
});
