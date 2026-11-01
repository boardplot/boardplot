import ReaderBox from '../src/react/ReaderBox';
import { resolveTheme as readerTheme } from '../src/core/theme';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import '../src/core/charts';
import '../src/core/geo/packs/dach';
import { getChart } from '../src/core/registry';
import { getFixtures, getRefusalExamples } from '../src/fixtures';
import { canDraw, measure } from '../src/index';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { interactionRecords } from '../src/core/a11y/records';
import { BoardplotTheme } from '../src/react/BoardplotTheme';
import { layoutDiagram } from '../src/core/charts/diagram/layout';
import type { DiagramData } from '../src/core/types/diagram';
import type { SlopeChartData } from '../src/core/types/data';
import type { Geometry } from '../src/core/types/scene';
import { cutLabels } from '../src/core/label/omissions';
import { render } from '../src/cli/render';
import { measure as cliMeasure } from '../src/cli/measure';
import { callTool } from '../src/mcp/server';
// @ts-expect-error The scorecard script has no declaration file.
import { applyRepair } from '../scripts/layout-scorecard.mjs';

const scatterCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock('../src/core/charts/scatter/layout', async original => {
  const module = await original<typeof import('../src/core/charts/scatter/layout')>();
  return { ...module, layoutScatter: (...args: Parameters<typeof module.layoutScatter>) => {
    scatterCalls.count++;
    return module.layoutScatter(...args);
  } };
});

const barLayoutCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock('../src/core/charts/bar/layout', async original => {
  const module = await original<typeof import('../src/core/charts/bar/layout')>();
  return { ...module, layoutBar: (...args: Parameters<typeof module.layoutBar>) => {
    barLayoutCalls.count++;
    return module.layoutBar(...args);
  } };
});

// Plot-height advice must not repeat the layout on every dashboard render or resize.
it('renders a short scatter without extra layouts for plot-height advice', () => {
  const fixture = getFixtures('scatter').find(f => f.id === 'option-info-grid')!;
  const request = { type: 'scatter', data: fixture.data, options: { ...fixture.options, size: { width: 400, height: 300 } } };
  scatterCalls.count = 0;
  const result = layoutResolvedRequest(resolveChartRequest(request));
  expect(result.warnings.some(w => w.code === 'plot-under-floor')).toBe(true);
  expect(scatterCalls.count).toBe(1);
  // The layout draws and estimates a height: a patch that was not drawn is left to measure.
  expect(result.warnings.find(w => w.code === 'plot-under-floor')!.fix).toBeUndefined();
  const verified = measure(request).warnings.find(w => w.code === 'plot-under-floor')!;
  const repaired = render({ spec: applyRepair(request, verified.fix) }).body as any;
  expect(repaired.ok).toBe(true);
  expect(repaired.warnings.some((w: any) => w.code === 'plot-under-floor')).toBe(false);
});

const shortCombo = {
  type: 'combo', data: { categories: ['Q1', 'Q2', 'Q3', 'Q4'], series: [
    { id: 'r', label: 'Revenue', kind: 'column', values: [10, 12, 14, 13] },
    { id: 'm', label: 'Margin', kind: 'line', axis: 'secondary', values: [0.2, 0.22, 0.25, 0.24] },
  ] }, options: { title: 'Revenue and margin', size: { width: 480, height: 200 }, secondaryAxis: { acknowledge: true as const } },
};

// Prevents furniture advice from blaming notes when the drawn event key takes the most height.
it('names the event key as the costliest furniture row', () => {
  const fixture = getFixtures('combo').find(f => f.id === 'revenue-events-key-title')!;
  const body = render({ spec: { type: 'combo', data: fixture.data, options: fixture.options, annotations: fixture.annotations } }).body as any;
  expect(body.ok).toBe(true);
  const warning = body.warnings.find((warning: any) => warning.code === 'furniture-budget');
  expect(warning?.message).toContain('event key row costs the most at 139px.');
  expect(warning?.suggest).toContain('event');
  expect(warning?.suggest).not.toContain('footnotes');
});

// Prevents an automatic height from breaking the furniture budget when a taller ladder height keeps it.
it('grows an automatic height inside the ladder until the furniture budget holds', () => {
  const fixture = getFixtures('mekko').find(f => f.id === 'unit-cost-staircase')!;
  const body = render({ spec: { type: 'mekko', data: fixture.data, options: { ...fixture.options, size: { width: 720 } } } }).body as any;
  expect(body.ok).toBe(true);
  expect(body.warnings.map((warning: any) => warning.code)).not.toContain('furniture-budget');
  expect(body.size.height).toBeGreaterThan(442);
  expect(body.size.height).toBeLessThanOrEqual(541);
  expect(measure({ type: 'mekko', data: fixture.data, options: { ...fixture.options, size: { width: 720 } } } as never).naturalHeight).toBe(body.size.height);
});

// Prevents measure from naming the height before the note growth: a card sized from it drew 465 px and sent labels to the note.
it('measures the height the note growth draws', () => {
  const fixture = getFixtures('combo').find(f => f.id === 'ranked-campaigns-key-shown')!;
  const spec = { type: 'combo', data: fixture.data, options: { ...fixture.options, size: { width: 320 } } };
  const body = render({ spec }).body as any;
  expect(body.size.height).toBeGreaterThan(465);
  expect(measure(spec as never).naturalHeight).toBe(body.size.height);
});

// Bubble matrices must keep their circles and rows unchanged when value labels or decimals change.
it('keeps bubble matrix geometry stable across value label settings and formats', () => {
  const data = {
    categories: Array.from({ length: 12 }, (_, ci) => ({ id: `c${ci}`, label: `Step ${ci + 1}` })),
    series: Array.from({ length: 6 }, (_, ri) => ({
      id: `s${ri}`, label: `Group ${ri + 1}`,
      values: Array.from({ length: 12 }, (_, ci) => ({ pct: 9 + (13 * ci + 17 * ri) % 62 })),
      sizes: Array.from({ length: 12 }, (_, ci) => 1 + (ci + ri) % 3),
    })),
  };
  const options = { variant: 'bubble', scale: 'discrete', breaks: [0, 30, 50, 100],
    bubble: { levels: ['Low', 'Medium', 'High'] }, title: 'Results by group and step' };
  const layout = (extra: Record<string, unknown>, size: { width: number; height?: number }) => {
    const result = layoutResolvedRequest(resolveChartRequest({ type: 'heatmap', data, options: { ...options, ...extra, size } }));
    if (result.refused) throw new Error(result.warnings[0]!.message);
    return result;
  };
  const geometry = (result: Geometry) => ({
    size: result.size,
    cells: result.scene.flatMap(node => node.t === 'rect' && node.part === 'cell' ? [node.rect] : []),
    circles: result.scene.flatMap(node => node.t === 'circle' && node.part === 'bubble' ? [{ id: node.id, cx: node.cx, cy: node.cy, r: node.r }] : []),
  });
  for (const size of [{ width: 960 }, { width: 960, height: 350 }]) {
    const reference = geometry(layout({}, size));
    expect(reference.circles).toHaveLength(72);
    for (const extra of [{}, { labels: false }, { labels: { point: false } }, { format: '1.0' }]) {
      const result = layout(extra, size);
      expect(geometry(result)).toEqual(reference);
      const values = result.scene.filter(node => node.t === 'text' && node.part === 'point');
      expect(values).toHaveLength('labels' in extra ? 0 : 24);
      if (values.length) expect(new Set(values.map(node => node.t === 'text' && node.font.size)).size).toBe(1);
    }
  }
});

// A levelled bubble matrix with no top-level cell prints its values in every circle, so its rows must stay tall enough for them.
it('prints every value of a levelled bubble matrix that holds no top-level cell', () => {
  const fixture = getFixtures('heatmap').find(f => f.id === 'survey-journey-bubbles')!;
  const data = structuredClone(fixture.data) as { series: { sizes: (number | null)[] }[] };
  for (const s of data.series) s.sizes = s.sizes.map(v => v === 3 ? 2 : v);
  const result = layoutResolvedRequest(resolveChartRequest({ type: 'heatmap', data, options: { ...fixture.options, size: { width: 960 } } }));
  if (result.refused) throw new Error(result.warnings[0]!.message);
  expect(result.scene.filter(node => node.t === 'text' && node.part === 'point')).toHaveLength(72);
});

// A host needs the refusal's minimum to size its card without a separate measurement.
it('keeps canDraw minimum on a fixed-size refusal', () => {
  expect(canDraw(shortCombo)).toMatchObject({ ok: false, code: 'size-below-floor', minimum: { width: 480, height: 240 } });
  const rendered = render({ spec: shortCombo }).body as any;
  expect(rendered.errors[0]).toMatchObject({ expected: { minimum: { width: 480, height: 240 } },
    fix: [{ op: 'replace', path: '/options/size', value: { width: 480, height: 240 } }] });
});

// A secondary-axis warning must not hide a size that clears the plot floor.
it('measures the first combo height without a size warning despite dual-axis', () => {
  const minimum = { width: 480, height: 272 };
  const measured = measure(shortCombo);
  expect(measured.refused!.warnings[0]).toMatchObject({ expected: { minimum }, fix: [{ op: 'replace', path: '/options/size', value: minimum }] });
  for (const body of [cliMeasure({ spec: shortCombo }).body, JSON.parse(callTool('boardplot_measure', { spec: shortCombo }).text)] as any[]) {
    expect(body.refused.required).toEqual(minimum);
  }
  const draw = (height: number) => render({ spec: { ...shortCombo, options: { ...shortCombo.options, size: { width: 480, height } } } }).body as any;
  expect(draw(271).warnings.some((warning: any) => warning.code === 'plot-under-floor')).toBe(true);
  expect(draw(272)).toMatchObject({ ok: true });
  expect(draw(272).warnings.map((warning: any) => warning.code)).toContain('dual-axis');
  expect(draw(272).warnings.map((warning: any) => warning.code)).not.toContain('plot-under-floor');
});

// Prevents a plot-height repair from returning the same plot-height warning.
it('verifies the complete frame at the height offered for a short plot', () => {
  for (const [type, id] of [['scatter', 'option-info-grid'], ['pareto', 'revenue-concentration']]) {
    const fixture = getFixtures(type!).find(f => f.id === id)!;
    const request = { type: type!, data: fixture.data, options: { ...fixture.options, size: { width: 400, height: 300 } } };
    expect(getChart(type!)!.layout(request.data, request.options).warnings.find(w => w.code === 'plot-under-floor')!.fix).toBeUndefined();
    for (const result of [measure(request)]) {
      const warning = result.warnings.find(w => w.code === 'plot-under-floor')!;
      expect(warning).toBeDefined();
      expect(warning.fix).toBeDefined();
      const drawn = render({ spec: applyRepair(request, warning.fix) }).body as any;
      expect(drawn.ok).toBe(true);
      expect(drawn.warnings.some((w: any) => w.code === 'plot-under-floor')).toBe(false);
      const repaired = measure(applyRepair(request, warning.fix));
      expect(repaired.geometry).toBeDefined();
      expect(repaired.warnings.filter(w => w.code === 'plot-under-floor')).toEqual([]);
    }
  }
});

// Prevents a size refusal from repairing to a chart with a new plot-height warning.
it('repairs a size refusal without adding a plot-height warning', () => {
  const fixture = getFixtures('line').find(f => f.id === 'recession-era-band')!;
  const request = { type: 'line', data: fixture.data, options: { ...fixture.options, size: { width: 480, height: 150 } } };
  const result = measure(request);
  const warning = result.refused!.warnings.find(w => w.code === 'size-below-floor')!;
  const repaired = measure(applyRepair(request, warning.fix));
  expect(repaired.geometry).toBeDefined();
  expect(repaired.warnings.filter(w => w.severity !== 'info')).toEqual([]);
  const direct = getChart('line')!.layout(request.data, request.options).warnings.find(w => w.code === 'size-below-floor')!;
  expect(direct.expected?.minimum).toBeDefined();
  expect(direct.fix).toBeDefined();
  const cli = render({ spec: request, return: ['svg'] }).body as { errors: { code: string; fix?: unknown }[] };
  expect(cli.errors.find(w => w.code === 'size-below-floor')!.fix).toBeDefined();
  for (const measured of [cliMeasure({ spec: request }).body,
    JSON.parse(callTool('boardplot_measure', { spec: request }).text)] as { refused: { required?: unknown } }[]) {
    expect(measured.refused.required).toEqual({ width: 480, height: 314 });
  }

  const map = getFixtures('tilemap').find(f => f.id === 'us-state-tile-grid')!;
  const mapRequest = { type: 'tilemap', data: map.data, options: { ...map.options, size: { width: 100 } } };
  const mapResult = measure(mapRequest);
  const mapFix = mapResult.refused!.warnings.find(w => w.code === 'size-below-floor')!.fix;
  expect(mapFix).toBeDefined();
  expect(measure(applyRepair(mapRequest, mapFix)).geometry).toBeDefined();
});

