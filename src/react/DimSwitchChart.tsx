'use client';
import type { OptionsInput } from '../core/types/optionInput';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { LintWarning } from '../core/types/scene';
import { compileDimSwitch, dimSwitchTableWarnings, foreignRowId, hiddenTotalFoldWarnings, LABELS_ONLY, PARTIAL_NOTE_OFF_FRAME, partialNoteWarning } from '../core/charts/dimswitch/compile';
import { defaultNotePlacement, engineNoteMeta, withEngineNotes } from '../core/notes';
import { ENGINE_NOTES } from '../core/charts/table/tracks';
import { ENGINE_NOTE_KINDS } from './tablePresentation';
import type { DimSwitchData, DimSwitchOptions, DimSwitchVariant } from '../core/charts/dimswitch/types';
import type { OptionKeyCheck } from '../core/schema/unknownKeys';
import { TableChart, type TableChartProps } from './charts/table';
import { TableFloorRequestContext } from './TableChart';
import { linkedBinding, rebindable } from './linkedBinding';
import type { DeferredName } from '../core/deferred';
import { optionRefusals } from '../core/schema/refusals';
import { normalizeOptionShapes } from '../core/normalize/optionShapes';
import { retireChartSettings } from '../core/retired';
import { LayoutRefusal } from './SizePlaceholder';
import { asSize, frameSize, RefusalBoundary } from './RefusalBoundary';
import { freezeValue, useStableValue } from './useStableValue';
import { useRowsGate } from './rowsGate';
import type { ContainerSizeOptions } from './useContainerSize';

