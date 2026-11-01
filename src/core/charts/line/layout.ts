import { chartString } from '../../strings/line';
import { withLocaleStrings } from '../../strings';
import type { Theme } from '../../types/theme';
import type { FontSpec } from '../../text';
import { structureCount } from '../../structureCounts';
import { seriesTextPaint, emphasisWeight, dashToken, secondaryFont, strokeToken } from '../../theme';
/**
 * Line / area chart — multi-series time profiles over
 * ChartData. Variants: plain lines, overlaid areas, stacked areas, and
 * 100%-stacked areas. Points sit at category band centers (crosses-between);
 * endpoint labels spread vertically in a reserved right margin; inline names
 * occupy the clearest interior line stretch; per-cell FC scenarios switch the
 * line to dashed from the last AC point onward; nulls
 * interpolate by default or break the line when interpolateGaps === false;
 * rebase100 re-indexes every series to 100 at a chosen category.
 *
 * `layoutLine` runs five phases: domain and scales (domain.ts,
 * paints.ts, plot.ts), mark geometry (scene.ts), label planning (labelPlan.ts)
 * with the solver, annotations through the `runAnnotatePass` call,
 * and the geometry assembly below. The frame and the marks claim into
 * indexes of their own, which this function commits in claim order.
 */

import { BAND_PAD, GAP_BRACKET_REFUSED, GAP_BRACKET_RESERVE, hiddenValueLineReserve, VALUE_LINE_RESERVE } from '../../annotateParts';
import { gapBracketEngine } from '../../annotateGapBracket';
import { canvasMargin } from '../../theme';
import { NOTED_LABELS, type InternalFootnoteOptions } from '../../frame';
import { applyValueAxisTitleInk, tickFormatter } from '../../axis';
import { PARTIAL_KEY, partialIds, toDateFits } from '../../partialPeriod';
import type { AnchorResolution, AnnotatePassResult } from '../../annotate';
import { zoneYearSpan } from '../../timeAxis';
import { emitEventLane, percentLevels, runAnnotatePass, settleEventLane } from '../../annotatePass';
import { categoryBandFromCenters, categoryTargetFields, spliceAnnotationNodes, type CategoryBand } from '../../annotateFields';
import type { Rect } from '../../geometry';
import { heightOmitted, PLOT_FLOOR_RECT } from '../../sizing';
import { TARGET_SIZE, type TargetSizeOptions } from '../../target';
import { labelsToNodes } from '../../label/emit';
import { createOccupiedIndex, type OccupiedIndex } from '../../label/occupied';
import type { TickBandDerived } from '../../label/tickRow';
import { labelCtx, leaderPieces, seatLeader, solveLabels, type LabelRequest, type SolveCtx, type SolveResult } from '../../label/solver';
import { accessibleTitle } from '../../normalize/shared';
import { finalizeRatioTier, ratioTierA11y, ratioTierSpacingWarnings, type FinalizedRatioTier, type RatioTierGeometry } from '../../ratioTier';
import { defaultAnnotationId, type AnchorRef } from '../../types/annotations';
import type { Id } from '../../types/cell';
import type { LineChartData } from '../../types/data';
import type { Geometry, LintWarning, Paint, PlacedLabel } from '../../types/scene';
import type { LiveSampling } from '../../live/types';
import type { NormSer } from './context';
import { resolveLineDomain, resolveLineEnv } from './domain';
import { backForecastAreaLabels, emitForecastDividers, forecastDividerAt } from './forecast';
import { fillShadingKinds, fillShadings, forecastBoundaryX, regroundOnShadings, withoutEvents } from './marks';
import { planLineLabels, type LineLabelPlan } from './labelPlan';
import { BUMP_FOLDED } from './bump';
import { X_PARTIAL_ROW } from './xTicks';
import { END_LABEL_KEY, END_LABEL_WIDE, INLINE_FALLBACK, endUnitSuffix, lineToDateIds, usesEndLabelKey, usesInlineFallback, type EndpointLabelStrategy } from './labels';
import { lineValueStats } from './means';
import { laneScale } from './continuous';
import type { LineAnomaly, LineArea, LineDomain, LineEnv, LineMarkGeometry, LineReserves, LineText } from './model';
import { viewportMeanSpan } from '../../viewport';
import { anomalyA11y, anomalyReceipt, columnCorridorPaint, lineAnomalyFurniture, seatFlaggedValues } from '../column/anomaly';
import type { AnomalyDerived } from '../column/types';
import type { TextMeasurer } from '../../text';
import type { NearZeroTail } from './nearZero';
import { lineText, linePaints } from './paints';
import { linePlotArea, lineReserves, sigRound, solveLineFrame } from './plot';
import { layoutLineMarks, bandHatch } from './scene';
import { referenceBandsA11y } from './referenceBands';
import { formatAutomaticPercent } from '../../format';
import { autoDecimals } from '../../formatPrecision';
import type { LineOptions } from './types';
import { PLOT_W_FLOOR_DEMOTED } from '../../lint/space';
import type { LineTrend } from './trend';
import { lineTrendLabel } from './trend';

import type { EmittedLane } from '../../eventLane';
import { pushAll } from '../../arrays';

export interface LineMarks {
  series: {
    seriesId: Id;
    /** Primary polyline path node (absent when the series has < 2 drawable points). */
    pathNodeId?: Id;
    /** Area fill path node (area variants only). */
    areaNodeId?: Id;
    /** Dashed AC→FC continuation path node, when a per-cell FC split exists. */
    fcPathNodeId?: Id;
    points: { categoryId: Id; x: number; y: number; nodeId?: Id }[];
  }[];
  gapFills?: {
    nodeId: Id;
    sign: 'positive' | 'negative';
    fromCategoryId: Id;
    toCategoryId: Id;
  }[];
  targets?: {
    seriesId: Id;
    categoryId: Id;
    value: number;
    nodeId: Id;
    labelId?: Id;
  }[];
  /** Uncertainty fan, outermost band first. Present only when `options.fan` paints. */
  fan?: {
    bandIndex: number;
    nodeIds: Id[];
    low: Id;
    high: Id;
    label: string;
  }[];
  phases?: {
    id: Id;
    nodeId: Id;
    fromCategoryId: Id;
    toCategoryId: Id;
    x0: number;
    x1: number;
    y0: number;
    y1: number;
    labelId: Id;
    boundaryNodeId?: Id;
  }[];
}

export interface PhaseDerived {
  seriesId: Id;
  interpolation: 'linear' | 'monotone';
  pointwiseExact: true;
  boundaries: {
    x: number;
    y: number;
    leftCategoryId: Id;
    rightCategoryId: Id;
  }[];
}

/**
 * The fan receipt.
 *
 * `method` is the constant `'declared-intervals'`, and that is the whole point:
 * THE ENGINE COMPUTES NO DISTRIBUTION. It paints the numbers the author
 * declared and verifies their internal consistency (nesting, containment,
 * orientation). Choosing an undeclared quantile method — exclusive vs
 * inclusive, vs R-7, `mean ± 1.96σ` on a skewed series — would be a silent
 * lie of exactly the class this product exists to prevent, and no single
 * choice is right for both "P10-P90 of a simulation" and "the range of three
 * planning scenarios". So there is deliberately no `confidence`, `sigma`,
 * `percentile` or `distribution` field here, and no scalar-σ shorthand on the
 * option: an author who wants an interval states its two bounds as data and
 * names what they mean.
 *
 * `origin` IS derived: it is the first category at which any band has non-zero
 * width, i.e. where the fan actually forks. That is a fact about the supplied
 * numbers, not an authored claim, so the engine reads it rather than accepting
 * it.
 */
export interface FanDerived {
  /** The central trajectory series id. */
  of: Id;
  /** First category id at which any band has non-zero width; null if none does. */
  origin: Id | null;
  method: 'declared-intervals';
  bands: {
    low: Id;
    high: Id;
    label: string;
    /** high − low per category, in plotted units; null where either bound is null. */
    widths: (number | null)[];
  }[];
}

/**
 * The bump receipt. Ranks are DERIVED here and never read from input; this
 * object is what lets a reader audit the derivation without re-measuring
 * pixels.
 *
 * `method` is 'competition' and is written out rather than assumed, because a
 * rank chart whose tie rule is undeclared is exactly the silent lie this
 * product exists to prevent. Standard competition ranking ("1224") means
 * rank = "number of entities strictly ahead, plus one", so tied entities SHARE
 * a rank and the next rank is skipped.
 *
 * Two alternatives were considered and refused:
 *  - dense ("1223"): with ties, "rank 3" would denote a different standing in
 *    different periods, so a line would move when nothing overtook anything;
 *  - fractional/average ("1, 2.5, 2.5, 4"): non-integer y positions imply a
 *    resolution the data does not have and break the one-row-per-rank reading
 *    of the axis.
 * Competition is also what league tables and leaderboards mean by "3rd", so
 * the chart matches the words the reader will speak.
 */
export interface BumpDerived {
  direction: 'higherIsBetter' | 'lowerIsBetter';
  method: 'competition';
  /** Largest rank assigned in any category (ties skip ranks, so this can exceed the entity count in no case, but participation gaps make it vary). */
  maxRank: number;
  /** Per entity, the rank in each category in category order; null where the entity has no value. */
  ranks: Record<Id, (number | null)[]>;
  /** One entry per tied GROUP (not per tied entity). */
  ties: { categoryId: Id; rank: number; seriesIds: Id[] }[];
  /** Non-null entity count per category — rank k means something different in a 12-entity period than in an 8-entity one. */
  participants: Record<Id, number>;
  /**
   * The precision the ranking cut was made at, as the format example the
   * exhibit prints its numbers with. Two values that render to the same string
   * are EQUAL for ranking and tie; the ranking never splits entities on a
   * difference the reader cannot see. See `sameToTheReader`.
   */
  comparedAt: string;
}

