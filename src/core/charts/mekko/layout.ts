import { PLOT_FLOOR_RECT } from '../../sizing';
import { sk, stackParts } from '../band/stacks';
import { chartString } from '../../strings/mekko';
import { noTotal } from '../../stackAdds';
import { withSegmentSeams } from '../../markVisibility';
import { emphasisLabelTheme, emphasisWeight } from '../../theme';
import { structureCount } from '../../structureCounts';
/**
 * Mekko / Marimekko — variable-width columns over ChartData,
 * NO gaps between columns.
 *
 * Modes:
 * - 'percent': widths ∝ category totals, each column a 100%-stack of shares,
 *   percent axis shown by default, column label + bold total above each column.
 * - 'unit': widths from widthSeriesId (or category totals), heights are
 *   absolute stacks on a shared absolute axis, totals above column tops.
 * - 'bar' (bar-mekko, profit pool): one rect per category — width from
 *   widthSeriesId, height = the single data series' value (negatives allowed).
 *
 * Segment stacks build top→down in per-category sort order (sheet default,
 * 'sheet' preserves, an 'others' series pins to the bottom); a percent ridge
 * series with no authored sort stacks at the baseline. Ridge traces the
 * top edge of one series' band. A percent mekko with no authored legend
 * names its series in the widest column instead of a key. valueLine 'mean' is
 * the WIDTH-WEIGHTED mean.
 *
 * `layoutMekko` runs five phases, each a function from typed structs
 * to one new struct:
 *   1. domain and scales: `resolveMekkoDomain` (domain.ts), then
 *      `solveMekkoFrame` and `mekkoPlotArea` (plot.ts);
 *   2. mark geometry: `layoutMekkoMarks` (marks.ts);
 *   3. label planning: `planMekkoLabels` (labels.ts), then `solveLabels`;
 *   4. annotations: `runAnnotatePass`;
 *   5. geometry assembly: `assembleMekkoGeometry`.
 * No phase before the solver writes to the run's OccupiedIndex. The frame
 * and the marks claim into fresh indexes of their own; this function commits
 * them in claim order before the solver reads the run's index.
 */

import type { AnchorResolution, AnnotatePassResult } from '../../annotate';
import { runAnnotatePass } from '../../annotatePass';
import { applyValueAxisTitleInk, valueAxisTitleRequest } from '../../axis';
import { rectSeriesAdjacentWarnings } from '../../adjacentSeries';
import type { RoundingAdjustment } from '../../shareRounding';
import type { Rect } from '../../geometry';
import { labelsToNodes } from '../../label/emit';
import { createOccupiedIndex, type OccupiedIndex } from '../../label/occupied';
import { solveLabels, type SolveCtx, type SolveResult } from '../../label/solver';
import type { TickBandDerived } from '../../label/tickRow';
import { accessibleTitle } from '../../normalize/shared';
import type { AnchorRef } from '../../types/annotations';
import type { Id } from '../../types/cell';
import type { ChartData } from '../../types/data';
import type { MekkoOptions } from '../../types/options';
import type { Geometry, LintWarning, PaintWarningRule, PlacedLabel } from '../../types/scene';
import { resolveMekkoDomain, resolveMekkoEnv } from './domain';
import { columnTotalText, planMekkoLabels } from './labels';
import { layoutMekkoMarks } from './marks';
import { colCx, type MekkoArea, type MekkoDomain, type MekkoEnv, type MekkoMarkGeometry, type MekkoPaints } from './model';
import { kindSetting, MEKKO_NOT_DRAWN, mekkoPaints, mekkoPlotArea, solveMekkoFrame } from './plot';
import { authoredNotes, withAuthoredFootnotes } from '../../frame';
import { disclosureNote, disclosuresShown } from '../../notes';
import { pushAll } from '../../arrays';

export interface MekkoMarks {
  columns: {
    categoryId: Id;
    x: number;
    w: number;
    rect: Rect;
    segments: { seriesId: Id; rect: Rect; nodeId: Id }[];
  }[];
  /** Path node of the ridge outline when options.ridge is set. */
  ridgeNodeId?: Id;
}

