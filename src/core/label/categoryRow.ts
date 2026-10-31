/**
 * The category tick-row cascade.
 *
 * One decision for every chart with a category axis: how a row of category
 * labels fits its pitch. A local greedy sweep that hides whichever label
 * loses drops February and November from a 12-month axis and ellipsises
 * nine names of a 14-step bridge. The cascade here stops at the first step
 * that fits:
 *
 *   dates and numbers   one line → one font step down → uniform stride
 *                       (line-family rows count back from the latest period)
 *   prose               two lines → three lines → one font step down →
 *                       rotated 45° (or -90° where the caller asks for it)
 *                       → uniform stride of whole names (a row that cannot
 *                       rotate) → ellipsis (warned)
 *
 * The prose steps are the shared truncation policy (src/core/label/fitText.ts)
 * spelled out for a row: a cut name keeps its full text as `title`,
 * and a rotated name may use the height the plot can spare before it is cut.
 *
 * Prose that can rotate is not thinned: a bar without a name is a defect, a
 * rotated name is not. A row too narrow to rotate draws the whole names
 * that fit, chosen by fit and priority, never by stride, since a cut
 * that leaves nothing but the ellipsis names no bar either. Dates are
 * thinned only uniformly, so the reader sees a rhythm, not a gap. Every step that changes what the reader sees reports an info or
 * warn lint so an agent can pick a wider canvas or a horizontal chart.
 */

import { DEFAULT_TARGET, targetFloorsPx } from '../target';
import { DATE_NAME_LANGUAGES, dateNames } from '../dateNames';
import type { RenderTarget } from '../types/options';
import { calendarMonths, type CalendarInfo } from '../calendarLabels';
import { defaultMeasurer, measureText, type FontSpec, type TextMeasurer, type TextSize } from '../text';
import { cutWithTitle, fitText } from './fitText';
import { footnoteMark } from '../footnoteMark';
import type { LintWarning } from '../types/scene';
import { PRIORITY, type LabelRequest } from './solver';
import { isDateNumericTickSequence, MONTH_START, PROSE_TICK_MAX_LINES, tickLabelX } from './tickRow';
import { disclosureNote } from '../notes';
import { spread1DResult } from '../collide';
import { maxOf, minOf } from '../arrays';

/** Internal adapter override: ranked categories are not a line-family timeline. */
export const CATEGORY_ROW_FROM_END = Symbol('categoryRowFromEnd');
/** Internal adapter override: a row that must rotate turns its names -90° (CategoryRowInput.rotate90). */
export const CATEGORY_ROW_VERTICAL = Symbol('categoryRowVertical');

interface CategoryRowInput {
  /** Pass the layout target to bound the axis font ladder. */
  target?: RenderTarget;
  /** The chart's `textScale`; the ladder's floor scales with it. */
  textScale?: number;
  /** One label per category, in axis order. */
  labels: readonly string[];
  /**
   * Drawn after the label and never cut with it: the footnote reference
   * mark. The name is fitted to its band minus this, so a cut
   * name still ends "Enterprise cloud infra… 1)" and the reader can follow
   * the reference. Empty or absent for a category with no reference.
   */
  suffixes?: readonly string[];
  /**
   * A second line under a category's name ("to date" under a running
   * period), drawn after the row is fitted: it takes no room in the pitch, so
   * no other name is thinned for it. A rotated row appends it to the name.
   */
  under?: readonly (string | undefined)[];
  /** Band centres in plot coordinates, same order. */
  centers: readonly number[];
  /** Pitch between neighbouring centres. */
  step: number;
  /** Per-category widths when columns are not uniform (mekko); the wrap budget is then each column's own. */
  widths?: readonly number[];
  /**
   * Longest rotated label before it is ellipsised (px). Default: what 30% of
   * `plotHeight` holds at 45°, and never less than 110.
   */
  maxRotatedWidth?: number;
  /** Height of the plot block the rotated row is taken from (px). */
  plotHeight?: number;
  /** Font ladder: the axis role first, then the roles the cascade may step down to. */
  fonts: readonly FontSpec[];
  /**
   * The secondary text role. A row of periods, dates or
   * bins is secondary text: it takes this font when it is smaller than the
   * ladder's first font. A row of names keeps the ladder.
   */
  secondary?: FontSpec;
  /** Every category carries an ISO date: the row names periods whatever its words ("FY25F"), and takes `secondary`. */
  periods?: boolean;
  measure: TextMeasurer;
  /** Minimum clear gap between neighbouring labels (px). */
  gap?: number;
  /** Width the wrap budget keeps free inside the pitch (px). */
  padding?: number;
  /** Allow the 45° rotation step for prose (default true). */
  rotate?: boolean;
  /** Ordered prose (line axes) wraps, then uses a uniform stride before rotation. */
  ordered?: boolean;
  /** Line-family rows count equal label steps back from the latest period. */
  strideFromEnd?: boolean;
  /**
   * Categories the caller has already decided to label, for example one tick per
   * calendar interval. Every label is still measured; the others are marked
   * undrawn. Absent means every label is eligible.
   */
  keep?: readonly boolean[];
  /** Categories that thinning must keep, such as the last actual period. */
  pinned?: readonly boolean[];
  /**
   * With `keep` from a date interval: each category's interval ordinal (the
   * year, the month since year 0) and the strides that keep round intervals.
   * A row too narrow for every kept tick then thins by the interval, every
   * tenth year from 1980, not by the category index, which on monthly
   * categories met a year start only by chance.
   */
  dateStride?: {
    ordinals: readonly number[];
    strides: readonly number[];
    /**
     * Calendar-aligned ticks: a tick sits where its ordinal is a
     * multiple of the stride, whatever the row's end, and the last category is
     * always drawn. Absent, ticks count back from the latest period (weeks, days).
     */
    calendar?: true;
    /** Ordinal units between two neighbouring categories (3 on a row of quarters counted in months). */
    perStep?: number;
  };
  /**
   * The ISO date of each category, else its id (categoryLabelsAndMarks). A row
   * whose categories are months or quarters takes the calendar tick rule; a row
   * of days or weeks counts equal steps back from the latest period. Any chart
   * type that passes dates gets the same ticks.
   */
  dates?: readonly (string | undefined)[];
  /**
   * The room the chart's frame gives the plot before value-axis and end-label
   * reserves. A calendar row never thins less than this room needs, so panels
   * that share categories and width show the same tick months, whatever their
   * own gutters take.
   */
  reference?: { x: number; width: number };
  /**
   * The first and last category sit on the plot edges (a line with
   * `crossesBetween: false`), so their labels anchor inward: the first
   * starts at its point and the last ends at it. Otherwise every
   * label centres on its category, clamped inside the outer edges of the
   * first and last band.
   */
  edgeAnchored?: boolean;
  /**
   * Which names a prose row that must thin draws first, higher first (an
   * outlier, a flagged or highlighted column). Names are then chosen by fit,
   * never by stride; equal priority goes left to right.
   */
  priority?: readonly number[];
  /**
   * The first note number a cut name may take. When set, each name the
   * row cuts carries the mark "n)" after it, counting up from here, and the
   * plan returns the full names as `cutNotes` for the caller to print.
   * Absent, a cut name keeps its full text in the SVG <title> only.
   */
  cutMarkFrom?: number;
  /**
   * The engine's own date labels (calendarLabels.ts): a row of them is a date
   * row whatever its words, and a label that names the year is drawn, its
   * routine neighbours yielding, so the row never loses the year.
   */
  calendar?: readonly (CalendarInfo | undefined)[];
  /**
   * The plot's outer edges. An end name may use the room up to this edge when
   * the row spreads its names upright before it rotates them.
   * Absent, the row's outer edges are half a step past the end centres.
   */
  range?: readonly [number, number];
  /** Try the upright spread before the 45° step (default true on the new targets). */
  spreadBeforeRotate?: boolean;
  /**
   * The rotate step turns names -90° (vertical, reading up) instead of 45°
   * (pareto at 480–320 px). A vertical name needs a pitch of
   * one line only, and stands inside its own column. Absent, rows turn 45°.
   */
  rotate90?: boolean;
  /**
   * Names that are not an ordered row (a numbered sequence, periods) keep one name per column:
   * where 45° has no room the row turns -90°, else it cuts with an ellipsis, and it never thins
   * by fit. Column and combo set it where no rank key prints (notes.show without 'disclosure').
   */
  everyName?: boolean;
}

interface CategoryLabelInfo {
  lines: string[];
  w: number;
  h: number;
  truncated: boolean;
  /** The full name when a line was cut; the text node's `<title>`. */
  title?: string;
}

type CategoryRowStep = 'fit' | 'wrap' | 'font-down' | 'stride' | 'rotate' | 'ranks' | 'ellipsis';

