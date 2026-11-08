import './helpers/link-core';
import { expect, it } from 'vitest';

import { layoutColumn } from '../src/core/charts/column/layout';
import { layoutLine } from '../src/core/charts/line/layout';
import { render } from '../src/cli/render';
import '../src/core/charts';
import { getChartDefinition } from '../src/core/registry';
import { layoutPie } from '../src/core/charts/pie/layout';

const columns = {
  categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }],
  series: [{ id: 's', label: 'S', values: [40, 60, 50] }],
};

// A straight line over a value label strikes the number through: the line must break around the text and say so.
it('a line that crosses a label is cut around it and warns', () => {
  const geometry = layoutColumn(columns, { valueAxis: { min: 0, max: 100 }, annotations: [{ kind: 'line', id: 'L', from: { categoryId: 'b', value: 10 }, to: { categoryId: 'b', value: 95 } }] } as never);
  const value = geometry.labels.find((label) => label.owner.categoryId === 'b' && label.kind !== 'category' && !label.hidden)!;
  const runs = geometry.scene.filter((node) => node.part === 'drawing') as { y1: number; y2: number }[];
  expect(runs).toHaveLength(2);
  for (const run of runs) {
    expect(Math.max(run.y1, run.y2) <= value.rect.y - 2 + 1e-6 || Math.min(run.y1, run.y2) >= value.rect.y + value.rect.h + 2 - 1e-6).toBe(true);
  }
  expect(geometry.warnings.find((warning) => warning.code === 'draw-crosses-text')!.message).toContain("'L'");
});

// A value on a chart with no value axis has no honest position: nothing may be drawn, and the author must hear why.
it('a value point on a chart with no value scale warns and draws nothing', () => {
  const geometry = layoutPie({ categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], series: [{ id: 's', label: 'S', values: [3, 7] }] } as never, {
    annotations: [{ kind: 'line', id: 'L', from: { categoryId: 'a', value: 2 }, to: { categoryId: 'b', value: 4 } }],
  } as never);
  expect(geometry.scene.some((node) => node.part === 'drawing')).toBe(false);
  const warning = geometry.warnings.find((entry) => entry.code === 'bad-anchor')!;
  expect(warning.message).toContain('no value scale');
});

// A drawing past the axis would extend no scale and sit on no data: it must warn and stay off the chart.
it('a value outside the plot warns and draws nothing', () => {
  const geometry = layoutColumn(columns, { annotations: [{ kind: 'arrow', id: 'A', from: { categoryId: 'a', value: 10 }, to: { categoryId: 'b', value: 5000 } }] } as never);
  expect(geometry.scene.some((node) => node.part === 'drawing')).toBe(false);
  expect(geometry.warnings.find((entry) => entry.code === 'bad-anchor')!.message).toContain('outside the plot');
});

// A box claiming its whole area would push the label it encloses away; only its edges may block a seat.
it('a label inside a box stays free', () => {
  const geometry = layoutColumn(columns, { valueAxis: { min: 0, max: 100 }, annotations: [
    { kind: 'box', id: 'B', from: { categoryId: 'a', value: 70 }, to: { categoryId: 'c', value: 95 } },
    { kind: 'text', id: 'T', at: { categoryId: 'b', value: 82 }, text: 'Inside' },
  ] } as never);
  expect(geometry.labels.find((label) => label.id === 'annotation:T')!.slot).toBe('at');
  expect(geometry.warnings.map((warning) => warning.code)).not.toContain('draw-crosses-text');
});

// Writing inside a bar is the plainest use of text on a chart: the bar must not hide it.
it('text at a value inside a bar draws there', () => {
  const geometry = layoutColumn(columns, { valueAxis: { min: 0, max: 100 }, annotations: [{ kind: 'text', id: 'T', at: { categoryId: 'b', value: 20 }, text: 'Inside' }] } as never);
  const text = geometry.labels.find((label) => label.id === 'annotation:T')!;
  expect(text.hidden).toBeFalsy();
  expect(text.slot).toBe('at');
});