// Prevents size advice from claiming to repair a chart refused for its data.
it('gives no plot-height repair when a combo has a unit conflict', () => {
  const fixture = getRefusalExamples('combo').find(f => f.id === 'stacked-margin-line')!;
  const result = measure({ type: 'combo', data: fixture.data, options: { ...fixture.options, size: { width: 400, height: 300 } } });
  expect(result.refused).toBeDefined();
  expect(result.warnings.filter(w => w.code === 'plot-under-floor')).toEqual([]);
});

const line = getChart('line')!;
const fixture = getFixtures('line').find((f) => f.id === 'recession-era-band')!;
const at = (width: number, height: number, extra: object = {}) =>
  line.layout(fixture.data as never, { ...fixture.options, ...extra, size: { width, height } } as never) as Geometry & { refused?: boolean };

// Prevents a crowded full solve from blocking the alternate values with labels that the retry drops.
it('retries crowded value rows without their dropped neighbours', () => {
  const fixture = getFixtures('line').find(f => f.id === 'dense-20-categories-all-labels')!;
  const geo = line.layout(line.normalize!(fixture.data), { ...line.defaults, ...fixture.options, size: { width: 400 } } as never) as Geometry;
  const row = geo.labels.filter(l => l.kind === 'point' && l.owner.seriesId === 'returns');
  const categories = (fixture.data as { categories: { id: string }[] }).categories.map(c => c.id);
  expect(row.filter(l => !l.hidden).map(l => l.owner.categoryId).sort()).toEqual(categories.filter((_, i) => (categories.length - 1 - i) % 2 === 0).sort());
});

// Prevents an authored label string from being thinned, gated or stripped of its seats like a computed value.
it('keeps authored labels where a seat exists', () => {
  const layout = (type: string, id: string, width: number, edit: (data: any) => void, options: object = {}) => {
    const chart = getChart(type)!;
    const fixture = getFixtures(type).find(f => f.id === id)!;
    const data = structuredClone(fixture.data) as any;
    edit(data);
    return chart.layout(chart.normalize!(data), { ...chart.defaults, ...fixture.options, ...options, size: { width } } as never) as Geometry;
  };
  const drawn = (geo: Geometry, text: string) => geo.labels.some(l => l.text === text && !l.hidden);
  // A numeric-looking authored line label keeps the shifted and leader seats.
  expect(drawn(layout('line', 'dense-20-categories-all-labels', 320, d => { d.series[0].values[3] = { number: 441, label: '441' }; }), '441')).toBe(true);
  // An authored value in a thin top stacked band sits over the band on a leader.
  expect(drawn(layout('line', 'stacked100-area-thin-interior-bands', 640, d => { d.series[2].values[1] = { number: 3, label: 'AUTH' }; }), 'AUTH')).toBe(true);
  // Authored waterfall values stay out of the thinned value rows and pass the minimal density gate.
  const bridge = layout('waterfall', 'ebit-bridge', 320, d => {
    d.items[0].value = { number: 142, label: 'F21' };
    d.items[1].value = { number: 38, label: 'PRX' };
    d.items[4].value = { number: -24, label: 'CST' };
  }, { labelDensity: 'minimal' });
  expect(['F21', 'PRX', 'CST'].filter(text => drawn(bridge, text))).toEqual(['F21', 'PRX', 'CST']);
});

// Prevents a horizontal bridge from printing its highlighted step's value as plain secondary text.
it('keeps the highlighted step value bold in a horizontal waterfall', () => {
  const chart = getChart('waterfall')!;
  const fixture = getFixtures('waterfall').find(f => f.id === 'ebit-bridge')!;
  const geo = chart.layout(chart.normalize!(fixture.data), { ...chart.defaults, ...fixture.options, variant: 'horizontal', size: { width: 640 } } as never) as Geometry;
  const node = geo.scene.find(n => n.id === 'label:sum:price');
  expect(node?.t === 'text' && node.font.weight).toBeGreaterThan(400);
});

// Prevents explicit area endpoints from vanishing when their own stroke and the axis gutter leave a free seat.
it('keeps the first and last actual area values at their own points on narrow cards', () => {
  const fixture = getFixtures('line').find(f => f.id === 'area-focus-tint')!;
  for (const width of [640, 400]) {
    const geo = line.layout(line.normalize!(fixture.data), { ...line.defaults, ...fixture.options, size: { width } } as never) as Geometry;
    for (const [id, text] of [['point:revenue:jan', '11.2'], ['point:revenue:sep', '13.1']]) {
      const label = geo.labels.find(l => l.id === id)!;
      expect(label.hidden).toBeFalsy();
      expect(label.text).toBe(text);
      expect(label.leader).toBeUndefined();
      expect(label.slot).toMatch(/^above(?:Edge(?:High)?|Left)?$/);
    }
  }
});

// Prevents a valid tight inside segment label from being hidden by the roomier fit gate.
it('keeps a Mekko share in its tight top segment seat', () => {
  const chart = getChart('mekko')!;
  const fixture = getFixtures('mekko').find(f => f.id === 'torture-long-labels')!;
  const geo = chart.layout(chart.normalize!(fixture.data), { ...chart.defaults, ...fixture.options, size: { width: 480 } } as never) as Geometry;
  const label = geo.labels.find(l => l.id === 'segment:gamma:americas')!;
  expect(label.hidden).toBeUndefined();
  expect(label.text).toBe('9%');
  expect(label.slot).toBe('insideTightTop');
  expect(label.leader).toBeUndefined();
});

describe('below the minimum', () => {
  // A fixed card must give up its comfortable plot before moving its source off the canvas.
  it('keeps the frame at a short height with a readable plot under the comfort floor', () => {
    const result = at(480, 223);
    expect(result.refused).toBeUndefined();
    expect(result.size.height).toBe(223);
    expect(result.mode).toBe('compact');
    expect(result.plot.h).toBeGreaterThanOrEqual(40);
    expect(result.warnings.some(warning => warning.code === 'plot-under-floor')).toBe(true);
  });
  // A pinned card a few px short of the 80 px plot draws a smaller plot and names
  // the height it needs, instead of an empty refusal box.
  it('keeps the subtitle when it fits and draws under the plot floor before it refuses', () => {
    expect(at(480, 244).a11y.compactNotes ?? []).toEqual([]);
    const subtitle = at(480, 244).scene.find((node) => node.t === 'text' && node.id.includes('subtitle'));
    expect(subtitle?.t === 'text' && subtitle.lines.join(' ')).toMatch(/^Indexed volume\W+Q1 2024–Q2 2025$/);
    const short = at(480, 200);
    expect(short.refused).toBeUndefined();
    expect(short.size.height).toBe(200);
    const estimate = short.warnings.find((warning) => warning.code === 'plot-under-floor')!;
    expect(estimate.fix).toBeUndefined();
    expect(estimate.message).toContain('estimated height');
    expect(estimate.suggest).toContain('measure');
    const request = { type: 'line', data: fixture.data, options: { ...fixture.options, size: { width: 480, height: 200 } } };
    const repaired = render({ spec: applyRepair(request, measure(request).warnings.find((warning) => warning.code === 'plot-under-floor')!.fix) }).body as any;
    expect(repaired.ok).toBe(true);
    expect(repaired.warnings.some((warning: any) => warning.code === 'plot-under-floor')).toBe(false);
    const tiny = at(480, 150);
    expect(tiny.refused).toBe(true);
    const minimum = tiny.warnings[0]!.expected?.minimum as { width: number; height: number };
    expect(at(minimum.width, minimum.height).refused).toBeUndefined();
  });
  it("refuses with belowMinimum 'refuse' and names the full minimum", () => {
    const result = at(480, 200, { belowMinimum: 'refuse' });
    expect(result.refused).toBe(true);
    expect(result.warnings[0]!.expected?.minimum).toMatchObject({ width: 480, height: 270 });
  });
  it('refuses below the floor and names a minimum', () => {
    const result = at(480, 100);
    expect(result.refused).toBe(true);
    expect(result.warnings[0]!.message).toMatch(/needs at least \d+ × \d+px/);
  });
});

// A rectangle treemap must use the available card before refusing for its comfortable plot height.
it('draws a rectangle treemap card while preserving an explicit refusal policy', () => {
  const f = getFixtures('treemap').find(f => f.id === 'growth-rect')!;
  const request = { type: 'treemap', data: f.data, options: { ...f.options, target: 'dashboard' as const, size: { width: 400, height: 300 } } };
  const result = measure(request);
  expect(canDraw(request)).toEqual({ ok: true });
  expect(render({ spec: request }).body.ok).toBe(true);
  expect(result.geometry?.size).toEqual({ width: 400, height: 300 });
  expect(result.warnings.filter(warning => warning.code === 'plot-under-floor')).toHaveLength(1);
  expect(canDraw({ ...request, options: { ...request.options, belowMinimum: 'refuse' } }).ok).toBe(false);
});

// A tilemap must not refuse a smaller square lattice when every country code still fits.
// The card is below the eu27 floor (414 px high at 400 px wide), which needs seven tile rows.
// At 343 px the one-row stepped key leaves room for every code; the three-row swatch key did not.
it('draws readable tilemap codes in a fixed card before requiring full-width tiles', () => {
  const f = getFixtures('tilemap').find(f => f.id === 'eu27-equal-tiles')!;
  const request = { type: 'tilemap', data: f.data, options: { ...f.options, target: 'dashboard' as const, size: { width: 400, height: 343 } } };
  const geometry = measure(request).geometry!;
  expect(geometry?.size).toEqual({ width: 400, height: 343 });
  expect(geometry.labels.filter(label => label.kind === 'category' && label.hidden)).toEqual([]);
  expect(canDraw(request)).toEqual({ ok: true });
  expect(render({ spec: request }).body.ok).toBe(true);
  expect(canDraw({ ...request, options: { ...request.options, belowMinimum: 'refuse' } }).ok).toBe(false);
});

// An authored dot-axis title must reach the drawing instead of refusing the whole chart.
it('draws a dot value-axis title inside its fixed canvas', () => {
  const request = { type: 'dot', data: { categories: ['North', 'South'], series: [{ id: 'orders', values: [10, 20] }] },
    options: { target: 'dashboard' as const, size: { width: 400, height: 300 }, axisTitles: { primary: 'Orders, thousands' } } };
  expect(canDraw(request)).toEqual({ ok: true });
  expect(render({ spec: request }).body.ok).toBe(true);
  const geometry = measure(request).geometry!;
  const title = geometry.labels.find(label => label.kind === 'axisTitle' && label.text === 'Orders, thousands')!;
  expect(title.hidden).toBeUndefined();
  expect(title.rect.y + title.rect.h).toBeLessThanOrEqual(300);
  const hidden = measure({ ...request, options: { ...request.options, valueAxis: { show: false } } }).geometry!;
  expect(hidden.labels.filter(label => label.kind === 'axisTitle')).toEqual([]);
  // A title that wraps wider than the space left of the axis end still draws whole on the canvas.
  const long = 'Average orders per customer across all distribution channels, thousands';
  const wide = measure({ ...request, options: { ...request.options, axisTitles: { primary: long } } }).geometry!;
  const wideTitle = wide.labels.find(label => label.kind === 'axisTitle')!;
  expect(wideTitle.hidden).toBeUndefined();
  expect(wideTitle.rect.x).toBeGreaterThanOrEqual(0);
  expect(wideTitle.rect.x + wideTitle.rect.w).toBeLessThanOrEqual(400);
});

// Prevents a pinned card from growing past its size when static notes and source text need room.
it('fits a pinned tornado card and keeps its advertised repair inside the repaired frame', () => {
  const chart = getChart('bar')!;
  const fixture = getFixtures('bar').find(f => f.id === 'tornado-two-drivers')!;
  const draw = (size: { width: number; height: number }) => chart.layout(fixture.data, { ...fixture.options, size } as never);
  const size = { width: 320, height: 280 };
  const fitted = draw(size);
  expect(fitted.refused).toBeUndefined();
  expect(fitted.size).toEqual(size);
  const short = draw({ width: 320, height: 160 });
  expect(short.refused).toBe(true);
  expect(short.warnings[0]!.code).toBe('size-below-floor');
  const repair = short.warnings[0]!.expected!.minimum as { width: number; height: number };
  const repaired = draw(repair);
  expect(repaired.refused).toBeUndefined();
  expect(repaired.size).toEqual(repair);
});

// Prevents a pinned table or cohort card from printing its notes below the set height.
it('keeps pinned table-family cards at their set size', () => {
  for (const [type, id] of [['table', 'steering-executive-report'], ['cohort', 'cumulative-conversion-pure'], ['cohort', 'emphasis-disabled']]) {
    const fixture = getFixtures(type!).find(f => f.id === id)!;
    const result = getChart(type!)!.layout(fixture.data, { ...fixture.options, target: 'dashboard', size: { width: 400, height: 300 } } as never);
    expect(result.refused, id).toBeUndefined();
    expect(result.size, id).toEqual({ width: 400, height: 300 });
  }
});