export interface LineDerived {
  /** Least-squares receipts; x is elapsed days or category positions, starting at the first displayed category. */
  trends?: LineTrend[];
  /** Computed shares moved from separate rounding to close a complete whole. */
  roundingAdjustments?: import('../../shareRounding').RoundingAdjustment[];
  /** Source and displayed identities for the live window. */
  liveWindow?: LiveSampling;
  /** The anomaly rule and what it flagged (options.anomaly), as column records it. */
  anomaly?: AnomalyDerived;
  /**
   * Last non-null PLOTTED value per data series. Under `variant: 'bump'` the
   * plotted quantity is the derived rank, so this field carries the last rank,
   * not the last metric value — the field keeps its meaning ("what was drawn"),
   * which is why it is stated here rather than silently changed.
   */
  endpoints: Record<Id, { categoryId: Id; value: number }>;
  /** Present only under `variant: 'bump'`; the full ranking receipt. */
  bump?: BumpDerived;
  /** Present only when `options.fan` resolves; the fan receipt. */
  fan?: FanDerived;
  /** Present only when a valid phase partition paints. */
  phases?: PhaseDerived;
  rebased?: true;
  /**
   * Effective right margin actually applied (authored margin widened by the
   * endpoint-label / right-indicator reserve). Engine callers that must
   * command exact plot edges (grid pass-2 alignment) rebase their request on
   * this, not on the margin they asked for.
   */
  rightInset: number;
  /** Effective left margin (widened by the indicator100 gutter reserve). */
  leftInset: number;
  ratioTier?: RatioTierGeometry;
  /** Receipt: absent only when the category tick row is not rendered. */
  tickBand?: TickBandDerived;
  /** Receipt for the endpoint-label strategy and its effective-pixel budget. */
  endpointLabelEconomy?: {
    strategy: EndpointLabelStrategy;
    maxGutterFraction: number;
    requiredGutter: number;
    appliedGutter: number;
    effectiveRequiredGutter: number;
    effectiveBudget: number;
    overflow: boolean;
  };
  /**
   * Near-zero group receipt: the series whose last value prints as zero. `mode: 'shared'`
   * means one joint end label, `'dropped'` means the group lost its labels and
   * `footnote` states the fact instead.
   */
  nearZeroTail?: NearZeroTail;
  /** Source-value variation that tells a crushed signal from a flat context line. */
  seriesValueStats: Record<Id, { range: number; mean: number; relativeRange: number }>;
  /** Marker that a sibling pair justifies its shared explicit y bounds; the space lint then skips its ink-envelope headroom check. */
  comparisonPinnedYDomain?: true;
}

/** Replays a phase's claims, in claim order, into the run's index. */
function commitClaims(occupied: OccupiedIndex, phase: OccupiedIndex): void {
  for (const c of phase.snapshot()) occupied.claim(c.rect, c.kind, c.owner, c.part, c.polygon);
  if (phase.tickColumns) occupied.tickColumns = phase.tickColumns;
}

/** After the solver: hidden target labels, the leader paths, the ratio tier. */
function settleLineLabels(
  env: LineEnv,
  area: LineArea,
  scene: LineMarkGeometry,
  plan: LineLabelPlan,
  solved: SolveResult,
  occupied: OccupiedIndex,
  warnings: LintWarning[],
): FinalizedRatioTier | undefined {
  for (const label of solved.placed) {
    if (!scene.targetLabelIds.has(label.id) || label.hidden !== 'collision') continue;
    warnings.push({
      code: 'target-label-hidden',
      severity: 'warn',
      message: `authored target label '${label.id}' could not be placed without a collision`,
      owner: label.owner,
      suggest: 'increase chart size, shorten the target label, or pin it to a free slot',
    });
  }
  for (const label of solved.placed) {
    if (label.hidden || !label.leader) continue;
    if (!plan.endpointLeaderAnchors.get(label.id)) continue;
    for (const [a, b] of leaderPieces(label.leader.d, 64)) occupied.claim({
      x: Math.min(a.x, b.x) - 0.5, y: Math.min(a.y, b.y) - 0.5,
      w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1,
    }, 'label', label.owner, 'endpointLeader');
  }
  const ratioTierResult = plan.ratioTierRequestState
    ? finalizeRatioTier(plan.ratioTierRequestState, solved.placed, occupied, env.theme, env.measure)
    : undefined;
  if (ratioTierResult) pushAll(scene.nodes, ratioTierResult.nodes);
  pushAll(warnings, ratioTierSpacingWarnings(area.ratioTier, solved.placed));
  return ratioTierResult;
}

/** Phase 4: the annotation pass, anchored on the drawn points. */
function annotateLine(
  env: LineEnv,
  domain: LineDomain,
  area: LineArea,
  reserves: LineReserves,
  scene: LineMarkGeometry,
  occupied: OccupiedIndex,
  solveCtx: SolveCtx,
  labelRequests?: LabelRequest[],
  printedLabels?: readonly PlacedLabel[],
): AnnotatePassResult {
  const { options, cats, dataSeries, drawnSeries, refSeries, pv, rowOf, isStacked, cumTop, rebased, absOf } = domain;
  const { plot, y, xOf, categoryOrder: catIndex } = area;
  const anchorSeries = [...drawnSeries, ...refSeries.filter((s) => scene.nodes.some((node) => node.part === 'referenceLine' && node.owner.seriesId === s.id))];
  const anchorError = (ref: AnchorRef): string => {
    const norm = typeof ref === 'string' ? { categoryId: ref } : ref;
    const valid = `valid category ids: ${cats.map((c) => c.id).join(', ')}; valid series ids: ${anchorSeries.map((s) => s.id).join(', ')}`;
    if (!('categoryId' in norm)) return `line anchors need categoryId; ${valid}`;
    if (!catIndex.has(norm.categoryId)) return `unknown category '${norm.categoryId}'; ${valid}`;
    if (norm.seriesId && !anchorSeries.some((s) => s.id === norm.seriesId)) return `series '${norm.seriesId}' is not drawn; ${valid}`;
    return `no drawn value at category '${norm.categoryId}' for series '${norm.seriesId ?? drawnSeries[0]?.id}'; ${valid}`;
  };
  const resolveAnchor = (ref: AnchorRef): AnchorResolution | null => {
    const norm = typeof ref === 'string' ? { categoryId: ref, edge: 'total' as const } : ref;
    if (!('categoryId' in norm)) return null;
    const ci = catIndex.get(norm.categoryId);
    if (ci === undefined) return null;
    const c = cats[ci]!;
    // An explicit total reads every band. String anchors keep reading the first series.
    if (isStacked && typeof ref !== 'string' && norm.edge === 'total' && !norm.seriesId && drawnSeries.length > 1) {
      const values = drawnSeries.map(s => rebased ? pv[rowOf.get(s)!]![ci]! : absOf(s, ci));
      if (values.every(value => value === null)) return null;
      const value = values.reduce<number>((total, value) => total + (value ?? 0), 0);
      const top = drawnSeries[drawnSeries.length - 1]!;
      return {
        x: xOf(ci),
        y: y(cumTop[dataSeries.indexOf(top)]![ci]!),
        value,
        date: c.date, label: c.label ?? c.id,
        owner: { categoryId: c.id },
        lineAnchored: true,
      };
    }
    // default series for category-level anchors (cagr span, valueLine): first data series
    const s = norm.seriesId ? anchorSeries.find((x) => x.id === norm.seriesId) : drawnSeries[0];
    if (!s) return null;
    const di = dataSeries.indexOf(s);
    const v = pv[rowOf.get(s)!]![ci]!;
    if (v === null) return null;
    const py = isStacked && di >= 0 ? y(cumTop[di]![ci]!) : y(v);
    // Geometry is plotted units (percent under stacked100-area); the annotation VALUE
    // stays absolute. absOf === pvOf outside stacked100-area, and rebase100 is ignored under
    // stacked100-area, so under rebase100 the plotted index is the value.
    const value = rebased ? v : (absOf(s, ci) ?? v);
    return {
      x: xOf(ci),
      y: py,
      value,
      pointValueText: (rebased ? domain.fmt : domain.valueSpec.forSeries(s, s.vals[ci]?.format))(value),
      format: rebased ? undefined : s.format,
      date: c.date, label: c.label ?? c.id,
      owner: { categoryId: c.id, seriesId: s.id },
      // A category anchor reads the first drawn series, so it is named too.
      ...(dataSeries.length > 1 ? { series: { id: s.id, label: s.label } } : {}),
      lineAnchored: true,
      ...(ci > 0 && pv[rowOf.get(s)!]!.findIndex((value) => value !== null) === ci ? { lineStart: true } : {}),
    };
  };
  // Authored forecast category bands share the last actual point.
  const centred = categoryBandFromCenters(cats.map((c) => c.id), plot, xOf, 'x');
  const splits = area.forecast.map((boundary) => ({ boundary, x: forecastBoundaryX(boundary, xOf, 'point') }));
  const resolveCategoryBand = (categoryId: Id): CategoryBand | null => {
    // A continuous axis: a band edge is an exact x, clipped to the plot.
    if (domain.x && area.xOfValue) {
      const x = domain.x.model.read(categoryId, 'options.annotations');
      return { x: Math.min(plot.x + plot.w, Math.max(plot.x, area.xOfValue(x))), w: 0 };
    }
    const band = centred(categoryId);
    const ci = catIndex.get(categoryId);
    if (!band || !('x' in band) || ci === undefined) return band;
    let left = band.x;
    let right = band.x + band.w;
    for (const { boundary, x } of splits) {
      if (ci === boundary.categoryIndex) left = x;
      if (ci === boundary.categoryIndex - 1) {
        right = x;
        left = Math.min(left, x);
      }
    }
    return { x: left, w: right - left };
  };
  // A one-period band on a continuous axis covers its period's slot: halfway to each drawn neighbour,
  // the same reach on the far side at the ends. An x no period is drawn at has no slot.
  const resolvePeriodSlot = (categoryId: Id): CategoryBand | null => {
    if (!domain.x || !area.xOfValue) return null;
    const shown = domain.x.shown;
    const at = shown.indexOf(domain.x.model.read(categoryId, 'options.annotations'));
    if (at < 0 || shown.length < 2) return null;
    const px = (i: number) => area.xOfValue!(shown[i]!);
    const x = px(at);
    const before = at > 0 ? (x - px(at - 1)) / 2 : (px(at + 1) - x) / 2;
    const after = at < shown.length - 1 ? (px(at + 1) - x) / 2 : before;
    const left = Math.max(plot.x, x - before);
    const right = Math.min(plot.x + plot.w, x + after);
    return right > left ? { x: left, w: right - left } : null;
  };
  // Use the data plot and the original subtraction for the header lane.
  // An equivalent addition can round an arm's last valid seat above its ceiling.
  const annPlot: Rect = {
    x: plot.x,
    y: area.forecastPlot.y - (area.topPad - 8 - area.axisTitleBand),
    w: plot.w,
    h: area.forecastPlot.h + (area.topPad - 8 - area.axisTitleBand),
  };
  const ceilingRects: Rect[] = area.axisTitle && area.axisShown
    ? [{ x: area.frame.plot.x, y: area.axisTitleY, w: area.axisTitle.width, h: area.axisTitle.height }]
    : [];
  return runAnnotatePass({
    target: domain.options.target,
    // Events belong to the event lane.
    annotations: withoutEvents(reserves.annList),
    resolve: resolveAnchor,
    anchorError,
    labelRequests,
    printedLabels,
    defaultSpan:
      cats.length >= 2 ? { from: cats[0]!.id, to: cats[cats.length - 1]!.id } : undefined,
    // A time axis reading's id is its ISO instant.
    ...(domain.x?.model.clock ? { elapsedYears: (from: AnchorResolution, to: AnchorResolution) => from.owner.categoryId === undefined || to.owner.categoryId === undefined ? undefined
      : zoneYearSpan(Date.parse(from.owner.categoryId), Date.parse(to.owner.categoryId), domain.x!.model.clock!) } : {}),
    occupied,
    plot: annPlot,
    laneCeiling: annPlot.y,
    bandCeiling: area.frame.plot.y,
    ceilingRects,
    theme: env.theme,
    measure: env.measure,
    format: options.format,
    locale: options.locale?.language,
    strings: options.strings,
    percentLevels: !rebased && percentLevels(dataSeries),
    valueLinePercentLevels: !rebased && (domain.variant === 'stacked100-area' || domain.options.unit === '%' || percentLevels(dataSeries)),
    solveCtx,
    yScale: y,
    meanValue: scene.meanValue,
    meanValueFor: scene.meanValueFor,
    // A mean keeps every source period, and its label names them where the plot draws fewer.
    meanSpan: viewportMeanSpan(domain.population),
    ...categoryTargetFields(cats.map((c) => c.id), area.forecastPlot, xOf, 'x'),
    resolveCategoryBand,
    ...(domain.x ? { resolvePeriodSlot } : {}),
    partialCategories: partialIds(cats),
    // A key beside the plot takes the margin the bracket stands in.
    ...(env.isBump || cats.length === 0 || occupied.snapshot().some((claim) => claim.kind === 'legend' && claim.rect.x >= plot.x + plot.w) ? {} : { gapBracket: {
      engine: gapBracketEngine, categoryId: cats[cats.length - 1]!.id, spine: env.size.width - canvasMargin(env.theme, env.size.width).right, width: env.size.width,
      ...(options.gapFill ? { washed: options.gapFill.between } : {}),
      refused: (options as { [GAP_BRACKET_REFUSED]?: Id[] })[GAP_BRACKET_REFUSED],
      // Stacked ends sit at cumulative tops, so their distance is not the gap the number states.
      ...(isStacked ? { unavailable: 'the series are stacked, so the end points sit at cumulative tops and not at the values' } : {}),
    } }),
  });
}

