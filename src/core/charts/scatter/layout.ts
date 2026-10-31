import { chartString } from '../../strings/scatter';
import type { Theme } from '../../types/theme';
import { structureCount } from '../../structureCounts';
/**
 * Scatter / bubble — position-encoded points over two value
 * axes (both shown by default), optional bubble sizing (∝ area default,
 * ∝ diameter option), group color/marker schemes, and the spiral point
 * labeler: 8 offset directions × 2 rings with leader
 * lines on the outer ring, auto-off above `maxPointLabels` points.
 * Smaller bubbles draw LAST so they stay clickable in front.
 *
 * `layoutScatter` runs five phases, each a function from typed
 * structs to one new struct:
 *   1. domain and scales: `resolveScatterDomain` (domain.ts, quadrants.ts),
 *      then `solveScatterFrame` and `scatterPlotArea` (plot.ts);
 *   2. mark geometry: `layoutScatterMarks` (marks.ts, zones.ts);
 *   3. label planning: `planScatterLabels` (labels.ts), then `solveLabels`;
 *   4. annotations: `runAnnotatePass`;
 *   5. geometry assembly: `assembleScatterGeometry`.
 * Phases 1 to 3 never touch the run's OccupiedIndex. The frame and the marks
 * claim into fresh indexes of their own; this function commits their
 * snapshots in order, so the solver and the annotation pass read an index
 * that no earlier phase can still change. The one thing every phase shares is
 * the warnings log, and a phase only appends to it.
 */

import type { AnchorResolution, AnnotatePassResult } from '../../annotate';
import { runAnnotatePass } from '../../annotatePass';
import { hiddenNoteWith, markNotedLabels, noteLine, type FrameResult, type LegendItemInput } from '../../frame';
import { formatAutomaticNumber } from '../../format';
import { trendRateFormatter } from '../../formatSpec';
import { spaceTokens, emphasisWeight, strokeToken, dashToken } from '../../theme';
import { labelsToNodes } from '../../label/emit';
import { createOccupiedIndex, type OccupiedIndex } from '../../label/occupied';
import { leaderPieces, solveLabels, type LabelRequest, type SolveCtx, type SolveResult } from '../../label/solver';
import { accessibleTitle } from '../../normalize/shared';
import { defaultAnnotationId, type AnchorRef, type Annotation } from '../../types/annotations';
import { rectsOverlap, type Rect } from '../../geometry';
import type { Id } from '../../types/cell';
import type { ScatterData } from '../../types/data';
import type { Geometry, LintWarning, Paint, PlacedLabel, SceneNode } from '../../types/scene';
import { clampDescription, type ScatterClipRecord, type ScatterDropRecord } from './clamp';
import { inView, resolveScatterDomain, resolveScatterEnv } from './domain';
import { planScatterLabels, pointValueText, scatterSolveCtx } from './labels';
import type { LogAxes } from './logAxis';
import { DENSE_POINTS, layoutScatterMarks, quadrantBoxRect, sizeMarkerOf, type ScatterMarkGeometry } from './marks';
import { plotSizeKey, sizeKeyItems, type PlotSizeKey } from './sizeKey';
import {
  QUADRANT_BOXES,
  QUADRANT_BOX_NAME,
  quadrantBoxName,
  type QuadrantDerived,
  type ScatterDerived,
  type ScatterDomain,
  type ScatterEnv,
  type ScatterMarks,
  type ScatterPlotArea,
} from './model';
import { scatterDotRadius, scatterPaints, scatterPlotArea, solveScatterFrame } from './plot';
import { type FrontierPlan } from './frontier';
import { gridZones, zoneKeyItems } from './zones';
import type { TrendFit } from './trend';
import type { ScatterStrategyOptions, StrategyZonesDerived } from './types';
import { disclosureNote, disclosuresShown } from '../../notes';
import { omittedKey } from '../../seriesIdentity';
import { maxOf, pushAll } from '../../arrays';

export { type ScatterDerived, type ScatterMarks } from './model';

/**
 * The accessible description. Everything the exhibit argues visually is said
 * here too: the groups, the extents, the bubble channel, the 2x2 (the cut
 * points ARE the argument, so leaving them out would hide the finding from a
 * reader who cannot see the dividers), the strategy zones, and what the outlier
 * options did. A clipped point is named with the value it really has, not with
 * the edge it is drawn at.
 */
function scatterDescription(input: {
  options: ScatterEnv['options'];
  bubbleMode: boolean;
  pointCount: number;
  groupNames: string[];
  extent: { xMin: number; xMax: number; yMin: number; yMax: number };
  log: LogAxes;
  fmt: (value: number) => string;
  axisFmt: ScatterEnv['axisFmt'];
  sizeBy: 'area' | 'diameter';
  biggest?: { label: string; size: number };
  quadrants?: QuadrantDerived;
  zones?: StrategyZonesDerived;
  zoneDescriptions: string[];
  clipped: readonly ScatterClipRecord[];
  /** A reversed vertical scale swaps which edge a clipped point is drawn at. */
  reversedY: boolean;
  dropped?: ScatterDropRecord;
  trends: readonly TrendFit[];
  frontier?: FrontierPlan;
  pointLabel: (id: Id) => string;
  groupLabel: (id: Id) => string;
}): string {
  const { fmt, axisFmt, extent, quadrants, zones, options } = input;
  return (
    chartString(options, 'scatterDescStart', { v1: chartString(options, input.bubbleMode ? 'bubbleName' : 'scatterName'), v2: input.pointCount }) +
    (input.groupNames.length
      ? chartString(options, 'scatterGroupDesc', { v1: input.groupNames.length, v2: input.groupNames.length === 1 ? '' : 's', v3: input.groupNames.join(', ') })
      : '') +
    chartString(options, 'scatterAxesDesc', { v1: axisFmt.x(extent.xMin), v2: axisFmt.x(extent.xMax), v3: input.log.x ? chartString(options, 'logScaleClause') : '', v4: axisFmt.y(extent.yMin), v5: axisFmt.y(extent.yMax), v6: input.log.y ? chartString(options, 'logScaleClause') : '' }) +
    (input.biggest
      ? chartString(options, 'bubbleSizeDesc', { v1: input.sizeBy === 'area' ? chartString(options, 'areaName') : chartString(options, 'diameterName'), v2: input.biggest.label, v3: fmt(input.biggest.size) })
      : '') +
    (quadrants
      ? chartString(options, 'quadrantDesc', { v1: quadrants.xText, v2: chartString(options, quadrants.xSource === 'declared' ? 'declaredLower' : quadrants.xSource === 'median' ? 'cutMedian' : 'cutMean'), v3: quadrants.yText, v4: chartString(options, quadrants.ySource === 'declared' ? 'declaredLower' : quadrants.ySource === 'median' ? 'cutMedian' : 'cutMean') }) +
        QUADRANT_BOXES.map((box) => `${quadrantBoxName(box, options)} ${quadrants.counts[box]}`).join(', ') +
        '.'
      : '') +
    (zones
      ? chartString(options, 'strategyZonesDesc', { v1: zones.kind === 'grid' ? chartString(options, 'gridCellsCount', { v1: zones.cellCount }) : chartString(options, 'authoredRegionsCount', { v1: zones.regionCount }), v2: input.zoneDescriptions.join(' ') })
      : '') +
    clampDescription(input.clipped, axisFmt, input.reversedY, options) +
    (input.dropped ? ` ${input.dropped.note}` : '') +
    input.trends
      .map((fit) => chartString(options, 'trendLineDesc', { v1: fit.slope < 0 ? chartString(options, 'fallsLower') : fit.slope > 0 ? chartString(options, 'risesLower') : chartString(options, 'runsFlat'), v2: fit.n, v3: fit.group === undefined ? '' : chartString(options, 'ofGroupClause', { v1: input.groupLabel(fit.group) }) }))
      .join('') +
    (input.frontier
      ? chartString(options, 'frontierDesc', { v1: input.frontier.ids.length, v2: chartString(options, input.frontier.x === 'min' ? 'lower' : 'higher'), v3: chartString(options, input.frontier.y === 'min' ? 'lower' : 'higher'), v4: input.frontier.ids.map(input.pointLabel).join(', ') })
      : '')
  );
}

