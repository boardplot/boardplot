import { chartString } from '../../strings/pareto';
import { chartWording } from '../../strings';
import { structureCount } from '../../structureCounts';
/**
 * Pareto (registry type 'pareto') — sorted columns plus a
 * cumulative curve whose 100% point is the grand total.
 *
 * This module derives; it draws nothing. Every pixel comes from `layoutCombo`,
 * called with constructed input: one column series in the derived order, one
 * line series carrying the cumulative SHARES on an acknowledged secondary axis
 * pinned to 0-100%, a valueLine at the threshold and `highlight`
 * naming the vital few. There is no geometry arithmetic below.
 *
 * Three things this type refuses on purpose:
 *   - a supplied cumulative series or share cell (`PctCell`): the curve is the
 *     one claim the reader cannot check by eye, so it is always recomputed;
 *   - a sort option: descending IS the analysis;
 *   - an implied 80% rule: the threshold is a CONVENTION, drawn as a stated
 *     reference and never presented as a property of the data. When the data
 *     is not concentrated the exhibit says so instead of letting the shape
 *     imply it.
 */

import { currencyWholeNumbers, formatAutomaticNumber, formatAutomaticPercent } from '../../format';
import { formatterFromExample, seriesRasterFormatter } from '../../formatSpec';
import { authoredDecimals } from '../../formatPrecision';
import { accessibleTitle, NormalizeError, resolveSize } from '../../normalize/shared';
import { CARD_CLASS_WIDTH } from '../../sizing';
import { paintTokenColor, resolveTheme } from '../../theme';
import { valueAxisTitleText } from '../../axis';
import { isPctCell, type Cell, type Id } from '../../types/cell';
import type { Annotation } from '../../types/annotations';
import type { ChartData } from '../../types/data';
import type { ComboOptions, ParetoOptions } from '../../types/options';
import type { Geometry, LintWarning, Paint } from '../../types/scene';
import { layoutCombo, type ComboMarks } from '../combo/layout';
import { FIRST_END_BELOW_TOTALS } from '../combo/endpoints';
import { CATEGORY_ROW_FROM_END, CATEGORY_ROW_VERTICAL } from '../../label/categoryRow';
import { TARGET_SIZE, type TargetSizeOptions } from '../../target';
import { SECONDARY_FULL_DOMAIN } from '../combo/domain';
import { HIGHLIGHT_KEY, type HighlightKey } from '../combo/plot';
import { FORCE_CATEGORY_RANKS } from '../combo/categoryRanks';
import { autoDecimals } from '../../formatPrecision';
import { authoredNotes, legendRequired, withAuthoredFootnotes, type InternalFootnoteOptions } from '../../frame';
import { disclosureNote, keepShownNotes, rankKeyShown } from '../../notes';
import { crowdedTailCut, TAIL_SHARE_PCT } from '../../paretoTail';
import { emptyIdRecord } from '../../idRecords';

interface ParetoItem {
  id: Id;
  label?: string;
  /** Optional period for CAGR anchors; ranking still follows value. */
  date?: string;
  /** Counts or amounts. Shares are DERIVED and may not be authored. */
  value: number | null;
  rest?: boolean;
  fill?: string;
}

export interface ParetoData {
  items: ParetoItem[];
}

interface ParetoRestBucket {
  label: string;
  memberIds: Id[];
  value: number;
}

export interface ParetoDerived {
  /** Plotted order: descending by value, rest bucket last. */
  order: Id[];
  /** Sum of the PLOTTED values (after bucketing) — the cumulative curve's 100%. */
  total: number;
  values: Record<Id, number>;
  cumulative: Record<Id, number>;
  /** cum_i / total, in percent, on raw values — display rounding never feeds back. */
  cumulativeShare: Record<Id, number>;
  /**
   * Every OBSERVED cause, descending — the population the verdict is computed
   * on. Equal to `order` unless a tail was collapsed into a rest column.
   */
  populationOrder: Id[];
  /** cum_i / total over the POPULATION, in percent — one entry per observed cause. */
  populationShare: Record<Id, number>;
  /**
   * Each observed cause's OWN value (not cumulative). Carried so the vital-few
   * receipt can name the numbers it added up. Reporting `vitalFew.length` as the
   * output would be an identity: the output would equal the input count for
   * every possible dataset, so the receipt could not fail.
   */
  populationValue: Record<Id, number>;
  /**
   * Smallest prefix of the POPULATION reaching the threshold; the crossing
   * cause is INCLUDED. These are cause ids, never a rest-column id: how many
   * causes carry the effect cannot depend on how many bars were drawn.
   */
  vitalFew: Id[];
  /** The cause whose cumulative share first reaches the threshold; absent under `threshold: false`. */
  crossingId?: Id;
  /** `false` when the author drew no reference: no vital few, no highlight, no verdict. */
  threshold: number | false;
  /** false ⇒ the vital few is a majority of the OBSERVED CAUSES (no concentration), or there is no threshold. */
  concentrated: boolean;
  /** Columns actually painted as the vital few; never a rest column, never a subset lie. */
  highlighted: Id[];
  /** Vital-few causes with no column of their own because the tail was collapsed. */
  vitalFewInRest: number;
  /** true ⇒ the authored item order was not the plotted order. */
  reordered: boolean;
  restBucket?: ParetoRestBucket;
}

export type ParetoMarks = ComboMarks;

const VALUE_SERIES_ID = 'pareto:value';
const CUMULATIVE_SERIES_ID = 'pareto:cumulative';
const THRESHOLD_ANNOTATION_ID = 'pareto:threshold';
/**
 * Vital few larger than this share of the OBSERVED CAUSES ⇒ no concentration.
 * The denominator is the population, never the plotted column count: topN
 * collapses a tail into one column, so a column-based test would declare the
 * same data concentrated or not depending on how many bars were chosen.
 */
const CONCENTRATION_MAX_SHARE = 0.5;

/**
 * Narrowest column pitch at which a card drops its value axes: below it the
 * column values crowd one another and the curve labels lose their seats, so
 * the scales stay.
 */
const BARE_MIN_PITCH = 30;
/** The card's side gutter, as the frame draws it at card widths. */
const CARD_GUTTER = 16;

