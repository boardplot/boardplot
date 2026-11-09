/**
 * The unstacked area variant with several series.
 */
import { expect, it } from 'vitest';
import '../src/core/charts';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { requireGeometry } from '../src/core/sizing';
import type { LineMarks } from '../src/core/charts/line/layout';
import { contrastRatio } from '../src/core/color';
import { paintColor, resolveTheme, strokeToken } from '../src/core/theme';
import { arrowLook } from '../src/core/annotationArrow';
import type { Geometry, Paint } from '../src/core/types/scene';
import { getFixtures } from '../src/fixtures';
import { interactionRecords } from '../src/core/a11y/records';

// Hiding a point value must remove its automatic marker without losing the reading, its hover anchor, or a necessary notation cue.
it('keeps automatic markers with printed values without losing readings', () => {
  const draw = (series = {}, options = {}, categories: unknown[] = ['a', 'b', 'c']) => {
    const request = resolveChartRequest({ type: 'line',
      data: { categories, series: [{ id: 's', values: [10, { number: 12, label: false }, 14], ...series }] },
      options: { title: false, valueLabels: 'all', seriesLabels: 'none', size: { width: 640, height: 300 }, ...options },
    } as never);
    const geometry = requireGeometry(layoutResolvedRequest(request));
    const records = interactionRecords({ request, geometry, scope: request.scope, claims: [] });
    return { geometry, records };
  };
  const markerIds = (geometry: Geometry) => geometry.scene.filter(node => node.part === 'marker').map(node => node.owner.categoryId);
  const automatic = draw();
  expect(markerIds(automatic.geometry)).toEqual(['a', 'c']);
  const points = (automatic.geometry.marks as unknown as LineMarks).series[0]!.points;
  expect(points.map(point => point.categoryId)).toEqual(['a', 'b', 'c']);
  expect(points[1]!.nodeId).toBeUndefined();
  expect(automatic.records).toHaveLength(3);
  expect(automatic.records.every(record => record.anchor !== undefined)).toBe(true);
  expect(automatic.records.find(record => record.target.owner.categoryId === 'b')!.nodeIds).toEqual([]);
  expect(markerIds(draw({ marker: 'square' }).geometry)).toEqual(['a', 'b', 'c']);
  expect(markerIds(draw({}, { theme: { overrides: { marks: { lineMarkers: 'auto' } } } }).geometry)).toEqual(['a', 'b', 'c']);
  expect(markerIds(draw({}, { valueLabels: 'none', highlight: ['b'] }).geometry)).toEqual(['b']);
  expect(markerIds(draw({ marker: 'none' }, { highlight: ['b'] }).geometry)).toEqual([]);
  expect(markerIds(draw({}, { valueLabels: 'none' }, ['a', { id: 'b', partial: true }, 'c']).geometry)).toEqual(['b']);
  expect(markerIds(draw({ values: [10, null, 14], interpolateGaps: false }, { valueLabels: 'none' }).geometry)).toEqual(['a', 'c']);

  const categories = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, label: `M${i + 1}` }));
  const values = Array.from({ length: 10 }, (_, i) => 100 + i);
  const crowded = draw({ label: 'Sample series', values }, { seriesLabels: 'end', size: { width: 320, height: 300 } }, categories);
  const labels = crowded.geometry.labels.filter(label => label.kind === 'point');
  expect(labels.some(label => label.noted)).toBe(true);
  expect(markerIds(crowded.geometry)).toEqual(labels.filter(label => !label.hidden).map(label => label.owner.categoryId));
  expect(crowded.records).toHaveLength(10);
  expect(crowded.records.every(record => record.anchor !== undefined)).toBe(true);
  const sceneIds = new Set(crowded.geometry.scene.map(node => node.id));
  expect(crowded.records.every(record => record.nodeIds.every(id => sceneIds.has(id)))).toBe(true);
});