/**
 * Callouts that print as a bold second line under their point's name
 * ("TransArc" over "Divestment candidate"). A
 * plain callout (no headline, arrow, glyph or live value) on a
 * drawn, named point. The rest keep their annotation, with an explicit id so
 * their ids stay as authored.
 */
function nameCallouts(env: ScatterEnv, domain: ScatterDomain, geometry: ScatterMarkGeometry): { callouts: Map<Id, string>; annotations: Annotation[] } {
  const callouts = new Map<Id, string>();
  const { options } = env;
  if (options.labels === false || options.labels?.point === false) return { callouts, annotations: domain.annotations };
  const named = new Set(geometry.placed.filter((e) => !!e.p.label).map((e) => e.p.id));
  const annotations = domain.annotations.flatMap((ann, index) => {
    if (ann.kind === 'callout' && !ann.headline && !ann.arrow && !ann.icon && !ann.status && ann.text && !ann.text.includes('${')) {
      const at = typeof ann.at === 'string' ? ann.at : 'pointId' in ann.at ? ann.at.pointId : undefined;
      if (at !== undefined && named.has(at) && !callouts.has(at)) {
        callouts.set(at, ann.text);
        return [];
      }
    }
    return [{ ...ann, id: defaultAnnotationId(ann, index) } as Annotation];
  });
  return callouts.size ? { callouts, annotations } : { callouts, annotations: domain.annotations };
}

/** Phase 4: annotations. A bare id resolves to a pointId on scatter. */
function annotateScatter(
  env: ScatterEnv,
  domain: ScatterDomain,
  area: ScatterPlotArea,
  geometry: ScatterMarkGeometry,
  occupied: OccupiedIndex,
  solveCtx: SolveCtx,
): AnnotatePassResult {
  const ptById = new Map(geometry.placed.map((e) => [e.p.id, e] as const));
  const resolveAnchor = (ref: AnchorRef): AnchorResolution | null => {
    const norm = typeof ref === 'string' ? { pointId: ref } : ref;
    if (!('pointId' in norm)) return null;
    const e = ptById.get(norm.pointId);
    if (!e) return null;
    // anchor at the top of the mark so callout leaders never start under it;
    // a callout rings the whole bubble and leads from its edge
    return { x: e.cx, y: e.cy - e.r - 1, value: e.p.y, owner: { pointId: e.p.id },
      markBox: { x: e.cx - e.r, y: e.cy - e.r, w: 2 * e.r, h: 2 * e.r } };
  };
  return runAnnotatePass({
    target: env.options.target,
    annotations: domain.annotations,
    resolve: resolveAnchor,
    occupied,
    plot: area.plot,
    theme: env.theme,
    measure: env.measure,
    format: env.options.axisFormat?.y ?? env.options.format,
    locale: env.options.locale?.language,
    strings: env.options.strings,
    valueLinePercentLevels: env.options.unit === '%' || domain.pts.length > 0 && domain.pts.every(point => point.yIsPct),
    solveCtx,
    yScale: area.y,
    meanValue: domain.meanY,
    calloutLeaderClear: true,
  });
}

/**
 * Quadrant captions leave the solver in the default ink; they are region
 * furniture, so they carry the muted ink the rest of the repo's furniture uses.
 * Done here rather than in the solver because ink is the solver's contrast
 * decision for INSIDE placements, and a caption has no fill under it.
 */
function scatterLabels(
  theme: Theme,
  area: ScatterPlotArea,
  solved: SolveResult,
  annotated: AnnotatePassResult,
  /** Label ids set bold: the highlighted dots' names. */
  boldIds: ReadonlySet<Id> = new Set(),
): { labels: PlacedLabel[]; nodes: SceneNode[] } {
  const { fonts } = area;
  const isQuadrantCaption = (id: Id): boolean => String(id).startsWith('quadrant:caption:');
  const isZoneLabel = (id: Id): boolean => String(id).startsWith('zone:');
  const isZoneBandLabel = (id: Id): boolean =>
    String(id).startsWith('zone:x-band:') || String(id).startsWith('zone:y-band:');
  const labels: PlacedLabel[] = [
    ...solved.placed.map((l) =>
      isQuadrantCaption(l.id) || isZoneLabel(l.id)
        ? { ...l, ink: { token: 'inkMuted' } as Paint }
        : l,
    ),
    ...annotated.labels,
  ];
  const nodes = labelsToNodes(theme, labels, (l) =>
    isQuadrantCaption(l.id)
      ? fonts.caption
      : isZoneBandLabel(l.id)
        ? fonts.tick
        : isZoneLabel(l.id)
          ? fonts.caption
      : l.kind === 'annotation' || l.kind === 'valueLine' || boldIds.has(l.id) || l.headLines !== undefined
        ? { ...fonts.label, weight: emphasisWeight(theme) }
        : fonts.label,
  );
  return { labels, nodes };
}