/** Rounding is for READING; the crossing test compares raw shares. */
const SHARE_EPS = 1e-9;


/** Whether the curve prints its share at index `i` (curveCells' marking; combo prints both ends). */
function curvePrints(curve: readonly Cell[], i: number, labels: ParetoOptions['labels']): boolean {
  if (i < 0 || labels === false || (typeof labels === 'object' && labels.point === false)) return false;
  const cell = curve[i];
  return i === 0 || i === curve.length - 1 ? typeof cell === 'number' : typeof cell === 'object' && cell !== null && 'label' in cell && cell.label === '${value}';
}

/**
 * The curve's shares in whole points. The key, the description and
 * the method note print the share the curve labels in this one format, so
 * "82%" on the curve is not "81.7%" in the reading of the same point.
 */
const CURVE_SHARE_FORMAT = '48%';
const curveShareText = formatterFromExample(CURVE_SHARE_FORMAT, undefined);

/**
 * The curve's cells with the labels it prints: its first share, the share
 * where it crosses the threshold, and its last unless a drawn right axis
 * already prints it; a label within two points of the one before it is
 * skipped, so a flat run near 100 % prints once.
 */
function curveCells(ids: readonly Id[], share: Record<Id, number>, crossingId: Id | undefined, axisShowsEnd = false): Cell[] {
  const last = ids.length - 1;
  // The end is 100% by construction; a drawn right axis already prints it.
  const endWanted = !axisShowsEnd || last === 0;
  const wanted = new Set([0, ids.findIndex((id) => id === crossingId), ...(endWanted ? [last] : [])].filter((i) => i >= 0));
  const printed = new Set<number>();
  let previous: number | undefined;
  for (const i of [...wanted].sort((a, b) => a - b)) {
    const value = share[ids[i]!]!;
    if (previous !== undefined && Math.abs(value - previous) < 2) continue;
    printed.add(i);
    previous = value;
  }
  return ids.map((id, i) => {
    const value = share[id]!;
    // The ends print by default; between them only a label the curve asks for.
    if (i === 0 || i === last) return printed.has(i) ? value : { number: value, label: false };
    return printed.has(i) ? { number: value, label: '${value}' } : value;
  });
}

const COUNT_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** A count as the key reads it: in words up to ten, as a figure above. */
function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

