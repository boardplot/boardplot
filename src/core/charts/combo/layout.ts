import { copyFrame } from '../../footer';
import { sk, stackParts } from '../band/stacks';
import { chartString } from '../../strings/combo';
import { withSegmentSeams } from '../../markVisibility';
import { withLocaleStrings } from '../../strings';
import { emphasisWeight, secondaryFont, strokeToken } from '../../theme';
import { structureCount } from '../../structureCounts';
/**
 * Combo chart (registry type 'combo') — column + line/area over
 * one ChartData; `Series.kind` does the switching ('column' default). All
 * column-kind series stack into ONE group per category (column chart's
 * stacking approach); line/area series draw over them, lines on top.
 *
 * Secondary axis is gated: `series.axis: 'secondary'` without
 * `options.secondaryAxis.acknowledge` is refused with the error-severity
 * lint 'dual-axis' in every path. Acknowledged, the right-hand axis gets
 * an independent nice domain whose tick COUNT is synced to the primary
 * (same number of ticks ⇒ shared gridline rows) and always warns 'dual-axis'.
 *
 * `options.secondaryAxis.ruler` is the other right-hand axis: a RELABELLING of
 * the primary domain as a share of a declared total. It creates no second
 * scale, so it never carries 'dual-axis'; it pins the primary domain to the
 * total so the top tick row is exactly 100%, and it reserves and claims the
 * right gutter through the same emit as the secondary axis.
 *
 * `layoutCombo` runs five phases, each a function from typed structs
 * to one new struct:
 *   1. domain and scales: `resolveComboDomain` (domain.ts), then
 *      `solveComboFrame` and `comboPlotArea` (plot.ts);
 *   2. mark geometry: `layoutComboMarks` (marks.ts);
 *   3. label planning: `planComboLabels` (labels.ts), then `solveLabels`;
 *   4. annotations: `runAnnotatePass`;
 *   5. geometry assembly: `assembleComboGeometry`.
 * No phase writes to the run's OccupiedIndex. The frame and the marks claim
 * into fresh indexes of their own, which this function commits in claim
 * order. Label planning then reads the committed index through a read-only
 * `OccupiedView` (the grand-total rhythm and the end-label pairing), and
 * only the solver and the annotation pass write to it.
 */

import { nextStaircase, runStaircase, seatStaircase, STAIRCASE, STAIRCASE_MAX_PAD } from '../../label/staircase';
import { withBandValueNotes } from '../band/valueNotes';
import { partialIds } from '../../partialPeriod';
import { NOT_AVAILABLE } from '../../format';
import { NO_STACK_MEAN, noTotal } from '../../stackAdds';
import { emitForecastDividers, placeForecastHeaders } from '../line/forecast';
import { haloOverRules, raiseOverRules } from '../band/labels';
import type { AnchorResolution, AnnotatePassResult } from '../../annotate';
import { BAND_PAD, hiddenValueLineReserve, VALUE_LINE_RESERVE } from '../../annotateParts';
import { emitEventLane, percentLevels, runAnnotatePass, settleEventLane } from '../../annotatePass';
import { categoryTargetFields, spliceAnnotationNodes } from '../../annotateFields';
import { rectSeriesAdjacentWarnings } from '../../adjacentSeries';
import { rectsOverlap, type Rect } from '../../geometry';
import { labelsToNodes } from '../../label/emit';
import { createOccupiedIndex, type OccupiedIndex } from '../../label/occupied';
import { solveLabels, type LabelRequest, type SolveCtx, type SolveResult } from '../../label/solver';
import type { TickBandDerived } from '../../label/tickRow';
import { accessibleTitle } from '../../normalize/shared';
import { bandSizing } from '../../sizing';
import type { AnchorRef } from '../../types/annotations';
import type { Id } from '../../types/cell';
import type { ChartData } from '../../types/data';
import type { Geometry, LintWarning, PaintWarningRule, PlacedLabel, SceneNode } from '../../types/scene';
import { applyComboAxisTitlePaint, comboAxisTitleSwatches } from './axisTitles';
import { resolveComboDomain, resolveComboEnv, TOTALS_AXIS, FLOAT_BAND_CLEARANCE, LINE_BAND_CLEARANCE } from './domain';
import { comboValueLabels, FIRST_END_BELOW_TOTALS, flagDroppedEndpointLabels, INSIDE_ENDPOINT_IDS, insideEndpointGutters, unusedEndpointGutters, type EndpointGutters } from './endpoints';
import { applyGrowthInk, planComboLabels } from './labels';
import { layoutComboMarks } from './marks';
import { MARKER_R, type ComboArea, type ComboDomain, type ComboEnv, type ComboMarkGeometry, type ComboPaints } from './model';
import { comboPaints, contentOf, comboPlotArea, refitComboFrame, solveComboFrame, toDateOnTotals } from './plot';
import { PARTIAL_KEY, toDateFits, toDateRoom } from '../../partialPeriod';
import type { ComboOptions } from '../../types/options';
import { DEFER_DENSITY_NOTES, DENSITY_VALUES, DENSITY_LAYOUT_OPTIONS, authoredNotes, noteCap, noteLine, POINTED_NOTES, withAuthoredFootnotes, type InternalFootnoteOptions } from '../../frame';
import { categoryNotesDiffer, FORCE_CATEGORY_RANKS, rankNotes } from './categoryRanks';
import type { EmittedLane } from '../../eventLane';
import { ANOMALY_FLAG_GAP, ANOMALY_FLAG_H, anomalyA11y, anomalyReceipt, columnCorridorPaint, lineAnomalyFurniture, seatFlaggedValues } from '../column/anomaly';
import type { AnomalyDerived } from '../column/types';
import type { LineAnomaly } from '../line/model';
import { fillShadingKinds, fillShadings, regroundOnShadings, withoutEvents } from '../line/marks';
import { bandHatch } from '../line/scene';
import { pushAll } from '../../arrays';

