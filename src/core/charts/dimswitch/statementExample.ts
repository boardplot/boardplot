import type { DimSwitchData, DimSwitchMeasure } from './types';

/**
 * Invented contribution-margin statement per order of a garden-centre chain,
 * with KPI rows above it. Income = gross profit + delivery charges; gross
 * profit = (price before discounts - returns) x gross margin; margin after
 * order costs = income - costs; final margin = that margin - sales costs.
 * Costs are authored as positive amounts with sign -1.
 */
const perOrder = (field: string) => ({ op: 'div' as const, a: { field }, b: { field: 'orders' } });
const line = (id: string, label: string, field: string, extra: Partial<DimSwitchMeasure> = {}): DimSwitchMeasure =>
  ({ id, label, value: perOrder(field), format: '1.2', change: 'absolute', judge: { family: 'effect' }, ...extra });
const cm = 'Contribution margin';
const measures: DimSwitchMeasure[] = [
  { id: 'orders', label: 'Orders', scale: 'count', value: { field: 'orders' }, judge: { family: 'volume', base: 'orders' }, group: 'Orders & customers' },
  { id: 'aov', label: 'AOV', format: '1.2', value: perOrder('rev'), judge: { family: 'rate', base: 'orders' }, group: 'Orders & customers' },
  { id: 'income', label: 'Income', format: '1.2', change: 'absolute', judge: { family: 'effect' }, group: cm },
  line('gp', 'Gross profit', 'gp', { partOf: 'income', drivers: { op: 'mul', a: { op: 'sub', a: { measure: 'aovbd' }, b: { measure: 'ret' } }, b: { measure: 'gm' } } }),
  line('shipi', 'Delivery charges', 'shipi', { partOf: 'income' }),
  line('aovbd', 'Price before discounts', 'revbd'),
  line('ret', 'Returns and refunds', 'returns'),
  { id: 'gm', label: 'Gross margin', scale: 'percent', format: '1.2%', change: 'pp', judge: { family: 'effect' }, value: { op: 'div', a: { field: 'gp' }, b: { op: 'sub', a: { field: 'revbd' }, b: { field: 'returns' } }, factor: 100 } },
  { id: 'costs', label: 'Costs', format: '1.2', change: 'absolute', judge: { family: 'effect' }, sign: -1, group: cm },
  line('pay', 'Payment fees', 'pay', { partOf: 'costs' }),
  line('ship', 'Delivery', 'ship', { partOf: 'costs' }),
  line('pick', 'Handling', 'pick', { partOf: 'costs' }),
  line('cm2', 'Margin after order costs', '', { result: true, value: { op: 'sub', a: { measure: 'income' }, b: { measure: 'costs' } }, group: cm }),
  { id: 'mkt', label: 'Sales costs', format: '1.2', change: 'absolute', judge: { family: 'effect' }, sign: -1, group: cm },
  line('spend', 'Advertising', 'spend', { partOf: 'mkt' }),
  line('disc', 'Promotions', 'disc', { partOf: 'mkt' }),
  line('cm3', 'Final margin', '', { result: true, value: { op: 'sub', a: { measure: 'cm2' }, b: { measure: 'mkt' } }, group: cm }),
];

const members = [{ id: 'stores', label: 'Stores' }, { id: 'online', label: 'Web shop' }];
const periods = ['prior', 'range', 'w1', 'w2', 'w3', 'w4'];
/** Deterministic invented sums: member m, period index p. */
function sums(m: number, p: number) {
  const orders = [420, 160][m]! + p * 12 - (p === 5 ? 300 : 0) * (m === 0 ? 1 : 0.3);
  const k = (base: number, drift: number) => Math.round(orders * (base + drift * ((p * 7 + m * 3) % 5 - 2)) * 100) / 100;
  const revbd = k(72 - m * 6, 0.9), returns = k(0.8 + m * 0.4, 0.2), gp = Math.round((revbd - returns) * (0.44 - m * 0.03 + 0.004 * ((p + m) % 3 - 1)) * 100) / 100;
  return {
    orders: Math.round(orders), rev: k(70 - m * 6, 0.8), revbd, returns, gp, shipi: k(2.5, 0.1),
    pay: k(1.8, 0.05), ship: k(10.4 + m, 0.3), pick: k(2.7, 0.08), spend: k(9 - m * 3, 0.6), disc: k(3.5, 0.4),
  };
}
const memberSums = (m: number, p: number) => sums(m, p);
export const statementData: DimSwitchData = {
  dimension: { label: 'Channel', total: { id: 'total', label: 'Total', heading: 'Orders & customers' }, members, headline: ['orders'], sums: true },
  changeLabel: 'WoW',
  effectLabel: 'Margin effect',
  groupHeadings: { [cm]: 'Contribution margin · per order · changes per order' },
  measures,
  periods: [
    { id: 'range', label: 'Range', subLabel: '4 weeks', kind: 'range' },
    { id: 'prior', label: 'vs prior', subLabel: '4 weeks before', kind: 'prior' },
    { id: 'w1', label: 'W1' }, { id: 'w2', label: 'W2' }, { id: 'w3', label: 'W3' }, { id: 'w4', label: 'W4', subLabel: 'to date', partial: true },
  ],
  facts: members.flatMap((member, m) => periods.map((periodId, i) => {
    // Range sums W1-W4, prior is four times the week before W1; a week compares with the week before.
    const s = periodId === 'range' ? total([2, 3, 4, 5].map((p) => memberSums(m, p))) : periodId === 'prior' ? scale(memberSums(m, i), 4) : memberSums(m, i);
    const ref = periodId === 'range' || periodId === 'prior' ? undefined : memberSums(m, i - 1);
    return { memberId: member.id, periodId, sums: s, ...(ref ? { ref } : {}) };
  })),
};
function scale(s: Record<string, number>, n: number) {
  return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Math.round(v * n * 100) / 100]));
}
function total(weeks: Record<string, number>[]) {
  return Object.fromEntries(Object.keys(weeks[0]!).map((k) => [k, Math.round(weeks.reduce((sum, week) => sum + week[k]!, 0) * 100) / 100]));
}
