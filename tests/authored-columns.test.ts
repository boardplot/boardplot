import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { interactionRecords } from '../src/core/a11y/records';
import { bartableCore } from '../src/core/charts/bartable/core';
import { getChart } from '../src/core/registry';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { requireGeometry } from '../src/core/sizing';
import { getFixtures } from '../src/fixtures';
import { heatmapCore } from '../src/core/charts/heatmap/core';
import type { Geometry } from '../src/core/types/scene';

const fixture = (type: string, id: string) => getFixtures(type).find(item => item.id === id)! as unknown as { data: never; options: Record<string, unknown> };
const codes = (geometry: { warnings: { code: string }[] }) => geometry.warnings.map(warning => warning.code);
const stores = fixture('bartable', 'total-top');
const chart = (type: string) => getChart(type)!;
const drawn = (type: string, id: string, columnOverrides: object | undefined, size?: object) => {
  const { data, options } = fixture(type, id);
  return chart(type).layout(data, { ...options, columnOverrides, ...(size ? { size } : {}) }) as Geometry<any, any>;
};
const bartable = (options: Record<string, unknown>) => bartableCore.layout(stores.data, { size: { width: 760 }, ...options } as never) as Geometry<any, any>;

describe('authored column settings', () => {
  // An authored width must never refuse: a wide one stops at the floor of the other parts and says so.
  it.each(['bartable', 'heatmap', 'status'])('%s caps a width wider than its plot and still draws', type => {
    const geometry = drawn(type, 'column-widths', { label: { width: 4000 } }, { width: 620 });
    expect(geometry.refused).toBeFalsy();
    expect(codes(geometry)).toContain('generated-column-width-capped');
    expect(geometry.sizing!.minWidth).toBeLessThanOrEqual(620);
  });

  // A narrow width must draw too, and say that it gave way, because the column on the page is not the one asked for.
  it.each(['bartable', 'heatmap', 'status'])('%s floors a width under its minimum and keeps every name', type => {
    const geometry = drawn(type, 'column-widths', { label: { width: 1 } }, { width: 620 });
    expect(geometry.refused).toBeFalsy();
    expect(codes(geometry)).toContain('generated-column-width-floored');
    expect(geometry.labels.filter(label => label.title !== undefined)).toEqual([]);
  });

  // A width that costs printed numbers would misreport the data with no sign of it, whatever a label count says.
  it.each([
    ['heatmap', 'series-formats', { a: { width: 1 } }, { width: 650, height: 350 }],
    ['heatmap', 'series-formats', { label: { width: 1000 } }, { width: 650, height: 350 }],
    ['bartable', 'column-widths', { sales: { width: 1 } }, { width: 760 }],
    ['bartable', 'null-and-long-labels', { label: { width: 300 } }, { width: 480 }],
  ] as const)('%s/%s gives a width up where it would cost text', (type, id, overrides, size) => {
    const geometry = drawn(type, id, overrides, size);
    const plain = drawn(type, id, undefined, size);
    const texts = (result: Geometry<any, any>) => result.scene.flatMap(node => (node.t === 'text' && node.id.startsWith('label:') ? [`${node.id}=${node.lines.join(' ')}`] : []));
    expect(texts(geometry)).toEqual(texts(plain));
    expect(codes(geometry).some(code => code === 'generated-column-width-capped' || code === 'generated-column-width-floored')).toBe(true);
  });

  // A wrong id gave a floored warning for a column that does not exist, which sends the author to the wrong key.
  it('warns only the unknown id for a width on a column the chart does not draw', () => {
    const found = codes(drawn('status', 'programme-rollout-rag', { nope: { width: 1 } }, { width: 400 }));
    expect(found).toContain('generated-id-unknown');
    expect(found).not.toContain('generated-column-width-floored');
  });

  // The row names print no head, so these two keys have no reader unless a real column carries the id.
  it.each(['bartable', 'heatmap', 'status'])('%s refuses a head setting on the row names', type => {
    for (const key of [{ label: 'Names' }, { headAlign: 'left' }]) {
      expect(drawn(type, 'column-widths', { label: key }).warnings.find(warning => warning.severity === 'error')?.code).toBe('invalid-options');
    }
  });

  // A heatmap column can be called label, and its head must stay renameable.
  it('keeps a head setting on a real column with the id label', () => {
    const data = { categories: [{ id: 'label', label: 'Tag' }, { id: 'b', label: 'B' }], series: [{ id: 'r', label: 'Row', values: [1, 2] }] };
    const geometry = chart('heatmap').layout(data, { variant: 'value', columnOverrides: { label: { label: 'Renamed' } }, size: { width: 480 } }) as Geometry<any, any>;
    expect(geometry.warnings.some(warning => warning.severity === 'error')).toBe(false);
    expect(geometry.scene.some(node => node.t === 'text' && node.lines.join(' ') === 'Renamed')).toBe(true);
  });

  // An accepted key that changes nothing is dead: panel align feeds the panel head, as the docs say.
  it('aligns a panel head with align', () => {
    const headX = (align?: string) => (drawn('bartable', 'total-top', align ? { sales: { align } } : undefined, { width: 760 }).labels.find(label => label.id === 'head:sales') as { rect: { x: number } }).rect.x;
    expect(headX('right')).toBeGreaterThan(headX());
  });

  // A head alignment must not hide a head the chart prints without it.
  it('gives up a head alignment that would hide a head', () => {
    const geometry = drawn('heatmap', 'harvey-quarter-steps', { zero: { headAlign: 'right' } }, { width: 340 });
    expect(geometry.scene.some(node => node.t === 'text' && node.lines.join(' ') === 'Absent')).toBe(true);
    expect(geometry.warnings.find(warning => warning.code === 'option-ignored')?.field).toEqual(['options', 'columnOverrides', 'zero', 'headAlign']);
  });

  // A rename that stops at the head leaves the hover calling the column by another name.
  it.each([
    ['bartable', 'total-top', 'sales'],
    ['heatmap', 'column-widths', 'q2'],
    ['status', 'column-widths', 'design'],
  ])('%s carries a renamed column into the records', (type, id, column) => {
    const { data, options } = fixture(type, id);
    const request = resolveChartRequest({ type, data, options: { ...options, columnOverrides: { [column]: { label: 'Renamed' } } } } as never);
    const records = interactionRecords({ request, geometry: requireGeometry(layoutResolvedRequest(request)), scope: request.scope, claims: [] });
    expect(records.some(record => record.label.includes('Renamed'))).toBe(true);
  });

  // A wrong id must say which ids exist, because a silent no-op looks like a broken option.
  it('warns with the id list on an id the chart does not draw', () => {
    const warning = bartable({ columnOrder: ['bars'] }).warnings.find(item => item.code === 'generated-id-unknown');
    expect(warning?.message).toContain('numbers, panels');
    // A list key takes a numeric index: the CLI resolves this path against the spec and crashed on a name.
    expect(warning?.field).toEqual(['options', 'columnOrder', 0]);
  });

  // Under one scale the scale sets the panel width, and the old panel weight refusal must not come back for a width.
  it('warns and draws when a panel width meets sharedScale or a cascade', () => {
    const shared = bartable({ sharedScale: true, columnOverrides: { sales: { width: 300 } } });
    expect(shared.refused).toBeFalsy();
    expect(shared.warnings.find(item => item.code === 'option-ignored')?.field).toEqual(['options', 'columnOverrides', 'sales', 'width']);
  });

  // A block order must not refuse a size the same table draws in its default order.
  it('keeps the default order where panels first would pass the width', () => {
    const geometry = bartable({ columnOrder: ['panels', 'numbers'], size: { width: 340, height: 300 } });
    expect(geometry.refused).toBeFalsy();
    expect(geometry.warnings.find(item => item.code === 'option-ignored')?.field).toEqual(['options', 'columnOrder']);
  });

  // totalPosition with no Total row would otherwise do nothing and say nothing.
  it('warns on totalPosition with total false', () => {
    const geometry = bartable({ total: false, totalPosition: 'top' });
    expect(geometry.warnings.find(item => item.code === 'option-ignored')?.field).toEqual(['options', 'totalPosition']);
  });

  // labels.point only stops printing: hover and the records read the marks, and the Total keeps its number.
  it('keeps the marks of values it does not print', () => {
    const geometry = bartable({ labels: { point: false } });
    expect(geometry.labels.some(label => label.id.startsWith('end:') || label.id.startsWith('part:'))).toBe(false);
    expect(geometry.labels.some(label => label.id === 'total:sales')).toBe(true);
    expect(geometry.marks.cells.filter((cell: { kind: string }) => cell.kind === 'end')).toHaveLength(8);
    expect(geometry.marks.segments).toHaveLength(16);
  });

  // A missing row needs its mark: without it, an empty bar reads as zero.
  it('keeps the missing mark of a row with labels.point false', () => {
    const data = structuredClone(stores.data) as { panels: { values: { online: (number | null)[] } }[] };
    data.panels[0]!.values.online[1] = null;
    const geometry = bartableCore.layout(data as never, { labels: { point: false }, size: { width: 760 } } as never) as Geometry<any, any>;
    expect(geometry.labels.filter(label => label.id.startsWith('end:')).map(label => label.id)).toEqual(['end:sales:east']);
  });

  // A glyph stands in the middle of its cell, but its head reads align: warn only where no head does.
  it('warns on a glyph column align only where no head reads it', () => {
    const { data, options } = fixture('heatmap', 'column-widths');
    expect(codes(heatmapCore.layout(data, options as never) as Geometry<any, any>)).not.toContain('option-ignored');
    const bubble = (columnOverrides: object) => codes(heatmapCore.layout(data, { ...options, variant: 'bubble', columnOverrides } as never) as Geometry<any, any>);
    expect(bubble({ q2: { align: 'right' } })).not.toContain('option-ignored');
    expect(bubble({ q2: { align: 'right', headAlign: 'left' } })).toContain('option-ignored');
  });
});