export interface CategoryRowPlan {
  dateNumeric: boolean;
  /** 'secondary' when a period row took the secondary font (CategoryRowInput.secondary); the drawn labels carry it, and the muted ink. */
  typeRole: 'axis' | 'secondary';
  /** The font every drawn label uses. */
  font: FontSpec;
  infos: CategoryLabelInfo[];
  /** Which labels are drawn. All of them for prose, unless the row is too narrow to rotate. */
  keep: boolean[];
  /** 1 = every label; k = the step between labels. */
  stride: number;
  /** 90 is the -90° form (CategoryRowInput.rotate90): vertical names that read up. */
  rotation: 0 | 45 | 90;
  /** Lines the tallest drawn label uses (1 when rotated). */
  maxLines: number;
  /** Height the band must reserve for the labels themselves (the +8 is the caller's). */
  rowHeight: number;
  /** Anchored x of a label's rect (unrotated). */
  x(index: number): number;
  /** Anchored x of a label of the given width at a category, by the row's rule. */
  anchor(index: number, width: number): number;
  step: CategoryRowStep;
  warnings: LintWarning[];
  /** "n) Full name." for every name the row cut and marked (`cutMarkFrom`). */
  cutNotes: string[];
  /**
   * The period row under the names, `offset` below the top of the row: under
   * months or quarters one year per label, centred under its categories; under
   * day numbers one month per label ('Oct 2026', then 'Nov'), starting at the
   * first day of that month. `rowHeight` includes it.
   */
  yearRow?: { offset: number; years: { id: string; text: string; x: number; w: number; h: number }[] };
  /** The `under` lines of an upright row: one line under the names, `offset` below the top of the row. `rowHeight` includes it. */
  underRow?: { offset: number; items: { index: number; text: string; x: number; w: number; h: number }[] };
}

/** Gap between the category labels and the year row under them. */
const YEAR_ROW_GAP = 2;
/** Clear room between names the spread step moves apart (7.1 px at 320). */
const SPREAD_GAP = 7.5;

/** The year row's labels under a category row whose labels start at `top`: category text with no one category as owner. */
export function yearRowRequests(plan: CategoryRowPlan, top: number): LabelRequest[] {
  const under: LabelRequest[] = (plan.underRow?.items ?? []).map(({ index, text, x, w, h }) => ({
    id: `category-under:${index}`, kind: 'category', owner: {}, text, lines: [text],
    typeRole: plan.typeRole, font: plan.font, priority: PRIORITY.endpoint,
    candidates: [{ slot: 'below', rect: { x, y: top + plan.underRow!.offset, w, h }, penalty: 0 }],
  }));
  const row = plan.yearRow;
  if (!row) return under;
  // A period the categories come back to gets -2, -3 on its later labels, so ids stay unique.
  const seen = new Map<string, number>();
  return [...under, ...row.years.map(({ id, text, x, w, h }): LabelRequest => {
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    return {
      id: `${id}${n > 1 ? `-${n}` : ''}`, kind: 'category', owner: {}, text, lines: [text],
      typeRole: plan.typeRole, font: plan.font, priority: PRIORITY.endpoint,
      candidates: [{ slot: 'below', rect: { x, y: top + row.offset, w, h }, penalty: 0 }],
    };
  })];
}

/**
 * An upright name centres on its category as a block, so each of its lines
 * centres in that block too; a one-line or rotated name keeps the
 * solver's start alignment.
 */
export function categoryLineAlign(plan: Pick<CategoryRowPlan, 'rotation' | 'infos'>, index: number): { align?: 'middle' } {
  return plan.rotation === 0 && (plan.infos[index]?.lines.length ?? 0) > 1 ? { align: 'middle' } : {};
}

const SIN45 = Math.SQRT1_2;

/**
 * Air between the baseline and the corner of a 45° name's glyph box (px).
 * 5, not 3: at 3 the corner sits within 1 px of the baseline, and the
 * lines-behind-text pass then cuts the baseline at every name (a line
 * never touches text, so the name moves, not the baseline).
 */
export const ROTATED_NAME_AIR = 5;

/** English ordinal of a stride for warnings: 2nd, 3rd, 11th, 21st. */
const nth = (k: number) => `${k}${k % 100 >= 11 && k % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][k % 10] ?? 'th')}`;
/** Rotated names may take this share of the plot block height. */
const ROTATED_HEIGHT_SHARE = 0.3;
/**
 * A vertical name may take this share of the plot block height, and never
 * less than VERTICAL_MIN_WIDTH: it stands in its own column and takes height
 * alone, so a whole two-word name ("Packaging damage", 113 px at 13 px) beats a cut.
 */
const VERTICAL_HEIGHT_SHARE = 0.5;
const VERTICAL_MIN_WIDTH = 130;
const ROTATED_MIN_WIDTH = 110;
/** The most names a date row keeps once it has to thin its interval ticks. */
const DATE_ROW_LABELS = 8;
const YEAR_LABEL = /^(?:FY\s?)?\d{4}$|^(?:FY\s?)?'?\d{2}$/;

/** Every label names a calendar period: a month, an ISO month, a week, a quarter or a year. */
export function calendarLike(labels: readonly string[]): boolean {
  return labels.length > 1 && labels.every((l) => {
    const t = l.trim();
    return MONTH_START.test(t) || /^\d{4}-(0[1-9]|1[0-2])$/.test(t) || /^W\d{1,2}\b/i.test(t) || /\bQ[1-4]\b/.test(t) || YEAR_LABEL.test(t);
  });
}

/**
 * Every label is one fixed prefix and suffix around consecutive integers
 * ("D0" to "D33", "Wave 1" to "Wave 8", "1" to "12"): an ordered sequence,
 * thinned by a uniform stride like a period row, never turned into ranks.
 */
export function numberedSequence(labels: readonly string[]): boolean {
  if (labels.length < 2) return false;
  const parts = labels.map((label) => /^(\D*)(\d+)(\D*)$/.exec(label.trim()));
  const first = parts[0];
  return first !== null && first !== undefined && parts.every((m, i) => m !== null && m[1] === first[1] && m[3] === first[3]
    && Number(m[2]) === Number(first[2]) + i);
}

function strideCandidates(labels: readonly string[]): number[] {
  const n = labels.length;
  const generic = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 24, 25, 30, 40, 50, 60, 100];
  let preferred: number[] = [];
  // Months and quarters thin by round periods only; a 5-month step reads as noise.
  if (labels.every((l) => MONTH_START.test(l.trim()) || /^\d{4}-(0[1-9]|1[0-2])$/.test(l.trim()))) return [3, 6, 12, 24, 36].filter((k) => k < n);
  if (labels.every((l) => /\bQ[1-4]\b/.test(l.trim()))) return [2, 4, 8, 12].filter((k) => k < n);
  if (labels.every((l) => YEAR_LABEL.test(l.trim()))) preferred = [2, 5, 10];
  const ordered = [...preferred, ...generic.filter((k) => !preferred.includes(k))];
  return ordered.filter((k) => k < n);
}

/** A keep list naming two categories, a before b; fits() checks just that pair. */
type PairKeep = boolean[] & { pair?: readonly [number, number] };

/** A keep list naming two categories: a sparse array, so a pair check costs no row-length work. */
function twoKept(a: number, b: number): PairKeep {
  const keep: PairKeep = [];
  keep[a] = true;
  keep[b] = true;
  keep.pair = [a, b];
  return keep;
}

/**
 * Uniform stride for a date/numeric row. Line-family rows count back from
 * the latest period. Other rows keep their existing first-period policy.
 */