describe('the cliff at the minimum', () => {
  const column = getChart('column')!;
  const crowded = { categories: Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, label: `Category number ${i}` })),
    series: [{ id: 's', label: 'S', values: Array.from({ length: 40 }, (_, i) => 10 + (i % 7)) }] };
  const lay = (size: { width: number; height: number }, extra: object = {}) =>
    column.layout(crowded as never, { title: 'T', size, ...extra } as never) as Geometry & { refused?: boolean };
  it('falls back to compact when full mode lacks room on a pinned canvas', () => {
    expect(lay({ width: 480, height: 260 }).mode).toBe('compact');
  });
  it("keeps the full-mode refusal under belowMinimum 'refuse' and names its minimum", () => {
    const result = lay({ width: 480, height: 260 }, { belowMinimum: 'refuse' });
    expect(result.refused).toBe(true);
    // The capped note (two lines) sets this floor; the 40 names listed in full needed 426.
    expect(result.warnings[0]!.expected?.minimum).toMatchObject({ width: 480, height: 270 });
  });
  it('refuses, naming the size compact needs, when compact does not fit either', () => {
    const tiny = lay({ width: 480, height: 150 });
    expect(tiny.refused).toBe(true);
    const minimum = tiny.warnings[0]!.expected?.minimum as { width: number; height: number };
    expect(minimum.height).toBeLessThan(270);
    expect(lay(minimum).refused).toBeUndefined();
  });
});

describe('the React placeholder', () => {
  const text = (strings?: { refusalMessage: string }) => renderToStaticMarkup(createElement(BoardplotTheme, { strings },
    createElement(ReaderBox, { theme: readerTheme(), kind: 'refused', size: { width: 300, height: 180 }, findings: [{ code: 'size-below-floor', message: 'Minimum 320 × 180 px.', expected: { minimum: { width: 320, height: 180 } } }] })));
  it('uses reader copy and defers legacy minimum templates with the full details', () => {
    expect(text()).toContain('This chart needs more room.');
    expect(text({ refusalMessage: 'Need {width}x{height}' })).toContain('data-bp-loading');
    expect(text({ refusalMessage: 'Mehr Platz.' })).toContain('Mehr Platz.');
  });
});

// Prevents the bullet's new compact floor from leaking where it does not hold: a narrow grid of
// bullet panels (10 px plots) and the compact-density bullet (120 px).
it('keeps the bullet compact floor out of grids and compact density', () => {
  const fixture = getFixtures('bullet')[0]!;
  const panel = { type: 'bullet', data: fixture.data, options: { ...fixture.options, title: undefined } };
  const grid = getChart('grid')!.layout({ layout: { columns: 2 }, panels: [panel, panel] } as never,
    { target: 'dashboard', size: { width: 320, height: 400 } } as never) as Geometry & { refused?: boolean };
  expect(grid.refused).toBe(true);
  const bullet = getChart('bullet')!;
  const dense = bullet.layout(fixture.data as never, { ...fixture.options, density: 'compact', target: 'report' } as never);
  expect(dense.sizing?.minWidth).toBe(120);
  expect(dense.sizing?.compactFloor).toBeUndefined();
});

// A grid with a waffle panel on a 280 px phone card refused (it needed 480 px); its compact form stacks the panels in one column and draws there.
it('draws a grid with a waffle panel on a phone card', () => {
  const fixture = getFixtures('grid').find(f => f.id === 'kpi-and-waffle')!;
  const { size: _size, ...options } = fixture.options as { size?: unknown };
  const shown = layoutResolvedRequest(resolveChartRequest({ type: 'grid', data: fixture.data, options: { ...options, size: { width: 280 } } } as never)) as unknown as Geometry & { refused?: boolean };
  expect(shown.refused).toBeFalsy();
  expect(shown.size.width).toBe(280);
  expect(shown.labels.filter(label => label.hidden)).toEqual([]);
});

// A one-panel, one-series waffle on a pinned slide stacked label, value and grid and drew a 28 px cell on a 528 px canvas; the value and label now stand beside the grid so the cell grows, and an unpinned height keeps the stack.
it('puts the value and label of a single waffle panel beside a grid that fills the pinned height', () => {
  const data = { categories: [{ id: 'all', label: 'Forest' }], series: [{ id: 'plus', label: 'Plus', values: [46.4] }] };
  const draw = (size: { width: number; height?: number }) => layoutResolvedRequest(resolveChartRequest({ type: 'waffle', data, options: { variant: 'cells', target: 'slide', subtitle: { measure: 'Share of land', period: 'FY26' }, size } } as never)) as unknown as Geometry<{ panels: { rect: { x: number; w: number } }[] }>;
  const pinned = draw({ width: 1184, height: 528 });
  const rect = pinned.marks.panels[0]!.rect;
  const value = pinned.labels.find(label => label.id === 'total:all')!;
  const name = pinned.labels.find(label => label.id === 'category:all')!;
  expect(rect.w).toBeGreaterThan(350);
  expect(value.hidden).toBeFalsy();
  expect(name.hidden).toBeFalsy();
  expect(value.rect.x).toBeGreaterThan(rect.x + rect.w);
  expect(name.rect.x).toBe(value.rect.x);
  expect(draw({ width: 1184 }).marks.panels[0]!.rect.w).toBeLessThan(rect.w);
});

// Prevents the side readout from taking away the old stacked form: heightFill 'none' must give back the exact stacked drawing on a pinned height.
it("keeps the stacked single waffle panel on a pinned height with heightFill 'none'", () => {
  const data = { categories: [{ id: 'all', label: 'Forest' }], series: [{ id: 'plus', label: 'Plus', values: [46.4] }] };
  const draw = (options: object) => layoutResolvedRequest(resolveChartRequest({ type: 'waffle', data, options: { variant: 'cells', target: 'slide', subtitle: { measure: 'Share of land', period: 'FY26' }, size: { width: 1184, height: 528 }, ...options } } as never)) as unknown as Geometry<{ panels: { rect: { x: number; w: number } }[] }>;
  const stacked = draw({ heightFill: 'none' });
  expect(stacked.marks.panels[0]!.rect.w).toBeLessThan(draw({}).marks.panels[0]!.rect.w);
  expect(stacked.labels.find(label => label.id === 'total:all')!.rect.x).toBeLessThan(stacked.marks.panels[0]!.rect.x + stacked.marks.panels[0]!.rect.w);
});

// Prevents waffle panels from cutting a long name in one cells row, and from leaving one square alone on a second row (7 + 1).
it('wraps waffle panels into evenly filled rows when a name is wider than its panel', () => {
  const rowsOf = (variant: string, labels: string[], width: number): number[] => {
    const data = { categories: labels.map(label => ({ id: label, label })), series: [{ id: 's', label: 'S', values: labels.map((_, i) => 20 + i * 7) }] };
    const shown = layoutResolvedRequest(resolveChartRequest({ type: 'waffle', data, options: { variant, size: { width } } } as never)) as unknown as Geometry & { marks: { panels: { rect: { y: number } }[] } };
    expect(cutLabels(shown)).toEqual([]);
    const ys = [...new Set(shown.marks.panels.map(panel => panel.rect.y))];
    return ys.map(y => shown.marks.panels.filter(panel => panel.rect.y === y).length);
  };
  expect(rowsOf('cells', ['Infrastructure', 'Manufacturing', 'Subscriptions', 'Distribution', 'International'], 440)).toEqual([3, 2]);
  expect(rowsOf('square', ['Retail stores', 'Gross margin', 'Intercontinental', 'Telecommunications', 'Licence income', 'Marketing spend', 'Online shop', 'Warehouse costs'], 760)).toEqual([4, 4]);
});

// Prevents a pinned waffle with two series from wrapping its panels into 3.6 px cells, or refusing a height where one row with cut names draws.
it('keeps one readable row when two wrapped waffle rows do not fit the pinned height', () => {
  const names = ['Telecommunications', 'Manufacturing', 'Subscriptions', 'Distribution', 'International'];
  const data = { categories: names.map(label => ({ id: label, label })), series: [{ id: 'a', label: 'Alpha', values: names.map(() => 20) }, { id: 'b', label: 'Beta', values: names.map(() => 30) }] };
  const shown = layoutResolvedRequest(resolveChartRequest({ type: 'waffle', data, options: { variant: 'cells', size: { width: 550, height: 300 } } } as never)) as unknown as Geometry & { refused?: boolean };
  expect(shown.refused).toBeUndefined();
  expect(shown.warnings.map(w => w.code)).not.toContain('waffle-cells-small');
});

// Prevents pinned pies from drawing a radius under 36 px or an explode that leaves the frame.
it('draws a compact pie only when the radius and the explode fit, and names a size that draws', () => {
  const pie = getChart('pie')!;
  const draw = (id: string, size: { width: number; height: number }, extra: object = {}) => {
    const f = getFixtures('pie').find(x => x.id === id)!;
    return pie.layout(f.data as never, { ...f.options, ...extra, size } as never) as Geometry & { refused?: boolean };
  };
  const compact = draw('dominant-slice', { width: 320, height: 240 });
  expect(compact.refused).toBeUndefined();
  expect(compact.mode).toBe('compact');
  const exploded = draw('full-explode-envelope', { width: 320, height: 240 });
  expect(exploded.refused).toBe(true);
  const repair = exploded.warnings[0]!.expected!.minimum as { width: number; height: number };
  expect(repair).toEqual({ width: 320, height: 283 });
  expect(draw('full-explode-envelope', repair).refused).toBeUndefined();
});

// Prevents a pie with labels off from leaving its colours unnamed and from growing taller than the labelled pie.
it('keeps the height of a pie with labels off and names its slices in a key', () => {
  const fixture = getFixtures('pie').find(f => f.id === 'doughnut-device-revenue')!;
  const draw = (extra: object) => layoutResolvedRequest(resolveChartRequest({
    type: 'pie', data: fixture.data, options: { ...fixture.options, ...extra } } as never)) as unknown as Geometry;
  const labelled = draw({});
  const off = draw({ labels: false });
  expect(off.size.height).toBe(labelled.size.height);
  expect(off.legend?.items.map(item => item.id)).toEqual(['mobile', 'pc', 'tablet']);
  expect(off.labels.filter(label => !label.hidden)).toEqual([]);
  expect(draw({ labels: false, legend: 'none' }).legend).toBeUndefined();
});

// Prevents a narrow diagram card from drawing one sibling group's frame inside another's (false nesting),
// from refusing a width-only request at its probe height, and from dropping or cutting an edge label without a note.
it('judges a narrow diagram card by its card and group text at its content height', () => {
  const node = (id: string, label: string, groupId?: string) => ({ id, kind: 'entity', shape: { kind: 'roundedRect' }, label, ...(groupId ? { groupId } : {}) });
  const edge = (from: string, to: string) => ({ id: `${from}-${to}`, source: { nodeId: from }, target: { nodeId: to } });
  const data = {
    groups: [{ id: 'ga', title: 'Group A' }, { id: 'gb', title: 'Group B' }],
    nodes: [node('ceo', 'Chief'), node('a', 'North', 'ga'), node('b', 'Centre', 'gb'), node('c', 'South', 'ga')],
    edges: [edge('ceo', 'a'), edge('ceo', 'b'), edge('ceo', 'c')],
  };
  const result = getChart('diagram')!.layout(data as never, { variant: 'hierarchy', target: 'report', size: { width: 400 } } as never);
  expect(result.refused).toBe(true);
  expect((result.warnings[0]!.expected!.minimum as { width: number }).width).toBe(480);
  const deep = getFixtures('diagram').find((f) => f.id === 'deep-hierarchy')!;
  expect(getChart('diagram')!.layout(deep.data as never, { ...deep.options, target: 'report', size: { width: 400 } } as never).refused).toBeUndefined();
  // Edge labels the narrow card would cut or hide keep the 480 px floor instead of vanishing without a note.
  const share = { nodes: [node('r', 'Parent'), node('a', 'Child 1'), node('b', 'Child 2')],
    edges: [{ ...edge('r', 'a'), label: 'Share 45%' }, { ...edge('r', 'b'), label: 'Share 45%' }] };
  const shared = getChart('diagram')!.layout(share as never, { variant: 'hierarchy', target: 'report', size: { width: 320 } } as never);
  expect(shared.refused).toBe(true);
  expect((shared.warnings[0]!.expected!.minimum as { width: number }).width).toBe(480);
  // Authored positions that collide only at the narrow width keep the 480 px floor too.
  const placed = { nodes: [{ ...node('a', 'Alpha'), position: { x: 0.42, y: 0.5 } }, { ...node('b', 'Beta'), position: { x: 0.58, y: 0.5 } }], edges: [edge('a', 'b')] };
  expect(getChart('diagram')!.layout(placed as never, { variant: 'hierarchy', target: 'report', size: { width: 320, height: 600 } } as never).refused).toBe(true);
});

