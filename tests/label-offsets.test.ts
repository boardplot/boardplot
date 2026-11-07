import './helpers/link-core';
import '../src/core/charts';
import { expect, it } from 'vitest';

import { layoutColumn } from '../src/core/charts/column/layout';
import { layoutWaterfall } from '../src/core/charts/waterfall/layout';
import { getChartDefinition } from '../src/core/registry';

const bridge = { items: [
  { id: 'a', label: 'Start', type: 'total' as const, value: 100 },
  { id: 'b', label: 'Volume', value: 64 },
  { id: 'c', label: 'Price', value: 38 },
  { id: 'd', label: 'End', type: 'total' as const },
] };
const columns = {
  categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
  series: [{ id: 's', label: 'S', values: [100, 80] }],
};
const label = (geometry: { labels: { id: string }[] }, id: string) => geometry.labels.find((entry) => entry.id === id) as never as { rect: { x: number; y: number; w: number; h: number }; hidden?: string; ink: unknown; halo?: boolean; leader?: unknown; lines: string[] };

// A move that lands on another mark would overprint it, or lose the label: it must stay in its seat and say so.
it('a blocked offset warns and keeps its label', () => {
  const notes = [{ kind: 'callout' as const, at: 'c', text: 'Note' }];
  const base = layoutWaterfall(bridge, { annotations: notes } as never);
  const seat = label(base, 'annotation:callout-1').rect;
  const onto = base.marks.bars.find((bar) => bar.id === 'a')!.rect;
  const geometry = layoutWaterfall(bridge, { annotations: notes, labelOffsets: { 'annotation:callout-1': { x: onto.x + 2 - seat.x, y: onto.y + 40 - seat.y } } } as never);
  const moved = label(geometry, 'annotation:callout-1');
  expect(moved.hidden).toBeUndefined();
  expect(moved.rect).toEqual(seat);
  const warning = geometry.warnings.find((entry) => entry.code === 'label-offset-blocked')!;
  expect(warning.message).toContain("'annotation:callout-1'");
  expect(warning.message).toContain("categoryId='a'");
});

// A typo in a label id changed nothing while the author believed it took effect.
it('an unknown label id warns and lists the valid ids', () => {
  const definition = getChartDefinition('column')!;
  const geometry = definition.layout(definition.normalize(columns), { labelOffsets: { nope: { y: 4 } } } as never);
  const warning = geometry.warnings.find((entry) => entry.code === 'label-offset-unknown')!;
  expect(warning.message).toContain('labelOffsets');
  expect(warning.message).toContain('point:s:a');
  expect(warning.field).toEqual(['options', 'labelOffsets', 'nope']);
});

// White inside text moved off its bar would vanish on the page; moved within the bar it must keep its ink.
it('a value moved off its bar takes page ink and a halo, and within its bar keeps its ink', () => {
  const stack = { categories: columns.categories, series: [{ id: 's', label: 'S', values: [100, 80] }, { id: 't', label: 'T', values: [60, 50] }] };
  const id = 'segment:s:a';
  const base = layoutColumn(stack, { variant: 'stacked', size: { width: 480, height: 400 } } as never);
  const start = label(base, id);
  expect(JSON.stringify(start.ink)).toContain('inkInverse');
  const within = label(layoutColumn(stack, { variant: 'stacked', size: { width: 480, height: 400 }, labelOffsets: { [id]: { y: 8 } } } as never), id);
  expect(within.rect.y).toBe(start.rect.y + 8);
  expect(JSON.stringify(within.ink)).toContain('inkInverse');
  expect(within.halo).toBeUndefined();
  const off = label(layoutColumn(stack, { variant: 'stacked', size: { width: 480, height: 400 }, labelOffsets: { [id]: { x: 120 } } } as never), id);
  expect(off.rect.x).toBe(start.rect.x + 120);
  expect(JSON.stringify(off.ink)).not.toContain('inkInverse');
  expect(off.halo).toBe(true);
});

// The finish pass restored a chip callout's saved rect by slot, which undid the move and split the text from its chip.
it('a callout with a chip keeps its offset, with the chip beside it and the leader on its anchor', () => {
  const notes = [{ kind: 'callout' as const, at: 'c', text: 'Note', status: 'good' as const }];
  const base = layoutWaterfall(bridge, { annotations: notes } as never);
  const geometry = layoutWaterfall(bridge, { annotations: notes, labelOffsets: { 'annotation:callout-1': { x: -30, y: 30 } } } as never);
  const seat = label(base, 'annotation:callout-1').rect;
  const moved = label(geometry, 'annotation:callout-1').rect;
  expect(geometry.warnings.map((entry) => entry.code)).not.toContain('label-offset-blocked');
  expect([moved.x - seat.x, moved.y - seat.y]).toEqual([-30, 30]);
  const chip = (geo: typeof base) => geo.scene.find((node) => node.part === 'calloutGlyph' && node.t === 'circle') as never as { cx: number; cy: number };
  expect([chip(geometry).cx - chip(base).cx, chip(geometry).cy - chip(base).cy]).toEqual([-30, 30]);
});

// A moved value's leader must never cost another value its seat, nor run through its text.
it('a moved label keeps every other value, and a leader that would cross text goes with a warning', () => {
  const data = { categories: ['q1', 'q2', 'q3', 'q4'].map((id) => ({ id, label: id })), series: [{ id: 's', label: 'S', values: [30, 30, 30, 32] }] };
  const size = { size: { width: 720, height: 300 }, valueAxis: { min: 0, max: 80 } };
  const plain = layoutColumn(data, size as never);
  const geometry = layoutColumn(data, { ...size, labelOffsets: { 'point:s:q3': { x: -400, y: -30 } } } as never);
  for (const id of ['point:s:q1', 'point:s:q2', 'point:s:q4']) expect(label(geometry, id).rect).toEqual(label(plain, id).rect);
  expect((label(geometry, 'point:s:q3') as { leader?: unknown }).leader).toBeUndefined();
  expect(geometry.warnings.find((warning) => warning.code === 'label-offset-blocked')!.message).toContain('leader');
});