function strideAfterFontLadder(
  labels: readonly string[],
  infos: CategoryLabelInfo[],
  baseFont: FontSpec,
  requested: readonly boolean[] | undefined,
  /**
   * Categories the stride may not thin away: one carrying a footnote
   * reference is the only thing on the canvas that points at its note, and
   * a stride that drops it leaves "1) …" in the frame naming nothing.
   * Whether the row then fits is the cascade's problem, as it is
   * for any kept tick.
   */
  pinned: readonly boolean[],
  dateStride: CategoryRowInput['dateStride'],
  fits: (infos: CategoryLabelInfo[], keep: readonly boolean[]) => boolean,
  plan: (
    font: FontSpec,
    infos: CategoryLabelInfo[],
    keep: boolean[],
    stepName: CategoryRowStep,
    extra?: Partial<Pick<CategoryRowPlan, 'stride' | 'rotation' | 'warnings'>>,
  ) => CategoryRowPlan,
  /** Labels that name the year: a routine label they overlap yields to them. */
  yearPins: readonly boolean[] = [],
  fromEnd = false,
  /** A calendar row thins by at least this step (the reference room's answer), in dateStride ordinals. */
  minStride = 0,
): CategoryRowPlan {
  const n = labels.length;
  // Only the two kept entries: fits() skips every hole, and a row of 100,000 dates no longer allocates one per check.
  const pair = twoKept;
  const yieldToPins = (keep: boolean[]) => {
    for (let i = 0; i < n; i++) {
      if (!pinned[i] || !keep[i]) continue;
      for (const dir of [-1, 1]) {
        for (let j = i + dir; j >= 0 && j < n; j += dir) {
          if (!keep[j]) continue;
          if (pinned[j] || fits(infos, pair(Math.min(i, j), Math.max(i, j)))) break;
          keep[j] = false;
        }
      }
    }
  };
  // A stride over a caller's `keep` counts the kept ticks,
  // not the category index. By index, every 2nd of ticks on odd categories kept none of them.
  const requestedRank: number[] = [];
  if (requested) { let rank = 0; labels.forEach((_, i) => { requestedRank.push(requested[i] ? rank++ : rank); }); }
  const ordinal = (i: number) => (dateStride ? dateStride.ordinals[i]! : requested ? requestedRank[i]! : i);
  // With year labels the rhythm restarts at each of them, so a wide
  // "1 Jan 2026" does not break the gaps around it, and a stride counts only
  // when the gaps it draws stay k or k±1 apart. The gap into the always-shown
  // last label follows its own rule and does not count. If no stride keeps
  // that rhythm, the second pass takes the plain stride from the first label.
  const restart: number[] = [];
  labels.forEach((_, i) => restart.push(yearPins[i] ? i : (restart[i - 1] ?? -1)));
  const steady = (keep: readonly boolean[], k: number) => {
    const drawn = labels.map((_, i) => i).filter((i) => keep[i]);
    const gaps = drawn.slice(1).map((i, d) => ordinal(i) - ordinal(drawn[d]!));
    if (requested === undefined) gaps.pop();
    return gaps.every((g) => Math.abs(g - k) <= 1) && maxOf(gaps) - minOf(gaps) <= 1;
  };
  const ticks = requested?.filter(Boolean).length ?? n;
  const calendar = dateStride?.calendar === true;
  // Ordinals count months on a default calendar row, so a step of k months is k / perStep categories.
  const each = calendar && requested === undefined ? dateStride!.perStep ?? 1 : 1;
  const candidates = dateStride ? dateStride.strides.filter((k) => k < ticks * each && k >= minStride) : strideCandidates(labels);
  // The smallest step that fits wins. Line-family rows use the latest period
  // as their origin and never add an off-step label. Elsewhere the last label
  // shows where it fits beside the nearest drawn name and never pushes it out,
  // which would break the step (thin only where names collide).
  const attempt = (k: number, restartAtYears: boolean): CategoryRowPlan | undefined => {
    const from = (i: number) => fromEnd ? ordinal(n - 1) : (restartAtYears && restart[i]! >= 0 ? ordinal(restart[i]!) : 0);
    const onStride = (i: number) => (ordinal(i) - from(i)) % k === 0;
    const keep = labels.map((_, i) => (!fromEnd && pinned[i]!) || (onStride(i) && (requested?.[i] ?? true)));
    if (!fromEnd && requested === undefined && !keep[n - 1]) {
      let previous = n - 2;
      for (;;) {
        while (previous >= 0 && !keep[previous]) previous -= 1;
        if (previous < 0 || fits(infos, pair(previous, n - 1))) { keep[n - 1] = true; break; }
        if (!dateStride || pinned[previous]) break;
        keep[previous] = false;
      }
    }
    if (!fromEnd) yieldToPins(keep);
    const shown = keep.filter(Boolean).length;
    // A thinned date row keeps a calm rhythm: the first round stride that fits
    // with at most DATE_ROW_LABELS names, every tenth year rather than every fifth.
    if (dateStride && requested !== undefined && shown > DATE_ROW_LABELS && candidates.some((next) => next > k)) return undefined;
    if (!fits(infos, keep) || (restartAtYears && !steady(keep, k))) return undefined;
    return plan(baseFont, infos, keep, 'stride', {
      stride: k / each,
      warnings: [
        {
          code: 'category-stride',
          severity: 'info',
          message: `category labels: showing every ${nth(k / each)} of ${ticks} (${shown} drawn) — the row does not fit all at ${baseFont.size}px`,
          suggest: 'widen the canvas or aggregate the periods to show every label',
        },
      ],
    });
  };
  for (const restartAtYears of !fromEnd && yearPins.some(Boolean) ? [true, false] : [false]) {
    for (const k of candidates) {
      const found = attempt(k, restartAtYears);
      if (!found) continue;
      // A step that divides the row, so both ends sit on it, wins when it is
      // at most twice the smallest step that fits and still draws a middle name.
      if (!fromEnd && !dateStride && (requested === undefined || pinned[n - 1]) && !restartAtYears && (n - 1) % k !== 0) {
        for (const d of candidates.filter((d) => d > k && d <= 2 * k && 2 * d <= n - 1 && (n - 1) % d === 0).sort((a, b) => a - b)) {
          const both = attempt(d, false);
          if (both) return both;
        }
      }
      // Line family (stride from the latest period): a step
      // that also lands on the first period wins when it is at most twice the
      // smallest round step that fits and still draws a middle name, so the row
      // names both ends (line.bump: Q1'23 · Q4'23 · Q3'24 · Q2'25). The step
      // stays a round one for its labels; a quarter row may also step by three
      // quarters. A month row keeps its 3, 6 and 12 (no 5-month step).
      if (fromEnd && !dateStride && requested === undefined && (n - 1) % k !== 0) {
        const quarterRow = labels.every((l) => /\bQ[1-4]\b/.test(l.trim()));
        for (const d of [...new Set([...candidates, ...(quarterRow ? [3] : [])])].sort((a, b) => a - b)) {
          if (d === k || d > 2 * k || 2 * d > n - 1 || (n - 1) % d !== 0) continue;
          const both = attempt(d, false);
          if (both) return both;
        }
      }
      return found;
    }
  }
  if (fromEnd || calendar) return plan(baseFont, infos, labels.map((_, i) => i === n - 1 || pinned[i]!), 'stride', {
    stride: n,
    warnings: [{ code: 'category-stride', severity: 'warn', message: `category labels: only the latest of ${n} fits — the axis is too narrow for its periods`, suggest: 'widen the canvas or aggregate the periods' }],
  });
  let keep = labels.map((_, i) => pinned[i]! || ((i === 0 || i === n - 1) && (requested?.[i] ?? true)));
  // Where the two ends collide, the first period still names the row.
  const endsFit = fits(infos, keep);
  if (!endsFit) keep = labels.map((_, i) => pinned[i]! || (i === 0 && (requested?.[i] ?? true)));
  return plan(baseFont, infos, keep, 'stride', {
    stride: n - 1,
    warnings: [
      {
        code: 'category-stride',
        severity: 'warn',
        message: `category labels: only the first${endsFit ? ' and last' : ''} of ${n} fit — the axis is too narrow for its periods`,
        suggest: 'widen the canvas or aggregate the periods',
      },
    ],
  });
}

/**
 * A prose row too narrow for every name draws every k-th name
 * from the first, the smallest k that fits, so the reader counts the
 * columns in one rhythm. A name a note points at is always drawn (pinned).
 * A priority name (an outlier, a highlight) is drawn where it fits beside the
 * pinned ones, and a routine name that crowds either yields. The last name
 * shows only when it falls on the step.
 */
function namesByFit(
  labels: readonly string[],
  infos: CategoryLabelInfo[],
  baseFont: FontSpec,
  requested: readonly boolean[] | undefined,
  pinned: readonly boolean[],
  priority: readonly number[] | undefined,
  fits: (infos: CategoryLabelInfo[], keep: readonly boolean[]) => boolean,
  plan: (font: FontSpec, infos: CategoryLabelInfo[], keep: boolean[], stepName: CategoryRowStep, extra?: Partial<Pick<CategoryRowPlan, 'stride' | 'rotation' | 'warnings'>>) => CategoryRowPlan,
  ownsItsRoom: (index: number, width: number, step?: number) => boolean = () => true,
): CategoryRowPlan {
  const n = labels.length;
  const eligible = (i: number, step = 1) => (requested?.[i] ?? true) && ownsItsRoom(i, infos[i]!.w, step);
  const pair = twoKept;
  // Anchors: every pinned name, then priority names, highest first, where they fit beside the anchors.
  const anchor = labels.map((_, i) => pinned[i]!);
  labels.map((_, i) => i).filter((i) => (priority?.[i] ?? 0) > 0 && !anchor[i] && eligible(i))
    .sort((a, b) => priority![b]! - priority![a]! || a - b)
    .forEach((i) => { anchor[i] = true; if (!fits(infos, anchor)) anchor[i] = false; });
  let keep = [...anchor];
  let stride = n;
  // k = n keeps the first name alone: a row too narrow for two still names where it starts.
  for (let k = 1; k <= n; k++) {
    const candidate = labels.map((_, i) => anchor[i]! || (i % k === 0 && eligible(i, k)));
    // A step that cannot seat its first name must still draw three names; two stray
    // names skip the leading column, and the first name alone reads better.
    if ((requested?.[0] ?? true) && !candidate[0] && candidate.filter(Boolean).length < 3) continue;
    // A routine name that crowds an anchor yields to it.
    candidate.forEach((kept, i) => {
      if (!kept || anchor[i]) return;
      if (labels.some((_, j) => anchor[j] && j !== i && !fits(infos, pair(Math.min(i, j), Math.max(i, j))))) candidate[i] = false;
    });
    if (candidate.some((kept, i) => kept && !anchor[i]) && fits(infos, candidate)) { keep = candidate; stride = k; break; }
  }
  // The message counts names only: a blank label has nothing to draw.
  const named = labels.map((label) => label.trim() !== '');
  const shownNames = keep.filter((kept, i) => kept && named[i]).length;
  return plan(baseFont, infos, keep, 'stride', {
    stride,
    warnings: [{
      code: 'category-stride',
      severity: 'warn',
      message: `category labels: ${shownNames} of ${named.filter(Boolean).length} names drawn, ${stride >= n ? 'only the first' : `every ${stride === 1 ? 'one' : nth(stride)} from the first`}${priority ? ' plus priority names' : ''} — the names do not fit horizontally and the row is too narrow to rotate them`,
      suggest: 'widen the canvas, use a horizontal chart, or pass priority so the names that matter are drawn first',
    }],
  });
}