// Prevents a badge from refusing a diagram and being named as the cause: a house header too short for its
// label beside a pill draws with the pill inside it, and a tree taller than its canvas names its labels, not a badge.
it('does not refuse a diagram for its badges', () => {
  const cell = (id: string, kind: string, label: string, extra: object = {}) => ({ id, kind, shape: { kind: 'rectangle' }, label, role: 'primary', ...extra });
  // Placeholder text of a given length: the badge fit depends on label length, not on its words.
  const filler = (name: string, length: number) => `${name} ${'text '.repeat(length)}`.slice(0, length).replace(/ $/, 'x');
  const initiatives = [82, 76, 64, 83, 64, 72, 82, 78, 75].map((length, i) => filler(`Initiative ${i + 1}`, length));
  const house = {
    groups: ['g1', 'g2', 'g3'].map((id, order) => ({ id, title: `Pillar ${order + 1}`, role: 'primary', order: order + 1 })),
    nodes: [
      cell('roof', 'vision', filler('Roof', 47), { shape: { kind: 'roof' } }),
      ...['g1', 'g2', 'g3'].flatMap((g, i) => [
        cell(`o${i}`, 'objective', filler(`Objective ${i + 1}`, [15, 17, 22][i]!), { groupId: g, badge: { text: String(i + 1), role: 'accent' } }),
        ...[1, 2, 3].map((row) => cell(`${g}-${row}`, 'initiative', initiatives[i * 3 + row - 1]!, { groupId: g, order: row, role: 'secondary' })),
      ]),
      ...[1, 2, 3].map((order) => cell(`e${order}`, 'enabler', `Enabler ${order}`, { order, role: 'muted' })),
      cell('base', 'foundation', filler('Base', 31)),
    ],
  };
  const crowded = getChart('diagram')!.layout(house as never, { variant: 'strategy-house', target: 'slide', size: { width: 960, height: 540, unit: 'pt' } } as never);
  expect(crowded.warnings.filter((warning) => warning.severity === 'error')).toEqual([]);
  const nodes = [cell('q', 'issue', filler('Question', 27)),
    ...[1, 2, 3, 4, 5, 6].map((n) => cell(`l${n}`, 'driver', filler(`Driver ${n}`, 46), { badge: { text: `H${n}`, role: 'accent' } }))];
  const edges = [1, 2, 3, 4, 5, 6].map((n) => ({ id: `e${n}`, source: { nodeId: 'q' }, target: { nodeId: `l${n}` } }));
  const tree = getChart('diagram')!.layout({ nodes, edges } as never, { variant: 'issue-tree', target: 'slide', size: { width: 1184, height: 200 } } as never);
  expect(tree.warnings.filter((warning) => warning.severity === 'error').map((warning) => warning.message).join(' ')).not.toMatch(/badge/i);
});

// Prevents a strategy house from refusing at half slide because a hyphenated name is one unbreakable word in a pillar,
// and a two-line label from sitting flush left in a centred cell.
it('breaks hyphenated house names at the hyphen instead of refusing', () => {
  const cell = (id: string, kind: string, label: string, extra: object = {}) => ({ id, kind, shape: { kind: 'rectangle' }, label, role: 'primary', ...extra });
  const house = {
    groups: ['g1', 'g2', 'g3'].map((id, order) => ({ id, title: `Pillar ${order + 1}`, role: 'primary', order: order + 1 })),
    nodes: [
      cell('roof', 'vision', 'Research and development expenses', { shape: { kind: 'roof' } }),
      cell('o0', 'objective', 'North-Westmoor (Riverland)', { groupId: 'g1' }),
      cell('o1', 'objective', 'Depreciation of fixed assets', { groupId: 'g2' }),
      cell('o2', 'objective', 'Depreciation and amortisation', { groupId: 'g3' }),
      cell('a', 'initiative', 'Northumberland-Westmoreland', { groupId: 'g2', order: 1, role: 'secondary' }),
      cell('b', 'initiative', 'Reinvoiced transportation costs', { groupId: 'g3', order: 1, role: 'secondary' }),
      cell('c', 'initiative', 'Selling and distribution overheads', { groupId: 'g1', order: 1, role: 'secondary' }),
      cell('e1', 'enabler', 'Other operating income', { order: 1, role: 'muted' }),
      cell('base', 'foundation', 'Income from equity-accounted firms'),
    ],
  };
  const half = getChart('diagram')!.layout(house as never, { variant: 'strategy-house', target: 'slide', size: { width: 432, height: 396, unit: 'pt' } } as never);
  if (half.refused) throw new Error('the house is refused at half a slide');
  expect(half.warnings.filter((warning) => warning.severity === 'error')).toEqual([]);
  // The three-line label of the first pillar is centred, not flush left.
  const aligned = half.scene.flatMap((n) => (n.t === 'text' && n.lines.length > 1 ? [n.align] : []));
  expect(aligned.length).toBeGreaterThan(0);
  expect(aligned.every((align) => align === 'middle')).toBe(true);
});

// Prevents measure and render from naming different floors: a height that render refuses, a card width
// that render refuses while measure says it draws, and a pinned choropleth that draws taller than measure says.
it('names the size that render draws in measure', () => {
  const names = ['Northern upland districts', 'Southern river valleys', 'Eastern coastal plains', 'Western forest foothills', 'Central market towns',
    'Island ferry crossings', 'Research and development expenses', 'Income from equity-accounted firms', 'Pension provisions, domestic'];
  const nodes = names.map((label, index) => ({ id: `n${index}`, kind: 'entity', shape: { kind: 'roundedRect' }, label, role: index === 0 ? 'accent' : 'primary', order: index }));
  const edges = [[0, 1], [0, 2], [1, 3], [2, 4], [1, 5], [2, 6], [1, 7], [2, 8]].map(([from, to]) => ({ id: `e${from}-${to}`, source: { nodeId: `n${from}` }, target: { nodeId: `n${to}` } }));
  const tree = { type: 'diagram', data: { nodes, edges }, options: { variant: 'hierarchy', title: 'Structure of the programme', source: 'Invented sample data' } };
  const needed = (cliMeasure({ spec: tree, width: 720 }).body as { minHeightAtWidth: number }).minHeightAtWidth;
  expect((render({ spec: { ...tree, options: { ...tree.options, size: { width: 720, height: needed } } } }).body as { ok: boolean }).ok).toBe(true);

  const steps = ['Fix lead qualification', 'Shorten the demo wait', 'Simplify legal terms', 'Launch referral scheme'].map((label, index) => ({
    id: `p${index}`, kind: 'step', shape: { kind: 'chevron' }, label, caption: `Sales ops, ${index + 4} weeks`, badge: { text: 'Sales ops', role: 'accent' }, order: index + 1, role: 'primary' }));
  const card = { type: 'diagram', data: { nodes: steps }, options: { variant: 'linear-process', title: 'Four steps take 28 weeks and start with lead qualification', subtitle: 'Owner and duration for each step', source: 'Invented plan', target: 'dashboard' } };
  const narrow = { ...card, options: { ...card.options, size: { width: 438 } } };
  const floor = (cliMeasure({ spec: narrow }).body as { minWidth: number }).minWidth;
  const refused = (render({ spec: narrow }).body as { errors: { code: string; fix: { value: { width: number } }[] }[] }).errors[0]!;
  expect(refused.code).toBe('size-below-floor');
  expect(refused.fix[0]!.value.width).toBe(floor);
  expect((render({ spec: { ...card, options: { ...card.options, size: { width: floor } } } }).body as { ok: boolean }).ok).toBe(true);

  // A width-only refusal at the chart's static floor advises the width alone, and that width draws.
  const football = getFixtures('bar').find((f) => f.id === 'valuation-football-field')!;
  const narrowBar = { type: 'bar', data: football.data, options: { ...football.options, size: { width: 150 } } };
  const barRefused = (render({ spec: narrowBar }).body as { errors: { code: string; fix: { value: { width: number; height?: number } }[] }[] }).errors[0]!;
  expect(barRefused.code).toBe('size-below-floor');
  expect(barRefused.fix[0]!.value).toEqual({ width: 280 });
  expect((render({ spec: { ...narrowBar, options: { ...narrowBar.options, size: barRefused.fix[0]!.value } } }).body as { ok: boolean }).ok).toBe(true);

  const map = { type: 'choropleth', data: { pack: 'dach', regions: [{ id: 'DE', value: 620.3 }, { id: 'AT', value: 618.9 }, { id: 'CH', value: 148.3 }] },
    options: { title: 'Value by region', unit: 'EUR m', source: 'Invented sample data', classes: 5, size: { width: 720, height: 270 } } };
  const drawn = (render({ spec: map }).body as { size: { height: number } }).size.height;
  expect((cliMeasure({ spec: map }).body as { size: { height: number } }).size.height).toBe(drawn);

  // A pin far taller than the map still finds the empty band: the canvas stays the pin plus the footer.
  const tall = { ...map, options: { ...map.options, size: { width: 720, height: 1200 } } };
  const found = (cliMeasure({ spec: tall }).body as { size: { height: number } }).size.height;
  expect(found).toBeLessThan(700);
  const fitted = { ...map, options: { ...map.options, size: { width: 720, height: Math.round((found - (drawn - 270)) * 10) / 10 } } };
  expect((render({ spec: fitted }).body as { size: { height: number } }).size.height).toBeCloseTo(found, 0);
});

// Prevents a pinned slope from refusing a 180–269 px slot where its end labels fit, from drawing a
// plot under 80 px there.
it('draws a pinned slope under its 270 px floor while its plot keeps 80 px', () => {
  const slope = getChart('slope')!;
  const spec = getFixtures('slope').find((f) => f.id === 'cost-per-unit-plants')!;
  const draw = (height: number) => slope.layout(spec.data as never,
    { ...spec.options, target: 'report', size: { width: 960, height } } as never) as Geometry & { refused?: boolean };
  const pinned = draw(240);
  expect(pinned.refused).toBeUndefined();
  expect(pinned.plot.h).toBeGreaterThanOrEqual(80);
  const short = draw(200);
  expect(short.refused).toBe(true);
  const minimum = short.warnings[0]!.expected?.minimum as { width: number; height: number };
  expect(minimum.height).toBeLessThan(270);
  expect(draw(minimum.height).refused).toBeUndefined();
});

// Prevents a pinned Pareto from dropping a value without a trace: the note's own line took plot
// height, a further total lost its seat, and neither the chart nor the note showed it.
it('names or counts every value a pinned Pareto hides', () => {
  const f = getFixtures('pareto').find((x) => x.id === 'revenue-concentration')!;
  const geo = getChart('pareto')!.layout(f.data as never,
    { ...f.options, target: 'dashboard', size: { width: 320, height: 353 } } as never) as Geometry & { refused?: boolean };
  expect(geo.refused).toBeUndefined();
  const hidden = geo.labels.filter((l) => l.hidden !== undefined && l.hidden !== 'redundant' && ['point', 'grandTotal'].includes(l.kind));
  expect(hidden.length).toBeGreaterThan(0);
  expect(hidden.filter((l) => !l.noted).map((l) => l.id)).toEqual([]);
  // A re-run that refuses keeps the last note: no value is marked noted that the drawn note neither names nor counts.
  const spike = getFixtures('pareto').find((x) => x.id === 'torture-pareto-spike')!;
  const capped = getChart('pareto')!.layout(spike.data as never,
    { ...spike.options, target: 'report', size: { width: 320, height: 425 }, notes: { maxListed: 2 } } as never) as Geometry;
  const drawn = (capped.frame.noteList ?? []).map((n) => n.text).join(' ');
  expect(capped.labels.filter((l) => l.hidden && l.noted && !l.noteCounted && !drawn.includes(l.text)).map((l) => l.id)).toEqual([]);
});

// A series is named on the chart when a drawn text it owns (an end name or its key entry) holds its name.
const namedOnChart = (geo: Geometry, id: string, name: string) => geo.scene.some((node) => node.t === 'text' && node.opacity !== 0
  && node.owner?.seriesId === id && node.lines.join(' ').includes(name));
const card = (type: string, data: object, options: object = {}, annotations: object[] = []) =>
  measure({ type, data, annotations, options: { title: 'A two-line title that wraps on a small dashboard card', ...options, target: 'dashboard', size: { width: 400, height: 300 } } } as never).geometry as Geometry;

