/**
 * Tick-row grammar and geometry.
 *
 * One module, seven consumers (line, column, variance, waterfall, mekko,
 * combo, heatmap) plus the value-axis renderer; the rules live HERE so an
 * eighth chart type cannot re-answer them differently.
 *
 * The three rules this module carries:
 *
 * - One-row tick line. On axes whose categories are dates or numbers
 *   every tick label is a single line on one shared baseline row; the
 *   `belowShifted` stagger slot is banned for such sequences. Prose
 *   categories may wrap to PROSE_TICK_MAX_LINES.
 * - Edge-tick anchoring. On a value axis, and on a category
 *   row whose first and last points sit on the plot edges (a line with
 *   `crossesBetween: false`), the first tick label is START-anchored at its
 *   tick and the last is END-anchored; interior ticks stay centered. This
 *   removes the collision between the origin label's center-anchored left
 *   half and the y-axis label column claimed into the OccupiedIndex — the
 *   mechanism that forced the origin ('2021-01') onto a second row.
 *   Up to 50% of the label width may overhang past the edge tick;
 *   the default anchors realize overhang 0, and the 50% is the ceiling the
 *   gate enforces. A category row over bands centres every label on its
 *   band and holds it inside the outer edges of the first and last band,
 *   which keeps the same guarantee.
 * - Tick-band reserve equals content. The reserved category-band
 *   height is measuredLines × lineHeight + 8, never an unconditional
 *   two-line constant; the dead band below a date/numeric tick row is 0.
 *
 * Date grammar: the document default stays `YYYY-MM`; the closed
 * label grammar below recognizes the enum {YYYY-MM, MMM-YY, YYYY}
 * plus short numeric dates and the ISO/quarter/week/fiscal forms that reach
 * category labels.
 * The class is deliberately CLOSED: a label that mixes prose with a date
 * ("2030F", "since 2021") is prose, and a sequence with one prose member is
 * a prose sequence — mis-classifying toward prose only costs the prose
 * (wrapping, centered) behavior, never a wrong single-line squeeze.
 */

import { DATE_NAME_LANGUAGES, dateNames } from '../dateNames';

/** Prose tick labels may wrap to two lines; dates/numbers to one.
 *  A gate asserts the date/numeric cap directly against this
 *  constant, so retuning it here retunes the gate with it. */
export const PROSE_TICK_MAX_LINES = 2;

/**
 * A month name in any shipped language, full or CLDR short, in any case:
 * 'Jan', 'März', 'Okt', 'janv.', 'mrt', 'Sept'. The English-only list read a
 * German month axis as prose, because 'Mär', 'Mai', 'Okt' and 'Dez' failed it.
 * Exactly those names, then no further letter: a name followed by any letters
 * read 'Main 2024', 'Mail 2025' and 'Marchandise 2026' as dates.
 */