// An annotation must keep a visible target on a dense line even when the reading has no printed value.
it('keeps automatic markers at resolved annotation targets on a dense line', () => {
  const draw = (annotations: unknown[], marker?: string) => requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'line',
    data: { categories: Array.from({ length: 13 }, (_, i) => `c${i}`), series: [{ id: 's', values: Array.from({ length: 13 }, (_, i) => 10 + i), ...(marker ? { marker } : {}) }] },
    options: { title: false, valueLabels: 'none', seriesLabels: 'none', size: { width: 640, height: 300 }, annotations },
  } as never)));
  for (const at of [{ categoryId: 'c5', seriesId: 's' }, { categoryId: 'c5' }]) {
    const annotations = [{ kind: 'callout', at, text: 'Review', arrow: true }, { kind: 'text', at, text: 'Reading' }];
    const geometry = draw(annotations);
    const markers = geometry.scene.filter(node => node.part === 'marker');
    expect(markers.map(node => node.owner.categoryId)).toEqual(['c5']);
    const points = (geometry.marks as unknown as LineMarks).series[0]!.points;
    expect(points).toHaveLength(13);
    expect(points[5]!.nodeId).toBe(markers[0]!.id);
    expect(draw(annotations, 'none').scene.filter(node => node.part === 'marker')).toEqual([]);
  }
  expect(draw([{ kind: 'arrow', from: { categoryId: 'c1', value: 20 }, to: { categoryId: 'c5', value: 15 } }]).scene.filter(node => node.part === 'marker')).toEqual([]);
});

// Band names must not leave the plot when a wrap fits, or crowd marks by abandoning clear plot headroom.
it('keeps band names within the plot while preserving headroom seats and authored pins', () => {
  const fixture = getFixtures('line').find(item => item.id === 'shade-band-inside-wrap')!;
  for (const pinned of [false, true]) {
    const request = resolveChartRequest({ type: 'line', data: fixture.data, annotations: fixture.annotations,
      options: { ...fixture.options, ...(pinned ? { labelPlacements: { 'annotation:maintenance': 'aboveBandEnd' } } : {}) },
    } as never);
    const geometry = requireGeometry(layoutResolvedRequest(request));
    const band = geometry.scene.find(node => node.t === 'rect' && node.part === 'band' && node.owner.annotationId === 'maintenance');
    const label = geometry.labels.find(item => item.id === 'annotation:maintenance');
    if (band?.t !== 'rect' || !label) throw new Error('missing maintenance band or name');
    expect(label.hidden).toBeUndefined();
    if (pinned) {
      expect(label.slot).toBe('aboveBandEnd');
      expect(label.rect.y + label.rect.h).toBeLessThan(band.rect.y);
    } else {
      expect(label.lines).toEqual(['Planned', 'maintenance']);
      expect(label.rect.x).toBeGreaterThanOrEqual(band.rect.x + 4);
      expect(label.rect.x + label.rect.w).toBeLessThanOrEqual(band.rect.x + band.rect.w - 4);
      expect(label.rect.y).toBeGreaterThanOrEqual(band.rect.y + 4);
      expect(label.rect.y + label.rect.h).toBeLessThanOrEqual(band.rect.y + band.rect.h - 4);
    }
  }
  const sensors = getFixtures('line').find(item => item.id === 'x-time-uneven-sensors')!;
  const pinnedRequest = resolveChartRequest({ type: 'line', data: sensors.data, annotations: sensors.annotations,
    options: { ...sensors.options, labelPlacements: { 'annotation:band-1': 'topCenterInside' } },
  } as never);
  const pinnedLabel = requireGeometry(layoutResolvedRequest(pinnedRequest)).labels.find(item => item.id === 'annotation:band-1');
  expect(pinnedLabel?.hidden).toBeUndefined();
  expect(pinnedLabel?.slot).toBe('topCenterInside');
  expect(pinnedLabel?.lines).toEqual(['Pump offline']);
  const combo = getFixtures('combo').find(item => item.id === 'option-band-shade')!;
  const comboRequest = resolveChartRequest({ type: 'combo', data: combo.data, annotations: combo.annotations, options: combo.options } as never);
  const comboLabel = requireGeometry(layoutResolvedRequest(comboRequest)).labels.find(item => item.id === 'annotation:price-test');
  expect(comboLabel?.hidden).toBeUndefined();
  expect(comboLabel?.slot).toBe('aboveBand');
  expect(comboLabel?.lines).toEqual(['Price test']);
});

