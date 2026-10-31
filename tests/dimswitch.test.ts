import { describe, expect, it, vi } from 'vitest';
import { withNumberMarks } from '../src/core/numberMarks';
import '../src/core/charts';
import { compileDimSwitch, dimswitchRowId } from '../src/core/charts/dimswitch/compile';
import { resolveDimSwitch, dimswitchCore } from '../src/core/charts/dimswitch/core';
import { exampleData } from '../src/core/charts/dimswitch/example';
import { dimswitchDataSchema } from '../src/core/charts/dimswitch/schema';
import { visibleRows } from '../src/core/charts/table/view';
import { renderSvg } from '../src/core/svg/renderSvg';
import { resolveTheme } from '../src/core/theme';
import { requireGeometry } from '../src/core/sizing';
import { layoutResolvedRequest, resolveChartRequest } from '../src/core/request';
import type { DimSwitchData, DimSwitchDerived, DimSwitchSums, DimSwitchVariant } from '../src/core/charts/dimswitch/types';
import { claimsForChart } from '../src/core/claims/browser';
import { tableCellNodeId } from '../src/core/charts/table/cellKey';
import { DERIVATION_KINDS, recomputeClaim } from './helpers/recompute';
import { getFixtures } from '../src/fixtures';
// Wraps the real compile to count calls; the output is unchanged.
vi.mock('../src/core/charts/dimswitch/compile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/charts/dimswitch/compile')>();
  return { ...actual, compileDimSwitch: vi.fn(actual.compileDimSwitch) };
});
const rows=(variant:DimSwitchVariant,depth:number,splits=false)=>visibleRows(resolveDimSwitch(exampleData,{variant,depth,splits}).table);
const row=(member:string,measure:string,data=exampleData)=>resolveDimSwitch(data).table.rows.find(r=>r.id===dimswitchRowId('by-measure',member,measure))!;
// A cycle spanning subtotal placement and driver ownership must give input advice, not overflow the stack.
it('refuses combined partOf and driver placement cycles before group resolution', () => {
 for (const grouped of [false, true]) {
  const data: DimSwitchData = { ...exampleData, dimension: { ...exampleData.dimension, headline: ['result'] }, measures: [
   { id: 'result', label: 'Result', value: { field: 'orders' }, partOf: 'driver', drivers: { measure: 'driver' }, ...(grouped ? { group: 'Statement' } : {}) },
   { id: 'driver', label: 'Driver', value: { field: 'orders' } },
  ] };
  expect(dimswitchDataSchema.safeParse(data).success).toBe(true);
  try {
   compileDimSwitch(data);
   expect.fail('expected a placement-cycle refusal');
  } catch (error) {
   expect(error).toMatchObject({ code: 'invalid-data', path: 'measures' });
   expect((error as Error).message).toMatch(/cycle.*'result'\.partOf.*'driver'.*'result'\.drivers/);
  }
  delete data.measures[0]!.partOf;
  data.measures[0]!.group = 'Statement';
  expect(() => compileDimSwitch(data)).not.toThrow();
 }
});
// One measure reads in one magnitude down a column: a member at 210k under a 1.2M total prints 0.21M, not 210.0k.
// At the group's precision a member at 300 prints the bound "<0.01M", not 0.0003M, and an exact zero prints "0", not 0.00M.
it('prints every member row of a money measure in the magnitude of its largest cell', () => {
 const factor:Record<string,number>={total:100,paid:20,'search-b':0,organic:0.05};
 const scaled=(sums:DimSwitchSums|undefined,f:number)=>sums && {...sums,rev:sums.rev!*f};
 const data:DimSwitchData={...exampleData,facts:exampleData.facts.map(fact=>({...fact,sums:scaled(fact.sums,factor[fact.memberId] ?? 1)!,...(fact.ref ? {ref:scaled(fact.ref,factor[fact.memberId] ?? 1)} : {})}))};
 expect(['total','paid','search-b','organic'].map(member=>row(member,'revenue',data).cells.range!.displayed)).toEqual(['1.20M','0.21M','0','<0.01M']);
 // A measure whose largest figure is below 1 keeps the group precision with no magnitude letter: 0.18, not "<1" on every row.
 const tiny=(sums:DimSwitchSums|undefined)=>sums && (sums.spend==null ? sums : {...sums,spend:sums.spend*0.0001});
 const small:DimSwitchData={...exampleData,facts:exampleData.facts.map(fact=>({...fact,sums:tiny(fact.sums)!,...(fact.ref ? {ref:tiny(fact.ref)} : {})}))};
 expect(['total','paid','search-a','search-b'].map(member=>row(member,'spend',small).cells.range!.displayed)).toEqual(['0.180','0.160','0.140','0.120']);
});
// Period cells of 1.46M printed one string (1.5M ... 1.4M) because the Range total of 18.2M set the precision of every column of the measure.
it('gives each column of a money measure the precision its own figures need', () => {
 const sums=(amount:number)=>({amount});
 const data:DimSwitchData={dimension:{label:'Region',total:{id:'total',label:'Total'},members:[{id:'a',label:'A'},{id:'b',label:'B'}],headline:['amount'],sums:true},
  measures:[{id:'amount',scale:'money',label:'Amount',value:{field:'amount'}}],periods:[{id:'range',label:'Range',kind:'range'},{id:'prior',label:'Prior',kind:'prior'},{id:'p1',label:'P1'},{id:'p2',label:'P2'}],
  facts:[['total',18200000,1460000,1440000],['a',17100000,1370000,1350000],['b',1100000,90000,90000]].flatMap(([memberId,...v])=>(['range','p1','p2'] as const).map((periodId,i)=>({memberId:memberId as string,periodId,sums:sums(v[i] as number),...(i===0 ? {ref:sums(v[0] as number*0.9)} : {})})))};
 expect(['range','p1','p2'].map(col=>row('total','amount',data).cells[col]!.displayed)).toEqual(['18.2M','1.46M','1.44M']);
 expect(['range','p1','p2'].map(col=>row('b','amount',data).cells[col]!.displayed)).toEqual(['1.1M','0.09M','0.09M']);
});
// Scale 'money' climbs k, M, B itself, so a unit that names a magnitude prints 1,320 Mio. CHF as 1.32k.
it('warns when a money measure has a unit that names a magnitude', () => {
 const data:DimSwitchData={...exampleData,measures:exampleData.measures.map(m=>m.scale==='money' ? {...m,unit:'Mio. CHF'} : m)};
 expect(compileDimSwitch(data).warnings.filter(w=>w.code==='dimswitch-scale-unit').length).toBeGreaterThan(0);
 expect(compileDimSwitch(exampleData).warnings.some(w=>w.code==='dimswitch-scale-unit')).toBe(false);
});
// One table prints one decimal separator: language alone must not switch the comparisons to commas while the values keep points.
it('keeps the value separator in comparisons when only the language is German', () => {
 const german=resolveDimSwitch(exampleData,{locale:{language:'de'}}).table.rows.find(r=>r.id===dimswitchRowId('by-measure','total','cac'))!;
 const separator=(text:string)=>/[.,](?=\d)/.exec(text)?.[0];
 expect(separator(german.cells.pp!.displayed)).toBe(separator(german.cells.range!.displayed));
});
// Explicit marks rule every number: an English example ('$1.2') and the generated comparison ('1.2%') both print the chart's comma, so one card never shows two decimal marks.
it('prints values and generated comparisons with the explicit decimal mark', () => {
 const cac=resolveDimSwitch(exampleData,withNumberMarks({locale:{decimal:','}})).table.rows.find(r=>r.id===dimswitchRowId('by-measure','total','cac'))!;
 for (const text of [cac.cells.range!.displayed,cac.cells.pp!.displayed]) expect(text).toMatch(/\d,\d/);
});

