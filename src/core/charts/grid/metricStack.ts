/** Metric-stack source model and arithmetic. No layout or schema dependency. */
import { NormalizeError } from '../../normalize/shared';
import { ownedDocumentCopy } from '../../doc/ownedDocumentCopy';
import { formatAutomaticNumber, NOT_AVAILABLE } from '../../format';
import { defaultSetSpec, formatWithSpec, percentChangeSpec, RULE_SET } from '../../formatSpec';
import { statisticSet } from '../../numberSets';
import { roundHalfUp } from '../../formatPrecision';
import { sumConsistentShares } from '../../shareRounding';
import type { ClaimRecordV1 } from '../../claims/browser';
import type { Category } from '../../types/data';

export interface StackRange { from: string; to: string; label: string }
/** A sum of measures, a percentage (numerator ÷ denominator × 100), or an amount per unit (the sum of `ratio` ÷ `per`). */
type StackMeasure = { sum: string[] } | { numerator: string[]; denominator: string } | { ratio: string[]; per: string };
/** The measures a panel adds up: its sum, its numerator, or the amounts of its per-unit ratio. */
const addedMeasures = (measure: StackMeasure): string[] => 'sum' in measure ? measure.sum : 'ratio' in measure ? measure.ratio : measure.numerator;
export interface MetricStackPanel {
  /** Stack panels have source references instead of child documents and options. */
  data?: never;
  options?: never;
  id: string;
  type: 'column' | 'line';
  title: string;
  unit: string;
  measure: StackMeasure;
  readout: 'change' | { base: string };
  emphasis?: boolean;
  divisor?: number;
  decimals?: number;
  /** Caption over the key of a stacked panel. */
  keyTitle?: string;
  /** The focus look: each segment of the base and the focus columns prints its share of the column. */
  segmentShares?: boolean;
}
export interface MetricStackData {
  categories: Pick<Category, 'id' | 'label' | 'date' | 'partial'>[];
  measures: { id: string; label: string; values: (number | null)[] }[];
  panels: MetricStackPanel[];
  states?: {
    maturing?: { from: string; to: string; panels: string[]; label?: string; footnote?: string };
    partial?: { panels: string[]; footnote?: string };
  };
  windows?: { base: StackRange; compare: StackRange; grain?: 'day' | 'week' | 'month' | 'quarter' | 'year' };
  periods?: StackRange[];
}
export interface MetricStackOptions {
  /** 'focus': the value-first look, with the compare window as the focus. Absent: today's look. */
  variant?: 'focus';
  heights?: number[];
  /** False leaves a seat of the gutter out: `unit`, `headline` or `span`. */
  columnVisibility?: Record<string, boolean>;
  /** Settings of the one gutter track: `gutter`. */
  columnOverrides?: Record<string, { width?: number; align?: 'left' | 'right' | 'center' }>;
  /** Order of the `gutter` and `plot` blocks. */
  columnOrder?: string[];
}
export type StackState = 'mature' | 'maturing' | 'partial';
type StackGrain = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'category';
export interface StackReadout {
  panelId: string;
  method: 'average-change' | 'ratio-change' | 'rounded-rate-change' | 'weighted-rate' | 'to-date';
  grain: StackGrain;
  categoryIds: { base: string[]; compare: string[] } | { mature: string[] } | { partial: string[] };
  headline: number | null;
  before: number | null;
  after: number | null;
  headlineText: string;
  spanText: string;
  partial?: { valueText: string; wording: string };
  claims: ClaimRecordV1[];
}
export interface ComputedStackPanel {
  panel: MetricStackPanel;
  values: (number | null)[];
  /** The source values a panel adds, one row per measure: the segments of a stacked sum. A per-unit panel draws one mark and has none. */
  parts: (number | null)[][];
  states: StackState[];
  readout: StackReadout;
  /** A mark's text: a panel value or a part, before the divisor. */
  format: (value: number) => string;
  /**
   * The focus look of a stacked panel: each measure's share of the compare window, in whole percent that add
   * up to 100, with the id of its claim. Absent without the focus look or on a panel that stacks no measures.
   */
  shares?: { id: string; text: string; claimId: string }[];
  /**
   * The focus look of a stacked panel with `segmentShares`: per category of the base and the compare window,
   * each segment's share of its column in whole percent that add up to 100, with the id of its claim.
   */
  segmentShares?: ({ id: string; text: string; claimId: string }[] | undefined)[];
}
interface ComputedMetricStack {
  panels: ComputedStackPanel[];
  maturing: number[];
  mature: number[];
  partial: number[];
}

