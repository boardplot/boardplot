import { EMPTY_DATA } from '../../emptyData';
import { NormalizeError } from '../../normalize/shared';
import { bandFor } from '../../bandSelect';
import { formatAutomaticPercent, formatPercentagePoints } from '../../format';
import { ENGINE_NOTES, LABEL_WRAP_FLOOR, SOFT_LABEL_CAP } from '../table/tracks';
import { disclosureNote, disclosuresShown, engineNote } from '../../notes';
import { saysToDate } from '../../partialPeriod';
import { cappedItems } from '../../frame';
import { localeStrings, stringFields } from '../../strings';
import { AUTOMATIC_FORMAT, MAGNITUDE_GROUP, parseFormatExample, specUnitKind } from '../../formatSpec';
import type { CellState, CellTone, ComputedCellRecord, TableCell, TableRow } from '../../types/table';
import type { LintWarning } from '../../types/scene';
import type { CompiledDimSwitch, DimSwitchData, DimSwitchExpression, DimSwitchMeasure, DimSwitchMember, DimSwitchOptions, DimSwitchPeriod, DimSwitchSums, DimSwitchComparisonKind, DimSwitchJudgeBase } from './types';
import { maxOf } from '../../arrays';
import { emptyIdRecord } from '../../idRecords';

const key = (...parts: string[]) => JSON.stringify(parts);

/** The caller edits dimswitch widths, not the columns made by this compiler. */
export function dimSwitchTableWarnings(warnings: readonly LintWarning[]): LintWarning[] {
  return warnings.map(warning => {
    if ((warning.code !== 'table-column-clipped' && warning.code !== 'table-column-widened') || warning.owner?.colId === undefined) return warning;
    const id = warning.owner.colId;
    const width = id === 'label' || id === 'range' ? id : id === 'pp' || id === 'pl' ? 'change' : 'period';
    const need = warning.detail?.natural ?? warning.detail?.widened;
    return { ...warning, field: ['options', 'widths', width],
      suggest: `Set options.widths.${width} to ${need} px or more so this column fits.` };
  });
}
export const dimswitchRowId = (variant: string, member: string, measure?: string): string => key(variant, member, ...(measure ? [measure] : []));
/** Fields of a resolved expression (measure references are inlined before this runs). */
const fields = (expr: DimSwitchExpression): string[] => typeof expr === 'number' || 'measure' in expr ? [] : 'field' in expr ? [expr.field] : 'total' in expr ? [] : [...fields(expr.a), ...fields(expr.b)];
/** Measure ids an expression names. */
const refs = (expr: DimSwitchExpression): string[] => typeof expr === 'number' || 'field' in expr ? [] : 'measure' in expr ? [expr.measure] : 'total' in expr ? refs(expr.total) : [...refs(expr.a), ...refs(expr.b)];
const usesTotal = (expr: DimSwitchExpression): boolean => typeof expr === 'number' || 'field' in expr || 'measure' in expr ? false : 'total' in expr || usesTotal(expr.a) || usesTotal(expr.b);
const percentMeasure = (m: DimSwitchMeasure) => m.scale === 'percent' || (m.format !== undefined && specUnitKind(parseFormatExample(m.format)) === 'percent');
const affix = (m: DimSwitchMeasure): string | undefined => {
  const kind = m.format ? specUnitKind(parseFormatExample(m.format)) : m.scale === 'percent' ? 'percent' : undefined;
  return (m.unit === '%' || m.unit === 'pp') && (kind === 'percent' || kind === 'pp') ? undefined : m.unit;
};
interface Value { raw: number | null; state: CellState; blank?: boolean; nearZero?: true }
const combine = (op: 'add' | 'sub' | 'mul' | 'div', a: number, b: number) => op === 'sub' ? a - b : op === 'add' ? a + b : op === 'mul' ? a * b : a / b;
function evaluate(expr: DimSwitchExpression, sums: DimSwitchSums | undefined, total?: DimSwitchSums): Value {
  if (typeof expr === 'number') return { raw: expr, state: 'value' };
  if ('measure' in expr) throw new Error(`dimswitch internal: unresolved measure reference '${expr.measure}'`);
  if ('total' in expr) return evaluate(expr.total,total,total);
  if ('field' in expr) {
    const raw = sums?.[expr.field];
    return typeof raw === 'number' ? { raw, state: 'value' } : { raw: null, state: 'missing' };
  }
  const a = evaluate(expr.a, sums, total), b = evaluate(expr.b, sums, total);
  if (a.raw === null || b.raw === null) return { raw: null, state: a.state === 'missing' || b.state === 'missing' ? 'missing' : 'nm' };
  if (expr.op === 'div' && b.raw === 0) return { raw: null, state: a.raw === 0 ? 'na' : 'nm' };
  const raw = combine(expr.op, a.raw, b.raw) * (expr.factor ?? 1);
  return Number.isFinite(raw) ? { raw, state: 'value' } : { raw: null, state: 'nm' };
}
/** A driver formula over measure values; null when a value is missing or a step divides by zero. */
function formula(expr: DimSwitchExpression, values: ReadonlyMap<string, number>): number | null {
  if (typeof expr === 'number') return expr;
  if ('measure' in expr) return values.get(expr.measure) ?? null;
  if ('field' in expr || 'total' in expr) return null;
  const a = formula(expr.a, values), b = formula(expr.b, values);
  if (a === null || b === null || (expr.op === 'div' && b === 0)) return null;
  const raw = combine(expr.op, a, b) * (expr.factor ?? 1);
  return Number.isFinite(raw) ? raw : null;
}
/**
 * Shapley shares of a formula's change from the reference to the current
 * values: each driver's marginal effect averaged over every order in which
 * the drivers move. The shares add up to the formula's change exactly.
 */
function shapley(expr: DimSwitchExpression, ids: string[], current: number[], reference: number[]): (number | null)[] {
  const n = ids.length, fact = [1];
  for (let i = 1; i <= n; i++) fact[i] = fact[i - 1]! * i;
  const cache = new Map<number, number | null>();
  const at = (mask: number) => {
    if (!cache.has(mask)) cache.set(mask, formula(expr, new Map(ids.map((id, i) => [id, mask & (1 << i) ? current[i]! : reference[i]!]))));
    return cache.get(mask)!;
  };
  return ids.map((_, i) => {
    let share = 0;
    for (let mask = 0; mask < 1 << n; mask++) {
      if (mask & (1 << i)) continue;
      const with_ = at(mask | (1 << i)), without = at(mask);
      if (with_ === null || without === null) return null;
      let k = 0; for (let m = mask; m; m &= m - 1) k++;
      share += fact[k]! * fact[n - k - 1]! / fact[n]! * (with_ - without);
    }
    return share;
  });
}
/**
 * The largest relative change a dimswitch prints; past it, or off a zero base, the cell is n.m.
 * A base that rounds to 0 at the decimals of the measure's authored format is a zero base too (0.04 under '1.0').
 * A measure with no format prints a nonzero base with the decimals it needs (never as 0), so there only an exact zero is.
 */
