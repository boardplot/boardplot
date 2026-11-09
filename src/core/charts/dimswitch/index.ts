import type { ChartDefinition } from '../../registry';
import type { TableMarks } from '../table/layout';
import { parseData } from '../../schema/shared';
import { dimswitchCore } from './core';
import { dimswitchDataSchema, dimswitchOptionsSchema } from './schema';
import type { DimSwitchData, DimSwitchOptions, DimSwitchDerived } from './types';
export { dimswitchDataSchema, dimswitchOptionsSchema };
export type * from './types';
/** A starter cube: one measure, the required comparison windows and explicit Total facts. */
const describeExample: DimSwitchData = {
  dimension: {
    label: 'Channel', total: { id: 'total', label: 'Total' }, headline: ['orders'],
    members: [{ id: 'paid', label: 'Paid Search' }, { id: 'organic', label: 'Organic' }],
  },
  measures: [{ id: 'orders', label: 'Orders', scale: 'count', value: { field: 'orders' } }],
  periods: [
    { id: 'range', label: 'Current period', kind: 'range' },
    { id: 'prior', label: 'Prior period', kind: 'prior' },
    { id: 'w1', label: 'Week 1' },
  ],
  facts: [
    { memberId: 'total', periodId: 'range', sums: { orders: 120 } },
    { memberId: 'total', periodId: 'prior', sums: { orders: 100 } },
    { memberId: 'total', periodId: 'w1', sums: { orders: 60 }, ref: { orders: 50 } },
    { memberId: 'paid', periodId: 'range', sums: { orders: 80 } },
    { memberId: 'paid', periodId: 'prior', sums: { orders: 70 } },
    { memberId: 'paid', periodId: 'w1', sums: { orders: 40 }, ref: { orders: 35 } },
    { memberId: 'organic', periodId: 'range', sums: { orders: 40 } },
    { memberId: 'organic', periodId: 'prior', sums: { orders: 30 } },
    { memberId: 'organic', periodId: 'w1', sums: { orders: 20 }, ref: { orders: 15 } },
  ],
};
export const dimswitchDefinition: ChartDefinition<DimSwitchData,DimSwitchOptions,TableMarks,DimSwitchDerived> = {
 ...dimswitchCore,discovery:{example:{data:describeExample,options:{variant:'by-measure',depth:1,title:'Channel performance'}},notFor:'Two dimensions at once, such as channel by country, or a plain list of rows: use table. One KPI over time: use line or kpi. Calendar logic: the host computes the windows and their sums, and Boardplot does no date arithmetic.'},normalize:raw=>parseData(dimswitchDataSchema,raw),dataSchema:dimswitchDataSchema,optionsSchema:dimswitchOptionsSchema,
};
