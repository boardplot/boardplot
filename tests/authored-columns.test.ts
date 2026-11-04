import { describe, expect, it } from 'vitest';
import { bartableCore } from '../src/core/charts/bartable/core';
import { getFixtures } from '../src/fixtures';
import { heatmapCore } from '../src/core/charts/heatmap/core';
import { statusCore } from '../src/core/charts/status/core';
import type { Geometry } from '../src/core/types/scene';

const fixture = (type: string, id: string) => getFixtures(type).find(item => item.id === id)! as unknown as { data: never; options: Record<string, unknown> };
const codes = (geometry: { warnings: { code: string }[] }) => geometry.warnings.map(warning => warning.code);
const stores = fixture('bartable', 'total-top');
const bartable = (options: Record<string, unknown>) => bartableCore.layout(stores.data, { size: { width: 760 }, ...options } as never) as Geometry<any, any>;

describe('authored column settings', () => {
  // An authored width must never refuse: a wide one stops at the floor of the other parts and says so.
  it.each([
    ['bartable', bartableCore, 'column-widths'],
    ['heatmap', heatmapCore, 'column-widths'],
    ['status', statusCore, 'column-widths'],
  ] as const)('%s caps a width wider than its plot and still draws', (type, core, id) => {
    const { data, options } = fixture(type, id);
    const geometry = (core.layout as (d: never, o: never) => Geometry<any, any>)(data, { ...options, columnOverrides: { label: { width: 4000 } }, size: { width: 620 } } as never);
    expect(geometry.refused).toBeFalsy();
    expect(codes(geometry)).toContain('column-width-capped');
    expect(geometry.sizing!.minWidth).toBeLessThanOrEqual(620);
  });

  // A wrong id must say which ids exist, because a silent no-op looks like a broken option.
  it('warns with the id list on an id the chart does not draw', () => {
    const warning = bartable({ columnOrder: ['bars'] }).warnings.find(item => item.code === 'generated-id-unknown');
    expect(warning?.message).toContain('numbers, panels');
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

  // A glyph stands in the middle of its cell, so aligning it must warn instead of doing nothing.
  it('warns on a cell alignment a glyph matrix has no text for', () => {
    const { data, options } = fixture('heatmap', 'column-widths');
    expect(codes(heatmapCore.layout(data, options as never) as Geometry<any, any>)).not.toContain('option-ignored');
    expect(codes(heatmapCore.layout(data, { ...options, variant: 'bubble' } as never) as Geometry<any, any>)).toContain('option-ignored');
  });
});