/** "Final standings" are the standings IN THE FINAL PERIOD, not each entity's last held rank. */
function lineStandings(env: LineEnv, domain: LineDomain, text: LineText): { endpointDesc: string; bumpExitedDesc: string } {
  const { cats, dataSeries, bumpDerived, endpoints, variant, rebased, lastIdxOf } = domain;
  const finalCi = cats.length - 1;
  const bumpFinal = bumpDerived
    ? dataSeries.map((s) => ({ s, rank: bumpDerived!.ranks[s.id]?.[finalCi] ?? null }))
    : [];
  const bumpExited = bumpFinal.filter((entry) => entry.rank === null && endpoints[entry.s.id]);
  const endpointDesc = env.isBump
    ? bumpFinal
        .filter((entry): entry is { s: NormSer; rank: number } => entry.rank !== null)
        .sort((a, b) => a.rank - b.rank)
        .map((entry) => chartString(domain.options, 'entityRank', { v1: entry.s.label, v2: entry.rank }))
        .join(', ')
    : dataSeries
        .filter((s) => endpoints[s.id])
        .map((s) => {
          const shareText = domain.shareTexts.get(`${endpoints[s.id]!.categoryId}\0${s.id}`);
          if (shareText !== undefined) return `${s.label} ${shareText}`;
          const cell = s.vals[lastIdxOf.get(s.id)!]!;
          const source = rebased ? undefined : cell.format ? { ...s, format: cell.format } : s;
          return `${s.label} ${text.composeEndText(variant === 'stacked100-area' ? ['percent'] : ['absolute'], endpoints[s.id]!.value, endpoints[s.id]!.value, '', '', endUnitSuffix(domain.options, rebased), cell.isPct, source)}`;
        })
        .join(', ');
  const lastRankedLabel = (id: Id): string => {
    const row = bumpDerived?.ranks[id] ?? [];
    let at = -1;
    row.forEach((rank, i) => {
      if (rank !== null) at = i;
    });
    return at === -1 ? 'no period' : (cats[at]!.label ?? cats[at]!.id);
  };
  const bumpExitedDesc =
    bumpExited.length > 0
      ? chartString(domain.options, 'bumpExitedDesc', { v1: cats[finalCi]!.label ?? cats[finalCi]!.id, v2: bumpExited
          .map(
            (entry) =>
              chartString(domain.options, 'bumpLastRankDesc', { v1: entry.s.label, v2: lastRankedLabel(entry.s.id), v3: endpoints[entry.s.id]!.value }),
          )
          .join(', ') })
      : '';
  return { endpointDesc, bumpExitedDesc };
}

/** The accessible description: variant, series, presets, standings, suppressed compositions, ratio tier. */
function lineA11yDesc(env: LineEnv, domain: LineDomain, area: LineArea, marks: LineMarks, variantName: string, text: LineText): string {
  const { options, cats, drawnSeries, refSeries, interpolationFor, rebased, bumpDerived, fan, variant, nmCats100, naCats100 } = domain;
  const { endpointDesc, bumpExitedDesc } = lineStandings(env, domain, text);
  const finalCi = cats.length - 1;
  const suppressedCompositionDesc =
    variant === 'stacked100-area' && (nmCats100.size > 0 || naCats100.size > 0)
      ? chartString(domain.options, 'areaCompositionsDesc', { v1: cats
          .filter((category) => !nmCats100.has(category.id) && !naCats100.has(category.id))
          .map((category) => category.label ?? category.id)
          .join(', ') || chartString(domain.options, 'none'), v2: cats
          .filter((category) => nmCats100.has(category.id) || naCats100.has(category.id))
          .map((category) => `${category.label ?? category.id} (${nmCats100.has(category.id) ? 'n.m.' : 'n/a'})`)
          .join(', ') })
      : '';
  const fanDesc = fan
    ? chartString(domain.options, 'fanDesc', { v1: fan.of.label, v2: fan.bands.map((band) => band.label).join(', ') }) +
      (fan.origin === null
        ? chartString(domain.options, 'fanZeroWidth')
        : chartString(domain.options, 'fanOrigin', { v1: cats.find((category) => category.id === fan!.origin)?.label ?? fan.origin }))
    : '';
  const effectiveInterpolationDesc = [...new Set(drawnSeries.map(interpolationFor))].filter(
    (mode) => mode !== 'linear',
  );
  return chartString(domain.options, 'lineDescStart', { v1: variantName, v2: drawnSeries.length, v3: cats.length }) +
    fanDesc +
    (refSeries.length ? chartString(domain.options, 'referenceSeriesClause', { v1: refSeries.length }) : '') +
    (effectiveInterpolationDesc.length === 0
      ? ''
      : chartString(domain.options, 'interpolationClause', { v1: effectiveInterpolationDesc.map(value => chartString(domain.options, ({"linear":"linearInterpolation","step-after":"stepAfterInterpolation","step-before":"stepBeforeInterpolation","monotone":"monotoneInterpolation"} as const)[value])).join(' / ') })) +
    (marks.gapFills
      ? chartString(domain.options, 'lineDifferenceDesc', { v1: options.gapFill!.between[0], v2: options.gapFill!.between[1] })
      : '') +
    (marks.targets ? chartString(domain.options, 'lineTargetsDesc', { v1: marks.targets.length, v2: marks.targets.length === 1 ? '' : 's' }) : '') +
    (marks.phases
      ? chartString(domain.options, 'linePhasesDesc', { v1: marks.phases.length })
      : '') +
    (rebased ? chartString(domain.options, 'lineIndexed') : '') +
    (bumpDerived
      ? chartString(domain.options, 'lineRanksDesc', { v1: bumpDerived.maxRank, v2: chartString(domain.options, bumpDerived.direction === 'higherIsBetter' ? 'higherBetter' : 'lowerBetter') }) +
        (bumpDerived.ties.length > 0
          ? chartString(domain.options, 'lineRankTies', { v1: bumpDerived.ties.length, v2: bumpDerived.ties.length === 1 ? '' : 's' })
          : '')
      : '') +
    (endpointDesc
      ? chartString(domain.options, 'lineEndpointsDesc', { v1: env.isBump ? chartString(domain.options, 'standingsPeriod', { v1: cats[finalCi]!.label ?? cats[finalCi]!.id }) : chartString(domain.options, 'latestValues'), v2: endpointDesc })
      : '.') +
    bumpExitedDesc +
    suppressedCompositionDesc +
    (domain.trends.length ? ` ${domain.trends.map(fit => lineTrendLabel(domain, fit)).join('. ')}.` : '') +
    anomalyA11y(domain) +
    ratioTierA11y(area.ratioTier);
}

