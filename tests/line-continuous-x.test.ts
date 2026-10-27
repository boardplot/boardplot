/**
 * The continuous x axis of line and area (data.x with options.xAxis): times in
 * a zone or plain numbers, placed by value, with the scale's own ticks.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '../src/core/charts';
import { interactionRecords } from '../src/core/a11y/records';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { requireGeometry } from '../src/core/sizing';
import { renderSvg } from '../src/core/svg/renderSvg';
import { resolveTimes, timeTicks, timeTickText, zoneClock, zoneYearSpan } from '../src/core/timeAxis';
import type { Geometry } from '../src/core/types/scene';
import { curvePathFromSegments, monotoneSegments, splitCurveSegmentsAtX } from '../src/core/curve';
import { LineChart } from '../src/react/charts/line';
import { zoomAxis, zoomSpec, type ZoomSpec } from '../src/core/zoom';
import { lineOptionsSchema } from '../src/core/charts/line/schema';
import { beginSpecParse } from '../src/react/specValidation';
import type { Annotation } from '../src/core/types/annotations';
import { prepareChart } from '../src/react/prepare';
import type { LineOptions } from '../src/core/types/options';

const BERLIN = zoneClock('Europe/Berlin');

function lay(data: unknown, options: Record<string, unknown>, width = 720) {
  const request = resolveChartRequest({ type: 'line', data, options: { title: 'Readings', size: { width }, ...options } } as never);
  const layout = layoutResolvedRequest(request);
  if (layout.refused) throw new Error(JSON.stringify(layout.refused));
  const geometry = requireGeometry(layout) as Geometry;
  return { request, geometry, svg: renderSvg(geometry, request.theme) };
}

/** The refusal code of a request, from the schema or the layout. */
function refusal(data: unknown, options: Record<string, unknown>): string | undefined {
  try {
    const request = resolveChartRequest({ type: 'line', data, options: { title: 'Readings', ...options } } as never);
    const layout = layoutResolvedRequest(request);
    return layout.refused ? layout.warnings[0]?.code : undefined;
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
}

const series = (n: number, f = (i: number) => i) => [{ id: 'a', label: 'Probe', values: Array.from({ length: n }, (_, i) => f(i)) }];

describe('time zone reading', () => {
  // The repeated hour on 25 Oct must keep its order: the second 02:30 is an hour after the first.
  it('reads a repeated wall time in order as the later instant, and refuses one it cannot order', () => {
    const xs = resolveTimes(['2026-10-25T02:30', '2026-10-25T02:30', '2026-10-25T04:00'], BERLIN, (i) => `x[${i}]`);
    expect(xs.map((x) => new Date(x).toISOString())).toEqual(['2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z', '2026-10-25T03:00:00.000Z']);
    expect(() => resolveTimes(['2026-10-25T02:30'], BERLIN, () => 'x')).toThrow(expect.objectContaining({ code: 'x-time-ambiguous' }));
  });

  // 29 Mar 2026 02:30 never happens in Berlin; shifting it would invent a reading time.
  it('refuses a wall time the clock change skips', () => {
    expect(() => resolveTimes(['2026-03-29T02:30'], BERLIN, () => 'x')).toThrow(expect.objectContaining({ code: 'x-time-skipped' }));
  });

  // A 2-minute step does not divide a +05:45 offset; its ticks must still read 00:00, 00:02 on the local clock.
  it('aligns a step on the local clock in a quarter-hour zone', () => {
    const lo = Date.parse('2026-10-24T18:15:00Z');
    const ticks = timeTicks(lo, lo + 10 * 60_000, { unit: 'minute', n: 2 }, zoneClock('Asia/Kathmandu'))!;
    expect(ticks.map((t) => timeTickText(t, { unit: 'minute', n: 2 }, zoneClock('Asia/Kathmandu')))).toEqual(['00:00', '00:02', '00:04', '00:06', '00:08', '00:10']);
  });

  // Lord Howe repeats half an hour; its ticks must stay in time order or the labels thin for no reason.
  it('keeps ticks in time order across a half-hour change', () => {
    const lo = Date.parse('2026-04-04T14:15:00Z'), hi = Date.parse('2026-04-04T15:45:00Z');
    const ticks = timeTicks(lo, hi, { unit: 'minute', n: 15 }, zoneClock('Australia/Lord_Howe'))!;
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
    expect(ticks).toHaveLength(7);
  });

  // Two hourly ticks read 02:00 on 25 Oct; only the offset tells them apart.
  it('adds the offset to a tick label in the repeated hour', () => {
    const step = { unit: 'hour' as const, n: 1 };
    expect([Date.parse('2026-10-25T00:00:00Z'), Date.parse('2026-10-25T01:00:00Z')].map((t) => timeTickText(t, step, BERLIN))).toEqual(['02:00 UTC+2', '02:00 UTC+1']);
  });
});

describe('continuous axis layout', () => {
  // A cut range must keep its edge segments without inventing readings, bridging nulls or changing a smooth curve.
  it('clips lines, areas and bands to the original segments at both range edges', () => {
    const x = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05'];
    const data = { x, series: [{ id: 'a', label: 'Probe', values: [10, 30, 20, 40, 15] }, { id: 'b', label: 'Backup', values: [5, 10, 5, 15, 10] }] };
    const bounds = ['2026-01-01T12:00:00Z', '2026-01-04T12:00:00Z'];
    for (const variant of ['line', 'area', 'stacked-area', 'stacked100-area']) {
      for (const interpolate of ['linear', 'monotone', 'step-before', 'step-after']) {
        for (const view of [false, true]) {
          const options = { variant, interpolate, seriesLabels: 'key', valueLabels: 'all', xAxis: { type: 'time', zone: 'UTC', ...(view ? {} : { min: bounds[0], max: bounds[1] }) }, ...(view ? { viewDomain: { x: bounds } } : {}) };
          const { request, geometry, svg } = lay(data, options);
          const records = interactionRecords({ request, geometry, scope: request.scope, claims: [] });
          expect(new Set(records.map(r => r.target.owner.categoryId))).toEqual(new Set(x.slice(1, 4).map(t => `${t}T00:00:00.000Z`)));
          const paths = geometry.scene.filter(n => n.t === 'path' && (n.part === 'line' || n.part === 'area'));
          expect(paths.length).toBeGreaterThan(0);
          for (const path of paths) {
            if (path.t !== 'path') continue;
            const points = [...path.d.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map(m => Number(m[1]));
            expect(Math.min(...points)).toBeCloseTo(geometry.plot.x, 1);
            const end = interpolate === 'monotone' ? Number([...path.d.matchAll(/C[^CMLZ]+/g)].at(-1)![0].trim().split(/[ ,]/).at(-2)) : Math.max(...points);
            expect(Math.max(end, ...points)).toBeCloseTo(geometry.plot.x + geometry.plot.w, 1);
          }
          if (variant === 'line') {
            const anchors = records.filter(r => r.target.owner.seriesId === 'a').map(r => r.anchor!);
            const yOf = (value: number) => anchors[0]!.y + (value - 30) * (anchors[1]!.y - anchors[0]!.y) / (20 - 30);
            const xOf = (time: number) => geometry.plot.x + (time - Date.parse(bounds[0]!)) / (Date.parse(bounds[1]!) - Date.parse(bounds[0]!)) * geometry.plot.w;
            const path = paths.find(n => n.owner.seriesId === 'a')!;
            if (path.t !== 'path') throw new Error('missing line');
            if (interpolate === 'monotone') {
              const full = monotoneSegments(x.map((t, i) => ({ x: xOf(Date.parse(t)), y: yOf(data.series[0]!.values[i]!) })));
              const inside = splitCurveSegmentsAtX(splitCurveSegmentsAtX(full, geometry.plot.x)[1], geometry.plot.x + geometry.plot.w)[0];
              const expected = curvePathFromSegments(inside);
              expect(path.d.match(/[A-Z]/g)).toEqual(expected.match(/[A-Z]/g));
              const coords = expected.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
              path.d.match(/-?\d+(?:\.\d+)?/g)!.map(Number).forEach((v, i) => expect(v).toBeCloseTo(coords[i]!, 1));
            } else {
              expect(Number(path.d.match(/^M[\d.-]+ ([\d.-]+)/)![1])).toBeCloseTo(yOf(interpolate === 'step-before' ? 30 : interpolate === 'step-after' ? 10 : 20), 1);
            }
          }
          expect(lay(data, options).svg).toBe(svg);
        }
      }
    }
    const one = lay(data, { xAxis: { type: 'time', min: '2026-01-02T12:00Z', max: '2026-01-03T12:00Z' }, variant: 'area' });
    expect(one.geometry.scene.some(n => n.part === 'area')).toBe(true);
    const valley = lay({ x: [...x, '2026-01-06', '2026-01-07'], series: [{ id: 'a', values: [18, 24, 20, 30, 26, 32, 28] }] },
      { xAxis: { type: 'time', min: '2026-01-02T12:00Z', max: '2026-01-05T12:00Z' }, variant: 'area' }, 320);
    expect(valley.geometry.labels.some(l => l.kind === 'point' && !l.hidden && l.text === '26')).toBe(true);
    for (const variant of ['line', 'area', 'stacked-area', 'stacked100-area']) {
      const gap = lay({ x, series: [{ id: 'a', values: [10, null, 20, null, 15] }] }, { variant, xAxis: { type: 'time', min: bounds[0], max: bounds[1] } });
      expect(gap.geometry.scene.some(n => n.part === 'line' || n.part === 'area')).toBe(false);
    }
    for (const variant of ['stacked-area', 'stacked100-area']) {
      const interior = lay({ x: [0, 1, 2, 3, 4], series: [{ id: 'a', values: [10, 20, null, 30, 40] }, { id: 'b', values: [5, 5, 5, 5, 5] }] },
        { variant, xAxis: { type: 'number', min: 0.5, max: 3.5 } });
      expect(interior.geometry.scene.filter(n => n.part === 'area' && n.owner.seriesId === 'a')).toHaveLength(1);
    }
    const fan = lay({ x, series: [{ id: 'a', values: [10, 30, 20, 40, 15] }, { id: 'low', values: [5, 20, 10, 30, 10] }, { id: 'high', values: [15, 40, 30, 50, 20] }] },
      { xAxis: { type: 'time', min: bounds[0], max: bounds[1] }, fan: { of: 'a', bands: [{ low: 'low', high: 'high', label: 'Range' }] }, interpolate: 'monotone' });
    const band = fan.geometry.scene.find(n => n.part === 'fanBand');
    expect(band?.t === 'path' && Number(band.d.match(/^M([\d.-]+)/)![1])).toBeCloseTo(fan.geometry.plot.x, 1);
    const missingBand = lay({ x, series: [{ id: 'a', values: [10, 30, 20, 40, 15] }, { id: 'low', values: [5, null, 10, 30, 10] }, { id: 'high', values: [15, null, 30, 50, 20] }] },
      { xAxis: { type: 'time', min: bounds[0], max: bounds[1] }, fan: { of: 'a', bands: [{ low: 'low', high: 'high', label: 'Range' }] } });
    expect(missingBand.geometry.warnings.map(w => w.code)).toContain('fan-band-gap');
    const gapFill = lay(data, { xAxis: { type: 'time', min: bounds[0], max: bounds[1] }, gapFill: { between: ['a', 'b'] } });
    const fill = gapFill.geometry.scene.find(n => n.part === 'gapFill');
    expect(fill?.t === 'path' && Number(fill.d.match(/^M([\d.-]+)/)![1])).toBeCloseTo(gapFill.geometry.plot.x, 1);
    for (const label of ['Final', false]) {
      const authored = lay({ x: [0, 1, 2, 3, 4], series: [
        { id: 'a', label: 'First sensor with a long name', values: [10, 12, 15, { number: 30, label }, 35] },
        { id: 'b', label: 'Second sensor with a long name', values: [8, 10, 9, 20, 21] },
      ] }, { variant: 'area', xAxis: { type: 'number', min: 0.5, max: 3.5 }, valueLabels: 'ends' }, 320);
      expect(authored.geometry.scene.some(n => n.t === 'text' && n.owner.seriesId === 'a' && n.lines.join(' ') === '12')).toBe(true);
    }
    for (const variant of ['line', 'area', 'stacked-area', 'stacked100-area']) for (const interpolate of ['linear', 'monotone', 'step-before', 'step-after']) {
      const windowData = { x: Array.from({ length: 10 }, (_, i) => i), series: series(10, i => (i + 1) * 10) };
      const windowOptions = { variant, interpolate, xAxis: { type: 'number', min: 0.5, max: 8.5 }, window: { last: 2 } };
      const windowed = lay(windowData, windowOptions);
      const records = interactionRecords({ request: windowed.request, geometry: windowed.geometry, scope: windowed.request.scope, claims: [] });
      expect(records.map(r => r.target.owner.categoryId)).toEqual(['7', '8']);
      const firstX = records[0]!.anchor!.x;
      for (const path of windowed.geometry.scene.filter(n => n.part === 'line' || n.part === 'area')) {
        if (path.t !== 'path') continue;
        expect(Number(path.d.match(/^M([\d.-]+)/)![1])).toBeCloseTo(firstX, 1);
      }
      expect(lay(windowData, windowOptions).svg).toBe(windowed.svg);
    }
    for (const variant of ['line', 'area']) for (const interpolate of ['linear', 'step-before', 'step-after']) {
      const windowData = { x: Array.from({ length: 10 }, (_, i) => i), series: [{ id: 'a', values: Array.from({ length: 10 }, (_, i) => (i + 1) * 10) }, { id: 'b', values: Array.from({ length: 10 }, (_, i) => (i + 1) * 5) }] };
      const windowOptions = { variant, interpolate, xAxis: { type: 'number', min: 0.5, max: 8.5 }, window: { last: 2 }, gapFill: { between: ['a', 'b'] } };
      const windowed = lay(windowData, windowOptions);
      const records = interactionRecords({ request: windowed.request, geometry: windowed.geometry, scope: windowed.request.scope, claims: [] });
      const firstX = records.find(r => r.target.owner.categoryId === '7')!.anchor!.x;
      const fill = windowed.geometry.scene.find(n => n.part === 'gapFill');
      expect(fill?.t === 'path' && Number(fill.d.match(/^M([\d.-]+)/)![1])).toBeCloseTo(firstX, 1);
      expect(lay(windowData, windowOptions).svg).toBe(windowed.svg);
    }
  });

  // Daily, monthly and yearly readings must never gain finer automatic ticks, even in a zoom or bucketed view.
  it('keeps automatic time ticks at the readings calendar precision and respects authored ticks', () => {
    const ticks = (geometry: Geometry) => geometry.labels.filter((l) => l.id.startsWith('xtick:') && !l.hidden).map((l) => l.text);
    const cases = [
      { x: ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05'], labels: ['2 Mar', '3 Mar', '4 Mar', '5 Mar'] },
      { x: ['2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01'], labels: ['Mar', 'Apr', 'May', 'Jun'] },
      { x: ['2023-01-01', '2024-01-01', '2025-01-01', '2026-01-01'], labels: ['2023', '2024', '2025', '2026'] },
      { x: ['2026-03-01', '2026-04-01'], labels: ['Mar', 'Apr'] },
      { x: ['2025-01-01', '2026-01-01'], labels: ['2025', '2026'] },
    ];
    for (const { x, labels } of cases) for (const width of [320, 640, 960]) for (const variant of ['line', 'area', 'stacked-area', 'stacked100-area']) {
      const result = lay({ x, series: series(x.length, (i) => 120 + i * 7) }, { variant, xAxis: { type: 'time', zone: 'Europe/Berlin' } }, width);
      expect(ticks(result.geometry)).toEqual(labels);
      expect(result.svg).toBe(lay({ x, series: series(x.length, (i) => 120 + i * 7) }, { variant, xAxis: { type: 'time', zone: 'Europe/Berlin' } }, width).svg);
    }
    const x = ['2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31'];
    const daily = { x, series: series(4, (i) => 120 + i * 7) };
    const axis = { type: 'time', zone: 'Europe/Berlin' };
    expect(ticks(lay(daily, { xAxis: axis }, 960).geometry)).toEqual(['28 Mar', '29 Mar', '30 Mar', '31 Mar']);
    const epoch = resolveTimes(x, BERLIN, (i) => `x[${i}]`);
    expect(ticks(lay({ ...daily, x: epoch }, { xAxis: axis }, 960).geometry)).toEqual(['28 Mar', '29 Mar', '30 Mar', '31 Mar']);
    const intraday = { ...daily, x: epoch.map((t) => t + 3_600_000) };
    expect(ticks(lay(intraday, { xAxis: axis }, 960).geometry).some((text) => text.includes(':'))).toBe(true);
    expect(ticks(lay(daily, { xAxis: { ...axis, tickStep: { unit: 'hour', step: 12 } } }, 960).geometry)).toContain('12:00');
    expect(ticks(lay(daily, { xAxis: { ...axis, ticks: ['2026-03-28T12:00', '2026-03-29T12:00'] } }, 960).geometry)).toEqual(['12:00', '12:00']);
    const crowded = Array.from({ length: 14 }, (_, i) => Date.UTC(2026, 2, i + 2));
    const days = ticks(lay({ x: crowded, series: series(14, (i) => 120 + i) }, { xAxis: { type: 'time', maxTicks: 24 } }, 400).geometry).map((text) => Number(text.split(' ')[0]));
    expect(days.length).toBeGreaterThan(2);
    expect(days.length).toBeLessThan(crowded.length);
    expect(new Set(days.slice(1).map((day, i) => day - days[i]!)).size).toBe(1);
    const long: ZoomSpec = { type: 'line', data: { x: Array.from({ length: 100 }, (_, i) => Date.UTC(2026, 0, i + 1)), series: series(100, () => 120) }, options: { xAxis: { type: 'time' } } };
    const zoom = zoomAxis(long)!;
    const bucketed = zoomSpec(long, zoom, zoom.extent, { unit: 'month', step: 1 }, { aggregate: 'mean' });
    const monthTicks = ticks(lay(bucketed.data, bucketed.options!, 960).geometry);
    expect(monthTicks.length).toBeGreaterThan(1);
    expect(monthTicks.every((text) => ['Jan', 'Feb', 'Mar', 'Apr'].includes(text))).toBe(true);
    const html = renderToStaticMarkup(createElement(LineChart, { data: daily, xAxis: { type: 'time', zone: 'Europe/Berlin' }, size: { width: 960 }, zoom: { range: ['2026-03-29', '2026-03-30'] }, deferLayout: false }));
    const docTicks = [...html.matchAll(/data-id="label:xtick:[^"]+"[^>]*>(.*?)<\/text>/g)].map((m) => m[1]!.replace(/<[^>]*>/g, ''));
    expect(docTicks).toEqual(['29 Mar', '30 Mar']);
  });

  // Epoch anchors must place and describe the same reading as ISO anchors, including a measured mean's period.
  it('draws epoch annotation anchors exactly like ISO anchors on a time axis', async () => {
    const dates = ['2020-01-01T00:00:00+01:00', '2021-01-01T00:00:00+01:00', '2022-01-01T00:00:00+01:00', '2023-01-01T00:00:00+01:00'];
    const x = dates.map(Date.parse);
    const data = { x, series: series(4, (i) => 100 + i * 20) };
    const object = (categoryId: string | number) => ({ categoryId, seriesId: 'a' });
    const examples = (at: string | number, to: string | number): Annotation<string | number>[] => [
      { kind: 'diff', from: at, to }, { kind: 'cagr', from: object(at), to: object(to) },
      { kind: 'delta', at, vs: 80 }, { kind: 'delta', at: object(to), vs: object(at) },
      { kind: 'abs', at }, { kind: 'note', at: object(at), text: 'Check' },
      { kind: 'callout', at, text: 'Check' }, { kind: 'valueLine', from: at, to },
      { kind: 'band', from: at, to, label: 'Trial' }, { kind: 'event', at, to, label: 'Trial' },
      { kind: 'event', date: at, end: to, label: 'Trial' },
    ];
    const numeric = examples(x[0]!, x[3]!);
    for (const [i, annotation] of examples(dates[0]!, dates[3]!).entries()) {
      const options = { xAxis: { type: 'time', zone: 'Europe/Berlin' } };
      const expected = lay(data, lineOptionsSchema.parse({ ...options, annotations: [annotation] }) as unknown as Record<string, unknown>);
      const parsedOptions = beginSpecParse({ type: 'line', data, options: { ...options, annotations: [numeric[i]] } }).finish();
      const actual = lay(data, parsedOptions.request.options! as unknown as Record<string, unknown>);
      expect(actual.svg, annotation.kind).toBe(expected.svg);
      expect(actual.geometry.warnings).toEqual(expected.geometry.warnings);
      const raw = lay(data, { ...options, annotations: [numeric[i]] });
      expect(raw.svg, `raw ${annotation.kind}`).toBe(expected.svg);
      const canonical = lay(data, { ...options, annotations: [examples(new Date(x[0]!).toISOString(), new Date(x[3]!).toISOString())[i]] });
      const records = (result: ReturnType<typeof lay>) => interactionRecords({ request: result.request, geometry: result.geometry, scope: result.request.scope, claims: [] });
      expect(records(raw), `records ${annotation.kind}`).toEqual(records(canonical));
      const parsed = beginSpecParse({ type: 'line', data, options, annotations: [numeric[i]] }).finish();
      expect(lay(data, { ...parsed.request.options, annotations: parsed.request.annotations }).svg, `top-level ${annotation.kind}`).toBe(expected.svg);
    }
    expect(refusal(data, { xAxis: { type: 'time', zone: 'Europe/Berlin' }, annotations: [{ kind: 'note', at: x[0]! + 1, text: 'Check' }] })).toContain('x-anchor-no-reading');
    expect(refusal(data, { xAxis: { type: 'time' }, annotations: [{ kind: 'note', at: Number.NaN, text: 'Check' }] })).toBeDefined();
    expect(() => lineOptionsSchema.parse({ annotations: [{ kind: 'note', at: x[0], text: 'Check' }] })).toThrow();
    const note: Annotation<string | number> = { kind: 'note', at: x[0]!, text: 'Epoch note' };
    const noteOptions: LineOptions = { xAxis: { type: 'time', zone: 'Europe/Berlin' }, size: { width: 720 }, annotations: [note] };
    const prepared = await prepareChart({ type: 'line', data, options: noteOptions });
    const html = renderToStaticMarkup(createElement(LineChart, { data, xAxis: { type: 'time', zone: 'Europe/Berlin' }, size: { width: 720 }, annotations: [note], prepared, deferLayout: false }));
    expect(html).toContain('Epoch note');
  });

  // Uneven readings must keep their spacing: 7 minutes and 55 minutes are not one step each.
  it('places readings by value', () => {
    const { request, geometry } = lay({ x: ['2026-03-03T06:00:00Z', '2026-03-03T06:07:00Z', '2026-03-03T07:02:00Z'], series: series(3) }, { xAxis: { type: 'time' } });
    const xs = interactionRecords({ request, geometry, scope: request.scope, claims: [] }).map((r) => r.anchor!.x);
    expect((xs[1]! - xs[0]!) / (xs[2]! - xs[0]!)).toBeCloseTo(7 / 62, 2);
  });

  // Two days of 5-minute readings need 6-hour ticks with the days under them, not one tick per reading.
  it('picks a tick step from the ladder and prints the days under clock ticks', () => {
    const x = Array.from({ length: 577 }, (_, i) => new Date(Date.parse('2026-03-02T00:00:00Z') + i * 300_000).toISOString());
    const { geometry } = lay({ x, series: series(577, (i) => Math.sin(i / 40)) }, { xAxis: { type: 'time' } });
    const texts = (prefix: string) => geometry.labels.filter((l) => l.id.startsWith(prefix) && !l.hidden).map((l) => l.text);
    expect(texts('xtick:').slice(0, 3)).toEqual(['00:00', '06:00', '12:00']);
    expect(texts('xcontext:')[0]).toBe('Mon 2 Mar');
  });

  // A trend over uneven times must fit elapsed time: 0.25 per hour, not per reading.
  it('fits the trend on elapsed time', () => {
    const minutes = [0, 4, 30, 31, 90, 200, 240];
    const { svg } = lay({ x: minutes.map((m) => new Date(Date.parse('2026-03-03T06:00:00Z') + m * 60_000).toISOString()), series: series(7, (i) => 2 + minutes[i]! / 240) }, { xAxis: { type: 'time' }, trend: true });
    expect(svg).toContain('+0.25 per hour');
  });

  // Above the point budget the samples must keep a one-reading spike in a dense stretch.
  it('keeps extremes when it samples uneven readings', () => {
    const t = Array.from({ length: 6000 }, (_, i) => (i < 4000 ? i : 4000 + (i - 4000) * 10));
    const { geometry } = lay({ x: t, series: series(6000, (i) => (i === 1234 ? 500 : i % 7)) }, { xAxis: { type: 'number' } });
    expect(geometry.warnings.map((w) => w.code)).toContain('line-decimated');
    const path = geometry.scene.find((n) => n.t === 'path' && n.part === 'line') as { d: string };
    const ys = [...path.d.matchAll(/[ML]\s*[-\d.]+[ ,]([-\d.]+)/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
    // The spike is the one point far above the rest.
    expect(ys[1]! - ys[0]!).toBeGreaterThan(100);
  });

  // A millisecond range walked whole days of millisecond ticks and ran out of memory.
  it('draws readings a few milliseconds apart', () => {
    const { geometry } = lay({ x: [0, 1, 2], series: series(3) }, { xAxis: { type: 'time' } });
    expect(geometry.labels.some((l) => l.id.startsWith('xtick:'))).toBe(true);
  });

  // An event at a reading stands at that reading's x, not at its index read as an x.
  it('places an event at a reading by its x', () => {
    const { request, geometry } = lay({ x: [0, 10, 20], series: series(3) }, { xAxis: { type: 'number' }, annotations: [{ kind: 'event', at: '10', label: 'Valve open' }] });
    const reading = interactionRecords({ request, geometry, scope: request.scope, claims: [] }).find((r) => r.target.owner.categoryId === '10')!;
    const pole = geometry.scene.find((n) => n.t === 'line' && n.owner.annotationId !== undefined) as { x1: number };
    expect(pole.x1).toBeCloseTo(reading.anchor!.x, 0);
  });

  // A phase wash that stops at the inside readings leaves the line it fills under in a cut range.
  it('runs the phase wash along the cut line to both plot edges', () => {
    const phases = [{ id: 'p1', label: 'Launch', from: '0', to: '2' }, { id: 'p2', label: 'Growth', from: '3', to: '4' }];
    for (const interpolate of ['linear', 'monotone']) for (const offset of [0, 100]) {
      const data = { x: [0, 1, 2, 3, 4], series: [{ id: 'a', label: 'Alpha', values: [10, 30, 20, 40, 15].map(v => v + offset) }] };
      const { geometry } = lay(data, { interpolate, phases, valueAxis: { includeZero: offset === 0 }, xAxis: { type: 'number', min: 0.5, max: 3.5 } }, 640);
      const fills = geometry.scene.filter(n => n.part === 'phaseFill');
      const line = geometry.scene.find(n => n.part === 'line');
      if (line?.t !== 'path' || fills.length !== 2 || fills.some(n => n.t !== 'path')) throw new Error('missing line or phase fills');
      const [first, last] = fills.map(n => (n as { d: string }).d);
      if (offset === 0) {
        // The wash top is the line itself: its first segment and its last point.
        expect(first!.startsWith(line.d.match(/^M[^CL]+[CL][^CL]+/)![0])).toBe(true);
        expect(last).toContain(`${line.d.match(/(-?[\d.]+ -?[\d.]+)$/)![1]}L`);
      } else {
        const xs = (d: string) => [...d.matchAll(/[ML](-?[\d.]+) /g)].map(m => Number(m[1]));
        expect(Math.min(...xs(first!))).toBeCloseTo(geometry.plot.x, 1);
        expect(Math.max(...xs(last!))).toBeCloseTo(geometry.plot.x + geometry.plot.w, 1);
      }
    }
    // A crop keeps the phase that owns the edge stretch, even with no reading in view.
    const edge = lay({ x: [0, 1, 2, 3, 4], series: [{ id: 'a', values: [10, 30, 20, 40, 15] }] },
      { phases: [{ id: 'p1', label: 'Launch', from: '0', to: '0' }, { id: 'p2', label: 'Growth', from: '1', to: '4' }], valueAxis: { includeZero: true }, xAxis: { type: 'number', min: 0.3, max: 3.5 } }, 640).geometry;
    const divider = edge.scene.find(n => n.part === 'phaseBoundary');
    expect(divider?.t === 'line' && divider.x1).toBeCloseTo(edge.plot.x + (0.2 / 3.2) * edge.plot.w, 1);
    expect(edge.labels.filter(l => l.id.startsWith('annotation:phase:') && !l.hidden).map(l => l.text)).toEqual(['Growth', 'Launch']);
  });

  // A band that spans the whole range keeps its shade when the range cuts its ends.
  // Bounds on readings continue no segment, so the chart must not trade its end gutter for one.
  it('draws bounds that sit on readings like a chart of only those readings, with outside readings present', () => {
    const data = { x: [0, 1, 2, 3, 4, 5, 6], series: [{ id: 'a', label: 'Alpha', values: [10, 20, 40, 30, 50, 20, 60] }, { id: 'b', label: 'Beta', values: [5, 15, 25, 20, 30, 35, 40] }] };
    const sliced = { x: data.x.slice(1, 6), series: data.series.map(s => ({ ...s, values: s.values.slice(1, 6) })) };
    const xAxis = { type: 'number', min: 1, max: 5 };
    const cut = lay(data, { xAxis }).geometry;
    const plain = lay(sliced, { xAxis }).geometry;
    expect(cut.plot).toEqual(plain.plot);
    expect(cut.labels.map(l => [l.id, l.text, l.rect])).toEqual(plain.labels.map(l => [l.id, l.text, l.rect]));
  });

  // A fan that runs on past its last reading leaves no seat beside it; the key carries the last centre value and outer bounds there.
  it('carries the last centre value and outer bounds of a cut fan in the key', () => {
    const centre = [100, 104, 109, 113, 118, 122, 127, 131];
    const data = { x: centre.map((_, i) => i), series: [{ id: 'c', label: 'Central case', values: centre }, { id: 'lo', label: 'Low', values: centre.map((v, i) => v - i * 3) }, { id: 'hi', label: 'High', values: centre.map((v, i) => v + i * 3) }] };
    const { geometry } = lay(data, { xAxis: { type: 'number', min: 0.5, max: 6.5 }, fan: { of: 'c', bands: [{ low: 'lo', high: 'hi', label: '80% interval' }] } }, 640);
    const ids = new Set(geometry.legend!.items.map(item => item.labelId));
    const keys: string[] = [];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const n = node as { id?: string; lines?: string[] };
      if (n.id && ids.has(n.id) && n.lines) keys.push(n.lines.join(' '));
      Object.values(node).forEach(walk);
    };
    walk(geometry.scene);
    expect(keys).toEqual(expect.arrayContaining(['Central case 127', '80% interval 109–145']));
    expect(geometry.labels.filter(l => !l.hidden && (l.id.startsWith('fan-edge:') || l.id.startsWith('point:')))).toEqual([]);
  });

  // The schema requires a band label; a layout call without one must refuse by name, not crash in the footer.
  it('refuses a fan band without a label', () => {
    const data = { x: [0, 1, 2, 3], series: [{ id: 'c', values: [10, 20, 40, 30] }, { id: 'lo', values: [8, 15, 30, 25] }, { id: 'hi', values: [12, 25, 50, 35] }] };
    expect(refusal(data, { xAxis: { type: 'number' }, fan: { of: 'c', bands: [{ low: 'lo', high: 'hi' }] } })).toBe('fan-band-unlabelled');
  });

  it('keeps a band whose ends lie outside the range', () => {
    const { geometry } = lay({ x: [10, 20, 30], series: series(3) }, { xAxis: { type: 'number', min: 15, max: 25 }, annotations: [{ kind: 'band', from: '10', to: '30', label: 'Trial' }] });
    expect(geometry.scene.some((n) => n.part === 'band')).toBe(true);
  });

  it.each([
    ['bump variant', { x: [1, 2, 3], series: series(3) }, { variant: 'bump', xAxis: { type: 'number' } }, 'x-axis-unsupported'],
    ['categoryAxis with xAxis', { x: [1, 2, 3], series: series(3) }, { categoryAxis: { dateTicks: 'days' }, xAxis: { type: 'number' } }, 'x-axis-conflict'],
    ['a repeated x', { x: [1, 2, 2], series: series(3) }, { xAxis: { type: 'number' } }, 'x-duplicate'],
    ['x without xAxis', { x: [1, 2, 3], series: series(3) }, {}, 'x-needs-axis'],
  ])('refuses %s', (_name, data, options, code) => {
    // Each refusal names what a continuous axis cannot draw, instead of drawing it wrong.
    expect(refusal(data, options)).toContain(code);
  });

  // data.partial is the continuous axis's way to mark a part-covered period; a value with no reading must say so.
  it('marks the reading data.partial names, and warns for one that names no reading', () => {
    const data = { x: ['2026-01-05', '2026-01-12', '2026-01-19'], partial: ['2026-01-19', '2026-01-26'], series: [{ id: 'a', label: 'Orders', values: [7, 7, 3] }] };
    const { geometry, svg } = lay(data, { xAxis: { type: 'time', zone: 'UTC' } });
    expect(geometry.warnings.map((w) => w.code)).toContain('x-partial-no-reading');
    const marker = (x: string) => svg.match(new RegExp(`<circle data-id="marker:a:${x}"[^>]*>`))![0];
    expect(marker('2026-01-19T00:00:00.000Z')).toContain('stroke=');
    expect(marker('2026-01-12T00:00:00.000Z')).not.toContain('stroke=');
  });
});

describe('cagr on a time axis', () => {
  const years = { x: ['2020-01-01', '2021-01-01', '2022-01-01', '2023-01-01', '2024-01-01', '2025-01-01'] };
  const cagr = (values: number[], xAxis: Record<string, unknown> = { type: 'time', zone: 'Europe/Berlin' }) => {
    const request = resolveChartRequest({ type: 'line', data: { x: xAxis.type === 'number' ? [0, 1, 2, 3, 4, 5] : years.x, series: [{ id: 'a', label: 'Revenue', values }] },
      options: { title: 'Revenue', size: { width: 720 }, xAxis, annotations: [{ kind: 'cagr' }] } } as never);
    const layout = layoutResolvedRequest(request);
    const svg = renderSvg(requireGeometry(layout) as Geometry, request.theme);
    return { label: svg.match(/data-id="label:annotation:cagr-1"[^>]*>(?:<[^>]+>)*([^<]+)</)?.[1], codes: layout.warnings.map((w) => w.code) };
  };

  // A time axis had no CAGR: the annotation was skipped with a warning.
  it('draws the bracket with the rate over the years between the readings', () => {
    expect(cagr([100, 108, 117, 126, 136, 147]).label).toBe('+8.0% p.a.');
  });

  // The rate is per calendar year on the axis zone, so five New Year's Days span exactly five years.
  it('counts whole years by anniversaries and the rest by the length of the next year', () => {
    const t = (iso: string) => Date.parse(iso);
    expect(zoneYearSpan(t('2019-12-31T23:00:00Z'), t('2024-12-31T23:00:00Z'), BERLIN)).toBe(5);
    expect(zoneYearSpan(t('2024-02-29T00:00:00Z'), t('2025-02-28T00:00:00Z'), zoneClock('UTC'))).toBe(1);
    expect(zoneYearSpan(t('2025-01-01T00:00:00Z'), t('2025-07-02T12:00:00Z'), zoneClock('UTC'))).toBe(0.5);
    expect(zoneYearSpan(t('0042-01-01T00:00:00Z'), t('0043-01-01T00:00:00Z'), zoneClock('UTC'))).toBe(1);
  });

  // A rate from a start at or below zero has no meaning on a time axis.
  it('refuses a span whose start value is not positive', () => {
    expect(cagr([-5, 108, 117, 126, 136, 147])).toEqual({ label: undefined, codes: expect.arrayContaining(['cagr-undefined']) });
    expect(cagr([-100, -108, -117, -126, -136, -147]).codes).toContain('cagr-undefined');
  });

  // The category axis flipped the sign of a rate from a loss, and refused an end of zero: the two axes disagreed.
  it('gives the same answer on a category axis and a time axis', () => {
    const answer = (values: number[], time: boolean) => {
      const data = time ? { ...years, series: [{ id: 'a', label: 'Revenue', values }] }
        : { categories: years.x.map((date) => ({ id: date, label: date.slice(0, 4), date })), series: [{ id: 'a', label: 'Revenue', values }] };
      const request = resolveChartRequest({ type: 'line', data, options: { title: 'Revenue', size: { width: 720 }, ...(time ? { xAxis: { type: 'time', zone: 'UTC' } } : {}), annotations: [{ kind: 'cagr' }] } } as never);
      const layout = layoutResolvedRequest(request);
      const svg = renderSvg(requireGeometry(layout) as Geometry, request.theme);
      return { label: svg.match(/data-id="label:annotation:cagr-1"[^>]*>(?:<[^>]+>)*([^<]+)</)?.[1], warning: layout.warnings.find((w) => w.code === 'cagr-undefined')?.message };
    };
    for (const values of [[-100, -110, -121, -133, -146, -161], [100, 80, 60, 40, 20, 0]]) expect(answer(values, false)).toEqual(answer(values, true));
    expect(answer([-100, -110, -121, -133, -146, -161], false)).toEqual({ label: undefined, warning: "cagr 'cagr-1': the start value is not positive, so no growth rate is defined" });
    expect(answer([100, 80, 60, 40, 20, 0], true).label).toBe('−100.0% p.a.');
  });

  // A number axis has no years to annualise over.
  it('keeps the warning on a number axis', () => {
    expect(cagr([100, 108, 117, 126, 136, 147], { type: 'number' }).codes).toContain('x-cagr-unsupported');
  });
});

describe('a band over one period on a time axis', () => {
  // A band from X to X drew a rect of width 0 on a continuous x axis, so the marked period vanished.
  const weeks = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07'];
  const band = (from: string) => lay({ x: weeks, series: [{ id: 's', label: 'Orders', values: [10, 12, 15, 14, 18, 17] }] },
    { xAxis: { type: 'time' }, annotations: [{ kind: 'band', from, to: from, label: 'Recall' }] });
  it('covers the slot of a drawn period and warns where no period sits', () => {
    const rect = band(weeks[5]!).geometry.scene.find((n) => n.id === 'ann:band-1:band:0') as { rect?: { w: number } } | undefined;
    expect(rect?.rect?.w).toBeGreaterThan(0);
    expect(band('2026-08-05').geometry.warnings.map((w) => w.code)).toContain('band-zero-width');
  });
});