export interface ComboMarks {
  /** One stacked group per category (single column series ⇒ one segment). */
  columns: {
    categoryId: Id;
    rect: Rect;
    segments: { seriesId: Id; rect: Rect; nodeId: Id }[];
  }[];
  /** One entry per line/area-kind series with at least one plotted point. */
  lines: {
    seriesId: Id;
    kind: 'line' | 'area';
    axis: 'primary' | 'secondary';
    nodeId: Id; // the line path
    fcNodeId?: Id;
    areaNodeId?: Id; // area-kind only: the fill path under the line
    points: { categoryId: Id; x: number; y: number; markerNodeId?: Id }[];
  }[];
}

export interface ComboDerived {
  /** Column-part stack totals per category (empty when no column series). */
  stackTotals: Record<Id, number>;
  /** The column-series parts of each total in stackTotals, per category × series. */
  stackParts: Record<Id, Record<Id, number>>;
  /** Acknowledged secondary axis only: its nice [min, max] domain. */
  secondaryDomain?: [number, number];
  /** The anomaly rule over the line series and what it flagged (options.anomaly). */
  anomaly?: AnomalyDerived;
  /** The tick-band receipt: absent only when the category tick row is not rendered. */
  tickBand?: TickBandDerived;
}

/** The corridor rules and flag markers over the one line series (options.anomaly), on its own axis. */
function comboAnomalyMarks(env: ComboEnv, domain: ComboDomain, anomaly: LineAnomaly, area: ComboArea, geometry: ComboMarkGeometry) {
  const line = geometry.marks.lines.find((mark) => mark.seriesId === anomaly.seriesId);
  const onSecondary = line?.axis === 'secondary';
  const series = domain.lines.find((s) => s.id === anomaly.seriesId)!;
  return lineAnomalyFurniture(env.theme, { strings: domain.options.strings,
    anomaly: anomaly.model, corridorShown: anomaly.corridorShown, statFmt: anomaly.statFmt, fmt: domain.scaleFmtOf(series),
    corridorPaint: columnCorridorPaint(domain.options.colorblindSafe), plot: area.plot, y: onSecondary ? area.y2 : area.y,
    labelX: area.anomalyLabelX,
    seriesId: anomaly.seriesId, points: line?.points ?? [], font: area.labelFont, measure: env.measure,
    nodes: geometry.nodes, claims: geometry.claims,
  });
}

/** Phase 4: annotations. Stack totals for column categories; {seriesId, categoryId} points for lines. */
function annotateCombo(
  env: ComboEnv,
  domain: ComboDomain,
  area: ComboArea,
  geometry: ComboMarkGeometry,
  occupied: OccupiedIndex,
  solveCtx: SolveCtx,
  labelRequests?: LabelRequest[],
): AnnotatePassResult {
  const { cats, columns, secondaryActive, secondaryDomain } = domain;
  const secondarySeries = domain.lines.filter(series => series.axis === 'secondary');
  const { band, y, y0, y2, plot } = area;
  const catIndex = new Map(cats.map((c, i) => [c.id, i] as const));
  const lineById = new Map(domain.lines.map((s) => [s.id, s] as const));
  const resolveAnchor = (ref: AnchorRef): AnchorResolution | null => {
    const norm = typeof ref === 'string' ? { categoryId: ref, edge: 'total' as const } : ref;
    if (!('categoryId' in norm)) return null;
    const ci = catIndex.get(norm.categoryId);
    if (ci === undefined) return null;
    const c = cats[ci]!;
    if (norm.seriesId) {
      const owner = { categoryId: c.id, seriesId: norm.seriesId };
      const named = [...columns, ...domain.lines, ...domain.refs].find((s) => s.id === norm.seriesId);
      const series = { format: named?.format, ...(named && columns.length + domain.lines.length > 1 ? { series: { id: named.id, label: named.label } } : {}) };
      const reference = domain.refs.find((s) => s.id === norm.seriesId);
      if (reference && geometry.nodes.some((node) => node.id === `ref:${reference.id}:${c.id}`)) {
        const v = reference.vals[ci]!.v;
        if (v === null) return null;
        return { x: band.center(ci), y: y(v), value: v, date: c.date, label: c.label, owner, ...series };
      }
      const ls = lineById.get(norm.seriesId);
      if (ls) {
        const v = ls.vals[ci]!.v;
        if (v === null) return null;
        const yFor = ls.axis === 'secondary' && secondaryActive ? y2 : y;
        return { x: band.center(ci), y: norm.edge === 'start' ? y0 : yFor(v), value: v, date: c.date, label: c.label, owner, lineAnchored: true, ...series };
      }
      const e = geometry.segEdges.get(sk(norm.seriesId, c.id));
      if (!e) return null;
      const edge = norm.edge ?? 'end';
      const yy = edge === 'start' ? y(e.v0) : edge === 'end' ? y(e.v1) : y(Math.max(e.v0, e.v1));
      return { x: band.center(ci), y: yy, value: e.v, date: c.date, label: c.label, owner, ...series };
    }
    // category level: column stack total
    if (columns.length === 0) return null;
    const topPlotted = domain.posTop[ci]! > 0 ? domain.posTop[ci]! : domain.negBot[ci]!;
    return { x: band.center(ci), y: norm.edge === 'start' ? y0 : y(topPlotted), value: domain.stackTotals[c.id]!, format: columns.length === 1 ? columns[0]!.format : undefined, ...noTotal(domain.columnsAdd, domain.anyByCat[ci]!), date: c.date, label: c.label, owner: { categoryId: c.id } };
  };
  // extend the rect liftArm sees upward into the reserved headroom
  const lift = area.topPad - area.axisTitles.height - 8;
  const annPlot: Rect = { x: plot.x, y: plot.y - lift, w: plot.w, h: plot.h + lift };
  const ceilingRects: Rect[] = [
    ...(area.axisTitles.height > 0 ? [{ x: area.frame.plot.x, y: area.frame.plot.y, w: area.frame.plot.w, h: area.axisTitles.height }] : []),
    ...area.valueLineRows.values(),
  ];
  return runAnnotatePass({
    target: domain.options.target,
    // The growth bracket seats its label on its run.
    cagrLabelOnArm: true,
    // Events belong to the event lane.
    annotations: withoutEvents(domain.options.annotations ?? []),
    resolve: resolveAnchor,
    defaultSpan: cats.length >= 2 && columns.length > 0 ? { from: cats[0]!.id, to: cats[cats.length - 1]!.id } : undefined,
    occupied,
    plot: annPlot,
    bandCeiling: area.frame.plot.y,
    ceilingRects,
    valueLineRows: area.valueLineRows,
    theme: env.theme,
    measure: env.measure,
    format: domain.options.format,
    locale: domain.options.locale?.language,
    strings: domain.options.strings,
    valueLinePercentLevels: domain.options.unit === '%' || percentLevels([...columns, ...domain.lines.filter(series => series.axis === 'primary')]),
    secondaryPercentLevels: Boolean(domain.options.secondaryAxis?.ruler) || secondarySeries.length > 0 && secondarySeries.every(series => series.unit === '%' || percentLevels([series])),
    secondaryFormat: secondarySeries.every(series => series.format === secondarySeries[0]?.format) ? secondarySeries[0]?.format : undefined,
    solveCtx,
    labelRequests,
    yScale: y,
    ...(secondaryDomain ? { ySecondaryScale: y2 } : {}),
    meanValue: geometry.meanValue,
    ...(domain.columnsAdd ? {} : { meanMissing: NO_STACK_MEAN }),
    meanSpan: domain.meanSpan,
    partialCategories: partialIds(cats),
    // Category bands for the band annotation, as on column.
    ...categoryTargetFields(cats.map((c) => c.id), plot, (i) => band.center(i), 'x'),
  });
}

