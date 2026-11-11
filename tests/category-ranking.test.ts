import { expect, it } from 'vitest';
import '../src/core/charts';
import { render } from '../src/cli/render';
import { interactionRecords } from '../src/core/a11y/records';
import { layoutBullet } from '../src/core/charts/bullet/layout';
import { layoutButterfly } from '../src/core/charts/butterfly/layout';
import { butterflyOptionsSchema } from '../src/core/charts/butterfly/schema';
import { layoutDot } from '../src/core/charts/dot/layout';
import { heatmapOptionsSchema } from '../src/core/charts/heatmap/schema';
import { layoutLikert } from '../src/core/charts/likert/layout';
import { likertOptionsSchema } from '../src/core/charts/likert/schema';
import { lineOptionsSchema } from '../src/core/charts/line/schema';
import { resolveTable } from '../src/core/charts/table/resolve';
import { layoutVariance } from '../src/core/charts/variance/layout';
import { checkItemBudget, ITEM_BUDGET } from '../src/core/itemBudget';
import { chartNotes } from '../src/core/notes';
import type { ChartReading } from '../src/core/reading';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { flattenIssues } from '../src/core/schema/flattenIssues';
import { requireGeometry } from '../src/core/sizing';
import type { ChartData } from '../src/core/types/data';
import type { Annotation } from '../src/core/types/annotations';
import type { Geometry, LintWarning } from '../src/core/types/scene';

const categories = ['Amber', 'Birch', 'Cedar', 'Elm'].map((label) => ({ id: label.toLowerCase(), label }));
const size = { width: 1200, height: 600 };
const variance = { vs: 'plan' };
const pointText = (g: Pick<Geometry, 'labels'>, id: string) => g.labels.find((label) => label.id === `point:${id}` && !label.hidden)?.text;
const varianceData: ChartData = { categories, series: [
  { id: 'actual', values: [0.1, 12, 3, null] },
  { id: 'extra', values: [0.2, 0, 0, 1] },
  { id: 'plan', role: 'reference', values: [0.1, 10, 1, 1] },
] };

// Sorting must move every operand with its category so the exact drawn differences stay attached to their names.
it('sorts absolute, integrated and relative variance by the signed drawn difference', () => {
  const absolute = layoutVariance(varianceData, { variance, variant: 'absolute', size, sort: { categories: 'desc' } });
  expect(absolute.marks.bars.map((bar) => bar.categoryId)).toEqual(['birch', 'cedar', 'amber']);
  expect(absolute.derived.deltaAbs).toEqual({ birch: 2, cedar: 2, amber: 0.2, elm: null });
  expect(['birch', 'cedar', 'amber'].map((id) => pointText(absolute, id))).toEqual(['+2.0', '+2.0', '+0.2']);
  const integrated = layoutVariance(varianceData, { variance, variant: 'integrated', size, sort: { categories: 'desc' } });
  expect(integrated.marks.bars.map((bar) => bar.categoryId)).toEqual(['birch', 'cedar', 'amber']);
  expect(integrated.derived.ac).toEqual({ birch: 12, cedar: 3, amber: 0.3, elm: null });
  const relative = layoutVariance(varianceData, { variance, variant: 'relative', size, sort: { categories: 'desc' } });
  expect(relative.marks.pins.map((pin) => pin.categoryId)).toEqual(['amber', 'cedar', 'birch']);
  expect(relative.derived.deltaPct).toEqual({ amber: 200, cedar: 200, birch: 20, elm: null });
  expect(['amber', 'cedar', 'birch'].map((id) => pointText(relative, id))).toEqual(['+200%', '+200%', '+20%']);
  const ascending = layoutVariance(varianceData, { variance, variant: 'relative', size, sort: { categories: 'asc' } });
  expect(ascending.axes.find((axis) => axis.axis === 'x')!.ticks.map((tick) => tick.at)).toEqual(['birch', 'amber', 'cedar', 'elm']);
});