// Prevents a pinned slope from dropping the end names of its context lines: since 0.41.0 no note names them.
it('names every line of a pinned slope at its end, one type step down when the rail needs it', () => {
  const names = ['Alpha Group', 'Beta Works', 'Gamma Labs', 'Delta Systems', 'Epsilon', 'Zeta Partners', 'Eta Cloud', 'Theta Soft', 'All others'];
  const ends = [[11, 25], [22, 20], [19, 15], [13, 11], [10, 9], [8, 7.5], [6, 5.2], [5.8, 4.2], [4.6, 3.1]];
  const geo = card('slope', { categories: [{ id: 'a', label: '2020' }, { id: 'b', label: '2025' }],
    series: names.map((label, i) => ({ id: `s${i}`, label, values: ends[i] })) }, { highlight: 's0', subtitle: { company: 'Research Group', measure: 'Market share', period: '2020 vs 2025' }, unit: '% of all seats', source: 'Invented data' });
  expect(names.filter((name, i) => !namedOnChart(geo, `s${i}`, name))).toEqual([]);
});

// Prevents a longer slope name from restoring two name columns and cutting other series names.
it('keeps compact slope names as one label grows at 400 px', () => {
  const fixture = getFixtures('slope').find(f => f.id === 'market-share-shift')!;
  const results = ['Brevinth', 'Brevinth Systems', 'Brevinth Software'].map(name => {
    const data = structuredClone(fixture.data) as SlopeChartData;
    data.series.find(s => s.id === 'brevinth')!.label = name;
    const geo = getChart('slope')!.layout(data as never, { ...fixture.options, size: { width: 400 } } as never) as Geometry;
    const labels = geo.labels.filter(label => label.kind === 'series' && !label.hidden);
    return {
      name,
      left: labels.filter(label => label.owner?.categoryId === '2020').map(label => label.text),
      right: labels.filter(label => label.owner?.categoryId === '2025').map(label => label.text),
    };
  });
  for (const result of results) {
    expect(result.left).toHaveLength(fixture.data.series.length);
    expect(result.left.every(text => !/[A-Za-z…]/.test(text)), result.name).toBe(true);
    expect(result.right).toContain('19.8 Software Company A');
    expect(result.right).toContain('15.2 Software Company B');
    expect(result.right).toContain('11.4 Software Company C');
    expect(result.right.some(text => text.includes(result.name)), result.name).toBe(true);
  }
});

// Prevents a wider slope from cutting names that its narrower compact layout prints whole.
it('keeps whole slope names when the two capped name columns gain room', () => {
  const fixture = getFixtures('slope').find(f => f.id === 'torture-long-labels')!;
  for (const width of [480, 500]) {
    const geo = getChart('slope')!.layout(fixture.data as never,
      { ...fixture.options, size: { ...fixture.options?.size as object, width } } as never) as Geometry;
    expect(geo.labels.filter(label => label.kind === 'series' && !label.hidden && label.title), `${width}px`).toEqual([]);
    expect((fixture.data as SlopeChartData).series.filter(series => !namedOnChart(geo, series.id, series.label ?? series.id)), `${width}px`).toEqual([]);
  }
});

// Prevents a compact slope from leaving a line unnamed when its second end label is off or dropped for density.
it('keeps a name for every line of a compact slope', () => {
  const name = 'InternationalTechnologyInfrastructureServicesAndConsultingDivision';
  const named = (geo: Geometry, id: string) => geo.scene.some(node => node.t === 'text' && node.opacity !== 0
    && node.owner?.seriesId === id && /[A-Za-z]{4}/.test(node.lines.join(' ')));
  const layout = (series: object[], width: number, height: number) => getChart('slope')!.layout({ categories: [{ id: 'a', label: '2020' }, { id: 'b', label: '2025' }], series } as never,
    { size: { width, height } } as never) as Geometry;
  const off = layout([{ id: 'intl', label: name, values: [10, { number: 20, label: false }] }, { id: 'other', label: 'Other', values: [20, 10] }], 960, 300);
  expect(named(off, 'intl')).toBe(true);
  const dense = Array.from({ length: 15 }, (_, i) => ({ id: `s${i}`, label: i === 0 ? name : `Unit ${String.fromCharCode(65 + i)}`,
    values: [{ number: 10 + 10 * i, priority: i === 0 ? 1000 : 100 }, { number: 20 + 10 * i, priority: i === 0 ? 1 : 100 }] }));
  // 360 px makes the slope compact for room, 960 px for a cut name.
  for (const width of [360, 960]) {
    const crowded = layout(dense, width, 250);
    expect(dense.filter(s => !named(crowded, s.id)).map(s => s.id), `${width}px`).toEqual([]);
  }
});

// Prevents both rails from dropping the same lines for density, which leaves those lines named nowhere.
it('names each crowded slope line on at least one rail', () => {
  const series = Array.from({ length: 15 }, (_, i) => ({ id: `s${i}`, label: `Unit ${String.fromCharCode(65 + i)} Holdings`, values: [10 + 10 * i, 20 + 10 * i] }));
  const geo = getChart('slope')!.layout({ categories: [{ id: 'a', label: '2020' }, { id: 'b', label: '2025' }], series } as never,
    { size: { width: 360, height: 250 } } as never) as Geometry;
  expect(series.filter(s => !namedOnChart(geo, s.id, s.label)).map(s => s.id)).toEqual([]);
  // A line without a first-rail name never takes the highlighted line's second label.
  const fixture = getFixtures('slope').find(f => f.id === 'dense-20-series')!;
  const dense = getChart('slope')!.layout(fixture.data as never, { ...fixture.options, size: { width: 400, height: 300 } } as never) as Geometry;
  expect(dense.labels.filter(label => label.owner?.seriesId === 'leipzig' && label.kind === 'series' && !label.hidden)).toHaveLength(2);
});

// Prevents an authored inline name that finds no seat from leaving its line unnamed: the key names the lines.
it('names inline lines in the key when an inline name finds no seat', () => {
  const f = getFixtures('line').find((x) => x.id === 'gap-bracket')!;
  const geo = card('line', f.data, { ...f.options }, f.annotations);
  expect(namedOnChart(geo, 'loyalty', 'Loyalty stores') && namedOnChart(geo, 'region', 'Regional average')).toBe(true);
});

// Prevents the key fallback from moving, reordering or relabelling a visible legend the author set: it already names every line.
it('keeps an authored legend as set when an inline name finds no seat', () => {
  const f = getFixtures('line').find((x) => x.id === 'gap-bracket')!;
  const geo = card('line', f.data, { ...f.options, legend: { position: 'bottom', order: ['region', 'loyalty'] } }, f.annotations);
  const text = (id: string) => geo.scene.flatMap((n) => n.t === 'text' && n.id === id ? [n.lines.join(' ')] : []).join('');
  expect(geo.legend!.rect.y).toBeGreaterThan(geo.plot.y + geo.plot.h);
  expect(geo.legend!.items.map((i) => [i.id, text(i.labelId)])).toEqual([['region', 'Regional average'], ['loyalty', 'Loyalty stores']]);
});

// Prevents a combo's axis title, the only key of its line, from losing its seat to a column total.
it('keeps the swatched axis title that keys a combo line over a column total it touches', () => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const geo = card('combo', { categories: months.map((m) => ({ id: m.toLowerCase(), label: m })), series: [
    { id: 'rev', label: 'Revenue', values: [410, 420, 415, 430, 440, 520, 445, 450, 390, 455, 470, 480] },
    { id: 'aov', label: 'Average order value', axis: 'secondary', kind: 'line', values: [58, 59, 58, 59, 59, 67, 59, 59, 51, 59, 60, 60] },
  ] }, { anomaly: { method: 'mad', baseline: 'median' }, secondaryAxis: { acknowledge: true }, dualAxis: { anatomy: true },
    axisTitles: { primary: 'Revenue, €k', secondary: 'Average order value, €' }, valueAxis: { show: true }, valueLabels: 'none',
    subtitle: { measure: 'Revenue and average order value', period: 'FY26 by month' } });
  expect(namedOnChart(geo, 'aov', 'Average order value')).toBe(true);
});

// Prevents an automatic height from stopping under its own plot share when a rotated category row takes part of each added px.
it('keeps the plot share of an automatic Pareto card whose rotated names grow with the canvas', () => {
  const names = ['Authentication service timeout during peak hours in all regions', 'Edge cache miss storm in one region only',
    'Primary database failover', 'Message queue backpressure', 'Expired intermediate certificate', 'Resolver flap',
    'Disk pressure on the ingest tier', 'Memory leak in the report renderer', 'Bad configuration rollout, staged',
    'Third-party payment provider degradation', 'Inter-zone network partition', 'Planned maintenance overrun'];
  const values = [992, 2, 1, 1, 1, 1, 0.5, 0.5, 0.4, 0.3, 0.3, 0];
  for (const width of [320, 400]) {
    const geo = measure({ type: 'pareto', data: { items: names.map((label, i) => ({ id: `c${i}`, label, value: values[i] })) },
      options: { title: 'Minutes of downtime by root cause', subtitle: { measure: 'Downtime', period: 'FY25' }, unit: 'minutes', threshold: 95, size: { width } } } as never).geometry as Geometry;
    expect(geo.plot.h / geo.size.height).toBeGreaterThanOrEqual(0.4);
  }
});