/**
 * A category row sits under the axis, and where bars go below zero,
 * under the lowest bar and the value label that hangs under it. A name never
 * crosses to the other side of the axis, where a positive bar prints its
 * value. This is the height the plot gives up so that the lowest hanging
 * label fits between its bar and the row: nothing when the domain's headroom
 * under that bar already holds it. `lowest` is the lowest bar end that hangs
 * a label, in data units; `room` is the label's height plus its gap.
 */
export function hangingLabelReserve(plotH: number, domain: readonly [number, number], lowest: number | undefined, room: number): number {
  if (lowest === undefined || !(lowest < 0) || room <= 0) return 0;
  const [lo, hi] = domain;
  // The share of the plot under the lowest bar; the label overflows it by
  // room - share * height, and the reserve shrinks the height it is taken from.
  const share = hi > lo ? (lowest - lo) / (hi - lo) : 0;
  return Math.max(0, (room - share * plotH) / (1 - share));
}

/**
 * Top of that row for prose names: under the baseline, the lowest bar end
 * (`lowestEnd`) and the label hanging from the lowest bar that hangs one
 * (`hangingEnd`, `room` as above). With no bar below zero it is the baseline.
 */
export function categoryRowTop(y: (value: number) => number, lowestEnd: number, hangingEnd: number | undefined, room: number): number {
  return Math.max(y(Math.min(0, lowestEnd)), hangingEnd === undefined || !(hangingEnd < 0) ? -Infinity : y(hangingEnd) + room);
}

/**
 * A row of full month names that does not fit as authored prints
 * the language's short names ("Jan", "Feb") before it wraps or thins, and
 * keeps the full name as the label's title.
 */
// A layout plans the same row many times over its frame passes; the plan is a pure function of the input.
// The plans live for one render only: withLayoutMemo (sizing.ts) opens them at the outermost render and drops
// them at its end. Outside a render nothing is kept.
let rowPlans: Map<TextMeasurer, Map<string, CategoryRowPlan>> | undefined;
/** Run one top-level render with an empty row-plan cache; nested renders share it. */
export function withCategoryRowPlans<T>(run: () => T): T {
  if (rowPlans) return run();
  rowPlans = new Map();
  try { return run(); } finally { rowPlans = undefined; }
}
/** The number of cached row plans (0 outside a render). */
export const cachedCategoryRowPlans = (): number => [...rowPlans?.values() ?? []].reduce((sum, plans) => sum + plans.size, 0);
export function planCategoryRow(input: CategoryRowInput): CategoryRowPlan {
  if (!rowPlans) { const cascade = planCategoryRowCascade(input); return spreadUpright(input, cascade) ?? cascade; }
  let plans = rowPlans.get(input.measure);
  if (!plans) rowPlans.set(input.measure, plans = new Map());
  const key = JSON.stringify({ ...input, measure: undefined });
  let plan = plans.get(key);
  if (!plan) {
    const cascade = planCategoryRowCascade(input);
    plans.set(key, plan = spreadUpright(input, cascade) ?? cascade);
  }
  // Callers append to the lint list; each gets its own.
  return { ...plan, warnings: [...plan.warnings], cutNotes: [...plan.cutNotes] };
}

/**
 * A one-word name wider than its column ("Volume" at 320 px) would turn the
 * whole row 45°. So a prose row first tries its names upright, each free to use the room up to its
 * neighbours' centres (the row's spread step keeps every name over its own bar and
 * clear of the next names). It keeps that row only when it draws as many names as
 * the rotated row, every one whole on one line. Rows with their own per-category
 * widths (mekko) keep the cascade's answer.
 */
function spreadUpright(input: CategoryRowInput, plan: CategoryRowPlan): CategoryRowPlan | undefined {
  const n = input.labels.length;
  if (plan.rotation === 0 || plan.dateNumeric || input.widths || n < 3 || input.spreadBeforeRotate === false
) return undefined;
  const { centers, step } = input;
  const [x0, x1] = input.range ?? [centers[0]! - step / 2, centers[n - 1]! + step / 2];
  const font = input.fonts[0]!;
  // An end name may use its own width, but never past the plot's edge.
  const endRoom = (i: number) => Math.max(step, Math.min(input.measure(input.labels[i]!, font).width,
    2 * (i === 0 ? centers[0]! - x0 : x1 - centers[n - 1]!)));
  const upright = planCategoryRowCascade({ ...input, widths: input.labels.map((_, i) => (i === 0 || i === n - 1 ? endRoom(i) : 2 * step - 8)) });
  const drawn = (p: CategoryRowPlan) => p.keep.filter(Boolean).length;
  const whole = (p: CategoryRowPlan, lines: number) => p.rotation === 0 && drawn(p) >= drawn(plan)
    && p.infos.every((info, i) => !p.keep[i] || (!info.truncated && info.lines.length <= lines));
  if (whole(upright, 1)) return upright;
  // A name of several words wraps at its spaces onto two lines ("New / items")
  // before the row turns 45° (pvm at 320 px). Each slot
  // is the pitch, or the name's widest word where that is wider, so the wrap
  // happens; the spread step then moves the names apart, each over its own bar.
  const font0 = input.fonts[0]!;
  const widestWord = (label: string) => Math.max(0, ...label.split(/\s+/).filter(Boolean).map((word) => input.measure(word, font0).width));
  const wrapped = planCategoryRowCascade({ ...input, widths: input.labels.map((label, i) => (i === 0 || i === n - 1 ? endRoom(i) : Math.max(step, Math.ceil(widestWord(label)) + 1))) });
  return whole(wrapped, PROSE_TICK_MAX_LINES) ? wrapped : undefined;
}

function planCategoryRowCascade(input: CategoryRowInput): CategoryRowPlan {
  // All row attempts share exact text measurements, including words and cut prefixes.
  const measured = new Map<FontSpec, Map<string, TextSize>>();
  const sourceMeasure = input.measure;
  const measure: TextMeasurer = (text, font) => {
    let texts = measured.get(font);
    if (!texts) measured.set(font, texts = new Map());
    let size = texts.get(text);
    if (!size) {
      const { width, height, ascent } = sourceMeasure(text, font);
      texts.set(text, size = { width, height, ascent });
    }
    return size;
  };
  input = withCalendarRule({ ...input, measure });
  const bundled = sourceMeasure === defaultMeasurer || sourceMeasure === measureText;
  let plan = planRow(input, bundled);
  // Longer weekday labels cannot fit where the shorter date labels already need thinning.
  const weekdays = plan.step === 'fit' && input.calendar?.length === input.labels.length
    && input.calendar.every((info, i) => info?.weekday?.endsWith(` ${input.labels[i]}`)) ? input.calendar.map(info => info!.weekday!) : undefined;
  const withWeekdays = weekdays && planRow({ ...input, labels: weekdays }, bundled);
  if (withWeekdays?.step === 'fit') return withWeekdays;
  if (input.strideFromEnd && input.calendar && !plan.yearRow) {
    const drawnYears = new Set(input.calendar.flatMap((info, i) => info && plan.keep[i] ? [info.year] : []));
    const namedYears = new Set(input.calendar.flatMap((info, i) => info && plan.keep[i] && (info.yearShown || input.labels[i]!.includes(String(info.year))) ? [info.year] : []));
    if ([...drawnYears].some(year => !namedYears.has(year))) {
      // A calendar year stays visible without pinning an off-step date.
      input = { ...input,
        labels: input.labels.map((label, i) => input.calendar![i]?.yearShown ? label.replace(new RegExp(` ${input.calendar![i]!.year}$`), '') : label),
        calendar: input.calendar.map(info => info ? { ...info, yearShown: false, yearRow: true } : info),
      };
      plan = planRow(input, bundled);
    }
  }
  const short = plan.step === 'fit' ? undefined : shortMonthNames(input.labels);
  if (!short) return plan;
  const shortPlan = planRow({ ...input, labels: short }, bundled);
  return { ...shortPlan, infos: shortPlan.infos.map((info, i) => ({ ...info, title: info.title ?? input.labels[i]! })) };
}

