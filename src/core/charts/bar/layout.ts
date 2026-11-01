import { pickedValues, withValueLabelDefaults } from '../band/valueSelection';
import { chartPalette, chartTheme } from '../chartEnv';
import { chartString } from '../../strings/bar';
import { separationStroke, withSegmentSeams } from '../../markVisibility';
import { stringFields, withLocaleStrings } from '../../strings';
import { structureCount, type StructureCount } from '../../structureCounts';
import type { PaintWarningRule } from '../../types/scene';
/**
 * Bar — the horizontal twin of column.
 * Categories run top→down as rows, values run left→right from a vertical
 * zero baseline. Label policy is the bar-family cascade: inside-end →
 * outside-end (right of the bar); negatives extend left and label
 * outside-left. Variants: grouped | stacked | stacked100.
 */

import { rowLabelBand } from '../../label/rowLabels';
import { fittedLabel, gutterBudget, stepDownFont } from '../../label/rowFit';
import { PARTIAL_KEY, partialIds, toDateRoom } from '../../partialPeriod';
import { noTotal } from '../../stackAdds';
import type { AnchorResolution, AnnotatePassInput, AnnotatePassResult } from '../../annotate';
import { BAND_PAD, pruneOrphanAnnotationArms } from '../../annotateParts';
import { percentLevels, runAnnotatePass } from '../../annotatePass';
import { categoryTargetFields, spliceAnnotationNodes } from '../../annotateFields';
import { rectSeriesAdjacentWarnings } from '../../adjacentSeries';
import { applyValueAxisTitleInk, layoutValueAxis, planValueAxisTitle, tickRowTitleEnd, valueAxisTitleRequest, valueAxisTitleText, valueAxisUnit } from '../../axis';
import { NOT_AVAILABLE } from '../../format';
import { seriesRasterFormatter } from '../../formatSpec';
import { rectContains, rectsOverlap, rowLabelX, unionRect, type Rect, type Size } from '../../geometry';
import { bandValueLabelUniformity, keepValuesWithoutAxis } from '../band/labels';
import { stackParts, withoutShareAnnotations } from '../band/stacks';
import { labelsToNodes } from '../../label/emit';
import { createOccupiedIndex, type OccupiedIndex } from '../../label/occupied';
import {
  labelCtx,
  PRIORITY,
  solveLabels,
  type LabelRequest,
  type SlotCandidate,
  type SolveCtx,
  type SolveResult,
} from '../../label/solver';
import { accessibleTitle,
  NormalizeError,
  normalizeCategory,
  normalizeSeriesValues,
  resolveHighlight,
  resolveSize,
} from '../../normalize/shared';
import { rangeMidUndrawn, resolveCellRange, type RangeMark } from '../../rangeRules';
import { applyAxisBounds, bandScale, linearScale, niceDomain, type BandScale } from '../../scale';
import { authoredNotes, frameTextOptions, normalizeLegendOption, solveFrame, type LegendItemInput, plotHeightAfter, authoredFootnoteCount } from '../../frame';
import { HARD_MINIMUM, rowSizing, SIZE_TOLERANCE } from '../../sizing';
import { rowDrivenHeight } from '../../rowCanvas';
import { defaultMeasurer, wrapText, type FontSpec, type TextMeasurer } from '../../text';
import {
  canvasMargin,
  joinHatchPeers,
  markRolePaint,
  paintColor,
  panelTypeClass,
  resolveTheme,
  seriesPaint as themeSeriesPaint,
  typeWidthClass,
  emphasisWeight,
  strokeToken,
  dashToken,
} from '../../theme';
import type { AnchorRef } from '../../types/annotations';
import { cellMeta, cellValue, type CellMeta, type Id, type OwnerRef } from '../../types/cell';
import type { ChartData } from '../../types/data';
import type { BarOptions, LabelKind, LegendOptions } from '../../types/options';
import type {
  Geometry,
  LintWarning,
  Paint,
  PlacedAnnotation,
  PlacedLabel,
  SceneNode,
} from '../../types/scene';
import type { Theme } from '../../types/theme';
import type { FootballFieldBarOptions, TornadoBarOptions } from './types';
import { layoutBarLocalAnnotations } from './annotations';
import { displayFor, resolveBarDomain, textFor, toDateOnValues } from './domain';
import { labelOn as barLabelOn } from '../labelOn';
import { planBarLabels } from './labels';
import { layoutBarMarks } from './marks';
import { barHalves, cagrInset, CAGR_INSET_ROOM, CAGR_ROOM, CAGR_TRIES, CAT_BAND_GAP, CAT_MAX_LINES, BarTooTall, CUT_NOTES, DEFER_ADJACENT, fixedBarRow, LABEL_GAP, NO_NAME_COLUMN, RIGHT_ROOM, STOP_IF_TOO_TALL, type BarArea, type BarDomain, type BarMarkGeometry } from './model';
import { barPaints } from './paints';
import { barPlotArea, solveBarFrame } from './plot';
import { composedTextRole } from '../../textRole';
import { withBandValueNotes } from '../band/valueNotes';
import { textScaleOf } from '../../typeFloors';
import { disclosureNote, disclosuresShown } from '../../notes';
import { omittedKey } from '../../seriesIdentity';
import { maxOf, minOf, pushAll } from '../../arrays';
import { emptyIdRecord } from '../../idRecords';

export interface BarMarks {
  rows: { id: Id; rect: Rect; bars: { seriesId: Id; rect: Rect; nodeId: Id }[] }[];
  referenceTicks: { seriesId: Id; categoryId: Id; nodeId: Id }[];
  rowTints: { categoryId: Id; nodeId: Id }[];
  ranges?: RangeMark[];
  currentValue?: { value: number; nodeId: Id; labelId?: Id };
  /** tornado only: the base-case spine. A different claim from currentValue. */
  baseValue?: { value: number; nodeId: Id; labelId?: Id };
}

