import { pickedValues, withValueLabelDefaults } from '../band/valueSelection';
import { sk, stackParts } from '../band/stacks';
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

import { BAND_PAD, hiddenValueLineReserve, VALUE_LINE_RESERVE } from '../../annotateParts';
import { applyValueAxisTitleInk, valueAxisTitleRequest } from '../../axis';
import { rectSeriesAdjacentWarnings } from '../../adjacentSeries';
import { PARTIAL_KEY, partialIds, toDateFits, toDateRoom } from '../../partialPeriod';
import type { AnchorResolution, AnnotatePassResult } from '../../annotate';
import { NOT_AVAILABLE } from '../../format';
import { NO_STACK_TOTAL } from '../../stackAdds';
import { emitEventLane, percentLevels, runAnnotatePass, settleEventLane } from '../../annotatePass';
import { categoryTargetFields, spliceAnnotationNodes } from '../../annotateFields';
import { segmentHitsRect, type Rect } from '../../geometry';
import { linePath } from '../../svgPath';
import { labelsToNodes } from '../../label/emit';
import type { OccupiedIndex } from '../../label/occupied';
import { labelCtx, leaderTerminus, solveLabels, type LabelRequest, type SolveCtx, type SolveResult } from '../../label/solver';
import { DIGIT_SEAT, type DigitSeated } from '../../sizing';
import type { TickBandDerived } from '../../label/tickRow';
import { accessibleTitle } from '../../normalize/shared';
import type { RangeMark } from '../../rangeRules';
import { addRatioTierRequests, finalizeRatioTier, ratioTierA11y, ratioTierSpacingWarnings, type FinalizedRatioTier, type RatioTierGeometry, type RatioTierRequestState } from '../../ratioTier';
import type { FontSpec } from '../../text';
import { colorblindPaint, joinHatchPeers, panelTypeClass, emphasisWeight, strokeToken } from '../../theme';
import type { AnchorRef } from '../../types/annotations';
import type { Id } from '../../types/cell';
import type { ChartData } from '../../types/data';
import type { Geometry, LintWarning, PaintWarningRule, PlacedLabel, SceneNode } from '../../types/scene';
import { bandValueLabelUniformity, haloOverRules, keepValuesWithoutAxis, raiseOverRules, warnSliverLabels } from '../band/labels';
import { anomalyReceipt } from './anomaly';
import { edgeNameFont, KEY_EDGE_SERIES, resolveColumnDomain, toDateOnValues } from './domain';
import { cellValueText, planColumnLabels, planColumnValueLabels, type DigitSeats } from './labels';
import { layoutColumnMarks } from './marks';
import { PY_TICK_LEAD, TICK_LABEL_RESERVE, type ColumnArea, type ColumnDomain, type ColumnMarkGeometry, type ComputedTotal } from './model';
import { columnPaints } from './paints';
import { CAGR_PAD, CATEGORY_NOTES, columnPlotArea, SEGMENT_NOTE, solveColumnFrame } from './plot';
import { categoryNotesDiffer, FORCE_CATEGORY_RANKS, rankNotes } from '../combo/categoryRanks';
import type { AnomalyColumnOptions, AnomalyDerived } from './types';
import type { EmittedLane } from '../../eventLane';
import { dataOrder, plotChromeFloor, POINTED_NOTES, type InternalFootnoteOptions } from '../../frame';
import { withBandValueNotes } from '../band/valueNotes';
import { runStaircase, seatStaircase, settleStaircase, STAIRCASE_MAX_PAD, type StaircaseOutcome } from '../../label/staircase';
import type { Theme } from '../../types/theme';
import { pushAll } from '../../arrays';