/**
 * One tick rule for every chart type. Rows of months or
 * quarters take calendar-aligned ticks plus the latest period; rows of days or
 * weeks count equal steps back from the latest period. Rows without dates, and
 * rows that already carry a caller's own interval, keep their rule.
 */
function withCalendarRule(input: CategoryRowInput): CategoryRowInput {
  if (input.dateStride || !input.dates) return input;
  const calendar = calendarMonths(input.dates);
  if (!calendar) return input;
  if (!calendar.months) {
    return calendar.unit === 'day' || calendar.unit === 'week' ? { ...input, strideFromEnd: true } : input;
  }
  // Calendar-aligned steps in months: a tick sits on a month whose index is a multiple of the step (3: Jan, Apr, Jul, Oct).
  // These are the round steps; a row of quarters starts at 6.
  const quarters = calendar.unit === 'quarter';
  return { ...input, dateStride: { ordinals: calendar.months, strides: quarters ? [6, 12, 24, 36] : [3, 6, 12, 24, 36], calendar: true, perStep: quarters ? 3 : 1 } };
}

/** Each language's lowercase full month names, by their first index. */
const lowerMonths = new Map<readonly string[], Map<string, number>>();

/** Full month names of one language as that language's short names; undefined for any other row. */
function shortMonthNames(labels: readonly string[]): string[] | undefined {
  if (labels.length < 2) return undefined;
  const lower = labels.map((label) => label.trim().toLowerCase());
  for (const language of DATE_NAME_LANGUAGES) {
    const { months, monthsShort } = dateNames(language);
    let byName = lowerMonths.get(months);
    if (!byName) {
      byName = new Map();
      months.forEach((month, i) => { if (!byName!.has(month.toLowerCase())) byName!.set(month.toLowerCase(), i); });
      lowerMonths.set(months, byName);
    }
    const index: number[] = [];
    for (const label of lower) {
      const i = byName.get(label);
      if (i === undefined) break;
      index.push(i);
    }
    if (index.length === lower.length && index.some((i) => monthsShort[i] !== months[i])) return index.map((i) => monthsShort[i]!);
  }
  return undefined;
}

