import { registerFixtures } from '../../../fixtures/registry';
import type { Fixture } from '../../registry';
import { dimswitchRowId } from './compile';
import { exampleData } from './example';
import type { DimSwitchData, DimSwitchOptions } from './types';
import { statementData } from './statementExample';
import { judgeExample } from './judgeExample';
import { tableLooks } from '../../../tableLooks';
export const fixtures: Fixture<DimSwitchData,DimSwitchOptions>[] = [
 {id:'by-measure',tags:['interaction'],hover:{owner:{rowId:dimswitchRowId('by-measure','total','orders'),colId:'range'}},title:'KPIs and their channel members',kind:'example',data:exampleData,options:{title:'Channel performance',variant:'by-measure',depth:2,order:'sheet',show:'always'}},
 {id:'by-member',title:'Channels and their KPIs',kind:'example',data:{...exampleData,measures:[...exampleData.measures.map(m => m.id === 'new' ? {...m,parentId:undefined,splitOf:'orders'} : m),{id:'rate',scale:'percent',label:'New customer share',value:{op:'div',a:{field:'nc'},b:{field:'orders'},factor:100},format:'1.2%',unit:'%',change:'pp',judge:{family:'rate',base:'orders'}}]},options:{title:'Channel performance',show:'withData',variant:'by-member',depth:1,splits:true}},
];
/** The report sheet: one face for every rung, judged cells on grounds, unjudged volumes as bars. */
const sheet: DimSwitchData={...exampleData,changeLabel:'WoW',measures:exampleData.measures.map(m=>m.id==='revenue' ? {...m,divider:true} : m.id==='cac' ? {...m,group:'Unit costs'} : m)};
fixtures.push({id:'sheet',title:'KPIs on the report sheet',kind:'example',data:sheet,options:{title:'Channel performance',variant:'by-measure',depth:2,widths:{label:240,range:92,change:92,period:66},
 theme:{preset:'boardroom',overrides:{table:{rows:{lineHeight:1.44,pad:3},weights:{member:700,measure:600},tones:'fill',headRule:'ink',blockRule:'rule',mark:'boxed'}}}}});
