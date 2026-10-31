/**
 * The unstacked area variant with several series.
 */
import { expect, it } from 'vitest';
import '../src/core/charts';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { requireGeometry } from '../src/core/sizing';
import type { LineMarks } from '../src/core/charts/line/layout';
import type { Geometry } from '../src/core/types/scene';

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