export interface DimSwitchView { variant: DimSwitchVariant; depth: number; splits: boolean; collapsed: string[] }
export type DimSwitchViewReason = 'variant' | 'depth' | 'splits' | 'collapsed';
export type DimSwitchChartProps = Omit<TableChartProps, 'data' | 'collapsed' | 'defaultCollapsed' | 'onCollapsedChange' | 'onExpansionChange' | 'expansion' | 'variant' | 'prepared'> & OptionsInput<Omit<DimSwitchOptions, 'size'>> & {
 data: DimSwitchData;
 variant?: DimSwitchVariant;
 defaultVariant?: DimSwitchVariant;
 depth?: number;
 defaultDepth?: number;
 splits?: boolean;
 defaultSplits?: boolean;
 /** Controlled folds. Set back to undefined, the folds return to what the depth and `expansion` say. */
 collapsed?: string[];
 defaultCollapsed?: string[];
 /** One callback for all view changes. A variant, depth or `expansion` change resets manual folds; 'collapsed' is a reader's fold. */
 onViewChange?: (next: DimSwitchView, reason: DimSwitchViewReason) => void;
};
export function createDimSwitchChart(checkKeys?: OptionKeyCheck, linked?: readonly DeferredName[]) {
 // The table it draws counts the same fetched modules as this component's own entry.
 const Table = linked === undefined ? TableChart : linkedBinding(TableChart, linked);
 type NormalizedProps = Omit<DimSwitchChartProps, 'size' | 'fallbackSize'> & ContainerSizeOptions;
 function GatedDimSwitch(props: NormalizedProps): ReactElement {
  // Rows answer before the compile: a dimswitch has no data while the rows chunk loads or after it refuses them.
  // A frozen table snapshot cannot match a table compiled from the variant, depth and splits, so a `prepared` prop from untyped code is dropped and the chart draws from data.
  const {rows,columns,onRowsReading,prepared:_prepared,...chart}=props as NormalizedProps & {prepared?:unknown};
  const gate=useRowsGate({type:'dimswitch',data:chart.data},{rows,columns,onRowsReading},chart);
  return gate.element ?? <DrawnDimSwitch {...chart} data={gate.data!}/>;
 }
 function DimSwitchChart(props: DimSwitchChartProps): ReactElement {
  const {className,style,size,fallbackSize,...rest}=props;
  const normalizedSize=useMemo(()=>asSize(size),[size]);
  const normalizedFallback=useMemo(()=>asSize(fallbackSize) as ContainerSizeOptions['fallbackSize'],[fallbackSize]);
  const chart=<RefusalBoundary watch={props} size={normalizedSize} fallbackSize={normalizedFallback} target={props.target} theme={props.theme}
   fallback={finding=><LayoutRefusal refusals={[finding]} theme={props.theme} size={frameSize(normalizedSize==='container'?normalizedFallback:normalizedSize,props.target)} options={typeof props.title==='string'?{title:props.title}:{}}/>}>
   <GatedDimSwitch {...rest} size={normalizedSize} fallbackSize={normalizedFallback}/>
  </RefusalBoundary>;
  return className!==undefined || style!==undefined ? <div className={className} style={style}>{chart}</div> : chart;
 }
 function DrawnDimSwitch(props: NormalizedProps): ReactElement {
  const {data,variant:controlledVariant,defaultVariant='by-measure',depth:controlledDepth,defaultDepth=1,splits:controlledSplits,defaultSplits=false,collapsed:controlledCollapsed,defaultCollapsed,onViewChange,inlineVisibility,defaultInlineVisibility,onInlineVisibilityChange,size,fit,fallbackSize,measureWidths,hover,onWarnings,onRefused,renderRefused,scope,fontMetrics,styleNonce,idPrefix,handleRef,onContentWidth,onScrollChange,fillHeight,rowLabelLead,portalContainer,onRowSelect,isRowSelectable,toolbar=false,interactions,defaultColumnVisibility,onColumnVisibilityChange,sortable,defaultSort,onSortChange,rootsHidden,onEmpty,onFormatsFit,exporter,...options}=props;
  const refusals=optionRefusals({...options,variant:controlledVariant,depth:controlledDepth,splits:controlledSplits},'dimswitch',checkKeys);
  const [initial] = useState(()=>({variant:defaultVariant,depth:defaultDepth,splits:defaultSplits}));
  const variant=controlledVariant ?? initial.variant, depth=controlledDepth ?? initial.depth, splits=controlledSplits ?? initial.splits;
  const stableData=useStableValue(data);
  // Resolved before the compile, so a default does what the prop does. The controlled prop wins.
  const [initialColumns]=useState(defaultColumnVisibility);
  const authoredOptions=useStableValue(options.columnVisibility===undefined && initialColumns!==undefined ? {...options,columnVisibility:initialColumns} : options);
  // A retired setting is compiled as its successor (or dropped) and reported with the compile warnings.
  const retired=useMemo(()=>{const shaped=normalizeOptionShapes('dimswitch',{options:authoredOptions});const retired=retireChartSettings('dimswitch',{options:shaped.chart.options as DimSwitchOptions});return {...retired,warnings:[...shaped.warnings,...retired.warnings]};},[authoredOptions]);
  const stableOptions=retired.chart.options;
  const floorRequest=useStableValue({type:'dimswitch',data:stableData,options:{...stableOptions,variant,depth,splits,inlineVisibility}});
  // The grid reads values, not the computed-cell records the static audit trail carries.
  // The compile gives its notes their kinds (a disclosure, its short form); the table frame reads them as records.
  const compiled=useMemo(()=>withEngineNotes(()=>{
    const result=compileDimSwitch(stableData,{...stableOptions,variant,depth:1,splits},{records:false});freezeValue(result.data);
    const notes=(result.options as {[ENGINE_NOTES]?:string[]})[ENGINE_NOTES] ?? [];
    const kinds=new Map(notes.flatMap(note=>{const meta=engineNoteMeta(note); return meta ? [[note,meta] as const] : [];}));
    return kinds.size ? {...result,options:{...result.options,[ENGINE_NOTE_KINDS]:kinds}} : result;
  },true),[stableData,stableOptions,variant,splits]);
  const tableRequest=useMemo(()=>({request:floorRequest,options:compiled.options}),[floorRequest,compiled.options]);
  const maxDepth=compiled.maxDepth;
  if(!Number.isInteger(depth) || depth<1 || depth>maxDepth) throw new Error(`dimswitch depth must be between 1 and ${maxDepth}`);
  const foreign=foreignRowId(controlledCollapsed) ?? foreignRowId(defaultCollapsed);
  if(foreign!==undefined) throw new Error(`dimswitch row id ${foreign} names no variant first; build it with dimswitchRowId(variant, memberId, measureId)`);
  // Depth only selects folds. Keep the compiled values and table widths.
  const depthDefaults=useMemo(()=>{
    const ids=new Set(Object.keys(compiled.levels).filter(id=>compiled.levels[id]!>depth));
    for(const id of stableOptions.expansion?.expanded ?? []) ids.delete(id);
    // A hidden Total's rows left the table, so a fold of one names nothing.
    const drawn=stableOptions.rowVisibility?.[stableData.dimension.total.id]===false ? new Set(compiled.data.rows.map(row=>row.id)) : undefined;
    for(const id of stableOptions.expansion?.collapsed ?? []) if(!drawn || drawn.has(id)) ids.add(id);
    return [...ids];
  },[compiled,depth,stableOptions.expansion]);
  const expansionKey=JSON.stringify(stableOptions.expansion ?? null);
  const [manual,setManual]=useState(()=>({variant,depth,expansion:expansionKey,collapsed:defaultCollapsed ?? depthDefaults}));
  // A host that let go of the folds (it pressed the depth already shown) gets the depth's folds back.
  const held=controlledCollapsed!==undefined;
  const [wasHeld,setWasHeld]=useState(held);
  if(wasHeld!==held){setWasHeld(held); if(!held) setManual({variant,depth,expansion:expansionKey,collapsed:depthDefaults});}
  const changed=manual.variant!==variant || manual.depth!==depth || manual.expansion!==expansionKey;
  const collapsed=changed ? depthDefaults : controlledCollapsed ?? manual.collapsed;
  const previous=useRef({variant,depth,splits});
  const callback=useRef(onViewChange); callback.current=onViewChange;
  useEffect(()=>{
    const before=previous.current;
    const reason=before.variant!==variant ? 'variant' : before.depth!==depth ? 'depth' : before.splits!==splits ? 'splits' : undefined;
    previous.current={variant,depth,splits};
    if(changed) setManual({variant,depth,expansion:expansionKey,collapsed});
    if(reason) callback.current?.({variant,depth,splits,collapsed},reason);
  },[variant,depth,splits,changed,collapsed,expansionKey]);
  const toggle=(next:string[])=>{
    setManual({variant,depth,expansion:expansionKey,collapsed:next});
    callback.current?.({variant,depth,splits,collapsed:next},'collapsed');
  };
  // The host's onWarnings gets the compile warnings first, then the table's, once per distinct set (as TableChart does).
  const [tableWarnings,setTableWarnings]=useState<LintWarning[]>();
  const readTable=useCallback((next:LintWarning[])=>setTableWarnings(before=>before!==undefined && JSON.stringify(before)===JSON.stringify(next) ? before : next),[]);
  const warningsCallback=useRef(onWarnings); warningsCallback.current=onWarnings;
  const reported=useRef<string|undefined>(undefined);
  const wantsWarnings=onWarnings!==undefined;
  useEffect(()=>{
    if(!wantsWarnings || tableWarnings===undefined) return;
    // The info footer keeps an in-frame note behind its button, so the partial note has no place on the chart there.
    const placement=stableOptions.notes?.placement ?? defaultNotePlacement(stableOptions.target);
    const inPanel=compiled.partialNote!==undefined && placement==='info' && !compiled.warnings.some(warning=>warning.code===PARTIAL_NOTE_OFF_FRAME);
    // The compile runs at depth 1 and depth only selects folds, so a hidden Total's blank table is judged on the folds on screen.
    const totalId=stableData.dimension.total.id, totalGone=stableOptions.rowVisibility?.[totalId]===false && compiled.data.columns.length>1;
    const compileWarnings=compiled.warnings.filter(warning=>warning.code!==LABELS_ONLY || warning.field?.[1]!=='rowVisibility');
    const all=[...retired.warnings,...compileWarnings,...(totalGone ? hiddenTotalFoldWarnings(compiled.data.rows,collapsed,totalId) : []),...(inPanel ? [partialNoteWarning(compiled.partialNote!)] : []),...dimSwitchTableWarnings(tableWarnings,stableOptions.columnOverrides)];
    const key=JSON.stringify(all);
    if(reported.current===key) return;
    reported.current=key;
    warningsCallback.current?.(all);
  },[wantsWarnings,retired.warnings,compiled,stableOptions,stableData,collapsed,tableWarnings]);
  if(refusals.length) return <LayoutRefusal refusals={refusals} theme={options.theme} options={{...options,size:size==='container'?fallbackSize:size}}/>;
  return <TableFloorRequestContext.Provider value={tableRequest}><Table {...compiled.options} exporter={exporter} data={compiled.data} collapsed={collapsed} onCollapsedChange={toggle}
   onColumnVisibilityChange={onColumnVisibilityChange} sortable={sortable} defaultSort={defaultSort} onSortChange={onSortChange} rootsHidden={rootsHidden}
   inlineVisibility={inlineVisibility} defaultInlineVisibility={defaultInlineVisibility} onInlineVisibilityChange={onInlineVisibilityChange}
   size={size} fit={fit} fallbackSize={fallbackSize} measureWidths={measureWidths} hover={hover} onWarnings={wantsWarnings ? readTable : undefined} onRefused={onRefused} renderRefused={renderRefused}
   scope={scope} fontMetrics={fontMetrics} styleNonce={styleNonce} idPrefix={idPrefix} handleRef={handleRef} onContentWidth={onContentWidth} onScrollChange={onScrollChange} fillHeight={fillHeight}
   rowLabelLead={rowLabelLead} interactions={interactions} onEmpty={onEmpty} onFormatsFit={onFormatsFit} portalContainer={portalContainer} onRowSelect={onRowSelect} isRowSelectable={isRowSelectable} toolbar={toolbar}/></TableFloorRequestContext.Provider>;
 }
 DimSwitchChart.chartType='dimswitch';
 DimSwitchChart.displayName='DimSwitchChart';
 rebindable(DimSwitchChart,(relinked):unknown=>createDimSwitchChart(checkKeys,relinked));
 return DimSwitchChart;
}
export const DimSwitchChart=createDimSwitchChart();
