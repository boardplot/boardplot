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
// Thirty weeks from 2 March 2026, Monday to Sunday, with the months as periods.
const weekStarts = Array.from({length:30}, (_,i) => new Date(Date.UTC(2026,2,2+7*i)));
const monthName = (d: Date) => ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]!;
const weeks = weekStarts.map((d,i) => ({ id:`2026-W${String(10+i).padStart(2,'0')}`, label:`Week of ${d.getUTCDate()} ${monthName(d)} 2026` }));
const months = weekStarts.reduce<{from:string;to:string;label:string}[]>((list,d,i) => {
  const label = list.length ? monthName(d) : `${monthName(d)} 2026`;
  if (list.length && monthName(weekStarts[i-1]!) === monthName(d)) list.at(-1)!.to = weeks[i]!.id;
  else list.push({ from:weeks[i]!.id, to:weeks[i]!.id, label });
  return list;
}, []);
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
  {
    id:'stack-readout-parts',kind:'example',title:'Metric stack: readout gutter without the unit and the span',
    data:{categories:categories.slice(6,12),measures:[
      {id:'intake',label:'Intake',values:intake.slice(6,12)},
      {id:'retained',label:'Retained',values:retained.slice(6,12)},
    ],panels:[
      {id:'intake',type:'column',title:'New enquiries',unit:'per month',measure:{sum:['intake']},readout:'change'},
      {id:'conversion',type:'line',title:'Conversion',unit:'% of enquiries',measure:{numerator:['retained'],denominator:'intake'},readout:'change',emphasis:true},
    ],windows:{grain:'month',base:{from:'2026-04',to:'2026-06',label:'Q2 2026'},compare:{from:'2026-07',to:'2026-09',label:'Q3 2026'}}},
    options:{stack:{columnVisibility:{unit:false,span:false}},size:{width:960},title:'Enquiries rise while conversion falls',subtitle:{measure:'Enquiries and conversion',period:'April–September 2026'},source:'Invented example'},
  },
  {
    id:'stack-gutter-right',kind:'example',title:'Metric stack: readout gutter right of the plots, with a set width and alignment',
    data:{categories:categories.slice(6),measures:[
      {id:'intake',label:'Intake',values:intake.slice(6)},
      {id:'qualified',label:'Qualified',values:[2240,2200,2028,2250,2336,2165,390]},
      {id:'booked',label:'Booked',values:[560,528,527,608,701,693,90]},
    ],panels:[
      {id:'qualification',type:'line',title:'Intake → qualified',unit:'% of intake',measure:{numerator:['qualified'],denominator:'intake'},readout:{base:'intake'}},
      {id:'booking',type:'line',title:'Qualified → booked',unit:'% of qualified',measure:{numerator:['booked'],denominator:'qualified'},readout:{base:'intake'},emphasis:true},
    ],periods:periods.slice(2)},
    options:{stack:{columnOrder:['plot','gutter'],columnOverrides:{gutter:{width:200,align:'right'}}},size:{width:960},title:'The booking step loses the most intake',subtitle:{measure:'Step conversion by creation cohort',period:'April–October 2026'},source:'Invented example'},
  },
  {
    // A quarter's cost per order divides its spend by its orders: Q1 is 26.91, the mean of its months 27.82.
    id:'metric-stack-per-unit',kind:'example',title:'Metric stack: cost per order computed from spend and orders',
    data:{categories:categories.slice(3,9),measures:[
      {id:'spend',label:'Spend',values:[42000,45000,61000,70000,74000,96000]},
      {id:'orders',label:'Orders',values:[1400,1500,2600,2000,2100,3400]},
    ],panels:[
      {id:'cost-per-order',type:'line',title:'Cost per order',unit:'$ per order',measure:{ratio:['spend'],per:'orders'},readout:'change',emphasis:true},
      {id:'spend',type:'column',title:'Spend',unit:'$ per month',measure:{sum:['spend']},readout:'change'},
      {id:'orders',type:'column',title:'Orders',unit:'per month',measure:{sum:['orders']},readout:'change'},
    ],windows:{grain:'month',base:periods[1]!,compare:periods[2]!},periods:periods.slice(1,3)},
    options:{stack:{},size:{width:960},title:'Cost per order rises 19% as spend grows faster than orders',subtitle:{measure:'Cost per order, spend and orders',period:'January–June 2026'},footnotes:['A quarter’s cost per order is its spend divided by its orders.'],source:'Invented example'},
  },
  {
    // The value-first look: the last week is the focus, the first week the base.
    id:'metric-stack-focus',kind:'example',title:'Metric stack: the focus look, with the latest week against the first',
    data:{categories:weeks,measures:[
      {id:'spend',label:'Spend',values:[42570,46630,44080,37860,36740,40850,45840,44660,44220,45240,50180,50870,44980,41740,42910,49600,52270,49190,49170,49830,53240,53550,47830,47040,51620,57800,57180,53440,51590,56050]},
      {id:'monthly',label:'Monthly plan',values:[486,487,475,449,433,437,495,509,539,504,468,465,477,534,560,563,538,518,517,540,568,612,618,612,573,562,599,628,664,671]},
      {id:'quarterly',label:'Quarterly plan',values:[90,95,97,96,97,102,121,129,143,139,133,137,146,169,184,191,188,187,192,207,224,249,259,263,254,255,280,301,327,339]},
      {id:'one-time',label:'One-time',values:[151,150,145,136,130,130,147,149,157,146,134,132,134,149,155,154,146,139,137,142,148,158,157,154,143,138,146,151,158,157]},
      {id:'other',label:'Other',values:[26,27,26,25,24,24,28,29,30,29,27,27,27,31,33,33,32,31,31,32,34,37,38,37,35,35,37,39,42,42]},
      {id:'customers',label:'Customers',values:[753,759,743,706,684,693,791,816,869,818,762,761,784,883,932,941,904,875,877,921,974,1056,1072,1066,1005,990,1062,1119,1191,1209]},
    ],panels:[
      {id:'cost-per-customer',type:'line',title:'Cost per customer',unit:'$ per customer',measure:{ratio:['spend'],per:'customers'},readout:'change',emphasis:true},
      {id:'spend',type:'column',title:'Spend',unit:'$ per week',measure:{sum:['spend']},readout:'change'},
      {id:'customers',type:'column',title:'Customers',unit:'per week',measure:{sum:['monthly','quarterly','one-time','other']},readout:'change',keyTitle:'By first order'},
    ],windows:{base:{from:'2026-W10',to:'2026-W10',label:'week of 2 Mar'},compare:{from:'2026-W39',to:'2026-W39',label:'Week of 21 Sep 2026'}},periods:months},
    options:{stack:{variant:'focus',heights:[160,120,188]},size:{width:1180},title:'Cost per customer falls 18% as customers grow faster than spend',subtitle:{measure:'Cost per customer, spend and customers per week',period:'March–September 2026'},source:'Invented example'},
  },
  {
    // The focus look by month: the base and the focus column print the share of each channel inside its segment.
    id:'metric-stack-focus-shares',kind:'example',title:'Metric stack: the focus look by month, with segment shares',
    data:{categories:['2025-10','2025-11','2025-12','2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08','2026-09'].map((id,i) => ({ id, label:['Oct 2025','Nov','Dec','Jan 2026','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep'][i]! })),measures:[
      {id:'spend',label:'Spend',values:[41000,41800,42500,43800,42900,44600,45900,47100,48300,49200,50400,51800]},
      {id:'direct',label:'Direct',values:[410,420,432,445,430,452,470,488,500,512,530,548]},
      {id:'search',label:'Search',values:[320,318,325,330,322,335,340,352,360,366,372,380]},
      {id:'social',label:'Social',values:[150,160,172,180,176,190,205,214,226,238,250,262]},
      {id:'referral',label:'Referral',values:[80,82,79,85,83,86,88,90,92,91,94,96]},
      {id:'orders',label:'Orders',values:[960,980,1008,1040,1011,1063,1103,1144,1178,1207,1246,1286]},
    ],panels:[
      {id:'cost-per-order',type:'line',title:'Cost per order',unit:'$ per order',measure:{ratio:['spend'],per:'orders'},readout:'change',emphasis:true},
      {id:'orders',type:'column',title:'Orders',unit:'per month',measure:{sum:['direct','search','social','referral']},readout:'change',keyTitle:'By channel',segmentShares:true},
    ],windows:{base:{from:'2025-10',to:'2025-10',label:'Oct 2025'},compare:{from:'2026-09',to:'2026-09',label:'Sep 2026'}}},
    options:{stack:{variant:'focus',heights:[140,220]},size:{width:1180},title:'Cost per order falls 6% as orders grow faster than spend',subtitle:{measure:'Cost per order and orders by channel per month',period:'October 2025–September 2026'},source:'Invented example'},
  },
  {
    id: 'metric-stack-empty-averages',
    title: 'A focus stack compares two quarters without an averages sentence',
    kind: 'example',
    data: {
      categories: categories.slice(3, 9),
      measures: [
        { id: 'started', label: 'Starts', values: [90, 105, 108, 120, 125, 132] },
        { id: 'finished', label: 'Completions', values: [70, 81, 84, 95, 98, 104] },
      ],
      panels: [
        { id: 'started', type: 'column', title: 'Starts', unit: 'per month', measure: { sum: ['started'] }, readout: 'change' },
        { id: 'finished', type: 'column', title: 'Completions', unit: 'per month', measure: { sum: ['finished'] }, readout: 'change' },
      ],
      windows: { grain: 'month', base: periods[1]!, compare: periods[2]! },
    },
    options: { title: 'Starts and completions rise', stack: { variant: 'focus' }, size: { width: 360 }, strings: { stackAverages: '' } },
  },
  {
    id: 'metric-stack-category-labels',
    title: 'Metric stack: dated weeks with names on selected ticks',
    kind: 'example',
    data: {
      categories: [
        { id: '2026-W13', label: 'Mar', date: '2026-03-23' },
        { id: '2026-W14', label: '', date: '2026-03-30' },
        { id: '2026-W15', label: 'Apr', date: '2026-04-06' },
        { id: '2026-W16', label: '', date: '2026-04-13' },
      ],
      measures: [
        { id: 'starts', label: 'Starts', values: [80, 92, 84, 96] },
        { id: 'completions', label: 'Completions', values: [32, 42, 38, 48] },
      ],
      panels: [
        { id: 'starts', type: 'column', title: 'Starts', unit: 'cases per week', measure: { sum: ['starts'] }, readout: 'change' },
        { id: 'completion-rate', type: 'line', title: 'Completion rate', unit: '%', measure: { numerator: ['completions'], denominator: 'starts' }, readout: 'change' },
      ],
      windows: {
        base: { from: '2026-W13', to: '2026-W14', label: 'March' },
        compare: { from: '2026-W15', to: '2026-W16', label: 'April' },
      },
    },
    options: { title: 'Starts and completion rate by week', stack: {}, size: { width: 720 } },
  },
];