export interface MekkoDerived {
  /** Absolute column totals (mode 'bar': the plotted value). */
  columnTotals: Record<Id, number>;
  /** The series parts of each total in columnTotals, per category × series. */
  stackParts: Record<Id, Record<Id, number>>;
  /** Percent of column per category × series. */
  shares: Record<Id, Record<Id, number>>;
  /** Final pixel width per category. */
  widths: Record<Id, number>;
  /** rounding 'sum-consistent': the shares printed off their nearest rounding. */
  roundingAdjustments?: RoundingAdjustment[];
  /**
   * The tick band: absent only when category names are not rendered. Percent
   * mode stacks the names ABOVE the 100% edge (`position: 'above'`, gap 4);
   * unit/bar reserve the bottom band (gap 8).
   */
  tickBand?: TickBandDerived;
}

/** A column with no known total: every part blank, a part missing, or shares of an unknown whole. Blank is not 0. */
function totalUnknown(domain: MekkoDomain, ci: number): boolean {
  const id = domain.cats[ci]!.id;
  return !domain.series.some((s) => s.vals[ci]!.v !== null) || domain.incomplete.has(id) || domain.wholeUnknown.has(id) || (domain.mode !== 'bar' && domain.unknownTotals.has(id));
}

/** Phase 4: annotations. `{categoryId, seriesId?}` resolves to a segment edge or the column top. */
function annotateMekko(
  env: MekkoEnv,
  domain: MekkoDomain,
  area: MekkoArea,
  geometry: MekkoMarkGeometry,
  occupied: OccupiedIndex,
  solveCtx: SolveCtx,
): AnnotatePassResult {
  const { cats } = domain;
  const { y, y0, plot, topPad } = area;
  const catIndex = new Map(cats.map((c, i) => [c.id, i] as const));
  const resolveAnchor = (ref: AnchorRef): AnchorResolution | null => {
    const norm = typeof ref === 'string' ? { categoryId: ref, edge: 'total' as const } : ref;
    if (!('categoryId' in norm)) return null;
    const ci = catIndex.get(norm.categoryId);
    if (ci === undefined) return null;
    const c = cats[ci]!;
    if (domain.invalidAt(ci)) return null;
    if (norm.seriesId) {
      const e = geometry.segEdges.get(sk(norm.seriesId, c.id));
      if (!e) return null;
      const edge = norm.edge ?? 'end';
      const named = domain.series.find((s) => s.id === norm.seriesId);
      return {
        x: colCx(area, ci),
        y: edge === 'start' ? y(e.bot) : y(e.top),
        value: e.abs ?? e.v,
        format: named?.format,
        date: c.date,
        owner: { categoryId: c.id, seriesId: norm.seriesId },
        ...(named && domain.series.length > 1 ? { series: { id: named.id, label: named.label } } : {}),
      };
    }
    const topPlotted = domain.posTop[ci]! > 0 ? domain.posTop[ci]! : domain.negBot[ci]!;
    return {
      x: colCx(area, ci),
      y: norm.edge === 'start' ? y0 : y(topPlotted),
      value: domain.columnTotals[c.id]!,
      ...noTotal(true, !totalUnknown(domain, ci)),
      format: domain.series.length === 1 ? domain.series[0]!.format : undefined,
      date: c.date,
      owner: { categoryId: c.id },
    };
  };
  // liftArm clamps arms to plot.y + labelHeight; extend the rect it sees
  // upward into our reserved top-label headroom (annotate.ts is shared).
  const annPlot: Rect = { x: plot.x, y: plot.y - (topPad - 8 - area.axisTitleBand), w: plot.w, h: plot.h + (topPad - 8 - area.axisTitleBand) };
  return runAnnotatePass({
    annotations: env.options.annotations ?? [],
    resolve: resolveAnchor,
    defaultSpan: cats.length >= 2 ? { from: cats[0]!.id, to: cats[cats.length - 1]!.id } : undefined,
    occupied,
    plot: annPlot,
    // The labels draw bold (see labelsToNodes below), so the pass measures them bold.
    theme: emphasisLabelTheme(env.theme),
    measure: env.measure,
    format: env.options.format,
    locale: env.options.locale?.language,
    strings: env.options.strings,
    valueLinePercentLevels: env.options.unit === '%' || domain.mode === 'percent',
    solveCtx,
    yScale: y,
    meanValue: domain.meanValue,
  });
}