// A note takes a plain date on a time axis, so a drawing written the same way must not fail as an unknown anchor.
it('a drawing takes plain dates on a time axis', () => {
  const data = { x: ['2024-01-01', '2024-02-01', '2024-03-01'], series: [{ id: 's', label: 'S', values: [1, 2, 3] }] };
  const line = getChartDefinition('line')!;
  const geometry = line.layout(line.normalize(data), { xAxis: { type: 'time' }, annotations: [{ kind: 'arrow', id: 'A', from: '2024-01-01', to: '2024-03-01' }] } as never) as ReturnType<typeof layoutColumn>;
  expect(geometry.warnings.some((warning) => warning.code === 'bad-anchor')).toBe(false);
  expect(geometry.scene.some((node) => node.part === 'drawing')).toBe(true);
});

// A box edge on a category's centre cut its bars and values in half, and a box over one category was refused.
it('a box given by category wraps whole bars, also on one category', () => {
  const box = (from: string, to: string) => layoutColumn(columns, { valueAxis: { min: 0, max: 100 }, annotations: [{ kind: 'box', id: 'B', from: { categoryId: from, value: 0 }, to: { categoryId: to, value: 90 } }] } as never);
  const bar = (geometry: ReturnType<typeof layoutColumn>, id: string) => (geometry.scene.find((node) => node.t === 'rect' && node.owner.categoryId === id && node.id.startsWith('mark:')) as never as { rect: { x: number; w: number } }).rect;
  const xs = (geometry: ReturnType<typeof layoutColumn>) => (geometry.scene.filter((node) => node.part === 'drawing') as never as { x1: number; x2: number }[]).flatMap((run) => [run.x1, run.x2]);
  const wide = box('a', 'b');
  expect(Math.min(...xs(wide))).toBeLessThan(bar(wide, 'a').x);
  expect(Math.max(...xs(wide))).toBeGreaterThan(bar(wide, 'b').x + bar(wide, 'b').w);
  const one = box('c', 'c');
  expect(one.warnings.map((warning) => warning.code)).not.toContain('bad-anchor');
  expect(Math.min(...xs(one))).toBeLessThan(bar(one, 'c').x);
  expect(Math.max(...xs(one))).toBeGreaterThan(bar(one, 'c').x + bar(one, 'c').w);
});

// An arrow given by data points drifted off its note as the width changed: from a text it must start at that text's edge.
it('an arrow from a text annotation starts at the edge of that text at every width', () => {
  for (const width of [360, 960]) {
    const geometry = layoutColumn(columns, { size: { width, height: 360 }, valueAxis: { min: 0, max: 100 }, annotations: [
      { kind: 'text', id: 'note', at: { categoryId: 'a', value: 85 }, text: 'A note' },
      { kind: 'arrow', id: 'A', from: { annotationId: 'note' }, to: { categoryId: 'c', value: 55 } },
    ] } as never);
    const text = geometry.labels.find((label) => label.id === 'annotation:note')!.rect;
    const shaft = geometry.scene.find((node) => node.t === 'line' && node.part === 'drawing') as never as { x1: number; y1: number };
    const gap = Math.hypot(Math.max(text.x - shaft.x1, 0, shaft.x1 - text.x - text.w), Math.max(text.y - shaft.y1, 0, shaft.y1 - text.y - text.h));
    expect(gap).toBeGreaterThan(1);
    // The standard's 4 px tail gap, up to √2 of it off a corner of the text.
    expect(gap).toBeLessThan(4 * Math.SQRT2 + 0.1);
  }
});