export function isMetricStackData(raw: unknown): raw is MetricStackData {
  return raw !== null && typeof raw === 'object' && Object.hasOwn(raw, 'measures') && Object.hasOwn(raw, 'categories');
}
export function stackError(field: string, message: string): never {
  throw new NormalizeError('metric-stack-invalid', field, message, undefined, undefined, field.split('.').map(part => /^\d+$/.test(part) ? Number(part) : part));
}
export function stackRange(data: MetricStackData, range: Pick<StackRange, 'from' | 'to'>, field = 'data'): number[] {
  const from = data.categories.findIndex(c => c.id === range.from);
  const to = data.categories.findIndex(c => c.id === range.to);
  if (from < 0 || to < from) stackError(`${field}.${from < 0 ? 'from' : 'to'}`, `Invalid category range '${range.from}' to '${range.to}'. Valid category ids: ${data.categories.map(c => c.id).join(', ')}`);
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}
/** Infer only explicit period ids. Arbitrary ids remain category-based. */
export function metricStackGrain(data: MetricStackData): StackGrain {
  if (data.windows?.grain) return data.windows.grain;
  const patterns = [
    ['month', /^\d{4}-(0[1-9]|1[0-2])$/],
    ['week', /^(?:\d{4}-)?[wW](0?[1-9]|[1-4]\d|5[0-3])$/],
    ['quarter', /^(?:\d{4}-)?[qQ][1-4]$/],
    ['year', /^\d{4}$/],
  ] as const;
  return patterns.find(([, pattern]) => data.categories.every(c => pattern.test(c.id)))?.[0] ?? 'category';
}
const stackRound = (value: number | null, decimals: number): number | null => value === null ? null : Math.sign(value) * Number(roundHalfUp(Math.abs(value), decimals));
/** One endpoint of a change span: the number it prints, its rounding step in decimals and its text. */
type SpanEnd = { rounded: number; decimals: number; text: string };
/** How a panel prints its marks and its change span. */
interface PanelPrint {
  mark: (value: number) => string;
  /** The printer of the two span endpoints, after the divisor. */
  span: (ends: readonly (number | null)[], suffix: string) => (value: number) => SpanEnd;
}
/**
 * A panel that sets `divisor` or `decimals` prints its marks and span as it always did: at the authored
 * decimals, else 0 for sums and amounts per unit and 1 for rates. A panel with neither is a set of its own under
 * the default number rule: a sum a number set with its parts, an amount per unit a number set of its values, a
 * rate a percent set. The span endpoints are window statistics of that set.
 */
function panelPrint(panel: MetricStackPanel, values: readonly (number | null)[], parts: readonly (readonly (number | null)[])[], locale?: string): PanelPrint {
  const divisor = panel.divisor ?? 1;
  if (panel.decimals !== undefined || panel.divisor !== undefined) {
    const decimals = panel.decimals ?? ('denominator' in panel.measure ? 1 : 0);
    const text = (value: number, suffix = '') => formatAutomaticNumber(value, { automatic: panel.decimals === undefined, decimals, suffix, magnitude: 'none', locale });
    return {
      mark: (value) => text(value / divisor),
      span: (_, suffix) => (value) => { const rounded = stackRound(value, decimals)!; return { rounded, decimals, text: text(rounded, suffix) }; },
    };
  }
  const rate = 'denominator' in panel.measure;
  // An amount per unit is a set of its values only: its source measures are on another scale.
  const members = [...values, ...('sum' in panel.measure ? parts.flat() : [])].filter((value) => value !== null);
  const spec = defaultSetSpec(members, locale, rate ? undefined : panel.unit, rate ? { kind: 'percent' } : {});
  return {
    mark: (value) => formatWithSpec(value, spec),
    span: (ends, suffix) => {
      const set = statisticSet(ends, spec[RULE_SET]!);
      const face = { ...spec, suffix, [RULE_SET]: set };
      return (value) => { const { scale, decimals } = set.groupOf(value); return { rounded: set.rounded(value), decimals: decimals - scale, text: formatWithSpec(value, face) }; };
    },
  };
}
const add = (values: (number | null)[]): number | null => values.some(v => v === null) ? null : values.reduce<number>((a, b) => a + b!, 0);
const rate = (num: number | null, den: number | null): number | null => num === null || den === null || den === 0 ? null : num / den * 100;
const perUnit = (amount: number | null, units: number | null): number | null => amount === null || units === null || units === 0 ? null : amount / units;

