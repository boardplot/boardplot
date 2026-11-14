/**
 * The default number rule: how Boardplot prints a number that no authored
 * format covers. One call takes every value of one set (the values that share
 * one format: a chart, a series with its own unit, a table column, a KPI
 * figure) and gives each value its group: a scale word and a decimal count.
 *
 * 1. Scale words (k, M, B, T) only for a set that is no percent and has no
 *    unit text, from a largest value of 10,000 (a table cell or KPI figure:
 *    100,000). German has no short word for thousand.
 * 2. Zero prints as 0.
 * 3. The largest value left opens a group; its band holds the values of at
 *    least a tenth of it.
 * 4. The first group shows three digits of its largest value, but adds no
 *    decimal that no value of that power of ten carries. A later group shows
 *    two digits of its band's smallest value.
 * 5. Close values stay apart: two digits of the band's spread, never more
 *    than three digits of the largest value (two decimals always allowed).
 * 6. No more decimals than the band's values carry.
 * 7. A value joins the group when the format shows its two leading digits or
 *    covers its decimals; every other value waits for a later group.
 *
 * A change set (changes in percent, growth rates, differences in percentage
 * points) prints two digits of its band's smallest value in every group, and
 * rule 5 does not apply: two changes equal at two digits print the same text.
 *
 * No Intl, no clock, no environment. The only module state is a bounded cache
 * of built sets by content, so a set's text depends on its values, the set
 * and the print face (affixes, sign, marks) alone.
 */

export type RuleKind = 'number' | 'percent' | 'share';
export type RuleSmallValues = 'bound' | 'zero' | 'scientific' | 'p-value';
export type RuleScale = 0 | 3 | 6 | 9 | 12;

/** What a set states to the rule. Nothing here is read from a printed text. */
export interface NumberSet {
  kind: RuleKind;
  /** A unit that is no currency sign, no currency code, no % and no pp: no scale words. */
  unitText: boolean;
  /** A table, bar table, cohort, dimension-switch cell or KPI figure: scale words from 100,000. */
  cell: boolean;
  /** The scale-word decision of the set this set belongs to (a statistic, a late value). */
  words?: boolean;
  /** A scale the author stated (a unit-only format such as "$M"): every value prints at it. */
  scale?: RuleScale;
  /** The language of the scale words ('de' drops the short thousand). */
  language: string;
  /** The `smallValues` option while it lives: how a value that needs more than four decimals prints. */
  small?: RuleSmallValues;
  /** A table's width step: each step removes one decimal, then lowers the cell threshold for scale words. */
  fit?: number;
  /** A change set: every group prints two digits of its band's smallest value, and close values may meet. */
  change?: boolean;
}

/** How a text looks: affixes, sign and the chart's marks. The rule reads none of them. */
export interface PrintFace {
  prefix: string;
  suffix: string;
  signed: boolean;
  decimal: string;
  group: string;
  minus: string;
  /** The scale word prints in a head, not in the text (a table moves the scale word into the column head). */
  bare?: boolean;
}

export const DEFAULT_FACE: PrintFace = { prefix: '', suffix: '', signed: false, decimal: '.', group: ',', minus: '−' };

export interface RuleGroup { scale: RuleScale; decimals: number }

/** One set under the rule: every value's group, and the texts that follow from them. */
export interface RuleSet {
  readonly set: NumberSet;
  /** The finite values the set was built from. */
  readonly values: readonly number[];
  /** Whether the set prints scale words (rule 1), for its statistics and its ticks. */
  readonly words: boolean;
  /** The groups in the order the rule opened them. */
  readonly groups: readonly RuleGroup[];
  /** The group of a value of the set, or the group a late value joins. */
  groupOf(value: number): RuleGroup;
  /** The text of `value` under `face`, without the sign: prefix, digits, scale word, suffix. */
  core(value: number, face: PrintFace): string;
  /** The full text of `value` under `face`. */
  text(value: number, face?: PrintFace): string;
  /** The number a reader sees for `value`: rounded at its group. */
  rounded(value: number): number;
}

const WORDS: Record<string, Partial<Record<RuleScale, string>>> = {
  en: { 0: '', 3: 'k', 6: 'M', 9: 'B', 12: 'T' },
  de: { 0: '', 3: ' Tsd.', 6: ' Mio.', 9: ' Mrd.', 12: ' Bio.' },
  fr: { 0: '', 3: 'k', 6: 'M', 9: ' Md', 12: ' Bn' },
};
const SUPERSCRIPT: Record<string, string> = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
/** A value that needs more decimals than this prints as the smallValues mode says. */
const SMALL_DECIMALS = 4;
const P_VALUE_DECIMALS = 3;