describe('dimswitch compiler',()=>{
  it('refuses an expansion id that does not start with a variant, since it names no row', () => {
    const expand = (id: string) => () => compileDimSwitch(exampleData, { variant: 'by-measure', depth: 1, expansion: { expanded: [id] } });
    expect(expand('["byMeasure","total","orders"]')).toThrow(/names no variant first/);
    expect(expand(dimswitchRowId('by-measure', 'total', 'orders'))).not.toThrow();
  });
 it('validates invented cube data',()=>{expect(dimswitchDataSchema.parse(exampleData)).toEqual(exampleData);});
 it('opens the same axis rung in either variant',()=>{
  expect([1,2,3].map(d=>rows('by-measure',d).length)).toEqual([4,10,18]);
  expect([1,2,3].map(d=>rows('by-member',d).length)).toEqual([7,15,23]); // no section row repeats the dimension label
 });
 it('adds splits without changing the depth defaults',()=>{
  for(const variant of ['by-measure','by-member'] as const) for(const depth of [1,2,3]) {
   expect(compileDimSwitch(exampleData,{variant,depth,splits:true}).depthCollapsed).toEqual(compileDimSwitch(exampleData,{variant,depth}).depthCollapsed);
   expect(rows(variant,depth,true).filter(r=>r.kind!=='split').map(r=>r.id)).toEqual(rows(variant,depth).map(r=>r.id));
  }
 });
 it('omits CAC for members without spend',()=>{expect(row('organic','cac')).toBeUndefined();expect(row('organic','orders')).toBeDefined();});
 it('derives ratios from the supplied sums',()=>{expect(row('total','cac').cells.range!.raw).toBe(1800/60);});
 it('does not judge a partial period',()=>{expect(row('total','orders').cells.w2!.tone).toBe('neutral');});
 it('checks the sample in either window',()=>{
  for(const low of ['current','reference']) {
   const data=structuredClone(exampleData); const f=data.facts.find(f=>f.memberId==='total'&&f.periodId==='w1')!;
   (low==='current'?f.sums:f.ref!).orders=10;
   const resolved=resolveDimSwitch(data,{minimumSample:{orders:30}});
   expect(resolved.table.rows.find(r=>r.id===dimswitchRowId('by-measure','total','orders'))!.cells.w1!.tone).toBe('neutral');
  }
 });
 // A measured drop to zero stayed neutral despite sufficient current and reference samples.
 it('judges a zero current value when the declared samples pass',()=>{
  const current={completed:0,spend:0,eligible:100}, reference={completed:100,spend:10000,eligible:100};
  const data:DimSwitchData={
   dimension:{label:'Team',total:{id:'total',label:'Total'},members:[],headline:['completed']},
   measures:[
    {id:'completed',label:'Completed tasks',scale:'count',value:{field:'completed'},judge:{family:'volume',base:'eligible'}},
    {id:'cost',label:'Cost per eligible task',scale:'perUnit',format:'$1.2',unit:'$',value:{op:'div',a:{field:'spend'},b:{field:'eligible'}},judge:{family:'cost',base:'eligible'}},
   ],
   periods:[{id:'range',label:'Range',kind:'range'},{id:'prior',label:'vs prior',kind:'prior'},{id:'w1',label:'Week 1'}],
   facts:[{memberId:'total',periodId:'range',sums:current},{memberId:'total',periodId:'prior',sums:reference},{memberId:'total',periodId:'w1',sums:current,ref:reference}],
  };
  const r=resolveDimSwitch(data,{minimumSample:{eligible:50}});
  const completed=r.table.rows.find(row=>row.id===dimswitchRowId('by-measure','total','completed'))!;
  const cost=r.table.rows.find(row=>row.id===dimswitchRowId('by-measure','total','cost'))!;
  expect(completed.cells.pp).toMatchObject({raw:-100,displayed:'−100%',tone:'bad'});
  expect(cost.cells.pp).toMatchObject({raw:-100,displayed:'−100%',tone:'good'});
  expect(r.table.rows.find(row=>row.id===completed.id+':change')!.cells.w1!.tone).toBe('bad');
  expect(r.table.rows.find(row=>row.id===cost.id+':change')!.cells.w1!.tone).toBe('good');
 });
 it('falls back to revenue as the organic headline',()=>{const r=resolveDimSwitch(exampleData,{variant:'by-member'}).table.rows.find(r=>r.id===dimswitchRowId('by-member','organic'))!;expect(r.cells.range!.raw).toBe(6000);expect(r.unitAffix).toContain('Net revenue');});
 it('keeps small per-unit costs in units',()=>{expect(row('total','cac').cells.range!.displayed).toBe('30.0');expect(row('total','cac').unitAffix).toBe('$');});
 it('records every derived value and change',()=>{const r=resolveDimSwitch(exampleData);expect(r.computedCells.find(c=>c.rowId===dimswitchRowId('by-measure','total','cac')&&c.colId==='range')).toMatchObject({raw:30,displayed:'30.0',kind:'calc'});});
 // A narrow table must keep its full omitted-period reading and honor the shared footer list limit.
 it('draws a short period disclosure and keeps every omitted name in the note record',()=>{
  // 13 periods: tight spacing fits one more period, so 10 stay left out and the 8-name short form still applies.
  const periods=Array.from({length:13},(_,i)=>({id:`p${i+1}`,label:`Period ${i+1}`}));
  const data:DimSwitchData={dimension:{label:'Segment',total:{id:'total',label:'Total'},members:[],headline:['orders']},measures:[{id:'orders',label:'Orders',scale:'count',value:{field:'orders'}}],
   periods:[{id:'range',label:'Range',kind:'range'},{id:'prior',label:'Prior',kind:'prior'},...periods],
   facts:[{memberId:'total',periodId:'range',sums:{orders:1200}},{memberId:'total',periodId:'prior',sums:{orders:1080}},...periods.map(p=>({memberId:'total',periodId:p.id,sums:{orders:100},ref:{orders:90}}))]};
  for(const maxListed of [undefined,0,1,'all'] as const){
   const geometry=requireGeometry(layoutResolvedRequest(resolveChartRequest({type:'dimswitch',data,options:{size:{width:320},footnotes:false,notes:{show:['note','disclosure'],...(maxListed===undefined?{}:{maxListed})}}})));
   const shown=new Set((geometry.derived as unknown as DimSwitchDerived).table.columns.map(c=>c.id)),hidden=periods.filter(p=>!shown.has(p.id));expect(hidden.length).toBeGreaterThan(6);
   const full=hidden.map(p=>p.label).join(', '),note=geometry.frame.noteList!.find(n=>n.text.includes(full))!;expect(note).toBeDefined();expect(note.inFrame).toBe(true);
   const footer=geometry.scene.filter(n=>n.t==='text'&&geometry.frame.footnoteNodeIds?.includes(n.id)).map(n=>n.t==='text'?n.lines.join(' '):'').join(' ');
   if(maxListed==='all'){expect(note.short).toBeUndefined();expect(footer).toContain(full);}
   else{expect(note.short).toBeDefined();expect(footer).toContain(note.short);expect(footer).not.toContain(full);
    const named=maxListed===undefined?8:maxListed;
    expect(note.short).toBe(`${named===0?`${hidden.length} items`:`${hidden.slice(0,named).map(p=>p.label).join(', ')}, and ${hidden.length-named} more`} not shown at this width.`);}
  }
  // W9, W10 is narrower than "and 2 more": the full list draws, and 381 × 134 draws.
  // 16 weeks: tight spacing fits one more week, so W1 to W9 stay left out.
  const weeks=Array.from({length:16},(_,i)=>({id:`w${i+1}`,label:`W${i+1}`}));
  const w15:DimSwitchData={...data,periods:[data.periods[0]!,data.periods[1]!,...weeks],facts:['range','prior',...weeks.map(p=>p.id)].map(periodId=>({memberId:'total',periodId,sums:{orders:100},ref:{orders:90}}))};
  const geometry=requireGeometry(layoutResolvedRequest(resolveChartRequest({type:'dimswitch',data:w15,options:{notes:{show:['note','disclosure']},size:{width:381,height:134}}})));
  const note=geometry.frame.noteList!.find(n=>n.kind==='disclosure')!;
  expect(geometry.size).toEqual({width:381,height:134});
  expect(note.text).toBe('W1, W2, W3, W4, W5, W6, W7, W8, W9 not shown at this width.');expect(note.short).toBeUndefined();
  // An author-set maxListed: 0 keeps the count form even where the one name is narrower.
  // Six weeks: smaller change lines and tight spacing fit five weeks at 320 px, so exactly W1 stays left out.
  const w6:DimSwitchData={...w15,periods:w15.periods.slice(0,8),facts:w15.facts.slice(0,8)};
  const counted=requireGeometry(layoutResolvedRequest(resolveChartRequest({type:'dimswitch',data:w6,options:{size:{width:320},notes:{show:['note','disclosure'],maxListed:0}}})));
  const one=counted.frame.noteList!.find(n=>n.kind==='disclosure')!;
  const drawn=counted.scene.filter(n=>n.t==='text'&&counted.frame.footnoteNodeIds?.includes(n.id)).map(n=>n.t==='text'?n.lines.join(' '):'').join(' ');
  expect(one.text).toBe('W1 not shown at this width.');expect(one.short).toMatch(/^1 item/);expect(drawn).toContain(one.short);
 });
 // A supported underscore locale must keep the omitted-period footer in German at a fixed card height.
 it('uses German list words for de_DE in a fixed-height card',()=>{
  const periods=Array.from({length:23},(_,i)=>({id:`w${i+1}`,label:`W${i+1}`}));
  const data:DimSwitchData={dimension:{label:'Segment',total:{id:'total',label:'Total'},members:[],headline:['orders']},measures:[{id:'orders',label:'Orders',scale:'count',value:{field:'orders'}}],
   periods:[{id:'range',label:'Range',kind:'range'},{id:'prior',label:'Prior',kind:'prior'},...periods],
   facts:['range','prior',...periods.map(p=>p.id)].map(periodId=>({memberId:'total',periodId,sums:{orders:100},ref:{orders:90}}))};
  const geometry=requireGeometry(layoutResolvedRequest(resolveChartRequest({type:'dimswitch',data,options:{locale:{language:'de_DE'},notes:{show:['note','disclosure']},size:{width:480,height:460}}})));
  const shown=new Set((geometry.derived as unknown as DimSwitchDerived).table.columns.map(c=>c.id)),hidden=periods.filter(p=>!shown.has(p.id));
  expect(hidden.length).toBeGreaterThan(9);
  const note=geometry.frame.noteList!.find(n=>n.kind==='disclosure'&&n.short)!;
  expect(note.text).toBe(`${hidden.map(p=>p.label).join(', ')} bei dieser Breite nicht gezeigt.`);
  expect(note.short).toBe(`${hidden.slice(0,8).map(p=>p.label).join(', ')}, und ${hidden.length-8} weitere bei dieser Breite nicht gezeigt.`);
  expect(geometry.size).toEqual({width:480,height:460});
 });
 // A consumer must be able to reproduce each DimSwitch amount and change without losing small values or claiming an unavailable change was checked.
 it('publishes exact amounts and reproducible calculations with their drawn labels',()=>{
  const data=structuredClone(exampleData);data.dimension.sums=true;
  data.measures.push({id:'tiny',label:'Small ratio',value:{op:'div',a:{field:'orders'},b:{field:'orders'},factor:1e-12},format:'1.2345678901234'});
  data.facts.find(f=>f.memberId==='search-a'&&f.periodId==='w1')!.ref!.orders=0;
  const geometry=requireGeometry(dimswitchCore.layout(data,{depth:3,size:{width:1600,height:2000}}));
  const claims=claimsForChart('dimswitch',geometry);
  expect(claims.length).toBeGreaterThan(0);
  expect(new Set(claims.map(c=>c.id)).size).toBe(claims.length);
  const tiny=claims.find(c=>c.nodeId===`cell:${dimswitchRowId('by-measure','total','tiny')}:range`)!;
  expect(tiny.output.raw).toBe(1e-12);expect(tiny.output.displayed).toContain('000000000001');
  const prior=claims.find(c=>c.nodeId===`cell:${dimswitchRowId('by-measure','total','orders')}:pp`)!;
  expect(prior.inputs.some(i=>i.ref==='total:["prior","sums","orders"]')).toBe(true);
  expect(claims.some(c=>c.nodeId?.startsWith('cellline:')&&c.output.displayed!=='')).toBe(true);
  expect(claims.filter(c=>c.kind==='reconciliation').every(c=>c.nodeId===undefined&&c.output.displayed==='')).toBe(true);
  expect(claims.some(c=>c.kind==='observed'&&c.output.state==='nm'&&c.output.raw===null)).toBe(true);
  for(const claim of claims.filter(c=>DERIVATION_KINDS.includes(c.kind as typeof DERIVATION_KINDS[number]))) expect(recomputeClaim(claim),claim.id).toMatchObject({status:'reproduced'});
 });
 it('produces identical SVG bytes for identical input',()=>{const draw=()=>renderSvg(requireGeometry(dimswitchCore.layout(exampleData,{depth:1})) as unknown as Parameters<typeof renderSvg>[0],resolveTheme());expect(draw()).toBe(draw());});
});

