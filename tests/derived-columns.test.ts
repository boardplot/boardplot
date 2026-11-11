import { expect, it } from 'vitest';
import '../src/core/charts';
import { layoutButterfly } from '../src/core/charts/butterfly/layout';
import { layoutDot } from '../src/core/charts/dot/layout';
import { layoutLikert } from '../src/core/charts/likert/layout';
import { layoutSlope } from '../src/core/charts/slope/layout';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import { requireGeometry } from '../src/core/sizing';

const shown = (geo: { labels: { id: string; text: string; hidden?: string }[] }, prefix: string) =>
  Object.fromEntries(geo.labels.filter((l) => l.id.startsWith(prefix) && !l.hidden).map((l) => [l.id.slice(prefix.length), l.text]));

// A reader subtracts two printed labels per row when a derived difference stays unprinted.
// The column prints the signed difference at the precision of the values, and stays off on a narrow canvas.
it('slope change, dumbbell gap and butterfly difference print signed differences in a column', () => {
  const categories = [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }];
  const slope = layoutSlope(
    { categories: [{ id: 'y1' }, { id: 'y2' }], series: [{ id: 'x', label: 'X', values: [11.2, 24.6] }, { id: 'y', label: 'Y', values: [22.4, 19.8] }] },
    { change: 'absolute', unit: '%', size: { width: 900, height: 400 } },
  );
  expect(shown(slope, 'change:')).toEqual({ x: '+13.4', y: '−2.6' });
  expect(slope.labels.some((l) => l.text === 'Change, pp')).toBe(true);
  expect(shown(layoutSlope({ categories: [{ id: 'y1' }, { id: 'y2' }], series: [{ id: 'x', values: [10, 15] }] },
    { change: 'relative', size: { width: 900, height: 400 } }), 'change:')).toEqual({ x: '+50' });
  expect(shown(layoutSlope({ categories: [{ id: 'y1' }, { id: 'y2' }], series: [{ id: 'x', values: [10, 15] }] },
    { change: 'absolute', size: { width: 500, height: 400 } }), 'change:')).toEqual({});

  const dot = layoutDot(
    { categories, series: [{ id: 'p', values: [8.73, 9.22] }, { id: 'q', values: [9.42, 8.01] }] },
    { variant: 'dumbbell', gapColumn: true, unit: '%', size: { width: 900, height: 300 } },
  );
  expect(shown(dot, 'gap:')).toEqual({ a: '+0.69', b: '−1.21' });
  // The column foots with the two printed labels: 9.236 and 7.894 print 9.24 and 7.89, so the gap is -1.35, not -1.34.
  const footing = layoutDot(
    { categories, series: [{ id: 'p', values: [9.236, 8.619] }, { id: 'q', values: [7.894, 9.514] }] },
    { variant: 'dumbbell', gapColumn: true, unit: '%', size: { width: 900, height: 300 } },
  );
  expect(shown(footing, 'gap:')).toEqual({ a: '−1.35', b: '+0.89' });

  const data = { categories, series: [{ id: 'p', values: [42, 60] }, { id: 'q', values: [45, 39] }] };
  expect(shown(layoutButterfly(data, { a: 'p', b: 'q', sortBy: 'diff', size: { width: 900, height: 400 } }), 'diff:')).toEqual({ a: '+3', b: '−21' });
  expect(shown(layoutButterfly(data, { a: 'p', b: 'q', size: { width: 900, height: 400 } }), 'diff:')).toEqual({});
  // An authored delta of b over a repeats the column's number, so only the column prints it.
  const authored = layoutButterfly(data, {
    a: 'p', b: 'q', sortBy: 'diff', size: { width: 900, height: 400 },
    annotations: [{ kind: 'delta', at: { categoryId: 'b', seriesId: 'q' }, vs: { categoryId: 'b', seriesId: 'p' } }],
  });
  expect(authored.labels.filter((l) => l.text.includes('21') && !l.hidden).map((l) => l.id)).toEqual(['diff:b']);
  expect(authored.warnings.some((w) => w.code === 'delta-column-covers-annotation')).toBe(true);
});

