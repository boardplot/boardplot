import { a11yDescription } from '../../a11yDescription';
/**
 * Bar — the horizontal twin of column.
 * Categories run top→down as rows, values run left→right from a vertical
 * zero baseline. Label policy is the bar-family cascade: inside-end →
 * outside-end (right of the bar); negatives extend left and label
 * outside-left. Variants: grouped | stacked | stacked100.
 */

import { staticFrame } from '../../footer';
import { hasLabelPosition, refuseLabelPosition } from '../band/labelPosition';
import { pickedValues, withValueLabelDefaults } from '../band/valueSelection';
import { chartString } from '../../strings/bar';
import { withSegmentSeams } from '../../markVisibility';
import { withLocaleStrings } from '../../strings';
import { structureCount } from '../../structureCounts';
import type { PaintWarningRule } from '../../types/scene';
import { PARTIAL_KEY, partialIds, toDateRoom } from '../../partialPeriod';
import { noTotal } from '../../stackAdds';
import type { AnchorResolution, AnnotatePassInput, AnnotatePassResult } from '../../annotate';
import { BAND_PAD, pruneOrphanAnnotationArms } from '../../annotateParts';
import { emptyAnnotatePass, percentLevels, runAnnotatePass } from '../../annotatePass';
import { categoryTargetFields, spliceAnnotationNodes } from '../../annotateFields';
import { rectSeriesAdjacentWarnings } from '../../adjacentSeries';
import { applyValueAxisTitleInk, valueAxisTitleRequest } from '../../axis';
import type { Rect, rowLabelX, Size } from '../../geometry';
import { bandValueLabelUniformity, keepValuesWithoutAxis } from '../band/labels';
import { stackParts, withoutShareAnnotations } from '../band/stacks';
import { labelsToNodes } from '../../label/emit';
import { inlineCategoryGroups } from '../../label/categoryGroups';
import type { OccupiedIndex } from '../../label/occupied';
import { labelCtx, solveLabels, type SolveCtx, type SolveResult } from '../../label/solver';
import { NormalizeError } from '../../normalize/shared';
import type { RangeMark } from '../../rangeRules';
import { HARD_MINIMUM, rowSizing, sameContent, SIZE_TOLERANCE } from '../../sizing';
import { requestMemo } from '../../layoutPlan';
import { currentSmallValues, formatScopeKey } from '../../formatPrecision';
import { rowDrivenHeight } from '../../rowCanvas';
import { defaultMeasurer, isCachedTextMeasurer, wrapText, type FontSpec, type TextMeasurer } from '../../text';
import { joinHatchPeers, layoutStepKey, paintColor, resolveTheme } from '../../theme';
import type { AnchorRef } from '../../types/annotations';
import type { Id, OwnerRef } from '../../types/cell';
import type { ChartData } from '../../types/data';
import type { BarOptions } from '../../types/options';
import type { Geometry, LintWarning, PlacedAnnotation, PlacedLabel, ShownMark } from '../../types/scene';
import { layoutBarLocalAnnotations } from './annotations';
import { displayFor, prepareBar, toDateOnValues } from './domain';
import { labelOn, valueLineLabelsOn } from '../labelOn';
import { planBarLabels } from './labels';
import { layoutBarMarks } from './marks';
import { barHalves, cagrInset, CAGR_INSET_ROOM, CAGR_ROOM, CAGR_TRIES, CAT_MAX_LINES, BarTooTall, CUT_NOTES, DEFER_ADJACENT, NO_NAME_COLUMN, RIGHT_ROOM, STOP_IF_TOO_TALL, type BarArea, type BarDomain, type BarMarkGeometry } from './model';
import { barPlotArea, solveBarFrame, barPassText } from './plot';
import { toleranceKeyed } from '../../valueLineDomain';
import { keepBandTotals } from '../band/valueNotes';
import { textScaleOf } from '../../typeFloors';
import { maxOf, pushAll } from '../../arrays';
import { emptyIdRecord } from '../../idRecords';
import { refuseRowIntervals, type RowIntervalMode } from './intervalSeries';
import type { applyBarTopN, barNameTrack, fixedRowWithFraction, drawBarIndicator, positionBarLabels } from './rowOptions';

export interface BarMarks {
  rows: { id: Id; rect: Rect; bars: { seriesId: Id; rect: Rect; nodeId: Id }[] }[];
  referenceTicks: { seriesId: Id; categoryId: Id; nodeId: Id }[];
  rowTints: { categoryId: Id; nodeId: Id }[];
  ranges?: RangeMark[];
  currentValue?: { value: number; nodeId: Id; labelId?: Id };
  /** tornado only: the base-case spine. A different claim from currentValue. */
  baseValue?: { value: number; nodeId: Id; labelId?: Id };
  /** tornado only: the case texts the rows draw, stated for the driver's record (ShownMark). */
  shown?: ShownMark[];
}

