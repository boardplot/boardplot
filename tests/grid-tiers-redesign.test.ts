import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { getChart } from '../src/core/registry';
import { getFixtures } from '../src/fixtures';
import { layoutResolvedRequest, measure, resolveChartRequest } from '../src/index';
import type { Geometry, Paint } from '../src/core/types/scene';
import { paintColor, registerTheme, resolveTheme } from '../src/core/theme';
import { layoutGrid } from '../src/core/charts/grid/layout';
import { renderSvg } from '../src/core/svg/renderSvg';
import { contrastRatio } from '../src/core/color';

/**
 * grid.tiers: a stacked column under a ΔPY% tier on a 320 px card.
 * The stack uses most of the card, every APAC value is drawn or cued, the growth values
 * sit clear of the pins, the APAC segment does not cross the PY tick and no tone is keyed
 * that no pin draws.
 */
const categories = ['Q1', 'Q2', 'Q3', 'Q4'].map((label) => ({ id: label.toLowerCase(), label }));
const series = [
  { id: 'amer', label: 'AMER', values: [45, 48, 51, 55] },
  { id: 'emea', label: 'EMEA', values: [30, 29, 27, 26] },
  { id: 'apac', label: 'APAC', values: [12, 14, 15, 17] },
  { id: 'py', label: 'PY', scenario: 'PY' as const, role: 'reference' as const, values: [82, 86, 88, 90] },
];
const data = { categories, series };
const geometry = getChart('grid')!.layout({
  panels: [
    { id: 'rev', type: 'column', data, options: { variant: 'stacked', labels: { annotation: false, tick: false } } },
    { id: 'dpy', type: 'variance', data, options: { variant: 'relative', variance: { vs: 'py' }, valueAxis: { show: true } } },
  ],
}, {
  size: { width: 320 }, sharedAxis: 'category', legend: 'top', locale: 'en',
  title: 'Revenue up 7% vs PY despite continued EMEA decline',
  subtitle: { company: 'Acme Corp', measure: 'Revenue', period: 'FY25 by quarter', scenarios: ['AC', 'PY'] },
}) as Geometry;
const node = (id: string) => geometry.scene.find((n) => n.id === id) as Record<string, number> | undefined;

describe('grid.tiers at 320 px, automatic height', () => {
  it('prints every segment value: the card grows for the column tier', () => {
    const segments = geometry.labels.filter((label) => label.id.startsWith('rev/segment:'));
    expect(segments).toHaveLength(12);
    expect(segments.filter((label) => label.hidden)).toEqual([]);
  });

  it('centres each growth value over its pin head', () => {
    // Scene nodes keep panel coordinates; placed labels are on the grid canvas.
    const { offset } = (geometry.marks as { panels: { id: string; chart?: { offset: { x: number; y: number } } }[] })
      .panels.find((panel) => panel.id === 'dpy')!.chart!;
    for (const { id } of categories) {
      const pin = node(`dpy/mark:head:${id}`)!;
      const head = { cx: pin.cx! + offset.x, cy: pin.cy! + offset.y, r: pin.r! };
      const label = geometry.labels.find((l) => l.id === `dpy/point:${id}`)!;
      expect(label.hidden).toBeUndefined();
      expect(Math.abs(label.rect.x + label.rect.w / 2 - head.cx)).toBeLessThan(1);
      expect(label.rect.y + label.rect.h).toBeLessThan(head.cy - head.r);
    }
  });

  it('draws the PY tick outside the right edge of the column', () => {
    for (const { id } of categories) {
      const column = node(`rev/mark:apac:${id}`) as unknown as { rect: { x: number; w: number } };
      const tick = node(`rev/ref:py:${id}`)!;
      expect(Math.min(tick.x1!, tick.x2!)).toBeGreaterThanOrEqual(column.rect.x + column.rect.w - 0.01);
    }
  });

  it('keys only the tone the pins draw', () => {
    const keys = geometry.scene.filter((n) => n.part === 'legendLabel').map((n) => (n as { lines: string[] }).lines.join(' '));
    expect(keys).toContain('Better than PY');
    expect(keys).not.toContain('Worse than PY');
  });
});

// On a dense card the outside PY tick reached into the next column's stack
// and read as that column's mark. It must stop short of the next column.
describe('outside PY tick on a dense stacked column card', () => {
  it('never enters the next column at 320 px with 12 categories', () => {
    const months = Array.from({ length: 12 }, (_, i) => ({ id: `m${i + 1}`, label: `M${i + 1}` }));
    const vals = (base: number) => months.map((_, i) => base + i);
    const dense = getChart('column')!.layout({
      categories: months,
      series: [
        { id: 'a', label: 'A', values: vals(20) },
        { id: 'b', label: 'B', values: vals(10) },
        { id: 'py', label: 'PY', scenario: 'PY' as const, role: 'reference' as const, values: vals(28) },
      ],
    }, { variant: 'stacked', labels: { annotation: false, tick: false }, size: { width: 320, height: 300 }, title: 'T' }) as Geometry;
    const find = (id: string) => dense.scene.find((n) => n.id === id) as unknown as { rect: { x: number; w: number }; x1: number; x2: number };
    for (let i = 0; i < 11; i++) {
      const tick = find(`ref:py:${months[i]!.id}`);
      const next = find(`mark:a:${months[i + 1]!.id}`);
      expect(Math.max(tick.x1, tick.x2)).toBeLessThan(next.rect.x);
    }
  });
});

// The layout rules for one tier (3:1 split, growth, values over the heads)
// must not cost a three-panel grid its APAC values at a pinned canvas, and must not lay it out
// again at automatic height when the initial layout printed every value.
describe('a grid of two variance tiers keeps the column room', () => {
  const fixture = (id: string) => getFixtures('grid').find((f) => f.id === id)! as { data: unknown; options: Record<string, unknown> };
  it('prints every APAC value of compact-tier-slack at its pinned 720 x 471 px', () => {
    const { data, options } = fixture('compact-tier-slack');
    const pinned = getChart('grid')!.layout(data, { ...options, size: { width: 720, height: 471 } }) as Geometry;
    const apac = pinned.labels.filter((label) => label.id.startsWith('rev/segment:apac:'));
    expect(apac).toHaveLength(4);
    expect(apac.filter((label) => label.hidden)).toEqual([]);
  });

  it('does not grow three-tier at 960 px, where every value prints at 540 px', () => {
    const { data, options } = fixture('three-tier');
    const auto = getChart('grid')!.layout(data, { ...options, size: { width: 960 } }) as Geometry;
    expect(auto.size.height).toBe(540);
  });
});

// At automatic height a tier grid hid segment values
// that the column alone prints. A two-panel card with 8-10% segments hid four at 320 px (the tier
// height left out the stacked-column reserve), and three-tier hid six.
describe('tier grids at automatic height print the segment values the column alone prints', () => {
  const values = (geometry: Geometry) => geometry.labels.filter((label) => label.id.startsWith('rev/segment:'));
  it('grows a two-panel card by the stacked-column reserve when a segment value hides', () => {
    const small = { categories, series: [
      { id: 'core', label: 'Core', values: [80, 82, 85, 88] },
      { id: 'services', label: 'Services', values: [12, 13, 12, 14] },
      { id: 'other', label: 'Other', values: [9, 8, 10, 9] },
      { id: 'py', label: 'PY', scenario: 'PY' as const, role: 'reference' as const, values: [95, 97, 99, 101] },
    ] };
    const card = measure({ type: 'grid', data: { panels: [
      { id: 'rev', type: 'column', data: small, options: { variant: 'stacked', labels: { annotation: false, tick: false } } },
      { id: 'dpy', type: 'variance', data: small, options: { variant: 'relative', variance: { vs: 'py' }, valueAxis: { show: true } } },
    ] }, options: { sharedAxis: 'category', legend: 'top', title: 'Revenue by line', size: { width: 320 } } }).geometry as unknown as Geometry;
    expect(values(card)).toHaveLength(12);
    expect(values(card).filter((label) => label.hidden)).toEqual([]);
  });

  it('grows three-tier at 320 px', () => {
    const { data, options } = getFixtures('grid').find((f) => f.id === 'three-tier')! as { data: unknown; options: Record<string, unknown> };
    const auto = measure({ type: 'grid', data, options: { ...options, size: { width: 320 } } } as never).geometry as unknown as Geometry;
    expect(values(auto)).toHaveLength(12);
    expect(values(auto).filter((label) => label.hidden)).toEqual([]);
  });
});