describe('dimswitch source and ordering rules',()=>{
 it('derives true partitions from sums before calculating ratios',()=>{
  const data=structuredClone(exampleData);data.dimension.sums=true;
  const result=resolveDimSwitch(data);
  const total=result.table.rows.find(r=>r.id===dimswitchRowId('by-measure','total','cac'))!;
  expect(total.cells.range!.raw).toBe((1400+1200)/(46+39+32));
  expect(result.computedCells.some(r=>r.op==='dimswitch:partition-check'&&r.raw!==0)).toBe(true);
 });
 it('sorts by measure with deterministic id ties',()=>{
  const data=structuredClone(exampleData);
  for(const f of data.facts.filter(f=>f.periodId==='range')) f.sums.orders=100;
  const r=compileDimSwitch(data,{order:{by:'orders',desc:true}}).data.rows.filter(r=>r.parentId===dimswitchRowId('by-measure','total','orders')&&!r.inline);
  expect(r.map(r=>r.label)).toEqual(['Organic','Paid Search']);
 });
 it('withData hides a member only when every applicable measure is zero or empty in the Range',()=>{
  const data=structuredClone(exampleData);const paid=data.facts.find(f=>f.memberId==='paid'&&f.periodId==='range')!;
  paid.sums.spend=0;
  data.facts.find(f=>f.memberId==='organic'&&f.periodId==='range')!.sums.rev=null;
  const shown=(d:typeof data)=>compileDimSwitch(d,{show:'withData'}).data.rows.some(r=>r.id===dimswitchRowId('by-measure','paid','orders'));
  // Spend is zero but orders still count in the Total: the member stays.
  expect(shown(data)).toBe(true);
  for(const field of Object.keys(paid.sums)) paid.sums[field]=0;
  expect(shown(data)).toBe(false);
  expect(compileDimSwitch(data,{show:'withData'}).data.rows.some(r=>r.id===dimswitchRowId('by-measure','organic','revenue'))).toBe(true);
 });
 it('does not mutate source facts when deriving a partition',()=>{const data=structuredClone(exampleData);data.dimension.sums=true;const before=JSON.stringify(data);compileDimSwitch(data);expect(JSON.stringify(data)).toBe(before);});
});

