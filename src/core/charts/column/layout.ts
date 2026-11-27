import { engineNoteMeta, knownPartsLead, withEngineNotes } from '../../notes';
import { hasBold } from '../../inlineBold';
import { valueLineLabelsOn } from '../labelOn';
import { refuseLabelPosition } from '../band/labelPosition';
import { pickedValues, withValueLabelDefaults } from '../band/valueSelection';
import { sk, stackParts, withoutShareAnnotations } from '../band/stacks';
import { chartString } from '../../strings/column';
import { REFERENCE_LABEL_CLEARANCE, textBreaksLine, withSegmentSeams } from '../../markVisibility';
import { TEXT_ASCENT } from '../../svg/renderSvg';
import { withLocaleStrings } from '../../strings';
import { structureCount } from '../../structureCounts';
import { axisBreakHeightOrderWarning } from '../../axisBreakOrder';
import { stackBreakReversesOrder } from '../band/breakOrder';
/**
 * Column chart — grouped / stacked / stacked100 vertical bars
 * over ChartData. Reference-role series render as plan ticks/lines/markers
 * (never as bars), scenario drives fills (AC dark, PY light, PL outline,
 * FC hatch45), stacked segment labels follow the label cascade, stack
 * grand totals always render, sliver segments auto-hide. A single PY
 * reference on a stacked column activates the compact integrated-variance
 * grammar unless its total/annotation/tick label gates are disabled.
 *
 * `layoutColumn` runs five phases: domain and scales (domain.ts,
 * anomaly.ts, paints.ts, plot.ts), mark geometry (marks.ts), label planning
 * (labels.ts) with the solver, annotations through the unchanged
 * `runAnnotatePass` call, and the geometry assembly below. The frame's own
 * index becomes the run's index; the marks claim into an index of their own,
 * which this function replays in claim order.
 */

import { maxOf } from '../../arrays';
import { BAND_PAD, hiddenValueLineReserve, VALUE_LINE_RESERVE } from '../../annotateParts';
import { applyValueAxisTitleInk, valueAxisTitleRequest } from '../../axis';
import { rectSeriesAdjacentWarnings } from '../../adjacentSeries';
import { PARTIAL_KEY, partialIds, toDateFits, toDateRoom } from '../../partialPeriod';
import type { AnchorResolution, AnnotatePassResult } from '../../annotate';
import { NOT_AVAILABLE } from '../../format';
import { noTotal } from '../../stackAdds';
import { emitEventLane, emptyAnnotatePass, percentLevels, runAnnotatePass, settleEventLane } from '../../annotatePass';
import { categoryTargetFields, spliceAnnotationNodes } from '../../annotateFields';
import { segmentHitsRect, type Point, type Rect } from '../../geometry';
import { leaderPath, linePath } from '../../svgPath';
import { fmtPathNumber as fmt } from '../../curve';
import { labelsToNodes } from '../../label/emit';
import type { OccupiedClaim, OccupiedIndex } from '../../label/occupied';
import { labelCtx, leaderTerminus, solveLabels, type LabelRequest, type SolveCtx, type SolveResult } from '../../label/solver';
import { ColumnHeightTrial, COLUMN_MIDPOINT_SHORT, columnHeightSearch, columnMidpointFloor, copyFitDrawing, plotFloorRows, sameContent, DIGIT_SEAT, measuredColumnHeights, measureColumnHeight, type DigitSeated } from '../../sizing';
import type { TickBandDerived } from '../../label/tickRow';
import { accessibleTitle } from '../../normalize/shared';
import type { RangeMark } from '../../rangeRules';
import { addRatioTierRequests, finalizeRatioTier, ratioTierA11y, ratioTierSpacingWarnings, type FinalizedRatioTier, type RatioTierGeometry, type RatioTierRequestState } from '../../ratioTier';
import { currentSmallValues, formatScopeKey, zeroLifts } from '../../formatPrecision';
import { requestMemo } from '../../layoutPlan';
import { COLLECT_IDENTITIES } from '../../seriesIdentity';
import { hasCompleteTextWidths } from '../../fontMetrics/injected';
import { defaultMeasurer, isCachedTextMeasurer, type FontSpec } from '../../text';
import { colorblindPaint, joinHatchPeers, layoutStepKey, panelTypeClass, emphasisWeight, strokeToken } from '../../theme';
import type { AnchorRef } from '../../types/annotations';
import { cellMeta, type Id } from '../../types/cell';
import type { ChartData } from '../../types/data';
import type { Geometry, LintWarning, PaintWarningRule, PlacedLabel, SceneNode } from '../../types/scene';
import { bandValueLabelUniformity, compactValueLabelFont, INSIDE_MIN_W, groupedValueLabelPolicy, haloOverRules, keepValuesWithoutAxis, raiseOverRules, warnSliverLabels } from '../band/labels';
import { groupedOffsets } from '../band/groups';
import { textScaleOf } from '../../typeFloors';
import { anomalyReceipt } from './anomaly';
import { edgeNameFont, KEY_EDGE_SERIES, kindSetting, rightEdgeSeriesLabels, resolveColumnDomain, toDateOnValues } from './domain';
import { cellValueText, COLUMN_LABEL_PAD, firstSegmentHidesRow, planColumnLabels, planColumnTotals, planColumnValueLabels, planTickEnds, positionColumnLabels, seatExtremeValue, type DigitSeats } from './labels';
import { layoutColumnMarks, stackSegmentRect, stackPaddingProbe } from './marks';
import { compactStaircaseNamesFit, stackedStaircaseSeatsFit } from './staircaseSeats';
import { PY_TICK_LEAD, TICK_LABEL_RESERVE, type ColumnArea, type ColumnDomain, type ColumnMarkGeometry, type ComputedTotal } from './model';
import { columnPaints } from './paints';
import { bracketsOverColumns, CAGR_PAD, CATEGORY_NOTES, columnValueNotes, columnPassAnnotations, columnPassText, columnPlotArea, SEGMENT_NOTE, solveColumnFrame, type ColumnStaircaseMemo, type ColumnNoteRows } from './plot';
import { toleranceKeyed } from '../../valueLineDomain';
import { categoryNotesDiffer, FORCE_CATEGORY_RANKS, rankNotes } from '../combo/categoryRanks';
import type { AnomalyColumnOptions, AnomalyDerived } from './types';
import type { EmittedLane } from '../../eventLane';
import { authoredNotes, comparableOptions, dataOrder, sourceOnlyListNotes, hiddenNoteBodyOptions, NOTED_LABELS, plotChromeFloor, POINTED_NOTES, type InternalFootnoteOptions } from '../../frame';
import { withBandValueNotes } from '../band/valueNotes';
import { nextStaircase, STAIRCASE, probeStaircasePadding, runStaircase, seatStaircase, settleStaircase, staircaseNameSeats, staircaseShortOnHeight, staircaseState, STAIRCASE_MAX_PAD, type StaircaseOutcome } from '../../label/staircase';
import type { Theme } from '../../types/theme';
import { pushAll } from '../../arrays';
import { footerPlans, freedChromeOf, partNeedOf, staticFrame } from '../../footer';
import { HOST_CLAIMS } from '../../claims/ids';

/** Route straight leaders around printed boxes, or cut their blocked runs, with the shared gap. */
function clearStraightLeaders(labels: PlacedLabel[], theme: Theme): void {
  const visible = labels.filter((label) => !label.hidden);
  const pad = REFERENCE_LABEL_CLEARANCE + strokeToken(theme, 'rule') / 2 + 0.01;
  for (const label of visible) {
    if (!label.leader) continue;
    if (label.leader.curved) {
      clearCurvedLeader(label, visible, pad);
      continue;
    }
    const match = /^M(-?[\d.]+) (-?[\d.]+)L(-?[\d.]+) (-?[\d.]+)$/.exec(label.leader.d);
    if (!match) continue;
    const [x, y, x2, y2] = match.slice(1).map(Number) as [number, number, number, number];
    const dx = x2 - x, dy = y2 - y;
    const cuts: [number, number][] = [];
    for (const other of visible) {
      const r = other.rect;
      let from = 0, to = 1;
      for (const [at, step, low, high] of [[x, dx, r.x - pad, r.x + r.w + pad], [y, dy, r.y - pad, r.y + r.h + pad]] as const) {
        if (step === 0) {
          if (at < low || at > high) { from = 1; to = 0; }
        } else {
          const a = (low - at) / step, b = (high - at) / step;
          from = Math.max(from, Math.min(a, b));
          to = Math.min(to, Math.max(a, b));
        }
      }
      if (from < to) cuts.push([from, to]);
    }
    if (!cuts.length) continue;
    const from = { x, y };
    const ends = [leaderTerminus(label.rect, { x: label.rect.x - 1, y }), leaderTerminus(label.rect, { x: label.rect.x + label.rect.w + 1, y })];
    const routes = ends.flatMap((end) => [[from, { x: end.x, y }, end], [from, { x, y: end.y }, end]])
      .sort((a, b) => Math.abs(a[2]!.x - x) + Math.abs(a[2]!.y - y) - Math.abs(b[2]!.x - x) - Math.abs(b[2]!.y - y));
    const clear = routes.find((points) => points.slice(1).every((b, i) => visible.every((other) => !segmentHitsRect(points[i]!, b, other.rect, pad))));
    if (clear) {
      label.leader = { d: linePath(clear), curved: false };
      continue;
    }
    cuts.sort((a, b) => a[0] - b[0]);
    const runs: [number, number][] = [];
    let start = 0;
    for (const [from, to] of cuts) {
      if (from > start) runs.push([start, from]);
      start = Math.max(start, to);
    }
    if (start < 1) runs.push([start, 1]);
    const point = (t: number) => ({ x: x + t * dx, y: y + t * dy });
    const d = runs.map(([from, to]) => linePath([point(from), point(to)])).join('');
    label.leader = d ? { d, curved: false } : undefined;
  }
}

/** Points along a leader's S-curve, as straight pieces for the clearance test. */
function curvePoints(from: Point, mx: number, to: Point): Point[] {
  return Array.from({ length: 17 }, (_, i) => {
    const t = i / 16, u = 1 - t;
    const x = u * u * u * from.x + 3 * u * t * (u + t) * mx + t * t * t * to.x;
    const y = (u * u * u + 3 * u * u * t) * from.y + (3 * u * t * t + t * t * t) * to.y;
    return { x, y };
  });
}

/**
 * A curved leader that passes within the shared gap of another printed box
 * (a stack total over the anchor) runs flat along its start until it is past
 * that box, and curves up from there. With no such run, the leader stays.
 */
function clearCurvedLeader(label: PlacedLabel, visible: readonly PlacedLabel[], pad: number): void {
  const match = /^M(-?[\d.]+) (-?[\d.]+)C(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)$/.exec(label.leader!.d);
  if (!match) return;
  const [x, y, , , , , x2, y2] = match.slice(1).map(Number) as number[];
  const from = { x: x!, y: y! }, to = { x: x2!, y: y2! };
  const sign = Math.sign(to.x - from.x);
  const others = visible.filter((other) => other !== label);
  const blockers = (points: Point[]) => others.filter((other) => points.slice(1).some((b, i) => segmentHitsRect(points[i]!, b, other.rect, pad)));
  let start = from;
  for (let round = 0; round < 4; round++) {
    const points = [...(start === from ? [] : [from]), ...curvePoints(start, (start.x + to.x) / 2, to)];
    const hit = blockers(points);
    if (!hit.length) {
      if (start !== from) label.leader = { d: `M${fmt(from.x)} ${fmt(from.y)}L${leaderPath(start, to).slice(1)}`, curved: true };
      return;
    }
    // A box on the flat run itself cannot be passed by running further.
    if (blockers([from, start]).length) return;
    const past = sign > 0 ? Math.max(...hit.map((other) => other.rect.x + other.rect.w + pad)) : Math.min(...hit.map((other) => other.rect.x - pad));
    if ((to.x - past) * sign <= 0) return;
    start = { x: past, y: from.y };
  }
}

export interface ColumnMarks {
  /**
   * grouped: one entry per (series, category) with its scene nodeId.
   * stacked/stacked100: one entry per category (nodeId omitted — the stack is
   * not a single node) with `segments` carrying the per-series nodeIds.
   */
  bars: {
    seriesId?: Id;
    categoryId: Id;
    rect: Rect;
    nodeId?: Id;
    segments?: { seriesId: Id; rect: Rect; nodeId: Id }[];
  }[];
  referenceTicks: {
    seriesId: Id;
    categoryId: Id;
    rect: Rect;
    nodeId: Id;
    anchor?: { x: number; y: number };
    value?: number;
    labelId?: Id;
  }[];
  ranges?: RangeMark[];
  /**
   * One entry per drawn ribbon (options.ribbons): the series, the two
   * categories it joins, and its span in px on the facing column edges.
   */
  ribbons?: {
    seriesId: Id;
    from: Id;
    to: Id;
    left: { x: number; top: number; bottom: number };
    right: { x: number; top: number; bottom: number };
    nodeId: Id;
  }[];
  /** One entry per flagged period (options.anomaly); absent when none flagged. */
  anomaly?: {
    categoryId: Id;
    nodeId: Id;
    markerNodeId: Id;
    labelId?: Id;
    score: number | null;
  }[];
}