// Footnotes are hidden in a static render, so the base of every share needs its own place on the page.
it('likert prints each statement base in a column, or once in the head when all bases agree', () => {
  const scale = [{ id: 'sd', label: 'Strongly disagree' }, { id: 'd', label: 'Disagree' }, { id: 'a', label: 'Agree' }, { id: 'sa', label: 'Strongly agree' }];
  const draw = (items: number[][], base?: 'none') => layoutLikert(
    { scale, items: items.map((values, i) => ({ id: `s${i}`, label: `Statement ${i}`, values })) },
    { values: 'counts', size: { width: 900, height: 400 }, ...(base ? { base } : {}) },
  );
  expect(shown(draw([[10, 20, 100, 180], [20, 30, 150, 287]]), 'likert:base:')).toEqual({ s0: '310', s1: '487' });
  const same = draw([[50, 50, 100, 100], [40, 60, 70, 130]]);
  expect(shown(same, 'likert:base:')).toEqual({});
  expect(same.labels.some((l) => l.text === 'Net, pp · n = 300')).toBe(true);
  expect(shown(draw([[10, 20, 100, 180], [20, 30, 150, 287]], 'none'), 'likert:base:')).toEqual({});
});

// A difference column printed "+1,030,000,000.00" beside pane labels of "1,070M" and "2,100M".
it('prints a difference column at the scale of the values it subtracts', () => {
  const categories = [{ id: 'n', label: 'North' }, { id: 's', label: 'South' }];
  const series = [{ id: 'p', label: '2024', values: [1_070_000_000, 640_000_000] }, { id: 'q', label: '2025', values: [2_100_000_000, 720_000_000] }];
  const draw = (type: string, options: object) => requireGeometry(layoutResolvedRequest(resolveChartRequest({ type, data: { categories, series }, options: { title: 'T', size: { width: 900, height: 400 }, ...options } } as never)));
  expect(shown(draw('butterfly', { a: 'p', b: 'q', diffColumn: true }), 'diff:')).toEqual({ n: '+1,030M', s: '+80M' });
  expect(shown(draw('dot', { variant: 'dumbbell', gapColumn: true }), 'gap:')).toEqual({ n: '+1.03B', s: '+80M' });
  const slope = { categories: [{ id: 'y1' }, { id: 'y2' }], series: [{ id: 'p', values: [1_070_000_000, 2_100_000_000] }, { id: 'q', values: [640_000_000, 720_000_000] }] };
  expect(shown(requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'slope', data: slope, options: { title: 'T', change: 'absolute', size: { width: 900, height: 400 } } } as never))), 'change:')).toEqual({ p: '+1.03B', q: '+80M' });
  // A series unit that names a scale ('$m') keeps the labels unscaled, so the column adds no second scale ("+1.03M").
  const inMillions = { categories, series: series.map((s) => ({ ...s, unit: '$m', values: s.values.map((v) => v / 1000) })) };
  const unscaled = (type: string, data: object, options: object, prefix: string) => Object.values(shown(requireGeometry(layoutResolvedRequest(resolveChartRequest({ type, data, options: { title: 'T', size: { width: 900, height: 400 }, ...options } } as never))), prefix));
  for (const [type, options, prefix] of [['butterfly', { a: 'p', b: 'q', diffColumn: true }, 'diff:'], ['dot', { variant: 'dumbbell', gapColumn: true }, 'gap:']] as const) {
    expect(unscaled(type, inMillions, options, prefix).every((text) => /^\+[0-9,.]+$/.test(text)), type).toBe(true);
  }
  const slopeInMillions = { ...slope, series: slope.series.map((s) => ({ ...s, unit: '$m', values: s.values.map((v) => v / 1000) })) };
  expect(unscaled('slope', slopeInMillions, { change: 'absolute' }, 'change:').every((text) => /^\+[0-9,.]+$/.test(text))).toBe(true);
});
