import type { DimSwitchData } from './types';

/** Invented sums for the opt-in judge features. The host supplies plan windows. */
export function judgeExample(): DimSwitchData {
  return {
    dimension:{label:'Group',total:{id:'total',label:'Total'},members:[{id:'alpha',label:'Alpha'},{id:'beta',label:'Beta'}],headline:['lift','rate']},
    measures:[
      {id:'rate',label:'Completion rate',scale:'percent',value:{op:'div',a:{field:'completed'},b:{field:'orders'},factor:100},change:'pp',judge:{family:'rate',base:'orders'}},
      {id:'lift',label:'Rate vs Total',format:'1.2',value:{op:'div',a:{measure:'rate'},b:{total:{measure:'rate'}}},judge:{family:'rate',base:'orders'}},
    ],
    periods:[{id:'actual',label:'Range',kind:'range'},{id:'before',label:'vs prior',kind:'prior'},{id:'budget',label:'vs plan',subLabel:'Full window',kind:'plan'},{id:'p1',label:'Period 1'}],
    facts:[
      ...([['actual',40,50],['before',20,80],['budget',30,75],['p1',30,100]] as const).flatMap(([periodId,alpha,total])=>[
        {memberId:'total',periodId,sums:{completed:total,orders:200,sessions:400},...(periodId==='p1' ? {ref:{completed:50,orders:200,sessions:400}} : {})},
        {memberId:'alpha',periodId,sums:{completed:alpha,orders:100,sessions:200},...(periodId==='p1' ? {ref:{completed:10,orders:100,sessions:200}} : {})},
        {memberId:'beta',periodId,sums:{completed:total-alpha,orders:100,sessions:200},...(periodId==='p1' ? {ref:{completed:40,orders:100,sessions:200}} : {})},
      ]),
    ],
  };
}