const baseLanguage = (language: string): string => language.toLowerCase().split(/[-_]/)[0]!;
/** The word table of a language: German and French have their own, every other language the English one. */
function wordsOf(language: string): Partial<Record<RuleScale, string>> {
  return WORDS[baseLanguage(language)] ?? WORDS.en!;
}
/** German has no short word for thousand: below one million it writes the number out. A stated thousand keeps " Tsd.". */
export const opensThousand = (language: string): boolean => baseLanguage(language) !== 'de';

const clean = (y: number): number => Number(Math.abs(y).toPrecision(12));
/** The decimals a value carries: 0.042 carries 3, 57.5 carries 1, 12 carries 0. */
export function carried(y: number): number {
  const [m = '', e = '0'] = String(clean(y)).split('e');
  return Math.max(0, (m.split('.')[1] ?? '').length - Number(e));
}
/** JavaScript prints at most 100 decimals: a value that needs more prints in scientific form (an engine limit, not a rule). */
const MAX_PRINTED_DECIMALS = 100;
/** `abs` rounded half up at `d` decimals, from its shortest decimal text. */
function round(abs: number, decimals: number): string {
  const d = Math.min(decimals, MAX_PRINTED_DECIMALS);
  const s = String(abs);
  return /e/i.test(s) ? abs.toFixed(d) : (Math.round(Number(`${s}e${d}`)) / 10 ** d).toFixed(d);
}
/** The smallest and the largest of many values, without spreading them into arguments (a 150,000-point line). */
const minOf = (xs: readonly number[]): number => xs.reduce((m, x) => (x < m ? x : m), Infinity);
const maxOf = (xs: readonly number[]): number => xs.reduce((m, x) => (x > m ? x : m), -Infinity);
const groupDigits = (int: string, mark: string): string => int.replace(/\B(?=(\d{3})+(?!\d))/g, mark);
/** The decimals that give y two significant digits, and three. */
export const digits2 = (y: number): number => Math.max(0, 1 - Math.floor(Math.log10(y)));
export const digits3 = (y: number): number => Math.max(0, 2 - Math.floor(Math.log10(y)));

/** The groups of one set, by the default number rule (docs/manual.md, Small values). */
function placeValues(values: readonly number[], set: NumberSet, cellThreshold: boolean): { words: boolean; groups: RuleGroup[]; byAbs: Map<number, RuleGroup>; scaleOf: (a: number) => RuleScale } {
  const thousand = opensThousand(set.language);
  const pct = set.kind === 'percent' || set.kind === 'share';
  const abs = values.map(Math.abs);
  const largest = abs.reduce((m, a) => (a > m ? a : m), 0);
  const useWords = set.words ?? (!pct && !set.unitText && largest >= (cellThreshold ? 100000 : 10000));
  const scaleOf = (a: number): RuleScale => set.scale ?? (!useWords ? 0
    : a >= 1e12 ? 12 : a >= 1e9 ? 9 : a >= 1e6 ? 6 : a >= 1e3 && thousand ? 3 : 0);
  const groups: RuleGroup[] = [];
  const byAbs = new Map<number, RuleGroup>();
  let rest = values.map((_, i) => i).filter((i) => values[i] !== 0).sort((a, b) => abs[b]! - abs[a]!);
  while (rest.length) {
    const top = rest[0]!;
    const s = scaleOf(abs[top]!);
    const y = (i: number) => clean(abs[i]! / 10 ** s);
    const ytop = y(top);
    const band = rest.filter((i) => y(i) >= ytop / 10);
    const first = groups.length === 0 && set.kind !== 'share' && !set.change;
    let d = first ? digits3(ytop) : digits2(minOf(band.map(y)));
    if (first) {
      const power = 10 ** Math.floor(Math.log10(ytop));
      d = Math.min(d, maxOf(band.filter((i) => y(i) >= power).map((i) => carried(y(i)))));
    }
    const scaled = band.map((i) => values[i]! / 10 ** s);
    const spread = maxOf(scaled) - minOf(scaled);
    if (spread > 0 && !set.change) d = Math.max(d, digits2(spread));
    d = Math.min(d, Math.max(2, digits3(ytop)));
    d = Math.min(d, maxOf(band.map((i) => carried(y(i)))));
    const group: RuleGroup = { scale: s, decimals: d };
    const joins = (i: number) => digits2(y(i)) <= d || carried(y(i)) <= d;
    const members = rest.filter((i) => i === top || joins(i));
    for (const i of members) byAbs.set(abs[i]!, group);
    const taken = new Set(members);
    rest = rest.filter((i) => !taken.has(i));
    groups.push(group);
  }
  return { words: useWords, groups, byAbs, scaleOf };
}