// Point emphasis must keep the line's ink and leave arrow tips and value labels clear of the enlarged marker.
it.each([360, 960])('emphasizes one line point without recolouring the line at %i px', (width) => {
  const draw = (highlight?: string, seriesId = 'load', overrides = {}) => {
    const request = resolveChartRequest({ type: 'line',
      data: { categories: ['a', 'b', 'c'], series: [{ id: seriesId, values: [48, 35, 53] }] },
      options: { size: { width, height: 360 }, valueAxis: { min: 30, max: 60 }, valueLabels: 'ends', theme: { overrides: { marks: { lineMarkers: 'auto' } } }, highlight, ...overrides },
      annotations: [{ kind: 'arrow', id: 'gap', from: { categoryId: 'b', value: 58 }, to: { categoryId: 'b', seriesId } }],
    } as never);
    return { geometry: requireGeometry(layoutResolvedRequest(request)), theme: request.theme };
  };
  const plain = draw();
  const focused = draw('b');
  const marker = (g: Geometry) => g.scene.find(node => node.part === 'marker' && node.owner.categoryId === 'b');
  const before = marker(plain.geometry), after = marker(focused.geometry);
  if (before?.t !== 'circle' || after?.t !== 'circle') throw new Error('missing circle marker');
  expect(after.r).toBeCloseTo(before.r * Math.max(1, strokeToken(focused.theme, 'focus') / strokeToken(focused.theme, 'data')));
  expect(after.r).toBeGreaterThan(before.r);
  expect(paintColor(focused.theme, after.fill!)).toBe(paintColor(focused.theme, { token: 'focus' }));
  const lineInk = (g: Geometry) => g.scene.filter(node => node.part === 'line').map(node => 'stroke' in node && { stroke: node.stroke, width: 'width' in node ? node.width : undefined });
  expect(lineInk(focused.geometry)).toEqual(lineInk(plain.geometry));
  const value = focused.geometry.labels.find(label => label.id === 'point:load:b');
  expect(value?.hidden).toBeUndefined();
  expect(value?.text).toBe('35');
  expect(value?.font?.weight ?? focused.theme.type.label.weight).toBe(focused.theme.type.label.weight);
  expect(paintColor(focused.theme, value!.ink)).toBe(paintColor(focused.theme, { token: 'focus' }));
  const head = focused.geometry.scene.find(node => node.t === 'path' && node.part === 'drawing' && node.owner.annotationId === 'gap');
  if (head?.t !== 'path') throw new Error('missing arrow head');
  const tip = /^M\s*([-\d.]+)[ ,]+([-\d.]+)/.exec(head.d)!;
  expect(after.cy - Number(tip[2])).toBeCloseTo(after.r + arrowLook(focused.theme, { size: 6 }).tipGap, 2);
  expect(focused.geometry.warnings.some(warning => warning.code === 'highlight-unknown-id')).toBe(false);
  for (const options of [{ labels: false }, { labels: { point: false } }, { valueLabels: 'none' }]) {
    expect(draw('b', 'load', options).geometry.labels.some(label => label.id === 'point:load:b' && !label.hidden)).toBe(false);
  }
  const shared = draw('b', 'b').geometry;
  const sharedMarker = marker(shared);
  expect(sharedMarker?.t === 'circle' && sharedMarker.r).toBe(before.r);
});

// Finite endpoint values and strict extrema keep their sides across widths, but reference lines must block a side seat instead of striking through its value.
it.each([360, 960])('places single-line values on the open side at %i px', (width) => {
  const draw = (pointLabelSide?: 'shape' | 'auto', labelPlacements?: Record<string, string>, reference = false) => requireGeometry(layoutResolvedRequest(resolveChartRequest({
    type: 'line', data: { categories: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], series: [{ id: 'load', values: [null, 52, 54, 50, 50, 35, 53, null] }] },
    options: { size: { width, height: 360 }, valueAxis: { min: 30, max: 60 }, valueLabels: 'all', ...(pointLabelSide ? { pointLabelSide } : {}), labelPlacements },
    annotations: reference ? [{ kind: 'valueLine', value: 53, label: 'Normal load' }] : [],
  } as never)));
  const shape = draw();
  const label = (g: Geometry, id: string) => g.labels.find(label => label.id === `point:load:${id}`)!;
  for (const [id, slot] of [['b', 'left'], ['c', 'above'], ['f', 'below'], ['g', 'right']]) {
    const value = label(shape, id!);
    expect(value.hidden).toBeUndefined();
    expect(value.slot).toBe(slot);
    expect(value.rect.x).toBeGreaterThanOrEqual(0);
    expect(value.rect.x + value.rect.w).toBeLessThanOrEqual(width);
  }
  const auto = draw('auto');
  for (const id of ['d', 'e']) expect(label(shape, id).slot).toBe(label(auto, id).slot);
  expect(label(auto, 'b').slot).not.toBe('left');
  expect(label(auto, 'g').slot).not.toBe('right');
  expect(label(draw(undefined, { 'point:load:b': 'below' }), 'b').slot).toBe('below');
  expect(label(draw(undefined, undefined, true), 'g').slot).toBe('above');
});

