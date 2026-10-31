// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChartFooter } from '../src/react/ChartFooter';
import { requireGeometry } from '../src/core/sizing';
import { resolveTheme } from '../src/core/theme';
import type { DimSwitchData } from '../src/core/charts/dimswitch/types';
import { describe, expect, it } from 'vitest';
import '../src/core/charts';
import { DimSwitchChart, type DimSwitchViewReason } from '../src/react/DimSwitchChart';
import { judgeExample } from '../src/core/charts/dimswitch/judgeExample';
import { exampleData } from '../src/core/charts/dimswitch/example';
import { statementData } from '../src/core/charts/dimswitch/statementExample';
import { resolveTable } from '../src/core/charts/table/resolve';
import { visibleRows, collapsedByDefault } from '../src/core/charts/table/view';
import { compileDimSwitch, dimswitchRowId } from '../src/core/charts/dimswitch/compile';
import { getChart } from '../src/core/registry';
import { prepareChart } from '../src/react/prepare';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it('resets toggles on a variant change and keeps them across Changes',()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const reasons:DimSwitchViewReason[]=[];
 const draw=(variant:'by-measure'|'by-member',changes=true)=>act(()=>root.render(<DimSwitchChart data={exampleData} variant={variant} depth={1} inlineVisibility={{change:changes}} onViewChange={(_,reason)=>reasons.push(reason)}/>));
 draw('by-measure');
 const parent=()=>Array.from(host.querySelectorAll<HTMLElement>('[data-row-id]')).find(r=>r.dataset.rowId===dimswitchRowId('by-measure','total','orders'))!;
 act(()=>parent().querySelector<HTMLButtonElement>('button')!.click());
 expect(parent().querySelector('button')!.getAttribute('aria-expanded')).toBe('true');
 draw('by-measure',false);
 expect(parent().querySelector('button')!.getAttribute('aria-expanded')).toBe('true');
 draw('by-member');
 const paid=Array.from(host.querySelectorAll<HTMLElement>('[data-row-id]')).find(r=>r.dataset.rowId===dimswitchRowId('by-member','paid'))!;
 expect(paid.querySelector('button')!.getAttribute('aria-expanded')).toBe('false');
 expect(reasons).toEqual(['collapsed','variant']);
 act(()=>root.unmount());host.remove();
});
// A dimswitch saved with the retired order 'authored' must draw in the sheet order, not crash the compile.
it('draws a retired order value as its successor and reports it',()=>{
 const host=document.createElement('div');const root=createRoot(host);
 const warnings:{code:string;fix?:unknown}[][]=[];
 act(()=>root.render(<DimSwitchChart data={exampleData} variant="by-measure" depth={1} {...{order:'authored'} as object} onWarnings={w=>warnings.push(w)}/>));
 const sheet=compileDimSwitch(exampleData,{variant:'by-measure',depth:1,order:'sheet'});
 const expected=visibleRows(resolveTable(sheet.data,sheet.options).table,collapsedByDefault(resolveTable(sheet.data,sheet.options).table));
 expect(Array.from(host.querySelectorAll('[data-bp-rowgroup="body"] [role="row"]')).map(row=>row.getAttribute('data-row-id'))).toEqual(expected.map(row=>row.id));
 expect(warnings.at(-1)).toContainEqual(expect.objectContaining({code:'option-deprecated',fix:[{op:'test',path:'/options/order',value:'authored'},{op:'replace',path:'/options/order',value:'sheet'}]}));
 act(()=>root.unmount());
});
describe('dimswitch React defaults',()=>{
 it.each(['by-measure','by-member'] as const)('keeps %s depth changes equal to the static compiler',variant=>{
  const host=document.createElement('div');const root=createRoot(host);
  for(const depth of [1,2,3,1]){
   act(()=>root.render(<DimSwitchChart data={exampleData} variant={variant} depth={depth}/>));
   const compiled=compileDimSwitch(exampleData,{variant,depth});
   const {table}=resolveTable(compiled.data,compiled.options);
   const expected=visibleRows(table,collapsedByDefault(table));
   const rows=Array.from(host.querySelectorAll('[data-bp-rowgroup="body"] [role="row"]'));
   expect(rows.map(row=>row.getAttribute('data-row-id'))).toEqual(expected.map(row=>row.id));
  }
  act(()=>root.unmount());
 });
});
it('marks the table so newly opened rows animate in, and a reduced-motion host stops it',()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 act(()=>root.render(<DimSwitchChart data={exampleData} variant="by-measure" depth={2}/>));
 const figure=host.querySelector<HTMLElement>('figure.bp-table')!;
 expect(figure.dataset.bpMount).toBe('open');
 const css=Array.from(document.querySelectorAll('style')).map(s=>s.textContent).join('\n');
 expect(css).toMatch(/\[data-bp-mount="open"\] \.bp-children\{animation:bp-rows-in/);
 expect(css).toMatch(/\[data-bp-motion="reduce"\] \.bp-children\{transition:none;animation:none\}/);
 act(()=>root.unmount());host.remove();
});