/** Phase 5: the scene in paint order, the x axis, the derived record, the description and the paint lint. */
function assembleComboGeometry(input: {
  env: ComboEnv;
  domain: ComboDomain;
  area: ComboArea;
  paints: ComboPaints;
  geometry: ComboMarkGeometry;
  solved: SolveResult;
  annotated: AnnotatePassResult;
  occupied: OccupiedIndex;
  warnings: LintWarning[];
  lane: EmittedLane | undefined;
}): Geometry<ComboMarks, ComboDerived> {
  const { env, domain, area, geometry, solved, annotated, warnings, lane } = input;
  const { cats, columns, lines, refs, fmt, stackTotals, secondaryDomain } = domain;
  const { frame, catPlan, band, plot, showCatTickRow, strongFont, labelFont, tickFont } = area;
  const catFont = catPlan.font;
  const allLabels: PlacedLabel[] = [...solved.placed, ...annotated.labels];
  const nodes = [...frame.nodes, ...geometry.nodes];
  // A band shades behind the marks, as on column.
  spliceAnnotationNodes(nodes, annotated.nodes);
  // An area fill covers the shadings behind it: they draw through it, under the columns
  // (fillShadings), and a value on its own fill takes its ink against the mix it lies on.
  const lastFill = nodes.reduce((at, node, i) => (node.part === 'area' ? i : at), -1);
  if (lastFill >= 0) {
    const outlines = geometry.areaGrounds.map((ground, k) => ({ id: `${ground.seriesId}:${k}`, seriesId: ground.seriesId, top: [...ground.top], bottom: [...ground.bottom], paint: ground.paint, forecast: false }));
    const shaded = fillShadings(nodes, outlines, fillShadingKinds(withoutEvents(domain.options.annotations ?? [])), area.plot, strokeToken(env.theme, 'rule'), bandHatch(env.theme, domain.options.hatchStrength));
    // A page-colour gap keeps each column apart from the fill and the mixes behind it,
    // whatever their colours, as the seams between stacked bands do.
    const gap = strokeToken(env.theme, 'rule');
    const gaps = geometry.marks.columns.filter((column) => column.segments.length > 0).map(({ categoryId, rect }): SceneNode => ({
      t: 'rect', id: `columnGap:${categoryId}`, rect: { x: rect.x - gap, y: rect.y - gap, w: rect.w + 2 * gap, h: rect.h + 2 * gap },
      fill: { token: 'background' }, owner: {}, part: 'columnGap',
    }));
    nodes.splice(lastFill + 1, 0, ...shaded.nodes, ...gaps);
    regroundOnShadings(allLabels, shaded.grounds);
  }
  const bandLabelIds = new Set(annotated.placed.filter((ann) => ann.kind === 'band').map((ann) => ann.labelId));
  pushAll(nodes, labelsToNodes(env.theme, allLabels, (l) =>
      l.id.startsWith('forecast:') ? secondaryFont(env.theme) : bandLabelIds.has(l.id) || l.id.startsWith('tick:')
        ? tickFont
        : l.kind === 'grandTotal' || l.kind === 'total'
        ? strongFont
        : l.kind === 'category'
          ? area.stairTop !== undefined ? tickFont : catFont
          : l.kind === 'annotation' || l.kind === 'valueLine'
            ? { ...labelFont, weight: emphasisWeight(env.theme) }
            : labelFont, nodes,
    ));
  // The event lane draws its own text (styled header runs), after the labels.
  if (lane) pushAll(nodes, lane.nodes);
  const axes = [
    {
      axis: 'x' as const,
      baselineNodeId: 'axis:baseline',
      ticks: cats.map((c, i) => ({ at: c.id, pos: band.center(i), labelId: showCatTickRow || area.stairTop !== undefined ? `category:${c.id}` : undefined })),
    },
    ...geometry.axes,
  ];
  const partsDesc = [
    columns.length > 0 ? chartString(domain.options, 'stackedColumnSeriesDesc', { v1: columns.length, v2: columns.map((s) => s.label).join(', ') }) : '',
    lines.length > 0 ? chartString(domain.options, 'lineAreaSeriesDesc', { v1: lines.length, v2: lines.map((s) => s.label).join(', ') }) : '',
    refs.length > 0 ? chartString(domain.options, 'referenceSeriesCount', { v1: refs.length }) : '',
  ]
    .filter(Boolean)
    .join(chartString(domain.options, 'plusClause'));
  // the column stack states totals only when its parts add; one column series is its own total.
  const totalsAdd = columns.length > 0 && domain.columnsAdd;
  const a11yDesc =
    chartString(domain.options, 'comboDescStart', { v1: cats.length, v2: partsDesc }) +
    (domain.secondaryActive ? chartString(domain.options, 'secondaryAxisDesc') : '') +
    (totalsAdd ? chartString(domain.options, 'columnTotalsSentence', { v1: cats.map((c, ci) => `${c.label ?? c.id} ${domain.anyByCat[ci] ? fmt(stackTotals[c.id]!) : NOT_AVAILABLE}`).join(', ') }) : '.') +
    anomalyA11y({ options: domain.options, anomaly: domain.anomaly, fmt: domain.anomaly ? domain.scaleFmtOf(domain.lines.find((s) => s.id === domain.anomaly!.seriesId)!) : fmt, cats });
  const paintWarningRules: PaintWarningRule[] = [];
  pushAll(warnings, rectSeriesAdjacentWarnings(nodes, input.paints.css, 'vertical', env.highlights, env.theme, { rules: paintWarningRules, before: warnings.filter(warning => !['pie-ramp-crowded', 'likert-ramp-invisible', 'band-lightness-insufficient', 'series-adjacent-similar', 'highlight-reads-as-loss'].includes(warning.code)).length }));
  const catTickMaxLines = catPlan.maxLines;
  const clearance = (domain.options as ComboOptions & { [LINE_BAND_CLEARANCE]?: number })[LINE_BAND_CLEARANCE];
  const floatClearance = (domain.options as ComboOptions & { [FLOAT_BAND_CLEARANCE]?: number })[FLOAT_BAND_CLEARANCE];
  return {
    type: 'combo',
    ...(clearance === undefined ? {} : { [DENSITY_LAYOUT_OPTIONS]: { [LINE_BAND_CLEARANCE]: clearance, [FLOAT_BAND_CLEARANCE]: floatClearance } }),
    size: env.size,
    // Bands stretch to the frame, so the layout reports the width its
    // categories actually want and a host can shrink the canvas to it.
    sizing: bandSizing('combo', env.size, plot.w, band.step),
    plot,
    ...(annotated.bandNeed > 0 ? { [BAND_PAD]: annotated.bandNeed } : {}),
    scene: withSegmentSeams(nodes, env.theme),
    labels: lane ? [...allLabels, ...lane.labels] : allLabels,
    axes,
    annotations: lane ? [...annotated.placed, ...lane.placed] : annotated.placed,
    legend: frame.legend,
    frame: frame.frame,
    marks: geometry.marks,
    derived: {
      stackTotals: totalsAdd ? stackTotals : {},
      stackParts: totalsAdd ? stackParts(stackTotals, cats, columns, (si, ci) => columns[si]!.vals[ci]!.v) : {},
      ...(domain.roundingAdjustments.length > 0 && contentOf(domain, 'segment', ['absolute'])?.includes('percent') ? { roundingAdjustments: domain.roundingAdjustments } : {}),
      ...(domain.anomaly ? { anomaly: anomalyReceipt(domain.anomaly.model) } : {}),
      ...(secondaryDomain ? { secondaryDomain } : {}),
      ...(showCatTickRow
        ? {
            tickBand: {
              reserved: area.catBandH,
              measuredLines: catTickMaxLines,
              lineHeight: catFont.size * 1.2,
              extra: catPlan.rowHeight - catTickMaxLines * catFont.size * 1.2,
              dateNumeric: area.dateNumericTicks,
              position: 'below' as const,
            },
          }
        : {}),
    },
    a11y: {
      title:
        accessibleTitle(domain.options.title, chartString(domain.options, 'comboTitle', { v1: domain.data.map((s) => s.label).join(', '), v2: cats.length })),
      counts: [...(domain.anomaly?.model?.counts ?? []), structureCount('categories', cats.length, undefined, domain.options),
        ...(columns.length ? [structureCount('series', columns.length, chartString(domain.options, 'stackedColumnSeriesCount', { v1: columns.length }))] : []),
        ...(lines.length ? [structureCount('series', lines.length, chartString(domain.options, 'lineAreaSeriesCount', { v1: lines.length }))] : []),
        ...(refs.length ? [structureCount('reference-series', refs.length, chartString(domain.options, 'referenceSeriesCount', { v1: refs.length }))] : [])],
      desc: a11yDesc,
    },
    warnings,
    paintWarningRules,
    debug: {
      occupied: input.occupied.snapshot(),
      decisions: [...solved.decisions, ...annotated.decisions],
    },
  };
}

