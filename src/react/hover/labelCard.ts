import { chartString } from '../../core/strings/hover';
import { joinSentences, localeStrings } from '../../core/strings';
import { exampleSpec, formatWithSpec, MAGNITUDE_DIVISOR, parseFormatExample, roundedNumber, unitMagnitude, type NumberFormatSpec } from '../../core/formatSpec';
import { magnitudeSuffix } from '../../core/format';
import { boxGap, rectCenter, rectContains, type Point, type Rect } from '../../core/geometry';
import { ownerContains } from '../../core/a11y/recordsShared';
import type { SlotCandidate } from '../../core/label/solver';
import { fitText, lineBox } from '../../core/label/fitText';
import { defaultMeasurer, graphemes, type FontSpec, type TextMeasurer } from '../../core/text';
import { resolveSurface, strokeToken } from '../../core/theme';
import { mixColors, parseColor, relativeLuminance } from '../../core/color';
import { composedTextRole } from '../../core/textRole';
import { eventHeading, eventReading } from '../../core/eventReading';
import type { Geometry, OccupiedRect, Paint, PlaceDecision, SceneNode, TextRole } from '../../core/types/scene';
import type { Theme } from '../../core/types/theme';
import type { InteractionComparison, InteractionRecord, InteractionValue } from '../../core/a11y/types';
import { decimalPrecision, deltaValueText, displayedValueText, formattedValueText, shownValueText, signedPercentText } from '../../core/a11y/valueText';
import { maxOf, pushAll } from '../../core/arrays';

/**
 * The hover label card: the record's own facts, next to the hovered mark.
 * The card is transient and paints its own opaque background, so it may
 * cover neighbouring marks and labels when there is no free side. The
 * viewport bounds the card. The chart frame does not constrain its size.
 * All inputs use one coordinate space, at one CSS pixel per layout unit.
 */

export interface LabelCardRow {
  /** 'more' is the card's own row counting what the frame's height left out. */
  kind: 'title' | 'value' | 'field' | 'comparison' | 'share' | 'total' | 'rank' | 'annotation' | 'more';
  text: string;
  /** Separate drawn cells. `text` keeps the complete accessible reading. */
  label?: string;
  value?: string;
  series?: boolean;
  pointed?: boolean;
  swatch?: Paint;
  /** Original source facts, never rounded display numbers. Withheld values are removed. */
  values?: InteractionValue[];
  /** A stack part's share of its category, drawn as a column after the value. */
  share?: string;
  /** Prose may wrap; names use one line. */
  lines?: number;
}

/** One CSS-pixel rhythm for both hover cards, independent of chart density. */
export const CARD_SPACE = { x: 10, y: 8, group: 6, column: 12 };

export function cardFont(theme: Theme, size = 12, weight = 400): FontSpec {
  return { family: theme.type.family, size, weight, lineHeight: 1.35, tabular: true };
}

/** Derive the raised surface from the existing palette. Flat themes keep their radius. */
export function cardSurface(theme: Theme): { fill: string; radius: number; flat: boolean } {
  const radius = resolveSurface(theme).chipRadius;
  const flat = radius === 0 || theme.name.startsWith('notation');
  const background = parseColor(theme.color.background);
  const ink = parseColor(theme.color.ink);
  const dark = background && ink && relativeLuminance(background) < relativeLuminance(ink);
  return { fill: dark ? mixColors(theme.color.background, theme.color.ink, 0.94) : theme.color.background,
    radius: flat ? radius : 6, flat };
}
export interface LabelCardContent {
  rows: LabelCardRow[];
  accessibleText: string;
  /** The widest the card may be, in px, when its words need a measure of their own (an event's detail). */
  maxWidth?: number;
}

/** How the card words the record's facts. The facts themselves are the record's. */
export interface LabelCardOptions {
  /**
   * The chart draws every category as 100 %. The share is then the segment's
   * own percentage and the base is the axis, so the card prints no base. The
   * record keeps the category total in the data's unit either way.
   */
  hundredPercent?: boolean;
  /** The card's title: the hovered category's period (`cardTitle`). Absent: the record's own heading. */
  title?: string;
  /** The value's name where the record names none (`metricName`). */
  name?: string;
  /** The key's order of the series a card with several records lists: the records' order in the chart. */
  order?: ReadonlyMap<InteractionRecord, number>;
  /** A funnel's word for its stage conversion, as its labels print the rate. */
  conversionName?: string;
  /** The series that stand in a stack (`stackKey`): a missing value of one stands among the parts. */
  stackSeries?: ReadonlySet<string>;
  /** Whether each grid panel draws a 100 % composition, by path; a panel not listed takes `hundredPercent`. */
  panelHundred?: ReadonlyMap<string, boolean>;
  /** A grid's panel titles by path: they name a row whose series name another panel's row repeats. */
  panelNames?: ReadonlyMap<string, string>;
  panelLocales?: ReadonlyMap<string, string>;
}

/** The options that say a chart draws its categories as 100 %. */
export interface CompositionOptions {
  variant?: string;
  valueAxis?: { percent?: boolean };
}

/**
 * The keys of a chart's options the test below reads, for a panel that has
 * to carry them into a prepared snapshot. Only what can change the answer:
 * a variant that IS a 100 % composition, a mekko's variant (a mekko with none
 * is a stacked100 mekko), and `valueAxis.percent` where it is on.
 */
export function compositionOptions(type: string, options?: unknown): CompositionOptions | undefined {
  const source = options as CompositionOptions | undefined;
  const projected: CompositionOptions = {};
  if (source?.variant === 'stacked100' || source?.variant === 'stacked100-area') projected.variant = source.variant;
  if (type === 'mekko' && typeof source?.variant === 'string') projected.variant = source.variant;
  if (source?.valueAxis?.percent === true) projected.valueAxis = { percent: true };
  return Object.keys(projected).length ? projected : undefined;
}

/** Charts whose categories are drawn as 100 %, read from the request the chart was laid out from. */
export function hundredPercentComposition(type: string, options?: CompositionOptions): boolean {
  // A column and a line PROMOTE `valueAxis.percent` to their
  // 100 % variant while they lay out, so the authored options still say
  // 'grouped' or 'line' (`charts/column/domain.ts`, `charts/line/domain.ts`).
  // A stacked100 mekko, which is its default, normalises every column;
  // `valueAxis.percent` promotes an authored stacked variant to stacked100 as well
  // (`charts/mekko/domain.ts`, the same promotion).
  return options?.variant === 'stacked100' || options?.variant === 'stacked100-area'
    || ((type === 'column' || type === 'line' || type === 'mekko') && options?.valueAxis?.percent === true)
    || (type === 'mekko' && (options?.variant ?? 'stacked100') === 'stacked100');
}
export interface LabelCardInput {
  record: InteractionRecord;
  plot?: Rect;
  canvas: Rect;
  /** The engine identifies filled marks from their scene nodes. Thin marks cost zero. */
  occupied: readonly (OccupiedRect & { filled?: boolean })[];
  target?: Rect;
  /** Active labels, sibling marks or row cells with a high overlap cost. */
  forbidden?: readonly Rect[];
  tableBounds?: Rect;
  /** Explicit boundary, including a zero-sized viewport. Canvas is the legacy fallback. */
  boundary?: Rect;
  /** The chart in the boundary's units: the frame of a record scrolled out of the viewport. Canvas is the fallback. */
  chart?: Rect;
  pointer?: Point;
  /** The card follows `pointer` (`followSeat`); the seat solver beside the mark does not run. */
  follow?: boolean;
  previousSide?: CardSide;
  band?: 'x' | 'y';
  /**
   * On a chart that picks its record by the pointer's position along an axis,
   * the convex hull of its points: the area the pointer crosses on its way
   * from one point to another. A seat keeps `PATH_PAD` clear of it.
   */
  path?: readonly Point[];
  /** The pointed record's own mark, where `target` spans its whole category: a seat off `path` stays within `CLEAR_REACH` of it. */
  mark?: Rect;
  /** Prefer clear table space; reading order breaks equal costs. */
  slots?: 'table';
  direction?: 'ltr' | 'rtl';
  theme: Theme;
  measure?: TextMeasurer;
  locale?: string;
  idPrefix?: string;
  /** Wording options; `layoutLabelCard` hands them to the content builder. */
  card?: LabelCardOptions;
}
export type CardSide = 'right' | 'left' | 'above' | 'below';
export interface LabelCardLayout extends LabelCardContent {
  /** Beside the mark on a free side, beside it over the content, (with no mark) in free space in the frame, or at the pointer. */
  placement: 'beside' | 'frame' | 'overlay' | 'pointer';
  rect: Rect;
  scene: SceneNode[];
  decisions: PlaceDecision[];
  side?: CardSide;
  /** The seat meets the points' path (`LabelCardInput.path`): the card lets the pointer through to the points under it. */
  overPath?: boolean;
}

export type LabelCardGeometry = Pick<Geometry, 'type' | 'size' | 'scene' | 'legend' | 'a11y' | 'sizing' | 'mode'>;

/** Crop an already measured card scene to its own rectangle for standalone rendering. */
export function labelCardGeometry(layout: LabelCardLayout): LabelCardGeometry {
  const { x, y, w, h } = layout.rect;
  return {
    type: 'interaction-card',
    size: { width: w, height: h },
    scene: layout.scene.map(node => ({
      ...node,
      tx: (node.tx ?? 0) - x,
      ty: (node.ty ?? 0) - y,
    })),
    a11y: { title: layout.rows[0]?.text ?? 'Details', desc: layout.accessibleText },
  };
}

function safeValue(value: InteractionValue, locale?: string): InteractionValue {
  if (value.state === 'suppressed') return { kind: value.kind, raw: null, state: 'suppressed', reason: chartString({ locale: { language: locale } }, 'valueWithheld') };
  return { ...value };
}

/**
 * Render one comparison as the card's comparison row: the change and its
 * percent as the chart draws them (their shown texts), else the change through
 * the value's format, the percent as a change set of one value. A comparison that
 * cannot be made (another axis, no reference value) has no row; the
 * record keeps it with its reason. `reference` is the name the card gives the
 * reference elsewhere, so a reference without a label reads one way throughout.
 */