/** Phase 5: the scene in paint order, the derived record and the accessible description. */
function assembleScatterGeometry(input: {
  env: ScatterEnv;
  domain: ScatterDomain;
  frame: FrameResult;
  area: ScatterPlotArea;
  geometry: ScatterMarkGeometry;
  solved: SolveResult;
  annotated: AnnotatePassResult;
  occupied: OccupiedIndex;
  warnings: LintWarning[];
}): Geometry<ScatterMarks, ScatterDerived> {
  const { env, domain, frame, geometry, solved, annotated } = input;
  const { bubbleMode, pts, xMin, xMax, yMin, yMax, sizeMax, clamp, dropped } = domain;
  const quadrants = domain.quadrants.derived;
  const zonesDerived = geometry.zones.derived;
  // A highlighted bubble's name is bold on a strategy grid; elsewhere a bubble keeps its ring alone.
  const boldIds = new Set<Id>(bubbleMode && !gridZones(env.options) ? [] : pts.filter((p) => env.highlights.has(p.id) || (p.group !== undefined && env.highlights.has(p.group))).map((p) => `point:${p.id}`));
  const emitted = scatterLabels(input.env.theme, input.area, solved, annotated, boldIds);
  const biggest = bubbleMode
    ? [...geometry.placed].sort((a, b) => (b.p.size ?? 0) - (a.p.size ?? 0) || a.p.idx - b.p.idx)[0]
    : undefined;
  const a11yDesc = scatterDescription({ options: env.options,
    bubbleMode,
    pointCount: pts.length,
    groupNames: domain.shownGroups.map((g) => g.label),
    extent: { xMin, xMax, yMin, yMax },
    log: env.log,
    fmt: env.fmt,
    axisFmt: env.axisFmt,
    sizeBy: env.options.sizeBy ?? 'area',
    ...(bubbleMode && biggest ? { biggest: { label: biggest.p.label, size: biggest.p.size ?? 0 } } : {}),
    quadrants,
    zones: zonesDerived,
    zoneDescriptions: geometry.zones.descriptions,
    clipped: clamp?.records ?? [],
    reversedY: env.va.reverse === true,
    dropped,
    trends: domain.trends,
    frontier: domain.frontier,
    pointLabel: (id) => pts.find((p) => p.id === id)?.label ?? id,
    groupLabel: (id) => domain.groups.get(id)?.label ?? id,
  });

  return {
    type: 'scatter',
    size: env.size,
    plot: input.area.plot,
    scene: [...frame.nodes, ...geometry.nodes, ...annotated.nodes, ...emitted.nodes],
    labels: emitted.labels,
    axes: geometry.axes,
    annotations: annotated.placed,
    legend: frame.legend,
    frame: frame.frame,
    marks: geometry.marks,
    derived: {
      xExtent: [xMin, xMax],
      yExtent: [yMin, yMax],
      ...(sizeMax !== undefined ? { sizeMax } : {}),
      ...(quadrants ? { quadrants } : {}),
      ...(zonesDerived ? { zones: zonesDerived } : {}),
      ...(clamp && clamp.records.length > 0 ? { clipped: clamp.records } : {}),
      ...(dropped ? { dropped } : {}),
      ...(domain.trends.length > 0 ? { trends: domain.trends } : {}),
      ...(domain.frontier ? { frontier: domain.frontier } : {}),
    },
    a11y: {
      title: accessibleTitle(env.options.title, chartString(env.options, 'scatterTitle', { v1: bubbleMode ? chartString(env.options, 'bubbleName') : chartString(env.options, 'scatterName'), v2: pts.length })),
      counts: [structureCount('points', pts.length, undefined, env.options),
        ...(domain.shownGroups.length ? [structureCount('groups', domain.shownGroups.length, chartString(env.options, 'groupsCount', { v1: domain.shownGroups.length, v2: domain.shownGroups.length === 1 ? '' : 's' }))] : []),
        ...(quadrants ? QUADRANT_BOXES.map(box => structureCount('points', quadrants.counts[box], `${quadrantBoxName(box, env.options)} ${quadrants.counts[box]}`)) : []),
        ...(zonesDerived ? [zonesDerived.kind === 'grid' ? structureCount('cells', zonesDerived.cellCount!, chartString(env.options, 'gridCellsCount', { v1: zonesDerived.cellCount })) : structureCount('regions', zonesDerived.regionCount!, chartString(env.options, 'authoredRegionsCount', { v1: zonesDerived.regionCount }))] : []),
        ...(clamp?.records ?? []).map(record => structureCount('points', record.count, chartString(env.options, 'pointsCount', { v1: record.count, v2: record.count === 1 ? '' : 's' }))),
        ...(dropped ? [structureCount('points', dropped.count, chartString(env.options, 'pointsCount', { v1: dropped.count, v2: dropped.count === 1 ? '' : 's' }))] : []),
        ...domain.trends.map(fit => structureCount('points', fit.n, undefined, env.options)),
        ...(domain.frontier ? [structureCount('points', domain.frontier.ids.length, undefined, env.options)] : [])],
      desc: a11yDesc,
    },
    warnings: input.warnings,
    debug: {
      occupied: input.occupied.snapshot(),
      decisions: [...solved.decisions, ...annotated.decisions],
    },
  };
}

/** Whether a laid-out scatter hides a point name or value its note does not list. */
function notListed(geometry: Geometry<ScatterMarks, ScatterDerived>): boolean {
  const text = geometry.scene.flatMap((node) => (node.t === 'text' && node.part === 'footnote' ? node.lines : [])).join(' ');
  return geometry.labels.some((label) => label.hidden && /^(point|value):/.test(String(label.id)) && !text.includes(label.text));
}

/** Replays a phase's claims, in claim order, into the run's index. */
/** Rounds of seat removal that keep two point names off one line. */
const NAME_APART_ROUNDS = 3;

/**
 * Two names of different points on one line, closer than two label heights,
 * read as one name ("Charlie Bravo" on a strategy grid at 400 px). The solver's
 * name gap is soft, so a probe solve finds such a pair and the lower-ranked
 * name loses that seat; it then takes another seat or goes to the note.
 */
/** Two name boxes on one line, closer than two label heights. */
function readsAsOne(a: Rect, b: Rect): boolean {
  const h = Math.min(a.h, b.h);
  const sameLine = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > h / 2;
  const gap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  return sameLine && gap < 2 * h;
}

/** A solve on a copy of the claims: its result and the copy, which then holds the labels' claims too. */
interface ProbeSolve {
  result: SolveResult;
  index: OccupiedIndex;
}

function probeSolveOn(requests: LabelRequest[], occupied: OccupiedIndex, ctx: SolveCtx, size: { width: number; height: number }): ProbeSolve {
  const index = copyOccupied(occupied, size);
  return { result: solveLabels(requests, index, ctx), index };
}

/**
 * Returns the first probe solve when no name moved: it is then the final
 * solve of these requests on these claims (one solve less per run).
 */
function keepNamesApart(requests: LabelRequest[], occupied: OccupiedIndex, ctx: SolveCtx, size: { width: number; height: number }, first?: ProbeSolve): ProbeSolve | undefined {
  const names = new Map(requests.filter((r) => String(r.id).startsWith('point:')).map((r) => [r.id, r] as const));
  const start = first ?? probeSolveOn(requests, occupied, ctx, size);
  if (names.size < 2) return start;
  const original = new Map<string, LabelRequest['candidates']>();
  const probeSolve = () => probeSolveOn(requests, occupied, ctx, size).result.placed.filter((l) => names.has(l.id));
  let all = start.result.placed.filter((l) => names.has(l.id));
  const hiddenAtStart = all.filter((l) => l.hidden).length;
  for (let round = 0; round < NAME_APART_ROUNDS; round++) {
    const placed = all.filter((l) => !l.hidden);
    const losers = new Set<string>();
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!, b = placed[j]!;
        if (!readsAsOne(a.rect, b.rect)) continue;
        const ra = names.get(a.id)!, rb = names.get(b.id)!;
        const [label, request, other] = ra.priority < rb.priority || (ra.priority === rb.priority && a.id > b.id) ? [a, ra, b] : [b, rb, a];
        if (losers.has(label.id) || request.candidates.length < 2) continue;
        losers.add(label.id);
        if (!original.has(label.id)) original.set(label.id, request.candidates);
        // Every seat that would read as one name with the other goes, not only this one:
        // a slid or shifted copy of it sits on the same line.
        request.candidates = request.candidates.filter((c) => c.slot !== label.slot && !readsAsOne(c.rect, other.rect));
      }
    }
    if (losers.size === 0) break;
    all = probeSolve();
  }
  if (original.size === 0) return start;
  // A name that reads apart but is gone is worse than a tight pair: when the
  // moves hide more names than before, every name keeps its first seats.
  if (all.filter((l) => l.hidden).length > hiddenAtStart) {
    for (const [id, candidates] of original) names.get(id)!.candidates = candidates;
    return start;
  }
  return undefined;
}

