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

  // A 27-row ranking on a pinned print canvas drew at the hard minimum with 16 country names dropped and still counted as drawn.
  it('dot: a pinned canvas prints every row name or refuses with the height it needs', () => {
    const codes = Array.from({ length: 27 }, (_, index) => `C${String(index + 1).padStart(2, '0')}`);
    const result = layoutResolvedRequest(resolveChartRequest({
      type: 'dot',
      data: { categories: codes.map(id => ({ id, label: id })), series: [{ id: 'debt', label: 'Gross debt', values: codes.map((_, index) => 150 - index * 4) }] },
      annotations: [{ kind: 'valueLine', id: 'average', value: 80, label: 'Average' }],
      options: { ...chrome, unit: '% of GDP', target: 'print', size: { width: 267, height: 180, unit: 'mm' } },
    } as never));
    if (result.refused) expect(result.warnings[0]?.code).toBe('size-below-floor');
    else expect(result.labels.filter(label => label.kind === 'category' && label.hidden === 'collision')).toEqual([]);
  });

  // The hard-minimum name check had also reached variance: a 280 x 250 chart that main draws (May's value in a note) turned into a refusal.
  it('variance: a small pinned canvas still draws with a month name hidden', () => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const result = layoutResolvedRequest(resolveChartRequest({
      type: 'variance',
      data: {
        categories: months.map((label, index) => ({ id: 'm' + String(index + 1).padStart(2, '0'), label })),
        series: [
          { id: 'sales', label: 'Sales', values: [104, 98, 112, 107, 96, 118, 121, 89, 114, 109, 125, 131] },
          { id: 'py', label: 'Prior year', role: 'reference', scenario: 'PY', values: [101, 103, 105, 102, 99, 111, 116, 95, 108, 112, 119, 124] },
        ],
      },
      options: { variant: 'absolute', variance: { of: 'sales', vs: 'py' }, labelDensity: 'smart', title: 'Sales beat the prior year in eight months; Feb, May, Aug and Oct fell short', subtitle: { measure: 'Sales vs PY', period: 'FY25 by month', scenarios: ['AC', 'PY'] }, unit: '$m', target: 'report', size: { width: 280, height: 250 } },
    } as never));
    expect(result.refused).toBeFalsy();
  });

  // Adding the dot's name check to the grid probes turned the size refusal of a pinned grid of dot panels into a false label-collision refusal.
  it('grid of dot panels: a pinned canvas that is too short refuses with the size it needs', () => {
    const codes = Array.from({ length: 27 }, (_, index) => 'C' + String(index + 1).padStart(2, '0'));
    const data = { categories: codes.map(id => ({ id, label: id })), series: [{ id: 'debt', label: 'Gross debt', values: codes.map((_, index) => 150 - index * 4) }] };
    const result = layoutResolvedRequest(resolveChartRequest({
      type: 'grid',
      data: { panels: [0, 1].map(column => ({ id: 'p' + column, type: 'dot', title: 'Panel ' + column, row: 0, column, data, options: { variant: 'dot' } })) },
      options: { title: 'Panels', source: 'Invented', columns: 2, sharedAxis: 'none', legend: 'none', size: { width: 900, height: 500 } },
    } as never));
    expect(result.refused).toBe(true);
    expect(result.warnings[0]?.code).toBe('size-below-floor');
  });
});
