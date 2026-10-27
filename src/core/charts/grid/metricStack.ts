/** Metric-stack source model and arithmetic. No layout or schema dependency. */
import { NormalizeError } from '../../normalize/shared';
import { ownedDocumentCopy } from '../../doc/ownedDocumentCopy';
import { formatAutomaticNumber, NOT_AVAILABLE } from '../../format';
import { roundHalfUp } from '../../formatPrecision';
import type { ClaimRecordV1 } from '../../claims/browser';

interface StackRange { from: string; to: string; label: string }
type StackMeasure = { sum: string[] } | { numerator: string[]; denominator: string };
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
}
export interface MetricStackData {
  categories: { id: string; label: string; partial?: boolean }[];
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
  heights?: number[];
}
export type StackState = 'mature' | 'maturing' | 'partial';
type StackGrain = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'category';
export interface StackReadout {
  panelId: string;
  method: 'average-change' | 'rounded-rate-change' | 'weighted-rate';
  grain: StackGrain;
  categoryIds: { base: string[]; compare: string[] } | { mature: string[] };
  headline: number | null;
  before: number | null;
  after: number | null;
  headlineText: string;
  spanText: string;
  claims: ClaimRecordV1[];
}
export interface ComputedStackPanel {
  panel: MetricStackPanel;
  values: (number | null)[];
  parts: (number | null)[][];
  states: StackState[];
  readout: StackReadout;
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
/** A panel's decimals for its marks and its change span: authored, else 0 for counts and 1 for rates. */
export const panelDecimals = (panel: MetricStackPanel): number => panel.decimals ?? ('sum' in panel.measure ? 0 : 1);
/** A panel value as its marks print it: divided by the panel divisor, at the panel decimals. */
export function formatPanelValue(panel: MetricStackPanel, value: number, locale?: string, suffix = ''): string {
  return formatAutomaticNumber(value / (panel.divisor ?? 1), { automatic: panel.decimals === undefined, decimals: panelDecimals(panel), suffix, magnitude: 'none', locale });
}
const add = (values: (number | null)[]): number | null => values.some(v => v === null) ? null : values.reduce<number>((a, b) => a + b!, 0);
const rate = (num: number | null, den: number | null): number | null => num === null || den === null || den === 0 ? null : num / den * 100;

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
      stackError('data.measures', `Measure '${measure.id}' needs one non-negative finite count or null per category`);
    }
  }
  const emphasis = data.panels.flatMap((p,i) => p.emphasis ? [i] : []);
  if (emphasis.length > 1) stackError(`data.panels.${emphasis[1]}.emphasis`, `Only one panel may carry emphasis; panels ${emphasis.map(i => `'${data.panels[i]!.id}'`).join(', ')} are emphasised`);
  for (const panel of data.panels) {
    if (panel.type !== 'column' && panel.type !== 'line') stackError('data.panels', 'Stack panels use column or line');
    const fields = 'sum' in panel.measure ? panel.measure.sum : panel.measure.numerator;
    if (fields.length === 0) stackError('data.panels', 'A measure expression needs at least one source measure');
    unique(fields, 'data.panels'); fields.forEach(field);
    if ('denominator' in panel.measure) field(panel.measure.denominator);
    if (typeof panel.readout === 'object') {
      field(panel.readout.base);
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

export function computeMetricStack(data: MetricStackData, locale?: string, na = NOT_AVAILABLE): ComputedMetricStack {
  const grain = metricStackGrain(data);
  const measures = new Map(data.measures.map(m => [m.id, m]));
  const maturing = data.states?.maturing ? stackRange(data, data.states.maturing) : [];
  const partial = data.categories.flatMap((c,i) => c.partial ? [i] : []);
  const mature = data.categories.map((_,i) => i).filter(i => !partial.includes(i) && !maturing.includes(i));
  const format = (n: number | null, decimals: number, suffix = '', signed = false) => n === null ? na : formatAutomaticNumber(n, { decimals, suffix, signed, locale, magnitude: 'none' });
  const panels = data.panels.map(panel => {
    const expr = panel.measure;
    const fields = 'sum' in expr ? expr.sum : expr.numerator;
    const parts = fields.map(id => measures.get(id)!.values);
    const values = data.categories.map((_,i) => {
      const num = add(parts.map(v => v[i]!));
      return 'sum' in expr ? num : rate(num, measures.get(expr.denominator)!.values[i]!);
    });
    const states: StackState[] = data.categories.map((c,i) => c.partial ? 'partial' : maturing.includes(i) && data.states!.maturing!.panels.includes(panel.id) ? 'maturing' : 'mature');
    if (data.states?.partial?.panels.includes(panel.id)) partial.forEach(i => { values[i] = null; });
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
      const den = sum(`${key}:denominator`, [expr.denominator], indexes);
      const raw = make(`${key}:raw`, 'share@1', [ref(num), ref(den)], rate(num.output.raw, den.output.raw));
      return make(key, 'round-decimals@1', [ref(raw), { ref: 'decimals', value: 1 }], stackRound(raw.output.raw, 1));
    };
    let readout: StackReadout;
    if (panel.readout === 'change') {
      const baseIndexes = stackRange(data, data.windows!.base), compareIndexes = stackRange(data, data.windows!.compare);
      const base = aggregate('base', baseIndexes), compare = aggregate('compare', compareIndexes);
      const a = base.output.raw, b = compare.output.raw;
      const isRate = 'denominator' in expr;
      const change = make('change:raw', isRate ? 'difference@1' : 'percentDelta@1', [ref(compare), ref(base)], a === null || b === null || (!isRate && a === 0) ? null : isRate ? b-a : (b/a-1)*100);
      const headline = stackRound(change.output.raw, isRate ? 1 : 0);
      const headlineText = format(headline, isRate ? 1 : 0, isRate ? 'pp' : '%', true);
      make('headline', 'round-decimals@1', [ref(change), { ref: 'decimals', value: isRate ? 1 : 0 }], headline, headlineText);
      // The span prints in the marks' unit: divided by the panel divisor, at the panel decimals.
      const decimals = panelDecimals(panel), divisor = panel.divisor ?? 1, suffix = isRate ? '%' : '';
      const endpoint = (key: 'before' | 'after', operand: ClaimRecordV1) => {
        const scaled = divisor === 1 ? operand : make(`${key}:scaled`, 'ratio@1', [ref(operand), { ref: 'divisor', value: divisor }], operand.output.raw === null ? null : operand.output.raw / divisor);
        const rounded = stackRound(scaled.output.raw, decimals);
        return make(key, 'round-decimals@1', [ref(scaled), { ref: 'decimals', value: decimals }], rounded, rounded === null ? na : formatPanelValue({ ...panel, divisor: 1 }, rounded, locale, suffix)).output;
      };
      // A rate span rounds once, from the unrounded window rate (the `:raw` share), not from the 1-decimal headline input.
      const unrounded = (key: string, rounded: ClaimRecordV1) => isRate ? claims.find(c => c.id === `stack:${panel.id}:${key}:raw`)! : rounded;
      const start = endpoint('before', unrounded('base', base)), end = endpoint('after', unrounded('compare', compare));
      const before = start.raw, after = end.raw, spanText = `${start.displayed} → ${end.displayed}`;
      readout = { panelId: panel.id, method: isRate ? 'rounded-rate-change' : 'average-change', grain, categoryIds: { base: baseIndexes.map(i=>data.categories[i]!.id), compare: compareIndexes.map(i=>data.categories[i]!.id) }, headline, before, after, headlineText, spanText, claims };
    } else {
      const rateExpr = expr as { numerator: string[]; denominator: string };
      const avg = aggregate('rate', mature);
      const base = sum('chain:base', [panel.readout.base], mature);
      const beforeSum = sum('chain:before', [rateExpr.denominator], mature);
      const afterSum = sum('chain:after', fields, mature);
      const endpoint = (key: string, operand: ClaimRecordV1) => {
        const raw = make(`${key}:raw`, 'share@1', [ref(operand), ref(base)], rate(operand.output.raw, base.output.raw));
        const rounded = stackRound(raw.output.raw, 1);
        return make(key, 'round-decimals@1', [ref(raw), { ref: 'decimals', value: 1 }], rounded, format(rounded, rounded === 100 ? 0 : 1));
      };
      const before = endpoint('before', beforeSum).output.raw, after = endpoint('after', afterSum).output.raw;
      const headline = avg.output.raw, headlineText = format(headline, 1, '%');
      avg.output.displayed = headlineText;
      readout = { panelId: panel.id, method: 'weighted-rate', grain, categoryIds: { mature: mature.map(i=>data.categories[i]!.id) }, headline, before, after, headlineText, spanText: `${format(before, before === 100 ? 0 : 1)} → ${format(after, after === 100 ? 0 : 1)}`, claims };
    }
    return { panel, values, parts, states, readout };
  });
  return { panels, maturing, mature, partial };
}
