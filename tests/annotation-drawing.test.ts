import './helpers/link-core';
import { expect, it } from 'vitest';

import { layoutColumn } from '../src/core/charts/column/layout';
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
    expect(gap).toBeLessThan(5);
  }
});