/**
 * Names come first (a bubble chart at 320 px): the solver seats names greedily,
 * by rank, so a higher name can take the one seat a lower name had
 * (CupriCo over RailBridge's leader seat). For each lost name, a seat that
 * only other names block is freed: those names lose every seat that meets
 * it, when they still find another seat and no name is lost on the way.
 */
function seatLostNames(requests: LabelRequest[], occupied: OccupiedIndex, ctx: SolveCtx, size: { width: number; height: number }, first: PlacedLabel[], dots = false): ProbeSolve | undefined {
  const names = new Map(requests.filter((r) => String(r.id).startsWith('point:')).map((r) => [r.id, r] as const));
  let all = first;
  // The last probe that seated a lost name: its candidates are the ones the requests keep.
  let seated: ProbeSolve | undefined;
  if (names.size < 2 || seatProbe.left <= 0) return undefined;
  const pad = ctx.labelPad ?? 2;
  const lostNames = (placed: PlacedLabel[]) => placed.filter((l) => l.hidden && names.has(l.id));
  lost: for (const lost of lostNames(all)) {
    const request = names.get(lost.id)!;
    const hiddenBefore = lostNames(all).length;
    for (const seat of request.candidates) {
      // Only seats that nothing but names blocks: marks, axes and frame stay.
      const hard = occupied.hitsWhich(seat.rect, seat.pad ?? pad).some((o) => !(seat.overRules && o.part === 'referenceLine')
        && !(o.kind === 'mark' && o.owner.pointId === request.owner.pointId));
      if (hard) continue;
      const blockers = all.filter((l) => !l.hidden && names.has(l.id) && l.id !== lost.id && rectsOverlap(l.rect, seat.rect, pad));
      if (blockers.length === 0 || blockers.length > 2) continue;
      const saved = blockers.map((l) => [names.get(l.id)!, names.get(l.id)!.candidates] as const);
      for (const [other] of saved) other.candidates = other.candidates.filter((c) => !rectsOverlap(c.rect, seat.rect, pad));
      // A dot chart probes only where each displaced name has a free seat to move to: in a dense lattice
      // (dense-40-thinning) the displaced name had none, and the probe was a full solve that seated nobody.
      const free = (other: LabelRequest) => other.candidates.some((c) => !occupied.hitsWhich(c.rect, c.pad ?? pad).some((o) => !(o.kind === 'mark' && o.owner.pointId === other.owner.pointId))
        && !all.some((l) => !l.hidden && names.has(l.id) && l.id !== other.id && rectsOverlap(l.rect, c.rect, pad)));
      if (saved.every(([other]) => other.candidates.length > 0 && (!dots || free(other)))) {
        if (seatProbe.left <= 0) {
          for (const [other, candidates] of saved) other.candidates = candidates;
          break lost;
        }
        seatProbe.left--;
        const probe = probeSolveOn(requests, occupied, ctx, size);
        const next = probe.result.placed;
        if (lostNames(next).length < hiddenBefore && !next.find((l) => l.id === lost.id)?.hidden) {
          all = next;
          seated = probe;
          break;
        }
      }
      for (const [other, candidates] of saved) other.candidates = candidates;
    }
  }
  return seated;
}

function commitClaims(occupied: OccupiedIndex, phase: OccupiedIndex): void {
  for (const c of phase.snapshot()) occupied.claim(c.rect, c.kind, c.owner, c.part, c.polygon);
}

/** A fresh index with the claims and tick columns of `occupied`: a solve on it leaves `occupied` as it was. */
function copyOccupied(occupied: OccupiedIndex, size: { width: number; height: number }): OccupiedIndex {
  const copy = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  commitClaims(copy, occupied);
  if (occupied.tickColumns) copy.tickColumns = [...occupied.tickColumns];
  return copy;
}

/**
 * The size key ring's ceiling: its diameter is at most this share of the
 * card's height (90 px on a 720 px card, 50 px on 405), and never less than
 * one key row. A ring is drawn at the plot's scale, so the key's two rings
 * need room up to about the largest bubble.
 */
const SIZE_KEY_MAX_SHARE = 0.125;

/**
 * The key row beside the groups: the zones
 * keyed there (labelAt), the Pareto line, each trend line with its slope and
 * r², and the bubble sizes at the radius the plot draws them. Without a plot yet, the size rings wait for the next pass.
 */
function scatterKeyItems(env: ScatterEnv, domain: ScatterDomain, paints: ReturnType<typeof scatterPaints>, area: ScatterPlotArea | undefined, warnings: LintWarning[], sizesInRow = true): LegendItemInput[] {
  const items: LegendItemInput[] = [];
  items.push(...zoneKeyItems(env.options));
  if (domain.frontier) {
    items.push({ id: 'frontier', label: env.options.frontier?.label ?? chartString(env.options, 'paretoLine'), paint: { token: 'ink' }, key: 'line', dash: dashToken(env.theme, 'dotted'), lineCap: 'round' as const, width: strokeToken(env.theme, 'rule') });
  }
  const trend = env.options.trend;
  const named = typeof trend === 'object' && trend.label ? trend.label : chartString(env.options, 'linearTrend');
  const rate = trendRateFormatter(env.options.axisFormat?.y ?? env.options.format,
    env.options.locale?.language, domain.pts.some(p => p.yIsPct) ? '%' : env.options.unit);
  for (const fit of domain.trends) {
    const group = fit.group === undefined ? '' : `, ${domain.groups.get(fit.group)?.label ?? fit.group}`;
    const slope = rate(fit.slope);
    const r2 = fit.r2 === null ? 'undefined' : formatAutomaticNumber(fit.r2, { locale: env.options.locale?.language, decimals: 2 });
    items.push({
      id: `trend:${fit.id}`,
      // The fit's own numbers, printed where the line is keyed.
      label: chartString(env.options, 'trendFitLabel', { v1: named, v2: group, v3: slope, v4: r2 }),
      paint: fit.group === undefined ? { token: 'ink' } : paints.group(fit.group),
      key: 'line', dash: dashToken(env.theme, 'reference'), width: strokeToken(env.theme, 'rule'),
    });
  }
  // Points minCount left out, or with no x or y, draw nothing; when their disclosure does not print, the key names them.
  if (domain.omitted.length > 0 && !disclosuresShown(env.options)) items.push(omittedKey('__omitted', domain.omitted.join(' ')));
  if (sizesInRow && area && domain.bubbleMode && domain.sizeMax && env.options.sizeLegend !== false) {
    // The key row grows to its largest ring, up to SIZE_KEY_MAX_SHARE of the
    // card.
    const rowH = spaceTokens(env.theme, env.size.width).legendRowH;
    const maxRadius = Math.max(rowH, SIZE_KEY_MAX_SHARE * env.size.height) / 2;
    const sizeMin = domain.pts.reduce((min, p) => (p.size !== null && p.size > 0 ? Math.min(min, p.size) : min), Infinity);
    items.push(...sizeKeyItems(env, sizeMin, domain.sizeMax, (size) => area.radiusOf({ size }), maxRadius, warnings));
  }
  return items;
}