/** One driver's one-at-a-time sensitivity receipt. Every field is derived. */
export interface TornadoRowDerived {
  id: Id;
  low: number;
  high: number;
  swing: number;
  down: number;
  up: number;
  inverse: boolean;
  straddles: boolean;
}

export interface BarDerived {
  /** rounding 'sum-consistent': the shares printed off their nearest rounding. */
  roundingAdjustments?: import('../../shareRounding').RoundingAdjustment[];
  /** Row totals; empty for grouped bars with several series and for a stack whose parts do not add. */
  totals: Record<Id, number>;
  /** The data-series parts of each total in totals, per category × series; absent on tornado and range bars. */
  stackParts?: Record<Id, Record<Id, number>>;
  /** stacked100 only: percent share per category per series. */
  shares?: Record<Id, Record<Id, number>>;
  /** Final category order after sort + topN. */
  order: Id[];
  /**
   * Mean of grouped cells or stacked category totals (feeds valueLine 'mean').
   * ABSENT when nothing is plotted: there is no mean of no values, and this is
   * a receipt surface, so the key is omitted rather than reported as 0. Absent
   * too for a stack whose parts do not add.
   */
  mean?: number;
  /**
   * tornado only. `method` is the receipt that this is a one-at-a-time
   * sensitivity: there is deliberately NO contribution share, no share of
   * variance and no decomposition, because OAT swings do not sum to a total
   * and carry no interaction effects.
   */
  tornado?: {
    baseValue: number;
    method: 'one-at-a-time';
    /**
     * One entry per tied RANK GROUP. The silhouette ranks at the precision the
     * exhibit prints, so rows whose swings the reader cannot tell apart share a
     * rank; their drawn top-to-bottom order is a tie-break on the larger
     * excursion from base, and that is a fact about the ordering the receipt
     * has to carry rather than hide.
     */
    ties: { rank: number; categoryIds: Id[] }[];
    rows: TornadoRowDerived[];
  };
}

/** Internal adapter for charts whose displayed segments encode derived values. */
export type BarAnnotationPass = ((input: AnnotatePassInput, marks: BarMarks) => AnnotatePassInput) & {
  /** The adapter reads only annotations supplied by the bar. */
  skipWhenEmpty?: boolean;
  /** One survey layout can fit the same rows with a different disclosure footer. */
  footnoteRows?: BarRowsForFrame<Geometry<BarMarks, BarDerived>>;
};
export type BarRowsForFrame<R> = (domain: BarDomain, area: BarArea, claims: OccupiedIndex, warnings: LintWarning[]) =>
  { result: R } | { save: (result: R) => void };

export type BarNaturalMinimum = (width: number, height: number, drawMinimum: () => number | undefined) => number | undefined;

export const LABEL_PAD = 2;

/** Native bars supply the interval layout. A column can reach only the interval refusals. */
type RowIntervalLayout = (data: ChartData, options: BarOptions, mode: RowIntervalMode) => Geometry<BarMarks, BarDerived>;

/** Each caller names every slot, and writes undefined for an option it does not draw, so none is dropped by mistake. */
export interface BarRowFeatures {
  intervals: RowIntervalLayout | undefined;
  topN: typeof applyBarTopN | undefined;
  nameTrack: typeof barNameTrack | undefined;
  alignRow: typeof rowLabelX | undefined;
  fixedRow: typeof fixedRowWithFraction | undefined;
  indicator: typeof drawBarIndicator | undefined;
  positionLabels: typeof positionBarLabels | undefined;
}