function mekkoDescription(env: MekkoEnv, domain: MekkoDomain): string {
  const { mode, cats, series, widthSer, nm, na } = domain;
  const modeName = mode === 'percent' ? chartString(env.options, 'mekkoPercentAxis') : mode === 'unit' ? chartString(env.options, 'mekkoUnitAxis') : chartString(env.options, 'barMekko');
  const widthText = widthSer ? `'${widthSer.label}'` : chartString(env.options, 'categoryTotals');
  if (mode === 'percent' && (nm.size > 0 || na.size > 0)) {
    return chartString(env.options, 'mekkoValidDesc', { v1: modeName, v2: domain.validCount, v3: series.length }) +
      widthText +
      chartString(env.options, 'mekkoInvalidDesc', { v1: cats
        .flatMap((c, ci) => (domain.invalidAt(ci) || totalUnknown(domain, ci) ? [] : [`${c.label ?? c.id} ${columnTotalText(env, domain, ci)}`]))
        .join(', ') || 'none', v2: cats
        .filter((_, ci) => domain.invalidAt(ci))
        .map((c) => `${c.label ?? c.id} (${nm.has(c.id) ? 'n.m.' : 'n/a'})`)
        .join(', ') });
  }
  const totals = cats.flatMap((c, ci) => (totalUnknown(domain, ci) ? [] : [`${c.label ?? c.id} ${columnTotalText(env, domain, ci)}`]));
  return chartString(env.options, 'mekkoDesc', { v1: modeName, v2: cats.length, v3: series.length }) +
    widthText +
    (totals.length > 0 ? chartString(env.options, 'totalsSentence', { v1: totals.join(', ') }) : '.');
}