// With dimension.sums, a member with a null or missing figure used to remove a KPI from the table or leave the Total looking complete.
describe('dimswitch partition totals with null and missing members',()=>{
 const build=(facts:{memberId:string;periodId:string;sums:DimSwitchSums}[],margin=false):DimSwitchData=>({
  dimension:{label:'Segment',total:{id:'total',label:'Total'},members:[{id:'a',label:'A'},{id:'b',label:'B'}],headline:['sales'],sums:true},
  measures:[{id:'sales',label:'Sales',value:{field:'sales'}},
   {id:'margin',label:'Margin',value:margin ? {op:'div',a:{field:'profit'},b:{field:'sales'},factor:100} : {field:'profit'}}],
  periods:[{id:'r',label:'Current',kind:'range'},{id:'p',label:'Prior',kind:'prior'},{id:'w',label:'Week 1'}],
  facts});
 const every=(memberId:string,sums:DimSwitchSums)=>['r','p','w'].map(periodId=>({memberId,periodId,sums}));
 it('keeps a KPI when one member is null in every fact, and prints the Total missing',()=>{
  const data=build([...every('a',{sales:10,profit:5}),...every('b',{sales:20,profit:null})]);
  const result=compileDimSwitch(data,{depth:2});
  const total=result.data.rows.find(r=>r.id===dimswitchRowId('by-measure','total','margin'));
  expect(total?.cells?.range).toBeNull();
  expect(result.data.rows.find(r=>r.id===dimswitchRowId('by-measure','a','margin'))).toBeDefined();
  expect(result.warnings.map(w=>w.code)).not.toContain('dimswitch-measure-omitted');
 });
 it('warns and lists the measure when no member has a number for its field',()=>{
  const data=build(every('a',{sales:10,profit:5}).concat(every('b',{sales:20,profit:5})));
  data.measures[1]!.value={field:'profti'};
  const result=compileDimSwitch(data);
  expect(result.warnings.find(w=>w.code==='dimswitch-measure-omitted')?.message).toContain("'profti'");
  expect(result.omissions.map(o=>o.labelId)).toEqual(['measure:margin']);
 });
 // An authored Total figure must not fill a window where children that reported the field in another period have a gap.
 it('prints the Total missing where children report a field only in other periods, and keeps a parent-only field',()=>{
  const data=build([{memberId:'a',periodId:'p',sums:{sales:10,profit:5}},{memberId:'b',periodId:'p',sums:{sales:20,profit:5}},{memberId:'a',periodId:'r',sums:{profit:5}},{memberId:'b',periodId:'r',sums:{profit:5}},{memberId:'total',periodId:'r',sums:{sales:100,target:7}}]);
  const compiled=compileDimSwitch(data,{depth:2});
  expect(compiled.data.rows.find(r=>r.id===dimswitchRowId('by-measure','total','sales'))?.cells?.range).toBeNull();
  expect(compiled.omissions.map(o=>o.labelId)).not.toContain('measure:sales');
  data.measures.push({id:'target',label:'Target',value:{field:'target'}});
  expect(compileDimSwitch(data,{depth:2}).data.rows.find(r=>r.id===dimswitchRowId('by-measure','total','target'))?.cells?.range).toMatchObject({v:7});
 });
 it('prints the Total missing and warns when a member has no fact in a period',()=>{
  const data=build([...every('a',{sales:10,profit:5}),{memberId:'b',periodId:'p',sums:{sales:20,profit:5}}],true);
  const result=compileDimSwitch(data,{depth:2});
  const total=result.data.rows.find(r=>r.id===dimswitchRowId('by-measure','total','margin'))!;
  expect(total.cells?.range).toBeNull();
  expect(result.warnings.find(w=>w.code==='dimswitch-fact-missing')?.message).toContain("Member 'b'");
 });
});