// A reference through an endpoint's side seat must move the value clear instead of leaving dash fragments beside the text.
it('keeps preferred endpoint values off numeric, computed and band references', () => {
  const references = [
    { annotations: [{ kind: 'valueLine', value: 53 }] },
    { annotations: [{ kind: 'valueLine', value: 'mean' }] },
    { anomaly: { method: 'mad', baseline: 'median' } },
    { anomaly: { method: 'threshold', high: 53 } },
    { annotations: [{ kind: 'band', style: 'corridor', low: 45, high: 53 }] },
  ];
  for (const reference of references) {
    const geometry = requireGeometry(layoutResolvedRequest(resolveChartRequest({
      type: 'line',
      data: { categories: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], series: [{ id: 'load', values: [52, 54, 53, 51, 55, 52, 54, 53] }] },
      options: { ...reference, valueLabels: 'last', seriesLabels: 'none', valueAxis: { min: 30, max: 60 }, size: { width: 720, height: 360 } },
    } as never)));
    const value = geometry.labels.find(label => label.id === 'point:load:h')!;
    const point = (geometry.marks as unknown as LineMarks).series[0]!.points.at(-1)!;
    expect(value.hidden).toBeUndefined();
    expect(value.slot, JSON.stringify(reference)).not.toBe('right');
    expect(value.rect.y + value.rect.h < point.y || value.rect.y > point.y).toBe(true);
  }
});

// A linear value axis misplaces values by orders of magnitude when a log axis is requested.
it('draws decade ticks evenly on a log axis and refuses zero', () => {
  const request = (values: number[]) => resolveChartRequest({
    type: 'line',
    data: { categories: ['a', 'b', 'c'], series: [{ id: 'users', values }] },
    options: { valueAxis: { log: true, show: true }, size: { width: 720, height: 540 } },
  } as never);
  const geometry = requireGeometry(layoutResolvedRequest(request([4, 100, 4000])));
  const ticks = geometry.axes.find((axis) => axis.axis === 'y')!.ticks;
  const positions = [10, 100, 1000].map((value) => ticks.find((tick) => tick.at === value)!.pos);
  expect(positions[0]! - positions[1]!).toBeCloseTo(positions[1]! - positions[2]!, 5);
  expect(() => layoutResolvedRequest(request([4, 0, 4000]))).toThrowError(expect.objectContaining({ code: 'log-nonpositive' }));
});

// Opaque fills down to the baseline hid a crossing series' area and showed the
// next one as a band that read as a stacked segment (124 over 96 read as 28).
it('fills only the lead series when an unstacked area draws crossing series', () => {
  const request = resolveChartRequest({
    type: 'line',
    data: {
      categories: ['FY20', 'FY21', 'FY22', 'FY23', 'FY24'],
      series: [
        { id: 'cloud', label: 'Cloud', values: [48, 66, 86, 118, 152] },
        { id: 'license', label: 'License', values: [124, 118, 109, 97, 88] },
        { id: 'maintenance', label: 'Maintenance', values: [96, 94, 92, 88, 80] },
      ],
    },
    options: { title: 'Revenue', variant: 'area', highlight: 'license', size: { width: 720 } },
  } as never);
  const layout = layoutResolvedRequest(request);
  const scene = (requireGeometry(layout) as Geometry).scene;
  const filled = new Set(scene.filter((node) => node.part === 'area').map((node) => node.owner?.seriesId));
  expect([...filled]).toEqual(['license']);
  for (const id of ['cloud', 'license', 'maintenance']) expect(scene.some((node) => node.part === 'line' && node.owner?.seriesId === id)).toBe(true);
  expect(layout.warnings.map((warning) => warning.code)).toContain('line-area-lead');
});