export function layoutBarRows(
  data: ChartData,
  options: BarOptions,
  features: BarRowFeatures,
  annotationPass?: BarAnnotationPass,
  checkNaturalHeight: boolean | BarNaturalMinimum = true,
): Geometry<BarMarks, BarDerived> {
  const dropped: LintWarning[] = [];
  options = barOptionsForLayout(options, dropped);
  const layout = (next: BarOptions) => layoutBarSized(data, next, annotationPass, features);
  // A content-fit host often asks for exactly the shorter chart we drew to check its
  // minimum. Keep that private drawing for one retry, including its fitted notes.
  // Once returned, the chart belongs to its caller and cannot be handed out again.
  const retry = options.variant === 'stacked' && annotationPass === undefined && checkNaturalHeight === true
    && isCachedTextMeasurer(options.measure ?? defaultMeasurer)
    ? requestMemo(data, JSON.stringify(['bar-natural-retry', layoutStepKey(), staticFrame.pinned, staticFrame.live, currentSmallValues(), formatScopeKey(options)]),
      (): { next?: { options: BarOptions; geometry: Geometry<BarMarks, BarDerived> } } => ({}))
    : undefined;
  const next = retry?.next;
  if (retry) delete retry.next;
  const geo = next && sameContent(next.options, options) ? next.geometry : keepBandTotals(options, layout);
  const natural = geo.sizing?.naturalHeight;
  if (checkNaturalHeight && natural !== undefined && natural < geo.size.height) {
    // a shorter row layout may need a disclosure that the tall layout did not.
    const drawMinimum = () => {
      const shorter = { ...options, size: { width: geo.size.width, height: natural } };
      const geometry = keepBandTotals(shorter, layout);
      if (retry) retry.next = { options: shorter, geometry };
      return geometry.sizing?.minHeight;
    };
    const minimum = typeof checkNaturalHeight === 'function' ? checkNaturalHeight(geo.size.width, natural, drawMinimum) : drawMinimum();
    if (minimum !== undefined && minimum > natural) geo.sizing = { ...geo.sizing!, naturalHeight: minimum };
  }
  geo.warnings.push(...dropped);
  return geo;
}

function barOptionsForLayout(options: BarOptions, dropped: LintWarning[]): BarOptions {
  const variant = options.variant ?? 'grouped';
  if (variant !== 'grouped') refuseLabelPosition(options, `bar ${variant}`,
    variant === 'stacked' || variant === 'stacked100' ? ['center', 'insideEnd', 'insideBase'] : []);
  return withoutShareAnnotations(withValueLabelDefaults(withLocaleStrings(options), 'bar', options.variant, dropped), options.variant === 'stacked100', dropped);
}

/** The stacked Likert row probe needs the plot after hidden values have taken their footer space. */
export function stackedBarPlotHeight(data: ChartData, options: BarOptions, features: BarRowFeatures, annotationPass: BarAnnotationPass): number {
  options = barOptionsForLayout(options, []);
  refuseSignColor(data, options);
  return keepBandTotals(options, next => layoutStandardBar(data, next, features, annotationPass, barPlotWithNotes)).plot.h;
}

function barPlotWithNotes(_domain: BarDomain, area: BarArea, _scene: BarMarkGeometry, solved: SolveResult, annotated: AnnotatePassResult) {
  return {
    plot: area.plot,
    labels: [...solved.placed, ...annotated.labels],
    frame: area.frame.frame,
    scene: area.frame.nodes,
    a11y: {},
  };
}

function layoutBarSized(
  data: ChartData,
  options: BarOptions,
  annotationPass: BarAnnotationPass | undefined,
  features: BarRowFeatures,
): Geometry<BarMarks, BarDerived> {
  const first = layoutBarVariant(data, options, annotationPass, features);
  if (!resolveTheme(options.theme).space.barRow || first.sizing === undefined) return first;
  const relayout = (height: number) =>
    layoutBarVariant(data, { ...options, size: { width: first.size.width, height } }, annotationPass, features);
  // Fixed rows make bar a row-driven exhibit: unsized, it takes the
  // canvas its rows need, as a table or a bullet card does.
  const grow = rowDrivenHeight({
    options, width: first.size.width, height: first.size.height,
    chromeH: 0, rowsH: first.sizing.naturalHeight,
  });
  return fixedRowsAtTop(grow === undefined ? first : relayout(grow), relayout);
}

/**
 * Fixed bar rows on a canvas taller than the chart: the chart is
 * laid out again at its natural height and keeps the canvas it was given, so
 * the rows, the axis and the notes stay together at the top and the rest of
 * the canvas stays empty, where a content-fit chart leaves its host's air.
 */
function fixedRowsAtTop(
  geometry: Geometry<BarMarks, BarDerived>,
  relayout: (height: number) => Geometry<BarMarks, BarDerived>,
): Geometry<BarMarks, BarDerived> {
  const natural = geometry.sizing?.naturalHeight;
  if (natural === undefined || natural >= geometry.size.height) return geometry;
  return { ...relayout(natural), size: geometry.size };
}