it('reports the compile warnings with the table warnings through onWarnings, once',()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const seen:{code:string;fix?:unknown}[][]=[];
 const onWarnings=(warnings:{code:string;fix?:unknown}[])=>seen.push(warnings);
 // An authored subtotal that does not foot is a compile warning.
 const data={...statementData,measures:statementData.measures.map(m=>m.id==='costs'?{...m,value:{op:'div' as const,a:{field:'pay'},b:{field:'orders'}}}:m)};
 const thresholds={effect:[0.3,1] as [number,number]};
 act(()=>root.render(<DimSwitchChart data={data} variant="by-measure" depth={1} thresholds={thresholds} size={{width:1200,height:900}} onWarnings={onWarnings}/>));
 // A re-render with new props that change nothing reported does not report again.
 act(()=>root.render(<DimSwitchChart data={data} variant="by-measure" depth={1} thresholds={thresholds} size={{width:1200,height:900}} onWarnings={onWarnings}/>));
 expect(seen).toHaveLength(1);
 expect(seen[0]![0]).toMatchObject({code:'dimswitch-subtotal-footing'});
 act(()=>root.unmount());host.remove();
});

it('renders compiled Total values, band tones and the plan column in both variants',()=>{
 const data=judgeExample(); data.measures[1]!.bands=[{to:1,tone:'bad'},{to:2,tone:'good'}];
 const host=document.createElement('div'); const root=createRoot(host);
 for(const variant of ['by-measure','by-member'] as const) {
  act(()=>root.render(<DimSwitchChart data={data} variant={variant} depth={2} judgements="all"/>));
  const row=Array.from(host.querySelectorAll('[data-row-id]')).find(r=>r.getAttribute('data-row-id')===dimswitchRowId(variant,'alpha','lift'))!;
  expect(row.textContent).toContain('1.6');
  expect(host.textContent!.toLowerCase()).toContain('vs plan');
  expect(row.querySelector('[data-col-id="range"]')?.getAttribute('data-tone')).toBe('good');
 }
 act(()=>root.unmount());
});
it('prints the engine notes of the compiled table under the React grid (partial period)',()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 act(()=>root.render(<DimSwitchChart data={exampleData} target="report" notes={{show:['note','disclosure']}}/>));
 const notes=Array.from(host.querySelectorAll('.bp-footnotes li'),li=>li.textContent);
 expect(notes.some(note=>note!.startsWith('* Week 2')),notes.join(' | ')).toBe(true);
 act(()=>root.unmount());host.remove();
});
it('gives a long name the free width under a soft widths.label, as the SVG',()=>{
 const data=structuredClone(exampleData);
 data.dimension.members[0]!.label='A very long member name that needs far more than one hundred pixels';
 const options={variant:'by-measure' as const,depth:2,widths:{label:100},size:{width:1200,height:900},target:'report' as const};
 const svgLabel=(getChart('dimswitch')!.layout(data as never,options as never) as unknown as {marks:{columns:{id:string;w:number}[]}}).marks.columns[0]!.w;
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 act(()=>root.render(<DimSwitchChart data={data} {...options}/>));
 const reactLabel=Number.parseFloat(host.querySelector<HTMLElement>('.bp-table-grid')!.style.getPropertyValue('--bp-cols'));
 expect(svgLabel).toBeGreaterThan(400);
 // The grid measures with the browser slack, so it may need a few px more than the SVG.
 expect(Math.abs(reactLabel-svgLabel)).toBeLessThanOrEqual(24);
 act(()=>root.unmount());host.remove();
});