// The lead's fill blocked every other series' value over it: the last
// values of the lines under a rising lead fill were dropped from the chart.
it('prints a line value on the lead fill, in ink chosen against that fill', () => {
  const request = resolveChartRequest({
    type: 'line',
    data: {
      categories: ['FY20', 'FY21', 'FY22', 'FY23', 'FY24'],
      series: [
        { id: 'cloud', label: 'Cloud', values: [48, 66, 86, 118, 152] },
        { id: 'license', label: 'License', values: [124, 118, 109, 97, 88] },
      ],
    },
    options: { title: 'Revenue', variant: 'area', highlight: 'cloud', size: { width: 720 } },
  } as never);
  const labels = (requireGeometry(layoutResolvedRequest(request)) as Geometry).labels;
  const last = labels.find((label) => label.id === 'point:license:FY24');
  expect(last?.hidden).toBeUndefined();
  expect(last?.ink).toMatchObject({ theme: { kind: 'contrast-ink' } });
});

// The opaque lead fill covered an era shade drawn behind it: the band showed only
// above the fill, so the reader lost the period's start and end inside the plot.
it('cuts an era shade\'s edges through the area fill over the full plot height', () => {
  const request = resolveChartRequest({
    type: 'line',
    data: {
      categories: ['q1', 'q2', 'q3', 'q4', 'q5'],
      series: [
        { id: 'orders', label: 'Orders', values: [104, 92, 86, 95, 108] },
        { id: 'capacity', label: 'Capacity', values: [96, 95, 93, 96, 103] },
      ],
    },
    annotations: [{ kind: 'band', from: 'q2', to: 'q3', label: 'Recession' }],
    options: { title: 'Orders', variant: 'area', size: { width: 720 } },
  } as never);
  const scene = (requireGeometry(layoutResolvedRequest(request)) as Geometry).scene;
  const band = scene.find((node) => node.t === 'rect' && node.part === 'band');
  const edges = scene.filter((node) => node.part === 'bandEdge');
  if (band?.t !== 'rect') throw new Error('no era shade');
  expect(edges.map((node) => node.t === 'line' && [node.x1, node.x2, node.y1, node.y2])).toEqual([
    [band.rect.x, band.rect.x, band.rect.y, band.rect.y + band.rect.h],
    [band.rect.x + band.rect.w, band.rect.x + band.rect.w, band.rect.y, band.rect.y + band.rect.h],
  ]);
  expect(edges.every((node) => node.t === 'line' && 'token' in node.stroke && node.stroke.token === 'background')).toBe(true);
  // Over the fill, under the series lines.
  expect(scene.findIndex((node) => node.part === 'bandEdge')).toBeGreaterThan(scene.findIndex((node) => node.part === 'area'));
  expect(scene.findIndex((node) => node.part === 'bandEdge')).toBeLessThan(scene.findIndex((node) => node.part === 'line'));
});

// The lead fill drew after an earlier series' line and hid its dip; band edges then cut that line too.
it('draws every area fill and band edge under every series line', () => {
  const request = resolveChartRequest({
    type: 'line',
    data: {
      categories: ['q1', 'q2', 'q3', 'q4'],
      series: [
        { id: 'upper', label: 'Upper', values: [110, 70, 105, 112] },
        { id: 'lead', label: 'Lead', values: [100, 100, 100, 100] },
      ],
    },
    annotations: [{ kind: 'band', from: 'q2', to: 'q3', label: 'Era' }],
    options: { title: 'Order', variant: 'area', highlight: 'lead', size: { width: 720 } },
  } as never);
  const parts = (requireGeometry(layoutResolvedRequest(request)) as Geometry).scene.map((node) => node.part);
  const firstLine = parts.indexOf('line');
  expect(parts.lastIndexOf('area')).toBeLessThan(firstLine);
  expect(parts.lastIndexOf('bandEdge')).toBeLessThan(firstLine);
  expect(parts.filter((part) => part === 'bandEdge')).toHaveLength(2);
});