const CHANGE_CAP = 999;
function change(current: Value, prior: Value, mode: DimSwitchMeasure['change'], format: string | undefined, decimalsOf: (format: string) => number): Value {
  if (prior.raw === null) return {raw:null,state:prior.state==='missing' ? 'na' : 'nm'};
  if (current.raw === null) return {raw:null,state:current.state==='missing' ? 'missing' : 'nm'};
  if (current.raw === 0 && prior.raw === 0) return {raw:null,state:'missing',blank:true};
  if (mode === 'pp' || mode === 'absolute') return {raw:current.raw-prior.raw,state:'value'};
  if (prior.raw === 0 || (format !== undefined && prior.raw > 0 && prior.raw < 0.5 * 10 ** -decimalsOf(format))) return {raw:null,state:'nm',nearZero:true};
  if (prior.raw < 0) return {raw:null,state:'nm'};
  const raw=100*(current.raw-prior.raw)/prior.raw;
  return Math.abs(raw) > CHANGE_CAP || !Number.isFinite(raw) ? {raw:null,state:'nm',nearZero:true} : {raw,state:'value'};
}
const thresholds = { volume: [2,10], cost: [5,15], rate: [3,10] } as const;
interface Judgement { tone: CellTone; strong?: true }
const NEUTRAL: Judgement = { tone: 'neutral' };
const ladder = (delta: number, [low, high]: readonly [number, number]): Judgement =>
  // A favourable change past the second threshold is a strong good.
  delta >= high ? { tone: 'good', strong: true } : delta >= low ? { tone: 'good' } : delta <= -high ? { tone: 'bad' } : delta <= -low ? { tone: 'warn' } : NEUTRAL;
const sampled = (base: DimSwitchJudgeBase | undefined, windows: (DimSwitchSums | undefined)[], options: DimSwitchOptions) =>
  base === undefined || (typeof base === 'string' ? [base] : base).every(field=>windows.every(s=>typeof s?.[field] === 'number' && s[field] >= (options.minimumSample?.[field] ?? 0)));
const thresholdFor = (family: NonNullable<DimSwitchMeasure['judge']>['family'], kind: DimSwitchComparisonKind, options: DimSwitchOptions) =>
  options.thresholds?.[kind]?.[family] ?? options.thresholds?.[family] ?? (family === 'effect' ? undefined : thresholds[family]);
function judge(m: DimSwitchMeasure, current: Value, prior: Value, windows: (DimSwitchSums | undefined)[], partial: boolean, options: DimSwitchOptions, effect: number | null, kind: DimSwitchComparisonKind): Judgement {
  if (!m.judge || partial || !sampled(m.judge.base, windows, options)) return NEUTRAL;
  if (m.judge.family === 'effect') return effect === null || effect === 0 ? NEUTRAL : ladder(effect, thresholdFor('effect',kind,options)!);
  if (current.raw === null || prior.raw === null || prior.raw === 0) return NEUTRAL;
  const delta = 100*(current.raw-prior.raw)/Math.abs(prior.raw) * (m.judge.family === 'cost' ? -1 : 1);
  return ladder(delta, thresholdFor(m.judge.family,kind,options)!);
}
function judgeBand(m: DimSwitchMeasure, value: Value, windows: (DimSwitchSums | undefined)[], partial: boolean, options: DimSwitchOptions): Judgement {
  if (!m.bands || value.raw === null || partial || !sampled(m.judge?.base,windows,options)) return NEUTRAL;
  return {tone:bandFor(value.raw,m.bands).tone ?? 'neutral'};
}
function cell(value: Value, judgement: Judgement = NEUTRAL, format?: string): TableCell {
  if (value.raw === null) return value.state === 'missing' ? null : {state:value.state === 'na' ? 'na' : 'nm'};
  return {v:value.raw,tone:judgement.tone,...(judgement.strong ? {strong:true as const} : {}),...(format ? {format}: {})};
}
const withBar = (value: TableCell, share: number): TableCell =>
  value !== null && typeof value === 'object' && typeof value.v === 'number' && value.v > 0 && share > 0 ? { ...value, bar: Math.min(1, share) } : value;
const GLYPH = { add: '+', sub: '−', mul: '×', div: '÷' } as const;
const signedFormat = (format: string) => format.startsWith('+') ? format : `+${format}`;

/**
 * The automatic card form (no option): the layout asks for it when
 * the full table misses the width. `card` drops the fixed value tracks to what
 * their content measures and narrows the label track; `hide` leaves out that
 * many periods, the first authored first, and says so in a note.
 */
export interface DimSwitchForm { card?: boolean; hide?: number; /** False skips the computed-cell records the React grid never reads. */ records?: false }
/** The label track of the card form. */
const CARD_LABEL_WIDTH = 140;

