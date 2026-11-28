import { a11yDescription } from '../../a11yDescription';
/** Native horizontal bars, including tornado drivers and football-field ranges. */
import { chartPalette, chartTheme } from '../chartEnv';
import { chartString } from '../../strings/barIntervals';
import { separationStroke, withSegmentSeams } from '../../markVisibility';
import { stringFields } from '../../strings';
import { structureCount, type StructureCount } from '../../structureCounts';
import { rowLabelBand } from '../../label/rowLabels';
import { barGroupColumn, categoryGapAfter } from '../../label/categoryGroups';
import { fittedLabel, gutterBudget, stepDownFont } from '../../label/rowFit';
import { applyValueAxisTitleInk, layoutValueAxis, planCategoryTitle, planValueAxisTitle, tickRowTitleEnd, valueAxisTitleRequest, valueAxisTitleText, valueAxisUnit } from '../../axis';
import { seriesRasterFormatter } from '../../formatSpec';
import { rectContains, rectsOverlap, rowLabelX, unionRect, type Rect } from '../../geometry';
import { labelsToNodes } from '../../label/emit';
import { createOccupiedIndex, type OccupiedIndex } from '../../label/occupied';
import { labelCtx, PRIORITY, solveLabels, type LabelRequest, type SlotCandidate, type SolveCtx } from '../../label/solver';
import { NormalizeError, normalizeCategory, normalizeSeriesValues, resolveHighlight, resolveSize } from '../../normalize/shared';
import { rangeMidUndrawn, resolveCellRange, type RangeMark } from '../../rangeRules';
import { applyAxisBounds, applyTickStep, shownTickStep, bandScale, linearScale, niceDomain, type BandScale } from '../../scale';
import { authoredNotes, frameTextOptions, normalizeLegendOption, noteLine, solveFrame, type LegendItemInput, plotHeightAfter, authoredFootnoteCount } from '../../frame';
import { HARD_MINIMUM } from '../../sizing';
import { defaultMeasurer, type FontSpec, type TextMeasurer } from '../../text';
import { canvasMargin, markRolePaint, paintColor, panelTypeClass, seriesPaint as themeSeriesPaint, typeWidthClass, emphasisWeight, strokeToken, dashToken } from '../../theme';
import { cellMeta, cellValue, type CellMeta, type Id, type OwnerRef } from '../../types/cell';
import type { ChartData } from '../../types/data';
import type { BarOptions, LabelKind, LegendOptions } from '../../types/options';
import type { Geometry, LintWarning, Paint, PlacedAnnotation, SceneNode, ShownMark } from '../../types/scene';
import type { Theme } from '../../types/theme';
import type { FootballFieldBarOptions, TornadoBarOptions } from './types';
import { labelOn as barLabelOn } from '../labelOn';
import { bandSteps, CAT_BAND_GAP, CAT_MAX_LINES, fixedBarRow, LABEL_GAP, NO_NAME_COLUMN } from './model';
import { composedTextRole } from '../../textRole';
import { textScaleOf } from '../../typeFloors';
import { disclosureNote, disclosuresShown } from '../../notes';
import { omittedKey } from '../../seriesIdentity';
import { maxOf, minOf, pushAll } from '../../arrays';
import { ITEM_BUDGET } from '../../itemBudget';
import { layoutBarRows, barSizing, baseValueIgnored, LABEL_PAD, naturalCategoryHeights, type BarAnnotationPass, type BarNaturalMinimum, type BarDerived, type BarMarks, type TornadoRowDerived } from './rows';
import { applyBarTopN, barNameTrack, drawBarIndicator, fixedRowWithFraction, positionBarLabels } from './rowOptions';
import { footballRangeRequired, intervalSeries, tornadoBaseRequired, type RowIntervalMode } from './intervalSeries';

export type { BarAnnotationPass, BarDerived, BarMarks, BarNaturalMinimum } from './rows';

const barFeatures = {
  intervals: layoutRowIntervals, topN: applyBarTopN, nameTrack: barNameTrack,
  alignRow: rowLabelX, fixedRow: fixedRowWithFraction, indicator: drawBarIndicator, positionLabels: positionBarLabels,
};

/** All native bar variants share the sizing and label passes used by column and Likert. */
export function layoutBar(data: ChartData, options: BarOptions = {}, annotationPass?: BarAnnotationPass,
  checkNaturalHeight: boolean | BarNaturalMinimum = true): Geometry<BarMarks, BarDerived> {
  return layoutBarRows(data, options, barFeatures, annotationPass, checkNaturalHeight);
}