// a change line whose fitted format would print a nonzero change as 0pp keeps its digit where the width holds.
it('keeps a fitted change line nonzero', async () => {
 const {fixtures}=await import('../src/core/charts/dimswitch/fixtures');
 const statement=fixtures.find(f=>f.id==='statement')!;
 const geometry=requireGeometry(layoutResolvedRequest(resolveChartRequest({type:'dimswitch',data:statement.data,options:{...statement.options,target:'report',textScale:1.25}} as never)));
 const text=(id:string)=>(geometry.scene.find(n=>n.t==='text'&&n.id===id) as {lines:string[]}|undefined)?.lines.join(' ');
 const line=(week:string)=>text(tableCellNodeId('cellline',dimswitchRowId('by-measure','total','gm'),week,`${dimswitchRowId('by-measure','total','gm')}:change`));
 expect([line('w1'),line('w3'),line('w4')]).toEqual(['+0.1pp','+0.4pp','−0.4pp']);
});

// At mid widths the full table must not cut row labels to stubs ("Ord…", "N… c…") or run a unit line
// over the column rule while the number tracks keep free width.
it('prints every row label whole and keeps units inside the label track at mid widths', async () => {
 const {fixtures}=await import('../src/core/charts/dimswitch/fixtures');
 const {measureText}=await import('../src/core/text');
 for (const [id,width] of [['by-measure',496],['by-member',496],['sheet',424],['card-notes-de',512],['bands-and-plan',544],['statement-operators',480]] as const) {
  const f=fixtures.find(f=>f.id===id)!;
  const geometry=requireGeometry(layoutResolvedRequest(resolveChartRequest({type:'dimswitch',data:f.data,options:{...f.options,target:'report',size:{width}}} as never)));
  const label=(geometry.marks as {columns:{id:string;x:number;w:number}[]}).columns.find(c=>c.id==='label')!;
  const texts=geometry.scene.flatMap(n=>n.t==='text'&&n.owner?.colId==='label'&&(n.font.letterSpacing??0)===0?[n]:[]);
  expect(texts.filter(n=>n.lines.some(l=>l.includes('…'))).map(n=>`${id}@${width} ${n.lines.join(' ')}`)).toEqual([]);
  const over=texts.filter(n=>n.part==='tableRowUnit'&&n.x+measureText(n.lines[0]!,n.font).width>label.x+label.w+0.5);
  expect(over.map(n=>`${id}@${width} ${n.lines[0]}`)).toEqual([]);
 }
});
// An effect line the cell hides (the default with effectLabel) must not widen the label track and push periods out.
it('ignores a hidden effect label when it sizes the label track', async () => {
 const {fixtures}=await import('../src/core/charts/dimswitch/fixtures');
 const f=fixtures.find(f=>f.id==='statement')!;
 const data={...f.data,effectLabel:'Contribution margin effect on the channel total per order'};
 const geometry=requireGeometry(layoutResolvedRequest(resolveChartRequest({type:'dimswitch',data,options:{...f.options,target:'report',size:{width:480}}} as never)));
 expect((geometry.marks as {columns:{id:string}[]}).columns.map(c=>c.id)).toEqual(['label','range','pp','w1','w2','w3','w4']);
});
// A percent measure without a format printed a small rate as "0.0%": flattening dropped the row's automatic-format mark, so the value did not lift.
it('lifts a small rate of a percent measure without a format', () => {
  const fixture = getFixtures('dimswitch').find(entry => entry.id === 'thresholds-by-kind')!;
  const data = structuredClone(fixture.data) as DimSwitchData;
  data.facts.find(fact => fact.memberId === 'beta' && fact.periodId === 'actual')!.sums.completed = 0.03;
  const svg = renderSvg(requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'dimswitch', data, options: fixture.options } as never))), resolveTheme());
  expect(svg).toContain('&lt;0.1%');
  expect(svg).not.toContain('>0.0%<');
});