describe('size advice', () => {
  // Pairing the needed width with the auto height measured at the narrow width gives advice that
  // refuses again when applied, so an open height gets the width alone.
  it('advises a size that draws when the height is open', async () => {
    const { layoutResolvedRequest, resolveChartRequest } = await import('../src/core/request');
    const cohort = getFixtures('cohort').find((f) => f.id === 'retention-stepped-column')!;
    // Full mode: the compact form draws this table at 480 px.
    const layout = (size: object) => layoutResolvedRequest(resolveChartRequest({ type: 'cohort', data: cohort.data, options: { ...cohort.options, mode: 'full', size } as never }));
    const refused = layout({ width: 480 });
    expect(refused.refused).toBe(true);
    const fix = refused.warnings[0]!.fix![0]! as { value: { width: number; height?: number } };
    expect(fix.value.height).toBeUndefined();
    expect(layout(fix.value).refused).toBeUndefined();
  });

  // Prevents a size patch that loops or turns a drawn chart into a refusal: a size warning on a chart that
  // draws carries no height patch, and every patch from render and measure leads to a drawn chart at a new size,
  // also when the size came from a width or height argument that a spec patch would not change.
  it('names a size patch only at a drawn size, and following the patches never repeats a size', () => {
    const names = ['Field service', 'Net revenue', 'Order intake', 'Rhein-Main', 'Warehouse costs', 'Personnel costs', 'Turnover', 'Black Forest', 'Churn rate', 'Cost of sales', 'Saxony-Anhalt', 'Retail stores'];
    const column = (size: object) => ({ type: 'column', data: { categories: names.map((label, i) => ({ id: `c${i}`, label })), series: [
      { id: 'a', label: 'Partner channel', values: names.map((_, i) => (i % 5 === 0 ? 1e9 : 7.5e8)) },
      { id: 'b', label: 'Mid market', values: names.map((_, i) => (i % 3 === 0 ? 1.25e9 : 1.5e9)) },
    ] }, options: { title: 'Revenue by unit', unit: 'EUR', source: 'Invented data', variant: 'grouped', format: '1.2bn', size } });
    const labels = ['Schleswig-Holstein and Hamburg', 'Depreciation of fixed assets', 'Rebilled freight costs', 'Mecklenburg-Western Pomerania', 'Research and development expenses', 'Income from equity-accounted firms', 'Thuringia and Saxony-Anhalt', 'Pension provisions, domestic'];
    const diagram = (size?: object) => ({ type: 'diagram', data: { nodes: labels.map((label, i) => ({ id: `n${i}`, kind: 'entity', shape: { kind: 'roundedRect' }, label, role: i ? 'primary' : 'accent', order: i })),
      edges: [[0, 1], [0, 2], [1, 3], [2, 4], [1, 5], [2, 6], [1, 7]].map(([s, t], i) => ({ id: `e${i}`, source: { nodeId: `n${s}` }, target: { nodeId: `n${t}` } })) },
    options: { variant: 'hierarchy', title: 'Structure of the programme', source: 'Invented data', ...(size ? { size } : {}) } });
    const fixture = (type: string, id: string, size: object) => {
      const found = getFixtures(type as never).find(f => f.id === id)!;
      return { type, data: found.data, options: { ...found.options, size } };
    };
    // A request is a spec plus the CLI width and height. A patch aims at the spec or at one of those arguments.
    type Request = { spec: any; width?: number; height?: number };
    const apply = (request: Request, fix: { path: string }[]): Request => {
      const next = { ...request };
      const toSpec = fix.filter(op => !/^\/(width|height)$/.test(op.path));
      for (const op of fix.filter(op => /^\/(width|height)$/.test(op.path)) as { path: string; value: number }[]) (next as any)[op.path.slice(1)] = op.value;
      return toSpec.length ? { ...next, spec: applyRepair(next.spec, toSpec as never) } : next;
    };
    const sizePatches = (body: any) => [...(body.errors ?? []), ...(body.warnings ?? [])]
      .filter((item: any) => item.fix?.some((op: any) => op.path.endsWith('/options/size') || /^\/(width|height)$/.test(op.path)));
    const requests: [string, Request][] = [
      ['column 480x213', { spec: column({ width: 480, height: 213 }) }],
      ['column 480x270', { spec: column({ width: 480, height: 270 }) }],
      ['column 480x361', { spec: column({ width: 480, height: 361 }) }],
      ['column 360x202.5pt', { spec: column({ width: 360, height: 202.5, unit: 'pt' }) }],
      ['diagram 320x200', { spec: diagram({ width: 320, height: 200 }) }],
      ['diagram 320x200 by argument', { spec: diagram({ width: 800, height: 600 }), width: 320, height: 200 }],
      ['heatmap survey-journey-long-names 480x200', { spec: fixture('heatmap', 'survey-journey-long-names', { width: 480, height: 200 }) }],
      ['heatmap survey-journey-long-names 480x200 by argument', { spec: fixture('heatmap', 'survey-journey-long-names', { width: 800, height: 600 }), width: 480, height: 200 }],
      ['line recession-era-band 1200x200', { spec: fixture('line', 'recession-era-band', { width: 1200, height: 200 }) }],
    ];
    const sizeOf = (request: Request) => JSON.stringify([request.width, request.height, request.spec.options.size]);
    for (const [name, start] of requests) {
      const first = render(start).body as any;
      if (first.ok) expect(sizePatches(first), `${name}: render of a drawn chart names a size patch`).toEqual([]);
      // Every patch of render and of measure, applied once to the request, draws and names no size patch again.
      const patches = [...sizePatches(first), ...sizePatches(cliMeasure(start).body)];
      for (const item of patches) {
        const patched = apply(start, item.fix);
        expect(sizeOf(patched), `${name}: ${item.code} patch changes nothing`).not.toBe(sizeOf(start));
        const after = render(patched).body as any;
        expect(after.ok, `${name}: ${item.code} patch ${sizeOf(patched)} is refused`).toBe(true);
        expect(sizePatches(after), `${name}: ${item.code} patch ${sizeOf(patched)} draws with a size patch`).toEqual([]);
      }
      // Measure's own patches, followed one after another, end without a repeated size.
      let current = start;
      const seen = new Set<string>();
      for (let step = 0; step < 6; step++) {
        expect(seen.has(sizeOf(current)), `${name}: measure came back to ${sizeOf(current)}`).toBe(false);
        seen.add(sizeOf(current));
        const [next] = sizePatches(cliMeasure(current).body);
        if (!next) break;
        current = apply(current, next.fix);
      }
      expect(seen.size, `${name}: measure advice still going after 6 patches`).toBeLessThan(6);
    }
  });

  // Prevents the layout of a card (what React reports) from naming an estimated plot-floor height that refuses:
  // a heatmap at 414 px drew with an estimate of 518 px, and 518 px needs 566 px.
  it('reports the plot-floor estimate of a drawn layout with no patch', () => {
    const found = getFixtures('heatmap').find(f => f.id === 'survey-journey-long-names')!;
    const drawn = layoutResolvedRequest(resolveChartRequest({ type: 'heatmap', data: found.data, options: { ...found.options, size: { width: 480, height: 414 } } } as never));
    expect(drawn.refused).toBeUndefined();
    const floor = drawn.warnings.find(w => w.code === 'plot-under-floor')!;
    expect(floor.message).toContain('estimated height');
    expect(floor.fix).toBeUndefined();
  });

  // Prevents a plain render of a table from laying out a second, wider frame (1.6x to 2x slower than main) to name a
  // patch: a drawn table with a fixed height reports table-overflow with no patch, and measure names the height that draws.
  it('names the table-overflow height in measure, not in a plain render', () => {
    const found = getFixtures('table').find(f => f.id === 'cohort-heat-relative')!;
    const spec = { type: 'table', data: found.data, options: { ...found.options, size: { width: 1048, height: 379 } } };
    const drawn = render({ spec }).body as any;
    expect(drawn.ok).toBe(true);
    const plain = drawn.warnings.find((warning: any) => warning.code === 'table-overflow');
    expect(plain.fix).toBeUndefined();
    expect(plain.suggest).toContain('measure');
    const overflow = measure(spec).warnings.find(warning => warning.code === 'table-overflow')!;
    expect(overflow.fix).toBeDefined();
    const after = render({ spec: applyRepair(spec, overflow.fix) }).body as any;
    expect(after.ok).toBe(true);
    expect(after.warnings.map((warning: any) => warning.code)).not.toContain('table-overflow');
  });
});

describe('textScale under 1', () => {
  // A smaller scale stops each text at the target floor; a size the theme sets under the floor stays its own.
  it('keeps table heads at the floor, and an authored smaller head at its size', async () => {
    const { layoutResolvedRequest, resolveChartRequest } = await import('../src/core/request');
    const small = getFixtures('table').find((f) => f.id === 'text-scale-small')!;
    const heads = (options: object) => {
      const geo = layoutResolvedRequest(resolveChartRequest({ type: 'table', data: small.data, options: { ...small.options, size: { width: 720 }, ...options } as never })) as Geometry;
      return [...new Set(geo.scene.flatMap((n) => n.t === 'text' && n.part === 'tableHeader' ? [n.font.size] : []))];
    };
    expect(heads({})).toEqual([12]);
    const own = { preset: 'boardroom', overrides: { table: { head: { size: 8 } } } };
    for (const textScale of [1, 0.85, 0.5]) expect(heads({ textScale, theme: own })).toEqual([8]);
  });
});

// Prevents shared children from expanding into millions of placements or losing nodes.
it('places every shared-child diagram node once', () => {
  for (const variant of ['hierarchy', 'issue-tree'] as const) {
    const nodes: DiagramData['nodes'] = [{ id: 'root', kind: variant === 'hierarchy' ? 'entity' : 'issue', shape: { kind: 'rectangle' }, label: 'Root' }];
    const edges: NonNullable<DiagramData['edges']> = [];
    let previous = ['root'];
    for (let level = 1; level <= 25; level++) {
      const ids = [`${level}a`, `${level}b`];
      for (const id of ids) nodes.push({ id, kind: variant === 'hierarchy' ? 'entity' : 'driver', shape: { kind: 'rectangle' }, label: id });
      for (const target of ids) for (const source of previous) edges.push({ id: `${source}-${target}`, source: { nodeId: source }, target: { nodeId: target } });
      previous = ids;
    }
    // A short path to a deep child: the child stays below (right of) its deepest parent.
    edges.push({ id: 'root-25a', source: { nodeId: 'root' }, target: { nodeId: '25a' } });
    const result = layoutDiagram({ nodes, edges }, { variant, size: { width: 960, height: 540 } }, false);
    expect(result.marks.nodes.map(node => node.id).sort()).toEqual(nodes.map(node => node.id).sort());
    expect(result.marks.nodes.every(node => Object.values(node.rect).every(Number.isFinite))).toBe(true);
    const rect = new Map(result.marks.nodes.map(node => [node.id, node.rect]));
    const axis = variant === 'hierarchy' ? 'y' : 'x';
    expect(rect.get('25a')![axis]).toBeGreaterThan(rect.get('24a')![axis]);
  }
});

// Prevents an automatic height from dropping the event key's detail that a taller canvas holds.
it('keeps the full event key at an automatic height, whatever the series key does', () => {
  const f = getFixtures('line').find(f => f.id === 'events-key-only')!;
  const { size: _size, ...options } = f.options as { size?: unknown };
  const at = (width: number, legend?: 'none') => getChart('line')!.layout(f.data, { ...options, annotations: f.annotations, legend, size: { width } }) as Geometry;
  for (const width of [480, 800]) {
    const keyed = at(width);
    expect(keyed.warnings.map(warning => warning.code)).not.toContain('event-key-detail-omitted');
    expect(keyed.size.height).toBe(at(width, 'none').size.height);
  }
});

// A spec without the compact fallback reported the static floor, where it refuses.
it('reports no compact floor where belowMinimum refuses', () => {
  const fixture = getFixtures('dot').find(f => f.id === 'dot-range-benchmark')!;
  const measured = measure({ type: 'dot', data: fixture.data, options: { ...fixture.options, belowMinimum: 'refuse', size: { width: 480 } } } as never);
  expect(measured.compactFloor).toBeUndefined();
});

// measure reported a 320 x 28 compact floor for a two-panel bartable that refuses at 358 x 380, so a host laid out at a size that refuses.
it('reports a compact floor where the spec draws and names the compact size below the full floor', () => {
  const fixture = getFixtures('bartable').find(f => f.id === 'cascade-four-years')!;
  const floor = measure({ type: 'bartable', data: fixture.data, options: fixture.options }).compactFloor!;
  expect(floor.width).toBe(280);
  expect(canDraw({ type: 'bartable', data: fixture.data, options: { ...fixture.options, size: floor } }).ok).toBe(true);
  const refused = measure({ type: 'bartable', data: fixture.data, options: { ...fixture.options, size: { width: 358, height: 380 } } }).refused!;
  const minimum = refused.warnings[0]!.expected!.minimum as { width: number; height: number };
  expect(minimum.width).toBe(358);
  expect(canDraw({ type: 'bartable', data: fixture.data, options: { ...fixture.options, size: minimum } }).ok).toBe(true);
});

// The wider-card probe read an mm height as pixels and found no card that prints every name.
it('names a wider card for lost band names at a height authored in mm', () => {
  const fixture = getFixtures('waterfall').find(f => f.id === 'torture-long-labels')!;
  const at = (size: object) => layoutResolvedRequest(resolveChartRequest({ type: 'waterfall', data: fixture.data, options: { ...fixture.options, size } } as never));
  const px = at({ width: 240, height: 600 });
  const mm = at({ width: 240 * 25.4 / 96, height: 600 * 25.4 / 96, unit: 'mm' });
  expect(px.warnings[0]?.code).toBe('size-below-floor');
  expect(mm.warnings[0]?.code).toBe('size-below-floor');
  expect(mm.warnings[0]?.expected?.minimum).toEqual(px.warnings[0]?.expected?.minimum);
});

// A 360 px phone with a 16 px gutter and a 24 px card padding gives a chart 280 px; the column there was refused.
it('draws a column compact at 280 px, the phone card floor', () => {
  const fixture = getFixtures('column').find(f => f.id === 'grouped-average-marker')!;
  const result = getChart('column')!.layout(fixture.data, { ...fixture.options, size: { width: 280 } });
  expect(result.refused).toBeFalsy();
  expect((result as Geometry).mode).toBe('compact');
});

// Bold bullet row names cut "Order backlog (days)" at 360 to 440 px where regular names fit whole:
// a name that bold would cut prints the whole chart's names at the regular weight.
it('keeps bullet row names whole by giving up their bold weight', () => {
  const fixture = getFixtures('bullet').find(f => f.id === 'ops-dashboard')!;
  const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'bullet', data: fixture.data, options: { ...fixture.options, size: { width: 400, height: 500 } } }));
  if (geometry.refused) throw new Error('refused');
  const names = geometry.labels.filter(label => label.kind === 'category');
  expect(names.map(label => label.lines.join(' ')).sort()).toEqual((fixture.data as { rows: { label: string }[] }).rows.map(row => row.label).sort());
  expect(geometry.scene.filter(node => node.t === 'text' && node.id.startsWith('label:category:')).map(node => node.t === 'text' && node.font.weight)).not.toContain(600);
});

// measure named a width that draws only at a pinned height, so a host sizing a card from minWidth got a refusal.
it('names a minimum width that draws at the automatic height', () => {
  const series = ['Coastal freight, harbour logistics and bonded warehouse handling for bulk importers', 'Regional rail signalling, track renewal and level-crossing upkeep across older lines',
    'Municipal water treatment, sewer relining and storm-drain mapping for smaller towns', 'Orchard irrigation, frost protection and packing-shed cold chains for fruit growers',
    'Community library lending, archive scanning and reading rooms for rural districts', 'Ferry timetabling, pier maintenance and winter crew rosters for island crossings'];
  const data = {
    categories: ['Northern upland districts and hill farms', 'Southern river valleys and flood plains', 'Eastern coastal plains', 'Western forest foothills'].map((label, index) => ({ id: `c${index}`, label })),
    series: series.map((label, index) => ({ id: `s${index}`, label, values: [0, 1, 2, 3].map((value) => (value + index) % 5) })),
  };
  const options = { variant: 'harvey', scale: 'discrete', title: 'Long names read whole at a generous size', subtitle: { company: 'Invented Group', measure: 'Maturity, 0 = absent to 4 = leading', period: 'May 2026' }, source: 'Invented capability assessment, May 2026' };
  const { minWidth } = measure({ type: 'heatmap', data, options } as never);
  expect(canDraw({ type: 'heatmap', data, options: { ...options, size: { width: minWidth } } } as never)).toMatchObject({ ok: true });
});

