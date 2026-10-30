// Stands in for the sales API: weekly sums per channel, this year and last year. Invented data.
import type { DimSwitchData } from 'boardplot';

export const weeks = ['W30', 'W31', 'W32', 'W33', 'W34', 'W35', 'W36', 'W37', 'W38', 'W39'];
type Channel = 'online' | 'retail' | 'wholesale';
type Week = { rev: number; orders: number; gm: number };
type Series = { ac: Week[]; py: Week[] };

// Revenue in €k, average order value in €, gross margin in % of revenue.
// Last year's weeks swing around the yearly ratio, as real weeks do.
const SWING = [1.02, 0.97, 1.01, 1.04, 0.98, 1.0, 1.03, 0.96, 1.01, 0.99];
function channel(rev: number[], pyFactor: number, aov: number, margin: number, marginDrift: number): Series {
  const week = (r: number, i: number, factor: number, drift: number, basket: number): Week => ({
    rev: Math.round(r * factor * 1000),
    orders: Math.round((r * factor * 1000) / (aov * basket * SWING[(i + 3) % 10])),
    gm: Math.round(r * factor * 1000 * (margin - drift * i) / 100),
  });
  return { ac: rev.map((r, i) => week(r, i, 1, marginDrift, 1)), py: rev.map((r, i) => week(r, i, pyFactor * SWING[i], 0, 0.97)) };
}

export const sales: Record<Channel, Series> = {
  online: channel([1420, 1450, 1480, 1510, 1530, 1560, 1600, 1640, 1690, 1740], 0.81, 92, 55.6, 0.05),
  retail: channel([2100, 2080, 2120, 2060, 2040, 2050, 2010, 1990, 1980, 1960], 1.04, 64, 52.8, 0.12),
  wholesale: channel([980, 1000, 960, 1010, 990, 1000, 1020, 980, 1010, 1000], 0.97, 2400, 41.5, 0.08),
};
export const channels: { id: Channel; label: string }[] = [
  { id: 'online', label: 'Online' }, { id: 'retail', label: 'Retail' }, { id: 'wholesale', label: 'Wholesale' },
];

const add = (a: Week, b: Week): Week => ({ rev: a.rev + b.rev, orders: a.orders + b.orders, gm: a.gm + b.gm });
const zero: Week = { rev: 0, orders: 0, gm: 0 };
export const total: Series = {
  ac: weeks.map((_, i) => channels.reduce((s, c) => add(s, sales[c.id].ac[i]), zero)),
  py: weeks.map((_, i) => channels.reduce((s, c) => add(s, sales[c.id].py[i]), zero)),
};
export const planW39 = { rev: 4_760_000 };

// The KPI table: the last four weeks against the four before, each week against last year.
const sum = (rows: Week[]) => rows.reduce(add, zero);
const sums = (w: Week) => ({ rev: w.rev, orders: w.orders, gm: w.gm });
const RANGE = [6, 7, 8, 9];
const PRIOR = [2, 3, 4, 5];
function facts(memberId: string, s: Series) {
  return [
    { memberId, periodId: 'range', sums: sums(sum(RANGE.map((i) => s.ac[i]))), ref: sums(sum(RANGE.map((i) => s.py[i]))) },
    { memberId, periodId: 'prior', sums: sums(sum(PRIOR.map((i) => s.ac[i]))), ref: sums(sum(PRIOR.map((i) => s.py[i]))) },
    ...RANGE.map((i) => ({ memberId, periodId: weeks[i], sums: sums(s.ac[i]), ref: sums(s.py[i]) })),
  ];
}
export const kpiTable: DimSwitchData = {
  dimension: { label: 'Channel', total: { id: 'total', label: 'All channels' }, members: channels, headline: ['rev', 'gm'] },
  measures: [
    { id: 'rev', scale: 'money', label: 'Revenue', unit: '€', value: { field: 'rev' }, judge: { family: 'volume', base: 'orders' } },
    { id: 'orders', scale: 'count', label: 'Orders', value: { field: 'orders' }, judge: { family: 'volume', base: 'orders' } },
    { id: 'aov', scale: 'perUnit', label: 'Average order', unit: '€', value: { op: 'div', a: { field: 'rev' }, b: { field: 'orders' } }, judge: { family: 'volume', base: 'orders' } },
    { id: 'gm', scale: 'percent', label: 'Gross margin', format: '1.1%', change: 'pp', value: { op: 'div', a: { field: 'gm' }, b: { field: 'rev' }, factor: 100 }, judge: { family: 'rate', base: 'orders' } },
  ],
  periods: [
    { id: 'range', label: 'W36–W39', kind: 'range' },
    { id: 'prior', label: 'W32–W35', kind: 'prior' },
    ...RANGE.map((i) => ({ id: weeks[i], label: weeks[i] })),
  ],
  facts: [...facts('total', total), ...channels.flatMap((c) => facts(c.id, sales[c.id]))],
} as DimSwitchData;

// Revenue by region, W36–W39, in €m: actual, last year and plan.
export const regions = {
  categories: ['DACH', 'Nordics', 'Benelux', 'UK', 'Iberia', 'France'].map((label) => ({ id: label.toLowerCase(), label })),
  AC: [6.16, 3.76, 2.71, 2.51, 1.88, 1.60],
  PY: [5.52, 3.55, 2.62, 2.48, 1.58, 1.80],
  PL: [6.02, 3.92, 2.67, 2.61, 1.76, 1.82],
};