/**
 * Whether the size key tries a free plot corner before the key row.
 * A 2x2 tries a free box side under
 * its caption; a strategy grid keeps the key row.
 */
function sizeKeyInPlot(env: ScatterEnv, domain: ScatterDomain): boolean {
  const { options } = env;
  return domain.bubbleMode && domain.sizeMax !== undefined && domain.sizeMax > 0 && options.sizeLegend !== false && options.legend !== 'none'
    && options.zones === undefined;
}

/** Notes the plot owes its reader once the plot is known. */
function scatterLateNotes(env: ScatterEnv, domain: ScatterDomain, area: ScatterPlotArea): string[] {
  const notes: string[] = [];
  const titles = env.options.axisTitles ?? {};
  if (area.showAxes) {
    notes.push(...noteLine(chartString(env.options, 'axesUntitled'), [...(titles.x ? [] : [chartString(env.options, 'horizontal')]), ...(titles.y ? [] : [chartString(env.options, 'vertical')])]));
  }
  if (domain.bubbleMode) {
    const drawn = domain.pts.filter((p) => inView(env.options, domain.dx, domain.dy, p) && p.marker !== 'none');
    const names = (pick: (p: (typeof drawn)[number]) => boolean) => drawn.filter(pick).map((p) => p.label).join(', ');
    const parts = [
      [chartString(env.options, 'sizeZeroRing'), names((p) => sizeMarkerOf(p) === 'zero')],
      [chartString(env.options, 'sizeAbsentPlus'), names((p) => sizeMarkerOf(p) === 'missing')],
      [chartString(env.options, 'sizeInvalidCross'), names((p) => sizeMarkerOf(p) === 'invalid')],
      [chartString(env.options, 'minimumDotSize'), names((p) => sizeMarkerOf(p) === undefined && (p.size ?? 0) > 0 && area.radiusOf(p) <= area.radiusOf({ size: 0 }) + 1e-9)],
    ].filter(([, who]) => who).map(([what, who]) => `${what} (${who})`);
    if (parts.length) notes.push(disclosureNote(chartString(env.options, 'notDrawnScale', { v1: parts.join('; ') })));
  }
  const maxPointLabels = env.options.maxPointLabels ?? 300;
  const labelsOn = env.options.labels !== false && (env.options.labels?.point !== false || env.options.labels?.value === true);
  if (labelsOn && domain.pts.filter((p) => inView(env.options, domain.dx, domain.dy, p)).length > maxPointLabels) {
    notes.push(disclosureNote(chartString(env.options, 'pointLabelsOff', { v1: maxPointLabels })));
  }
  return notes;
}

/** The least room between a plot size key and a point name beside it (8 px read as one block at 400 px). */
const KEY_LABEL_GAP = 12;

/** The gap between two rects: 0 when they touch or overlap. */
function rectGap(a: Rect, b: Rect): number {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(dx, dy);
}

/**
 * The seat probes (seatLostNames) one scatter layout may spend, over all its
 * runs (note runs, key row). Each probe is one more label solve. The repair
 * runs on the final solve of a run only, never in the value-tier probes, and
 * the catalog bubble charts need at most 8; a crowded demo at a small size (portfolio-bubbles at 400 x 300)
 * spends them all. Once the budget is spent, a lost name stays in the note.
 */
const SEAT_PROBE_BUDGET = 8;
/** The seat probes a dot chart may spend per layout: the one a lone pushed-out name needs (log-both-stores-revenue). */
const DOT_SEAT_PROBES = 1;
const seatProbe = { left: SEAT_PROBE_BUDGET, dotLeft: DOT_SEAT_PROBES, depth: 0 };

export function layoutScatter(...args: Parameters<typeof layoutScatterRun>): ReturnType<typeof layoutScatterRun> {
  if (seatProbe.depth === 0) {
    seatProbe.left = SEAT_PROBE_BUDGET;
    seatProbe.dotLeft = DOT_SEAT_PROBES;
  }
  seatProbe.depth++;
  try {
    return layoutScatterRun(...args);
  } finally {
    seatProbe.depth--;
  }
}