function planRow(input: CategoryRowInput, bundled: boolean): CategoryRowPlan {
  const { labels, centers, step, measure } = input;
  const n = labels.length;
  const dateNumeric = (input.calendar?.length === n && input.calendar.every(Boolean)) || isDateNumericTickSequence(labels);
  const periodRow = dateNumeric || input.periods === true || calendarLike(labels);
  // A period row keeps the muted secondary role but prints at the label step.
  const secondary = periodRow && input.secondary !== undefined && input.secondary.size < input.fonts[0]!.size ? { ...input.secondary, size: input.fonts[0]!.size } : undefined;
  const ladder = secondary ? [secondary, ...input.fonts.filter(font => font.size < secondary.size)] : input.fonts;
  const fonts = ladder.filter((font, index) => index === 0 || font.size >= targetFloorsPx(input.target ?? DEFAULT_TARGET, input.textScale)[secondary ? 'secondary' : 'axis']);
  // 4 px between neighbouring names; the row thins only where names collide.
  const gap = input.gap ?? 4;
  const padding = input.padding ?? 6;
  const allowRotate = input.rotate ?? true;
  const orderedProse = (input.ordered || input.strideFromEnd || numberedSequence(labels)) && !dateNumeric;
  const baseFont = fonts[0]!;
  // Custom metrics and negative tracking need the exact wrap path.
  const growingWidths = (font: FontSpec) => bundled && font.size > 0 && (font.letterSpacing ?? 0) >= 0;

  const maxRotatedWidth = input.maxRotatedWidth ?? rotatedWidthCap(input.plotHeight, n * step, baseFont);
  const widthAt = (i: number): number => input.widths?.[i] ?? step;
  const suffixAt = (i: number): string => input.suffixes?.[i] ?? '';
  /** The mark goes on the last line after the fit, so no cut can eat it. */
  const withSuffix = (info: CategoryLabelInfo, i: number, font: FontSpec): CategoryLabelInfo => {
    const suffix = suffixAt(i);
    if (!suffix) return info;
    const lines = [...info.lines];
    lines[lines.length - 1] = `${lines[lines.length - 1] ?? ''}${suffix}`;
    return { ...info, lines, w: info.w + measure(suffix, font).width };
  };
  const measuredRows = new Map<FontSpec, Map<string, CategoryLabelInfo[]>>();
  const measureAll = (font: FontSpec, maxLines: number, preserveBreaks = false, pad = padding): CategoryLabelInfo[] => {
    let rows = measuredRows.get(font);
    if (!rows) measuredRows.set(font, rows = new Map());
    const key = maxLines <= 1 ? `1:${preserveBreaks}` : `${maxLines}:${pad}`;
    const cached = rows.get(key);
    if (cached) return cached;
    const infos = labels.map((label, i) => {
      const reserve = suffixAt(i) ? measure(suffixAt(i), font).width : 0;
      if (dateNumeric || maxLines <= 1) {
        // An ordered horizontal row measures each authored line before thinning.
        const lines = preserveBreaks ? label.split('\n') : [label];
        return withSuffix({
          lines,
          w: Math.max(...lines.map(line => measure(line, font).width), 1),
          h: lines.length * font.size * (font.lineHeight ?? 1.2),
          truncated: false,
        }, i, font);
      }
      const width = Math.max(widthAt(i) - pad - reserve, 1);
      const single = !growingWidths(font) || /[\n\u200d\u{E0020}-\u{E007F}]/u.test(label) ? undefined : label.split(/[^\S\u00a0\u202f]+/).filter(Boolean).join(' ');
      if (single !== undefined && measure(single, font).width <= width) {
        return withSuffix({ lines: [single], w: Math.max(measure(single, font).width, 1), h: font.size * (font.lineHeight ?? 1.2), truncated: false }, i, font);
      }
      const wrap = fitText(label, font, width, maxLines, measure);
      const lines = wrap.lines.length ? wrap.lines : [''];
      return withSuffix({
        lines,
        w: Math.max(...lines.map((l) => measure(l, font).width), 1),
        h: lines.length * font.size * (font.lineHeight ?? 1.2),
        truncated: wrap.title !== undefined,
        ...(wrap.title !== undefined ? { title: wrap.title } : {}),
      }, i, font);
    });
    rows.set(key, infos);
    return infos;
  };

  // Breaks can remove whitespace; a ZWJ or Unicode tag can join a word to the preceding space.
  const words = labels.map(label => /[\n\u200d\u{E0020}-\u{E007F}]/u.test(label) ? [] : label.split(/[^\S\u00a0\u202f]+/).filter(Boolean));
  // A word wider than the slot must be cut at every line count; defer that work to the cut fallback.
  const wholeRows = (font: FontSpec, maxLines: number, pad = padding, kept?: readonly boolean[]) =>
    growingWidths(font) && words.some((parts, i) => (!kept || kept[i]) && parts.some(word => measure(word, font).width > Math.max(widthAt(i) - pad - (suffixAt(i) ? measure(suffixAt(i), font).width : 0), 1)))
      ? undefined : measureAll(font, maxLines, false, pad);

  // A label centres on its category. Points on the plot edges
  // anchor their labels inward; a centred label never leaves the
  // outer edges of the first and last band, so it cannot reach into a
  // value-axis column beside the plot, which the inward anchoring of date
  // and number rows guards against.
  const rowStart = n > 0 ? centers[0]! - widthAt(0) / 2 : 0;
  const rowEnd = n > 0 ? centers[n - 1]! + widthAt(n - 1) / 2 : 0;
  let stridingOrdered = false;
  /** Left edges of names moved apart inside the row (gap repair); undefined when names centre. */
  let spreadX: number[] | undefined;
  const anchor = (i: number, w: number): number => spreadX?.[i] !== undefined ? spreadX[i]!
    : input.edgeAnchored === true || stridingOrdered
    ? tickLabelX(centers[i]!, w, i, n, true)
    : Math.max(rowStart, Math.min(centers[i]! - w / 2, rowEnd - w));
  const xOf = (infos: CategoryLabelInfo[]) => (i: number): number => anchor(i, infos[i]!.w);
  /** A name stays between the centres of the names `step` places away, its drawn neighbours on a thinned row. */
  const ownsItsRoom = (i: number, w: number, step = 1): boolean => {
    const x = anchor(i, w);
    return (i - step < 0 || x >= centers[i - step]!) && (i + step > n - 1 || x + w <= centers[i + step]!);
  };

  const fits = (infos: CategoryLabelInfo[], keep: readonly boolean[], minGap = gap): boolean => {
    const x = xOf(infos);
    const two = (keep as PairKeep).pair;
    if (two) {
      const [a, b] = two;
      return !(x(a) + infos[a]!.w + (pinned[a] && pinned[b] ? Math.min(minGap, 4) : minGap) > x(b));
    }
    let previous: number | undefined;
    for (let i = 0; i < n; i++) {
      if (!keep[i]) continue;
      // Two pinned labels both stay, so they keep 4 px between them.
      const need = previous !== undefined && pinned[previous] && pinned[i] ? Math.min(minGap, 4) : minGap;
      if (previous !== undefined && x(previous) + infos[previous]!.w + need > x(i)) return false;
      previous = i;
    }
    return true;
  };

  const requested = input.keep;
  // A category that carries a reference mark is drawn whatever the tick
  // filter asked for: it is what the reader follows the note back to.
  const calendarRule = input.dateStride?.calendar === true;
  const yearPins = labels.map((_, i) => !input.strideFromEnd && !calendarRule && input.calendar?.[i]?.yearShown === true);
  // Consecutive categories of one year (one month under days) share a period-row label.
  const yearSpans: { year: number; month?: string; from: number; to: number }[] = [];
  input.calendar?.forEach((info, i) => {
    if (!info?.yearRow && !info?.monthRow) return;
    const last = yearSpans.at(-1);
    if (last && last.year === info.year && last.month === info.monthRow && last.to === i - 1) last.to = i;
    else yearSpans.push({ year: info.year, ...(info.monthRow ? { month: info.monthRow } : {}), from: i, to: i });
  });
  // A calendar row always names its latest period; the aligned tick before it yields if the two collide.
  const underAt = (i: number): string => input.under?.[i] ?? '';
  const pinned = labels.map((_, i) => calendarRule ? i === n - 1 || suffixAt(i) !== '' || underAt(i) !== '' || input.pinned?.[i] === true
    : input.strideFromEnd ? i === n - 1 || underAt(i) !== '' : suffixAt(i) !== '' || underAt(i) !== '' || yearPins[i]! || input.pinned?.[i] === true);
  const all = labels.map((_, i) => pinned[i]! || (requested?.[i] ?? true));
  /**
   * The months under a row of day numbers: each starts where its first day's
   * name starts. Where two would touch, the earlier one drops, so the latest
   * month always prints; the first month printed and each change of year carry the year.
   */
  const monthRow = (xAt: (i: number) => number, font: FontSpec, lineH: number) => {
    const kept: { span: typeof yearSpans[number]; x: number }[] = [];
    for (let s = yearSpans.length - 1; s >= 0; s--) {
      const span = yearSpans[s]!;
      // Measured with the year, so a month that gains it later still fits.
      const w = measure(`${span.month} ${span.year}`, font).width;
      const x = Math.max(rowStart, Math.min(xAt(span.from), rowEnd - w));
      if (kept.length > 0 && x + w + 2 * gap > kept[0]!.x) continue;
      kept.unshift({ span, x });
    }
    return kept.map(({ span, x }, k) => {
      const text = k === 0 || kept[k - 1]!.span.year !== span.year ? `${span.month} ${span.year}` : span.month!;
      return { id: `category-month:${span.year}-${span.month}`, text, x, w: measure(text, font).width, h: lineH };
    });
  };
  const plan = (
    font: FontSpec,
    infos: CategoryLabelInfo[],
    keep: boolean[],
    stepName: CategoryRowStep,
    extra: Partial<Pick<CategoryRowPlan, 'stride' | 'rotation' | 'warnings' | 'cutNotes'>> = {},
  ): CategoryRowPlan => {
    const rotation = extra.rotation ?? 0;
    // A rotated name has room along its slant, so its `under` words follow it there.
    if (rotation !== 0 && input.under?.some(Boolean)) {
      infos = infos.map((info, i) => {
        const words = underAt(i);
        if (!words || !keep[i]) return info;
        const lines = [...info.lines];
        lines[lines.length - 1] = `${lines[lines.length - 1] ?? ''} ${words}`;
        return { ...info, lines, w: info.w + measure(` ${words}`, font).width };
      });
    }
    const drawn = infos.filter((_, i) => keep[i]);
    const maxLines = rotation ? 1 : Math.max(1, maxOf(drawn.map((info) => info.lines.length)));
    const lineH = font.size * (font.lineHeight ?? 1.2);
    const labelsHeight = rotation === 90
      ? Math.max(maxOf(drawn.map((info) => info.w)), 1)
      : rotation
        ? Math.max(maxOf(drawn.map((info) => info.w)), 1) * SIN45 + lineH * SIN45
        : maxLines * lineH;
    // An upright `under` line centres under its name, inside the row's ends.
    const xAt = xOf(infos);
    const hasMonths = yearSpans.some(span => span.month);
    let years = hasMonths ? monthRow(xAt, font, lineH) : yearSpans.map(({ year, from, to }) => {
      const w = measure(String(year), font).width;
      return { id: `category-year:${year}`, text: String(year), w, h: lineH, x: Math.max(rowStart, Math.min((centers[from]! + centers[to]!) / 2 - w / 2, rowEnd - w)) };
    });
    if (!hasMonths && input.calendar?.[yearSpans[0]?.from ?? -1]?.unit === 'day'
      && years.some((year, i) => i > 0 && years[i - 1]!.x + years[i - 1]!.w + gap > year.x)) {
      // Crowded years follow the surviving day ticks, rather than displacing their years in the solver.
      const keptYears = new Set(input.calendar.flatMap((info, i) => info && keep[i] ? [String(info.year)] : []));
      years = years.filter(year => keptYears.has(year.text));
    }
    const underItems = rotation !== 0 ? [] : labels.flatMap((_, i) => {
      const text = underAt(i);
      if (!text || !keep[i]) return [];
      const w = measure(text, font).width;
      const mid = xAt(i) + infos[i]!.w / 2;
      return [{ index: i, text, w, h: lineH, x: Math.max(rowStart, Math.min(mid - w / 2, rowEnd - w)) }];
    });
    const namesHeight = labelsHeight + (underItems.length > 0 ? YEAR_ROW_GAP + lineH : 0);
    const rowHeight = namesHeight + (years.length > 0 ? YEAR_ROW_GAP + lineH : 0);
    return {
      dateNumeric,
      typeRole: secondary ? 'secondary' : 'axis',
      font,
      infos,
      keep,
      stride: extra.stride ?? 1,
      rotation,
      maxLines,
      rowHeight,
      x: xOf(infos),
      anchor,
      step: stepName,
      warnings: extra.warnings ?? [],
      cutNotes: extra.cutNotes ?? [],
      ...(years.length > 0 ? { yearRow: { offset: namesHeight + YEAR_ROW_GAP, years } } : {}),
      ...(underItems.length > 0 ? { underRow: { offset: labelsHeight + YEAR_ROW_GAP, items: underItems } } : {}),
    };
  };

  /**
   * The step a calendar row takes in the room the frame gives the plot (the
   * `reference`). Panels with the same categories and the same frame ask the
   * same question, so a gutter for end values, a value axis or a rotated name
   * on one panel cannot move its ticks off the others'.
   */
  const referenceStride = (): number => {
    if (!calendarRule || !input.reference) return 0;
    const pitch = input.reference.width / n;
    const reference = planRow({
      ...input, reference: undefined, step: pitch, edgeAnchored: false,
      centers: labels.map((_, i) => input.reference!.x + pitch * (i + 0.5)),
    }, bundled);
    return reference.step === 'stride' ? reference.stride * (input.dateStride?.perStep ?? 1) : 0;
  };

  // Sparse authored labels: when most categories are blank, only the
  // names count. A blank label draws nothing, so it cannot collide, and a stride over
  // every category must not skip a name the author put there.
  const blank = labels.map((label) => label.replace(/[\s\u200b]/g, '') === '');
  const names = blank.filter((isBlank) => !isBlank).length;
  if (periodRow && names > 0 && names * 2 < n) {
    // A name yields only where it collides with another name: the later one drops, unless it is pinned (the latest period).
    for (let f = 0; ; f++) {
      const font = fonts[f]!;
      const infos = measureAll(font, 1, true);
      const collides = (before: number, after: number): boolean => {
        const need = pinned[before] && pinned[after] ? Math.min(gap, 4) : gap;
        return anchor(before, infos[before]!.w) + infos[before]!.w + need > anchor(after, infos[after]!.w);
      };
      const keep = labels.map((_, i) => !blank[i]);
      const dropped: string[] = [];
      const kept: number[] = [];
      for (let i = 0; i < n; i++) {
        if (!keep[i]) continue;
        for (let before = kept.at(-1); before !== undefined && collides(before, i); before = kept.at(-1)) {
          const loser = pinned[i] && !pinned[before] ? before : i;
          keep[loser] = false;
          dropped.push(labels[loser]!);
          if (loser === i) break;
          kept.pop();
        }
        if (keep[i]) kept.push(i);
      }
      if (dropped.length === 0 || f === fonts.length - 1) {
        return plan(font, infos, keep, f === 0 ? 'fit' : 'font-down', dropped.length === 0 ? {} : {
          stride: 1,
          warnings: [{
            code: 'category-stride',
            severity: 'warn',
            message: `category labels: ${names - dropped.length} of ${names} names drawn, ${dropped.map((label) => `'${label}'`).join(', ')} collide with a neighbouring name`,
          }],
        });
      }
    }
  }

  if (dateNumeric || orderedProse) {
    for (let f = 0; f < fonts.length; f++) {
      const font = fonts[f]!;
      const infos = measureAll(font, 1, orderedProse);
      if (fits(infos, all) && (!orderedProse || infos.every((info, i) => !all[i] || info.w <= rowEnd - rowStart))) {
        return plan(font, infos, all, f === 0 ? 'fit' : 'font-down', {
          warnings:
            f === 0
              ? []
              : [
                  {
                    code: 'category-font-stepped',
                    severity: 'info',
                    message: `category labels use the ${font.size}px step so all ${n} fit on one row`,
                  },
                ],
        });
      }
    }
    if (dateNumeric) {
      const font = fonts.at(-1)!;
      return strideAfterFontLadder(labels, measureAll(font, 1), font, requested, pinned, input.dateStride, fits, plan, yearPins, input.strideFromEnd && !calendarRule, referenceStride());
    }
  }

  // A short whole name can fit even when the wrap budget would cut it. Authored line breaks stay.
  const plain = measureAll(baseFont, 1, true);
  // Names of words keep half an em between them on one line; closer,
  // "New items Lost items" reads as one name. A name with a
  // short token ("Wave 1") stays whole. Thinning keeps the 4 px floor.
  const wordy = labels.some((label) => /\S\s+\S/.test(label)) && labels.every((label) => label.trim().split(/\s+/).every((word) => word.length >= 3));
  const plainGap = wordy ? Math.max(gap, baseFont.size / 2) : gap;
  if (plain.every((info, i) => info.w + gap <= widthAt(i)) && fits(plain, all, plainGap)) return plan(baseFont, plain, all, 'fit');

  // Prose: wrap to two lines, then three, then step the font down, then rotate.
  const two = wholeRows(baseFont, PROSE_TICK_MAX_LINES);
  if (two && !two.some((info) => info.truncated) && fits(two, all)) {
    return plan(baseFont, two, all, two.some((info) => info.lines.length > 1) ? 'wrap' : 'fit');
  }
  const three = wholeRows(baseFont, 3);
  if (three && !three.some((info) => info.truncated) && fits(three, all)) return plan(baseFont, three, all, 'wrap');
  for (const font of fonts.slice(1)) {
    const infos = wholeRows(font, 3);
    if (infos && !infos.some((info) => info.truncated) && fits(infos, all)) {
      return plan(font, infos, all, 'font-down', {
        warnings: [
          {
            code: 'category-font-stepped',
            severity: 'info',
            message: `category labels use the ${font.size}px step so all ${n} names fit unabridged`,
          },
        ],
      });
    }
  }
  // A row turns 45° only when a word is wider than its slot. The
  // padding is not part of the wrap budget: a wrapped name may use the whole
  // slot, and the 6 px gap between drawn neighbours is what fits() checks.
  for (const font of fonts) {
    for (const lines of [PROSE_TICK_MAX_LINES, 3]) {
      const slot = wholeRows(font, lines, 0);
      if (slot && !slot.some((info) => info.truncated) && fits(slot, all)) return plan(font, slot, all, font === baseFont ? 'wrap' : 'font-down');
    }
  }
  // Every word fits its slot and only the gap between neighbours
  // fails ("Consumer" 61.5 px beside "Enterprise" 60 px at a 64 px pitch).
  // That is a gap failure, not a width failure: the names move apart into
  // the free room of their slots, each still covering its own category's
  // centre and clear of its neighbours' centres. The font floor and the
  // three-line wrap stay; a word wider than its slot still rotates.
  for (const font of fonts) {
    for (const lines of [1, PROSE_TICK_MAX_LINES, 3]) {
      const infos = lines === 1 ? measureAll(font, 1, true, 0) : wholeRows(font, lines, 0, all);
      if (!infos || infos.some((info, i) => all[i] && (info.truncated || info.w > widthAt(i)))) continue;
      const kept = labels.flatMap((_, i) => (all[i] ? [i] : []));
      // Names moved apart keep 7 px between them where the row has the room
      // (waterfall at 320 px), so "Price Volume Gross" reads as three names;
      // else the 4 px floor.
      for (const spreadGap of [...new Set([Math.max(gap, SPREAD_GAP), gap])]) {
        const spread = spread1DResult(kept.map((i) => ({ desired: centers[i]!, size: infos[i]!.w })), [rowStart, rowEnd], spreadGap);
        if (!spread.fits) continue;
        const xs: number[] = [];
        kept.forEach((i, k) => { xs[i] = spread.positions[k]! - infos[i]!.w / 2; });
        const identified = kept.every((i) => xs[i]! <= centers[i]! && xs[i]! + infos[i]!.w >= centers[i]!
          && (i === 0 || xs[i]! >= centers[i - 1]!) && (i === n - 1 || xs[i]! + infos[i]!.w <= centers[i + 1]!));
        if (!identified) continue;
        spreadX = xs;
        if (fits(infos, all)) return plan(font, infos, all, font !== baseFont ? 'font-down' : infos.some((info) => info.lines.length > 1) ? 'wrap' : 'fit');
        spreadX = undefined;
      }
    }
  }
  if (orderedProse) {
    // Thin interior names after the font ladder; pinned periods keep their seats.
    stridingOrdered = true;
    const font = fonts.at(-1)!;
    const thinned = strideAfterFontLadder(labels, measureAll(font, 1, true), font, calendarRule && input.keep === undefined ? undefined : all, pinned, calendarRule ? input.dateStride : undefined, fits, plan, [], input.strideFromEnd && !calendarRule, referenceStride());
    // A row that names only its first period of several turns 45° instead.
    if ((input.strideFromEnd || thinned.keep.filter(Boolean).length > 1) && fits(thinned.infos, thinned.keep) && thinned.infos.every((info, i) => !thinned.keep[i] || info.w <= rowEnd - rowStart)) return thinned;
    stridingOrdered = false;
  }
  // The 6 px gap decides thinning. Whole one-line names that keep
  // 4 px stay flat rather than turn 45° ("W31" on a card).
  for (const font of fonts) {
    const flat = measureAll(font, 1, true);
    // Each name stays within its own slot (a mekko sliver keeps its name in the note).
    if (!flat.some((info) => info.truncated) && flat.every((info, i) => info.w <= widthAt(i)) && fits(flat, all, 4)) return plan(font, flat, all, font === baseFont ? 'fit' : 'font-down');
  }
  // A nominal row that keeps every name turns -90° only where 45° has no room.
  const everyName = input.everyName === true && !orderedProse;
  const room45 = allowRotate && fonts.some((font) => step * SIN45 >= font.size * (font.lineHeight ?? 1.2) + 2);
  if (allowRotate && (input.rotate90 || everyName && !room45)) {
    // Vertical names stand side by side: the pitch holds one line and 2 px.
    const upright = fonts.filter((font) => step >= font.size * (font.lineHeight ?? 1.2) + 2);
    const cap = Math.max(VERTICAL_MIN_WIDTH, Math.floor((input.plotHeight ?? 0) * VERTICAL_HEIGHT_SHARE));
    const font = upright.find((f) => measureAll(f, 1).every((info) => info.w <= cap)) ?? upright[0];
    if (font) {
      const cutNames: string[] = [];
      const infos = measureAll(font, 1).map((info, i) => {
        if (info.w <= cap) return info;
        const cut = cutWithTitle(info.lines[0]!, font, cap, measure);
        cutNames.push(labels[i]!);
        return { ...info, lines: [cut.text], w: cap, truncated: true, ...(cut.title !== undefined ? { title: cut.title } : {}) };
      });
      return plan(font, infos, all, 'rotate', {
        rotation: 90,
        warnings: [
          {
            code: 'category-labels-rotated',
            severity: 'info',
            message: `category labels rotated -90°: ${n} names do not fit horizontally on up to 3 lines at ${Math.round(step)}px per category`,
            suggest: 'a horizontal chart keeps names upright',
          },
          ...(cutNames.length > 0 ? [categoryCutLint(cutNames, false, 'on the vertical axis')] : []),
        ],
      });
    }
  }
  if (allowRotate) {
    // Rotated labels lie on parallel 45° lines; the clear distance between
    // neighbours is the pitch × sin 45°, which must hold one line of text.
    // A smaller step that holds every name whole beats a cut at the base size.
    const rotatable = fonts.filter((font) => step * SIN45 >= font.size * (font.lineHeight ?? 1.2) + 2);
    const whole = rotatable.find((font) => measureAll(font, 1).every((info) => info.w <= maxRotatedWidth));
    const font = whole ?? rotatable[0];
    if (font) {
      // The first names reach left of the row by their slant (rotatedLeftOverhang). A name no wider than the
      // cap that leaves every column the pitch of a 45° line, or the row stops rotating once the caller takes the overhang.
      const lineH = font.size * (font.lineHeight ?? 1.2);
      const spare = n * step - (n * (lineH + 2)) / SIN45 - n;
      const reach = (i: number) => (spare + centers[i]! - 4) / SIN45 - lineH;
      const pitchCap = Math.min(...measureAll(font, 1).map((info, i) => (info.w > reach(i) ? reach(i) : Infinity)));
      const cap = input.maxRotatedWidth !== undefined ? maxRotatedWidth : Math.max(ROTATED_MIN_WIDTH, Math.min(maxRotatedWidth, Math.floor(pitchCap)));
      // A rotated name longer than the cap is cut, or the plot would shrink
      // to a strip under a fan of sixty-character labels. A cut name
      // carries a note mark, and the note gives it back whole.
      const cutNotes: string[] = [];
      const cutNames: string[] = [];
      const infos = measureAll(font, 1).map((info, i) => {
        if (info.w <= cap) return info;
        // A name that already carries the author's reference keeps that one mark.
        const mark = input.cutMarkFrom === undefined || suffixAt(i) ? '' : ` ${footnoteMark(input.cutMarkFrom + cutNotes.length)}`;
        const suffix = suffixAt(i) + mark;
        const reserve = suffix ? measure(suffix, font).width : 0;
        const bare = suffixAt(i) && info.lines[0]!.endsWith(suffixAt(i)) ? info.lines[0]!.slice(0, -suffixAt(i).length) : info.lines[0]!;
        const cut = cutWithTitle(bare, font, Math.max(cap - reserve, 1), measure);
        cutNames.push(labels[i]!);
        if (mark) cutNotes.push(disclosureNote(`${mark.trim()} ${labels[i]!}.`));
        return { ...info, lines: [`${cut.text}${suffix}`], w: cap, truncated: true, ...(cut.title !== undefined ? { title: cut.title } : {}) };
      });
      return plan(font, infos, all, 'rotate', {
        rotation: 45,
        cutNotes,
        warnings: [
          {
            code: 'category-labels-rotated',
            severity: 'info',
            message: `category labels rotated 45°: ${n} names do not fit horizontally on up to 3 lines at ${Math.round(step)}px per category`,
            suggest: 'a horizontal chart (bar, or variant: "horizontal" on waterfall) keeps names upright',
          },
          ...(cutNames.length > 0 ? [categoryCutLint(cutNames, cutNotes.length === cutNames.length)] : []),
        ],
      });
    }
  }
  // The row stays horizontal: it may not rotate, or its pitch is too
  // narrow for a rotated line. Whole names are drawn where they fit, chosen
  // by fit and the caller's priority, never by a uniform stride; a row
  // of ellipses names nothing.
  const single = measureAll(baseFont, 1);
  if (!everyName && single.some((info, i) => info.w <= widthAt(i) * n - padding)) {
    return namesByFit(labels, single, baseFont, undefined, pinned, input.priority, fits, plan, ownsItsRoom);
  }
  // The cut comes last: of the wrapped and stepped-down forms that
  // still fit the row, the one that cuts the fewest names is drawn.
  const cutCount = (infos: CategoryLabelInfo[]) => infos.filter((info) => info.truncated).length;
  // A form whose labels do not overlap ranks first: an overlapping row loses
  // whole names to the solver. Among forms that fit alike, fewer cuts win.
  let last = { font: baseFont, infos: two ?? measureAll(baseFont, PROSE_TICK_MAX_LINES) };
  for (const candidate of [{ font: baseFont, infos: three ?? measureAll(baseFont, 3) }, ...fonts.slice(1).map((font) => ({ font, infos: measureAll(font, 3) }))]) {
    const fitsNow = fits(candidate.infos, all);
    const fitsLast = fits(last.infos, all);
    if ((fitsNow && !fitsLast) || (fitsNow === fitsLast && cutCount(candidate.infos) < cutCount(last.infos))) last = candidate;
  }
  // A cut that leaves a name nothing but the ellipsis names nothing: the
  // label drew as an empty line with its name only in the <title>. Such a
  // row thins to a stride of whole names instead.
  if (last.infos.some((info, i) => all[i] && info.truncated && /^…?$/.test(info.lines[0]!.trim()))) {
    return namesByFit(labels, single, baseFont, requested, pinned, input.priority, fits, plan, ownsItsRoom);
  }
  const cut = labels.filter((_, i) => last.infos[i]!.lines.some((line) => line.includes('…')));
  return plan(last.font, last.infos, all, 'ellipsis', {
    warnings: [
      {
        code: 'category-labels-truncated',
        severity: 'warn',
        message: `${cut.length} of ${n} category labels are cut with an ellipsis — the pitch of ${Math.round(step)}px holds neither the wrapped nor the rotated name: ${cut.map((label) => `'${label}'`).join(', ')}`,
        suggest: 'widen the canvas, shorten the names, or use a horizontal chart',
        detail: { cut },
      },
    ],
  });
}