function layoutBarVariant(
  data: ChartData,
  options: BarOptions,
  annotationPass: BarAnnotationPass | undefined,
  features: BarRowFeatures,
): Geometry<BarMarks, BarDerived> {
  refuseSignColor(data, options);
  if (options.variant === 'tornado' || options.variant === 'football-field') return (features.intervals ?? refuseRowIntervals)(data, options, options.variant);
  const geometry = layoutStandardBar(data, options, features, annotationPass, assembleBarGeometry, annotationPass?.footnoteRows);
  if (options.currentValue !== undefined) {
    geometry.warnings.push({
      code: 'current-value-ignored',
      severity: 'warn',
      message: 'currentValue applies only to bar variant football-field and was ignored',
      suggest: "set variant: 'football-field' or remove currentValue",
    });
  }
  if (options.baseValue !== undefined) geometry.warnings.push(baseValueIgnored());
  return geometry;
}


/**
 * signColor preconditions, as on column (fail closed, before any geometry). A
 * stacked segment's sign does not describe its stack, and a range bar has no
 * sign; silently ignoring the option would leave the agent reporting a
 * sign-coloured exhibit that is not one.
 */
function refuseSignColor(data: ChartData, options: BarOptions): void {
  if (options.signColor !== true) return;
  const variant = options.variant ?? 'grouped';
  const dataSeries = data.series.filter((s) => s.role !== 'reference').length;
  if (variant === 'grouped' && dataSeries === 1) return;
  throw new NormalizeError(
    'sign-color-unsupported',
    'options.signColor',
    `signColor requires variant 'grouped' with exactly one data-role series; got variant '${variant}' with ${dataSeries} data-role series`,
    'drop signColor, or split the stack into one bar chart per measure', undefined, ['options', 'signColor'],
  );
}

/** Mirror of current-value-ignored: baseValue is a tornado-only claim. */
export function baseValueIgnored(): LintWarning {
  return {
    code: 'base-value-ignored',
    severity: 'warn',
    message: 'baseValue applies only to bar variant tornado and was ignored',
    suggest: "set variant: 'tornado' (and options.tornado naming the two case series) or remove baseValue",
  };
}

export function barSizing(
  size: Size, area: Pick<BarArea, 'availH' | 'plot' | 'minWidth'>, step: number, labels: { h: number }[],
  naturalLabels = labels, fixedRowsH?: number, segmentStep = 0, targetSizing = false, textScale = 1, segmentMinStep = segmentStep, compactRows = false,
) {
  const { availH, plot, minWidth } = area;
  // The 28 px row floor holds a value at the label size, so it scales with the text:
  // at textScale 1.25 an unscaled floor sent every value to the compact font.
  const floor = compactRows ? 0 : 28 * textScale;
  // Fixed rows need exactly their own height, no less and no more.
  // reserve the solver's gap as well as the measured row and segment text.
  const labelGap = targetSizing || compactRows ? 4 : 0;
  const minimumRowsH = fixedRowsH ?? (plot.h / step) * Math.max(floor, targetSizing || compactRows ? segmentMinStep : 0, maxOf(labels.map((label) => label.h + labelGap)));
  return rowSizing('bar', size, {
    chromeH: size.height - availH,
    minWidth,
    minimumRowsH,
    // At its natural height a bar is thick enough for its segment labels.
    naturalRowsH: fixedRowsH ?? (plot.h / step) * Math.max(floor, segmentStep, maxOf(naturalLabels.map((label) => label.h + labelGap))),
  });
}