function layoutScatterRun(
  data: ScatterData,
  options: ScatterStrategyOptions = {},
  /** Names an earlier run could not place on the plot; listed in a note. */
  hiddenNames?: readonly string[],
  run = 0,
  /** Hide every label the note lists, so a note from a longer run is not stale (see the end). */
  hideListed = false,
  /** The bubble values this layout prints (ScatterEnv.valueTier). */
  valueTier: 0 | 1 | 2 = 0,
  /** The size key goes to the key row: no plot corner was free for it. */
  sizeKeyInRow = false,
  /**
   * Callouts print under their point's name (ScatterEnv.callouts): on one line,
   * wrapped to the name's width when that found no seat, else ('off') as
   * annotations again.
   */
  calloutMode: 'line' | 'wrap' | 'off' = 'line',
  /** The points whose value prints only inside its bubble (ScatterEnv.valueInsideOnly). */
  valueInsideOnly?: ReadonlySet<Id>,
  /** The plot key stays in the plot: the key row lost more (see the crowding check). */
  keepKeyInPlot = false,
): Geometry<ScatterMarks, ScatterDerived> {
  const warnings: LintWarning[] = [];
  // The names the plot could not place share ONE note with the registry's ("Not labelled on the chart").
  const hiddenNote = hiddenNoteWith(options, (hiddenNames ?? []).map((text, i) => ({ id: `scatter:${i}`, text })));
  const env: ScatterEnv = { ...resolveScatterEnv(options, warnings), valueTier, valueInsideOnly };
  const domain = resolveScatterDomain(data, env, warnings);
  if (env.options.legend === 'none' && domain.bubbleMode && domain.sizeMax && env.options.sizeLegend !== false) {
    const sizeKey = typeof env.options.sizeLegend === 'object' && env.options.sizeLegend.label ? env.options.sizeLegend.label : 'bubble size';
    warnings.push({
      code: 'legend-off',
      severity: 'info',
      message: `legend: 'none' left the size key off: ${sizeKey}. Set legend to a value that shows it, or set sizeLegend: false to drop it on purpose.`,
    });
  }
  const paints = scatterPaints(env, domain.groups, domain.pts, domain.bubbleMode ? undefined : scatterDotRadius(env, domain));
  let occupied = createOccupiedIndex({ x: 0, y: 0, w: env.size.width, h: env.size.height });
  // The size rings take the radius the plot draws, and the plot is what the
  // frame and its key row leave: solve again until the plot stops moving.
  // The first rings come from a plot without them, so they run large; from
  // the third pass on the key row never shrinks (ringRow), the plot then only
  // shrinks, the rings with it, and the loop settles with the rings at the
  // final plot's scale.
  let area: ScatterPlotArea | undefined;
  let solvedFrame: ReturnType<typeof solveScatterFrame> | undefined;
  let ringRow = 0;
  const keyInPlot = !sizeKeyInRow && sizeKeyInPlot(env, domain);
  for (let pass = 0; pass < 6; pass++) {
    const passWarnings: LintWarning[] = [];
    const keyed = scatterKeyItems(env, domain, paints, area, passWarnings, !keyInPlot);
    ringRow = Math.max(pass >= 2 ? ringRow : 0, maxOf(keyed.map((item) => (item.key === 'sizes' ? Math.ceil(2 * Math.max(0.5, ...(item.radii ?? []))) : 0))));
    const items = keyed.map((item) => (item.key === 'sizes' ? { ...item, ringRow } : item));
    solvedFrame = solveScatterFrame(env, domain, paints, items, area ? scatterLateNotes(env, domain, area) : [], hiddenNote);
    const next = scatterPlotArea(env, domain, solvedFrame.frame, passWarnings);
    const stable = area !== undefined && next.plot.w === area.plot.w && next.plot.h === area.plot.h;
    area = next;
    if (stable || pass === 5) {
      pushAll(warnings, passWarnings);
      break;
    }
  }
  const { frame, claims } = solvedFrame!;
  commitClaims(occupied, claims);
  const geometry = layoutScatterMarks(env, domain, area!, paints, warnings);
  if (geometry.densePoints) {
    warnings.push({
      code: 'scatter-dense-paths',
      severity: 'info',
      message: `${geometry.densePoints} of ${geometry.placed.length} points are drawn as one path per colour (more than ${DENSE_POINTS}): dots carry no outline, so overlaps cannot be counted, and these points have no SVG element of their own`,
      suggest: 'aggregate the points (a heatmap or histogram of the two values) where the reader must see how many overlap',
    });
  }
  // The nested size key in a free plot corner, else the key row.
  let plotKey: PlotSizeKey | undefined;
  if (keyInPlot) {
    const sizeMin = domain.pts.reduce((min, p) => (p.size !== null && p.size > 0 ? Math.min(min, p.size) : min), Infinity);
    const boxes = domain.quadrants.derived
      ? (['tr', 'br', 'tl', 'bl'] as const).filter((box) => !domain.quadrants.voidBoxes.has(box)).map((box) => quadrantBoxRect(box, area!.plot, geometry.split))
      : [];
    plotKey = plotSizeKey(env, area!, sizeMin, domain.sizeMax!, geometry.claims, warnings, boxes);
    if (!plotKey) return layoutScatter(data, options, hiddenNames, run, hideListed, valueTier, true, calloutMode, valueInsideOnly);
    // A 2x2 box is small: a key that costs a point its name goes to the key row instead.
    if (run === 0 && !hideListed && domain.quadrants.derived) {
      const lostWith = (rects: Rect[]): number => {
        const probe = createOccupiedIndex({ x: 0, y: 0, w: env.size.width, h: env.size.height });
        commitClaims(probe, occupied);
        commitClaims(probe, geometry.claims);
        for (const rect of rects) probe.claim(rect, 'legend', {}, 'sizeKey');
        if (occupied.tickColumns) probe.tickColumns = [...occupied.tickColumns];
        const tried = solveLabels(planScatterLabels(env, domain, area!, geometry, paints, []), probe, scatterSolveCtx(env, area!));
        return tried.placed.filter((label) => label.hidden && String(label.id).startsWith('point:')).length;
      };
      if (lostWith(plotKey.rects) > lostWith([])) return layoutScatter(data, options, hiddenNames, run, hideListed, valueTier, true, calloutMode, valueInsideOnly);
    }
    geometry.nodes.push(...plotKey.nodes);
    for (const rect of plotKey.rects) geometry.claims.claim(rect, 'legend', {}, 'sizeKey');
  }
  commitClaims(occupied, geometry.claims);
  const solveCtx = scatterSolveCtx(env, area!);
  const merged = calloutMode !== 'off' ? nameCallouts(env, domain, geometry) : { callouts: new Map<Id, string>(), annotations: domain.annotations };
  env.callouts = merged.callouts;
  env.calloutWrap = calloutMode === 'wrap';
  // Authored annotations (callouts, value lines) are solved first, so they
  // keep their seats and the point labels take the room they leave.
  // An annotation's text may stand across a zero line, in front
  // of it with a halo, as point names may.
  const isZero = (c: { kind: string; part?: string }) => c.kind === 'axis' && c.part === 'referenceLine';
  const annIndex = createOccupiedIndex({ x: 0, y: 0, w: env.size.width, h: env.size.height });
  for (const c of occupied.snapshot()) if (!isZero(c)) annIndex.claim(c.rect, c.kind, c.owner, c.part, c.polygon);
  if (occupied.tickColumns) annIndex.tickColumns = [...occupied.tickColumns];
  const claimedBefore = annIndex.snapshot().length;
  const annotated = annotateScatter(env, { ...domain, annotations: merged.annotations }, area!, geometry, annIndex, solveCtx);
  for (const c of annIndex.snapshot().slice(claimedBefore)) occupied.claim(c.rect, c.kind, c.owner, c.part, c.polygon);
  const zeros = occupied.snapshot().filter(isZero);
  for (const label of annotated.labels) if (!label.hidden && zeros.some((z) => rectsOverlap(z.rect, label.rect))) label.halo = true;
  // Their leaders are claimed too, so no point name is set across one.
  for (const label of annotated.labels) {
    if (label.hidden || !label.leader) continue;
    for (const [a, b] of leaderPieces(label.leader.d, 16)) {
      occupied.claim({ x: Math.min(a.x, b.x) - 1, y: Math.min(a.y, b.y) - 1, w: Math.abs(b.x - a.x) + 2, h: Math.abs(b.y - a.y) + 2 }, 'annotation', label.owner, 'leader');
    }
  }
  // A value goes in the note only for a point that needs it to.
  // Each point that loses its name or its value keeps its value only inside
  // its bubble. The rest still print theirs.
  // A lost name does not take the joined value of its nearest neighbour:
  // with names held to seats that read as their own, that would move
  // neighbours' values into the note for nothing.
  // Probe solves for the value tiers, one per tier and value set in this run
  // (the plot and the claims stay fixed until the final solve). The seat
  // repair (seatLostNames) runs on the final solve only.
  const probes = new Map<string, ProbeSolve>();
  const probeKey = (tier: 0 | 1 | 2, insideOnly?: ReadonlySet<Id>) => `${tier}|${[...(insideOnly ?? [])].map(String).sort().join('\u0000')}`;
  const probeAt = (tier: 0 | 1 | 2, insideOnly?: ReadonlySet<Id>): PlacedLabel[] => {
    const key = probeKey(tier, insideOnly);
    let probe = probes.get(key);
    if (!probe) {
      probe = probeSolveOn(planScatterLabels({ ...env, valueTier: tier, valueInsideOnly: insideOnly }, domain, area!, geometry, paints, []), occupied, solveCtx, env.size);
      probes.set(key, probe);
    }
    return probe.result.placed;
  };
  // A name with no seat at all (every seat reads as another
  // point's label, nameReading.ts) goes to the note whatever the values do:
  // it costs no value its seat and does not count as a loss between tiers.
  const seatless = (label: PlacedLabel) => label.hidden !== undefined && label.slot === 'none' && String(label.id).startsWith('point:');
  const demoteValues = (start: ReadonlySet<Id> | undefined): Set<Id> => {
    const insideOnly = new Set<Id>(start);
    for (let round = 0; round < 4; round++) {
      const before = insideOnly.size;
      for (const label of probeAt(0, insideOnly)) {
        const id = label.owner.pointId;
        if (!label.hidden || id === undefined || !/^(point|value):/.test(String(label.id)) || seatless(label)) continue;
        insideOnly.add(id);
      }
      if (insideOnly.size === before) break;
    }
    return insideOnly;
  };
  // A point name outranks every bubble value. When the
  // first layout loses a name or a value, it tries fewer values on the same
  // plot: only the values that sit inside their bubble, then none, and keeps
  // the tier that places the most names, then hides the fewest values (the
  // fewer values on a tie). A value left off the plot is named in the page note (nothing is hidden without its name on the page).
  // The bubble and the size key still carry each size.
  // For speed, run 0 only; the note runs keep its choice (passed on as
  // valueTier and valueInsideOnly). A choice in each later run would make
  // measure() of the portfolio-bubbles demo run 17 layouts instead of 4.
  if (run === 0 && !hideListed && valueTier < 2 && domain.bubbleMode && options.labels !== false && options.labels?.value === true) {
    const lostAt = (tier: 0 | 1 | 2, insideOnly?: ReadonlySet<Id>): number => {
      const placed = probeAt(tier, insideOnly);
      // A hidden value would go to the note: it counts as a loss too, below any name.
      const hidden = (prefix: string) => placed.filter((label) => label.hidden && String(label.id).startsWith(prefix) && !seatless(label)).length;
      return 1000 * hidden('point:') + hidden('value:');
    };
    let best: { tier: 0 | 1 | 2; lost: number; insideOnly?: ReadonlySet<Id> } = { tier: valueTier, lost: lostAt(valueTier, valueInsideOnly), insideOnly: valueInsideOnly };
    if (valueTier === 0 && best.lost > 0) {
      const insideOnly = demoteValues(valueInsideOnly);
      const lost = lostAt(0, insideOnly);
      if (lost < best.lost) best = { tier: 0, lost, insideOnly };
    }
    for (let tier = valueTier + 1; tier <= 2 && best.lost > 0; tier++) {
      const lost = lostAt(tier as 1 | 2);
      // On a tie the fewer values win: the notes of later runs take plot height, and a name needs the room more than a value.
      if (lost <= best.lost) best = { tier: tier as 1 | 2, lost };
    }
    env.valueTier = best.tier;
    env.valueInsideOnly = best.insideOnly;
  }
  const requests = planScatterLabels(env, domain, area!, geometry, paints, warnings);
  // A point name the plot cannot place is listed, with where the
  // point is, in a note; one more run makes room for it.
  // A lost value is listed with its point's name. The note takes height from
  // the plot, so the run repeats until every lost text is in it (four runs
  // at most); the list keeps the input order of the points.
  const byId = new Map(domain.pts.map((p) => [p.id, p]));
  const valueText = new Map(requests.flatMap((request) => (request.id.startsWith('value:') && request.owner.pointId !== undefined ? [[request.owner.pointId, request.text] as const] : [])));
  // A name that carries its value has no value request; a lost one keeps the size in the note.
  if (domain.bubbleMode && options.labels !== false && options.labels?.value === true) {
    for (const p of domain.pts) if (!valueText.has(p.id) && p.size !== null) valueText.set(p.id, pointValueText(env, domain, p, 'size')!);
  }
  const listed = new Set(hiddenNames ?? []);
  const named = new Set(requests.flatMap((request) => (request.id.startsWith('point:') && request.owner.pointId !== undefined ? [request.owner.pointId] : [])));
  const noteText = (id: Id, owner: { pointId?: Id }, text: string): { idx: number; text: string; valueFor?: Id } | undefined => {
    // region names carry meaning even when the point labels fit.
    const box = String(id).replace(/^quadrant:caption:/, '') as keyof typeof QUADRANT_BOX_NAME;
    if (String(id).startsWith('quadrant:caption:')) return { idx: -1, text: `${text} (${quadrantBoxName(box, env.options)})` };
    if (String(id).startsWith('zone:')) {
      const grid = options.zones?.grid;
      const cell = grid?.cells?.find(cell => String(id) === `zone:label:${cell.id}`);
      return { idx: -1, text: cell ? `${text} (${grid!.y.length === 2 ? [chartString(env.options, 'bottom'), chartString(env.options, 'middle'), chartString(env.options, 'top')][cell.row] : chartString(env.options, 'rowCount', { v1: cell.row + 1 })} ${grid!.x.length === 2 ? [chartString(env.options, 'left'), chartString(env.options, 'middle'), chartString(env.options, 'right')][cell.column] : chartString(env.options, 'columnCount', { v1: cell.column + 1 })})` : text };
    }
    const p = /^(point|value):/.test(String(id)) ? byId.get(owner.pointId!) : undefined;
    if (!p) return undefined;
    // One item per point. A lost name and a lost value share one text, so a
    // point is listed once; a bubble's printed value follows its position.
    const value = valueText.get(p.id);
    // A bubble value whose name the plot shows is listed by the name alone ("PortNexus 2.7").
    if (String(id).startsWith('value:') && named.has(p.id) && value !== undefined) {
      return { idx: p.idx, text: `${p.label}\u00a0${value}`, valueFor: p.id };
    }
    // A narrow note keeps a name with its position and value on one line ("CupriCo (−3, 4) 4.9").
    const sp = '\u00a0';
    return { idx: p.idx, text: `${p.label}${sp}(${env.axisFmt.x(p.x)},${sp}${env.axisFmt.y(p.y)})${value !== undefined && domain.bubbleMode ? `${sp}${value}` : ''}` };
  };
  if (hideListed) {
    for (const request of requests) {
      const pointText = request.id.startsWith('value:') ? noteText(`point:${request.owner.pointId}`, request.owner, request.text)?.text : undefined;
      if (!listed.has(noteText(request.id, request.owner, request.text)?.text ?? '') && !(pointText !== undefined && listed.has(pointText))) continue;
      request.redundant = true;
      request.suppressedAs = 'density';
    }
  }
  // The tier probe of this run's tier and value set solved these same requests on these claims.
  const unmoved = keepNamesApart(requests, occupied, solveCtx, env.size, hideListed ? undefined : probes.get(probeKey(env.valueTier ?? 0, env.valueInsideOnly)));
  // The claims from before the final solve.
  const before = occupied;
  let solved: SolveResult;
  if (unmoved) {
    // No name moved: the probe is the final solve.
    solved = unmoved.result;
    occupied = unmoved.index;
  } else {
    occupied = copyOccupied(before, env.size);
    solved = solveLabels(requests, occupied, solveCtx);
  }
  // Only where a name is lost, free its seat (seatLostNames): the probe that
  // seated it, on the claims from before the first solve, is the final solve.
  // Dots too: a name ranked first can take the seat a later name needed (log-both-stores-revenue: Company H over Company I).
  // A dot chart repairs one lost name only: on a crowded card (score-vs-cost-frontier at 320 px)
  // the repair spent the probes the note runs needed, and a name the plain layout drew went to the note.
  // It spends at most DOT_SEAT_PROBES: a dense dot chart (dense-40-thinning) spent all eight on a name no seat frees.
  const lostPoints = solved.placed.filter((label) => label.hidden && String(label.id).startsWith('point:')).length;
  const spare = domain.bubbleMode ? 0 : Math.max(0, seatProbe.left - seatProbe.dotLeft);
  seatProbe.left -= spare;
  const leftBefore = seatProbe.left;
  const seated = lostPoints > 0 && (domain.bubbleMode || lostPoints === 1)
    ? seatLostNames(requests, before, solveCtx, env.size, solved.placed, !domain.bubbleMode) : undefined;
  if (!domain.bubbleMode) seatProbe.dotLeft -= leftBefore - seatProbe.left;
  seatProbe.left += spare;
  if (seated) {
    solved = seated.result;
    occupied = seated.index;
  }
  // A plot key that crowds a point name (closer than
  // KEY_LABEL_GAP) reads as part of the plot and goes to the key row
  // (seen on a quadrant chart at 400 px).
  const lostIn = (labels: readonly { id: Id; hidden?: unknown }[]) => labels.reduce((sum, label) => sum
    + (!label.hidden ? 0 : String(label.id).startsWith('point:') ? 1000 : String(label.id).startsWith('value:') ? 1 : 0), 0);
  let rowAlternative: { geo: Geometry<ScatterMarks, ScatterDerived>; lost: number } | undefined;
  if (plotKey && !sizeKeyInRow && !keepKeyInPlot && run === 0 && !hideListed
    && solved.placed.some((label) => !label.hidden && String(label.id).startsWith('point:') && plotKey!.rects.some((rect) => rectGap(rect, label.rect) < KEY_LABEL_GAP))) {
    // Names come first: the key row takes plot height from the names
    // (VoltStream and CupriCo left the plot at 320 px).
    // A bubble chart (no 2x2) keeps the key in the plot when the row costs
    // a name; a value it costs counts too, below any name (it goes to the note).
    const inRow = layoutScatter(data, options, hiddenNames, run, hideListed, valueTier, true, calloutMode, valueInsideOnly);
    if (!domain.bubbleMode || domain.quadrants.derived || lostIn(inRow.labels) < 1000) return inRow;
    // Else this layout goes on with the key in the plot, and its result is
    // taken when it loses less (one layout less, the same choice).
    rowAlternative = { geo: inRow, lost: lostIn(inRow.labels) };
  }
  const keepKey = keepKeyInPlot || rowAlternative !== undefined;
  const pick = (inPlot: Geometry<ScatterMarks, ScatterDerived>): Geometry<ScatterMarks, ScatterDerived> => {
    return !rowAlternative || lostIn(inPlot.labels) < rowAlternative.lost ? inPlot : rowAlternative.geo;
  };
  // A name that carries a callout and finds no seat gives the callout back to the annotation pass.
  if (merged.callouts.size > 0 && solved.placed.some((label) => label.hidden && String(label.id).startsWith('point:') && merged.callouts.has(label.owner.pointId!))) {
    return pick(layoutScatter(data, options, hiddenNames, run, hideListed, valueTier, sizeKeyInRow, calloutMode === 'line' ? 'wrap' : 'off', valueInsideOnly, keepKey));
  }
  const lostNames = new Set(solved.placed.filter((label) => label.hidden && String(label.id).startsWith('point:')).map((label) => label.owner.pointId));
  // One item per point: a lost name's item carries the value too.
  const entryFor = (label: { id: Id; owner: { pointId?: Id }; text: string }) => {
    const entry = noteText(label.id, label.owner, label.text);
    return entry?.valueFor !== undefined && lostNames.has(entry.valueFor) ? noteText(`point:${entry.valueFor}`, label.owner, label.text) : entry;
  };
  const lost = solved.placed.flatMap((label) => {
    const entry = label.hidden ? entryFor(label) : undefined;
    return entry ? [entry] : [];
  });
  // The next run lists exactly what this one lost. A run whose list holds
  // everything it lost stands; the last run keeps the union, so nothing it
  // hides goes unlisted.
  const lostTexts = [...new Set(lost.sort((a, b) => a.idx - b.idx).map((entry) => entry.text))];
  const complete = lostTexts.every((text) => listed.has(text));
  const exact = complete && lostTexts.length === listed.size;
  if (!exact && run < 4 && (lostTexts.length > 0 || listed.size > 0)) {
    const next = complete ? lostTexts : run === 3 ? [...new Set([...listed, ...lostTexts])] : lostTexts;
    if (next.length !== listed.size || next.some((text) => !listed.has(text))) {
      const attempt = layoutScatter(data, options, next, run + 1, hideListed, env.valueTier, sizeKeyInRow, calloutMode, env.valueInsideOnly, keepKey);
      // A trimmed list that loses a name the longer one covered is not taken.
      if (!complete || !notListed(attempt)) return pick(attempt);
    }
  }
  // Left with a list longer than what this run lost: the note takes room, the
  // room places a name the note lists, and the shorter note loses it again.
  // The note then names labels the plot draws. Hide every listed label once
  // more in this layout, so the note lists exactly the points left unlabelled.
  if (complete && !exact && !hideListed) return pick(layoutScatter(data, options, hiddenNames, run, true, env.valueTier, sizeKeyInRow, calloutMode, env.valueInsideOnly, keepKey));
  // the labels the note lists are named there by identity.
  const own = solved.placed.filter((label) => label.hidden && listed.has(entryFor(label)?.text ?? ''));
  // a disclosed zone caption is an information note, like a disclosed point name.
  const notedIds = new Set([...solved.placed.filter(label => label.noted), ...own].map(label => label.id));
  pushAll(warnings, solved.warnings.map(warning => warning.code === 'label-hidden'
    && notedIds.has(warning.message.match(/label '([^']+)'/)?.[1] ?? '') ? { ...warning, severity: 'info' as const } : warning));
  pushAll(warnings, annotated.warnings);
  const drawn = assembleScatterGeometry({ env, domain, frame, area: area!, geometry, solved, annotated, occupied, warnings });
  // The note names these by identity (or counts them): the registry's items and this chart's own names.
  const names = [...(hiddenNames ?? [])];
  const counted = new Set<Id>([...hiddenNote.counted].filter((id) => !id.startsWith('scatter:')));
  for (const label of own) {
    const at = names.indexOf(entryFor(label)?.text ?? '');
    if (hiddenNote.counted.has(`scatter:${at}`)) counted.add(label.id);
  }
  markNotedLabels(drawn, new Set([...hiddenNote.ids].filter((id) => !id.startsWith('scatter:')).concat(own.map((label) => label.id))), counted);
  for (const label of own) label.noted = true;
  return pick(drawn);
}
