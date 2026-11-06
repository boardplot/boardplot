import { expect, it } from 'vitest';
import '../src/core/charts';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { resolveTable } from '../src/core/charts/table/resolve';
import { prepareTableWidthRung, solveTableWidthRung, materializeTableWidthPlan, tableWidths } from '../src/core/charts/table/widths';
import { resolveTheme } from '../src/core/theme';
import { defaultMeasurer, type TextMeasurer } from '../src/core/text';
import type { TableData, TableOptions } from '../src/core/types/table';

const data: TableData = {
  columns: [
    { id: 'label', kind: 'rowLabel', label: 'Metric', width: 170.25 },
    { id: 'actual', kind: 'value', label: 'Current period', width: 120.5, format: '0' },
    { id: 'detail', kind: 'text', label: 'Detail', wrap: true },
  ],
  rows: [
    { id: 'r', label: 'Revenue', cells: { actual: 98765, detail: 'Signed in the second quarter and closing next year' } },
    { id: 's', label: 'Costs', cells: { actual: 23456, detail: 'Early next year' } },
  ],
};
const options: TableOptions = { cellPadX: 3, frameFill: 'none', size: { width: 360, height: 400 } };

// Settlement changes the frame, never a measured track. A caller-owned result cannot poison the next solve.
it('isolates numeric scratch tracks and preserves the ordered public Maps and current height advice', () => {
  const table = resolveTable(data, options).table;
  const theme = resolveTheme('bridge');
  const rung = prepareTableWidthRung(table, theme, defaultMeasurer, options, {});
  const updated = { ...options, size: { width: 360, height: 517 } };
  const first = solveTableWidthRung(rung, 210.25, updated);
  expect(first.widthMiss).not.toBe(true);
  if (first.widthMiss) throw new Error('Unexpected probe result');
  const expected = tableWidths(table, theme, defaultMeasurer, updated, { available: 210.25 });
  const publicPlan = materializeTableWidthPlan(first);
  expect([...publicPlan.widths]).toEqual([...expected.widths]);
  expect([...publicPlan.minimumWidths]).toEqual([...expected.minimumWidths]);
  expect([...publicPlan.sizingMinimums]).toEqual([...expected.sizingMinimums]);
  expect(publicPlan.warnings).toEqual(expected.warnings);
  expect(publicPlan.warnings.find(warning => warning.code === 'table-overflow')?.fix?.[0]).toMatchObject({ value: { height: 517 } });
  first.widths[0] = -1;
  publicPlan.minimumWidths.set('label', -1);
  const next = solveTableWidthRung(rung, 210.25, updated);
  if (next.widthMiss) throw new Error('Unexpected probe result');
  expect([...materializeTableWidthPlan(next).widths]).toEqual([...expected.widths]);
  expect(next.minimumWidths[0]).toBe(expected.minimumWidths.get('label'));
});

// Padding and table paints do not change cell text. A new measurer or actual typography must still measure it.
it('reuses body measurements across padding and paint while honoring a custom measurer and changed type', () => {
  const table = resolveTable(data, options).table;
  const theme = resolveTheme('bridge');
  const counts = new Map<string, number>();
  const measure: TextMeasurer = (text, font) => {
    counts.set(text, (counts.get(text) ?? 0) + 1);
    return defaultMeasurer(text, font);
  };
  measure.capHeight = font => font.size * 0.71;
  const first = prepareTableWidthRung(table, theme, measure, options, {});
  const count = counts.get('98765');
  expect(count).toBeGreaterThan(0);
  prepareTableWidthRung(table, theme, measure, { ...options, cellPadX: 5 }, {});
  expect(counts.get('98765')).toBe(count);
  const painted = { ...theme, table: { ...theme.table, inks: { figure: '#123456' }, ruleInk: '#654321', grounds: { total: '#abcdef' } } };
  const paintedRung = prepareTableWidthRung(table, painted, measure, options, {});
  expect(counts.get('98765')).toBe(count);
  expect(paintedRung.measured).toBe(first.measured);
  const plan = solveTableWidthRung(paintedRung, 600);
  if (plan.widthMiss) throw new Error('Unexpected probe result');
  expect(plan.context.measure).toBe(measure);
  expect(plan.context.measure.capHeight?.(plan.fonts.body)).toBe(plan.fonts.body.size * 0.71);
  expect(plan.context.theme).toBe(painted);
  prepareTableWidthRung(table, { ...theme, type: { ...theme.type, label: { ...theme.type.label, size: theme.type.label.size + 2 } } }, measure, options, {});
  expect(counts.get('98765')).toBeGreaterThan(count!);
  let otherCalls = 0;
  const other: TextMeasurer = (text, font) => { otherCalls++; return defaultMeasurer(text, font); };
  prepareTableWidthRung(table, theme, other, options, {});
  expect(otherCalls).toBeGreaterThan(0);
});

// A huge fractional authored width must shrink in batched rounds, or the layout never finishes.
it('finishes with huge fractional authored widths', () => {
  const ids = Array.from({ length: 24 }, (_, index) => `v${index}`);
  const data = {
    columns: [{ id: 'name', kind: 'rowLabel', label: 'Name' }, ...ids.map((id) => ({ id, kind: 'value', label: id, width: 1_000_000_000.5 }))],
    rows: [{ id: 'r', label: 'R', cells: Object.fromEntries(ids.map((id, index) => [id, index * 1000])) }],
  };
  const result = layoutResolvedRequest(resolveChartRequest({ type: 'table', data, options: { size: { width: 960 } } } as never));
  expect(result.size.width).toBe(960);
}, 30_000);