// The arrow standard (marks.arrow): a callout arrow and a drawn arrow to a line point must never shrink to a
// head smaller than the marker, touch the marker, or keep a stub of a shaft, at any width.
it('callout and drawn arrows keep the head, tip gap and shortest shaft of the standard at every width', () => {
  const line = getChartDefinition('line')!;
  const data = {
    categories: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, label: id.toUpperCase() })),
    series: [{ id: 's', label: 'S', values: [18, 19, 21, 24, 27, 29] }],
  };
  const pathPoints = (d: string) => [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map(Number);
  for (const width of [360, 480, 720, 960]) {
    for (const annotation of [
      { kind: 'callout', id: 'c', at: { categoryId: 'c', seriesId: 's' }, text: 'Price cut', arrow: true },
      { kind: 'arrow', id: 'c', from: { categoryId: 'a', value: 28 }, to: { categoryId: 'c', seriesId: 's' } },
    ]) {
      type Node = { t: string; owner?: { annotationId?: string; categoryId?: string }; d?: string; x1?: number; y1?: number; cx?: number; cy?: number; fill?: unknown };
      const geometry = line.layout(data as never, { size: { width, height: 320 }, valueAxis: { min: 15, max: 30 }, annotations: [annotation] } as never) as unknown as { scene: Node[] };
      const owned = geometry.scene.filter((node) => node.owner?.annotationId === 'c' && node.t !== 'text');
      const head = owned.find((node) => node.t === 'path' && node.fill !== undefined);
      expect(head, `${annotation.kind} at ${width}`).toBeDefined();
      const [tx, ty, b1x, b1y, b2x, b2y] = pathPoints(head!.d!) as [number, number, number, number, number, number];
      const base = { x: (b1x + b2x) / 2, y: (b1y + b2y) / 2 };
      expect(Math.hypot(tx - base.x, ty - base.y)).toBeCloseTo(8, 1);
      expect(Math.hypot(b1x - b2x, b1y - b2y)).toBeCloseTo(7, 1);
      const point = geometry.scene.find((node) => node.t === 'circle' && node.owner?.categoryId === 'c')!;
      expect(Math.hypot(tx - point.cx!, ty - point.cy!)).toBeGreaterThanOrEqual(3 + 6 - 0.01);
      const shaft = owned.find((node) => node !== head && (node.t === 'line' || node.t === 'path'))!;
      const [sx, sy] = shaft.d ? pathPoints(shaft.d) as [number, number] : [shaft.x1!, shaft.y1!];
      expect(Math.hypot(base.x - sx, base.y - sy), `${annotation.kind} at ${width}`).toBeGreaterThanOrEqual(24 - 0.5);
    }
  }
});

// A bar difference that rides its row must not cover the shorter bar's value, cut through a bar, or merge with another difference into one arrow.
it('a bar difference rides its row only where the row is clear', () => {
  const bar = getChartDefinition('bar')!;
  type Node = { t: string; part?: string; owner?: { annotationId?: string }; d?: string; y1?: number; y2?: number; x1?: number; x2?: number };
  type Label = { owner: { categoryId?: string }; kind: string; hidden?: unknown; rect: { x: number; y: number; w: number; h: number } };
  const run = (values: number[], annotations: unknown[], options: object = {}) => bar.layout({
    categories: values.map((_, i) => ({ id: 'abc'[i]!, label: 'ABC'[i]! })),
    series: [{ id: 's', label: 'S', values }],
  } as never, { size: { width: 360, height: 260 }, annotations, ...options } as never) as unknown as { scene: Node[]; labels: Label[] };
  const diff = (from: string, to: string, extra: object = {}) => ({ kind: 'diff', id: `${from}${to}`, mode: 'absolute', from: { categoryId: from, seriesId: 's' }, to: { categoryId: to, seriesId: 's', ...extra } });
  // The head stops right of the value printed past a short bar.
  const small = run([100, 1], [diff('a', 'b')]);
  const value = small.labels.find((label) => label.owner.categoryId === 'b' && label.kind !== 'category' && !label.hidden)!;
  const head = small.scene.find((node) => node.part === 'arrowHead')!;
  const tipX = Number(head.d!.match(/^M(-?[\d.]+)/)![1]);
  expect(tipX).toBeGreaterThan(value.rect.x + value.rect.w);
  // Two differences into one row keep two separate shafts.
  const shafts = run([100, 80, 20], [diff('a', 'c'), diff('b', 'c')]).scene.filter((node) => node.part === 'diffArrow' && node.t === 'line');
  expect(shafts).toHaveLength(2);
  expect(Math.abs(shafts[0]!.y1! - shafts[1]!.y1!)).toBeGreaterThan(4);
  // An end on a bar's start edge keeps the arrow between the rows, off the bar it would cut through.
  const edge = run([82, 23], [diff('a', 'b', { edge: 'start' })]).scene;
  const start = edge.find((node) => node.part === 'diffArrow' && node.t === 'line')!;
  const barB = (edge.find((node) => node.t === 'rect' && (node.owner as { categoryId?: string } | undefined)?.categoryId === 'b') as unknown as { rect: { y: number; h: number } }).rect;
  expect(start.y1! < barB.y || start.y1! > barB.y + barB.h).toBe(true);
  // A long value past the shorter bar, or a range whisker in its row, keeps the arrow out of that row.
  for (const values of [[100, { number: 99, label: '99 units of goods' }], [80, { number: 20, range: { low: 10, high: 40 } }]]) {
    const scene = run(values as never, [diff('a', 'b')], { size: { width: 960, height: 320 } }).scene;
    const shaft = scene.find((node) => node.part === 'diffArrow' && node.t === 'line')!;
    const rowB = (scene.find((node) => node.t === 'rect' && (node.owner as { categoryId?: string } | undefined)?.categoryId === 'b') as unknown as { rect: { y: number; h: number } }).rect;
    expect(shaft.y1! < rowB.y || shaft.y1! > rowB.y + rowB.h, JSON.stringify(values[1])).toBe(true);
  }
});