export interface IntegratedVariancePoint {
  categoryId: Id;
  referenceSeriesId: Id;
  current: number;
  reference: number;
  displayedCurrent: number;
  displayedReference: number;
  growthPct: number | null;
  displayedGrowthPct: number | null;
  tone: 'good' | 'bad' | 'neutral';
  text: string;
  x: number;
  tickY: number;
  totalLabelId: Id;
  growthLabelId: Id;
  referenceLabelId: Id;
  tickNodeId: Id;
}

export interface ColumnDerived {
  /** rounding 'sum-consistent': the shares printed off their nearest rounding. */
  roundingAdjustments?: import('../../shareRounding').RoundingAdjustment[];
  /** Absolute column totals (sum of data-role series) per category; empty when grouped or when the parts do not add. */
  stackTotals: Record<Id, number>;
  /** The data-series parts of each total in stackTotals, per category × series. */
  stackParts: Record<Id, Record<Id, number>>;
  /** stacked100 only: percent of the 100% basis per category × series. */
  percents?: Record<Id, Record<Id, number>>;
  ratioTier?: RatioTierGeometry;
  integratedVariance?: IntegratedVariancePoint[];
  /**
   * The anomaly rule and what it flagged. NOTE: `derived` does not cross the
   * CLI/MCP boundary (neither src/cli/main.ts nor src/mcp/server.ts reads it),
   * so this record is a library-consumer surface only — the driving agent gets
   * the same numbers through the `anomaly-method` info warning and a11y.desc.
   */
  anomaly?: AnomalyDerived;
  /** The category tick-row reserve; absent only when the tick row is not rendered. */
  tickBand?: TickBandDerived;
  /** The Total column cells the engine weighted; records read them, as the SVG draws them. */
  computedTotal?: ComputedTotal;
}

/** Phase 4: the annotation pass, anchored on the drawn columns and segments. */
function annotateColumn(
  domain: ColumnDomain,
  area: ColumnArea,
  scene: ColumnMarkGeometry,
  occupied: OccupiedIndex,
  solveCtx: SolveCtx,
  printedLabels: readonly PlacedLabel[],
): AnnotatePassResult {
  const annotations = columnPassAnnotations(domain);
  if (!annotations.length && isCachedTextMeasurer(domain.measure)) return emptyAnnotatePass();
  const { cats, dataSeries, variant, plottedOf, absOf, posTopP, negBotP, stackTotals } = domain;
  const { plot, band, y, y0, topPad } = area;
  const catIndex = new Map(cats.map((c, i) => [c.id, i] as const));
  const resolveAnchor = (ref: AnchorRef): AnchorResolution | null => {
    const norm = typeof ref === 'string' ? { categoryId: ref, edge: 'total' as const } : ref;
    if (!('categoryId' in norm)) return null;
    const ci = catIndex.get(norm.categoryId);
    if (ci === undefined) return null;
    const c = cats[ci]!;
    const edge = norm.edge ?? (norm.seriesId ? 'end' : 'total');
    if (norm.seriesId) {
      const reference = domain.refSeries.find((s) => s.id === norm.seriesId);
      const tick = scene.marks.referenceTicks.find((m) => m.seriesId === norm.seriesId && m.categoryId === c.id);
      if (reference && tick) {
        const v = plottedOf(reference, ci);
        if (v === null) return null;
        return { x: tick.anchor?.x ?? band.center(ci), y: tick.anchor?.y ?? y(v), value: v, format: reference.format,
          pointValueText: domain.valueSpec.forSeries(reference, reference.vals[ci]?.format)(v),
          date: c.date, label: c.label, owner: { categoryId: c.id, seriesId: reference.id } };
      }
      const s = dataSeries.find((x) => x.id === norm.seriesId);
      if (!s) return null;
      const owner = { categoryId: c.id, seriesId: s.id };
      const series = { format: s.format, ...(dataSeries.length > 1 ? { series: { id: s.id, label: s.label } } : {}) };
      if (variant === 'grouped') {
        const v = plottedOf(s, ci);
        if (v === null) return null;
        const cx = scene.subCenters.get(sk(s.id, c.id)) ?? band.center(ci);
        return { x: cx, y: edge === 'start' ? y0 : y(v), value: v,
          pointValueText: domain.valueSpec.forSeries(s, s.vals[ci]?.format)(v), date: c.date, label: c.label ?? c.id, owner, ...series };
      }
      const e = scene.segEdges.get(sk(s.id, c.id));
      if (!e) return null;
      const yy =
        edge === 'start' ? y(e.v0) : edge === 'end' ? y(e.v1) : y(Math.max(e.v0, e.v1));
      // Geometry is plotted units (percent under stacked100); the annotation
      // VALUE must stay absolute, exactly as the category branch below does —
      // an 'abs' on a stacked100 segment reported the share (67) instead of
      // the value (10). bar/stacked100 and mekko/percent already do this.
      // absOf === plottedOf outside stacked100, so this is a no-op elsewhere.
      const value = absOf(s, ci) ?? e.v;
      return { x: band.center(ci), y: yy, value,
        pointValueText: domain.valueSpec.forSeries(s, s.vals[ci]?.format)(value), date: c.date, label: c.label ?? c.id, owner, ...series };
    }
    // A grouped chart with several series has no stack: a category-level
    // anchor reads one series, the highlighted one or else the first, as line
    // does. The sum it read sat on no drawn bar. Stacked variants keep
    // the total.
    if (variant === 'grouped' && dataSeries.length > 1) {
      const anchorSeries = dataSeries.find((x) => domain.highlights.has(x.id)) ?? dataSeries[0]!;
      return resolveAnchor({ categoryId: c.id, seriesId: anchorSeries.id, ...(edge === 'start' ? { edge } : {}) });
    }
    // category level: stack total (value stays absolute for cagr/diff math);
    // a stack whose parts do not add keeps its seat and has no value
    const topPlotted = posTopP[ci]! > 0 ? posTopP[ci]! : negBotP[ci]!;
    return {
      x: band.center(ci),
      y: edge === 'start' ? y0 : y(topPlotted),
      value: stackTotals[c.id]!,
      pointValueText: domain.totalFmt(stackTotals[c.id]!),
      format: dataSeries.length === 1 ? dataSeries[0]!.format : undefined,
      ...noTotal(totalsAdd(domain), domain.stacks[ci]!.hasValue && !domain.incompleteCats.has(c.id)),
      date: c.date,
      label: c.label ?? c.id,
      owner: { categoryId: c.id },
    };
  };
  // liftArm clamps arms to plot.y + labelHeight; extend the rect it sees
  // upward into our reserved grand-total/cagr headroom so lifted arms may
  // actually use it (annotate.ts itself is shared and unchanged).
  const annPlot: Rect = {
    x: plot.x,
    y: plot.y - (topPad - 8 - area.axisTitleBand),
    w: plot.w,
    h: plot.h + (topPad - 8 - area.axisTitleBand),
  };
  const ceilingRects: Rect[] = [];
  if (area.ruleH > 0) {
    ceilingRects.push({ x: area.frame.plot.x, y: area.frame.plot.y + 2, w: area.frame.plot.w, h: area.ruleH });
  }
  if (area.axisTitle && domain.va.show) {
    ceilingRects.push({ x: area.frame.plot.x, y: area.frame.plot.y + area.ruleH + 4, w: area.axisTitle.width, h: area.axisTitle.height });
  }
  return runAnnotatePass({
    calloutColumnStack: true,
    spanBracket: (annotation) => bracketsOverColumns(annotation, domain),
    target: domain.options.target,
    // The growth bracket seats its label on its run.
    cagrLabelOnArm: true,
    annotations,
    toleranceKeyed: toleranceKeyed(annotations, area.frame.legend?.items),
    resolve: resolveAnchor,
    printedLabels,
    defaultSpan:
      cats.length >= 2 ? { from: cats[0]!.id, to: cats[cats.length - 1]!.id } : undefined,
    occupied,
    plot: annPlot,
    bandCeiling: area.frame.plot.y,
    ceilingRects,
    theme: domain.theme,
    measure: domain.measure,
    ...columnPassText(domain),
    percentLevels: percentLevels(dataSeries),
    sharesFormat: domain.variant === 'stacked100',
    valueLinePercentLevels: domain.variant === 'stacked100' || domain.options.unit === '%' || domain.pctLevels,
    averageMarker: domain.averageMarker,
    valueLineLabels: valueLineLabelsOn(domain.options),
    solveCtx,
    yScale: y,
    meanValue: domain.meanValue,
    ...(domain.meanMissing ? { meanMissing: domain.meanMissing } : {}),
    meanSpan: domain.meanSpan,
    ...categoryTargetFields(cats.map((c) => c.id), plot, (i) => band.center(i), 'x'),
    partialCategories: partialIds(cats),
  });
}

/**
 * the columns have totals to state only when they stack and their
 * parts add: grouped columns stand side by side, and percents of different
 * wholes do not sum. One series is its own total, so its values stay.
 */
function totalsAdd(domain: ColumnDomain): boolean {
  return domain.dataSeries.length === 1 || (domain.variant !== 'grouped' && domain.partsAdd);
}

/** The accessible description: variant, totals, PY growth, ranges, the anomaly rule, the ratio tier. */
function columnA11yDesc(domain: ColumnDomain, area: ColumnArea, rangeMarks: RangeMark[], points: IntegratedVariancePoint[]): string {
  const { cats, dataSeries, refSeries, variant, fmt, totalFmt, stackTotals, anomaly } = domain;
  const labelOf = (id: Id) => cats.find((category) => category.id === id)?.label ?? id;
  // One series reads out each value as its label prints it; a 100% stack of one series keeps its total.
  const oneValueText = (ci: number) => dataSeries.length === 1 && variant !== 'stacked100' ? cellValueText(domain, dataSeries[0]!, ci) : null;
  const variantName =
    variant === 'grouped' ? chartString(domain.options, 'clustered') : variant === 'stacked100' ? chartString(domain.options, 'stacked100') : chartString(domain.options, 'stackedLower');
  return chartString(domain.options, 'columnDescStart', { v1: variantName, v2: cats.length, v3: dataSeries.length }) +
    (refSeries.length ? chartString(domain.options, 'referenceSeriesClause', { v1: refSeries.length }) : '') +
    (totalsAdd(domain) ? chartString(domain.options, 'totalsSentence', { v1: cats.map((c, ci) => `${c.label ?? c.id} ${domain.stacks[ci]!.hasValue ? oneValueText(ci) ?? totalFmt(stackTotals[c.id]!) : NOT_AVAILABLE}`).join(', ') }) : '.') +
    (points.length
      ? chartString(domain.options, 'growthVersus', { v1: domain.pyRef!.label, v2: points
          .map((point) => `${labelOf(point.categoryId)} ${point.text}`)
          .join(', ') })
      : '') +
    (rangeMarks.length
      ? chartString(domain.options, 'rangesClause', { v1: rangeMarks
          .map((range) => chartString(domain.options, 'namedRange', { v1: range.categoryId, v2: fmt(range.low), v3: fmt(range.high) }))
          .join(', ') })
      : '') +
    (anomaly
      ? chartString(domain.options, 'anomalyDesc', { v1: anomaly.rule, v2: domain.corridorNote }) +
        (anomaly.flags.length === 0
          ? chartString(domain.options, 'noFlaggedPeriod')
          : chartString(domain.options, 'flaggedSentence', { v1: anomaly.flags
              .map((flag) => `${labelOf(flag.categoryId)} ${fmt(flag.value)}`)
              .join(', ') }))
      : '') +
    ratioTierA11y(area.tier);
}

/**
 * A sliver whose digits fit its segment prints there, at the cap height, once every other
 * label, annotation and lane entry holds its seat: the seat takes only room nothing else
 * wanted, so no other label moves. The size searches see it as hidden (DIGIT_SEAT), so the
 * chart keeps the height it had without the seat.
 */