/** The corridor rules and flag markers over the one drawn series (options.anomaly). */
function lineAnomalyMarks(theme: Theme, domain: LineDomain, anomaly: LineAnomaly, area: LineArea, text: LineText, scene: LineMarkGeometry, measure: TextMeasurer): ReturnType<typeof lineAnomalyFurniture> {
  const series = domain.drawnSeries.find((s) => s.id === anomaly.seriesId)!;
  const row = domain.pv[domain.rowOf.get(series)!]!;
  return lineAnomalyFurniture(theme, { strings: domain.options.strings,
    anomaly: anomaly.model, corridorShown: anomaly.corridorShown, statFmt: anomaly.statFmt, fmt: domain.fmt,
    corridorPaint: columnCorridorPaint(domain.options.colorblindSafe), plot: area.forecastPlot, y: area.y, seriesId: series.id,
    // The rule numbers read in the right margin, which solveLineFrame reserves (anomalyRuleReserve).
    labelX: area.plot.x + area.plot.w + 4,
    points: domain.cats.flatMap((c, ci) => (row[ci] === null ? [] : [{ categoryId: c.id, x: area.xOf(ci), y: area.y(row[ci]!) }])),
    font: text.labelFont, measure, nodes: scene.nodes, claims: scene.claims,
  });
}


/** The derived receipts: live window, endpoints, bump, fan, phases, insets, ratio tier, tick band. */
function lineDerived(
  domain: LineDomain,
  area: LineArea,
  reserves: LineReserves,
  scene: LineMarkGeometry,
  ratioTierResult: FinalizedRatioTier | undefined,
): LineDerived {
  const { population, endpoints, bumpDerived, fan, rebased, drawnSeries, dLo, dHi } = domain;
  const { endpointLabelEconomy, nearZeroTail } = reserves.endpoint;
  const { catPlan } = area;
  const categoryFont = catPlan.font;
  const categoryTickMaxLines = catPlan.maxLines;
  const domainEpsilon = Math.max(Math.abs(dLo), Math.abs(dHi), 1) * 1e-9;
  return {
    ...(population?.sampling ? { liveWindow: population.sampling } : {}), endpoints,
    ...(domain.trends.length ? { trends: domain.trends } : {}),
    ...(domain.roundingAdjustments ? { roundingAdjustments: domain.roundingAdjustments } : {}),
    ...(domain.anomaly ? { anomaly: anomalyReceipt(domain.anomaly.model) } : {}),
    ...(bumpDerived ? { bump: bumpDerived } : {}),
    ...(fan
      ? {
          fan: {
            of: fan.of.id,
            origin: fan.origin,
            method: 'declared-intervals' as const,
            bands: fan.bands.map((band) => ({
              low: band.low.id,
              high: band.high.id,
              label: band.label,
              // DISPLAY-side quantization, and relative: the receipt must
              // read the same in units and in millions (see sigRound).
              widths: band.widths.map((w) => sigRound(w)),
            })),
          },
        }
      : {}),
    ...(scene.phaseDerived ? { phases: scene.phaseDerived } : {}),
    ...(rebased ? { rebased: true as const } : {}),
    ...(endpointLabelEconomy ? { endpointLabelEconomy } : {}),
    ...(nearZeroTail ? { nearZeroTail } : {}),
    seriesValueStats: lineValueStats(drawnSeries, domainEpsilon, population?.values),
    rightInset: area.margin.right,
    // The EFFECTIVE plot inset, not the authored margin: grid's two-pass
    // alignment compensates from "the margin the child actually applied",
    // and that is the reserve-widened value the plot honours.
    leftInset: area.leftMargin + area.categoryOverhang,
    ...(ratioTierResult ? { ratioTier: ratioTierResult.geometry } : {}),
    ...(area.showCategoryTickRow
      ? {
          tickBand: {
            reserved: area.categoryTickReserve,
            measuredLines: categoryTickMaxLines,
            lineHeight: categoryFont.size * 1.2,
            extra: catPlan.rowHeight - categoryTickMaxLines * categoryFont.size * 1.2,
            dateNumeric: catPlan.dateNumeric,
            position: 'below' as const,
          },
        }
      : {}),
  };
}

interface LineAssembly {
  env: LineEnv;
  seriesPaint: (series: NormSer, dataIdx: number) => Paint;
  /** The fill resolver of the areas; a forecast value's backing takes the forecast region's fill. */
  areaFill: (series: NormSer, dataIdx: number, forecast: boolean) => Paint;
  domain: LineDomain;
  area: LineArea;
  text: LineText;
  reserves: LineReserves;
  scene: LineMarkGeometry;
  plan: LineLabelPlan;
  solved: SolveResult;
  annResult: AnnotatePassResult;
  ratioTierResult: FinalizedRatioTier | undefined;
  occupied: OccupiedIndex;
  warnings: LintWarning[];
  lane: EmittedLane | undefined;
}

