import type { ChartCore } from '../../registry';
import type { Geometry } from '../../types/scene';
import { CARD_MIN_WIDTH, chartSizing, isWidthProbe } from '../../sizing';
import { TARGET_SIZE, type TargetSizeOptions } from '../../target';
import { cardHeightFloor, classFloor, layoutTable, memoLayout, REGULAR_SPACING, type TableMarks } from '../table/layout';
import { resolveTable } from '../table/resolve';
import { compileDimSwitch, dimSwitchTableWarnings, type DimSwitchForm } from './compile';
import type { DimSwitchData, DimSwitchOptions, DimSwitchDerived } from './types';
import { minOf } from '../../arrays';

export function resolveDimSwitch(data: DimSwitchData, options: DimSwitchOptions = {}, form: DimSwitchForm = {}) {
  const compiled = compileDimSwitch(data, options, form);
  const resolved = resolveTable(compiled.data, compiled.options);
  const rows=new Map(resolved.table.rows.map(row=>[row.id,row]));
  const records=compiled.computedCells.map(record=>({...record,displayed:record.kind === 'calc' ? rows.get(record.rowId)?.cells[record.colId]?.displayed ?? '' : record.displayed}));
  return {...compiled,...resolved,compileWarnings:compiled.warnings,computedCells:[...resolved.computedCells,...records]};
}

type PreparedForm = { compiled: ReturnType<typeof compileDimSwitch>; resolved: ReturnType<typeof resolveTable> };