/** Route straight leaders around printed boxes, or cut their blocked runs, with the shared gap. */
function clearStraightLeaders(labels: PlacedLabel[], theme: Theme): void {
  const visible = labels.filter((label) => !label.hidden);
  const pad = REFERENCE_LABEL_CLEARANCE + strokeToken(theme, 'rule') / 2 + 0.01;
  for (const label of visible) {
    if (!label.leader || label.leader.curved) continue;
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
      ...(totalsAdd(domain) ? {} : { noValue: NO_STACK_TOTAL }),
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
    target: domain.options.target,
    // The growth bracket seats its label on its run.
    cagrLabelOnArm: true,
    // Events belong to the event lane.
    annotations: domain.annList.filter((annotation) => annotation.kind !== 'event'),
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
    format: domain.options.format,
    locale: domain.options.locale?.language,
    strings: domain.options.strings,
    percentLevels: percentLevels(dataSeries),
    valueLinePercentLevels: domain.variant === 'stacked100' || domain.options.unit === '%' || domain.pctLevels,
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
  const labelNodes = labelsToNodes(domain.theme, allLabels, (l) =>
      tierState?.fontByLabelId.get(l.id) ??
      // A total column (categories[].role 'total') prints its head and values bold.
      (totalIds.has(l.owner.categoryId ?? '') && (l.kind === 'segment' || l.kind === 'category')
        ? { ...(l.kind === 'category' ? catPlan.font : strongFont), weight: emphasisWeight(domain.theme) } : undefined) ??
      (bandLabelIds.has(l.id)
        ? tickFont
        : l.kind === 'grandTotal' || l.kind === 'total'
          ? strongFont
          // A category label is drawn at the font its row was
          // measured and claimed at, which is the tick font unless the row
          // stepped down a size.
          : l.kind === 'category'
          ? area.stairTop !== undefined ? tickFont : catPlan.font
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
    scene: withSegmentSeams(joinHatchPeers(nodes), domain.theme),
    labels: lane ? [...allLabels, ...lane.labels] : allLabels,
    axes,
    annotations: [
      ...integratedAnnotations,
      ...annotated.placed,
      ...(lane?.placed ?? []),
      // Series CAGR records, for the names that were laid out.
      ...[...domain.seriesCagr.values()].map((entry) => entry.placed).filter((placed) => allLabels.some((label) => label.id === placed.labelId)),
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
              measuredLines: catPlan.maxLines,
              lineHeight: catPlan.font.size * 1.2,
              // Rotated rows reserve more than lines × line height; the receipt names it.
              extra: catPlan.rowHeight - catPlan.maxLines * catPlan.font.size * 1.2,
              dateNumeric: catPlan.dateNumeric,
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
  const resolved = withValueLabelDefaults(ribbonDefaults(withLocaleStrings(options)), 'column', options.valueAxis?.percent ? 'stacked100' : options.variant);
  const geometry = withBandValueNotes(data, resolved, next => layoutColumnWithNotes(data, next, keepEachValue));
  // An edge name that lost its seat leaves its series to the key: lay out again with every series keyed.
  const keyed = new Set(geometry.legend?.items.map((item) => item.id));
  const lost = geometry.labels.some((label) => label.hidden && label.id.startsWith('seriesEdge:') && !keyed.has(label.owner.seriesId!));
  const keyAsked = resolved.legend !== undefined && resolved.legend !== 'none';
  if (!lost || !keyAsked || (resolved as { [KEY_EDGE_SERIES]?: true })[KEY_EDGE_SERIES]) return geometry;
  const again = { ...resolved, [KEY_EDGE_SERIES]: true } as AnomalyColumnOptions;
  return withBandValueNotes(data, again, next => layoutColumnWithNotes(data, next, keepEachValue));
}

/** A ribbon chart names its series at the right edge of the last column, not in a legend. */
function ribbonDefaults(options: AnomalyColumnOptions): AnomalyColumnOptions {
  // valueAxis.percent resolves to stacked100 in the domain.
  const stacked = options.variant === 'stacked' || options.variant === 'stacked100' || Boolean(options.valueAxis?.percent);
  if (!stacked || !options.ribbons || options.seriesLabels !== undefined) return options;
  return { ...options, seriesLabels: { at: 'right-edge' } };
}

function layoutColumnWithNotes(
  data: ChartData,
  options: AnomalyColumnOptions,
  keepEachValue: boolean,
): Geometry<ColumnMarks, ColumnDerived> {
  let named = new Map<string, string>();
  // options.categoryLabels 'staircase': the names take the height they need, or the chart falls back to the row.
  // Every re-layout settles them again, as each later pass (CAGR pad, value-line reserve, notes) moves the plot.
  let pass!: ReturnType<typeof layoutColumnPass>;
  let minimumChrome = Infinity;
  const run = (next: AnomalyColumnOptions): AnomalyColumnOptions => {
    pass = layoutColumnPass(data, next, keepEachValue);
    const settled = settleStaircase(next, (o) => (pass = layoutColumnPass(data, o, keepEachValue)).staircase, pass.staircase);
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
  options = run(options);
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
      next = run({ ...next, [SEGMENT_NOTE]: [...named.values()] } as AnomalyColumnOptions);
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
  return pass.geometry;
}

function layoutColumnPass(
  data: ChartData,
  options: AnomalyColumnOptions,
  keepEachValue: boolean,
): { geometry: Geometry<ColumnMarks, ColumnDerived>; unprinted: Map<string, string>; categoryNotes: string[]; planNotes: string[]; rankKey: () => string[]; legDeficit: number; bandNeed: number; valueLineReserve: number; tickReserve: number; staircase?: StaircaseOutcome } {
  const warnings: LintWarning[] = [];
  const domain = resolveColumnDomain(data, options, warnings);
  const paints = columnPaints(domain, warnings);
  const { size, theme } = domain;
  // The frame is the first claimer, so its index becomes the run's index.
  // The event lane sizes itself and the key with the frame and plot passes.
  let areaWarningsAt = 0;
  const settled = settleEventLane({
    annotations: domain.annList, categories: domain.cats, events: options.events, language: options.locale?.language,
    colorblindSafe: options.colorblindSafe, inline: false, footnotesOff: (options as InternalFootnoteOptions).footnotesOff,
    theme, measure: domain.measure, size, compact: options.mode === 'compact',
    solve: (key, w) => solveColumnFrame(domain, paints, w, key),
    area: (framed, w) => {
      areaWarningsAt = w.length;
      return columnPlotArea(domain, framed.frame, w);
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
  const scene = layoutColumnMarks(domain, paints, area);
  // Phase 2 claimed into its own index; replay it, in claim order, into the run's.
  for (const c of scene.claims.snapshot()) occupied.claim(c.rect, c.kind, c.owner, c.part);
  if (scene.claims.tickColumns) occupied.tickColumns = scene.claims.tickColumns;
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
  const stair = area.stairTop === undefined ? undefined : seatStaircase({
    categories: domain.cats, band: area.band, top: area.stairTop, left: area.plot.x, right: area.plot.x + area.plot.w,
    floor: area.y0, above: options.labels !== false ? area.gtH + 4 : 0, font: area.tickFont, measure: domain.measure,
    tops: domain.posTopP, options, cap: STAIRCASE_MAX_PAD * area.frame.plot.h, occupied, requests,
  });
  const noted = { items: new Map<string, string>(), slivers: new Set<string>() };
  const digits: DigitSeats = { requests: [], slivers: [], warningAt: 0 };
  const pointFont = planColumnValueLabels(domain, paints, area, scene, requests, warnings, noted, digits);
  // The adjacency lint reads the drawn columns. It runs where it always ran,
  // after the value-label font step: its `before` count includes those warnings.
  const paintWarningRules: PaintWarningRule[] = [];
  pushAll(warnings, rectSeriesAdjacentWarnings(scene.nodes, paints.css, 'vertical', domain.highlights, theme, { rules: paintWarningRules, before: warnings.filter(warning => !['pie-ramp-crowded', 'likert-ramp-invisible', 'band-lightness-insufficient', 'series-adjacent-similar', 'highlight-reads-as-loss'].includes(warning.code)).length }));
  const growthPoints = planColumnLabels(domain, area, scene, requests, warnings);
  const solveCtx: SolveCtx = labelCtx(theme, size, options, {
    density: domain.density,
    measure: domain.measure,
    plot: area.plot,
    labelPad: 2,
    // A histogram keeps each fitting count, even when other bins need a note.
    // values valueLabels picks are no scatter; each one that cannot sit goes to the note alone.
    seriesUniform: keepEachValue || pickedValues(domain.options) ? undefined : bandValueLabelUniformity(),
  });
  const solved = solveLabels(keepValuesWithoutAxis(requests, domain.density, domain.va.show === true), occupied, solveCtx);
  // A running period keeps a cue: a to-date value without a seat, or words wider than the drawn column, bring the hatch key back.
  const toDate = toDateOnValues(domain);
  if (toDate.size > 0 && (!toDateFits(domain.options.strings?.toDate ?? chartString(domain.options, 'toDate'), theme, domain.measure, toDateRoom(area.band.bandwidth))
    || solved.placed.some((l) => (l.kind === 'grandTotal' || l.kind === 'point') && l.hidden !== undefined && toDate.has(l.owner.categoryId ?? '')))) {
    return layoutColumnPass(data, { ...options, [PARTIAL_KEY]: true } as AnomalyColumnOptions, keepEachValue);
  }
  const staircase = runStaircase(theme, options.categoryLabels, options, stair, solved.placed, occupied, scene.nodes, warnings);
  applyValueAxisTitleInk(solved.placed);
  const crossed = haloOverRules(solved.placed, occupied, new Set(['referenceLine', 'valueLine']));
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
  const unprinted = new Map([...noted.items].filter(([id]) => !pointedAt.has(id) &&
    // The note names what is not drawn: a sliver a pin placed is drawn, and so is one whose total prints its value.
    solved.placed.some((label) => label.id === id && (label.hidden === 'collision' || (label.hidden !== undefined && label.printedIn === undefined && noted.slivers.has(id))))));
  const geometry = assembleColumnGeometry(domain, area, scene, solved, annotated, tierState, pointFont, growthPoints, ratioTierResult, occupied, warnings, paintWarningRules, lane);
  geometry.scene = raiseOverRules(geometry.scene, crossed);
  const planNotes = !area.showCatRow ? []
    : area.catPlan.step === 'ranks' ? rankNotes(domain.cats.map((c) => c.label ?? c.id), domain.options) : area.catPlan.cutNotes;
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
  return { geometry, unprinted, categoryNotes, planNotes, rankKey, legDeficit: annotated.legDeficit, bandNeed: annotated.bandNeed, valueLineReserve, tickReserve: tickReserve <= size.width / 3 ? tickReserve : 0, ...(staircase ? { staircase } : {}) };
}