const MONTH_NAME = `(?:${[...new Set(DATE_NAME_LANGUAGES.flatMap((language) => {
  const names = dateNames(language);
  return [...names.months, ...names.monthsShort].map((name) => name.replace(/\.$/, '').toLowerCase());
}))].join('|')})\\.?(?!\\p{L})`;
/** A label that starts with a month name, for the month-friendly strides. */
export const MONTH_START = new RegExp(`^${MONTH_NAME}`, 'iu');
const SHORT_SLASH_DATE = /^(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])$/;
const SHORT_DASH_DATE = /^(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

/** The closed date/numeric tick grammar (one label). */
const TICK_PATTERNS: readonly RegExp[] = [
  // numeric ranges joined by an en dash (histogram bins): 0–344 · 1,032–1,376;
  // a hyphen range stays prose so bucket labels like 1-2 keep their old class
  /^[+-]?\d[\d,. \u202F\u00A0]*%?\s?\u2013\s?[+-]?\d[\d,. \u202F\u00A0]*%?$/,
  // plain numbers: 42 · -3.5 · 1,000 · 1 000 · 12% (magnitude suffixes are
  // value-axis territory, not category labels — deliberately absent; group
  // separators: comma, dot, ASCII space, U+202F, U+00A0)
  /^[+-]?\d[\d,. \u202F\u00A0]*%?$/,
  // ISO dates: 2021 (matched above), 2021-01, 2021-01-15
  /^\d{4}-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?$/,
  // short numeric dates: MM-DD, D.M., DD.MM., M/D
  SHORT_DASH_DATE,
  /^(?:0?[1-9]|[12]\d|3[01])\.(?:0?[1-9]|1[0-2])\.$/,
  SHORT_SLASH_DATE,
  // ISO week: 2024-W05 / 2024W5
  /^\d{4}-?W\d{1,2}$/i,
  // quarters: Q1 2024 · Q1-24 · Q1'24 · 2024-Q1 · 2024 Q1
  /^Q[1-4][ \-']?\d{2,4}$/i,
  /^\d{4}[ -]?Q[1-4]$/i,
  // half-years: 2024 · H2-24
  /^H[12][ \-']?\d{2,4}$/i,
  // month names: Jan-24 · Jan 24 · Jan'24 · January 2024
  new RegExp(`^${MONTH_NAME}[ \\-']?\\d{2,4}$`, 'iu'),
  // Month-day labels use the same one-line date policy in every language,
  // with the year the engine's own date labels add at a year change.
  new RegExp(`^(?:0?[1-9]|[12]\\d|3[01])\\.?\\s+${MONTH_NAME}(?:\\s+\\d{4})?$`, 'iu'),
  new RegExp(`^${MONTH_NAME}\\s+(?:0?[1-9]|[12]\\d|3[01])(?:,?\\s+\\d{4})?$`, 'iu'),
  // fiscal years: FY21 · FY 2021 · FY'22
  /^FY[ ']?\d{2,4}$/i,
];

/** Does ONE label belong to the date/numeric tick class? */
function isDateNumericTickLabel(label: string): boolean {
  const text = label.trim();
  if (text.length === 0) return false;
  return TICK_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * The axis classifier: a category axis is date/numeric when EVERY
 * non-empty label is, and at least one label exists. Empty labels ride
 * along (a spacer category does not turn a month axis into prose).
 */
export function isDateNumericTickSequence(labels: readonly string[]): boolean {
  const nonEmpty = labels.map((label) => label.trim()).filter(Boolean);
  // An all-slash sequence whose two sides never exceed 12 is ambiguous with
  // fractions such as 1/2, 1/4, 1/8. The closed grammar chooses prose for the
  // ambiguous case. One day above 12 makes an M/D date sequence unambiguous.
  if (
    nonEmpty.length > 0 &&
    nonEmpty.every((label) => SHORT_SLASH_DATE.test(label)) &&
    nonEmpty.every((label) => Number(label.split('/')[1]) <= 12)
  ) {
    return false;
  }
  // Contiguous ascending dash ranges are buckets, not calendar dates. Actual
  // short-date sequences keep a common month or advance within a month.
  if (nonEmpty.length > 1 && nonEmpty.every((label) => SHORT_DASH_DATE.test(label))) {
    const pairs = nonEmpty.map((label) => label.split('-').map(Number) as [number, number]);
    if (pairs.slice(1).every((pair, index) => pair[0] > pairs[index]![1])) return false;
  }
  let seen = 0;
  for (const label of labels) {
    if (label.trim().length === 0) continue;
    if (!isDateNumericTickLabel(label)) return false;
    seen++;
  }
  return seen > 0;
}

/**
 * The x of a tick label's rect. `cx` is the tick position, `width`
 * the measured label width. Callers edge-anchor the first and last labels of
 * a value axis and of points on the plot edges. Interior ticks stay
 * centered. A single tick has no edge pair.
 */
export function tickLabelX(
  cx: number,
  width: number,
  index: number,
  count: number,
  edgeAnchored: boolean,
): number {
  if (edgeAnchored && count > 1) {
    if (index === 0) return cx; // start-anchored, overhang 0 ≤ the 50% ceiling
    if (index === count - 1) return cx - width; // end-anchored
  }
  return cx - width / 2;
}

/**
 * The receipt each tick-row layout publishes in `derived.tickBand` so the
 * tick-band gate can compare the reserve arithmetic against the labels the scene
 * actually renders (two independent paths).
 */
export interface TickBandDerived {
  /** Norm-formula component of the category-band reserve (px). Equals the
   *  frame carve on plain axes; ratio-tier hosts carve caption arithmetic
   *  on top and report it via `extra`, not here. */
  reserved: number;
  /** Measured wrap result over the category tick labels (max lines). */
  measuredLines: number;
  /** Tick line height used (tickFont.size × 1.2). */
  lineHeight: number;
  /** Named px beyond the norm formula; 0 whenever `dateNumeric`. */
  extra: number;
  /** The sequence classified as dates-or-numbers. */
  dateNumeric: boolean;
  /** Where the band sits; mekko percent mode stacks names ABOVE the 100% edge (gap 4, not 8). */
  position: 'below' | 'above';
}
