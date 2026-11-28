/**
 * What a set of numbers states to the default number rule (numberRule.ts),
 * read from the declaration only: the unit, the value kind, the role the
 * engine computed, and the chart's language tag (its language, marks and
 * smallValues mode, numberMarks.ts). No rule here reads a printed text or a
 * pattern in a unit text.
 */
import { numberRuleSet, type NumberSet, type PrintFace, type RuleKind, type RuleScale, type RuleSet } from './numberRule';
import { MINUS, splitNumberMarks } from './numberMarks';
import { isMagnitudeLetter } from './format';

const CURRENCY_CODES = new Set(Intl.supportedValuesOf('currency'));

/**
 * A unit that is exactly a currency sign ("$", "US$", "CHF" as a code), "%" or "pp" is no unit text. Every other
 * unit is one, a magnitude letter before a currency sign ("M$", "K€") too: the data are already scaled.
 */
export function isUnitText(unit: string | undefined): boolean {
  if (unit === undefined) return false;
  const text = unit.trim();
  if (text === '' || text === '%' || text === 'pp') return false;
  const sign = /^(\p{Lu}{0,3})\p{Sc}$/u.exec(text);
  if (sign) return isMagnitudeLetter(sign[1]!);
  return !CURRENCY_CODES.has(text);
}

/** A unit that states percent or percentage points. */
export function isPercentUnit(unit: string | undefined): boolean {
  const text = unit?.trim();
  return text === '%' || text === 'pp';
}

export interface SetDeclaration {
  unit?: string;
  kind?: RuleKind;
  /** A table, bar table, cohort, dimension-switch cell or KPI figure. */
  cell?: boolean;
  /** The scale-word decision of the set this set belongs to. */
  words?: boolean;
  /** A scale a unit-only format states. */
  scale?: RuleScale;
  /** Changes in percent, growth rates or differences in percentage points. */
  change?: boolean;
}

/** The set a chart's language tag and a declaration describe. */
export function numberSetOf(locale: string | undefined, declared: SetDeclaration = {}): NumberSet {
  const { language, small } = splitNumberMarks(locale ?? 'en');
  return {
    kind: declared.kind ?? (isPercentUnit(declared.unit) ? 'percent' : 'number'),
    unitText: isUnitText(declared.unit),
    cell: declared.cell ?? false,
    ...(declared.words !== undefined ? { words: declared.words } : {}),
    ...(declared.scale !== undefined ? { scale: declared.scale } : {}),
    ...(declared.change ? { change: true } : {}),
    language,
    ...(small ? { small } : {}),
  };
}

/** The finite numbers of a list. */
export function finiteValues(values: Iterable<number | null | undefined>): number[] {
  const out: number[] = [];
  for (const value of values) if (typeof value === 'number' && Number.isFinite(value)) out.push(value);
  return out;
}

/** The rule over the finite values of one set. */
export function ruleSetOf(values: Iterable<number | null | undefined>, locale: string | undefined, declared: SetDeclaration = {}): RuleSet {
  return numberRuleSet(finiteValues(values), numberSetOf(locale, declared));
}

/** How a text of the chart looks: affixes, sign and the marks its language tag carries. `group: ''` prints no grouping. */
export function printFace(locale: string | undefined, prefix = '', suffix = '', signed = false, group?: string): PrintFace {
  const marks = splitNumberMarks(locale ?? 'en').marks;
  const thousands = group ?? marks?.thousands ?? ',';
  return { prefix, suffix, signed, decimal: marks?.decimal ?? '.', group: thousands === ' ' ? ' ' : thousands, minus: marks?.minusGlyph ?? MINUS };
}

/** One formatter for a set: each value's text by the rule, a value outside the set as a late value. */
export function ruleFormatter(values: Iterable<number | null | undefined>, locale: string | undefined, declared: SetDeclaration = {}, prefix = '', suffix = ''): (value: number, signed?: boolean) => string {
  const rule = ruleSetOf(values, locale, declared);
  const plain = printFace(locale, prefix, suffix, false);
  const signedFace = printFace(locale, prefix, suffix, true);
  return (value, signed = false) => rule.text(value, signed ? signedFace : plain);
}

/**
 * A statistic set (a mean, a median, a band bound, a rate): its own set under
 * the rule, with the scale-word decision, kind and cell of the values it is
 * computed from.
 */
export function statisticSet(values: Iterable<number | null | undefined>, of: RuleSet): RuleSet {
  return numberRuleSet(finiteValues(values), { ...of.set, words: of.words });
}