/** The steps of a table's width ladder: one per decimal, then one that lowers the cell threshold for scale words where that adds them. */
function fitLadder(values: readonly number[], set: NumberSet): { placed: ReturnType<typeof placeValues>; decimalSteps: number; lowers: boolean } {
  const placed = placeValues(values, set, set.cell);
  const decimalSteps = placed.groups.reduce((m, g) => Math.max(m, g.decimals), 0);
  return { placed, decimalSteps, lowers: set.cell && set.words === undefined && !placed.words };
}

/** The last width step of a set (`fit` past it prints as it does): what a table steps through before it widens a column. */
export function fitSteps(of: RuleSet): number {
  const { decimalSteps, lowers } = fitLadder(of.values, { ...of.set, fit: undefined });
  return decimalSteps + (lowers ? 1 : 0);
}

/**
 * The groups after a table's width step: step n removes n decimals from every group. The step after the last
 * decimal lowers the cell threshold for scale words to 10,000. A group that takes a scale word there prints the
 * rule's decimals at its scale; a group that takes none keeps its decimals removed.
 */
function fitted(values: readonly number[], set: NumberSet): ReturnType<typeof placeValues> {
  const fit = set.fit ?? 0;
  if (fit <= 0) return placeValues(values, set, set.cell);
  const { placed, decimalSteps, lowers } = fitLadder(values, set);
  const lower = fit > decimalSteps && lowers;
  const base = lower ? placeValues(values, set, false) : placed;
  const swap = new Map<RuleGroup, RuleGroup>(base.groups.map((g) => [g, lower && g.scale > 0 ? g : { scale: g.scale, decimals: Math.max(0, g.decimals - fit) }]));
  const byAbs = new Map<number, RuleGroup>();
  // A value that its fitted group rounds to zero gets its own digits, as rule 7 gives them (no nonzero value prints 0).
  const own = new Map<number, RuleGroup>();
  for (const [a, g] of base.byAbs) {
    const short = swap.get(g)!;
    const zero = Number(round(clean(a / 10 ** short.scale), short.decimals)) === 0;
    byAbs.set(a, zero ? own.get(a) ?? own.set(a, placeValues([a], { ...set, words: base.words, fit: undefined }, set.cell).groups[0]!).get(a)! : short);
  }
  return { ...base, groups: [...base.groups.map((g) => swap.get(g)!), ...own.values()], byAbs };
}

/**
 * The rule over one set. `values` are the set's numbers (non-finite values
 * are left out); the result prints any of them, and a late value in the group that shows its leading digits, else as a set of one value.
 */
/**
 * Rule sets by content: a chart's sizing passes ask for the same set again, and a set
 * is a pure function of its values and its declaration. Bounded, so a long session
 * of different charts does not grow it.
 */
const builtSets = new Map<string, { values: readonly number[]; built: RuleSet }>();
let builtValues = 0;
const MAX_BUILT_VALUES = 200_000;
const hashFloat = new Float64Array(1);
const hashWords = new Uint32Array(hashFloat.buffer);

/**
 * Two 32-bit hashes over the bits of the values. Printing every value into the key cost one
 * number-to-text pass per call, which a scatter of 6,000 points paid on each sizing pass.
 */
function valuesKey(values: readonly number[]): string {
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (const value of values) {
    hashFloat[0] = value;
    a = Math.imul(Math.imul(a ^ hashWords[0]!, 0x01000193) ^ hashWords[1]!, 0x01000193);
    b = Math.imul(Math.imul(b ^ hashWords[1]!, 0x5bd1e995) ^ hashWords[0]!, 0x5bd1e995);
    b ^= b >>> 15;
  }
  return `${values.length}:${(a >>> 0).toString(36)}:${(b >>> 0).toString(36)}`;
}

function sameValues(stored: readonly number[], values: readonly number[]): boolean {
  if (stored.length !== values.length) return false;
  for (let index = 0; index < stored.length; index++) {
    const a = stored[index]!, b = values[index]!;
    if (a !== b && !(a !== a && b !== b)) return false;
  }
  return true;
}