/** One driver's one-at-a-time sensitivity receipt. Every field is derived. */
interface TornadoRowDerived {
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

function warnRangeBarIgnoredRanking(
  mode: 'football-field' | 'tornado',
  options: { topN?: unknown; sort?: { segments?: string } },
  warnings: LintWarning[],
): void {
  if (options.topN) {
    warnings.push(
      mode === 'football-field'
        ? {
            code: 'football-field-topn-ignored',
            severity: 'warn',
            message: 'football-field does not aggregate method ranges with topN; all methods remain visible',
            suggest: 'filter methods before layout instead of aggregating intervals',
          }
        : {
            code: 'tornado-topn-ignored',
            severity: 'warn',
            message: 'tornado does not aggregate drivers with topN; all drivers remain visible',
            suggest: 'drop the drivers you do not want before layout — an aggregated driver has no one-at-a-time swing',
          },
    );
  }
  if (options.sort?.segments && options.sort.segments !== 'sheet') {
    warnings.push({
      code: `${mode}-sort-segments-ignored`,
      severity: 'warn',
      message: `${mode} has no stacked segments; sort.segments '${options.sort.segments}' was ignored`,
      suggest: "drop sort.segments, or use variant 'stacked' / 'grouped'",
    });
  }
}
/** Internal adapter for charts whose displayed segments encode derived values. */
export type BarAnnotationPass = (input: AnnotatePassInput, marks: BarMarks) => AnnotatePassInput;

const LABEL_PAD = 2;
/** The current-value claim is x±0.5 because the rule has width 1. */
const SPINE_CLAIM_HALF_WIDTH = 0.5;

export function layoutBar(
  data: ChartData,
  options: BarOptions = {},
  annotationPass?: BarAnnotationPass,
): Geometry<BarMarks, BarDerived> {
  const dropped: LintWarning[] = [];
  options = withoutShareAnnotations(withValueLabelDefaults(withLocaleStrings(options), 'bar', options.variant), options.variant === 'stacked100', dropped);
  const layout = (next: BarOptions) => layoutBarSized(data, next, annotationPass);
  const geo = withBandValueNotes(data, options, layout);
  const natural = geo.sizing?.naturalHeight;
  if (natural !== undefined && natural < geo.size.height) {
    // a shorter row layout may need a disclosure that the tall layout did not.
    const probe = withBandValueNotes(data, { ...options, size: { width: geo.size.width, height: natural } }, layout);
    if (probe.sizing && probe.sizing.minHeight > natural) geo.sizing = { ...geo.sizing!, naturalHeight: probe.sizing.minHeight };
  }
  geo.warnings.push(...dropped);
  return geo;
}

function layoutBarSized(
  data: ChartData,
  options: BarOptions,
  annotationPass?: BarAnnotationPass,
): Geometry<BarMarks, BarDerived> {
  const first = layoutBarVariant(data, options, annotationPass);
  if (!resolveTheme(options.theme).space.barRow || first.sizing === undefined) return first;
  const relayout = (height: number) =>
    layoutBarVariant(data, { ...options, size: { width: first.size.width, height } }, annotationPass);
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
  annotationPass?: BarAnnotationPass,
): Geometry<BarMarks, BarDerived> {
  refuseSignColor(data, options);
  if (options.variant === 'tornado') {
    refuseTornadoDetails(data, options);
    return layoutTornado(data, options as TornadoBarOptions);
  }
  if (options.variant === 'football-field') {
    const fieldGeometry = layoutFootballField(data, options as FootballFieldBarOptions);
    if (options.baseValue !== undefined) fieldGeometry.warnings.push(baseValueIgnored());
    return fieldGeometry;
  }
  const geometry = layoutStandardBar(data, options as BarOptions, annotationPass);
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
 * A tornado row joins a low and a high case into one swing, so no one cell's
 * details describe it; refusing beats a card that silently drops them.
 */
function refuseTornadoDetails(data: ChartData, options: BarOptions): void {
  const carries = data.series.some(series => series.values.some(cell => {
    const value = cell !== null && typeof cell === 'object' && 'value' in cell ? (cell as { value: unknown }).value : cell;
    return value !== null && typeof value === 'object' && 'details' in value;
  }));
  if (!carries && options.detailFields === undefined) return;
  throw new NormalizeError(
    'details-variant',
    carries ? 'series' : 'options.detailFields',
    "cell details reach the hover card of one value; bar variant 'tornado' draws each row from two cases",
    "remove the details and detailFields, or draw the cases with variant 'grouped'",
  );
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
    'drop signColor, or split the stack into one bar chart per measure',
  );
}

/** Mirror of current-value-ignored: baseValue is a tornado-only claim. */
function baseValueIgnored(): LintWarning {
  return {
    code: 'base-value-ignored',
    severity: 'warn',
    message: 'baseValue applies only to bar variant tornado and was ignored',
    suggest: "set variant: 'tornado' (and options.tornado naming the two case series) or remove baseValue",
  };
}

function barSizing(
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
      const found = scene.anchorBySeg.get(`${norm.categoryId}:${norm.seriesId}`);
      if (!found) return null;
      const named = [...domain.dataSeries, ...domain.refSeries].find((s) => s.id === norm.seriesId);
      const seg = { ...found, format: named?.format, ...(named && domain.dataSeries.length > 1 ? { series: { id: named.id, label: named.label } } : {}) };
      if (norm.edge === 'start') return { ...seg, x: x0 };
      return seg;
    }
    // Grouped bars with several series: one series, as column does.
    if (domain.variant === 'grouped' && domain.dataSeries.length > 1 && norm.edge !== 'start') {
      const anchorSeries = domain.dataSeries.find((x) => domain.highlights.has(x.id)) ?? domain.dataSeries[0]!;
      return resolve({ categoryId: norm.categoryId, seriesId: anchorSeries.id });
    }
    const found = scene.anchorByCat.get(norm.categoryId);
    if (!found) return null;
    const cat = { ...found, format: domain.dataSeries.length === 1 ? domain.dataSeries[0]!.format : undefined };
    if (norm.edge === 'start') return { ...cat, x: x0, value: 0 };
    // a stack whose parts do not add, or whose parts are all blank, keeps its seat and has no value.
    return { ...cat, ...noTotal(domain.partsAdd, domain.stacks[cats.findIndex((c) => c.id === norm.categoryId)]!.hasValue) };
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
    format: domain.options.format,
    locale: domain.options.locale?.language,
    strings: domain.options.strings,
    valueLinePercentLevels: domain.variant === 'stacked100' || domain.options.unit === '%' || percentLevels(domain.dataSeries.map(series => ({ vals: series.cells }))),
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
): Geometry<BarMarks, BarDerived> {
  const { options, theme, size, measure, variant, cats, dataSeries, fmt, totalFmt, totals, shares, meanValue } = domain;
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
  // Receipt value: the engine's raw answer (see receiptValue), not a rounded
  // one.
  // A row with no value has no total: omitted, not a certified 0.
  // grouped bars with several series, and a stack whose parts do not
  // add, have no total to certify or read out; one series is its own total.
  const totalsAdd = dataSeries.length === 1 || (variant !== 'grouped' && domain.partsAdd);
  if (totalsAdd) cats.forEach((c, ci) => { if (domain.stacks[ci]!.hasValue) totalsById[c.id] = receiptValue(totals[ci]!); });
  const sharesById: Record<Id, Record<Id, number>> | undefined =
    variant === 'stacked100'
      ? Object.fromEntries(
          cats.map((c, ci) => [
            c.id,
            // Shares are already scale-free percentages, so round2 is not a unit
            // hazard here — but it IS a receipt, and a receipt that disagrees with
            // the printed share on the third decimal is still a receipt that cannot
            // be recomputed. Raw for the same reason as the totals above.
            Object.fromEntries(dataSeries.map((s, si) => [s.id, receiptValue(shares[ci]![si]!)])),
          ]),
        )
      : undefined;
  const variantWord =
    variant === 'grouped' ? chartString(options, 'groupedCapital') : variant === 'stacked' ? chartString(options, 'stackedCapital') : chartString(options, 'stacked100');
  // One series reads out each value as its label prints it: the cell or
  // series format and an authored label, not the chart format alone.
  const oneValueText = (ci: number): string | null => {
    const s = dataSeries.length === 1 ? dataSeries[0]! : undefined;
    const cell = s?.cells[ci];
    if (!s || !cell || cell.v === null) return null;
    return textFor(domain, cell.v, cell, undefined, s) ?? displayFor(domain, cell.v, cell, undefined, s);
  };
  // A category with no value at all has no total; the description says so
  // rather than read out a zero.
  const a11yDesc = cats
    .map((c, ci) =>
      !domain.stacks[ci]!.hasValue
        ? `${c.label} ${NOT_AVAILABLE}`
        : variant === 'stacked100'
          ? `${c.label} ${totalFmt(totals[ci]!)} (${dataSeries.map((s, si) => `${s.label} ${domain.pctFmt(shares[ci]![si]!)}`).join(', ')})`
          : `${c.label} ${oneValueText(ci) ?? totalFmt(totals[ci]!)}`,
    )
    .join(', ');
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
    marks: scene.marks,
    derived: {
      totals: totalsById,
      stackParts: stackParts(totalsById, cats, dataSeries, (si, ci) => dataSeries[si]!.cells[ci]!.v),
      ...(sharesById ? { shares: sharesById } : {}),
      ...(domain.roundingAdjustments.length > 0 ? { roundingAdjustments: domain.roundingAdjustments } : {}),
      order: cats.map((c) => c.id),
      // Omitted rather than 0 when nothing is plotted: `derived` is a receipt
      // surface, and a fabricated 0 there is a number the engine certifies but
      // the data never produced.
      ...(meanValue === undefined ? {} : { mean: receiptValue(meanValue) }),
    },
    a11y: {
      titleCounts: [structureCount('categories', cats.length, undefined, options)],
      title: accessibleTitle(options.title, chartString(options, 'barTitle', { v1: cats.length })),
      counts: [structureCount('series', dataSeries.length, undefined, options)],
      desc:
        chartString(options, 'barDesc', { v1: variantWord, v2: dataSeries.length, v3: totalsAdd ? ` ${a11yDesc}.` : '' }) +
        (scene.rangeMarks.length
          ? chartString(options, 'rangesClause', { v1: scene.rangeMarks
              .map((range) => chartString(options, 'namedRange', { v1: range.categoryId, v2: fmt(range.low), v3: fmt(range.high) }))
              .join(', ') })
          : ''),
    },
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

function layoutStandardBar(
  data: ChartData,
  options: BarOptions = {},
  annotationPass?: BarAnnotationPass,
): Geometry<BarMarks, BarDerived> {
  const warnings: LintWarning[] = [];
  const domain = resolveBarDomain(data, options, warnings);
  const paints = barPaints(domain, warnings);
  const framed = solveBarFrame(domain, paints, warnings);
  const occupied = framed.claims;
  const area = barPlotArea(domain, framed.frame, warnings);
  // The cut row names go to the notes once; the note moves the plot, so the chart refits.
  if (area.cutNotes.length > 0 && (options as { [CUT_NOTES]?: string[] })[CUT_NOTES] === undefined) {
    return layoutStandardBar(data, { ...options, [CUT_NOTES]: area.cutNotes } as BarOptions, annotationPass);
  }
  // A caller that keeps the bar only when its rows fit (STOP_IF_TOO_TALL) learns it now, before the marks and labels cost anything.
  if ((options as { [STOP_IF_TOO_TALL]?: boolean })[STOP_IF_TOO_TALL] === true
    && standardBarSizing(domain, area, area.catLines).minHeight > domain.size.height + SIZE_TOLERANCE) throw new BarTooTall();
  const scene = layoutBarMarks(domain, paints, area);
  const local = layoutBarLocalAnnotations(domain, area, warnings);
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
  const values = keepValuesWithoutAxis(planBarLabels(domain, paints, area, scene, warnings), solveCtx.density, options.valueAxis?.show === true);
  const solved = solveLabels([...titleRequests, ...values, ...local.requests], occupied, solveCtx);
  // A running period keeps a cue: a to-date value without a seat, or a value and words taller than the drawn row, bring the hatch key back.
  const toDate = toDateOnValues(domain);
  const toDateRoomH = toDateRoom(area.band.bandwidth);
  if (toDate.size > 0 && solved.placed.some((l) => (l.kind === 'grandTotal' || l.kind === 'point') && toDate.has(l.owner.categoryId ?? '')
    && (l.hidden !== undefined || l.rect.h > toDateRoomH))) {
    return layoutStandardBar(data, { ...options, [PARTIAL_KEY]: true } as BarOptions, annotationPass);
  }
  applyValueAxisTitleInk(solved.placed);
  // A reference value reads muted, apart from the bar's own value.
  for (const label of solved.placed) if (label.id.startsWith('tick:') && !label.hidden) label.ink = { token: 'inkMuted' };
  pushAll(warnings, solved.warnings);
  // Prune the local indicator when its label hides.
  pruneOrphanAnnotationArms(scene.nodes, local.placed, solved.placed);
  const annotated = annotateBar(domain, area, scene, occupied, solveCtx, annotationPass);
  // A CAGR arm too near its bars to give its arrow end the minimum shaft
  // (MIN_LEG) gets the room it lacked, over at most three more layouts.
  const room = (options as { [RIGHT_ROOM]?: number; [CAGR_TRIES]?: number; [BAND_PAD]?: number; [BAND_TRIES]?: number });
  if (annotated.legDeficit > 0.5 && !annotationPass && (room[CAGR_TRIES] ?? 0) < 3
    && (room[RIGHT_ROOM] === undefined || room[CAGR_TRIES] !== undefined)) {
    return layoutStandardBar(data, {
      ...options,
      [RIGHT_ROOM]: (room[RIGHT_ROOM] ?? (cagrInset(domain) ? CAGR_INSET_ROOM : CAGR_ROOM)) + Math.ceil(annotated.legDeficit) + 2,
      [CAGR_TRIES]: (room[CAGR_TRIES] ?? 0) + 1,
    } as BarOptions, annotationPass);
  }
  // Room reserved right of the plot for a CAGR arm that is not drawn
  // (its label found no seat) goes back to the plot, in one more layout.
  const cagrs = annotated.placed.filter((placed) => placed.kind === 'cagr');
  const cagrHidden = cagrs.length > 0 && cagrs.every((placed) => annotated.labels.some((label) => label.id === placed.labelId && label.hidden));
  // Type steps: a hidden CAGR label first gets one more layout with wider room, then the room goes back.
  if (!annotationPass && cagrHidden && room[RIGHT_ROOM] !== 0 && (room[CAGR_TRIES] ?? 0) < 3 && cagrInset(domain)) {
    const wider = layoutStandardBar(data, { ...options, [RIGHT_ROOM]: (room[RIGHT_ROOM] ?? CAGR_INSET_ROOM) + 24, [CAGR_TRIES]: 3 } as BarOptions, annotationPass);
    if (!wider.refused && wider.labels.some((label) => cagrs.some((placed) => placed.labelId === label.id) && !label.hidden)) return wider;
  }
  if (!annotationPass && room[RIGHT_ROOM] !== 0 && cagrHidden) {
    return layoutStandardBar(data, { ...options, [RIGHT_ROOM]: 0, [CAGR_TRIES]: 3 } as BarOptions, annotationPass);
  }
  if (annotated.bandNeed > 0 && (room[BAND_TRIES] ?? 0) < 2) {
    return layoutStandardBar(data, {
      ...options,
      [BAND_PAD]: (room[BAND_PAD] ?? 0) + Math.ceil(annotated.bandNeed),
      [BAND_TRIES]: (room[BAND_TRIES] ?? 0) + 1,
    } as BarOptions, annotationPass);
  }
  pushAll(warnings, annotated.warnings);
  return assembleBarGeometry(domain, area, scene, solved, annotated, local.placed, occupied, warnings);
}

/* ------------------------------------------------------------------------ *
 * Row-interval skeleton — shared by variant 'football-field' and 'tornado'.
 *
 * Both variants are horizontal rows on ONE continuous value domain with an
 * authored vertical marker line. They differ only in what is painted INSIDE a
 * row, so each mode contributes a PLAN (pieces in domain units, endpoint
 * labels, spine, legend, derived, a11y) and everything downstream — frame,
 * category band, domain, band scale, axis, solver context, a11y assembly — is
 * shared. A second copy of this engine would drift from its twin, so the mode
 * hooks stay data, not code.
 * ------------------------------------------------------------------------ */

type RowIntervalMode = 'football-field' | 'tornado';

/** Exactly what normalizeCategory returns; its label stays optional. */
type RowCat = ReturnType<typeof normalizeCategory>;

interface PiecePaint {
  fill: Paint;
  pattern?: 'hatch45' | 'outline';
  stroke?: Paint;
  strokeWidth?: number;
}

/** One painted interval inside a row, in DOMAIN units — never pixels. */
interface RowPiece {
  from: number;
  to: number;
  role: 'low' | 'high' | 'span';
  seriesId: Id;
  nodeId: Id;
  part: string;
  paint: PiecePaint;
  display?: string;
}

interface RowEndpoint {
  id: Id;
  owner: OwnerRef;
  value: number;
  /** Cascade direction: 'low' labels leftwards, 'high' rightwards. */
  side: 'low' | 'high';
}

interface PlannedRow {
  cat: RowCat;
  pieces: RowPiece[];
  endpoints: RowEndpoint[];
  mid?: { value: number; id: Id; owner: OwnerRef; claimSeriesId: Id };
  /** Texts that can sit left / right of the row; they drive the plot reserve. */
  leftText: string;
  rightText: string;
}

interface RowSpine {
  /** Annotation id, node id stem and occupied-index tag. */
  key: 'currentValue' | 'baseValue';
  value: number;
  /** What is DRAWN — the author's label whenever one was supplied. */
  text: string;
  /**
   * What the ENGINE derived from `value`, kept SEPARATE from `text`.
   *
   * `claims/index.ts:152-158` detects an authored override by comparing the
   * drawn label against the annotation's `computedText`. Feeding it the
   * author's own string as the "computed" one defeats that comparison
   * permanently: the override can never be detected, and the receipt certifies
   * an authored number as engine-derived. On a tornado that is the worst
   * possible place for it — every bar on the exhibit means "distance from the
   * base case", so a wrong spine label makes every bar a wrong statement while
   * the manifest says the chart verified clean.
   */
  computedText: string;
}

interface RowIntervalPlan {
  cats: RowCat[];
  rows: PlannedRow[];
  spine?: RowSpine;
  /**
   * Frame footnotes the ENGINE owns, appended after the author's own. Only
   * notes a reader needs to read the bars correctly (hatched bars, drivers
   * not shown); the method notes join them with `methodNote: true`.
   */
  methodNotes?: string[];
  legend?: { options: LegendOptions; items: LegendItemInput[] };
  ranges?: RangeMark[];
  derived: BarDerived;
  /**
   * The formatter this plan's own texts were built with (`leftText`,
   * `rightText`, the spine label, the a11y description). The drawn endpoint
   * labels read THIS, so a variant whose plotted series carries its own format
   * (football-field, one data series) draws exactly what it measured and
   * what its accessible text says.
   */
  valueFmt?: (value: number) => string;
  a11yTitle: string;
  a11yTitleCounts: StructureCount[];
  a11yDesc: string;
}

interface RowPlanCtx {
  warnings: LintWarning[];
  theme: Theme;
  /** Resolved palette ramp, or undefined for the theme's own series colours. */
  paletteRamp: string[] | undefined;
  fmt: (value: number) => string;
  /**
   * Per-series formatter: a series `format` example or `unit` overrides
   * the chart-level one, exactly as `valueSpec.forSeries` does on the standard
   * bar path. Row-interval variants read it for the series they plot.
   */
  forSeries: (series: { format?: string; unit?: string }) => (value: number) => string;
  labelOn: (kind: LabelKind) => boolean;
  highlights: Set<Id>;
}


function outsideLaneCandidates(
  side: RowEndpoint['side'],
  endpointX: number,
  textSize: { width: number; height: number },
  rowCenter: number,
  occupied: OccupiedIndex,
  currentRuleClaim: Rect | undefined,
  canvas: Rect,
  valueBody: Rect,
  rowLane: Rect,
): SlotCandidate[] {
  const slot = side === 'low' ? 'outsideLow' : 'outsideHigh';
  const canonicalX =
    side === 'low'
      ? endpointX - LABEL_GAP - textSize.width
      : endpointX + LABEL_GAP;
  // The ownership lane, from the endpoint to the value body's edge, is the
  // only limit on the slide: a label that needs a few pixels more than its
  // own width to clear the current-value rule still lands in its row.
  const lane: Rect =
    side === 'low'
      ? { x: valueBody.x, y: rowLane.y, w: Math.max(0, endpointX - valueBody.x), h: rowLane.h }
      : {
          x: endpointX,
          y: rowLane.y,
          w: Math.max(0, valueBody.x + valueBody.w - endpointX),
          h: rowLane.h,
        };
  const rectAt = (x: number): Rect => ({
    x,
    y: rowCenter - textSize.height / 2,
    w: textSize.width,
    h: textSize.height,
  });
  let rect = rectAt(canonicalX);
  const candidates: SlotCandidate[] = [];

  const contained = (candidate: Rect): boolean =>
    rectContains(canvas, candidate, 0) &&
    rectContains(valueBody, candidate, 0) &&
    rectContains(rowLane, candidate, 0) &&
    rectContains(lane, candidate, 0) &&
    (side === 'low' ? candidate.x + candidate.w <= endpointX : candidate.x >= endpointX);

  while (contained(rect)) {
    candidates.push({ slot, rect, penalty: candidates.length });
    const blockerRects = occupied.hitsWhich(rect, LABEL_PAD).map((claim) => claim.rect);
    if (currentRuleClaim && rectsOverlap(currentRuleClaim, rect, LABEL_PAD)) {
      blockerRects.push(currentRuleClaim);
    }
    if (blockerRects.length === 0) break;

    const nextX =
      side === 'low'
        ? minOf(blockerRects.map((blocker) => blocker.x - LABEL_PAD - textSize.width))
        : maxOf(blockerRects.map((blocker) => blocker.x + blocker.w + LABEL_PAD));
    const boundedByLane =
      side === 'low'
        ? Math.max(lane.x, nextX)
        : Math.min(lane.x + lane.w - textSize.width, nextX);
    if (!Number.isFinite(boundedByLane) || (side === 'low' ? boundedByLane >= rect.x : boundedByLane <= rect.x)) break;
    const nextRect = rectAt(boundedByLane);
    if (!contained(nextRect)) break;
    rect = nextRect;
  }

  return candidates;
}

function layoutFootballField(
  data: ChartData,
  options: FootballFieldBarOptions,
): Geometry<BarMarks, BarDerived> {
  return layoutRowIntervals(data, options, 'football-field');
}

function layoutTornado(
  data: ChartData,
  options: TornadoBarOptions,
): Geometry<BarMarks, BarDerived> {
  return layoutRowIntervals(data, options, 'tornado');
}

/**
 * The values a range row draws: a range cell's low and high, its mid only
 * where the method note draws it, a plain cell's number, and the spine value.
 * A range cell's own number is not drawn, so it sets no scale: a 96 billion
 * cell number does not put 38-52 ranges on a B scale.
 */
function rowIntervalValues(data: ChartData, options: BarOptions): (number | null | undefined)[] {
  const cats = (data?.categories ?? []).map((category, index) => normalizeCategory(category as never, index));
  const spine = options.variant === 'tornado' ? options.baseValue : options.currentValue;
  return [
    ...(data?.series ?? []).filter((series) => series.role !== 'reference').flatMap((series, index) =>
      normalizeSeriesValues(series, cats, index).flatMap((cell) => {
        const range = typeof cell === 'object' && cell !== null && 'range' in cell
          ? (cell as { range?: { low?: number; high?: number; mid?: number } }).range
          : undefined;
        return range ? [range.low, range.high, ...(options.methodNote === true ? [range.mid] : [])] : [cellValue(cell)];
      }),
    ),
    typeof spine === 'number' ? spine : spine?.value,
  ];
}

/** Compact rows: the air above a name line, and between a name line and its bar. */
const COMPACT_ROW_GAP = 8;
/**
 * A tornado (40 px pitch, 16 px bars) prints its values beside the bars, never
 * in them, so its compact bar is the value's line box without the inner air,
 * and its rows keep 6 px of air over each name line.
 */
const TORNADO_ROW_GAP = 6;
const COMPACT_NAME_GAP = 3;
const COMPACT_RANGE_SUFFIX = ':range';

/**
 * One compact row name. On one line: the name, and after it, in the muted ink,
 * what follows the name's authored line break (a tornado driver's input
 * range). Wrapped: the fitted lines, the first one bold for a tornado driver
 * named over its range.
 */
interface CompactName {
  head: string;
  /** Printed after the head on the same line, muted. */
  tail?: string;
  /** The wrapped form, when one line does not hold the name. */
  fitted?: ReturnType<typeof rowLabelBand>['labels'][number];
  headBold: boolean;
}

function compactRowNames(
  cats: readonly RowCat[], mode: RowIntervalMode, font: FontSpec, boldFont: FontSpec, width: number, lineH: number,
  measure: TextMeasurer, options: BarOptions, warnings: LintWarning[],
): { names: CompactName[]; nameBlock: number } {
  const fit = { target: options.target, textScale: textScaleOf(options), typeRole: 'axis' as const };
  const rowsOf = (join: boolean) => cats.map((cat) => ({ id: cat.id, label: join ? (cat.label ?? cat.id).split('\n').join(' ') : cat.label ?? cat.id, footnote: cat.footnote }));
  const joined = rowLabelBand(rowsOf(true), font, width, CAT_MAX_LINES, lineH, measure, { ...fit, footnoteRefs: { count: authoredFootnoteCount(options), warnings } });
  let wrapped: ReturnType<typeof rowLabelBand> | undefined;
  const names = cats.map((cat, i): CompactName => {
    const parts = (cat.label ?? cat.id).split('\n');
    // As in the name column: a tornado driver's first line is its name, in the emphasis weight.
    const headBold = mode === 'tornado' && parts.length > 1;
    const line = joined.labels[i]!;
    if (line.lines.length === 1 && line.title === undefined && line.font === font) {
      const text = line.lines[0]!;
      if (!headBold) return { head: text, headBold };
      const head = parts[0]!;
      const tail = text.slice(head.length + 1);
      if (measure(head, boldFont).width + measure(' ', font).width + measure(tail, font).width <= width) return { head, tail, headBold };
    }
    // Too long for one line: the lines as the name column breaks them, at the full width.
    wrapped ??= rowLabelBand(rowsOf(false), font, width, CAT_MAX_LINES, lineH, measure, { ...fit, footnoteRefs: { count: authoredFootnoteCount(options), warnings: [] } });
    const fitted = headBold ? wrapped.labels[i]! : line;
    return { head: fitted.lines[0] ?? '', fitted, headBold };
  });
  return { names, nameBlock: maxOf(names.map((name) => name.fitted?.h ?? lineH)) };
}

/** The row band of compact rows: each step holds a name line, then its bar, both at the foot of the step. */
function compactBand(count: number, plot: Rect, nameBlock: number, barNatural: number, rowGap: number): BandScale {
  const step = plot.h / Math.max(1, count);
  const bandwidth = Math.max(4, Math.min(barNatural, step - rowGap - nameBlock - COMPACT_NAME_GAP));
  const position = (index: number) => plot.y + (index + 1) * step - bandwidth;
  return { position, center: (index) => position(index) + bandwidth / 2, bandwidth, step, count, range: [plot.y, plot.y + plot.h] };
}

/** The right edge of a compact name's first line. */
function compactNameRight(name: CompactName, x: number, font: FontSpec, boldWeight: number, measure: TextMeasurer): number {
  if (name.fitted) return x + name.fitted.w;
  const head = measure(name.head, name.headBold ? { ...font, weight: boldWeight } : font).width;
  return x + head + (name.tail === undefined ? 0 : measure(' ', font).width + measure(name.tail, font).width);
}

/** The label requests of a compact row name, its last line ending `bottom` px down. */
function compactNameRequests(name: CompactName, cat: RowCat, x: number, bottom: number, lineH: number, font: FontSpec, boldWeight: number, measure: TextMeasurer): LabelRequest[] {
  const owner = { categoryId: cat.id };
  const base = { kind: 'category' as const, owner, typeRole: 'axis' as const, font, priority: PRIORITY.endpoint };
  // The name may cross a value line drawn through the rows; it stands on a halo there.
  const seat = (w: number, h: number, at = x) => [{ slot: 'above' as const, rect: { x: at, y: bottom - h, w, h }, penalty: 0, needsBacking: true }];
  if (name.fitted) {
    return [{
      ...base, id: `category:${cat.id}`, text: cat.label ?? cat.id, ...fittedLabel(name.fitted, font),
      ...(name.headBold && name.fitted.lines.length > 1 ? { headLines: 1, headWeight: boldWeight, bodyInk: { token: 'inkMuted' as const } } : {}),
      candidates: seat(name.fitted.w, name.fitted.h),
    }];
  }
  const headW = measure(name.head, name.headBold ? { ...font, weight: boldWeight } : font).width;
  const requests: LabelRequest[] = [{
    ...base, id: `category:${cat.id}`, text: name.tail === undefined ? cat.label ?? cat.id : name.head, lines: [name.head],
    ...(name.headBold ? { runs: [{ text: name.head, weight: boldWeight }] } : {}),
    candidates: seat(headW, lineH),
  }];
  if (name.tail !== undefined) {
    requests.push({
      ...base, id: `category:${cat.id}${COMPACT_RANGE_SUFFIX}`, text: name.tail, lines: [name.tail],
      candidates: seat(measure(name.tail, font).width, lineH, x + headW + measure(' ', font).width),
    });
  }
  return requests;
}

function layoutRowIntervals(
  data: ChartData,
  options: BarOptions,
  mode: RowIntervalMode,
): Geometry<BarMarks, BarDerived> {
  const warnings: LintWarning[] = [];
  const theme = chartTheme(options);
  const size = resolveSize(options.size);
  const paletteRamp = chartPalette(theme, options.palette, warnings);
  const measure = options.measure ?? defaultMeasurer;
  // Exhibit-wide format raster: tornado and football-field are
  // bar variants and share the family rule: style from the example, one
  // precision from the plotted values, range bounds included.
  const valueSpec = seriesRasterFormatter(options.format, rowIntervalValues(data, options), options.locale?.language, options.unit, options.target);
  const fmt = valueSpec.fmt;
  const labelOn = (kind: LabelKind): boolean =>
    barLabelOn(options, kind, ['category', 'valueLine']);
  const highlights = new Set(resolveHighlight(options.highlight));
  const ctx: RowPlanCtx = { warnings, theme, paletteRamp, fmt, forSeries: valueSpec.forSeries, labelOn, highlights };

  const plan =
    mode === 'football-field'
      ? planFootballField(data, options as FootballFieldBarOptions, ctx)
      : planTornado(data, options as TornadoBarOptions, ctx);
  const cats = plan.cats;
  const rows = plan.rows;
  const spine = plan.spine;
  // The plan's texts (and their measured widths) may come from a
  // per-series formatter; the labels drawn from the same endpoints must print
  // the identical string.
  const rowFmt = plan.valueFmt ?? fmt;

  let rawLo = Math.min(
    minOf(rows.flatMap((row) => row.pieces.flatMap((piece) => [piece.from, piece.to]))),
    spine?.value ?? Infinity,
  );
  let rawHi = Math.max(
    maxOf(rows.flatMap((row) => row.pieces.flatMap((piece) => [piece.from, piece.to]))),
    spine?.value ?? -Infinity,
  );
  [rawLo, rawHi] = applyAxisBounds([rawLo, rawHi], [rawLo, rawHi], options.valueAxis, warnings);
  if (rawLo === rawHi) {
    const pad = Math.max(1, Math.abs(rawLo) * 0.1);
    rawLo -= pad;
    rawHi += pad;
  }

  const tickFont: FontSpec = { family: theme.type.family, ...theme.type.axis };
  const labelFont: FontSpec = { family: theme.type.family, ...theme.type.label };
  const strongFont: FontSpec = { family: theme.type.family, ...theme.type.label, weight: emphasisWeight(theme) };
  const maxLowWidth = maxOf(rows.map((row) => measure(row.leftText, labelFont).width));
  const maxHighWidth = maxOf(rows.map((row) => measure(row.rightText, labelFont).width));

  const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const frameResult = solveFrame(
    {
      size,
      margin: { ...canvasMargin(theme, size.width), ...options.margin },
      ...frameTextOptions(options),
      // Engine-owned method notes come AFTER the author's, and the author
      // cannot delete them — the basis on which a mark is drawn is not an
      // authoring choice. (likert/layout.ts:766, pyramid/layout.ts:296.)
      footnotes: [...authoredNotes(options), ...(plan.methodNotes ?? [])],
      ...(plan.legend ? { legend: plan.legend } : {}),
      theme,
      measure,
    },
    occupied,
  );
  const plot0 = frameResult.plot;
  // Compact rows already carry COMPACT_ROW_GAP of air over the first name, so
  // the spine label takes that air instead of its own (reference label to the
  // first row 12.5 px).
  const spineLabelPad = spine && labelOn('valueLine') ? 26 : 8;
  let currentPad = spineLabelPad;
  // In the small width class each name stands on its own line above its bar, so the bars
  // take the full width instead of what a name column leaves them. An
  // authored row layout (name alignment, bar share, a theme's fixed row) keeps
  // the column. A caller that draws the names itself (NO_NAME_COLUMN) gets the
  // column-free plot without them.
  const callerNames = (options as { [NO_NAME_COLUMN]?: boolean })[NO_NAME_COLUMN] === true;
  // A tornado driver named over its input range: the name bold in ink, the range in the muted ink under it.
  const tornadoHead = (cat: RowCat, label: { lines: readonly string[] }) => mode === 'tornado' && label.lines.length > 1 && (cat.label ?? '').includes('\n');
  const compactWidth = !callerNames && labelOn('category') &&
    (panelTypeClass(options) ?? typeWidthClass(size.width)) === 'S' &&
    options.rowLabels === undefined && options.bandFraction === undefined && !theme.space.barRow;
  const nameLineH = tickFont.size * 1.2;
  const compactPlan = compactWidth
    ? compactRowNames(cats, mode, tickFont, { ...tickFont, weight: emphasisWeight(theme) }, plot0.w, nameLineH, measure, options, warnings)
    : undefined;
  const compactRowGap = mode === 'tornado' ? TORNADO_ROW_GAP : COMPACT_ROW_GAP;
  const spineLift = compactPlan && spine && labelOn('valueLine') ? compactRowGap : 0;
  currentPad = spineLabelPad - spineLift;
  // The bar holds its value label's line box with a pixel of air on each side.
  const compactBar = Math.ceil(measure('0', labelFont).height) + (mode === 'tornado' ? 0 : 2);
  // The thinnest compact bar still holds a value inside it (a football field's low end right of the line).
  const compactMinBar = Math.min(compactBar, Math.ceil(labelFont.size));
  const compactStep = (bar: number) => compactRowGap + (compactPlan?.nameBlock ?? 0) + COMPACT_NAME_GAP + bar;
  // A tornado prints the value at both ends of every bar, so its tick row
  // repeats them and is off unless asked for.
  const axisShown = options.valueAxis?.show ?? mode !== 'tornado';
  // the value-axis title in or under the tick row, as on a standard
  // bar, with the chart unit or else the one unit its data series share.
  const axisTitle = axisShown && labelOn('axisTitle')
    ? planValueAxisTitle(valueAxisTitleText(theme, options.axisTitles?.primary, options,
      valueAxisUnit(options.unit, (data.series ?? []).filter((series) => series.role !== 'reference'), false)), theme, measure, plot0.w)
    : undefined;
  const tickRowH = measure('0', tickFont).height;
  // The title takes the tick row where it fits there (tickRowTitleEnd) and its
  // own row under the ticks only when it does not; the row changes the plot's height.
  const targetSizing = !(options as { [HARD_MINIMUM]?: boolean })[HARD_MINIMUM];
  const rowsFor = (titleRow: boolean, rowWarnings: LintWarning[], noNameColumn: boolean) => {
    const axisH = axisShown ? tickRowH + 8 + (axisTitle && titleRow ? axisTitle.height + 2 : 0) : 0;
    const availH = plotHeightAfter(frameResult, size.height, plot0.h - currentPad - axisH);
    const lineH = tickFont.size * 1.2;
    const catCap = Math.max(24, plot0.w * 0.28);
    // A fixed bar row sizes the names to its pitch, not to the canvas.
    const stepEst = theme.space.barRow?.pitch ?? availH / cats.length;
    const fittedCats = rowLabelBand(
      cats.map((cat) => ({ id: cat.id, label: cat.label ?? cat.id, footnote: cat.footnote })), tickFont, catCap, stepEst >= Math.max(30, 2 * lineH + (targetSizing ? 4 : 0)) ? 2 : 1, lineH, measure,
      { target: options.target, textScale: textScaleOf(options), typeRole: 'axis', wider: gutterBudget(24, plot0.w), tightLines: Math.floor((stepEst - (targetSizing ? 4 : 0)) / lineH), shrink: stepDownFont(theme, tickFont, 'axis', options.target, textScaleOf(options)), footnoteRefs: { count: authoredFootnoteCount(options), warnings: rowWarnings } },
    );
    // A tornado driver's name prints bold over its range (tornadoHead): its seat and the band take the bold width.
    const catLines = fittedCats.labels.map((label, ci) => tornadoHead(cats[ci]!, label)
      ? { ...label, w: Math.max(label.w, measure(label.lines[0]!, { ...label.font, weight: emphasisWeight(theme) }).width) } : label);
    const catBandW = Math.max(fittedCats.width, maxOf(catLines.map((label) => label.w)));
    const fixedRow = fixedBarRow(theme, catLines.map((label) => label.h));
    const fixedRowsH = fixedRow ? fixedRow.step * cats.length : undefined;
    const nameW = noNameColumn ? 0 : catBandW + CAT_BAND_GAP;
    const valueBody: Rect = {
      x: plot0.x + nameW,
      y: plot0.y + currentPad,
      w: Math.max(10, plot0.w - nameW),
      // Fixed rows never stretch; a shorter canvas (a grid panel) packs them.
      h: fixedRowsH === undefined ? availH : Math.min(availH, fixedRowsH),
    };
    const leftReserve = maxLowWidth + LABEL_GAP + 8;
    const rightReserve = maxHighWidth + LABEL_GAP + 8;
    const plot: Rect = {
      x: valueBody.x + leftReserve,
      y: valueBody.y,
      w: Math.max(10, valueBody.w - leftReserve - rightReserve),
      h: valueBody.h,
    };
    const x = linearScale([dLo, dHi], [plot.x, plot.x + plot.w]);
    const titleEnd = axisTitle && !titleRow
      ? tickRowTitleEnd(axisTitle, { scale: x, plot, orient: 'x', gridlines: false, format: fmt, formatSpec: valueSpec.spec, theme, measure, canvasWidth: size.width }, plot0.x)
      : undefined;
    const minWidth = size.width - plot0.w + nameW + leftReserve + rightReserve + 10;
    return { availH, minWidth, catCap, catLines, catBandW, fixedRow, fixedRowsH, valueBody, plot, x, titleEnd, titleRow };
  };
  // With no tick row nothing reads the round ends, so the bars span the plot.
  // A football field reads its ranges against the current value, not against
  // zero or a round end, so its ticks stand inside the data extent too.
  const [dLo, dHi] = !axisShown || mode === 'football-field' ? [rawLo, rawHi] : niceDomain(rawLo, rawHi, 5, {
    dataExtent: [rawLo, rawHi],
    maxWasteFraction: 0.15,
    preserveDataSideOfZero: true,
  });
  const planRows = (noNameColumn: boolean, out: LintWarning[]) => {
    const sharedWarnings: LintWarning[] = [];
    const first = rowsFor(false, sharedWarnings, noNameColumn);
    if (axisShown && axisTitle && first.titleEnd === undefined) return rowsFor(true, out, noNameColumn);
    pushAll(out, sharedWarnings);
    return first;
  };
  let rowPlan = planRows(callerNames || compactPlan !== undefined, warnings);
  // A canvas too short for a name line over every bar keeps the name column;
  // its natural height is still the compact one, so a content-fit chart gets it.
  const compact = compactPlan && rowPlan.availH >= cats.length * compactStep(compactBar) ? compactPlan : undefined;
  if (compactPlan && !compact) {
    currentPad = spineLabelPad;
    rowPlan = planRows(false, []);
  }
  /** Compact rows: the spine label stands in the first row's top air, its line starts under it. */
  const labelDrop = compact ? spineLift : 0;
  const spineTop = plot0.y + currentPad + (labelDrop > 0 ? labelDrop - 2 : 0);
  const { catCap, catLines, catBandW, fixedRow, fixedRowsH, valueBody, plot, x } = rowPlan;
  const bandFraction = options.bandFraction ?? fixedRow?.fraction ?? 0.56;
  const band = compact
    ? compactBand(cats.length, plot, compact.nameBlock, compactBar, compactRowGap)
    : bandScale(cats.length, [plot.y, plot.y + plot.h], {
      paddingInner: 1 - bandFraction,
      paddingOuter: (1 - bandFraction) / 2,
    });

  const nodes: SceneNode[] = [...frameResult.nodes];
  const axes: Geometry['axes'] = [];
  if (axisShown) {
    const axis = layoutValueAxis(
      {
        scale: x,
        plot,
        orient: 'x',
        gridlines: options.valueAxis?.gridlines ?? false,
        format: fmt,
        formatSpec: valueSpec.spec,
        theme,
        measure,
        canvasWidth: size.width,
      },
      occupied,
    );
    nodes.push(...axis.nodes);
    axes.push(axis.axis);
  }
  const marks: BarMarks = { rows: [], referenceTicks: [], rowTints: [] };
  const labelRequests: LabelRequest[] = axisShown && axisTitle
    ? [valueAxisTitleRequest(axisTitle, { x: rowPlan.titleEnd ?? plot.x + plot.w, y: plot.y + plot.h + 6 + (rowPlan.titleRow ? tickRowH + 2 : 0) }, 'end', 'axis:x:title')]
    : [];
  const currentX = spine ? x(spine.value) : undefined;
  const canvas: Rect = { x: 0, y: 0, w: size.width, h: size.height };
  const currentRuleClaim =
    mode === 'football-field' && currentX !== undefined && rectContains(canvas, plot, 0)
      ? { x: currentX - SPINE_CLAIM_HALF_WIDTH, y: plot.y, w: SPINE_CLAIM_HALF_WIDTH * 2, h: plot.h }
      : undefined;

  rows.forEach((row, ri) => {
    const cat = row.cat;
    const rowY = band.position(ri);
    const rowCenter = band.center(ri);
    const gapHalf = (band.step - band.bandwidth) / 2;
    // A compact row's values stand beside its bar, under the name line.
    const laneH = Math.max(band.bandwidth, measure('0', labelFont).height) + 6;
    const rowLane: Rect = compact
      ? { x: valueBody.x, y: rowCenter - laneH / 2, w: valueBody.w, h: laneH }
      : {
        x: valueBody.x,
        y: Math.max(valueBody.y, band.position(ri) - gapHalf),
        w: valueBody.w,
        h: Math.min(band.step, valueBody.y + valueBody.h - (band.position(ri) - gapHalf)),
      };
    let rowRect: Rect | undefined;
    const bars: { seriesId: Id; rect: Rect; nodeId: Id }[] = [];
    for (const piece of row.pieces) {
      const xFrom = x(piece.from);
      const xTo = x(piece.to);
      const rect: Rect = {
        x: Math.min(xFrom, xTo),
        y: rowY,
        // Floor: a zero-width interval is a FINDING (no sensitivity, or a
        // point estimate), and it has to stay visible as a hairline.
        w: Math.max(Math.abs(xTo - xFrom), 0.5),
        h: band.bandwidth,
      };
      const owner: OwnerRef = { seriesId: piece.seriesId, categoryId: cat.id };
      // A plain range or tornado piece carries a separation rule, so a pale piece whose
      // values print nowhere takes its 3:1 edge (fillEdges).
      const plain = !piece.paint.pattern && !piece.paint.stroke;
      const edge = plain ? separationStroke(paintColor(theme, piece.paint.fill), theme.color.background, theme) : undefined;
      nodes.push({
        t: 'rect',
        id: piece.nodeId,
        rect,
        fill: piece.paint.fill,
        ...(piece.paint.pattern ? { pattern: piece.paint.pattern } : {}),
        ...(piece.paint.stroke
          ? { stroke: piece.paint.stroke, strokeWidth: piece.paint.strokeWidth }
          : {}),
        ...(edge ?? {}),
        ...(plain ? { separation: { fill: piece.paint.fill, backing: { token: 'background' as const } } } : {}),
        owner,
        part: piece.part,
        ...(piece.display === undefined ? {} : { display: { value: piece.display } }),
      });
      occupied.claim(rect, 'mark', owner, 'bar');
      bars.push({ seriesId: piece.seriesId, rect, nodeId: piece.nodeId });
      rowRect = rowRect === undefined ? rect : unionRect(rowRect, rect);
    }
    if (row.mid) {
      const midX = x(row.mid.value);
      nodes.push({
        t: 'line',
        id: row.mid.id,
        x1: midX,
        y1: rowY - 2,
        x2: midX,
        y2: rowY + band.bandwidth + 2,
        stroke: { token: 'markInk' },
        width: strokeToken(theme, 'mark'),
        owner: row.mid.owner,
        part: 'rangeMid',
        display: { value: rowFmt(row.mid.value) },
      });
      occupied.claim(
        { x: midX - 1, y: rowY - 2, w: 2, h: band.bandwidth + 4 },
        'mark',
        { seriesId: row.mid.claimSeriesId, categoryId: cat.id },
        'range',
      );
    }
    marks.rows.push({ id: cat.id, rect: rowRect!, bars });

    if (labelOn('point')) {
      for (const endpoint of row.endpoints) {
        const text = rowFmt(endpoint.value);
        const textSize = measure(text, labelFont);
        const at = x(endpoint.value);
        const outsideCandidate: SlotCandidate =
          endpoint.side === 'low'
            ? {
                slot: 'outsideLow',
                rect: {
                  x: at - LABEL_GAP - textSize.width,
                  y: rowCenter - textSize.height / 2,
                  w: textSize.width,
                  h: textSize.height,
                },
                penalty: 0,
              }
            : {
                slot: 'outsideHigh',
                rect: {
                  x: at + LABEL_GAP,
                  y: rowCenter - textSize.height / 2,
                  w: textSize.width,
                  h: textSize.height,
                },
                penalty: 0,
              };
        // A low end right of the current-value line prints inside its range,
        // so the gap to the line stays clear.
        const piece = mode === 'football-field' && endpoint.side === 'low' && currentRuleClaim
          ? row.pieces.find((p) => Math.abs(x(Math.min(p.from, p.to)) - at) < 0.5) : undefined;
        const pieceW = piece ? Math.abs(x(piece.to) - x(piece.from)) : 0;
        const insideLow: SlotCandidate | undefined = piece && currentRuleClaim &&
          at >= currentRuleClaim.x + currentRuleClaim.w &&
          pieceW >= textSize.width + 2 * LABEL_GAP && band.bandwidth >= labelFont.size
          ? {
              slot: 'insideLow',
              rect: { x: at + LABEL_GAP, y: rowCenter - textSize.height / 2, w: textSize.width, h: textSize.height },
              penalty: 0,
              insideFill: paintColor(theme, piece.paint.fill),
              insidePaint: piece.paint.fill,
            }
          : undefined;
        const candidates: SlotCandidate[] = insideLow ? [insideLow] :
          mode === 'football-field'
            ? outsideLaneCandidates(
                endpoint.side,
                at,
                textSize,
                rowCenter,
                occupied,
                currentRuleClaim,
                canvas,
                valueBody,
                rowLane,
              )
            : endpoint.side === 'low'
              ? [
                  outsideCandidate,
                  {
                    slot: 'aboveLow',
                    rect: {
                      x: at - textSize.width / 2,
                      y: rowY - textSize.height - 3,
                      w: textSize.width,
                      h: textSize.height,
                    },
                    penalty: 1,
                  },
                  {
                    slot: 'belowLow',
                    rect: {
                      x: at - textSize.width / 2,
                      y: rowY + band.bandwidth + 3,
                      w: textSize.width,
                      h: textSize.height,
                    },
                    penalty: 2,
                  },
                ]
              : [
                  outsideCandidate,
                  {
                    slot: 'aboveHigh',
                    rect: {
                      x: at - textSize.width / 2,
                      y: rowY - textSize.height - 3,
                      w: textSize.width,
                      h: textSize.height,
                    },
                    penalty: 1,
                  },
                  {
                    slot: 'belowHigh',
                    rect: {
                      x: at - textSize.width / 2,
                      y: rowY + band.bandwidth + 3,
                      w: textSize.width,
                      h: textSize.height,
                    },
                    penalty: 2,
                  },
                ];
        labelRequests.push({
          id: endpoint.id,
          kind: 'point',
          owner: endpoint.owner,
          text,
          lines: [text],
          typeRole: 'label', font: labelFont,
          priority: PRIORITY.endpoint,
          candidates,
        });
      }
    }

    if (compact) {
      pushAll(labelRequests, compactNameRequests(compact.names[ri]!, cat, plot0.x, band.position(ri) - COMPACT_NAME_GAP, nameLineH, tickFont, emphasisWeight(theme), measure));
    } else if (labelOn('category') && !callerNames) {
      const category = catLines[ri]!;
      labelRequests.push({
        id: `category:${cat.id}`,
        kind: 'category',
        owner: { categoryId: cat.id },
        text: cat.label ?? cat.id,
        ...fittedLabel(category, tickFont),
        ...(tornadoHead(cat, category)
          ? { headLines: 1, headWeight: emphasisWeight(theme), bodyInk: { token: 'inkMuted' as const } } : {}),
        typeRole: 'axis', font: tickFont,
        priority: PRIORITY.endpoint,
        candidates: [
          {
            slot: 'left',
            rect: {
              x: rowLabelX(plot0.x, catBandW, category.w, options.rowLabels?.align ?? 'left'),
              y: rowCenter - category.h / 2,
              w: category.w,
              h: category.h,
            },
            penalty: 0,
          },
        ],
      });
    }
  });
  if (plan.ranges) marks.ranges = plan.ranges;

  const annotations: PlacedAnnotation[] = [];
  if (spine) {
    const currentX = x(spine.value);
    const lineId = `ann:${spine.key}:line`;
    // Compact rows: the line claims only its runs beside the bars, so a name
    // line above a bar may cross it on a halo. A tornado's spine is drawn in
    // those runs only; the first run reaches up to the
    // spine label when the first name stays clear of it.
    const spineRuns = compact
      ? rows.map((_, ri) => ({ y1: band.position(ri), y2: band.position(ri) + band.bandwidth }))
      : [{ y1: plot.y, y2: plot.y + plot.h }];
    if (compact && spineRuns.length > 0) {
      const firstName = compactNameRight(compact.names[0]!, plot0.x, tickFont, emphasisWeight(theme), measure);
      if (mode === 'tornado' && firstName + 4 < currentX) spineRuns[0]!.y1 = spineTop;
    }
    const drawnRuns = !compact ? spineRuns : mode === 'football-field'
      ? [{ y1: spineTop, y2: plot.y + plot.h }]
      : spineRuns.map((run) => ({ y1: run.y1 === spineTop ? run.y1 : run.y1 - 3, y2: run.y2 + 3 }));
    const lineIds = drawnRuns.map((_, k) => (k === 0 ? lineId : `${lineId}:${k}`));
    drawnRuns.forEach((run, k) => nodes.push({
      t: 'line',
      id: lineIds[k]!,
      x1: currentX,
      y1: run.y1,
      x2: currentX,
      y2: run.y2,
      stroke: { token: 'ink' },
      width: strokeToken(theme, 'rule'),
      dash: dashToken(theme, 'reference'),
      owner: { annotationId: spine.key },
      part: `${spine.key}Line`,
    }));
    for (const run of spineRuns) {
      occupied.claim(
        { x: currentX - 0.5, y: run.y1, w: 1, h: run.y2 - run.y1 },
        'annotation',
        { annotationId: spine.key },
        spine.key,
      );
    }
    const labelId = `valueLine:${spine.key}`;
    const labelText = spine.text;
    if (labelOn('valueLine')) {
      const labelSize = measure(labelText, strongFont);
      labelRequests.push({
        id: labelId,
        kind: 'valueLine',
        role: composedTextRole(labelText),
        owner: { annotationId: spine.key },
        text: labelText,
        lines: [labelText],
        typeRole: 'label', font: strongFont,
        priority: PRIORITY.valueLine,
        candidates: [
          {
            slot: 'aboveLine',
            rect: {
              x: currentX - labelSize.width / 2,
              y: plot.y - labelSize.height - 6 + labelDrop,
              w: labelSize.width,
              h: labelSize.height,
            },
            penalty: 0,
            needsBacking: mode === 'football-field',
          },
          {
            slot: 'aboveLineLeft',
            rect: {
              x: currentX - labelSize.width - 4,
              y: plot.y - labelSize.height - 6 + labelDrop,
              w: labelSize.width,
              h: labelSize.height,
            },
            penalty: 1,
            needsBacking: mode === 'football-field',
          },
          {
            slot: 'aboveLineRight',
            rect: {
              x: currentX + 4,
              y: plot.y - labelSize.height - 6 + labelDrop,
              w: labelSize.width,
              h: labelSize.height,
            },
            penalty: 2,
            needsBacking: mode === 'football-field',
          },
        ],
      });
    }
    annotations.push({
      id: spine.key,
      kind: 'valueLine',
      // The ENGINE's answer, never the author's. When the author supplied a
      // label these differ, `annotationClaims` sees it and records
      // state:'authored-override' with the engine's own string in `inputs`.
      computedText: labelOn('valueLine') ? spine.computedText : '',
      nodeIds: lineIds,
      ...(labelOn('valueLine') ? { labelId } : {}),
    });
    marks[spine.key] = {
      value: spine.value,
      nodeId: lineId,
      ...(labelOn('valueLine') ? { labelId } : {}),
    };
  }

  const solveCtx: SolveCtx = labelCtx(theme, size, options, {
    measure,
    plot,
    labelPad: LABEL_PAD,
  });
  const solved = solveLabels(labelRequests, occupied, solveCtx);
  applyValueAxisTitleInk(solved.placed);
  // A compact tornado name prints its input range in the muted ink after it.
  for (const label of solved.placed) if (label.id.endsWith(COMPACT_RANGE_SUFFIX)) label.ink = { token: 'inkMuted' };
  pushAll(warnings, solved.warnings);
  pushAll(
    nodes,
    labelsToNodes(theme, solved.placed, (label) =>
      label.kind === 'category'
        ? tickFont
        : label.kind === 'valueLine'
          ? strongFont
          : labelFont, nodes,
    ),
  );
  // A compact row is its name line, the gaps and the bar; it is no shorter
  // than that with a bar of one value line (barSizing adds 4 px on a target).
  const compactRowH = (bar: number) => cats.map(() => ({ h: compactStep(bar) - (targetSizing ? 4 : 0) }));
  const compactSizing = compactPlan && barSizing(size, rowPlan, band.step, compactRowH(compactMinBar), compactRowH(compactBar), undefined, 0, targetSizing, textScaleOf(options));
  // A football field's name-column
  // rows stand 38 px apart at 960 px and 36 px narrower (bars 22 and 20 px), not
  // at the 28 px row floor. Only the natural height takes it; the minimum stays.
  const fieldStep = mode === 'football-field' && targetSizing && !fixedRowsH ? (size.width >= 960 ? 38 : 36) * textScaleOf(options) : 0;
  const columnSizing = compact ? undefined : barSizing(size, rowPlan, band.step, catLines,
    naturalCategoryHeights(cats, tickFont, catCap, measure), fixedRowsH, fieldStep, targetSizing, textScaleOf(options), 0);
  // Below the compact minimum the chart falls back to the name column, so that
  // column's minimum is the chart's minimum: a host that asks for less is refused, not served.
  const fallbackPlan = compact ? planRows(false, []) : undefined;
  const fallbackFraction = options.bandFraction ?? fallbackPlan?.fixedRow?.fraction ?? 0.56;
  const fallbackSizing = fallbackPlan && barSizing(size, fallbackPlan,
    bandScale(cats.length, [fallbackPlan.plot.y, fallbackPlan.plot.y + fallbackPlan.plot.h], { paddingInner: 1 - fallbackFraction, paddingOuter: (1 - fallbackFraction) / 2 }).step,
    fallbackPlan.catLines, naturalCategoryHeights(cats, tickFont, fallbackPlan.catCap, measure), fallbackPlan.fixedRowsH, 0, targetSizing, textScaleOf(options));
  const compactOrFallback = compactSizing && fallbackSizing && fallbackSizing.minHeight < compactSizing.minHeight
    ? { ...compactSizing, minHeight: fallbackSizing.minHeight, measuredMinHeight: Math.min(compactSizing.measuredMinHeight, fallbackSizing.measuredMinHeight), comfortableHeight: fallbackSizing.comfortableHeight }
    : compactSizing;

  return {
    type: 'bar',
    size,
    sizing: columnSizing === undefined ? compactOrFallback! : compactSizing ? { ...columnSizing, naturalHeight: Math.max(columnSizing.minHeight, compactSizing.naturalHeight) } : columnSizing,
    plot,
    scene: withSegmentSeams(nodes, theme),
    labels: solved.placed,
    axes: [
      {
        axis: 'y',
        ticks: cats.map((cat, index) => ({
          at: cat.id,
          pos: band.center(index),
          labelId: labelOn('category') ? `category:${cat.id}` : undefined,
        })),
      },
      ...axes,
    ],
    annotations,
    frame: frameResult.frame,
    // The row-interval engine (tornado, football-field) keeps the legend that
    // solveFrame returns for `plan.legend`, so `geometry.legend` lists the
    // swatches the scene paints, the hatch key included. Consumers that index
    // the legend through the geometry rather than by scanning the scene
    // (grid's panel-legend collection, the a11y and parity sweeps) read it
    // there. Twin of the main bar path at the top of this file.
    legend: frameResult.legend,
    marks,
    derived: plan.derived,
    a11y: {
      title: accessibleTitle(options.title, plan.a11yTitle),
      titleCounts: plan.a11yTitleCounts,
      desc: plan.a11yDesc,
    },
    warnings,
    debug: {
      occupied: occupied.snapshot(),
      decisions: solved.decisions,
    },
  };
}

function planFootballField(
  data: ChartData,
  options: FootballFieldBarOptions,
  ctx: RowPlanCtx,
): RowIntervalPlan {
  const { warnings, labelOn, highlights } = ctx;
  if (!data || !Array.isArray(data.categories) || data.categories.length === 0) {
    throw new NormalizeError('empty-data', 'categories', 'football-field requires at least one method');
  }
  if (!Array.isArray(data.series) || data.series.length === 0) {
    throw new NormalizeError('empty-data', 'series', 'football-field requires one data series');
  }
  let cats = data.categories.map((category, index) => normalizeCategory(category as never, index));
  const sourceSeries = data.series.filter((series) => (series.role ?? 'data') === 'data');
  if (sourceSeries.length !== 1) {
    throw new NormalizeError(
      'football-field-one-series',
      'series',
      `football-field requires exactly one data-role series, got ${sourceSeries.length}`,
    );
  }
  if (data.series.length !== sourceSeries.length) {
    warnings.push({
      code: 'football-field-reference-ignored',
      severity: 'warn',
      message: 'football-field ignores reference-role series; use currentValue for the vertical comparator',
      suggest: 'remove reference series and set currentValue',
    });
  }
  if (options.annotations && options.annotations.length > 0) {
    warnings.push({
      code: 'football-field-annotations-ignored',
      severity: 'warn',
      message: 'football-field does not support annotations; use currentValue for its authored marker',
    });
  }
  if (options.valueAxis?.break) {
    warnings.push({
      code: 'axis-break-unsupported',
      severity: 'warn',
      message: "bar variant 'football-field' does not support valueAxis.break; the break was ignored",
    });
  }
  if (options.legend) {
    warnings.push({
      code: 'football-field-legend-ignored',
      severity: 'warn',
      message: 'football-field directly labels its single range series; the requested legend was ignored',
      suggest: 'remove legend or use the series label in the subtitle/unit',
    });
  }
  const series = sourceSeries[0]!;
  // The range labels and their accessible values print in the SERIES'
  // own format when one is authored. Football-field plots exactly one data
  // series, so its per-series formatter IS this plan's formatter — the same
  // rule the standard bar path applies through `valueSpec.forSeries`.
  const fmt = ctx.forSeries(series);
  const missingRange: number[] = [];
  let cells = normalizeSeriesValues(series, cats, 0).map((cell, ci) => {
    const range = resolveCellRange(
      cell,
      `series[${series.id}].values[${ci}]`,
      warnings,
      { seriesId: series.id, categoryId: cats[ci]?.id },
    );
    if (!range) missingRange.push(ci);
    return { value: cellValue(cell), meta: cellMeta(cell), range: range! };
  });
  if (missingRange.length > 0) {
    // A method with no range has no bar and no text the engine could compose
    // for it, so it is refused. The fix removes every such method from every
    // series, reference series included (they share the categories), highest
    // index first so earlier indices stay valid.
    const first = missingRange[0]!;
    const seriesOps = data.series.flatMap((entry, seriesIndex) => {
      const values = Array.isArray(entry.values) ? entry.values as unknown[] : [];
      return missingRange
        .map((ci) => values.findIndex((cell, index) => (
          typeof cell === 'object' && cell !== null && 'categoryId' in cell
            ? (cell as { categoryId: unknown }).categoryId === cats[ci]!.id
            : index === ci
        )))
        .filter((index) => index >= 0)
        .sort((a, b) => b - a)
        .map((index) => ({ op: 'remove' as const, path: `/data/series/${seriesIndex}/values/${index}` }));
    });
    const categoryOps = [...missingRange].reverse()
      .map((ci) => ({ op: 'remove' as const, path: `/data/categories/${ci}` }));
    throw new NormalizeError(
      'football-field-range-required',
      `series[${series.id}].values[${first}].range`,
      `football-field method '${cats[first]!.id}' requires a range`,
      'Remove the method from data.categories and from the series values, or give it a range.',
      missingRange.length < cats.length ? [...seriesOps, ...categoryOps] : undefined,
    );
  }

  const order = cats.map((_, index) => index);
  const sort = options.sort?.categories ?? 'sheet';
  if (sort === 'reverse') order.reverse();
  else if (sort === 'asc' || sort === 'desc') {
    const direction = sort === 'asc' ? 1 : -1;
    order.sort((a, b) => {
      const ar = cells[a]!.range;
      const br = cells[b]!.range;
      const av = ar.mid ?? (ar.low + ar.high) / 2;
      const bv = br.mid ?? (br.low + br.high) / 2;
      return (av - bv) * direction || a - b;
    });
  }
  cats = order.map((index) => cats[index]!);
  cells = order.map((index) => cells[index]!);

  warnRangeBarIgnoredRanking('football-field', options, warnings);
  if (
    options.netLine !== undefined ||
    options.averageMarker !== undefined ||
    options.connectors !== undefined ||
    options.grandTotalLabels !== undefined
  ) {
    warnings.push({
      code: 'football-field-option-ignored',
      severity: 'warn',
      message: 'stack/total connector options do not apply to football-field ranges',
    });
  }

  const current =
    options.currentValue === undefined
      ? undefined
      : typeof options.currentValue === 'number'
        ? { value: options.currentValue }
        : options.currentValue;
  if (current && !labelOn('valueLine')) {
    warnings.push({
      code: 'label-hidden',
      severity: 'warn',
      message: 'currentValue label was explicitly suppressed while its authored marker remains visible',
      owner: { annotationId: 'currentValue' },
      suggest: 'enable labels.valueLine so the current-value marker is self-explanatory',
    });
  }

  // An authored cell or series paint outranks the highlight, as on the
  // standard bar path; the highlight only recolours, so FC keeps its hatch
  // and PL its outline.
  const rangePaint = (meta: CellMeta | null, highlighted: boolean): PiecePaint => {
    const scenario = meta?.scenario ?? series.scenario;
    const authored: Paint | undefined = meta?.fill
      ? { css: meta.fill }
      : series.fill
        ? { css: series.fill }
      : series.colorRole
        ? markRolePaint(series.colorRole, true)
        : highlighted ? { token: 'focus' } : undefined;
    // A range is the only data mark, so it takes a mid tone of the palette,
    // 3:1 on the page, under the ink current-value line.
    const fill: Paint = authored ?? themeSeriesPaint(1, options.palette);
    if (scenario === 'FC') return { fill, pattern: 'hatch45' };
    // The outline renderer fills with the page and strokes in `fill`, so the
    // outline colour goes there: the authored paint, else ink. A background
    // fill here drew the range white on white.
    if (scenario === 'PL') return { fill: authored ?? { token: 'ink' }, pattern: 'outline' };
    return { fill };
  };

  const ranges: RangeMark[] = [];
  const rows: PlannedRow[] = cats.map((cat, ci) => {
    const cell = cells[ci]!;
    const owner: OwnerRef = { seriesId: series.id, categoryId: cat.id };
    const nodeId = `footballRange:${series.id}:${cat.id}`;
    const paint = rangePaint(cell.meta, highlights.has(cat.id));
    const nodeIds = [nodeId];
    let mid: PlannedRow['mid'];
    // The tick is drawn only beside the note that says what it marks.
    if (cell.range.mid !== undefined && options.methodNote === true) {
      const midId = `range:${series.id}:${cat.id}:mid`;
      mid = { value: cell.range.mid, id: midId, owner, claimSeriesId: `__range:${series.id}` };
      nodeIds.push(midId);
    }
    ranges.push({
      seriesId: series.id,
      categoryId: cat.id,
      low: cell.range.low,
      high: cell.range.high,
      ...(cell.range.mid === undefined ? {} : { mid: cell.range.mid }),
      nodeIds,
    });
    return {
      cat,
      pieces: [
        {
          from: cell.range.low,
          to: cell.range.high,
          role: 'span',
          seriesId: series.id,
          nodeId,
          part: 'footballRange',
          paint,
          ...(cell.value === null ? {} : { display: fmt(cell.value) }),
        },
      ],
      endpoints: [
        { id: `rangeLow:${series.id}:${cat.id}`, owner, value: cell.range.low, side: 'low' },
        { id: `rangeHigh:${series.id}:${cat.id}`, owner, value: cell.range.high, side: 'high' },
      ],
      ...(mid ? { mid } : {}),
      leftText: fmt(cell.range.low),
      rightText: fmt(cell.range.high),
    };
  });

  const totals: Record<Id, number> = Object.fromEntries(
    // Same rule as the tornado receipt beside it: strip representation noise,
    // never quantize. round2 here is an absolute 0.005 epsilon on a metric the
    // author chose the units of — a football field of per-share values in
    // cents, or of ratios, reports a midpoint that its own low and high do not
    // reconcile to. No decision reads these: the marks are drawn from the raw
    // cells, and `mean` below feeds only the receipt (the drawn mean valueLine
    // uses the unrounded `meanValue` in the grouped path). Shipped values carry
    // at most two decimals, so this is a no-op on every current fixture and a
    // correctness fix for the ones that come.
    cats.map((cat, ci) => [
      cat.id,
      receiptValue(cells[ci]!.value ?? (cells[ci]!.range.low + cells[ci]!.range.high) / 2),
    ]),
  );
  const mean =
    cells.reduce(
      (sum, cell) => sum + (cell.value ?? cell.range.mid ?? (cell.range.low + cell.range.high) / 2),
      0,
    ) / cells.length;
  if (options.methodNote !== true && ranges.some((range) => range.mid !== undefined)) warnings.push(rangeMidUndrawn());

  return {
    cats,
    rows,
    ...(current
      ? {
          spine: {
            key: 'currentValue' as const,
            value: current.value,
            text: current.label ?? stringFields(options.strings!.currentValue!, { value: fmt(current.value) }),
            computedText: stringFields(options.strings!.currentValue!, { value: fmt(current.value) }),
          },
        }
      : {}),
    ranges,
    valueFmt: fmt,
    // A tick inside a range: a method note, printed on request.
    ...(options.methodNote === true && ranges.some((range) => range.mid !== undefined)
      ? { methodNotes: [disclosureNote(options.strings!.rangeMidNote!)] }
      : {}),
    derived: {
      totals,
      order: cats.map((cat) => cat.id),
      mean: receiptValue(mean),
    },
    a11yTitleCounts: [structureCount('methods', cats.length, undefined, options)],
    a11yTitle: chartString(options, 'footballTitle', { v1: cats.length }),
    a11yDesc:
      chartString(options, 'footballDesc', { v1: cats
        .map(
          (cat, ci) =>
            chartString(options, 'namedRange', { v1: cat.label ?? cat.id, v2: fmt(cells[ci]!.range.low), v3: fmt(cells[ci]!.range.high) }),
        )
        .join('; ') }) +
      (current ? chartString(options, 'currentValueSentence', { v1: fmt(current.value) }) : ''),
  };
}

/**
 * Sensitivity tornado. Two named CASE series (low-input case, high-input case)
 * per driver, one continuous output-metric domain, a base-case spine.
 *
 * The case identity cannot ride a `range` cell: rangeSchema enforces low<=high
 * and normalization hard-errors on an inversion, so an inverse driver (its LOW
 * input produces the HIGH output — discount rate against NPV) would be
 * re-sorted and the colour key would be a lie.
 *
 * STATISTICAL CONTRACT: this is a ONE-AT-A-TIME (OAT) sensitivity. Each row
 * varies exactly one driver with every other driver held at its base input.
 * Swings therefore do NOT sum to a total, no share of variance is defined, and
 * interaction effects are not represented anywhere in the exhibit. No
 * contribution/decomposition field is derived, and no label may imply one.
 */
function planTornado(
  data: ChartData,
  options: TornadoBarOptions,
  ctx: RowPlanCtx,
): RowIntervalPlan {
  const { warnings, paletteRamp, fmt, labelOn, highlights, theme } = ctx;
  if (!data || !Array.isArray(data.categories) || data.categories.length === 0) {
    throw new NormalizeError('empty-data', 'categories', 'tornado requires at least one driver');
  }
  if (!Array.isArray(data.series) || data.series.length === 0) {
    throw new NormalizeError('empty-data', 'series', 'tornado requires two case series');
  }
  const cats = data.categories.map((category, index) => normalizeCategory(category as never, index));
  const dataSeries = data.series.filter((series) => (series.role ?? 'data') === 'data');
  if (dataSeries.length !== 2) {
    throw new NormalizeError(
      'tornado-two-series',
      'series',
      `tornado requires exactly two data-role series (the low-input case and the high-input case), got ${dataSeries.length}`,
    );
  }
  if (data.series.length !== dataSeries.length) {
    warnings.push({
      code: 'tornado-reference-ignored',
      severity: 'warn',
      message: 'tornado ignores reference-role series; the base case is the only comparator',
      suggest: 'remove reference series and set options.baseValue',
    });
  }
  if (options.baseValue === undefined) {
    throw new NormalizeError(
      'tornado-base-required',
      'options.baseValue',
      'tornado requires options.baseValue: the output metric computed with every driver at its base input',
    );
  }
  const base =
    typeof options.baseValue === 'number' ? { value: options.baseValue } : options.baseValue;
  if (!Number.isFinite(base.value)) {
    throw new NormalizeError(
      'tornado-base-required',
      'options.baseValue',
      'tornado baseValue must be a finite number in the same units as the case series',
    );
  }
  const cases = options.tornado;
  if (!cases || cases.low === undefined || cases.high === undefined) {
    throw new NormalizeError(
      'tornado-cases-required',
      'options.tornado',
      'tornado requires options.tornado.low and options.tornado.high naming which series carries which case; case identity cannot be inferred from series order',
    );
  }
  if (cases.low === cases.high) {
    throw new NormalizeError(
      'tornado-cases-identical',
      'options.tornado',
      `tornado.low and tornado.high must name different series; both name '${cases.low}'`,
    );
  }
  const lowSeries = dataSeries.find((series) => series.id === cases.low);
  const highSeries = dataSeries.find((series) => series.id === cases.high);
  if (!lowSeries) {
    throw new NormalizeError(
      'tornado-case-unknown',
      'options.tornado.low',
      `tornado.low '${cases.low}' is not a data-role series; got ${dataSeries.map((s) => s.id).join(', ')}`,
    );
  }
  if (!highSeries) {
    throw new NormalizeError(
      'tornado-case-unknown',
      'options.tornado.high',
      `tornado.high '${cases.high}' is not a data-role series; got ${dataSeries.map((s) => s.id).join(', ')}`,
    );
  }

  if (options.annotations && options.annotations.length > 0) {
    warnings.push({
      code: 'tornado-annotations-ignored',
      severity: 'warn',
      message: 'tornado does not support annotations; the base-case spine is its authored marker',
      suggest: 'remove annotations or move the statement into the title',
    });
  }
  if (options.valueAxis?.break) {
    warnings.push({
      code: 'axis-break-unsupported',
      severity: 'warn',
      message: "bar variant 'tornado' does not support valueAxis.break; the break was ignored",
      suggest: 'remove valueAxis.break; a broken output axis would misstate every swing width',
    });
  }
  /*
   * A palette is not ignored on a tornado. A chart with no categories still has
   * an exhibit IDENTITY, and the palette is what carries it, as on a
   * single-series funnel; a tornado's low/high pair is the same object, and
   * butterfly's policy says two palette ranks preserve a comparison without
   * inventing judgment. So the palette sets the tornado's hue and the two tints
   * say "same driver, two cases".
   */
  warnRangeBarIgnoredRanking('tornado', options, warnings);
  if (
    options.netLine !== undefined ||
    options.averageMarker !== undefined ||
    options.connectors !== undefined ||
    options.grandTotalLabels !== undefined
  ) {
    warnings.push({
      code: 'tornado-option-ignored',
      severity: 'warn',
      message: 'stack/total connector options do not apply to tornado swings',
      suggest: 'remove netLine/averageMarker/connectors/grandTotalLabels; one-at-a-time swings do not sum',
    });
  }
  if (options.currentValue !== undefined) {
    warnings.push({
      code: 'tornado-current-value-ignored',
      severity: 'warn',
      message: 'tornado anchors on the base case, not on a current-value comparator; currentValue was ignored',
      suggest: 'use baseValue',
    });
  }

  const lowCells = normalizeSeriesValues(lowSeries, cats, 0);
  const highCells = normalizeSeriesValues(highSeries, cats, 1);

  interface DerivedRow {
    index: number;
    cat: RowCat;
    low: number;
    high: number;
    swing: number;
    down: number;
    up: number;
    inverse: boolean;
    straddles: boolean;
  }
  const derivedRows: DerivedRow[] = [];
  const droppedDrivers: string[] = [];
  cats.forEach((cat, index) => {
    const low = cellValue(lowCells[index]!);
    const high = cellValue(highCells[index]!);
    if (low === null || high === null) {
      droppedDrivers.push((cat.label ?? cat.id).replace(/\s+/g, ' '));
      warnings.push({
        code: 'tornado-row-incomplete',
        severity: 'warn',
        message: `driver '${cat.label ?? cat.id}' is missing its ${low === null ? 'low' : 'high'}-case output and was dropped; a one-at-a-time swing needs both cases`,
        owner: { categoryId: cat.id },
        suggest: 'supply both case outputs for the driver, or remove the driver',
      });
      return;
    }
    const lo = Math.min(low, high);
    const hi = Math.max(low, high);
    derivedRows.push({
      index,
      cat,
      low,
      high,
      // RAW, and every decision below reads these raw.
      //
      // These three were round2'd, and the engine then FORKED on the rounded
      // number: `if (row.swing === 0)` printed "moves the output by 0" over a
      // 0.001 bar, `derived.tornado` published swing:0 next to its own raw low
      // and high, and the order comparator manufactured ties that the tie-break
      // then resolved on a different quantity — putting a smaller swing above a
      // larger one. round2's epsilon is 0.005 in whatever unit the numbers
      // happen to be counted in, so an output metric measured in EPS, ratios,
      // per-share amounts or percentages sat entirely underneath it.
      //
      // ROUND FOR DISPLAY, NEVER FOR DECISION: `fmt` is applied where the
      // number is printed, `cleanFloat` where it is serialised, and neither is
      // in the path of a threshold, a fork, a flag or an ordering.
      swing: hi - lo,
      down: lo - base.value,
      up: hi - base.value,
      // The fact `range` would have destroyed: the HIGH input produced the
      // LOWER output.
      inverse: high < low,
      straddles: lo <= base.value && base.value <= hi,
    });
  });
  if (derivedRows.length === 0) {
    throw new NormalizeError(
      'empty-data',
      'series',
      'every tornado driver was dropped for a missing case output; nothing is left to plot',
    );
  }

  // Order: swing magnitude descending (the tornado silhouette), tie broken by
  // the larger single-sided excursion from base, then by sheet index. Fully
  // deterministic — no comparator may fall through to engine sort order.
  //
  // The ORDER is cut on the RAW swing, and deliberately so — the bump chart's
  // rule ("the cut is made at the precision the reader can see", line/layout.ts:626)
  // does not transfer to this chart unchanged. On a bump chart the ranked quantity is
  // only ever a printed number at a point, so a difference the label does not
  // show is one the reader has no access to. On a tornado the swing IS the bar
  // length: a 0.022 bar next to a 0.002 bar is ten times longer on the canvas
  // no matter what the two labels round to. Ranking those equal would put a
  // visibly shorter bar above a visibly longer one — the silhouette, which is
  // the whole point of the exhibit, would stop being monotone.
  //
  // So the geometry stays faithful and the DISCLOSURE carries the rest: where
  // two neighbouring rows print the same swing, the exhibit's own numbers
  // cannot justify which is above the other, and the reader checking the labels
  // against the model gets told so instead of being left to ask.
  const ordered = [...derivedRows].sort((a, b) => {
    if (b.swing !== a.swing) return b.swing - a.swing;
    const aFar = Math.max(Math.abs(a.low - base.value), Math.abs(a.high - base.value));
    const bFar = Math.max(Math.abs(b.low - base.value), Math.abs(b.high - base.value));
    if (bFar !== aFar) return bFar - aFar;
    return a.index - b.index;
  });
  // Maximal runs of adjacent rows whose PRINTED swing is the same string. One
  // entry per run, not per row.
  const ties: { rank: number; categoryIds: Id[] }[] = [];
  for (let start = 0; start < ordered.length; ) {
    let end = start + 1;
    while (
      end < ordered.length &&
      formatDifference(fmt, ordered[end]!.swing) === formatDifference(fmt, ordered[start]!.swing)
    ) {
      end += 1;
    }
    if (end - start >= 2) {
      const members = ordered.slice(start, end);
      ties.push({ rank: start + 1, categoryIds: members.map((row) => row.cat.id) });
      warnings.push({
        code: 'tornado-swing-tie',
        // INFO, not warn, and the distinction is load-bearing. `bump-rank-tie`
        // is a warn because there the entities genuinely SHARE a rank and one
        // is drawn on top of another. Here the ranking is correct and the bars
        // are faithful — what the reader cannot do is read the margin off the
        // page. That is a disclosure about printed precision, the same class as
        // `likert-rounding-drift`, and it must not scold an exhibit whose only
        // fault is that two of its drivers are genuinely close.
        severity: 'info',
        message: `${members.map((row) => `'${row.cat.label ?? row.cat.id}'`).join(', ')} all print swing ${formatDifference(fmt, members[0]!.swing)}, so the printed numbers do not say why they are ranked ${start + 1} to ${end} in that order; the bars are drawn at their exact swings and the order follows those`,
        suggest:
          'raise the printed precision with options.format so the exhibit shows the difference its ranking rests on',
      });
    }
    start = end;
  }
  const sort = options.sort?.categories ?? 'sheet';
  if (sort === 'reverse') ordered.reverse();
  else if (sort === 'asc' || sort === 'desc') {
    warnings.push({
      code: 'tornado-sort-ignored',
      severity: 'warn',
      message: `sort.categories '${sort}' is ambiguous on a tornado (ascending in low case, high case or swing?); rows keep swing order`,
      suggest: "use sort.categories 'reverse' to put the smallest swing at the top",
    });
  }

  // Case identity follows the named low/high inputs even when their outputs
  // reverse sides. Explicit palettes retain two tints of their first rank.
  const casePaint = (role: 'low' | 'high'): PiecePaint => {
    const series = role === 'low' ? lowSeries : highSeries;
    if (series.fill) return { fill: { css: series.fill } };
    if (series.colorRole) return { fill: markRolePaint(series.colorRole, true) };
    if (paletteRamp) {
      return {
        fill: role === 'low'
          ? themeSeriesPaint(0, options.palette, 'PY', true, true)
          : themeSeriesPaint(0, options.palette),
      };
    }
    // Without an authored case pair, the low case is a tint of the high case
    // tone, dark enough to read as a bar of its own.
    if (role === 'low' && !theme.color.casePair) {
      return { fill: { token: 'case-2', theme: { kind: 'visible-tint', base: { token: 'case-2' }, amount: 0.6, floor: 2 } } as Paint };
    }
    return { fill: { token: role === 'low' ? 'case-1' : 'case-2' } };
  };
  // A row whose swing does not contain the base case. Hatched over the case
  // tone of the farther endpoint: the tone still says which case is at the far
  // end, the hatch says the span is not a spine-anchored swing.
  const detachedPaint = (role: 'low' | 'high'): PiecePaint => ({
    ...casePaint(role),
    pattern: 'hatch45',
  });
  const caseSeriesId = (role: 'low' | 'high'): Id => (role === 'low' ? lowSeries.id : highSeries.id);
  const caseValue = (row: DerivedRow, role: 'low' | 'high'): number =>
    role === 'low' ? row.low : row.high;

  const rows: PlannedRow[] = ordered.map((row) => {
    const cat = row.cat;
    const lo = Math.min(row.low, row.high);
    const hi = Math.max(row.low, row.high);
    const piece = (role: 'low' | 'high', from: number, to: number, geo: 'low' | 'high' | 'span'): RowPiece => ({
      from,
      to,
      role: geo,
      seriesId: caseSeriesId(role),
      nodeId: `tornadoPiece:${caseSeriesId(role)}:${cat.id}`,
      part: 'tornadoPiece',
      // EMPHASIS MUST NOT OVERWRITE A CHANNEL THAT IS CARRYING MEANING.
      //
      // A `highlight` fill on BOTH pieces would destroy the case identity of
      // the one row the author chose to emphasise, while the legend this
      // variant makes MANDATORY still says the two tones are the low case and
      // the high case. On a highlighted inverse driver that erases the headline
      // insight itself.
      //
      // The bar engine already draws this line: :1769 only lets `highlight`
      // take the fill when `dataSeries.length === 1`, i.e. when no series
      // identity is at stake. A tornado always has two NAMED case series, so
      // emphasis rides a channel the legend does not use — a highlight ring
      // around both pieces of the row, case tones intact.
      paint: highlights.has(cat.id)
        ? ({ ...casePaint(role), stroke: { token: 'focus' }, strokeWidth: strokeToken(ctx.theme, 'mark') } as PiecePaint)
        : casePaint(role),
      display: fmt(caseValue(row, role)),
    });

    let pieces: RowPiece[];
    // EXACT. `row.swing` is raw, so this fires only when the two case outputs
    // really are the same number — which is what the message claims. The
    // rounded test said "moves the output by 0" about a driver that moved it.
    if (row.swing === 0) {
      // No sensitivity is a legitimate finding, not an error: a hairline at
      // the value, said out loud.
      warnings.push({
        code: 'tornado-zero-swing',
        severity: 'info',
        message: `driver '${cat.label ?? cat.id}' moves the output by 0 between its low and high case`,
        owner: { categoryId: cat.id },
      });
      pieces = [piece('high', row.low, row.high, 'span')];
    } else if (row.straddles) {
      // Two pieces meeting exactly at the spine; they cannot overlap.
      pieces = [
        piece('low', base.value, row.low, 'low'),
        piece('high', base.value, row.high, 'high'),
      ];
    } else {
      // Base outside the swing: paint the swing where it is, DETACHED from the
      // spine. Stretching the bar back to base would paint the gap between
      // base and the nearer case as if it were swing, overstating sensitivity.
      //
      // ON-CANVAS TRACE. The bar covers the whole low-to-high interval, so a
      // SOLID case fill would claim that the entire span belongs to one case
      // while the value label at the other end says otherwise: the legend
      // would describe a span it does not encode. "The bar does not touch the
      // spine" is no cue that the model fails to reproduce its own base case
      // on an exhibit where NO bar touches it. So the same-side bar is
      // hatched, the degenerate-data glyph (cohort's n.m. cell,
      // theme.pattern.hatchAngle), and the hatch gets its own legend row
      // below. One stroke keys the fill correctly and puts the trace on the
      // exhibit, where a CLI warning is not.
      const farRole: 'low' | 'high' =
        Math.abs(row.low - base.value) > Math.abs(row.high - base.value) ? 'low' : 'high';
      pieces = [{ ...piece(farRole, lo, hi, 'span'), paint: detachedPaint(farRole) }];
    }
    if (!row.straddles) {
      // The three numbers in this sentence are its EVIDENCE, so where the
      // exhibit's own formatter collapses them to one string ("spans 2.5 to
      // 2.5, which does not contain the base case 2.5" — every word of it true,
      // and unreadable) the prose falls back to the unrounded values. Display
      // precision is a property of the exhibit; a warning that has to prove
      // something is not the exhibit.
      const collapsed =
        fmt(lo) === fmt(hi) || fmt(lo) === fmt(base.value) || fmt(hi) === fmt(base.value);
      const say = (v: number): string => (collapsed ? String(receiptValue(v)) : fmt(v));
      warnings.push({
        code: 'tornado-base-outside-swing',
        severity: 'warn',
        message: `driver '${cat.label ?? cat.id}' spans ${say(lo)} to ${say(hi)}, which does not contain the base case ${say(base.value)}; the bar is drawn detached from the spine`,
        owner: { categoryId: cat.id },
        suggest: 'the base case should be reproduced by base inputs — check the model',
      });
    }

    const endpoints: RowEndpoint[] =
      row.swing === 0
        ? [
            {
              // Both cases land on the same number; printing it twice at one
              // point would guarantee a collision and a bogus label-hidden.
              id: `tornadoCase:${cat.id}`,
              owner: { seriesId: highSeries.id, categoryId: cat.id },
              value: row.high,
              side: 'high',
            },
          ]
        : [
            {
              id: `tornadoLow:${lowSeries.id}:${cat.id}`,
              owner: { seriesId: lowSeries.id, categoryId: cat.id },
              value: row.low,
              side: row.low < row.high ? 'low' : 'high',
            },
            {
              id: `tornadoHigh:${highSeries.id}:${cat.id}`,
              owner: { seriesId: highSeries.id, categoryId: cat.id },
              value: row.high,
              side: row.high > row.low ? 'high' : 'low',
            },
          ];

    return {
      cat,
      pieces,
      endpoints,
      leftText: fmt(lo),
      rightText: fmt(hi),
    };
  });

  const legendOption = options.legend;
  let legend: RowIntervalPlan['legend'];
  if (legendOption === 'none') {
    warnings.push({
      code: 'tornado-legend-suppressed',
      severity: 'warn',
      message: 'tornado legend suppressed: nothing on the exhibit then says which tone is the low-input case',
      suggest: "drop legend: 'none', or set legend to 'top' or 'bottom'",
    });
  } else {
    const legendOptions: LegendOptions = normalizeLegendOption(legendOption, { position: 'top' });
    legend = {
      options: legendOptions,
      items: [
        { id: lowSeries.id, label: lowSeries.label ?? lowSeries.id, paint: casePaint('low').fill },
        { id: highSeries.id, label: highSeries.label ?? highSeries.id, paint: casePaint('high').fill },
        // The hatch is a mark on the canvas, so it gets a key. Without this the
        // legend would enumerate two solid tones for an exhibit that also draws
        // a third treatment — the legend describing a chart it does not cover.
        ...(ordered.some((row) => !row.straddles)
          ? [
              {
                id: '__tornadoDetached',
                label: options.strings!.swingOutsideBase!,
                paint: casePaint('high').fill,
                pattern: 'hatch45' as const,
              },
            ]
          : []),
        // A driver with no swing draws no row; when its disclosure does not print, the key names it.
        ...(droppedDrivers.length > 0 && !disclosuresShown(options)
          ? [omittedKey('__tornadoDropped', stringFields(options.strings!.missingSwingNote!, { drivers: droppedDrivers.join(', ') }))]
          : []),
      ],
    };
  }

  if (!labelOn('valueLine')) {
    warnings.push({
      code: 'label-hidden',
      severity: 'warn',
      message: 'baseValue label was explicitly suppressed while its authored spine remains visible',
      owner: { annotationId: 'baseValue' },
      suggest: 'enable labels.valueLine so the base-case spine is self-explanatory',
    });
  }

  const lowCaseLabel = lowSeries.label ?? lowSeries.id;
  const highCaseLabel = highSeries.label ?? highSeries.id;
  const inverseCount = ordered.filter((row) => row.inverse).length;

  // THE ONE NUMBER EVERY BAR IS MEASURED FROM.
  //
  // `baseValue.label` is authorable free text. It was printed on the spine,
  // never checked, and then handed to the annotation as its `computedText` — so
  // `claims/index.ts` compared the author's string against itself, found no
  // override, and certified an authored number as engine-derived. An exhibit
  // reading "Base case 250" over bars drawn off 110 verified clean and exit 0.
  //
  // Two changes, matching the two halves of the house precedent: the annotation
  // now carries the ENGINE's string as `computedText` (so the receipt records
  // `authored-override` and puts the engine's answer in `inputs`), and an
  // authored label that states a DIFFERENT number is warned about — waterfall's
  // `derived-mismatch` and likert's `likert-base-declared-mismatch` do exactly
  // this for authored numbers that duplicate derived ones.
  const spineComputedText = stringFields(options.strings!.baseCase!, { value: fmt(base.value) });
  if (base.label !== undefined && base.label !== spineComputedText) {
    const engineNumber = fmt(base.value);
    const statesANumber = /\d/.test(base.label);
    const quotesTheEngineNumber = new RegExp(
      `(^|[^\\d.,])${engineNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\d.,]|$)`,
    ).test(base.label);
    if (statesANumber && !quotesTheEngineNumber) {
      warnings.push({
        code: 'tornado-base-label-mismatch',
        severity: 'warn',
        message: `the spine is drawn at ${engineNumber} but its authored label reads '${base.label}'; every bar on this exhibit is measured from ${engineNumber}, so the printed base contradicts every swing on the page`,
        owner: { annotationId: 'baseValue' },
        suggest:
          'omit baseValue.label and let the engine print the number it draws, or correct baseValue.value',
      });
    }
  }

  return {
    cats: ordered.map((row) => row.cat),
    rows,
    spine: {
      key: 'baseValue',
      value: base.value,
      text: base.label ?? spineComputedText,
      computedText: spineComputedText,
    },
    ...(legend ? { legend } : {}),
    methodNotes: [
      ...(options.methodNote === true ? [options.strings!.sensitivityNote!] : []),
      ...(ordered.some((row) => !row.straddles)
        ? [disclosureNote(options.strings!.hatchedBaseNote!)]
        : []),
      ...(droppedDrivers.length > 0
        ? [
            disclosureNote(stringFields(options.strings!.missingSwingNote!, { drivers: droppedDrivers.join(', ') })),
          ]
        : []),
    ],
    derived: {
      // `totals` on a tornado is the row's swing — the magnitude the row
      // encodes. There is no total: OAT swings do not sum.
      //
      // Every number below is the RAW derivation, carried through `cleanFloat`
      // only to drop IEEE754 representation noise on the way into the receipt.
      // The swing is as raw as `low` and `high` beside it, so the receipt never
      // contradicts itself (swing:0 next to low 2.452, high 2.453) and stays
      // auditable.
      totals: Object.fromEntries(ordered.map((row) => [row.cat.id, receiptValue(row.swing)])),
      order: ordered.map((row) => row.cat.id),
      mean: receiptValue(ordered.reduce((sum, row) => sum + row.swing, 0) / ordered.length),
      tornado: {
        baseValue: base.value,
        method: 'one-at-a-time',
        // The rank groups the exhibit cannot visibly justify, named.
        ties,
        rows: ordered.map((row) => ({
          id: row.cat.id,
          low: row.low,
          high: row.high,
          swing: receiptValue(row.swing),
          down: receiptValue(row.down),
          up: receiptValue(row.up),
          inverse: row.inverse,
          straddles: row.straddles,
        })),
      },
    },
    a11yTitleCounts: [structureCount('drivers', ordered.length, undefined, options)],
    a11yTitle: chartString(options, 'tornadoTitle', { v1: ordered.length }),
    a11yDesc:
      chartString(options, 'tornadoDescStart') +
      chartString(options, 'tornadoDescEffects') +
      chartString(options, 'tornadoBaseDesc', { v1: fmt(base.value) }) +
      ordered
        .map(
          (row) =>
            // Driver labels may carry an authored line break for the input
            // range echo; spoken text takes it as a space.
            // The two case outputs are LEVELS and keep the level format; the
            // swing is a DIFFERENCE, so on a percent metric it is spoken in
            // percentage points. "swing 9.0%" off a gross-margin tornado reads
            // as a 9% relative move and means 9pp — two different numbers.
            chartString(options, 'tornadoDriverDesc', { v1: (row.cat.label ?? row.cat.id).replace(/\s+/g, ' '), v2: lowCaseLabel, v3: fmt(row.low), v4: highCaseLabel, v5: fmt(row.high), v6: formatDifference(fmt, row.swing), v7: row.inverse ? chartString(options, 'inverseClause') : '', v8: row.straddles ? '' : chartString(options, 'baseOutsideClause') }),
        )
        .join('; ') +
      `.` +
      (inverseCount > 0
        ? chartString(options, 'inverseDriversDesc', { v1: inverseCount, v2: ordered.length })
        : '') +
      // A driver dropped for a missing case output vanished from the canvas AND
      // from the spoken text; a reader handed either could not know it existed.
      // The row itself cannot be drawn — there is no interval — but its absence
      // is now stated, which is the repo's n.m. convention on the one channel
      // that can carry it.
      (droppedDrivers.length > 0
        ? chartString(options, 'missingDriversDesc', { v1: droppedDrivers.length, v2: droppedDrivers.length === 1 ? '' : 's', v3: droppedDrivers.join(', '), v4: droppedDrivers.length === 1 ? 'is' : 'are', v5: droppedDrivers.length === 1 ? 'one is' : 'at least one is' })
        : ''),
  };
}

/**
 * THE RECEIPT CARRIES THE ENGINE'S ANSWER, UNMODIFIED.
 *
 * No IEEE754 noise is stripped on the way into `derived`. Rounding to
 * significant digits breaks large totals (`toPrecision(12)` prints
 * 10000000000000 for an input total of 10000000000001) and quantizes genuine
 * repeating decimals such as 100/3.
 *
 * A receipt exists so someone can RECOMPUTE the number and compare. Whatever
 * the engine actually computed IS the answer, including its representation
 * error: a consumer who evaluates 2.462 − 2.44 gets 0.022000000000000242 too, and a receipt that says
 * 0.022 disagrees with them. Cosmetics belong to the formatter, which is a
 * different path with a different job.
 *
 * So the receipt is raw: `receiptValue` passes the value through unchanged.
 */
function receiptValue(v: number): number {
  return v;
}


/**
 * A swing is a DIFFERENCE. On a percent-valued output metric the level
 * formatter prints "9.0%", which states as a percent what is really nine
 * percentage points — a unit-of-measure confusion between a percent and a
 * percentage-point difference. When (and only when) the chart's
 * own formatter attaches a percent sign, a difference is spoken in percentage
 * points instead. The level readings — low case, high case, the base — keep the
 * percent sign, because those really are percentages.
 */
function formatDifference(fmt: (v: number) => string, v: number): string {
  const level = fmt(v);
  return level.endsWith('%') ? `${level.slice(0, -1)} percentage points` : level;
}

/** Natural rows retain the two category lines even when the current frame thins them. */
function naturalCategoryHeights(cats: readonly { id: string; label?: string }[], font: FontSpec, width: number, measure: TextMeasurer) {
  // A name past two lines needs the step plot.ts asks for its lines (lines x line height + 4).
  return cats.map((cat) => {
    const lines = wrapText(cat.label ?? cat.id, font, width, CAT_MAX_LINES, measure).lines.length;
    return { h: lines * font.size * 1.2 + (lines > 2 ? 4 : 0) };
  });
}