/** Phase 5: every label into the scene, the x axis, the receipts and the accessible text. */
function assembleLineGeometry(input: LineAssembly): Geometry<LineMarks, LineDerived> {
  const { env, domain, area, text, scene, plan, solved, annResult, warnings } = input;
  const { isBump } = env;
  const { options, cats, drawnSeries, variant } = domain;
  const { plot, xOf } = area;
  const { nodes, axes, marks } = scene;
  const allLabels: PlacedLabel[] = [...solved.placed, ...annResult.labels];
  const lineFocus = !isBump && !domain.isArea && variant === 'line' && env.anyHighlight && options.highlightMode !== 'fade';
  // An `abs` callout on a focus point restates that series' value, so it takes the series' face too.
  const focusAbs = new Map<string, Id>(lineFocus ? input.reserves.annList.flatMap((a, n) => {
    const at = a.kind === 'abs' && typeof a.at === 'object' && 'seriesId' in a.at ? a.at.seriesId : undefined;
    return at !== undefined && env.highlights.has(at) ? [[`annotation:${defaultAnnotationId(a, n)}`, at] as const] : [];
  }) : []);
  const focusSeriesOf = (label: PlacedLabel): Id | undefined => focusAbs.get(String(label.id)) ?? label.owner.seriesId;
  const focusOf = (label: PlacedLabel): boolean => {
    const id = focusSeriesOf(label);
    return lineFocus && id !== undefined && env.highlights.has(id) && drawnSeries.some(s => s.id === id);
  };
  const shared = new Set(input.reserves.endpoint.endLabels.filter(l => l.shared).map(l => l.id));
  const bumpStoryNames = isBump && env.anyHighlight && options.highlightMode !== 'fade';
  for (const label of allLabels) {
    if (label.kind !== 'series' || shared.has(label.id)) continue;
    const index = drawnSeries.findIndex(s => s.id === label.owner.seriesId);
    if (index < 0) continue;
    // Under a highlight a story
    // name is bold in its line's ink, every other name the muted ink.
    const story = bumpStoryNames && env.highlights.has(label.owner.seriesId!);
    label.ink = bumpStoryNames && !story ? { token: 'inkMuted' } : seriesTextPaint(input.seriesPaint(drawnSeries[index]!, index));
    // A name the block stepped down to fit keeps its smaller size.
    label.font = { ...text.nameFont, ...(label.font && label.font.size < text.nameFont.size ? { size: label.font.size } : {}), ...(story || focusOf(label) ? { weight: emphasisWeight(env.theme) } : {}) };
  }
  // Under a grey highlight the focus series
  // prints its values bold in its own ink at every width, as its name.
  for (const label of allLabels) {
    if (label.kind === 'series' || !focusOf(label)) continue;
    if (label.kind !== 'point' && !focusAbs.has(String(label.id))) continue;
    const index = drawnSeries.findIndex(s => s.id === focusSeriesOf(label));
    label.ink = seriesTextPaint(input.seriesPaint(drawnSeries[index]!, index));
    label.font = { ...(label.font ?? text.labelFont), weight: emphasisWeight(env.theme) };
  }
  // Label hierarchy: under a highlight the names and values of the other
  // series are secondary text, in their own line's text paint, so the focus series leads.
  const backdrop = (lineFocus || bumpStoryNames) ? secondaryFont(env.theme) : undefined;
  if (backdrop) for (const label of allLabels) {
    if ((label.kind !== 'series' && label.kind !== 'point') || shared.has(label.id)) continue;
    const id = label.owner.seriesId;
    const index = drawnSeries.findIndex(s => s.id === id);
    if (id === undefined || index < 0 || env.highlights.has(id)) continue;
    const font = label.font ?? text.labelFont;
    if (backdrop.size >= font.size) continue;
    if (label.kind === 'point' && 'token' in label.ink && label.ink.token === 'ink' && Object.keys(label.ink).length === 1) {
      label.ink = seriesTextPaint(input.seriesPaint(drawnSeries[index]!, index));
    }
    shrinkPlacedLabel(label, font, { ...font, size: backdrop.size });
  }
  spliceAnnotationNodes(nodes, annResult.nodes);
  const lane = input.lane;
  if (lane?.behind.length) {
    // Dotted event rules: behind the marks, above the gridlines.
    const lastGrid = nodes.map((node) => node.part).lastIndexOf('gridline');
    const firstMark = nodes.findIndex((node) => node.owner.seriesId !== undefined);
    const tail = nodes.splice(lastGrid >= 0 ? lastGrid + 1 : firstMark >= 0 ? firstMark : nodes.length);
    pushAll(nodes, lane.behind);
    pushAll(nodes, tail);
  }
  // An area fill covers the shadings behind it: they draw through it (fillShadings),
  // and a value on its own fill takes its ink against the mix it lies on.
  if (domain.isArea) {
    const lastFill = nodes.reduce((at, node, i) => (node.part === 'area' || node.part === 'forecastHatch' || node.part === 'areaSeparator' ? i : at), -1);
    if (lastFill >= 0) {
      const shaded = fillShadings(nodes, scene.rendered.areaOutlines, fillShadingKinds(withoutEvents(input.reserves.annList)), plot, strokeToken(env.theme, 'rule'), bandHatch(env.theme, options.hatchStrength));
      // A stacked band's edge (a page-colour line, or the stacked100 separator)
      // moves over the mixes, so the seams between bands stay as the page colour.
      const seams = domain.isStacked && shaded.nodes.length > 0 ? nodes.slice(0, lastFill + 1).filter((node) => (node.part === 'line' && node.owner.seriesId !== undefined) || node.part === 'areaSeparator') : [];
      nodes.splice(lastFill + 1, 0, ...shaded.nodes, ...seams);
      for (const seam of seams) nodes.splice(nodes.indexOf(seam), 1);
      regroundOnShadings(allLabels, shaded.grounds);
    }
  }
  emitForecastDividers(env.theme, area.forecast, xOf, area.forecastPlot, nodes, forecastDividerAt(domain));
  if (domain.isArea) backForecastAreaLabels(allLabels, drawnSeries, cats, plot, input.areaFill, nodes);
  const bandLabelIds = new Set(
    annResult.placed.filter((ann) => ann.kind === 'band').map((ann) => ann.labelId),
  );
  const { tickFont, labelFont } = text;
  const categoryFont = area.catPlan.font;
  const labelNodes = labelsToNodes(env.theme, allLabels, (l) =>
    plan.ratioTierRequestState?.fontByLabelId.get(l.id) ??
    (l.id.startsWith('forecast:') ? text.secondaryFont : bandLabelIds.has(l.id) || l.id.startsWith('tieLabel:')
      ? tickFont
      : l.kind === 'category'
        ? categoryFont
        : l.kind === 'annotation' || l.kind === 'valueLine'
          ? { ...labelFont, weight: emphasisWeight(env.theme) }
          : labelFont), nodes,
  );
  for (const end of input.reserves.endpoint.endLabels) {
    if (!end.valueText || end.shared || end.text === end.s.label || !end.text.endsWith(` ${end.valueText}`)) continue;
    const node = labelNodes.find(n => n.id === `label:${end.id}`);
    if (node?.t !== 'text') continue;
    const endWeight = lineFocus && env.highlights.has(end.s.id) ? emphasisWeight(env.theme) : labelFont.weight;
    if (node.lines.length === 1) node.runs = [
      { text: node.lines[0]!.slice(0, -end.valueText.length), weight: endWeight }, { text: end.valueText, weight: endWeight },
    ];
    else {
      const nameLines = node.lines.slice(0, -1);
      labelNodes.push({ ...node, id: `${node.id}:value`, y: node.y + nameLines.length * text.labelH,
        lines: [end.valueText], font: { ...node.font, weight: endWeight }, role: 'value' });
      node.lines = nameLines;
    }
  }
  // An early endpoint's gutter leader must not read as a data continuation.
  if (!domain.isArea) {
    const earlyEndLeaders = new Set(input.reserves.endpoint.endLabels
      .filter(label => label.ci < cats.length - 1).map(label => `leader:${label.id}`));
    for (const node of labelNodes) {
      if (node.t !== 'path' || node.part !== 'leader' || !plan.endpointLeaderAnchors.has(node.id.slice('leader:'.length))) continue;
      node.stroke = { token: 'leader' };
      if (earlyEndLeaders.has(node.id)) { node.stroke = { token: 'inkMuted' }; node.dash = dashToken(env.theme, 'dotted'); node.lineCap = 'round'; }
    }
  }
  pushAll(nodes, labelNodes);
  // The event lane draws its own text (styled header runs), after the labels.
  if (lane) pushAll(nodes, lane.nodes);
  axes.unshift({
    axis: 'x',
    baselineNodeId: scene.rendered.baselineId,
    ticks: cats.map((c, i) => ({
      at: c.id,
      pos: xOf(i),
      // A continuous axis labels its scale ticks, not its readings.
      labelId: plan.catLabelsShown && !area.xTicks ? `category:${c.id}` : undefined,
    })),
  });
  const variantName = isBump
    ? chartString(domain.options, 'bumpVariant')
    : variant === 'line' ? chartString(domain.options, 'lineName') : variant === 'area' ? chartString(domain.options, 'areaName2') : variant === 'stacked-area' ? chartString(domain.options, 'stackedArea') : chartString(domain.options, 'percentArea');
  // A band reads as the axis does ("$1,000", "12%"): the axis format over
  // the band levels, at the decimals they need; on a 100% composition at the
  // decimals its level needs, which the whole-percent ticks would round.
  const bandLevels = (input.reserves.referenceBands?.entries ?? []).flatMap((entry) => [entry.low, entry.high]);
  const bandFmt = variant === 'stacked100-area'
    ? (v: number) => formatAutomaticPercent(v, autoDecimals(v), false, domain.options.locale?.language)
    : area.axisTickSpec ? tickFormatter(area.axisTickSpec, bandLevels) : area.axisFmt;
  const a11yDesc = lineA11yDesc(env, domain, area, marks, variantName, text) + referenceBandsA11y(input.reserves.referenceBands, bandFmt, domain.options)
    + (usesEndLabelKey(options) ? chartString(domain.options, 'lineEndKeyDesc') : '');
  return {
    type: 'line',
    size: env.size,
    plot,
    // The floor counts data height only, for an area as for a line: a header
    // or an annotation band above the data does not shrink the plot.
    ...(area.forecastPlot !== plot ? { [PLOT_FLOOR_RECT]: area.forecastPlot } : {}),
    scene: nodes,
    labels: lane ? [...allLabels, ...lane.labels] : allLabels,
    axes,
    annotations: lane ? [...annResult.placed, ...lane.placed] : annResult.placed,
    legend: area.frame.legend,
    frame: area.frame.frame,
    marks,
    derived: lineDerived(domain, area, input.reserves, scene, input.ratioTierResult),
    a11y: {
      title:
        accessibleTitle(options.title, chartString(domain.options, 'lineTitle', { v1: variantName, v2: drawnSeries.map((s) => s.label).join(', '), v3: cats.length })),
      // The default title counts periods ("over 24 periods"); a grid reports that count when it prints the title.
      titleCounts: [structureCount('periods', cats.length, undefined, domain.options)],
      counts: [...(domain.anomaly?.model?.counts ?? []), structureCount('series', domain.drawnSeries.length, undefined, domain.options), structureCount('categories', domain.cats.length, undefined, domain.options),
        ...(domain.refSeries.length ? [structureCount('reference-series', domain.refSeries.length, chartString(domain.options, 'referenceSeriesCount', { v1: domain.refSeries.length }))] : []),
        ...(marks.targets ? [structureCount('markers', marks.targets.length, chartString(domain.options, 'targetMarkersCount', { v1: marks.targets.length, v2: marks.targets.length === 1 ? '' : 's' }))] : []),
        ...(marks.phases ? [structureCount('phases', marks.phases.length, chartString(domain.options, 'lifecyclePhasesCount', { v1: marks.phases.length }))] : []),
        ...(domain.bumpDerived?.ties.length ? [structureCount('groups', domain.bumpDerived.ties.length, chartString(domain.options, 'tiedGroupsCount', { v1: domain.bumpDerived.ties.length, v2: domain.bumpDerived.ties.length === 1 ? '' : 's' }))] : [])],
      desc: a11yDesc,
    },
    warnings,
    paintWarningRules: scene.paintWarningRules,
    debug: {
      occupied: input.occupied.snapshot(),
      decisions: [...solved.decisions, ...annResult.decisions],
    },
  };
}