export function numberRuleSet(values: readonly number[], set: NumberSet): RuleSet {
  const key = `${set.kind}|${set.unitText ? 1 : 0}|${set.cell ? 1 : 0}|${set.words ?? ''}|${set.scale ?? ''}|${set.language}|${set.small ?? ''}|${set.fit ?? ''}|${set.change ? 1 : 0}|${valuesKey(values)}`;
  // A hash names the content; the stored values confirm it, so equal content alone returns a built set.
  const known = builtSets.get(key);
  if (known && sameValues(known.values, values)) return known.built;
  const built = buildRuleSet(values, set);
  if (builtValues + values.length > MAX_BUILT_VALUES) { builtSets.clear(); builtValues = 0; }
  builtSets.set(key, { values: values.slice(), built });
  builtValues += values.length + 1;
  return built;
}

function buildRuleSet(values: readonly number[], set: NumberSet): RuleSet {
  const finite = values.filter((v) => Number.isFinite(v));
  const { words, groups, byAbs, scaleOf } = fitted(finite, set);
  const lateGroups = new Map<number, RuleGroup>();
  const groupOf = (value: number): RuleGroup => {
    const a = Math.abs(value);
    if (a === 0) return { scale: 0, decimals: 0 };
    const own = byAbs.get(a) ?? lateGroups.get(a);
    if (own) return own;
    // A late value: a group takes it, with its scale word, when it shows the value's two leading digits or decimals.
    const s = scaleOf(a);
    const y = clean(a / 10 ** s);
    let found = groups.find((g) => g.scale === s && (digits2(y) <= g.decimals || carried(y) <= g.decimals));
    // Every other late value prints as a set of one value, with the set's scale-word decision.
    if (!found) found = placeValues([value], { ...set, words, fit: undefined }, set.cell).groups[0]!;
    lateGroups.set(a, found);
    return found;
  };
  return ruleSetFrom(set, finite, words, groups, groupOf);
}

/** `value` rounded at the digits of `group`: the number that group prints. */
export function roundedAt(value: number, { scale, decimals }: RuleGroup): number {
  if (value === 0 || !Number.isFinite(value)) return value;
  return Math.sign(value) * Number(round(clean(value / 10 ** scale), decimals)) * 10 ** scale;
}

/** The printer of a set whose groups are known: what numberRuleSet and a tick set share. */
function ruleSetFrom(set: NumberSet, values: readonly number[], words: boolean, groups: readonly RuleGroup[], groupOf: (value: number) => RuleGroup): RuleSet {
  const wordTable = wordsOf(set.language);
  const smallText = (value: number, group: RuleGroup, face: PrintFace): string | undefined => {
    const beyond = group.decimals > MAX_PRINTED_DECIMALS;
    if ((!set.small && !beyond) || value === 0) return undefined;
    const a = Math.abs(value);
    if (set.small === 'p-value' && value > 0 && value <= 1) {
      // As every automatic p-value prints: three decimals, no leading zero, "<.001" below.
      const r = round(clean(a), P_VALUE_DECIMALS);
      const digits = Number(r) === 0 ? `<${face.decimal}${'0'.repeat(P_VALUE_DECIMALS - 1)}1` : r.replace(/^0(?=\.)/, '').replace('.', face.decimal);
      return `${face.prefix}${digits}${face.suffix}`;
    }
    if (group.decimals <= SMALL_DECIMALS) return undefined;
    // 'p-value' prints a value outside 0 to 1 as 'bound' does.
    if (set.small === 'bound' || set.small === 'zero' || set.small === 'p-value') {
      // A true bound and a true zero: the decimals of the first group, at most four. A value that is nonzero there prints its digits.
      const decimals = smallDecimals();
      if (roundedAt(value, { scale: group.scale, decimals }) !== 0) return (value < 0 ? face.minus : face.signed ? '+' : '') + core(value, face, decimals);
      const zero = `${face.prefix}0${decimals > 0 ? face.decimal + '0'.repeat(decimals) : ''}${face.suffix}`;
      if (set.small === 'zero') return zero;
      const step = decimals > 0 ? `0${face.decimal}${'0'.repeat(decimals - 1)}1` : '1';
      return value > 0 ? `<${face.signed ? '+' : ''}${face.prefix}${step}${face.suffix}` : `>${face.minus}${face.prefix}${step}${face.suffix}`;
    }
    // 10 ** -324 is 0 in JavaScript: a subnormal value scales in two steps.
    const unscaled = (power: number): number => power < -300 ? (a * 1e300) / 10 ** (power + 300) : a / 10 ** power;
    let exponent = Math.floor(Math.log10(a));
    let mantissa = Number(round(clean(unscaled(exponent)), 1));
    if (mantissa >= 10) mantissa = Number(round(clean(unscaled(++exponent)), 1));
    const sci = `${mantissa.toFixed(1).replace('.', face.decimal)} × 10${String(exponent).replace(/[-\d]/g, (c) => SUPERSCRIPT[c]!)}`;
    return `${value < 0 ? face.minus : face.signed ? '+' : ''}${face.prefix}${sci}${face.suffix}`;
  };
  const smallDecimals = (): number => Math.min(groups[0]?.decimals ?? 0, SMALL_DECIMALS);
  const core = (value: number, face: PrintFace, atDecimals?: number): string => {
    if (value === 0) return `${face.prefix}0${face.suffix}`;
    const { scale, decimals: own } = groupOf(value);
    const decimals = atDecimals ?? own;
    const [int = '0', fraction] = round(clean(value / 10 ** scale), decimals).split('.');
    const digits = groupDigits(int, face.group) + (fraction ? face.decimal + fraction : '');
    return `${face.prefix}${digits}${face.bare ? '' : wordTable[scale] ?? ''}${face.suffix}`;
  };
  // Texts by face and value: one set prints the same value for a label, a record and the description.
  const texts = new Map<PrintFace, Map<number, string>>();
  const text = (value: number, face: PrintFace = DEFAULT_FACE): string => {
    let byValue = texts.get(face);
    if (!byValue) texts.set(face, byValue = new Map());
    let printed = byValue.get(value);
    if (printed === undefined) {
      const small = smallText(value, groupOf(value), face);
      printed = small ?? (value < 0 ? face.minus : face.signed && value > 0 ? '+' : '') + core(value, face);
      byValue.set(value, printed);
    }
    return printed;
  };
  // Rounded values, kept like the texts: a chart asks whether a value prints as zero on every sizing pass.
  let roundedValues: Map<number, number> | undefined;
  const rounded = (value: number): number => {
    if (value === 0 || !Number.isFinite(value)) return value;
    let known = (roundedValues ??= new Map()).get(value);
    if (known === undefined) {
      const { scale, decimals } = groupOf(value);
      // Under smallValues 'bound' and 'zero' (and 'p-value' outside 0 to 1) a value that needs more than four decimals
      // rounds at the decimals of the first group, at most four. A bound keeps the value, which is not zero.
      const asBound = set.small === 'bound' || (set.small === 'p-value' && !(value > 0 && value <= 1));
      const small = (asBound || set.small === 'zero') && decimals > SMALL_DECIMALS ? roundedAt(value, { scale, decimals: smallDecimals() }) : undefined;
      known = small === undefined || (small === 0 && asBound) ? roundedAt(value, { scale, decimals }) : small;
      roundedValues.set(value, known);
    }
    return known;
  };
  return { set, values, words, groups, groupOf, core, text, rounded };
}