function warnRangeBarIgnoredRanking(
  mode: 'football-field' | 'tornado',
  options: { topN?: unknown; sort?: { segments?: string } },
  warnings: LintWarning[],
  categoryCount: number,
): void {
  if (options.topN) {
    // The item budget counts a chart after its topN, so over the budget the patched spec would be refused.
    const patch = categoryCount > ITEM_BUDGET ? {} : { field: ['options', 'topN'], fix: [{ op: 'remove' as const, path: '/options/topN' }] };
    warnings.push(
      mode === 'football-field'
        ? {
            code: 'football-field-topn-ignored',
            severity: 'warn',
            message: 'football-field does not aggregate method ranges with topN; all methods remain visible',
            suggest: 'filter methods before layout instead of aggregating intervals',
            ...patch,
          }
        : {
            code: 'tornado-topn-ignored',
            severity: 'warn',
            message: 'tornado does not aggregate drivers with topN; all drivers remain visible',
            suggest: 'drop the drivers you do not want before layout — an aggregated driver has no one-at-a-time swing',
            ...patch,
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
/** The current-value claim is x±0.5 because the rule has width 1. */
const SPINE_CLAIM_HALF_WIDTH = 0.5;
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
  /** The record fields the label prints (field:<key>). */
  fields: readonly ('low' | 'high')[];
  /** The record that holds those fields, where it is not the label's owner (a tornado driver). */
  recordOwner?: OwnerRef;
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
  /**
   * tornado only: the text of `value` inside the drawn label, where the label
   * is the engine's own. Each driver's record holds the value as its base field.
   */
  baseText?: string;
}

interface RowIntervalPlan {
  cats: RowCat[];
  rows: PlannedRow[];
  spine?: RowSpine;
  /**
   * Frame footnotes the ENGINE owns, appended after the author's own. Only
   * notes a reader needs to read the bars correctly (hatched bars, drivers
   * not shown).
   */
  disclosures?: string[];
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
  a11yTypeName: readonly [string, string];
  a11yTitleCounts: StructureCount[];
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

function tornadoEndpointCandidates(
  side: RowEndpoint['side'], at: number, size: { width: number; height: number },
  center: number, rowY: number, barHeight: number,
): SlotCandidate[] {
  const { width: w, height: h } = size;
  const low = side === 'low';
  const centered = at - w / 2;
  return [
    { slot: low ? 'outsideLow' : 'outsideHigh', rect: { x: low ? at - LABEL_GAP - w : at + LABEL_GAP, y: center - h / 2, w, h }, penalty: 0 },
    { slot: low ? 'aboveLow' : 'aboveHigh', rect: { x: centered, y: rowY - h - 3, w, h }, penalty: 1 },
    { slot: low ? 'belowLow' : 'belowHigh', rect: { x: centered, y: rowY + barHeight + 3, w, h }, penalty: 2 },
  ];
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

/** A native interval bar uses the shared range layout and its variant's warnings. */
function layoutRowIntervals(data: ChartData, options: BarOptions, mode: RowIntervalMode): Geometry<BarMarks, BarDerived> {
  if (mode === 'tornado') refuseTornadoDetails(data, options);
  const geometry = layoutRows(data, options, mode);
  if (mode === 'football-field' && options.baseValue !== undefined) geometry.warnings.push(baseValueIgnored());
  return geometry;
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
      normalizeSeriesValues(series, cats, index, 'values', data.series).flatMap((cell) => {
        const range = typeof cell === 'object' && cell !== null && 'range' in cell
          ? (cell as { range?: { low?: number; high?: number; mid?: number } }).range
          : undefined;
        return range ? [range.low, range.high, ...(options.methodNote === true ? [range.mid] : [])] : options.variant === 'football-field' ? [] : [cellValue(cell)];
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
function compactBand(count: number, plot: Rect, nameBlock: number, barNatural: number, rowGap: number, gapAfter?: number[]): BandScale {
  const slots = gapAfter && bandScale(count, [plot.y, plot.y + plot.h], { paddingInner: 0, gapAfter });
  const step = slots?.step ?? plot.h / Math.max(1, count);
  const bandwidth = Math.max(4, Math.min(barNatural, step - rowGap - nameBlock - COMPACT_NAME_GAP));
  const position = (index: number) => (slots ? slots.position(index) + step : plot.y + (index + 1) * step) - bandwidth;
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

function layoutRows(
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
  const valueSpec = seriesRasterFormatter(options.format, rowIntervalValues(data, options), options.locale?.language, options.unit);
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
  const gapAfter = cats.some(cat => cat.group !== undefined) ? cats.map((cat, i) => categoryGapAfter(cat, cats[i + 1])) : undefined;
  const steps = gapAfter ? bandSteps(cats.length, gapAfter) : cats.length;
  if (mode === 'football-field' && cats.length < data.categories.length) options = { ...options, notes: { ...options.notes, show: [...new Set([...(options.notes?.show ?? ['note']), 'disclosure' as const])] } };
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
      footnotes: [...authoredNotes(options), ...(plan.disclosures ?? [])],
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
    const lineH = tickFont.size * 1.2;
    const nameColumn = !noNameColumn && labelOn('category');
    const nameTrack = barNameTrack(options, nameColumn, plot0.w, rowWarnings);
    const catCap = nameTrack ?? Math.max(24, plot0.w * 0.28);
    const categoryTitle = planCategoryTitle(options, tickFont, measure, plot0.w, rowWarnings);
    const headerH = categoryTitle?.bandHeight ?? 0;
    const availH = plotHeightAfter(frameResult, size.height, plot0.h - currentPad - axisH - headerH);
    // A fixed bar row sizes the names to its pitch, not to the canvas.
    const stepEst = theme.space.barRow?.pitch ?? availH / steps;
    const fittedCats = rowLabelBand(
      cats.map((cat) => ({ id: cat.id, label: cat.label ?? cat.id, footnote: cat.footnote })), tickFont, catCap, stepEst >= Math.max(30, 2 * lineH + (targetSizing ? 4 : 0)) ? 2 : 1, lineH, measure,
      { target: options.target, textScale: textScaleOf(options), typeRole: 'axis', wider: nameTrack ?? gutterBudget(24, plot0.w), tightLines: Math.floor((stepEst - (targetSizing ? 4 : 0)) / lineH), shrink: stepDownFont(theme, tickFont, 'axis', options.target, textScaleOf(options)), footnoteRefs: { count: authoredFootnoteCount(options), warnings: rowWarnings } },
    );
    // A tornado driver's name prints bold over its range (tornadoHead): its seat and the band take the bold width.
    const catLines = fittedCats.labels.map((label, ci) => tornadoHead(cats[ci]!, label)
      ? { ...label, w: Math.max(label.w, measure(label.lines[0]!, { ...label.font, weight: emphasisWeight(theme) }).width) } : label);
    const catBandW = nameTrack ?? Math.max(fittedCats.width, maxOf(catLines.map((label) => label.w)));
    const fixedRow = fixedBarRow(theme, catLines.map((label) => label.h));
    const fixedRowsH = fixedRow ? fixedRow.step * steps : undefined;
    const nameW = noNameColumn ? 0 : catBandW + CAT_BAND_GAP;
    const valueBody: Rect = {
      x: plot0.x + nameW,
      y: plot0.y + currentPad + headerH,
      w: Math.max(10, plot0.w - nameW),
      // Fixed rows never stretch; a shorter canvas (a grid panel) packs them.
      h: fixedRowsH === undefined ? availH : Math.min(availH, fixedRowsH),
    };
    const leftReserve = maxLowWidth + LABEL_GAP + 8;
    const rightReserve = maxHighWidth + LABEL_GAP + 8;
    const fraction = options.bandFraction ?? fixedRow?.fraction ?? 0.56;
    const compactNames = noNameColumn ? compactPlan : undefined;
    const band = compactNames ? compactBand(cats.length, valueBody, compactNames.nameBlock, compactBar, compactRowGap, gapAfter)
      : bandScale(cats.length, [valueBody.y, valueBody.y + valueBody.h], { paddingInner: 1 - fraction, gapAfter });
    let groups;
    if (!callerNames && labelOn('category') && gapAfter) {
      // A compact name already fitted across the chart keeps every pixel of its longest line.
      const nameRoom = compactNames ? plot0.w - maxOf(compactNames.names.map(name => compactNameRight(name, 0, tickFont, emphasisWeight(theme), measure))) : Infinity;
      groups = barGroupColumn(cats, band, compactNames ? tickFont : catLines[0]!.font, measure, {
        cap: catCap, wider: nameTrack ?? gutterBudget(24, plot0.w), gap: CAT_BAND_GAP, x: plot0.x,
        spare: Math.min(nameRoom, valueBody.w - leftReserve - rightReserve - 10),
      });
      if (groups) {
        valueBody.x += groups.width;
        valueBody.w -= groups.width;
      }
    }
    const categoryX = plot0.x + (groups?.width ?? 0);
    const plot: Rect = {
      x: valueBody.x + leftReserve,
      y: valueBody.y,
      w: Math.max(10, valueBody.w - leftReserve - rightReserve),
      h: valueBody.h,
    };
    const x = linearScale([dLo, dHi], [plot.x, plot.x + plot.w]);
    const titleEnd = axisTitle && !titleRow
      ? tickRowTitleEnd(axisTitle, { scale: x, ticks: stepped.ticks, plot, orient: 'x', gridlines: false, format: fmt, formatSpec: valueSpec.spec, theme, measure, canvasWidth: size.width }, plot0.x)
      : undefined;
    const minWidth = size.width - plot0.w + nameW + leftReserve + rightReserve + 10;
    return { availH, minWidth, catCap, catLines, catBandW, categoryX, groups, band, fixedRowsH, valueBody, plot, x, titleEnd, titleRow, categoryTitle };
  };
  // With no tick row nothing reads the round ends, so the bars span the plot.
  // A football field reads its ranges against the current value, not against
  // zero or a round end, so its ticks stand inside the data extent too.
  const nice: [number, number] = !axisShown || mode === 'football-field' ? [rawLo, rawHi] : niceDomain(rawLo, rawHi, 5, {
    dataExtent: [rawLo, rawHi],
    maxWasteFraction: 0.15,
    preserveDataSideOfZero: true,
  });
  const stepped = applyTickStep(nice, shownTickStep(options.valueAxis?.tickStep, axisShown, warnings), warnings);
  const [dLo, dHi] = stepped.domain;
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
  const compact = compactPlan && rowPlan.availH >= steps * compactStep(compactBar) ? compactPlan : undefined;
  if (compactPlan && !compact) {
    currentPad = spineLabelPad;
    rowPlan = planRows(false, []);
  }
  /** Compact rows: the spine label stands in the first row's top air, its line starts under it. */
  const labelDrop = compact ? spineLift : 0;
  const spineTop = rowPlan.plot.y + (labelDrop > 0 ? labelDrop - 2 : 0);
  const { catCap, catLines, catBandW, categoryX, band, fixedRowsH, valueBody, plot, x } = rowPlan;

  const nodes: SceneNode[] = [...frameResult.nodes];
  const axes: Geometry['axes'] = [];
  if (axisShown) {
    const axis = layoutValueAxis(
      {
        scale: x,
        ticks: stepped.ticks,
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
  /** A tornado case label's texts for its driver's record, by label id. */
  const caseTexts = new Map<Id, Omit<ShownMark, 'drawn'>>();
  const labelRequests: LabelRequest[] = axisShown && axisTitle
    ? [valueAxisTitleRequest(axisTitle, { x: rowPlan.titleEnd ?? plot.x + plot.w, y: plot.y + plot.h + 6 + (rowPlan.titleRow ? tickRowH + 2 : 0) }, 'end', 'axis:x:title')]
    : [];
  if (rowPlan.categoryTitle) labelRequests.push(rowPlan.categoryTitle.request(plot0.x, plot0.y, 'start', rowPlan.groups?.width));
  if (rowPlan.groups) pushAll(labelRequests, rowPlan.groups.labels);
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
            : tornadoEndpointCandidates(endpoint.side, at, textSize, rowCenter, rowY, band.bandwidth);
        const shows = Object.fromEntries(endpoint.fields.map((key) => [`field:${key}`, text]));
        labelRequests.push({
          id: endpoint.id,
          kind: 'point',
          owner: endpoint.owner,
          text,
          // A tornado case states its text for the driver's record once it is drawn (marks.shown).
          ...(endpoint.recordOwner ? {} : { shows }),
          lines: [text],
          typeRole: 'label', font: labelFont,
          priority: PRIORITY.endpoint,
          candidates,
        });
        if (endpoint.recordOwner) caseTexts.set(endpoint.id, { owner: endpoint.recordOwner, shows });
      }
    }

    if (compact) {
      pushAll(labelRequests, compactNameRequests(compact.names[ri]!, cat, categoryX, band.position(ri) - COMPACT_NAME_GAP, nameLineH, tickFont, emphasisWeight(theme), measure));
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
              x: rowLabelX(categoryX, catBandW, category.w, options.rowLabels?.align ?? 'left'),
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
      const firstName = compactNameRight(compact.names[0]!, categoryX, tickFont, emphasisWeight(theme), measure);
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
  // The case values a tornado row draws are the driver record's low and high fields.
  const shown: ShownMark[] = solved.placed.flatMap((label) => {
    const stated = label.hidden === undefined ? caseTexts.get(label.id) : undefined;
    return stated ? [{ ...stated, drawn: true as const }] : [];
  });
  // The base case the spine label prints is each driver's base field.
  if (spine?.baseText !== undefined && solved.placed.some((label) => label.id === `valueLine:${spine.key}` && label.hidden === undefined)) {
    for (const cat of cats) shown.push({ owner: { categoryId: cat.id }, shows: { 'field:base': spine.baseText }, drawn: true });
  }
  if (shown.length > 0) marks.shown = shown;
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
  const fallbackSizing = fallbackPlan && barSizing(size, fallbackPlan, fallbackPlan.band.step,
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
    // there, as for grouped and stacked bars in rows.ts.
    legend: frameResult.legend,
    marks,
    derived: plan.derived,
    a11y: a11yDescription(options, plan.a11yTypeName, plan.a11yTitleCounts, {
      titleCounts: plan.a11yTitleCounts,
      counts: undefined,
    }),
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
  // rowIntervalValues has normalized every category already, so the series refusals may come first.
  const sourceSeries = intervalSeries(data, 'football-field');
  let cats = data.categories.map((category, index) => normalizeCategory(category as never, index));
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
  let cells = normalizeSeriesValues(series, cats, 0, 'values', data.series).map((cell, ci) => {
    const range = resolveCellRange(
      cell,
      `series[${series.id}].values[${ci}]`,
      warnings,
      { seriesId: series.id, categoryId: cats[ci]?.id },
    );
    if (!range) missingRange.push(ci);
    return { value: cellValue(cell), meta: cellMeta(cell), range: range! };
  });
  if (missingRange.length === cats.length) throw footballRangeRequired(data, options, series, missingRange[0]!);
  const missing = new Set(missingRange);
  const leftOut = missingRange.map(index => cats[index]!.label ?? cats[index]!.id);
  for (const index of missingRange) warnings.push({
    code: 'football-field-method-without-range', severity: 'warn',
    message: chartString(options, 'footballMethodWithoutRange', { v1: cats[index]!.label ?? cats[index]!.id }),
    owner: { seriesId: series.id, categoryId: cats[index]!.id },
    field: ['data', 'series', data.series.indexOf(series), 'values', index],
  });
  cats = cats.filter((_, index) => !missing.has(index));
  cells = cells.filter((_, index) => !missing.has(index));

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

  warnRangeBarIgnoredRanking('football-field', options, warnings, data.categories.length);
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
        { id: `rangeLow:${series.id}:${cat.id}`, owner, value: cell.range.low, side: 'low', fields: ['low'] },
        { id: `rangeHigh:${series.id}:${cat.id}`, owner, value: cell.range.high, side: 'high', fields: ['high'] },
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
      cells[ci]!.value ?? (cells[ci]!.range.low + cells[ci]!.range.high) / 2,
    ]),
  );
  const mean =
    cells.reduce(
      (sum, cell) => sum + (cell.value ?? cell.range.mid ?? (cell.range.low + cell.range.high) / 2),
      0,
    ) / cells.length;
  if (options.methodNote !== true && ranges.some((range) => range.mid !== undefined)) warnings.push(rangeMidUndrawn());
  const disclosures = noteLine(chartString(options, 'footballMethodsLeftOutNote'), leftOut, options).map(disclosureNote);

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
    ...(disclosures.length ? { disclosures } : {}),
    derived: {
      totals,
      order: cats.map((cat) => cat.id),
      mean,
    },
    a11yTitleCounts: [structureCount('methods', cats.length, undefined, options)],
    a11yTypeName: ['Football-field valuation', 'Bewertung mit Spannendiagramm'],
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
  // rowIntervalValues has normalized every category already, so the series refusals may come first.
  const dataSeries = intervalSeries(data, 'tornado');
  const cats = data.categories.map((category, index) => normalizeCategory(category as never, index));
  if (data.series.length !== dataSeries.length) {
    warnings.push({
      code: 'tornado-reference-ignored',
      severity: 'warn',
      message: 'tornado ignores reference-role series; the base case is the only comparator',
      suggest: 'remove reference series and set options.baseValue',
    });
  }
  if (options.baseValue === undefined) throw tornadoBaseRequired();
  const base =
    typeof options.baseValue === 'number' ? { value: options.baseValue } : options.baseValue;
  if (!Number.isFinite(base.value)) {
    throw new NormalizeError(
      'tornado-base-required',
      'options.baseValue',
      'tornado baseValue must be a finite number in the same units as the case series', undefined, undefined, ['options', 'baseValue'],
    );
  }
  const cases = options.tornado;
  if (!cases || cases.low === undefined || cases.high === undefined) {
    throw new NormalizeError(
      'tornado-cases-required',
      'options.tornado',
      'tornado requires options.tornado.low and options.tornado.high naming which series carries which case; case identity cannot be inferred from series order', undefined, undefined, ['options', 'tornado'],
    );
  }
  if (cases.low === cases.high) {
    throw new NormalizeError(
      'tornado-cases-identical',
      'options.tornado',
      `tornado.low and tornado.high must name different series; both name '${cases.low}'`, undefined, undefined, ['options', 'tornado'],
    );
  }
  const lowSeries = dataSeries.find((series) => series.id === cases.low);
  const highSeries = dataSeries.find((series) => series.id === cases.high);
  if (!lowSeries) {
    throw new NormalizeError(
      'tornado-case-unknown',
      'options.tornado.low',
      `tornado.low '${cases.low}' is not a data-role series; got ${dataSeries.map((s) => s.id).join(', ')}`, undefined, undefined, ['options', 'tornado', 'low'],
    );
  }
  if (!highSeries) {
    throw new NormalizeError(
      'tornado-case-unknown',
      'options.tornado.high',
      `tornado.high '${cases.high}' is not a data-role series; got ${dataSeries.map((s) => s.id).join(', ')}`, undefined, undefined, ['options', 'tornado', 'high'],
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
  warnRangeBarIgnoredRanking('tornado', options, warnings, data.categories.length);
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

  const lowCells = normalizeSeriesValues(lowSeries, cats, 0, 'values', data.series);
  const highCells = normalizeSeriesValues(highSeries, cats, 1, 'values', data.series);

  type DerivedRow = Omit<TornadoRowDerived, 'id'> & { index: number; cat: RowCat };
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
      // The receipt, tie detection and sort use the raw swing. Rounding here once turned a 0.001 swing into zero.
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
      undefined, undefined, ['data', 'series'],
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
      const say = (v: number): string => (collapsed ? String(v) : fmt(v));
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
              fields: ['low', 'high'],
              recordOwner: { categoryId: cat.id },
            },
          ]
        : [
            {
              id: `tornadoLow:${lowSeries.id}:${cat.id}`,
              owner: { seriesId: lowSeries.id, categoryId: cat.id },
              value: row.low,
              side: row.low < row.high ? 'low' : 'high',
              fields: ['low'],
              recordOwner: { categoryId: cat.id },
            },
            {
              id: `tornadoHigh:${highSeries.id}:${cat.id}`,
              owner: { seriesId: highSeries.id, categoryId: cat.id },
              value: row.high,
              side: row.high > row.low ? 'high' : 'low',
              fields: ['high'],
              recordOwner: { categoryId: cat.id },
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
      ...(base.label === undefined ? { baseText: fmt(base.value) } : {}),
    },
    ...(legend ? { legend } : {}),
    disclosures: [
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
      // Every number below is the RAW derivation, including floating-point representation noise.
      // The swing is as raw as `low` and `high` beside it, so the receipt never
      // contradicts itself (swing:0 next to low 2.452, high 2.453) and stays
      // auditable.
      totals: Object.fromEntries(ordered.map((row) => [row.cat.id, row.swing])),
      order: ordered.map((row) => row.cat.id),
      mean: ordered.reduce((sum, row) => sum + row.swing, 0) / ordered.length,
      tornado: {
        baseValue: base.value,
        method: 'one-at-a-time',
        // The rank groups the exhibit cannot visibly justify, named.
        ties,
        rows: ordered.map((row) => ({
          id: row.cat.id,
          low: row.low,
          high: row.high,
          swing: row.swing,
          down: row.down,
          up: row.up,
          inverse: row.inverse,
          straddles: row.straddles,
        })),
      },
    },
    a11yTitleCounts: [structureCount('drivers', ordered.length, undefined, options)],
    a11yTypeName: ['Sensitivity tornado', 'Sensitivitätstornado'],
  };
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
