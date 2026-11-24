import type { DimSwitchData, DimSwitchExpression } from './types';

const measureRefs=(e:DimSwitchExpression):string[]=>typeof e==='number' || 'field' in e ? [] : 'measure' in e ? [e.measure] : 'total' in e ? measureRefs(e.total) : [...measureRefs(e.a),...measureRefs(e.b)];

export const unknownHeadlineMeasure = (id: string) => `Unknown headline measure '${id}'; use a measure id, not a sums field.`;

/** The cross-field checks shared by the data schema and React's ID refusals. */
export function checkDimSwitchData(data: DimSwitchData, issue: (path: (string | number)[], message: string) => void): void {
 // An emptied collection is one empty-data finding; the cross-checks below would add invalid-data noise about it.
 if(!data.measures.length||!data.periods.length||!data.facts.length) return;
 const unique=(values:string[],path:string)=>{if(new Set(values).size!==values.length) issue([path],`Duplicate id '${values.find((v,i)=>values.indexOf(v)!==i)}' is not allowed.`);};
 unique(data.measures.map(m=>m.id),'measures'); unique(data.periods.map(p=>p.id),'periods'); unique([data.dimension.total.id,...data.dimension.members.map(m=>m.id)],'dimension');
 const members=new Map(data.dimension.members.map(m=>[m.id,m])), measures=new Map(data.measures.map(m=>[m.id,m]));
 for(const [i,member] of data.dimension.members.entries()){
  const visited=new Set([member.id]);let parent=member.parentId;
  while(parent){if(!members.has(parent)||visited.has(parent)){issue(['dimension','members',i,'parentId'],`Member '${member.id}': parent '${parent}' is unknown or forms a cycle.`);break;}visited.add(parent);parent=members.get(parent)!.parentId;}
 }
 for(const [i,m] of data.measures.entries()) if(m.parentId && (!measures.has(m.parentId)||measures.get(m.parentId)?.parentId)) issue(['measures',i,'parentId'],`Measure '${m.id}': parentId '${m.parentId}' must be a root measure id.`);
 for(const [i,m] of data.measures.entries()) {
  const parent=m.splitOf ?? m.parentId;
  if(m.splitOf && m.parentId) issue(['measures',i],`Measure '${m.id}': use either splitOf or parentId.`);
  if(parent && (parent===m.id || !measures.has(parent) || measures.get(parent)?.parentId || measures.get(parent)?.splitOf)) issue(['measures',i],`Measure '${m.id}': a split must refer to a different root measure without a split parent.`);
 }
 const drivers=new Set(data.measures.flatMap(m=>m.drivers===undefined ? [] : measureRefs(m.drivers)));
 for(const [i,m] of data.measures.entries()) {
  if(m.partOf!==undefined && !measures.has(m.partOf)) issue(['measures',i,'partOf'],`Measure '${m.id}': partOf '${m.partOf}' is not a measure id.`);
  for(const ref of [...(m.value===undefined ? [] : measureRefs(m.value)),...(m.drivers===undefined ? [] : measureRefs(m.drivers))]) if(!measures.has(ref)) issue(['measures',i],`Measure '${m.id}' names unknown measure '${ref}'; use a measures[].id.`);
  if(m.result && (m.value===undefined || m.sign!==undefined || m.partOf!==undefined)) issue(['measures',i,'result'],`Measure '${m.id}': a result is a top-level line with a value that names its lines; it takes no sign or partOf.`);
  if(m.value===undefined && !data.measures.some(p=>p.partOf===m.id && !drivers.has(p.id))) issue(['measures',i,'value'],`Measure '${m.id}' has no value and no measure names it in partOf; add a value or make it a subtotal.`);
 }
 for(const [i,h] of data.dimension.headline.entries()) if(!measures.has(h)) issue(['dimension','headline',i],unknownHeadlineMeasure(h));
 for(const kind of ['range','prior']) if(data.periods.filter(p=>p.kind===kind).length!==1) issue(['periods'],`Exactly one ${kind} period is required; to hide its column, keep the period and set options.columnVisibility.${kind==='range'?'range':'pp'} to false.`);
 if(data.periods.filter(p=>p.kind==='plan').length>1) issue(['periods'],'At most one plan period is allowed.');
 if(!data.periods.some(p=>!p.kind)) issue(['periods'],'At least one displayed period is required.');
 const periodIds=new Set(data.periods.map(p=>p.id));
 if(data.periods.some(p=>!p.kind && ['label','range','pp','pl'].includes(p.id))) issue(['periods'],'Normal period ids cannot be label, range, pp or pl.');
 const keys=new Set<string>();
 for(const [i,f] of data.facts.entries()){const key=JSON.stringify([f.memberId,f.periodId]);if(keys.has(key)) issue(['facts',i],`Duplicate fact for member '${f.memberId}' and period '${f.periodId}'.`);keys.add(key);if(f.memberId!==data.dimension.total.id&&!members.has(f.memberId)) issue(['facts',i,'memberId'],`Unknown member '${f.memberId}'; use the total id or a dimension.members id.`);if(!periodIds.has(f.periodId)) issue(['facts',i,'periodId'],`Unknown period '${f.periodId}'; use a periods id.`);}
}