export function layoutPareto(
  data: ParetoData,
  options: ParetoOptions = {},
): Geometry<ParetoMarks, ParetoDerived> {
  const warnings: LintWarning[] = [];

  if (!data || !Array.isArray(data.items) || data.items.length === 0) {
    throw new NormalizeError('empty-data', 'items', 'pareto requires at least one item');
  }

  // ---- fail closed on anything that would poison every derived number ----
  const seen = new Set<Id>();
  data.items.forEach((item, i) => {
    const path = `items[${i}]`;
    if (!item || typeof item !== 'object' || !item.id) {
      throw new NormalizeError('missing-id', path, 'each pareto item requires an id');
    }
    if (seen.has(item.id)) {
      throw new NormalizeError('duplicate-id', path, `duplicate item id '${item.id}'`);
    }
    seen.add(item.id);
    const raw = item.value as unknown as Cell;
    if (isPctCell(raw)) {
      throw new NormalizeError(
        'pareto-percent-input',
        `${path}.value`,
        `item '${item.id}' supplies a share; a Pareto derives every share from the plotted values`,
        'supply counts or amounts — cumulative shares are computed, never authored',
      );
    }
    if (raw === null || raw === undefined) {
      throw new NormalizeError(
        'pareto-missing-value',
        `${path}.value`,
        `item '${item.id}' has no value; a missing cause cannot be part of a total`,
        "drop the item, or state 0 if the cause was measured and did not occur",
      );
    }
    if (typeof raw !== 'number' || Number.isNaN(raw) || !Number.isFinite(raw)) {
      throw new NormalizeError(
        'pareto-nonfinite-value',
        `${path}.value`,
        `item '${item.id}' has a non-finite value (${String(raw)})`,
        'supply a finite number',
      );
    }
    if (raw < 0) {
      throw new NormalizeError(
        'pareto-negative-value',
        `${path}.value`,
        `item '${item.id}' is negative (${raw}); cumulative share stops being monotone, so the curve would descend`,
        'use a waterfall or a variance chart for signed contributions',
      );
    }
  });

  const threshold = options.threshold ?? 80;
  if (threshold !== false && (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 100)) {
    throw new NormalizeError(
      'pareto-threshold-range',
      'options.threshold',
      `threshold must be strictly between 0 and 100 (got ${String(threshold)})`,
      'the Pareto convention is 80',
    );
  }

  // ---- order: descending by value, ties by input order (stable) ----
  const authored = data.items.map((item, i) => ({
    ...item,
    label: item.label ?? item.id,
    value: item.value as number,
    i,
  }));
  const authoredRest = authored.filter(item => item.rest);
  const hasAuthoredRest = authoredRest.length > 0;
  const ranked = authored.filter(item => !item.rest).sort((a, b) => b.value - a.value || a.i - b.i);

  // ---- topN: keep the n largest, then the folded tail and authored rest ----
  let plotted = [...ranked, ...authoredRest];
  let restBucket: ParetoRestBucket | undefined;
  let foldedRestId: Id | undefined;
  // A long tail of near-zero causes is folded by default. Twenty-eight
  // 60-character names over one axis is not a reading, and the sixteen causes
  // under 2% of the total decide nothing about the vital few, so they become
  // the Rest column unless the author cut the tail somewhere else.
  const autoFold = options.topN === undefined ? crowdedTailCut(ranked) : undefined;
  if (autoFold !== undefined) {
    warnings.push({
      code: 'pareto-tail-crowded',
      severity: 'info',
      message: `${ranked.length - autoFold} of ${ranked.length} causes are under ${TAIL_SHARE_PCT}% of the total each — they are folded into 'Rest' so the remaining ${autoFold} columns keep their names`,
      suggest: `set topN: { n: ${ranked.length} } to keep every cause as its own column, or another topN.n to cut the tail elsewhere`,
    });
  }
  const topN = options.topN ?? (autoFold === undefined ? undefined : { n: autoFold, rest: true as const, restLabel: 'Rest' });
  if (topN?.threshold !== undefined) {
    warnings.push({
      code: 'pareto-topn-threshold-unsupported',
      severity: 'info',
      message: 'topN.threshold is not applied on a Pareto — the rank cut is topN.n',
      suggest: 'set topN.n to the number of causes to show individually',
    });
  }
  if (topN && topN.n > 0 && ranked.length > topN.n) {
    const kept = ranked.slice(0, topN.n);
    const dropped = ranked.slice(topN.n);
    let restId = 'rest';
    while (seen.has(restId)) restId = `_${restId}`;
    const value = dropped.reduce((sum, d) => sum + d.value, 0);
    const name = topN.restLabel ?? 'Rest';
    // The member count is not optional here. It is the denominator of the
    // concentration verdict, and a reader cannot see how many causes are
    // hidden inside one column. Nothing leaves the ink without a trace.
    // The footnote is not enough — `methodNote: false` would take it away.
    const columnLabel = `${name} (${dropped.length})`;
    if (topN.showRestCount === false && !hasAuthoredRest) {
      warnings.push({
        code: 'pareto-rest-count-forced',
        severity: 'info',
        message: `topN.showRestCount: false is not honoured on a Pareto — the ${dropped.length} causes inside '${name}' are the difference between the plotted columns and the population the concentration verdict is computed on`,
      });
    }
    // An authored rest is already the remainder column: the folded tail joins
    // it, so one column holds everything outside the named causes. It keeps the
    // authored label and gets no member count, because its own members are unknown.
    const joined = authoredRest[0];
    restBucket = { label: joined?.label ?? name, memberIds: dropped.map((d) => d.id), value };
    plotted = [
      ...kept,
      joined
        ? { ...joined, value: joined.value + value }
        : { id: restId, label: columnLabel, date: undefined, value, fill: undefined, i: Number.MAX_SAFE_INTEGER },
    ];
    if (!joined) foldedRestId = restId;
  }
  // The one remainder column: the authored rest, or the folded tail without one.
  const restColumnId = authoredRest[0]?.id ?? foldedRestId;

  // ---- total and shares: computed on raw values, in plotted order ----
  const total = plotted.reduce((sum, p) => sum + p.value, 0);
  if (!(total > 0)) {
    throw new NormalizeError(
      'pareto-zero-total',
      'items',
      `the plotted values sum to ${total}; every cumulative share would be 0/0`,
      'a Pareto needs at least one positive value',
    );
  }

  const order: Id[] = plotted.map((p) => p.id);
  const values: Record<Id, number> = emptyIdRecord();
  const cumulative: Record<Id, number> = emptyIdRecord();
  const cumulativeShare: Record<Id, number> = emptyIdRecord();
  let running = 0;
  const cumSeries: number[] = [];
  for (const p of plotted) {
    running += p.value;
    values[p.id] = p.value;
    cumulative[p.id] = running;
    cumulativeShare[p.id] = (running / total) * 100;
    cumSeries.push(running);
  }

  // ---- vital few: smallest prefix of the POPULATION reaching the threshold.
  //      Not of the plotted columns. `ranked` is every observed cause in
  //      descending order and sums to the same grand total, so collapsing a
  //      tail changes what is DRAWN and never what is CONCLUDED. The cause that
  //      CROSSES the threshold is INCLUDED — the "does the crossing item
  //      count?" ambiguity is a convention, so it is stated, not assumed. ----
  const populationOrder: Id[] = ranked.map((r) => r.id);
  const populationShare: Record<Id, number> = emptyIdRecord();
  const populationValue: Record<Id, number> = emptyIdRecord();
  let popRunning = 0;
  for (const r of ranked) {
    popRunning += r.value;
    populationShare[r.id] = (popRunning / total) * 100;
    populationValue[r.id] = r.value;
  }
  // `threshold: false`: the curve without a reference, so no cause crosses
  // anything and there is no vital few to count or paint.
  let crossIdx = -1;
  for (let k = 0; threshold !== false && k < ranked.length; k++) {
    if (populationShare[ranked[k]!.id]! >= threshold - SHARE_EPS) {
      crossIdx = k;
      break;
    }
  }
  const vitalFew = populationOrder.slice(0, crossIdx + 1);
  const crossingId = crossIdx < 0 ? undefined : populationOrder[crossIdx]!;
  const populationCount = ranked.length;
  const concentrated = threshold !== false && crossIdx >= 0 && vitalFew.length <= populationCount * CONCENTRATION_MAX_SHARE;
  const reordered = ranked.some((r, k) => r.i !== k);

  // A vital-few cause swallowed by the rest column has no column to paint.
  // Painting the visible prefix anyway would claim a smaller vital few than
  // the one the footnote states, so the shortfall is counted and disclosed.
  const plottedIds = new Set<Id>(order);
  const highlightable = vitalFew.filter((id) => plottedIds.has(id));
  const vitalFewInRest = vitalFew.length - highlightable.length;
  const highlighted = concentrated ? highlightable : [];
  if (concentrated && vitalFewInRest > 0) {
    warnings.push({
      code: 'pareto-vital-few-in-rest',
      severity: 'warn',
      message: `${vitalFewInRest} of the ${vitalFew.length} vital-few causes have no column of their own — they are inside '${restBucket?.label ?? 'the rest column'}', so the highlight names only ${highlightable.length} of them`,
      suggest: `raise topN.n to at least ${vitalFew.length} so every vital-few cause gets its own column`,
    });
  }

  // ---- lints ----
  if (hasAuthoredRest) warnings.push({ code: 'pareto-rest-unranked', severity: 'info', message: 'The authored rest counts in the total and is excluded from ranking. Concentration is computed over the named causes.' });
  if (threshold !== false && !concentrated) {
    warnings.push({
      code: 'pareto-no-concentration',
      severity: 'info',
      message: crossIdx < 0 ? `The named causes do not reach ${thresholdText(threshold, options.locale?.language)} of the total — no vital few is highlighted` : `${vitalFew.length} of ${populationCount} observed causes are needed to reach ${thresholdText(threshold, options.locale?.language)} — this distribution has no vital few`,
      suggest: 'a sorted column or bar chart states the same ranking without implying concentration',
    });
  }
  if (threshold !== false && threshold !== 80) {
    warnings.push({
      code: 'pareto-threshold-nonstandard',
      severity: 'info',
      message: `threshold is ${thresholdText(threshold, options.locale?.language)}, not the conventional 80% — the vital-few set and the reference rule follow the stated threshold`,
    });
  }
  if (plotted.length > 15 && !restBucket) {
    warnings.push({
      code: 'pareto-tail-crowded',
      severity: 'warn',
      message: `${plotted.length} columns: the tail is too narrow to read and adds nothing to the vital-few answer`,
      suggest: 'set topN: { n: 10, rest: true } to keep the total intact while showing the tail as one bucket',
    });
  }
  if (plotted.length === 1) {
    warnings.push({
      code: 'pareto-single-item',
      severity: 'info',
      message: 'one item is always 100% of itself; a Pareto over a single cause answers nothing',
      suggest: 'supply the other causes, or state the single value as a KPI',
    });
  }
  if (options.highlight !== undefined) {
    warnings.push({
      code: 'pareto-highlight-derived',
      severity: 'info',
      message: 'options.highlight is ignored on a Pareto — the highlight encodes the derived vital few',
    });
  }
  if ((options as { sort?: unknown }).sort !== undefined) {
    warnings.push({
      code: 'pareto-sort-ignored',
      severity: 'info',
      message: 'options.sort is ignored — a Pareto is descending by definition',
    });
  }

  // ---- constructed combo input: derived numbers only, no geometry ----
  const drawCumulative = options.cumulative !== false;
  // ONE decimal count for every number in the exhibit. combo's per-value
  // default prints 992 and 0.5 as "992" and "0.5" — two precisions in one row
  // of labels for one measure. The example is derived from the AUTHORED values,
  // so nothing is invented; above two decimals the derived example would start
  // rounding real differences away, and combo's default is kept instead.
  // Authored, not plotted: a rest bucket is a float SUM of authored values
  // (10 x 1.4 = 14.000000000000002), and reading precision off that noise
  // bailed the shared example out — the rest column then printed "14" beside
  // "13.4" columns and a footnote saying "14.0", three precisions for one
  // measure. A sum cannot be more precise than its addends.
  const currencyDefault = !options.format && currencyWholeNumbers(options.unit, options.target);
  const sharedFormat = options.format ?? sharedFormatExample(ranked.map((p) => p.value));
  const fmt = currencyDefault
    ? seriesRasterFormatter(undefined, ranked.map((p) => p.value), options.locale?.language, options.unit, options.target, sharedFormat).fmt
    : fmtOf({ ...options, format: sharedFormat }, plotted.map((p) => p.value));
  // A zero prints as 0, not in the shared decimals ("0.0" reads as a rounded value).
  const hideRestColumn = topN?.rest === false && restColumnId !== undefined;
  const columnCells: Cell[] = plotted.map(p => hideRestColumn && p.id === restColumnId ? null : (p.fill || p.value === 0
    ? { number: p.value, ...(p.fill ? { fill: p.fill } : {}), ...(p.value === 0 ? { label: '0' } : {}) }
    : p.value));
  const series: NonNullable<ChartData['series']> = [
    {
      id: VALUE_SERIES_ID,
      label: options.unit ?? chartString(options, 'valueName'),
      kind: 'column',
      values: columnCells,
    },
  ];
  // on a card (480 px and narrower) both value axes give
  // way to the plot. Every column prints its value and the curve prints its
  // start, crossing and end shares, so the tick columns repeat what the marks
  // say while taking a fifth of the width the cause names need. An authored
  // valueAxis.show or labels setting keeps today's axes, and so does a card
  // whose columns are too narrow for their values to stand apart.
  const cardWidth = resolveSize(options.size, options.target).width;
  const bareAxes = drawCumulative && options.labels === undefined && options.valueAxis?.show === undefined
    && cardWidth <= CARD_CLASS_WIDTH && (cardWidth - 2 * CARD_GUTTER) / plotted.length >= BARE_MIN_PITCH;
  // With the right axis drawn its top tick reads 100%, so the curve's end
  // label would print the same figure twice; it prints only on a bare card.
  const curve = drawCumulative ? curveCells(plotted.map((p) => p.id), cumulativeShare, crossingId, !bareAxes) : [];
  if (drawCumulative) {
    series.push({
      id: CUMULATIVE_SERIES_ID,
      label: chartString(options, 'cumulative'),
      kind: 'line',
      // The curve carries cumulative SHARES on an acknowledged secondary axis
      // pinned to [0, 100], so the bar axis is economy-capped on the bars
      // alone; mapped against the running total, the bars would shrink to
      // ~30% of the plot. The derived record keeps BOTH vocabularies
      // (`cumulative` totals and `cumulativeShare`).
      axis: 'secondary',
      // One decimal count for the whole curve column (percent, whole points).
      format: CURVE_SHARE_FORMAT,
      // The curve must not wear the token the vital-few columns own, or it
      // reads as belonging to them, and must not take a series rank either.
      // `ColorRole` has no 'ink' member, so the mark ink is resolved from the SAME theme combo
      // resolves and handed over as a paint — a token value, never a literal.
      fill: paintTokenColor(resolveTheme(options.theme), 'markInk'),
      // The end label is the share at its point ("100%"). The engine
      // adds no name to it; the last share is exactly 100 (same order, same sum).
      values: curve,
    });
  }

  const annotations: Annotation[] = [...(options.annotations ?? [])];
  let thresholdLine: Extract<Annotation, { kind: 'valueLine' }> | undefined;
  if (drawCumulative && threshold !== false) {
    annotations.push(thresholdLine = {
      kind: 'valueLine',
      id: THRESHOLD_ANNOTATION_ID,
      // The threshold lives in cumulative-share percent — the secondary
      // scale's own unit — so the rule lands on the same pixel row as
      // `threshold` on the percent axis by construction. Under a drawn left axis
      // the label sits inside the plot above the rule at its start, where a Pareto curve has not yet climbed, so the right
      // margin goes to the plot and the cause names stand upright. On a bare
      // card it shares the right gutter the curve's 100% end label takes.
      axis: 'secondary',
      value: threshold,
      label: thresholdText(threshold, options.locale?.language),
      side: (options.valueAxis?.show ?? !bareAxes) ? 'left' : 'right',
    });
  } else if (!drawCumulative) {
    warnings.push({
      code: 'pareto-cumulative-off',
      severity: 'info',
      message: threshold === false
        ? 'cumulative: false — the curve is withheld'
        : `cumulative: false — the curve and the ${thresholdText(threshold, options.locale?.language)} reference rule are both withheld; a rule drawn across bare columns would read as a comparison against each column`,
      suggest: 'leave cumulative on to answer "how many causes reach the threshold"',
    });
  }

  // `methodNote` is off unless the author asks for it. It carries no sort
  // note: descending order with a cumulative curve IS a Pareto, so stating it
  // prescribes the reading instead of reporting the data.
  const footnotes = [
    ...authoredNotes(options),
    ...(options.methodNote === true
      ? methodFootnotes({ options,
          restBucket, authoredRest: hasAuthoredRest, plotted: plotted.length - (hideRestColumn ? 1 : 0), populationCount, concentrated, vitalFew: vitalFew.length,
          vitalFewInRest, crossingShare: crossingId === undefined ? 0 : populationShare[crossingId]!, total, threshold, drawCumulative,
          language: options.locale?.language, fmt,
        })
      : []),
  ];

  // The left axis title, as line, column and bar draw it: the authored one,
  // or 'Measure, unit' where the theme derives value-axis titles.
  const primaryTitle = valueAxisTitleText(resolveTheme(options.theme), options.axisTitles?.primary, options, options.unit);

  const curveTitled = drawCumulative && highlighted.length === 0;
  // The highlight's key item; it carries the vital few's share where the curve does not print it.
  const topKey = (curveShows: boolean) => chartString(options, 'paretoTop', { v1: /^de(?:[-_]|$)/i.test(options.locale?.language ?? '') ? chartString(options, 'numberCount', { v1: highlighted.length }) : countWord(highlighted.length), v2: curveShows
    ? '' : `: ${curveShareText(populationShare[highlighted.at(-1)!]!)}` });
  // A concentrated Pareto reads columns and curve as one measure: the left
  // axis runs to the total, so 100 % sits level with it and the curve starts
  // on the first column. A flat distribution keeps the column-capped axis,
  // where its equal columns would otherwise shrink to a sliver. An authored
  // valueAxis.min or max keeps its scale.
  const totalScaled = drawCumulative && (options.totalScale ?? (concentrated && options.valueAxis?.min === undefined && options.valueAxis?.max === undefined));
  const comboOptions: ComboOptions & { [FORCE_CATEGORY_RANKS]?: true; defaultFormat?: string; [FIRST_END_BELOW_TOTALS]?: boolean; [CATEGORY_ROW_FROM_END]?: boolean; [CATEGORY_ROW_VERTICAL]?: boolean; [SECONDARY_FULL_DOMAIN]?: readonly [number, number] } = {
    [SECONDARY_FULL_DOMAIN]: totalScaled ? [0, total] : undefined,
    ...stripParetoOnly(options),
    [CATEGORY_ROW_FROM_END]: false,
    // Cause names that must rotate stand vertical, whole, each in its column.
    // Only on a pinned height: with the height left to the chart, the taller vertical row moves the
    // automatic height search and costs totals their seats (revenue-concentration at 320 and 400).
    ...((options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height === true ? { [CATEGORY_ROW_VERTICAL]: true } : {}),
    ...(sharedFormat ? currencyDefault ? { defaultFormat: sharedFormat } : { format: sharedFormat } : {}),
    // The curve reads at its start, its threshold crossing and its end, whatever combo's line default is.
    valueLabels: 'ends',
    // The first point repeats the first bar's share: it ranks below the bar totals.
    [FIRST_END_BELOW_TOTALS]: true,
    footnotes,
    annotations,
    // Highlighting a MAJORITY of the causes is not emphasis, and it would
    // paint concentration onto a distribution that has none. The suppression
    // leaves the footnote and the lint as its trace.
    highlight: highlighted,
    // The highlight is the one colour that says which causes reach the
    // threshold, so its key stays whatever `legend` says: the highlighted
    // columns ("Top 5: 81%", their cumulative share) and the rest. The curve
    // carries its shares at its points and needs no entry.
    ...(highlighted.length > 0
      ? {
          [HIGHLIGHT_KEY]: {
            // The share the vital few reach prints once, on the curve where it
            // prints there, else in the key.
            highlighted: topKey(curvePrints(curve, plotted.findIndex((p) => p.id === highlighted.at(-1)), options.labels)),
            // The rest group is every column outside the top ones, not the pooled "Others" column.
            rest: chartWording(options, 'others', chartString(options, 'outsideTop', { v1: /^de(?:[-_]|$)/i.test(options.locale?.language ?? '') ? chartString(options, 'numberCount', { v1: highlighted.length }) : countWord(highlighted.length) })),
            legend: legendRequired(options.legend, warnings, 'pareto', resolveTheme(options.theme), 'the column colours mark the causes that reach the threshold'),
            // the key names the curve too, in place of the right axis title.
            ...(drawCumulative ? { line: chartString(options, 'cumulativeKey') } : {}),
          } satisfies HighlightKey,
        }
      : {}),
    // The cumulative curve rides an acknowledged secondary axis pinned
    // to [0, 100]. Without the curve there is no second scale at all.
    ...(drawCumulative
      ? { secondaryAxis: { acknowledge: true as const, domain: [0, 100] as [number, number], ...(bareAxes ? { show: false } : {}) } }
      : { secondaryAxis: undefined }),
    // The left value axis is on by default, so the
    // column heights read against a scale beside the right-hand share axis,
    // under the title above. valueAxis.show: false drops it.
    // Scaled to the total, the left axis tops out where the curve reaches 100 %.
    valueAxis: { ...options.valueAxis, show: options.valueAxis?.show ?? !bareAxes, ...(totalScaled ? { min: 0, max: total } : {}) },
    // The right axis says what the curve is; its title carries the curve's swatch.
    // with the highlight key, the curve's line item there names it instead.
    ...(primaryTitle || curveTitled
      ? { axisTitles: { ...(primaryTitle ? { primary: primaryTitle } : {}), ...(curveTitled ? { secondary: chartString(options, 'cumulativeAxis') } : {}) } }
      : {}),
  };

  const comboData = {
    categories: plotted.map((p) => ({ id: p.id, label: p.label, date: p.date })),
    series,
  } as ChartData;
  const render = (extra: string[]) =>
    // A registered note pass can add engine notes. Only the original
    // authored subset keeps a number.
    layoutCombo(comboData, withAuthoredFootnotes(comboOptions, [...footnotes, ...extra], (options as InternalFootnoteOptions).authoredFootnotes ?? options.footnotes));

  // A Pareto answers "WHICH causes". Past eight columns combo thins category
  // labels and marks the dropped ones `redundant`, so no lint fires and the
  // reader is left with a nameless column carrying a value. The names are read
  // back off the geometry and put on the page. Adding the note changes
  // the frame, which can change what fits, so the pass iterates to a fixed
  // point; without one, the note would name a set the exhibit does not have.
  // When the names fit at neither 0° nor 45° the axis carries rank
  // numbers, and combo prints their mapping itself, whatever `methodNote` says.
  // A curve point that sits on the threshold rule and prints the rule's own share says the
  // rule's label twice, side by side ("80%  80%" where the first cause alone reaches 80%):
  // the rule's label carries it. The key keeps the wording it was given above.
  if (thresholdLine && threshold !== false) {
    curve.forEach((cell, i) => {
      const value = typeof cell === 'number' ? cell : cell !== null && typeof cell === 'object' && 'number' in cell ? cell.number : undefined;
      const prints = typeof cell === 'number' || (cell !== null && typeof cell === 'object' && 'label' in cell && cell.label === '${value}');
      if (prints && value !== undefined && curveShareText(value) === thresholdText(threshold)) curve[i] = { number: value, label: false };
    });
  }
  let geo = render([]);
  // The seat at the rule's start is free on most Pareto curves, which climb
  // to the threshold from below. Where a tall first column takes it, the
  // left label would fall back to the left margin, beside the count ticks it
  // is not read against; the label then returns to the right of the plot.
  if (thresholdLine?.side === 'left') {
    const seat = geo.labels.find((l) => l.id === `valueLine:${THRESHOLD_ANNOTATION_ID}`);
    if (!seat || seat.hidden !== undefined || !/^(insideEnd|lineEndShifted|lineEndLow|insideEndLow)/.test(seat.slot)) {
      thresholdLine.side = 'right';
      geo = render([]);
    }
  }
  // Vertical names take plot height from the columns: where they cost a
  // value its seat, the row turns 45° or carries ranks as before (a value
  // outranks the vertical names; revenue-concentration at 320).
  if (comboOptions[CATEGORY_ROW_VERTICAL] && geo.warnings.some((w) => w.code === 'category-labels-rotated' && w.message.includes('-90°'))) {
    const hiddenValues = (g: typeof geo) => g.labels.filter((l) => l.hidden && (l.kind === 'grandTotal' || l.kind === 'point')).length;
    comboOptions[CATEGORY_ROW_VERTICAL] = false;
    const flat = render([]);
    if (hiddenValues(flat) < hiddenValues(geo)) geo = flat;
    else comboOptions[CATEGORY_ROW_VERTICAL] = true;
  }
  // A cause name is not cut with an ellipsis where the rank key prints
  // (notes.show lists 'disclosure' or 'ranks'): that row carries rank numbers instead.
  // Without the key, ranks name nothing, so the cut name stays (its title keeps it whole).
  if (rankKeyShown(options) && geo.warnings.some((w) => w.code === 'category-labels-truncated')) {
    comboOptions[FORCE_CATEGORY_RANKS] = true;
    geo = render([]);
  }
  // The share the vital few reach prints once. Where the curve's label there lost its seat (a
  // total-scaled curve that starts on a crowded first column), the key carries it.
  const key = (comboOptions as { [HIGHLIGHT_KEY]?: HighlightKey })[HIGHLIGHT_KEY];
  if (key && key.highlighted === topKey(true)
    && geo.labels.some((l) => l.id === `point:${CUMULATIVE_SERIES_ID}:${highlighted.at(-1)}` && l.hidden !== undefined && l.hidden !== 'redundant')) {
    key.highlighted = topKey(false);
    const at = plotted.findIndex((p) => p.id === highlighted.at(-1));
    curve[at] = { number: cumulativeShare[highlighted.at(-1)!]!, label: false };
    geo = render([]);
  }
  let unnamed = unnamedColumns(geo, plotted);
  let noteApplied = false;
  // a canvas already under its own minimum is refused whatever the
  // note says. The note would only shrink the plot and raise the minimum the
  // refusal names, and at that size the names fit and the minimum falls back.
  const undersized = (geo.frame.plotMinHeight ?? 0) > geo.size.height;
  for (let pass = 0; !undersized && pass < 3 && unnamed.length > 0; pass++) {
    const note = disclosureNote(chartString(options, 'paretoUnlabelled', { v1: unnamed
      .map((u) => `${order.indexOf(u.id) + 1}. ${u.label}`)
      .join('; ') }));
    const next = render([note]);
    const after = unnamedColumns(next, plotted);
    geo = next;
    noteApplied = true;
    if (sameIds(unnamed, after)) {
      unnamed = after;
      break;
    }
    unnamed = after;
    noteApplied = false;
  }
  if (unnamed.length > 0) {
    // The severity is decided by READING THE PAGE, not by whether a footnote
    // was requested: a note long enough to be truncated at the frame's line cap
    // recovers nothing. Recovered ⇒ info (the exhibit still names every
    // column); lost ⇒ warn (the reader is holding a nameless column).
    const printed = pageText(geo);
    const lost = unnamed.filter((u) => !printed.includes(u.label));
    warnings.push({
      code: 'pareto-category-label-omitted',
      severity: lost.length > 0 ? 'warn' : 'info',
      message:
        `${unnamed.length} of ${plotted.length} columns have no room for their axis label: ` +
        `${unnamed.map((u) => `'${u.label}'`).join(', ')} — ` +
        (lost.length > 0
          ? `${lost.length} of them are NOT named anywhere on the exhibit`
          : `named by rank in a footnote${noteApplied ? '' : ' already present'}`),
      suggest: 'shorten the labels, widen the canvas, or aggregate the tail with topN',
    });
  }

  // The combo adapter receives the cumulative ink through its document-shaped
  // input, but that value is engine-authored. Restore its token provenance on
  // every cumulative-owned scene node before the geometry crosses the adapter.
  const cumulativePaint = (paint: Paint | undefined, ownerSeries: Id | undefined) =>
    ownerSeries === CUMULATIVE_SERIES_ID && paint && 'css' in paint
      ? ({ token: 'markInk' } as Paint)
      : paint;
  geo.scene = geo.scene.map((node) => {
    const seriesId = node.owner.seriesId;
    if (node.t === 'rect') {
      return {
        ...node,
        fill: cumulativePaint(node.fill, seriesId)!,
        ...(node.stroke ? { stroke: cumulativePaint(node.stroke, seriesId) } : {}),
      };
    }
    if (node.t === 'line') return { ...node, stroke: cumulativePaint(node.stroke, seriesId)! };
    if (node.t === 'path') {
      return {
        ...node,
        ...(node.fill ? { fill: cumulativePaint(node.fill, seriesId) } : {}),
        ...(node.stroke ? { stroke: cumulativePaint(node.stroke, seriesId) } : {}),
        // The curve starts inside the tallest column. Its page-colour casing
        // stays over the columns, or the ink line reads about 2.2:1 on the
        // vital-few fill and seems to start at the column's right edge.
        ...(node.part === 'lineCasing' && seriesId === CUMULATIVE_SERIES_ID ? { overFills: true as const } : {}),
      };
    }
    if (node.t === 'circle') {
      return {
        ...node,
        fill: cumulativePaint(node.fill, seriesId)!,
        ...(node.stroke ? { stroke: cumulativePaint(node.stroke, seriesId) } : {}),
      };
    }
    return node.t === 'text' ? { ...node, ink: cumulativePaint(node.ink, seriesId)! } : node;
  });

  const labelOf = (id: Id) => ranked.find((r) => r.id === id)?.label ?? id;
  const vitalFewLabels = vitalFew.map(labelOf).join(', ');
  const desc =
    chartString(options, 'paretoDescStart', { v1: populationCount }) +
    (restBucket ? chartString(options, 'paretoColumnsClause', { v1: plotted.length - (hideRestColumn ? 1 : 0) }) : '') +
    chartString(options, 'totalClause', { v1: fmt(total) }) +
    (hasAuthoredRest ? chartString(options, 'paretoAuthoredRestDesc') : '') +
    (threshold === false
      ? chartString(options, 'paretoNoThresholdDesc')
      : crossingId === undefined
      ? chartString(options, 'paretoNoReachDesc')
      : concentrated
        ? chartString(options, 'paretoReachDesc', { v1: vitalFew.length, v2: populationCount, v3: vitalFewLabels, v4: curveShareText(populationShare[crossingId]!), v5: thresholdText(threshold, options.locale?.language), v6: labelOf(crossingId) })
        : chartString(options, 'paretoNotConcentratedDesc', { v1: vitalFew.length, v2: populationCount, v3: thresholdText(threshold, options.locale?.language) })) +
    (restBucket
      ? chartString(options, 'paretoRestDesc', { v1: hasAuthoredRest ? chartString(options, 'authoredRestHolds') : chartString(options, 'lastElement', { v1: hideRestColumn ? (drawCumulative ? chartString(options, 'curvePoint') : chartString(options, 'category2')) : chartString(options, 'columnName') }), v2: restBucket.memberIds.length, v3: fmt(restBucket.value) })
      : '') +
    (drawCumulative
      ? chartString(options, 'paretoCurveDesc')
      : chartString(options, 'paretoCurveOffDesc'));

  return {
    ...geo,
    type: 'pareto',
    // No value-label floor. At a narrow card the pareto staggers its values into two
    // rows, runs staircase leaders and lists the columns with no room in a ranked note, so a
    // floor taken from the labels at the natural width refused charts that read.
    derived: {
      order,
      total,
      values,
      cumulative,
      cumulativeShare,
      populationOrder,
      populationShare,
      populationValue,
      vitalFew,
      ...(crossingId === undefined ? {} : { crossingId }),
      threshold,
      concentrated,
      highlighted,
      vitalFewInRest,
      reordered,
      ...(restBucket ? { restBucket } : {}),
      // The pinned share axis ([0, 100] with data widening), in PARETO's own
      // vocabulary — the pinned-axis contract stays checkable on this surface
      // while combo internals (secondaryDomain, stackTotals) stay out of
      // derived, the chart's disclosure contract.
      ...((geo.derived as { secondaryDomain?: [number, number] }).secondaryDomain
        ? { shareAxisDomain: (geo.derived as { secondaryDomain?: [number, number] }).secondaryDomain }
        : {}),
    },
    a11y: {
      title: accessibleTitle(options.title, chartString(options, 'paretoTitle', { v1: populationCount, v2: fmt(total) })),
      counts: [structureCount('causes', populationCount, chartString(options, 'sortedCauses', { v1: populationCount })),
        ...(threshold !== false && crossingId !== undefined ? [
          structureCount('causes', vitalFew.length, concentrated ? chartString(options, 'firstCount', { v1: vitalFew.length }) : chartString(options, 'causesOfCount', { v1: vitalFew.length, v2: populationCount })),
        ] : []),
        ...(restBucket ? [structureCount('columns', plotted.length - (hideRestColumn ? 1 : 0), undefined, options), structureCount('causes', restBucket.memberIds.length, chartString(options, 'smallerCauses', { v1: restBucket.memberIds.length }))] : [])],
      desc,
    },
    // combo's `dual-axis` caution is filtered: the bar + cumulative-share
    // pairing IS the Pareto form — one measure in two vocabularies (count
    // and share of total), not two unrelated units — and pareto, not the
    // author, acknowledged the axis. Every other combo warning passes
    // through untouched.
    warnings: [...geo.warnings.filter((w) => w.code !== 'dual-axis'), ...warnings],
  };
}

interface MethodNoteInput {
  options: ParetoOptions;
  restBucket?: ParetoRestBucket;
  plotted: number;
  populationCount: number;
  authoredRest: boolean;
  concentrated: boolean;
  vitalFew: number;
  vitalFewInRest: number;
  crossingShare: number;
  total: number;
  threshold: number | false;
  drawCumulative: boolean;
  language?: string;
  fmt: (v: number) => string;
}

/** The opt-in method statement, without a sort note. */
function methodFootnotes(input: MethodNoteInput): string[] {
  const { restBucket, populationCount, threshold, language, fmt } = input;
  const rule = threshold === false ? '' : thresholdText(threshold, language);
  // The verdict is counted on the OBSERVED CAUSES. When a tail was collapsed
  // the two denominators differ, and the one that decided the verdict is the
  // one the reader cannot see, so both are printed.
  const denominator = restBucket
    ? chartString(input.options, 'observedCausesDrawn', { v1: populationCount, v2: input.plotted })
    : chartString(input.options, 'observedCauses', { v1: populationCount });
  // The verdict names the highlight on the chart and the rest lines say what
  // the columns hold, so they stay in the frame (disclosure); the curve line
  // is method.
  return [
    threshold === false
      ? chartString(input.options, 'paretoNoThresholdNote')
      : disclosureNote(input.concentrated
      ? chartString(input.options, 'paretoHighlightNote', { v1: input.vitalFew, v2: denominator, v3: rule, v4: curveShareText(input.crossingShare), v5: fmt(input.total) }) +
          (input.vitalFewInRest > 0
            ? chartString(input.options, 'paretoHiddenHighlights', { v1: input.vitalFewInRest, v2: restBucket!.label })
            : '') +
          chartString(input.options, 'paretoReferenceConvention')
      : input.vitalFew === 0
      ? chartString(input.options, 'paretoNoReachNote', { v1: rule })
      : chartString(input.options, 'paretoNoConcentrationNote', { v1: input.vitalFew, v2: denominator, v3: rule, v4: rule })),
    ...(input.authoredRest ? [disclosureNote(chartString(input.options, 'paretoRestMethod'))] : []),
    ...(restBucket
      ? [disclosureNote(chartString(input.options, 'paretoFoldedMethod', { v1: restBucket.label, v2: restBucket.memberIds.length, v3: fmt(restBucket.value), v4: input.authoredRest ? chartString(input.options, 'insideRest') : chartString(input.options, 'lastRegardlessSize'), v5: populationCount }))]
      : []),
    input.drawCumulative
      ? chartString(input.options, 'cumulativeMethodNote')
      : chartString(input.options, 'cumulativeOffNote'),
  ];
}

/** Every string the reader can actually see on the finished exhibit. */
function pageText(geo: { scene: { t: string; lines?: string[] }[] }): string {
  return geo.scene
    .filter((n) => n.t === 'text')
    .flatMap((n) => n.lines ?? [])
    .join(' ');
}

interface PlottedItem {
  id: Id;
  label: string;
  value: number;
}

/** Columns whose category label the solver could not place. */
function unnamedColumns(
  geo: { labels: { kind: string; hidden?: string; owner: { categoryId?: Id } }[] },
  plotted: PlottedItem[],
): PlottedItem[] {
  const hidden = new Set(
    geo.labels
      .filter((l) => l.kind === 'category' && l.hidden !== undefined)
      .map((l) => l.owner.categoryId),
  );
  return plotted.filter((p) => hidden.has(p.id));
}

function sameIds(a: PlottedItem[], b: PlottedItem[]): boolean {
  return a.length === b.length && a.every((x, i) => x.id === b[i]!.id);
}

/**
 * The example carries grouping AND the decimal count actually present in the
 * data (capped at two). `undefined` ⇒ leave combo's per-value default alone.
 */
function sharedFormatExample(values: number[]): string | undefined {
  let decimals = 0;
  for (const v of values) {
    const text = String(v);
    const dot = text.indexOf('.');
    if (dot === -1) continue;
    if (text.includes('e') || text.includes('E')) return undefined;
    decimals = Math.max(decimals, text.length - dot - 1);
    if (decimals > 2) return undefined;
  }
  return decimals === 0 ? '1,234' : `1,234.${'5'.repeat(decimals)}`;
}

/** Business default matching combo's: whole numbers get no decimals. */
function fmtOf(options: ParetoOptions, values: readonly number[]): (v: number) => string {
  if (options.format) return formatterFromExample(options.format, options.locale?.language, undefined, values);
  return (v: number) =>
    formatAutomaticNumber(v, { locale: options.locale?.language, decimals: autoDecimals(v) });
}

/**
 * The threshold is printed EXACTLY as applied. Rounding it for display would
 * make the exhibit certify a rule it did not use: at an applied 80.04 with a
 * printed "80.0%", a reader re-deriving the vital few from the stated number
 * gets a different set than the one highlighted.
 */
function thresholdText(v: number, locale?: string): string {
  return formatAutomaticPercent(v, authoredDecimals(v), false, locale);
}

/** Pareto-only keys never reach combo; `sort` and `highlight` are decided here. */
function stripParetoOnly(options: ParetoOptions): ComboOptions {
  const {
    threshold: _threshold,
    cumulative: _cumulative,
    methodNote: _methodNote,
    topN: _topN,
    highlight: _highlight,
    footnotes: _footnotes,
    annotations: _annotations,
    ...rest
  } = options as ParetoOptions & { sort?: unknown };
  const out = keepShownNotes(options, { ...rest }) as ComboOptions & { sort?: unknown };
  delete out.sort;
  delete (out as { secondaryAxis?: unknown }).secondaryAxis;
  return out as ComboOptions;
}
