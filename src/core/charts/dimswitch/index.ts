import type { ChartDefinition } from '../../registry';
import type { TableMarks } from '../table/layout';
import { parseData } from '../../schema/shared';
import { dimswitchCore } from './core';
import { dimswitchDataSchema, dimswitchOptionsSchema } from './schema';
import type { DimSwitchData, DimSwitchOptions, DimSwitchDerived } from './types';
export { dimswitchDataSchema, dimswitchOptionsSchema };
export type * from './types';
/** A starter cube: a count, a child measure and a computed cost ratio over the required comparison windows, with explicit Total facts. */
const describeExample: DimSwitchData = {
  dimension: {
    label: 'Channel', total: { id: 'total', label: 'Total' }, headline: ['orders', 'cac'],
    members: [{ id: 'paid', label: 'Paid Search' }, { id: 'organic', label: 'Organic' }],
  },
  measures: [
    { id: 'orders', label: 'Orders', scale: 'count', value: { field: 'orders' }, judge: { family: 'volume', base: 'orders' } },
    { id: 'new', label: 'New customers', scale: 'count', parentId: 'orders', value: { field: 'nc' } },
    { id: 'cac', label: 'CAC', scale: 'perUnit', value: { op: 'div', a: { field: 'spend' }, b: { field: 'nc' } }, format: '$1.2', unit: '$', judge: { family: 'cost', base: 'nc' } },
  ],
  periods: [
    { id: 'range', label: 'Current period', kind: 'range' },
    { id: 'prior', label: 'Prior period', kind: 'prior' },
    { id: 'w1', label: 'Week 1' },
  ],
  // Organic has no spend field, so its CAC prints as not available.
  facts: [
    { memberId: 'total', periodId: 'range', sums: { orders: 120, nc: 60, spend: 1800 } },
    { memberId: 'total', periodId: 'prior', sums: { orders: 100, nc: 50, spend: 1700 } },
    { memberId: 'total', periodId: 'w1', sums: { orders: 60, nc: 30, spend: 900 }, ref: { orders: 50 } },
    { memberId: 'paid', periodId: 'range', sums: { orders: 80, nc: 45, spend: 1800 } },
    { memberId: 'paid', periodId: 'prior', sums: { orders: 70, nc: 38, spend: 1700 } },
    { memberId: 'paid', periodId: 'w1', sums: { orders: 40, nc: 22, spend: 900 }, ref: { orders: 35 } },
    { memberId: 'organic', periodId: 'range', sums: { orders: 40, nc: 15 } },
    { memberId: 'organic', periodId: 'prior', sums: { orders: 30, nc: 12 } },
    { memberId: 'organic', periodId: 'w1', sums: { orders: 20, nc: 8 }, ref: { orders: 15 } },
  ],
};
export const dimswitchDefinition: ChartDefinition<DimSwitchData,DimSwitchOptions,TableMarks,DimSwitchDerived> = {
 ...dimswitchCore,discovery:{example:{data:describeExample,options:{variant:'by-measure',depth:2,title:'Channel performance'}},notFor:'Two dimensions at once, such as channel by country, or a plain list of rows: use table. One KPI over time: use line or kpi. Calendar logic: the host computes the windows and their sums, and Boardplot does no date arithmetic.'},normalize:raw=>parseData(dimswitchDataSchema,raw),dataSchema:dimswitchDataSchema,optionsSchema:dimswitchOptionsSchema,
};