/**
 * When the engine labels the extremes and a series loses one
 * of those values to a collision, the series keeps its first and last point
 * value only, instead of a scatter of survivors. Returns the requests for a
 * second solve, or undefined when no series lost a value. Authored cell
 * labels stay: they are instructions. 'all' asked for every value, so it
 * keeps every value that fits, and each lost one carries its own warning.
 */
function firstLastFallback(domain: LineDomain, requests: LabelRequest[], solved: SolveResult, warnings: LintWarning[]): LabelRequest[] | undefined {
  if (domain.labelModes.values !== 'extremes') return undefined;
  const catIndex = new Map(domain.cats.map((category, index) => [category.id, index] as const));
  const series = new Map(domain.drawnSeries.map((s) => [s.id, s] as const));
  const endsOf = (id: Id): (number | undefined)[] => {
    const row = domain.pv[domain.rowOf.get(series.get(id)!)!]!;
    const drawn = row.flatMap((v, ci) => (v === null ? [] : [ci]));
    return [drawn[0], drawn[drawn.length - 1]];
  };
  // A value lost after ownership limited its seats, or a lost first or last value, goes to the note:
  // the series keeps the max and min the fallback would drop, because the fallback is for crowding.
  const lost = new Set(solved.placed.filter((label) => label.kind === 'point' && label.hidden === 'collision'
    && !solved.ownershipLimited?.has(label.id) && label.owner.seriesId !== undefined && series.has(label.owner.seriesId)
    && !endsOf(label.owner.seriesId).includes(catIndex.get(label.owner.categoryId ?? '')))
    .map((label) => label.owner.seriesId as Id));
  if (lost.size === 0) return undefined;
  const ends = new Map([...lost].map((id) => [id, endsOf(id)] as const));
  for (const id of lost) {
    warnings.push({
      code: 'line-labels-first-last', severity: 'info', owner: { seriesId: id },
      message: `series '${id}' labels its first and last point only: a point value collided with another label, a line or a mark`,
      suggest: 'widen the chart, or label fewer points',
    });
  }
  return requests.map((request) => {
    const id = request.owner.seriesId;
    if (request.kind !== 'point' || id === undefined || !lost.has(id)) return request;
    const ci = catIndex.get(request.owner.categoryId ?? '');
    if (ci === undefined || ends.get(id)!.includes(ci)) return request;
    if (typeof series.get(id)!.vals[ci]?.labelOverride === 'string') return request;
    return { ...request, redundant: true, suppressedAs: 'density' as const };
  });
}

/** The event lane's axis: category centres, or on a continuous axis the x of any value. */
const laneAxis = (area: LineArea, plot: Rect) =>
  area.xOfValue ? { x: area.xOfValue, step: area.step, plot, continuous: true } : { x: area.xOf, step: area.step, plot };

