import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import type { Geometry } from '../src/core/types/scene';

const names = [
  'Passed-on freight charges, net', 'Other operating expenses and levies', 'Foreign logistics subcontracting',
  'Research and development expenses', 'Change in net working capital', 'Net revenue retention, enterprise',
  'Expenses for purchased trade goods', 'Average order value, marketplace',
];
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const chrome = { title: 'Position by unit', subtitle: { measure: 'Position by unit', period: 'FY26' }, source: 'Invented data' };
const draw =(type: 'dot' | 'status', data: unknown, options: object): Geometry => {
  const geometry = layoutResolvedRequest(resolveChartRequest({ type, data, options: { target: 'slide', ...options } } as never));
  if (geometry.refused) throw new Error('refused');
  return geometry;
};
const rowNames = (geometry: Geometry, kind: 'category' | 'series') => geometry.labels.filter(label => label.kind === kind && !label.hidden);

describe('row names on a pinned height', () => {
  // A half-width slide chart cut most names to one line with an ellipsis, though the row pitch held two lines of a 12 pt name.
  it('dot: draws every name on two lines in a smaller font before it cuts one', () => {
    const geometry = draw('dot', {
      categories: names.map(label => ({ id: slug(label), label })),
      series: [
        { id: 'a', label: 'Other services, domestic market', values: [9.4, 9.2, 8.6, 9.1, 10.1, 9.5, 10.4, 11] },
        { id: 'b', label: 'Subscription revenue, monthly plans', values: [8.7, 7.9, 8.3, 9.2, 8.5, 8.6, 8.6, 8] },
      ],
    }, { ...chrome, unit: '%', variant: 'dumbbell', size: { width: 576, height: 528 } });
    const labels = rowNames(geometry, 'category');
    expect(labels).toHaveLength(8);
    expect(labels.every(label => label.title === undefined && label.lines.length <= 2)).toBe(true);
    expect(labels.some(label => label.lines.length === 2)).toBe(true);
    // The two-line name keeps clear of the next row.
    const sorted = [...labels].sort((a, b) => a.rect.y - b.rect.y);
    sorted.slice(1).forEach((label, index) => expect(label.rect.y).toBeGreaterThanOrEqual(sorted[index]!.rect.y + sorted[index]!.rect.h));
  });

  // At the same size the status rows hold two lines of the smaller name, but the role size did not fit and every name was cut.
  it('status: wraps names in a smaller font when the role size does not fit two lines', () => {
    const geometry = draw('status', {
      rows: names.map(label => ({ id: slug(label), label })),
      columns: Array.from({ length: 12 }, (_, index) => ({ id: `2024-${String(index + 1).padStart(2, '0')}`, label: `M${index + 1}` })),
      cells: names.flatMap(label => Array.from({ length: 12 }, (_, index) => ({
        row: slug(label), col: `2024-${String(index + 1).padStart(2, '0')}`, state: ['g', 'a', 'r'][(index + label.length) % 3]!,
      }))),
    }, {
      ...chrome, size: { width: 576, height: 528 },
      states: [{ id: 'g', label: 'On track', tone: 'good' }, { id: 'a', label: 'At risk', tone: 'warn' }, { id: 'r', label: 'Off track', tone: 'bad' }],
    });
    const labels = rowNames(geometry, 'series');
    expect(labels).toHaveLength(8);
    expect(labels.every(label => label.title === undefined)).toBe(true);
    expect(labels.some(label => label.lines.length === 2)).toBe(true);
  });
});