// Mixed-unit rows must rank by attainment, and their values, targets and accessible records must follow the same order.
it('sorts bullet rows by attainment without inverting lower-is-better values', () => {
  const data = { rows: [
    { id: 'orders', label: 'Orders', value: { number: 900, format: '1,234' }, target: 1000 },
    { id: 'margin', label: 'Margin', value: { pct: 24 }, target: { pct: 20 }, direction: 'lowerIsBetter' as const },
    { id: 'missing', label: 'Missing', value: null, target: 10 },
  ] };
  const options = { size, sharedScale: false, sort: { categories: 'desc' as const }, highlight: ['margin'] };
  const request = resolveChartRequest({ type: 'bullet', data, options });
  const g = requireGeometry(layoutResolvedRequest(request));
  const bullet = g as unknown as ReturnType<typeof layoutBullet>;
  expect(bullet.marks.rows.map((row) => row.id)).toEqual(['margin', 'orders', 'missing']);
  expect(pointText(g, 'margin')).toBe('24%');
  expect(g.labels.find((label) => label.id === 'target-value:margin')?.text).toBe('20%');
  expect(g.a11y.desc.indexOf('Margin')).toBeLessThan(g.a11y.desc.indexOf('Orders'));
  expect(interactionRecords({ request, geometry: g, scope: request.scope, claims: [] }).map((record) => record.target.owner.categoryId))
    .toEqual(['margin', 'orders', 'missing']);
  expect(layoutBullet(data, { ...options, density: 'compact' }).marks.rows.map((row) => row.id)).toEqual(['margin', 'orders', 'missing']);
  expect(layoutBullet(data, { ...options, sharedScale: 'percentOfTarget' }).marks.rows.map((row) => row.id)).toEqual(['margin', 'orders', 'missing']);
  const noTarget = { rows: data.rows.map((row) => ({ ...row, target: undefined })) };
  const raw = layoutBullet(noTarget, options);
  expect(raw.marks.rows.map((row) => row.id)).toEqual(['orders', 'margin', 'missing']);
  expect(raw.warnings).toContainEqual(expect.objectContaining({ code: 'bullet-sort-by-value', severity: 'info' }));
});

// Statement sorting must preserve the ordered response scale and must never describe ascending nets as descending.
it('orders likert statements by net score and refuses segment reordering', () => {
  const data = { scale: [{ id: 'd', label: 'Disagree' }, { id: 'n', label: 'Neutral', role: 'neutral' as const }, { id: 'a', label: 'Agree' }],
    items: [{ id: 'help', label: 'Helpful service', values: [20, 20, 60] }, { id: 'speed', label: 'Fast service', values: [40, 30, 30] },
      { id: 'care', label: 'Careful service', values: [10, 20, 70] }] };
  const options = { values: 'counts' as const, size, methodNote: true };
  const net = layoutLikert(data, { ...options, sortBy: 'net' });
  const desc = layoutLikert(data, { ...options, sort: { categories: 'desc' } });
  const asc = layoutLikert(data, { ...options, sortBy: 'net', sort: { categories: 'asc' } });
  expect(desc.derived.order).toEqual(net.derived.order);
  expect(asc.derived.order).toEqual([...net.derived.order].reverse());
  expect(chartNotes(desc).some((note) => note.text.includes('sorted by net score, descending'))).toBe(true);
  expect(chartNotes(asc).some((note) => note.text.includes('descending'))).toBe(false);
  const sheet = layoutLikert(data, { ...options, sortBy: 'net', sort: { categories: 'sheet' } });
  expect(sheet.derived.order).toEqual(['help', 'speed', 'care']);
  expect(sheet.warnings).toContainEqual(expect.objectContaining({ code: 'likert-sort-conflict', severity: 'warn', fix: [{ op: 'remove', path: '/options/sortBy' }] }));
  expect(layoutLikert(data, { ...options, sort: { categories: 'reverse' } }).derived.order).toEqual(['care', 'speed', 'help']);
  const segments = likertOptionsSchema.safeParse({ values: 'counts', sort: { segments: 'reverse' } });
  expect(segments.success).toBe(false);
  if (!segments.success) expect(flattenIssues(segments.error.issues)[0]!.message).toMatch(/ordered axis.*diverging baseline.*sort.categories/);
});

// An explicit category mode must control butterfly order while keeping the rest row last and disclosing unused settings.
it('uses the butterfly measure with the requested direction and warns on conflicting sortBy', () => {
  const data = { categories, series: [{ id: 'a', values: [10, 40, 20, null] }, { id: 'b', values: [20, 30, 15, null] }] };
  const options = { a: 'a', b: 'b', size };
  const ids = (g: ReturnType<typeof layoutButterfly>) => g.marks.left.map((row) => row.id);
  expect(ids(layoutButterfly(data, { ...options, sort: { categories: 'desc' } })))
    .toEqual(ids(layoutButterfly(data, { ...options, sortBy: 'sum' })));
  expect(ids(layoutButterfly(data, { ...options, sort: { categories: 'asc' } }))).toEqual(['amber', 'cedar', 'birch', 'elm']);
  const conflict = layoutButterfly(data, { ...options, sortBy: 'diff', sort: { categories: 'reverse', segments: 'desc' as never }, topN: { n: 2 } });
  expect(ids(conflict)).toEqual(['elm', 'amber', '__rest']);
  expect(conflict.warnings).toContainEqual(expect.objectContaining({ code: 'butterfly-sort-conflict', severity: 'warn', fix: [{ op: 'remove', path: '/options/sortBy' }] }));
  expect(conflict.warnings).toContainEqual(expect.objectContaining({ code: 'sort-segments-ignored', severity: 'info' }));
  expect(butterflyOptionsSchema.parse({ ...options, sort: 'desc' }).sort).toEqual({ categories: 'desc' });
});