/** Pure compiler. The host supplies all calendar windows and additive facts. */
export function compileDimSwitch(data: DimSwitchData, options: DimSwitchOptions = {}, form: DimSwitchForm = {}): CompiledDimSwitch {
  // Each measure uses the same formats for all members and periods.
  const formatDecimals = new Map<string, number>();
  const decimalsOf = (format: string) => {
    let decimals = formatDecimals.get(format);
    if (decimals === undefined) {
      decimals = parseFormatExample(format).decimals;
      formatDecimals.set(format, decimals);
    }
    return decimals;
  };
  const variant = options.variant ?? 'by-measure', depth = options.depth ?? 1;
  // Nothing to put in a cell: the one empty-data code, as for every other type (a view with no measure still draws its head and one row, below).
  if (!data.periods.length || !data.facts.length) throw new NormalizeError(EMPTY_DATA, !data.periods.length ? 'periods' : 'facts', `dimswitch requires at least one ${!data.periods.length ? 'period' : 'fact'}`);
  const range = data.periods.find(p=>p.kind === 'range')!, prior = data.periods.find(p=>p.kind === 'prior')!;
  if (!range || !prior) throw new NormalizeError('invalid-data', 'periods', 'dimswitch requires one range and one prior period', 'give periods exactly one period of kind range and one of kind prior');
  const authoredPeriods = data.periods.filter(p=>!p.kind), plan = data.periods.find(p=>p.kind==='plan');
  const hidden = authoredPeriods.slice(0, form.hide ?? 0), periods = authoredPeriods.slice(hidden.length);
  if (data.periods.filter(p=>p.kind==='plan').length>1) throw new NormalizeError('invalid-count', 'periods', 'dimswitch permits at most one plan period', 'keep one period of kind plan');
  for (const setting of [options.thresholds,options.thresholds?.period,options.thresholds?.prior,options.thresholds?.plan]) for (const family of ['volume','cost','rate','effect'] as const) {
    const pair=setting?.[family];
    if (pair && (!pair.every(Number.isFinite) || !(pair[0]>=0 && pair[0]<=pair[1]))) throw new NormalizeError('invalid-number', 'options.thresholds', `dimswitch thresholds.${family} must satisfy 0 <= first <= second.`);
  }
  const memberIndex=new Map(data.dimension.members.map(m=>[m.id,m]));
  let memberLevels=0;
  for (const member of data.dimension.members) {
    const seen=new Set<string>(); let current:DimSwitchMember|undefined=member; let level=0;
    while(current) {
      if(seen.has(current.id)) throw new NormalizeError('parent-cycle', 'dimension.members', 'dimswitch member hierarchy contains a cycle');
      seen.add(current.id);level++;
      const parent: string | undefined=current.parentId;
      if(parent && !memberIndex.has(parent)) throw new NormalizeError('parent-missing', 'dimension.members', `Unknown dimswitch parent ${parent}`);
      current=parent ? memberIndex.get(parent) : undefined;
    }
    memberLevels=Math.max(memberLevels,level);
  }
  const measures = new Map(data.measures.map(m=>[m.id,m]));
  const measure = (id: string, from: string) => {
    const m = measures.get(id);
    if (!m) throw new NormalizeError('calc-ref-missing', 'measures', `dimswitch measure '${from}' names unknown measure '${id}'; use a measures[].id.`);
    return m;
  };
  const warnings: CompiledDimSwitch['warnings'] = [];
  const warned = new Set<string>();
  const warn = (code: string, id: string, message: string) => { if (!warned.has(code + id)) { warned.add(code + id); warnings.push({ code, severity: 'warn', field: ['data', 'measures', data.measures.findIndex(m => m.id === id)], message }); } };

  // ---------- the statement: parts, drivers, results ----------
  const driverOwner = new Map<string, string>();
  for (const m of data.measures) if (m.drivers !== undefined) {
    const ids = refs(m.drivers);
    if (!ids.length || fields(m.drivers).length || usesTotal(m.drivers)) throw new NormalizeError('invalid-data', 'measures', `dimswitch measure '${m.id}': drivers is a formula over { measure } references and numbers, not sums fields.`);
    if (new Set(ids).size > 6) throw new NormalizeError('invalid-data', 'measures', `dimswitch measure '${m.id}': at most 6 drivers; the effect split evaluates every order of them.`);
    for (const id of ids) {
      const driver = measure(id, m.id);
      if (id === m.id || driverOwner.has(id) && driverOwner.get(id) !== m.id) throw new NormalizeError('invalid-data', 'measures', `dimswitch measure '${id}': a driver explains one other line; '${m.id}' and '${driverOwner.get(id) ?? m.id}' both name it.`);
      if (driver.sign !== undefined || driver.result || driver.drivers !== undefined) throw new NormalizeError('invalid-data', 'measures', `dimswitch measure '${id}': a driver takes no sign, result or drivers; it is printed, never added.`);
      driverOwner.set(id, m.id);
    }
  }
  // Follow both placement fields before groupOf or lineLevel can recurse.
  // A driver's own partOf wins; otherwise it inherits its owner's placement.
  const placed = new Set<string>();
  for (const start of data.measures) {
    const path = new Map<string, number>();
    const edges: string[] = [];
    let current: DimSwitchMeasure | undefined = start;
    while (current && !placed.has(current.id)) {
      const cycleAt = path.get(current.id);
      if (cycleAt !== undefined) throw new NormalizeError('invalid-data', 'measures',
        `dimswitch measure placement forms a cycle: ${edges.slice(cycleAt).join('; ')}.`,
        'remove one partOf or drivers reference in this cycle');
      path.set(current.id, edges.length);
      const parent = current.partOf ?? driverOwner.get(current.id);
      if (parent === undefined) break;
      edges.push(current.partOf !== undefined
        ? `'${current.id}'.partOf -> '${parent}'`
        : `'${current.id}' is a driver in '${parent}'.drivers`);
      current = measure(parent, current.id);
    }
    for (const id of path.keys()) placed.add(id);
  }
  const isDriver = (m: DimSwitchMeasure) => driverOwner.has(m.id);
  /** Where a line prints: its partOf, or a driver under the block of the line it explains. */
  const placeOf = (m: DimSwitchMeasure) => m.partOf ?? (isDriver(m) ? measures.get(driverOwner.get(m.id)!)!.partOf : undefined);
  const partsOf = (id: string) => data.measures.filter(m => m.partOf === id && !isDriver(m));
  const childrenOf = (id: string) => data.measures.filter(m => placeOf(m) === id);
  const isSubtotal = (m: DimSwitchMeasure) => partsOf(m.id).length > 0;
  for (const m of data.measures) {
    if (m.partOf !== undefined) {
      const parent = measure(m.partOf, m.id);
      if (m.parentId !== undefined || m.splitOf !== undefined || parent.parentId !== undefined || parent.splitOf !== undefined) throw new NormalizeError('invalid-data', 'measures', `dimswitch measure '${m.id}': partOf and split fields (parentId, splitOf) do not mix.`);
      if (parent.result) throw new NormalizeError('invalid-data', 'measures', `dimswitch measure '${m.id}': a result has no parts; name its lines in its value instead.`);
    }
    if (m.result && (m.sign !== undefined || m.partOf !== undefined || m.value === undefined)) throw new NormalizeError('invalid-data', 'measures', `dimswitch measure '${m.id}': a result is a top-level line with a value that names its lines, e.g. { "op": "sub", "a": { "measure": "income" }, "b": { "measure": "costs" } }; it takes no sign or partOf.`);
    if (m.change === 'absolute' && percentMeasure(m)) throw new NormalizeError('invalid-data', 'measures', `dimswitch measure '${m.id}': a percent measure changes in points; use change 'pp', not 'absolute'.`);
    if (m.value === undefined && !isSubtotal(m)) throw new NormalizeError('invalid-data', 'measures', `dimswitch measure '${m.id}' has no value and no measure names it in partOf; add a value or make it a subtotal.`);
  }
  // A group that holds any statement line is a statement: all its lines keep their rows, their bars and their order.
  const statementGroups = new Set<string>();
  const statementField = (m: DimSwitchMeasure) => m.partOf !== undefined || m.sign !== undefined || m.result === true || m.drivers !== undefined || isDriver(m) || isSubtotal(m);
  const groupOf = (m: DimSwitchMeasure): string | undefined => m.group ?? (placeOf(m) !== undefined ? groupOf(measures.get(placeOf(m)!)!) : isDriver(m) ? groupOf(measures.get(driverOwner.get(m.id)!)!) : undefined);
  for (const m of data.measures) if (statementField(m)) {
    const g = groupOf(m);
    if (g === undefined) throw new NormalizeError('invalid-data', 'measures', `dimswitch measure '${m.id}': a statement line needs a group; the group is the statement (e.g. "Contribution margin").`);
    const place = placeOf(m);
    if (place !== undefined && m.group !== undefined && groupOf(measures.get(place)!) !== m.group) throw new NormalizeError('invalid-data', 'measures', `dimswitch measure '${m.id}': its group differs from the group of '${place}'; a line sits in its subtotal's group.`);
    statementGroups.add(g);
  }
  const inStatement = (m: DimSwitchMeasure) => { const g = groupOf(m); return g !== undefined && statementGroups.has(g); };
  /** Statement nesting: a top-level line is 1, its parts 2. */
  const lineLevel = (m: DimSwitchMeasure): number => placeOf(m) === undefined ? 1 : 1 + lineLevel(measures.get(placeOf(m)!)!);
  /** Contribution sign to the statement: the product of the signs up the partOf chain. A driver adds nothing. */
  const contribution = (m: DimSwitchMeasure): 1 | -1 => isDriver(m) ? 1 : ((m.sign ?? 1) * (m.partOf ? contribution(measures.get(m.partOf)!) : 1)) as 1 | -1;
  const effectMeasures = data.measures.filter(m => m.judge?.family === 'effect');
  if (effectMeasures.length) {
    for (const kind of ['prior',...(periods.length ? ['period' as const] : []),...(plan ? ['plan' as const] : [])] as DimSwitchComparisonKind[]) if (!thresholdFor('effect',kind,options)) throw new NormalizeError('invalid-number', 'options.thresholds', `dimswitch options.thresholds.effect or thresholds.${kind}.effect is required for judge family effect: two ascending numbers in the statement unit.`);
    const scales = new Set(effectMeasures.filter(m => !isDriver(m)).map(m => m.scale ?? m.format ?? ''));
    if (scales.size > 1) throw new NormalizeError('invalid-data', 'measures', `dimswitch effect lines must share one scale and format; ${[...scales].map(s => `'${s}'`).join(' and ')} differ. One threshold pair cannot judge two units.`);
  }

  // ---------- expressions: measure references inlined ----------
  const resolved = new Map<string, DimSwitchExpression>(), resolving = new Set<string>();
  const valueOf = (id: string): DimSwitchExpression => {
    const done = resolved.get(id);
    if (done !== undefined) return done;
    if (resolving.has(id)) throw new NormalizeError('invalid-data', 'measures', `dimswitch measure '${id}' refers to itself through { measure } references.`);
    resolving.add(id);
    const m = measures.get(id)!;
    const expr = m.value === undefined ? composed(id) : inline(m.value, id);
    resolving.delete(id); resolved.set(id, expr);
    return expr;
  };
  const inline = (e: DimSwitchExpression, from: string): DimSwitchExpression => {
    if (typeof e === 'number' || 'field' in e) return e;
    if ('measure' in e) { const m = measure(e.measure, from); const v = valueOf(m.id); return percentMeasure(m) ? { op: 'mul', a: v, b: 0.01 } : v; }
    if ('total' in e) return {total:inline(e.total,from)};
    return { ...e, a: inline(e.a, from), b: inline(e.b, from) };
  };
  /** A subtotal's parts added up with their signs, in their own units: a percent part stays in points. */
  const composed = (id: string) => partsOf(id).reduce<DimSwitchExpression | undefined>((sum, p) => {
    const term = valueOf(p.id);
    return sum === undefined ? (p.sign === -1 ? { op: 'mul', a: -1, b: term } : term) : { op: p.sign === -1 ? 'sub' : 'add', a: sum, b: term };
  }, undefined)!;
  const exprOf = (m: DimSwitchMeasure) => valueOf(m.id);
  for (const m of data.measures) exprOf(m);

  const facts = new Map(data.facts.map(f=>[key(f.memberId,f.periodId),{...f,sums:Object.setPrototypeOf({...f.sums},null) as DimSwitchSums,...(f.ref ? {ref:Object.setPrototypeOf({...f.ref},null) as DimSwitchSums} : {})}]));
  const statementFields = new Set(data.measures.filter(inStatement).flatMap(m => fields(exprOf(m))));
  const roots = data.measures.filter(m=>!m.parentId && placeOf(m) === undefined && !(options.splits && m.splitOf));
  const records: ComputedCellRecord[] = [];
  // Per member and window, the fields it reports in any period: one it reports anywhere is owed in every period.
  const reported = new Map<string, {sums: Set<string>; ref: Set<string>}>();
  const reportedBy = (id: string) => { let r = reported.get(id); if (!r) reported.set(id, r = {sums: new Set(), ref: new Set()}); return r; };
  // Fields that reach a derived parent from a number below it, so a null sum does not take the field away.
  const reaches = new Map<string, Set<string>>();
  const gaps = new Map<string, {member: string; window: string; periods: Set<string>; fields: Set<string>}>();
  if (data.dimension.sums) {
    for (const f of facts.values()) for (const window of ['sums','ref'] as const) for (const field of Object.keys(f[window] ?? {})) reportedBy(f.memberId)[window].add(field);
    for (const member of [data.dimension.total, ...data.dimension.members]) for (const field of member.fields ?? []) { reportedBy(member.id).sums.add(field); reportedBy(member.id).ref.add(field); }
    const derive=(member:string, children:DimSwitchMember[]) => {
      for(const child of children) derive(child.id,data.dimension.members.filter(m=>m.parentId===child.id));
      if(!children.length) return;
      for(const window of ['sums','ref'] as const) for(const child of children) for(const field of reportedBy(child.id)[window]) reportedBy(member)[window].add(field);
      for(const period of data.periods) {
        const existing=facts.get(key(member,period.id));
        // Keyed by field id: a field named __proto__ keeps its sum.
        const next={memberId:member,periodId:period.id,sums:emptyIdRecord() as DimSwitchSums,ref:emptyIdRecord() as DimSwitchSums};
        for(const window of ['sums','ref'] as const) {
          const fieldSet=new Set(children.flatMap(child=>Object.keys(facts.get(key(child.id,period.id))?.[window] ?? {})));
          for(const field of fieldSet) {
            // A child that reports the field in any period owes it in every period, and a statement field is owed by every child that reports the period: a gap makes the total missing, not smaller.
            const owing=children.filter(child=>reportedBy(child.id)[window].has(field) || (facts.get(key(child.id,period.id))?.[window] !== undefined && statementFields.has(field)));
            const inputs=owing.map(child=>({rowId:child.id,colId:key(period.id,window,field),value:facts.get(key(child.id,period.id))?.[window]?.[field] ?? null}));
            for(const child of owing) if(!Object.hasOwn(facts.get(key(child.id,period.id))?.[window] ?? {},field)) {
              const gap=gaps.get(child.id+window) ?? {member:child.id,window,periods:new Set<string>(),fields:new Set<string>()};
              gap.periods.add(period.id);gap.fields.add(field);gaps.set(child.id+window,gap);
            }
            const raw=inputs.some(i=>i.value===null)?null:inputs.reduce((sum,i)=>sum+i.value!,0);
            next[window][field]=raw;
            if(window==='sums' && inputs.some(i=>i.value!==null || reaches.get(i.rowId)?.has(field))) {const set=reaches.get(member) ?? new Set<string>();set.add(field);reaches.set(member,set);}
            records.push({rowId:member,colId:key(period.id,window,field),op:'dimswitch:partition-sum',inputs,raw,state:raw===null?'missing':'value',displayed:raw===null?'—':String(raw),kind:'aggregate'});
            const authored=existing?.[window]?.[field];
            if(typeof authored==='number'&&raw!==null) records.push({rowId:member,colId:key(period.id,window,field),op:'dimswitch:partition-check',inputs:[{rowId:member,colId:key(period.id,window,field),value:authored},...inputs],raw:authored-raw,state:'value',displayed:String(authored-raw),kind:'reconciliation'});
          }
        }
        // A field only the parent reports (a target, say) stays beside the sums derived from the children.
        facts.set(key(member,period.id),existing ? {...existing,sums:Object.assign(emptyIdRecord(),existing.sums,next.sums) as DimSwitchSums,ref:Object.assign(emptyIdRecord(),existing.ref,next.ref) as DimSwitchSums} : next);
      }
    };
    derive(data.dimension.total.id,data.dimension.members.filter(m=>!m.parentId));
    for(const gap of gaps.values()) warnings.push({code:'dimswitch-fact-missing',severity:'warn',field:['data','facts'],message:`Member '${gap.member}' has no ${gap.window==='ref' ? 'ref sums' : 'sums'} for ${[...gap.fields].map(f=>`'${f}'`).join(', ')} in period ${[...gap.periods].map(p=>`'${p}'`).join(', ')}, although it reports them in other periods. The sums of its parents and the Total print missing there. Send null for unknown or 0 for none.`});
  }
  const available=new Map<string,Set<string>>();
  for(const f of facts.values()) {const set=available.get(f.memberId) ?? new Set<string>();for(const field of Object.keys(f.sums)) if(typeof f.sums[field]==='number') set.add(field);available.set(f.memberId,set);}
  for(const [member,fieldsOf] of reaches) {const set=available.get(member) ?? new Set<string>();for(const field of fieldsOf) set.add(field);available.set(member,set);}
  // Declared fields apply even when the drawn windows hold only null for them.
  for (const member of [data.dimension.total, ...data.dimension.members]) for (const field of member.fields ?? []) {const set=available.get(member.id) ?? new Set<string>();set.add(field);available.set(member.id,set);}
  // Looked up per cell: a key string per lookup grew with members x measures x periods.
  type Fact = typeof facts extends Map<string, infer F> ? F : never;
  const factCache = new Map<string, Map<string, Fact | undefined>>();
  const factOf = (member:string, period:string) => {
    let byPeriod = factCache.get(member);
    if (!byPeriod) factCache.set(member, byPeriod = new Map());
    if (!byPeriod.has(period)) byPeriod.set(period, facts.get(key(member,period)));
    return byPeriod.get(period);
  };
  const sums = (member:string, period:string) => factOf(member,period)?.sums;
  const has = (m: DimSwitchMeasure, member:string) => fields(exprOf(m)).every(field=>available.get(member)?.has(field));
  const omissions: CompiledDimSwitch['omissions'] = [];
  // A measure the Total lacks is left out everywhere, so both variants show the same measures. A statement line never leaves: it prints missing.
  const applies = (m: DimSwitchMeasure, member:string) => {
    if (inStatement(m)) return true;
    if (!has(m, data.dimension.total.id)) {
      const field = fields(exprOf(m)).find(f => !available.get(data.dimension.total.id)?.has(f))!;
      if (!omissions.some(o => o.labelId === `measure:${m.id}`)) omissions.push({ labelId: `measure:${m.id}`, text: m.label, reason: 'no-number', destination: 'reading.omissions' });
      warn('dimswitch-measure-omitted', m.id, `Measure '${m.id}' is left out of the table: the Total has no number for field '${field}'${data.dimension.sums ? ', and no member has one' : ''}. Check the field name in facts[].sums and in the measure value, or declare it in dimension.total.fields to keep the measure with a missing Total.`);
      return false;
    }
    return has(m, member);
  };
  const headline = (member:string) => data.dimension.headline.map(id=>measures.get(id)!).find(m=>applies(m,member));
  const show = (m:DimSwitchMember) => {
    if (options.show !== 'withData') return true;
    // A member that still counts in the Total through any applicable measure stays.
    const live=new Set(data.measures.filter(x=>applies(x,m.id)).flatMap(x=>fields(exprOf(x))));
    return live.size === 0 || [...live].some(f => !!sums(m.id,range.id)?.[f]);
  };
  const ordered = (parentId?:string) => {
    const members=data.dimension.members.filter(m=>m.parentId===parentId && show(m));
    if (options.order && options.order !== 'sheet') {
      const order=options.order, by=measures.get(order.by);
      if(!by) throw new NormalizeError('invalid-data', 'options.order', `Unknown dimswitch ordering measure ${order.by}`);
      members.sort((a,b)=>{
        const av=evaluate(exprOf(by),sums(a.id,range.id),sums(data.dimension.total.id,range.id)).raw, bv=evaluate(exprOf(by),sums(b.id,range.id),sums(data.dimension.total.id,range.id)).raw;
        if (av === null || bv === null) return av === bv ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : av === null ? 1 : -1;
        return (av-bv)*(order.desc === false ? 1 : -1) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      });
    }
    return members;
  };
  const receiptTemplates = new Map<string, {op:string; refs:{field:string; total:boolean; reference:boolean}[]}>();
  const receiptOf = (m:DimSwitchMeasure, isChange:boolean) => {
    const id=`${m.id}:${isChange}`;
    let template=receiptTemplates.get(id);
    if (template) return template;
    const refs:{field:string; total:boolean; reference:boolean}[]=[];
    const expression = (e:DimSwitchExpression, reference=false, total=false):string => {
      if (typeof e==='number') return `lit(${e})`;
      if ('measure' in e) throw new Error(`dimswitch internal: unresolved measure reference '${e.measure}'`);
      if ('total' in e) return expression(e.total,reference,true);
      if ('field' in e) {refs.push({field:e.field,total,reference});return `ref($${refs.length-1})`;}
      const value=`${e.op}(${expression(e.a,reference,total)},${expression(e.b,reference,total)})`;
      return e.factor===undefined || e.factor===1 ? value : `mul(${value},${e.factor})`;
    };
    const current=expression(exprOf(m));
    const op=isChange ? `${m.change==='pp' || m.change==='absolute' ? 'sub' : 'percentDelta'}(${current},${expression(exprOf(m),true)})` : current;
    template={op,refs};receiptTemplates.set(id,template);return template;
  };
  const record = (rowId:string,colId:string,m:DimSwitchMeasure,member:string,period:string,value:Value,ref?:DimSwitchSums, isChange=false, refTotal?:DimSwitchSums, refPeriod?:string) => {
    if (form.records === false) return;
    const template=receiptOf(m,isChange);
    const inputs=template.refs.map(({field,total,reference})=>({
      rowId:total ? data.dimension.total.id : member,
      colId:reference ? key(refPeriod ?? period,refPeriod ? 'sums' : 'ref',field) : key(period,'sums',field),
      value:(reference ? total ? refTotal : ref : sums(total ? data.dimension.total.id : member,period))?.[field] ?? null,
    }));
    records.push({rowId,colId,op:template.op,inputs,raw:value.raw,state:value.state,displayed:'',kind:'calc'});
  };
  const formatOf = (m: DimSwitchMeasure) => m.format ?? (m.scale==='percent' ? '1.2%' : '1,234');
  /** Half a printed unit: a footing difference below it is rounding. */
  const tolerance = (m: DimSwitchMeasure) => 0.5 * 10 ** -decimalsOf(formatOf(m)) + 1e-9;
  /** Driver values of one window: a percent driver enters as a fraction. */
  const driverValues = (ids: string[], s: DimSwitchSums | undefined, total: DimSwitchSums | undefined) => ids.map(id => {const d=measures.get(id)!, v=evaluate(exprOf(d), s, total).raw; return v === null ? null : percentMeasure(d) ? v / 100 : v;});
  /** Effects of an explained line's drivers on the line, between two windows. */
  const driverEffects = (owner: DimSwitchMeasure, member: string, col: string, s: DimSwitchSums | undefined, r: DimSwitchSums | undefined, total: DimSwitchSums | undefined, refTotal: DimSwitchSums | undefined) => {
    const ids = [...new Set(refs(owner.drivers!))];
    const cur = driverValues(ids, s, total), ref = driverValues(ids, r, refTotal);
    const line = evaluate(exprOf(owner), s, total).raw;
    const reproduced = cur.every(v => v !== null) ? formula(owner.drivers!, new Map(ids.map((id, i) => [id, cur[i]!]))) : null;
    if (line !== null && reproduced !== null && Math.abs(line - reproduced) > tolerance(owner)) {
      const percent = ids.filter(id => {const d=measures.get(id)!;return !percentMeasure(d) && JSON.stringify(d.value ?? {}).includes('"factor":100');});
      warn('dimswitch-driver-footing', owner.id, `Measure '${owner.id}': its drivers formula gives ${reproduced} where the line is ${line} (member '${member}', ${col}).${percent.length ? ` Percent driver ${percent.map(p => `'${p}'`).join(', ')} without scale: 'percent'?` : ''}`);
    }
    const shares = cur.every(v => v !== null) && ref.every(v => v !== null) ? shapley(owner.drivers!, ids, cur as number[], ref as number[]) : ids.map(() => null);
    return new Map(ids.map((id, i) => [id, shares[i]!]));
  };
  const rows:TableRow[]=[]; const levels: Record<string, number> = {};
  // Size bars compare members of one measure; collected while the rows are built.
  const bars:{row:TableRow;measure:string;col:string;value:number}[]=[];
  // Relative change cells, so each column settles one decimal count.
  const relativeChanges:{cell:TableCell;col:string;rounded:number}[]=[];
  let nearZeroSeen=false;
  const totalId=data.dimension.total.id;
  const driverOps = new Map<string, string>();
  for (const m of data.measures) if (m.drivers !== undefined) {
    const assign = (e: DimSwitchExpression, glyph?: string) => {
      if (typeof e === 'number' || 'field' in e || 'total' in e) return;
      if ('measure' in e) { if (glyph && !driverOps.has(e.measure)) driverOps.set(e.measure, glyph); return; }
      assign(e.a, glyph); assign(e.b, GLYPH[e.op]);
    };
    assign(m.drivers);
  }
  const addMeasure = (m:DimSwitchMeasure,member:string,parentId:string|undefined,rung:number,label=m.label,kind:TableRow['kind']='measure') => {
    const id=dimswitchRowId(variant,member,m.id);
    // Keyed by period id too: a period named __proto__ keeps its cell.
    const cells:Record<string,TableCell>=emptyIdRecord(), changes:Record<string,TableCell>=Object.setPrototypeOf({range:null,pp:null,...(plan ? {pl:null} : {})},null), effects:Record<string,TableCell>=Object.setPrototypeOf({range:null,pp:null,...(plan ? {pl:null} : {})},null);
    const values=new Map<string,Value>();
    const owner = isDriver(m) ? measures.get(driverOwner.get(m.id)!)! : undefined;
    const ownFormat = formatOf(m), effectFormat = signedFormat(formatOf(owner ?? m));
    for (const {p,reference,comparisonKind} of [
      {p:range,reference:prior,comparisonKind:'prior' as const},
      ...(plan ? [{p:range,reference:plan,comparisonKind:'plan' as const}] : []),
      ...periods.map(p=>({p,reference:undefined,comparisonKind:'period' as const})),
    ]) {
      const currentSums=sums(member,p.id), ref=reference ? sums(member,reference.id) : factOf(member,p.id)?.ref;
      const total=sums(data.dimension.total.id,p.id), refTotal=reference ? sums(data.dimension.total.id,reference.id) : factOf(data.dimension.total.id,p.id)?.ref;
      const windows=[currentSums,ref,...(usesTotal(exprOf(m)) ? [total,refTotal] : [])];
      const current=evaluate(exprOf(m),currentSums,total), before=evaluate(exprOf(m),ref,refTotal), delta=change(current,before,m.change,m.format,decimalsOf);
      if (delta.nearZero) nearZeroSeen = true;
      const col=p.kind ? 'range' : p.id, comparison=comparisonKind==='plan' ? 'pl' : comparisonKind==='prior' ? 'pp' : p.id;
      // Effect on the statement: the line's signed change, or a driver's share of the change of the line it explains.
      let effect: number | null = null;
      if (m.judge?.family === 'effect' || (owner && data.effectLabel)) {
        if (owner) {
          effect = driverEffects(owner, member, col, currentSums, ref, total, refTotal).get(m.id) ?? null;
          if (effect !== null) effect *= contribution(owner);
        } else if (current.raw !== null && before.raw !== null) effect = contribution(m) * (current.raw - before.raw);
        records.push({rowId:`${id}:effect`,colId:comparison,op:owner ? 'dimswitch:shapley' : 'dimswitch:effect',inputs:[],raw:effect,state:effect === null ? 'nm' : 'value',displayed:'',kind:'calc'});
      }
      const judgement=judge(m,current,before,windows,p.partial === true || (comparisonKind==='plan' && reference?.partial === true),options,effect,comparisonKind);
      values.set(col,current);
      // Bands judge the level. A change judgement colours the change it judged, never the level.
      if (comparisonKind!=='plan') {
        const levelJudgement=m.bands ? judgeBand(m,current,[currentSums,...(usesTotal(exprOf(m)) ? [total] : [])],p.partial === true,options) : NEUTRAL;
        cells[col]=cell(current,levelJudgement); record(id,col,m,member,p.id,current);
      }
      // A relative change prints whole from 5% and at 0, else to one decimal, after rounding to 0.1; the column settles one count below. An absolute one prints in the row's own format.
      const rounded=Math.round(Math.abs(delta.raw ?? 0)*10)/10;
      const relative=m.change!=='pp' && m.change!=='absolute';
      const changeFormat=m.change==='pp' ? formatPercentagePoints(1.2,1,true) : m.change==='absolute' ? signedFormat(ownFormat) : formatAutomaticPercent(1.2,rounded>=5 || rounded===0 ? 0 : 1,true);
      const changeCell:TableCell=delta.state==='missing' ? {missing:delta.blank ? 'blank' : 'dash'} : cell(delta,judgement,changeFormat);
      const effectCell:TableCell=effect === null ? null : {v:effect,format:effectFormat};
      if (m.format === undefined && m.unit === undefined && changeCell && typeof changeCell === 'object') Object.assign(changeCell, { [AUTOMATIC_FORMAT]: true });
      if ((owner ?? m).format === undefined && (owner ?? m).unit === undefined && effectCell) Object.assign(effectCell, { [AUTOMATIC_FORMAT]: true });
      if (p.kind) {
        // An unjudged measure's change is context: it whispers.
        cells[comparison]=!m.judge && changeCell !== null && typeof changeCell==='object' && changeCell.missing === undefined ? {...changeCell,muted:true} : changeCell;
        if (relative) relativeChanges.push({cell:cells[comparison],col:comparison,rounded});
        record(id,comparison,m,member,p.id,delta,ref,true,refTotal,reference?.id);
        effects[comparison]=effectCell;
      }
      else {changes[p.id]=changeCell; effects[p.id]=effectCell; record(`${id}:change`,p.id,m,member,p.id,delta,ref,true,refTotal); if (relative) relativeChanges.push({cell:changeCell,col:p.id,rounded});}
    }
    // An unjudged volume (a sum of money or counts) shows its size as a bar, not a colour; a statement line never does.
    const sized = !m.judge && (m.scale === 'money' || m.scale === 'count') && !inStatement(m);
    if (isSubtotal(m) && m.value !== undefined) for (const p of [range,...(plan ? [plan] : []),...periods]) {
      // An authored subtotal is kept; a difference from its parts past rounding is reported, never overwritten.
      const authored=evaluate(exprOf(m),sums(member,p.id),sums(data.dimension.total.id,p.id)).raw, parts=evaluate(composed(m.id),sums(member,p.id),sums(data.dimension.total.id,p.id)).raw;
      if (authored!==null && parts!==null && Math.abs(authored-parts)>tolerance(m)) warn('dimswitch-subtotal-footing',m.id,`Measure '${m.id}': its value ${authored} differs from the sum of its parts ${parts} (member '${member}', ${p.id}). Boardplot keeps the authored value.`);
    }
    // A scaled measure with no format leaves the row's format open, so the table's count climb to M and B applies (an authored format keeps its digits).
    const row:TableRow={id,label,parentId,rung,kind,format:m.scale && m.scale!=='percent' && m.format===undefined ? undefined : ownFormat,scale:m.scale,unitAffix:kind==='detail' || kind==='split' ? undefined : affix(m),relation:kind==='split'?'ofWhich':'displayOnly',totalPolicy:'source',cells};
    if (m.format === undefined && m.unit === undefined) Object.assign(row, { [AUTOMATIC_FORMAT]: true });
    // Every member's row of a scaled measure reads in one magnitude down a column: 1.17M over 0.25M, not over 254k.
    if (m.scale === 'money' || m.scale === 'count') Object.assign(row, { [MAGNITUDE_GROUP]: m.id });
    // A member's bar compares it with the other members in that column (the Total would always win).
    if (sized && member!==totalId) for (const col of ['range',...periods.map(p=>p.id)]) {const value=values.get(col)?.raw; if (typeof value==='number') bars.push({row,measure:m.id,col,value});}
    if (m.divider && (kind==='measure' || kind==='split')) row.divider=true;
    rows.push(row,{id:`${id}:change`,label:data.changeLabel ?? '',parentId:id,inline:true,inlineGroup:'change',relation:'displayOnly',missing:'blank',cells:changes});
    if (owner && data.effectLabel) rows.push({id:`${id}:effect`,label:data.effectLabel,parentId:id,inline:true,inlineGroup:'effect',relation:'displayOnly',missing:'blank',cells:effects});
    return row;
  };
  /** A statement line: its kind, its sign for the table's signed print, its operator. */
  const statementRow = (m: DimSwitchMeasure, row: TableRow, first: boolean) => {
    if (m.result) { row.kind = 'result'; return; }
    if (isDriver(m)) { row.kind = 'driver'; const glyph = driverOps.get(m.id); if (glyph) row.operator = glyph as TableRow['operator']; return; }
    // A part reads as the detail of its subtotal: regular weight, the child ink.
    row.kind = isSubtotal(m) ? 'subtotal' : m.partOf !== undefined ? 'detail' : 'measure';
    // Additive under a source parent: nothing is summed again, and the signed print sees the chain.
    row.relation = 'additive';
    if (m.sign === -1) row.sign = -1;
    else if (!first) row.operator = '+';
  };
  const addSplits=(m:DimSwitchMeasure,member:string,parentId:string|undefined,rung:number) => {
    if (options.splits) for (const split of data.measures.filter(s=>(s.parentId===m.id || s.splitOf===m.id) && applies(s,member))) addMeasure(split,member,parentId,rung+1,split.label,'split');
  };
  /** The deepest statement line: by measure, members open after the whole statement. */
  const statementDepth = Math.max(1, maxOf(data.measures.filter(inStatement).map(lineLevel)));
  let sections=0;
  const section=(label:string,id=`dimswitch:section:${++sections}`) => rows.push({id,label,role:'section',kind:'section'});
  /** The last result of each statement block takes the closing rule. */
  const closeResults = (from: number) => { const last = rows.slice(from).filter(r => r.kind === 'result' && !r.inline).pop(); if (last) last.final = true; };
  if (variant==='by-measure') {
    // Groups head their own section; the measures before the first group sit under the total's heading.
    const grouped=roots.some(m=>m.group!==undefined);
    let current:string|null=null, groupStart=rows.length;
    const walk=(m:DimSwitchMeasure,parent:string,parentMember:string|undefined,rung:number,memberLevel:number) => {
      for (const member of ordered(parentMember)) {
        if (!applies(m,member.id)) continue;
        const row=addMeasure(m,member.id,parent,rung,member.label,'detail');
        addSplits(m,member.id,parent,rung);
        levels[row.id]=statementDepth+memberLevel+1;
        walk(m,row.id,member.id,rung+1,memberLevel+1);
      }
    };
    const line=(m:DimSwitchMeasure,parent:string|undefined,rung:number,first:boolean) => {
      const row=addMeasure(m,totalId,parent,rung);
      if (inStatement(m)) statementRow(m,row,first);
      addSplits(m,totalId,parent,rung);
      const kids=childrenOf(m.id);
      if (kids.length) {
        // Parts and drivers sit under the line; it takes no member rows, so the two kinds of children never mix.
        levels[row.id]=lineLevel(m)+1;
        let firstPart=true;
        for (const k of kids) {line(k,row.id,rung+1,isDriver(k) ? false : firstPart); if (!isDriver(k)) firstPart=false;}
      } else {levels[row.id]=statementDepth+1; walk(m,row.id,undefined,rung+1,1);}
    };
    let firstLine=true;
    for (const m of roots) {
      if (!applies(m,totalId)) continue;
      if (grouped && (m.group ?? '')!==current) {
        closeResults(groupStart); groupStart=rows.length; firstLine=true;
        current=m.group ?? '';section(m.group === undefined ? data.dimension.total.heading ?? data.dimension.total.label : data.groupHeadings?.[m.group] ?? m.group);
      }
      line(m,undefined,0,firstLine);
      if (!isDriver(m)) firstLine=false;
    }
    closeResults(groupStart);
  } else {
    // A member block: its measures one rung deeper, a group under a label row of its own.
    const block=(member:string,parentRow:string,rung:number) => {
      const groups=new Map<string,string>();
      const start=rows.length;
      const line=(m:DimSwitchMeasure,parent:string,at:number,first:boolean) => {
        const row=addMeasure(m,member,parent,at);
        if (inStatement(m)) statementRow(m,row,first);
        addSplits(m,member,parent,at);
        const kids=childrenOf(m.id);
        if (kids.length) {
          // The statement opens after every member level.
          levels[row.id]=memberLevels+lineLevel(m)+1;
          let firstPart=true;
          for (const k of kids) {line(k,row.id,at+1,isDriver(k) ? false : firstPart); if (!isDriver(k)) firstPart=false;}
        }
      };
      const firstIn=new Map<string,boolean>();
      for (const m of roots.filter(m=>applies(m,member) && (member!==totalId || m.inTotalBlock!==false))) {
        let parent=parentRow, at=rung+1;
        if (m.group!==undefined) {
          let groupRow=groups.get(m.group);
          if (groupRow===undefined) {
            groupRow=`${dimswitchRowId(variant,member)}:group:${m.group}`;
            rows.push({id:groupRow,label:m.group,parentId:parentRow,rung:rung+1,kind:'detail',foldable:false,relation:'displayOnly',totalPolicy:'source',missing:'blank'});
            groups.set(m.group,groupRow);
          }
          parent=groupRow; at=rung+2;
        }
        const g=m.group ?? '';
        line(m,parent,at,firstIn.get(g) ?? true); firstIn.set(g,false);
      }
      // One closing result per statement group of the block.
      for (const g of statementGroups) {const last=rows.slice(start).filter(r=>r.kind==='result' && groupOf(measures.get((JSON.parse(r.id) as string[]).pop()!)!)===g).pop(); if (last) last.final=true;}
    };
    const totalRow=dimswitchRowId(variant,totalId);
    rows.push({id:totalRow,label:data.dimension.total.label,kind:'member',rung:0,totalPolicy:'source',relation:'displayOnly'});
    block(totalId,totalRow,0);
    // No section row here: the label column's head already names the dimension, and a heading prints only for an authored group.
    const walk=(parentMember:string|undefined,parentRow:string|undefined,rung:number) => {
      for (const member of ordered(parentMember)) {
        const h=headline(member.id), id=dimswitchRowId(variant,member.id);
        let summary:TableRow;
        if (h) {
          summary=addMeasure(h,member.id,parentRow,rung,member.label,'member');
          const oldId=summary.id; summary.id=id; delete summary.divider;
          for (const r of rows.slice(rows.indexOf(summary)+1)) {if (r.parentId===oldId) {r.id=r.id.replace(oldId,id); r.parentId=id;}}
          for (const r of records) {if (r.rowId===oldId) r.rowId=id;else if (r.rowId===`${oldId}:change`) r.rowId=`${id}:change`;else if (r.rowId===`${oldId}:effect`) r.rowId=`${id}:effect`;}
          summary.unitAffix=[h.label,affix(h)].filter(Boolean).join(', ');
          // The card form puts the headline and its unit under the member name, on the change line's label.
          const changeRow=rows.find(r=>r.id===`${id}:change`);
          if (form.card && changeRow && changeRow.label==='') {changeRow.label=summary.unitAffix; delete summary.unitAffix;}
        } else {summary={id,label:member.label,parentId:parentRow,rung,kind:'member',totalPolicy:'source',relation:'displayOnly'};rows.push(summary);}
        block(member.id,id,rung);
        levels[id]=rung+2;
        walk(member.id,id,rung+1);
      }
    };
    walk(undefined,undefined,0);
  }
  // A bar column compares one measure, the one most of its bars belong to (the first authored on a tie). A bar is a member's
  // share of its largest sibling, so a parent never dwarfs its own parts; siblings whose bars all reach 90 % of the track draw none.
  const measureOrder=new Map(data.measures.map((m,i)=>[m.id,i]));
  // Grouped once by column, in first-seen order: a filter per column grew with columns x cells.
  const byCol=<T extends {col:string}>(entries:T[]) => {const groups=new Map<string,T[]>();for (const entry of entries) {const group=groups.get(entry.col);if (group) group.push(entry); else groups.set(entry.col,[entry]);}return groups;};
  for (const [col,inCol] of byCol(bars)) {
    const counts=new Map<string,number>();
    for (const bar of inCol) counts.set(bar.measure,(counts.get(bar.measure) ?? 0)+1);
    const chosen=[...counts].sort((a,b)=>b[1]-a[1] || measureOrder.get(a[0])!-measureOrder.get(b[0])!)[0]![0];
    for (const parent of new Set(inCol.map(bar=>bar.row.parentId))) {
      const siblings=inCol.filter(bar=>bar.measure===chosen && bar.row.parentId===parent), max=Math.max(0,maxOf(siblings.map(bar=>bar.value)));
      if (max<=0 || siblings.every(bar=>bar.value/max>=0.9)) continue;
      for (const bar of siblings) bar.row.cells![col]=withBar(bar.row.cells![col]!,bar.value/max);
    }
  }
  // One decimal count per column of relative changes; whole only where every change rounds to 0 or to 5 % or more.
  for (const [,inCol] of byCol(relativeChanges)) {
    const entries=inCol.filter(entry=>entry.cell!==null && typeof entry.cell==='object' && typeof entry.cell.v==='number');
    const format=formatAutomaticPercent(1.2,entries.some(entry=>entry.rounded>0 && entry.rounded<5) ? 1 : 0,true);
    for (const entry of entries) (entry.cell as {format?:string}).format=format;
  }
  const parents=new Set(rows.filter(r=>!r.inline && r.parentId).map(r=>r.parentId!));
  for (const id of Object.keys(levels)) if (!parents.has(id)) delete levels[id];
  const maxDepth=Math.max(1,maxOf(Object.values(levels)));
  if (data.measures.length && (!Number.isInteger(depth) || depth<1 || depth>maxDepth)) throw new NormalizeError('invalid-data', 'options.depth', `dimswitch depth must be between 1 and ${maxDepth} (the outline levels of this table); got ${depth}`, `use a depth from 1 to ${maxDepth}`);
  const defaults=Object.keys(levels).filter(id=>levels[id]!>depth);
  const collapsed=new Set(defaults);
  for (const key of ['expanded','collapsed'] as const) {
    const foreign=foreignRowId(options.expansion?.[key]);
    if (foreign!==undefined) throw new NormalizeError('invalid-data', `options.expansion.${key}`, `dimswitch row id ${foreign} names no variant first, so it names no row`, `build each id as JSON.stringify([variant, memberId, measureId]) with variant 'by-measure' or 'by-member', or use dimswitchRowId`);
  }
  for (const id of options.expansion?.expanded ?? []) collapsed.delete(id);
  for (const id of options.expansion?.collapsed ?? []) collapsed.add(id);
  const {variant:_v,depth:_d,splits:_sp,order:_o,show:_sh,thresholds:_t,minimumSample:_m,expansion:_e,widths,...tableOptions}=options;
  // A cohort density is a fixed one-line row and a dimswitch cell holds two lines: it is retired here and ignored (retired.ts).
  if ((tableOptions.density as string | undefined)?.startsWith('cohort')) delete tableOptions.density;
  const width={label:widths?.label ?? 320,range:widths?.range ?? 110,change:widths?.change ?? 92,period:widths?.period ?? 94};
  // The card form: value tracks as wide as their content, the label track at most 140 px (its labels wrap).
  const fixed=(w:number)=>form.card ? {} : {width:w};
  const labelCap=form.card ? Math.min(widths?.label ?? CARD_LABEL_WIDTH, CARD_LABEL_WIDTH) : width.label;
  // Engine notes (disclosures): a partial period's star, a near-zero change, the periods the card leaves out.
  const strings={...localeStrings(options.locale?.language),...options.strings};
  // The Range is a period too: a partial Range carries the star and enters the note.
  const partial=[range,...periods].filter(p=>p.partial);
  // The star points at its note, so it prints only where the note does (notes.show lists 'disclosure').
  const star=disclosuresShown(options) ? '*' : '';
  // Where the star's note does not print, a partial head says "to date" itself, unless its words already do.
  const headSub=(p:DimSwitchPeriod)=>star || !p.partial || saysToDate(`${p.label} ${p.subLabel ?? ''}`, strings.toDate) ? p.subLabel : p.subLabel ? `${p.subLabel} ${strings.toDate}` : strings.toDate;
  const omitted=hidden.map(p=>p.label), fullPeriodNote=stringFields(strings.hiddenPeriods,{periods:omitted.join(', ')});
  const listed=cappedItems(omitted,{notes:options.notes,strings});
  const shortPeriodNote=stringFields(strings.hiddenPeriods,{periods:listed.join(', ')});
  const notes=[
    ...(partial.length ? [disclosureNote(`${star ? `${star} ` : ''}${partial.map(p=>p.label).join(', ')} ${strings.toDate}`)] : []),
    ...(nearZeroSeen ? [disclosureNote(strings.nearZeroChange)] : []),
    ...(hidden.length ? [engineNote(fullPeriodNote,'disclosure',shortPeriodNote===fullPeriodNote?undefined:shortPeriodNote)] : []),
  ];
  return {
    data:{columns:[
      {id:'label',kind:'rowLabel',label:variant==='by-measure'?'KPI':data.dimension.label,...(widths?.label===undefined && !form.card ? {maxTextWidth:labelCap} : {maxWidth:labelCap})},
      {id:'range',kind:'value',label:range.partial ? `${range.label}${star}` : range.label,subLabel:headSub(range),...fixed(width.range),aggregate:'source',emphasis:'strong'},
      {id:'pp',kind:'value',label:prior.label,subLabel:prior.subLabel,format:'+1.2%',percentScale:'points',...fixed(width.change),aggregate:'none',emphasis:'strong'},
      ...(plan ? [{id:'pl',kind:'value' as const,label:plan.label,subLabel:plan.subLabel,format:'+1.2%',percentScale:'points' as const,...fixed(width.change),aggregate:'none' as const,emphasis:'strong' as const}] : []),
      // A partial period carries a star in its head; the note says what it means.
      ...periods.map(p=>({id:p.id,kind:'value' as const,label:p.partial ? `${p.label}${star}` : p.label,subLabel:headSub(p),...fixed(width.period),aggregate:'source' as const,...(p.partial ? {emphasis:'muted' as const} : {})})),
    // Range and its comparisons form one block between labels and periods.
    ],columnGroups:[{id:'labels',label:'Labels',heading:false,columns:['label']},{id:'block',label:'Range',heading:false,columns:['range','pp',...(plan ? ['pl'] : [])]}],rows},
    // No rowExtent: under the default the rules end at the last track.
    options:{variant:'steering',stickyLabels:plan ? 4 : 3,mountCollapsed:false,fitFormats:true,labelIndent:form.card ? {base:12,step:12} : {base:25,step:17},...(form.card ? {cellPadX:3} : {}),...tableOptions,
      ...(notes.length ? {[ENGINE_NOTES]:notes} : {}),
      ...(widths?.label!==undefined && !form.card ? {[SOFT_LABEL_CAP]:true} : {}),
      ...{[LABEL_WRAP_FLOOR]:true},
      // The object form of stickyLabels without `columns` keeps the compiled default: label, Range, vs prior (and vs plan).
      ...(typeof tableOptions.stickyLabels==='object' && tableOptions.stickyLabels.columns===undefined ? {stickyLabels:{...tableOptions.stickyLabels,columns:plan ? 4 : 3}} : {}),
      ...(data.effectLabel ? {inlineVisibility:{effect:false,...tableOptions.inlineVisibility}} : {}),
      expansion:{collapsed:[...collapsed]}},computedCells:records,depthCollapsed:defaults,levels,maxDepth,warnings,omissions,
  };
}

/** The first row id whose first element is not a variant: it cannot name a row in either variant. */
export function foreignRowId(ids: readonly string[] | undefined): string | undefined {
  return (ids ?? []).find((id) => {
    let parsed: unknown;
    try { parsed = JSON.parse(id); } catch { return true; }
    return !Array.isArray(parsed) || (parsed[0] !== 'by-measure' && parsed[0] !== 'by-member');
  });
}
