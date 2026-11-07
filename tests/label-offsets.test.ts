import './helpers/link-core';
import '../src/core/charts';
import { expect, it } from 'vitest';

import { layoutColumn } from '../src/core/charts/column/layout';
import { layoutWaterfall } from '../src/core/charts/waterfall/layout';
import { getChartDefinition } from '../src/core/registry';
import { getFixtures } from '../src/fixtures';

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
  const top = 'segment:t:a';
  const off = label(layoutColumn(stack, { variant: 'stacked', size: { width: 480, height: 400 }, labelOffsets: { [top]: { x: 20, y: -90 } } } as never), top);
  expect(off.rect.x).toBe(label(base, top).rect.x + 20);
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
  expect(geometry.warnings.find((warning) => warning.code === 'label-offset-blocked')!.message).toContain("'point:s:q3'");
});

// A moved label's own leader room is no text: the leader back to its point must stay.
it('a moved label keeps a leader that crosses only its own room', () => {
  const line = getChartDefinition('line')!;
  const fixture = getFixtures('line').find((entry) => entry.id === 'line-cell-label-on-last-complete-week')! as { data: unknown; options: object };
  const geometry = line.layout(line.normalize(fixture.data), { ...line.defaults, ...fixture.options, labelOffsets: { 'point:coverage:w5': { y: -14 } } } as never) as ReturnType<typeof layoutColumn>;
  expect((label(geometry, 'point:coverage:w5') as { leader?: unknown }).leader).toBeDefined();
  expect(geometry.warnings.some((warning) => warning.code === 'label-offset-blocked')).toBe(false);
});

// A move judged only against labels already seated took a later label's seat, and that label went to the note.
it('a move onto a later label\'s seat is blocked, and that label still draws', () => {
  const definition = getChartDefinition('column')!;
  const data = { categories: ['q1', 'q2', 'q3', 'q4'].map((id) => ({ id, label: id.toUpperCase() })), series: [{ id: 's', label: 'S', values: [30, 60, 45, 52] }] };
  const geometry = definition.layout(definition.normalize(data), { ...definition.defaults, size: { width: 360, height: 316 }, labelOffsets: { 'category:q2': { x: 80 } } } as never) as ReturnType<typeof layoutColumn>;
  expect(label(geometry, 'category:q3').hidden).toBeUndefined();
  expect(geometry.warnings.find((warning) => warning.code === 'label-offset-blocked')!.message).toContain("'category:q2'");
});

// The leader check skipped every label of the same owner, so a leader ran through the series name unwarned.
it('a moved leader that crosses another label of the same owner goes', () => {
  const line = getChartDefinition('line')!;
  const fixture = getFixtures('line').find((entry) => entry.id === 'actuals-forecast-operating-rate')! as { data: unknown; options: object };
  const geometry = line.layout(line.normalize(fixture.data), { ...line.defaults, ...fixture.options, labelOffsets: { 'point:market:fy27': { x: 60, y: 24 } } } as never) as ReturnType<typeof layoutColumn>;
  expect(label(geometry, 'point:market:fy27').leader).toBeUndefined();
  expect(geometry.warnings.find((warning) => warning.code === 'label-offset-blocked')!.message).toContain('leader');
});

// A moved value's level leader into the side of "503" read as "−503": the leader must run up from its own bar into the label's bottom.
it('a moved value leads from its own bar top into the label bottom, and a sideways move is refused', () => {
  const data = { categories: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, label: id.toUpperCase() })), series: [{ id: 's', label: 'S', values: [412, 398, 431, 503, 497, 488] }] };
  const draw = (move: { x?: number; y?: number }) => layoutColumn(data, { size: { width: 960, height: 360 }, labelOffsets: { 'point:s:d': move } } as never);
  const up = draw({ x: 24, y: -16 });
  const moved = label(up, 'point:s:d');
  const top = (up.scene.find((node) => node.t === 'rect' && node.owner.categoryId === 'd' && node.id.startsWith('mark:')) as never as { rect: { y: number } }).rect.y;
  const [x1, y1, x2, y2] = (moved.leader as { d: string }).d.match(/-?[\d.]+/g)!.map(Number);
  expect(y1).toBeCloseTo(top, 1);
  expect(y2).toBeGreaterThan(moved.rect.y + moved.rect.h);
  expect(Math.abs(y2! - y1!)).toBeGreaterThanOrEqual(0.5 * Math.abs(x2! - x1!));
  const side = draw({ x: 40 });
  expect(label(side, 'point:s:d').leader).toBeUndefined();
  const warning = side.warnings.find((entry) => entry.code === 'label-offset-blocked')!.message;
  expect(warning).toContain('beside its bar');
  expect(warning).not.toMatch(/seat '|outsideTop|unowned/);
});

// A value moved inside its bar stopped 2 px from the edge and looked misplaced: it keeps the inside padding.
it('a value moved inside its bar keeps 4 px from the bar edges', () => {
  const stack = { categories: columns.categories, series: [{ id: 's', label: 'S', values: [100, 80] }, { id: 't', label: 'T', values: [60, 50] }] };
  const geometry = layoutColumn(stack, { variant: 'stacked', size: { width: 960, height: 400 }, labelOffsets: { 'segment:s:a': { x: 96 } } } as never);
  const moved = label(geometry, 'segment:s:a').rect;
  const bar = (geometry.scene.find((node) => node.t === 'rect' && node.owner.seriesId === 's' && node.owner.categoryId === 'a' && node.id.startsWith('mark:')) as never as { rect: { x: number; w: number } }).rect;
  expect(moved.x + moved.w).toBeCloseTo(bar.x + bar.w - 4, 6);
});

// A moved callout's leader started at the seat it left, 8 px above its bar, and floated: it must start at the mark.
it('a moved callout leads back to its mark', () => {
  const fixture = getFixtures('waterfall').find((entry) => entry.id === 'callout-label-offset')! as unknown as { data: never; options: object; annotations: never };
  const geometry = layoutWaterfall(fixture.data, { ...fixture.options, annotations: fixture.annotations } as never);
  const leader = (label(geometry, 'annotation:callout-1').leader as { d: string }).d.match(/-?[\d.]+/g)!.map(Number);
  const bar = geometry.marks.bars.find((entry) => entry.id === 'costs')!.rect;
  expect(leader[1]).toBeCloseTo(bar.y, 1);
});
