import type { ChartDefinition } from '../../registry';
import type { TableMarks } from '../table/layout';
import { parseData } from '../../schema/shared';
import { dimswitchCore } from './core';
import { exampleData } from './example';
import { dimswitchDataSchema, dimswitchOptionsSchema } from './schema';
import type { DimSwitchData, DimSwitchOptions, DimSwitchDerived } from './types';
export { dimswitchDataSchema, dimswitchOptionsSchema };
export type * from './types';
/** The describe example: the invented cube with its two top-level channels only, inside the discovery budget. */
const keep=new Set(['total','paid','organic']);
const describeExample: DimSwitchData={...exampleData,dimension:{...exampleData.dimension,members:exampleData.dimension.members.filter(m=>keep.has(m.id))},facts:exampleData.facts.filter(f=>keep.has(f.memberId))};
export const dimswitchDefinition: ChartDefinition<DimSwitchData,DimSwitchOptions,TableMarks,DimSwitchDerived> = {
 ...dimswitchCore,discovery:{example:{data:describeExample,options:{variant:'by-measure',depth:1,title:'Channel performance'}},notFor:'Two dimensions at once, such as channel by country, or a plain list of rows: use table. One KPI over time: use line or kpi. Calendar logic: the host computes the windows and their sums, and Boardplot does no date arithmetic.'},normalize:raw=>parseData(dimswitchDataSchema,raw),dataSchema:dimswitchDataSchema,optionsSchema:dimswitchOptionsSchema,
};