function seatDigits(
  digits: DigitSeats, solved: SolveResult, occupied: OccupiedIndex, ctx: SolveCtx, warnings: LintWarning[], rules: PaintWarningRule[],
  /** Whether the note would name this value without its seat. */
  noted: (id: string) => boolean,
  /** The lines drawn so far: digits that would break one (the zero line) take no seat. */
  lines: readonly SceneNode[],
): void {
  const seated = new Set<string>();
  // The seat is the digits' cap height, so their baseline is its bottom edge (labelsToNodes).
  const clear = digits.requests.filter((request) => {
    const { rect } = request.candidates[0]!;
    const font = request.fontStep ?? request.font!;
    const top = rect.y + rect.h - font.size * TEXT_ASCENT;
    return !textBreaksLine(lines, rect.x, rect.x + rect.w, top, font.size);
  });
  if (clear.length > 0) {
    const late = solveLabels(clear, occupied, ctx);
    for (const label of late.placed) {
      const at = label.hidden === undefined ? solved.placed.findIndex((other) => other.id === label.id) : -1;
      if (at < 0) continue;
      const seat: DigitSeated = { [DIGIT_SEAT]: { noted: noted(label.id), lineH: solved.placed[at]!.rect.h } };
      solved.placed[at] = { ...label, ...seat };
      const decision = late.decisions.find((entry) => entry.labelId === label.id);
      const old = solved.decisions.findIndex((entry) => entry.labelId === label.id);
      if (decision && old >= 0) solved.decisions[old] = decision;
      seated.add(label.id);
    }
  }
  const names: string[] = [];
  for (const [id, name] of digits.slivers) if (!seated.has(id)) names.push(name);
  const warning: LintWarning[] = [];
  warnSliverLabels(warning, names);
  warnings.splice(digits.warningAt, 0, ...warning);
  // The paint rules came later and count the warnings before them.
  for (const rule of rules) rule.before += warning.length;
}