// With segments too small for the reserve, three tiers grew a 320 px card from about
// 340 to 530 px and still hid every small value. Growth that prints nothing keeps the initial height
// (385 px with the room above the two lower tier headings).
it('keeps the compact height of three tiers whose small values no growth can print', () => {
  const cats = [{ id: 'fy24', label: 'FY24' }, { id: 'fy25', label: 'FY25' }];
  const small = { categories: cats, series: [
    { id: 'core', label: 'Core', values: [90, 94] }, { id: 'x', label: 'X', values: [5, 4] }, { id: 'y', label: 'Y', values: [7, 6] },
    { id: 'py', label: 'PY', scenario: 'PY' as const, role: 'reference' as const, values: [98, 100] },
  ] };
  const card = measure({ type: 'grid', data: { panels: [
    { id: 'rev', type: 'column', data: small, options: { variant: 'stacked', labels: { annotation: false, tick: false } } },
    { id: 'dabs', type: 'variance', data: small, options: { variant: 'absolute', variance: { vs: 'py' } } },
    { id: 'dpct', type: 'variance', data: small, options: { variant: 'relative', variance: { vs: 'py' } } },
    { id: 'dpct2', type: 'variance', data: small, options: { variant: 'relative', variance: { vs: 'py' } } },
  ] }, options: { sharedAxis: 'category', legend: 'top', title: 'Revenue', size: { width: 320 } } }).geometry as unknown as Geometry;
  expect(card.size.height).toBeLessThan(410);
});

// A value the author withholds (label: false) counted as a value growth could print,
// so 1% slivers beside withheld 8% segments grew a 320 px card from about 300 to 485 px for nothing.
it('does not grow tiers for a value the author withholds', () => {
  const cats = [{ id: 'fy24', label: 'FY24' }, { id: 'fy25', label: 'FY25' }];
  const data = { categories: cats, series: [
    { id: 'core', label: 'Core', values: [91, 92] }, { id: 'x', label: 'X', values: [{ number: 8, label: false as const }, { number: 8, label: false as const }] },
    { id: 'y', label: 'Y', values: [1, 1] }, { id: 'py', label: 'PY', scenario: 'PY' as const, role: 'reference' as const, values: [95, 97] },
  ] };
  const card = measure({ type: 'grid', data: { panels: [
    { id: 'rev', type: 'column', data, options: { variant: 'stacked', labels: { annotation: false, tick: false } } },
    { id: 'dabs', type: 'variance', data, options: { variant: 'absolute', variance: { vs: 'py' } } },
    { id: 'dpct', type: 'variance', data, options: { variant: 'relative', variance: { vs: 'py' } } },
  ] }, options: { sharedAxis: 'category', legend: 'top', title: 'Revenue', size: { width: 320 } } } as never).geometry as unknown as Geometry;
  expect(card.size.height).toBeLessThan(340);
});

// The narrower default column keeps room for the segment values: without
// the width floor, stacked-series-cagr at 480 px would drop 16 of the 24 segment values.
it('keeps the segment values on a narrower stacked column at 480 px', () => {
  const fixture = getFixtures('column').find((f) => f.id === 'stacked-series-cagr')!;
  const result = getChart('column')!.layout(fixture.data as never, { ...fixture.options, size: { width: 480 } } as never) as Geometry;
  expect(result.labels.filter((label) => label.kind === 'segment' && !label.hidden)).toHaveLength(24);
});