// A period-spanning annotation must retain chronological rows even when the author requests a different order.
it('keeps dated butterfly, bullet and variance categories in authored order under period annotations', () => {
  const dated = categories.slice(0, 3).map((cat, i) => ({ ...cat, date: `${2023 + i}-12-31` }));
  const data = { categories: dated, series: [{ id: 'actual', values: [100, 120, 150] }, { id: 'plan', role: 'reference' as const, values: [80, 110, 130] }] };
  const annotation: Annotation = { kind: 'cagr', from: 'amber', to: 'cedar' };
  const options = { size, sort: { categories: 'reverse' as const }, annotations: [annotation] };
  const butterfly = layoutButterfly(data, { ...options, a: 'actual', b: 'plan' });
  const bullet = layoutBullet({ rows: dated.map((cat, i) => ({ ...cat, value: [100, 120, 150][i]!, target: 100 })) }, options);
  const delta = layoutVariance(data, { ...options, variance, variant: 'absolute' });
  expect(butterfly.marks.left.map((row) => row.id)).toEqual(['amber', 'birch', 'cedar']);
  expect(bullet.marks.rows.map((row) => row.id)).toEqual(['amber', 'birch', 'cedar']);
  expect(delta.marks.bars.map((row) => row.categoryId)).toEqual(['amber', 'birch', 'cedar']);
  for (const [type, g] of [['butterfly', butterfly], ['bullet', bullet], ['variance', delta]] as const) {
    expect(g.warnings).toContainEqual(expect.objectContaining({ code: `${type}-sort-ignored`, severity: 'warn', message: expect.stringContaining('sort.categories') }));
  }
});

// Scores and gaps cannot be added into Others, and a topN cut must name every category it removes.
it('keeps the largest dot scores and dumbbell gaps by size before sorting', () => {
  const data = { categories, series: [{ id: 'score', values: [3, -9, 8, 1] }] };
  const draw = (topN: { n: number; rest?: boolean; restLabel?: string; showRestCount?: boolean; threshold?: number }, sort?: { categories: 'desc' }) =>
    layoutDot(data, { size, topN: topN as { n: number }, sort, highlight: ['amber'] });
  const kept = draw({ n: 2 });
  expect(kept.marks.rows.map((row) => row.categoryId)).toEqual(['birch', 'cedar']);
  expect(draw({ n: 2 }, { categories: 'desc' }).marks.rows.map((row) => row.categoryId)).toEqual(['cedar', 'birch']);
  expect(kept.warnings).toContainEqual(expect.objectContaining({ code: 'topn-omitted', severity: 'info', message: expect.stringContaining('kept 2 of 4 categories; omitted: Amber, Elm') }));
  expect(chartNotes(kept)).toContainEqual(expect.objectContaining({ text: expect.stringContaining('Amber, Elm') }));
  const unsupported = draw({ n: 2, rest: true, restLabel: 'Other scores', showRestCount: true, threshold: 100 }).warnings
    .filter((warning) => warning.code === 'topn-rest-unsupported');
  expect(unsupported).toHaveLength(1);
  expect(unsupported[0]).toMatchObject({ severity: 'warn', message: expect.stringContaining('restLabel, topN.showRestCount, topN.threshold were ignored') });
  expect(draw({ n: 4, rest: true, restLabel: 'Other scores' }).warnings.some((warning) => warning.code.startsWith('topn-'))).toBe(false);
  const dumbbell = layoutDot({ categories, series: [{ id: 'a', values: [100, 0, 0, 0] }, { id: 'b', values: [101, -8, 7, 1] }] }, { size, variant: 'dumbbell', topN: { n: 2 } });
  expect(dumbbell.marks.rows.map((row) => row.categoryId)).toEqual(['birch', 'cedar']);
  expect(dumbbell.derived.gaps).toEqual({ birch: -8, cedar: 7 });
});