/** The names a rotated row cut, and where the reader finds them whole. */
export function categoryCutLint(names: readonly string[], noted: boolean, where = 'on the rotated axis'): LintWarning {
  return {
    code: 'category-labels-truncated',
    severity: noted ? 'info' : 'warn',
    message: `${names.length === 1 ? 'one category label is' : `${names.length} category labels are`} cut ${where}: ${names.map((name) => `'${name}'`).join(', ')}` +
      (noted ? '; the full name is in the notes list' : '; the full name is in the SVG title only'),
    suggest: 'shorten the name, widen the canvas, or use a bar chart to keep names upright',
    detail: { cut: [...names] },
  };
}

/**
 * The rotated-name cap: 30% of the plot block height at 45°, and no wider
 * than half the row's width can hold at 45°, so the overhang a caller takes
 * from the plot stays inside it on a tall, narrow chart. Never under 110 px.
 */
function rotatedWidthCap(plotHeight: number | undefined, rowWidth: number, font: FontSpec): number {
  if (plotHeight === undefined) return ROTATED_MIN_WIDTH;
  const lineH = font.size * (font.lineHeight ?? 1.2);
  const byHeight = (plotHeight * ROTATED_HEIGHT_SHARE) / SIN45 - lineH;
  const byWidth = (rowWidth * 0.5) / SIN45 - lineH;
  return Math.max(ROTATED_MIN_WIDTH, Math.floor(Math.min(byHeight, byWidth)));
}