/** Phase 4, second half: the shared annotation pass, anchored on the drawn bars (horizontal value axis). */
function annotateBar(
  domain: BarDomain,
  area: BarArea,
  scene: BarMarkGeometry,
  occupied: OccupiedIndex,
  solveCtx: SolveCtx,
  annotationPass: BarAnnotationPass | undefined,
): AnnotatePassResult {
  const { cats } = domain;
  const { plot, x0, band } = area;
  const resolve = (ref: AnchorRef): AnchorResolution | null => {
    const norm = typeof ref === 'string' ? { categoryId: ref, edge: 'total' as const } : ref;
    if (!('categoryId' in norm)) return null;
    if (norm.seriesId) {
      const found = scene.anchorBySeg?.get(`${norm.categoryId}:${norm.seriesId}`);
      if (!found) return null;
      const named = [...domain.dataSeries, ...domain.refSeries].find((s) => s.id === norm.seriesId);
      const cell = named?.cells[cats.findIndex((c) => c.id === norm.categoryId)];
      const seg = { ...found, format: named?.format, ...(named && cell && domain.variant !== 'stacked100' ? { markValueText: displayFor(domain, found.value, cell, undefined, named) } : {}),
        ...(named && domain.dataSeries.length > 1 ? { series: { id: named.id, label: named.label } } : {}) };
      if (norm.edge === 'start') return { ...seg, x: x0 };
      return seg;
    }
    // Grouped bars with several series: one series, as column does.
    if (domain.variant === 'grouped' && domain.dataSeries.length > 1 && norm.edge !== 'start') {
      const anchorSeries = domain.dataSeries.find((x) => domain.highlights.has(x.id)) ?? domain.dataSeries[0]!;
      return resolve({ categoryId: norm.categoryId, seriesId: anchorSeries.id });
    }
    const found = scene.anchorByCat?.get(norm.categoryId);
    if (!found) return null;
    const cat = { ...found, format: domain.dataSeries.length === 1 ? domain.dataSeries[0]!.format : undefined };
    if (norm.edge === 'start') return { ...cat, x: x0, value: 0 };
    // a stack whose parts do not add, or that has a blank part, keeps its seat and has no value.
    return { ...cat, ...noTotal(domain.partsAdd, domain.stacks[cats.findIndex((c) => c.id === norm.categoryId)]!.hasValue && !domain.incompleteRows.has(norm.categoryId)) };
  };
  const passInput: AnnotatePassInput = {
    target: domain.options.target,
    annotations: domain.passAnns,
    resolve,
    defaultSpan:
      cats.length >= 2 ? { from: cats[0]!.id, to: cats[cats.length - 1]!.id } : undefined,
    occupied,
    plot,
    bandCeiling: area.frame.plot.y,
    theme: domain.theme,
    measure: domain.measure,
    ...barPassText(domain),
    toleranceKeyed: toleranceKeyed(domain.passAnns, area.frame.legend?.items),
    sharesFormat: domain.variant === 'stacked100',
    valueLinePercentLevels: domain.variant === 'stacked100' || domain.options.unit === '%' || percentLevels(domain.dataSeries.map(series => ({ vals: series.cells }))),
    valueLineLabels: valueLineLabelsOn(domain.options),
    solveCtx,
    meanValue: domain.meanValue,
    ...(domain.meanMissing ? { meanMissing: domain.meanMissing } : {}),
    xScale: area.x,
    ...categoryTargetFields(cats.map((c) => c.id), plot, (i) => band.position(i) + band.bandwidth / 2, 'y'),
    valueAxis: 'horizontal',
    calloutRowPitch: band.step,
    partialCategories: partialIds(cats),
    ...(!annotationPass && cagrInset(domain) ? { barInset: { gapWord: chartString(domain.options, 'gapLead') } } : {}),
  };
  if (annotationPass) return runAnnotatePass(annotationPass(passInput, scene.marks));
  // A plain bar's CAGR arm and its label stand in the room reserved right of
  // the plot (RIGHT_ROOM or the CAGR default), so the arm reaches into it.
  const room = area.frame.plot.x + area.frame.plot.w - (plot.x + plot.w);
  return runAnnotatePass(room > 0 ? { ...passInput, plot: { ...plot, w: plot.w + room } } : passInput);
}

/**
 * The two halves of a split option (likert's neutral) in one row are one block: the pair rule
 * for it, none without halves, so the seam pass can take its edge buckets.
 */
function halvesOfOneBlock(halves: { neg: string; pos: string } | undefined) {
  if (halves === undefined) return undefined;
  return (a: OwnerRef, b: OwnerRef) => a.categoryId === b.categoryId
    && ((a.seriesId === halves.neg && b.seriesId === halves.pos) || (a.seriesId === halves.pos && b.seriesId === halves.neg));
}

/** The sizing of a standard bar; the natural heights only set its natural height, not its minimum. */
function standardBarSizing(domain: BarDomain, area: BarArea, naturalLabels: { h: number }[]) {
  const { options, size } = domain;
  const hardMinimum = (options as { [HARD_MINIMUM]?: boolean })[HARD_MINIMUM] === true;
  return barSizing(size, area, area.band.step, area.catLines, naturalLabels, area.fixedRowsH, area.segmentStep, !hardMinimum, textScaleOf(options), area.segmentMinStep,
    domain.incompleteRows.size > 0 && options.mode === 'compact' && hardMinimum);
}