function layoutForm(data: DimSwitchData, options: DimSwitchOptions, form: DimSwitchForm, forms: Map<string, PreparedForm>): Geometry<TableMarks, DimSwitchDerived> {
  const key=`${form.card === true}:${form.hide ?? 0}`;
  let prepared=forms.get(key);
  if (!prepared) {
    const compiled=compileDimSwitch(data,options,form);
    prepared={compiled,resolved:resolveTable(compiled.data,compiled.options)};
    forms.set(key,prepared);
  }
  // Only size and the internal floor flag change between this request's probes.
  const compiled={...prepared.compiled,options:{...prepared.compiled.options,size:options.size}};
  const resolved=prepared.resolved;
  // The compile is shared across spacing passes and carries the first pass's options: the spacing is this request's.
  const geometry=layoutTable(compiled.data,{...options,...compiled.options,[REGULAR_SPACING]:(options as {[REGULAR_SPACING]?: boolean})[REGULAR_SPACING]} as typeof compiled.options,resolved);
  // The frame can reach its automatic height without a second compile.
  if ((options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height === false
    && typeof compiled.options.size === 'object' && compiled.options.size.height !== undefined
    && compiled.options.size.height !== geometry.size.height) compiled.options={...compiled.options,size:geometry.size};
  const originalRows=new Map(resolved.table.rows.map(row=>[row.id,row]));
  const drawnRows=new Map(geometry.derived.table.rows.map(row=>[row.id,row]));
  const records=compiled.computedCells.map(record=>({...record,displayed:record.kind==='calc' ? originalRows.get(record.rowId)?.cells[record.colId]?.displayed ?? '' : record.displayed}));
  return {...geometry,type:'dimswitch',warnings:[...dimSwitchTableWarnings(geometry.warnings),...compiled.warnings,...(options.format ? [{code:'format-unused',severity:'warn' as const,field:['options','format'],message:'DimSwitch measures supply their own formats. Set measures[].format.'}] : [])],derived:{...geometry.derived,compiled:{data:compiled.data,options:compiled.options},omissions:compiled.omissions,computedCells:[...resolved.computedCells,...records].map(record=>({...record,displayed:record.kind==='calc' ? drawnRows.get(record.rowId)?.cells[record.colId]?.displayed ?? record.displayed : record.displayed}))}};
}

/**
 * The full table, then the automatic card form below its measured width (no option): value tracks as wide as
 * their content and a 140 px label track. Where that still misses, the card leaves out periods, the first authored
 * first, and says so in a note; Range and its comparisons stay. A table that fits no form refuses with the card's floor.
 * With more than 16 periods the latest periods are tried first, so the work follows the periods drawn.
 * All of this runs with regular spacing. Only where it leaves periods out does the tight table spacing (refuse-less) try
 * to show more of them, one at a time from the regular answer.
 */
function layoutDimSwitch(data: DimSwitchData, options: DimSwitchOptions, forms: Map<string, PreparedForm>): Geometry<TableMarks, DimSwitchDerived> {
  const openWidth=(options as TargetSizeOptions)[TARGET_SIZE]?.fixed?.width === false;
  const fits=(geometry: Geometry<TableMarks, DimSwitchDerived>) => openWidth || geometry.size.width >= (geometry.sizing?.minWidth ?? 0);
  const periods=data.periods.filter(p=>!p.kind).length;
  const regular={...options,[REGULAR_SPACING]:true} as DimSwitchOptions;
  const card=(hide:number)=>layoutForm(data,regular,{card:true,hide},forms);
  const steps=options.belowMinimum !== 'refuse';
  const latest=steps && !openWidth && periods>PROBE_PERIODS ? latestThatFit(card,periods) : undefined;
  // measure()'s width search asks whether the full table draws: where the latest 16, 32 ... periods alone miss, it cannot.
  if (!latest && !openWidth && isWidthProbe('dimswitch',options)) for (let shown=PROBE_PERIODS; shown<periods; shown*=2) {
    const latestOnly=card(periods-shown);
    if (!fixedFits(latestOnly)) return latestOnly;
  }
  let best=latest;
  if (!best) {
    const full=layoutForm(data,regular,{},forms);
    if (!steps || fits(full)) return full;
    const first=card(0);
    if (fits(first)) return first;
    best=mostShown(card,periods,{shown:periods,geometry:first});
  }
  if ((options as { [REGULAR_SPACING]?: boolean })[REGULAR_SPACING]) return best.geometry;
  // The full form with tight spacing shows every period. Where the latest periods alone already missed, it cannot fit.
  if (!latest) {
    const full=layoutForm(data,options,{},forms);
    if (fits(full)) return full;
  }
  // shortcut: one tight card per extra period; a bracket search pays off only if tight spacing ever gains many periods.
  // The next period needs about one more period track: where the slack is narrower than the narrowest drawn one, stop
  // without laying it out (a period with narrower figures may then stay out).
  const blocks=new Set(['label','range','pp','pl']);
  let next: Form | undefined;
  for (let shown=fixedFits(best.geometry) ? best.shown+1 : 0; shown<=periods; shown++) {
    const geometry=layoutForm(data,options,{card:true,hide:periods-shown},forms);
    if (!fixedFits(geometry)) { next=geometry; break; }
    best={shown,geometry};
    const track=minOf(geometry.marks.columns.filter(column=>!blocks.has(column.id)).map(column=>column.w));
    if (Number.isFinite(track) && geometry.size.width-(geometry.sizing?.minWidth ?? 0)<track) break;
  }
  // The check lays out one more card. Past PROBE_PERIODS that layout is the cost of the whole request, and such a
  // table already shows only its latest periods, so its advice stays unchecked.
  return checkedTightAdvice(best.geometry,best.shown<periods && periods<=PROBE_PERIODS ? (size) => next?.warnings.some(warning=>warning.code==='table-tight-spacing') ? next : layoutForm(data,{...options,size,
    [TARGET_SIZE]:{sizePx:{width:size.width,height:size.height ?? Math.round(size.width*9/16)},fixed:{width:true,height:size.height!==undefined}}} as DimSwitchOptions,{card:true,hide:periods-best.shown-1},forms) : undefined);
}

type AdvisedSize = { width: number; height?: number };

/**
 * The 'table-tight-spacing' advice names the size that keeps compact spacing for the card the table measured. At
 * that width the card can take one more period in tight spacing, and that card misses compact spacing again. So
 * the card with one more period is checked once at the advised width: where it fits, its own advice is the size
 * that keeps compact spacing. `nextCard` gives that card: the one the period search already laid out where it
 * carries an advice, else a layout at the advised size.
 */
function checkedTightAdvice(geometry: Form, nextCard?: (size: AdvisedSize) => Form): Form {
  const at=geometry.warnings.findIndex(warning=>warning.code==='table-tight-spacing');
  const advice=geometry.warnings[at]?.fix?.[0];
  if (at<0 || advice?.op!=='replace' || !nextCard) return geometry;
  const size=advice.value as AdvisedSize;
  const next=nextCard(size);
  if (size.width<(next.sizing?.minWidth ?? Infinity)) return geometry;
  const again=next.warnings.find(warning=>warning.code==='table-tight-spacing')?.fix?.[0];
  if (again?.op!=='replace') return geometry;
  const need=(value: AdvisedSize) => value.height===undefined ? `${value.width} px of width` : `${value.width} × ${value.height} px`;
  const warning=geometry.warnings[at]!;
  const swap=(text: string) => text.replace(need(size),need(again.value as AdvisedSize));
  geometry.warnings[at]={...warning,message:swap(warning.message),...(warning.suggest===undefined ? {} : {suggest:swap(warning.suggest)}),fix:[again]};
  return geometry;
}

const fixedFits=(geometry: Form) => geometry.size.width >= (geometry.sizing?.minWidth ?? 0);

/** From this many periods on, the card is first tried with the latest periods alone. */
const PROBE_PERIODS = 16;

type Form = Geometry<TableMarks, DimSwitchDerived>;

/**
 * The card that shows the most of the latest periods and fits, where showing `missed` periods misses (and showing
 * `fitted` fits, when given); with none that fits, the card with every period left out, as before. A card with fewer
 * periods is never wider, so the answer is the one count where a fit turns into a miss. Each probe guesses that
 * count from the two nearest probes' minimum widths, so a table with even period tracks takes about two probes; a
 * guess that does not halve the bracket hands over to bisection.
 */
function mostShown(card: (hide: number) => Form, periods: number, missed: { shown: number; geometry: Form }, fitted?: { shown: number; geometry: Form }): { shown: number; geometry: Form } {
  const width=missed.geometry.size.width;
  const floor=(geometry: Form) => geometry.sizing?.minWidth;
  let lo=fitted, hi=missed, beyond: { shown: number; geometry: Form } | undefined, bisect=false;
  while (hi.shown-(lo?.shown ?? -1)>1) {
    const from=lo?.shown ?? 0, low=lo ? floor(lo.geometry) : undefined, high=floor(hi.geometry), far=beyond ? floor(beyond.geometry) : undefined;
    let guess=(from+hi.shown)>>1, guessed=false;
    if (bisect) { /* the last guess left more than half of the bracket: halve it */ }
    else if (low!==undefined && high!==undefined && high>low) {guess=from+Math.floor((width-low)*(hi.shown-from)/(high-low)); guessed=true;}
    // No fit seen yet: one period less first (the usual card), then on along the slope of the two misses.
    else if (!lo && !beyond) guess=hi.shown-1;
    else if (!lo && high!==undefined && far!==undefined && far>high) {guess=hi.shown-Math.ceil((high-width)*(beyond!.shown-hi.shown)/(far-high)); guessed=true;}
    guess=Math.min(hi.shown-1,Math.max(lo ? from+1 : 0,guess));
    const before=hi.shown-from, geometry=card(periods-guess);
    if (fixedFits(geometry)) lo={shown:guess,geometry}; else {beyond=hi; hi={shown:guess,geometry};}
    bisect=guessed && hi.shown-(lo?.shown ?? 0)>before/2;
  }
  return lo ?? {shown:0,geometry:card(periods)};
}

/**
 * Many periods: try the card with the latest 16, 32, 64 ... periods alone before the whole table, so the
 * work follows the periods drawn, not the periods in the data. The first probe that misses bounds the answer: every
 * form with more periods (the full table, the card with all of them) is wider and misses too. Undefined where every
 * probe fits; the caller then lays the whole table out as before.
 */
function latestThatFit(card: (hide: number) => Form, periods: number): { shown: number; geometry: Form } | undefined {
  let fitted: { shown: number; geometry: Form } | undefined;
  for (let shown=PROBE_PERIODS; shown<periods; shown*=2) {
    const geometry=card(periods-shown);
    if (!fixedFits(geometry)) return mostShown(card,periods,{shown,geometry},fitted);
    fitted={shown,geometry};
  }
  return undefined;
}

/** The registered layout: the forms above, then the height floor at card widths (320 >= 400 >= 480). */
function layoutDimSwitchCard(data: DimSwitchData, options: DimSwitchOptions = {}): Geometry<TableMarks, DimSwitchDerived> {
  return memoLayout(data, options, () => {
    const forms=new Map<string,PreparedForm>();
    const layout=(input:DimSwitchData,step:DimSwitchOptions)=>layoutDimSwitch(input,step,forms);
    return cardHeightFloor(layoutDimSwitchCard,data,options,classFloor(layout,data,options,layout(data,options)));
  });
}

export const dimswitchCore: ChartCore<DimSwitchData,DimSwitchOptions,TableMarks,DimSwitchDerived> = {
 type:'dimswitch',title:'Dimension switch table',summary:'A KPI table: measures by one hierarchical dimension by period, switchable between KPI rows over members and member rows over KPIs. The host supplies additive sums per member and period; Boardplot derives ratios, changes and judgement',aliases:['dim-switch-table','dim-switch'],sizing:{...chartSizing('table'),minWidth:CARD_MIN_WIDTH},defaults:{variant:'by-measure',depth:1,splits:false},annotationKinds:[],
 layout:layoutDimSwitchCard,
};