/** Shared semantic validation also protects schema-free React callers. */
export function normalizeMetricStack(raw: MetricStackData): MetricStackData {
  const data = ownedDocumentCopy(raw);
  const unique = (ids: string[], field: string) => {
    if (new Set(ids).size !== ids.length) stackError(field, 'Ids must be unique');
  };
  if (!Array.isArray(data.categories) || data.categories.length === 0 || !Array.isArray(data.measures) || data.measures.length === 0
    || !Array.isArray(data.panels) || data.panels.length < 2 || data.panels.length > 5) stackError('data', 'A metric stack needs categories, measures and two to five panels');
  unique(data.categories.map(c => c.id), 'data.categories');
  unique(data.measures.map(m => m.id), 'data.measures');
  unique(data.panels.map(p => p.id), 'data.panels');
  const ids = new Set(data.measures.map(m => m.id));
  const field = (id: string) => { if (!ids.has(id)) stackError('data.panels', `Unknown measure '${id}'`); };
  for (const measure of data.measures) {
    if (measure.values.length !== data.categories.length || measure.values.some(v => v !== null && (!Number.isFinite(v) || v < 0))) {
      stackError('data.measures', `Measure '${measure.id}' needs one non-negative finite value or null per category`);
    }
  }
  const emphasis = data.panels.flatMap((p,i) => p.emphasis ? [i] : []);
  if (emphasis.length > 1) stackError(`data.panels.${emphasis[1]}.emphasis`, `Only one panel may carry emphasis; panels ${emphasis.map(i => `'${data.panels[i]!.id}'`).join(', ')} are emphasised`);
  for (const panel of data.panels) {
    if (panel.type !== 'column' && panel.type !== 'line') stackError('data.panels', 'Stack panels use column or line');
    const fields = addedMeasures(panel.measure);
    if (fields.length === 0) stackError('data.panels', 'A measure expression needs at least one source measure');
    unique(fields, 'data.panels'); fields.forEach(field);
    if ('denominator' in panel.measure) field(panel.measure.denominator);
    if ('per' in panel.measure) field(panel.measure.per);
    if (typeof panel.readout === 'object') {
      field(panel.readout.base);
      if ('per' in panel.measure) stackError('data.panels', `Panel '${panel.id}' computes an amount per unit, which reads its change only; use readout: 'change'`);
      if (!('denominator' in panel.measure)) stackError('data.panels', 'A weighted readout needs a rate measure');
    } else if (panel.readout !== 'change' || !data.windows) stackError('data.windows', 'A change readout needs base and compare windows');
    if (panel.divisor !== undefined && (!Number.isFinite(panel.divisor) || panel.divisor <= 0)) stackError('data.panels', 'divisor must be positive');
    if ('denominator' in panel.measure && panel.divisor !== undefined && panel.divisor !== 1) stackError('data.panels', 'Rate panels are percentages; divisor must be 1');
    if (panel.decimals !== undefined && (!Number.isInteger(panel.decimals) || panel.decimals < 0 || panel.decimals > 6)) stackError('data.panels', 'decimals must be an integer from 0 to 6');
  }
  const validPanels = data.panels.map(p => p.id).join(', ');
  const panelScope = (scope: string[], contiguous: boolean, field: string) => {
    const duplicate = scope.find((id, i) => scope.indexOf(id) !== i);
    if (duplicate) stackError(field, `Duplicate panel '${duplicate}'. Valid panel ids: ${validPanels}`);
    if (!scope.length) stackError(field, `State scope must name existing panels. Valid panel ids: ${validPanels}`);
    const indexes = scope.map((id, i) => {
      const index = data.panels.findIndex(p => p.id === id);
      if (index < 0) stackError(`${field}.${i}`, `Unknown panel '${id}'. Valid panel ids: ${validPanels}`);
      return index;
    }).sort((a,b) => a-b);
    if (contiguous && indexes.some((n,i) => n !== indexes[0]! + i)) {
      stackError(field, `A continuous band needs contiguous panels; scope ${scope.join(', ')} skips a panel. Valid panel ids in order: ${validPanels}`);
    }
  };
  const maturing = data.states?.maturing ? stackRange(data, data.states.maturing, 'data.states.maturing') : [];
  if (data.states?.maturing) panelScope(data.states.maturing.panels, true, 'data.states.maturing.panels');
  if (data.states?.partial) panelScope(data.states.partial.panels, false, 'data.states.partial.panels');
  const partialInBand = maturing.find(i => data.categories[i]!.partial);
  if (partialInBand !== undefined) stackError(`data.categories.${partialInBand}.partial`, `Partial category '${data.categories[partialInBand]!.id}' cannot belong to the maturing band`);
  const mature = data.categories.map((_,i) => i).filter(i => !data.categories[i]!.partial && !maturing.includes(i));
  for (const name of data.windows ? ['base', 'compare'] as const : []) {
    const window = data.windows![name];
    const invalid = stackRange(data, window, `data.windows.${name}`).find(i => !mature.includes(i));
    if (invalid !== undefined) {
      const id = data.categories[invalid]!.id;
      stackError(`data.windows.${name}.${id === window.from ? 'from' : 'to'}`, `Comparison window '${name}' includes non-mature category '${id}'; comparison windows must contain only mature categories`);
    }
  }
  if (data.periods) {
    const coverage = data.periods.flatMap(p => stackRange(data, p));
    if (coverage.length !== data.categories.length || coverage.some((n,i) => n !== i)) stackError('data.periods', 'Periods must cover categories once in order');
  }
  const weighted = data.panels.filter(p => typeof p.readout === 'object');
  if (weighted.length) {
    if (weighted.length !== data.panels.length) stackError('data.panels', 'Use the same readout method throughout a step chain');
    const base = (weighted[0]!.readout as { base: string }).base;
    weighted.forEach((p,i) => {
      const expr = p.measure as { numerator: string[]; denominator: string };
      const prior = i > 0 ? weighted[i-1]!.measure as { numerator: string[] } : undefined;
      if ((p.readout as { base: string }).base !== base || (i === 0 ? expr.denominator !== base : prior!.numerator.length !== 1 || prior!.numerator[0] !== expr.denominator)) {
        stackError('data.panels', 'Step panels must form one chain from the same base measure');
      }
    });
    for (const state of ['maturing', 'partial'] as const) {
      const scope = data.states?.[state]?.panels;
      if (scope && weighted.some(p => !scope.includes(p.id))) {
        stackError(`data.states.${state}.panels`, `Step panels must use the same state scope; missing panels: ${weighted.filter(p => !scope.includes(p.id)).map(p => p.id).join(', ')}. Valid panel ids: ${validPanels}`);
      }
    }
  }
  for (const p of data.panels) if ('denominator' in p.measure) {
    const expr = p.measure;
    const denominator = data.measures.find(m => m.id === expr.denominator)!;
    data.categories.forEach((_,i) => {
      const numerator = add(expr.numerator.map(id => data.measures.find(m => m.id === id)!.values[i]!));
      const den = denominator.values[i]!;
      if (numerator !== null && den !== null && numerator > den) stackError('data.measures', `Panel '${p.id}' numerator exceeds denominator in '${data.categories[i]!.id}'`);
    });
  }
  return data;
}