/** Phase 5: label nodes, the adjacency lint, the receipts, the sizing and the accessible text. */
function assembleBarGeometry(
  domain: BarDomain,
  area: BarArea,
  scene: BarMarkGeometry,
  solved: SolveResult,
  annotated: AnnotatePassResult,
  placedAnnotations: PlacedAnnotation[],
  occupied: OccupiedIndex,
  warnings: LintWarning[],
  /** Record texts a label prints for another owner, by label id (planBarLabels). */
  stated: ReadonlyMap<Id, Omit<ShownMark, 'drawn'>>,
): Geometry<BarMarks, BarDerived> {
  const { options, theme, size, measure, variant, cats, dataSeries, totals, shares, meanValue } = domain;
  const { tickFont, labelFont, strongFont, band } = area;
  const { nodes } = scene;
  const allLabels: PlacedLabel[] = [...solved.placed, ...annotated.labels];
  spliceAnnotationNodes(nodes, annotated.nodes);
  pushAll(
    nodes,
    labelsToNodes(theme, allLabels, (l) =>
      l.kind === 'grandTotal' || l.kind === 'total'
        ? strongFont
        : l.kind === 'category' || l.kind === 'percentIndicator' || l.kind === 'tick'
          ? tickFont
          : l.kind === 'annotation' || l.kind === 'valueLine'
            ? strongFont
            : l.kind === 'point'
              ? area.pointFont
              : labelFont, nodes,
    ),
  );
  const paintWarningRules: PaintWarningRule[] = [];
  pushAll(warnings, rectSeriesAdjacentWarnings(nodes, (paint) => paintColor(theme, paint), 'horizontal', domain.highlights, theme, { rules: paintWarningRules, before: warnings.filter(warning => !['pie-ramp-crowded', 'likert-ramp-invisible', 'band-lightness-insufficient', 'series-adjacent-similar', 'highlight-reads-as-loss'].includes(warning.code)).length },
    (options as { [DEFER_ADJACENT]?: boolean })[DEFER_ADJACENT] !== true));
  const totalsById: Record<Id, number> = emptyIdRecord();
  // Totals and shares retain the precision of the drawn values.
  // A row with no value has no total: omitted, not a certified 0.
  // grouped bars with several series, and a stack whose parts do not
  // add, have no total to certify or read out; one series is its own total.
  const totalsAdd = dataSeries.length === 1 || (variant !== 'grouped' && domain.partsAdd);
  if (totalsAdd) cats.forEach((c, ci) => { if (domain.stacks[ci]!.hasValue) totalsById[c.id] = totals[ci]!; });
  const sharesById: Record<Id, Record<Id, number>> | undefined =
    variant === 'stacked100'
      ? Object.fromEntries(
          cats.map((c, ci) => [
            c.id,
            // Shares are already scale-free percentages, so round2 is not a unit
            // hazard here — but it IS a receipt, and a receipt that disagrees with
            // the printed share on the third decimal is still a receipt that cannot
            // be recomputed. Raw for the same reason as the totals above.
            Object.fromEntries(dataSeries.map((s, si) => [s.id, shares[ci]![si]!])),
          ]),
        )
      : undefined;
  // A label that prints the value of another owner (a one-part stack's total): where it is drawn, the record takes its text.
  const shown: ShownMark[] = [];
  for (const label of allLabels) {
    const text = label.hidden === undefined ? stated.get(label.id) : undefined;
    if (!text) continue;
    shown.push({ ...text, drawn: true });
  }
  return {
    type: 'bar',
    size,
    sizing: standardBarSizing(domain, area, naturalCategoryHeights(cats, tickFont, area.capW, measure)),
    plot: area.plot,
    scene: withSegmentSeams(joinHatchPeers(nodes), theme, halvesOfOneBlock(barHalves(options))),
    labels: allLabels,
    axes: [
      {
        axis: 'y',
        baselineNodeId: 'axis:baseline',
        ticks: cats.map((c, i) => ({ at: c.id, pos: band.center(i), labelId: `category:${c.id}` })),
      },
      ...scene.axes,
    ],
    annotations: [...placedAnnotations, ...annotated.placed],
    legend: area.frame.legend,
    frame: area.frame.frame,
    marks: shown.length > 0 ? { ...scene.marks, shown } : scene.marks,
    derived: {
      totals: totalsById,
      stackParts: stackParts(totalsById, cats, dataSeries, (si, ci) => dataSeries[si]!.cells[ci]!.v),
      ...(sharesById ? { shares: sharesById } : {}),
      ...(domain.roundingAdjustments.length > 0 ? { roundingAdjustments: domain.roundingAdjustments } : {}),
      order: cats.map((c) => c.id),
      // Omitted rather than 0 when nothing is plotted: `derived` is a receipt
      // surface, and a fabricated 0 there is a number the engine certifies but
      // the data never produced.
      ...(meanValue === undefined ? {} : { mean: meanValue }),
    },
    a11y: a11yDescription(options, ['Bar chart', 'Balkendiagramm'], [structureCount('series', dataSeries.length, undefined, options), structureCount('categories', cats.length, undefined, options)], {
      counts: [structureCount('series', dataSeries.length, undefined, options)],
      titleCounts: [structureCount('categories', cats.length, undefined, options)],
    }),
    warnings,
    paintWarningRules,
    debug: {
      occupied: occupied.snapshot(),
      decisions: [...solved.decisions, ...annotated.decisions],
    },
  };
}