// A plan tick just over a column's end must not push the column's value above the tick, where it reads as
// the plan's, and a delta and a callout on that column must stack above it instead of one being dropped or
// leading in from the side on an S-shaped leader.
it('a column under its plan tick keeps its value, and its notes stack straight above', () => {
  const data = {
    categories: ['a', 'b', 'c'].map((id) => ({ id, label: id.toUpperCase() })),
    series: [{ id: 'act', label: 'Actual', values: [455, 470, 552] }, { id: 'plan', label: 'Plan', role: 'reference', values: [450, 505, 545] }],
  };
  type Label = { id: string; slot: string; rect: { x: number; y: number; w: number; h: number }; hidden?: unknown; leader?: unknown };
  const at = { categoryId: 'b', seriesId: 'act' };
  const layout = (annotations: object[]) => (layoutColumn(data as never, { size: { width: 960, height: 300 }, referenceStyle: 'tick', annotations } as never) as unknown as { labels: Label[] }).labels;
  expect(layout([]).find((label) => label.id === 'point:act:b')!.slot).toBe('insideEnd');
  const labels = layout([
    { kind: 'delta', id: 'd', at, vs: { categoryId: 'b', seriesId: 'plan' } },
    { kind: 'callout', id: 'c', at, text: 'Supplier switch delayed launches' },
  ]);
  const find = (id: string) => labels.find((label) => label.id === id)!;
  const [delta, callout] = [find('annotation:d'), find('annotation:c')];
  for (const note of [delta, callout]) expect([note.hidden, note.leader]).toEqual([undefined, undefined]);
  const centre = (label: Label) => label.rect.x + label.rect.w / 2;
  expect(Math.abs(centre(delta) - centre(callout))).toBeLessThan(1);
  expect(callout.rect.y + callout.rect.h).toBeLessThanOrEqual(delta.rect.y);
  // A note wider than its column stacks from its own column's tick, not from a taller neighbour's under its text.
  const fy = (id: string) => ({ categoryId: 'fy23', seriesId: id });
  const wide = (getChartDefinition('column')!.layout({ categories: ['FY21', 'FY22', 'FY23', 'FY24', 'FY25'].map((label) => ({ id: label.toLowerCase(), label })), series: [
    { id: 'revenue', label: 'Revenue', values: [410, 455, 470, 552, 588] }, { id: 'plan', label: 'Plan', role: 'reference', values: [400, 450, 505, 545, 580] }] } as never,
  { size: { width: 720, height: 405 }, title: 'FY23 was the only year below plan', unit: 'EUR m', source: 'Illustrative data', legend: 'top', highlight: ['fy23'], referenceStyle: 'tick', annotations: [
    { kind: 'delta', id: 'd', at: fy('revenue'), vs: fy('plan') },
    { kind: 'callout', id: 'c', at: fy('revenue'), text: 'Supplier switch delayed launches' }] } as never) as unknown as { labels: Label[] }).labels;
  for (const id of ['annotation:d', 'annotation:c']) expect(wide.find((label) => label.id === id)!.hidden, id).toBeUndefined();
  // A lone delta on a column whose value prints above it stands straight over that value, not on a curved leader.
  const lone = (layoutColumn({ categories: data.categories, series: [{ id: 'act', label: 'Actual', values: [412, 450, 561] }] } as never,
    { size: { width: 960, height: 300 }, annotations: [{ kind: 'delta', id: 'd', at: { categoryId: 'c', seriesId: 'act' }, vs: { categoryId: 'a', seriesId: 'act' } }] } as never) as unknown as { labels: Label[] }).labels;
  const [loneDelta, value] = [lone.find((label) => label.id === 'annotation:d')!, lone.find((label) => label.id === 'point:act:c')!];
  expect(loneDelta.leader).toBeUndefined();
  expect(loneDelta.rect.y + loneDelta.rect.h).toBeLessThanOrEqual(value.rect.y);
  // On a narrow chart a plan value never stands centred over a neighbour's column, where it reads as that column's plan.
  const five = { categories: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, label: id.toUpperCase() })), series: [
    { id: 'act', label: 'Actual', values: [410, 455, 470, 552, 588] }, { id: 'plan', label: 'Plan', role: 'reference', values: [400, 450, 505, 545, 580] }] };
  const narrow = layoutColumn(five as never, { size: { width: 360, height: 300 }, referenceStyle: 'tick', highlight: ['c'] } as never) as unknown as
    { labels: (Label & { kind: string; owner: { categoryId?: string } })[]; scene: { t: string; part?: string; owner?: { categoryId?: string }; rect?: Label['rect'] }[] };
  const columns = narrow.scene.filter((node) => node.t === 'rect' && node.rect && node.owner?.categoryId);
  for (const tick of narrow.labels.filter((label) => label.kind === 'tick' && label.hidden === undefined)) {
    for (const column of columns.filter((node) => node.owner!.categoryId !== tick.owner.categoryId)) {
      const r = column.rect!;
      const mid = tick.rect.x + tick.rect.w / 2;
      expect(mid <= r.x || mid >= r.x + r.w, `${tick.id} over ${column.owner!.categoryId}`).toBe(true);
    }
  }
});