/**
 * The claim a rotated label registers with the solver: a small square at
 * its anchor. Neighbouring 45° labels lie on parallel lines and never touch,
 * but their axis-aligned boxes overlap heavily, so claiming the full box
 * would make every rotated row collide with itself. The band the chart
 * reserves from `rowHeight` is what keeps other labels out of the strip.
 *
 * `rowTop` is the top of the category row (the axis line or the lowest bar
 * above it). The square, and the name drawn from it, never starts less than
 * 3 px under it: at a large axis step a closer square reaches into the axis
 * claim, and every rotated name is hidden (pvm on cards).
 */
export function rotatedClaimRect(
  anchorX: number,
  anchorY: number,
  lineHeight: number,
  rowTop?: number,
): { x: number; y: number; w: number; h: number } {
  const y = Math.max(anchorY - (lineHeight * SIN45) / 2, rowTop === undefined ? -Infinity : rowTop + 3);
  return { x: anchorX - lineHeight, y, w: lineHeight, h: lineHeight };
}

/**
 * How far the first drawn rotated label reaches left of `minX`. A chart
 * widens its left margin by this amount and re-plans, so the name is not
 * clipped at the canvas edge.
 */
export function rotatedLeftOverhang(plan: CategoryRowPlan, centers: readonly number[], minX: number): number {
  // A vertical name stands inside its column.
  if (plan.rotation !== 45) return 0;
  const lineH = plan.font.size * (plan.font.lineHeight ?? 1.2);
  let overhang = 0;
  plan.infos.forEach((info, i) => {
    if (!plan.keep[i]) return;
    const left = centers[i]! - (info.w + lineH) * SIN45;
    overhang = Math.max(overhang, minX - left);
  });
  return Math.ceil(overhang);
}

/**
 * The box of a -90° name (CategoryRowPlan rotation 90) as the solver and the
 * label emitter use it: the emitter turns a rotated label about the right
 * edge of its box, `lineHeight * sin 45° / 2` under its top, and ends the
 * text there. The name then reads up from its foot to that point: its top
 * stands under `rowTop` (the axis) with air to spare, and its glyphs centre on the
 * column (the baseline sits half a cap height right of the centre). The box
 * is the name's own column strip, so neighbours never claim each other.
 */
export function verticalNameRect(centerX: number, rowTop: number, width: number, font: FontSpec): { x: number; y: number; w: number; h: number } {
  const lineH = font.size * (font.lineHeight ?? 1.2);
  const pivotX = centerX + (font.size * VERTICAL_CAP_SHARE) / 2;
  // The box starts 4 px under the axis, clear of the axis claim and the
  // solver's 2 px pad; the name's top then keeps about 9.5 px from the baseline,
  // far more than the 1 px line-touch distance.
  const pivotY = rowTop + 4 + (lineH * SIN45) / 2;
  return { x: pivotX - lineH, y: pivotY - (lineH * SIN45) / 2, w: lineH, h: (lineH * SIN45) / 2 + width };
}

/** Cap height as a share of the font size (Helvetica/Arial): a vertical name centres its capitals on the column. */
const VERTICAL_CAP_SHARE = 0.72;
