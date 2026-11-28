import { expect, it } from 'vitest';
import '../src/core/charts';
import { accessibleDataTable } from '../src/core/a11y/accessibility';
import { getChartSchemas } from '../src/core/registry';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { requireGeometry } from '../src/core/sizing';
import type { Category } from '../src/core/types/data';
import type { BarOptions } from '../src/core/types/options';
import { cardOptions, hoverModel } from '../src/react/hover/engine';
import { labelCardContent } from '../src/react/hover/labelCard';

const types = ['column', 'bar'] as const;

function fiscalYears(groups: string[]) {
  return groups.flatMap((group, i) => ['FY24', 'FY25'].map(label => ({ id: label + i, label, group })));
}

function draw(type: typeof types[number], categories: Category[], width = 960, options: BarOptions = {}) {
  const series = [{ id: 'north', values: categories.map((_, i) => 10 + i) }, { id: 'south', values: categories.map(() => 5) }];
  const request = resolveChartRequest({ type, data: { categories, series }, options: { variant: 'stacked', size: { width, height: 400 }, ...options } });
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
    const { geometry, request } = draw(type, categories);
    const ticks = geometry.axes.find(axis => axis.axis === (type === 'column' ? 'x' : 'y'))!.ticks;
    const step = ticks[1]!.pos - ticks[0]!.pos;
    const intervals = [1, 1.5, 1, 1, 1.75, 1, 1];
    intervals.forEach((steps, i) => expect((ticks[i + 1]!.pos - ticks[i]!.pos) / step).toBeCloseTo(steps));
    const names = geometry.labels.filter(label => label.id.startsWith('category-group:') && !label.hidden);
    expect(names.map(label => label.text)).toEqual(['Q1', 'Q2', 'Q1', 'Q3', 'Q4', 'Q4']);
    for (const group of ['', '   ']) {
      const data = { ...request.data, categories: [{ ...categories[0], group }, ...categories.slice(1)] };
      expect(getChartSchemas(type)!.dataSchema.safeParse(data).success).toBe(false);
    }
  }
});

// A long group name must fit beside the stack names without hiding or shortening any of them.
it('wraps group names, shortens only the overflow and preserves the stack names’ room', () => {
  const spring = 'Spring orders rise';
  const autumn = 'Autumn orders, renewals and subscription upgrades from returning customers across every international sales territory in the previous financial year';
  const categories = fiscalYears([spring, autumn, 'Q3', 'Q4']);
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
  const categories = [{ id: 'a', label: 'FY24', group: 'Q1' }, { id: 'b', label: 'FY24', group: 'Q2' }];
  const tornado = draw('bar', categories, 960, { variant: 'tornado', baseValue: 8, tornado: { low: 'south', high: 'north' } });
  for (const { request, geometry } of [draw('column', categories), draw('bar', categories), tornado]) {
    const model = hoverModel(request, geometry);
    const first = model.records.find(record => record.target.owner.categoryId === 'a')!;
    expect(labelCardContent(first, undefined, cardOptions(model, request, first)).rows[0]!.text).toBe('FY24 Q1');
    expect(accessibleDataTable(model.records).rows.map(row => row.header).sort()).toEqual(['FY24 Q1', 'FY24 Q2']);
  }
});

// A separate group row used to hide all twelve stack names on a 320 px column chart.
it('draws each fiscal year with its quarter when the names have to rotate', () => {
  const categories = fiscalYears(['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6']);
  const { geometry } = draw('column', categories, 320, { title: 'T' });
  const names = categories.map(cat => geometry.labels.find(label => label.id === `category:${cat.id}` && !label.hidden)?.lines.join(' '));
  expect(names).toEqual(categories.map(cat => `${cat.label} ${cat.group}`));
  expect(geometry.labels.some(label => label.id.startsWith('category-group:'))).toBe(false);
});

// A group column used to push a long category-axis title past the right edge of a bar chart.
it('keeps the bar category-axis title above grouped rows', () => {
  const categories = fiscalYears(['Online sales', 'Retail stores', 'Partner sales', 'Other channels']);
  const title = 'New and returning customers by acquisition channel';
  const { geometry } = draw('bar', categories, 320, { size: { width: 320, height: 540 }, categoryAxis: { title } });
  expect(geometry.labels.find(label => label.id === 'axis:category:title' && !label.hidden)?.lines).toEqual([title]);
});

// Turning category labels off used to leave the group names on the chart and take space from the plot.
it('releases the group label space when categories are hidden', () => {
  const categories = fiscalYears(['Q1', 'Q2', 'Q3', 'Q4']);
  const plain = categories.map(({ group, ...cat }, i) => ({ ...cat, gapAfter: i % 2 === 1 && i < categories.length - 1 }));
  const options = { labels: { category: false } };
  for (const type of types) {
    const { geometry } = draw(type, categories, 960, options);
    expect(geometry.labels.filter(label => label.kind === 'category')).toHaveLength(0);
    expect(geometry.plot).toEqual(draw(type, plain, 960, options).geometry.plot);
  }
});