// Prevents circular-process arrow labels from losing their last letters: the label box is as wide as its text, so no side padding may be taken from it.
it('prints a circular-process arrow label in full', () => {
  const names = ['Share results', 'Refer leads', 'Qualify fast', 'Deliver value'];
  const labels = ['proof', 'leads', 'deals', 'features'];
  const nodes = names.map((label, i) => ({ id: `s${i}`, kind: 'step', shape: { kind: 'circle' }, label, role: 'primary', order: i + 1 }));
  const edges = labels.map((label, i) => ({ id: `e${i}`, source: { nodeId: `s${i}` }, target: { nodeId: `s${(i + 1) % 4}` }, arrowEnd: true, label }));
  const body = render({ spec: { type: 'diagram', data: { nodes, edges }, options: { variant: 'circular-process', size: { width: 456 } } } }).body as any;
  expect(body.ok).toBe(true);
  expect(body.reading.labelsTruncated).toEqual([]);
});

// A 13-row bar on the default slide canvas was refused, while the same canvas written out as a size drew in compact mode.
it('draws compact on the default slide canvas as it does on the same size written out', () => {
  const categories = Array.from({ length: 13 }, (_, i) => `Region ${i + 1}`);
  const data = { categories, series: [{ id: 'rev', label: 'Revenue', values: categories.map((_, i) => 100 - 3 * i) }] };
  const draw = (options: object) => render({ spec: { type: 'bar', data, options: { title: 'Revenue by region', unit: '$m', ...options } } }).body as any;
  const slide = draw({ target: 'slide' });
  expect(slide.ok).toBe(true);
  expect(slide.reading.mode).toBe('compact');
  expect(slide.size).toEqual(draw({ target: 'slide', size: { width: 888, height: 396, unit: 'pt' } }).size);
  expect(draw({ target: 'slide', belowMinimum: 'refuse' }).errors[0].code).toBe('size-below-floor');
});

// A column of 20 long names at 320 px kept three names and listed the other 17 as redundant, so no fallback saw the loss.
it('draws a column whose names cannot fit or rotate as bars, or lists the names it drops', () => {
  const names = ['Automotive OEM', 'Automotive suppliers', 'Chemicals', 'Consumer goods', 'Energy utilities', 'Financial services', 'Food and beverage', 'Healthcare providers', 'Industrial machinery', 'Insurance',
    'Logistics', 'Media', 'Oil and gas', 'Pharmaceuticals', 'Retail', 'Software', 'Telecommunications', 'Transport', 'Utilities', 'Wholesale'];
  const data = { categories: names.map((label, i) => ({ id: `c${i}`, label })), series: [{ id: 's', label: 'Margin', values: names.map((_, i) => 8 + ((i * 7) % 23)) }] };
  const spec = (size: { width: number; height?: number }) => ({ type: 'column', data, options: { title: 'Margin by sector', unit: '%', size } });
  const hiddenNames = (geometry: Geometry) => geometry.labels.filter(label => label.kind === 'category' && label.hidden).map(label => label.hidden);
  const stepped = layoutResolvedRequest(resolveChartRequest(spec({ width: 320 }))) as Geometry;
  expect(stepped.type).toBe('bar');
  expect(stepped.warnings.map(w => w.code)).toContain('column-stepped-to-bar');
  expect(hiddenNames(stepped)).toEqual([]);
  // The records read the drawn bars: one per name.
  expect((render({ spec: spec({ width: 320 }) }).body as any).reading.values.total).toBe(20);
  // A pinned height that the rows do not fit keeps the column, and its dropped names are a loss, not redundant.
  const kept = layoutResolvedRequest(resolveChartRequest(spec({ width: 320, height: 443 }))) as Geometry;
  expect(kept.type).toBe('column');
  expect(hiddenNames(kept).length).toBeGreaterThan(0);
  expect(new Set(hiddenNames(kept))).toEqual(new Set(['density']));
  // A pinned height that holds every row draws the bars: the early out for short canvases skips only heights no row layout can hold.
  const tall = layoutResolvedRequest(resolveChartRequest(spec({ width: 320, height: 700 }))) as Geometry;
  expect(tall.type).toBe('bar');
  expect(hiddenNames(tall)).toEqual([]);
});

// A width pinned below the floor refuses, and the size search laid out a bar for every probe at the floor width, which the refusal never drew.
it('lays out no bar for the probes that price a refusal at a pinned width', () => {
  const names = Array.from({ length: 20 }, (_, i) => `Sector number ${i + 1} of the survey`);
  const data = { categories: names.map((label, i) => ({ id: `c${i}`, label })), series: [{ id: 's', label: 'Margin', values: names.map((_, i) => 8 + ((i * 7) % 23)) }] };
  barLayoutCalls.count = 0;
  const refused = layoutResolvedRequest(resolveChartRequest({ type: 'column', data, options: { title: 'Margin by sector', unit: '%', size: { width: 240 } } } as never)) as Geometry;
  expect(refused.refused).toBe(true);
  expect(barLayoutCalls.count).toBe(0);
});

// A pinned height between the row floor and the bar's real minimum laid out a bar before the column kept its place, which slowed those columns.
it('does not lay out a bar for a pinned height the bar rows and frame cannot fit', () => {
  const names = ['Automotive OEM', 'Automotive suppliers', 'Chemicals', 'Consumer goods', 'Energy utilities', 'Financial services', 'Food and beverage', 'Healthcare providers', 'Industrial machinery', 'Insurance',
    'Logistics', 'Media', 'Oil and gas', 'Pharmaceuticals', 'Retail', 'Software', 'Telecommunications', 'Transport', 'Utilities', 'Wholesale'];
  const data = { categories: names.map((label, i) => ({ id: `c${i}`, label })), series: [{ id: 's', label: 'Margin', values: names.map((_, i) => 8 + ((i * 7) % 23)) }] };
  const draw = (height: number) => {
    barLayoutCalls.count = 0;
    const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'column', data, options: { title: 'Margin by sector', unit: '%', source: 'Invented', size: { width: 320, height } } })) as Geometry;
    return { type: geometry.type, layouts: barLayoutCalls.count };
  };
  // 560 px is the rows alone at the row floor; the title and the source line need more.
  expect(draw(600)).toEqual({ type: 'column', layouts: 0 });
  const tall = draw(900);
  expect(tall.type).toBe('bar');
  expect(tall.layouts).toBeGreaterThan(0);
});

// A column that stepped to bars at 320 px took the bar's natural and comfortable sizes, so advice to widen drew a column at other sizes.
it('measures a column that stepped to bars with the natural sizes of the chart drawn at its natural width', () => {
  const names = Array.from({ length: 20 }, (_, i) => `Sector number ${i + 1} of the survey`);
  const data = { categories: names.map((label, i) => ({ id: `c${i}`, label })), series: [{ id: 's', label: 'Margin', values: names.map((_, i) => 8 + ((i * 7) % 23)) }] };
  const spec = (width: number) => ({ type: 'column', data, options: { title: 'Margin by sector', unit: '%', size: { width } } }) as never;
  const narrow = measure(spec(320));
  expect((narrow.geometry as Geometry).type).toBe('bar');
  const wide = measure(spec(narrow.naturalWidth));
  expect((wide.geometry as Geometry).type).toBe('column');
  expect([narrow.naturalHeight, narrow.comfortableWidth, narrow.comfortableHeight, narrow.fit]).toEqual([wide.naturalHeight, wide.comfortableWidth, wide.comfortableHeight, wide.fit]);
});

// tickStep is read by column and refused by bar, so a column that stepped to bars dropped it with no word.
it('keeps the column when a column-only value axis key is set', () => {
  const names = Array.from({ length: 20 }, (_, i) => `Sector number ${i + 1} of the survey`);
  const data = { categories: names.map((label, i) => ({ id: `c${i}`, label })), series: [{ id: 's', label: 'Margin', values: names.map((_, i) => 8 + ((i * 7) % 23)) }] };
  const draw = (valueAxis: object) => layoutResolvedRequest(resolveChartRequest({ type: 'column', data, options: { title: 'Margin by sector', unit: '%', size: { width: 320 }, valueAxis } } as never)) as Geometry;
  expect(draw({ show: true }).type).toBe('bar');
  expect(draw({ tickStep: 5 }).type).toBe('column');
});

// A 100% share column, and a stacked column with a PY reference, stepped to bars that drew absolute values and no growth labels, with no warning.
it('keeps the column when it draws shares of 100% or growth against a PY reference', () => {
  const names = Array.from({ length: 20 }, (_, i) => `Sector number ${i + 1} of the survey`);
  const categories = names.map((label, i) => ({ id: `c${i}`, label }));
  const values = (k: number) => names.map((_, i) => 8 + ((i * k) % 23));
  const draw = (series: object[], options: object) => layoutResolvedRequest(resolveChartRequest({ type: 'column', data: { categories, series }, options: { title: 'Margin by sector', size: { width: 320 }, ...options } } as never)) as Geometry;
  const two = [{ id: 'a', label: 'Online', values: values(7) }, { id: 'b', label: 'Stores', values: values(5) }];
  expect(draw(two, {}).type).toBe('bar');
  expect(draw(two, { valueAxis: { percent: true } }).type).toBe('column');
  const withPy = [...two, { id: 'py', label: 'PY', role: 'reference', scenario: 'PY', values: values(3).map((v) => v * 2) }];
  expect(draw(withPy, { variant: 'stacked' }).type).toBe('column');
});

// A column with a total category stepped to bars, which draw the total as one more plain row, with no gap, divider or bold type.
it('keeps the column when a category is a total', () => {
  const names = Array.from({ length: 20 }, (_, i) => `Sector number ${i + 1} of the survey`);
  const draw = (role?: 'total') => {
    const categories = names.map((label, i) => (i === 19 && role ? { id: `c${i}`, label, role } : { id: `c${i}`, label }));
    const data = { categories, series: [{ id: 's', label: 'Margin', values: names.map((_, i) => 8 + ((i * 7) % 23)) }] };
    return layoutResolvedRequest(resolveChartRequest({ type: 'column', data, options: { title: 'Margin by sector', unit: '%', size: { width: 320 } } } as never)) as Geometry;
  };
  expect(draw().type).toBe('bar');
  expect(draw('total').type).toBe('column');
});

// The step lost one more column setting in each review round, so a column steps to bars only when every setting and data key of the request is one a bar draws as a column does.
it('keeps the column for every setting a bar draws differently, drops or has not been checked', () => {
  const names = Array.from({ length: 20 }, (_, i) => `Sector number ${i + 1} of the survey`);
  const categories = names.map((label, i) => ({ id: `c${i}`, label }));
  const values = (k: number) => names.map((_, i) => 8 + ((i * k) % 23));
  const single = [{ id: 's', label: 'Margin', values: values(7) }];
  const stack = [{ id: 'a', label: 'Online', values: values(7) }, { id: 'b', label: 'Stores', values: values(5) }];
  const draw = (series: object[], options: object = {}, cats: object[] = categories) => {
    barLayoutCalls.count = 0;
    const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'column', data: { categories: cats, series }, options: { title: 'Margin by sector', unit: '%', size: { width: 320 }, ...options } } as never)) as Geometry;
    return { type: geometry.type, layouts: barLayoutCalls.count };
  };
  const at = (categoryId: string, seriesId = 's') => ({ categoryId, seriesId });
  const kept: [string, object[], object][] = [
    ['labels.segment content', stack, { variant: 'stacked', labels: { segment: ['absolute', 'percent'] } }],
    ['labels.point content', single, { labels: { point: ['absolute', 'category'] } }],
    ['labels.annotation off', single, { labels: { annotation: false }, annotations: [{ kind: 'note', at: at('c3'), text: 'A note' }] }],
    ['labels.growth', stack, { variant: 'stacked', labels: { growth: true } }],
    ['strings.range', single, { strings: { range: 'Spread' } }],
    ['two cagr annotations', single, { annotations: [{ kind: 'cagr', from: 'c0', to: 'c9' }, { kind: 'cagr', from: 'c9', to: 'c19' }] }],
    ['value line with a value and a span', single, { annotations: [{ kind: 'valueLine', value: 20, from: 'c3', to: 'c12' }] }],
    ['indicator100 on a raw stack', stack, { variant: 'stacked', annotations: [{ kind: 'indicator100' }] }],
    ['valueAxis.max', stack, { variant: 'stacked', valueAxis: { max: 50 } }],
    ['netLine.connectors', stack, { variant: 'stacked', netLine: { connectors: true } }],
    ['stacked100', stack, { variant: 'stacked100' }],
    ['scaleGroup', single, { scaleGroup: { y: 'g1' } }],
    ['story', single, { story: { steps: [{ id: 's1', title: 'One', highlight: 'c3' }] } }],
    ['embed', single, { embed: { width: 320 } }],
    ['cell range', [{ id: 's', label: 'Margin', values: values(7).map((v, i) => (i === 3 ? { number: v, range: { low: v - 3, high: v + 4 } } : v)) }], {}],
    ['cell details', [{ id: 's', label: 'Margin', values: values(7).map((v, i) => (i === 3 ? { number: v, details: { orders: 12 } } : v)) }], { detailFields: [{ key: 'orders' }] }],
  ];
  for (const [name, series, options] of kept) expect(draw(series, options), name).toEqual({ type: 'column', layouts: 0 });
  // What a bar draws as a column does still steps, so the list does not block the plain case.
  for (const [name, series, options] of [
    ['plain', single, {}],
    ['one cagr', single, { annotations: [{ kind: 'cagr' }] }],
    ['value line without a span', single, { annotations: [{ kind: 'valueLine', value: 20 }] }],
    ['value axis minimum', single, { valueAxis: { min: 5 } }],
    ['stack with labels', stack, { variant: 'stacked', labels: { restSeries: false }, strings: { net: 'Net' }, netLine: true }],
  ] as [string, object[], object][]) expect(draw(series, options).type, name).toBe('bar');
});