export function layoutLine(
  data: LineChartData,
  authoredOptions: import('../../types/options').LineOptions = {},
): Geometry<LineMarks, LineDerived> {
  // The continuous-axis domain resolves numeric x anchors before the annotation pass reads category ids.
  let options = withLocaleStrings(authoredOptions as LineOptions);
  let geometry = layoutLinePass(data, options);
  // A gap bracket stands right of the labels at the line ends: a pass that
  // found its column short of them is laid out once more with that much margin.
  const widenForBracket = () => {
    const bracketNeed = Math.ceil((geometry as { [GAP_BRACKET_RESERVE]?: number })[GAP_BRACKET_RESERVE] ?? 0);
    if (bracketNeed <= 0) return;
    options = { ...options, [GAP_BRACKET_RESERVE]: bracketNeed } as LineOptions;
    geometry = layoutLinePass(data, options);
  };
  widenForBracket();
  // A bracket whose number found no seat even so is refused: that pass draws
  // its label at the anchor (gap-bracket-unavailable) without the margin.
  const refused = (geometry as { [GAP_BRACKET_REFUSED]?: Id[] })[GAP_BRACKET_REFUSED];
  if (refused) {
    options = { ...options, [GAP_BRACKET_RESERVE]: 0, [GAP_BRACKET_REFUSED]: refused } as LineOptions;
    geometry = layoutLinePass(data, options);
    widenForBracket();
  }
  // a right valueLine label with no seat gets the margin it needs.
  // Measured in the bold label font the valueLine text is drawn in.
  const env = resolveLineEnv(options, []);
  const labelFont = { family: env.theme.type.family, ...env.theme.type.label, weight: emphasisWeight(env.theme) };
  const valueLineReserve = hiddenValueLineReserve(geometry.labels, (text) => env.measure(text, labelFont).width, env.size.width);
  if (valueLineReserve > 0) {
    options = { ...options, [VALUE_LINE_RESERVE]: valueLineReserve } as LineOptions;
    geometry = layoutLinePass(data, options);
  }
  for (let step = 0; step < 2; step++) {
    const bandNeed = Math.ceil((geometry as { [BAND_PAD]?: number })[BAND_PAD] ?? 0);
    if (bandNeed <= 0) break;
    const prevBandPad = (options as { [BAND_PAD]?: number })[BAND_PAD] ?? 0;
    options = { ...options, [BAND_PAD]: prevBandPad + bandNeed } as LineOptions;
    geometry = layoutLinePass(data, options);
  }
  // a rank value with no free seat at a point its name stands at
  // reads in that name, "Name · 19%"; the wider name is laid out again.
  // A value the note line already names stays there.
  if (options.variant === 'bump') {
    const named = new Set(geometry.labels.filter((label) => label.kind === 'series').map((label) => `${label.owner.seriesId}:${label.owner.categoryId}`));
    const noted = (options as { [NOTED_LABELS]?: ReadonlySet<Id> })[NOTED_LABELS];
    // Since the solver thins a computed row as density, a crowded value drops as density too; 'minimal' asks for that thinning.
    const lost = (label: PlacedLabel) => label.hidden === 'collision' || (label.hidden === 'density' && options.labelDensity !== 'minimal');
    const folded = new Map(geometry.labels.filter((label) => label.kind === 'point' && lost(label) && !noted?.has(label.id) &&
      named.has(`${label.owner.seriesId}:${label.owner.categoryId}`)).map((label) => [label.id, label.text]));
    if (folded.size === 0) return geometry;
    const fold = (values: Map<Id, string>) => layoutLinePass(data, { ...options, [BUMP_FOLDED]: values } as LineOptions);
    const refolded = fold(folded);
    // At automatic height a fold only makes the chart taller. At a fixed height it may not turn
    // a drawing into a refusal: a name the value wraps gives that value back to the note line,
    // and if the floor still passes the height, no value folds.
    const fixedHeight = (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height ?? !heightOmitted(options.size);
    const floor = (g: Geometry<LineMarks, LineDerived>) => Math.max(g.frame.minHeight ?? 0, g.frame.plotMinHeight ?? 0);
    const height = geometry.size.height;
    if (!fixedHeight || floor(refolded) <= height || floor(geometry) > height) return refolded;
    const lines = new Map(geometry.labels.map((label) => [label.id, label.lines.length]));
    const before = folded.size;
    for (const label of refolded.labels) {
      if (label.kind === 'series' && label.lines.length > (lines.get(label.id) ?? 1)) folded.delete(`point:${label.owner.seriesId}:${label.owner.categoryId}`);
    }
    if (folded.size === before || folded.size === 0) return geometry;
    const partial = fold(folded);
    return floor(partial) <= height ? partial : geometry;
  }
  // A chart that hides some of its point values and draws no
  // scale of three ticks leaves those values unreadable, so it is laid out
  // again with its value axis. An authored valueAxis.show keeps its word.
  if (options.valueAxis?.show !== undefined) return geometry;
  const ticks = geometry.axes.find((axis) => axis.axis === 'y')?.ticks.filter((tick) => tick.labelId).length ?? 0;
  // A value the note line names is taken off the chart after this pass (markNotedLabels): it counts as hidden.
  const noted = (options as { [NOTED_LABELS]?: ReadonlySet<Id> })[NOTED_LABELS];
  const hidden = geometry.labels.some((label) => label.kind === 'point' && (label.hidden || noted?.has(label.id)) && label.owner.seriesId !== undefined);
  return ticks < 3 && hidden ? layoutLinePass(data, { ...options, valueAxis: { ...options.valueAxis, show: true } }) : geometry;
}

/**
 * On a narrow canvas a plain line whose
 * end names do not fit names its lines where they are drawn, not in a key
 * row; the key row stays the fallback when an inline name finds no seat.
 */
const INLINE_FALLBACK_MAX_WIDTH = 480;

function inlineFallbackApplies(options: LineOptions, domain: LineDomain, env: LineEnv): boolean {
  const legend = typeof options.legend === 'object' ? options.legend.position : options.legend;
  return domain.variant === 'line' && !env.isBump && !domain.fan
    && env.size.width <= INLINE_FALLBACK_MAX_WIDTH && domain.drawnSeries.length >= 2 && domain.drawnSeries.length <= 5
    && options.seriesLabels === undefined && options.labels !== false && options.labels?.series === undefined
    && legend === undefined
    && (options as { [INLINE_FALLBACK]?: boolean })[INLINE_FALLBACK] !== true && !usesEndLabelKey(options);
}

/** The end names did not fit: name the lines inline where that applies, else in the key. */
function endNameFallback(data: LineChartData, options: LineOptions, domain: LineDomain, env: LineEnv): Geometry<LineMarks, LineDerived> {
  if (inlineFallbackApplies(options, domain, env)) {
    return layoutLinePass(data, { ...options, seriesLabels: 'inline', [INLINE_FALLBACK]: true } as LineOptions);
  }
  return layoutLinePass(data, { ...withoutInlineFallback(options), [END_LABEL_KEY]: true } as LineOptions);
}

function withoutInlineFallback(options: LineOptions): LineOptions {
  if ((options as { [INLINE_FALLBACK]?: boolean })[INLINE_FALLBACK] !== true) return options;
  const { seriesLabels: _drop, ...rest } = options;
  return { ...rest, [INLINE_FALLBACK]: false } as LineOptions;
}

/** Internal: solve the diff labels before the chart labels. */
const DIFF_FIRST = Symbol('diffFirst');

function layoutLinePass(
  data: LineChartData,
  options: LineOptions = {},
): Geometry<LineMarks, LineDerived> {
  const warnings: LintWarning[] = [];
  const legendNone = (typeof options.legend === 'object' ? options.legend.position : options.legend) === 'none';
  // A key in place of the author's series names keeps the chart readable but warns; in place of the default names it informs.
  const replaced = (options as { [END_LABEL_KEY]?: true | 'inline' })[END_LABEL_KEY] === 'inline' ? 'inline'
    : options.seriesLabels === 'end' || options.seriesLabels === 'inline' ? options.seriesLabels : undefined;
  const rangeKey = (options as { [END_LABEL_KEY]?: true | 'inline' | 'range' })[END_LABEL_KEY] === 'range';
  if (rangeKey && !legendNone) warnings.push({ code: 'line-end-label-key', severity: 'info',
    message: 'The range continues the fan past its last reading, so the key carries the last values of the centre line and the outer band.' });
  else if (usesEndLabelKey(options) && !legendNone) warnings.push(replaced ? { code: 'line-end-label-key', severity: 'warn',
    message: `seriesLabels: '${replaced}' was overridden: the ${replaced === 'end' ? 'end' : 'inline'} names do not fit, so a key ordered by latest value names the lines`,
    suggest: "shorten the series labels or widen the chart so the names fit, or set seriesLabels: 'key'" } : { code: 'line-end-label-key', severity: 'info',
    message: 'End labels use a key ordered by latest value because they cannot fit within three label line heights of their endpoints.' });
  if (usesEndLabelKey(options) && legendNone) warnings.push({ code: 'legend-none-overridden', severity: 'warn',
    message: `legend: 'none'${replaced ? ` and seriesLabels: '${replaced}' were` : ' was'} overridden: the ${replaced === 'inline' ? 'inline' : 'end'} names do not fit beside the plot, so a key row names the lines`,
    suggest: "shorten the series labels or give the chart more room. To use a key, set seriesLabels: 'none' and legend: 'top'; point values can still need more room.",
    field: ['options', 'legend'] });
  const env = resolveLineEnv(options, warnings);
  const domain = resolveLineDomain(data, options, env, warnings);
  const paints = linePaints(env, domain, warnings);
  const text = lineText(env, domain);
  // A fan cut at its right edge runs on past its last reading, over every seat beside it: the key carries the last values.
  if (domain.fan && domain.x?.range?.cut.hi && !env.isBump && !usesEndLabelKey(options) && domain.labelModes.values !== 'none') {
    return layoutLinePass(data, { ...withoutInlineFallback(options), [END_LABEL_KEY]: 'range' } as LineOptions);
  }
  let reserves = lineReserves(env, domain, paints, text, warnings);
  if (reserves.endpoint.endpointLegendFallback && inlineFallbackApplies(options, domain, env)) return endNameFallback(data, options, domain, env);
  const { size, theme, measure } = env;
  let occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  // The event lane sizes itself and the key with the frame and plot passes.
  const settle = (held: LineReserves, sink: LintWarning[]) => settleEventLane({
    annotations: held.annList, categories: domain.cats, events: options.events, language: options.locale?.language,
    colorblindSafe: options.colorblindSafe, inline: true, footnotesOff: (options as InternalFootnoteOptions).footnotesOff,
    theme, measure, size, compact: options.mode === 'compact',
    solve: (key, w) => ({ ...solveLineFrame(env, domain, paints, text, held, w, key), key }),
    area: (framed, w) => {
      const count = w.length;
      const area = linePlotArea(env, domain, text, held, framed, w);
      // Keep the 80 px compact plot floor; the invalid-base warning remains. The floor is measured on
      // the rect the sizing hold reads (PLOT_FLOOR_RECT in assembleLineGeometry), not on the full plot.
      if (options.mode !== 'compact' || !domain.rebaseSuppressed.length || domain.rebaseCompact || area.forecastPlot.h >= 80) return area;
      domain.rebaseCompact = true;
      w.length = count;
      const next = solveLineFrame(env, domain, paints, text, held, w, framed.key);
      Object.assign(framed, next);
      return linePlotArea(env, domain, text, held, framed, w);
    },
    ...(domain.x ? { scale: laneScale(domain.x) } : {}),
    axis: (area) => laneAxis(area, area.plot),
    warnings: sink,
  });
  const firstWarnings: LintWarning[] = [];
  let settled = settle(reserves, firstWarnings);
  // The end names start just past the line ends, so the margin
  // holds only the part of the column the last category's inset does not.
  // A wider plot only widens that inset, so one more pass settles it.
  const endpoint = reserves.endpoint;
  const inset = settled.area.plot.x + settled.area.plot.w - settled.area.xOf(domain.cats.length - 1);
  if (!reserves.namesAtPlotEdge && endpoint.endLabels.length > 0 && inset > 0.5 && endpoint.endReserve >= settled.framed.margin.right - 0.5) {
    reserves = { ...reserves, endpoint: { ...endpoint, endReserve: Math.max(0, endpoint.endReserve - inset) } };
    settled = settle(reserves, warnings);
  } else pushAll(warnings, firstWarnings);
  // legend: 'none' bars the key row, but end names that squeeze the plot under its width floor
  // would leave a cramped exhibit: the key row names the lines after all (warned above).
  // A pinned end label is the author's seat: the key pass would drop it, so the names stay.
  if (legendNone && !env.isBump && !usesEndLabelKey(options) && reserves.endpoint.endLabels.length > 0
    && !reserves.endpoint.endLabels.some((label) => options.labelPlacements?.[label.id] !== undefined)
    && settled.area.plot.w / size.width < PLOT_W_FLOOR_DEMOTED) {
    return layoutLinePass(data, { ...withoutInlineFallback(options), [END_LABEL_KEY]: true } as LineOptions);
  }
  const framed = settled.framed;
  commitClaims(occupied, framed.claims);
  const area = settled.area;
  const scene = layoutLineMarks(env, domain, area, paints, text, reserves, warnings);
  const anomalyMarks = domain.anomaly ? lineAnomalyMarks(theme, domain, domain.anomaly, area, text, scene, measure) : undefined;
  commitClaims(occupied, scene.claims);
  let plan = planLineLabels(env, domain, area, paints, text, reserves, scene, warnings);
  if (plan.endpointWiden) return layoutLinePass(data, { ...options, [END_LABEL_WIDE]: true } as LineOptions);
  if (plan.endpointFallback && !usesEndLabelKey(options)) return endNameFallback(data, options, domain, env);
  if (anomalyMarks) seatFlaggedValues(plan.labelRequests, domain.anomaly!.seriesId, anomalyMarks);
  // a value folded into its name prints there, not at its point,
  // when the name's fitted lines hold it; otherwise it stays owed.
  const folded = (options as { [BUMP_FOLDED]?: ReadonlyMap<string, string> })[BUMP_FOLDED];
  const hosts = new Map<Id, Id>();
  for (const name of folded ? [...reserves.endpoint.endLabels, ...reserves.startLabels] : []) {
    const id = `point:${name.s.id}:${domain.cats[name.ci]!.id}`;
    if (folded!.has(id) && name.lines.join(' ').includes(`· ${folded!.get(id)}`)) hosts.set(id, name.id);
  }
  for (const request of plan.labelRequests) if (hosts.has(request.id)) Object.assign(request, { redundant: true, suppressedAs: 'redundant' });
  const solveCtx: SolveCtx = labelCtx(theme, size, domain.options, {
    density: env.density,
    measure,
    plot: area.plot,
    labelPad: 2,
    ...(domain.labelModes.values === 'all' && !domain.isStacked ? { valueRows: domain.drawnSeries.map(series => ({
      ids: domain.cats.flatMap((category, ci) => typeof series.vals[ci]?.labelOverride === 'string' ? [] : [`point:${series.id}:${category.id}`]),
      alternate: true,
    })) } : {}),
    // A value reads as its own point's (label/ownership.ts); stacked values sit in their bands.
    ...(domain.isStacked ? {} : {
      pointOwnership: {
        points: scene.marks.series.flatMap((series) => series.points.map((p) => ({ seriesId: series.seriesId, categoryId: p.categoryId, x: p.x, y: p.y }))),
        categoryX: new Map(domain.cats.map((c, ci) => [c.id, area.xOf(ci)])),
      },
    }),
  });
  // a diff label outranks end and point labels. They take their seats
  // first, as without a diff, so arms keep clear of them; only a pass that
  // leaves a diff label without a seat runs again with the diff label first.
  const joint = (options as { [DIFF_FIRST]?: boolean })[DIFF_FIRST] === true;
  let annResult: AnnotatePassResult | undefined;
  const solve = (requests: LabelRequest[]): SolveResult => {
    if (!joint) return solveLabels(requests, occupied, solveCtx);
    annResult = annotateLine(env, domain, area, reserves, scene, occupied, solveCtx, requests);
    const ids = new Set(requests.map((request) => request.id));
    const placed = annResult.labels.filter((label) => ids.has(label.id));
    annResult.labels = annResult.labels.filter((label) => !ids.has(label.id));
    return { placed, decisions: [], warnings: [] };
  };
  let solved = solve(plan.labelRequests);
  if (!env.isBump && (!domain.isArea || domain.x?.range) && !domain.fan && !usesEndLabelKey(options) && reserves.endpoint.endLabels.some(end =>
    solved.placed.some(label => label.id === end.id && label.hidden === 'collision'))) {
    return endNameFallback(data, options, domain, env);
  }
  // An inline name with no seat, chosen by the engine or by the author: the key row names the lines after all.
  // The key pass draws no inline names, so none is left hidden. A visible legend already names every line: it stays as set.
  const legendShown = ['top', 'right', 'bottom'].includes((typeof options.legend === 'object' ? options.legend.position : options.legend) ?? 'none');
  if (((options as { [INLINE_FALLBACK]?: boolean })[INLINE_FALLBACK] === true || (options.seriesLabels === 'inline' && !legendShown)) &&
    solved.placed.some(label => label.kind === 'series' && label.hidden !== undefined)) {
    const { seriesLabels: _names, ...keyed } = withoutInlineFallback(options);
    return layoutLinePass(data, { ...keyed, [END_LABEL_KEY]: usesInlineFallback(options) ? true : 'inline' } as LineOptions);
  }
  const fallback = firstLastFallback(domain, plan.labelRequests, solved, warnings);
  if (fallback) {
    // The second solve starts from the frame and the marks again.
    occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
    commitClaims(occupied, framed.claims);
    commitClaims(occupied, scene.claims);
    plan = { ...plan, labelRequests: fallback };
    solved = solve(fallback);
  }
  // A running period keeps a cue: where a running value does not print the to-date words (checked after
  // the first/last fallback, which can drop it), or they are wider than the drawn category step (a line
  // has no column to bound them), the axis name carries them.
  const toDate = lineToDateIds(env, domain, text);
  if (toDate.size > 0 && ((!domain.x && !toDateFits(options.strings?.toDate ?? chartString(options, 'toDate'), env.theme, env.measure, area.step))
    || domain.cats.some((c, ci) => toDate.has(c.id) && domain.drawnSeries.some((s) => (s.vals[ci]?.v ?? null) !== null
    && !solved.placed.some((l) => l.id === `point:${s.id}:${c.id}` && l.hidden === undefined && l.lines.length > 1))))) {
    return layoutLinePass(data, { ...options, [PARTIAL_KEY]: true } as LineOptions);
  }
  // Words under a running reading that the tick and day rows push out get a row of their own.
  const droppedWords = solved.placed.filter((l) => l.id.startsWith('xpartial:') && l.hidden !== undefined);
  if (domain.x && droppedWords.length && !(options as { [X_PARTIAL_ROW]?: true })[X_PARTIAL_ROW]) {
    return layoutLinePass(data, { ...options, [X_PARTIAL_ROW]: true } as LineOptions);
  }
  // Words that find no seat in their own row either are named, so they never vanish without a trace.
  for (const label of droppedWords) {
    const names = plan.xPartialGroups[Number(label.id.slice('xpartial:'.length))] ?? [];
    warnings.push({
      code: 'x-partial-words-dropped', severity: 'warn',
      message: `"${label.text}" for the running reading${names.length === 1 ? '' : 's'} ${names.join(', ')} did not print: no seat under the axis is free. The hollow marker and the hover card still mark ${names.length === 1 ? 'it' : 'them'}`,
      suggest: 'give the chart more width, or mark fewer readings in data.partial',
    });
  }
  // If short leaders cannot seat every end value, the existing key names all of them together.
  if (!env.isBump && (!domain.isArea || domain.x?.range) && !domain.fan && domain.drawnSeries.length <= 5 && !usesEndLabelKey(options)
    && options.seriesLabels !== 'key' && options.seriesLabels !== 'none' &&
    solved.placed.some(label => label.kind === 'point' && label.hidden === 'collision' &&
      (label.owner.categoryId === domain.cats[domain.lastIdxOf.get(label.owner.seriesId ?? '') ?? -1]?.id
        || domain.x?.range && domain.isArea && label.owner.categoryId === domain.cats[0]?.id))) {
    return layoutLinePass(data, { ...withoutInlineFallback(options), [END_LABEL_KEY]: true } as LineOptions);
  }
  keepEndValueOrder(solved.placed, plan.labelRequests, solveCtx.pins);
  applyValueAxisTitleInk(solved.placed);
  for (const label of solved.placed) if (hosts.has(label.id)) label.printedIn = hosts.get(label.id)!;
  pushAll(warnings, solved.warnings);
  const ratioTierResult = settleLineLabels(env, area, scene, plan, solved, occupied, warnings);
  annResult ??= annotateLine(env, domain, area, reserves, scene, occupied, solveCtx, undefined, solved.placed);
  const diffHidden = annResult.placed.some((ann) => ann.kind === 'diff' && annResult!.labels.some((label) => label.id === ann.labelId && label.hidden === 'collision'));
  if (!joint && diffHidden) return layoutLinePass(data, { ...options, [DIFF_FIRST]: true } as LineOptions);
  pushAll(warnings, annResult.warnings);
  const lane = settled.lane
    ? emitEventLane(theme, {
        ...settled.lane,
        axis: laneAxis(area, area.forecastPlot),
        mode: domain.isArea ? 'stop' : 'through', baseline: area.plot.y + area.plot.h, occupied, solveCtx,
      })
    : undefined;
  if (lane) pushAll(warnings, lane.warnings);
  const geometry = assembleLineGeometry({
    env, domain, area, text, reserves, scene, plan, solved, annResult, ratioTierResult, occupied, warnings, lane, areaFill: paints.areaFill, seriesPaint: paints.keyPaint,
  });
  // Read by layoutLine only; a symbol key stays out of the published geometry.
  if (annResult.gapBracketNeed > 0) Object.assign(geometry, { [GAP_BRACKET_RESERVE]: annResult.gapBracketNeed });
  if (annResult.gapBracketHidden.length > 0) Object.assign(geometry, { [GAP_BRACKET_REFUSED]: annResult.gapBracketHidden });
  if (annResult.bandNeed > 0) Object.assign(geometry, { [BAND_PAD]: annResult.bandNeed });
  // The tie key seat over a bump plot sits in the header gap.
  // When the word for the ring has no seat, the plot gives it half a line more
  // headroom (layoutLine adds the pad at most twice), instead of hiding it.
  if (options.variant === 'bump') {
    const tie = geometry.labels.find((label) => label.id.startsWith('tieLabel:') && label.hidden === 'collision');
    if (tie) {
      const need = Math.ceil((tie.rect?.h ?? text.labelH) / 2) + 2;
      Object.assign(geometry, { [BAND_PAD]: Math.max((geometry as { [BAND_PAD]?: number })[BAND_PAD] ?? 0, need) });
    }
  }
  return geometry;
}

/**
 * The values beside the line ends at one category read top to
 * bottom in the order of their ends (equal ends: authored order). The solver
 * seats them one by one, so a later value can take the step over an earlier
 * one; the seats it found are handed out again in that order.
 */
function keepEndValueOrder(placed: PlacedLabel[], requests: readonly LabelRequest[], pins: Readonly<Record<string, unknown>>): void {
  const index = new Map(requests.map((request, i) => [request.id, i]));
  const anchorOf = (label: PlacedLabel) => requests[index.get(label.id)!]?.candidates.find((candidate) => candidate.slot === label.slot)?.leaderFrom
    ?? { x: label.rect.x - 7, y: label.rect.y + label.rect.h / 2 };
  const groups = new Map<Id | undefined, PlacedLabel[]>();
  for (const label of placed) {
    if (label.kind !== 'point' || label.hidden !== undefined || !index.has(label.id) || pins[label.id] !== undefined || requests[index.get(label.id)!]?.pinnedSlot !== undefined || !(label.slot === 'right' || label.slot.startsWith('rightStep'))) continue;
    groups.set(label.owner.categoryId, [...(groups.get(label.owner.categoryId) ?? []), label]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const anchors = new Map(group.map((label) => [label, anchorOf(label)]));
    const seats = group.map((label) => ({ x: label.rect.x, y: label.rect.y, slot: label.slot })).sort((a, b) => a.y - b.y);
    const order = [...group].sort((a, b) => anchors.get(a)!.y - anchors.get(b)!.y || index.get(a.id)! - index.get(b.id)!);
    order.forEach((label, i) => {
      const seat = seats[i]!;
      if (seat.y === label.rect.y) return;
      label.rect = { ...label.rect, x: seat.x, y: seat.y };
      label.slot = seat.slot;
      const leader = seatLeader(label.rect, anchors.get(label)!);
      if (leader) label.leader = leader;
      else delete label.leader;
    });
  }
}

/** A placed label in a smaller font keeps its centre: its box shrinks around the same middle line. */
function shrinkPlacedLabel(label: PlacedLabel, old: FontSpec, font: FontSpec): void {
  label.typeRole = 'secondary';
  const dh = label.lines.length * (old.size - font.size) * (old.lineHeight ?? 1.2);
  label.font = font;
  if (dh > 0 && !label.rotate && label.capHeight === undefined) label.rect = { ...label.rect, y: label.rect.y + dh / 2, h: label.rect.h - dh };
}