/** Replays a phase's claims, in claim order, into the run's index. */
function commitClaims(occupied: OccupiedIndex, phase: OccupiedIndex): void {
  for (const c of phase.snapshot()) occupied.claim(c.rect, c.kind, c.owner, c.part);
  if (phase.tickColumns) occupied.tickColumns = phase.tickColumns;
}

/** Internal option: the category notes (rank mapping, cut names) are in; the refit happens once. */
const CATEGORY_NOTED = Symbol('categoryNoted');
/** Internal: the values the note line names so far (label id to category index and item), and the runs it took. */
const UNPRINTED = Symbol('unprintedValues');
interface Unprinted { named: Map<string, [number, string]>; runs: number }

export function layoutCombo(
  data: ChartData,
  options: ComboOptions = {},
  gutterOverride?: EndpointGutters,
): Geometry<ComboMarks, ComboDerived> {
  const geo = withBandValueNotes(data, withLocaleStrings(options), next => {
    let cur = next;
    let geometry = layoutComboPass(data, cur, gutterOverride);
    for (let step = 0; step < 2; step++) {
      const bandNeed = Math.ceil((geometry as { [BAND_PAD]?: number })[BAND_PAD] ?? 0);
      if (bandNeed <= 0) break;
      const prevBandPad = (cur as { [BAND_PAD]?: number })[BAND_PAD] ?? 0;
      cur = { ...cur, [BAND_PAD]: prevBandPad + bandNeed } as ComboOptions;
      geometry = layoutComboPass(data, cur, gutterOverride);
    }
    delete (geometry as { [BAND_PAD]?: number })[BAND_PAD];
    return geometry;
  });
  // The final footer pass counts density omissions after sizing. Its note
  // must not send the chart through a different value-label selection.
  return Object.assign(geo, { [DEFER_DENSITY_NOTES]: true });
}