/**
 * The scale of an axis's ticks: a stated scale, else
 * the scale word that fits the largest tick where the axis set uses words,
 * else none.
 */
export function tickScale(of: RuleSet, largest: number): RuleScale {
  if (of.set.scale !== undefined) return of.set.scale;
  if (!of.words) return 0;
  const a = Math.abs(largest);
  return a >= 1e12 ? 12 : a >= 1e9 ? 9 : a >= 1e6 ? 6 : a >= 1e3 && opensThousand(of.set.language) ? 3 : 0;
}

/** A set that prints every value in one group, with the words of `of` and no smallValues mode: the ticks of an axis. */
export function fixedRuleSet(of: RuleSet, group: RuleGroup): RuleSet {
  // One fixed set per parent set and group: an axis tries several decimal counts on every sizing pass.
  let byGroup = fixedSets.get(of);
  if (!byGroup) fixedSets.set(of, byGroup = new Map());
  const key = `${group.scale}|${group.decimals}`;
  const known = byGroup.get(key);
  if (known) return known;
  const zero: RuleGroup = { scale: 0, decimals: 0 };
  const only: RuleGroup = { scale: group.scale, decimals: group.decimals };
  const fixed = ruleSetFrom({ ...of.set, small: undefined, fit: undefined }, [], of.words, [only], (value) => (value === 0 ? zero : only));
  byGroup.set(key, fixed);
  return fixed;
}
const fixedSets = new WeakMap<RuleSet, Map<string, RuleSet>>();

/** The texts of one set, in input order, and the set's groups. */
export function defaultNumberTexts(values: readonly number[], set: NumberSet, face: PrintFace = DEFAULT_FACE): { texts: string[]; groups: readonly RuleGroup[]; words: boolean; textOf: (value: number) => string } {
  const rule = numberRuleSet(values, set);
  return { texts: values.map((v) => rule.text(v, face)), groups: rule.groups, words: rule.words, textOf: (v) => rule.text(v, face) };
}