/** A contribution-margin statement per order under the KPIs: subtotals, results, drivers and effect colours. */
const look={preset:'boardroom',overrides:tableLooks.sheet};
fixtures.push({id:'statement',title:'A contribution-margin statement per order',kind:'example',data:statementData,options:{title:'Margin per order by channel',variant:'by-measure',depth:2,signs:'signed',judgements:'all',thresholds:{effect:[0.3,1]},widths:{label:260,range:84,change:84,period:66},theme:look}});
// The README statement: the sheet look's rules and weights on theme colours and a measured font, the channels folded under the Total.
const sheetFrame={table:{head:{weight:700,case:'asis' as const},section:{weight:700,tracking:0.08,ink:'ink' as const},weights:{member:700,measure:600,subtotal:600,result:700,figures:{subtotal:600,result:700}},tones:'fill' as const,headRule:'ink' as const,ruleWidths:{head:2},resultRule:'ink' as const,finalRule:'double' as const,driver:{italic:true},blockRule:'rule' as const,mark:'boxed' as const,ofWhich:'ink' as const,endRule:'none' as const}};
const channelStatement:DimSwitchData={...statementData,periods:statementData.periods.map(p=>p.id==='prior' ? {...p,subLabel:'4 weeks'} : p)};
fixtures.push({id:'statement-channels',title:'The statement with the channels folded under the Total',kind:'example',data:channelStatement,options:{title:'Higher sales costs cut the final margin by 1.5 per order',variant:'by-member',depth:1,signs:'signed',judgements:'all',thresholds:{effect:[0.3,1]},widths:{label:260,range:84,change:84,period:66},theme:{preset:'boardroom',overrides:sheetFrame}}});
fixtures.push({id:'statement-operators',title:'The statement by channel with operators',kind:'example',data:statementData,options:{title:'Margin per order by channel',variant:'by-member',depth:3,signs:'operators',judgements:'exceptions',thresholds:{effect:[0.3,1]},widths:{label:260,range:84,change:84,period:66},theme:look}});
fixtures.push({id:'statement-plain',title:'The statement as supplied, Total folded',kind:'example',data:statementData,options:{title:'Margin per order',variant:'by-member',depth:1,signs:'plain',thresholds:{effect:[0.3,1]},widths:{label:260,range:84,change:84,period:66}}});
// Grounds and tones the other way round: driver ink only, no group ground, the old frame, a pinned column only; then every tone and ground on, a page-pinned head.
const ledger={title:'Margin per order by channel',variant:'by-measure' as const,depth:2,signs:'signed' as const,judgements:'all' as const,thresholds:{effect:[0.3,1] as [number,number]},widths:{label:260,range:84,change:84,period:66},theme:look};
const neutralBand:DimSwitchData={...statementData,measures:statementData.measures.map(m=>m.id==='orders' ? {...m,bands:[{to:300,tone:'neutral' as const,label:'Quiet'},{to:1000,tone:'good' as const,label:'Busy'}]} : m)};
fixtures.push({id:'statement-ink-only',title:'The statement with driver ink only, no group ground and the old frame',kind:'example',data:neutralBand,options:{...ledger,driverTones:'never',groupGround:'none',frameFill:'none',foldOn:'toggle',stickyLabels:{head:false,columns:3}}});
fixtures.push({id:'statement-all-tones',title:'The statement with every driver tone, a group ground that stays when folded and a page-pinned head',kind:'example',data:statementData,options:{...ledger,driverTones:'always',groupGround:'always',foldOn:'row',stickyLabels:{head:'page',columns:3,top:48}}});
const totalLift=judgeExample();
fixtures.push({id:'total-rate-lift',title:'Member rate relative to the Total rate',kind:'example',data:totalLift,options:{title:'Each rate uses its matching Total window',widths:{change:110,period:110},variant:'by-measure',depth:2}});
const bandsPlan=judgeExample();
bandsPlan.measures=bandsPlan.measures.filter(m=>m.id==='rate').map(m=>({...m,bands:[{to:25,tone:'bad',label:'Below target'},{to:35,tone:'warn',label:'Near target'},{to:100,tone:'good',label:'On target'}]}));
bandsPlan.dimension.headline=['rate'];
fixtures.push({id:'bands-and-plan',title:'Value bands with separate prior and plan changes',kind:'example',data:bandsPlan,options:{title:'Completion rate: levels and plan changes',widths:{change:110,period:110},variant:'by-member',depth:2,minimumSample:{orders:50}}});
const kindThresholds=judgeExample();
kindThresholds.measures=kindThresholds.measures.filter(m=>m.id==='rate'); kindThresholds.dimension.headline=['rate'];
fixtures.push({id:'thresholds-by-kind',title:'Separate thresholds for each change kind',kind:'example',data:kindThresholds,options:{title:'Change thresholds differ by comparison',widths:{change:110,period:110},variant:'by-measure',depth:2,thresholds:{rate:[3,10],period:{rate:[5,20]},prior:{rate:[10,30]},plan:{rate:[40,80]}}}});
const multipleBases=judgeExample();
multipleBases.measures=multipleBases.measures.map(m=>({...m,judge:{family:'rate',base:['orders','sessions']}}));
multipleBases.facts.find(f=>f.memberId==='alpha' && f.periodId==='budget')!.sums.sessions=40;
fixtures.push({id:'multiple-sample-bases',title:'Judge only when both sample fields pass',kind:'example',data:multipleBases,options:{title:'Both sample fields must pass',widths:{change:110,period:110},variant:'by-member',depth:2,minimumSample:{orders:50,sessions:100}}});
// The engine notes in German on a phone card: a base that rounds to zero prints n.m., and the card leaves out the first week.
const nearZero:DimSwitchData={...fixtures[1]!.data,facts:fixtures[1]!.data.facts.map(f=>f.memberId==='organic' && f.periodId==='prior' ? {...f,sums:{...f.sums,orders:0.4,nc:0.2}} : f)};
fixtures.push({id:'card-notes-de',title:'German engine notes on a phone card',kind:'torture',data:nearZero,options:{...fixtures[1]!.options,title:'Channel overview',depth:2,locale:{language:'de'},size:{width:320}}});
registerFixtures('dimswitch',fixtures);