interface ComboFrameSeed {
  domain: ComboDomain;
  framed: ReturnType<typeof solveComboFrame>;
  warnings: LintWarning[];
}

interface ComboNoteMarks {
  area: ComboArea;
  geometry: ComboMarkGeometry;
}

/** A note can change its text without changing the plot or any mark. */
function sameMarkArea(a: ComboArea, b: ComboArea): boolean {
  return (['x', 'y', 'w', 'h'] as const).every(key => a.plot[key] === b.plot[key])
    && a.rightTickX === b.rightTickX
    && a.band.range.every((value, i) => value === b.band.range[i])
    && a.band.bandwidth === b.band.bandwidth && a.band.step === b.band.step
    && a.y.domain.every((value, i) => value === b.y.domain[i])
    && a.y.range.every((value, i) => value === b.y.range[i])
    && a.y2.domain.every((value, i) => value === b.y2.domain[i])
    && a.y2.range.every((value, i) => value === b.y2.range[i]);
}

function layoutComboPass(
  data: ChartData,
  options: ComboOptions = {},
  /** Internal: the end-label gutters of a second run (see unusedEndpointGutters). */
  gutterOverride?: EndpointGutters,
  noteMarks?: ComboNoteMarks,
): Geometry<ComboMarks, ComboDerived> {
  const warnings: LintWarning[] = [];
  const env = resolveComboEnv(options, warnings);
  const domain = resolveComboDomain(data, options, warnings, env.theme);
  const paints = comboPaints(env, domain);
  return layoutComboFramePass(data, options, gutterOverride, env, domain, paints, warnings, undefined, noteMarks);
}