// The reading of a column that stepped to bars said column, so an agent reading it took the wrong chart type.
it('reports the drawn type in the reading of a column that stepped to bars', () => {
  const names = ['Automotive OEM', 'Automotive suppliers', 'Chemicals', 'Consumer goods', 'Energy utilities', 'Financial services', 'Food and beverage', 'Healthcare providers', 'Industrial machinery', 'Insurance',
    'Logistics', 'Media', 'Oil and gas', 'Pharmaceuticals', 'Retail', 'Software', 'Telecommunications', 'Transport', 'Utilities', 'Wholesale'];
  const data = { categories: names.map((label, i) => ({ id: `c${i}`, label })), series: [{ id: 's', label: 'Margin', values: names.map((_, i) => 8 + ((i * 7) % 23)) }] };
  const body = render({ spec: { type: 'column', data, options: { title: 'Margin by sector', unit: '%', size: { width: 320 } } }, return: ['reading'] }).body as any;
  expect(body.reading.type).toBe('bar');
});

// Taking owed off a thinned grand total let a pin override the thinning and hide a total the engine draws.
it('keeps the thinned grand total when a pin names another one', () => {
  const categories = Array.from({ length: 24 }, (_, i) => ({ id: `c${i}`, label: `Cat ${i + 1}` }));
  const data = { categories, series: [
    { id: 'a', label: 'A', values: categories.map((_, i) => 1200000 + i * 51234) },
    { id: 'b', label: 'B', values: categories.map((_, i) => 900000 + i * 31234) },
  ] };
  const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'column', data, options: { title: 'T', variant: 'stacked', size: { width: 560, height: 360 }, labelPlacements: { 'grandTotal:c0': 'aboveNeighbours' } } })) as Geometry;
  const shown = (id: string) => geometry.labels.some(label => label.id === `grandTotal:${id}` && label.hidden === undefined);
  expect(shown('c1')).toBe(true);
  expect(shown('c0')).toBe(false);
});

// A roadmap milestone is a small circle with its name outside, so its secondary text had no seat inside the circle and went to an off-page note.
it('draws a roadmap milestone secondary text under its name', () => {
  const lanes = [{ id: 'w1', label: 'Wave 1', orientation: 'vertical', role: 'category', paletteKey: 'w1', order: 1 }, { id: 'w2', label: 'Wave 2', orientation: 'vertical', role: 'category', paletteKey: 'w2', order: 2 }];
  const names = ['Pilot live', 'First ten sites', 'Platform v2 live', 'All sites live'];
  const nodes = names.map((label, i) => ({ id: `m${i}`, kind: 'milestone', shape: { kind: 'circle' }, label, secondaryLabel: `Q${i + 1} FY27`, laneId: i < 2 ? 'w1' : 'w2', role: 'category', paletteKey: i < 2 ? 'w1' : 'w2', order: i + 1 }));
  const body = render({ spec: { type: 'diagram', data: { lanes, nodes }, options: { variant: 'roadmap', title: 'Four milestones in two waves', source: 'Invented' } } }).body as any;
  expect(body.ok).toBe(true);
  expect(body.reading.omissions).toEqual([]);
  expect(body.warnings.filter((warning: { code: string }) => warning.code === 'diagram-secondary-label-unplaced')).toEqual([]);
});

// A milestone whose secondary text prints under its name must not open a hover card that only repeats that text.
it('opens no hover card for a roadmap secondary text printed under the name', () => {
  const lanes = [{ id: 'w1', label: 'Wave 1', orientation: 'vertical', role: 'category', paletteKey: 'w1', order: 1 }];
  const nodes = ['Pilot live', 'First ten sites', 'Platform v2 live', 'All sites live'].map((label, i) => ({ id: `m${i}`, kind: 'milestone', shape: { kind: 'circle' }, label, secondaryLabel: `Q${i + 1} FY27`, laneId: 'w1', role: 'category', paletteKey: 'w1', order: i + 1 }));
  const request = resolveChartRequest({ type: 'diagram', data: { lanes, nodes }, options: { variant: 'roadmap', title: 'Four milestones', source: 'Invented' } } as never);
  const geometry = layoutResolvedRequest(request) as Geometry;
  expect(geometry.labels.filter(label => label.id.startsWith('node-label:') && label.text.includes('\n') && !label.hidden).length).toBe(4);
  const records = interactionRecords({ request, geometry, scope: request.scope, claims: [] });
  expect(records.map(record => record.cardFields)).toEqual([[], [], [], []]);
  expect(records[0]!.fields.map(field => field.key)).toContain('secondaryLabel');
});

// Twelve milestones in three waves on a small canvas: every name must draw, as it does without secondary text.
it('keeps every roadmap milestone name when secondary text crowds the canvas', () => {
  const lanes = [0, 1, 2].map(i => ({ id: `w${i}`, label: `Wave ${i}`, orientation: 'vertical', role: 'category', paletteKey: `w${i}`, order: i + 1 }));
  const nodes = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, kind: 'milestone', shape: { kind: 'circle' }, label: `Milestone ${i} reached`, secondaryLabel: `Q${i % 4} FY27 delivery`, laneId: `w${i % 3}`, role: 'category', paletteKey: `w${i % 3}`, order: i + 1 }));
  const result = layoutDiagram({ lanes, nodes } as never, { variant: 'roadmap', size: { width: 700, height: 400 } } as never, false);
  expect(result.labels.filter(label => label.id.startsWith('node-label:') && label.hidden)).toEqual([]);
  expect(result.warnings.filter(warning => warning.code === 'diagram-node-label-unplaced')).toEqual([]);
});

// A cycle step whose node is tall enough keeps its secondary text inside, so the text must fit the node's own width, not the wider outside label.
it('keeps a cycle step secondary text inside its node', () => {
  const nodes = ['Share results', 'Refer leads', 'Qualify fast', 'Deliver value'].map((label, i) => ({ id: `s${i}`, kind: 'step', shape: { kind: 'circle' }, label, secondaryLabel: 'Customer reply within twenty-four hours', role: 'primary', order: i + 1 }));
  const edges = nodes.map((node, i) => ({ id: `e${i}`, source: { nodeId: node.id }, target: { nodeId: `s${(i + 1) % 4}` }, arrowEnd: true }));
  const result = layoutDiagram({ nodes, edges } as never, { variant: 'circular-process', size: { width: 700, height: 700 } } as never, false);
  const inside = result.labels.filter(label => label.slot === 'inside-secondary' && !label.hidden);
  expect(inside.length).toBeGreaterThan(0);
  for (const label of inside) {
    const node = result.marks.nodes.find(mark => mark.id === label.owner.pointId)!;
    expect(label.rect.w).toBeLessThanOrEqual(node.contentRect.w);
  }
});

// Prevents a bubble matrix with few wide columns from reserving a size key as tall as a column is wide: at a 380 pt
// height the key left the rows no room and the chart refused, though the bubbles it draws are small.
describe('bubble matrix key height', () => {
  const stages = ['Seed', 'Series A', 'Series B', 'Growth'];
  const sizes = [[4, 12, 30, 0], [3, 9, 22, 48], [0, 8, 26, 0], [2, 14, 0, 0], [0, 0, 35, 70], [5, 10, 18, 0], [2, 6, 20, 41], [6, 16, 0, 0]];
  const spec = (size: { width: number; height?: number; unit?: string }) => ({
    type: 'heatmap',
    data: {
      categories: stages.map((label, i) => ({ id: `c${i}`, label })),
      series: sizes.map((row, i) => ({ id: `s${i}`, label: `Company ${i + 1}`, values: row.map(v => (v > 0 ? v : null)), sizes: row })),
    },
    options: { variant: 'bubble', scale: 'discrete', breaks: [0, 50, 70, 100], bubble: { sizeLabel: 'Invested, EUR m', colorLabel: 'Invested, EUR m' }, title: 'Invested capital by stage', source: 'Invented ledger', target: 'slide', size },
  });

  it('draws at 380 pt of height', () => {
    expect(canDraw(spec({ width: 960, height: 380, unit: 'pt' }) as never)).toMatchObject({ ok: true });
  });

  it('keeps a content-fit height: the pinned render at the height it returns is the same SVG', () => {
    const open = render({ spec: spec({ width: 960 }), return: ['svg'] }).body as { svg: string; size: { width: number; height: number } };
    const pinned = render({ spec: spec({ width: open.size.width, height: open.size.height }), return: ['svg'] }).body as { svg: string };
    // The ids hash the request and the sizing attribute names the request's size; the drawing is the rest.
    const drawing = (svg: string) => svg.replace(/-[0-9a-f]{10}\b/g, '').replace(/ data-bp-sizing="[^"]*"/, '');
    expect(drawing(pinned.svg)).toBe(drawing(open.svg));
  });
});

// Prevents three diagrams from refusing or crowding on a wide, short full slide: the strategy house refused 28 px short,
// the eight-step stack refused 35 px short, and the six-step cycle drew a disc so wide that four of its six arrowheads were lost.
it('draws the house, the stack and the cycle on a full slide with the height they have', () => {
  const slide = { target: 'slide', size: { width: 888, height: 396, unit: 'pt' } };
  const draw = (spec: object) => render({ spec: { type: 'diagram', ...spec } }).body as any;
  const house = getFixtures('diagram').find(f => f.id === 'strategy-house')!;
  expect(draw({ data: house.data, options: { ...house.options, ...slide } }).ok).toBe(true);

  const named = (labels: string[], shape: string, extra: object = {}) => labels.map((label, i) => ({ id: `n${i}`, kind: 'step', shape: { kind: shape }, label, order: i + 1, role: 'primary', ...extra }));
  const long = ['Depreciation of fixed assets', 'Customer acquisition cost', 'Depreciation and amortisation', 'Pension provisions, domestic',
    'North-West Region (Lowlands)', 'Mid-Atlantic Operations', 'Change in net working capital', 'Maintenance and repair works'];
  expect(draw({ data: { nodes: named(long, 'chevron', { caption: 'Phase' }) }, options: { variant: 'linear-process', ...slide } }).ok).toBe(true);

  const cycle = draw({ data: { nodes: named(['Field service', 'Licence income', 'Net revenue', 'Upper region', 'Eastern Europe', 'Marketing spend'], 'circle') }, options: { variant: 'circular-process', ...slide } });
  expect(cycle.ok).toBe(true);
  expect(cycle.warnings.filter((warning: any) => warning.code === 'diagram-arrowhead-unplaced')).toEqual([]);
});

// Prevents the roof cut from hiding a required vision: a three-line vision on a 720 x 316 house that main draws was refused
// ("label unplaced") because the cut left the roof shorter than the vision's three lines.
it('keeps a three-line vision when the strategy house is a little short', () => {
  const node = (id: string, kind: string, label: string, extra: object = {}) => ({ id, kind, shape: { kind: kind === 'vision' ? 'roof' : 'rectangle' }, label, role: 'primary', ...extra });
  const data = {
    groups: [{ id: 'g', title: 'Grow', role: 'primary', order: 1 }],
    nodes: [node('v', 'vision', 'Trusted growth\npartner for\nevery customer'), node('o', 'objective', 'Grow', { groupId: 'g' }),
      node('a', 'initiative', 'New segments', { groupId: 'g', order: 1 }), node('b', 'initiative', 'Pricing', { groupId: 'g', order: 2 }),
      node('e', 'enabler', 'People', { order: 1 }), node('f', 'foundation', 'Customer trust')],
  };
  const body = render({ spec: { type: 'diagram', data, options: { variant: 'strategy-house', size: { width: 720, height: 316 } } } }).body as any;
  expect(body.errors).toEqual([]);
});