// A React footer must use the compact omission span while keeping the complete list in the reading.
it('renders the short disclosure for a DimSwitch that omits more periods than the limit',()=>{
 // 13 periods: tight spacing fits one more period, so 10 stay left out and the short form draws.
 const periods=Array.from({length:13},(_,i)=>({id:`p${i+1}`,label:`Period ${i+1}`}));
 const data:DimSwitchData={dimension:{label:'Segment',total:{id:'total',label:'Total'},members:[],headline:['orders']},measures:[{id:'orders',label:'Orders',scale:'count',value:{field:'orders'}}],
  periods:[{id:'range',label:'Range',kind:'range'},{id:'prior',label:'Prior',kind:'prior'},...periods],
  facts:[{memberId:'total',periodId:'range',sums:{orders:1200}},{memberId:'total',periodId:'prior',sums:{orders:1080}},...periods.map(p=>({memberId:'total',periodId:p.id,sums:{orders:100},ref:{orders:90}}))]};
 const geometry=requireGeometry(getChart('dimswitch')!.layout(data as never,{target:'report',notes:{show:['note','disclosure']},size:{width:320}} as never));
 const notes=geometry.frame.noteList!,note=notes.find(n=>n.kind==='disclosure'&&n.short)!;
 expect(note).toBeDefined();expect(note.text).not.toBe(note.short);
 const host=document.createElement('div');
 host.innerHTML=renderToStaticMarkup(<ChartFooter geometry={geometry} notes={notes} theme={resolveTheme('standard')} show={['note','disclosure']}/>);
 expect(host.querySelector('[data-bp-footer]')!.textContent).toContain(note.short);
 expect(host.querySelector('[data-bp-footer]')!.textContent).not.toContain(note.text);
 expect(note.text).toContain('Period 2, Period 3');
});

// A scrolling dimswitch must keep the compiled table's label floor instead of losing its internal width flags.
it('keeps the compiled table tracks in a narrow scrolling dimswitch', async () => {
 const { layoutTable } = await import('../src/core/charts/table/layout');
 const options={size:{width:375},variant:'by-measure' as const,depth:1,outlineMarks:true,mode:'full' as const,belowMinimum:'refuse' as const};
 const compiled=compileDimSwitch(exampleData,options);
 const { resolveChartRequest } = await import('../src/core/request');
 const request=resolveChartRequest({type:'table',data:compiled.data,options:compiled.options});
 const svg=layoutTable(compiled.data,{...compiled.options,...request.options,theme:{preset:'boardroom',overrides:request.theme}});
 const html=renderToStaticMarkup(<DimSwitchChart data={exampleData} {...options} measureWidths="tables"/>);
 const host=document.createElement('div');host.innerHTML=html;
 const row=host.querySelector<HTMLElement>('.bp-table-grid')!;
 const tracks=row.style.getPropertyValue('--bp-cols').split(' ').slice(0,svg.marks.columns.length).map(Number.parseFloat);
 const svgTracks=svg.marks.columns.map(col=>col.w);
 // The value tracks come from the compiler's width flags in both renderers.
 expect(tracks.slice(1)).toEqual(svgTracks.slice(1));
 // A scrolling host keeps the label's line floor; the fixed SVG frame narrows the label instead.
 expect(tracks[0]).toBeGreaterThanOrEqual(svgTracks[0]!);
});

// A DimSwitch chart refused at an inline `size={{ … }}` re-rendered without end: the new size object remade the refusal on every render.
it('calls onRefused once when refused at an inline size',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 let renders=0,calls=0;
 function Host(){
  const [,setBox]=useState<object>();
  if(++renders>40) throw new Error('render loop');
  return <DimSwitchChart data={exampleData} size={{width:40,height:40}} onRefused={r=>{calls++;setBox({r:r.warnings.length});}}/>;
 }
 await act(async()=>{root.render(<Host/>);});
 for(let i=0;i<4;i++) await act(async()=>{await new Promise(r=>setTimeout(r,25));});
 expect(calls).toBe(1);
 expect(renders).toBeLessThan(10);
 act(()=>root.unmount());host.remove();
});

// A prepared snapshot passed to DimSwitchChart reached the table, which threw "Expected a prepared table chart."
it('ignores a prepared snapshot and draws from data',async()=>{
 const prepared=await prepareChart({type:'column',data:{categories:['a','b'],series:[{id:'s',name:'S',values:[1,2]}]}});
 const plain=renderToStaticMarkup(<DimSwitchChart data={exampleData} depth={1}/>);
 expect(renderToStaticMarkup(<DimSwitchChart data={exampleData} depth={1} {...{prepared} as object}/>)).toBe(plain);
});

it('describes its table with options.a11y.description when the author writes one',()=>{
 const description='Margin held across the two views.';
 const html=renderToStaticMarkup(<DimSwitchChart data={exampleData} a11y={{description}}/>);
 expect(html).toContain(`class="bp-summary">${description}</p>`);
});