/** The stack with `window` as its compare window: the focus look's drawing of one focus. */
export function withCompareWindow(data: MetricStackData, window: StackRange): MetricStackData {
  return { ...data, windows: { ...data.windows!, compare: window } };
}

/** `shares`: the focus look, which keys each measure of a stacked panel with its share of the compare window. */
export function computeMetricStack(data: MetricStackData, locale?: string, na = NOT_AVAILABLE, shares = false, partialFocus = false): ComputedMetricStack {
  const grain = metricStackGrain(data);
  const measures = new Map(data.measures.map(m => [m.id, m]));
  const maturing = data.states?.maturing ? stackRange(data, data.states.maturing) : [];
  const partial = data.categories.flatMap((c,i) => c.partial ? [i] : []);
  const mature = data.categories.map((_,i) => i).filter(i => !partial.includes(i) && !maturing.includes(i));
  // The weighted rates of one stack are one percent set across its panels that set neither divisor nor decimals:
  // each headline rate and both chain ends, as received. A chain end of exactly 100 is the base of the chain, no member.
  const windowSum = (ids: string[]) => mature.length ? add(mature.flatMap(i => ids.map(id => measures.get(id)!.values[i]!))) : null;
  const weightedMembers = data.panels.flatMap(panel => {
    if (typeof panel.readout !== 'object' || panel.divisor !== undefined || panel.decimals !== undefined) return [];
    const expr = panel.measure as { numerator: string[]; denominator: string };
    const base = windowSum([panel.readout.base]), denominator = windowSum([expr.denominator]), numerator = windowSum(expr.numerator);
    return [rate(numerator, denominator), rate(denominator, base), rate(numerator, base)].filter((v): v is number => v !== null && v !== 100);
  });
  const weightedSpec = defaultSetSpec(weightedMembers, locale, undefined, { kind: 'percent' });
  const weightedSet = {
    text: (n: number, suffix = '') => formatWithSpec(n, { ...weightedSpec, suffix }),
    rule: weightedSpec[RULE_SET]!,
  };
  const panels = data.panels.map(panel => {
    const expr = panel.measure;
    const fields = addedMeasures(expr);
    const sources = fields.map(id => measures.get(id)!.values);
    const values = data.categories.map((_,i) => {
      const num = add(sources.map(v => v[i]!));
      return 'sum' in expr ? num : 'per' in expr ? perUnit(num, measures.get(expr.per)!.values[i]!) : rate(num, measures.get(expr.denominator)!.values[i]!);
    });
    const parts = 'per' in expr ? [] : sources;
    const states: StackState[] = data.categories.map((c,i) => c.partial ? 'partial' : maturing.includes(i) && data.states!.maturing!.panels.includes(panel.id) ? 'maturing' : 'mature');
    if (data.states?.partial?.panels.includes(panel.id)) partial.forEach(i => { values[i] = null; });
    const print = panelPrint(panel, values, parts, locale);
    const claims: ClaimRecordV1[] = [];
    const make = (key: string, op: string, inputs: ClaimRecordV1['inputs'], raw: number | null, displayed = '') => {
      const claim: ClaimRecordV1 = { id: `stack:${panel.id}:${key}`, kind: 'derived', op, inputs, output: { raw, state: raw === null ? 'missing' : 'value', displayed } };
      claims.push(claim); return claim;
    };
    const ref = (claim: ClaimRecordV1) => ({ ref: claim.id, value: claim.output.raw });
    const sum = (key: string, ids: string[], indexes: number[]) => {
      const inputs = indexes.flatMap(i => ids.map(id => ({ ref: `data.measures[${id}].values[${data.categories[i]!.id}]`, value: measures.get(id)!.values[i]! })));
      return make(key, 'sum@1', inputs.length ? inputs : [{ ref: `${key}:empty-window`, value: null }], indexes.length ? add(inputs.map(i=>i.value)) : null);
    };
    const aggregate = (key: string, indexes: number[]) => {
      const num = sum(`${key}:sum`, fields, indexes);
      if ('sum' in expr) return make(key, 'ratio@1', [ref(num), { ref: `${key}:category-count`, value: indexes.length }], indexes.length ? num.output.raw === null ? null : num.output.raw / indexes.length : null);
      // An amount per unit over a window divides the window sums, never the mean of the category values.
      if ('per' in expr) {
        const units = sum(`${key}:per`, [expr.per], indexes);
        return make(key, 'ratio@1', [ref(num), ref(units)], perUnit(num.output.raw, units.output.raw));
      }
      const den = sum(`${key}:denominator`, [expr.denominator], indexes);
      const raw = make(`${key}:raw`, 'share@1', [ref(num), ref(den)], rate(num.output.raw, den.output.raw));
      return make(key, 'round-decimals@1', [ref(raw), { ref: 'decimals', value: 1 }], stackRound(raw.output.raw, 1));
    };
    let readout: StackReadout;
    let shareTexts: ComputedStackPanel['shares'];
    let segmentTexts: ComputedStackPanel['segmentShares'];
    if (panel.readout === 'change') {
      const baseIndexes = stackRange(data, data.windows!.base), compareIndexes = stackRange(data, data.windows!.compare);
      const base = aggregate('base', baseIndexes), compare = aggregate('compare', compareIndexes);
      const isRate = 'denominator' in expr;
      // A rate's span and change read the received window rates (the `:raw` shares), not their one-decimal roundings.
      const unrounded = (key: string, rounded: ClaimRecordV1) => isRate ? claims.find(c => c.id === `stack:${panel.id}:${key}:raw`)! : rounded;
      const startOperand = unrounded('base', base), endOperand = unrounded('compare', compare);
      // A panel that sets divisor or decimals rounds its headline once, to the digits of its span: the authored decimals, else 1 for a rate, and 0 for a count.
      const authored = panel.divisor !== undefined || panel.decimals !== undefined;
      const a = startOperand.output.raw, b = endOperand.output.raw;
      const change = make('change:raw', isRate ? 'difference@1' : 'percentDelta@1', [ref(endOperand), ref(startOperand)], a === null || b === null || (!isRate && a === 0) ? null : isRate ? b-a : (b/a-1)*100);
      // Otherwise a change in percent or percentage points is a change set of its own: it prints two digits.
      const changeRaw = change.output.raw;
      const changeSpec = changeRaw === null || authored ? undefined : percentChangeSpec([changeRaw], locale, isRate ? 'pp' : '%');
      const changeSet = changeSpec?.[RULE_SET];
      const authoredDecimals = isRate ? panel.decimals ?? 1 : 0;
      const headline = changeRaw === null ? null : changeSet === undefined ? stackRound(changeRaw, authoredDecimals) : changeSet.rounded(changeRaw);
      const headlineText = headline === null ? na : changeSpec === undefined
        ? formatAutomaticNumber(headline, { decimals: authoredDecimals, suffix: isRate ? 'pp' : '%', signed: true, locale, magnitude: 'none' }) : formatWithSpec(changeRaw!, changeSpec);
      make('headline', 'round-decimals@1', [ref(change), { ref: 'decimals', value: changeRaw === null ? 0 : changeSet === undefined ? authoredDecimals : changeSet.groupOf(changeRaw).decimals }], headline, headlineText);
      // The span prints in the marks' unit: divided by the panel divisor.
      const divisor = panel.divisor ?? 1, suffix = isRate ? '%' : '';
      const scaledRaw = (operand: ClaimRecordV1) => operand.output.raw === null ? null : operand.output.raw / divisor;
      const spanEnd = print.span(partialFocus ? [scaledRaw(endOperand)] : [scaledRaw(startOperand), scaledRaw(endOperand)], suffix);
      const endpoint = (key: 'before' | 'after', operand: ClaimRecordV1) => {
        const scaled = divisor === 1 ? operand : make(`${key}:scaled`, 'ratio@1', [ref(operand), { ref: 'divisor', value: divisor }], scaledRaw(operand));
        const printed = scaled.output.raw === null ? undefined : spanEnd(scaled.output.raw);
        return make(key, 'round-decimals@1', [ref(scaled), { ref: 'decimals', value: printed?.decimals ?? panel.decimals ?? 0 }], printed?.rounded ?? null, printed?.text ?? na).output;
      };
      const start = endpoint('before', startOperand), end = endpoint('after', endOperand);
      const before = start.raw, after = end.raw, spanText = `${start.displayed} → ${end.displayed}`;
      // A share divides the window sums: each measure's sum over the compare window by the sum of all of them.
      if (shares && 'sum' in expr && parts.length > 1) {
        const total = claims.find(c => c.id === `stack:${panel.id}:compare:sum`)!;
        const raws = expr.sum.map(id => {
          const part = sum(`share:${id}:sum`, [id], compareIndexes);
          return make(`share:${id}:raw`, 'share@1', [ref(part), ref(total)], rate(part.output.raw, total.output.raw));
        });
        const values = raws.map(raw => raw.output.raw);
        const rounded = values.every(value => value !== null) ? sumConsistentShares(values as number[], locale, undefined, 0) : null;
        shareTexts = expr.sum.map((id, k) => {
          const text = rounded?.texts[k] ?? na;
          const claim = make(`share:${id}`, 'round-sum-consistent@1', [...raws.map(ref), { ref: 'decimals', value: 0 }], rounded?.values[k] ?? null, text);
          return { id, text, claimId: claim.id };
        });
        // A segment share divides one category's part by its column, with the rounding of the key.
        if (panel.segmentShares) {
          segmentTexts = data.categories.map(() => undefined);
          for (const i of new Set([...baseIndexes, ...compareIndexes])) {
            if (expr.sum.some(id => measures.get(id)!.values[i] === null)) continue;
            const at = data.categories[i]!.id;
            const column = sum(`segment:${at}:sum`, expr.sum, [i]);
            const raws = expr.sum.map(id => make(`segment:${at}:${id}:raw`, 'share@1', [ref(sum(`segment:${at}:${id}:sum`, [id], [i])), ref(column)],
              rate(measures.get(id)!.values[i]!, column.output.raw)));
            const values = raws.map(raw => raw.output.raw);
            if (values.some(value => value === null)) continue;
            const rounded = sumConsistentShares(values as number[], locale, undefined, 0);
            if (!rounded) continue;
            segmentTexts[i] = expr.sum.map((id, k) => {
              const claim = make(`segment:${at}:${id}`, 'round-sum-consistent@1', [...raws.map(ref), { ref: 'decimals', value: 0 }], rounded.values[k]!, rounded.texts[k]!);
              return { id, text: claim.output.displayed, claimId: claim.id };
            });
          }
        }
      }
      readout = { panelId: panel.id, method: isRate ? 'rounded-rate-change' : 'per' in expr ? 'ratio-change' : 'average-change', grain, categoryIds: { base: baseIndexes.map(i=>data.categories[i]!.id), compare: compareIndexes.map(i=>data.categories[i]!.id) }, headline, before, after, headlineText, spanText, claims };
    } else {
      const rateExpr = expr as { numerator: string[]; denominator: string };
      const avg = aggregate('rate', mature);
      const base = sum('chain:base', [panel.readout.base], mature);
      const beforeSum = sum('chain:before', [rateExpr.denominator], mature);
      const afterSum = sum('chain:after', fields, mature);
      const chainRate = (operand: ClaimRecordV1) => rate(operand.output.raw, base.output.raw);
      // A panel that sets divisor or decimals prints the readout as it always did: rates rounded to one decimal, 100 whole.
      // A panel with neither prints the received rates through the stack's one weighted-rate set.
      const authored = panel.divisor !== undefined || panel.decimals !== undefined;
      const fixed = (n: number | null, decimals: number, suffix = '') => n === null ? na : formatAutomaticNumber(n, { decimals, suffix, locale, magnitude: 'none' });
      const endpoint = (key: string, operand: ClaimRecordV1) => {
        const raw = make(`${key}:raw`, 'share@1', [ref(operand), ref(base)], chainRate(operand));
        const value = raw.output.raw;
        // The base of the chain, exactly 100, prints whole.
        const own = authored || value === null || value === 100;
        const rounded = own ? (value === 100 ? 100 : stackRound(value, 1)) : weightedSet.rule.rounded(value);
        const decimals = own ? (value === 100 && !authored ? 0 : 1) : Math.max(0, weightedSet.rule.groupOf(value).decimals);
        const text = own ? fixed(rounded, rounded === 100 ? 0 : 1) : weightedSet.text(value);
        return make(key, 'round-decimals@1', [ref(raw), { ref: 'decimals', value: decimals }], rounded, text).output;
      };
      const start = endpoint('before', beforeSum), end = endpoint('after', afterSum);
      const rateRaw = claims.find(c => c.id === `stack:${panel.id}:rate:raw`)!.output.raw;
      const inSet = !authored && rateRaw !== null;
      if (inSet) {
        // The headline states the received rate in the stack's set: its rounding is the set's, not one decimal.
        avg.output.raw = weightedSet.rule.rounded(rateRaw);
        avg.inputs = [avg.inputs[0]!, { ref: 'decimals', value: Math.max(0, weightedSet.rule.groupOf(rateRaw).decimals) }];
      }
      const headline = avg.output.raw, headlineText = inSet ? weightedSet.text(rateRaw, '%') : fixed(headline, 1, '%');
      avg.output.displayed = headlineText;
      readout = { panelId: panel.id, method: 'weighted-rate', grain, categoryIds: { mature: mature.map(i=>data.categories[i]!.id) }, headline, before: start.raw, after: end.raw, headlineText, spanText: `${start.displayed} → ${end.displayed}`, claims };
    }
    return { panel, values, parts, states, readout, format: print.mark, ...(shareTexts ? { shares: shareTexts } : {}), ...(segmentTexts ? { segmentShares: segmentTexts } : {}) };
  });
  return { panels, maturing, mature, partial };
}