/** An inside-end reserve changes the plot and marks, but keeps the prepared data and scales. */
function layoutComboFramePass(
  data: ChartData,
  options: ComboOptions,
  gutterOverride: EndpointGutters | undefined,
  env: ComboEnv,
  domain: ComboDomain,
  paints: ComboPaints,
  domainWarnings: LintWarning[],
  frameSeed?: ComboFrameSeed,
  noteMarks?: ComboNoteMarks,
): Geometry<ComboMarks, ComboDerived> {
  const warnings = [...domainWarnings];
  const { size } = env;
  const hasEvents = domain.options.annotations?.some(annotation => annotation.kind === 'event');
  // A clean frame stays independent of the plot's measured height floor.
  // Event lanes still settle from scratch because the band changes their key.
  const solve = (key: Parameters<typeof solveComboFrame>[4], out: LintWarning[]) => {
    if (hasEvents) return solveComboFrame(env, domain, paints, out, key);
    const retained = frameSeed && refitComboFrame(env, frameSeed.domain, domain, frameSeed.framed);
    if (!retained) {
      const frameWarnings: LintWarning[] = [];
      frameSeed = { domain, framed: solveComboFrame(env, domain, paints, frameWarnings, key), warnings: frameWarnings };
    } else frameSeed = { ...frameSeed!, domain, framed: retained };
    pushAll(out, frameSeed.warnings);
    const framed = frameSeed.framed;
    return { ...framed, frame: { ...framed.frame, frame: copyFrame(framed.frame.frame) } };
  };
  // The event lane sizes itself and the key with the frame and plot passes.
  const settle = () => settleEventLane({
    annotations: domain.options.annotations ?? [], categories: domain.cats, events: options.events, language: options.locale?.language,
    inline: false, footnotesOff: (options as InternalFootnoteOptions).footnotesOff,
    theme: env.theme, measure: env.measure, size, compact: options.mode === 'compact',
    solve,
    area: (framed, w) => comboPlotArea(env, domain, paints, framed, gutterOverride, w),
    axis: (area) => ({ x: (ci) => area.band.center(ci), step: area.band.step, plot: area.plot }),
    warnings,
  });
  let settled = settle();
  let area = settled.area;
  // The scale pair clears a measured total-label row, rather than a fixed percentage.
  if ((options as { [LINE_BAND_CLEARANCE]?: number })[LINE_BAND_CLEARANCE] === undefined) {
    const scaleH = area.y(domain.dLo) - area.y(domain.dHi);
    const mode = comboValueLabels(options, domain.anatomy, domain.cats.length, domain.lineFloat !== undefined);
    const interiorValues = mode === 'all' || mode === 'extremes' || domain.anomaly !== undefined;
    // The anatomy seats a single column's values inside the column tops when
    // every one fits, and each line value above its point: the line then
    // clears the column tops by its marker and a gap, not by a label row.
    const insideTotals = domain.anatomy && domain.columns.length === 1 && !domain.anomaly
      && domain.cats.every((c) => env.measure(domain.fmt(domain.stackTotals[c.id] ?? 0), area.labelFont).width + 4 <= area.band.bandwidth);
    const anomalyRoom = domain.anomaly ? ANOMALY_FLAG_GAP + ANOMALY_FLAG_H : 0;
    const valueRow = env.measure('0', area.labelFont).height + 14;
    const clearance = (insideTotals ? MARKER_R + 8 : area.gtH + (interiorValues ? valueRow : 8)) + anomalyRoom;
    // A floated line prints its low under its point, so it keeps a value row over the column values.
    const floatClearance = (insideTotals ? MARKER_R + 8 : area.gtH) + valueRow + anomalyRoom;
    if (scaleH > 0 && domain.secondaryActive && domain.columns.length > 0) {
      const measured = clearance / scaleH;
      const floatMeasured = floatClearance / scaleH;
      const next = domain.withLineBandClearance?.(measured, floatMeasured);
      // Keep the first measured clearance on later note/gutter retries, even
      // when it picks the same scales and this pass can finish as it stands.
      options = { ...options, [LINE_BAND_CLEARANCE]: measured, [FLOAT_BAND_CLEARANCE]: floatMeasured } as ComboOptions;
      if (next) {
        domain = next.domain;
        domainWarnings = next.warnings;
        warnings.length = 0;
        pushAll(warnings, domainWarnings);
      }
      domain.options = { ...domain.options, [LINE_BAND_CLEARANCE]: measured, [FLOAT_BAND_CLEARANCE]: floatMeasured } as ComboOptions;
      if (next) {
        // The pair changed. Refit the frame with those scales; data, formats,
        // stacks, anomaly detection and paints do not need another pass.
        settled = settle();
        area = settled.area;
      }
    }
  }
  const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  commitClaims(occupied, settled.framed.claims);
  // A rank names nothing without its mapping, which is the label row moved
  // to the notes; a cut name comes back whole in its marked note.
  // The notes change the frame, so the chart refits once. With the footnote
  // block off they still travel in frame.notes, for the host to show.
  const categoryNotes = !area.showCatTickRow ? []
    : area.catPlan.step === 'ranks' ? rankNotes(domain.cats.map((c) => c.label ?? c.id), domain.options) : area.catPlan.cutNotes;
  const noted = (options as { [CATEGORY_NOTED]?: true })[CATEGORY_NOTED] === true;
  const printed = (options as { [POINTED_NOTES]?: string[] })[POINTED_NOTES] ?? [];
  if (categoryNotes.length > 0 && !noted) {
    const current = authoredNotes(options);
    const authored = (options as InternalFootnoteOptions).authoredFootnotes ?? current;
    return layoutComboPass(data, { ...withAuthoredFootnotes(options, [...current, ...categoryNotes], authored), [CATEGORY_NOTED]: true, [POINTED_NOTES]: categoryNotes, ...(area.catPlan.step === 'ranks' ? { [FORCE_CATEGORY_RANKS]: true } : {}) } as ComboOptions, gutterOverride);
  }
  // When the notes pass shrinks the plot and its row decides otherwise (a cut
  // name becomes ranks), the row takes ranks and the key with it, so every
  // mark on the axis has its note.
  if (noted && categoryNotesDiffer(categoryNotes, printed) && (options as { [FORCE_CATEGORY_RANKS]?: true })[FORCE_CATEGORY_RANKS] !== true) {
    const keyed = rankNotes(domain.cats.map((c) => c.label ?? c.id), domain.options);
    const current = authoredNotes(options).filter((note) => !printed.includes(note));
    const authored = (options as InternalFootnoteOptions).authoredFootnotes ?? current;
    return layoutComboPass(data, { ...withAuthoredFootnotes(options, [...current, ...keyed], authored), [POINTED_NOTES]: keyed, [FORCE_CATEGORY_RANKS]: true } as ComboOptions, gutterOverride);
  }
  const marks = noteMarks && sameMarkArea(noteMarks.area, area)
    ? { ...noteMarks.geometry,
      // The note retry normalizes fresh series. Paint decisions can use
      // series identity, so retained positions must refer to those series.
      segments: noteMarks.geometry.segments.map(segment => ({ ...segment, s: domain.columns[segment.si]! })),
      plans: noteMarks.geometry.plans.map(plan => ({ ...plan, s: domain.lines[plan.li]! })),
    } : layoutComboMarks(env, domain, area, paints);
  // Label and annotation work adds nodes; retain only the original mark phase.
  const geometry = { ...marks, nodes: [...marks.nodes] };
  if (domain.anomaly) {
    geometry.claims = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
    commitClaims(geometry.claims, marks.claims);
  }
  const anomalyMarks = domain.anomaly ? comboAnomalyMarks(env, domain, domain.anomaly, area, geometry) : undefined;
  commitClaims(occupied, geometry.claims);
  const requests = planComboLabels(env, domain, area, geometry, paints, warnings);
  const stair = area.stairTop === undefined ? undefined : seatStaircase({
    categories: domain.cats, band: area.band, top: area.stairTop, left: area.plot.x, right: area.plot.x + area.plot.w,
    floor: area.y0, above: domain.options.labels !== false ? area.gtH + 4 : 0, font: area.tickFont, measure: env.measure,
    tops: domain.posTop, options, cap: STAIRCASE_MAX_PAD * area.frame.plot.h, occupied, requests,
  });
  // The divider and its "FC" sit between the last actual and the first forecast
  // category (the shared helper takes the midpoint of their centres); the divider reaches
  // up through the totals row to its "FC".
  const centre = (ci: number) => area.band.center(ci);
  const dividerTop = area.forecastHeaderY + env.measure(options.strings!.forecastHeader!, secondaryFont(env.theme)).height + 8;
  const divided: Rect = { ...area.plot, y: dividerTop, h: area.plot.y + area.plot.h - dividerTop };
  placeForecastHeaders(area.forecast, centre, divided, area.forecastHeaderY, secondaryFont(env.theme), env.measure, requests, occupied, options.strings!.forecastHeader!, 'band');
  emitForecastDividers(env.theme, area.forecast, centre, divided, geometry.nodes, 'band');
  if (anomalyMarks) seatFlaggedValues(requests, domain.anomaly!.seriesId, anomalyMarks, geometry.segments.map((segment) => segment.rect));
  const densityValues = (options as ComboOptions & { [DENSITY_VALUES]?: ReadonlySet<Id> })[DENSITY_VALUES];
  for (const request of requests) if (densityValues?.has(request.id) && ['point', 'grandTotal'].includes(request.kind)) {
    request.redundant = true;
    request.suppressedAs = 'density';
  }
  const solveCtx: SolveCtx = {
    focus: options.focus,
    density: env.density,
    pins: options.labelPlacements ?? {},
    measure: env.measure,
    plot: area.plot,
    canvas: { x: 0, y: 0, w: size.width, h: size.height },
    darkInk: env.theme.color.ink,
    lightInk: env.theme.color.inkInverse,
    labelPad: 2,
    // A line or area value reads as its own point's (label/ownership.ts).
    pointOwnership: {
      points: geometry.plans.flatMap((plan) => plan.pts.map((p) => ({ seriesId: plan.s.id, categoryId: domain.cats[p.ci]!.id, x: p.x, y: p.y }))),
      categoryX: new Map(domain.cats.map((c, ci) => [c.id, area.band.center(ci)])),
    },
  };
  // Reference lines and endpoints take their seats before column values.
  const joint = (domain.options.annotations ?? []).some(annotation => annotation.kind === 'valueLine');
  const annotatedFirst = joint ? annotateCombo(env, domain, area, geometry, occupied, solveCtx, requests) : undefined;
  const chartIds = new Set(requests.map(request => request.id));
  const solved: SolveResult = annotatedFirst
    ? { placed: annotatedFirst.labels.filter(label => chartIds.has(label.id)), decisions: annotatedFirst.decisions.filter(decision => chartIds.has(decision.labelId)), warnings: [] }
    : solveLabels(requests, occupied, solveCtx);
  if (annotatedFirst) {
    annotatedFirst.labels = annotatedFirst.labels.filter(label => !chartIds.has(label.id));
    annotatedFirst.decisions = annotatedFirst.decisions.filter(decision => !chartIds.has(decision.labelId));
  }
  // options.categoryLabels 'staircase': the names take the height they need, or the chart falls back to the row.
  const staircase = runStaircase(env.theme, options.categoryLabels, options, stair, solved.placed, occupied, geometry.nodes, warnings);
  const nextStair = nextStaircase(options, staircase);
  if (nextStair) return layoutComboPass(data, { ...options, [STAIRCASE]: nextStair } as ComboOptions, gutterOverride);
  // A running period keeps a cue: a to-date total without a seat, or words wider than the drawn column, bring the hatch key back.
  const toDate = toDateOnTotals(env, domain);
  if (toDate.size > 0 && (!toDateFits(options.strings?.toDate ?? chartString(options, 'toDate'), env.theme, env.measure, toDateRoom(area.band.bandwidth))
    || solved.placed.some(l => l.kind === 'grandTotal' && l.hidden !== undefined && toDate.has(l.owner.categoryId ?? '')))) {
    return layoutComboPass(data, { ...options, [PARTIAL_KEY]: true } as ComboOptions, gutterOverride);
  }
  // Totals stand in for the value axis only while every one of them prints; one without a seat brings the axis back.
  if (!domain.showPrimaryAxis && domain.options.valueAxis?.show === undefined
    && solved.placed.some((l) => (l.kind === 'grandTotal' || (domain.ticksFromLabels === true && l.kind === 'point'))
      && l.hidden !== undefined && l.hidden !== 'redundant')) {
    return layoutComboPass(data, { ...options, [TOTALS_AXIS]: true } as ComboOptions, gutterOverride);
  }
  // Pareto ends can sit outside the plot; only combo needs an inside retry.
  if (!(options as { [FIRST_END_BELOW_TOTALS]?: boolean })[FIRST_END_BELOW_TOTALS]
    && (options as { [INSIDE_ENDPOINT_IDS]?: Set<Id> })[INSIDE_ENDPOINT_IDS] === undefined) {
    const ends = new Set([...area.first, ...area.last].map(([id, end]) => `point:${id}:${domain.cats[end.ci]!.id}`));
    // An end on a last-resort seat past the plot edge counts as missing too: the
    // retry's room beside the point comes first, the seat past the edge after it.
    const pastPlot = (label: PlacedLabel): boolean => label.hidden === undefined && String(label.slot).includes('PastColumn')
      && (label.rect.x < area.plot.x - 0.5 || label.rect.x + label.rect.w > area.plot.x + area.plot.w + 0.5);
    const missing = solved.placed.filter(label => ends.has(label.id) && (label.hidden === 'collision' || pastPlot(label))).map(label => label.id);
    if (missing.length) {
      const ids = new Set(missing);
      const room = insideEndpointGutters({ ids, first: area.first, last: area.last, cats: domain.cats,
        width: area.endpointWidth, font: area.labelFont, measure: env.measure, markerR: MARKER_R });
      // A zero reserve repeats the same geometry and label solve. Mark the
      // retry as settled so later frame changes keep the same failed-end set.
      options = { ...options, [INSIDE_ENDPOINT_IDS]: ids } as ComboOptions;
      domain.options = { ...domain.options, [INSIDE_ENDPOINT_IDS]: ids } as ComboOptions;
      if (room.first > 0 || room.last > 0) return layoutComboFramePass(data, options, gutterOverride, env, domain, paints, domainWarnings, frameSeed);
    }
  }
  // A second run drops an end-label gutter the solver left empty.
  const gutters = gutterOverride ? undefined : unusedEndpointGutters(area.gutters, solved, area.plot);
  if (gutters) return layoutComboPass(data, domain.options, gutters);
  // A reference value with no free seat beside its mark prints in the note
  // line; the note changes the frame, so the chart refits once. So does a
  // segment value its segment cannot hold (it carries its
  // note text), unless its total prints it.
  const catIndex = (l: PlacedLabel) => domain.cats.findIndex((c) => c.id === l.owner.categoryId);
  const segmentOwed = (l: PlacedLabel): boolean =>
    l.id.startsWith('segment:') && l.hidden !== undefined && l.noteText !== undefined && l.printedIn === undefined;
  const unprinted = solved.placed.filter((l) => (l.id.startsWith('tick:') && l.hidden !== undefined && l.hidden !== 'redundant') || segmentOwed(l));
  if (unprinted.length > 0 && (options as InternalFootnoteOptions).footnotesOff !== true) {
    const catLabel = (id: string | undefined) => domain.cats.find((c) => c.id === id)?.label ?? id;
    // The note takes height and can take another value's seat, so the chart
    // is laid out again with every value named so far until the set holds
    // (three runs at most), as column does.
    const prior = (options as { [UNPRINTED]?: Unprinted })[UNPRINTED] ?? { named: new Map(), runs: 0 };
    const named = new Map(prior.named);
    for (const l of unprinted) if (!named.has(l.id)) named.set(l.id, [catIndex(l), l.noteText ?? `${l.text} (${catLabel(l.owner.categoryId)})`]);
    if (named.size > prior.named.size && prior.runs < 3) {
      const current = authoredNotes(options).filter((line) => !line.startsWith(options.strings!.valuesNotBesideMarks!));
      // Under notes.maxListed: 0 the note counts them against all value labels.
      const valueCount = solved.placed.filter((l) => l.id.startsWith('tick:') || l.id.startsWith('segment:')).length;
      const note = noteLine(options.strings!.valuesNotBesideMarks!, [...named.values()].sort((a, b) => a[0] - b[0]).map(([, item]) => item), options, valueCount);
      const authored = (options as InternalFootnoteOptions).authoredFootnotes ?? current;
      return layoutComboPass(data, { ...withAuthoredFootnotes(options, [...current, ...note], authored), [UNPRINTED]: { named, runs: prior.runs + 1 } } as ComboOptions, gutterOverride, { area, geometry: marks });
    }
    // A value the note prints is not lost; one it misses still reports.
    const inNote = new Set(unprinted.filter((l) => prior.named.has(l.id)).map((l) => `label '${l.id}'`));
    solved.warnings = solved.warnings.filter((w) => !(w.code === 'label-hidden' && [...inNote].some((key) => w.message.startsWith(key))));
  }
  // A value the note names that found a seat after all is taken off, so the note never says a drawn value is missing.
  const notedIds = (options as { [UNPRINTED]?: Unprinted })[UNPRINTED]?.named;
  // The note names the first values in category order (noteCap) and counts the rest.
  const countedIds = notedIds
    ? new Set([...notedIds].sort((a, b) => a[1][0] - b[1][0]).slice(noteCap(options, notedIds.size)).map(([id]) => id)) : undefined;
  for (const label of solved.placed) if (notedIds?.has(label.id)) {
    if (label.hidden === undefined) label.hidden = 'note';
    label.noted = true;
    if (countedIds?.has(label.id)) label.noteCounted = true;
  }
  flagDroppedEndpointLabels(solved);
  // A reference value is furniture beside its mark, in the muted ink (as on bar and column).
  for (const label of solved.placed) if (label.id.startsWith('tick:') && !label.hidden) label.ink = { token: 'inkMuted' };
  const crossed = haloOverRules(solved.placed, occupied, new Set(['referenceLine', 'valueLine']));
  applyComboAxisTitlePaint(solved.placed, area.axisTitles);
  geometry.nodes.push(...comboAxisTitleSwatches(env.theme, solved.placed, area.axisTitles, occupied));
  applyGrowthInk(solved.placed, area);
  pushAll(warnings, solved.warnings);
  const annotated = annotatedFirst ?? annotateCombo(env, domain, area, geometry, occupied, solveCtx);
  // annotation rules arrive after value placement; larger values need their crossing halo too.
  for (const id of haloOverRules(solved.placed, occupied, new Set(['referenceLine', 'valueLine']))) crossed.add(id);
  // A right valueLine label with no seat on its line gets the gutter it needs, once.
  // Only right labels offer insideStart; a right gutter cannot seat a left one.
  if (!(VALUE_LINE_RESERVE in options)) {
    const reserve = hiddenValueLineReserve(annotated.labels.filter((l) => l.slots.includes('insideStart')), (text) => env.measure(text, { ...area.labelFont, weight: emphasisWeight(env.theme) }).width, size.width);
    if (reserve > 0) return layoutComboPass(data, { ...options, [VALUE_LINE_RESERVE]: reserve } as ComboOptions, gutterOverride);
  }
  pushAll(warnings, annotated.warnings);
  // A tick gives way to the value-line label drawn on it, and only then.
  for (const tick of geometry.yieldingTicks) {
    const label = annotated.labels.find((l) => l.id === `valueLine:${tick.annotationId}` && !l.hidden);
    if (!label || !rectsOverlap(label.rect, tick.rect)) continue;
    geometry.nodes = geometry.nodes.filter((node) => node.id !== tick.labelId);
    for (const axis of geometry.axes) for (const t of axis.ticks) if (t.labelId === tick.labelId) delete t.labelId;
  }
  const lane = settled.lane
    ? emitEventLane(env.theme, {
        ...settled.lane,
        axis: { x: (ci) => area.band.center(ci), step: area.band.step, plot: area.plot },
        mode: 'stop', baseline: area.plot.y + area.plot.h, occupied, solveCtx,
      })
    : undefined;
  if (lane) pushAll(warnings, lane.warnings);
  const assembled = assembleComboGeometry({ env, domain, area, paints, geometry, solved, annotated, occupied, warnings, lane });
  assembled.scene = raiseOverRules(assembled.scene, crossed);
  return assembled;
}