// A width warning must name a dimswitch option the caller can edit, not a compiled table column.
it('reports authored dimswitch width paths for clipped columns', async () => {
 const {layoutResolvedRequest,resolveChartRequest}=await import('../src/core/request');
 const {requireGeometry}=await import('../src/core/sizing');
 const g=requireGeometry(layoutResolvedRequest(resolveChartRequest({type:'dimswitch',data:exampleData,options:{size:{width:1200},widths:{period:20,change:20},belowMinimum:'refuse'}})));
 const warnings=g.warnings.filter(w=>w.code==='table-column-clipped'||w.code==='table-column-widened');
 expect(warnings.length).toBeGreaterThan(0);
 for(const warning of warnings) expect(warning.field).toEqual(['options','widths',warning.owner?.colId==='pp'?'change':'period']);
});

// The tight-spacing advice named a size at which the same warning came back: the card there took one more period.
it('advises a size at which compact spacing holds', () => {
  const fixture = getFixtures('dimswitch').find(entry => entry.id === 'statement-plain')!;
  const data = { ...fixture.data, measures: fixture.data.measures.map((m: DimSwitchData['measures'][number]) => m.id === 'cm2' ? { ...m, label: 'Margin after costs' } : m) };
  const tight = (size: { width: number; height?: number }) => requireGeometry(layoutResolvedRequest(resolveChartRequest({ type: 'dimswitch', data, options: { ...fixture.options, size } })))
    .warnings.find(warning => warning.code === 'table-tight-spacing');
  const advice = tight({ width: 400 })?.fix?.[0];
  if (advice?.op !== 'replace') throw new Error('no size advice at 400 px');
  expect(tight(advice.value as { width: number; height?: number })).toBeUndefined();
});