function comparisonRow(comparison: InteractionComparison, locale?: string, reference?: string): LabelCardRow | undefined {
  const values = [comparison.current, comparison.reference, comparison.delta, comparison.percent];
  const withheld = values.some(value => value.state === 'suppressed');
  if (!withheld && comparison.delta.state === 'unavailable') return undefined;
  const precision = Math.max(decimalPrecision(comparison.current.raw), decimalPrecision(comparison.reference.raw));
  const name = comparison.labelKind === 'reference' ? comparison.label : reference ?? comparison.scenario ?? comparison.label;
  const label = comparison.labelKind === 'complete' ? `${comparison.label}:` : chartString({ locale }, 'comparisonLabel', { label: name });
  const value = withheld ? chartString({ locale: { language: locale } }, 'valueWithheld')
    : `${deltaValueText(comparison.delta, precision, locale)} (${signedPercentText(comparison.percent, locale)})`;
  return { kind: 'comparison', label, value: shortUnit(value, comparison.delta, locale), text: `${label} ${value}`,
  values: withheld ? [] : values.map(value => safeValue(value, locale)) };
}

/** What the card prints for a value that is not there: a dash, never the engine's reason. */
const NO_VALUE = '–';

/** A value as the card prints it: its shown text or format, a dash where there is no observation. */
function cardValueText(value: InteractionValue, locale?: string): string {
  return value.state === 'missing' || value.state === 'unavailable' ? NO_VALUE : displayedValueText(value, locale);
}

/**
 * The reference's name, one in every row: its authored label, else the
 * scenario code the chart's key and labels print ("PL"), never its raw id.
 */
function referenceName(record: InteractionRecord): string | undefined {
  const comparison = record.comparisons[0];
  const field = record.fields.find(entry => entry.key === 'reference')?.label;
  if (comparison && comparison.labelKind === undefined && comparison.scenario) return comparison.scenario;
  return field;
}

/**
 * A number through one card format: the format's text, or its bound ("<$1k",
 * "<0.1%") where the format prints a nonzero value as zero.
 */
function specText(raw: number, spec: NumberFormatSpec): string {
  const text = formatWithSpec(raw, spec);
  // Zero's own text, signs aside: a unit's digits ("t CO2") do not make a number nonzero.
  const unsigned = (printed: string) => printed.replace(/[-−+()]/gu, '');
  if (raw === 0 || unsigned(text) !== unsigned(formatWithSpec(0, spec))) return text;
  const step = 10 ** -spec.decimals * MAGNITUDE_DIVISOR[spec.magnitude];
  return `${raw > 0 ? '<' : '>'}${formatWithSpec(Math.sign(raw) * step, spec)}`;
}

/** The share column's format where no share is drawn: one decimal, as the chart prints a share. */
const SHARE_EXAMPLE = '12.3%';

/**
 * One number format for every row of a card: the drawn text of its largest
 * value in that unit, as the chart's labels print the set. A value with a
 * format of its own prints through it. So a sliver beside "$5k" reads "<$1k"
 * and not "$0.43", and the total prints as the parts do.
 */
function cardFormat(values: readonly InteractionValue[], locale?: string): (value: InteractionValue) => string {
  const numeric = (value: InteractionValue) => value.state === 'value' && typeof value.raw === 'number' && value.derived !== 'percent';
  // Values in one authored format, or in one unit without a format, share a card format.
  const keyOf = (value: InteractionValue) => value.format ? `format\u0000${value.format}\u0000${value.unit ?? ''}` : `unit\u0000${value.unit ?? ''}`;
  const specs = new Map<string, NumberFormatSpec | null>();
  const specFor = (value: InteractionValue): NumberFormatSpec | null => {
    const key = keyOf(value);
    let spec = specs.get(key);
    if (spec === undefined) {
      let largest: { raw: number; text: string } | undefined;
      for (const other of values) {
        const text = numeric(other) && keyOf(other) === key ? shownValueText(other) : undefined;
        if (text !== undefined && (!largest || Math.abs(other.raw as number) > Math.abs(largest.raw))) largest = { raw: other.raw as number, text };
      }
      spec = largest ? exampleFormat(largest.text, locale, value.unit) : value.format ? exampleFormat(value.format, locale, value.unit) : null;
      // A format that does not print its own example back (a unit that holds the scale, "$m") is no card format.
      if (spec && largest && specText(largest.raw, spec) !== largest.text) spec = null;
      specs.set(key, spec);
    }
    return spec;
  };
  return value => {
    const spec = numeric(value) ? specFor(value) : null;
    return spec ? specText(value.raw as number, spec) : cardValueText(value, locale);
  };
}

/**
 * A card format from a printed example. It rounds a sliver to the bound
 * ("<$1k") instead of lifting its decimals ("$0.04k"). A free-form unit the
 * example parser refuses ("USD (est") gives no card format.
 */
function exampleFormat(example: string, locale: string | undefined, unit: string | undefined): NumberFormatSpec | null {
  try {
    const { nonzero: _lifted, ...spec } = exampleSpec(example, locale, unit);
    return { ...spec, rollMagnitude: false };
  } catch {
    return null;
  }
}

/** The shares of a card in one format: a drawn share's, else the shares' format, else one decimal. */
function shareFormat(percents: readonly InteractionValue[], locale?: string): (percent: InteractionValue) => string {
  const drawn = percents.find(percent => percent.displayed && shownValueText(percent) !== undefined);
  const example = drawn ? drawn.displayed!.trim() : percents.find(percent => percent.format)?.format ?? SHARE_EXAMPLE;
  const spec = exampleFormat(example, locale, '%');
  return percent => percent.state === 'value' && typeof percent.raw === 'number'
    ? drawn?.displayed && percent.displayed ? displayedValueText(percent, locale) : spec ? specText(percent.raw, spec) : cardValueText(percent, locale)
    : cardValueText(percent, locale);
}

/** A heading that names the category says its date already, unless the heading is a bare id that is not the date. */
function headingNamesDate(record: InteractionRecord, date: InteractionValue): boolean {
  const { categoryLabel } = record;
  return categoryLabel !== undefined && (categoryLabel !== record.target.owner.categoryId || categoryLabel === date.raw);
}

function fieldRow(field: InteractionRecord['fields'][number], locale?: string): LabelCardRow {
  const label = `${field.label}:`;
  const value = cardValueText(field.value, locale);
  return { kind: 'field', label, value: shortUnit(value, field.value, locale), text: `${label} ${value}`, values: [safeValue(field.value, locale)] };
}

/** A scale word that opens a unit ("thousand per month"), and the scale it names. */
const SCALE_WORD = /^(thousand|million|billion|trillion|tausend|millionen|milliarden|billionen)s?(?![\p{L}\p{N}])/iu;
const SCALE_MAGNITUDE: Record<string, 'k' | 'm' | 'bn' | 't'> = {
  thousand: 'k', million: 'm', billion: 'bn', trillion: 't', tausend: 'k', millionen: 'm', milliarden: 'bn', billionen: 't',
};

/**
 * The card's number with a unit caption as the chart prints a number: a
 * scale word that opens the unit becomes the chart language's short scale
 * on the number ("1.8 thousand per month" reads "1.8k per month", German
 * "1,8 Tsd. pro Monat"), and a percent sign joins the number ("13.1% of
 * enquiries"). Only a bare number before the unit changes; the precision
 * stays. The spoken reading keeps the words: a screen reader says "1.8
 * thousand" well and "1.8k" badly.
 */