/**
 * The standard variants (grouped, stacked, stacked100) run five phases:
 * domain and scales (domain.ts, paints.ts, plot.ts), mark geometry
 * (marks.ts), label planning (labels.ts), the annotations (bar's own vertical
 * valueLines and indicator100 in annotations.ts before the solver, the shared
 * runAnnotatePass after it), and the geometry assembly above. The frame's own
 * index becomes the run's index; the marks and the local annotations claim
 * into indexes of their own, which this function replays in claim order.
 */
const BAND_TRIES = Symbol('bandTries');

function layoutStandardBar<R extends { labels: PlacedLabel[]; refused?: false }>(
  data: ChartData,
  options: BarOptions,
  features: BarRowFeatures,
  annotationPass: BarAnnotationPass | undefined,
  finish: (...parts: Parameters<typeof assembleBarGeometry>) => R,
  rowsForFrame?: BarRowsForFrame<R>,
): R {
  const warnings: LintWarning[] = [];
  const reuseData = annotationPass === undefined || (annotationPass.skipWhenEmpty === true && !options.annotations?.length && !options.averageMarker);
  const { domain, paints } = prepareBar(data, options, warnings, reuseData, features.topN);
  const framed = solveBarFrame(domain, paints, warnings);
  const occupied = framed.claims;
  const area = barPlotArea(domain, framed.frame, warnings, features);
  const inline = !area.groupLabels && labelOn(options, 'category') && !(options as { [NO_NAME_COLUMN]?: boolean })[NO_NAME_COLUMN]
    ? inlineCategoryGroups(data, domain.cats) : undefined;
  if (inline) return layoutStandardBar(inline, options, features, annotationPass, finish, rowsForFrame);
  // The cut row names go to the notes once; the note moves the plot, so the chart refits.
  if (area.cutNotes.length > 0 && (options as { [CUT_NOTES]?: string[] })[CUT_NOTES] === undefined) {
    return layoutStandardBar(data, { ...options, [CUT_NOTES]: area.cutNotes } as BarOptions, features, annotationPass, finish, rowsForFrame);
  }
  // A caller that keeps the bar only when its rows fit (STOP_IF_TOO_TALL) learns it now, before the marks and labels cost anything.
  if ((options as { [STOP_IF_TOO_TALL]?: boolean })[STOP_IF_TOO_TALL] === true
    && standardBarSizing(domain, area, area.catLines).minHeight > domain.size.height + SIZE_TOLERANCE) throw new BarTooTall();
  const needsAnnotationPass = domain.passAnns.length > 0 || !isCachedTextMeasurer(domain.measure)
    || (annotationPass !== undefined && !annotationPass.skipWhenEmpty);
  const rows = rowsForFrame && !needsAnnotationPass && !domain.localAnns.length && domain.running.size === 0
    ? rowsForFrame(domain, area, occupied, warnings) : undefined;
  if (rows && 'result' in rows) return rows.result;
  const scene = layoutBarMarks(domain, paints, area, needsAnnotationPass);
  const local = layoutBarLocalAnnotations(domain, area, warnings, features.indicator);
  pushAll(scene.nodes, local.nodes);
  for (const c of [...scene.claims.snapshot(), ...local.claims.snapshot()]) occupied.claim(c.rect, c.kind, c.owner, c.part);
  const { size, theme } = domain;
  const solveCtx: SolveCtx = labelCtx(theme, size, options, {
    measure: domain.measure,
    plot: area.plot,
    labelPad: 2,
    // values valueLabels picks are no scatter; each one that cannot sit goes to the note alone.
    seriesUniform: pickedValues(options) ? undefined : bandValueLabelUniformity(),
  });
  // the value-axis title is a label under the tick row, solved first.
  const titleRequests = area.axisTitle && area.axisTitleAt && options.valueAxis?.show
    ? [valueAxisTitleRequest(area.axisTitle, area.axisTitleAt, 'end', 'axis:x:title')]
    : [];
  if (area.categoryTitle) titleRequests.push(area.categoryTitle);
  const stated = new Map<Id, Omit<ShownMark, 'drawn'>>();
  const requested = planBarLabels(domain, paints, area, scene, warnings, stated, features.alignRow);
  if (features.positionLabels && hasLabelPosition(options)) features.positionLabels(requested, domain, paints, scene);
  const values = keepValuesWithoutAxis(requested, solveCtx.density, options.valueAxis?.show === true);
  const solved = solveLabels([...titleRequests, ...values, ...local.requests], occupied, solveCtx);
  // A running period keeps a cue: a to-date value without a seat, or a value and words taller than the drawn row, bring the hatch key back.
  const toDate = toDateOnValues(domain);
  const toDateRoomH = toDateRoom(area.band.bandwidth);
  if (toDate.size > 0 && solved.placed.some((l) => (l.kind === 'grandTotal' || l.kind === 'point') && toDate.has(l.owner.categoryId ?? '')
    && (l.hidden !== undefined || l.rect.h > toDateRoomH))) {
    return layoutStandardBar(data, { ...options, [PARTIAL_KEY]: true } as BarOptions, features, annotationPass, finish);
  }
  applyValueAxisTitleInk(solved.placed);
  // A reference value reads muted, apart from the bar's own value.
  for (const label of solved.placed) if (label.id.startsWith('tick:') && !label.hidden) label.ink = { token: 'inkMuted' };
  pushAll(warnings, solved.warnings);
  // Prune the local indicator when its label hides.
  pruneOrphanAnnotationArms(scene.nodes, local.placed, solved.placed);
  const annotated = needsAnnotationPass
    ? annotateBar(domain, area, scene, occupied, solveCtx, annotationPass)
    : emptyAnnotatePass();
  // A CAGR arm too near its bars to give its arrow end the minimum shaft
  // (MIN_LEG) gets the room it lacked, over at most three more layouts.
  const room = (options as { [RIGHT_ROOM]?: number; [CAGR_TRIES]?: number; [BAND_PAD]?: number; [BAND_TRIES]?: number });
  if (annotated.legDeficit > 0.5 && !annotationPass && (room[CAGR_TRIES] ?? 0) < 3
    && (room[RIGHT_ROOM] === undefined || room[CAGR_TRIES] !== undefined)) {
    return layoutStandardBar(data, {
      ...options,
      [RIGHT_ROOM]: (room[RIGHT_ROOM] ?? (cagrInset(domain) ? CAGR_INSET_ROOM : CAGR_ROOM)) + Math.ceil(annotated.legDeficit) + 2,
      [CAGR_TRIES]: (room[CAGR_TRIES] ?? 0) + 1,
    } as BarOptions, features, annotationPass, finish);
  }
  // Room reserved right of the plot for a CAGR arm that is not drawn
  // (its label found no seat) goes back to the plot, in one more layout.
  const cagrs = annotated.placed.filter((placed) => placed.kind === 'cagr');
  const cagrHidden = cagrs.length > 0 && cagrs.every((placed) => annotated.labels.some((label) => label.id === placed.labelId && label.hidden));
  // Type steps: a hidden CAGR label first gets one more layout with wider room, then the room goes back.
  if (!annotationPass && cagrHidden && room[RIGHT_ROOM] !== 0 && (room[CAGR_TRIES] ?? 0) < 3 && cagrInset(domain)) {
    const wider = layoutStandardBar(data, { ...options, [RIGHT_ROOM]: (room[RIGHT_ROOM] ?? CAGR_INSET_ROOM) + 24, [CAGR_TRIES]: 3 } as BarOptions, features, annotationPass, finish);
    if (!wider.refused && wider.labels.some((label) => cagrs.some((placed) => placed.labelId === label.id) && !label.hidden)) return wider;
  }
  if (!annotationPass && room[RIGHT_ROOM] !== 0 && cagrHidden) {
    return layoutStandardBar(data, { ...options, [RIGHT_ROOM]: 0, [CAGR_TRIES]: 3 } as BarOptions, features, annotationPass, finish);
  }
  if (annotated.bandNeed > 0 && (room[BAND_TRIES] ?? 0) < 2) {
    return layoutStandardBar(data, {
      ...options,
      [BAND_PAD]: (room[BAND_PAD] ?? 0) + Math.ceil(annotated.bandNeed),
      [BAND_TRIES]: (room[BAND_TRIES] ?? 0) + 1,
    } as BarOptions, features, annotationPass, finish);
  }
  pushAll(warnings, annotated.warnings);
  const result = finish(domain, area, scene, solved, annotated, local.placed, occupied, warnings, stated);
  rows?.save(result);
  return result;
}

/** Natural rows retain the two category lines even when the current frame thins them. */
export function naturalCategoryHeights(cats: readonly { id: string; label?: string }[], font: FontSpec, width: number, measure: TextMeasurer) {
  // A name past two lines needs the step plot.ts asks for its lines (lines x line height + 4).
  return cats.map((cat) => {
    const lines = wrapText(cat.label ?? cat.id, font, width, CAT_MAX_LINES, measure).lines.length;
    return { h: lines * font.size * 1.2 + (lines > 2 ? 4 : 0) };
  });
}