// A displayed period with no ref printed n/a under every figure, and an encodings key that names no column was dropped without a word.
it('leaves out the change line of periods with no ref and warns on an encodings key that names no column', () => {
  const periods = [{ id: 'range', label: 'Range', kind: 'range' as const }, { id: 'prior', label: 'vs prior', kind: 'prior' as const }, { id: 'w1', label: 'W1' }, { id: 'w2', label: 'W2' }];
  const facts = (ref: boolean) => ['range', 'prior', 'w1', 'w2'].map(periodId => ({ memberId: 'total', periodId, sums: { orders: 100 }, ...(ref && periodId === 'w2' ? { ref: { orders: 90 } } : {}) }));
  const data = (withRef: boolean): DimSwitchData => ({ dimension: { label: 'Segment', total: { id: 'total', label: 'Total' }, members: [], headline: ['orders'] },
    measures: [{ id: 'orders', label: 'Orders', scale: 'count', value: { field: 'orders' }, change: 'relative' }], periods, facts: facts(withRef) });
  const none = resolveDimSwitch(data(false), { encodings: { prior: { type: 'arrow', scale: 'relative' } } });
  const changeRow = (r: typeof none) => r.table.rows.find(x => x.id === dimswitchRowId('by-measure', 'total', 'orders') + ':change');
  expect(changeRow(none)).toBeUndefined();
  expect(none.compileWarnings.find(w => w.code === 'dimswitch-encoding-column')).toMatchObject({ suggest: expect.stringContaining("Use 'pp'. The column ids are 'range', 'pp', 'w1', 'w2'") });
  const some = resolveDimSwitch(data(true), { encodings: { pp: 'arrow' } });
  expect(changeRow(some)!.cells.w1!.displayed).toBe('');
  expect(changeRow(some)!.cells.w2!.displayed).toContain('+11%');
  expect(some.compileWarnings.map(w => w.code)).not.toContain('dimswitch-encoding-column');
});