// At 360 px the named plan values ("400 Plan") found no seat beside their ticks and all went to the notes.
// With the key naming Plan, they print as numbers; authored tick content keeps the name.
it('a keyed plan tick drops its name where the named value has no seat beside its column', () => {
  const data = { categories: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, label: id.toUpperCase() })), series: [
    { id: 'act', label: 'Actual', values: [410, 455, 470, 552, 588] }, { id: 'plan', label: 'Plan', role: 'reference', values: [400, 450, 505, 545, 580] }] };
  const ticks = (options: object) => (getChartDefinition('column')!.layout(data as never, { size: { width: 360, height: 300 }, referenceStyle: 'tick', legend: 'top', ...options } as never) as unknown as
    { labels: { kind: string; text: string; hidden?: unknown }[] }).labels.filter((label) => label.kind === 'tick');
  expect(ticks({}).map((label) => [label.text, label.hidden])).toEqual(['400', '450', '505', '545', '580'].map((text) => [text, undefined]));
  expect(ticks({ labels: { tick: ['absolute', 'series'] } }).map((label) => label.text)).toContain('400 Plan');
});

// A difference across all twelve months of a narrow column chart lost its number (no seat right of its arrow beside the
// last column). As a total difference it runs as the growth bracket over the columns and keeps the values' row.
// The percent modes of a delta and a diff must print the right numbers.
it('a far column difference runs as the growth bracket and keeps its number at 360 px, and a delta prints percent', () => {
  const data = {
    categories: ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].map((id) => ({ id, label: id })),
    series: [{ id: 's', label: 'S', values: [412, 398, 431, 447, 452, 468, 503, 497, 488, 512, 534, 561] }],
  };
  const at = (categoryId: string) => ({ categoryId, seriesId: 's' });
  const column = getChartDefinition('column')!;
  type Label = { id: string; text: string; hidden?: unknown; slot: string; leader?: unknown };
  const run = (annotation: object) => column.layout(data as never, { size: { width: 360, height: 300 }, labelDensity: 'minimal', annotations: [{ id: 'd', ...annotation }] } as never) as unknown as
    { labels: Label[]; scene: { owner?: { annotationId?: string }; part?: string }[] };
  const label = (annotation: object) => run(annotation).labels.find((entry) => entry.id === 'annotation:d')!;
  const far = run({ kind: 'diff', from: at('jan'), to: at('dec') });
  expect(far.labels.find((entry) => entry.id === 'annotation:d')).toMatchObject({ text: '+36%', slot: 'onArm' });
  expect(far.labels.find((entry) => entry.id === 'annotation:d')!.hidden).toBeUndefined();
  expect(far.scene.some((node) => node.owner?.annotationId === 'd' && node.part === 'arm')).toBe(true);
  // The values keep the seats they take without the difference: one row, no leaders.
  const values = (labels: Label[]) => labels.filter((entry) => entry.id.startsWith('point:')).map((entry) => [entry.slot, entry.leader !== undefined]);
  const plain = column.layout(data as never, { size: { width: 360, height: 300 }, labelDensity: 'minimal' } as never) as unknown as { labels: Label[] };
  expect(values(far.labels)).toEqual(values(plain.labels));
  expect(label({ kind: 'diff', from: at('jan'), to: at('dec'), mode: 'both' }).text).toBe('+149 (+36%)');
  // placement 'label' keeps the arrow at the columns; a delta between the totals takes the bracket as well.
  expect(label({ kind: 'diff', from: at('jan'), to: at('dec'), placement: 'label' }).slot).not.toBe('onArm');
  expect(label({ kind: 'delta', at: at('dec'), vs: at('jan'), mode: 'both' })).toMatchObject({ text: '+149 (+36%)', slot: 'onArm' });
  // A reference series is not the column's total: its difference keeps the arrow at its ticks.
  const planned = { ...data, series: [...data.series, { id: 'plan', label: 'Plan', role: 'reference', values: data.series[0]!.values.map((v) => v - 50) }] };
  const planDiff = (column.layout(planned as never, { size: { width: 600, height: 400 }, annotations: [{ kind: 'diff', id: 'd', from: { categoryId: 'jan', seriesId: 'plan' }, to: { categoryId: 'dec', seriesId: 'plan' } }] } as never) as unknown as
    { labels: Label[] }).labels.find((entry) => entry.id === 'annotation:d')!;
  expect(planDiff.slot).not.toBe('onArm');
  // A format shapes the number a mode prints in the values' unit; a relative delta prints a percent.
  const refusal = (annotation: object) => (render({ spec: { type: 'line', data: { categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], series: [{ id: 's', label: 'S', values: [40, 50] }] },
    options: { annotations: [annotation] } } as never, return: ['svg'] }).body as { errors?: unknown[] }).errors?.length ?? 0;
  expect(refusal({ kind: 'diff', from: 'a', to: 'b', mode: 'both', format: '$0.0' })).toBe(0);
  expect(refusal({ kind: 'delta', at: 'b', vs: 'a', mode: 'relative', format: '$0.0' })).toBeGreaterThan(0);
  // A butterfly's difference column prints the value difference only, so a percent delta keeps its label.
  const butterfly = getChartDefinition('butterfly')!;
  const kept = (butterfly.layout({ categories: [{ id: 'c', label: 'C' }], series: [{ id: 'a', label: 'A', values: [40] }, { id: 'b', label: 'B', values: [50] }] } as never,
    { a: 'a', b: 'b', size: { width: 960, height: 300 }, diffColumn: true, annotations: [{ kind: 'delta', id: 'd', mode: 'relative', at: { categoryId: 'c', seriesId: 'b' }, vs: { categoryId: 'c', seriesId: 'a' } }] } as never) as unknown as
    { labels: Label[] }).labels.find((entry) => entry.id === 'annotation:d');
  expect(kept?.text).toBe('+25%');
  expect(label({ kind: 'delta', at: at('dec'), vs: at('jan'), mode: 'relative' }).text).toBe('+36%');
  // An authored format shapes the value but not the percent beside it.
  const line = getChartDefinition('line')!;
  const pair = { categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], series: [{ id: 'p', label: 'P', values: [10, 40] }, { id: 'q', label: 'Q', values: [20, 50] }] };
  const formatted = (line.layout(pair as never, { size: { width: 960, height: 400 }, valueLabels: 'all', annotations: [
    { kind: 'delta', id: 'd', at: { categoryId: 'b', seriesId: 'q' }, vs: { categoryId: 'b', seriesId: 'p' }, placement: 'label', mode: 'both', format: '$0.0' }] } as never) as unknown as
    { labels: { id: string; text: string }[] }).labels.find((entry) => entry.id === 'annotation:d')!.text;
  expect(formatted).toBe('+$10.0 (+25%)');
  // A gap bracket that a long label beside it moves keeps the mode too.
  const six = { categories: [...'abcdef'].map((id) => ({ id, label: id })), series: [
    { id: 'first', label: 'first', values: [10, 40, 20, 50, 30, 40] }, { id: 'second', label: 'second', values: [20, 50, 30, 60, 40, 50] }] };
  const bracketed = (layoutLine(six as never, { size: { width: 960, height: 300 }, valueLabels: 'all', seriesLabels: 'none', annotations: [
    { kind: 'diff', id: 'diff', from: { categoryId: 'a', seriesId: 'first' }, to: { categoryId: 'f', seriesId: 'first' }, text: 'Comparison of first and last period in the baseline series' },
    { kind: 'delta', id: 'd', at: { categoryId: 'f', seriesId: 'second' }, vs: { categoryId: 'f', seriesId: 'first' }, placement: 'bracket', mode: 'relative' }] } as never) as unknown as
    { labels: { id: string; text: string }[] }).labels.find((entry) => entry.id === 'annotation:d')!.text;
  expect(bracketed).toBe('+25%');
});

