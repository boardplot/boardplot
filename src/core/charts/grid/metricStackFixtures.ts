/** Invented examples. */
import type { Fixture } from '../../registry';
import type { GridLayoutOptions } from './normalize';
import type { MetricStackData } from './metricStack';

const categories = ['Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct'].map((label,i) => ({
  id: `${i<3?2025:2026}-${String(i<3?i+10:i-2).padStart(2,'0')}`, label, ...(i===12?{partial:true}:{})
}));
const periods = [
  {from:'2025-10',to:'2025-12',label:'Q4 2025'},
  {from:'2026-01',to:'2026-03',label:'Q1 2026'},
  {from:'2026-04',to:'2026-06',label:'Q2 2026'},
  {from:'2026-07',to:'2026-09',label:'Q3 2026'},
  {from:'2026-10',to:'2026-10',label:'Q4'},
];
const intake=[1800,2100,2000,2450,3100,2950,2800,2750,2600,3000,3200,3050,620];
const retained=[168,174,153,190,205,181,118,122,107,111,132,72,null];
const ended=[68,77,60,84,75,80,66,58,64,30,25,12,null];
export const metricStackFixtures: Fixture<MetricStackData,GridLayoutOptions>[] = [
  {
    id:'metric-stack-volume',kind:'example',title:'Metric stack: volume, completed outcomes and weighted conversion by cohort',
    data:{categories,measures:[
      {id:'intake',label:'Intake',values:intake},
      {id:'retained',label:'Retained',values:retained},
      {id:'ended',label:'No longer retained',values:ended},
    ],panels:[
      {id:'intake',type:'column',title:'New enquiries',unit:'thousand per month',measure:{sum:['intake']},divisor:1000,decimals:1,readout:'change'},
      {id:'completed',type:'column',title:'Completed',unit:'outcomes per cohort',measure:{sum:['retained','ended']},readout:'change'},
      {id:'conversion',type:'line',title:'Conversion',unit:'% of enquiries',measure:{numerator:['retained','ended'],denominator:'intake'},readout:'change',emphasis:true},
    ],states:{maturing:{from:'2026-07',to:'2026-09',panels:['completed','conversion']},partial:{panels:['completed','conversion'],footnote:'October is month to date.'}},windows:{grain:'month',base:periods[0]!,compare:periods[2]!},periods},
    options:{stack:{heights:[200,160,140]},sharedAxis:'category',size:{width:1180},title:'More enquiries do not produce more completed outcomes',subtitle:{measure:'Enquiries, completed outcomes and conversion by creation cohort',period:'October 2025–October 2026'},footnotes:['Outcomes belong to the creation cohort, not the outcome month.'],source:'Invented example'},
  },
  {
    id:'metric-stack-steps',kind:'example',title:'Metric stack: volume-weighted funnel steps and remaining-per-100 chain',
    data:{categories:categories.slice(6),measures:[
      {id:'intake',label:'Intake',values:intake.slice(6)},
      {id:'qualified',label:'Qualified',values:[2240,2200,2028,2250,2336,2165,390]},
      {id:'booked',label:'Booked',values:[560,528,527,608,701,693,90]},
      {id:'attended',label:'Attended',values:[476,449,443,426,456,263,4]},
      {id:'completed',label:'Completed',values:[184,180,171,141,157,84,null]},
    ],panels:[
      {id:'qualification',type:'line',title:'Intake → qualified',unit:'% of intake',measure:{numerator:['qualified'],denominator:'intake'},readout:{base:'intake'}},
      {id:'booking',type:'line',title:'Qualified → booked',unit:'% of qualified',measure:{numerator:['booked'],denominator:'qualified'},readout:{base:'intake'},emphasis:true},
      {id:'attendance',type:'line',title:'Booked → attended',unit:'% of booked',measure:{numerator:['attended'],denominator:'booked'},readout:{base:'intake'}},
      {id:'completion',type:'line',title:'Attended → completed',unit:'% of attended',measure:{numerator:['completed'],denominator:'attended'},readout:{base:'intake'}},
    ],states:{maturing:{from:'2026-07',to:'2026-09',panels:['qualification','booking','attendance','completion']},partial:{panels:['qualification','booking','attendance','completion'],footnote:'October is month to date.'}},periods:periods.slice(2)},
    options:{stack:{},rows:[1,1,1,1],size:{width:1180},title:'The booking step loses the largest share of the original intake',subtitle:{measure:'Step conversion by creation cohort',period:'April–October 2026'},footnotes:['Readouts use mature cohorts, weighted by source volume. Each panel starts at zero on its own scale.'],source:'Invented example'},
  },
];
