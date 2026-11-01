import { expect, it } from 'vitest';
import '../src/core/charts';
import { layoutButterfly } from '../src/core/charts/butterfly/layout';
import { layoutDot } from '../src/core/charts/dot/layout';
import { layoutLikert } from '../src/core/charts/likert/layout';
import { layoutSlope } from '../src/core/charts/slope/layout';

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

  const data = { categories, series: [{ id: 'p', values: [42, 60] }, { id: 'q', values: [45, 39] }] };
  expect(shown(layoutButterfly(data, { a: 'p', b: 'q', sortBy: 'diff', size: { width: 900, height: 400 } }), 'diff:')).toEqual({ a: '+3', b: '−21' });
  expect(shown(layoutButterfly(data, { a: 'p', b: 'q', size: { width: 900, height: 400 } }), 'diff:')).toEqual({});
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