// Variance selection must use the displayed difference and never sum ratios or lose the omitted names from the reading.
it('keeps the largest variance differences by size and names omissions in readings', () => {
  const data = { categories, series: [{ id: 'actual', values: [101, 2, 25, null] }, { id: 'plan', role: 'reference' as const, values: [100, 10, 20, 1] }] };
  const absolute = layoutVariance(data, { size, variance, variant: 'absolute', topN: { n: 2, rest: true } });
  expect(absolute.marks.bars.map((bar) => bar.categoryId)).toEqual(['birch', 'cedar']);
  expect(absolute.derived.deltaAbs).toEqual({ birch: -8, cedar: 5 });
  expect(absolute.warnings).toContainEqual(expect.objectContaining({ code: 'topn-rest-unsupported', severity: 'warn' }));
  const relative = layoutVariance(data, { size, variance, variant: 'relative', topN: { n: 1 }, sort: { categories: 'desc' } });
  expect(relative.marks.pins.map((pin) => pin.categoryId)).toEqual(['birch']);
  expect(relative.derived.deltaPct).toEqual({ birch: -80 });
  for (const [type, series, extra] of [
    ['dot', [{ id: 'score', values: [3, -9, 8, 1] }], {}],
    ['variance', data.series, { variance, variant: 'absolute' }],
  ] as const) {
    const body = render({ spec: { type, data: { categories, series }, options: { size, ...extra, topN: { n: 2 } } }, return: ['reading'] }).body as unknown as {
      ok: boolean; reading: ChartReading; warnings: LintWarning[];
    };
    expect(body.ok, type).toBe(true);
    expect(body.reading.omissions.filter((item) => item.reason === 'topN').map((item) => item.text)).toEqual(['Amber', 'Elm']);
    expect(body.reading.notes).toContainEqual(expect.objectContaining({ kind: 'disclosure', text: expect.stringContaining('Amber, Elm') }));
    expect(body.reading.values.note).toBeUndefined();
  }
});

// topN.threshold acts on a column as on the bar it turns into, also when n keeps every category; a table too, and a variance says it ignores it.
it('applies topN.threshold on column and table and warns on variance when n keeps every category', () => {
  const series = [{ id: 'sales', values: [40, 30, 3, 2] }];
  const column = render({ spec: { type: 'column', data: { categories, series }, options: { size, topN: { n: 10, threshold: 10 } } }, return: ['svg'] }).body as unknown as { svg: string };
  expect(['Amber', 'Birch', 'Cedar', 'Elm', 'Others'].filter((name) => column.svg.includes(`>${name}<`))).toEqual(['Amber', 'Birch', 'Others']);
  const table = resolveTable({ columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value' }],
    rows: categories.map((category, i) => ({ id: category.id, label: category.label, cells: { v: series[0]!.values[i]! } })) }, { topN: { n: 10, threshold: 10 } });
  expect(table.table.rows.map((row) => [row.id, row.parentId ?? null])).toEqual([['amber', null], ['birch', null], ['others', null], ['cedar', 'others'], ['elm', 'others']]);
  const delta = render({ spec: { type: 'variance', data: { categories, series: [series[0]!, { id: 'plan', role: 'reference', values: [1, 1, 1, 1] }] }, options: { size, variance, variant: 'absolute', topN: { n: 10, threshold: 10 } } } }).body as unknown as { warnings: LintWarning[] };
  expect(delta.warnings).toContainEqual(expect.objectContaining({ code: 'option-ignored', path: '/options/topN/threshold' }));
  // The item budget sums the series the cut ranks: a reference that cancels the actuals must not let a long list through.
  const long = Array.from({ length: ITEM_BUDGET + 1 }, (_, i) => ({ id: `item${i}` }));
  const cancelled = { categories: long, series: [{ id: 'actual', values: long.map(() => 50) }, { id: 'plan', role: 'reference', values: long.map(() => -50) }] };
  for (const type of ['bar', 'column']) expect(() => checkItemBudget(type, cancelled, { topN: { n: ITEM_BUDGET + 1, threshold: 10 } }), type).toThrow(/exceed/);
});

// The item budget must count only selected dot and variance categories, including a cut exactly at the budget.
it('allows long dot and variance inputs that topN reduces to the item budget', () => {
  const data = { categories: Array.from({ length: ITEM_BUDGET + 1 }, (_, i) => ({ id: `item${i}` })) };
  expect(() => checkItemBudget('dot', data, { topN: { n: ITEM_BUDGET } })).not.toThrow();
  expect(() => checkItemBudget('variance', data, { topN: { n: ITEM_BUDGET, rest: true } })).not.toThrow();
});

// Time sequences and matrix cells must retain refusals that explain why removing or reordering entries changes their meaning.
it('refuses line sort and topN and heatmap topN with the correct structure reason', () => {
  for (const [schema, option, reason] of [
    [lineOptionsSchema, { sort: { categories: 'reverse' } }, 'time sequence'],
    [lineOptionsSchema, { topN: { n: 2 } }, 'time sequence'],
    [heatmapOptionsSchema, { topN: { n: 2 } }, 'matrix axes/cells'],
  ] as const) {
    const parsed = schema.safeParse(option);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]!.message).toContain(reason);
      expect(parsed.error.issues[0]!.message).not.toMatch(/dot|variance/);
    }
  }
});