// A named value line at the level the series ends on printed "Normal load 53%" beside the end value "53%": the number twice.
it('a named value line at the series end value prints its name beside that value at every width', () => {
  const line = getChartDefinition('line')!;
  const data = {
    categories: ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8'].map((id) => ({ id, label: id.toUpperCase() })),
    series: [{ id: 'load', label: 'Load', values: [52, 54, 51, 38, 35, 37, 49, 53] }],
  };
  type Label = { id: string; text: string; rect: { x: number; y: number; w: number; h: number }; hidden?: string };
  const layout = (width: number, label: string) => (line.layout(line.normalize(data), { size: { width, height: 340 }, unit: '%', valueAxis: { min: 30, max: 60 }, valueLabels: 'extremes',
    annotations: [{ kind: 'valueLine', id: 'normal', value: 53, label }] } as never) as unknown as { labels: Label[] }).labels;
  for (const width of [360, 960]) {
    const labels = layout(width, 'Normal load');
    const name = labels.find((entry) => entry.id === 'valueLine:normal')!;
    const end = labels.find((entry) => entry.text === '53%' && entry.id.startsWith('point:'))!;
    expect(name.text, `at ${width}`).toBe('Normal load');
    expect(name.hidden).toBeUndefined();
    // The name ends just left of the value and shares its row.
    expect(end.rect.x - (name.rect.x + name.rect.w), `at ${width}`).toBeGreaterThanOrEqual(0);
    expect(end.rect.x - (name.rect.x + name.rect.w), `at ${width}`).toBeLessThan(12);
    expect(Math.abs(end.rect.y + end.rect.h / 2 - (name.rect.y + name.rect.h / 2))).toBeLessThan(name.rect.h);
    // A label that places the number itself keeps it.
    expect(layout(width, 'Normal load ${value}').find((entry) => entry.id === 'valueLine:normal')!.text).toBe('Normal load 53%');
  }
  // An end value at another level that rounds to the same text does not take the line's number.
  const near = line.layout(line.normalize({ ...data, series: [{ id: 'load', label: 'Load', values: [51, 54, 52, 57, 55, 51, 50, 52.6] }] }),
    { size: { width: 960, height: 340 }, format: '1%', valueAxis: { min: 50, max: 60 }, valueLabels: 'last',
      annotations: [{ kind: 'valueLine', id: 'normal', value: 53.4, label: 'Normal load' }] } as never) as unknown as { labels: Label[] };
  expect(near.labels.find((entry) => entry.id === 'valueLine:normal')!.text).toBe('Normal load 53%');
  // A combo solves the end value together with the line's label: the end value can still lose its seat, so the label keeps its number.
  const combo = getChartDefinition('combo')!;
  const joint = combo.layout(combo.normalize({ categories: ['a', 'b', 'c'].map((id) => ({ id, label: id })),
    series: [{ id: 's', kind: 'line', label: 'S', values: [10, 20, 53] }, { id: 't', kind: 'line', label: 'T', values: [9, 21, 52] }] }),
  { size: { width: 360, height: 240 }, valueLabels: 'all', annotations: [{ kind: 'valueLine', id: 'n', value: 53, label: 'Normal operating load' }] } as never) as unknown as { labels: Label[] };
  expect(joint.labels.find((entry) => entry.id === 'valueLine:n')!.text).toBe('Normal operating load 53');
});

