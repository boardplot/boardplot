import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { getChart } from '../src/core/registry';
import { getFixtures } from '../src/fixtures';
import { measure } from '../src/index';
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
// 340 to 530 px and still hid every small value. Growth that prints nothing keeps the initial height.
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
  expect(card.size.height).toBeLessThan(380);
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
    expect(text('label:point:q1')).toMatchObject({ ink: { theme: { kind: 'series-text', base: { token: 'bad' } } }, font: { weight: 700 } });
    expect(text('label:point:q2')).toMatchObject({ ink: { theme: { kind: 'series-text', base: { token: 'good' } } }, font: { weight: 700 } });
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

// A combo panel over a line panel with anchors.categories 'all' put the category centres 3.3 px apart:
// the plot edges matched, but combo insets its bands inside the plot.
describe('grid anchors.categories across panel types', () => {
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
    const grid = layout({ plotEdges: 'all', categories: 'all' });
    const edgeKeys = (geometry: Geometry) => Object.keys((geometry.derived as { sharedAnchors?: object }).sharedAnchors ?? {}).filter((key) => key.startsWith('plotEdges:'));
    const [top, bottom] = grid.axes.filter((axis) => axis.axis === 'x').map((axis) => axis.ticks.map((tick) => tick.pos));
    expect(bottom!.map((pos, index) => Math.abs(pos - top![index]!))).toEqual(bottom!.map(() => expect.closeTo(0, 2)));
    // The plot edges then differ, so the grid says so and reports no stale edge anchor.
    expect(grid.warnings.map((warning) => warning.code)).toContain('grid-anchor-incompatible');
    expect(edgeKeys(grid)).toEqual([]);
    expect(edgeKeys(layout({ categories: 'all' }))).toEqual([]);
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
  const data = { label: 'Net revenue', value: 18240000, format: '€1,234', delta: { vs: 16520000, scenario: 'PY', mode: 'both' } };
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
});