/** Phase 5: the scene in paint order, the x axis, the derived record, the description and the paint lint. */
function assembleMekkoGeometry(input: {
  env: MekkoEnv;
  domain: MekkoDomain;
  area: MekkoArea;
  paints: MekkoPaints;
  geometry: MekkoMarkGeometry;
  solved: SolveResult;
  annotated: AnnotatePassResult;
  occupied: OccupiedIndex;
  warnings: LintWarning[];
}): Geometry<MekkoMarks, MekkoDerived> {
  const { env, domain, area, geometry, solved, annotated, warnings } = input;
  const { cats } = domain;
  const { frame, catPlan, showCats } = area;
  const catFont = catPlan.font;
  const allLabels: PlacedLabel[] = [...solved.placed, ...annotated.labels];
  const nodes = [...frame.nodes, ...geometry.nodes, ...annotated.nodes];
  pushAll(nodes, labelsToNodes(env.theme, allLabels, (l) =>
      l.kind === 'total' || l.kind === 'grandTotal'
        ? area.strongFont
        : l.kind === 'category'
          ? catFont
          : l.kind === 'annotation' || l.kind === 'valueLine'
            ? { ...area.labelFont, weight: emphasisWeight(env.theme) }
            : area.labelFont, nodes,
    ));
  const axes = [
    {
      axis: 'x' as const,
      baselineNodeId: 'axis:baseline',
      ticks: cats.map((c, i) => ({ at: c.id, pos: colCx(area, i), labelId: showCats ? `category:${c.id}` : undefined })),
    },
    ...geometry.axes,
  ];
  const a11yDesc = mekkoDescription(env, domain);
  const paintWarningRules: PaintWarningRule[] = [];
  pushAll(warnings, rectSeriesAdjacentWarnings(nodes, input.paints.css, 'vertical', env.highlights, env.theme, { rules: paintWarningRules, before: warnings.filter(warning => !['pie-ramp-crowded', 'likert-ramp-invisible', 'band-lightness-insufficient', 'series-adjacent-similar', 'highlight-reads-as-loss'].includes(warning.code)).length }));
  const catTickMaxLines = catPlan.maxLines;
  // A column with no value, with shares only, or with shares of an unknown whole has no total: omitted, not a certified 0.
  const printedTotals: Record<Id, number> = Object.fromEntries(domain.cats.flatMap((c, ci) =>
    (domain.series.some((s) => s.vals[ci]!.v !== null) && !domain.unknownTotals.has(c.id) && !domain.wholeUnknown.has(c.id) ? [[c.id, domain.columnTotals[c.id]!]] : [])));
  return {
    type: 'mekko',
    size: env.size,
    plot: area.plot,
    ...(area.floorPlot !== area.plot ? { [PLOT_FLOOR_RECT]: area.floorPlot } : {}),
    scene: withSegmentSeams(nodes, env.theme),
    labels: allLabels,
    axes,
    annotations: annotated.placed,
    legend: frame.legend,
    frame: frame.frame,
    marks: geometry.marks,
    derived: {
      columnTotals: printedTotals,
      stackParts: stackParts(printedTotals, domain.cats, domain.series, (si, ci) => domain.absAt(domain.series[si]!, ci)),
      shares: domain.shares,
      widths: geometry.widths,
      ...(domain.roundingAdjustments ? { roundingAdjustments: domain.roundingAdjustments } : {}),
      ...(showCats
        ? {
            tickBand: {
              reserved: area.categoryTickReserve,
              measuredLines: catTickMaxLines,
              lineHeight: catFont.size * 1.2,
              extra: catPlan.rowHeight - catTickMaxLines * catFont.size * 1.2,
              dateNumeric: area.dateNumericTicks,
              position: area.catsOnTop ? ('above' as const) : ('below' as const),
            },
          }
        : {}),
    },
    a11y: {
      titleCounts: [structureCount('categories', cats.length, undefined, env.options)],
      title:
        accessibleTitle(env.options.title, chartString(env.options, 'mekkoTitle', { v1: domain.series.map((s) => s.label).join(', '), v2: cats.length })),
      counts: [domain.mode === 'percent' && (domain.nm.size > 0 || domain.na.size > 0)
          ? structureCount('columns', domain.validCount, chartString(env.options, 'validColumns', { v1: domain.validCount }))
          : structureCount('columns', cats.length, undefined, env.options), structureCount('series', domain.series.length, undefined, env.options)],
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

/**
 * The notes a reader needs to name what the drawing cannot: columns too
 * narrow for their name, columns not drawn, and the members of the pooled
 * Others column. They depend on the column widths, so a first pass finds them
 * and a second lays the chart out with them; the widths do not move, since a
 * note only takes height.
 */
/** Columns with no value or under 0.5 px wide share one explanation in the note and the key. */
function notDrawnColumns(env: MekkoEnv, domain: MekkoDomain, area: MekkoArea): string[] {
  const missing: string[] = [];
  const negative: string[] = [];
  const narrow: string[] = [];
  domain.cats.forEach((c, ci) => {
    const tooThin = area.xEdge[ci + 1]! - area.xEdge[ci]! < 0.5;
    const name = c.label ?? c.id;
    if (domain.incomplete.has(c.id) && (tooThin || !domain.anyByCat[ci])) missing.push(name);
    else if (tooThin && !domain.invalidAt(ci)) {
      if (domain.columnTotals[c.id]! < 0) negative.push(`${name} ${columnTotalText(env, domain, ci)}`);
      else narrow.push(name);
    }
  });
  return [
    ...(narrow.length > 0 ? [chartString(env.options, 'mekkoZeroNote', { v1: narrow.join(', ') })] : []),
    ...(negative.length > 0 ? [chartString(env.options, 'mekkoNegativeNote', { v1: negative.join(', ') })] : []),
    ...(missing.length > 0 ? [chartString(env.options, 'mekkoMissingNote', { v1: missing.join(', ') })] : []),
  ];
}

function mekkoNotes(env: MekkoEnv, domain: MekkoDomain, area: MekkoArea): string[] {
  const name = (ci: number): string => domain.cats[ci]!.label ?? domain.cats[ci]!.id;
  const notes: string[] = [];
  if (area.unnamed.length > 0) {
    // Totals have their own label and omission path. This note only supplies missing category names.
    const unnamed = area.unnamed.map(name);
    notes.push(disclosureNote(chartString(env.options, 'mekkoUnnamedNote', { v1: unnamed.join(', ') })));
  }
  for (const text of notDrawnColumns(env, domain, area)) notes.push(disclosureNote(text));
  const others = domain.othersId === null ? undefined : domain.cats.find((c) => c.id === domain.othersId);
  if (others && domain.othersMembers.length > 0) notes.push(disclosureNote(`${others.label ?? others.id}: ${domain.othersMembers.join(', ')}.`));
  return notes;
}

export function layoutMekko(
  data: ChartData,
  options: MekkoOptions = {},
): Geometry<MekkoMarks, MekkoDerived> {
  // A percent mekko with no authored legend first tries to name each series
  // in the widest column. It keeps that only when every series' label there
  // printed; otherwise the key comes back.
  if (options.legend === undefined && (options.variant ?? 'stacked100') === 'stacked100' && options.labels !== false) {
    const named = layoutMekkoPass(data, options, true, true);
    if (named.namedAll) return named.geometry;
  }
  return layoutMekkoPass(data, options).geometry;
}

/** Every plotted series printed its named label in the named column. */
function everySeriesNamed(domain: MekkoDomain, area: MekkoArea, placed: readonly PlacedLabel[]): boolean {
  if (area.namedCol < 0 || domain.series.length < 2) return false;
  const c = domain.cats[area.namedCol]!;
  const ids = new Set(placed.flatMap((l) => (l.hidden === undefined ? [l.id] : [])));
  return domain.series.every((s) => ids.has(`segment:${s.id}:${c.id}`));
}

function layoutMekkoPass(
  data: ChartData,
  options: MekkoOptions,
  addNotes = true,
  named = false,
): { geometry: Geometry<MekkoMarks, MekkoDerived>; namedAll: boolean } {
  const warnings: LintWarning[] = [];
  const env = resolveMekkoEnv(options, warnings, data);
  const domain = resolveMekkoDomain(data, env, warnings);
  if (named) {
    if (domain.mode !== 'percent' || domain.series.length < 2 || kindSetting(env, 'segment') !== true) return { geometry: undefined!, namedAll: false };
    env.namesInPlace = true;
  }
  const paints = mekkoPaints(env, domain, warnings);
  const { size } = env;
  const { frame, claims } = solveMekkoFrame(env, domain, paints);
  const area = mekkoPlotArea(env, domain, frame, warnings);
  // The key names the columns this pass could not draw; a key row takes height, not width, so the set holds.
  const notDrawn = notDrawnColumns(env, domain, area);
  if (notDrawn.length > 0 && !disclosuresShown(options) && !(options as { [MEKKO_NOT_DRAWN]?: string[] })[MEKKO_NOT_DRAWN]) {
    return layoutMekkoPass(data, { ...options, [MEKKO_NOT_DRAWN]: notDrawn } as MekkoOptions, addNotes, named);
  }
  // Notes depend only on column widths; the discarded pass needs no marks, labels or annotations.
  const notes = addNotes ? mekkoNotes(env, domain, area) : [];
  if (notes.length > 0 && options.footnotes !== false) {
    const authored = (options as { authoredFootnotes?: string[] }).authoredFootnotes ?? options.footnotes;
    return layoutMekkoPass(data, withAuthoredFootnotes(options, [...authoredNotes(options), ...notes], authored), false, named);
  }
  const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  commitClaims(occupied, claims);
  const geometry = layoutMekkoMarks(env, domain, area, paints, warnings);
  commitClaims(occupied, geometry.claims);
  const requests = planMekkoLabels(env, domain, area, geometry, paints, warnings);
  if (area.axisTitle) {
    requests.unshift(valueAxisTitleRequest(area.axisTitle, { x: frame.plot.x, y: frame.plot.y + 4 }, 'start', 'axis:y:title'));
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
  };
  // The totals of a percent mekko sit on one line above equal-height columns, so one that fails thins the whole row.
  // Bar and unit column tops form a staircase: each total keeps its own seat and only one without a seat drops.
  if (domain.mode === 'percent') solveCtx.valueRows = [{ ids: domain.cats.map(category => `total:${category.id}`), alternate: true }];
  const solved = solveLabels(requests, occupied, solveCtx);
  applyValueAxisTitleInk(solved.placed);
  pushAll(warnings, solved.warnings);
  const namedAll = named && everySeriesNamed(domain, area, solved.placed);
  // A failed try is discarded: skip the annotation pass and the assembly.
  if (named && !namedAll) return { geometry: undefined!, namedAll };
  const annotated = annotateMekko(env, domain, area, geometry, occupied, solveCtx);
  pushAll(warnings, annotated.warnings);
  return { geometry: assembleMekkoGeometry({ env, domain, area, paints, geometry, solved, annotated, occupied, warnings }), namedAll };
}