// The opaque lead fill covered the value-axis shadings drawn behind it, so a corridor,
// a tolerance band or an attainment fill lost the part of its range below the fill top.
it('lets every value-axis shading read through the area fill', () => {
  const request = resolveChartRequest({
    type: 'line',
    data: {
      categories: ['q1', 'q2', 'q3', 'q4'],
      series: [{ id: 'volume', label: 'Volume', values: [86, 91, 88, 97] }],
    },
    annotations: [
      { kind: 'band', id: 'corridor', style: 'corridor', low: 40, high: 60 },
      { kind: 'band', id: 'tolerance', style: 'tolerance', low: 20, high: 30 },
      { kind: 'band', id: 'attainment', style: 'attainment', value: 80 },
      { kind: 'valueLine', id: 'target', value: 70, tolerance: 5 },
    ],
    options: { title: 'Volume', variant: 'area', size: { width: 720 } },
  } as never);
  const scene = (requireGeometry(layoutResolvedRequest(request)) as Geometry).scene;
  const over = scene.filter((node) => node.part === 'shadingOverFill');
  expect([...new Set(over.map((node) => node.owner.annotationId))].sort()).toEqual(['attainment', 'corridor', 'target', 'tolerance']);
  const parts = scene.map((node) => node.part);
  expect(parts.indexOf('shadingOverFill')).toBeGreaterThan(parts.lastIndexOf('area'));
  expect(parts.lastIndexOf('shadingOverFill')).toBeLessThan(parts.indexOf('line'));
});

// An actual or forecast corridor takes the untinted era paint, so it was read as an
// era shade and stayed hidden under the fill: only two page-colour edges showed.
it('lets an actual and a forecast corridor read through the area fill', () => {
  for (const scenario of ['AC', 'FC'] as const) {
    const request = resolveChartRequest({
      type: 'line',
      data: { categories: ['q1', 'q2', 'q3'], series: [{ id: 'volume', label: 'Volume', values: [86, 91, 88] }] },
      annotations: [{ kind: 'band', id: 'corridor', style: 'corridor', low: 40, high: 60, scenario }],
      options: { title: 'Volume', variant: 'area', size: { width: 720 } },
    } as never);
    const scene = (requireGeometry(layoutResolvedRequest(request)) as Geometry).scene;
    expect(scene.some((node) => node.part === 'shadingOverFill' && node.owner.annotationId === 'corridor'), scenario).toBe(true);
    expect(scene.some((node) => node.part === 'bandEdge'), scenario).toBe(false);
  }
});

// An area's own value inside its fill printed in page ink: dark text on a dark fill.
it('prints an area value on its own fill in ink chosen against that fill', () => {
  const request = resolveChartRequest({
    type: 'line',
    data: { categories: ['q1', 'q2', 'q3', 'q4'], series: [{ id: 'volume', label: 'Volume', values: [86, 91, 88, 97] }] },
    annotations: [{ kind: 'valueLine', id: 'target', value: 90, label: 'Target', side: 'left', tolerance: 5 }],
    options: { title: 'Volume', variant: 'area', size: { width: 720 } },
  } as never);
  const geometry = requireGeometry(layoutResolvedRequest(request)) as Geometry;
  const first = geometry.labels.find((label) => label.id === 'point:volume:q1' && !label.hidden);
  const fill = geometry.scene.find((node) => node.part === 'area');
  if (!first || fill?.t !== 'path') throw new Error('no first value or fill');
  expect(first.rect.y).toBeGreaterThan((geometry.marks as unknown as LineMarks).series[0]!.points[0]!.y);
  expect(first.ink).toMatchObject({ theme: { kind: 'contrast-ink', fill: fill.fill } });
});

// A valueLine attainment escaped the shading guard: values sat on its mix in ink
// chosen against the plain fill (studio: white at about 4:1).
it('keeps other values off a fill that an attainment shades', () => {
  const request = resolveChartRequest({
    type: 'line',
    data: {
      categories: ['a', 'b', 'c', 'd', 'e'],
      series: [
        { id: 'back', label: 'Back', colorRole: 'highlight', values: [150, 150, 150, 150, 150] },
        { id: 'other', label: 'Other', values: [80, 80, 80, 80, 80] },
      ],
    },
    annotations: [{ kind: 'valueLine', value: 0, attainment: { seriesId: 'back' }, label: false }],
    options: { title: 'Attainment', variant: 'area', valueLabels: 'all', theme: 'studio', size: { width: 720 } },
  } as never);
  const labels = (requireGeometry(layoutResolvedRequest(request)) as Geometry).labels.filter((label) => label.owner.seriesId === 'other' && !label.hidden);
  expect(labels.some((label) => 'token' in label.ink && label.ink.theme?.kind === 'contrast-ink')).toBe(false);
});

