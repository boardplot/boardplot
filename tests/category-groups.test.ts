import { expect, it } from 'vitest';
import '../src/core/charts';
import { accessibleDataTable } from '../src/core/a11y/accessibility';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { requireGeometry } from '../src/core/sizing';
import type { Category } from '../src/core/types/data';
import { cardOptions, hoverModel } from '../src/react/hover/engine';
import { labelCardContent } from '../src/react/hover/labelCard';

const types = ['column', 'bar'] as const;

function draw(type: typeof types[number], categories: Category[], width = 960) {
  const series = [{ id: 'north', values: categories.map((_, i) => 10 + i) }, { id: 'south', values: categories.map(() => 5) }];
  const request = resolveChartRequest({ type, data: { categories, series }, options: { variant: 'stacked', size: { width, height: 400 } } });
  return { request, geometry: requireGeometry(layoutResolvedRequest(request)) };
}

// Neighbouring groups need a visible boundary unless the author chose a different gap.
it('uses a half step at group changes and honours explicit gaps, including zero and false', () => {
  const categories = [
    { id: 'a', group: 'Q1' }, { id: 'b', group: 'Q1' }, { id: 'c', group: 'Q2', gapAfter: 0 },
    { id: 'd', group: 'Q1', gapAfter: false }, { id: 'e', group: 'Q3', gapAfter: 0.75 },
    { id: 'f', group: 'Q4' }, { id: 'g' }, { id: 'h', group: 'Q4' },
  ];
  for (const type of types) {
    const { geometry } = draw(type, categories);
    const ticks = geometry.axes.find(axis => axis.axis === (type === 'column' ? 'x' : 'y'))!.ticks;
    const step = ticks[1]!.pos - ticks[0]!.pos;
    const intervals = [1, 1.5, 1, 1, 1.75, 1, 1];
    intervals.forEach((steps, i) => expect((ticks[i + 1]!.pos - ticks[i]!.pos) / step).toBeCloseTo(steps));
    const names = geometry.labels.filter(label => label.id.startsWith('category-group:') && !label.hidden);
    expect(names.map(label => label.text)).toEqual(['Q1', 'Q2', 'Q1', 'Q3', 'Q4', 'Q4']);
  }
});

// A long group name must fit beside the stack names without hiding or shortening any of them.
it('wraps group names, shortens only the overflow and preserves the stack names’ room', () => {
  const spring = 'Spring orders rise';
  const autumn = 'Autumn orders, renewals and subscription upgrades from returning customers across every international sales territory in the previous financial year';
  const categories = [spring, autumn, 'Q3', 'Q4'].flatMap((group, i) => ['FY24', 'FY25'].map(label => ({ id: label + i, label, group })));
  for (const type of types) {
    const { geometry } = draw(type, categories, 320);
    const groups = geometry.labels.filter(label => label.id.startsWith('category-group:') && !label.hidden);
    expect(groups).toHaveLength(4);
    expect(groups[0]!.lines.length).toBeGreaterThan(1);
    expect(groups[0]!.lines.join(' ')).toBe(spring);
    expect(groups[1]!.lines.length).toBeGreaterThan(1);
    expect(groups[1]!.lines.at(-1)).toMatch(/…$/);
    expect(groups[1]!.title).toBe(autumn);

    const shortGroups = draw(type, categories.map((cat, i) => ({ ...cat, group: `Q${1 + Math.floor(i / 2)}` })), 320);
    const names = (chart: typeof geometry) => chart.labels.filter(label => label.id.startsWith('category:') && !label.hidden)
      .map(label => [label.id, label.lines, label.rect.w, label.rect.h]);
    expect(names(geometry)).toHaveLength(categories.length);
    expect(names(geometry)).toEqual(names(shortGroups.geometry));
    expect(geometry.labels.filter(label => label.id.startsWith('category:')).every(label => label.lines.join(' ') === label.text)).toBe(true);
  }
});

// The quarter must identify each fiscal year in the hover card and the accessible data table.
it('reads the stack name followed by its group in the card and table', () => {
  for (const type of types) {
    const { request, geometry } = draw(type, [{ id: 'a', label: 'FY24', group: 'Q1' }, { id: 'b', label: 'FY24', group: 'Q2' }]);
    const model = hoverModel(request, geometry);
    const first = model.records.find(record => record.target.owner.categoryId === 'a')!;
    expect(labelCardContent(first, undefined, cardOptions(model, request, first)).rows[0]!.text).toBe('FY24 Q1');
    expect(accessibleDataTable(model.records).rows.map(row => row.header)).toEqual(['FY24 Q1', 'FY24 Q2']);
  }
});