function shortUnit(text: string, value: InteractionValue, locale?: string): string {
  const unit = value.unit?.trim();
  if (!unit || value.state !== 'value') return text;
  // A currency sign or code may stand in front of the scale word ("$ billion", "€ million").
  const sign = /^(?:\p{Sc}|[A-Z]{3})[\s\u00a0]?/u.exec(unit)?.[0] ?? '';
  const word = SCALE_WORD.exec(unit.slice(sign.length));
  if (!word && !(unit.startsWith('%') && unit.length > 1)) return text;
  const tail = word ? unit.slice(sign.length) : unit;
  let short = unit;
  if (word) {
    const magnitude = SCALE_MAGNITUDE[word[1]!.toLocaleLowerCase()]!;
    const suffix = /^de\b/i.test(locale ?? '') && magnitude === 'k' ? ' Tsd.' : magnitudeSuffix(magnitude, locale);
    const rest = tail.slice(word[0].length).trim();
    short = `${suffix.replace(/^ /, '\u00a0')}${rest ? ` ${rest}` : ''}`;
  }
  // After every number of the row: the value, a total, a change ("−10 thousand orders (−9.1%)").
  const escaped = tail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(\\d)[\\s\\u00a0\\u202f]+${escaped}(?![\\p{L}\\p{N}])`, 'gu'), (_match, digit: string) => `${digit}${short}`);
}

/** A word in a unit: four or more letters, lower case after the first ("orders", "Fälle"). "kg", "ms", "USD" and "kWh" hold none. */
const UNIT_WORD = /(?<!\p{L})\p{L}\p{Ll}{3,}(?!\p{L})/u;

/**
 * A unit that is a phrase in words ("cases per month", "orders") names the
 * number on the hover card. A sign, a code or a scale stays with the number:
 * "$", "%", "pp", "kg", "ms", "USD", "EUR k", "$bn", "k orders" and
 * "thousand per month" (the scale belongs to the number), "$ per share" (the
 * sign goes in front of the number), "% of started cases" (the percent sign
 * joins the number: "92% of started cases").
 */
export function unitPhrase(unit: string | undefined): boolean {
  const text = unit?.trim();
  return Boolean(text) && !/^[\p{Sc}%]/u.test(text!) && unitMagnitude(text) === undefined && !SCALE_FIRST.test(text!) && UNIT_WORD.test(text!);
}

/** A unit that opens with a scale ("thousand per month", "M users"): the number is in that scale, so the unit stays on it. */
const SCALE_FIRST = /^(?:M|(?:k|mn|bn?|tn|tsd|mio|mrd|bio|thousands?|tausend|millions?|millionen|billions?|billionen|trillions?|milliard(?:en?|s)?)\.?)(?:\s|$)/iu;

/** A unit phrase the row's name already says ("Visits" in visits) leaves the number: "Visits: 122k". */
function namedNumber(name: string, text: string, unit: string | undefined): string {
  const phrase = unit?.trim();
  if (!phrase || !unitPhrase(phrase) || !text.endsWith(phrase) || !name.toLocaleLowerCase().includes(phrase.toLocaleLowerCase())) return text;
  return text.slice(0, -phrase.length).replace(/[\s\u00a0\u202f]+$/u, '') || text;
}

/** The value row's name and number, and the heading above it. */
interface ValueName { heading: string; name?: string; value: string }

/** Names that say the same: a row whose name is the card's title prints the number alone. */
function sameName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}

/**
 * Name the number: the record's statistic ("Median"), else the metric's own
 * name (the series, a panel's title, a sparkline's label) with the category
 * alone as the heading ("Jan 26", "North: 65.8"), else the chart's metric
 * (`name`: a sparkline's measure, a funnel's series), else a unit phrase,
 * printed once in front ("Cases per month: 800"). A spec that names nothing prints the bare number, and so does a
 * name that repeats the heading. The number keeps its format; only a phrase
 * that moves in front leaves its end.
 */
function valueName(record: InteractionRecord, locale?: string, options?: LabelCardOptions): ValueName {
  const value = cardValueText(record.value, locale);
  const named = (heading: string, name?: string, number = value): ValueName =>
    name !== undefined && !sameName(name, heading) ? { heading, name, value: number } : { heading, value: number };
  if (record.valueLabel) return named(options?.title ?? record.label, record.valueLabel);
  if (record.seriesLabel) return named(options?.title ?? record.categoryLabel ?? record.label, record.seriesLabel, namedNumber(record.seriesLabel, value, record.value.unit));
  const heading = options?.title ?? record.label;
  if (options?.name !== undefined && !sameName(options.name, heading)) return named(heading, options.name, namedNumber(options.name, value, record.value.unit));
  const unit = record.value.unit?.trim();
  if (unit && unitPhrase(unit) && value.endsWith(unit)) {
    const number = value.slice(0, -unit.length).replace(/[\s  ]+$/u, '');
    if (number) return named(heading, unit.replace(/^\p{L}/u, letter => letter.toUpperCase()), number);
  }
  return named(heading, options?.name);
}

/**
 * A row's text without the name the card puts in front: the statistic's name
 * and the number with its unit, as a row of a card with several series prints
 * it after the series name. A field row or an event's row keeps its own text.
 */
function unnamedText(row: LabelCardRow, record: InteractionRecord, locale?: string): string {
  if (row.kind !== 'value' || record.event || record.cardFields) return row.text;
  return `${record.valueLabel ? `${record.valueLabel}: ` : ''}${cardValueText(record.value, locale)}`;
}

function cardContent(rows: LabelCardRow[]): LabelCardContent {
  return { rows, accessibleText: joinSentences(rows.map(row => row.text)) };
}

/** Two numbers of one record that say the same. */
function sameNumber(a: InteractionValue, b: InteractionValue): boolean {
  return a.state === 'value' && b.state === 'value' && typeof a.raw === 'number' && a.raw === b.raw;
}

/**
 * A record that names no series and no statistic whose number a field or a
 * comparison repeats (a variance's Actual, its change): the card prints the
 * named row and no headline.
 */
function repeatedHeadline(record: InteractionRecord): boolean {
  if (record.seriesLabel || record.valueLabel) return false;
  const current = record.fields.find(field => field.key === 'current');
  if (!current) return false;
  return sameNumber(current.value, record.value)
    || record.comparisons.some(comparison => sameNumber(comparison.delta, record.value) || sameNumber(comparison.percent, record.value));
}

function cardLocale(record: InteractionRecord, locale: string | undefined, options: LabelCardOptions | undefined): string | undefined {
  const panel = record.target.panel;
  return panel === undefined ? locale : options?.panelLocales?.get(panel) ?? locale;
}

/**
 * Format only the existing record facts; never infer comparisons from rounded
 * strings. The value row, the field rows, the change and the share print the
 * text the chart draws for each (their shown texts, `displayedValueText`), so
 * a card beside a bar labelled "$213k" says "$213k" and not "212.8"; `values`
 * keeps the source number. No number stands twice: a funnel's stage total
 * that repeats the value, and a variance headline that its current value or
 * its change repeats, leave the card; a fact the record cannot give (a first
 * stage's conversion) has no row, and a value not observed prints a dash.
 */
export function labelCardContent(record: InteractionRecord, locale?: string, options?: LabelCardOptions, share = true): LabelCardContent {
  if (record.event) return eventCardContent(record.event);
  locale = cardLocale(record, locale, options);
  // Only the facts the mark does not print: no title or value that repeats it.
  if (record.cardFields) {
    return cardContent(record.fields.filter(field => record.cardFields!.includes(field.key)).map(field => fieldRow(field, locale)));
  }
  const named = valueName(record, locale, options);
  const headline = record.value.state === 'suppressed' || !repeatedHeadline(record);
  const rows: LabelCardRow[] = [{ kind: 'title', text: named.heading }];
  if (headline) rows.push({ kind: 'value', text: `${named.name ? `${named.name}: ` : ''}${named.value}`,
    label: named.name ? `${named.name}:` : '', value: shortUnit(named.value, record.value, locale), pointed: true,
    values: [safeValue(record.value, locale)] });
  if (record.value.state !== 'suppressed') {
    const members = new Set(record.members?.map(member => member.pointId).filter(id => id !== undefined));
    // A heading that names the category says its date already. Only
    // a bare id the author gave no label (and that is not the date) keeps it.
    for (const field of record.fields) {
      if (field.key === 'date' && (options?.title !== undefined || headingNamesDate(record, field.value))) continue;
      if (field.value.state === 'unavailable' || (field.key === 'stageTotal' && sameNumber(field.value, record.value))) continue;
      // Aggregate cards show the mark's statistics. Individual observations stay
      // in the typed record for data tables and custom host content.
      // A field prints the text the chart draws for it (its shown text), else
      // through its format when it declares one, else at its own precision
      // with the unit joined as the marks join it ("10.9%", "186.825 EUR k").
      if (members.has(field.key)) continue;
      const name = field.key === 'reference' ? referenceName(record) : field.key === 'conversion' ? options?.conversionName : undefined;
      const row = fieldRow(name ? { ...field, label: name } : field, locale);
      // Without a headline, the current value is the pointed row.
      rows.push(!headline && field.key === 'current' ? { ...row, kind: 'value', pointed: true } : row);
    }
    const reference = referenceName(record);
    pushAll(rows, record.comparisons.flatMap(comparison => comparisonRow(comparison, locale, reference) ?? []));
    if (record.share && share) {
      const base = record.share.denominator;
      const values = [record.share.numerator, base, record.share.percent];
      const withheld = values.some(value => value.state === 'suppressed');
      // A composition the chart draws as 100 % names no other base: the sum
      // of the parts is the axis, and "of 100 %" repeats it. The record
      // still carries the total, in the data's unit.
      const whole = options?.hundredPercent === true || (base.state === 'value' && base.raw === 100 && base.unit === '%');
      const wording = { locale: { language: locale } };
      const label = chartString(wording, 'shareLabel');
      // The base is a total the record holds for the share; no label states it, so it prints through its format.
      const value = withheld ? chartString(wording, 'valueWithheld')
        : `${shareFormat([record.share.percent], locale)(record.share.percent)}${whole ? '' : chartString(wording, 'ofValueClause', { v1: formattedValueText(base, locale) })}`;
      rows.push({ kind: 'share', label, value: shortUnit(value, base, locale), text: `${label} ${value}`,
      values: withheld ? [] : values.map(value => safeValue(value, locale)) });
    }
    if (record.rank) {
      const wording = { locale: { language: locale } };
      const label = chartString(wording, 'rankLabel');
      const value = chartString(wording, 'rankValue', { v1: record.rank.value, v2: record.rank.of, v3: chartString(wording, record.rank.direction === 'desc' ? 'highestFirst' : 'lowestFirst') });
      rows.push({ kind: 'rank', label, value, text: `${label} ${value}` });
    }
    for (const annotation of record.annotations) rows.push({ kind: 'annotation', text: annotation.text });
  }
  return cardContent(rows);
}

/** The widest an event's card is: its detail is prose and wraps at a reading measure. */
const EVENT_CARD_WIDTH = 320;
/** Lines an event's title and each of its detail lines may take on the card; the full text is in the card's `<title>` too. */
const EVENT_TITLE_LINES = 3;
const EVENT_DETAIL_LINES = 6;

/**
 * The card of an event of the event lane: when and what kind as the heading,
 * then each item as a bold title with its detail lines under it, in full.
 */
function eventCardContent(event: NonNullable<InteractionRecord['event']>): LabelCardContent {
  const heading = eventHeading(event);
  const rows: LabelCardRow[] = [
    ...(heading ? [{ kind: 'title' as const, text: heading }] : []),
    ...event.items.flatMap(item => [
      { kind: 'value' as const, text: item.title, lines: EVENT_TITLE_LINES },
      ...item.detail.map(line => ({ kind: 'annotation' as const, text: line, lines: EVENT_DETAIL_LINES })),
    ]),
  ];
  return { rows, accessibleText: eventReading(event), maxWidth: EVENT_CARD_WIDTH };
}

/** Hollow markers carry the series ink in their stroke; unmarked points use their series path. */
/** A paint that shows on the card: not the background a mark is cut out of. */
function inked(paint: Paint | undefined): paint is Paint {
  return paint !== undefined && !(typeof paint === 'object' && 'token' in paint && paint.token === 'background');
}

function seriesSwatch(record: InteractionRecord, scene: readonly SceneNode[]): Paint | undefined {
  for (const node of scene) {
    if (!record.nodeIds.includes(node.id)) continue;
    if (node.t === 'line') return node.stroke;
    if (node.t === 'rect' || node.t === 'circle' || node.t === 'path') {
      // A marker's ring is the background around a filled dot, or the series around a hollow one.
      const paint = [...node.part === 'marker' ? [node.stroke, node.fill] : [node.fill, node.stroke]].find(inked);
      if (paint) return paint;
    }
  }
  const seriesId = record.target.owner.seriesId;
  if (seriesId === undefined) return undefined;
  // A mark with no node of its own here (a line point, a missing value) takes its series' paint: its line, else any mark or key entry of it.
  const own = scene.filter(node => node.owner?.seriesId === seriesId && node.owner.annotationId === undefined
    && node.origin?.panels.join('/') === record.target.panel);
  const path = own.find(node => node.t === 'path' && (node.part === 'line' || node.part === 'series') && node.stroke);
  if (path?.t === 'path') return path.stroke;
  for (const node of own) {
    if (node.t === 'line' && node.stroke) return node.stroke;
    if (node.t === 'rect' || node.t === 'circle' || node.t === 'path') {
      const paint = node.fill ?? node.stroke;
      if (paint) return paint;
    }
  }
  return undefined;
}

/** A series of a panel, for `LabelCardOptions.stackSeries`. */
export function stackKey(record: InteractionRecord): string {
  return `${record.target.panel ?? ''}\u0000${record.target.owner.seriesId ?? ''}`;
}

/** The parts of a stack: records whose share of a category total the card can print. */
function stackPart(record: InteractionRecord): boolean {
  return record.share !== undefined && record.value.state === 'value' && typeof record.value.raw === 'number';
}

/**
 * The stack's total as the chart draws it: the sum of its parts, at the
 * precision of the largest drawn part ("478" beside "412", "35.0" beside
 * "12.0"). Where that sum is the share's base, the base keeps its own text.
 */
function stackTotal(parts: readonly InteractionRecord[], locale?: string): InteractionValue {
  const base = parts[0]!.share!.denominator;
  const sum = parts.reduce((total, record) => total + (record.value.raw as number), 0);
  const same = base.state === 'value' && typeof base.raw === 'number' && Math.abs(base.raw - sum) <= 1e-9 * Math.max(1, Math.abs(sum));
  const { displayed: _part, ...value } = parts[0]!.value;
  const total: InteractionValue = same ? base : { ...value, raw: sum };
  if (total.displayed || total.format) return total;
  const largest = parts.reduce((top, record) => Math.abs(record.value.raw as number) > Math.abs(top.value.raw as number) ? record : top);
  const example = largest.value.displayed?.trim();
  const spec = example && /^[-−]?\d[\d.,\s\u00a0\u202f]*$/u.test(example) ? exampleFormat(example, locale, undefined) : null;
  return spec && specText(largest.value.raw as number, spec) === example ? { ...total, displayed: specText(sum, spec) } : total;
}

/**
 * The rows of one panel's records, in key order: the parts of a stack first,
 * each with its share in a column of its own, then one Total row, then the
 * other series. The parts and their total print in one number format.
 */
function groupRows(sorted: readonly InteractionRecord[], pointed: InteractionRecord | undefined, rowName: (record: InteractionRecord) => string,
  locale: string | undefined, options: LabelCardOptions | undefined, scene: readonly SceneNode[]): LabelCardRow[] {
  const rows: LabelCardRow[] = [];
  const parts = sorted.filter(stackPart);
  // A part with no value here keeps its place in the key among the parts.
  const missing = (record: InteractionRecord) => record.value.state === 'missing' && options?.stackSeries?.has(stackKey(record)) === true;
  const members = parts.length ? sorted.filter(record => parts.includes(record) || missing(record)) : [];
  // A stack of two parts or more, or one part of an authored total that is not all of it.
  const stacked = members.length > 1 || (parts.length === 1 && !sameNumber(parts[0]!.share!.numerator, parts[0]!.share!.denominator));
  const listed = stacked ? [...members, ...sorted.filter(record => !members.includes(record))] : sorted;
  const total = stacked ? stackTotal(parts, locale) : undefined;
  // The parts and their total share one format; other series (a line on its own axis) keep theirs.
  const stackFormat = cardFormat([...parts.map(record => record.value), ...total ? [total] : []], locale);
  const format = (record: InteractionRecord) => stacked && parts.includes(record) ? stackFormat(record.value) : cardValueText(record.value, locale);
  // With a part missing and no whole of its own, the base is only the known parts: their shares of it say nothing.
  const base = parts[0]?.share?.denominator;
  const knownOnly = members.length > parts.length && total !== undefined && base !== undefined && sameNumber(base, total);
  const shown = knownOnly ? [] : parts.filter(record => record.share!.percent.state === 'value');
  const share = shareFormat(shown.map(record => record.share!.percent), locale);
  // Parts that sum to 100 on a 100 % chart, or to 100 %, are their axis; one part alone is its own total.
  const hundred = total?.state === 'value' && typeof total.raw === 'number' && Math.abs(total.raw - 100) < 1e-9;
  const panel = sorted[0]?.target.panel;
  const hundredChart = (panel === undefined ? undefined : options?.panelHundred?.get(panel)) ?? options?.hundredPercent;
  const whole = !total || members.length < 2 || (hundred && (hundredChart === true || total.unit === '%'));
  listed.forEach((record, index) => {
    const name = rowName(record);
    const content = labelCardContent({ ...record, fields: record.fields.filter(field => field.key !== 'date' || headingNamesDate(record, field.value)) },
      locale, { hundredPercent: hundredChart, conversionName: options?.conversionName }, false).rows.slice(1);
    const at = content.findIndex(row => row.kind === 'value');
    if (at < 0) return;
    const number = namedNumber(name, format(record), record.value.unit);
    const value = `${record.valueLabel ? `${record.valueLabel}: ` : ''}${number}`;
    const part = stacked && shown.includes(record) ? share(record.share!.percent) : undefined;
    rows.push({ ...content[at]!, label: `${name}:`, value: shortUnit(value, record.value, locale), text: `${name}: ${value}${part ? `, ${part}` : ''}`,
      series: true, swatch: seriesSwatch(record, scene), pointed: record === pointed, ...part ? { share: part } : {} });
    pushAll(rows, content.filter((_, row) => row !== at));
    if (stacked && !whole && index === members.length - 1 && total) {
      const label = chartString({ locale: { language: locale } }, 'totalLabel');
      // A stack with a missing part adds the known parts only, as the drawn total says.
      const text = `${stackFormat(total)}${members.length > parts.length ? ` ${localeStrings(locale).incomplete}` : ''}`;
      rows.push({ kind: 'total', label: `${label}:`, value: shortUnit(text, total, locale), text: `${label}: ${text}`, values: [safeValue(total, locale)] });
    }
  });
  return rows;
}

/**
 * One card for several records at one category or one mark, such as the
 * series of a week or the shared end label of series that all end on one
 * printed value: the category heading, then each series in the order of the
 * key, the pointed one in bold. The parts of a stack come first, each with
 * its share in a column of its own, then one Total row, then the other
 * series (a combo's lines). A share of one part alone (100 %) is not
 * printed. The parts and their total print in one format. A grid's card
 * lists the hovered category in every panel, panel by panel in drawn order.
 * Every member is listed. `cache` keeps the content per set of records.
 */
export function sharedLabelCardContent(records: readonly InteractionRecord[], locale?: string, options?: LabelCardOptions,
  scene: readonly SceneNode[] = [], cache?: Map<string, LabelCardContent>): LabelCardContent {
  const key = cache && records.map(record => record.id).join('\u0000');
  const cached = key === undefined ? undefined : cache!.get(key);
  if (cached) return cached;
  const rows: LabelCardRow[] = [];
  const pointed = records[0];
  if (pointed) {
    // The records share one category, so they share its date: it joins the
    // heading once instead of repeating under every series.
    const date = options?.title === undefined && pointed.fields.find(field => field.key === 'date' && !headingNamesDate(pointed, field.value));
    const heading = options?.title ?? pointed.categoryLabel ?? pointed.target.owner.categoryId ?? pointed.label;
    rows.push({ kind: 'title', text: date ? `${heading}, ${displayedValueText(date.value, cardLocale(pointed, locale, options))}` : heading });
  }
  const order = options?.order;
  const sorted = order ? [...records].sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity)) : [...records];
  // A grid's card lists each panel in turn; a series name two panels share takes its panel's title.
  const names = new Map<string, number>();
  const seriesName = (record: InteractionRecord) => record.seriesLabel ?? record.target.owner.seriesId ?? record.label;
  for (const record of sorted) names.set(seriesName(record), (names.get(seriesName(record)) ?? 0) + 1);
  const rowName = (record: InteractionRecord) => {
    const name = seriesName(record);
    const panel = record.target.panel === undefined ? undefined : options?.panelNames?.get(record.target.panel);
    return names.get(name)! > 1 && panel && !sameName(panel, name) ? `${panel} · ${name}` : name;
  };
  const groups: InteractionRecord[][] = [];
  for (const record of sorted) {
    const last = groups.at(-1);
    if (last && last[0]!.target.panel === record.target.panel) last.push(record); else groups.push([record]);
  }
  for (const group of groups) pushAll(rows, groupRows(group, pointed, rowName, cardLocale(group[0]!, locale, options), options, scene));
  const content = cardContent(rows);
  if (key !== undefined) cache!.set(key, content);
  return content;
}

/**
 * The chart's description with the card's whole reading after it. A renderer
 * presents the SVG as one image described by `a11y.desc`, so anything nested
 * inside it — the card's own `<title>` included — never reaches a screen
 * reader. While a card is open its reading belongs in that description.
 */
export function describedWithCard(description: string, reading: string): string {
  const chart = description.replace(/\s*\.\s*$/, '');
  return chart ? `${chart}. ${reading}` : reading;
}

/** Show a table card only when it contains facts beyond the cell's printed value. */
export function shouldShowTableLabelCard(record: InteractionRecord, displayed: string | undefined, locale?: string): boolean {
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
  const rows = labelCardContent(record, locale).rows;
  const { value } = record;
  if (rows.length > 2 || displayed === undefined) return true;
  if (value.state === 'value' && typeof value.raw === 'number' && Number.isFinite(value.raw) &&
      value.format && roundedNumber(value.raw, parseFormatExample(value.format)) === value.raw) return false;
  // The cell prints the number with its unit, so the card compares that text and not its named row.
  return normalize(rows[1] ? unnamedText(rows[1], record, locale) : '') !== normalize(displayed);
}

function rowFont(row: LabelCardRow, theme: Theme): FontSpec {
  return cardFont(theme, row.kind === 'more' ? 11 : 12,
    row.kind === 'title' || row.pointed || (row.kind === 'value' && row.value === undefined) ? 600 : 400);
}

/** Claims a layout makes only for its own label solver, such as a funnel's row lanes: they draw nothing a card could hide. */
const SOLVER_CLAIMS = new Set(['funnel-row-lane']);

/** Cost per CSS pixel of card area outside the chart frame. A filled mark costs 10. */
const OUTSIDE_CHART_WEIGHT = 1;

/** Space a clear seat keeps from each text box. */
const TEXT_GAP = 4;
/** Space a card keeps from the edge of the chart frame, as the viewport boundary keeps from the window edge. */
const FRAME_INSET = 8;
/** The farthest a clear seat sits from the hovered mark, unless no seat nearer is safe. */
const CLEAR_REACH = 48;
/** Space a card keeps from the points' path, and the pointer's reach beside it that still reads as on the path. */
export const PATH_PAD = 8;

/** The convex hull of `points`, in order around it; one or two points stay as they are. */
export function pointsHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
    .filter((point, index, all) => index === 0 || point.x !== all[index - 1]!.x || point.y !== all[index - 1]!.y);
  if (sorted.length < 3) return sorted;
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list: Point[]) => list.reduce<Point[]>((hull, point) => {
    while (hull.length >= 2 && cross(hull[hull.length - 2]!, hull[hull.length - 1]!, point) <= 0) hull.pop();
    hull.push(point);
    return hull;
  }, []);
  const lower = half(sorted);
  const upper = half([...sorted].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Whether `point` lies within `pad` of the hull `path`. */
export function nearPath(path: readonly Point[], point: Point, pad = PATH_PAD): boolean {
  if (!path.length) return false;
  if (path.length >= 3 && insideHull(path, point)) return true;
  return path.some((a, index) => segmentDistance(a, path[(index + 1) % path.length]!, point) <= pad);
}

/** Whether `rect`, grown by `pad`, meets the hull `path`. */
function meetsPath(path: readonly Point[], rect: Rect, pad = PATH_PAD): boolean {
  if (!path.length) return false;
  const box = { x: rect.x - pad, y: rect.y - pad, w: rect.w + 2 * pad, h: rect.h + 2 * pad };
  if (path.some(point => rectContains(box, { ...point, w: 0, h: 0 }, 0))) return true;
  const corners = [{ x: box.x, y: box.y }, { x: box.x + box.w, y: box.y }, { x: box.x + box.w, y: box.y + box.h }, { x: box.x, y: box.y + box.h }];
  if (path.length >= 3 && corners.some(corner => insideHull(path, corner))) return true;
  return path.some((a, index) => {
    const b = path[(index + 1) % path.length]!;
    return corners.some((c, side) => segmentsCross(a, b, c, corners[(side + 1) % 4]!));
  });
}

function insideHull(hull: readonly Point[], point: Point): boolean {
  const sides = hull.map((a, index) => {
    const b = hull[(index + 1) % hull.length]!;
    return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
  });
  return sides.every(side => side >= 0) || sides.every(side => side <= 0);
}

function segmentDistance(a: Point, b: Point, point: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const side = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b);
}

/**
 * The seats on both sides of the path, across the band axis from the target:
 * above and below it on a chart banded along x, left and right of it on one
 * banded along y. Each keeps `PATH_PAD` from the path over its own extent.
 */
function pathSlots(path: readonly Point[], target: Rect, width: number, height: number, frame: Rect, band: 'x' | 'y'): CardSlot[] {
  const across = band === 'x' ? 'y' : 'x';
  const along = band;
  const length = along === 'x' ? width : height;
  const depth = across === 'y' ? height : width;
  const start = Math.min(Math.max(rectCenter(target)[along] - length / 2, frame[along]), frame[along] + (along === 'x' ? frame.w : frame.h) - length);
  // The path's extent across the band within the seat's span along it, the pad included.
  const low = start - PATH_PAD, high = start + length + PATH_PAD;
  let min = Infinity, max = -Infinity;
  path.forEach((a, index) => {
    const b = path.length > 1 ? path[(index + 1) % path.length]! : a;
    const from = Math.max(Math.min(a[along], b[along]), low), to = Math.min(Math.max(a[along], b[along]), high);
    if (from > to) return;
    for (const at of [from, to]) {
      const t = b[along] === a[along] ? 0 : (at - a[along]) / (b[along] - a[along]);
      for (const value of b[along] === a[along] ? [a[across], b[across]] : [a[across] + t * (b[across] - a[across])]) {
        min = Math.min(min, value); max = Math.max(max, value);
      }
    }
  });
  if (!Number.isFinite(min)) return [];
  const sides: [CardSide, number][] = band === 'x' ? [['above', min - PATH_PAD - depth], ['below', max + PATH_PAD]]
    : [['left', min - PATH_PAD - depth], ['right', max + PATH_PAD]];
  return sides.map(([side, value], index) => {
    const rect = clampInto(frame, along === 'x' ? { x: start, y: value, w: width, h: height } : { x: value, y: start, w: width, h: height });
    return { slot: `card:path:${side}`, side, rect, penalty: index, phase: 2 };
  });
}

interface CardSlot extends SlotCandidate { side?: CardSide; fits?: boolean; phase?: number }
interface CardSlots extends Array<CardSlot> {
  expand?: () => CardSlot[];
  /** Seats clear of every text, nearest first: tried only when no seat beside the mark is `clean`. */
  clear?: () => CardSlot[];
  /** A clear seat too far from the mark to read as its card: tried only when no nearer seat is safe. */
  far?: (slot: CardSlot) => boolean;
  /** A seat that covers no mark and no text: with one, the clear seats are not searched. */
  clean?: (slot: CardSlot) => boolean;
  /** A cheap lower bound of a seat's cost, to skip a clear seat before it is scored. */
  floor?: (slot: CardSlot) => number;
}

/**
 * Place, flip, then shift along an edge: to the mark's and the frame's ends,
 * and just past each forbidden box and each text in the seat's way.
 * Distances are viewport CSS pixels.
 */
function besideSlots(target: Rect, width: number, height: number, boundary: Rect,
  input: Pick<LabelCardInput, 'band' | 'pointer' | 'slots' | 'direction' | 'forbidden'>, texts: readonly Rect[] = []): CardSlot[] {
  const center = rectCenter(target);
  const centerX = input.band === 'y' && input.pointer ? input.pointer.x : center.x;
  const centerY = input.band && input.pointer ? input.pointer.y : center.y;
  const start = input.slots === 'table' ? input.direction === 'rtl' ? target.x + target.w - width : target.x : centerX - width / 2;
  const sides: CardSide[] = input.slots === 'table' || input.band === 'y'
    ? ['below', 'above', 'right', 'left'] : ['right', 'left', 'above', 'below'];
  const seat = (side: CardSide, index: number, gap: number, shift = 0, value?: number): CardSlot => {
    const horizontal = side === 'above' || side === 'below';
    const raw = { x: horizontal ? start : side === 'right' ? target.x + target.w + gap : target.x - width - gap,
      y: horizontal ? side === 'below' ? target.y + target.h + gap : target.y - height - gap : centerY - height / 2,
      w: width, h: height };
    const candidate = value === undefined ? raw : { ...raw, [horizontal ? 'x' : 'y']: value };
    const rect = clampInto(boundary, candidate);
    const distance = boxGap(rect, target);
    const fits = (horizontal ? rect.y === raw.y : rect.x === raw.x) && distance >= 8 - 1e-6 && distance <= 16 + 1e-6;
    return { slot: `card:beside:${side}:${gap}:${shift}`, side, rect, fits, penalty: index + shift * 4,
      phase: index < 2 && shift === 0 && gap === 8 && rectContains(boundary, raw, 0) ? index : 2 };
  };
  const direct = sides.slice(0, 2).map((side, index) => seat(side, index, 8));
  const candidates: CardSlots = direct.filter(slot => slot.phase! < 2);
  // Defer edge seats until both direct seats fail. Keep the original order
  // and penalties so equal costs still choose the same seat.
  candidates.expand = () => sides.flatMap((side, index) => [8, 16].flatMap(gap => {
    const raw = index < 2 && gap === 8 ? direct[index]! : seat(side, index, gap);
    const horizontal = side === 'above' || side === 'below';
    const axis = horizontal ? 'x' : 'y';
    const size = horizontal ? 'w' : 'h';
    const length = horizontal ? width : height;
    const across = horizontal ? 'y' : 'x';
    const depth = horizontal ? 'h' : 'w';
    const inWay = (rect: Rect) => rect[across] < raw.rect[across] + raw.rect[depth] && raw.rect[across] < rect[across] + rect[depth];
    const shifts = [target[axis], target[axis] + target[size] - length,
      boundary[axis], boundary[axis] + boundary[size] - length,
      ...(input.forbidden ?? []).flatMap(rect => [rect[axis] - length, rect[axis] + rect[size]]),
      ...texts.filter(inWay).flatMap(rect => [rect[axis] - length - TEXT_GAP, rect[axis] + rect[size] + TEXT_GAP])];
    return [...(raw.phase === 2 ? [raw] : []), ...shifts.map((value, shift) => seat(side, index, gap, shift + 1, value)).filter(slot => slot.fits)];
  }));
  return candidates;
}

/** Table seats stay 8–16 px from the cell; the viewport owns the boundary. */
export function tableCardSlots(target: Rect, boundary: Rect, width: number, height: number,
  input: Pick<LabelCardInput, 'direction' | 'pointer' | 'forbidden'>): CardSlot[] {
  return besideSlots(target, width, height, boundary, { ...input, slots: 'table' });
}

/**
 * Cost orders a phase. Only when every seat fails may hard overlap win. A
 * seat is safe only when it is clear of `forbidden` and of the pointer. A
 * direct seat, which wins before cost is compared, must also pass `clear`.
 * A safe seat that covers fewer texts (`hidden`) wins over one that covers
 * more, whatever its phase: a covered number is lost to the reader. Only a
 * clear seat beyond its reach loses to any safe seat, whatever that seat hides.
 * A seat `inWay` of the pointer's path is never safe, in any phase.
 */
export function selectCardSlot(candidates: CardSlots, forbidden: readonly Rect[], cost: (slot: CardSlot) => number,
  pointer?: Point, clear?: (slot: CardSlot) => boolean, hidden?: (slot: CardSlot) => number, inWay?: (slot: CardSlot) => boolean): CardSlot {
  type Score = { slot: CardSlot; overlap: number; cost: number; safe: boolean; hidden: number };
  const scores = new Map<string, Score>();
  const score = (slot: CardSlot): Score => {
    const { x, y, w, h } = slot.rect;
    const key = `${slot.side}:${x}:${y}:${w}:${h}`;
    const cached = scores.get(key);
    if (cached) return { ...cached, slot };
    const overlap = activeCoverCost(slot.rect, forbidden);
    const result = { slot, overlap, cost: cost(slot), safe: slot.fits !== false && overlap === 0
      && !(pointer && rectContains(slot.rect, { ...pointer, w: 0, h: 0 }, 0)) && !(slot.phase! < 2 && clear?.(slot) === false) && inWay?.(slot) !== true,
      hidden: hidden?.(slot) ?? 0 };
    scores.set(key, result);
    return result;
  };
  // A clear seat (phase 3) competes on cost with the shifted seats (phase 2).
  const phase = (score: Score) => Math.min(score.slot.phase ?? 0, 2);
  const better = (a: Score, b: Score) => a.safe !== b.safe ? a.safe
    : a.safe && a.hidden !== b.hidden ? a.hidden < b.hidden
    : (a.safe ? phase(a) - phase(b) : a.overlap - b.overlap) < 0
      || (a.safe ? phase(a) === phase(b) : a.overlap === b.overlap)
        && (a.cost < b.cost || a.cost === b.cost && a.slot.penalty < b.slot.penalty);
  let best: Score | undefined;
  const evaluate = (slots: CardSlot[]) => {
    for (const slot of slots) {
      const entry = score(slot);
      if (!best || better(entry, best)) best = entry;
      // Each direct phase has exactly one seat; no later phase can win.
      if (candidates.expand && entry.safe && entry.slot.phase! < 2) break;
    }
  };
  evaluate(candidates);
  if ((!best?.safe || best.slot.phase! >= 2) && candidates.expand) {
    const shifted = candidates.expand();
    evaluate(shifted);
    candidates.push(...shifted);
  }
  if (!(best?.safe && best.hidden === 0 && candidates.clean?.(best.slot)) && candidates.clear) {
    const clear = candidates.clear();
    const search = (slots: CardSlot[]) => {
      // Nearest first: a seat farther from the pointer than the best cost cannot win, since distance is part of the cost.
      for (const slot of slots) {
        if (best?.safe && best.hidden === 0 && slot.penalty > best.cost) break;
        if (best?.safe && best.hidden === 0 && (candidates.floor?.(slot) ?? 0) > best.cost) continue;
        const entry = score(slot);
        if (!best || better(entry, best)) best = entry;
      }
    };
    search(clear.filter(slot => !candidates.far?.(slot)));
    if (!best?.safe) search(clear.filter(slot => candidates.far?.(slot)));
  }
  // Record only unique tested seats, not duplicate edge clamps.
  candidates.splice(0, candidates.length, ...Array.from(scores.values(), entry => entry.slot));
  return best!.slot;
}

export function activeCoverCost(rect: Rect, active: readonly Rect[] = []): number {
  return active.reduce((sum, item) => sum + overlapArea(rect, item) * 1000, 0);
}

/**
 * Seats in `frame` that keep `TEXT_GAP` from every text box, nearest to
 * `pointer` first. Each row starts at a frame edge, at a text edge or a
 * beside gap above or below the mark; in a row, each run of free width offers
 * its two ends and the spot nearest the pointer. The penalty is the distance,
 * which the cost also counts.
 */
function clearSlots(frame: Rect, width: number, height: number, texts: readonly Rect[], pointer: Point, target?: Rect): CardSlot[] {
  if (frame.w < width || frame.h < height) return [];
  const bottom = frame.y + frame.h - height;
  const rows = new Set([frame.y, bottom, Math.max(frame.y, Math.min(bottom, pointer.y - height / 2)),
    ...[...(target ? [target.y + target.h + 8, target.y - 8 - height] : []), ...texts.flatMap(text => [text.y + text.h + TEXT_GAP, text.y - TEXT_GAP - height])]
      .filter(y => y >= frame.y && y <= bottom)]);
  const slots = new Map<string, CardSlot>();
  for (const y of rows) {
    const blocked = texts.filter(text => text.y - TEXT_GAP < y + height && y < text.y + text.h + TEXT_GAP)
      .map(text => [text.x - TEXT_GAP, text.x + text.w + TEXT_GAP] as const).sort((a, b) => a[0] - b[0]);
    let start = frame.x;
    const runs: (readonly [number, number])[] = [];
    for (const [from, to] of [...blocked, [frame.x + frame.w, Infinity] as const]) {
      if (Math.min(from, frame.x + frame.w) - start >= width) runs.push([start, Math.min(from, frame.x + frame.w) - width]);
      start = Math.max(start, to);
    }
    for (const [from, to] of runs) {
      for (const x of [from, to, Math.max(from, Math.min(to, pointer.x - width / 2))]) {
        const rect = { x, y, w: width, h: height };
        slots.set(`${x}:${y}`, { slot: `card:clear:${Math.round(x)}:${Math.round(y)}`, rect, phase: 3, penalty: boxGap(rect, { ...pointer, w: 0, h: 0 }) });
      }
    }
  }
  return [...slots.values()].sort((a, b) => a.penalty - b.penalty || a.rect.y - b.rect.y || a.rect.x - b.rect.x);
}

/** An anchorless card searches the same 5 by 5 boundary grid; cost orders the seats. */
function frameSlots(frame: Rect, width: number, height: number): SlotCandidate[] {
  return Array.from({ length: 25 }, (_, index) => ({ slot: `card:frame:${index}`, penalty: index,
    rect: { x: frame.x + (frame.w - width) * (index % 5) / 4,
      y: frame.y + (frame.h - height) * Math.floor(index / 5) / 4, w: width, h: height } }));
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function cardCoverCost(rect: Rect, occupied: LabelCardInput['occupied'], table = false): number {
  return occupied.reduce((sum, item) => {
    const area = overlapArea(rect, item.rect);
    if (item.kind === 'mark') return sum + area * (item.filled === false ? 0 : 10);
    // A cut digit is harder to read than a fully covered cell.
    return sum + (table && area > 0 ? item.rect.w * item.rect.h * (rectContains(rect, item.rect, 0) ? 1 : 2) : area) * 50;
  }, 0);
}

/** The frame less `inset` on each side, on each axis only where the card still fits. */
function insetFrame(frame: Rect, inset: number, width: number, height: number): Rect {
  const x = frame.w - 2 * inset >= width ? inset : 0;
  const y = frame.h - 2 * inset >= height ? inset : 0;
  return { x: frame.x + x, y: frame.y + y, w: frame.w - 2 * x, h: frame.h - 2 * y };
}

function intersect(a: Rect, b: Rect): Rect | undefined {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : undefined;
}

/** Keep a box inside the frame; a box wider or taller than the frame starts at its edge. */
function clampInto(frame: Rect, rect: Rect): Rect {
  return {
    ...rect,
    x: Math.max(frame.x, Math.min(rect.x, frame.x + frame.w - rect.w)),
    y: Math.max(frame.y, Math.min(rect.y, frame.y + frame.h - rect.h)),
  };
}

interface MeasuredRow {
  lines: string[]; width: number; height: number; title?: string;
  valueLines?: string[]; gap: number;
  /** The width of the card's share column, the same on every row; 0 without one. */
  shareWidth: number;
  /** A hairline above the row: the Total row under the parts of a stack. */
  rule?: true;
}

/** The share column's width: its widest share. */
function shareColumn(rows: readonly LabelCardRow[], theme: Theme, measure: TextMeasurer): number {
  return Math.max(0, maxOf(rows.map(row => row.share === undefined ? 0 : measure(row.share, { ...rowFont(row, theme), tabular: true }).width)));
}

/**
 * Values wrap only when required by the boundary; no digit is removed. A name
 * (`breakAfter`) wraps the same way and may also break after `_ - / .`, so the
 * card always prints it in full.
 */
export function cardValueLines(text: string, font: FontSpec, width: number, measure: TextMeasurer, breakAfter = false): string[] {
  const fitted = fitText(text, font, width, Infinity, measure, { breakAfter });
  if (!fitted.title) return fitted.lines.length ? fitted.lines : [''];
  const lines: string[] = [];
  let line = '';
  for (const cluster of graphemes(text)) {
    if (line && measure(line + cluster, font).width > width) { lines.push(line); line = ''; }
    line += cluster;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * A shared value column takes the width its values need, less the room the
 * names need to print in full: names keep up to half the card, and a value
 * wider than the rest wraps there ("Account median:" beside a long
 * population, not "Accou…"). No digit is removed either way.
 */
function measureRows(rows: readonly LabelCardRow[], theme: Theme, maxWidth: number, measure: TextMeasurer): MeasuredRow[] {
  const shares = shareColumn(rows, theme, measure);
  const shareWidth = shares ? shares + CARD_SPACE.column : 0;
  maxWidth = Math.max(1, maxWidth - shareWidth);
  const labelReserve = Math.max(0, maxOf(rows.map(row => !row.label ? 0
    : measure(row.label, rowFont(row, theme)).width + CARD_SPACE.column + (row.series ? 14 : 0))));
  const valueWidth = Math.min(Math.max(1, maxWidth - Math.min(labelReserve, maxWidth / 2)), Math.max(0, maxOf(rows.map(row => row.value === undefined ? 0
    : measure(row.value, { ...rowFont(row, theme), tabular: true }).width))));
  return rows.map((row, index) => {
    const font = rowFont(row, theme);
    const paired = row.value !== undefined;
    const swatch = row.series || row.kind === 'total' ? 14 : 0;
    const label = paired ? row.label ?? '' : row.text;
    const room = paired ? Math.max(0, maxWidth - valueWidth - (label ? CARD_SPACE.column : 0) - swatch) : maxWidth;
    // The title is the record's name: in full, on as many lines as it needs.
    const fitted = row.kind === 'title' && !paired ? { lines: cardValueLines(label, font, Math.max(1, room), measure, true), title: undefined }
      : fitText(label, font, room, row.lines ?? (row.kind === 'annotation' ? 2 : 1), measure);
    const lines = fitted.lines.length ? fitted.lines : [''];
    const valueLines = paired ? cardValueLines(row.value!, font, Math.max(1, valueWidth), measure) : undefined;
    const gap = index > 0 && (rows[index - 1]?.kind === 'title' || row.kind === 'more' || row.kind === 'total'
      || (row.series && !rows[index - 1]?.series) || (row.kind === 'annotation' && rows[index - 1]?.kind !== 'annotation')) ? CARD_SPACE.group : 0;
    return { lines, title: fitted.title, valueLines, gap, shareWidth: shares, ...row.kind === 'total' ? { rule: true as const } : {},
      width: Math.max(...lines.map(line => measure(line, font).width)) + swatch + (paired ? valueWidth + (label ? CARD_SPACE.column : 0) : 0) + shareWidth,
      height: Math.max(lines.length, valueLines?.length ?? 0) * lineBox(font) };
  });
}

/** The widest a card is by default. */
const CARD_WIDTH = 280;
/** The widest a card grows when a name and its value do not fit one line at `CARD_WIDTH`, so a long text value wraps less. */
const WIDE_CARD_WIDTH = 320;

/** The card's widest measure: `CARD_WIDTH`, wider up to `WIDE_CARD_WIDTH` for a name and value that need it on one line. */
function cardWidth(rows: readonly LabelCardRow[], theme: Theme, measure: TextMeasurer): number {
  const shares = shareColumn(rows, theme, measure);
  const paired = (shares ? shares + CARD_SPACE.column : 0) + Math.max(0, maxOf(rows.map(row => {
    if (row.value === undefined) return 0;
    const font = rowFont(row, theme);
    return (row.label ? measure(row.label, font).width + CARD_SPACE.column : 0) + (row.series || row.kind === 'total' ? 14 : 0)
      + measure(row.value, { ...font, tabular: true }).width;
  })));
  return Math.min(WIDE_CARD_WIDTH, Math.max(CARD_WIDTH, paired + 2 * CARD_SPACE.x));
}

function cardHeight(measured: readonly MeasuredRow[]): number {
  return measured.reduce((sum, row) => sum + row.height + row.gap, 0) + 2 * CARD_SPACE.y;
}

/**
 * What one side of the frame allows. A zero or missing dimension is an
 * unconstrained axis, not a frame of no size: the standalone table card is
 * laid out in an HTML slot that gives a width and lets the card be as tall
 * as its rows (`canvas.h` is 0 there). Nothing is cut or dropped on an axis
 * the caller did not constrain.
 */
function limit(side = 0): number {
  return side > 0 ? side : Infinity;
}

/** The card's own row, counting the rows the frame's height left out. */
function moreRow(hidden: number, locale?: string): LabelCardRow {
  return { kind: 'more', text: chartString({ locale }, 'moreRows', { count: String(hidden) }) };
}

/**
 * The rows that fit the frame's height — what comes back always fits, so
 * the drawn rows and the card's rectangle agree.
 *
 * The card drops from the bottom, which is the order the content is built
 * in: annotations, then rank, then the share, with a row saying how many
 * went. A frame too short for even the headings and the first value drops
 * the counting row, then the headings from the top. A value is shown only
 * in full. Whatever goes stays in `accessibleText`.
 */
function rowsWithinHeight(
  rows: readonly LabelCardRow[], theme: Theme, maxHeight: number, maxWidth: number, measure: TextMeasurer,
  locale?: string,
): { rows: LabelCardRow[]; measured: MeasuredRow[] } {
  // Apply both limits to the source rows, so a summary never counts as data.
  // Up to eight series, or nine: a counting row in place of one series would only hide it.
  let series = 0;
  const cut = rows.filter(row => row.series).length <= 9 ? -1 : rows.findIndex(row => row.series && ++series > 8);
  // The Total row closes the parts it sums: a card that cuts them leaves it out.
  const maximum = cut < 0 ? rows.length : cut;
  // The hovered series stays on a card that cuts rows: its row and the detail
  // rows under it take the place of the last kept series and its details.
  const pointedAt = rows.findIndex(row => row.series && row.pointed);
  let pointedEnd = pointedAt + 1;
  while (pointedAt >= 0 && pointedEnd < rows.length && !rows[pointedEnd]!.series && rows[pointedEnd]!.kind !== 'total') pointedEnd++;
  const first = (count: number) => {
    const kept = rows.slice(0, count);
    if (pointedAt < 0 || pointedAt < count) return kept;
    let at = kept.length - 1;
    while (at > 0 && !kept[at]!.series) at--;
    return at > 0 ? [...kept.slice(0, at), ...rows.slice(pointedAt, pointedEnd)] : kept;
  };
  const cutTo = (count: number) => {
    const kept = first(count);
    return [...kept, moreRow(rows.length - kept.length, locale)];
  };
  const limited = cut < 0 ? [...rows] : cutTo(maximum);
  const measured = measureRows(limited, theme, maxWidth, measure);
  const fits = (sizes: MeasuredRow[]) => cardHeight(sizes) <= maxHeight;
  if (fits(measured)) return { rows: limited, measured };
  const firstValue = rows.findIndex(row => row.kind === 'value');
  const floor = firstValue < 0 ? Math.min(rows.length, 2) : firstValue + 1;
  for (let kept = maximum - 1; kept >= floor; kept--) {
    const visible = cutTo(kept);
    const sizes = measureRows(visible, theme, maxWidth, measure);
    if (fits(sizes)) return { rows: visible, measured: sizes };
  }
  const title = rows[0]?.kind === 'title' ? rows[0].text : undefined;
  // The last resort is the title and one value: the hovered series's.
  const top = pointedAt > firstValue && firstValue >= 0 ? [...rows.slice(0, firstValue), rows[pointedAt]!] : rows.slice(0, floor);
  for (let from = 0; from < top.length; from++) {
    const visible = top.slice(from).map(row => from > 0 && title && row.kind === 'value'
      ? { ...row, label: row.label || title, text: `${title}: ${row.text}` } : row);
    const sizes = measureRows(visible, theme, maxWidth, measure);
    if (fits(sizes)) return { rows: visible, measured: sizes };
  }
  // An entire value must fit. The accessible reading still contains all rows.
  return { rows: [], measured: [] };
}

function rowRole(row: LabelCardRow): TextRole {
  if (row.kind === 'title') return 'category';
  if (row.kind === 'annotation') return composedTextRole(row.text, 'note');
  return 'caption';
}

function cardScene(input: LabelCardInput, rows: LabelCardRow[], rect: Rect, measured: MeasuredRow[], reading: string): SceneNode[] {
  const { record, theme } = input;
  const prefix = input.idPrefix ?? `card:${record.id}`;
  const surface = cardSurface(theme);
  const scene: SceneNode[] = [{ t: 'rect', id: prefix, rect: { x: 0, y: 0, w: rect.w, h: rect.h }, tx: rect.x, ty: rect.y, owner: record.target.owner,
    part: 'interaction-card', title: reading, fill: { css: surface.fill }, stroke: { css: theme.color.grid },
    strokeWidth: strokeToken(theme, 'hair'), radius: surface.radius }];
  let y = CARD_SPACE.y;
  rows.forEach((row, index) => {
    const size = measured[index]!;
    const font = rowFont(row, theme);
    y += size.gap;
    if (size.rule) scene.push({ t: 'line', id: `${prefix}:${index}:rule`, owner: record.target.owner, part: 'interaction-rule',
      x1: CARD_SPACE.x, y1: y - size.gap / 2, x2: rect.w - CARD_SPACE.x, y2: y - size.gap / 2, tx: rect.x, ty: rect.y,
      stroke: { css: theme.color.grid }, width: strokeToken(theme, 'hair') });
    if (row.swatch) scene.push({ t: 'rect', id: `${prefix}:${index}:swatch`, owner: record.target.owner, part: 'interaction-swatch',
      rect: { x: CARD_SPACE.x, y: y + (lineBox(font) - 8) / 2, w: 8, h: 8 }, tx: rect.x, ty: rect.y, radius: 2, fill: row.swatch });
    if (size.lines.some(Boolean)) scene.push({ t: 'text', id: `${prefix}:${index}`, owner: record.target.owner, part: 'interaction-label',
      role: rowRole(row), x: CARD_SPACE.x + (row.series || row.kind === 'total' ? 14 : 0), y, tx: rect.x, ty: rect.y,
      lines: size.lines, align: 'start', font, title: size.title,
      ink: { css: row.kind === 'title' || row.series || row.kind === 'total' || (row.kind === 'value' && row.value === undefined) ? theme.color.ink : theme.color.inkMuted } });
    const shareColumn = size.shareWidth ? size.shareWidth + CARD_SPACE.column : 0;
    if (size.valueLines) scene.push({ t: 'text', id: `${prefix}:${index}:value`, owner: record.target.owner, part: 'interaction-label',
      role: composedTextRole(row.value!), x: rect.w - CARD_SPACE.x - shareColumn, y, tx: rect.x, ty: rect.y, lines: size.valueLines,
      align: 'end', font, ink: { css: row.kind === 'value' || row.kind === 'total' ? theme.color.ink : theme.color.inkMuted } });
    if (row.share !== undefined) scene.push({ t: 'text', id: `${prefix}:${index}:share`, owner: record.target.owner, part: 'interaction-label',
      role: composedTextRole(row.share), x: rect.w - CARD_SPACE.x, y, tx: rect.x, ty: rect.y, lines: [row.share],
      align: 'end', font: { ...font, tabular: true }, ink: { css: theme.color.inkMuted } });
    y += size.height;
  });
  return scene;
}

/** A card reserves its whole box, and that box stays inside the frame. */
export function layoutLabelCard(input: LabelCardInput): LabelCardLayout {
  return layoutLabelCardContent(input, labelCardContent(input.record, input.locale, input.card));
}

/**
 * Place preformatted rows. A shared card built from several records reuses
 * one record's identity and anchor while presenting the combined rows.
 */
export function layoutLabelCardContent(input: LabelCardInput, content: LabelCardContent): LabelCardLayout {
  const { theme, canvas } = input;
  const measure = input.measure ?? defaultMeasurer;
  const pad = CARD_SPACE.x;
  const boundary = input.boundary ?? canvas;
  // Only the viewport (or the table's supplied boundary) can drop rows.
  const frameWidth = Math.min(input.boundary ? Math.max(0, boundary.w) : limit(boundary.w),
    content.maxWidth ?? cardWidth(content.rows, theme, measure));
  const frameHeight = input.boundary ? Math.max(0, boundary.h) : limit(boundary.h);
  const { rows, measured } = rowsWithinHeight(content.rows, theme, frameHeight, frameWidth - 2 * pad, measure, input.locale);
  const width = Math.min(frameWidth, Math.max(0, maxOf(measured.map(size => size.width))) + 2 * pad);
  const height = Math.min(frameHeight, cardHeight(measured));
  const seat = input.follow && input.pointer
    ? { placement: 'pointer' as const, rect: followSeat(input.pointer, width, height, input.chart ?? canvas, input.boundary), decisions: [] }
    : placeLabelCard(input, width, height);
  return { ...content, rows, ...seat,
    scene: rows.length ? cardScene(input, rows, seat.rect, measured, content.accessibleText) : [] };
}

/** The pointer card's distance from the pointer on each axis, in CSS pixels. */
export const FOLLOW_GAP = 20;

/**
 * The seat of a card that follows the pointer: `FOLLOW_GAP` right of and
 * below it. On each axis the card flips to the other side of the pointer
 * where it would cross the edge of the chart or the viewport. Where neither
 * side fits in the chart, it may extend beyond the chart inside the viewport.
 * Where neither side fits in the viewport, it clamps into the viewport. All
 * values are CSS pixels from the chart's origin; `boundary` is the viewport,
 * the chart is the fallback.
 */
export function followSeat(pointer: Point, width: number, height: number, chart: Rect, boundary: Rect = chart): Rect {
  const axis = (at: number, size: number, chartFrom: number, chartTo: number, viewFrom: number, viewTo: number): number => {
    const after = at + FOLLOW_GAP;
    const before = at - FOLLOW_GAP - size;
    for (const [from, to] of [[Math.max(chartFrom, viewFrom), Math.min(chartTo, viewTo)], [viewFrom, viewTo]] as const) {
      if (after >= from && after + size <= to) return after;
      if (before >= from && before + size <= to) return before;
    }
    return Math.max(viewFrom, Math.min(after, viewTo - size));
  };
  return { x: Math.round(axis(pointer.x, width, chart.x, chart.x + chart.w, boundary.x, boundary.x + boundary.w)),
    y: Math.round(axis(pointer.y, height, chart.y, chart.y + chart.h, boundary.y, boundary.y + boundary.h)), w: width, h: height };
}

/** One seat search and what it tried. */
interface CardSeat { slot: CardSlot; placement: LabelCardLayout['placement']; tried: string[] }

/**
 * The improved search's extra inputs: the texts the base seat leaves readable,
 * which it may not cover.
 */
interface SeatSearch { readable: readonly Rect[] }

/**
 * The seat of a card box of `width` by `height`: beside the mark on a free
 * side, clear of the pointer, else over the content where it covers least.
 * The label card and a host's own card content share this one rule.
 *
 * Two searches run. The base search seats the card beside the mark. The
 * improved search also keeps the chart's own words clear, ignores claims that
 * draw nothing, tries more seats near the mark and prefers the seat that hides
 * fewest texts. Its seat wins only when it hides no text the base seat leaves
 * readable, so a better seat never trades one hidden label for another. The one
 * exception frees the chart's words: where the base seat hides them, a seat clear
 * of them may hide other records' labels instead.
 *
 * Both searches stay near the mark. A card far from its mark reads as no card of
 * that mark, which is worse than a hidden label, so a clear seat beyond
 * `CLEAR_REACH` is taken only when no nearer seat is safe.
 *
 * With a points path, a seat off the path wins when it stands within
 * `CLEAR_REACH` of the mark and hides no text; else the card takes the seat it
 * would take without the path, and `overPath` says whether that seat meets the
 * path. A host's own card (`strict`) always keeps off the path, as it takes
 * the pointer.
 */
export function placeLabelCard(input: LabelCardInput, width: number, height: number, strict = false): Pick<LabelCardLayout, 'placement' | 'rect' | 'side' | 'decisions' | 'overPath'> {
  // Text the card would hide: labels, notes, axis and frame text. A rule of an axis is no text.
  const texts = input.slots === 'table' ? [] : input.occupied.filter(item => item.kind !== 'mark' && item.kind !== 'reserved' && Math.min(item.rect.w, item.rect.h) > 2);
  const hidden = (rect: Rect) => texts.filter(item => overlapArea(rect, item.rect) > 0);
  const path = input.slots === 'table' ? undefined : input.path;
  const seat = searchSeat(input, width, height, texts, hidden);
  if (!path) return seat;
  const anchor = input.mark ?? input.target ?? input.record.anchor;
  if (strict || !meetsPath(path, seat.rect) && hidden(seat.rect).length === 0 && (!anchor || boxGap(seat.rect, { w: 0, h: 0, ...anchor }) <= CLEAR_REACH)) {
    return { ...seat, overPath: meetsPath(path, seat.rect) };
  }
  const beside = searchSeat({ ...input, path: undefined }, width, height, texts, hidden);
  return { ...beside, overPath: meetsPath(path, beside.rect) };
}

function searchSeat(input: LabelCardInput, width: number, height: number, texts: readonly (OccupiedRect & { filled?: boolean })[],
  hidden: (rect: Rect) => (OccupiedRect & { filled?: boolean })[]): Pick<LabelCardLayout, 'placement' | 'rect' | 'side' | 'decisions'> {
  let seat = seatCard(input, width, height, texts);
  // A second search never trades a seat clear of the pointer's path for one in its way.
  const inWay = (rect: Rect) => input.path !== undefined && meetsPath(input.path, rect);
  const keepsPath = (next: CardSeat) => inWay(seat.slot.rect) || !inWay(next.slot.rect);
  if (texts.length) {
    const before = new Set(hidden(seat.slot.rect));
    // A seat that frees the chart's words may hide labels of other records instead.
    const freed = [...before].some(chartWord) ? seatCard(input, width, height, texts, { readable: [] }) : undefined;
    if (freed && !hidden(freed.slot.rect).some(item => chartWord(item) || ownerContains(item.owner, input.record.target.owner))
      && !(input.pointer && rectContains(freed.slot.rect, { ...input.pointer, w: 0, h: 0 }, 0)) && keepsPath(freed)) seat = freed;
    else {
      const improved = seatCard(input, width, height, texts, { readable: texts.filter(item => !before.has(item)).map(item => item.rect) });
      if (hidden(improved.slot.rect).every(item => before.has(item)) && keepsPath(improved)) seat = improved;
    }
  }
  // Cost and side memory own the card seat. A second box solver would undo
  // that choice. Rows use the shared text fitting policy above.
  const decisions: PlaceDecision[] = [{ labelId: input.idPrefix ?? `card:${input.record.id}`, strategy: 'candidatesOccupied',
    tried: seat.tried, chose: seat.slot.slot, reason: seat.placement }];
  return { placement: seat.placement, rect: seat.slot.rect, side: seat.slot.side, decisions };
}

/** The chart's own words, which no record owns: its title, notes, headers and legend. */
function chartWord(item: OccupiedRect): boolean {
  return item.kind === 'frame' || item.kind === 'legend' || Object.keys(item.owner).length === 0;
}

function seatCard(input: LabelCardInput, width: number, height: number, texts: readonly (OccupiedRect & { filled?: boolean })[], search?: SeatSearch): CardSeat {
  const occupied = search ? input.occupied.filter(item => !SOLVER_CLAIMS.has(item.part ?? '')) : input.occupied;
  const anchor = input.target ?? input.record.anchor;
  const target = anchor ? { w: 0, h: 0, ...anchor } : undefined;
  // A record scrolled out of the viewport keeps its card in the chart frame, at the record, not at the screen edge.
  const viewport = input.boundary && (!target || !(input.boundary.w > 0 && input.boundary.h > 0) || boxGap(target, input.boundary) === 0);
  const table = input.slots === 'table';
  // The chart's own frame keeps an inset, as the viewport boundary does, so a card never touches the chart's edge.
  const boundary = viewport ? input.boundary! : insetFrame(input.chart ?? input.canvas, table ? 0 : FRAME_INSET, width, height);
  const frame = { ...boundary, w: Math.max(0, boundary.w) || width, h: Math.max(0, boundary.h) || height };
  const coversPointer = (rect: Rect) => input.pointer !== undefined && rectContains(rect, { ...input.pointer, w: 0, h: 0 }, 0);
  const candidates: CardSlot[] = target ? table
    ? tableCardSlots(target, frame, width, height, input)
    : besideSlots(target, width, height, frame, input, search ? texts.map(item => item.rect) : []) : frameSlots(frame, width, height);
  const covered = (rect: Rect) => cardCoverCost(rect, occupied, table);
  // The card explains the marks, so a direct seat over a filled mark does not win before cost is compared.
  const coversFilledMark = (rect: Rect) => occupied.some(item => item.kind === 'mark' && item.filled !== false && overlapArea(rect, item.rect) > 0);
  // The viewport bounds the card and the chart frame is only a preference: area outside the frame costs less than covering a mark.
  const chart = input.chart ?? input.canvas;
  const outsideChart = (rect: Rect) => table ? 0 : (rect.w * rect.h - overlapArea(rect, chart)) * OUTSIDE_CHART_WEIGHT;
  const coversText = (rect: Rect) => texts.some(item => overlapArea(rect, item.rect) > 0);
  // The base search ranks a seat that covers no text first; the improved one ranks by how many texts it hides.
  const hiddenTexts = (rect: Rect) => search ? texts.reduce((count, item) => count + (overlapArea(rect, item.rect) > 0 ? 1 : 0), 0) : coversText(rect) ? 1 : 0;
  // The hovered record's own labels stay readable beside its card, as the engine's active labels do. In the
  // improved search so do the chart's own words, which no record owns (its title, notes, headers and legend),
  // and every text the base seat leaves readable.
  const own = texts.filter(item => ownerContains(item.owner, input.record.target.owner) || (search !== undefined && chartWord(item))).map(item => item.rect);
  const active = [...(input.forbidden ?? []), ...own, ...(search?.readable ?? [])];
  const exclusion = target ? { ...target, w: target.w || 0.001, h: target.h || 0.001 } : undefined;
  const forbidden = [...(exclusion ? [exclusion] : []), ...(table ? [] : active)];
  const pointer = table && !input.pointer && target ? target
    : { ...(input.pointer ?? rectCenter(target ?? frame)), w: 0, h: 0 };
  const cost = (slot: CardSlot) => Math.round((covered(slot.rect) + outsideChart(slot.rect) + activeCoverCost(slot.rect, table ? input.forbidden : active)
    + (coversPointer(slot.rect) ? slot.rect.w * slot.rect.h * 1000 : 0) + boxGap(slot.rect, pointer)
    + (slot.side === input.previousSide ? 0 : 8)) * 1000) / 1000;
  // On a chart that picks along an axis, the card stays off the path between its points, where the pointer
  // travels from one point to the next; the seats across the band from the path are always clear of it.
  const path = table || !target ? undefined : input.path;
  if (path) {
    const expand = (candidates as CardSlots).expand;
    const across = pathSlots(path, target!, width, height, frame, input.band ?? 'x');
    (candidates as CardSlots).expand = () => [...(expand?.() ?? []), ...across];
  }
  if (target && !table) {
    // Inside the boundary and at most one card size beyond the chart: the seats clear of text that the seats beside the mark could not find.
    const area = intersect({ x: chart.x - width, y: chart.y - height, w: chart.w + 2 * width, h: chart.h + 2 * height }, frame);
    (candidates as CardSlots).clear = () => area ? clearSlots(area, width, height, texts.map(item => item.rect), pointer, search ? target : undefined) : [];
    (candidates as CardSlots).far = slot => boxGap(slot.rect, target) > CLEAR_REACH;
    (candidates as CardSlots).clean = slot => covered(slot.rect) === 0 && !coversText(slot.rect);
    (candidates as CardSlots).floor = slot => slot.penalty + outsideChart(slot.rect);
  }
  const selected = selectCardSlot(candidates, forbidden, cost, input.pointer, table ? undefined : slot => !coversFilledMark(slot.rect) && !coversText(slot.rect),
    table ? undefined : slot => hiddenTexts(slot.rect), path && (slot => meetsPath(path, slot.rect)));
  const rect = selected.rect;
  const placement = covered(rect) > 0 || activeCoverCost(rect, forbidden) > 0 || activeCoverCost(rect, input.forbidden) > 0 ? 'overlay' : target ? 'beside' : 'frame';
  return { slot: selected, placement, tried: candidates.map(slot => slot.slot) };
}