// A size search lays the card out at many sizes, and each layout compiled and resolved every form again.
it('compiles each form once across layouts at other sizes', () => {
  const data = structuredClone(exampleData);
  const layout = (width: number) => dimswitchCore.layout(data, { size: { width } });
  const first = layout(900);
  vi.mocked(compileDimSwitch).mockClear();
  const second = layout(700);
  expect(second.size.width).toBe(700);
  expect(first.size.width).toBe(900);
  expect(compileDimSwitch).not.toHaveBeenCalled();
});

// A multiple of a negative base (revenue over a negative order count) printed a plain ratio with no word that it is arithmetic, not n.m.
it('warns once per measure when a ratio divides by a negative sum', () => {
  const flip=(sums:DimSwitchSums|undefined)=>sums && {...sums,orders:-Math.abs(sums.orders!)};
  const data:DimSwitchData={...exampleData,
    facts:exampleData.facts.map(fact=>({...fact,sums:flip(fact.sums)!,...(fact.ref ? {ref:flip(fact.ref)} : {})})),
    measures:[...exampleData.measures,{id:'neg',label:'Revenue per order',value:{op:'div',a:{field:'rev'},b:{field:'orders'}}}]};
  const found=resolveDimSwitch(data).compileWarnings.filter(w=>w.code==='ratio-negative-base');
  expect(found.map(w=>w.severity)).toEqual(['info']);
  expect(found[0]!.message).toContain("Measure 'neg'");
});