// A corridor under stacked bands stayed hidden: shadings were mixed into unstacked fills only.
it('lets a corridor read through stacked and stacked100 bands, under the seams between them', () => {
  for (const variant of ['stacked-area', 'stacked100-area'] as const) {
    const request = resolveChartRequest({
      type: 'line',
      data: { categories: ['q1', 'q2', 'q3'], series: [{ id: 'online', label: 'Online', values: [30, 34, 38] }, { id: 'stores', label: 'Stores', values: [20, 22, 21] }] },
      annotations: [{ kind: 'band', id: 'corridor', style: 'corridor', low: variant === 'stacked-area' ? 25 : 40, high: variant === 'stacked-area' ? 45 : 70 }],
      options: { title: 'Bookings', variant, size: { width: 720 } },
    } as never);
    const scene = (requireGeometry(layoutResolvedRequest(request)) as Geometry).scene;
    const over = scene.filter((node) => node.part === 'shadingOverFill');
    expect(over.length, variant).toBe(2);
    // The page-colour edge between the bands draws over every mix.
    const seam = scene.findIndex((node) => (node.part === 'line' || node.part === 'areaSeparator') && node.owner.seriesId === 'online');
    expect(seam, variant).toBeGreaterThan(scene.map((node) => node.part).lastIndexOf('shadingOverFill'));
  }
});

// Phases on an area refused the chart while the message said only the phase fills were left out; the phase fills are that area.
it('draws phases as the fill of an area, and refuses them on stacked bands with a message that says so', () => {
  const spec = (variant: 'area' | 'stacked-area') => ({
    type: 'line',
    data: { categories: ['q1', 'q2', 'q3', 'q4'], series: [{ id: 'time', label: 'Cycle time', values: [12, 10, 7, 9] }] },
    options: { title: 'Cycle time', variant, size: { width: 720 }, phases: [{ id: 'before', label: 'Before', from: 'q1', to: 'q2' }, { id: 'after', label: 'After', from: 'q3', to: 'q4' }] },
  }) as never;
  const scene = (requireGeometry(layoutResolvedRequest(resolveChartRequest(spec('area')))) as Geometry).scene;
  expect(scene.filter((node) => node.part === 'phaseFill')).toHaveLength(2);
  expect(scene.some((node) => node.part === 'area')).toBe(false);
  const refused = layoutResolvedRequest(resolveChartRequest(spec('stacked-area'))) as { warnings?: { code: string; message: string }[] };
  const warning = (refused.warnings ?? (refused as { geometry?: Geometry }).geometry?.warnings ?? []).find((w) => w.code === 'phases-invalid');
  expect(warning?.message).toMatch(/refused/);
  expect(warning?.message).not.toMatch(/suppressed/);
});

