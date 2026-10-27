/**
 * Zoom on a time line: the range math, the grain a range asks for, and the
 * bucketed spec it draws (src/core/zoom.ts).
 */
import { describe, expect, it } from 'vitest';
import { drawnGrain, wantedGrain, zoomAxis, zoomBy, zoomSpec, type ZoomSpec } from '../src/core/zoom';

const DAY = 86_400_000;
const days = (n: number, start = Date.UTC(2024, 0, 1)) => Array.from({ length: n }, (_, i) => new Date(start + i * DAY).toISOString().slice(0, 10));
const daily = (n: number, value: (i: number) => number = (i) => i): ZoomSpec => ({
  type: 'line',
  data: { categories: days(n).map((date) => ({ id: date, date })), series: [{ id: 'units', values: Array.from({ length: n }, (_, i) => value(i)) }] },
  options: {},
});

const num = (cell: unknown) => (typeof cell === 'object' && cell !== null ? (cell as { number: number }).number : cell);
const covers = (cell: unknown) => (cell as { details?: { covers?: string } } | null)?.details?.covers;

describe('zoom', () => {
  // The point under the pointer must stay under it, or the reader loses the place they zoom into.
  it('zooms around the pointer and stays inside the data', () => {
    const axis = zoomAxis(daily(100))!;
    const [lo, hi] = zoomBy(axis, axis.extent, 0.5, 0.25);
    const anchor = axis.extent[0] + 0.25 * (axis.extent[1] - axis.extent[0]);
    expect((anchor - lo) / (hi - lo)).toBeCloseTo(0.25, 5);
    expect(zoomBy(axis, [lo, hi], 10, 0.5)).toEqual(axis.extent);
  });

  // Three years of days at 700 px ask for months; a sum of the days in each month is what a flow reads.
  it('sums days into months when the range is too wide for days', () => {
    const spec = daily(366 * 3, () => 1);
    const axis = zoomAxis(spec)!;
    const wanted = wantedGrain(axis, axis.extent, 700);
    expect(wanted).toEqual({ unit: 'month', step: 1 });
    const view = zoomSpec(spec, axis, axis.extent, drawnGrain(axis, wanted, { aggregate: 'sum' }), { aggregate: 'sum' });
    expect(view.data.categories!.slice(0, 2).map((c) => c.label)).toEqual(['Jan 24', 'Feb 24']);
    expect(view.data.series[0]!.values.slice(0, 2)).toEqual([31, 29]);
  });

  // Without an aggregation rule the metric must not change: the zoom changes only the range.
  it('draws no buckets without an aggregation', () => {
    const axis = zoomAxis(daily(366 * 3))!;
    expect(drawnGrain(axis, wantedGrain(axis, axis.extent, 700), {})).toBeNull();
  });

  // A month the data covers in part must not read as a full month, and a sum with a gap is no sum.
  it('marks part-covered buckets and leaves a sum with a missing day empty', () => {
    // 10 Jan to 9 Mar, with 19 Feb missing.
    const dates = days(60, Date.UTC(2024, 0, 10));
    const spec: ZoomSpec = { type: 'line', data: { categories: dates.map((date) => ({ id: date, date })), series: [{ id: 'units', values: dates.map((_, i) => (i === 40 ? null : 1)) }] } };
    const axis = zoomAxis(spec)!;
    const view = zoomSpec(spec, axis, axis.extent, { unit: 'month', step: 1 }, { aggregate: 'sum' });
    expect(view.data.categories!.map((c) => (c as { partial?: boolean }).partial ?? false)).toEqual([true, false, true]);
    expect(view.data.series[0]!.values.map(num)).toEqual([22, null, 9]);
  });

  // The day the clocks go back has 25 hours in Berlin; a day bucket must hold all of them.
  it('cuts day buckets on the zone clock', () => {
    const x = Array.from({ length: 72 }, (_, i) => new Date(Date.parse('2026-10-23T22:00:00Z') + i * 3_600_000).toISOString());
    const spec: ZoomSpec = { type: 'line', data: { x, series: [{ id: 'n', values: x.map(() => 1) }] }, options: { xAxis: { type: 'time', zone: 'Europe/Berlin' } } };
    const axis = zoomAxis(spec)!;
    const view = zoomSpec(spec, axis, axis.extent, { unit: 'day', step: 1 }, { aggregate: 'sum' });
    expect(view.data.series[0]!.values.map(num)).toEqual([24, 25, 23]);
  });

  // A series the rule list leaves out must not be averaged without the author asking for it.
  it('draws no buckets when a series has no rule', () => {
    const spec = daily(366 * 3);
    spec.data.series.push({ id: 'visits', values: spec.data.series[0]!.values });
    const axis = zoomAxis(spec)!;
    expect(drawnGrain(axis, { unit: 'month', step: 1 }, { aggregate: { units: 'sum' } })).toBeNull();
  });

  // A host that sends finer data needs the asked range, even where it holds fewer than two readings.
  it('keeps a range finer than the readings when the host can send finer data', () => {
    const axis = zoomAxis({ type: 'line', data: { x: ['2026-03-01', '2026-03-02'], series: [{ id: 'a', values: [1, 2] }] }, options: { xAxis: { type: 'time' } } })!;
    const [lo, hi] = zoomBy(axis, axis.extent, 0.5, 0.5, true);
    expect(hi - lo).toBe(DAY / 2);
  });

  // Buckets start before an authored axis start; the first month must still draw.
  it('keeps the first bucket under an authored axis start', () => {
    const x = days(400, Date.UTC(2025, 0, 10));
    const spec: ZoomSpec = { type: 'line', data: { x, series: [{ id: 'a', values: x.map(() => 1) }] }, options: { xAxis: { type: 'time', min: '2025-01-10' } } };
    const axis = zoomAxis(spec)!;
    const view = zoomSpec(spec, axis, axis.extent, { unit: 'month', step: 1 }, { aggregate: 'sum' });
    expect(num(view.data.series[0]!.values[0])).toBe(22);
    expect((view.options!.xAxis as { min?: string }).min).toBeUndefined();
  });
  // Buckets replace the categories: an event named by its category must stay on that category's day.
  it('keeps an event at a category when days become months', () => {
    const spec = daily(400, () => 1);
    spec.data.categories = spec.data.categories!.map((c, i) => ({ ...c, id: `d${i}` }));
    spec.options = { annotations: [{ kind: 'event', at: 'd14', to: 'd20', label: 'Launch' }] };
    const axis = zoomAxis(spec)!;
    const view = zoomSpec(spec, axis, axis.extent, { unit: 'month', step: 1 }, { aggregate: 'sum' });
    expect(view.options!.annotations).toEqual([{ kind: 'event', label: 'Launch', date: '2024-01-15', end: '2024-01-21' }]);
  });
  // A chart that opens on part of its readings must zoom in from that view, not from the whole range.
  it('starts at an authored view', () => {
    const spec = daily(100);
    spec.options = { viewDomain: { x: [spec.data.categories![40]!.id, spec.data.categories![60]!.id] } };
    const axis = zoomAxis(spec)!;
    expect(axis.start).toEqual([Date.UTC(2024, 0, 41), Date.UTC(2024, 0, 61)]);
    const [lo, hi] = zoomBy(axis, axis.start, 0.5, 0.5);
    expect(hi - lo).toBeLessThan(axis.start[1] - axis.start[0]);
    expect(zoomSpec(spec, axis, axis.start, null, {})).toBe(spec);
    expect(zoomSpec(spec, axis, axis.extent, null, {}).options!.viewDomain).toBeUndefined();
    const narrow = zoomAxis({ ...spec, options: { viewDomain: { x: [spec.data.categories![40]!.id, spec.data.categories![41]!.id] } } })!;
    expect(zoomBy(narrow, narrow.start, 0.5, 0.5)).toEqual(narrow.start);
  });

  // A sum over the 29 days of a first month dips; the reader must see it is partial and which days it covers.
  it('marks a part-covered edge bucket of a sum on a continuous axis and names its days', () => {
    const x = days(67, Date.UTC(2025, 0, 3));
    const spec: ZoomSpec = { type: 'line', data: { x, series: [{ id: 'a', values: x.map(() => 1) }] }, options: { xAxis: { type: 'time', zone: 'UTC' } } };
    const axis = zoomAxis(spec)!;
    const view = zoomSpec(spec, axis, axis.extent, { unit: 'month', step: 1 }, { aggregate: 'sum' });
    expect(view.data.partial).toEqual([view.data.x![0], view.data.x![2]]);
    expect(covers(view.data.series[0]!.values[0])).toBe('3 Jan 2025 to 31 Jan 2025 (29 of 31 days)');
    expect(covers(view.data.series[0]!.values[1])).toBeUndefined();
    expect((view.options!.strings as { toDate?: string }).toDate).toBe('partial');
  });

  // A mean or a last value over fewer days stays on the scale of a full bucket: no mark, no note.
  it('does not mark edge buckets of a mean or a last value', () => {
    const spec = daily(60);
    const axis = zoomAxis(spec)!;
    for (const rule of ['mean', 'last'] as const) {
      const view = zoomSpec(spec, axis, axis.extent, { unit: 'month', step: 1 }, { aggregate: rule });
      expect(view.data.categories!.some((c) => (c as { partial?: boolean }).partial)).toBe(false);
      expect(view.data.series[0]!.values.every((v) => typeof v === 'number')).toBe(true);
    }
  });

  // The hollow marker stands at the bucket for every series, so every series names the covered days.
  it('names the covered days on every series when one series sums', () => {
    const spec = daily(70);
    spec.data.series.push({ id: 'rate', values: spec.data.series[0]!.values });
    const axis = zoomAxis(spec)!;
    const view = zoomSpec(spec, axis, axis.extent, { unit: 'month', step: 1 }, { aggregate: { units: 'sum', rate: 'mean' } });
    expect(view.data.categories!.map((c) => (c as { partial?: boolean }).partial ?? false)).toEqual([false, false, true]);
    expect(view.data.series.map((s) => covers(s.values[2]))).toEqual(Array(2).fill('1 Mar 2024 to 10 Mar 2024 (10 of 31 days)'));
  });

  // Half a day of readings is not "1 of 1 days": a day bucket covered in part names its hours.
  it('names the hours of a part-covered day', () => {
    const x = Array.from({ length: 36 }, (_, i) => new Date(Date.UTC(2026, 9, 1) + i * 3_600_000).toISOString());
    const spec: ZoomSpec = { type: 'line', data: { x, series: [{ id: 'a', values: x.map(() => 1) }] }, options: { xAxis: { type: 'time', zone: 'UTC' } } };
    const axis = zoomAxis(spec)!;
    const view = zoomSpec(spec, axis, axis.extent, { unit: 'day', step: 1 }, { aggregate: 'sum' });
    expect(num(view.data.series[0]!.values[1])).toBe(12);
    expect(covers(view.data.series[0]!.values[1])).toBe('2 Oct 00:00 to 2 Oct 12:00 (12 of 24 hours)');
    const half = Array.from({ length: 73 }, (_, i) => new Date(Date.UTC(2026, 9, 1) + i * 1_800_000).toISOString());
    const halves: ZoomSpec = { type: 'line', data: { x: half, series: [{ id: 'a', values: half.map(() => 1) }] }, options: { xAxis: { type: 'time', zone: 'UTC' } } };
    const halfAxis = zoomAxis(halves)!;
    expect(covers(zoomSpec(halves, halfAxis, halfAxis.extent, { unit: 'day', step: 1 }, { aggregate: 'sum' }).data.series[0]!.values[1])).toBe('2 Oct 00:00 to 2 Oct 12:30 (12.5 of 24 hours)');
  });

  // A host's own wording for a running period (a BoardplotTheme provider) must not be replaced.
  it("keeps the host's toDate wording", () => {
    const spec = daily(70);
    const axis = zoomAxis(spec)!;
    const view = zoomSpec(spec, axis, axis.extent, { unit: 'month', step: 1 }, { aggregate: 'sum' }, 'en', { toDate: 'so far' });
    expect((view.options!.strings as { toDate?: string } | undefined)?.toDate).toBeUndefined();
  });
});