/** Phase 5: label nodes, the category axis, the receipts and the accessible text. */
function assembleColumnGeometry(
  domain: ColumnDomain,
  area: ColumnArea,
  scene: ColumnMarkGeometry,
  solved: SolveResult,
  annotated: AnnotatePassResult,
  tierState: RatioTierRequestState | undefined,
  pointFont: FontSpec,
  points: IntegratedVariancePoint[],
  ratioTierResult: FinalizedRatioTier | undefined,
  occupied: OccupiedIndex,
  warnings: LintWarning[],
  paintWarningRules: PaintWarningRule[],
  lane: EmittedLane | undefined,
  measuring: boolean,
): Geometry<ColumnMarks, ColumnDerived> {
  const { cats, dataSeries, anomaly, stackTotals, percents } = domain;
  const { tickFont, strongFont, labelFont, band, catPlan, showCatRow } = area;
  const { nodes, axes } = scene;
  const allLabels: PlacedLabel[] = [...solved.placed, ...annotated.labels];
  // A category with no value has no total: omitted, not a certified 0.
  // Nor has a grouped chart or a stack whose parts do not add.
  const printedTotals: Record<Id, number> = totalsAdd(domain) ? Object.fromEntries(cats.flatMap((c, ci) => (domain.stacks[ci]!.hasValue ? [[c.id, stackTotals[c.id]!]] : []))) : {};
  const integratedAnnotations = points.map((point) => ({
    id: `integratedVariance:${point.referenceSeriesId}:${point.categoryId}`,
    kind: 'diff' as const,
    computedText: point.text,
    tone: point.tone,
    nodeIds: [] as Id[],
    labelId: point.growthLabelId,
    // The integrated growth figure is percentDelta over the two totals the
    // panel already plots. Both are on the point; only the string was
    // reaching the manifest.
    derivation: {
      basis: 'derived' as const,
      op: 'annotation-diff-relative@1',
      inputs: [
        { ref: `${point.referenceSeriesId}:${point.categoryId}`, value: point.reference },
        { ref: `current:${point.categoryId}`, value: point.current },
      ],
      raw: point.growthPct,
    },
  }));
  spliceAnnotationNodes(nodes, annotated.nodes);
  const totalIds = new Set(domain.cats.filter((c) => c.role === 'total').map((c) => c.id));
  const bandLabelIds = new Set(
    annotated.placed.filter((ann) => ann.kind === 'band').map((ann) => ann.labelId),
  );
  if (allLabels.some((label) => !label.hidden && label.leader)) {
    for (const label of allLabels) if (label.kind === 'grandTotal' || label.kind === 'total') label.halo = true;
  }
  clearStraightLeaders(allLabels, domain.theme);
  // A highlighted mark's value and name print in the emphasis weight and the full ink.
  for (const label of allLabels) {
    if ((label.kind === 'point' || label.kind === 'category') && label.owner.annotationId === undefined
      && (domain.highlights.has(label.owner.categoryId ?? '') || domain.highlights.has(label.owner.seriesId ?? ''))) label.emphasis = true;
  }
  const labelNodes = measuring ? [] : labelsToNodes(domain.theme, allLabels, (l) =>
      tierState?.fontByLabelId.get(l.id) ??
      // A total column (categories[].role 'total') prints its head and values bold.
      (totalIds.has(l.owner.categoryId ?? '') && (l.kind === 'segment' || l.kind === 'category')
        ? { ...(l.kind === 'category' ? catPlan().font : strongFont), weight: emphasisWeight(domain.theme) } : undefined) ??
      (bandLabelIds.has(l.id)
        ? tickFont
        : l.kind === 'grandTotal' || l.kind === 'total'
          ? strongFont
          // A category label is drawn at the font its row was
          // measured and claimed at, which is the tick font unless the row
          // stepped down a size.
          : l.kind === 'category'
          ? area.stairTop !== undefined ? tickFont : catPlan().font
          : l.kind === 'tick'
          ? tickFont
          : l.kind === 'annotation' || l.kind === 'valueLine'
            ? { ...labelFont, weight: emphasisWeight(domain.theme) }
            : l.kind === 'point'
              ? pointFont
              : labelFont), nodes,
    );
  // Every label draws after every leader, including totals above the stacks.
  pushAll(nodes, labelNodes.filter((node) => node.part === 'leader'));
  pushAll(nodes, labelNodes.filter((node) => node.part !== 'leader'));
  // The event lane draws its own text (styled header runs), after the labels.
  if (lane) pushAll(nodes, lane.nodes);
  axes.unshift({
    axis: 'x',
    baselineNodeId: 'axis:baseline',
    ticks: cats.map((c, i) => ({
      at: c.id,
      pos: band.center(i),
      labelId: showCatRow || area.stairTop !== undefined ? `category:${c.id}` : undefined,
    })),
  });
  return {
    type: 'column',
    size: domain.size,
    plot: area.plot,
    scene: measuring ? nodes : withSegmentSeams(joinHatchPeers(nodes), domain.theme),
    labels: lane ? [...allLabels, ...lane.labels] : allLabels,
    axes,
    annotations: [
      ...integratedAnnotations,
      ...annotated.placed,
      ...(lane?.placed ?? []),
      // Series CAGR records, for the rates the edge or the key prints.
      ...[...domain.seriesCagr.values()].flatMap(({ placed }) => {
        const edge = allLabels.find((label) => label.id === placed.labelId);
        if (edge && !edge.hidden) return [placed];
        const key = area.frame.legend?.items.find((item) => placed.labelId === `seriesEdge:${item.id}`);
        return key ? [{ ...placed, labelId: key.labelId, labelNodeId: key.labelId }] : edge ? [placed] : [];
      }),
    ],
    legend: area.frame.legend,
    frame: area.frame.frame,
    marks: scene.marks,
    derived: {
      stackTotals: printedTotals,
      stackParts: stackParts(printedTotals, cats, dataSeries, (si, ci) => domain.absOf(dataSeries[si]!, ci)),
      ...(percents ? { percents } : {}),
      ...(domain.roundingAdjustments.length > 0 ? { roundingAdjustments: domain.roundingAdjustments } : {}),
      ...(domain.computedTotal ? { computedTotal: domain.computedTotal } : {}),
      ...(ratioTierResult ? { ratioTier: ratioTierResult.geometry } : {}),
      ...(showCatRow
        ? {
            tickBand: {
              reserved: area.tickReserve,
              measuredLines: catPlan().maxLines,
              lineHeight: catPlan().font.size * 1.2,
              // Rotated rows reserve more than lines × line height; the receipt names it.
              extra: catPlan().rowHeight - catPlan().maxLines * catPlan().font.size * 1.2,
              dateNumeric: catPlan().dateNumeric,
              position: 'below' as const,
            },
          }
        : {}),
      ...(points.length ? { integratedVariance: points } : {}),
      ...(anomaly ? { anomaly: anomalyReceipt(anomaly) } : {}),
    },
    a11y: {
      title:
        accessibleTitle(domain.options.title, chartString(domain.options, 'columnTitle', { v1: dataSeries.map((s) => s.label).join(', '), v2: cats.length })),
      counts: [...(domain.anomaly?.counts ?? []), structureCount('categories', domain.cats.length, undefined, domain.options), structureCount('series', domain.dataSeries.length, undefined, domain.options), ...(domain.refSeries.length ? [structureCount('reference-series', domain.refSeries.length, chartString(domain.options, 'referenceSeriesCount', { v1: domain.refSeries.length }))] : [])],
      desc: columnA11yDesc(domain, area, scene.rangeMarks, points),
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
 * A segment value the column cannot print (a sliver, or a label that
 * lost its seat) is named in the note line. The note takes footer height and
 * so moves the plot, so the chart is laid out again with it, until the named
 * set holds (three passes at most).
 */
export function layoutColumn(
  data: ChartData,
  options: AnomalyColumnOptions = {},
  keepEachValue = false,
): Geometry<ColumnMarks, ColumnDerived> {
  if ((options.valueAxis?.percent ? 'stacked100' : options.variant ?? 'grouped') !== 'grouped') {
    refuseLabelPosition(options, 'stacked columns', ['center', 'insideEnd', 'insideBase']);
  }
  const dropped: LintWarning[] = [];
  const resolved = withoutShareAnnotations(
    withValueLabelDefaults(ribbonDefaults(withLocaleStrings(options)), 'column', options.valueAxis?.percent ? 'stacked100' : options.variant, dropped),
    options.variant === 'stacked100' || Boolean(options.valueAxis?.percent), dropped);
  const geometry = layoutColumnKeyed(data, resolved, keepEachValue);
  geometry.warnings.push(...dropped);
  return geometry;
}

/** Whether the value axis was turned on for columns left with no number: decided once per chart. */
interface AxisFallback { on: boolean; noteParent?: ColumnPass; noteEnd?: ColumnPass }

const AXIS_FALLBACK = Symbol('columnAxisFallback');
const SHORT_WITHOUT_AXIS = Symbol('shortWithoutAxis');
const PROBE_COLUMN_AXIS = Symbol('probeColumnAxis');
const AXIS_PROBE_INCONCLUSIVE = Symbol('axisProbeInconclusive');
interface AxisProbe {
  checked: boolean;
  otherAxis?: Pick<AxisProbe, 'prepared'> & Pick<ColumnStaircaseMemo, 'frame' | 'plotHeightAt'>;
  prepared?: { domain: ColumnDomain; paints: ReturnType<typeof columnPaints>; warnings: LintWarning[] };
}

const columnValue = (label: Pick<PlacedLabel, 'kind'>) => ['point', 'segment', 'grandTotal', 'total'].includes(label.kind);
const shownValue = (label: PlacedLabel) => label.hidden === undefined || label.printedIn !== undefined;
// A redundant label that owes nothing is the author's label: false.
const droppedValue = (label: PlacedLabel) => !shownValue(label) && (label.hidden !== 'redundant' || label.owed === true);

const withValueAxis = (options: AnomalyColumnOptions): AnomalyColumnOptions => ({ ...options, valueAxis: { ...options.valueAxis, show: true } });

/**
 * Whether automatic value labels leave a column with no number while the
 * value axis is off by default: a grouped column with no value label, or a
 * stack that lost every segment value and its total. A value the author
 * turned off (labels.point false, a cell's label false) leaves no gap to
 * fill. An authored valueAxis.show and a grid panel keep their axis.
 */
function unnumberedColumn(data: ChartData, options: AnomalyColumnOptions, geometry: Pick<Geometry<ColumnMarks, ColumnDerived>, 'labels' | 'marks'>): boolean {
  if (options.valueAxis?.show !== undefined || panelTypeClass(options) !== undefined) return false;
  const values = new Map<string, PlacedLabel[]>();
  for (const label of geometry.labels) {
    if (!columnValue(label)) continue;
    for (const key of [`${label.owner.seriesId}|${label.owner.categoryId}`, `|${label.owner.categoryId}`]) {
      values.set(key, [...(values.get(key) ?? []), label]);
    }
  }
  const pointsOn = kindSetting(options, 'point') !== false;
  const cellOff = new Set(data.series.flatMap((s) => s.values.flatMap((cell, ci) =>
    cellMeta(cell)?.label === false ? [`${s.id}|${data.categories[ci]?.id}`] : [])));
  return geometry.marks.bars.some((bar) => {
    if (bar.segments) {
      const own = values.get(`|${bar.categoryId}`) ?? [];
      return own.some(droppedValue) && !own.some(shownValue);
    }
    const key = `${bar.seriesId}|${bar.categoryId}`;
    // Thinning offers no label to a grouped column at all, so a missing label counts as dropped.
    return pointsOn && !cellOff.has(key) && !(values.get(key) ?? []).some(shownValue);
  });
}

/** A band disclosure can live outside the chart. Check every frame the retry would use. */
function refreshColumnBandNote(
  first: Geometry<ColumnMarks, ColumnDerived>, before: AnomalyColumnOptions, after: AnomalyColumnOptions, axis: AxisFallback,
): boolean {
  const start = axis.noteParent, end = axis.noteEnd;
  if (!axis.on || !start?.noteFrame?.rows || !end?.noteFrame?.rows || first !== end.geometry
    || start.geometry.labels !== first.labels || staticFrame.pinned || staticFrame.live
    || before.categoryLabels === 'staircase' || before.notes || before.footnotes === false) return false;
  const previous = authoredNotes(before), notes = authoredNotes(after);
  if (previous.length > 1 || notes.length !== 1 || [...previous, ...notes].some(note => engineNoteMeta(note)?.kind !== 'disclosure' || hasBold(note))) return false;
  if (first.frame !== end.noteFrame.area.frame.frame) return false;
  const marks: (() => void)[] = [];
  // The later frame reads any metadata the opening frame fitted. A rejected
  // update must leave the ordinary layout's note registry untouched.
  const updated = withEngineNotes(() => {
    let updated: ReturnType<typeof sourceOnlyListNotes>;
    for (const pass of start === end ? [start] : [start, end]) {
      const context = pass.noteFrame!;
      const old = context.area.frame;
      const input = footerPlans.get(old.frame);
      if (!input || input.measure !== defaultMeasurer || input.credit || input.footnotesOff || input.notes
        || input.pointedNotes || input.numberedFootnotes?.length || input.unreferencedNotes?.length
        || input[COLLECT_IDENTITIES] || previous.some((note, i) => input.footnotes?.[i] !== note)) return;
      const extra = input.footnotes?.slice(previous.length) ?? [];
      if (extra.length > 2 || !extra.length || extra.some(note => engineNoteMeta(note)?.kind !== 'disclosure' || hasBold(note))
        || !extra.at(-1)!.startsWith(knownPartsLead(before))
        || extra.length === 2 && !extra[0]!.startsWith(before.strings!.valuesNotOnColumns!)) return;
      if (!context.prepared) return;
      const items = (context.options as { [SEGMENT_NOTE]?: string[] })[SEGMENT_NOTE];
      const withItems = (options: AnomalyColumnOptions) => items ? { ...withValueAxis(options), [SEGMENT_NOTE]: items } : withValueAxis(options);
      if (!sameContent(context.options, withItems(before))) return;
      const domain = { ...context.prepared.domain, options: withItems(after) };
      const valueNotes = columnValueNotes(domain);
      if (!sameContent(extra, valueNotes)) return;
      const fitted = sourceOnlyListNotes(old, [...notes, ...valueNotes]);
      if (!fitted) return;
      fitted.mark();
      marks.push(() => { columnValueNotes(domain); fitted.mark(); });
      updated = fitted;
    }
    return updated;
  }, true);
  if (!updated) return false;
  for (const mark of marks) mark();
  first.frame = updated.replace();
  if (typeof after.size === 'object') columnMidpointFloor.delete(after.size);
  return true;
}

/** The column laid out with its value notes, and again with every series keyed when an edge name lost its seat. */
function layoutColumnKeyed(data: ChartData, resolved: AnomalyColumnOptions, keepEachValue: boolean): Geometry<ColumnMarks, ColumnDerived> {
  const axis: AxisFallback = { on: false };
  const geometry = withBandValueNotes(data, resolved, next => {
    // A speculative note may be discarded in favour of the original plot. Only the original
    // pass can prove the whole midpoint short.
    if (next !== resolved && typeof next.size === 'object') columnMidpointFloor.delete(next.size);
    return layoutColumnWithNotes(data, next, keepEachValue, axis, next === resolved && typeof next.size === 'object' && measureColumnHeight.has(next.size));
  }, (first, before, after) => refreshColumnBandNote(first, before, after, axis));
  // An edge name that lost its seat leaves its series to the key: lay out again with every series keyed.
  const keyed = new Set(geometry.legend?.items.map((item) => item.id));
  const lost = geometry.labels.some((label) => label.hidden && label.id.startsWith('seriesEdge:') && !keyed.has(label.owner.seriesId!));
  const keyAsked = resolved.legend !== undefined && resolved.legend !== 'none';
  if (!lost || !keyAsked || (resolved as { [KEY_EDGE_SERIES]?: true })[KEY_EDGE_SERIES]) return geometry;
  const again = { ...resolved, [KEY_EDGE_SERIES]: true } as AnomalyColumnOptions;
  return withBandValueNotes(data, again, next => layoutColumnWithNotes(data, next, keepEachValue, axis));
}

/** The air over a callout's seat in the room a stacked100 plot makes over its columns, in px. */
const CALLOUT_SEAT_AIR = 12;

/** A ribbon chart names its series at the right edge of the last column, not in a legend. */
function ribbonDefaults(options: AnomalyColumnOptions): AnomalyColumnOptions {
  // valueAxis.percent resolves to stacked100 in the domain.
  const stacked = options.variant === 'stacked' || options.variant === 'stacked100' || Boolean(options.valueAxis?.percent);
  if (!stacked || !options.ribbons || options.seriesLabels !== undefined) return options;
  return { ...options, seriesLabels: { at: 'right-edge' } };
}

/**
 * A column the value labels leave with no number reads off the value axis, as
 * under valueLabels. Once a pass turns the axis on, the later note passes of
 * the same chart start with it.
 */
function layoutColumnWithNotes(
  data: ChartData,
  options: AnomalyColumnOptions,
  keepEachValue: boolean,
  axis: AxisFallback = { on: false },
  originalHeightTrial = false,
): Geometry<ColumnMarks, ColumnDerived> {
  if (originalHeightTrial && typeof options.size === 'object') {
    const search = columnHeightSearch.get(options.size);
    if (search && search.growthHeight === options.size.height && !search.rejectMidpoint) {
      const opening = measureStackedOpening(data, options, search);
      if (opening) throw opening;
    }
  }
  const probe: AxisProbe = { checked: false };
  const heightAxes = originalHeightTrial ? (options.valueAxis?.show === undefined ? 'auto' : 'fixed') : undefined;
  if (!axis.on) {
    // The first pass usually shows the gap already, so the settling passes are not spent on it.
    try {
      const geometry = layoutColumnSettled(data, options, keepEachValue, probe, (first) => unnumberedColumn(data, options, first), heightAxes);
      if (geometry && !unnumberedColumn(data, options, geometry)) return geometry;
    } catch (error) {
      if (error === SHORT_WITHOUT_AXIS || (error instanceof ColumnHeightTrial && options.valueAxis?.show === undefined)) {
        // The hidden-axis row is short, but its label solve could still choose the axis.
        // Check that alternative independently, then restore the usual axis decision if
        // the second geometry could fit. Neither trial can become a public result.
        const on = { ...withValueAxis(options), [PROBE_COLUMN_AXIS]: true };
        try {
          layoutColumnSettled(data, on, keepEachValue, { checked: false, otherAxis: probe.otherAxis }, undefined, heightAxes);
        } catch (other) {
          if (other === COLUMN_MIDPOINT_SHORT) throw other;
          if (error instanceof ColumnHeightTrial && other instanceof ColumnHeightTrial && error.agrees(other)) {
            const off = error.afterRefusal;
            const on = other.afterRefusal;
            error.afterRefusal = off && on && (height => {
              const first = off(height);
              const second = first && on(height);
              return first && second && first.agrees(second) ? first : undefined;
            });
            throw error;
          }
          // Even an error on the speculative axis belongs to the normal evaluator
          // only if it would actually choose that axis.
        }
        if (typeof options.size === 'object') {
          columnMidpointFloor.delete(options.size);
          const search = columnHeightSearch.get(options.size);
          if (search) delete search.growthHeight;
        }
        return layoutColumnWithNotes(data, options, keepEachValue, axis);
      }
      if (error !== AXIS_FALLBACK) throw error;
    }
    axis.on = true;
  }
  return layoutColumnSettled(data, withValueAxis(options), keepEachValue, probe, undefined, heightAxes, axis)!;
}

/** The settled column; undefined when `stopAfterFirst` says so after the first pass. */
function layoutColumnSettled(
  data: ChartData,
  options: AnomalyColumnOptions,
  keepEachValue: boolean,
  probe: AxisProbe,
  stopAfterFirst?: (geometry: Geometry<ColumnMarks, ColumnDerived>) => boolean,
  heightAxes?: 'auto' | 'fixed',
  axis?: AxisFallback,
): Geometry<ColumnMarks, ColumnDerived> | undefined {
  let named = new Map<string, string>();
  // options.categoryLabels 'staircase': the names take the height they need, or the chart falls back to the row.
  // Every re-layout settles them again, as each later pass (CAGR pad, value-line reserve, notes) moves the plot.
  let pass!: Exclude<ReturnType<typeof layoutColumnPass>, { retry: StaircaseOutcome }>;
  let minimumChrome = Infinity;
  let first = true;
  let drawCount = 0;
  const run = (next: AnomalyColumnOptions, probeAxis = false, noteParent?: ColumnPass): AnomalyColumnOptions => {
    // Only the staircase padding or fallback flag changes between these draws.
    const staircase: (ColumnStaircaseMemo & Pick<AxisProbe, 'prepared'>) | undefined = next.categoryLabels === 'staircase' ? {} : undefined;
    const shared = first && PROBE_COLUMN_AXIS in next ? probe.otherAxis : undefined;
    if (staircase && shared?.prepared) {
      const { domain, paints, warnings } = shared.prepared;
      staircase.prepared = { domain: { ...domain, options: next, va: next.valueAxis! }, paints, warnings };
      staircase.frame = shared.frame;
      staircase.plotHeightAt = shared.plotHeightAt;
    }
    if (first && heightAxes && staircase && typeof next.size === 'object') {
      const search = columnHeightSearch.get(next.size);
      if (search && !axisTests.get(search)?.has(!!next.valueAxis?.show)) staircase.heightAxes = heightAxes;
      if (search && search.growthHeight === next.size.height) staircase.growthTrial = true;
    }
    const draw = (o: AnomalyColumnOptions) => {
      drawCount++;
      const trial = layoutColumnPass(data, o, keepEachValue, first ? probe : undefined, probeAxis, staircase, noteParent);
      first = false;
      if ('retry' in trial) return trial.retry;
      // A completed draw owns its scene nodes, including the title and footer.
      if (staircase) staircase.frame = undefined;
      pass = trial;
      return pass.staircase;
    };
    const settled = settleStaircase(next, draw, draw(next));
    minimumChrome = Math.min(minimumChrome, plotChromeFloor.get(pass.geometry.frame) ?? NaN);
    return settled;
  };
  const settleBandHeadroom = (next: AnomalyColumnOptions): AnomalyColumnOptions => {
    let bandPad = (next as { [BAND_PAD]?: number })[BAND_PAD] ?? 0;
    for (let round = 0; round < 2 && pass.bandNeed > 0; round++) {
      bandPad += Math.ceil(pass.bandNeed);
      next = run({ ...next, [BAND_PAD]: bandPad } as AnomalyColumnOptions);
    }
    return next;
  };
  const noteParent = axis && NOTED_LABELS in options ? axis.noteParent : undefined;
  if (axis) axis.noteParent = undefined;
  options = run(options, stopAfterFirst !== undefined, noteParent);
  const firstBody = pass;
  if (!probe.checked && stopAfterFirst?.(pass.geometry)) return undefined;
  // A CAGR arm too low to give its arrow end the minimum shaft (MIN_LEG)
  // gets the room it lacked over the plot, and the chart is laid out again.
  for (let round = 0, pad = 0; round < 3 && pass.legDeficit > 0.5; round++) {
    pad += Math.ceil(pass.legDeficit) + 2;
    options = run({ ...options, [CAGR_PAD]: pad } as AnomalyColumnOptions);
  }
  // a right valueLine label with no seat gets the margin it needs.
  if (pass.valueLineReserve > 0) {
    options = run({ ...options, [VALUE_LINE_RESERVE]: pass.valueLineReserve } as AnomalyColumnOptions);
  }
  // The last integrated PY tick label with no seat gets the margin it needs.
  // Kept only where it seats more tick labels than it costs.
  if (pass.tickReserve > 0 && !(TICK_LABEL_RESERVE in options)) {
    const before = pass;
    const hiddenTicks = (p: typeof pass) => p.geometry.labels.filter((label) => label.kind === 'tick' && label.hidden !== undefined).length;
    const reserved = run({ ...options, [TICK_LABEL_RESERVE]: pass.tickReserve } as AnomalyColumnOptions);
    if (hiddenTicks(pass) < hiddenTicks(before)) options = reserved;
    else pass = before;
  }
  // A stacked100 plot ends at 100%, so a callout or note with no seat beside its column gets the room
  // over the plot that a stacked chart keeps for its totals. Kept only when it seats a callout.
  for (let round = 0; round < 2 && pass.unseated > 0; round++) {
    const before = pass;
    const pad = ((options as { [BAND_PAD]?: number })[BAND_PAD] ?? 0) + pass.seatNeed;
    const padded = run({ ...options, [BAND_PAD]: pad } as AnomalyColumnOptions);
    if (pass.unseated >= before.unseated) { pass = before; break; }
    options = padded;
  }
  // A grid panel stops here; other charts settle band headroom after their notes.
  if (panelTypeClass(options) !== undefined) {
    settleBandHeadroom(options);
    return pass.geometry;
  }
  // The rank mapping or the cut names go to the notes once; with the
  // footnote block off they still travel in frame.notes, for the host.
  let current = options;
  if (pass.categoryNotes.length > 0) {
    current = run({ ...options, [CATEGORY_NOTES]: pass.categoryNotes, [POINTED_NOTES]: pass.categoryNotes } as AnomalyColumnOptions);
  }
  // A note that wraps to one more line shrinks the plot and can hide one more
  // sliver, so the note is set again until it names every value the last pass
  // hid, so nothing is lost silently. Each round names at least one more value, so it
  // ends within one round per cell.
  const owed = data.series.reduce((count, series) => count + series.values.length, 0);
  const unnamed = () => [...pass.unprinted.keys()].some((id) => !named.has(id));
  const nameUnprinted = (next: AnomalyColumnOptions): AnomalyColumnOptions => {
    for (let round = 0; round <= owed && unnamed(); round++) {
      const byData = dataOrder(data, pass.geometry.labels);
      named = new Map([...named, ...pass.unprinted].sort(([a], [b]) => byData(a, b)));
      const parent = pass.noteFrame?.options === next ? pass : undefined;
      next = run({ ...next, [SEGMENT_NOTE]: [...named.values()] } as AnomalyColumnOptions, false, parent);
    }
    return next;
  };
  let last = nameUnprinted(current);
  // Staircase names that fell back on a note pass bring the row back: its rank or cut notes join then.
  if (pass.categoryNotes.length > 0) last = run({ ...last, [CATEGORY_NOTES]: pass.categoryNotes, [POINTED_NOTES]: pass.categoryNotes } as AnomalyColumnOptions);
  // A notes pass shrinks the plot, and its row can decide otherwise
  // (a cut name becomes ranks). The row then keeps ranks and prints their
  // key, so every mark on the axis has its note.
  const printed = (last as { [CATEGORY_NOTES]?: string[] })[CATEGORY_NOTES];
  if (printed && categoryNotesDiffer(pass.planNotes, printed)) {
    const keyed = pass.rankKey();
    last = run({ ...last, [CATEGORY_NOTES]: keyed, [POINTED_NOTES]: keyed, [FORCE_CATEGORY_RANKS]: true } as AnomalyColumnOptions);
  }
  last = settleBandHeadroom(last);
  // The passes after the note (staircase row, rank key, band headroom) move the plot too.
  if (unnamed()) settleBandHeadroom(nameUnprinted(last));
  for (const label of pass.geometry.labels) if (named.has(label.id) && label.hidden) label.noted = true;
  // A mark the note names with its value carries that item; fillEdges counts it once a
  // drawn footnote holds it (a counted "and 2 more" holds nothing).
  const items = new Map(pass.geometry.labels.filter((label) => named.has(label.id) && label.hidden && label.printsFor?.length !== 0)
    .map((label) => [`${label.owner.seriesId}|${label.owner.categoryId}`, named.get(label.id)!] as const));
  pass.geometry.scene = pass.geometry.scene.map((node) => {
    const item = (node.t === 'rect' || node.t === 'path') && node.separation ? items.get(`${node.owner.seriesId}|${node.owner.categoryId}`) : undefined;
    return item !== undefined && (node.t === 'rect' || node.t === 'path') && node.separation ? { ...node, separation: { ...node.separation, notedAs: item } } : node;
  });
  // Extra label notes can disappear at a taller frame; the first note-free bound still applies.
  if (Number.isFinite(minimumChrome)) plotChromeFloor.set(pass.geometry.frame, minimumChrome);
  else plotChromeFloor.delete(pass.geometry.frame);
  if (axis && !noteParent && pass.noteFrame
    && pass.geometry.labels.some(label => label.kind === 'grandTotal' && label.hidden === 'collision')) {
    if (pass.noteFrame.area.stairTop !== undefined) axis.noteParent = pass;
    // The band note starts again before the segment note. If the column kept its first
    // drawing through every note and reserve, compare that original body to the new frame.
    else if (options.categoryLabels !== 'staircase' && firstBody.geometry.labels === pass.geometry.labels) {
      axis.noteParent = firstBody;
      // Retain a footer only if there was no intervening reserve or discarded drawing.
      if (drawCount === (firstBody === pass ? 1 : 2)) axis.noteEnd = pass;
    }
  }
  return pass.geometry;
}

type AxisHeightTest = (height: number, floor: number) => boolean;
const axisTests = new WeakMap<object, Map<boolean, AxisHeightTest>>();

/**
 * The staircase missed its height cap for the current axis. In this plain
 * stack there are no other mark reserves or lost edge keys. The default frame
 * prints the source and keeps generated disclosures off the canvas. Replaying a
 * value note therefore gives the same frame, scale and numerical staircase result.
 */
function rejectShortColumnMidpoint(domain: ColumnDomain, area: ColumnArea, memo?: ColumnStaircaseMemo): void {
  const { options, size } = domain;
  const floor = options.size && typeof options.size === 'object' && columnMidpointFloor.get(options.size);
  const compact = options.mode === 'compact';
  // A compact size can use a different theme or content at another height.
  // Only reject its current midpoint after measuring the actual frame and row.
  if ((compact ? !floor || !hasCompleteTextWidths(domain.measure) : !floor && !memo?.heightAxes && !memo?.growthTrial)
    || !staircaseShortOnHeight(options) || !memo?.plotAtPad
    || !area.showCatRow || panelTypeClass(options) !== undefined
    || domain.variant !== 'stacked' || domain.activeBreak || domain.anomaly || domain.annList.length
    || domain.refSeries.length || domain.netLineOn || domain.ribbonsOn || domain.connectorsOn || area.tier
    || domain.cats.some(c => c.partial || c.footnote !== undefined) || domain.dataSeries.some(s => s.vals.some(v => v.range))
    || options.seriesLabels !== undefined || kindSetting(options, 'segment') !== false
    || options.notes !== undefined || (options.footnotes !== undefined && !(compact && Array.isArray(options.footnotes) && options.footnotes.length === 0))
    || staticFrame.pinned || staticFrame.live || area.frame.frame.notePlacement !== 'frame' || area.frame.frame.noteList?.some(n => n.kind !== 'source')
    || area.catPlan().step !== 'rotate' || area.catPlan().cutNotes.length) return;
  if (!compact && memo.heightAxes && memo.plotHeightAt && memo.rotatedHeightAt && memo.stairFailsAt && typeof options.size === 'object') {
    const search = columnHeightSearch.get(options.size);
    if (search) {
      if (!options.valueAxis?.show && memo.upperTrial) search.upperTrial = memo.upperTrial;
      const axes = axisTests.get(search) ?? new Map<boolean, AxisHeightTest>();
      const { plotHeightAt, rotatedHeightAt, stairFailsAt } = memo;
      const reason = staircaseState(options).off!;
      const shown = !!options.valueAxis?.show;
      axes.set(shown, (height, plotPx) => {
        const frameHeight = plotHeightAt(height);
        if (!stairFailsAt(frameHeight, reason)) return false;
        const rowHeight = rotatedHeightAt(frameHeight);
        // The row reserves its measured height + 8 and every column plot reserves at least 8 above it.
        return rowHeight !== undefined && Math.max(10, frameHeight - (rowHeight + 8) - 8) + 1e-6 < plotPx;
      });
      axisTests.set(search, axes);
      if (memo.heightAxes === 'fixed') search.rejectMidpoint = axes.get(shown);
      else if (axes.size === 2) search.rejectMidpoint = (height, px) => axes.get(false)!(height, px) && axes.get(true)!(height, px);
    }
  }
  // Plain fallback rows keep this plot when the label solver hides a value. The
  // non-live default frame lists generated disclosures outside the source footer.
  if (!compact && memo.growthTrial && memo.plotHeightAt && !staticFrame.live && !domain.averageMarker && !domain.pyRef
    && !domain.incompleteCats.size && !area.frame.deficit && !options.labelOffsets && !options.labelPlacements
    && !plotChromeFloor.has(area.frame.frame)) {
    const frame = area.frame.frame;
    const trial = new ColumnHeightTrial(Math.max(frame.minHeight ?? 0, frame.plotMinHeight ?? 0),
      area.plot.h, freedChromeOf(frame), partNeedOf(frame));
    const { plotHeightAt, stairFailsAt, rotatedHeightAt, rowPlotAt } = memo;
    if (trial.minimum > size.height && stairFailsAt && rotatedHeightAt && rowPlotAt && !trial.part) {
      const reason = staircaseState(options).off!;
      trial.afterRefusal = height => {
        const frameHeight = plotHeightAt(height);
        if (height <= size.height || frameHeight <= 10 || !stairFailsAt(frameHeight, reason)) return;
        const rowHeight = rotatedHeightAt(frameHeight);
        if (rowHeight === undefined) return;
        const { raw, minPlot } = rowPlotAt(frameHeight, rowHeight + 8);
        const minimum = Math.max(height + (10 - frameHeight), height + 10 - raw, height + minPlot - raw);
        return new ColumnHeightTrial(minimum, Math.max(10, raw), trial.freed, trial.part);
      };
    }
    if (memo.openingFrame) memo.openingFrame.transferable = true;
    throw trial;
  }
  if (floor && Math.ceil(size.height - area.plot.h + floor - 1e-6) > size.height) {
    throw options.valueAxis?.show === undefined ? SHORT_WITHOUT_AXIS : COLUMN_MIDPOINT_SHORT;
  }
}

/** A compact trial can use the real shown-axis plot before making its scene.
 * The hidden-axis draw has already chosen the value axis. Generated disclosures
 * stay outside the frame on this path. A winning height is always drawn normally. */
function measureCompactTrial(domain: ColumnDomain, area: ColumnArea, occupied: OccupiedIndex,
  memo: ColumnStaircaseMemo | undefined, input: ReturnType<typeof staircaseInput>): void {
  const { options, size } = domain;
  const search = typeof options.size === 'object' ? columnHeightSearch.get(options.size) : undefined;
  const binary = search?.compactMidpoint === size.height;
  const shortOpening = search?.growthHeight === size.height && area.showCatRow && area.plot.h < (search?.growthPlotNeed ?? 0);
  if ((!binary && !shortOpening) || !hasCompleteTextWidths(domain.measure) || !domain.va.show
    || domain.size.width < 280 || staticFrame.live || staticFrame.pinned || area.frame.deficit
    || plotChromeFloor.has(area.frame.frame) || domain.averageMarker || domain.activeBreak
    || domain.incompleteCats.size || domain.netLineOn || domain.refSeries.length || domain.pyRef || domain.ribbonsOn
    || domain.connectorsOn || domain.anomaly || area.axisTitle || area.ruleH || domain.variant !== 'stacked'
    || options.categoryLabels !== 'staircase' || options.seriesLabels !== undefined || options.notes || options.labelOffsets
    || options.labelPlacements || options.labelPosition || options.shareLabels || options.valueLabels || options.ratioTier || options.events
    || options.viewDomain || options.window || HOST_CLAIMS in options || domain.density === 'minimal'
    || domain.cats.some(c => c.partial || c.breakAfter || c.role || c.date || c.footnote !== undefined)
    || domain.dataSeries.some(s => s.vals.some(v => v.range || v.labelOverride !== undefined))
    || kindSetting(options, 'segment') !== false || area.frame.frame.notePlacement !== 'frame'
    || area.frame.frame.noteList?.some(n => n.inFrame && n.kind !== 'source')) return;
  const frame = area.frame.frame;
  // The narrow card retains the ordinary compact 80 px plot and frame floors.
  const minimum = Math.max(frame.minHeight ?? 0, frame.plotMinHeight ?? 0, Math.ceil(size.height + 80 - area.plot.h));
  if (minimum > size.height || partNeedOf(frame) > size.height || area.band.bandwidth < 3) return;
  if (area.showCatRow) {
    if (!staircaseShortOnHeight(options) || area.catPlan().step !== 'rotate' || area.catPlan().cutNotes.length) return;
  } else {
    const tops = input && stackPaddingProbe(domain, area, memo)?.();
    if (!input || !tops) return;
    const plan = staircaseNameSeats(input, tops.map(top => top - input.above));
    if ('failed' in plan || plan.deficit > 0.5 || staircaseState(options).pad + plan.deficit > input.cap
      || !compactStaircaseNamesFit(domain, area, occupied, plan.names)) return;
  }
  throw new ColumnHeightTrial(minimum, area.plot.h, freedChromeOf(frame), partNeedOf(frame));
}

function staircaseInput(domain: ColumnDomain, area: ColumnArea) {
  const { options } = domain;
  return area.stairTop === undefined ? undefined : {
    categories: domain.cats, band: area.band, top: area.stairTop, left: area.plot.x, right: area.plot.x + area.plot.w,
    floor: area.y0, above: options.labels !== false ? area.gtH + 4 : 0, font: area.tickFont, measure: domain.measure,
    tops: domain.posTopP, options, cap: STAIRCASE_MAX_PAD * area.frame.plot.h,
  };
}

function measureColumnStaircase(domain: ColumnDomain, area: ColumnArea, staircaseMemo: ColumnStaircaseMemo | undefined,
  stairInput: NonNullable<ReturnType<typeof staircaseInput>>): StaircaseOutcome | undefined {
  const { options } = domain;
  const probe = stackPaddingProbe(domain, area, staircaseMemo);
  if (probe && staircaseMemo?.heightAxes && staircaseMemo.scaleAt && staircaseState(options).pad === 0) {
    const { scaleAt } = staircaseMemo;
    const paddingAt = (frameHeight: number, base: NonNullable<ReturnType<typeof scaleAt>>) =>
      probeStaircasePadding({ ...stairInput, cap: STAIRCASE_MAX_PAD * frameHeight }, pad =>
        probe(undefined, pad === undefined ? base : scaleAt(frameHeight, pad)!));
    staircaseMemo.stairFailsAt = (frameHeight, reason) => {
      const base = scaleAt(frameHeight, 0);
      if (!base) return false;
      const result = paddingAt(frameHeight, base);
      return result?.failed === reason || result?.next?.off === reason;
    };
    const heightOf = staircaseMemo.plotHeightAt;
    const claims = staircaseMemo.frame?.claims;
    const block = area.frame.plot;
    const frame = area.frame.frame;
    if (!domain.va.show && !domain.incompleteCats.size && !domain.averageMarker && !staticFrame.live
      && !options.labelOffsets && !options.labelPlacements && !plotChromeFloor.has(frame) && !partNeedOf(frame)
      && heightOf && claims && !area.frame.deficit && stairInput.top === block.y && area.band.bandwidth >= 3
      && claims.every(({ rect }) => rect.y + rect.h <= block.y || rect.y >= block.y + block.h - 1e-6)) {
      const topContentBottom = Math.max(0, ...claims.map(({ rect }) => rect.y + rect.h <= block.y ? rect.y + rect.h : 0));
      const minPlot = plotFloorRows(options) * domain.measure('0', area.labelFont).height + 8;
      const freed = freedChromeOf(frame);
      staircaseMemo.upperTrial = height => {
        const frameHeight = heightOf(height);
        const base = scaleAt(frameHeight, 0);
        if (!base) return;
        const result = paddingAt(frameHeight, base);
        if (result?.failed || result?.next?.off) return;
        const pad = result?.next?.pad ?? 0;
        const scaled = pad === 0 ? base : scaleAt(frameHeight, pad)!;
        if (scaled.plot.h < minPlot) return;
        const tops = probe(undefined, scaled);
        if (!tops) return;
        const seats = staircaseNameSeats(stairInput, tops.map(top => top - stairInput.above));
        if ('failed' in seats || seats.deficit > 0.5 || pad + seats.deficit > STAIRCASE_MAX_PAD * frameHeight) return;
        const upperFrame = { ...area.frame, plot: { ...block, h: frameHeight } };
        // Only the coordinates read by the seat checks change. No scene or footer is made here.
        const upper = Object.assign(Object.create(area) as ColumnArea, scaled, { topPad: 8 + pad, frame: upperFrame });
        if (!stackedStaircaseSeatsFit(domain, upper, height, seats.names, topContentBottom)) return;
        const minimum = Math.max(height + (10 - frameHeight), height + 10 - scaled.plot.h,
          height + minPlot - scaled.plot.h);
        return new ColumnHeightTrial(minimum, scaled.plot.h, freed, 0);
      };
    }
  }
  return probe && probeStaircasePadding(stairInput, probe);
}

/** Measure the opening's failed staircase and rotated row without laying out marks or the row's labels. */
function measureStackedOpening(data: ChartData, options: AnomalyColumnOptions, search: NonNullable<ReturnType<typeof columnHeightSearch.get>>) {
  if (options.variant !== 'stacked' || options.categoryLabels !== 'staircase' || options.valueAxis?.show !== undefined
    || options.valueAxis?.percent || options.seriesLabels || options.window || options.viewDomain || options.ratioTier
    || options.annotations?.length || options.mode === 'compact' || options.notes !== undefined || options.footnotes !== undefined
    || options.labelOffsets || options.labelPlacements || staticFrame.live || staticFrame.pinned || panelTypeClass(options) !== undefined) return;
  const warnings: LintWarning[] = [];
  const domain = resolveColumnDomain(data, options, warnings);
  if (domain.options !== options || !isCachedTextMeasurer(domain.measure) || kindSetting(options, 'segment') !== false
    || domain.activeBreak || domain.anomaly || domain.averageMarker || domain.refSeries.length || domain.netLineOn
    || domain.pyRef || domain.ribbonsOn || domain.connectorsOn || domain.incompleteCats.size || domain.annList.length
    || domain.cats.some(c => c.partial || c.footnote !== undefined || c.date !== undefined || c.role === 'total' || c.breakAfter)
    || domain.dataSeries.some(s => s.vals.some(v => v.range))) return;
  const paints = columnPaints(domain, warnings);
  if (warnings.length) return;
  const first: ColumnStaircaseMemo = { heightAxes: 'auto', growthTrial: true, measureOpening: true };
  const axis = (d: ColumnDomain, memo: ColumnStaircaseMemo) => {
    const { frame } = solveColumnFrame(d, paints, warnings, undefined, memo);
    if (!memo.plotHeightAt || frame.deficit || frame.frame.notePlacement !== 'frame'
      || frame.frame.noteList?.some(n => n.kind !== 'source') || plotChromeFloor.has(frame.frame) || partNeedOf(frame.frame)) return;
    const area = columnPlotArea(d, frame, warnings, undefined, memo);
    const input = staircaseInput(d, area);
    if (!input || !memo.prepareFallbackRow || warnings.length) return;
    const state = nextStaircase(d.options, measureColumnStaircase(d, area, memo, input));
    if (!state?.off || !staircaseShortOnHeight({ [STAIRCASE]: state }) || !memo.stairFailsAt) return;
    memo.prepareFallbackRow();
    const { plotHeightAt, rotatedHeightAt, rowPlotAt, stairFailsAt } = memo;
    if (!rotatedHeightAt || !rowPlotAt) return;
    const reason = state.off, freed = freedChromeOf(frame.frame);
    const measure = (height: number, initial = false) => {
      const frameHeight = plotHeightAt(height);
      if (frameHeight <= 10 || !initial && !stairFailsAt(frameHeight, reason)) return;
      const row = rotatedHeightAt(frameHeight);
      if (row === undefined) return;
      const { raw, minPlot } = rowPlotAt(frameHeight, row + 8);
      return new ColumnHeightTrial(Math.max(height + (10 - frameHeight), height + 10 - raw, height + minPlot - raw),
        Math.max(10, raw), freed, 0);
    };
    const firstTrial = measure(d.size.height, true);
    if (!firstTrial || firstTrial.minimum <= d.size.height) return;
    const reject: AxisHeightTest = (height, floor) => {
      const frameHeight = plotHeightAt(height);
      if (!stairFailsAt(frameHeight, reason)) return false;
      const row = rotatedHeightAt(frameHeight);
      return row !== undefined && Math.max(10, frameHeight - (row + 8) - 8) + 1e-6 < floor;
    };
    return { firstTrial, measure, reject };
  };
  const without = axis(domain, first);
  if (!without || !first.narrowGutters || !first.upperTrial) return;
  // These gutters were already narrowed before the value-axis labels took their share.
  const on = withValueAxis(options);
  const shown = axis({ ...domain, options: on, va: on.valueAxis! }, {
    heightAxes: 'auto', growthTrial: true, measureOpening: true, frame: first.frame, plotHeightAt: first.plotHeightAt,
  });
  if (!shown || !without.firstTrial.agrees(shown.firstTrial)) return;
  const trial = without.firstTrial;
  trial.afterRefusal = height => {
    const a = without.measure(height), b = a && shown.measure(height);
    return a && b && a.agrees(b) ? a : undefined;
  };
  search.rejectMidpoint = (height, floor) => without.reject(height, floor) && shown.reject(height, floor);
  search.upperTrial = first.upperTrial;
  if (first.openingFrame) first.openingFrame.transferable = true;
  return trial;
}

interface ColumnPass {
  geometry: Geometry<ColumnMarks, ColumnDerived>;
  unprinted: Map<string, string>;
  categoryNotes: string[];
  planNotes: string[];
  rankKey: () => string[];
  legDeficit: number;
  bandNeed: number;
  valueLineReserve: number;
  tickReserve: number;
  unseated: number;
  seatNeed: number;
  staircase?: StaircaseOutcome;
  noteFrame?: { rows?: ColumnNoteRows; options: AnomalyColumnOptions; prepared?: AxisProbe['prepared']; area: ColumnArea; claims: OccupiedClaim[]; warnings: LintWarning[] };
}

interface KeyedColumnBody {
  options: object;
  pass: ColumnPass;
}

/** The caller can mark labels as noted and change the selected geometry during sizing. */
function copyColumnBody(pass: ColumnPass, area: ColumnArea): ColumnPass {
  return { ...pass, geometry: { ...copyFitDrawing(pass.geometry), frame: area.frame.frame, legend: area.frame.legend } };
}

function layoutColumnPass(
  data: ChartData,
  options: AnomalyColumnOptions,
  keepEachValue: boolean,
  axisProbe?: AxisProbe,
  probeAxis = false,
  staircaseInputs?: Pick<AxisProbe, 'prepared'> & ColumnStaircaseMemo,
  noteParent?: ColumnPass,
): ColumnPass | { retry: StaircaseOutcome } {
  // The direct retry adds only the segment note consumed by the frame.
  const note = noteParent?.noteFrame;
  const retry = staircaseInputs?.prepared ?? note?.prepared;
  const lifts = zeroLifts.count;
  const prepared = retry ?? axisProbe?.prepared;
  if (axisProbe) axisProbe.prepared = undefined;
  const warnings: LintWarning[] = prepared ? [...prepared.warnings] : [];
  // A stacked axis retry retains the original option fields. A grouped
  // domain may carry rewritten options from its data window.
  const domain = retry ? { ...retry.domain, options }
    : prepared ? { ...prepared.domain, options: prepared.domain.variant === 'stacked' ? options
      : { ...prepared.domain.options, valueAxis: options.valueAxis }, va: options.valueAxis! }
    : resolveColumnDomain(data, options, warnings);
  const paints = prepared?.paints ?? columnPaints(domain, warnings);
  // A live window or share plan can rewrite the options. Rebuild those cases
  // so their private options are retained. A break can be dropped on one draw.
  if (staircaseInputs && !retry && domain.options === options) {
    staircaseInputs.prepared = { domain: { ...domain }, paints, warnings: [...warnings] };
  }
  const preparedWarnings = warnings.length;
  const reusablePreparation = domain.options === options && !domain.activeBreak && zeroLifts.count === lifts;
  const fallback = () => {
    axisProbe!.prepared = { domain, paints, warnings: warnings.slice(0, preparedWarnings) };
    throw AXIS_FALLBACK;
  };
  const { size, theme } = domain;
  // Grouped values cannot return after the solver. Stacks have late digit seats;
  // ratio badges, running periods and staircase retries can change what counts.
  const probe = probeAxis && options.valueAxis?.show === undefined && panelTypeClass(options) === undefined
    && domain.variant === 'grouped' && kindSetting(options, 'point') !== false && !options.ratioTier
    && options.categoryLabels !== 'staircase' && !domain.cats.some(c => c.partial)
    && !domain.annList.some(a => a.kind === 'event');
  const beforeCategoryRow = probe && domain.dataSeries.length > 1 ? (bandwidth: number) => {
    const font = compactValueLabelFont({ family: theme.type.family, ...theme.type.label }, theme.type.footnote, options.target, textScaleOf(options));
    if (!groupedValueLabelPolicy('vertical', groupedOffsets(bandwidth, domain.dataSeries.length)[0]!.size,
      domain.dataSeries.length, [], theme.type.label.size, font.size).firstSeriesOnly) return;
    const off = new Set(data.series.flatMap(s => s.values.flatMap((cell, ci) =>
      cellMeta(cell)?.label === false ? [`${s.id}|${data.categories[ci]?.id}`] : [])));
    // Rotation can only narrow this band. Thinned, unprotected values have no
    // request to solve, so the completed pass would turn the axis on too.
    if (domain.dataSeries.slice(1).some(s => !domain.highlights.has(s.id) && domain.cats.some((c, ci) =>
      domain.plottedOf(s, ci) !== null && !off.has(`${s.id}|${c.id}`) && !domain.highlights.has(c.id)
      && !domain.anomaly?.flagByCategory.has(c.id)))) fallback();
  } : undefined;
  // The frame is the first claimer, so its index becomes the run's index.
  // The event lane sizes itself and the key with the frame and plot passes.
  const staircaseMemo = staircaseInputs?.prepared && isCachedTextMeasurer(domain.measure) ? staircaseInputs : undefined;
  // A direct segment-note retry has the same header, margins and series key.
  // Its footer still uses the current disclosure, and its claims are replayed in order.
  const noteRows = note?.rows ?? (domain.incompleteCats.size && domain.variant === 'stacked' && domain.measure === defaultMeasurer
    && !domain.annList.length && !options.notes && !options.seriesLabels && options.categoryLabels !== 'staircase'
    && !staircaseMemo && !(COLLECT_IDENTITIES in options) ? { rows: {} } : undefined);
  let areaWarningsAt = 0;
  const settled = settleEventLane({
    annotations: domain.annList, categories: domain.cats, events: options.events, language: options.locale?.language,
    colorblindSafe: options.colorblindSafe, inline: false, footnotesOff: (options as InternalFootnoteOptions).footnotesOff,
    theme, measure: domain.measure, size, compact: options.mode === 'compact',
    solve: (key, w) => solveColumnFrame(domain, paints, w, key, staircaseMemo, noteRows),
    area: (framed, w) => {
      areaWarningsAt = w.length;
      return columnPlotArea(domain, framed.frame, w, beforeCategoryRow, staircaseMemo, note?.prepared ? note.area : undefined);
    },
    axis: (area) => ({ x: (ci) => area.band.center(ci), step: area.band.step, plot: area.plot }),
    warnings,
  });
  const framed = settled.framed;
  const occupied = framed.claims;
  let area = settled.area;
  if (domain.activeBreak && domain.variant !== 'grouped' && stackBreakReversesOrder(area.y, domain.stacks)) {
    domain.activeBreak = undefined;
    // The frame has no break note; only the plot's total row and scale change.
    delete framed.frame.frame.plotMinHeight;
    plotChromeFloor.delete(framed.frame.frame);
    warnings.length = areaWarningsAt;
    area = columnPlotArea(domain, framed.frame, warnings);
    warnings.push(axisBreakHeightOrderWarning());
  }
  // The opening plain stack has the same data domain and colours whichever axis the
  // value labels choose. If its gutters are already narrow, adding the value axis cannot
  // narrow them again. The axis still gets its own column bands, wrapping and scale.
  if (axisProbe && staircaseMemo?.heightAxes === 'auto' && staircaseInputs?.prepared && !domain.va.show
    && domain.variant === 'stacked' && !domain.activeBreak && !domain.pyRef && !domain.refSeries.length
    && !domain.annList.length && !domain.anomaly && !domain.ribbonsOn && !domain.netLineOn
    && !domain.connectorsOn && !options.seriesLabels && !options.window && !options.viewDomain
    && !domain.cats.some(c => c.partial || c.footnote !== undefined)) {
    axisProbe.otherAxis = { prepared: staircaseInputs.prepared,
      ...(staircaseMemo.narrowGutters && staircaseMemo.plotHeightAt ? {
        frame: staircaseMemo.frame, plotHeightAt: staircaseMemo.plotHeightAt,
      } : {}) };
  }
  rejectShortColumnMidpoint(domain, area, staircaseMemo);
  // A segment note can live outside the drawing. Make its actual frame first.
  // Only this direct retry owns the previous body, and only if its drawing space is unchanged.
  const staircaseNote = area.stairTop !== undefined && options.mode === 'compact' && domain.va.show === true
    && kindSetting(options, 'segment') === false && !area.ruleH && !domain.pyRef
    && !domain.dataSeries.some(s => s.vals.some(v => v.range || v.labelOverride !== undefined));
  // A registry note can repeat the entire height search. Keep separate bodies for each
  // fixed size and internal note pass when the legend already names every series.
  const keyed = domain.variant === 'stacked' && options.seriesLabels?.at === 'right-edge'
    && options.categoryLabels !== 'staircase' && !options.window && !options.viewDomain
    && !options.seriesLabels.cagr && !domain.seriesCagr.size && panelTypeClass(options) === undefined
    && !(COLLECT_IDENTITIES in options) && area.frame.legend !== undefined
    && domain.dataSeries.every(series => area.frame.legend!.items.some(item => item.id === series.id))
    && !rightEdgeSeriesLabels(domain).length;
  // A segment disclosure on an incomplete stack can leave the bars and their labels in place.
  // Compare the actual frame and claims below before keeping the previous drawing.
  const offCanvasMissing = domain.incompleteCats.size > 0 && !options.notes && !options.seriesLabels
    && options.categoryLabels !== 'staircase' && panelTypeClass(options) === undefined;
  const noteFrame = domain.variant === 'stacked' && (keyed || domain.cats.length > 12 && !options.seriesLabels) && hasCompleteTextWidths(domain.measure)
    && !(HOST_CLAIMS in options) && !domain.activeBreak && !domain.annList.length && !domain.averageMarker
    && !domain.anomaly && !domain.refSeries.length && !domain.netLineOn && !domain.ribbonsOn && !domain.connectorsOn
    && !options.shareLabels && !area.tier
    && (staircaseNote || options.categoryLabels !== 'staircase' && (offCanvasMissing || !(typeof options.size === 'object' && measureColumnHeight.has(options.size))))
    && !domain.cats.some(c => c.partial || c.footnote !== undefined) && (!domain.incompleteCats.size || offCanvasMissing)
    && !domain.uniformScenario.size
    ? { options, area, rows: noteRows, claims: occupied.snapshot(), warnings: warnings.slice(),
      prepared: reusablePreparation ? { domain, paints, warnings: warnings.slice(0, preparedWarnings) } : undefined } : undefined;
  const measuredBody = typeof options.size === 'object' && measureColumnHeight.has(options.size);
  const bodies = (keyed || offCanvasMissing && domain.va.show === true && !measuredBody
    && !(COLLECT_IDENTITIES in options) && !options.window && !options.viewDomain) && noteFrame && !noteParent && reusablePreparation
    ? requestMemo<KeyedColumnBody[]>(data, `column-note:${size.width}:${size.height}:${keepEachValue}:${probeAxis}:${layoutStepKey()}:${currentSmallValues()}:${formatScopeKey(options)}`, () => []) : undefined;
  const bodyOptions = bodies && (offCanvasMissing ? comparableOptions(hiddenNoteBodyOptions(options)) : hiddenNoteBodyOptions(options));
  const saved = bodyOptions && NOTED_LABELS in options ? bodies?.find(entry => sameContent(entry.options, bodyOptions)) : undefined;
  const parent = noteParent ?? saved?.pass;
  const before = parent?.noteFrame;
  if (before && noteFrame && (!staircaseNote || sameContent(staircaseState(before.options), staircaseState(options)))
    && sameContent(before.area.frame.plot, area.frame.plot) && sameContent(before.area.plot, area.plot)
    && sameContent(before.area.frame.nodes, area.frame.nodes) && sameContent(before.area.frame.legend, area.frame.legend)
    && sameContent(before.claims, noteFrame.claims) && sameContent(before.warnings, warnings)
    && area.band.step === before.area.band.step && area.band.bandwidth === before.area.band.bandwidth
    && sameContent(before.area.y.domain, area.y.domain) && sameContent(before.area.y.range, area.y.range)) {
    const geometry = saved ? copyColumnBody(saved.pass, area).geometry
      : { ...parent.geometry, frame: area.frame.frame, legend: area.frame.legend };
    if (measuredColumnHeights.has(parent.geometry)) measuredColumnHeights.add(geometry);
    return { ...parent, geometry, noteFrame };
  }
  const testingAxis = PROBE_COLUMN_AXIS in options;
  if (testingAxis && area.stairTop === undefined) throw AXIS_PROBE_INCONCLUSIVE;
  const measuring = typeof options.size === 'object' && measureColumnHeight.has(options.size)
    && !area.tier && !domain.annList.length && isCachedTextMeasurer(domain.measure);
  const measureSegments = measuring && !domain.activeBreak && !domain.anomaly && !domain.averageMarker
    && !domain.refSeries.length && kindSetting(options, 'segment') === false
    && !domain.cats.some(c => c.partial) && domain.dataSeries.every(s => s.vals.every(cell => cell.labelOverride === undefined && !cell.range));
  const stairInput = staircaseInput(domain, area);
  // The staircase already measured every padding round. Only its accepted state on
  // this same band and frame can paint in one pass; the real label solver still runs.
  const accepted = staircaseMemo?.acceptedPad;
  const ready = !!accepted && accepted.state === staircaseState(options) && accepted.block === area.frame.plot && accepted.band === area.band;
  const retryStair = !ready && stairInput && measureColumnStaircase(domain, area, staircaseMemo, stairInput);
  if (retryStair) {
    if (!measuring && !testingAxis && staircaseMemo && retryStair.next && !retryStair.next.off) {
      staircaseMemo.acceptedPad = { state: retryStair.next, block: area.frame.plot, band: area.band };
    }
    return { retry: retryStair };
  }
  if (measuring && options.mode === 'compact') measureCompactTrial(domain, area, occupied, staircaseMemo, stairInput);
  // When every segment is suppressed, an omitted total leaves that column with no number.
  // Digit seats, replacement values and annotations can still give a suppressed segment a number.
  const probeStack = probeAxis && options.valueAxis?.show === undefined && panelTypeClass(options) === undefined
    && domain.variant === 'stacked' && hasCompleteTextWidths(domain.measure) && !(HOST_CLAIMS in options)
    && !area.tier && !domain.annList.length && !domain.refSeries.length && !domain.anomaly
    && (options.categoryLabels !== 'staircase' || area.showCatRow) && !domain.cats.some(c => c.partial)
    && !options.labelPlacements && !options.labelOffsets;
  const needAxis = () => {
    if (axisProbe && reusablePreparation) fallback();
    throw AXIS_FALLBACK;
  };
  // A missing part cannot link its segment to the total when every stack has
  // two drawn parts. One too-wide segment and one omitted total then require the axis.
  if (probeStack && area.band.bandwidth < INSIDE_MIN_W && options.categoryLabels !== 'staircase' && !domain.activeBreak
    && !domain.netLineOn && !domain.ribbonsOn && !domain.connectorsOn && !domain.pyRef
    && !options.shareLabels && !options.window && !options.viewDomain && !options.seriesLabels && !domain.averageMarker
    && domain.cats.length % 2 === 0 && domain.stacks[0]?.segments[0]?.value
    && domain.dataSeries.every(s => s.vals.every(cell => cell.labelOverride === undefined && !cell.range))
    && domain.stacks.every(stack => stack.segments.filter(part => part && part.value !== 0).length > 1)) {
    const part = domain.stacks[0]!.segments[0]!;
    const first = { s: domain.dataSeries[0]!, si: 0, c: domain.cats[0]!, ci: 0, v: part.value,
      rect: stackSegmentRect(area.band.position(0), area.band.bandwidth, area.y, part.start, part.end) };
    // An optional probe must not add a rounding warning for a label it tried.
    const before = zeroLifts.count;
    try {
      if (firstSegmentHidesRow(domain, area, first)) {
        planColumnTotals(domain, area, { bars: [first] }, [], () => {
          if (zeroLifts.count === before) needAxis();
        });
      }
    } finally { zeroLifts.count = before; }
  }
  const scene = layoutColumnMarks(domain, paints, area, occupied, planTickEnds(domain, area), measureSegments, ready);
  // the value-axis title is a label in the head band, solved first.
  const requests: LabelRequest[] = area.axisTitle && domain.va.show
    ? [valueAxisTitleRequest(area.axisTitle, { x: area.frame.plot.x, y: area.frame.plot.y + area.ruleH + 4 }, 'start', 'axis:y:title')]
    : [];
  const tierState = area.tier
    ? addRatioTierRequests(area.tier, requests, {
        plot: area.plot,
        categoryBandHeight: area.catBandH,
        categoryCenter: (categoryId) => area.band.center(domain.cats.findIndex((cat) => cat.id === categoryId)),
        theme,
        measure: domain.measure,
      })
    : undefined;
  const stair = stairInput && seatStaircase({ ...stairInput, occupied, requests });
  // With no running-period key to change the frame, a failed or short staircase already
  // determines the next pass. Its other labels, marks and warnings will be discarded.
  if (stair && domain.annList.length === 0 && !domain.cats.some(c => c.partial)
    && isCachedTextMeasurer(domain.measure)) {
    if ('failed' in stair) return { retry: { deficit: 0, failed: stair.failed } };
    if (stair.deficit > 0.5) return { retry: { deficit: stair.deficit } };
  }
  if (testingAxis) throw AXIS_PROBE_INCONCLUSIVE;
  if (scene.paintStack) scene.nodes = scene.paintStack(!measureSegments);
  const noted = { items: new Map<string, string>(), slivers: new Set<string>() };
  const digits: DigitSeats = { requests: [], slivers: [], warningAt: 0 };
  const labelWarnings: LintWarning[] = [];
  // At the smallest font one wide value hides the entire segment row. When
  // every drawn stack has multiple parts and no authored value label, no total can
  // inherit a segment and no digit seat survives. Test the totals immediately.
  const testTotals = probeStack ? () => {
    if (scene.marks.bars.every(bar => (bar.segments?.length ?? 0) > 1)
      && domain.dataSeries.every(series => series.vals.every(cell => cell.labelOverride === undefined))) {
      planColumnTotals(domain, area, scene, [], needAxis);
    }
  } : undefined;
  const pointFont = planColumnValueLabels(domain, paints, area, scene, requests, warnings, noted, digits, testTotals);
  const checkOmitted = probeStack && !digits.requests.length
    && requests.every(req => req.kind !== 'segment' || (req.redundant && !req.printedIn && req.pinnedSlot === undefined));
  const { growthPoints, namedExtreme } = planColumnLabels(domain, area, scene, requests, labelWarnings, checkOmitted ? needAxis : undefined);
  const solveCtx: SolveCtx = labelCtx(theme, size, options, {
    density: domain.density,
    measure: domain.measure,
    plot: area.plot,
    labelPad: COLUMN_LABEL_PAD,
    // A histogram keeps each fitting count, even when other bins need a note.
    // values valueLabels picks are no scatter; each one that cannot sit goes to the note alone.
    seriesUniform: keepEachValue || pickedValues(domain.options) ? undefined : bandValueLabelUniformity(),
  });
  positionColumnLabels(domain, paints, scene, requests);
  // A finished staircase fallback row with a missing sole total already needs the value axis.
  // Keep every earlier seat and collision decision. Late digit seats, annotations and running periods can still change the answer.
  const checkTotal = probeAxis && options.valueAxis?.show === undefined && panelTypeClass(options) === undefined
    && domain.variant === 'stacked' && options.categoryLabels === 'staircase' && area.showCatRow
    && !tierState && digits.requests.length === 0 && domain.annList.length === 0 && !domain.cats.some(c => c.partial)
    && isCachedTextMeasurer(domain.measure) ? (label: PlacedLabel) => {
      const id = label.owner.categoryId;
      if (label.kind === 'grandTotal' && droppedValue(label) && scene.marks.bars.some(bar => bar.categoryId === id && bar.segments)
        && requests.filter(request => request.owner.categoryId === id && columnValue(request)).length === 1) throw AXIS_FALLBACK;
    } : undefined;
  const solved = solveLabels(keepValuesWithoutAxis(requests, domain.density, domain.va.show === true), occupied, solveCtx, checkTotal);
  if (namedExtreme) seatExtremeValue(domain, area, namedExtreme, solved, occupied, solveCtx);
  // A running period keeps a cue: a to-date value without a seat, or words wider than the drawn column, bring the hatch key back.
  const toDate = toDateOnValues(domain);
  if (toDate.size > 0 && (!toDateFits(domain.options.strings?.toDate ?? chartString(domain.options, 'toDate'), theme, domain.measure, toDateRoom(area.band.bandwidth))
    || solved.placed.some((l) => (l.kind === 'grandTotal' || l.kind === 'point') && l.hidden !== undefined && toDate.has(l.owner.categoryId ?? '')))) {
    return layoutColumnPass(data, { ...options, [PARTIAL_KEY]: true } as AnomalyColumnOptions, keepEachValue);
  }
  if (probe) {
    axisProbe!.checked = true;
    if (unnumberedColumn(data, options, { labels: solved.placed, marks: scene.marks })) fallback();
  }
  // Adjacency and its paint-rule positions precede the label warnings on a completed draw.
  const paintWarningRules: PaintWarningRule[] = [];
  if (!measuring) pushAll(warnings, rectSeriesAdjacentWarnings(scene.nodes, paints.css, 'vertical', domain.highlights, theme, { rules: paintWarningRules, before: warnings.filter(warning => !['pie-ramp-crowded', 'likert-ramp-invisible', 'band-lightness-insufficient', 'series-adjacent-similar', 'highlight-reads-as-loss'].includes(warning.code)).length }));
  pushAll(warnings, labelWarnings);
  const staircase = runStaircase(theme, options.categoryLabels, options, stair, solved.placed, occupied, scene.nodes, warnings);
  applyValueAxisTitleInk(solved.placed);
  const crossed = measuring ? undefined : haloOverRules(solved.placed, occupied, new Set(['referenceLine', 'valueLine']));
  pushAll(warnings, solved.warnings);
  for (const point of growthPoints) {
    const growthLabel = solved.placed.find((label) => label.id === point.growthLabelId);
    if (growthLabel && !growthLabel.hidden) {
      growthLabel.ink =
        point.tone === 'neutral'
          ? { token: 'inkMuted' }
          : options.colorblindSafe
            ? colorblindPaint(point.tone)
            : { token: point.tone };
    }
  }
  // Reference values read muted, the integrated PY ticks with or without growth labels.
  for (const label of solved.placed) if (label.id.startsWith('tick:') && !label.hidden) label.ink = { token: 'inkMuted' };
  // An edge series name prints at the heading weight it was measured with.
  for (const label of solved.placed) if (label.id.startsWith('seriesEdge:')) label.font = edgeNameFont(label.font ?? area.labelFont, domain);
  const ratioTierResult = tierState
    ? finalizeRatioTier(tierState, solved.placed, occupied, theme, domain.measure)
    : undefined;
  if (ratioTierResult) pushAll(scene.nodes, ratioTierResult.nodes);
  pushAll(warnings, ratioTierSpacingWarnings(area.tier, solved.placed));
  const annotated = annotateColumn(domain, area, scene, occupied, solveCtx, solved.placed);
  pushAll(warnings, annotated.warnings);
  const lane = settled.lane
    ? emitEventLane(theme, {
        ...settled.lane,
        axis: { x: (ci) => area.band.center(ci), step: area.band.step, plot: area.plot },
        mode: 'stop', baseline: area.plot.y + area.plot.h, occupied, solveCtx,
      })
    : undefined;
  if (lane) pushAll(warnings, lane.warnings);
  // A segment an authored callout or note points at is named there already.
  const pointedAt = new Set((options.annotations ?? []).flatMap((a) =>
    (a.kind === 'callout' || a.kind === 'note') && typeof a.at === 'object' && 'categoryId' in a.at && a.at.seriesId
      ? [`segment:${a.at.seriesId}:${a.at.categoryId}`] : []));
  // A grid panel names no value in its own note (its grid does), nor does a chart name one a callout points at.
  const inPanel = panelTypeClass(options) !== undefined;
  seatDigits(digits, solved, occupied, solveCtx, warnings, paintWarningRules, (id) => !inPanel && !pointedAt.has(id),
    [...scene.nodes, ...annotated.nodes, ...(lane?.nodes ?? [])]);
  const unprinted = new Map<string, string>();
  if (noted.items.size) {
    const hiddenIds = new Set<string>();
    for (const label of solved.placed) {
      if (label.hidden === 'collision' || (label.hidden !== undefined && label.printedIn === undefined && noted.slivers.has(label.id))) {
        hiddenIds.add(label.id);
      }
    }
    // Keep the note in data order, including only values that no callout names.
    for (const [id, text] of noted.items) {
      if (hiddenIds.has(id) && !pointedAt.has(id)) unprinted.set(id, text);
    }
  }
  const geometry = assembleColumnGeometry(domain, area, scene, solved, annotated, tierState, pointFont, growthPoints, ratioTierResult, occupied, warnings, paintWarningRules, lane, measuring);
  if (crossed) geometry.scene = raiseOverRules(geometry.scene, crossed);
  if (measuring) measuredColumnHeights.add(geometry);
  const planNotes = !area.showCatRow ? []
    : area.catPlan().step === 'ranks' ? rankNotes(domain.cats.map((c) => c.label ?? c.id), domain.options) : area.catPlan().cutNotes;
  const categoryNotes = (options as { [CATEGORY_NOTES]?: string[] })[CATEGORY_NOTES] ? [] : planNotes;
  // measured in the bold label font the valueLine text is drawn in.
  const valueLineReserve = hiddenValueLineReserve(geometry.labels, (text) => domain.measure(text, { ...area.labelFont, weight: emphasisWeight(domain.theme) }).width, size.width);
  const lastCategory = domain.cats.at(-1);
  const lastTick = domain.pyRef && lastCategory
    ? geometry.labels.find((label) => label.id === `tick:${domain.pyRef!.id}:${lastCategory.id}` && (label.hidden === 'collision' || label.hidden === 'note'))
    : undefined;
  // How far the label, right of its tick, would reach past the canvas (2 px spare),
  // never more than a third of the canvas.
  const lastBar = lastTick && lastCategory ? area.band.position(domain.cats.length - 1) + area.band.bandwidth : 0;
  const tickReserve = lastTick ? Math.max(0, Math.ceil(lastBar + PY_TICK_LEAD + domain.measure(lastTick.text, area.tickFont).width + 2 - size.width)) : 0;
  const rankKey = () => rankNotes(domain.cats.map((c) => c.label ?? c.id), domain.options);
  // An authored callout or note that found no seat on a stacked100 chart, whose plot ends at 100% with nothing above it.
  const unseatedLabels = domain.variant === 'stacked100'
    ? annotated.placed.flatMap((entry) => (entry.kind === 'callout' || entry.kind === 'note') && entry.labelId !== undefined
      ? geometry.labels.filter((label) => label.id === entry.labelId && label.hidden !== undefined) : [])
    : [];
  const seatNeed = Math.ceil(maxOf(unseatedLabels.map((label) => label.rect.h))) + CALLOUT_SEAT_AIR;
  const pass: ColumnPass = { geometry, unprinted, categoryNotes, planNotes, rankKey, noteFrame, legDeficit: annotated.legDeficit, bandNeed: annotated.bandNeed, valueLineReserve, tickReserve: tickReserve <= size.width / 3 ? tickReserve : 0, unseated: unseatedLabels.length, seatNeed: unseatedLabels.length > 0 ? seatNeed : 0, ...(staircase ? { staircase } : {}) };
  if (bodies && bodyOptions && !(NOTED_LABELS in options) && zeroLifts.count === lifts
    && geometry.labels.some(label => label.hidden && !label.noted)) {
    bodies.push({ options: bodyOptions, pass: copyColumnBody(pass, area) });
  }
  return pass;
}