// A band that starts or ends next to an n.m., missing or negative category centred its value on the band's end:
// half on the page, the value read "%" or "5%" for "25%".
it('keeps every stacked value wholly on its band or wholly off it, at both ends of a band', () => {
  const cats = ['north', 'south', 'east', 'west', 'central'];
  const cases: [string, 'stacked-area' | 'stacked100-area', (number | null)[][]][] = [
    ['n.m. first', 'stacked100-area', [[0.6, 0.25, 0.33, 0.4, 0.3], [0.6, 0.5, 0.33, 0.3, 0.3], [0.1, 0.25, 0.34, 0.3, 0.4]]],
    ['negative middle', 'stacked100-area', [[25, 25, 33, 40, 30], [50, 50, -5, 30, 30], [25, 25, 34, 30, 40]]],
    ['n.m. last', 'stacked100-area', [[0.25, 0.33, 0.4, 0.3, 0.6], [0.5, 0.33, 0.3, 0.3, 0.6], [0.25, 0.34, 0.3, 0.4, 0.1]]],
    ['missing ends', 'stacked-area', [[null, 25, 33, 40, null], [50, 50, 30, 30, 30], [25, 25, 34, 30, 40]]],
  ];
  for (const [name, variant, values] of cases) {
    const fraction = values.flat().every((v) => v === null || Math.abs(v) <= 1);
    const request = resolveChartRequest({
      type: 'line',
      data: { ...(fraction ? { valueKind: 'fraction' } : {}), categories: cats, series: ['web', 'store', 'app'].map((id, k) => ({ id, label: id, values: values[k] })) },
      options: { title: 'Channel share', variant, valueLabels: 'all', size: { width: 720 } },
    } as never);
    const geometry = requireGeometry(layoutResolvedRequest(request)) as Geometry;
    // Each series' fill as x spans, its sections joined.
    const spans = new Map<string, [number, number][]>();
    for (const node of geometry.scene) {
      if (node.part !== 'area' || node.t !== 'path') continue;
      const xs = [...node.d.matchAll(/[ML]([\d.-]+) /g)].map((m) => Number(m[1]));
      const list = spans.get(node.owner.seriesId!) ?? [];
      const span: [number, number] = [Math.min(...xs), Math.max(...xs)];
      const joined = list.find((s) => Math.abs(s[1] - span[0]) < 0.5 || Math.abs(span[1] - s[0]) < 0.5);
      if (joined) { joined[0] = Math.min(joined[0], span[0]); joined[1] = Math.max(joined[1], span[1]); } else list.push(span);
      spans.set(node.owner.seriesId!, list);
    }
    const labels = (geometry.labels ?? []).filter((label) => label.kind === 'point' && label.rect);
    expect(labels.length, name).toBeGreaterThan(0);
    for (const label of labels) {
      const { x, w } = label.rect!;
      const own = spans.get(label.owner.seriesId!) ?? [];
      const crosses = own.some(([lo, hi]) => (x < lo - 0.5 && x + w > lo + 0.5) || (x < hi - 0.5 && x + w > hi + 0.5));
      expect(crosses, `${name}: ${label.id}`).toBe(false);
    }
  }
});

// A shown value axis replaced the tick of a nonzero baseline and of a value line past the data with its own ladder, so 41 and 37.5 never printed.
it('keeps the baseline tick and the value-line tick on a shown line value axis', () => {
  const tickValues = (valueAxis: object, annotations: unknown[]): number[] => {
    const request = resolveChartRequest({
      type: 'line',
      data: { categories: ['A', 'B', 'C', 'D', 'E', 'F'], series: [{ id: 's', label: 'Sales', values: [52, 54, 57, 59, 60, 63] }] },
      annotations,
      options: { title: 'Sales', valueAxis: { show: true, ...valueAxis }, size: { width: 720, height: 404 } },
    } as never);
    const axis = (requireGeometry(layoutResolvedRequest(request)) as Geometry).axes.find((entry) => entry.axis === 'y');
    return (axis?.ticks ?? []).map((tick) => tick.at as number);
  };
  expect(tickValues({ min: 41 }, [])).toContain(41);
  expect(tickValues({}, [{ kind: 'valueLine', value: 37.5, label: 'Goal' }])).toContain(37.5);
});

// The Bridge palette paints the top stacked series in the ink colour, and a
// value line drawn across that area in ink vanished ('Benchmark 100' pointed at nothing).
it('keeps a value line legible where it crosses a stacked area of its own colour', () => {
  const request = resolveChartRequest({
    type: 'line',
    data: {
      categories: ['jan', 'feb', 'mar'],
      series: [{ id: 'new', values: [42, 45, 48] }, { id: 'returning', values: [60, 62, 61] }],
    },
    options: { variant: 'stacked-area', size: { width: 720 } },
    annotations: [{ kind: 'valueLine', value: 100, label: 'Benchmark' }],
  } as never);
  const geometry = requireGeometry(layoutResolvedRequest(request)) as Geometry;
  const theme = resolveTheme(undefined);
  const area = geometry.scene.find((node) => node.id === 'mark:area:returning') as { fill: Paint };
  const pieces = geometry.scene.filter((node) => node.part === 'valueLine' && (node.t === 'line' || node.t === 'path')) as { stroke: Paint }[];
  expect(pieces.length).toBeGreaterThan(0);
  for (const piece of pieces) expect(contrastRatio(paintColor(theme, piece.stroke), paintColor(theme, area.fill))).toBeGreaterThan(3);
});