// The growth value takes its pin's tone, never the sign. A cost rise
// under lowerIsBetter is bad; a sign-based colour would print it green.
describe('variance growth values print in the pin tone', () => {
  it('prints a cost increase under lowerIsBetter bold in the bad tone', () => {
    const cost = getChart('variance')!.layout({
      categories: [{ id: 'q1', label: 'Q1' }, { id: 'q2', label: 'Q2' }],
      series: [
        { id: 'ac', label: 'Cost', direction: 'lowerIsBetter', values: [110, 90] },
        { id: 'py', label: 'PY', scenario: 'PY', role: 'reference', values: [100, 100] },
      ],
    }, { variant: 'relative', variance: { vs: 'py' }, size: { width: 480 }, locale: 'en' }) as Geometry;
    const text = (id: string) => cost.scene.find((n) => n.id === id) as unknown as { ink: unknown; font: { weight: number } };
    expect(text('label:point:q1')).toMatchObject({ ink: { theme: { kind: 'series-text', base: { token: 'bad' } } }, font: { weight: 600 } });
    expect(text('label:point:q2')).toMatchObject({ ink: { theme: { kind: 'series-text', base: { token: 'good' } } }, font: { weight: 600 } });
  });

  // standard's good and bad read 3.38 and 3.71 on its page: as text they must reach the 4.5:1 floor.
  it('keeps the tone text at 4.5:1 or more under the standard preset', () => {
    const geometry = getChart('variance')!.layout({
      categories: [{ id: 'up', label: 'Up' }, { id: 'down', label: 'Down' }],
      series: [
        { id: 'ac', label: 'AC', values: [110, 90] },
        { id: 'py', label: 'PY', scenario: 'PY', role: 'reference', values: [100, 100] },
      ],
    }, { variant: 'relative', variance: { vs: 'py' }, theme: 'standard', size: { width: 480 }, locale: 'en' }) as Geometry;
    const standard = resolveTheme('standard');
    for (const id of ['label:point:up', 'label:point:down']) {
      const ink = (geometry.scene.find((n) => n.id === id) as unknown as { ink: Paint }).ink;
      expect(contrastRatio(paintColor(standard, ink), standard.color.background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

// The column above a forecast quarter hatches, while its growth tier drew the same solid mark as an actual quarter.
describe('a grid variance tier hatches its forecast categories', () => {
  const forecast = { ...data, series: series.map((s) => s.role === 'reference' ? s : {
    ...s, values: s.values.map((v, i) => i < 2 ? v : { number: v, scenario: 'FC' as const }),
  }) };
  const tier = (variant: 'relative' | 'absolute', body = forecast) => getChart('grid')!.layout({
    panels: [
      { id: 'rev', type: 'column', data: body, options: { variant: 'stacked' } },
      { id: 'dpy', type: 'variance', data: body, options: { variant, variance: { vs: 'py' } } },
    ],
  }, { size: { width: 480 }, sharedAxis: 'category', locale: 'en' }) as Geometry;
  const mark = (g: Geometry, id: string) => g.scene.find((n) => n.id === id) as unknown as { fill: Paint; pattern?: string };

  it('draws forecast pin heads hollow and actual ones solid', () => {
    const g = tier('relative');
    expect(mark(g, 'dpy/mark:head:q2').fill).not.toEqual({ token: 'background' });
    expect(mark(g, 'dpy/mark:head:q3').fill).toEqual({ token: 'background' });
    expect(mark(g, 'dpy/mark:head:q4').fill).toEqual({ token: 'background' });
  });

  it('hatches forecast bars of the absolute tier', () => {
    const g = tier('absolute');
    expect(mark(g, 'dpy/mark:delta:q2').pattern).toBeUndefined();
    expect(mark(g, 'dpy/mark:delta:q4').pattern).toBe('hatch45');
  });

  it('keeps every mark solid when no category is forecast', () => {
    const g = tier('relative', data);
    expect(mark(g, 'dpy/mark:head:q4').fill).not.toEqual({ token: 'background' });
  });
});

// A combo panel over a line panel with anchors.categories 'all' put the category centres 3.3 px apart:
// the plot edges matched, but combo insets its bands inside the plot. Aligning the centres then moved
// a panel's plot edge, so the axis lines of the stacked panels no longer lined up.
describe('grid anchors.categories across panel types', () => {
  const plotEdges = (geometry: Geometry) => ((geometry.marks as { panels?: { type: string; plot: { x: number; w: number } }[] }).panels ?? [])
    .filter((panel) => panel.type !== 'text' && panel.type !== 'legend')
    .map((panel) => [panel.plot.x, panel.plot.x + panel.plot.w]);
  it('puts a combo and a line panel on the same category centres', () => {
    const quarters = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'].map((id) => ({ id, label: id.toUpperCase() }));
    const layout = (anchors: object) => getChart('grid')!.layout({
      panels: [
        { id: 'top', type: 'combo', row: 0, column: 0, data: { categories: quarters, series: [
          { id: 'rev', label: 'Revenue', kind: 'column', values: [10, 12, 14, 13, 15, 17] },
          { id: 'm', label: 'Margin', kind: 'line', axis: 'secondary', values: [0.2, 0.22, 0.21, 0.25, 0.24, 0.26] },
        ] }, options: { title: false, secondaryAxis: { acknowledge: true } } },
        { id: 'bot', type: 'line', row: 1, column: 0, data: { categories: quarters, series: [
          { id: 'u', label: 'Users', values: [100, 120, 110, 130, 150, 160] },
        ] }, options: { title: false } },
      ],
    }, { columns: [1], rows: [1, 1], anchors }) as Geometry;
    const edgeKeys = (geometry: Geometry) => Object.keys((geometry.derived as { sharedAnchors?: object }).sharedAnchors ?? {}).filter((key) => key.startsWith('plotEdges:'));
    for (const anchors of [{ plotEdges: 'all', categories: 'all' }, { categories: 'all' }]) {
      const grid = layout(anchors);
      const [top, bottom] = grid.axes.filter((axis) => axis.axis === 'x').map((axis) => axis.ticks.map((tick) => tick.pos));
      expect(bottom!.map((pos, index) => Math.abs(pos - top![index]!))).toEqual(bottom!.map(() => expect.closeTo(0, 2)));
      // The panels place their categories inside one plot: the edges hold, so the grid keeps them and does not warn.
      const [a, b] = plotEdges(grid);
      expect(b![0]).toBeCloseTo(a![0]!, 2);
      expect(b![1]).toBeCloseTo(a![1]!, 2);
      expect(grid.warnings.map((warning) => warning.code)).not.toContain('grid-anchor-incompatible');
      expect(edgeKeys(grid).length).toBeGreaterThan(0);
    }
  });

  // On a phone, a line panel's end label pulled its last point in, and aligning the column and variance
  // panels to it took up to 33 px off their plots on the right; each panel label also started at its own
  // tick-label width, 15 px apart. With plotEdges alone, the line points sat up to 30 px beside their columns.
  it.each([{ plotEdges: 'all', categories: 'all' }, { plotEdges: 'all' }])('keeps one plot, one panel-label x and the line points on the column centres at 375 px (%o)', (anchors) => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'].map((label) => ({ id: label.toLowerCase(), label }));
    const revenue = [52000, 61000, 58000, 66000, 71000, 69000, 76000, 80000];
    const grid = layoutResolvedRequest(resolveChartRequest({
      type: 'grid',
      data: { panels: [
        { id: 'rev', type: 'column', title: 'Revenue', data: { categories: months, series: [
          { id: 'ac', label: 'AC', scenario: 'AC', values: revenue },
          { id: 'py', label: 'PY', scenario: 'PY', role: 'reference', values: revenue.map((value) => value - 4000) },
        ] }, options: { unit: '$', valueAxis: { show: true }, valueLabels: 'none' } },
        { id: 'dpy', type: 'variance', title: 'ΔPY', data: { categories: months, series: [
          { id: 'ac', label: 'AC', scenario: 'AC', values: revenue },
          { id: 'py', label: 'PY', scenario: 'PY', role: 'reference', values: revenue.map((value) => value - 4000) },
        ] }, options: { variant: 'absolute', variance: { vs: 'py' } } },
        { id: 'basket', type: 'line', title: 'Average basket', data: { categories: months, series: [
          { id: 'basket', label: 'Basket', values: [3120, 3180, 3050, 3290, 3340, 3210, 3420, 3480] },
        ] }, options: { unit: '$', valueAxis: { show: true } } },
      ] },
      options: { sharedAxis: 'category', sharedScale: false, anchors, size: { width: 375, height: 640 } },
    })) as Geometry;
    expect(grid.refused).toBeUndefined();
    const edges = plotEdges(grid);
    expect(edges).toHaveLength(3);
    for (const [left, right] of edges) {
      expect(left).toBeCloseTo(edges[0]![0]!, 2);
      expect(right).toBeCloseTo(edges[0]![1]!, 2);
    }
    const panels = (grid.marks as { panels: { id: string; chart?: { offset: { x: number }; geometry: Geometry } }[] }).panels;
    const centres = (id: string) => {
      const panel = panels.find((candidate) => candidate.id === id)!;
      return panel.chart!.geometry.axes.find((axis) => axis.axis === 'x')!.ticks.map((tick) => tick.pos + panel.chart!.offset.x);
    };
    for (const id of ['dpy', 'basket']) expect(centres(id).map((pos, index) => pos - centres('rev')[index]!)).toEqual(months.map(() => expect.closeTo(0, 2)));
    const labelX = ['rev', 'dpy', 'basket'].map((id) => {
      const node = grid.scene.find((candidate) => candidate.t === 'text' && candidate.id.endsWith(`panel:${id}:title`)) as { x: number; tx?: number };
      return node.x + (node.tx ?? 0);
    });
    expect(labelX).toEqual(labelX.map(() => expect.closeTo(labelX[0]!, 2)));
    // The variance zero line runs under the moved categories to the plot edge, as the gridlines do.
    const zero = grid.scene.find((node) => node.t === 'line' && node.part === 'baseline' && node.id.startsWith('dpy/')) as { x2: number; tx?: number };
    expect(zero.x2 + (zero.tx ?? 0)).toBeGreaterThan(edges[0]![1]! - 3);
    expect(grid.warnings.map((warning) => warning.code)).not.toContain('grid-anchor-incompatible');
  });

  // An area keeps room outside its plot for its edge labels, and that room follows the category inset:
  // under the shared axis alone, an area over a column lost 37 px of its plot to the inset.
  it('leaves an area panel over a column panel on the shared plot edges', () => {
    const regions = ['North America', 'Eastern Europe', 'Southern Europe', 'Western Europe', 'Northern Europe', 'Latin America and Caribbean']
      .map((label, index) => ({ id: `r${index}`, label }));
    const panel = (id: string, type: string, options: Record<string, unknown>) =>
      ({ id, type, data: { categories: regions, series: [{ id, label: id, values: [20, 24, 28, 32, 36, 40] }] }, options: { valueAxis: { show: true }, ...options } });
    const grid = layoutResolvedRequest(resolveChartRequest({
      type: 'grid',
      data: { panels: [panel('c', 'column', {}), panel('l', 'line', { variant: 'area' })] },
      options: { sharedAxis: 'category', sharedScale: false, anchors: { plotEdges: 'column' }, size: { width: 480, height: 640 } },
    })) as Geometry;
    const [column, area] = plotEdges(grid);
    expect(Math.abs(area![1]! - column![1]!)).toBeLessThan(2);
    expect(grid.warnings.map((warning) => warning.code)).not.toContain('grid-anchor-incompatible');
  });

  const quarters = ['Q1', 'Q2', 'Q3', 'Q4'].map((label) => ({ id: label.toLowerCase(), label }));
  const gridOf = (panels: unknown[], options: Record<string, unknown>) => layoutResolvedRequest(resolveChartRequest({
    type: 'grid', data: { panels }, options: { sharedAxis: 'category', sharedScale: false, ...options },
  })) as Geometry;
  const printed = (grid: Geometry, panel: string, part: string) =>
    grid.scene.filter((node) => node.t === 'text' && node.opacity !== 0 && node.id.startsWith(`${panel}/`) && node.part === part).length;
  const firstCentre = (grid: Geometry, id: string) => {
    const panel = (grid.marks as { panels: { id: string; chart?: { offset: { x: number }; geometry: Geometry } }[] }).panels.find((candidate) => candidate.id === id)!;
    return panel.chart!.geometry.axes.find((axis) => axis.axis === 'x')!.ticks[0]!.pos + panel.chart!.offset.x;
  };

  // A waterfall printed the quarter names, and a column aligned without it put its Q1 column 9.7 px from Q2.
  it('leaves a grid column as before when a panel there cannot take the inset', () => {
    const grid = gridOf([
      { id: 'w', type: 'waterfall', data: { items: [{ id: 'q1', label: 'Q1', value: 50, type: 'total' }, { id: 'q2', label: 'Q2', value: 5 }, { id: 'q3', label: 'Q3', value: -2 }, { id: 'q4', label: 'Q4', value: 5 }] }, options: { valueAxis: { show: true } } },
      { id: 'r', type: 'line', data: { categories: quarters, series: [{ id: 'n', label: 'North', values: [25, 32, 15, 22] }, { id: 's', label: 'South', values: [12, 23, 34, 15] }] },
        options: { valueAxis: { show: true }, variant: 'bump', valueLabels: 'last', seriesLabels: 'end', legend: 'none', labels: { category: false } } },
      { id: 'c', type: 'column', data: { categories: quarters, series: [{ id: 'n', label: 'North', values: [14, 21, 28, 35] }] }, options: { valueAxis: { show: true }, valueLabels: 'none', labels: { category: false } } },
    ], { anchors: { plotEdges: 'column' }, size: { width: 720, height: 640 } });
    expect(Math.abs(firstCentre(grid, 'c') - firstCentre(grid, 'w'))).toBeLessThan(1);
  });

  // valueAxis.percent draws a line as a 100% area; it took the inset like a line and lost both end values.
  it('keeps the end values of a 100% area chosen through valueAxis.percent', () => {
    const regions = ['North America', 'Eastern Europe', 'Southern Europe', 'Western Europe', 'Northern Europe', 'Latin America and Caribbean']
      .map((label, index) => ({ id: `r${index}`, label }));
    const grid = gridOf([
      { id: 'c', type: 'column', data: { categories: regions, series: [{ id: 'c', label: 'Total', values: [20, 24, 28, 32, 36, 40] }] }, options: { valueAxis: { show: true }, valueLabels: 'none' } },
      { id: 'l', type: 'line', data: { categories: regions, series: [
        { id: 'n', label: 'New', values: [20, 24, 28, 32, 36, 40] }, { id: 'r', label: 'Returning', values: [30, 28, 26, 24, 22, 20] },
      ] }, options: { valueAxis: { show: true, percent: true }, valueLabels: 'last' } },
    ], { anchors: { plotEdges: 'column' }, size: { width: 320, height: 640 } });
    expect(printed(grid, 'l', 'point')).toBe(2);
  });

  // Twelve rotated month names keep the column 8 px inside its margin; the line drew past it, with no warning.
  it('gives stacked panels the plot edges of a column that keeps room for rotated names', () => {
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
      .map((label) => ({ id: label.slice(0, 3).toLowerCase(), label }));
    const values = months.map((_, index) => 20 + 4 * index);
    const grid = gridOf([
      { id: 'c', type: 'column', data: { categories: months, series: [{ id: 's', label: 'S', values }] }, options: { valueAxis: { show: true }, valueLabels: 'none' } },
      { id: 'l', type: 'line', data: { categories: months, series: [{ id: 's', label: 'S', values }] }, options: { valueAxis: { show: true }, valueLabels: 'last' } },
    ], { anchors: { plotEdges: 'column', categories: 'column' }, size: { width: 720, height: 640 } });
    const [column, line] = plotEdges(grid);
    expect(line![0]).toBeCloseTo(column![0]!, 2);
    expect(line![1]).toBeCloseTo(column![1]!, 2);
    expect((grid.derived as { sharedAnchors: Record<string, number> }).sharedAnchors['plotEdges:column:0:left']).toBeCloseTo(column![0]!, 2);
    expect(grid.warnings.map((warning) => warning.code)).not.toContain('grid-anchor-incompatible');
  });

  // The inset narrows the columns: a column panel over a combo at 375 px dropped 3 of its 12 values.
  it('leaves a grid column as before when the inset would cost a printed value', () => {
    const twelve = Array.from({ length: 12 }, (_, index) => ({ id: `q${index}`, label: `Q${index + 1}` }));
    const grid = gridOf([
      { id: 'c', type: 'column', data: { categories: twelve, series: [
        { id: 'n', label: 'Northern region', values: [12, 19, 26, 33, 16, 23, 30, 13, 20, 27, 34, 17] },
        { id: 's', label: 'Southern district', values: [-17, -6, 5, -14, -3, 8, -11, 0, 11, -8, 3, -16] },
      ] }, options: { valueAxis: { show: true }, labels: { category: false }, valueLabels: 'all' } },
      { id: 'm', type: 'combo', data: { categories: twelve, series: [
        { id: 'n', label: 'Northern region', kind: 'column', values: [137500, 176000, 82500, 121000, 159500, 66000, 104500, 143000, 181500, 88000, 126500, 165000] },
        { id: 's', label: 'Southern district', kind: 'line', values: [-77000, -16500, 44000, -60500, 0, 60500, -44000, 16500, -88000, -27500, 33000, -71500] },
      ] }, options: { valueAxis: { show: true } } },
    ], { sharedScale: true, rows: [1, 1], anchors: { plotEdges: 'column' }, size: { width: 375, height: 640 } });
    expect(printed(grid, 'c', 'point')).toBeGreaterThanOrEqual(12);
  });

  const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((label) => ({ id: label, label }));
  const centreOf = (grid: Geometry, id: string, at: string) => {
    const panel = (grid.marks as { panels: { id: string; chart?: { offset: { x: number }; geometry: Geometry } }[] }).panels.find((candidate) => candidate.id === id)!;
    return panel.chart!.geometry.axes.find((axis) => axis.axis === 'x')!.ticks.find((tick) => tick.at === at)!.pos + panel.chart!.offset.x;
  };

  // A gap after January in the column panel, checked only on the months all three panels drew, put the line's March point nearer February's column.
  it('leaves a grid column as before when one panel spaces its months unevenly', () => {
    const grid = gridOf([
      { id: 'v', type: 'column', data: { categories: monthsShort.map((month, index) => index === 0 ? { ...month, gapAfter: 0.75 } : month), series: [{ id: 'q', label: 'Volume', values: [25, 30, 29, 34, 40, 36, 39, 41, 34, 36, 39, 38] }] }, options: { valueAxis: { show: true }, valueLabels: 'none' } },
      { id: 'r', type: 'line', data: { categories: monthsShort, series: [{ id: 'u', label: 'Rate', values: [25, 30, 29, 34, 40, 36, 39, 41, 34, 36, 39, 38] }] },
        options: { valueAxis: { show: true }, valueLabels: 'all', legend: 'none', categoryAxis: { crossesBetween: false } } },
      { id: 'i', type: 'line', data: { categories: [monthsShort[0]!, monthsShort[11]!], series: [{ id: 's', label: 'Stock', values: [128, 138] }] }, options: { valueAxis: { show: true }, valueLabels: 'none', categoryAxis: { crossesBetween: false } } },
    ], { anchors: { plotEdges: 'column' }, rows: [1, 1, 1], size: { width: 480, height: 720 } });
    const march = centreOf(grid, 'r', 'Mar');
    expect(Math.abs(march - centreOf(grid, 'v', 'Mar'))).toBeLessThan(Math.abs(march - centreOf(grid, 'v', 'Feb')));
  });

  // A sparkline draws the months without the inset; the column and line settled on their own edges and the warning went.
  it('keeps the warning when a sparkline shares the grid column', () => {
    const grid = gridOf([
      { id: 'c', type: 'column', data: { categories: monthsShort, series: [{ id: 's', label: 'S', values: [20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64] }] }, options: { valueAxis: { show: true }, valueLabels: 'none' } },
      { id: 'l', type: 'line', data: { categories: monthsShort, series: [{ id: 's', label: 'S', values: [20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64] }] }, options: { valueAxis: { show: true }, valueLabels: 'last' } },
      { id: 'o', type: 'sparkline', data: { values: [20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64], labels: monthsShort.map((month) => month.label) } },
    ], { anchors: { plotEdges: 'column', categories: 'column' }, rows: [1, 1, 1], size: { width: 720, height: 800 } });
    expect(grid.warnings.map((warning) => warning.code)).toContain('grid-anchor-incompatible');
  });

  // A panel with one month (the latest column) kept its centre while the other panels moved March 174 px away from it.
  it('leaves a grid column as before when a one-month panel shares it', () => {
    const grid = gridOf([
      { id: 't', type: 'line', data: { categories: monthsShort.slice(0, 5), series: [{ id: 's', label: 'Trend', values: [3, 4, 5, 4, 6] }] }, options: { valueLabels: 'none', categoryAxis: { crossesBetween: false } } },
      { id: 'a', type: 'column', data: { categories: monthsShort, series: [{ id: 's', label: 'Annual', values: [3, 4, 5, 4, 6, 5, 7, 6, 8, 7, 9, 8] }] }, options: { valueLabels: 'none', labels: { category: false } } },
      { id: 'l', type: 'column', data: { categories: [monthsShort[2]!], series: [{ id: 's', label: 'Latest', values: [5] }] }, options: { valueLabels: 'all', labels: { category: false } } },
    ], { anchors: { plotEdges: 'column' }, rows: [1, 1, 1], size: { width: 720, height: 720 } });
    expect(Math.abs(centreOf(grid, 't', 'Mar') - centreOf(grid, 'l', 'Mar'))).toBeLessThan(1);
  });

  const eightMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'].map((label) => ({ id: label, label }));
  const comboPanel = (id: string, valueLabels: string) => ({ id, type: 'combo', data: { categories: eightMonths, series: [
    { id: 'col', label: 'Actual', values: [21000, 22000, 28000, 34000, 35000, 41000, 42000, 48000] },
    { id: 'ln', label: 'Plan', kind: 'line', values: [22000, 23000, 29000, 30000, 36000, 42000, 43000, 49000] },
  ] }, options: { valueAxis: { show: true, gridlines: true }, valueLabels } });

  // Narrower category room printed the month names a step smaller (category-font-stepped) on a 320 px grid.
  it('leaves a grid column as before when the inset would print names smaller', () => {
    const grid = gridOf([
      { ...comboPanel('a', 'all'), data: { categories: eightMonths, series: [
        { id: 'col', label: 'Actual', values: [18, 24, 30, 31, 37, 38, 44, 50] },
        { id: 'ln', label: 'Plan', kind: 'line', values: [19, 25, 26, 32, 38, 39, 45, 46] },
      ] } },
      comboPanel('b', 'last'),
    ], { sharedScale: true, anchors: { categories: 'row' }, size: { width: 320, height: 520 } });
    expect(grid.warnings.map((warning) => warning.code)).not.toContain('category-font-stepped');
  });

  // Narrower category room pushed the variance panel's month names up to 1.7 px off their columns.
  it('leaves a grid column as before when the inset would move a name off its category', () => {
    const grid = gridOf([
      { id: 'v', type: 'variance', data: { categories: eightMonths, series: [
        { id: 'ac', label: 'Actual', values: [18, 24, 30, 31, 37, 38, 44, 50] },
        { id: 'py', label: 'Prior year', role: 'reference', scenario: 'PY', values: [20, 26, 27, 33, 34, 40, 46, 47] },
      ] }, options: { valueAxis: { show: true, gridlines: true }, variant: 'absolute', variance: { of: 'ac', vs: 'py' } } },
      comboPanel('c', 'all'),
    ], { sharedScale: true, anchors: { plotEdges: 'all' }, size: { width: 320, height: 520 } });
    const panel = (grid.marks as { panels: { id: string; chart?: { geometry: Geometry } }[] }).panels.find((candidate) => candidate.id === 'v')!.chart!.geometry;
    const ticks = panel.axes.find((axis) => axis.axis === 'x')!.ticks;
    for (const label of panel.labels.filter((candidate) => candidate.kind === 'category')) {
      const tick = ticks.find((candidate) => candidate.at === label.owner?.categoryId)!;
      expect(Math.abs(label.rect!.x + label.rect!.w / 2 - tick.pos)).toBeLessThan(0.6);
    }
  });

  // Stacked dot panels share a category axis down the plot: aligning their numeric value ticks as
  // categories halved the first plot and warned.
  it('leaves the value axis of stacked dot panels alone', () => {
    const quarters = ['Q1', 'Q2', 'Q3', 'Q4'].map((label) => ({ id: label.toLowerCase(), label }));
    const panel = (id: string, values: number[]) =>
      ({ id, type: 'dot', data: { categories: quarters, series: [{ id, label: id, values }] }, options: { valueAxis: { show: true } } });
    const grid = layoutResolvedRequest(resolveChartRequest({
      type: 'grid',
      data: { panels: [panel('a', [0, 30, 70, 100]), panel('b', [0, 60, 150, 200])] },
      options: { sharedAxis: 'category', sharedScale: false, anchors: { plotEdges: 'all' }, size: { width: 960, height: 600 } },
    })) as Geometry;
    const [first, second] = plotEdges(grid);
    expect(first![1]! - first![0]!).toBeCloseTo(second![1]! - second![0]!, 2);
    expect(grid.warnings.map((warning) => warning.code)).not.toContain('grid-anchor-incompatible');
  });
});

// Two column panels with format "1,234" and no unit, revenue in thousands
// beside an order count, shared one axis and drew the count panel flat
//: a shared chart type is no evidence of one measure.
describe('grid default shared scale needs evidence of one measure', () => {
  const categories = ['a', 'b', 'c', 'd'].map((id) => ({ id, label: id.toUpperCase() }));
  const sharedDomain = (grid: Record<string, unknown> = {}) => {
    const panel = (id: string, values: number[]) =>
      ({ id, type: 'column', data: { categories, series: [{ id, label: id, values }] }, options: { title: false, format: '1,234' } });
    const geometry = getChart('grid')!.layout({
      panels: [panel('revenue', [48200, 51900, 47300, 55100]), panel('orders', [312, 298, 341, 327])],
    }, { columns: 2, size: { width: 720, height: 320 }, ...grid }) as Geometry;
    return (geometry.derived as { sharedYDomains?: Record<string, unknown> }).sharedYDomains?.['grid:y'];
  };
  it('gives two unitless column panels their own scales', () => {
    expect(sharedDomain()).toBeUndefined();
    expect(sharedDomain({ unit: '€' })).toBeDefined();
    expect(sharedDomain({ sharedScale: true })).toBeDefined();
  });
});

// A `repeat.facet` grid slices one measure, so it shares a scale without a unit
// (the same-type clause lost the share).
it('keeps one scale for a unitless repeat.facet grid', () => {
  const geometry = getChart('grid')!.layout({
    repeat: { dimension: 'region', values: ['amer', 'emea', 'apac'], facet: 'series' },
    template: {
      type: 'column', title: '$region', options: { format: '12' },
      data: {
        categories: [{ id: 'h1', label: 'H1' }, { id: 'h2', label: 'H2' }],
        series: [
          { id: 'amer', label: 'AMER', values: [50, 60] },
          { id: 'emea', label: 'EMEA', values: [30, 25] },
          { id: 'apac', label: 'APAC', values: [20, 28] },
        ],
      },
    },
  }, { size: { width: 720 } }) as Geometry;
  expect((geometry.derived as { sharedYDomains?: Record<string, unknown> }).sharedYDomains?.['grid:y']).toBeDefined();
});

// Four KPI cards at 880 px hid every delta "+10.4% (+€1,720,000) vs PY" with
// only an info line: the delta wraps before it
// drops, and a pinned height too short for two lines still draws and warns.
it('wraps a KPI delta wider than its grid card instead of hiding it', () => {
  // A change in percent prints two digits, so the delta needs a longer absolute part to outgrow the card:
  // "+143% (+€10,720,000) vs PY". Before, the prior was €16,520,000 and the delta read "+10.4% (+€1,720,000) vs PY".
  const data = { label: 'Net revenue', value: 18240000, format: '€1,234', delta: { vs: 7520000, scenario: 'PY', mode: 'both' } };
  const layout = (size: { width: number; height?: number }) => getChart('grid')!.layout({
    panels: [0, 1, 2, 3].map((i) => ({ id: `p${i}`, type: 'kpi', data })),
  }, { columns: 4, size }) as Geometry;
  const hidden = (geometry: Geometry) => geometry.warnings.filter((warning) => warning.code === 'label-hidden').map((warning) => warning.severity);
  expect(hidden(layout({ width: 880 }))).toEqual([]);
  const pinned = layout({ width: 880, height: 140 });
  expect(pinned.refused).toBeFalsy();
  expect(hidden(pinned)).toEqual(['warn']);
});

// A four-row grid at 400 × 60 px without authored gutters refused with
// "authored gutters consume 15px": it is below its
// floor, so it refuses with the measured size.
it('refuses a grid below its floor by size, not by gutters it did not author', () => {
  const categories = ['a', 'b'].map((id) => ({ id, label: id.toUpperCase() }));
  const result = getChart('grid')!.layout({
    panels: [1, 2, 3, 4].map((i) => ({ id: `p${i}`, type: 'column', title: `Panel ${i}`, data: { categories, series: [{ id: `s${i}`, label: `S${i}`, values: [i, i + 1] }] } })),
  }, { title: 'Four metrics', rows: [1, 1, 1, 1], size: { width: 400, height: 60 } });
  expect(result.warnings[0]?.code).toBe('size-below-floor');
});

// Shared category tiers must align the drawn marks even when column bands inset their centres.
it('aligns column and line category centres in legacy category tiers', () => {
  const data = { categories, series: [{ id: 'v', label: 'Measure', values: [10, 20, 30, 40] }] };
  const grid = getChart('grid')!.layout({ panels: ['column', 'line'].map((type, i) => ({
    id: `p${i}`, type, data, options: { valueAxis: { show: true }, labels: { value: false }, legend: 'none' },
  })) }, { sharedAxis: 'category', sharedScale: true, size: { width: 840, height: 700 } }) as Geometry;
  const panels = (grid.marks as { panels: { chart: { geometry: Geometry; offset: { x: number } } }[] }).panels;
  const ticks = panels.map(p => p.chart.geometry.axes.find(a => a.axis === 'x')!.ticks.map(t => t.pos + p.chart.offset.x));
  ticks[0]!.forEach((pos, i) => expect(pos).toBeCloseTo(ticks[1]![i]!, 2));
  expect((grid.derived as { sharedYDomains: object }).sharedYDomains).toHaveProperty('grid:y');
});

// Dot and bar panels draw their value axis across, and sharedScale true kept their own scales without a word.
it('shares the horizontal value axis of dot and bar panels', () => {
  const panel = (id: string, type: string, values: number[]) => ({ id, type, title: id, data: {
    categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], series: [{ id: `${id}s`, label: 'Value', values }] } });
  for (const type of ['dot', 'bar']) {
    const grid = getChart('grid')!.layout({ panels: [panel('low', type, [10, 40]), panel('high', type, [100, 180])] },
      { columns: 1, sharedScale: true, size: { width: 600, height: 500 } }) as Geometry;
    expect((grid.derived as { sharedYDomains: object }).sharedYDomains, type).toHaveProperty('grid:y');
    // A dot panel prints its value axis: both panels end on the same tick.
    const panels = (grid.marks as { panels: { chart: { geometry: Geometry } }[] }).panels;
    const lastTick = panels.map(p => p.chart.geometry.axes.find(a => a.axis === 'x')?.ticks.at(-1)?.at);
    if (type === 'dot') expect(lastTick[0]).toBe(lastTick[1]);
  }
});

// A butterfly pane keeps its own scale, so reading its axis across put its negative side into the domain of the column panels.
it('leaves a butterfly panel out of the shared value scale', () => {
  const butterfly = getFixtures('butterfly')[0]!;
  const column = (id: string, values: number[]) => ({ id, type: 'column', title: id, options: { unit: '$k' }, data: {
    categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], series: [{ id: `${id}s`, label: 'Sales', values }] } });
  const grid = getChart('grid')!.layout({ panels: [{ id: 'split', type: 'butterfly', title: 'Split', data: butterfly.data, options: { ...butterfly.options, sharedScale: false } },
    column('east', [10, 20]), column('west', [15, 30])] }, { columns: 3, size: { width: 1200, height: 450 } }) as Geometry;
  expect((grid.derived as { sharedYDomains?: object }).sharedYDomains).toBeUndefined();
});

// A bar draws its value-axis break across, and the break check read the vertical axis only: two bars with one valid break were refused.
it('shares one value-axis break across bar panels', () => {
  const bar = (id: string, values: number[]) => ({ id, type: 'bar', title: id, options: { valueAxis: { show: true, break: { from: 40, to: 480 } } }, data: {
    categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], series: [{ id: `${id}s`, label: 'Sales', values }] } });
  const result = layoutResolvedRequest(resolveChartRequest({ type: 'grid', data: { panels: [bar('east', [10, 20, 520]), bar('west', [15, 30, 540])] },
    options: { columns: 1, sharedScale: true, size: { width: 700, height: 500 } } } as never));
  expect(result.refused).toBeFalsy();
  expect(result.warnings.map((warning) => warning.code)).not.toContain('scale-break-incompatible');
  expect((result as Geometry).derived).toHaveProperty('sharedYDomains.grid:y');
});

// A shared value domain must map equal value steps to equal pixel heights in mixed panels.
it('maps a shared value scale to each panel data rectangle', () => {
  const grid = getChart('grid')!.layout({ panels: [
    { id: 'column', type: 'column', title: 'Column', caption: 'Quarterly measure', data: { categories,
      series: [{ id: 'v', label: 'Measure', values: [80, 95, 110, 125] }] },
      options: { scaleGroup: { y: 'shared' }, valueAxis: { show: true }, labels: { segment: false, point: false, category: false } } },
    { id: 'line', type: 'line', title: 'Line', caption: 'Two measures', data: { categories,
      series: [{ id: 'a', label: 'Alpha', values: [92, 105, 118, 132] }, { id: 'b', label: 'Beta', values: [74, 83, 91, 104] }] },
      options: { scaleGroup: { y: 'shared' }, valueAxis: { show: true } } },
  ] }, { size: { width: 400 }, sharedAxis: 'category', unit: 'Units' }) as Geometry;
  const panels = (grid.marks as { panels: { chart: { geometry: Geometry } }[] }).panels;
  const steps = panels.map(p => {
    const ticks = p.chart.geometry.axes.find(a => a.axis === 'y')!.ticks;
    return (ticks[0]!.pos - ticks[1]!.pos) / (Number(ticks[1]!.at) - Number(ticks[0]!.at));
  });
  expect(steps[0]).toBeCloseTo(steps[1]!, 5);
  expect((grid.derived as { sharedYDomains: object }).sharedYDomains).toHaveProperty('shared');
});

// The margin that equalised a shared scale counted as panel chrome: a pinned 1280 x 780 was refused, while 755 drew.
it('keeps the floor of a shared value scale below a frame that draws', () => {
  const panel = (id: string, type: 'column' | 'line', values: number[][]) => ({ id, type, title: `${type} panel`, caption: 'A caption line',
    data: { categories, series: values.map((v, i) => ({ id: `s${i}`, label: `Series ${i + 1}`, values: v })) },
    options: { scaleGroup: { y: 'cost' }, valueAxis: { show: true }, ...(type === 'column' ? { labels: { segment: false, point: false, category: false } } : {}) } });
  const columnValues = [[80, 95, 110, 125]];
  const lineValues = [[92, 105, 118, 132], [74, 83, 91, 104]];
  const spec = (size: object) => ({ type: 'grid', data: { panels: [panel('a', 'column', columnValues), panel('b', 'line', lineValues),
    panel('c', 'column', columnValues), panel('d', 'line', lineValues)] }, options: { size, sharedAxis: 'category', unit: '$k', title: 'Spend and cost on one scale' } });
  const draws = (height: number) => !layoutResolvedRequest(resolveChartRequest({ ...spec({ width: 1280, height }) } as never)).refused;
  const floor = measure(spec({ width: 1280 }) as never).minHeightAtWidth;
  expect(draws(floor)).toBe(true);
  expect(draws(780)).toBe(true);
});

// Equal value steps must keep requested baseline anchors, and a panel that left the group must not size the others.
it('keeps baseline anchors and resolved group membership when it equalizes shared value scales', () => {
  const categories3 = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }];
  const column = (id: string, values: number[], extra: object = {}) => ({ id, type: 'column', ...extra,
    data: { categories: categories3, series: [{ id: 'v', label: 'Value', values }] },
    options: { scaleGroup: { y: 'g' }, valueAxis: { show: true }, legend: 'none' } });
  const baselineOf = (geometry: Geometry, id: string) => (geometry.scene.find(n => n.id === `${id}/axis:baseline`) as { y1: number }).y1;
  const anchored = getChart('grid')!.layout({ panels: [column('p1', [10, 20, 30], { row: 0, column: 0, title: 'With heading' }), column('p2', [5, 15, 25], { row: 0, column: 1 })] },
    { size: { width: 1000, height: 500 }, columns: [1, 1], rows: [1], anchors: { baselines: 'row' }, legend: 'none' }) as Geometry;
  expect(baselineOf(anchored, 'p2')).toBeCloseTo(baselineOf(anchored, 'p1'), 5);
  const scatter = (inGroup: boolean) => ({ id: 's', type: 'scatter', row: 0, column: 2, title: 'Scatter heading', caption: 'A caption under the heading',
    data: { points: [{ id: 'p', x: 1, y: 10 }, { id: 'q', x: 2, y: 500 }] },
    options: { ...(inGroup ? { scaleGroup: { y: 'g' } } : {}), valueAxis: { clamp: { max: 100 } }, legend: 'none' } });
  const grid = (inGroup: boolean) => getChart('grid')!.layout({ panels: [column('c1', [10, 20, 30], { row: 0, column: 0 }), column('c2', [5, 15, 25], { row: 0, column: 1 }), scatter(inGroup)] },
    { size: { width: 1200, height: 600 }, columns: [1, 1, 1], rows: [1], legend: 'none' }) as Geometry;
  expect(baselineOf(grid(true), 'c1')).toBeCloseTo(baselineOf(grid(false), 'c1'), 5);
  const legacy = (inGroup: boolean) => {
    const { row: _row, column: _column, ...free } = scatter(inGroup);
    return getChart('grid')!.layout({ panels: [column('c1', [10, 20, 30]), column('c2', [5, 15, 25]), free] },
      { size: { width: 1200, height: 600 }, sharedAxis: 'none', columns: 3, legend: 'none' }) as Geometry;
  };
  expect(baselineOf(legacy(true), 'c1')).toBeCloseTo(baselineOf(legacy(false), 'c1'), 5);
});

// Nine facets kept three columns on a 320 px card: every panel dropped its middle year and a title ran into a value.
describe('facet reflow on a phone card', () => {
  const fixture = getFixtures('grid').find((f) => f.id === 'nine-regions-reflow')!;
  const layout = (options: object) => getChart('grid')!.layout(fixture.data as never, { ...fixture.options, ...options } as never) as Geometry<object, object>;
  const titleColumns = (geo: Geometry<object, object>) => new Set(geo.scene.filter((node) => node.t === 'text' && node.part === 'panelTitle').map((node) => (node as { x: number }).x)).size;
  // Replacing a custom theme must recompute the columns that keep every category name visible.
  it('reflows after the same theme name is registered with changed tokens', () => {
    const base = resolveTheme('standard');
    const name = 'reflow-registration-test';
    const options = { ...fixture.options, size: { width: 400 }, theme: name };
    const draw = () => {
      const geometry = layoutGrid(fixture.data as never, options as never);
      if (geometry.refused) throw new Error('grid refused');
      return geometry;
    };
    registerTheme({ ...base, name });
    const before = draw();
    expect(titleColumns(before)).toBe(3);
    const beforeSvg = renderSvg(before as never, resolveTheme(name));
    registerTheme({ ...base, name, type: { ...base.type, axis: { ...base.type.axis, size: 14 },
      scale: { S: { ...base.type.scale?.S, axis: 14 } } } });
    const after = draw();
    expect(titleColumns(after)).toBe(2);
    const afterSvg = renderSvg(after as never, resolveTheme(name));
    expect(afterSvg).not.toBe(beforeSvg);
    expect(renderSvg(draw() as never, resolveTheme(name))).toBe(afterSvg);
  });
  it('draws three columns as two where every year prints, and keeps three where they read clean', () => {
    const narrow = layout({});
    expect(titleColumns(narrow)).toBe(2);
    expect(narrow.warnings.map((w) => w.code)).not.toContain('category-stride');
    expect(titleColumns(layout({ size: { width: 400 } }))).toBe(3);
    const fixed = layout({ reflow: false });
    expect(titleColumns(fixed)).toBe(3);
    expect(fixed.warnings.map((w) => w.code)).toContain('category-stride');
  });
  // Prevents reflow from refusing an authored height that the authored columns seat.
  it('keeps the authored columns where the fewer columns do not fit an authored height', () => {
    const short = layout({ size: { width: 320, height: 500 } });
    expect(short.refused).toBeUndefined();
    expect(titleColumns(short)).toBe(3);
    expect(titleColumns(layout({ size: { width: 320, height: 900 } }))).toBe(2);
  });
});

describe('tiers keep the height their parts need', () => {
  const regions = ['Administration', 'Manufacturing', 'Merchandising', 'Infrastructure', 'Communications', 'Transportation', 'Procurement', 'Engineering-Ops']
    .map((label) => ({ id: label.toLowerCase().replace(/\W+/g, '-'), label }));
  const regionData = { categories: regions, series: [
    { id: 'ac', label: 'Actual', values: [362, 327, 355, 365, 366, 406, 375, 412] },
    { id: 'py', label: 'PY', role: 'reference' as const, scenario: 'PY' as const, values: [352, 292, 421, 408, 416, 342, 420, 448] }] };
  const laidOut = (request: Record<string, unknown>) => layoutResolvedRequest(resolveChartRequest(request as never)) as unknown as Geometry;
  const regionTiers = [
    { id: 'base', type: 'column', data: regionData },
    { id: 'tier', type: 'variance', data: regionData, options: { variant: 'relative', variance: { of: 'ac', vs: 'py' } } }];
  const german = { ...regionData, categories: ['Baden-Württemberg', 'Niedersachsen', 'Ruhrgebiet', 'Oberfranken', 'Abschreibungen', 'Umsatzerlöse', 'Personalaufwand', 'Sonstige']
    .map((label) => ({ id: label.toLowerCase().replace(/\W+/g, '-'), label })) };
  const rowPlaced = (data: unknown) => [
    { id: 'base', type: 'column', row: 1, column: 0, data },
    { id: 'tier', type: 'variance', row: 0, column: 0, data, options: { variant: 'relative', variance: { of: 'ac', vs: 'py' } } }];
  const framed = { title: 'Revenue by region', subtitle: { measure: 'Revenue', period: 'FY26' }, unit: 'EUR m', source: 'Invented data', sharedAxis: 'category' };
  // With an open height the grid stayed too short for its rotated names, so a tier was squeezed to a strip.
  it('keeps the height rotated category names need', () => {
    const grid = laidOut({ type: 'grid', data: { panels: rowPlaced(german) }, options: { ...framed, target: 'slide', size: { width: 480, unit: 'px' } } });
    const codes = grid.warnings.map((warning) => warning.code);
    expect(codes).toContain('category-labels-rotated');
    expect(codes).not.toContain('text-clipped');
    expect(grid.size.height).toBeGreaterThan(385);
  });
  // The weights alone gave a middle panel less than its own minimum, so its plot was a strip the canvas had room to avoid.
  it('gives every panel its minimum height when the canvas holds them all', () => {
    const years = Array.from({ length: 9 }, (_, index) => ({ id: String(2015 + index) }));
    const line = (id: string, values: number[]) => ({ id, type: 'line', title: `Panel ${id}`,
      data: { categories: years, series: [{ id, label: id, values }] }, options: { legend: 'none', seriesLabels: 'none' } });
    const grid = laidOut({ type: 'grid', data: { panels: [
      line('a', [94, 95.5, 96.8, 97.4, 98.1, 99, 97.2, 98, 99.1]),
      line('b', [100, 103, 106, 109, 112, 118, 128, 135, 129]),
      line('c', [6, 5.5, 5, 5.3, 6, 12, 9, 7, 7.5])] },
    options: { title: 'Three panels', sharedAxis: 'category', sharedScale: false, target: 'print', size: { width: 180, unit: 'mm' } } });
    for (const panel of (grid.marks as unknown as { panels: { id: string; chart: { geometry: Geometry } }[] }).panels) {
      expect(panel.chart.geometry.size.height + 1).toBeGreaterThanOrEqual(panel.chart.geometry.sizing!.minHeight);
    }
  });
  // A tier that keeps its frame at the plot floor pushed the stack up until its caption printed over the subtitle.
  it('keeps the tier caption under the subtitle on a short canvas', () => {
    const upright = { ...regionData, categories: ['Net revenue', 'Churn rate', 'Marketing', 'North', 'Ruhr', 'Highlands', 'Deprec.', 'Plains']
      .map((label) => ({ id: label.toLowerCase().replace(/\W+/g, '-'), label })) };
    const grid = laidOut({ type: 'grid', data: { panels: regionTiers.map((panel) => ({ ...panel, data: upright })) }, options: {
      title: 'Revenue by region', subtitle: { measure: 'Revenue', period: 'FY26' }, unit: 'EUR m', source: 'Invented data', sharedAxis: 'category', target: 'dashboard', size: { width: 960, height: 300 } } });
    const caption = grid.labels.find((label) => label.id.endsWith('tier:caption'));
    expect(caption).toBeDefined();
    expect(caption!.rect.y).toBeGreaterThanOrEqual(grid.plot.y - 1);
  });
  const first = (count: number) => ({ categories: regionData.categories.slice(0, count), series: regionData.series.map((item) => ({ ...item, values: item.values.slice(0, count) })) });
  // The row tracks added up to more than the canvas, so the minimum scaled by them refused a height where both tiers fit.
  it('draws a row-placed tier grid at a height above what its parts need', () => {
    const grid = laidOut({ type: 'grid', data: { panels: rowPlaced(first(3)) }, options: { ...framed, target: 'report', size: { width: 480, height: 300, unit: 'px' } } });
    expect(grid.refused).toBeFalsy();
    expect(grid.size.height).toBe(300);
  });
  // The minimum counts the tiers alone, but a grid with no authored height must still draw at the height its panels ask for.
  it.each([
    { target: 'report', heightAbove: 324 },
    { target: 'print', heightAbove: 342 },
    { target: 'dashboard', heightAbove: 335 },
  ])('draws a row-placed tier grid with no authored height tall enough ($target)', ({ target, heightAbove }) => {
    const grid = laidOut({ type: 'grid', data: { panels: rowPlaced(first(5)) }, options: { ...framed, target, size: { width: 480, unit: 'px' } } });
    expect(grid.warnings.map((warning) => warning.code)).not.toContain('grid-panel-too-short');
    expect(grid.size.height).toBeGreaterThan(heightAbove);
  });
  // An aligned grid kept the old slot weights in its minimum only, so a canvas that draws today would refuse by 5 px.
  it('still draws an aligned tier grid at the authored size it fits', () => {
    const three = { categories: ['Alpha', 'Beta', 'Gamma'].map((label) => ({ id: label.toLowerCase(), label })), series: [
      { id: 'ac', label: 'Actual', values: [360, 397, 384] },
      { id: 'py', label: 'PY', role: 'reference' as const, scenario: 'PY' as const, values: [350, 403, 366] }] };
    const stretch = { align: { vertical: 'stretch' } };
    const grid = laidOut({ type: 'grid', data: { panels: [
      { id: 'base', type: 'column', data: three, ...stretch },
      { id: 'tier', type: 'variance', data: three, ...stretch, options: { variant: 'relative', variance: { of: 'ac', vs: 'py' } } }] },
    options: { ...framed, size: { width: 480, height: 308, unit: 'px' } } });
    expect(grid.refused).toBeFalsy();
    expect(grid.size).toEqual({ width: 480, height: 308 });
  });
});

describe('tier captions wrap to the panel width', () => {
  // A caption wider than a narrow canvas found no seat and was left out of the chart.
  it('prints a long caption on two lines instead of dropping it', () => {
    const panel = (id: string, caption: string) => ({ id, type: 'column', title: id, caption, data: {
      categories: [{ id: 'q1', label: 'Q1' }, { id: 'q2', label: 'Q2' }],
      series: [{ id: 's', label: 'Orders', values: [10, 12] }] } });
    const grid = getChart('grid')!.layout({
      panels: [panel('north', 'A caption that runs far past the width of this narrow card'), panel('south', 'Short note')],
    }, { size: { width: 300 }, sharedAxis: 'category', title: 'Orders hold', target: 'report' }) as Geometry;
    const caption = grid.scene.find((n) => n.id === 'north/tier:detail') as { lines: string[] } | undefined;
    expect(caption?.lines.length).toBe(2);
    expect(caption?.lines.join(' ')).toBe('A caption that runs far past the width of this narrow card');
    expect(grid.labels.filter((label) => label.hidden && label.id.includes('tier:'))).toEqual([]);
  });
  // A word wider than the panel is cut, so the chart has to say so and keep the whole text.
  it('reports a caption cut inside one long word', () => {
    const word = 'Pneumonoultramicroscopicsilicovolcanoconiosis'.repeat(2);
    const grid = getChart('grid')!.layout({ panels: ['north', 'south'].map((id) => ({ id, type: 'column', title: id, caption: word, data: {
      categories: [{ id: 'q1', label: 'Q1' }, { id: 'q2', label: 'Q2' }],
      series: [{ id: 's', label: 'Orders', values: [10, 12] }] } })) },
    { size: { width: 300 }, sharedAxis: 'category', title: 'Orders hold', target: 'report' }) as Geometry;
    expect((grid.scene.find((n) => n.id === 'north/tier:detail') as { title?: string } | undefined)?.title).toBe(word);
    expect(grid.warnings.map((warning) => warning.code)).toContain('labels-truncated');
  });
});

// A variance tier listed first, to stand under the columns, became the category-axis owner at the bottom and grew
// a 960 px grid to 1493 px. variancePosition: 'below' keeps the column panel as the owner and puts the tiers under it.
it('stands the variance tiers under the column panel with variancePosition below', () => {
  const { data, options } = getFixtures('grid').find((f) => f.id === 'weekly-actual-vs-plan')! as { data: { panels: { id: string }[] }; options: Record<string, unknown> };
  const panels = [...data.panels, { ...data.panels[1]!, id: 'dpl2' }];
  const at = (variancePosition?: string) => layoutResolvedRequest(resolveChartRequest({ type: 'grid', data: { panels }, options: { ...options, ...(variancePosition ? { variancePosition } : {}), size: { width: 960 } } } as never)) as unknown as Geometry & { marks: { panels: { id: string; plot: { y: number } }[] } };
  const below = at('below');
  const y = (id: string) => below.marks.panels.find((panel) => panel.id === id)!.plot.y;
  // The tiers follow the columns in authored order, and the week labels stay with the columns.
  expect(y('orders')).toBeLessThan(y('dpl'));
  expect(y('dpl')).toBeLessThan(y('dpl2'));
  expect(below.labels.some((label) => label.id.startsWith('orders/category'))).toBe(true);
  expect(below.labels.some((label) => label.id.startsWith('dpl/category') || label.id.startsWith('dpl2/category'))).toBe(false);
  // The default keeps them over the columns, at the same height.
  const above = at();
  expect(above.marks.panels.find((panel) => panel.id === 'orders')!.plot.y).toBeGreaterThan(above.marks.panels.find((panel) => panel.id === 'dpl')!.plot.y);
  expect(below.size.height).toBe(above.size.height);
  // With every category label off, the tiers still stand under the columns.
  const quiet = layoutResolvedRequest(resolveChartRequest({ type: 'grid', data: { panels: panels.map((panel) => ({ ...panel, options: { ...(panel as { options?: object }).options, labels: { category: false } } })) },
    options: { ...options, variancePosition: 'below', size: { width: 960 } } } as never)) as unknown as typeof below;
  const quietY = (id: string) => quiet.marks.panels.find((panel) => panel.id === id)!.plot.y;
  expect(quietY('orders')).toBeLessThan(quietY('dpl'));
  expect(quietY('dpl')).toBeLessThan(quietY('dpl2'));
});

// Without variancePosition, a variance tier listed first still took the week labels, stood under the columns
// and grew a 960 px grid to 1493 px, against the default 'above'.
it('keeps the column panel the category owner when a variance tier is listed first', () => {
  const { data, options } = getFixtures('grid').find((f) => f.id === 'weekly-actual-vs-plan')! as { data: { panels: { id: string }[] }; options: Record<string, unknown> };
  const at = (panels: object[]) => measure({ type: 'grid', data: { panels }, options: { ...options, size: { width: 960 } } } as never).geometry as unknown as Geometry & { marks: { panels: { id: string; plot: { y: number } }[] } };
  const listed = at(data.panels);
  const varianceFirst = at([...data.panels].reverse());
  expect(listed.marks.panels[0]!.id).toBe('orders');
  expect(varianceFirst.size.height).toBe(listed.size.height);
  const y = (id: string) => varianceFirst.marks.panels.find((panel) => panel.id === id)!.plot.y;
  expect(y('dpl')).toBeLessThan(y('orders'));
  expect(varianceFirst.labels.some((label) => label.id.startsWith('orders/category'))).toBe(true);
});

// A panel heading packed as close to the tier above as to its own panel reads as a footnote of the chart above.
it('puts a panel heading at least twice as far from the tier above as from its own panel', () => {
  const { data, options } = getFixtures('grid').find((f) => f.id === 'mixed-column-line-shared-y')! as { data: unknown; options: Record<string, unknown> };
  const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'grid', data, options: { ...options, size: { width: 480 } } } as never)) as unknown as
    Geometry & { marks: { panels: { id: string; plot: { y: number }; content: { y: number; h: number } }[] } };
  const [upper, lower] = geometry.marks.panels;
  const shown = (prefix: string) => geometry.labels.filter((label) => label.id.startsWith(prefix) && !label.hidden).map((label) => label.rect);
  const heading = shown(`${lower!.id}/tier:`);
  const own = shown(`${lower!.id}/`).filter((rect) => !heading.includes(rect));
  const headingTop = Math.min(...heading.map((rect) => rect.y));
  const headingBottom = Math.max(...heading.map((rect) => rect.y + rect.h));
  const above = headingTop - (upper!.content.y + upper!.content.h);
  const below = Math.min(lower!.plot.y, ...own.map((rect) => rect.y)) - headingBottom;
  expect(below).toBeGreaterThan(0);
  expect(above).toBeGreaterThanOrEqual(2 * below);
});