// A callout over a column in a two-tier grid was dropped at 360 px: the tier was too short for its text on one line.
// The grid grows at an open height until the callout seats, wrapped over the column's plan tick.
it('a callout in a grid tier seats at 360 px, wrapped over its column', async () => {
  const { render } = await import('../src/cli/render');
  const fy = {
    categories: ['FY21', 'FY22', 'FY23', 'FY24', 'FY25'].map((label) => ({ id: label.toLowerCase(), label })),
    series: [
      { id: 'ac', label: 'Actual', scenario: 'AC', values: [410, 455, 470, 552, 588] },
      { id: 'pl', label: 'Plan', scenario: 'PL', role: 'reference', values: [400, 450, 505, 545, 580] },
    ],
  };
  const spec = { type: 'grid', data: { panels: [
    { id: 'rev', type: 'column', data: fy, options: { labels: { tick: false }, highlight: ['fy23'] }, annotations: [{ kind: 'callout', at: { categoryId: 'fy23', seriesId: 'ac' }, text: 'Supplier switch delayed launches' }] },
    { id: 'dpl', type: 'variance', data: fy, options: { variant: 'absolute', variance: { vs: 'pl' } } },
  ] }, options: { sharedAxis: 'category', legend: 'top', unit: 'EUR m', title: 'FY23 was the only year below plan',
    subtitle: { measure: 'Revenue', period: 'FY21 to FY25', scenarios: ['AC', 'PL'] }, sharedScale: false, size: { width: 360 } } };
  const body = render({ spec: spec as never, return: ['svg'] }).body as { warnings?: { code: string }[]; svg?: string };
  expect((body.warnings ?? []).map((warning) => warning.code)).not.toContain('label-hidden');
  // Two lines over the column, not one line on a leader from a free spot.
  expect(body.svg).toMatch(/Supplier switch<\/tspan>|>Supplier switch</);
  // The wrapped seat reaches over the neighbours: it leaves the room a note on the next column needs.
  const pair = render({ spec: { type: 'column', data: { categories: ['c0', 'c1', 'c2'].map((id) => ({ id, label: id.toUpperCase() })),
    series: [{ id: 's', label: 'S', values: [40, 60, 50] }] }, options: { size: { width: 320 }, annotations: [
    { kind: 'callout', id: 'a', at: { categoryId: 'c0', seriesId: 's' }, text: 'Supplier switch delayed launches' },
    { kind: 'note', id: 'b', at: { categoryId: 'c1', seriesId: 's' }, text: 'Demand returned after launch' }] } } as never, return: ['svg'] }).body as { warnings?: { code: string }[] };
  expect((pair.warnings ?? []).map((warning) => warning.code)).not.toContain('label-hidden');
});
